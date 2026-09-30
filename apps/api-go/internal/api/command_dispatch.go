package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/compliance"
)

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	routeCommandType := strings.TrimPrefix(r.URL.Path, "/v1/commands/")
	if routeCommandType == "" || strings.Contains(routeCommandType, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "command_route_not_found"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var envelope command.Envelope
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		result := invalidEnvelope("unknown", "invalid_envelope", "command.invalid_envelope", nil)
		writeResult(w, http.StatusBadRequest, result)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		result := invalidEnvelope("unknown", "invalid_envelope", "command.invalid_envelope", nil)
		writeResult(w, http.StatusBadRequest, result)
		return
	}
	if result := validateEnvelope(envelope, routeCommandType); result != nil {
		writeResult(w, http.StatusBadRequest, *result)
		return
	}
	// Pre-auth per-IP rate limit: protects authentication and every command
	// route from brute force (also bounds OTP challenge requests).
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":" + envelope.CommandType) {
		result := command.Rejected(envelope, "RATE_LIMITED", "RESOURCE", "SAFE_RETRY", "command.rate_limited", nil)
		writeResult(w, http.StatusTooManyRequests, result)
		return
	}
	if requiresAuthentication(envelope.CommandType) {
		if s.Authenticator == nil {
			result := command.Rejected(envelope, "AUTHENTICATION_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "command.authentication_unavailable", nil)
			writeResult(w, http.StatusServiceUnavailable, result)
			return
		}
		rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			result := command.Rejected(envelope, "ACCESS_TOKEN_REQUIRED", "AUTHENTICATION", "AFTER_REAUTH", "command.access_token_required", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
		if err != nil {
			result := command.Rejected(envelope, "INVALID_ACCESS_TOKEN", "AUTHENTICATION", "AFTER_REAUTH", "command.invalid_access_token", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		// The App may send actor/principal as a UI hint, but the server owned
		// session is authoritative for command scope and idempotency.
		envelope.Actor = authenticated.Actor
		envelope.Principal = authenticated.Principal
		envelope.AuthContext = authenticated.AuthContext
		// Privileged commands (capability verification, contribution review /
		// reward, media readiness override) require operator rights. Fail closed.
		if requiresOperator(envelope.CommandType) {
			isOp := s.Operator != nil && s.Operator.IsOperator(envelope.Actor, envelope.Principal, envelope.AuthContext)
			// OPS-SCOPE-002: scope 从 gate 来（per-principal 配置；无配置=白名单内全
			// scope，即今天的行为）。s.Operator 非空是 isOp 的前件，走不到空指针。
			scopes := ScopesForPrincipal(false)
			if isOp {
				scopes = s.Operator.ScopesFor(envelope.Actor, envelope.Principal, envelope.AuthContext)
			}
			if !isOp || !AuthorizeOperatorCommand(envelope.CommandType, scopes) {
				result := command.Rejected(envelope, "OPERATOR_PRIVILEGE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "command.operator_privilege_required", nil)
				writeResult(w, http.StatusForbidden, result)
				return
			}
		}
		// Per-actor rate limit on top of the IP limit: rotating idempotency
		// keys must not allow unbounded command volume per session.
		if !s.rateAllow("actor:" + envelope.Actor.Type + ":" + envelope.Actor.ID + ":" + envelope.CommandType) {
			result := command.Rejected(envelope, "RATE_LIMITED", "RESOURCE", "SAFE_RETRY", "command.rate_limited", nil)
			writeResult(w, http.StatusTooManyRequests, result)
			return
		}
	}
	// Passwordless authentication is normally public. When it is initiated
	// from an existing Guest session, however, preserve that server-authenticated
	// person so the new credential upgrades it instead of creating a duplicate.
	if envelope.CommandType == "BeginPasswordlessAuthentication" && r.Header.Get("Authorization") != "" {
		if s.Authenticator == nil {
			result := command.Rejected(envelope, "AUTHENTICATION_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "command.authentication_unavailable", nil)
			writeResult(w, http.StatusServiceUnavailable, result)
			return
		}
		rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			result := command.Rejected(envelope, "INVALID_ACCESS_TOKEN", "AUTHENTICATION", "AFTER_REAUTH", "command.invalid_access_token", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
		if err != nil {
			result := command.Rejected(envelope, "INVALID_ACCESS_TOKEN", "AUTHENTICATION", "AFTER_REAUTH", "command.invalid_access_token", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		envelope.Actor = authenticated.Actor
		envelope.Principal = authenticated.Principal
		envelope.AuthContext = authenticated.AuthContext
	}

	// R16.7-P1-G: enforce any active kill switch for the
	// command's category. Runs after authentication so the
	// operator's own commands can still be served (operators
	// may need to inspect a disabled category).
	if blocked, blockedStatus := s.enforceKillSwitch(envelope); blocked != nil {
		writeResult(w, blockedStatus, *blocked)
		return
	}
	// MERCHANT-PUBLISH-001: publish-as-shop claims are verified here
	// (api layer owns the business repo; services never touch it).
	// The annotation is the only thing services trust.
	if rejected := s.resolveMerchantPublish(r.Context(), &envelope); rejected != nil {
		status := http.StatusForbidden
		if rejected.Error != nil && rejected.Error.ErrorCode == "MERCHANT_UNAVAILABLE" {
			status = http.StatusServiceUnavailable
		}
		writeResult(w, status, *rejected)
		return
	}
	result, status, err := s.executeCommand(r.Context(), envelope)
	if err != nil {
		log.Printf("command transaction failed: command=%s key=%s outcome=%s err=%v", envelope.CommandType, envelope.IdempotencyKey, result.Outcome, err)
		// DISPATCH-ERROR-HONESTY-001：事务失败 ⇒ 本次命令什么都没落库（闭包返回错误和
		// Commit 失败都会回滚，见 platform/postgres/pool.go 的 runInTransaction）。
		// 如果 dispatch 自己已经判了 REJECTED，那个结果里带着**真正的原因**（例如策略
		// 盖章的 permission denied）。这里统一报 500 command_transaction_failed 等于把
		// 「订单被拒」说成「服务器内部错误」，而 err 本身（SQLSTATE 25P02 current
		// transaction is aborted / commit unexpectedly resulted in rollback）只指向提交
		// 这一步，不指向任何真实故障 —— 排障的人会一路查到事务层，查不到策略盖章。
		// 实测 2026-09-30 LC-28：PLATFORM_PAY 付费单永远确认不了，客户端只看到 500。
		// ACCEPTED / PENDING 不能走这条路：回滚意味着命令**没有**生效，报成功就是撒谎。
		if result.Outcome == "REJECTED" {
			writeResult(w, statusFor(result), result)
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "command_transaction_failed"})
		return
	}
	writeResult(w, status, result)
}

// enforceKillSwitch returns a command.Result and a status code
// if the request is blocked by an active kill switch. It
// returns (nil, 0) when the command is allowed. The check
// runs after the route has been authenticated and before the
// command body is dispatched, so the operator can flip a
// switch and have it take effect on the very next request.
func (s *Server) enforceKillSwitch(envelope command.Envelope) (*command.Result, int) {
	category := commandKillSwitchCategory(envelope.CommandType)
	if category == "" {
		return nil, 0
	}
	if s.Compliance == nil {
		return nil, 0
	}
	cat, err := compliance.NormalizeCategory(category)
	if err != nil {
		return nil, 0
	}
	// We use a fresh background context (not the request
	// context) so a slow upstream cannot cause the gate to
	// fail-open. The call is cheap: one in-memory map read or
	// one indexed Postgres query.
	if s.Compliance.IsEnabled(context.Background(), cat) {
		return nil, 0
	}
	result := command.Rejected(envelope, "SERVICE_DISABLED", "BUSINESS_STATE", "AFTER_OPERATOR_ACTION", "compliance.service_disabled", map[string]any{
		"category":    category,
		"commandType": envelope.CommandType,
	})
	return &result, http.StatusServiceUnavailable
}

func (s *Server) executeCommand(ctx context.Context, envelope command.Envelope) (command.Result, int, error) {
	fingerprint := fingerprintFor(envelope)
	scope := idempotencyScope(envelope)
	var result command.Result
	status := http.StatusInternalServerError

	operation := func(operationContext context.Context) error {
		decision, previous, err := s.Idempotency.Begin(operationContext, scope, envelope.IdempotencyKey, fingerprint)
		if err != nil {
			log.Printf("idempotency begin failed: command=%s err=%v", envelope.CommandType, err)
			return err
		}
		switch decision {
		case command.IdempotencyConflict:
			result = command.Rejected(envelope, "IDEMPOTENCY_KEY_REUSED", "CONCURRENCY", "AFTER_USER_ACTION", "command.idempotency_key_reused", map[string]any{"idempotencyKey": envelope.IdempotencyKey})
			status = http.StatusConflict
			return nil
		case command.IdempotencyInProgress:
			result = command.Rejected(envelope, "IDEMPOTENCY_IN_PROGRESS", "CONCURRENCY", "SAFE_RETRY", "command.idempotency_in_progress", map[string]any{"idempotencyKey": envelope.IdempotencyKey})
			status = http.StatusConflict
			return nil
		case command.IdempotencyReplay:
			if previous == nil {
				return errors.New("idempotency replay record is missing")
			}
			result = previous.Result
			result.Outcome = "ALREADY_APPLIED"
			status = http.StatusOK
			return nil
		case command.IdempotencyClaimed:
			result = s.dispatchCommand(operationContext, envelope)
			if err := s.Idempotency.Complete(operationContext, scope, envelope.IdempotencyKey, command.IdempotencyRecord{Fingerprint: fingerprint, Result: result}); err != nil {
				log.Printf("idempotency complete failed: command=%s outcome=%s err=%v", envelope.CommandType, result.Outcome, err)
				// DISPATCH-ERROR-HONESTY-001：这里**不能**按 result.Outcome 决定怎么回话。
				// 事务已经被前面失败的语句毒掉了，即使这里 return nil，
				// runInTransaction 的 Commit 一样会失败（实测 err="commit unexpectedly
				// resulted in rollback"），结果仍然是 500。判断只留一个决策点，放在
				// executeCommand 的 err 分支里。
				return err
			}
			status = statusFor(result)
			return nil
		default:
			return errors.New("unknown idempotency decision")
		}
	}

	var err error
	if s.Transactions != nil {
		err = s.Transactions.WithinTransaction(ctx, operation)
	} else {
		err = operation(ctx)
	}
	if err != nil {
		// Dispatch/transaction failed: release the inflight idempotency claim
		// so the key does not stay IN_PROGRESS forever (best effort; the
		// transactional store may have rolled the claim back already).
		_ = s.Idempotency.Release(context.WithoutCancel(ctx), scope, envelope.IdempotencyKey, fingerprint)
	}
	return result, status, err
}

func (s *Server) dispatchCommand(ctx context.Context, envelope command.Envelope) command.Result {
	switch {
	case s.Identity != nil && s.Identity.Supports(envelope.CommandType):
		return s.Identity.HandleContext(ctx, envelope)
	case s.Demand != nil && s.Demand.Supports(envelope.CommandType):
		return s.Demand.HandleContext(ctx, envelope)
	case s.CityCompanion != nil && s.CityCompanion.Supports(envelope.CommandType):
		return s.CityCompanion.HandleContext(ctx, envelope)
	case s.LocalNet != nil && s.LocalNet.Supports(envelope.CommandType):
		return s.LocalNet.HandleContext(ctx, envelope)
	case s.LocalContext != nil && s.LocalContext.Supports(envelope.CommandType):
		return s.LocalContext.HandleContext(ctx, envelope)
	case s.Conversation != nil && s.Conversation.Supports(envelope.CommandType):
		return s.Conversation.HandleContext(ctx, envelope)
	case s.Engagement != nil && s.Engagement.Supports(envelope.CommandType):
		return s.Engagement.HandleContext(ctx, envelope)
	case s.Fulfillment != nil && s.Fulfillment.Supports(envelope.CommandType):
		return s.Fulfillment.HandleContext(ctx, envelope)
	case s.Supply != nil && s.Supply.Supports(envelope.CommandType):
		return s.Supply.HandleContext(ctx, envelope)
	case s.Media != nil && s.Media.Supports(envelope.CommandType):
		return s.Media.HandleContext(ctx, envelope)
	case s.Activity != nil && s.Activity.Supports(envelope.CommandType):
		return s.Activity.HandleContext(ctx, envelope)
	case s.Contribution != nil && s.Contribution.Supports(envelope.CommandType):
		return s.Contribution.HandleContext(ctx, envelope)
	case s.Experience != nil && s.Experience.Supports(envelope.CommandType):
		return s.Experience.HandleContext(ctx, envelope)
	case s.Voucher != nil && s.Voucher.Supports(envelope.CommandType):
		return s.Voucher.HandleContext(ctx, envelope)
	case s.Marketplace != nil && s.Marketplace.Supports(envelope.CommandType):
		return s.Marketplace.HandleContext(ctx, envelope)
	case s.SocialSpace != nil && s.SocialSpace.Supports(envelope.CommandType):
		return s.SocialSpace.HandleContext(ctx, envelope)
	case s.Payment != nil && s.Payment.Supports(envelope.CommandType):
		return s.Payment.HandleContext(ctx, envelope)
	case s.Wallet != nil && s.Wallet.Supports(envelope.CommandType):
		return s.Wallet.HandleContext(ctx, envelope)
	case s.Outcome != nil && s.Outcome.Supports(envelope.CommandType):
		return s.Outcome.HandleContext(ctx, envelope)
	case s.Notification != nil && s.Notification.Supports(envelope.CommandType):
		return s.Notification.HandleContext(ctx, envelope)
	case s.Safety != nil && s.Safety.Supports(envelope.CommandType):
		return s.Safety.HandleContext(ctx, envelope)
	case s.Business != nil && s.Business.Supports(envelope.CommandType):
		return s.Business.HandleContext(ctx, envelope)
	case s.Relationship != nil && s.Relationship.Supports(envelope.CommandType):
		return s.Relationship.HandleContext(ctx, envelope)
	case s.Scene != nil && s.Scene.Supports(envelope.CommandType):
		return s.Scene.HandleContext(ctx, envelope)
	case s.RealityScene != nil && s.RealityScene.Supports(envelope.CommandType):
		return s.RealityScene.HandleContext(ctx, envelope)
	case s.Location != nil && s.Location.Supports(envelope.CommandType):
		return s.Location.HandleContext(ctx, envelope)
	case s.Benefit != nil && s.Benefit.Supports(envelope.CommandType):
		return s.Benefit.HandleContext(ctx, envelope)
	case s.Growth != nil && s.Growth.Supports(envelope.CommandType):
		return s.Growth.HandleContext(ctx, envelope)
	case s.Rating != nil && s.Rating.Supports(envelope.CommandType):
		return s.Rating.HandleContext(ctx, envelope)
	case s.SceneReview != nil && s.SceneReview.Supports(envelope.CommandType):
		return s.SceneReview.HandleContext(ctx, envelope)
	case s.Profile != nil && s.Profile.Supports(envelope.CommandType):
		return s.Profile.HandleContext(ctx, envelope)
	// COMP-REPORT-001: user report intake. Listed last because ReportTarget
	// does not collide with any other service's command names; if it ever
	// does, the collision should be found in review, not by reordering.
	case s.Moderation != nil && s.Moderation.Supports(envelope.CommandType):
		return s.Moderation.HandleContext(ctx, envelope)
	// STORE-REC-001: store recommendation intake (独立模块：推荐商铺进体系).
	case s.StoreOnboarding != nil && s.StoreOnboarding.Supports(envelope.CommandType):
		return s.StoreOnboarding.HandleContext(ctx, envelope)
	// PUBLIC-NO-LOOKUP-001: 客服按公共编号反查（operator 门在上面 requiresOperator 处）。
	case s.NumberLookup != nil && s.NumberLookup.Supports(envelope.CommandType):
		return s.NumberLookup.HandleContext(ctx, envelope)
	default:
		return notImplemented(envelope)
	}
}

func idempotencyScope(envelope command.Envelope) string {
	return envelope.Actor.Type + ":" + envelope.Actor.ID + "|" + envelope.Principal.Type + ":" + envelope.Principal.ID
}

func requiresAuthentication(commandType string) bool {
	switch commandType {
	case "BeginPasswordlessAuthentication", "RequestLoginChallenge", "VerifyLoginChallenge", "LookupPasswordlessIdentity", "CreateSession", "CreateAnonymousSession", "RequestAccountRecovery", "RefreshSession", "ResumeTrustedDeviceSession",
		"ListFeedPosts", "ListMarketOpportunities", "ListOpportunityTemplates", "SuggestOpportunityTemplate", "ListActivities", "ListStatuses", "ListCommunities":
		return false
	default:
		return true
	}
}

// commandKillSwitchCategory returns the compliance.Category
// that gates the given command type, or empty string if the
// command is not affected by any kill switch. The mapping
// here is the single source of truth for "which kill switch
// blocks which command"; the HTTP /v1/legal/status route and
// the mobile client both read this shape.
func commandKillSwitchCategory(commandType string) string {
	switch commandType {
	case "CreateOrder", "SubmitPayment", "ConfirmOrder":
		return "MARKETPLACE"
	case "PublishAIPost", "GenerateAIContent":
		return "AI_MEDIA"
	}
	return ""
}

func bearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

// missingEnvelopeField names the first required envelope field that is absent
// or too short, or "" when the envelope is structurally complete.
//
// Why this exists: validateEnvelope used to reject with an empty safeDetails
// map, so a caller that sent, say, target.id = "" got a bare
// INVALID_COMMAND_ENVELOPE with no way to tell which field was wrong -- and
// because the rejection happens before dispatch, the server log looks
// identical to "this command does not exist". Naming the field is the same
// convention already used for the requestedAt branch below.
func missingEnvelopeField(envelope command.Envelope) string {
	switch {
	case envelope.CommandID == "":
		return "commandId"
	case envelope.CommandType == "":
		return "commandType"
	case envelope.CommandVersion <= 0:
		return "commandVersion"
	case envelope.Actor.Type == "":
		return "actor.type"
	case envelope.Actor.ID == "":
		return "actor.id"
	case envelope.Principal.Type == "":
		return "principal.type"
	case envelope.Principal.ID == "":
		return "principal.id"
	case envelope.Target.Type == "":
		return "target.type"
	case envelope.Target.ID == "":
		return "target.id"
	case len(envelope.IdempotencyKey) < 8:
		return "idempotencyKey"
	case envelope.AuthContext == nil:
		return "authContext"
	case envelope.Purpose == "":
		return "purpose"
	case envelope.CorrelationID == "":
		return "correlationId"
	case envelope.RequestedAt == "":
		return "requestedAt"
	case envelope.Payload == nil:
		return "payload"
	}
	return ""
}

// SupportedCommandVersion 是本服务唯一接受的命令契约版本（COMMAND-VERSION-001）。
//
// 全仓所有发件方都发 1（内部构造器、api handler、e2e、移动端），所以上界收紧到 1
// 不会打断任何现有调用方。升级契约时改这一个常量 + openapi 的 enum 即可。
const SupportedCommandVersion = 1

func validateEnvelope(envelope command.Envelope, routeCommandType string) *command.Result {
	if field := missingEnvelopeField(envelope); field != "" {
		result := invalidEnvelope(envelope.CommandID, envelope.CorrelationID, "command.invalid_envelope", map[string]any{"field": field})
		return &result
	}
	// COMMAND-VERSION-001：版本闸门。原先只拒 `CommandVersion <= 0`（当成"缺字段"），
	// 上界完全没有 —— 客户端发 commandVersion: 9999 会被**当 v1 处理**并正常执行。
	//
	// 为什么要补：命令版本是契约的一部分。v2 的 payload 语义若与 v1 不同（新增必填
	// 字段、改了含义），把它当 v1 跑就是**静默误读** —— 服务返回 200，客户端以为
	// 自己的新语义生效了，实际服务端按老规则处理了。openapi 里写的是
	// `commandVersion: { type: integer, minimum: 1 }`，只有下界，契约本身也没表达
	// "只支持 v1"这件事。两边一起补。
	//
	// 单独一个错误码而不是复用 INVALID_COMMAND_ENVELOPE：客户端需要区分
	// "你发错了"和"你太新了" —— 后者的正确反应是升级客户端，重试没有意义。
	if envelope.CommandVersion != SupportedCommandVersion {
		result := command.Rejected(envelope, "UNSUPPORTED_COMMAND_VERSION", "VALIDATION", "NO", "command.unsupported_version", map[string]any{
			"supportedVersion": SupportedCommandVersion,
			"receivedVersion":  envelope.CommandVersion,
		})
		return &result
	}
	if _, err := time.Parse(time.RFC3339, envelope.RequestedAt); err != nil {
		result := command.Rejected(envelope, "INVALID_COMMAND_ENVELOPE", "VALIDATION", "AFTER_USER_ACTION", "command.invalid_envelope", map[string]any{"field": "requestedAt"})
		return &result
	}
	if envelope.CommandType != routeCommandType {
		result := command.Rejected(envelope, "COMMAND_TYPE_MISMATCH", "VALIDATION", "AFTER_USER_ACTION", "command.type_mismatch", map[string]any{"routeCommandType": routeCommandType})
		return &result
	}
	return nil
}

func invalidEnvelope(commandID, correlationID, messageKey string, safeDetails map[string]any) command.Result {
	if correlationID == "" {
		correlationID = "http_invalid"
	}
	if safeDetails == nil {
		safeDetails = map[string]any{}
	}
	return command.Result{CommandID: commandID, Outcome: "REJECTED", EventRefs: []string{}, CorrelationID: correlationID, Error: &command.ErrorEnvelope{ErrorCode: "INVALID_COMMAND_ENVELOPE", Category: "VALIDATION", Retryability: "AFTER_USER_ACTION", MessageKey: messageKey, SafeDetails: safeDetails, CorrelationID: correlationID}}
}

func notImplemented(envelope command.Envelope) command.Result {
	return command.Rejected(envelope, "COMMAND_NOT_IMPLEMENTED", "BUSINESS_STATE", "AFTER_USER_ACTION", "foundation.command_not_implemented", map[string]any{"commandType": envelope.CommandType})
}

func fingerprintFor(envelope command.Envelope) string {
	value := struct {
		CommandType              string            `json:"commandType"`
		CommandVersion           int               `json:"commandVersion"`
		Actor                    command.Actor     `json:"actor"`
		Principal                command.Principal `json:"principal"`
		Target                   command.Target    `json:"target"`
		ExpectedAggregateVersion *int              `json:"expectedAggregateVersion,omitempty"`
		PolicySnapshot           map[string]any    `json:"policySnapshot,omitempty"`
		AuthContext              map[string]any    `json:"authContext"`
		Purpose                  string            `json:"purpose"`
		Payload                  map[string]any    `json:"payload"`
	}{envelope.CommandType, envelope.CommandVersion, envelope.Actor, envelope.Principal, envelope.Target, envelope.ExpectedAggregateVersion, envelope.PolicySnapshot, envelope.AuthContext, envelope.Purpose, envelope.Payload}
	bytes, _ := json.Marshal(value)
	return string(bytes)
}

func statusFor(result command.Result) int {
	switch result.Outcome {
	case "PENDING":
		return http.StatusAccepted
	case "REJECTED":
		if result.Error != nil && result.Error.ErrorCode == "COMMAND_NOT_IMPLEMENTED" {
			return http.StatusNotImplemented
		}
		return http.StatusConflict
	default:
		return http.StatusOK
	}
}

func writeResult(w http.ResponseWriter, status int, result command.Result) {
	writeJSON(w, status, result)
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

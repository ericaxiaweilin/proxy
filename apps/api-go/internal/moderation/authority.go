package moderation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-AUTHORITY-001: 有权机关请求的受理留痕与响应时限。
//
// 服务条款 §55「合法政府请求与紧急响应」承诺了**带数字**的响应时限：
//   - 一般有效用户信息请求：最迟 24 小时内处理；
//   - 涉及国家安全或生命安全的紧急有效请求：最迟 3 小时内处理；
//   - 依法要求限制访问、删除违法信息或移除违法服务：最迟 24 小时内处理；
//   - 国家安全紧急情况下的相关内容处置：最迟 6 小时内处理。
// 并承诺「所有请求应进行主体、权限、范围和合法性核验，并对处理过程进行
// 记录」。
//
// 而代码里 REFERRED_TO_AUTHORITY 只是 087 里一个从未被任何写入路径使用的
// 枚举值 —— 请求进来了没有受理记录、没有核验记录、没有截止时刻、没有响应
// 记录。平台既证明不了自己在法定时限内响应过，也证明不了自己核验过请求的
// 合法性。网络安全法 116/2025 与 333/2026/NĐ-CP 同样要求平台建立能够满足
// 法定响应时限的流程。
//
// 沿用 086/087/088 的口径：
//   - append-only：受理与响应都是举证材料，不 UPDATE / 不 DELETE。
//   - fail-closed：四项核验（主体 / 权限 / 范围 / 合法性）缺一不得受理；
//     请求种类不认识 → 拿不到时限 → 直接拒绝写入（而不是悄悄按 24h 算，
//     那会把 3 小时的生命安全紧急请求拖成 24 小时）。
//   - 两个写入命令都是 operator-only（见 security.go 的 operatorCommandTypes）。
//     普通用户绝不能伪造「有权机关要求调取你的信息」这种记录。

// 有权机关请求的种类。
const (
	// KindUserInfo 一般有效用户信息请求 —— 最迟 24 小时。
	KindUserInfo = "USER_INFO"
	// KindUserInfoEmergency 涉及国家安全或生命安全的紧急用户信息请求 —— 最迟 3 小时。
	KindUserInfoEmergency = "USER_INFO_EMERGENCY"
	// KindContentRemoval 限制访问 / 删除违法信息 / 移除违法服务 —— 最迟 24 小时。
	KindContentRemoval = "CONTENT_REMOVAL"
	// KindContentRemovalEmergency 国家安全紧急情况下的相关内容处置 —— 最迟 6 小时。
	KindContentRemovalEmergency = "CONTENT_REMOVAL_EMERGENCY"
)

// 响应结论。
const (
	AuthorityOutcomeFulfilled          = "FULFILLED"
	AuthorityOutcomePartiallyFulfilled = "PARTIALLY_FULFILLED"
	AuthorityOutcomeRefused            = "REFUSED"
	AuthorityOutcomeNoDataFound        = "NO_DATA_FOUND"
)

// AuthorityRequestKinds 返回受支持的请求种类（已排序）。
func AuthorityRequestKinds() []string {
	out := []string{KindUserInfo, KindUserInfoEmergency, KindContentRemoval, KindContentRemovalEmergency}
	sort.Strings(out)
	return out
}

// AuthorityOutcomes 返回受支持的响应结论（已排序）。
func AuthorityOutcomes() []string {
	out := []string{
		AuthorityOutcomeFulfilled, AuthorityOutcomePartiallyFulfilled,
		AuthorityOutcomeRefused, AuthorityOutcomeNoDataFound,
	}
	sort.Strings(out)
	return out
}

// SLAHours 返回该种类请求的法定响应时限（小时）；种类不认识时返回 false。
//
// 刻意不做「认不出来就按 24 小时算」的兜底：那会把 3 小时的生命安全紧急
// 请求悄悄拖成 24 小时——正是本包要防的事。
func SLAHours(kind string) (int, bool) {
	switch kind {
	case KindUserInfo, KindContentRemoval:
		return 24, true
	case KindUserInfoEmergency:
		return 3, true
	case KindContentRemovalEmergency:
		return 6, true
	default:
		return 0, false
	}
}

// DeadlineFor 由受理时刻与请求种类推导法定截止时刻。
func DeadlineFor(kind string, receivedAt time.Time) (time.Time, bool) {
	hours, ok := SLAHours(kind)
	if !ok {
		return time.Time{}, false
	}
	return receivedAt.UTC().Add(time.Duration(hours) * time.Hour), true
}

// MetDeadline 判断响应是否落在法定时限内。这是「我们在 24 小时内响应了」
// 这条承诺唯一的直接证据，因此单独成函数以便被测试直接钉住。
func MetDeadline(deadlineAt, respondedAt time.Time) bool {
	return !respondedAt.UTC().After(deadlineAt.UTC())
}

// AuthorityRequest 是一条有权机关请求的受理记录。
type AuthorityRequest struct {
	ID                string    `json:"authorityRequestId"`
	RequestRef        string    `json:"requestRef"`
	Authority         string    `json:"authority"`
	Kind              string    `json:"requestKind"`
	VerifiedSubject   bool      `json:"verifiedSubject"`
	VerifiedAuthority bool      `json:"verifiedAuthority"`
	VerifiedScope     bool      `json:"verifiedScope"`
	VerifiedLegality  bool      `json:"verifiedLegality"`
	ReceivedAt        time.Time `json:"receivedAt"`
	DeadlineAt        time.Time `json:"deadlineAt"`
	Note              string    `json:"note,omitempty"`
	ActorID           string    `json:"actorId"`
	CreatedAt         time.Time `json:"createdAt"`
}

// AuthorityResponse 是对一条请求的响应记录（append-only）。
type AuthorityResponse struct {
	ID          string    `json:"authorityResponseId"`
	RequestID   string    `json:"requestId"`
	Outcome     string    `json:"outcome"`
	RespondedAt time.Time `json:"respondedAt"`
	Note        string    `json:"note,omitempty"`
	ActorID     string    `json:"actorId"`
	CreatedAt   time.Time `json:"createdAt"`
}

type authorityRequestPayload struct {
	RequestRef        string `json:"requestRef"`
	Authority         string `json:"authority"`
	Kind              string `json:"requestKind"`
	VerifiedSubject   bool   `json:"verifiedSubject"`
	VerifiedAuthority bool   `json:"verifiedAuthority"`
	VerifiedScope     bool   `json:"verifiedScope"`
	VerifiedLegality  bool   `json:"verifiedLegality"`
	ReceivedAt        string `json:"receivedAt"`
	Note              string `json:"note"`
}

// recordAuthorityRequest 记录一次有权机关请求的受理。operator-only ——
// 普通用户不能伪造「有权机关要求调取你的信息」这种记录。
func (s *Service) recordAuthorityRequest(ctx context.Context, e command.Envelope) command.Result {
	var p authorityRequestPayload
	if !decodeAuthorityRequestPayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_AUTHORITY_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request", nil)
	}
	// 请求种类决定时限：认不出来就拒绝，绝不按最长的 24 小时兜底。
	if !contains(AuthorityRequestKinds(), p.Kind) {
		return command.Rejected(e, "INVALID_AUTHORITY_REQUEST_KIND", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request_kind", nil)
	}
	if strings.TrimSpace(p.RequestRef) == "" {
		return command.Rejected(e, "INVALID_AUTHORITY_REQUEST_REF", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request_ref", nil)
	}
	if strings.TrimSpace(p.Authority) == "" {
		return command.Rejected(e, "INVALID_AUTHORITY_REQUEST_AUTHORITY", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request_authority", nil)
	}
	// §55：主体 / 权限 / 范围 / 合法性四项核验，缺一不得受理。
	if !p.VerifiedSubject || !p.VerifiedAuthority || !p.VerifiedScope || !p.VerifiedLegality {
		return command.Rejected(e, "AUTHORITY_REQUEST_VERIFICATION_INCOMPLETE", "VALIDATION", "AFTER_USER_ACTION", "moderation.authority_request_verification_incomplete", nil)
	}
	if e.Actor.ID == "" {
		return command.Rejected(e, "AUTHORITY_REQUEST_REQUIRES_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.authority_request_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "AUTHORITY_REQUEST_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.authority_request_failed", nil)
	}
	// 受理时刻：客户端可以带，但必须是合法 RFC3339；没带就用服务端时钟。
	// 不信任客户端自报一个未来时刻 —— 那会把截止时刻一起推后。
	receivedAt := s.clock.Now().UTC()
	if strings.TrimSpace(p.ReceivedAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(p.ReceivedAt))
		if err != nil {
			return command.Rejected(e, "INVALID_AUTHORITY_REQUEST_RECEIVED_AT", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request_received_at", nil)
		}
		receivedAt = parsed.UTC()
	}
	if receivedAt.After(s.clock.Now().UTC().Add(time.Minute)) {
		return command.Rejected(e, "INVALID_AUTHORITY_REQUEST_RECEIVED_AT", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request_received_at", nil)
	}
	deadline, ok := DeadlineFor(p.Kind, receivedAt)
	if !ok {
		return command.Rejected(e, "INVALID_AUTHORITY_REQUEST_KIND", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_request_kind", nil)
	}
	request := AuthorityRequest{
		ID:                newAuthorityRequestID(),
		RequestRef:        p.RequestRef,
		Authority:         p.Authority,
		Kind:              p.Kind,
		VerifiedSubject:   p.VerifiedSubject,
		VerifiedAuthority: p.VerifiedAuthority,
		VerifiedScope:     p.VerifiedScope,
		VerifiedLegality:  p.VerifiedLegality,
		ReceivedAt:        receivedAt,
		DeadlineAt:        deadline,
		Note:              strings.TrimSpace(p.Note),
		ActorID:           e.Actor.ID,
		CreatedAt:         s.clock.Now().UTC(),
	}
	if err := s.repository.AddAuthorityRequest(ctx, request); err != nil {
		return command.Rejected(e, "AUTHORITY_REQUEST_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.authority_request_failed", nil)
	}
	return command.Accepted(e, "ModerationAuthorityRequest", request.ID, 1, p.Kind, nil)
}

type authorityResponsePayload struct {
	RequestID   string `json:"requestId"`
	Outcome     string `json:"outcome"`
	RespondedAt string `json:"respondedAt"`
	Note        string `json:"note"`
}

// recordAuthorityResponse 记录一次对有权机关请求的响应。operator-only ——
// 响应记录是「我们在法定时限内响应了」的直接证据。
func (s *Service) recordAuthorityResponse(ctx context.Context, e command.Envelope) command.Result {
	var p authorityResponsePayload
	if !decodeAuthorityResponsePayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_AUTHORITY_RESPONSE", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_response", nil)
	}
	if !contains(AuthorityOutcomes(), p.Outcome) {
		return command.Rejected(e, "INVALID_AUTHORITY_RESPONSE_OUTCOME", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_response_outcome", nil)
	}
	if strings.TrimSpace(p.RequestID) == "" {
		return command.Rejected(e, "INVALID_AUTHORITY_RESPONSE_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_response_request", nil)
	}
	if e.Actor.ID == "" {
		return command.Rejected(e, "AUTHORITY_RESPONSE_REQUIRES_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.authority_response_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "AUTHORITY_RESPONSE_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.authority_response_failed", nil)
	}
	// 响应必须挂在真实存在的请求上：给不存在的请求写响应，只能制造
	// 「看起来响应过」的假象。
	request, ok := s.repository.FindAuthorityRequest(ctx, p.RequestID)
	if !ok {
		return command.Rejected(e, "AUTHORITY_RESPONSE_REQUEST_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "moderation.authority_response_request_not_found", nil)
	}
	respondedAt := s.clock.Now().UTC()
	if strings.TrimSpace(p.RespondedAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(p.RespondedAt))
		if err != nil {
			return command.Rejected(e, "INVALID_AUTHORITY_RESPONSE_RESPONDED_AT", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_authority_response_responded_at", nil)
		}
		respondedAt = parsed.UTC()
	}
	response := AuthorityResponse{
		ID:          newAuthorityResponseID(),
		RequestID:   p.RequestID,
		Outcome:     p.Outcome,
		RespondedAt: respondedAt,
		Note:        strings.TrimSpace(p.Note),
		ActorID:     e.Actor.ID,
		CreatedAt:   s.clock.Now().UTC(),
	}
	if err := s.repository.AddAuthorityResponse(ctx, response); err != nil {
		return command.Rejected(e, "AUTHORITY_RESPONSE_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.authority_response_failed", nil)
	}
	// 是否踩线是这条留痕的核心价值：超时也要照实记，但不能让人以为合规。
	state := p.Outcome
	if !MetDeadline(request.DeadlineAt, respondedAt) {
		state = p.Outcome + "|LATE"
	}
	return command.Accepted(e, "ModerationAuthorityResponse", response.ID, 1, state, nil)
}

func decodeAuthorityRequestPayload(payload map[string]any, out *authorityRequestPayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func decodeAuthorityResponsePayload(payload map[string]any, out *authorityResponsePayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func newAuthorityRequestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "authreq_" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return "authreq_" + hex.EncodeToString(buf)
}

func newAuthorityResponseID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "authresp_" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return "authresp_" + hex.EncodeToString(buf)
}

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/supply"
)

func apiEnvelope(commandType string, payload map[string]any, target command.Target, idempotency string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_" + idempotency,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target:         target,
		IdempotencyKey: idempotency,
		AuthContext:    map[string]any{},
		Purpose:        "api_test",
		CorrelationID:  "corr_" + idempotency,
		RequestedAt:    "2026-08-14T00:00:00Z",
		Payload:        payload,
	}
}

type stubAuthenticator struct{}

func (stubAuthenticator) Authenticate(context.Context, string) (identity.AuthenticatedSession, error) {
	return identity.AuthenticatedSession{
		Actor:       command.Actor{Type: "USER", ID: "user_001"},
		Principal:   command.Principal{Type: "BUSINESS", ID: "business_001"},
		SessionID:   "session_auth_001",
		AuthContext: map[string]any{"sessionId": "session_auth_001"},
	}, nil
}

type recordingTransactionRunner struct {
	called bool
}

func (runner *recordingTransactionRunner) WithinTransaction(ctx context.Context, operation func(context.Context) error) error {
	runner.called = true
	return operation(ctx)
}

func request(handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	return requestWithBearer(handler, method, path, body, "")
}

func requestWithBearer(handler http.Handler, method, path string, body any, bearer string) *httptest.ResponseRecorder {
	payloadBytes, _ := json.Marshal(body)
	record := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewReader(payloadBytes))
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	handler.ServeHTTP(record, req)
	return record
}

func TestHealthAndCommandBoundary(t *testing.T) {
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, stubAuthenticator{})
	handler := server.Handler()
	live := httptest.NewRecorder()
	handler.ServeHTTP(live, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if live.Code != http.StatusOK {
		t.Fatalf("live status: %d", live.Code)
	}

	unknown := requestWithBearer(handler, http.MethodPost, "/v1/commands/UnknownCommand", apiEnvelope("UnknownCommand", map[string]any{}, command.Target{Type: "Test", ID: "1"}, "idem_unknown_001"), "access_test")
	if unknown.Code != http.StatusNotImplemented {
		t.Fatalf("unknown status: %d", unknown.Code)
	}

	mismatch := request(handler, http.MethodPost, "/v1/commands/RecordOutcomeObservation", apiEnvelope("FinalizeObservationSet", map[string]any{}, command.Target{Type: "ObservationSet", ID: "1"}, "idem_mismatch_001"))
	if mismatch.Code != http.StatusBadRequest {
		t.Fatalf("mismatch status: %d", mismatch.Code)
	}
}

func TestMediaUploadContentRangeCanResumeFromReportedOffset(t *testing.T) {
	mediaService := media.New()
	mediaService.SetStoreDir(t.TempDir())
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), mediaService, contribution.New(), nil, nil, stubAuthenticator{})
	handler := server.Handler()
	created := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreateMediaAsset", apiEnvelope("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "range.jpg", "mimeType": "image/jpeg",
	}, command.Target{Type: "MediaAsset", ID: "new"}, "idem_range_asset"), "access_test")
	var commandResult command.Result
	if err := json.Unmarshal(created.Body.Bytes(), &commandResult); err != nil {
		t.Fatal(err)
	}
	var operation struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	if err := json.Unmarshal([]byte(commandResult.OperationRef), &operation); err != nil {
		t.Fatal(err)
	}
	content := []byte{0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9}
	uploadChunk := func(start, end int, chunk []byte) *httptest.ResponseRecorder {
		record := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/v1/media/upload/"+operation.MediaAssetID, bytes.NewReader(chunk))
		req.Header.Set("Authorization", "Bearer access_test")
		req.Header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(content)))
		req.Header.Set("X-Chunk-SHA256", fmt.Sprintf("%x", sha256.Sum256(chunk)))
		handler.ServeHTTP(record, req)
		return record
	}
	first := uploadChunk(0, 3, content[:4])
	if first.Code != http.StatusAccepted || first.Header().Get("Upload-Offset") != "4" {
		t.Fatalf("first chunk status=%d offset=%s body=%s", first.Code, first.Header().Get("Upload-Offset"), first.Body.String())
	}
	head := httptest.NewRecorder()
	headRequest := httptest.NewRequest(http.MethodHead, "/v1/media/upload/"+operation.MediaAssetID, nil)
	headRequest.Header.Set("Authorization", "Bearer access_test")
	handler.ServeHTTP(head, headRequest)
	if head.Code != http.StatusNoContent || head.Header().Get("Upload-Offset") != "4" {
		t.Fatalf("head status=%d offset=%s", head.Code, head.Header().Get("Upload-Offset"))
	}
	second := uploadChunk(4, 7, content[4:])
	if second.Code != http.StatusNoContent || second.Header().Get("Upload-Offset") != "8" {
		t.Fatalf("second chunk status=%d offset=%s body=%s", second.Code, second.Header().Get("Upload-Offset"), second.Body.String())
	}
}

func TestDemandCommandBoundary(t *testing.T) {
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, stubAuthenticator{})
	handler := server.Handler()
	created := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreateTaskDraft", apiEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": "user_001",
		"principal":          map[string]any{"type": "BUSINESS", "id": "business_001"},
		"sourceInput":        "Need a greeter",
	}, command.Target{Type: "TaskDraft", ID: "new"}, "idem_go_draft_001"), "access_test")
	if created.Code != http.StatusOK {
		t.Fatalf("create status: %d body=%s", created.Code, created.Body.String())
	}
	var createdResult command.Result
	if err := json.Unmarshal(created.Body.Bytes(), &createdResult); err != nil {
		t.Fatal(err)
	}
	preview := requestWithBearer(handler, http.MethodPost, "/v1/commands/PreviewTaskDraft", apiEnvelope("PreviewTaskDraft", map[string]any{"expectedVersion": 1}, command.Target{Type: "TaskDraft", ID: createdResult.Aggregate.ID}, "idem_go_preview_001"), "access_test")
	if preview.Code != http.StatusConflict {
		t.Fatalf("preview status: %d body=%s", preview.Code, preview.Body.String())
	}
	var previewResult command.Result
	if err := json.Unmarshal(preview.Body.Bytes(), &previewResult); err != nil {
		t.Fatal(err)
	}
	if previewResult.Error == nil || previewResult.Error.ErrorCode != "TASK_DRAFT_INCOMPLETE" {
		t.Fatalf("unexpected preview: %#v", previewResult)
	}
}

func TestCommandReplayUsesStoredResult(t *testing.T) {
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, stubAuthenticator{})
	handler := server.Handler()
	envelope := apiEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": "user_001",
		"principal":          map[string]any{"type": "BUSINESS", "id": "business_001"},
		"sourceInput":        "Need a greeter",
	}, command.Target{Type: "TaskDraft", ID: "new"}, "idem_replay_001")
	first := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreateTaskDraft", envelope, "access_test")
	second := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreateTaskDraft", envelope, "access_test")
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("unexpected replay statuses: %d %d", first.Code, second.Code)
	}
	var replay command.Result
	if err := json.Unmarshal(second.Body.Bytes(), &replay); err != nil {
		t.Fatal(err)
	}
	if replay.Outcome != "ALREADY_APPLIED" {
		t.Fatalf("expected replay outcome, got %#v", replay)
	}
}

func TestReadinessFailsWhenDependencyCheckFails(t *testing.T) {
	server := NewServerWithDependencies(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, func(_ context.Context) error {
		return errors.New("database unavailable")
	})
	record := httptest.NewRecorder()
	server.Handler().ServeHTTP(record, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if record.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected not ready status, got %d", record.Code)
	}
}

func TestConfiguredAuthenticatorOwnsCommandScope(t *testing.T) {
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, stubAuthenticator{})
	handler := server.Handler()
	envelope := apiEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": "user_001",
		"principal":          map[string]any{"type": "BUSINESS", "id": "business_001"},
		"sourceInput":        "Need a greeter",
	}, command.Target{Type: "TaskDraft", ID: "new"}, "idem_auth_scope_001")
	envelope.Actor = command.Actor{Type: "USER", ID: "forged_user"}
	envelope.Principal = command.Principal{Type: "BUSINESS", ID: "forged_business"}
	body, _ := json.Marshal(envelope)
	record := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/commands/CreateTaskDraft", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer access_test")
	handler.ServeHTTP(record, req)
	if record.Code != http.StatusOK {
		t.Fatalf("expected authenticated command to succeed, status=%d body=%s", record.Code, record.Body.String())
	}
}

func TestConfiguredAuthenticatorRejectsMissingBearerToken(t *testing.T) {
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, stubAuthenticator{})
	record := request(server.Handler(), http.MethodPost, "/v1/commands/PreviewTaskDraft", apiEnvelope("PreviewTaskDraft", map[string]any{"expectedVersion": 1}, command.Target{Type: "TaskDraft", ID: "draft_001"}, "idem_auth_missing_001"))
	if record.Code != http.StatusUnauthorized {
		t.Fatalf("expected missing access token to be rejected, got %d body=%s", record.Code, record.Body.String())
	}
}

func TestProtectedCommandFailsClosedWithoutAuthenticator(t *testing.T) {
	server := NewServer(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New())
	record := request(server.Handler(), http.MethodPost, "/v1/commands/CreateTaskDraft", apiEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": "user_001",
		"principal":          map[string]any{"type": "BUSINESS", "id": "business_001"},
		"sourceInput":        "Need a greeter",
	}, command.Target{Type: "TaskDraft", ID: "new"}, "idem_auth_unavailable_001"))
	if record.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected fail-closed authentication status, got %d body=%s", record.Code, record.Body.String())
	}
}

func TestCommandUsesConfiguredTransactionRunner(t *testing.T) {
	runner := &recordingTransactionRunner{}
	server := NewServerWithRuntime(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, stubAuthenticator{}, runner)
	record := requestWithBearer(server.Handler(), http.MethodPost, "/v1/commands/CreateTaskDraft", apiEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": "user_001",
		"principal":          map[string]any{"type": "BUSINESS", "id": "business_001"},
		"sourceInput":        "Need a greeter",
	}, command.Target{Type: "TaskDraft", ID: "new"}, "idem_transaction_001"), "access_test")
	if record.Code != http.StatusOK || !runner.called {
		t.Fatalf("expected command transaction, status=%d called=%v body=%s", record.Code, runner.called, record.Body.String())
	}
}

func TestCommandRejectsUnknownEnvelopeFields(t *testing.T) {
	envelopeBytes, _ := json.Marshal(apiEnvelope("CreateTaskDraft", map[string]any{}, command.Target{Type: "TaskDraft", ID: "new"}, "idem_unknown_field_001"))
	var envelope map[string]any
	_ = json.Unmarshal(envelopeBytes, &envelope)
	envelope["unexpectedAuthority"] = true
	record := request(NewServer(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New()).Handler(), http.MethodPost, "/v1/commands/CreateTaskDraft", envelope)
	if record.Code != http.StatusBadRequest {
		t.Fatalf("expected strict envelope rejection, got %d body=%s", record.Code, record.Body.String())
	}
}

// OperatorGate fail-closed（第 9 项收尾）：nil gate 拒绝一切 operator 命令；
// 白名单 principal 放行。
func TestOperatorGateFailsClosedAndAllowlist(t *testing.T) {
	// nil gate → 拒绝
	g := (*StaticOperatorGate)(nil)
	if g.IsOperator(command.Actor{Type: "USER", ID: "user_001"}, command.Principal{Type: "BUSINESS", ID: "business_001"}, map[string]any{}) {
		t.Fatal("nil gate must deny everything")
	}
	// 空白名单 → 拒绝
	g2 := NewStaticOperatorGate(nil)
	if g2.IsOperator(command.Actor{}, command.Principal{Type: "BUSINESS", ID: "business_001"}, map[string]any{}) {
		t.Fatal("empty allowlist must deny")
	}
	// 白名单命中 → 放行
	g3 := NewStaticOperatorGate([]string{"prin_operator_1"})
	if !g3.IsOperator(command.Actor{}, command.Principal{Type: "INDIVIDUAL", ID: "prin_operator_1"}, map[string]any{}) {
		t.Fatal("allowlisted principal must pass")
	}
	// 未命中 → 拒绝
	if g3.IsOperator(command.Actor{}, command.Principal{Type: "INDIVIDUAL", ID: "prin_regular"}, map[string]any{}) {
		t.Fatal("non-allowlisted principal must be denied")
	}
}

// Audit tripwire (Pass 1 — Scene R15.13): the public-read allowlist is
// the single source of truth for "which List* commands can be called
// without authentication". Adding or removing entries here MUST be
// intentional. Pinned by these tests so a careless refactor that
// silently widens public access (or accidentally tightens it and
// breaks anonymous browse) is caught at unit-test time.
func TestRequiresAuthentication_PublicReadAllowlist(t *testing.T) {
	// Auth lifecycle commands — pre-authentication is required to bootstrap
	// a session, so they must remain public.
	authLifecycle := []string{
		"BeginPasswordlessAuthentication",
		"RequestLoginChallenge",
		"VerifyLoginChallenge",
		"CreateSession",
		"CreateAnonymousSession",
		"RequestAccountRecovery",
		"RefreshSession",
	}
	for _, cmd := range authLifecycle {
		if requiresAuthentication(cmd) {
			t.Fatalf("auth-lifecycle command %q must remain public, but requiresAuthentication returned true", cmd)
		}
	}
	// Public-read surface — anonymous browse of the marketplace. Widening
	// this list is a privacy decision, not a refactor; tripwire it.
	publicRead := []string{
		"ListFeedPosts",
		"ListMarketOpportunities",
		"ListActivities",
		"ListStatuses",
		"ListCommunities",
	}
	for _, cmd := range publicRead {
		if requiresAuthentication(cmd) {
			t.Fatalf("public-read command %q must remain public, but requiresAuthentication returned true", cmd)
		}
	}
}

func TestRequiresAuthentication_SceneCommandsAreProtected(t *testing.T) {
	// Scene R15.13: scene lifecycle is per-host and per-invitee. The
	// public-read allowlist must NOT include them or anonymous users
	// could enumerate other users' scenes/invitations.
	sceneCommands := []string{
		"CreateScene",
		"UpdateScene",
		"PublishScene",
		"CreateInvitation",
		"RespondInvitation",
		"RecordAttendance",
		"RecordOutcome",
		"ListMyScenes",
		"ListMyInvitations",
	}
	for _, cmd := range sceneCommands {
		if !requiresAuthentication(cmd) {
			t.Fatalf("scene command %q MUST require authentication (per-host / per-invitee), but requiresAuthentication returned false", cmd)
		}
	}
}

func TestRequiresAuthentication_DefaultIsProtected(t *testing.T) {
	// Anything not on the allowlist defaults to protected. A new
	// domain command is therefore "fail-closed" at the auth gate,
	// which is the intended posture.
	if !requiresAuthentication("CreateTaskDraft") {
		t.Fatal("CreateTaskDraft must require authentication")
	}
	if !requiresAuthentication("DeleteAccount") {
		t.Fatal("DeleteAccount must require authentication")
	}
}

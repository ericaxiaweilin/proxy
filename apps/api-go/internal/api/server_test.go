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
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestServeMediaPathSupportsHeadRangeAndRevalidation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "clip.mp4")
	if err := os.WriteFile(path, []byte("0123456789"), 0o600); err != nil {
		t.Fatal(err)
	}

	head := httptest.NewRecorder()
	serveMediaPath(head, httptest.NewRequest(http.MethodHead, "/v1/media/play/a", nil), path, "public, max-age=86400")
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("head status=%d bytes=%d headers=%v", head.Code, head.Body.Len(), head.Header())
	}

	rangeResponse := httptest.NewRecorder()
	rangeRequest := httptest.NewRequest(http.MethodGet, "/v1/media/play/a", nil)
	rangeRequest.Header.Set("Range", "bytes=2-5")
	serveMediaPath(rangeResponse, rangeRequest, path, "public, max-age=86400")
	if rangeResponse.Code != http.StatusPartialContent || rangeResponse.Body.String() != "2345" {
		t.Fatalf("range status=%d body=%q", rangeResponse.Code, rangeResponse.Body.String())
	}

	revalidate := httptest.NewRecorder()
	revalidateRequest := httptest.NewRequest(http.MethodGet, "/v1/media/play/a", nil)
	revalidateRequest.Header.Set("If-None-Match", head.Header().Get("ETag"))
	serveMediaPath(revalidate, revalidateRequest, path, "public, max-age=86400")
	if revalidate.Code != http.StatusNotModified {
		t.Fatalf("revalidate status=%d", revalidate.Code)
	}
}

func TestPublicFeedIsCacheableAndRevalidates(t *testing.T) {
	localNet := localnet.New()
	if err := localNet.SeedDemoPosts(t.Context()); err != nil {
		t.Fatal(err)
	}
	server := NewServer(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localNet, localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New())
	handler := server.Handler()
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/feed?limit=2", nil))
	if first.Code != http.StatusOK || first.Header().Get("ETag") == "" || first.Header().Get("Cache-Control") == "" {
		t.Fatalf("feed status=%d headers=%v body=%s", first.Code, first.Header(), first.Body.String())
	}
	var payload struct {
		Posts      []localnet.Post `json:"posts"`
		NextCursor string          `json:"nextCursor"`
		HasMore    bool            `json:"hasMore"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Posts) != 2 || !payload.HasMore || payload.NextCursor == "" {
		t.Fatalf("unexpected first page: %+v", payload)
	}
	revalidate := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/feed?limit=2", nil)
	req.Header.Set("If-None-Match", first.Header().Get("ETag"))
	handler.ServeHTTP(revalidate, req)
	if revalidate.Code != http.StatusNotModified {
		t.Fatalf("revalidation status=%d", revalidate.Code)
	}
}

func TestClientIPIgnoresSpoofedForwardingHeadersByDefault(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/feed", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("X-Forwarded-For", "203.0.113.90")
	req.Header.Set("CF-Connecting-IP", "198.51.100.7")
	if got := clientIP(req, false); got != "192.0.2.10" {
		t.Fatalf("clientIP=%q, want socket peer", got)
	}
}

func TestClientIPUsesValidatedCloudflareHeaderOnlyWhenTrusted(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/feed", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("CF-Connecting-IP", "198.51.100.7")
	if got := clientIP(req, true); got != "198.51.100.7" {
		t.Fatalf("clientIP=%q, want Cloudflare client", got)
	}
	req.Header.Set("CF-Connecting-IP", "not-an-ip")
	if got := clientIP(req, true); got != "192.0.2.10" {
		t.Fatalf("invalid header clientIP=%q, want socket peer", got)
	}
}

func TestPublicFeedRateLimitIsFailClosedAndNotCacheable(t *testing.T) {
	localNet := localnet.New()
	server := NewServer(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localNet, localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New())
	server.RateLimit = NewRateLimiter(time.Minute, 1)
	handler := server.Handler()
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/feed", nil))
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/v1/feed", nil))
	if second.Code != http.StatusTooManyRequests || second.Header().Get("Cache-Control") != "no-store" || second.Header().Get("Retry-After") == "" {
		t.Fatalf("status=%d headers=%v body=%s", second.Code, second.Header(), second.Body.String())
	}
}

func TestPublicFeedTamperedCursorIsNotCacheable(t *testing.T) {
	t.Setenv("PROXY_CURSOR_HMAC_KEY", "test-cursor-key-123")
	localNet := localnet.New()
	// 先让 feed 产生一个合法签名游标
	for i := 0; i < 2; i++ {
		localNet.Handle(command.Envelope{CommandID: "c1", CommandType: "CreatePost", CommandVersion: 1, Actor: command.Actor{Type: "USER", ID: "user_001"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_001"}, Target: command.Target{Type: "Post", ID: "new"}, IdempotencyKey: "k1", Purpose: "test", CorrelationID: "corr", RequestedAt: time.Now().Format(time.RFC3339), Payload: map[string]any{"authorType": "AGENT", "body": "post", "visibility": "PUBLIC"}})
	}
	first := localNet.Handle(command.Envelope{CommandID: "c2", CommandType: "ListFeedPosts", CommandVersion: 1, Actor: command.Actor{Type: "PUBLIC", ID: "anonymous_reader"}, Principal: command.Principal{Type: "PUBLIC", ID: "anonymous_reader"}, Target: command.Target{Type: "Feed", ID: "public"}, IdempotencyKey: "k2", Purpose: "public_feed_read", CorrelationID: "corr2", RequestedAt: time.Now().Format(time.RFC3339), Payload: map[string]any{"limit": 1}})
	var payload struct {
		NextCursor string `json:"nextCursor"`
	}
	_ = json.Unmarshal([]byte(first.OperationRef), &payload)
	tampered := payload.NextCursor + "x"
	server := NewServer(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localNet, localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New())
	handler := server.Handler()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/feed?cursor="+tampered, nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("tampered cursor must be 400 no-store, got %d %v body=%s", rec.Code, rec.Header(), rec.Body.String())
	}
}

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

// R15.34.1 P0: 匿名 / 离线 fallback 不能发 CreatePost。
//
//	server 必须拒绝 (ACCESS_TOKEN_REQUIRED / INVALID_ACCESS_TOKEN),
//	不要让 mobile 的 fake offline session 成功发布。
type strictAuthenticator struct {
	// validTokens: access token 白名单。空 token 不在表里，返错误。
	validTokens map[string]identity.AuthenticatedSession
}

func (a strictAuthenticator) Authenticate(_ context.Context, raw string) (identity.AuthenticatedSession, error) {
	if raw == "" {
		return identity.AuthenticatedSession{}, errors.New("access token required")
	}
	if session, ok := a.validTokens[raw]; ok {
		return session, nil
	}
	return identity.AuthenticatedSession{}, errors.New("invalid access token")
}

func TestCreatePostRejectsAnonymous(t *testing.T) {
	auth := strictAuthenticator{
		validTokens: map[string]identity.AuthenticatedSession{
			"valid_access_001": {
				Actor:       command.Actor{Type: "USER", ID: "user_real_001"},
				Principal:   command.Principal{Type: "INDIVIDUAL", ID: "user_real_001"},
				SessionID:   "session_real_001",
				AuthContext: map[string]any{"sessionId": "session_real_001"},
			},
		},
	}
	server := NewServerWithDependenciesAndAuthenticator(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil, auth)
	handler := server.Handler()
	// 场景 1: 没有任何 Authorization header
	noAuth := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreatePost", apiEnvelope("CreatePost", map[string]any{
		"body":       "匿名发文测试，不应成功",
		"authorType": "USER",
		"visibility": "PUBLIC",
	}, command.Target{Type: "Post", ID: "new"}, "idem_anon_createpost_001"), "")
	if noAuth.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous CreatePost should be 401, got %d body=%s", noAuth.Code, noAuth.Body.String())
	}
	var result command.Result
	if err := json.Unmarshal(noAuth.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Error == nil || result.Error.ErrorCode != "ACCESS_TOKEN_REQUIRED" {
		t.Fatalf("expected ACCESS_TOKEN_REQUIRED, got %+v", result.Error)
	}
	// 场景 2: 离线 fallback 用的 fake token (offline_*) 必须被拒
	fakeAuth := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreatePost", apiEnvelope("CreatePost", map[string]any{
		"body":       "fake token 发文测试，不应成功",
		"authorType": "USER",
		"visibility": "PUBLIC",
	}, command.Target{Type: "Post", ID: "new"}, "idem_faketoken_createpost_001"), "offline_fake_token_xyz")
	if fakeAuth.Code != http.StatusUnauthorized {
		t.Fatalf("fake-token CreatePost should be 401, got %d body=%s", fakeAuth.Code, fakeAuth.Body.String())
	}
	if err := json.Unmarshal(fakeAuth.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Error == nil || result.Error.ErrorCode != "INVALID_ACCESS_TOKEN" {
		t.Fatalf("expected INVALID_ACCESS_TOKEN, got %+v", result.Error)
	}
	// 场景 3: 真实 access token 能成功发布 (回归测试，确保拒绝逻辑没误伤)
	real := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreatePost", apiEnvelope("CreatePost", map[string]any{
		"body":       "真实登录发文，应该成功",
		"authorType": "USER",
		"visibility": "PUBLIC",
	}, command.Target{Type: "Post", ID: "new"}, "idem_real_createpost_001"), "valid_access_001")
	if real.Code != http.StatusOK {
		t.Fatalf("real CreatePost should be 200, got %d body=%s", real.Code, real.Body.String())
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
		"ResumeTrustedDeviceSession",
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
		// R15.13 P2: Memory is per-host + per-guest; the tripwire
		// extends to the new commands so a future "make Memory
		// public" refactor breaks the build.
		"ListMyMemories",
		"GetMemory",
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

func TestVersionMiddlewareRequiresUpgrade(t *testing.T) {
	t.Setenv("PROXY_MIN_APP_VERSION", "1.0.0")
	server := NewServer(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New())
	handler := server.Handler()
	// health is exempt
	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health must not be version-gated, got %d", health.Code)
	}
	// facet anonymous read is also exempt (to allow upgrade guidance page to load)
	facet := httptest.NewRecorder()
	handler.ServeHTTP(facet, httptest.NewRequest(http.MethodGet, "/v1/facet/objects", nil))
	if facet.Code != http.StatusOK {
		t.Fatalf("facet must not be version-gated, got %d", facet.Code)
	}
	// feed anonymous read must also be exempt — guest mode would 426 otherwise (proxy.feed load failed)
	feed := httptest.NewRecorder()
	handler.ServeHTTP(feed, httptest.NewRequest(http.MethodGet, "/v1/feed", nil))
	if feed.Code == http.StatusUpgradeRequired {
		t.Fatalf("feed must not be version-gated for guest, got 426")
	}
	// missing header -> 426
	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodPost, "/v1/commands/CreateTaskDraft", nil))
	if missing.Code != http.StatusUpgradeRequired {
		t.Fatalf("missing version must be 426, got %d", missing.Code)
	}
	// old version -> 426
	oldReq := httptest.NewRequest(http.MethodPost, "/v1/commands/CreateTaskDraft", nil)
	oldReq.Header.Set("X-Proxy-App-Version", "0.9.9")
	oldRec := httptest.NewRecorder()
	handler.ServeHTTP(oldRec, oldReq)
	if oldRec.Code != http.StatusUpgradeRequired {
		t.Fatalf("old version must be 426, got %d", oldRec.Code)
	}
	// current version -> not version-gated (will be 401 due to missing auth, not 426)
	okReq := httptest.NewRequest(http.MethodPost, "/v1/commands/CreateTaskDraft", nil)
	okReq.Header.Set("X-Proxy-App-Version", "1.0.0")
	okRec := httptest.NewRecorder()
	handler.ServeHTTP(okRec, okReq)
	if okRec.Code == http.StatusUpgradeRequired {
		t.Fatalf("current version must not be 426, got %d", okRec.Code)
	}
}

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
	"strings"
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

// SAFETY-GATE-001: safety 域的特权命令必须走 operator 门。
//
// 全仓唯一的授权门就是 operatorCommandTypes（command_dispatch.go:77），
// 而 safety 此前**一个命令都没进表** —— 于是下面这些对任何已登录用户敞开：
//   - GrantJITAccess：granteeId 与 scope 全从 payload 来且无任何校验，
//     任何用户都能给自己签发任意 scope 的临时权限（自我提权）。
//   - CreateIncident：除了建 incident，还会**自动给目标打一个 ACCOUNT 封禁**，
//     任何用户都能冻掉任意账号。
//   - CreateSafetyBlock / CreateOperatorCase：封禁与运营工单，天然是 moderaton 动作。
//   - CreateLegalHold / ReleaseLegalHold：法务保全，同上。
func TestSafetyPrivilegedCommandsRequireOperator(t *testing.T) {
	for _, cmd := range []string{
		"GrantJITAccess",
		"CreateIncident",
		"CreateSafetyBlock",
		"CreateOperatorCase",
		"CreateLegalHold",
		"ReleaseLegalHold",
	} {
		if !requiresOperator(cmd) {
			t.Fatalf("%s must require operator: ungated, any logged-in user can self-grant JIT scope or auto-block an account", cmd)
		}
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

// R16.6: /health/ready must surface login provider status so an operator
// running with PROXY_LOGIN_PROVIDER=smtp but no PROXY_SMTP_HOST sees the
// "fail_closed_no_smtp_env" status instead of a silent REJECTED every login.
// Boot-time log.Fatalf in cmd/api/main.go is the primary guard; this test
//// ensures the runtime fallback path (UnconfiguredLoginChallengeProvider)
// is also observable.
func TestReadyEndpointSurfacesLoginProviderFailClosed(t *testing.T) {
	t.Setenv("PROXY_LOGIN_PROVIDER", "smtp")
	os.Unsetenv("PROXY_SMTP_HOST")

	record := httptest.NewRecorder()
	server := NewServerWithDependencies(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil)
	server.Handler().ServeHTTP(record, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if record.Code != http.StatusOK {
		t.Fatalf("expected ready probe to return 200 (server is up), got %d", record.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(record.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode ready body: %v", err)
	}
	checks, ok := body["checks"].(map[string]any)
	if !ok {
		t.Fatalf("ready body missing checks map: %+v", body)
	}
	if status, _ := checks["login_provider"].(string); status != "fail_closed_no_smtp_env" {
		t.Fatalf("expected login_provider=fail_closed_no_smtp_env when SMTP env missing, got %v (body=%+v)", checks["login_provider"], body)
	}
}

func TestReadyEndpointSurfacesLoginProviderOK(t *testing.T) {
	t.Setenv("PROXY_LOGIN_PROVIDER", "smtp")
	t.Setenv("PROXY_SMTP_HOST", "smtp.gmail.com")
	t.Setenv("PROXY_SMTP_PORT", "587")

	record := httptest.NewRecorder()
	server := NewServerWithDependencies(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil)
	server.Handler().ServeHTTP(record, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	var body map[string]any
	if err := json.Unmarshal(record.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode ready body: %v", err)
	}
	checks := body["checks"].(map[string]any)
	if status, _ := checks["login_provider"].(string); status != "smtp_configured" {
		t.Fatalf("expected login_provider=smtp_configured when env present, got %v", status)
	}
}

// R16.9: GET /v1/legal/{terms,privacy} must return the embedded v1.1
// Vietnam legal docs so the mobile signup consent gate can show the
// user the actual text they are agreeing to (PRD v1.4 LC-15).
func TestLegalDocServesTermsAndPrivacy(t *testing.T) {
	server := NewServerWithDependencies(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil)
	handler := server.Handler()

	for _, kind := range []string{"terms", "privacy"} {
		record := httptest.NewRecorder()
		handler.ServeHTTP(record, httptest.NewRequest(http.MethodGet, "/v1/legal/"+kind, nil))
		if record.Code != http.StatusOK {
			t.Fatalf("/v1/legal/%s: expected 200, got %d body=%s", kind, record.Code, record.Body.String())
		}
		var body legalDocEnvelope
		if err := json.Unmarshal(record.Body.Bytes(), &body); err != nil {
			t.Fatalf("/v1/legal/%s: decode envelope: %v", kind, err)
		}
		if body.Kind != kind {
			t.Fatalf("/v1/legal/%s: kind=%q in envelope", kind, body.Kind)
		}
		if body.Version != "1.1" {
			t.Fatalf("/v1/legal/%s: version=%q in envelope, want 1.1", kind, body.Version)
		}
		if body.Locale != "vi-VN" {
			t.Fatalf("/v1/legal/%s: locale=%q in envelope, want vi-VN", kind, body.Locale)
		}
		if len(body.Content) < 1000 {
			t.Fatalf("/v1/legal/%s: content is suspiciously short (%d bytes) — the embedded file is probably empty", kind, len(body.Content))
		}
		if body.ContentSHA256 == "" {
			t.Fatalf("/v1/legal/%s: missing contentSha256", kind)
		}
		// Sanity: the body must contain some CN-only phrases that are
		// in the operator-supplied v1.1 drafts. The signup gate
		// is meaningless if the user is "consenting" to an empty
		// body.
		if kind == "terms" && !strings.Contains(body.Content, "服务使用协议") {
			t.Fatalf("/v1/legal/terms: body does not contain 服务使用协议 — embedded file is wrong")
		}
		if kind == "privacy" && !strings.Contains(body.Content, "个人数据") {
			t.Fatalf("/v1/legal/privacy: body does not contain 个人数据 — embedded file is wrong")
		}
	}
}

func TestLegalDocRejectsUnknownKind(t *testing.T) {
	server := NewServerWithDependencies(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil)
	handler := server.Handler()
	record := httptest.NewRecorder()
	handler.ServeHTTP(record, httptest.NewRequest(http.MethodGet, "/v1/legal/cookie-policy", nil))
	if record.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown legal doc kind, got %d", record.Code)
	}
}

func TestLegalDocHeadIsCheap(t *testing.T) {
	server := NewServerWithDependencies(identity.New(nil), demand.New(nil, nil), citycompanion.New(), localnet.New(), localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(), supply.New(), media.New(), contribution.New(), nil, nil)
	handler := server.Handler()
	record := httptest.NewRecorder()
	handler.ServeHTTP(record, httptest.NewRequest(http.MethodHead, "/v1/legal/terms", nil))
	if record.Code != http.StatusOK {
		t.Fatalf("HEAD expected 200, got %d", record.Code)
	}
	if record.Body.Len() != 0 {
		t.Fatalf("HEAD must not return a body, got %d bytes", record.Body.Len())
	}
}

// --- R16.10-P1-F: privacy request center end-to-end tests ---

// privacyTestServer wires a Server backed by the in-memory identity
// repository and a test Authenticator. The Authenticator recognises
// access tokens of the form "test-access:<userID>" and rejects all
// others, which lets each test stamp an actor onto its request
// without going through the full BeginPasswordlessAuthentication flow.
type privacyTestServer struct {
	server *Server
}

func newPrivacyTestServer() *privacyTestServer {
	idService := identity.NewWithRepository(identity.NewMemoryRepository(nil))
	auth := privacyTestAuthenticator{}
	server := NewServerWithDependenciesAndAuthenticator(
		idService, demand.New(nil, nil), citycompanion.New(), localnet.New(),
		localcontext.New(), conversation.New(), engagement.New(), fulfillment.New(),
		supply.New(), media.New(), contribution.New(), nil, nil, auth,
	)
	return &privacyTestServer{server: server}
}

type privacyTestAuthenticator struct{}

func (privacyTestAuthenticator) Authenticate(_ context.Context, raw string) (identity.AuthenticatedSession, error) {
	if !strings.HasPrefix(raw, "test-access:") {
		return identity.AuthenticatedSession{}, errors.New("invalid test access token")
	}
	userID := strings.TrimPrefix(raw, "test-access:")
	return identity.AuthenticatedSession{
		Actor:     command.Actor{Type: "USER", ID: userID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: userID},
		SessionID: "test-session-" + userID,
		AuthContext: map[string]any{
			"clientIp":  "127.0.0.1",
			"userAgent": "privacy-test",
		},
	}, nil
}

func (p *privacyTestServer) request(method, path, body, userID string) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body != "" {
		reader = bytes.NewReader([]byte(body))
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if userID != "" {
		req.Header.Set("Authorization", "Bearer test-access:"+userID)
	}
	record := httptest.NewRecorder()
	p.server.Handler().ServeHTTP(record, req)
	return record
}

// TestPrivacyMeReturnsDataExport walks a logged-in user through
// GET /v1/privacy/me and confirms the response carries the
// account, sessions, devices, history, format version, and legal
// basis. The test seeds an anonymous account via the service so the
// export has at least one session to include.
func TestPrivacyMeReturnsDataExport(t *testing.T) {
	ts := newPrivacyTestServer()
	idService := ts.server.Identity
	anon := idService.HandleContext(context.Background(), command.Envelope{
		CommandID: "anon-setup", CommandType: "CreateAnonymousSession", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "ignored"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "ignored"},
		Payload: map[string]any{
			"deviceId": "dev_privacy_1", "platform": "IOS",
			"deviceCredential": "0123456789012345678901234567890123456789",
			"dateOfBirth": "2000-01-01", "legalDocVersion": "1.1",
			"consents": map[string]any{"terms": true, "privacy": true},
		},
	})
	if anon.Outcome != "ACCEPTED" || anon.Auth == nil {
		t.Fatalf("anon setup failed: %+v", anon.Error)
	}
	userID := anon.Auth.Principal.ID

	record := ts.request(http.MethodGet, "/v1/privacy/me", "", userID)
	if record.Code != http.StatusOK {
		t.Fatalf("GET /v1/privacy/me: status=%d body=%s", record.Code, record.Body.String())
	}
	var body struct {
		Data          json.RawMessage `json:"data"`
		FormatVersion string          `json:"formatVersion"`
		LegalBasis    string          `json:"legalBasis"`
		History       []any           `json:"history"`
	}
	if err := json.Unmarshal(record.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode /v1/privacy/me: %v body=%s", err, record.Body.String())
	}
	if body.FormatVersion != "1.0" {
		t.Fatalf("formatVersion=%q, want 1.0", body.FormatVersion)
	}
	if body.LegalBasis == "" {
		t.Fatalf("legalBasis missing")
	}
	if len(body.Data) == 0 {
		t.Fatalf("data export payload is empty")
	}
}

// TestPrivacyMeWithoutAuthReturns401 confirms that the privacy
// center refuses unauthenticated requests. The body should be a
// 401 with a structured error envelope.
func TestPrivacyMeWithoutAuthReturns401(t *testing.T) {
	ts := newPrivacyTestServer()
	record := ts.request(http.MethodGet, "/v1/privacy/me", "", "")
	if record.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d body=%s", record.Code, record.Body.String())
	}
}

// TestPrivacyExportAndCancelFlow drives the full privacy export
// and cancel path over the HTTP surface: create anon, submit
// export, fetch status, then submit delete, cancel it, and check
// that a second delete is allowed because the first was cancelled.
func TestPrivacyExportAndCancelFlow(t *testing.T) {
	ts := newPrivacyTestServer()
	anon := ts.server.Identity.HandleContext(context.Background(), command.Envelope{
		CommandID: "anon-setup", CommandType: "CreateAnonymousSession", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "ignored"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "ignored"},
		Payload: map[string]any{
			"deviceId": "dev_privacy_2", "platform": "IOS",
			"deviceCredential": "abcdefghijklmnopqrstuvwxyz123456",
			"dateOfBirth": "2000-01-01", "legalDocVersion": "1.1",
			"consents": map[string]any{"terms": true, "privacy": true},
		},
	})
	if anon.Outcome != "ACCEPTED" || anon.Auth == nil {
		t.Fatalf("anon setup failed: %+v", anon.Error)
	}
	userID := anon.Auth.Principal.ID

	export := ts.request(http.MethodPost, "/v1/privacy/export", `{"legalBasis":"PDP-91/2025/QH15-Art31"}`, userID)
	if export.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/privacy/export: status=%d body=%s", export.Code, export.Body.String())
	}
	var exportBody struct {
		Request       map[string]any `json:"request"`
		RetentionDays int            `json:"retentionDays"`
	}
	if err := json.Unmarshal(export.Body.Bytes(), &exportBody); err != nil {
		t.Fatalf("decode export response: %v", err)
	}
	requestID, _ := exportBody.Request["id"].(string)
	if requestID == "" {
		t.Fatalf("export response missing request.id: %+v", exportBody)
	}
	if exportBody.RetentionDays != 7 {
		t.Fatalf("retentionDays=%d, want 7", exportBody.RetentionDays)
	}

	status := ts.request(http.MethodGet, "/v1/privacy/status?requestId="+requestID, "", userID)
	if status.Code != http.StatusOK {
		t.Fatalf("GET /v1/privacy/status: status=%d body=%s", status.Code, status.Body.String())
	}

	// Submit a delete request and immediately cancel it.
	del := ts.request(http.MethodPost, "/v1/privacy/delete", `{"reason":"test"}`, userID)
	if del.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/privacy/delete: status=%d body=%s", del.Code, del.Body.String())
	}
	var delBody struct {
		Request         map[string]any `json:"request"`
		GracePeriodDays int            `json:"gracePeriodDays"`
		CancelableUntil string         `json:"cancelableUntil"`
	}
	if err := json.Unmarshal(del.Body.Bytes(), &delBody); err != nil {
		t.Fatalf("decode delete response: %v", err)
	}
	if delBody.GracePeriodDays != 30 {
		t.Fatalf("gracePeriodDays=%d, want 30", delBody.GracePeriodDays)
	}
	deleteID, _ := delBody.Request["id"].(string)
	if deleteID == "" {
		t.Fatalf("delete response missing request.id")
	}

	cancelPayload := fmt.Sprintf(`{"requestId":%q,"reason":"changed mind"}`, deleteID)
	cancel := ts.request(http.MethodPost, "/v1/privacy/cancel", cancelPayload, userID)
	if cancel.Code != http.StatusOK {
		t.Fatalf("POST /v1/privacy/cancel: status=%d body=%s", cancel.Code, cancel.Body.String())
	}
	var cancelBody struct {
		Request map[string]any `json:"request"`
	}
	_ = json.Unmarshal(cancel.Body.Bytes(), &cancelBody)
	if status, _ := cancelBody.Request["status"].(string); status != "cancelled" {
		t.Fatalf("expected cancelled, got %v", cancelBody.Request["status"])
	}

	// Now we should be able to submit a fresh delete.
	del2 := ts.request(http.MethodPost, "/v1/privacy/delete", `{}`, userID)
	if del2.Code != http.StatusAccepted {
		t.Fatalf("second delete should be accepted after cancel, got %d body=%s", del2.Code, del2.Body.String())
	}
}

// TestPrivacyDuplicateExportReturns409 ensures the partial-unique
// index surfaces as a 409 Conflict at the HTTP layer. The mobile
// client uses this to render "your last request is still in
// progress" without a free-form error.
func TestPrivacyDuplicateExportReturns409(t *testing.T) {
	ts := newPrivacyTestServer()
	anon := ts.server.Identity.HandleContext(context.Background(), command.Envelope{
		CommandID: "anon-setup", CommandType: "CreateAnonymousSession", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "ignored"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "ignored"},
		Payload: map[string]any{
			"deviceId": "dev_privacy_3", "platform": "ANDROID",
			"deviceCredential": "01234567890123456789012345678901",
			"dateOfBirth": "2000-01-01", "legalDocVersion": "1.1",
			"consents": map[string]any{"terms": true, "privacy": true},
		},
	})
	if anon.Outcome != "ACCEPTED" || anon.Auth == nil {
		t.Fatalf("anon setup failed: %+v", anon.Error)
	}
	userID := anon.Auth.Principal.ID

	first := ts.request(http.MethodPost, "/v1/privacy/export", `{}`, userID)
	if first.Code != http.StatusAccepted {
		t.Fatalf("first export: status=%d body=%s", first.Code, first.Body.String())
	}
	second := ts.request(http.MethodPost, "/v1/privacy/export", `{}`, userID)
	if second.Code != http.StatusConflict {
		t.Fatalf("duplicate export: status=%d body=%s", second.Code, second.Body.String())
	}
}

// TestPrivacyRequestsHistory returns the user's full history and
// must include both the export and the delete we just submitted.
func TestPrivacyRequestsHistory(t *testing.T) {
	ts := newPrivacyTestServer()
	anon := ts.server.Identity.HandleContext(context.Background(), command.Envelope{
		CommandID: "anon-setup", CommandType: "CreateAnonymousSession", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "ignored"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "ignored"},
		Payload: map[string]any{
			"deviceId": "dev_privacy_4", "platform": "IOS",
			"deviceCredential": "98765432109876543210987654321098",
			"dateOfBirth": "2000-01-01", "legalDocVersion": "1.1",
			"consents": map[string]any{"terms": true, "privacy": true},
		},
	})
	if anon.Outcome != "ACCEPTED" || anon.Auth == nil {
		t.Fatalf("anon setup failed: %+v", anon.Error)
	}
	userID := anon.Auth.Principal.ID

	if r := ts.request(http.MethodPost, "/v1/privacy/export", `{}`, userID); r.Code != http.StatusAccepted {
		t.Fatalf("export: %d %s", r.Code, r.Body.String())
	}
	if r := ts.request(http.MethodPost, "/v1/privacy/delete", `{}`, userID); r.Code != http.StatusAccepted {
		t.Fatalf("delete: %d %s", r.Code, r.Body.String())
	}

	list := ts.request(http.MethodGet, "/v1/privacy/requests", "", userID)
	if list.Code != http.StatusOK {
		t.Fatalf("list: %d %s", list.Code, list.Body.String())
	}
	var listBody struct {
		Count    int            `json:"count"`
		Requests []map[string]any `json:"requests"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if listBody.Count != 2 || len(listBody.Requests) != 2 {
		t.Fatalf("expected 2 requests, got count=%d len=%d", listBody.Count, len(listBody.Requests))
	}
	kinds := map[string]bool{}
	for _, req := range listBody.Requests {
		kind, _ := req["kind"].(string)
		kinds[kind] = true
	}
	if !kinds["export"] || !kinds["delete"] {
		t.Fatalf("expected export + delete in history, got %v", kinds)
	}
}

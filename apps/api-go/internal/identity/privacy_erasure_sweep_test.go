package identity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
)

// LC-15 (Vietnam PDP 91/2025/QH15 Art. 32) — the erasure executor.
//
// Before this, POST /v1/privacy/delete wrote a 'received' row and
// stopped. Nothing transitioned it, nothing erased anything, and
// apps/mobile/src/components/privacy-settings.tsx promised the user
// "30 天后，你的个人数据将被永久删除". The tests below pin the three
// things that make that promise true: the 24h acknowledgement, the
// 30d erasure, and the fact that the erased account can never
// authenticate again.

// privacySweepService builds a hermetic service whose clock is fixed at
// requestedAt, so every milestone can be reached by passing an explicit
// `now` to the sweep rather than by sleeping.
func privacySweepService(requestedAt time.Time) *Service {
	return NewWithRepositoryAndClockAndChallengeProvider(
		NewMemoryRepository(nil),
		clock.NewFixed(requestedAt),
		testLoginChallengeProvider{},
	)
}

func privacyDeleteRequest(t *testing.T, svc *Service, ctx context.Context, userID string) PrivacyRequest {
	t.Helper()
	result := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "RequestPrivacyDelete", map[string]any{"reason": "erase me"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("delete request failed: %+v", result.Error)
	}
	req, ok := result.Body["privacyRequest"].(PrivacyRequest)
	if !ok {
		t.Fatalf("delete result missing typed privacyRequest: %T", result.Body["privacyRequest"])
	}
	return req
}

// TestPrivacyDeleteErasureExecutorRunsTheFullLifecycle is the primary
// pin. It walks one delete request through every milestone and asserts
// the data is actually gone at the end — not just that a status column
// changed.
func TestPrivacyDeleteErasureExecutorRunsTheFullLifecycle(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	svc := privacySweepService(requestedAt)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_erase_lifecycle", "0123456789012345678901234567890123456789")
	req := privacyDeleteRequest(t, svc, ctx, userID)
	if req.Status != PrivacyRequestStatusReceived {
		t.Fatalf("a fresh delete request must start received, got %s", req.Status)
	}

	// Inside the 24h acknowledgement window nothing is due. If the
	// executor acted here it would be erasing data before the user has
	// had the grace period the app advertises.
	if out, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(time.Hour)); err != nil || len(out) != 0 {
		t.Fatalf("sweep inside the 24h window must be a no-op, got outcomes=%v err=%v", out, err)
	}

	// +25h: acknowledged. Status only — no data may be touched yet.
	out, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(25*time.Hour))
	if err != nil {
		t.Fatalf("sweep at +25h: %v", err)
	}
	if len(out) != 1 || out[0].Action != PrivacySweepAcknowledged {
		t.Fatalf("expected exactly one ACKNOWLEDGED outcome at +25h, got %+v", out)
	}
	if out[0].Erased.Total() != 0 || out[0].Erased.AccountAnonymised {
		t.Fatalf("acknowledgement must not erase anything, got receipt %+v", out[0].Erased)
	}
	mid := privacyRequestByID(t, svc, ctx, userID, req.ID)
	if mid.Status != PrivacyRequestStatusInProgress {
		t.Fatalf("expected in_progress after acknowledgement, got %s", mid.Status)
	}
	if mid.ErasedAt != nil {
		t.Fatalf("erasedAt must stay empty while the grace window is open, got %v", mid.ErasedAt)
	}
	// The account is still fully usable during the grace window — the
	// user must be able to change their mind.
	if user, err := svc.repository.GetUser(ctx, userID); err != nil || user.Status == AccountStatusErased {
		t.Fatalf("account must survive the grace window intact, got status=%q err=%v", user.Status, err)
	}

	// Day 29: still inside the grace window, already in_progress, so
	// there is nothing left to do.
	if out, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(29*24*time.Hour)); err != nil || len(out) != 0 {
		t.Fatalf("sweep on day 29 must be a no-op, got outcomes=%v err=%v", out, err)
	}

	// Day 31: past the grace window. This is the erasure.
	erasedAt := requestedAt.Add(31 * 24 * time.Hour)
	out, err = svc.SweepPrivacyDeletions(ctx, erasedAt)
	if err != nil {
		t.Fatalf("sweep at +31d: %v", err)
	}
	if len(out) != 1 || out[0].Action != PrivacySweepErased {
		t.Fatalf("expected exactly one ERASED outcome at +31d, got %+v", out)
	}
	receipt := out[0].Erased
	// Anti-vacuity: an erasure that reports nothing deleted is the bug
	// this whole file exists to catch. The anonymous fixture owns a
	// device, a session and its token.
	if receipt.Sessions != 1 || receipt.Devices != 1 {
		t.Fatalf("erasure must remove the user's sessions and devices, got %+v", receipt)
	}
	if receipt.Total() == 0 {
		t.Fatalf("erasure reported zero rows removed — the receipt would be a lie: %+v", receipt)
	}
	if !receipt.AccountAnonymised {
		t.Fatalf("erasure must anonymise the account row, got %+v", receipt)
	}

	// The request itself must now be completed with erased_at set: the
	// mobile countdown reads this field.
	done := privacyRequestByID(t, svc, ctx, userID, req.ID)
	if done.Status != PrivacyRequestStatusCompleted {
		t.Fatalf("expected completed after erasure, got %s", done.Status)
	}
	if done.ErasedAt == nil {
		t.Fatalf("completed erasure must stamp erasedAt")
	}
	if done.CompletedAt == nil {
		t.Fatalf("completed erasure must stamp completedAt")
	}

	// The account is anonymised and can never authenticate again. This
	// is the difference between "we marked a row" and "the data is
	// gone": without the canHoldSession exclusion the user could log
	// back in and the erasure would be cosmetic.
	user, err := svc.repository.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("read back user: %v", err)
	}
	if user.Status != AccountStatusErased {
		t.Fatalf("expected account status %s, got %s", AccountStatusErased, user.Status)
	}
	if canHoldSession(user.Status) {
		t.Fatalf("an ERASED account must not be able to hold a session")
	}

	// Idempotent: a second pass finds nothing and reports nothing.
	if out, err := svc.SweepPrivacyDeletions(ctx, erasedAt.Add(24*time.Hour)); err != nil || len(out) != 0 {
		t.Fatalf("a completed request must never be swept again, got outcomes=%v err=%v", out, err)
	}
}

// TestPrivacyDeleteErasureSkipsCancelledRequests makes sure the grace
// period is a real right and not decoration: a user who cancels inside
// the window must keep every byte of their data.
func TestPrivacyDeleteErasureSkipsCancelledRequests(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	svc := privacySweepService(requestedAt)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_erase_cancel", "0123456789012345678901234567890123456789")
	req := privacyDeleteRequest(t, svc, ctx, userID)

	cancelled := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "CancelPrivacyRequest", map[string]any{"requestId": req.ID, "reason": "changed my mind"}))
	if cancelled.Outcome != "ACCEPTED" {
		t.Fatalf("cancel failed: %+v", cancelled.Error)
	}

	// Well past both milestones. The request must stay cancelled and
	// the account must stay untouched.
	out, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(60*24*time.Hour))
	if err != nil {
		t.Fatalf("sweep after cancel: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("a cancelled request must never be erased, got %+v", out)
	}
	after := privacyRequestByID(t, svc, ctx, userID, req.ID)
	if after.Status != PrivacyRequestStatusCancelled {
		t.Fatalf("cancelled request changed status to %s", after.Status)
	}
	if after.ErasedAt != nil {
		t.Fatalf("a cancelled request must never be stamped erasedAt")
	}
	user, err := svc.repository.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("read back user: %v", err)
	}
	if user.Status == AccountStatusErased {
		t.Fatalf("cancelling must leave the account intact, got status %s", user.Status)
	}
}

// TestPrivacyDeleteErasureIgnoresExportRequests guards the kind filter.
// The two request kinds share one table and one status enum; an
// executor that swept by status alone would delete a user's data the
// moment they asked for a copy of it.
func TestPrivacyDeleteErasureIgnoresExportRequests(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	svc := privacySweepService(requestedAt)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_erase_export", "0123456789012345678901234567890123456789")
	result := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "RequestPrivacyExport", map[string]any{}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("export request failed: %+v", result.Error)
	}

	out, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(60*24*time.Hour))
	if err != nil {
		t.Fatalf("sweep with a stale export request: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("export requests must never be swept, got %+v", out)
	}
	user, err := svc.repository.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("read back user: %v", err)
	}
	if user.Status == AccountStatusErased {
		t.Fatalf("an export request must never erase the account, got status %s", user.Status)
	}
}

// TestErasedStatusIsNotSessionCapable pins the enforcement point
// directly, as a table over every status the identity surface writes.
// The value of this test is the negative: if someone adds ERASED to
// canHoldSession to "unbreak" a login, this fails.
func TestErasedStatusIsNotSessionCapable(t *testing.T) {
	for _, status := range []string{"ACTIVE", "ANONYMOUS", "REGISTERED", "VERIFIED", "COMMERCIAL_VERIFIED"} {
		if !canHoldSession(status) {
			t.Errorf("status %s must be able to hold a session", status)
		}
	}
	for _, status := range []string{AccountStatusErased, "SUSPENDED", "BANNED", ""} {
		if canHoldSession(status) {
			t.Errorf("status %q must NOT be able to hold a session", status)
		}
	}
}

// TestErasureInvalidatesOutstandingAccessTokens is what makes "the data is
// gone" mean something to a running client.
//
// Deleting rows is not sufficient on its own. An access token issued before
// the erasure is a bearer credential: if it kept working, the user would still
// be inside an account whose profile, devices and login identifiers no longer
// exist — and canHoldSession would never be consulted, because that gate only
// runs when a NEW session is created.
//
// Authenticate resolves the token hash against identity.session_tokens and then
// the session against identity.sessions, so removing both rows is exactly what
// kills it. If a future refactor adds a token cache, this test is the thing
// that notices.
func TestErasureInvalidatesOutstandingAccessTokens(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	svc := privacySweepService(requestedAt)
	ctx := context.Background()

	signup := svc.HandleContext(ctx, privacyEnvelopeForUser("ignored", "CreateAnonymousSession", map[string]any{
		"deviceId":         "dev_erase_token",
		"platform":         "IOS",
		"deviceCredential": "0123456789012345678901234567890123456789",
		"dateOfBirth":      "2000-01-01",
		"legalDocVersion":  "1.1",
		"consents":         map[string]any{"terms": true, "privacy": true},
	}))
	if signup.Outcome != "ACCEPTED" || signup.Auth == nil {
		t.Fatalf("anon signup failed: %+v", signup.Error)
	}
	userID := signup.Auth.Principal.ID
	accessToken := signup.Auth.AccessToken
	if accessToken == "" {
		t.Fatalf("signup returned no access token, so token invalidation cannot be asserted")
	}
	if _, err := svc.Authenticate(ctx, accessToken); err != nil {
		t.Fatalf("the fresh access token must authenticate before the erasure: %v", err)
	}

	privacyDeleteRequest(t, svc, ctx, userID)
	out, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(31*24*time.Hour))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(out) != 1 || out[0].Action != PrivacySweepErased {
		t.Fatalf("expected the erasure to run, got %+v", out)
	}

	if _, err := svc.Authenticate(ctx, accessToken); err == nil {
		t.Fatalf("an access token issued before the erasure must stop working after it")
	}
}

// TestErasureReceiptReachesTheAuditTrail pins that the erasure is
// auditable, not just performed. An auditor reading privacy_request_events
// must be able to see what was removed and what was kept without
// re-deriving either from the database — which is also what makes
// RetainedOnErasure load-bearing rather than decorative.
func TestErasureReceiptReachesTheAuditTrail(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	svc := privacySweepService(requestedAt)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_erase_audit", "0123456789012345678901234567890123456789")
	req := privacyDeleteRequest(t, svc, ctx, userID)
	if _, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(31*24*time.Hour)); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	repo, ok := svc.repository.(*MemoryRepository)
	if !ok {
		t.Fatalf("expected the memory repository, got %T", svc.repository)
	}
	repo.mu.Lock()
	events := append([]PrivacyRequestEvent(nil), repo.privacyEvents...)
	repo.mu.Unlock()

	var completed *PrivacyRequestEvent
	for i := range events {
		if events[i].RequestID == req.ID && events[i].ToStatus == string(PrivacyRequestStatusCompleted) {
			completed = &events[i]
		}
	}
	if completed == nil {
		t.Fatalf("the erasure must write a completed event, got %+v", events)
	}
	if completed.Actor != "system" {
		t.Errorf("the sweep must attribute the transition to the system, got %q", completed.Actor)
	}
	// The receipt: the counts have to be in the trail, not only in the return value.
	if !strings.Contains(completed.Notes, "sessions=1") || !strings.Contains(completed.Notes, "devices=1") {
		t.Errorf("the completed event must record what was erased, got notes %q", completed.Notes)
	}
	// The exceptions: the promise is "永久删除（法律要求保存的记录除外）", so the
	// "除外" list has to be on the record too.
	if !strings.Contains(completed.Notes, "retained:") || !strings.Contains(completed.Notes, "legal_consent_records") {
		t.Errorf("the completed event must record what was retained and why, got notes %q", completed.Notes)
	}
	// The cross-aggregate half. The memory repository holds no posts,
	// media or push tokens, so every counter here is legitimately zero
	// — but the section itself has to be on the record. An auditor
	// reading one row must be able to see that the display-name scrub
	// ran, and that the request was not silently marked completed by an
	// older build that only erased the identity aggregate.
	if !strings.Contains(completed.Notes, "external:") {
		t.Errorf("the completed event must record the cross-aggregate receipt, got notes %q", completed.Notes)
	}
	// And its boundary — including the one entry that is a limitation
	// rather than a lawful retention. 「头像会被永久删除」 is only honest if
	// the row that says so also says the blob was not purged.
	if !strings.Contains(completed.Notes, "boundary:") || !strings.Contains(completed.Notes, "LIMITATION") {
		t.Errorf("the completed event must disclose the cross-aggregate boundary, got notes %q", completed.Notes)
	}
}

// recordingEraser wraps the memory repository to record the order in
// which the two erasers are invoked. Embedding the pointer promotes
// every Repository method, so the service still sees a Repository.
type recordingEraser struct {
	*MemoryRepository
	calls *[]string
}

func (r recordingEraser) EraseCrossAggregateIdentity(ctx context.Context, userID string) (ErasedCrossAggregate, error) {
	*r.calls = append(*r.calls, "cross")
	return r.MemoryRepository.EraseCrossAggregateIdentity(ctx, userID)
}

func (r recordingEraser) ErasePersonalData(ctx context.Context, userID string) (ErasedPersonalData, error) {
	*r.calls = append(*r.calls, "identity")
	return r.MemoryRepository.ErasePersonalData(ctx, userID)
}

// TestSweepErasesCrossAggregateBeforeIdentity pins the ordering that
// makes the avatar reachable at all.
//
// The avatar asset is identifiable only through
// identity.profiles.avatar_path, so the identity erasure must not run
// first. The consequence is demonstrated against a real database by
// TestAvatarUnservingRequiresTheProfileRowToStillExist; what this test
// adds is that the *service* is the thing enforcing it, so a later
// refactor that reorders the two calls fails here rather than quietly
// reintroducing a permanently public avatar.
func TestSweepErasesCrossAggregateBeforeIdentity(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	var calls []string
	repo := recordingEraser{MemoryRepository: NewMemoryRepository(nil), calls: &calls}
	svc := NewWithRepositoryAndClockAndChallengeProvider(repo, clock.NewFixed(requestedAt), testLoginChallengeProvider{})
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_erase_order", "0123456789012345678901234567890123456789")
	privacyDeleteRequest(t, svc, ctx, userID)

	if _, err := svc.SweepPrivacyDeletions(ctx, requestedAt.Add(31*24*time.Hour)); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(calls) != 2 || calls[0] != "cross" || calls[1] != "identity" {
		t.Fatalf("expected the cross-aggregate erasure to run before the identity erasure, got %v", calls)
	}
}

// TestSweepRefusesToEraseWithoutACrossAggregateEraser is the mirror of
// the identity-side guard. A deployment whose repository cannot scrub
// the display names must refuse to sweep: marking the request completed
// anyway would leave the user's name on their posts while the app says
// their data is gone.
func TestSweepRefusesToEraseWithoutACrossAggregateEraser(t *testing.T) {
	requestedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	memory := NewMemoryRepository(nil)
	// Seed the due request directly instead of through the signup path.
	// The signup path needs optional repository interfaces (session
	// tokens among them) that identityOnlyEraser deliberately does not
	// carry, and the subject of this test is the guard, not signup.
	requestID := "preq_no_cross"
	memory.privacyRequests[requestID] = PrivacyRequest{
		ID:          requestID,
		UserID:      "user_no_cross",
		Kind:        PrivacyRequestKindDelete,
		Status:      PrivacyRequestStatusReceived,
		RequestedAt: requestedAt,
		Version:     1,
	}
	svc := NewWithRepositoryAndClockAndChallengeProvider(
		identityOnlyEraser{Repository: memory, PrivacyRequestRepository: memory},
		clock.NewFixed(requestedAt),
		testLoginChallengeProvider{},
	)

	_, err := svc.SweepPrivacyDeletions(context.Background(), requestedAt.Add(31*24*time.Hour))
	if err == nil {
		t.Fatalf("a repository that cannot erase cross-aggregate data must not be allowed to sweep")
	}
	if !errors.Is(err, ErrCrossAggregateEraserUnavailable) {
		t.Fatalf("expected ErrCrossAggregateEraserUnavailable, got %v", err)
	}
	// The refusal has to come before anything is erased, not after: a
	// sweep that half-erased and then complained would be worse than one
	// that did nothing.
	if n := len(memory.privacyEvents); n != 0 {
		t.Errorf("a refused sweep must not bookkeep anything, got %d event(s)", n)
	}
	if got := memory.privacyRequests[requestID]; got.Status != PrivacyRequestStatusReceived {
		t.Errorf("a refused sweep must leave the request untouched, got status %s", got.Status)
	}
}

// identityOnlyEraser implements every interface the sweep needs except
// CrossAggregateEraser: it stands in for a deployment built before the
// cross-aggregate half existed.
//
// It embeds interfaces rather than *MemoryRepository on purpose.
// Embedding the concrete type would promote
// EraseCrossAggregateIdentity as well and the type would satisfy the
// very interface this test needs it to be missing. The embedded set is
// exactly what advancePrivacyDeletion reaches for — PrivacyRequestRepository
// (else the sweep returns before the guard, and the test would pass for
// the wrong reason) and PersonalDataEraser.
type identityOnlyEraser struct {
	Repository
	PrivacyRequestRepository
}

func (r identityOnlyEraser) ErasePersonalData(ctx context.Context, userID string) (ErasedPersonalData, error) {
	return r.Repository.(PersonalDataEraser).ErasePersonalData(ctx, userID)
}

func privacyRequestByID(t *testing.T, svc *Service, ctx context.Context, userID, requestID string) PrivacyRequest {
	t.Helper()
	result := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "GetPrivacyRequestStatus", map[string]any{"requestId": requestID}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("status query failed: %+v", result.Error)
	}
	req, ok := result.Body["privacyRequest"].(PrivacyRequest)
	if !ok {
		t.Fatalf("status result missing typed privacyRequest: %T", result.Body["privacyRequest"])
	}
	return req
}

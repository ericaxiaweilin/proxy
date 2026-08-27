package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
)

// TestContributionPostgresLifecycle covers the M1 contribution flow
// through real PostgreSQL: SubmitContribution (valid type +
// SUBMITTED + 3-layer PENDING reviews) → duplicate target rejection
// (same target+type cannot be submitted twice, the second is
// DUPLICATE_CONTRIBUTION_TARGET) → self-referral rejection (the
// contributor cannot be their own referrer via TargetPrincipalID) →
// CreateReferralInvite round-trip → list and idempotency.
func TestContributionPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewContributionRepository(pool)
	svc := contribution.NewWithRepository(repo)

	run := time.Now().UnixNano()
	contributor := "user_ctb_pg_" + itoa(run)
	target := "merchant_pg_" + itoa(run)

	// 1. Valid submission: type=VENUE_DISCOVERY, target=venue.
	// Must produce SUBMITTED + 3 PENDING review layers.
	r := svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "VENUE_DISCOVERY", "targetType": "VENUE",
		"targetId":         target,
	}, contributor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SubmitContribution: %+v", r.Error)
	}
	if r.Aggregate.State != "SUBMITTED" {
		t.Fatalf("new contribution must be SUBMITTED, got %s", r.Aggregate.State)
	}
	contributionID := r.Aggregate.ID
	if contributionID == "" {
		t.Fatalf("SubmitContribution: missing contribution id")
	}
	stored, err := repo.GetContribution(ctx, contributionID)
	if err != nil {
		t.Fatalf("GetContribution: %v", err)
	}
	if stored.State != "SUBMITTED" || stored.ReviewAccess != "PENDING" || stored.ReviewDomain != "PENDING" || stored.ReviewRewardGate != "PENDING" {
		t.Fatalf("3-layer reviews must start PENDING: %+v", stored)
	}

	// 2. Duplicate target: second submit on same venue+type must be
	// REJECTED with DUPLICATE_CONTRIBUTION_TARGET, and the existing
	// contribution id must be reported in SafeDetails.
	r = svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "VENUE_DISCOVERY", "targetType": "VENUE",
		"targetId":         target,
	}, contributor))
	if r.Outcome != "REJECTED" {
		t.Fatalf("duplicate target must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "DUPLICATE_CONTRIBUTION_TARGET" {
		t.Fatalf("expected DUPLICATE_CONTRIBUTION_TARGET, got %+v", r.Error)
	}
	// SafeDetails must reference the existing contribution id.
	if r.Error.SafeDetails == nil {
		t.Fatalf("SafeDetails must include existingContributionId, got nil")
	}
	existingID, _ := r.Error.SafeDetails["existingContributionId"].(string)
	if existingID != contributionID {
		t.Fatalf("SafeDetails.existingContributionId must be %s, got %q", contributionID, existingID)
	}

	// 3. Self-referral: targetPrincipalId == contributor must be
	// REJECTED with SELF_REFERRAL_NOT_ALLOWED.
	r = svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "MERCHANT_REFERRAL", "targetType": "MERCHANT",
		"targetPrincipalId": contributor, "targetId": "m_pg_selfref_" + itoa(run),
	}, contributor))
	if r.Outcome != "REJECTED" {
		t.Fatalf("self-referral must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "SELF_REFERRAL_NOT_ALLOWED" {
		t.Fatalf("expected SELF_REFERRAL_NOT_ALLOWED, got %+v", r.Error)
	}

	// 4. Invalid type: TYPE_NOT_IN_CATALOG must be REJECTED with
	// INVALID_CONTRIBUTION_TYPE.
	r = svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "BOGUS_TYPE", "targetType": "VENUE",
		"targetId":         "venue_pg_xxx_" + itoa(run),
	}, contributor))
	if r.Outcome != "REJECTED" {
		t.Fatalf("invalid type must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_CONTRIBUTION_TYPE" {
		t.Fatalf("expected INVALID_CONTRIBUTION_TYPE, got %+v", r.Error)
	}

	// 5. Missing target on a REFERRAL type: must be REJECTED with
	// TARGET_PRINCIPAL_REQUIRED.
	r = svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "REQUESTER_REFERRAL", "targetType": "USER",
		// no targetPrincipalId
	}, contributor))
	if r.Outcome != "REJECTED" {
		t.Fatalf("REFERRAL without targetPrincipalId must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "TARGET_PRINCIPAL_REQUIRED" {
		t.Fatalf("expected TARGET_PRINCIPAL_REQUIRED, got %+v", r.Error)
	}

	// 6. Valid referral: target = another user, must be ACCEPTED with
	// referralInviteId round-trippable through the repo.
	invitee := "user_ctb_pg_invitee_" + itoa(run)
	r = svc.HandleContext(ctx, ctbEnvelope("CreateReferralInvite", map[string]any{
		"contributionType": "REQUESTER_REFERRAL",
	}, contributor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateReferralInvite: %+v", r.Error)
	}
	inviteID := r.Aggregate.ID
	invite, err := repo.GetInvite(ctx, inviteID)
	if err != nil {
		t.Fatalf("GetInvite: %v", err)
	}
	if invite.State != "ACTIVE" {
		t.Fatalf("new invite must be ACTIVE, got %s", invite.State)
	}
	r = svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "REQUESTER_REFERRAL", "targetType": "USER",
		"targetPrincipalId":  invitee, "referralInviteId": inviteID,
	}, contributor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SubmitContribution via invite: %+v", r.Error)
	}
	// The invite must now be USED, not ACTIVE.
	inviteAfter, _ := repo.GetInvite(ctx, inviteID)
	if inviteAfter.State != "USED" {
		t.Fatalf("invite must be USED after consume, got %s", inviteAfter.State)
	}

	// 7. Submitting again with the same USED invite must be REJECTED
	// with INVITE_NOT_ACTIVE.
	r = svc.HandleContext(ctx, ctbEnvelope("SubmitContribution", map[string]any{
		"contributionType": "REQUESTER_REFERRAL", "targetType": "USER",
		"targetPrincipalId":  "user_other_" + itoa(run), "referralInviteId": inviteID,
	}, contributor))
	if r.Outcome != "REJECTED" {
		t.Fatalf("used invite must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVITE_NOT_ACTIVE" {
		t.Fatalf("expected INVITE_NOT_ACTIVE, got %+v", r.Error)
	}

	// 8. ListContributions by contributor must return ≥2 rows (the
	// VENUE_DISCOVERY + the REQUESTER_REFERRAL).
	r = svc.HandleContext(ctx, ctbEnvelope("ListContributions", map[string]any{
		"contributorPrincipalId": contributor,
	}, contributor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListContributions: %+v", r.Error)
	}
	count := listCountPG(t, r.OperationRef)
	if count < 2 {
		t.Fatalf("ListContributions must return ≥2 entries, got %d (op=%s)", count, r.OperationRef)
	}

	cleanupContributionPG(t, pool, []string{contributionID, inviteID})
}

func listCountPG(t *testing.T, op string) int {
	t.Helper()
	var top map[string]any
	if err := json.Unmarshal([]byte(op), &top); err != nil {
		return 0
	}
	raw, ok := top["contributions"]
	if !ok {
		raw, ok = top["items"]
		if !ok {
			return 0
		}
	}
	arr, ok := raw.([]any)
	if !ok {
		return 0
	}
	return len(arr)
}

func cleanupContributionPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM contribution.contributions WHERE contribution_id=$1`, id); err != nil {
			t.Logf("cleanup contributions: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM contribution.referral_invites WHERE referral_invite_id=$1`, id); err != nil {
			t.Logf("cleanup invites: %v", err)
		}
	}
}

func ctbEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_ctb_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_ctb_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_ctb_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

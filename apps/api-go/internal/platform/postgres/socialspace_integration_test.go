package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/socialspace"
)

// TestSocialSpacePostgresRoundTrip exercises the M7 social-space domain
// against real PostgreSQL: status create + active-status window + community
// listing + membership toggle + cross-actor membership isolation.
func TestSocialSpacePostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSocialSpaceRepository(pool)
	svc := socialspace.NewWithRepository(repo)

	run := time.Now().UnixNano()
	actorA := "user_ss_pg_A_" + itoa(run)
	actorB := "user_ss_pg_B_" + itoa(run)

	// 1. Create a status for actor A. ExpiryHours must be 24 or 48 (the
	// service rejects anything else, mirroring the mobile Compose form).
	r := svc.HandleContext(ctx, ssEnvelope("CreateStatus", map[string]any{
		"body": "早上好 — anyone up for coffee near West Lake?",
		"location": "Hanoi · Tay Ho",
		"expiryHours": 24,
		"authorDisplayName": "An",
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateStatus: %+v", r.Error)
	}
	statusA := readStringSS(r.OperationRef, "status", "id")
	if statusA == "" {
		t.Fatalf("CreateStatus: missing status.id in payload, op=%s", r.OperationRef)
	}

	// 2. Invalid status (body > 140 runes) must be REJECTED, must NOT
	// leave a row in socialspace.statuses.
	var beforeCount, afterCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM socialspace.statuses WHERE author_id=$1`, actorA).Scan(&beforeCount)
	r = svc.HandleContext(ctx, ssEnvelope("CreateStatus", map[string]any{
		"body": strings.Repeat("a", 200), "expiryHours": 24, "authorDisplayName": "An",
	}, actorA))
	if r.Outcome != "REJECTED" {
		t.Fatalf("oversize status must be REJECTED, got %s", r.Outcome)
	}
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM socialspace.statuses WHERE author_id=$1`, actorA).Scan(&afterCount)
	if afterCount != beforeCount {
		t.Fatalf("rejected status leaked: before=%d after=%d", beforeCount, afterCount)
	}

	// 3. ListActiveStatuses must return our status (window includes NOW).
	r = svc.HandleContext(ctx, ssEnvelope("ListStatuses", map[string]any{}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListStatuses: %+v", r.Error)
	}
	items := readStatuses(r.OperationRef)
	foundA := false
	for _, s := range items {
		if s == statusA {
			foundA = true
		}
	}
	if !foundA {
		t.Fatalf("ListStatuses must include the just-created status, got %d items", len(items))
	}

	// 4. Expired status must NOT appear. Write a status with a past
	// expires_at directly through the repo (the service clock forbids
	// this), then re-list and confirm it is filtered out.
	expired := socialspace.Status{
		ID: "status_pg_exp_" + itoa(run), AuthorID: actorA, AuthorDisplayName: "An",
		Body: "old", Location: "",
		CreatedAt: time.Now().Add(-3 * time.Hour),
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}
	if err := repo.CreateStatus(ctx, expired); err != nil {
		t.Fatalf("seed expired: %v", err)
	}
	r = svc.HandleContext(ctx, ssEnvelope("ListStatuses", map[string]any{}, actorA))
	items = readStatuses(r.OperationRef)
	for _, s := range items {
		if s == expired.ID {
			t.Fatalf("expired status must be filtered out, got id=%s", s)
		}
	}

	// 5. ListCommunities must return the seed set (5 rows from
	// migrations/014_social_space.sql). The Joined flag must reflect
	// per-actor membership state.
	r = svc.HandleContext(ctx, ssEnvelope("ListCommunities", map[string]any{}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListCommunities: %+v", r.Error)
	}
	comms := readCommunities(r.OperationRef)
	if len(comms) < 5 {
		t.Fatalf("seed must provide ≥5 communities, got %d", len(comms))
	}

	// 6. Join "photo" community, re-list, the Joined flag flips to true
	// for actor A but stays false for actor B (cross-actor isolation).
	if err := repo.SetCommunityMembership(ctx, actorA, "photo", true, time.Now().UTC()); err != nil {
		t.Fatalf("SetCommunityMembership A: %v", err)
	}
	r = svc.HandleContext(ctx, ssEnvelope("ListCommunities", map[string]any{}, actorA))
	commsA := readCommunitiesJoined(r.OperationRef)
	if !commsA["photo"] {
		t.Fatalf("actor A joined photo but Joined flag is false")
	}
	r = svc.HandleContext(ctx, ssEnvelope("ListCommunities", map[string]any{}, actorB))
	commsB := readCommunitiesJoined(r.OperationRef)
	if commsB["photo"] {
		t.Fatalf("actor B must NOT inherit actor A's membership")
	}

	// 7. Leave "photo" — flag flips back to false for actor A.
	if err := repo.SetCommunityMembership(ctx, actorA, "photo", false, time.Now().UTC()); err != nil {
		t.Fatalf("SetCommunityMembership A leave: %v", err)
	}
	r = svc.HandleContext(ctx, ssEnvelope("ListCommunities", map[string]any{}, actorA))
	commsA = readCommunitiesJoined(r.OperationRef)
	if commsA["photo"] {
		t.Fatalf("actor A left photo but Joined flag is still true")
	}

	// 8. SetCommunityMembership for an unknown community_id must fail
	// (the schema has a REFERENCES FK on community_memberships).
	err := repo.SetCommunityMembership(ctx, actorA, "community_does_not_exist_pg", true, time.Now().UTC())
	if err == nil {
		t.Fatalf("SetCommunityMembership on unknown community must error (FK violation)")
	}

	// cleanup
	cleanupSocialSpacePG(t, pool, []any{actorA, actorB, statusA, expired.ID})
}

func cleanupSocialSpacePG(t *testing.T, pool *pgxpool.Pool, ids []any) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM socialspace.statuses WHERE status_id = ANY($1)`, []string{ids[2].(string), ids[3].(string)}); err != nil {
		t.Logf("cleanup statuses: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM socialspace.community_memberships WHERE actor_id = ANY($1)`, []string{ids[0].(string), ids[1].(string)}); err != nil {
		t.Logf("cleanup memberships: %v", err)
	}
}

func ssEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_ss_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "SocialSpace", ID: actorID},
		IdempotencyKey: "test_ss_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_ss_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

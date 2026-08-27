package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/scene"
)

// TestScenePostgresLifecycle covers the R15.13 Scene Value Exchange
// aggregates end-to-end through real PostgreSQL: Scene create +
// publish + benefit create + checkins (host + guest) + memory
// upsert + memory role isolation across two users + version
// conflict on stale Update. The service runs against the in-memory
// repository for unit tests; this integration test pins the
// production wire path through pgxpool.
func TestScenePostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSceneRepository(pool)

	run := time.Now().UnixNano()
	hostID := "user_scene_pg_host_" + itoa(run)
	guestID := "user_scene_pg_guest_" + itoa(run)
	sceneID := "scene_pg_" + itoa(run)

	// 1. Create a Scene. The Scene struct fields exercise every
	// R15.13 P1 column: funding_mode, budget_minor, currency,
	// aesthetic_score, price_corridor, plus the P0 anchor/benefits
	// JSONB columns.
	now := time.Now().UTC()
	starts := now.Add(48 * time.Hour)
	corridor := map[string]any{"low": int64(40000), "target": int64(55000), "high": int64(80000), "currency": "VND"}
	anchor := map[string]any{"type": "VENUE", "id": "aster_rooftop", "label": "Aster Rooftop"}
	benefits := []map[string]any{{"kind": "FREE_DRINK", "label": "Welcome drink"}}
	want := scene.Scene{
		ID: sceneID, Tool: "PHOTO", Title: "PG rooftop test", Intent: "PG rooftop test",
		Anchor: anchor, Participation: "OPEN_SIGNUP", Cost: "HOST_SPONSORED",
		FundingMode: "HOST", BudgetMinor: 60000, Currency: "VND",
		Benefits: benefits, VenueID: "aster_rooftop",
		StartsAt: starts, HostUserID: hostID, CityScope: "HN",
		AestheticScore: 0.92, PriceCorridor: corridor,
		Status: "DRAFT", Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.Create(ctx, want); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// 2. Get round-trip — JSONB columns must deserialize back to maps.
	got, err := repo.Get(ctx, sceneID)
	if err != nil { t.Fatalf("Get: %v", err) }
	if got.FundingMode != "HOST" || got.BudgetMinor != 60000 || got.Currency != "VND" {
		t.Fatalf("R15.13 P1 fields not round-tripped: %+v", got)
	}
	if got.AestheticScore != 0.92 {
		t.Fatalf("aesthetic_score round-trip failed: %v", got.AestheticScore)
	}
	// PG JSONB deserialises whole numbers as int / float64 depending
	// on driver settings; accept any numeric form here. The service
	// treats the value as a generic any so this is purely a wire-
	// format normalisation at the JSONB boundary.
	if v, ok := got.PriceCorridor["target"].(float64); !ok || v != 55000 {
		t.Fatalf("price_corridor round-trip failed: %v (target type %T)", got.PriceCorridor, got.PriceCorridor["target"])
	}
	if got.Anchor["id"] != "aster_rooftop" {
		t.Fatalf("anchor round-trip failed: %v", got.Anchor)
	}
	if len(got.Benefits) != 1 || got.Benefits[0]["kind"] != "FREE_DRINK" {
		t.Fatalf("benefits round-trip failed: %v", got.Benefits)
	}

	// 3. Get on missing scene returns ErrNotFound.
	if _, err := repo.Get(ctx, "scene_does_not_exist"); !errors.Is(err, scene.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on missing, got %v", err)
	}

	// 4. Update with correct version succeeds; version moves to 2.
	got.Title = "PG rooftop test (renamed)"
	got.Version = 2
	got.UpdatedAt = time.Now().UTC()
	if err := repo.Update(ctx, got, 1); err != nil {
		t.Fatalf("Update with version 1 should succeed, got %v", err)
	}
	got2, _ := repo.Get(ctx, sceneID)
	if got2.Title != "PG rooftop test (renamed)" || got2.Version != 2 {
		t.Fatalf("Update did not persist rename/version: %+v", got2)
	}

	// 5. Update with stale version returns ErrVersionConflict (not ErrNotFound).
	got2.Title = "stale write"
	if err := repo.Update(ctx, got2, 1); !errors.Is(err, scene.ErrVersionConflict) {
		t.Fatalf("expected ErrVersionConflict, got %v", err)
	}

	// 6. Update on missing scene returns ErrNotFound.
	missing := got2
	missing.ID = "scene_does_not_exist"
	missing.Version = 1
	if err := repo.Update(ctx, missing, 0); !errors.Is(err, scene.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on missing update, got %v", err)
	}

	// 7. ListByHost returns the scene in updated_at DESC order.
	list, err := repo.ListByHost(ctx, hostID, 0)
	if err != nil { t.Fatalf("ListByHost limit<=0: %v", err) }
	if len(list) != 0 { t.Fatalf("ListByHost limit<=0 must return empty, got %d", len(list)) }
	list, err = repo.ListByHost(ctx, hostID, 10)
	if err != nil { t.Fatalf("ListByHost: %v", err) }
	if len(list) != 1 || list[0].ID != sceneID {
		t.Fatalf("ListByHost missing the scene: %+v", list)
	}

	// 8. Create a Benefit for the scene; GetBenefit round-trip;
	// UpdateBenefit must transition LOCKED → ACTIVE.
	if err := repo.CreateBenefit(ctx, scene.Benefit{
		ID: "ben_pg_" + itoa(run), SceneID: sceneID, Type: "PHOTO_BOOTH", Status: "LOCKED", CreatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("CreateBenefit: %v", err)
	}
	ben, err := repo.GetBenefit(ctx, sceneID)
	if err != nil { t.Fatalf("GetBenefit: %v", err) }
	if ben.Status != "LOCKED" || ben.Type != "PHOTO_BOOTH" {
		t.Fatalf("GetBenefit shape wrong: %+v", ben)
	}
	ben.Status = "ACTIVE"
	if err := repo.UpdateBenefit(ctx, ben); err != nil {
		t.Fatalf("UpdateBenefit: %v", err)
	}
	ben2, _ := repo.GetBenefit(ctx, sceneID)
	if ben2.Status != "ACTIVE" {
		t.Fatalf("UpdateBenefit did not persist status: %+v", ben2)
	}
	// 8b. Second CreateBenefit for the same scene must fail (v1 = one per scene).
	if err := repo.CreateBenefit(ctx, scene.Benefit{
		ID: "ben_pg_dup", SceneID: sceneID, Type: "CASH", Status: "LOCKED", CreatedAt: time.Now(),
	}); err == nil {
		t.Fatal("expected duplicate-benefit rejection, got nil")
	}
	// 8c. GetBenefit on missing scene returns ErrNotFound.
	if _, err := repo.GetBenefit(ctx, "scene_no_benefit"); !errors.Is(err, scene.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on missing benefit, got %v", err)
	}

	// 9. Checkins: host + guest. ListCheckins must return both.
	if err := repo.CreateCheckin(ctx, scene.Checkin{SceneID: sceneID, UserID: hostID, Role: "HOST", At: time.Now()}); err != nil {
		t.Fatalf("CreateCheckin host: %v", err)
	}
	if err := repo.CreateCheckin(ctx, scene.Checkin{SceneID: sceneID, UserID: guestID, Role: "GUEST", At: time.Now()}); err != nil {
		t.Fatalf("CreateCheckin guest: %v", err)
	}
	// 9b. Same user re-checks-in (ON CONFLICT clause) — last write wins.
	if err := repo.CreateCheckin(ctx, scene.Checkin{SceneID: sceneID, UserID: hostID, Role: "HOST", At: time.Now().Add(time.Minute)}); err != nil {
		t.Fatalf("CreateCheckin re-host: %v", err)
	}
	checks, err := repo.ListCheckins(ctx, sceneID)
	if err != nil { t.Fatalf("ListCheckins: %v", err) }
	if len(checks) != 2 {
		t.Fatalf("expected 2 checkins (one per user), got %d", len(checks))
	}
	// 9c. ListCheckins on missing scene returns empty list.
	emptyChecks, _ := repo.ListCheckins(ctx, "scene_no_checkin")
	if len(emptyChecks) != 0 {
		t.Fatalf("expected empty list for missing scene checkins, got %d", len(emptyChecks))
	}

	// 10. UpsertMemory creates the row; GetMemory round-trips.
	mem := scene.Memory{
		SceneID: sceneID, HostID: hostID, GuestID: guestID,
		MerchantID: "aster_rooftop", SceneType: "ROOFTOP_PHOTO",
		FundingMode: "HOST", PlannedBudget: 60000, ActualSpend: 55000,
		Currency: "VND", DurationMin: 90,
		AestheticAssets: []map[string]any{{"recipe": "v1", "dominant": "#5A4B3A"}},
		CreatedAt: time.Now(),
	}
	if err := repo.UpsertMemory(ctx, mem); err != nil {
		t.Fatalf("UpsertMemory: %v", err)
	}
	memBack, err := repo.GetMemory(ctx, sceneID)
	if err != nil { t.Fatalf("GetMemory: %v", err) }
	if memBack.GuestID != guestID || memBack.ActualSpend != 55000 {
		t.Fatalf("GetMemory shape wrong: %+v", memBack)
	}
	if memBack.PlannedBudget == 0 || memBack.Rating <= 0 {
		t.Fatalf("expected derived budget-adherence rating, got %v", memBack.Rating)
	}
	// 10b. UpsertMemory is idempotent on (scene_id) — re-record replaces.
	mem.ActualSpend = 50000
	if err := repo.UpsertMemory(ctx, mem); err != nil {
		t.Fatalf("UpsertMemory (second): %v", err)
	}
	memBack2, _ := repo.GetMemory(ctx, sceneID)
	if memBack2.ActualSpend != 50000 {
		t.Fatalf("UpsertMemory did not replace, got %d", memBack2.ActualSpend)
	}
	// 10c. ListMemoriesByScene returns exactly one (one per scene).
	byScene, _ := repo.ListMemoriesByScene(ctx, sceneID)
	if len(byScene) != 1 {
		t.Fatalf("expected 1 memory per scene after upsert, got %d", len(byScene))
	}
	// 10d. ListMemoriesByUser covers both host and guest views.
	byHost, _ := repo.ListMemoriesByUser(ctx, hostID, 10)
	if len(byHost) != 1 {
		t.Fatalf("expected host to see 1 memory, got %d", len(byHost))
	}
	byGuest, _ := repo.ListMemoriesByUser(ctx, guestID, 10)
	if len(byGuest) != 1 {
		t.Fatalf("expected guest to see 1 memory, got %d", len(byGuest))
	}
	// 10e. limit<=0 returns empty (pin the same contract as in-memory).
	if limZero, _ := repo.ListMemoriesByUser(ctx, hostID, 0); len(limZero) != 0 {
		t.Fatalf("expected limit<=0 empty, got %d", len(limZero))
	}
	// 10f. Stranger sees nothing.
	stranger, _ := repo.ListMemoriesByUser(ctx, "stranger_"+itoa(run), 10)
	if len(stranger) != 0 {
		t.Fatalf("expected stranger to see 0 memories, got %d", len(stranger))
	}

	// 11. GetMemory on missing scene returns ErrNotFound.
	if _, err := repo.GetMemory(ctx, "scene_no_memory"); !errors.Is(err, scene.ErrNotFound) {
		t.Fatalf("expected ErrNotFound on missing memory, got %v", err)
	}
}

// TestScenePostgresServiceDispatch runs the SceneClient-equivalent flow
// through the real PostgreSQL repository: CreateScene → PublishScene →
// RecordAttendance (host + guest) → RecordOutcome → GetMemory. This
// pins the end-to-end service path that the mobile SceneClient hits;
// the in-memory tripwires in scene_test.go pin the per-command
// contract, this integration test pins the persistence.
func TestScenePostgresServiceDispatch(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSceneRepository(pool)
	fixed := clock.NewFixed(time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC))
	svc := scene.NewWithClock(fixed)
	// Swap the in-memory repository for the PG one so the dispatch
	// path actually round-trips through real SQL.
	svc.SetRepositoryForTest(repo)

	run := time.Now().UnixNano()
	hostID := "user_scene_disp_host_" + itoa(run)
	guestID := "user_scene_disp_guest_" + itoa(run)

	// 1. Create a Scene.
	startsAt := "2026-09-05T16:00:00Z"
	created := svc.Handle(command.Envelope{
		CommandID: "cmd_create", CommandType: "CreateScene", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: hostID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: hostID},
		Target: command.Target{Type: "Scene", ID: "new"},
		IdempotencyKey: "idem_create_pg_001", Purpose: "pg-test", CorrelationID: "corr_create",
		RequestedAt: "2026-08-27T12:00:00Z",
		Payload: map[string]any{
			"tool": "PHOTO", "intent": "PG dispatch test",
			"participation": "OPEN_SIGNUP", "cost": "HOST_SPONSORED",
			"startsAt": startsAt, "sceneType": "ROOFTOP_PHOTO", "cityScope": "HN",
			"venueId": "aster_rooftop",
			"anchor": map[string]any{"type": "VENUE", "id": "aster_rooftop", "label": "Aster Rooftop"},
		},
	})
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("CreateScene: %+v", created.Error)
	}
	sceneID := created.Aggregate.ID

	// 2. Publish.
	pub := svc.Handle(command.Envelope{
		CommandID: "cmd_pub", CommandType: "PublishScene", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: hostID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: hostID},
		Target: command.Target{Type: "Scene", ID: sceneID},
		IdempotencyKey: "idem_pub_pg_001", Purpose: "pg-test", CorrelationID: "corr_pub",
		RequestedAt: "2026-08-27T12:00:00Z",
		Payload: map[string]any{"expectedVersion": 1},
	})
	if pub.Outcome != "ACCEPTED" {
		t.Fatalf("PublishScene: %+v", pub.Error)
	}
	if pub.Aggregate.State != "INVITING" {
		t.Fatalf("expected INVITING after publish, got %s", pub.Aggregate.State)
	}

	// 3. Host + guest check-in (so RecordOutcome passes its
	// OUTCOME_CHECKIN_INCOMPLETE gate).
	for _, role := range []struct{ id, role string }{{hostID, "HOST"}, {guestID, "GUEST"}} {
		att := svc.Handle(command.Envelope{
			CommandID: "cmd_att_" + role.role, CommandType: "RecordAttendance", CommandVersion: 1,
			Actor: command.Actor{Type: "USER", ID: role.id},
			Principal: command.Principal{Type: "INDIVIDUAL", ID: role.id},
			Target: command.Target{Type: "Attendance", ID: sceneID},
			IdempotencyKey: "idem_att_pg_" + role.role, Purpose: "pg-test", CorrelationID: "corr_att_" + role.role,
			RequestedAt: "2026-08-27T12:00:00Z",
			Payload: map[string]any{},
		})
		if att.Outcome != "ACCEPTED" {
			t.Fatalf("RecordAttendance %s: %+v", role.role, att.Error)
		}
	}

	// 4. RecordOutcome — must persist a real Memory row in PG.
	out := svc.Handle(command.Envelope{
		CommandID: "cmd_out", CommandType: "RecordOutcome", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: hostID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: hostID},
		Target: command.Target{Type: "Outcome", ID: sceneID},
		IdempotencyKey: "idem_out_pg_001", Purpose: "pg-test", CorrelationID: "corr_out",
		RequestedAt: "2026-08-27T12:00:00Z",
		Payload: map[string]any{
			"guestId": guestID, "actualSpend": int64(50000), "durationMin": 90,
		},
	})
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("RecordOutcome: %+v", out.Error)
	}

	// 5. Verify the memory row is in PG (direct query — proves the
	// upsert ran against real SQL, not the in-memory repo).
	var actualSpend int64
	var dbHostID, dbGuestID string
	err := pool.QueryRow(ctx, `
		SELECT host_id, guest_id, actual_spend
		FROM scene.memories WHERE scene_id = $1`, sceneID).Scan(&dbHostID, &dbGuestID, &actualSpend)
	if err != nil {
		t.Fatalf("expected memory row in PG for scene %s, got %v", sceneID, err)
	}
	if dbHostID != hostID || dbGuestID != guestID || actualSpend != 50000 {
		t.Fatalf("memory row contents wrong: host=%s guest=%s spend=%d", dbHostID, dbGuestID, actualSpend)
	}

	// 6. ListMyMemories via the service — must surface the just-persisted memory.
	list := svc.Handle(command.Envelope{
		CommandID: "cmd_list", CommandType: "ListMyMemories", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: hostID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: hostID},
		Target: command.Target{Type: "MyMemories", ID: "unused"},
		IdempotencyKey: "idem_list_pg_001", Purpose: "pg-test", CorrelationID: "corr_list",
		RequestedAt: "2026-08-27T12:00:00Z",
		Payload: map[string]any{"limit": 10},
	})
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("ListMyMemories: %+v", list.Error)
	}
	if !contains(list.OperationRef, sceneID) {
		t.Fatalf("ListMyMemories should include the just-persisted scene, got %s", list.OperationRef)
	}
}

// contains is a tiny substring helper to keep the assertion above
// free of an extra import.
func contains(haystack, needle string) bool {
	if len(needle) == 0 { return true }
	if len(needle) > len(haystack) { return false }
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle { return true }
	}
	return false
}

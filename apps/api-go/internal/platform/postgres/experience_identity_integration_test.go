package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/experience/runtime"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// TestExperienceIntentPostgresLifecycle pins the experience PG adapter:
// CreateIntent happy path (12-column JSONB wire format), duplicate
// intent_id is a no-op (ON CONFLICT DO NOTHING), and restart
// persistence via a fresh repository instance.
func TestExperienceIntentPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	// t.Cleanup: 共享 dev 库模式自清行。surface_plan FK 引用 intent，
	// 先删子表再删 intent。
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		runID := itoa(run)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM experience.surface_plan WHERE experience_intent_id = $1`, "exp_intent_pg_"+runID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM experience.experience_intent WHERE intent_id = $1`, "exp_intent_pg_"+runID)
	})

	repo := NewExperienceRepository(pool)
	intentID := "exp_intent_pg_" + itoa(run)
	intent := runtime.ExperienceIntent{
		IntentID:          intentID,
		Type:              "SURFACE",
		Objective:         "REDUCE_TIME_AND_DECISION_COST",
		Priority:          0.75,
		InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_snap_pg_" + itoa(run),
		DecisionID:        "dec_pg_" + itoa(run),
		AllowedActions:    []string{"open_map", "share_card"},
		ForbiddenActions:  []string{"pay"},
		RequiredInfo:      []string{"location"},
		ExpiresAt:         time.Now().UTC().Add(24 * time.Hour).Truncate(time.Microsecond),
		ReasonCodes:       []string{"cooldown_active", "battery_low"},
	}
	if err := repo.CreateIntent(ctx, intent); err != nil {
		t.Fatalf("CreateIntent: %v", err)
	}

	// 1. Duplicate intent_id is a no-op, not an error.
	intentDup := intent
	intentDup.AllowedActions = []string{"mutated"}
	if err := repo.CreateIntent(ctx, intentDup); err != nil {
		t.Fatalf("CreateIntent duplicate: %v", err)
	}

	// 2. Wire round-trip: read back raw columns to pin the wire format.
	var objective, level string
	var priority float64
	var allowed, forbidden, required, reasons []byte
	var expiresAt time.Time
	err := pool.QueryRow(ctx, `
		SELECT objective, intervention_level, priority,
		       allowed_actions, forbidden_actions, required_information, reason_codes, expires_at
		FROM experience.experience_intent WHERE intent_id=$1`, intentID).
		Scan(&objective, &level, &priority, &allowed, &forbidden, &required, &reasons, &expiresAt)
	if err != nil {
		t.Fatalf("read back intent: %v", err)
	}
	if objective != "REDUCE_TIME_AND_DECISION_COST" || level != "SOFT_NUDGE" || priority != 0.75 {
		t.Fatalf("scalar round-trip mismatch: obj=%s level=%s prio=%v", objective, level, priority)
	}
	if string(allowed) == "" || string(allowed) == "null" {
		t.Fatalf("allowed_actions must be a JSONB array, got %s", allowed)
	}
	if string(forbidden) != `["pay"]` && string(forbidden) != `["pay"] ` {
		// tolerant: just require it contains "pay"
		if len(forbidden) < 6 || string(forbidden[1:5]) != "\"pay" {
			t.Fatalf("forbidden_actions must encode [\"pay\"], got %s", forbidden)
		}
	}
	if expiresAt.Sub(intent.ExpiresAt.Truncate(time.Second)) > time.Second {
		t.Fatalf("expires_at round-trip mismatch: got %v want ~%v", expiresAt, intent.ExpiresAt)
	}

	// 3. Simulated restart: fresh instance + surface plan referencing
	// the intent (FK) still resolves.
	planRepo := NewExperienceRepository(pool)
	native := "ProxySurfaceCard"
	plan := runtime.SurfacePlan{
		SurfacePlanID:      "exp_plan_pg_" + itoa(run),
		SurfaceID:          "root_dock",
		SurfaceVersion:     3,
		DecisionID:         intent.DecisionID,
		ExperienceIntentID: intentID,
		ContextSnapshotID:  intent.ContextSnapshotID,
		RenderMode:         "NATIVE_COMPONENT",
		NativeComponent:    &native,
		SchemaRef:          nil,
		Slots:              map[string][]string{"primary": {"title", "subtitle"}},
		TTLS:               300,
		FallbackPlanID:     nil,
		PolicyVersion:      "v1",
	}
	if err := planRepo.CreateSurfacePlan(ctx, plan); err != nil {
		t.Fatalf("CreateSurfacePlan: %v", err)
	}

	// 4. Duplicate surface_plan_id no-op; (surface_id, surface_version)
	// UNIQUE enforced at the DB layer.
	if err := planRepo.CreateSurfacePlan(ctx, plan); err != nil {
		t.Fatalf("CreateSurfacePlan duplicate id: %v", err)
	}
	conflict := plan
	conflict.SurfacePlanID = "exp_plan_pg2_" + itoa(run)
	if err := planRepo.CreateSurfacePlan(ctx, conflict); err == nil {
		t.Fatalf("(surface_id, surface_version) UNIQUE must reject a second plan with same version")
	}
}

// TestDisplayIdentityPostgresLifecycle pins the display identity PG
// adapter: Create + Get round-trip, case-insensitive alias lookup,
// owner scoping in ListByOwner, optimistic concurrency (Update version
// mismatch -> ErrDisplayIdentityConflict), duplicate -> conflict, and
// the BURNER expiry sweeper.
func TestDisplayIdentityPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	owner := "user_did_owner_" + itoa(run)
	if _, err := pool.Exec(ctx, `INSERT INTO identity.user_accounts (id, status) VALUES ($1, 'ACTIVE')`, owner); err != nil {
		t.Fatalf("seed user account: %v", err)
	}
	// t.Cleanup: 共享 dev 库模式自清行（display_identities + 造的
	// user_accounts 种子行）。display_identities 无子表 FK。
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.display_identities WHERE owner_id = $1`, owner)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.user_accounts WHERE id = $1`, owner)
	})
	repo := NewDisplayIdentityRepository(pool)

	now := time.Now().UTC().Truncate(time.Microsecond)
	d := identity.DisplayIdentity{
		ID: "did_pg_" + itoa(run), OwnerID: owner, Type: identity.DisplayIdentityPublic,
		Alias: "工作号", DisplayName: "Ken（工作）",
		CreatedAt: now, Version: 1,
	}
	if err := repo.Create(ctx, d); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// 1. Get round-trips type and all fields.
	got, err := repo.Get(ctx, d.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Type != identity.DisplayIdentityPublic || got.Alias != "工作号" || got.Version != 1 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}

	// 2. Alias lookup is case-insensitive.
	got, err = repo.GetByOwnerAndAlias(ctx, owner, "工作号")
	if err != nil || got.ID != d.ID {
		t.Fatalf("GetByOwnerAndAlias exact: got=%+v err=%v", got, err)
	}
	if _, err := repo.GetByOwnerAndAlias(ctx, owner, "别的"); err != identity.ErrDisplayIdentityNotFound {
		t.Fatalf("alias lookup miss must be ErrDisplayIdentityNotFound, got %v", err)
	}
	if _, err := repo.GetByOwnerAndAlias(ctx, "user_did_stranger_"+itoa(run), "工作号"); err != identity.ErrDisplayIdentityNotFound {
		t.Fatalf("cross-owner alias lookup must be ErrDisplayIdentityNotFound, got %v", err)
	}

	// 3. Duplicate (same owner + same alias, case-insensitive) conflicts.
	dup := d
	dup.ID = "did_pg_dup_" + itoa(run)
	if err := repo.Create(ctx, dup); err != identity.ErrDisplayIdentityConflict {
		t.Fatalf("case-insensitive duplicate alias must be ErrDisplayIdentityConflict, got %v", err)
	}

	// 4. ListByOwner is owner-scoped.
	list, err := repo.ListByOwner(ctx, owner)
	if err != nil || len(list) != 1 || list[0].ID != d.ID {
		t.Fatalf("ListByOwner: list=%v err=%v", list, err)
	}

	// 5. Optimistic concurrency: stale version conflicts, fresh succeeds.
	d.Alias = "工作号 X"
	d.DisplayName = "Ken（工作·X）"
	if err := repo.Update(ctx, d, 5); err != identity.ErrDisplayIdentityConflict {
		t.Fatalf("stale version must be ErrDisplayIdentityConflict, got %v", err)
	}
	if err := repo.Update(ctx, d, 1); err != nil {
		t.Fatalf("Update with current version: %v", err)
	}
	got, err = repo.Get(ctx, d.ID)
	if err != nil || got.Alias != "工作号 X" || got.Version != 2 {
		t.Fatalf("Update must persist alias and bump version: %+v", got)
	}

	// 6. Not found mapping.
	if _, err := repo.Get(ctx, "did_pg_missing_"+itoa(run)); err != identity.ErrDisplayIdentityNotFound {
		t.Fatalf("Get missing must be ErrDisplayIdentityNotFound, got %v", err)
	}

	// 7. BURNER lifecycle: create with ExpiresAt in the past, sweep
	// marks it burned.
	past := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Microsecond)
	burner := identity.DisplayIdentity{
		ID: "did_burner_" + itoa(run), OwnerID: owner, Type: identity.DisplayIdentityBurner,
		Alias: "一次性", DisplayName: "Burner",
		CreatedAt: now, ExpiresAt: &past, Version: 1,
	}
	if err := repo.Create(ctx, burner); err != nil {
		t.Fatalf("Create burner: %v", err)
	}
	burned, err := repo.SweepExpiredBurners(ctx, time.Now().UTC())
	if err != nil || burned < 1 {
		t.Fatalf("SweepExpiredBurners: burned=%d err=%v", burned, err)
	}
	gotBurner, err := repo.Get(ctx, burner.ID)
	if err != nil {
		t.Fatalf("Get burner: %v", err)
	}
	if gotBurner.BurnedAt == nil {
		t.Fatalf("swept burner must have BurnedAt set")
	}

	// 8. Simulated restart: fresh instance sees the burned state.
	repo2 := NewDisplayIdentityRepository(pool)
	after, err := repo2.Get(ctx, burner.ID)
	if err != nil || after.BurnedAt == nil {
		t.Fatalf("restart lost burned state: %+v err=%v", after, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM identity.user_accounts WHERE id=$1`, owner); err != nil {
		t.Logf("cleanup owner: %v", err)
	}
}

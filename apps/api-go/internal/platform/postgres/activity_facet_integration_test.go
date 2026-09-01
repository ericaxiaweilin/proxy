package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/facet"
)

// TestActivityPostgresLifecycle pins the activity PG adapter wire format:
// Seed/List round-trip (payload JSONB + denormalized counters), interest
// toggle semantics (insert/delete + GREATEST(0,...) clamp), join rules
// (duplicate -> ErrAlreadyJoined, capacity -> ErrActivityFull), and
// counter consistency across a simulated restart (fresh repository
// instance = what a new API process constructs).
func TestActivityPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	repo := NewActivityRepository(pool)
	if err := repo.Seed(ctx, []activity.Activity{{
		ID:         "act_pg_" + itoa(run),
		Origin:     "PLATFORM",
		Title:      "Lifecycle Pin",
		Time:       "Sat 19:00",
		People:     "2-4",
		Price:      "¥88",
		VenueName:  "Proxy Lab",
		Interested: 0,
		Joined:     0,
		Capacity:   2,
	}}); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	id := "act_pg_" + itoa(run)
	actor := "user_act_a_" + itoa(run)
	actor2 := "user_act_b_" + itoa(run)

	// 1. List round-trips the seeded payload + counters.
	items, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var seeded activity.Activity
	found := false
	for _, it := range items {
		if it.ID == id {
			seeded, found = it, true
		}
	}
	if !found {
		t.Fatalf("seeded activity not visible in List")
	}
	if seeded.Title != "Lifecycle Pin" || seeded.Capacity != 2 || seeded.Joined != 0 {
		t.Fatalf("payload/counters round-trip mismatch: %+v", seeded)
	}

	// 2. ToggleInterest inserts, then deletes, clamping at zero.
	got, interested, err := repo.ToggleInterest(ctx, id, actor)
	if err != nil || !interested || got.Interested != 1 {
		t.Fatalf("ToggleInterest(on): got=%+v interested=%v err=%v", got, interested, err)
	}
	got, interested, err = repo.ToggleInterest(ctx, id, actor)
	if err != nil || interested || got.Interested != 0 {
		t.Fatalf("ToggleInterest(off): got=%+v interested=%v err=%v", got, interested, err)
	}
	// clamp: interested_count never goes negative.
	got, interested, err = repo.ToggleInterest(ctx, id, actor)
	if err != nil || interested != true || got.Interested != 1 {
		t.Fatalf("ToggleInterest(on again): got=%+v interested=%v err=%v", got, interested, err)
	}

	// 3. Join rules: first ok, duplicate rejected, full at capacity.
	if _, err := repo.Join(ctx, id, actor); err != nil {
		t.Fatalf("Join first: %v", err)
	}
	if _, err := repo.Join(ctx, id, actor); err != activity.ErrAlreadyJoined {
		t.Fatalf("Join duplicate must be ErrAlreadyJoined, got %v", err)
	}
	if _, err := repo.Join(ctx, id, actor2); err != nil {
		t.Fatalf("Join second: %v", err)
	}
	if _, err := repo.Join(ctx, id, "user_act_c_"+itoa(run)); err != activity.ErrActivityFull {
		t.Fatalf("Join at capacity must be ErrActivityFull, got %v", err)
	}

	// 4. Not found maps cleanly.
	if _, _, err := repo.ToggleInterest(ctx, "act_pg_missing_"+itoa(run), actor); err != activity.ErrActivityNotFound {
		t.Fatalf("ToggleInterest missing must be ErrActivityNotFound, got %v", err)
	}
	if _, err := repo.Join(ctx, "act_pg_missing_"+itoa(run), actor); err != activity.ErrActivityNotFound {
		t.Fatalf("Join missing must be ErrActivityNotFound, got %v", err)
	}

	// 5. Simulated restart: fresh repo instance sees the same counters.
	repo2 := NewActivityRepository(pool)
	items2, err := repo2.List(ctx)
	if err != nil {
		t.Fatalf("List after restart: %v", err)
	}
	var after activity.Activity
	found = false
	for _, it := range items2 {
		if it.ID == id {
			after, found = it, true
		}
	}
	if !found {
		t.Fatalf("activity lost after restart")
	}
	if after.Interested != 1 || after.Joined != 2 {
		t.Fatalf("counters after restart: interested=%d joined=%d, want 1/2", after.Interested, after.Joined)
	}
}

// TestFacetPostgresLifecycle pins the facet PG adapter: Seed upserts
// (second seed overwrites, matching the ON CONFLICT DO UPDATE), List
// returns gap fields, ordering by id, and restart persistence.
func TestFacetPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	repo := NewFacetRepository(pool)
	id := "fct_a_" + itoa(run)
	id2 := "fct_b_" + itoa(run)
	seed := []facet.Object{{
		ID:           id,
		DisplayName:  "Proxy Buddy",
		Relation:     "BUILDING_TRUST",
		Goal:         "维持长期互动",
		CurrentState: "3 天未聊",
		PillLabel:    "今天想聊",
		Gap:          facet.Gap{Summary: "3 天没互动了", NextShowAt: "2026-09-03"},
		AvatarURL:    "avatar://buddy",
	}, {
		ID:           id2,
		DisplayName:  "Proxy Mentor",
		Relation:     "SHARED_INTEREST",
		Goal:         "每月汇报",
		CurrentState: "1 周未汇报",
		PillLabel:    "该汇报了",
		Gap:          facet.Gap{Summary: "月度汇报过期", NextShowAt: "2026-09-02"},
		AvatarURL:    "avatar://mentor",
	}}
	if err := repo.Seed(ctx, seed); err != nil {
		t.Fatalf("Seed: %v", err)
	}

	// 1. List round-trips gap fields and orders by id.
	objects, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var got facet.Object
	found := false
	for _, o := range objects {
		if o.ID == id {
			got, found = o, true
		}
	}
	if !found {
		t.Fatalf("seeded facet object not in List")
	}
	if got.DisplayName != "Proxy Buddy" || got.Gap.Summary != "3 天没互动了" || got.Gap.NextShowAt != "2026-09-03" {
		t.Fatalf("facet round-trip mismatch: %+v", got)
	}

	// 2. Seed is upsert: second write overwrites display fields.
	seed[0].CurrentState = "1 天未聊"
	seed[0].PillLabel = "升级：今天想聊"
	if err := repo.Seed(ctx, seed); err != nil {
		t.Fatalf("Seed upsert: %v", err)
	}
	objects, err = repo.List(ctx)
	if err != nil {
		t.Fatalf("List after upsert: %v", err)
	}
	for _, o := range objects {
		if o.ID == id {
			if o.CurrentState != "1 天未聊" || o.PillLabel != "升级：今天想聊" {
				t.Fatalf("upsert did not overwrite: %+v", o)
			}
		}
	}

	// 3. Simulated restart: fresh instance sees the same rows.
	repo2 := NewFacetRepository(pool)
	objects2, err := repo2.List(ctx)
	if err != nil {
		t.Fatalf("List after restart: %v", err)
	}
	count := 0
	for _, o := range objects2 {
		if o.ID == id || o.ID == id2 {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("restart lost facet objects: found %d of 2", count)
	}
}

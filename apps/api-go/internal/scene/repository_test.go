package scene

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMemoryRepository_Create_DuplicateID(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	s := Scene{ID: "scene_dup", Tool: "PHOTO", Title: "x", HostUserID: "u1", Status: "DRAFT", Version: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := repo.Create(ctx, s); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if err := repo.Create(ctx, s); err == nil {
		t.Fatal("expected duplicate-create error, got nil")
	}
}

func TestMemoryRepository_Update_VersionConflict(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	s := Scene{ID: "scene_v", Tool: "PHOTO", Title: "x", HostUserID: "u1", Status: "DRAFT", Version: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := repo.Create(ctx, s); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Stale expectedVersion must conflict.
	s.Title = "y"
	if err := repo.Update(ctx, s, 99); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("expected ErrVersionConflict, got %v", err)
	}
	// Correct expectedVersion succeeds.
	if err := repo.Update(ctx, s, 1); err != nil {
		t.Fatalf("expected success at version 1, got %v", err)
	}
	// NotFound
	s2 := Scene{ID: "scene_missing", Version: 1}
	if err := repo.Update(ctx, s2, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestMemoryRepository_ListByHost_LimitBoundaries(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	// 3 owned by user_a, 1 by user_b
	for i := 0; i < 3; i++ {
		_ = repo.Create(ctx, Scene{ID: "a_" + string(rune('0'+i)), HostUserID: "user_a", Title: "x", Version: 1})
	}
	_ = repo.Create(ctx, Scene{ID: "b_0", HostUserID: "user_b", Title: "x", Version: 1})

	// limit=0 returns no rows: a defensive early-return prevents the
	// `len(out) >= 0` always-true loop-break from accidentally
	// returning one row. The service layer is the right place to
	// clamp positive limits (default 10, max 50).
	got, err := repo.ListByHost(ctx, "user_a", 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("limit=0: expected 0 rows, got %d", len(got))
	}
	// Negative limit is also degenerate; same defence.
	got, _ = repo.ListByHost(ctx, "user_a", -3)
	if len(got) != 0 {
		t.Fatalf("limit=-3: expected 0 rows, got %d", len(got))
	}
	// limit=2 returns at most 2 of the 3 owned rows.
	got, _ = repo.ListByHost(ctx, "user_a", 2)
	if len(got) != 2 {
		t.Fatalf("limit=2: expected 2 rows, got %d", len(got))
	}
	// limit=10 returns all 3 owned rows and skips user_b.
	got, _ = repo.ListByHost(ctx, "user_a", 10)
	if len(got) != 3 {
		t.Fatalf("limit=10: expected 3 rows, got %d", len(got))
	}
	for _, s := range got {
		if s.HostUserID != "user_a" {
			t.Fatalf("list leaked a non-user_a row: %#v", s)
		}
	}
}

func TestMemoryRepository_InvitationLifecycle(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	inv := Invitation{ID: "inv_001", SceneID: "scene_x", InviteeID: "user_002", HostID: "user_001", Status: "PENDING", CreatedAt: time.Now()}
	if err := repo.CreateInvitation(ctx, inv); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Duplicate create replaces nothing? current impl is upsert; behaviour
	// is "second Create overwrites" — surface the behaviour so a future
	// refactor that makes it strict-reject is intentional.
	inv2 := inv
	inv2.Status = "ACCEPTED"
	if err := repo.CreateInvitation(ctx, inv2); err != nil {
		t.Fatalf("second create: %v", err)
	}
	got, err := repo.GetInvitation(ctx, "inv_001")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED after second create, got %s", got.Status)
	}
	// Update with a missing id returns ErrNotFound.
	if err := repo.UpdateInvitation(ctx, Invitation{ID: "inv_missing"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on update of missing invitation, got %v", err)
	}
	// List by invitee
	got2, _ := repo.ListInvitationsByInvitee(ctx, "user_002", 10)
	if len(got2) != 1 {
		t.Fatalf("expected 1 invitation for user_002, got %d", len(got2))
	}
	got3, _ := repo.ListInvitationsByInvitee(ctx, "user_nobody", 10)
	if len(got3) != 0 {
		t.Fatalf("expected 0 invitations for unknown invitee, got %d", len(got3))
	}
}

// ── Pass 3 audit closures for the 5 new Repository methods ────────
// The Repository interface was extended (R15.13 P1) with Benefit +
// Checkin storage but the in-memory implementation was incomplete.
// Pin the contract so the PG adapter (when it lands) can be
// verified against the same in-memory behaviour.

func TestMemoryRepository_BenefitLifecycle(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	// Create a scene first so the benefit has a real anchor.
	if err := repo.Create(ctx, Scene{ID: "scene_b1", HostUserID: "u1", Title: "x", Version: 1}); err != nil {
		t.Fatalf("seed scene: %v", err)
	}
	// CreateBenefit happy path.
	if err := repo.CreateBenefit(ctx, Benefit{ID: "ben_001", SceneID: "scene_b1", Type: "DRINK", Status: "LOCKED", CreatedAt: time.Now()}); err != nil {
		t.Fatalf("CreateBenefit: %v", err)
	}
	// GetBenefit round-trip.
	got, err := repo.GetBenefit(ctx, "scene_b1")
	if err != nil { t.Fatalf("GetBenefit: %v", err) }
	if got.ID != "ben_001" || got.Type != "DRINK" {
		t.Fatalf("GetBenefit returned wrong record: %#v", got)
	}
	// Duplicate create is rejected (one benefit per scene in v1).
	if err := repo.CreateBenefit(ctx, Benefit{ID: "ben_002", SceneID: "scene_b1", Type: "CASH", Status: "LOCKED", CreatedAt: time.Now()}); err == nil {
		t.Fatal("expected duplicate-benefit rejection, got nil")
	}
	// UpdateBenefit round-trip.
	got.Status = "UNLOCKED"
	if err := repo.UpdateBenefit(ctx, got); err != nil { t.Fatalf("UpdateBenefit: %v", err) }
	got2, _ := repo.GetBenefit(ctx, "scene_b1")
	if got2.Status != "UNLOCKED" { t.Fatalf("status not updated: %s", got2.Status) }
	// UpdateBenefit on missing scene returns ErrNotFound.
	if err := repo.UpdateBenefit(ctx, Benefit{SceneID: "scene_missing"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on missing scene update, got %v", err)
	}
	// GetBenefit on missing scene returns ErrNotFound.
	if _, err := repo.GetBenefit(ctx, "scene_missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on missing scene get, got %v", err)
	}
}

func TestMemoryRepository_BenefitInputValidation(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	// Empty id rejected.
	if err := repo.CreateBenefit(ctx, Benefit{SceneID: "x", Type: "DRINK"}); err == nil {
		t.Fatal("expected error on empty benefit id")
	}
	// Empty sceneId rejected.
	if err := repo.CreateBenefit(ctx, Benefit{ID: "ben_x", Type: "DRINK"}); err == nil {
		t.Fatal("expected error on empty sceneId")
	}
}

func TestMemoryRepository_CheckinLifecycle(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	// Two checkins on the same scene with different users.
	if err := repo.CreateCheckin(ctx, Checkin{SceneID: "scene_c1", UserID: "u1", Role: "HOST", At: time.Now()}); err != nil {
		t.Fatalf("CreateCheckin host: %v", err)
	}
	if err := repo.CreateCheckin(ctx, Checkin{SceneID: "scene_c1", UserID: "u2", Role: "GUEST", At: time.Now()}); err != nil {
		t.Fatalf("CreateCheckin guest: %v", err)
	}
	// Same user re-checks-in: last write wins (the type system requires
	// this so a re-arrival after a network blip can update timestamp).
	if err := repo.CreateCheckin(ctx, Checkin{SceneID: "scene_c1", UserID: "u1", Role: "HOST", At: time.Now().Add(time.Minute)}); err != nil {
		t.Fatalf("CreateCheckin re-host: %v", err)
	}
	got, err := repo.ListCheckins(ctx, "scene_c1")
	if err != nil { t.Fatalf("ListCheckins: %v", err) }
	if len(got) != 2 {
		t.Fatalf("expected 2 checkins (one per user), got %d", len(got))
	}
	// Missing scene returns empty list (not error).
	empty, _ := repo.ListCheckins(ctx, "scene_no_checkins")
	if len(empty) != 0 {
		t.Fatalf("expected empty list for missing scene, got %d", len(empty))
	}
}

func TestMemoryRepository_CheckinInputValidation(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	// Empty sceneId rejected.
	if err := repo.CreateCheckin(ctx, Checkin{UserID: "u1"}); err == nil {
		t.Fatal("expected error on empty sceneId")
	}
	// Empty userId rejected.
	if err := repo.CreateCheckin(ctx, Checkin{SceneID: "x"}); err == nil {
		t.Fatal("expected error on empty userId")
	}
}

// ── R15.13 P2: Memory repository tripwires ────────────────────────

func TestMemoryRepository_UpsertMemory_RequiresSceneID(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	if err := repo.UpsertMemory(ctx, Memory{HostID: "h", GuestID: "g"}); err == nil {
		t.Fatal("expected error on empty sceneId")
	}
}

func TestMemoryRepository_UpsertMemory_AssignsID(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	if err := repo.UpsertMemory(ctx, Memory{SceneID: "scene_m1", HostID: "h", GuestID: "g"}); err != nil {
		t.Fatalf("UpsertMemory: %v", err)
	}
	got, err := repo.GetMemory(ctx, "scene_m1")
	if err != nil { t.Fatalf("GetMemory: %v", err) }
	if got.ID == "" {
		t.Fatal("expected UpsertMemory to assign an ID, got empty")
	}
	if !strings.HasPrefix(got.ID, "mem_") {
		t.Fatalf("expected ID prefix mem_, got %s", got.ID)
	}
	if got.AestheticAssets == nil {
		t.Fatal("expected AestheticAssets to default to empty slice, got nil")
	}
}

func TestMemoryRepository_UpsertMemory_ReplacesExisting(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	if err := repo.UpsertMemory(ctx, Memory{SceneID: "scene_m1", HostID: "h", GuestID: "g", ActualSpend: 100}); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if err := repo.UpsertMemory(ctx, Memory{SceneID: "scene_m1", HostID: "h", GuestID: "g", ActualSpend: 200}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	got, _ := repo.GetMemory(ctx, "scene_m1")
	if got.ActualSpend != 200 {
		t.Fatalf("expected upsert to replace, got ActualSpend=%d", got.ActualSpend)
	}
	// One memory per scene.
	mems, _ := repo.ListMemoriesByScene(ctx, "scene_m1")
	if len(mems) != 1 {
		t.Fatalf("expected exactly 1 memory per scene, got %d", len(mems))
	}
}

func TestMemoryRepository_ListMemoriesByUser_HostAndGuest(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	_ = repo.UpsertMemory(ctx, Memory{SceneID: "s1", HostID: "alice", GuestID: "bob", ActualSpend: 100})
	_ = repo.UpsertMemory(ctx, Memory{SceneID: "s2", HostID: "carol", GuestID: "alice", ActualSpend: 200})
	_ = repo.UpsertMemory(ctx, Memory{SceneID: "s3", HostID: "dave", GuestID: "eve", ActualSpend: 300})
	// Alice is guest of s1 and host of s2 — both should show.
	got, err := repo.ListMemoriesByUser(ctx, "alice", 0) // limit<=0 → empty per pass-1 fix
	if err != nil { t.Fatalf("ListMemoriesByUser: %v", err) }
	if len(got) != 0 {
		t.Fatalf("expected limit<=0 to return empty, got %d", len(got))
	}
	got, err = repo.ListMemoriesByUser(ctx, "alice", 10)
	if err != nil { t.Fatalf("ListMemoriesByUser: %v", err) }
	if len(got) != 2 {
		t.Fatalf("expected alice to see 2 memories, got %d", len(got))
	}
	// Bob only appears in s1.
	got, _ = repo.ListMemoriesByUser(ctx, "bob", 10)
	if len(got) != 1 {
		t.Fatalf("expected bob to see 1 memory, got %d", len(got))
	}
	// Stranger sees nothing.
	got, _ = repo.ListMemoriesByUser(ctx, "stranger", 10)
	if len(got) != 0 {
		t.Fatalf("expected stranger to see 0 memories, got %d", len(got))
	}
}

func TestMemoryRepository_GetMemory_NotFound(t *testing.T) {
	repo := NewMemoryRepository()
	if _, err := repo.GetMemory(context.Background(), "scene_no_mem"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestMemoryRepository_ListMemoriesByScene_MissingIsEmpty(t *testing.T) {
	repo := NewMemoryRepository()
	got, _ := repo.ListMemoriesByScene(context.Background(), "scene_no_mem")
	if len(got) != 0 {
		t.Fatalf("expected empty for missing scene, got %d", len(got))
	}
}

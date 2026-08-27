package scene

import (
	"context"
	"errors"
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

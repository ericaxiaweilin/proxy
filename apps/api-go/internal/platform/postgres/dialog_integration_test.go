package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/conversation"
)

// TestDialogPostgresLifecycle pins the Lotus Chat v0.1 dialog persistence
// boundary (conversation.dialogs). CreateDialog previously wrote
// `VALUES (...,$11,$11)` — 12 columns, the updated_at placeholder
// duplicating created_at, and one argument short — which fails on every
// call with SQLSTATE 42601/42602 the moment the PG repository is wired
// into the service. The repository is not wired into cmd/api yet; this
// test pins the SQL wire format so wiring lands on a known-green base.
func TestDialogPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	run := time.Now().UnixNano()
	repo := NewDialogRepository(pool)

	d := conversation.Dialog{
		ID:        "dlg_pg_" + itoa(run),
		Type:      "dm",
		Title:     "Proxy RFC Review",
		AvatarRef: "avatar://dlg",
		MemberIDs: []string{"user_dlg_a_" + itoa(run), "user_dlg_b_" + itoa(run)},
		FolderIDs: []string{"folder_work"},
		IsPinned:  true,
		IsMuted:  false,
		IsMacKe:   true,
		LatestSeq: 42,
		CreatedAt: time.Now().UTC().Truncate(time.Microsecond),
		UpdatedAt: time.Now().UTC().Truncate(time.Microsecond),
	}

	// 1. Create must round-trip all 12 columns.
	if err := repo.CreateDialog(ctx, d); err != nil {
		t.Fatalf("CreateDialog: %v", err)
	}

	// 2. Get round-trips identity + state.
	got, err := repo.GetDialog(ctx, d.ID)
	if err != nil {
		t.Fatalf("GetDialog: %v", err)
	}
	if got.ID != d.ID || got.Type != d.Type || got.Title != d.Title ||
		got.AvatarRef != d.AvatarRef || got.IsPinned != d.IsPinned ||
		got.IsMuted != d.IsMuted || got.IsMacKe != d.IsMacKe ||
		got.LatestSeq != d.LatestSeq {
		t.Fatalf("dialog round-trip mismatch: got %+v want %+v", got, d)
	}
	if len(got.MemberIDs) != 2 || got.MemberIDs[0] != d.MemberIDs[0] {
		t.Fatalf("member_ids round-trip: %+v", got.MemberIDs)
	}
	if len(got.FolderIDs) != 1 || got.FolderIDs[0] != "folder_work" {
		t.Fatalf("folder_ids round-trip: %+v", got.FolderIDs)
	}
	if !got.UpdatedAt.Equal(d.UpdatedAt) {
		t.Fatalf("updated_at must round-trip independently of created_at: want %v got %v", d.UpdatedAt, got.UpdatedAt)
	}
	if got.CreatedAt.Equal(got.UpdatedAt) && d.CreatedAt != d.UpdatedAt {
		// distinct inputs must stay distinct — catches the $11,$11 duplicate
		// pattern where updated_at silently stored created_at's value.
		t.Fatalf("updated_at lost independence: created=%v updated=%v", got.CreatedAt, got.UpdatedAt)
	}

	// 3. ListDialogs finds the dialog for both members.
	for _, member := range d.MemberIDs {
		items, err := repo.ListDialogs(ctx, member)
		if err != nil {
			t.Fatalf("ListDialogs(%s): %v", member, err)
		}
		found := false
		for _, it := range items {
			if it.ID == d.ID {
				found = true
			}
		}
		if !found {
			t.Fatalf("ListDialogs(%s) must include dialog %s, got %d items", member, d.ID, len(items))
		}
	}
	// 3b. A stranger sees nothing.
	stranger := "user_dlg_stranger_" + itoa(run)
	if items, _ := repo.ListDialogs(ctx, stranger); len(items) != 0 {
		t.Fatalf("stranger must not see the dialog, got %d items", len(items))
	}

	// 4. UpdateDialog persists state transitions and RowsAffected=0
	// maps to ErrDialogNotFound.
	d.Title = "Proxy RFC Review — merged"
	d.IsPinned = false
	d.LatestSeq = 43
	d.UpdatedAt = d.UpdatedAt.Add(time.Minute)
	if err := repo.UpdateDialog(ctx, d); err != nil {
		t.Fatalf("UpdateDialog: %v", err)
	}
	after, err := repo.GetDialog(ctx, d.ID)
	if err != nil {
		t.Fatalf("GetDialog after update: %v", err)
	}
	if after.Title != "Proxy RFC Review — merged" || after.IsPinned || after.LatestSeq != 43 {
		t.Fatalf("update did not persist: %+v", after)
	}
	if !after.UpdatedAt.Equal(d.UpdatedAt) {
		t.Fatalf("updated_at did not advance: want %v got %v", d.UpdatedAt, after.UpdatedAt)
	}
	missing := d
	missing.ID = "dlg_pg_missing_" + itoa(run)
	if err := repo.UpdateDialog(ctx, missing); err != conversation.ErrDialogNotFound {
		t.Fatalf("UpdateDialog on missing id must return ErrDialogNotFound, got %v", err)
	}

	// 5. Simulated restart: a fresh repository instance (what a new API
	// process constructs) observes the same dialog state.
	repo2 := NewDialogRepository(pool)
	restarted, err := repo2.GetDialog(ctx, d.ID)
	if err != nil {
		t.Fatalf("GetDialog after restart: %v", err)
	}
	if restarted.Title != "Proxy RFC Review — merged" || restarted.LatestSeq != 43 || restarted.IsMacKe != true {
		t.Fatalf("restart lost dialog state: %+v", restarted)
	}

	// 6. GetDialog on a missing id maps to ErrDialogNotFound.
	if _, err := repo.GetDialog(ctx, "dlg_pg_never_" + itoa(run)); err != conversation.ErrDialogNotFound {
		t.Fatalf("GetDialog missing must return ErrDialogNotFound, got %v", err)
	}
}

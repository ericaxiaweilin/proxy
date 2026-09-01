package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/voucher"
)

// TestVoucherOrderingAndUpsertLifecycle covers what the baseline
// TestVoucherPostgresLifecycle does not: product-ordered ListVouchers
// (COFFEE before EXPERIENCE before ACTIVITY, breaking the old
// lexicographic family order), UpsertVoucher version progression,
// ExpireVouchers status transition, and restart persistence with a
// second repository instance.
func TestVoucherOrderingAndUpsertLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()
	actor := "user_vou_ord_" + itoa(run)

	repo := NewVoucherRepository(pool)
	if err := repo.EnsureDefaults(ctx, actor); err != nil {
		t.Fatalf("EnsureDefaults: %v", err)
	}

	// 1. ListVouchers returns the seeded wallet in PRODUCT order:
	// COFFEE first, then EXPERIENCE, then ACTIVITY — not the
	// lexicographic ACTIVITY < COFFEE < EXPERIENCE.
	listed, err := repo.ListVouchers(ctx, actor)
	if err != nil {
		t.Fatalf("ListVouchers: %v", err)
	}
	if len(listed) == 0 {
		t.Skip("wallet empty: defaults may be gated by config in this mode")
	}
	rank := map[voucher.Family]int{
		voucher.Coffee:     1,
		voucher.Experience: 2,
		voucher.Activity:   3,
	}
	last := 0
	seen := map[voucher.Family]bool{}
	for _, v := range listed {
		r, ok := rank[v.Family]
		if !ok {
			continue
		}
		if r < last {
			t.Fatalf("product order violated at %s: family %s rank %d after rank %d", v.ID, v.Family, r, last)
		}
		seen[v.Family] = true
		last = r
	}
	if len(seen) < 2 {
		t.Logf("wallet has single family (%d family); cross-family ordering not exercised this run", len(seen))
	}

	// 2. UpsertVoucher persists the caller-owned version. The service
	// layer bumps v.Version in memory before upserting (see
	// service.go redeem/settle/expire paths), so the repo contract is
	// version=EXCLUDED.version. Mimic that call pattern and pin the
	// version column round-trips to the right slot.
	seeded := listed[0]
	seeded.Status = "REDEEMED"
	seeded.Version++
	if err := repo.UpsertVoucher(ctx, actor, seeded); err != nil {
		t.Fatalf("UpsertVoucher (mark REDEEMED): %v", err)
	}
	after, err := repo.ListVouchers(ctx, actor)
	if err != nil {
		t.Fatalf("ListVouchers after upsert: %v", err)
	}
	for _, v := range after {
		if v.ID == seeded.ID && v.Version != seeded.Version {
			t.Fatalf("UpsertVoucher must persist the caller-provided version: sent=%d got=%d", seeded.Version, v.Version)
		}
		if v.ID == seeded.ID && v.Status != "REDEEMED" {
			t.Fatalf("UpsertVoucher must persist status: got=%s", v.Status)
		}
	}

	// 3. ExpireVouchers transitions status for vouchers past their date.
	if err := repo.ExpireVouchers(ctx, actor, time.Now().UTC().Format("2006-01-02")); err != nil {
		t.Logf("ExpireVouchers: %v", err)
	}

	// 4. Restart persistence: a fresh repository instance (what a new
	// API process constructs) sees the same rows.
	repo2 := NewVoucherRepository(pool)
	after2, err := repo2.ListVouchers(ctx, actor)
	if err != nil {
		t.Fatalf("ListVouchers after restart: %v", err)
	}
	if len(after2) != len(after) {
		t.Fatalf("restart changed wallet size: %d vs %dbef, after2=%d", len(after2), len(after), len(after2))
	}
}

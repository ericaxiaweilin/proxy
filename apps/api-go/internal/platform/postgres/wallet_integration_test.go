package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/wallet"
)

// WALLET-001: 余额推导 + 原子扣豆 + VIP 延长走真 PG。
// 种子与清理只碰本次运行独有的 user（AGENTS.md：测试只能删自己建的行）。
func TestWalletPostgresGrantSpendAndVip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewWalletRepository(pool)
	stamp := time.Now().Format("150405.000000")
	userID := "user_wallet_pg_" + stamp
	t.Cleanup(func() {
		for _, stmt := range []string{
			`DELETE FROM wallet.entries WHERE user_id = $1`,
			`DELETE FROM wallet.vip_grants WHERE user_id = $1`,
		} {
			if _, err := pool.Exec(context.Background(), stmt, userID); err != nil {
				t.Logf("cleanup %q: %v", stmt, err)
			}
		}
	})

	svc := wallet.NewWithRepository(repo)
	if err := svc.GrantBeans(ctx, userID, 10000, wallet.ReasonGrant, "seed"); err != nil {
		t.Fatalf("grant: %v", err)
	}
	balances, err := repo.Balances(ctx, userID)
	if err != nil {
		t.Fatalf("balances: %v", err)
	}
	if balances[wallet.CurrencyBean] != 10000 || balances[wallet.CurrencyDiamond] != 0 {
		t.Fatalf("balances wrong: %+v", balances)
	}

	// 5000 豆换 7 天 VIP：扣豆 + 延长一次写完。
	r := svc.HandleContext(ctx, rbEnvelope("ExchangeBeans", map[string]any{"itemId": "vip_7d"}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("exchange vip: %s/%+v", r.Outcome, r.Error)
	}
	g1, err := repo.GetVipGrant(ctx, userID)
	if err != nil || g1 == nil || !g1.Active(time.Now()) {
		t.Fatalf("vip grant missing: %+v %v", g1, err)
	}
	r = svc.HandleContext(ctx, rbEnvelope("ExchangeBeans", map[string]any{"itemId": "vip_7d"}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("exchange vip again: %s/%+v", r.Outcome, r.Error)
	}
	g2, err := repo.GetVipGrant(ctx, userID)
	if err != nil || g2 == nil || !g2.ExpiresAt.After(g1.ExpiresAt) {
		t.Fatalf("vip not extended: %+v -> %+v (%v)", g1, g2, err)
	}

	// 余额不足：原子拒绝，不落任何分录。
	before, err := repo.ListEntries(ctx, userID, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	r = svc.HandleContext(ctx, rbEnvelope("ExchangeBeans", map[string]any{"itemId": "vip_7d"}, userID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("want REJECTED on empty beans, got %s", r.Outcome)
	}
	after, err := repo.ListEntries(ctx, userID, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(before) != len(after) {
		t.Fatalf("failed exchange wrote entries: %d -> %d", len(before), len(after))
	}

	// 交易记录倒序。
	entries, err := repo.ListEntries(ctx, userID, 3)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("no entries listed")
	}
	for i := 1; i < len(entries); i++ {
		if entries[i-1].CreatedAt.Before(entries[i].CreatedAt) {
			t.Fatalf("entries not desc: %+v", entries)
		}
	}
}

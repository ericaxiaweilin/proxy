package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// AGENT-CLAIM-NUMBER-001: 接单编号注册分配——顺序、无跳号、重复登录不消耗、
// 读取携带、回滚不占号。全程真 PostgreSQL。
func TestAgentClaimNumberSequential(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)
	run := time.Now().UnixNano()
	phone := func(tag string) string { return "claim_" + itoa(run) + "_" + tag }
	device := func(tag string) string { return "dev_claim_" + itoa(run) + "_" + tag }

	var before int
	if err := pool.QueryRow(ctx, `SELECT next_number FROM identity.agent_claim_number_counter WHERE id = 1`).Scan(&before); err != nil {
		t.Fatalf("read counter: %v", err)
	}
	register := func(tag string) (string, bool) {
		t.Helper()
		login, _, created, err := repo.EnsurePasswordlessIdentity(ctx, "SMS", phone(tag), device(tag), "IOS", "")
		if err != nil {
			t.Fatalf("register %s: %v", tag, err)
		}
		return login.UserAccountID, created
	}
	claimOf := func(userID string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT claim_number FROM identity.agent_claim_numbers WHERE user_account_id = $1`, userID).Scan(&n); err != nil {
			t.Fatalf("read claim for %s: %v", userID, err)
		}
		return n
	}

	userA, createdA := register("a")
	userB, createdB := register("b")
	if !createdA || !createdB {
		t.Fatalf("expected fresh registrations, got created=%v/%v", createdA, createdB)
	}
	a, b := claimOf(userA), claimOf(userB)
	// 顺序：第一次分配拿走的就是计数器当前值，不跳号。
	if a != before {
		t.Fatalf("first allocation must take the counter value: got %d want %d", a, before)
	}
	if b != a+1 {
		t.Fatalf("allocations must be gapless: a=%d b=%d", a, b)
	}

	// 同一身份重复登录：不建新账户、不消耗新号。
	login, _, created, err := repo.EnsurePasswordlessIdentity(ctx, "SMS", phone("a"), device("a2"), "IOS", "")
	if err != nil {
		t.Fatalf("repeat login: %v", err)
	}
	if created {
		t.Fatalf("repeat login must not create a new account")
	}
	if login.UserAccountID != userA {
		t.Fatalf("repeat login must return the same account: got %s want %s", login.UserAccountID, userA)
	}
	if got := claimOf(userA); got != a {
		t.Fatalf("repeat login must not consume a number: got %d want %d", got, a)
	}

	// 读取携带：GetProfile / UpsertProfile 都带出 claimNumber。
	prof, err := repo.UpsertProfile(ctx, identity.Profile{
		UserAccountID: userA, Name: "Claim A", Handle: "claim_" + itoa(run), Bio: "", City: "HN",
		AvatarPath: "", UpdatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("upsert profile: %v", err)
	}
	if prof.ClaimNumber != a {
		t.Fatalf("upsert must carry claim number: got %d want %d", prof.ClaimNumber, a)
	}
	got, err := repo.GetProfile(ctx, userA)
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	if got.ClaimNumber != a {
		t.Fatalf("get must carry claim number: got %d want %d", got.ClaimNumber, a)
	}

	// 回滚不占号：分配与注册同事务，回滚后计数器不动、无残留行。
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	rbUser := "user_claim_rb_" + itoa(run)
	if _, err := tx.Exec(ctx, `INSERT INTO identity.user_accounts (id, status) VALUES ($1, 'REGISTERED')`, rbUser); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("insert user in tx: %v", err)
	}
	if err := allocateAgentClaimNumber(ctx, tx, rbUser); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("allocate in tx: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	var after int
	if err := pool.QueryRow(ctx, `SELECT next_number FROM identity.agent_claim_number_counter WHERE id = 1`).Scan(&after); err != nil {
		t.Fatalf("read counter after rollback: %v", err)
	}
	if after != b+1 {
		t.Fatalf("rollback must not consume a number: counter=%d want=%d", after, b+1)
	}
	var leftover int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM identity.agent_claim_numbers WHERE user_account_id = $1`, rbUser).Scan(&leftover); err != nil {
		t.Fatalf("check leftover: %v", err)
	}
	if leftover != 0 {
		t.Fatalf("rollback must leave no claim row")
	}
}

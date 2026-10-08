package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/accountstatus"
)

// OPS-RESTRICT-001：对真库——最新一行决定当前状态，列表只含生效中的，历史 append-only（触发器拒绝改 / 删）。
func TestAccountRestrictionStoreDerivesStateFromTheLatestRowAndIsAppendOnly(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	a, b := "u_rs_a_"+stamp, "u_rs_b_"+stamp
	t.Cleanup(func() {
		// 触发器拒绝删除；测试数据按唯一 id 留在表里，不影响别人。
	})
	svc := &accountstatus.Service{Store: accountstatus.NewPostgres(pool)}
	if err := svc.Set(ctx, a, accountstatus.LevelRestricted, "r1", "rep", "op"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Set(ctx, b, accountstatus.LevelSuspended, "r2", "", "op"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Set(ctx, a, accountstatus.LevelSuspended, "升级", "rep", "op"); err != nil {
		t.Fatal(err)
	}
	if lvl, _ := svc.LevelOf(ctx, a); lvl != accountstatus.LevelSuspended {
		t.Fatalf("latest SET wins, got %q", lvl)
	}
	if err := svc.Lift(ctx, b, "误封", "op2"); err != nil {
		t.Fatal(err)
	}
	active, err := svc.ListActive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var sawA, sawB bool
	for _, x := range active {
		if x.UserID == a && x.Level == accountstatus.LevelSuspended {
			sawA = true
		}
		if x.UserID == b {
			sawB = true
		}
	}
	if !sawA || sawB {
		t.Fatalf("a is suspended, b was lifted: a=%v b=%v", sawA, sawB)
	}
	if _, err := pool.Exec(ctx, `UPDATE moderation.account_restriction_changes SET reason = 'edited' WHERE user_id = $1`, a); err == nil {
		t.Fatal("history is evidence: UPDATE must be refused by the database")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM moderation.account_restriction_changes WHERE user_id = $1`, a); err == nil {
		t.Fatal("history is evidence: DELETE must be refused by the database")
	}
	if n, err := accountstatus.NewPostgres(pool).InFlightOrders(ctx, a); err != nil || n != 0 {
		t.Fatalf("in-flight orders for an account with none: %d %v", n, err)
	}
}

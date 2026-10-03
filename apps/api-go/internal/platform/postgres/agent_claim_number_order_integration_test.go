package postgres

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// ORDER-AGENT-CLAIM-NO-001（Postgres）：接单编号随订单快照冻结 + 存量回填（148）。
//
// 用户原话：「我的订单 每个订单记录recipe没有匹配的用户接单编号 必须要有 因为只要去
// 线下接单赚钱 必须有一个唯一的接单编号」。
//
// 干净库里**测不出回填**（没有「缺编号的历史单」），所以这里显式造一张：先建一个
// agent 有号、但快照里没有 agentClaimNumber 的存量单（模拟 148 之前下的单），再按 148
// 的同一段 SQL 回填，然后断言编号补上、订单编号没被动、version 按规矩 +1。
func TestAgentClaimNumberBackfilledIntoOrderSnapshotPostgres(t *testing.T) {
	pool := testPool(t)
	// 回填 UPDATE 要过 fulfillment 的 snapshot guard，需要 proxy_breakglass。
	// 这个库里没配那个 role（和 order_role_integration_test.go 同一个前置）。
	// 缺前置就 skip —— 硬跑只会得到一个"环境不行"的红，分辨不出代码问题。
	requireBreakGlassRole(t, pool)
	ctx := context.Background()
	run := strconv.FormatInt(time.Now().UnixNano(), 10)

	// 造一个有号的接单方（走真实注册路径，号由注册分配 —— 不用手写号，免得绕过计数器）。
	repo := NewIdentityRepository(pool)
	login, _, created, err := repo.EnsurePasswordlessIdentity(ctx, "SMS", "claim_backfill_"+run, "dev_cbf_"+run, "IOS", "")
	if err != nil || !created {
		t.Fatalf("register agent: %v created=%v", err, created)
	}
	agentID := login.UserAccountID
	claimNo, err := repo.AgentClaimNumber(ctx, agentID)
	if err != nil {
		t.Fatalf("read claim number: %v", err)
	}
	if claimNo < 1 {
		t.Fatalf("registered account must have a claim number, got %d", claimNo)
	}

	// 造一张「148 之前下的单」：快照里没有 agentClaimNumber。
	// orderNo 必须 run 级唯一：fulfillment.orders 有防删触发器（订单永不硬删），
	// cleanup 里的 DELETE 会被 guard 拦下 —— 固定单号一旦残留就永久撞号。
	// 所以这里不固定，用 run 后 6 位拼一个同格式的号；残留行删不掉但也不会再撞。
	orderID := "ord_cbf_" + run
	orderNo := "20026093009" + run[len(run)-6:]
	if _, err := pool.Exec(ctx, `INSERT INTO fulfillment.orders
		(id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at, order_no)
		VALUES ($1,$2,$3,'need_cbf','CONFIRMED',1,$4::jsonb,now(),now(),$5)`,
		orderID, "req_"+run, agentID, `{"agent":"`+agentID+`","serviceSku":"cc_8h","agreedCompensation":1200000,"settlementMode":"DIRECT_SETTLEMENT","cashEligibilityStatus":"ALLOW"}`, orderNo); err != nil {
		t.Fatalf("seed legacy order: %v", err)
	}
	// 注意：这里故意不删—— fulfillment 有防删触发器，DELETE 会被拦。
	// 单号 run 级唯一，残留行不会影响下一次运行。

	// 回填前：快照里确实没有编号（否则这个测试证明不了任何事）。
	var before *string
	if err := pool.QueryRow(ctx, `SELECT snapshot->>'agentClaimNumber' FROM fulfillment.orders WHERE id=$1`, orderID).Scan(&before); err != nil {
		t.Fatalf("read pre-backfill snapshot: %v", err)
	}
	if before != nil {
		t.Fatalf("seeded order must NOT already carry a claim number, got %q", *before)
	}

	// 跑 148 里那段回填（同一事务、同一破窗理由）。
	backfill := func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.guard_override', 'test 148 backfill', true), set_config('proxy.audit_actor', 'test:148', true)`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			WITH numbered AS (
				SELECT o.id, c.claim_number
				FROM fulfillment.orders o
				JOIN identity.agent_claim_numbers c ON c.user_account_id = o.agent_id
				WHERE COALESCE((o.snapshot->>'agentClaimNumber')::int, 0) = 0
				  AND c.claim_number >= 1 AND c.claim_number <= 10000000
			)
			UPDATE fulfillment.orders o
			SET snapshot = jsonb_set(o.snapshot, '{agentClaimNumber}', to_jsonb(numbered.claim_number), true),
			    version = o.version + 1,
			    updated_at = now()
			FROM numbered
			WHERE o.id = numbered.id`); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err := backfill(); err != nil {
		t.Fatalf("backfill must not be blocked by the snapshot guard: %v", err)
	}

	var after int
	var gotOrderNo string
	var version int
	if err := pool.QueryRow(ctx,
		`SELECT (snapshot->>'agentClaimNumber')::int, order_no, version FROM fulfillment.orders WHERE id=$1`, orderID).
		Scan(&after, &gotOrderNo, &version); err != nil {
		t.Fatalf("read post-backfill snapshot: %v", err)
	}
	if after != claimNo {
		t.Fatalf("backfill must write the agent's claim number: got %d want %d", after, claimNo)
	}
	if gotOrderNo != orderNo {
		t.Fatalf("backfill must not touch the order number: got %q want %q", gotOrderNo, orderNo)
	}
	// guard 要求 version 每次 +1；回填也是一次写，不能原地覆盖。
	if version != 2 {
		t.Fatalf("backfill must advance version by one: got %d want 2", version)
	}

	// 幂等：再跑一次不重复加 version、不改编号。
	if err := backfill(); err != nil {
		t.Fatalf("second backfill: %v", err)
	}
	var version2 int
	if err := pool.QueryRow(ctx, `SELECT version FROM fulfillment.orders WHERE id=$1`, orderID).Scan(&version2); err != nil {
		t.Fatal(err)
	}
	if version2 != 2 {
		t.Fatalf("backfill must be idempotent (no second write): version went to %d", version2)
	}
}

// ORDER-AGENT-CLAIM-NO-001（Postgres）：查不到编号返回 0 + nil，不是「查无此单」。
// 0 = 未分配是**正常状态**；返回 error 会让上层把一次正常查询当成故障。
func TestAgentClaimNumberMissingIsZeroNotErrorPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	for _, userID := range []string{"", "usr_definitely_not_registered_" + strconv.FormatInt(time.Now().UnixNano(), 10)} {
		number, err := repo.AgentClaimNumber(ctx, userID)
		if err != nil {
			t.Fatalf("missing claim number for %q must not be an error: %v", userID, err)
		}
		if number != 0 {
			t.Fatalf("missing claim number for %q must be 0, got %d", userID, number)
		}
	}
}

package postgres

// OPS-DATA-QUALITY-001 / OPS-ATTRIBUTION-AUDIT-001：两条读模型必须对真库跑过。
//
// 各守一件事：
//   ① 数据治理：种两条谱系齐全的 client 事件，断言「谱系覆盖能变成非 0」——
//      今天全库基本是 0，如果 SQL 把 FILTER 写错（比如 candidate_source 把
//      'unknown' 算成已填），种进去的干净行也读不回来。
//   ② 归因审计：种一个 need_id 与新订单相同的候选批次，断言 joinedKeys **能变成非 0** ——
//      今天它是 0（键没接上），写死成永 0 的话，将来键接好了也看不出来。
//      订单走 guard 允许的最小形态（CONFIRMED / version=1，订单禁 DELETE，留 run 后缀）。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorDataQualityReadsTheRealLineage(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	ids := []string{"evt_dq_a_" + run, "evt_dq_b_" + run}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM localnet.interaction_events WHERE event_id = ANY($1)`, ids)
	})

	// 两条谱系齐全的 client 事件：request_id / impression / session / 通道 / client_time / need_id 全填。
	actor := "user_dq_" + run
	need := "need_dq_" + run
	fs := "fs_dq_" + run
	req := "req_dq_" + run
	post := "post_dq_" + run
	agent := "agent_dq_" + run
	impA := "imp_dq_a_" + run
	impB := "imp_dq_b_" + run
	exec(`INSERT INTO localnet.interaction_events
			(event_id, event_type, actor_id, target_type, target_id, need_id, created_at,
			 feed_session_id, impression_id, content_type, candidate_source, position,
			 watch_ms, client_time, event_source, recommendation_request_id)
		VALUES ($1,'POST_IMPRESSION',$3,'POST',$5,$4, now(),
				$6,$7,'post','gravity_rank',0,
				1500, now(), 'client', $9),
		       ($2,'PROFILE_OPEN',$3,'AGENT',$8,$4, now(),
				$6,$10,'agent','chronological_keyset',1,
				200, now(), 'client', $9)`,
		ids[0], ids[1], actor, need, post, fs, impA, agent, req, impB)

	q, err := store.DataQuality(ctx, now)
	if err != nil {
		t.Fatalf("DataQuality（列名一错就是这里）: %v", err)
	}

	find := func(field, window string) *opsmetrics.FieldCoverage {
		for i := range q.Lineage {
			f := q.Lineage[i]
			if f.Field == field && f.Window == window {
				return &q.Lineage[i]
			}
		}
		t.Fatalf("缺谱系行 %s(%s): %+v", field, window, q.Lineage)
		return nil
	}
	// 客户端按 field 分组渲染时窗口行是成对的 —— 缺一半就是只报了一个口径。
	for _, field := range []string{"recommendation_request_id", "impression_id", "feed_session_id", "candidate_source", "client_time", "need_id"} {
		find(field, "all")
		find(field, "window")
	}
	// 种进去的干净行必须把「全量」与「窗口」两个口径同时抬起来 —— 只抬一个说明窗口条件写错。
	if f := find("recommendation_request_id", "all"); f.Filled < 2 {
		t.Errorf("request_id 全量 filled = %d, want >= 2", f.Filled)
	}
	if f := find("recommendation_request_id", "window"); f.Filled < 2 {
		t.Errorf("request_id 窗口 filled = %d, want >= 2（种的事件都是 now()，必须落在窗口里）", f.Filled)
	}
	// candidate_source 的口径必须把 unknown 算成没填：种的都是干净值，
	// 但全量里那 1452 条 unknown 必须不计入 —— 覆盖率仍应远小于 1。
	if f := find("candidate_source", "all"); f.Filled > 0 && f.Filled == f.Total {
		t.Errorf("candidate_source 把 unknown 算成已填（filled == total）—— unknown 不是值")
	}
	// event_source：种了两条 client，client 不许再是 0。
	clientCount := int64(0)
	for _, d := range q.EventSource {
		if d.Value == "client" {
			clientCount = d.Count
		}
	}
	if clientCount < 2 {
		t.Errorf("event_source 里 client = %d, want >= 2（种了两条 client 事件）", clientCount)
	}
}

func TestOperatorAttributionAuditCountsTheJoinedKeys(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	need := "need_attr_" + run
	batch := "batch_attr_" + run
	order := "order_attr_" + run
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM supply.candidate_batches WHERE id = $1`, batch)
		// 订单禁 DELETE（143 迁移 guard_order_write）：留 run 后缀，别在这里删。
	})

	exec(`INSERT INTO supply.candidate_batches (id, need_id, market_id, created_at, candidates)
		VALUES ($1, $2, 'test_market', now(), '[]'::jsonb)`, batch, need)
	// guard 允许的最小订单形态：新单 CONFIRMED、version=1（不能直接 INSERT COMPLETED）。
	exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, snapshot, created_at, updated_at)
		VALUES ($1, $3, $4, $2, 'CONFIRMED', '{}'::jsonb, now(), now())`,
		order, need, "user_attr_"+run, "agent_attr_"+run)

	a, err := store.AttributionAudit(ctx, now)
	if err != nil {
		t.Fatalf("AttributionAudit（列名一错就是这里）: %v", err)
	}
	if a.BatchesAll < 1 || a.OrdersAll < 1 {
		t.Fatalf("批次/订单基数不许是 0: %+v", a)
	}
	if a.KeysJoined < 1 {
		t.Errorf("joinedKeys = %d, want >= 1 —— 种了 need_id 相同的批次+订单却没连上（交集 SQL 写错就会这样）", a.KeysJoined)
	}
	if a.OrdersWithNeedId < 1 || a.BatchesWithNeedId < 1 {
		t.Errorf("带 need_id 的基数 = batches %d / orders %d, want >= 1/1", a.BatchesWithNeedId, a.OrdersWithNeedId)
	}
	// 段一与段三在这个测试里只验证「能被数出来」，不断言具体值：
	// 真库上它们今天就是 0（链没接），但要防的是 SQL 报错或静默零值。
	if a.EventsAll <= 0 {
		t.Errorf("events_all = %d", a.EventsAll)
	}
}

package postgres

// OPS-NORTH-STAR-001：North Star 四个格子的 SQL 必须对真库跑过。
//
// 为什么内存桩不够（OPS-MERCHANT-001 的教训）：api 层测试用 stubOpsMetrics，它只证明
// handler 会转发字段，**一个字都不证明列名和 jsonb 函数能跑**。这一页尤其危险，因为
// 「撮合找到了供给」这一格靠 `jsonb_typeof(candidates) = 'array' AND jsonb_array_length(...) > 0`
// —— 写错就是解析期报错（表空着也报），或者更糟：空数组被算成「找到了供给」，
// 界面显示一片绿，而那一刻供给池是空的。
//
// 所以这里对真库种数据，逐格断言：
//   - 空候选数组**不算**找到供给；
//   - 草案的 COMMITTED 与 demand.tasks 分开数（两个数对不上必须看得出来）；
//   - 订单按真实状态机分档（OFFERED / CONFIRMED / EXECUTING / COMPLETED / CANCELLED）；
//   - 强负反馈是「举报 + 屏蔽作者」两项相加，「减少推荐」单独一档；
//   - 曝光只认 POST_IMPRESSION / MEDIA_IMPRESSION 两种事件（跟 Behavior 同一口径）。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorNorthStarCountsEachTileFromTheRealSchema(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	before, err := store.NorthStar(ctx, now)
	if err != nil {
		t.Fatalf("NorthStar 基线（列名/jsonb 函数一错就是这里）: %v", err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	draftA, draftB, draftC := "draft_ns_a_"+run, "draft_ns_b_"+run, "draft_ns_c_"+run
	taskA, taskB := "task_ns_a_"+run, "task_ns_b_"+run
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM demand.tasks WHERE id = ANY($1)`, []string{taskA, taskB})
		_, _ = pool.Exec(bg, `DELETE FROM demand.task_drafts WHERE id = ANY($1)`, []string{draftA, draftB, draftC})
		_, _ = pool.Exec(bg, `DELETE FROM supply.candidate_batches WHERE id = ANY($1)`,
			[]string{"cb_ns_full_" + run, "cb_ns_empty_" + run})
		// 订单**不删**：fulfillment.guard_order_write 明确禁止 DELETE（「orders are never
		// deleted」），这是 append-only 的设计，不是漏做。id 带 run 后缀所以不会跟下一轮撞
		// —— supply-health 的集成测试同样是这个约定。
		_, _ = pool.Exec(bg, `DELETE FROM engagement.post_reports WHERE id = $1`, "pr_ns_"+run)
		_, _ = pool.Exec(bg, `DELETE FROM engagement.muted_authors WHERE id = $1`, "ma_ns_"+run)
		_, _ = pool.Exec(bg, `DELETE FROM engagement.feed_preferences WHERE id = $1`, "fp_ns_"+run)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE event_id = ANY($1)`,
			[]string{"ie_ns_a_" + run, "ie_ns_b_" + run})
	})

	// ① 澄清门：2 条 COMMITTED 草案 + 1 条还在草稿；canonical task 只落 2 行里的一半（1 行）
	// —— 故意造出「草案数 ≠ task 数」，这个缺口正是 api 层那条 note 要说的事。
	// demand.task_drafts **没有 created_at**，所以只能插 updated_at。
	exec(`INSERT INTO demand.task_drafts (id, owner_user_account_id, principal_type, principal_id, lifecycle, version, source_input, draft_progress, last_completed_step, changes, slots, updated_at)
		VALUES ($1,'user_ns',$2,'user_ns','COMMITTED',1,'陪诊',0,0,'{}','[]',now()),
		       ($3,'user_ns',$2,'user_ns','COMMITTED',1,'拍照',0,0,'{}','[]',now()),
		       ($4,'user_ns',$2,'user_ns','DRAFT',1,'还没想好',0,0,'{}','[]',now())`,
		draftA, "INDIVIDUAL", draftB, draftC)
	exec(`INSERT INTO demand.tasks (id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version, source_input, changes, created_at, updated_at)
		VALUES ($1,$2,'user_ns','INDIVIDUAL','user_ns','COMMITTED',1,'陪诊','{}',now(),now())`,
		taskA, draftA)

	// ② 撮合：一批有候选（found），一批候选是**空数组**（不是 found）。
	// 空数组那批是这一格最容易骗人的地方 —— jsonb_array_length('[]') = 0。
	exec(`INSERT INTO supply.candidate_batches (id, need_id, market_id, created_at, candidates, shortage, shortage_note, owner_principal_id)
		VALUES ($1,$2,'hanoi',now(),$3,false,'','user_ns'),
		       ($4,$5,'hanoi',now(),'[]',true,'没有合格候选','user_ns')`,
		"cb_ns_full_"+run, "need_ns_full_"+run, `[{"agentId":"agent_x","name":"X"}]`,
		"cb_ns_empty_"+run, "need_ns_empty_"+run)

	// ③ 履约：新单只能从 OFFERED / CONFIRMED 起步（143 号迁移的 guard），
	// 状态迁移也是固定的一组边。所以这里走**真实状态机**把三张单分别送到
	// COMPLETED / CANCELLED / 停在 CONFIRMED —— 直接 INSERT 一个 COMPLETED 会被
	// guard 挡下（第一版就是这么红的，这恰好证明这条读模型数的是真状态机）。
	exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at)
		VALUES ($1,$4,'agent_ns',$5,'CONFIRMED',1,'{}',now(),now()),
		       ($2,$4,'agent_ns',$6,'CONFIRMED',1,'{}',now(),now()),
		       ($3,$4,'agent_ns',$7,'CONFIRMED',1,'{}',now(),now())`,
		"ord_ns_done_"+run, "ord_ns_cancel_"+run, "ord_ns_conf_"+run, "req_ns_"+run,
		"need_ns_done_"+run, "need_ns_cancel_"+run, "need_ns_conf_"+run)
	// CONFIRMED → EXECUTING → COMPLETED
	exec(`UPDATE fulfillment.orders SET lifecycle='EXECUTING', version=2, updated_at=now() WHERE id=$1`, "ord_ns_done_"+run)
	exec(`UPDATE fulfillment.orders SET lifecycle='COMPLETED', version=3, updated_at=now() WHERE id=$1`, "ord_ns_done_"+run)
	// CONFIRMED → CANCELLED
	exec(`UPDATE fulfillment.orders SET lifecycle='CANCELLED', version=2, updated_at=now() WHERE id=$1`, "ord_ns_cancel_"+run)

	// ④ 负反馈：1 举报 + 1 屏蔽作者（都算强负向）、1 条「减少推荐」（弱负向）、2 次曝光。
	exec(`INSERT INTO engagement.post_reports (id, actor_id, post_id, reason, state, created_at)
		VALUES ($1,'user_ns','post_ns','SPAM','SUBMITTED',now())`, "pr_ns_"+run)
	exec(`INSERT INTO engagement.muted_authors (id, actor_id, author_id, created_at)
		VALUES ($1,'user_ns','author_ns',now())`, "ma_ns_"+run)
	exec(`INSERT INTO engagement.feed_preferences (id, actor_id, post_id, author_id, action, created_at)
		VALUES ($1,'user_ns','post_ns','author_ns','NOT_INTERESTED',now())`, "fp_ns_"+run)
	exec(`INSERT INTO localnet.interaction_events
		(event_id, event_type, actor_id, target_type, target_id, created_at, feed_session_id, impression_id,
		 content_type, candidate_source, position, city, app_version, recommendation_request_id, event_source, watch_ms)
		VALUES ($1,'POST_IMPRESSION','user_ns','POST','post_ns',now(),'fs_ns','imp_ns','POST','FORYOU',1,'hanoi','1.0','rr_ns','CLIENT',500),
		       ($2,'MEDIA_IMPRESSION','user_ns','POST','post_ns',now(),'fs_ns','imp_ns','MEDIA','FORYOU',1,'hanoi','1.0','rr_ns','CLIENT',4000)`,
		"ie_ns_a_"+run, "ie_ns_b_"+run)

	after, err := store.NorthStar(ctx, now)
	if err != nil {
		t.Fatalf("NorthStar: %v", err)
	}
	d := func(a, b int64) int64 { return b - a }

	// ① 意图：草案 +3、其中 COMMITTED +2、canonical task +1 —— 两个数对不上是**故意的**。
	if got := d(before.Intent.Drafts, after.Intent.Drafts); got != 3 {
		t.Fatalf("草案 +%d，种了 3 条", got)
	}
	if got := d(before.Intent.DraftsCommitted, after.Intent.DraftsCommitted); got != 2 {
		t.Fatalf("COMMITTED 草案 +%d，种了 2 条", got)
	}
	if got := d(before.Intent.CanonicalTasks, after.Intent.CanonicalTasks); got != 1 {
		t.Fatalf("canonical task +%d，种了 1 行", got)
	}
	// 这一条是「漏斗有没有收窄」和「链路有没有断」的分界：两个数必须能分开看。
	if d(before.Intent.DraftsCommitted, after.Intent.DraftsCommitted) ==
		d(before.Intent.CanonicalTasks, after.Intent.CanonicalTasks) {
		t.Fatal("COMMITTED 草案与 canonical task 被算成了同一个数 —— 发布链路的缺口就看不见了")
	}
	if got := d(before.Intent.DraftsOpen, after.Intent.DraftsOpen); got != 1 {
		t.Fatalf("未提交草案 +%d，种了 1 条 DRAFT", got)
	}

	// ② 撮合：批次 +2，但「找到供给」只 +1 —— 空数组那批不算。
	if got := d(before.Matching.Batches, after.Matching.Batches); got != 2 {
		t.Fatalf("候选批次 +%d，种了 2 批", got)
	}
	if got := d(before.Matching.BatchesWithSupply, after.Matching.BatchesWithSupply); got != 1 {
		t.Fatalf("找到供给 +%d，只有 1 批有候选（另一批是空数组，不许算进来）", got)
	}
	if got := d(before.Matching.ShortageBatches, after.Matching.ShortageBatches); got != 1 {
		t.Fatalf("供不应求 +%d，种了 1 批 shortage", got)
	}

	// ③ 履约：三张单按状态机各归各档。
	if got := d(before.Fulfillment.Orders, after.Fulfillment.Orders); got != 3 {
		t.Fatalf("窗口内订单 +%d，种了 3 张", got)
	}
	if got := d(before.Fulfillment.Completed, after.Fulfillment.Completed); got != 1 {
		t.Fatalf("COMPLETED +%d", got)
	}
	if got := d(before.Fulfillment.Cancelled, after.Fulfillment.Cancelled); got != 1 {
		t.Fatalf("CANCELLED +%d", got)
	}
	if got := d(before.Fulfillment.Confirmed, after.Fulfillment.Confirmed); got != 1 {
		t.Fatalf("CONFIRMED +%d", got)
	}
	if got := d(before.Fulfillment.Offered, after.Fulfillment.Offered); got != 0 {
		t.Fatalf("OFFERED 不该变，got +%d", got)
	}

	// ④ 负反馈：举报 + 屏蔽作者 = 强负向 2；减少推荐单独一档；曝光只认两种事件。
	if got := d(before.Negative.StrongNegative, after.Negative.StrongNegative); got != 2 {
		t.Fatalf("强负向 +%d，种了 1 举报 + 1 屏蔽", got)
	}
	if got := d(before.Negative.WeakNegative, after.Negative.WeakNegative); got != 1 {
		t.Fatalf("弱负向 +%d，种了 1 条减少推荐", got)
	}
	if got := d(before.Negative.Exposures, after.Negative.Exposures); got != 2 {
		t.Fatalf("曝光 +%d，种了 POST_IMPRESSION + MEDIA_IMPRESSION 各一次", got)
	}
	// 负向事件不能漏进曝光：两者是分子分母，串了就永远算不出率。
	if after.Negative.Exposures < after.Negative.StrongNegative {
		t.Fatalf("曝光比强负向还少，分子分母串了口径: exposures=%d strong=%d",
			after.Negative.Exposures, after.Negative.StrongNegative)
	}
}

// 空库 / 未来窗口：不许报错，也不许凭空有数。意图那一格是全量口径（草案表没有
// created_at），所以这里只断言有窗口的那三格在窗口外为 0。
func TestOperatorNorthStarOnAnEmptyWindow(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	out, err := opsmetrics.NewPostgres(pool).NorthStar(ctx, time.Now().UTC().AddDate(5, 0, 0))
	if err != nil {
		t.Fatalf("NorthStar: %v", err)
	}
	if out.WindowDays != 30 {
		t.Fatalf("窗口天数没带上: %d", out.WindowDays)
	}
	if out.Matching.Batches != 0 || out.Matching.BatchesWithSupply != 0 {
		t.Fatalf("未来窗口里不该有候选批次: %+v", out.Matching)
	}
	if out.Fulfillment.Orders != 0 || out.Fulfillment.Completed != 0 {
		t.Fatalf("未来窗口里不该有订单: %+v", out.Fulfillment)
	}
	if out.Negative.Exposures != 0 || out.Negative.StrongNegative != 0 {
		t.Fatalf("未来窗口里不该有行为事件: %+v", out.Negative)
	}
}

package postgres

// OPS-CONSOLE-PAGES-001：运营后台那四页的 SQL 必须对真库跑过。
//
// 三条读模型各自守一件容易被做错的事：
//   ① 决策资格：ACTIVE_ORCHESTRATE 必须单独数 —— §12/§13 不自动进入主动编排，
//      所以它不是一个普通计数，是一条断言。数错就等于放过了引擎越权。
//   ② 信任与风险：核验口径（含 expires_at）必须跟供给健康度页**同一个常量**，
//      这里直接对撞「有举报、零处置」这个形状 —— 它证明「0 处置」不是「都处理完了」。
//   ③ 澄清漏斗：draftsWithBatch / draftsWithOrder 必须**能变成非 0**。
//      今天的库里它们都是 0（键没接上），如果写死成永 0，键接上了也看不出来。
//      所以这里种一条 need_id = 草案 id 的候选批次，断言它 +1。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorDecisionEligibilityReadsTheRealStateMachine(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	before, err := store.DecisionEligibility(ctx, now)
	if err != nil {
		t.Fatalf("DecisionEligibility 基线（列名一错就是这里）: %v", err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	users := []string{"user_de_a_" + run, "user_de_b_" + run, "user_de_c_" + run}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM decision.user_event_states WHERE user_id = ANY($1)`, users)
	})

	// 三种档位各一条，其中一条故意是 ACTIVE_ORCHESTRATE —— 它在真库里应当永远是 0，
	// 但**计数器必须真的会计它**，否则「永远 0」和「数不出来」就分不开了。
	exec(`INSERT INTO decision.user_event_states (user_id, event_type, action_state, model_version, confidence, evidence_coverage, sample_events, computed_at)
		VALUES ($1,'BROWSE_ACTIVE','OBSERVE','test-de-v1',0.5,0.5,10,now()),
		       ($2,'BROWSE_ACTIVE','PASSIVE','test-de-v1',0.5,0.5,10,now()),
		       ($3,'CHAT_ACTIVE','ACTIVE_ORCHESTRATE','test-de-v1',0.5,0.5,10,now())`,
		users[0], users[1], users[2])

	after, err := store.DecisionEligibility(ctx, now)
	if err != nil {
		t.Fatalf("DecisionEligibility: %v", err)
	}
	d := func(a, b int64) int64 { return b - a }

	if got := d(before.TotalPeople, after.TotalPeople); got != 3 {
		t.Fatalf("状态数 +%d，种了 3 条", got)
	}
	// 这一条是重点：计数器必须真的会数 ACTIVE_ORCHESTRATE。
	if got := d(before.ActiveOrchestrate, after.ActiveOrchestrate); got != 1 {
		t.Fatalf("ACTIVE_ORCHESTRATE +%d，种了 1 条 —— 数不出来就等于「永远 0」是假的安全", got)
	}
	if got := d(before.EventTypes[0].People, after.EventTypes[0].People); got < 0 {
		t.Fatalf("event_types 排序变了，断言不可靠: %+v", after.EventTypes)
	}
	// model_version 混进来了，必须列出来（运营才知道状态不是一个口径）。
	found := false
	for _, v := range after.ModelVersions {
		if v == "test-de-v1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("model_versions 里没有 test-de-v1: %v", after.ModelVersions)
	}
	if after.LastComputedAt == nil {
		t.Fatal("last_computed_at 没带上 —— 没有它，运营会把陈旧判断当当前判断")
	}
}

func TestOperatorTrustEvidenceFlagsTheDispositionGap(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	before, err := store.TrustEvidence(ctx, now)
	if err != nil {
		t.Fatalf("TrustEvidence 基线: %v", err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	agentOK, agentExpired, agentNone := "agent_te_ok_"+run, "agent_te_bad_"+run, "agent_te_none_"+run
	reportID := "rep_te_" + run
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM moderation.reports WHERE id = $1`, reportID)
		_, _ = pool.Exec(bg, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id = ANY($1)`, []string{agentOK, agentExpired})
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE agent_id = ANY($1)`, []string{agentOK, agentExpired, agentNone})
	})

	// 一个没核验的服务者：Agents +1 且 RealNameMissing +1（「从没验过」≠「过期」）。
	exec(`INSERT INTO supply.agent_profiles (agent_id, name, bio, languages, status, created_at, updated_at)
		VALUES ($1,'没验过的小美','',$2,'ACTIVE',now(),now()), ($3,'验过的阿明','','[]','ACTIVE',now(),now()), ($4,'过期的阿花','','[]','ACTIVE',now(),now())`,
		agentNone, `[]`, agentOK, agentExpired)
	// 核验口径跟供给健康度页共用常量：VERIFIED 要 expires_at 在未来。
	exec(`INSERT INTO supply.seller_real_name_verifications
		(id, agent_id, user_account_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
		VALUES ($1,$2,NULL,'Nguyễn Văn A','CCCD','h-ok','VERIFIED','DOCUMENT','ops_te',now(),$3,now(),now()),
		       ($4,$5,NULL,'Trần Văn B','CCCD','h-bad','EXPIRED','DOCUMENT','ops_te',now(),$6,now(),now())`,
		"srn_te_ok_"+run, agentOK, now.AddDate(1, 0, 0), "srn_te_bad_"+run, agentExpired, now.Add(-time.Hour))
	// 一条举报。**不插处置** —— 要的就是「有举报、零处置」这个形状。
	exec(`INSERT INTO moderation.reports (id, reporter_id, target_type, target_id, reason, state, created_at, due_at)
		VALUES ($1,'user_te','POST','post_te','SPAM','SUBMITTED',now(),now())`, reportID)

	after, err := store.TrustEvidence(ctx, now)
	if err != nil {
		t.Fatalf("TrustEvidence: %v", err)
	}
	d := func(a, b int64) int64 { return b - a }

	if got := d(before.Agents, after.Agents); got != 3 {
		t.Fatalf("服务者 +%d，种了 3 个", got)
	}
	if got := d(before.RealNameVerified, after.RealNameVerified); got != 1 {
		t.Fatalf("核验通过 +%d —— 如果是 0，说明 expires_at 或 status 口径错了", got)
	}
	if got := d(before.RealNameExpired, after.RealNameExpired); got != 1 {
		t.Fatalf("核验过期 +%d", got)
	}
	if got := d(before.RealNameMissing, after.RealNameMissing); got != 1 {
		t.Fatalf("从没验过 +%d（种了 1 个没有核验记录的服务者）", got)
	}
	if got := d(before.ReportsAll, after.ReportsAll); got != 1 {
		t.Fatalf("举报（全量）+%d", got)
	}
	if got := d(before.Reports30d, after.Reports30d); got != 1 {
		t.Fatalf("举报（窗口）+%d", got)
	}
	// 核心断言：处置没动。这个形状正是 handler 那条 note 要说的事。
	if got := d(before.DispositionsAll, after.DispositionsAll); got != 0 {
		t.Fatalf("处置 +%d，这一条测试刻意不插处置", got)
	}
	if after.ReportsAll <= after.DispositionsAll {
		t.Fatalf("举报 %d ≤ 处置 %d —— 「有举报零处置」这个形状没造出来，断言就没意义了",
			after.ReportsAll, after.DispositionsAll)
	}
}

// draftsWithBatch / draftsWithOrder 必须**能变成非 0**。今天真库里它们都是 0
// （键没接上），如果实现写死了 0，键接好了也看不出来 —— 那这个数就是假的。
func TestOperatorClarificationFunnelCountsTheDownstreamLinks(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	before, err := store.ClarificationFunnel(ctx, now)
	if err != nil {
		t.Fatalf("ClarificationFunnel 基线: %v", err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	draftLinked, draftPlain := "draft_cf_linked_"+run, "draft_cf_plain_"+run
	batchID := "cb_cf_" + run
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.candidate_batches WHERE id = $1`, batchID)
		_, _ = pool.Exec(bg, `DELETE FROM demand.tasks WHERE id = $1`, draftLinked)
		_, _ = pool.Exec(bg, `DELETE FROM demand.task_drafts WHERE id = ANY($1)`, []string{draftLinked, draftPlain})
	})

	// 两条草案：一条 COMMITTED 且**真的被撮合过**，一条普通 DRAFT。
	exec(`INSERT INTO demand.task_drafts (id, owner_user_account_id, principal_type, principal_id, lifecycle, version, source_input, draft_progress, last_completed_step, changes, slots, updated_at)
		VALUES ($1,'user_cf','INDIVIDUAL','user_cf','COMMITTED',1,'陪诊',0,0,'{}','[]',now()),
		       ($2,'user_cf','INDIVIDUAL','user_cf','DRAFT',1,'还没想好',0,0,'{}','[]',now())`,
		draftLinked, draftPlain)
	// 关键一步：把候选批次的 need_id 指到那条草案上 —— 回连数必须因此 +1。
	exec(`INSERT INTO supply.candidate_batches (id, need_id, market_id, created_at, candidates, shortage, shortage_note, owner_principal_id)
		VALUES ($1,$2,'hanoi',now(),$3,false,'','user_cf')`,
		batchID, draftLinked, `[{"agentId":"agent_cf","name":"X"}]`)
	// canonical task 也落一条，让 COMMITTED 与 tasks 对得上。
	exec(`INSERT INTO demand.tasks (id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version, source_input, changes, created_at, updated_at)
		VALUES ($1,$2,'user_cf','INDIVIDUAL','user_cf','COMMITTED',1,'陪诊','{}',now(),now())`,
		draftLinked, draftLinked)

	after, err := store.ClarificationFunnel(ctx, now)
	if err != nil {
		t.Fatalf("ClarificationFunnel: %v", err)
	}
	d := func(a, b int64) int64 { return b - a }

	if got := d(before.Drafts, after.Drafts); got != 2 {
		t.Fatalf("草案 +%d，种了 2 条", got)
	}
	if got := d(before.DraftsCommitted, after.DraftsCommitted); got != 1 {
		t.Fatalf("COMMITTED +%d", got)
	}
	if got := d(before.CanonicalTasks, after.CanonicalTasks); got != 1 {
		t.Fatalf("canonical task +%d", got)
	}
	// 这一条是本测试存在的理由。
	if got := d(before.DraftsWithBatch, after.DraftsWithBatch); got != 1 {
		t.Fatalf("回连到候选批次 +%d —— 必须是 1：如果这里是 0，说明实现把断链写死了，键接好了也看不出来", got)
	}
	// 订单那条回连这一轮不种，必须还是 0（不能被批次那一条顺手带上去）。
	if got := d(before.DraftsWithOrder, after.DraftsWithOrder); got != 0 {
		t.Fatalf("回连到订单 +%d，这一轮没种订单，不许动", got)
	}
}

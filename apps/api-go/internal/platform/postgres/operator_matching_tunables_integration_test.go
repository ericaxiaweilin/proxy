package postgres

// OPS-MATCHING-TUNABLES-001：撮合引擎旋钮的存储与决策留痕读模型，对**真库**跑。
//
// 为什么又是一条集成测试而不是只靠 api 层的假存储：internal/api 那边的测试证明的是
// 门、校验、审计、界面字段，它一个字节都不碰 SQL。这一页初稿踩过的坑就在上一个 commit 里
// —— `WHERE status='PENDING'` 数着一张从来没有 status 列的表，内存桩全绿、真库解析期就炸。
// 这里钉的是：表真的建出来了（migration 179）、列名真的是那些、upsert 的 version 真的按
// key 各自增长、candidates 里存的快照真的读得回来、以及一行形状不对的快照不能把整页抹掉。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
)

func TestOperatorMatchingTunablesStoreRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := matching.NewPostgres(pool)
	// 这些 key 就是引擎正在用的那一份，测试期间被本文件写进库里；跑完必须清干净，
	// 不然常驻的 dev API 下次启动会加载我这个探针写的数（那才是真的污染线上口径）。
	keys := []string{"reliabilityWeight", "fitPoints"}
	t.Cleanup(func() {
		bg := context.Background()
		if _, err := pool.Exec(bg, `DELETE FROM decision.engine_tunables WHERE key = ANY($1)`, keys); err != nil {
			t.Errorf("cleanup operator matching tunables: %v", err)
		}
		matching.SetTunables(matching.DefaultTunables())
	})
	if _, err := pool.Exec(ctx, `DELETE FROM decision.engine_tunables WHERE key = ANY($1)`, keys); err != nil {
		t.Fatalf("table decision.engine_tunables missing or unreadable: %v", err)
	}

	// 出厂状态：这两项没有行 = 没有覆盖 = 用默认值。
	stored, err := store.TunableOverrides(ctx)
	if err != nil {
		t.Fatalf("TunableOverrides: %v", err)
	}
	for _, k := range keys {
		if _, ok := stored[k]; ok {
			t.Fatalf("%s 不该在库里（这里不 seed 默认值，缺行就是默认）", k)
		}
	}

	// 一次写两个：都要在，version 都从 1 起，updated_by 是真过的门的那个 principal。
	versions, err := store.SetTunableOverrides(ctx, map[string]float64{"reliabilityWeight": 45, "fitPoints": 8}, "op_probe")
	if err != nil {
		t.Fatalf("SetTunableOverrides: %v", err)
	}
	if versions["reliabilityWeight"] != 1 || versions["fitPoints"] != 1 {
		t.Fatalf("versions = %v, want both 1", versions)
	}
	stored, err = store.TunableOverrides(ctx)
	if err != nil {
		t.Fatalf("TunableOverrides after write: %v", err)
	}
	got := stored["reliabilityWeight"]
	if got.Value != 45 || got.UpdatedBy != "op_probe" || got.Version != 1 || got.UpdatedAt.IsZero() {
		t.Fatalf("读回来的那一行不对: %+v", got)
	}

	// 只改一项：version 按 key 各自增长 —— 界面回答的是「这一项上次谁改的」，
	// 全量一份时间戳会把另外几项的来历一起冲掉。
	versions, err = store.SetTunableOverrides(ctx, map[string]float64{"fitPoints": 3}, "op_probe2")
	if err != nil {
		t.Fatalf("second write: %v", err)
	}
	if versions["fitPoints"] != 2 {
		t.Fatalf("fitPoints version = %d, want 2（UPSERT 没走对 key）", versions["fitPoints"])
	}
	stored, _ = store.TunableOverrides(ctx)
	if stored["reliabilityWeight"].Version != 1 || stored["reliabilityWeight"].UpdatedBy != "op_probe" {
		t.Fatalf("改 fitPoints 把 reliabilityWeight 的来历也动了: %+v", stored["reliabilityWeight"])
	}

	// 没署名「谁改的」必须写不进去。
	if _, err := pool.Exec(ctx, `INSERT INTO decision.engine_tunables (key, value, updated_by, updated_at, version)
		VALUES ('neutralResponse', 0.5, '', now(), 1)`); err == nil {
		t.Fatal("updated_by 为空的行插进去了 —— 查不到是谁改的引擎口径")
	}

	// 启动加载：库里有覆盖 → 生效值跟着走；这是真库跑出来的数，不是桩喂的。
	msg := matching.ApplyStoredTunables(ctx, store)
	if msg == "" {
		t.Fatal("加载完连一句话都没有")
	}
	if got := matching.CurrentTunables(); got.FitPoints != 3 || got.ReliabilityWeight != 45 {
		t.Fatalf("ApplyStoredTunables(%q) 没把库里的覆盖生效: %+v", msg, got)
	}
}

func TestOperatorMatchingDecisionTraceReadsStoredSnapshots(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := matching.NewPostgres(pool)
	run := itoa(time.Now().UnixNano())
	ids := []string{"cb_trace_rank_" + run, "cb_trace_plain_" + run, "cb_trace_broken_" + run}
	t.Cleanup(func() {
		bg := context.Background()
		if _, err := pool.Exec(bg, `DELETE FROM supply.candidate_batches WHERE id = ANY($1)`, ids); err != nil {
			t.Errorf("cleanup candidate batches: %v", err)
		}
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	// 基线：本机库里本来就有几次撮合留痕，所以下面全部按差值断言，不写绝对数。
	var beforeBatches, beforeRanked int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE jsonb_typeof(candidates) = 'array' AND EXISTS (
			SELECT 1 FROM jsonb_array_elements(candidates) c WHERE jsonb_typeof(c) = 'object' AND c ? 'ranking'))
		FROM supply.candidate_batches`).Scan(&beforeBatches, &beforeRanked); err != nil {
		t.Fatalf("baseline totals: %v", err)
	}

	const insert = `INSERT INTO supply.candidate_batches (id, need_id, market_id, created_at, candidates, shortage, shortage_note)
		VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`
	// ① 带得分明细的一批（MATCH-RANK-001 之后的形状）。
	exec(insert, ids[0], "need_trace_"+run, "hanoi", time.Now().UTC().Add(-time.Hour),
		`[{"agentId":"agent_a","name":"阿明","referencePrice":300000,"currency":"VND","ranking":{"reliability":30.5,"total":66.25}},
		  {"agentId":"agent_b","name":"小美","referencePrice":200000,"currency":"VND","ranking":{"reliability":12,"total":40}}]`,
		false, nil)
	// ② 早于 MATCH-RANK-001 的一批：有候选但没有 ranking。
	exec(insert, ids[1], "need_trace2_"+run, "hanoi", time.Now().UTC().Add(-48*time.Hour),
		`[{"agentId":"agent_c","name":"小美","referencePrice":200000}]`, true, "候选不够")
	// ③ 形状不对的一批（对象而不是数组）。整页不能被它搞挂。
	exec(insert, ids[2], "need_trace3_"+run, "hanoi", time.Now().UTC().Add(-72*time.Hour),
		`{"oops":"not an array"}`, false, nil)

	batches, summary, err := store.DecisionTrace(ctx, 10)
	if err != nil {
		t.Fatalf("DecisionTrace: %v（列名 / JSON path 一错就是这里）", err)
	}
	if got := summary.Batches - beforeBatches; got != 3 {
		t.Fatalf("盘子里多了 %d 次撮合，种了 3 次", got)
	}
	if got := summary.WithRank - beforeRanked; got != 1 {
		t.Fatalf("带得分明细的多出 %d（只有 ① 有 ranking）", got)
	}
	byID := map[string]matching.TraceBatch{}
	for _, b := range batches {
		byID[b.BatchID] = b
	}
	first, ok := byID[ids[0]]
	if !ok {
		t.Fatalf("最近的那批没在页上: %v", ids[0])
	}
	if first.CandidateCount != 2 || len(first.Candidates) != 2 {
		t.Fatalf("候选数不对: %+v", first)
	}
	if first.Candidates[0].Ranking == nil || first.Candidates[0].Ranking.Reliability != 30.5 || first.Candidates[0].Ranking.Total != 66.25 {
		t.Fatalf("存下来的得分明细没读回来: %+v", first.Candidates[0])
	}
	if first.ShortageNote != "" {
		t.Fatalf("没有 note 的批次读出了东西: %q", first.ShortageNote)
	}
	plain := byID[ids[1]]
	if plain.CandidateCount != 1 || plain.Candidates[0].Ranking != nil || !plain.Shortage || plain.ShortageNote != "候选不够" {
		t.Fatalf("早期快照（无 ranking + shortage）读错: %+v", plain)
	}
	broken, ok := byID[ids[2]]
	if !ok {
		t.Fatal("形状不对的那一批把整页带崩了（它应该只让自己显示成读不出候选）")
	}
	if broken.CandidateCount != 0 || broken.Candidates != nil {
		t.Fatalf("坏快照应该读成 0 个候选: %+v", broken)
	}
	if summary.Oldest.IsZero() || summary.Newest.IsZero() {
		t.Fatalf("盘子大小没带上时间: %+v", summary)
	}
}

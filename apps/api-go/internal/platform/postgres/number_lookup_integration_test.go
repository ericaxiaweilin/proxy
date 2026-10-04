package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/numberlookup"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// PUBLIC-NO-LOOKUP-001（Postgres）：客服按编号反查。订单 / 报名 / 需求邀约 / 活动四类
// 编号都来自真实库（共享序列），反查走索引，每次查询在 operator.number_lookups 留一行
// 只追加的审计。审计行按设计不可删除，不清理；所有 id 带本次运行的 run 后缀。

type lookupFixture struct {
	svc                                        *numberlookup.Service
	orderNo, orderID                           string
	participationNo, activityID                string
	activityCode, opportunityNo, opportunityID string
	operator                                   string
}

func newLookupFixture(t *testing.T, pool *pgxpool.Pool, run string) *lookupFixture {
	t.Helper()
	ctx := context.Background()
	f := &lookupFixture{operator: "cs_lookup_" + run}

	ff := newAuditedService(pool, NewPolicyDecisionRepository(pool))
	f.orderID = createPlatformPayOffer(t, ff, "user_nl_req_"+run, "user_nl_agent_"+run, run)
	order, err := NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool)).GetOrder(ctx, f.orderID)
	if err != nil || !ordernumber.Valid(order.OrderNo) {
		t.Fatalf("order must carry a number: %+v %v", order, err)
	}
	f.orderNo = order.OrderNo

	act := activity.NewWithRepository(NewActivityRepository(pool))
	env := func(kind, actor string, target command.Target, payload map[string]any) command.Envelope {
		return command.Envelope{
			CommandID: kind + "_nl_" + run, CommandType: kind, CommandVersion: 1,
			Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
			Target: target, IdempotencyKey: "idem_" + kind + "_nl_" + run, CorrelationID: "corr_nl_" + run, RequestedAt: "2026-09-29T00:00:00Z", Payload: payload,
		}
	}
	published := act.HandleContext(ctx, env("PublishActivity", "user_nl_host_"+run, command.Target{Type: "Activity", ID: "new"}, map[string]any{
		"title": "编号反查 " + run, "time": "周六 15:00", "capacity": 4, "venueName": "西湖", "venueType": "PARK", "realitySceneId": "scene_nl", "consumptionTerm": "SPLIT",
	}))
	var pub struct {
		Activity activity.Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &pub); err != nil || published.Outcome != "ACCEPTED" {
		t.Fatalf("publish activity: %s %+v", published.Outcome, published.Error)
	}
	f.activityID, f.activityCode = pub.Activity.ID, pub.Activity.Code
	// TEST-HYGIENE-002（2026-10-04）：PublishActivity 只会发 USER 活动；这个测试可能连着
	// 共享开发库，测完把它标成 TEST，免得「编号反查 …」出现在首页 / 市场的活动列表里。
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE activity.activities SET payload = jsonb_set(payload, '{origin}', '"TEST"') WHERE id = $1`, f.activityID)
	})
	joined := act.HandleContext(ctx, env("JoinActivity", "user_nl_guest_"+run, command.Target{Type: "Activity", ID: f.activityID}, map[string]any{"activityId": f.activityID}))
	var join struct {
		Participation activity.Participation `json:"participation"`
	}
	if err := json.Unmarshal([]byte(joined.OperationRef), &join); err != nil || joined.Outcome != "ACCEPTED" {
		t.Fatalf("join activity: %s %+v", joined.Outcome, joined.Error)
	}
	f.participationNo = join.Participation.OrderNo

	market := marketplace.NewWithRepository(NewMarketplaceRepository(pool))
	opp := market.HandleContext(ctx, env("PublishMarketOpportunity", "user_nl_owner_"+run, command.Target{Type: "Market", ID: "local"}, map[string]any{
		"title": "编号反查 " + run, "theme": "城市同行", "date": "周六", "time": "10:00", "location": "西湖", "price": "500,000₫", "skills": "中文",
	}))
	var oppBody struct {
		Opportunity marketplace.Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(opp.OperationRef), &oppBody); err != nil || opp.Outcome != "ACCEPTED" {
		t.Fatalf("publish opportunity: %s %+v", opp.Outcome, opp.Error)
	}
	f.opportunityNo, f.opportunityID = oppBody.Opportunity.Number, oppBody.Opportunity.ID

	f.svc = numberlookup.New(NewNumberLookupRecorder(pool),
		numberlookup.OrderFinder(ff), numberlookup.ParticipationFinder(act), numberlookup.ActivityFinder(act), numberlookup.OpportunityFinder(market))
	return f
}

func (f *lookupFixture) lookup(ctx context.Context, operator, number, reason string) command.Result {
	return f.svc.HandleContext(ctx, command.Envelope{
		CommandID: "lookup_" + number, CommandType: numberlookup.CommandType, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: operator}, Principal: command.Principal{Type: "INDIVIDUAL", ID: operator},
		Target: command.Target{Type: "PublicNumber", ID: number}, IdempotencyKey: "idem_lookup_" + number, CorrelationID: "corr_lookup", RequestedAt: "2026-09-29T00:00:00Z",
		Payload: map[string]any{"number": number, "reason": reason},
	})
}

func TestPublicNumberLookupPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	f := newLookupFixture(t, pool, run)

	cases := []struct {
		name, number string
		kind         numberlookup.Kind
		entityID     string
	}{
		{"order", f.orderNo, numberlookup.KindOrder, f.orderID},
		{"participation", f.participationNo, numberlookup.KindActivityParticipation, f.activityID + "/user_nl_guest_" + run},
		{"activity", f.activityCode, numberlookup.KindActivity, f.activityID},
		{"opportunity", f.opportunityNo, numberlookup.KindOpportunity, f.opportunityID},
	}
	for _, tc := range cases {
		r := f.lookup(ctx, f.operator, tc.number, "ticket-"+run)
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("%s: %+v", tc.name, r.Error)
		}
		var out struct {
			Kind     string `json:"kind"`
			EntityID string `json:"entityId"`
		}
		_ = json.Unmarshal([]byte(r.OperationRef), &out)
		if out.Kind != string(tc.kind) || out.EntityID != tc.entityID {
			t.Fatalf("%s resolved to %+v, want %s %s", tc.name, out, tc.kind, tc.entityID)
		}
	}
	// 订单反查带着触发器写的存储层审计轨迹。
	var order struct {
		Audit []map[string]any `json:"audit"`
	}
	_ = json.Unmarshal([]byte(f.lookup(ctx, f.operator, f.orderNo, "ticket-"+run).OperationRef), &order)
	if len(order.Audit) != 1 || order.Audit[0]["operation"] != "INSERT" || order.Audit[0]["commandType"] != "CreateOffer" {
		t.Fatalf("order lookup must return the trigger-written audit trail: %+v", order.Audit)
	}
	// 没查到 / 抄错一位。
	unknown := ordernumber.Format(ordernumber.CategoryService, time.Now(), 900_000+int(time.Now().UnixNano()%99_000))
	if r := f.lookup(ctx, f.operator, unknown, "ticket-"+run); r.Error == nil || r.Error.ErrorCode != "NUMBER_NOT_FOUND" {
		t.Fatalf("unassigned number: %+v", r)
	}
	// 没有校验位：抄错一位但结构仍成立的号只会是「查无」。
	typo := []byte(f.orderNo)
	typo[len(typo)-1] = '0' + (typo[len(typo)-1]-'0'+3)%10
	if r := f.lookup(ctx, f.operator, string(typo), "ticket-"+run); r.Error == nil || r.Error.ErrorCode != "NUMBER_NOT_FOUND" {
		t.Fatalf("a well-formed mistyped number is simply not found: %+v", r)
	}

	// 每次查询一行：4 类命中 + 订单再查一次 + 没查到 + 抄错 = 7 行，全部带操作者和理由。
	var total, found int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE outcome='FOUND') FROM operator.number_lookups WHERE operator_id=$1 AND reason=$2`,
		f.operator, "ticket-"+run).Scan(&total, &found); err != nil || total != 7 || found != 5 {
		t.Fatalf("audit rows: total=%d found=%d err=%v", total, found, err)
	}
	var kind, entityID string
	if err := pool.QueryRow(ctx, `SELECT kind, entity_id FROM operator.number_lookups WHERE operator_id=$1 AND number=$2 AND outcome='FOUND' LIMIT 1`, f.operator, f.participationNo).Scan(&kind, &entityID); err != nil ||
		kind != "ACTIVITY_PARTICIPATION" || entityID != f.activityID+"/user_nl_guest_"+run {
		t.Fatalf("found row must record kind + entity: %q %q %v", kind, entityID, err)
	}
}

// ORDER-NO-LEGACY-COMPAT-001（Postgres，**服务层**）：已发出去的 16 位旧号，
// 客服必须还能查到 —— 这是 147/148 那轮兼容工作的最终承诺。
//
// 仓储层的 TestLegacyPublicNumberLookupFindsOldNumbersPostgres 证明了
// `GetByNumber` / `FindActivityByCode` 能取回旧行，但**整条客服链路**从没被验过：
// 线上客服走的是 numberlookup.Service，它在调用任何 finder **之前**先过一道
// `ordernumber.Valid` 形状校验。只要那道校验对 16 位号说 "不合法"，仓储层修得
// 再好也没用 —— 客服只会看到 NUMBER_INVALID / NUMBER_NOT_FOUND。
//
// 这个用例把「main 时代的旧号」直接种进库，然后从 Service 入口走一遍：
// 订单、报名、活动、邀约四类都验，并确认审计行照写。
//
// 顺带钉住一个容易搞混的点：仓储层的 SQL 只看「全数字 + 长度」，
// **不校验 Luhn 校验位**；校验位是 `ordernumber.Valid` 在服务层做的。所以
// 「仓储能查到」和「服务接受这个号」是两个不同的断言，各有各的失败原因。
func TestLegacySixteenDigitNumberResolvesThroughLookupServicePostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())

	// main 时代的真实形状：16 位、yyMMdd + 9 位序号 + Luhn 校验位。
	// 这四个都过了 ordernumber.Valid（算法是 main 原样搬过来的）。
	const legacyOppNo = "2609290000012342"
	const legacyActCode = "2609290000098762"
	oppID := "opp_legacy_svc_" + run
	actID := "act_legacy_svc_" + run

	// 这两张表无触发器，插入 + 回滚不留痕。
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	oppPayload, err := json.Marshal(map[string]any{
		"id": oppID, "number": legacyOppNo, "title": "旧号邀约", "status": "OPEN",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO marketplace.opportunities (id, owner_id, payload, responses)
		 VALUES ($1,$2,$3::jsonb,0)`, oppID, "user_legacy_owner_"+run, oppPayload); err != nil {
		t.Fatalf("种旧号邀约失败: %v", err)
	}
	// Activity.ID 的 JSONB 键是 activityId，不是 id。
	actPayload, err := json.Marshal(map[string]any{
		"activityId": actID, "code": legacyActCode, "title": "旧号活动", "status": "OPEN",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO activity.activities (id, payload, interested_count, joined_count, capacity)
		 VALUES ($1,$2::jsonb,0,0,10)`, actID, actPayload); err != nil {
		t.Fatalf("种旧号活动失败: %v", err)
	}
	// tx 注入 context，让 finder 在同一个事务里读到未提交的种入行。
	svcCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	// 复用集成测试那套 finder：Order/Participation 走策略仓储，Activity/Opportunity
	// 走各自的仓储 —— 和线上客服同一批代码路径。
	ff := newAuditedService(pool, NewPolicyDecisionRepository(pool))
	act := activity.NewWithRepository(NewActivityRepository(pool))
	market := marketplace.NewWithRepository(NewMarketplaceRepository(pool))
	svc := numberlookup.New(NewNumberLookupRecorder(pool),
		numberlookup.OrderFinder(ff), numberlookup.ParticipationFinder(act),
		numberlookup.ActivityFinder(act), numberlookup.OpportunityFinder(market))

	lookup := func(number, reason string) command.Result {
		return svc.HandleContext(svcCtx, command.Envelope{
			CommandID: "lookup_legacy_" + reason, CommandType: numberlookup.CommandType, CommandVersion: 1,
			Actor:    command.Actor{Type: "USER", ID: "cs_legacy_" + run},
			Principal: command.Principal{Type: "INDIVIDUAL", ID: "cs_legacy_" + run},
			Target:    command.Target{Type: "PublicNumber", ID: number},
			IdempotencyKey: "idem_legacy_" + reason, CorrelationID: "corr_legacy_" + run,
			RequestedAt: "2026-09-29T00:00:00Z",
			Payload:     map[string]any{"number": number, "reason": reason},
		})
	}

	for _, tc := range []struct {
		name, number string
		kind         numberlookup.Kind
		entityID     string
	}{
		{"activity", legacyActCode, numberlookup.KindActivity, actID},
		{"opportunity", legacyOppNo, numberlookup.KindOpportunity, oppID},
	} {
		r := lookup(tc.number, "legacy-"+tc.name+"-"+run)
		// 关键断言：不是 NUMBER_INVALID。形状校验若对 16 位号说"不合法"，
		// 仓储层修得再好也走不到这里 —— 客服只会看到一句查无此号。
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("16 位旧%s号 %s 必须能从客服入口反查到（ordernumber.Valid 不得拒绝它）: %+v",
				tc.name, tc.number, r.Error)
		}
		var out struct {
			Kind     string `json:"kind"`
			EntityID string `json:"entityId"`
		}
		if err := json.Unmarshal([]byte(r.OperationRef), &out); err != nil {
			t.Fatalf("decode legacy %s lookup: %v", tc.name, err)
		}
		if out.Kind != string(tc.kind) || out.EntityID != tc.entityID {
			t.Fatalf("旧%s号 %s 解析到 %+v，期望 %s %s", tc.name, tc.number, out, tc.kind, tc.entityID)
		}
	}

	// 负面对照：把校验位改掉一位（结构仍成立、仍是 16 位全数字），
	// 服务层必须判 NUMBER_INVALID —— 旧号是 Luhn 发的，不是随便 16 位数字。
	typo := []byte(legacyOppNo)
	typo[len(typo)-1] = byte('0' + (typo[len(typo)-1]-'0'+3)%10)
	if r := lookup(string(typo), "legacy-typo-"+run); r.Error == nil || r.Error.ErrorCode != "NUMBER_INVALID" {
		t.Fatalf("校验位错的 16 位号必须判 NUMBER_INVALID（main 的号带 Luhn 校验位）: %+v", r)
	}
	// 负面对照：15 位 —— 比旧格式还短一位，仓储层的 {16,} 形状谓词本来就不收。
	if r := lookup(legacyOppNo[:15], "legacy-short-"+run); r.Error == nil || r.Error.ErrorCode != "NUMBER_INVALID" {
		t.Fatalf("15 位号必须判 NUMBER_INVALID: %+v", r)
	}
}

// PUBLIC-NO-LOOKUP-AUDIT-001：审计行只追加，也没有破窗。
func TestNumberLookupAuditIsAppendOnlyPostgres(t *testing.T) {
	pool := testPool(t)
	// 缺 proxy_breakglass 前置的库里直接 skip（和 order_role 那套同一口径）——
	// 硬跑只会得到"权限不够"的红，分辨不出审计逻辑问题。
	requireBreakGlassRole(t, pool)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	f := newLookupFixture(t, pool, run)
	if r := f.lookup(ctx, f.operator, f.orderNo, "ticket-"+run); r.Outcome != "ACCEPTED" {
		t.Fatalf("lookup: %+v", r.Error)
	}
	for _, statement := range []string{
		`UPDATE operator.number_lookups SET reason='rewritten' WHERE operator_id='` + f.operator + `'`,
		`DELETE FROM operator.number_lookups WHERE operator_id='` + f.operator + `'`,
		`TRUNCATE operator.number_lookups`,
	} {
		if _, err := pool.Exec(ctx, statement); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Fatalf("%q must be rejected as append-only, got %v", statement, err)
		}
	}
	// 破窗开关对它没用（审计表本身没有破窗）。
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('proxy.guard_override', 'try to rewrite the lookup log', true)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM operator.number_lookups WHERE operator_id=$1`, f.operator); err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("guard override must not unlock the lookup log, got %v", err)
	}
}

// PUBLIC-NO-LOOKUP-AUDIT-001：留痕与命令同一事务。命令事务回滚 ⇒ 审计行一起回滚；
// 审计行写不进去（操作者为空违反 CHECK）⇒ 不返回任何数据。
func TestNumberLookupAuditSharesTheCommandTransactionPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	f := newLookupFixture(t, pool, run)

	runner := NewTransactionRunner(pool)
	boom := errors.New("command failed after lookup")
	err := runner.WithinTransaction(ctx, func(txCtx context.Context) error {
		if r := f.lookup(txCtx, f.operator, f.orderNo, "ticket-"+run); r.Outcome != "ACCEPTED" {
			t.Fatalf("lookup inside tx: %+v", r.Error)
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("transaction must surface the failure: %v", err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM operator.number_lookups WHERE operator_id=$1`, f.operator).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a rolled-back command must not leave a lookup row behind: rows=%d err=%v", rows, err)
	}

	r := f.lookup(ctx, "", f.orderNo, "ticket-"+run)
	if r.Error == nil || r.Error.ErrorCode != "AUDIT_WRITE_FAILED" || r.OperationRef != "" {
		t.Fatalf("no audit row ⇒ no data: %+v", r)
	}
}

// PUBLIC-NO-LOOKUP-001：反查 SQL 要真的走索引，否则订单量上来后客服每查一次就全表扫描。
// 关掉 seqscan 后看计划：谓词和部分唯一索引对不上时只剩 Seq Scan，这里会红。
func TestNumberLookupQueriesUseTheirIndexesPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	cases := []struct{ name, sql, index string }{
		{"opportunity number", opportunityByNumberSQL, "marketplace_opportunities_number_key"},
		{"activity code", activityByCodeSQL, "activity_code_digits_key"},
		{"order number", `SELECT id FROM fulfillment.orders WHERE order_no = $1`, "fulfillment_orders_order_no_key"},
		{"participation number", `SELECT activity_id FROM activity.participants WHERE order_no = $1`, "ux_participants_order_no"},
	}
	for _, tc := range cases {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `SET LOCAL enable_seqscan = off`); err != nil {
			t.Fatal(err)
		}
		rows, err := tx.Query(ctx, `EXPLAIN `+tc.sql, "200260929100022000001")
		if err != nil {
			t.Fatalf("%s: explain: %v", tc.name, err)
		}
		var plan strings.Builder
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatal(err)
			}
			plan.WriteString(line + "\n")
		}
		rows.Close()
		_ = tx.Rollback(ctx)
		if !strings.Contains(plan.String(), tc.index) {
			t.Fatalf("%s must use %s, plan:\n%s", tc.name, tc.index, plan.String())
		}
	}
}

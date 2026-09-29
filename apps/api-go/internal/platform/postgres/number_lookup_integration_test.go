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
	unknown := ordernumber.Format(900_000_000+time.Now().UnixNano()%99_000_000, time.Now())
	if r := f.lookup(ctx, f.operator, unknown, "ticket-"+run); r.Error == nil || r.Error.ErrorCode != "NUMBER_NOT_FOUND" {
		t.Fatalf("unassigned number: %+v", r)
	}
	typo := []byte(f.orderNo)
	typo[len(typo)-1] = '0' + (typo[len(typo)-1]-'0'+3)%10
	if r := f.lookup(ctx, f.operator, string(typo), "ticket-"+run); r.Error == nil || r.Error.ErrorCode != "NUMBER_INVALID" {
		t.Fatalf("typo: %+v", r)
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

// PUBLIC-NO-LOOKUP-AUDIT-001：审计行只追加，也没有破窗。
func TestNumberLookupAuditIsAppendOnlyPostgres(t *testing.T) {
	pool := testPool(t)
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
		{"participation number", `SELECT activity_id FROM activity.participants WHERE order_no = $1`, "activity_participants_order_no_key"},
	}
	for _, tc := range cases {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `SET LOCAL enable_seqscan = off`); err != nil {
			t.Fatal(err)
		}
		rows, err := tx.Query(ctx, `EXPLAIN `+tc.sql, "2609290000000016")
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

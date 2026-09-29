package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
)

// 订单存储层审计 / 回滚 / 守卫（2026-09-28 订单管线审计）。只用本次运行生成的 id；
// 订单与审计行按设计不可删除，不清理；只清掉本 run 自己发布的 outbox 消息（cleanupRunOutbox）。

type failingStampRepository struct{ *PolicyDecisionRepository }

func (failingStampRepository) Stamp(context.Context, policydecisions.OrderStamp) error {
	return errors.New("stamp storage unavailable")
}

func newAuditedService(pool *pgxpool.Pool, policyRepo policydecisions.Repository) *fulfillment.Service {
	svc := fulfillment.NewWithRepository(NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool)))
	return svc.WithPolicyDecisions(policydecisions.NewService(policyRepo, "terms-test", "privacy-test", nil))
}

func createPlatformPayOffer(t *testing.T, svc *fulfillment.Service, requesterID, agentID, run string) string {
	t.Helper()
	r := svc.HandleContext(context.Background(), ffEnvelope("CreateOffer", map[string]any{
		"needId": "need_audit_" + run, "agentId": agentID, "serviceSku": "cc_8h", "duration": "8H",
		"agreedCompensation": 1200000, "currency": "VND", "settlementMode": "PLATFORM_PAY", "paymentMethodLabel": "Proxy 钱包",
	}, requesterID, requesterID, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateOffer: %+v", r.Error)
	}
	return readStringFF(r.OperationRef, "orderId")
}

type auditRow struct {
	Operation, OldState, NewState, Actor, CommandType, Events, Override string
	OldVersion, NewVersion                                              *int
}

func readAudit(t *testing.T, pool *pgxpool.Pool, table, rowID string) []auditRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT operation, COALESCE(old_state,''), COALESCE(new_state,''), actor_id, command_type, event_types, override_reason, old_version, new_version
		FROM fulfillment.audit_log WHERE table_name=$1 AND row_id=$2 ORDER BY audit_id`, table, rowID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []auditRow{}
	for rows.Next() {
		var a auditRow
		if err := rows.Scan(&a.Operation, &a.OldState, &a.NewState, &a.Actor, &a.CommandType, &a.Events, &a.Override, &a.OldVersion, &a.NewVersion); err != nil {
			t.Fatal(err)
		}
		out = append(out, a)
	}
	return out
}

// POLICY-STAMP-DURABLE-001：LC-28 决策与盖章落 Postgres；盖章与订单迁移同事务。
// ORDER-AUDIT-001：每次写入都在同一事务里留下审计行（谁、哪条命令、前后状态）。
func TestOrderTransitionIsStampedAndAuditedPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	requesterID, agentID := "user_audit_req_"+run, "user_audit_agent_"+run
	svc := newAuditedService(pool, NewPolicyDecisionRepository(pool))

	orderID := createPlatformPayOffer(t, svc, requesterID, agentID, run)
	r := svc.HandleContext(ctx, ffEnvelope("ConfirmCooperation", map[string]any{}, agentID, agentID, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ConfirmCooperation: %+v", r.Error)
	}
	decisionID := readStringFF(r.OperationRef, "policyDecisionId")
	var stamped int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM policy.order_decisions od JOIN policy.policy_decisions pd ON pd.id = od.decision_id
		WHERE od.order_id=$1 AND od.decision_id=$2 AND od.stamped_lifecycle='CONFIRMED' AND pd.user_id=$3`, orderID, decisionID, requesterID).Scan(&stamped); err != nil || stamped != 1 {
		t.Fatalf("CONFIRMED stamp must be persisted with its decision row: count=%d err=%v", stamped, err)
	}

	audit := readAudit(t, pool, "orders", orderID)
	if len(audit) != 2 {
		t.Fatalf("expected INSERT + UPDATE audit rows, got %+v", audit)
	}
	if a := audit[0]; a.Operation != "INSERT" || a.NewState != "OFFERED" || a.Actor != requesterID || a.CommandType != "CreateOffer" {
		t.Fatalf("insert audit row: %+v", a)
	}
	if a := audit[1]; a.Operation != "UPDATE" || a.OldState != "OFFERED" || a.NewState != "CONFIRMED" || a.Actor != agentID ||
		a.CommandType != "ConfirmCooperation" || a.Events != "CooperationConfirmed" || *a.OldVersion != 1 || *a.NewVersion != 2 {
		t.Fatalf("update audit row: %+v", a)
	}
	// 审计行里有完整的前后行：任何历史版本都能还原。
	var before, after json.RawMessage
	if err := pool.QueryRow(ctx, `SELECT row_before, row_after FROM fulfillment.audit_log WHERE table_name='orders' AND row_id=$1 AND operation='UPDATE'`, orderID).Scan(&before, &after); err != nil || len(before) == 0 || len(after) == 0 {
		t.Fatalf("audit row must carry full before/after rows: %v", err)
	}
}

// POLICY-STAMP-DURABLE-001：以前盖章在事务外、错误被丢弃 —— 订单进了 CONFIRMED，
// 监管记录却没有。现在盖章失败 = 整个迁移回滚：订单、outbox 事件、审计行都不留。
func TestStampFailureRollsBackTransitionPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	requesterID, agentID := "user_rb_req_"+run, "user_rb_agent_"+run
	svc := newAuditedService(pool, failingStampRepository{NewPolicyDecisionRepository(pool)})

	orderID := createPlatformPayOffer(t, svc, requesterID, agentID, run)
	r := svc.HandleContext(ctx, ffEnvelope("ConfirmCooperation", map[string]any{}, agentID, agentID, orderID))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "POLICY_STAMP_FAILED" {
		t.Fatalf("a failed stamp must reject the confirmation, got %s %+v", r.Outcome, r.Error)
	}
	order, err := NewFulfillmentRepository(pool).GetOrder(ctx, orderID)
	if err != nil || order.Lifecycle != "OFFERED" || order.Version != 1 || order.PolicyDecisionID != "" {
		t.Fatalf("order must be rolled back to OFFERED v1: %+v %v", order, err)
	}
	var confirmedEvents int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1 AND event_type='CooperationConfirmed'`, orderID).Scan(&confirmedEvents)
	if confirmedEvents != 0 {
		t.Fatalf("the CooperationConfirmed event must be rolled back too, found %d", confirmedEvents)
	}
	if audit := readAudit(t, pool, "orders", orderID); len(audit) != 1 || audit[0].Operation != "INSERT" {
		t.Fatalf("a rolled-back transition must leave no audit row: %+v", audit)
	}
}

// ORDER-FSM-001 / ORDER-AUDIT-001：绕过服务层的写入也过不了数据库守卫；
// 审计表只追加；破窗写入会把理由记进审计。
func TestOrderGuardAndAppendOnlyAuditPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	requesterID, agentID := "user_guard_req_"+run, "user_guard_agent_"+run
	svc := newAuditedService(pool, NewPolicyDecisionRepository(pool))
	orderID := createPlatformPayOffer(t, svc, requesterID, agentID, run)

	illegal := map[string]string{
		"skip to COMPLETED":  `UPDATE fulfillment.orders SET lifecycle='COMPLETED', version=version+1 WHERE id=$1`,
		"version not bumped": `UPDATE fulfillment.orders SET lifecycle='CONFIRMED' WHERE id=$1`,
		"identity change":    `UPDATE fulfillment.orders SET agent_id='someone_else', version=version+1 WHERE id=$1`,
		"silent re-price":    `UPDATE fulfillment.orders SET snapshot=jsonb_set(snapshot,'{agreedCompensation}','1'), version=version+1 WHERE id=$1`,
		"hard delete":        `DELETE FROM fulfillment.orders WHERE id=$1`,
	}
	for name, sql := range illegal {
		if _, err := pool.Exec(ctx, sql, orderID); err == nil {
			t.Fatalf("%s must be rejected by the database guard", name)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at) VALUES ($1,'a','b','n','COMPLETED',1,'{}',now(),now())`, "ord_guard_bad_"+run); err == nil {
		t.Fatal("orders must not be born COMPLETED")
	}
	for name, sql := range map[string]string{
		"audit update": `UPDATE fulfillment.audit_log SET actor_id='forged' WHERE row_id=$1`,
		"audit delete": `DELETE FROM fulfillment.audit_log WHERE row_id=$1`,
	} {
		if _, err := pool.Exec(ctx, sql, orderID); err == nil {
			t.Fatalf("%s must be rejected: audit_log is append-only", name)
		}
	}

	// 破窗：事务内声明理由后允许更正，理由进审计行。
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('proxy.guard_override', 'ticket-42 operator correction', true), set_config('proxy.audit_actor', 'ops_oncall', true)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE fulfillment.orders SET lifecycle='CANCELLED', version=version+1 WHERE id=$1`, orderID); err != nil {
		t.Fatalf("break-glass correction: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	audit := readAudit(t, pool, "orders", orderID)
	last := audit[len(audit)-1]
	if last.NewState != "CANCELLED" || last.Override != "ticket-42 operator correction" || last.Actor != "ops_oncall" {
		t.Fatalf("break-glass write must be audited with its reason: %+v", last)
	}
}

// ORDER-FSM-001：守卫不能误伤合法流程 —— 完整生命周期（含条款变更接受、双方结算、
// 满意度）和「取消时未决提议作废」都必须能在 Postgres 上走通，且每步都有审计行。
func TestFullLifecyclePassesGuardPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	requesterID, agentID := "user_life_req_"+run, "user_life_agent_"+run
	svc := newAuditedService(pool, NewPolicyDecisionRepository(pool))
	step := func(name, actor, orderID string, payload map[string]any) string {
		t.Helper()
		r := svc.HandleContext(ctx, ffEnvelope(name, payload, actor, actor, orderID))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("%s: %+v", name, r.Error)
		}
		return r.OperationRef
	}
	created := step("CreateOffer", requesterID, "", map[string]any{
		"needId": "need_life_" + run, "agentId": agentID, "serviceSku": "cc_8h", "duration": "8H",
		"agreedCompensation": 1200000, "currency": "VND",
	})
	orderID := readStringFF(created, "orderId")
	step("ConfirmCooperation", agentID, orderID, map[string]any{})
	proposal := step("RecordMaterialOrderChange", requesterID, orderID, map[string]any{"description": "改时间改价", "changes": map[string]any{"agreedCompensation": 1500000, "startTime": "10:00"}})
	step("RespondMaterialOrderChange", agentID, orderID, map[string]any{"amendmentId": readStringFF(proposal, "amendmentId"), "decision": "ACCEPT"})
	step("StartExecution", agentID, orderID, map[string]any{})
	step("RecordDirectSettlement", requesterID, orderID, map[string]any{"agreedAmount": 1500000})
	step("RecordDirectSettlement", agentID, orderID, map[string]any{"agreedAmount": 1500000})
	step("RecordOutcome", agentID, orderID, map[string]any{"onTime": true, "scopeCompleted": true})
	step("RecordSatisfaction", requesterID, orderID, map[string]any{"resolved": "FULL", "repeatIntent": "REUSE"})

	order, err := NewFulfillmentRepository(pool).GetOrder(ctx, orderID)
	if err != nil || order.Lifecycle != "COMPLETED" || order.Snapshot.AgreedCompensation != 1500000 || order.Version != 9 {
		t.Fatalf("full lifecycle result: %+v %v", order, err)
	}
	states := []string{}
	for _, a := range readAudit(t, pool, "orders", orderID) {
		states = append(states, a.NewState)
	}
	want := []string{"OFFERED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "EXECUTING", "EXECUTING", "EXECUTING", "COMPLETED", "COMPLETED"}
	if len(states) != len(want) {
		t.Fatalf("one audit row per write: got %v want %v", states, want)
	}
	for i := range want {
		if states[i] != want[i] {
			t.Fatalf("audit trail: got %v want %v", states, want)
		}
	}

	second := readStringFF(step("CreateOffer", requesterID, "", map[string]any{"needId": "need_life2_" + run, "agentId": agentID, "agreedCompensation": 800000}), "orderId")
	step("ConfirmCooperation", agentID, second, map[string]any{})
	step("RecordMaterialOrderChange", agentID, second, map[string]any{"description": "改地点", "changes": map[string]any{"meetingContext": "老城区"}})
	step("CancelOrder", requesterID, second, map[string]any{"reason": "plans changed"})
	cancelled, _ := NewFulfillmentRepository(pool).GetOrder(ctx, second)
	if cancelled.Lifecycle != "CANCELLED" || cancelled.Amendments[0].Status != fulfillment.AmendmentLapsed {
		t.Fatalf("cancel with a pending proposal: %+v", cancelled)
	}
}

// ORDER-MATERIALIZE-AUDIT-001：物化订单的出生事件只在首次插入时随订单同事务发布；
// ORDER-AUDIT-001：GetOrderAuditTrail 从存储层审计读出完整轨迹。
func TestMaterializedOrderEventOnceAndAuditTrailPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	repo := NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	orderNo, err := NewOrderNumberAllocator(pool).Next(ctx, ordernumber.CategoryService)
	if err != nil {
		t.Fatal(err)
	}
	order, err := fulfillment.MaterializedOrder("ord_inv_mat_"+run, orderNo, "user_mat_req_"+run, "user_mat_agent_"+run, "scene_"+run, fulfillment.OrderSnapshot{AgreedCompensation: 150000}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := repo.EnsureOrder(ctx, order, []event.DomainEvent{fulfillment.MaterializedEvent(order, "scene", "inv_mat_"+run)}); err != nil {
			t.Fatalf("EnsureOrder #%d: %v", i, err)
		}
	}
	var births int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1 AND event_type='OrderMaterialized'`, order.ID).Scan(&births); err != nil || births != 1 {
		t.Fatalf("OrderMaterialized must be published exactly once, got %d (%v)", births, err)
	}
	audit := readAudit(t, pool, "orders", order.ID)
	if len(audit) != 1 || audit[0].Actor != "system:scene" || audit[0].NewState != "CONFIRMED" {
		t.Fatalf("materialisation must leave one attributed audit row: %+v", audit)
	}

	svc := fulfillment.NewWithRepository(repo)
	if r := svc.HandleContext(ctx, ffEnvelope("CancelOrder", map[string]any{"reason": "host cancelled"}, order.RequesterID, order.RequesterID, order.ID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", r.Error)
	}
	r := svc.HandleContext(ctx, ffEnvelope("GetOrderAuditTrail", map[string]any{}, order.AgentID, order.AgentID, order.ID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("audit trail: %+v", r.Error)
	}
	var view struct {
		Entries []fulfillment.AuditEntry `json:"entries"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Entries) != 2 || view.Entries[1].CommandType != "CancelOrder" || view.Entries[1].ActorID != order.RequesterID || view.Entries[1].NewState != "CANCELLED" {
		t.Fatalf("audit trail entries: %+v", view.Entries)
	}
}

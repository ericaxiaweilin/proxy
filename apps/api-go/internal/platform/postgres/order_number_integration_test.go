package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// ORDER-NO-001：迁移里的 SQL 编号格式（回填用）必须和 Go 的 ordernumber.Format 逐字一致。
func TestOrderNumberSQLMatchesGo(t *testing.T) {
	pool := testPool(t)
	at := time.Date(2026, 9, 28, 23, 30, 0, 0, time.UTC) // 越南已是 09-29
	for _, sequence := range []int64{1, 1234, 999_999_999, 1_000_000_000} {
		var fromSQL string
		if err := pool.QueryRow(context.Background(), `SELECT fulfillment.format_order_no($1, $2)`, sequence, at).Scan(&fromSQL); err != nil {
			t.Fatal(err)
		}
		if want := ordernumber.Format(sequence, at); fromSQL != want {
			t.Fatalf("sequence %d: SQL %q != Go %q", sequence, fromSQL, want)
		}
	}
}

func activityCommand(kind, actor, activityID string) command.Envelope {
	return command.Envelope{
		CommandID: kind + "_" + actor, CommandType: kind, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target: command.Target{Type: "Activity", ID: activityID}, IdempotencyKey: "idem_" + kind + actor,
		CorrelationID: "corr_" + actor, RequestedAt: "2026-09-29T00:00:00Z",
		Payload: map[string]any{"activityId": activityID},
	}
}

// ACT-PARTICIPATION-DURABLE-001 / ACT-SEAT-RELEASE-001 / ACT-ORDER-NO-001（Postgres）：
// 报名带自己的全数字编号；换一个 Service 实例（= 进程重启）后仍能取消；取消释放名额；
// 再报名沿用同一个编号。
func TestParticipationDurableSeatReleasePostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	repo := NewActivityRepository(pool)
	activityID := "act_seat_" + run
	if err := repo.Create(ctx, activity.Activity{ID: activityID, Title: "Seat test", Time: "周六", People: "0 / 1 人", Price: "0₫", Consumption: "AA", VenueIcon: "☕", VenueName: "Three Beans", Desc: "d", Benefit: "b", Capacity: 1, Origin: "USER", OwnerID: "owner_" + run}); err != nil {
		t.Fatal(err)
	}
	numbers := NewOrderNumberAllocator(pool)
	first := activity.NewWithRepository(repo)
	first.SetOrderNumbers(numbers)
	requester, other := "user_seat_a_"+run, "user_seat_b_"+run

	joined := first.HandleContext(ctx, activityCommand("JoinActivity", requester, activityID))
	var view struct {
		Participation activity.Participation `json:"participation"`
	}
	_ = json.Unmarshal([]byte(joined.OperationRef), &view)
	if joined.Outcome != "ACCEPTED" || !ordernumber.Valid(view.Participation.OrderNo) {
		t.Fatalf("join must return an all-digit order number: %s %+v %s", joined.Outcome, joined.Error, joined.OperationRef)
	}
	if r := first.HandleContext(ctx, activityCommand("JoinActivity", other, activityID)); r.Error == nil || r.Error.ErrorCode != "ACTIVITY_FULL" {
		t.Fatalf("capacity 1 must be full: %+v", r)
	}

	restarted := activity.NewWithRepository(NewActivityRepository(pool)) // 新进程：没有任何内存状态
	restarted.SetOrderNumbers(numbers)
	if r := restarted.HandleContext(ctx, activityCommand("CancelActivity", requester, activityID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel after restart must find the durable participation: %+v", r.Error)
	}
	var joinedCount int
	var state, stored string
	if err := pool.QueryRow(ctx, `SELECT a.joined_count, p.state, p.order_no FROM activity.activities a JOIN activity.participants p ON p.activity_id=a.id WHERE a.id=$1 AND p.actor_id=$2`, activityID, requester).Scan(&joinedCount, &state, &stored); err != nil {
		t.Fatal(err)
	}
	if joinedCount != 0 || state != "CANCELLED" || stored != view.Participation.OrderNo {
		t.Fatalf("cancel must release the seat and keep the record: joined=%d state=%s no=%s", joinedCount, state, stored)
	}
	if r := restarted.HandleContext(ctx, activityCommand("JoinActivity", other, activityID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("released seat must be joinable: %+v", r.Error)
	}
	if r := restarted.HandleContext(ctx, activityCommand("CancelActivity", other, activityID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel other: %+v", r.Error)
	}
	again := restarted.HandleContext(ctx, activityCommand("JoinActivity", requester, activityID))
	_ = json.Unmarshal([]byte(again.OperationRef), &view)
	if again.Outcome != "ACCEPTED" || view.Participation.OrderNo != stored {
		t.Fatalf("re-join must reuse order number %s: %s %+v", stored, again.Outcome, again.Error)
	}
	dup := restarted.HandleContext(ctx, activityCommand("JoinActivity", requester, activityID))
	if dup.Error == nil || dup.Error.ErrorCode != "ACTIVITY_ALREADY_JOINED" || dup.Error.SafeDetails["orderNo"] != stored {
		t.Fatalf("ALREADY_JOINED must carry the existing order number: %+v", dup.Error)
	}
}

// ORDER-NO-001（Postgres）：履约订单落库带编号；编号不可改、必须全数字（数据库守卫）。
func TestFulfillmentOrderNumberPersistedAndImmutablePostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	svc := fulfillment.NewWithRepository(NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool))).WithOrderNumbers(NewOrderNumberAllocator(pool))
	r := svc.HandleContext(ctx, ffEnvelope("CreateOffer", map[string]any{
		"needId": "need_no_" + run, "agentId": "user_no_agent_" + run, "agreedCompensation": 800000,
	}, "user_no_req_"+run, "user_no_req_"+run, ""))
	orderID, orderNo := readStringFF(r.OperationRef, "orderId"), readStringFF(r.OperationRef, "orderNo")
	if r.Outcome != "ACCEPTED" || !ordernumber.Valid(orderNo) {
		t.Fatalf("CreateOffer: %s %+v %s", r.Outcome, r.Error, r.OperationRef)
	}
	stored, err := NewFulfillmentRepository(pool).GetOrder(ctx, orderID)
	if err != nil || stored.OrderNo != orderNo {
		t.Fatalf("order number must round-trip through Postgres: %q vs %q (%v)", stored.OrderNo, orderNo, err)
	}
	for name, sql := range map[string]string{
		"change": `UPDATE fulfillment.orders SET order_no='2609299999999990', version=version+1 WHERE id=$1`,
		"clear":  `UPDATE fulfillment.orders SET order_no=NULL, version=version+1 WHERE id=$1`,
	} {
		if _, err := pool.Exec(ctx, sql, orderID); err == nil {
			t.Fatalf("%s order_no must be rejected by the database guard", name)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at, order_no) VALUES ($1,'a','b','n','OFFERED',1,'{}',now(),now(),'PX-A-260929-1234')`, "ord_bad_no_"+run); err == nil {
		t.Fatal("a non-digit order number must be rejected")
	}
}

// ORDER-NO-001：用 PG 仓库构造、没显式注入分配器的 Service，默认也必须走共享序列。
// 以前默认是进程内计数器 —— 两个实例都从 1 发号，在同一个库里撞唯一约束、下单失败
// （第二轮的 PG 审计测试就这样红了）。
func TestPostgresBackedServicesDefaultToSharedSequence(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		svc := fulfillment.NewWithRepository(NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool)))
		r := svc.HandleContext(ctx, ffEnvelope("CreateOffer", map[string]any{
			"needId": "need_seq_" + run, "agentId": "user_seq_agent_" + run, "agreedCompensation": 500000,
		}, "user_seq_req_"+run, "user_seq_req_"+run, ""))
		orderNo := readStringFF(r.OperationRef, "orderNo")
		if r.Outcome != "ACCEPTED" || !ordernumber.Valid(orderNo) || seen[orderNo] {
			t.Fatalf("instance %d: %s %+v orderNo=%q", i, r.Outcome, r.Error, orderNo)
		}
		seen[orderNo] = true
	}
	act := activity.NewWithRepository(NewActivityRepository(pool))
	activityID := "act_seq_" + run
	if err := NewActivityRepository(pool).Create(ctx, activity.Activity{ID: activityID, Title: "Seq", Time: "周六", People: "0 人", Price: "0₫", Consumption: "AA", VenueIcon: "☕", VenueName: "Three Beans", Desc: "d", Benefit: "b", Capacity: 3, Origin: "USER", OwnerID: "owner_" + run}); err != nil {
		t.Fatal(err)
	}
	joined := act.HandleContext(ctx, activityCommand("JoinActivity", "user_seq_join_"+run, activityID))
	var view struct {
		Participation activity.Participation `json:"participation"`
	}
	_ = json.Unmarshal([]byte(joined.OperationRef), &view)
	if joined.Outcome != "ACCEPTED" || !ordernumber.Valid(view.Participation.OrderNo) || seen[view.Participation.OrderNo] {
		t.Fatalf("activity join must draw from the same sequence: %s %+v %q", joined.Outcome, joined.Error, view.Participation.OrderNo)
	}
}

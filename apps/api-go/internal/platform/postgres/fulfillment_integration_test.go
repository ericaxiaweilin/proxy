package postgres

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// TestFulfillmentPostgresLifecycle covers the M4 acceptance chain through
// real PostgreSQL: CreateSlotOffer → AcceptSlotOffer → start → check-in →
// evidence → confirm cooperation. Includes two-agent race (concurrent
// accept on the same offer must yield exactly one order) and stale-Offer
// rejection (accept after TTL must be REJECTED, no order created).
func TestFulfillmentPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := fulfillment.NewWithRepository(repo)
	allowSlotOffersPG(svc)

	run := time.Now().UnixNano()
	taskID := "task_ff_pg_" + itoa(run)
	slotID := "slot_ff_pg_" + itoa(run)
	agentID := "agent_ff_pg_" + itoa(run)
	requesterID := "user_ff_pg_req_" + itoa(run)

	// 1. Create a slot offer (requester → agent). 5-minute TTL.
	r := svc.HandleContext(ctx, ffEnvelope("CreateSlotOffer", map[string]any{
		"taskId": taskID, "slotId": slotID, "agentId": agentID,
		"agreedCompensation": 800000, "currency": "VND",
	}, requesterID, agentID, taskID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateSlotOffer: %+v", r.Error)
	}
	if r.Aggregate.State != "OFFERED" {
		t.Fatalf("new offer must be OFFERED, got %s", r.Aggregate.State)
	}
	offerID := readStringFF(r.OperationRef, "offerId")
	if offerID == "" {
		t.Fatalf("CreateSlotOffer: missing offerId, op=%s", r.OperationRef)
	}

	// 2. Stale offer: seed a separate offer with an already-past
	// expires_at directly through the repo, then accept must be
	// REJECTED with OFFER_EXPIRED.
	staleOffer := fulfillment.Offer{
		ID:          "off_pg_stale_" + itoa(run),
		TaskID:      taskID + "_stale",
		SlotID:      slotID + "_stale",
		RequesterID: requesterID,
		AgentID:     agentID,
		Status:      "OFFERED",
		ExpiresAt:   time.Now().Add(-1 * time.Hour),
		Version:     1,
		CreatedAt:   time.Now().Add(-2 * time.Hour),
		UpdatedAt:   time.Now().Add(-2 * time.Hour),
	}
	if err := repo.CreateOffer(ctx, staleOffer); err != nil {
		t.Fatalf("seed stale: %v", err)
	}
	r = svc.HandleContext(ctx, ffEnvelope("AcceptSlotOffer", map[string]any{
		"offerId": staleOffer.ID,
	}, agentID, agentID, staleOffer.ID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("stale accept must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "OFFER_EXPIRED" {
		t.Fatalf("expected OFFER_EXPIRED, got %+v", r.Error)
	}

	// 3. Accept the live slot offer. Must produce an Order + flip offer
	// to ACCEPTED in one transaction. Note AcceptSlotOffer creates the
	// Order already in CONFIRMED state (different from CreateOffer's
	// OFFERED state).
	r = svc.HandleContext(ctx, ffEnvelope("AcceptSlotOffer", map[string]any{
		"offerId": offerID,
	}, agentID, agentID, offerID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("AcceptSlotOffer: %+v", r.Error)
	}
	orderID := readStringFF(r.OperationRef, "orderId")
	if orderID == "" {
		t.Fatalf("AcceptSlotOffer: missing orderId, op=%s", r.OperationRef)
	}
	// Verify the offer row is now ACCEPTED in PG.
	got, err := repo.GetOffer(ctx, offerID)
	if err != nil {
		t.Fatalf("GetOffer after accept: %v", err)
	}
	if got.Status != "ACCEPTED" {
		t.Fatalf("offer must be ACCEPTED, got %s", got.Status)
	}

	// 4. Two-agent race: a second AcceptSlotOffer on the already-ACCEPTED
	// offer must be REJECTED with OFFER_NOT_AVAILABLE, not silently
	// create a second order. (The concurrent goroutine race is covered
	// by the dedicated TestFulfillmentPostgresConcurrentAcceptsOnlyOneOrder
	// test below.)
	r = svc.HandleContext(ctx, ffEnvelope("AcceptSlotOffer", map[string]any{
		"offerId": offerID,
	}, agentID, agentID, offerID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("second accept must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "OFFER_NOT_AVAILABLE" {
		t.Fatalf("expected OFFER_NOT_AVAILABLE, got %+v", r.Error)
	}

	// 5. The order from AcceptSlotOffer is already CONFIRMED. CheckInOrder
	// flips it to EXECUTING.
	o, err := repo.GetOrder(ctx, orderID)
	if err != nil {
		t.Fatalf("GetOrder: %v", err)
	}
	if o.Lifecycle != "CONFIRMED" {
		t.Fatalf("order must be CONFIRMED, got %s", o.Lifecycle)
	}
	r = svc.HandleContext(ctx, ffEnvelope("CheckInOrder", map[string]any{
		"orderId": orderID, "marketId": "hn", "locationLabel": "河内·还剑湖",
	}, agentID, agentID, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CheckInOrder: %+v", r.Error)
	}
	r = svc.HandleContext(ctx, ffEnvelope("SubmitEvidence", map[string]any{
		"orderId": orderID, "mediaAssetId": "media_pg_" + itoa(run), "evidenceType": "PHOTO",
	}, agentID, agentID, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SubmitEvidence: %+v", r.Error)
	}

	// 6. ConfirmCooperation: only legal on an OFFERED order. Our
	// slot-offer-accept path skips OFFERED (it goes directly to
	// CONFIRMED), so this must be REJECTED with ORDER_NOT_CONFIRMABLE.
	// We assert the rejection to prove the gate is enforced on the PG
	// path the same way the in-memory path enforces it.
	r = svc.HandleContext(ctx, ffEnvelope("ConfirmCooperation", map[string]any{
		"orderId": orderID,
	}, requesterID, agentID, orderID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("ConfirmCooperation on slot-accept order must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "ORDER_NOT_CONFIRMABLE" {
		t.Fatalf("expected ORDER_NOT_CONFIRMABLE, got %+v", r.Error)
	}

	// 7. Traceable-human-order happy path: CreateOffer (lifecycle=OFFERED)
	// then ConfirmCooperation (→ CONFIRMED) then StartExecution (→
	// EXECUTING) then RecordDirectSettlement (DIRECT_SETTLEMENT mode,
	// no platform funding) then RecordOutcome (→ COMPLETED).
	r = svc.HandleContext(ctx, ffEnvelope("CreateOffer", map[string]any{
		"needId": "need_pg_" + itoa(run), "agentId": agentID,
		"serviceSku": "cc_8h", "needVersion": "need_v3", "routeVersion": "route_v2",
		"duration": "8H", "startTime": "2026-08-20T09:30:00Z",
		"meetingContext": "还剑湖正门", "agreedCompensation": 1200000, "currency": "VND",
		"includedScope": "8 小时陪同 + 拍照", "excludedScope": "门票 / 餐饮",
		"settlementMode": "DIRECT_SETTLEMENT", "paymentMethodLabel": "线下现金",
	}, requesterID, agentID, taskID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateOffer: %+v", r.Error)
	}
	traceOrderID := readStringFF(r.OperationRef, "orderId")
	if traceOrderID == "" {
		t.Fatalf("CreateOffer: missing orderId, op=%s", r.OperationRef)
	}
	// ORDER-CONFIRM-AGENT-001: 确认合作是服务方的同意。
	r = svc.HandleContext(ctx, ffEnvelope("ConfirmCooperation", map[string]any{}, agentID, agentID, traceOrderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "CONFIRMED" {
		t.Fatalf("ConfirmCooperation: outcome=%s state=%s err=%+v", r.Outcome, r.Aggregate.State, r.Error)
	}
	r = svc.HandleContext(ctx, ffEnvelope("StartExecution", map[string]any{}, agentID, agentID, traceOrderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "EXECUTING" {
		t.Fatalf("StartExecution: outcome=%s state=%s err=%+v", r.Outcome, r.Aggregate.State, r.Error)
	}
	r = svc.HandleContext(ctx, ffEnvelope("RecordDirectSettlement", map[string]any{
		"agreedAmount": 1200000, "paymentMethodLabel": "线下现金",
		"payerConfirmed": true,
	}, requesterID, agentID, traceOrderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RecordDirectSettlement: %+v", r.Error)
	}
	// ORDER-SETTLE-GUARD-001: 收款方自己确认自己那一侧。
	r = svc.HandleContext(ctx, ffEnvelope("RecordDirectSettlement", map[string]any{
		"agreedAmount": 1200000, "payeeConfirmed": true,
	}, agentID, agentID, traceOrderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RecordDirectSettlement countersign: %+v", r.Error)
	}
	r = svc.HandleContext(ctx, ffEnvelope("RecordOutcome", map[string]any{
		"onTime": true, "actualStart": "09:35", "actualEnd": "17:40",
		"materialChanges": 1, "scopeCompleted": true, "objectiveNote": "按约完成",
	}, agentID, agentID, traceOrderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "COMPLETED" {
		t.Fatalf("RecordOutcome: outcome=%s state=%s err=%+v", r.Outcome, r.Aggregate.State, r.Error)
	}
	r = svc.HandleContext(ctx, ffEnvelope("RecordSatisfaction", map[string]any{
		"resolved": "FULL", "repeatIntent": "REUSE",
	}, requesterID, agentID, traceOrderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RecordSatisfaction: %+v", r.Error)
	}

	// cleanup
	cleanupFulfillmentPG(t, pool, []any{orderID, offerID, staleOffer.ID, traceOrderID})
}

// TestFulfillmentPostgresConcurrentAcceptsOnlyOneOrder runs the two-agent
// race through real PostgreSQL with a TransactionRunner, to prove that
// the unique-accept contract holds under genuine concurrent goroutines
// (not just serial).
func TestFulfillmentPostgresConcurrentAcceptsOnlyOneOrder(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := fulfillment.NewWithRepository(repo)
	allowSlotOffersPG(svc)

	run := time.Now().UnixNano()
	taskID := "task_ff_race_" + itoa(run)
	slotID := "slot_ff_race_" + itoa(run)
	agentID := "agent_ff_race_" + itoa(run)
	requesterID := "user_ff_race_req_" + itoa(run)

	r := svc.HandleContext(ctx, ffEnvelope("CreateSlotOffer", map[string]any{
		"taskId": taskID, "slotId": slotID, "agentId": agentID,
		"agreedCompensation": 800000, "currency": "VND",
	}, requesterID, agentID, taskID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateSlotOffer: %+v", r.Error)
	}
	offerID := readStringFF(r.OperationRef, "offerId")

	// 5 goroutines, each trying to accept the same offer. Exactly one
	// must succeed.
	const N = 5
	var wg sync.WaitGroup
	results := make([]string, N)
	wg.Add(N)
	start := make(chan struct{})
	for i := 0; i < N; i++ {
		i := i
		go func() {
			defer wg.Done()
			<-start
			rr := svc.HandleContext(ctx, ffEnvelope("AcceptSlotOffer", map[string]any{
				"offerId": offerID,
			}, agentID, agentID, offerID))
			results[i] = rr.Outcome
		}()
	}
	close(start)
	wg.Wait()

	accepted := 0
	rejected := 0
	for _, o := range results {
		switch o {
		case "ACCEPTED":
			accepted++
		case "REJECTED":
			rejected++
		}
	}
	if accepted != 1 {
		t.Fatalf("exactly one goroutine must ACCEPT, got %d (rejected=%d)", accepted, rejected)
	}
	if rejected != N-1 {
		t.Fatalf("expected %d REJECTED, got %d", N-1, rejected)
	}

	// Exactly one order must exist for this offer.
	orderCount := 0
	rows, err := pool.Query(ctx, `SELECT id FROM fulfillment.orders WHERE need_id=$1`, taskID)
	if err != nil {
		t.Fatalf("query orders: %v", err)
	}
	for rows.Next() {
		orderCount++
		var id string
		_ = rows.Scan(&id)
	}
	rows.Close()
	if orderCount != 1 {
		t.Fatalf("exactly one order must exist for taskID=%s, got %d", taskID, orderCount)
	}

	cleanupFulfillmentPG(t, pool, []any{"", offerID, "", ""})
}

func cleanupFulfillmentPG(t *testing.T, pool *pgxpool.Pool, ids []any) {
	t.Helper()
	ctx := context.Background()
	orderID, _ := ids[0].(string)
	offerID, _ := ids[1].(string)
	staleOfferID, _ := ids[2].(string)
	traceOrderID, _ := ids[3].(string)
	if orderID != "" {
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.order_events WHERE order_id=$1`, orderID); err != nil {
			t.Logf("cleanup order_events: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.evidence WHERE order_id=$1`, orderID); err != nil {
			t.Logf("cleanup evidence: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.orders WHERE id=$1`, orderID); err != nil {
			t.Logf("cleanup orders: %v", err)
		}
	}
	if traceOrderID != "" {
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.order_events WHERE order_id=$1`, traceOrderID); err != nil {
			t.Logf("cleanup trace order_events: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.orders WHERE id=$1`, traceOrderID); err != nil {
			t.Logf("cleanup trace orders: %v", err)
		}
	}
	if offerID != "" {
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.offers WHERE id=$1`, offerID); err != nil {
			t.Logf("cleanup offers: %v", err)
		}
	}
	if staleOfferID != "" {
		if _, err := pool.Exec(ctx, `DELETE FROM fulfillment.offers WHERE id=$1`, staleOfferID); err != nil {
			t.Logf("cleanup stale offer: %v", err)
		}
	}
	// The schema does not always have order_events / evidence tables; suppress
	// those errors as best-effort cleanup.
	_ = offerID
}

func ffEnvelope(commandType string, payload map[string]any, actorID, principalID, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_ff_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: principalID},
		Target:         command.Target{Type: "Order", ID: targetID},
		IdempotencyKey: "test_ff_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_ff_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

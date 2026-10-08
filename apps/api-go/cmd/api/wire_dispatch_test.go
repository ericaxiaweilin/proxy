package main

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// DISPATCH-LOOP-001：发布的需求怎么变成派单的输入。预算只认「每档位固定价 + VND」。
func TestDispatchTaskReadsConsentBudgetAndOpenSlots(t *testing.T) {
	draft := demand.TaskDraft{
		ID: "task_1", OwnerUserAccountID: "req_1",
		Changes: map[string]any{
			"matchingMode": "FAST", "autoDispatch": true,
			"budget": map[string]any{"currency": "VND", "amountMinor": float64(1_200_000), "pricingMode": "PER_SLOT_FIXED"},
		},
		Slots: []demand.TaskSlot{{ID: "s1", State: "OPEN"}, {ID: "s2", State: "FILLED"}},
	}
	got := dispatchTaskFromDraft(draft)
	if got.TaskID != "task_1" || got.RequesterID != "req_1" || got.MatchingMode != "FAST" || !got.AutoDispatch ||
		got.BudgetVND != 1_200_000 || len(got.SlotIDs) != 1 || got.SlotIDs[0] != "s1" {
		t.Fatalf("dispatch task = %+v", got)
	}
	for name, budget := range map[string]map[string]any{
		"hourly":   {"currency": "VND", "amountMinor": float64(100_000), "pricingMode": "HOURLY"},
		"usd":      {"currency": "USD", "amountMinor": float64(5000), "pricingMode": "PER_SLOT_FIXED"},
		"zero":     {"currency": "VND", "amountMinor": float64(0), "pricingMode": "PER_SLOT_FIXED"},
		"no shape": nil,
	} {
		changes := map[string]any{"budget": budget}
		if budget == nil {
			changes = map[string]any{"budget": "1000000"}
		}
		if v := fixedVNDBudget(changes); v != 0 {
			t.Fatalf("%s budget must not be read as a fixed VND budget, got %d", name, v)
		}
	}
}

// 派单发邀约走的是**真的** CreateSlotOffer：同一道档位主人校验、同一张邀约、服务者照常去接。
// 假端口证明不了信封字段（Actor / Principal 类型、ttlSeconds、金额）对得上履约服务的口径。
func TestDispatchOffersGoThroughTheRealSlotOfferCommand(t *testing.T) {
	ctx := context.Background()
	svc := fulfillment.New()
	svc.SetSlotOfferAuthorizer(func(_ context.Context, taskID, slotID, requesterID, _ string) (bool, error) {
		return taskID == "task_1" && slotID == "s1" && requesterID == "req_1", nil
	})
	port := fulfillmentOfferPort{svc: svc}
	run := dispatch.Run{ID: "dr_1", TaskID: "task_1", SlotID: "s1", RequesterID: "req_1", BatchID: "cb_1", BudgetVND: 1_000_000}

	offerID, expiresAt, refused, err := port.Send(ctx, run, dispatch.Candidate{AgentID: "agent_a", Price: 900_000, Currency: "VND"}, dispatch.OfferTTL)
	if err != nil || refused != "" || offerID == "" {
		t.Fatalf("delegated offer must be created: id=%q refused=%q err=%v", offerID, refused, err)
	}
	if d := time.Until(expiresAt); d < 4*time.Minute || d > 6*time.Minute {
		t.Fatalf("offer TTL must be the 5 minutes the dispatcher asked for, got %v", d)
	}
	if st, err := port.Status(ctx, run, offerID); err != nil || st != "OFFERED" {
		t.Fatalf("fresh offer reads OFFERED: %q %v", st, err)
	}
	// 服务者在 App 里点接受 —— 与需求方亲手发的邀约是同一条路。
	accept := svc.HandleContext(ctx, command.Envelope{
		CommandID: "accept_1", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_a"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_a"},
		Target: command.Target{Type: "Offer", ID: offerID}, IdempotencyKey: "accept_1", AuthContext: map[string]any{},
		Purpose: "test", CorrelationID: "c", RequestedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{"offerId": offerID},
	})
	if accept.Outcome == "REJECTED" {
		t.Fatalf("agent accept: %+v", accept.Error)
	}
	if st, err := port.Status(ctx, run, offerID); err != nil || st != "ACCEPTED" {
		t.Fatalf("after the agent accepts the dispatcher reads ACCEPTED: %q %v", st, err)
	}

	// 不是这个档位的主人：命令被拒，派单把这一位记成「被拒」而不是重试。
	other := run
	other.RequesterID = "someone_else"
	if _, _, refused, err := port.Send(ctx, other, dispatch.Candidate{AgentID: "agent_b", Price: 900_000}, dispatch.OfferTTL); err != nil || refused != "SLOT_OFFER_NOT_ALLOWED" {
		t.Fatalf("a non-owner offer is refused by the same owner check: refused=%q err=%v", refused, err)
	}
}

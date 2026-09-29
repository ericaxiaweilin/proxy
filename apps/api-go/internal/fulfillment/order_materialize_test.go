package fulfillment

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// ORDER-MATERIALIZE-AUDIT-001：市场 / 场景物化的 CONFIRMED 订单以前不评估现金资格，
// 也不发任何订单事件。现在走同一个构造器：超限拒绝、出生事件只在首次插入时发布。
func TestMaterializedOrderGatesCashAndPublishesOnce(t *testing.T) {
	now := time.Now()
	if _, err := MaterializedOrder("ord_big", testOrderNo, "req", "agent", "scene_1", OrderSnapshot{AgreedCompensation: 9000000}, now); !errors.Is(err, ErrCashEligibility) {
		t.Fatalf("above the cash pilot limit must be ErrCashEligibility, got %v", err)
	}
	if _, err := MaterializedOrder("ord_self", testOrderNo, "same", "same", "scene_1", OrderSnapshot{}, now); err == nil {
		t.Fatal("an order needs two distinct parties")
	}
	order, err := MaterializedOrder("ord_ok", testOrderNo, "req", "agent", "scene_1", OrderSnapshot{AgreedCompensation: 150000}, now)
	if err != nil {
		t.Fatal(err)
	}
	if order.Lifecycle != "CONFIRMED" || order.Snapshot.CashEligibilityStatus != CashEligibilityAllow || order.Snapshot.Currency != "VND" || order.Snapshot.SettlementMode != "DIRECT_SETTLEMENT" {
		t.Fatalf("materialised order: %+v", order)
	}
	repo := NewMemoryRepository()
	for i := 0; i < 2; i++ {
		if err := repo.EnsureOrder(context.Background(), order, nil); err != nil {
			t.Fatal(err)
		}
	}
	repo = NewMemoryRepository()
	for i := 0; i < 2; i++ {
		if err := repo.EnsureOrder(context.Background(), order, []event.DomainEvent{MaterializedEvent(order, "scene", "inv_1")}); err != nil {
			t.Fatal(err)
		}
	}
	events := repo.Events()
	if len(events) != 1 || events[0].EventType != "OrderMaterialized" || events[0].Payload["source"] != "scene" {
		t.Fatalf("OrderMaterialized must be published exactly once, got %+v", events)
	}
}

// ORDER-SLOT-RELEASE-001：内存仓以前档位一旦被接过就永久占用，取消订单也不释放；
// PG 那边 uq_orders_slot_active 排除 CANCELLED。两边语义必须一致。
func TestCancelledSlotOrderReleasesSlot(t *testing.T) {
	s := New()
	first := createSlotOffer(t, s, "task_rel", "slot_rel", "agent_a")
	r := s.Handle(asActor(envelopeFor("AcceptSlotOffer", map[string]any{"offerId": first}, ""), "agent_a"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %+v", r.Error)
	}
	second := createSlotOffer(t, s, "task_rel", "slot_rel", "agent_b")
	if r := s.Handle(asActor(envelopeFor("AcceptSlotOffer", map[string]any{"offerId": second}, ""), "agent_b")); errorCode(r) != "SLOT_UNAVAILABLE" {
		t.Fatalf("an occupied slot must be SLOT_UNAVAILABLE, got %+v", r.Error)
	}
	if c := s.Handle(asActor(envelopeFor("CancelOrder", map[string]any{"reason": "no show"}, r.Aggregate.ID), "agent_a")); c.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", c.Error)
	}
	third := createSlotOffer(t, s, "task_rel", "slot_rel", "agent_c")
	if r := s.Handle(asActor(envelopeFor("AcceptSlotOffer", map[string]any{"offerId": third}, ""), "agent_c")); r.Outcome != "ACCEPTED" {
		t.Fatalf("a cancelled order must release its slot, got %+v", r.Error)
	}
}

var testOrderNo = ordernumber.Format(ordernumber.CategoryService, time.Date(2026, 9, 29, 0, 0, 0, 0, time.UTC), 42)

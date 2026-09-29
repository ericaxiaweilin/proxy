package fulfillment

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// ORDER-NO-001：每一条下单路径（报价、接档位、接主题邀约）都拿到一个全数字、
// 带校验位、互不重复的订单编号；列表 / 下单结果都带着它；编号不可改。
func TestEveryOrderGetsAnAllDigitOrderNumber(t *testing.T) {
	s := New()
	ctx := context.Background()
	numbers := map[string]string{}
	record := func(orderID string) {
		t.Helper()
		order, err := s.repository.GetOrder(ctx, orderID)
		if err != nil {
			t.Fatal(err)
		}
		if !ordernumber.Valid(order.OrderNo) {
			t.Fatalf("order %s has no valid all-digit order number: %q", orderID, order.OrderNo)
		}
		if other, dup := numbers[order.OrderNo]; dup {
			t.Fatalf("order number %s reused by %s and %s", order.OrderNo, other, orderID)
		}
		numbers[order.OrderNo] = orderID
	}

	r := s.Handle(envelopeFor("CreateOffer", offerPayload(), ""))
	var created struct {
		OrderID string `json:"orderId"`
		OrderNo string `json:"orderNo"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &created)
	if !ordernumber.Valid(created.OrderNo) {
		t.Fatalf("CreateOffer must return the order number, got %q", r.OperationRef)
	}
	record(created.OrderID)

	offerID := createSlotOffer(t, s, "task_no", "slot_no", "agent_no")
	accepted := s.Handle(asActor(envelopeFor("AcceptSlotOffer", map[string]any{"offerId": offerID}, ""), "agent_no"))
	record(accepted.Aggregate.ID)

	invite := s.Handle(envelopeFor("CreateTopicInvite", map[string]any{"agentId": "agent_topic_no", "topicKey": "coffee"}, ""))
	var inviteView struct {
		OfferID string `json:"offerId"`
	}
	_ = json.Unmarshal([]byte(invite.OperationRef), &inviteView)
	topic := s.Handle(asActor(envelopeFor("RespondTopicInvite", map[string]any{"offerId": inviteView.OfferID, "accept": true}, ""), "agent_topic_no"))
	record(topic.Aggregate.ID)

	list := s.Handle(envelopeFor("ListMyOrders", map[string]any{}, "mine"))
	var listed struct {
		Orders []struct {
			OrderNo string `json:"orderNo"`
		} `json:"orders"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &listed)
	for _, o := range listed.Orders {
		if _, ok := numbers[o.OrderNo]; !ok {
			t.Fatalf("ListMyOrders must carry order numbers, got %+v", listed.Orders)
		}
	}

	before, _ := s.repository.GetOrder(ctx, created.OrderID)
	after := cloneOrder(before)
	after.Version++
	after.OrderNo = ordernumber.Format(999, before.CreatedAt)
	if err := checkOrderTransition(before, after); err == nil {
		t.Fatal("an order number must never change")
	}
}

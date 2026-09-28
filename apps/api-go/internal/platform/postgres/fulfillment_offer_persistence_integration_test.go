package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// TOPIC-INVITE-PERSIST-001：CreateOfferAndPublish 的 INSERT 漏了 topic_key / note，
// 主题邀约在 PG 模式下落成空主题、空留言（内存仓没这个问题，单测全绿）。
// ORDER-OFFER-COMP-001：档位报价金额必须落库，接单生成的订单快照带上它。
// 只用本次运行生成的 id；结束时只清掉本 run 自己发布的 outbox 消息（cleanupRunOutbox）。
func TestOfferPersistsTopicAndCompensationPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	svc := fulfillment.NewWithRepository(NewFulfillmentRepositoryWithOutbox(pool, NewOutboxRepository(pool)))
	allowSlotOffersPG(svc)
	repo := NewFulfillmentRepository(pool)

	run := itoa(time.Now().UnixNano())
	cleanupRunOutbox(t, pool, run)
	requesterID := "user_offer_persist_" + run
	agentID := "agent_offer_persist_" + run

	r := svc.HandleContext(ctx, ffEnvelope("CreateTopicInvite", map[string]any{
		"agentId": agentID, "topicKey": "coffee", "note": "下午三点老城区",
	}, requesterID, requesterID, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateTopicInvite: %+v", r.Error)
	}
	inviteID := readStringFF(r.OperationRef, "offerId")
	invite, err := repo.GetOffer(ctx, inviteID)
	if err != nil {
		t.Fatal(err)
	}
	if invite.TopicKey != "coffee" || invite.Note != "下午三点老城区" {
		t.Fatalf("topic invite lost its topic/note in postgres: topic=%q note=%q", invite.TopicKey, invite.Note)
	}
	listed, err := repo.ListOffersByAgent(ctx, agentID)
	if err != nil || len(listed) != 1 || listed[0].TopicKey != "coffee" {
		t.Fatalf("agent inbox must show the topic: %+v %v", listed, err)
	}

	r = svc.HandleContext(ctx, ffEnvelope("CreateSlotOffer", map[string]any{
		"taskId": "task_offer_persist_" + run, "slotId": "slot_offer_persist_" + run,
		"agentId": agentID, "agreedCompensation": 800000, "currency": "VND",
	}, requesterID, requesterID, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateSlotOffer: %+v", r.Error)
	}
	slotOfferID := readStringFF(r.OperationRef, "offerId")
	stored, err := repo.GetOffer(ctx, slotOfferID)
	if err != nil || stored.AgreedCompensation != 800000 || stored.Currency != "VND" {
		t.Fatalf("slot offer compensation must persist: %+v %v", stored, err)
	}
	r = svc.HandleContext(ctx, ffEnvelope("AcceptSlotOffer", map[string]any{"offerId": slotOfferID}, agentID, agentID, slotOfferID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("AcceptSlotOffer: %+v", r.Error)
	}
	order, err := repo.GetOrder(ctx, readStringFF(r.OperationRef, "orderId"))
	if err != nil {
		t.Fatal(err)
	}
	if order.Snapshot.AgreedCompensation != 800000 || order.Snapshot.CashEligibilityStatus != fulfillment.CashEligibilityAllow {
		t.Fatalf("accepted order snapshot must carry the offered compensation: %+v", order.Snapshot)
	}
}

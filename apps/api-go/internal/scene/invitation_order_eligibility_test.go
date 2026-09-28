package scene

import (
	"context"
	"fmt"
	"testing"
)

type ineligibleInvitationOrderCreator struct{}

func (ineligibleInvitationOrderCreator) EnsureInvitationOrder(context.Context, InvitationOrderRecord) error {
	return fmt.Errorf("%w: cash pilot limit", ErrOrderNotEligible)
}

// ORDER-MATERIALIZE-AUDIT-001：邀约订单过不了现金门时是业务状态（需人工复核），
// 不能报成「稍后重试」；邀约保持 PENDING，不留下「已接受但没有订单」。
func TestRespondInvitation_IneligibleOrderIsBusinessState(t *testing.T) {
	svc := New()
	svc.SetInvitationOrderCreator(ineligibleInvitationOrderCreator{})
	payload := okCreatePayload()
	payload["budgetMinor"] = int64(9000000)
	created := svc.Handle(testEnvelope("CreateScene", "new", payload))
	sceneID := resultAggregateID(t, created)
	inv := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{"sceneId": sceneID, "inviteeUserId": "user_002", "card": okInviteCardPayload()}))
	invID := resultAggregateID(t, inv)
	r := svc.Handle(testEnvelopeAs("RespondInvitation", invID, "user_002", map[string]any{"decision": "ACCEPTED"}))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "INVITATION_ORDER_NOT_ELIGIBLE" || r.Error.Category != "BUSINESS_STATE" {
		t.Fatalf("expected INVITATION_ORDER_NOT_ELIGIBLE/BUSINESS_STATE, got %#v", r)
	}
	stored, err := svc.repo.GetInvitation(context.Background(), invID)
	if err != nil || stored.Status != "PENDING" {
		t.Fatalf("invitation must stay PENDING when its order is refused: %+v %v", stored, err)
	}
}

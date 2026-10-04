package supply

import (
	"encoding/json"
	"testing"
	"time"
)

// MERCHANT-CREATOR-INVITE-001：定向邀约全链路 —— 商家发 → 双方各能查 →
// creator 接/拒 → 商家可撤。鉴权两边各守一边：发必须带 merchantID，
// 回必须本人（Principal.ID == agentID）。

func inviteAs(t *testing.T, s *Service, payload map[string]any, merchantID string) map[string]any {
	t.Helper()
	env := envelopeFor("InviteCreator", payload, "")
	env.AuthContext = map[string]any{"merchantID": merchantID}
	r := s.Handle(env)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("invite: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		Invitation map[string]any `json:"invitation"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	return view.Invitation
}

func listInvitations(t *testing.T, s *Service, role, merchantID, principalID string) []map[string]any {
	t.Helper()
	env := envelopeForPrincipal("ListCollabInvitations", map[string]any{"role": role}, "", principalID)
	if merchantID != "" {
		env.AuthContext = map[string]any{"merchantID": merchantID}
	}
	r := s.Handle(env)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list %s: %s (%+v)", role, r.Outcome, r.Error)
	}
	var view struct {
		Invitations []map[string]any `json:"invitations"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Invitations == nil {
		return []map[string]any{}
	}
	return view.Invitations
}

func TestInviteCreatorFullLifecycle(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_invited", "Invited", []string{"ZH"}, "hn", 1200000)
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	inv := inviteAs(t, s, map[string]any{
		"agentId": "agent_invited", "serviceType": "CITY_COMPANION",
		"startAt": start, "durationH": 8, "priceVnd": 1200000,
		"currency": "VND", "message": "周末探店合作",
	}, "merchant_1")
	if inv["status"] != "PENDING" {
		t.Fatalf("new invitation must be PENDING, got %v", inv["status"])
	}
	if inv["merchantId"] != "merchant_1" || inv["priceVnd"] != float64(1200000) {
		t.Fatalf("invitation must carry merchant and terms, got %v", inv)
	}
	id, _ := inv["id"].(string)
	if id == "" {
		t.Fatal("invitation must have an id")
	}
	// 商家查发出的：1 张 PENDING。
	sent := listInvitations(t, s, "sent", "merchant_1", "business_001")
	if len(sent) != 1 || sent[0]["status"] != "PENDING" {
		t.Fatalf("merchant sent must hold 1 PENDING, got %v", sent)
	}
	// creator 查收到的：1 张 PENDING。
	received := listInvitations(t, s, "received", "", "agent_invited")
	if len(received) != 1 || received[0]["status"] != "PENDING" {
		t.Fatalf("agent received must hold 1 PENDING, got %v", received)
	}
	// creator 接受。
	r := s.Handle(envelopeForPrincipal("RespondCollabInvitation", map[string]any{
		"invitationId": id, "decision": "ACCEPTED",
	}, "", "agent_invited"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %s (%+v)", r.Outcome, r.Error)
	}
	// 接受后双方看到 ACCEPTED；再点一次直接拒（终态不能流转）。
	received = listInvitations(t, s, "received", "", "agent_invited")
	if len(received) != 1 || received[0]["status"] != "ACCEPTED" {
		t.Fatalf("after accept both sides must see ACCEPTED, got %v", received)
	}
	r = s.Handle(envelopeForPrincipal("RespondCollabInvitation", map[string]any{
		"invitationId": id, "decision": "DECLINED",
	}, "", "agent_invited"))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("terminal invitation must not transition again")
	}
}

func TestInviteCreatorGuards(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_guarded", "Guarded", []string{"ZH"}, "hn", 1200000)
	setupAgent(t, s, "agent_other", "Other", []string{"ZH"}, "hn", 1200000)

	// 没 merchant 身份不许邀。
	r := s.Handle(envelopeFor("InviteCreator", map[string]any{"agentId": "agent_guarded"}, ""))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("invite without merchantID must be rejected")
	}
	// 同一商家对同一人同时只能一张 PENDING。
	inviteAs(t, s, map[string]any{"agentId": "agent_guarded"}, "merchant_9")
	env := envelopeFor("InviteCreator", map[string]any{"agentId": "agent_guarded"}, "")
	env.AuthContext = map[string]any{"merchantID": "merchant_9"}
	r = s.Handle(env)
	if r.Outcome == "ACCEPTED" {
		t.Fatal("second PENDING invitation to the same agent must be rejected")
	}
	// 别人不能替她回；商家也不能替她回。
	sent := listInvitations(t, s, "sent", "merchant_9", "business_001")
	id, _ := sent[0]["id"].(string)
	r = s.Handle(envelopeForPrincipal("RespondCollabInvitation", map[string]any{
		"invitationId": id, "decision": "ACCEPTED",
	}, "", "agent_other"))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("another agent must not respond to her invitation")
	}
	// 拒绝走通，拒绝后商家撤回直接拒（终态不能撤）。
	r = s.Handle(envelopeForPrincipal("RespondCollabInvitation", map[string]any{
		"invitationId": id, "decision": "DECLINED",
	}, "", "agent_guarded"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("decline: %s (%+v)", r.Outcome, r.Error)
	}
	cancelEnv := envelopeFor("CancelCollabInvitation", map[string]any{"invitationId": id}, "")
	cancelEnv.AuthContext = map[string]any{"merchantID": "merchant_9"}
	r = s.Handle(cancelEnv)
	if r.Outcome == "ACCEPTED" {
		t.Fatal("terminal invitation must not be cancellable")
	}
	// 商家撤回自己的 PENDING 走通；撤别人的不行。
	inviteAs(t, s, map[string]any{"agentId": "agent_other"}, "merchant_9")
	sent = listInvitations(t, s, "sent", "merchant_9", "business_001")
	var pendingID string
	for _, inv := range sent {
		if inv["status"] == "PENDING" {
			pendingID, _ = inv["id"].(string)
		}
	}
	if pendingID == "" {
		t.Fatal("want a PENDING invitation to cancel")
	}
	otherCancel := envelopeFor("CancelCollabInvitation", map[string]any{"invitationId": pendingID}, "")
	otherCancel.AuthContext = map[string]any{"merchantID": "merchant_other"}
	if r := s.Handle(otherCancel); r.Outcome == "ACCEPTED" {
		t.Fatal("merchant must not cancel another merchant's invitation")
	}
	ownCancel := envelopeFor("CancelCollabInvitation", map[string]any{"invitationId": pendingID}, "")
	ownCancel.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(ownCancel); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel own PENDING: %s (%+v)", r.Outcome, r.Error)
	}
	// role 写错不猜。
	badRole := envelopeForPrincipal("ListCollabInvitations", map[string]any{"role": "whatever"}, "", "agent_guarded")
	if r := s.Handle(badRole); r.Outcome == "ACCEPTED" {
		t.Fatal("unknown list role must be rejected")
	}
}

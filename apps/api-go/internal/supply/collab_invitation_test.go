package supply

import (
	"encoding/json"
	"testing"
	"time"
)

// MERCHANT-CREATOR-INVITE-001：定向邀约全链路 —— 商家发（区间+目的）→
// 双方各能查 → creator 还价 → 商家再议 → 接受。鉴权按回合走：
// PENDING 是 creator 的回合，COUNTERED 是商家的回合，走错门直接拒。

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

func respondAs(t *testing.T, s *Service, payload map[string]any, principalID, merchantID string) (string, map[string]any) {
	t.Helper()
	env := envelopeForPrincipal("RespondCollabInvitation", payload, "", principalID)
	if merchantID != "" {
		env.AuthContext = map[string]any{"merchantID": merchantID}
	}
	r := s.Handle(env)
	if r.Outcome != "ACCEPTED" {
		return r.Outcome, nil
	}
	var view struct {
		Invitation map[string]any `json:"invitation"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	return r.Outcome, view.Invitation
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

func invitePayload(agentID string) map[string]any {
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	return map[string]any{
		"agentId": agentID, "serviceType": "CITY_COMPANION",
		"startAt": start, "durationH": 8,
		"priceMinVnd": 800000, "priceMaxVnd": 1500000, "negotiable": true,
		"purpose": "UGC", "currency": "VND", "message": "周末探店合作",
	}
}

// 还价可以连时间一起改：档期不对价再合适也白搭，改完 version 照记。
func TestInviteCounterAdjustsTime(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_time", "Time", []string{"ZH"}, "hn", 1200000)
	inv := inviteAs(t, s, invitePayload("agent_time"), "merchant_1")
	id, _ := inv["id"].(string)
	if inv["durationH"] != float64(8) {
		t.Fatalf("invite must carry durationH, got %v", inv["durationH"])
	}
	newStart := time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)
	_, countered := respondAs(t, s, map[string]any{
		"invitationId": id, "decision": "COUNTERED",
		"priceMinVnd": 1000000, "priceMaxVnd": 1300000, "negotiable": true,
		"purpose": "UGC", "message": "改到下周",
		"startAt": newStart, "durationH": 4,
	}, "agent_time", "")
	if countered["status"] != "COUNTERED" {
		t.Fatalf("counter must flip to COUNTERED, got %v", countered["status"])
	}
	if countered["startAt"] != newStart || countered["durationH"] != float64(4) {
		t.Fatalf("counter must replace time terms, got %v", countered)
	}
}

func TestInviteCreatorNegotiatedLifecycle(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_invited", "Invited", []string{"ZH"}, "hn", 1200000)
	inv := inviteAs(t, s, invitePayload("agent_invited"), "merchant_1")
	if inv["status"] != "PENDING" {
		t.Fatalf("new invitation must be PENDING, got %v", inv["status"])
	}
	if inv["priceMinVnd"] != float64(800000) || inv["priceMaxVnd"] != float64(1500000) {
		t.Fatalf("invitation must carry the price range, got %v", inv)
	}
	if inv["purpose"] != "UGC" || inv["negotiable"] != true {
		t.Fatalf("invitation must carry purpose + negotiable, got %v", inv)
	}
	id, _ := inv["id"].(string)

	// 商家在 creator 回合里点接受/还价都算走错门。
	if outcome, _ := respondAs(t, s, map[string]any{"invitationId": id, "decision": "ACCEPTED"}, "business_001", "merchant_1"); outcome == "ACCEPTED" {
		t.Fatal("merchant must not act on PENDING (creator's turn)")
	}
	// creator 还价 100w–130w：第 2 版，切到 COUNTERED（商家回合）。
	_, countered := respondAs(t, s, map[string]any{
		"invitationId": id, "decision": "COUNTERED",
		"priceMinVnd": 1000000, "priceMaxVnd": 1300000, "negotiable": true,
		"purpose": "UGC", "message": "这个数能接",
	}, "agent_invited", "")
	if countered["status"] != "COUNTERED" {
		t.Fatalf("counter must flip to COUNTERED, got %v", countered["status"])
	}
	if countered["priceMinVnd"] != float64(1000000) || countered["termsVersion"] != float64(2) {
		t.Fatalf("counter must replace terms + bump version, got %v", countered)
	}
	// creator 在商家回合里再点接受算走错门。
	if outcome, _ := respondAs(t, s, map[string]any{"invitationId": id, "decision": "ACCEPTED"}, "agent_invited", ""); outcome == "ACCEPTED" {
		t.Fatal("agent must not act on COUNTERED (merchant's turn)")
	}
	// 商家再议 110w–120w：回到 PENDING（第 3 版）。
	_, back := respondAs(t, s, map[string]any{
		"invitationId": id, "decision": "COUNTERED",
		"priceMinVnd": 1100000, "priceMaxVnd": 1200000, "negotiable": true,
		"purpose": "UGC", "message": "就这个数吧",
	}, "business_001", "merchant_1")
	if back["status"] != "PENDING" || back["termsVersion"] != float64(3) {
		t.Fatalf("merchant counter must flip back to PENDING v3, got %v", back)
	}
	// creator 接受：终态，双方看到 ACCEPTED + 最终条件。
	_, accepted := respondAs(t, s, map[string]any{"invitationId": id, "decision": "ACCEPTED"}, "agent_invited", "")
	if accepted["status"] != "ACCEPTED" {
		t.Fatalf("accept must terminate ACCEPTED, got %v", accepted)
	}
	if accepted["priceMinVnd"] != float64(1100000) || accepted["priceMaxVnd"] != float64(1200000) {
		t.Fatalf("accepted terms must be the last countered range, got %v", accepted)
	}
	received := listInvitations(t, s, "received", "", "agent_invited")
	if len(received) != 1 || received[0]["status"] != "ACCEPTED" {
		t.Fatalf("after accept both sides must see ACCEPTED, got %v", received)
	}
	// 终态不能再流转。
	if outcome, _ := respondAs(t, s, map[string]any{"invitationId": id, "decision": "DECLINED"}, "agent_invited", ""); outcome == "ACCEPTED" {
		t.Fatal("terminal invitation must not transition again")
	}
}

func TestInviteCreatorTermsGuards(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_guarded", "Guarded", []string{"ZH"}, "hn", 1200000)
	setupAgent(t, s, "agent_other", "Other", []string{"ZH"}, "hn", 1200000)
	good := func(agentID string) map[string]any {
		p := invitePayload(agentID)
		return p
	}

	// 没 merchant 身份不许邀。
	r := s.Handle(envelopeFor("InviteCreator", good("agent_guarded"), ""))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("invite without merchantID must be rejected")
	}
	// 区间倒挂（min>max）直接拒。
	bad := good("agent_guarded")
	bad["priceMinVnd"] = 2000000
	bad["priceMaxVnd"] = 1000000
	env := envelopeFor("InviteCreator", bad, "")
	env.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(env); r.Outcome == "ACCEPTED" {
		t.Fatal("inverted price range must be rejected")
	}
	// 目的不在封闭集里直接拒。
	badPurpose := good("agent_guarded")
	badPurpose["purpose"] = "陪聊"
	env = envelopeFor("InviteCreator", badPurpose, "")
	env.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(env); r.Outcome == "ACCEPTED" {
		t.Fatal("off-list purpose must be rejected")
	}
	// 开始时间写错格式直接拒，不猜是几点。
	badStart := good("agent_guarded")
	badStart["startAt"] = "下周末"
	env = envelopeFor("InviteCreator", badStart, "")
	env.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(env); r.Outcome == "ACCEPTED" {
		t.Fatal("malformed startAt must be rejected")
	}
	// 时长超过 24 小时直接拒。
	badDur := good("agent_guarded")
	badDur["durationH"] = 48
	env = envelopeFor("InviteCreator", badDur, "")
	env.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(env); r.Outcome == "ACCEPTED" {
		t.Fatal("duration over 24h must be rejected")
	}
	// 同一商家对同一人同时只能一张活单。
	inviteAs(t, s, good("agent_guarded"), "merchant_9")
	env = envelopeFor("InviteCreator", good("agent_guarded"), "")
	env.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(env); r.Outcome == "ACCEPTED" {
		t.Fatal("second live invitation to the same agent must be rejected")
	}
	// 别人不能替她回。
	sent := listInvitations(t, s, "sent", "merchant_9", "business_001")
	id, _ := sent[0]["id"].(string)
	if outcome, _ := respondAs(t, s, map[string]any{"invitationId": id, "decision": "ACCEPTED"}, "agent_other", ""); outcome == "ACCEPTED" {
		t.Fatal("another agent must not respond to her invitation")
	}
	// 一口价（negotiable=false）的单不许还价。
	fixed := good("agent_other")
	fixed["priceMinVnd"] = 1000000
	fixed["priceMaxVnd"] = 1000000
	fixed["negotiable"] = false
	inviteAs(t, s, fixed, "merchant_9")
	sent = listInvitations(t, s, "sent", "merchant_9", "business_001")
	var fixedID string
	for _, inv := range sent {
		if inv["agentId"] == "agent_other" && inv["status"] == "PENDING" {
			fixedID, _ = inv["id"].(string)
		}
	}
	if outcome, _ := respondAs(t, s, map[string]any{
		"invitationId": fixedID, "decision": "COUNTERED",
		"priceMinVnd": 1200000, "priceMaxVnd": 1200000, "negotiable": false,
		"purpose": "UGC",
	}, "agent_other", ""); outcome == "ACCEPTED" {
		t.Fatal("fixed-price invitation must not be counterable")
	}
	// 但一口价可以接受。
	if outcome, _ := respondAs(t, s, map[string]any{"invitationId": fixedID, "decision": "ACCEPTED"}, "agent_other", ""); outcome != "ACCEPTED" {
		t.Fatalf("fixed-price invitation must be acceptable, got %s", outcome)
	}
	// 商家撤回自己的活单走通；撤别人的不行。
	inviteAs(t, s, good("agent_other"), "merchant_9")
	sent = listInvitations(t, s, "sent", "merchant_9", "business_001")
	var pendingID string
	for _, inv := range sent {
		if inv["agentId"] == "agent_other" && (inv["status"] == "PENDING" || inv["status"] == "COUNTERED") {
			pendingID, _ = inv["id"].(string)
		}
	}
	if pendingID == "" {
		t.Fatal("want a live invitation to cancel")
	}
	otherCancel := envelopeFor("CancelCollabInvitation", map[string]any{"invitationId": pendingID}, "")
	otherCancel.AuthContext = map[string]any{"merchantID": "merchant_other"}
	if r := s.Handle(otherCancel); r.Outcome == "ACCEPTED" {
		t.Fatal("merchant must not cancel another merchant's invitation")
	}
	ownCancel := envelopeFor("CancelCollabInvitation", map[string]any{"invitationId": pendingID}, "")
	ownCancel.AuthContext = map[string]any{"merchantID": "merchant_9"}
	if r := s.Handle(ownCancel); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel own live invitation: %s (%+v)", r.Outcome, r.Error)
	}
	// role 写错不猜。
	badRole := envelopeForPrincipal("ListCollabInvitations", map[string]any{"role": "whatever"}, "", "agent_guarded")
	if r := s.Handle(badRole); r.Outcome == "ACCEPTED" {
		t.Fatal("unknown list role must be rejected")
	}
}

// MERCHANT-CREATOR-NOTIFY-001：收件人必须是**收件人自己 principal 那个 id**。
//
// 这条踩过一个很贵的坑：creator 侧事件一开始拿 `agentId` 当收件人，通知**正确地**
// 写进了 inbox_items，然后永远没人读到 —— 因为 agentId 既不是 user account，也不是
// 任何会话的 principal（identity.sessions 里 principal_id LIKE 'agent_%' = 0 行；
// supply.agent_profiles.agent_id 与 identity.user_accounts 的交集 = 0 行）。
// 一行没人读的记录比没有通知更坏：它看起来像「通知系统在工作」。
//
// 商家侧同理，但方向相反：商户会话的 principal 是 **business id**（现网 29 个
// principal_id='business_001' 的会话，business_001 也是收件箱行数最多的收件人），
// 所以商家侧收件人是 merchant_id，同店成员共用那个收件箱。
func TestEveryNotificationRecipientIsAPrincipalIdNotAnAgentId(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	setupAgentAs(t, s, "agent_pr", "user_pr")

	inv := inviteAs(t, s, invitePayload("agent_pr"), "business_001")

	// ① creator 侧：收件人必须是 profile 上的 user account id，且**不是** agentId。
	created := notifiedRecipients(repo, "CollabInvitationCreated")
	if len(created) != 1 {
		t.Fatalf("CollabInvitationCreated must notify the creator once, got %v", created)
	}
	if created[0] != "user_pr" {
		t.Fatalf("creator-side recipient = %q, want user_pr（user account id）", created[0])
	}
	if created[0] == "agent_pr" {
		t.Fatal("agentId must never be used as an inbox recipient — no session can read it")
	}

	// ② creator 还价 → 商家侧收件人是 business principal id。
	outcome, _ := respondAs(t, s, map[string]any{
		"invitationId": inv["id"], "decision": "COUNTERED",
		"priceMinVnd": int64(1000000), "priceMaxVnd": int64(1300000), "negotiable": true, "purpose": "UGC",
	}, "agent_pr", "")
	if outcome != "ACCEPTED" {
		t.Fatalf("creator counter must be accepted, got %s", outcome)
	}
	responded := notifiedRecipients(repo, "CollabInvitationResponded")
	if len(responded) != 1 || responded[0] != "business_001" {
		t.Fatalf("merchant-side recipient = %v, want [business_001]（商户的 business principal id）", responded)
	}
}

// profile 上没有 user_account_id 时**不发**通知，不用 agentId 兜底 ——
// 兜底就是重犯这个错。
func TestCreatorWithoutUserAccountGetsNoNotificationRatherThanAnAgentId(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	setupAgentAs(t, s, "agent_nouid", "") // actor 为空 ⇒ profile 上没有 user account
	inviteAs(t, s, invitePayload("agent_nouid"), "business_001")
	if got := notifiedRecipients(repo, "CollabInvitationCreated"); len(got) != 0 {
		t.Fatalf("no user account ⇒ no notification, got %v（拿 agentId 兜底就是重犯那个错）", got)
	}
}

// 收件人推不出来**不能**让业务动作失败：通知的可推导性永远不能反过来阻塞谈判。
// 这条是被三个既有测试打出来的（报价直接 REJECTED）。
func TestUndeliverableNotificationNeverBlocksTheBusinessAction(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	setupAgentAs(t, s, "agent_nb", "user_nb")
	inv := inviteAs(t, s, invitePayload("agent_nb"), "business_001")
	outcome, view := respondAs(t, s, map[string]any{"invitationId": inv["id"], "decision": "ACCEPTED"}, "agent_nb", "")
	if outcome != "ACCEPTED" {
		t.Fatalf("the business action must succeed regardless, got %s", outcome)
	}
	if view["status"] != InvitationAccepted {
		t.Fatalf("the invitation must actually be accepted, got %v", view["status"])
	}
}

// setupAgentAs 建一个「以指定 user account 登录」的 creator（profile + service + 能力）。
//
// Actor.ID（user account）与 Principal.ID（agent）必须是两个不同的值 —— 线上就是这样
// （商户会话的 principal 是 business id），而收件人只认 Actor.ID 那一侧。
// 不复用 setupAgent：它建过一次 profile，第二次 CreateAgentProfile 会被拒
// （PROFILE 唯一），所以必须一次就把 actor 设对。
func setupAgentAs(t *testing.T, s *Service, agentID, userAccountID string) {
	t.Helper()
	as := func(commandType string, payload map[string]any) {
		env := envelopeForPrincipal(commandType, payload, "", agentID)
		env.Actor.ID = userAccountID
		if r := s.Handle(env); r.Outcome != "ACCEPTED" {
			t.Fatalf("%s %s: %s (%+v)", commandType, agentID, r.Outcome, r.Error)
		}
	}
	as("CreateAgentProfile", map[string]any{
		"agentId": agentID, "name": "Named", "photos": []string{"https://cdn.proxy.test/creators/" + agentID + ".jpg"},
		"languages": []string{"ZH"}, "serviceAreas": []string{"hn"},
	})
	as("CreateAgentService", map[string]any{
		"agentId": agentID, "serviceType": "CITY_COMPANION", "referencePrice": int64(1200000),
		"currency": "VND", "markets": []string{"hn"},
	})
}

// notifiedRecipients 收集某个事件类型的所有收件人（payload.notifyPrincipalId）。
func notifiedRecipients(repo *MemoryRepository, eventType string) []string {
	out := []string{}
	for _, ev := range repo.Events() {
		if ev.EventType != eventType {
			continue
		}
		if who, ok := ev.Payload["notifyPrincipalId"].(string); ok {
			out = append(out, who)
		}
	}
	return out
}

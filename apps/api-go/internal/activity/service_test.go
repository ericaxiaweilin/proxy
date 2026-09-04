package activity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func activityEnvelope(kind, actor, activityID string) command.Envelope {
	return command.Envelope{
		CommandID: kind + "_1", CommandType: kind, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target: command.Target{Type: "Activity", ID: activityID}, IdempotencyKey: kind + "_" + actor,
		CorrelationID: "corr", RequestedAt: "2026-08-30T00:00:00Z", Payload: map[string]any{"activityId": activityID},
	}
}

func TestActivityInterestAndJoinAreRepositoryFacts(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy"

	toggled := s.HandleContext(t.Context(), activityEnvelope("ToggleActivityInterest", "user_a", id))
	if toggled.Outcome != "ACCEPTED" {
		t.Fatalf("toggle interest: %+v", toggled)
	}
	var toggleBody struct {
		Activity   Activity `json:"activity"`
		Interested bool     `json:"interested"`
	}
	if err := json.Unmarshal([]byte(toggled.OperationRef), &toggleBody); err != nil {
		t.Fatal(err)
	}
	if !toggleBody.Interested || toggleBody.Activity.Interested != 6 {
		t.Fatalf("unexpected interest state: %+v", toggleBody)
	}

	joined := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	if joined.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", joined)
	}
	repeated := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	if repeated.Outcome != "REJECTED" || repeated.Error == nil || repeated.Error.ErrorCode != "ACTIVITY_ALREADY_JOINED" {
		t.Fatalf("duplicate join was not rejected: %+v", repeated)
	}

	full := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_b", id))
	if full.Outcome != "REJECTED" || full.Error == nil || full.Error.ErrorCode != "ACTIVITY_FULL" {
		t.Fatalf("capacity was not enforced: %+v", full)
	}
}

// ACT-PUBLISH-001: user activities are persisted shared participation, with
// the activity price separated from venue consumption.
func TestPublishActivityCreatesFreeUserActivity(t *testing.T) {
	s := New()
	e := activityEnvelope("PublishActivity", "owner_1", "new")
	e.Payload = map[string]any{"title": "周六咖啡拍照局", "time": "周六 15:00–17:00", "capacity": 6, "venueName": "木光咖啡", "venueIcon": "☕", "venueType": "CAFE", "realitySceneId": "scene_muguang", "desc": "一起拍照聊天", "consumptionTerm": "SPLIT"}
	out := s.HandleContext(t.Context(), e)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %+v", out)
	}
	var body struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(out.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	a := body.Activity
	if a.OwnerID != "owner_1" || a.Origin != "USER" || a.Status != "PUBLISHED" {
		t.Fatalf("publisher identity/status lost: %+v", a)
	}
	if a.MoneyFlow != "FREE" || a.Price != "0₫" || a.PriceLabel != "免费参加" {
		t.Fatalf("activity money boundary lost: %+v", a)
	}
	if a.ConsumptionTerm != "SPLIT" || a.Consumption == "" {
		t.Fatalf("venue consumption missing: %+v", a)
	}
}

func TestPublishActivityRejectsAIAndInvalidVenueBoundary(t *testing.T) {
	base := map[string]any{"title": "活动", "time": "周六", "capacity": 4, "venueName": "地点", "venueIcon": "☕", "venueType": "CAFE", "realitySceneId": "scene_1", "desc": "共同参与", "consumptionTerm": "SPLIT"}
	s := New()
	ai := activityEnvelope("PublishActivity", "ai_1", "new")
	ai.Actor = command.Actor{Type: "USER_ASSISTANT", ID: "ai_1"}
	ai.Principal = command.Principal{Type: "USER_ASSISTANT", ID: "ai_1"}
	ai.Payload = base
	if out := s.HandleContext(t.Context(), ai); out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "AI_ACTION_FORBIDDEN" {
		t.Fatalf("AI publish boundary missing: %+v", out)
	}
	invalid := activityEnvelope("PublishActivity", "owner", "new")
	invalid.Payload = map[string]any{"title": "付费能力活动", "time": "周六", "capacity": 4, "venueName": "任意地点", "venueType": "HOTEL", "realitySceneId": "scene_2", "consumptionTerm": "SPLIT"}
	if out := s.HandleContext(t.Context(), invalid); out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "ACTIVITY_VENUE_UNSUPPORTED" {
		t.Fatalf("unsupported venue must route away from activity: %+v", out)
	}
}

// R16.x: AI-ACTOR-002 — 任何 AI 主体 (PLATFORM_AI / USER_TWIN /
// USER_ASSISTANT) 都不能报名 / 标记感兴趣 / checkin / 取消 / 标 no-show。
// 服务端 aiboundary 必须拒绝，错误码 AI_ACTION_FORBIDDEN。这是
// “AI 不能假装是真人参加活动”的闸。
func TestActivityActionsAreForbiddenForAIActor(t *testing.T) {
	s := New()
	s.SeedDefaults()
	commands := []string{"ToggleActivityInterest", "JoinActivity", "CancelActivity", "CheckinActivity", "MarkNoShow"}
	for _, cmd := range commands {
		t.Run(cmd, func(t *testing.T) {
			for _, kind := range []string{"PLATFORM_AI", "USER_TWIN", "USER_ASSISTANT"} {
				envelope := activityEnvelope(cmd, "ai_subject", "proxy_coffee_weekend")
				envelope.Principal = command.Principal{Type: kind, ID: "ai_subject"}
				envelope.Actor = command.Actor{Type: kind, ID: "ai_subject"}
				out := s.HandleContext(t.Context(), envelope)
				if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "AI_ACTION_FORBIDDEN" {
					t.Fatalf("%s as %s must be rejected with AI_ACTION_FORBIDDEN, got %+v", cmd, kind, out)
				}
			}
		})
	}
}

// R16.x: MONEYFLOW-004 — 默认 5 条基线活动都必须是 FREE（不能是 PAY_TO_JOIN
// 或 PAID_TO_ATTEND），且 priceLabel 必须是非空中文标签，aiStatus 必须是
// AI_GENERATED，aiActorKind 必须是 PLATFORM_AI，origin 必须是 PLATFORM。
// 这条 tripwire 防止未来重新把冷启动活动标为 origin="AI_PERSONA" 或
// MoneyFlow="PAY_TO_JOIN" （让平台 AI 看似“主动收费”）的回归。
func TestColdStartActivitiesArePlatformAIGeneratedAndFree(t *testing.T) {
	s := New()
	s.SeedDefaults()
	list := s.HandleContext(t.Context(), activityEnvelope("ListActivities", "viewer", ""))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", list)
	}
	var body struct {
		Activities []Activity `json:"activities"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Activities) < 5 {
		t.Fatalf("baseline catalog has %d activities, want ≥5", len(body.Activities))
	}
	for _, a := range body.Activities {
		if a.Origin != "PLATFORM" {
			t.Fatalf("activity %s origin = %q, want PLATFORM (AI cannot be origin)", a.ID, a.Origin)
		}
		if a.AIStatus != "AI_GENERATED" {
			t.Fatalf("activity %s aiStatus = %q, want AI_GENERATED", a.ID, a.AIStatus)
		}
		if a.AIActorKind != "PLATFORM_AI" {
			t.Fatalf("activity %s aiActorKind = %q, want PLATFORM_AI", a.ID, a.AIActorKind)
		}
		if a.MoneyFlow != "FREE" {
			t.Fatalf("activity %s moneyFlow = %q, want FREE (no paid platform-AI events)", a.ID, a.MoneyFlow)
		}
		if a.PriceLabel == "" {
			t.Fatalf("activity %s priceLabel must not be empty", a.ID)
		}
	}
}

// R16.x: MONEYFLOW-005 — normalizeActivityMoneyAndAI 把不规范的旧数据
// 落到合法集合。任何"裸金额" (MoneyFlow 空 + Price 非空) 都必须是 FREE
// 或 PAY_TO_JOIN (活动只有这两种)，PriceLabel 永远不能空。
func TestNormalizeActivityMoneyAndAIDefaults(t *testing.T) {
	cases := []struct {
		name      string
		input     Activity
		wantFlow  string
		wantLabel string
	}{
		{"empty price → FREE", Activity{Price: ""}, "FREE", "免费参加"},
		{"0₫ price → FREE", Activity{Price: "0₫"}, "FREE", "免费参加"},
		{"non-zero price → PAY_TO_JOIN", Activity{Price: "100,000₫"}, "PAY_TO_JOIN", "你需支付"},
		{"PAID_TO_ATTEND label", Activity{Price: "100,000₫", MoneyFlow: "PAID_TO_ATTEND"}, "PAID_TO_ATTEND", "参加后你可获得"},
		{"missing aiStatus → NONE", Activity{Price: "0₫"}, "FREE", "免费参加"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a := c.input
			normalizeActivityMoneyAndAI(&a)
			if a.MoneyFlow != c.wantFlow {
				t.Fatalf("MoneyFlow = %q, want %q", a.MoneyFlow, c.wantFlow)
			}
			if a.PriceLabel != c.wantLabel {
				t.Fatalf("PriceLabel = %q, want %q", a.PriceLabel, c.wantLabel)
			}
			if a.AIStatus == "" {
				t.Fatalf("AIStatus must default to NONE, got empty")
			}
		})
	}
}

// ACT-ATTEND-001: 考勤三件套必须验归属 + 不许假成功。
func TestAttendanceRequiresParticipation(t *testing.T) {
	newSeeded := func() *Service {
		s := New()
		s.SeedDefaults()
		return s
	}
	id := "user_photo_buddy"

	stranger := newSeeded()
	for _, kind := range []string{"CancelActivity", "CheckinActivity", "MarkNoShow"} {
		out := stranger.HandleContext(t.Context(), activityEnvelope(kind, "stranger", id))
		if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "ACTIVITY_NOT_JOINED" {
			t.Fatalf("%s by stranger: expected ACTIVITY_NOT_JOINED, got %+v", kind, out)
		}
	}

	s := newSeeded()
	if out := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}
	if _, ok := s.participations.Get(id, "user_a"); !ok {
		t.Fatalf("join must create a participation record")
	}

	if out := s.HandleContext(t.Context(), activityEnvelope("CheckinActivity", "user_a", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("checkin after join: %+v", out)
	}

	s2 := newSeeded()
	if out := s2.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_b", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}
	if out := s2.HandleContext(t.Context(), activityEnvelope("CancelActivity", "user_b", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("cancel after join: %+v", out)
	}
	if out := s2.HandleContext(t.Context(), activityEnvelope("CheckinActivity", "user_b", id)); out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "ACTIVITY_CHECKIN_NOT_ALLOWED" {
		t.Fatalf("checkin after cancel: expected ACTIVITY_CHECKIN_NOT_ALLOWED, got %+v", out)
	}

	s3 := newSeeded()
	if out := s3.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_c", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}
	if out := s3.HandleContext(t.Context(), activityEnvelope("MarkNoShow", "user_c", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("noshow after join: %+v", out)
	}
}

// ACT-CONTRACT-001: 旧行（缺 moneyFlow/priceLabel/aiStatus，模拟旧 PG
// payload）走 Toggle/Join 单条返回也必须带合法新字段，否则 mobile zod 炸。
// List 早就有 normalize，单条之前没有。
func TestStaleActivityNormalizedOnSingleResponses(t *testing.T) {
	s := New()
	stale := Activity{ID: "stale_001", Title: "旧活动", Time: "周六", People: "2人", Price: "0₫", Consumption: "AA", VenueIcon: "☕", VenueName: "旧店", Desc: "d", Benefit: "b", Capacity: 10}
	if err := s.repository.Seed(t.Context(), []Activity{stale}); err != nil {
		t.Fatal(err)
	}

	toggled := s.HandleContext(t.Context(), activityEnvelope("ToggleActivityInterest", "user_a", "stale_001"))
	if toggled.Outcome != "ACCEPTED" {
		t.Fatalf("toggle: %+v", toggled)
	}
	var toggleBody struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(toggled.OperationRef), &toggleBody); err != nil {
		t.Fatal(err)
	}
	if toggleBody.Activity.MoneyFlow == "" || toggleBody.Activity.PriceLabel == "" || toggleBody.Activity.AIStatus == "" {
		t.Fatalf("toggle must normalize stale row: %+v", toggleBody.Activity)
	}

	joined := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", "stale_001"))
	if joined.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", joined)
	}
	var joinBody struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(joined.OperationRef), &joinBody); err != nil {
		t.Fatal(err)
	}
	if joinBody.Activity.MoneyFlow != "FREE" || joinBody.Activity.PriceLabel == "" || joinBody.Activity.AIStatus != "NONE" {
		t.Fatalf("join must normalize stale row: %+v", joinBody.Activity)
	}
}

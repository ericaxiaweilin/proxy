package activity

import (
	"context"

	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/realityscene"
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
	if !toggleBody.Interested || toggleBody.Activity.Interested != 1 {
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

	// 容量是 2，所以 user_a + user_b 占满，user_c 必须被拒。
	// 以前这条靠 seed 里写死的 `joined: 1`（user_a 一进就满了）—— 那个 1 是
	// 编的，现在计数从 0 开始，满不满只由真实的参加记录决定。
	second := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_b", id))
	if second.Outcome != "ACCEPTED" {
		t.Fatalf("second join should fit in capacity 2: %+v", second)
	}
	full := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_c", id))
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

// R17.x: ACT-MY-ACTIVITIES-001 — “我的活动” 物化路径: listMyActivities
// 返回这个 actor 发起的 + 这个 actor 参加的 两组活动。其他 actor 的
// 活动不能泄露。匿名 / 空 actor 必须被拒 (不能看到任何“任意”我的活动"")。
// 这条 tripwire 防“我的活动”页面重新退回 hardcoded mock。
func TestListMyActivitiesByActor(t *testing.T) {
	s := New()
	// 准备数据: owner_1 发 1 个；viewer 参加 1 个；其他 actor 的活动 1 个。
	// 三个活动 id 唯一。
	idCreated := "act_my_created_" + itoaUnique()
	idJoined := "act_my_joined_" + itoaUnique()
	idOther := "act_other_" + itoaUnique()

	for _, c := range []struct {
		kind, id, actor string
	}{
		{"PublishActivity", idCreated, "owner_1"},
		{"PublishActivity", idJoined, "other_owner"},
		{"PublishActivity", idOther, "other_owner"},
	} {
		// PublishActivity 以 "activity_" + CommandID 为 ID，这里提前拼出。
		cmdID := c.id
		realID := "activity_" + cmdID
		e := activityEnvelope(c.kind, c.actor, realID)
		e.CommandID = cmdID
		e.Payload = map[string]any{
			"title": "R17.x my activities tripwire", "time": "周六", "capacity": 4,
			"venueName": "lab", "venueIcon": "○", "venueType": "CAFE", "realitySceneId": "scene_lab",
			"desc": "tripwire", "consumptionTerm": "SPLIT",
		}
		if out := s.HandleContext(t.Context(), e); out.Outcome != "ACCEPTED" {
			t.Fatalf("seed %s: %+v", c.id, out)
		}
	}
	// viewer 报名 idJoined (JoinActivity 用 Target.ID 查)。
	joinEnv := activityEnvelope("JoinActivity", "viewer", "activity_"+idJoined)
	if out := s.HandleContext(t.Context(), joinEnv); out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}

	// 匿名 / 空 actor 必须被拒。
	e := activityEnvelope("ListMyActivities", "", "mine")
	if out := s.HandleContext(t.Context(), e); out.Outcome != "REJECTED" {
		t.Fatalf("empty-actor ListMyActivities must reject, got %+v", out)
	}

	// viewer: joined 只能是 idJoined；不能看到 idCreated (那是 owner_1 的)。
	e = activityEnvelope("ListMyActivities", "viewer", "mine")
	out := s.HandleContext(t.Context(), e)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("viewer ListMyActivities: %+v", out)
	}
	var payload struct {
		Created []Activity `json:"created"`
		Joined  []Activity `json:"joined"`
	}
	if err := json.Unmarshal([]byte(out.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Created) != 0 {
		t.Fatalf("viewer.created must be empty, got %d", len(payload.Created))
	}
	if len(payload.Joined) != 1 || payload.Joined[0].ID != "activity_"+idJoined {
		t.Fatalf("viewer.joined must be [%s], got %+v", "activity_"+idJoined, payload.Joined)
	}

	// owner_1: created 只能是 idCreated。
	e = activityEnvelope("ListMyActivities", "owner_1", "mine")
	out = s.HandleContext(t.Context(), e)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("owner ListMyActivities: %+v", out)
	}
	payload = struct {
		Created []Activity `json:"created"`
		Joined  []Activity `json:"joined"`
	}{}
	if err := json.Unmarshal([]byte(out.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Created) != 1 || payload.Created[0].ID != "activity_"+idCreated {
		t.Fatalf("owner.created must be [%s], got %+v", "activity_"+idCreated, payload.Created)
	}
	if len(payload.Joined) != 0 {
		t.Fatalf("owner.joined must be empty, got %d", len(payload.Joined))
	}

	// other_owner: created 是 idJoined + idOther。不能看到 idCreated。
	e = activityEnvelope("ListMyActivities", "other_owner", "mine")
	out = s.HandleContext(t.Context(), e)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("other_owner ListMyActivities: %+v", out)
	}
	payload = struct {
		Created []Activity `json:"created"`
		Joined  []Activity `json:"joined"`
	}{}
	if err := json.Unmarshal([]byte(out.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Created) != 2 {
		t.Fatalf("other_owner.created must be 2, got %d", len(payload.Created))
	}
}

// itoa 是 microsecond timestamp string。复用 platform/postgres
// 里的同款。
func itoa(v int64) string { return fmt.Sprintf("%d", v) }

// itoaUnique 给本 test 用的不同 ID 种子。TestListMyActivitiesByActor
// 需要在同 个 service 状态里 “造”多个不重名的活动 ID，同时避
// 平台 SeedDefaults 里的已有 ID。
var itoaCounter int64

func itoaUnique() string {
	itoaCounter++
	return fmt.Sprintf("%d_%d", time.Now().UTC().UnixNano(), itoaCounter)
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
	if len(body.Activities) < 3 {
		t.Fatalf("baseline catalog has %d activities, want ≥3", len(body.Activities))
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

// R17.x: AI-PERSONA-PHOTO-001 — 平台 AI 5 角色冷启动活动必须携带
// photo 资产引用 (ai-personas/ai_00X.svg)。是活动
// (aiPersonaId) + name + avatar) 三件以外三件: 资产 photo
// 必须在。1) 3个 PERSONA 一起 (id + name + photo 都设了),
// 2) photo 路径明确在 ai-personas/ 下, 不能是任意 URL (防
// "看起来像真人" 接人真人拍提 URL), 3) 未设 aiStatus 的
// 活动不能误下发 photo.
func TestPlatformAIPersonaPhotoRequiredOnColdStart(t *testing.T) {
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
	platformAIPersonas := []string{"ai_001", "ai_002", "ai_003"}
	seen := make(map[string]bool, len(platformAIPersonas))
	for _, a := range body.Activities {
		if a.AIStatus != "AI_GENERATED" || a.AIActorKind != "PLATFORM_AI" {
			// 非 PLATFORM_AI 活动 不能被误下发 photo 资产
			if a.AIPersonaPhoto != "" {
				t.Fatalf("non PLATFORM_AI activity %s carries aiPersonaPhoto=%q", a.ID, a.AIPersonaPhoto)
			}
			continue
		}
		if a.AIPersonaID == "" || a.AIPersonaName == "" {
			t.Fatalf("PLATFORM_AI activity %s missing persona id/name (id=%q name=%q)", a.ID, a.AIPersonaID, a.AIPersonaName)
		}
		if a.AIPersonaPhoto == "" {
			t.Fatalf("PLATFORM_AI activity %s must carry aiPersonaPhoto (asset path under ai-personas/)", a.ID)
		}
		// 路径必须在 assets/ai-personas/ 目录内（新写真在 photos/ 子目录），
		// 不能是任意外链 URL（防“看起来像真人”的远程提图）。
		wantPrefix := "ai-personas/"
		if len(a.AIPersonaPhoto) < len(wantPrefix) || a.AIPersonaPhoto[:len(wantPrefix)] != wantPrefix {
			t.Fatalf("PLATFORM_AI activity %s aiPersonaPhoto=%q must be an asset path under ai-personas/ (was: arbitrary URL?)", a.ID, a.AIPersonaPhoto)
		}
		seen[a.AIPersonaID] = true
	}
	for _, want := range platformAIPersonas {
		if !seen[want] {
			t.Fatalf("cold-start catalog must include PLATFORM_AI persona %s, missing", want)
		}
	}
}

// R16.x: MONEYFLOW-005 — normalizeActivityForOutput 把不规范的旧数据
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
			normalizeActivityForOutput(&a)
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
	if _, err := s.repository.GetParticipation(t.Context(), id, "user_a"); err != nil {
		t.Fatalf("join must create a participation record: %v", err)
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

// MERCHANT-PUBLISH-001: 同 marketplace——只认注记。无注记 payload 自带
// merchantId 也只是 USER；有注记 → MERCHANT + 店名。
func TestMerchantActivityStampRequiresAnnotation(t *testing.T) {
	publish := func(actor string, auth map[string]any) command.Result {
		s := New()
		s.SeedDefaults()
		return s.HandleContext(t.Context(), command.Envelope{
			CommandID: "cmd_merchant_act", CommandType: "PublishActivity", CommandVersion: 1,
			Actor:          command.Actor{Type: "USER", ID: actor},
			Principal:      command.Principal{Type: "INDIVIDUAL", ID: actor},
			Target:         command.Target{Type: "Activity", ID: "new"},
			IdempotencyKey: "idem_merchant_act_" + actor,
			AuthContext:    auth,
			Purpose:        "merchant_test",
			CorrelationID:  "corr",
			RequestedAt:    "2026-09-05T00:00:00Z",
			Payload: map[string]any{
				"title": "店活动", "time": "周六", "capacity": 6,
				"venueName": "店", "venueIcon": "☕", "venueType": "CAFE",
				"realitySceneId": "scene_1", "desc": "d", "consumptionTerm": "SPLIT",
				"merchantId": "biz_forged",
			},
		})
	}
	spoofed := publish("spoofer", map[string]any{})
	if spoofed.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %+v", spoofed)
	}
	var b1 struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(spoofed.OperationRef), &b1); err != nil {
		t.Fatal(err)
	}
	if b1.Activity.Origin != "USER" || b1.Activity.MerchantName != "" {
		t.Fatalf("payload merchantId without annotation must stay USER: %+v", b1.Activity)
	}

	stamped := publish("owner", map[string]any{"merchantID": "biz_real", "merchantName": "真店"})
	if stamped.Outcome != "ACCEPTED" {
		t.Fatalf("annotated publish: %+v", stamped)
	}
	var b2 struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(stamped.OperationRef), &b2); err != nil {
		t.Fatal(err)
	}
	if b2.Activity.Origin != "MERCHANT" || b2.Activity.MerchantName != "真店" {
		t.Fatalf("annotation must stamp merchant: %+v", b2.Activity)
	}
}

// R58: 户外场地 + 报名方式 + 主题 + 展示编号。
func TestPublishActivityR58Fields(t *testing.T) {
	s := New()
	publish := func(actor, uniq string, payload map[string]any) command.Result {
		e := activityEnvelope("PublishActivity", actor, "new")
		e.CommandID = "PublishActivityR58_" + uniq
		e.IdempotencyKey = "PublishActivityR58_" + actor + "_" + uniq
		e.CorrelationID = "corr_r58_" + uniq
		e.Payload = payload
		return s.HandleContext(t.Context(), e)
	}
	out := publish("owner_r58", "a", map[string]any{
		"title": "西湖日落骑行", "time": "周六 15:00–18:00", "capacity": 6,
		"venueName": "西湖", "venueIcon": "🚲", "venueType": "LAKE",
		"realitySceneId": "scene_westlake", "desc": "一起骑行",
		"consumptionTerm": "SPLIT", "signupMode": "REVIEW", "theme": "日落",
	})
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
	if a.VenueTypeLabel != "湖边" || a.SignupMode != "REVIEW" || a.Theme != "日落" {
		t.Fatalf("R58 fields lost: %+v", a)
	}
	if len(a.Code) < 12 || a.Code[:5] != "PX-A-" {
		t.Fatalf("display code malformed: %q", a.Code)
	}
	// Default signup is OPEN; bad signup/theme/venue rejected.
	defOut := publish("owner_r58b", "b", map[string]any{"title": "t", "time": "周六", "capacity": 4, "venueName": "v", "venueType": "PARK", "realitySceneId": "s", "consumptionTerm": "SPLIT"})
	var defBody struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(defOut.OperationRef), &defBody); err != nil {
		t.Fatal(err)
	}
	if defBody.Activity.SignupMode != "OPEN" || defBody.Activity.VenueTypeLabel != "公园" {
		t.Fatalf("defaults wrong: %+v", defBody.Activity)
	}
	badOut := publish("owner_r58c", "c", map[string]any{"title": "t", "time": "周六", "capacity": 4, "venueName": "v", "venueType": "PARK", "realitySceneId": "s", "consumptionTerm": "SPLIT", "signupMode": "VIP", "theme": "日落"})
	if badOut.Outcome != "REJECTED" || badOut.Error == nil || badOut.Error.ErrorCode != "ACTIVITY_SIGNUP_INVALID" {
		t.Fatalf("bad signup must reject: %+v", badOut)
	}
}

// SCENE-ACTIVITY-LINK-001: 活动挂的「现实场景」必须是**目录里真的有**的场景。
//
// 这条是被自己咬出来的：SCENE-NO-FABRICATED-001 把 bonsaidon / westlake 两个
// 演示场景下架之后，activity 的 seed 里还有 3 条指 bonsaidon、2 条指 westlake ——
// 活动于是挂在"目录里查不到的场景"上，用户点进去什么都没有，而且**没有任何测试
// 会红**。跨表的外键式引用在 SQL 里写不出来，就必须在测试里钉。
//
// 同时钉住计数：seed 里的 Interested / Joined / Shares / QACount 一律必须是 0 ——
// 真数来自 activity.interests 和 activity.participants，写死一个数就是在给用户
// 看编的数字（跟 SCENE-NO-FABRICATED-001 删掉的那五个是同一种病）。
func TestSeededActivitiesPointAtRealScenes(t *testing.T) {
	scenes, err := realityscene.New().ListScenes(context.Background())
	if err != nil {
		t.Fatalf("list scenes: %v", err)
	}
	known := map[string]bool{}
	for _, sc := range scenes {
		known[sc.ID] = true
	}
	if len(known) == 0 {
		t.Fatal("scene catalog is empty — this check would pass vacuously")
	}
	catalog := defaultCatalog()
	if len(catalog) == 0 {
		t.Fatal("activity seed is empty — this check would pass vacuously")
	}
	for _, a := range catalog {
		if a.RealitySceneID == "" {
			t.Fatalf("activity %q has no realitySceneId — PublishActivity requires one, the seed must set it too", a.ID)
		}
		if !known[a.RealitySceneID] {
			t.Fatalf("activity %q points at scene %q, which is not in the scene catalog — the link is dead", a.ID, a.RealitySceneID)
		}
		if a.Interested != 0 || a.Joined != 0 || a.Shares != 0 || a.QACount != 0 {
			t.Fatalf("activity %q seeds fabricated counters (interested=%d joined=%d shares=%d qa=%d) — real counts come from interests/participants", a.ID, a.Interested, a.Joined, a.Shares, a.QACount)
		}
	}
}

// TestJoinUpdatesDisplayedPeopleCount 钉住 SCENE-ACTIVITY-LINK-001 的另一半。
//
// people 以前是写死在 payload 里的字符串，Join 只动 Joined，不动 people ——
// 有人报名之后列表依旧写着 "0 / 24 人"。同一个事实两个来源，其中一个不会
// 更新。这里要求：只要 Joined 变了，输出里的 people 必须跟着变。
func TestJoinUpdatesDisplayedPeopleCount(t *testing.T) {
	svc := New()
	svc.SeedDefaults()

	before, err := svc.repository.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	target := ""
	for _, a := range before {
		if a.ID == "user_photo_buddy" {
			target = a.ID
		}
	}
	if target == "" {
		t.Fatalf("seed catalog no longer contains user_photo_buddy — this test needs an activity with a small capacity")
	}

	got, _, err := svc.repository.Join(context.Background(), target, "user_display", "")
	if err != nil {
		t.Fatalf("Join: %v", err)
	}
	normalizeActivityForOutput(&got)

	// user_photo_buddy 的 capacity 是 2，报名一个之后应该是 "1 / 2 人"。
	if want := "1 / 2 人"; got.People != want {
		t.Fatalf("after one join, people = %q, want %q — the displayed headcount is still a frozen constant", got.People, want)
	}
	if got.Joined != 1 {
		t.Fatalf("Joined = %d, want 1", got.Joined)
	}

	// 反向：没名额的活动（capacity 0）不该被硬塞一个推出来的数字。
	open := Activity{ID: "open_001", Title: "找搭子", People: "找 1 位", Capacity: 0, Joined: 0}
	normalizeActivityForOutput(&open)
	if open.People != "找 1 位" {
		t.Fatalf("capacity 0 activity had people overwritten to %q — inventing a headcount for an activity that has no capacity", open.People)
	}
}

package marketplace

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func marketEnvelope(kind, actor string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "cmd_" + kind, CommandType: kind, CommandVersion: 1, Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor}, Target: command.Target{Type: "Market", ID: "local"}, IdempotencyKey: "idem_" + kind + actor, CorrelationID: "corr", RequestedAt: "2026-08-24T00:00:00Z", Payload: payload}
}

func TestOpportunityPublishApplyAndDismiss(t *testing.T) {
	s := New()
	s.SeedDefaults()
	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内 · 西湖", "price": "2,000,000₫", "skills": "中文 · 摄影",
	}))
	if published.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %+v", published)
	}
	var publishBody struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &publishBody); err != nil {
		t.Fatal(err)
	}

	applied := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", "creator", map[string]any{"opportunityId": publishBody.Opportunity.ID, "quote": "2,100,000₫", "scope": "中文 · 摄影"}))
	if applied.Outcome != "ACCEPTED" {
		t.Fatalf("apply: %+v", applied)
	}

	listed := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "creator", nil))
	var listBody struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatal(err)
	}
	if len(listBody.Opportunities) == 0 || !listBody.Opportunities[0].Applied || listBody.Opportunities[0].Responses != 1 {
		t.Fatalf("application not reflected: %+v", listBody.Opportunities)
	}

	dismissed := s.HandleContext(t.Context(), marketEnvelope("DismissMarketOpportunity", "creator", map[string]any{"opportunityId": publishBody.Opportunity.ID}))
	if dismissed.Outcome != "ACCEPTED" {
		t.Fatalf("dismiss: %+v", dismissed)
	}
	listed = s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "creator", nil))
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatal(err)
	}
	for _, item := range listBody.Opportunities {
		if item.ID == publishBody.Opportunity.ID {
			t.Fatal("dismissed opportunity remained visible")
		}
	}
}

// OPPORTUNITY-DEAL-001: 小美/任何 AI 都不是可直接上架的库存。真人报名后，
// 发布者从真实投递中选择一人，只有被选中的真人能确认并物化订单。
func TestOpportunityApplicationSelectionAndBilateralConfirmation(t *testing.T) {
	s := New()
	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "河内城市同行", "date": "周六", "time": "13:30–17:30", "location": "还剑湖", "price": "1,400,000₫", "skills": "中文 · 本地同行",
	}))
	var pub struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if published.Outcome != "ACCEPTED" || json.Unmarshal([]byte(published.OperationRef), &pub) != nil {
		t.Fatalf("publish: %+v", published)
	}
	applications := make([]Application, 0, 2)
	for i, applicant := range []string{"linh", "minh"} {
		out := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", applicant, map[string]any{"opportunityId": pub.Opportunity.ID, "quote": []string{"1,400,000₫", "1,200,000₫"}[i], "scope": "同行服务"}))
		var body struct {
			Application Application `json:"application"`
		}
		if out.Outcome != "ACCEPTED" || json.Unmarshal([]byte(out.OperationRef), &body) != nil {
			t.Fatalf("apply %s: %+v", applicant, out)
		}
		applications = append(applications, body.Application)
	}
	denied := s.HandleContext(t.Context(), marketEnvelope("ListMarketApplications", "stranger", map[string]any{"opportunityId": pub.Opportunity.ID}))
	if denied.Outcome != "REJECTED" {
		t.Fatalf("non-owner listed candidates: %+v", denied)
	}
	listed := s.HandleContext(t.Context(), marketEnvelope("ListMarketApplications", "owner", map[string]any{"opportunityId": pub.Opportunity.ID}))
	var listBody struct {
		Applications []Application `json:"applications"`
	}
	if listed.Outcome != "ACCEPTED" || json.Unmarshal([]byte(listed.OperationRef), &listBody) != nil || len(listBody.Applications) != 2 {
		t.Fatalf("owner list: %+v body=%+v", listed, listBody)
	}
	selected := s.HandleContext(t.Context(), marketEnvelope("SelectMarketApplication", "owner", map[string]any{"opportunityId": pub.Opportunity.ID, "applicationId": applications[0].ID}))
	if selected.Outcome != "ACCEPTED" {
		t.Fatalf("select: %+v", selected)
	}
	applicantView := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "linh", nil))
	var applicantList struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	_ = json.Unmarshal([]byte(applicantView.OperationRef), &applicantList)
	if len(applicantList.Opportunities) == 0 || applicantList.Opportunities[0].ViewerApplicationID != applications[0].ID || applicantList.Opportunities[0].ViewerApplicationStatus != "SELECTED" {
		t.Fatalf("selected applicant cannot see confirmation state: %+v", applicantList.Opportunities)
	}
	wrong := s.HandleContext(t.Context(), marketEnvelope("ConfirmMarketApplication", "minh", map[string]any{"applicationId": applications[0].ID}))
	if wrong.Outcome != "REJECTED" {
		t.Fatalf("unselected applicant confirmed: %+v", wrong)
	}
	confirmed := s.HandleContext(t.Context(), marketEnvelope("ConfirmMarketApplication", "linh", map[string]any{"applicationId": applications[0].ID}))
	var confirmBody struct {
		Application Application `json:"application"`
		OrderRef    string      `json:"orderRef"`
	}
	if confirmed.Outcome != "ACCEPTED" || json.Unmarshal([]byte(confirmed.OperationRef), &confirmBody) != nil || confirmBody.Application.Status != "CONFIRMED" || confirmBody.OrderRef == "" {
		t.Fatalf("confirm: %+v body=%+v", confirmed, confirmBody)
	}
	again := s.HandleContext(t.Context(), marketEnvelope("ConfirmMarketApplication", "linh", map[string]any{"applicationId": applications[0].ID}))
	var againBody struct {
		OrderRef string `json:"orderRef"`
	}
	_ = json.Unmarshal([]byte(again.OperationRef), &againBody)
	if again.Outcome != "ACCEPTED" || againBody.OrderRef != confirmBody.OrderRef {
		t.Fatalf("confirm must be idempotent: %+v", again)
	}
}

// R17.x: CHAT-ORDER-MATERIALISATION-001 — chat→order 派生路径。
// marketplace ConfirmMarketApplication 必须派生出真 Order
// (通过注入的 OrderCreator), 让“我的订单”页能看见. 不再有
// fake "order_" + applicationID 拼接 — 那是一个 fragment ID, 不会
// 出现在 fulfillment.listMyOrders(). Idempotency: 重复 confirm
// 不生成新 Order.
func TestConfirmMarketApplicationMaterialisesRealOrder(t *testing.T) {
	s := New()
	publish := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner_1", map[string]any{
		"title":     "R17.x order materialisation tripwire",
		"location":  "河内西湖",
		"moneyFlow": "FREE",
	}))
	if publish.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %+v", publish)
	}
	var pub struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(publish.OperationRef), &pub); err != nil {
		t.Fatal(err)
	}
	apply := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", "applicant_1", map[string]any{
		"opportunityId": pub.Opportunity.ID, "quote": "1200000", "scope": "tripwire",
	}))
	if apply.Outcome != "ACCEPTED" {
		t.Fatalf("apply: %+v", apply)
	}
	var appBody struct {
		Application Application `json:"application"`
	}
	if err := json.Unmarshal([]byte(apply.OperationRef), &appBody); err != nil {
		t.Fatal(err)
	}
	selectApp := s.HandleContext(t.Context(), marketEnvelope("SelectMarketApplication", "owner_1", map[string]any{
		"opportunityId": pub.Opportunity.ID, "applicationId": appBody.Application.ID,
	}))
	if selectApp.Outcome != "ACCEPTED" {
		t.Fatalf("select: %+v", selectApp)
	}
	fc := &fakeOrderCreator{}
	s.SetOrderCreator(fc)
	confirm := s.HandleContext(t.Context(), marketEnvelope("ConfirmMarketApplication", "applicant_1", map[string]any{
		"applicationId": appBody.Application.ID,
	}))
	if confirm.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %+v", confirm)
	}
	var confirmBody struct {
		OrderRef string `json:"orderRef"`
	}
	if err := json.Unmarshal([]byte(confirm.OperationRef), &confirmBody); err != nil {
		t.Fatal(err)
	}
	if confirmBody.OrderRef == "" {
		t.Fatalf("orderRef must be set, got empty")
	}
	if !strings.HasPrefix(confirmBody.OrderRef, "ord_") {
		t.Fatalf("orderRef %q must start with ord_ (server-unique ID, not 'order_' + applicationId fragment)", confirmBody.OrderRef)
	}
	if len(fc.records) != 1 {
		t.Fatalf("orderCreator must be called exactly once, got %d", len(fc.records))
	}
	if fc.records[0].ID != confirmBody.OrderRef {
		t.Fatalf("orderCreator ID=%q != orderRef=%q", fc.records[0].ID, confirmBody.OrderRef)
	}
	if fc.records[0].RequesterID != "owner_1" || fc.records[0].AgentID != "applicant_1" {
		t.Fatalf("orderCreator RequesterID/AgentID: got %s/%s, want owner_1/applicant_1", fc.records[0].RequesterID, fc.records[0].AgentID)
	}
	if fc.records[0].NeedID != pub.Opportunity.ID {
		t.Fatalf("orderCreator NeedID=%q != opportunityId=%q", fc.records[0].NeedID, pub.Opportunity.ID)
	}
	confirm2 := s.HandleContext(t.Context(), marketEnvelope("ConfirmMarketApplication", "applicant_1", map[string]any{
		"applicationId": appBody.Application.ID,
	}))
	if confirm2.Outcome != "ACCEPTED" {
		t.Fatalf("second confirm: %+v", confirm2)
	}
	if len(fc.records) != 1 {
		t.Fatalf("idempotent confirm must not re-call orderCreator; got %d calls", len(fc.records))
	}
}

type fakeOrderCreator struct {
	records []OrderRecord
}

func (f *fakeOrderCreator) CreateOrder(_ context.Context, r OrderRecord) error {
	f.records = append(f.records, r)
	return nil
}

func TestOpportunitySelectionAndConfirmationAreForbiddenForAIActors(t *testing.T) {
	for _, commandType := range []string{"SelectMarketApplication", "ConfirmMarketApplication"} {
		for _, kind := range []string{"PLATFORM_AI", "USER_TWIN", "USER_ASSISTANT"} {
			s := New()
			envelope := marketEnvelope(commandType, "ai", map[string]any{"opportunityId": "op", "applicationId": "app"})
			envelope.Actor.Type, envelope.Principal.Type = kind, kind
			out := s.HandleContext(t.Context(), envelope)
			if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "AI_ACTION_FORBIDDEN" {
				t.Fatalf("%s %s: %+v", kind, commandType, out)
			}
		}
	}
}

// R15.x: when the mobile client passes a foreground-location
// fix to ListMarketOpportunities, the server must recompute
// Travel from haversine distance, not echo the editor's seeded
// placeholder. Without this, NEARBY / RECOMMEND sort order is
// the same for everyone regardless of where they actually are,
// which is the 'NEARBY 还是旧版' bug that the user reported.
func TestListMarketOpportunitiesRecomputesTravelFromUserLocation(t *testing.T) {
	s := New()
	s.SeedDefaults()
	// A viewer 0 km from Hoàn Kiếm should see a much shorter
	// Travel to biz_negotiation (Hoàn Kiếm) than to supplier_visit
	// (Bắc Ninh). With the seeded 18/52 min values, the Bắc Ninh
	// row would dominate even when the viewer is in central Hanoi.
	resp := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "viewer", map[string]any{
		"userLat": 21.0285,
		"userLng": 105.8542,
	}))
	if resp.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", resp)
	}
	var body struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(resp.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	var hk *Opportunity
	var bn *Opportunity
	for i := range body.Opportunities {
		switch body.Opportunities[i].ID {
		case "biz_negotiation":
			hk = &body.Opportunities[i]
		case "supplier_visit":
			bn = &body.Opportunities[i]
		}
	}
	if hk == nil || bn == nil {
		t.Fatal("seeded rows missing")
	}
	if hk.Travel == nil || bn.Travel == nil {
		t.Fatal("Travel was not recomputed for one or both rows")
	}
	if hk.TravelSource != "user_distance" || bn.TravelSource != "user_distance" {
		t.Fatalf("TravelSource not user_distance: hk=%q bn=%q", hk.TravelSource, bn.TravelSource)
	}
	if *hk.Travel >= *bn.Travel {
		t.Fatalf("central-Hanoi viewer should see shorter Travel to Hoàn Kiếm (%d min) than to Bắc Ninh (%d min)", *hk.Travel, *bn.Travel)
	}
	if *hk.Travel < 1 || *hk.Travel > 5 {
		t.Fatalf("Hoàn Kiếm → Hoàn Kiếm Travel should be 1–5 min, got %d", *hk.Travel)
	}
	if *bn.Travel < 25 || *bn.Travel > 45 {
		t.Fatalf("Hanoi → Bắc Ninh Travel should be 25–45 min, got %d", *bn.Travel)
	}
}

// R15.x: when no user fix is supplied, the seeded Travel stays
// in place. The mobile list view calls list() before GPS is
// granted; the order must be the existing seed order, not a
// zero-everything fallback.
func TestListMarketOpportunitiesPreservesSeededTravelWithoutUserFix(t *testing.T) {
	s := New()
	s.SeedDefaults()
	resp := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "viewer", nil))
	if resp.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", resp)
	}
	var body struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(resp.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	for _, item := range body.Opportunities {
		if item.TravelSource != "seeded" {
			t.Fatalf("row %s should be tagged seeded, got %q", item.ID, item.TravelSource)
		}
	}
}

// R15.x: readUserFix rejects garbage input (out-of-range,
// (0,0) sentinel, missing fields). A bad fix must not crash
// the list and must not poison the seeded Travel.
func TestReadUserFixRejectsGarbage(t *testing.T) {
	cases := map[string]map[string]any{
		"nil payload":      nil,
		"empty payload":    {},
		"only userLat":     {"userLat": 21.0},
		"only userLng":     {"userLng": 105.0},
		"lat out of range": {"userLat": 999.0, "userLng": 105.0},
		"lng out of range": {"userLat": 21.0, "userLng": -999.0},
		"sentinel (0,0)":   {"userLat": 0.0, "userLng": 0.0},
		"lat as string":    {"userLat": "21.0", "userLng": 105.0},
	}
	for name, payload := range cases {
		if _, _, ok := readUserFix(payload); ok {
			t.Fatalf("%s: expected ok=false, got true", name)
		}
	}
	// A valid Vietnamese fix must be accepted.
	lat, lng, ok := readUserFix(map[string]any{"userLat": 21.0285, "userLng": 105.8542})
	if !ok || lat != 21.0285 || lng != 105.8542 {
		t.Fatalf("valid Hanoi fix rejected: lat=%v lng=%v ok=%v", lat, lng, ok)
	}
}

func TestHaversineKnownDistances(t *testing.T) {
	// Hanoi (Hoàn Kiếm) ↔ Bắc Ninh (Yên Phong) is ~20 km by road;
	// the great-circle distance is in the 16–18 km band.
	d := haversineKm(21.0285, 105.8542, 21.1600, 105.9600)
	if d < 14 || d > 22 {
		t.Fatalf("Hanoi–Bắc Ninh great-circle distance should be 14–22 km, got %.1f", d)
	}
	// Same point to itself is 0 km.
	if d2 := haversineKm(21.0285, 105.8542, 21.0285, 105.8542); d2 > 0.01 {
		t.Fatalf("self-distance should be 0, got %.3f", d2)
	}
}

// R16.x: MONEYFLOW-001 — AI 主体不能在机会上发起“接单”动作。
// 服务器应在 ApplyToMarketOpportunity 边界返回 AI_ACTION_FORBIDDEN。
// 这条 tripwire 保证未来重构不会默默打开“AI 助手调用接单”的能力。
func TestMarketApplyIsForbiddenForAIActor(t *testing.T) {
	s := New()
	s.SeedDefaults()
	for _, kind := range []string{"PLATFORM_AI", "USER_TWIN", "USER_ASSISTANT"} {
		t.Run(kind, func(t *testing.T) {
			envelope := marketEnvelope("ApplyToMarketOpportunity", "ai_subject", map[string]any{
				"opportunityId": "biz_negotiation", "quote": "1,000,000₫", "scope": "中文",
			})
			envelope.Principal = command.Principal{Type: kind, ID: "ai_subject"}
			envelope.Actor = command.Actor{Type: kind, ID: "ai_subject"}
			out := s.HandleContext(t.Context(), envelope)
			if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "AI_ACTION_FORBIDDEN" {
				t.Fatalf("%s apply must be rejected with AI_ACTION_FORBIDDEN, got %+v", kind, out)
			}
		})
	}
}

// R16.x: MONEYFLOW-001 — AI 主体不能 Publish 机会 (不能代客户发需求)。
func TestMarketPublishIsForbiddenForAIActor(t *testing.T) {
	s := New()
	for _, kind := range []string{"PLATFORM_AI", "USER_TWIN", "USER_ASSISTANT"} {
		t.Run(kind, func(t *testing.T) {
			envelope := marketEnvelope("PublishMarketOpportunity", "ai_subject", map[string]any{
				"title": "AI 代发需求", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内", "price": "2,000,000₫", "moneyFlow": "EARN", "priceLabel": "完成后你可获得",
			})
			envelope.Principal = command.Principal{Type: kind, ID: "ai_subject"}
			envelope.Actor = command.Actor{Type: kind, ID: "ai_subject"}
			out := s.HandleContext(t.Context(), envelope)
			if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "AI_ACTION_FORBIDDEN" {
				t.Fatalf("%s publish must be rejected with AI_ACTION_FORBIDDEN, got %+v", kind, out)
			}
		})
	}
}

// R16.x: MONEYFLOW-002 — 机会的“资金方向”必须在服务端 normalize 到
// 4 选 1 (EARN / PAY / FREE / TBD)。EARN 是默认；Price = "0₫" / "" 推为
// FREE；未指定 MoneyFlow + 非零 Price 推为 EARN；推出来的 PriceLabel 必
// 不是空字符串 (UI 不能出现“裸金额”)。
func TestOpportunityMoneyFlowNormalize(t *testing.T) {
	cases := []struct {
		name       string
		inputFlow  string
		inputPrice string
		wantFlow   string
		wantLabel  string
		wantPrice  string // empty if Price is preserved as-is
	}{
		{"explicit EARN keeps", "EARN", "1,500,000₫", "EARN", "完成后你可获得", "1,500,000₫"},
		{"explicit PAY keeps", "PAY", "500,000₫", "PAY", "你需支付", "500,000₫"},
		{"explicit FREE keeps zero price", "FREE", "0₫", "FREE", "免费", "0₫"},
		{"explicit TBD empties price", "TBD", "", "TBD", "费用待确认", ""},
		{"blank flow + non-zero price → EARN", "", "900,000₫", "EARN", "完成后你可获得", "900,000₫"},
		{"blank flow + 0₫ → FREE", "", "0₫", "FREE", "免费", "0₫"},
		{"blank flow + blank price → FREE", "", "", "FREE", "免费", ""},
		{"unknown flow falls back to EARN", "GARBAGE", "1,000,000₫", "EARN", "完成后你可获得", "1,000,000₫"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			o := Opportunity{MoneyFlow: c.inputFlow, Price: c.inputPrice}
			normalizeOpportunityMoney(&o)
			if o.MoneyFlow != c.wantFlow {
				t.Fatalf("MoneyFlow = %q, want %q", o.MoneyFlow, c.wantFlow)
			}
			if o.PriceLabel != c.wantLabel {
				t.Fatalf("PriceLabel = %q, want %q", o.PriceLabel, c.wantLabel)
			}
			if c.wantPrice != "" && o.Price != c.wantPrice {
				t.Fatalf("Price = %q, want %q", o.Price, c.wantPrice)
			}
		})
	}
}

// MONEYFLOW-004: PriceLabel 是 server-authoritative 文案。任何 client
// 传过来的非空 PriceLabel（即使拼写不同、即使是空字符串、即使与
// MoneyFlow 语义不匹配）都必须被 server normalize 推
// opportunityPriceLabel(MoneyFlow) 覆盖。client 不能“跳“文案，
// 不能在 mobile 本地化文案后不推到 server。
//
// 这是 MONEYFLOW-001+002+003 之上的另一道闸，确切地封住 R16.x 主题
// 里唯一还剩下的“client override server 文案”这条路径。
func TestOpportunityNormalizeAlwaysOverwritesClientPriceLabel(t *testing.T) {
	cases := []struct {
		name       string
		inputFlow  string
		inputPrice string
		inputLabel string
		wantLabel  string
	}{
		{"EARN + 错位文案（client 填 PAY 文案）", "EARN", "1,200,000₫", "你需支付", "完成后你可获得"},
		{`FREE + client 填了` + "完成后你可获得" + `错位文案`, "FREE", "0₫", "完成后你可获得", "免费"},
		{"PAY + client 填了 EARN 文案", "PAY", "500,000₫", "完成后你可获得", "你需支付"},
		{"TBD + client 填了不相关文案", "TBD", "", "台宝", "费用待确认"},
		{"EARN + client 填空字符串", "EARN", "1,200,000₫", "", "完成后你可获得"},
		{"EARN + client 填空白", "EARN", "1,200,000₫", "   ", "完成后你可获得"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			o := Opportunity{MoneyFlow: c.inputFlow, Price: c.inputPrice, PriceLabel: c.inputLabel}
			normalizeOpportunityMoney(&o)
			if o.PriceLabel != c.wantLabel {
				t.Fatalf("PriceLabel = %q, want %q (server must always overwrite)", o.PriceLabel, c.wantLabel)
			}
		})
	}
}

// R16.x: MONEYFLOW-003 — 真人 publish 机会、MoneyFlow 选 FREE 但 Price
// 被填成非零 → 必须拒绝 (“免费任务不能填 500,000₫”)。这是避免“裸金
// 额”混淆的最后一道闸。
func TestMarketPublishRejectsFreeWithNonZeroPrice(t *testing.T) {
	s := New()
	cases := map[string]map[string]any{
		"FREE with non-zero price": {"moneyFlow": "FREE", "price": "500,000₫"},
		"TBD with price set":       {"moneyFlow": "TBD", "price": "500,000₫"},
		"EARN with empty price":    {"moneyFlow": "EARN", "price": ""},
		"PAY with 0₫ price":        {"moneyFlow": "PAY", "price": "0₫"},
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			payload["title"] = "test"
			payload["theme"] = "city"
			payload["date"] = "周六"
			payload["time"] = "10:00–18:00"
			payload["location"] = "河内"
			payload["priceLabel"] = "免费"
			out := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "human_publisher", payload))
			if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "INVALID_OPPORTUNITY" {
				t.Fatalf("publish must reject with INVALID_OPPORTUNITY, got %+v", out)
			}
		})
	}
}

// MONEYFLOW-005: client publish 可以不传 PriceLabel，server 仍下发
// 正确的中文文案。这是 MONEYFLOW-004 的 client-side 承诺：wire 路径
// 从 client 到 server 都不强制携带 PriceLabel。client 未来的 SDK 走
// PublishMarketOpportunityInputSchema，PriceLabel 设为 optional；即使
// 有人偷偷携错位或调试文案，server normalize 仍会推。
//
// 这个 tripwire 从 server 侧验证：四种 MoneyFlow × 三种 PriceLabel
// input 状态（缺省 / 空白 / 错位），server response operationRef 里
// 的 PriceLabel 都是 opportunityPriceLabel(MoneyFlow)。
func TestMarketPublishOmitsClientPriceLabel(t *testing.T) {
	s := New()
	s.SeedDefaults()
	cases := []struct {
		name        string
		flow        string
		price       string
		clientLabel any // string / nil (缺省)
		wantLabel   string
	}{
		{"EARN + client 不传 PriceLabel", "EARN", "1,200,000₫", nil, "完成后你可获得"},
		{"EARN + client 传空字符串", "EARN", "1,200,000₫", "", "完成后你可获得"},
		{"EARN + client 传错位文案", "EARN", "1,200,000₫", "你需支付", "完成后你可获得"},
		{"PAY + client 不传 PriceLabel", "PAY", "500,000₫", nil, "你需支付"},
		{"PAY + client 传空白", "PAY", "500,000₫", "   ", "你需支付"},
		{"FREE + client 不传 PriceLabel", "FREE", "0₫", nil, "免费"},
		{"TBD + client 不传 PriceLabel", "TBD", "", nil, "费用待确认"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			payload := map[string]any{
				"title": "R16.x MoneyFlow wire tripwire", "theme": "城市", "date": "周六", "time": "19:00", "location": "河内", "skills": "中文",
				"moneyFlow": c.flow, "price": c.price, "lens": []string{"BOOKED"},
			}
			if c.clientLabel != nil {
				payload["priceLabel"] = c.clientLabel
			}
			out := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", payload))
			if out.Outcome != "ACCEPTED" {
				t.Fatalf("publish must succeed, got %+v", out)
			}
			var body struct {
				Opportunity Opportunity `json:"opportunity"`
			}
			if err := json.Unmarshal([]byte(out.OperationRef), &body); err != nil {
				t.Fatal(err)
			}
			if body.Opportunity.MoneyFlow != c.flow {
				t.Fatalf("MoneyFlow = %q, want %q", body.Opportunity.MoneyFlow, c.flow)
			}
			if body.Opportunity.PriceLabel != c.wantLabel {
				t.Fatalf("PriceLabel = %q, want %q (server must derive from MoneyFlow)", body.Opportunity.PriceLabel, c.wantLabel)
			}
		})
	}
}

// ACT-CONTRACT-001: 旧行（lens 缺失/为空，模拟旧 payload）走 List 必须
// 被兜底成非空，否则 contracts lens.min(1) 让整列 zod 炸。money/price 同理。
func TestStaleOpportunityLensDefaultedOnList(t *testing.T) {
	s := New()
	stale := Opportunity{ID: "stale_opp_001", Title: "旧机会", Theme: "陪同", Date: "周六", Time: "10:00", Location: "河内", Price: "900,000₫", Owner: "旧主", OwnerID: "seed_old", OwnerType: "PERSON"}
	if err := s.repository.Seed(t.Context(), []Opportunity{stale}); err != nil {
		t.Fatal(err)
	}
	listed := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "viewer", nil))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", listed)
	}
	var body struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Opportunities) != 1 {
		t.Fatalf("expected 1 opportunity, got %d", len(body.Opportunities))
	}
	got := body.Opportunities[0]
	if got.MoneyFlow == "" || got.PriceLabel == "" {
		t.Fatalf("list must normalize money fields: %+v", got)
	}
	if len(got.Lens) == 0 {
		t.Fatalf("list must default empty lens (contracts min(1)): %+v", got)
	}
}

// AIBOUND-001: Dismiss 之前无 gate；现 AI 主体必须 AI_ACTION_FORBIDDEN，
// 非 USER 主体必须 MARKET_ACTOR_REQUIRED（与 Publish/Apply 对齐）。
func TestMarketDismissIsForbiddenForAIActor(t *testing.T) {
	s := New()
	s.SeedDefaults()
	for _, kind := range []string{"PLATFORM_AI", "USER_TWIN", "USER_ASSISTANT"} {
		t.Run(kind, func(t *testing.T) {
			envelope := marketEnvelope("DismissMarketOpportunity", "ai_subject", map[string]any{
				"opportunityId": "biz_negotiation",
			})
			envelope.Principal = command.Principal{Type: kind, ID: "ai_subject"}
			envelope.Actor = command.Actor{Type: kind, ID: "ai_subject"}
			out := s.HandleContext(t.Context(), envelope)
			if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "AI_ACTION_FORBIDDEN" {
				t.Fatalf("%s dismiss must be rejected with AI_ACTION_FORBIDDEN, got %+v", kind, out)
			}
		})
	}
}

func TestMarketWritesRequireUserActor(t *testing.T) {
	s := New()
	s.SeedDefaults()
	publish := marketEnvelope("PublishMarketOpportunity", "", map[string]any{
		"title": "x", "theme": "y", "date": "周六", "time": "10:00", "location": "河内", "price": "100₫",
	})
	publish.Actor = command.Actor{Type: "PUBLIC", ID: "anon"}
	publish.Principal = command.Principal{Type: "PUBLIC", ID: "anon"}
	if out := s.HandleContext(t.Context(), publish); out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "MARKET_ACTOR_REQUIRED" {
		t.Fatalf("PUBLIC publish: expected MARKET_ACTOR_REQUIRED, got %+v", out)
	}
	dismiss := marketEnvelope("DismissMarketOpportunity", "biz_negotiation", map[string]any{"opportunityId": "biz_negotiation"})
	dismiss.Actor = command.Actor{Type: "PUBLIC", ID: "anon"}
	dismiss.Principal = command.Principal{Type: "PUBLIC", ID: "anon"}
	if out := s.HandleContext(t.Context(), dismiss); out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "MARKET_ACTOR_REQUIRED" {
		t.Fatalf("PUBLIC dismiss: expected MARKET_ACTOR_REQUIRED, got %+v", out)
	}
}

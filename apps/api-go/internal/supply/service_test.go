package supply

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/geo"
)

// COMP-SELLER-001：测试里的「已实名」必须由人显式放行，不能是默认状态。
// 生产里对应的是 supply.seller_real_name_verifications 里 status='VERIFIED'
// 且未过期的行（method=OPERATOR_ATTESTATION 时还要有具名的 verified_by）。
// 这里用同样的语义：没被 mark 过的 agent 一律未实名。
type stubSellerIdentity struct {
	mu       sync.Mutex
	verified map[string]bool
	err      error
}

func (s *stubSellerIdentity) RealNameVerified(_ context.Context, agentID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return false, s.err
	}
	return s.verified[agentID], nil
}

// markSellersVerified 显式把这些 agent 标为已核验。
func markSellersVerified(s *Service, agentIDs ...string) {
	if s.sellerIdentity == nil {
		s.SetSellerIdentityLookup(&stubSellerIdentity{verified: map[string]bool{}})
	}
	lookup, ok := s.sellerIdentity.(*stubSellerIdentity)
	if !ok {
		panic("seller identity lookup already replaced; cannot mark sellers verified")
	}
	lookup.mu.Lock()
	defer lookup.mu.Unlock()
	for _, id := range agentIDs {
		lookup.verified[id] = true
	}
}

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return envelopeForPrincipal(commandType, payload, targetID, "business_001")
}

// envelopeForPrincipal 构造指定 principal 的会话 envelope（归属校验：写命令要求
// agentId == principalId，故 agent 侧命令必须以 agent 自己的 principal 发起）。
func envelopeForPrincipal(commandType string, payload map[string]any, targetID, principalID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "BUSINESS", ID: principalID},
		Target:         command.Target{Type: "Supply", ID: targetID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

// setupAgent 创建完整合格 Agent（profile + service + 语言能力 verified + 窗口）。
func setupAgent(t *testing.T, s *Service, agentID, name string, languages []string, market string, price int64) {
	t.Helper()
	r := s.Handle(envelopeForPrincipal("CreateAgentProfile", map[string]any{
		"agentId": agentID, "name": name, "photos": []string{"https://cdn.proxy.test/creators/" + agentID + ".jpg"}, "languages": languages, "serviceAreas": []string{market},
	}, "", agentID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create profile %s: %s", agentID, r.Outcome)
	}
	r = s.Handle(envelopeForPrincipal("CreateAgentService", map[string]any{
		"agentId": agentID, "serviceType": "CITY_COMPANION", "referencePrice": price,
		"currency": "VND", "markets": []string{market},
	}, "", agentID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create service %s: %s", agentID, r.Outcome)
	}
	for _, lang := range languages {
		r = s.Handle(envelopeForPrincipal("DeclareCapability", map[string]any{
			"agentId": agentID, "capability": lang,
		}, "", agentID))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("declare %s: %s", lang, r.Outcome)
		}
		r = s.Handle(envelopeForPrincipal("VerifyCapability", map[string]any{
			"agentId": agentID, "capability": lang, "method": "INTERVIEW", "decision": "APPROVE",
		}, "", agentID))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("verify %s: %s", lang, r.Outcome)
		}
	}
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	end := time.Now().Add(24*time.Hour + 10*time.Hour).UTC().Format(time.RFC3339)
	r = s.Handle(envelopeForPrincipal("SetAvailabilityWindow", map[string]any{
		"agentId": agentID, "startAt": start, "endAt": end, "marketId": market,
	}, "", agentID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("set window %s: %s (%+v)", agentID, r.Outcome, r.Error)
	}
	// 能力/时间窗都齐了还不够：供给侧实名是准入条件（COMP-SELLER-001）。
	// 这里显式放行，代表该 agent 在 seller_real_name_verifications 里
	// 有一条未过期的 VERIFIED 记录。
	markSellersVerified(s, agentID)
}

// B 完成标准：3 个真实测试 Agent → 不同 Capability/Verification/Availability
// → 发 City Companion Need → 只返回真正符合条件的人。
// MERCHANT-CREATOR-TAGS-001：商家标签只印 VERIFIED 未过期的能力。
// QuerySuppliers 必须把同一套 verifiedCapabilitySet 带出来，声明了但没
// 验证过的（DRIVING）不许出现；顺序固定保证快照可比。
func TestQuerySuppliersCarriesVerifiedCapabilities(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_tagged", "Tagged", []string{"ZH", "VI"}, "hn", 1200000)
	for _, cap := range []string{"PHOTOGRAPHY", "DRIVING"} {
		r := s.Handle(envelopeForPrincipal("DeclareCapability", map[string]any{
			"agentId": "agent_tagged", "capability": cap,
		}, "", "agent_tagged"))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("declare %s: %s", cap, r.Outcome)
		}
	}
	r := s.Handle(envelopeForPrincipal("VerifyCapability", map[string]any{
		"agentId": "agent_tagged", "capability": "PHOTOGRAPHY", "method": "INTERVIEW", "decision": "APPROVE",
	}, "", "agent_tagged"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("verify PHOTOGRAPHY: %s", r.Outcome)
	}
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r = s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	var view struct {
		Suppliers []map[string]any `json:"suppliers"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Suppliers) != 1 {
		t.Fatalf("want exactly agent_tagged, got %d suppliers", len(view.Suppliers))
	}
	raw, ok := view.Suppliers[0]["verifiedCapabilities"]
	if !ok {
		t.Fatal("MERCHANT-CREATOR-TAGS-001: suppliers entry must carry verifiedCapabilities")
	}
	got := []string{}
	for _, v := range raw.([]any) {
		got = append(got, v.(string))
	}
	want := []string{"PHOTOGRAPHY", "VI", "ZH"}
	if len(got) != len(want) {
		t.Fatalf("want verified caps %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("want verified caps %v, got %v", want, got)
		}
	}
}

// MERCHANT-CREATOR-TAGS-001：粉丝数没有聚合来源，商家看到的是已关联账号。
// QuerySuppliers 给商家带 public + merchants 可见的 platform/handle；
// private 的不许漏出去；无社媒印 [] 不印 null。
func TestQuerySuppliersCarriesMerchantVisibleSocials(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_social", "Social", []string{"ZH"}, "hn", 1200000)
	link := func(platform, handle, visibility string, followers ...int64) {
		payload := map[string]any{
			"agentId": "agent_social", "platform": platform, "handle": handle, "visibility": visibility,
		}
		if len(followers) > 0 {
			payload["followerCount"] = followers[0]
		}
		r := s.Handle(envelopeForPrincipal("LinkAgentSocial", payload, "", "agent_social"))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("link %s: %s", platform, r.Outcome)
		}
	}
	link("tiktok", "linh_hanoi", "public", 24000)
	link("instagram", "linh.ig", "private")
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	query := func(merchantID string) []map[string]any {
		env := envelopeFor("QuerySuppliers", map[string]any{
			"marketId": "hn", "startAt": start, "durationH": 8,
			"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
		}, "")
		if merchantID != "" {
			env.AuthContext = map[string]any{"merchantID": merchantID}
		}
		r := s.Handle(env)
		var view struct {
			Suppliers []map[string]any `json:"suppliers"`
		}
		_ = json.Unmarshal([]byte(r.OperationRef), &view)
		if len(view.Suppliers) != 1 {
			t.Fatalf("want exactly agent_social, got %d suppliers", len(view.Suppliers))
		}
		return view.Suppliers
	}
	got := query("merchant_1")
	socials, ok := got[0]["socials"].([]any)
	if !ok {
		t.Fatalf("MERCHANT-CREATOR-TAGS-001: suppliers entry must carry socials array, got %v", got[0]["socials"])
	}
	if len(socials) != 1 {
		t.Fatalf("merchant sees public only, want 1 social, got %v", socials)
	}
	first, _ := socials[0].(map[string]any)
	if first["platform"] != "tiktok" || first["handle"] != "linh_hanoi" {
		t.Fatalf("wrong social content: %v", socials[0])
	}
	if first["followerCount"] != float64(24000) {
		t.Fatalf("self-declared fan count must pass through, got %v", first["followerCount"])
	}
	if _, hasVis := first["visibility"]; hasVis {
		t.Fatalf("visibility must not leak to client: %v", first)
	}
}

// MERCHANT-CREATOR-TAGS-001：「可邀请」标签已下掉（结果集本来就只含 Eligible，
// 再贴标是同义反复），换成真实评价分 —— matching.Score 算出来的 Total。
// 无成交记录时取先验值（53），hasTrackRecord=false，调用方印「新人」不编分。
func TestQuerySuppliersCarriesRealRating(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_rated", "Rated", []string{"ZH"}, "hn", 1200000)
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	var view struct {
		Suppliers []map[string]any `json:"suppliers"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Suppliers) != 1 {
		t.Fatalf("want exactly agent_rated, got %d suppliers", len(view.Suppliers))
	}
	raw, ok := view.Suppliers[0]["rating"].(map[string]any)
	if !ok {
		t.Fatalf("MERCHANT-CREATOR-TAGS-001: suppliers entry must carry rating, got %v", view.Suppliers[0]["rating"])
	}
	// 无记录 = 先验 Total：40*0.8 + 30*0.6 + 0 + 10*0.3 = 53，
	// 再加 DISPATCH-RANK-002 的新人加权（0 单拿满 8）= 61。没有位置、手上没活 ⇒ 距离 0、负载 0。
	if raw["total"] != float64(61) {
		t.Fatalf("no-record agent must score the prior total 53 + newcomer boost 8 = 61, got %v", raw["total"])
	}
	if raw["hasTrackRecord"] != false {
		t.Fatalf("no-record agent must report hasTrackRecord=false, got %v", raw["hasTrackRecord"])
	}
	if _, ok := raw["satisfactionRate"]; !ok {
		t.Fatalf("rating must carry satisfactionRate (0 when no reviews), got %v", raw)
	}
	// 服务量是真实成交单量；无记录为 0，调用方如实印「服务 0 单」。
	if raw["completedOrders"] != float64(0) {
		t.Fatalf("no-record agent must report completedOrders=0, got %v", raw["completedOrders"])
	}
}

// MERCHANT-CREATOR-TAGS-001：垂直分类走创作者自声明，服务端原样透出
// （含不明示类目也不过滤——过滤是展示层的事）；空印 []。
func TestQuerySuppliersCarriesVerticalTags(t *testing.T) {
	s := New()
	r := s.Handle(envelopeForPrincipal("CreateAgentProfile", map[string]any{
		"agentId": "agent_vert", "name": "Vert", "photos": []string{}, "languages": []string{"ZH"}, "serviceAreas": []string{"hn"},
	}, "", "agent_vert"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create profile: %s", r.Outcome)
	}
	r = s.Handle(envelopeForPrincipal("CreateAgentService", map[string]any{
		"agentId": "agent_vert", "serviceType": "CITY_COMPANION", "referencePrice": 900000,
		"currency": "VND", "markets": []string{"hn"}, "verticalTags": []string{"RESTAURANT", "KTV", "", "RESTAURANT"},
	}, "", "agent_vert"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create service: %s (%+v)", r.Outcome, r.Error)
	}
	markSellersVerified(s, "agent_vert")
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	_ = s.Handle(envelopeForPrincipal("SetAvailabilityWindow", map[string]any{
		"agentId": "agent_vert", "startAt": start,
		"endAt": time.Now().Add(34 * time.Hour).UTC().Format(time.RFC3339), "marketId": "hn",
	}, "", "agent_vert"))
	r = s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{},
	}, ""))
	var view struct {
		Suppliers []map[string]any `json:"suppliers"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Suppliers) != 1 {
		t.Fatalf("want exactly agent_vert, got %d", len(view.Suppliers))
	}
	raw, ok := view.Suppliers[0]["verticalTags"].([]any)
	if !ok {
		t.Fatalf("suppliers entry must carry verticalTags array, got %v", view.Suppliers[0]["verticalTags"])
	}
	got := []string{}
	for _, v := range raw {
		got = append(got, v.(string))
	}
	// 去重+去空+封顶3，原样透出（含 KTV——展示层才过滤）。
	want := []string{"RESTAURANT", "KTV"}
	if len(got) != len(want) {
		t.Fatalf("want verticals %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("want verticals %v, got %v", want, got)
		}
	}
}

func TestSupplyQueryReturnsOnlyEligible(t *testing.T) {
	s := New()
	// Linh：河内，中文+越南语 VERIFIED，有窗口
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH", "VI"}, "hn", 1200000)
	// Mai：河内，仅越南语（无 ZH），有窗口 → 中文查询应被过滤
	setupAgent(t, s, "agent_mai", "Mai", []string{"VI"}, "hn", 1000000)
	// Minh：胡志明市，中文 VERIFIED，有窗口 → 河内查询应被过滤（market 不匹配）
	setupAgent(t, s, "agent_minh", "Minh", []string{"ZH"}, "hcm", 1100000)

	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("query: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		Suppliers []map[string]any `json:"suppliers"`
		Shortage  bool             `json:"shortage"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Shortage {
		t.Fatal("expected eligible supplier, got shortage")
	}
	if len(view.Suppliers) != 1 {
		t.Fatalf("want exactly Linh (ZH+hn), got %d suppliers", len(view.Suppliers))
	}
	if view.Suppliers[0]["agentId"] != "agent_linh" {
		t.Fatalf("want agent_linh, got %v", view.Suppliers[0]["agentId"])
	}
	photos, ok := view.Suppliers[0]["photos"].([]any)
	if !ok || len(photos) != 1 {
		t.Fatalf("MERCHANT-CREATOR-001: recommendation must carry the creator's real profile photo, got %v", view.Suppliers[0]["photos"])
	}
	if _, ok := view.Suppliers[0]["availability"].(map[string]any); !ok {
		t.Fatalf("MERCHANT-CREATOR-001: recommendation must explain current availability, got %v", view.Suppliers[0]["availability"])
	}
}

// Eligibility Gate：Agent ACTIVE + Service ACTIVE + Capability VERIFIED
// + Availability overlap + Market feasible = ELIGIBLE。
func TestEligibilityGateBlocksUnverified(t *testing.T) {
	s := New()
	// Dung：声明中文但未 VERIFIED
	r := s.Handle(envelopeForPrincipal("CreateAgentProfile", map[string]any{
		"agentId": "agent_dung", "name": "Dung", "languages": []string{"ZH"}, "serviceAreas": []string{"hn"},
	}, "", "agent_dung"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("profile: %s", r.Outcome)
	}
	r = s.Handle(envelopeForPrincipal("CreateAgentService", map[string]any{
		"agentId": "agent_dung", "serviceType": "CITY_COMPANION", "referencePrice": 900000,
		"currency": "VND", "markets": []string{"hn"},
	}, "", "agent_dung"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("service: %s", r.Outcome)
	}
	// 只 declare，不 verify
	r = s.Handle(envelopeForPrincipal("DeclareCapability", map[string]any{
		"agentId": "agent_dung", "capability": "ZH",
	}, "", "agent_dung"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("declare: %s", r.Outcome)
	}
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	end := time.Now().Add(24*time.Hour + 10*time.Hour).UTC().Format(time.RFC3339)
	r = s.Handle(envelopeForPrincipal("SetAvailabilityWindow", map[string]any{
		"agentId": "agent_dung", "startAt": start, "endAt": end, "marketId": "hn",
	}, "", "agent_dung"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("window: %s", r.Outcome)
	}
	// 本用例要验的是「能力未验证会被挡」，所以实名必须先放行 —— 否则它会先被
	// 实名卡住，测的就不是它声称要测的东西（COMP-SELLER-001 之后尤其如此）。
	markSellersVerified(s, "agent_dung")

	r = s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	var view struct {
		Suppliers []map[string]any `json:"suppliers"`
		Shortage  bool             `json:"shortage"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if !view.Shortage || len(view.Suppliers) != 0 {
		t.Fatal("declared-but-unverified ZH must NOT pass eligibility")
	}
}

// CandidateBatch 冻结：快照不随后续 Agent 变化改变。
func TestCandidateBatchFrozenSnapshot(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH", "VI"}, "hn", 1200000)

	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("CreateCandidateBatch", map[string]any{
		"needId": "need_1", "marketId": "hn", "startAt": start, "durationH": 8,
		"languages": []string{"ZH"},
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("batch: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		BatchID    string      `json:"batchId"`
		Candidates []Candidate `json:"candidates"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Candidates) != 1 {
		t.Fatalf("want 1 candidate, got %d", len(view.Candidates))
	}
	if !view.Candidates[0].Eligibility.Eligible {
		t.Fatal("candidate must be eligible")
	}
	// 冻结窗口 ID 存在
	if view.Candidates[0].Availability.WindowID == "" {
		t.Fatal("availability snapshot must freeze window id")
	}
	batchID := view.BatchID

	// 事后改动：把 Linh 的窗口 BLOCKED（Agent 变化）
	windows, _ := s.repository.GetWindows(nil, "agent_linh")
	if len(windows) == 0 {
		t.Fatal("no windows")
	}
	r = s.Handle(envelopeForPrincipal("BlockAvailabilityWindow", map[string]any{"windowId": windows[0].ID}, "", "agent_linh"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("block: %s", r.Outcome)
	}
	// 再查新 batch → shortage（Agent 变化影响新查询）
	r = s.Handle(envelopeFor("CreateCandidateBatch", map[string]any{
		"needId": "need_2", "marketId": "hn", "startAt": start, "durationH": 8,
		"languages": []string{"ZH"},
	}, ""))
	var view2 struct {
		Candidates []Candidate `json:"candidates"`
		Shortage   bool        `json:"shortage"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view2)
	if !view2.Shortage {
		t.Fatal("after block, new batch must be shortage")
	}

	// 但历史 batch 快照不变（冻结）
	r = s.Handle(envelopeFor("GetCandidateBatch", map[string]any{"batchId": batchID}, batchID))
	var view3 struct {
		Candidates []Candidate `json:"candidates"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view3)
	if len(view3.Candidates) != 1 {
		t.Fatalf("frozen batch must keep 1 candidate, got %d", len(view3.Candidates))
	}
}

// 时间冲突：已有 BOOKED 窗口重叠时拒绝新窗口。
func TestWindowTimeConflict(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH"}, "hn", 1200000)
	// 把窗口 BOOKED（模拟订单占用）
	windows, _ := s.repository.GetWindows(nil, "agent_linh")
	_ = s.repository.UpdateWindowStatus(nil, windows[0].ID, "BOOKED", "ord_1")
	// 设重叠窗口 → 拒绝
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	end := time.Now().Add(24*time.Hour + 10*time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeForPrincipal("SetAvailabilityWindow", map[string]any{
		"agentId": "agent_linh", "startAt": start, "endAt": end, "marketId": "hn",
	}, "", "agent_linh"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "WINDOW_TIME_CONFLICT" {
		t.Fatalf("want WINDOW_TIME_CONFLICT, got %s/%+v", r.Outcome, r.Error)
	}
}

// Profile 不是 Identity 也不是 Capability：Profile 独立可查。
func TestProfileIsNotIdentityOrCapability(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH"}, "hn", 1200000)
	r := s.Handle(envelopeFor("GetAgentProfile", map[string]any{"agentId": "agent_linh"}, "agent_linh"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("get profile: %s", r.Outcome)
	}
	var view struct {
		Profile AgentProfile `json:"profile"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Profile.Name != "Linh" || view.Profile.Status != "ACTIVE" {
		t.Fatalf("profile wrong: %+v", view.Profile)
	}
}

// 归属校验（第 9 项收尾）：候选批次只允许创建者读取，他人读取 fail-closed 拒绝。
func TestCandidateBatchOwnerAccess(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH", "VI"}, "hn", 1200000)

	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("CreateCandidateBatch", map[string]any{
		"needId": "need_1", "marketId": "hn", "startAt": start, "durationH": 8,
		"languages": []string{"ZH"},
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("batch create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		BatchID string `json:"batchId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.BatchID == "" {
		// OperationRef 可能不含 batchId，从 Aggregate.ID 取
		view.BatchID = r.Aggregate.ID
	}

	// 创建者（business_001）可读
	r2 := s.Handle(envelopeFor("GetCandidateBatch", map[string]any{}, view.BatchID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("owner read: %s (%+v)", r2.Outcome, r2.Error)
	}
	// 他人（principal_other）读 → BATCH_NOT_OWNED fail-closed
	r3 := s.Handle(envelopeForPrincipal("GetCandidateBatch", map[string]any{}, view.BatchID, "principal_other"))
	if r3.Outcome != "REJECTED" || r3.Error.ErrorCode != "BATCH_NOT_OWNED" {
		t.Fatalf("want BATCH_NOT_OWNED, got %s/%+v", r3.Outcome, r3.Error)
	}
}

// M3 验收：过期 KYC 必须阻断 Eligibility（verified 但已过期 ≠ 可匹配）
func TestEligibilityBlocksExpiredVerification(t *testing.T) {
	s := New()
	// 手动创建 profile/service，不走 VerifyCapability 的自动 future expiry
	repo := s.repository
	agentID := "agent_expired"
	_ = repo.CreateProfile(nil, AgentProfile{AgentID: agentID, Name: "Expired", Status: "ACTIVE", CreatedAt: time.Now(), UpdatedAt: time.Now()})
	_ = repo.CreateService(nil, AgentService{AgentID: agentID, ServiceType: "CITY_COMPANION", Status: "ACTIVE", ReferencePrice: 900000, Currency: "VND", Markets: []string{"hn"}, UpdatedAt: time.Now()})
	_ = repo.SetCapability(nil, Capability{AgentID: agentID, Capability: "ZH", Declared: true, Verified: true, UpdatedAt: time.Now()})
	// 写入过期验证（VERIFIED 但 expiresAt 在过去）
	_ = repo.CreateVerification(nil, CapabilityVerification{
		ID: "cv_expired", AgentID: agentID, Capability: "ZH", Status: "VERIFIED", Method: "INTERVIEW",
		VerifiedBy: "ops_001", VerifiedAt: time.Now().Add(-48 * time.Hour), ExpiresAt: time.Now().Add(-24 * time.Hour), CreatedAt: time.Now().Add(-48 * time.Hour),
	})
	// 窗口正常
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	end := time.Now().Add(34 * time.Hour).UTC().Format(time.RFC3339)
	_ = repo.CreateWindow(nil, AvailabilityWindow{ID: "aw_expired", AgentID: agentID, StartAt: time.Now().Add(24 * time.Hour), EndAt: time.Now().Add(34 * time.Hour), MarketID: "hn", Status: "AVAILABLE", CreatedAt: time.Now(), UpdatedAt: time.Now()})
	// 实名先放行：本用例要验的是「过期 KYC 会被挡」，不是实名（COMP-SELLER-001）。
	markSellersVerified(s, agentID)

	r := s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	var view struct {
		Suppliers []map[string]any `json:"suppliers"`
		Shortage  bool             `json:"shortage"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if !view.Shortage || len(view.Suppliers) != 0 {
		t.Fatalf("expired verification must NOT pass eligibility, got suppliers=%v shortage=%v", view.Suppliers, view.Shortage)
	}
	// Passport 应显示 expired 计数
	r2 := s.Handle(envelopeFor("GetAgentPassport", map[string]any{"agentId": agentID}, agentID))
	var passport struct {
		VerificationSummary map[string]int `json:"verificationSummary"`
		PassportStatus      string         `json:"passportStatus"`
	}
	_ = json.Unmarshal([]byte(r2.OperationRef), &passport)
	if passport.VerificationSummary["expired"] != 1 || passport.VerificationSummary["verified"] != 0 {
		t.Fatalf("passport expired summary wrong: %+v", passport.VerificationSummary)
	}
	_ = end
}

// M3 验收：permission denied（非 owner 不能改他人 Profile）
func TestPermissionDeniedOnProfileUpdate(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH"}, "hn", 1200000)
	r := s.Handle(envelopeForPrincipal("UpdateAgentProfile", map[string]any{
		"agentId": "agent_linh", "name": "Hacked",
	}, "", "principal_other"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "AGENT_NOT_OWNED" {
		t.Fatalf("want AGENT_NOT_OWNED, got %s/%+v", r.Outcome, r.Error)
	}
}

// M3 验收：location 精度 redaction — QuerySuppliers 与 Passport 不泄露精确坐标
func TestLocationPrecisionRedaction(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH"}, "hn", 1200000)
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("query: %s", r.Outcome)
	}
	// 响应中不得包含精确经纬度字段
	payload := r.OperationRef
	if contains(payload, "lat") || contains(payload, "lng") || contains(payload, "coordinate") || contains(payload, "exact") {
		t.Fatalf("supply query leaked precise location: %s", payload)
	}
	// Passport activeWindows 仅含 marketId/startAt/endAt，不含 precise
	r2 := s.Handle(envelopeFor("GetAgentPassport", map[string]any{"agentId": "agent_linh"}, "agent_linh"))
	var pp struct {
		ActiveWindows []map[string]any `json:"activeWindows"`
	}
	_ = json.Unmarshal([]byte(r2.OperationRef), &pp)
	for _, w := range pp.ActiveWindows {
		if _, hasLat := w["lat"]; hasLat {
			t.Fatalf("passport leaked lat")
		}
		if _, hasPrecise := w["preciseLocation"]; hasPrecise {
			t.Fatalf("passport leaked preciseLocation")
		}
		if _, ok := w["marketId"]; !ok {
			t.Fatalf("passport missing marketId redaction")
		}
	}

	// GEO-PRECISION-001：精度声明必须是类型化契约，而不是散文。
	// Passport 是无任务浏览上下文，R8:98-101 把全局上下文封顶在 CITY，所以
	// 读者拿到的精度必须正好是 geo.PrecisionCity。改 GlobalContextCap 会让这里变红。
	var full map[string]any
	if err := json.Unmarshal([]byte(r2.OperationRef), &full); err != nil {
		t.Fatalf("passport is not a JSON object: %v", err)
	}
	got, ok := full["locationPrecision"]
	if !ok {
		t.Fatalf("passport must declare locationPrecision; got keys %v", sortedKeys(full))
	}
	if got != string(geo.PrecisionCity) {
		t.Fatalf("passport locationPrecision = %v, want %q (R8 Gate E caps global context at CITY)", got, geo.PrecisionCity)
	}

	// 递归扫全量 key：任何一层出现坐标类字段即泄露。只查 key 不查 value——
	// redactions 里那句给人看的散文含 "coordinates"，不该被误判。
	if path := firstCoordinateKey(full, "passport"); path != "" {
		t.Fatalf("passport leaked a coordinate field at %s", path)
	}
}

// coordinateKeys 是坐标类字段名。命中任意一个即视为泄露精确位置。
var coordinateKeys = map[string]bool{
	"lat": true, "lng": true, "lon": true,
	"latitude": true, "longitude": true,
	"coordinate": true, "coordinates": true,
	"geohash": true, "gps": true,
	"preciselocation": true, "exactlocation": true,
}

// firstCoordinateKey 深度遍历任意 JSON 结构，返回第一个坐标类字段的路径。
func firstCoordinateKey(v any, path string) string {
	switch node := v.(type) {
	case map[string]any:
		for k, child := range node {
			if coordinateKeys[strings.ToLower(k)] {
				return path + "." + k
			}
			if found := firstCoordinateKey(child, path+"."+k); found != "" {
				return found
			}
		}
	case []any:
		for i, child := range node {
			if found := firstCoordinateKey(child, fmt.Sprintf("%s[%d]", path, i)); found != "" {
				return found
			}
		}
	}
	return ""
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

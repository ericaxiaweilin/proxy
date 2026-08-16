package supply

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

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
		"agentId": agentID, "name": name, "languages": languages, "serviceAreas": []string{market},
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
}

// B 完成标准：3 个真实测试 Agent → 不同 Capability/Verification/Availability
// → 发 City Companion Need → 只返回真正符合条件的人。
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

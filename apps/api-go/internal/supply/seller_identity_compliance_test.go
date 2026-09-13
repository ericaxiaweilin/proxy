package supply

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// COMP-SELLER-001 — 供给侧实名是准入条件，不是加分项。
//
// 越南电商法 122/2025 + NĐ 248/2026（2026-07-01 生效）禁止匿名销售：
// 平台上收钱的人必须可识别、且绑定税务身份。此前 supply 侧只有能力验证
// （会不会中文），完全没有「是谁」的证据 —— 那正是法条要禁的形态。
//
// 这一组测试钉死三件事：
//  1. 没接实名查询 / 查询报错 = 撮合停摆，不是照常放行（fail-closed）
//  2. 实名缺失会真的挡掉候选资格，不是只写进快照给人看
//  3. 实名放行后候选资格能恢复 —— 守卫不能退化成「谁都别想卖」

func TestSellerRealNameRefusedWhenLookupMissing(t *testing.T) {
	ok, err := SellerRealNameVerified(context.Background(), nil, "agent_linh")
	if ok || !errors.Is(err, ErrSellerIdentityLookupUnavailable) {
		t.Fatalf("a missing lookup must refuse, got ok=%v err=%v", ok, err)
	}
}

func TestSellerRealNameRefusedForEmptyAgent(t *testing.T) {
	lookup := &stubSellerIdentity{verified: map[string]bool{"agent_linh": true}}
	ok, err := SellerRealNameVerified(context.Background(), lookup, "   ")
	if ok || !errors.Is(err, ErrSellerIdentityAgentRequired) {
		t.Fatalf("an empty agent id must refuse, got ok=%v err=%v", ok, err)
	}
}

func TestSellerRealNameRefusedWhenLookupErrors(t *testing.T) {
	lookup := &stubSellerIdentity{verified: map[string]bool{"agent_linh": true}, err: errors.New("verification store down")}
	ok, err := SellerRealNameVerified(context.Background(), lookup, "agent_linh")
	if ok || err == nil {
		t.Fatalf("a failing lookup must not become 'verified', got ok=%v err=%v", ok, err)
	}
}

// 端到端走真实命令链：能力、时间窗、市场、实名全齐才进候选集。
func TestEligibilityRequiresSellerRealName(t *testing.T) {
	s := New()
	// 除了实名，其余条件全部满足（setupAgent 会顺手放行实名，这里手动走一遍）
	buildFullyQualifiedAgentExceptRealName(t, s, "agent_noid", "NoID")

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
	if !view.Shortage || len(view.Suppliers) != 0 {
		t.Fatalf("a seller with no real-name verification must not be matchable, got suppliers=%v", view.Suppliers)
	}

	// 放行实名后，同一个 agent 应该立刻可撮合 —— 证明守卫不是一刀切。
	markSellersVerified(s, "agent_noid")
	r = s.Handle(envelopeFor("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8,
		"serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, ""))
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Suppliers) != 1 || view.Suppliers[0]["agentId"] != "agent_noid" {
		t.Fatalf("once real-name is verified the seller must be matchable again, got %v", view.Suppliers)
	}
}

// 快照必须把「实名」这一项显式暴露出来，否则运营看不到卖家为什么被挡。
func TestEligibilitySnapshotExposesRealName(t *testing.T) {
	s := New()
	buildFullyQualifiedAgentExceptRealName(t, s, "agent_snap", "Snap")
	markSellersVerified(s, "agent_snap")

	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("CreateCandidateBatch", map[string]any{
		"needId": "need_snap", "marketId": "hn", "startAt": start, "durationH": 8,
		"languages": []string{"ZH"},
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("batch: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		Candidates []Candidate `json:"candidates"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Candidates) != 1 {
		t.Fatalf("want 1 candidate, got %d", len(view.Candidates))
	}
	if !view.Candidates[0].Eligibility.RealNameVerified {
		t.Fatal("eligibility snapshot must report real-name verification, otherwise ops cannot see why a seller is blocked")
	}
}

// 未接实名查询时，候选集必须是空的（fail-closed），而不是照常撮合。
func TestCandidateBatchEmptyWhenRealNameLookupUnwired(t *testing.T) {
	s := New() // 故意不 SetSellerIdentityLookup
	buildFullyQualifiedAgentExceptRealName(t, s, "agent_unwired", "Unwired")

	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := s.Handle(envelopeFor("CreateCandidateBatch", map[string]any{
		"needId": "need_unwired", "marketId": "hn", "startAt": start, "durationH": 8,
		"languages": []string{"ZH"},
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("batch: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		Candidates []Candidate `json:"candidates"`
		Shortage   bool        `json:"shortage"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if len(view.Candidates) != 0 || !view.Shortage {
		t.Fatalf("without a real-name lookup the batch must be empty (fail-closed), got %d candidates", len(view.Candidates))
	}
}

// buildFullyQualifiedAgentExceptRealName 建一个除了实名以外全部合格的 agent。
// 故意不走 setupAgent —— 那个 helper 会顺手放行实名。
func buildFullyQualifiedAgentExceptRealName(t *testing.T, s *Service, agentID, name string) {
	t.Helper()
	// 用 setupAgent 建好能力/服务/窗口，再把实名放回未核验状态。
	setupAgent(t, s, agentID, name, []string{"ZH"}, "hn", 1000000)
	lookup, ok := s.sellerIdentity.(*stubSellerIdentity)
	if !ok {
		t.Fatal("expected stub seller identity lookup")
	}
	lookup.mu.Lock()
	defer lookup.mu.Unlock()
	delete(lookup.verified, agentID)
}

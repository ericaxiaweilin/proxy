package citycompanion

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(needID, commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:       "cmd_test_1",
		CommandType:     commandType,
		CommandVersion:  1,
		Actor:           command.Actor{Type: "USER", ID: "user_001"},
		Principal:       command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:          command.Target{Type: "CityCompanionNeed", ID: needID},
		IdempotencyKey:  "test_key_123456",
		AuthContext:     map[string]any{"session": "s1"},
		Purpose:         "test",
		CorrelationID:   "corr_1",
		RequestedAt:     "2026-08-16T00:00:00Z",
		Payload:         payload,
	}
}

func createNeed(t *testing.T, s *Service) string {
	t.Helper()
	e := envelopeFor("", "CreateCityCompanionNeed", map[string]any{
		"duration":   "8H",
		"language":   "any",
		"genderPref": "any",
		"interests":  []string{"咖啡", "拍照"},
		"meeting":    "还剑湖",
		"budgetVnd":  1500000,
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("create need: got %s, want ACCEPTED (%+v)", result.Outcome, result.Error)
	}
	if result.Aggregate == nil {
		t.Fatal("create need: aggregate missing")
	}
	return result.Aggregate.ID
}

func TestCreateNeedAndCandidateList(t *testing.T) {
	s := New()
	needID := createNeed(t, s)

	// ListCityCompanionCandidates：Eligibility before Ranking
	e := envelopeFor(needID, "ListCityCompanionCandidates", map[string]any{"expectedVersion": 1})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list candidates: got %s (%+v)", result.Outcome, result.Error)
	}
	// 候选从 OperationRef（JSON payload）解析
	candidates := parseCandidates(t, result.OperationRef)
	if len(candidates) != 3 {
		t.Fatalf("want 3 candidates, got %d", len(candidates))
	}
	// 本单报价：候选带 offerVnd（价格属于本单 Offer，非长期标价）
	for _, c := range candidates {
		if c.OfferVND <= 0 {
			t.Fatalf("candidate %s missing offerVnd (price attaches to task, not human)", c.AgentID)
		}
		if len(c.Proofs) == 0 {
			t.Fatalf("candidate %s missing proofs", c.AgentID)
		}
	}
	// 排序：履约率最高的 Linh (0.98) 应排第一
	if candidates[0].AgentID != "agent_linh" {
		t.Fatalf("eligibility ranking: want agent_linh first, got %s", candidates[0].AgentID)
	}
}

func TestConfirmLifecycle(t *testing.T) {
	s := New()
	needID := createNeed(t, s)

	// 确认：Lin 本单报价 1200000
	e := envelopeFor(needID, "ConfirmCityCompanion", map[string]any{
		"expectedVersion": 1,
		"agentId":         "agent_linh",
		"offerVnd":        1200000,
		"includeCafe":     true,
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: got %s (%+v)", result.Outcome, result.Error)
	}
	if result.Aggregate.State != "CONFIRMED" {
		t.Fatalf("want CONFIRMED, got %s", result.Aggregate.State)
	}

	// 重复确认应被拒绝（lifecycle 已 CONFIRMED）
	e2 := envelopeFor(needID, "ConfirmCityCompanion", map[string]any{
		"expectedVersion": 2,
		"agentId":         "agent_mai",
		"offerVnd":        1350000,
	})
	result2 := s.Handle(e2)
	if result2.Outcome != "REJECTED" {
		t.Fatalf("double confirm: want REJECTED, got %s", result2.Outcome)
	}
}

func TestConfirmAgentNotInCandidates(t *testing.T) {
	s := New()
	needID := createNeed(t, s)

	// 确认一个不在候选池的 agent 应被拒绝（候选必须来自本单需求）
	e := envelopeFor(needID, "ConfirmCityCompanion", map[string]any{
		"expectedVersion": 1,
		"agentId":         "agent_stranger",
		"offerVnd":        500000,
	})
	result := s.Handle(e)
	if result.Outcome != "REJECTED" {
		t.Fatalf("want REJECTED for out-of-pool agent, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "AGENT_NOT_IN_CANDIDATES" {
		t.Fatalf("want AGENT_NOT_IN_CANDIDATES, got %+v", result.Error)
	}
}

func TestCompleteAndSceneCommerce(t *testing.T) {
	s := New()
	needID := createNeed(t, s)

	s.Handle(envelopeFor(needID, "ConfirmCityCompanion", map[string]any{
		"expectedVersion": 1,
		"agentId":         "agent_linh",
		"offerVnd":        1200000,
	}))

	// 完成
	result := s.Handle(envelopeFor(needID, "CompleteCityCompanion", map[string]any{"expectedVersion": 2}))
	if result.Outcome != "ACCEPTED" || result.Aggregate.State != "COMPLETED" {
		t.Fatalf("complete: got %s/%s", result.Outcome, result.Aggregate.State)
	}

	// Scene Commerce：到店归因（咖啡）
	result = s.Handle(envelopeFor(needID, "RecordSceneCommerceVisit", map[string]any{
		"expectedVersion": 3,
		"venueId":         "cafe_hoankiem",
		"venueType":       "cafe",
		"attributed":      true,
	}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("scene visit: got %s (%+v)", result.Outcome, result.Error)
	}
}

func TestVersionConflict(t *testing.T) {
	s := New()
	needID := createNeed(t, s)

	// 用错误版本号确认 → 版本冲突
	e := envelopeFor(needID, "ConfirmCityCompanion", map[string]any{
		"expectedVersion": 99,
		"agentId":         "agent_linh",
		"offerVnd":        1200000,
	})
	result := s.Handle(e)
	if result.Outcome != "REJECTED" {
		t.Fatalf("want REJECTED on version conflict, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "CITY_COMPANION_NEED_VERSION_CONFLICT" {
		t.Fatalf("want version conflict, got %+v", result.Error)
	}
}

func TestAuthorization(t *testing.T) {
	s := New()
	needID := createNeed(t, s)

	// 非 owner 操作应被拒绝
	e := envelopeFor(needID, "ListCityCompanionCandidates", map[string]any{"expectedVersion": 1})
	e.Actor = command.Actor{Type: "USER", ID: "user_evil"}
	e.Principal = command.Principal{Type: "INDIVIDUAL", ID: "user_evil"}
	result := s.Handle(e)
	if result.Outcome != "REJECTED" {
		t.Fatalf("want REJECTED for non-owner, got %s", result.Outcome)
	}
}

func parseCandidates(t *testing.T, raw string) []Candidate {
	t.Helper()
	// OperationRef 是 JSON payload；直接解析为 map 再取 candidates
	type candidateView struct {
		Candidates []Candidate `json:"candidates"`
	}
	var view candidateView
	if err := json.Unmarshal([]byte(raw), &view); err != nil {
		t.Fatalf("parse candidates: %v", err)
	}
	if len(view.Candidates) == 0 {
		t.Fatalf("no candidates parsed from %s", raw)
	}
	return view.Candidates
}

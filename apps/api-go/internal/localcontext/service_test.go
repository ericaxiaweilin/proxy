package localcontext

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(actorID, commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "LocalContext", ID: actorID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

func TestSetAndGetLocalContext(t *testing.T) {
	s := New()

	// 设置：河内 · 还剑湖（MANUAL 浏览另一城市）
	e := envelopeFor("user_001", "SetLocalContext", map[string]any{
		"marketId": "hanoi",
		"areaId":   "hoankiem",
		"source":   "MANUAL",
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("set context: got %s (%+v)", result.Outcome, result.Error)
	}
	var view struct {
		Context   LocalContext `json:"context"`
		Available []Market     `json:"available"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("parse set result: %v", err)
	}
	if view.Context.MarketID != "hanoi" || view.Context.MarketLabel != "河内" {
		t.Fatalf("market wrong: %+v", view.Context)
	}
	if view.Context.Precision != "COARSE_AREA" || view.Context.Source != "MANUAL" {
		t.Fatalf("precision/source wrong: %+v", view.Context)
	}
	if len(view.Available) != 3 {
		t.Fatalf("want 3 markets, got %d", len(view.Available))
	}

	// 读取
	e2 := envelopeFor("user_001", "GetLocalContext", map[string]any{})
	r2 := s.Handle(e2)
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("get context: got %s", r2.Outcome)
	}
	var view2 struct {
		Context LocalContext `json:"context"`
	}
	_ = json.Unmarshal([]byte(r2.OperationRef), &view2)
	if view2.Context.MarketID != "hanoi" {
		t.Fatalf("get returned wrong market: %s", view2.Context.MarketID)
	}
}

func TestSetContextInvalidMarket(t *testing.T) {
	s := New()
	e := envelopeFor("user_001", "SetLocalContext", map[string]any{
		"marketId": "tokyo", "source": "MANUAL",
	})
	result := s.Handle(e)
	if result.Outcome != "REJECTED" || result.Error.ErrorCode != "MARKET_NOT_FOUND" {
		t.Fatalf("want MARKET_NOT_FOUND, got %s/%+v", result.Outcome, result.Error)
	}
}

func TestSetContextInvalidArea(t *testing.T) {
	s := New()
	e := envelopeFor("user_001", "SetLocalContext", map[string]any{
		"marketId": "hanoi", "areaId": "nonexistent", "source": "MANUAL",
	})
	result := s.Handle(e)
	if result.Outcome != "REJECTED" || result.Error.ErrorCode != "AREA_NOT_FOUND" {
		t.Fatalf("want AREA_NOT_FOUND, got %s/%+v", result.Outcome, result.Error)
	}
}

func TestContextPerActor(t *testing.T) {
	s := New()
	// user_001 设置河内
	s.Handle(envelopeFor("user_001", "SetLocalContext", map[string]any{
		"marketId": "hanoi", "source": "DEVICE",
	}))
	// user_002 未设置 → UNSET（独立状态，互不影响）
	e := envelopeFor("user_002", "GetLocalContext", map[string]any{})
	r := s.Handle(e)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("get unset: got %s", r.Outcome)
	}
	var view struct {
		Context *LocalContext `json:"context"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Context != nil {
		t.Fatal("user_002 should have no context (isolation)")
	}
}

func TestGrantExactLocation(t *testing.T) {
	s := New()
	e := envelopeFor("user_001", "GrantExactLocation", map[string]any{
		"purpose": "TASK", "referenceId": "task_1",
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("grant: got %s (%+v)", result.Outcome, result.Error)
	}
	if result.Aggregate.State != "GRANTED" {
		t.Fatalf("want GRANTED, got %s", result.Aggregate.State)
	}
	// 非法 purpose
	e2 := envelopeFor("user_001", "GrantExactLocation", map[string]any{
		"purpose": "BROWSING", "referenceId": "x",
	})
	r2 := s.Handle(e2)
	if r2.Outcome != "REJECTED" || r2.Error.ErrorCode != "INVALID_GRANT_PURPOSE" {
		t.Fatalf("want INVALID_GRANT_PURPOSE, got %s/%+v", r2.Outcome, r2.Error)
	}
}

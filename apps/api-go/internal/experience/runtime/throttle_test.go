package runtime

import (
	"testing"
	"time"
)

func TestThrottlerSuppress(t *testing.T) {
	th := NewThrottler(30*time.Second, 0.08)
	th.RecordChange("home", 0.80)
	// within cooldown, small delta → suppressed
	if !th.ShouldSuppress("home", 0.82) {
		t.Fatal("expected suppressed")
	}
	// large delta → not suppressed
	if th.ShouldSuppress("home", 0.90) {
		t.Fatal("expected not suppressed for large priority jump")
	}
	// interaction lock
	th.LockInteraction("home", 5*time.Second)
	if !th.ShouldSuppress("home", 0.99) {
		t.Fatal("expected suppressed during interaction lock")
	}
	th = NewThrottler(10*time.Millisecond, 0.08)
	th.RecordChange("home", 0.80)
	time.Sleep(15 * time.Millisecond)
	if th.ShouldSuppress("home", 0.81) {
		t.Fatal("expected not suppressed after cooldown")
	}
}

func TestPatternRegistry(t *testing.T) {
	reg := NewPatternRegistry()
	schema := UISchema{
		SchemaVersion: "ui_schema_v3",
		Root: UISchemaNode{Type: "stack", Children: []UISchemaNode{
			{Type: "alert"}, {Type: "merchant_list"},
		}},
	}
	for i := 0; i < 120; i++ {
		reg.Record(schema)
	}
	cands := reg.Candidates(100, 0.8)
	if len(cands) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(cands))
	}
	reg.Promote(cands[0].Signature, "RainCommuteCard")
	if _, ok := reg.IsPromoted(cands[0].Signature); !ok {
		t.Fatal("expected promoted")
	}
	if len(reg.Candidates(100, 0.8)) != 0 {
		t.Fatal("promoted should not appear again")
	}
}

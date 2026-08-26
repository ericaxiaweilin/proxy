package runtime

import (
	"testing"
	"time"
)

func TestMetricsRecord(t *testing.T) {
	m := &Metrics{}
	m.RecordCompile(10*time.Millisecond, false)
	m.RecordCompile(20*time.Millisecond, true)
	m.RecordCapabilityFallback()
	m.RecordNoUIChange()
	m.RecordDeltaApply(true)
	m.RecordDeltaApply(false)
	snap := m.Snapshot()
	if snap.CompileCount != 2 {
		t.Fatalf("expected 2, got %d", snap.CompileCount)
	}
	if snap.ValidationFailCount != 1 {
		t.Fatalf("expected 1 fail, got %d", snap.ValidationFailCount)
	}
	if snap.CapabilityFallbackCount != 1 || snap.NoUIChangeCount != 1 {
		t.Fatal("counts mismatch")
	}
	if snap.CompileLatencyP50 == 0 || snap.CompileLatencyP95 == 0 {
		t.Fatal("latency not computed")
	}
}

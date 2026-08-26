package runtime

import (
	"sync"
	"time"
)

// Metrics — §22 可观测性
// Go 端轻量内存计数，生产环境接入 OpenTelemetry / Prometheus
type Metrics struct {
	mu sync.Mutex

	CompileCount        int64
	CompileLatencyP50   time.Duration
	CompileLatencyP95   time.Duration
	latencies           []time.Duration
	ValidationFailCount int64
	CapabilityFallbackCount int64
	DeltaApplySuccess   int64
	DeltaRejectCount    int64
	SnapshotRecoveryCount int64
	RenderErrorCount    int64
	NoUIChangeCount     int64
}

func (m *Metrics) RecordCompile(d time.Duration, failed bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CompileCount++
	if failed {
		m.ValidationFailCount++
	}
	m.latencies = append(m.latencies, d)
	if len(m.latencies) > 1000 {
		m.latencies = m.latencies[500:]
	}
	m.recomputeLatency()
}

func (m *Metrics) RecordCapabilityFallback() {
	m.mu.Lock()
	m.CapabilityFallbackCount++
	m.mu.Unlock()
}

func (m *Metrics) RecordNoUIChange() {
	m.mu.Lock()
	m.NoUIChangeCount++
	m.mu.Unlock()
}

func (m *Metrics) RecordDeltaApply(success bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if success {
		m.DeltaApplySuccess++
	} else {
		m.DeltaRejectCount++
	}
}

func (m *Metrics) RecordSnapshotRecovery() {
	m.mu.Lock()
	m.SnapshotRecoveryCount++
	m.mu.Unlock()
}

func (m *Metrics) Snapshot() Metrics {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *m
	cp.latencies = nil
	return cp
}

func (m *Metrics) recomputeLatency() {
	if len(m.latencies) == 0 {
		return
	}
	sorted := make([]time.Duration, len(m.latencies))
	copy(sorted, m.latencies)
	// simple insertion sort for small n
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	m.CompileLatencyP50 = sorted[len(sorted)/2]
	m.CompileLatencyP95 = sorted[len(sorted)*95/100]
}

var GlobalMetrics = &Metrics{}

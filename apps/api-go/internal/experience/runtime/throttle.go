package runtime

import (
	"sync"
	"time"
)

// Throttler — §25 Anti-Thrashing：防止 Context 抖动导致 UI 频繁跳动
// change_threshold / minimum_stable_window / surface_cooldown / priority_margin / interaction_lock
type Throttler struct {
	mu sync.Mutex

	// per-surface state
	lastChangeTime map[string]time.Time
	lastPriority   map[string]float64
	cooldown       time.Duration
	priorityMargin float64
	interactionLockUntil map[string]time.Time
}

func NewThrottler(cooldown time.Duration, priorityMargin float64) *Throttler {
	if cooldown == 0 {
		cooldown = 30 * time.Second
	}
	if priorityMargin == 0 {
		priorityMargin = 0.08
	}
	return &Throttler{
		lastChangeTime: make(map[string]time.Time),
		lastPriority:   make(map[string]float64),
		cooldown:       cooldown,
		priorityMargin: priorityMargin,
		interactionLockUntil: make(map[string]time.Time),
	}
}

// ShouldSuppress decides if a new Intent should be suppressed
// — §25: rain_probability .48→.51 不应触发；而 ETA 31→64 + heavy_rain 可触发
func (t *Throttler) ShouldSuppress(surfaceID string, newPriority float64) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	// interaction lock — user is typing / scrolling / expanding
	if until, ok := t.interactionLockUntil[surfaceID]; ok && now.Before(until) {
		return true
	}
	lastTime, hasTime := t.lastChangeTime[surfaceID]
	if hasTime && now.Sub(lastTime) < t.cooldown {
		// within cooldown, only allow if priority margin exceeds threshold
		lastPrio := t.lastPriority[surfaceID]
		if newPriority-lastPrio < t.priorityMargin {
			return true
		}
	}
	return false
}

func (t *Throttler) RecordChange(surfaceID string, priority float64) {
	t.mu.Lock()
	t.lastChangeTime[surfaceID] = time.Now()
	t.lastPriority[surfaceID] = priority
	t.mu.Unlock()
}

// LockInteraction prevents Delta from resetting local ephemeral state (§15.1)
func (t *Throttler) LockInteraction(surfaceID string, duration time.Duration) {
	t.mu.Lock()
	t.interactionLockUntil[surfaceID] = time.Now().Add(duration)
	t.mu.Unlock()
}

func (t *Throttler) IsInteractionLocked(surfaceID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	until, ok := t.interactionLockUntil[surfaceID]
	return ok && time.Now().Before(until)
}

var GlobalThrottler = NewThrottler(30*time.Second, 0.08)

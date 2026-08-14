package clock

import (
	"sync"
	"time"
)

// Clock is the domain time boundary. Domain code must not call time.Now()
// directly so TTLs, expiry and state-machine tests remain deterministic.
type Clock interface {
	Now() time.Time
}

type System struct{}

func (System) Now() time.Time {
	return time.Now().UTC()
}

type Fixed struct {
	mu  sync.RWMutex
	now time.Time
}

func NewFixed(now time.Time) *Fixed {
	return &Fixed{now: now.UTC()}
}

func (c *Fixed) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *Fixed) Advance(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(duration)
}

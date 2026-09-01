package demand

import (
	"context"
	"time"
)

// SupplyBatchCreator adapts supply service's CreateCandidateBatch command to demand's BatchCreator.
// It is wired in cmd/api/main when both demand and supply are PG-backed.
type SupplyBatchCreator struct {
	Supply interface {
		HandleContext(ctx context.Context, e interface{}) interface{}
	}
	// We use a generic handler to avoid import cycle; main.go will provide a closure.
	CreateFunc func(ctx context.Context, draft TaskDraft) error
}

func (s *SupplyBatchCreator) CreateBatchForTask(ctx context.Context, draft TaskDraft) error {
	if s.CreateFunc != nil {
		return s.CreateFunc(ctx, draft)
	}
	return nil
}

// Helper to compute durationH from startAt/endAt strings
func durationHours(startAt, endAt string) int {
	s, err1 := time.Parse(time.RFC3339, startAt)
	e, err2 := time.Parse(time.RFC3339, endAt)
	if err1 != nil || err2 != nil {
		return 8
	}
	h := int(e.Sub(s).Hours())
	if h <= 0 {
		return 8
	}
	if h > 24 {
		return 24
	}
	return h
}

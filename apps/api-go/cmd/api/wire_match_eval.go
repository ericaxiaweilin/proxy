package main

import (
	"context"
	"time"

	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/matching"
)

// OPS-MATCH-EVAL-001：评估用的案例来自真库（insight.EvalCases）；名次用此刻的 UserSignals 重算。
type matchEvalSource struct {
	cases interface {
		EvalCases(ctx context.Context, since time.Time, limit int) ([]insight.EvalCase, error)
	}
	signals userSignalsReader
}

func (m matchEvalSource) Cases(ctx context.Context, since time.Time, limit int) ([]api.EvalCase, error) {
	return m.cases.EvalCases(ctx, since, limit)
}

func (m matchEvalSource) Rank(ctx context.Context, c api.EvalCase) ([]matching.Ranked, error) {
	sigs, err := m.signals.UserSignals(ctx, c.Applicants)
	if err != nil {
		return nil, err
	}
	return matching.Rank(c.Applicants, nil, matching.WithDistances(sigs, c.Applicants, c.Lat, c.Lng), 0), nil
}

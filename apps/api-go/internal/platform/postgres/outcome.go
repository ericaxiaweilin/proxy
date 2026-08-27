package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/outcome"
)

// OutcomeRepository 持久化 M6.5 Outcome Intelligence (ObservationSet /
// Observation / OutcomeDelta / Learning)。schema 见 020_outcome_intelligence.sql。
type OutcomeRepository struct {
	pool *pgxpool.Pool
}

func NewOutcomeRepository(pool *pgxpool.Pool) *OutcomeRepository {
	return &OutcomeRepository{pool: pool}
}

var ErrOutcomeSetNotFound = errors.New("observation set not found")
var ErrOutcomeLearningNotFound = errors.New("learning not found")

func (r *OutcomeRepository) CreateSet(ctx context.Context, s outcome.ObservationSet) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO outcome.observation_sets
			(id, target_id, template_id, venue_id, status, created_at, finalized_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		s.ID, s.TargetID, s.TemplateID, s.VenueID, s.Status, s.CreatedAt, s.FinalizedAt,
	)
	return err
}

func (r *OutcomeRepository) GetSet(ctx context.Context, id string) (outcome.ObservationSet, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, target_id, template_id, venue_id, status, created_at, finalized_at
		FROM outcome.observation_sets WHERE id=$1`, id)
	var s outcome.ObservationSet
	var finalized *time.Time
	if err := row.Scan(&s.ID, &s.TargetID, &s.TemplateID, &s.VenueID, &s.Status, &s.CreatedAt, &finalized); err != nil {
		return outcome.ObservationSet{}, fmt.Errorf("%w: %v", ErrOutcomeSetNotFound, err)
	}
	s.FinalizedAt = finalized
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, set_id, key, value, unit, created_at
		FROM outcome.observations WHERE set_id=$1 ORDER BY created_at`, id)
	if err != nil {
		return outcome.ObservationSet{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var o outcome.Observation
		if err := rows.Scan(&o.ID, &o.SetID, &o.Key, &o.Value, &o.Unit, &o.CreatedAt); err != nil {
			return outcome.ObservationSet{}, err
		}
		s.Observations = append(s.Observations, o)
	}
	return s, nil
}

func (r *OutcomeRepository) UpdateSet(ctx context.Context, s outcome.ObservationSet) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE outcome.observation_sets
		SET target_id=$2, template_id=$3, venue_id=$4, status=$5, finalized_at=$6
		WHERE id=$1`,
		s.ID, s.TargetID, s.TemplateID, s.VenueID, s.Status, s.FinalizedAt,
	)
	return err
}

func (r *OutcomeRepository) CreateDelta(ctx context.Context, d outcome.OutcomeDelta) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO outcome.deltas
			(id, baseline_id, result_id, result, policy_version, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		d.ID, d.BaselineID, d.ResultID, d.Result, d.PolicyVersion, d.CreatedAt,
	)
	return err
}

func (r *OutcomeRepository) CreateLearning(ctx context.Context, l outcome.Learning) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO outcome.learnings (id, delta_id, status, created_at)
		VALUES ($1,$2,$3,$4)`, l.ID, l.DeltaID, l.Status, l.CreatedAt)
	return err
}

func (r *OutcomeRepository) GetLearning(ctx context.Context, id string) (outcome.Learning, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, delta_id, status, created_at
		FROM outcome.learnings WHERE id=$1`, id)
	var l outcome.Learning
	if err := row.Scan(&l.ID, &l.DeltaID, &l.Status, &l.CreatedAt); err != nil {
		return outcome.Learning{}, fmt.Errorf("%w: %v", ErrOutcomeLearningNotFound, err)
	}
	return l, nil
}

func (r *OutcomeRepository) UpdateLearning(ctx context.Context, l outcome.Learning) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE outcome.learnings SET status=$2 WHERE id=$1`, l.ID, l.Status)
	return err
}

var _ outcome.Repository = (*OutcomeRepository)(nil)

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/media"
)

// MediaReviewDecisionRepository — Postgres 实现,跟 media.MemoryReviewDecisionRepository
// 一样实现 media.ReviewDecisionRepository 接口。
//
// append-only: 没 Update/Delete 方法。重复 decision_id 走
// media.media_review_decisions 主键冲突返回 wrapped error。
type MediaReviewDecisionRepository struct {
	pool *pgxpool.Pool
}

func NewMediaReviewDecisionRepository(pool *pgxpool.Pool) *MediaReviewDecisionRepository {
	return &MediaReviewDecisionRepository{pool: pool}
}

const mediaReviewDecisionColumns = `
	decision_id, media_asset_id, from_status, to_status,
	reason, note, operator_id, reviewed_at`

func (r *MediaReviewDecisionRepository) AppendReviewDecision(ctx context.Context, d media.MediaReviewDecision) error {
	if d.DecisionID == "" {
		return errors.New("decision id is required")
	}
	if d.MediaAssetID == "" {
		return errors.New("media asset id is required")
	}
	if d.OperatorID == "" {
		return errors.New("operator id is required")
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO media.media_review_decisions (
			`+mediaReviewDecisionColumns+`
		) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))`,
		d.DecisionID, d.MediaAssetID, d.FromStatus, d.ToStatus,
		d.Reason, d.Note, d.OperatorID, nullableTime(d.ReviewedAt))
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("decision id already exists: %w", err)
		}
		return err
	}
	return nil
}

func (r *MediaReviewDecisionRepository) ListReviewDecisions(ctx context.Context, mediaAssetID string, limit int) ([]media.MediaReviewDecision, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT `+mediaReviewDecisionColumns+`
		FROM media.media_review_decisions
		WHERE ($1 = '' OR media_asset_id = $1)
		ORDER BY reviewed_at DESC
		LIMIT $2`, mediaAssetID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]media.MediaReviewDecision, 0, limit)
	for rows.Next() {
		var d media.MediaReviewDecision
		if err := rows.Scan(
			&d.DecisionID, &d.MediaAssetID, &d.FromStatus, &d.ToStatus,
			&d.Reason, &d.Note, &d.OperatorID, &d.ReviewedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *MediaReviewDecisionRepository) GetReviewDecision(ctx context.Context, decisionID string) (media.MediaReviewDecision, error) {
	var d media.MediaReviewDecision
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT `+mediaReviewDecisionColumns+`
		FROM media.media_review_decisions
		WHERE decision_id = $1`, decisionID).Scan(
		&d.DecisionID, &d.MediaAssetID, &d.FromStatus, &d.ToStatus,
		&d.Reason, &d.Note, &d.OperatorID, &d.ReviewedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return media.MediaReviewDecision{}, media.ErrReviewDecisionNotFound
		}
		return media.MediaReviewDecision{}, err
	}
	return d, nil
}

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/marketplace"
)

type MarketplaceRepository struct{ pool *pgxpool.Pool }

func NewMarketplaceRepository(pool *pgxpool.Pool) *MarketplaceRepository {
	return &MarketplaceRepository{pool: pool}
}

func (r *MarketplaceRepository) Seed(ctx context.Context, opportunities []marketplace.Opportunity) error {
	for _, opportunity := range opportunities {
		payload, err := json.Marshal(opportunity)
		if err != nil {
			return fmt.Errorf("encode market opportunity: %w", err)
		}
		// R15.x (P1 market 附近): payload 包含 lat/lng/travelSource,
		// 必须 ON CONFLICT DO UPDATE 才能让老 seed 拿到新坐标. ON
		// CONFLICT DO NOTHING (之前) 会让老行 payload 永远停在种子首次
		// 插入时的版本, haversine 路径会落到 Lat==nil 分支返回
		// "seeded" — 也就是说"市场附近"特性 在现有 PG 上只是空操作。
		// owner_id / responses 不动, 只刷 payload (lat/lng/travelSource
		// 都在 payload 里)。
		if _, err := queryerForContext(ctx, r.pool).Exec(ctx, `
			INSERT INTO marketplace.opportunities (id, owner_id, payload, responses)
			VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
			opportunity.ID, opportunity.OwnerID, payload, opportunity.Responses); err != nil {
			return err
		}
	}
	return nil
}

func (r *MarketplaceRepository) List(ctx context.Context, viewerID string) ([]marketplace.Opportunity, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT o.payload, o.owner_id, o.responses,
		       (o.owner_id = $1), EXISTS (
		           SELECT 1 FROM marketplace.applications a
		           WHERE a.opportunity_id = o.id AND a.applicant_id = $1)
		FROM marketplace.opportunities o
		WHERE NOT EXISTS (
		    SELECT 1 FROM marketplace.dismissals d
		    WHERE d.opportunity_id = o.id AND d.viewer_id = $1)
		ORDER BY o.created_at DESC`, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []marketplace.Opportunity{}
	for rows.Next() {
		var payload []byte
		var item marketplace.Opportunity
		if err := rows.Scan(&payload, &item.OwnerID, &item.Responses, &item.Owned, &item.Applied); err != nil {
			return nil, err
		}
		ownerID, responses, owned, applied := item.OwnerID, item.Responses, item.Owned, item.Applied
		if err := json.Unmarshal(payload, &item); err != nil {
			return nil, fmt.Errorf("decode market opportunity: %w", err)
		}
		item.OwnerID, item.Responses, item.Owned, item.Applied = ownerID, responses, owned, applied
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *MarketplaceRepository) Get(ctx context.Context, id string) (marketplace.Opportunity, error) {
	var payload []byte
	var item marketplace.Opportunity
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT payload, owner_id, responses FROM marketplace.opportunities WHERE id=$1`, id).
		Scan(&payload, &item.OwnerID, &item.Responses)
	if errors.Is(err, pgx.ErrNoRows) {
		return marketplace.Opportunity{}, marketplace.ErrOpportunityNotFound
	}
	if err != nil {
		return marketplace.Opportunity{}, err
	}
	ownerID, responses := item.OwnerID, item.Responses
	if err := json.Unmarshal(payload, &item); err != nil {
		return marketplace.Opportunity{}, fmt.Errorf("decode market opportunity: %w", err)
	}
	item.OwnerID, item.Responses = ownerID, responses
	return item, nil
}

func (r *MarketplaceRepository) Create(ctx context.Context, opportunity marketplace.Opportunity) error {
	payload, err := json.Marshal(opportunity)
	if err != nil {
		return fmt.Errorf("encode market opportunity: %w", err)
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO marketplace.opportunities (id, owner_id, payload, responses)
		VALUES ($1,$2,$3,$4)`, opportunity.ID, opportunity.OwnerID, payload, opportunity.Responses)
	return err
}

func (r *MarketplaceRepository) Apply(ctx context.Context, application marketplace.Application) (marketplace.Application, bool, error) {
	var result marketplace.Application
	created := false
	err := runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		payload, err := json.Marshal(application)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(txCtx, `
			INSERT INTO marketplace.applications (id, opportunity_id, applicant_id, payload, created_at)
			VALUES ($1,$2,$3,$4,$5) ON CONFLICT (opportunity_id, applicant_id) DO NOTHING`,
			application.ID, application.OpportunityID, application.ApplicantID, payload, application.CreatedAt)
		if err != nil {
			return err
		}
		created = tag.RowsAffected() == 1
		if created {
			if _, err := tx.Exec(txCtx, `UPDATE marketplace.opportunities SET responses=responses+1 WHERE id=$1`, application.OpportunityID); err != nil {
				return err
			}
			result = application
			return nil
		}
		var existing []byte
		if err := tx.QueryRow(txCtx, `SELECT payload FROM marketplace.applications WHERE opportunity_id=$1 AND applicant_id=$2`, application.OpportunityID, application.ApplicantID).Scan(&existing); err != nil {
			return err
		}
		return json.Unmarshal(existing, &result)
	})
	return result, created, err
}

func (r *MarketplaceRepository) Dismiss(ctx context.Context, viewerID, opportunityID string) error {
	var exists bool
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM marketplace.opportunities WHERE id=$1)`, opportunityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return marketplace.ErrOpportunityNotFound
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO marketplace.dismissals (opportunity_id, viewer_id) VALUES ($1,$2)
		ON CONFLICT DO NOTHING`, opportunityID, viewerID)
	return err
}

var _ marketplace.Repository = (*MarketplaceRepository)(nil)

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

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
		       (o.owner_id = $1), (
		           SELECT a.payload FROM marketplace.applications a
		           WHERE a.opportunity_id = o.id AND a.applicant_id = $1 LIMIT 1)
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
		var applicationPayload []byte
		var item marketplace.Opportunity
		if err := rows.Scan(&payload, &item.OwnerID, &item.Responses, &item.Owned, &applicationPayload); err != nil {
			return nil, err
		}
		ownerID, responses, owned := item.OwnerID, item.Responses, item.Owned
		if err := json.Unmarshal(payload, &item); err != nil {
			return nil, fmt.Errorf("decode market opportunity: %w", err)
		}
		item.OwnerID, item.Responses, item.Owned = ownerID, responses, owned
		if len(applicationPayload) > 0 {
			var application marketplace.Application
			if err := json.Unmarshal(applicationPayload, &application); err != nil {
				return nil, fmt.Errorf("decode viewer market application: %w", err)
			}
			item.Applied = true
			item.ViewerApplicationID = application.ID
			item.ViewerApplicationStatus = application.Status
			item.ViewerOrderRef = application.OrderRef
		}
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

func (r *MarketplaceRepository) ListApplications(ctx context.Context, opportunityID, ownerID string) ([]marketplace.Application, error) {
	var owned bool
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM marketplace.opportunities WHERE id=$1 AND owner_id=$2)`, opportunityID, ownerID).Scan(&owned); err != nil {
		return nil, err
	}
	if !owned {
		return nil, marketplace.ErrOpportunityNotFound
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx,
		`SELECT payload FROM marketplace.applications WHERE opportunity_id=$1 ORDER BY created_at ASC`, opportunityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []marketplace.Application{}
	for rows.Next() {
		var raw []byte
		var item marketplace.Application
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, fmt.Errorf("decode market application: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *MarketplaceRepository) SelectApplication(ctx context.Context, opportunityID, applicationID, ownerID string) (marketplace.Application, error) {
	var selected marketplace.Application
	err := runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		var actualOwner string
		if err := tx.QueryRow(txCtx, `SELECT owner_id FROM marketplace.opportunities WHERE id=$1 FOR UPDATE`, opportunityID).Scan(&actualOwner); errors.Is(err, pgx.ErrNoRows) || (err == nil && actualOwner != ownerID) {
			return marketplace.ErrOpportunityNotFound
		} else if err != nil {
			return err
		}

		rows, err := tx.Query(txCtx, `SELECT id, payload FROM marketplace.applications WHERE opportunity_id=$1 FOR UPDATE`, opportunityID)
		if err != nil {
			return err
		}
		type stored struct {
			id  string
			app marketplace.Application
		}
		var all []stored
		for rows.Next() {
			var item stored
			var raw []byte
			if err := rows.Scan(&item.id, &raw); err != nil {
				rows.Close()
				return err
			}
			if err := json.Unmarshal(raw, &item.app); err != nil {
				rows.Close()
				return err
			}
			all = append(all, item)
		}
		rows.Close()
		found := false
		now := time.Now().UTC()
		for _, item := range all {
			app := item.app
			if item.id == applicationID {
				found = true
				if app.Status != "SUBMITTED" && app.Status != "SELECTED" {
					return marketplace.ErrApplicationStateConflict
				}
				app.Status, app.SelectedAt = "SELECTED", &now
				selected = app
			} else if app.Status == "SUBMITTED" {
				app.Status = "NOT_SELECTED"
			}
			raw, err := json.Marshal(app)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(txCtx, `UPDATE marketplace.applications SET payload=$2 WHERE id=$1`, item.id, raw); err != nil {
				return err
			}
		}
		if !found {
			return marketplace.ErrApplicationNotFound
		}
		return nil
	})
	return selected, err
}

func (r *MarketplaceRepository) ConfirmApplication(ctx context.Context, applicationID, applicantID, orderRef string) (marketplace.Application, error) {
	var confirmed marketplace.Application
	err := runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		var raw []byte
		var storedApplicant string
		if err := tx.QueryRow(txCtx, `SELECT applicant_id, payload FROM marketplace.applications WHERE id=$1 FOR UPDATE`, applicationID).Scan(&storedApplicant, &raw); errors.Is(err, pgx.ErrNoRows) || (err == nil && storedApplicant != applicantID) {
			return marketplace.ErrApplicationNotFound
		} else if err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &confirmed); err != nil {
			return err
		}
		if confirmed.Status == "CONFIRMED" {
			return nil
		}
		if confirmed.Status != "SELECTED" {
			return marketplace.ErrApplicationStateConflict
		}
		now := time.Now().UTC()
		confirmed.Status, confirmed.ConfirmedAt, confirmed.OrderRef = "CONFIRMED", &now, orderRef
		raw, err := json.Marshal(confirmed)
		if err != nil {
			return err
		}
		_, err = tx.Exec(txCtx, `UPDATE marketplace.applications SET payload=$2 WHERE id=$1`, applicationID, raw)
		return err
	})
	return confirmed, err
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

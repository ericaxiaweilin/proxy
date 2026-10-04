package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-INVITE-001：定向邀约的 Postgres 存取。
// startAt/respondedAt 可空 —— 零值 time.Time 存 NULL，读 NULL 回零值。

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func scanInvitation(scan func(...any) error) (supply.CollabInvitation, error) {
	var inv supply.CollabInvitation
	var startAt, respondedAt *time.Time
	err := scan(
		&inv.ID, &inv.MerchantID, &inv.AgentID, &inv.ServiceType,
		&startAt, &inv.DurationH, &inv.PriceMinVND, &inv.PriceMaxVND, &inv.Negotiable,
		&inv.Purpose, &inv.Message, &inv.Status, &inv.TermsVersion, &inv.CounterBy,
		&inv.Currency, &inv.CreatedAt, &respondedAt, &inv.ExpiresAt,
	)
	if err != nil {
		return supply.CollabInvitation{}, err
	}
	if startAt != nil {
		inv.StartAt = *startAt
	}
	if respondedAt != nil {
		inv.RespondedAt = *respondedAt
	}
	return inv, nil
}

const collabInvitationColumns = `id, merchant_id, agent_id, service_type, start_at,
	duration_h, price_min_vnd, price_max_vnd, negotiable, purpose, message, status,
	terms_version, counter_by, currency, created_at, responded_at, expires_at`

func (r *SupplyRepository) SaveInvitation(ctx context.Context, inv supply.CollabInvitation) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.collab_invitations (`+collabInvitationColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		inv.ID, inv.MerchantID, inv.AgentID, inv.ServiceType,
		nullTime(inv.StartAt), inv.DurationH, inv.PriceMinVND, inv.PriceMaxVND, inv.Negotiable,
		inv.Purpose, inv.Message, inv.Status, inv.TermsVersion, inv.CounterBy,
		inv.Currency, inv.CreatedAt, nullTime(inv.RespondedAt), inv.ExpiresAt,
	)
	return err
}

func (r *SupplyRepository) GetInvitation(ctx context.Context, id string) (supply.CollabInvitation, error) {
	inv, err := scanInvitation(queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT `+collabInvitationColumns+`
		FROM supply.collab_invitations WHERE id=$1`, id).Scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.CollabInvitation{}, supply.ErrInvitationNotFound
	}
	return inv, err
}

func (r *SupplyRepository) UpdateInvitation(ctx context.Context, inv supply.CollabInvitation) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.collab_invitations
		SET service_type=$2, start_at=$3, duration_h=$4,
		    price_min_vnd=$5, price_max_vnd=$6, negotiable=$7, purpose=$8,
		    message=$9, status=$10, terms_version=$11, counter_by=$12,
		    currency=$13, responded_at=$14, expires_at=$15
		WHERE id=$1`,
		inv.ID, inv.ServiceType, nullTime(inv.StartAt), inv.DurationH,
		inv.PriceMinVND, inv.PriceMaxVND, inv.Negotiable, inv.Purpose,
		inv.Message, inv.Status, inv.TermsVersion, inv.CounterBy,
		inv.Currency, nullTime(inv.RespondedAt), inv.ExpiresAt,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return supply.ErrInvitationNotFound
	}
	return nil
}

func (r *SupplyRepository) listInvitations(ctx context.Context, column, value string) ([]supply.CollabInvitation, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT `+collabInvitationColumns+`
		FROM supply.collab_invitations WHERE `+column+`=$1 ORDER BY created_at DESC`, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.CollabInvitation{}
	for rows.Next() {
		inv, err := scanInvitation(rows.Scan)
		if err != nil {
			return nil, err
		}
		result = append(result, inv)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) ListInvitationsByMerchant(ctx context.Context, merchantID string) ([]supply.CollabInvitation, error) {
	return r.listInvitations(ctx, "merchant_id", merchantID)
}

func (r *SupplyRepository) ListInvitationsByAgent(ctx context.Context, agentID string) ([]supply.CollabInvitation, error) {
	return r.listInvitations(ctx, "agent_id", agentID)
}

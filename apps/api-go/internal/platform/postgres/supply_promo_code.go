package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-PROMO-001：专属营销码的 Postgres 存取。
// quotes 只增不改（核销记录不删）；benefits 以 (merchant_id, code) 为键。

func (r *SupplyRepository) SavePromoCode(ctx context.Context, c supply.PromoCode) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.promo_codes (code, agent_id, status, created_at)
		VALUES ($1,$2,$3,$4)`,
		c.Code, c.AgentID, c.Status, c.CreatedAt,
	)
	return err
}

func (r *SupplyRepository) GetPromoCode(ctx context.Context, code string) (supply.PromoCode, error) {
	var c supply.PromoCode
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT code, agent_id, status, created_at
		FROM supply.promo_codes WHERE code=$1`, code).Scan(
		&c.Code, &c.AgentID, &c.Status, &c.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.PromoCode{}, supply.ErrPromoCodeNotFound
	}
	return c, err
}

func (r *SupplyRepository) UpdatePromoCode(ctx context.Context, c supply.PromoCode) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.promo_codes SET agent_id=$2, status=$3 WHERE code=$1`,
		c.Code, c.AgentID, c.Status,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return supply.ErrPromoCodeNotFound
	}
	return nil
}

func (r *SupplyRepository) ListPromoCodesByAgent(ctx context.Context, agentID string) ([]supply.PromoCode, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT code, agent_id, status, created_at
		FROM supply.promo_codes WHERE agent_id=$1 ORDER BY created_at DESC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.PromoCode{}
	for rows.Next() {
		var c supply.PromoCode
		if err := rows.Scan(&c.Code, &c.AgentID, &c.Status, &c.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) SavePromoBenefit(ctx context.Context, b supply.PromoBenefit) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.promo_benefits (merchant_id, code, face_value_vnd, scope_name, valid_until, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		b.MerchantID, b.Code, b.FaceValueVND, b.ScopeName, b.ValidUntil, b.Status, b.CreatedAt,
	)
	return err
}

func (r *SupplyRepository) GetPromoBenefit(ctx context.Context, merchantID, code string) (supply.PromoBenefit, error) {
	var b supply.PromoBenefit
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT merchant_id, code, face_value_vnd, scope_name, valid_until, status, created_at
		FROM supply.promo_benefits WHERE merchant_id=$1 AND code=$2`, merchantID, code).Scan(
		&b.MerchantID, &b.Code, &b.FaceValueVND, &b.ScopeName, &b.ValidUntil, &b.Status, &b.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return supply.PromoBenefit{}, supply.ErrPromoNotBound
	}
	return b, err
}

func (r *SupplyRepository) UpdatePromoBenefit(ctx context.Context, b supply.PromoBenefit) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.promo_benefits
		SET face_value_vnd=$3, scope_name=$4, valid_until=$5, status=$6
		WHERE merchant_id=$1 AND code=$2`,
		b.MerchantID, b.Code, b.FaceValueVND, b.ScopeName, b.ValidUntil, b.Status,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return supply.ErrPromoNotBound
	}
	return nil
}

func (r *SupplyRepository) ListPromoBenefitsByMerchant(ctx context.Context, merchantID string) ([]supply.PromoBenefit, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT merchant_id, code, face_value_vnd, scope_name, valid_until, status, created_at
		FROM supply.promo_benefits WHERE merchant_id=$1 ORDER BY created_at DESC`, merchantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.PromoBenefit{}
	for rows.Next() {
		var b supply.PromoBenefit
		if err := rows.Scan(&b.MerchantID, &b.Code, &b.FaceValueVND, &b.ScopeName, &b.ValidUntil, &b.Status, &b.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, b)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) SavePromoQuote(ctx context.Context, q supply.PromoQuote) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.promo_quotes (id, merchant_id, agent_id, code, amount_vnd, discount_vnd, first_visit, quoted_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		q.ID, q.MerchantID, q.AgentID, q.Code, q.AmountVND, q.DiscountVND, q.FirstVisit, q.QuotedAt,
	)
	return err
}

func (r *SupplyRepository) listPromoQuotes(ctx context.Context, column, value string) ([]supply.PromoQuote, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, merchant_id, agent_id, code, amount_vnd, discount_vnd, first_visit, quoted_at
		FROM supply.promo_quotes WHERE `+column+`=$1 ORDER BY quoted_at DESC`, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []supply.PromoQuote{}
	for rows.Next() {
		var q supply.PromoQuote
		if err := rows.Scan(&q.ID, &q.MerchantID, &q.AgentID, &q.Code, &q.AmountVND, &q.DiscountVND, &q.FirstVisit, &q.QuotedAt); err != nil {
			return nil, err
		}
		result = append(result, q)
	}
	return result, rows.Err()
}

func (r *SupplyRepository) ListPromoQuotesByMerchant(ctx context.Context, merchantID string) ([]supply.PromoQuote, error) {
	return r.listPromoQuotes(ctx, "merchant_id", merchantID)
}

func (r *SupplyRepository) ListPromoQuotesByAgent(ctx context.Context, agentID string) ([]supply.PromoQuote, error) {
	return r.listPromoQuotes(ctx, "agent_id", agentID)
}

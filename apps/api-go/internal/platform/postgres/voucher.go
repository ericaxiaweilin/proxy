package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/voucher"
)

type VoucherRepository struct{ pool *pgxpool.Pool }

func NewVoucherRepository(pool *pgxpool.Pool) *VoucherRepository { return &VoucherRepository{pool: pool} }

func (r *VoucherRepository) ListVouchers(ctx context.Context, actorID string) ([]voucher.Voucher, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT voucher_id, family, display_value, currency, scope_name, scope_detail,
		       valid_from, valid_until, redeem_time_window, minimum_spend, per_person_limit,
		       status, issuer_label, settlement_value, funding_proxy, funding_creator, funding_merchant,
		       reservation_needed, version
		FROM voucher.vouchers WHERE actor_id=$1
		ORDER BY CASE family WHEN 'COFFEE' THEN 1 WHEN 'EXPERIENCE' THEN 2 WHEN 'ACTIVITY' THEN 3 ELSE 4 END, voucher_id`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []voucher.Voucher
	for rows.Next() {
		var v voucher.Voucher
		var fam string
		if err := rows.Scan(&v.ID, &fam, &v.DisplayValue, &v.Currency, &v.ScopeName, &v.ScopeDetail,
			&v.ValidFrom, &v.ValidUntil, &v.RedeemTimeWindow, &v.MinimumSpend, &v.PerPersonLimit,
			&v.Status, &v.IssuerLabel, &v.SettlementValue, &v.Funding.Proxy, &v.Funding.Creator, &v.Funding.Merchant,
			&v.ReservationNeeded, &v.Version); err != nil {
			return nil, err
		}
		v.Family = voucher.Family(fam)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *VoucherRepository) GetVoucher(ctx context.Context, actorID, voucherID string) (*voucher.Voucher, bool, error) {
	var v voucher.Voucher
	var fam string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT voucher_id, family, display_value, currency, scope_name, scope_detail,
		       valid_from, valid_until, redeem_time_window, minimum_spend, per_person_limit,
		       status, issuer_label, settlement_value, funding_proxy, funding_creator, funding_merchant,
		       reservation_needed, version
		FROM voucher.vouchers WHERE actor_id=$1 AND voucher_id=$2`, actorID, voucherID).Scan(
		&v.ID, &fam, &v.DisplayValue, &v.Currency, &v.ScopeName, &v.ScopeDetail,
		&v.ValidFrom, &v.ValidUntil, &v.RedeemTimeWindow, &v.MinimumSpend, &v.PerPersonLimit,
		&v.Status, &v.IssuerLabel, &v.SettlementValue, &v.Funding.Proxy, &v.Funding.Creator, &v.Funding.Merchant,
		&v.ReservationNeeded, &v.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	v.Family = voucher.Family(fam)
	return &v, true, nil
}

func (r *VoucherRepository) UpsertVoucher(ctx context.Context, actorID string, v voucher.Voucher) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO voucher.vouchers (
			actor_id, voucher_id, family, display_value, currency, scope_name, scope_detail,
			valid_from, valid_until, redeem_time_window, minimum_spend, per_person_limit,
			status, issuer_label, settlement_value, funding_proxy, funding_creator, funding_merchant,
			reservation_needed, version
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
		ON CONFLICT (actor_id, voucher_id) DO UPDATE SET
			status=EXCLUDED.status, version=EXCLUDED.version, updated_at=now()`,
		actorID, v.ID, string(v.Family), v.DisplayValue, v.Currency, v.ScopeName, v.ScopeDetail,
		v.ValidFrom, v.ValidUntil, v.RedeemTimeWindow, v.MinimumSpend, v.PerPersonLimit,
		v.Status, v.IssuerLabel, v.SettlementValue, v.Funding.Proxy, v.Funding.Creator, v.Funding.Merchant,
		v.ReservationNeeded, v.Version)
	return err
}

// EnsureDefaults is intentionally a no-op. VOUCHER-DEFAULTS-001
// (2026-09-20): it used to insert 3 free vouchers for every actor on their
// first read, unconditionally — no merchant agreement, no campaign, no
// eligibility check funded that "value." That was the compliance problem
// itself, not a feature; see voucher.Service.ensureDefaults for the full
// rationale. Real issuance now belongs to the benefit package. Existing
// already-issued rows in voucher.vouchers are left untouched — only the
// unconditional future grant is turned off.
func (r *VoucherRepository) EnsureDefaults(_ context.Context, _ string) error {
	return nil
}

func (r *VoucherRepository) ExpireVouchers(ctx context.Context, actorID string, today string) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `UPDATE voucher.vouchers SET status='EXPIRED', version=version+1, updated_at=now() WHERE actor_id=$1 AND status='AVAILABLE' AND valid_until < $2`, actorID, today)
	return err
}

func (r *VoucherRepository) CreateRedemption(ctx context.Context, red voucher.Redemption) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO voucher.redemptions (redemption_id, voucher_id, actor_id, code, expires_at, used)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (redemption_id) DO NOTHING`,
		red.ID, red.VoucherID, red.ActorID, red.Code, red.ExpiresAt, red.Used)
	return err
}

func (r *VoucherRepository) GetRedemption(ctx context.Context, redemptionID string) (*voucher.Redemption, bool, error) {
	var red voucher.Redemption
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT redemption_id, voucher_id, actor_id, code, expires_at, used
		FROM voucher.redemptions WHERE redemption_id=$1`, redemptionID).Scan(
		&red.ID, &red.VoucherID, &red.ActorID, &red.Code, &red.ExpiresAt, &red.Used)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &red, true, nil
}

func (r *VoucherRepository) UpdateRedemption(ctx context.Context, red voucher.Redemption) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE voucher.redemptions SET used=$1 WHERE redemption_id=$2`, red.Used, red.ID)
	return err
}

func (r *VoucherRepository) CreateSettlement(ctx context.Context, s voucher.Settlement) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO voucher.settlements (settlement_id, voucher_id, actor_id, amount, currency, created_at)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (settlement_id) DO NOTHING`,
		s.ID, s.VoucherID, s.ActorID, s.Amount, s.Currency, s.CreatedAt)
	return err
}

// CreateDefinition persists a merchant-issued voucher definition
// (VOUCHER-ISSUE-001). merchant_id is server-verified upstream
// (merchantPublishCommands); the FK to business.accounts is the second lock.
func (r *VoucherRepository) CreateDefinition(ctx context.Context, d voucher.Definition) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO voucher.definitions (
			definition_id, merchant_id, store_id, family, face_value_minor, currency,
			scope_name, valid_from, valid_until, per_person_limit,
			merchant_unit_cost_minor, status, version
		) VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (definition_id) DO NOTHING`,
		d.ID, d.MerchantID, d.StoreID, string(d.Family), d.FaceValueMinor, d.Currency,
		d.ScopeName, d.ValidFrom, d.ValidUntil, d.PerPersonLimit,
		d.MerchantUnitCostMinor, d.Status, d.Version)
	return err
}

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
		FROM voucher.vouchers WHERE actor_id=$1 ORDER BY family, voucher_id`, actorID)
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
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (actor_id, voucher_id) DO UPDATE SET
			status=EXCLUDED.status, version=EXCLUDED.version, updated_at=now()`,
		actorID, v.ID, string(v.Family), v.DisplayValue, v.Currency, v.ScopeName, v.ScopeDetail,
		v.ValidFrom, v.ValidUntil, v.RedeemTimeWindow, v.MinimumSpend, v.PerPersonLimit,
		v.Status, v.IssuerLabel, v.SettlementValue, v.Funding.Proxy, v.Funding.Creator, v.Funding.Merchant,
		v.ReservationNeeded, v.Version)
	return err
}

func (r *VoucherRepository) EnsureDefaults(ctx context.Context, actorID string) error {
	defaults := []voucher.Voucher{
		{ID: "CV2508210001", Family: voucher.Coffee, DisplayValue: 50000, Currency: "VND", ScopeName: "Cafe A", ScopeDetail: "Bắc Ninh", ValidFrom: "2026-08-21", ValidUntil: "2026-08-31", RedeemTimeWindow: "14:00 – 18:00", MinimumSpend: "无", PerPersonLimit: 1, Status: "AVAILABLE", IssuerLabel: "Cafe A", SettlementValue: 30000, Funding: voucher.Funding{Proxy: 10000, Creator: 10000, Merchant: 10000}, Version: 1},
		{ID: "EV2508210001", Family: voucher.Experience, DisplayValue: 299000, Currency: "VND", ScopeName: "Rooftop Photo Walk", ScopeDetail: "Hanoi · 60 min", ValidFrom: "2026-08-21", ValidUntil: "2026-09-15", RedeemTimeWindow: "预约后使用", MinimumSpend: "无", PerPersonLimit: 1, Status: "AVAILABLE", IssuerLabel: "Proxy Experience", SettlementValue: 180000, Funding: voucher.Funding{Proxy: 59000, Creator: 60000, Merchant: 60000}, ReservationNeeded: true, Version: 1},
		{ID: "AV2508210001", Family: voucher.Activity, DisplayValue: 120000, Currency: "VND", ScopeName: "Sunset Yoga", ScopeDetail: "West Lake · Hanoi", ValidFrom: "2026-08-21", ValidUntil: "2026-09-10", RedeemTimeWindow: "活动开始前预约", MinimumSpend: "无", PerPersonLimit: 1, Status: "AVAILABLE", IssuerLabel: "West Lake Studio", SettlementValue: 72000, Funding: voucher.Funding{Proxy: 24000, Creator: 24000, Merchant: 24000}, ReservationNeeded: true, Version: 1},
	}
	for _, v := range defaults {
		if _, err := queryerForContext(ctx, r.pool).Exec(ctx, `
			INSERT INTO voucher.vouchers (
				actor_id, voucher_id, family, display_value, currency, scope_name, scope_detail,
				valid_from, valid_until, redeem_time_window, minimum_spend, per_person_limit,
				status, issuer_label, settlement_value, funding_proxy, funding_creator, funding_merchant,
				reservation_needed, version
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
			ON CONFLICT (actor_id, voucher_id) DO NOTHING`,
			actorID, v.ID, string(v.Family), v.DisplayValue, v.Currency, v.ScopeName, v.ScopeDetail,
			v.ValidFrom, v.ValidUntil, v.RedeemTimeWindow, v.MinimumSpend, v.PerPersonLimit,
			v.Status, v.IssuerLabel, v.SettlementValue, v.Funding.Proxy, v.Funding.Creator, v.Funding.Merchant,
			v.ReservationNeeded, v.Version); err != nil {
			return err
		}
	}
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

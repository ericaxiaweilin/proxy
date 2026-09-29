package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/wallet"
)

// WalletRepository 是 wallet 域的 PG 实现（WALLET-001）。
// 余额一律现场 SUM；扣豆用 advisory 锁保证“读余额-写分录”原子，并发双花会被
// 第二个事务挡在锁外重算（锁内重读），余额不足返回 wallet.ErrInsufficientBeans。
type WalletRepository struct{ pool *pgxpool.Pool }

func NewWalletRepository(pool *pgxpool.Pool) *WalletRepository {
	return &WalletRepository{pool: pool}
}

func (r *WalletRepository) AppendEntries(ctx context.Context, entries []wallet.Entry) error {
	if len(entries) == 0 {
		return nil
	}
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		for _, e := range entries {
			if _, err := tx.Exec(txCtx, `INSERT INTO wallet.entries (id, user_id, currency, delta, reason, ref_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				e.ID, e.UserID, e.Currency, e.Delta, e.Reason, e.RefID, e.CreatedAt); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *WalletRepository) SpendBeansAtomic(ctx context.Context, userID string, costBeans int64, out wallet.Entry, ins []wallet.Entry, vip *wallet.VipGrant) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(txCtx, `SELECT pg_advisory_xact_lock(hashtext($1))`, userID); err != nil {
			return err
		}
		var balance int64
		if err := tx.QueryRow(txCtx, `SELECT COALESCE(SUM(delta),0) FROM wallet.entries WHERE user_id=$1 AND currency='BEAN'`, userID).Scan(&balance); err != nil {
			return err
		}
		if balance < costBeans {
			return wallet.ErrInsufficientBeans
		}
		all := append([]wallet.Entry{out}, ins...)
		for _, e := range all {
			if _, err := tx.Exec(txCtx, `INSERT INTO wallet.entries (id, user_id, currency, delta, reason, ref_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				e.ID, e.UserID, e.Currency, e.Delta, e.Reason, e.RefID, e.CreatedAt); err != nil {
				return err
			}
		}
		if vip != nil {
			if _, err := tx.Exec(txCtx, `INSERT INTO wallet.vip_grants (user_id, granted_at, expires_at) VALUES ($1,$2,$3)
				ON CONFLICT (user_id) DO UPDATE SET granted_at=EXCLUDED.granted_at, expires_at=EXCLUDED.expires_at`,
				vip.UserID, vip.GrantedAt, vip.ExpiresAt); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *WalletRepository) Balances(ctx context.Context, userID string) (map[string]int64, error) {
	out := map[string]int64{wallet.CurrencyDiamond: 0, wallet.CurrencyBean: 0}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT currency, COALESCE(SUM(delta),0) FROM wallet.entries WHERE user_id=$1 GROUP BY currency`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var currency string
		var sum int64
		if err := rows.Scan(&currency, &sum); err != nil {
			return nil, err
		}
		if currency == wallet.CurrencyDiamond || currency == wallet.CurrencyBean {
			out[currency] = sum
		}
	}
	return out, rows.Err()
}

func (r *WalletRepository) ListEntries(ctx context.Context, userID string, limit int) ([]wallet.Entry, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT id, user_id, currency, delta, reason, ref_id, created_at FROM wallet.entries WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []wallet.Entry{}
	for rows.Next() {
		var e wallet.Entry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Currency, &e.Delta, &e.Reason, &e.RefID, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *WalletRepository) GetVipGrant(ctx context.Context, userID string) (*wallet.VipGrant, error) {
	var g wallet.VipGrant
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT user_id, granted_at, expires_at FROM wallet.vip_grants WHERE user_id=$1`, userID).Scan(&g.UserID, &g.GrantedAt, &g.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &g, nil
}

// compile-time: WalletRepository 满足 wallet.Repository。
var _ wallet.Repository = (*WalletRepository)(nil)

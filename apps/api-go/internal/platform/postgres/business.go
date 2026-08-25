package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/business"
)

// BusinessRepository persists merchant accounts, memberships, stores and spend
// projections. Authorization remains in the domain service; repository queries
// are deliberately scoped by business/user identifiers supplied by that layer.
type BusinessRepository struct {
	pool *pgxpool.Pool
}

func NewBusinessRepository(pool *pgxpool.Pool) *BusinessRepository {
	return &BusinessRepository{pool: pool}
}

func (r *BusinessRepository) CreateAccount(ctx context.Context, account business.Account) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, _ pgx.Tx) error {
		if _, err := queryerForContext(txCtx, r.pool).Exec(txCtx, `
			INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
			VALUES ($1,$2,$3,$4,$5)`,
			account.ID, account.OwnerUserID, account.Name, account.Status, account.CreatedAt); err != nil {
			return err
		}
		_, err := queryerForContext(txCtx, r.pool).Exec(txCtx, `
			INSERT INTO business.memberships (business_id, user_id, role, status, created_at)
			VALUES ($1,$2,'OWNER','ACTIVE',$3)`, account.ID, account.OwnerUserID, account.CreatedAt)
		return err
	})
}

func (r *BusinessRepository) GetAccount(ctx context.Context, id string) (business.Account, error) {
	var account business.Account
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, owner_user_id, name, status, created_at
		FROM business.accounts WHERE id=$1`, id).Scan(
		&account.ID, &account.OwnerUserID, &account.Name, &account.Status, &account.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.Account{}, errors.New("account not found")
	}
	return account, err
}

func (r *BusinessRepository) GetMembership(ctx context.Context, businessID, userID string) (business.Membership, error) {
	var membership business.Membership
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT business_id, user_id, role, status, created_at
		FROM business.memberships WHERE business_id=$1 AND user_id=$2`, businessID, userID).Scan(
		&membership.BusinessID, &membership.UserID, &membership.Role, &membership.Status, &membership.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return business.Membership{}, errors.New("membership not found")
	}
	return membership, err
}

func (r *BusinessRepository) ListAccountsForUser(ctx context.Context, userID string) ([]business.Account, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT a.id, a.owner_user_id, a.name, a.status, a.created_at
		FROM business.accounts a
		JOIN business.memberships m ON m.business_id=a.id
		WHERE m.user_id=$1 AND m.status='ACTIVE' AND a.status='ACTIVE'
		ORDER BY a.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.Account{}
	for rows.Next() {
		var account business.Account
		if err := rows.Scan(&account.ID, &account.OwnerUserID, &account.Name, &account.Status, &account.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, account)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) CreateMembership(ctx context.Context, membership business.Membership) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.memberships (business_id, user_id, role, status, created_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (business_id, user_id) DO UPDATE
		SET role=EXCLUDED.role, status=EXCLUDED.status`,
		membership.BusinessID, membership.UserID, membership.Role, membership.Status, membership.CreatedAt)
	return err
}

func (r *BusinessRepository) ListMembers(ctx context.Context, businessID string) ([]business.Membership, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT business_id, user_id, role, status, created_at
		FROM business.memberships WHERE business_id=$1 ORDER BY created_at`, businessID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.Membership{}
	for rows.Next() {
		var membership business.Membership
		if err := rows.Scan(&membership.BusinessID, &membership.UserID, &membership.Role, &membership.Status, &membership.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, membership)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) CreateStore(ctx context.Context, store business.Store) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.stores (id, business_id, name, address, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, store.ID, store.BusinessID, store.Name, store.Address, store.Status, store.CreatedAt)
	return err
}

func (r *BusinessRepository) ListStores(ctx context.Context, businessID string) ([]business.Store, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, business_id, name, address, status, created_at
		FROM business.stores WHERE business_id=$1 ORDER BY created_at`, businessID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []business.Store{}
	for rows.Next() {
		var store business.Store
		if err := rows.Scan(&store.ID, &store.BusinessID, &store.Name, &store.Address, &store.Status, &store.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, store)
	}
	return result, rows.Err()
}

func (r *BusinessRepository) AddSpend(ctx context.Context, businessID, orderID string, amount int64) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO business.spend_records (id, business_id, order_id, amount_minor, currency, created_at)
		VALUES ('spend_' || md5(random()::text || clock_timestamp()::text || $2), $1,$2,$3,'VND',NOW())`, businessID, orderID, amount)
	return err
}

func (r *BusinessRepository) SpendSummary(ctx context.Context, businessID string) (int64, error) {
	var total int64
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor),0) FROM business.spend_records WHERE business_id=$1`, businessID).Scan(&total)
	return total, err
}

var _ business.Repository = (*BusinessRepository)(nil)

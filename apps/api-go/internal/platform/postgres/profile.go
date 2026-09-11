// profile.go — profile.user_profiles 的 PG 持久化（P1，audit 2026-09-04）。

package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/proxy-app/proxy-api/internal/profile"
)

type ProfileRepository struct {
	pool *pgxpool.Pool
}

func NewProfileRepository(pool *pgxpool.Pool) *ProfileRepository {
	return &ProfileRepository{pool: pool}
}

var _ profile.Repository = (*ProfileRepository)(nil)

func (r *ProfileRepository) Upsert(ctx context.Context, p profile.Profile) (profile.Profile, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO profile.user_profiles (user_account_id, name, handle, bio, city, avatar_url, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
		ON CONFLICT (user_account_id) DO UPDATE SET
			name = EXCLUDED.name,
			handle = EXCLUDED.handle,
			bio = EXCLUDED.bio,
			city = EXCLUDED.city,
			avatar_url = EXCLUDED.avatar_url,
			updated_at = EXCLUDED.updated_at
		RETURNING user_account_id, name, handle, bio, city, avatar_url, created_at, updated_at`,
		p.UserAccountID, p.Name, p.Handle, p.Bio, p.City, p.AvatarURL, p.UpdatedAt)
	stored, err := scanProfile(row)
	// 全局唯一 handle：唯一索引冲突 → 业务哨兵（域层映射 PROFILE_HANDLE_TAKEN）
	if isUniqueViolation(err) && isProfileHandleConflict(err) {
		return profile.Profile{}, profile.ErrHandleTaken
	}
	return stored, err
}

// isProfileHandleConflict 判定 23505 是否来自 user_profiles_handle_key
// （而非 user_account_id 主键冲突——后者在 ON CONFLICT 下不会发生）。
func isProfileHandleConflict(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName == "user_profiles_handle_key"
	}
	return false
}

func (r *ProfileRepository) Get(ctx context.Context, userAccountID string) (profile.Profile, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT user_account_id, name, handle, bio, city, avatar_url, created_at, updated_at
		FROM profile.user_profiles WHERE user_account_id = $1`, userAccountID)
	return scanProfile(row)
}

func (r *ProfileRepository) GetByHandle(ctx context.Context, handle string) (profile.Profile, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT user_account_id, name, handle, bio, city, avatar_url, created_at, updated_at
		FROM profile.user_profiles WHERE handle = $1`, handle)
	return scanProfile(row)
}

func scanProfile(row pgx.Row) (profile.Profile, error) {
	var p profile.Profile
	err := row.Scan(&p.UserAccountID, &p.Name, &p.Handle, &p.Bio, &p.City, &p.AvatarURL, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile.Profile{}, profile.ErrProfileNotFound
	}
	return p, err
}

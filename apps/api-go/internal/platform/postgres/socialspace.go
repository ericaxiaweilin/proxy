package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/socialspace"
)

// SocialSpaceRepository stores short-lived status facts and actor-scoped
// community membership. The mobile client only renders these server facts.
type SocialSpaceRepository struct {
	pool *pgxpool.Pool
}

func NewSocialSpaceRepository(pool *pgxpool.Pool) *SocialSpaceRepository {
	return &SocialSpaceRepository{pool: pool}
}

func (r *SocialSpaceRepository) CreateStatus(ctx context.Context, status socialspace.Status) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO socialspace.statuses (
			status_id, author_id, author_display_name, body, location, created_at, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		status.ID, status.AuthorID, status.AuthorDisplayName, status.Body, status.Location, status.CreatedAt, status.ExpiresAt,
	)
	return err
}

func (r *SocialSpaceRepository) ListActiveStatuses(ctx context.Context, now time.Time) ([]socialspace.Status, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT status_id, author_id, author_display_name, body, location, created_at, expires_at
		FROM socialspace.statuses
		WHERE expires_at > $1
		ORDER BY created_at DESC`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []socialspace.Status{}
	for rows.Next() {
		var status socialspace.Status
		if err := rows.Scan(&status.ID, &status.AuthorID, &status.AuthorDisplayName, &status.Body, &status.Location, &status.CreatedAt, &status.ExpiresAt); err != nil {
			return nil, err
		}
		result = append(result, status)
	}
	return result, rows.Err()
}

func (r *SocialSpaceRepository) ListCommunities(ctx context.Context, actorID string) ([]socialspace.Community, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT c.community_id, c.name, c.description, c.members, c.color, c.flair,
		       COALESCE(m.joined, FALSE)
		FROM socialspace.communities c
		LEFT JOIN socialspace.community_memberships m
		  ON m.community_id = c.community_id AND m.actor_id = $1
		ORDER BY c.display_order, c.community_id`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []socialspace.Community{}
	for rows.Next() {
		var community socialspace.Community
		if err := rows.Scan(&community.ID, &community.Name, &community.Desc, &community.Members, &community.Color, &community.Flair, &community.Joined); err != nil {
			return nil, err
		}
		result = append(result, community)
	}
	return result, rows.Err()
}

func (r *SocialSpaceRepository) SetCommunityMembership(ctx context.Context, actorID, communityID string, joined bool, at time.Time) error {
	var exists bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM socialspace.communities WHERE community_id = $1
	)`, communityID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return socialspace.ErrCommunityNotFound
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO socialspace.community_memberships (actor_id, community_id, joined, updated_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (actor_id, community_id)
		DO UPDATE SET joined = EXCLUDED.joined, updated_at = EXCLUDED.updated_at`,
		actorID, communityID, joined, at)
	if errors.Is(err, pgx.ErrNoRows) {
		return socialspace.ErrCommunityNotFound
	}
	return err
}

var _ socialspace.Repository = (*SocialSpaceRepository)(nil)

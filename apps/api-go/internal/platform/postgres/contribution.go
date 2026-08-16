package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/contribution"
)

// ContributionRepository 持久化 NetworkContribution + ReferralInvite。
type ContributionRepository struct {
	pool *pgxpool.Pool
}

func NewContributionRepository(pool *pgxpool.Pool) *ContributionRepository {
	return &ContributionRepository{pool: pool}
}

func (r *ContributionRepository) CreateContribution(ctx context.Context, c contribution.NetworkContribution) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO contribution.contributions (
			contribution_id, contributor_principal_id, contribution_type, campaign_id,
			target_type, target_id, referral_invite_id, attribution_id, state,
			submitted_at, qualified_at, activated_at, value_created_at, rewarded_at,
			reject_reason, review_access, review_domain, review_reward_gate, reward_vnd
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		c.ContributionID, c.ContributorPrincipalID, c.ContributionType, c.CampaignID,
		c.TargetType, c.TargetID, c.ReferralInviteID, c.AttributionID, c.State,
		c.SubmittedAt, c.QualifiedAt, c.ActivatedAt, c.ValueCreatedAt, c.RewardedAt,
		c.RejectReason, c.ReviewAccess, c.ReviewDomain, c.ReviewRewardGate, c.RewardVND,
	)
	return err
}

func (r *ContributionRepository) GetContribution(ctx context.Context, id string) (contribution.NetworkContribution, error) {
	var c contribution.NetworkContribution
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT contribution_id, contributor_principal_id, contribution_type, campaign_id,
			target_type, target_id, referral_invite_id, attribution_id, state,
			submitted_at, qualified_at, activated_at, value_created_at, rewarded_at,
			reject_reason, review_access, review_domain, review_reward_gate, reward_vnd
		FROM contribution.contributions WHERE contribution_id = $1`, id).Scan(
		&c.ContributionID, &c.ContributorPrincipalID, &c.ContributionType, &c.CampaignID,
		&c.TargetType, &c.TargetID, &c.ReferralInviteID, &c.AttributionID, &c.State,
		&c.SubmittedAt, &c.QualifiedAt, &c.ActivatedAt, &c.ValueCreatedAt, &c.RewardedAt,
		&c.RejectReason, &c.ReviewAccess, &c.ReviewDomain, &c.ReviewRewardGate, &c.RewardVND,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return contribution.NetworkContribution{}, contribution.ErrContributionNotFound
	}
	return c, err
}

func (r *ContributionRepository) UpdateContribution(ctx context.Context, c contribution.NetworkContribution, expectedState string) error {
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE contribution.contributions
		SET state=$1, qualified_at=$2, activated_at=$3, value_created_at=$4, rewarded_at=$5,
			reject_reason=$6, review_access=$7, review_domain=$8, review_reward_gate=$9, reward_vnd=$10
		WHERE contribution_id=$11 AND state=$12`,
		c.State, c.QualifiedAt, c.ActivatedAt, c.ValueCreatedAt, c.RewardedAt,
		c.RejectReason, c.ReviewAccess, c.ReviewDomain, c.ReviewRewardGate, c.RewardVND,
		c.ContributionID, expectedState,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return contribution.ErrInvalidState
	}
	return nil
}

func (r *ContributionRepository) CreateInvite(ctx context.Context, i contribution.ReferralInvite) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO contribution.referral_invites (
			referral_invite_id, contributor_principal_id, campaign_id, invite_code,
			contribution_type, created_at, expires_at, state
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		i.ReferralInviteID, i.ContributorPrincipalID, i.CampaignID, i.InviteCode,
		i.ContributionType, i.CreatedAt, i.ExpiresAt, i.State,
	)
	return err
}

func (r *ContributionRepository) GetInvite(ctx context.Context, id string) (contribution.ReferralInvite, error) {
	var i contribution.ReferralInvite
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT referral_invite_id, contributor_principal_id, campaign_id, invite_code,
			contribution_type, created_at, expires_at, state
		FROM contribution.referral_invites WHERE referral_invite_id = $1`, id).Scan(
		&i.ReferralInviteID, &i.ContributorPrincipalID, &i.CampaignID, &i.InviteCode,
		&i.ContributionType, &i.CreatedAt, &i.ExpiresAt, &i.State,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return contribution.ReferralInvite{}, contribution.ErrInviteNotFound
	}
	return i, err
}

func (r *ContributionRepository) UpdateInviteState(ctx context.Context, id, state string) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE contribution.referral_invites SET state=$1 WHERE referral_invite_id=$2`, state, id)
	return err
}

func (r *ContributionRepository) FindByTarget(ctx context.Context, contributionType, targetType, targetID string) (contribution.NetworkContribution, error) {
	var c contribution.NetworkContribution
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT contribution_id, contributor_principal_id, contribution_type, campaign_id,
			target_type, target_id, referral_invite_id, attribution_id, state,
			submitted_at, qualified_at, activated_at, value_created_at, rewarded_at,
			reject_reason, review_access, review_domain, review_reward_gate, reward_vnd
		FROM contribution.contributions
		WHERE contribution_type=$1 AND target_type=$2 AND target_id=$3`, contributionType, targetType, targetID).Scan(
		&c.ContributionID, &c.ContributorPrincipalID, &c.ContributionType, &c.CampaignID,
		&c.TargetType, &c.TargetID, &c.ReferralInviteID, &c.AttributionID, &c.State,
		&c.SubmittedAt, &c.QualifiedAt, &c.ActivatedAt, &c.ValueCreatedAt, &c.RewardedAt,
		&c.RejectReason, &c.ReviewAccess, &c.ReviewDomain, &c.ReviewRewardGate, &c.RewardVND,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return contribution.NetworkContribution{}, contribution.ErrContributionNotFound
	}
	return c, err
}

func (r *ContributionRepository) ContributionsBy(ctx context.Context, contributorID string) ([]contribution.NetworkContribution, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT contribution_id, contributor_principal_id, contribution_type, campaign_id,
			target_type, target_id, referral_invite_id, attribution_id, state,
			submitted_at, qualified_at, activated_at, value_created_at, rewarded_at,
			reject_reason, review_access, review_domain, review_reward_gate, reward_vnd
		FROM contribution.contributions WHERE contributor_principal_id=$1 ORDER BY submitted_at DESC`, contributorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanContributions(rows)
}

func (r *ContributionRepository) InvitesBy(ctx context.Context, contributorID string) ([]contribution.ReferralInvite, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT referral_invite_id, contributor_principal_id, campaign_id, invite_code,
			contribution_type, created_at, expires_at, state
		FROM contribution.referral_invites WHERE contributor_principal_id=$1`, contributorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []contribution.ReferralInvite{}
	for rows.Next() {
		var i contribution.ReferralInvite
		if err := rows.Scan(&i.ReferralInviteID, &i.ContributorPrincipalID, &i.CampaignID, &i.InviteCode,
			&i.ContributionType, &i.CreatedAt, &i.ExpiresAt, &i.State); err != nil {
			return nil, err
		}
		result = append(result, i)
	}
	return result, rows.Err()
}

func (r *ContributionRepository) Snapshot(ctx context.Context) ([]contribution.NetworkContribution, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT contribution_id, contributor_principal_id, contribution_type, campaign_id,
			target_type, target_id, referral_invite_id, attribution_id, state,
			submitted_at, qualified_at, activated_at, value_created_at, rewarded_at,
			reject_reason, review_access, review_domain, review_reward_gate, reward_vnd
		FROM contribution.contributions ORDER BY submitted_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanContributions(rows)
}

func scanContributions(rows pgx.Rows) ([]contribution.NetworkContribution, error) {
	result := []contribution.NetworkContribution{}
	for rows.Next() {
		var c contribution.NetworkContribution
		if err := rows.Scan(
			&c.ContributionID, &c.ContributorPrincipalID, &c.ContributionType, &c.CampaignID,
			&c.TargetType, &c.TargetID, &c.ReferralInviteID, &c.AttributionID, &c.State,
			&c.SubmittedAt, &c.QualifiedAt, &c.ActivatedAt, &c.ValueCreatedAt, &c.RewardedAt,
			&c.RejectReason, &c.ReviewAccess, &c.ReviewDomain, &c.ReviewRewardGate, &c.RewardVND,
		); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

var _ contribution.Repository = (*ContributionRepository)(nil)

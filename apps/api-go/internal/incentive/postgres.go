package incentive

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

const ruleCols = `id, label, trigger, reward_kind, campaign_id, benefit_id, points, min_account_age_hours, active, created_by, created_at, updated_at`

func scanRule(row interface{ Scan(...any) error }) (Rule, error) {
	var r Rule
	err := row.Scan(&r.ID, &r.Label, &r.Trigger, &r.RewardKind, &r.CampaignID, &r.BenefitID, &r.Points, &r.MinAccountAgeHours, &r.Active, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt)
	return r, err
}

func (p *Postgres) ListRules(ctx context.Context) ([]Rule, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+ruleCols+` FROM incentive.rules ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Rule{}
	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpsertRule：新建，或改一条**还没生效**的规则（生效中的规则不许改内容，先关再改——否则一次手滑就改变了正在发的奖励）。
func (p *Postgres) UpsertRule(ctx context.Context, r Rule) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO incentive.rules (`+ruleCols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$10)
		ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, trigger=EXCLUDED.trigger, reward_kind=EXCLUDED.reward_kind,
		  campaign_id=EXCLUDED.campaign_id, benefit_id=EXCLUDED.benefit_id, points=EXCLUDED.points,
		  min_account_age_hours=EXCLUDED.min_account_age_hours, updated_at=EXCLUDED.updated_at
		WHERE incentive.rules.active = false`,
		r.ID, r.Label, r.Trigger, r.RewardKind, r.CampaignID, r.BenefitID, r.Points, r.MinAccountAgeHours, r.CreatedBy, r.CreatedAt.UTC())
	return err
}

func (p *Postgres) SetActive(ctx context.Context, id string, active bool, now time.Time) (bool, error) {
	tag, err := p.pool.Exec(ctx, `UPDATE incentive.rules SET active = $2, updated_at = $3 WHERE id = $1`, id, active, now.UTC())
	return tag.RowsAffected() == 1, err
}

// Candidates：成就时间在规则创建之后（不追溯发放历史用户，免得预算被一次性吃光）、账号正常且够老、资料完善。
func (p *Postgres) Candidates(ctx context.Context, r Rule, now time.Time, limit int) ([]string, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var achieved string
	switch r.Trigger {
	case TriggerFirstPost:
		achieved = `(SELECT MIN(created_at) FROM localnet.posts WHERE author_id = u.id AND author_type = 'USER' AND status = 'PUBLISHED')`
	case TriggerFirstDemand:
		achieved = `LEAST((SELECT MIN(created_at) FROM marketplace.opportunities WHERE owner_id = u.id), (SELECT MIN(created_at) FROM fulfillment.orders WHERE requester_id = u.id))`
	case TriggerFirstActivity:
		achieved = `(SELECT MIN(joined_at) FROM activity.participants WHERE actor_id = u.id)`
	default:
		return nil, ErrBadTrigger
	}
	rows, err := p.pool.Query(ctx, `
		SELECT u.id FROM identity.user_accounts u
		 WHERE u.status = 'ACTIVE'
		   AND u.created_at <= $1::timestamptz - make_interval(hours => $2)
		   AND EXISTS (SELECT 1 FROM identity.profiles pr WHERE pr.user_account_id = u.id AND btrim(pr.name) <> '' AND pr.avatar_path <> '')
		   AND `+achieved+` >= $3
		   AND NOT EXISTS (SELECT 1 FROM incentive.grants g WHERE g.rule_id = $4 AND g.user_id = u.id)
		 ORDER BY `+achieved+` LIMIT $5`, now.UTC(), r.MinAccountAgeHours, r.CreatedAt.UTC(), r.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (p *Postgres) RecordGrant(ctx context.Context, g Grant) (bool, error) {
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO incentive.grants (id, rule_id, user_id, reward_kind, claim_id, points, status, error, granted_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (rule_id, user_id) DO NOTHING`,
		g.ID, g.RuleID, g.UserID, g.RewardKind, g.ClaimID, g.Points, g.Status, g.Error, g.GrantedAt.UTC())
	return tag.RowsAffected() == 1, err
}

func (p *Postgres) GrantsOf(ctx context.Context, userID string) ([]Grant, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id, rule_id, reward_kind, claim_id, points, status, error, granted_at FROM incentive.grants
		 WHERE user_id = $1 AND status = 'GRANTED' ORDER BY granted_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Grant{}
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.ID, &g.RuleID, &g.RewardKind, &g.ClaimID, &g.Points, &g.Status, &g.Error, &g.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (p *Postgres) Stats(ctx context.Context) ([]RuleStat, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT rule_id, COUNT(*) FILTER (WHERE status = 'GRANTED'), COUNT(*) FILTER (WHERE status = 'FAILED'),
		       COALESCE(SUM(points) FILTER (WHERE status = 'GRANTED'), 0)
		  FROM incentive.grants GROUP BY rule_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RuleStat{}
	for rows.Next() {
		var s RuleStat
		if err := rows.Scan(&s.RuleID, &s.Granted, &s.Failed, &s.Points); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

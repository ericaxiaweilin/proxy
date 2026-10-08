package incentive

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

const ruleCols = `id, label, trigger, reward_kind, campaign_id, benefit_id, points, min_account_age_hours, active, created_by, created_at, updated_at, audience, starts_at, ends_at, min_points`

func scanRule(row interface{ Scan(...any) error }) (Rule, error) {
	var r Rule
	err := row.Scan(&r.ID, &r.Label, &r.Trigger, &r.RewardKind, &r.CampaignID, &r.BenefitID, &r.Points, &r.MinAccountAgeHours, &r.Active, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt, &r.Audience, &r.StartsAt, &r.EndsAt, &r.MinPoints)
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
		INSERT INTO incentive.rules (`+ruleCols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$10,$11,$12,$13,$14)
		ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, trigger=EXCLUDED.trigger, reward_kind=EXCLUDED.reward_kind,
		  campaign_id=EXCLUDED.campaign_id, benefit_id=EXCLUDED.benefit_id, points=EXCLUDED.points,
		  min_account_age_hours=EXCLUDED.min_account_age_hours, updated_at=EXCLUDED.updated_at,
		  audience=EXCLUDED.audience, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, min_points=EXCLUDED.min_points
		WHERE incentive.rules.active = false`,
		r.ID, r.Label, r.Trigger, r.RewardKind, r.CampaignID, r.BenefitID, r.Points, r.MinAccountAgeHours, r.CreatedBy, r.CreatedAt.UTC(),
		orUser(r.Audience), r.StartsAt, r.EndsAt, r.MinPoints)
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
	case TriggerScoreReached:
		return p.scoreCandidates(ctx, r, now, limit)
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

func orUser(a string) string {
	if a == "" {
		return "USER"
	}
	return a
}

// scoreCandidates：积分（该身份的账本求和）达到门槛、账号正常且够老、资料完善、还没领过这条的人。
// 不看「规则创建之后」——按分数开的活动，到了分数线就是资格；时间窗口由 RunGrants 把关。
func (p *Postgres) scoreCandidates(ctx context.Context, r Rule, now time.Time, limit int) ([]string, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT u.id FROM identity.user_accounts u
		 WHERE u.status = 'ACTIVE'
		   AND u.created_at <= $1::timestamptz - make_interval(hours => $2)
		   AND EXISTS (SELECT 1 FROM identity.profiles pr WHERE pr.user_account_id = u.id AND btrim(pr.name) <> '' AND pr.avatar_path <> '')
		   AND (SELECT COALESCE(SUM(delta), 0) FROM growth.point_ledger l WHERE l.subject_kind = $3 AND l.subject_id = u.id) >= $4
		   AND NOT EXISTS (SELECT 1 FROM incentive.grants g WHERE g.rule_id = $5 AND g.user_id = u.id)
		 ORDER BY u.created_at LIMIT $6`, now.UTC(), r.MinAccountAgeHours, orUser(r.Audience), r.MinPoints, r.ID, limit)
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

// RecordGrant：发放记录；成长值奖励同一个事务里记进积分账本（身份等级由积分算）。(rule,user) 已存在 = 幂等不重复。
func (p *Postgres) RecordGrant(ctx context.Context, g Grant) (bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, err := tx.Exec(ctx, `
		INSERT INTO incentive.grants (id, rule_id, user_id, reward_kind, claim_id, points, status, error, granted_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (rule_id, user_id) DO NOTHING`,
		g.ID, g.RuleID, g.UserID, g.RewardKind, g.ClaimID, g.Points, g.Status, g.Error, g.GrantedAt.UTC())
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 1 && g.Status == StatusGranted && g.RewardKind == RewardGrowthPoints && g.Points > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO growth.point_ledger (id, subject_kind, subject_id, delta, reason, ref, created_at)
			VALUES ('pl_' || md5($1 || '|' || $2 || '|CAMPAIGN|' || $4), $1, $2, $3, 'CAMPAIGN', $4, $5)
			ON CONFLICT (subject_kind, subject_id, reason, ref) DO NOTHING`, orUser(g.Audience), g.UserID, g.Points, g.RuleID, g.GrantedAt.UTC()); err != nil {
			return false, err
		}
	}
	return tag.RowsAffected() == 1, tx.Commit(ctx)
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

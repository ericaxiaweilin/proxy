package tagging

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/proxy-app/proxy-api/internal/consent"
)

// Postgres 是标签层的库实现。
type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// 被动行为事件（要同意）。AGENT_SHORTLISTED 是用户自己存候选人的主动动作，不在这里。
const behaviouralTypes = `('POST_IMPRESSION','MEDIA_IMPRESSION','MEDIA_ZOOM','PROFILE_OPEN','CANDIDATE_VIEWED','ACTIVITY_VIEW')`

// vnTZ：节律与「哪一天」都按越南时间算。
const vnTZ = `'Asia/Ho_Chi_Minh'`

func (p *Postgres) LoadEvidence(ctx context.Context, since time.Time) (map[string]Evidence, error) {
	out := map[string]Evidence{}
	get := func(id string) Evidence {
		ev, ok := out[id]
		if !ok {
			ev = Evidence{UserID: id, Scenes: map[string]SceneEvidence{}, Activities: map[string]ActivityEvidence{}, Cities: map[string]int{}, Cells: map[string]CellEvidence{}}
		}
		return ev
	}
	// 所有被动证据都过同一条同意规则：事件那一刻、对该用途的同意有效，并且用户现在没撤回。
	valid := consent.ValidAtSQL("e.actor_id", "e.created_at", consent.Recommendation)

	// 1) 场景：帖子曝光的停留。watch_ms = 0 表示客户端没报停留，不是「划走」，不参与。
	rows, err := p.pool.Query(ctx, `
		SELECT e.actor_id, p.scene_type, COUNT(*), COALESCE(SUM(e.watch_ms), 0),
		       COUNT(*) FILTER (WHERE e.watch_ms < $2), MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		JOIN localnet.posts p ON p.id = e.target_id
		WHERE e.event_type = 'POST_IMPRESSION' AND e.target_type = 'POST'
		  AND e.created_at >= $1 AND e.watch_ms > 0
		  AND p.scene_type NOT IN ('UNKNOWN', '')
		  AND `+valid+`
		GROUP BY e.actor_id, p.scene_type`, since, QuickSkipMs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, scene string
		var s SceneEvidence
		if err := rows.Scan(&id, &scene, &s.Events, &s.DwellMs, &s.QuickSkips, &s.First, &s.Last); err != nil {
			rows.Close()
			return nil, err
		}
		ev := get(id)
		ev.Scenes[scene] = s
		out[id] = ev
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 2) 活动：看活动页的停留（被动，要同意）。
	rows, err = p.pool.Query(ctx, `
		SELECT e.actor_id, COALESCE(a.payload->>'category', ''), COUNT(*), COALESCE(SUM(e.watch_ms), 0), MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		JOIN activity.activities a ON a.id = e.target_id
		WHERE e.event_type = 'ACTIVITY_VIEW' AND e.target_type = 'ACTIVITY'
		  AND e.created_at >= $1 AND `+valid+`
		GROUP BY e.actor_id, 2`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, category string
		var a ActivityEvidence
		if err := rows.Scan(&id, &category, &a.Views, &a.DwellMs, &a.First, &a.Last); err != nil {
			rows.Close()
			return nil, err
		}
		if category == "" {
			continue
		}
		ev := get(id)
		ev.Activities[category] = a
		out[id] = ev
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 3) 活动：用户自己点的「感兴趣 / 报名」（主动，不依赖浏览同意）。
	for _, q := range []struct {
		sql  string
		join bool
	}{
		{`SELECT i.actor_id, COALESCE(a.payload->>'category', ''), COUNT(*), MIN(i.created_at), MAX(i.created_at)
		  FROM activity.interests i JOIN activity.activities a ON a.id = i.activity_id
		  WHERE i.created_at >= $1 GROUP BY i.actor_id, 2`, false},
		{`SELECT pt.actor_id, COALESCE(a.payload->>'category', ''), COUNT(*), MIN(pt.joined_at), MAX(pt.joined_at)
		  FROM activity.participants pt JOIN activity.activities a ON a.id = pt.activity_id
		  WHERE pt.joined_at >= $1 GROUP BY pt.actor_id, 2`, true},
	} {
		rows, err = p.pool.Query(ctx, q.sql, since)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, category string
			var n int
			var first, last time.Time
			if err := rows.Scan(&id, &category, &n, &first, &last); err != nil {
				rows.Close()
				return nil, err
			}
			if category == "" {
				continue
			}
			ev := get(id)
			a := ev.Activities[category]
			if q.join {
				a.Joined += n
			} else {
				a.Interested += n
			}
			if a.First.IsZero() || first.Before(a.First) {
				a.First = first
			}
			if last.After(a.Last) {
				a.Last = last
			}
			ev.Activities[category] = a
			out[id] = ev
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// 4) 节律与城市：任何被动行为事件都算一次「她在这个时段活跃」。
	rows, err = p.pool.Query(ctx, `
		SELECT e.actor_id,
		       EXTRACT(DOW FROM e.created_at AT TIME ZONE `+vnTZ+`)::int * 24 + EXTRACT(HOUR FROM e.created_at AT TIME ZONE `+vnTZ+`)::int,
		       e.city, COUNT(*)
		FROM localnet.interaction_events e
		WHERE e.event_type IN `+behaviouralTypes+` AND e.created_at >= $1 AND `+valid+`
		GROUP BY 1, 2, 3`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, city string
		var slot, n int
		if err := rows.Scan(&id, &slot, &city, &n); err != nil {
			rows.Close()
			return nil, err
		}
		ev := get(id)
		if slot >= 0 && slot < len(ev.HourCounts) {
			ev.HourCounts[slot] += n
		}
		if city != "" {
			ev.Cities[city] += n
		}
		out[id] = ev
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 5) 粗粒度位置：采集目的同意有效 **并且** 定位同意（大致区域 / 精确）现在还在。
	locValid := consent.ValidAtSQL("l.user_id", "l.observed_at", consent.Recommendation)
	rows, err = p.pool.Query(ctx, `
		SELECT l.user_id, l.cell, COUNT(DISTINCT (l.observed_at AT TIME ZONE `+vnTZ+`)::date), MIN(l.observed_at), MAX(l.observed_at)
		FROM tag.coarse_locations l
		WHERE l.observed_at >= $1 AND `+locValid+`
		  AND EXISTS (SELECT 1 FROM location.location_consents c
		              WHERE c.user_id = l.user_id AND c.status = 'GRANTED' AND c.expires_at > now())
		GROUP BY l.user_id, l.cell`, since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, cell string
		var c CellEvidence
		if err := rows.Scan(&id, &cell, &c.Days, &c.First, &c.Last); err != nil {
			rows.Close()
			return nil, err
		}
		ev := get(id)
		ev.Cells[cell] = c
		out[id] = ev
	}
	rows.Close()
	return out, rows.Err()
}

func (p *Postgres) UsersWithTags(ctx context.Context) ([]string, error) {
	rows, err := p.pool.Query(ctx, `SELECT DISTINCT user_id FROM tag.user_tags`)
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

func (p *Postgres) ReplaceUserTags(ctx context.Context, userID string, tags []Tag) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `DELETE FROM tag.user_tags WHERE user_id = $1`, userID); err != nil {
		return err
	}
	for _, t := range tags {
		if _, err := tx.Exec(ctx, `
			INSERT INTO tag.user_tags(user_id, axis, value, strength, confidence, source, evidence_count, source_diversity,
			                          first_seen, last_seen, expires_at, computed_at, rule_version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			userID, t.Axis, t.Value, t.Strength, t.Confidence, t.Source, t.EvidenceCount, t.SourceDiversity,
			t.FirstSeen, t.LastSeen, t.ExpiresAt, t.ComputedAt, t.RuleVersion); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (p *Postgres) TagsOf(ctx context.Context, userID string) ([]Tag, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT axis, value, strength, confidence, source, evidence_count, source_diversity, first_seen, last_seen, expires_at, computed_at, rule_version
		FROM tag.user_tags WHERE user_id = $1 ORDER BY axis, value`, userID)
	if err != nil {
		return nil, err
	}
	return collectTags(rows, userID)
}

func collectTags(rows pgx.Rows, userID string) ([]Tag, error) {
	defer rows.Close()
	out := []Tag{}
	for rows.Next() {
		t := Tag{UserID: userID}
		if err := rows.Scan(&t.Axis, &t.Value, &t.Strength, &t.Confidence, &t.Source, &t.EvidenceCount, &t.SourceDiversity, &t.FirstSeen, &t.LastSeen, &t.ExpiresAt, &t.ComputedAt, &t.RuleVersion); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RecordCoarseCell 存一个粗粒度位置观测。调用方已经取整并验证了同意；这里只管写。
func (p *Postgres) RecordCoarseCell(ctx context.Context, userID, cell string, at time.Time) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO tag.coarse_locations(user_id, cell, observed_at) VALUES ($1,$2,$3)`, userID, cell, at.UTC())
	return err
}

// HasConsent 报告某个用户「现在」对某个用途的同意是否有效（读不出来返回 err，调用方 fail-closed）。
func (p *Postgres) HasConsent(ctx context.Context, userID, purpose string) (bool, error) {
	var ok bool
	err := p.pool.QueryRow(ctx, `SELECT COALESCE(`+consent.ValidAtSQL("$1::text", "now()", purpose)+`, false)`, userID).Scan(&ok)
	return ok, err
}

// HasLocationConsent：定位同意（大致区域 / 精确）现在是否有效。
func (p *Postgres) HasLocationConsent(ctx context.Context, userID string) (bool, error) {
	var ok bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM location.location_consents WHERE user_id = $1 AND status = 'GRANTED' AND expires_at > now())`, userID).Scan(&ok)
	return ok, err
}

// Stats 读整张 user_tags 做统计（运营页用，量级是人数 × 轴，不大）。
func (p *Postgres) Stats(ctx context.Context, now time.Time) (Stats, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, axis, value, strength, confidence, source, evidence_count, source_diversity, first_seen, last_seen, expires_at, computed_at, rule_version
		FROM tag.user_tags WHERE expires_at > $1`, now)
	if err != nil {
		return Stats{}, err
	}
	defer rows.Close()
	byUser := map[string][]Tag{}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.UserID, &t.Axis, &t.Value, &t.Strength, &t.Confidence, &t.Source, &t.EvidenceCount, &t.SourceDiversity, &t.FirstSeen, &t.LastSeen, &t.ExpiresAt, &t.ComputedAt, &t.RuleVersion); err != nil {
			return Stats{}, err
		}
		byUser[t.UserID] = append(byUser[t.UserID], t)
	}
	if err := rows.Err(); err != nil {
		return Stats{}, err
	}
	return ComputeStats(byUser, now), nil
}

// PruneOlderThan 删掉窗口外的粗粒度位置观测：窗口外的事实不参与任何标签，留着只是多留一份位置痕迹。
func (p *Postgres) PruneOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := p.pool.Exec(ctx, `DELETE FROM tag.coarse_locations WHERE observed_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

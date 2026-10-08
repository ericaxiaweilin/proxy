package tagging

import (
	"context"
	"strings"
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
			ev = Evidence{UserID: id, TopicViews: map[string]TopicEvidence{}, Activities: map[string]ActivityEvidence{}, Cities: map[string]int{}, Cells: map[string]CellEvidence{}}
		}
		return ev
	}
	// 所有被动证据都过同一条同意规则：事件那一刻、对该用途的同意有效，并且用户现在没撤回。
	valid := consent.ValidAtSQL("e.actor_id", "e.created_at", consent.Recommendation)

	// 1) 内容主题：帖子曝光的停留，按**正文里的主题**归（帖文没有「场景类型」这种分类）。
	//    watch_ms = 0 表示客户端没报停留，不是「划走」，不参与。只用来判断「回避」
	//    （看了很多次、几乎都一眼划走）；兴趣由 2b 的亲和路径出。
	rows, err := p.pool.Query(ctx, `
		SELECT e.actor_id, p.body, COUNT(*), COALESCE(SUM(e.watch_ms), 0),
		       COUNT(*) FILTER (WHERE e.watch_ms < $2), MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		JOIN localnet.posts p ON p.id = e.target_id
		WHERE e.event_type = 'POST_IMPRESSION' AND e.target_type = 'POST'
		  AND e.created_at >= $1 AND e.watch_ms > 0 AND p.body <> ''
		  AND `+valid+`
		GROUP BY e.actor_id, p.id, p.body`, since, QuickSkipMs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, body string
		var s TopicEvidence
		if err := rows.Scan(&id, &body, &s.Events, &s.DwellMs, &s.QuickSkips, &s.First, &s.Last); err != nil {
			rows.Close()
			return nil, err
		}
		ev := get(id)
		for _, hit := range TopicHits(body) {
			if hit.Factor < 0.5 {
				continue // 回避只看叶子和它的父类，更粗的类目太泛，不拿来判「不喜欢」
			}
			topic := hit.Value
			prev := ev.TopicViews[topic]
			prev.Events += s.Events
			prev.DwellMs += s.DwellMs
			prev.QuickSkips += s.QuickSkips
			if prev.First.IsZero() || s.First.Before(prev.First) {
				prev.First = s.First
			}
			if s.Last.After(prev.Last) {
				prev.Last = s.Last
			}
			ev.TopicViews[topic] = prev
		}
		out[id] = ev
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 2) 活动：看活动页的停留（被动，要同意）。
	rows, err = p.pool.Query(ctx, `
		SELECT e.actor_id, COALESCE(a.payload->>'category', ''), COUNT(*), COALESCE(SUM(`+dwellCreditSQL(DwellActivity, "e.watch_ms")+`), 0)::float8, MIN(e.created_at), MAX(e.created_at)
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
		if err := rows.Scan(&id, &category, &a.Views, &a.DwellCredit, &a.First, &a.Last); err != nil {
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := p.loadSignals(ctx, since, valid, get, out); err != nil {
		return nil, err
	}
	return out, nil
}

// splitVenueType 把场景的自由文本类型（"咖啡 · 店招"）拆成「类型」和「风格」两个取值。
// 没有「·」就只有类型，没有风格——不编。
func splitVenueType(t string) (kind, style string) {
	parts := strings.SplitN(t, "·", 2)
	kind = strings.TrimSpace(parts[0])
	if len(parts) == 2 {
		style = strings.TrimSpace(parts[1])
	}
	return kind, style
}

// loadSignals：细粒度亲和信号（TAG-SYSTEM-002）。每个抽取只回答一个问题，加一个轴 = 加一段抽取。
func (p *Postgres) loadSignals(ctx context.Context, since time.Time, valid string, get func(string) Evidence, out map[string]Evidence) error {
	push := func(user string, sg Signal) {
		ev := get(user)
		ev.Signals = append(ev.Signals, sg)
		out[user] = ev
	}

	// 1) 显式场所行为：收藏 / 计划去 / 去过 / 打卡。用户自己做的事，不需要浏览同意。
	//    一条行为同时贡献四个轴：这家店本身、它的类型、它的风格、它所在的区——越细越好。
	rows, err := p.pool.Query(ctx, `
		SELECT x.actor_id, sc.id, sc.type, sc.area, x.w::float8, x.first_at, x.last_at
		FROM (
			SELECT actor_id, scene_id,
			       (CASE WHEN saved THEN 1.0 ELSE 0 END + CASE WHEN planned THEN 1.5 ELSE 0 END + CASE WHEN visited_at IS NOT NULL THEN 2.0 ELSE 0 END) AS w,
			       created_at AS first_at, updated_at AS last_at
			  FROM reality.user_scene_states WHERE updated_at >= $1
			UNION ALL
			SELECT actor_id, scene_id, 2.0, declared_at, declared_at FROM reality.scene_checkins WHERE declared_at >= $1
		) x
		JOIN reality.scenes sc ON sc.id = x.scene_id AND sc.status = 'ACTIVE'
		WHERE x.w > 0`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, id, typ, area string
		var w float64
		var first, last time.Time
		if err := rows.Scan(&user, &id, &typ, &area, &w, &first, &last); err != nil {
			rows.Close()
			return err
		}
		kind, style := splitVenueType(typ)
		for _, sg := range []Signal{
			{Axis: AxisVenueFavorite, Value: id},
			{Axis: AxisVenueKind, Value: kind},
			{Axis: AxisVenueStyle, Value: style},
			{Axis: AxisDistrict, Value: area},
		} {
			if strings.TrimSpace(sg.Value) == "" {
				continue
			}
			sg.Weight, sg.N, sg.First, sg.Last, sg.Explicit = w, 1, first, last, true
			push(user, sg)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// 2) 创作者偏好：**只认主动点进主页**（每次 0.5 点，被动，过同意）。信息流里看某个人的帖子停得久，
	//    不再给创作者加分——看人久不等于想约她（TAG-DWELL-001：人物的被动停留不进口味类标签）。
	rows, err = p.pool.Query(ctx, `
		SELECT e.actor_id, e.target_id, COUNT(*), COUNT(*) * 0.5, MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		WHERE e.event_type = 'PROFILE_OPEN' AND e.target_type = 'PROFILE'
		  AND e.created_at >= $1 AND e.target_id <> e.actor_id
		  AND `+valid+`
		GROUP BY e.actor_id, e.target_id`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, author string
		var n int
		var w float64
		var first, last time.Time
		if err := rows.Scan(&user, &author, &n, &w, &first, &last); err != nil {
			rows.Close()
			return err
		}
		push(user, Signal{Axis: AxisCreatorAffinity, Value: author, Weight: w, N: n, First: first, Last: last})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// 2b) 内容话题：看过的帖子（被动，过同意）+ 自己发的帖子（主动）。正文在 Go 里抽话题。
	rows, err = p.pool.Query(ctx, `
		SELECT e.actor_id, p.body, COUNT(*), COALESCE(SUM(`+dwellCreditSQL(DwellPost, "e.watch_ms")+`), 0)::float8, MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		JOIN localnet.posts p ON p.id = e.target_id
		WHERE e.event_type = 'POST_IMPRESSION' AND e.target_type = 'POST'
		  AND e.created_at >= $1 AND e.watch_ms > 0 AND p.body <> ''
		  AND `+valid+`
		GROUP BY e.actor_id, p.id, p.body`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, body string
		var n int
		var w float64
		var first, last time.Time
		if err := rows.Scan(&user, &body, &n, &w, &first, &last); err != nil {
			rows.Close()
			return err
		}
		for _, hit := range TopicHits(body) {
			push(user, Signal{Axis: AxisInterestTopic, Value: hit.Value, Weight: w * hit.Factor, N: 1, First: first, Last: last})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = p.pool.Query(ctx, `
		SELECT author_id, body, created_at FROM localnet.posts
		WHERE author_type = 'USER' AND status = 'PUBLISHED' AND created_at >= $1 AND body <> ''`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, body string
		var at time.Time
		if err := rows.Scan(&user, &body, &at); err != nil {
			rows.Close()
			return err
		}
		for _, hit := range TopicHits(body) {
			push(user, Signal{Axis: AxisInterestTopic, Value: hit.Value, Weight: 1.5 * hit.Factor, N: 1, First: at, Last: at, Explicit: true})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// 2c) 交易侧：自己下过的单（需求方）与完成过的单（服务方）。交易事实，不需要浏览同意；窗口放宽到 90 天。
	orderSince := since.Add(-62 * 24 * time.Hour)
	rows, err = p.pool.Query(ctx, `
		SELECT o.requester_id, COALESCE(o.snapshot->>'serviceSku',''), COALESCE((NULLIF(o.snapshot->>'agreedCompensation',''))::bigint, 0),
		       COALESCE(o.snapshot->>'scenario',''), COALESCE(o.snapshot->>'startTime',''), o.created_at
		FROM fulfillment.orders o WHERE o.lifecycle <> 'CANCELLED' AND o.created_at >= $1`, orderSince)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, sku, scenario, start string
		var amount int64
		var at time.Time
		if err := rows.Scan(&user, &sku, &amount, &scenario, &start, &at); err != nil {
			rows.Close()
			return err
		}
		for _, sg := range []Signal{
			{Axis: AxisOrderService, Value: sku},
			{Axis: AxisPriceBand, Value: PriceBandOf(amount)},
			{Axis: AxisOrderScenario, Value: scenario},
			{Axis: AxisTimeSlot, Value: TimeSlotOf(start)},
		} {
			if sg.Value == "" {
				continue
			}
			sg.Weight, sg.N, sg.First, sg.Last, sg.Explicit = 1, 1, at, at, true
			push(user, sg)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = p.pool.Query(ctx, `
		SELECT COALESCE(ap.user_account_id, o.agent_id), COALESCE(o.snapshot->>'serviceSku',''), o.updated_at
		FROM fulfillment.orders o LEFT JOIN supply.agent_profiles ap ON ap.agent_id = o.agent_id
		WHERE o.lifecycle = 'COMPLETED' AND o.updated_at >= $1 AND COALESCE(o.snapshot->>'serviceSku','') <> ''`, orderSince)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, sku string
		var at time.Time
		if err := rows.Scan(&user, &sku, &at); err != nil {
			rows.Close()
			return err
		}
		push(user, Signal{Axis: AxisExpertiseService, Value: sku, Weight: 1, N: 1, First: at, Last: at, Explicit: true})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// 2d) 其余行为源（架构文档 §3）：互动 / 活动 / 市场需求的主题。
	if err := p.loadInteractionTopics(ctx, since, push); err != nil {
		return err
	}
	if err := p.loadActivityTopics(ctx, since, valid, push); err != nil {
		return err
	}
	if err := p.loadMarketTopics(ctx, since, push); err != nil {
		return err
	}

	// 2e) 应用使用与聊天风格（行为模式）。
	if err := p.loadBehaviourPatterns(ctx, since, valid, get, out); err != nil {
		return err
	}

	// 3) 声明：她自己写在接单资料里的服务能力 / 垂类 / 语种。当前状态，不是行为，不需要浏览同意。
	for _, q := range []struct{ axis, sql string }{
		{AxisSkill, `SELECT ap.user_account_id, s.service_type FROM supply.agent_profiles ap
			JOIN supply.agent_services s ON s.agent_id = ap.agent_id
			WHERE ap.user_account_id IS NOT NULL AND ap.status <> 'DRAFT' AND s.status <> 'DRAFT'
			UNION
			SELECT ap.user_account_id, t FROM supply.agent_profiles ap
			JOIN supply.agent_services s ON s.agent_id = ap.agent_id, jsonb_array_elements_text(s.vertical_tags) t
			WHERE ap.user_account_id IS NOT NULL AND ap.status <> 'DRAFT' AND s.status <> 'DRAFT'`},
		{AxisLanguage, `SELECT ap.user_account_id, lower(l) FROM supply.agent_profiles ap, jsonb_array_elements_text(ap.languages) l
			WHERE ap.user_account_id IS NOT NULL AND ap.status <> 'DRAFT'`},
	} {
		rows, err = p.pool.Query(ctx, q.sql)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		for rows.Next() {
			var user, value string
			if err := rows.Scan(&user, &value); err != nil {
				rows.Close()
				return err
			}
			push(user, Signal{Axis: q.axis, Value: value, Weight: 1, N: 1, First: now, Last: now, Explicit: true})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
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

// loadBehaviourPatterns：应用使用（屏幕停留 / 会话）与聊天**元数据**。都是被动行为，过同一条同意规则。
// 聊天只数条数 / 会话数 / 谁先开口 / 回得多快，**绝不读正文**。
func (p *Postgres) loadBehaviourPatterns(ctx context.Context, since time.Time, valid string, get func(string) Evidence, out map[string]Evidence) error {
	// 屏幕停留：screen id 已在写入口被收窄成安全字符；这里再兜一道 ValidValue。
	rows, err := p.pool.Query(ctx, `
		SELECT e.actor_id, e.target_id, COALESCE(SUM(e.watch_ms), 0), MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		WHERE e.event_type = 'SCREEN_VIEW' AND e.created_at >= $1 AND e.watch_ms > 0 AND `+valid+`
		GROUP BY e.actor_id, e.target_id`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user, screen string
		var ms int64
		var first, last time.Time
		if err := rows.Scan(&user, &screen, &ms, &first, &last); err != nil {
			rows.Close()
			return err
		}
		if !ValidValue(screen) {
			continue
		}
		ev := get(user)
		if ev.Usage.ScreenMs == nil {
			ev.Usage.ScreenMs = map[string]int64{}
		}
		ev.Usage.ScreenMs[screen] += ms
		if ev.Usage.First.IsZero() || first.Before(ev.Usage.First) {
			ev.Usage.First = first
		}
		if last.After(ev.Usage.Last) {
			ev.Usage.Last = last
		}
		out[user] = ev
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	// 前台会话：总时长、次数、活跃天数（越南时间）。
	rows, err = p.pool.Query(ctx, `
		SELECT e.actor_id, COALESCE(SUM(e.watch_ms), 0), COUNT(*), COUNT(DISTINCT (e.created_at AT TIME ZONE `+vnTZ+`)::date), MIN(e.created_at), MAX(e.created_at)
		FROM localnet.interaction_events e
		WHERE e.event_type = 'APP_SESSION' AND e.created_at >= $1 AND e.watch_ms > 0 AND `+valid+`
		GROUP BY e.actor_id`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user string
		var ms int64
		var n, days int
		var first, last time.Time
		if err := rows.Scan(&user, &ms, &n, &days, &first, &last); err != nil {
			rows.Close()
			return err
		}
		ev := get(user)
		ev.Usage.SessionMs, ev.Usage.Sessions, ev.Usage.ActiveDays = ms, n, days
		if ev.Usage.First.IsZero() || first.Before(ev.Usage.First) {
			ev.Usage.First = first
		}
		if last.After(ev.Usage.Last) {
			ev.Usage.Last = last
		}
		out[user] = ev
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	// 聊天元数据。发信人是被画像的人；AI 代回的消息（authored_by 非空）和系统消息不算他的。
	chatValid := consent.ValidAtSQL("m.sender_id", "m.created_at", consent.Recommendation)
	rows, err = p.pool.Query(ctx, `
		WITH msgs AS (
		  SELECT m.sender_id, m.conversation_id, m.created_at,
		         LAG(m.sender_id) OVER w AS prev_sender, LAG(m.created_at) OVER w AS prev_at,
		         (SELECT m2.sender_id FROM conversation.messages m2 WHERE m2.conversation_id = m.conversation_id ORDER BY m2.created_at, m2.id LIMIT 1) AS opener
		    FROM conversation.messages m
		   WHERE m.deleted_at IS NULL AND m.created_at >= $1 AND m.message_type <> 'SYSTEM_CONTEXT' AND COALESCE(m.authored_by, '') = ''
		  WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id)
		)
		SELECT sender_id, COUNT(*), COUNT(DISTINCT conversation_id),
		       COUNT(DISTINCT conversation_id) FILTER (WHERE opener = sender_id),
		       COUNT(*) FILTER (WHERE prev_sender IS NOT NULL AND prev_sender <> sender_id),
		       COUNT(*) FILTER (WHERE prev_sender IS NOT NULL AND prev_sender <> sender_id AND created_at - prev_at <= interval '10 minutes'),
		       MIN(created_at), MAX(created_at)
		  FROM msgs m WHERE `+chatValid+`
		 GROUP BY sender_id`, since)
	if err != nil {
		return err
	}
	for rows.Next() {
		var user string
		var c ChatEvidence
		if err := rows.Scan(&user, &c.Messages, &c.Conversations, &c.Initiated, &c.Replies, &c.FastReplies, &c.First, &c.Last); err != nil {
			rows.Close()
			return err
		}
		ev := get(user)
		ev.Chat = c
		out[user] = ev
	}
	rows.Close()
	return rows.Err()
}

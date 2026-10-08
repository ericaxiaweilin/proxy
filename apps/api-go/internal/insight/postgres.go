package insight

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

const maxUnfilled = 20

// DemandGap：只看公开发出的单（点名邀约的私单不算「没人接」，单独数出来）。
func (p *Postgres) DemandGap(ctx context.Context, now time.Time, days int) (DemandGap, error) {
	if days <= 0 || days > 180 {
		days = 30
	}
	since := now.Add(-time.Duration(days) * 24 * time.Hour)
	out := DemandGap{WindowDays: days, Themes: []ThemeRow{}, Areas: []AreaRow{}, Unfilled: []UnfilledOpp{}}

	const base = `
		WITH o AS (
			SELECT id, COALESCE(payload->>'theme','') AS theme, COALESCE(payload->>'title','') AS title,
			       COALESCE(payload->>'priceLabel','') AS price_label, COALESCE(payload->>'matchingMode','') AS mm,
			       created_at,
			       CASE WHEN payload ? 'lat' AND payload ? 'lng' THEN (payload->>'lat')::float8 END AS lat,
			       CASE WHEN payload ? 'lat' AND payload ? 'lng' THEN (payload->>'lng')::float8 END AS lng
			  FROM marketplace.opportunities
			 WHERE created_at >= $1 AND COALESCE(payload->>'targetAccountId','') = ''
		), a AS (
			SELECT opportunity_id, MIN(created_at) AS first_at,
			       bool_or(payload->>'status' IN ('SELECTED','CONFIRMED')) AS confirmed
			  FROM marketplace.applications GROUP BY opportunity_id
		)`

	// 漏斗 + 按主题
	rows, err := p.pool.Query(ctx, base+`
		SELECT o.theme, COUNT(*), COUNT(a.opportunity_id), COUNT(*) FILTER (WHERE a.confirmed),
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.first_at - o.created_at)) / 60.0)
		           FILTER (WHERE a.first_at IS NOT NULL)
		  FROM o LEFT JOIN a ON a.opportunity_id = o.id
		 GROUP BY o.theme ORDER BY 2 DESC, 1`, since)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var r ThemeRow
		if err := rows.Scan(&r.Theme, &r.Published, &r.WithApplicant, &r.Confirmed, &r.MedianMinutes); err != nil {
			rows.Close()
			return out, err
		}
		if r.Theme == "" {
			r.Theme = "未分类"
		}
		out.Themes = append(out.Themes, r)
		out.Funnel.Published += r.Published
		out.Funnel.WithApplicant += r.WithApplicant
		out.Funnel.Confirmed += r.Confirmed
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	if err := p.pool.QueryRow(ctx, base+`
		SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.first_at - o.created_at)) / 60.0),
		       COUNT(*) FILTER (WHERE a.opportunity_id IS NULL AND o.created_at < $2)
		  FROM o LEFT JOIN a ON a.opportunity_id = o.id`, since, now.Add(-24*time.Hour)).
		Scan(&out.Funnel.MedianMinutesToFirstApplicant, &out.Funnel.Unfilled24h); err != nil {
		return out, err
	}
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM marketplace.opportunities WHERE created_at >= $1 AND COALESCE(payload->>'targetAccountId','') <> ''`, since).Scan(&out.Directed); err != nil {
		return out, err
	}

	// 按片区：需求（有坐标的单）与供给（有坐标的、非草稿的接单资料）并排。
	type cellAgg struct{ demand, supply, unfilled int }
	cells := map[string]*cellAgg{}
	get := func(c string) *cellAgg {
		if cells[c] == nil {
			cells[c] = &cellAgg{}
		}
		return cells[c]
	}
	rows, err = p.pool.Query(ctx, base+`
		SELECT to_char(floor(o.lat * 10) / 10, 'FM990.0') || ',' || to_char(floor(o.lng * 10) / 10, 'FM990.0'),
		       COUNT(*), COUNT(*) FILTER (WHERE a.opportunity_id IS NULL AND o.created_at < $2)
		  FROM o LEFT JOIN a ON a.opportunity_id = o.id
		 WHERE o.lat IS NOT NULL GROUP BY 1`, since, now.Add(-24*time.Hour))
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var cell string
		var d, u int
		if err := rows.Scan(&cell, &d, &u); err != nil {
			rows.Close()
			return out, err
		}
		c := get(cell)
		c.demand, c.unfilled = d, u
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	if err := p.pool.QueryRow(ctx, base+`SELECT COUNT(*) FROM o WHERE lat IS NULL`, since).Scan(&out.NoLocation); err != nil {
		return out, err
	}
	rows, err = p.pool.Query(ctx, `
		SELECT to_char(floor(lat * 10) / 10, 'FM990.0') || ',' || to_char(floor(lng * 10) / 10, 'FM990.0'), COUNT(DISTINCT agent_id)
		  FROM supply.agent_profiles WHERE lat IS NOT NULL AND lng IS NOT NULL AND status <> 'DRAFT' GROUP BY 1`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var cell string
		var s int
		if err := rows.Scan(&cell, &s); err != nil {
			rows.Close()
			return out, err
		}
		get(cell).supply = s
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	for cell, c := range cells {
		if c.demand == 0 {
			continue // 只有供给没有需求的片区不是缺口，不列
		}
		out.Areas = append(out.Areas, AreaRow{Cell: cell, Demand: c.demand, Supply: c.supply, NoSupply: c.supply == 0, Unfilled: c.unfilled})
	}
	sort.Slice(out.Areas, func(i, j int) bool {
		if out.Areas[i].NoSupply != out.Areas[j].NoSupply {
			return out.Areas[i].NoSupply
		}
		if out.Areas[i].Unfilled != out.Areas[j].Unfilled {
			return out.Areas[i].Unfilled > out.Areas[j].Unfilled
		}
		return out.Areas[i].Demand > out.Areas[j].Demand
	})

	// 没人接的单（最老的在前）。
	rows, err = p.pool.Query(ctx, base+`
		SELECT o.id, o.theme, o.title, o.price_label, o.mm, o.created_at,
		       CASE WHEN o.lat IS NOT NULL THEN to_char(floor(o.lat * 10) / 10, 'FM990.0') || ',' || to_char(floor(o.lng * 10) / 10, 'FM990.0') ELSE '' END
		  FROM o LEFT JOIN a ON a.opportunity_id = o.id
		 WHERE a.opportunity_id IS NULL AND o.created_at < $2
		 ORDER BY o.created_at LIMIT `+fmt.Sprint(maxUnfilled), since, now.Add(-24*time.Hour))
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var u UnfilledOpp
		if err := rows.Scan(&u.ID, &u.Theme, &u.Title, &u.PriceLabel, &u.MatchingMode, &u.CreatedAt, &u.Cell); err != nil {
			rows.Close()
			return out, err
		}
		u.AgeHours = float64(int(now.Sub(u.CreatedAt).Hours()*10)) / 10
		out.Unfilled = append(out.Unfilled, u)
	}
	rows.Close()
	return out, rows.Err()
}

// Segments：基于 tag.user_tags 的分群。axis 为空只给覆盖；withAxis+withValue 给「也有」。
func (p *Postgres) Segments(ctx context.Context, now time.Time, axis, withAxis, withValue string) (Segments, error) {
	out := Segments{Axis: axis}
	// 覆盖：活跃用户 = 窗口内有过浏览事件或下过单；分母不含从没动过的账号。
	since := now.Add(-30 * 24 * time.Hour)
	const active = `
		SELECT actor_id AS id FROM localnet.interaction_events WHERE created_at >= $1
		UNION SELECT requester_id FROM fulfillment.orders WHERE created_at >= $1`
	rows, err := p.pool.Query(ctx, `
		WITH act AS (`+active+`), n AS (
			SELECT user_id, COUNT(*) AS c FROM tag.user_tags WHERE expires_at > $2 GROUP BY user_id
		)
		SELECT CASE WHEN n.c IS NULL THEN '0' WHEN n.c < 5 THEN '1-4' WHEN n.c < 10 THEN '5-9' WHEN n.c < 20 THEN '10-19' ELSE '20+' END, COUNT(*), COALESCE(SUM(n.c), 0)
		  FROM act LEFT JOIN n ON n.user_id = act.id GROUP BY 1`, since, now)
	if err != nil {
		return out, err
	}
	order := []string{"0", "1-4", "5-9", "10-19", "20+"}
	counts := map[string]int{}
	var tagSum int
	for rows.Next() {
		var label string
		var users, sum int
		if err := rows.Scan(&label, &users, &sum); err != nil {
			rows.Close()
			return out, err
		}
		counts[label] = users
		tagSum += sum
		out.Coverage.ActiveUsers += users
		if label != "0" {
			out.Coverage.TaggedUsers += users
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	for _, l := range order {
		out.Coverage.Buckets = append(out.Coverage.Buckets, Bucket{Label: l, Users: counts[l]})
	}
	if out.Coverage.TaggedUsers > 0 {
		avg := float64(tagSum) / float64(out.Coverage.TaggedUsers)
		avg = float64(int(avg*10+0.5)) / 10
		out.Coverage.AvgTagsPerTaggedUser = &avg
	}

	if axis != "" {
		rows, err = p.pool.Query(ctx, `SELECT value, COUNT(DISTINCT user_id) FROM tag.user_tags WHERE axis = $1 AND expires_at > $2 GROUP BY value ORDER BY 2 DESC, 1 LIMIT 30`, axis, now)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var v string
			var n int
			if err := rows.Scan(&v, &n); err != nil {
				rows.Close()
				return out, err
			}
			out.Top = append(out.Top, SuppressCell(v, n))
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
	}

	if withAxis != "" && withValue != "" {
		out.WithAxis, out.WithValue = withAxis, withValue
		var cohort int
		if err := p.pool.QueryRow(ctx, `SELECT COUNT(DISTINCT user_id) FROM tag.user_tags WHERE axis = $1 AND value = $2 AND expires_at > $3`, withAxis, withValue, now).Scan(&cohort); err != nil {
			return out, err
		}
		c := SuppressCell(withValue, cohort)
		out.CohortSize = &c
		// 队列本身不到 MinCell 人：连「也有什么」都不给——给了就等于描述这几个人。
		if cohort >= MinCell {
			rows, err = p.pool.Query(ctx, `
				SELECT t.axis || ':' || t.value, COUNT(DISTINCT t.user_id)
				  FROM tag.user_tags t
				 WHERE t.expires_at > $3 AND NOT (t.axis = $1 AND t.value = $2)
				   AND t.user_id IN (SELECT user_id FROM tag.user_tags WHERE axis = $1 AND value = $2 AND expires_at > $3)
				 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25`, withAxis, withValue, now)
			if err != nil {
				return out, err
			}
			for rows.Next() {
				var v string
				var n int
				if err := rows.Scan(&v, &n); err != nil {
					rows.Close()
					return out, err
				}
				out.AlsoHave = append(out.AlsoHave, SuppressCell(v, n))
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return out, err
			}
		}
	}
	return out, nil
}

var interestAxes = map[string]string{
	"INTEREST_TOPIC": "话题", "INTEREST_ACTIVITY": "活动", "VENUE_KIND": "场所",
}

func (p *Postgres) TopInterests(ctx context.Context, now time.Time, limit int) ([]InterestRow, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `
		SELECT axis, value, COUNT(DISTINCT user_id), AVG(strength)::float8, AVG(confidence)::float8
		  FROM tag.user_tags
		 WHERE expires_at > $1 AND axis IN ('INTEREST_TOPIC','INTEREST_ACTIVITY','VENUE_KIND')
		 GROUP BY axis, value HAVING COUNT(DISTINCT user_id) >= $2
		 ORDER BY 3 DESC, 4 DESC, 1, 2 LIMIT $3`, now, MinCell, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InterestRow{}
	for rows.Next() {
		var r InterestRow
		if err := rows.Scan(&r.Axis, &r.Value, &r.Users, &r.Score, &r.Confidence); err != nil {
			return nil, err
		}
		r.Tag = interestAxes[r.Axis] + "·" + r.Value
		r.Score = float64(int(r.Score*1000+0.5)) / 1000
		r.Confidence = float64(int(r.Confidence*1000+0.5)) / 1000
		out = append(out, r)
	}
	return out, rows.Err()
}

const providersSQL = `
SELECT ap.user_account_id, COALESCE(ip.name, ''), COALESCE(ip.handle, ''), COALESCE(ip.city, ''),
       COALESCE(array_agg(DISTINCT s.service_type) FILTER (WHERE s.service_type IS NOT NULL), '{}')
  FROM supply.agent_profiles ap
  LEFT JOIN identity.profiles ip ON ip.user_account_id = ap.user_account_id
  LEFT JOIN supply.agent_services s ON s.agent_id = ap.agent_id AND s.status <> 'DRAFT'
 WHERE ap.user_account_id IS NOT NULL AND ap.status <> 'DRAFT' AND ($1 = '' OR ap.user_account_id = $1)
 GROUP BY ap.user_account_id, ip.name, ip.handle, ip.city
 ORDER BY ap.user_account_id LIMIT $2`

func (p *Postgres) providers(ctx context.Context, id string, limit int) ([]ProviderRow, error) {
	rows, err := p.pool.Query(ctx, providersSQL, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProviderRow{}
	for rows.Next() {
		var r ProviderRow
		if err := rows.Scan(&r.UserID, &r.Name, &r.Handle, &r.City, &r.Services); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *Postgres) Providers(ctx context.Context, limit int) ([]ProviderRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	return p.providers(ctx, "", limit)
}

func (p *Postgres) Provider(ctx context.Context, userID string) (ProviderRow, bool, error) {
	if userID == "" {
		return ProviderRow{}, false, nil
	}
	rows, err := p.providers(ctx, userID, 1)
	if err != nil || len(rows) == 0 {
		return ProviderRow{}, false, err
	}
	return rows[0], true, nil
}

// EvalCases：多人报名（≥2 个有效）且恰好选定了一人的公开单。点名私单不算。
func (p *Postgres) EvalCases(ctx context.Context, since time.Time, limit int) ([]EvalCase, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT o.id,
		       CASE WHEN o.payload ? 'lat' AND o.payload ? 'lng' THEN (o.payload->>'lat')::float8 END,
		       CASE WHEN o.payload ? 'lat' AND o.payload ? 'lng' THEN (o.payload->>'lng')::float8 END,
		       array_agg(a.applicant_id ORDER BY a.created_at),
		       (array_agg(a.applicant_id) FILTER (WHERE a.payload->>'status' IN ('SELECTED','CONFIRMED')))[1]
		  FROM marketplace.opportunities o
		  JOIN marketplace.applications a ON a.opportunity_id = o.id
		 WHERE o.created_at >= $1 AND COALESCE(o.payload->>'targetAccountId','') = ''
		   AND a.payload->>'status' IN ('SUBMITTED','SELECTED','CONFIRMED')
		 GROUP BY o.id, o.payload
		HAVING COUNT(*) >= 2 AND COUNT(*) FILTER (WHERE a.payload->>'status' IN ('SELECTED','CONFIRMED')) = 1
		 ORDER BY o.created_at DESC LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EvalCase{}
	for rows.Next() {
		var c EvalCase
		if err := rows.Scan(&c.OpportunityID, &c.Lat, &c.Lng, &c.Applicants, &c.Chosen); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

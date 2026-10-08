package opsmetrics

import (
	"context"
	"time"
)

// OPS-DATA-QUALITY-001（2026-10-07）：数据治理页（/v1/operator/quality）。
//
// 这一页原来读 `d.quality` / `d.workbench`（notConnected 桩不发这两个字段）——
// **一打开就崩**。而且「无从计算谱系完整率」这个拒绝本身就是错的：谱系断不断
// **恰恰是可数的** —— 每个谱系列非空率是多少、写入方是谁，数一遍就是数据治理的起点。
//
// 所以这一页给的是**曝光谱系的体检报告**，本机实测（1453 条事件）最有信息量的三条：
//
//	① recommendation_request_id / impression_id 的非空率是 **0** —— 谱系断在最关键的一段：
//	   没有任何一条曝光能追溯回把它排出来的那次推荐请求。§9.4 的污染风险、§17 的归因，
//	   全部卡在这一列上。
//	② event_source：1452 条 server / 1 条 client —— **几乎全部事件是服务端造的**（测试种子），
//	   真实客户端遥测基本没在流。样本量问题不治理，任何行为指标都是自说自话。
//	③ candidate_source：1452 条 unknown —— 就算先不管 request_id，连「这条候选从哪个
//	   通道来的」都没写。唯一非 unknown 的是 1 条 chronological_keyset。
//
// 还有三件能被数出来的（都给了，别只挑一个故事讲）：
//
//	event_id 重复（rows − distinct）、client_time 缺失与 >5 分钟时钟偏差、
//	event_type 词表覆盖（行为词汇表实际在产生哪些事件）。
//
// 没有的东西：§9.1 的谱系图（要 request_id 先接上才画得出来）、数据修复操作 ——
// 这一页只报告，不动数据。
type DataQuality struct {
	WindowDays   int64 `json:"windowDays"`
	EventsWindow int64 `json:"events_window"`
	EventsAll    int64 `json:"events_all"`

	// 谱系列覆盖：窗口内 + 全量两套（理由同 trust 页：只报全量会把
	// 「写入方刚接上、新事件已有谱系」埋进 1453 条旧种子里看不出来）。
	// coverage 字段按 field+window 成对出现，客户端按 field 分组渲染。
	Lineage []FieldCoverage `json:"lineage"`

	// 分布：谁在产生事件、从哪个通道
	CandidateSource []Distribution `json:"candidate_source"`
	EventSource     []Distribution `json:"event_source"`
	EventTypes      []Distribution `json:"event_types"`

	ClientTimeFilled  int64   `json:"client_time_filled"`
	SkewOver5Min      int64   `json:"skew_over_5min"`
	MaxSkewSeconds    float64 `json:"max_skew_seconds"`
	DuplicateEventIds int64   `json:"duplicate_event_ids"` // rows − distinct event_id
}

type FieldCoverage struct {
	Field    string  `json:"field"`
	Window   string  `json:"window"` // "window" | "all"
	Filled   int64   `json:"filled"`
	Total    int64   `json:"total"`
	Coverage float64 `json:"coverage"`
}

type Distribution struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

func (p *Postgres) DataQuality(ctx context.Context, now time.Time) (DataQuality, error) {
	since := now.Add(-Window)
	var out DataQuality
	out.WindowDays = int64(Window / (24 * time.Hour))

	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM localnet.interaction_events),
			(SELECT COUNT(*) FROM localnet.interaction_events WHERE created_at >= $1),
			(SELECT COUNT(*) - COUNT(DISTINCT event_id) FROM localnet.interaction_events),
			(SELECT COUNT(*) FROM localnet.interaction_events
			  WHERE client_time IS NOT NULL),
			(SELECT COUNT(*) FROM localnet.interaction_events
			  WHERE client_time IS NOT NULL
			    AND abs(extract(epoch FROM (client_time - created_at))) > 300),
			(SELECT COALESCE(max(abs(extract(epoch FROM (client_time - created_at)))), 0)
			   FROM localnet.interaction_events WHERE client_time IS NOT NULL)`,
		since).
		Scan(&out.EventsAll, &out.EventsWindow, &out.DuplicateEventIds,
			&out.ClientTimeFilled, &out.SkewOver5Min, &out.MaxSkewSeconds)
	if err != nil {
		return DataQuality{}, err
	}

	lineage, err := p.lineageCoverage(ctx, since)
	if err != nil {
		return DataQuality{}, err
	}
	out.Lineage = lineage

	if out.CandidateSource, err = p.distinctCounts(ctx, `
		SELECT COALESCE(NULLIF(candidate_source, ''), '(empty)'), COUNT(*)
		FROM localnet.interaction_events GROUP BY 1 ORDER BY 2 DESC LIMIT 8`); err != nil {
		return DataQuality{}, err
	}
	if out.EventSource, err = p.distinctCounts(ctx, `
		SELECT COALESCE(NULLIF(event_source, ''), '(empty)'), COUNT(*)
		FROM localnet.interaction_events GROUP BY 1 ORDER BY 2 DESC LIMIT 8`); err != nil {
		return DataQuality{}, err
	}
	if out.EventTypes, err = p.distinctCounts(ctx, `
		SELECT event_type, COUNT(*)
		FROM localnet.interaction_events GROUP BY 1 ORDER BY 2 DESC LIMIT 12`); err != nil {
		return DataQuality{}, err
	}
	return out, nil
}

// lineageCoverage 一次算 6 个谱系列 × 窗口/全量。
//
// candidate_source 的「填了」标准比别处严：” 和 'unknown' 都算没填 ——
// unknown 不是值，是写入方偷懒。
func (p *Postgres) lineageCoverage(ctx context.Context, since time.Time) ([]FieldCoverage, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT field, win, filled, total FROM (
			SELECT 'recommendation_request_id' AS field, 'all' AS win,
			       COUNT(*) FILTER (WHERE COALESCE(recommendation_request_id,'') <> '') AS filled, COUNT(*) AS total
			FROM localnet.interaction_events
			UNION ALL
			SELECT 'recommendation_request_id', 'window',
			       COUNT(*) FILTER (WHERE COALESCE(recommendation_request_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events WHERE created_at >= $1
			UNION ALL
			SELECT 'impression_id', 'all',
			       COUNT(*) FILTER (WHERE COALESCE(impression_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events
			UNION ALL
			SELECT 'impression_id', 'window',
			       COUNT(*) FILTER (WHERE COALESCE(impression_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events WHERE created_at >= $1
			UNION ALL
			SELECT 'feed_session_id', 'all',
			       COUNT(*) FILTER (WHERE COALESCE(feed_session_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events
			UNION ALL
			SELECT 'feed_session_id', 'window',
			       COUNT(*) FILTER (WHERE COALESCE(feed_session_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events WHERE created_at >= $1
			UNION ALL
			SELECT 'candidate_source', 'all',
			       COUNT(*) FILTER (WHERE COALESCE(candidate_source,'') <> '' AND candidate_source <> 'unknown'), COUNT(*)
			FROM localnet.interaction_events
			UNION ALL
			SELECT 'candidate_source', 'window',
			       COUNT(*) FILTER (WHERE COALESCE(candidate_source,'') <> '' AND candidate_source <> 'unknown'), COUNT(*)
			FROM localnet.interaction_events WHERE created_at >= $1
			UNION ALL
			SELECT 'client_time', 'all',
			       COUNT(*) FILTER (WHERE client_time IS NOT NULL), COUNT(*)
			FROM localnet.interaction_events
			UNION ALL
			SELECT 'client_time', 'window',
			       COUNT(*) FILTER (WHERE client_time IS NOT NULL), COUNT(*)
			FROM localnet.interaction_events WHERE created_at >= $1
			UNION ALL
			SELECT 'need_id', 'all',
			       COUNT(*) FILTER (WHERE COALESCE(need_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events
			UNION ALL
			SELECT 'need_id', 'window',
			       COUNT(*) FILTER (WHERE COALESCE(need_id,'') <> ''), COUNT(*)
			FROM localnet.interaction_events WHERE created_at >= $1
		) t ORDER BY field, win DESC`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FieldCoverage
	for rows.Next() {
		var f FieldCoverage
		if err := rows.Scan(&f.Field, &f.Window, &f.Filled, &f.Total); err != nil {
			return nil, err
		}
		if f.Total > 0 {
			f.Coverage = float64(f.Filled) / float64(f.Total)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (p *Postgres) distinctCounts(ctx context.Context, query string) ([]Distribution, error) {
	rows, err := p.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Distribution
	for rows.Next() {
		var d Distribution
		if err := rows.Scan(&d.Value, &d.Count); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

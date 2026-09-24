package gravity

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store 读真实行为、存派生出的引力状态。
type Store interface {
	// Occurrences：since 之后的真实行为。只要真人自己的行为 —— AI 代回复、平台账号、系统消息都不算。
	Occurrences(ctx context.Context, since time.Time) ([]Occurrence, error)
	// Keys：已有状态行的（人, 事件）—— 近期没再发生的人也要重算一次，降回 OBSERVE，不能停在旧状态上。
	Keys(ctx context.Context) ([][2]string, error)
	Save(ctx context.Context, states []State) error
	Summary(ctx context.Context) ([]SummaryRow, error)
	Top(ctx context.Context, eventType string, limit int) ([]State, error)
}

type SummaryRow struct {
	EventType   string    `json:"eventType"`
	ActionState string    `json:"actionState"`
	Users       int64     `json:"users"`
	AvgP60      float64   `json:"avgP60"`
	ComputedAt  time.Time `json:"computedAt"`
}

// IsHuman：平台助手 / AI 账号 / agent / 系统 不是「被建模的人」（跟 twininsight.IsHumanTarget 同口径）。
func IsHuman(id string) bool {
	switch id {
	case "", "SYSTEM", "proxy_ai", "user_proxy_ai", "proxy-ai":
		return false
	}
	return !strings.HasPrefix(id, "ai_") && !strings.HasPrefix(id, "agent_")
}

// Recompute 用近 60 天的真实行为重算所有人的引力状态，返回写入的行数。
func Recompute(ctx context.Context, store Store, now time.Time) (int, error) {
	occurrences, err := store.Occurrences(ctx, now.Add(-lookback))
	if err != nil {
		return 0, err
	}
	human := occurrences[:0]
	for _, o := range occurrences {
		if IsHuman(o.UserID) {
			human = append(human, o)
		}
	}
	states := ComputeAll(human, now)
	have := map[[2]string]bool{}
	for _, st := range states {
		have[[2]string{st.UserID, st.EventType}] = true
	}
	keys, err := store.Keys(ctx)
	if err != nil {
		return 0, err
	}
	for _, k := range keys {
		if !have[k] {
			states = append(states, Compute(k[0], k[1], nil, now))
		}
	}
	return len(states), store.Save(ctx, states)
}

// ---------------- Postgres ----------------

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (p *Postgres) Occurrences(ctx context.Context, since time.Time) ([]Occurrence, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT sender_id, 'CHAT_ACTIVE', created_at FROM conversation.messages
			WHERE created_at >= $1 AND deleted_at IS NULL AND COALESCE(authored_by, '') = '' AND message_type <> 'SYSTEM_CONTEXT'
		UNION ALL
		SELECT actor_id, 'BROWSE_ACTIVE', created_at FROM localnet.interaction_events WHERE created_at >= $1
		UNION ALL
		SELECT actor_id, 'SCENE_VISIT', declared_at FROM reality.scene_checkins WHERE declared_at >= $1
		UNION ALL
		SELECT actor_id, 'SCENE_VISIT', visited_at FROM reality.user_scene_states WHERE visited_at IS NOT NULL AND visited_at >= $1`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Occurrence{}
	for rows.Next() {
		var o Occurrence
		if err := rows.Scan(&o.UserID, &o.EventType, &o.At); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (p *Postgres) Keys(ctx context.Context) ([][2]string, error) {
	rows, err := p.pool.Query(ctx, `SELECT user_id, event_type FROM decision.user_event_states WHERE context_key = ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := [][2]string{}
	for rows.Next() {
		var k [2]string
		if err := rows.Scan(&k[0], &k[1]); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func nullTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

func (p *Postgres) Save(ctx context.Context, states []State) error {
	batch := &pgx.Batch{}
	for _, st := range states {
		batch.Queue(`
			INSERT INTO decision.user_event_states (user_id, event_type, context_key, p30, p60, p120, confidence, evidence_coverage,
				sample_events, active_weeks, first_seen, last_seen, peak_hour_of_week, next_likely_at, action_state, model_version, computed_at)
			VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
			ON CONFLICT (user_id, event_type, context_key) DO UPDATE SET p30=EXCLUDED.p30, p60=EXCLUDED.p60, p120=EXCLUDED.p120,
				confidence=EXCLUDED.confidence, evidence_coverage=EXCLUDED.evidence_coverage, sample_events=EXCLUDED.sample_events,
				active_weeks=EXCLUDED.active_weeks, first_seen=COALESCE(EXCLUDED.first_seen, decision.user_event_states.first_seen),
				last_seen=COALESCE(EXCLUDED.last_seen, decision.user_event_states.last_seen), peak_hour_of_week=EXCLUDED.peak_hour_of_week,
				next_likely_at=EXCLUDED.next_likely_at, action_state=EXCLUDED.action_state, model_version=EXCLUDED.model_version,
				computed_at=EXCLUDED.computed_at`,
			st.UserID, st.EventType, st.P30, st.P60, st.P120, st.Confidence, st.EvidenceCoverage, st.SampleEvents, st.ActiveWeeks,
			nullTime(st.FirstSeen), nullTime(st.LastSeen), st.PeakHourOfWeek, st.NextLikelyAt, st.ActionState, st.ModelVersion, st.ComputedAt)
	}
	if batch.Len() == 0 {
		return nil
	}
	return p.pool.SendBatch(ctx, batch).Close()
}

func (p *Postgres) Summary(ctx context.Context) ([]SummaryRow, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT event_type, action_state, COUNT(*), COALESCE(AVG(p60), 0), MAX(computed_at)
		FROM decision.user_event_states WHERE context_key = ''
		GROUP BY event_type, action_state ORDER BY event_type, action_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SummaryRow{}
	for rows.Next() {
		var r SummaryRow
		if err := rows.Scan(&r.EventType, &r.ActionState, &r.Users, &r.AvgP60, &r.ComputedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *Postgres) Top(ctx context.Context, eventType string, limit int) ([]State, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, event_type, p30, p60, p120, confidence, evidence_coverage, sample_events, active_weeks,
			first_seen, last_seen, peak_hour_of_week, next_likely_at, action_state, model_version, computed_at
		FROM decision.user_event_states WHERE context_key = '' AND event_type = $1
		ORDER BY p60 DESC, confidence DESC, user_id LIMIT $2`, eventType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []State{}
	for rows.Next() {
		var st State
		var first, last *time.Time
		if err := rows.Scan(&st.UserID, &st.EventType, &st.P30, &st.P60, &st.P120, &st.Confidence, &st.EvidenceCoverage,
			&st.SampleEvents, &st.ActiveWeeks, &first, &last, &st.PeakHourOfWeek, &st.NextLikelyAt, &st.ActionState, &st.ModelVersion, &st.ComputedAt); err != nil {
			return nil, err
		}
		if first != nil {
			st.FirstSeen = *first
		}
		if last != nil {
			st.LastSeen = *last
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// ---------------- Memory（测试 / 没配库） ----------------

type Memory struct {
	mu     sync.Mutex
	Events []Occurrence
	states map[[2]string]State
}

func NewMemory() *Memory { return &Memory{states: map[[2]string]State{}} }

func (m *Memory) Occurrences(_ context.Context, since time.Time) ([]Occurrence, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Occurrence{}
	for _, o := range m.Events {
		if !o.At.Before(since) {
			out = append(out, o)
		}
	}
	return out, nil
}

func (m *Memory) Keys(context.Context) ([][2]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := [][2]string{}
	for k := range m.states {
		out = append(out, k)
	}
	return out, nil
}

func (m *Memory) Save(_ context.Context, states []State) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, st := range states {
		m.states[[2]string{st.UserID, st.EventType}] = st
	}
	return nil
}

func (m *Memory) Summary(context.Context) ([]SummaryRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	agg := map[[2]string]*SummaryRow{}
	for _, st := range m.states {
		k := [2]string{st.EventType, st.ActionState}
		if agg[k] == nil {
			agg[k] = &SummaryRow{EventType: st.EventType, ActionState: st.ActionState}
		}
		r := agg[k]
		r.AvgP60 = (r.AvgP60*float64(r.Users) + st.P60) / float64(r.Users+1)
		r.Users++
		if st.ComputedAt.After(r.ComputedAt) {
			r.ComputedAt = st.ComputedAt
		}
	}
	out := []SummaryRow{}
	for _, r := range agg {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].EventType != out[j].EventType {
			return out[i].EventType < out[j].EventType
		}
		return out[i].ActionState < out[j].ActionState
	})
	return out, nil
}

func (m *Memory) Top(_ context.Context, eventType string, limit int) ([]State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []State{}
	for _, st := range m.states {
		if st.EventType == eventType {
			out = append(out, st)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].P60 != out[j].P60 {
			return out[i].P60 > out[j].P60
		}
		return out[i].UserID < out[j].UserID
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

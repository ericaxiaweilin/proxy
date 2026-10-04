// Package operatoraudit records what an operator did (OPS-AUDIT-001).
//
// Before this, operator writes from the console left no trace: "recompute gravity now"
// recorded nothing at all, and a provider-application review recorded itself only as
// reviewed_by/reviewed_at on the application row. Every existing audit table belongs to
// one domain, so nothing could answer "what did this operator account touch in the last
// hour" — which is the question that makes splitting operator scopes (OPS-SCOPE-001/002)
// worth anything. Delegated power nobody can trace is just power.
//
// The table is append-only at the database level (migration 161): UPDATE / DELETE /
// TRUNCATE are rejected by trigger.
package operatoraudit

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Outcome values. Kept as strings, not an enum type: they land in a CHECK constraint and
// the three of them are the whole vocabulary.
const (
	OutcomeOK     = "OK"
	OutcomeDenied = "DENIED"
	OutcomeError  = "ERROR"
)

// Entry is one operator action.
type Entry struct {
	// OperatorID is the authenticated actor (user account). PrincipalID is the principal
	// the gate checked the allowlist and scopes against; they differ for business acting.
	OperatorID  string         `json:"operatorId"`
	PrincipalID string         `json:"principalId"`
	Action      string         `json:"action"`
	TargetKind  string         `json:"targetKind,omitempty"`
	TargetID    string         `json:"targetId,omitempty"`
	Scope       string         `json:"scope,omitempty"`
	Outcome     string         `json:"outcome"`
	Detail      map[string]any `json:"detail,omitempty"`
	RequestID   string         `json:"requestId,omitempty"`
	ActedAt     time.Time      `json:"actedAt"`
}

// Store persists and reads audit rows.
type Store interface {
	Append(ctx context.Context, e Entry) error
	Recent(ctx context.Context, limit int) ([]Entry, error)
}

// Postgres is the real store.
type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (p *Postgres) Append(ctx context.Context, e Entry) error {
	detail, err := json.Marshal(e.Detail)
	if err != nil {
		return err
	}
	if len(detail) == 0 || string(detail) == "null" {
		detail = []byte("{}")
	}
	_, err = p.pool.Exec(ctx, `
		INSERT INTO operator.action_log
			(operator_id, principal_id, action, target_kind, target_id, scope, outcome, detail, request_id, acted_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		e.OperatorID, e.PrincipalID, e.Action, e.TargetKind, e.TargetID, e.Scope, e.Outcome, detail, e.RequestID, e.ActedAt)
	return err
}

func (p *Postgres) Recent(ctx context.Context, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := p.pool.Query(ctx, `
		SELECT operator_id, principal_id, action, target_kind, target_id, scope, outcome, detail, request_id, acted_at
		FROM operator.action_log ORDER BY action_id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var detail []byte
		if err := rows.Scan(&e.OperatorID, &e.PrincipalID, &e.Action, &e.TargetKind, &e.TargetID,
			&e.Scope, &e.Outcome, &detail, &e.RequestID, &e.ActedAt); err != nil {
			return nil, err
		}
		if len(detail) > 0 {
			_ = json.Unmarshal(detail, &e.Detail)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Recorder is what handlers actually hold. It exists so that an audit-write failure can
// never be mistaken for "nothing happened", and never aborts the action either.
//
// The two requirements pull in opposite directions, and the resolution is deliberate:
// unlike operator.number_lookups (fail-closed — no audit row, no data returned, because a
// lookup exposes both parties on an order), an operator action has already happened by the
// time its audit write fails. Rolling the action back would use data consistency to paper
// over an audit gap. So the failure is logged, counted, and surfaced through
// GET /v1/operator/access as auditWriteFailed — the gap stays visible instead of silent.
type Recorder struct {
	store Store

	mu     sync.Mutex
	failed int64
	total  int64
}

// NewRecorder returns a recorder over store. A nil store is allowed and means "no
// database configured": every Record is then counted as a failure, because an action with
// no audit row is exactly the gap this type is supposed to make visible.
func NewRecorder(store Store) *Recorder { return &Recorder{store: store} }

func (r *Recorder) Record(ctx context.Context, e Entry) {
	if r == nil {
		return
	}
	// Stamped here rather than in each Store: a row with the zero time sorts before every
	// real one and reads as "1970", and defaulting it per-implementation is how one store
	// ends up doing it and another not.
	if e.ActedAt.IsZero() {
		e.ActedAt = time.Now().UTC()
	}
	r.mu.Lock()
	r.total++
	r.mu.Unlock()
	if r.store == nil {
		r.countFailed()
		log.Printf("operatoraudit: no store configured, action %q by %s is unaudited", e.Action, e.OperatorID)
		return
	}
	if err := r.store.Append(ctx, e); err != nil {
		r.countFailed()
		log.Printf("operatoraudit: append failed for action %q by %s: %v", e.Action, e.OperatorID, err)
	}
}

func (r *Recorder) countFailed() {
	r.mu.Lock()
	r.failed++
	r.mu.Unlock()
}

// Counts reports (recorded, failedWrites) since process start. failedWrites > 0 means
// there are operator actions nobody can account for.
func (r *Recorder) Counts() (int64, int64) {
	if r == nil {
		return 0, 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.total, r.failed
}

// Recent reads back the log. A nil store returns no rows and no error — the caller states
// that auditing is not connected rather than showing an empty list that reads as "clean".
func (r *Recorder) Recent(ctx context.Context, limit int) ([]Entry, error) {
	if r == nil || r.store == nil {
		return nil, nil
	}
	return r.store.Recent(ctx, limit)
}

// Connected reports whether audit rows can actually be persisted.
func (r *Recorder) Connected() bool { return r != nil && r.store != nil }

var _ Store = (*Postgres)(nil)

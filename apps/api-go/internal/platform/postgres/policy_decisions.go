package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
)

// PolicyDecisionRepository persists LC-28 policy decisions and their order
// stamps. Schema: migrations/065_policy_decisions.sql, 067 (jurisdiction),
// 134 (stamp history key + immutability).
//
// POLICY-STAMP-DURABLE-001: production used to wire the in-memory repository,
// so the regulator-facing record of "which policy applied when this order was
// confirmed" vanished on every restart while orders kept pointing at decision
// ids that no longer existed. Stamp uses the context transaction when there
// is one, so it commits or rolls back together with the order transition.
type PolicyDecisionRepository struct {
	pool *pgxpool.Pool
}

func NewPolicyDecisionRepository(pool *pgxpool.Pool) *PolicyDecisionRepository {
	return &PolicyDecisionRepository{pool: pool}
}

const policyDecisionColumns = `id, user_id, category_code, terms_version, privacy_version, jurisdiction, kill_switch_state, evaluated_at, expires_at`

func scanPolicyDecision(row pgx.Row) (*policydecisions.Decision, error) {
	var d policydecisions.Decision
	var category string
	var killSwitch []byte
	if err := row.Scan(&d.ID, &d.UserID, &category, &d.TermsVersion, &d.PrivacyVersion, &d.Jurisdiction, &killSwitch, &d.EvaluatedAt, &d.ExpiresAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, policydecisions.ErrNotFound
		}
		return nil, err
	}
	d.CategoryCode = policydecisions.CategoryCode(category)
	if err := json.Unmarshal(killSwitch, &d.KillSwitch); err != nil {
		return nil, fmt.Errorf("decode kill switch state: %w", err)
	}
	if d.KillSwitch.Categories == nil {
		d.KillSwitch.Categories = map[string]policydecisions.KillSwitchEntry{}
	}
	return &d, nil
}

func (r *PolicyDecisionRepository) GetByTuple(ctx context.Context, userID string, category policydecisions.CategoryCode, termsVersion, privacyVersion, jurisdiction string) (*policydecisions.Decision, error) {
	return scanPolicyDecision(queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT `+policyDecisionColumns+` FROM policy.policy_decisions
		WHERE user_id=$1 AND category_code=$2 AND terms_version=$3 AND privacy_version=$4 AND jurisdiction=$5`,
		userID, string(category), termsVersion, privacyVersion, jurisdiction))
}

func (r *PolicyDecisionRepository) GetByID(ctx context.Context, id string) (*policydecisions.Decision, error) {
	return scanPolicyDecision(queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT `+policyDecisionColumns+` FROM policy.policy_decisions WHERE id=$1`, id))
}

func (r *PolicyDecisionRepository) Insert(ctx context.Context, d policydecisions.Decision) error {
	killSwitch, err := json.Marshal(d.KillSwitch)
	if err != nil {
		return err
	}
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO policy.policy_decisions (id, user_id, category_code, terms_version, privacy_version, jurisdiction, kill_switch_state, evaluated_at, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (user_id, category_code, terms_version, privacy_version, jurisdiction) DO NOTHING`,
		d.ID, d.UserID, string(d.CategoryCode), d.TermsVersion, d.PrivacyVersion, d.Jurisdiction, killSwitch, d.EvaluatedAt, d.ExpiresAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return policydecisions.ErrDecisionExists
	}
	return nil
}

// Stamp appends an (order, decision, lifecycle) row. The same decision
// stamped again at the same lifecycle is idempotent; a later lifecycle
// is a new history row (migration 134 widens the key).
func (r *PolicyDecisionRepository) Stamp(ctx context.Context, stamp policydecisions.OrderStamp) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO policy.order_decisions (order_id, decision_id, stamped_at, stamped_lifecycle)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (order_id, decision_id, stamped_lifecycle) DO NOTHING`,
		stamp.OrderID, stamp.DecisionID, stamp.StampedAt, stamp.StampedLifecycle)
	return err
}

func (r *PolicyDecisionRepository) StampsForOrder(ctx context.Context, orderID string) ([]policydecisions.OrderStamp, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT order_id, decision_id, stamped_at, stamped_lifecycle
		FROM policy.order_decisions WHERE order_id=$1 ORDER BY stamped_at ASC, stamped_lifecycle ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stamps := []policydecisions.OrderStamp{}
	for rows.Next() {
		var stamp policydecisions.OrderStamp
		if err := rows.Scan(&stamp.OrderID, &stamp.DecisionID, &stamp.StampedAt, &stamp.StampedLifecycle); err != nil {
			return nil, err
		}
		stamps = append(stamps, stamp)
	}
	return stamps, rows.Err()
}

var (
	_ policydecisions.Repository         = (*PolicyDecisionRepository)(nil)
	_ policydecisions.StampingRepository = (*PolicyDecisionRepository)(nil)
)

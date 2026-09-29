package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/numberlookup"
)

// NumberLookupRecorder 把每次客服反查写进只追加的 operator.number_lookups
// （PUBLIC-NO-LOOKUP-001，migrations/145）。用 queryerForContext：命令跑在事务里
// （api.executeCommand → WithinTransaction）时，审计行与命令同一事务提交 / 回滚。
type NumberLookupRecorder struct{ pool *pgxpool.Pool }

func NewNumberLookupRecorder(pool *pgxpool.Pool) *NumberLookupRecorder {
	return &NumberLookupRecorder{pool: pool}
}

func (r *NumberLookupRecorder) Record(ctx context.Context, entry numberlookup.Entry) error {
	if r == nil || r.pool == nil {
		return errors.New("number lookup recorder has no database")
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO operator.number_lookups
			(operator_id, principal_id, number, reason, outcome, kind, entity_id, command_id, correlation_id, looked_up_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		entry.OperatorID, entry.PrincipalID, entry.Number, entry.Reason, string(entry.Outcome), string(entry.Kind),
		entry.EntityID, entry.CommandID, entry.CorrelationID, entry.LookedUpAt)
	return err
}

var _ numberlookup.Recorder = (*NumberLookupRecorder)(nil)

package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type InboxRepository struct{ pool *pgxpool.Pool }

func NewInboxRepository(pool *pgxpool.Pool) *InboxRepository { return &InboxRepository{pool: pool} }

// TryProcess 尝试插入 event_id，成功返回 true（首次处理），已存在返回 false（重复，需跳过）
func (r *InboxRepository) TryProcess(ctx context.Context, eventID, eventType, aggregateType, aggregateID string) (bool, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO inbox.processed_events (event_id, event_type, aggregate_type, aggregate_id)
		VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`, eventID, eventType, aggregateType, aggregateID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r *InboxRepository) IsProcessed(ctx context.Context, eventID string) (bool, error) {
	var exists bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM inbox.processed_events WHERE event_id=$1)`, eventID).Scan(&exists)
	return exists, err
}

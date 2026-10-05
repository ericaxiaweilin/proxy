package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// CONTENT-TASK-001：内容任务的 Postgres 存取。稿件 / 审核 / 发布链接是 JSONB（整体读写，
// 不单独查询）；状态和归属是列，按商家 / creator 列表走索引。

const contentTaskColumns = `id, invitation_id, merchant_id, agent_id, title, brief, content_type, platforms, state, draft, review, publications, nudged_at, created_at, updated_at`

func scanContentTask(row pgx.Row) (supply.ContentTask, error) {
	var t supply.ContentTask
	var draft, review, pubs []byte
	var nudged *time.Time
	if err := row.Scan(&t.ID, &t.InvitationID, &t.MerchantID, &t.AgentID, &t.Title, &t.Brief, &t.ContentType, &t.Platforms, &t.State, &draft, &review, &pubs, &nudged, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return t, err
	}
	if len(draft) > 0 && string(draft) != "null" {
		t.Draft = &supply.ContentDraft{}
		if err := json.Unmarshal(draft, t.Draft); err != nil {
			return t, err
		}
	}
	if len(review) > 0 && string(review) != "null" {
		t.Review = &supply.ContentReview{}
		if err := json.Unmarshal(review, t.Review); err != nil {
			return t, err
		}
	}
	t.Publications = []supply.ContentPublication{}
	if len(pubs) > 0 {
		if err := json.Unmarshal(pubs, &t.Publications); err != nil {
			return t, err
		}
	}
	if nudged != nil {
		t.NudgedAt = *nudged
	}
	return t, nil
}

func contentTaskArgs(t supply.ContentTask) (draft, review, pubs []byte, nudged *time.Time, err error) {
	if t.Draft != nil {
		if draft, err = json.Marshal(t.Draft); err != nil {
			return
		}
	}
	if t.Review != nil {
		if review, err = json.Marshal(t.Review); err != nil {
			return
		}
	}
	list := t.Publications
	if list == nil {
		list = []supply.ContentPublication{}
	}
	if pubs, err = json.Marshal(list); err != nil {
		return
	}
	if !t.NudgedAt.IsZero() {
		n := t.NudgedAt
		nudged = &n
	}
	return
}

func (r *SupplyRepository) SaveContentTask(ctx context.Context, t supply.ContentTask) error {
	draft, review, pubs, nudged, err := contentTaskArgs(t)
	if err != nil {
		return err
	}
	platforms := t.Platforms
	if platforms == nil {
		platforms = []string{}
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO supply.content_tasks (`+contentTaskColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (invitation_id) DO NOTHING`,
		t.ID, t.InvitationID, t.MerchantID, t.AgentID, t.Title, t.Brief, t.ContentType, platforms, t.State, draft, review, pubs, nudged, t.CreatedAt, t.UpdatedAt,
	)
	return err
}

func (r *SupplyRepository) UpdateContentTask(ctx context.Context, t supply.ContentTask) error {
	draft, review, pubs, nudged, err := contentTaskArgs(t)
	if err != nil {
		return err
	}
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE supply.content_tasks
		SET state=$2, draft=$3, review=$4, publications=$5, nudged_at=$6, updated_at=$7
		WHERE id=$1`,
		t.ID, t.State, draft, review, pubs, nudged, t.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return supply.ErrContentTaskNotFound
	}
	return nil
}

func (r *SupplyRepository) GetContentTask(ctx context.Context, id string) (supply.ContentTask, error) {
	t, err := scanContentTask(queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT `+contentTaskColumns+` FROM supply.content_tasks WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return t, supply.ErrContentTaskNotFound
	}
	return t, err
}

func (r *SupplyRepository) listContentTasks(ctx context.Context, where string, arg string) ([]supply.ContentTask, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT `+contentTaskColumns+` FROM supply.content_tasks WHERE `+where+` ORDER BY created_at DESC LIMIT 200`, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []supply.ContentTask{}
	for rows.Next() {
		t, err := scanContentTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *SupplyRepository) ListContentTasksByMerchant(ctx context.Context, merchantID string) ([]supply.ContentTask, error) {
	return r.listContentTasks(ctx, "merchant_id=$1", merchantID)
}

func (r *SupplyRepository) ListContentTasksByAgent(ctx context.Context, agentID string) ([]supply.ContentTask, error) {
	return r.listContentTasks(ctx, "agent_id=$1", agentID)
}

// UpdateContentTaskAndPublish：任务状态和事件（催一下 / 审核结果）同一个事务落库，worker 从
// outbox 取事件投进 creator 的收件箱。没配 outbox 就报错，不静默只存一半。
func (r *SupplyRepository) UpdateContentTaskAndPublish(ctx context.Context, t supply.ContentTask, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("supply transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := r.UpdateContentTask(transactionContext, t); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// FulfillmentRepository 持久化 Order/Offer（北极星 Traceable Human Order 的可回放载体）。
type FulfillmentRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

func NewFulfillmentRepository(pool *pgxpool.Pool) *FulfillmentRepository {
	return &FulfillmentRepository{pool: pool}
}

func NewFulfillmentRepositoryWithOutbox(pool *pgxpool.Pool, outboxRepository *OutboxRepository) *FulfillmentRepository {
	return &FulfillmentRepository{pool: pool, outbox: outboxRepository}
}

func (r *FulfillmentRepository) CreateOrder(ctx context.Context, order fulfillment.Order) error {
	return insertOrder(ctx, execerForContext(ctx, r.pool), order)
}

func (r *FulfillmentRepository) EnsureOrder(ctx context.Context, order fulfillment.Order, domainEvents []event.DomainEvent) error {
	snapshot, amendments, settlement, outcome, err := encodeOrderJSON(order)
	if err != nil {
		return err
	}
	if len(domainEvents) > 0 && r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	// ORDER-MATERIALIZE-AUDIT-001：插入与出生事件同一事务；已存在（重试）时不重复发事件。
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		if err := setAuditContext(txCtx, tx, domainEvents); err != nil {
			return err
		}
		tag, err := tx.Exec(txCtx, `
			INSERT INTO fulfillment.orders (
				id, requester_id, agent_id, need_id, lifecycle, version,
				snapshot, amendments, settlement, outcome, created_at, updated_at, store_id, order_no
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
			ON CONFLICT (id) DO NOTHING`,
			order.ID, order.RequesterID, order.AgentID, order.NeedID, order.Lifecycle, order.Version,
			snapshot, amendments, settlement, outcome, order.CreatedAt, order.UpdatedAt, order.StoreID, nullableText(order.OrderNo))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			for _, domainEvent := range domainEvents {
				if err := r.outbox.publishWithExec(txCtx, tx, domainEvent); err != nil {
					return err
				}
			}
			return nil
		}
		var requesterID, agentID, needID string
		if err := tx.QueryRow(txCtx, `SELECT requester_id, agent_id, need_id FROM fulfillment.orders WHERE id=$1`, order.ID).Scan(&requesterID, &agentID, &needID); err != nil {
			return err
		}
		if requesterID != order.RequesterID || agentID != order.AgentID || needID != order.NeedID {
			return errors.New("order id conflicts with another materialisation")
		}
		return nil
	})
}

// setAuditContext 把本事务的「谁 / 哪条命令」写进事务级设置（is_local = true，
// 事务结束即失效，不会串到连接池里的下一个请求）。fulfillment 的审计触发器
// （migrations/135_order_audit_and_guard.sql）读取它们写 fulfillment.audit_log。
// 优先用命令上下文；跨域物化没有命令上下文时退回领域事件的 principal / causation。
func setAuditContext(ctx context.Context, tx pgx.Tx, domainEvents []event.DomainEvent) error {
	audit, ok := fulfillment.AuditFromContext(ctx)
	if !ok && len(domainEvents) > 0 {
		first := domainEvents[0]
		audit = fulfillment.AuditContext{ActorID: first.PrincipalID, PrincipalID: first.PrincipalID, CommandType: first.EventType, CommandID: first.CausationID, CorrelationID: first.CorrelationID}
	}
	eventTypes := make([]string, 0, len(domainEvents))
	for _, domainEvent := range domainEvents {
		eventTypes = append(eventTypes, domainEvent.EventType)
	}
	_, err := tx.Exec(ctx, `SELECT
		set_config('proxy.audit_actor', $1, true),
		set_config('proxy.audit_principal', $2, true),
		set_config('proxy.audit_command_type', $3, true),
		set_config('proxy.audit_command_id', $4, true),
		set_config('proxy.audit_correlation_id', $5, true),
		set_config('proxy.audit_events', $6, true)`,
		audit.ActorID, audit.PrincipalID, audit.CommandType, audit.CommandID, audit.CorrelationID, strings.Join(eventTypes, ","))
	return err
}

func insertOrder(ctx context.Context, execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, order fulfillment.Order) error {
	snapshot, amendments, settlement, outcome, err := encodeOrderJSON(order)
	if err != nil {
		return err
	}
	_, err = execer.Exec(ctx, `
		INSERT INTO fulfillment.orders (
			id, requester_id, agent_id, need_id, lifecycle, version,
			snapshot, amendments, settlement, outcome, created_at, updated_at, store_id, order_no
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		order.ID, order.RequesterID, order.AgentID, order.NeedID, order.Lifecycle, order.Version,
		snapshot, amendments, settlement, outcome, order.CreatedAt, order.UpdatedAt, order.StoreID, nullableText(order.OrderNo),
	)
	return err
}

func (r *FulfillmentRepository) CreateOrderAndPublish(ctx context.Context, order fulfillment.Order, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := setAuditContext(transactionContext, transaction, domainEvents); err != nil {
			return err
		}
		if err := insertOrder(transactionContext, transaction, order); err != nil {
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

func (r *FulfillmentRepository) GetOrder(ctx context.Context, id string) (fulfillment.Order, error) {
	var order fulfillment.Order
	var snapshot, amendments, settlement, outcome []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, requester_id, agent_id, need_id, lifecycle, version,
		       snapshot, amendments, settlement, outcome, created_at, updated_at, store_id, COALESCE(order_no, '')
		FROM fulfillment.orders
		WHERE id = $1`, id).Scan(
		&order.ID, &order.RequesterID, &order.AgentID, &order.NeedID, &order.Lifecycle, &order.Version,
		&snapshot, &amendments, &settlement, &outcome, &order.CreatedAt, &order.UpdatedAt, &order.StoreID, &order.OrderNo,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fulfillment.Order{}, fulfillment.ErrOrderNotFound
	}
	if err != nil {
		return fulfillment.Order{}, err
	}
	if err := json.Unmarshal(snapshot, &order.Snapshot); err != nil {
		return fulfillment.Order{}, fmt.Errorf("decode order snapshot: %w", err)
	}
	if err := json.Unmarshal(amendments, &order.Amendments); err != nil {
		return fulfillment.Order{}, fmt.Errorf("decode order amendments: %w", err)
	}
	if len(settlement) > 0 {
		if err := json.Unmarshal(settlement, &order.Settlement); err != nil {
			return fulfillment.Order{}, fmt.Errorf("decode order settlement: %w", err)
		}
	}
	if len(outcome) > 0 {
		if err := json.Unmarshal(outcome, &order.Outcome); err != nil {
			return fulfillment.Order{}, fmt.Errorf("decode order outcome: %w", err)
		}
	}
	return order, nil
}

func (r *FulfillmentRepository) UpdateOrder(ctx context.Context, order fulfillment.Order, expectedVersion int) error {
	return updateOrder(ctx, execerForContext(ctx, r.pool), order, expectedVersion)
}

func updateOrder(ctx context.Context, execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, order fulfillment.Order, expectedVersion int) error {
	snapshot, amendments, settlement, outcome, err := encodeOrderJSON(order)
	if err != nil {
		return err
	}
	commandTag, err := execer.Exec(ctx, `
		UPDATE fulfillment.orders
		SET lifecycle = $1, version = $2, snapshot = $3, amendments = $4,
		    settlement = $5, outcome = $6, updated_at = $7, store_id = $8
		WHERE id = $9 AND version = $10`,
		order.Lifecycle, order.Version, snapshot, amendments, settlement, outcome, order.UpdatedAt, order.StoreID,
		order.ID, expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return fulfillment.ErrVersionConflict
	}
	return nil
}

func (r *FulfillmentRepository) UpdateOrderAndPublish(ctx context.Context, order fulfillment.Order, expectedVersion int, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := setAuditContext(transactionContext, transaction, domainEvents); err != nil {
			return err
		}
		if err := updateOrder(transactionContext, transaction, order, expectedVersion); err != nil {
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

func (r *FulfillmentRepository) CreateOffer(ctx context.Context, o fulfillment.Offer) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO fulfillment.offers (id, task_id, slot_id, requester_id, agent_id, candidate_batch_id, status, expires_at, version, created_at, updated_at, topic_key, note, agreed_compensation, currency)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		offerInsertArgs(o)...,
	)
	return err
}

// offerInsertArgs 是 offers 两条 INSERT 共用的参数表。TOPIC-INVITE-PERSIST-001：
// 以前 CreateOfferAndPublish 自己手写一份、漏了 topic_key / note，主题邀约在 PG
// 模式下落成空主题 —— 两条路径必须同一份列清单。
func offerInsertArgs(o fulfillment.Offer) []any {
	currency := o.Currency
	if currency == "" {
		currency = "VND"
	}
	return []any{o.ID, o.TaskID, o.SlotID, o.RequesterID, o.AgentID, nullableText(o.BatchID), o.Status, o.ExpiresAt, o.Version, o.CreatedAt, o.UpdatedAt, o.TopicKey, o.Note, o.AgreedCompensation, currency}
}

func (r *FulfillmentRepository) CreateOfferAndPublish(ctx context.Context, o fulfillment.Offer, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, tx pgx.Tx) error {
		if err := setAuditContext(transactionContext, tx, domainEvents); err != nil {
			return err
		}
		if _, err := tx.Exec(transactionContext, `
			INSERT INTO fulfillment.offers (id, task_id, slot_id, requester_id, agent_id, candidate_batch_id, status, expires_at, version, created_at, updated_at, topic_key, note, agreed_compensation, currency)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			offerInsertArgs(o)...,
		); err != nil {
			return err
		}
		for _, e := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, tx, e); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *FulfillmentRepository) GetOffer(ctx context.Context, id string) (fulfillment.Offer, error) {
	var o fulfillment.Offer
	var batchID *string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, task_id, slot_id, requester_id, agent_id, candidate_batch_id, status, expires_at, version, created_at, updated_at, topic_key, note, agreed_compensation, currency
		FROM fulfillment.offers WHERE id=$1`, id).Scan(
		&o.ID, &o.TaskID, &o.SlotID, &o.RequesterID, &o.AgentID, &batchID, &o.Status, &o.ExpiresAt, &o.Version, &o.CreatedAt, &o.UpdatedAt, &o.TopicKey, &o.Note, &o.AgreedCompensation, &o.Currency,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fulfillment.Offer{}, fulfillment.ErrOfferNotFound
	}
	if err != nil {
		return fulfillment.Offer{}, err
	}
	if batchID != nil {
		o.BatchID = *batchID
	}
	return o, nil
}

func (r *FulfillmentRepository) UpdateOffer(ctx context.Context, o fulfillment.Offer, expectedVersion int) error {
	// 放进事务：审计触发器要读同一事务里的 set_config（ORDER-AUDIT-001）。
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		if err := setAuditContext(txCtx, tx, nil); err != nil {
			return err
		}
		tag, err := tx.Exec(txCtx, `
			UPDATE fulfillment.offers SET status=$1, version=$2, updated_at=$3
			WHERE id=$4 AND version=$5`,
			o.Status, o.Version, o.UpdatedAt, o.ID, expectedVersion,
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return fulfillment.ErrVersionConflict
		}
		return nil
	})
}

// WithinTransaction 让 fulfillment.Service 把订单写入、outbox 事件、策略盖章放进
// 同一个事务（POLICY-STAMP-DURABLE-001）；ctx 里已有事务时复用它。
func (r *FulfillmentRepository) WithinTransaction(ctx context.Context, operation func(context.Context) error) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, _ pgx.Tx) error {
		return operation(txCtx)
	})
}

func (r *FulfillmentRepository) ListOffersByAgent(ctx context.Context, agentID string) ([]fulfillment.Offer, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, task_id, slot_id, requester_id, agent_id, candidate_batch_id, status, expires_at, version, created_at, updated_at, topic_key, note, agreed_compensation, currency
		FROM fulfillment.offers WHERE agent_id=$1 ORDER BY created_at DESC`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []fulfillment.Offer{}
	for rows.Next() {
		var o fulfillment.Offer
		var batchID *string
		if err := rows.Scan(&o.ID, &o.TaskID, &o.SlotID, &o.RequesterID, &o.AgentID, &batchID, &o.Status, &o.ExpiresAt, &o.Version, &o.CreatedAt, &o.UpdatedAt, &o.TopicKey, &o.Note, &o.AgreedCompensation, &o.Currency); err != nil {
			return nil, err
		}
		if batchID != nil {
			o.BatchID = *batchID
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

func (r *FulfillmentRepository) AcceptOfferAndCreateOrder(ctx context.Context, offer fulfillment.Offer, order fulfillment.Order, expectedOfferVersion int, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		if err := setAuditContext(txCtx, tx, domainEvents); err != nil {
			return err
		}
		// Lock offer row
		var currentStatus string
		var currentVersion int
		var expiresAt time.Time
		var slotID string
		err := tx.QueryRow(txCtx, `SELECT status, version, expires_at, slot_id FROM fulfillment.offers WHERE id=$1 FOR UPDATE`, offer.ID).Scan(&currentStatus, &currentVersion, &expiresAt, &slotID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fulfillment.ErrOfferNotFound
		}
		if err != nil {
			return err
		}
		if currentVersion != expectedOfferVersion {
			return fulfillment.ErrVersionConflict
		}
		if currentStatus != "OFFERED" {
			return fulfillment.ErrOfferNotAvailable
		}
		if time.Now().UTC().After(expiresAt) {
			return fulfillment.ErrOfferExpired
		}
		// Check slot uniqueness via orders unique index (try insert, handle conflict)
		// Update offer
		if _, err := tx.Exec(txCtx, `UPDATE fulfillment.offers SET status=$1, version=$2, updated_at=$3 WHERE id=$4 AND version=$5`, offer.Status, offer.Version, offer.UpdatedAt, offer.ID, expectedOfferVersion); err != nil {
			return err
		}
		// Insert order with slot/task reference
		snapshot, amendments, settlement, outcome, err := encodeOrderJSON(order)
		if err != nil {
			return err
		}
		// Use slot/task columns if available
		// TOPIC-INVITE-001: 主题订单没有 task/slot —— 必须存 NULL 而不是 ""，
		// 否则 uq_orders_slot_active（WHERE slot_id IS NOT NULL）会把第二个
		// 主题订单当成"同一个档位卖两次"拒掉。档位订单恒有非空 slot，行为不变。
		if _, err := tx.Exec(txCtx, `
			INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, amendments, settlement, outcome, created_at, updated_at, task_id, slot_id, offer_id, order_no)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			order.ID, order.RequesterID, order.AgentID, order.NeedID, order.Lifecycle, order.Version, snapshot, amendments, settlement, outcome, order.CreatedAt, order.UpdatedAt, nullableText(offer.TaskID), nullableText(offer.SlotID), offer.ID, nullableText(order.OrderNo),
		); err != nil {
			// unique violation on slot -> slot unavailable
			if isUniqueViolation(err) {
				return fulfillment.ErrOfferNotAvailable
			}
			return err
		}
		for _, e := range domainEvents {
			if err := r.outbox.publishWithExec(txCtx, tx, e); err != nil {
				return err
			}
		}
		return nil
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

func (r *FulfillmentRepository) Snapshot(ctx context.Context) ([]fulfillment.Order, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, requester_id, agent_id, need_id, lifecycle, version,
		       snapshot, amendments, settlement, outcome, created_at, updated_at, store_id, COALESCE(order_no, '')
		FROM fulfillment.orders
		ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []fulfillment.Order{}
	for rows.Next() {
		var order fulfillment.Order
		var snapshot, amendments, settlement, outcome []byte
		if err := rows.Scan(
			&order.ID, &order.RequesterID, &order.AgentID, &order.NeedID, &order.Lifecycle, &order.Version,
			&snapshot, &amendments, &settlement, &outcome, &order.CreatedAt, &order.UpdatedAt, &order.StoreID, &order.OrderNo,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(snapshot, &order.Snapshot); err != nil {
			return nil, fmt.Errorf("decode order snapshot: %w", err)
		}
		if err := json.Unmarshal(amendments, &order.Amendments); err != nil {
			return nil, fmt.Errorf("decode order amendments: %w", err)
		}
		if len(settlement) > 0 {
			if err := json.Unmarshal(settlement, &order.Settlement); err != nil {
				return nil, fmt.Errorf("decode order settlement: %w", err)
			}
		}
		if len(outcome) > 0 {
			if err := json.Unmarshal(outcome, &order.Outcome); err != nil {
				return nil, fmt.Errorf("decode order outcome: %w", err)
			}
		}
		result = append(result, order)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// ListOrdersByStore 按店查订单（STORE-STATS-001）。
func (r *FulfillmentRepository) ListOrdersByStore(ctx context.Context, storeID string) ([]fulfillment.Order, error) {
	if strings.TrimSpace(storeID) == "" {
		return []fulfillment.Order{}, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, requester_id, agent_id, need_id, lifecycle, version,
		       snapshot, amendments, settlement, outcome, created_at, updated_at, store_id, COALESCE(order_no, '')
		FROM fulfillment.orders
		WHERE store_id = $1
		ORDER BY created_at DESC`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []fulfillment.Order{}
	for rows.Next() {
		var order fulfillment.Order
		var snapshot, amendments, settlement, outcome []byte
		if err := rows.Scan(
			&order.ID, &order.RequesterID, &order.AgentID, &order.NeedID, &order.Lifecycle, &order.Version,
			&snapshot, &amendments, &settlement, &outcome, &order.CreatedAt, &order.UpdatedAt, &order.StoreID, &order.OrderNo,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(snapshot, &order.Snapshot); err != nil {
			return nil, fmt.Errorf("decode order snapshot: %w", err)
		}
		if err := json.Unmarshal(amendments, &order.Amendments); err != nil {
			return nil, fmt.Errorf("decode order amendments: %w", err)
		}
		if len(settlement) > 0 {
			if err := json.Unmarshal(settlement, &order.Settlement); err != nil {
				return nil, fmt.Errorf("decode order settlement: %w", err)
			}
		}
		if len(outcome) > 0 {
			if err := json.Unmarshal(outcome, &order.Outcome); err != nil {
				return nil, fmt.Errorf("decode order outcome: %w", err)
			}
		}
		result = append(result, order)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func encodeOrderJSON(order fulfillment.Order) ([]byte, []byte, []byte, []byte, error) {
	snapshot, err := json.Marshal(order.Snapshot)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode order snapshot: %w", err)
	}
	// 空集合写 []，不写 null（AGENTS.md：Empty wire collections are []）。
	orderAmendments := order.Amendments
	if orderAmendments == nil {
		orderAmendments = []fulfillment.Amendment{}
	}
	amendments, err := json.Marshal(orderAmendments)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode order amendments: %w", err)
	}
	var settlement, outcome []byte
	if order.Settlement != nil {
		settlement, err = json.Marshal(order.Settlement)
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("encode order settlement: %w", err)
		}
	}
	if order.Outcome != nil {
		outcome, err = json.Marshal(order.Outcome)
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("encode order outcome: %w", err)
		}
	}
	return snapshot, amendments, settlement, outcome, nil
}

var _ fulfillment.Repository = (*FulfillmentRepository)(nil)

// ListAudit 读一行订单 / 报价的审计轨迹（ORDER-AUDIT-001；表由触发器写入，只追加）。
func (r *FulfillmentRepository) ListAudit(ctx context.Context, table, rowID string) ([]fulfillment.AuditEntry, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT operation, COALESCE(old_state, ''), COALESCE(new_state, ''), COALESCE(old_version, 0), COALESCE(new_version, 0),
		       actor_id, command_type, event_types, override_reason, recorded_at
		FROM fulfillment.audit_log WHERE table_name=$1 AND row_id=$2 ORDER BY audit_id`, table, rowID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []fulfillment.AuditEntry{}
	for rows.Next() {
		var entry fulfillment.AuditEntry
		if err := rows.Scan(&entry.Operation, &entry.OldState, &entry.NewState, &entry.OldVersion, &entry.NewVersion,
			&entry.ActorID, &entry.CommandType, &entry.EventTypes, &entry.OverrideReason, &entry.RecordedAt); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

var _ fulfillment.AuditReader = (*FulfillmentRepository)(nil)

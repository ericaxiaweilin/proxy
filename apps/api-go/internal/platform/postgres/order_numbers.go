package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// OrderNumberAllocator 用 Postgres 序列 fulfillment.order_number_seq 分配全数字
// 订单编号（ORDER-NO-001，migrations/136）。序列全局、永不重置，履约订单与
// 活动报名共用 —— 多实例部署下也不会撞号。nextval 不随事务回滚，失败的下单
// 会留下空号，这是序列的正常语义（编号只要求唯一，不要求连续）。
type OrderNumberAllocator struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewOrderNumberAllocator(pool *pgxpool.Pool) *OrderNumberAllocator {
	return &OrderNumberAllocator{pool: pool, now: time.Now}
}

func (a *OrderNumberAllocator) Next(ctx context.Context) (string, error) {
	var sequence int64
	if err := queryerForContext(ctx, a.pool).QueryRow(ctx, `SELECT nextval('fulfillment.order_number_seq')`).Scan(&sequence); err != nil {
		return "", err
	}
	return ordernumber.Format(sequence, a.now()), nil
}

var _ ordernumber.Allocator = (*OrderNumberAllocator)(nil)

// OrderNumbers 让用 PG 仓库构造的 Service 默认就用序列分配器（不是进程内计数器）。
func (r *FulfillmentRepository) OrderNumbers() ordernumber.Allocator {
	return NewOrderNumberAllocator(r.pool)
}

func (r *ActivityRepository) OrderNumbers() ordernumber.Allocator {
	return NewOrderNumberAllocator(r.pool)
}

func (r *MarketplaceRepository) OrderNumbers() ordernumber.Allocator {
	return NewOrderNumberAllocator(r.pool)
}

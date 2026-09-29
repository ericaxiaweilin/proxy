package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// nextDailyOrderNumber 在调用方的事务（或连接）里原子取下一个订单编号（ORDER-NO-001）：
// 每个（类别码, 越南本地日期）一个计数器，ordering.daily_sequences 里
// INSERT ... ON CONFLICT ... RETURNING 一步取号。放在事务里就随事务回滚，不留空号；
// 同类别同一天的并发下单会在这一行上排队，编号不重复。
func nextDailyOrderNumber(ctx context.Context, q sqlQueryer, category string, now time.Time) (string, error) {
	if !ordernumber.Registered(category) {
		return "", ordernumber.ErrUnknownCategory
	}
	var seq int
	if err := q.QueryRow(ctx, `INSERT INTO ordering.daily_sequences (category, day, last_seq) VALUES ($1, $2, 1)
		ON CONFLICT (category, day) DO UPDATE SET last_seq = ordering.daily_sequences.last_seq + 1
		RETURNING last_seq`, category, ordernumber.Day(now).Format("2006-01-02")).Scan(&seq); err != nil {
		return "", err
	}
	return ordernumber.Format(category, now, seq), nil
}

// OrderNumberAllocator 用 ordering.daily_sequences 分配全数字订单编号。多实例部署下也不会
// 撞号。在命令事务里调用时（ctx 带事务）随事务提交 / 回滚。
type OrderNumberAllocator struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewOrderNumberAllocator(pool *pgxpool.Pool) *OrderNumberAllocator {
	return &OrderNumberAllocator{pool: pool, now: time.Now}
}

func (a *OrderNumberAllocator) Next(ctx context.Context, category string) (string, error) {
	return nextDailyOrderNumber(ctx, queryerForContext(ctx, a.pool), category, a.now())
}

var _ ordernumber.Allocator = (*OrderNumberAllocator)(nil)

// OrderNumbers 让用 PG 仓库构造的 Service 默认就用数据库计数器（不是进程内计数器）。
func (r *FulfillmentRepository) OrderNumbers() ordernumber.Allocator {
	return NewOrderNumberAllocator(r.pool)
}

func (r *ActivityRepository) OrderNumbers() ordernumber.Allocator {
	return NewOrderNumberAllocator(r.pool)
}

func (r *MarketplaceRepository) OrderNumbers() ordernumber.Allocator {
	return NewOrderNumberAllocator(r.pool)
}

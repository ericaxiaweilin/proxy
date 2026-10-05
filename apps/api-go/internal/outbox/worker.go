package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
)

type Delivery interface {
	Deliver(ctx context.Context, e event.DomainEvent) error
}

type LogDelivery struct{}

func (LogDelivery) Deliver(_ context.Context, e event.DomainEvent) error {
	return nil
}

type Worker struct {
	Repository  Repository
	Delivery    Delivery
	WorkerID    string
	BatchSize   int
	MaxAttempts int
	Clock       func() time.Time
	// MaxDeadLetterAge 覆盖 DefaultMaxDeadLetterAge（15 分钟）：超过这个年龄的
	// 死信只报数、不自动重放。0 = 用默认。
	MaxDeadLetterAge time.Duration
}

func (w Worker) RunOnce(ctx context.Context) (int, error) {
	if w.Repository == nil || w.Delivery == nil {
		return 0, fmt.Errorf("outbox worker dependencies are not configured")
	}
	if w.WorkerID == "" {
		w.WorkerID = "proxy-worker"
	}
	if w.BatchSize <= 0 {
		w.BatchSize = 50
	}
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 10
	}
	now := time.Now().UTC()
	if w.Clock != nil {
		now = w.Clock().UTC()
	}
	messages, err := w.Repository.Claim(ctx, w.WorkerID, w.BatchSize, now)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, message := range messages {
		if err := w.Delivery.Deliver(ctx, message.Event); err != nil {
			deadLetter := message.Attempts >= w.MaxAttempts
			nextAttemptAt := now.Add(backoff(message.Attempts))
			if markErr := w.Repository.MarkFailed(ctx, w.WorkerID, message.Event.EventID, err.Error(), nextAttemptAt, deadLetter); markErr != nil {
				return processed, markErr
			}
			continue
		}
		if err := w.Repository.MarkSent(ctx, w.WorkerID, message.Event.EventID, now); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

// DefaultMaxDeadLetterAge 是「还可以自动重放」的死信年龄上限。
//
// 15 分钟：这个窗口内的失败几乎都是临时基础设施问题（配置缺失、RLS、连接抖动、
// 一次部署），而 15 分钟前的「需求已发布」补发仍然说得过去。
//
// 再旧就不重放了：把 6 周前的通知塞进今天的收件箱**比不补发更糟** —— 那是一条
// 假的新消息，用户会去点一个已经不存在的需求。所以太旧的只报数（ReapDeadLetters
// 返回 stale），让人来决定。这是有意的取舍，不是还没做。
const DefaultMaxDeadLetterAge = 15 * time.Minute

// MaxDeadLetterReplayBatch 限制一次重放多少条：一条坏事件不该把 worker 的
// 一个 tick 吃掉。
const MaxDeadLetterReplayBatch = 50

// ReapDeadLetters 处理死信，两种命运（MERCHANT-CREATOR-NOTIFY-001）：
//
//	够新（occurred_at 不早于 now-MaxDeadLetterAge）→ 放回 PENDING 重新消费。
//	    这类失败几乎都是临时的，而收件箱的幂等 id 由事件 id 确定性推出，重放
//	    同一条事件只会撞 ON CONFLICT ⇒ **不可能**产生第二条通知。
//	太旧 → 不动，只报数。返回一个可告警的计数，而不是让它继续躺着没人知道。
//
// 为什么需要它：死信原来只有 3 处写、**0 处读**（migration 178 之前的实况是
// 本地库躺着 83 条 2026-08 的死信，全是 `OUTBOX_DELIVERY=unavailable` 那个
// kill-switch 开着时烧的）。投递失败会静默堆积 —— 而静默失败正是这次整件事的
// 根因。
//
// 死信行**不删**：重放留痕（replayed_at / replay_count，migration 178），
// 发生过什么要能查。
func (w Worker) ReapDeadLetters(ctx context.Context, now time.Time) (replayed int, stale int, err error) {
	if w.Repository == nil {
		return 0, 0, fmt.Errorf("outbox worker dependencies are not configured")
	}
	maxAge := w.MaxDeadLetterAge
	if maxAge <= 0 {
		maxAge = DefaultMaxDeadLetterAge
	}
	freshSince := now.UTC().Add(-maxAge)

	fresh, err := w.Repository.ListDeadLetters(ctx, freshSince, MaxDeadLetterReplayBatch)
	if err != nil {
		return 0, 0, err
	}
	if len(fresh) > 0 {
		ids := make([]string, 0, len(fresh))
		for _, message := range fresh {
			ids = append(ids, message.Event.EventID)
		}
		replayed, err = w.Repository.Replay(ctx, ids, now)
		if err != nil {
			return 0, 0, err
		}
	}

	// 太旧的：零值 = 不限时间，报数给人看。
	all, err := w.Repository.ListDeadLetters(ctx, time.Time{}, MaxDeadLetterReplayBatch*4)
	if err != nil {
		return replayed, 0, err
	}
	for _, message := range all {
		if message.Event.OccurredAt.Before(freshSince) {
			stale++
		}
	}
	return replayed, stale, nil
}

func backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	return time.Duration(1<<uint(attempt-1)) * time.Second
}

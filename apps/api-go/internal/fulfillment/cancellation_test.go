package fulfillment

import (
	"context"
	"testing"
	"time"
)

// ORDER-CANCEL-WINDOW-001（2026-10-05 用户定的规则）：
//
//	「这个订单没有执行 可以取消 不能取消的是执行中 执行完不可能取消
//	  执行前12h也不能取消 如果用户下单距离约定执行时间不足12h 那么取消时间就是5m
//	  这5m内可以取消 超过5m不能取消 适用于所有订单」
func TestCancellationDeadlineFollowsTheTwoBranches(t *testing.T) {
	created := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)

	t.Run("提前预约 ≥12h：窗口开到「执行前 12h」", func(t *testing.T) {
		// 约定 3 天后执行 → 截止点 = 执行前 12h = 2 天 12h 之后
		order := Order{
			CreatedAt: created,
			Snapshot:  OrderSnapshot{StartTime: created.Add(72 * time.Hour).Format(time.RFC3339)},
		}
		deadline, kind := cancellationDeadline(order)
		if kind != windowPlanned {
			t.Fatalf("kind = %q, want %q", kind, windowPlanned)
		}
		want := created.Add(72*time.Hour - plannedCancellationLead)
		if !deadline.Equal(want) {
			t.Fatalf("deadline = %v, want %v", deadline, want)
		}
		// 还没到 12h 之前 → 还能取消
		if open, _, _ := cancellationWindowOpen(order, created.Add(30*time.Hour)); !open {
			t.Fatal("30 小时后、还差 42 小时才到截止点，必须还能取消")
		}
		// 越过截止点 → 不能取消
		if open, _, _ := cancellationWindowOpen(order, want.Add(time.Second)); open {
			t.Fatal("过了「执行前 12h」必须锁死")
		}
	})

	t.Run("临期下单 <12h：窗口只有下单后 5 分钟", func(t *testing.T) {
		// 约定 2 小时后执行（不足 12h）→ 只能在下单后 5 分钟内取消
		order := Order{
			CreatedAt: created,
			Snapshot:  OrderSnapshot{StartTime: created.Add(2 * time.Hour).Format(time.RFC3339)},
		}
		deadline, kind := cancellationDeadline(order)
		if kind != windowLastMinute {
			t.Fatalf("kind = %q, want %q", kind, windowLastMinute)
		}
		if !deadline.Equal(created.Add(lastMinuteCancellationWindow)) {
			t.Fatalf("deadline = %v, want 下单后 5 分钟 %v", deadline, created.Add(lastMinuteCancellationWindow))
		}
		if open, _, _ := cancellationWindowOpen(order, created.Add(4*time.Minute)); !open {
			t.Fatal("4 分钟时必须还能取消")
		}
		if open, _, _ := cancellationWindowOpen(order, created.Add(5*time.Minute+time.Second)); open {
			t.Fatal("过了 5 分钟必须不能取消 —— 这条就是「临期单」的全部保护")
		}
	})

	t.Run("取不到执行时间：按最紧的窗口处理，不编一个日期", func(t *testing.T) {
		// 本地库 819 单里 114 单 startTime 是空串、6 单是 "10:00"（只有时分没日期）。
		// 猜一个日期会给真人订单编出不存在的截止时间，比不给更糟 → 走 5 分钟分支。
		for _, raw := range []string{"", "10:00", "   "} {
			order := Order{CreatedAt: created, Snapshot: OrderSnapshot{StartTime: raw}}
			deadline, kind := cancellationDeadline(order)
			if kind != windowUnknownTime {
				t.Fatalf("startTime=%q: kind = %q, want %q", raw, kind, windowUnknownTime)
			}
			if !deadline.Equal(created.Add(lastMinuteCancellationWindow)) {
				t.Fatalf("startTime=%q: deadline = %v, want 下单后 5 分钟", raw, deadline)
			}
		}
	})

	t.Run("恰好 12h：走提前预约分支（用户说的是「不足 12h」才收紧）", func(t *testing.T) {
		order := Order{
			CreatedAt: created,
			Snapshot:  OrderSnapshot{StartTime: created.Add(plannedCancellationLead).Format(time.RFC3339)},
		}
		_, kind := cancellationDeadline(order)
		if kind != windowPlanned {
			t.Fatalf("kind = %q, want %q（要更宽松就把 < 改成 <=，只动一处）", kind, windowPlanned)
		}
		// 后果要说清：恰好 12h 时截止点就是现在，等于刚下单就锁死。
		deadline, _ := cancellationDeadline(order)
		if !deadline.Equal(created) {
			t.Fatalf("deadline = %v, want %v", deadline, created)
		}
	})

	t.Run("执行时间已经过了：按字面规则仍走 5 分钟分支（不是额外发明一条规则）", func(t *testing.T) {
		// 补录/改期遗留会出现「执行时间在下单之前」的订单。用户说的是「距离约定执行
		// 时间**不足** 12h」→ -24h 当然也是不足 → 走 5 分钟窗口。
		//
		// 这里刻意**不加**「执行时间已过就一律不能取消」的规则：那是用户没说的另一条
		// 业务判断（这种订单本身是数据异常，该怎么处理是另一个话题）。测试把这个字面
		// 行为钉住，免得以后有人以为它是个 bug 而「顺手修掉」。
		order := Order{
			CreatedAt: created,
			Snapshot:  OrderSnapshot{StartTime: created.Add(-24 * time.Hour).Format(time.RFC3339)},
		}
		deadline, kind := cancellationDeadline(order)
		if kind != windowLastMinute {
			t.Fatalf("kind = %q, want %q", kind, windowLastMinute)
		}
		if !deadline.Equal(created.Add(lastMinuteCancellationWindow)) {
			t.Fatalf("deadline = %v, want 下单后 5 分钟", deadline)
		}
		if open, _, _ := cancellationWindowOpen(order, created.Add(time.Hour)); open {
			t.Fatal("过了 5 分钟仍然要锁死")
		}
	})
}

// 端到端：窗口真的把 cancelOrder 挡住 —— 只测 helper 不够，规则要落在命令上。
func TestCancelOrderIsBlockedOnceTheWindowCloses(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	if r := confirmAsAgent(s, orderID); r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r.Outcome)
	}
	// 窗口刚开（testOfferPayload 不带 startTime → 5 分钟分支），先确认还能取消
	if r := s.Handle(envelopeFor("CancelOrder", map[string]any{}, orderID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("窗口内必须还能取消: %+v", r.Error)
	}

	// 把订单的执行时间设成「早就该开始了」→ 窗口早关
	s2 := New()
	orderID2 := createOffer(t, s2)
	if r := confirmAsAgent(s2, orderID2); r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r.Outcome)
	}
	order, err := s2.repository.GetOrder(context.Background(), orderID2)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	// 临期下单（执行在 2 小时后，<12h → 5 分钟分支），但下单已经是 1 小时前
	// → 截止点在 55 分钟前，早就关了。
	//
	// ⚠️ 别把执行时间设成「过去」：过去的时间同样落在「不足 12h」分支里，于是截止点
	// 变成「下单后 5 分钟」，而测试是下单后立刻取消 —— 窗口还开着（这个行为由
	// TestCancellationDeadlineFollowsTheTwoBranches 的最后一个子测试钉住）。
	order.CreatedAt = time.Now().UTC().Add(-1 * time.Hour)
	order.Snapshot.StartTime = time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339)
	if err := s2.repository.UpdateOrder(context.Background(), order, order.Version); err != nil {
		t.Fatalf("update order: %v", err)
	}
	r := s2.Handle(envelopeFor("CancelOrder", map[string]any{}, orderID2))
	if r.Outcome != "REJECTED" {
		t.Fatalf("窗口关了必须拒绝取消，got %s", r.Outcome)
	}
	if r.Error.ErrorCode != "ORDER_CANCELLATION_WINDOW_CLOSED" {
		t.Fatalf("want ORDER_CANCELLATION_WINDOW_CLOSED, got %s", r.Error.ErrorCode)
	}
	// 拒绝时必须带上截止点和分支，否则用户只会当成 bug
	details := r.Error.SafeDetails
	if _, ok := details["cancelUntil"]; !ok {
		t.Fatalf("拒绝必须带 cancelUntil 回去: %+v", details)
	}
	if _, ok := details["windowKind"]; !ok {
		t.Fatalf("拒绝必须带 windowKind 回去: %+v", details)
	}
}

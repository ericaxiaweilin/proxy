package outbox

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
)

// MERCHANT-CREATOR-NOTIFY-001：死信不是「写进去就算完」—— 够新的要能回来，
// 太旧的不能回来。
//
// 为什么必须做：死信原来 3 处写、**0 处读**，本地库躺着 83 条 2026-08 的死信
// （`OUTBOX_DELIVERY=unavailable` 那个 kill-switch 开着时烧的），没人知道、没人管。
// 而静默失败正是这次整件事的根因。
func TestReapDeadLettersReplaysRecentButRefusesStale(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	// 必须用**真实**时钟的相对值：Claim 拿的是 time.Now()，fixture 若写死
	// 一个未来的时刻，消息的 available_at 就在「将来」，永远领不到（那次
	// fixture 就是这么安静地什么都没做 —— RunOnce 返回 0，没有任何报错）。
	now := time.Now().UTC()

	// 三条死信：2 分钟前（够新）、3 小时前（太旧）、3 周前（太旧）。
	fresh := deadLetterFixture(t, repo, "evt_fresh", now.Add(-2*time.Minute))
	mid := deadLetterFixture(t, repo, "evt_mid", now.Add(-3*time.Hour))
	ancient := deadLetterFixture(t, repo, "evt_ancient", now.Add(-21*24*time.Hour))

	w := Worker{Repository: repo, Delivery: failingDelivery{}}
	replayed, stale, err := w.ReapDeadLetters(ctx, now)
	if err != nil {
		t.Fatalf("ReapDeadLetters: %v", err)
	}
	if replayed != 1 || stale != 2 {
		t.Fatalf("replayed=%d stale=%d, want 1/2 — 只有够新的那条能回来", replayed, stale)
	}

	// 够新的那条必须真的能再被消费（attempts 清零是关键：不清零的话
	// RunOnce 会用「attempts >= MaxAttempts」把它立刻再判成死信 → 无限循环）。
	byID := map[string]Message{}
	for _, m := range repo.Snapshot() {
		byID[m.Event.EventID] = m
	}
	if got := byID[fresh]; got.Status != StatusPending || got.Attempts != 0 {
		t.Fatalf("replayed message = status %q attempts %d, want PENDING/0", got.Status, got.Attempts)
	}
	if got := byID[fresh]; got.ReplayCount != 1 || got.ReplayedAt == nil {
		t.Fatalf("replay must be auditable: count=%d at=%v", got.ReplayCount, got.ReplayedAt)
	}
	// 失败的原始原因必须留着：重放是「再试一次」，不是抹掉发生过的事。
	if byID[fresh].LastError == "" {
		t.Fatal("replay must not erase last_error — 那是失败原因的证据")
	}
	for _, id := range []string{mid, ancient} {
		if got := byID[id]; got.Status != StatusDeadLetter {
			t.Fatalf("%s must stay DEAD_LETTER — 补发几周前的通知比不补发更糟", id)
		}
	}

	// 重放出来的那条真的能被消费掉。
	ok := Worker{Repository: repo, Delivery: noopDelivery{}}
	if _, err := ok.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	for _, m := range repo.Snapshot() {
		if m.Event.EventID == fresh && m.Status != StatusSent {
			t.Fatalf("replayed message must reach SENT after a successful delivery, got %q", m.Status)
		}
	}
}

// 太旧的那条如果被重放，会把「3 周前的需求已发布」塞进今天的收件箱 ——
// 那是一条假的新消息。这条钉住「宁可漏发也不发假的」。
func TestReapDeadLettersNeverResurrectsBeyondMaxAge(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	now := time.Now().UTC()
	deadLetterFixture(t, repo, "evt_old", now.Add(-90*24*time.Hour))

	w := Worker{Repository: repo, Delivery: failingDelivery{}, MaxDeadLetterAge: 15 * time.Minute}
	replayed, stale, err := w.ReapDeadLetters(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if replayed != 0 || stale != 1 {
		t.Fatalf("replayed=%d stale=%d, want 0/1", replayed, stale)
	}
}

func deadLetterFixture(t *testing.T, repo *MemoryRepository, eventID string, occurredAt time.Time) string {
	t.Helper()
	e := event.New("ProbePublished", "Probe", eventID, 1, "u1", "corr", "cmd", occurredAt, map[string]any{})
	e.EventID = eventID
	if err := repo.Publish(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	// MaxAttempts=1 ⇒ 第一次失败就直接判死信。（循环跑多次是**跑不通**的：
	// MarkFailed 把 available_at 设成 now+backoff，而 Claim 只取 available_at<=now
	// 的消息，紧循环里时钟不动 ⇒ 第二轮就再也领不到这条 —— repository_test.go 用
	// 固定时钟 + MaxAttempts=1 也是这个原因。）
	w := Worker{Repository: repo, Delivery: failingDelivery{}, MaxAttempts: 1}
	if _, err := w.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, m := range repo.Snapshot() {
		if m.Event.EventID == eventID && m.Status == StatusDeadLetter {
			return eventID
		}
	}
	t.Fatalf("%s never reached DEAD_LETTER — the fixture is broken, not the reaper", eventID)
	return ""
}

// failingDelivery 在 repository_test.go 里已定义，这里直接复用。
// noopDelivery = 成功投递，用来验证重放出来的那条能真的走到 SENT。
type noopDelivery struct{}

func (noopDelivery) Deliver(context.Context, event.DomainEvent) error { return nil }

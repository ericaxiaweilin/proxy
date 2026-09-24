package conversation

import (
	"context"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// AI-MANAGE-014：全自动代回复按本人设置的「节奏」延迟发出，不在发消息的请求里同步秒回。
//
// AI 管理 → 对话管理 → 节奏（chat_rhythm）：秒回 / 延迟 3-5 秒 / 延迟 10-30 秒 / 随机。
// 之前这个设置存了但会话侧不读：代回复永远在对方点发送的同一个请求里回来 ——
// 既不像真人，也让发消息的人一直等模型（请求挂着十几秒）。现在：
//   - 秒回（或没读到节奏）：保持原样，请求里直接回（RESPONDED + aiMessage）；
//   - 其余：请求立刻返回 SCHEDULED（发消息的人那边就是「对方还没回」，
//     客户端未知状态保持沉默），到点后在后台以本人身份发出，对方靠轮询收到；
//   - 等待期间对方又发了一条：只回最新那条（一次回复看完整上下文），旧的计划作废；
//   - 等待期间本人自己回了、或者把代回复暂停 / 关掉 / 改成每次确认：到点不发。
// 计划存在进程内存里：服务重启会丢掉还没到点的代回复（发消息的人看到的是「对方没回」，
// 不会错发）。要跨重启可靠，需要挪到 worker 队列 —— 本次不做。

// StandInScheduler 在 delay 之后执行 run。nil = 用 time.AfterFunc。测试注入可控版本。
type StandInScheduler func(delay time.Duration, run func())

// SetStandInScheduler 替换代回复的延迟执行器（测试用）。
func (s *Service) SetStandInScheduler(scheduler StandInScheduler) {
	s.standInScheduler = scheduler
}

type standInPlanner struct {
	mu     sync.Mutex
	latest map[string]string // conversationID -> 最新一次计划的触发消息 ID
}

func (p *standInPlanner) mark(conversationID, triggerID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.latest == nil {
		p.latest = make(map[string]string)
	}
	p.latest[conversationID] = triggerID
}

// claim 只有「这仍是该会话最新的计划」时返回 true，并清掉记录。
func (p *standInPlanner) claim(conversationID, triggerID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.latest[conversationID] != triggerID {
		return false
	}
	delete(p.latest, conversationID)
	return true
}

// standInDelay 把节奏设置换成这一次的等待时长；0 = 秒回（同步）。
func standInDelay(rhythm string, rng func(n int64) int64) time.Duration {
	between := func(minSeconds, maxSeconds int64) time.Duration {
		return time.Duration(minSeconds*1000+rng((maxSeconds-minSeconds)*1000+1)) * time.Millisecond
	}
	switch rhythm {
	case "human_3_5":
		return between(3, 5)
	case "human_10_30":
		return between(10, 30)
	case "random":
		// 时快时慢：大多数几秒到半分钟，偶尔一两分钟。
		if rng(5) == 0 {
			return between(60, 120)
		}
		return between(2, 30)
	default: // instant / 没读到
		return 0
	}
}

func defaultStandInRng(n int64) int64 {
	if n <= 0 {
		return 0
	}
	return rand.Int63n(n)
}

// scheduleStandInReply 按节奏安排一次代回复。返回 false = 节奏是秒回，调用方照旧同步回。
func (s *Service) scheduleStandInReply(conv Conversation, e command.Envelope, standIn aiStandIn, triggerID, userText, assistantMode string, quote *ReplyQuote) bool {
	delay := standInDelay(standIn.State.Rhythm, defaultStandInRng)
	if delay <= 0 {
		return false
	}
	s.standInPlans.mark(conv.ID, triggerID)
	s.runStandInJob(delay, func() { s.runScheduledStandIn(conv.ID, e, triggerID, userText, assistantMode, quote) })
	log.Printf("conversation ai: stand-in reply scheduled owner=%s conv=%s in %s (AI-MANAGE-014)", standIn.Owner, conv.ID, delay)
	return true
}

// runScheduledStandIn 到点执行：不持有 s.mu（请求早已返回），只经仓储读写。
func (s *Service) runScheduledStandIn(conversationID string, e command.Envelope, triggerID, userText, assistantMode string, quote *ReplyQuote) {
	if !s.standInPlans.claim(conversationID, triggerID) {
		return // 对方又发了新消息，由最新那次计划回
	}
	ctx := context.Background()
	conv, err := s.repository.GetConversation(ctx, conversationID)
	if err != nil || conv.State != "ACTIVE" {
		return
	}
	// 设置在等待期间可能改了：重新判定，只有仍是全自动才发。
	standIn := s.aiStandInFor(ctx, conv, e.Actor.ID, assistantMode)
	if standIn.Owner == "" || standIn.Blocked {
		return
	}
	// 本人在等待期间自己回了：不再代回。
	if s.spokeAfter(ctx, conversationID, triggerID, standIn.Owner) {
		return
	}
	if s.modelStack == nil || !s.modelStack.Available() {
		return
	}
	reply, _, _ := s.generateAIReplyInternal(withStandIn(ctx, standIn), conv, e, userText, assistantMode, nil, quote, true)
	if reply == nil || strings.TrimSpace(reply.Body) == "" {
		log.Printf("conversation ai: scheduled stand-in reply produced nothing owner=%s conv=%s", standIn.Owner, conversationID)
	}
}

// spokeAfter：触发消息之后，speakerID 有没有在这个会话里说过话。读不出来按「说过」处理 ——
// 宁可这次不代回，也不在本人已经回过之后再替 TA 说一遍。
func (s *Service) spokeAfter(ctx context.Context, conversationID, triggerID, speakerID string) bool {
	messages, err := s.repository.Messages(ctx, conversationID)
	if err != nil {
		return true
	}
	seen := false
	for _, m := range messages {
		if m.ID == triggerID {
			seen = true
			continue
		}
		if seen && m.DeletedAt == nil && m.SenderID == speakerID {
			return true
		}
	}
	return false
}

// runStandInJob 在请求之外执行（起草 / 代回复都不能让发消息的人等模型）。
func (s *Service) runStandInJob(delay time.Duration, job func()) {
	if s.standInScheduler != nil {
		s.standInScheduler(delay, job)
		return
	}
	if delay <= 0 {
		go job()
		return
	}
	time.AfterFunc(delay, job)
}

// SetOrderPermission 接上「有没有接单权限」的查询（ORDER-PERMISSION-TWIN-001）：没有就不代回复。
// 不接 = 老行为（测试 / 无库环境）；生产在 main.go 必须接（回归钉 ORDER-PERMISSION-TWIN-001 守着）。
func (s *Service) SetOrderPermission(check func(ctx context.Context, userAccountID string) (bool, error)) {
	s.orderPermission = check
}

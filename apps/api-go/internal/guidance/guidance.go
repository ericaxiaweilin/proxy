// Package guidance 是「引导下单、引导发帖」：告诉用户下一步最该做什么，并在合适的时候推一次。
//
// 两条原则：
//   - 只说事实、只引导**还没做过的**事（"还没发过动态"），不夸张、不许诺奖励——奖励规则是产品决定，
//     没有定义之前这里不出现任何"领取 / 奖励"字样；
//   - 推送节制：每种引导对每个人**终身最多一次**（靠通知的 DedupeKey 保证幂等），且两种引导的时间窗
//     错开（注册后 1~7 天、3~10 天），不会同一天连发；被限制的账号不推。
package guidance

import (
	"context"
	"time"
)

// 引导的目标（App 把它映射成页面跳转）。服务端只给标识，不给 App 内部路由。
const (
	TargetEditProfile  = "EDIT_PROFILE"
	TargetComposePost  = "COMPOSE_POST"
	TargetPublishNeed  = "PUBLISH_DEMAND"
	TargetBrowseEvents = "BROWSE_ACTIVITIES"
)

// Step 是一个下一步。
type Step struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Reason string `json:"reason"`
	Target string `json:"target"`
	Done   bool   `json:"done"`
}

// State 是一个人到现在为止做过什么（全是真实计数）。
type State struct {
	ProfileComplete  bool
	Posts            int
	Demands          int // 发布过的需求 + 作为需求方下过的单
	ActivitiesJoined int
}

// BuildSteps 把状态变成有序的步骤；已完成的也在列表里（App 可以画进度），Done=true。
// 顺序就是引导的优先级：先资料（发帖和发单都要先完善资料），再发帖，再发需求，最后参加活动。
func BuildSteps(s State) []Step {
	return []Step{
		{ID: "complete_profile", Title: "完善资料", Reason: "发动态和发需求都需要先有名字和头像", Target: TargetEditProfile, Done: s.ProfileComplete},
		{ID: "first_post", Title: "发第一条动态", Reason: "你还没发过动态", Target: TargetComposePost, Done: s.Posts > 0},
		{ID: "first_demand", Title: "发布第一个需求", Reason: "你还没发过需求", Target: TargetPublishNeed, Done: s.Demands > 0},
		{ID: "join_activity", Title: "参加一个活动", Reason: "你还没参加过活动", Target: TargetBrowseEvents, Done: s.ActivitiesJoined > 0},
	}
}

// NextStep 返回第一个没完成的步骤；全完成返回 nil。
func NextStep(steps []Step) *Step {
	for i := range steps {
		if !steps[i].Done {
			return &steps[i]
		}
	}
	return nil
}

// Nudge 是一种定时推送：注册后多久进入窗口、多久后不再推，以及推什么。
type Nudge struct {
	Key      string // 终身一次的幂等键的一部分，也是通知 Type 的后缀
	MinAge   time.Duration
	MaxAge   time.Duration
	Title    string
	Body     string
	Target   string
	StepDone func(State) bool // 已经做过就不推
}

// Nudges 是目前的两种推送。窗口错开：发帖引导在注册后 1~7 天，发需求引导在 3~10 天。
var Nudges = []Nudge{
	{Key: "FIRST_POST", MinAge: 24 * time.Hour, MaxAge: 7 * 24 * time.Hour, Title: "发出你的第一条动态", Body: "还没发过动态", Target: TargetComposePost,
		StepDone: func(s State) bool { return s.Posts > 0 }},
	{Key: "FIRST_DEMAND", MinAge: 72 * time.Hour, MaxAge: 10 * 24 * time.Hour, Title: "发布你的第一个需求", Body: "还没发过需求", Target: TargetPublishNeed,
		StepDone: func(s State) bool { return s.Demands > 0 }},
}

// Source 是读状态与候选人的存储。
type Source interface {
	LoadState(ctx context.Context, userID string) (State, error)
	// Candidates 返回在 [now-maxAge, now-minAge] 内注册、账号正常的用户 id（最多 limit 个）。
	Candidates(ctx context.Context, now time.Time, minAge, maxAge time.Duration, limit int) ([]string, error)
}

// Emitter 是发通知的最小接口（notification.Pipeline 满足它的 Emit，组合根做适配）。
type Emitter interface {
	Nudge(ctx context.Context, userID, nudgeKey, title, body, target string) error
}

// RestrictedFn 报告某人是否被限制（被限制的账号不推）。
type RestrictedFn func(ctx context.Context, userID string) bool

// RunNudges 跑一轮推送，返回每种推送实际发出的条数。单个用户读状态失败只跳过这个人。
func RunNudges(ctx context.Context, src Source, out Emitter, restricted RestrictedFn, now time.Time, perNudgeLimit int) (map[string]int, error) {
	sent := map[string]int{}
	for _, n := range Nudges {
		ids, err := src.Candidates(ctx, now, n.MinAge, n.MaxAge, perNudgeLimit)
		if err != nil {
			return sent, err
		}
		for _, id := range ids {
			if restricted != nil && restricted(ctx, id) {
				continue
			}
			st, err := src.LoadState(ctx, id)
			if err != nil || !st.ProfileComplete || n.StepDone(st) {
				// 资料没完善的人先不推「发帖」——他点进去会被资料门拦住；完善资料由首页的下一步卡片引导。
				continue
			}
			if err := out.Nudge(ctx, id, n.Key, n.Title, n.Body, n.Target); err != nil {
				return sent, err
			}
			sent[n.Key]++
		}
	}
	return sent, nil
}

// Package identitytier：身份成长体系（铜 / 银 / 金 / 铂 × 1–3 星）。积分 → 等级是纯函数，等级不单独存。
// 「我的权益」（internal/growth）就是这套体系的展示面：它读这里的阶梯和积分账本，不另算一份。
//
// 固定部分：等级阶梯和积分赚取规则（代码里）。不固定的奖励活动（咖啡券等）在 incentive.rules：
// 按分数、在时间窗口里由运营开启。积分不是钱，不能提现。
package identitytier

type Kind string

const (
	User     Kind = "USER"
	Provider Kind = "PROVIDER"
	Merchant Kind = "MERCHANT"
)

func Kinds() []Kind { return []Kind{User, Provider, Merchant} }

func Valid(k Kind) bool {
	for _, x := range Kinds() {
		if x == k {
			return true
		}
	}
	return false
}

type Step struct {
	Tier  string `json:"tier"` // BRONZE | SILVER | GOLD | PLATINUM
	Name  string `json:"name"` // 铜 / 银 / 金 / 铂
	Stars int    `json:"stars"`
	Min   int    `json:"min"` // 到这一级需要的积分
}

// 用户 / 小美共用同一条阶梯：4 档 × 3 星 = 12 级，每档起点和「我的权益」原来的档位一致（0 / 500 / 1000 / 2000）。
var ladder = []Step{
	{"BRONZE", "铜", 1, 0}, {"BRONZE", "铜", 2, 150}, {"BRONZE", "铜", 3, 300},
	{"SILVER", "银", 1, 500}, {"SILVER", "银", 2, 650}, {"SILVER", "银", 3, 800},
	{"GOLD", "金", 1, 1000}, {"GOLD", "金", 2, 1300}, {"GOLD", "金", 3, 1600},
	{"PLATINUM", "铂", 1, 2000}, {"PLATINUM", "铂", 2, 2500}, {"PLATINUM", "铂", 3, 3000},
}

// 商家：我们对商家不抽成，软件里也不给商家发激励。商家如果要有等级，就是 1–5 星，
// 每一星的积分门槛按指数拉开（×3），奖励在线下（比如以后按资格邀请参加公司聚餐），不在软件里发。
// 积分怎么赚（核销 / 办活动 / 评价…）还没定，EarnRules(Merchant) 为空——不编。
var merchantLadder = []Step{
	{"STAR", "星", 1, 0}, {"STAR", "星", 2, 100}, {"STAR", "星", 3, 300}, {"STAR", "星", 4, 900}, {"STAR", "星", 5, 2700},
}

func Ladder(k Kind) []Step {
	if k == Merchant {
		return append([]Step(nil), merchantLadder...)
	}
	return append([]Step(nil), ladder...)
}

type Level struct {
	Step
	Points  int   `json:"points"`
	Next    *Step `json:"next,omitempty"`   // 满级为空
	ToNext  int   `json:"toNext,omitempty"` // 距离下一级还差多少分
	Highest bool  `json:"highest"`
}

// Resolve：积分 → 当前等级。负数当 0。
func Resolve(k Kind, points int) Level {
	if points < 0 {
		points = 0
	}
	l := Ladder(k)
	idx := 0
	for i, s := range l {
		if points >= s.Min {
			idx = i
		}
	}
	out := Level{Step: l[idx], Points: points, Highest: idx == len(l)-1}
	if !out.Highest {
		next := l[idx+1]
		out.Next = &next
		out.ToNext = next.Min - points
	}
	return out
}

// 固定的积分赚取规则（用户）。reason 是账本里的原因码；每条在账本里按 (reason, ref) 只算一次。
type EarnRule struct {
	Reason string `json:"reason"`
	Label  string `json:"label"`
	Points int    `json:"points"`
}

func EarnRules(k Kind) []EarnRule {
	if k != User {
		return []EarnRule{} // 小美 / 商家的赚分规则还没定，不编
	}
	return []EarnRule{
		{"PROFILE_COMPLETE", "完善资料（头像 + 昵称）", 30},
		{"POST_PUBLISHED", "发布一条帖文（每天最多算 3 条）", 5},
		{"ACTIVITY_JOINED", "参加一场活动", 30},
		{"ORDER_COMPLETED", "完成一笔订单", 50},
	}
}

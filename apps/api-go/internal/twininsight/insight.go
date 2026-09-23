// Package twininsight 是 AI 分身「好友洞察」的读模型（TWIN-INSIGHT-002）。
//
// 为什么是一个独立包，而不是塞进 localnet / relationship / engagement 任意一家：
// 这条洞察是**跨域合成**——好友关系（relationship）+ 主页访问与媒体停留
// （localnet）+ 消息（conversation）+ 点赞（engagement）。没有任何一个域拥有
// 「这个好友值不值得运营」这个问题，所以它需要一个读模型包；让 localnet 去
// 认识「好友」这个概念是明确不行的（localnet/service.go 写死了它不该认识）。
//
// 契约的单一事实源：packages/contracts/src/twin-insight.ts。
// 本包结构体的 json tag 必须与之一致 —— 客户端 Zod 解析失败会 fail-closed
// 抛错并展示重试，不会静默降级成空列表。
//
// 数据真实性（2026-09-22，用户：「数据也不是真的」）：
// 本包**不产生任何虚构数据**。四个信号全部来自真实事件表；没有数据就是 0，
// 没有好友就是空态。原先的 twin-insight-demo.ts（6 个编造的好友 Alex/Tom/
// Minh/Brandon/陈先生/王老板 + 编造的分数、建议、对话摘要）已随本次改动删除。
//
// 关于 advices / summaryText 的诚实性边界：
// 这两块文字是**规则推导**的，不是 LLM 生成的。所以它们只陈述可核对的事实
// （「7 天访问 3 次，其中 0 条对话」），不写任何原型里那种主观判断
// （「他可能只是路过或对你有过一次好奇」）—— 把规则输出包装成"AI 读心"
// 就是换一种方式编数据。真正的 LLM 摘要走 modelstack（见 summary:refresh），
// 底座未配置时 fail-closed 报错，绝不退化成本地假结果（modelstack/port.go 的
// ErrUnconfigured 就是为这条原则设的）。
package twininsight

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/proxy-app/proxy-api/internal/clock"
)

// Window 是洞察的行为信号窗口。契约把 window 写在 query string 上（?window=7d），
// v1 只认 7 天；窗口变了是产品决定，不是客户端参数。
const Window = 7 * 24 * time.Hour

// Signal / Verdict 的取值必须与契约的 enum 完全一致。
type Signal string

const (
	SignalHot  Signal = "hot"
	SignalWarm Signal = "warm"
	SignalCold Signal = "cold"
	SignalNew  Signal = "new"
)

type Verdict string

const (
	VerdictWorth Verdict = "worth"
	VerdictWatch Verdict = "watch"
	VerdictSkip  Verdict = "skip"
	VerdictNew   Verdict = "new"
)

// Signals 是 7 天行为信号的四个计数。全部来自真实事件，缺数据 = 0。
type Signals struct {
	Views7d    int `json:"views7d"`
	Messages7d int `json:"messages7d"`
	AvgStaySec int `json:"avgStaySec"`
	Likes7d    int `json:"likes7d"`
}

// Empty 表示这个好友在窗口内没有任何可观测行为。
func (s Signals) Empty() bool {
	return s.Views7d == 0 && s.Messages7d == 0 && s.AvgStaySec == 0 && s.Likes7d == 0
}

type Advice struct {
	Type string `json:"type"` // good | info | warn
	Text string `json:"text"`
}

type TimelineItem struct {
	Text string `json:"text"`
	Time string `json:"time"`
	Gray bool   `json:"gray"`
}

// Insight 是单个好友的洞察。字段顺序/命名对齐契约，不多不少。
type Insight struct {
	TargetID     string         `json:"targetId"`
	DisplayName  string         `json:"displayName"`
	Initial      string         `json:"initial"`
	AvatarURL    string         `json:"avatarUrl"`
	Signal       Signal         `json:"signal"`
	Verdict      Verdict        `json:"verdict"`
	VerdictLabel string         `json:"verdictLabel"`
	SummaryHint  string         `json:"summaryHint"`
	Score        int            `json:"score"`
	Signals      Signals        `json:"signals"`
	Advices      []Advice       `json:"advices"`
	SummaryText  string         `json:"summaryText"`
	Timeline     []TimelineItem `json:"timeline"`
}

// Thresholds 是阈值快照。operateAt/observeAt 复用 FacetConfig 的
// PriorityHighBoundary / PriorityMidBoundary（60 / 30），语义同源：
// 「高分优先处理」这条线在 Facet 和分身洞察里是同一条，不另起一套。
// 客户端只做 band 判定，不自定 verdict —— 阈值变化不发版。
type Thresholds struct {
	OperateAt     int `json:"operateAt"`
	ObserveAt     int `json:"observeAt"`
	ConfigVersion int `json:"configVersion"`
}

type Payload struct {
	TwinID       string     `json:"twinId"`
	Insights     []Insight  `json:"insights"`
	TotalTargets int        `json:"totalTargets"`
	Thresholds   Thresholds `json:"thresholds"`
}

// ---------------------------------------------------------------------------
// 数据来源
// ---------------------------------------------------------------------------

// SignalFact 是某个 actor 对 owner 内容的行为聚合（窗口内）。
// 只带事实，不带判断 —— 判断在 Service 里，用纯函数做，可单测。
type SignalFact struct {
	ActorID string
	// Views7d: 该 actor 打开 owner 主页的次数（PROFILE_OPEN，target=owner）。
	Views7d int
	// Messages7d: 该 actor 与 owner 之间的消息条数（双向都算）。
	Messages7d int
	// DwellOpens / TotalWatchMs: 该 actor 在 owner 媒体上的曝光次数与累计停留。
	// AvgStaySec 由这两个算出，不在 SQL 里做除法（避免整数除法丢精度）。
	DwellOpens   int
	TotalWatchMs int64
	// Likes7d: 该 actor 对 owner 帖子的点赞/收藏次数。
	Likes7d int
	// LastSignalAt: 该 actor 最近一次可观测行为的时间（四路取最大）。
	// 零值 = 窗口内没有任何行为。
	LastSignalAt time.Time
}

// AvgStaySec 把累计停留换算成平均秒数。曝光 0 次 → 0 秒（不是除零）。
func (f SignalFact) AvgStaySec() int {
	if f.DwellOpens <= 0 || f.TotalWatchMs <= 0 {
		return 0
	}
	return int(f.TotalWatchMs / int64(f.DwellOpens) / 1000)
}

// RecentEvent 是时间线用的一条明细。Kind 决定文案，At 决定相对时间。
type RecentEvent struct {
	ActorID string
	Kind    EventKind
	// ByOwner 为 true 表示这条是 owner 自己做的（「你发了一条消息」），
	// false 表示对方做的（「他访问了你的主页」）。时间线必须区分方向 ——
	// 把 owner 自己的行为算成对方的兴趣就是编数据。
	ByOwner bool
	At      time.Time
}

type EventKind string

const (
	EventProfileOpen EventKind = "PROFILE_OPEN"
	EventLike        EventKind = "LIKE"
	EventMessage     EventKind = "MESSAGE"
)

// Facts 是一次读取的全部原料。
type Facts struct {
	Signals []SignalFact
	Events  []RecentEvent
}

// Repository 是读侧的唯一依赖。两个实现（memory + postgres）都必须接上 ——
// 可选接口一旦没人实现，就又会变成「UI 有、服务端没有」的静默降级，
// 正是这次要修的病（见 localnet/service.go 里同类注释）。
type Repository interface {
	ListFacts(ctx context.Context, ownerID string, since time.Time) (Facts, error)
}

// Friend 是洞察的目标集元素。由 relationship 域提供，本包不查好友表。
type Friend struct {
	UserID      string
	DisplayName string
	Since       time.Time
}

type FriendSource interface {
	ListActiveFriends(ctx context.Context, userID string) ([]Friend, error)
}

// ThresholdSource 由 facet config 提供（见 Thresholds 的注释）。
type ThresholdSource func(ctx context.Context) (Thresholds, error)

// DisplayNameSource 把账号 id 解析成展示名，给**非好友**目标用 ——
// 好友的名字由 FriendSource 自带，只有 facts 里冒出来的陌生互动者才需要现查。
// nil = 没接 = 显示名回落成账号 id（buildInsight 的既有兜底，契约要求
// displayName min 1，不断整屏）。生产接线见 cmd/api/main.go。
type DisplayNameSource func(ctx context.Context, userID string) (string, bool)

// AvatarSource 把账号 id 解析成 identity.profiles.avatar_path（TWIN-INSIGHT-AVATAR-001）。
// nil = 没接 = avatarUrl 恒空串，客户端走首字回退 —— 与原先写死 "" 行为一致，
// 不会因为没接线就多出一个必 404 的坏 URL。生产接线见 cmd/api/main.go。
type AvatarSource func(ctx context.Context, userID string) (string, bool)

// WireAvatarURL 把 profile 的 avatar_path 翻成 wire 上的 avatarUrl。
//
// assets/<id> → /v1/media/thumb/<id>（客户端 resolveMediaUrl 拼 base）；
// 已是 / 开头的服务端路径或 http(s) 绝对地址原样透出；
// store/ photo_ ai-personas/ 等认不出的前缀返回空串 —— 拼一个必 404 的图
// 比首字回退更糟（messages.resolveAvatarSource 同一条原则）。
func WireAvatarURL(avatarPath string) string {
	trimmed := strings.TrimSpace(avatarPath)
	if trimmed == "" {
		return ""
	}
	if id, ok := strings.CutPrefix(trimmed, "assets/"); ok {
		if id == "" {
			return ""
		}
		return "/v1/media/thumb/" + id
	}
	if strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	return ""
}

// ViewerGate 判定某账号能不能用好友洞察这套工具。
//
// 这不是"有没有分身"（那是各段自己的解析），也不是"成年没有"（那是
// companionGate）—— 这是"后端有没有给你发这个功能"。洞察是撮合小美/小帅、
// 卖小美合法时间的精准投流工具，只向已实名绑定的创作者开放；普通用户
// 调这个接口没有任何意义。nil = 没接 = 一律拒绝（fail-closed），
// 生产接线见 cmd/api/main.go（实名核验 VERIFIED 行就是发放凭证）。
type ViewerGate func(ctx context.Context, ownerID string) error

// ErrInsightViewerForbidden 表示这个账号没有洞察工具的使用权。
// 翻成 403 + 可区分的 code，客户端照实说"仅向认证创作者开放"，
// 不许折叠成"服务坏了"（重试永远没用）或"未成年"（那是另一道门）。
var ErrInsightViewerForbidden = fmt.Errorf("twininsight: insight tool is not granted to this account")

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type Service struct {
	repo       Repository
	friends    FriendSource
	thresholds ThresholdSource
	now        func() time.Time
	names      DisplayNameSource
	// avatars 是目标头像（identity.profiles.avatar_path）解析。nil = 没接 = avatarUrl 空串。
	avatars AvatarSource
	// viewerGate 是洞察工具的使用权门禁（TWIN-INSIGHT-ENTITLEMENT-001）。
	// nil = 没接 = 读和写一律拒绝。注意它跟 companionGate 是两道门：
	// companionGate 回答"成年没有"，viewerGate 回答"有没有发你这个工具"。
	viewerGate ViewerGate
	// actions 是运营动作的审计落点。nil = 没接 = 写路径一律拒绝 ——
	// 一个"点了按钮但没留痕"的运营动作，事后无法回答"谁在什么时候
	// 对谁开了单独运营"，那正是 PRD §1 第 6 条要求必须能答的。
	actions ActionLog
	// companionGate 是未成年人门禁（COMP-AI-MINOR-001）。nil = 没接 = 拒绝。
	companionGate CompanionGate
	// summaries 是「重新总结」的模型调用。nil = 没接 = 该端点 fail-closed
	// （见 summary.go：绝不退化成规则拼句子冒充模型输出）。
	summaries SummaryGenerator
}

func New(repo Repository, friends FriendSource, thresholds ThresholdSource) *Service {
	return &Service{repo: repo, friends: friends, thresholds: thresholds, now: clock.System{}.Now}
}

// SetClock 只给测试用；生产走 clock.System。
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// SetActionLog 接上运营动作审计。不接则 RecordOperate 一律拒绝。
func (s *Service) SetActionLog(log ActionLog) { s.actions = log }

// SetCompanionGate 接上未成年人门禁。不接则 RecordOperate 一律拒绝 ——
// 与 aipersona 的立场一致：宁可关掉这个动作，也不对未成年人开放。
func (s *Service) SetCompanionGate(gate CompanionGate) { s.companionGate = gate }

// SetSummaryGenerator 接上模型底座。不接则 summary:refresh 一律 503。
func (s *Service) SetSummaryGenerator(g SummaryGenerator) { s.summaries = g }

// SetDisplayNameSource 接上非好友目标的展示名解析。不接则陌生互动者显示
// 账号 id（不断屏）。与 relationship 的 resolveNameCtx 同一事实源，不另写。
func (s *Service) SetDisplayNameSource(src DisplayNameSource) { s.names = src }

// SetAvatarSource 接上目标头像解析（identity.profiles.avatar_path）。
// 不接则 avatarUrl 恒空串，客户端首字回退 —— 与修复前行为一致。
func (s *Service) SetAvatarSource(src AvatarSource) { s.avatars = src }

// avatarURLFor 解析单个目标的 wire 头像。好友与陌生人都走这一条 ——
// 好友集只带名字，头像的唯一事实源同样是 identity.profiles。
func (s *Service) avatarURLFor(ctx context.Context, userID string) string {
	if s.avatars == nil {
		return ""
	}
	path, ok := s.avatars(ctx, userID)
	if !ok {
		return ""
	}
	return WireAvatarURL(path)
}

// SetViewerGate 接上洞察工具使用权门禁。不接则 ListInsights / GetInsight /
// RecordOperate / RefreshSummary 一律拒绝 —— 没发工具的账号连读都不许读，
// 读出来的是第三方行为数据，不是公开目录。
func (s *Service) SetViewerGate(gate ViewerGate) { s.viewerGate = gate }

// viewerAllowed 是三个入口共用的第一道闸。顺序在最前：没使用权的账号，
// 连"参数对不对"这种信息都不该拿到（省得拿报错做 oracle 探接口形状）。
func (s *Service) viewerAllowed(ctx context.Context, ownerID string) error {
	if s == nil || s.viewerGate == nil {
		return ErrInsightViewerForbidden
	}
	if err := s.viewerGate(ctx, ownerID); err != nil {
		return ErrInsightViewerForbidden
	}
	return nil
}

func (s *Service) clockNow() time.Time {
	if s.now == nil {
		return time.Now().UTC()
	}
	return s.now().UTC()
}

// ListInsights 产出分身视角的好友洞察列表。
//
// ownerID 必须是**已认证**的账号 id（由调用点从会话里取）。本方法不做鉴权，
// 也不该做 —— 鉴权在 HTTP 层，这里只负责合成。
func (s *Service) ListInsights(ctx context.Context, twinID, ownerID string) (Payload, error) {
	if err := s.viewerAllowed(ctx, ownerID); err != nil {
		return Payload{}, err
	}
	thresholds, err := s.thresholdsFor(ctx)
	if err != nil {
		return Payload{}, err
	}
	friends, err := s.friends.ListActiveFriends(ctx, ownerID)
	if err != nil {
		return Payload{}, fmt.Errorf("twininsight: list friends: %w", err)
	}
	facts, err := s.repo.ListFacts(ctx, ownerID, s.clockNow().Add(-Window))
	if err != nil {
		return Payload{}, fmt.Errorf("twininsight: list facts: %w", err)
	}
	byActor := map[string]SignalFact{}
	for _, f := range facts.Signals {
		byActor[f.ActorID] = f
	}
	eventsByActor := map[string][]RecentEvent{}
	for _, e := range facts.Events {
		eventsByActor[e.ActorID] = append(eventsByActor[e.ActorID], e)
	}
	now := s.clockNow()
	insights := make([]Insight, 0, len(friends))
	for _, friend := range friends {
		if friend.UserID == ownerID {
			// 自己不给自己当洞察目标 —— 投流工具回答"谁值得运营"，
			// 本人行（历史脏数据里自己既是 owner 又是 peer）进来就是噪音。
			// 好友集理论上不会含自己，这里是纵深防御。
			continue
		}
		insights = append(insights, buildInsight(friend, byActor[friend.UserID], eventsByActor[friend.UserID], thresholds, now, s.avatarURLFor(ctx, friend.UserID)))
	}
	// TWIN-INSIGHT-TARGETS-001：目标集 = 好友 ∪ 有过互动的陌生人。
	//
	// 只认好友会漏掉用户真正想看的人 —— 聊过天 / 来看过主页但还没加好友的，
	// 在好友页确实没有，在洞察页必须有（"谁值得运营"首先是"谁在找我"）。
	// facts 的 actor 本来就不限好友（PG 的 actors CTE 取四路事件的并集），
	// 之前是这里用 friends 集合把它们又筛掉了。
	//
	// 陌生目标的 Since 留零值：VerdictOf 的"新好友"宽限只认非零 Since，
	// 零值 + 零信号走分数分支判 skip，不会伪造"新好友"，也不会让"聊过但
	// 7 天无数据"的人混进 new。
	seen := map[string]bool{ownerID: true}
	for _, friend := range friends {
		seen[friend.UserID] = true
	}
	strangers := make([]string, 0)
	for actor := range byActor {
		if !seen[actor] {
			seen[actor] = true
			strangers = append(strangers, actor)
		}
	}
	for actor := range eventsByActor {
		if !seen[actor] {
			seen[actor] = true
			strangers = append(strangers, actor)
		}
	}
	sort.Strings(strangers)
	for _, actor := range strangers {
		name := ""
		if s.names != nil {
			if resolved, ok := s.names(ctx, actor); ok {
				name = resolved
			}
		}
		insights = append(insights, buildInsight(Friend{UserID: actor, DisplayName: name}, byActor[actor], eventsByActor[actor], thresholds, now, s.avatarURLFor(ctx, actor)))
	}
	// 值得运营的排前面；同分按"最近有动静"排（刚互动过的人更该被看到），
	// 再按 id 兜底，保证顺序完全确定 —— 不稳定的顺序会让「第一个人是谁」
	// 每次都变，用户会以为数据在抖。
	sort.SliceStable(insights, func(i, j int) bool {
		if insights[i].Score != insights[j].Score {
			return insights[i].Score > insights[j].Score
		}
		left, right := byActor[insights[i].TargetID], byActor[insights[j].TargetID]
		if !left.LastSignalAt.Equal(right.LastSignalAt) {
			return left.LastSignalAt.After(right.LastSignalAt)
		}
		return insights[i].TargetID < insights[j].TargetID
	})
	return Payload{
		TwinID:       twinID,
		Insights:     insights,
		TotalTargets: len(insights),
		Thresholds:   thresholds,
	}, nil
}

// GetInsight 取单个目标的洞察。列表已带全量，这个端点给深链/刷新用。
func (s *Service) GetInsight(ctx context.Context, twinID, ownerID, targetID string) (Insight, error) {
	payload, err := s.ListInsights(ctx, twinID, ownerID)
	if err != nil {
		return Insight{}, err
	}
	for _, insight := range payload.Insights {
		if insight.TargetID == targetID {
			return insight, nil
		}
	}
	return Insight{}, ErrTargetNotAFriend
}

// ErrTargetNotAFriend 表示这个 id 不是 owner 的好友 —— 不是"查不到"，
// 是"不在你能看的目标集里"。HTTP 层翻成 404，不泄漏对方是否存在。
var ErrTargetNotAFriend = fmt.Errorf("twininsight: target is not an active friend")

func (s *Service) thresholdsFor(ctx context.Context) (Thresholds, error) {
	if s.thresholds == nil {
		return DefaultThresholds(), nil
	}
	t, err := s.thresholds(ctx)
	if err != nil {
		return Thresholds{}, fmt.Errorf("twininsight: thresholds: %w", err)
	}
	return t, nil
}

// DefaultThresholds 是 facet config 不可用时的兜底。数值与
// facet.DefaultFacetConfig 的 PriorityHighBoundary/PriorityMidBoundary 一致 ——
// 兜底也不能换一套阈值，否则同一个分数在两条路径上给不同 verdict。
func DefaultThresholds() Thresholds {
	return Thresholds{OperateAt: 60, ObserveAt: 30, ConfigVersion: 1}
}

// ---------------------------------------------------------------------------
// 纯函数：判定与文案。全部无副作用，可单测。
// ---------------------------------------------------------------------------

// 饱和度上限：达到这个量就算"满分信号"，再多也不加分。
// 数值取自原型的量级（访问十几次、几十条消息、停留几分钟），
// 是产品口径，改这里等于改"什么样算高互动"。
const (
	viewSaturation    = 10
	messageSaturation = 30
	staySaturationSec = 180
	likeSaturation    = 6
)

// 权重：对话 > 访问 = 停留 > 点赞。理由：主动发消息是最强信号；
// 访问比对话弱（点进来不等于有兴趣，但比随手点赞强）；停留是对**内容**
// 的兴趣而非对人的，所以不高于访问；点赞最廉价。四项权重和 = 1。
//
// 对话必须严格高于访问：否则"看了很多但一句没聊"会跟"聊了很多"同分，
// 而这屏要回答的恰恰是"谁值得运营"。这条由
// TestScoreWeightsConversationAboveImpressions 钉住。
const (
	weightViews    = 0.25
	weightMessages = 0.35
	weightStay     = 0.25
	weightLikes    = 0.15
)

// ScoreOf 是 0..100 的运营价值分。确定性：同样的信号永远同样的分。
// 与 Facet reasoningConfidence 同量纲，便于后期融合（PRD §3）。
func ScoreOf(s Signals) int {
	score := weightViews*saturate(s.Views7d, viewSaturation) +
		weightMessages*saturate(s.Messages7d, messageSaturation) +
		weightStay*saturate(s.AvgStaySec, staySaturationSec) +
		weightLikes*saturate(s.Likes7d, likeSaturation)
	total := int(score*100 + 0.5)
	if total < 0 {
		return 0
	}
	if total > 100 {
		return 100
	}
	return total
}

func saturate(value, ceiling int) float64 {
	if value <= 0 {
		return 0
	}
	if value >= ceiling {
		return 1
	}
	return float64(value) / float64(ceiling)
}

// NewFriendGrace 是"新好友"的宽限期：加好友不满这么久且零信号，
// 判 new 而不是 skip —— 刚加上的好友还没有数据，判"暂不推荐"是误伤。
const NewFriendGrace = Window

// VerdictOf 是服务端判定。客户端只展示，不自己发明（契约第 3 条）。
func VerdictOf(signals Signals, score int, friendSince, now time.Time, t Thresholds) (Verdict, string) {
	if signals.Empty() && !friendSince.IsZero() && now.Sub(friendSince) < NewFriendGrace {
		return VerdictNew, "新好友"
	}
	switch {
	case score >= t.OperateAt:
		return VerdictWorth, "值得运营"
	case score >= t.ObserveAt:
		return VerdictWatch, "可以培养"
	default:
		return VerdictSkip, "暂不推荐"
	}
}

// SignalOf 是 rail 上的点。hot/warm/cold 跟着分数走，new 单独判，
// 保证点颜色和 verdict 不打架（同一个分数不会既是 hot 又是"暂不推荐"）。
func SignalOf(verdict Verdict, score int, t Thresholds) Signal {
	switch {
	case verdict == VerdictNew:
		return SignalNew
	case score >= t.OperateAt:
		return SignalHot
	case score >= t.ObserveAt:
		return SignalWarm
	default:
		return SignalCold
	}
}

// AdvicesOf 是规则推导的建议，最多 5 条（契约上限）。
//
// 每一条都只陈述可核对的事实，不做心理推断 —— 见包注释里的诚实性边界。
// 顺序：warn 在前（要处理的先看），然后 good，最后 info 兜底。
func AdvicesOf(signals Signals, friendSince, now time.Time) []Advice {
	advices := make([]Advice, 0, 5)
	if signals.Views7d >= 5 && signals.Messages7d == 0 {
		advices = append(advices, Advice{Type: "warn", Text: fmt.Sprintf(
			"7 天访问了你的主页 %d 次，但你们还没有对话记录。", signals.Views7d)})
	}
	if signals.Views7d == 0 && signals.Messages7d == 0 && signals.Likes7d == 0 {
		advices = append(advices, Advice{Type: "warn", Text: "过去 7 天没有任何互动记录。"})
	}
	if signals.Messages7d >= 20 {
		advices = append(advices, Advice{Type: "good", Text: fmt.Sprintf(
			"7 天互相发了 %d 条消息，互动频繁。", signals.Messages7d)})
	}
	if signals.AvgStaySec >= 120 {
		advices = append(advices, Advice{Type: "good", Text: fmt.Sprintf(
			"平均在你的内容上停留 %s。", FormatStay(signals.AvgStaySec))})
	}
	if signals.Likes7d >= 3 {
		advices = append(advices, Advice{Type: "info", Text: fmt.Sprintf(
			"7 天点赞/收藏了你的 %d 条内容。", signals.Likes7d)})
	}
	if len(advices) == 0 {
		// 兜底永远有话说，且只说事实：把四个数字摆出来，不评价。
		text := fmt.Sprintf("7 天：访问 %d 次 · 消息 %d 条 · 点赞 %d 次。",
			signals.Views7d, signals.Messages7d, signals.Likes7d)
		if signals.AvgStaySec > 0 {
			text = fmt.Sprintf("7 天：访问 %d 次 · 消息 %d 条 · 平均停留 %s · 点赞 %d 次。",
				signals.Views7d, signals.Messages7d, FormatStay(signals.AvgStaySec), signals.Likes7d)
		}
		advices = append(advices, Advice{Type: "info", Text: text})
	}
	if len(advices) > 5 {
		advices = advices[:5]
	}
	return advices
}

// SummaryHint 是折叠条的副标题（原型：「7 天访问 12 次 · 互动深」）。
func SummaryHint(signals Signals) string {
	if signals.Empty() {
		return "7 天无互动"
	}
	hint := fmt.Sprintf("7 天访问 %d 次", signals.Views7d)
	if signals.Messages7d > 0 {
		hint += fmt.Sprintf(" · 消息 %d 条", signals.Messages7d)
	}
	if signals.AvgStaySec > 0 {
		hint += " · 平均停留 " + FormatStay(signals.AvgStaySec)
	}
	return hint
}

// SummaryText 是详情里的"对话摘要"。
//
// 诚实性：这是**事实摘要**，不是 LLM 生成的对话摘要。所以文案只说数字，
// 不复述对话内容（复述内容需要真的读消息正文，那是 modelstack 的活）。
// 契约要求 min 1 字符，所以空窗口也要给一句实话。
func SummaryText(signals Signals) string {
	if signals.Empty() {
		return "过去 7 天没有互动记录。"
	}
	parts := []string{fmt.Sprintf("访问主页 %d 次", signals.Views7d)}
	if signals.Messages7d > 0 {
		parts = append(parts, fmt.Sprintf("消息 %d 条", signals.Messages7d))
	}
	if signals.AvgStaySec > 0 {
		parts = append(parts, "平均停留 "+FormatStay(signals.AvgStaySec))
	}
	if signals.Likes7d > 0 {
		parts = append(parts, fmt.Sprintf("点赞 %d 次", signals.Likes7d))
	}
	return "过去 7 天：" + strings.Join(parts, " · ") + "。"
}

// FormatStay 把秒数转成原型文案（≥60 显示 x分，否则 x秒）。
// 与契约的 formatTwinStay 同规则，双端文案必须一致。
func FormatStay(avgStaySec int) string {
	if avgStaySec >= 60 {
		return fmt.Sprintf("%d分", int(float64(avgStaySec)/60+0.5))
	}
	return fmt.Sprintf("%d秒", avgStaySec)
}

// TimelineOf 把最近事件翻成时间线，最多 10 条（契约上限）。
// 只显示对方的动作（ByOwner=false）—— 这一屏回答的是"他在做什么"，
// 把 owner 自己的行为混进来会让"最近互动"看起来比实际热。
func TimelineOf(events []RecentEvent, now time.Time) []TimelineItem {
	items := make([]TimelineItem, 0, len(events))
	for _, e := range events {
		if e.ByOwner {
			continue
		}
		items = append(items, TimelineItem{
			Text: eventText(e.Kind),
			Time: RelativeTime(e.At, now),
			Gray: now.Sub(e.At) >= 3*24*time.Hour,
		})
	}
	if len(items) > 10 {
		items = items[:10]
	}
	return items
}

func eventText(kind EventKind) string {
	switch kind {
	case EventProfileOpen:
		return "访问了你的主页"
	case EventLike:
		return "点赞了你的内容"
	case EventMessage:
		return "发了一条消息"
	default:
		return "有新的互动"
	}
}

// RelativeTime 是服务端格式化的展示串（契约要求服务端给，客户端原样展示，
// 避免双端时区/相对时间算法漂移）。
func RelativeTime(at, now time.Time) string {
	if at.IsZero() {
		return ""
	}
	delta := now.Sub(at)
	if delta < 0 {
		delta = 0
	}
	switch {
	case delta < time.Minute:
		return "刚刚"
	case delta < time.Hour:
		return fmt.Sprintf("%d 分钟前", int(delta.Minutes()))
	case delta < 24*time.Hour:
		return fmt.Sprintf("%d 小时前", int(delta.Hours()))
	case delta < 48*time.Hour:
		return "昨天"
	case delta < 7*24*time.Hour:
		return fmt.Sprintf("%d 天前", int(delta.Hours()/24))
	default:
		return at.Format("01-02")
	}
}

// InitialOf 取头像首字回退。契约限制 1..2 个字符 —— 用 rune 切，
// 不能按 byte 切（中文/越南文会切成半个字，渲染成乱码方块）。
func InitialOf(displayName string) string {
	trimmed := strings.TrimSpace(displayName)
	if trimmed == "" {
		return "?"
	}
	// 只取**第一个** rune。契约允许 1..2，但取 2 在中文/越南文里会切出
	// 一个没意义的双字（"陈先生" → "陈先"），头像首字的惯例是单字。
	// 而且必须按 rune 切，不能按 byte 切 —— byte 切会切出半个字。
	runes := []rune(trimmed)
	out := string(runes[:1])
	if utf8.RuneCountInString(out) == 0 || out == "" {
		return "?"
	}
	return out
}

func buildInsight(friend Friend, fact SignalFact, events []RecentEvent, t Thresholds, now time.Time, avatarURL string) Insight {
	signals := Signals{
		Views7d:    fact.Views7d,
		Messages7d: fact.Messages7d,
		AvgStaySec: fact.AvgStaySec(),
		Likes7d:    fact.Likes7d,
	}
	score := ScoreOf(signals)
	verdict, label := VerdictOf(signals, score, friend.Since, now, t)
	displayName := friend.DisplayName
	if strings.TrimSpace(displayName) == "" {
		// 名字解析失败时兜底成账号 id —— 契约要求 displayName min 1，
		// 给空串会让客户端整个 payload 解析失败（fail-closed），
		// 一个名字缺失不该让整屏挂掉。
		displayName = friend.UserID
	}
	return Insight{
		TargetID:     friend.UserID,
		DisplayName:  displayName,
		Initial:      InitialOf(displayName),
		AvatarURL:    avatarURL,
		Signal:       SignalOf(verdict, score, t),
		Verdict:      verdict,
		VerdictLabel: label,
		SummaryHint:  SummaryHint(signals),
		Score:        score,
		Signals:      signals,
		Advices:      AdvicesOf(signals, friend.Since, now),
		SummaryText:  SummaryText(signals),
		Timeline:     TimelineOf(events, now),
	}
}

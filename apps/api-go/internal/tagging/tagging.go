// Package tagging 是规格 §3 的「Tag 层」：把事实（事件 / 粗粒度位置 / 主动表态）压成可解释的
// 用户标签，供撮合与推荐读取。
//
//	Event = 事实（localnet.interaction_events，append-only，不动）
//	Tag   = 可解释状态（本包：tag.user_tags，**派生物，可整表重算**）
//
// 三条边界，改之前先读：
//
//  1. 标签不是事实。任何时候都可以按事件重算；同意撤回后下一轮重算标签就消失。
//     所以重算必须覆盖「已经有标签的人」，不能只覆盖「最近有事件的人」（见 Recompute）。
//  2. 每个轴声明 required_purpose 和 allowed_use。取证据时过 consent.ValidAtSQL（事件那一刻同意有效
//     且现在没撤回），读标签时报用途（Use），不在清单里读不到。
//  3. 不编数。证据不足就不出标签；强度 / 置信度都由证据条数和停留时长算出来，公式写在下面，
//     不是拍脑袋的权重。
package tagging

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// RuleVersion 随规则变化而变；写进每个标签，方便回放「这个标签是哪一版规则算的」。
const RuleVersion = "2026-10-08"

// 轴（词表）。取值来自事实，轴本身是受控的。
const (
	// 帖子没有「场景类型」这种分类（用户 2026-10-08）：帖文就是帖文，有主题但不跟随场景。
	// 兴趣只看内容主题（INTEREST_TOPIC，见下），「回避」同样按主题：连续快速划走某个主题的帖子。
	AxisAversionTopic    = "AVERSION_TOPIC"
	AxisInterestActivity = "INTEREST_ACTIVITY"
	AxisRhythm           = "RHYTHM"
	AxisCity             = "CITY"
	AxisArea             = "AREA"
	// 细粒度亲和轴（TAG-SYSTEM-002，用户：「一个用户帖 n 个标签拿到画像，越细越好」）。
	// 它们不靠专门写一条规则，而是「信号 → 同轴同值累加 → 饱和成强度」的通用路径：新增一个轴 =
	// 一行 tag.axes + 一条抽取 SQL（postgres.go 的 loadSignals），不改 Derive。
	AxisVenueFavorite   = "VENUE_FAVORITE"
	AxisVenueKind       = "VENUE_KIND"
	AxisVenueStyle      = "VENUE_STYLE"
	AxisDistrict        = "DISTRICT"
	AxisCreatorAffinity = "CREATOR_AFFINITY"
	AxisSkill           = "SKILL"
	AxisLanguage        = "LANGUAGE"
	// TAG-SYSTEM-003：内容话题与交易侧。
	AxisInterestTopic    = "INTEREST_TOPIC"
	AxisOrderService     = "ORDER_SERVICE"
	AxisPriceBand        = "PRICE_BAND"
	AxisOrderScenario    = "ORDER_SCENARIO"
	AxisTimeSlot         = "TIME_SLOT"
	AxisExpertiseService = "EXPERTISE_SERVICE"
	// 行为模式（规则推导，不靠关键词）：应用使用强度与重心、聊天风格。值是 usage/… 、chat/… 路径。
	AxisPattern = "PATTERN"
)

// Use 是读标签的人报上的用途（规格 §3.2 allowed_use）。
type Use string

const (
	UseRecommendation Use = "recommendation"
	UseMatching       Use = "matching"
	UseAnalytics      Use = "analytics"
)

// 来源。
const (
	SourceBehavior = "BEHAVIOR"
	SourceExplicit = "EXPLICIT"
	SourceMixed    = "MIXED"
)

// Axis 是一个标签轴的定义（与 tag.axes 一一对应）。
type Axis struct {
	Axis            string
	Label           string
	Polarity        string
	TTL             time.Duration
	RequiredPurpose string
	AllowedUse      []Use
	// 亲和轴的通用参数。Scale = 信号权重累计到多少算强度约 0.63（饱和曲线的尺度）；
	// MinSignals = 至少几条独立信号才出标签；Declared = 用户自己声明的当前状态（总是「现在」，不随时间过期）。
	// Scale == 0 表示这不是通用亲和轴（走各自的专门规则）。
	Scale      float64
	MinSignals int
	Declared   bool
}

var axes = []Axis{
	{AxisAversionTopic, "主题回避", "NEGATIVE", 14 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0, 0, false},
	{AxisInterestActivity, "活动兴趣", "POSITIVE", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0, 0, false},
	{AxisRhythm, "活跃节律", "NEUTRAL", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0, 0, false},
	{AxisCity, "常在城市", "NEUTRAL", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0, 0, false},
	{AxisArea, "常去区域", "NEUTRAL", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0, 0, false},
	// 显式场所行为（收藏 / 计划去 / 去过 / 打卡）：用户自己做的事，不需要浏览同意，保留得久一些。
	{AxisVenueFavorite, "常去 / 收藏的店", "POSITIVE", 60 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 3, 1, false},
	{AxisVenueKind, "场所类型", "POSITIVE", 60 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 4, 1, false},
	{AxisVenueStyle, "场所风格", "POSITIVE", 60 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 4, 1, false},
	{AxisDistrict, "常活动的区", "NEUTRAL", 60 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 4, 1, false},
	// 被动：看哪个创作者的内容停得久（要浏览同意）。
	{AxisCreatorAffinity, "偏爱的创作者", "POSITIVE", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 6, 3, false},
	// 声明：她自己写在接单资料里的能力 / 语种，是当前状态。
	{AxisSkill, "声明的服务能力", "POSITIVE", 365 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0.5, 1, true},
	{AxisLanguage, "声明的语种", "POSITIVE", 365 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0.5, 1, true},
	// 内容话题：看（被动，要同意）+ 自己发（主动）带这个话题的帖子。两条独立信号才出。
	{AxisInterestTopic, "内容话题", "POSITIVE", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 4, 1, false},
	// 交易侧：用户自己下过的单（交易事实，不需要浏览同意）。
	{AxisOrderService, "买过的服务", "POSITIVE", 90 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 2, 1, false},
	{AxisPriceBand, "消费价位", "NEUTRAL", 90 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 2, 1, false},
	{AxisOrderScenario, "消费场景", "NEUTRAL", 90 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 2, 1, false},
	{AxisTimeSlot, "下单时段偏好", "NEUTRAL", 90 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 2, 1, false},
	{AxisPattern, "行为模式", "NEUTRAL", 28 * 24 * time.Hour, "RECOMMENDATION", []Use{UseRecommendation, UseMatching, UseAnalytics}, 0, 0, false},
	// 供给侧：她实际完成过什么（比声明更可信）。
	{AxisExpertiseService, "完成过的服务", "POSITIVE", 180 * 24 * time.Hour, "", []Use{UseRecommendation, UseMatching, UseAnalytics}, 3, 1, false},
}

// PriceBandOf 把约定报酬（VND）分档。档位是产品口径，改了要同步迁移说明；<=0 返回空（不编）。
func PriceBandOf(vnd int64) string {
	switch {
	case vnd <= 0:
		return ""
	case vnd < 100_000:
		return "LT_100K"
	case vnd < 300_000:
		return "100K_300K"
	case vnd < 800_000:
		return "300K_800K"
	default:
		return "GE_800K"
	}
}

// TimeSlotOf 把订单开始时间归到时段桶（越南时间）；解析不了返回空。
func TimeSlotOf(start string) string {
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(start))
	if err != nil {
		return ""
	}
	v := VietnamTime(t)
	return bucketOf(v.Weekday(), v.Hour())
}

// Axes 返回词表（拷贝）。
func Axes() []Axis { return append([]Axis(nil), axes...) }

// LookupAxis 按名字找轴。
func LookupAxis(name string) (Axis, bool) {
	for _, a := range axes {
		if a.Axis == name {
			return a, true
		}
	}
	return Axis{}, false
}

// Allows 报告这个轴是否允许该用途读取。
func (a Axis) Allows(use Use) bool {
	for _, u := range a.AllowedUse {
		if u == use {
			return true
		}
	}
	return false
}

// Tag 是一个用户标签（规格 §3.2 user_tag）。
type Tag struct {
	UserID          string    `json:"userId,omitempty"`
	Axis            string    `json:"axis"`
	Value           string    `json:"value"`
	Strength        float64   `json:"strength"`
	Confidence      float64   `json:"confidence"`
	Source          string    `json:"source"`
	EvidenceCount   int       `json:"evidenceCount"`
	SourceDiversity int       `json:"sourceDiversity"`
	FirstSeen       time.Time `json:"firstSeen"`
	LastSeen        time.Time `json:"lastSeen"`
	ExpiresAt       time.Time `json:"expiresAt"`
	ComputedAt      time.Time `json:"computedAt"`
	RuleVersion     string    `json:"ruleVersion"`
	// Label 是给人看的名字（词典里的中文名）；只在对外展示时填（BuildProfile / ListMyTags）。
	Label string `json:"label,omitempty"`
}

// ID 是 axis:value，对人和日志都可读。
func (t Tag) ID() string { return t.Axis + ":" + t.Value }

var valuePattern = regexp.MustCompile(`^[\p{L}\p{N}_.,:+/-]{1,48}$`)
var spaces = regexp.MustCompile(`\s+`)

// NormalizeValue：首尾去空白、内部空白折成下划线（"City Walk" → "City_Walk"）。折完仍不合格的是脏数据，Derive 会拒。
func NormalizeValue(v string) string { return spaces.ReplaceAllString(strings.TrimSpace(v), "_") }

// ValidValue：取值只允许这一小撮字符。事实里可能出现任意字符串（帖子的 scene_type、事件的 city），
// 但标签是受控词的一部分，不收带空格 / 标点 / 中文长句的东西——那是脏数据，不是词。
func ValidValue(v string) bool { return utf8.RuneCountInString(v) <= 48 && valuePattern.MatchString(v) }

// ---------------------------------------------------------------- 证据

// TopicEvidence：某个内容主题上的被动浏览证据（只用来判断「回避」；兴趣走通用亲和路径）。
type TopicEvidence struct {
	Events     int
	DwellMs    int64
	QuickSkips int // 停留 < QuickSkipMs 的曝光
	First      time.Time
	Last       time.Time
}

// ActivityEvidence：某类活动上的证据。Views/DwellMs 是被动的（要同意），Interested/Joined 是用户主动做的。
type ActivityEvidence struct {
	Views int
	// DwellCredit：看活动详情页的停留折成的信用（DwellCredit()，每次浏览最多 1）。
	DwellCredit float64
	Interested  int
	Joined      int
	First       time.Time
	Last        time.Time
}

// CellEvidence：一个粗粒度网格里出现过的天数。
type CellEvidence struct {
	Days  int
	First time.Time
	Last  time.Time
}

// Signal 是一条已聚合的亲和信号：某人对某轴某值累计了多少权重。抽取在存储层完成（SQL 聚合），
// 这里只做「同轴同值累加 → 饱和」。Explicit = 来自用户自己做的事（收藏 / 声明…），否则是被动行为。
type Signal struct {
	Axis     string
	Value    string
	Weight   float64
	N        int
	First    time.Time
	Last     time.Time
	Explicit bool
}

// UsageEvidence：应用使用（SCREEN_VIEW / APP_SESSION）。ScreenMs 只含合法 screen id。
type UsageEvidence struct {
	ScreenMs    map[string]int64
	SessionMs   int64 // 前台会话总时长
	Sessions    int
	ActiveDays  int
	First, Last time.Time
}

// ChatEvidence：聊天**元数据**（条数 / 会话数 / 谁先开口 / 回复多快）。**不含任何正文**——私人通信内容
// 不做画像（架构文档 §3：聊天内容分析要单独的同意目的，未开放）。
type ChatEvidence struct {
	Messages      int
	Conversations int
	Initiated     int // 自己先开口的会话数
	Replies       int // 紧跟在对方消息之后的消息数
	FastReplies   int // 其中 10 分钟内回的
	First, Last   time.Time
}

// Evidence 是一个人在窗口内的全部证据（已经过同意过滤）。
type Evidence struct {
	Signals    []Signal
	Usage      UsageEvidence
	Chat       ChatEvidence
	UserID     string
	TopicViews map[string]TopicEvidence
	Activities map[string]ActivityEvidence
	// HourCounts[weekday*24+hour] = 该时段的事件数（越南时间）。
	HourCounts [168]int
	Cities     map[string]int
	Cells      map[string]CellEvidence
}

// ---------------------------------------------------------------- 规则常量（公式依据写在 Derive 里）

const (
	// QuickSkipMs：停留不到 1 秒算「快速划走」。
	QuickSkipMs = 1000
	// 场景兴趣：至少 5 次曝光才出标签；停留 90 秒时强度约 0.63。
	// 回避：至少 5 次曝光，且快速划走占比 ≥ 70%。
	minAversionEvents = 5
	aversionRatio     = 0.70
	// 活动兴趣：主动点「感兴趣」比被动看更重；被动看 2 次「认真看」（信用 2.0）时强度约 0.63。
	activityDwellScale   = 2.0
	activityInterestGain = 0.35
	activityJoinGain     = 0.55
	minActivitySignals   = 1
	// 节律：至少 12 个事件，且最大时段占比 ≥ 40%。
	minRhythmEvents = 12
	rhythmShare     = 0.40
	// 城市：至少 5 个事件，且占比 ≥ 60%。
	minCityEvents = 5
	cityShare     = 0.60
	// 区域：至少 3 个不同的天。
	minAreaDays = 3
)

// Derive 把一个人的证据压成标签。纯函数：同样的证据同样的结果，方便单测钉住。
//
// 强度 strength = 1 - exp(-x / scale)：证据越多越饱和，永远在 [0,1)，不会出现「100%」。
// 置信度 confidence = n/(n+5) × (0.7 + 0.15×(来源数-1))，上限 1：条数少就低，多个来源互相印证才高。
func Derive(ev Evidence, now time.Time) []Tag {
	var out []Tag
	add := func(t Tag) {
		axis, ok := LookupAxis(t.Axis)
		if !ok || !ValidValue(t.Value) {
			return
		}
		t.UserID = ev.UserID
		t.ComputedAt = now
		t.RuleVersion = RuleVersion
		t.ExpiresAt = t.LastSeen.Add(axis.TTL)
		if !t.ExpiresAt.After(now) {
			return // 证据已经老到标签一出生就过期：不出
		}
		out = append(out, t)
	}

	// 主题回避：某个主题的帖子至少看过 5 次、且 ≥70% 一眼划走。兴趣不在这里——兴趣由
	// INTEREST_TOPIC 的通用亲和路径出（看得久 + 自己发过），这里只负责「明显不喜欢」。
	for topic, s := range ev.TopicViews {
		if s.Events >= minAversionEvents {
			if skipRatio := float64(s.QuickSkips) / float64(s.Events); skipRatio >= aversionRatio {
				add(Tag{Axis: AxisAversionTopic, Value: topic, Strength: round3(skipRatio), Confidence: confidence(s.Events, 1),
					Source: SourceBehavior, EvidenceCount: s.Events, SourceDiversity: 1, FirstSeen: s.First, LastSeen: s.Last})
			}
		}
	}

	for category, a := range ev.Activities {
		explicit := a.Interested + a.Joined
		if a.Views+explicit < minActivitySignals {
			continue
		}
		strength := saturate(a.DwellCredit, activityDwellScale)
		strength = clamp01(1 - (1-strength)*math.Exp(-activityInterestGain*float64(a.Interested))*math.Exp(-activityJoinGain*float64(a.Joined)))
		source, diversity := SourceBehavior, 1
		switch {
		case a.Views > 0 && explicit > 0:
			source, diversity = SourceMixed, 2
		case explicit > 0:
			source = SourceExplicit
		}
		add(Tag{Axis: AxisInterestActivity, Value: category, Strength: round3(strength), Confidence: confidence(a.Views+explicit, diversity),
			Source: source, EvidenceCount: a.Views + explicit, SourceDiversity: diversity, FirstSeen: a.First, LastSeen: a.Last})
	}

	if t, ok := rhythmTag(ev, now); ok {
		add(t)
	}

	if city, n, total := topCity(ev.Cities); total >= minCityEvents && float64(n)/float64(total) >= cityShare {
		add(Tag{Axis: AxisCity, Value: city, Strength: round3(float64(n) / float64(total)), Confidence: confidence(total, 1),
			Source: SourceBehavior, EvidenceCount: total, SourceDiversity: 1, FirstSeen: now, LastSeen: now})
	}

	for cell, c := range ev.Cells {
		if c.Days >= minAreaDays {
			add(Tag{Axis: AxisArea, Value: cell, Strength: saturate(float64(c.Days), 7), Confidence: confidence(c.Days, 1),
				Source: SourceBehavior, EvidenceCount: c.Days, SourceDiversity: 1, FirstSeen: c.First, LastSeen: c.Last})
		}
	}

	out = append(out, deriveAffinity(ev, now)...)
	out = append(out, derivePatterns(ev, now)...)

	sort.Slice(out, func(i, j int) bool {
		if out[i].Axis != out[j].Axis {
			return out[i].Axis < out[j].Axis
		}
		return out[i].Value < out[j].Value
	})
	return out
}

type affinityKey struct{ axis, value string }

type affinityAcc struct {
	weight          float64
	n               int
	first, last     time.Time
	explicit, behav bool
}

// deriveAffinity：通用亲和轴。同一 (轴, 值) 的信号累加权重，按轴的 Scale 饱和成强度；
// 独立信号条数不到 MinSignals 不出（一条孤立信号不是画像）。声明类轴取「现在」作为 last_seen。
func deriveAffinity(ev Evidence, now time.Time) []Tag {
	acc := map[affinityKey]*affinityAcc{}
	for _, sg := range ev.Signals {
		axis, ok := LookupAxis(sg.Axis)
		if !ok || axis.Scale <= 0 || sg.Weight <= 0 {
			continue
		}
		value := NormalizeValue(sg.Value)
		if !ValidValue(value) {
			continue
		}
		k := affinityKey{sg.Axis, value}
		a := acc[k]
		if a == nil {
			a = &affinityAcc{first: sg.First, last: sg.Last}
			acc[k] = a
		}
		a.weight += sg.Weight
		a.n += max(sg.N, 1)
		if sg.First.Before(a.first) {
			a.first = sg.First
		}
		if sg.Last.After(a.last) {
			a.last = sg.Last
		}
		if sg.Explicit {
			a.explicit = true
		} else {
			a.behav = true
		}
	}
	var out []Tag
	for k, a := range acc {
		axis, _ := LookupAxis(k.axis)
		if a.n < axis.MinSignals {
			continue
		}
		source, diversity := SourceBehavior, 1
		switch {
		case a.explicit && a.behav:
			source, diversity = SourceMixed, 2
		case a.explicit:
			source = SourceExplicit
		}
		first, last := a.first, a.last
		if axis.Declared {
			last = now
			if first.IsZero() || first.After(now) {
				first = now
			}
		}
		t := Tag{UserID: ev.UserID, Axis: k.axis, Value: k.value, Strength: saturate(a.weight, axis.Scale), Confidence: confidence(a.n, diversity),
			Source: source, EvidenceCount: a.n, SourceDiversity: diversity, FirstSeen: first, LastSeen: last,
			ExpiresAt: last.Add(axis.TTL), ComputedAt: now, RuleVersion: RuleVersion}
		if !t.ExpiresAt.After(now) {
			continue
		}
		out = append(out, t)
	}
	return out
}

// 时段桶。越南时间；周末 = 周六 / 周日。
func bucketOf(weekday time.Weekday, hour int) string {
	weekend := weekday == time.Saturday || weekday == time.Sunday
	switch {
	case hour < 5:
		return "LATE_NIGHT"
	case hour >= 18:
		if weekend {
			return "WEEKEND_EVENING"
		}
		return "WEEKDAY_EVENING"
	default:
		if weekend {
			return "WEEKEND_DAY"
		}
		return "WEEKDAY_DAY"
	}
}

func rhythmTag(ev Evidence, now time.Time) (Tag, bool) {
	counts := map[string]int{}
	total := 0
	for slot, n := range ev.HourCounts {
		if n == 0 {
			continue
		}
		// slot = weekday*24+hour，weekday 0 = 周日（time.Weekday）
		counts[bucketOf(time.Weekday(slot/24), slot%24)] += n
		total += n
	}
	if total < minRhythmEvents {
		return Tag{}, false
	}
	best, bestN := "", 0
	for _, bucket := range []string{"LATE_NIGHT", "WEEKDAY_DAY", "WEEKDAY_EVENING", "WEEKEND_DAY", "WEEKEND_EVENING"} {
		if counts[bucket] > bestN {
			best, bestN = bucket, counts[bucket]
		}
	}
	share := float64(bestN) / float64(total)
	if share < rhythmShare {
		return Tag{}, false
	}
	return Tag{Axis: AxisRhythm, Value: best, Strength: round3(share), Confidence: confidence(total, 1),
		Source: SourceBehavior, EvidenceCount: total, SourceDiversity: 1, FirstSeen: now, LastSeen: now}, true
}

func topCity(cities map[string]int) (string, int, int) {
	best, bestN, total := "", 0, 0
	keys := make([]string, 0, len(cities))
	for k := range cities {
		keys = append(keys, k)
	}
	sort.Strings(keys) // 平局时取字典序小的，结果稳定
	for _, k := range keys {
		total += cities[k]
		if cities[k] > bestN {
			best, bestN = k, cities[k]
		}
	}
	return best, bestN, total
}

func saturate(x, scale float64) float64 {
	if x <= 0 {
		return 0
	}
	return round3(1 - math.Exp(-x/scale))
}

func confidence(n, sources int) float64 {
	if n <= 0 {
		return 0
	}
	v := float64(n) / (float64(n) + 5) * math.Min(1, 0.7+0.15*float64(sources-1))
	return round3(clamp01(v))
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }
func round3(v float64) float64  { return math.Round(v*1000) / 1000 }

// ---------------------------------------------------------------- 粗粒度位置

// CoarseCell 把经纬度取整到 0.01°（约 1.1km）的网格，返回 "21.03,105.85"。
// 原始坐标不出这个函数：调用方只存返回值。越界 / NaN 返回 false。
func CoarseCell(lat, lng float64) (string, bool) {
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return "", false
	}
	return fmt.Sprintf("%.2f,%.2f", math.Floor(lat*100)/100, math.Floor(lng*100)/100), true
}

// VietnamTime：越南没有夏令时，固定 UTC+7。
func VietnamTime(t time.Time) time.Time { return t.UTC().Add(7 * time.Hour) }

// HourSlot 返回 weekday*24+hour（越南时间）。
func HourSlot(t time.Time) int {
	v := VietnamTime(t)
	return int(v.Weekday())*24 + v.Hour()
}

// ---------------------------------------------------------------- 读取

// Reader 是撮合 / 推荐读标签的入口，所有读取必须报用途。
type Reader interface {
	TagsFor(userID string, use Use, now time.Time) []Tag
}

// FilterForUse：只留下「该用途被允许」且「没过期」的标签。读取的唯一过滤点。
func FilterForUse(tags []Tag, use Use, now time.Time) []Tag {
	out := make([]Tag, 0, len(tags))
	for _, t := range tags {
		axis, ok := LookupAxis(t.Axis)
		if !ok || !axis.Allows(use) || !t.ExpiresAt.After(now) {
			continue
		}
		out = append(out, t)
	}
	return out
}

// Overlap 是两个标签集合在「正向轴」上的重合度，0..1：撮合想知道「她的擅长 / 常去，和你的兴趣对不对得上」。
// 只比较同轴同值的正向标签，取强度的最小值再求平均；负向标签（回避）命中会扣分，下限 0。
func Overlap(a, b []Tag) float64 {
	index := func(tags []Tag) map[string]Tag {
		m := map[string]Tag{}
		for _, t := range tags {
			m[t.ID()] = t
		}
		return m
	}
	ia, ib := index(a), index(b)
	var sum, count float64
	for id, ta := range ia {
		tb, ok := ib[id]
		if !ok {
			continue
		}
		axis, _ := LookupAxis(ta.Axis)
		if axis.Polarity != "POSITIVE" {
			continue
		}
		sum += math.Min(ta.Strength, tb.Strength)
		count++
	}
	if count == 0 {
		return 0
	}
	score := sum / count
	for _, ta := range a {
		if ta.Axis != AxisAversionTopic {
			continue
		}
		if tb, ok := ib[AxisInterestTopic+":"+ta.Value]; ok {
			score -= 0.5 * math.Min(ta.Strength, tb.Strength)
		}
	}
	return round3(clamp01(score))
}

// Describe 给运营看的一句话，不含个人信息。
func (t Tag) Describe() string {
	axis, _ := LookupAxis(t.Axis)
	return fmt.Sprintf("%s · %s（强度 %.2f，置信 %.2f，%d 条证据）", axis.Label, strings.ReplaceAll(t.Value, "_", " "), t.Strength, t.Confidence, t.EvidenceCount)
}

// 行为模式阈值。都是「够多才下结论」：样本不够不出标签。
const (
	minUsageDays     = 3
	minFocusScreenMs = 3 * 60 * 1000
	focusShare       = 0.25
	lightDayMs       = 5 * 60 * 1000
	heavyDayMs       = 30 * 60 * 1000
	minChatMessages  = 30
	minChatConvs     = 3
	initiatorShare   = 0.6
	minChatReplies   = 5
	fastReplyShare   = 0.7
)

// derivePatterns：应用使用与聊天风格的规则标签。值是路径（usage/…、chat/…），词典里对应 DERIVED 节点。
func derivePatterns(ev Evidence, now time.Time) []Tag {
	var out []Tag
	add := func(value string, strength float64, evidence int, first, last time.Time) {
		axis, _ := LookupAxis(AxisPattern)
		if last.IsZero() {
			last = now
		}
		t := Tag{UserID: ev.UserID, Axis: AxisPattern, Value: value, Strength: round3(strength), Confidence: confidence(evidence, 1), Source: SourceBehavior,
			EvidenceCount: evidence, SourceDiversity: 1, FirstSeen: first, LastSeen: last, ExpiresAt: last.Add(axis.TTL), ComputedAt: now, RuleVersion: RuleVersion}
		if t.ExpiresAt.After(now) && ValidValue(value) {
			out = append(out, t)
		}
	}
	u := ev.Usage
	if u.ActiveDays >= minUsageDays {
		perDay := u.SessionMs / int64(u.ActiveDays)
		switch {
		case perDay >= heavyDayMs:
			add("usage/intensity/heavy", saturate(float64(perDay), float64(heavyDayMs)), u.ActiveDays, u.First, u.Last)
		case perDay >= lightDayMs:
			add("usage/intensity/regular", 0.6, u.ActiveDays, u.First, u.Last)
		case perDay > 0:
			add("usage/intensity/light", 0.6, u.ActiveDays, u.First, u.Last)
		}
	}
	var total int64
	for _, ms := range u.ScreenMs {
		total += ms
	}
	if total >= minFocusScreenMs {
		for screen, ms := range u.ScreenMs {
			if share := float64(ms) / float64(total); share >= focusShare {
				add("usage/focus/"+screen, share, u.Sessions+1, u.First, u.Last)
			}
		}
	}
	c := ev.Chat
	if c.Messages >= minChatMessages {
		add("chat/active", saturate(float64(c.Messages), 100), c.Messages, c.First, c.Last)
	}
	if c.Conversations >= minChatConvs && float64(c.Initiated)/float64(c.Conversations) >= initiatorShare {
		add("chat/initiator", float64(c.Initiated)/float64(c.Conversations), c.Conversations, c.First, c.Last)
	}
	if c.Replies >= minChatReplies && float64(c.FastReplies)/float64(c.Replies) >= fastReplyShare {
		add("chat/fast_reply", float64(c.FastReplies)/float64(c.Replies), c.Replies, c.First, c.Last)
	}
	return out
}

// LabelFor：标签取值的人话名字。兴趣主题和行为模式查词典；其余轴的取值本身就是可读的（店名 id 除外，展示层另查）。
func LabelFor(axis, value string) string {
	tx, err := DefaultTaxonomy()
	if err != nil {
		return value
	}
	switch axis {
	case AxisInterestTopic, AxisAversionTopic:
		if _, ok := tx.Node("interest/" + value); ok {
			return tx.Label("interest/" + value)
		}
	case AxisPattern:
		if _, ok := tx.Node(value); ok {
			return tx.Label(value)
		}
	}
	return strings.ReplaceAll(value, "_", " ")
}

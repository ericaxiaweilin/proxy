// Package gravity 是《Personalization & Orchestration Engineering Spec v1》§6-§7 / §11 / §21 的第一块落地
// （GRAVITY-001，2026-09-23）：
//
//	Gravity Event = 什么需求正在逼近（不是长期兴趣，也不是当下意图）。
//	Gravity 真正关心的是：距离下一次事件发生还有多久 —— P(next <= 30/60/120 min)。
//
// 规格 §7 明确「第一阶段优先简单可靠：Histogram / KDE …不建议早期直接上复杂 Neural TPP」，这里就是 Histogram：
//   - 每个人、每类事件，按「星期几 × 几点」（河内时间）168 个桶统计出现过的周数，近期加权（半衰期 14 天）；
//   - 每个桶的发生率 = 该桶出现过的（加权）周数 / 观察到的（加权）周数，再向这个人的整体小时率收缩（数据少时不走极端）；
//   - P(接下来 k 分钟内发生) = 1 - Π(1 - 桶发生率)^(该桶被覆盖的比例)。
//
// 只算**数据里真有**的 G1 周期事件（见 Source）：聊天活跃、浏览活跃、场景到访。规格里的吃饭 / 咖啡 / 通勤
// 我们没有对应的真实行为数据，不编。
//
// 决策状态（§11）按证据定，不按概率拍脑袋：
//
//	近 30 天没发生过          → OBSERVE     只收集
//	证据覆盖 < 0.5（不到 2 周） → LEARN_ONLY  只学习，不影响线上
//	P60 ≥ 0.5                → SOFT_NUDGE  可以在 Feed / Market 里自然靠前
//	其他                      → PASSIVE     只在用户主动搜索时参与排序
//
// ACTIVE_ORCHESTRATE（主动撮合 / Push）**永远不由这里给**：它还需要 §12 获得感 / 愤怒感防护墙和 §13 干预预算，
// 这两样还没有实现。BLOCKED 同理（需要 §10 负反馈熔断），现在不会出现。
package gravity

import (
	"math"
	"sort"
	"time"
)

const (
	ModelVersion = "gravity-hist-v1"

	EventChatActive   = "CHAT_ACTIVE"
	EventBrowseActive = "BROWSE_ACTIVE"
	EventSceneVisit   = "SCENE_VISIT"

	StateObserve   = "OBSERVE"
	StateLearnOnly = "LEARN_ONLY"
	StatePassive   = "PASSIVE"
	StateSoftNudge = "SOFT_NUDGE"
	StateActive    = "ACTIVE_ORCHESTRATE"
	StateBlocked   = "BLOCKED"
	bucketsPerWeek = 7 * 24
	halfLife       = 14 * 24 * time.Hour
	lookback       = 60 * 24 * time.Hour
	// 向整体小时率收缩的伪周数。近期加权后 4 周真实观察的有效权重只有 ~1.8 周，伪计数给 2 会把真规律淹掉；
	// 0.5 足以防止单个样本把某个钟点推到极端（样本少的情况另由证据覆盖度挡在 LEARN_ONLY）。
	shrinkWeeks     = 0.5
	softNudgeP60    = 0.5
	fullCoverageWks = 4.0
)

// Market 时区：河内（UTC+7，无夏令时）。用固定时区，不依赖容器里有没有 tzdata。
var Market = time.FixedZone("ICT", 7*3600)

// Occurrence 是一次真实发生的行为（来自事件表 / 消息表 / 打卡表）。
type Occurrence struct {
	UserID    string
	EventType string
	At        time.Time
}

// State 是规格 §21 UserEventState 的第一版子集。
type State struct {
	UserID           string     `json:"userId"`
	EventType        string     `json:"eventType"`
	P30              float64    `json:"p30"`
	P60              float64    `json:"p60"`
	P120             float64    `json:"p120"`
	Confidence       float64    `json:"confidence"`
	EvidenceCoverage float64    `json:"evidenceCoverage"`
	SampleEvents     int        `json:"sampleEvents"`
	ActiveWeeks      int        `json:"activeWeeks"`
	FirstSeen        time.Time  `json:"firstSeen"`
	LastSeen         time.Time  `json:"lastSeen"`
	PeakHourOfWeek   int        `json:"peakHourOfWeek"` // 0 = 周一 00 点（河内时间）
	ActionState      string     `json:"actionState"`
	ModelVersion     string     `json:"modelVersion"`
	ComputedAt       time.Time  `json:"computedAt"`
	NextLikelyAt     *time.Time `json:"nextLikelyAt,omitempty"`
}

func hourOfWeek(t time.Time) int {
	local := t.In(Market)
	day := (int(local.Weekday()) + 6) % 7 // 周一 = 0
	return day*24 + local.Hour()
}

func weekIndex(t time.Time) int64 {
	// 以周一 00:00（河内）为界的周序号。
	local := t.In(Market)
	days := int64(local.Sub(time.Date(1970, 1, 5, 0, 0, 0, 0, Market)).Hours() / 24)
	return days / 7
}

// Compute 用一个人、一类事件的历史发生时间算出当前的引力状态。times 可以无序。
func Compute(userID, eventType string, times []time.Time, now time.Time) State {
	st := State{UserID: userID, EventType: eventType, ModelVersion: ModelVersion, ComputedAt: now.UTC(), PeakHourOfWeek: -1}
	recent := make([]time.Time, 0, len(times))
	for _, t := range times {
		if !t.After(now) && now.Sub(t) <= lookback {
			recent = append(recent, t)
		}
	}
	if len(recent) == 0 {
		st.ActionState = StateObserve
		return st
	}
	sort.Slice(recent, func(i, j int) bool { return recent[i].Before(recent[j]) })
	st.SampleEvents = len(recent)
	st.FirstSeen, st.LastSeen = recent[0].UTC(), recent[len(recent)-1].UTC()

	decay := func(t time.Time) float64 { return math.Pow(0.5, float64(now.Sub(t))/float64(halfLife)) }

	// 桶里「出现过的周」只算一次（同一小时发 20 条消息 = 这周这小时活跃过一次）。
	type key struct {
		week   int64
		bucket int
	}
	seen := map[key]float64{}
	weeks := map[int64]float64{}
	for _, t := range recent {
		k := key{weekIndex(t), hourOfWeek(t)}
		w := decay(t)
		if w > seen[k] {
			seen[k] = w
		}
		if w > weeks[k.week] {
			weeks[k.week] = w
		}
	}
	// 观察窗口按桶算：从第一次发生那周起，每一周的这个「星期几 × 几点」只要**已经完整过去**就算观察过一次
	// （发生了记在 presence，没发生就是一次「观察到没发生」）。本周还没到的时段不算 —— 不然今天中午还没到，
	// 「本周一中午」就被当成了一次没发生，把规律的人的引力平白拉低。
	epoch := time.Date(1970, 1, 5, 0, 0, 0, 0, Market)
	firstWeek, nowWeek := weekIndex(recent[0]), weekIndex(now)
	observedBucket := make([]float64, bucketsPerWeek)
	observedTotal := 0.0
	for wk := firstWeek; wk <= nowWeek; wk++ {
		weekStart := epoch.Add(time.Duration(wk*7*24) * time.Hour)
		for b := 0; b < bucketsPerWeek; b++ {
			start := weekStart.Add(time.Duration(b) * time.Hour)
			if start.Add(time.Hour).After(now) {
				continue
			}
			w := decay(start)
			observedBucket[b] += w
			observedTotal += w
		}
	}
	st.ActiveWeeks = len(weeks)
	presence := make([]float64, bucketsPerWeek)
	total := 0.0
	for k, w := range seen {
		presence[k.bucket] += w
		total += w
	}
	overall := 0.0
	if observedTotal > 0 {
		overall = total / observedTotal
	}
	rate := make([]float64, bucketsPerWeek)
	peak, peakRate := -1, 0.0
	for b := range rate {
		rate[b] = math.Min(0.99, (presence[b]+shrinkWeeks*overall)/(observedBucket[b]+shrinkWeeks))
		if presence[b] > 0 && rate[b] > peakRate {
			peak, peakRate = b, rate[b]
		}
	}
	st.PeakHourOfWeek = peak

	within := func(minutes int) float64 {
		survive := 1.0
		cursor := now
		end := now.Add(time.Duration(minutes) * time.Minute)
		for cursor.Before(end) {
			local := cursor.In(Market)
			hourEnd := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), 0, 0, 0, Market).Add(time.Hour)
			if hourEnd.After(end) {
				hourEnd = end
			}
			frac := float64(hourEnd.Sub(cursor)) / float64(time.Hour)
			survive *= math.Pow(1-rate[hourOfWeek(cursor)], frac)
			cursor = hourEnd
		}
		return 1 - survive
	}
	st.P30, st.P60, st.P120 = round3(within(30)), round3(within(60)), round3(within(120))

	// 未来 7 天里发生率最高的那个整点（给运营看「什么时候最可能」）。
	best, bestAt := 0.0, time.Time{}
	for h := 1; h <= 7*24; h++ {
		at := now.Add(time.Duration(h) * time.Hour).In(Market).Truncate(time.Hour)
		if r := rate[hourOfWeek(at)]; r > best+1e-9 {
			best, bestAt = r, at
		}
	}
	if best > overall && !bestAt.IsZero() {
		utc := bestAt.UTC()
		st.NextLikelyAt = &utc
	}

	st.EvidenceCoverage = round3(math.Min(1, float64(st.ActiveWeeks)/fullCoverageWks))
	st.Confidence = round3(st.EvidenceCoverage * (1 - 1/(1+float64(st.SampleEvents)/10)))
	switch {
	case now.Sub(st.LastSeen) > 30*24*time.Hour:
		st.ActionState = StateObserve
	case st.EvidenceCoverage < 0.5:
		st.ActionState = StateLearnOnly
	case st.P60 >= softNudgeP60:
		st.ActionState = StateSoftNudge
	default:
		st.ActionState = StatePassive
	}
	return st
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// ComputeAll 把一批发生记录按（人, 事件）分组逐个算。
func ComputeAll(occurrences []Occurrence, now time.Time) []State {
	type key struct{ user, event string }
	grouped := map[key][]time.Time{}
	for _, o := range occurrences {
		if o.UserID == "" || o.EventType == "" {
			continue
		}
		k := key{o.UserID, o.EventType}
		grouped[k] = append(grouped[k], o.At)
	}
	out := make([]State, 0, len(grouped))
	for k, times := range grouped {
		out = append(out, Compute(k.user, k.event, times, now))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].EventType != out[j].EventType {
			return out[i].EventType < out[j].EventType
		}
		return out[i].UserID < out[j].UserID
	})
	return out
}

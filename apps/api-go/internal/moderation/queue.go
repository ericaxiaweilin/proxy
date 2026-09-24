package moderation

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-REPORT-005: 举报的处置时限与运营队列。
//
// 086 建了受理表，087 建了处置表并替「运营队列」建好索引 —— 但**从来没有
// 一条查询能列出举报**：Repository 只有 AddReport 与 FindReport，而后者只被
// 处置/申诉写入口当作「对象是否存在」的校验用。于是整条处置链在实践上不可达：
//
//	举报只进不出。平台收得下举报，却没有任何路径把举报交到人手上。
//
// 实测证据：库里唯一一条举报 reason='SOLICITATION'（2026-09-15 18:59 受理）
// 到 2026-09-22 已 7 天、处置记录 0 条。不是没人处理 —— 是没人能发现它。
// 而 SOLICITATION 恰是刑法 327 条（介绍卖淫）那类风险所在。
//
// 本文件补两件事，缺一不可：
//
//  1. **时限**（ReportSLAHours / ReportDueAt / ReportOverdue）。服务条款 §58
//     承诺「建立举报、核查、限制传播、纠正、移除和账号处置流程」，
//     Decree 328/2026 §4 把时限钉成「一般 24 小时、紧急 6 小时」。没有截止
//     时刻，平台既做不到、也证明不了自己按时处理过 —— 与 §55 有权机关请求
//     侧（COMP-AUTHORITY-001 的 SLAHours/DeadlineFor/MetDeadline）同构。
//
//  2. **队列**（ReportQueue）。时限没人读就是装饰。列表本身才是把举报交到
//     人手上的那条路径。
//
// 时限口径（哪些理由算「紧急」）是产品/法务判断，集中在本文件的
// reportSLAHours switch 与 117 迁移的 CASE 两处，由
// TestMigrationBackfillMatchesGoMapping 逐条比对防止漂移。

const (
	// reportSLAUrgentHours 是「紧急」类举报的处置时限（小时）。
	// 依据：Decree 328/2026 §4「一般 24h，紧急 6h」；服务条款 §38 亦写明
	// 「紧急安全事件……可能优先处理」。归入此类的三个理由都指向对具体人的
	// 即时伤害（涉未成年人、招嫖揽客、人身安全），拖过 6 小时就是继续暴露。
	reportSLAUrgentHours = 6
	// reportSLADefaultHours 是其余举报的处置时限（小时）。
	reportSLADefaultHours = 24
)

// ReportSLAHours 返回该理由的处置时限（小时）；理由不受支持时返回 false。
//
// 刻意不做「认不出来就按 24 小时算」的兜底（与 authority.SLAHours 同口径）：
// 那会把 6 小时的涉未成年人举报悄悄拖成 24 小时。调用方在受理前已用
// ReportableReasons() 校验过理由，所以 false 分支在正常情况下不可达 ——
// TestEverySupportedReasonHasAnSLA 把这一点钉住。
func ReportSLAHours(reason string) (int, bool) {
	if !contains(ReportableReasons(), reason) {
		return 0, false
	}
	switch reason {
	case ReasonMinorSafety, ReasonSolicitation, ReasonUnsafe:
		return reportSLAUrgentHours, true
	default:
		return reportSLADefaultHours, true
	}
}

// ReportDueAt 由受理时刻与理由推导处置截止时刻。
//
// 受理时就固定下来写入 due_at，而不是每次读时重算：法定时限可能变，历史
// 举报要按「受理当时生效的时限」举证，不能因为规则改了就把过去的按时处理
// 追溯成超时。
func ReportDueAt(reason string, createdAt time.Time) (time.Time, bool) {
	hours, ok := ReportSLAHours(reason)
	if !ok {
		return time.Time{}, false
	}
	return createdAt.UTC().Add(time.Duration(hours) * time.Hour), true
}

// ReportOverdue 判断在 now 时刻是否已经超过处置截止时刻。
//
// 这是「我们在法定时限内处理了」这条承诺唯一的直接证据，因此单独成函数
// 以便被测试直接钉住（与 authority.MetDeadline 对称）。
func ReportOverdue(dueAt, now time.Time) bool {
	return now.UTC().After(dueAt.UTC())
}

// ReportQueueEntry 是仓储层交给队列读模型的一行：举报本体 + 处置链的
// 摘要。做成一个结构体而不是两个列表，是为了让「这条举报现在到哪一步」
// 在一次查询里就能回答，避免 N+1。
type ReportQueueEntry struct {
	Report Report
	// LastAction 是最后一条处置的动作；没有任何处置时为空串。
	LastAction string
	// LastDispositionAt 是最后一条处置的时刻；没有任何处置时为零值。
	LastDispositionAt time.Time
	// DispositionCount 是处置条数。0 表示「收进来了但没人碰过」。
	DispositionCount int
}

// ReportQueueItem 是运营队列里的一行，带算好的时限与超时判定。
type ReportQueueItem struct {
	ReportID   string    `json:"reportId"`
	TargetType string    `json:"targetType"`
	TargetID   string    `json:"targetId"`
	Reason     string    `json:"reason"`
	State      string    `json:"state"`
	CreatedAt  time.Time `json:"createdAt"`
	DueAt      time.Time `json:"dueAt"`
	// AgeHours 是「从受理到（处理完 / 现在）」的小时数：
	//   - 未处理完 → 已经等了多久；
	//   - 已处理完 → 实际花了多久。
	// 它**不依赖** due_at —— 即使时限规则改了，「这条已经躺了 7 天」也始终可算、
	// 可举证。
	AgeHours float64 `json:"ageHours"`
	// Overdue 的判定对象是「这条举报有没有在时限内被处理完」，**不是**一律拿
	// 「现在」去比截止时刻：
	//   - 未处理完：现在 > 截止时刻；
	//   - 已处理完：**处理完的那一刻**晚于截止时刻。
	// 拿 now 去比会把「6 小时内就处置完」的举报在三天后显示成超时 —— 假警报，
	// 而假警报会让人不再相信这个字段。
	Overdue bool `json:"overdue"`
	// OverdueHours 是超出截止时刻的小时数；未超时为 0。
	// 未处理完按「截止时刻 → 现在」算，已处理完按「截止时刻 → 处理完」算。
	OverdueHours float64 `json:"overdueHours"`
	// DispositionCount == 0 且 State == SUBMITTED 表示「收进来了、没人碰过」。
	DispositionCount  int        `json:"dispositionCount"`
	LastAction        string     `json:"lastAction,omitempty"`
	LastDispositionAt *time.Time `json:"lastDispositionAt,omitempty"`
}

// ReportQueue 是队列读模型的整体返回。
//
// Total 与 Returned 必须分开：Total 是符合筛选条件的总数，Returned 是本次
// 实际返回的条数（受 Limit 约束）。两者不等 = 结果被截断 —— 这件事必须
// 让调用方看得见，否则「队列看起来只有 100 条」会把第 101 条举报藏起来。
//
// OpenCount / OverdueCount 是**不受 IncludeClosed 影响**的系统口径（分别
// 是「还没处理完的」与「没在时限内处理完的」总数）：它们回答的是「平台现在
// 欠着多少」，而不是「这次返回了多少」。Total / Returned 才描述本次响应。
type ReportQueue struct {
	Items         []ReportQueueItem `json:"items"`
	Total         int               `json:"total"`
	Returned      int               `json:"returned"`
	Limit         int               `json:"limit"`
	IncludeClosed bool              `json:"includeClosed"`
	OpenCount     int               `json:"openCount"`
	OverdueCount  int               `json:"overdueCount"`
	GeneratedAt   time.Time         `json:"generatedAt"`
}

// 队列默认与上限。上限存在的意义是防止一次把整库拉出来，但截断必须可见
// （见 ReportQueue.Total / Returned）。
const (
	reportQueueDefaultLimit = 100
	reportQueueMaxLimit     = 500
)

// isOpenReportState 判断举报是否仍需要人处理。
// ACTIONED / DISMISSED 是终结态（要改结论得再写 REOPEN，届时状态会变回
// REOPENED，重新进入队列）。
//
// 注意 REOPENED 的举报会直接显示为**超时**：它的原截止时刻早已过去，而它
// 又回到了待处理状态。这是有意的 —— 结论被推翻意味着得重新处理一遍，
// 让它以最紧急的样子回到队列顶部才对。
func isOpenReportState(state string) bool {
	switch state {
	case ReportStateActioned, ReportStateDismissed:
		return false
	default:
		return true
	}
}

type reportQueuePayload struct {
	IncludeClosed bool `json:"includeClosed"`
	Limit         int  `json:"limit"`
}

// listReportQueue 列出举报队列。operator-only —— 队列含举报人 id 与被举报
// 目标 id，属于个人信息；白名单见 internal/api/security.go 的
// operatorCommandTypes（未配白名单时在命令边界就被拒，走不到这里）。
//
// 排序：due_at 升序 —— 最早该处理的排最前，超时的自然浮到最上面。同一
// 截止时刻按受理时刻、再按 id 定序，保证顺序稳定（分页/对账时不会飘）。
func (s *Service) listReportQueue(ctx context.Context, e command.Envelope) command.Result {
	var p reportQueuePayload
	// payload 可选（空 = 默认只看未终结的）。
	if e.Payload != nil {
		_ = decodeReportQueuePayload(e.Payload, &p)
	}
	limit := p.Limit
	if limit <= 0 {
		limit = reportQueueDefaultLimit
	}
	if limit > reportQueueMaxLimit {
		limit = reportQueueMaxLimit
	}
	// 与其它 operator 命令同口径：处置/查看队列的人必须可识别。队列本身
	// 不含处置动作，但「谁看过这条涉未成年人的举报」在举证上有意义。
	if e.Actor.ID == "" {
		return command.Rejected(e, "REPORT_QUEUE_REQUIRES_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.report_queue_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "REPORT_QUEUE_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.report_queue_failed", nil)
	}
	entries, err := s.repository.ListReportQueue(ctx)
	if err != nil {
		return command.Rejected(e, "REPORT_QUEUE_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.report_queue_failed", nil)
	}
	queue := buildReportQueue(entries, s.clock.Now().UTC(), p.IncludeClosed, limit)
	result := command.Accepted(e, "ModerationReportQueue", "", 1, "LIST", nil)
	result.Body = map[string]any{"reportQueue": queue}
	return result
}

func decodeReportQueuePayload(payload map[string]any, out *reportQueuePayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

// buildReportQueue 把仓储行组装成队列。抽成纯函数是为了让「超时怎么算」
// 能被单测直接钉住，不必穿过命令边界。
func buildReportQueue(entries []ReportQueueEntry, now time.Time, includeClosed bool, limit int) ReportQueue {
	now = now.UTC()
	items := make([]ReportQueueItem, 0, len(entries))
	openCount := 0
	overdueCount := 0
	for _, entry := range entries {
		report := entry.Report
		state := ReportState(dispositionsFor(entry))
		open := isOpenReportState(state)
		if open {
			openCount++
		}
		dueAt := report.DueAt
		// 超时判定与「这条举报处理了多久」都按同一个时间轴走：
		//   - 未处理完：终点是 now（已经等了多久 / 现在是否已超时）；
		//   - 已处理完：终点是**最后一条处置的时刻**（花了多久 / 是否处理晚了）。
		// 对已处理完的举报拿 now 去比 due_at 会把它在几天后显示成「超时」，
		// 而它其实是按时处置完的 —— 假警报会让人不再相信这个字段，
		// 反过来也可能把真的超时掩盖过去。
		end := now
		if !open && !entry.LastDispositionAt.IsZero() {
			end = entry.LastDispositionAt.UTC()
		}
		overdue := !dueAt.IsZero() && ReportOverdue(dueAt, end)
		if overdue {
			overdueCount++
		}
		if !includeClosed && !open {
			continue
		}
		item := ReportQueueItem{
			ReportID:          report.ID,
			TargetType:        report.TargetType,
			TargetID:          report.TargetID,
			Reason:            report.Reason,
			State:             state,
			CreatedAt:         report.CreatedAt.UTC(),
			DueAt:             dueAt.UTC(),
			AgeHours:          hoursBetween(report.CreatedAt, end),
			Overdue:           overdue,
			DispositionCount:  entry.DispositionCount,
			LastAction:        entry.LastAction,
			LastDispositionAt: nil,
		}
		if overdue {
			item.OverdueHours = hoursBetween(dueAt, end)
		}
		if !entry.LastDispositionAt.IsZero() {
			last := entry.LastDispositionAt.UTC()
			item.LastDispositionAt = &last
		}
		items = append(items, item)
	}
	// due_at 升序：最早该处理的在最前，超时的自然浮顶。
	sort.SliceStable(items, func(i, j int) bool {
		if !items[i].DueAt.Equal(items[j].DueAt) {
			return items[i].DueAt.Before(items[j].DueAt)
		}
		if !items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		}
		return items[i].ReportID < items[j].ReportID
	})
	total := len(items)
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return ReportQueue{
		Items:         items,
		Total:         total,
		Returned:      len(items),
		Limit:         limit,
		IncludeClosed: includeClosed,
		OpenCount:     openCount,
		OverdueCount:  overdueCount,
		GeneratedAt:   now,
	}
}

// dispositionsFor 把仓储行还原成 ReportState 需要的处置序列。
//
// ReportState 只看**最后一行**的动作，所以这里只需要尾部那一条；但把它
// 造成长度为 1 的切片会让「没有处置」与「有一条处置」区分得很清楚
// （len==0 → SUBMITTED），这正是 ReportState 的既有语义。
func dispositionsFor(entry ReportQueueEntry) []Disposition {
	if entry.DispositionCount == 0 || strings.TrimSpace(entry.LastAction) == "" {
		return nil
	}
	return []Disposition{{
		ReportID:  entry.Report.ID,
		Action:    entry.LastAction,
		CreatedAt: entry.LastDispositionAt,
	}}
}

// hoursBetween 返回 from 到 to 的小时数（to 早于 from 时返回 0，不返回负数 ——
// 「还没超时」与「超时了 -3 小时」在举证上完全不同）。
func hoursBetween(from, to time.Time) float64 {
	delta := to.UTC().Sub(from.UTC()).Hours()
	if delta < 0 {
		return 0
	}
	// 保留 2 位小数：小时级精度足够，避免把纳秒抖动写进举证数据。
	return math.Round(delta*100) / 100
}

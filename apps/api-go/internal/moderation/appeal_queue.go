package moderation

import (
	"context"
	"sort"
	"time"
)

// OPS-APPEALS-001：申诉复核队列。
//
// RecordAppealDecision 早就有了，但没有任何读出口——运营看不到有哪些申诉在等，跟举报「只进不出」
// 是同一种病。这里补读模型：每条申诉带原举报的理由 / 对象、申诉理由、当前状态（由复核链推导）、
// 等了多久。申诉没有法定时限口径，所以不编「超时」，只给「已等小时数」，最老的排最前。

// AppealQueueEntry 是仓储层交出的一行：申诉本体 + 原举报摘要 + 复核链摘要。
type AppealQueueEntry struct {
	Appeal           Appeal
	ReportReason     string
	ReportTargetType string
	ReportTargetID   string
	LastDecision     string // 没有复核时为空串
	LastDecisionAt   time.Time
	DecisionCount    int
}

type AppealQueueItem struct {
	AppealID       string     `json:"appealId"`
	ReportID       string     `json:"reportId"`
	ReportReason   string     `json:"reportReason"`
	TargetType     string     `json:"targetType"`
	TargetID       string     `json:"targetId"`
	AppellantID    string     `json:"appellantAccountId"`
	Reason         string     `json:"reason"`
	State          string     `json:"state"`
	CreatedAt      time.Time  `json:"createdAt"`
	AgeHours       float64    `json:"ageHours"`
	DecisionCount  int        `json:"decisionCount"`
	LastDecision   string     `json:"lastDecision,omitempty"`
	LastDecisionAt *time.Time `json:"lastDecisionAt,omitempty"`
}

type AppealQueue struct {
	Items         []AppealQueueItem `json:"items"`
	Total         int               `json:"total"`
	Returned      int               `json:"returned"`
	OpenCount     int               `json:"openCount"`
	IncludeClosed bool              `json:"includeClosed"`
}

// BuildAppealQueue 把仓储行组装成队列：未复核的在前、最老的在前。抽成纯函数方便单测。
func BuildAppealQueue(entries []AppealQueueEntry, now time.Time, includeClosed bool, limit int) AppealQueue {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := AppealQueue{Items: []AppealQueueItem{}, IncludeClosed: includeClosed}
	for _, e := range entries {
		state := AppealStateFiled
		switch e.LastDecision {
		case AppealDecisionUpheld:
			state = AppealStateUpheld
		case AppealDecisionRejected:
			state = AppealStateRejected
		}
		open := state == AppealStateFiled
		if open {
			q.OpenCount++
		}
		if !open && !includeClosed {
			continue
		}
		item := AppealQueueItem{
			AppealID: e.Appeal.ID, ReportID: e.Appeal.ReportID, ReportReason: e.ReportReason,
			TargetType: e.ReportTargetType, TargetID: e.ReportTargetID, AppellantID: e.Appeal.AppellantID,
			Reason: e.Appeal.Reason, State: state, CreatedAt: e.Appeal.CreatedAt.UTC(),
			AgeHours: float64(int(now.Sub(e.Appeal.CreatedAt).Hours()*10)) / 10, DecisionCount: e.DecisionCount, LastDecision: e.LastDecision,
		}
		if !e.LastDecisionAt.IsZero() {
			t := e.LastDecisionAt.UTC()
			item.LastDecisionAt = &t
		}
		q.Items = append(q.Items, item)
	}
	sort.SliceStable(q.Items, func(i, j int) bool {
		oi, oj := q.Items[i].State == AppealStateFiled, q.Items[j].State == AppealStateFiled
		if oi != oj {
			return oi
		}
		return q.Items[i].CreatedAt.Before(q.Items[j].CreatedAt)
	})
	q.Total = len(q.Items)
	if len(q.Items) > limit {
		q.Items = q.Items[:limit]
	}
	q.Returned = len(q.Items)
	return q
}

// AppealQueue 读队列。读不出来返回 error，由调用方（运营端点）说「没读出来」，不给空队列冒充。
func (s *Service) AppealQueue(ctx context.Context, includeClosed bool, limit int) (AppealQueue, error) {
	if s.repository == nil {
		return AppealQueue{}, ErrReportRepositoryDown
	}
	entries, err := s.repository.ListAppealQueue(ctx)
	if err != nil {
		return AppealQueue{}, err
	}
	return BuildAppealQueue(entries, s.clock.Now().UTC(), includeClosed, limit), nil
}

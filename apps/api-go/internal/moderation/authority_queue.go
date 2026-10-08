package moderation

import (
	"context"
	"sort"
	"time"
)

// OPS-AUTHORITY-001：有权机关请求的运营队列。
//
// 记录请求 / 记录响应的命令早就有了，也有法定时限（SLAHours / DeadlineFor / MetDeadline），
// 但没有任何读出口——运营看不到「哪条请求还没响应、离截止还有多久」。时限是「我们在法定时限内响应了」
// 这条举证的核心，所以这里把剩余 / 超出的小时数直接算出来；已响应的按「响应时刻 vs 截止时刻」判是否按时。

type AuthorityQueueEntry struct {
	Request         AuthorityRequest
	ResponseCount   int
	LastOutcome     string
	LastRespondedAt time.Time
}

type AuthorityQueueItem struct {
	RequestID       string     `json:"requestId"`
	RequestRef      string     `json:"requestRef"`
	Authority       string     `json:"authority"`
	Kind            string     `json:"requestKind"`
	Verified        bool       `json:"verifiedAll"` // 四项核验全部通过
	ReceivedAt      time.Time  `json:"receivedAt"`
	DeadlineAt      time.Time  `json:"deadlineAt"`
	State           string     `json:"state"`     // OPEN | RESPONDED
	HoursLeft       *float64   `json:"hoursLeft"` // OPEN 时 = 离截止还有多少小时（负数 = 已超时）；RESPONDED 时 nil
	Overdue         bool       `json:"overdue"`   // OPEN 且已过截止，或 RESPONDED 但响应晚于截止
	ResponseCount   int        `json:"responseCount"`
	LastOutcome     string     `json:"lastOutcome,omitempty"`
	LastRespondedAt *time.Time `json:"lastRespondedAt,omitempty"`
	Note            string     `json:"note,omitempty"`
}

type AuthorityQueue struct {
	Items         []AuthorityQueueItem `json:"items"`
	Total         int                  `json:"total"`
	Returned      int                  `json:"returned"`
	OpenCount     int                  `json:"openCount"`
	OverdueCount  int                  `json:"overdueCount"`
	IncludeClosed bool                 `json:"includeClosed"`
}

// BuildAuthorityQueue：未响应的在前、离截止最近的在前（已超时的自然排最前）。
func BuildAuthorityQueue(entries []AuthorityQueueEntry, now time.Time, includeClosed bool, limit int) AuthorityQueue {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	now = now.UTC()
	q := AuthorityQueue{Items: []AuthorityQueueItem{}, IncludeClosed: includeClosed}
	for _, e := range entries {
		r := e.Request
		item := AuthorityQueueItem{
			RequestID: r.ID, RequestRef: r.RequestRef, Authority: r.Authority, Kind: r.Kind,
			Verified:   r.VerifiedSubject && r.VerifiedAuthority && r.VerifiedScope && r.VerifiedLegality,
			ReceivedAt: r.ReceivedAt.UTC(), DeadlineAt: r.DeadlineAt.UTC(), ResponseCount: e.ResponseCount, Note: r.Note,
		}
		if e.ResponseCount == 0 {
			item.State = "OPEN"
			left := float64(int(r.DeadlineAt.Sub(now).Hours()*10)) / 10
			item.HoursLeft = &left
			item.Overdue = now.After(r.DeadlineAt)
			q.OpenCount++
		} else {
			item.State = "RESPONDED"
			item.LastOutcome = e.LastOutcome
			at := e.LastRespondedAt.UTC()
			item.LastRespondedAt = &at
			item.Overdue = !MetDeadline(r.DeadlineAt, at)
		}
		if item.Overdue {
			q.OverdueCount++
		}
		if item.State == "RESPONDED" && !includeClosed {
			continue
		}
		q.Items = append(q.Items, item)
	}
	sort.SliceStable(q.Items, func(i, j int) bool {
		oi, oj := q.Items[i].State == "OPEN", q.Items[j].State == "OPEN"
		if oi != oj {
			return oi
		}
		return q.Items[i].DeadlineAt.Before(q.Items[j].DeadlineAt)
	})
	q.Total = len(q.Items)
	if len(q.Items) > limit {
		q.Items = q.Items[:limit]
	}
	q.Returned = len(q.Items)
	return q
}

func (s *Service) AuthorityQueue(ctx context.Context, includeClosed bool, limit int) (AuthorityQueue, error) {
	if s.repository == nil {
		return AuthorityQueue{}, ErrReportRepositoryDown
	}
	entries, err := s.repository.ListAuthorityQueue(ctx)
	if err != nil {
		return AuthorityQueue{}, err
	}
	return BuildAuthorityQueue(entries, s.clock.Now().UTC(), includeClosed, limit), nil
}

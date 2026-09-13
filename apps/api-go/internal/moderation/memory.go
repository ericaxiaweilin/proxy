package moderation

import (
	"context"
	"errors"
	"strings"
	"sync"
)

// MemoryRepository 是进程内实现，供单测与未接数据库的开发模式使用。
type MemoryRepository struct {
	mu              sync.Mutex
	rows            []Report
	dispositions    []Disposition
	appeals         []Appeal
	appealDecisions []AppealDecision
	authRequests    []AuthorityRequest
	authResponses   []AuthorityResponse
	fail            bool
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{} }

// SetFail 让写入恒定失败，用于验证「写不进去时不能静默吞掉」。
func (r *MemoryRepository) SetFail(fail bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fail = fail
}

func (r *MemoryRepository) AddReport(_ context.Context, report Report) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if report.TargetType == "" || report.TargetID == "" {
		return ErrReportTargetRequired
	}
	if report.Reason == "" {
		return ErrReportReasonRequired
	}
	r.rows = append(r.rows, report)
	return nil
}

func (r *MemoryRepository) AddDisposition(_ context.Context, disposition Disposition) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if disposition.ReportID == "" || disposition.Action == "" {
		return ErrDispositionActionRequired
	}
	if disposition.ActorID == "" {
		return ErrDispositionActorRequired
	}
	r.dispositions = append(r.dispositions, disposition)
	return nil
}

func (r *MemoryRepository) FindReport(_ context.Context, reportID string) (Report, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range r.rows {
		if row.ID == reportID {
			return row, true
		}
	}
	return Report{}, false
}

// COMP-REPORT-004: 申诉落库。与举报 / 处置同口径：只有 append，没有 UPDATE / DELETE。
func (r *MemoryRepository) AddAppeal(_ context.Context, appeal Appeal) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if appeal.ReportID == "" || appeal.AppellantID == "" {
		return ErrAppealRequired
	}
	if strings.TrimSpace(appeal.Reason) == "" {
		return ErrAppealReasonRequired
	}
	r.appeals = append(r.appeals, appeal)
	return nil
}

func (r *MemoryRepository) FindAppeal(_ context.Context, appealID string) (Appeal, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range r.appeals {
		if row.ID == appealID {
			return row, true
		}
	}
	return Appeal{}, false
}

// COMP-REPORT-004: 申诉复核落库（operator-only 的入口在 service 层把关）。
func (r *MemoryRepository) AddAppealDecision(_ context.Context, decision AppealDecision) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if decision.AppealID == "" || decision.Decision == "" {
		return ErrAppealDecisionRequired
	}
	if decision.ActorID == "" {
		return ErrAppealDecisionActorRequired
	}
	r.appealDecisions = append(r.appealDecisions, decision)
	return nil
}

// Reports 返回已受理的全部举报（测试用）。
func (r *MemoryRepository) Reports() []Report {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Report, len(r.rows))
	copy(out, r.rows)
	return out
}

// Dispositions 返回已记录的处置（测试用），按写入顺序。
func (r *MemoryRepository) Dispositions() []Disposition {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Disposition, len(r.dispositions))
	copy(out, r.dispositions)
	return out
}

// COMP-AUTHORITY-001: 有权机关请求落库。与举报 / 处置 / 申诉同口径：
// 只有 append，没有 UPDATE / DELETE。
func (r *MemoryRepository) AddAuthorityRequest(_ context.Context, request AuthorityRequest) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if request.RequestRef == "" || request.Authority == "" || request.Kind == "" {
		return ErrAuthorityRequestRequired
	}
	// 四项核验缺一不得受理（Service 已验过一遍，这里是绕过 Service 时的兜底）。
	if !request.VerifiedSubject || !request.VerifiedAuthority ||
		!request.VerifiedScope || !request.VerifiedLegality {
		return ErrAuthorityRequestVerificationRequired
	}
	if request.ActorID == "" {
		return ErrAuthorityRequestActorRequired
	}
	r.authRequests = append(r.authRequests, request)
	return nil
}

func (r *MemoryRepository) FindAuthorityRequest(_ context.Context, requestID string) (AuthorityRequest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range r.authRequests {
		if row.ID == requestID {
			return row, true
		}
	}
	return AuthorityRequest{}, false
}

// COMP-AUTHORITY-001: 有权机关请求响应落库（operator-only 的入口在 service 层把关）。
func (r *MemoryRepository) AddAuthorityResponse(_ context.Context, response AuthorityResponse) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if response.RequestID == "" || response.Outcome == "" {
		return ErrAuthorityResponseRequired
	}
	if response.ActorID == "" {
		return ErrAuthorityResponseActorRequired
	}
	r.authResponses = append(r.authResponses, response)
	return nil
}

// Appeals 返回已提交的申诉（测试用），按写入顺序。
func (r *MemoryRepository) Appeals() []Appeal {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Appeal, len(r.appeals))
	copy(out, r.appeals)
	return out
}

// AppealDecisions 返回已记录的申诉复核（测试用），按写入顺序。
func (r *MemoryRepository) AppealDecisions() []AppealDecision {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AppealDecision, len(r.appealDecisions))
	copy(out, r.appealDecisions)
	return out
}

// AuthorityRequests 返回已受理的有权机关请求（测试用），按写入顺序。
func (r *MemoryRepository) AuthorityRequests() []AuthorityRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AuthorityRequest, len(r.authRequests))
	copy(out, r.authRequests)
	return out
}

// AuthorityResponses 返回已记录的有权机关响应（测试用），按写入顺序。
func (r *MemoryRepository) AuthorityResponses() []AuthorityResponse {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AuthorityResponse, len(r.authResponses))
	copy(out, r.authResponses)
	return out
}

// 仓储层兜底错误。Service 已经在命令层校验过一遍，这里是防止有人绕过
// Service 直接调仓储写进一条说不清是谁处置了什么、或谁申诉了什么的记录。
var (
	ErrDispositionActionRequired   = errors.New("moderation disposition requires an action and report id")
	ErrDispositionActorRequired    = errors.New("moderation disposition requires an actor")
	ErrAppealRequired              = errors.New("moderation appeal requires a report id and appellant")
	ErrAppealReasonRequired        = errors.New("moderation appeal requires a non-empty reason")
	ErrAppealDecisionRequired      = errors.New("moderation appeal decision requires an appeal id and decision")
	ErrAppealDecisionActorRequired = errors.New("moderation appeal decision requires an actor")
	// COMP-AUTHORITY-001
	ErrAuthorityRequestRequired             = errors.New("moderation authority request requires a ref, authority and kind")
	ErrAuthorityRequestVerificationRequired = errors.New("moderation authority request requires all four verifications")
	ErrAuthorityRequestActorRequired        = errors.New("moderation authority request requires an actor")
	ErrAuthorityResponseRequired            = errors.New("moderation authority response requires a request id and outcome")
	ErrAuthorityResponseActorRequired       = errors.New("moderation authority response requires an actor")
)

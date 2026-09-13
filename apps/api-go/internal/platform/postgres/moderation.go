package postgres

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/moderation"
)

// COMP-REPORT-001 — 生产环境的举报落库实现。
//
// 与 COMP-ID-002 同理：举报接口接得上才有意义。如果这里永远返回 nil
// （或者根本没接），用户点「举报」会看到成功，库里却什么都没有 ——
// 那比没有举报功能更糟：用户以为平台收到了，平台却拿不出任何
// 「收到过、处理过」的证据。
//
// 举报表是 append-only 的（见迁移 086 的 CHECK 与注释），因此这里只有
// INSERT，没有 UPDATE / DELETE —— 举报记录是举证材料。
type ModerationRepository struct {
	pool *pgxpool.Pool
}

func NewModerationRepository(pool *pgxpool.Pool) *ModerationRepository {
	return &ModerationRepository{pool: pool}
}

const insertReportSQL = `
INSERT INTO moderation.reports
    (id, reporter_id, target_type, target_id, reason, note, state, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

func (r *ModerationRepository) AddReport(ctx context.Context, report moderation.Report) error {
	// 兜底校验放在仓储层：Service 已经验过一次，但仓储是可以被直接调的，
	// 写进一条说不清在报什么的记录，等于给举证材料里掺垃圾。
	if strings.TrimSpace(report.TargetType) == "" || strings.TrimSpace(report.TargetID) == "" {
		return moderation.ErrReportTargetRequired
	}
	if strings.TrimSpace(report.Reason) == "" {
		return moderation.ErrReportReasonRequired
	}
	if r == nil || r.pool == nil {
		return moderation.ErrReportRepositoryDown
	}
	note := report.Note
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertReportSQL,
		report.ID, report.ReporterID, report.TargetType, report.TargetID,
		report.Reason, note, report.State, report.CreatedAt.UTC())
	return err
}

// COMP-REPORT-003 — 处置落库。与举报同规则：只有 INSERT，没有
// UPDATE / DELETE。处置记录是「平台处理过」的举证材料。
const insertDispositionSQL = `
INSERT INTO moderation.dispositions
    (id, report_id, action, outcome, actor_id, note, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)`

func (r *ModerationRepository) AddDisposition(ctx context.Context, disposition moderation.Disposition) error {
	if strings.TrimSpace(disposition.ReportID) == "" || strings.TrimSpace(disposition.Action) == "" {
		return moderation.ErrDispositionActionRequired
	}
	if strings.TrimSpace(disposition.ActorID) == "" {
		return moderation.ErrDispositionActorRequired
	}
	if r == nil || r.pool == nil {
		return moderation.ErrReportRepositoryDown
	}
	note := disposition.Note
	outcome := disposition.Outcome
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertDispositionSQL,
		disposition.ID, disposition.ReportID, disposition.Action, outcome,
		disposition.ActorID, note, disposition.CreatedAt.UTC())
	return err
}

const findReportSQL = `
SELECT id, reporter_id, target_type, target_id, reason, COALESCE(note, ''), state, created_at
  FROM moderation.reports
 WHERE id = $1`

func (r *ModerationRepository) FindReport(ctx context.Context, reportID string) (moderation.Report, bool) {
	if r == nil || r.pool == nil || strings.TrimSpace(reportID) == "" {
		return moderation.Report{}, false
	}
	var out moderation.Report
	var note string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, findReportSQL, reportID).Scan(
		&out.ID, &out.ReporterID, &out.TargetType, &out.TargetID,
		&out.Reason, &note, &out.State, &out.CreatedAt)
	if err != nil {
		return moderation.Report{}, false
	}
	out.Note = note
	return out, true
}

// COMP-REPORT-004 — 申诉落库。与举报 / 处置同规则：只有 INSERT，没有
// UPDATE / DELETE。申诉记录是被处理方申辩的举证材料。
const insertAppealSQL = `
INSERT INTO moderation.appeals
    (id, report_id, appellant_account_id, reason, created_at)
VALUES ($1, $2, $3, $4, $5)`

func (r *ModerationRepository) AddAppeal(ctx context.Context, appeal moderation.Appeal) error {
	if strings.TrimSpace(appeal.ReportID) == "" || strings.TrimSpace(appeal.AppellantID) == "" {
		return moderation.ErrAppealRequired
	}
	if strings.TrimSpace(appeal.Reason) == "" {
		return moderation.ErrAppealReasonRequired
	}
	if r == nil || r.pool == nil {
		return moderation.ErrReportRepositoryDown
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertAppealSQL,
		appeal.ID, appeal.ReportID, appeal.AppellantID, appeal.Reason, appeal.CreatedAt.UTC())
	return err
}

const findAppealSQL = `
SELECT id, report_id, appellant_account_id, COALESCE(reason, ''), created_at
  FROM moderation.appeals
 WHERE id = $1`

func (r *ModerationRepository) FindAppeal(ctx context.Context, appealID string) (moderation.Appeal, bool) {
	if r == nil || r.pool == nil || strings.TrimSpace(appealID) == "" {
		return moderation.Appeal{}, false
	}
	var out moderation.Appeal
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, findAppealSQL, appealID).Scan(
		&out.ID, &out.ReportID, &out.AppellantID, &out.Reason, &out.CreatedAt)
	if err != nil {
		return moderation.Appeal{}, false
	}
	return out, true
}

// COMP-REPORT-004 — 申诉复核落库（operator-only 的入口在 service 层把关）。
// 与处置同规则：只有 INSERT，没有 UPDATE / DELETE。
const insertAppealDecisionSQL = `
INSERT INTO moderation.appeal_decisions
    (id, appeal_id, decision, note, actor_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6)`

func (r *ModerationRepository) AddAppealDecision(ctx context.Context, decision moderation.AppealDecision) error {
	if strings.TrimSpace(decision.AppealID) == "" || strings.TrimSpace(decision.Decision) == "" {
		return moderation.ErrAppealDecisionRequired
	}
	if strings.TrimSpace(decision.ActorID) == "" {
		return moderation.ErrAppealDecisionActorRequired
	}
	if r == nil || r.pool == nil {
		return moderation.ErrReportRepositoryDown
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertAppealDecisionSQL,
		decision.ID, decision.AppealID, decision.Decision, decision.Note,
		decision.ActorID, decision.CreatedAt.UTC())
	return err
}

// COMP-AUTHORITY-001 — 有权机关请求受理落库。与举报 / 处置 / 申诉同规则：
// 只有 INSERT，没有 UPDATE / DELETE。这是「在法定时限内响应了」的举证材料。
const insertAuthorityRequestSQL = `
INSERT INTO moderation.authority_requests
    (id, request_ref, authority, request_kind,
     verified_subject, verified_authority, verified_scope, verified_legality,
     received_at, deadline_at, note, actor_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`

func (r *ModerationRepository) AddAuthorityRequest(ctx context.Context, request moderation.AuthorityRequest) error {
	if strings.TrimSpace(request.RequestRef) == "" || strings.TrimSpace(request.Authority) == "" || strings.TrimSpace(request.Kind) == "" {
		return moderation.ErrAuthorityRequestRequired
	}
	if !request.VerifiedSubject || !request.VerifiedAuthority ||
		!request.VerifiedScope || !request.VerifiedLegality {
		return moderation.ErrAuthorityRequestVerificationRequired
	}
	if strings.TrimSpace(request.ActorID) == "" {
		return moderation.ErrAuthorityRequestActorRequired
	}
	if r == nil || r.pool == nil {
		return moderation.ErrReportRepositoryDown
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertAuthorityRequestSQL,
		request.ID, request.RequestRef, request.Authority, request.Kind,
		request.VerifiedSubject, request.VerifiedAuthority,
		request.VerifiedScope, request.VerifiedLegality,
		request.ReceivedAt.UTC(), request.DeadlineAt.UTC(),
		request.Note, request.ActorID, request.CreatedAt.UTC())
	return err
}

const findAuthorityRequestSQL = `
SELECT id, request_ref, authority, request_kind,
       verified_subject, verified_authority, verified_scope, verified_legality,
       received_at, deadline_at, COALESCE(note, ''), actor_id, created_at
  FROM moderation.authority_requests
 WHERE id = $1`

func (r *ModerationRepository) FindAuthorityRequest(ctx context.Context, requestID string) (moderation.AuthorityRequest, bool) {
	if r == nil || r.pool == nil || strings.TrimSpace(requestID) == "" {
		return moderation.AuthorityRequest{}, false
	}
	var out moderation.AuthorityRequest
	var note string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, findAuthorityRequestSQL, requestID).Scan(
		&out.ID, &out.RequestRef, &out.Authority, &out.Kind,
		&out.VerifiedSubject, &out.VerifiedAuthority,
		&out.VerifiedScope, &out.VerifiedLegality,
		&out.ReceivedAt, &out.DeadlineAt, &note, &out.ActorID, &out.CreatedAt)
	if err != nil {
		return moderation.AuthorityRequest{}, false
	}
	out.Note = note
	return out, true
}

// COMP-AUTHORITY-001 — 有权机关请求响应落库（operator-only 的入口在 service 层把关）。
const insertAuthorityResponseSQL = `
INSERT INTO moderation.authority_responses
    (id, request_id, outcome, responded_at, note, actor_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)`

func (r *ModerationRepository) AddAuthorityResponse(ctx context.Context, response moderation.AuthorityResponse) error {
	if strings.TrimSpace(response.RequestID) == "" || strings.TrimSpace(response.Outcome) == "" {
		return moderation.ErrAuthorityResponseRequired
	}
	if strings.TrimSpace(response.ActorID) == "" {
		return moderation.ErrAuthorityResponseActorRequired
	}
	if r == nil || r.pool == nil {
		return moderation.ErrReportRepositoryDown
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertAuthorityResponseSQL,
		response.ID, response.RequestID, response.Outcome,
		response.RespondedAt.UTC(), response.Note, response.ActorID, response.CreatedAt.UTC())
	return err
}

// 签名漂移就在这里编译失败，而不是运行期静默写不进去。
var _ moderation.Repository = (*ModerationRepository)(nil)

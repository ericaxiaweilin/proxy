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

// 签名漂移就在这里编译失败，而不是运行期静默写不进去。
var _ moderation.Repository = (*ModerationRepository)(nil)

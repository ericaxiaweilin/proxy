// Package moderation 承载用户举报的受理（COMP-REPORT-001）。
//
// 为什么必须有这个包：服务条款 §38「举报及申诉」白纸黑字写了用户可以举报
// 内容 / 消息 / 账号 / 活动 / 机会 / 商家 / 邀约 / 交易，但代码里只有
// engagement.ReportPost 一个入口 —— 承诺的 8 类目标只有 1 类能报。
// 这不是「少做个功能」：
//  1. 电商法 122/2025 与 NĐ 147/2024 都要求平台提供举报受理渠道；
//  2. 我们自己最重的风险（刑法 327 条介绍卖淫）恰恰发生在「消息 / 账号 /
//     交易」这几类目标上 —— 没有入口，平台既收不到线索，也拿不出
//     「收到过、处理过」的证据；
//  3. 承诺了却做不到，本身就是虚假陈述（与 COMP-E2EE-002 同类）。
//
// 设计取舍：
//   - 举报只进不出：本包只负责受理与留痕，不做裁决、不做自动处置。
//     裁决要人，自动处置会把误报变成不可逆的伤害。
//   - 一律 fail-closed：目标类型不认识、目标 ID 为空、理由不认识、举报人
//     身份拿不到，全部拒绝。宁可少收一条，也不收一条不知道在报什么的。
//   - append-only：举报记录不允许 UPDATE / DELETE（见迁移里的权限与
//     注释），它是举证材料。
package moderation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// 举报目标类型。与法律文件 §38 列举的八类一一对应，顺序也一致 ——
// ReportableTargetTypes 同时被文档与门禁使用，改动会让门禁红。
const (
	TargetPost        = "POST"
	TargetMessage     = "MESSAGE"
	TargetAccount     = "ACCOUNT"
	TargetActivity    = "ACTIVITY"
	TargetOpportunity = "OPPORTUNITY"
	TargetMerchant    = "MERCHANT"
	TargetInvite      = "INVITE"
	TargetTransaction = "TRANSACTION"
)

// ReportableTargetTypes 返回受支持的目标类型（已排序，便于测试与文档比对）。
func ReportableTargetTypes() []string {
	out := []string{
		TargetPost, TargetMessage, TargetAccount, TargetActivity,
		TargetOpportunity, TargetMerchant, TargetInvite, TargetTransaction,
	}
	sort.Strings(out)
	return out
}

// 举报理由。前四条沿用 engagement.ReportPost 已有的口径，后面几条是补上
// 的：原接口只有 SPAM / HARASSMENT / UNSAFE / OTHER，而我们最需要被报上来
// 的那类事（涉未成年人、线下交易的招嫖揽客）只能塞进 UNSAFE 里，等于
// 没有信号 —— 运营看不出该优先处理哪条。
const (
	ReasonSpam          = "SPAM"
	ReasonHarassment    = "HARASSMENT"
	ReasonUnsafe        = "UNSAFE"
	ReasonMinorSafety   = "MINOR_SAFETY"
	ReasonSolicitation  = "SOLICITATION"
	ReasonFraud         = "FRAUD"
	ReasonImpersonation = "IMPERSONATION"
	ReasonIP            = "IP_VIOLATION"
	ReasonOther         = "OTHER"
)

// ReportableReasons 返回受支持的举报理由（已排序）。
func ReportableReasons() []string {
	out := []string{
		ReasonSpam, ReasonHarassment, ReasonUnsafe, ReasonMinorSafety,
		ReasonSolicitation, ReasonFraud, ReasonImpersonation, ReasonIP, ReasonOther,
	}
	sort.Strings(out)
	return out
}

// ErrReportTargetRequired / ErrReportReasonRequired 由仓储层在写入前兜底，
// 防止有人绕过 Service 直接调仓储写进一条说不清在报什么的记录。
var (
	ErrReportTargetRequired = errors.New("moderation report requires a target type and target id")
	ErrReportReasonRequired = errors.New("moderation report requires a supported reason")
	ErrReportRepositoryDown = errors.New("moderation report repository is unavailable")
	// COMP-REPORT-005：举报必须带处置截止时刻。算不出时限的举报 = 平台证明
	// 不了自己按时处理过，正是本笔要消灭的状态（DB 侧 due_at 是 NOT NULL）。
	ErrReportDueAtRequired = errors.New("moderation report requires a disposition due time")
)

// Report 是一条举报受理记录。
type Report struct {
	ID         string    `json:"reportId"`
	ReporterID string    `json:"reporterId"`
	TargetType string    `json:"targetType"`
	TargetID   string    `json:"targetId"`
	Reason     string    `json:"reason"`
	Note       string    `json:"note,omitempty"`
	State      string    `json:"state"`
	CreatedAt  time.Time `json:"createdAt"`
	// DueAt（COMP-REPORT-005）是处置截止时刻 = CreatedAt + 该理由的法定时限
	// （紧急 6h / 一般 24h，服务条款 §58 + Decree 328/2026 §4）。受理时由
	// ReportDueAt 推导后固定写入，不在读时重算 —— 理由见 queue.go 的说明。
	// 与 089 的 authority_requests.deadline_at 同口径。
	DueAt time.Time `json:"dueAt"`
}

// Repository 是举报记录的写入口。故意只暴露 Add / Find：举报与申诉都是
// append-only，不允许改、不允许删。
//
// AddDisposition（COMP-REPORT-003）与 AddAppeal / AddAppealDecision
// （COMP-REPORT-004）同理——处置与申诉复核记录也是 append-only。
// FindReport / FindAppeal 是给后续环节用的：给不存在的对象写记录，只能制造
// 「看起来处理过 / 申诉过」的假象，所以写入前必须能确认对象真实存在。
type Repository interface {
	AddReport(ctx context.Context, report Report) error
	AddDisposition(ctx context.Context, disposition Disposition) error
	FindReport(ctx context.Context, reportID string) (Report, bool)
	// ListReportQueue（COMP-REPORT-005）是举报**唯一**的读出口。在此之前
	// Repository 只有 AddReport / FindReport，而 FindReport 只被写入口当作
	// 「对象是否存在」的校验用 —— 于是处置链在实践上不可达（收得下举报，
	// 却没有任何路径把举报交到人手上）。返回的每一行都带处置链摘要，
	// 让「这条现在到哪一步」不必再查一次（避免 N+1）。
	ListReportQueue(ctx context.Context) ([]ReportQueueEntry, error)
	AddAppeal(ctx context.Context, appeal Appeal) error
	FindAppeal(ctx context.Context, appealID string) (Appeal, bool)
	AddAppealDecision(ctx context.Context, decision AppealDecision) error
	AddAuthorityRequest(ctx context.Context, request AuthorityRequest) error
	FindAuthorityRequest(ctx context.Context, requestID string) (AuthorityRequest, bool)
	AddAuthorityResponse(ctx context.Context, response AuthorityResponse) error
}

type reportPayload struct {
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId"`
	Reason     string `json:"reason"`
	Note       string `json:"note"`
}

// Service 受理用户举报。
type Service struct {
	mu         sync.Mutex
	repository Repository
	clock      clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	return commandType == "ReportTarget" ||
		commandType == "RecordReportDisposition" ||
		// COMP-REPORT-005: 举报队列。operator-only（见 security.go 的
		// operatorCommandTypes）—— 队列含举报人 id 与被举报目标 id。
		commandType == "ListReportQueue" ||
		// COMP-REPORT-004: 申诉渠道。FileAppeal 是普通已登录用户可用的申诉提交；
		// RecordAppealDecision 是 operator-only 的复核（见 security.go）。
		commandType == "FileAppeal" ||
		commandType == "RecordAppealDecision" ||
		// COMP-AUTHORITY-001: 有权机关请求的受理与响应。两者都是
		// operator-only（见 security.go）。
		commandType == "RecordAuthorityRequest" ||
		commandType == "RecordAuthorityResponse"
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "ReportTarget":
		return s.reportTarget(ctx, e)
	// COMP-REPORT-003: 处置留痕。operator-only —— 白名单见
	// internal/api/security.go 的 operatorCommandTypes，未配白名单时
	// 在命令边界就被拒，走不到这里。
	case "RecordReportDisposition":
		return s.recordDisposition(ctx, e)
	// COMP-REPORT-005: 举报队列（operator-only）。这是举报唯一的读出口 ——
	// 在此之前整条处置链在实践上不可达：举报收得下，却没人能列出它。
	case "ListReportQueue":
		return s.listReportQueue(ctx, e)
	// COMP-REPORT-004: 申诉渠道。
	//   - FileAppeal：普通已登录用户提交申诉（鉴权在命令边界，这里再兜一道）。
	//   - RecordAppealDecision：operator-only，白名单见 security.go 的
	//     operatorCommandTypes，未配白名单时在命令边界就被拒，走不到这里。
	case "FileAppeal":
		return s.fileAppeal(ctx, e)
	case "RecordAppealDecision":
		return s.recordAppealDecision(ctx, e)
	// COMP-AUTHORITY-001: 有权机关请求。两者都是 operator-only —— 白名单见
	// security.go 的 operatorCommandTypes，未配白名单时在命令边界就被拒，
	// 走不到这里。普通用户绝不能伪造「有权机关要调你的信息」这种记录。
	case "RecordAuthorityRequest":
		return s.recordAuthorityRequest(ctx, e)
	case "RecordAuthorityResponse":
		return s.recordAuthorityResponse(ctx, e)
	default:
		return command.Rejected(e, "MODERATION_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "moderation.unsupported_command", nil)
	}
}

func (s *Service) reportTarget(ctx context.Context, e command.Envelope) command.Result {
	var p reportPayload
	if !decodeReportPayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_REPORT", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_report", nil)
	}
	// 目标类型不认识就拒绝，而不是笼统归到 OTHER —— 归到 OTHER 等于
	// 运营永远看不出「法律文件承诺过但我们没接」的那一类。
	if !contains(ReportableTargetTypes(), p.TargetType) {
		return command.Rejected(e, "INVALID_REPORT_TARGET", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_report_target", nil)
	}
	if !contains(ReportableReasons(), p.Reason) {
		return command.Rejected(e, "INVALID_REPORT_REASON", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_report_reason", nil)
	}
	if p.TargetID == "" {
		return command.Rejected(e, "INVALID_REPORT_TARGET", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_report_target", nil)
	}
	// 举报人身份是举证链的一部分：匿名举报无法回访、无法核对，也不该
	// 被人拿来刷。拿不到就拒绝（门禁默认要求鉴权，这里再兜一道）。
	if e.Actor.ID == "" {
		return command.Rejected(e, "REPORT_REQUIRES_AUTHENTICATED_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.report_requires_actor", nil)
	}
	// COMP-REPORT-005: 受理时就把处置截止时刻固定下来（紧急 6h / 一般 24h）。
	// 固定而非读时重算，是为了让历史举报按「受理当时生效的时限」举证。
	createdAt := s.clock.Now().UTC()
	dueAt, ok := ReportDueAt(p.Reason, createdAt)
	if !ok {
		// 理由已经过 ReportableReasons() 校验，所以这条分支不可达 ——
		// TestEverySupportedReasonHasAnSLA 把它钉住。留 fail-closed 兜底：
		// 一条算不出时限的举报，正是本笔要消灭的状态；宁可拒收（REPORT_FAILED
		// 同类），也不写进一条平台证明不了按时处理的记录。
		return command.Rejected(e, "REPORT_SLA_UNRESOLVED", "INTERNAL", "SAFE_RETRY", "moderation.report_sla_unresolved", nil)
	}
	report := Report{
		ID:         newReportID(),
		ReporterID: e.Actor.ID,
		TargetType: p.TargetType,
		TargetID:   p.TargetID,
		Reason:     p.Reason,
		Note:       p.Note,
		State:      ReportStateSubmitted,
		CreatedAt:  createdAt,
		DueAt:      dueAt,
	}
	if s.repository == nil {
		return command.Rejected(e, "REPORT_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.report_failed", nil)
	}
	if err := s.repository.AddReport(ctx, report); err != nil {
		return command.Rejected(e, "REPORT_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.report_failed", nil)
	}
	return command.Accepted(e, "ModerationReport", report.ID, 1, report.State, nil)
}

func decodeReportPayload(payload map[string]any, out *reportPayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func contains(set []string, value string) bool {
	for _, item := range set {
		if item == value {
			return true
		}
	}
	return false
}

func newReportID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "report_" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return "report_" + hex.EncodeToString(buf)
}

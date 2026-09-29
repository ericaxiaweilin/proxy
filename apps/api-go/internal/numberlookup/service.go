// Package numberlookup 是客服 / 运营按全数字公共编号反查的入口（PUBLIC-NO-LOOKUP-001）。
//
// 用户会把编号念给客服、贴进工单：履约订单编号（orderNo）、活动报名订单编号、
// 需求 / 邀约编号、活动编号。它们来自同一个全局序列（internal/ordernumber），所以
// 一个编号最多指向一个实体；本包按编号把它找回来，并且：
//
//   - 只给运营：命令进 api 层的 operator 门，scope = CASE（见 api/security.go、
//     operator_scopes.go），非运营 403，跟其他运营读口（ListReportQueue 等）同一道门；
//   - 每次查询都留痕（谁、查了哪个号、写的什么理由、查到什么），写进只追加的
//     operator.number_lookups，与命令同一事务；**留痕写不进去就不返回任何数据**
//     （fail-closed）—— 反查能看到订单双方账号和条款，属于个人信息读取；
//   - 校验位先行：抄错一位的号直接告诉客服「校验位不对，请核对」，而不是「查无此单」，
//     两种结论对处理下一步完全不同；
//   - 不猜：一个号查到多个实体是数据完整性事故（序列保证不该发生），拒绝返回并留痕。
package numberlookup

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

const CommandType = "LookupPublicNumber"

// Kind 是编号指向的实体类型。
type Kind string

const (
	KindOrder                 Kind = "ORDER"
	KindActivityParticipation Kind = "ACTIVITY_PARTICIPATION"
	KindOpportunity           Kind = "OPPORTUNITY"
	KindActivity              Kind = "ACTIVITY"
)

// Outcome 是一次查询的结论，写进审计行。
type Outcome string

const (
	OutcomeFound     Outcome = "FOUND"
	OutcomeNotFound  Outcome = "NOT_FOUND"
	OutcomeInvalid   Outcome = "INVALID_NUMBER"
	OutcomeAmbiguous Outcome = "AMBIGUOUS"
	OutcomeError     Outcome = "ERROR"
)

// Match 是一个 Finder 找到的实体。Entity 只放客服处理工单需要的事实（账号 id、状态、
// 条款、时间），不放聊天内容、证件、联系方式。
type Match struct {
	Kind     Kind
	EntityID string
	State    string
	Entity   map[string]any
	// Audit 是实体自己的存储层审计轨迹（目前只有订单有），最旧的在前。
	Audit []map[string]any
}

// Finder 在一个域里按（已校验的）编号找实体。没找到 ⇒ (Match{}, false, nil)。
// 仓储不支持反查 ⇒ 返回 ErrUnsupported（Service 会跳过它，并且在没有别的命中时
// 报 LOOKUP_INCOMPLETE，而不是冒充「查无此号」）。
type Finder interface {
	Find(ctx context.Context, number string) (Match, bool, error)
}

// ErrUnsupported：这个域的仓储没有按编号反查的能力。
var ErrUnsupported = errors.New("number lookup not supported by this domain repository")

// Entry 是一次查询的审计行（operator.number_lookups）。
type Entry struct {
	OperatorID    string
	PrincipalID   string
	Number        string
	Reason        string
	Outcome       Outcome
	Kind          Kind
	EntityID      string
	CommandID     string
	CorrelationID string
	LookedUpAt    time.Time
}

// Recorder 追加一行审计。实现必须用命令所在的事务（ctx 里带的）写，返回错误 ⇒ 调用方
// 不得返回数据。
type Recorder interface {
	Record(ctx context.Context, entry Entry) error
}

const (
	minReasonRunes = 4
	maxReasonRunes = 200
	maxNumberRunes = 64
)

type Service struct {
	finders  []Finder
	recorder Recorder
	now      func() time.Time
}

// New 组装服务。recorder 为空 ⇒ 所有查询 fail-closed 拒绝（AUDIT_NOT_CONFIGURED）。
func New(recorder Recorder, finders ...Finder) *Service {
	return &Service{finders: finders, recorder: recorder, now: time.Now}
}

func (s *Service) SetClock(now func() time.Time) { s.now = now }

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "LookupPublicNumber":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "LookupPublicNumber":
		return s.lookup(ctx, e)
	default:
		return command.Rejected(e, "UNKNOWN_COMMAND", "VALIDATION", "AFTER_USER_ACTION", "numberlookup.unknown_command", nil)
	}
}

func (s *Service) lookup(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Number string `json:"number"`
		Reason string `json:"reason"`
	}
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_LOOKUP_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "numberlookup.invalid_request", nil)
	}
	reason := strings.TrimSpace(p.Reason)
	if n := utf8.RuneCountInString(reason); n < minReasonRunes || n > maxReasonRunes {
		// 没写理由不查：客服要写清是哪张工单 / 为什么查，事后才能对得上。
		return command.Rejected(e, "LOOKUP_REASON_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "numberlookup.reason_required", nil)
	}
	if s.recorder == nil {
		return command.Rejected(e, "AUDIT_NOT_CONFIGURED", "INTERNAL", "AFTER_USER_ACTION", "numberlookup.audit_not_configured", nil)
	}

	number, shapeOK := Normalize(p.Number)
	entry := Entry{
		OperatorID:  e.Actor.ID,
		PrincipalID: e.Principal.ID,
		// 审计行只存有界的输入：请求体上限 1MB，没必要让一次乱输入写进一行巨型文本。
		Number:        truncateRunes(number, maxNumberRunes),
		Reason:        reason,
		CommandID:     e.CommandID,
		CorrelationID: e.CorrelationID,
		LookedUpAt:    s.now().UTC(),
	}
	if !shapeOK || !ordernumber.Valid(number) {
		entry.Outcome = OutcomeInvalid
		if err := s.recorder.Record(ctx, entry); err != nil {
			return auditFailed(e, err)
		}
		hint := "NOT_A_PUBLIC_NUMBER"
		if shapeOK {
			hint = "CHECKSUM_MISMATCH" // 全数字、长度对，但校验位不对：多半是抄错了
		}
		return command.Rejected(e, "NUMBER_INVALID", "VALIDATION", "AFTER_USER_ACTION", "numberlookup.number_invalid", map[string]any{"hint": hint})
	}

	var hits []Match
	incomplete := false
	for _, finder := range s.finders {
		match, found, err := finder.Find(ctx, number)
		if errors.Is(err, ErrUnsupported) {
			incomplete = true
			continue
		}
		if err != nil {
			log.Printf("numberlookup: finder failed: number=%s err=%v", number, err)
			entry.Outcome = OutcomeError
			// 没有任何数据被披露，留痕失败不改变结论（仍是 LOOKUP_FAILED）。
			_ = s.recorder.Record(ctx, entry)
			return command.Rejected(e, "LOOKUP_FAILED", "INTERNAL", "SAFE_RETRY", "numberlookup.lookup_failed", nil)
		}
		if found {
			hits = append(hits, match)
		}
	}

	switch {
	case len(hits) > 1:
		log.Printf("numberlookup: INTEGRITY number %s resolves to %d entities", number, len(hits))
		entry.Outcome = OutcomeAmbiguous
		if err := s.recorder.Record(ctx, entry); err != nil {
			return auditFailed(e, err)
		}
		return command.Rejected(e, "NUMBER_AMBIGUOUS", "INTERNAL", "AFTER_OPERATOR_ACTION", "numberlookup.number_ambiguous", nil)
	case len(hits) == 0 && incomplete:
		entry.Outcome = OutcomeError
		_ = s.recorder.Record(ctx, entry)
		return command.Rejected(e, "LOOKUP_INCOMPLETE", "INTERNAL", "AFTER_OPERATOR_ACTION", "numberlookup.lookup_incomplete", nil)
	case len(hits) == 0:
		entry.Outcome = OutcomeNotFound
		if err := s.recorder.Record(ctx, entry); err != nil {
			return auditFailed(e, err)
		}
		return command.Rejected(e, "NUMBER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "numberlookup.number_not_found", nil)
	}

	hit := hits[0]
	entry.Outcome, entry.Kind, entry.EntityID = OutcomeFound, hit.Kind, hit.EntityID
	// 先留痕、再返回数据：留痕失败 ⇒ 不给数据，事务里其余写入随之回滚。
	if err := s.recorder.Record(ctx, entry); err != nil {
		return auditFailed(e, err)
	}
	audit := hit.Audit
	if audit == nil {
		audit = []map[string]any{}
	}
	entity := hit.Entity
	if entity == nil {
		entity = map[string]any{}
	}
	result := command.Accepted(e, "PublicNumber", number, 0, string(hit.Kind), nil)
	raw, _ := json.Marshal(map[string]any{
		"number":   number,
		"kind":     hit.Kind,
		"entityId": hit.EntityID,
		"state":    hit.State,
		"entity":   entity,
		"audit":    audit,
	})
	result.OperationRef = string(raw)
	return result
}

func auditFailed(e command.Envelope, err error) command.Result {
	log.Printf("numberlookup: audit write failed (no data returned): operator=%s err=%v", e.Actor.ID, err)
	return command.Rejected(e, "AUDIT_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "numberlookup.audit_write_failed", nil)
}

// Normalize 把客服从工单里抄来的编号规整成纯数字：允许空格、连字符、不换行空格作分隔
// （「2609 2900 0000 0099」「2609-2900-0000-0099」）。含其他字符（字母等）⇒ ok=false。
func Normalize(raw string) (string, bool) {
	var digits strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		switch {
		case r >= '0' && r <= '9':
			digits.WriteRune(r)
		case r == ' ' || r == '-' || r == ' ' || r == '\t':
		default:
			return strings.TrimSpace(raw), false
		}
	}
	return digits.String(), digits.Len() > 0
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

func decode(payload map[string]any, out any) bool {
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

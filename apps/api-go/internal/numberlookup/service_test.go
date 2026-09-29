package numberlookup

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// 一组真实的（内存）域服务，共用一个编号分配器 —— 和生产里共用一个序列一样。
type world struct {
	svc           *Service
	audit         *MemoryRecorder
	orderNo       string
	orderID       string
	participation string
	activityCode  string
	activityID    string
	opportunity   string
	opportunityID string
}

func newWorld(t *testing.T) *world {
	t.Helper()
	ctx := context.Background()
	numbers := ordernumber.NewMemory()
	w := &world{audit: NewMemoryRecorder()}

	repo := fulfillment.NewMemoryRepository()
	ff := fulfillment.NewWithRepository(repo).WithOrderNumbers(numbers)
	w.orderNo, _ = numbers.Next(ctx, ordernumber.CategoryService)
	w.orderID = "ord_lookup_1"
	order, err := fulfillment.MaterializedOrder(w.orderID, w.orderNo, "user_requester", "user_agent", "need_1", fulfillment.OrderSnapshot{
		ServiceSKU: "cc", StartTime: "周六 15:00", MeetingContext: "西湖", AgreedCompensation: 1_200_000, Currency: "VND",
	}, time.Date(2026, 9, 29, 3, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateOrder(fulfillment.WithAudit(ctx, fulfillment.AuditContext{ActorID: "user_requester", CommandType: "CreateOffer"}), order); err != nil {
		t.Fatal(err)
	}

	act := activity.New()
	act.SetOrderNumbers(numbers)
	published := act.HandleContext(ctx, env("PublishActivity", "host_1", map[string]any{
		"title": "西湖日落骑行", "time": "周六 15:00–18:00", "capacity": 6, "venueName": "西湖", "venueIcon": "🚲", "venueType": "LAKE",
		"realitySceneId": "scene_westlake", "consumptionTerm": "SPLIT",
	}))
	var pub struct {
		Activity activity.Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &pub); err != nil || published.Outcome != "ACCEPTED" {
		t.Fatalf("publish activity: %+v", published)
	}
	w.activityID, w.activityCode = pub.Activity.ID, pub.Activity.Code
	joinEnv := env("JoinActivity", "guest_1", map[string]any{"activityId": w.activityID})
	joined := act.HandleContext(ctx, joinEnv)
	var join struct {
		Participation activity.Participation `json:"participation"`
	}
	if err := json.Unmarshal([]byte(joined.OperationRef), &join); err != nil || joined.Outcome != "ACCEPTED" {
		t.Fatalf("join activity: %+v", joined)
	}
	w.participation = join.Participation.OrderNo

	market := marketplace.New()
	market.SetNumbers(numbers)
	opp := market.HandleContext(ctx, env("PublishMarketOpportunity", "owner_1", map[string]any{
		"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内 · 西湖", "price": "2,000,000₫", "skills": "中文", "targetUserId": "invitee_1",
	}))
	var oppBody struct {
		Opportunity marketplace.Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(opp.OperationRef), &oppBody); err != nil || opp.Outcome != "ACCEPTED" {
		t.Fatalf("publish opportunity: %+v", opp)
	}
	w.opportunity, w.opportunityID = oppBody.Opportunity.Number, oppBody.Opportunity.ID

	w.svc = New(w.audit, OrderFinder(ff), ParticipationFinder(act), ActivityFinder(act), OpportunityFinder(market))
	return w
}

func env(kind, actor string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_" + kind, CommandType: kind, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target: command.Target{Type: "Lookup", ID: "n/a"}, IdempotencyKey: "idem_" + kind + actor,
		CorrelationID: "corr_" + kind, RequestedAt: "2026-09-29T00:00:00Z", Payload: payload,
	}
}

func (w *world) lookup(number, reason string) command.Result {
	return w.svc.HandleContext(context.Background(), env(CommandType, "cs_agent_1", map[string]any{"number": number, "reason": reason}))
}

func body(t *testing.T, r command.Result) map[string]any {
	t.Helper()
	out := map[string]any{}
	if err := json.Unmarshal([]byte(r.OperationRef), &out); err != nil {
		t.Fatalf("decode body %q: %v", r.OperationRef, err)
	}
	return out
}

func rejected(r command.Result) string {
	if r.Error == nil {
		return ""
	}
	return r.Error.ErrorCode
}

// PUBLIC-NO-LOOKUP-001：四类全数字编号都能找回它指向的实体；客服拿到的是账号 id /
// 状态 / 条款，订单还带着存储层审计轨迹。
func TestLookupResolvesEveryPublicNumberKind(t *testing.T) {
	w := newWorld(t)
	cases := []struct {
		name, number string
		kind         Kind
		entityID     string
		state        string
	}{
		{"order", w.orderNo, KindOrder, w.orderID, "CONFIRMED"},
		{"participation", w.participation, KindActivityParticipation, w.activityID + "/guest_1", "CONFIRMED"},
		{"activity", w.activityCode, KindActivity, w.activityID, "PUBLISHED"},
		{"opportunity", w.opportunity, KindOpportunity, w.opportunityID, "INVITE"},
	}
	seen := map[string]bool{}
	for _, tc := range cases {
		if !ordernumber.Valid(tc.number) || seen[tc.number] {
			t.Fatalf("%s: fixture number must be a unique valid public number, got %q", tc.name, tc.number)
		}
		seen[tc.number] = true
		r := w.lookup(tc.number, "ticket-4213 客户报上来的号")
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("%s: %+v", tc.name, r.Error)
		}
		b := body(t, r)
		if b["kind"] != string(tc.kind) || b["entityId"] != tc.entityID || b["state"] != tc.state || b["number"] != tc.number {
			t.Fatalf("%s: wrong resolution %+v", tc.name, b)
		}
	}

	order := body(t, w.lookup(w.orderNo, "ticket-1"))
	entity := order["entity"].(map[string]any)
	if entity["requesterId"] != "user_requester" || entity["agentId"] != "user_agent" || entity["orderNo"] != w.orderNo {
		t.Fatalf("order entity must name both parties: %+v", entity)
	}
	trail := order["audit"].([]any)
	if len(trail) != 1 || trail[0].(map[string]any)["commandType"] != "CreateOffer" || trail[0].(map[string]any)["actorId"] != "user_requester" {
		t.Fatalf("order lookup must carry the storage audit trail: %+v", trail)
	}
	// 没有审计轨迹的实体也必须是 []，不是 null（wire 契约）。
	if got := body(t, w.lookup(w.opportunity, "ticket-2"))["audit"]; got == nil {
		t.Fatal("audit must be [] not null")
	}
}

// 客服从工单里抄号常带空格 / 连字符；规整后照样能查。
func TestLookupAcceptsSeparatorsInTheNumber(t *testing.T) {
	w := newWorld(t)
	spaced := w.orderNo[:4] + " " + w.orderNo[4:8] + "-" + w.orderNo[8:12] + " " + w.orderNo[12:]
	r := w.lookup(spaced, "ticket-1")
	if r.Outcome != "ACCEPTED" || body(t, r)["number"] != w.orderNo {
		t.Fatalf("separators must be tolerated: %+v", r)
	}
}

// 不是编号的东西（旧 PX-* 展示码、位数不对、类别码没登记、日期不存在）⇒ NUMBER_INVALID
// （告诉客服「这不是公共编号」）；结构成立但没分配过 ⇒ NUMBER_NOT_FOUND。编号没有校验位，
// 抄错一位结构仍成立的号只会是「查无」，这是用户定的口径的代价。
func TestLookupDistinguishesMalformedFromUnknownNumber(t *testing.T) {
	w := newWorld(t)
	for _, bad := range []string{"PX-A-260929-1234", "", "2609290000001236", "999260929100022000001", "100261399100022000001"} {
		r := w.lookup(bad, "ticket-1")
		if rejected(r) != "NUMBER_INVALID" || r.Error.SafeDetails["hint"] != "NOT_A_PUBLIC_NUMBER" {
			t.Fatalf("%q is not a public number: %+v", bad, r.Error)
		}
	}
	unknown := ordernumber.Format(ordernumber.CategoryService, time.Date(2026, 9, 29, 3, 0, 0, 0, time.UTC), 999_999)
	if r := w.lookup(unknown, "ticket-1"); rejected(r) != "NUMBER_NOT_FOUND" {
		t.Fatalf("well-formed but unassigned number: %+v", r.Error)
	}
}

// 没写理由不查 —— 事后要对得上是哪张工单、为什么查。
func TestLookupRequiresAReason(t *testing.T) {
	w := newWorld(t)
	for _, reason := range []string{"", "   ", "ab", strings.Repeat("字", maxReasonRunes+1)} {
		if r := w.lookup(w.orderNo, reason); rejected(r) != "LOOKUP_REASON_REQUIRED" {
			t.Fatalf("reason %q must be refused: %+v", reason, r)
		}
	}
	if len(w.audit.Entries()) != 0 {
		t.Fatal("a refused request looked nothing up, so it leaves no lookup row")
	}
}

// PUBLIC-NO-LOOKUP-AUDIT-001：每次查询（找到 / 没找到 / 号码不对）都留一行：谁、查了哪个号、
// 写的什么理由、什么结论。
func TestEveryLookupIsAudited(t *testing.T) {
	w := newWorld(t)
	w.svc.SetClock(func() time.Time { return time.Date(2026, 9, 29, 4, 0, 0, 0, time.UTC) })
	w.lookup(w.orderNo, "ticket-77 用户投诉")
	w.lookup(ordernumber.Format(ordernumber.CategoryService, time.Date(2026, 9, 29, 3, 0, 0, 0, time.UTC), 999_999), "ticket-78")
	w.lookup("123", "ticket-79")

	rows := w.audit.Entries()
	if len(rows) != 3 {
		t.Fatalf("3 lookups must leave 3 audit rows, got %d", len(rows))
	}
	found := rows[0]
	if found.Outcome != OutcomeFound || found.Kind != KindOrder || found.EntityID != w.orderID || found.OperatorID != "cs_agent_1" ||
		found.Number != w.orderNo || found.Reason != "ticket-77 用户投诉" || found.CommandID == "" || found.CorrelationID == "" ||
		!found.LookedUpAt.Equal(time.Date(2026, 9, 29, 4, 0, 0, 0, time.UTC)) {
		t.Fatalf("found row incomplete: %+v", found)
	}
	if rows[1].Outcome != OutcomeNotFound || rows[2].Outcome != OutcomeInvalid {
		t.Fatalf("outcomes: %+v", rows)
	}
}

// PUBLIC-NO-LOOKUP-AUDIT-001：留痕写不进去 ⇒ 不返回任何数据（fail-closed）。没配审计
// 记录器同样拒绝。
func TestLookupFailsClosedWhenAuditCannotBeWritten(t *testing.T) {
	w := newWorld(t)
	w.audit.Fail = errors.New("audit table unavailable")
	r := w.lookup(w.orderNo, "ticket-1")
	if rejected(r) != "AUDIT_WRITE_FAILED" || r.OperationRef != "" || r.Aggregate != nil {
		t.Fatalf("no audit row ⇒ no data: %+v", r)
	}
	w.audit.Fail = nil

	unaudited := New(nil, w.svc.finders...)
	r = unaudited.HandleContext(context.Background(), env(CommandType, "cs_agent_1", map[string]any{"number": w.orderNo, "reason": "ticket-1"}))
	if rejected(r) != "AUDIT_NOT_CONFIGURED" || r.OperationRef != "" {
		t.Fatalf("no recorder configured must fail closed: %+v", r)
	}
}

// 一个号查到两样东西是数据完整性事故：不猜，不返回任何一个，并且留痕。
func TestLookupRefusesAmbiguousNumbers(t *testing.T) {
	w := newWorld(t)
	clash := finderFunc(func(_ context.Context, number string) (Match, bool, error) {
		return Match{Kind: KindOpportunity, EntityID: "opp_dup", Entity: map[string]any{}}, true, nil
	})
	svc := New(w.audit, append([]Finder{clash}, w.svc.finders...)...)
	r := svc.HandleContext(context.Background(), env(CommandType, "cs_agent_1", map[string]any{"number": w.orderNo, "reason": "ticket-1"}))
	if rejected(r) != "NUMBER_AMBIGUOUS" || r.OperationRef != "" {
		t.Fatalf("ambiguous number must not disclose either entity: %+v", r)
	}
	if rows := w.audit.Entries(); len(rows) != 1 || rows[0].Outcome != OutcomeAmbiguous {
		t.Fatalf("ambiguity must be audited: %+v", rows)
	}
}

// 仓储不支持反查的域被跳过；没有别的命中时报「查询不完整」，绝不冒充「查无此号」。
func TestLookupNeverReportsNotFoundWhenADomainCouldNotBeSearched(t *testing.T) {
	w := newWorld(t)
	blind := finderFunc(func(context.Context, string) (Match, bool, error) { return Match{}, false, ErrUnsupported })
	unknown := ordernumber.Format(ordernumber.CategoryService, time.Date(2026, 9, 29, 3, 0, 0, 0, time.UTC), 999_999)

	partial := New(w.audit, blind)
	r := partial.HandleContext(context.Background(), env(CommandType, "cs_agent_1", map[string]any{"number": unknown, "reason": "ticket-1"}))
	if rejected(r) != "LOOKUP_INCOMPLETE" {
		t.Fatalf("an unsearchable domain must not read as 'not found': %+v", r)
	}
	// 别的域命中时照常返回。
	withHit := New(w.audit, append([]Finder{blind}, w.svc.finders...)...)
	if r := withHit.HandleContext(context.Background(), env(CommandType, "cs_agent_1", map[string]any{"number": w.orderNo, "reason": "ticket-1"})); r.Outcome != "ACCEPTED" {
		t.Fatalf("a hit in a searchable domain still answers: %+v", r)
	}
}

// 域读失败 ⇒ LOOKUP_FAILED（可重试），不是「查无此号」。
func TestLookupReportsReadFailureAsFailure(t *testing.T) {
	w := newWorld(t)
	broken := finderFunc(func(context.Context, string) (Match, bool, error) { return Match{}, false, errors.New("db down") })
	svc := New(w.audit, broken)
	r := svc.HandleContext(context.Background(), env(CommandType, "cs_agent_1", map[string]any{"number": w.orderNo, "reason": "ticket-1"}))
	if rejected(r) != "LOOKUP_FAILED" || r.Error.Retryability != "SAFE_RETRY" {
		t.Fatalf("read failure: %+v", r)
	}
}

func TestSupportsOnlyLookupCommand(t *testing.T) {
	w := newWorld(t)
	if !w.svc.Supports("LookupPublicNumber") || w.svc.Supports("ListMyOrders") {
		t.Fatal("Supports must be exactly LookupPublicNumber")
	}
	if r := w.svc.HandleContext(context.Background(), env("ListMyOrders", "x", nil)); rejected(r) != "UNKNOWN_COMMAND" {
		t.Fatalf("unknown command: %+v", r)
	}
}

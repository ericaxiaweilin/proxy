package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

type fakeInsight struct {
	gotAxis, gotWithAxis, gotWithValue string
	gap                                insight.DemandGap
}

func (f *fakeInsight) TopInterests(context.Context, time.Time, int) ([]insight.InterestRow, error) {
	return []insight.InterestRow{{Tag: "话题·摄影", Axis: "INTEREST_TOPIC", Value: "摄影", Users: 7, Score: .6, Confidence: .7}}, nil
}
func (f *fakeInsight) DemandGap(context.Context, time.Time, int) (insight.DemandGap, error) {
	return f.gap, nil
}
func (f *fakeInsight) Segments(_ context.Context, _ time.Time, axis, withAxis, withValue string) (insight.Segments, error) {
	f.gotAxis, f.gotWithAxis, f.gotWithValue = axis, withAxis, withValue
	return insight.Segments{Axis: axis}, nil
}

// OPS-INSIGHT-001：门、没配库时的诚实空态、轴名校验、不给供需比。
func TestInsightPagesAreOperatorOnlyAndHonestWhenNotWired(t *testing.T) {
	server := operatorConsoleServer()
	for _, path := range []string{"demand-gap", "insights"} {
		if rec := consoleGet(server, path, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without a session must be 401, got %d", path, rec.Code)
		}
		rec := consoleGet(server, path, "ops_token")
		var body map[string]any
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body["dataSource"] != OperatorNotConnectedSource {
			t.Fatalf("%s with no database must say NOT_CONNECTED: %d %s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestInsightsRejectsUnknownAxesAndLonelyWithParameters(t *testing.T) {
	server := operatorConsoleServer()
	f := &fakeInsight{}
	server.Insight = f
	if rec := consoleGet(server, "insights?axis=NOT_AN_AXIS", "ops_token"); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown axis must be 400, got %d", rec.Code)
	}
	if rec := consoleGet(server, "insights?withAxis=INTEREST_TOPIC", "ops_token"); rec.Code != http.StatusBadRequest {
		t.Fatalf("withAxis without withValue must be 400, got %d", rec.Code)
	}
	if rec := consoleGet(server, "insights?axis=INTEREST_TOPIC&withAxis=VENUE_KIND&withValue=咖啡", "ops_token"); rec.Code != http.StatusOK {
		t.Fatalf("valid query: %d", rec.Code)
	}
	if f.gotAxis != "INTEREST_TOPIC" || f.gotWithAxis != "VENUE_KIND" || f.gotWithValue != "咖啡" {
		t.Fatalf("parameters must reach the read model: %+v", f)
	}
}

func TestDemandGapNeverPublishesARatioAndSaysWhatItLeftOut(t *testing.T) {
	server := operatorConsoleServer()
	server.Insight = &fakeInsight{gap: insight.DemandGap{WindowDays: 30, NoLocation: 3, Directed: 2, Funnel: insight.Funnel{Published: 10}}}
	rec := consoleGet(server, "demand-gap", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	body := rec.Body.String()
	for _, banned := range []string{"supplyDemandRatio", "ratio", "coverageRate"} {
		if strings.Contains(body, `"`+banned+`"`) {
			t.Errorf("response must not carry a %s field", banned)
		}
	}
	for _, mustSay := range []string{"3 张单发出时没带坐标", "点名邀约的私单"} {
		if !strings.Contains(body, mustSay) {
			t.Errorf("notes must explain %q", mustSay)
		}
	}
}

// OPS-MATCH-PREVIEW-001：看的是具体的人，要 MARKETPLACE 权限；缺参数 400；没接线诚实说。
func TestMatchPreviewNeedsMarketplaceScopeAndAnOpportunity(t *testing.T) {
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all", "op_pay"}, map[string]map[OperatorScope]bool{"op_pay": {ScopePayments: true}})
	if rec := consoleGet(server, "match-preview?opportunityId=x", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: %d", rec.Code)
	}
	if rec := consoleGet(server, "match-preview?opportunityId=x", "op_pay_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("an operator without MARKETPLACE must not see individual candidates: %d", rec.Code)
	}
	rec := consoleGet(server, "match-preview?opportunityId=x", "op_all_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), OperatorNotConnectedSource) {
		t.Fatalf("unwired must say NOT_CONNECTED: %d %s", rec.Code, rec.Body.String())
	}
	server.MatchPreview = func(_ context.Context, id string, limit int) (MatchPreviewResult, error) {
		return MatchPreviewResult{OpportunityID: id, Candidates: []MatchPreviewItem{{Rank: 1, UserID: "u1"}}}, nil
	}
	if rec := consoleGet(server, "match-preview", "op_all_token"); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing opportunityId: %d", rec.Code)
	}
	rec = consoleGet(server, "match-preview?opportunityId=opp1", "op_all_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"userId":"u1"`) || !strings.Contains(rec.Body.String(), "共同兴趣的权重现在是 0") {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body.String())
	}
}

func TestBehaviorTopInterestsComeFromTheTagLayerOrSayWhyNot(t *testing.T) {
	server := operatorConsoleServer()
	body := func() string { return consoleGet(server, "behavior", "ops_token").Body.String() }
	if !strings.Contains(body(), "标签层没有接入") {
		t.Fatalf("without the tag layer the page must say so: %s", body())
	}
	server.Insight = &fakeInsight{}
	got := body()
	if !strings.Contains(got, "话题·摄影") || strings.Contains(got, "tag-service") {
		t.Fatalf("interests must come from the tag layer and the old 'not implemented' excuse must be gone: %s", got)
	}
}

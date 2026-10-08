package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/insight"
)

type fakeInsight struct {
	gotAxis, gotWithAxis, gotWithValue string
	gap                                 insight.DemandGap
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

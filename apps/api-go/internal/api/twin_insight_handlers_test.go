package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/twininsight"
)

// TWIN-INSIGHT-002 —— HTTP 层。
//
// 这里钉的是**门禁**，不是数据口径（口径在 internal/twininsight 里钉）：
//   - 读端点也要会话 + 分身归属（PRD 写的是匿名，这里刻意偏离，理由见
//     twin_insight_handlers.go 顶部）；
//   - 写端点：无 token 401、目标不是好友 404、依赖没接 503、动作非法 400；
//   - 过了闸就真的落一行审计。
//
// 另外钉一条最容易被破坏的：**任何失败都不许返回编造的洞察**。

type twinInsightFixture struct {
	server     *Server
	twinID     string
	ownerToken string
	otherToken string
	actionLog  *twininsight.MemoryActionLog
	friends    *twininsight.MemoryFriendSource
}

func newTwinInsightFixture(t *testing.T) twinInsightFixture {
	t.Helper()
	personaSvc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	personaSvc.SetAgeLookup(twinCenterAdultLookup{})
	persona, err := personaSvc.CreatePersona(context.Background(), aipersona.Persona{
		OwnerID:    "user_insight_owner",
		DisplayName: "Insight Twin",
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}

	repo := twininsight.NewMemoryRepository()
	repo.Seed("user_insight_owner", twininsight.Facts{
		Signals: []twininsight.SignalFact{
			{ActorID: "friend_linh", Messages7d: 14},
			{ActorID: "friend_mai"},
		},
	})
	friends := twininsight.NewMemoryFriendSource()
	friends.Set("user_insight_owner", []twininsight.Friend{
		{UserID: "friend_linh", DisplayName: "Linh"},
		{UserID: "friend_mai", DisplayName: "Mai"},
	})

	svc := twininsight.New(repo, friends, func(context.Context) (twininsight.Thresholds, error) {
		return twininsight.DefaultThresholds(), nil
	})
	actionLog := twininsight.NewMemoryActionLog()
	svc.SetActionLog(actionLog)
	svc.SetCompanionGate(func(context.Context, string) error { return nil })
	// 使用权门禁默认放行；拒绝路径由 TestTwinInsights*DeniedWithoutEntitlement 钉。
	svc.SetViewerGate(func(context.Context, string) error { return nil })

	server := &Server{
		AIPersona:   personaSvc,
		TwinInsight: svc,
		Authenticator: strictAuthenticator{validTokens: map[string]identity.AuthenticatedSession{
			"owner_token": {
				Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_insight_owner"},
			},
			"intruder_token": {
				Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_insight_intruder"},
			},
		}},
	}
	return twinInsightFixture{
		server: server, twinID: persona.ID,
		ownerToken: "owner_token", otherToken: "intruder_token",
		actionLog: actionLog, friends: friends,
	}
}

func twinInsightRequest(method, path, token, body string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

// TestTwinInsightsReadRequiresSession:
// PRD §4 把读标成匿名，这里**刻意**不照做（payload 是第三方行为数据）。
// 这条用例就是那个偏离的守卫 —— 将来有人按 PRD 放开匿名读，这里会红。
func TestTwinInsightsReadRequiresSession(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodGet, "/v1/ai/twins/"+fx.twinID+"/insights", "", ""))
	if recorder.Code != http.StatusUnauthorized {
		t.Errorf("anonymous read must be rejected, got %d", recorder.Code)
	}
}

func TestTwinInsightsReadRejectsNonOwner(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodGet, "/v1/ai/twins/"+fx.twinID+"/insights", fx.otherToken, ""))
	if recorder.Code != http.StatusForbidden {
		t.Errorf("non-owner read must be 403, got %d", recorder.Code)
	}
}

func TestTwinInsightsListReturnsRealFriends(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodGet, "/v1/ai/twins/"+fx.twinID+"/insights", fx.ownerToken, ""))
	if recorder.Code != http.StatusOK {
		t.Fatalf("owner read must be 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload twininsight.Payload
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("payload must be valid JSON: %v (%s)", err, recorder.Body.String())
	}
	if payload.TwinID != fx.twinID {
		t.Errorf("twinId = %q, want %q", payload.TwinID, fx.twinID)
	}
	// 两个 actor 都是好友：Linh 有 14 条真实消息，Mai 无信号。
	//（TWIN-INSIGHT-TARGETS-001 之后，有信号的陌生人也会出现 —— 这里不断言
	// "非好友不许出现"，只断言好友都在且数字是真的；陌生人由 service 层钉。）
	if len(payload.Insights) != 2 {
		t.Fatalf("expected the 2 real friends, got %d", len(payload.Insights))
	}
	names := map[string]bool{}
	for _, insight := range payload.Insights {
		names[insight.DisplayName] = true
	}
	if !names["Linh"] || !names["Mai"] {
		t.Errorf("expected real friend names Linh/Mai, got %v", names)
	}
	// Linh 有 14 条真实消息 → 分数必须 > 0；Mai 没信号 → 0。
	for _, insight := range payload.Insights {
		if insight.DisplayName == "Linh" && insight.Signals.Messages7d != 14 {
			t.Errorf("Linh messages = %d, want the real 14", insight.Signals.Messages7d)
		}
		if insight.DisplayName == "Mai" && insight.Score != 0 {
			t.Errorf("Mai has no signal, score must be 0, got %d", insight.Score)
		}
	}
	if payload.Thresholds.ConfigVersion < 1 {
		t.Errorf("thresholds must carry a configVersion, got %+v", payload.Thresholds)
	}
}

func TestTwinInsightDetailRejectsNonFriend(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodGet, "/v1/ai/twins/"+fx.twinID+"/insights/stranger_9", fx.ownerToken, ""))
	if recorder.Code != http.StatusNotFound {
		t.Errorf("a non-friend target must be 404, got %d", recorder.Code)
	}
}

func TestTwinInsightOperateRequiresSession(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/targets/friend_linh/operate"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, "", `{"action":"operate"}`))
	if recorder.Code != http.StatusUnauthorized {
		t.Errorf("operate without a token must be 401, got %d", recorder.Code)
	}
	if len(fx.actionLog.All()) != 0 {
		t.Errorf("unauthenticated action must not be recorded, got %d rows", len(fx.actionLog.All()))
	}
}

func TestTwinInsightOperateRecordsAuditableRow(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/targets/friend_linh/operate"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, fx.ownerToken, `{"action":"operate"}`))
	if recorder.Code != http.StatusOK {
		t.Fatalf("operate must be 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var result twininsight.OperateResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("result must be valid JSON: %v", err)
	}
	if result.TargetID != "friend_linh" || result.Action != twininsight.ActionOperate || result.ActedAt == "" {
		t.Errorf("result mismatch: %+v", result)
	}
	rows := fx.actionLog.All()
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	if rows[0].OwnerID != "user_insight_owner" || rows[0].TwinID != fx.twinID {
		t.Errorf("audit row must carry owner+twin, got %+v", rows[0])
	}
}

func TestTwinInsightOperateRejectsUnknownAction(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/targets/friend_linh/operate"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, fx.ownerToken, `{"action":"delete_everything"}`))
	if recorder.Code != http.StatusBadRequest {
		t.Errorf("unknown action must be 400, got %d", recorder.Code)
	}
	if len(fx.actionLog.All()) != 0 {
		t.Errorf("a rejected action must not be recorded, got %d rows", len(fx.actionLog.All()))
	}
}

func TestTwinInsightOperateRejectsNonFriendTarget(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/targets/stranger_9/operate"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, fx.ownerToken, `{"action":"observe"}`))
	if recorder.Code != http.StatusNotFound {
		t.Errorf("non-friend target must be 404, got %d", recorder.Code)
	}
	if len(fx.actionLog.All()) != 0 {
		t.Errorf("a rejected action must not be recorded, got %d rows", len(fx.actionLog.All()))
	}
}

// TestTwinInsightOperateFailsClosedWhenLogUnwired：审计没接 → 503，
// 绝不留"点了按钮但没留痕"的口子。
func TestTwinInsightOperateFailsClosedWhenLogUnwired(t *testing.T) {
	fx := newTwinInsightFixture(t)
	// 换成一个没接审计的 service（使用权照常放行：这里只缺审计）。
	bare := twininsight.New(twininsight.NewMemoryRepository(), fx.friends,
		func(context.Context) (twininsight.Thresholds, error) { return twininsight.DefaultThresholds(), nil })
	bare.SetCompanionGate(func(context.Context, string) error { return nil })
	bare.SetViewerGate(func(context.Context, string) error { return nil })
	fx.server.TwinInsight = bare
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/targets/friend_linh/operate"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, fx.ownerToken, `{"action":"operate"}`))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Errorf("operate without an audit log must be 503, got %d", recorder.Code)
	}
}

// TestTwinInsightSummaryFailsClosedWhenModelStackUnwired：
// 模型底座没接 → 503。绝不能返回一段规则拼出来的话冒充"已重新总结"。
func TestTwinInsightSummaryFailsClosedWhenModelStackUnwired(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/insights/friend_linh/summary:refresh"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, fx.ownerToken, `{}`))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Errorf("summary:refresh without a model stack must be 503, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestTwinInsightUnknownSubPathIsNotFound(t *testing.T) {
	fx := newTwinInsightFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodGet, "/v1/ai/twins/"+fx.twinID+"/nonsense", fx.ownerToken, ""))
	if recorder.Code != http.StatusNotFound {
		t.Errorf("unknown sub-path must be 404, got %d", recorder.Code)
	}
}

// TWIN-INSIGHT-ENTITLEMENT-001 —— HTTP 层：没使用权的账号读和写都是 403，
// 且 body code 可区分（客户端照实说"仅向认证创作者开放"，不许折叠成
// 未成年或服务故障）。
func TestTwinInsightsListDeniedWithoutEntitlement(t *testing.T) {
	fx := newTwinInsightFixture(t)
	fx.server.TwinInsight.SetViewerGate(func(context.Context, string) error {
		return twininsight.ErrInsightViewerForbidden
	})
	recorder := httptest.NewRecorder()
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodGet, "/v1/ai/twins/"+fx.twinID+"/insights", fx.ownerToken, ""))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("unentitled read must be 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("403 body must be valid JSON: %v", err)
	}
	if body["error"] != "insight_viewer_forbidden" {
		t.Errorf("403 code must be insight_viewer_forbidden, got %q", body["error"])
	}
}

func TestTwinInsightOperateDeniedWithoutEntitlement(t *testing.T) {
	fx := newTwinInsightFixture(t)
	fx.server.TwinInsight.SetViewerGate(func(context.Context, string) error {
		return twininsight.ErrInsightViewerForbidden
	})
	recorder := httptest.NewRecorder()
	path := "/v1/ai/twins/" + fx.twinID + "/targets/friend_linh/operate"
	fx.server.routeTwinInsight(recorder, twinInsightRequest(http.MethodPost, path, fx.ownerToken, `{"action":"operate"}`))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("unentitled operate must be 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if len(fx.actionLog.All()) != 0 {
		t.Errorf("entitlement-rejected action must not be recorded, got %d rows", len(fx.actionLog.All()))
	}
}

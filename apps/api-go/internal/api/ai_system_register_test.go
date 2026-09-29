package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aisystem"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/compliance"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// AI-SYSTEM-REGISTER-001 的读口测试。
//
// 这一组测试刻意**穿过 mux**（srv.Handler().ServeHTTP），不是直接调 handler
// 函数 —— 直接调函数会绕过路由匹配，于是「路由根本没接上」这类缺陷测不出来。
// COMP-KILLSWITCH-REARM-001 就是这么漏过去的（服务层有测试，HTTP 口没有）。
func aiSystemRegisterServer() *Server {
	return &Server{
		RateLimit: NewRateLimiter(0, 100),
		Operator:  NewStaticOperatorGate([]string{"user_ops"}),
		Authenticator: strictAuthenticator{validTokens: map[string]identity.AuthenticatedSession{
			"ops_token":  {Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_ops"}},
			"user_token": {Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_xiaomei"}},
		}},
	}
}

func aiSystemGet(srv *Server, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

func TestAISystemRegisterRequiresOperator(t *testing.T) {
	srv := aiSystemRegisterServer()
	for _, path := range []string{"/v1/operator/ai/systems", "/v1/operator/ai/systems/" + string(aisystem.SystemAIPersona)} {
		if rec := aiSystemGet(srv, path, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s 无会话应为 401，实得 %d", path, rec.Code)
		}
		if rec := aiSystemGet(srv, path, "user_token"); rec.Code != http.StatusForbidden {
			t.Errorf("%s 非运营应为 403，实得 %d", path, rec.Code)
		}
	}
}

func TestAISystemRegisterListsEveryRegisteredSystem(t *testing.T) {
	srv := aiSystemRegisterServer()
	rec := aiSystemGet(srv, "/v1/operator/ai/systems", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("期望 200，实得 %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Systems []struct {
			ID          string `json:"id"`
			Tier        string `json:"tier"`
			TierIsLegal bool   `json:"tierIsLegal"`
			ReadyForUse bool   `json:"readyForUse"`
			Blockers    []struct {
				Code string `json:"code"`
				Law  string `json:"law"`
			} `json:"blockers"`
		} `json:"systems"`
		Summary struct {
			Total    int `json:"total"`
			Blocked  int `json:"blocked"`
			Notified int `json:"notifiedToMoST"`
		} `json:"summary"`
		NotificationAuthority string `json:"notificationAuthority"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应不是 JSON: %v", err)
	}

	if body.Summary.Total != len(aisystem.AllSystemIDs) {
		t.Errorf("summary.total=%d，登记册有 %d 条", body.Summary.Total, len(aisystem.AllSystemIDs))
	}
	seen := map[string]bool{}
	for _, s := range body.Systems {
		seen[s.ID] = true
		if !s.TierIsLegal {
			t.Errorf("系统 %s 的 tier=%q 不是法定等级", s.ID, s.Tier)
		}
		// ReadyForUse=false 必须带 blocker —— 否则运维只看到一个 false，看不到原因。
		if !s.ReadyForUse && len(s.Blockers) == 0 {
			t.Errorf("系统 %s readyForUse=false 却没有任何 blocker", s.ID)
		}
		for _, b := range s.Blockers {
			if strings.TrimSpace(b.Law) == "" {
				t.Errorf("系统 %s 的 blocker %s 没有法律出处", s.ID, b.Code)
			}
		}
	}
	for _, id := range aisystem.AllSystemIDs {
		if !seen[string(id)] {
			t.Errorf("登记册里的 %s 没有出现在接口返回里", id)
		}
	}
	if body.NotificationAuthority == "" {
		t.Error("响应必须带上 Điều 10.3 的受理机关，否则运维要去翻代码")
	}
}

// 三个真相必须长得不一样：查得到 + 已分级 / 查得到 + 未分级 / 查不到。
func TestAISystemItemDistinguishesNotFoundFromUnhealthy(t *testing.T) {
	srv := aiSystemRegisterServer()

	ok := aiSystemGet(srv, "/v1/operator/ai/systems/"+string(aisystem.SystemAIFaceFeatureInference), "ops_token")
	if ok.Code != http.StatusOK {
		t.Fatalf("已登记系统应为 200，实得 %d", ok.Code)
	}
	var healthy struct {
		System struct {
			ID          string   `json:"id"`
			Tier        string   `json:"tier"`
			TierIsLegal bool     `json:"tierIsLegal"`
			Missing     []string `json:"missing"`
		} `json:"system"`
	}
	if err := json.Unmarshal(ok.Body.Bytes(), &healthy); err != nil {
		t.Fatalf("不是 JSON: %v", err)
	}
	if healthy.System.Tier != string(aisystem.TierHigh) {
		t.Errorf("面部特征推理系统应为 HIGH，实得 %q", healthy.System.Tier)
	}
	if len(healthy.System.Missing) == 0 {
		t.Error("面部特征推理系统今天缺 Điều 67.2(đ) 的保护措施，missing 不能为空")
	}

	missing := aiSystemGet(srv, "/v1/operator/ai/systems/NO_SUCH_SYSTEM", "ops_token")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("未登记系统应为 404，实得 %d —— 不能和「系统有问题」共用一个响应", missing.Code)
	}
	var notFound struct {
		Error    string `json:"error"`
		Blockers []struct {
			Code string `json:"code"`
		} `json:"blockers"`
	}
	if err := json.Unmarshal(missing.Body.Bytes(), &notFound); err != nil {
		t.Fatalf("不是 JSON: %v", err)
	}
	if notFound.Error != "ai_system_not_registered" {
		t.Errorf("error=%q，want ai_system_not_registered", notFound.Error)
	}
	if len(notFound.Blockers) != 1 || notFound.Blockers[0].Code != string(aisystem.BlockerNotRegistered) {
		t.Errorf("未登记系统的 blocker 应为 NOT_REGISTERED，实得 %+v", notFound.Blockers)
	}
}

// COMP-KILLSWITCH-REARM-001：法务 kill switch 的解除口必须真的能走通。
//
// 修之前 operatorKillSwitchRearm 用 r.PathValue("category")，而本仓的 mux
// 上没有任何带 {name} 的 pattern —— PathValue 恒为空串，NormalizeCategory("")
// 必然失败，DELETE 口从上线起只会返回 400。后果是：开关一旦武装就再也卸不掉。
//
// 这条测试穿过 mux 打真实的 DELETE 路径。把修复退回去（改回 PathValue），
// 它会立刻变红。
func TestKillSwitchRearmRouteActuallyRearms(t *testing.T) {
	complianceService := compliance.NewService(compliance.NewMemoryRepository(time.Now))
	srv := aiSystemRegisterServer()
	srv.Compliance = complianceService

	// 先武装 AI_MEDIA。
	if _, err := complianceService.Kill(
		httptest.NewRequest(http.MethodGet, "/", nil).Context(),
		compliance.CategoryAIMedia, "test incident", "user_ops", nil,
	); err != nil {
		t.Fatalf("Kill: %v", err)
	}
	if enabled := complianceService.IsEnabled(
		httptest.NewRequest(http.MethodGet, "/", nil).Context(),
		compliance.CategoryAIMedia,
	); enabled {
		t.Fatal("武装之后 IsEnabled 应为 false")
	}

	// 通过 HTTP DELETE 解除。
	req := httptest.NewRequest(http.MethodDelete, "/v1/operator/legal/kill-switch/AI_MEDIA", nil)
	req.Header.Set("Authorization", "Bearer ops_token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE 解除应为 200，实得 %d body=%s —— 开关武装后卸不掉", rec.Code, rec.Body.String())
	}

	if enabled := complianceService.IsEnabled(
		httptest.NewRequest(http.MethodGet, "/", nil).Context(),
		compliance.CategoryAIMedia,
	); !enabled {
		t.Fatal("解除之后 IsEnabled 应重新为 true")
	}
}

// 路由大小写/空路径的边界：不带 category 必须 400 而不是 panic 或 500。
func TestKillSwitchRearmRejectsMissingCategory(t *testing.T) {
	complianceService := compliance.NewService(compliance.NewMemoryRepository(time.Now))
	srv := aiSystemRegisterServer()
	srv.Compliance = complianceService

	req := httptest.NewRequest(http.MethodDelete, "/v1/operator/legal/kill-switch/", nil)
	req.Header.Set("Authorization", "Bearer ops_token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("缺 category 应为 400，实得 %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "category_required") {
		t.Errorf("缺 category 的响应应说明原因，实得 %s", rec.Body.String())
	}
}

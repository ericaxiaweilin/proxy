package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/proxy-app/proxy-api/internal/providerapp"
)

// PROVIDER-APPLY-001：「申请成为小美」。
//
//	GET  /v1/provider-application               本人最近一份申请（没有 = application: null）+ 表单可选值
//	POST /v1/provider-application               提交
//	POST /v1/provider-application/withdraw      撤回（只在审核中可撤）
//	GET  /v1/provider-application/stats         接单权限状态 + 本人履约记录（我的订单顶部面板）
//	POST /v1/provider-application/phone/request 发验证码（KYC-PHONE-ONLY-001）
//	POST /v1/provider-application/phone/verify  验证码校验，成功返回可以带进 Submit 的 challengeId
//
// 运营（operatorConsole 同一道门）：
//
//	GET  /v1/operator/provider-applications?status=SUBMITTED
//	POST /v1/operator/provider-applications/review  {applicationId, decision: APPROVE|REJECT, reason}
func (s *Server) routeProviderApplication(w http.ResponseWriter, r *http.Request) {
	if s.ProviderApps == nil || s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider_application_unavailable"})
		return
	}
	rawToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return
	}
	auth, err := s.Authenticator.Authenticate(r.Context(), rawToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
		return
	}
	userID := auth.Principal.ID
	path := strings.TrimSuffix(r.URL.Path, "/")
	var app *providerapp.Application
	switch {
	case path == "/v1/provider-application" && r.Method == http.MethodGet:
		app, err = s.ProviderApps.Mine(r.Context(), userID)
	case path == "/v1/provider-application" && r.Method == http.MethodPost:
		var in providerapp.Input
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
			return
		}
		app, err = s.ProviderApps.Submit(r.Context(), userID, in)
	case path == "/v1/provider-application/stats" && r.Method == http.MethodGet:
		// ORDER-CENTER-STATS-001：「我的订单」顶部接单面板 —— 接单权限状态 + 真实履约记录。
		mine, err := s.ProviderApps.Mine(r.Context(), userID)
		if err != nil {
			writeProviderAppError(w, err)
			return
		}
		stats, err := s.ProviderApps.Stats(r.Context(), userID)
		if err != nil {
			writeProviderAppError(w, err)
			return
		}
		status := "NONE"
		if mine != nil {
			status = mine.Status
		}
		writeJSON(w, http.StatusOK, map[string]any{"permission": status, "stats": stats})
		return
	case path == "/v1/provider-application/withdraw" && r.Method == http.MethodPost:
		app, err = s.ProviderApps.Withdraw(r.Context(), userID)
	case path == "/v1/provider-application/phone/request" && r.Method == http.MethodPost:
		var body struct {
			Phone string `json:"phone"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
			return
		}
		challenge, cErr := s.ProviderApps.RequestPhoneVerification(r.Context(), userID, body.Phone)
		if cErr != nil {
			writeProviderAppError(w, cErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"challengeId": challenge.ID, "expiresAt": challenge.ExpiresAt})
		return
	case path == "/v1/provider-application/phone/verify" && r.Method == http.MethodPost:
		var body struct {
			ChallengeID string `json:"challengeId"`
			Code        string `json:"code"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
			return
		}
		challenge, cErr := s.ProviderApps.VerifyPhoneVerification(r.Context(), userID, body.ChallengeID, body.Code)
		if cErr != nil {
			writeProviderAppError(w, cErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"verified": true, "phone": challenge.Phone})
		return
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	if err != nil {
		writeProviderAppError(w, err)
		return
	}
	body := map[string]any{
		"application": providerapp.ForApplicant(app),
		"options": map[string]any{
			"serviceAreas": providerapp.AllowedAreas, "languages": providerapp.AllowedLanguages, "minAge": providerapp.MinAge,
		},
	}
	if terms, err := ProviderTermsLoader()(); err == nil {
		body["terms"] = terms
	}
	writeJSON(w, http.StatusOK, body)
}

func writeProviderAppError(w http.ResponseWriter, err error) {
	var v *providerapp.ValidationError
	switch {
	case errors.As(err, &v):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "invalid_fields", "fields": v.Fields})
	case errors.Is(err, providerapp.ErrAlreadyOpen):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already_open"})
	case errors.Is(err, providerapp.ErrNotWithdrawable), errors.Is(err, providerapp.ErrNotReviewable):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "wrong_status"})
	case errors.Is(err, providerapp.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	case errors.Is(err, providerapp.ErrUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider_application_unavailable"})
	case errors.Is(err, providerapp.ErrPhoneChallenge):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "phone_challenge_invalid"})
	case errors.Is(err, providerapp.ErrPhoneProviderGap):
		log.Printf("provider application: phone provider not ready: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "phone_provider_not_configured"})
	default:
		log.Printf("provider application: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "provider_application_failed"})
	}
}

func (s *Server) operatorProviderApplications(w http.ResponseWriter, r *http.Request) {
	if s.ProviderApps == nil {
		notConnected("小美申请（没有配数据库）", "")(w, r)
		return
	}
	apps, err := s.ProviderApps.List(r.Context(), strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status"))), 100)
	if err != nil {
		writeProviderAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "applications": apps})
}

func (s *Server) operatorProviderApplicationReview(w http.ResponseWriter, r *http.Request) {
	if s.ProviderApps == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider_application_unavailable"})
		return
	}
	// operatorConsoleMethod 已经验过会话 + 运营白名单；这里再取一次身份只为记下审核人。
	reviewer := "operator"
	if raw, ok := bearerToken(r.Header.Get("Authorization")); ok {
		if auth, err := s.Authenticator.Authenticate(r.Context(), raw); err == nil {
			reviewer = auth.Principal.ID
		}
	}
	var body struct {
		ApplicationID string `json:"applicationId"`
		Decision      string `json:"decision"`
		Reason        string `json:"reason"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil ||
		(body.Decision != "APPROVE" && body.Decision != "REJECT") || strings.TrimSpace(body.ApplicationID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	app, err := s.ProviderApps.Review(r.Context(), body.ApplicationID, reviewer, body.Decision == "APPROVE", body.Reason)
	if err != nil {
		writeProviderAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"application": app})
}

// ProviderTermsLoader：履约条款文件（PROVIDER_TERMS_DIR 可覆盖，默认仓库里的 config/provider-terms）。
func ProviderTermsLoader() func() (providerapp.Terms, error) {
	return func() (providerapp.Terms, error) {
		dir := strings.TrimSpace(os.Getenv("PROVIDER_TERMS_DIR"))
		if dir == "" {
			dir = resolveRepoDir("config/provider-terms")
		}
		return providerapp.LoadTerms(filepath.Join(dir, "terms.json"))
	}
}

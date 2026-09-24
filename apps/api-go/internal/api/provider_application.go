package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/proxy-app/proxy-api/internal/providerapp"
)

// PROVIDER-APPLY-001：「申请成为小美」。
//
//	GET  /v1/provider-application           本人最近一份申请（没有 = application: null）+ 表单可选值
//	POST /v1/provider-application           提交
//	POST /v1/provider-application/withdraw  撤回（只在审核中可撤）
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
	case path == "/v1/provider-application/withdraw" && r.Method == http.MethodPost:
		app, err = s.ProviderApps.Withdraw(r.Context(), userID)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	if err != nil {
		writeProviderAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"application": providerapp.ForApplicant(app),
		"options": map[string]any{
			"serviceAreas": providerapp.AllowedAreas, "languages": providerapp.AllowedLanguages,
			"capabilities": providerapp.AllowedCapabilities, "minPhotos": providerapp.MinPhotos, "maxPhotos": providerapp.MaxPhotos,
		},
	})
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

package api

// R16.9: GET /v1/legal/{terms,privacy} static-serve the legal documents
// the signup gate points at. The files live at docs/legal/vietnam/*.txt
// and are baked into the server binary via go:embed so the operator does
// not have to manage a separate static-files directory at deploy time.
// The current version is the Vietnam v1.1 (2026-08-31) draft supplied by
// counsel; the version string is also returned in the JSON envelope so
// the mobile client can show the user which revision they accepted.

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

//go:embed legal_docs/terms_v1.1.txt
var termsV11Text string

//go:embed legal_docs/privacy_v1.1.txt
var privacyV11Text string

const legalDocVersion = "1.1"

type legalDocEnvelope struct {
	Kind        string    `json:"kind"`
	Version     string    `json:"version"`
	Locale      string    `json:"locale"`
	Title       string    `json:"title"`
	EffectiveAt string    `json:"effectiveAt"`
	ContentSHA256 string  `json:"contentSha256"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Content     string    `json:"content"`
}

// legalDoc serves a single legal document by kind. Anonymous, public,
// rate-limited; the body is small (~45 KB combined) so we serve plain
// UTF-8 text. The mobile signup flow uses the JSON envelope to confirm
// the version the user is accepting matches the privacy_consent_records
// row that the server will later persist.
func (s *Server) legalDoc(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	// R16.9 path is /v1/legal/{terms,privacy}; the mux pattern strips
	// /v1/legal/ so the remaining segment is "terms" or "privacy".
	kind := strings.ToLower(strings.TrimPrefix(r.URL.Path, "/v1/legal/"))
	kind = strings.TrimSuffix(kind, ".json")
	if kind != "terms" && kind != "privacy" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown_legal_doc"})
		return
	}
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":public_legal") {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "60")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	body, title := termsV11Text, "PROXY 服务使用协议"
	if kind == "privacy" {
		body, title = privacyV11Text, "PROXY 隐私政策及个人数据处理通知"
	}
	sum := sha256.Sum256([]byte(body))
	env := legalDocEnvelope{
		Kind:           kind,
		Version:        legalDocVersion,
		Locale:         "vi-VN",
		Title:          title,
		EffectiveAt:    "[YYYY-MM-DD]",
		ContentSHA256:  hex.EncodeToString(sum[:]),
		UpdatedAt:      time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC),
		Content:        body,
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	if err := json.NewEncoder(w).Encode(env); err != nil {
		// Already started writing — best-effort.
		return
	}
}

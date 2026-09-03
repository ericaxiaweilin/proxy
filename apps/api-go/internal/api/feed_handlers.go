package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// publicFeed is the cacheable anonymous read projection for edge delivery.
// Commands remain the write boundary; Cloudflare must not cache command POSTs.
func (s *Server) publicFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.LocalNet == nil {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "feed_not_configured"})
		return
	}
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":public_feed") {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "60")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 1024 {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_cursor"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 25
	}
	// R15.94: 透传 search query (server 端 filter, 跟 R15.92 client filter 兼容).
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	now := time.Now().UTC()
	readTimeout := s.ReadTimeout
	if readTimeout <= 0 {
		readTimeout = 4 * time.Second
	}
	readContext, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	feedPayload := map[string]any{"cursor": cursor, "limit": limit}
	if search != "" {
		feedPayload["search"] = search
	}
	result := s.LocalNet.HandleContext(readContext, command.Envelope{
		CommandID: "public_feed_" + strconv.FormatInt(now.UnixNano(), 36), CommandType: "ListFeedPosts", CommandVersion: 1,
		Actor: command.Actor{Type: "PUBLIC", ID: "anonymous_reader"}, Principal: command.Principal{Type: "PUBLIC", ID: "anonymous_reader"},
		Target: command.Target{Type: "Feed", ID: "public"}, Purpose: "public_feed_read", RequestedAt: now.Format(time.RFC3339Nano),
		Payload: feedPayload,
	})
	if result.Error != nil && result.Error.ErrorCode == "INVALID_CURSOR" {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_cursor"})
		return
	}
	if result.Outcome != "ACCEPTED" || result.OperationRef == "" || !json.Valid([]byte(result.OperationRef)) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "feed_temporarily_unavailable"})
		return
	}
	payload := []byte(result.OperationRef)
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(payload))
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=120, stale-if-error=86400")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", etag)
	w.Header().Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

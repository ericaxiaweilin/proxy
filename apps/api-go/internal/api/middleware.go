package api

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// versionMiddleware enforces minimum app version when PROXY_MIN_APP_VERSION is set.
// Clients must send X-Proxy-App-Version (e.g. 1.0.0); older clients receive 426 Upgrade Required.
func (s *Server) versionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		minVersion := strings.TrimSpace(os.Getenv("PROXY_MIN_APP_VERSION"))
		if minVersion == "" {
			next.ServeHTTP(w, r)
			return
		}
		// Health probes are version-agnostic
		if r.URL.Path == "/health/live" || r.URL.Path == "/health/ready" {
			next.ServeHTTP(w, r)
			return
		}
		clientVersion := strings.TrimSpace(r.Header.Get("X-Proxy-App-Version"))
		if clientVersion == "" {
			// 未带版本头的旧客户端视为需升级（但匿名 GET 仍放行以便引导页/访客 feed 可读）
			if r.URL.Path == "/v1/facet/objects" || r.URL.Path == "/v1/feed" || r.URL.Path == "/health/live" || r.URL.Path == "/health/ready" {
				next.ServeHTTP(w, r)
				return
			}
			// facet 副空间及 catalog 也是匿名可读的引导页相关
			if strings.HasPrefix(r.URL.Path, "/v1/facet/") {
				next.ServeHTTP(w, r)
				return
			}
			writeJSON(w, http.StatusUpgradeRequired, map[string]string{"error": "app_version_required", "min_version": minVersion})
			return
		}
		if compareVersion(clientVersion, minVersion) < 0 {
			writeJSON(w, http.StatusUpgradeRequired, map[string]string{"error": "app_version_too_old", "min_version": minVersion, "client_version": clientVersion})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func compareVersion(a, b string) int {
	parse := func(s string) []int {
		parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
		out := make([]int, 3)
		for i := 0; i < 3 && i < len(parts); i++ {
			n, _ := strconv.Atoi(strings.TrimSpace(parts[i]))
			out[i] = n
		}
		return out
	}
	pa, pb := parse(a), parse(b)
	for i := 0; i < 3; i++ {
		if pa[i] < pb[i] {
			return -1
		}
		if pa[i] > pb[i] {
			return 1
		}
	}
	return 0
}

// recoverMiddleware keeps a panic inside any command handler from crashing the
// whole API process (a malformed upload must not take down the service).
func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) rateAllow(scope string) bool {
	if s.RateLimit == nil {
		return true
	}
	return s.RateLimit.Allow(scope, time.Now())
}

func clientIP(r *http.Request, trustCloudflare bool) string {
	if trustCloudflare {
		if candidate := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); candidate != "" {
			if parsed := net.ParseIP(candidate); parsed != nil {
				return parsed.String()
			}
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if parsed := net.ParseIP(host); parsed != nil {
			return parsed.String()
		}
	}
	if parsed := net.ParseIP(strings.TrimSpace(r.RemoteAddr)); parsed != nil {
		return parsed.String()
	}
	return "unknown"
}

func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

package api

import (
	"net/http"
)

// authenticatePrincipal pulls the bearer token out of the
// Authorization header, runs it through the server's
// authenticator, and returns the principal id. On failure
// it writes a 401 response and returns ok=false; the
// caller should just `return`.
//
// R16.7-P1-E: the jurisdiction API is a per-user surface
// (each user has their own jurisdiction row). Without a
// valid session the request is rejected.
func authenticatePrincipal(s *Server, w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authenticator_unavailable"})
		return "", false
	}
	raw, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return "", false
	}
	session, err := s.Authenticator.Authenticate(r.Context(), raw)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
		return "", false
	}
	if session.Principal.ID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "principal_required"})
		return "", false
	}
	return session.Principal.ID, true
}

package api

import "net/http"

// routeJurisdiction dispatches /v1/identity/jurisdiction
// to the right handler. We use one method-aware switch
// rather than a path-based mux so the GET and PATCH
// handlers can be co-located with the same auth check.
func (s *Server) routeJurisdiction(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.getJurisdiction(w, r)
	case http.MethodPatch:
		s.setJurisdiction(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

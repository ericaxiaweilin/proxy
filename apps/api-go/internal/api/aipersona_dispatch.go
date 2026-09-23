package api

import (
	"net/http"
	"strings"
)

// routePersonaCollection dispatches the bare /v1/ai/personas
// path. POST creates a persona; GET lists the owner's personas.
// The prefix is not in the /consents family so only these two
// handlers live here.
func (s *Server) routePersonaCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.createPersona(w, r)
	case http.MethodGet:
		s.listPersonas(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

// routePersonaItem dispatches /v1/ai/personas/{id}[/consents[/revoke]].
// We deliberately do not use http.ServeMux's path matching —
// we want one method-aware switch over the resource path so
// the consent endpoints stay grouped.
func (s *Server) routePersonaItem(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/")
	if path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_id"})
		return
	}
	if strings.HasSuffix(path, "/consents/revoke") {
		switch r.Method {
		case http.MethodPost:
			s.revokeConsent(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		}
		return
	}
	if strings.HasSuffix(path, "/consents") {
		switch r.Method {
		case http.MethodPost:
			s.grantConsent(w, r)
		case http.MethodGet:
			s.hasLiveConsent(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		}
		return
	}
	if strings.HasSuffix(path, "/media") {
		switch r.Method {
		case http.MethodGet:
			s.listPersonaGallery(w, r)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		}
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.getPersona(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

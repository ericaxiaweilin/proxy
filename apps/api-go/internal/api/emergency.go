package api

import (
	"encoding/json"
	"io"
	"net/http"
)

// SAFETY-NET-001: HTTP surface for the caller's own safety net.
//
//	GET    /v1/emergency/contacts            -> list
//	POST   /v1/emergency/contacts            -> add (no contactId) / edit (with contactId)
//	DELETE /v1/emergency/contacts?contactId= -> soft delete
//	GET    /v1/emergency/events              -> list own events
//	POST   /v1/emergency/events              -> append an SOS / check-in event
//
// Every route operates on the authenticated caller's own rows; there is
// no id in any path, so there is no cross-user surface to get wrong.
// None of these is operator-gated (SAFETY-GATE-001 governs the
// operator/moderation `safety` domain, not this one).
func (s *Server) emergencyContacts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.emergencyDispatch(w, r, "ListEmergencyContacts", nil)
	case http.MethodPost:
		s.emergencyDispatch(w, r, "UpsertEmergencyContact", readJSONPayload(r))
	case http.MethodDelete:
		payload := map[string]any{}
		if id := r.URL.Query().Get("contactId"); id != "" {
			payload["contactId"] = id
		}
		s.emergencyDispatch(w, r, "DeleteEmergencyContact", payload)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

func (s *Server) emergencyEvents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		payload := map[string]any{}
		if limit := r.URL.Query().Get("limit"); limit != "" {
			payload["limit"] = limit
		}
		s.emergencyDispatch(w, r, "ListEmergencyEvents", payload)
	case http.MethodPost:
		s.emergencyDispatch(w, r, "RecordEmergencyEvent", readJSONPayload(r))
	default:
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

// emergencyDispatch is the shared authenticate -> envelope -> handle ->
// render path for the four emergency commands.
func (s *Server) emergencyDispatch(w http.ResponseWriter, r *http.Request, commandType string, payload map[string]any) {
	auth, ok := s.authenticateLocationRequest(w, r)
	if !ok {
		return
	}
	if s.Emergency == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "emergency_service_unavailable"})
		return
	}
	// buildLocationCommandEnvelope is a generic envelope builder that
	// happens to carry a location-era name (it predates this domain and
	// is shared with the location consent routes). Reusing it keeps the
	// envelope shape identical across domains rather than growing a
	// second, subtly different copy.
	envelope := buildLocationCommandEnvelope(r, auth, payload, commandType)
	result := s.Emergency.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	writeJSON(w, http.StatusOK, result.Body)
}

// readJSONPayload returns the whole parsed request body. Unlike
// readLocationPayload it does not whitelist keys: the emergency
// commands have several optional fields and the service layer is the
// place that validates them.
func readJSONPayload(r *http.Request) map[string]any {
	payload := map[string]any{}
	if r.Body == nil {
		return payload
	}
	defer func() {
		_, _ = io.Copy(io.Discard, r.Body)
		_ = r.Body.Close()
	}()
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	if len(body) == 0 {
		return payload
	}
	parsed := map[string]any{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return payload
	}
	return parsed
}

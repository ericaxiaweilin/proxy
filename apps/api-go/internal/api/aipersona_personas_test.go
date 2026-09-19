package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
)

// TWIN-CENTER-001: the twin center lists the caller's personas.
// An owner with none gets [] (never null); ownerId is required;
// rows come back newest-first.
type twinCenterAdultLookup struct{}

func (twinCenterAdultLookup) AgeAt(context.Context, string, time.Time) (int, error) {
	return 30, nil
}

func newTwinCenterServer() *Server {
	svc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	svc.SetAgeLookup(twinCenterAdultLookup{})
	return &Server{AIPersona: svc}
}

func TestListPersonasRequiresOwner(t *testing.T) {
	server := newTwinCenterServer()
	recorder := httptest.NewRecorder()
	server.routePersonaCollection(recorder, httptest.NewRequest(http.MethodGet, "/v1/ai/personas", nil))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "missing_ownerId") {
		t.Fatalf("body = %s, want missing_ownerId", recorder.Body.String())
	}
}

func TestListPersonasEmptyIsArrayNotNull(t *testing.T) {
	server := newTwinCenterServer()
	recorder := httptest.NewRecorder()
	server.routePersonaCollection(recorder, httptest.NewRequest(http.MethodGet, "/v1/ai/personas?ownerId=acct_1", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	// Pin the exact wire shape: "no twins" must decode as an empty
	// array, not null — the UI renders those two states differently.
	if !strings.Contains(recorder.Body.String(), `"personas":[]`) {
		t.Fatalf("body = %s, want an empty personas array, never null", recorder.Body.String())
	}
}

func TestListPersonasNewestFirst(t *testing.T) {
	// 时钟步进：两次创建必须有严格递增的时间戳 —— 真时钟在粗粒度平台上
	// 可能打结，非稳定排序遇到 tie 就听天由命，测试变 flaky。
	tick := time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)
	svc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	svc.SetAgeLookup(twinCenterAdultLookup{})
	svc.SetNowFunc(func() time.Time {
		tick = tick.Add(time.Second)
		return tick
	})
	server := &Server{AIPersona: svc}
	ctx := context.Background()
	first, err := server.AIPersona.CreatePersona(ctx, aipersona.Persona{OwnerID: "acct_1", DisplayName: "Twin One", PersonaType: aipersona.PersonaTypeUserTwin})
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := server.AIPersona.CreatePersona(ctx, aipersona.Persona{OwnerID: "acct_1", DisplayName: "Twin Two", PersonaType: aipersona.PersonaTypeUserTwin})
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if _, err := server.AIPersona.CreatePersona(ctx, aipersona.Persona{OwnerID: "acct_other", DisplayName: "Other Twin", PersonaType: aipersona.PersonaTypeUserTwin}); err != nil {
		t.Fatalf("create other owner: %v", err)
	}
	recorder := httptest.NewRecorder()
	server.routePersonaCollection(recorder, httptest.NewRequest(http.MethodGet, "/v1/ai/personas?ownerId=acct_1", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var payload struct {
		Personas []aipersona.Persona `json:"personas"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Personas) != 2 {
		t.Fatalf("got %d personas, want 2 (other owner's must not leak)", len(payload.Personas))
	}
	if payload.Personas[0].ID != second.ID || payload.Personas[1].ID != first.ID {
		t.Fatalf("order = [%s %s], want newest-first [%s %s]", payload.Personas[0].ID, payload.Personas[1].ID, second.ID, first.ID)
	}
}

// TWIN-CENTER-002: revoking a likeness consent keeps the audit row
// and flips live state. Revoking with nothing live is 404, not a
// fake success.
func TestRevokeConsentWithoutLiveConsentIs404(t *testing.T) {
	server := newTwinCenterServer()
	persona, err := server.AIPersona.CreatePersona(context.Background(), aipersona.Persona{OwnerID: "acct_1", DisplayName: "Twin One", PersonaType: aipersona.PersonaTypeUserTwin})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/ai/personas/"+persona.ID+"/consents/revoke", strings.NewReader(`{"subjectId":"acct_1"}`))
	server.routePersonaItem(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "no_live_consent") {
		t.Fatalf("body = %s, want no_live_consent", recorder.Body.String())
	}
}

func TestGrantRevokeConsentRoundTrip(t *testing.T) {
	server := newTwinCenterServer()
	ctx := context.Background()
	persona, err := server.AIPersona.CreatePersona(ctx, aipersona.Persona{OwnerID: "acct_1", DisplayName: "Twin One", PersonaType: aipersona.PersonaTypeUserTwin})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	granted, err := server.AIPersona.GrantConsent(ctx, persona.ID, "acct_1", aipersona.ConsentVisualAndVoice, nil)
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/ai/personas/"+persona.ID+"/consents/revoke", strings.NewReader(`{"subjectId":"acct_1"}`))
	server.routePersonaItem(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("revoke status = %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	var revoked aipersona.LikenessConsent
	if err := json.Unmarshal(recorder.Body.Bytes(), &revoked); err != nil {
		t.Fatalf("decode revoked: %v", err)
	}
	// The audit trail is preserved: same row id, now stamped revoked.
	if revoked.ID != granted.ID || revoked.RevokedAt == nil {
		t.Fatalf("revoked = %+v, want same row id with revokedAt set", revoked)
	}
	// Live lookup must now report nothing (204), not the old row.
	liveRecorder := httptest.NewRecorder()
	liveRequest := httptest.NewRequest(http.MethodGet, "/v1/ai/personas/"+persona.ID+"/consents?subjectId=acct_1", nil)
	server.routePersonaItem(liveRecorder, liveRequest)
	if liveRecorder.Code != http.StatusNoContent {
		t.Fatalf("live status = %d, want 204 after revoke", liveRecorder.Code)
	}
	// Revoking twice is a caller error, not a second success.
	againRecorder := httptest.NewRecorder()
	againRequest := httptest.NewRequest(http.MethodPost, "/v1/ai/personas/"+persona.ID+"/consents/revoke", strings.NewReader(`{"subjectId":"acct_1"}`))
	server.routePersonaItem(againRecorder, againRequest)
	if againRecorder.Code != http.StatusNotFound {
		t.Fatalf("second revoke status = %d, want 404", againRecorder.Code)
	}
}

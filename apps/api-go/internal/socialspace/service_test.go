package socialspace

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

func envelope(commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "cmd_12345678", CommandType: commandType, CommandVersion: 1, Actor: command.Actor{Type: "USER", ID: "user_1"}, Principal: command.Principal{Type: "USER", ID: "principal_1"}, Target: command.Target{Type: "SocialSpace", ID: "local"}, IdempotencyKey: "idempotency_123", AuthContext: map[string]any{"sessionId": "session_1"}, Purpose: "social_space", CorrelationID: "corr_1", RequestedAt: "2026-08-24T00:00:00Z", Payload: payload}
}

func TestStatusExpiresFromReadModel(t *testing.T) {
	now := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	domainClock := clock.NewFixed(now)
	service := NewWithRepositoryAndClock(NewMemoryRepository(), domainClock)
	created := service.HandleContext(t.Context(), envelope("CreateStatus", map[string]any{"body": "下午有空", "expiryHours": 24}))
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("create outcome = %s", created.Outcome)
	}
	active := service.HandleContext(t.Context(), envelope("ListStatuses", map[string]any{}))
	if active.Outcome != "ACCEPTED" || active.OperationRef == "" {
		t.Fatalf("active = %#v", active)
	}
	domainClock.Advance(25 * time.Hour)
	expired := service.HandleContext(t.Context(), envelope("ListStatuses", map[string]any{}))
	if expired.OperationRef != `{"statuses":[]}` {
		t.Fatalf("expired payload = %s", expired.OperationRef)
	}
}

func TestCommunityMembershipIsActorScoped(t *testing.T) {
	service := New()
	joined := true
	result := service.HandleContext(t.Context(), envelope("SetCommunityMembership", map[string]any{"communityId": "photo", "joined": joined}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("membership outcome = %s", result.Outcome)
	}
	read := service.HandleContext(t.Context(), envelope("ListCommunities", map[string]any{}))
	if read.Outcome != "ACCEPTED" || read.OperationRef == "" {
		t.Fatalf("read = %#v", read)
	}
}

type stubAuthorNames struct{ names map[string]string }

func (s stubAuthorNames) ResolveAuthorDisplayName(_ context.Context, userID string) (string, bool) {
	name, ok := s.names[userID]
	return name, ok
}

// PROFILE-READ-001: status display names come from the verified account
// profile, never from the client payload.
func TestCreateStatusResolvesDisplayNameFromProfile(t *testing.T) {
	service := New()
	service.SetAuthorNameResolver(stubAuthorNames{names: map[string]string{"user_1": "NguyenThanhHuyen"}})
	created := service.HandleContext(t.Context(), envelope("CreateStatus", map[string]any{
		"body": "下午有空", "expiryHours": 24, "authorDisplayName": "你",
	}))
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("create outcome = %s", created.Outcome)
	}
	var body struct {
		Status Status `json:"status"`
	}
	if err := json.Unmarshal([]byte(created.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status.AuthorDisplayName != "NguyenThanhHuyen" {
		t.Fatalf("display name must come from profile, got %q", body.Status.AuthorDisplayName)
	}
}

package main

import (
	"testing"

	"github.com/proxy-app/proxy-api/internal/event"
)

func testEvent(eventType, principalID, aggregateID string, payload map[string]any) event.DomainEvent {
	return event.DomainEvent{
		EventID:     "evt-test-1",
		EventType:   eventType,
		AggregateID: aggregateID,
		PrincipalID: principalID,
		Payload:     payload,
	}
}

// NOTIF-INVITE-OFFER-001: offer 必须投给 5 分钟内要行动的 agent，
// 而不是发起 offer 的 requester（以前收件人写反了，等于把信送给发信人）。
func TestInboxForEventRoutesOfferToAgent(t *testing.T) {
	recipient, title, _, deepLink, ok := inboxForEvent(testEvent(
		"SlotOfferCreated", "requester-u1", "off_1",
		map[string]any{"agentId": "agent-xiaomei"},
	))
	if !ok {
		t.Fatal("SlotOfferCreated must produce an inbox item")
	}
	if recipient != "agent-xiaomei" {
		t.Fatalf("offer routed to %q, want the acting agent", recipient)
	}
	if title == "" || deepLink == "" {
		t.Fatal("offer inbox needs a title and a deep link")
	}
}

func TestInboxForEventFallsBackWhenAgentMissing(t *testing.T) {
	recipient, _, _, _, ok := inboxForEvent(testEvent(
		"SlotOfferCreated", "requester-u1", "off_1", nil,
	))
	if !ok || recipient != "requester-u1" {
		t.Fatalf("missing agentId must fall back to principal, got %q ok=%v", recipient, ok)
	}
}

func TestInboxForEventRoutesInvitations(t *testing.T) {
	recipient, _, _, _, ok := inboxForEvent(testEvent(
		"InvitationCreated", "host-u1", "inv_1",
		map[string]any{"inviteeId": "invitee-u2"},
	))
	if !ok || recipient != "invitee-u2" {
		t.Fatalf("invitation must reach the invitee, got %q ok=%v", recipient, ok)
	}
	recipient, _, body, _, ok := inboxForEvent(testEvent(
		"InvitationResponded", "invitee-u2", "inv_1",
		map[string]any{"decision": "ACCEPTED", "hostId": "host-u1"},
	))
	if !ok || recipient != "host-u1" {
		t.Fatalf("response must reach the inviter, got %q ok=%v", recipient, ok)
	}
	if body == "" {
		t.Fatal("response inbox needs a body")
	}
}

func TestInboxForEventSkipsUnknown(t *testing.T) {
	if _, _, _, _, ok := inboxForEvent(testEvent("SomethingElse", "u1", "x_1", nil)); ok {
		t.Fatal("unknown events must stay silent")
	}
	if _, _, _, _, ok := inboxForEvent(testEvent("TaskSlotsCreated", "u1", "x_1", nil)); ok {
		t.Fatal("noisy events must stay skipped")
	}
}

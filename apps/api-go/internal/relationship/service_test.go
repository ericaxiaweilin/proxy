package relationship

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func contextBackground() context.Context { return context.Background() }

func envelope(commandType, actor, target string) command.Envelope {
	return command.Envelope{
		CommandID:   "cmd_relationship_" + commandType,
		CommandType: commandType,
		Actor:       command.Actor{Type: "USER", ID: actor},
		Principal:   command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target:      command.Target{Type: "Friendship", ID: actor + ":" + target},
		CorrelationID: "corr_relationship_" + commandType,
		Payload:     map[string]any{"targetUserId": target},
	}
}

// R18.x FRIEND-001 server half.
//
// The mobile '好友与关系' surface (FriendCrmSurface) was
// entirely hardcoded mock: 4 fake friends, fake pending
// requests, fake contact / social matches, and all
// actions (add / accept / ignore / block) mutated local
// React state only. This test pins the new server side:
// list returns the actor's two buckets (active + pending),
// send / accept / block / ignore each transition the row
// through the documented states, and the symmetric
// (a,b) / (b,a) pair is collapsed to a single row.

func TestListMyFriendshipsSplitsActiveAndPending(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	// user_alice ↔ user_bob: FRIEND
	// user_alice → user_carol: PENDING outgoing
	// user_dave → user_alice: PENDING incoming

	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice→bob request: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("AcceptFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("bob accepts: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_carol")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice→carol request: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("SendFriendRequest", "user_dave", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("dave→alice request: %s", r.Outcome)
	}

	list := svc.Handle(envelope("ListMyFriendships", "user_alice", ""))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %s (%+v)", list.Outcome, list.Error)
	}
	var body struct {
		Friendships ListFriendshipsPayload `json:"friendships"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Friendships.Active) != 1 || body.Friendships.Active[0].UserID != "user_bob" {
		t.Fatalf("active: %+v", body.Friendships.Active)
	}
	if len(body.Friendships.Pending) != 2 {
		t.Fatalf("pending should have 2 (outgoing carol + incoming dave), got %+v", body.Friendships.Pending)
	}
}

func TestSendFriendRequestIsPairCanonical(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	// alice→bob and bob→alice should collapse to a single
	// (a=alice, b=bob) row.
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice→bob: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("bob→alice: %s", r.Outcome)
	}
	rows, _ := repo.ListByUser(contextBackground(), "user_alice")
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].RequesterID != "user_bob" {
		t.Fatalf("the second request should be the requester, got %s", rows[0].RequesterID)
	}
}

func TestAcceptFriendRequestRequiresReceiver(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("request: %s", r.Outcome)
	}
	// alice (the requester) cannot accept her own request.
	if r := svc.Handle(envelope("AcceptFriendRequest", "user_alice", "user_bob")); r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "FRIEND_NOT_RECEIVER" {
		t.Fatalf("alice should not be able to accept her own request: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("AcceptFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("bob accepts: %s", r.Outcome)
	}
}

func TestIgnoreFriendRequestTombstonesRow(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("request: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("IgnoreFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("ignore: %s (%+v)", r.Outcome, r.Error)
	}
	rows, _ := repo.ListByUser(contextBackground(), "user_alice")
	if len(rows) != 0 {
		t.Fatalf("tombstoned row should not surface, got %+v", rows)
	}
}

func TestBlockFriendHidesFromList(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("request: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("BlockFriend", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("block: %s", r.Outcome)
	}
	list := svc.Handle(envelope("ListMyFriendships", "user_alice", ""))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %s", list.Outcome)
	}
	var body struct {
		Friendships ListFriendshipsPayload `json:"friendships"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Friendships.Active) != 0 || len(body.Friendships.Pending) != 0 {
		t.Fatalf("blocked pair must not appear in either bucket: %+v", body.Friendships)
	}
}

func TestFriendCommandsRejectAnonymousActor(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	anon := envelope("SendFriendRequest", "", "user_bob")
	anon.Actor.Type = "ANONYMOUS"
	if r := svc.Handle(anon); r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "FRIEND_FORBIDDEN" {
		t.Fatalf("anonymous should be rejected, got %s / %+v", r.Outcome, r.Error)
	}
}

func TestSendFriendRequestRejectsSelf(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_alice")); r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "FRIEND_SELF_FORBIDDEN" {
		t.Fatalf("self request should be rejected, got %s / %+v", r.Outcome, r.Error)
	}
}

func TestAcceptFriendRequestRequiresExistingFriendship(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if r := svc.Handle(envelope("AcceptFriendRequest", "user_bob", "user_alice")); r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "FRIEND_NOT_FOUND" {
		t.Fatalf("missing row should be rejected, got %s / %+v", r.Outcome, r.Error)
	}
}

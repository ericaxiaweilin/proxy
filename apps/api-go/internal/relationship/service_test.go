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
		CommandID:     "cmd_relationship_" + commandType,
		CommandType:   commandType,
		Actor:         command.Actor{Type: "USER", ID: actor},
		Principal:     command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target:        command.Target{Type: "Friendship", ID: actor + ":" + target},
		CorrelationID: "corr_relationship_" + commandType,
		Payload:       map[string]any{"targetUserId": target},
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

// AI-TWIN-AUDIENCE-AVATAR-001: the AI-twin audience chooser consumes this
// same relationship payload. It must receive the identity image with the
// selected person's id, not invent a second avatar lookup in the client.
func TestListMyFriendshipsIncludesResolvedAvatarURL(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	svc.SetDisplayNameResolver(func(_ context.Context, userID string) (DisplayNameHint, bool) {
		if userID != "user_bob" {
			return DisplayNameHint{}, false
		}
		return DisplayNameHint{
			UserID:      userID,
			DisplayName: "Bob",
			AvatarURL:   "/v1/media/thumb/ma_bob",
		}, true
	})
	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice→bob request: %s", r.Outcome)
	}
	if r := svc.Handle(envelope("AcceptFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("bob accepts: %s", r.Outcome)
	}

	list := svc.Handle(envelope("ListMyFriendships", "user_alice", ""))
	var body struct {
		Friendships ListFriendshipsPayload `json:"friendships"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if got := body.Friendships.Active[0].AvatarURL; got != "/v1/media/thumb/ma_bob" {
		t.Errorf("avatarUrl = %q, want public media path", got)
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

// MERCHANT-CREATOR-NOTIFY-001：好友请求必须通知到**被申请方**，且事件和关系行
// 同一事务。
//
// 改之前 UpsertFriendship 只写关系表，事件只回给**发起申请的本人** —— 对方在
// 另一台手机上什么也收不到，而申请挂在那里，对方不打开 App 就永远不知道。
// 这个洞没人发现，是因为它在结果里看不出破绽：请求照样 ACCEPTED，关系照样建好。
func TestSendFriendRequestNotifiesTheTarget(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	if r := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice→bob: %s", r.Outcome)
	}
	events := repo.Events()
	if len(events) != 1 {
		t.Fatalf("want exactly 1 domain event, got %d", len(events))
	}
	ev := events[0]
	if ev.EventType != "FriendRequestSent" {
		t.Fatalf("event type = %q", ev.EventType)
	}
	if ev.AggregateID == "" || ev.AggregateID == "pending" {
		t.Fatalf("the event must carry the real friendship id (outbox looks up by aggregate), got %q", ev.AggregateID)
	}
	// 关系行的 id 必须就是事件的聚合 id。
	got, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if got.ID != ev.AggregateID {
		t.Fatalf("event aggregate %q != friendship id %q — outbox 按聚合就查不到这条事件", ev.AggregateID, got.ID)
	}
	notify, _ := ev.Payload["notifyPrincipalId"].(string)
	if notify != "user_bob" {
		t.Fatalf("notifyPrincipalId = %q, want user_bob（收件人是被申请方，不是发起人）", notify)
	}
	if notify == "user_alice" {
		t.Fatal("the notification must not go back to the requester")
	}
}

// 内存仓没有事务可谈，但**不能**因此少记事件：两个实现对「关系和事件是不是都
// 发生了」必须回答一致，否则差异会藏在没人看的那一侧（单测跑内存、线上跑 PG）。
func TestUpsertFriendshipAndPublishRefusesToStoreHalfTheFact(t *testing.T) {
	repo := NewMemoryRepository()
	if _, err := repo.UpsertFriendshipAndPublish(contextBackground(), FriendshipRecord{
		ID: "fr_x", UserA: "user_a", UserB: "user_b", State: FriendshipPending,
	}, nil); err == nil {
		t.Fatal("an empty event list must be rejected — otherwise a caller can believe the notification went out")
	}
	if rows, _ := repo.ListByUser(contextBackground(), "user_a"); len(rows) != 0 {
		t.Fatalf("a rejected call must leave no friendship row, got %d", len(rows))
	}
}

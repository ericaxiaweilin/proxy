package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// ROOM-CREATE-001: 创建房间（GROUP + 场景）+ 见面邀约状态机测试。

func envelopeAs(commandType string, payload map[string]any, targetID, actorID string) command.Envelope {
	e := envelopeFor(commandType, payload, targetID)
	e.Actor = command.Actor{Type: "USER", ID: actorID}
	e.Principal = command.Principal{Type: "INDIVIDUAL", ID: actorID}
	return e
}

func startRoomForTest(t *testing.T, s *Service, participantIDs []string) string {
	t.Helper()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "GROUP", "originType": "HOME", "originId": "room",
		"participantIds": participantIDs, "firstMessage": "房间已创建",
		"roomScene": map[string]any{"emoji": "📷", "sceneName": "City Walk + 拍照", "sceneDesc": "老城区", "roomName": "City Walk 拍照局"},
	}, ""))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start room: %+v", result.Error)
	}
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	if view.ConversationID == "" {
		t.Fatal("start room returned no conversationId")
	}
	return view.ConversationID
}

func TestStartConversationStoresRoomScene(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	conv, err := s.repository.GetConversation(context.TODO(), convID)
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if conv.RoomScene == nil || conv.RoomScene.RoomName != "City Walk 拍照局" {
		t.Fatalf("room scene not stored: %+v", conv.RoomScene)
	}
}

func TestStartConversationRejectsRoomSceneOnDM(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM", "originType": "PROFILE", "originId": "user_002",
		"participantId": "user_002", "firstMessage": "你好",
		"roomScene": map[string]any{"emoji": "📷", "sceneName": "City Walk", "roomName": "局"},
	}, ""))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "ROOM_SCENE_REQUIRES_GROUP" {
		t.Fatalf("expected ROOM_SCENE_REQUIRES_GROUP, got %+v", result)
	}
}

func proposeMeetupForTest(t *testing.T, s *Service, convID, actorID string) Meetup {
	t.Helper()
	result := s.Handle(envelopeAs("ProposeMeetup", map[string]any{
		"sceneEmoji": "📷", "sceneName": "City Walk + 拍照", "place": "老城区 · 湖畔咖啡馆", "timeLabel": "今天 15:00",
	}, convID, actorID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("propose meetup: %+v", result.Error)
	}
	var view struct {
		Meetup Meetup `json:"meetup"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode meetup: %v", err)
	}
	return view.Meetup
}

func TestMeetupFullLifecycle(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	meetup := proposeMeetupForTest(t, s, convID, "user_001")
	if meetup.Status != "PENDING" {
		t.Fatalf("expected PENDING, got %s", meetup.Status)
	}

	// 第一个成员接受：两个非发起人成员里只有一个接受，应该还是 PENDING。
	result := s.Handle(envelopeAs("AcceptMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_002"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("accept 1: %+v", result.Error)
	}
	var afterFirst struct {
		Meetup Meetup `json:"meetup"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &afterFirst)
	if afterFirst.Meetup.Status != "PENDING" {
		t.Fatalf("expected still PENDING after 1/2 accepted, got %s", afterFirst.Meetup.Status)
	}

	// 第二个成员接受：全员到齐，CONFIRMED。
	result = s.Handle(envelopeAs("AcceptMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_003"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("accept 2: %+v", result.Error)
	}
	var afterSecond struct {
		Meetup Meetup `json:"meetup"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &afterSecond)
	if afterSecond.Meetup.Status != "CONFIRMED" {
		t.Fatalf("expected CONFIRMED after all accepted, got %s", afterSecond.Meetup.Status)
	}

	// 到达 -> ONGOING。
	result = s.Handle(envelopeAs("ArriveMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_002"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("arrive: %+v", result.Error)
	}

	// 结束 -> COMPLETED + 会话归档。
	result = s.Handle(envelopeAs("CompleteMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_001"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("complete: %+v", result.Error)
	}
	conv, err := s.repository.GetConversation(context.TODO(), convID)
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if conv.State != "ARCHIVED" {
		t.Fatalf("expected conversation archived after meetup completed, got %s", conv.State)
	}
}

func TestProposeMeetupRejectsWhenAlreadyActive(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	proposeMeetupForTest(t, s, convID, "user_001")
	result := s.Handle(envelopeAs("ProposeMeetup", map[string]any{
		"sceneEmoji": "☕", "sceneName": "咖啡", "place": "咖啡店", "timeLabel": "明天 10:00",
	}, convID, "user_001"))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "MEETUP_ALREADY_ACTIVE" {
		t.Fatalf("expected MEETUP_ALREADY_ACTIVE, got %+v", result)
	}
}

func TestAcceptMeetupRejectsProposerSelfAccept(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	meetup := proposeMeetupForTest(t, s, convID, "user_001")
	result := s.Handle(envelopeAs("AcceptMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_001"))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "PROPOSER_CANNOT_ACCEPT_OWN_MEETUP" {
		t.Fatalf("expected PROPOSER_CANNOT_ACCEPT_OWN_MEETUP, got %+v", result)
	}
}

func TestAcceptMeetupRejectsNonParticipant(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	meetup := proposeMeetupForTest(t, s, convID, "user_001")
	result := s.Handle(envelopeAs("AcceptMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_999"))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "NOT_CONVERSATION_PARTICIPANT" {
		t.Fatalf("expected NOT_CONVERSATION_PARTICIPANT, got %+v", result)
	}
}

func TestNudgeMeetupOnlyProposer(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	meetup := proposeMeetupForTest(t, s, convID, "user_001")
	result := s.Handle(envelopeAs("NudgeMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_002"))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "ONLY_PROPOSER_CAN_NUDGE" {
		t.Fatalf("expected ONLY_PROPOSER_CAN_NUDGE, got %+v", result)
	}
	result = s.Handle(envelopeAs("NudgeMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_001"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("nudge by proposer: %+v", result.Error)
	}
}

func TestListConversationsAttachesActiveMeetup(t *testing.T) {
	s := New()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	proposeMeetupForTest(t, s, convID, "user_001")
	result := s.Handle(envelopeFor("ListConversations", map[string]any{}, ""))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list conversations: %+v", result.Error)
	}
	var view struct {
		Conversations []ConversationSummary `json:"conversations"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode: %v", err)
	}
	found := false
	for _, summary := range view.Conversations {
		if summary.Conversation.ID != convID {
			continue
		}
		found = true
		if summary.ActiveMeetup == nil || summary.ActiveMeetup.Status != "PENDING" {
			t.Fatalf("expected active meetup attached, got %+v", summary.ActiveMeetup)
		}
	}
	if !found {
		t.Fatalf("room conversation not found in inbox")
	}
}

// MERCHANT-CREATOR-NOTIFY-001：见面邀约的事件要**按人**发，一个收件人一条，
// 而且不含 actor 自己。
//
// 改之前事件只回给**提议人自己**：被邀的人在另一台手机上收不到任何东西，而见面
// 邀约就静悄悄地躺在会话里。这个洞在结果里看不出破绽 —— 状态照样 PENDING，
// 房间照样建好。
func TestMeetupNotifiesEachOtherParticipantOnce(t *testing.T) {
	s, repo := NewWithMemoryRepository()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	before := len(repo.Events())

	meetup := proposeMeetupForTest(t, s, convID, "user_001")
	proposed := repo.Events()[before:]
	if len(proposed) != 2 {
		t.Fatalf("a 3-person room must produce one event per other participant, got %d", len(proposed))
	}
	got := map[string]bool{}
	for _, ev := range proposed {
		if ev.EventType != "MeetupProposed" {
			t.Fatalf("event type = %q", ev.EventType)
		}
		notify, _ := ev.Payload["notifyPrincipalId"].(string)
		if notify == "user_001" {
			t.Fatal("the proposer must not be notified of their own proposal")
		}
		if got[notify] {
			t.Fatalf("%s got two notifications for one proposal", notify)
		}
		got[notify] = true
	}
	if !got["user_002"] || !got["user_003"] {
		t.Fatalf("both other participants must be notified, got %v", got)
	}
	// 事件必须带真实 meetupId：收件箱深链/文案将来要用它。
	if id, _ := proposed[0].Payload["meetupId"].(string); id != meetup.ID {
		t.Fatalf("payload meetupId = %q, want %q", id, meetup.ID)
	}
}

// 催的语义是「还没接受的人」：已经答应的人不该再被催一次。
func TestMeetupNudgeOnlyReachesThoseWhoHaveNotAccepted(t *testing.T) {
	s, repo := NewWithMemoryRepository()
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	meetup := proposeMeetupForTest(t, s, convID, "user_001")

	if r := s.Handle(envelopeAs("AcceptMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_002")); r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %+v", r.Error)
	}
	before := len(repo.Events())
	if r := s.Handle(envelopeAs("NudgeMeetup", map[string]any{"meetupId": meetup.ID}, convID, "user_001")); r.Outcome != "ACCEPTED" {
		t.Fatalf("nudge: %+v", r.Error)
	}
	var nudged []string
	for _, ev := range repo.Events()[before:] {
		if ev.EventType != "MeetupNudged" {
			continue
		}
		nudged = append(nudged, ev.Payload["notifyPrincipalId"].(string))
	}
	if len(nudged) != 1 || nudged[0] != "user_003" {
		t.Fatalf("only the member who has not accepted may be nudged, got %v", nudged)
	}
}

// 状态与事件必须同一事务：没有 outbox 的仓储要**拒绝**这场写入，
// 而不是安静地只写状态（那正是这次要找的失败形态）。
func TestMeetupWriteRefusesToSkipEvents(t *testing.T) {
	s := NewWithRepository(&noOutboxConversationRepository{MemoryRepository: NewMemoryRepository()})
	convID := startRoomForTest(t, s, []string{"user_002", "user_003"})
	result := s.Handle(envelopeAs("ProposeMeetup", map[string]any{
		"sceneEmoji": "📷", "sceneName": "City Walk", "place": "湖畔", "timeLabel": "今天 15:00",
	}, convID, "user_001"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("a meetup must not be stored without its notifications, got %s", result.Outcome)
	}
}

// noOutboxConversationRepository 模拟「仓储没接 outbox」的部署（WriteAndPublish 报错）。
type noOutboxConversationRepository struct {
	*MemoryRepository
}

func (r *noOutboxConversationRepository) WriteAndPublish(context.Context, func(context.Context) error, []event.DomainEvent) error {
	return errors.New("conversation transactional outbox is not configured")
}

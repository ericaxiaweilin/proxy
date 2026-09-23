package conversation

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// ROOM-CREATE-001: 见面邀约（发起线下见面 -> 全员同意 -> 到场 -> 结束/房间归档）。
// 跟 Message 不一样，Meetup 是可变状态机，原地更新，不是 append-only 历史；
// 每次状态变化额外发一条 SYSTEM_CONTEXT 消息进聊天流，让状态变化在聊天记录
// 里留痕（用户翻聊天记录能看到"是什么时候约定的"），但状态的唯一真值来源是
// Meetup 本身，不是靠解析消息文本。
//
// 没有 AI 场控员：原型里的"小助手"自动联系/推荐地点/发提醒是需要真实 AI
// agent 编排的独立项目，本轮不做，不假装（2026-09-22 用户决定：先做真实
// 的人工发起 + 状态机，AI 场控员留到下一轮）。
type Meetup struct {
	ID             string    `json:"meetupId"`
	ConversationID string    `json:"conversationId"`
	ProposerID     string    `json:"proposerId"`
	SceneEmoji     string    `json:"sceneEmoji"`
	SceneName      string    `json:"sceneName"`
	Place          string    `json:"place"`
	TimeLabel      string    `json:"timeLabel"`
	Status         string    `json:"status"` // PENDING | CONFIRMED | ONGOING | COMPLETED
	AcceptedBy     []string  `json:"acceptedBy"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// --- MemoryRepository 见面邀约实现 ---

func (r *MemoryRepository) CreateMeetup(_ context.Context, m Meetup) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.meetups[m.ID]; exists {
		return errors.New("meetup already exists")
	}
	r.meetups[m.ID] = cloneMeetup(m)
	return nil
}

func (r *MemoryRepository) UpdateMeetup(_ context.Context, m Meetup) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.meetups[m.ID]; !exists {
		return ErrMeetupNotFound
	}
	r.meetups[m.ID] = cloneMeetup(m)
	return nil
}

func (r *MemoryRepository) GetMeetup(_ context.Context, id string) (Meetup, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, exists := r.meetups[id]
	if !exists {
		return Meetup{}, ErrMeetupNotFound
	}
	return cloneMeetup(m), nil
}

func (r *MemoryRepository) ActiveMeetup(_ context.Context, conversationID string) (Meetup, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best Meetup
	found := false
	for _, m := range r.meetups {
		if m.ConversationID != conversationID || m.Status == "COMPLETED" {
			continue
		}
		if !found || m.CreatedAt.After(best.CreatedAt) {
			best = m
			found = true
		}
	}
	if !found {
		return Meetup{}, ErrMeetupNotFound
	}
	return cloneMeetup(best), nil
}

// --- 命令处理 ---

// appendSystemMessage 往会话里补一条 SYSTEM_CONTEXT，让见面状态变化在聊天
// 记录里留痕。跟 startConversation 里的分支分隔符用同一套构造方式。
func (s *Service) appendSystemMessage(ctx context.Context, conv Conversation, body string) error {
	existing, err := s.repository.Messages(ctx, conv.ID)
	if err != nil {
		return err
	}
	msg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		DialogID:       conv.ID,
		SenderID:       "SYSTEM",
		MessageType:    "SYSTEM_CONTEXT",
		Kind:           "system_event",
		Body:           body,
		CreatedAt:      s.clock.Now().UTC(),
		Protection:     DefaultProtectionFor("SYSTEM_CONTEXT", conv.Type),
		Delivery:       &MessageDelivery{State: "sent"},
		Seq:            int64(len(existing) + 1),
	}
	return s.repository.AppendMessage(ctx, msg)
}

type proposeMeetupPayload struct {
	SceneEmoji string `json:"sceneEmoji"`
	SceneName  string `json:"sceneName"`
	Place      string `json:"place"`
	TimeLabel  string `json:"timeLabel"`
}

func (s *Service) proposeMeetup(ctx context.Context, e command.Envelope) command.Result {
	var p proposeMeetupPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.SceneName) == "" || strings.TrimSpace(p.Place) == "" || strings.TrimSpace(p.TimeLabel) == "" {
		return command.Rejected(e, "INVALID_MEETUP", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_meetup", nil)
	}
	conv, err := s.repository.GetConversation(ctx, e.Target.ID)
	if errors.Is(err, ErrConversationNotFound) {
		return command.Rejected(e, "CONVERSATION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil)
	}
	if !isParticipant(conv, e.Actor.ID) {
		return command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil)
	}
	if conv.State != "ACTIVE" {
		return command.Rejected(e, "CONVERSATION_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.not_active", nil)
	}
	// 一次只能有一个未结束的见面邀约——不然聊天里同时挂两张"待接受"的卡，
	// accept 该算给哪张说不清。
	if _, err := s.repository.ActiveMeetup(ctx, conv.ID); err == nil {
		return command.Rejected(e, "MEETUP_ALREADY_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.meetup_already_active", nil)
	} else if !errors.Is(err, ErrMeetupNotFound) {
		return command.Rejected(e, "MEETUP_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.meetup_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	meetup := Meetup{
		ID:             newID("meetup_"),
		ConversationID: conv.ID,
		ProposerID:     e.Actor.ID,
		SceneEmoji:     strings.TrimSpace(p.SceneEmoji),
		SceneName:      strings.TrimSpace(p.SceneName),
		Place:          strings.TrimSpace(p.Place),
		TimeLabel:      strings.TrimSpace(p.TimeLabel),
		Status:         "PENDING",
		AcceptedBy:     []string{},
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.repository.CreateMeetup(ctx, meetup); err != nil {
		return command.Rejected(e, "MEETUP_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.meetup_create_failed", nil)
	}
	proxy := &ProxyObjectRef{
		ObjectType: "invitation",
		ObjectID:   meetup.ID,
		Snapshot: map[string]any{
			"sceneEmoji": meetup.SceneEmoji, "sceneName": meetup.SceneName,
			"place": meetup.Place, "timeLabel": meetup.TimeLabel,
		},
		LiveState: map[string]any{"status": meetup.Status},
	}
	existing, err := s.repository.Messages(ctx, conv.ID)
	if err != nil {
		return command.Rejected(e, "MESSAGE_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.list_failed", nil)
	}
	msg := Message{
		ID: newID("msg_"), ConversationID: conv.ID, DialogID: conv.ID, SenderID: e.Actor.ID,
		MessageType: "STRUCTURED_SUGGESTION", Kind: "proxy_object", ProxyObject: proxy,
		CreatedAt: now, Protection: DefaultProtectionFor("STRUCTURED_SUGGESTION", conv.Type),
		Delivery: &MessageDelivery{State: "sent"}, Seq: int64(len(existing) + 1),
	}
	if err := s.repository.AppendMessage(ctx, msg); err != nil {
		return command.Rejected(e, "MESSAGE_SEND_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.send_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("MeetupProposed", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"meetupId": meetup.ID})}
	return acceptedWithPayload(e, "Meetup", meetup.ID, 1, "PENDING", map[string]any{"meetup": meetup, "message": msg}, domainEvents)
}

type meetupIDPayload struct {
	MeetupID string `json:"meetupId"`
}

// loadMeetupForActor 是 Accept/Nudge/Arrive/Complete 共用的读取+权限校验：
// meetup 必须存在，actor 必须是所属会话的成员。
func (s *Service) loadMeetupForActor(ctx context.Context, e command.Envelope) (Meetup, Conversation, command.Result, bool) {
	var p meetupIDPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.MeetupID) == "" {
		return Meetup{}, Conversation{}, command.Rejected(e, "INVALID_MEETUP", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_meetup", nil), false
	}
	meetup, err := s.repository.GetMeetup(ctx, p.MeetupID)
	if errors.Is(err, ErrMeetupNotFound) {
		return Meetup{}, Conversation{}, command.Rejected(e, "MEETUP_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.meetup_not_found", nil), false
	}
	if err != nil {
		return Meetup{}, Conversation{}, command.Rejected(e, "MEETUP_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.meetup_read_failed", nil), false
	}
	conv, err := s.repository.GetConversation(ctx, meetup.ConversationID)
	if err != nil {
		return Meetup{}, Conversation{}, command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil), false
	}
	if !isParticipant(conv, e.Actor.ID) {
		return Meetup{}, Conversation{}, command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil), false
	}
	return meetup, conv, command.Result{}, true
}

func (s *Service) acceptMeetup(ctx context.Context, e command.Envelope) command.Result {
	meetup, conv, rejected, ok := s.loadMeetupForActor(ctx, e)
	if !ok {
		return rejected
	}
	if meetup.Status != "PENDING" {
		return command.Rejected(e, "MEETUP_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.meetup_not_pending", map[string]any{"status": meetup.Status})
	}
	if meetup.ProposerID == e.Actor.ID {
		return command.Rejected(e, "PROPOSER_CANNOT_ACCEPT_OWN_MEETUP", "VALIDATION", "AFTER_USER_ACTION", "conversation.proposer_cannot_accept", nil)
	}
	already := false
	for _, id := range meetup.AcceptedBy {
		if id == e.Actor.ID {
			already = true
			break
		}
	}
	if !already {
		meetup.AcceptedBy = append(meetup.AcceptedBy, e.Actor.ID)
	}
	// CONFIRMED 需要除发起人外的所有成员都接受——多人房间里一个人同意
	// 不代表大家都能去，必须全员到齐才算"约定"。
	requiredAcceptances := 0
	for _, participant := range conv.Participants {
		if participant != meetup.ProposerID {
			requiredAcceptances++
		}
	}
	nowConfirmed := len(meetup.AcceptedBy) >= requiredAcceptances && requiredAcceptances > 0
	meetup.UpdatedAt = s.clock.Now().UTC()
	if nowConfirmed {
		meetup.Status = "CONFIRMED"
	}
	if err := s.repository.UpdateMeetup(ctx, meetup); err != nil {
		return command.Rejected(e, "MEETUP_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.meetup_update_failed", nil)
	}
	if nowConfirmed {
		_ = s.appendSystemMessage(ctx, conv, "大家都接受了见面邀约 · 已约定，记得准时")
	} else {
		_ = s.appendSystemMessage(ctx, conv, "有人接受了见面邀约")
	}
	domainEvents := []event.DomainEvent{event.New("MeetupAccepted", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, meetup.UpdatedAt, map[string]any{"meetupId": meetup.ID, "confirmed": nowConfirmed})}
	return acceptedWithPayload(e, "Meetup", meetup.ID, 1, meetup.Status, map[string]any{"meetup": meetup}, domainEvents)
}

func (s *Service) nudgeMeetup(ctx context.Context, e command.Envelope) command.Result {
	meetup, conv, rejected, ok := s.loadMeetupForActor(ctx, e)
	if !ok {
		return rejected
	}
	if meetup.Status != "PENDING" {
		return command.Rejected(e, "MEETUP_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.meetup_not_pending", map[string]any{"status": meetup.Status})
	}
	if meetup.ProposerID != e.Actor.ID {
		return command.Rejected(e, "ONLY_PROPOSER_CAN_NUDGE", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.only_proposer_can_nudge", nil)
	}
	if err := s.appendSystemMessage(ctx, conv, "发起人催了一下，还没接受见面邀约的成员请尽快回应"); err != nil {
		return command.Rejected(e, "MESSAGE_SEND_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.send_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("MeetupNudged", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{"meetupId": meetup.ID})}
	return acceptedWithPayload(e, "Meetup", meetup.ID, 1, "NUDGED", map[string]any{"meetup": meetup}, domainEvents)
}

func (s *Service) arriveMeetup(ctx context.Context, e command.Envelope) command.Result {
	meetup, conv, rejected, ok := s.loadMeetupForActor(ctx, e)
	if !ok {
		return rejected
	}
	if meetup.Status != "CONFIRMED" {
		return command.Rejected(e, "MEETUP_NOT_CONFIRMED", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.meetup_not_confirmed", map[string]any{"status": meetup.Status})
	}
	meetup.Status = "ONGOING"
	meetup.UpdatedAt = s.clock.Now().UTC()
	if err := s.repository.UpdateMeetup(ctx, meetup); err != nil {
		return command.Rejected(e, "MEETUP_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.meetup_update_failed", nil)
	}
	_ = s.appendSystemMessage(ctx, conv, "有人已到达 · 见面开始")
	domainEvents := []event.DomainEvent{event.New("MeetupStarted", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, meetup.UpdatedAt, map[string]any{"meetupId": meetup.ID})}
	return acceptedWithPayload(e, "Meetup", meetup.ID, 1, meetup.Status, map[string]any{"meetup": meetup}, domainEvents)
}

func (s *Service) completeMeetup(ctx context.Context, e command.Envelope) command.Result {
	meetup, conv, rejected, ok := s.loadMeetupForActor(ctx, e)
	if !ok {
		return rejected
	}
	if meetup.Status != "ONGOING" {
		return command.Rejected(e, "MEETUP_NOT_ONGOING", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.meetup_not_ongoing", map[string]any{"status": meetup.Status})
	}
	meetup.Status = "COMPLETED"
	meetup.UpdatedAt = s.clock.Now().UTC()
	if err := s.repository.UpdateMeetup(ctx, meetup); err != nil {
		return command.Rejected(e, "MEETUP_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.meetup_update_failed", nil)
	}
	conv.State = "ARCHIVED"
	if err := s.repository.UpdateConversation(ctx, conv); err != nil {
		return command.Rejected(e, "CONVERSATION_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.update_failed", nil)
	}
	_ = s.appendSystemMessage(ctx, conv, "见面已结束 · 房间归档")
	domainEvents := []event.DomainEvent{event.New("MeetupCompleted", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, meetup.UpdatedAt, map[string]any{"meetupId": meetup.ID})}
	return acceptedWithPayload(e, "Meetup", meetup.ID, 1, meetup.Status, map[string]any{"meetup": meetup}, domainEvents)
}

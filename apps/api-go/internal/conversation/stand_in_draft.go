package conversation

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// AI-MANAGE-013：对话权限「每次确认」= AI 先替本人起草，本人确认后才发出去。
//
// 用户规则（2026-09-23）：「代回复是什么意思 这个很简单 应该是代真人的回复」。
// 「全自动」是 AI 直接以本人身份回（带「AI 代回」小标）；「每次确认」是：
//   - 别人私信本人 → AI 用本人的语气起草一条回复，**只给本人看**，发消息的人那边
//     还是 AWAITING_OWNER（= 对方还没回），草稿内容绝不回给发消息的人；
//   - 本人在会话里看到草稿：原样发送 / 改了再发 / 丢弃；
//   - 发出去的是本人确认过的话，就是本人的消息（SenderID = 本人，不带 AI 代回标记）；
//   - 同一会话只保留最新一条待确认草稿：对方又发了一条，旧草稿作废（SUPERSEDED），
//     本人自己直接回了，草稿也作废 —— 不能让一条过时的草稿之后再被发出去。
//
// Token 记在本人头上（是本人的 AI 在起草），与全自动一致。
type StandInDraft struct {
	ID             string     `json:"draftId"`
	ConversationID string     `json:"conversationId"`
	OwnerID        string     `json:"ownerId"`
	InReplyTo      string     `json:"inReplyTo"`
	Body           string     `json:"body"`
	Status         string     `json:"status"` // PENDING | SENT | DISCARDED | SUPERSEDED
	SentMessageID  string     `json:"sentMessageId,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	ResolvedAt     *time.Time `json:"resolvedAt,omitempty"`
}

var ErrStandInDraftNotFound = errors.New("stand-in draft not found")

// --- MemoryRepository 实现 ---

func (r *MemoryRepository) SaveStandInDraft(_ context.Context, d StandInDraft) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.standInDrafts == nil {
		r.standInDrafts = make(map[string]StandInDraft)
	}
	r.standInDrafts[d.ID] = d
	return nil
}

func (r *MemoryRepository) GetStandInDraft(_ context.Context, id string) (StandInDraft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.standInDrafts[id]
	if !ok {
		return StandInDraft{}, ErrStandInDraftNotFound
	}
	return d, nil
}

func (r *MemoryRepository) PendingStandInDraft(_ context.Context, conversationID, ownerID string) (StandInDraft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best StandInDraft
	found := false
	for _, d := range r.standInDrafts {
		if d.ConversationID != conversationID || d.OwnerID != ownerID || d.Status != "PENDING" {
			continue
		}
		if !found || d.CreatedAt.After(best.CreatedAt) {
			best, found = d, true
		}
	}
	if !found {
		return StandInDraft{}, ErrStandInDraftNotFound
	}
	return best, nil
}

// --- 起草 ---

// supersedePendingStandInDraft 作废本人在这个会话里还没处理的草稿。
func (s *Service) supersedePendingStandInDraft(ctx context.Context, conversationID, ownerID string) {
	pending, err := s.repository.PendingStandInDraft(ctx, conversationID, ownerID)
	if err != nil {
		return
	}
	now := s.clock.Now().UTC()
	pending.Status = "SUPERSEDED"
	pending.ResolvedAt = &now
	if err := s.repository.SaveStandInDraft(ctx, pending); err != nil {
		log.Printf("conversation ai: supersede stand-in draft %s failed: %v", pending.ID, err)
	}
}

// draftStandInReply 在「每次确认」下替本人起草一条回复并存成待确认草稿。
// 在请求之外跑（发消息的人不用等模型）；不落消息、不返回给发消息的人；失败只记日志。
// 只给最新那条消息起草；起草期间本人自己回了，就不再留草稿。
func (s *Service) draftStandInReply(_ context.Context, conv Conversation, e command.Envelope, standIn aiStandIn, inReplyTo string, userText string, assistantMode string) {
	if standIn.Owner == "" || s.modelStack == nil || !s.modelStack.Available() {
		return
	}
	planKey := conv.ID + "#draft"
	s.standInPlans.mark(planKey, inReplyTo)
	s.runStandInJob(0, func() {
		ctx := context.Background()
		reply, _, _ := s.generateAIReplyInternal(withStandIn(ctx, standIn), conv, e, userText, assistantMode, nil, nil, false)
		if !s.standInPlans.claim(planKey, inReplyTo) {
			return // 对方又发了一条，由最新那次起草
		}
		if reply == nil || strings.TrimSpace(reply.Body) == "" || s.spokeAfter(ctx, conv.ID, inReplyTo, standIn.Owner) {
			return
		}
		s.supersedePendingStandInDraft(ctx, conv.ID, standIn.Owner)
		draft := StandInDraft{
			ID:             newID("sid_"),
			ConversationID: conv.ID,
			OwnerID:        standIn.Owner,
			InReplyTo:      inReplyTo,
			Body:           strings.TrimSpace(reply.Body),
			Status:         "PENDING",
			CreatedAt:      s.clock.Now().UTC(),
		}
		if err := s.repository.SaveStandInDraft(ctx, draft); err != nil {
			log.Printf("conversation ai: save stand-in draft failed: %v", err)
		}
	})
}

// pendingStandInDraftFor 只给本人看：别人（包括发消息的人）永远拿不到。
func (s *Service) pendingStandInDraftFor(ctx context.Context, conversationID, actorID string) *StandInDraft {
	d, err := s.repository.PendingStandInDraft(ctx, conversationID, actorID)
	if err != nil {
		return nil
	}
	return &d
}

// --- 本人处理草稿 ---

type standInDraftPayload struct {
	DraftID string `json:"draftId"`
	// Body 可选：本人改过再发就带改后的正文；不带 = 原样发送。
	Body string `json:"body"`
}

func (s *Service) loadStandInDraftForOwner(ctx context.Context, e command.Envelope) (StandInDraft, Conversation, standInDraftPayload, command.Result, bool) {
	var p standInDraftPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.DraftID) == "" {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "INVALID_STAND_IN_DRAFT", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_stand_in_draft", nil), false
	}
	draft, err := s.repository.GetStandInDraft(ctx, strings.TrimSpace(p.DraftID))
	if errors.Is(err, ErrStandInDraftNotFound) {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "STAND_IN_DRAFT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.stand_in_draft_not_found", nil), false
	}
	if err != nil {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "STAND_IN_DRAFT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.stand_in_draft_read_failed", nil), false
	}
	// 只有被代表的本人能发 / 丢自己的草稿；对方连草稿存在都不该知道，所以同样报「找不到」。
	if draft.OwnerID != e.Actor.ID {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "STAND_IN_DRAFT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.stand_in_draft_not_found", nil), false
	}
	if draft.Status != "PENDING" {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "STAND_IN_DRAFT_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.stand_in_draft_not_pending", map[string]any{"status": draft.Status}), false
	}
	conv, err := s.repository.GetConversation(ctx, draft.ConversationID)
	if err != nil {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil), false
	}
	if !isParticipant(conv, e.Actor.ID) {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil), false
	}
	if conv.State != "ACTIVE" {
		return StandInDraft{}, Conversation{}, p, command.Rejected(e, "CONVERSATION_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.not_active", nil), false
	}
	return draft, conv, p, command.Result{}, true
}

func (s *Service) sendStandInDraft(ctx context.Context, e command.Envelope) command.Result {
	draft, conv, p, rejected, ok := s.loadStandInDraftForOwner(ctx, e)
	if !ok {
		return rejected
	}
	body := strings.TrimSpace(p.Body)
	if body == "" {
		body = draft.Body
	}
	existing, _ := s.repository.Messages(ctx, conv.ID)
	protection := DefaultProtectionFor("TEXT", conv.Type).WithoutUnbackedClaims()
	now := s.clock.Now().UTC()
	msg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		DialogID:       conv.ID,
		SenderID:       e.Actor.ID,
		MessageType:    "TEXT",
		Kind:           "text",
		Body:           body,
		CreatedAt:      now,
		Protection:     protection,
		SecurityV1:     protectionToSecurityV1(protection),
		Delivery:       &MessageDelivery{State: "sent"},
		Seq:            int64(len(existing) + 1),
	}
	if err := s.repository.AppendMessage(ctx, msg); err != nil {
		return command.Rejected(e, "MESSAGE_SEND_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.send_failed", nil)
	}
	draft.Status = "SENT"
	draft.SentMessageID = msg.ID
	draft.ResolvedAt = &now
	if err := s.repository.SaveStandInDraft(ctx, draft); err != nil {
		log.Printf("conversation ai: mark stand-in draft %s sent failed: %v", draft.ID, err)
	}
	domainEvents := []event.DomainEvent{event.New("MessageSent", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"messageId":   msg.ID,
		"messageType": msg.MessageType,
		"senderId":    msg.SenderID,
		"draftId":     draft.ID,
		"edited":      body != draft.Body,
		"note":        "本人确认后发出的 AI 草稿（每次确认）",
	})}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, map[string]any{"message": msg, "draftId": draft.ID}, domainEvents)
}

func (s *Service) discardStandInDraft(ctx context.Context, e command.Envelope) command.Result {
	draft, conv, _, rejected, ok := s.loadStandInDraftForOwner(ctx, e)
	if !ok {
		return rejected
	}
	now := s.clock.Now().UTC()
	draft.Status = "DISCARDED"
	draft.ResolvedAt = &now
	if err := s.repository.SaveStandInDraft(ctx, draft); err != nil {
		return command.Rejected(e, "STAND_IN_DRAFT_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.stand_in_draft_update_failed", nil)
	}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, map[string]any{"draftId": draft.ID, "status": draft.Status}, nil)
}

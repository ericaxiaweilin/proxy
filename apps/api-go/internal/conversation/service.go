package conversation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// Conversation / DM（R14 Chapter21I §6 + R9 Gate C/D/K）。
// 硬规则：
//  1. Conversation 必须保存 origin_type / origin_id（聊天顶部知道为什么开始聊）
//  2. 同一个 Post 被不同用户发起 DM 时，Conversation 独立
//  3. ordinary chat 不修改 Need / Order
//  4. 结构化建议必须由用户明确接受后才能成为正式事实

// Conversation 是对话聚合。
type Conversation struct {
	ID            string    `json:"conversationId"`
	Type          string    `json:"conversationType"` // DM | GROUP | SUPPORT
	OriginType    string    `json:"originType"`       // POST | PROFILE | SERVICE | ACTIVITY | NEED | OFFER | ORDER
	OriginID      string    `json:"originId"`
	MarketID      string    `json:"marketId,omitempty"`
	State         string    `json:"state"` // ACTIVE | ARCHIVED | BLOCKED
	Participants  []string  `json:"participants"`
	CreatedAt     time.Time `json:"createdAt"`
	LastMessageAt time.Time `json:"lastMessageAt"`
}

// Message 是对话消息。
type Message struct {
	ID             string     `json:"messageId"`
	ConversationID string     `json:"conversationId"`
	SenderID       string     `json:"senderId"`
	MessageType    string     `json:"messageType"` // TEXT | IMAGE | SYSTEM_CONTEXT | STRUCTURED_SUGGESTION
	Body           string     `json:"body,omitempty"`
	MediaRef       string     `json:"mediaRef,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	EditedAt       *time.Time `json:"editedAt,omitempty"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
}

// NeedDraft 是 Conversation 内的显式 Need Draft（Gate D：普通消息不创建正式 Need）。
type NeedDraft struct {
	DraftID        string    `json:"draftId"`
	ConversationID string    `json:"conversationId"`
	Summary        string    `json:"summary"`
	Confirmed      bool      `json:"confirmed"`
	NeedID         string    `json:"needId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Repository interface {
	CreateConversation(ctx context.Context, c Conversation) error
	GetConversation(ctx context.Context, id string) (Conversation, error)
	AppendMessage(ctx context.Context, m Message) error
	Messages(ctx context.Context, conversationID string) ([]Message, error)
	SaveNeedDraft(ctx context.Context, d NeedDraft) error
	GetNeedDraft(ctx context.Context, draftID string) (NeedDraft, error)
	UpdateNeedDraft(ctx context.Context, d NeedDraft) error
	Snapshot(ctx context.Context) ([]Conversation, error)
}

var (
	ErrConversationNotFound = errors.New("conversation not found")
	ErrDraftNotFound        = errors.New("need draft not found")
)

type MemoryRepository struct {
	mu            sync.Mutex
	conversations map[string]Conversation
	messages      map[string][]Message
	drafts        map[string]NeedDraft
	events        []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		conversations: make(map[string]Conversation),
		messages:      make(map[string][]Message),
		drafts:        make(map[string]NeedDraft),
	}
}

func (r *MemoryRepository) CreateConversation(_ context.Context, c Conversation) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.conversations[c.ID]; exists {
		return errors.New("conversation already exists")
	}
	r.conversations[c.ID] = cloneConversation(c)
	return nil
}

func (r *MemoryRepository) GetConversation(_ context.Context, id string) (Conversation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, exists := r.conversations[id]
	if !exists {
		return Conversation{}, ErrConversationNotFound
	}
	return cloneConversation(c), nil
}

func (r *MemoryRepository) AppendMessage(_ context.Context, m Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.messages[m.ConversationID] = append(r.messages[m.ConversationID], cloneMessage(m))
	// 更新 conversation lastMessageAt
	if c, exists := r.conversations[m.ConversationID]; exists {
		c.LastMessageAt = m.CreatedAt
		r.conversations[m.ConversationID] = c
	}
	return nil
}

func (r *MemoryRepository) Messages(_ context.Context, conversationID string) ([]Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Message, len(r.messages[conversationID]))
	for i, m := range r.messages[conversationID] {
		result[i] = cloneMessage(m)
	}
	return result, nil
}

func (r *MemoryRepository) SaveNeedDraft(_ context.Context, d NeedDraft) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.drafts[d.DraftID] = d
	return nil
}

func (r *MemoryRepository) GetNeedDraft(_ context.Context, draftID string) (NeedDraft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, exists := r.drafts[draftID]
	if !exists {
		return NeedDraft{}, ErrDraftNotFound
	}
	return d, nil
}

func (r *MemoryRepository) UpdateNeedDraft(_ context.Context, d NeedDraft) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.drafts[d.DraftID]; !exists {
		return ErrDraftNotFound
	}
	r.drafts[d.DraftID] = d
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]Conversation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Conversation, 0, len(r.conversations))
	for _, c := range r.conversations {
		result = append(result, cloneConversation(c))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func cloneConversation(c Conversation) Conversation {
	c.Participants = append([]string(nil), c.Participants...)
	return c
}

func cloneMessage(m Message) Message {
	if m.EditedAt != nil {
		t := *m.EditedAt
		m.EditedAt = &t
	}
	if m.DeletedAt != nil {
		t := *m.DeletedAt
		m.DeletedAt = &t
	}
	return m
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	clock      clock.Clock
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "StartConversation", "SendMessage", "ListConversationMessages",
		"CreateNeedDraft", "ConfirmNeedDraft":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "StartConversation":
		return s.startConversation(ctx, e)
	case "SendMessage":
		return s.sendMessage(ctx, e)
	case "ListConversationMessages":
		return s.listMessages(ctx, e)
	case "CreateNeedDraft":
		return s.createNeedDraft(ctx, e)
	case "ConfirmNeedDraft":
		return s.confirmNeedDraft(ctx, e)
	default:
		return command.Rejected(e, "CONVERSATION_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "conversation.unsupported_command", nil)
	}
}

// ---------- StartConversation ----------
// Gate C：Post → Profile → Conversation；origin_type/origin_id 必存；
// 同一个 Post 被不同用户发起 DM 时 Conversation 独立。

type startConversationPayload struct {
	ConversationType string `json:"conversationType"`
	OriginType       string `json:"originType"`
	OriginID         string `json:"originId"`
	ParticipantID    string `json:"participantId"`
	MarketID         string `json:"marketId"`
	FirstMessage     string `json:"firstMessage"`
}

func (s *Service) startConversation(ctx context.Context, e command.Envelope) command.Result {
	var p startConversationPayload
	if !decode(e.Payload, &p) || p.OriginType == "" || p.OriginID == "" || p.ParticipantID == "" {
		return command.Rejected(e, "INVALID_CONVERSATION_START", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_start", nil)
	}
	validOrigins := map[string]bool{"POST": true, "PROFILE": true, "SERVICE": true, "ACTIVITY": true, "NEED": true, "OFFER": true, "ORDER": true}
	if !validOrigins[p.OriginType] {
		return command.Rejected(e, "INVALID_ORIGIN_TYPE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_origin", map[string]any{"originType": p.OriginType})
	}
	if p.ConversationType == "" {
		p.ConversationType = "DM"
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "CONVERSATION_START_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.start_not_allowed", nil)
	}
	conv := Conversation{
		ID:            newID("conv_"),
		Type:          p.ConversationType,
		OriginType:    p.OriginType,
		OriginID:      p.OriginID,
		MarketID:      p.MarketID,
		State:         "ACTIVE",
		Participants:  []string{e.Actor.ID, p.ParticipantID},
		CreatedAt:     s.clock.Now().UTC(),
		LastMessageAt: s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("ConversationStarted", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, conv.CreatedAt, map[string]any{
		"originType":   conv.OriginType,
		"originId":     conv.OriginID,
		"participants": conv.Participants,
		"note":         "Conversation 必须保存来源；同一 Post 不同用户发起 DM 时 Conversation 独立",
	})}
	if err := s.repository.CreateConversation(ctx, conv); err != nil {
		return command.Rejected(e, "CONVERSATION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.create_failed", nil)
	}
	// 首条消息（如果有）
	if p.FirstMessage != "" {
		msg := Message{
			ID:             newID("msg_"),
			ConversationID: conv.ID,
			SenderID:       e.Actor.ID,
			MessageType:    "TEXT",
			Body:           p.FirstMessage,
			CreatedAt:      s.clock.Now().UTC(),
		}
		_ = s.repository.AppendMessage(ctx, msg)
	}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, map[string]any{
		"conversationId": conv.ID,
		"originType":     conv.OriginType,
		"originId":       conv.OriginID,
	}, domainEvents)
}

// ---------- SendMessage ----------
// Gate K：实时 IM 最小；ordinary chat 不修改 Need/Order。

type sendMessagePayload struct {
	MessageType string `json:"messageType"`
	Body        string `json:"body"`
	MediaRef    string `json:"mediaRef"`
}

func (s *Service) sendMessage(ctx context.Context, e command.Envelope) command.Result {
	var p sendMessagePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_message", nil)
	}
	if p.MessageType == "" {
		p.MessageType = "TEXT"
	}
	validTypes := map[string]bool{"TEXT": true, "IMAGE": true, "SYSTEM_CONTEXT": true, "STRUCTURED_SUGGESTION": true}
	if !validTypes[p.MessageType] {
		return command.Rejected(e, "INVALID_MESSAGE_TYPE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_message_type", map[string]any{"messageType": p.MessageType})
	}
	if p.MessageType == "TEXT" && p.Body == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", nil)
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
	msg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		SenderID:       e.Actor.ID,
		MessageType:    p.MessageType,
		Body:           p.Body,
		MediaRef:       p.MediaRef,
		CreatedAt:      s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("MessageSent", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, msg.CreatedAt, map[string]any{
		"messageId":   msg.ID,
		"messageType": msg.MessageType,
		"senderId":    msg.SenderID,
		"note":        "ordinary chat 不修改 Need / Order",
	})}
	if err := s.repository.AppendMessage(ctx, msg); err != nil {
		return command.Rejected(e, "MESSAGE_SEND_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.send_failed", nil)
	}
	return command.Accepted(e, "Conversation", conv.ID, 1, conv.State, eventRefs(domainEvents))
}

// ---------- ListConversationMessages ----------

func (s *Service) listMessages(ctx context.Context, e command.Envelope) command.Result {
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
	messages, err := s.repository.Messages(ctx, e.Target.ID)
	if err != nil {
		return command.Rejected(e, "MESSAGE_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.list_failed", nil)
	}
	return acceptedWithPayload(e, "Conversation", e.Target.ID, 1, conv.State, map[string]any{
		"messages": messages,
	}, nil)
}

// ---------- CreateNeedDraft ----------
// Gate D：普通消息不创建正式 Need；可创建 Need Draft；用户明确确认后才正式。

type createNeedDraftPayload struct {
	Summary string `json:"summary"`
}

func (s *Service) createNeedDraft(ctx context.Context, e command.Envelope) command.Result {
	var p createNeedDraftPayload
	if !decode(e.Payload, &p) || p.Summary == "" {
		return command.Rejected(e, "INVALID_NEED_DRAFT", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_need_draft", nil)
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
	draft := NeedDraft{
		DraftID:        newID("nd_"),
		ConversationID: conv.ID,
		Summary:        p.Summary,
		Confirmed:      false,
		CreatedAt:      s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("NeedDraftCreated", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, draft.CreatedAt, map[string]any{
		"draftId": draft.DraftID,
		"summary": draft.Summary,
		"note":    "Need Draft 不是正式 Need；用户明确确认后才产生正式 Need",
	})}
	if err := s.repository.SaveNeedDraft(ctx, draft); err != nil {
		return command.Rejected(e, "NEED_DRAFT_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.need_draft_failed", nil)
	}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, map[string]any{
		"draftId":   draft.DraftID,
		"confirmed": false,
	}, domainEvents)
}

// ---------- ConfirmNeedDraft ----------
// 用户明确确认后 Need Draft → 正式 Need（保留 Conversation origin）。

func (s *Service) confirmNeedDraft(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		DraftID string `json:"draftId"`
	}
	if !decode(e.Payload, &p) || p.DraftID == "" {
		return command.Rejected(e, "INVALID_DRAFT_CONFIRM", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_draft_confirm", nil)
	}
	draft, err := s.repository.GetNeedDraft(ctx, p.DraftID)
	if errors.Is(err, ErrDraftNotFound) {
		return command.Rejected(e, "NEED_DRAFT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.draft_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "NEED_DRAFT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.draft_read_failed", nil)
	}
	if draft.Confirmed {
		return command.Rejected(e, "NEED_DRAFT_ALREADY_CONFIRMED", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.draft_already_confirmed", nil)
	}
	conv, err := s.repository.GetConversation(ctx, draft.ConversationID)
	if errors.Is(err, ErrConversationNotFound) {
		return command.Rejected(e, "CONVERSATION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil)
	}
	if !isParticipant(conv, e.Actor.ID) {
		return command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil)
	}
	needID := newID("need_")
	draft.Confirmed = true
	draft.NeedID = needID
	if err := s.repository.UpdateNeedDraft(ctx, draft); err != nil {
		return command.Rejected(e, "NEED_DRAFT_CONFIRM_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.draft_confirm_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("NeedConfirmedFromConversation", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"needId":     needID,
		"draftId":    draft.DraftID,
		"originType": conv.OriginType,
		"originId":   conv.OriginID,
		"note":       "Need 生成后 Conversation 不丢失；origin 保留",
	})}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, map[string]any{
		"needId":    needID,
		"confirmed": true,
	}, domainEvents)
}

// ---------- helpers ----------

func isParticipant(conv Conversation, actorID string) bool {
	for _, p := range conv.Participants {
		if p == actorID {
			return true
		}
	}
	return false
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return false
	}
	return true
}

func newID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + hex.EncodeToString(raw[:])
	}
	return prefix + "fallback"
}

func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}

package conversation

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/modelstack"
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
	OriginType    string    `json:"originType"`       // HOME | TASK | POST | PROFILE | SERVICE | ACTIVITY | NEED | OFFER | ORDER
	OriginID      string    `json:"originId"`
	MarketID      string    `json:"marketId,omitempty"`
	State         string    `json:"state"` // ACTIVE | ARCHIVED | BLOCKED
	Participants  []string  `json:"participants"`
	CreatedAt     time.Time `json:"createdAt"`
	LastMessageAt time.Time `json:"lastMessageAt"`
}

// Message 是对话消息。v0 字段 (ConversationID/MessageType) 保留兼容；v1 契约见
// docs/design/references/Proxy_Message_Object_Schema_v1.json 与
// Proxy_Messaging_Engineering_Spec_v1.md §2/§11。
type Message struct {
	ID             string             `json:"messageId"`
	ConversationID string             `json:"conversationId"`     // legacy; 同义 dialog_id
	DialogID       string             `json:"dialogId,omitempty"` // v1 正式；与 ConversationID 同值过渡期双写
	ConvoID        *string            `json:"convoId,omitempty"`  // v1: 所属 Convo 分支
	SenderID       string             `json:"senderId"`
	SenderSnapshot *IdentitySnapshot  `json:"senderSnapshot,omitempty"` // v1: 发送时固化的 displayName/avatar/username
	MessageType    string             `json:"messageType"`              // v0: TEXT | IMAGE | VIDEO | LOCATION | SYSTEM_CONTEXT | STRUCTURED_SUGGESTION
	Kind           string             `json:"kind,omitempty"`           // v1: text|image|video|file|location|contact|proxy_object|poll|call_recording|system_event
	Body           string             `json:"body,omitempty"`           // v1 text 仍用 body
	MediaRef       string             `json:"mediaRef,omitempty"`
	ProxyObject    *ProxyObjectRef    `json:"proxyObject,omitempty"` // v1
	SecurityV1     *MessageSecurityV1 `json:"security,omitempty"`    // v1; 与 Protection 双写过渡
	Delivery       *MessageDelivery   `json:"delivery,omitempty"`    // v1
	Seq            int64              `json:"seq,omitempty"`         // v1: dialog 内递增，用于 ReadCursor
	CreatedAt      time.Time          `json:"createdAt"`
	EditedAt       *time.Time         `json:"editedAt,omitempty"`
	DeletedAt      *time.Time         `json:"deletedAt,omitempty"`
	// Protection is the per-message anti-leak envelope. See
	// message_protection.go and RFC v0.1 §3. Defaults applied in
	// sendMessage; per-type rules in DefaultProtectionFor.
	Protection MessageProtection `json:"protection"`
}

// v1 辅助类型 — 与 JSON Schema 1:1

type IdentitySnapshot struct {
	DisplayName string  `json:"displayName"`
	AvatarRef   *string `json:"avatarRef,omitempty"`
	Username    *string `json:"username,omitempty"`
}

type ProxyObjectRef struct {
	ObjectType string         `json:"objectType"` // invitation|activity|opportunity|voucher|post|order
	ObjectID   string         `json:"objectId"`
	Snapshot   map[string]any `json:"snapshot"`
	LiveState  map[string]any `json:"liveState,omitempty"`
}

type MessageSecurityV1 struct {
	Mode               string  `json:"mode"` // normal|secure
	ViewLimit          *int    `json:"viewLimit,omitempty"`
	ViewDurationSec    *int    `json:"viewDurationSeconds,omitempty"`
	ForwardAllowed     bool    `json:"forwardAllowed"`
	CopyAllowed        bool    `json:"copyAllowed"`
	SaveAllowed        bool    `json:"saveAllowed"`
	CiphertextRef      *string `json:"ciphertextRef,omitempty"`
	DeleteAfterReadSec *int    `json:"deleteAfterReadSeconds,omitempty"`
}

type MessageDelivery struct {
	State       string `json:"state"` // sending|sent|delivered|read|failed
	ReadByCount *int   `json:"readByCount,omitempty"`
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
	UpdateConversation(ctx context.Context, c Conversation) error
	GetConversation(ctx context.Context, id string) (Conversation, error)
	AppendMessage(ctx context.Context, m Message) error
	// UpdateMessage replaces a message in place. Used for read-counting
	// (MarkMessageRead) and protection metadata. Must return
	// ErrMessageNotFound when the message is absent.
	UpdateMessage(ctx context.Context, m Message) error
	// GetMessage returns a single message by ID. Walks every
	// conversation's list; PG adapter should index by message ID.
	GetMessage(ctx context.Context, id string) (Message, error)
	Messages(ctx context.Context, conversationID string) ([]Message, error)
	SaveNeedDraft(ctx context.Context, d NeedDraft) error
	GetNeedDraft(ctx context.Context, draftID string) (NeedDraft, error)
	UpdateNeedDraft(ctx context.Context, d NeedDraft) error
	Snapshot(ctx context.Context) ([]Conversation, error)
	// PurgeExpiredMessages hard-deletes messages past protection.ExpiresAt.
	// Lotus RFC §5 (30-day default TTL). PG impl uses index on
	// protection->>'expiresAt'; Memory impl scans. Returns deleted count.
	PurgeExpiredMessages(ctx context.Context, now time.Time) (int64, error)
}

var (
	ErrConversationNotFound = errors.New("conversation not found")
	ErrDraftNotFound        = errors.New("need draft not found")
	ErrMessageNotFound      = errors.New("message not found")
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

func (r *MemoryRepository) UpdateConversation(_ context.Context, c Conversation) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.conversations[c.ID]; !exists {
		return ErrConversationNotFound
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

// GetMessage fetches a single message by ID. The implementation walks every
// conversation's message list — fine for in-memory tests, a Postgres adapter
// should index by message ID. Used by protection read / screenshot events.
func (r *MemoryRepository) GetMessage(_ context.Context, id string) (Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, list := range r.messages {
		for _, m := range list {
			if m.ID == id {
				return cloneMessage(m), nil
			}
		}
	}
	return Message{}, ErrMessageNotFound
}

// UpdateMessage replaces a message in place. Used for view-counting after
// recipient reads, and for protection overrides applied at send time. The
// caller (service layer) is responsible for version / lifecycle checks; the
// repository just persists.
func (r *MemoryRepository) UpdateMessage(_ context.Context, m Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	list, exists := r.messages[m.ConversationID]
	if !exists {
		return ErrMessageNotFound
	}
	for i, existing := range list {
		if existing.ID == m.ID {
			list[i] = cloneMessage(m)
			r.messages[m.ConversationID] = list
			return nil
		}
	}
	return ErrMessageNotFound
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

// PurgeExpiredMessages hard-deletes messages whose protection.ExpiresAt <= now.
// Lotus RFC §5: default 30d TTL (per-type). Caller (worker) passes clock.Now().
func (r *MemoryRepository) PurgeExpiredMessages(_ context.Context, now time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var deleted int64
	for convID, list := range r.messages {
		kept := list[:0]
		for _, m := range list {
			if m.Protection.IsExpiredAt(now) {
				deleted++
				continue
			}
			kept = append(kept, m)
		}
		if len(kept) != len(list) {
			if len(kept) == 0 {
				delete(r.messages, convID)
			} else {
				r.messages[convID] = kept
			}
		}
	}
	return deleted, nil
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
	if m.ConvoID != nil {
		v := *m.ConvoID
		m.ConvoID = &v
	}
	if m.SenderSnapshot != nil {
		cp := *m.SenderSnapshot
		if m.SenderSnapshot.AvatarRef != nil {
			v := *m.SenderSnapshot.AvatarRef
			cp.AvatarRef = &v
		}
		if m.SenderSnapshot.Username != nil {
			v := *m.SenderSnapshot.Username
			cp.Username = &v
		}
		m.SenderSnapshot = &cp
	}
	if m.ProxyObject != nil {
		cp := *m.ProxyObject
		cp.Snapshot = cloneMap(m.ProxyObject.Snapshot)
		cp.LiveState = cloneMap(m.ProxyObject.LiveState)
		m.ProxyObject = &cp
	}
	if m.SecurityV1 != nil {
		cp := *m.SecurityV1
		if m.SecurityV1.ViewLimit != nil {
			v := *m.SecurityV1.ViewLimit
			cp.ViewLimit = &v
		}
		if m.SecurityV1.ViewDurationSec != nil {
			v := *m.SecurityV1.ViewDurationSec
			cp.ViewDurationSec = &v
		}
		if m.SecurityV1.CiphertextRef != nil {
			v := *m.SecurityV1.CiphertextRef
			cp.CiphertextRef = &v
		}
		if m.SecurityV1.DeleteAfterReadSec != nil {
			v := *m.SecurityV1.DeleteAfterReadSec
			cp.DeleteAfterReadSec = &v
		}
		m.SecurityV1 = &cp
	}
	if m.Delivery != nil {
		cp := *m.Delivery
		if m.Delivery.ReadByCount != nil {
			v := *m.Delivery.ReadByCount
			cp.ReadByCount = &v
		}
		m.Delivery = &cp
	}
	if m.DialogID == "" && m.ConversationID != "" {
		m.DialogID = m.ConversationID
	}
	if m.Kind == "" && m.MessageType != "" {
		m.Kind = messageTypeToKind(m.MessageType)
	}
	return m
}

func cloneMap(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	cp := make(map[string]any, len(m))
	for k, v := range m {
		cp[k] = v
	}
	return cp
}

func messageTypeToKind(t string) string {
	switch t {
	case "TEXT", "SYSTEM_CONTEXT", "STRUCTURED_SUGGESTION":
		return "text"
	case "IMAGE":
		return "image"
	case "VIDEO":
		return "video"
	case "AUDIO":
		return "audio"
	case "LOCATION":
		return "location"
	default:
		return "text"
	}
}

func protectionToSecurityV1(p MessageProtection) *MessageSecurityV1 {
	mode := "normal"
	if p.EndToEndEncrypted && p.ScreenshotProtected {
		mode = "secure"
	}
	sec := &MessageSecurityV1{
		Mode:           mode,
		ForwardAllowed: p.Forwardable,
		CopyAllowed:    p.Copyable,
		SaveAllowed:    p.Forwardable,
	}
	if p.ViewLimit > 0 {
		v := p.ViewLimit
		sec.ViewLimit = &v
	}
	if p.ExpiresAt != nil {
		// delete_after_read not used for TTL; viewDuration for ephemeral
	}
	return sec
}

type Service struct {
	mu            sync.Mutex
	repository    Repository
	clock         clock.Clock
	modelStack    modelstack.Port
	mediaStoreDir string
}

// SweepExpiredMessages hard-deletes messages past protection.ExpiresAt.
// Lotus RFC §5 (30d default, per-type). Worker calls this hourly; unit
// tests call PurgeExpiredMessages directly with a controllable clock.
func (s *Service) SweepExpiredMessages(ctx context.Context) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repository.PurgeExpiredMessages(ctx, s.clock.Now().UTC())
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	return NewWithRepositoryAndClock(repository, clock.System{})
}

// NewWithRepositoryAndClock is the test-friendly constructor. Added in
// PR 2 (Message.Protection) so TTL / view-limit tests can advance the
// clock deterministically.
func NewWithRepositoryAndClock(repository Repository, clk clock.Clock) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	if clk == nil {
		clk = clock.System{}
	}
	return &Service{repository: repository, clock: clk, modelStack: modelstack.Unconfigured{}}
}

func NewWithModelStack(repository Repository, ms modelstack.Port) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	if ms == nil {
		ms = modelstack.Unconfigured{}
	}
	return &Service{repository: repository, clock: clock.System{}, modelStack: ms}
}

// SetMediaStoreDir wires the same object-store root used by the API and media
// worker. Vision must not guess relative working directories.
func (s *Service) SetMediaStoreDir(dir string) {
	s.mediaStoreDir = strings.TrimSpace(dir)
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "StartConversation", "SendMessage", "ListConversations", "ListConversationMessages", "MarkMessageRead", "DeleteMessage", "SetConversationBlocked", "RecordScreenshot", "ForwardMessage",
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
	case "ListConversations":
		return s.listConversations(ctx, e)
	case "ListConversationMessages":
		return s.listMessages(ctx, e)
	case "MarkMessageRead":
		return s.markMessageRead(ctx, e)
	case "DeleteMessage":
		return s.deleteMessage(ctx, e)
	case "SetConversationBlocked":
		return s.setConversationBlocked(ctx, e)
	case "RecordScreenshot":
		return s.recordScreenshot(ctx, e)
	case "ForwardMessage":
		return s.forwardMessage(ctx, e)
	case "CreateNeedDraft":
		return s.createNeedDraft(ctx, e)
	case "ConfirmNeedDraft":
		return s.confirmNeedDraft(ctx, e)
	default:
		return command.Rejected(e, "CONVERSATION_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "conversation.unsupported_command", nil)
	}
}

type ConversationSummary struct {
	Conversation         Conversation      `json:"conversation"`
	LatestMessage        *Message          `json:"latestMessage,omitempty"`
	CounterpartyID       string            `json:"counterpartyId,omitempty"`
	CounterpartySnapshot *IdentitySnapshot `json:"counterpartySnapshot,omitempty"`
}

func (s *Service) listConversations(ctx context.Context, e command.Envelope) command.Result {
	conversations, err := s.repository.Snapshot(ctx)
	if err != nil {
		return command.Rejected(e, "CONVERSATION_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.list_failed", nil)
	}
	summaries := make([]ConversationSummary, 0, len(conversations))
	for _, conv := range conversations {
		if !isParticipant(conv, e.Actor.ID) || conv.State == "BLOCKED" {
			continue
		}
		summary := ConversationSummary{Conversation: conv}
		for _, participantID := range conv.Participants {
			if participantID != e.Actor.ID {
				summary.CounterpartyID = participantID
				break
			}
		}
		messages, messageErr := s.repository.Messages(ctx, conv.ID)
		if messageErr != nil {
			return command.Rejected(e, "MESSAGE_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.list_failed", nil)
		}
		if len(messages) > 0 {
			latest := messages[len(messages)-1]
			summary.LatestMessage = &latest
			for index := len(messages) - 1; index >= 0; index-- {
				if messages[index].SenderID != e.Actor.ID && messages[index].SenderSnapshot != nil {
					snapshot := *messages[index].SenderSnapshot
					summary.CounterpartySnapshot = &snapshot
					break
				}
			}
		}
		summaries = append(summaries, summary)
	}
	sort.SliceStable(summaries, func(i, j int) bool {
		return summaries[i].Conversation.LastMessageAt.After(summaries[j].Conversation.LastMessageAt)
	})
	// One inbox row per DM counterparty. Historical duplicate conversations stay
	// auditable, but only the newest thread is presented to the user.
	deduped := make([]ConversationSummary, 0, len(summaries))
	seenDM := map[string]bool{}
	for _, summary := range summaries {
		if summary.Conversation.Type == "DM" && summary.CounterpartyID != "" {
			if seenDM[summary.CounterpartyID] {
				continue
			}
			seenDM[summary.CounterpartyID] = true
		}
		deduped = append(deduped, summary)
	}
	return acceptedWithPayload(e, "ConversationInbox", e.Actor.ID, 1, "READY", map[string]any{"conversations": deduped}, nil)
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
	MediaRef         string `json:"mediaRef"`
	AssistantMode    string `json:"assistantMode"`
}

func (s *Service) startConversation(ctx context.Context, e command.Envelope) command.Result {
	var p startConversationPayload
	if !decode(e.Payload, &p) || p.OriginType == "" || p.OriginID == "" || p.ParticipantID == "" {
		return command.Rejected(e, "INVALID_CONVERSATION_START", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_start", nil)
	}
	validOrigins := map[string]bool{"HOME": true, "TASK": true, "POST": true, "PROFILE": true, "SERVICE": true, "ACTIVITY": true, "NEED": true, "OFFER": true, "ORDER": true}
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
	reusedConversation := false
	if p.ConversationType == "DM" {
		if existing, ok := s.latestDirectConversation(ctx, e.Actor.ID, p.ParticipantID); ok {
			conv = existing
			reusedConversation = true
		}
	}
	domainEvents := []event.DomainEvent{}
	if !reusedConversation {
		domainEvents = append(domainEvents, event.New("ConversationStarted", "Conversation", conv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, conv.CreatedAt, map[string]any{
			"originType": conv.OriginType, "originId": conv.OriginID, "participants": conv.Participants,
			"note": "Conversation 必须保存来源；同一 Post 不同用户发起 DM 时 Conversation 独立",
		}))
		if err := s.repository.CreateConversation(ctx, conv); err != nil {
			return command.Rejected(e, "CONVERSATION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.create_failed", nil)
		}
	}
	existingMessages, _ := s.repository.Messages(ctx, conv.ID)
	nextSeq := int64(len(existingMessages) + 1)
	if reusedConversation && p.OriginType == "HOME" && len(existingMessages) > 0 && strings.TrimSpace(p.FirstMessage) != "" {
		separator := Message{ID: newID("msg_"), ConversationID: conv.ID, DialogID: conv.ID, SenderID: "SYSTEM", MessageType: "SYSTEM_CONTEXT", Kind: "system_event", Body: "新的 Home 对话", CreatedAt: s.clock.Now().UTC(), Protection: DefaultProtectionFor("SYSTEM_CONTEXT", conv.Type), Delivery: &MessageDelivery{State: "sent"}, Seq: nextSeq}
		separator.SecurityV1 = protectionToSecurityV1(separator.Protection)
		_ = s.repository.AppendMessage(ctx, separator)
		nextSeq++
	}
	// 首条消息（如果有）— v1 双写 DialogID/Kind/Security/Delivery/Seq
	if p.FirstMessage != "" {
		prot := DefaultProtectionFor("TEXT", conv.Type)
		msg := Message{
			ID:             newID("msg_"),
			ConversationID: conv.ID,
			DialogID:       conv.ID,
			SenderID:       e.Actor.ID,
			MessageType:    "TEXT",
			Kind:           "text",
			Body:           p.FirstMessage,
			CreatedAt:      s.clock.Now().UTC(),
			Protection:     prot,
			SecurityV1:     protectionToSecurityV1(prot),
			Delivery:       &MessageDelivery{State: "sent"},
			Seq:            nextSeq,
		}
		_ = s.repository.AppendMessage(ctx, msg)
	}
	if p.MediaRef != "" {
		prot := DefaultProtectionFor("IMAGE", conv.Type)
		seq := nextSeq
		if p.FirstMessage != "" {
			seq++
		}
		_ = s.repository.AppendMessage(ctx, Message{
			ID: newID("msg_"), ConversationID: conv.ID, DialogID: conv.ID, SenderID: e.Actor.ID,
			MessageType: "IMAGE", Kind: "image", MediaRef: p.MediaRef, CreatedAt: s.clock.Now().UTC(),
			Protection: prot, SecurityV1: protectionToSecurityV1(prot), Delivery: &MessageDelivery{State: "sent"}, Seq: seq,
		})
	}
	payload := map[string]any{
		"conversationId": conv.ID,
		"originType":     conv.OriginType,
		"originId":       conv.OriginID,
	}
	hasInitialContent := strings.TrimSpace(p.FirstMessage) != "" || strings.TrimSpace(p.MediaRef) != ""
	if persona, ok := platformAIPersonaForMode(p.AssistantMode); ok && !hasInitialContent && !reusedConversation {
		intro := Message{
			ID: newID("msg_"), ConversationID: conv.ID, DialogID: conv.ID,
			SenderID: persona.AccountID, SenderSnapshot: aiIdentitySnapshot(persona),
			MessageType: "TEXT", Kind: "text", Body: persona.WelcomeMessage,
			CreatedAt: s.clock.Now().UTC(), Protection: DefaultProtectionFor("TEXT", conv.Type),
			Delivery: &MessageDelivery{State: "sent"}, Seq: 1,
		}
		intro.SecurityV1 = protectionToSecurityV1(intro.Protection)
		if err := s.repository.AppendMessage(ctx, intro); err == nil {
			payload["aiMessage"] = intro
			payload["assistantStatus"] = "RESPONDED"
		}
	} else if hasInitialContent {
		temporaryUI := temporaryUIFor(p.FirstMessage)
		if temporaryUI != nil {
			payload["temporaryUI"] = temporaryUI
		}
		payload["assistantStatus"] = "NOT_REQUESTED"
		var aiReply *Message
		if temporaryUI != nil {
			aiReply = s.serverGuidedReply(ctx, conv, temporaryUI)
		} else if s.modelStack != nil && s.modelStack.Available() {
			aiReply = s.generateAIReply(ctx, conv, e, p.FirstMessage, p.AssistantMode, nil)
		}
		if aiReply != nil {
			domainEvents = append(domainEvents, event.New("AIReplySent", "Conversation", conv.ID, 1, "SYSTEM", e.CorrelationID, e.CommandID, aiReply.CreatedAt, map[string]any{
				"messageId": aiReply.ID,
				"note":      "Proxy 生成首条对话引导",
			}))
			payload["aiMessage"] = aiReply
			payload["assistantStatus"] = "RESPONDED"
		} else if s.modelStack == nil || !s.modelStack.Available() {
			payload["assistantStatus"] = "UNAVAILABLE"
		} else {
			payload["assistantStatus"] = "FAILED"
		}
	}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, payload, domainEvents)
}

func (s *Service) latestDirectConversation(ctx context.Context, actorID, counterpartyID string) (Conversation, bool) {
	conversations, err := s.repository.Snapshot(ctx)
	if err != nil {
		return Conversation{}, false
	}
	var latest Conversation
	found := false
	for _, conv := range conversations {
		if conv.Type == "DM" && conv.State == "ACTIVE" && isParticipant(conv, actorID) && isParticipant(conv, counterpartyID) {
			if !found || conv.LastMessageAt.After(latest.LastMessageAt) {
				latest = conv
				found = true
			}
		}
	}
	return latest, found
}

// ---------- SendMessage ----------
// Gate K：实时 IM 最小；ordinary chat 不修改 Need/Order。

type sendMessagePayload struct {
	MessageType           string `json:"messageType"`
	Body                  string `json:"body"`
	MediaRef              string `json:"mediaRef"`
	AssistantMode         string `json:"assistantMode"`
	TemporaryUIResponseID string `json:"temporaryUIResponseId"`
	// ProtectionOverride is the user-controlled layer on top of the
	// per-type default (see message_protection.go). All fields are
	// optional; only set fields override.
	ProtectionOverride *ProtectionOverride `json:"protectionOverride,omitempty"`
	ProxyObject        *ProxyObjectRef     `json:"proxyObject,omitempty"` // v1
}

func (s *Service) sendMessage(ctx context.Context, e command.Envelope) command.Result {
	var p sendMessagePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_message", nil)
	}
	if p.MessageType == "" {
		p.MessageType = "TEXT"
	}
	validTypes := map[string]bool{"TEXT": true, "IMAGE": true, "VIDEO": true, "AUDIO": true, "LOCATION": true, "SYSTEM_CONTEXT": true, "STRUCTURED_SUGGESTION": true}
	if !validTypes[p.MessageType] {
		return command.Rejected(e, "INVALID_MESSAGE_TYPE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_message_type", map[string]any{"messageType": p.MessageType})
	}
	// 文本消息 Body 不能为空；图片消息允许空文本但必须带 MediaRef（上层已对纯图补 " " 占位）
	if p.MessageType == "TEXT" && strings.TrimSpace(p.Body) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", nil)
	}
	if p.MessageType == "IMAGE" && strings.TrimSpace(p.Body) == "" && strings.TrimSpace(p.MediaRef) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", nil)
	}
	if p.MessageType == "VIDEO" && strings.TrimSpace(p.MediaRef) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", map[string]any{"messageType": p.MessageType})
	}
	if p.MessageType == "AUDIO" && strings.TrimSpace(p.MediaRef) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", map[string]any{"messageType": p.MessageType})
	}
	if p.MessageType == "LOCATION" && strings.TrimSpace(p.Body) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", map[string]any{"messageType": p.MessageType})
	}
	// 兼容：前端对纯图用 " " 占位，这里归一为空以便历史拼接
	if p.MessageType == "IMAGE" && strings.TrimSpace(p.Body) == "" {
		p.Body = ""
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
	if conv.State == "BLOCKED" {
		return command.Rejected(e, "CONVERSATION_BLOCKED", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.blocked", nil)
	}

	// Apply per-type protection defaults, then the user override.
	base := DefaultProtectionFor(p.MessageType, conv.Type)
	var protection MessageProtection
	if p.ProtectionOverride != nil {
		protection, err = Apply(base, *p.ProtectionOverride, s.clock.Now().UTC())
		if err != nil {
			return command.Rejected(e, "INVALID_PROTECTION", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_protection", map[string]any{"reason": err.Error()})
		}
	} else {
		protection = base
	}

	existing, _ := s.repository.Messages(ctx, conv.ID)
	kind := messageTypeToKind(p.MessageType)
	if p.ProxyObject != nil {
		kind = "proxy_object"
	}
	msg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		DialogID:       conv.ID,
		SenderID:       e.Actor.ID,
		MessageType:    p.MessageType,
		Kind:           kind,
		Body:           p.Body,
		MediaRef:       p.MediaRef,
		ProxyObject:    p.ProxyObject,
		CreatedAt:      s.clock.Now().UTC(),
		Protection:     protection,
		SecurityV1:     protectionToSecurityV1(protection),
		Delivery:       &MessageDelivery{State: "sent"},
		Seq:            int64(len(existing) + 1),
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

	// --- AI 回复：模型底座对话式需求构建助手 ---
	var temporaryUI *TemporaryUI
	if p.TemporaryUIResponseID == "" {
		temporaryUI = temporaryUIFor(p.Body)
	}
	var aiReply *Message
	hasContent := strings.TrimSpace(p.Body) != "" || strings.TrimSpace(p.MediaRef) != ""
	if p.TemporaryUIResponseID == "" && temporaryUI != nil && hasContent {
		aiReply = s.serverGuidedReply(ctx, conv, temporaryUI)
	} else if p.TemporaryUIResponseID != "" {
		aiReply = s.serverFormResponseReply(ctx, conv)
	} else if s.modelStack != nil && s.modelStack.Available() && hasContent {
		aiReply = s.generateAIReply(ctx, conv, e, p.Body, p.AssistantMode, nil)
		if aiReply != nil {
			domainEvents = append(domainEvents, event.New("AIReplySent", "Conversation", conv.ID, 1, "SYSTEM", e.CorrelationID, e.CommandID, aiReply.CreatedAt, map[string]any{
				"messageId": aiReply.ID,
				"model":     aiReply.Body[:min(40, len(aiReply.Body))],
				"note":      "AI 通过模型底座生成对话式需求构建回复",
			}))
		}
	}

	payload := map[string]any{
		"messageId":       msg.ID,
		"assistantStatus": "NOT_REQUESTED",
	}
	if temporaryUI != nil {
		payload["temporaryUI"] = temporaryUI
	}
	if aiReply != nil {
		payload["aiMessage"] = aiReply
		payload["assistantStatus"] = "RESPONDED"
	} else if hasContent {
		if s.modelStack != nil && s.modelStack.Available() {
			payload["assistantStatus"] = "FAILED"
		} else {
			payload["assistantStatus"] = "UNAVAILABLE"
		}
	}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, payload, domainEvents)
}

func (s *Service) serverGuidedReply(ctx context.Context, conv Conversation, ui *TemporaryUI) *Message {
	if ui == nil {
		return nil
	}
	body := "请在下方简短点选或填写，我会据此继续帮你处理。"
	switch ui.ID {
	case "translation_brief.v1":
		body = "可以。请在下方简短点选或填写翻译需求，我会据此继续帮你处理。"
	case "relationship_introduction_brief.v1":
		body = "可以协助发起交友介绍：后续只会在自愿开启介绍、由本人选择公开恋爱或婚姻状态的成年女性中筛选；这不是交易或临时伴侣。请在下方简短补充。"
	}
	aiMsg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		SenderID:       "proxy_ai",
		MessageType:    "SYSTEM_CONTEXT",
		Body:           body,
		CreatedAt:      s.clock.Now().UTC(),
	}
	if err := s.repository.AppendMessage(ctx, aiMsg); err != nil {
		log.Printf("conversation ai: failed to store server guided reply: %v", err)
		return nil
	}
	return &aiMsg
}

func (s *Service) serverFormResponseReply(ctx context.Context, conv Conversation) *Message {
	aiMsg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		SenderID:       "proxy_ai",
		MessageType:    "SYSTEM_CONTEXT",
		Body:           "已收到你的补充，我会按这些条件继续处理；如需调整，直接告诉我即可。",
		CreatedAt:      s.clock.Now().UTC(),
	}
	if err := s.repository.AppendMessage(ctx, aiMsg); err != nil {
		log.Printf("conversation ai: failed to store server form response: %v", err)
		return nil
	}
	return &aiMsg
}

// generateAIReply 调用模型底座生成 AI 回复。fail-closed：任何错误静默跳过，不阻塞用户消息。
// 多模态：若历史或当前消息含图片，则尝试以 vision 任务路由，底座会将其转给支持图像的模型。
func (s *Service) generateAIReply(ctx context.Context, conv Conversation, e command.Envelope, userText string, assistantMode string, temporaryUI *TemporaryUI) *Message {
	// 1. 构建对话历史（最近 20 条）
	history, err := s.repository.Messages(ctx, conv.ID)
	if err != nil {
		log.Printf("conversation ai: failed to load history: %v", err)
		return nil
	}
	systemPrompt := "你是 Proxy，一个智能需求构建助手。用户会描述他们想在河内完成的事情，你帮助他们理清需求、补充细节（时间、地点、预算、人数等），并最终生成一个结构化的需求摘要。回复简洁、友好、像朋友聊天。如果用户已经提供了足够信息，给出一个简洁的需求摘要供确认。不要要求用户按 1、2、3、4 编号逐项回复；当服务器提供了临时表单时，用一句自然引导让用户点选或简短填写。对于恋爱或交友请求，可以协助推荐自愿开启介绍、且自行选择公开资料范围的成年用户；这只是社交介绍，不是人员交易、临时伴侣或任何有偿/性服务，也不能承诺匹配结果。"
	persona, isPlatformPersona := platformAIPersonaForMode(assistantMode)
	if isPlatformPersona {
		systemPrompt = "你是 AI 虚拟女孩「" + persona.DisplayName + "」，拥有独立公开账户。你的类型是「" + persona.Role + "」，性格是：「" + persona.Personality + "」。个人简介是：「" + persona.Description + "」。请始终以这个名字和稳定人格自然聊天，像一个有鲜明性格的年轻女孩，有来有往、口语化、简短，不要客服腔、说明书腔或动不动列建议清单。你只做聊天陪伴、兴趣交流和共同创作健康 UGC。你的账户已经配置主页照片资产；用户要看你的照片时，不要回答『AI 没有照片』，自然告诉对方可以看你当前的主页照片，客户端会随回复附上照片。只在身份或能力相关时简洁说明自己是 AI 虚拟女孩；不要反复强调 AI。你没有现实身体、所在地或线下行动能力，不得假装真人或编造现实经历，也不得诱导情感依赖。你不是平台业务助手，不处理需求、接单、报名、活动发布、订单、支付或交易确认。"
	}
	if assistantMode != "" && !isPlatformPersona {
		systemPrompt += " 当前 Home 语义方向是「" + assistantMode + "」，它只是帮助你理解意图，不代表已经选择页面或创建业务事实。"
	}
	if temporaryUI != nil {
		systemPrompt += " 当前服务器已附带「" + temporaryUI.Title + "」短表单。不要重复列出字段、不要编号追问，只需简短说明用户可直接点选或填写后继续。"
	}
	// 取最近 20 条构建上下文
	start := 0
	if len(history) > 20 {
		start = len(history) - 20
	}
	hasImageInHistory := false
	for _, m := range history[start:] {
		if m.MessageType == "IMAGE" && strings.TrimSpace(m.MediaRef) != "" {
			hasImageInHistory = true
			break
		}
	}
	if hasImageInHistory {
		systemPrompt += " 对话中包含图片附件，请结合图片内容理解用户需求；若图片无法读取则说明并请用户文字补充。"
	}
	messages := []modelstack.ChatMessage{{Role: "system", Content: systemPrompt}}
	for _, m := range history[start:] {
		if m.DeletedAt != nil {
			continue
		}
		body := strings.TrimSpace(m.Body)
		// 跳过完全空的 TEXT（IMAGE 允许空文本但需带图）
		if body == "" && m.MessageType == "TEXT" {
			continue
		}
		role := "assistant"
		if m.SenderID == e.Actor.ID {
			role = "user"
		}
		if m.MessageType == "IMAGE" && strings.TrimSpace(m.MediaRef) != "" {
			if dataURI := s.imageDataURI(m.MediaRef); dataURI != "" {
				parts := []modelstack.ContentPart{}
				if body != "" {
					parts = append(parts, modelstack.ContentPart{Type: "text", Text: body})
				} else {
					parts = append(parts, modelstack.ContentPart{Type: "text", Text: "请结合这张图片理解我的需求。"})
				}
				parts = append(parts, modelstack.ContentPart{Type: "image_url", ImageURL: &modelstack.ImageURL{URL: dataURI}})
				messages = append(messages, modelstack.ChatMessage{Role: role, Parts: parts})
				hasImageInHistory = true
				continue
			}
			// 图片读取失败则退化为文本占位
			if body == "" {
				body = "[图片附件，未能读取]"
			} else {
				body = body + " [含图片附件]"
			}
		}
		if body == "" {
			continue
		}
		messages = append(messages, modelstack.ChatMessage{Role: role, Content: body})
	}

	// 2. 调用模型底座：有图用 vision 任务，无图用文本任务
	taskID := "proxy.conversation.demand_assist"
	if hasImageInHistory {
		taskID = "proxy.conversation.vision_assist"
	}
	completion, err := s.modelStack.Complete(ctx, taskID, messages)
	// vision 任务未注册时回退到文本任务（不假装识图，但保证对话可用）
	if err != nil && hasImageInHistory {
		log.Printf("conversation ai: vision task %s failed (%v), fallback to demand_assist", taskID, err)
		taskID = "proxy.conversation.demand_assist"
		// 退化：把多模态消息压回纯文本（去图）
		fallback := make([]modelstack.ChatMessage, 0, len(messages))
		for _, m := range messages {
			if len(m.Parts) > 0 {
				fallback = append(fallback, modelstack.ChatMessage{Role: m.Role, Content: m.Content})
			} else {
				fallback = append(fallback, m)
			}
		}
		messages = fallback
		completion, err = s.modelStack.Complete(ctx, taskID, messages)
	}
	if err != nil {
		log.Printf("conversation ai: modelstack complete failed: %v", err)
		return nil
	}
	log.Printf("conversation ai: model=%s provider=%s tokens=%d/%d", completion.Model, completion.Provider, completion.PromptTokens, completion.OutputTokens)

	// 3. 存储 AI 回复消息
	aiMsg := Message{
		ID:             newID("msg_"),
		ConversationID: conv.ID,
		SenderID:       "proxy_ai",
		MessageType:    "TEXT",
		Body:           completion.Content,
		CreatedAt:      s.clock.Now().UTC(),
	}
	if isPlatformPersona {
		aiMsg.SenderID = persona.AccountID
		aiMsg.SenderSnapshot = aiIdentitySnapshot(persona)
	}
	if err := s.repository.AppendMessage(ctx, aiMsg); err != nil {
		log.Printf("conversation ai: failed to store reply: %v", err)
		return nil
	}
	return &aiMsg
}

func platformAIPersonaForMode(mode string) (aipersona.PlatformAccount, bool) {
	const prefix = "AI_PERSONA:"
	if !strings.HasPrefix(mode, prefix) {
		return aipersona.PlatformAccount{}, false
	}
	account, err := aipersona.GetPlatformAccount(strings.TrimPrefix(mode, prefix))
	if err != nil || account.PersonaType != aipersona.PersonaTypePlatformAI || account.Status != "ACTIVE" {
		return aipersona.PlatformAccount{}, false
	}
	return account, true
}

func aiIdentitySnapshot(account aipersona.PlatformAccount) *IdentitySnapshot {
	avatar := account.AvatarPath
	return &IdentitySnapshot{DisplayName: account.DisplayName + " · AI", AvatarRef: &avatar, Username: &account.Handle}
}

// imageDataURI 尝试从本地 media_store 读取图片并转 data URI。
// MediaRef 约定为 storageKey（如 mobile_media_image_xxx.jpg），兼容旧 assetId 兜底。
func (s *Service) imageDataURI(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	assetID := ""
	originalRef := ref
	if strings.HasPrefix(ref, "asset:") {
		parts := strings.SplitN(ref, ":", 3)
		if len(parts) == 3 {
			assetID = strings.TrimSpace(parts[1])
			originalRef = strings.TrimSpace(parts[2])
			ref = originalRef
		}
	}
	// 防目录穿越
	if strings.Contains(ref, "..") || strings.ContainsAny(ref, "/\\") && filepath.Base(ref) != ref && !strings.HasPrefix(ref, "mobile_media_") {
		// storageKey 本身不含路径，仅文件名；若含 / 则拒绝
		if strings.Contains(ref, "/") || strings.Contains(ref, "\\") {
			return ""
		}
	}
	storeDir := s.mediaStoreDir
	candidates := []string{}
	if assetID != "" && !strings.ContainsAny(assetID, "/\\") && !strings.Contains(assetID, "..") {
		// Vision does not need the full camera original. Prefer the processed
		// natural-aspect derivative to cut base64 size and model latency.
		if storeDir != "" {
			candidates = append(candidates,
				filepath.Join(storeDir, "mv_"+assetID+"_feed_1x_v2.jpg"),
				filepath.Join(storeDir, "mv_"+assetID+"_feed_1x_v1.jpg"),
			)
		}
	}
	if storeDir != "" {
		candidates = append(candidates, filepath.Join(storeDir, ref))
	}
	var data []byte
	var err error
	for _, p := range candidates {
		data, err = os.ReadFile(p)
		if err == nil {
			mime := guessImageMime(ref)
			b64 := base64.StdEncoding.EncodeToString(data)
			// 限 6MB 原图，超限则拒绝（网关 8MB 限制）
			if len(b64) > 8<<20 {
				log.Printf("conversation ai: image too large %s (%d bytes)", ref, len(data))
				return ""
			}
			return fmt.Sprintf("data:%s;base64,%s", mime, b64)
		}
	}
	// 兼容：ref 可能是 assetId，限定在唯一 store root 内按前缀查找。
	if entries, rerr := os.ReadDir(storeDir); storeDir != "" && rerr == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ref) || strings.HasPrefix(ref, e.Name()) {
				if d, err2 := os.ReadFile(filepath.Join(storeDir, e.Name())); err2 == nil {
					mime := guessImageMime(e.Name())
					return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(d))
				}
			}
		}
	}
	return ""
}

func guessImageMime(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".heic"), strings.HasSuffix(lower, ".heif"):
		return "image/heic"
	case strings.HasSuffix(lower, ".webp"):
		return "image/webp"
	default:
		return "image/jpeg"
	}
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
	// Filter out TTL-expired and view-limit-consumed messages for the
	// recipient. Sender still sees their own messages so the chat
	// history looks complete on the sender's device.
	now := s.clock.Now().UTC()
	visible := make([]Message, 0, len(messages))
	for _, m := range messages {
		if m.DeletedAt != nil {
			continue
		}
		if m.SenderID == e.Actor.ID {
			visible = append(visible, m)
			continue
		}
		if m.Protection.ViewLimitExceeded() {
			continue
		}
		if m.Protection.IsExpiredAt(now) {
			continue
		}
		visible = append(visible, m)
	}
	// Perf guard: cap history payloads. Clients render full lists into
	// memory (ScrollView), so an unbounded conversation would degrade
	// both serialization and the device. The flag lets future clients
	// offer "view earlier messages" instead of silently showing all.
	const maxHistoryMessages = 200
	truncated := false
	if len(visible) > maxHistoryMessages {
		visible = visible[len(visible)-maxHistoryMessages:]
		truncated = true
	}
	return acceptedWithPayload(e, "Conversation", e.Target.ID, 1, conv.State, map[string]any{
		"messages":  visible,
		"actorId":   e.Actor.ID,
		"truncated": truncated,
	}, nil)
}

func (s *Service) deleteMessage(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		MessageID string `json:"messageId"`
	}
	if !decode(e.Payload, &p) || p.MessageID == "" {
		return command.Rejected(e, "INVALID_MESSAGE_DELETE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_delete", nil)
	}
	msg, err := s.repository.GetMessage(ctx, p.MessageID)
	if err != nil {
		return command.Rejected(e, "MESSAGE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.message_not_found", nil)
	}
	if msg.SenderID != e.Actor.ID {
		return command.Rejected(e, "MESSAGE_DELETE_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.delete_not_allowed", nil)
	}
	now := s.clock.Now().UTC()
	msg.DeletedAt = &now
	msg.Body = ""
	msg.MediaRef = ""
	if err := s.repository.UpdateMessage(ctx, msg); err != nil {
		return command.Rejected(e, "MESSAGE_DELETE_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.delete_failed", nil)
	}
	return acceptedWithPayload(e, "Message", msg.ID, 1, "DELETED", map[string]any{"messageId": msg.ID}, nil)
}

func (s *Service) setConversationBlocked(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Blocked bool `json:"blocked"`
	}
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_BLOCK_STATE", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_block", nil)
	}
	conv, err := s.repository.GetConversation(ctx, e.Target.ID)
	if err != nil || !isParticipant(conv, e.Actor.ID) {
		return command.Rejected(e, "CONVERSATION_BLOCK_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.block_not_allowed", nil)
	}
	if p.Blocked {
		conv.State = "BLOCKED"
	} else {
		conv.State = "ACTIVE"
	}
	if err := s.repository.UpdateConversation(ctx, conv); err != nil {
		return command.Rejected(e, "CONVERSATION_BLOCK_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.block_failed", nil)
	}
	return acceptedWithPayload(e, "Conversation", conv.ID, 1, conv.State, map[string]any{"blocked": p.Blocked}, nil)
}

// ---------- MarkMessageRead ----------
// Bumps the recipient's view count. Sender's own reads do not count.

type markMessageReadPayload struct {
	MessageID string `json:"messageId"`
}

func (s *Service) markMessageRead(ctx context.Context, e command.Envelope) command.Result {
	var p markMessageReadPayload
	if !decode(e.Payload, &p) || p.MessageID == "" {
		return command.Rejected(e, "INVALID_READ", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_read", nil)
	}
	msg, err := s.repository.GetMessage(ctx, p.MessageID)
	if errors.Is(err, ErrMessageNotFound) {
		return command.Rejected(e, "MESSAGE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.message_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MESSAGE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.message_read_failed", nil)
	}
	conv, err := s.repository.GetConversation(ctx, msg.ConversationID)
	if err != nil {
		return command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil)
	}
	if !isParticipant(conv, e.Actor.ID) {
		return command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil)
	}
	if msg.SenderID == e.Actor.ID {
		return acceptedWithPayload(e, "Message", msg.ID, 1, "READ", map[string]any{
			"messageId": msg.ID,
			"viewCount": msg.Protection.ViewCount,
			"viewLimit": msg.Protection.ViewLimit,
			"consumed":  false,
			"selfRead":  true,
		}, nil)
	}
	if msg.Protection.IsExpiredAt(s.clock.Now().UTC()) {
		return command.Rejected(e, "MESSAGE_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.message_expired", map[string]any{"messageId": msg.ID})
	}
	if msg.Protection.ViewLimitExceeded() {
		return command.Rejected(e, "VIEW_LIMIT_EXCEEDED", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.view_limit_exceeded", map[string]any{"messageId": msg.ID, "viewCount": msg.Protection.ViewCount, "viewLimit": msg.Protection.ViewLimit})
	}
	msg.Protection.ViewCount++
	consumed := msg.Protection.ViewLimitExceeded()
	if err := s.repository.UpdateMessage(ctx, msg); err != nil {
		return command.Rejected(e, "MESSAGE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.message_read_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("MessageRead", "Message", msg.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"messageId": msg.ID,
		"viewerId":  e.Actor.ID,
		"viewCount": msg.Protection.ViewCount,
		"viewLimit": msg.Protection.ViewLimit,
		"consumed":  consumed,
	})}
	return acceptedWithPayload(e, "Message", msg.ID, 1, "READ", map[string]any{
		"messageId": msg.ID,
		"viewCount": msg.Protection.ViewCount,
		"viewLimit": msg.Protection.ViewLimit,
		"consumed":  consumed,
	}, domainEvents)
}

// ---------- RecordScreenshot ----------
// Recipient's device detects a screenshot of a protected message and
// fires this event. The server publishes a SECURITY_ALERT back to the
// original sender so their app can show "对方在 14:23 截了您发的消息".

type recordScreenshotPayload struct {
	MessageID string `json:"messageId"`
}

func (s *Service) recordScreenshot(ctx context.Context, e command.Envelope) command.Result {
	var p recordScreenshotPayload
	if !decode(e.Payload, &p) || p.MessageID == "" {
		return command.Rejected(e, "INVALID_SCREENSHOT_EVENT", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_screenshot", nil)
	}
	msg, err := s.repository.GetMessage(ctx, p.MessageID)
	if errors.Is(err, ErrMessageNotFound) {
		return command.Rejected(e, "MESSAGE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.message_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MESSAGE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.message_read_failed", nil)
	}
	conv, err := s.repository.GetConversation(ctx, msg.ConversationID)
	if err != nil {
		return command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil)
	}
	if !isParticipant(conv, e.Actor.ID) {
		return command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil)
	}
	if msg.SenderID == e.Actor.ID {
		return command.Rejected(e, "SELF_SCREENSHOT", "VALIDATION", "AFTER_USER_ACTION", "conversation.self_screenshot", nil)
	}
	if !msg.Protection.ScreenshotWarn {
		return acceptedWithPayload(e, "Message", msg.ID, 1, "SCREENSHOT_IGNORED", map[string]any{
			"messageId": msg.ID,
			"reason":    "protection.screenshotWarn is false",
		}, nil)
	}
	now := s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("ScreenshotDetected", "Message", msg.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"messageId": msg.ID,
		"shooterId": e.Actor.ID,
		"senderId":  msg.SenderID,
	})}
	domainEvents = append(domainEvents, event.New("SecurityAlert", "Message", msg.ID, 1, "SYSTEM", e.CorrelationID, e.CommandID, now, map[string]any{
		"messageId": msg.ID,
		"alertType": "SCREENSHOT_DETECTED",
		"targetId":  msg.SenderID,
		"triggerId": e.Actor.ID,
	}))
	return acceptedWithPayload(e, "Message", msg.ID, 1, "SCREENSHOT_RECORDED", map[string]any{
		"messageId": msg.ID,
	}, domainEvents)
}

// ---------- ForwardMessage ----------
// "Forward" means: re-send the same content to a different conversation.
// We refuse this when the source message's protection disallows it. The
// actual re-send is a normal SendMessage against the target conversation;
// this command only validates the source and audits the forward.

type forwardMessagePayload struct {
	SourceMessageID      string `json:"sourceMessageId"`
	TargetConversationID string `json:"targetConversationId"`
}

func (s *Service) forwardMessage(ctx context.Context, e command.Envelope) command.Result {
	var p forwardMessagePayload
	if !decode(e.Payload, &p) || p.SourceMessageID == "" || p.TargetConversationID == "" {
		return command.Rejected(e, "INVALID_FORWARD", "VALIDATION", "AFTER_USER_ACTION", "conversation.invalid_forward", nil)
	}
	src, err := s.repository.GetMessage(ctx, p.SourceMessageID)
	if errors.Is(err, ErrMessageNotFound) {
		return command.Rejected(e, "MESSAGE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.message_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MESSAGE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.message_read_failed", nil)
	}
	srcConv, err := s.repository.GetConversation(ctx, src.ConversationID)
	if err != nil {
		return command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil)
	}
	if !isParticipant(srcConv, e.Actor.ID) {
		return command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil)
	}
	dstConv, err := s.repository.GetConversation(ctx, p.TargetConversationID)
	if errors.Is(err, ErrConversationNotFound) {
		return command.Rejected(e, "CONVERSATION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONVERSATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "conversation.read_failed", nil)
	}
	if !isParticipant(dstConv, e.Actor.ID) {
		return command.Rejected(e, "NOT_CONVERSATION_PARTICIPANT", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.not_participant", nil)
	}
	if !src.Protection.Forwardable {
		return command.Rejected(e, "PROTECTION_VIOLATION", "AUTHORIZATION", "AFTER_USER_ACTION", "conversation.forward_blocked", map[string]any{
			"messageId": src.ID,
			"reason":    "protection.forwardable is false",
		})
	}
	if src.Protection.IsExpiredAt(s.clock.Now().UTC()) {
		return command.Rejected(e, "MESSAGE_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "conversation.message_expired", map[string]any{"messageId": src.ID})
	}
	domainEvents := []event.DomainEvent{event.New("MessageForwarded", "Message", src.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"sourceMessageId":      src.ID,
		"sourceConversationId": src.ConversationID,
		"targetConversationId": p.TargetConversationID,
		"forwarderId":          e.Actor.ID,
	})}
	return acceptedWithPayload(e, "Message", src.ID, 1, "FORWARD_OK", map[string]any{
		"sourceMessageId":      src.ID,
		"targetConversationId": p.TargetConversationID,
	}, domainEvents)
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

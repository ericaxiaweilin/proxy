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
	modelStack modelstack.Port
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}, modelStack: modelstack.Unconfigured{}}
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
	if p.MediaRef != "" {
		_ = s.repository.AppendMessage(ctx, Message{
			ID: newID("msg_"), ConversationID: conv.ID, SenderID: e.Actor.ID,
			MessageType: "IMAGE", MediaRef: p.MediaRef, CreatedAt: s.clock.Now().UTC(),
		})
	}
	payload := map[string]any{
		"conversationId": conv.ID,
		"originType":     conv.OriginType,
		"originId":       conv.OriginID,
	}
	hasInitialContent := strings.TrimSpace(p.FirstMessage) != "" || strings.TrimSpace(p.MediaRef) != ""
	if hasInitialContent {
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

// ---------- SendMessage ----------
// Gate K：实时 IM 最小；ordinary chat 不修改 Need/Order。

type sendMessagePayload struct {
	MessageType           string `json:"messageType"`
	Body                  string `json:"body"`
	MediaRef              string `json:"mediaRef"`
	AssistantMode         string `json:"assistantMode"`
	TemporaryUIResponseID string `json:"temporaryUIResponseId"`
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
	// 文本消息 Body 不能为空；图片消息允许空文本但必须带 MediaRef（上层已对纯图补 " " 占位）
	if p.MessageType == "TEXT" && strings.TrimSpace(p.Body) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", nil)
	}
	if p.MessageType == "IMAGE" && strings.TrimSpace(p.Body) == "" && strings.TrimSpace(p.MediaRef) == "" {
		return command.Rejected(e, "EMPTY_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "conversation.empty_message", nil)
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
	if assistantMode != "" {
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
	if err := s.repository.AppendMessage(ctx, aiMsg); err != nil {
		log.Printf("conversation ai: failed to store reply: %v", err)
		return nil
	}
	return &aiMsg
}

// imageDataURI 尝试从本地 media_store 读取图片并转 data URI。
// MediaRef 约定为 storageKey（如 mobile_media_image_xxx.jpg），兼容旧 assetId 兜底。
func (s *Service) imageDataURI(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	// 防目录穿越
	if strings.Contains(ref, "..") || strings.ContainsAny(ref, "/\\") && filepath.Base(ref) != ref && !strings.HasPrefix(ref, "mobile_media_") {
		// storageKey 本身不含路径，仅文件名；若含 / 则拒绝
		if strings.Contains(ref, "/") || strings.Contains(ref, "\\") {
			return ""
		}
	}
	candidates := []string{
		filepath.Join("media_store", ref),
		filepath.Join("apps", "api-go", "media_store", ref),
		filepath.Join(".", "media_store", ref),
		filepath.Join(os.TempDir(), ref),
		ref,
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
	// 兼容：ref 可能是 assetId，尝试按 media_store 中同前缀文件查找（开发环境）
	if entries, rerr := os.ReadDir("media_store"); rerr == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ref) || strings.HasPrefix(ref, e.Name()) {
				if d, err2 := os.ReadFile(filepath.Join("media_store", e.Name())); err2 == nil {
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

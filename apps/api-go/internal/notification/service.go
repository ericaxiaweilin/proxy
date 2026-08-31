package notification

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type DeviceToken struct {
	ID            string    `json:"id"`
	UserAccountID string    `json:"userAccountId"`
	DeviceID      string    `json:"deviceId"`
	Platform      string    `json:"platform"`
	Token         string    `json:"token"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type InboxItem struct {
	ID          string    `json:"id"`
	RecipientID string    `json:"recipientId"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	DeepLink    string    `json:"deepLink,omitempty"`
	Read        bool      `json:"read"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Repository interface {
	UpsertDeviceToken(ctx context.Context, t DeviceToken) error
	GetDeviceToken(ctx context.Context, userAccountID, deviceID string) (DeviceToken, error)
	CreateInboxItem(ctx context.Context, item InboxItem) error
	ListInbox(ctx context.Context, recipientID string, unreadOnly bool) ([]InboxItem, error)
	MarkRead(ctx context.Context, itemID, recipientID string) error
}

type MemoryRepository struct {
	mu      sync.Mutex
	devices map[string]DeviceToken
	inbox   map[string]InboxItem
	events  []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{devices: make(map[string]DeviceToken), inbox: make(map[string]InboxItem)}
}
func (r *MemoryRepository) UpsertDeviceToken(_ context.Context, t DeviceToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.devices[t.UserAccountID+"|"+t.DeviceID] = t
	return nil
}
func (r *MemoryRepository) GetDeviceToken(_ context.Context, userAccountID, deviceID string) (DeviceToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.devices[userAccountID+"|"+deviceID]
	if !ok {
		return DeviceToken{}, errors.New("device not found")
	}
	return t, nil
}
func (r *MemoryRepository) CreateInboxItem(_ context.Context, item InboxItem) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.inbox[item.ID] = item
	return nil
}
func (r *MemoryRepository) ListInbox(_ context.Context, recipientID string, unreadOnly bool) ([]InboxItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []InboxItem{}
	for _, item := range r.inbox {
		if item.RecipientID == recipientID {
			if unreadOnly && item.Read {
				continue
			}
			result = append(result, item)
		}
	}
	return result, nil
}
func (r *MemoryRepository) MarkRead(_ context.Context, itemID, recipientID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.inbox[itemID]
	if !ok || item.RecipientID != recipientID {
		return errors.New("inbox not found")
	}
	item.Read = true
	r.inbox[itemID] = item
	return nil
}

type PushProvider interface {
	Push(ctx context.Context, item InboxItem) error
}

type LogPushProvider struct{}

func (LogPushProvider) Push(_ context.Context, item InboxItem) error {
	log.Printf("notification push: recipient=%s type=%s title=%q deepLink=%q", item.RecipientID, item.Type, item.Title, item.DeepLink)
	return nil
}

type Service struct {
	mu   sync.Mutex
	repo Repository
	push PushProvider
	clock clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }
func NewWithRepository(repo Repository) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	return &Service{repo: repo, push: LogPushProvider{}, clock: clock.System{}}
}

func NewWithPushProvider(repo Repository, push PushProvider) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	if push == nil {
		push = LogPushProvider{}
	}
	return &Service{repo: repo, push: push, clock: clock.System{}}
}
func (s *Service) Supports(t string) bool {
	switch t {
	case "RegisterDeviceToken", "SendInboxNotification", "ListInbox", "MarkInboxRead", "ResolveDeepLink":
		return true
	}
	return false
}
func (s *Service) Handle(e command.Envelope) command.Result { return s.HandleContext(context.Background(), e) }
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "RegisterDeviceToken":
		return s.registerDevice(ctx, e)
	case "SendInboxNotification":
		return s.sendInbox(ctx, e)
	case "ListInbox":
		return s.listInbox(ctx, e)
	case "MarkInboxRead":
		return s.markRead(ctx, e)
	case "ResolveDeepLink":
		return s.resolveDeepLink(ctx, e)
	default:
		return command.Rejected(e, "NOTIF_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "notif.unsupported", nil)
	}
}

func (s *Service) registerDevice(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		DeviceID string `json:"deviceId"`
		Platform string `json:"platform"`
		Token    string `json:"token"`
	}
	if !decode(e.Payload, &p) || p.DeviceID == "" || p.Token == "" {
		return command.Rejected(e, "INVALID_DEVICE", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_device", nil)
	}
	if p.Platform == "" {
		p.Platform = "IOS"
	}
	now := s.clock.Now().UTC()
	token := DeviceToken{ID: newID("dt_"), UserAccountID: e.Actor.ID, DeviceID: p.DeviceID, Platform: p.Platform, Token: p.Token, Status: "ACTIVE", CreatedAt: now, UpdatedAt: now}
	_ = s.repo.UpsertDeviceToken(ctx, token)
	ev := event.New("DeviceTokenRegistered", "DeviceToken", token.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"deviceId": p.DeviceID})
	return command.Accepted(e, "DeviceToken", token.ID, 1, token.Status, []string{ev.EventID})
}

func (s *Service) sendInbox(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		RecipientID string `json:"recipientId"`
		Type        string `json:"type"`
		Title       string `json:"title"`
		Body        string `json:"body"`
		DeepLink    string `json:"deepLink"`
	}
	if !decode(e.Payload, &p) || p.RecipientID == "" || p.Title == "" {
		return command.Rejected(e, "INVALID_INBOX", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_inbox", nil)
	}
	// Deep link must be opaque, not leak D4/D5
	if len(p.DeepLink) > 512 {
		return command.Rejected(e, "INVALID_DEEPLINK", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_deeplink", nil)
	}
	now := s.clock.Now().UTC()
	item := InboxItem{ID: newID("inbox_"), RecipientID: p.RecipientID, Type: p.Type, Title: p.Title, Body: p.Body, DeepLink: p.DeepLink, Read: false, CreatedAt: now}
	_ = s.repo.CreateInboxItem(ctx, item)
	// Push lifecycle: best-effort, log only, never fail the inbox write
	if s.push != nil {
		_ = s.push.Push(ctx, item)
	}
	ev := event.New("InboxItemCreated", "InboxItem", item.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"recipientId": p.RecipientID, "type": p.Type})
	return acceptedWithPayload(e, "InboxItem", item.ID, 1, "CREATED", map[string]any{"inboxId": item.ID, "deepLink": item.DeepLink}, []event.DomainEvent{ev})
}

func (s *Service) listInbox(ctx context.Context, e command.Envelope) command.Result {
	recipientID := e.Principal.ID
	items, _ := s.repo.ListInbox(ctx, recipientID, false)
	return acceptedWithPayload(e, "Inbox", recipientID, 1, "LISTED", map[string]any{"items": items}, nil)
}

func (s *Service) markRead(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ InboxID string `json:"inboxId"`}
	if !decode(e.Payload, &p) || p.InboxID == "" {
		p.InboxID = e.Target.ID
		if p.InboxID == "" {
			return command.Rejected(e, "INVALID_MARK_READ", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_mark_read", nil)
		}
	}
	if err := s.repo.MarkRead(ctx, p.InboxID, e.Principal.ID); err != nil {
		return command.Rejected(e, "INBOX_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "notif.inbox_not_found", nil)
	}
	ev := event.New("InboxItemRead", "InboxItem", p.InboxID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), nil)
	return command.Accepted(e, "InboxItem", p.InboxID, 1, "READ", []string{ev.EventID})
}

func (s *Service) resolveDeepLink(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ DeepLink string `json:"deepLink"`}
	if !decode(e.Payload, &p) || p.DeepLink == "" {
		return command.Rejected(e, "INVALID_DEEPLINK", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_deeplink", nil)
	}
	// Check session/principal already validated by API layer; here just verify link format and return allowed
	if len(p.DeepLink) > 512 || p.DeepLink == "" {
		return command.Rejected(e, "INVALID_DEEPLINK", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_deeplink", nil)
	}
	// Simulate permission check: if link contains order/offer, ensure recipient owns it (simplified: allow)
	return acceptedWithPayload(e, "DeepLink", p.DeepLink, 1, "RESOLVED", map[string]any{"deepLink": p.DeepLink, "resolved": true}, nil)
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func newID(prefix string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err == nil {
		return prefix + hex.EncodeToString(b[:])
	}
	return prefix + "fallback"
}
func acceptedWithPayload(e command.Envelope, typ, id string, version int, state string, payload map[string]any, events []event.DomainEvent) command.Result {
	r := command.Accepted(e, typ, id, version, state, eventRefs(events))
	raw, _ := json.Marshal(payload)
	r.OperationRef = string(raw)
	return r
}
func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

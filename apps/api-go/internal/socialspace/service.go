package socialspace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

type Status struct {
	ID                string    `json:"id"`
	AuthorID          string    `json:"authorId"`
	AuthorDisplayName string    `json:"author"`
	Body              string    `json:"body"`
	Location          string    `json:"location,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
	ExpiresAt         time.Time `json:"expiresAt"`
}

type Community struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Desc    string `json:"desc"`
	Members int    `json:"members"`
	Color   string `json:"color"`
	Flair   string `json:"flair,omitempty"`
	Joined  bool   `json:"joined"`
}

type Repository interface {
	CreateStatus(ctx context.Context, status Status) error
	ListActiveStatuses(ctx context.Context, now time.Time) ([]Status, error)
	ListCommunities(ctx context.Context, actorID string) ([]Community, error)
	SetCommunityMembership(ctx context.Context, actorID, communityID string, joined bool, at time.Time) error
}

var ErrCommunityNotFound = errors.New("community not found")

type MemoryRepository struct {
	mu          sync.Mutex
	statuses    map[string]Status
	communities map[string]Community
	memberships map[string]map[string]bool
}

func NewMemoryRepository() *MemoryRepository {
	communities := defaultCommunities()
	byID := make(map[string]Community, len(communities))
	for _, community := range communities {
		byID[community.ID] = community
	}
	return &MemoryRepository{statuses: make(map[string]Status), communities: byID, memberships: make(map[string]map[string]bool)}
}

func (r *MemoryRepository) CreateStatus(_ context.Context, status Status) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.statuses[status.ID]; exists {
		return errors.New("status already exists")
	}
	r.statuses[status.ID] = status
	return nil
}

func (r *MemoryRepository) ListActiveStatuses(_ context.Context, now time.Time) ([]Status, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Status, 0, len(r.statuses))
	for _, status := range r.statuses {
		if status.ExpiresAt.After(now) {
			result = append(result, status)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryRepository) ListCommunities(_ context.Context, actorID string) ([]Community, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Community, 0, len(r.communities))
	for _, community := range r.communities {
		community.Joined = r.memberships[actorID][community.ID]
		result = append(result, community)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (r *MemoryRepository) SetCommunityMembership(_ context.Context, actorID, communityID string, joined bool, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.communities[communityID]; !exists {
		return ErrCommunityNotFound
	}
	if r.memberships[actorID] == nil {
		r.memberships[actorID] = make(map[string]bool)
	}
	r.memberships[actorID][communityID] = joined
	return nil
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	clock      clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func NewWithRepositoryAndClock(repository Repository, domainClock clock.Clock) *Service {
	service := NewWithRepository(repository)
	if domainClock != nil {
		service.clock = domainClock
	}
	return service
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateStatus", "ListStatuses", "ListCommunities", "SetCommunityMembership":
		return true
	default:
		return false
	}
}

func (s *Service) HandleContext(ctx context.Context, envelope command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch envelope.CommandType {
	case "CreateStatus":
		return s.createStatus(ctx, envelope)
	case "ListStatuses":
		return s.listStatuses(ctx, envelope)
	case "ListCommunities":
		return s.listCommunities(ctx, envelope)
	case "SetCommunityMembership":
		return s.setMembership(ctx, envelope)
	default:
		return command.Rejected(envelope, "SOCIAL_SPACE_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "socialspace.unsupported_command", nil)
	}
}

func (s *Service) createStatus(ctx context.Context, envelope command.Envelope) command.Result {
	var payload struct {
		Body              string `json:"body"`
		Location          string `json:"location"`
		ExpiryHours       int    `json:"expiryHours"`
		AuthorDisplayName string `json:"authorDisplayName"`
	}
	if !decode(envelope.Payload, &payload) {
		return rejected(envelope, "INVALID_STATUS", "socialspace.invalid_status")
	}
	payload.Body = strings.TrimSpace(payload.Body)
	if payload.Body == "" || utf8.RuneCountInString(payload.Body) > 140 || (payload.ExpiryHours != 24 && payload.ExpiryHours != 48) {
		return rejected(envelope, "INVALID_STATUS", "socialspace.invalid_status")
	}
	if envelope.Actor.Type != "USER" || envelope.Actor.ID == "" {
		return command.Rejected(envelope, "STATUS_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "socialspace.status_not_allowed", nil)
	}
	now := s.clock.Now().UTC()
	status := Status{ID: newID("status_"), AuthorID: envelope.Actor.ID, AuthorDisplayName: strings.TrimSpace(payload.AuthorDisplayName), Body: payload.Body, Location: strings.TrimSpace(payload.Location), CreatedAt: now, ExpiresAt: now.Add(time.Duration(payload.ExpiryHours) * time.Hour)}
	if status.AuthorDisplayName == "" {
		status.AuthorDisplayName = "你"
	}
	if err := s.repository.CreateStatus(ctx, status); err != nil {
		return command.Rejected(envelope, "STATUS_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "socialspace.status_create_failed", nil)
	}
	return acceptedWithPayload(envelope, "Status", status.ID, "PUBLISHED", map[string]any{"status": status})
}

func (s *Service) listStatuses(ctx context.Context, envelope command.Envelope) command.Result {
	statuses, err := s.repository.ListActiveStatuses(ctx, s.clock.Now().UTC())
	if err != nil {
		return command.Rejected(envelope, "STATUS_READ_FAILED", "INTERNAL", "SAFE_RETRY", "socialspace.status_read_failed", nil)
	}
	return acceptedWithPayload(envelope, "StatusFeed", "local", "READY", map[string]any{"statuses": statuses})
}

func (s *Service) listCommunities(ctx context.Context, envelope command.Envelope) command.Result {
	communities, err := s.repository.ListCommunities(ctx, envelope.Actor.ID)
	if err != nil {
		return command.Rejected(envelope, "COMMUNITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "socialspace.community_read_failed", nil)
	}
	return acceptedWithPayload(envelope, "CommunityHub", "local", "READY", map[string]any{"communities": communities})
}

func (s *Service) setMembership(ctx context.Context, envelope command.Envelope) command.Result {
	var payload struct {
		CommunityID string `json:"communityId"`
		Joined      *bool  `json:"joined"`
	}
	if !decode(envelope.Payload, &payload) || payload.CommunityID == "" || payload.Joined == nil {
		return rejected(envelope, "INVALID_COMMUNITY_MEMBERSHIP", "socialspace.invalid_membership")
	}
	if err := s.repository.SetCommunityMembership(ctx, envelope.Actor.ID, payload.CommunityID, *payload.Joined, s.clock.Now().UTC()); err != nil {
		if errors.Is(err, ErrCommunityNotFound) {
			return rejected(envelope, "COMMUNITY_NOT_FOUND", "socialspace.community_not_found")
		}
		return command.Rejected(envelope, "COMMUNITY_MEMBERSHIP_FAILED", "INTERNAL", "SAFE_RETRY", "socialspace.membership_failed", nil)
	}
	return acceptedWithPayload(envelope, "CommunityMembership", envelope.Actor.ID+"|"+payload.CommunityID, "UPDATED", map[string]any{"communityId": payload.CommunityID, "joined": *payload.Joined})
}

func defaultCommunities() []Community {
	return []Community{
		{ID: "badminton", Name: "羽毛球", Desc: "每周组局 · 新手友好", Members: 94, Color: "#F1F7FF", Flair: "组局"},
		{ID: "chinese", Name: "中文生活", Desc: "中文沟通/本地生活/互助", Members: 218, Color: "#FFF0F6", Flair: "互助"},
		{ID: "coffee", Name: "本地咖啡", Desc: "独立咖啡/烘焙/探店", Members: 289, Color: "#FFF8DF", Flair: "探店"},
		{ID: "photo", Name: "河内摄影", Desc: "西湖/老城区/咖啡店 · 作品与地点", Members: 342, Color: "#F0EAF5", Flair: "活跃"},
		{ID: "startup", Name: "河内创业", Desc: "产品/AI/出海 · 线下碰头", Members: 156, Color: "#EDF9F6", Flair: "创业"},
	}
}

func decode(raw any, target any) bool {
	data, err := json.Marshal(raw)
	return err == nil && json.Unmarshal(data, target) == nil
}

func acceptedWithPayload(envelope command.Envelope, aggregateType, aggregateID, state string, payload any) command.Result {
	result := command.Accepted(envelope, aggregateType, aggregateID, 1, state, nil)
	data, _ := json.Marshal(payload)
	result.OperationRef = string(data)
	return result
}

func rejected(envelope command.Envelope, code, messageKey string) command.Result {
	return command.Rejected(envelope, code, "VALIDATION", "AFTER_USER_ACTION", messageKey, nil)
}

func newID(prefix string) string {
	bytes := make([]byte, 10)
	if _, err := rand.Read(bytes); err != nil {
		return prefix + hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return prefix + hex.EncodeToString(bytes)
}

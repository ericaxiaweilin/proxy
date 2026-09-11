// Package profile 提供服务端个人名片（user profile card）域。
//
// Audit 2026-09-04（原型 gap 修复）：mobile "我的" 页的 profile 编辑
// （name/handle/bio/city/avatar）此前只写本地 Keychain，服务端零持久化。
// 本域提供两个命令：
//   UpsertUserProfile —— 本人保存名片（UPSERT 语义，幂等键在外层信封层）；
//   GetUserProfile    —— 任意主体读名片（后续可加可见性策略）。
//
// 契约基准：apps/mobile/src/profile-store.ts 的 ProfileRecord 字段集。

package profile

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// ErrHandleTaken handle 已被他人占用（内存仓也复用同一哨兵）。
var ErrHandleTaken = errors.New("handle already taken")

// Profile 与 profile.user_profiles 行一一对应（字段校验与 mobile
// profile-store.ts 的 MAX_* 一致）。
type Profile struct {
	UserAccountID string    `json:"userAccountId"`
	Name          string    `json:"name"`
	Handle        string    `json:"handle"`
	Bio           string    `json:"bio"`
	City          string    `json:"city"`
	AvatarURL     string    `json:"avatarUrl"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Repository interface {
	Upsert(ctx context.Context, p Profile) (Profile, error)
	Get(ctx context.Context, userAccountID string) (Profile, error)
	GetByHandle(ctx context.Context, handle string) (Profile, error)
}

// MemoryRepository 无 DATABASE_URL 时的后备仓（smoke 脚本沿用）。
type MemoryRepository struct {
	mu       sync.Mutex
	byUser   map[string]Profile
	byHandle map[string]string
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{byUser: map[string]Profile{}, byHandle: map[string]string{}}
}

var _ Repository = (*MemoryRepository)(nil)

func (r *MemoryRepository) Upsert(_ context.Context, p Profile) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if owner, ok := r.byHandle[p.Handle]; ok && owner != p.UserAccountID {
		return Profile{}, ErrHandleTaken
	}
	existing, ok := r.byUser[p.UserAccountID]
	if ok {
		delete(r.byHandle, existing.Handle)
		p.CreatedAt = existing.CreatedAt
	}
	r.byUser[p.UserAccountID] = p
	r.byHandle[p.Handle] = p.UserAccountID
	return p, nil
}

func (r *MemoryRepository) Get(_ context.Context, userAccountID string) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.byUser[userAccountID]
	if !ok {
		return Profile{}, ErrProfileNotFound
	}
	return p, nil
}

func (r *MemoryRepository) GetByHandle(_ context.Context, handle string) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	owner, ok := r.byHandle[handle]
	if !ok {
		return Profile{}, ErrProfileNotFound
	}
	return r.byUser[owner], nil
}

// ErrProfileNotFound 名片不存在。
var ErrProfileNotFound = errors.New("profile not found")

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
	case "UpsertUserProfile", "GetUserProfile":
		return true
	default:
		return false
	}
}

func (s *Service) HandleContext(ctx context.Context, envelope command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch envelope.CommandType {
	case "UpsertUserProfile":
		return s.upsert(ctx, envelope)
	case "GetUserProfile":
		return s.get(ctx, envelope)
	default:
		return command.Rejected(envelope, "PROFILE_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "profile.unsupported_command", nil)
	}
}

type upsertPayload struct {
	Name      string `json:"name"`
	Handle    string `json:"handle"`
	Bio       string `json:"bio"`
	City      string `json:"city"`
	AvatarURL string `json:"avatarUrl"`
}

func (s *Service) upsert(ctx context.Context, envelope command.Envelope) command.Result {
	var payload upsertPayload
	if !decode(envelope.Payload, &payload) {
		return rejected(envelope, "INVALID_USER_PROFILE", "profile.invalid_profile")
	}
	// 与 mobile profile-store 的 MAX_* 一致
	if envelope.Actor.Type != "USER" || envelope.Actor.ID == "" {
		return command.Rejected(envelope, "PROFILE_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "profile.not_owned", nil)
	}
	p := normalize(payload)
	if p.Name == "" || p.Handle == "" || utf8.RuneCountInString(p.Name) > 60 ||
		utf8.RuneCountInString(p.Handle) > 60 || utf8.RuneCountInString(p.Bio) > 280 ||
		utf8.RuneCountInString(p.City) > 60 || utf8.RuneCountInString(p.AvatarURL) > 4096 {
		return rejected(envelope, "INVALID_USER_PROFILE", "profile.invalid_profile")
	}
	now := s.clock.Now().UTC()
	stored, err := s.repository.Upsert(ctx, Profile{
		UserAccountID: envelope.Actor.ID, Name: p.Name, Handle: p.Handle,
		Bio: p.Bio, City: p.City, AvatarURL: p.AvatarURL,
		CreatedAt: now, UpdatedAt: now,
	})
	if errors.Is(err, ErrHandleTaken) {
		return command.Rejected(envelope, "PROFILE_HANDLE_TAKEN", "BUSINESS_STATE", "AFTER_USER_ACTION", "profile.handle_taken", map[string]any{"handle": p.Handle})
	}
	if err != nil {
		return command.Rejected(envelope, "PROFILE_UPSERT_FAILED", "INTERNAL", "SAFE_RETRY", "profile.upsert_failed", nil)
	}
	return acceptedWithPayload(envelope, "UserProfile", stored.UserAccountID, "SAVED", map[string]any{"profile": stored})
}

func (s *Service) get(ctx context.Context, envelope command.Envelope) command.Result {
	var payload struct {
		UserAccountID string `json:"userAccountId"`
		Handle        string `json:"handle"`
	}
	if !decode(envelope.Payload, &payload) || (payload.UserAccountID == "" && payload.Handle == "") {
		return rejected(envelope, "INVALID_PROFILE_LOOKUP", "profile.invalid_lookup")
	}
	var (
		stored Profile
		err    error
	)
	if payload.UserAccountID != "" {
		stored, err = s.repository.Get(ctx, payload.UserAccountID)
	} else {
		stored, err = s.repository.GetByHandle(ctx, strings.TrimPrefix(payload.Handle, "@"))
	}
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(envelope, "USER_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "profile.not_found", nil)
	}
	if err != nil {
		return command.Rejected(envelope, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "profile.read_failed", nil)
	}
	return acceptedWithPayload(envelope, "UserProfile", stored.UserAccountID, "READY", map[string]any{"profile": stored})
}

// normalize 去空白 + 剥 handle 的 @ 前缀（mobile 端展示时再补回）。
func normalize(payload upsertPayload) upsertPayload {
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Handle = strings.TrimPrefix(strings.TrimSpace(payload.Handle), "@")
	payload.Bio = strings.TrimSpace(payload.Bio)
	payload.City = strings.TrimSpace(payload.City)
	payload.AvatarURL = strings.TrimSpace(payload.AvatarURL)
	return payload
}

func acceptedWithPayload(envelope command.Envelope, aggregateType, aggregateID, state string, payload any) command.Result {
	result := command.Accepted(envelope, aggregateType, aggregateID, 1, state, nil)
	result.OperationRef = marshalJSON(payload)
	return result
}

func rejected(envelope command.Envelope, code, messageKey string) command.Result {
	return command.Rejected(envelope, code, "VALIDATION", "AFTER_USER_ACTION", messageKey, nil)
}

func marshalJSON(payload any) string {
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func decode(raw any, target any) bool {
	data, err := json.Marshal(raw)
	return err == nil && json.Unmarshal(data, target) == nil
}

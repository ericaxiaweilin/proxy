package identity

import (
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrUserNotFound           = errors.New("user account not found")
	ErrLoginIdentityNotFound  = errors.New("login identity not found")
	ErrDeviceNotFound         = errors.New("device registration not found")
	ErrSessionNotFound        = errors.New("session not found")
	ErrSessionVersionConflict = errors.New("session version conflict")
)

// Repository is the canonical persistence boundary for Identity aggregates.
// Session updates must enforce expectedVersion atomically.
type Repository interface {
	GetUser(ctx context.Context, id string) (UserAccount, error)
	GetLoginIdentity(ctx context.Context, id string) (LoginIdentity, error)
	CreateLoginChallenge(ctx context.Context, challenge LoginChallenge) error
	GetLoginChallenge(ctx context.Context, id string) (LoginChallenge, error)
	UpdateLoginChallenge(ctx context.Context, challenge LoginChallenge, expectedVersion int) error
	GetDevice(ctx context.Context, id string) (DeviceRegistration, error)
	UpsertDevice(ctx context.Context, device DeviceRegistration) error
	HasActiveMembership(ctx context.Context, userID string, principal command.Principal) (bool, error)
	CreateSession(ctx context.Context, session Session) error
	GetSession(ctx context.Context, id string) (Session, error)
	ListSessionsByUser(ctx context.Context, userID string) ([]Session, error)
	RevokeAllSessions(ctx context.Context, userID string) ([]Session, error)
	UpdateSession(ctx context.Context, session Session, expectedVersion int) error
	Snapshot(ctx context.Context) (sessions []Session, devices []DeviceRegistration, err error)
}

// TransactionalRepository commits identity state changes together with their
// outbox events. The callback for revoke-all runs while the session rows are
// locked and before the transaction commits.
type TransactionalRepository interface {
	Repository
	CreateSessionAndPublish(ctx context.Context, session Session, domainEvents []event.DomainEvent) error
	CreateSessionWithTokensAndPublish(ctx context.Context, session Session, tokens SessionToken, domainEvents []event.DomainEvent) error
	CreateLoginChallengeAndPublish(ctx context.Context, challenge LoginChallenge, domainEvents []event.DomainEvent) error
	UpdateLoginChallengeAndPublish(ctx context.Context, challenge LoginChallenge, expectedVersion int, domainEvents []event.DomainEvent) error
	CreateSessionWithTokensAndChallengeAndPublish(ctx context.Context, session Session, tokens SessionToken, challenge LoginChallenge, domainEvents []event.DomainEvent) error
	UpsertDeviceAndPublish(ctx context.Context, device DeviceRegistration, domainEvents []event.DomainEvent) error
	UpdateSessionAndPublish(ctx context.Context, session Session, expectedVersion int, domainEvents []event.DomainEvent) error
	RevokeAllSessionsAndPublish(ctx context.Context, userID string, buildEvents func([]Session) []event.DomainEvent) ([]Session, error)
}

type MemoryRepository struct {
	mu              sync.Mutex
	users           map[string]UserAccount
	loginIdentities map[string]LoginIdentity
	devices         map[string]DeviceRegistration
	memberships     []Membership
	sessions        map[string]Session
	events          []event.DomainEvent
	tokens          map[string]SessionToken
	challenges      map[string]LoginChallenge
}

func NewMemoryRepository(seed *Seed) *MemoryRepository {
	repository := &MemoryRepository{
		users:           make(map[string]UserAccount),
		loginIdentities: make(map[string]LoginIdentity),
		devices:         make(map[string]DeviceRegistration),
		memberships:     []Membership{},
		sessions:        make(map[string]Session),
		tokens:          make(map[string]SessionToken),
		challenges:      make(map[string]LoginChallenge),
	}
	if seed != nil {
		repository.users[seed.User.ID] = seed.User
		if seed.LoginIdentity.ID != "" {
			repository.loginIdentities[seed.LoginIdentity.ID] = seed.LoginIdentity
		}
		repository.memberships = append(repository.memberships, seed.Memberships...)
		for _, device := range seed.Devices {
			repository.devices[device.ID] = device
		}
		for _, challenge := range seed.Challenges {
			repository.challenges[challenge.ID] = challenge
		}
	}
	return repository
}

func (r *MemoryRepository) GetUser(_ context.Context, id string) (UserAccount, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	user, exists := r.users[id]
	if !exists {
		return UserAccount{}, ErrUserNotFound
	}
	return user, nil
}

func (r *MemoryRepository) GetLoginIdentity(_ context.Context, id string) (LoginIdentity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	identity, exists := r.loginIdentities[id]
	if !exists {
		return LoginIdentity{}, ErrLoginIdentityNotFound
	}
	return identity, nil
}

func (r *MemoryRepository) CreateLoginChallenge(_ context.Context, challenge LoginChallenge) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.challenges[challenge.ID]; exists {
		return errors.New("login challenge already exists")
	}
	r.challenges[challenge.ID] = challenge
	return nil
}

func (r *MemoryRepository) GetLoginChallenge(_ context.Context, id string) (LoginChallenge, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	challenge, exists := r.challenges[id]
	if !exists {
		return LoginChallenge{}, ErrLoginChallengeNotFound
	}
	return challenge, nil
}

func (r *MemoryRepository) UpdateLoginChallenge(_ context.Context, challenge LoginChallenge, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.challenges[challenge.ID]
	if !exists {
		return ErrLoginChallengeNotFound
	}
	if current.Version != expectedVersion {
		return ErrLoginChallengeVersionConflict
	}
	r.challenges[challenge.ID] = challenge
	return nil
}

func (r *MemoryRepository) GetDevice(_ context.Context, id string) (DeviceRegistration, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	device, exists := r.devices[id]
	if !exists {
		return DeviceRegistration{}, ErrDeviceNotFound
	}
	return device, nil
}

func (r *MemoryRepository) UpsertDevice(_ context.Context, device DeviceRegistration) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, exists := r.devices[device.ID]; exists && existing.UserAccountID != device.UserAccountID {
		return errors.New("device belongs to another user")
	}
	r.devices[device.ID] = device
	return nil
}

func (r *MemoryRepository) UpsertDeviceAndPublish(_ context.Context, device DeviceRegistration, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, exists := r.devices[device.ID]; exists && existing.UserAccountID != device.UserAccountID {
		return errors.New("device belongs to another user")
	}
	r.devices[device.ID] = device
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) HasActiveMembership(_ context.Context, userID string, principal command.Principal) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, membership := range r.memberships {
		if membership.UserAccountID == userID && membership.Status == "ACTIVE" && membership.Principal == principal {
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryRepository) CreateSession(_ context.Context, session Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.sessions[session.ID]; exists {
		return errors.New("session already exists")
	}
	r.sessions[session.ID] = session
	return nil
}

func (r *MemoryRepository) CreateSessionAndPublish(_ context.Context, session Session, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.sessions[session.ID]; exists {
		return errors.New("session already exists")
	}
	r.sessions[session.ID] = session
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) CreateSessionWithTokensAndPublish(_ context.Context, session Session, tokens SessionToken, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.sessions[session.ID]; exists {
		return errors.New("session already exists")
	}
	if _, exists := r.tokens[session.ID]; exists {
		return errors.New("session tokens already exist")
	}
	r.sessions[session.ID] = session
	r.tokens[session.ID] = tokens
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) CreateLoginChallengeAndPublish(_ context.Context, challenge LoginChallenge, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.challenges[challenge.ID]; exists {
		return errors.New("login challenge already exists")
	}
	r.challenges[challenge.ID] = challenge
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) UpdateLoginChallengeAndPublish(_ context.Context, challenge LoginChallenge, expectedVersion int, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.challenges[challenge.ID]
	if !exists {
		return ErrLoginChallengeNotFound
	}
	if current.Version != expectedVersion {
		return ErrLoginChallengeVersionConflict
	}
	r.challenges[challenge.ID] = challenge
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) CreateSessionWithTokensAndChallengeAndPublish(_ context.Context, session Session, tokens SessionToken, challenge LoginChallenge, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	currentChallenge, exists := r.challenges[challenge.ID]
	if !exists {
		return ErrLoginChallengeNotFound
	}
	if currentChallenge.Version+1 != challenge.Version || currentChallenge.Status != "VERIFIED" {
		return ErrLoginChallengeVersionConflict
	}
	if _, exists := r.sessions[session.ID]; exists {
		return errors.New("session already exists")
	}
	if _, exists := r.tokens[session.ID]; exists {
		return errors.New("session tokens already exist")
	}
	r.challenges[challenge.ID] = challenge
	r.sessions[session.ID] = session
	r.tokens[session.ID] = tokens
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) GetSession(_ context.Context, id string) (Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, exists := r.sessions[id]
	if !exists {
		return Session{}, ErrSessionNotFound
	}
	return session, nil
}

func (r *MemoryRepository) ListSessionsByUser(_ context.Context, userID string) ([]Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Session, 0)
	for _, session := range r.sessions {
		if session.UserAccountID == userID {
			result = append(result, session)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (r *MemoryRepository) RevokeAllSessions(_ context.Context, userID string) ([]Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return revokeAllSessionsLocked(r.sessions, userID), nil
}

func (r *MemoryRepository) RevokeAllSessionsAndPublish(_ context.Context, userID string, buildEvents func([]Session) []event.DomainEvent) ([]Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := revokeAllSessionsLocked(r.sessions, userID)
	r.events = append(r.events, buildEvents(result)...)
	return result, nil
}

func (r *MemoryRepository) UpdateSession(_ context.Context, session Session, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.sessions[session.ID]
	if !exists {
		return ErrSessionNotFound
	}
	if current.Version != expectedVersion {
		return ErrSessionVersionConflict
	}
	r.sessions[session.ID] = session
	return nil
}

func (r *MemoryRepository) UpdateSessionAndPublish(_ context.Context, session Session, expectedVersion int, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.sessions[session.ID]
	if !exists {
		return ErrSessionNotFound
	}
	if current.Version != expectedVersion {
		return ErrSessionVersionConflict
	}
	r.sessions[session.ID] = session
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) Events() []event.DomainEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]event.DomainEvent, len(r.events))
	copy(result, r.events)
	return result
}

func (r *MemoryRepository) SaveSessionTokens(_ context.Context, tokens SessionToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.tokens[tokens.SessionID]; exists {
		return errors.New("session tokens already exist")
	}
	r.tokens[tokens.SessionID] = tokens
	return nil
}

func (r *MemoryRepository) GetByAccessTokenHash(_ context.Context, accessTokenHash string) (SessionToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, tokens := range r.tokens {
		if tokens.AccessTokenHash == accessTokenHash {
			return tokens, nil
		}
	}
	return SessionToken{}, ErrTokenNotFound
}

func (r *MemoryRepository) GetByRefreshTokenHash(_ context.Context, refreshTokenHash string) (SessionToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, tokens := range r.tokens {
		if tokens.RefreshTokenHash == refreshTokenHash {
			return tokens, nil
		}
	}
	return SessionToken{}, ErrTokenNotFound
}

func (r *MemoryRepository) RotateSessionTokens(_ context.Context, sessionID string, expectedRotation int, replacement SessionToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.tokens[sessionID]
	if !exists {
		return ErrTokenNotFound
	}
	if current.Rotation != expectedRotation {
		return ErrTokenRotationConflict
	}
	r.tokens[sessionID] = replacement
	return nil
}

func (r *MemoryRepository) RevokeSessionTokens(_ context.Context, sessionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.tokens[sessionID]; !exists {
		return ErrTokenNotFound
	}
	delete(r.tokens, sessionID)
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) (sessions []Session, devices []DeviceRegistration, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, session := range r.sessions {
		sessions = append(sessions, session)
	}
	for _, device := range r.devices {
		devices = append(devices, device)
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].ID < sessions[j].ID })
	sort.Slice(devices, func(i, j int) bool { return devices[i].ID < devices[j].ID })
	return sessions, devices, nil
}

func revokeAllSessionsLocked(sessions map[string]Session, userID string) []Session {
	result := make([]Session, 0)
	for id, session := range sessions {
		if session.UserAccountID != userID || session.Status != "ACTIVE" {
			continue
		}
		session.Status = "REVOKED"
		session.Version++
		sessions[id] = session
		result = append(result, session)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

var _ TransactionalRepository = (*MemoryRepository)(nil)
var _ TokenRepository = (*MemoryRepository)(nil)

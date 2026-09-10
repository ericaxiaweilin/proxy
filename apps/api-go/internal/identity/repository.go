package identity

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrUserNotFound           = errors.New("user account not found")
	ErrLoginIdentityNotFound  = errors.New("login identity not found")
	ErrDeviceNotFound         = errors.New("device registration not found")
	ErrSessionNotFound        = errors.New("session not found")
	ErrSessionVersionConflict = errors.New("session version conflict")
	// ErrPrivacyRequestNotFound is returned by PrivacyRequestRepository
	// lookups when the request id is unknown. Service-layer code turns
	// this into a 404 for the privacy center endpoints.
	ErrPrivacyRequestNotFound = errors.New("privacy request not found")
	// ErrPrivacyRequestActive is returned when a user tries to submit a
	// new request of the same kind while a previous one is still
	// 'received' or 'in_progress'. The user must wait, cancel, or reject
	// the active request before submitting a new one.
	ErrPrivacyRequestActive = errors.New("an active privacy request of this kind already exists")
)

// PrivacyRequestKind enumerates the two request categories supported by
// the privacy request center. 'export' is the data subject access right
// (PDP 91/2025/QH15 Art. 31). 'delete' is the erasure right (Art. 32).
// Adding a new kind requires a migration to widen the CHECK constraint
// and a new endpoint — neither is on the current roadmap.
type PrivacyRequestKind string

const (
	PrivacyRequestKindExport PrivacyRequestKind = "export"
	PrivacyRequestKindDelete PrivacyRequestKind = "delete"
)

// PrivacyRequestStatus is the lifecycle state. The semantics are
// documented in migrations/060_privacy_requests.sql; transitions are
// validated by the service layer, not by the database.
type PrivacyRequestStatus string

const (
	PrivacyRequestStatusReceived   PrivacyRequestStatus = "received"
	PrivacyRequestStatusInProgress PrivacyRequestStatus = "in_progress"
	PrivacyRequestStatusCompleted  PrivacyRequestStatus = "completed"
	PrivacyRequestStatusRejected   PrivacyRequestStatus = "rejected"
	PrivacyRequestStatusCancelled  PrivacyRequestStatus = "cancelled"
)

// PrivacyRequest is the on-the-wire record of a single user-driven
// privacy request. The struct is intentionally small: the export payload
// itself is large, lives in object storage, and is referenced by
// ExportSnapshotURL. Keep the public surface area here aligned with
// migrations/060_privacy_requests.sql.
type PrivacyRequest struct {
	ID                   string               `json:"id"`
	UserID               string               `json:"userId"`
	Kind                 PrivacyRequestKind   `json:"kind"`
	Status               PrivacyRequestStatus `json:"status"`
	RequestedAt          time.Time            `json:"requestedAt"`
	CompletedAt          *time.Time           `json:"completedAt,omitempty"`
	ErasedAt             *time.Time           `json:"erasedAt,omitempty"`
	ExportSnapshotURL    string               `json:"exportSnapshotUrl,omitempty"`
	ExportSHA256         string               `json:"exportSha256,omitempty"`
	ExportRetentionUntil *time.Time           `json:"exportRetentionUntil,omitempty"`
	LegalBasis           string               `json:"legalBasis"`
	ClientIP             string               `json:"clientIp,omitempty"`
	UserAgent            string               `json:"userAgent,omitempty"`
	RejectionReason      string               `json:"rejectionReason,omitempty"`
	Version              int                  `json:"version"`
}

// PrivacyRequestEvent is an append-only audit log entry. The privacy
// request center writes one row per status transition so that auditors
// can reconstruct the timeline without trusting the parent row.
type PrivacyRequestEvent struct {
	ID         int64     `json:"id"`
	RequestID  string    `json:"requestId"`
	FromStatus string    `json:"fromStatus,omitempty"`
	ToStatus   string    `json:"toStatus"`
	OccurredAt time.Time `json:"occuredAt"`
	Actor      string    `json:"actor"`
	Notes      string    `json:"notes,omitempty"`
}

// PrivacyRequestRepository is the persistence boundary for privacy
// requests. Methods are split from the main Repository interface so
// that future schemas (e.g. a separate privacy warehouse) can swap
// implementations without touching the identity aggregates.
type PrivacyRequestRepository interface {
	CreatePrivacyRequest(ctx context.Context, req PrivacyRequest) error
	GetActivePrivacyRequest(ctx context.Context, userID string, kind PrivacyRequestKind) (PrivacyRequest, error)
	GetPrivacyRequest(ctx context.Context, id string) (PrivacyRequest, error)
	ListPrivacyRequestsByUser(ctx context.Context, userID string) ([]PrivacyRequest, error)
	UpdatePrivacyRequest(ctx context.Context, req PrivacyRequest, expectedVersion int) error
	AppendPrivacyRequestEvent(ctx context.Context, evt PrivacyRequestEvent) error
}

// Repository is the canonical persistence boundary for Identity aggregates.
// Session updates must enforce expectedVersion atomically.
type Repository interface {
	GetUser(ctx context.Context, id string) (UserAccount, error)
	GetLoginIdentity(ctx context.Context, id string) (LoginIdentity, error)
	// FindLoginIdentity is a read-only existence lookup by verified
	// channel + identifier (AUTH-LOGIN-HINT-001). It must never create
	// rows — unlike EnsurePasswordlessIdentity.
	FindLoginIdentity(ctx context.Context, channel, identifier string) (LoginIdentity, error)
	EnsurePasswordlessIdentity(ctx context.Context, channel, identifier, deviceID, platform, upgradingUserAccountID string) (LoginIdentity, DeviceRegistration, bool, error)
	EnsureAnonymousIdentity(ctx context.Context, deviceID, platform string) (UserAccount, DeviceRegistration, bool, error)
	CreateLoginChallenge(ctx context.Context, challenge LoginChallenge) error
	GetLoginChallenge(ctx context.Context, id string) (LoginChallenge, error)
	UpdateLoginChallenge(ctx context.Context, challenge LoginChallenge, expectedVersion int) error
	// RevokePendingChallengesForIdentity supersedes every PENDING
	// challenge of a login identity (OTP-SINGLE-CODE-001: only the most
	// recent code may verify — WhatsApp / Telegram / Twilio Verify
	// semantics). Returns the revoked challenges so the caller can emit
	// domain events for each.
	RevokePendingChallengesForIdentity(ctx context.Context, loginIdentityID string) ([]LoginChallenge, error)
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

type TrustedDeviceRepository interface {
	BindDeviceCredential(ctx context.Context, deviceID, userAccountID, credentialHash string) error
	GetTrustedDevice(ctx context.Context, deviceID, credentialHash string) (DeviceRegistration, error)
}

// TransactionalRepository commits identity state changes together with their
// outbox events. The callback for revoke-all runs while the session rows are
// locked and before the transaction commits.
type TransactionalRepository interface {
	Repository
	CreateSessionAndPublish(ctx context.Context, session Session, domainEvents []event.DomainEvent) error
	CreateSessionWithTokensAndPublish(ctx context.Context, session Session, tokens SessionToken, domainEvents []event.DomainEvent) error
	CreateLoginChallengeAndPublish(ctx context.Context, challenge LoginChallenge, domainEvents []event.DomainEvent) error
	// CreateLoginChallengeSupersedingPending atomically revokes every
	// PENDING challenge of the identity and inserts the fresh one —
	// OTP-SINGLE-CODE-001 (only the most recent code is verifiable).
	// buildEvents receives the superseded challenges so the caller can
	// emit a LoginChallengeSuperseded event per revoked code; events for
	// the new challenge are appended after.
	CreateLoginChallengeSupersedingPending(ctx context.Context, challenge LoginChallenge, buildEvents func(superseded []LoginChallenge) []event.DomainEvent) error
	UpdateLoginChallengeAndPublish(ctx context.Context, challenge LoginChallenge, expectedVersion int, domainEvents []event.DomainEvent) error
	CreateSessionWithTokensAndChallengeAndPublish(ctx context.Context, session Session, tokens SessionToken, challenge LoginChallenge, domainEvents []event.DomainEvent) error
	UpsertDeviceAndPublish(ctx context.Context, device DeviceRegistration, domainEvents []event.DomainEvent) error
	UpdateSessionAndPublish(ctx context.Context, session Session, expectedVersion int, domainEvents []event.DomainEvent) error
	RevokeAllSessionsAndPublish(ctx context.Context, userID string, buildEvents func([]Session) []event.DomainEvent) ([]Session, error)
}

type MemoryRepository struct {
	mu                 sync.Mutex
	users              map[string]UserAccount
	loginIdentities    map[string]LoginIdentity
	devices            map[string]DeviceRegistration
	memberships        []Membership
	sessions           map[string]Session
	events             []event.DomainEvent
	tokens             map[string]SessionToken
	challenges         map[string]LoginChallenge
	privacyRequests    map[string]PrivacyRequest
	privacyEvents      []PrivacyRequestEvent
	privacyEventSeq    int64
	accountPreferences map[string]AccountPreferences
}

func NewMemoryRepository(seed *Seed) *MemoryRepository {
	repository := &MemoryRepository{
		users:              make(map[string]UserAccount),
		loginIdentities:    make(map[string]LoginIdentity),
		devices:            make(map[string]DeviceRegistration),
		memberships:        []Membership{},
		sessions:           make(map[string]Session),
		tokens:             make(map[string]SessionToken),
		challenges:         make(map[string]LoginChallenge),
		privacyRequests:    make(map[string]PrivacyRequest),
		accountPreferences: make(map[string]AccountPreferences),
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

func (r *MemoryRepository) GetAccountPreferences(_ context.Context, userID string) (AccountPreferences, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.accountPreferences[userID]
	if !ok {
		return AccountPreferences{}, ErrAccountPreferencesNotFound
	}
	return p, nil
}

func (r *MemoryRepository) UpsertAccountPreferences(_ context.Context, p AccountPreferences) (AccountPreferences, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p.Version = r.accountPreferences[p.UserAccountID].Version + 1
	r.accountPreferences[p.UserAccountID] = p
	return p, nil
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

func (r *MemoryRepository) FindLoginIdentity(_ context.Context, channel, identifier string) (LoginIdentity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, identity := range r.loginIdentities {
		if identity.Channel == channel && identity.Identifier == identifier {
			return identity, nil
		}
	}
	return LoginIdentity{}, ErrLoginIdentityNotFound
}

func (r *MemoryRepository) EnsurePasswordlessIdentity(_ context.Context, channel, identifier, deviceID, platform, upgradingUserAccountID string) (LoginIdentity, DeviceRegistration, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, identity := range r.loginIdentities {
		if identity.Channel == channel && identity.Identifier == identifier && identity.Status == "ACTIVE" {
			device := DeviceRegistration{ID: deviceID, UserAccountID: identity.UserAccountID, Platform: platform, Status: "ACTIVE"}
			if existing, exists := r.devices[deviceID]; exists && existing.UserAccountID != identity.UserAccountID && upgradingUserAccountID == "" {
				return LoginIdentity{}, DeviceRegistration{}, false, errors.New("device belongs to another user")
			}
			r.devices[deviceID] = device
			return identity, device, false, nil
		}
	}
	user := UserAccount{ID: newID("user_"), Status: "REGISTERED"}
	if upgradingUserAccountID != "" {
		var found bool
		user, found = r.users[upgradingUserAccountID]
		if !found {
			return LoginIdentity{}, DeviceRegistration{}, false, ErrUserNotFound
		}
		user.Status = "REGISTERED"
		r.users[user.ID] = user
	}
	identity := LoginIdentity{ID: newID("login_"), UserAccountID: user.ID, Channel: channel, Identifier: identifier, Verified: true, Status: "ACTIVE"}
	device := DeviceRegistration{ID: deviceID, UserAccountID: user.ID, Platform: platform, Status: "ACTIVE"}
	if upgradingUserAccountID == "" {
		r.users[user.ID] = user
	}
	// ACCOUNT-SWITCH-001: same takeover semantics as the PostgreSQL
	// repository — a fresh different-account login may claim the device
	// only when the device has no ACTIVE session left; while the owner
	// holds a live session the device stays exclusive.
	if existing, exists := r.devices[deviceID]; exists && existing.UserAccountID != user.ID && !r.deviceHasNoActiveSessionLocked(deviceID) {
		return LoginIdentity{}, DeviceRegistration{}, false, errors.New("device belongs to another user")
	}
	r.loginIdentities[identity.ID] = identity
	r.devices[device.ID] = device
	r.memberships = append(r.memberships, Membership{Principal: command.Principal{Type: "INDIVIDUAL", ID: user.ID}, UserAccountID: user.ID, Status: "ACTIVE"})
	return identity, device, true, nil
}

// deviceHasNoActiveSessionLocked reports whether this device currently
// has no ACTIVE session. Caller must hold r.mu. It gates the
// ACCOUNT-SWITCH-001 takeover in the memory repository (same semantics
// as the PostgreSQL deviceHasNoActiveSession).
func (r *MemoryRepository) deviceHasNoActiveSessionLocked(deviceID string) bool {
	for _, session := range r.sessions {
		if session.DeviceID == deviceID && session.Status == "ACTIVE" {
			return false
		}
	}
	return true
}

// EnsureAnonymousIdentity gives a device a durable, server-owned ANONYMOUS
// account. Re-opening the app on the same device reuses the same person;
// it never manufactures a client-side placeholder identity.
func (r *MemoryRepository) EnsureAnonymousIdentity(_ context.Context, deviceID, platform string) (UserAccount, DeviceRegistration, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if device, exists := r.devices[deviceID]; exists {
		user, found := r.users[device.UserAccountID]
		if !found {
			return UserAccount{}, DeviceRegistration{}, false, ErrUserNotFound
		}
		return user, device, false, nil
	}
	user := UserAccount{ID: newID("user_"), Status: "ANONYMOUS"}
	device := DeviceRegistration{ID: deviceID, UserAccountID: user.ID, Platform: platform, Status: "ACTIVE"}
	r.users[user.ID] = user
	r.devices[device.ID] = device
	r.memberships = append(r.memberships, Membership{Principal: command.Principal{Type: "INDIVIDUAL", ID: user.ID}, UserAccountID: user.ID, Status: "ACTIVE"})
	return user, device, true, nil
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

// RevokePendingChallengesForIdentity mirrors the PostgreSQL repository:
// every PENDING challenge of the identity flips to LOCKED (version
// bumped) and is returned for domain-event emission. OTP-SINGLE-CODE-001.
func (r *MemoryRepository) RevokePendingChallengesForIdentity(_ context.Context, loginIdentityID string) ([]LoginChallenge, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	revoked := make([]LoginChallenge, 0, 2)
	for id, challenge := range r.challenges {
		if challenge.LoginIdentityID == loginIdentityID && challenge.Status == "PENDING" {
			challenge.Status = "LOCKED"
			challenge.Version++
			r.challenges[id] = challenge
			revoked = append(revoked, challenge)
		}
	}
	return revoked, nil
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

func (r *MemoryRepository) BindDeviceCredential(_ context.Context, deviceID, userAccountID, credentialHash string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	device, exists := r.devices[deviceID]
	if !exists || device.UserAccountID != userAccountID || device.Status != "ACTIVE" {
		return ErrDeviceNotFound
	}
	device.CredentialHash = credentialHash
	r.devices[deviceID] = device
	return nil
}

func (r *MemoryRepository) GetTrustedDevice(_ context.Context, deviceID, credentialHash string) (DeviceRegistration, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	device, exists := r.devices[deviceID]
	if !exists || device.Status != "ACTIVE" || device.CredentialHash == "" || device.CredentialHash != credentialHash {
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

// CreateLoginChallengeSupersedingPending mirrors the PostgreSQL
// repository: lock every PENDING challenge of the identity, insert the
// fresh one, publish the caller's events — atomically under r.mu.
// OTP-SINGLE-CODE-001.
func (r *MemoryRepository) CreateLoginChallengeSupersedingPending(_ context.Context, challenge LoginChallenge, buildEvents func(superseded []LoginChallenge) []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.challenges[challenge.ID]; exists {
		return errors.New("login challenge already exists")
	}
	superseded := make([]LoginChallenge, 0, 2)
	for id, pending := range r.challenges {
		if pending.LoginIdentityID == challenge.LoginIdentityID && pending.Status == "PENDING" {
			pending.Status = "LOCKED"
			pending.Version++
			r.challenges[id] = pending
			superseded = append(superseded, pending)
		}
	}
	r.challenges[challenge.ID] = challenge
	r.events = append(r.events, buildEvents(superseded)...)
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
	result := revokeAllSessionsLocked(r.sessions, userID)
	for _, session := range result {
		delete(r.tokens, session.ID)
	}
	return result, nil
}

func (r *MemoryRepository) RevokeAllSessionsAndPublish(_ context.Context, userID string, buildEvents func([]Session) []event.DomainEvent) ([]Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := revokeAllSessionsLocked(r.sessions, userID)
	for _, session := range result {
		delete(r.tokens, session.ID)
	}
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
	if session.Status == "REVOKED" {
		delete(r.tokens, session.ID)
	}
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

// CreatePrivacyRequest records a new privacy request. The service
// layer must check for an active request of the same (user, kind) before
// calling this method; the memory implementation refuses to do that
// lookup itself because the service is responsible for surfacing the
// appropriate error code (LE-15 contract: "an active request already
// exists, wait or cancel it first").
func (r *MemoryRepository) CreatePrivacyRequest(_ context.Context, req PrivacyRequest) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.privacyRequests[req.ID]; exists {
		return errors.New("privacy request already exists")
	}
	for _, existing := range r.privacyRequests {
		if existing.UserID == req.UserID && existing.Kind == req.Kind &&
			(existing.Status == PrivacyRequestStatusReceived || existing.Status == PrivacyRequestStatusInProgress) {
			return ErrPrivacyRequestActive
		}
	}
	r.privacyRequests[req.ID] = req
	return nil
}

// GetActivePrivacyRequest returns the user's currently active (received
// or in_progress) request of the given kind, or ErrPrivacyRequestNotFound
// if there is none.
func (r *MemoryRepository) GetActivePrivacyRequest(_ context.Context, userID string, kind PrivacyRequestKind) (PrivacyRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.privacyRequests {
		if existing.UserID == userID && existing.Kind == kind &&
			(existing.Status == PrivacyRequestStatusReceived || existing.Status == PrivacyRequestStatusInProgress) {
			return existing, nil
		}
	}
	return PrivacyRequest{}, ErrPrivacyRequestNotFound
}

// GetPrivacyRequest fetches a request by id without filtering on status
// or user. The transport layer is responsible for ensuring the caller
// owns the request before exposing the result.
func (r *MemoryRepository) GetPrivacyRequest(_ context.Context, id string) (PrivacyRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	req, exists := r.privacyRequests[id]
	if !exists {
		return PrivacyRequest{}, ErrPrivacyRequestNotFound
	}
	return req, nil
}

// ListPrivacyRequestsByUser returns every privacy request the user has
// ever submitted, newest first. The privacy center surface uses this
// to render the history panel.
func (r *MemoryRepository) ListPrivacyRequestsByUser(_ context.Context, userID string) ([]PrivacyRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]PrivacyRequest, 0)
	for _, req := range r.privacyRequests {
		if req.UserID == userID {
			result = append(result, req)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].RequestedAt.After(result[j].RequestedAt) })
	return result, nil
}

// UpdatePrivacyRequest applies a status transition. The service layer
// must bump the version and pass the previous version as
// expectedVersion; the memory implementation refuses to clobber a
// concurrent update.
func (r *MemoryRepository) UpdatePrivacyRequest(_ context.Context, req PrivacyRequest, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.privacyRequests[req.ID]
	if !exists {
		return ErrPrivacyRequestNotFound
	}
	if current.Version != expectedVersion {
		return ErrSessionVersionConflict
	}
	r.privacyRequests[req.ID] = req
	return nil
}

// AppendPrivacyRequestEvent records a status transition in the audit
// log. The privacy center never deletes from this log; the schema's
// ON DELETE CASCADE on privacy_request_events only fires if a parent
// row is hard-deleted, which the service layer never does.
func (r *MemoryRepository) AppendPrivacyRequestEvent(_ context.Context, evt PrivacyRequestEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.privacyEventSeq++
	evt.ID = r.privacyEventSeq
	r.privacyEvents = append(r.privacyEvents, evt)
	return nil
}

// ListLegalConsents returns the legal-consent rows the user has
// recorded, for inclusion in a PrivacyDataExport payload. The in-memory
// repository is consulted by the service's type-assertion in
// GeneratePrivacyExportData; the postgres repository implements its own
// version. We deliberately keep the method separate from the main
// Repository interface so older deployments that predate migration 059
// still compile.
func (r *MemoryRepository) ListLegalConsents(_ context.Context, userID string) ([]LegalConsentSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// The in-memory repository does not currently persist consent rows
	// (those go straight to postgres via the typed recorder). We return
	// an empty slice rather than synthesise data, because the export
	// payload is allowed to omit the consents field for users who
	// consented on a different deployment than the one being queried.
	return []LegalConsentSnapshot{}, nil
}

var _ PrivacyRequestRepository = (*MemoryRepository)(nil)

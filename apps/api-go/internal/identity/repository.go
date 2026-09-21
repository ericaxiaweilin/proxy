package identity

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
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
	// ListDuePrivacyDeletions returns the delete requests the LC-15
	// erasure executor still has to act on: kind='delete', status in
	// ('received','in_progress'), requested_at <= receivedBefore.
	// The caller passes now - PrivacyDeleteInProgressDelay, so this is
	// "requests the platform is contractually late on". The executor
	// then decides between the in_progress flip and the real erasure.
	ListDuePrivacyDeletions(ctx context.Context, receivedBefore time.Time) ([]PrivacyRequest, error)
	UpdatePrivacyRequest(ctx context.Context, req PrivacyRequest, expectedVersion int) error
	AppendPrivacyRequestEvent(ctx context.Context, evt PrivacyRequestEvent) error
}

// PersonalDataEraser is the persistence boundary for the destructive
// half of LC-15 (Vietnam PDP 91/2025/QH15 Art. 32 erasure). It is a
// separate interface from PrivacyRequestRepository because the two
// concerns are genuinely different: the request centre records an
// intention, this one carries it out. Keeping them apart means the
// executor can be handed exactly one dependency, and it keeps the
// "did anything actually get erased?" question answerable by looking
// at one method body.
//
// The contract is idempotent: running it twice for the same user must
// be safe and must report zero rows the second time. The executor
// relies on that — it erases before it bookkeeps, so a crash between
// the two steps simply replays the erasure.
type PersonalDataEraser interface {
	ErasePersonalData(ctx context.Context, userID string) (ErasedPersonalData, error)
}

// ErasedPersonalData is the machine-readable receipt of one erasure
// pass. Every counter is a table the executor physically deleted rows
// from; every counter being zero on a second pass is how the
// idempotency contract above is verified. What the executor
// deliberately does NOT delete is spelled out in RetainedOnErasure,
// because "个人数据将被永久删除" is only an honest promise together
// with its exceptions.
type ErasedPersonalData struct {
	LoginIdentities    int `json:"loginIdentities"`
	LoginChallenges    int `json:"loginChallenges"`
	Sessions           int `json:"sessions"`
	SessionTokens      int `json:"sessionTokens"`
	Devices            int `json:"devices"`
	Profiles           int `json:"profiles"`
	AccountPreferences int `json:"accountPreferences"`
	DisplayIdentities  int `json:"displayIdentities"`
	Memberships        int `json:"memberships"`
	Jurisdictions      int `json:"jurisdictions"`
	// AgeAssertionsWiped counts age-assertion rows whose client
	// metadata (ip / user_agent) was cleared. The date_of_birth itself
	// is retained — see RetainedOnErasure.
	AgeAssertionsWiped int `json:"ageAssertionsWiped"`
	// AccountAnonymised is true when the identity.user_accounts row was
	// flipped to status='ERASED'. The row survives; the account does not.
	AccountAnonymised bool `json:"accountAnonymised"`
}

// Total is the number of rows the erasure physically removed or
// scrubbed. Used by the sweep log line and by tests asserting that an
// erasure was not a no-op.
func (e ErasedPersonalData) Total() int {
	return e.LoginIdentities + e.LoginChallenges + e.Sessions + e.SessionTokens +
		e.Devices + e.Profiles + e.AccountPreferences + e.DisplayIdentities +
		e.Memberships + e.Jurisdictions + e.AgeAssertionsWiped
}

// Summary renders the receipt for the privacy_request_events audit
// trail, so an auditor reading one row can see what was removed
// without re-deriving it from the database.
func (e ErasedPersonalData) Summary() string {
	return fmt.Sprintf(
		"login_identities=%d login_challenges=%d sessions=%d session_tokens=%d devices=%d profiles=%d preferences=%d display_identities=%d memberships=%d jurisdictions=%d age_assertion_metadata=%d account_anonymised=%t",
		e.LoginIdentities, e.LoginChallenges, e.Sessions, e.SessionTokens,
		e.Devices, e.Profiles, e.AccountPreferences, e.DisplayIdentities,
		e.Memberships, e.Jurisdictions, e.AgeAssertionsWiped, e.AccountAnonymised,
	)
}

// RetainedOnErasure names the categories the erasure executor keeps,
// each with the reason it survives. It exists as a value (not only a
// comment) so the audit event and the regression pins can assert on
// it: the user-facing promise is "永久删除（法律要求保存的记录除外）",
// and this constant is the "除外".
const RetainedOnErasure = "account_row (anonymised to status=ERASED: " +
	"business.accounts.owner_user_id is ON DELETE RESTRICT and the payment/order " +
	"ledgers reference it for the statutory window), " +
	"agent_claim_number (no-gap numbering audit), " +
	"age_assertion date_of_birth (COMP-AGE-001 minor-protection evidence; ip/user_agent wiped), " +
	"legal_consent_records (proof the processing was lawful), " +
	"payment/order/business rows (Decree 248/2026 §23, >=12 months), " +
	"privacy_requests + privacy_request_events (this audit trail)"

// ErrPersonalDataEraserUnavailable is returned when a repository does
// not implement PersonalDataEraser. The service treats it as
// "erasure not configured" and refuses to mark a request completed —
// silently pretending to have erased is the one outcome that must
// never happen.
var ErrPersonalDataEraserUnavailable = errors.New("personal data eraser is not configured")

// CrossAggregateEraser is the second half of LC-15: the copies of a
// user's display identity that were written into aggregates other
// than Identity.
//
// PersonalDataEraser removes the authoritative rows. It cannot remove
// what other aggregates snapshotted at write time, and they all do:
//
//   - localnet.posts.author_display_name and
//     socialspace.statuses.author_display_name hold the profile name
//     as it was when the post was published.
//   - marketplace.opportunities keeps the publisher's display name
//     inside its payload, next to the authoritative owner_id.
//   - business.member_directory keeps one for the same reason.
//   - identity.profiles.avatar_path points at a media asset that
//     /v1/media/play/<id> serves over a public, unauthenticated URL.
//
// Deleting the profile row leaves every one of those behind, which is
// what would make the shipped copy 「头像会被永久删除」 false.
//
// The contract matches PersonalDataEraser: idempotent (a second pass
// reports zero rows) and every counter is a row actually touched.
//
// ORDERING — this runs BEFORE PersonalDataEraser, and the order is
// load-bearing rather than cosmetic. media.media_assets has no
// "purpose" column, so the avatar is identifiable only through
// identity.profiles.avatar_path. Once the profile row is gone the
// avatar cannot be told apart from the user's ordinary post media and
// the reference is unrecoverable — the avatar would stay publicly
// servable forever. Service.advancePrivacyDeletion enforces the order.
type CrossAggregateEraser interface {
	EraseCrossAggregateIdentity(ctx context.Context, userID string) (ErasedCrossAggregate, error)
}

// ErasedCrossAggregate is the receipt of one cross-aggregate pass.
// The counters are of two different kinds and the difference matters
// when reading the audit trail:
//
//   - the name counters are UPDATEs that blanked a snapshot column.
//     The authored row itself survives, de-attributed.
//   - AvatarAssetsUnserved and PushTokens are rows whose
//     reachability was removed: the avatar stops being publicly
//     deliverable, the push token stops existing.
type ErasedCrossAggregate struct {
	PostDisplayNames       int `json:"postDisplayNames"`
	StatusDisplayNames     int `json:"statusDisplayNames"`
	OpportunityOwners      int `json:"opportunityOwners"`
	BusinessDirectoryNames int `json:"businessDirectoryNames"`
	// ConversationSnapshots counts conversation.messages rows whose
	// sender_snapshot was cleared. The column is defined by migration
	// 039 and no writer populates it yet; the statement is here so the
	// first writer to land cannot create a leak that the erasure does
	// not cover. The counter reads zero until then.
	ConversationSnapshots int `json:"conversationSnapshots"`
	AvatarAssetsUnserved  int `json:"avatarAssetsUnserved"`
	PushTokens            int `json:"pushTokens"`
}

// Total is the number of rows the pass scrubbed or un-served.
func (e ErasedCrossAggregate) Total() int {
	return e.PostDisplayNames + e.StatusDisplayNames + e.OpportunityOwners +
		e.BusinessDirectoryNames + e.ConversationSnapshots +
		e.AvatarAssetsUnserved + e.PushTokens
}

// Summary renders the receipt for the privacy_request_events audit
// trail, alongside ErasedPersonalData.Summary().
func (e ErasedCrossAggregate) Summary() string {
	return fmt.Sprintf(
		"external: post_names=%d status_names=%d opportunity_owners=%d business_directory_names=%d conversation_snapshots=%d avatar_assets_unserved=%d push_tokens=%d",
		e.PostDisplayNames, e.StatusDisplayNames, e.OpportunityOwners,
		e.BusinessDirectoryNames, e.ConversationSnapshots,
		e.AvatarAssetsUnserved, e.PushTokens,
	)
}

// CrossAggregateErasureBoundary names what the cross-aggregate pass
// leaves behind. It is the companion of RetainedOnErasure: that one
// covers the identity aggregate, this one covers everywhere else the
// user's identity was copied to.
//
// Two different kinds of reason appear here and they must not be
// conflated — one is a deliberate retention, the other is a
// capability this build does not have:
//
//   - statutory / product retention: the row is a record the platform
//     is required to keep, so it survives with the name blanked.
//   - missing capability: the avatar's stored object bytes are not
//     purged. The media package has no object-delete path (every
//     os.Remove in it is temp-file cleanup during upload or
//     processing), so the asset row is demoted to
//     visibility_class=OWNER_ONLY instead — which is exactly what
//     makes ResolveServingPath refuse it, because that method
//     requires PUBLIC. The public URL stops resolving; the blob
//     stays on disk.
const CrossAggregateErasureBoundary = "authored content rows (localnet.posts, " +
	"socialspace.statuses, marketplace.opportunities) are KEPT with the display name " +
	"blanked rather than deleted: other users' replies / bookmarks / reposts reference " +
	"them, and the request was for erasure of personal data, not withdrawal of content; " +
	"business.member_directory rows are KEPT (the membership is a commercial record) with " +
	"the name blanked; " +
	"ai.ai_personas KEPT (a separate entity the user created; owner_id now points at an " +
	"anonymised account), " +
	"supply.agent_profiles + supply.seller_real_name_verifications KEPT (real-name / KYC " +
	"evidence, Decree 248/2026 §23), " +
	"fulfillment.* and payment.* ledgers KEPT (statutory window); " +
	"LIMITATION (not a retention): the avatar's stored object bytes are NOT purged — this " +
	"build has no object-delete path, so the asset row is demoted to " +
	"visibility_class=OWNER_ONLY and the blob remains on disk"

// ErrCrossAggregateEraserUnavailable is returned when a repository does
// not implement CrossAggregateEraser. Like its identity-side sibling
// the service refuses to sweep rather than mark a request completed
// while the user's name is still on their posts.
var ErrCrossAggregateEraserUnavailable = errors.New("cross-aggregate eraser is not configured")

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

// ListDuePrivacyDeletions mirrors the postgres query: delete requests
// whose grace-window acknowledgement deadline has passed, oldest
// first so a long backlog is drained in submission order.
func (r *MemoryRepository) ListDuePrivacyDeletions(_ context.Context, receivedBefore time.Time) ([]PrivacyRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]PrivacyRequest, 0)
	for _, req := range r.privacyRequests {
		if req.Kind != PrivacyRequestKindDelete {
			continue
		}
		if req.Status != PrivacyRequestStatusReceived && req.Status != PrivacyRequestStatusInProgress {
			continue
		}
		if req.RequestedAt.After(receivedBefore) {
			continue
		}
		result = append(result, req)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].RequestedAt.Before(result[j].RequestedAt) })
	return result, nil
}

// ErasePersonalData is the in-memory counterpart of the postgres
// erasure. The memory repository only owns part of the identity
// aggregate — it has no profile / display-identity / jurisdiction /
// age-assertion storage — so the counters it reports are the subset it
// actually holds. The full-wipe assertions live in the postgres
// integration test; this implementation exists so the service-level
// sweep logic can be exercised hermetically, with no DB and no
// goroutines.
//
// Idempotency is structural: every loop deletes by key, so a second
// call finds nothing and reports zeroes.
func (r *MemoryRepository) ErasePersonalData(_ context.Context, userID string) (ErasedPersonalData, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var receipt ErasedPersonalData

	// Login identities first, so the challenges that hang off them can
	// be matched by identity id as well as by user id (mirrors the
	// postgres order).
	erasedIdentityIDs := make(map[string]struct{})
	for id, li := range r.loginIdentities {
		if li.UserAccountID == userID {
			erasedIdentityIDs[id] = struct{}{}
			delete(r.loginIdentities, id)
			receipt.LoginIdentities++
		}
	}
	for id, c := range r.challenges {
		_, identityErased := erasedIdentityIDs[c.LoginIdentityID]
		if c.UserAccountID != userID && !identityErased {
			continue
		}
		delete(r.challenges, id)
		receipt.LoginChallenges++
	}
	// Sessions before devices, matching identity_sessions_device_fk
	// (ON DELETE RESTRICT) in postgres.
	erasedSessionIDs := make(map[string]struct{})
	for id, s := range r.sessions {
		if s.UserAccountID != userID {
			continue
		}
		erasedSessionIDs[id] = struct{}{}
		delete(r.sessions, id)
		receipt.Sessions++
	}
	for sessionID := range r.tokens {
		if _, ok := erasedSessionIDs[sessionID]; !ok {
			continue
		}
		delete(r.tokens, sessionID)
		receipt.SessionTokens++
	}
	for id, d := range r.devices {
		if d.UserAccountID != userID {
			continue
		}
		delete(r.devices, id)
		receipt.Devices++
	}
	kept := r.memberships[:0]
	for _, m := range r.memberships {
		if m.UserAccountID == userID {
			receipt.Memberships++
			continue
		}
		kept = append(kept, m)
	}
	r.memberships = kept
	if _, ok := r.accountPreferences[userID]; ok {
		delete(r.accountPreferences, userID)
		receipt.AccountPreferences++
	}
	if user, ok := r.users[userID]; ok {
		user.Status = AccountStatusErased
		r.users[userID] = user
		receipt.AccountAnonymised = true
	}
	return receipt, nil
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
var _ PersonalDataEraser = (*MemoryRepository)(nil)

// EraseCrossAggregateIdentity is the in-memory counterpart of the
// Postgres cross-aggregate eraser.
//
// It reports zero for every counter, and that is the correct answer
// rather than a stub: this repository holds the identity aggregate
// only, so it contains no posts, statuses, opportunities, media
// assets, business directory rows or push tokens to scrub. The
// behaviour of the pass is pinned against a real database by
// TestEraseCrossAggregateIdentityScrubsEveryCopy, because a memory
// implementation cannot exercise SQL it does not run.
func (r *MemoryRepository) EraseCrossAggregateIdentity(_ context.Context, userID string) (ErasedCrossAggregate, error) {
	if strings.TrimSpace(userID) == "" {
		return ErasedCrossAggregate{}, errors.New("erase cross-aggregate identity: empty user id")
	}
	return ErasedCrossAggregate{}, nil
}

var _ CrossAggregateEraser = (*MemoryRepository)(nil)

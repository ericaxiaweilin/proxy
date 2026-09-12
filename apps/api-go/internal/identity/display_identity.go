// Package: identity — DisplayIdentity sub-aggregate.
//
// WHAT THIS IS
//   DisplayIdentity is a "persona" that a real Person (UserAccount) can switch
//   into. The motivation comes from the Proxy chat RFC v0.1
//   (docs/design/references/Proxy_Chat_Aligned_With_LotusChat_v0.1.md):
//   a service provider can use a "work" identity with customers and a
//   "private" identity with friends, while the underlying UserAccount — the
//   one that is verified and accountable — stays the same.
//
// COMPLIANCE (COMP-ID-001): personas are a presentation layer, never an
// anonymity layer. Identity verification attaches to the real UserAccount,
// which is the accountable party. A persona must not be usable to erase the
// record of a paid engagement; the self-destruct variant described in the
// RFC is not available to accounts that earn money here.
//
// SCOPE (this file)
//   - Domain types: DisplayIdentity, DisplayIdentityType, VisibilityKind
//   - Errors
//   - The DisplayIdentityRepository contract (separate from Repository so we
//     can swap a PG adapter later without touching the auth surface)
//   - In-memory implementation
//   - Service methods invoked by command handlers (see service.go)
//
// NOT IN THIS FILE
//   - Command envelope handlers (see display_identity_commands.go)
//   - HTTP routes (see apps/api-go/cmd/api — wired in a separate PR)
//   - Outbox event publishing (commands package owns that)
//
// DESIGN INVARIANTS
//   1. One UserAccount can have at most MaxDisplayIdentitiesPerUser (3) active
//      DisplayIdentities. Enforced in CreateDisplayIdentity.
//   2. A DisplayIdentity's OwnerID is immutable.
//   3. A BURNER DisplayIdentity auto-destructs AutoBurnAfter (7 days) after
//      creation. A background sweeper (out of scope here, runs as a worker)
//      marks ExpiredAt. BurnDisplayIdentity also forces immediate destruction
//      of all Conversations where the identity is a participant. The
//      conversation service is the one that actually purges messages; this
//      package only flips the identity's BurnedAt.
//   4. DisplayIdentity.Alias must be unique per OwnerID. Enforced in Create.
//   5. The "real" identity is identified by the UserAccount itself, NOT by a
//      DisplayIdentity. DisplayIdentity is for the OUTSIDE world.
package identity

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
)

// DisplayIdentityType is the lifecycle kind of a persona. See RFC §2.2.
type DisplayIdentityType string

const (
	// DisplayIdentityPublic is a stable "work" persona. The default for new
	// accounts. Visible to anyone who is permitted to find the user.
	DisplayIdentityPublic DisplayIdentityType = "PUBLIC"

	// DisplayIdentityPrivate is a "private" persona visible only to people
	// on the user's known-contact list. Conversation participants added via
	// a non-public identity will not see the user's PUBLIC identity unless
	// the user explicitly bridges.
	DisplayIdentityPrivate DisplayIdentityType = "PRIVATE"

	// DisplayIdentityBurner is a "burner" persona. Auto-destructs
	// BurnerDefaultLifetime after creation. All conversations, messages,
	// and media attached to it are purged on destruction.
	DisplayIdentityBurner DisplayIdentityType = "BURNER"
)

// MaxDisplayIdentitiesPerUser is the hard cap. Tracked in
// docs/design/references/Proxy_Chat_Aligned_With_LotusChat_v0.1.md §10.2
// (open question #1 — answer: 3).
const MaxDisplayIdentitiesPerUser = 3

// BurnerDefaultLifetime is how long a BURNER identity is useful. After this
// point, the next sweeper pass marks it burned.
// docs/design/.../Proxy_Chat_Aligned_With_LotusChat_v0.1.md §10.2 #2 → 7 days.
const BurnerDefaultLifetime = 7 * 24 * time.Hour

// DisplayIdentity is a single persona owned by a real UserAccount.
type DisplayIdentity struct {
	ID            string             `json:"id"`
	OwnerID       string             `json:"ownerId"`
	Type          DisplayIdentityType `json:"type"`
	Alias         string             `json:"alias"`         // user-facing label, e.g. "工作号"
	DisplayName   string             `json:"displayName"`   // what other people see
	AvatarRef     string             `json:"avatarRef,omitempty"`
	CreatedAt     time.Time          `json:"createdAt"`
	ExpiresAt     *time.Time         `json:"expiresAt,omitempty"` // only set for BURNER
	BurnedAt      *time.Time         `json:"burnedAt,omitempty"`
	Version       int                `json:"version"`
}

// IsActive reports whether the identity is still usable. An identity is
// active iff it has not been burned AND (if it has an ExpiresAt) now is
// before ExpiresAt.
func (d DisplayIdentity) IsActive(now time.Time) bool {
	if d.BurnedAt != nil {
		return false
	}
	if d.ExpiresAt != nil && !now.Before(*d.ExpiresAt) {
		return false
	}
	return true
}

// VisibilityFor returns whether the identity is visible to a given viewer
// kind. This is a coarse rule; the conversation service does the fine-grained
// filtering per message origin.
func (d DisplayIdentity) VisibilityFor(viewerKind ViewerKind) bool {
	switch d.Type {
	case DisplayIdentityPublic, DisplayIdentityBurner:
		return true // public-or-burner; visibility is gated by "is the viewer a known contact" elsewhere
	case DisplayIdentityPrivate:
		return viewerKind == ViewerKindSelf || viewerKind == ViewerKindKnownContact
	}
	return false
}

// ViewerKind is a coarse categorization used by DisplayIdentity.VisibilityFor.
type ViewerKind string

const (
	ViewerKindSelf          ViewerKind = "SELF"
	ViewerKindKnownContact  ViewerKind = "KNOWN_CONTACT"
	ViewerKindStranger      ViewerKind = "STRANGER"
)

var (
	ErrDisplayIdentityNotFound  = errors.New("display identity not found")
	ErrDisplayIdentityConflict  = errors.New("display identity conflict")
	ErrDisplayIdentityForbidden = errors.New("display identity access forbidden")
	ErrDisplayIdentityBurned    = errors.New("display identity burned")
	ErrDisplayIdentityCapReached = errors.New("display identity cap reached")
	ErrDisplayIdentityAliasInvalid = errors.New("display identity alias invalid")
)

// DisplayIdentityRepository is the persistence boundary for DisplayIdentity.
// Defined as a separate interface from Repository so the auth/identity code
// stays focused. A Postgres adapter is out of scope for this PR.
type DisplayIdentityRepository interface {
	Create(ctx context.Context, d DisplayIdentity) error
	Get(ctx context.Context, id string) (DisplayIdentity, error)
	GetByOwnerAndAlias(ctx context.Context, ownerID, alias string) (DisplayIdentity, error)
	ListByOwner(ctx context.Context, ownerID string) ([]DisplayIdentity, error)
	Update(ctx context.Context, d DisplayIdentity, expectedVersion int) error
}

// MemoryDisplayIdentityRepository is the in-process implementation. Mirrors
// the locking discipline of MemoryRepository.
type MemoryDisplayIdentityRepository struct {
	mu         sync.Mutex
	identities map[string]DisplayIdentity
	// secondary index for unique alias per owner
	byOwnerAlias map[string]string // "ownerID|alias" -> identityID
}

func NewMemoryDisplayIdentityRepository() *MemoryDisplayIdentityRepository {
	return &MemoryDisplayIdentityRepository{
		identities:   make(map[string]DisplayIdentity),
		byOwnerAlias: make(map[string]string),
	}
}

func (r *MemoryDisplayIdentityRepository) Create(_ context.Context, d DisplayIdentity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.identities[d.ID]; exists {
		return ErrDisplayIdentityConflict
	}
	aliasKey := aliasIndexKey(d.OwnerID, d.Alias)
	if _, exists := r.byOwnerAlias[aliasKey]; exists {
		return ErrDisplayIdentityConflict
	}
	r.identities[d.ID] = cloneDisplayIdentity(d)
	r.byOwnerAlias[aliasKey] = d.ID
	return nil
}

func (r *MemoryDisplayIdentityRepository) Get(_ context.Context, id string) (DisplayIdentity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, exists := r.identities[id]
	if !exists {
		return DisplayIdentity{}, ErrDisplayIdentityNotFound
	}
	return cloneDisplayIdentity(d), nil
}

func (r *MemoryDisplayIdentityRepository) GetByOwnerAndAlias(_ context.Context, ownerID, alias string) (DisplayIdentity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id, exists := r.byOwnerAlias[aliasIndexKey(ownerID, alias)]
	if !exists {
		return DisplayIdentity{}, ErrDisplayIdentityNotFound
	}
	return cloneDisplayIdentity(r.identities[id]), nil
}

func (r *MemoryDisplayIdentityRepository) ListByOwner(_ context.Context, ownerID string) ([]DisplayIdentity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]DisplayIdentity, 0)
	for _, d := range r.identities {
		if d.OwnerID == ownerID {
			result = append(result, cloneDisplayIdentity(d))
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.Before(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryDisplayIdentityRepository) Update(_ context.Context, d DisplayIdentity, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.identities[d.ID]
	if !exists {
		return ErrDisplayIdentityNotFound
	}
	if current.Version != expectedVersion {
		return ErrDisplayIdentityConflict
	}
	// if alias changed, update secondary index
	if current.Alias != d.Alias {
		delete(r.byOwnerAlias, aliasIndexKey(current.OwnerID, current.Alias))
		if _, exists := r.byOwnerAlias[aliasIndexKey(d.OwnerID, d.Alias)]; exists {
			return ErrDisplayIdentityConflict
		}
		r.byOwnerAlias[aliasIndexKey(d.OwnerID, d.Alias)] = d.ID
	}
	d.Version = current.Version + 1
	r.identities[d.ID] = cloneDisplayIdentity(d)
	return nil
}

func aliasIndexKey(ownerID, alias string) string {
	return ownerID + "|" + strings.ToLower(strings.TrimSpace(alias))
}

func cloneDisplayIdentity(d DisplayIdentity) DisplayIdentity {
	out := d
	if d.ExpiresAt != nil {
		t := *d.ExpiresAt
		out.ExpiresAt = &t
	}
	if d.BurnedAt != nil {
		t := *d.BurnedAt
		out.BurnedAt = &t
	}
	return out
}

// DisplayIdentityService is the application-layer facade. Constructed by
// NewDisplayIdentityService so the identity.Service can compose it without
// taking a hard dependency on its internals.
type DisplayIdentityService struct {
	repo DisplayIdentityRepository
	clk  clock.Clock
	now  func() time.Time
}

// NewDisplayIdentityService wires a repo + clock. If repo is nil, an in-memory
// one is used (matches the pattern in identity.Service). If clock is nil,
// clock.System{} is used.
func NewDisplayIdentityService(repo DisplayIdentityRepository, clk clock.Clock) *DisplayIdentityService {
	if repo == nil {
		repo = NewMemoryDisplayIdentityRepository()
	}
	if clk == nil {
		clk = clock.System{}
	}
	return &DisplayIdentityService{
		repo: repo,
		clk:  clk,
		now:  func() time.Time { return clk.Now().UTC() },
	}
}

// ValidateAlias enforces 1..32 chars, no leading/trailing whitespace, and
// forbids a small set of reserved aliases ("real", "default", empty).
func ValidateAlias(alias string) error {
	trimmed := strings.TrimSpace(alias)
	if trimmed == "" {
		return ErrDisplayIdentityAliasInvalid
	}
	if len([]rune(trimmed)) > 32 {
		return ErrDisplayIdentityAliasInvalid
	}
	lower := strings.ToLower(trimmed)
	switch lower {
	case "real", "default", "self", "me":
		return ErrDisplayIdentityAliasInvalid
	}
	return nil
}

// CreateInput is what the command handler passes in. Validation happens
// here, not in the command payload parser, so it is unit-testable.
type CreateInput struct {
	OwnerID     string
	Type        DisplayIdentityType
	Alias       string
	DisplayName string
	AvatarRef   string
}

// Create validates input and persists a new DisplayIdentity.
func (s *DisplayIdentityService) Create(ctx context.Context, in CreateInput) (DisplayIdentity, error) {
	if in.OwnerID == "" {
		return DisplayIdentity{}, ErrDisplayIdentityForbidden
	}
	if err := ValidateAlias(in.Alias); err != nil {
		return DisplayIdentity{}, err
	}
	if strings.TrimSpace(in.DisplayName) == "" {
		return DisplayIdentity{}, ErrDisplayIdentityAliasInvalid
	}
	switch in.Type {
	case DisplayIdentityPublic, DisplayIdentityPrivate, DisplayIdentityBurner:
		// ok
	default:
		return DisplayIdentity{}, ErrDisplayIdentityAliasInvalid
	}

	existing, err := s.repo.ListByOwner(ctx, in.OwnerID)
	if err != nil {
		return DisplayIdentity{}, err
	}
	active := 0
	for _, d := range existing {
		if d.IsActive(s.now()) {
			active++
		}
	}
	if active >= MaxDisplayIdentitiesPerUser {
		return DisplayIdentity{}, ErrDisplayIdentityCapReached
	}

	now := s.now()
	d := DisplayIdentity{
		ID:          newDisplayIdentityID(),
		OwnerID:     in.OwnerID,
		Type:        in.Type,
		Alias:       strings.TrimSpace(in.Alias),
		DisplayName: strings.TrimSpace(in.DisplayName),
		AvatarRef:   in.AvatarRef,
		CreatedAt:   now,
		Version:     1,
	}
	if in.Type == DisplayIdentityBurner {
		exp := now.Add(BurnerDefaultLifetime)
		d.ExpiresAt = &exp
	}
	if err := s.repo.Create(ctx, d); err != nil {
		return DisplayIdentity{}, err
	}
	return d, nil
}

// Get returns a single identity. Authorization is the caller's job: command
// handlers MUST verify the requester owns the identity before calling Get.
func (s *DisplayIdentityService) Get(ctx context.Context, id string) (DisplayIdentity, error) {
	return s.repo.Get(ctx, id)
}

// ListByOwner returns all (active and burned) identities of an owner.
// Sort order: createdAt ASC, matches the in-memory index.
func (s *DisplayIdentityService) ListByOwner(ctx context.Context, ownerID string) ([]DisplayIdentity, error) {
	return s.repo.ListByOwner(ctx, ownerID)
}

// SwitchResult is what a successful switch returns. The caller (mobile
// client) is expected to re-render the entire app shell using this.
type SwitchResult struct {
	Active    DisplayIdentity `json:"active"`
	Available []DisplayIdentity `json:"available"`
}

// ListForSwitch is the read used by the mobile "switch identity" sheet. It
// returns the active identity (or zero value if none) plus the rest.
func (s *DisplayIdentityService) ListForSwitch(ctx context.Context, ownerID string) (SwitchResult, error) {
	all, err := s.repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return SwitchResult{}, err
	}
	now := s.now()
	active := []DisplayIdentity{}
	burned := []DisplayIdentity{}
	for _, d := range all {
		if d.IsActive(now) {
			active = append(active, d)
		} else {
			burned = append(burned, d)
		}
	}
	// sort active: active BURNER first (so users see expiring ones), then by CreatedAt DESC
	sort.Slice(active, func(i, j int) bool {
		if active[i].Type != active[j].Type {
			if active[i].Type == DisplayIdentityBurner {
				return true
			}
			if active[j].Type == DisplayIdentityBurner {
				return false
			}
		}
		return active[i].CreatedAt.After(active[j].CreatedAt)
	})
	if len(active) == 0 {
		return SwitchResult{Available: active}, nil
	}
	// First is the "currently active" candidate. The client tracks which
	// identity is active locally; this just returns the recommended sort.
	return SwitchResult{Active: active[0], Available: active}, nil
}

// BurnInput is the payload for Burn. The actual conversation/message purge
// is the conversation service's responsibility; this only flips BurnedAt
// and (for BURNER) the secondary index.
type BurnInput struct {
	IdentityID string
	OwnerID    string
	Now        time.Time // optional override for tests
}

// Burn marks an identity as destroyed. It returns the (now-burned) identity
// so the caller can fan out a domain event.
func (s *DisplayIdentityService) Burn(ctx context.Context, in BurnInput) (DisplayIdentity, error) {
	if in.IdentityID == "" || in.OwnerID == "" {
		return DisplayIdentity{}, ErrDisplayIdentityForbidden
	}
	d, err := s.repo.Get(ctx, in.IdentityID)
	if err != nil {
		return DisplayIdentity{}, err
	}
	if d.OwnerID != in.OwnerID {
		return DisplayIdentity{}, ErrDisplayIdentityForbidden
	}
	if d.BurnedAt != nil {
		return DisplayIdentity{}, ErrDisplayIdentityBurned
	}
	now := in.Now
	if now.IsZero() {
		now = s.now()
	}
	d.BurnedAt = &now
	if err := s.repo.Update(ctx, d, d.Version); err != nil {
		return DisplayIdentity{}, err
	}
	return d, nil
}

// SweepExpiredBurners is meant to be called by a background worker. It marks
// every BURNER identity past its ExpiresAt as burned. The conversation
// service listens for the domain event and purges. Returns the IDs that
// were burned during this sweep.
func (s *DisplayIdentityService) SweepExpiredBurners(ctx context.Context, ownerIDs []string) ([]string, error) {
	now := s.now()
	burned := make([]string, 0)
	for _, ownerID := range ownerIDs {
		all, err := s.repo.ListByOwner(ctx, ownerID)
		if err != nil {
			return burned, err
		}
		for _, d := range all {
			if d.Type != DisplayIdentityBurner || d.BurnedAt != nil {
				continue
			}
			if d.ExpiresAt == nil || now.Before(*d.ExpiresAt) {
				continue
			}
			d.BurnedAt = &now
			if err := s.repo.Update(ctx, d, d.Version); err != nil {
				return burned, err
			}
			burned = append(burned, d.ID)
		}
	}
	return burned, nil
}

// newDisplayIdentityID is a small helper. Kept private to this file because
// the display-identity ID space is separate from other aggregates. We
// re-use the package-level newID helper for collision resistance.
func newDisplayIdentityID() string {
	return newID("did_")
}

// Package: identity — Profile sub-aggregate.
//
// WHAT THIS IS
//   Profile is the user's home-page identity (display name, handle, bio,
//   city, avatar asset path). One Profile per UserAccount, immutable
//   UserAccountID. Unlike DisplayIdentity, Profile is the REAL identity
//   the user posts under — it is what shows up in feeds, opportunity
//   applicants, conversation message headers, and store publishers.
//
// SCOPE (this file)
//   - Domain types: Profile
//   - ProfileRepository contract
//   - In-memory implementation
//   - Service methods invoked by command handlers (see profile_commands.go)
//
// NOT IN THIS FILE
//   - Command envelope handlers
//   - HTTP routes
//   - Outbox event publishing
//
// DESIGN INVARIANTS
//   1. One UserAccount has at most one Profile row. Upsert is idempotent.
//   2. UserAccountID is immutable (the upsert key).
//   3. avatarPath is constrained to Proxy-internal asset prefixes
//      (ai-personas/ | assets/ | store/ | photo_). External URLs are
//      rejected — same rule as business.StorePhoto.AssetPath.
//   4. handle is the @username used in feeds, and it is UNIQUE
//      CASE-INSENSITIVELY (lower(handle)). Two accounts must never share
//      @linh: a profile QR / invite link is proxy.app/@linh, and the
//      client parser matches it case-insensitively, so @Linh and @linh
//      are the same destination. If two rows could hold it, scanning one
//      person's code could add a different person. Enforced by the
//      repository (ErrProfileHandleTaken) and by a unique index on
//      lower(handle) (migration 078).
//
//      HANDLE-UNIQUE-001: this invariant used to be *claimed here only*.
//      Nothing enforced it — no UNIQUE constraint in 039_profile.sql,
//      no conflict check in either repository — while initialProfileFor
//      derives the handle from the email local-part, so linh@gmail.com
//      and linh@outlook.com reliably collided. Do not weaken this back
//      into a comment.
//   5. Profile is server-authoritative. The mobile client must call
//      UpdateProfile after editing in the modal; local SecureStore
//      is a write-through cache, not the source of truth.
//   6. Site-wide people search (PROFILE-SEARCH-001) matches the NORMALIZED
//      handle and the display name, case-insensitively, and nothing else.
//      Two consequences worth stating out loud:
//        · It is authenticated-only. The command is NOT on the public
//          allowlist (see requiresAuthentication in api/command_dispatch.go),
//          because an anonymous caller could otherwise enumerate accounts.
//        · Phone is deliberately NOT searchable. The Profile row has no phone
//          column and there is no per-user "findable by phone" consent flag,
//          so the add-friend sheet's "手机号" hint would be a promise the data
//          cannot keep. Do not add phone matching until a consent flag exists
//          to gate it — silently matching on a phone we do not store would
//          fail closed, but claiming it works in the UI is the real bug.
//      An empty result is a normal answer, never an error: "nobody matches"
//      and "the search failed" are different truths and must not render the
//      same.

package identity

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
)

const (
	MaxProfileName         = 60
	MaxProfileHandle       = 60
	MaxProfileBio          = 280
	MaxProfileCity         = 60
	MaxProfileAvatarPath   = 4096
)

// Site-wide people search bounds (PROFILE-SEARCH-001).
//
// MinProfileSearchQuery exists because a one-character query matches most of
// the user table: it would let anyone enumerate the whole user base one tap at
// a time, and it answers a question nobody asked. The client already refuses to
// submit below this; the server refuses too, because the client is not the
// authority.
const (
	MinProfileSearchQuery     = 2
	MaxProfileSearchQuery     = 60
	DefaultProfileSearchLimit = 20
	MaxProfileSearchLimit     = 50
)

// Profile is the user-facing identity exposed on the home tab.
type Profile struct {
	UserAccountID string    `json:"userAccountId"`
	Name          string    `json:"name"`
	Handle        string    `json:"handle"`
	Bio           string    `json:"bio"`
	City          string    `json:"city"`
	AvatarPath    string    `json:"avatarPath"`
	Version       int       `json:"version"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func (p Profile) validate() error {
	if len(p.Name) == 0 || len(p.Name) > MaxProfileName {
		return errors.New("invalid profile name length")
	}
	if len(p.Handle) == 0 || len(p.Handle) > MaxProfileHandle {
		return errors.New("invalid profile handle length")
	}
	if len(p.Bio) > MaxProfileBio {
		return errors.New("invalid profile bio length")
	}
	if len(p.City) == 0 || len(p.City) > MaxProfileCity {
		return errors.New("invalid profile city length")
	}
	if p.AvatarPath != "" {
		if len(p.AvatarPath) > MaxProfileAvatarPath {
			return errors.New("invalid profile avatar path length")
		}
		if !isValidProfileAssetPath(p.AvatarPath) {
			return errors.New("invalid profile avatar path prefix")
		}
	}
	return nil
}

// isValidProfileAssetPath: closes the door on free-form text and
// external URLs. Mirrors business.isValidAssetPath so the same
// rule applies wherever user-supplied asset paths enter the
// system.
func isValidProfileAssetPath(p string) bool {
	prefixes := []string{"ai-personas/", "assets/", "store/", "photo_"}
	for _, pre := range prefixes {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}

// NormalizeHandle is the single comparison form for handle uniqueness.
// Stored handles are inconsistent by construction: initialProfileFor writes
// "@linh" while UpdateProfile stores whatever the user typed (with or without
// the leading @). Two rows that differ only by a leading @ or by case are the
// SAME destination for a proxy.app/@linh QR code, so uniqueness must compare
// this normalized form — never the raw string.
func NormalizeHandle(handle string) string {
	return strings.ToLower(strings.TrimLeft(strings.TrimSpace(handle), "@"))
}

// ProfileRepository is the storage contract.
type ProfileRepository interface {
	GetProfile(ctx context.Context, userAccountID string) (Profile, error)
	// GetProfileByHandle resolves a profile by its handle (normalized
	// comparison, see NormalizeHandle). Returns ErrProfileNotFound when no
	// row matches. HANDLE-UNIQUE-001: this is the read half of the handle
	// uniqueness invariant — registration uses it to derive a free handle.
	GetProfileByHandle(ctx context.Context, handle string) (Profile, error)
	// SearchProfiles returns profiles whose normalized handle or display
	// name CONTAINS the query, case-insensitively, ordered by normalized
	// handle, at most limit rows. A query with no matches returns an empty
	// slice and a nil error — never ErrProfileNotFound.
	//
	// PROFILE-SEARCH-001: both stores must agree on the matching rule and on
	// the ordering, or the in-memory tests will pass against semantics that
	// production does not have.
	SearchProfiles(ctx context.Context, query string, limit int) ([]Profile, error)
	UpsertProfile(ctx context.Context, p Profile) (Profile, error)
}

// MemoryProfileRepository is the in-memory implementation.
type MemoryProfileRepository struct {
	mu       sync.Mutex
	profiles map[string]Profile
}

func NewMemoryProfileRepository() *MemoryProfileRepository {
	return &MemoryProfileRepository{profiles: make(map[string]Profile)}
}

func (r *MemoryProfileRepository) GetProfile(_ context.Context, userAccountID string) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.profiles[userAccountID]
	if !ok {
		return Profile{}, ErrProfileNotFound
	}
	return p, nil
}

// GetProfileByHandle mirrors the Postgres read: normalized comparison,
// ErrProfileNotFound when nothing matches.
func (r *MemoryProfileRepository) GetProfileByHandle(_ context.Context, handle string) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	want := NormalizeHandle(handle)
	if want == "" {
		return Profile{}, ErrProfileNotFound
	}
	for _, p := range r.profiles {
		if NormalizeHandle(p.Handle) == want {
			return p, nil
		}
	}
	return Profile{}, ErrProfileNotFound
}

// profileMatchesSearch is the single matching rule, shared with the Postgres
// predicate (strpos over lower(...)). Keeping it in one place is the point: if
// the two stores disagree, the unit tests validate behaviour production does
// not have.
//
// The handle is compared in NORMALIZED form, so "@Linh", "linh" and "LINH" all
// find @linh — a user who copies the @ they see in the UI must not get zero
// results. The name is compared raw-lowered: a display name is not a handle and
// must not be @-stripped.
func profileMatchesSearch(p Profile, needle string) bool {
	if handleNeedle := NormalizeHandle(needle); handleNeedle != "" &&
		strings.Contains(NormalizeHandle(p.Handle), handleNeedle) {
		return true
	}
	return strings.Contains(strings.ToLower(p.Name), needle)
}

// SearchProfiles mirrors the Postgres read — same predicate, same ordering
// (normalized handle), same limit. See the ProfileRepository contract.
func (r *MemoryProfileRepository) SearchProfiles(_ context.Context, query string, limit int) ([]Profile, error) {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" || limit <= 0 {
		return []Profile{}, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Profile, 0, limit)
	for _, p := range r.profiles {
		if profileMatchesSearch(p, needle) {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return NormalizeHandle(out[i].Handle) < NormalizeHandle(out[j].Handle)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *MemoryProfileRepository) UpsertProfile(_ context.Context, p Profile) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// HANDLE-UNIQUE-001: user_account_id is the upsert key, but handle must
	// ALSO stay unique (see invariant 4 at the top of this file). Postgres
	// gets that from a unique index on lower(ltrim(handle,'@')); the
	// in-memory store has to check by hand — otherwise every unit test
	// passes against a store that permits exactly what production rejects,
	// which is how the two implementations drift apart unnoticed.
	want := NormalizeHandle(p.Handle)
	for id, other := range r.profiles {
		if id != p.UserAccountID && NormalizeHandle(other.Handle) == want {
			return Profile{}, ErrProfileHandleTaken
		}
	}
	existing, hadExisting := r.profiles[p.UserAccountID]
	if hadExisting {
		p.Version = existing.Version + 1
	} else {
		p.Version = 1
	}
	r.profiles[p.UserAccountID] = p
	return p, nil
}

// ErrProfileNotFound is returned when no profile exists for a user.
var ErrProfileNotFound = errors.New("profile not found")

// ErrProfileHandleTaken is returned when a DIFFERENT account already holds
// the same handle (normalized comparison, see NormalizeHandle).
//
// HANDLE-UNIQUE-001: callers must give this its own rejection code. Folding
// it into the generic "invalid profile" tells the user their whole profile is
// bad when the only thing wrong is one field they can actually change.
var ErrProfileHandleTaken = errors.New("profile handle already taken")

// AuthorNameResolver adapts the profile store to content publishers
// (localnet posts, socialspace statuses, marketplace opportunities).
// PROFILE-READ-001: publishers must never trust the client-supplied display
// name — the verified account's profile is the single source of truth.
// The boolean reports whether a profile with a non-blank name exists;
// publishers fall back to an empty display (readers show a neutral label)
// when it does not.
type AuthorNameResolver struct {
	service *ProfileService
}

// NewAuthorNameResolver builds the adapter over a ProfileService. A nil
// service yields a resolver that never resolves (legacy unwired callers
// keep their previous behaviour until production wiring sets this).
func NewAuthorNameResolver(service *ProfileService) AuthorNameResolver {
	return AuthorNameResolver{service: service}
}

// ResolveAuthorDisplayName returns the profile name for a user account.
func (r AuthorNameResolver) ResolveAuthorDisplayName(ctx context.Context, userAccountID string) (string, bool) {
	if r.service == nil || strings.TrimSpace(userAccountID) == "" {
		return "", false
	}
	profile, err := r.service.GetProfile(ctx, userAccountID)
	if err != nil {
		return "", false
	}
	name := strings.TrimSpace(profile.Name)
	if name == "" {
		return "", false
	}
	return name, true
}

// initialProfileFor derives a fresh account's home-page identity from the
// verified login identifier that owns it (PROFILE-READ-001). Registration
// binds email / phone but previously created no Profile row, so every new
// account rendered a hardcoded demo identity on the client. Rules mirror
// the mobile deriveProfileFromIdentifier fallback: email local-part becomes
// name/handle, phone identifiers never become a public name (privacy).
func initialProfileFor(userAccountID, channel, identifier string) Profile {
	name := "用户"
	handle := "@user"
	city := "河内"
	identifier = strings.TrimSpace(identifier)
	if identifier != "" {
		if channel == "SMS" || !strings.Contains(identifier, "@") {
			digits := onlyDigits(identifier)
			if len(digits) >= 4 {
				handle = "@user" + digits[len(digits)-4:]
			}
		} else {
			local := strings.TrimSpace(strings.SplitN(identifier, "@", 2)[0])
			if local != "" {
				name = local
			}
			handle = "@" + sanitizeHandle(local)
		}
	}
	return Profile{
		UserAccountID: userAccountID,
		Name:          name,
		Handle:        handle,
		Bio:           "",
		City:          city,
		AvatarPath:    "",
	}
}

func onlyDigits(value string) string {
	var out strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func sanitizeHandle(local string) string {
	var out strings.Builder
	for _, r := range strings.ToLower(local) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' {
			out.WriteRune(r)
		}
	}
	cleaned := strings.TrimLeft(out.String(), ".")
	if len(cleaned) > 30 {
		cleaned = cleaned[:30]
	}
	if cleaned == "" {
		return "user"
	}
	return cleaned
}

// ProfileService is the domain layer that command handlers call.
type ProfileService struct {
	mu     sync.Mutex
	repo   ProfileRepository
	clock  clock.Clock
}

func NewProfileService(repo ProfileRepository, c clock.Clock) *ProfileService {
	if repo == nil {
		repo = NewMemoryProfileRepository()
	}
	if c == nil {
		c = clock.System{}
	}
	return &ProfileService{repo: repo, clock: c}
}

func (s *ProfileService) SetRepository(repo ProfileRepository) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.repo = repo
}

func (s *ProfileService) GetProfile(ctx context.Context, userAccountID string) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repo.GetProfile(ctx, userAccountID)
}

func (s *ProfileService) UpsertProfile(ctx context.Context, p Profile) (Profile, error) {
	if err := p.validate(); err != nil {
		return Profile{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock.Now().UTC()
	p.UpdatedAt = now
	return s.repo.UpsertProfile(ctx, p)
}

// GetProfileByHandle resolves a profile from its handle (normalized
// comparison — see NormalizeHandle).
func (s *ProfileService) GetProfileByHandle(ctx context.Context, handle string) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repo.GetProfileByHandle(ctx, handle)
}

// SearchProfiles is the site-wide people read behind the add-friend search
// sheet (PROFILE-SEARCH-001). The limit is clamped here rather than trusted
// from the payload, so a client asking for 10000 rows still gets at most
// MaxProfileSearchLimit.
func (s *ProfileService) SearchProfiles(ctx context.Context, query string, limit int) ([]Profile, error) {
	if limit <= 0 {
		limit = DefaultProfileSearchLimit
	}
	if limit > MaxProfileSearchLimit {
		limit = MaxProfileSearchLimit
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repo.SearchProfiles(ctx, query, limit)
}

// maxHandleSuffixAttempts bounds the suffix probe in ProvisionInitialProfile.
// The suffix only advances when the handle is genuinely taken, so real
// collisions resolve in one or two rounds; the bound exists so a pathological
// store cannot spin forever.
const maxHandleSuffixAttempts = 20

// ProvisionInitialProfile creates the first profile for a freshly verified
// account, deriving the handle from the login identifier.
//
// HANDLE-UNIQUE-001: handles are unique (invariant 4) and initialProfileFor
// derives them from the email local-part, so the SECOND linh@... to register
// collides. The call site used to discard the upsert error, which meant that
// account "registered successfully" and then had no profile at all — a silent
// half-state. Here we probe and append a numeric suffix until the handle is
// free, the same resolution the unique index would otherwise force on a human.
//
// Never overwrites: the caller invokes this only for accounts that have no
// profile yet, and an explicit UpdateProfile always wins.
func (s *ProfileService) ProvisionInitialProfile(ctx context.Context, userAccountID, channel, identifier string) (Profile, error) {
	base := initialProfileFor(userAccountID, channel, identifier)
	var lastErr error
	for attempt := 1; attempt <= maxHandleSuffixAttempts; attempt++ {
		candidate := base
		if attempt > 1 {
			candidate.Handle = withHandleSuffix(base.Handle, attempt)
		}
		saved, err := s.UpsertProfile(ctx, candidate)
		if err == nil {
			return saved, nil
		}
		if !errors.Is(err, ErrProfileHandleTaken) {
			return Profile{}, err
		}
		lastErr = err
	}
	return Profile{}, lastErr
}

// withHandleSuffix appends a numeric suffix, preserving the leading @ and the
// 30-character budget sanitizeHandle applies to derived handles.
func withHandleSuffix(handle string, n int) string {
	at := ""
	body := handle
	if strings.HasPrefix(body, "@") {
		at = "@"
		body = body[len("@"):]
	}
	suffix := strconv.Itoa(n)
	if keep := 30 - len(suffix); len(body) > keep {
		if keep < 0 {
			keep = 0
		}
		body = body[:keep]
	}
	return at + body + suffix
}

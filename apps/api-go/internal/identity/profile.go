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
//   4. handle is the @username used in feeds; uniqueness is per-tenant
//      (enforced by repository on create; this service layer does not
//      keep a separate uniqueness table).
//   5. Profile is server-authoritative. The mobile client must call
//      UpdateProfile after editing in the modal; local SecureStore
//      is a write-through cache, not the source of truth.

package identity

import (
	"context"
	"errors"
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

// ProfileRepository is the storage contract.
type ProfileRepository interface {
	GetProfile(ctx context.Context, userAccountID string) (Profile, error)
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

func (r *MemoryProfileRepository) UpsertProfile(_ context.Context, p Profile) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
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

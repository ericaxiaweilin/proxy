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
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
)

const (
	MaxProfileName       = 60
	MaxProfileHandle     = 60
	MaxProfileBio        = 280
	MaxProfileCity       = 60
	MaxProfileAvatarPath = 4096
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
	// MaxNearbyProfileLimit（FOR-YOU-CANDIDATES-001）：附近的人是 For You 的候选池，半径
	// 内的人都该能进来；50 封顶时半径内的人一多就按距离被截掉。
	MaxNearbyProfileLimit = 500
	// NearbyCandidateRadiusM（FOR-YOU-CANDIDATES-001）：For You 候选 = 这个半径内的全部人。
	// 用户：「30km 在越南有摩托车属于可接受的距离」。
	NearbyCandidateRadiusM = 30000.0
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
	// AGENT-CLAIM-NUMBER-001: 接单编号。注册时按顺序分配（1 起、无跳号），
	// 0 = 未分配（内存仓/老数据过渡态，客户端按“无编号”处理，不展示）。
	ClaimNumber int `json:"claimNumber"`
	// HOME-RAIL-SERVER-001：坐标与距离。
	//
	// 这两个字段存在的理由是 PERSON-DISTANCE-ZERO-001 —— 没有坐标的人**任何**
	// 「附近」半径都必须排除，所以客户端之前对服务端真人一律没有 distanceM，
	// 结果是「真人推荐」rail 上一个服务端用户都进不来（rail 靠
	// `p.distanceM >= moreDistanceKm * 1000` 过滤，undefined 直接被剔）。
	// 于是 rail 只能退回本地 fixture，界面上永远是那 7 个人。
	//
	// 坐标来自 supply.agent_profiles（那里本来就有地图用的 lat/lng），
	// 距离由服务端按请求方的坐标现算 —— 不写死、不由客户端猜。
	// 指针语义：nil = 未知，**绝不能用 0 表示"就在你脚下"**。
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
	// DistanceM 是服务端算出的距离（米），nil = 无法计算（对方无坐标，或请求方无坐标）。
	DistanceM *float64 `json:"distanceM,omitempty"`

	// HOME-FORYOU-FREE-001：这个人**在请求的那个时段有没有空**。
	//
	// 这三个字段和 DistanceM 是同一类东西，都必须由服务端量、客户端不许猜：
	// 推荐位以前把 `online` 写死成 false、再用 Math.random() 换人，于是
	//「点圆圈换个人」看起来像在挑"有空的人"，其实完全没有依据 ——
	// 和 PERSON-DISTANCE-ZERO-001 造出的 0m 是同一类错误：拿一个和现实无关的
	// 量当承诺。
	//
	// FreeAt 是三态的，所以用指针：
	//   nil  = 没有排期，**未知**（不是"有空"，也不是"没空"）
	//   true = supply.availability_windows 里有一条 AVAILABLE 的窗口盖住了请求时段
	//   false= 有排期但不覆盖请求时段
	//
	// 未知一律当"不表示有空" —— 与距离那条规矩一致：不知道就不能当成满足条件。
	FreeAt    *bool     `json:"freeAt,omitempty"`
	FreeFrom  *time.Time `json:"freeFrom,omitempty"`
	FreeUntil *time.Time `json:"freeUntil,omitempty"`
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
	// ListProfilesNearby returns profiles that have coordinates, ordered by
	// ascending distance from (latitude, longitude), at most limit rows.
	//
	// HOME-RAIL-SERVER-001: this is the read half that lets the home rail show
	// real server users instead of the 7 local fixture people. Distance is
	// computed HERE (haversine in SQL) rather than in the client, because the
	// client cannot know a server user's coordinates at all — which is exactly
	// why PERSON-DISTANCE-ZERO-001 excluded every one of them.
	//
	// maxDistanceM <= 0 means "no radius cap" (still only rows WITH
	// coordinates — a row without them is never a "nearby" hit).
	// A viewer with no coordinates of their own cannot compute anyone's
	// distance: returns an empty slice rather than guessing.
	//
	// slotStart/slotEnd 是"这次想约的时段"。传 nil 表示不判断空闲（调用方只想
	// 要一份附近的名单）。传了就必须真的按 supply.availability_windows 判断 ——
	// 没有排期的人 FreeAt 为 nil（未知），不是 true。
	ListProfilesNearby(ctx context.Context, latitude, longitude float64, maxDistanceM float64, slotStart, slotEnd *time.Time, limit int) ([]Profile, error)
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

// haversineMeters is the one distance formula this repository uses, and the
// Postgres implementation uses the identical haversine expression in SQL.
// They must agree: a row sorted differently by the two stores means the unit
// tests describe behaviour production does not have (same reasoning as
// profileMatchesSearch above).
func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(a))
}

// ProfileLocationWriter（FOR-YOU-CANDIDATES-001）：把本人当前位置写到自己的资料上，
// 供「附近的人」算距离。单独一个小接口，不扩大 ProfileRepository（测试里的假仓不用跟着改）。
type ProfileLocationWriter interface {
	UpdateProfileLocation(ctx context.Context, userAccountID string, latitude, longitude float64) error
}

func (r *MemoryProfileRepository) UpdateProfileLocation(_ context.Context, userAccountID string, latitude, longitude float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.profiles[userAccountID]
	if !ok {
		return ErrProfileNotFound
	}
	lat, lng := latitude, longitude
	p.Latitude, p.Longitude = &lat, &lng
	r.profiles[userAccountID] = p
	return nil
}

// ListProfilesNearby mirrors the Postgres read — haversine, ascending distance,
// same cap semantics. See the ProfileRepository contract.
func (r *MemoryProfileRepository) ListProfilesNearby(_ context.Context, latitude, longitude, maxDistanceM float64, slotStart, slotEnd *time.Time, limit int) ([]Profile, error) {
	if limit <= 0 {
		return []Profile{}, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	type scored struct {
		profile Profile
		meters  float64
	}
	hits := make([]scored, 0, len(r.profiles))
	for _, p := range r.profiles {
		// No coordinates on either side ⇒ no distance can be computed. A row
		// without coordinates is NEVER a "nearby" hit (PERSON-DISTANCE-ZERO-001).
		if p.Latitude == nil || p.Longitude == nil {
			continue
		}
		m := haversineMeters(latitude, longitude, *p.Latitude, *p.Longitude)
		if maxDistanceM > 0 && m >= maxDistanceM {
			continue
		}
		copyProfile := p
		distance := m
		copyProfile.DistanceM = &distance
		// HOME-FORYOU-FREE-001：内存仓没有 availability_windows 表，所以这里
		// 只能判"未知"。**不能**当成 true —— 未知≠有空（与距离同一条规矩）。
		// Postgres 那侧是真的查表。
		if slotStart != nil && slotEnd != nil {
			unknown := false
			copyProfile.FreeAt = &unknown
		}
		hits = append(hits, scored{profile: copyProfile, meters: m})
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].meters < hits[j].meters })
	out := make([]Profile, 0, limit)
	for _, h := range hits {
		if len(out) >= limit {
			break
		}
		out = append(out, h.profile)
	}
	return out, nil
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

// ResolveAuthorBio 返回用户的主页简介（AI-MANAGE-008：代回复以本人身份说话时要知道 TA 是谁）。
func (r AuthorNameResolver) ResolveAuthorBio(ctx context.Context, userAccountID string) (string, bool) {
	if r.service == nil || strings.TrimSpace(userAccountID) == "" {
		return "", false
	}
	profile, err := r.service.GetProfile(ctx, userAccountID)
	if err != nil {
		return "", false
	}
	return profile.Bio, strings.TrimSpace(profile.Bio) != ""
}

// ResolveAuthorAvatarPath returns identity.profiles.avatar_path for a user
// account (TWIN-INSIGHT-AVATAR-001). Same shape as the display-name resolver:
// miss → false so callers keep their initial-letter fallback instead of
// emitting a broken media URL.
func (r AuthorNameResolver) ResolveAuthorAvatarPath(ctx context.Context, userAccountID string) (string, bool) {
	if r.service == nil || strings.TrimSpace(userAccountID) == "" {
		return "", false
	}
	profile, err := r.service.GetProfile(ctx, userAccountID)
	if err != nil {
		return "", false
	}
	path := strings.TrimSpace(profile.AvatarPath)
	if path == "" {
		return "", false
	}
	return path, true
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
	mu    sync.Mutex
	repo  ProfileRepository
	clock clock.Clock
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

// ErrProfileLocationUnsupported：仓储不支持写位置（不该发生在生产配置里）。
var ErrProfileLocationUnsupported = errors.New("profile location not supported by this repository")

// UpdateMyLocation 写本人位置（只能写自己的）。坐标范围由调用方校验。
func (s *ProfileService) UpdateMyLocation(ctx context.Context, userAccountID string, latitude, longitude float64) error {
	writer, ok := s.repo.(ProfileLocationWriter)
	if !ok {
		return ErrProfileLocationUnsupported
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return writer.UpdateProfileLocation(ctx, userAccountID, latitude, longitude)
}

// ListProfilesNearby is the ProfileService half of the home-rail read
// (HOME-RAIL-SERVER-001). The limit is clamped the same way SearchProfiles
// clamps, so the rail cannot ask for an unbounded page.
func (s *ProfileService) ListProfilesNearby(ctx context.Context, latitude, longitude, maxDistanceM float64, slotStart, slotEnd *time.Time, limit int) ([]Profile, error) {
	if limit <= 0 {
		limit = DefaultProfileSearchLimit
	}
	if limit > MaxNearbyProfileLimit {
		limit = MaxNearbyProfileLimit
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.repo.ListProfilesNearby(ctx, latitude, longitude, maxDistanceM, slotStart, slotEnd, limit)
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

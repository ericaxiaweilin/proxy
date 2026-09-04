// Package jurisdiction owns the lookup of "what set of laws
// applies to this user". Vietnam 91/2025/QH15 (PDP),
// 122/2025/QH15 (E-commerce), 134/2025/QH15 (AI),
// 116/2025/QH15 (Cybersecurity), 248/2026/ND-CP and the AI
// labeling rules in 333/2026/ND-CP are the regulatory
// families that proxy.vn has to thread today. They differ
// between the launch regions:
//
//   * VN-HN  (Hanoi)         — pilot region
//   * VN-79  (Ho Chi Minh)   — proxy.vn HQ, default fallback
//   * VN-DNG (Da Nang)       — expansion
//
// A USER_PAID_SERVICE Order in VN-HN at 2026-09-04 carries
// one (terms-1.1, privacy-1.1, jurisdiction=VN-HN) tuple.
// The same order created by a user whose jurisdiction has
// since been updated to KR-11 (Seoul) carries a different
// tuple. This is the LC-28 mechanism: the policy decision is
// stamped at Order confirm time with the user's
// *then-current* jurisdiction, and any future Material
// Change (LC-30) re-evaluates with the *new* jurisdiction.
//
// Why this lives in its own package:
//   - The same lookup is used by the policy decision
//     service (LC-28 / LC-30), the kill switch snapshot
//     (LC-16), the privacy request center (LC-15), and the
//     AI media label gate (LC-06 / LC-07).
//   - The decision row stores a `jurisdiction` column
//     pointing back to the user's current record, so the
//     audit log is recoverable without a cross-service join.
//   - A user's jurisdiction can be updated by an operator
//     after a regulator-issued rule change, by a settings
//     change, or by a successful appeal; the cache is
//     short-lived (5 minutes in production) so the new
//     jurisdiction is picked up at the next policy
//     evaluation.
package jurisdiction

import (
	"context"
	"errors"
	"strings"
	"time"
)

// Country is the ISO 3166-1 alpha-2 country code. Adding a
// new country here is the only way to onboard a new market;
// the migration that adds the corresponding CHECK
// constraint is a separate decision.
type Country string

const (
	CountryVietnam Country = "VN"
)

// Region is the in-country region. Vietnam has 63
// provinces; for the launch we support three. Korea and
// Singapore are not in the launch set, so they are not in
// the closed enum — they would arrive in a later phase
// after a Vietnamese-resident pilot proves out the gate.
type Region string

const (
	RegionHanoi      Region = "HN"
	RegionHCMCity    Region = "79"
	RegionDaNang     Region = "DNG"
)

// AllowedRegions is the closed set the wire layer accepts.
var AllowedRegions = []Region{
	RegionHanoi,
	RegionHCMCity,
	RegionDaNang,
}

// NormalizeRegion guards against case / whitespace drift.
func NormalizeRegion(s string) (Region, error) {
	upper := strings.ToUpper(strings.TrimSpace(s))
	for _, r := range AllowedRegions {
		if string(r) == upper {
			return r, nil
		}
	}
	return "", errors.New("unknown region: " + s)
}

// Jurisdiction is the canonical (Country, Region) pair.
// The wire format is "VN-79" (country + "-" + region).
type Jurisdiction struct {
	Country Country `json:"country"`
	Region  Region  `json:"region"`
}

// String returns the canonical wire form. Stable for use
// in the policy decision table's jurisdiction column.
func (j Jurisdiction) String() string {
	return string(j.Country) + "-" + string(j.Region)
}

// ParseJurisdiction parses a wire string like "VN-79" into
// a Jurisdiction. Returns an error if the country or
// region is unknown.
func ParseJurisdiction(s string) (Jurisdiction, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Jurisdiction{}, errors.New("invalid jurisdiction: too short: " + s)
	}
	idx := strings.Index(s, "-")
	if idx < 0 {
		return Jurisdiction{}, errors.New("invalid jurisdiction: missing '-': " + s)
	}
	if idx == 0 || idx == len(s)-1 {
		return Jurisdiction{}, errors.New("invalid jurisdiction: empty country or region: " + s)
	}
	country := Country(strings.ToUpper(s[:idx]))
	regionStr := strings.ToUpper(s[idx+1:])
	if country != CountryVietnam {
		return Jurisdiction{}, errors.New("unsupported country: " + s)
	}
	region, err := NormalizeRegion(regionStr)
	if err != nil {
		return Jurisdiction{}, err
	}
	return Jurisdiction{Country: country, Region: region}, nil
}

// DefaultJurisdiction is the fallback when a user has no
// stored jurisdiction. proxy.vn's HQ is Ho Chi Minh City,
// so VN-79 is the safe default. The fall-back is a
// Vietnam-resident pilot assumption that holds for the
// 2026-09 launch.
var DefaultJurisdiction = Jurisdiction{
	Country: CountryVietnam,
	Region:  RegionHCMCity,
}

// UserJurisdiction is the per-user row. CreatedAt is the
// registration time; UpdatedAt is the last operator or
// self-service change.
type UserJurisdiction struct {
	UserID       string      `json:"userId"`
	Jurisdiction Jurisdiction `json:"jurisdiction"`
	UpdatedAt    time.Time   `json:"updatedAt"`
	// Source: how the row got its current value.
	// "DEFAULT"     — at registration, defaulted to VN-79.
	// "USER_SELF"   — the user changed it via the
	//                 /v1/identity/jurisdiction endpoint.
	// "OPERATOR"    — an operator updated it (e.g. on a
	//                 regulator-issued reclassification).
	// "GEOLOCATION" — inferred from the user's last
	//                 consent-granted location. The
	//                 inference runs at registration time
	//                 and on subsequent location-consent
	//                 grants.
	Source string `json:"source"`
}

// ErrNotFound is returned by Repository.Get when the user
// has no stored jurisdiction row.
var ErrNotFound = errors.New("jurisdiction not set")

// Repository is the storage contract. The in-memory
// implementation lives in memory.go; the Postgres
// implementation is a follow-up (the migration that adds
// the user_jurisdiction table is part of this commit).
type Repository interface {
	Get(ctx context.Context, userID string) (*UserJurisdiction, error)
	Upsert(ctx context.Context, row UserJurisdiction) error
}

// Service is the entry point. It is wired into
// policydecisions, the kill switch snapshot, the privacy
// request center, and the AI media label gate.
type Service struct {
	repo    Repository
	nowFunc func() time.Time
	// defaultJurisdiction is what we fall back to when a
	// user has no row. Defaults to DefaultJurisdiction.
	defaultJurisdiction Jurisdiction
}

func NewService(repo Repository) *Service {
	return &Service{
		repo:                repo,
		nowFunc:             time.Now,
		defaultJurisdiction: DefaultJurisdiction,
	}
}

func (s *Service) SetNowFunc(f func() time.Time) { s.nowFunc = f }

func (s *Service) SetDefault(j Jurisdiction) {
	s.defaultJurisdiction = j
}

func (s *Service) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

// Resolve returns the user's current jurisdiction. When
// the user has no row, the service falls back to the
// configured default. The Source field is "DEFAULT" in
// that case so the caller can distinguish "the user
// explicitly chose X" from "we don't know what they chose".
func (s *Service) Resolve(ctx context.Context, userID string) (UserJurisdiction, error) {
	if strings.TrimSpace(userID) == "" {
		return UserJurisdiction{}, errors.New("jurisdiction: userID is required")
	}
	row, err := s.repo.Get(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return UserJurisdiction{
			UserID:       userID,
			Jurisdiction: s.defaultJurisdiction,
			UpdatedAt:    s.now().UTC(),
			Source:       "DEFAULT",
		}, nil
	}
	if err != nil {
		return UserJurisdiction{}, err
	}
	return *row, nil
}

// Set updates the user's jurisdiction. The caller (HTTP
// handler or operator command) decides whether the user
// is allowed to change this row. Production rule of
// thumb: a user can change their own jurisdiction once
// per 24 hours; an operator can change it any time. The
// 24h rule is enforced by the caller; this method just
// writes.
func (s *Service) Set(ctx context.Context, userID string, j Jurisdiction, source string) error {
	if strings.TrimSpace(userID) == "" {
		return errors.New("jurisdiction: userID is required")
	}
	if j.Country == "" {
		return errors.New("jurisdiction: country is required")
	}
	// Re-validate the region. ParseJurisdiction is more
	// strict than the wire layer's normalization, but it is
	// also a safer check at the storage boundary.
	if _, err := NormalizeRegion(string(j.Region)); err != nil {
		return err
	}
	row := UserJurisdiction{
		UserID:       userID,
		Jurisdiction: j,
		UpdatedAt:    s.now().UTC(),
		Source:       source,
	}
	return s.repo.Upsert(ctx, row)
}

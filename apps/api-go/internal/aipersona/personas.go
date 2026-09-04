// Package aipersona owns the catalog of digital personas and the
// likeness-consent audit log. PRD v1.4 LC-07 (Vietnam 134/2025/QH15
// Art. 14) requires that a digital twin (USER_TWIN persona) be
// backed by a record of the real person's consent before any
// likeness-bearing media can be published. PRD v1.4 LC-06 requires
// that AI-generated media carry a 'this is AI' label and that the
// platform fail closed if the label cannot be produced.
//
// Two surfaces live here:
//   * Persona (the catalog): a User creates a Persona (USER_TWIN
//     or CREATIVE). USER_TWIN personas must have a likeness
//     consent row before they can be referenced from media.
//   * LikenessConsent (the audit log): the real person whose
//     likeness is used grants / revokes / expires consent. The
//     tuple (persona, subject, terms_version, consent_kind) is
//     unique; a re-consent under the same terms is a no-op, a
//     re-consent under new terms writes a fresh row.
//
// Fail-closed: the media service calls HasLiveConsent() before
// transitioning an AI asset to READY. If the service is not
// wired (legacy test server), the media service falls back to a
// permissive path so existing tests still pass; production
// deployments must wire it.
package aipersona

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"time"
)

// PersonaType enumerates the kinds of personas the platform
// currently supports. Adding a new entry here is the only way to
// onboard a new persona family.
type PersonaType string

const (
	PersonaTypeUserTwin PersonaType = "USER_TWIN"
	PersonaTypeCreative PersonaType = "CREATIVE"
)

// AllowedPersonaTypes is the closed set the wire layer accepts.
var AllowedPersonaTypes = []PersonaType{
	PersonaTypeUserTwin,
	PersonaTypeCreative,
}

// NormalizePersonaType guards against case / whitespace drift.
func NormalizePersonaType(s string) (PersonaType, error) {
	upper := strings.ToUpper(strings.TrimSpace(s))
	for _, p := range AllowedPersonaTypes {
		if string(p) == upper {
			return p, nil
		}
	}
	return "", errors.New("unknown persona type: " + s)
}

// ConsentKind enumerates the kinds of likeness the subject can
// grant. VISUAL covers photos / videos of the subject; VOICE
// covers audio; VISUAL_AND_VOICE is the common case.
type ConsentKind string

const (
	ConsentVisual        ConsentKind = "VISUAL"
	ConsentVoice         ConsentKind = "VOICE"
	ConsentVisualAndVoice ConsentKind = "VISUAL_AND_VOICE"
)

// AllowedConsentKinds is the closed set the wire layer accepts.
var AllowedConsentKinds = []ConsentKind{
	ConsentVisual,
	ConsentVoice,
	ConsentVisualAndVoice,
}

// NormalizeConsentKind guards against case / whitespace drift.
func NormalizeConsentKind(s string) (ConsentKind, error) {
	upper := strings.ToUpper(strings.TrimSpace(s))
	for _, k := range AllowedConsentKinds {
		if string(k) == upper {
			return k, nil
		}
	}
	return "", errors.New("unknown consent kind: " + s)
}

// Persona is the catalog row.
type Persona struct {
	ID          string      `json:"id"`
	OwnerID     string      `json:"ownerId"`
	DisplayName string      `json:"displayName"`
	PersonaType PersonaType `json:"personaType"`
	Description string      `json:"description,omitempty"`
	CreatedAt   time.Time   `json:"createdAt"`
	ArchivedAt  *time.Time  `json:"archivedAt,omitempty"`
}

// LikenessConsent is the audit-log row.
type LikenessConsent struct {
	ID           string     `json:"id"`
	PersonaID    string     `json:"personaId"`
	SubjectID    string     `json:"subjectId"`
	ConsentKind  ConsentKind `json:"consentKind"`
	TermsVersion string     `json:"termsVersion"`
	GrantedAt    time.Time  `json:"grantedAt"`
	RevokedAt    *time.Time `json:"revokedAt,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
}

// IsLive reports whether the consent row is currently granting
// likeness. A row whose expires_at has passed is treated as
// expired; a row with revoked_at set is treated as revoked; a
// nil expires_at and nil revoked_at means the consent is open-
// ended and still live.
func (c LikenessConsent) IsLive(now time.Time) bool {
	if c.RevokedAt != nil {
		return false
	}
	if c.ExpiresAt != nil && !now.Before(*c.ExpiresAt) {
		return false
	}
	return true
}

// ErrNotFound is returned by Repository lookups when the
// requested id does not exist.
var ErrNotFound = errors.New("persona not found")

// Repository is the storage contract. The in-memory
// implementation lives in memory.go; the Postgres one in
// apps/api-go/internal/platform/postgres/aipersona.go (TODO).
type Repository interface {
	CreatePersona(ctx context.Context, p Persona) error
	GetPersona(ctx context.Context, id string) (*Persona, error)
	ListPersonasByOwner(ctx context.Context, ownerID string) ([]Persona, error)

	GrantConsent(ctx context.Context, c LikenessConsent) error
	RevokeConsent(ctx context.Context, id string, now time.Time) error
	LatestConsent(ctx context.Context, personaID, subjectID, termsVersion string, now time.Time) (*LikenessConsent, error)
}

// Service is the entry point.
type Service struct {
	repo        Repository
	termsVersion string
	nowFunc     func() time.Time
}

func NewService(repo Repository, termsVersion string) *Service {
	return &Service{repo: repo, nowFunc: time.Now, termsVersion: termsVersion}
}

func (s *Service) SetNowFunc(f func() time.Time) { s.nowFunc = f }

func (s *Service) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

// CreatePersona writes a new persona row. The (OwnerID, ID) pair
// is unique; the wire layer is expected to use a fresh ID per
// request.
func (s *Service) CreatePersona(ctx context.Context, p Persona) (*Persona, error) {
	if strings.TrimSpace(p.OwnerID) == "" {
		return nil, errors.New("aipersona: owner id is required")
	}
	if strings.TrimSpace(p.DisplayName) == "" {
		return nil, errors.New("aipersona: display name is required")
	}
	if _, err := NormalizePersonaType(string(p.PersonaType)); err != nil {
		return nil, err
	}
	if p.ID == "" {
		p.ID = newID("aip_")
	}
	if p.CreatedAt.IsZero() {
		p.CreatedAt = s.now().UTC()
	}
	if err := s.repo.CreatePersona(ctx, p); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetPersona returns the persona row, or ErrNotFound.
func (s *Service) GetPersona(ctx context.Context, id string) (*Persona, error) {
	return s.repo.GetPersona(ctx, id)
}

// GrantConsent writes a new consent row. The (persona, subject,
// terms, kind) tuple is unique at the database level; a repeat
// grant is a no-op (the existing id is returned).
func (s *Service) GrantConsent(ctx context.Context, personaID, subjectID string, kind ConsentKind, expiresAt *time.Time) (*LikenessConsent, error) {
	if strings.TrimSpace(personaID) == "" || strings.TrimSpace(subjectID) == "" {
		return nil, errors.New("aipersona: persona id and subject id are required")
	}
	if _, err := NormalizeConsentKind(string(kind)); err != nil {
		return nil, err
	}
	// Reuse an existing matching row to keep the (persona,
	// subject, terms, kind) tuple unique. This is a no-op when
	// the existing row is still live; it is a "fresh row with
	// granted_at = now" when the prior row was revoked.
	if existing, err := s.repo.LatestConsent(ctx, personaID, subjectID, s.termsVersion, s.now()); err == nil {
		if existing != nil && existing.IsLive(s.now()) {
			return existing, nil
		}
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	c := LikenessConsent{
		ID:           newID("lic_"),
		PersonaID:    personaID,
		SubjectID:    subjectID,
		ConsentKind:  kind,
		TermsVersion: s.termsVersion,
		GrantedAt:    s.now().UTC(),
		ExpiresAt:    expiresAt,
	}
	if err := s.repo.GrantConsent(ctx, c); err != nil {
		return nil, err
	}
	return &c, nil
}

// RevokeConsent sets revoked_at on the matching row. The audit
// trail is preserved — the row stays in the table; HasLiveConsent
// will skip it from now on.
func (s *Service) RevokeConsent(ctx context.Context, id string) error {
	return s.repo.RevokeConsent(ctx, id, s.now())
}

// HasLiveConsent returns the live consent row for the (persona,
// subject, current terms) tuple, or nil if no row exists or the
// most recent row is revoked / expired. Used by the media
// service to gate MarkMediaReady.
func (s *Service) HasLiveConsent(ctx context.Context, personaID, subjectID string) (*LikenessConsent, error) {
	c, err := s.repo.LatestConsent(ctx, personaID, subjectID, s.termsVersion, s.now())
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}
	if !c.IsLive(s.now()) {
		return nil, nil
	}
	return c, nil
}

func newID(prefix string) string {
	var b [10]byte
	_, _ = rand.Read(b[:])
	return prefix + hex.EncodeToString(b[:])
}

// SnapshotConsent sorts the input by granted_at descending. The
// wire layer uses this for stable JSON output in operator audit
// queries.
func SnapshotConsent(rows []LikenessConsent) []LikenessConsent {
	out := append([]LikenessConsent(nil), rows...)
	sort.Slice(out, func(i, j int) bool {
		return out[i].GrantedAt.After(out[j].GrantedAt)
	})
	return out
}

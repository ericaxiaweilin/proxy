package aipersona

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MemoryRepository is the in-memory implementation of
// Repository. Used by tests and the dev server (the Postgres
// implementation is a follow-up; the migration 066 schema
// provides the SQL surface).
type MemoryRepository struct {
	mu       sync.Mutex
	personas map[string]Persona
	consents map[string]LikenessConsent
	// seq orders consent inserts. LatestConsent must break GrantedAt
	// ties by insertion order: two grants in the same clock tick have
	// equal GrantedAt, and Go map iteration is random, so "max
	// GrantedAt" alone returns either row — TestReconsentAfterRevoke
	// then flakes under full-suite load. (FLAKE-CONSENT-001)
	seq          uint64
	consentOrder map[string]uint64
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		personas:     map[string]Persona{},
		consents:     map[string]LikenessConsent{},
		consentOrder: map[string]uint64{},
	}
}

func (r *MemoryRepository) CreatePersona(_ context.Context, p Persona) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.personas[p.ID]; exists {
		return nil
	}
	r.personas[p.ID] = p
	return nil
}

func (r *MemoryRepository) GetPersona(_ context.Context, id string) (*Persona, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.personas[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := p
	return &cp, nil
}

func (r *MemoryRepository) ListPersonasByOwner(_ context.Context, ownerID string) ([]Persona, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Persona{}
	for _, p := range r.personas {
		if p.OwnerID == ownerID {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (r *MemoryRepository) GrantConsent(_ context.Context, c LikenessConsent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.consents[c.ID]; exists {
		return nil
	}
	r.consents[c.ID] = c
	r.seq++
	r.consentOrder[c.ID] = r.seq
	return nil
}

func (r *MemoryRepository) RevokeConsent(_ context.Context, id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.consents[id]
	if !ok {
		return ErrNotFound
	}
	c.RevokedAt = &now
	r.consents[id] = c
	return nil
}

// LatestConsent returns the most recent consent row for the
// (persona, subject, terms_version) tuple, regardless of
// revoked/expired status. The caller (Service.HasLiveConsent)
// decides whether the row is live.
func (r *MemoryRepository) LatestConsent(_ context.Context, personaID, subjectID, termsVersion string, _ time.Time) (*LikenessConsent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var latest *LikenessConsent
	for _, c := range r.consents {
		if c.PersonaID == personaID && c.SubjectID == subjectID && c.TermsVersion == termsVersion {
			cc := c
			if latest == nil || cc.GrantedAt.After(latest.GrantedAt) ||
				(cc.GrantedAt.Equal(latest.GrantedAt) && r.consentOrder[cc.ID] > r.consentOrder[latest.ID]) {
				latest = &cc
			}
		}
	}
	if latest == nil {
		return nil, ErrNotFound
	}
	return latest, nil
}

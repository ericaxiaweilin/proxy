// Package emergency owns the user's own safety net: a short list of
// emergency contacts and an append-only log of emergency events.
//
// Two design rules are load-bearing here, and both exist because the
// alternative would be a false promise:
//
//  1. **Precise coordinates never reach the database.** The client
//     sends the fix it has; this package coarsens it to a ~1 km grid
//     and the caller persists only the coarse point plus the error it
//     is guaranteed to carry. Coarsening happens BEFORE the write, not
//     at read time, so there is no query that can recover the exact
//     fix. See Coarsen.
//
//  2. **Nothing here claims delivery.** There is no push provider and
//     no SMS gateway for arbitrary recipients in this system (only
//     login OTP has an SMS path). So an event records what we actually
//     did — opened the OS dialer, handed a pre-filled message to the
//     user's own SMS app — and never records that a contact "was
//     notified". The field names say hand-off, not delivery.
//
// Vietnam PDP 91/2025/QH15 treats both the contact's phone number
// (a third party's personal data) and the reporter's location
// (sensitive personal data) as protected. We record the user's
// *assertion* that they have the contact's permission rather than
// pretending to verify it.
package emergency

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// MaxContacts is the product cap. It is also enforced in the database
// (uniq_emergency_contact_priority + the priority CHECK), so a buggy
// client cannot quietly exceed it.
const MaxContacts = 3

// GridStepDegrees is the coarsening grid: 0.01° of latitude is ~1.11 km.
const GridStepDegrees = 0.01

// e164 matches the DB CHECK on safety.emergency_contacts.phone.
var e164 = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)

var (
	// ErrTooManyContacts is returned when the cap is already reached.
	ErrTooManyContacts = errors.New("emergency contact limit reached")
	// ErrContactNotFound is returned when an id does not belong to the user.
	ErrContactNotFound = errors.New("emergency contact not found")
	// ErrInvalidContact is returned for a malformed name/phone/priority.
	ErrInvalidContact = errors.New("invalid emergency contact")
	// ErrNoLocationConsent is returned by RecordEvent when the user holds
	// no active location consent, so not even a coarse point may be stored.
	ErrNoLocationConsent = errors.New("no active location consent")
)

// Contact is one entry in the user's emergency list.
//
// PermissionAttestedAt records when the user told us they have this
// person's permission to be listed. We cannot verify that, so we store
// the assertion and the time it was made instead of a "verified" flag.
type Contact struct {
	ID                   string
	UserID               string
	DisplayName          string
	Phone                string
	Relation             string
	Priority             int
	PermissionAttestedAt time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// EventKind enumerates what happened. Only two values exist because
// only two flows are real.
type EventKind string

const (
	// EventKindSOS is the one-tap request for help.
	EventKindSOS EventKind = "SOS"
	// EventKindMeetupCheckin is the "I am meeting someone" safety check.
	EventKindMeetupCheckin EventKind = "MEETUP_CHECKIN"
)

// AllEventKinds mirrors the DB CHECK on safety.emergency_events.kind.
var AllEventKinds = []EventKind{EventKindSOS, EventKindMeetupCheckin}

// Event is one append-only record. It is never updated or deleted.
type Event struct {
	ID         string
	UserID     string
	Kind       EventKind
	OccurredAt time.Time
	CoarseLat  *float64
	CoarseLng  *float64
	// CoarsePrecisionM is the guaranteed maximum error of the stored
	// point, in metres. A reader can therefore tell "deliberately
	// coarsened by N m" from "no location at all" (nil coordinates).
	CoarsePrecisionM *int
	ContactIDs       []string
	// DialerOpened / DialedNumber / SMSHandoffCount describe what the
	// app handed to the OS. They are NOT delivery receipts.
	DialerOpened    bool
	DialedNumber    string
	SMSHandoffCount int
	Note            string
	CreatedAt       time.Time
}

// Coarse is a grid-rounded point plus the error it carries.
type Coarse struct {
	Lat        float64
	Lng        float64
	PrecisionM int
}

// Coarsen snaps a fix to the grid and reports the worst-case error.
//
// The returned precision is the half-cell DIAGONAL, not the cell size:
// a point anywhere in a 0.01° cell is at most half a cell away on each
// axis, so the true location can differ from the stored one by up to
// hypot(latHalf, lngHalf). Reporting the cell size instead would
// understate the error by up to ~40%, which for a safety feature is
// the wrong direction to be wrong in. The value is rounded up to the
// nearest 10 m so it never reads as more precise than it is.
func Coarsen(lat, lng float64) Coarse {
	half := GridStepDegrees / 2
	// One degree of latitude is ~111.32 km everywhere; one degree of
	// longitude shrinks with cos(latitude).
	latHalfM := 111320.0 * half
	lngHalfM := 111320.0 * math.Cos(lat*math.Pi/180) * half
	errM := math.Hypot(latHalfM, lngHalfM)
	precision := int(math.Ceil(errM/10.0)) * 10
	if precision < 10 {
		precision = 10
	}
	return Coarse{
		Lat:        roundTo(lat, 2),
		Lng:        roundTo(lng, 2),
		PrecisionM: precision,
	}
}

func roundTo(v float64, decimals int) float64 {
	factor := math.Pow(10, float64(decimals))
	return math.Round(v*factor) / factor
}

// ValidatePhone accepts E.164 only. A number that cannot be dialled is
// worse than no number: the user would believe someone is reachable.
func ValidatePhone(phone string) error {
	if !e164.MatchString(strings.TrimSpace(phone)) {
		return fmt.Errorf("%w: phone must be E.164 (e.g. +84912345678)", ErrInvalidContact)
	}
	return nil
}

// ValidateContact checks the user-supplied fields. Priority must be
// 1..MaxContacts.
func ValidateContact(c Contact) error {
	name := strings.TrimSpace(c.DisplayName)
	if name == "" || len([]rune(name)) > 60 {
		return fmt.Errorf("%w: displayName must be 1..60 characters", ErrInvalidContact)
	}
	if err := ValidatePhone(c.Phone); err != nil {
		return err
	}
	if len([]rune(c.Relation)) > 40 {
		return fmt.Errorf("%w: relation must be at most 40 characters", ErrInvalidContact)
	}
	if c.Priority < 1 || c.Priority > MaxContacts {
		return fmt.Errorf("%w: priority must be 1..%d", ErrInvalidContact, MaxContacts)
	}
	return nil
}

// ValidateEvent checks an event before it is appended.
func ValidateEvent(e Event) error {
	valid := false
	for _, k := range AllEventKinds {
		if e.Kind == k {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid emergency event kind: %q", e.Kind)
	}
	if (e.CoarseLat == nil) != (e.CoarseLng == nil) {
		return errors.New("coarse coordinates must be both present or both absent")
	}
	if e.CoarseLat != nil && (*e.CoarseLat < -90 || *e.CoarseLat > 90) {
		return errors.New("coarse latitude out of range")
	}
	if e.CoarseLng != nil && (*e.CoarseLng < -180 || *e.CoarseLng > 180) {
		return errors.New("coarse longitude out of range")
	}
	if len([]rune(e.Note)) > 280 {
		return errors.New("note must be at most 280 characters")
	}
	if e.SMSHandoffCount < 0 {
		return errors.New("smsHandoffCount must not be negative")
	}
	return nil
}

// Repository is the storage contract. The in-memory implementation
// below is used by tests; the Postgres implementation in
// internal/platform/postgres mirrors the same shape.
type Repository interface {
	ListContacts(ctx context.Context, userID string) ([]*Contact, error)
	// UpsertContact inserts when ID is empty, otherwise updates the
	// caller's own row. It must reject a 4th contact.
	UpsertContact(ctx context.Context, c *Contact, now time.Time) (*Contact, error)
	// DeleteContact soft-deletes by id, scoped to userID.
	DeleteContact(ctx context.Context, userID, contactID string, now time.Time) (bool, error)
	AppendEvent(ctx context.Context, e *Event) (*Event, error)
	ListEvents(ctx context.Context, userID string, limit int) ([]*Event, error)
}

// MemoryRepository is an in-process Repository for tests.
type MemoryRepository struct {
	contacts []*Contact
	events   []*Event
	seq      int
}

// NewMemoryRepository returns an empty in-memory store.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{}
}

func (m *MemoryRepository) nextID(prefix string) string {
	m.seq++
	return fmt.Sprintf("%s_%04d", prefix, m.seq)
}

func (m *MemoryRepository) ListContacts(_ context.Context, userID string) ([]*Contact, error) {
	out := make([]*Contact, 0, len(m.contacts))
	for _, c := range m.contacts {
		if c.UserID == userID {
			out = append(out, c)
		}
	}
	sortByPriority(out)
	return out, nil
}

func (m *MemoryRepository) UpsertContact(_ context.Context, c *Contact, now time.Time) (*Contact, error) {
	if c.ID == "" {
		live := 0
		for _, existing := range m.contacts {
			if existing.UserID == c.UserID {
				live++
			}
		}
		if live >= MaxContacts {
			return nil, ErrTooManyContacts
		}
		stored := *c
		stored.ID = m.nextID("ec")
		stored.CreatedAt = now
		stored.UpdatedAt = now
		m.contacts = append(m.contacts, &stored)
		return &stored, nil
	}
	for _, existing := range m.contacts {
		if existing.ID == c.ID && existing.UserID == c.UserID {
			existing.DisplayName = c.DisplayName
			existing.Phone = c.Phone
			existing.Relation = c.Relation
			existing.Priority = c.Priority
			existing.PermissionAttestedAt = c.PermissionAttestedAt
			existing.UpdatedAt = now
			return existing, nil
		}
	}
	return nil, ErrContactNotFound
}

func (m *MemoryRepository) DeleteContact(_ context.Context, userID, contactID string, _ time.Time) (bool, error) {
	for i, existing := range m.contacts {
		if existing.ID == contactID && existing.UserID == userID {
			m.contacts = append(m.contacts[:i], m.contacts[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}

func (m *MemoryRepository) AppendEvent(_ context.Context, e *Event) (*Event, error) {
	stored := *e
	stored.ID = m.nextID("ee")
	stored.CreatedAt = e.OccurredAt
	m.events = append(m.events, &stored)
	return &stored, nil
}

func (m *MemoryRepository) ListEvents(_ context.Context, userID string, limit int) ([]*Event, error) {
	out := make([]*Event, 0, len(m.events))
	for i := len(m.events) - 1; i >= 0; i-- {
		if m.events[i].UserID == userID {
			out = append(out, m.events[i])
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func sortByPriority(rows []*Contact) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j-1].Priority > rows[j].Priority; j-- {
			rows[j-1], rows[j] = rows[j], rows[j-1]
		}
	}
}

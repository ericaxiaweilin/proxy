// Package emergency command-service layer. The HTTP layer in
// internal/api and the mobile client talk to this via the standard
// command.Envelope / command.Result shape, like every other domain.
//
// Five commands:
//
//   - ListEmergencyContacts: the caller's own list, priority order.
//   - UpsertEmergencyContact: add (no id) or edit (with id).
//   - DeleteEmergencyContact: soft delete.
//   - RecordEmergencyEvent: append an SOS / meetup-checkin record.
//   - ListEmergencyEvents: the caller's own event history.
package emergency

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/location"
)

// ConsentGate reports whether the user holds an active location
// consent. It is satisfied by location.Repository. Kept as a narrow
// interface so this package does not depend on the whole location
// service.
type ConsentGate interface {
	GetActive(ctx context.Context, userID string, kind location.Kind) (*location.Consent, error)
}

// Service is the command entry point.
type Service struct {
	repo    Repository
	consent ConsentGate
	nowFunc func() time.Time
}

// NewService returns a Service. consent may be nil, in which case no
// location is ever recorded on an event — fail-closed, because the
// alternative (recording location with no way to check consent) is the
// thing this gate exists to prevent.
func NewService(repo Repository, consent ConsentGate) *Service {
	return &Service{repo: repo, consent: consent, nowFunc: time.Now}
}

// SetNowFunc overrides the clock. Tests only.
func (s *Service) SetNowFunc(f func() time.Time) { s.nowFunc = f }

func (s *Service) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

// Supports reports whether this service handles the command type.
func (s *Service) Supports(t string) bool {
	switch t {
	case "ListEmergencyContacts", "UpsertEmergencyContact", "DeleteEmergencyContact",
		"RecordEmergencyEvent", "ListEmergencyEvents":
		return true
	default:
		return false
	}
}

// HandleContext dispatches an envelope.
func (s *Service) HandleContext(ctx context.Context, envelope command.Envelope) command.Result {
	switch envelope.CommandType {
	case "ListEmergencyContacts":
		return s.listContacts(ctx, envelope)
	case "UpsertEmergencyContact":
		return s.upsertContact(ctx, envelope)
	case "DeleteEmergencyContact":
		return s.deleteContact(ctx, envelope)
	case "RecordEmergencyEvent":
		return s.recordEvent(ctx, envelope)
	case "ListEmergencyEvents":
		return s.listEvents(ctx, envelope)
	default:
		return command.Rejected(envelope, "UNKNOWN_COMMAND", "VALIDATION", "AFTER_USER_ACTION", "emergency.unknown_command", nil)
	}
}

// ── wire shapes ─────────────────────────────────────────────────────

// contactBody is the wire shape of one contact. Note what is NOT here:
// there is no "verified" flag. We only know what the user asserted.
type contactBody struct {
	ContactID            string `json:"contactId"`
	DisplayName          string `json:"displayName"`
	Phone                string `json:"phone"`
	Relation             string `json:"relation,omitempty"`
	Priority             int    `json:"priority"`
	PermissionAttestedAt string `json:"permissionAttestedAt"`
}

func toContactBody(c *Contact) contactBody {
	return contactBody{
		ContactID:            c.ID,
		DisplayName:          c.DisplayName,
		Phone:                c.Phone,
		Relation:             c.Relation,
		Priority:             c.Priority,
		PermissionAttestedAt: c.PermissionAttestedAt.UTC().Format(time.RFC3339),
	}
}

// eventBody is the wire shape of one event. locationRecorded is
// explicit so the client can tell "no location was sent" from "a
// location was sent and deliberately dropped" (locationOmittedReason).
type eventBody struct {
	EventID               string   `json:"eventId"`
	Kind                  string   `json:"kind"`
	OccurredAt            string   `json:"occurredAt"`
	CoarseLat             *float64 `json:"coarseLat,omitempty"`
	CoarseLng             *float64 `json:"coarseLng,omitempty"`
	CoarsePrecisionM      *int     `json:"coarsePrecisionM,omitempty"`
	LocationRecorded      bool     `json:"locationRecorded"`
	LocationOmittedReason string   `json:"locationOmittedReason,omitempty"`
	ContactIDs            []string `json:"contactIds"`
	DialerOpened          bool     `json:"dialerOpened"`
	DialedNumber          string   `json:"dialedNumber,omitempty"`
	SMSHandoffCount       int      `json:"smsHandoffCount"`
	Note                  string   `json:"note,omitempty"`
	// DeliveredToContacts is always false and is present so a client
	// cannot read the absence of a field as "delivered".
	DeliveredToContacts bool `json:"deliveredToContacts"`
}

func toEventBody(e *Event, omittedReason string) eventBody {
	return eventBody{
		EventID:               e.ID,
		Kind:                  string(e.Kind),
		OccurredAt:            e.OccurredAt.UTC().Format(time.RFC3339),
		CoarseLat:             e.CoarseLat,
		CoarseLng:             e.CoarseLng,
		CoarsePrecisionM:      e.CoarsePrecisionM,
		LocationRecorded:      e.CoarseLat != nil,
		LocationOmittedReason: omittedReason,
		ContactIDs:            e.ContactIDs,
		DialerOpened:          e.DialerOpened,
		DialedNumber:          e.DialedNumber,
		SMSHandoffCount:       e.SMSHandoffCount,
		Note:                  e.Note,
		DeliveredToContacts:   false,
	}
}

// ── handlers ────────────────────────────────────────────────────────

func (s *Service) listContacts(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return authRequired(envelope)
	}
	rows, err := s.repo.ListContacts(ctx, userID)
	if err != nil {
		return command.Rejected(envelope, "EMERGENCY_CONTACTS_READ_FAILED", "INTERNAL", "SAFE_RETRY", "emergency.contacts_read_failed", nil)
	}
	out := make([]contactBody, 0, len(rows))
	for _, c := range rows {
		out = append(out, toContactBody(c))
	}
	return acceptedWithBody(envelope, "emergency.contacts", map[string]any{
		"contacts": out,
		"limit":    MaxContacts,
	})
}

func (s *Service) upsertContact(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return authRequired(envelope)
	}
	payload := envelope.Payload
	// The attestation is required and must be an explicit true. A
	// missing/false attestation is rejected rather than stored as
	// "the user agreed" — that would fabricate the very evidence the
	// column exists to hold.
	if !boolFromPayload(payload, "permissionAttested") {
		return command.Rejected(envelope, "EMERGENCY_CONTACT_PERMISSION_NOT_ATTESTED", "VALIDATION", "AFTER_USER_ACTION", "emergency.permission_not_attested", map[string]any{
			"requirement": "permissionAttested must be true: the user confirms the contact agreed to be listed",
		})
	}
	contact := &Contact{
		ID:          strings.TrimSpace(stringFromPayload(payload, "contactId")),
		UserID:      userID,
		DisplayName: strings.TrimSpace(stringFromPayload(payload, "displayName")),
		Phone:       strings.TrimSpace(stringFromPayload(payload, "phone")),
		Relation:    strings.TrimSpace(stringFromPayload(payload, "relation")),
		Priority:    intFromPayload(payload, "priority"),
	}
	if err := ValidateContact(*contact); err != nil {
		return command.Rejected(envelope, "INVALID_EMERGENCY_CONTACT", "VALIDATION", "AFTER_USER_ACTION", "emergency.invalid_contact", map[string]any{
			"reason": err.Error(),
			"limit":  MaxContacts,
		})
	}
	now := s.now()
	contact.PermissionAttestedAt = now
	stored, err := s.repo.UpsertContact(ctx, contact, now)
	if err != nil {
		switch {
		case err == ErrTooManyContacts:
			return command.Rejected(envelope, "EMERGENCY_CONTACT_LIMIT_REACHED", "VALIDATION", "AFTER_USER_ACTION", "emergency.contact_limit", map[string]any{"limit": MaxContacts})
		case err == ErrContactNotFound:
			return command.Rejected(envelope, "EMERGENCY_CONTACT_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "emergency.contact_not_found", nil)
		default:
			return command.Rejected(envelope, "EMERGENCY_CONTACT_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "emergency.contact_write_failed", nil)
		}
	}
	return acceptedWithBody(envelope, "emergency.contact_saved", map[string]any{"contact": toContactBody(stored)})
}

func (s *Service) deleteContact(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return authRequired(envelope)
	}
	contactID := strings.TrimSpace(stringFromPayload(envelope.Payload, "contactId"))
	if contactID == "" {
		return command.Rejected(envelope, "EMERGENCY_CONTACT_ID_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "emergency.contact_id_required", nil)
	}
	removed, err := s.repo.DeleteContact(ctx, userID, contactID, s.now())
	if err != nil {
		return command.Rejected(envelope, "EMERGENCY_CONTACT_DELETE_FAILED", "INTERNAL", "SAFE_RETRY", "emergency.contact_delete_failed", nil)
	}
	return acceptedWithBody(envelope, "emergency.contact_deleted", map[string]any{"contactId": contactID, "removed": removed})
}

// recordEvent appends an emergency event.
//
// The location rule: the client may send the fix it holds, but we
// coarsen it here and persist only the coarse point. If the user holds
// no active location consent we DROP the coordinates and still record
// the event — the SOS itself must never be lost because of a consent
// state, and we tell the client plainly which of the two happened.
func (s *Service) recordEvent(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return authRequired(envelope)
	}
	payload := envelope.Payload
	kind := EventKind(strings.ToUpper(strings.TrimSpace(stringFromPayload(payload, "kind"))))
	event := &Event{
		UserID:          userID,
		Kind:            kind,
		OccurredAt:      s.now(),
		ContactIDs:      stringSliceFromPayload(payload, "contactIds"),
		DialerOpened:    boolFromPayload(payload, "dialerOpened"),
		DialedNumber:    strings.TrimSpace(stringFromPayload(payload, "dialedNumber")),
		SMSHandoffCount: intFromPayload(payload, "smsHandoffCount"),
		Note:            strings.TrimSpace(stringFromPayload(payload, "note")),
	}
	if event.ContactIDs == nil {
		event.ContactIDs = []string{}
	}

	omitted := ""
	lat, hasLat := floatFromPayload(payload, "latitude")
	lng, hasLng := floatFromPayload(payload, "longitude")
	if hasLat && hasLng {
		if s.locationConsentActive(ctx, userID) {
			coarse := Coarsen(lat, lng)
			event.CoarseLat = &coarse.Lat
			event.CoarseLng = &coarse.Lng
			event.CoarsePrecisionM = &coarse.PrecisionM
		} else {
			omitted = "NO_LOCATION_CONSENT"
		}
	} else if hasLat != hasLng {
		return command.Rejected(envelope, "INVALID_EMERGENCY_LOCATION", "VALIDATION", "AFTER_USER_ACTION", "emergency.invalid_location", map[string]any{
			"reason": "latitude and longitude must be sent together",
		})
	}

	if err := ValidateEvent(*event); err != nil {
		return command.Rejected(envelope, "INVALID_EMERGENCY_EVENT", "VALIDATION", "AFTER_USER_ACTION", "emergency.invalid_event", map[string]any{"reason": err.Error()})
	}
	stored, err := s.repo.AppendEvent(ctx, event)
	if err != nil {
		return command.Rejected(envelope, "EMERGENCY_EVENT_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "emergency.event_write_failed", nil)
	}
	return acceptedWithBody(envelope, "emergency.event_recorded", map[string]any{"event": toEventBody(stored, omitted)})
}

func (s *Service) listEvents(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return authRequired(envelope)
	}
	limit := intFromPayload(envelope.Payload, "limit")
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.repo.ListEvents(ctx, userID, limit)
	if err != nil {
		return command.Rejected(envelope, "EMERGENCY_EVENTS_READ_FAILED", "INTERNAL", "SAFE_RETRY", "emergency.events_read_failed", nil)
	}
	out := make([]eventBody, 0, len(rows))
	for _, e := range rows {
		out = append(out, toEventBody(e, ""))
	}
	return acceptedWithBody(envelope, "emergency.events", map[string]any{"events": out})
}

// locationConsentActive reports whether ANY location consent is active.
// Both kinds qualify: the caller has already chosen how much to
// disclose, and an event only ever stores a coarse point regardless.
// With no gate wired at all we answer false (fail-closed).
func (s *Service) locationConsentActive(ctx context.Context, userID string) bool {
	if s.consent == nil {
		return false
	}
	now := s.now()
	for _, kind := range location.AllKinds {
		row, err := s.consent.GetActive(ctx, userID, kind)
		if err == nil && row.Active(now) {
			return true
		}
	}
	return false
}

func authRequired(envelope command.Envelope) command.Result {
	return command.Rejected(envelope, "AUTH_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "emergency.auth_required", nil)
}

func acceptedWithBody(envelope command.Envelope, state string, body any) command.Result {
	result := command.Accepted(envelope, "Emergency", envelope.Actor.ID, 1, state, []string{})
	result.Body = toBodyMap(body)
	return result
}

func toBodyMap(body any) map[string]any {
	if body == nil {
		return nil
	}
	if m, ok := body.(map[string]any); ok {
		return m
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// ── payload readers ─────────────────────────────────────────────────

func stringFromPayload(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

func boolFromPayload(payload map[string]any, key string) bool {
	if payload == nil {
		return false
	}
	if v, ok := payload[key].(bool); ok {
		return v
	}
	return false
}

// floatFromPayload distinguishes "absent" from "zero", which matters
// because 0,0 is a real coordinate in the Gulf of Guinea and a missing
// coordinate must not be read as one.
func floatFromPayload(payload map[string]any, key string) (float64, bool) {
	if payload == nil {
		return 0, false
	}
	v, ok := payload[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

func intFromPayload(payload map[string]any, key string) int {
	if payload == nil {
		return 0
	}
	v, ok := payload[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func stringSliceFromPayload(payload map[string]any, key string) []string {
	if payload == nil {
		return nil
	}
	raw, ok := payload[key]
	if !ok {
		return nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}

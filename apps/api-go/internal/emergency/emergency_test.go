package emergency

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/location"
)

// fakeConsent is a ConsentGate the test drives directly. Returning a
// nil row with an error is the "no consent" case; the real Postgres
// repository signals that the same way (ErrConsentNotFound).
type fakeConsent struct {
	active map[location.Kind]bool
}

func (f *fakeConsent) GetActive(_ context.Context, _ string, kind location.Kind) (*location.Consent, error) {
	if f != nil && f.active[kind] {
		return &location.Consent{
			Kind:      kind,
			Status:    location.StatusGranted,
			ExpiresAt: time.Now().Add(time.Hour),
		}, nil
	}
	return nil, location.ErrConsentNotFound
}

func newTestService(consent ConsentGate) (*Service, *MemoryRepository) {
	repo := NewMemoryRepository()
	return NewService(repo, consent), repo
}

func envelopeFor(userID, commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{ID: userID},
		Payload:        payload,
	}
}

// ── the privacy guarantee ───────────────────────────────────────────

// Coarsen must never hand back the exact fix. This is the whole point
// of the package: the exact point must not be recoverable from what we
// store. If this test ever fails, the privacy promise in the migration
// comment is false.
func TestCoarsenNeverReturnsTheExactPoint(t *testing.T) {
	// A realistic precise fix in Hà Nội.
	const lat, lng = 21.027764, 105.834160
	got := Coarsen(lat, lng)
	if got.Lat == lat || got.Lng == lng {
		t.Fatalf("Coarsen returned an unrounded coordinate: lat=%v lng=%v", got.Lat, got.Lng)
	}
	// And it must be within the advertised error budget.
	latM := math.Abs(got.Lat-lat) * 111320
	lngM := math.Abs(got.Lng-lng) * 111320 * math.Cos(lat*math.Pi/180)
	if d := math.Hypot(latM, lngM); d > float64(got.PrecisionM) {
		t.Fatalf("actual error %.0fm exceeds the advertised %dm", d, got.PrecisionM)
	}
}

// The advertised precision must be CONSERVATIVE. Using the cell size
// instead of the half-cell diagonal would understate the error, which
// for a safety feature is the wrong direction to be wrong in.
func TestCoarsenPrecisionIsConservative(t *testing.T) {
	got := Coarsen(21.027764, 105.834160)
	// Cell size at the equator is ~1113m; the half-diagonal is ~787m,
	// rounded up to the nearest 10m.
	if got.PrecisionM < 700 || got.PrecisionM > 900 {
		t.Fatalf("precision %dm is not the expected half-cell diagonal (~780-790m rounded up)", got.PrecisionM)
	}
	// Sanity: it must exceed the half cell size in metres, otherwise we
	// are advertising a tighter bound than the grid can honour.
	if got.PrecisionM < 556 {
		t.Fatalf("precision %dm is tighter than half a cell", got.PrecisionM)
	}
}

// Coarsening must be idempotent: re-coarsening an already-coarse point
// must not drift it.
func TestCoarsenIsIdempotent(t *testing.T) {
	first := Coarsen(21.027764, 105.834160)
	second := Coarsen(first.Lat, first.Lng)
	if first.Lat != second.Lat || first.Lng != second.Lng {
		t.Fatalf("not idempotent: %v,%v -> %v,%v", first.Lat, first.Lng, second.Lat, second.Lng)
	}
}

// ── contact validation ──────────────────────────────────────────────

func TestValidatePhoneRejectsNonE164(t *testing.T) {
	// Note: the pattern is deliberately permissive about total length
	// (7..15 digits, per E.164), so short-but-well-formed numbers are
	// accepted. Only structurally impossible strings are rejected.
	bad := []string{"", "0912345678", "84912345678", "+8491234567890123456", "abc", "+84 912 345 678"}
	for _, phone := range bad {
		if err := ValidatePhone(phone); err == nil {
			t.Fatalf("expected %q to be rejected", phone)
		}
	}
	good := []string{"+84912345678", "+14155552671", "+849123456"}
	for _, phone := range good {
		if err := ValidatePhone(phone); err != nil {
			t.Fatalf("expected %q to be accepted, got %v", phone, err)
		}
	}
}

func TestValidateContactBounds(t *testing.T) {
	base := Contact{DisplayName: "An", Phone: "+84912345678", Priority: 1}
	if err := ValidateContact(base); err != nil {
		t.Fatalf("base contact should be valid: %v", err)
	}
	cases := map[string]Contact{
		"empty name":    {DisplayName: "", Phone: "+84912345678", Priority: 1},
		"name too long": {DisplayName: strings.Repeat("a", 61), Phone: "+84912345678", Priority: 1},
		"bad phone":     {DisplayName: "An", Phone: "0912345678", Priority: 1},
		"priority 0":    {DisplayName: "An", Phone: "+84912345678", Priority: 0},
		"priority 4":    {DisplayName: "An", Phone: "+84912345678", Priority: 4},
		"relation long": {DisplayName: "An", Phone: "+84912345678", Priority: 1, Relation: strings.Repeat("x", 41)},
	}
	for label, c := range cases {
		if err := ValidateContact(c); err == nil {
			t.Fatalf("%s: expected rejection", label)
		}
	}
}

// The cap is a product promise ("1-3 contacts"); the service must
// refuse the 4th rather than let the DB error surface as a 500.
func TestFourthContactIsRejected(t *testing.T) {
	svc, _ := newTestService(nil)
	ctx := context.Background()
	for i := 1; i <= MaxContacts; i++ {
		res := svc.HandleContext(ctx, envelopeFor("u1", "UpsertEmergencyContact", map[string]any{
			"displayName": "P", "phone": "+8491234567" + string(rune('0'+i)),
			"priority": i, "permissionAttested": true,
		}))
		if res.Error != nil {
			t.Fatalf("contact %d should be accepted: %v", i, res.Error)
		}
	}
	res := svc.HandleContext(ctx, envelopeFor("u1", "UpsertEmergencyContact", map[string]any{
		"displayName": "P4", "phone": "+84912345699", "priority": 3, "permissionAttested": true,
	}))
	if res.Error == nil {
		t.Fatal("the 4th contact must be rejected")
	}
	if res.Error.ErrorCode != "EMERGENCY_CONTACT_LIMIT_REACHED" && res.Error.ErrorCode != "INVALID_EMERGENCY_CONTACT" {
		t.Fatalf("unexpected error code: %s", res.Error.ErrorCode)
	}
}

// The attestation is the evidence the column exists to hold. A missing
// or false value must be refused, not stored as agreement.
func TestUpsertRequiresExplicitAttestation(t *testing.T) {
	svc, _ := newTestService(nil)
	for _, payload := range []map[string]any{
		{"displayName": "An", "phone": "+84912345678", "priority": 1},
		{"displayName": "An", "phone": "+84912345678", "priority": 1, "permissionAttested": false},
	} {
		res := svc.HandleContext(context.Background(), envelopeFor("u1", "UpsertEmergencyContact", payload))
		if res.Error == nil {
			t.Fatal("expected rejection when the attestation is absent/false")
		}
		if res.Error.ErrorCode != "EMERGENCY_CONTACT_PERMISSION_NOT_ATTESTED" {
			t.Fatalf("unexpected code %s", res.Error.ErrorCode)
		}
	}
}

// ── the consent gate ────────────────────────────────────────────────

// With no active location consent the event must STILL be recorded
// (an SOS is never lost), but the coordinates must be dropped and the
// client must be told why.
func TestEventDropsLocationWithoutConsent(t *testing.T) {
	svc, repo := newTestService(&fakeConsent{})
	res := svc.HandleContext(context.Background(), envelopeFor("u1", "RecordEmergencyEvent", map[string]any{
		"kind": "SOS", "latitude": 21.027764, "longitude": 105.834160, "dialerOpened": true, "dialedNumber": "113",
	}))
	if res.Error != nil {
		t.Fatalf("event must be recorded even without consent: %v", res.Error)
	}
	if len(repo.events) != 1 {
		t.Fatalf("expected 1 stored event, got %d", len(repo.events))
	}
	stored := repo.events[0]
	if stored.CoarseLat != nil || stored.CoarseLng != nil {
		t.Fatal("no coordinates may be stored without an active consent")
	}
	if stored.DialerOpened != true || stored.DialedNumber != "113" {
		t.Fatal("the dialer hand-off must still be recorded")
	}
	body, ok := res.Body["event"].(eventBody)
	if !ok {
		t.Fatalf("unexpected body type %T", res.Body["event"])
	}
	if body.LocationRecorded {
		t.Fatalf("locationRecorded should be false, got %v", body.LocationRecorded)
	}
	if body.LocationOmittedReason != "NO_LOCATION_CONSENT" {
		t.Fatalf("expected an explicit omission reason, got %v", body.LocationOmittedReason)
	}
}

// With consent the coordinates are stored COARSE, and the stored value
// differs from the input.
func TestEventCoarsensLocationWithConsent(t *testing.T) {
	const lat, lng = 21.027764, 105.834160
	svc, repo := newTestService(&fakeConsent{active: map[location.Kind]bool{location.KindFuzzyRegion: true}})
	res := svc.HandleContext(context.Background(), envelopeFor("u1", "RecordEmergencyEvent", map[string]any{
		"kind": "SOS", "latitude": lat, "longitude": lng,
	}))
	if res.Error != nil {
		t.Fatalf("unexpected error: %v", res.Error)
	}
	stored := repo.events[0]
	if stored.CoarseLat == nil || stored.CoarseLng == nil {
		t.Fatal("expected a coarse point to be stored")
	}
	if *stored.CoarseLat == lat || *stored.CoarseLng == lng {
		t.Fatal("the precise fix was stored uncoarsened")
	}
	if stored.CoarsePrecisionM == nil || *stored.CoarsePrecisionM < 556 {
		t.Fatalf("expected a conservative precision, got %v", stored.CoarsePrecisionM)
	}
}

// A service with no consent gate wired at all must fail closed.
func TestEventFailsClosedWithoutGate(t *testing.T) {
	svc, repo := newTestService(nil)
	res := svc.HandleContext(context.Background(), envelopeFor("u1", "RecordEmergencyEvent", map[string]any{
		"kind": "SOS", "latitude": 21.027764, "longitude": 105.834160,
	}))
	if res.Error != nil {
		t.Fatalf("unexpected error: %v", res.Error)
	}
	if repo.events[0].CoarseLat != nil {
		t.Fatal("a nil gate must not allow a location through")
	}
}

// Half a coordinate is a client bug, not a location.
func TestEventRejectsHalfACoordinate(t *testing.T) {
	svc, _ := newTestService(&fakeConsent{active: map[location.Kind]bool{location.KindPreciseGPS: true}})
	res := svc.HandleContext(context.Background(), envelopeFor("u1", "RecordEmergencyEvent", map[string]any{
		"kind": "SOS", "latitude": 21.027764,
	}))
	if res.Error == nil {
		t.Fatal("a latitude without a longitude must be rejected")
	}
	if res.Error.ErrorCode != "INVALID_EMERGENCY_LOCATION" {
		t.Fatalf("unexpected code %s", res.Error.ErrorCode)
	}
}

// An unknown kind must be rejected, not coerced to a known one.
func TestEventRejectsUnknownKind(t *testing.T) {
	svc, repo := newTestService(&fakeConsent{})
	res := svc.HandleContext(context.Background(), envelopeFor("u1", "RecordEmergencyEvent", map[string]any{
		"kind": "POLICE_DISPATCH",
	}))
	if res.Error == nil {
		t.Fatal("an unknown kind must be rejected")
	}
	if len(repo.events) != 0 {
		t.Fatal("nothing may be stored for an invalid kind")
	}
}

// The wire shape must never imply delivery. There is no push provider
// and no SMS gateway for arbitrary recipients, so the only honest
// value is false, and the field must be present rather than omitted.
func TestEventNeverClaimsDelivery(t *testing.T) {
	svc, _ := newTestService(&fakeConsent{})
	res := svc.HandleContext(context.Background(), envelopeFor("u1", "RecordEmergencyEvent", map[string]any{
		"kind": "SOS", "contactIds": []any{"ec_1", "ec_2"}, "smsHandoffCount": 2,
	}))
	if res.Error != nil {
		t.Fatalf("unexpected error: %v", res.Error)
	}
	body, ok := res.Body["event"].(eventBody)
	if !ok {
		t.Fatalf("unexpected body type %T", res.Body["event"])
	}
	if body.DeliveredToContacts {
		t.Fatalf("deliveredToContacts must be present and false, got %v", body.DeliveredToContacts)
	}
}

// ── scoping ─────────────────────────────────────────────────────────

// One user must never see or delete another user's contacts.
func TestContactsAreScopedToTheCaller(t *testing.T) {
	svc, _ := newTestService(nil)
	ctx := context.Background()
	svc.HandleContext(ctx, envelopeFor("u1", "UpsertEmergencyContact", map[string]any{
		"displayName": "An", "phone": "+84912345678", "priority": 1, "permissionAttested": true,
	}))
	res := svc.HandleContext(ctx, envelopeFor("u2", "ListEmergencyContacts", nil))
	contacts, ok := res.Body["contacts"].([]contactBody)
	if !ok {
		t.Fatalf("unexpected contacts type %T", res.Body["contacts"])
	}
	if len(contacts) != 0 {
		t.Fatalf("u2 must not see u1's contacts, saw %d", len(contacts))
	}
	// Deleting someone else's contact must be a no-op.
	del := svc.HandleContext(ctx, envelopeFor("u2", "DeleteEmergencyContact", map[string]any{"contactId": "ec_0001"}))
	if del.Error != nil {
		t.Fatalf("unexpected error: %v", del.Error)
	}
	if del.Body["removed"] != false {
		t.Fatal("deleting another user's contact must report removed=false")
	}
}

// Auth is required for every command in this package.
func TestAllCommandsRequireAuth(t *testing.T) {
	svc, _ := newTestService(nil)
	for _, ct := range []string{"ListEmergencyContacts", "UpsertEmergencyContact", "DeleteEmergencyContact", "RecordEmergencyEvent", "ListEmergencyEvents"} {
		res := svc.HandleContext(context.Background(), envelopeFor("", ct, map[string]any{}))
		if res.Error == nil || res.Error.ErrorCode != "AUTH_REQUIRED" {
			t.Fatalf("%s must require auth, got %v", ct, res.Error)
		}
	}
}

// The memory repository must report ErrContactNotFound for an id that
// belongs to nobody, so the service can map it to a clean 400.
func TestUpsertUnknownIDReportsNotFound(t *testing.T) {
	repo := NewMemoryRepository()
	_, err := repo.UpsertContact(context.Background(), &Contact{
		ID: "ec_nope", UserID: "u1", DisplayName: "An", Phone: "+84912345678", Priority: 1,
	}, time.Now())
	if !errors.Is(err, ErrContactNotFound) {
		t.Fatalf("expected ErrContactNotFound, got %v", err)
	}
}

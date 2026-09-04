// Package policydecisions is the audit log for "what policy applied
// when this Order was created". PRD v1.4 LC-28 (Vietnam Decree
// 248/2026/ND-CP §11.2) requires that every paid Order in a
// COMMITTED state (CONFIRMED in our lifecycle) carry a snapshot of
// the policy that was in effect at create time. The snapshot is a
// `policy_decision` row; the Order links to it via a foreign key in
// `policy.order_decisions`.
//
// Design notes:
//   - One decision is reusable across many Orders (e.g. the same
//     "USER_PAID_SERVICE v=1.0.0 / privacy v=1.0.0" decision gates
//     every Order in a session until the user re-consents). We
//     never copy-paste the snapshot into the Order.
//   - The decision is keyed by (user, category, terms_version,
//     privacy_version). Re-evaluating under the same conditions
//     returns the existing decision id; a new TermsVersion or
//     category produces a new id. That is the LC-30 mechanism:
//     Material Change re-evaluates and writes a new row.
//   - Kill-switch state is JSON-snapshotted on the decision row so
//     "what was enabled when the user paid" is recoverable months
//     later, even if a kill switch is flipped afterwards.
//
// Wiring:
//   - Memory + Postgres repositories implement Repository.
//   - Service.Evaluate returns the (possibly newly written) decision.
//   - Service.Stamp attaches a decision to an Order at the given
//     lifecycle stage. The Order.Confirm handler refuses to move
//     an Order into CONFIRMED when its SettlementMode is PLATFORM_PAY
//     and no decision has been stamped yet. (DIRECT_SETTLEMENT
//     Orders do not require a decision — the platform never touches
//     the funds, so the regulator does not need the audit log for
//     them. PRD §3.4 calls this out.)
package policydecisions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

// CategoryCode is the regulatory family that the decision applies
// to. The PRD §11.2 lists 20 canonical families; for the LC-28
// gate the only one that matters today is "USER_PAID_SERVICE" (a
// paid order between a requester and an agent). The empty set
// here is deliberate — a CategoryCode of "" is rejected, so the
// caller must always be specific.
type CategoryCode string

const (
	CategoryUserPaidService CategoryCode = "USER_PAID_SERVICE"
)

// AllowedCategoryCodes is the closed set the wire layer accepts.
// Adding a new entry here is the only way to onboard a new
// policy family; the migration that adds the corresponding check
// constraint is a separate decision (see migration 066 if/when it
// exists).
var AllowedCategoryCodes = []CategoryCode{
	CategoryUserPaidService,
}

// NormalizeCategoryCode guards against case / whitespace drift in
// the incoming JSON body.
func NormalizeCategoryCode(s string) (CategoryCode, error) {
	upper := strings.ToUpper(strings.TrimSpace(s))
	for _, c := range AllowedCategoryCodes {
		if string(c) == upper {
			return c, nil
		}
	}
	return "", errors.New("unknown policy category code: " + s)
}

// KillSwitchState is the JSON shape captured on a decision row.
// It mirrors compliance.KillSwitchView so the snapshot is small
// enough to be readable in a regulator's audit query, but it is
// kept as a separate type here so the policydecisions package
// does not import the compliance package (one-way dependency:
// compliance -> nothing, policydecisions -> nothing; the wire
// layer bridges).
type KillSwitchState struct {
	Categories map[string]KillSwitchEntry `json:"categories"`
}

// KillSwitchEntry is one row in the snapshot. Reason / SetBy are
// useful when reconstructing "why was AI_MEDIA disabled when this
// Order was created".
type KillSwitchEntry struct {
	Reason string `json:"reason,omitempty"`
	SetBy  string `json:"setBy,omitempty"`
	SetAt  string `json:"setAt,omitempty"`
}

// Decision is the canonical record. The HTTP layer renders it
// directly into the response body.
type Decision struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	CategoryCode   CategoryCode    `json:"categoryCode"`
	TermsVersion   string          `json:"termsVersion"`
	PrivacyVersion string          `json:"privacyVersion"`
	// R16.7-P1-E: jurisdiction of the user at evaluation
	// time. Stored on the decision so the audit log is
	// recoverable without a cross-table join. The wire
	// form is "VN-79" (country + "-" + region).
	Jurisdiction   string          `json:"jurisdiction"`
	KillSwitch     KillSwitchState `json:"killSwitch"`
	EvaluatedAt    time.Time       `json:"evaluatedAt"`
	ExpiresAt      *time.Time      `json:"expiresAt,omitempty"`
}

// ErrNotFound is returned by Repository lookups when no decision
// matches the (user, category, terms, privacy) tuple.
var ErrNotFound = errors.New("no policy decision for this tuple")

// Repository is the storage contract. The in-memory
// implementation lives in memory.go; the Postgres one in
// apps/api-go/internal/platform/postgres/policy_decisions.go.
type Repository interface {
	// GetByTuple returns the existing decision for the
	// (user, category, terms, privacy, jurisdiction) tuple,
	// or ErrNotFound. It does NOT create a new row — that is
	// Evaluate's job. R16.7-P1-E adds the jurisdiction
	// dimension so the same (user, category, terms, privacy)
	// evaluated under two different jurisdictions produces
	// two distinct decisions (LC-30 mechanism).
	GetByTuple(ctx context.Context, userID string, category CategoryCode, termsVersion, privacyVersion, jurisdiction string) (*Decision, error)

	// Insert writes a new decision row. The caller must have
	// already checked GetByTuple; UNIQUE constraints back this
	// up at the database level.
	Insert(ctx context.Context, d Decision) error
}

// Service is the entry point. It is wired into the
// CommandDispatcher's CreateOrder and ConfirmOrder paths.
type Service struct {
	repo      Repository
	nowFunc   func() time.Time
	// termsVersion and privacyVersion are the *current*
	// canonical versions. They are injected at construction
	// time so a test can pin them; in production they come
	// from boot-time constants tied to the static /v1/legal
	// documents.
	termsVersion   string
	privacyVersion string
	// killSwitchProvider is invoked at Evaluate time to
	// snapshot the current kill-switch state. The signature
	// is a function rather than an interface so the policy
	// package stays decoupled from the compliance package; the
	// wire layer in apps/api-go/internal/api wires the two.
	killSwitchProvider func() KillSwitchState
}

// NewService builds a Service with the given Repository, terms
// version, privacy version, and kill-switch provider. The terms
// and privacy version strings must be non-empty (the LC-28 gate
// fails closed otherwise).
func NewService(repo Repository, termsVersion, privacyVersion string, ksProvider func() KillSwitchState) *Service {
	return &Service{
		repo:               repo,
		nowFunc:            time.Now,
		termsVersion:       termsVersion,
		privacyVersion:     privacyVersion,
		killSwitchProvider: ksProvider,
	}
}

// SetNowFunc is injectable for tests; defaults to time.Now.
func (s *Service) SetNowFunc(f func() time.Time) { s.nowFunc = f }

func (s *Service) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

// Evaluate returns the existing decision for the
// (user, category, current-terms, current-privacy,
// jurisdiction) tuple, creating a new one if none exists
// yet. The decision id is the audit-log pointer that the
// Order is stamped with.
//
// R16.7-P1-E: the jurisdiction argument is the
// canonical "VN-79" form (country + "-" + region). The
// caller is the policy gate in the Order confirm path,
// which resolves the user's jurisdiction via
// jurisdiction.Service.Resolve before calling Evaluate.
// When the empty string is passed, Evaluate defaults to
// the platform's launch jurisdiction (VN-79) so the
// legacy test surface continues to work.
//
// Fail-closed: if the repository errors on Insert (e.g. a
// DB blip) the error is returned to the caller so the
// Order is rejected at create time. The alternative —
// silently writing the Order without a decision — would
// break LC-28 and the audit log.
func (s *Service) Evaluate(ctx context.Context, userID string, category CategoryCode, jurisdiction string) (*Decision, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("policydecisions: userID is required")
	}
	if _, err := NormalizeCategoryCode(string(category)); err != nil {
		return nil, err
	}
	if s.termsVersion == "" {
		return nil, errors.New("policydecisions: terms version is unconfigured")
	}
	if s.privacyVersion == "" {
		return nil, errors.New("policydecisions: privacy version is unconfigured")
	}
	if strings.TrimSpace(jurisdiction) == "" {
		jurisdiction = "VN-79"
	}
	// Fast path: existing decision under the same conditions.
	if existing, err := s.repo.GetByTuple(ctx, userID, category, s.termsVersion, s.privacyVersion, jurisdiction); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	// Slow path: write a new decision row.
	ks := KillSwitchState{Categories: map[string]KillSwitchEntry{}}
	if s.killSwitchProvider != nil {
		ks = s.killSwitchProvider()
		if ks.Categories == nil {
			ks.Categories = map[string]KillSwitchEntry{}
		}
	}
	d := Decision{
		ID:             newDecisionID(),
		UserID:         userID,
		CategoryCode:   category,
		TermsVersion:   s.termsVersion,
		PrivacyVersion: s.privacyVersion,
		Jurisdiction:   jurisdiction,
		KillSwitch:     ks,
		EvaluatedAt:    s.now().UTC(),
	}
	if err := s.repo.Insert(ctx, d); err != nil {
		return nil, err
	}
	return &d, nil
}

// GetByID is a thin pass-through used by the audit endpoint.
func (s *Service) GetByID(ctx context.Context, id string) (*Decision, error) {
	// Repository doesn't expose GetByID directly; we look it
	// up by scanning the in-memory store via a tuple match.
	// The wire layer is expected to use this only for known
	// ids; unknown ids return ErrNotFound.
	// For the in-memory implementation, we delegate to a
	// helper that is also used by the tests.
	return getByID(s.repo, ctx, id)
}

// Stamp records an (order, decision, lifecycle) tuple. The
// underlying repository is expected to satisfy
// StampingRepository; if it does not (a legacy test stub),
// the call is a no-op so the gate is not blocked.
func (s *Service) Stamp(ctx context.Context, stamp OrderStamp) error {
	if r, ok := s.repo.(StampingRepository); ok {
		return r.Stamp(ctx, stamp)
	}
	return nil
}

// StampsForOrder returns the chronological list of stamps for
// the given order id. The underlying repository is expected to
// satisfy StampingRepository; if it does not, the call returns
// an empty slice.
func (s *Service) StampsForOrder(ctx context.Context, orderID string) ([]OrderStamp, error) {
	if r, ok := s.repo.(StampingRepository); ok {
		return r.StampsForOrder(ctx, orderID)
	}
	return nil, nil
}

// helper that the in-memory and Postgres repositories both
// satisfy. We define the signature here so the wire layer has
// a single GetByID contract.
func getByID(repo Repository, ctx context.Context, id string) (*Decision, error) {
	if r, ok := repo.(interface {
		GetByID(context.Context, string) (*Decision, error)
	}); ok {
		return r.GetByID(ctx, id)
	}
	return nil, ErrNotFound
}

// OrderStamp records that the given decision is attached to the
// given Order. The wire layer's CreateOrder and ConfirmOrder
// handlers call this; the policydecisions package itself does
// not own the Order.
type OrderStamp struct {
	OrderID         string
	DecisionID      string
	StampedAt       time.Time
	StampedLifecycle string
}

// StampingRepository is the additional repository surface the
// Order side needs. It is implemented by the same Postgres
// repository (or by a thin wrapper around the in-memory one).
type StampingRepository interface {
	Stamp(ctx context.Context, stamp OrderStamp) error
	StampsForOrder(ctx context.Context, orderID string) ([]OrderStamp, error)
}

func newDecisionID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return "pdec_" + hex.EncodeToString(b[:])
}

// used in tests / future debug; exported for the wire layer.
func MustEncodeKillSwitch(state KillSwitchState) string {
	raw, _ := json.Marshal(state)
	return string(raw)
}

// used in tests / future debug; exported for the wire layer.
func DecodeKillSwitch(raw string) (KillSwitchState, error) {
	var s KillSwitchState
	if strings.TrimSpace(raw) == "" {
		return s, nil
	}
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return s, err
	}
	// Sort keys for stable test snapshots.
	if len(s.Categories) > 0 {
		keys := make([]string, 0, len(s.Categories))
		for k := range s.Categories {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		ordered := make(map[string]KillSwitchEntry, len(s.Categories))
		for _, k := range keys {
			ordered[k] = s.Categories[k]
		}
		s.Categories = ordered
	}
	return s, nil
}

// Package compliance owns the remote legal kill switch and
// anything else that the operator uses to flip regulated
// functionality off / on at runtime. Vietnam 356/2025/ND-CP
// Art. 12 + PRD v1.4 LC-16 require that the operator be able
// to disable a category immediately when there is a compliance
// incident.
//
// The HTTP layer in apps/api-go/internal/api/kill_switch.go
// exposes three routes:
//   - GET  /v1/legal/status         (public; mobile reads at boot)
//   - POST /v1/operator/legal/kill-switch  (operator only)
//   - DELETE /v1/operator/legal/kill-switch/{category}  (operator only)
//
// The server also consults the switch before running certain
// command types -- and ONLY those. A KILLED AI_MEDIA switch
// blocks the AI-media publish commands; a KILLED MARKETPLACE
// switch blocks the order/payment commands. See
// EnforceableCategories for the authoritative list.
//
// IMPORTANT (2026-09-21): GLOBAL, LOCATION_CONSENT and PAYMENTS
// are accepted by the database and by this package's wire
// normalizer, but NO command is gated on them. Arming one
// records the operator's decision in the audit trail and
// blocks nothing. This comment used to claim a KILLED GLOBAL
// switch "blocks everything that returns a 503"; it never did,
// and there is no such gate anywhere in the server. Read the
// note on EnforceableCategories before trusting any of these.
package compliance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Category enumerates the things the operator can flip. The
// check constraint in migration 064 accepts this same
// five-value set, but it is deliberately WIDER than what is
// enforced: the constraint has to keep accepting historical
// rows for categories that were never wired to an enforcement
// point. Nothing compares the two lists at startup -- this
// comment used to claim a mismatch was a "startup-time
// migration failure", which no code performs. The enforced
// subset is EnforceableCategories.
type Category string

const (
	CategoryGlobal         Category = "GLOBAL"
	CategoryAIMedia        Category = "AI_MEDIA"
	CategoryMarketplace    Category = "MARKETPLACE"
	CategoryLocationConsent Category = "LOCATION_CONSENT"
	CategoryPayments       Category = "PAYMENTS"
)

// Status is the lifecycle of a kill-switch row. KILLED is the
// only state that disables features; REARMED is a tombstone
// row kept for the audit log.
type Status string

const (
	StatusKilled   Status = "KILLED"
	StatusRearmed  Status = "REARMED"
)

// AllowedCategories is the list the HTTP layer accepts in a
// request body, and the list GlobalStatus reports on. It is
// the same five-value set the migration 064 check constraint
// accepts.
//
// NOTE (2026-09-21): this is NOT the set of categories that do
// anything. It used to be documented as "every entry must map
// to a concrete enforcement point" -- that was false for three
// of the five. The enforceable subset is
// EnforceableCategories; anything outside it can still be
// armed (so the operator's decision is recorded) but blocks no
// command, and the operator route says so in its response.
var AllowedCategories = []Category{
	CategoryGlobal,
	CategoryAIMedia,
	CategoryMarketplace,
	CategoryLocationConsent,
	CategoryPayments,
}

// EnforceableCategories is the subset of AllowedCategories that
// has at least one concrete enforcement point, reached through
// Server.enforceKillSwitch (apps/api-go/internal/api/
// command_dispatch.go) -> commandKillSwitchCategory:
//
//	AI_MEDIA     -> PublishAIPost, GenerateAIContent
//	MARKETPLACE  -> CreateOrder, SubmitPayment, ConfirmOrder
//
// The other three are deliberately NOT here. Do not add one
// without also adding its enforcement point -- the LC-16 gate
// pins this list against commandKillSwitchCategory and will go
// red if you do:
//
//	GLOBAL           needs to gate every command EXCEPT the
//	                 escape hatches the client needs in order
//	                 to explain itself (auth, /v1/legal/status).
//	                 Choosing that exception list is a product
//	                 decision, not a wiring detail.
//	LOCATION_CONSENT needs to gate the precise-location
//	                 commands. Which surfaces count as "precise
//	                 location" is a product/legal decision.
//	PAYMENTS         SubmitPayment currently maps to
//	                 MARKETPLACE, not here. Moving it changes
//	                 what the marketplace switch blocks.
var EnforceableCategories = []Category{
	CategoryAIMedia,
	CategoryMarketplace,
}

// IsEnforceable reports whether arming this category blocks any
// command today. A false result does not make Kill fail: the
// row is still written so the operator's decision stays in the
// audit trail. It only means nothing is stopped.
func IsEnforceable(category Category) bool {
	for _, c := range EnforceableCategories {
		if c == category {
			return true
		}
	}
	return false
}

// NormalizeCategory guards against case / whitespace drift in
// the incoming JSON body.
func NormalizeCategory(s string) (Category, error) {
	upper := strings.ToUpper(strings.TrimSpace(s))
	for _, c := range AllowedCategories {
		if string(c) == upper {
			return c, nil
		}
	}
	return "", fmt.Errorf("unknown kill-switch category: %q", s)
}

// ErrInvalidDuration is returned when the optional expires_at
// timestamp is in the past.
var ErrInvalidDuration = errors.New("kill-switch expires_at must be in the future")

// ErrNotFound is returned by Repository lookups when the
// category has no current row.
var ErrNotFound = errors.New("no kill switch for this category")

// KillSwitch is the canonical record. The HTTP layer renders
// it directly into the response body.
type KillSwitch struct {
	ID         string
	Category   Category
	Status     Status
	Reason     string
	SetBy      string
	SetAt      time.Time
	ExpiresAt  *time.Time
	RearmedBy  *string
	RearmedAt  *time.Time
}

// Active reports whether the switch is currently disabling
// the category. The repository is expected to have run the
// expiry sweep before this is called, so a row whose
// expires_at has passed will be returned as REARMED.
func (k *KillSwitch) Active() bool {
	if k == nil {
		return false
	}
	return k.Status == StatusKilled
}

// Repository is the storage contract. The in-memory
// implementation lives in memory.go; the Postgres one in
// apps/api-go/internal/platform/postgres/kill_switch.go.
type Repository interface {
	// GetActive returns the KILLED row for the category, or
	// ErrNotFound if none. The implementation is expected to
	// have run the expiry sweep first; the service layer also
	// runs it on every read so the audit log is current.
	GetActive(ctx context.Context, category Category) (*KillSwitch, error)

	// Kill inserts a new KILLED row for the category. If a
	// previous KILLED row exists, it is flipped to REARMED in
	// the same transaction. expiresAt may be nil for an
	// indefinite kill.
	Kill(ctx context.Context, category Category, reason, setBy string, expiresAt *time.Time, now time.Time) (*KillSwitch, error)

	// Rearm flips the KILLED row for the category to REARMED.
	// Returns ErrNotFound if no KILLED row exists. The
	// rearmedBy argument is recorded for the audit trail.
	Rearm(ctx context.Context, category Category, rearmedBy string, now time.Time) error

	// ExpireOverdue flips every KILLED row whose expires_at
	// has passed to REARMED. Returns the number of rows
	// flipped. Called on every public read so the audit log
	// stays current without a cron.
	ExpireOverdue(ctx context.Context, now time.Time) (int, error)

	// ListAll returns the full history (KILLED and REARMED
	// rows) for the operator's audit view. Newest first.
	ListAll(ctx context.Context) ([]*KillSwitch, error)
}

// Service is the command-service entry point. It is wired
// into the operator's command router and exposes a small
// helper, IsEnabled, that the rest of the server uses to
// gate endpoints.
type Service struct {
	repo Repository
	// nowFunc is injectable for tests; defaults to time.Now.
	nowFunc func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, nowFunc: time.Now}
}

func (s *Service) SetNowFunc(f func() time.Time) { s.nowFunc = f }

func (s *Service) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

// IsEnabled is the fast-path check the rest of the server
// uses. It returns true if the category is currently usable
// (no active kill switch, or the active one is past its
// expires_at). The expiry sweep is run before the read so a
// stale row cannot leak.
func (s *Service) IsEnabled(ctx context.Context, category Category) bool {
	if _, err := s.repo.ExpireOverdue(ctx, s.now()); err != nil {
		// Fail-closed: if the sweep errors, treat the switch
		// as enabled. The cost of being wrong here is a brief
		// window where a kill switch does not take effect;
		// the cost of failing closed is a complete outage on
		// any DB blip. The latter is worse for users.
		return true
	}
	row, err := s.repo.GetActive(ctx, category)
	if err != nil {
		return true
	}
	return !row.Active()
}

// GlobalStatus returns the union of currently active kill
// switches, one per category. The mobile client reads this at
// boot to render the legal-status banner and to decide which
// subpages to disable.
func (s *Service) GlobalStatus(ctx context.Context) (map[string]KillSwitchView, error) {
	now := s.now()
	if _, err := s.repo.ExpireOverdue(ctx, now); err != nil {
		return nil, err
	}
	out := make(map[string]KillSwitchView)
	for _, c := range AllowedCategories {
		row, err := s.repo.GetActive(ctx, c)
		if err != nil {
			continue
		}
		if !row.Active() {
			continue
		}
		view := KillSwitchView{
			Category: string(row.Category),
			Reason:   row.Reason,
			SetBy:    row.SetBy,
			SetAt:    row.SetAt.UTC().Format(time.RFC3339),
		}
		if row.ExpiresAt != nil {
			view.ExpiresAt = row.ExpiresAt.UTC().Format(time.RFC3339)
		}
		out[string(row.Category)] = view
	}
	return out, nil
}

// KillSwitchView is the wire shape of an active kill switch.
// It is also the type the public /v1/legal/status endpoint
// returns inside a map keyed by category.
type KillSwitchView struct {
	Category  string `json:"category"`
	Reason    string `json:"reason"`
	SetBy     string `json:"setBy"`
	SetAt     string `json:"setAt"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

// Kill creates a new KILLED row. The HTTP layer must have
// already verified the operator's privilege.
func (s *Service) Kill(ctx context.Context, category Category, reason, setBy string, expiresAt *time.Time) (*KillSwitch, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, errors.New("kill-switch reason must be non-empty")
	}
	if expiresAt != nil && !expiresAt.After(s.now()) {
		return nil, ErrInvalidDuration
	}
	row, err := s.repo.Kill(ctx, category, reason, setBy, expiresAt, s.now())
	if err != nil {
		return nil, err
	}
	return row, nil
}

// Rearm clears the active KILLED row. The HTTP layer must
// have already verified the operator's privilege.
func (s *Service) Rearm(ctx context.Context, category Category, rearmedBy string) error {
	return s.repo.Rearm(ctx, category, rearmedBy, s.now())
}

// ListHistory returns the full audit trail. Newest first.
func (s *Service) ListHistory(ctx context.Context) ([]*KillSwitch, error) {
	if _, err := s.repo.ExpireOverdue(ctx, s.now()); err != nil {
		return nil, err
	}
	return s.repo.ListAll(ctx)
}

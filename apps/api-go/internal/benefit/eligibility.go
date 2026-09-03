package benefit

import (
	"context"
	"time"
)

// EligibilityEngine evaluates whether a user is eligible for a benefit offer.
// R0 uses simple, explainable rules. ML-based ranking comes later when samples are sufficient.
type EligibilityEngine struct {
	repo  Repository
	clock Clock
}

// Evaluator is the small interface Service depends on. Production
// wires an *EligibilityEngine; tests may inject a stub.
type Evaluator interface {
	Evaluate(ctx context.Context, ec *EligibilityContext) (*EligibilityResult, error)
}

// Compile-time assertion: *EligibilityEngine implements Evaluator.
var _ Evaluator = (*EligibilityEngine)(nil)

func NewEligibilityEngine(repo Repository, clock Clock) *EligibilityEngine {
	return &EligibilityEngine{repo: repo, clock: clock}
}

// EligibilityContext carries all signals needed to evaluate eligibility.
type EligibilityContext struct {
	UserID         string
	CampaignID     string
	BenefitID      string
	DistributorType DistributorType
	DistributorID   string

	// Account signals
	AccountAge     time.Duration
	AccountStatus  string  // "ACTIVE" | "ANONYMOUS" | "SUSPENDED"

	// Geo signals
	UserCity       string
	SceneID        string
	DistanceToScene float64 // meters

	// Lifecycle signals
	TotalRedemptions int
	DaysSinceLastRedemption int
	HasVisitedScene  bool

	// Capability signals
	UserRole        string  // "CREATOR" | "STAFF" | "SCOUT" | "USER"

	// Risk signals
	DeviceCount     int
	AccountCount    int
	VelocityScore   float64 // redemptions per hour
}

// EligibilityResult contains the outcome and reason for audit.
type EligibilityResult struct {
	Eligible    bool
	ReasonCode  string  // why eligible or not
	OfferReason string  // human-readable reason for the offer
}

// Evaluate checks if the user is eligible for a benefit.
func (e *EligibilityEngine) Evaluate(ctx context.Context, ec *EligibilityContext) (*EligibilityResult, error) {
	// Basic risk check (always applied)
	if ec.DeviceCount > 3 || ec.AccountCount > 1 {
		return &EligibilityResult{
			Eligible:   false,
			ReasonCode: "RISK_FLAGGED",
		}, nil
	}

	// Get campaign audience rules
	audience, err := e.repo.GetCampaignAudience(ctx, ec.CampaignID)
	if err != nil {
		// No audience rules = open campaign (eligible by default)
		return &EligibilityResult{
			Eligible:    true,
			ReasonCode:  "OPEN_CAMPAIGN",
			OfferReason: "Available to all users",
		}, nil
	}

	// Check source allowlist
	if len(audience.SourceAllowlist) > 0 {
		allowed := false
		for _, s := range audience.SourceAllowlist {
			if string(ec.DistributorType) == s {
				allowed = true
				break
			}
		}
		if !allowed {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "SOURCE_NOT_ALLOWED",
			}, nil
		}
	}

	// Check geo filters
	if len(audience.GeoCities) > 0 && ec.UserCity != "" {
		cityAllowed := false
		for _, city := range audience.GeoCities {
			if ec.UserCity == city {
				cityAllowed = true
				break
			}
		}
		if !cityAllowed {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "GEO_NOT_ALLOWED",
			}, nil
		}
	}

	// Check lifecycle predicates
	if audience.LifecyclePreds != nil {
		if result := e.checkLifecyclePredicates(ec, audience.LifecyclePreds); result != nil {
			return result, nil
		}
	}

	// Check eligibility rules
	if audience.EligibilityRules != nil {
		if result := e.checkEligibilityRules(ec, audience.EligibilityRules); result != nil {
			return result, nil
		}
	}

	return &EligibilityResult{
		Eligible:    true,
		ReasonCode:  "ELIGIBLE",
		OfferReason: "You qualify for this benefit",
	}, nil
}

func (e *EligibilityEngine) checkLifecyclePredicates(ec *EligibilityContext, preds map[string]any) *EligibilityResult {
	// min_account_age_days
	if v, ok := preds["min_account_age_days"].(float64); ok {
		minAge := time.Duration(v) * 24 * time.Hour
		if ec.AccountAge < minAge {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "ACCOUNT_TOO_NEW",
			}
		}
	}

	// max_redemptions
	if v, ok := preds["max_redemptions"].(float64); ok {
		if ec.TotalRedemptions >= int(v) {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "MAX_REDEMPTIONS_REACHED",
			}
		}
	}

	// require_first_visit
	if v, ok := preds["require_first_visit"].(bool); ok && v {
		if ec.HasVisitedScene {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "ALREADY_VISITED",
			}
		}
	}

	// min_days_since_last_redemption
	if v, ok := preds["min_days_since_last_redemption"].(float64); ok {
		if ec.DaysSinceLastRedemption < int(v) {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "TOO_RECENT_REDEMPTION",
			}
		}
	}

	return nil
}

func (e *EligibilityEngine) checkEligibilityRules(ec *EligibilityContext, rules map[string]any) *EligibilityResult {
	// allowed_roles
	if v, ok := rules["allowed_roles"].([]any); ok {
		roleAllowed := false
		for _, role := range v {
			if r, ok := role.(string); ok && ec.UserRole == r {
				roleAllowed = true
				break
			}
		}
		if !roleAllowed {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "ROLE_NOT_ALLOWED",
			}
		}
	}

	// require_scene_save
	if v, ok := rules["require_scene_save"].(bool); ok && v {
		// This would need a separate check against user's saved scenes
		// For R0, we skip this if the signal isn't available
	}

	// max_distance_meters
	if v, ok := rules["max_distance_meters"].(float64); ok {
		if ec.DistanceToScene > v {
			return &EligibilityResult{
				Eligible:   false,
				ReasonCode: "TOO_FAR_FROM_SCENE",
			}
		}
	}

	return nil
}

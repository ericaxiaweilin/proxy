package voucher

import (
	"context"
	"errors"
	"log"
	"strings"

	"github.com/proxy-app/proxy-api/internal/benefit"
)

// BenefitBridgePrefix marks a voucher ID as sourced from a real,
// merchant-funded benefit.Claim (see the benefit package) instead of this
// package's own storage.
//
// VOUCHER-DEFAULTS-001: this package no longer mints free vouchers itself
// (see ensureDefaults). The bridge is how a real merchant campaign
// (Campaign -> BenefitDefinition -> Claim, already claimed through
// benefit.HandleClaimBenefit) shows up in this same wallet UI/protocol.
//
// Read-only for now, deliberately. BENEFIT-REDEEM-002 requires whoever
// confirms a redemption to actually hold a role at the merchant business.
// This package's confirm/settle actions are consumer self-taps with no
// real merchant party in the loop — the mobile UI's own button labels say
// "模拟商家确认核销" / "模拟风控通过并结算". Bridging those buttons straight
// into benefit.RedeemBenefit would either get every real consumer rejected
// (correctly — they aren't merchant staff) or require impersonating a
// merchant identity server-side, which is the exact hole #1 closed, just
// moved to a new call site. So a bft_-sourced voucher is browsable but not
// redeemable through this package until a real merchant-facing entry point
// exists; isBenefitBridgeID gates openRedemption/confirmRedemption/
// settlement/settle to a clear, honest rejection instead.
const BenefitBridgePrefix = "bft_"

func isBenefitBridgeID(voucherID string) bool {
	return strings.HasPrefix(voucherID, BenefitBridgePrefix)
}

// BenefitBridge exposes exactly what the voucher wallet's read paths need
// from a user's real benefit claims.
type BenefitBridge interface {
	ListWallet(ctx context.Context, userID string) ([]Voucher, error)
	GetWallet(ctx context.Context, userID, voucherID string) (*Voucher, bool, error)
}

// benefitBridge adapts a benefit.Repository into the voucher wallet's
// Voucher shape.
type benefitBridge struct {
	repo benefit.Repository
}

// NewBenefitBridge builds a BenefitBridge over the given benefit.Service's
// repository. Wire it with Service.SetBenefitBridge in cmd/api/main.go once
// both services exist.
func NewBenefitBridge(svc *benefit.Service) BenefitBridge {
	return &benefitBridge{repo: svc.Repo()}
}

func (b *benefitBridge) ListWallet(ctx context.Context, userID string) ([]Voucher, error) {
	claims, err := b.repo.ListClaimsByUser(ctx, userID, nil)
	if err != nil {
		return nil, err
	}
	out := make([]Voucher, 0, len(claims))
	for i := range claims {
		v, err := b.project(ctx, &claims[i])
		if err != nil {
			log.Printf("voucher benefit bridge: project claim %s: %v", claims[i].ID, err)
			continue
		}
		out = append(out, *v)
	}
	return out, nil
}

func (b *benefitBridge) GetWallet(ctx context.Context, userID, voucherID string) (*Voucher, bool, error) {
	claimID := strings.TrimPrefix(voucherID, BenefitBridgePrefix)
	claim, err := b.repo.GetClaim(ctx, claimID)
	if errors.Is(err, benefit.ErrClaimNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if claim.UserID != userID {
		return nil, false, nil
	}
	v, err := b.project(ctx, claim)
	if err != nil {
		return nil, false, err
	}
	return v, true, nil
}

// project builds a Voucher-shaped read view of a benefit.Claim. Several
// fields have no real equivalent in the benefit model (RedeemTimeWindow,
// MinimumSpend, a distinct per-scope PerPersonLimit, the Proxy/Creator/
// Merchant funding split) — these are filled with honest, generic
// placeholders rather than invented numbers.
func (b *benefitBridge) project(ctx context.Context, claim *benefit.Claim) (*Voucher, error) {
	campaign, err := b.repo.GetCampaign(ctx, claim.CampaignID)
	if err != nil {
		return nil, err
	}
	def, err := b.repo.GetBenefitDefinition(ctx, claim.BenefitID)
	if err != nil {
		return nil, err
	}
	status := "AVAILABLE"
	switch claim.Status {
	case benefit.ClaimRedeemed:
		// benefit.HandleRedeemBenefit redeems and settles atomically in one
		// call (see createSettlements) — there is no separate "redeemed but
		// not yet settled" state to map to, unlike this package's own
		// multi-step OpenVoucherRedemption -> ConfirmVoucherRedemption ->
		// SettleVoucher flow.
		status = "SETTLED"
	case benefit.ClaimExpired, benefit.ClaimVoid, benefit.ClaimReleased:
		status = "EXPIRED"
	}
	return &Voucher{
		ID:               BenefitBridgePrefix + claim.ID,
		Family:           benefitKindToFamily(def.Kind),
		DisplayValue:     int(def.RetailValueMinor),
		Currency:         def.Currency,
		ScopeName:        campaign.Goal,
		ScopeDetail:      def.Label,
		ValidFrom:        campaign.StartAt.Format("2006-01-02"),
		ValidUntil:       campaign.EndAt.Format("2006-01-02"),
		RedeemTimeWindow: "活动有效期内",
		MinimumSpend:     "无",
		PerPersonLimit:   1,
		Status:           status,
		IssuerLabel:      campaign.OwnerID,
		SettlementValue:  int(def.RetailValueMinor - def.UserPayMinor),
		Version:          claim.Version,
	}, nil
}

func benefitKindToFamily(k benefit.BenefitKind) Family {
	switch k {
	case benefit.FreeDrink, benefit.FreeMeal:
		return Coffee
	case benefit.ActivityCredit:
		return Activity
	default:
		return Experience
	}
}

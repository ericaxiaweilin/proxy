package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-PROMO-002：专属码 / 留痕 / 发券在 Postgres 上能存能取，两条唯一约束
// （每人每码一张券、一张券只能核销一次）被映射成业务错误而不是内部错误。
func TestMerchantCreatorPromoRepositoryPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSupplyRepository(pool)
	run := itoa(time.Now().UnixNano())
	merchant, agent := "m_pair_"+run, "agent_pair_"+run
	code := "PT" + run[len(run)-6:] + "-SHOP"
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.promo_quotes WHERE merchant_id=$1`, merchant)
		_, _ = pool.Exec(bg, `DELETE FROM supply.promo_issues WHERE merchant_id=$1`, merchant)
		_, _ = pool.Exec(bg, `DELETE FROM supply.promo_changes WHERE code=$1`, code)
		_, _ = pool.Exec(bg, `DELETE FROM supply.merchant_creator_promos WHERE merchant_id=$1`, merchant)
	})
	now := time.Now().UTC().Truncate(time.Second)
	promo := supply.MerchantCreatorPromo{
		Code: code, MerchantID: merchant, MerchantName: "Shop", AgentID: agent, CreatorName: "An",
		Terms:  supply.PromoTerms{MinSpendVND: 500000, FaceValueVND: 50000, DisplayText: "满50万减5万", Scope: supply.PromoScopeCategory, Category: "测试品类" + run, ValidUntil: "2099-01-01"},
		Status: "ACTIVE", Mode: supply.PromoModeSuggested,
		Suggestion: supply.PromoSuggestion{PercentBP: 1000, MinSpendVND: 500000, FaceValueVND: 50000, Basis: []supply.PromoBasisItem{{Key: "followers", Label: "粉丝量级", Value: "1.2w（中腰部）", Available: true, EffectBP: 100}}},
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.SaveMerchantCreatorPromo(ctx, promo); err != nil {
		t.Fatalf("save promo: %v", err)
	}
	got, err := repo.GetMerchantCreatorPromoByPair(ctx, merchant, agent)
	if err != nil || got.Code != code || got.Terms.DisplayText != "满50万减5万" || len(got.Suggestion.Basis) != 1 {
		t.Fatalf("read by pair: %+v err=%v", got, err)
	}
	byCategory, err := repo.ListMerchantCreatorPromosByCategory(ctx, promo.Terms.Category)
	if err != nil || len(byCategory) != 1 {
		t.Fatalf("by category: %+v err=%v", byCategory, err)
	}
	got.Terms.MinSpendVND, got.Terms.ValidUntil, got.Mode = 0, "", supply.PromoModeManual
	if err := repo.UpdateMerchantCreatorPromo(ctx, got); err != nil {
		t.Fatalf("update: %v", err)
	}
	if err := repo.SavePromoChange(ctx, supply.PromoChange{ID: "pc_" + run, Code: code, ActorID: "u", Before: promo.Terms, After: got.Terms, Mode: supply.PromoModeManual, Note: "改无门槛", ChangedAt: now}); err != nil {
		t.Fatalf("save change: %v", err)
	}
	changes, err := repo.ListPromoChanges(ctx, code)
	if err != nil || len(changes) != 1 || changes[0].Before.MinSpendVND != 500000 || changes[0].After.MinSpendVND != 0 || changes[0].Note != "改无门槛" {
		t.Fatalf("change log: %+v err=%v", changes, err)
	}

	issue := supply.PromoIssue{ID: "cp_" + run, Code: code, MerchantID: merchant, AgentID: agent, CustomerID: "cust_" + run, IssuedAt: now}
	if err := repo.SavePromoIssue(ctx, issue); err != nil {
		t.Fatalf("issue: %v", err)
	}
	dup := issue
	dup.ID = "cp2_" + run
	if err := repo.SavePromoIssue(ctx, dup); !errors.Is(err, supply.ErrPromoAlreadyIssued) {
		t.Fatalf("second coupon for the same customer and code must be ErrPromoAlreadyIssued: %v", err)
	}
	if prior, err := repo.GetPromoIssueByCustomer(ctx, code, issue.CustomerID); err != nil || prior.ID != issue.ID {
		t.Fatalf("prior coupon: %+v err=%v", prior, err)
	}

	q := supply.PromoQuote{ID: "pq_" + run, MerchantID: merchant, AgentID: agent, Code: code, AmountVND: 600000, DiscountVND: 50000, FirstVisit: true, CustomerID: issue.CustomerID, IssueID: issue.ID, FirstVisitSource: "SYSTEM", QuotedAt: now}
	if err := repo.SavePromoQuote(ctx, q); err != nil {
		t.Fatalf("quote: %v", err)
	}
	q2 := q
	q2.ID = "pq2_" + run
	if err := repo.SavePromoQuote(ctx, q2); !errors.Is(err, supply.ErrCouponAlreadyRedeemed) {
		t.Fatalf("redeeming the same coupon twice must be ErrCouponAlreadyRedeemed: %v", err)
	}
	quotes, err := repo.ListPromoQuotesByMerchant(ctx, merchant)
	if err != nil || len(quotes) != 1 || quotes[0].IssueID != issue.ID || quotes[0].FirstVisitSource != "SYSTEM" || quotes[0].CustomerID != issue.CustomerID {
		t.Fatalf("quotes must carry coupon / customer / source: %+v err=%v", quotes, err)
	}
}

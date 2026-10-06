package postgres

// MARKET-FAST-001：撤回平台代选的「选中」对真库跑。
// 选中 A（B 随之落选）→ 撤回 A：A = SELECTION_EXPIRED，B 回到可选；A 再来确认被拒（不会两个人同时成单）。

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/marketplace"
)

func TestExpireSelectionReopensTheOthersAndBlocksALateConfirm(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMarketplaceRepository(pool)
	stamp := time.Now().Format("150405.000000")
	oppID, owner := "opp_expire_probe_"+stamp, "user_owner_"+stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.applications WHERE opportunity_id = $1`, oppID)
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.opportunities WHERE id = $1`, oppID)
	})
	if err := repo.Create(ctx, marketplace.Opportunity{ID: oppID, OwnerID: owner, Title: "probe", Location: "西湖", MatchingMode: "FAST"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	apply := func(who string) marketplace.Application {
		t.Helper()
		a, _, err := repo.Apply(ctx, marketplace.Application{ID: "app_" + who + "_" + stamp, OpportunityID: oppID, OwnerID: owner,
			ApplicantID: who + "_" + stamp, Quote: "800,000₫", Status: "SUBMITTED", CreatedAt: time.Now().UTC()})
		if err != nil {
			t.Fatalf("Apply %s: %v", who, err)
		}
		return a
	}
	a, b := apply("a"), apply("b")
	if _, err := repo.SelectApplication(ctx, oppID, a.ID, owner); err != nil {
		t.Fatalf("Select: %v", err)
	}
	if err := repo.ExpireSelection(ctx, oppID, a.ID, owner); err != nil {
		t.Fatalf("ExpireSelection: %v", err)
	}
	apps, err := repo.ListApplications(ctx, oppID, owner)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, x := range apps {
		got[x.ID] = x.Status
	}
	if got[a.ID] != "SELECTION_EXPIRED" || got[b.ID] != "SUBMITTED" {
		t.Fatalf("A expired, B selectable again: %v", got)
	}
	if _, err := repo.ConfirmApplication(ctx, a.ID, a.ApplicantID, "ord_late"); !errors.Is(err, marketplace.ErrApplicationStateConflict) {
		t.Fatalf("a late confirm on an expired selection must be refused, got %v", err)
	}
	if err := repo.ExpireSelection(ctx, oppID, a.ID, owner); !errors.Is(err, marketplace.ErrApplicationStateConflict) {
		t.Fatalf("expiring twice is a conflict, not a silent second write: %v", err)
	}
	if err := repo.ExpireSelection(ctx, oppID, b.ID, "someone_else"); !errors.Is(err, marketplace.ErrOpportunityNotFound) {
		t.Fatalf("only the owner's selection can be withdrawn: %v", err)
	}
}

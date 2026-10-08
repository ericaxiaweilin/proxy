package accountstatus

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRestrictedBlocksOutgoingActionsButNotTheRest(t *testing.T) {
	for _, c := range []string{"CreatePost", "PublishMarketOpportunity", "ApplyToMarketOpportunity", "SendMessage"} {
		if !Blocked(LevelRestricted, c) {
			t.Errorf("a restricted account must not %s", c)
		}
	}
	for _, c := range []string{"ListFeedPosts", "FileAppeal", "RequestPrivacyDelete", "CompleteOrder", "ListMyOrders"} {
		if Blocked(LevelRestricted, c) {
			t.Errorf("a restricted account may still %s (reading, finishing existing orders, appealing)", c)
		}
	}
	if Blocked("", "CreatePost") || Blocked("UNKNOWN_LEVEL", "CreatePost") {
		t.Error("no level (or an unknown one) never blocks")
	}
}

func TestSuspendedOnlyLeavesAppealConsentPrivacyAndLogout(t *testing.T) {
	for _, c := range []string{"FileAppeal", "RecordPurposeConsent", "RequestPrivacyExport", "RequestPrivacyDelete", "RevokeSession"} {
		if Blocked(LevelSuspended, c) {
			t.Errorf("a suspended account must still be able to %s", c)
		}
	}
	for _, c := range []string{"CreatePost", "ListFeedPosts", "AcceptOffer", "SendMessage", "AnythingNew"} {
		if !Blocked(LevelSuspended, c) {
			t.Errorf("a suspended account must not %s (and a command nobody listed is blocked by default)", c)
		}
	}
}

func TestSetAndLiftNeedReasonOperatorAndAKnownLevelAndLeaveAHistory(t *testing.T) {
	ctx := context.Background()
	mem := &Memory{}
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	svc := &Service{Store: mem, Now: func() time.Time { now = now.Add(time.Second); return now }}
	for name, err := range map[string]error{
		"no reason":    svc.Set(ctx, "u", LevelSuspended, " ", "", "op"),
		"no operator":  svc.Set(ctx, "u", LevelSuspended, "r", "", ""),
		"unknown":      svc.Set(ctx, "u", "BANNED_FOREVER", "r", "", "op"),
		"no user":      svc.Set(ctx, "", LevelRestricted, "r", "", "op"),
		"lift nothing": svc.Lift(ctx, "u", "r", "op"),
	} {
		if err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
	if len(mem.Changes) != 0 {
		t.Fatal("a refused change leaves no row")
	}
	if err := svc.Set(ctx, "u", LevelRestricted, "多次骚扰", "rep_1", "op"); err != nil {
		t.Fatal(err)
	}
	if lvl, _ := svc.LevelOf(ctx, "u"); lvl != LevelRestricted {
		t.Fatalf("level = %q", lvl)
	}
	if err := svc.Set(ctx, "u", LevelSuspended, "升级", "rep_1", "op"); err != nil {
		t.Fatal(err)
	}
	if lvl, _ := svc.LevelOf(ctx, "u"); lvl != LevelSuspended {
		t.Fatalf("a newer SET replaces the old level (cache invalidated), got %q", lvl)
	}
	if err := svc.Lift(ctx, "u", "申诉成立", "op2"); err != nil {
		t.Fatal(err)
	}
	if lvl, _ := svc.LevelOf(ctx, "u"); lvl != "" {
		t.Fatalf("lifted: level = %q", lvl)
	}
	if len(mem.Changes) != 3 || mem.Changes[2].Action != "LIFT" || mem.Changes[0].ReportID != "rep_1" {
		t.Fatalf("history is append-only with who/why/which report: %+v", mem.Changes)
	}
	if active, _ := svc.ListActive(ctx); len(active) != 0 {
		t.Fatalf("nobody is restricted any more: %v", active)
	}
}

type brokenStore struct{ Memory }

func (*brokenStore) Current(context.Context, string) (Active, bool, error) {
	return Active{}, false, errors.New("db down")
}

func TestAnUnreadableStatusSurfacesAsAnErrorSoTheCallerCanFailOpenAndLog(t *testing.T) {
	svc := &Service{Store: &brokenStore{}}
	if _, err := svc.LevelOf(context.Background(), "u"); err == nil {
		t.Fatal("the read error must reach the caller")
	}
	var nilSvc *Service
	if lvl, err := nilSvc.LevelOf(context.Background(), "u"); lvl != "" || err != nil {
		t.Fatal("no service configured means no restriction")
	}
}

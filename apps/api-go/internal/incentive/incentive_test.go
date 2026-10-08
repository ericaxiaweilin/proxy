package incentive

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestRulesCanOnlyRewardVouchersOrGrowthPointsNeverCash(t *testing.T) {
	ok := Rule{Label: "首帖咖啡券", Trigger: TriggerFirstPost, RewardKind: RewardBenefitClaim, CampaignID: "c1", BenefitID: "b1", CreatedBy: "op"}
	if err := Validate(ok); err != nil {
		t.Fatalf("a voucher rule is fine: %v", err)
	}
	if err := Validate(Rule{Label: "首单成长值", Trigger: TriggerFirstDemand, RewardKind: RewardGrowthPoints, Points: 20, CreatedBy: "op"}); err != nil {
		t.Fatalf("a growth rule is fine: %v", err)
	}
	for _, kind := range []string{"CASH", "MONEY", "WALLET_CREDIT", "RED_PACKET", "BALANCE", "cash", ""} {
		bad := ok
		bad.RewardKind = kind
		if Validate(bad) != ErrBadReward {
			t.Errorf("reward kind %q must be refused: cash is not allowed", kind)
		}
	}
	for name, bad := range map[string]Rule{
		"no benefit":           {Label: "x", Trigger: TriggerFirstPost, RewardKind: RewardBenefitClaim, CampaignID: "c", CreatedBy: "op"},
		"voucher with points":  {Label: "x", Trigger: TriggerFirstPost, RewardKind: RewardBenefitClaim, CampaignID: "c", BenefitID: "b", Points: 5, CreatedBy: "op"},
		"zero points":          {Label: "x", Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, CreatedBy: "op"},
		"too many points":      {Label: "x", Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, Points: MaxPoints + 1, CreatedBy: "op"},
		"points with campaign": {Label: "x", Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, Points: 5, CampaignID: "c", CreatedBy: "op"},
		"unknown trigger":      {Label: "x", Trigger: "ALWAYS", RewardKind: RewardGrowthPoints, Points: 5, CreatedBy: "op"},
		"no label":             {Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, Points: 5, CreatedBy: "op"},
		"no operator":          {Label: "x", Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, Points: 5},
	} {
		if Validate(bad) == nil {
			t.Errorf("%s must be refused", name)
		}
	}
}

type memStore struct {
	rules  []Rule
	cand   map[string][]string
	grants map[string]Grant
}

func (m *memStore) ListRules(context.Context) ([]Rule, error) { return m.rules, nil }
func (m *memStore) UpsertRule(context.Context, Rule) error    { return nil }
func (m *memStore) SetActive(context.Context, string, bool, time.Time) (bool, error) {
	return true, nil
}
func (m *memStore) Candidates(_ context.Context, r Rule, _ time.Time, _ int) ([]string, error) {
	var out []string
	for _, id := range m.cand[r.ID] {
		if _, done := m.grants[r.ID+"|"+id]; !done {
			out = append(out, id)
		}
	}
	return out, nil
}
func (m *memStore) RecordGrant(_ context.Context, g Grant) (bool, error) {
	k := g.RuleID + "|" + g.UserID
	if _, ok := m.grants[k]; ok {
		return false, nil
	}
	m.grants[k] = g
	return true, nil
}
func (m *memStore) GrantsOf(context.Context, string) ([]Grant, error) { return nil, nil }
func (m *memStore) Stats(context.Context) ([]RuleStat, error)         { return nil, nil }

type fakeClaimer struct {
	outcomes map[string]ClaimOutcome
	calls    int
}

func (f *fakeClaimer) Claim(_ context.Context, user, _, _ string) (string, ClaimOutcome, string, error) {
	f.calls++
	return "clm_" + user, f.outcomes[user], "ELIGIBILITY_FAILED", nil
}

type countNotify struct{ n int }

func (c *countNotify) Granted(context.Context, string, string, string, int) error { c.n++; return nil }

func TestGrantsAreIdempotentSkipInactiveRulesRestrictedPeopleAndRetryTransientFailures(t *testing.T) {
	ctx := context.Background()
	seq := 0
	newID := func() string { seq++; return fmt.Sprintf("g%d", seq) }
	st := &memStore{
		rules: []Rule{
			{ID: "voucher", Label: "咖啡券", Trigger: TriggerFirstPost, RewardKind: RewardBenefitClaim, CampaignID: "c", BenefitID: "b", Active: true},
			{ID: "points", Label: "成长值", Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, Points: 10, Active: true},
			{ID: "off", Label: "关着", Trigger: TriggerFirstPost, RewardKind: RewardGrowthPoints, Points: 99, Active: false},
		},
		cand:   map[string][]string{"voucher": {"ok", "full", "ineligible", "banned"}, "points": {"ok", "banned"}, "off": {"ok"}},
		grants: map[string]Grant{},
	}
	claimer := &fakeClaimer{outcomes: map[string]ClaimOutcome{"ok": ClaimOK, "full": ClaimTransient, "ineligible": ClaimFinal, "banned": ClaimOK}}
	notify := &countNotify{}
	banned := func(_ context.Context, id string) bool { return id == "banned" }

	n, err := RunGrants(ctx, st, claimer, notify, banned, time.Now(), 100, newID)
	if err != nil || n != 2 || notify.n != 2 {
		t.Fatalf("ok gets a voucher and points; banned/full/ineligible get nothing now: n=%d notify=%d err=%v", n, notify.n, err)
	}
	if _, has := st.grants["off|ok"]; has {
		t.Fatal("an inactive rule never grants")
	}
	if g := st.grants["voucher|ineligible"]; g.Status != StatusFailed || g.Error == "" {
		t.Fatalf("a final refusal is recorded so it is not retried: %+v", g)
	}
	if _, has := st.grants["voucher|full"]; has {
		t.Fatal("a transient failure (no capacity) writes nothing, so the next round retries")
	}
	before := claimer.calls
	n, _ = RunGrants(ctx, st, claimer, notify, banned, time.Now(), 100, newID)
	if n != 0 || notify.n != 2 {
		t.Fatalf("a second run grants nothing new twice: n=%d notify=%d", n, notify.n)
	}
	if claimer.calls != before+1 { // 只有 "full" 会再试一次
		t.Fatalf("only the transient one is retried, got %d extra claims", claimer.calls-before)
	}
	claimer.outcomes["full"] = ClaimOK // 名额补上了
	if n, _ = RunGrants(ctx, st, claimer, notify, banned, time.Now(), 100, newID); n != 1 {
		t.Fatalf("once capacity returns, the person who missed out is served: %d", n)
	}
}

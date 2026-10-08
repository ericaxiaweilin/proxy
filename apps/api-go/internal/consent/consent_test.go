package consent

import (
	"strings"
	"testing"
)

func TestPurposesAreSeparateAndTheOldBundleCannotBeGrantedAnymore(t *testing.T) {
	for _, code := range []string{Recommendation, TwinInsight, OperatorAudienceDetail} {
		if !Grantable(code) {
			t.Fatalf("%s is offered to users", code)
		}
	}
	if Grantable(AdTargeting) {
		t.Fatal("ad targeting has no user-facing text yet: nobody can consent to a sentence they never saw")
	}
	if Grantable(LegacyBehaviorAnalytics) || !Withdrawable(LegacyBehaviorAnalytics) {
		t.Fatal("the retired one-switch consent cannot be granted again but can always be withdrawn")
	}
	if Grantable("MADE_UP") || Withdrawable("MADE_UP") {
		t.Fatal("an unregistered purpose is not a purpose")
	}
	if !Withdrawable(AdTargeting) {
		t.Fatal("withdrawal is never blocked, even for a purpose that is not offered yet")
	}
}

func TestOnlyOfferedBehaviorPurposesOpenTheCaptureGate(t *testing.T) {
	got := strings.Join(CapturePurposes(), ",")
	if got != "OPERATOR_AUDIENCE_DETAIL,RECOMMENDATION,TWIN_INSIGHT" {
		t.Fatalf("capture purposes: %s", got)
	}
}

func TestEveryPurposeHasItsOwnPolicyVersionAndTheLegacyOneIsFrozen(t *testing.T) {
	for _, p := range All() {
		if p.PolicyVersion == "" {
			t.Fatalf("%s needs a policy version", p.Code)
		}
	}
	if PolicyVersion(LegacyBehaviorAnalytics) != "2026-09-27" {
		t.Fatal("the legacy version is what the old consents were recorded under; it must not move")
	}
}

func TestValidAtSQLIsOneRuleAndPanicsOnATypo(t *testing.T) {
	sql := ValidAtSQL("e.actor_id", "e.created_at", Recommendation)
	for _, want := range []string{"c.user_id = e.actor_id", "c.purpose = 'RECOMMENDATION'", "c.policy_version = '2026-10-08'", "c.acted_at <= e.created_at", "= 'GRANT'"} {
		if !strings.Contains(sql, want) {
			t.Fatalf("missing %q in %s", want, sql)
		}
	}
	if strings.Count(sql, "= 'GRANT'") != 2 {
		t.Fatal("valid at the event time AND still valid now: two checks")
	}
	defer func() {
		if recover() == nil {
			t.Fatal("a mistyped purpose must fail loudly, not silently match nothing")
		}
	}()
	ValidAtSQL("u", "t", "RECOMENDATION")
}

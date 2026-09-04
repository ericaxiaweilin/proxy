package aiboundary

import "testing"

// TestAIEconomicAndParticipationBoundary locks in the
// "no AI actor performs a consequential action" rule. It must
// remain exhaustive: every AI kind × every Action is rejected.
// A future expansion to a new Action must explicitly add the
// case in Allows() and a paired allow/human test here.
func TestAIEconomicAndParticipationBoundary(t *testing.T) {
	for _, kind := range AllAIActorKinds {
		for _, action := range AllActions {
			if Allows(kind, action) {
				t.Fatalf("%s must not perform %s", kind, action)
			}
		}
	}
	if !Allows(Human, ApplyOpportunity) || !Allows(Human, JoinActivity) {
		t.Fatal("human actions unexpectedly blocked")
	}
}

// TestHumanActionsAreOpen verifies the dual half of the rule:
// HUMAN may perform every action in the closed set. Adding a new
// Action must not regress this — if the action is human-only,
// it must continue to allow HUMAN.
func TestHumanActionsAreOpen(t *testing.T) {
	for _, action := range AllActions {
		if !Allows(Human, action) {
			t.Fatalf("HUMAN must be allowed to perform %s", action)
		}
	}
}

// TestFromCommandIdentityClassification covers the alias set:
// AI_NATIVE / PLATFORM_AI → PlatformAI, AI_TWIN / USER_TWIN →
// UserTwin, AI_ASSISTANT / USER_ASSISTANT → UserAssistant, and
// that every other type (USER / PUBLIC / SYSTEM / INDIVIDUAL /
// BUSINESS / unknown / whitespace / mixed case) resolves to HUMAN
// (fail-widen for further auth checks, not fail-narrow).
func TestFromCommandIdentityClassification(t *testing.T) {
	cases := []struct {
		actor     string
		principal string
		want      ActorKind
	}{
		{"AI_NATIVE", "", PlatformAI},
		{"PLATFORM_AI", "", PlatformAI},
		{" platform_ai ", "INDIVIDUAL", PlatformAI}, // mixed case + trailing space, principal can't win
		{"AI_TWIN", "", UserTwin},
		{"USER_TWIN", "", UserTwin},
		{"AI_ASSISTANT", "", UserAssistant},
		{"USER_ASSISTANT", "", UserAssistant},

		// PUBLIC / SYSTEM / empty → HUMAN (the public reader
		// path is not an AI actor; the membership tier check
		// downstream still rejects).
		{"PUBLIC", "PUBLIC", Human},
		{"SYSTEM", "", Human},
		{"USER", "INDIVIDUAL", Human},
		{"USER", "BUSINESS", Human},
		{"OPERATOR", "BUSINESS", Human},

		// Principal takes precedence when it names an AI.
		// An OPERATOR acting on a USER_TWIN principal is still
		// acting *as* the user twin's representative — the
		// likeness/consent gate downstream owns the rest of
		// the authorization, not this classification.
		{"USER", "USER_TWIN", UserTwin},
		{"OPERATOR", "USER_ASSISTANT", UserAssistant},

		// Unknown / whitespace / empty.
		{"", "", Human},
		{"  ", "\t", Human},
		{"some-other-type", "another-type", Human},
	}
	for _, c := range cases {
		got := FromCommandIdentity(c.actor, c.principal)
		if got != c.want {
			t.Fatalf("FromCommandIdentity(%q,%q) = %s, want %s", c.actor, c.principal, got, c.want)
		}
	}
}

// TestAllowsIsFailClosedOnUnknownAction documents that adding a
// new Action constant without updating Allows() will deny AI by
// default. The point is to make the "AI always forbidden" rule
// survive a future enum extension: any oversight must land on
// the safe side (AI forbidden). HUMAN intentionally always returns
// true today (HUMAN never blocked); this test only asserts the AI
// half so that we don't accidentally regress the AI boundary.
func TestAllowsIsFailClosedOnUnknownAction(t *testing.T) {
	const fakeAction Action = "FAKE_NOT_YET_DEFINED"
	if Allows(PlatformAI, fakeAction) || Allows(UserTwin, fakeAction) || Allows(UserAssistant, fakeAction) {
		t.Fatal("Allows() must default-deny every AI actor for unknown actions until paired with a case statement")
	}
}
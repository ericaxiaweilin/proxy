package conversation

import (
	"testing"
	"time"
)

// COMP-CHAT-001: a conversation that carries money between two users must
// keep an auditable thread. Anti-leak controls (burn-after-read, view caps,
// screenshot blocking) are a privacy feature; on a paid engagement they turn
// the thread into a place where the meeting can be arranged and then erased.
// That is the fact pattern used to argue the platform facilitated brokering,
// which is a criminal exposure for the operators, not a fine.

func TestTransactionLinkedOriginsAreRecognised(t *testing.T) {
	for _, origin := range []string{"TASK", "SERVICE", "ACTIVITY", "NEED", "OFFER", "ORDER"} {
		if !IsTransactionLinkedOrigin(origin) {
			t.Fatalf("origin %q carries money but is not treated as transaction-linked", origin)
		}
	}
	for _, origin := range []string{"HOME", "POST", "PROFILE", ""} {
		if IsTransactionLinkedOrigin(origin) {
			t.Fatalf("origin %q is social only but is treated as transaction-linked", origin)
		}
	}
}

func TestTransactionLinkedProtectionIsAuditable(t *testing.T) {
	p := TransactionLinkedProtection()
	if p.ViewLimit != 0 {
		t.Fatalf("transaction thread must not be view-capped, got %d", p.ViewLimit)
	}
	if p.ExpiresAt != nil {
		t.Fatalf("transaction thread must not expire, got %v", *p.ExpiresAt)
	}
	if !p.Forwardable {
		t.Fatal("transaction thread must stay forwardable so evidence survives")
	}
	if p.ScreenshotProtected {
		t.Fatal("transaction thread must not block screenshots")
	}
}

// The dangerous case: a client quietly re-enables burn-after-read on a paid
// engagement. The server must refuse, not honour it.
func TestApplyWithPolicyRefusesEphemeralOverridesOnTransaction(t *testing.T) {
	now := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	policy := PolicyForOrigin("ORDER")
	ttl := 60 * time.Second
	limit := 1
	yes := true

	cases := []struct {
		name     string
		override ProtectionOverride
	}{
		{"burn after read", ProtectionOverride{TTL: &ttl}},
		{"view cap", ProtectionOverride{ViewLimit: &limit}},
		{"screenshot warning on", ProtectionOverride{Warn: &yes}},
		{"disable forward", ProtectionOverride{Forwardable: newFalse()}},
		{"disable copy", ProtectionOverride{Copyable: newFalse()}},
	}
	for _, c := range cases {
		if _, err := ApplyWithPolicy(TransactionLinkedProtection(), c.override, now, policy); err != ErrEphemeralNotAllowed {
			t.Fatalf("%s: expected ErrEphemeralNotAllowed, got %v", c.name, err)
		}
	}
}

// Social conversations keep the privacy feature — this must not become a
// blanket removal of a user-facing capability.
func TestApplyWithPolicyStillAllowsEphemeralOnSocial(t *testing.T) {
	now := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	policy := PolicyForOrigin("HOME")
	ttl := 60 * time.Second
	got, err := ApplyWithPolicy(MessageProtection{Forwardable: true}, ProtectionOverride{TTL: &ttl}, now, policy)
	if err != nil {
		t.Fatalf("social conversation should still allow a TTL, got %v", err)
	}
	if got.ExpiresAt == nil {
		t.Fatal("social conversation TTL was dropped")
	}
}

// Negative control: if someone adds a new paid origin type and forgets to
// register it, this fails. Keeps the list honest.
func TestPolicyForOriginLocksEveryPaidOrigin(t *testing.T) {
	for origin := range TransactionLinkedOrigins {
		p := PolicyForOrigin(origin)
		if p.AllowTTL || p.AllowViewLimit || p.AllowAntiLeak {
			t.Fatalf("origin %q is registered as paid but policy still allows ephemerality: %+v", origin, p)
		}
	}
}

func newFalse() *bool {
	v := false
	return &v
}

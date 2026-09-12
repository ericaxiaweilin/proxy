package identity

import (
	"context"
	"errors"
	"testing"
)

// COMP-ID-001: a persona that erases itself is incompatible with selling.
// Vietnam's E-commerce Law 122/2025 (in force 2026-07-01) bans anonymous
// selling, and burning an identity also destroyed every conversation,
// message and media tied to it — i.e. the record of the paid engagements.

type stubTransactionLookup struct {
	transacted bool
	err        error
	calls      int
}

func (s *stubTransactionLookup) HasTransacted(_ context.Context, _ string) (bool, error) {
	s.calls++
	return s.transacted, s.err
}

func TestBurnerRefusedForAccountThatTransacted(t *testing.T) {
	lookup := &stubTransactionLookup{transacted: true}
	ok, err := BurnerAllowedFor(context.Background(), lookup, "user_1", DisplayIdentityBurner)
	if ok {
		t.Fatal("an account that has transacted must not get a self-destructing persona")
	}
	if !errors.Is(err, ErrBurnerForbiddenForTransactingAccount) {
		t.Fatalf("expected ErrBurnerForbiddenForTransactingAccount, got %v", err)
	}
}

func TestBurnerAllowedForAccountWithoutTransactions(t *testing.T) {
	lookup := &stubTransactionLookup{transacted: false}
	ok, err := BurnerAllowedFor(context.Background(), lookup, "user_1", DisplayIdentityBurner)
	if !ok || err != nil {
		t.Fatalf("a non-transacting account should still be allowed a burner, got ok=%v err=%v", ok, err)
	}
}

// Fail closed: if we cannot tell whether the account transacted, the answer
// is no. "We could not check" must never become "allowed".
func TestBurnerRefusedWhenLookupIsMissing(t *testing.T) {
	ok, err := BurnerAllowedFor(context.Background(), nil, "user_1", DisplayIdentityBurner)
	if ok {
		t.Fatal("missing lookup must fail closed, not allow")
	}
	if !errors.Is(err, ErrBurnerForbiddenForTransactingAccount) {
		t.Fatalf("expected ErrBurnerForbiddenForTransactingAccount, got %v", err)
	}
}

func TestBurnerRefusedWhenLookupErrors(t *testing.T) {
	lookup := &stubTransactionLookup{err: errors.New("ledger unavailable")}
	if ok, _ := BurnerAllowedFor(context.Background(), lookup, "user_1", DisplayIdentityBurner); ok {
		t.Fatal("a lookup failure must not be treated as permission")
	}
}

// Personas are a presentation layer, not an anonymity layer. The ordinary
// ones stay available to everybody, including people who earn money.
func TestNonBurnerPersonasRemainAvailableToTransactingAccounts(t *testing.T) {
	lookup := &stubTransactionLookup{transacted: true}
	for _, typ := range []DisplayIdentityType{DisplayIdentityPublic, DisplayIdentityPrivate} {
		ok, err := BurnerAllowedFor(context.Background(), lookup, "user_1", typ)
		if !ok || err != nil {
			t.Fatalf("%s must stay available to a transacting account, got ok=%v err=%v", typ, ok, err)
		}
	}
	if lookup.calls != 0 {
		t.Fatalf("non-burner personas should not need a transaction lookup, called %d times", lookup.calls)
	}
}

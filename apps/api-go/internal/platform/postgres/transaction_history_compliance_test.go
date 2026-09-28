package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// COMP-ID-002 — the burner-persona guard is only as good as the answer it
// gets to "has this account transacted?". These tests pin the production
// lookup to the real money tables.
//
// The pair that matters most is the last one plus the "no money" one:
//   - an implementation that always answers "no transactions" would hand a
//     self-destructing persona to a seller;
//   - an implementation that always answers "yes" would look compliant while
//     destroying the feature for everyone and, worse, would train the team to
//     route around the guard.
// TestTransactionHistoryAllowsBurnerForAccountWithNoMoney pins the second
// case so the guard cannot degrade into a blanket refusal.

func uniqueID(prefix string) string {
	return prefix + time.Now().Format("150405.000000")
}

func seedPaymentIntent(t *testing.T, pool *pgxpool.Pool, intentID, orderID, requesterID, agentID string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO payment.payment_intents
		(id, order_id, requester_id, agent_id, amount_minor, currency, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,1000,'VND','PENDING',$5,$5)`, intentID, orderID, requesterID, agentID, now)
	if err != nil {
		t.Fatalf("seed payment intent: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM payment.payment_intents WHERE id=$1`, intentID)
	})
}

func seedPayoutHold(t *testing.T, pool *pgxpool.Pool, holdID, orderID, agentID string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO payment.payout_holds
		(id, order_id, agent_id, amount_minor, currency, status, created_at)
		VALUES ($1,$2,$3,1000,'VND','HELD',$4)`, holdID, orderID, agentID, now)
	if err != nil {
		t.Fatalf("seed payout hold: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM payment.payout_holds WHERE id=$1`, holdID)
	})
}

func seedSettledOrder(t *testing.T, pool *pgxpool.Pool, orderID, requesterID, agentID string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO fulfillment.orders
		(id, requester_id, agent_id, need_id, lifecycle, version, snapshot, amendments, settlement, created_at, updated_at)
		VALUES ($1,$2,$3,'need_comp_id002','CONFIRMED',1,'{}','[]','{}',$4,$4)`, orderID, requesterID, agentID, now)
	if err != nil {
		t.Fatalf("seed settled order: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM fulfillment.orders WHERE id=$1`, orderID)
	})
}

func seedLedgerEntry(t *testing.T, pool *pgxpool.Pool, entryID, orderID string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO payment.ledger_entries
		(id, payment_intent_id, order_id, entry_type, amount_minor, currency, created_at)
		VALUES ($1,NULL,$2,'CREDIT_HOLD',1000,'VND',$3)`, entryID, orderID, now)
	if err != nil {
		t.Fatalf("seed ledger entry: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM payment.ledger_entries WHERE id=$1`, entryID)
	})
}

func TestTransactionHistoryDetectsPayingRequester(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	userID := uniqueID("user_comp_id002_payer_")
	seedPaymentIntent(t, pool, uniqueID("pi_comp_id002_"), uniqueID("order_comp_id002_"), userID, "agent_comp_id002_other")

	transacted, err := repo.HasTransacted(context.Background(), userID)
	if err != nil {
		t.Fatalf("HasTransacted: %v", err)
	}
	if !transacted {
		t.Fatal("an account that appears as requester on a payment intent must be treated as having transacted")
	}
}

func TestTransactionHistoryDetectsEarningAgent(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	agentID := uniqueID("agent_comp_id002_earner_")
	seedPaymentIntent(t, pool, uniqueID("pi_comp_id002_"), uniqueID("order_comp_id002_"), "user_comp_id002_other", agentID)

	transacted, err := repo.HasTransacted(context.Background(), agentID)
	if err != nil {
		t.Fatalf("HasTransacted: %v", err)
	}
	if !transacted {
		t.Fatal("an account that appears as agent on a payment intent must be treated as having transacted")
	}
}

func TestTransactionHistoryDetectsHeldPayout(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	agentID := uniqueID("agent_comp_id002_hold_")
	seedPayoutHold(t, pool, uniqueID("hold_comp_id002_"), uniqueID("order_comp_id002_"), agentID)

	transacted, err := repo.HasTransacted(context.Background(), agentID)
	if err != nil {
		t.Fatalf("HasTransacted: %v", err)
	}
	if !transacted {
		t.Fatal("an account with funds held for payout must be treated as having transacted")
	}
}

func TestTransactionHistoryDetectsLedgerEntryOnOrder(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	userID := uniqueID("user_comp_id002_ledger_")
	orderID := uniqueID("order_comp_id002_ledger_")
	seedSettledOrder(t, pool, orderID, userID, "agent_comp_id002_other")
	seedLedgerEntry(t, pool, uniqueID("le_comp_id002_"), orderID)

	transacted, err := repo.HasTransacted(context.Background(), userID)
	if err != nil {
		t.Fatalf("HasTransacted: %v", err)
	}
	if !transacted {
		t.Fatal("an account party to an order carrying ledger entries must be treated as having transacted")
	}
}

func TestTransactionHistoryReportsFalseForAccountWithNoMoney(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	// Deliberately unknown on every money table.
	transacted, err := repo.HasTransacted(context.Background(), uniqueID("user_comp_id002_clean_"))
	if err != nil {
		t.Fatalf("HasTransacted: %v", err)
	}
	if transacted {
		t.Fatal("an account with no money history must not be reported as having transacted")
	}
}

// Database-free: an empty account id is a caller bug, and answering
// optimistically would grant a self-destructing persona to an unknown party.
func TestTransactionHistoryRefusesEmptyAccountID(t *testing.T) {
	repo := NewTransactionHistoryRepository(nil)
	if _, err := repo.HasTransacted(context.Background(), "   "); !errors.Is(err, ErrTransactionHistoryAccountIDRequired) {
		t.Fatalf("want ErrTransactionHistoryAccountIDRequired, got %v", err)
	}
}

// Database-free: no pool must surface as an error (which identity turns into
// a refusal), never as "no transactions".
func TestTransactionHistoryRefusesWhenPoolMissing(t *testing.T) {
	repo := NewTransactionHistoryRepository(nil)
	if _, err := repo.HasTransacted(context.Background(), "user_1"); !errors.Is(err, ErrTransactionHistoryUnavailable) {
		t.Fatalf("want ErrTransactionHistoryUnavailable, got %v", err)
	}
	ok, err := identity.BurnerAllowedFor(context.Background(), repo, "user_1", identity.DisplayIdentityBurner)
	if err == nil || ok {
		t.Fatalf("a lookup with no pool must fail closed, got ok=%v err=%v", ok, err)
	}
}

// End-to-end through the domain guard: real money row in a real table must
// turn into a refused burner persona.
func TestBurnerRefusedForAccountWithRealPaymentIntent(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	userID := uniqueID("user_comp_id002_burnrefuse_")
	seedPaymentIntent(t, pool, uniqueID("pi_comp_id002_"), uniqueID("order_comp_id002_"), userID, "agent_comp_id002_other")

	ok, err := identity.BurnerAllowedFor(context.Background(), repo, userID, identity.DisplayIdentityBurner)
	if ok {
		t.Fatal("an account with a real payment intent must not be allowed a self-destructing persona")
	}
	// The refusal carries the reason so the API can explain it to the user
	// instead of returning a bare 400.
	if !errors.Is(err, identity.ErrBurnerForbiddenForTransactingAccount) {
		t.Fatalf("want ErrBurnerForbiddenForTransactingAccount, got %v", err)
	}
}

// The counterweight: the guard may not collapse into a blanket refusal.
func TestTransactionHistoryAllowsBurnerForAccountWithNoMoney(t *testing.T) {
	pool := testPool(t)
	repo := NewTransactionHistoryRepository(pool)
	userID := uniqueID("user_comp_id002_burnallow_")

	ok, err := identity.BurnerAllowedFor(context.Background(), repo, userID, identity.DisplayIdentityBurner)
	if err != nil {
		t.Fatalf("BurnerAllowedFor: %v", err)
	}
	if !ok {
		t.Fatal("an account with no money history must still be allowed a burner persona, otherwise the guard has degraded into a blanket refusal")
	}
}

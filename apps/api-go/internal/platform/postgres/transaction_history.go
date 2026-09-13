package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// COMP-ID-002 — "has this account ever had money move through Proxy?"
//
// COMP-ID-001 refuses self-destructing (BURNER) personas to any account that
// has transacted, and fails closed when the answer cannot be determined. That
// contract is only worth something if the answer comes from the real money
// tables. A lookup that always answers "no" would silently re-open the hole:
// every seller would look transaction-free, and Vietnam's E-commerce Law
// 122/2025 (in force 2026-07-01, anonymous selling banned) would be defeated
// by nothing more than a stub.
//
// This adapter is the production implementation of
// identity.TransactionHistoryLookup. It answers from four money-side sources
// and treats any of them as proof:
//
//  1. payment.payment_intents  — a payment was attempted for/against the
//     account. Counted regardless of final status: a PENDING intent still
//     means the account is in the money flow.
//  2. payment.payout_holds     — funds were held for the account as agent.
//  3. payment.ledger_entries   — an append-only ledger row exists on an
//     order the account is a party to (joined through fulfillment.orders).
//  4. fulfillment.orders       — an order reached settlement.
//
// The read is deliberately over-inclusive. Being wrong in the direction of
// "this account has transacted" only costs the account a burner persona;
// being wrong the other way costs the platform its seller traceability.
type TransactionHistoryRepository struct {
	pool *pgxpool.Pool
}

// ErrTransactionHistoryAccountIDRequired is returned when the caller asks
// about an empty account id. We refuse rather than answer "no transactions",
// because an empty id is a caller bug and answering optimistically would
// grant a self-destructing persona to an unknown party.
var ErrTransactionHistoryAccountIDRequired = errors.New("transaction history requires a user account id")

// ErrTransactionHistoryUnavailable is returned when the repository exists but
// has no pool. Identity treats any error as "not allowed", so this fails
// closed instead of degrading to an open door.
var ErrTransactionHistoryUnavailable = errors.New("transaction history is unavailable")

func NewTransactionHistoryRepository(pool *pgxpool.Pool) *TransactionHistoryRepository {
	return &TransactionHistoryRepository{pool: pool}
}

const hasTransactedSQL = `
SELECT
    EXISTS (
        SELECT 1 FROM payment.payment_intents pi
        WHERE pi.requester_id = $1 OR pi.agent_id = $2
    )
    OR EXISTS (
        SELECT 1 FROM payment.payout_holds ph
        WHERE ph.agent_id = $3
    )
    OR EXISTS (
        SELECT 1 FROM payment.ledger_entries le
        JOIN fulfillment.orders lo ON lo.id = le.order_id
        WHERE lo.requester_id = $4 OR lo.agent_id = $5
    )
    OR EXISTS (
        SELECT 1 FROM fulfillment.orders o
        WHERE (o.requester_id = $6 OR o.agent_id = $7) AND o.settlement IS NOT NULL
    )`

// HasTransacted reports whether money has moved through the platform for
// this account, on either side of the transaction.
func (r *TransactionHistoryRepository) HasTransacted(ctx context.Context, userAccountID string) (bool, error) {
	id := strings.TrimSpace(userAccountID)
	if id == "" {
		return false, ErrTransactionHistoryAccountIDRequired
	}
	// A typed-nil repository still satisfies the interface; without this
	// guard the caller would get a nil-pointer panic instead of a refusal.
	if r == nil || r.pool == nil {
		return false, ErrTransactionHistoryUnavailable
	}
	var transacted bool
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx, hasTransactedSQL,
		id, id, id, id, id, id, id).Scan(&transacted); err != nil {
		return false, err
	}
	return transacted, nil
}

// Compile-time proof that the production adapter satisfies the domain
// contract the identity guard depends on. If the signature drifts, the build
// breaks here rather than silently failing open at runtime.
var _ identity.TransactionHistoryLookup = (*TransactionHistoryRepository)(nil)

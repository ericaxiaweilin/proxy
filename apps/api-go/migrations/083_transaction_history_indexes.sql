-- COMP-ID-002: "has this account transacted?" is now asked on every attempt
-- to create or burn a self-destructing persona (see
-- internal/platform/postgres/transaction_history.go). The four sources it
-- reads are keyed by party, not by order, so without these indexes the
-- compliance guard degrades into sequential scans as the ledger grows —
-- and a guard that is too slow to run is a guard that gets removed.
--
-- Additive only: IF NOT EXISTS, no column or constraint changes.

CREATE INDEX IF NOT EXISTS idx_payment_intents_requester
    ON payment.payment_intents (requester_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_agent
    ON payment.payment_intents (agent_id);

CREATE INDEX IF NOT EXISTS idx_payout_holds_agent
    ON payment.payout_holds (agent_id);

CREATE INDEX IF NOT EXISTS idx_orders_requester
    ON fulfillment.orders (requester_id);

CREATE INDEX IF NOT EXISTS idx_orders_agent
    ON fulfillment.orders (agent_id);

-- Only settled orders matter for source (4); a partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_orders_settled_party
    ON fulfillment.orders (requester_id, agent_id)
    WHERE settlement IS NOT NULL;

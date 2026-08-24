-- M5 Payment / Ledger — sandbox adapter, FundingHold, append-only Ledger

CREATE SCHEMA IF NOT EXISTS payment;

CREATE TABLE IF NOT EXISTS payment.payment_intents (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    status TEXT NOT NULL,
    provider_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
    CHECK (amount_minor > 0 AND amount_minor <= 1000000000)
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_order ON payment.payment_intents (order_id, status);

CREATE TABLE IF NOT EXISTS payment.ledger_entries (
    id TEXT PRIMARY KEY,
    payment_intent_id TEXT REFERENCES payment.payment_intents(id),
    order_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (entry_type IN ('DEBIT_REQUESTER','CREDIT_HOLD','DEBIT_HOLD','CREDIT_AGENT','CREDIT_REFUND','DEBIT_REFUND')),
    CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_ledger_order ON payment.ledger_entries (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_intent ON payment.ledger_entries (payment_intent_id);

-- Payout holds/releases are represented as ledger entries; no separate table needed for MVP
-- Provider webhook dedupe
CREATE TABLE IF NOT EXISTS payment.provider_events (
    provider_event_id TEXT PRIMARY KEY,
    payment_intent_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);

-- Payout holds (for agent) — explicit hold before release
CREATE TABLE IF NOT EXISTS payment.payout_holds (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ,
    CHECK (status IN ('HELD','RELEASED','FAILED')),
    CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_payout_order ON payment.payout_holds (order_id, status);

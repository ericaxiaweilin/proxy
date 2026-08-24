-- M6 Execution / Evidence / Completion

CREATE SCHEMA IF NOT EXISTS execution;

CREATE TABLE IF NOT EXISTS execution.check_ins (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES fulfillment.orders(id),
    agent_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    location_label TEXT NOT NULL,
    checked_in_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_ins_order ON execution.check_ins (order_id, checked_in_at);

CREATE TABLE IF NOT EXISTS execution.evidence (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES fulfillment.orders(id),
    media_asset_id TEXT NOT NULL,
    evidence_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (evidence_type IN ('PHOTO','VIDEO','CHECKIN','COMPLETION'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_order ON execution.evidence (order_id, created_at);

-- Payout eligibility is derived from order COMPLETED + evidence + no cancellation race
-- No separate table needed; fulfillment.orders outcome + execution.evidence determines

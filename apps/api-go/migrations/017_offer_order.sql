-- M4 Matching / Offer / Order — canonical Offer + slot reservation
-- Offer wave with TTL, concurrent Accept unique Order per slot

CREATE TABLE IF NOT EXISTS fulfillment.offers (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    candidate_batch_id TEXT,
    status TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('OFFERED','ACCEPTED','EXPIRED','CANCELLED','REJECTED')),
    CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_offers_agent_status ON fulfillment.offers (agent_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_offers_slot ON fulfillment.offers (slot_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_task ON fulfillment.offers (task_id);

-- Extend orders to reference slot/offer for M4 uniqueness
ALTER TABLE fulfillment.orders ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE fulfillment.orders ADD COLUMN IF NOT EXISTS slot_id TEXT;
ALTER TABLE fulfillment.orders ADD COLUMN IF NOT EXISTS offer_id TEXT;

-- One slot -> at most one non-cancelled order (prevents oversell)
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_slot_active
    ON fulfillment.orders (slot_id)
    WHERE slot_id IS NOT NULL AND lifecycle NOT IN ('CANCELLED');

-- Extend task_slots to track reservation (if not already)
-- task_slots.status already supports OFFERED/RESERVED/FILLED; ensure slot can be locked

-- For demand.task_slots: add reservation tracking (offer_id) for observability
ALTER TABLE demand.task_slots ADD COLUMN IF NOT EXISTS reserved_offer_id TEXT;
ALTER TABLE demand.task_slots ADD COLUMN IF NOT EXISTS filled_order_id TEXT;

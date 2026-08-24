-- Align the durable outbox schema with multi-worker ownership. The original
-- migration already has claimed_until/delivered_at; worker_id is the missing
-- ownership token required for safe acknowledgement.
ALTER TABLE integration.outbox_messages
    ADD COLUMN IF NOT EXISTS worker_id TEXT;

CREATE INDEX IF NOT EXISTS idx_outbox_worker_claim
    ON integration.outbox_messages (status, claimed_until, created_at);

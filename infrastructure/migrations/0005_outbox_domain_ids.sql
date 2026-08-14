-- The domain model uses opaque string IDs (draft_..., session_..., org_...).
-- Keep only event_id as UUID; aggregate and principal IDs must not be coerced
-- into a database UUID before the identity model is finalized.
ALTER TABLE integration.outbox_messages
  ALTER COLUMN aggregate_id TYPE text USING aggregate_id::text,
  ALTER COLUMN principal_id TYPE text USING principal_id::text;

ALTER TABLE integration.outbox_messages
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS processing_at timestamptz;

CREATE INDEX IF NOT EXISTS outbox_messages_worker_idx
  ON integration.outbox_messages (worker_id, status, processing_at);

INSERT INTO audit.schema_migrations(version)
VALUES ('0005_outbox_domain_ids')
ON CONFLICT (version) DO NOTHING;

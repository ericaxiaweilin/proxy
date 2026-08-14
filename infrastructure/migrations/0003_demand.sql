CREATE SCHEMA IF NOT EXISTS demand;

CREATE TABLE IF NOT EXISTS demand.task_drafts (
  id text PRIMARY KEY,
  owner_user_account_id text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('DRAFT', 'READY', 'COMMITTED')),
  version integer NOT NULL CHECK (version > 0),
  source_input text NOT NULL,
  draft_progress integer NOT NULL DEFAULT 0 CHECK (draft_progress >= 0),
  last_completed_step integer NOT NULL DEFAULT 0 CHECK (last_completed_step >= 0),
  changes jsonb NOT NULL,
  slots jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_drafts_owner_idx
  ON demand.task_drafts (owner_user_account_id, principal_type, principal_id, updated_at DESC);

INSERT INTO audit.schema_migrations(version)
VALUES ('0003_demand')
ON CONFLICT (version) DO NOTHING;

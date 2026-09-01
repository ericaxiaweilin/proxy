-- Development hot reload must never reset user-visible domain data.
CREATE SCHEMA IF NOT EXISTS runtime;

CREATE TABLE IF NOT EXISTS runtime.module_state (
  module_key TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE runtime.module_state IS
  'Durable snapshots for modules being migrated away from in-memory repositories; survives API/UI hot reloads.';

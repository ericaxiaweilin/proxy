CREATE TABLE IF NOT EXISTS integration.idempotency_records (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  result_json jsonb,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (scope, idempotency_key),
  CHECK ((status = 'IN_PROGRESS' AND result_json IS NULL AND lease_until IS NOT NULL) OR (status = 'COMPLETED' AND result_json IS NOT NULL AND lease_until IS NULL))
);

CREATE INDEX IF NOT EXISTS idempotency_records_created_idx
  ON integration.idempotency_records (created_at);

INSERT INTO audit.schema_migrations(version)
VALUES ('0002_idempotency')
ON CONFLICT (version) DO NOTHING;

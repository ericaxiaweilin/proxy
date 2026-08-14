CREATE TABLE IF NOT EXISTS identity.session_tokens (
  session_id text PRIMARY KEY REFERENCES identity.sessions(id) ON DELETE CASCADE,
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  rotation integer NOT NULL CHECK (rotation > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_tokens_access_expiry_idx
  ON identity.session_tokens (access_expires_at);

CREATE INDEX IF NOT EXISTS session_tokens_refresh_expiry_idx
  ON identity.session_tokens (refresh_expires_at);

INSERT INTO audit.schema_migrations(version)
VALUES ('0006_session_tokens')
ON CONFLICT (version) DO NOTHING;

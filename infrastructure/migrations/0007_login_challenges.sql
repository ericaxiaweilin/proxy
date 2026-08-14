CREATE TABLE IF NOT EXISTS identity.login_challenges (
  id text PRIMARY KEY,
  user_account_id text NOT NULL REFERENCES identity.user_accounts(id),
  login_identity_id text NOT NULL REFERENCES identity.login_identities(id),
  device_id text NOT NULL REFERENCES identity.device_registrations(id),
  channel text NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  provider_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'CONSUMED', 'LOCKED', 'EXPIRED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  version integer NOT NULL CHECK (version > 0),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_challenges_identity_idx
  ON identity.login_challenges (login_identity_id, status, expires_at);

CREATE INDEX IF NOT EXISTS login_challenges_device_idx
  ON identity.login_challenges (device_id, status, expires_at);

INSERT INTO audit.schema_migrations(version)
VALUES ('0007_login_challenges')
ON CONFLICT (version) DO NOTHING;

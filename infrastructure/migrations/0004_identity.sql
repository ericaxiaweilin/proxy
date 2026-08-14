CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.user_accounts (
  id text PRIMARY KEY,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.login_identities (
  id text PRIMARY KEY,
  user_account_id text NOT NULL REFERENCES identity.user_accounts(id),
  verified boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.device_registrations (
  id text PRIMARY KEY,
  user_account_id text NOT NULL REFERENCES identity.user_accounts(id),
  platform text NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  status text NOT NULL,
  push_token_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.memberships (
  user_account_id text NOT NULL REFERENCES identity.user_accounts(id),
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_account_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS identity.sessions (
  id text PRIMARY KEY,
  user_account_id text NOT NULL REFERENCES identity.user_accounts(id),
  device_id text NOT NULL REFERENCES identity.device_registrations(id),
  status text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx
  ON identity.sessions (user_account_id, status, expires_at);

INSERT INTO audit.schema_migrations(version)
VALUES ('0004_identity')
ON CONFLICT (version) DO NOTHING;

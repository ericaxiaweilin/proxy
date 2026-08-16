-- Proxy R14 持久化迁移（补 identity + demand 表）
-- 幂等：CREATE TABLE IF NOT EXISTS

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.user_accounts (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.login_identities (
    id TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL REFERENCES identity.user_accounts(id),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL,
    channel TEXT,
    identifier TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.login_challenges (
    id TEXT PRIMARY KEY,
    user_account_id TEXT,
    login_identity_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    provider_ref TEXT,
    status TEXT NOT NULL,
    code_hash TEXT,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    version INT NOT NULL DEFAULT 1,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.device_registrations (
    id TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL REFERENCES identity.user_accounts(id),
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    push_token_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.sessions (
    id TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.session_tokens (
    session_id TEXT PRIMARY KEY REFERENCES identity.sessions(id),
    access_token_hash TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    rotation INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.memberships (
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    user_account_id TEXT NOT NULL,
    status TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS demand.task_drafts (
    id TEXT PRIMARY KEY,
    owner_user_account_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    source_input TEXT NOT NULL DEFAULT '',
    draft_progress INT NOT NULL DEFAULT 0,
    last_completed_step INT NOT NULL DEFAULT 0,
    changes JSONB NOT NULL DEFAULT '{}',
    slots JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL
);

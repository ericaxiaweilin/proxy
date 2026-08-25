-- M8 Safety / Operator / Privacy — Incident, SafetyBlock, OperatorCase, JIT, Consent, LegalHold

CREATE SCHEMA IF NOT EXISTS safety;
CREATE SCHEMA IF NOT EXISTS operator;
CREATE SCHEMA IF NOT EXISTS privacy;

CREATE TABLE IF NOT EXISTS safety.incidents (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED','DISMISSED'))
);

CREATE TABLE IF NOT EXISTS safety.blocks (
    id TEXT PRIMARY KEY,
    incident_id TEXT REFERENCES safety.incidents(id),
    target_id TEXT NOT NULL,
    block_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    CHECK (block_type IN ('ACCOUNT','ORDER','PAYOUT'))
);

CREATE TABLE IF NOT EXISTS operator.cases (
    id TEXT PRIMARY KEY,
    incident_id TEXT REFERENCES safety.incidents(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    assignee TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'))
);

CREATE TABLE IF NOT EXISTS operator.jit_grants (
    id TEXT PRIMARY KEY,
    grantee_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS privacy.consents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, purpose)
);

CREATE TABLE IF NOT EXISTS privacy.legal_holds (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_target ON privacy.legal_holds (target_id, released_at);

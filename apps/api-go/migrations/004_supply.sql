-- Proxy supply schema（R14 §6 + B 完成标准）
CREATE SCHEMA IF NOT EXISTS supply;

CREATE TABLE IF NOT EXISTS supply.agent_profiles (
    agent_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    photos JSONB NOT NULL DEFAULT '[]',
    languages JSONB NOT NULL DEFAULT '[]',
    service_areas JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS supply.agent_services (
    agent_id TEXT NOT NULL,
    service_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    reference_price BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'VND',
    markets JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (agent_id, service_type)
);

CREATE TABLE IF NOT EXISTS supply.capabilities (
    agent_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    declared BOOLEAN NOT NULL DEFAULT FALSE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (agent_id, capability)
);

CREATE TABLE IF NOT EXISTS supply.capability_verifications (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    status TEXT NOT NULL,
    method TEXT NOT NULL,
    verified_by TEXT,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS supply.availability_windows (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    market_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    order_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_agent_time ON supply.availability_windows (agent_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS supply.candidate_batches (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    candidates JSONB NOT NULL DEFAULT '[]',
    shortage BOOLEAN NOT NULL DEFAULT FALSE,
    shortage_note TEXT
);

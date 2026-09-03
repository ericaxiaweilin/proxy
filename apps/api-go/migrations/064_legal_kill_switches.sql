CREATE SCHEMA IF NOT EXISTS compliance;
-- R16.7-P1-G: remote legal kill switch (LC-16).
--
-- Vietnam 356/2025/ND-CP Art. 12 requires that the platform
-- operator be able to immediately disable regulated functionality
-- when there is a compliance incident. PRD v1.4 LC-16 codifies
-- the same requirement: a remote switch that flips a category
-- from "active" to "killed" and back, with a full audit trail.
--
-- Schema: one active row per category at a time. Re-arming a
-- killed category inserts a new row rather than overwriting the
-- previous one, so the audit log records every flip. We enforce
-- the "one active row" invariant with a partial unique index on
-- (category) WHERE status = 'KILLED' — when a row is REARMED,
-- the partial index no longer covers it, and a fresh KILLED
-- row can be inserted.
--
-- expires_at is optional. When set, the kill switch self-clears
-- at that timestamp via the GetStatus expiry sweep (mirrors the
-- location-consent pattern). The mobile client also re-fetches
-- /v1/legal/status on every cold boot, so an expired row is
-- never reported as KILLED to the end user.

CREATE TABLE IF NOT EXISTS compliance.legal_kill_switches (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL CHECK (category IN ('GLOBAL','AI_MEDIA','MARKETPLACE','LOCATION_CONSENT','PAYMENTS')),
    status      TEXT NOT NULL CHECK (status IN ('KILLED','REARMED')),
    reason      TEXT NOT NULL,
    set_by      TEXT NOT NULL,
    set_at      TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ,
    rearmed_by  TEXT,
    rearmed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_kill_switch
    ON compliance.legal_kill_switches (category)
    WHERE status = 'KILLED';

CREATE INDEX IF NOT EXISTS idx_kill_switch_category
    ON compliance.legal_kill_switches (category);

CREATE INDEX IF NOT EXISTS idx_kill_switch_expires
    ON compliance.legal_kill_switches (expires_at)
    WHERE status = 'KILLED';

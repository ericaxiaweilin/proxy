-- R16.7-P1-J: precise location opt-in + time limit (LC-08).
--
-- Vietnam PDP 91/2025/QH15 Art. 4 lists precise GPS coordinates as
-- sensitive personal data; the user must give explicit opt-in
-- consent (Art. 12) and that consent must be revocable at any
-- time. PRD v1.4 LC-08 also requires a maximum duration so a
-- forgotten toggle cannot leak location indefinitely.
--
-- Schema: one row per (user_id, kind). Re-granting within the
-- same window is a single UPDATE on the existing row rather than
-- a new INSERT, so the audit trail reads as "granted at T0, then
-- extended to T1". We use a partial unique index on
-- (user_id, kind) WHERE status = 'GRANTED' so that a user can hold
-- at most one active consent per kind at a time. The 'REVOKED'
-- and 'EXPIRED' rows stay in the table for the audit trail and
-- are filtered out by the partial index.

CREATE SCHEMA IF NOT EXISTS location;
CREATE TABLE IF NOT EXISTS location.location_consents (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('PRECISE_GPS')),
    status        TEXT NOT NULL CHECK (status IN ('GRANTED','REVOKED','EXPIRED')),
    granted_at    TIMESTAMPTZ NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL,
    client_ip     INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one GRANTED row per (user, kind) at a time. When a user
-- revokes, the status flips to REVOKED and the partial index no
-- longer covers the row, so a fresh grant can insert again. The
-- history of previous GRANTED rows is preserved (we never delete).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_location_consent
    ON location.location_consents (user_id, kind)
    WHERE status = 'GRANTED';

CREATE INDEX IF NOT EXISTS idx_location_consent_user
    ON location.location_consents (user_id);

CREATE INDEX IF NOT EXISTS idx_location_consent_expires
    ON location.location_consents (expires_at)
    WHERE status = 'GRANTED';

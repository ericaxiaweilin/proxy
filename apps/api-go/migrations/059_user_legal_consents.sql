-- R16.7-P0-C: user legal consent records (Terms / Privacy acceptance).
-- Required by PRD v1.4 LC-04 (Personal Data Protection Impact Assessment)
-- and LC-15 (Privacy request center must support consent withdrawal).
-- One row per (user, doc_kind, doc_version) — re-consent on a new doc
-- version produces a fresh row rather than overwriting, so the audit
-- trail is preserved.
CREATE TABLE IF NOT EXISTS privacy.legal_consent_records (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    doc_kind      TEXT NOT NULL CHECK (doc_kind IN ('TERMS','PRIVACY')),
    doc_version   TEXT NOT NULL,
    accepted_at   TIMESTAMPTZ NOT NULL,
    required      BOOLEAN NOT NULL,
    ip            INET,
    user_agent    TEXT,
    UNIQUE (user_id, doc_kind, doc_version)
);
CREATE INDEX IF NOT EXISTS idx_legal_consent_user
    ON privacy.legal_consent_records (user_id);
CREATE INDEX IF NOT EXISTS idx_legal_consent_accepted_at
    ON privacy.legal_consent_records (accepted_at DESC);

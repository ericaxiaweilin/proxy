-- R16.10-P1-F: Privacy request center (Vietnam PDP 91/2025/QH15 Art. 31
-- access right + Art. 32 erasure right + PRD v1.4 LC-15).
--
-- One row per privacy request. The request lifecycle is:
--   received    the user has submitted a verified request
--   in_progress the data export is being assembled, or the account is
--               being marked for soft deletion
--   completed   the request is done; for 'export' the export snapshot
--               is available at export_snapshot_url until
--               export_retention_until; for 'delete' the user account
--               is locked and a 30-day grace period runs until
--               erased_at, after which PII is wiped
--   rejected    the request could not be processed (e.g. the user
--               could not verify their identity, or the request was
--               a duplicate)
--   cancelled   the user cancelled their own delete request inside the
--               30-day grace window (PDP Art. 32 right to withdraw)
--
-- We soft-delete accounts rather than hard-deleting them, because:
--  * the platform's ledger of financial / safety / tax records must be
--    preserved for the retention periods in service terms §44 and the
--    Vietnamese cybersecurity logging law (116/2025/QH15, 12 months);
--  * the chat-history retention requirements in 333/2026/ND-CP apply
--    to messages, not necessarily user records;
--  * the platform needs the user_id for the 30-day grace window so it
--    can actually un-delete if the user changes their mind.
--
-- This table is intentionally separate from identity.user_sessions
-- (which records authentication events) and from
-- privacy.legal_consent_records (which records consent acts). Each kind
-- of record has its own audit semantics; mixing them would force
-- downstream auditors to filter on a JSONB 'kind' field rather than
-- reading a table they can quote.
CREATE TABLE IF NOT EXISTS privacy.privacy_requests (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT NOT NULL,
    kind                     TEXT NOT NULL CHECK (kind IN ('export','delete')),
    status                   TEXT NOT NULL CHECK (status IN ('received','in_progress','completed','rejected','cancelled')),
    requested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at             TIMESTAMPTZ,
    erased_at                TIMESTAMPTZ,
    export_snapshot_url      TEXT,
    export_sha256            TEXT,
    export_retention_until   TIMESTAMPTZ,
    legal_basis              TEXT NOT NULL,
    client_ip                INET,
    user_agent               TEXT,
    rejection_reason         TEXT
);
-- Partial unique index: a user can have at most one ACTIVE request of
-- each kind. After the request is completed / rejected / cancelled they
-- can submit a new one (e.g. a fresh export). This is the only
-- uniqueness constraint we need; a user may have many historical rows
-- (one per request attempt), and a delete request can be followed by
-- an export request and vice versa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_privacy_requests_user_kind_active
    ON privacy.privacy_requests (user_id, kind)
    WHERE status IN ('received','in_progress');
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user_requested
    ON privacy.privacy_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_erased_at
    ON privacy.privacy_requests (erased_at)
    WHERE status = 'in_progress' AND kind = 'delete';
-- Lets the operator find accounts whose 30-day grace window has expired
-- so the nightly job can transition them to 'completed'.

-- Audit log of every status transition. PRD v1.4 LC-15 says the privacy
-- request center must be "tamper-evident", so we keep an append-only
-- log rather than mutating the parent row.
CREATE TABLE IF NOT EXISTS privacy.privacy_request_events (
    id            BIGSERIAL PRIMARY KEY,
    request_id    TEXT NOT NULL REFERENCES privacy.privacy_requests(id) ON DELETE CASCADE,
    from_status   TEXT,
    to_status     TEXT NOT NULL,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor         TEXT NOT NULL,
    notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_privacy_request_events_request
    ON privacy.privacy_request_events (request_id, occurred_at);

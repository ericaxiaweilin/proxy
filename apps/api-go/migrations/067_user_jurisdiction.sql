-- R16.7-P1-E: Jurisdiction Policy Engine (LC-28 / LC-30 driver).
-- Vietnam 91/2025/QH15 (PDP), 122/2025/QH15 (E-commerce),
-- 134/2025/QH15 (AI), 116/2025/QH15 (Cybersecurity),
-- 248/2026/ND-CP and 333/2026/ND-CP are the regulatory
-- families that proxy.vn has to thread. The first three
-- launch regions (Hanoi, Ho Chi Minh City, Da Nang) share
-- the same federal laws but differ in:
--
--   * data-residency (HCMC has the primary data centre;
--     Hanoi has a secondary read replica since 248/2026/ND-CP
--     §14 requires domestic residency for user_jurisdiction
--     data on Vietnamese residents)
--   * the local Data Protection Officer's contact (LC-04)
--   * the appeal-window (HCMC: 30 days, Hanoi / Da Nang: 45
--     days under 248/2026/ND-CP §11.3)
--
-- The policy decision table (LC-28) snapshots the user's
-- jurisdiction at the moment an Order is confirmed. If the
-- user later changes their jurisdiction, future decisions
-- pick up the new value, while past decisions keep the old
-- one (audit-trail integrity). That is why the
-- policy_decisions table gets a new `jurisdiction` column
-- pointing at this row.
--
-- The (user_id) primary key is a one-row-per-user
-- guarantee; an upsert replaces the previous value. The
-- CHECK constraints mirror the closed set in
-- apps/api-go/internal/jurisdiction (which is the source of
-- truth in Go).

CREATE TABLE IF NOT EXISTS identity.user_jurisdiction (
    user_id           TEXT PRIMARY KEY,
    country           TEXT NOT NULL CHECK (country IN ('VN')),
    region            TEXT NOT NULL CHECK (region IN ('HN', '79', 'DNG')),
    source            TEXT NOT NULL CHECK (source IN ('DEFAULT', 'USER_SELF', 'OPERATOR', 'GEOLOCATION')),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_jurisdiction_region
    ON identity.user_jurisdiction (region, updated_at DESC);

-- policy.policy_decisions gets a jurisdiction column. The
-- column is NOT NULL going forward; existing rows (the
-- 066-inserted ones from the policy decisions gate) get
-- the platform-default VN-79.
ALTER TABLE policy.policy_decisions
    ADD COLUMN IF NOT EXISTS jurisdiction TEXT NOT NULL DEFAULT 'VN-79';

-- Decision idempotency: the existing UNIQUE constraint
-- was on (user_id, category_code, terms_version,
-- privacy_version). Adding jurisdiction means the same
-- (user, category, terms, privacy) tuple evaluated under
-- two different jurisdictions produces two distinct
-- decisions — exactly what LC-28 + LC-30 want.
--
-- The old UNIQUE constraint name was
-- policy_decisions_user_cat_terms_privacy_key. We drop it
-- and re-create the wider one.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'policy_decisions_user_cat_terms_privacy_key'
    ) THEN
        ALTER TABLE policy.policy_decisions
            DROP CONSTRAINT policy_decisions_user_cat_terms_privacy_key;
    END IF;
END$$;

ALTER TABLE policy.policy_decisions
    ADD CONSTRAINT policy_decisions_user_cat_terms_privacy_jur_key
    UNIQUE (user_id, category_code, terms_version, privacy_version, jurisdiction);

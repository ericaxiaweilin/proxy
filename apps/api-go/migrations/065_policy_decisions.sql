-- R16.7-P1-B (LC-28 / LC-20 / 越南 248/2026/ND-CP §11.2):
-- Every paid Order (PLATFORM_PAY settlement) must have a policy_decision_id
-- stamped on it BEFORE reaching COMMITTED (CONFIRMED in our lifecycle).
-- A 'policy_decision' row is the immutable audit log: it captures the
-- exact TermsVersion + CategoryCode + boundary evaluation that was
-- in force at the moment the Order was created. This is the system of
-- record for "what policy applied to this paid transaction".
--
-- Why a separate table (and not just a column on Order):
--   * Vietnam regulators ask for "the policy that was in effect when
--     the user clicked confirm". Snapshotting into Order columns is
--     fragile (a single UPDATE on the policy table would lose it).
--   * One decision may be re-used by multiple Orders (e.g. the same
--     "USER_PAID_SERVICE" decision gates every Order in a session
--     before the user re-consents to new terms). Linking by ID
--     rather than copy-paste keeps that link intact.
--   * LC-30 (Material Change): when a TermsVersion bumps, the next
--     CreateOrder re-evaluates and writes a NEW decision row; the
--     prior decision row stays as a "this was the rule then" record.
--     The Order is stamped with the *new* decision id, never a
--     back-dated one.
--
-- Schema:
--   policy.policy_decisions:
--     One row per (user, category, terms_version) evaluation.
--     A repeat (no TermsVersion change) is upserted and the
--     existing decision_id is reused (annex A.3 of the
--     compliance plan: "evaluation is idempotent within a version").
--   policy.order_decisions:
--     Many-to-one from Order → PolicyDecision. Composite PK
--     means re-stamping the same decision is impossible.

CREATE SCHEMA IF NOT EXISTS policy;

CREATE TABLE IF NOT EXISTS policy.policy_decisions (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    category_code      TEXT NOT NULL,
    terms_version      TEXT NOT NULL,
    privacy_version    TEXT NOT NULL,
    kill_switch_state  JSONB NOT NULL,
    evaluated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ,
    -- An evaluation is identified by (user, category, terms_version,
    -- privacy_version). The same triple must always produce the same
    -- decision id (a re-evaluation under the same conditions is a
    -- no-op), so the (user, category, terms_version, privacy_version)
    -- tuple is unique.
    UNIQUE (user_id, category_code, terms_version, privacy_version)
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_user
    ON policy.policy_decisions (user_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_expiry
    ON policy.policy_decisions (expires_at)
    WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS policy.order_decisions (
    order_id            TEXT NOT NULL,
    decision_id         TEXT NOT NULL REFERENCES policy.policy_decisions(id),
    stamped_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stamped_lifecycle   TEXT NOT NULL, -- OFFERED | CONFIRMED | ...
    PRIMARY KEY (order_id, decision_id)
);

CREATE INDEX IF NOT EXISTS idx_order_decisions_decision
    ON policy.order_decisions (decision_id);

-- LC-28 enforcement helper. Returns true when an Order in CONFIRMED
-- or later has a stamped policy decision whose decision row exists.
-- Used by the API to gate ConfirmOrder; defined here so the test
-- suite (and humans) have a single source of truth for the rule.
CREATE OR REPLACE FUNCTION policy.order_has_paid_decision(p_order_id TEXT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM policy.order_decisions od
        JOIN policy.policy_decisions pd ON pd.id = od.decision_id
        WHERE od.order_id = p_order_id
          AND od.stamped_lifecycle IN ('OFFERED', 'CONFIRMED', 'EXECUTING', 'COMPLETED')
    );
$$ LANGUAGE SQL STABLE;

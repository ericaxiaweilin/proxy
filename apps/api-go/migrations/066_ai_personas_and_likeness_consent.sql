-- R16.7-P1-I (LC-07) + R16.7-P1-K (LC-06): AI personas + likeness
-- consent audit log. Vietnam 134/2025/QH15 (AI Law) Art. 14 requires
-- a digital twin to be backed by a record of the real person's
-- consent. PRD v1.4 LC-07 calls this 'twin likeness consent'.
--
-- Schema:
--   ai.ai_personas:
--     One row per digital persona. PersonaType is the catalog of
--     kinds we currently support: 'USER_TWIN' (a real user's
--     look-alike / voice-alike) and 'CREATIVE' (a wholly-fictional
--     character, e.g. an AI concierge). USER_TWIN rows are gated by
--     likeness consent; CREATIVE rows are not.
--   ai.likeness_consents:
--     One row per (persona, subject, terms_version, consent_kind).
--     The (persona, subject, terms_version, consent_kind) tuple
--     is unique so re-consenting under the same terms is a no-op.
--     revoked_at is set when the subject withdraws; the persona
--     becomes non-publishable while any consent row has
--     revoked_at IS NULL AND expires_at < now() OR a row that was
--     ever revoked.
--
-- Why a separate table (and not a column on personas):
--   - PRD v1.4 §4.5 calls for a *history* of consent (initial,
--     re-consent, withdrawal) rather than a single current state.
--   - Withdrawal must be auditable: we cannot just delete the
--     consent row.
--   - The persona can keep living for non-likeness purposes
--     (e.g. text generation) while the visual/voice likeness is
--     revoked.

CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.ai_personas (
    id              TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    persona_type    TEXT NOT NULL CHECK (persona_type IN ('USER_TWIN', 'CREATIVE')),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_personas_owner
    ON ai.ai_personas (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai.likeness_consents (
    id              TEXT PRIMARY KEY,
    persona_id      TEXT NOT NULL REFERENCES ai.ai_personas(id),
    subject_id      TEXT NOT NULL, -- the real person whose likeness is used
    consent_kind    TEXT NOT NULL CHECK (consent_kind IN ('VISUAL', 'VOICE', 'VISUAL_AND_VOICE')),
    terms_version   TEXT NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    UNIQUE (persona_id, subject_id, terms_version, consent_kind)
);

CREATE INDEX IF NOT EXISTS idx_likeness_consents_persona
    ON ai.likeness_consents (persona_id);
CREATE INDEX IF NOT EXISTS idx_likeness_consents_subject
    ON ai.likeness_consents (subject_id);

-- LC-07 enforcement helper. Returns the active consent id for
-- the (persona, subject, current terms) tuple, or NULL if no
-- consent has been granted or the most recent row is revoked /
-- expired. Used by the MarkMediaReady handler to fail closed
-- when AI media references a persona without a live consent.
CREATE OR REPLACE FUNCTION ai.persona_has_live_consent(
    p_persona_id TEXT,
    p_subject_id TEXT,
    p_terms_version TEXT,
    p_now TIMESTAMPTZ
) RETURNS TABLE (consent_id TEXT, consent_kind TEXT) AS $$
    SELECT id, consent_kind
    FROM ai.likeness_consents
    WHERE persona_id = p_persona_id
      AND subject_id = p_subject_id
      AND terms_version = p_terms_version
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > p_now)
    ORDER BY granted_at DESC
    LIMIT 1;
$$ LANGUAGE SQL STABLE;

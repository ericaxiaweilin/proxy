-- Persist every runtime persona kind and preserve re-consent history.
ALTER TABLE ai.ai_personas DROP CONSTRAINT IF EXISTS ai_personas_persona_type_check;
ALTER TABLE ai.ai_personas ADD CONSTRAINT ai_personas_persona_type_check
  CHECK (persona_type IN ('USER_TWIN', 'CREATIVE', 'PLATFORM_AI', 'USER_ASSISTANT'));

-- The original tuple uniqueness prevented a revoked subject from granting
-- consent again under the same terms. IDs remain unique; this index supports
-- the latest-consent read while allowing an append-only consent history.
ALTER TABLE ai.likeness_consents
  DROP CONSTRAINT IF EXISTS likeness_consents_persona_id_subject_id_terms_version_consent_key;
ALTER TABLE ai.likeness_consents
  DROP CONSTRAINT IF EXISTS likeness_consents_persona_id_subject_id_terms_version_conse_key;
CREATE INDEX IF NOT EXISTS idx_likeness_consents_latest
  ON ai.likeness_consents (persona_id, subject_id, terms_version, granted_at DESC, id DESC);

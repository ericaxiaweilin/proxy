-- R16.10-P1-F (post-mortem): the original migration 060 omitted the
-- `version` column that the postgres UpdatePrivacyRequest method
-- uses for optimistic concurrency. The in-memory repository
-- tracks version in Go state, so the omission was not caught by
-- unit tests. This migration adds the column and a default of 1
-- for any pre-existing rows (the dev database already had
-- 060_privacy_requests.sql applied before the column was added).
ALTER TABLE privacy.privacy_requests
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

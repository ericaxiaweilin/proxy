-- 035_message_protection_persistence.sql
-- R15.23: persist MessageProtection JSON envelope on conversation.messages.
-- Lotus Chat RFC v0.1 §3 (per-message anti-leak) requires that
--   - Forwardable
--   - ScreenshotProtected / ScreenshotWarn
--   - ViewLimit / ViewCount
--   - ExpiresAt
--   - EndToEndEncrypted
-- round-trip through the database so the server can enforce
-- PROTECTION_VIOLATION on forward attempts and VIEW_LIMIT_EXCEEDED on reads.
--
-- Before 035:
--   - conversation.messages schema (001_r14_schema.sql) had no protection
--     columns. PG adapter silently dropped MessageProtection on AppendMessage.
--   - ConversationRepository was missing GetMessage + UpdateMessage methods
--     (interface assert failed to compile once MessageProtection landed on the
--     Message struct), so MarkMessageRead / RecordScreenshot / ForwardMessage
--     had no PG path at all.
--
-- 035 adds:
--   1. protection JSONB  (default '{}' for legacy rows from before lotus RFC)
--   2. view_count INT    (default 0; recipient reads increment it)
--   3. partial index on protection->>'expiresAt' for the TTL sweeper to scan
--      in O(expired) rather than O(all messages).

-- NOTE: this file is run through the test helper's applyMigrations,
-- which executes the whole file as a single Exec. Do NOT wrap in
-- BEGIN/COMMIT — pgx will see BEGIN as starting a transaction and
-- never auto-commit. The production Migrator applies the same way.

ALTER TABLE conversation.messages
    ADD COLUMN IF NOT EXISTS protection JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE conversation.messages
    ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

-- The TTL sweeper (worker, R15.23 P1 follow-up) will run:
--   SELECT id FROM conversation.messages
--   WHERE protection->>'expiresAt' IS NOT NULL
--     AND (protection->>'expiresAt')::timestamptz < NOW();
-- Partial index keeps it cheap even when most messages are unexpiring
-- (SYSTEM_CONTEXT, STRUCTURED_SUGGESTION).
CREATE INDEX IF NOT EXISTS idx_conversation_messages_expires_at
    ON conversation.messages ((protection->>'expiresAt'))
    WHERE protection->>'expiresAt' IS NOT NULL;

-- View-count lookups by MarkMessageRead need the message row, not a
-- conversation scan. ConversationRepository.GetMessage is the access
-- path; PG already PKs by id, so no extra index here.

COMMENT ON COLUMN conversation.messages.protection IS
    'R15.23: per-message anti-leak envelope (Lotus Chat RFC v0.1 §3). JSONB so we can add fields without migrations. Schema: {forwardable, copyable, screenshotProtected, screenshotWarn, viewLimit, viewCount, expiresAt, endToEndEncrypted}. Default {} = legacy row, server treats as forwardable + no view limit + no TTL.';
COMMENT ON COLUMN conversation.messages.view_count IS
    'R15.23: monotonic read counter, incremented by MarkMessageRead for non-sender participants. Sender reads do not count. Compared against protection.viewLimit to enforce VIEW_LIMIT_EXCEEDED.';

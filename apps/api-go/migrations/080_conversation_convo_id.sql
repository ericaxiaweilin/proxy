-- 080_conversation_convo_id.sql
-- Lotus v1 Convo (Message Branch): messages carry their branch id so a
-- branch read is a single indexed query. convos table itself lives in
-- 040_dialog_convo_folder.sql; this only wires message membership.
ALTER TABLE conversation.messages ADD COLUMN IF NOT EXISTS convo_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_convo ON conversation.messages (conversation_id, convo_id);
COMMENT ON COLUMN conversation.messages.convo_id IS 'v1 Convo branch id; NULL = main thread';

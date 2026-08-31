-- 039_message_v1.sql
-- Lotus v1 (Object Schema + Engineering Spec): Message v1 加性字段
-- 兼容 v0 的 conversation_id/messageType 保留，双写 dialog_id/kind 等。
-- 新增列均为可空，旧数据默认由 Go 层回填 (DialogID=conversation_id, Kind=messageTypeToKind)。

ALTER TABLE conversation.messages
    ADD COLUMN IF NOT EXISTS dialog_id TEXT,
    ADD COLUMN IF NOT EXISTS kind TEXT,
    ADD COLUMN IF NOT EXISTS sender_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS proxy_object JSONB,
    ADD COLUMN IF NOT EXISTS security_v1 JSONB,
    ADD COLUMN IF NOT EXISTS delivery JSONB,
    ADD COLUMN IF NOT EXISTS seq BIGINT;

-- 回填：dialog_id = conversation_id where null
UPDATE conversation.messages SET dialog_id = conversation_id WHERE dialog_id IS NULL;

-- 索引：按 dialog 扫消息 + seq 排序
CREATE INDEX IF NOT EXISTS idx_conversation_messages_dialog_seq
    ON conversation.messages (dialog_id, seq);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_kind
    ON conversation.messages (kind) WHERE kind IS NOT NULL;

COMMENT ON COLUMN conversation.messages.dialog_id IS 'v1: dialog_id, 同义 conversation_id，双写过渡';
COMMENT ON COLUMN conversation.messages.kind IS 'v1: text|image|video|file|location|contact|proxy_object|poll|call_recording|system_event';
COMMENT ON COLUMN conversation.messages.proxy_object IS 'v1: ProxyObjectRef {objectType, objectId, snapshot, liveState}';
COMMENT ON COLUMN conversation.messages.security_v1 IS 'v1: MessageSecurityV1 {mode, viewLimit, forwardAllowed ...}, 与 protection 双写';

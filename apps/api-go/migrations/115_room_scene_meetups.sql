-- ROOM-CREATE-001: 创建房间 = GROUP conversation + 场景元数据（房间名/场景/地点），
-- 见面邀约（scene + time + place，全员同意才算数）是独立于消息流的可变状态机，
-- 单开一张表而不是塞进 messages —— messages 是 append-only 历史，见面状态需要
-- 原地更新（PENDING -> CONFIRMED -> ONGOING -> COMPLETED）。
ALTER TABLE conversation.conversations ADD COLUMN IF NOT EXISTS room_scene JSONB;

CREATE TABLE IF NOT EXISTS conversation.meetups (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation.conversations(id),
    proposer_id TEXT NOT NULL,
    scene_emoji TEXT NOT NULL,
    scene_name TEXT NOT NULL,
    place TEXT NOT NULL,
    time_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    accepted_by JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_meetups_conversation_id
    ON conversation.meetups (conversation_id, created_at DESC);

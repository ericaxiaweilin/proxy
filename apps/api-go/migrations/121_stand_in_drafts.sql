-- AI-MANAGE-013: 对话权限「每次确认」—— AI 替被代表的本人起草的回复，本人确认后才发出。
-- 草稿不是消息（messages 是双方可见的 append-only 历史，草稿只有本人看得到、要原地改状态），
-- 所以单开一张表。同一会话同一本人只有最新一条 PENDING 有效，旧的标 SUPERSEDED。
CREATE TABLE IF NOT EXISTS conversation.stand_in_drafts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation.conversations(id),
    owner_id TEXT NOT NULL,
    in_reply_to TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    sent_message_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stand_in_drafts_pending
    ON conversation.stand_in_drafts (conversation_id, owner_id, created_at DESC)
    WHERE status = 'PENDING';

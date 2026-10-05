-- CONTENT-TASK-001：商家 × creator 内容任务（商家侧「Creator 经营 · 生产内容」）。
-- 一个任务 = 一张 purpose=UGC 的合作邀约（supply.collab_invitations）+ 任务说明 +
-- 稿件 / 审核 / 各平台发布链接。接单 / 拒绝 / 还价 / 撤回仍走邀约本身，这里不重复存状态。
-- state 只管邀约接受之后的内容环节：BRIEFED（待交稿）→ SUBMITTED（待审核）
-- → APPROVED（通过，可发布）/ REJECTED（打回重拍，回到可交稿）。
CREATE TABLE IF NOT EXISTS supply.content_tasks (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL UNIQUE,
    merchant_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    brief TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'VIDEO',
    platforms TEXT[] NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'BRIEFED',
    draft JSONB,
    review JSONB,
    publications JSONB NOT NULL DEFAULT '[]',
    nudged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_content_tasks_merchant ON supply.content_tasks (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_content_tasks_agent ON supply.content_tasks (agent_id, created_at DESC);

-- 120_message_authored_by.sql — 消息「由谁写的」（AI-MANAGE-008）。
--
-- 代回复 = AI 以真人本人的身份替 TA 回（用户定义：「代回复 应该是代真人的回复 如果是平台的 ai 助理
-- 不叫代回复」）。这类消息的 sender_id 就是那个真人，所以得另外记一笔「这条是 AI 写的」，
-- 双方界面据此显示「AI 代回」小标，本人也能分清哪些是 AI 替自己说的。
-- NULL = 人自己写的（包括本人确认后发出的 AI 草稿 —— 本人确认过就是本人的话）。
ALTER TABLE conversation.messages ADD COLUMN IF NOT EXISTS authored_by TEXT;
ALTER TABLE conversation.messages DROP CONSTRAINT IF EXISTS messages_authored_by_check;
ALTER TABLE conversation.messages ADD CONSTRAINT messages_authored_by_check
    CHECK (authored_by IS NULL OR authored_by IN ('ai_stand_in'));

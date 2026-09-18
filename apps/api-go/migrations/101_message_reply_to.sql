-- QUOTE-REPLY-001: 引用回复。消息可引用本会话内另一条消息，被引 ID 存这里。
--
-- 背景：引用以前只活在客户端本地（replySender/replyBody 文字快照），服务端
-- 完全不知道被引用了谁 —— 对方收不到引用，AI 拿不到引用上下文。改成 ID 引用。
-- NULL = 没引用（历史消息全是 NULL，不用回填）。跨会话引用由 service 层直接
-- 拒绝，不靠 DB 约束（被删的消息引用悬空不断言，由客户端降级显示快照）。
ALTER TABLE conversation.messages ADD COLUMN IF NOT EXISTS reply_to TEXT;

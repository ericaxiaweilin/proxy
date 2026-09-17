-- UNREAD-PIPELINE-001: 阅读位加最后已读时间。
--
-- 背景：conversation.messages 表没有 seq 列（Seq 只活在内存版里），
-- PG 落库的消息读回来 Seq 全是 0 —— 只靠 last_read_seq 算未读数，
-- PG 上永远算不对。所以 cursor 再记一个 last_read_at：Seq>0 的走序号，
-- Seq==0 的走时间。NULL = 从没标过（ rollout 时全量亮一次，点开即灭）。
ALTER TABLE conversation.read_cursors ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

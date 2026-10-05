-- 178_outbox_dead_letter_replay.sql
--
-- MERCHANT-CREATOR-NOTIFY-001：死信要能被看见，也要在**还说得通**的时候被重放。
--
-- 实况（2026-10-05 本地库）：83 条 DEAD_LETTER，写了没人读。全仓 `status =
-- 'DEAD_LETTER'` 只有 3 处写、**0 处读** —— 投递失败会静默堆积，你不会知道哪天
-- 通知又漏了一批。那 83 条是 2026-08-24~29 期间 `OUTBOX_DELIVERY=unavailable`
-- 那个 kill-switch 开着时烧掉的。
--
-- 为什么不盲目重放：把 6 周前的「需求已发布」塞进今天的收件箱，比不补发**更糟**
-- —— 那是一条假的新消息，用户会去点一个已经不存在的需求。所以只重放**够新**的
-- （默认 15 分钟内，见 outbox.Worker.ReapDeadLetters），太旧的只计数 + 打一行
-- 可告警的日志，让人来决定。
--
-- 重放为什么不会产生第二条通知：inbox 的幂等 id 由 DedupeKey（= 事件 id）确定性
-- 推出来，重放同一条事件只会撞主键（ON CONFLICT DO NOTHING）。这是幂等管线
-- 早就挣来的性质，现在被真正用上一次。
--
-- 这两列是**审计**：重放不是「抹掉发生过的事」，而是留下「第几次、什么时候被
-- 人/进程救回来的」。last_error 保留原始失败原因不覆盖。
ALTER TABLE integration.outbox_messages
    ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ;

ALTER TABLE integration.outbox_messages
    ADD COLUMN IF NOT EXISTS replay_count INT NOT NULL DEFAULT 0;

-- sweeper/重放要按 (status, occurred_at) 扫：找「够新的死信」和「有多旧的死信」。
CREATE INDEX IF NOT EXISTS ix_outbox_messages_status_occurred_at
    ON integration.outbox_messages (status, occurred_at);

COMMENT ON COLUMN integration.outbox_messages.replayed_at IS
    '178：最近一次被重放回 PENDING 的时刻。重放只针对够新的死信（默认 15 分钟内，见 outbox.Worker.ReapDeadLetters）—— 把几周前的通知补发到今天的收件箱比不补发更糟。';
COMMENT ON COLUMN integration.outbox_messages.replay_count IS
    '178：被重放过的次数。留痕而不是抹掉：发生过什么要能查。';

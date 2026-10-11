-- DECISION-ENGINE-001（2026-10-11）：/v1/decisions/evaluate 的留痕账。
--
-- 每一次「该不该对这个人做这个动作」的判断写一行：结论、卡在哪一步、为什么、每一步的
-- 原因码、口径版本、耗时。只追加，不改不删 —— 控制台「引擎总览」的调用量 / 延迟 /
-- 放行与拦截分布全部从这里读，没有别的来源。
CREATE TABLE IF NOT EXISTS decision.evaluations (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    event_type     TEXT NOT NULL DEFAULT '',   -- 引力事件类型；'' = 不是基于预测的动作（如生命周期引导）
    action         TEXT NOT NULL,              -- FEED_CARD | NUDGE
    caller         TEXT NOT NULL,              -- 谁来问的：guidance_worker / operator_console …
    subject        TEXT NOT NULL DEFAULT '',   -- 问的是哪一件事（如引导推送的 key）
    allowed        BOOLEAN NOT NULL,
    state          TEXT NOT NULL,              -- §11 状态：OBSERVE / LEARN_ONLY / PASSIVE / SOFT_NUDGE / BLOCKED
    blocked_step   TEXT NOT NULL DEFAULT '',   -- 第一个拦下来的步骤；放行时为空
    reason         TEXT NOT NULL DEFAULT '',   -- 该步骤的原因码
    steps          JSONB NOT NULL,             -- 每一步的 verdict + reason，按执行顺序
    policy_version TEXT NOT NULL,
    latency_us     INTEGER NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_evaluations_created ON decision.evaluations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_evaluations_user ON decision.evaluations (user_id, created_at DESC);

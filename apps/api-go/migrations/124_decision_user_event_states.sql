-- GRAVITY-001: 《Personalization & Orchestration Engineering Spec v1》§21 UserEventState 第一版。
-- 每个人 × 每类引力事件一行：接下来 30/60/120 分钟内发生的概率、证据覆盖、6 级决策状态（§11）。
-- 由 worker 定时从真实行为（消息 / 浏览事件 / 场景到访）重算；原始行为表照旧全量保存，这里只是派生状态。
CREATE SCHEMA IF NOT EXISTS decision;

CREATE TABLE IF NOT EXISTS decision.user_event_states (
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    context_key TEXT NOT NULL DEFAULT '',
    p30 DOUBLE PRECISION NOT NULL DEFAULT 0,
    p60 DOUBLE PRECISION NOT NULL DEFAULT 0,
    p120 DOUBLE PRECISION NOT NULL DEFAULT 0,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    evidence_coverage DOUBLE PRECISION NOT NULL DEFAULT 0,
    sample_events INTEGER NOT NULL DEFAULT 0,
    active_weeks INTEGER NOT NULL DEFAULT 0,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    peak_hour_of_week INTEGER NOT NULL DEFAULT -1,
    next_likely_at TIMESTAMPTZ,
    action_state TEXT NOT NULL DEFAULT 'OBSERVE'
        CHECK (action_state IN ('OBSERVE', 'LEARN_ONLY', 'PASSIVE', 'SOFT_NUDGE', 'ACTIVE_ORCHESTRATE', 'BLOCKED')),
    model_version TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, event_type, context_key)
);

CREATE INDEX IF NOT EXISTS idx_user_event_states_type_p60
    ON decision.user_event_states (event_type, p60 DESC);

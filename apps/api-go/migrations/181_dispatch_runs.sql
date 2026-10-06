-- DISPATCH-LOOP-001（2026-10-06）：快速模式（matchingMode=FAST）的自动派单。
--
-- 一张需求的每个档位一行 run：按候选批次的排名一次只给一个人发邀约（5 分钟），被接 ⇒ ASSIGNED，
-- 过期 / 被撤 ⇒ 顺延下一位，候选用完 ⇒ EXHAUSTED（进运营工作台的「待人工」）。规则与理由见
-- internal/dispatch 的包注释（2026-10-06 用户定：标价 ≤ 预算、需求方事先同意、一次 1 人、不扩半径）。
--
-- 口径：
--  ① candidates 是建 run 那一刻批次排名的快照（JSONB 数组，顺序即派单顺序）。之后有人改资料、
--     改价，不回头改这份 —— 跟 supply.candidate_batches 一样，「当时按什么顺序派的」要查得出来。
--  ② steps 只追加不改：每一次发出、过期、跳过（超预算 / 被拒 / 同单另一档位在等她）、运营动作
--     都是一行，运营看到的是「卡在哪一步」，而不是一个状态码。
--  ③ (task_id, slot_id) 唯一：同一个档位不会有两条派单同时在跑（重复发布 / 重试都撞这条）。

CREATE SCHEMA IF NOT EXISTS dispatch;

CREATE TABLE IF NOT EXISTS dispatch.runs (
    id                 TEXT PRIMARY KEY,
    task_id            TEXT NOT NULL,
    slot_id            TEXT NOT NULL,
    requester_id       TEXT NOT NULL,
    batch_id           TEXT NOT NULL,
    budget_vnd         BIGINT NOT NULL CHECK (budget_vnd > 0),
    status             TEXT NOT NULL CHECK (status IN ('RUNNING', 'ASSIGNED', 'EXHAUSTED', 'CANCELLED')),
    candidates         JSONB NOT NULL CHECK (jsonb_typeof(candidates) = 'array'),
    cursor             INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
    current_offer_id   TEXT,
    current_agent_id   TEXT,
    current_expires_at TIMESTAMPTZ,
    assigned_agent_id  TEXT,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    version            INTEGER NOT NULL CHECK (version > 0),
    UNIQUE (task_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_runs_status_updated ON dispatch.runs (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_runs_task ON dispatch.runs (task_id);

CREATE TABLE IF NOT EXISTS dispatch.steps (
    id       BIGSERIAL PRIMARY KEY,
    run_id   TEXT NOT NULL REFERENCES dispatch.runs (id) ON DELETE CASCADE,
    kind     TEXT NOT NULL,
    agent_id TEXT,
    offer_id TEXT,
    actor    TEXT NOT NULL CHECK (actor <> ''),
    detail   JSONB,
    at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dispatch_steps_run ON dispatch.steps (run_id, id);

COMMENT ON TABLE dispatch.runs IS
  'DISPATCH-LOOP-001: FAST 需求每个档位一条自动派单。candidates 是建单时批次排名快照；status 见 internal/dispatch。';
COMMENT ON TABLE dispatch.steps IS
  'DISPATCH-LOOP-001: 派单流水，只追加。actor = dispatch（系统）或运营 principal。';

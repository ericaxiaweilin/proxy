-- 181_research_experiments.sql — OPS-RESEARCH-001（2026-10-08）
-- 实验注册表 + 影子评估：运营后台 Research 页（Lab / Shadow / Prod）的后端。
--
-- 设计边界（有意保持最小）：
--   * 这是「实验注册 + 影子评估」的最小闭环：注册实验 → 沿 DRAFT→LAB→SHADOW→PROD
--     推阶段 → SHADOW 阶段可以用真实 ContextSnapshot 跑影子判定（进库、不进 App）。
--   * 不做流量分桶 / 置信区间 / 自动晋级 —— 没有行为样本，那些是空转的机器。
--   * arms 先存 jsonb（控制/候选的参数差异今天只有「引擎参数」这一种来源）。

CREATE SCHEMA IF NOT EXISTS research;

CREATE TABLE IF NOT EXISTS research.experiments (
    experiment_id text PRIMARY KEY,
    name          text NOT NULL,
    hypothesis    text NOT NULL DEFAULT '',
    surface       text NOT NULL DEFAULT 'home',
    stage         text NOT NULL DEFAULT 'DRAFT'
                  CHECK (stage IN ('DRAFT', 'LAB', 'SHADOW', 'PROD', 'ENDED')),
    traffic_pct   integer NOT NULL DEFAULT 0 CHECK (traffic_pct BETWEEN 0 AND 100),
    arms          jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    version       integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS research.shadow_evaluations (
    evaluation_id    text PRIMARY KEY,
    experiment_id    text NOT NULL REFERENCES research.experiments (experiment_id),
    snapshot         jsonb NOT NULL,
    intent           jsonb,
    no_change_reason text NOT NULL DEFAULT '',
    decided_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shadow_eval_experiment
    ON research.shadow_evaluations (experiment_id, decided_at DESC);

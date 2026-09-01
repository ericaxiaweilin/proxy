-- 046_observation_template.sql — M6.5 模板补齐，OutcomeTemplate 持久化
-- 模板定义可观测指标的结构（key/unit/描述），ObservationSet 引用 template_id 时校验

CREATE TABLE IF NOT EXISTS outcome.observation_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

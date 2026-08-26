-- 027_experience_runtime.sql — Context-Driven Experience Runtime v1
-- §6 ExperienceIntent / §10 SurfacePlan / §12 Delta / §16 Action 持久化
-- 不阻塞本地内存模式；PostgreSQL 模式下与 command Unit of Work 共事务。

CREATE SCHEMA IF NOT EXISTS experience;

CREATE TABLE IF NOT EXISTS experience.experience_intent (
  intent_id           TEXT PRIMARY KEY,
  type                TEXT NOT NULL,
  objective           TEXT NOT NULL CHECK (objective IN ('REDUCE_TIME_AND_DECISION_COST','INCREASE_CONVENIENCE','ENSURE_SAFETY','IMPROVE_FULFILLMENT','REDUCE_RISK','GENERAL_ASSIST')),
  priority            DOUBLE PRECISION NOT NULL CHECK (priority >= 0 AND priority <= 1),
  intervention_level  TEXT NOT NULL CHECK (intervention_level IN ('PASSIVE','SOFT_NUDGE','ACTIVE','PUSH','POPUP')),
  context_snapshot_id TEXT NOT NULL,
  decision_id         TEXT NOT NULL,
  allowed_actions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  forbidden_actions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at          TIMESTAMPTZ NOT NULL,
  reason_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experience.surface_plan (
  surface_plan_id      TEXT PRIMARY KEY,
  surface_id           TEXT NOT NULL,
  surface_version      INTEGER NOT NULL,
  decision_id          TEXT NOT NULL REFERENCES experience.experience_intent(decision_id) DEFERRABLE INITIALLY DEFERRED,
  experience_intent_id TEXT NOT NULL REFERENCES experience.experience_intent(intent_id),
  context_snapshot_id  TEXT NOT NULL,
  render_mode          TEXT NOT NULL CHECK (render_mode IN ('NATIVE_COMPONENT','PRIMITIVE_COMPOSITION','FALLBACK')),
  native_component     TEXT,
  schema_ref           TEXT,
  slots                JSONB NOT NULL DEFAULT '{}'::jsonb,
  ttl_s                INTEGER NOT NULL CHECK (ttl_s > 0),
  fallback_plan_id     TEXT,
  policy_version       TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (surface_id, surface_version)
);

CREATE INDEX IF NOT EXISTS idx_surface_plan_surface_id_version ON experience.surface_plan(surface_id, surface_version DESC);
CREATE INDEX IF NOT EXISTS idx_experience_intent_expires_at ON experience.experience_intent(expires_at);

COMMENT ON TABLE experience.experience_intent IS '§6 Experience Intent — Decision Engine 与 UI 的唯一语义桥梁';
COMMENT ON TABLE experience.surface_plan IS '§10 SurfacePlan — 客户端唯一执行合约';

-- Proxy M2 收尾：canonical Task / TaskSlot 持久化
-- draft 仍保留 builder 状态，tasks/tasks_slots 为发布后的 canonical truth
-- 幂等：CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS demand.tasks (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES demand.task_drafts(id),
    owner_user_account_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    version INT NOT NULL,
    source_input TEXT NOT NULL DEFAULT '',
    changes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK (lifecycle IN ('COMMITTED', 'CANCELLED', 'COMPLETED')),
    CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_demand_tasks_owner
    ON demand.tasks (owner_user_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_demand_tasks_principal
    ON demand.tasks (principal_type, principal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS demand.task_slots (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES demand.tasks(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL,
    state TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK (state IN ('OPEN', 'OFFERED', 'RESERVED', 'FILLED', 'CANCELLED', 'EXPIRED')),
    CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_demand_task_slots_task
    ON demand.task_slots (task_id, state);

CREATE INDEX IF NOT EXISTS idx_demand_task_slots_role
    ON demand.task_slots (role_id);

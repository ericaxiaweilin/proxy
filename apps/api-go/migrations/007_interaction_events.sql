-- Proxy interaction events schema（C1 Event Stream 最小底座）
CREATE TABLE IF NOT EXISTS localnet.interaction_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    need_id TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interaction_actor ON localnet.interaction_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_target ON localnet.interaction_events (target_type, target_id);

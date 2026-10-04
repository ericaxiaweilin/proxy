-- MERCHANT-CREATOR-INVITE-001：商家→creator 定向邀约表。
-- 状态机 PENDING → ACCEPTED / DECLINED / CANCELLED（读到过期算 EXPIRED，
-- 由应用层判定，不靠定时任务扫表）。
CREATE TABLE IF NOT EXISTS supply.collab_invitations (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    service_type TEXT NOT NULL DEFAULT 'CITY_COMPANION',
    start_at TIMESTAMPTZ,
    duration_h INT NOT NULL DEFAULT 0,
    price_vnd BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'VND',
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_collab_invitations_merchant
    ON supply.collab_invitations (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_collab_invitations_agent
    ON supply.collab_invitations (agent_id, created_at DESC);

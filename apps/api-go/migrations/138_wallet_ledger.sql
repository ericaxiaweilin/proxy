-- WALLET-001: 用户虚拟货币账本。余额不落库（现场 SUM），行只增不改不删；
-- 取消/退款走冲正分录，不删原行。
CREATE SCHEMA IF NOT EXISTS wallet;

CREATE TABLE IF NOT EXISTS wallet.entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    delta BIGINT NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_entries_user ON wallet.entries (user_id, created_at DESC);

-- VIP 有效期（兑换 vip_7d 延长；level 不存——没有规则来源不编号码）。
CREATE TABLE IF NOT EXISTS wallet.vip_grants (
    user_id TEXT PRIMARY KEY,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

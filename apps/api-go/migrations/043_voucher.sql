-- 043_voucher.sql — P0 entitlement lifecycle PG 持久化
-- 替代 voucher/service.go 的 in-memory map，使 List/Get/Redemption/Settle 跨重启可回放

CREATE SCHEMA IF NOT EXISTS voucher;

CREATE TABLE IF NOT EXISTS voucher.vouchers (
    actor_id            TEXT NOT NULL,
    voucher_id          TEXT NOT NULL,
    family              TEXT NOT NULL CHECK (family IN ('COFFEE','EXPERIENCE','ACTIVITY')),
    display_value       INTEGER NOT NULL CHECK (display_value > 0),
    currency            TEXT NOT NULL DEFAULT 'VND',
    scope_name          TEXT NOT NULL,
    scope_detail        TEXT NOT NULL DEFAULT '',
    valid_from          TEXT NOT NULL,
    valid_until         TEXT NOT NULL,
    redeem_time_window  TEXT NOT NULL DEFAULT '',
    minimum_spend       TEXT NOT NULL DEFAULT '无',
    per_person_limit    INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL CHECK (status IN ('AVAILABLE','REDEEMED','SETTLED','EXPIRED')),
    issuer_label        TEXT NOT NULL DEFAULT '',
    settlement_value    INTEGER NOT NULL,
    funding_proxy       INTEGER NOT NULL DEFAULT 0,
    funding_creator     INTEGER NOT NULL DEFAULT 0,
    funding_merchant    INTEGER NOT NULL DEFAULT 0,
    reservation_needed  BOOLEAN NOT NULL DEFAULT false,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id, voucher_id)
);

CREATE TABLE IF NOT EXISTS voucher.redemptions (
    redemption_id TEXT PRIMARY KEY,
    voucher_id    TEXT NOT NULL,
    actor_id      TEXT NOT NULL,
    code          TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    used          BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (actor_id, voucher_id) REFERENCES voucher.vouchers(actor_id, voucher_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voucher_actor ON voucher.vouchers(actor_id);
CREATE INDEX IF NOT EXISTS idx_voucher_status ON voucher.vouchers(status);
CREATE INDEX IF NOT EXISTS idx_redemption_actor ON voucher.redemptions(actor_id);

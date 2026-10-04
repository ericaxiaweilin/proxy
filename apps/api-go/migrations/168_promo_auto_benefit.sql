-- MERCHANT-CREATOR-PROMO-001（自动档）：商家默认优惠 + 绑定来源。
-- promo_auto_benefits：一家一行（upsert）；开着时没绑过的码来报码，
-- 自动按默认建 ACTIVE 绑定。promo_benefits.source 记 MANUAL/AUTO。
CREATE TABLE IF NOT EXISTS supply.promo_auto_benefits (
    merchant_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    face_value_vnd BIGINT NOT NULL DEFAULT 0,
    scope_name TEXT NOT NULL DEFAULT '',
    validity_days INT NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE supply.promo_benefits
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';

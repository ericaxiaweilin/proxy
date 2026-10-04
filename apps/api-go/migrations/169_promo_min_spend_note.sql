-- MERCHANT-CREATOR-PROMO-001（门槛 + 调整原因）：
-- promo_benefits.min_spend_vnd：满多少才减（0 = 无门槛）；note：商家手填的调整原因（团队回看用）。
-- promo_auto_benefits.min_spend_vnd：自动档默认优惠的门槛，自动建绑定时照抄。
ALTER TABLE supply.promo_benefits
    ADD COLUMN IF NOT EXISTS min_spend_vnd BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE supply.promo_auto_benefits
    ADD COLUMN IF NOT EXISTS min_spend_vnd BIGINT NOT NULL DEFAULT 0;

-- MERCHANT-CREATOR-INVITE-001（修）：出价从一口价改区间 + 可谈 + 双向还价。
-- price_vnd（一口价）下掉，换成区间两端 + 可谈开关 + 合作目的 + 出价版本号/谁出的价。
-- 这表 165 新建的，还没有任何业务数据，直接重塑，不做数据搬运。
ALTER TABLE supply.collab_invitations
    ADD COLUMN IF NOT EXISTS price_min_vnd BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price_max_vnd BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS negotiable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'OTHER',
    ADD COLUMN IF NOT EXISTS terms_version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS counter_by TEXT NOT NULL DEFAULT '';
ALTER TABLE supply.collab_invitations DROP COLUMN IF EXISTS price_vnd;

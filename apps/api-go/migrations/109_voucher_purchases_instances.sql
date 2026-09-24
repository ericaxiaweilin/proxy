-- 109_voucher_purchases_instances.sql — 平台采购与可追溯券实例（VOUCHER-PURCHASE-001）
-- voucher 做正本第 2 步：平台向商户采购一批券（B2B：合同 / 发票 / MST 快照 /
-- 单价 / 数量），确认时铸出每一张实例。追溯链 instance → purchase →
-- (merchant_id, contract_ref, invoice_ref, tax_code_snapshot) 一次 join 走通。
-- 金额算术在库层闭合：total 必须等于 quantity * unit_cost，不自洽进不了库。
-- 注意：本文件编号与 109_account_status_erased.sql 相同，这是**安全的**：
-- migrator 的 Version 取的是「去掉 .sql 的完整文件名」（migrator.go:282），
-- 不是前三位数字，所以 109_a 与 109_b 是两个不同的版本、按文件名字典序各自
-- 应用一次；migrationVersionPattern 只校验文件名形状，全仓没有任何唯一性检查。
-- main 里 003 / 035 / 078 等本来就各有两份同号迁移，可作旁证。
-- （分支最初写 109 时，108 已被 media_ai_provenance 占用，作者当时也是这么判断的。）

CREATE TABLE IF NOT EXISTS voucher.purchases (
    purchase_id        TEXT PRIMARY KEY,
    definition_id      TEXT NOT NULL REFERENCES voucher.definitions(definition_id),
    merchant_id        TEXT NOT NULL REFERENCES business.accounts(id),
    quantity           INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_minor    BIGINT NOT NULL CHECK (unit_cost_minor >= 0),
    total_minor        BIGINT NOT NULL CHECK (total_minor >= 0),
    currency           TEXT NOT NULL DEFAULT 'VND',
    contract_ref       TEXT,
    invoice_ref        TEXT,
    tax_code_snapshot  TEXT,
    status             TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ORDERED','CONFIRMED','CANCELLED')),
    ordered_by         TEXT NOT NULL,
    ordered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at       TIMESTAMPTZ,
    version            INTEGER NOT NULL DEFAULT 1,
    CHECK (total_minor = quantity * unit_cost_minor)
);

CREATE TABLE IF NOT EXISTS voucher.instances (
    instance_id             TEXT PRIMARY KEY,
    purchase_id             TEXT NOT NULL REFERENCES voucher.purchases(purchase_id),
    definition_id           TEXT NOT NULL REFERENCES voucher.definitions(definition_id),
    merchant_id             TEXT NOT NULL REFERENCES business.accounts(id),
    store_id                TEXT REFERENCES business.stores(id),
    code                    TEXT NOT NULL UNIQUE,
    holder_actor_id         TEXT,
    status                  TEXT NOT NULL DEFAULT 'MINTED'
        CHECK (status IN ('MINTED','DISTRIBUTED','REDEEMED','EXPIRED','VOIDED')),
    issued_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at              TIMESTAMPTZ,
    redeemed_at             TIMESTAMPTZ,
    redeemed_by_merchant_id TEXT,
    redeemed_by_user_id     TEXT,
    redemption_evidence     TEXT
        CHECK (redemption_evidence IS NULL OR redemption_evidence IN ('MERCHANT_SCAN','ORDER_VERIFIED')),
    version                 INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_voucher_purchases_merchant ON voucher.purchases (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_instances_merchant ON voucher.instances (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_instances_holder ON voucher.instances (holder_actor_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_instances_purchase ON voucher.instances (purchase_id);

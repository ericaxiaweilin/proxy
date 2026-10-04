-- MERCHANT-CREATOR-PROMO-002：商家 × creator 专属码（一对一个唯一码）+ 调整留痕 + 发券。
-- 用户 2026-10-04：「对于 n 商家 n creator 开发专属唯一的优惠码，有利于激励，让 creator 商家成长」。
--
-- merchant_creator_promos：一对（商家, creator）一行，code 全局唯一；terms / suggestion 用 JSONB
--   存（条款和系统建议的依据会随原型迭代加字段，不值得每次改表）；category 单列出来，
--   「同品类平均折扣」要按它查。
-- promo_changes：条款调整留痕，只增不改。
-- promo_issues：发券（顾客领券），每人每码一张。
-- promo_quotes 加 customer_id / issue_id / first_visit_source：凭券核销时新客由系统判定。
CREATE TABLE IF NOT EXISTS supply.merchant_creator_promos (
    code          TEXT PRIMARY KEY,
    merchant_id   TEXT NOT NULL,
    merchant_name TEXT NOT NULL DEFAULT '',
    agent_id      TEXT NOT NULL,
    creator_name  TEXT NOT NULL DEFAULT '',
    terms         JSONB NOT NULL,
    category      TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'ACTIVE',
    mode          TEXT NOT NULL DEFAULT 'SUGGESTED',
    suggestion    JSONB NOT NULL DEFAULT '{}'::jsonb,
    note          TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    UNIQUE (merchant_id, agent_id)
);
CREATE INDEX IF NOT EXISTS ix_mc_promos_agent ON supply.merchant_creator_promos (agent_id);
CREATE INDEX IF NOT EXISTS ix_mc_promos_category ON supply.merchant_creator_promos (category) WHERE category <> '';

CREATE TABLE IF NOT EXISTS supply.promo_changes (
    id         TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    actor_id   TEXT NOT NULL DEFAULT '',
    before     JSONB NOT NULL,
    after      JSONB NOT NULL,
    mode       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    changed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_promo_changes_code ON supply.promo_changes (code, changed_at);

CREATE TABLE IF NOT EXISTS supply.promo_issues (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (code, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_promo_issues_merchant ON supply.promo_issues (merchant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS ix_promo_issues_agent ON supply.promo_issues (agent_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS ix_promo_issues_customer ON supply.promo_issues (customer_id, issued_at DESC);

ALTER TABLE supply.promo_quotes
    ADD COLUMN IF NOT EXISTS customer_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS issue_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS first_visit_source TEXT NOT NULL DEFAULT 'CLERK';
CREATE UNIQUE INDEX IF NOT EXISTS ux_promo_quotes_issue ON supply.promo_quotes (issue_id) WHERE issue_id <> '';

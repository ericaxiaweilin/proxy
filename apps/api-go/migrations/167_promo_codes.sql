-- MERCHANT-CREATOR-PROMO-001：creator 专属营销码三表。
-- promo_codes：码全局唯一归 creator；promo_benefits：商家对码的优惠承诺；
-- promo_quotes：报码归因行（只增不改，核销记录不删）。
CREATE TABLE IF NOT EXISTS supply.promo_codes (
    code TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_promo_codes_agent
    ON supply.promo_codes (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supply.promo_benefits (
    merchant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    face_value_vnd BIGINT NOT NULL DEFAULT 0,
    scope_name TEXT NOT NULL DEFAULT '',
    valid_until TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (merchant_id, code)
);

CREATE TABLE IF NOT EXISTS supply.promo_quotes (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    code TEXT NOT NULL,
    amount_vnd BIGINT NOT NULL DEFAULT 0,
    discount_vnd BIGINT NOT NULL DEFAULT 0,
    first_visit BOOLEAN NOT NULL DEFAULT FALSE,
    quoted_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_promo_quotes_merchant
    ON supply.promo_quotes (merchant_id, quoted_at DESC);
CREATE INDEX IF NOT EXISTS ix_promo_quotes_agent
    ON supply.promo_quotes (agent_id, quoted_at DESC);

-- M9 Business Workspace — BusinessAccount, Membership, Store/Venue, Task, Spend

CREATE SCHEMA IF NOT EXISTS business;

CREATE TABLE IF NOT EXISTS business.accounts (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('ACTIVE','SUSPENDED'))
);

CREATE TABLE IF NOT EXISTS business.memberships (
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (business_id, user_id),
    CHECK (role IN ('OWNER','ADMIN','OPERATOR','VIEWER')),
    CHECK (status IN ('ACTIVE','INVITED','SUSPENDED'))
);

CREATE TABLE IF NOT EXISTS business.stores (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('ACTIVE','CLOSED'))
);

CREATE TABLE IF NOT EXISTS business.spend_records (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES business.accounts(id),
    order_id TEXT NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_spend_business ON business.spend_records (business_id, created_at DESC);

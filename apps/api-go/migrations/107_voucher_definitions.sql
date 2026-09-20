-- 107_voucher_definitions.sql — 商户券发行定义（VOUCHER-ISSUE-001）
-- voucher 做正本第 1 步：把商户主体接到券上。商户（OWNER/ADMIN 经
-- merchantPublishCommands 验过成员资格）定义「我发什么券」；券实例与采购
--（第 2 步）再从 definition 追溯来源。merchant_id 只由服务端标注写入，
-- 绝不从 payload 取，见 internal/api/merchant_identity.go。

CREATE TABLE IF NOT EXISTS voucher.definitions (
    definition_id            TEXT PRIMARY KEY,
    merchant_id              TEXT NOT NULL REFERENCES business.accounts(id),
    store_id                 TEXT REFERENCES business.stores(id),
    family                   TEXT NOT NULL CHECK (family IN ('COFFEE','EXPERIENCE','ACTIVITY')),
    face_value_minor         BIGINT NOT NULL CHECK (face_value_minor > 0),
    currency                 TEXT NOT NULL DEFAULT 'VND',
    scope_name               TEXT NOT NULL,
    valid_from               DATE NOT NULL,
    valid_until              DATE NOT NULL,
    per_person_limit         INTEGER NOT NULL DEFAULT 1 CHECK (per_person_limit >= 1),
    merchant_unit_cost_minor BIGINT NOT NULL CHECK (merchant_unit_cost_minor >= 0),
    status                   TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
    version                  INTEGER NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (valid_until >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_voucher_definitions_merchant ON voucher.definitions (merchant_id, status);

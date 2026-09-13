-- COMP-SELLER-001: 供给侧实名（越南电商法 122/2025 + NĐ 248/2026，2026-07-01 生效）
--
-- 法条要求：在本平台上卖东西的人必须是「可识别、且绑定到税务身份」的主体。
-- 当前 supply.agent_profiles 只有经营身份（agent_id + 显示名），没有任何
-- 实名证据 —— 「匿名个人卖时间」正是这条法要禁的形态。
--
-- 本表存的是「核验记录」，不是证件原件：
--   * id_number_hash 只存哈希，绝不落明文证件号（PDP 法 91/2025 + NĐ 356/2025）
--   * tax_code (MST) 是结算必需的税务身份，允许为空 = 尚未取得，但会被结算卡住
--   * method 记录取得方式，OPERATOR_ATTESTATION 表示由具名运营人员人工核过，
--     不是系统自动放行 —— 谁放的、什么时候放的，都在 verified_by / verified_at 里
--
-- 「已核验」是有时效的：expires_at 到点即失效，必须重新核。过期 ≠ 已核验。

CREATE TABLE IF NOT EXISTS supply.seller_real_name_verifications (
    id               TEXT PRIMARY KEY,
    agent_id         TEXT NOT NULL,
    user_account_id  TEXT,
    legal_name       TEXT NOT NULL,
    id_type          TEXT NOT NULL,
    id_number_hash   TEXT NOT NULL,
    tax_code         TEXT,
    status           TEXT NOT NULL,
    method           TEXT NOT NULL,
    verified_by      TEXT NOT NULL,
    verified_at      TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL,
    CHECK (id_type IN ('CCCD', 'VNEID', 'PASSPORT')),
    CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
    CHECK (method IN ('DOCUMENT', 'VNEID', 'OPERATOR_ATTESTATION')),
    CHECK (legal_name <> '')
);

-- 一个 agent 同时只能有一条「已核验」记录：避免两条并列、各说各话。
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_realname_verified_agent
    ON supply.seller_real_name_verifications (agent_id)
    WHERE status = 'VERIFIED';

CREATE INDEX IF NOT EXISTS idx_seller_realname_agent
    ON supply.seller_real_name_verifications (agent_id, status);

CREATE INDEX IF NOT EXISTS idx_seller_realname_account
    ON supply.seller_real_name_verifications (user_account_id);

COMMENT ON TABLE supply.seller_real_name_verifications IS
  'COMP-SELLER-001: 供给侧实名核验记录。候选资格（Eligibility）只认 status=VERIFIED 且未过期的行；查不到或查不动一律视为未核验（fail-closed）。';

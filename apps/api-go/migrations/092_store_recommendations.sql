-- STORE-REC-001: 店铺推荐受理留痕（append-only）。
--
-- 原始设计（Master PRD v1.1 §15 + CBOS）：企业/店铺是独立模块，体系增长靠
-- 发展 builder + 小美（AI）/ 用户推荐商铺进入体系。推荐记录是举证材料：
-- 平台能证明「谁、什么时候、因为什么推荐了哪家店」，后续接入与否由运营
-- 在 bdash 评估，不在此表伪造结果。
--
-- 沿用 086/087/088/089 的口径：
--   - append-only：推荐与其后续处理都是举证材料，不 UPDATE / 不 DELETE。
--   - fail-closed：店名/城市/理由缺一不可；推荐人必须来自鉴权后的账号。
--   - origin 区分真人用户（USER）与 AI 小美（AI）推荐。

CREATE TABLE IF NOT EXISTS business.store_recommendations (
    id               TEXT PRIMARY KEY,
    store_name       TEXT NOT NULL,
    city             TEXT NOT NULL,
    category         TEXT NOT NULL DEFAULT '',
    reason           TEXT NOT NULL,
    recommended_by   TEXT NOT NULL,
    origin           TEXT NOT NULL DEFAULT 'USER' CHECK (origin IN ('USER', 'AI')),
    created_at       TIMESTAMPTZ NOT NULL,
    CHECK (length(trim(store_name)) > 0),
    CHECK (length(trim(city)) > 0),
    CHECK (length(trim(reason)) > 0),
    CHECK (recommended_by <> '')
);

-- 运营队列：按城市 / 时间拉出待评估推荐。
CREATE INDEX IF NOT EXISTS idx_store_recommendations_city
    ON business.store_recommendations (city, created_at);

COMMENT ON TABLE business.store_recommendations IS
  'STORE-REC-001: 店铺推荐受理（append-only）。用户或 AI 小美把场地/商家推荐进体系，运营评估后接入。';

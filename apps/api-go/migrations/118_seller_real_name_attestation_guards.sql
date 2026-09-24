-- COMP-SELLER-001 收口：让「已核验」在 DB 层面必须带有效期与归属人。
--
-- 084 建了 supply.seller_real_name_verifications，并在注释里承诺两件事：
--   * method='OPERATOR_ATTESTATION' 表示由「具名运营人员」人工核过 ——
--     谁放的、什么时候放的，都在 verified_by / verified_at 里；
--   * expires_at 到点即失效，「必须重新核。过期 ≠ 已核验」。
--
-- 但这两条当时都只是注释：既没有约束，也没有任何代码会写这张表
-- （`INSERT INTO supply.seller_real_name_verifications` 全仓零命中）。结果是
-- 「已核验」可以由一条手写 SQL 凭空产生，且 expires_at 留空即永不过期 ——
-- 而读侧当时恰好把 NULL 读成「永不过期」。
--
-- 本迁移把两条承诺变成 DB 保证（写侧见 supply.AttestSellerRealName）：
--   1. status='VERIFIED' ⇒ expires_at IS NOT NULL
--   2. verified_by <> ''  ⇒ 核验记录必须能回答「谁放的」
--
-- 两个约束都加 NOT VALID，沿用 049/109 的做法：本表存量行是写侧落地前的
-- 手工测试数据（legal_name 形如 'TEST-ONLY *'、id_number_hash 是字面量而
-- 不是哈希、expires_at 为空），它们不该因为一次迁移就被追认为合规证据。
-- NOT VALID 让约束对新写入立即生效，同时不改写历史行 —— 历史行的处置是
-- 数据治理动作，不是 schema 变更。
--
-- 存量行也不会被静默放行：读侧（platform/postgres/seller_identity.go）本次
-- 同步改为「expires_at IS NULL = 未核验」，所以那些行从本次起不再构成
-- 实名证据。两侧都要求，才没有中间态。

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'seller_real_name_verified_has_expiry'
    ) THEN
        ALTER TABLE supply.seller_real_name_verifications
            ADD CONSTRAINT seller_real_name_verified_has_expiry
            CHECK (status <> 'VERIFIED' OR expires_at IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'seller_real_name_attestor_named'
    ) THEN
        ALTER TABLE supply.seller_real_name_verifications
            ADD CONSTRAINT seller_real_name_attestor_named
            CHECK (verified_by <> '') NOT VALID;
    END IF;
END $$;

COMMENT ON CONSTRAINT seller_real_name_verified_has_expiry ON supply.seller_real_name_verifications IS
  'COMP-SELLER-001: VERIFIED 必须带 expires_at —— 否则「到点即失效、必须重新核」会被一个空值整个吃掉。NOT VALID：不追认写侧落地前的存量测试行。';

COMMENT ON CONSTRAINT seller_real_name_attestor_named ON supply.seller_real_name_verifications IS
  'COMP-SELLER-001: 核验记录必须能回答「谁放的」（084 的「具名运营人员」）。NOT VALID：不追认存量行。';

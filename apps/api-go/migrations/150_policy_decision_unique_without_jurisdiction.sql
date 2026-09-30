-- 150: 删掉 065 留下、067 想删但**没删掉**的那条「不看 jurisdiction」的唯一约束。
--
-- 症状（2026-09-30 实测，由 scripts/p1e-jurisdiction-e2e.sh 第 8 步暴露）：
-- 同一个用户换了辖区之后再下一单 PLATFORM_PAY，策略决策写不进去 ——
--
--   ERROR: duplicate key value violates unique constraint
--          "policy_decisions_user_id_category_code_terms_version_privac_key" (SQLSTATE 23505)
--
-- 于是那一单永远确认不了（决策是确认的前提）。这不是「同一辖区复用决策」那种正常情况，
-- 而是**换辖区应该产生一条新决策、却被一条更窄的旧约束挡住**。
--
-- 为什么会这样：
--   065_policy_decisions.sql:49 建了
--       UNIQUE (user_id, category_code, terms_version, privacy_version)
--   PostgreSQL 自动起名时把标识符截断到 63 字符，实际名字是
--       policy_decisions_user_id_category_code_terms_version_privac_key
--   067_user_jurisdiction.sql 以为它叫
--       policy_decisions_user_cat_terms_privacy_key
--   于是那段 `IF EXISTS ... DROP CONSTRAINT` **静默跳过了**（名字对不上），
--   而 067 又把更宽的 (..., jurisdiction) 那条加了上去。
--   结果两条同时存在，**更窄的那条说了算**（4 列的唯一天然蕴含 5 列的唯一）。
--
-- 为什么删它是安全的：5 列约束严格弱于 4 列约束 —— 任何满足 4 列的旧数据都满足 5 列。
-- 删掉之后剩下的 `policy_decisions_user_cat_terms_privacy_jur_key` 就是 067 本来想要的那条。
--
-- 为什么不能改 067：它**已经应用过**，改已应用的迁移会登记成 checksum 漂移。
--
-- ⚠️ 这里刻意**不**只用 `DROP CONSTRAINT IF EXISTS`：那正是 067 栽的那个坑 ——
-- 名字写错就静默什么都不做，看起来「已修复」。所以最后要**大声校验**最终状态，
-- 与 146 的 harden_append_only（「属主漂移时 REVOKE 会大声失败，不静默跳过」）同一条教训。

BEGIN;

DO $$
DECLARE
    stale    TEXT := 'policy_decisions_user_id_category_code_terms_version_privac_key';
    intended TEXT := 'policy_decisions_user_cat_terms_privacy_jur_key';
    remaining INT;
BEGIN
    IF to_regclass('policy.policy_decisions') IS NULL THEN
        RAISE EXCEPTION 'POLICY-DECISION-UNIQUE-001: policy.policy_decisions is missing';
    END IF;

    -- 更宽的那条必须在位，否则删掉窄的等于把唯一性整个放开。
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = intended AND conrelid = 'policy.policy_decisions'::regclass
    ) THEN
        RAISE EXCEPTION 'POLICY-DECISION-UNIQUE-001: % is missing; refusing to drop the narrower constraint', intended;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = stale AND conrelid = 'policy.policy_decisions'::regclass
    ) THEN
        ALTER TABLE policy.policy_decisions DROP CONSTRAINT policy_decisions_user_id_category_code_terms_version_privac_key;
    END IF;

    -- 大声校验：最终必须**恰好剩一条**唯一约束。名字万一再写错，这里就炸，
    -- 而不是留下「两条并存、窄的说了算」这个静默状态。
    SELECT count(*) INTO remaining
    FROM pg_constraint
    WHERE conrelid = 'policy.policy_decisions'::regclass AND contype = 'u';

    IF remaining <> 1 THEN
        RAISE EXCEPTION 'POLICY-DECISION-UNIQUE-001: expected exactly 1 unique constraint on policy.policy_decisions, found %', remaining;
    END IF;
END $$;

COMMIT;

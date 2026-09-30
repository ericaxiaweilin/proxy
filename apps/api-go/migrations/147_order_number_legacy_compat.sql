-- ORDER-NO-LEGACY-COMPAT-001：21 位规范上线后，main 时代**已经发出去的 16 位号**
-- （yyMMdd + 9 位全局序号 + Luhn，见 internal/ordernumber 的 Valid）必须继续能写、能查。
-- 它们已经回填进库、已经被用户和客服抄在工单里，不是可以重发的号。
--
-- 144 / 145 / 146 有三处只认 21 位，在"跑过 main 那套 16 位"的库上会出问题：
--   1) fulfillment.guard_order_no() 是 BEFORE INSERT OR UPDATE，条件 `!~ '^[0-9]{21,}$'`
--      ⇒ 存量 16 位号的行**任何 UPDATE 都被判违规**，订单状态机（CONFIRMED→EXECUTING→…）
--      直接冻住，只剩破窗 override 一条路；
--   2) marketplace_opportunities_number_key / activity_code_digits_key 两个部分唯一索引
--      的谓词写的是 `{21,}`，而老库里这两个索引已按 `{16,}` 建过 —— `CREATE UNIQUE
--      INDEX IF NOT EXISTS` 会**静默跳过** ⇒ 新旧库谓词永久分叉，谁也没报错；
--   3) 139 的计数器对齐只收 `{21,}` —— 这条无影响：历史 16 位号本来就不在 21 位计数器空间里。
--
-- 本条把守卫放宽到 `{16,}`（两种形状都覆盖），并把两个唯一索引 DROP 后重建，让谓词在
-- 所有库上收敛成同一份。**不改 144/145/146 的内容**（已应用的迁移不许改内容），只在这里覆盖。
-- 重建唯一索引会短暂持锁：开发/测试库无感，生产表大时要挑窗口。
--
-- 干净库测不出上面任何一条（没有历史号）—— 所以这条迁移的验收必须在**跑过 main 那套
-- 16 位方案的库**上做：见 internal/platform/postgres/order_number_legacy_compat_test.go。
BEGIN;

CREATE OR REPLACE FUNCTION fulfillment.guard_order_no() RETURNS trigger AS $$
BEGIN
    IF fulfillment.guard_override_reason() <> '' THEN
        RETURN NEW;
    END IF;
    IF OLD.order_no IS NOT NULL AND NEW.order_no IS DISTINCT FROM OLD.order_no THEN
        PERFORM fulfillment.guard_violation('order_no is immutable (' || OLD.id || ')');
    END IF;
    -- 16 位：main 时代已发出的历史号（yyMMdd + 9 位全局序号 + Luhn 校验位）。
    -- 21 位起：现行规范（类别码 3 位 + 越南本地 YYMMDDHHMMSS + 当天序号 6 位）。
    IF NEW.order_no IS NOT NULL AND NEW.order_no !~ '^[0-9]{16,}$' THEN
        PERFORM fulfillment.guard_violation('order_no must be all digits, 16 or more (' || NEW.id || ')');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX IF EXISTS marketplace.marketplace_opportunities_number_key;
CREATE UNIQUE INDEX marketplace_opportunities_number_key
    ON marketplace.opportunities ((payload->>'number'))
    WHERE payload->>'number' ~ '^[0-9]{16,}$';

DROP INDEX IF EXISTS activity.activity_code_digits_key;
CREATE UNIQUE INDEX activity_code_digits_key
    ON activity.activities ((payload->>'code'))
    WHERE payload->>'code' ~ '^[0-9]{16,}$';

COMMIT;

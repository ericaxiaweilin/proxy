-- ORDER-ROLE-001 修正（2026-09-30）：只追加表撤 UPDATE 之后，指向它的外键会失效。
--
-- 症状：PLATFORM_PAY 订单**永远无法确认**。接口只回 HTTP 500
--   {"error":"command_transaction_failed"} —— 一个不指向任何东西的字符串。
--
-- 链条（每一步都实测过）：
--   1. 146 的 harden_append_only('policy.policy_decisions') 把 UPDATE 从属主 proxy 撤了
--      （migrations/146:229 撤的是属主那一行，所以 146:230 那个 owner_name <> 'proxy'
--      的保护根本轮不到）。ACL 变成 {proxy=arxt/proxy}，没有 w(UPDATE)。
--   2. policy.order_decisions 有外键 order_decisions_decision_id_fkey 指向
--      policy.policy_decisions(id)。
--   3. PostgreSQL 检查外键要拿 FOR KEY SHARE 行锁，而这个锁**需要 UPDATE 权限**
--      （普通 SELECT 不需要）：
--          SET ROLE proxy;
--          SELECT 1 FROM policy.policy_decisions WHERE id='x' FOR KEY SHARE;
--          → ERROR: permission denied for table policy_decisions
--   4. 于是每次 ConfirmCooperation 写 policy.order_decisions 的 LC-28 策略盖章都失败
--      （internal/fulfillment/service.go 的 stampFor → Stamp，与生命周期变更同一事务）
--      ⇒ 付费单确认必然回滚。
--   5. 真实错误还被顶掉了一层：事务已 aborted，后面每条语句都报
--      SQLSTATE 25P02，internal/api/command_dispatch.go:216 把这个次生错误返回给调用方。
--
-- 为什么**不能**用 GRANT UPDATE 修（这是关键）：
--   internal/platform/postgres/role_posture.go 启动时会检查「运行角色能不能改只追加审计表」。
--   基线姿态是 1 finding（RUNTIME_OWNS_AUDIT_TABLE）；一旦把 UPDATE 授回去，就会多出
--   RUNTIME_CAN_REWRITE_AUDIT，而 PROXY_ENFORCE_DB_ROLE_SEPARATION=true 时 API 会**拒绝启动**。
--   「运行角色不能对只追加审计表有 UPDATE」是被检查的不变量，不是可以商量的细节。
--
-- 正确修法：外键 → SELECT-only 触发器。
--   policy.policy_decisions 自己也有只追加触发器（policy_decisions_append_only），
--   行**永远删不掉** ⇒ 外键「防止引用行被删」的那半边是多余的；真正还需要保留的只有
--   「插入时被引用的行存在」，而那个用普通 SELECT 就够（proxy 有 SELECT）。
--   错误码沿用 foreign_key_violation，调用方行为不变。
--
-- 验证（2026-09-30，一次性库上实测）：
--   * 合法 decision_id → 盖章成功；
--   * 非法 decision_id → 被拒，foreign_key_violation + 明确文案；
--   * 姿态检查回到基线 1 finding；
--   * lc28 合规 e2e 第 3–5 步转绿（含 CONFIRMED with policyDecisionId=pdec_…）。
--
-- 整个迁移一个事务。
BEGIN;

-- 先确认属主就是运行角色，否则下面的 REVOKE 类操作会静默地做错事（146 同一条教训：
-- 属主漂移时要大声失败，不要静默跳过）。
DO $$
DECLARE
    fk_owner TEXT;
BEGIN
    SELECT pg_get_userbyid(relowner) INTO fk_owner
    FROM pg_class WHERE oid = 'policy.order_decisions'::regclass;
    IF fk_owner IS NULL THEN
        RAISE EXCEPTION 'ORDER-ROLE-001: policy.order_decisions is missing';
    END IF;
END $$;

-- 存在性校验函数。只读 policy.policy_decisions（proxy 有 SELECT），不需要 UPDATE。
CREATE OR REPLACE FUNCTION policy.check_order_decision_ref() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM policy.policy_decisions WHERE id = NEW.decision_id) THEN
        RAISE EXCEPTION 'order_decisions.decision_id % does not exist', NEW.decision_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 用触发器替换外键。外键存在时它需要 FOR KEY SHARE 锁，而运行角色已经没有 UPDATE
-- 权限了；触发器只需 SELECT。
DROP TRIGGER IF EXISTS order_decisions_decision_ref ON policy.order_decisions;
CREATE TRIGGER order_decisions_decision_ref
    BEFORE INSERT OR UPDATE ON policy.order_decisions
    FOR EACH ROW EXECUTE FUNCTION policy.check_order_decision_ref();

ALTER TABLE policy.order_decisions
    DROP CONSTRAINT IF EXISTS order_decisions_decision_id_fkey;

-- 触发器函数必须对运行角色可执行（CREATE FUNCTION 默认给 PUBLIC，这里显式写一遍，
-- 免得将来有人改了默认权限把这条路堵死）。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION policy.check_order_decision_ref() TO proxy';
    END IF;
END $$;

COMMIT;

-- POLICY-STAMP-DURABLE-001（2026-09-28 订单管线审计）：LC-28 策略决策以前在生产
-- 接的是内存仓（cmd/api/main.go），进程一重启「这笔付费订单确认时适用哪版条款」
-- 就没了，订单上的 policy_decision_id 指向不存在的记录。现在由
-- internal/platform/postgres/policy_decisions.go 落库，盖章与订单状态迁移同事务。
--
-- 1) order_decisions 原主键 (order_id, decision_id) 让「同一决策在后续生命周期
--    再盖一次章」（LC-30 条款变更后重新评估、TermsVersion 未变）直接主键冲突。
--    Go 侧的约定一直是「按生命周期追加的审计日志」，主键加上 stamped_lifecycle：
--    同一生命周期重复盖章幂等，不同生命周期各留一行。
-- 2) 两张表都是监管审计记录：只追加，不改不删（触发器兜底，应用代码没有任何
--    UPDATE / DELETE 路径）。
--
-- 整个迁移一个事务：任何一步失败整体回滚，不留半套结构。
BEGIN;

ALTER TABLE policy.order_decisions DROP CONSTRAINT IF EXISTS order_decisions_pkey;
ALTER TABLE policy.order_decisions
    ADD CONSTRAINT order_decisions_pkey PRIMARY KEY (order_id, decision_id, stamped_lifecycle);

CREATE OR REPLACE FUNCTION policy.reject_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'policy audit table %.% is append-only (% rejected)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS policy_decisions_append_only ON policy.policy_decisions;
CREATE TRIGGER policy_decisions_append_only
    BEFORE UPDATE OR DELETE ON policy.policy_decisions
    FOR EACH ROW EXECUTE FUNCTION policy.reject_audit_mutation();
DROP TRIGGER IF EXISTS policy_decisions_no_truncate ON policy.policy_decisions;
CREATE TRIGGER policy_decisions_no_truncate
    BEFORE TRUNCATE ON policy.policy_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION policy.reject_audit_mutation();

DROP TRIGGER IF EXISTS order_decisions_append_only ON policy.order_decisions;
CREATE TRIGGER order_decisions_append_only
    BEFORE UPDATE OR DELETE ON policy.order_decisions
    FOR EACH ROW EXECUTE FUNCTION policy.reject_audit_mutation();
DROP TRIGGER IF EXISTS order_decisions_no_truncate ON policy.order_decisions;
CREATE TRIGGER order_decisions_no_truncate
    BEFORE TRUNCATE ON policy.order_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION policy.reject_audit_mutation();

COMMIT;

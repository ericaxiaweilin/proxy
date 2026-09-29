-- PUBLIC-NO-LOOKUP-001（2026-09-29，用户：「没做的就做」—— 客服按编号查订单的入口）。
--
-- 用户会把订单 / 报名 / 需求 / 邀约 / 活动编号念给客服。全数字编号来自同一个全局
-- 编码规范（21 位：类别码 + 越南本地日期时间 + 当天序号，internal/ordernumber），类别码互不相同、
-- 同类别当天序号唯一，所以一个编号最多指向一个实体。客服入口是
-- 运营命令 LookupPublicNumber（internal/numberlookup，operator 门 + CASE scope）。
--
-- 1) operator.number_lookups：每次查询的审计行（谁、查了哪个号、理由、结论）。只追加：
--    UPDATE / DELETE / TRUNCATE 触发器直接拒绝（和 fulfillment.audit_log 同一套做法）；
--    没有破窗 —— 反查会暴露订单双方账号和条款，查询记录本身不能被改写。
--    应用在命令事务里写它；写不进去 ⇒ 不返回任何数据（fail-closed，见 numberlookup）。
-- 2) 反查用的索引。订单 / 报名编号已有唯一索引（136）；机会编号和活动编号住在 JSONB
--    payload 里，补部分唯一索引。谓词限定「全数字、≥21 位」：
--      * 老活动的 PX-A-yymmdd-####（哈希取模 9000，本来就会撞）不参与，索引不会因为历史
--        重复而建不出来；
--      * 反查 SQL（postgres/activity.go FindActivityByCode、marketplace.go GetByNumber）
--        带着同一个谓词，才能走这两个索引 —— 集成测试用 EXPLAIN 钉住。
--
-- 整个迁移一个事务。
BEGIN;

CREATE TABLE IF NOT EXISTS operator.number_lookups (
    lookup_id      BIGSERIAL   PRIMARY KEY,
    operator_id    TEXT        NOT NULL CHECK (operator_id <> ''),
    principal_id   TEXT        NOT NULL DEFAULT '',
    number         TEXT        NOT NULL,
    reason         TEXT        NOT NULL CHECK (reason <> ''),
    outcome        TEXT        NOT NULL CHECK (outcome IN ('FOUND', 'NOT_FOUND', 'INVALID_NUMBER', 'AMBIGUOUS', 'ERROR')),
    kind           TEXT        NOT NULL DEFAULT '' CHECK (kind IN ('', 'ORDER', 'ACTIVITY_PARTICIPATION', 'OPPORTUNITY', 'ACTIVITY')),
    entity_id      TEXT        NOT NULL DEFAULT '',
    command_id     TEXT        NOT NULL DEFAULT '',
    correlation_id TEXT        NOT NULL DEFAULT '',
    db_user        TEXT        NOT NULL DEFAULT current_user,
    txid           BIGINT      NOT NULL DEFAULT txid_current(),
    looked_up_at   TIMESTAMPTZ NOT NULL,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS operator_number_lookups_operator_idx
    ON operator.number_lookups (operator_id, looked_up_at DESC);
CREATE INDEX IF NOT EXISTS operator_number_lookups_number_idx
    ON operator.number_lookups (number, lookup_id);

CREATE OR REPLACE FUNCTION operator.reject_number_lookup_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'operator.number_lookups is append-only (% rejected)', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS number_lookups_append_only ON operator.number_lookups;
CREATE TRIGGER number_lookups_append_only
    BEFORE UPDATE OR DELETE ON operator.number_lookups
    FOR EACH ROW EXECUTE FUNCTION operator.reject_number_lookup_mutation();
DROP TRIGGER IF EXISTS number_lookups_no_truncate ON operator.number_lookups;
CREATE TRIGGER number_lookups_no_truncate
    BEFORE TRUNCATE ON operator.number_lookups
    FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_number_lookup_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_opportunities_number_key
    ON marketplace.opportunities ((payload->>'number'))
    WHERE payload->>'number' ~ '^[0-9]{21,}$';

CREATE UNIQUE INDEX IF NOT EXISTS activity_code_digits_key
    ON activity.activities ((payload->>'code'))
    WHERE payload->>'code' ~ '^[0-9]{21,}$';

COMMIT;

-- OPS-AUDIT-001（2026-10-04）：运营动作的统一审计行。
--
-- 现状：运营在控制台上的写操作**没有任何审计**。gravity「立即重算」不留痕；接单申请
-- 审核只在 supply.provider_applications 上写 reviewed_by / reviewed_at（125），换个域就
-- 没有了。已有的审计都是各域自己的表 —— operator.number_lookups（145）、
-- fulfillment.audit_log（143）、media.media_review_decisions（032/035/042）—— 没有一处
-- 能回答「这个运营账号过去一小时碰了什么」。运营权限要能拆分（OPS-SCOPE-001/002），
-- 前提是拆出去之后还能追责；否则给了 scope 也只是把无人记录的权力切小。
--
-- 只追加：UPDATE / DELETE / TRUNCATE 触发器直接拒绝（和 number_lookups 同一套做法）。
-- 能被改的审计不叫审计。
--
-- 写不进去怎么办：**不阻断动作本身**，与 number_lookups 的 fail-closed 相反。那边是
-- 「写不进审计就不返回数据」，因为反查会暴露订单双方账号，宁可查不到。这里记的是运营
-- 自己的动作，动作已经发生，回滚它是拿数据一致性去掩盖审计缺口。所以写失败只记 error
-- 日志，并由 /v1/operator/access 报出 auditWriteFailed 计数 —— 缺口要看得见，不是假装没事。
--
-- scope 不做 CHECK 约束：词汇表（12 个域）住在 Go 里并由 operator_scopes_test.go 的
-- completeness 钉双向一致，再在库里钉一份就是两处真相，加一个域要同时改迁移。
BEGIN;

CREATE TABLE IF NOT EXISTS operator.action_log (
    action_id    BIGSERIAL   PRIMARY KEY,
    operator_id  TEXT        NOT NULL CHECK (operator_id <> ''),
    principal_id TEXT        NOT NULL DEFAULT '',
    action       TEXT        NOT NULL CHECK (action <> ''),
    target_kind  TEXT        NOT NULL DEFAULT '',
    target_id    TEXT        NOT NULL DEFAULT '',
    scope        TEXT        NOT NULL DEFAULT '',
    outcome      TEXT        NOT NULL CHECK (outcome IN ('OK', 'DENIED', 'ERROR')),
    detail       JSONB       NOT NULL DEFAULT '{}',
    request_id   TEXT        NOT NULL DEFAULT '',
    db_user      TEXT        NOT NULL DEFAULT current_user,
    acted_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS operator_action_log_operator_idx
    ON operator.action_log (operator_id, acted_at DESC);
CREATE INDEX IF NOT EXISTS operator_action_log_action_idx
    ON operator.action_log (action, acted_at DESC);

CREATE OR REPLACE FUNCTION operator.reject_action_log_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'operator.action_log is append-only (% rejected)', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS action_log_append_only ON operator.action_log;
CREATE TRIGGER action_log_append_only
    BEFORE UPDATE OR DELETE ON operator.action_log
    FOR EACH ROW EXECUTE FUNCTION operator.reject_action_log_mutation();
DROP TRIGGER IF EXISTS action_log_no_truncate ON operator.action_log;
CREATE TRIGGER action_log_no_truncate
    BEFORE TRUNCATE ON operator.action_log
    FOR EACH STATEMENT EXECUTE FUNCTION operator.reject_action_log_mutation();

COMMIT;

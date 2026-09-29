-- ORDER-AUDIT-001 / ORDER-FSM-001（2026-09-28 订单管线审计）：订单与报价的
-- 存储层审计 + 状态机守卫。
--
-- 为什么放在数据库里（而不只是 Go）：
--   * 审计必须覆盖所有写入者 —— 应用代码、跨域物化、运维手工 SQL、未来的新服务。
--     触发器在同一事务里写审计行：业务写入回滚，审计行跟着回滚；业务写入提交，
--     审计行一定在。没有「写了订单却没留痕」的窗口。
--   * 状态机只有一张表。Go 的 fulfillment.orderTransitions 先按业务规则拒绝并给出
--     具体错误码；这里是最后一道闸 —— 任何绕过服务层的写入也过不去。
--
-- fulfillment.audit_log：只追加。每行记录 前后状态 / 前后版本 / 完整前后行（JSONB）
--   / 操作者 / 主体 / 命令类型 / 命令 id / correlation id / 同事务发布的事件类型。
--   操作者等上下文由应用在事务内 set_config('proxy.audit_*', ..., true) 传入
--   （internal/platform/postgres/fulfillment.go setAuditContext）；没传时记空串，
--   另有 db_user / txid 兜底。任意历史版本都能从 row_after 还原（回滚 / 争议依据）。
--
-- 守卫（fulfillment.orders / fulfillment.offers）：
--   * 不删除：业务数据永不由代码删除（AGENTS.md「Data is never deleted by code」）。
--   * 身份列不可变；版本严格 +1；生命周期只按合法迁移表走；CANCELLED 冻结。
--   * amendments 只追加、已裁决的不可改；快照只能随一条 PROPOSED → ACCEPTED 的
--     amendment 一起变（Gate G：不得静默覆盖）。
--   * 结算确认不可撤回、金额不可改；履约结果记录后只有满意度可改。
--   * 破窗：事务内 set_config('proxy.guard_override', '<理由>', true) 可越过守卫
--     （隐私删除、人工更正），理由写进审计行。审计表本身没有破窗。
--
-- 整个迁移一个事务。
BEGIN;

CREATE TABLE IF NOT EXISTS fulfillment.audit_log (
    audit_id        BIGSERIAL PRIMARY KEY,
    table_name      TEXT        NOT NULL,
    row_id          TEXT        NOT NULL,
    operation       TEXT        NOT NULL,
    old_state       TEXT,
    new_state       TEXT,
    old_version     INT,
    new_version     INT,
    actor_id        TEXT        NOT NULL DEFAULT '',
    principal_id    TEXT        NOT NULL DEFAULT '',
    command_type    TEXT        NOT NULL DEFAULT '',
    command_id      TEXT        NOT NULL DEFAULT '',
    correlation_id  TEXT        NOT NULL DEFAULT '',
    event_types     TEXT        NOT NULL DEFAULT '',
    override_reason TEXT        NOT NULL DEFAULT '',
    db_user         TEXT        NOT NULL DEFAULT current_user,
    txid            BIGINT      NOT NULL DEFAULT txid_current(),
    row_before      JSONB,
    row_after       JSONB,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS fulfillment_audit_log_row_idx
    ON fulfillment.audit_log (table_name, row_id, audit_id);
CREATE INDEX IF NOT EXISTS fulfillment_audit_log_actor_idx
    ON fulfillment.audit_log (actor_id, recorded_at DESC) WHERE actor_id <> '';

CREATE OR REPLACE FUNCTION fulfillment.reject_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'fulfillment.audit_log is append-only (% rejected)', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON fulfillment.audit_log;
CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON fulfillment.audit_log
    FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_audit_mutation();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON fulfillment.audit_log;
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON fulfillment.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION fulfillment.reject_audit_mutation();

-- 历史数据里 amendments 可能是 JSON null（旧 Go 代码把 nil slice 编码成 null）。
CREATE OR REPLACE FUNCTION fulfillment.json_array(value JSONB) RETURNS JSONB AS $$
    SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN value ELSE '[]'::jsonb END;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION fulfillment.guard_violation(message TEXT) RETURNS void AS $$
BEGIN
    RAISE EXCEPTION 'fulfillment guard: %', message USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fulfillment.guard_order_write() RETURNS trigger AS $$
DECLARE
    old_amendments JSONB;
    new_amendments JSONB;
    i INT;
    accepted_now BOOLEAN := false;
BEGIN
    IF COALESCE(current_setting('proxy.guard_override', true), '') <> '' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' THEN
        PERFORM fulfillment.guard_violation('orders are never deleted (' || OLD.id || ')');
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.lifecycle NOT IN ('OFFERED', 'CONFIRMED') THEN
            PERFORM fulfillment.guard_violation('new orders start OFFERED or CONFIRMED, got ' || NEW.lifecycle);
        END IF;
        IF NEW.version <> 1 THEN
            PERFORM fulfillment.guard_violation('new orders start at version 1');
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id <> OLD.id OR NEW.requester_id <> OLD.requester_id OR NEW.agent_id <> OLD.agent_id
       OR NEW.need_id <> OLD.need_id OR NEW.created_at <> OLD.created_at
       OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
       OR NEW.offer_id IS DISTINCT FROM OLD.offer_id THEN
        PERFORM fulfillment.guard_violation('identity columns are immutable (' || OLD.id || ')');
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        PERFORM fulfillment.guard_violation(format('version must advance by one (%s -> %s)', OLD.version, NEW.version));
    END IF;
    IF OLD.lifecycle = 'CANCELLED' THEN
        PERFORM fulfillment.guard_violation('CANCELLED orders are frozen (' || OLD.id || ')');
    END IF;
    IF NEW.lifecycle <> OLD.lifecycle AND (OLD.lifecycle, NEW.lifecycle) NOT IN (
        ('OFFERED', 'CONFIRMED'), ('OFFERED', 'CANCELLED'),
        ('CONFIRMED', 'EXECUTING'), ('CONFIRMED', 'CANCELLED'),
        ('EXECUTING', 'COMPLETED'), ('EXECUTING', 'CANCELLED')) THEN
        PERFORM fulfillment.guard_violation(OLD.lifecycle || ' -> ' || NEW.lifecycle);
    END IF;

    old_amendments := fulfillment.json_array(OLD.amendments);
    new_amendments := fulfillment.json_array(NEW.amendments);
    IF jsonb_array_length(new_amendments) < jsonb_array_length(old_amendments) THEN
        PERFORM fulfillment.guard_violation('amendments are append-only');
    END IF;
    FOR i IN 0 .. jsonb_array_length(old_amendments) - 1 LOOP
        IF new_amendments->i->>'amendmentId' IS DISTINCT FROM old_amendments->i->>'amendmentId' THEN
            PERFORM fulfillment.guard_violation('amendments are append-only');
        END IF;
        IF COALESCE(old_amendments->i->>'status', '') <> 'PROPOSED' THEN
            IF new_amendments->i IS DISTINCT FROM old_amendments->i THEN
                PERFORM fulfillment.guard_violation('decided amendments are immutable');
            END IF;
        ELSIF new_amendments->i->>'status' = 'ACCEPTED' AND new_amendments->i->'snapshot' = NEW.snapshot THEN
            accepted_now := true;
        END IF;
    END LOOP;
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot AND NOT accepted_now THEN
        PERFORM fulfillment.guard_violation('snapshot changes only through an accepted amendment');
    END IF;

    IF OLD.settlement IS NOT NULL AND jsonb_typeof(OLD.settlement) = 'object' THEN
        IF NEW.settlement IS NULL
           OR NEW.settlement->'agreedAmount' IS DISTINCT FROM OLD.settlement->'agreedAmount'
           OR (COALESCE((OLD.settlement->>'payerConfirmed')::boolean, false) AND NOT COALESCE((NEW.settlement->>'payerConfirmed')::boolean, false))
           OR (COALESCE((OLD.settlement->>'payeeConfirmed')::boolean, false) AND NOT COALESCE((NEW.settlement->>'payeeConfirmed')::boolean, false)) THEN
            PERFORM fulfillment.guard_violation('settlement confirmations cannot be withdrawn or re-priced');
        END IF;
    END IF;
    IF OLD.outcome IS NOT NULL AND jsonb_typeof(OLD.outcome) = 'object' THEN
        IF NEW.outcome IS NULL OR (NEW.outcome - 'satisfaction') IS DISTINCT FROM (OLD.outcome - 'satisfaction') THEN
            PERFORM fulfillment.guard_violation('recorded outcome facts are immutable');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fulfillment.guard_offer_write() RETURNS trigger AS $$
BEGIN
    IF COALESCE(current_setting('proxy.guard_override', true), '') <> '' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' THEN
        PERFORM fulfillment.guard_violation('offers are never deleted (' || OLD.id || ')');
    END IF;
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;
    IF NEW.id <> OLD.id OR NEW.requester_id <> OLD.requester_id OR NEW.agent_id <> OLD.agent_id
       OR NEW.task_id <> OLD.task_id OR NEW.slot_id <> OLD.slot_id OR NEW.created_at <> OLD.created_at
       OR NEW.agreed_compensation <> OLD.agreed_compensation OR NEW.currency <> OLD.currency
       OR NEW.topic_key <> OLD.topic_key OR NEW.note <> OLD.note OR NEW.expires_at <> OLD.expires_at THEN
        PERFORM fulfillment.guard_violation('offer terms are immutable (' || OLD.id || ')');
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        PERFORM fulfillment.guard_violation(format('offer version must advance by one (%s -> %s)', OLD.version, NEW.version));
    END IF;
    IF NEW.status <> OLD.status AND (OLD.status <> 'OFFERED' OR NEW.status NOT IN ('ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')) THEN
        PERFORM fulfillment.guard_violation('offer ' || OLD.status || ' -> ' || NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fulfillment.audit_row_write() RETURNS trigger AS $$
DECLARE
    state_column TEXT := CASE WHEN TG_TABLE_NAME = 'orders' THEN 'lifecycle' ELSE 'status' END;
    before_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    after_row  JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
    INSERT INTO fulfillment.audit_log (
        table_name, row_id, operation, old_state, new_state, old_version, new_version,
        actor_id, principal_id, command_type, command_id, correlation_id, event_types,
        override_reason, row_before, row_after)
    VALUES (
        TG_TABLE_NAME, COALESCE(after_row->>'id', before_row->>'id'), TG_OP,
        before_row->>state_column, after_row->>state_column,
        (before_row->>'version')::int, (after_row->>'version')::int,
        COALESCE(current_setting('proxy.audit_actor', true), ''),
        COALESCE(current_setting('proxy.audit_principal', true), ''),
        COALESCE(current_setting('proxy.audit_command_type', true), ''),
        COALESCE(current_setting('proxy.audit_command_id', true), ''),
        COALESCE(current_setting('proxy.audit_correlation_id', true), ''),
        COALESCE(current_setting('proxy.audit_events', true), ''),
        COALESCE(current_setting('proxy.guard_override', true), ''),
        before_row, after_row);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_guard ON fulfillment.orders;
CREATE TRIGGER orders_guard
    BEFORE INSERT OR UPDATE OR DELETE ON fulfillment.orders
    FOR EACH ROW EXECUTE FUNCTION fulfillment.guard_order_write();
DROP TRIGGER IF EXISTS orders_audit ON fulfillment.orders;
CREATE TRIGGER orders_audit
    AFTER INSERT OR UPDATE OR DELETE ON fulfillment.orders
    FOR EACH ROW EXECUTE FUNCTION fulfillment.audit_row_write();

DROP TRIGGER IF EXISTS offers_guard ON fulfillment.offers;
CREATE TRIGGER offers_guard
    BEFORE INSERT OR UPDATE OR DELETE ON fulfillment.offers
    FOR EACH ROW EXECUTE FUNCTION fulfillment.guard_offer_write();
DROP TRIGGER IF EXISTS offers_audit ON fulfillment.offers;
CREATE TRIGGER offers_audit
    AFTER INSERT OR UPDATE OR DELETE ON fulfillment.offers
    FOR EACH ROW EXECUTE FUNCTION fulfillment.audit_row_write();

-- 生命周期取值约束（offers.status 早就有，orders 一直没有）。NOT VALID：只约束
-- 新写入 / 更新的行，不扫描、不改历史数据；历史行若有非法值由守卫在下次更新时拦下。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_lifecycle_check' AND conrelid = 'fulfillment.orders'::regclass
    ) THEN
        ALTER TABLE fulfillment.orders
            ADD CONSTRAINT orders_lifecycle_check
            CHECK (lifecycle IN ('OFFERED', 'CONFIRMED', 'EXECUTING', 'COMPLETED', 'CANCELLED')) NOT VALID;
    END IF;
END $$;

COMMIT;

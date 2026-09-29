-- ORDER-ROLE-001（2026-09-29，用户：「没做的就做」—— 数据库角色分离）。
--
-- 到这一步订单管线的审计与守卫都是触发器：应用代码绕不过去，但任何一个会话都能自己
-- set_config('proxy.guard_override', '随便写点理由', true) 越过守卫；审计表的只追加也
-- 只靠触发器。本迁移把「谁有资格破窗」和「审计表连属主也不能改」落到数据库角色上：
--
-- 1) 破窗只认角色：proxy.guard_override 只有 proxy_breakglass 的成员（含超级用户）才生效。
--    别的角色设了这个开关再写订单 —— **直接报错**（不是静默忽略：静默忽略会让越权尝试
--    看起来像一次普通写入）。应用的运行角色不是成员，所以即使应用代码被攻破、或谁在
--    SQL 注入里塞了一句 set_config，也越不过守卫。运维人工更正 = 个人登录角色加入
--    proxy_breakglass，事务内设理由，理由与 db_user 一起进审计行（ORDER-AUDIT-001）。
--    只有开关非空时才查角色，所以正常写入不受影响；角色缺失时只有超级用户能破窗（fail-closed）。
-- 2) 审计表撤销 UPDATE / DELETE / TRUNCATE：fulfillment.audit_log、policy.policy_decisions、
--    policy.order_decisions、operator.number_lookups 对 PUBLIC 和运行角色（含属主自己，
--    属主的普通权限是可以撤销的）撤销改删权限。触发器之外多一层：想改审计行，先得有人
--    显式 GRANT，那是一条能被数据库日志看到的 DDL，而不是一条悄悄放行的 UPDATE。
--    fulfillment.harden_append_only(regclass) 是同一段逻辑的可复用形式（测试对一张临时
--    表和一个非超级用户属主实测过）。超级用户不受任何权限约束 —— 所以生产运行角色
--    不能是超级用户，见启动姿态检查（postgres/role_posture.go）。
--
-- 局限（如实写在这里，不假装）：本仓库的库是「属主即运行角色」（迁移与应用同一个角色，
-- 112 的注释同）。属主永远能 DROP TRIGGER / 重新 GRANT，所以「审计表不可伪造」要靠把
-- 迁移角色和运行角色拆开才彻底；姿态检查会把「运行角色是属主」明确报出来。拆分的做法
-- 见 PRODUCTION.md「Database roles」。
--
-- 整个迁移一个事务。
BEGIN;

-- 启动时自动迁移由运行角色执行；它没有 CREATEROLE 时建角色会失败。那不能把整个服务
-- 拦在启动之外 —— 降级为通知：角色缺失时只有超级用户能破窗（fail-closed），DBA 补建
-- 角色后成员才能用。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_breakglass') THEN
        BEGIN
            CREATE ROLE proxy_breakglass NOLOGIN;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'ORDER-ROLE-001: cannot create role proxy_breakglass (insufficient privilege); a DBA must create it. Until then only superusers can use the guard override.';
        END;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_breakglass') THEN
        BEGIN
            COMMENT ON ROLE proxy_breakglass IS
                'ORDER-ROLE-001: members (and superusers) may bypass the fulfillment order/offer guards by setting proxy.guard_override in a transaction. Never grant this to the application runtime role.';
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'ORDER-ROLE-001: cannot comment on role proxy_breakglass (not its administrator)';
        END;
    END IF;
END $$;

-- 返回本事务里「生效的」破窗理由；开关没设 = ''。设了但调用者不是 proxy_breakglass 的
-- 成员 = 报错（不是忽略）。
CREATE OR REPLACE FUNCTION fulfillment.guard_override_reason() RETURNS TEXT AS $$
DECLARE
    reason TEXT := COALESCE(current_setting('proxy.guard_override', true), '');
BEGIN
    IF reason = '' THEN
        RETURN '';
    END IF;
    IF (SELECT COALESCE(rolsuper, false) FROM pg_roles WHERE rolname = current_user) THEN
        RETURN reason;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_breakglass')
       AND pg_has_role(current_user, 'proxy_breakglass', 'MEMBER') THEN
        RETURN reason;
    END IF;
    RAISE EXCEPTION 'guard override requires membership in role proxy_breakglass (% is not a member)', current_user
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql STABLE;

-- 下面四个函数与 135 / 136 里的定义逐字相同，只把「读 GUC」换成 guard_override_reason()。
CREATE OR REPLACE FUNCTION fulfillment.guard_order_write() RETURNS trigger AS $$
DECLARE
    old_amendments JSONB;
    new_amendments JSONB;
    i INT;
    accepted_now BOOLEAN := false;
BEGIN
    IF fulfillment.guard_override_reason() <> '' THEN
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
    IF fulfillment.guard_override_reason() <> '' THEN
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

CREATE OR REPLACE FUNCTION fulfillment.guard_order_no() RETURNS trigger AS $$
BEGIN
    IF fulfillment.guard_override_reason() <> '' THEN
        RETURN NEW;
    END IF;
    IF OLD.order_no IS NOT NULL AND NEW.order_no IS DISTINCT FROM OLD.order_no THEN
        PERFORM fulfillment.guard_violation('order_no is immutable (' || OLD.id || ')');
    END IF;
    IF NEW.order_no IS NOT NULL AND NEW.order_no !~ '^[0-9]{21,}$' THEN
        PERFORM fulfillment.guard_violation('order_no must be all digits (' || NEW.id || ')');
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
        fulfillment.guard_override_reason(),
        before_row, after_row);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 只追加表的权限硬化：对 PUBLIC、属主、约定的运行角色 proxy 撤销 UPDATE / DELETE / TRUNCATE。
-- 属主漂移（执行者不是属主）时 REVOKE 会大声失败，不静默跳过（112 同一条教训）。
CREATE OR REPLACE FUNCTION fulfillment.harden_append_only(target regclass) RETURNS void AS $$
DECLARE
    owner_name TEXT;
BEGIN
    SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid = target;
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM PUBLIC', target);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM %I', target, owner_name);
    IF owner_name <> 'proxy' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy') THEN
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM proxy', target);
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT fulfillment.harden_append_only('fulfillment.audit_log');
SELECT fulfillment.harden_append_only('policy.policy_decisions');
SELECT fulfillment.harden_append_only('policy.order_decisions');
SELECT fulfillment.harden_append_only('operator.number_lookups');

COMMIT;

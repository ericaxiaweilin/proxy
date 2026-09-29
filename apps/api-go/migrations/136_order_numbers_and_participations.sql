-- ORDER-NO-001 / ACT-PARTICIPATION-DURABLE-001（2026-09-29，用户：「for you 的新订单
-- 编号没有用上……编号更新全数字」）。
--
-- 1) 全数字订单编号：16 位 = yyMMdd（越南时间）+ 9 位全局序号 + 1 位 Luhn 校验位。
--    唯一性只靠 fulfillment.order_number_seq（全局、永不重置，履约订单与活动报名
--    共用）。Go 侧 internal/ordernumber.Format 与这里的 fulfillment.format_order_no
--    必须逐字一致（集成测试 TestOrderNumberSQLMatchesGo 钉住）。
--    以前 For You「已下单」页显示的是**活动**的展示码 PX-A-yymmdd-####：同一场活动
--    的所有报名人看到同一个号，而且是哈希取模 9000，同一天不同活动会撞号 ——
--    那不是订单编号。
-- 2) 活动报名（activity.participants）落状态与订单编号。以前报名状态只在进程内存里
--    （ParticipationStore）：重启后取消 / 签到全部报「没报名」；取消也不释放名额
--    （joined_count 不减、参与行还在，本人也无法再报）。
-- 3) 已有数据回填编号：走守卫的破窗通道，理由写进审计行（ORDER-AUDIT-001）；
--    订单版本号不动（回填不是业务状态变化）。
--
-- 整个迁移一个事务。
BEGIN;

CREATE SEQUENCE IF NOT EXISTS fulfillment.order_number_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE OR REPLACE FUNCTION fulfillment.luhn_check_digit(body TEXT) RETURNS INT AS $$
DECLARE
    total INT := 0;
    digit INT;
    double_it BOOLEAN := true;
    i INT;
BEGIN
    FOR i IN REVERSE length(body) .. 1 LOOP
        digit := substr(body, i, 1)::INT;
        IF double_it THEN
            digit := digit * 2;
            IF digit > 9 THEN
                digit := digit - 9;
            END IF;
        END IF;
        total := total + digit;
        double_it := NOT double_it;
    END LOOP;
    RETURN (10 - total % 10) % 10;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 序号超过 9 位时加宽，不截断（lpad 会截断，所以分支处理）。
CREATE OR REPLACE FUNCTION fulfillment.format_order_no(sequence BIGINT, at TIMESTAMPTZ) RETURNS TEXT AS $$
    SELECT body || fulfillment.luhn_check_digit(body)::TEXT
    FROM (
        SELECT to_char(at AT TIME ZONE 'UTC' + INTERVAL '7 hours', 'YYMMDD')
            || CASE WHEN length(sequence::TEXT) >= 9 THEN sequence::TEXT ELSE lpad(sequence::TEXT, 9, '0') END AS body
    ) formatted;
$$ LANGUAGE SQL IMMUTABLE;

-- 履约订单
ALTER TABLE fulfillment.orders ADD COLUMN IF NOT EXISTS order_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_orders_order_no_key
    ON fulfillment.orders (order_no) WHERE order_no IS NOT NULL;

-- 编号一经分配不可改（破窗除外，且会进审计）。
CREATE OR REPLACE FUNCTION fulfillment.guard_order_no() RETURNS trigger AS $$
BEGIN
    IF COALESCE(current_setting('proxy.guard_override', true), '') <> '' THEN
        RETURN NEW;
    END IF;
    IF OLD.order_no IS NOT NULL AND NEW.order_no IS DISTINCT FROM OLD.order_no THEN
        PERFORM fulfillment.guard_violation('order_no is immutable (' || OLD.id || ')');
    END IF;
    IF NEW.order_no IS NOT NULL AND NEW.order_no !~ '^[0-9]{16,}$' THEN
        PERFORM fulfillment.guard_violation('order_no must be all digits (' || NEW.id || ')');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_order_no_guard ON fulfillment.orders;
CREATE TRIGGER orders_order_no_guard
    BEFORE INSERT OR UPDATE ON fulfillment.orders
    FOR EACH ROW EXECUTE FUNCTION fulfillment.guard_order_no();

-- 活动报名：状态 + 编号持久化。
ALTER TABLE activity.participants
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'CONFIRMED',
    ADD COLUMN IF NOT EXISTS order_no TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'participants_state_check' AND conrelid = 'activity.participants'::regclass
    ) THEN
        ALTER TABLE activity.participants
            ADD CONSTRAINT participants_state_check
            CHECK (state IN ('REQUESTED', 'CONFIRMED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW'));
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS activity_participants_order_no_key
    ON activity.participants (order_no) WHERE order_no IS NOT NULL;

-- 回填：先订单、后报名，按创建时间取号（仅为可读，唯一性不依赖顺序）。
SELECT set_config('proxy.guard_override', 'migration 136: backfill order_no', true);
SELECT set_config('proxy.audit_actor', 'migration:136', true);
UPDATE fulfillment.orders o
SET order_no = fulfillment.format_order_no(nextval('fulfillment.order_number_seq'), o.created_at)
FROM (SELECT id FROM fulfillment.orders WHERE order_no IS NULL ORDER BY created_at, id) pending
WHERE o.id = pending.id;
UPDATE activity.participants p
SET order_no = fulfillment.format_order_no(nextval('fulfillment.order_number_seq'), p.joined_at)
FROM (SELECT activity_id, actor_id FROM activity.participants WHERE order_no IS NULL ORDER BY joined_at) pending
WHERE p.activity_id = pending.activity_id AND p.actor_id = pending.actor_id;
SELECT set_config('proxy.guard_override', '', true);
SELECT set_config('proxy.audit_actor', '', true);

COMMIT;

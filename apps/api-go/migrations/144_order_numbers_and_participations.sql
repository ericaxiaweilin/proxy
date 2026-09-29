-- ORDER-NO-001 / ACT-PARTICIPATION-DURABLE-001（2026-09-29，用户：「for you 的新订单
-- 编号没有用上……编号更新全数字」；订单编号口径定为 21 位：类别码 3 位 + 越南本地
-- YYMMDD + HHMMSS + 当天序号 6 位，见 internal/ordernumber）。
--
-- 1) 履约订单（fulfillment.orders）加 order_no：类别码 200，计数器用 137 建的
--    ordering.daily_sequences（每个「类别 × 越南本地日期」一行）。编号一经分配不可改
--    （守卫触发器；破窗仍走 proxy.guard_override，理由进审计行）。
-- 2) 活动报名（activity.participants）落状态：REQUESTED / CONFIRMED / WAITLISTED /
--    CANCELLED / ATTENDED / NO_SHOW。以前报名状态只在进程内存里：重启后取消 / 签到全部
--    报「没报名」；取消也不释放名额（joined_count 不减、参与行还在，本人也无法再报）。
--    order_no 列与唯一索引 ux_participants_order_no 是 137 建的，这里不重复。
-- 3) 存量履约订单补号：走守卫的破窗通道，理由写进审计行（ORDER-AUDIT-001）；订单版本号
--    不动（补号不是业务状态变化）。按越南本地创建日期分天、按创建时间排序号，接在该类别
--    该日计数器已有的最大序号后面。
--
-- 整个迁移一个事务。
BEGIN;

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
    IF NEW.order_no IS NOT NULL AND NEW.order_no !~ '^[0-9]{21,}$' THEN
        PERFORM fulfillment.guard_violation('order_no must be all digits, 21 or more (' || NEW.id || ')');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_order_no_guard ON fulfillment.orders;
CREATE TRIGGER orders_order_no_guard
    BEFORE INSERT OR UPDATE ON fulfillment.orders
    FOR EACH ROW EXECUTE FUNCTION fulfillment.guard_order_no();

-- 活动报名：状态 + 更新时间持久化。
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

-- 存量履约订单补号。
SELECT set_config('proxy.guard_override', 'migration 144: backfill order_no', true);
SELECT set_config('proxy.audit_actor', 'migration:144', true);
WITH numbered AS (
    SELECT o.id,
           (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS local_ts,
           row_number() OVER (PARTITION BY (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY o.created_at, o.id)
             + COALESCE((SELECT s.last_seq FROM ordering.daily_sequences s
                         WHERE s.category = '200' AND s.day = (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), 0) AS n
    FROM fulfillment.orders o
    WHERE o.order_no IS NULL
)
UPDATE fulfillment.orders o
SET order_no = '200' || to_char(numbered.local_ts, 'YYMMDDHH24MISS')
               || CASE WHEN numbered.n < 1000000 THEN lpad(numbered.n::text, 6, '0') ELSE numbered.n::text END
FROM numbered
WHERE o.id = numbered.id;
SELECT set_config('proxy.guard_override', '', true);
SELECT set_config('proxy.audit_actor', '', true);

-- 计数器接上补号之后的位置，新单从下一个号继续。
INSERT INTO ordering.daily_sequences (category, day, last_seq)
SELECT '200', to_date(substr(order_no, 4, 6), 'YYMMDD'), max(substr(order_no, 16)::int)
FROM fulfillment.orders
WHERE order_no ~ '^200[0-9]{18,}$'
GROUP BY 2
ON CONFLICT (category, day) DO UPDATE SET last_seq = GREATEST(ordering.daily_sequences.last_seq, EXCLUDED.last_seq);

COMMIT;

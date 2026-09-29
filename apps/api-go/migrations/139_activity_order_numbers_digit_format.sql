-- ORDER-NO-001 修正：137 给存量报名补号时用的是规范定稿前的草案格式
-- （ACT-YYMMDD-####，计数器键 'ACT'）。规范已定为纯数字
-- {场地类别编码3位}{YYMMDD}{HHMMSS}{序号6位}（见 internal/ordernumber）。
-- 137 已经在库里跑过，改它会触发 drift 校验，所以另起这条：把 ACT- 开头的旧号
-- 按新规则重编。新序号接在同类别同日已发出的号后面，不和现有号撞。

WITH old AS (
    SELECT p.activity_id, p.actor_id,
           CASE a.payload->>'venueType'
               WHEN 'CAFE' THEN '100'
               WHEN 'RESTAURANT' THEN '101'
               WHEN 'PARK' THEN '102'
               WHEN 'LAKE' THEN '103'
               WHEN 'STREET' THEN '104'
               ELSE '109'
           END AS cat,
           (p.joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS local_ts
    FROM activity.participants p
    JOIN activity.activities a ON a.id = p.activity_id
    WHERE p.order_no IS NULL OR p.order_no LIKE 'ACT-%'
),
ranked AS (
    SELECT old.*,
           row_number() OVER (PARTITION BY old.cat, old.local_ts::date ORDER BY old.local_ts, old.activity_id, old.actor_id)
             + COALESCE((SELECT s.last_seq FROM ordering.daily_sequences s WHERE s.category = old.cat AND s.day = old.local_ts::date), 0) AS n
    FROM old
)
UPDATE activity.participants p
SET order_no = ranked.cat || to_char(ranked.local_ts, 'YYMMDDHH24MISS')
               || CASE WHEN ranked.n < 1000000 THEN lpad(ranked.n::text, 6, '0') ELSE ranked.n::text END
FROM ranked
WHERE p.activity_id = ranked.activity_id AND p.actor_id = ranked.actor_id;

-- 草案格式的计数器作废；新计数器按重编后的实际最大序号对齐。
DELETE FROM ordering.daily_sequences WHERE category = 'ACT';

INSERT INTO ordering.daily_sequences (category, day, last_seq)
SELECT left(order_no, 3),
       to_date(substr(order_no, 4, 6), 'YYMMDD'),
       max(substr(order_no, 16)::int)
FROM activity.participants
WHERE order_no ~ '^[0-9]{21,}$'
GROUP BY 1, 2
ON CONFLICT (category, day) DO UPDATE SET last_seq = GREATEST(ordering.daily_sequences.last_seq, EXCLUDED.last_seq);

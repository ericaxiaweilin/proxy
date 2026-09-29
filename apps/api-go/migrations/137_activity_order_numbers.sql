-- ORDER-NO-001：订单编号规范 {类别}-{YYMMDD}-{序号}（见 internal/ordernumber）。
-- 活动报名（activity.participants 一行 = 一单）以前没有自己的编号，成功页只能
-- 拿活动本身的 code 顶——同一场活动所有人拿到的是同一个号，不是订单号。

CREATE SCHEMA IF NOT EXISTS ordering;

-- 每个类别每天一个计数器，报名事务里 INSERT ... ON CONFLICT ... RETURNING 原子取号。
CREATE TABLE IF NOT EXISTS ordering.daily_sequences (
    category TEXT NOT NULL,
    day DATE NOT NULL,
    last_seq INTEGER NOT NULL,
    PRIMARY KEY (category, day)
);

ALTER TABLE activity.participants ADD COLUMN IF NOT EXISTS order_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_participants_order_no ON activity.participants (order_no) WHERE order_no IS NOT NULL;

-- 存量报名补号：按越南本地日期分天、按报名时间先后排序号，跟新单同一规则。
WITH numbered AS (
    SELECT activity_id, actor_id,
           (joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
           row_number() OVER (PARTITION BY (joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY joined_at, activity_id, actor_id) AS n
    FROM activity.participants
    WHERE order_no IS NULL
)
UPDATE activity.participants p
SET order_no = 'ACT-' || to_char(numbered.d, 'YYMMDD') || '-' || CASE WHEN numbered.n < 10000 THEN lpad(numbered.n::text, 4, '0') ELSE numbered.n::text END
FROM numbered
WHERE p.activity_id = numbered.activity_id AND p.actor_id = numbered.actor_id;

-- 计数器接上补号之后的位置，新单从下一个号继续。
INSERT INTO ordering.daily_sequences (category, day, last_seq)
SELECT 'ACT', (joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, count(*)
FROM activity.participants
GROUP BY 2
ON CONFLICT (category, day) DO UPDATE SET last_seq = GREATEST(ordering.daily_sequences.last_seq, EXCLUDED.last_seq);

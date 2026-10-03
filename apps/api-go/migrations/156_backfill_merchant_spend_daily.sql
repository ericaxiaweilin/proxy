-- MERCHANT-OUTCOME-PROJECTION-001（backfill）：投影桥（报名/取消 → spend_daily）
-- 从接线那一刻才开始数，之前已经发生的报名从来没被投过 ⇒ 老商家的经营结果
-- 依然是 0。这里从事实表（activity.participants）一次性推导补投。
--
-- 幂等 = insert-if-absent：ON CONFLICT DO NOTHING。已存在的桶（人工
-- UpsertSpendDaily 录的、或投影桥已经逐笔记过的）一律不覆盖、不重算 ——
-- 桥的净效果（join +1 / cancel −1，桶 = joined_at 日）与这里的推导口径一致，
-- 所以跳过已有桶不会造成同一桶两种真相。
--
-- 归因与投影桥完全同规则：活动挂的现实场景 → 认领该场景的门店（同场景多店
-- 认领时取 id 最小的那家，与 ProjectActivityOrder 的 ORDER BY id LIMIT 1 对齐）
-- → 门店所属商家。没被认领的场景与任何商家无关。
--
-- 新客/复访：同一商家下按 joined_at 排序，某人第一条未取消报名 = 新客，
-- 之后每条 = 复访（与桥的"同场景还有别的未取消报名 ⇒ 复访"等价）。
-- gross_minor 恒 0：支付未接，成交金额没有事实来源，不编数。
INSERT INTO business.spend_daily AS sd
    (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
SELECT f.business_id, f.bucket_date, count(*), 0,
       count(*) FILTER (WHERE f.nth = 1),
       count(*) FILTER (WHERE f.nth > 1)
FROM (
    SELECT st.business_id,
           p.joined_at::date AS bucket_date,
           row_number() OVER (PARTITION BY st.business_id, p.actor_id
                              ORDER BY p.joined_at, p.activity_id) AS nth
    FROM activity.participants p
    JOIN activity.activities a ON a.id = p.activity_id
    JOIN LATERAL (
        SELECT s.business_id
        FROM business.stores s
        WHERE s.reality_scene_id = COALESCE(a.payload->>'realitySceneId', '')
        ORDER BY s.id
        LIMIT 1
    ) st ON true
    WHERE p.state <> 'CANCELLED'
      AND COALESCE(a.payload->>'realitySceneId', '') <> ''
) f
GROUP BY f.business_id, f.bucket_date
ON CONFLICT (business_id, bucket_date) DO NOTHING;

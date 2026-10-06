-- STORE-ATTRIBUTION-P1（2026-10-06）：报名（一行 = 一单）记下它属于哪家门店。
--
-- 为什么需要这一列（docs/audits/2026-10-06-store-attribution.md §1.3 / §4.2）：
-- 承载预约量最大的用户流是 For You 活动报名，它落 activity.participants，**不落**
-- fulfillment.orders —— 而所有按店数单的读模型只认 fulfillment.orders.store_id
-- （129 那列至今恒为 '' 哨兵，见 audit §3.4）。于是这张表里的单永远回答不了
-- 「这是哪家的生意」。商家经营结果唯一的真实来源是报名那一刻在旁路投影出来的
-- business.spend_daily（ProjectActivityOrder），投影完就把场景丢了：事后想按店
-- 统计只能回头 join activities.payload->>'realitySceneId' 再猜一次门店，那是推断，
-- 不是当时发生的事实。
--
-- 口径：**不发明第二套规则**，与 ProjectActivityOrder
-- （internal/platform/postgres/business.go）与回填迁移 156 完全同源 ——
--   活动挂的现实场景（activities.payload->>'realitySceneId'）
--     → 认领该场景的门店（business.stores.reality_scene_id，店主自己认领，不猜）
--     → 同场景多家认领时取 id 最小的那个（ORDER BY id LIMIT 1）
--
-- NULL 的含义只有一种：「这单的场景没有被任何门店认领」（活动没有场景也是同一个
-- 结果）。它不是「忘了填」。事后按金额档 / 活动文案 / 店名相似度补一个 store_id
-- 是编数据 —— 158_store_product_hot.sql:5-8 已经因为同类理由（用店级销量推单品）
-- 拒绝过一次。所以：**宁可不归因，也不猜。**
--
-- **不回填老行。** 老行所在的活动 payload 里有没有 realitySceneId、门店有没有在
-- 那一时刻之前认领场景，事后无从查证，硬填就是造事实（audit §5「明确不做的事」）。
-- 老单 store_id 恒为 NULL，按店统计时它们不进任何店 —— 与 fulfillment.orders.
-- store_id 的 '' 哨兵同一种诚实，只是这里用 NULL 而不是 ''，好让部分索引和
-- `IS NOT NULL` 直接就是「有归因」的定义（129 的 orders 索引就是这么做的）。

ALTER TABLE activity.participants ADD COLUMN IF NOT EXISTS store_id TEXT;

-- 按店数这家的单 / 门店调度按店查容量：只索引有归因的行。
CREATE INDEX IF NOT EXISTS idx_participants_store
    ON activity.participants (store_id) WHERE store_id IS NOT NULL;

COMMENT ON COLUMN activity.participants.store_id IS
  'STORE-ATTRIBUTION-P1: 报名单归属的门店 id，按 activities.payload->>''realitySceneId'' → business.stores.reality_scene_id ORDER BY id LIMIT 1 解析（与 ProjectActivityOrder / 156 回填同规则）。NULL = 场景无人认领，不猜、不回填。';
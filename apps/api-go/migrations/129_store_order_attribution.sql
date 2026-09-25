-- STORE-STATS-001（2026-09-25，用户：「先补后端再做页」）：店铺经营数据地基。
-- 订单↔店铺：fulfillment.orders 加 store_id。归因是人类断言 —— 履约完成
-- （RecordOutcome）时由订单当事一方指认服务发生在哪家店（须是 ACTIVE 店，
-- 否则驳回）。老订单 store_id 为空，不回填（没人能诚实补上）。
-- 店铺品类 + 对接人姓名补列（展示/筛选.entry 用；空 = 没填，不显示）。
ALTER TABLE fulfillment.orders
    ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS fulfillment_orders_store_id_idx
    ON fulfillment.orders (store_id) WHERE store_id <> '';
ALTER TABLE business.stores
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
ALTER TABLE business.store_lines
    ADD COLUMN IF NOT EXISTS contact_name TEXT NOT NULL DEFAULT '';

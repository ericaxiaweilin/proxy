-- 158_store_product_hot.sql
-- MENU-HOT-001（2026-10-03，用户给原型 deepseek_html_20261003_59d0d3
-- 「给商家菜单 某些打hot标」）
--
-- 哪个菜是 HOT 由**商家亲手标**，不是算出来的：订单只记到店（business.spend_daily
-- 按天按店汇总），fulfillment.orders 根本不记单品 —— 全仓没有任何"某道菜卖了
-- 多少"的数据。用店级销量给单品颁 HOT 等于编造归因。
-- 所以这里只加一个商家可开可关的标记位，默认 false（不上架即 HOT）。
ALTER TABLE business.store_products
  ADD COLUMN IF NOT EXISTS is_hot BOOLEAN NOT NULL DEFAULT false;

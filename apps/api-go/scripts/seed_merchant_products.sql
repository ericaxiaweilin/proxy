-- seed_merchant_products.sql
-- MERCHANT-PRODUCT-SEED-001（2026-10-02，用户「继续做商家的数据」）
--
-- devseed 6 家店的菜单。之前 products=0 —— 商家页"招牌与在售"、店详情"菜品"
-- 两块都是空的（刚接好的 SKU 展示无米下锅）。
--
-- 单位：price_minor 是**毫越南盾**（客户端 formatVnd 先除 1000）。
-- 一杯 45.000₫ 的咖啡记 45000000，不是 45000。
-- ⚠️ biz_demo_threebeans 那 6 道老菜（2026-09-07 手工插入）写的是 45000 这种
-- VND 直写，按同一口径会显示成"45 VND" —— 错 1000 倍。下面用 UPDATE 一并纠正
-- （只动数值不动其它列；新库没有这几行就不生效）。
--
-- 菜品不带图：media_asset_id 留空。仓里只有人像和店面照，拿店面照冒充菜品图
-- 是编造 —— UI 侧有首字母占位（skuThumbEmpty），空着是诚实的。
-- 每家店菜单各写各的，不复制粘贴（6 家长得一样会被当成假数据）。
-- 幂等：id 确定性主键 + ON CONFLICT DO NOTHING。

BEGIN;

-- 老菜单位纠正（毫越南盾）。只改错了单位的数值。
UPDATE business.store_products SET price_minor = price_minor * 1000, updated_at = now()
 WHERE business_id = 'biz_demo_threebeans' AND price_minor < 1000000;

-- 01 Cộng Cà Phê（椰子咖啡招牌）。
INSERT INTO business.store_products
  (id, store_id, business_id, name, description, price_minor, currency, category, available, sort_order, created_at, updated_at)
VALUES
  ('prod_devseed_01_01', 'store_devseed_01', 'biz_devseed_01', 'Cà Phê Cốt Dừa', '招牌椰子咖啡 · 现打椰肉', 55000000, 'VND', 'Cà phê đặc biệt', true, 1, now(), now()),
  ('prod_devseed_01_02', 'store_devseed_01', 'biz_devseed_01', 'Bạc Xỉu Đá', '多奶少咖 · 冰', 45000000, 'VND', 'Cà phê Việt', true, 2, now(), now()),
  ('prod_devseed_01_03', 'store_devseed_01', 'biz_devseed_01', 'Cà Phê Muối', '盐奶油顶 · 需摇匀', 50000000, 'VND', 'Cà phê đặc biệt', true, 3, now(), now()),
  ('prod_devseed_01_04', 'store_devseed_01', 'biz_devseed_01', 'Trà Đào Cam Sả', '白桃乌龙 · 香茅', 45000000, 'VND', 'Trà', true, 4, now(), now()),
  ('prod_devseed_01_05', 'store_devseed_01', 'biz_devseed_01', 'Bánh Mì Pate', '现烤 · 肝酱黄瓜', 35000000, 'VND', 'Ăn nhẹ', true, 5, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 03 Café Nola（Mã Mây 老街咖啡）。
INSERT INTO business.store_products
  (id, store_id, business_id, name, description, price_minor, currency, category, available, sort_order, created_at, updated_at)
VALUES
  ('prod_devseed_03_01', 'store_devseed_03', 'biz_devseed_03', 'Cà Phê Nâu Đá', '滴漏黑咖加炼乳 · 冰', 40000000, 'VND', 'Cà phê Việt', true, 1, now(), now()),
  ('prod_devseed_03_02', 'store_devseed_03', 'biz_devseed_03', 'Cà Phê Đen Đá', '滴漏黑咖 · 不加糖', 35000000, 'VND', 'Cà phê Việt', true, 2, now(), now()),
  ('prod_devseed_03_03', 'store_devseed_03', 'biz_devseed_03', 'Trà Chanh Dây', '百香果绿茶', 40000000, 'VND', 'Trà', true, 3, now(), now()),
  ('prod_devseed_03_04', 'store_devseed_03', 'biz_devseed_03', 'Nước Mía', '现榨甘蔗 · 金桔', 30000000, 'VND', 'Nước ép', false, 4, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 04 Café Đinh（蛋咖发源地之一）。
INSERT INTO business.store_products
  (id, store_id, business_id, name, description, price_minor, currency, category, available, sort_order, created_at, updated_at)
VALUES
  ('prod_devseed_04_01', 'store_devseed_04', 'biz_devseed_04', 'Cà Phê Trứng Nóng', '热蛋咖 · 坐热水碗上', 50000000, 'VND', 'Cà phê trứng', true, 1, now(), now()),
  ('prod_devseed_04_02', 'store_devseed_04', 'biz_devseed_04', 'Cà Phê Trứng Đá', '冰蛋咖', 55000000, 'VND', 'Cà phê trứng', true, 2, now(), now()),
  ('prod_devseed_04_03', 'store_devseed_04', 'biz_devseed_04', 'Bột Đậu Xanh Trứng', '绿豆蛋饮 · 热', 50000000, 'VND', 'Cà phê trứng', true, 3, now(), now()),
  ('prod_devseed_04_04', 'store_devseed_04', 'biz_devseed_04', 'Cacao Trứng', '蛋可可', 55000000, 'VND', 'Cà phê trứng', true, 4, now(), now()),
  ('prod_devseed_04_05', 'store_devseed_04', 'biz_devseed_04', 'Sữa Chua Nếp Cẩm', '紫米酸奶', 40000000, 'VND', 'Tráng miệng', true, 5, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 06 Lifted（早午餐+咖啡）。
INSERT INTO business.store_products
  (id, store_id, business_id, name, description, price_minor, currency, category, available, sort_order, created_at, updated_at)
VALUES
  ('prod_devseed_06_01', 'store_devseed_06', 'biz_devseed_06', 'Eggs Benedict', '水波蛋 · 荷兰酱 · 英式松饼', 145000000, 'VND', 'Brunch', true, 1, now(), now()),
  ('prod_devseed_06_02', 'store_devseed_06', 'biz_devseed_06', 'Avocado Toast', '牛油果 · 酸面包 · 水波蛋', 125000000, 'VND', 'Brunch', true, 2, now(), now()),
  ('prod_devseed_06_03', 'store_devseed_06', 'biz_devseed_06', 'Flat White', '双份 Ristretto · 薄奶泡', 65000000, 'VND', 'Cà phê máy', true, 3, now(), now()),
  ('prod_devseed_06_04', 'store_devseed_06', 'biz_devseed_06', 'Cold Brew Cam', '18小时冷萃 · 鲜橙', 70000000, 'VND', 'Cà phê máy', true, 4, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 09 The Note Coffee（贴纸咖啡，来游区）。
INSERT INTO business.store_products
  (id, store_id, business_id, name, description, price_minor, currency, category, available, sort_order, created_at, updated_at)
VALUES
  ('prod_devseed_09_01', 'store_devseed_09', 'biz_devseed_09', 'Coconut Coffee', '椰子咖啡 · 英文单', 60000000, 'VND', 'Signature', true, 1, now(), now()),
  ('prod_devseed_09_02', 'store_devseed_09', 'biz_devseed_09', 'Egg Coffee', '蛋咖 · 英文单', 60000000, 'VND', 'Signature', true, 2, now(), now()),
  ('prod_devseed_09_03', 'store_devseed_09', 'biz_devseed_09', 'Passion Fruit Tea', '百香果茶', 55000000, 'VND', 'Tea', true, 3, now(), now()),
  ('prod_devseed_09_04', 'store_devseed_09', 'biz_devseed_09', 'Vietnamese Drip', '滴漏 · 炼乳', 50000000, 'VND', 'Cà phê Việt', true, 4, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 12 Tầng Trệt（Cầu Giấy 社区咖啡）。
INSERT INTO business.store_products
  (id, store_id, business_id, name, description, price_minor, currency, category, available, sort_order, created_at, updated_at)
VALUES
  ('prod_devseed_12_01', 'store_devseed_12', 'biz_devseed_12', 'Cà Phê Sữa Đá', '滴漏奶咖 · 社区价', 38000000, 'VND', 'Cà phê Việt', true, 1, now(), now()),
  ('prod_devseed_12_02', 'store_devseed_12', 'biz_devseed_12', 'Trà Vải', '荔枝乌龙', 42000000, 'VND', 'Trà', true, 2, now(), now()),
  ('prod_devseed_12_03', 'store_devseed_12', 'biz_devseed_12', 'Matcha Đá Xay', '抹茶冰沙', 55000000, 'VND', 'Đá xay', true, 3, now(), now()),
  ('prod_devseed_12_04', 'store_devseed_12', 'biz_devseed_12', 'Bánh Croissant', '牛角包 · 每日现烤', 35000000, 'VND', 'Bánh', true, 4, now(), now())
ON CONFLICT (id) DO NOTHING;

COMMIT;

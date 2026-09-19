-- STORE-AMENITIES-001: 门店设施属性（商家自填）。
--
-- 原型里的网速/吸烟/空调/插座/噪音/座位标记，数据源必须是商家自己填的，
-- 不能是平台编的。6 个字段全是"空=没填"，没填的客户端不显示、不参与筛选，
-- 绝不用默认值冒充。幂等：ADD COLUMN IF NOT EXISTS，可重复执行。
ALTER TABLE business.store_lines
  ADD COLUMN IF NOT EXISTS wifi TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS smoking TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ac_temp_c INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS power TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quiet TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seating TEXT NOT NULL DEFAULT '';

-- seed_merchant_operating_signals.sql
-- MERCHANT-SIGNAL-SEED-001（2026-10-01，用户「经营脉搏 未来需求…都是空的 做数据」）
--
-- 为什么需要这份文件：business.aggregated_demand_signals 与
-- business.scene_supply_snapshots 有 migration、有 upsert、有读取，但真实链路里
-- **没有任何生产者**。于是 GetMerchantOperatingHome 永远拿到 nil，
-- ResolveOperatingState 直接返回 INSUFFICIENT_SIGNAL / UNAVAILABLE ——
-- 「经营脉搏」和「未来需求」两块永远是空的。
--
-- ⚠️ 这是**静态测试数据，不是实测**。source 列（migration 155）标成 SEED_TEST，
-- 就是为了让它可被机器识别。页面自己印着「不会用历史销售冒充附近客流，也不会
-- 生成虚假精确预测」—— 既然测试期要这块有东西看，就不能让它冒充成算出来的。
-- 真的推导接上以后（现在还没有生产者），同一家店该被 MEASURED 覆盖。
--
-- 为什么落在 biz_devseed_01（而不是 biz_threebeans_bn）：
-- biz_threebeans_bn 是**真人商家**，weilinxia511 登录进去看的就是自己的经营数字。
-- 往那家店塞假的需求/容量，等于让真人看见编出来的经营数据。devseed 是测试账号，
-- 种在这里才是安全的。
--
-- 幂等：可重复执行（全部 insert-if-absent），不覆盖已有数据 —— 真人真数据优先。

BEGIN;

-- 门店认领场景（STORE-SCENE-LINK-001，店主自填的那条键）。
-- cafe_giang = 「Cà Phê Giảng · Hoàn Kiếm」（migration 153 的真实场景），
-- 与本店同在 Hoàn Kiếm ��— 快照里的 scene_id 指的是一条真的存在的场景，
-- 不是编出来的标识符。
UPDATE business.stores
   SET reality_scene_id = 'cafe_giang'
 WHERE id = 'store_devseed_01' AND (reality_scene_id IS NULL OR reality_scene_id = '');

-- 聚合需求信号（无 user id、无个人轨迹，MERCHANT-DEMAND-PRIVACY）。
-- 口径：total_matching_demand 30 条匹配需求，跨过隐私阈值 10；
-- 其中已确认到店 14、高概率 9。
-- confidence 0.75 = SampleConfidence(30, 10) = 30/(30+10)，与
-- internal/business/signal_confidence.go 同一口径 —— 那条门禁
-- (merchant_signal_seed_confidence_parity) 会盯着 SQL 字面量不许它漂走。
-- 这一组让 resolver 落到 DEMAND_RISING：有真实到店信号，所以决策是
-- 「暂不追加干预」而不是编一个「快去加流量」。
-- 幂等守卫：这两张表没有唯一键（天然是"追加式快照"表），裸 INSERT 重跑会翻倍。
-- 所以每家店只在"一条都没有"时种一行 —— 真人真数据 / 更新的快照优先，已有的不动。
INSERT INTO business.aggregated_demand_signals
  (business_id, total_matching_demand, confirmed_arrivals, high_probability_arrivals, confidence, recorded_at, source)
SELECT 'biz_devseed_01', 30, 14, 9, 0.75, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.aggregated_demand_signals WHERE business_id = 'biz_devseed_01');

-- 场景容量快照。
-- current 55% / forecast 63%：预测容量离 80% 的「偏紧」和 90% 的「超容风险」都
-- 还有距离，所以不会误导店主做「暂停引流」这种代价很大的动作。
-- 观测样本按 40 个座位算 → confidence 0.8 = SampleConfidence(40, 10) = 40/50。
INSERT INTO business.scene_supply_snapshots
  (business_id, store_id, scene_id, current_capacity_pct, forecast_capacity_pct, accepting_traffic, confidence, recorded_at, source)
SELECT 'biz_devseed_01', 'store_devseed_01', 'cafe_giang', 55, 63, true, 0.8, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.scene_supply_snapshots WHERE business_id = 'biz_devseed_01');

-- 近 7 天成交（GetMerchantOperatingHome 读 ListSpendDaily(7)）。
-- 这一张是「订单 / 成交 / 复访客户」三个指标的来源，也是 operatingPulse 从
-- EMPTY/NO_RECORDED_ACTIVITY 变成 ACTIVE/ROLLING_7_DAYS 的唯一条件 ——
-- 它空了，上面两个指标就全是「—」。
--
-- 单位：gross_minor 是**毫越南盾**（客户端 formatVnd 先除 1000），
-- 所以 120.000₫ 一单要记 120000000。按 ~20 单/天、客单 ~120.000₫ 排的量级。
-- 主键是 (business_id, bucket_date)，所以下面 7 行是「最近 7 天」而不是固定日期 ——
-- 跑得晚几天也不会留下过期行。
INSERT INTO business.spend_daily
  (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
VALUES
  ('biz_devseed_01', current_date - 6, 19, 2190000000, 12,  7),
  ('biz_devseed_01', current_date - 5, 22, 2540000000,  9, 13),
  ('biz_devseed_01', current_date - 4, 17, 1950000000,  8,  9),
  ('biz_devseed_01', current_date - 3, 24, 2760000000, 11, 13),
  ('biz_devseed_01', current_date - 2, 21, 2420000000, 10, 11),
  ('biz_devseed_01', current_date - 1, 26, 2980000000, 13, 13),
  ('biz_devseed_01', current_date,     20, 2320000000,  9, 11)
ON CONFLICT (business_id, bucket_date) DO NOTHING;


-- ---- 2026-10-02 补齐：让每种 resolver 结论都有真实例子 ----
-- 只给有**真实同区咖啡场景**的店种。Ba Đình（store_devseed_02 Kafeville）和
-- Tây Hồ（store_devseed_05）没有咖啡场景 —— reality_scene_id 留空，不硬链；
-- 没有场景就没有 supply 快照（scene_id 是快照的主体，编一个等于编数据）。
-- 同样全部 SEED_TEST + WHERE NOT EXISTS 守卫。
--
-- 五种状态各一家（confidence 全是 SampleConfidence(n,10)，见 signal_confidence.go）：
--   03 Café Nola       → BALANCED            total=30/0/0   fc=60  conf=0.75  sample=30
--   04 Café Đinh        → CAPACITY_TIGHT      total=30/5/2   fc=82  conf=0.75  sample=30
--   06 Lifted           → SUPPLY_EXCESS       total=10/0/0   fc=40  conf=0.50  sample=10
--   09 The Note Coffee  → OVER_CAPACITY_RISK  total=40/20/9  fc=92  conf=0.80  sample=40
--   12 Tầng Trệt        → DEMAND_RISING       total=30/14/9  fc=63  conf=0.75  sample=30
-- （01 Cộng Cà Phê 已有 DEMAND_RISING。）
-- 店名与场景名能对上的优先对上（04↔cafe_dinh、09↔cafe_note），其余同区咖啡场景。
-- 09 的 OVER_CAPACITY_RISK 会推出 STOP_TRAFFIC（要审批的动作）—— 测试数据里出现
-- 它是为了让"暂停引流"那条路有东西可看，不是对真店的建议。

-- 场景认领（STORE-SCENE-LINK-001，店主自填的那条键；这里是测试账号代填）。
UPDATE business.stores SET reality_scene_id = 'cafe_phoco'
 WHERE id = 'store_devseed_03' AND (reality_scene_id IS NULL OR reality_scene_id = '');
UPDATE business.stores SET reality_scene_id = 'cafe_dinh'
 WHERE id = 'store_devseed_04' AND (reality_scene_id IS NULL OR reality_scene_id = '');
UPDATE business.stores SET reality_scene_id = 'cafe_loadingt'
 WHERE id = 'store_devseed_06' AND (reality_scene_id IS NULL OR reality_scene_id = '');
UPDATE business.stores SET reality_scene_id = 'cafe_note'
 WHERE id = 'store_devseed_09' AND (reality_scene_id IS NULL OR reality_scene_id = '');
UPDATE business.stores SET reality_scene_id = 'threebeans'
 WHERE id = 'store_devseed_12' AND (reality_scene_id IS NULL OR reality_scene_id = '');

-- 需求信号（sample=total，confidence=SampleConfidence(total,10)）。
INSERT INTO business.aggregated_demand_signals
  (business_id, total_matching_demand, confirmed_arrivals, high_probability_arrivals, confidence, recorded_at, source)
SELECT 'biz_devseed_03', 30, 0, 0, 0.75, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.aggregated_demand_signals WHERE business_id = 'biz_devseed_03');
INSERT INTO business.aggregated_demand_signals
  (business_id, total_matching_demand, confirmed_arrivals, high_probability_arrivals, confidence, recorded_at, source)
SELECT 'biz_devseed_04', 30, 5, 2, 0.75, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.aggregated_demand_signals WHERE business_id = 'biz_devseed_04');
INSERT INTO business.aggregated_demand_signals
  (business_id, total_matching_demand, confirmed_arrivals, high_probability_arrivals, confidence, recorded_at, source)
SELECT 'biz_devseed_06', 10, 0, 0, 0.50, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.aggregated_demand_signals WHERE business_id = 'biz_devseed_06');
INSERT INTO business.aggregated_demand_signals
  (business_id, total_matching_demand, confirmed_arrivals, high_probability_arrivals, confidence, recorded_at, source)
SELECT 'biz_devseed_09', 40, 20, 9, 0.80, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.aggregated_demand_signals WHERE business_id = 'biz_devseed_09');
INSERT INTO business.aggregated_demand_signals
  (business_id, total_matching_demand, confirmed_arrivals, high_probability_arrivals, confidence, recorded_at, source)
SELECT 'biz_devseed_12', 30, 14, 9, 0.75, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.aggregated_demand_signals WHERE business_id = 'biz_devseed_12');

-- 供给快照（观测样本按 40 个座位算，confidence=SampleConfidence(40,10)=0.8）。
INSERT INTO business.scene_supply_snapshots
  (business_id, store_id, scene_id, current_capacity_pct, forecast_capacity_pct, accepting_traffic, confidence, recorded_at, source)
SELECT 'biz_devseed_03', 'store_devseed_03', 'cafe_phoco', 48, 60, true, 0.8, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.scene_supply_snapshots WHERE business_id = 'biz_devseed_03');
INSERT INTO business.scene_supply_snapshots
  (business_id, store_id, scene_id, current_capacity_pct, forecast_capacity_pct, accepting_traffic, confidence, recorded_at, source)
SELECT 'biz_devseed_04', 'store_devseed_04', 'cafe_dinh', 70, 82, true, 0.8, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.scene_supply_snapshots WHERE business_id = 'biz_devseed_04');
INSERT INTO business.scene_supply_snapshots
  (business_id, store_id, scene_id, current_capacity_pct, forecast_capacity_pct, accepting_traffic, confidence, recorded_at, source)
SELECT 'biz_devseed_06', 'store_devseed_06', 'cafe_loadingt', 30, 40, true, 0.8, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.scene_supply_snapshots WHERE business_id = 'biz_devseed_06');
INSERT INTO business.scene_supply_snapshots
  (business_id, store_id, scene_id, current_capacity_pct, forecast_capacity_pct, accepting_traffic, confidence, recorded_at, source)
SELECT 'biz_devseed_09', 'store_devseed_09', 'cafe_note', 85, 92, true, 0.8, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.scene_supply_snapshots WHERE business_id = 'biz_devseed_09');
INSERT INTO business.scene_supply_snapshots
  (business_id, store_id, scene_id, current_capacity_pct, forecast_capacity_pct, accepting_traffic, confidence, recorded_at, source)
SELECT 'biz_devseed_12', 'store_devseed_12', 'threebeans', 55, 63, true, 0.8, now(), 'SEED_TEST'
WHERE NOT EXISTS (SELECT 1 FROM business.scene_supply_snapshots WHERE business_id = 'biz_devseed_12');

-- 近 7 天成交（每家量级略有起伏，别 5 家长得一模一样 —— 那会被当成复制粘贴的假数据）。
INSERT INTO business.spend_daily
  (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
SELECT 'biz_devseed_03', d, 16 + ((extract(day from d)::int + 1) % 5), 1900000000::bigint + ((extract(day from d)::int) % 4) * 110000000, 7, 9 FROM generate_series(current_date - 6, current_date, '1 day') AS d
ON CONFLICT (business_id, bucket_date) DO NOTHING;
INSERT INTO business.spend_daily
  (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
SELECT 'biz_devseed_04', d, 24 + ((extract(day from d)::int + 2) % 6), 2900000000::bigint + ((extract(day from d)::int) % 3) * 150000000, 11, 14 FROM generate_series(current_date - 6, current_date, '1 day') AS d
ON CONFLICT (business_id, bucket_date) DO NOTHING;
INSERT INTO business.spend_daily
  (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
SELECT 'biz_devseed_06', d, 9 + ((extract(day from d)::int) % 4), 1000000000::bigint + ((extract(day from d)::int) % 5) * 90000000, 4, 6 FROM generate_series(current_date - 6, current_date, '1 day') AS d
ON CONFLICT (business_id, bucket_date) DO NOTHING;
INSERT INTO business.spend_daily
  (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
SELECT 'biz_devseed_09', d, 31 + ((extract(day from d)::int + 3) % 7), 3700000000::bigint + ((extract(day from d)::int) % 4) * 180000000, 14, 18 FROM generate_series(current_date - 6, current_date, '1 day') AS d
ON CONFLICT (business_id, bucket_date) DO NOTHING;
INSERT INTO business.spend_daily
  (business_id, bucket_date, order_count, gross_minor, new_customer_count, returning_customer_count)
SELECT 'biz_devseed_12', d, 19 + ((extract(day from d)::int + 1) % 5), 2250000000::bigint + ((extract(day from d)::int) % 3) * 130000000, 8, 11 FROM generate_series(current_date - 6, current_date, '1 day') AS d
ON CONFLICT (business_id, bucket_date) DO NOTHING;

COMMIT;

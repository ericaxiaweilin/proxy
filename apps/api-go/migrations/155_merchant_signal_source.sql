-- 155_merchant_signal_source.sql
-- MERCHANT-SIGNAL-SEED-001（2026-10-01，用户「经营脉搏 未来需求…都是空的」）
--
-- 根因不是数据少，是**没人写**：business.aggregated_demand_signals 与
-- business.scene_supply_snapshots 有 migration、有 upsert、有读取，但真实链路里
-- 没有任何生产者（UpsertSceneSupplySnapshot / RecordAggregatedDemandSignal 只在
-- command switch 和自己的测试里出现）。于是 resolver 永远拿到 nil，
-- 经营脉搏与未来需求恒为 INSUFFICIENT_SIGNAL / UNAVAILABLE。
--
-- 本迁移只加一个 source 列，用来**区分「实测」与「种入的测试数据」**：
--   MEASURED —— 真的从服务端记录算出来的信号（当前还没有生产者，等接上推导）。
--   SEED_TEST —— 静态测试数据（seed_threebeans_bn_signals.sql 种入）。
--
-- 为什么要这一列：这些快照会被商家当成自己的经营数据看。GEO-HONEST-001 刚把
-- 写死的 capacityFor(61/39/74/81) 删掉，页面自己也印着「不会用历史销售冒充
-- 附近客流，也不会生成虚假精确预测」。种测试数据是测试期的合理选择，但**必须
-- 可被机器识别**，否则就等于绕着那条原则走了个后门 —— 下一个人看到
-- confidence=0.72 会以为那是算出来的。
--
-- 旧行一律 MEASURED：迁移前的数据都是走命令写进来的，按来源算实测。
ALTER TABLE business.aggregated_demand_signals
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MEASURED';

ALTER TABLE business.scene_supply_snapshots
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MEASURED';

-- 合法值收口：拼错的 source 会让"这条是不是实测的"变成无法回答的问题。
ALTER TABLE business.aggregated_demand_signals
  DROP CONSTRAINT IF EXISTS aggregated_demand_signals_source_ck;
ALTER TABLE business.aggregated_demand_signals
  ADD CONSTRAINT aggregated_demand_signals_source_ck CHECK (source IN ('MEASURED', 'SEED_TEST'));

ALTER TABLE business.scene_supply_snapshots
  DROP CONSTRAINT IF EXISTS scene_supply_snapshots_source_ck;
ALTER TABLE business.scene_supply_snapshots
  ADD CONSTRAINT scene_supply_snapshots_source_ck CHECK (source IN ('MEASURED', 'SEED_TEST'));

-- 读取路径按 (business_id, recorded_at DESC) 排，来源列不进索引：
-- 它是展示/审计属性，不是查询条件。

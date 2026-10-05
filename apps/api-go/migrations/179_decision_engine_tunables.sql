-- OPS-MATCHING-TUNABLES-001（2026-10-05）：撮合排序的旋钮落库，运营能在控制台看到并调。
--
-- 为什么需要这张表：引擎今天按什么口径排序，全写在 internal/matching 的常量与字面量里
-- （可靠占 40 分、新人按「3 单里完成 2.4 单」起步、引力没算过的人给 0.3 中性分）。
-- 运营看不到，也就没法在「撮合太偏袒便宜」「新人永远排不上」这类反馈之后调口径 ——
-- 只能改代码发版。更要紧的是控制台里写的口径和代码里跑的必须是同一份账，两份对不上
-- 就是 OPS-REAL-001 那批假数字的成因。
--
-- 口径三条：
--  ① **没有行 = 用代码里的默认值**，所以这里不 seed 任何数据。seed 一份就等于造出
--     第二个「默认值」的来源：改了代码里的默认值而忘了改 seed，界面上会摆着一套
--     引擎根本不用的数（跟 seed 覆盖真数据是同一类事故）。默认值的唯一来源是
--     matching.DefaultTunables()，TestTunablesDefaultToTheHardcodedValues 钉着它。
--  ② 一个旋钮一行，不是一个 JSONB blob。因为界面要回答的是「**这一项**上次谁改的、
--     什么时候」—— 全量 blob 只有一个 updated_at，改一个旋钮会把另外十二个的来历
--     一起冲掉，事后复盘时没人分得清哪一项是谁动的。
--  ③ 值的边界不在这里 CHECK。理由与 operator.action_log 的 scope 列一样：
--     旋钮的词汇表和区间住在 Go（matching.TunableDefs()），那条界面上显示的范围
--     与真校验用的是同一份表；写在这里就会有两份会漂的边界。绕过 API 直接 INSERT
--     越界值仍然可以，但那种人本来就有 psql 权限，而每次经 API 的改动都会落
--     operator.action_log —— 留痕在审计那边，不靠这里兜。
--
-- version 与 identity.ai_engine_settings（119）同一口径：每次 UPSERT +1，
-- 不是行锁，只是让「我看的是不是别人已经改过的那一版」有一个可对比的数。

CREATE SCHEMA IF NOT EXISTS decision;

CREATE TABLE IF NOT EXISTS decision.engine_tunables (
    key        TEXT PRIMARY KEY,
    value      DOUBLE PRECISION NOT NULL,
    updated_by TEXT NOT NULL CHECK (updated_by <> ''),
    updated_at TIMESTAMPTZ NOT NULL,
    version    INTEGER NOT NULL CHECK (version > 0)
);

COMMENT ON TABLE decision.engine_tunables IS
  'OPS-MATCHING-TUNABLES-001: 撮合排序旋钮的覆盖值。缺行 = 用代码默认值；每次经 API 改动都同时写 operator.action_log。';
COMMENT ON COLUMN decision.engine_tunables.value IS
  'DOUBLE PRECISION：Go 侧是 float64，存 NUMERIC 也只会在两端各转一次，不如按实际类型存。';

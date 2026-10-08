-- TAG-SYSTEM-001（2026-10-08，用户：「标签工程模块后端必须要做，不然撮合引擎不知道如何工作」）
--
-- 规格 §3：Event = 事实，Feature = 连续数值，Tag = 可解释状态。本迁移只建「Tag 这一层 + 它依赖的
-- 粗粒度位置事实」，事件事实继续在 localnet.interaction_events（append-only，不动）。
--
-- 三条硬规矩（都来自同意管线，改之前先读 internal/consent 与 docs/legal/behavior-collection-audit-*）：
--  1. 标签是**派生物**，不是事实：整表可以随时按事件重算。同意被撤回 / 事件被删，重算后标签自然消失
--     （重算对「现有标签的人」也会跑一遍，所以撤回之后下一轮就清掉，不会留着）。
--  2. 每个标签轴声明 required_purpose：用哪个同意目的的事件才能生出这类标签；
--     取证据时一律走 consent.ValidAtSQL —— 判定规则全平台只有那一份。
--  3. allowed_use 逐轴声明（规格 §3.2）：读标签的人必须报上自己的用途，不在清单里的用途读不到。
--     今天只开 recommendation / matching / analytics；merchant_targeting / public 一律不开。

CREATE SCHEMA IF NOT EXISTS tag;

-- 受控词表：一行 = 一个标签轴（INTEREST_SCENE、RHYTHM…）。轴下面的取值（COFFEE、WEEKEND_EVENING）
-- 来自事实，不是手写的；取值的格式在 Go 侧校验。新增轴 = 新增一行 + 一条规则，不能只加其一。
CREATE TABLE IF NOT EXISTS tag.axes (
    axis             TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    polarity         TEXT NOT NULL CHECK (polarity IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL')),
    description      TEXT NOT NULL DEFAULT '',
    ttl_days         INTEGER NOT NULL CHECK (ttl_days > 0),
    -- 生成这类标签的证据需要哪个同意目的；空 = 不依赖被动采集（用户自己主动做的事）。
    required_purpose TEXT NOT NULL DEFAULT '',
    allowed_use      TEXT[] NOT NULL DEFAULT '{}',
    rule_version     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag.user_tags (
    user_id          TEXT NOT NULL,
    axis             TEXT NOT NULL REFERENCES tag.axes(axis),
    value            TEXT NOT NULL,
    strength         REAL NOT NULL CHECK (strength >= 0 AND strength <= 1),
    confidence       REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    source           TEXT NOT NULL CHECK (source IN ('BEHAVIOR', 'EXPLICIT', 'MIXED')),
    evidence_count   INTEGER NOT NULL CHECK (evidence_count > 0),
    source_diversity INTEGER NOT NULL CHECK (source_diversity > 0),
    first_seen       TIMESTAMPTZ NOT NULL,
    last_seen        TIMESTAMPTZ NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    computed_at      TIMESTAMPTZ NOT NULL,
    rule_version     TEXT NOT NULL,
    PRIMARY KEY (user_id, axis, value)
);
CREATE INDEX IF NOT EXISTS idx_user_tags_axis_value ON tag.user_tags (axis, value);
CREATE INDEX IF NOT EXISTS idx_user_tags_expiry ON tag.user_tags (expires_at);

-- 粗粒度位置事实（规格要的「GPS 大概信息」）：只存 ~1km 网格的格子 id，**永远不存原始经纬度**。
-- 写入口在服务端先取整再入库；需要「大致区域」同意（location.FUZZY_REGION）+ 采集类同意目的。
CREATE TABLE IF NOT EXISTS tag.coarse_locations (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    cell        TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coarse_locations_user ON tag.coarse_locations (user_id, observed_at DESC);

INSERT INTO tag.axes(axis, label, polarity, description, ttl_days, required_purpose, allowed_use, rule_version) VALUES
 ('INTEREST_SCENE',    '场景兴趣',   'POSITIVE', '近 28 天在某类场景的内容上停留得多',                 28, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('AVERSION_SCENE',    '场景回避',   'NEGATIVE', '近 14 天对某类场景的内容连续快速划走',               14, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('INTEREST_ACTIVITY', '活动兴趣',   'POSITIVE', '看活动页的时长，加上主动点过「感兴趣 / 报名」',      28, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('RHYTHM',            '活跃节律',   'NEUTRAL',  '一天中哪个时段最活跃（越南时间）',                    28, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('CITY',              '常在城市',   'NEUTRAL',  '事件主要发生在哪个城市',                              28, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08'),
 ('AREA',              '常去区域',   'NEUTRAL',  '约 1km 网格里至少 3 天出现过',                        28, 'RECOMMENDATION', '{recommendation,matching,analytics}', '2026-10-08')
ON CONFLICT (axis) DO NOTHING;

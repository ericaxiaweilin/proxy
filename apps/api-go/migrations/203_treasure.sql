-- TREASURE-001（2026-10-09，用户：学 PAO0 做寻宝，但我们是撮合——用户 / 小美 / 场景互动；
-- 普通宝箱任何用户都能开，「下单小美」才有的特殊激励（同行加成））。
--
-- 箱子落在真实的咖啡店场景上（每个场景同时一个活箱子），到店 100 米内才能开。
-- 同行加成：用户在这家店有一单已确认、带小美同行的活动报名，到店后可以多开一次（分数更高，可带咖啡券）。
-- 判定全在服务端；不存用户坐标，只存离店距离与定位精度。奖励只有成长值（进积分账本）和券（走福利活动），没有现金。
CREATE SCHEMA IF NOT EXISTS treasure;

CREATE TABLE IF NOT EXISTS treasure.chests (
    id         TEXT PRIMARY KEY,
    scene_id   TEXT NOT NULL,
    points     INTEGER NOT NULL CHECK (points > 0),
    capacity   INTEGER NOT NULL CHECK (capacity > 0),
    opened     INTEGER NOT NULL DEFAULT 0 CHECK (opened >= 0),
    status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED')),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (opened <= capacity)
);
-- 一个场景同时只有一个活箱子。
CREATE UNIQUE INDEX IF NOT EXISTS treasure_one_active_chest_per_scene ON treasure.chests (scene_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS treasure.opens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('SOLO', 'COMPANION')),
    chest_id     TEXT NOT NULL DEFAULT '',          -- SOLO：开的哪个箱子
    activity_id  TEXT NOT NULL DEFAULT '',          -- COMPANION：凭哪一单
    companion_id TEXT NOT NULL DEFAULT '',          -- COMPANION：那一单的小美
    scene_id     TEXT NOT NULL,
    points       INTEGER NOT NULL CHECK (points > 0),
    distance_m   INTEGER NOT NULL CHECK (distance_m >= 0),
    accuracy_m   INTEGER NOT NULL CHECK (accuracy_m >= 0),
    claim_id     TEXT NOT NULL DEFAULT '',          -- 带出的咖啡券（福利领取记录）
    opened_at    TIMESTAMPTZ NOT NULL,
    CHECK ((kind = 'SOLO' AND chest_id <> '') OR (kind = 'COMPANION' AND activity_id <> '' AND companion_id <> ''))
);
-- 每人每个箱子一次；每人每一单（活动 × 小美）的同行加成一次。
CREATE UNIQUE INDEX IF NOT EXISTS treasure_open_once_per_chest ON treasure.opens (user_id, chest_id) WHERE kind = 'SOLO';
CREATE UNIQUE INDEX IF NOT EXISTS treasure_open_once_per_booking ON treasure.opens (user_id, activity_id, companion_id) WHERE kind = 'COMPANION';
CREATE INDEX IF NOT EXISTS treasure_opens_user_time ON treasure.opens (user_id, opened_at DESC);

-- 运营配置：同行加成带的咖啡券（福利活动 + 福利编号）。没配 = 只给成长值，不编券。
CREATE TABLE IF NOT EXISTS treasure.settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

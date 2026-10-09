-- TREASURE-002（2026-10-09，用户：「要有特定的奖励 比如开出咖啡券」）。
-- 奖品 = 一个场景上的一批券（福利活动 + 福利定义 + 容量池，由 benefit.ProvisionCoupon 一次建齐）。
-- 箱子投放时如果这个场景有奖品，箱子就带 1~2 个「券位」（金色箱）；开箱时按 券位 / 剩余开箱人数 的概率抽中（保证券一定发得出去，
-- 又没人能提前知道自己是第几个）。同行加成（下单小美）在这家店的奖品还有余量时必出券。
-- 券的领取、核销、结算走福利服务原有链路；没有奖品的场景，箱子只给成长值——不编券。
CREATE TABLE IF NOT EXISTS treasure.prizes (
    id          TEXT PRIMARY KEY,
    scene_id    TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    benefit_id  TEXT NOT NULL,
    label       TEXT NOT NULL CHECK (btrim(label) <> ''),
    quota       INTEGER NOT NULL CHECK (quota > 0),
    awarded     INTEGER NOT NULL DEFAULT 0 CHECK (awarded >= 0),
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    CHECK (awarded <= quota)
);
-- 一个场景同时只有一个生效的奖品。
CREATE UNIQUE INDEX IF NOT EXISTS treasure_one_active_prize_per_scene ON treasure.prizes (scene_id) WHERE status = 'ACTIVE';

ALTER TABLE treasure.chests ADD COLUMN IF NOT EXISTS prize_id TEXT NOT NULL DEFAULT '';
ALTER TABLE treasure.chests ADD COLUMN IF NOT EXISTS prize_slots INTEGER NOT NULL DEFAULT 0 CHECK (prize_slots >= 0);

ALTER TABLE treasure.opens ADD COLUMN IF NOT EXISTS prize_label TEXT NOT NULL DEFAULT '';

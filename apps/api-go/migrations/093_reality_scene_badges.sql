-- SCENE-BADGE-001: 打卡徽章（append-only）。
--
-- 打卡不是终点：打卡景点、集类别、留足迹要有看得见的回报，才有人愿意真的
-- 走到现场。规则只在服务端 realityscene/badges.go 判定（与 mobile
-- scene-badges.ts 对齐）；本表只记录「何时、因哪个场景获得了哪个徽章」——
-- 这是举证的证据，不允许 UPDATE / DELETE，重得就再写一行。
--
-- 沿用 086~092 的口径：append-only + FK 挂真实存在的对象（scene 不存在
-- 不给发徽章，否则「打卡还剑湖」的徽章能被捏造出来）。

CREATE TABLE IF NOT EXISTS reality.scene_badges (
    id         TEXT PRIMARY KEY,
    badge_id   TEXT NOT NULL,
    actor_id   TEXT NOT NULL,
    scene_id   TEXT NOT NULL,
    earned_at  TIMESTAMPTZ NOT NULL,
    CHECK (badge_id <> ''),
    CHECK (actor_id <> ''),
    CHECK (scene_id <> '')
);

CREATE INDEX IF NOT EXISTS idx_scene_badges_actor
    ON reality.scene_badges (actor_id, earned_at);

COMMENT ON TABLE reality.scene_badges IS
  'SCENE-BADGE-001: 打卡徽章获得记录（append-only）。badge_id 见 realityscene/badges.go 目录。';

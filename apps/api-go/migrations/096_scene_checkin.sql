-- SCENE-CHECKIN-001: 「我在这里」—— 有时间窗的现场声明 + 真聚合的在场人数。
--
-- 用户要的是"可以和用户互动，而不是死数据"。收藏 / 去过 / 计划去是**静态**的
-- 私人标记，写下去就不会自己变；这一条是**会自己过期**的现场声明：
--   · 一次 check-in 只活 90 分钟（realityscene.CheckinTTL），过期自动不算数；
--   · 场景上的 hereCount = 该场景当前未过期的 check-in 数 —— 跟
--     saved/visited/planned 一样是**真聚合**出来的，没人声明就是 0。
--
-- 真值边界（不许越线，这是本仓的硬规矩）：
--   · 这是**本人声明**，不是定位证据。没授权定位时 distance_m 为 NULL，
--     check-in 依然成立，只是没有距离佐证 —— 是不是真在现场，我们不替用户断言。
--   · 只暴露**聚合数**，不暴露"谁"在现场。名单要等"邀请 / 报名"真的存在再说，
--     在那之前给名单就是给一个空的互动承诺。
CREATE TABLE IF NOT EXISTS reality.scene_checkins (
  scene_id    TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  -- 声明时设备自报的与场景的距离（米）。NULL = 没有位置（未授权 / 没定位到）。
  distance_m  INTEGER CHECK (distance_m IS NULL OR distance_m >= 0),
  PRIMARY KEY (scene_id, actor_id)
);

CREATE INDEX IF NOT EXISTS reality_scene_checkins_expiry_idx
  ON reality.scene_checkins (expires_at);
CREATE INDEX IF NOT EXISTS reality_scene_checkins_scene_idx
  ON reality.scene_checkins (scene_id, expires_at);

COMMENT ON TABLE reality.scene_checkins IS
  'Self-declared, time-boxed presence. Never a location proof; only aggregate counts are exposed.';

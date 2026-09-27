-- SCENE-REVIEW-001（2026-09-27，用户："场景名片"新设计给场景卡片画了一个
-- ★4.8/12 条评价——全仓没有场景评价域，用户决定：建一个真的场景评分系统）。
--
-- 门禁：只有真的在这个场景打过卡（reality.scene_checkins 历史命中该
-- scene_id，见 realityscene.Service.ListMyCheckinHistory）的人才能评这个
-- 场景——"去过"是这里唯一的真实凭据，跟 fulfillment.client_ratings 用
-- "完成过那单"当凭据是同一条纪律，只是换了个真实来源。
--
-- 一场景一人一次：同一个人对同一个场景改分覆盖（ON CONFLICT DO UPDATE），
-- 不叠加出多条。UNIQUE(scene_id, rater_id) 是这条规则的唯一真实保证，
-- 不是应用层口头约定（跟 client_ratings 的 UNIQUE(order_id) 同一惯例，
-- 键换成 (scene_id, rater_id) 是因为一个人可以评很多场景，一个场景也有
-- 很多人评——不是"一单一次"那种单一主键就够的形状）。
--
-- scene_id 不设外键：场景目录本身不是一张有主键的表（跟 reality.scene_checkins
-- 同样是 TEXT，不 FK），场景是代码里的静态目录（realityscene.launchScenes /
-- Postgres 侧的场景投影），不是可 REFERENCES 的行。
CREATE TABLE IF NOT EXISTS reality.scene_reviews (
    id         TEXT PRIMARY KEY,
    scene_id   TEXT NOT NULL,
    rater_id   TEXT NOT NULL,
    stars      SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (scene_id, rater_id)
);

-- 聚合查询（某个场景的平均分/评分数）按这个字段查，不是按主键。
CREATE INDEX IF NOT EXISTS scene_reviews_scene_id_idx
    ON reality.scene_reviews (scene_id);

COMMENT ON TABLE reality.scene_reviews IS
  'SCENE-REVIEW-001: 打过卡的人对场景的公开评分。一人一场景一次，UNIQUE(scene_id, rater_id) 保证改分覆盖不叠加。';

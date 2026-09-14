-- STORE-REC-004: 运营对店铺推荐的评估结论（append-only）。
--
-- 原状：运营队列（STORE-REC-002）只能看，不能判 —— 运营在 App 里读完一条
-- 推荐之后，没有任何地方可以记录「采纳 / 不采纳」，评估结论只存在于他脑子里。
-- 于是队列变成一条只读的死胡同：看完了，然后呢？
--
-- 为什么单独一张表，而不是给 store_recommendations 加个状态列：
--   092 里写得很清楚——「不在此表伪造结果」。推荐记录是**举证材料**：
--   谁、什么时候、因为什么推荐了哪家店。评估结论是另一件事（谁、什么时候、
--   基于什么判断），两者生命周期不同、写入者也不同。塞进同一张表就意味着
--   UPDATE，把举证链本身改掉了。这与 086 moderation_reports /
--   087 moderation_dispositions 是同一个口径：报告与处置分开两张 append-only 表。
--
-- 沿用 086/087/088/089 的原则：
--   - append-only：结论只增不改。改主意 = 追加一条新结论，以最新一条为准。
--   - fail-closed：decision 只能是 ACCEPT / REJECT；recommendation_id 与
--     decided_by 必须非空（匿名处置无法追责）。
--   - 不采纳必须给理由：否则举证链上会留下一条无法解释的拒绝，
--     后面复盘时没人知道当时为什么否掉这家店。

CREATE TABLE IF NOT EXISTS business.store_recommendation_dispositions (
    id                TEXT PRIMARY KEY,
    recommendation_id TEXT NOT NULL,
    decision          TEXT NOT NULL CHECK (decision IN ('ACCEPT', 'REJECT')),
    reason            TEXT NOT NULL DEFAULT '',
    decided_by        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL,
    CHECK (length(trim(recommendation_id)) > 0),
    CHECK (length(trim(decided_by)) > 0),
    CHECK (decision <> 'REJECT' OR length(trim(reason)) > 0)
);

-- 取「某条推荐的最新结论」：按推荐 id 查，时间倒序取第一条。
CREATE INDEX IF NOT EXISTS idx_store_rec_dispositions_recommendation
    ON business.store_recommendation_dispositions (recommendation_id, created_at DESC);

COMMENT ON TABLE business.store_recommendation_dispositions IS
  'STORE-REC-004: 运营对店铺推荐的评估结论（append-only）。采纳 / 不采纳只追加不修改，与推荐记录（举证材料）分开存放。';

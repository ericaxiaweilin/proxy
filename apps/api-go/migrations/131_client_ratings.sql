-- CLIENT-RATING-001（2026-09-26，用户：「市场-订单 UI 卡片上的 ★ 评分要做
-- 一个真的评分系统」）：市场卡片新设计给每个发布方（Opportunity.OwnerID，
-- 也就是需求方/客户）画一个 ★ 评分。这跟 fulfillment.RecordSatisfaction
-- 方向相反——那条是"需求方评价服务者"（进撮合排序，不公开），这里要的是
-- "服务者评价需求方"（公开给其他还没接单的小美看，判断这个客户值不值得接），
-- 是一个新概念，不能塞进 orders.outcome 那个 JSONB 里复用。
--
-- 一单一次：完成过的订单，只有那一单的接单方（agent_id）能给那一单的
-- 需求方（requester_id）打分，改分覆盖（ON CONFLICT DO UPDATE），不叠加
-- 出多条。UNIQUE(order_id) 是这条规则的唯一真实保证，不是应用层口头约定。
CREATE TABLE IF NOT EXISTS fulfillment.client_ratings (
    id             TEXT PRIMARY KEY,
    order_id       TEXT NOT NULL UNIQUE REFERENCES fulfillment.orders(id),
    rater_id       TEXT NOT NULL,
    rated_user_id  TEXT NOT NULL,
    stars          SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment        TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL
);

-- 聚合查询（某个客户的平均分/评分数）按这个字段查，不是按主键。
CREATE INDEX IF NOT EXISTS client_ratings_rated_user_id_idx
    ON fulfillment.client_ratings (rated_user_id);

COMMENT ON TABLE fulfillment.client_ratings IS
  'CLIENT-RATING-001: 接单方（agent_id）对需求方（rated_user_id）的公开评分，方向跟 orders.outcome 里的 Satisfaction 相反。一单一次，UNIQUE(order_id) 保证改分覆盖不叠加。';

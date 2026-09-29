-- ORDER-RECIPE-001：每笔活动报名存下单那一刻的完整票面快照（活动当时的样子 +
-- For You 选定的同行人 / 地点 / 时间段），「我的订单」照它重画同一张票。
-- 存量报名没有快照（这之前从来没存过），保持 NULL，不拿活动现在的样子回填冒充。
ALTER TABLE activity.participants ADD COLUMN IF NOT EXISTS order_snapshot JSONB;

-- TOPIC-INVITE-001: 主题邀约（无任务/档位/金额）复用 Offer 生命周期。
--
-- 原型里的"加入 · 邀请她"按主题邀约（办公/喝咖啡/语言课……），没有 task、
-- slot、金额 —— CreateSlotOffer 的必填项对不上。邀约与档位 Offer 共用一张表、
-- 同一套过期/接受语义，差异只有两列可空业务字段 + TTL 默认值不同（邀约 60s）。
-- 幂等：ADD COLUMN IF NOT EXISTS，可重复执行。
ALTER TABLE fulfillment.offers
  ADD COLUMN IF NOT EXISTS topic_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

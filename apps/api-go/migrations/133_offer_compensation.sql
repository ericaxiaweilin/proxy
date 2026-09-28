-- ORDER-OFFER-COMP-001（2026-09-28 订单管线审计）：档位报价的金额以前校验完就
-- 丢了 —— Offer 没有金额列，接单生成的订单快照金额写死 0、现金资格为空，
-- 直接进 CONFIRMED，绕过 R8 现金门。金额随报价落库，接单时冻结进订单快照。
-- 老报价没有金额（DEFAULT 0 = 面议），不回填（没人能诚实补上）。
-- 幂等：ADD COLUMN IF NOT EXISTS，可重复执行。
ALTER TABLE fulfillment.offers
  ADD COLUMN IF NOT EXISTS agreed_compensation BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'VND';

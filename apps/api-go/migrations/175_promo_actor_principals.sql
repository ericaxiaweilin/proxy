-- 175_promo_actor_principals.sql
--
-- MERCHANT-CREATOR-NOTIFY-001：和 174 同一个理由，落在专属码这条线上。
--
-- 「creator 报了你的码」这条通知的收件人是**商家**，而事件那一刻在场的是 creator
-- —— 商家的 user account id 不在事件的任何字段里。能确定的只有「这条专属码/
-- 这条权益当初是哪个成员建的」，那个时刻商家成员确实在场，所以记在那一行上。
--
-- 为什么不在通知时反查 business.member_directory：
--   · 多成员商户该通知谁？那是**猜**，而通知猜错的人比不通知更糟（等于把
--     「你的码有人报了」发给一个无关的店员）；
--   · 会把 worker/通知层绑到 business 域，跨域耦合；
--   · 成员表是「现在的成员」，而这条事实属于「当时是谁」。
-- 这两列本身也是审计上该有的事实（谁发的专属码、谁绑的权益），不是纯为了通知
-- 才加的。
--
-- 可空 = 未知（这几列之前建的行）。NULL 时**不发通知**，不猜收件人。
ALTER TABLE supply.merchant_creator_promos
    ADD COLUMN IF NOT EXISTS issued_by_principal_id TEXT;

ALTER TABLE supply.promo_benefits
    ADD COLUMN IF NOT EXISTS bound_by_principal_id TEXT;

COMMENT ON COLUMN supply.merchant_creator_promos.issued_by_principal_id IS
    '发这条专属码的商家成员 user account id。MERCHANT-CREATOR-NOTIFY-001：creator 报码时通知对象是商家，而不是当前 actor。NULL = 未知（历史行），此时不发通知，不猜。';
COMMENT ON COLUMN supply.promo_benefits.bound_by_principal_id IS
    '把该权益绑到这个码上的商家成员 user account id。MERCHANT-CREATOR-NOTIFY-001：公开码被报码时通知对象是商家。NULL = 未知（历史行），此时不发通知，不猜。';

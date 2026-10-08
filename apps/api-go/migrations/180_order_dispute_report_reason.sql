-- ORDER-DISPUTE-001：举报理由补上「订单纠纷」。
--
-- 为什么要加：moderation.reports.reason 被 CHECK 限死在 9 个值里，其中没有一类
-- 能装下真人服务里的订单纠纷（creator 放鸽子、爽约、服务与描述不符、临时加价）。
-- 只能塞 OTHER —— 而 OTHER 意味着运营在队列里看不出该先处理哪条。
--
-- 这不是第一次遇到：枚举当初就扩过一次，理由写在 moderation/service.go 的注释里
-- （「原接口只有 SPAM / HARASSMENT / UNSAFE / OTHER，而我们最需要被报上来的那类事
-- 只能塞进 UNSAFE 里，等于没有信号 —— 运营看不出该优先处理哪条」）。同一个理由，
-- 同一类问题。
--
-- ⚠️ 只加举报理由，不加任何钱相关的动作：申诉/处置成立之后没有金额可动
-- （平台侧没有真实支付，见 payment.VietQRProvider 的说明）。这条迁移纯粹是让
-- 「订单被质疑了」这件事变成一个能被分类、能被优先处理的信号。
ALTER TABLE moderation.reports DROP CONSTRAINT IF EXISTS reports_reason_check;
ALTER TABLE moderation.reports ADD CONSTRAINT reports_reason_check
  CHECK ((reason = ANY (ARRAY[
    'SPAM'::text, 'HARASSMENT'::text, 'UNSAFE'::text, 'MINOR_SAFETY'::text,
    'SOLICITATION'::text, 'FRAUD'::text, 'IMPERSONATION'::text, 'IP_VIOLATION'::text,
    'ORDER_DISPUTE'::text, 'OTHER'::text
  ])));

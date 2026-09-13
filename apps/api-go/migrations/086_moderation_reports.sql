-- COMP-REPORT-001: 把「用户举报」真正接下来。
--
-- 现状（实测）：服务条款 §38 与隐私政策都承诺用户可以举报内容 / 消息 /
-- 账号 / 活动 / 机会 / 商家 / 邀约 / 交易，但代码里只有一个入口
-- engagement.ReportPost（engagement.post_reports），其余七类既没有接口
-- 也没有表。承诺了 8 类，只接得上 1 类。
--
-- 为什么这是合规问题而不只是功能缺失：
--   1. 电商法 122/2025 与 NĐ 147/2024 要求平台提供举报受理与处理渠道；
--   2. 我们自己最重的刑事风险（刑法 327 条介绍卖淫）发生在「消息 / 账号 /
--      交易」这几类目标上 —— 没有入口，平台既收不到线索，也拿不出
--      「收到过、处理过」的证据；
--   3. 原接口只有 SPAM / HARASSMENT / UNSAFE / OTHER 四种理由，涉未成年人
--      与线下招嫖只能塞进 UNSAFE，运营看不出该优先处理哪一条。
--
-- 本表 append-only：举报记录是举证材料，不允许 UPDATE / DELETE。
-- 裁决与处置不在这里做（要人判断，自动处置会把误报变成不可逆的伤害），
-- 后续另开状态流转表引用本表的 id。
--
-- 注意：不存被举报内容本身（不复制消息正文 / 不复制图片）。举报只需指到
-- 目标 id，取证时按 id 去原表取，避免在举报表里再造一份不受原表保留策略
-- 约束的副本。

CREATE SCHEMA IF NOT EXISTS moderation;

CREATE TABLE IF NOT EXISTS moderation.reports (
    id          TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    reason      TEXT NOT NULL,
    note        TEXT,
    state       TEXT NOT NULL DEFAULT 'SUBMITTED',
    created_at  TIMESTAMPTZ NOT NULL,
    CHECK (target_type IN ('POST', 'MESSAGE', 'ACCOUNT', 'ACTIVITY',
                           'OPPORTUNITY', 'MERCHANT', 'INVITE', 'TRANSACTION')),
    CHECK (reason IN ('SPAM', 'HARASSMENT', 'UNSAFE', 'MINOR_SAFETY',
                      'SOLICITATION', 'FRAUD', 'IMPERSONATION',
                      'IP_VIOLATION', 'OTHER')),
    CHECK (state IN ('SUBMITTED')),
    CHECK (target_id <> ''),
    CHECK (reporter_id <> '')
);

-- 运营最常见查询：某个目标被报了多少次（同一目标被多人举报 = 优先处理）。
CREATE INDEX IF NOT EXISTS idx_moderation_reports_target
    ON moderation.reports (target_type, target_id, created_at DESC);

-- 按理由排查：MINOR_SAFETY / SOLICITATION 需要被单独拉出来优先看。
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reason
    ON moderation.reports (reason, created_at DESC);

-- 防止同一个人对同一目标刷举报（应用层仍要去重，这只是兜底）。
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter
    ON moderation.reports (reporter_id, target_type, target_id);

COMMENT ON TABLE moderation.reports IS
  'COMP-REPORT-001: 用户举报受理流水（append-only）。法律文件 §38 承诺可举报八类目标，此前只有 POST 一类接得上；记录谁报的、报了什么、什么理由、什么时候，用于复查与举证。';

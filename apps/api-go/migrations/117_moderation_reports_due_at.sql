-- COMP-REPORT-005: 给举报装上处置时限，并让举报第一次「出得来」。
--
-- 现状（实测，不是推测）：
--   moderation.reports 有 created_at，没有 due_at；
--   Repository 只有 AddReport 与 FindReport —— 而 FindReport 只被处置/申诉
--   写入口当作「对象是否存在」的校验用，没有任何一条查询能**列出**举报。
--   087 甚至替「运营队列」建好了 idx_moderation_dispositions_action 索引
--   （注释写着「例如『所有已升级未处置的』」），但那条查询从来没被写出来。
--
--      结论：举报只进不出。平台收得下举报，却没有任何路径把举报交到人手上。
--
-- 实测证据：本库唯一一条举报 reason='SOLICITATION'，2026-09-15 18:59 受理，
-- 到今天（2026-09-22）已 7 天，处置记录 0 条。不是没人处理 —— 是没有任何
-- 入口能发现它存在。而 SOLICITATION 恰是我们最重的刑事风险（刑法 327 条
-- 介绍卖淫）所在的那一类。
--
-- 为什么这是合规问题而不只是功能缺失：
--   1. 服务条款 §58 承诺「越南关于防范和处理假新闻、虚假信息的新规自其
--      法定生效日起适用于 Proxy。Proxy 将根据法律要求建立举报、核查、
--      限制传播、纠正、移除和账号处置流程」；Decree 328/2026 §4 把时限钉成
--      「一般 24 小时、紧急 6 小时」（口径见 docs/legal/vietnam/
--      Proxy_Operating_Terms_Supplement_2026-08-31.md 第 32 行的映射表）。
--      没有截止时刻，平台既做不到、也证明不了自己按时处理过 —— 与
--      COMP-AUTHORITY-001 在 §55 上已经解决的问题完全同构。
--   2. MINOR_SAFETY / SOLICITATION / UNSAFE 三类落在「紧急 6 小时」上。
--   3. §38 还写了「紧急安全事件或主管机关依法提出的合法请求可能优先处理」，
--      优先级同样要有一个可比较的量才能落地 —— 那个量就是 due_at。
--
-- 设计取舍：
--   - due_at 由**应用层**在受理时算出并写入（moderation.ReportSLAHours），
--     刻意不用 SQL 生成列：内存仓储与生产仓储必须给出同一个答案，把规则
--     放进 SQL 会让单测走一套、生产走另一套 —— 那种漂移是「测试全绿、
--     线上不同」，是最难发现的一种。
--   - due_at NOT NULL：一条算不出截止时刻的举报，正是本笔要消灭的状态。
--   - 固定写入（而不是每次读时重算）的理由：法定时限可能变，历史举报要按
--     「受理当时生效的时限」举证，不能因为规则改了就把过去的按时处理追溯
--     成超时。与 089 的 authority_requests.deadline_at 同口径。
--   - 下面的 UPDATE 是本表**唯一**一次合法写入：它不改证据，只给新增的
--     必填列补值。补值规则与 moderation.ReportSLAHours 一一对应，由
--     internal/moderation/queue_test.go 的 TestMigrationBackfillMatchesGoMapping
--     逐条比对（改一边不改另一边会红）。此表对应用代码仍是 append-only：
--     Go 侧只有 INSERT，没有 UPDATE / DELETE 路径。
--   - 时限口径（哪些理由算「紧急」）是**产品/法务判断**，集中在下面这一个
--     CASE 与 ReportSLAHours 的同一个 switch 里，改一处即可整体调整。

ALTER TABLE moderation.reports
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

-- 历史行一次性补齐。WHEN/THEN 的形状被 queue_test.go 逐行解析比对，
-- 改动时保持「WHEN '<REASON>' THEN <小时数>」一行一条。
UPDATE moderation.reports
   SET due_at = created_at + (
         CASE reason
           WHEN 'MINOR_SAFETY' THEN 6
           WHEN 'SOLICITATION' THEN 6
           WHEN 'UNSAFE'       THEN 6
           ELSE 24
         END
       ) * INTERVAL '1 hour'
 WHERE due_at IS NULL;

ALTER TABLE moderation.reports
    ALTER COLUMN due_at SET NOT NULL;

-- 运营队列的主查询：按截止时刻升序拉出未处置的举报，超时的自然排在最前。
CREATE INDEX IF NOT EXISTS idx_moderation_reports_due
    ON moderation.reports (due_at);

COMMENT ON COLUMN moderation.reports.due_at IS
  'COMP-REPORT-005: 处置截止时刻 = created_at + 该理由的法定时限（紧急 6h / 一般 24h，服务条款 §58 + Decree 328/2026 §4）。受理时由 moderation.ReportSLAHours 推导后固定写入；历史行由 117 迁移一次性补齐。超时判定见 moderation.ReportOverdue。';

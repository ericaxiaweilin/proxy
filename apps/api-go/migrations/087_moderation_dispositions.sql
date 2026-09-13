-- COMP-REPORT-003: 举报的处置留痕。
--
-- 现状（实测）：086 建的 moderation.reports 里 state 被 CHECK 钉死在
-- 'SUBMITTED'，且全表 append-only。也就是说——
--
--     平台能证明「收到过举报」，但证明不了「处理过举报」。
--
-- 为什么这比「少做个功能」严重：
--   1. 服务条款 §38/§39 与隐私政策都承诺了举报与申诉渠道，§961 行还承诺
--      「依法要求删除违法信息：最迟 24 小时内处理」。收进来但没有处置记录，
--      等于书面承认收到、却拿不出任何处理痕迹；
--   2. 我们最重的刑事风险（刑法 327 条介绍卖淫）落在 MINOR_SAFETY /
--      SOLICITATION 这两类举报上。这两类一旦进来又查不到处置记录，姿态就是
--      「知情不办」——这比没有举报功能更糟；
--   3. 086 的注释里已经写明「裁决与处置不在这里做……后续另开状态流转表
--      引用本表的 id」。这一笔就是那张表。
--
-- 设计取舍（沿用 086 与 media review decision 的既有口径）：
--   - append-only：处置记录同样是举证材料，不允许 UPDATE / DELETE。
--     要改就再写一行（REOPEN 或新的 ACTION_TAKEN），历史永远留着。
--   - 举报的「当前状态」不写回 reports 表，而是由本表最后一行推导 ——
--     reports 保持 append-only，同时又能回答「这条现在到哪一步了」。
--   - 不复制被举报内容本身（与 086 同理由）：只存 report_id。

CREATE TABLE IF NOT EXISTS moderation.dispositions (
    id         TEXT PRIMARY KEY,
    report_id  TEXT NOT NULL REFERENCES moderation.reports (id),
    -- 流转动作：
    --   TRIAGE        已有人接手在看（未下结论）
    --   ESCALATE      升级（法务 / 有权机关 / 更高权限）
    --   ACTION_TAKEN  已处置（必须同时写 outcome，说明做了什么）
    --   DISMISS       判定不成立（必须同时写 note，说明为什么）
    --   REOPEN        重新打开（前一次处置结论被推翻）
    action     TEXT NOT NULL,
    -- 处置结论，仅 ACTION_TAKEN 时有意义。
    outcome    TEXT,
    -- 谁处置的。留空等于这条处置无人负责 —— 直接拒绝写入。
    actor_id   TEXT NOT NULL,
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (action IN ('TRIAGE', 'ESCALATE', 'ACTION_TAKEN', 'DISMISS', 'REOPEN')),
    CHECK (outcome IS NULL OR outcome IN ('CONTENT_REMOVED', 'ACCOUNT_RESTRICTED',
                                          'ACCOUNT_SUSPENDED', 'REFERRED_TO_AUTHORITY',
                                          'NO_ACTION')),
    CHECK (actor_id <> ''),
    CHECK (report_id <> ''),
    -- 「说处置了却不说处置了什么」= 没有处置证据。数据库层面再兜一道，
    -- 免得有人绕过 Service 直接插一条空壳记录。
    CHECK (action <> 'ACTION_TAKEN' OR outcome IS NOT NULL),
    -- 同理：判定不成立却不写理由，看起来就是随手关掉。
    CHECK (action <> 'DISMISS' OR (note IS NOT NULL AND note <> ''))
);

-- 举报详情页：按时间拉出这条举报的完整处置链。
CREATE INDEX IF NOT EXISTS idx_moderation_dispositions_report
    ON moderation.dispositions (report_id, created_at);

-- 运营队列：按动作 + 时间排查（例如「所有已升级未处置的」）。
CREATE INDEX IF NOT EXISTS idx_moderation_dispositions_action
    ON moderation.dispositions (action, created_at DESC);

COMMENT ON TABLE moderation.dispositions IS
  'COMP-REPORT-003: 举报处置流水（append-only）。reports 表状态恒为 SUBMITTED，只证明「收到过」；本表证明「处理过」——谁、什么时候、做了什么（或为什么没做）。刑法 327 条风险下的举证材料。';

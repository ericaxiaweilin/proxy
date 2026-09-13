-- COMP-REPORT-004: 申诉机制（§37 / §38 承诺的「恢复或申诉机制」）。
--
-- 现状（实测）：001 + 003 把举报闭环到了「收到 → 处理」—— reports 证明
-- 收到、dispositions 证明处理。但被处理方（被举报者、或对处置结果不服的
-- 举报人）没有任何渠道去申诉。服务条款 §37 第 693 行、§38 第 709 行都写了
-- 「在适当情况下提供申诉机制」，而 NĐ 147/2024 把社交网络的投诉 / 申诉渠道
-- 列为硬性要求。
--
-- 没有申诉渠道 = 平台能证明自己「处理了举报」，却证明不了「被处理方有
-- 救济途径」。在行政与刑事语境下，处置权缺少制衡同样是 posture 缺陷：
-- 一条 ACCOUNT_SUSPENDED / REFERRED_TO_AUTHORITY 的处置，被处理方完全
-- 无法申辩，姿态就是「平台说了算」。
--
-- 设计取舍（沿用 086 / 087 的口径）：
--   - append-only：申诉与其复核都是举证材料，不允许 UPDATE / DELETE。
--     要改结论就再写一行复核，历史永远留着。
--   - 申诉引用真实存在的举报（FK → moderation.reports）；复核引用真实
--     存在的申诉（FK → moderation.appeals）。给不存在的对象写记录只能
--     制造「看起来处理过」的假象，比没有记录更糟。
--   - 复核是 operator-only（见 security.go 的 operatorCommandTypes），
--     普通用户不能给自己写「申诉成立 / 驳回」。

CREATE TABLE IF NOT EXISTS moderation.appeals (
    id                   TEXT PRIMARY KEY,
    report_id            TEXT NOT NULL REFERENCES moderation.reports (id),
    appellant_account_id TEXT NOT NULL,
    reason               TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL,
    CHECK (report_id <> ''),
    CHECK (appellant_account_id <> ''),
    -- 空理由的申诉没有信息量，运营不知道在申诉什么。
    CHECK (length(trim(reason)) > 0)
);

-- 运营队列：按举报拉出这条举报的全部申诉。
CREATE INDEX IF NOT EXISTS idx_moderation_appeals_report
    ON moderation.appeals (report_id, created_at);

-- 申诉的复核（operator-only）：UPHELD / REJECTED。append-only，与 dispositions 同口径。
CREATE TABLE IF NOT EXISTS moderation.appeal_decisions (
    id         TEXT PRIMARY KEY,
    appeal_id  TEXT NOT NULL REFERENCES moderation.appeals (id),
    decision   TEXT NOT NULL,
    note       TEXT,
    actor_id   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (decision IN ('UPHELD', 'REJECTED')),
    CHECK (actor_id <> ''),
    CHECK (appeal_id <> ''),
    -- 驳回必须写理由：一条涉未成年人 / 招嫖的申诉被无理由驳回，看起来就是
    -- 随手关掉。与 dispositions 的 DISMISS 同口径。
    CHECK (decision <> 'REJECTED' OR (note IS NOT NULL AND note <> ''))
);

-- 运营队列：按申诉拉出完整复核链。
CREATE INDEX IF NOT EXISTS idx_moderation_appeal_decisions_appeal
    ON moderation.appeal_decisions (appeal_id, created_at);

COMMENT ON TABLE moderation.appeals IS
  'COMP-REPORT-004: 申诉提交（append-only）。被处理方或对处置不服的举报人，针对一条存在的举报提出申诉；满足 §37 / §38 与 NĐ 147/2024 的申诉渠道要求。';

COMMENT ON TABLE moderation.appeal_decisions IS
  'COMP-REPORT-004: 申诉复核（append-only，operator-only）。UPHELD / REJECTED，驳回必须写理由。处置权由此获得制衡。';

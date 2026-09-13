-- COMP-AUTHORITY-001: 有权机关请求的受理留痕与响应时限。
--
-- 现状（实测）：服务条款 §55「合法政府请求与紧急响应」白纸黑字承诺了带
-- 数字的响应时限——
--     - 一般有效用户信息请求：最迟 24 小时内处理；
--     - 涉及国家安全或生命安全的紧急有效请求：最迟 3 小时内处理；
--     - 依法要求限制访问、删除违法信息或移除违法服务：最迟 24 小时内处理；
--     - 国家安全紧急情况下的相关内容处置：最迟 6 小时内处理。
-- 并承诺「所有请求应进行主体、权限、范围和合法性核验，并对处理过程进行
-- 记录」。
--
-- 而代码里 REFERRED_TO_AUTHORITY 只是 087 里一个从未被任何写入路径使用的
-- 枚举值：请求进来了没有受理记录、没有核验记录、没有截止时刻、没有响应
-- 记录。也就是说——平台既证明不了自己在法定时限内响应过，也证明不了自己
-- 核验过请求的合法性。
--
-- 网络安全法 116/2025 与 333/2026/NĐ-CP 同样要求平台建立能够满足法定响应
-- 时限的流程。这不是「少做个功能」，是行政义务。
--
-- 沿用 086/087/088 的口径：
--   - append-only：受理与响应都是举证材料，不允许 UPDATE / DELETE。
--   - fail-closed：四项核验（主体 / 权限 / 范围 / 合法性）缺一，不得记为
--     已受理；请求种类不认识则拿不到时限，直接拒绝写入。
--   - 两个写入命令都是 operator-only（见 security.go 的 operatorCommandTypes）：
--     普通用户绝不能伪造「有权机关要求调取你的信息」这种记录。

CREATE TABLE IF NOT EXISTS moderation.authority_requests (
    id            TEXT PRIMARY KEY,
    -- 来文编号 / 公函引用，日后与机关对账用。
    request_ref   TEXT NOT NULL,
    authority     TEXT NOT NULL,
    -- 请求种类决定法定响应时限：
    --   USER_INFO                  一般有效用户信息请求              24 小时
    --   USER_INFO_EMERGENCY        涉及国家安全或生命安全的紧急请求    3 小时
    --   CONTENT_REMOVAL            限制访问 / 删除违法信息 / 移除违法服务 24 小时
    --   CONTENT_REMOVAL_EMERGENCY  国家安全紧急情况下的内容处置        6 小时
    request_kind  TEXT NOT NULL,
    -- §55 要求的四项核验：主体 / 权限 / 范围 / 合法性。
    -- 缺任何一项都不得进入处理 —— 这是 fail-closed 的底线，见下面的 CHECK。
    verified_subject   BOOLEAN NOT NULL,
    verified_authority BOOLEAN NOT NULL,
    verified_scope     BOOLEAN NOT NULL,
    verified_legality  BOOLEAN NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL,
    -- 由 request_kind 推导的法定截止时刻（received_at + 时限）。
    deadline_at   TIMESTAMPTZ NOT NULL,
    note          TEXT,
    actor_id      TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    CHECK (request_kind IN ('USER_INFO', 'USER_INFO_EMERGENCY',
                            'CONTENT_REMOVAL', 'CONTENT_REMOVAL_EMERGENCY')),
    CHECK (authority <> ''),
    CHECK (request_ref <> ''),
    CHECK (actor_id <> ''),
    -- 截止时刻必须晚于受理时刻，否则时限无从核对。
    CHECK (deadline_at > received_at),
    -- 四项核验没做完就不许记为「已受理」：未核验就照办，等于谁拿个信封来
    -- 要数据都给。
    CHECK (verified_subject AND verified_authority AND verified_scope AND verified_legality)
);

-- 运营队列：按截止时间排查「快到期还没响应的」。
CREATE INDEX IF NOT EXISTS idx_moderation_authority_requests_deadline
    ON moderation.authority_requests (deadline_at);

-- 申诉 / 举报详情页：按来文编号回查。
CREATE INDEX IF NOT EXISTS idx_moderation_authority_requests_ref
    ON moderation.authority_requests (request_ref);

-- 受理之后的响应（append-only）。与 dispositions / appeal_decisions 同口径：
-- 一次请求可以有多条响应记录（例如先部分提供、再补充），历史永远留着。
CREATE TABLE IF NOT EXISTS moderation.authority_responses (
    id           TEXT PRIMARY KEY,
    request_id   TEXT NOT NULL REFERENCES moderation.authority_requests (id),
    -- FULFILLED 已按请求提供 / PARTIALLY_FULFILLED 部分提供 /
    -- REFUSED 依法拒绝（请求不合法或超范围）/ NO_DATA_FOUND 查无相关数据
    outcome      TEXT NOT NULL,
    responded_at TIMESTAMPTZ NOT NULL,
    note         TEXT,
    actor_id     TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    CHECK (outcome IN ('FULFILLED', 'PARTIALLY_FULFILLED', 'REFUSED', 'NO_DATA_FOUND')),
    CHECK (actor_id <> ''),
    CHECK (request_id <> '')
);

-- 按请求拉出完整响应链（用于证明「在截止前响应了」）。
CREATE INDEX IF NOT EXISTS idx_moderation_authority_responses_request
    ON moderation.authority_responses (request_id, responded_at);

COMMENT ON TABLE moderation.authority_requests IS
  'COMP-AUTHORITY-001: 有权机关请求受理（append-only，operator-only）。§55 承诺 24h/3h/24h/6h 四类响应时限；本表记录来文、四项核验与法定截止时刻。';

COMMENT ON TABLE moderation.authority_responses IS
  'COMP-AUTHORITY-001: 有权机关请求响应（append-only，operator-only）。与 deadline_at 对照即可证明是否在法定时限内响应。';

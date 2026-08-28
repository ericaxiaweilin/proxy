-- 032_media_review_decisions.sql
-- R15.18: 内容审核决策审计表 — 之前决策只存 media.media_assets.last_error 字串,
-- 难查。R15.17 的 ReviewMediaAsset 走这个表给 operator 永久审计行。
--
-- 设计:
--   - append-only (没有 UPDATE/DELETE 路径在 service 里),只 INSERT。
--   - 主键 mrd_<uuid_hex> 32 字符,服务生成。
--   - reviewed_at timestamptz NOT NULL DEFAULT now() — server clock, 不可编。
--   - reason: APPROVE | REJECT_NUDITY | REJECT_POLITICS | REJECT_VIOLENCE
--     (跟 service.reviewReasonToStatus 同步)。
--   - from_status / to_status: 服务校验的合法 ModerationStatus 值。
--   - operator_id: server 边界验证过的 principal.ID (e.Principal.ID)。
--   - note: operator 自由文本,可空。
--
-- RLS: 仅 operator (PROXY_OPERATOR_PRINCIPALS env) + auditor 角色能读。
-- 写只能由 service 走 SECURITY DEFINER 函数, 普通 user 不能直接 INSERT
-- (防止伪造 audit trail)。
CREATE TABLE IF NOT EXISTS media.media_review_decisions (
    decision_id    TEXT PRIMARY KEY,
    media_asset_id TEXT NOT NULL,
    from_status    TEXT NOT NULL,
    to_status      TEXT NOT NULL,
    reason         TEXT NOT NULL,
    note           TEXT NOT NULL DEFAULT '',
    operator_id    TEXT NOT NULL,
    reviewed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 必须 reason 在合法集合 (跟 service.reviewReasonToStatus 同步)。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'media_review_decisions_reason_check'
    ) THEN
        ALTER TABLE media.media_review_decisions
            ADD CONSTRAINT media_review_decisions_reason_check
            CHECK (reason IN ('APPROVE','REJECT_NUDITY','REJECT_POLITICS','REJECT_VIOLENCE'));
    END IF;
END$$;

-- from/to 必须在合法 ModerationStatus 集合 (跟 contracts ModerationStatus
-- 同步: QUARANTINED / APPROVED / REJECTED_TECHNICAL / REJECTED_CONTENT_NUDITY
-- / _POLITICS / _VIOLENCE)。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'media_review_decisions_status_check'
    ) THEN
        ALTER TABLE media.media_review_decisions
            ADD CONSTRAINT media_review_decisions_status_check
            CHECK (
                from_status IN ('QUARANTINED','APPROVED','REJECTED_TECHNICAL',
                                'REJECTED_CONTENT_NUDITY','REJECTED_CONTENT_POLITICS',
                                'REJECTED_CONTENT_VIOLENCE')
                AND to_status IN ('APPROVED','REJECTED_CONTENT_NUDITY',
                                  'REJECTED_CONTENT_POLITICS','REJECTED_CONTENT_VIOLENCE')
            );
    END IF;
END$$;

-- 必须 media_asset_id 在 media.media_assets 里 (FK 防止孤儿行)。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'media_review_decisions_asset_fk'
    ) THEN
        ALTER TABLE media.media_review_decisions
            ADD CONSTRAINT media_review_decisions_asset_fk
            FOREIGN KEY (media_asset_id) REFERENCES media.media_assets(media_asset_id)
            ON DELETE RESTRICT;
    END IF;
END$$;

-- 索引 1: 按 asset id 过滤 (R15.18 ListMediaReviewDecisions 主路径)。
CREATE INDEX IF NOT EXISTS idx_media_review_decisions_asset
    ON media.media_review_decisions (media_asset_id, reviewed_at DESC);

-- 索引 2: 按 operator id 过滤 (audit "operator X 一周内点过哪些" 报告用)。
CREATE INDEX IF NOT EXISTS idx_media_review_decisions_operator
    ON media.media_review_decisions (operator_id, reviewed_at DESC);

COMMENT ON TABLE media.media_review_decisions IS
    'R15.18: content review 决策审计行, append-only, 由 service 在 /v1/commands/ReviewMediaAsset 成功后写入。';
COMMENT ON COLUMN media.media_review_decisions.decision_id IS
    '主键 mrd_<32hex>, service 用 crypto/rand 生成, 不可编。';
COMMENT ON COLUMN media.media_review_decisions.from_status IS
    '来源 ModerationStatus, service 状态机校验。';
COMMENT ON COLUMN media.media_review_decisions.to_status IS
    '目标 ModerationStatus, 必须是 APPROVED 或 REJECTED_CONTENT_* 之一。';
COMMENT ON COLUMN media.media_review_decisions.reason IS
    '跟 service.reviewReasonToStatus key 同步: APPROVE / REJECT_NUDITY / REJECT_POLITICS / REJECT_VIOLENCE。';
COMMENT ON COLUMN media.media_review_decisions.operator_id IS
    'PROXY_OPERATOR_PRINCIPALS 门验证过的 principal.ID, 客户端无法伪造。';

-- RLS: 仅 operator + auditor 能 SELECT, INSERT 由 SECURITY DEFINER 函数封装。
-- 仅在 production 部署 (有 proxy_api_operator role) 启用 — dev/test 环境跳过。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_operator') THEN
        ALTER TABLE media.media_review_decisions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE media.media_review_decisions FORCE ROW LEVEL SECURITY;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policy WHERE polrelid = 'media.media_review_decisions'::regclass
              AND polname = 'media_review_decisions_select_operator'
        ) THEN
            CREATE POLICY media_review_decisions_select_operator
                ON media.media_review_decisions
                FOR SELECT
                TO proxy_api_operator
                USING (true);
        END IF;
    END IF;
END$$;

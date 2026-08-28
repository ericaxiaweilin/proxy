-- 033_media_auditor_role.sql
-- R15.19: auditor role 拆分 — proxy_api_operator 拆 write role +
-- proxy_api_auditor read-only role。Production 部署时分别 grant
-- 给不同身份的连接 role。
--
-- 设计:
--   proxy_api_operator  (写)
--     - 跟 proxy_api 同名 (后台 service 走这个 role)
--     - 已经有 R15.18 的 media_review_decisions_select_operator policy
--     - 这条 migration 不改 operator 的 policy, 保留现有能力
--   proxy_api_auditor  (新, 读 only)
--     - 只能 SELECT media_review_decisions
--     - 不能 INSERT / UPDATE / DELETE (没 grant)
--     - 不能读其他表 (没 grant)
--
-- Append-only 设计: auditor 不能改审计, 只能读。append-only
-- 即使 service 也只 INSERT, 没有 UPDATE/DELETE 路径。
--
-- 仅 production (role 都存在) 启用 — dev/test 跳过。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_auditor') THEN
        CREATE ROLE proxy_api_auditor NOLOGIN;
    END IF;

    -- 显式 grant SELECT (跟 RLS policy 配对, RLS USING(true) 允许该 role 读)
    GRANT USAGE ON SCHEMA media TO proxy_api_auditor;
    GRANT SELECT ON media.media_review_decisions TO proxy_api_auditor;
    -- 显式拒写 (即使没 grant, RLS 默认 deny; 显式更安全)
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
        ON media.media_review_decisions FROM proxy_api_auditor;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policy WHERE polrelid = 'media.media_review_decisions'::regclass
          AND polname = 'media_review_decisions_select_auditor'
    ) THEN
        EXECUTE 'CREATE POLICY media_review_decisions_select_auditor
            ON media.media_review_decisions
            FOR SELECT
            TO proxy_api_auditor
            USING (true)';
    END IF;
END$$;

COMMENT ON ROLE proxy_api_auditor IS
    'R15.19: read-only 审计身份。只能 SELECT media.media_review_decisions, 不能写也不能读其他表。';
COMMENT ON POLICY media_review_decisions_select_auditor ON media.media_review_decisions IS
    'R15.19: proxy_api_auditor 只读 policy, USING(true) 配合上面 RLS 启用。';

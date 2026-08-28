-- 034_media_observer_role.sql
-- R15.22: observer role 拆分 — proxy_api_auditor (R15.19) 可读
-- media_review_decisions, 但 dashboards 还需要看 media_assets / posts
-- 等其他表。拆 proxy_api_observer 出来: 跨多表只读, 但跟
-- proxy_api_auditor 不同的是给 BI/dashboard 用, 不走安全审计流。
--
-- 设计:
--   proxy_api_observer  (新, 跨表 read-only)
--     - SELECT on media.media_assets, media.media_review_decisions,
--       localnet.posts (R15.15 引入)
--     - 显式 revoke INSERT/UPDATE/DELETE/TRUNCATE
--     - 没有 USAGE on 任何序列 (防止 nextval 被滥用)
--     - 不跟 proxy_api_auditor (审计) 冲突: 一个走审计流,
--       一个走 BI/dashboard
--
-- 仅在 production (role 都存在) 启用 — dev/test 跳过。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_observer') THEN
        CREATE ROLE proxy_api_observer NOLOGIN;
    END IF;

    GRANT USAGE ON SCHEMA media TO proxy_api_observer;
    GRANT USAGE ON SCHEMA localnet TO proxy_api_observer;
    GRANT SELECT ON media.media_assets TO proxy_api_observer;
    GRANT SELECT ON media.media_review_decisions TO proxy_api_observer;
    -- localnet.posts 是 R15.15 引入, 但只有当表存在才能 grant
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'localnet' AND tablename = 'posts'
    ) THEN
        GRANT SELECT ON localnet.posts TO proxy_api_observer;
    END IF;

    -- 显式拒写
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON media.media_assets FROM proxy_api_observer;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON media.media_review_decisions FROM proxy_api_observer;
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'localnet' AND tablename = 'posts'
    ) THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON localnet.posts FROM proxy_api_observer;
    END IF;

    -- RLS policy: 跟 auditor 一样 USING(true) 即可 (跨表 SELECT)
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'media.media_review_decisions'::regclass
          AND polname = 'media_review_decisions_select_observer'
    ) THEN
        EXECUTE 'CREATE POLICY media_review_decisions_select_observer
            ON media.media_review_decisions
            FOR SELECT
            TO proxy_api_observer
            USING (true)';
    END IF;
END$$;

COMMENT ON ROLE proxy_api_observer IS
    'R15.22: 跨表只读身份 (BI/dashboards)。SELECT media.media_assets + media_review_decisions + localnet.posts, 不能写。跟 proxy_api_auditor (审计流) 区分。';
COMMENT ON POLICY media_review_decisions_select_observer ON media.media_review_decisions IS
    'R15.22: proxy_api_observer 只读 policy, USING(true) 配合上面 RLS 启用。';

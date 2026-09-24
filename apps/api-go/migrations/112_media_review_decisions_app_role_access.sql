-- 112_media_review_decisions_app_role_access.sql
--
-- 032 给 media.media_review_decisions 开了 ENABLE + FORCE ROW LEVEL SECURITY，
-- 但只建了两条 **SELECT** policy（proxy_api_operator / proxy_api_auditor）。
-- **没有任何 INSERT policy。** 032 的注释写着
--   「写只能由 service 走 SECURITY DEFINER 函数, 普通 user 不能直接 INSERT
--     (防止伪造 audit trail)」
-- —— 那个 SECURITY DEFINER 函数在 126 个迁移里**不存在**
-- （`grep -rn "SECURITY DEFINER" apps/api-go/migrations/` 只命中 052 的
-- post_media_projection）。真正的写路径是
-- platform/postgres/media_review_decisions.go 的**普通 INSERT**。
--
-- 后果（FORCE RLS + 无 INSERT policy = 默认拒绝）：
--   * 任何非超级用户的连接角色都写不进这张表。实测（本地库，
--     SET ROLE proxy_api_operator + 显式 GRANT INSERT）：
--       ERROR: new row violates row-level security policy
--   * 应用角色 proxy 连 SELECT policy 都没有，读回来是**静默 0 行**（不是报错）。
--   * 而 service.go:1348 把 AppendReviewDecision 的失败做成**软失败**
--     （只发一条 MediaReviewDecisionPersistFailed 事件，不返错），
--     所以线上表现是「审核照常成功 + 审计链永远为空」，不是报错。
--
-- 为什么仓库自己的测试看不见：testdb_test.go 的临时集群是 `initdb -U proxy` 建的，
-- 那里的 proxy 是**超级用户**，而超级用户绕过 RLS。所以
-- TestMediaReviewDecisionPostgresLifecycle 一直是绿的，它测的权限模型和真实部署
-- 不是一回事。同理，本地库的属主漂移（见下）在临时集群里也不会出现。
--
-- 修法：给应用角色补 **SELECT + INSERT** policy，**不加** UPDATE/DELETE policy ——
-- FORCE RLS 下没有写策略就谁也改不了审计行，032 的 append-only 意图反而由 DB 兜住了
-- （owner 也一样改不了）。权限本身不用 GRANT：本仓库 media.* 是 owner-based
-- （media_assets / media_variants 都归 proxy），属主天然有 SELECT/INSERT。
--
-- 同时**显式** ENABLE + FORCE RLS：032/035/042 的那三段 RLS 都挂在
-- `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_operator')` 下，
-- 而**没有任何迁移创建 proxy_api_operator**（032 的注释说它「只在 production
-- 由运维手工建」）。于是同一份迁移集在两种环境里跑出两种状态：
--   * 全新集群 / dev-test：proxy_api_operator 不存在 -> 三段全跳过 -> RLS 从未开启，
--     policy 是摆设，表对 owner 完全开放；
--   * 该角色存在的环境（本地库手建过、以及 032 点名的 production）-> RLS 真的开了，
--     而 INSERT policy 又不存在 -> 写路径静默失效。
-- 显式开启让两种环境收敛到「RLS 开 + 应用角色有 SELECT/INSERT」这一个确定状态，
-- 也让 append-only 由 DB 而不是「代码里没人写 UPDATE」兜住。
--
-- ⚠️ CREATE POLICY 需要表属主（或超级用户）。属主漂移时本迁移**大声失败**，
--    不静默跳过 —— 静默跳过正是这个洞活了这么久的原因。修复动作：
--      ALTER TABLE media.media_review_decisions OWNER TO <应用角色>;
--    （及其各分区），再重跑本迁移。
--    本地库 2026-09-22 的漂移：属主曾是个人 macOS 账号 thanhhuyennguyen，
--    proxy 对这张表 has_table_privilege 全为 false，连 SELECT 都 permission denied。
--
-- 幂等：先探测 pg_policy 再建。

DO $$
DECLARE
    app_role   TEXT     := current_user;
    rel        regclass := 'media.media_review_decisions'::regclass;
    tbl_owner  TEXT;
    is_super   BOOLEAN;
BEGIN
    IF to_regclass('media.media_review_decisions') IS NULL THEN
        RAISE NOTICE '112: media.media_review_decisions 不存在，跳过（由 032/035 负责建）';
        RETURN;
    END IF;

    SELECT pg_get_userbyid(c.relowner) INTO tbl_owner FROM pg_class c WHERE c.oid = rel;
    SELECT COALESCE(rolsuper, false) INTO is_super FROM pg_roles WHERE rolname = app_role;

    IF tbl_owner <> app_role AND NOT COALESCE(is_super, false) THEN
        RAISE EXCEPTION
            '112: 当前角色 % 不是 media.media_review_decisions 的属主（属主是 %），'
            '无法 CREATE POLICY。属主漂移会让应用角色连审计行都读不到'
            '（FORCE RLS + 零适用 policy = 静默 0 行）。'
            '先在属主角色上执行 ALTER TABLE media.media_review_decisions OWNER TO %;'
            '（含各分区），再重跑本迁移。',
            app_role, tbl_owner, app_role;
    END IF;

    -- 确定性：不管 proxy_api_operator 在不在，这张审计表的 RLS 状态都一致。
    EXECUTE 'ALTER TABLE media.media_review_decisions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE media.media_review_decisions FORCE ROW LEVEL SECURITY';

    IF NOT EXISTS (
        SELECT 1 FROM pg_policy WHERE polrelid = rel AND polname = 'media_review_decisions_select_app'
    ) THEN
        EXECUTE format(
            'CREATE POLICY media_review_decisions_select_app ON media.media_review_decisions FOR SELECT TO %I USING (true)',
            app_role);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policy WHERE polrelid = rel AND polname = 'media_review_decisions_insert_app'
    ) THEN
        -- WITH CHECK 只钉一件事实：每条审计行都要指名一个 operator。
        -- 仓库侧本来就校验过（AppendReviewDecision 拒绝空 OperatorID）。
        EXECUTE format(
            'CREATE POLICY media_review_decisions_insert_app ON media.media_review_decisions FOR INSERT TO %I WITH CHECK (operator_id <> '''')',
            app_role);
    END IF;
END
$$;

COMMENT ON TABLE media.media_review_decisions IS
    'R15.18+042: partitioned by RANGE (reviewed_at) monthly, append-only audit trail. FORCE RLS is deliberate: the app role gets SELECT + INSERT only (112), so no role — not even the owner — can UPDATE/DELETE an audit row.';

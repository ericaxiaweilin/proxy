-- 173_notification_inbox_isolation.sql
--
-- MERCHANT-CREATOR-NOTIFY-001：把收件箱与设备令牌的隔离**下沉到数据库**。
--
-- 之前这两张表的隔离只存在于 Go 的一层 WHERE 里
-- （platform/postgres/notification.go 每个方法都自带 recipient_id 条件）。
-- 那是「自觉」而不是「约束」：任何新写的 SQL、任何漏掉 WHERE 的查询、
-- 任何未来绕过 Repository 的脚本，都能读到别人的收件箱 —— 而收件箱里装的是
-- 「订单已成立」「收到 Offer」这类**平台自己说的话**，读到别人的不只是隐私，
-- 还等于拿到一条可以被伪造的正文（内部通知常被当成可信渠道）。
--
-- 隔离键用仓库既有的 proxy.* GUC 约定（见 fulfillment.go 的 proxy.audit_principal
-- 等 set_config(..., true)）：每个方法在事务里先声明「我这次是为哪个收件人/哪个
-- 用户账号操作」，policy 只认这个声明。
--
-- **fail-closed 是刻意的**：GUC 没设 ⇒ current_setting 返回 NULL ⇒
-- policy 表达式为 NULL（不为真）⇒ 读 0 行、写被拒。
-- 反过来（没设就当超级用户放行）会让「忘了设 GUC」变成静默的越权，
-- 那比 0 行难查一百倍。
--
-- 幂等：先探测 pg_policy 再建；GRANT/REVOKE 都是可重复的。
--
-- ⚠️ CREATE POLICY 需要表属主（或超级用户）。属主漂移时本迁移**大声失败**。
--    修复：ALTER TABLE notification.inbox_items OWNER TO <应用角色>;
--          ALTER TABLE notification.device_tokens OWNER TO <应用角色>;
--
-- 为什么 FORCE：应用角色 proxy 正是这两张表的**属主**，而表属主默认绕过 RLS。
-- 只 ENABLE 不 FORCE 等于给属主开后门 —— 本仓库的应用连接用的就是属主
-- （.env 的 DATABASE_URL=postgres://proxy@localhost/proxy），所以 FORCE 不是
-- 可选项，是这条迁移能不能生效的前提。

DO $$
DECLARE
    app_role   TEXT     := current_user;
    is_super   BOOLEAN;
    tbl        TEXT;
    owner_of   TEXT;
BEGIN
    SELECT COALESCE(rolsuper, false) INTO is_super FROM pg_roles WHERE rolname = app_role;

    FOREACH tbl IN ARRAY ARRAY['notification.inbox_items', 'notification.device_tokens'] LOOP
        IF to_regclass(tbl) IS NULL THEN
            RAISE NOTICE '173: % 不存在，跳过（由 021 负责建）', tbl;
            CONTINUE;
        END IF;

        SELECT pg_get_userbyid(c.relowner) INTO owner_of
        FROM pg_class c WHERE c.oid = tbl::regclass;

        IF owner_of <> app_role AND NOT COALESCE(is_super, false) THEN
            RAISE EXCEPTION
                '173: 当前角色 % 不是 % 的属主（属主是 %），无法 CREATE POLICY。'
                '先执行 ALTER TABLE % OWNER TO %; 再重跑本迁移。',
                app_role, tbl, owner_of, tbl, app_role;
        END IF;

        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);

        -- inbox_items：全仓没有任何删除它的代码路径，而仓库铁律是「数据永不按
        -- 代码删除」⇒ 把纪律变成约束。**注意**这也是个隐私缺口（账户删除不清
        -- 收件箱），但那是行为变更，不在这次隔离改造里偷偷做。
        IF tbl = 'notification.inbox_items' THEN
            EXECUTE format('REVOKE DELETE ON %s FROM %I', tbl, app_role);
        END IF;
    END LOOP;

    -- ── inbox_items：收件人级隔离 ───────────────────────────────────────────
    IF to_regclass('notification.inbox_items') IS NOT NULL THEN
        EXECUTE format('REVOKE UPDATE ON notification.inbox_items FROM %I', app_role);
        -- 只允许改 read 一个列：标题/正文/深链/收件人是投递的事实，落地后不该被改。
        EXECUTE format('GRANT UPDATE (read) ON notification.inbox_items TO %I', app_role);
        EXECUTE format('GRANT SELECT, INSERT ON notification.inbox_items TO %I', app_role);

        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.inbox_items'::regclass
                       AND polname = 'inbox_items_select_own_recipient') THEN
            EXECUTE format(
                'CREATE POLICY inbox_items_select_own_recipient ON notification.inbox_items '
                'FOR SELECT TO %I USING (recipient_id = current_setting(''proxy.recipient_id'', true))', app_role);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.inbox_items'::regclass
                       AND polname = 'inbox_items_insert_own_recipient') THEN
            EXECUTE format(
                'CREATE POLICY inbox_items_insert_own_recipient ON notification.inbox_items '
                'FOR INSERT TO %I WITH CHECK (recipient_id = current_setting(''proxy.recipient_id'', true))', app_role);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.inbox_items'::regclass
                       AND polname = 'inbox_items_update_own_recipient') THEN
            EXECUTE format(
                'CREATE POLICY inbox_items_update_own_recipient ON notification.inbox_items '
                'FOR UPDATE TO %I USING (recipient_id = current_setting(''proxy.recipient_id'', true)) '
                'WITH CHECK (recipient_id = current_setting(''proxy.recipient_id'', true))', app_role);
        END IF;
    END IF;

    -- ── device_tokens：用户账号级隔离 ───────────────────────────────────────
    IF to_regclass('notification.device_tokens') IS NOT NULL THEN
        -- DELETE 在这张表上是**必须**给的：privacy_cross_aggregate.go 的
        -- EraseCrossAggregateIdentity 靠它清掉推送令牌（注释里写明这是
        -- 真 DELETE，不是账务记录）。抽掉这个权限，账户删除会「成功」但令牌
        -- 一行没删，平台继续往已注销账号的设备推 —— 一个假装成功的合规路径
        -- 比没有更糟。收窄靠 RLS 的 USING 条件，不靠缺权限。
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON notification.device_tokens TO %I', app_role);

        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.device_tokens'::regclass
                       AND polname = 'device_tokens_select_own_account') THEN
            EXECUTE format(
                'CREATE POLICY device_tokens_select_own_account ON notification.device_tokens '
                'FOR SELECT TO %I USING (user_account_id = current_setting(''proxy.user_account_id'', true))', app_role);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.device_tokens'::regclass
                       AND polname = 'device_tokens_insert_own_account') THEN
            EXECUTE format(
                'CREATE POLICY device_tokens_insert_own_account ON notification.device_tokens '
                'FOR INSERT TO %I WITH CHECK (user_account_id = current_setting(''proxy.user_account_id'', true))', app_role);
        END IF;
        -- DELETE 也要有 policy：RLS 是**按命令**判的，只建 SELECT/INSERT/UPDATE
        -- 的话 DELETE 一律被拒 —— 账户删除那一步会「删不掉却返回成功」。
        -- 这条 policy 就是隐私擦除路径唯一的收窄：只准删自己 user_account_id 的行。
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.device_tokens'::regclass
                       AND polname = 'device_tokens_delete_own_account') THEN
            EXECUTE format(
                'CREATE POLICY device_tokens_delete_own_account ON notification.device_tokens '
                'FOR DELETE TO %I USING (user_account_id = current_setting(''proxy.user_account_id'', true))', app_role);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification.device_tokens'::regclass
                       AND polname = 'device_tokens_update_own_account') THEN
            EXECUTE format(
                'CREATE POLICY device_tokens_update_own_account ON notification.device_tokens '
                'FOR UPDATE TO %I USING (user_account_id = current_setting(''proxy.user_account_id'', true)) '
                'WITH CHECK (user_account_id = current_setting(''proxy.user_account_id'', true))', app_role);
        END IF;
    END IF;
END
$$;

COMMENT ON TABLE notification.inbox_items IS
    '173: RLS 隔离下沉到 DB。读写都必须先在事务里 set_config(''proxy.recipient_id'', <recipient>, true)；GUC 未设 ⇒ 读 0 行 / 写被拒（fail-closed）。DELETE 未授权；UPDATE 仅限 read 列。';
COMMENT ON TABLE notification.device_tokens IS
    '172 允许 status=''INACTIVE''；173: RLS 隔离下沉到 DB，读写删须先 set_config(''proxy.user_account_id'', <uid>, true)（fail-closed）。DELETE 仅供 EraseCrossAggregateIdentity 用，隔离靠 USING 条件而不是缺权限。';

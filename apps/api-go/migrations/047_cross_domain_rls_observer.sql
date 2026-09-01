-- 047_cross_domain_rls_observer.sql — BI 跨域只读加固（R15.20 遗留“其他 RLS policy 加固”）
-- 为 observer 角色（只读 BI）开放 scene / contribution / supply 读，禁止写

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_observer') THEN
        -- scene
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='scene' AND tablename='scenes') THEN
            EXECUTE 'ALTER TABLE scene.scenes ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE scene.scenes FORCE ROW LEVEL SECURITY';
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='scene_scenes_select_observer' AND polrelid='scene.scenes'::regclass) THEN
                CREATE POLICY scene_scenes_select_observer ON scene.scenes FOR SELECT TO proxy_api_observer USING (true);
            END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='scene' AND tablename='invitations') THEN
            EXECUTE 'ALTER TABLE scene.invitations ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE scene.invitations FORCE ROW LEVEL SECURITY';
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='scene_invitations_select_observer' AND polrelid='scene.invitations'::regclass) THEN
                CREATE POLICY scene_invitations_select_observer ON scene.invitations FOR SELECT TO proxy_api_observer USING (true);
            END IF;
        END IF;
        -- contribution
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='contribution' AND tablename='contributions') THEN
            EXECUTE 'ALTER TABLE contribution.contributions ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE contribution.contributions FORCE ROW LEVEL SECURITY';
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='contribution_select_observer' AND polrelid='contribution.contributions'::regclass) THEN
                CREATE POLICY contribution_select_observer ON contribution.contributions FOR SELECT TO proxy_api_observer USING (true);
            END IF;
        END IF;
        -- supply
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='supply' AND tablename='agent_profiles') THEN
            EXECUTE 'ALTER TABLE supply.agent_profiles ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE supply.agent_profiles FORCE ROW LEVEL SECURITY';
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='supply_profiles_select_observer' AND polrelid='supply.agent_profiles'::regclass) THEN
                CREATE POLICY supply_profiles_select_observer ON supply.agent_profiles FOR SELECT TO proxy_api_observer USING (true);
            END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='supply' AND tablename='availability_windows') THEN
            EXECUTE 'ALTER TABLE supply.availability_windows ENABLE ROW LEVEL SECURITY';
            EXECUTE 'ALTER TABLE supply.availability_windows FORCE ROW LEVEL SECURITY';
            IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='supply_availability_select_observer' AND polrelid='supply.availability_windows'::regclass) THEN
                CREATE POLICY supply_availability_select_observer ON supply.availability_windows FOR SELECT TO proxy_api_observer USING (true);
            END IF;
        END IF;
        -- grant usage/select (idempotent)
        GRANT USAGE ON SCHEMA scene TO proxy_api_observer;
        GRANT SELECT ON ALL TABLES IN SCHEMA scene TO proxy_api_observer;
        GRANT USAGE ON SCHEMA contribution TO proxy_api_observer;
        GRANT SELECT ON ALL TABLES IN SCHEMA contribution TO proxy_api_observer;
        GRANT USAGE ON SCHEMA supply TO proxy_api_observer;
        GRANT SELECT ON ALL TABLES IN SCHEMA supply TO proxy_api_observer;
    END IF;
END
$$;

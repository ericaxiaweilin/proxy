-- Recover from filesystem duplicate files ("name 2.sql") that were briefly
-- interpreted as new migrations. Remove only those accidental history rows and
-- reassert the least-privilege observer boundary after the duplicated old 047.
-- Guarded: the test harness applies raw .sql files with no migrator bookkeeping
-- table, so this must no-op when public.schema_migrations is absent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'schema_migrations') THEN
    DELETE FROM public.schema_migrations WHERE version ~ ' 2$';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proxy_api_observer') THEN
    REVOKE ALL ON scene.scenes, scene.invitations FROM proxy_api_observer;
    REVOKE ALL ON contribution.contributions FROM proxy_api_observer;
    REVOKE ALL ON supply.agent_profiles, supply.availability_windows FROM proxy_api_observer;
    REVOKE ALL ON media.media_assets, media.media_review_decisions FROM proxy_api_observer;
    REVOKE ALL ON localnet.posts FROM proxy_api_observer;

    DROP POLICY IF EXISTS scene_scenes_select_observer ON scene.scenes;
    DROP POLICY IF EXISTS scene_invitations_select_observer ON scene.invitations;
    DROP POLICY IF EXISTS contribution_select_observer ON contribution.contributions;
    DROP POLICY IF EXISTS supply_profiles_select_observer ON supply.agent_profiles;
    DROP POLICY IF EXISTS supply_availability_select_observer ON supply.availability_windows;
    DROP POLICY IF EXISTS media_review_decisions_select_observer ON media.media_review_decisions;

    GRANT USAGE ON SCHEMA scene, contribution, supply, media, localnet TO proxy_api_observer;
    GRANT SELECT ON scene.observer_scene_daily TO proxy_api_observer;
    GRANT SELECT ON contribution.observer_contribution_daily TO proxy_api_observer;
    GRANT SELECT ON supply.observer_availability_daily, supply.observer_profile_status TO proxy_api_observer;
    GRANT SELECT ON media.observer_asset_daily TO proxy_api_observer;
    GRANT SELECT ON localnet.observer_post_daily TO proxy_api_observer;
  END IF;
END
$$;

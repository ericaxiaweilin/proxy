-- BI observers receive aggregate, non-identifying projections only.
-- Raw invitations, contributor IDs, profiles and availability are forbidden.

CREATE OR REPLACE VIEW scene.observer_scene_daily
WITH (security_barrier = true) AS
SELECT date_trunc('day', starts_at) AS service_day,
       COALESCE(city_scope, 'UNSPECIFIED') AS city_scope,
       status, count(*)::bigint AS scene_count,
       COALESCE(sum(capacity_min), 0)::bigint AS minimum_capacity,
       COALESCE(sum(capacity_max), 0)::bigint AS maximum_capacity
FROM scene.scenes
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW contribution.observer_contribution_daily
WITH (security_barrier = true) AS
SELECT date_trunc('day', submitted_at) AS submitted_day,
       contribution_type, state,
       count(*)::bigint AS contribution_count,
       COALESCE(sum(reward_vnd), 0)::bigint AS reward_vnd
FROM contribution.contributions
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW supply.observer_availability_daily
WITH (security_barrier = true) AS
SELECT date_trunc('day', start_at) AS service_day,
       market_id, status, count(*)::bigint AS window_count,
       COALESCE(sum(EXTRACT(EPOCH FROM (end_at - start_at)) / 60), 0)::bigint AS available_minutes
FROM supply.availability_windows
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW supply.observer_profile_status
WITH (security_barrier = true) AS
SELECT status, count(*)::bigint AS profile_count
FROM supply.agent_profiles
GROUP BY status;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_observer') THEN
    GRANT USAGE ON SCHEMA scene, contribution, supply TO proxy_api_observer;

    -- Defense in depth if a manual raw-table grant already exists.
    REVOKE ALL ON scene.scenes, scene.invitations FROM proxy_api_observer;
    REVOKE ALL ON contribution.contributions FROM proxy_api_observer;
    REVOKE ALL ON supply.agent_profiles, supply.availability_windows FROM proxy_api_observer;

    GRANT SELECT ON scene.observer_scene_daily TO proxy_api_observer;
    GRANT SELECT ON contribution.observer_contribution_daily TO proxy_api_observer;
    GRANT SELECT ON supply.observer_availability_daily, supply.observer_profile_status TO proxy_api_observer;
  END IF;
END
$$;

COMMENT ON VIEW scene.observer_scene_daily IS 'Non-identifying daily scene metrics for BI observers.';
COMMENT ON VIEW contribution.observer_contribution_daily IS 'Non-identifying daily contribution metrics for BI observers.';
COMMENT ON VIEW supply.observer_availability_daily IS 'Non-identifying daily availability metrics for BI observers.';
COMMENT ON VIEW supply.observer_profile_status IS 'Non-identifying supply profile status totals for BI observers.';

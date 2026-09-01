-- BI observers receive metrics, never user content, storage locations,
-- operator notes or principal identifiers.

CREATE OR REPLACE VIEW media.observer_asset_daily
WITH (security_barrier = true) AS
SELECT date_trunc('day', created_at) AS created_day,
       owner_principal_type, media_type, processing_status,
       moderation_status, visibility_class,
       count(*)::bigint AS asset_count,
       COALESCE(sum(source_bytes), 0)::bigint AS source_bytes
FROM media.media_assets
GROUP BY 1, 2, 3, 4, 5, 6;

CREATE OR REPLACE VIEW localnet.observer_post_daily
WITH (security_barrier = true) AS
SELECT date_trunc('day', created_at) AS created_day,
       author_type, visibility, status,
       count(*)::bigint AS post_count,
       count(*) FILTER (WHERE jsonb_array_length(media_refs) > 0)::bigint AS posts_with_media
FROM localnet.posts
GROUP BY 1, 2, 3, 4;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_observer') THEN
    REVOKE ALL ON media.media_assets, media.media_review_decisions FROM proxy_api_observer;
    REVOKE ALL ON localnet.posts FROM proxy_api_observer;

    DROP POLICY IF EXISTS media_review_decisions_select_observer
      ON media.media_review_decisions;

    GRANT USAGE ON SCHEMA media, localnet TO proxy_api_observer;
    GRANT SELECT ON media.observer_asset_daily TO proxy_api_observer;
    GRANT SELECT ON localnet.observer_post_daily TO proxy_api_observer;
  END IF;
END
$$;

COMMENT ON VIEW media.observer_asset_daily IS 'Anonymous media lifecycle metrics; excludes storage URLs and owners.';
COMMENT ON VIEW localnet.observer_post_daily IS 'Anonymous post metrics; excludes body, author identity and media references.';

-- The post_media table is a derived projection maintained by a trigger.
-- Runtime may read it, but must not be able to forge or delete projection rows.

CREATE OR REPLACE FUNCTION localnet.sync_post_media_projection() RETURNS trigger AS $$
BEGIN
    DELETE FROM localnet.post_media WHERE post_id = NEW.id;
    INSERT INTO localnet.post_media (post_id, media_asset_id, sort_order, alt_text, created_at)
    SELECT NEW.id,
           item->>'mediaAssetId',
           COALESCE((item->>'sortOrder')::INT, ordinal - 1),
           COALESCE(item->>'altText', ''),
           NEW.created_at
    FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(NEW.media_refs) = 'array' THEN NEW.media_refs ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS refs(item, ordinal)
    JOIN media.media_assets m ON m.media_asset_id = item->>'mediaAssetId'
    WHERE COALESCE(item->>'mediaAssetId', '') <> '';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, localnet, media;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proxy') THEN
    GRANT USAGE ON SCHEMA localnet TO proxy;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON localnet.post_media FROM proxy;
    GRANT SELECT ON localnet.post_media TO proxy;
  END IF;
END
$$;

COMMENT ON FUNCTION localnet.sync_post_media_projection() IS
  'Trusted trigger projection: runtime edits posts; this function alone maintains post_media.';

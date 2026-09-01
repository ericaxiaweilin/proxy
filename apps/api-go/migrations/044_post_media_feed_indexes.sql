-- Feed Data Plane v2 query projection.
--
-- Post/media truth remains localnet.posts.media_refs for compatibility. This
-- relation is a normalized read projection that can be rebuilt from that
-- source and lets later feed/media queries avoid JSON scans.

CREATE TABLE IF NOT EXISTS localnet.post_media (
    post_id TEXT NOT NULL REFERENCES localnet.posts(id) ON DELETE CASCADE,
    media_asset_id TEXT NOT NULL REFERENCES media.media_assets(media_asset_id),
    sort_order INT NOT NULL,
    alt_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, media_asset_id),
    UNIQUE (post_id, sort_order),
    CHECK (sort_order >= 0),
    CHECK (char_length(alt_text) <= 500)
);

INSERT INTO localnet.post_media (post_id, media_asset_id, sort_order, alt_text, created_at)
SELECT p.id,
       item->>'mediaAssetId',
       COALESCE((item->>'sortOrder')::INT, ordinal - 1),
       COALESCE(item->>'altText', ''),
       p.created_at
FROM localnet.posts p
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.media_refs) = 'array' THEN p.media_refs ELSE '[]'::jsonb END
) WITH ORDINALITY AS refs(item, ordinal)
JOIN media.media_assets m ON m.media_asset_id = item->>'mediaAssetId'
WHERE COALESCE(item->>'mediaAssetId', '') <> ''
ON CONFLICT DO NOTHING;

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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_media_projection ON localnet.posts;
CREATE TRIGGER trg_posts_media_projection
    AFTER INSERT OR UPDATE OF media_refs ON localnet.posts
    FOR EACH ROW EXECUTE FUNCTION localnet.sync_post_media_projection();

CREATE INDEX IF NOT EXISTS idx_posts_feed_keyset
    ON localnet.posts (created_at DESC, id DESC)
    WHERE status = 'PUBLISHED';

CREATE INDEX IF NOT EXISTS idx_posts_feed_city_keyset
    ON localnet.posts (lower(btrim(city_scope)), created_at DESC, id DESC)
    WHERE status = 'PUBLISHED';

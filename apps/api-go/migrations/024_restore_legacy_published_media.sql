-- Restore media produced by the pre-moderation P0 pipeline. These assets were
-- technically processed and attached to an already-published PUBLIC post, but
-- remained OWNER_ONLY/PENDING after the approval gate was introduced. New
-- uploads are unaffected and continue through the normal moderation lifecycle.
UPDATE media.media_assets AS asset
SET moderation_status = 'APPROVED',
    visibility_class = 'PUBLIC',
    updated_at = NOW()
WHERE asset.processing_status = 'READY'
  AND asset.moderation_status = 'PENDING'
  AND asset.visibility_class = 'OWNER_ONLY'
  AND EXISTS (
    SELECT 1
    FROM localnet.posts AS post
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(post.media_refs) = 'array' THEN post.media_refs ELSE '[]'::jsonb END
    ) AS ref
    WHERE post.status = 'PUBLISHED'
      AND post.visibility = 'PUBLIC'
      AND ref->>'mediaAssetId' = asset.media_asset_id
  );

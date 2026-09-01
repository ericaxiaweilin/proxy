-- R15.28: bounded feed reads and edge-read preparation.
-- The canonical order is newest first with post id as a deterministic tie-break.
CREATE INDEX IF NOT EXISTS idx_posts_public_time_cursor
    ON localnet.posts (created_at DESC, id ASC)
    WHERE status = 'PUBLISHED' AND visibility = 'PUBLIC';

CREATE INDEX IF NOT EXISTS idx_posts_author_time_cursor
    ON localnet.posts (author_id, created_at DESC, id ASC)
    WHERE status = 'PUBLISHED';

CREATE INDEX IF NOT EXISTS idx_media_variants_asset_ready
    ON media.media_variants (media_asset_id, purpose)
    WHERE status = 'READY';

COMMENT ON INDEX localnet.idx_posts_public_time_cursor IS
    'Stable public timeline cursor index; location is intentionally not part of feed eligibility.';

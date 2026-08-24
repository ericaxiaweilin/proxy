-- Social Media Pipeline R1: immutable source metadata + purpose-specific variants.
ALTER TABLE media.media_assets
    ADD COLUMN IF NOT EXISTS source_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS orientation SMALLINT,
    ADD COLUMN IF NOT EXISTS color_space TEXT,
    ADD COLUMN IF NOT EXISTS has_alpha BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS animated BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS visibility_class TEXT NOT NULL DEFAULT 'OWNER_ONLY';

CREATE TABLE IF NOT EXISTS media.media_variants (
    media_variant_id TEXT PRIMARY KEY,
    media_asset_id TEXT NOT NULL REFERENCES media.media_assets(media_asset_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    recipe_version TEXT NOT NULL,
    format TEXT NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    bytes BIGINT,
    storage_key TEXT NOT NULL,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'PROCESSING',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (media_asset_id, purpose, recipe_version),
    CHECK (purpose IN ('ORIGINAL','FEED_1X','FEED_2X','GALLERY','SHARE_OG','PLACEHOLDER')),
    CHECK (status IN ('PROCESSING','READY','FAILED','REMOVED')),
    CHECK (width >= 0 AND height >= 0)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_asset
    ON media.media_variants (media_asset_id, purpose, recipe_version);


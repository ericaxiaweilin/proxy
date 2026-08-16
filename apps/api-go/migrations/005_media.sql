-- Proxy media schema（PRD Chapter06A §9-12：普通视频 P0）
CREATE SCHEMA IF NOT EXISTS media;

CREATE TABLE IF NOT EXISTS media.media_assets (
    media_asset_id TEXT PRIMARY KEY,
    owner_principal_type TEXT NOT NULL,
    owner_principal_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    original_storage_key TEXT NOT NULL,
    playback_storage_key TEXT,
    thumbnail_storage_key TEXT,
    mime_type TEXT,
    width INT,
    height INT,
    duration_ms BIGINT,
    codec TEXT,
    processing_status TEXT NOT NULL DEFAULT 'UPLOADING',
    playback_url TEXT,
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_owner ON media.media_assets (owner_principal_id, created_at DESC);

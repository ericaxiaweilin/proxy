-- Durable media processing jobs. Upload completion and job creation happen in
-- the same command transaction; workers lease rows with SKIP LOCKED and stale
-- leases are recoverable after a crash or deploy.
CREATE TABLE IF NOT EXISTS media.processing_jobs (
    job_id TEXT PRIMARY KEY,
    media_asset_id TEXT NOT NULL REFERENCES media.media_assets(media_asset_id) ON DELETE CASCADE,
    recipe_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL,
    worker_id TEXT,
    processing_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (media_asset_id, recipe_version),
    CHECK (status IN ('PENDING','PROCESSING','FAILED','COMPLETED','DEAD_LETTER')),
    CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_media_processing_jobs_claim
    ON media.processing_jobs (status, available_at, created_at);

-- R36.x MENU-001: store/album photos go through the media pipeline so
-- they are remotely viewable (thumb/play URLs), not local-only paths.
-- Both tables predate this migration (038 + 073); only add columns.
ALTER TABLE business.store_photos ADD COLUMN IF NOT EXISTS media_asset_id TEXT NOT NULL DEFAULT '';
ALTER TABLE business.store_products ADD COLUMN IF NOT EXISTS media_asset_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS business_photos_media_idx ON business.store_photos(media_asset_id) WHERE media_asset_id <> '';
CREATE INDEX IF NOT EXISTS business_products_media_idx ON business.store_products(media_asset_id) WHERE media_asset_id <> '';

-- Separate transport processing from content moderation and admit first-party
-- platform media as a real principal type.

ALTER TABLE media.media_assets
  DROP CONSTRAINT IF EXISTS media_asset_owner_type_check;
ALTER TABLE media.media_assets
  ADD CONSTRAINT media_asset_owner_type_check
  CHECK (owner_principal_type IN ('INDIVIDUAL','BUSINESS','PLATFORM'));

-- Legacy rows used QUARANTINED in both state columns. With no playback object,
-- these assets are incomplete uploads; quarantine remains in moderation_status.
UPDATE media.media_assets
SET processing_status = 'UPLOADING', updated_at = NOW()
WHERE processing_status = 'QUARANTINED'
  AND moderation_status = 'QUARANTINED'
  AND COALESCE(playback_url, '') = '';

ALTER TABLE media.media_assets
  DROP CONSTRAINT IF EXISTS media_asset_processing_status_check;
ALTER TABLE media.media_assets
  ADD CONSTRAINT media_asset_processing_status_check
  CHECK (processing_status IN ('UPLOADING','PROCESSING','READY','FAILED'));

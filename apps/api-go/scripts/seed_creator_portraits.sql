-- seed_creator_portraits.sql
-- IDENTITY-ID-001 第 3 步数据面：把 mock Creator 头像落成媒体资产（不分散在 photos 外链里），
-- 并回填账号 profile 的 avatar_path，使「同一个人的头像」只有一处事实源：
--   identity.profiles.avatar_path = assets/<mediaAssetId> → 公开路由 /v1/media/thumb/<id>
-- 幂等：可重复执行。文件需已存在于 media store（见同目录 README 说明的抓取步骤）。

BEGIN;

INSERT INTO media.media_assets (
  media_asset_id, owner_principal_type, owner_principal_id, media_type,
  original_storage_key, playback_storage_key, thumbnail_storage_key,
  mime_type, width, height, processing_status, moderation_status, visibility_class,
  created_at, updated_at
)
SELECT 'ma_creator_' || suffix || '_portrait_v1',
       'INDIVIDUAL',
       'user_mockcreator_' || suffix,
       'IMAGE',
       'creator_' || suffix || '_portrait_v1.jpg',
       'creator_' || suffix || '_portrait_v1.jpg',
       'creator_' || suffix || '_portrait_v1.jpg',
       'image/jpeg', 128, 128, 'READY', 'APPROVED', 'PUBLIC', now(), now()
FROM (VALUES ('linh'), ('mai'), ('an'), ('thao'), ('yen'), ('minh'), ('trang')) AS t(suffix)
ON CONFLICT (media_asset_id) DO UPDATE
  SET original_storage_key  = EXCLUDED.original_storage_key,
      playback_storage_key  = EXCLUDED.playback_storage_key,
      thumbnail_storage_key = EXCLUDED.thumbnail_storage_key,
      processing_status     = 'READY',
      moderation_status     = 'APPROVED',
      visibility_class      = 'PUBLIC',
      updated_at            = now();

UPDATE identity.profiles p
   SET avatar_path = 'assets/ma_creator_' || replace(p.user_account_id, 'user_mockcreator_', '') || '_portrait_v1',
       updated_at  = now()
 WHERE p.user_account_id LIKE 'user_mockcreator_%';

COMMIT;

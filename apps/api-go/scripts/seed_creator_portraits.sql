-- seed_creator_portraits.sql
-- IDENTITY-ID-001 第 3 步数据面：把 mock Creator 头像落成媒体资产（不分散在 photos 外链里），
-- 并回填账号 profile 的 avatar_path，使「同一个人的头像」只有一处事实源：
--   identity.profiles.avatar_path = assets/<mediaAssetId> → 公开路由 /v1/media/thumb/<id>
-- 幂等：可重复执行。文件需已存在于 media store（见同目录 README 说明的抓取步骤）。
-- 2026-09-19：hana / nam 转正（F组单人正脸，已验非同一人）。两人此前没有
-- identity 行，下面连 profile 一起建（INSERT … WHERE NOT EXISTS），此后与
-- 另外 7 个走同一套回填；文件 creator_hana/nam_portrait_v1.jpg 同步进 store。
-- 2026-09-22 修：上面那句「identity 行」当时只兑现了 profile，漏了
-- identity.user_accounts —— trang / hana / nam 三个键因此指向不存在的账号。
-- 本文件现在两样都建（见 ACCOUNT-FOR-AVATAR-KEY-001 那段）。

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
FROM (VALUES ('linh'), ('mai'), ('an'), ('thao'), ('yen'), ('minh'), ('trang'), ('hana'), ('nam')) AS t(suffix)
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

-- ACCOUNT-FOR-AVATAR-KEY-001（2026-09-22 修）：recommend-fixtures 的
-- ACCOUNT_AVATAR_ASSET 一旦列出某个 u_ 键，就等于宣称「服务端有账号」——
-- resolveHomePersonAccountId 会把它映射到 user_mockcreator_<key>，好友申请 /
-- 关注 / 会话都按那个 id 落库。此前只建了 media 资产和 profile，没建
-- identity.user_accounts，于是 trang / hana / nam 三个键指向不存在的账号：
-- 好友申请落成幽灵 id（永远没有真人能点同意），device_registrations 的 FK 也会拒。
-- 三个键必须在 user_accounts 里存在，与上面 media 资产的 9 个 suffix 对齐。
INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
SELECT 'user_mockcreator_' || suffix, 'REGISTERED', now(), now()
  FROM (VALUES ('trang'), ('hana'), ('nam')) AS t(suffix)
 WHERE NOT EXISTS (SELECT 1 FROM identity.user_accounts ua
                    WHERE ua.id = 'user_mockcreator_' || t.suffix);

-- trang / hana / nam 此前没有 profile 行（关注/会话/主页会落到幽灵 id），先建后回填。
-- 名字与首页 fixture 卡片一致（Trang / Hana / Nam），handle 沿 creator_ 前缀，
-- bio 同样取 fixture 卡片上那一句，不再另编。
INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
SELECT 'user_mockcreator_' || suffix,
       initcap(suffix),
       'creator_' || suffix,
       CASE suffix
         WHEN 'trang' THEN 'Cà phê sữa đá / 河内老店'
         WHEN 'hana'  THEN '日系清新 / 自然光'
         ELSE 'Sony / 夜景 / 城市爬楼'
       END,
       'Hanoi',
       'assets/ma_creator_' || suffix || '_portrait_v1',
       1, now()
  FROM (VALUES ('trang'), ('hana'), ('nam')) AS t(suffix)
 WHERE NOT EXISTS (SELECT 1 FROM identity.profiles p WHERE p.user_account_id = 'user_mockcreator_' || t.suffix);

COMMIT;

-- seed_dev_shops_users.sql
--
-- DEV-ONLY 开发种子：**30 家真实店铺 + 100 个用户**（Hà Nội + Bắc Ninh，
-- 咖啡店 + 餐厅）。后期整体删除，见配套的 seed_dev_shops_users_remove.sql。
--
-- ⚠️ 本文件由 apps/api-go/scripts/mockdata/gen_mockdata.py 生成。
--    要改数据请改 mockdata/spec.py，然后重跑生成器；直接改这里会被下一次生成覆盖。
--
-- ## 数据来源与边界（重要，别照着扩散）
--
-- 店铺用**真实公开信息**：店名、街道地址、行政区、品类都取自公开的越南本地生活
-- 平台与旅游指南（Foody.vn / PasGo / toplist.vn / wheretarawent.com / travelviet.net
-- 等公开页面）。这些是**事实性公开信息**（营业地址不是谁的版权）。
--
-- 但**用户是合成的**，不是从网上扒的真实个人：越南姓名风格 + 真实行政区，
-- 身份一律 `user_devseed_*` 前缀。理由不是版权 —— 是个人数据。越南
-- Nghị định 13/2023/NĐ-CP 把姓名/账号/画像当个人数据管，而这个项目自己在做
-- LC-15 隐私中心；往库里灌 100 个真实人的资料会跟自己的合规目标打架。
--
-- ## 三件**故意不做**的事（都有人踩过，别"顺手补上"）
--
-- 1. **不建 business.store_lines**。营业时间 / wifi / 空调温度 / 座位数是
--    「商家自己页面上一个月采一次」的数据，全仓没有生产者。给一家真实存在的店
--    编一条「免费 wifi、24°C、安静」，是在断言一个我们并不知道的事实。
--    seed_threebeans_bn.sql 当年就是因此故意不写 menu/facilities（"编出来会坑到
--    真人"）。这里沿用同一决定。
-- 2. **不建 reality.scenes，reality_scene_id 一律留空**。reality.scenes 的
--    latitude/longitude 是 NOT NULL，而店铺目录（scene-shop-directory.ts）用坐标
--    算「1.2km / 步行约 15 分钟」。给真实地址编一组坐标会让那些距离全错 —— 比不
--    显示更糟。要挂场景得先拿到真坐标（OSM 查），再走 LinkStoreToRealityScene。
-- 3. **店里的照片是占位图**。store_photos.caption 明确写了「不是本店实拍」——
--    把一张 AI 生成的室内图挂到一家真实店铺的相册里，不写清楚就是拿假图冒充现场。
--
-- ## 为什么单独一个脚本，不进启动种子
--
-- 现有三个启动种子（supply / home rail / media）每次 boot 都灌，属于产品基线。
-- 这批是**临时开发数据**，用户明确说了"后期删除"。塞进 `cmd/api/wire_seed.go`
-- 就得改代码才能删，而 AGENTS.md 规定 app 包只放行为、不放可变业务内容 ——
-- 店铺和用户正是可变业务内容。所以它待在 `scripts/`，一条命令灌、一条命令删。
--
-- ## 幂等：**收敛式 upsert**，不是 insert-if-absent
--
-- 固定 ID + `ON CONFLICT DO UPDATE`，可重复执行，且**跑完必到同一个形状**。
--
-- 这里**故意偏离** AGENTS.md 的 "seed 路径必须 insert-if-absent，绝不 blind
-- overwrite"，理由要说清楚，免得后来人以为写错了：
--
--   · insert-if-absent 的适用对象是**产品基线种子**（boot 时灌的那三个）——
--     那些行的内容属于产品，覆盖等于篡改。
--   · 本文件是**一次性的开发数据**，用户明确说"开发后就删除了"。它存在的唯一
--     意义就是"库里有这么一批可预期的行"。而 2026-09-30 已经有一版旧的
--     devseed 灌进了开发库（20 店 / 30 用户，HCMC 为主）—— 此时 insert-if-absent
--     会让旧行**原样留着**，结果是「一半旧数据 + 一半新数据」，用户 01–30 顶着
--     旧的城市和简介去当河内/北宁店的店主。那种状态比覆盖更难查。
--   · 覆盖范围**只限 devseed_ 前缀的行**，碰不到任何真实数据。
--
-- 所以：跑一次 = 收敛到 spec.py 描述的形状；跑两次 = 同一个形状。
-- 想清空就上 seed_dev_shops_users_remove.sql。
--
-- ⚠️ 时间戳是唯一的例外：帖文的 `created_at` 在冲突时**不更新**（见 posts 文件），
--    否则每次重跑都会把这些帖子的排序位置重洗一遍。
--
-- ## 头像
--
-- 用户 01–30 复用库里已有的 30 个 creator 肖像媒体资产（与
-- seed_creator_portraits.sql 同一套事实源），按顺序 **1:1** 分配 —— 30 张肖像正好
-- 30 个人，不重脸（上一版有 6 组重复）。
-- 用户 31–100 用本批新落的 70 张越南面孔资产 `ma_devseed_<key>_portrait_v1`，
-- 字节在 media store 里（见 mockdata/README.md 的裁剪步骤）。
-- 两批都**不指向不存在的文件** —— 造一批悬空 avatar_path 只会让 UI 出现破图
-- （MEDIA-FILE-001：声称 READY 却没有字节的行，客户端画成黑圈）。
--
-- 执行：psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users.sql

\set ON_ERROR_STOP on

BEGIN;


-- ─────────────────────────────────────────────────────────────────────────────
-- 媒体资产 A：70 张新增头像（用户 31–100）
--
-- 256×256 JPEG，字节在 media store（devseed_<key>_portrait_v1.jpg）。
-- READY + APPROVED + PUBLIC 才能走公开路由 /v1/media/thumb/<id>。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO media.media_assets (
  media_asset_id, owner_principal_type, owner_principal_id, media_type,
  original_storage_key, playback_storage_key, thumbnail_storage_key,
  mime_type, width, height, processing_status, moderation_status, visibility_class,
  ai_generation_source, ai_generated, created_at, updated_at
)
SELECT
  'ma_devseed_' || g.key || '_portrait_v1',
  'INDIVIDUAL',
  'user_devseed_' || g.n::text,
  'IMAGE',
  'devseed_' || g.key || '_portrait_v1.jpg',
  'devseed_' || g.key || '_portrait_v1.jpg',
  'devseed_' || g.key || '_portrait_v1.jpg',
  'image/jpeg', 256, 256, 'READY', 'APPROVED', 'PUBLIC',
  'MODEL_API', true, now(), now()
FROM (VALUES
  (31, 'an_nhien'),
  (32, 'bao_chau'),
  (33, 'bich_ngoc'),
  (34, 'cao_minh'),
  (35, 'chi_lan'),
  (36, 'cong_thanh'),
  (37, 'diep_anh'),
  (38, 'dinh_khoi'),
  (39, 'doan_trang'),
  (40, 'duc_anh'),
  (41, 'gia_bao'),
  (42, 'giang_huong'),
  (43, 'ha_my'),
  (44, 'hai_dang'),
  (45, 'hien_le'),
  (46, 'hoa_ly'),
  (47, 'hoang_nam'),
  (48, 'hong_ngoc'),
  (49, 'huu_phuc'),
  (50, 'khanh_linh'),
  (51, 'kim_ngan'),
  (52, 'lam_giang'),
  (53, 'lan_anh'),
  (54, 'le_quyen'),
  (55, 'linh_dan'),
  (56, 'mai_phuong'),
  (57, 'minh_anh'),
  (58, 'minh_quan'),
  (59, 'my_duyen'),
  (60, 'nam_anh'),
  (61, 'ngoc_han'),
  (62, 'nhat_linh'),
  (63, 'phuc_long'),
  (64, 'phuong_linh'),
  (65, 'quang_huy'),
  (66, 'quynh_mai'),
  (67, 'son_tung'),
  (68, 'tam_nhu'),
  (69, 'thanh_ha'),
  (70, 'thu_ha'),
  (71, 'anh_tuan'),
  (72, 'bao_ngoc'),
  (73, 'cam_tu'),
  (74, 'dieu_linh'),
  (75, 'duc_huy'),
  (76, 'gia_han'),
  (77, 'hai_yen'),
  (78, 'hong_quan'),
  (79, 'hue_chi'),
  (80, 'khac_minh'),
  (81, 'lam_anh'),
  (82, 'linh_chi'),
  (83, 'mai_anh'),
  (84, 'minh_chau'),
  (85, 'ngoc_diep'),
  (86, 'phuong_anh'),
  (87, 'quoc_bao'),
  (88, 'thanh_tung'),
  (89, 'thu_phuong'),
  (90, 'trang_anh'),
  (91, 'tuan_anh'),
  (92, 'van_anh'),
  (93, 'viet_hoang'),
  (94, 'xuan_mai'),
  (95, 'yen_nhi'),
  (96, 'duc_thinh'),
  (97, 'mai_linh'),
  (98, 'quoc_anh'),
  (99, 'thuy_duong'),
  (100, 'van_phuc')
) AS g(n, key)
ON CONFLICT (media_asset_id) DO UPDATE
  SET owner_principal_type  = EXCLUDED.owner_principal_type,
      owner_principal_id    = EXCLUDED.owner_principal_id,
      original_storage_key  = EXCLUDED.original_storage_key,
      playback_storage_key  = EXCLUDED.playback_storage_key,
      thumbnail_storage_key = EXCLUDED.thumbnail_storage_key,
      mime_type             = EXCLUDED.mime_type,
      width                 = EXCLUDED.width,
      height                = EXCLUDED.height,
      processing_status     = EXCLUDED.processing_status,
      moderation_status     = EXCLUDED.moderation_status,
      visibility_class      = EXCLUDED.visibility_class,
      ai_generation_source  = EXCLUDED.ai_generation_source,
      ai_generated          = EXCLUDED.ai_generated,
      updated_at            = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 媒体资产 B：店面占位图（28 张本批生成 + 12 张仓库自带 ai-scenes）
--
-- ⚠️ 这些是 **AI 生成的占位图**，不是任何一家店的现场照片。挂到 store_photos
--    时 caption 必须写明（见文件头第 3 条）。
-- owner 用 PLATFORM：它们是平台提供的开发占位素材，不是商家自己上传的。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO media.media_assets (
  media_asset_id, owner_principal_type, owner_principal_id, media_type,
  original_storage_key, playback_storage_key, thumbnail_storage_key,
  mime_type, width, height, processing_status, moderation_status, visibility_class,
  ai_generation_source, ai_generated, created_at, updated_at
)
SELECT
  g.asset_id,
  'PLATFORM',
  'platform_devseed',
  'IMAGE',
  g.storage_key,
  g.storage_key,
  g.storage_key,
  'image/jpeg', g.w, g.h, 'READY', 'APPROVED', 'PUBLIC',
  'MODEL_API', true, now(), now()
FROM (VALUES
  ('ma_devseed_venue_01', 'devseed_venue_01.jpg', 800, 800),
  ('ma_devseed_venue_02', 'devseed_venue_02.jpg', 800, 800),
  ('ma_devseed_venue_03', 'devseed_venue_03.jpg', 800, 800),
  ('ma_devseed_venue_04', 'devseed_venue_04.jpg', 800, 800),
  ('ma_devseed_venue_05', 'devseed_venue_05.jpg', 800, 800),
  ('ma_devseed_venue_06', 'devseed_venue_06.jpg', 800, 800),
  ('ma_devseed_venue_07', 'devseed_venue_07.jpg', 800, 800),
  ('ma_devseed_venue_08', 'devseed_venue_08.jpg', 800, 800),
  ('ma_devseed_venue_09', 'devseed_venue_09.jpg', 800, 800),
  ('ma_devseed_venue_10', 'devseed_venue_10.jpg', 800, 800),
  ('ma_devseed_venue_11', 'devseed_venue_11.jpg', 800, 800),
  ('ma_devseed_venue_12', 'devseed_venue_12.jpg', 800, 800),
  ('ma_devseed_venue_13', 'devseed_venue_13.jpg', 800, 800),
  ('ma_devseed_venue_14', 'devseed_venue_14.jpg', 800, 800),
  ('ma_devseed_venue_15', 'devseed_venue_15.jpg', 800, 800),
  ('ma_devseed_venue_16', 'devseed_venue_16.jpg', 800, 800),
  ('ma_devseed_venue_17', 'devseed_venue_17.jpg', 800, 800),
  ('ma_devseed_venue_18', 'devseed_venue_18.jpg', 800, 800),
  ('ma_devseed_venue_19', 'devseed_venue_19.jpg', 800, 800),
  ('ma_devseed_venue_20', 'devseed_venue_20.jpg', 800, 800),
  ('ma_devseed_venue_21', 'devseed_venue_21.jpg', 800, 800),
  ('ma_devseed_venue_22', 'devseed_venue_22.jpg', 800, 800),
  ('ma_devseed_venue_23', 'devseed_venue_23.jpg', 800, 800),
  ('ma_devseed_venue_24', 'devseed_venue_24.jpg', 800, 800),
  ('ma_devseed_venue_25', 'devseed_venue_25.jpg', 800, 800),
  ('ma_devseed_venue_26', 'devseed_venue_26.jpg', 800, 800),
  ('ma_devseed_venue_27', 'devseed_venue_27.jpg', 800, 800),
  ('ma_devseed_venue_28', 'devseed_venue_28.jpg', 800, 800),
  ('ma_devseed_venue_scene_01', 'devseed_venue_scene_01.jpg', 376, 335),
  ('ma_devseed_venue_scene_02', 'devseed_venue_scene_02.jpg', 376, 335),
  ('ma_devseed_venue_scene_03', 'devseed_venue_scene_03.jpg', 376, 335),
  ('ma_devseed_venue_scene_04', 'devseed_venue_scene_04.jpg', 376, 335),
  ('ma_devseed_venue_scene_05', 'devseed_venue_scene_05.jpg', 376, 335),
  ('ma_devseed_venue_scene_06', 'devseed_venue_scene_06.jpg', 376, 335),
  ('ma_devseed_venue_scene_07', 'devseed_venue_scene_07.jpg', 376, 335),
  ('ma_devseed_venue_scene_08', 'devseed_venue_scene_08.jpg', 376, 335),
  ('ma_devseed_venue_scene_09', 'devseed_venue_scene_09.jpg', 376, 335),
  ('ma_devseed_venue_scene_10', 'devseed_venue_scene_10.jpg', 376, 335),
  ('ma_devseed_venue_scene_11', 'devseed_venue_scene_11.jpg', 376, 335),
  ('ma_devseed_venue_scene_12', 'devseed_venue_scene_12.jpg', 376, 335)
) AS g(asset_id, storage_key, w, h)
ON CONFLICT (media_asset_id) DO UPDATE
  SET owner_principal_type  = EXCLUDED.owner_principal_type,
      owner_principal_id    = EXCLUDED.owner_principal_id,
      original_storage_key  = EXCLUDED.original_storage_key,
      playback_storage_key  = EXCLUDED.playback_storage_key,
      thumbnail_storage_key = EXCLUDED.thumbnail_storage_key,
      mime_type             = EXCLUDED.mime_type,
      width                 = EXCLUDED.width,
      height                = EXCLUDED.height,
      processing_status     = EXCLUDED.processing_status,
      moderation_status     = EXCLUDED.moderation_status,
      visibility_class      = EXCLUDED.visibility_class,
      ai_generation_source  = EXCLUDED.ai_generation_source,
      ai_generated          = EXCLUDED.ai_generated,
      updated_at            = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 100 个用户账号
--
-- 01–30 是下面 30 家店的店主（business.accounts.owner_user_id 有外键指过来），
-- 31–60 是店员（每店一人，membership OPERATOR），61–100 是无店的普通用户 ——
-- 用来让 feed / 推荐位 / 私信这些**不依赖店铺**的界面也有内容可看。
-- 全部 status=ACTIVE。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES
  ('user_devseed_01', 'ACTIVE', now(), now()),
  ('user_devseed_02', 'ACTIVE', now(), now()),
  ('user_devseed_03', 'ACTIVE', now(), now()),
  ('user_devseed_04', 'ACTIVE', now(), now()),
  ('user_devseed_05', 'ACTIVE', now(), now()),
  ('user_devseed_06', 'ACTIVE', now(), now()),
  ('user_devseed_07', 'ACTIVE', now(), now()),
  ('user_devseed_08', 'ACTIVE', now(), now()),
  ('user_devseed_09', 'ACTIVE', now(), now()),
  ('user_devseed_10', 'ACTIVE', now(), now()),
  ('user_devseed_11', 'ACTIVE', now(), now()),
  ('user_devseed_12', 'ACTIVE', now(), now()),
  ('user_devseed_13', 'ACTIVE', now(), now()),
  ('user_devseed_14', 'ACTIVE', now(), now()),
  ('user_devseed_15', 'ACTIVE', now(), now()),
  ('user_devseed_16', 'ACTIVE', now(), now()),
  ('user_devseed_17', 'ACTIVE', now(), now()),
  ('user_devseed_18', 'ACTIVE', now(), now()),
  ('user_devseed_19', 'ACTIVE', now(), now()),
  ('user_devseed_20', 'ACTIVE', now(), now()),
  ('user_devseed_21', 'ACTIVE', now(), now()),
  ('user_devseed_22', 'ACTIVE', now(), now()),
  ('user_devseed_23', 'ACTIVE', now(), now()),
  ('user_devseed_24', 'ACTIVE', now(), now()),
  ('user_devseed_25', 'ACTIVE', now(), now()),
  ('user_devseed_26', 'ACTIVE', now(), now()),
  ('user_devseed_27', 'ACTIVE', now(), now()),
  ('user_devseed_28', 'ACTIVE', now(), now()),
  ('user_devseed_29', 'ACTIVE', now(), now()),
  ('user_devseed_30', 'ACTIVE', now(), now()),
  ('user_devseed_31', 'ACTIVE', now(), now()),
  ('user_devseed_32', 'ACTIVE', now(), now()),
  ('user_devseed_33', 'ACTIVE', now(), now()),
  ('user_devseed_34', 'ACTIVE', now(), now()),
  ('user_devseed_35', 'ACTIVE', now(), now()),
  ('user_devseed_36', 'ACTIVE', now(), now()),
  ('user_devseed_37', 'ACTIVE', now(), now()),
  ('user_devseed_38', 'ACTIVE', now(), now()),
  ('user_devseed_39', 'ACTIVE', now(), now()),
  ('user_devseed_40', 'ACTIVE', now(), now()),
  ('user_devseed_41', 'ACTIVE', now(), now()),
  ('user_devseed_42', 'ACTIVE', now(), now()),
  ('user_devseed_43', 'ACTIVE', now(), now()),
  ('user_devseed_44', 'ACTIVE', now(), now()),
  ('user_devseed_45', 'ACTIVE', now(), now()),
  ('user_devseed_46', 'ACTIVE', now(), now()),
  ('user_devseed_47', 'ACTIVE', now(), now()),
  ('user_devseed_48', 'ACTIVE', now(), now()),
  ('user_devseed_49', 'ACTIVE', now(), now()),
  ('user_devseed_50', 'ACTIVE', now(), now()),
  ('user_devseed_51', 'ACTIVE', now(), now()),
  ('user_devseed_52', 'ACTIVE', now(), now()),
  ('user_devseed_53', 'ACTIVE', now(), now()),
  ('user_devseed_54', 'ACTIVE', now(), now()),
  ('user_devseed_55', 'ACTIVE', now(), now()),
  ('user_devseed_56', 'ACTIVE', now(), now()),
  ('user_devseed_57', 'ACTIVE', now(), now()),
  ('user_devseed_58', 'ACTIVE', now(), now()),
  ('user_devseed_59', 'ACTIVE', now(), now()),
  ('user_devseed_60', 'ACTIVE', now(), now()),
  ('user_devseed_61', 'ACTIVE', now(), now()),
  ('user_devseed_62', 'ACTIVE', now(), now()),
  ('user_devseed_63', 'ACTIVE', now(), now()),
  ('user_devseed_64', 'ACTIVE', now(), now()),
  ('user_devseed_65', 'ACTIVE', now(), now()),
  ('user_devseed_66', 'ACTIVE', now(), now()),
  ('user_devseed_67', 'ACTIVE', now(), now()),
  ('user_devseed_68', 'ACTIVE', now(), now()),
  ('user_devseed_69', 'ACTIVE', now(), now()),
  ('user_devseed_70', 'ACTIVE', now(), now()),
  ('user_devseed_71', 'ACTIVE', now(), now()),
  ('user_devseed_72', 'ACTIVE', now(), now()),
  ('user_devseed_73', 'ACTIVE', now(), now()),
  ('user_devseed_74', 'ACTIVE', now(), now()),
  ('user_devseed_75', 'ACTIVE', now(), now()),
  ('user_devseed_76', 'ACTIVE', now(), now()),
  ('user_devseed_77', 'ACTIVE', now(), now()),
  ('user_devseed_78', 'ACTIVE', now(), now()),
  ('user_devseed_79', 'ACTIVE', now(), now()),
  ('user_devseed_80', 'ACTIVE', now(), now()),
  ('user_devseed_81', 'ACTIVE', now(), now()),
  ('user_devseed_82', 'ACTIVE', now(), now()),
  ('user_devseed_83', 'ACTIVE', now(), now()),
  ('user_devseed_84', 'ACTIVE', now(), now()),
  ('user_devseed_85', 'ACTIVE', now(), now()),
  ('user_devseed_86', 'ACTIVE', now(), now()),
  ('user_devseed_87', 'ACTIVE', now(), now()),
  ('user_devseed_88', 'ACTIVE', now(), now()),
  ('user_devseed_89', 'ACTIVE', now(), now()),
  ('user_devseed_90', 'ACTIVE', now(), now()),
  ('user_devseed_91', 'ACTIVE', now(), now()),
  ('user_devseed_92', 'ACTIVE', now(), now()),
  ('user_devseed_93', 'ACTIVE', now(), now()),
  ('user_devseed_94', 'ACTIVE', now(), now()),
  ('user_devseed_95', 'ACTIVE', now(), now()),
  ('user_devseed_96', 'ACTIVE', now(), now()),
  ('user_devseed_97', 'ACTIVE', now(), now()),
  ('user_devseed_98', 'ACTIVE', now(), now()),
  ('user_devseed_99', 'ACTIVE', now(), now()),
  ('user_devseed_100', 'ACTIVE', now(), now())
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status, updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 100 个 profile
--
-- handle 用 @ 开头的规范形式（profiles 上有 lower(ltrim(handle,'@')) 唯一索引）。
-- avatar_path 指向真实存在的媒体资产（见文件头「头像」一节）。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO identity.profiles
  (user_account_id, name, handle, bio, city, avatar_path, version, updated_at) VALUES
  ('user_devseed_01', 'Nguyễn Thị Bích Ngọc', '@devseed_01_an', 'Pha cà phê trứng kiểu cũ. Mở từ 6h sáng.', 'Hà Nội', 'assets/ma_creator_an_portrait_v1', 1, now()),
  ('user_devseed_02', 'Trần Minh Hạnh', '@devseed_02_duc', 'Quán nhỏ trong phố cổ. Ngồi được, chụp được.', 'Hà Nội', 'assets/ma_creator_duc_portrait_v1', 1, now()),
  ('user_devseed_03', 'Lê Hoàng Anh', '@devseed_03_duy_khang', 'Cà phê rang xay, giao cả nội thành.', 'Hà Nội', 'assets/ma_creator_duy_khang_portrait_v1', 1, now()),
  ('user_devseed_04', 'Phạm Quỳnh Anh', '@devseed_04_hai', 'Bistro mở tới khuya, có nhà kính.', 'Hà Nội', 'assets/ma_creator_hai_portrait_v1', 1, now()),
  ('user_devseed_05', 'Vũ Đức Thành', '@devseed_05_hana', 'Cà phê sân vườn, chỗ làm việc buổi sáng.', 'Hà Nội', 'assets/ma_creator_hana_portrait_v1', 1, now()),
  ('user_devseed_06', 'Đỗ Thùy Linh', '@devseed_06_hong_anh', 'Trà sen và nước mía. Mở tới 22h.', 'Hà Nội', 'assets/ma_creator_hong_anh_portrait_v1', 1, now()),
  ('user_devseed_07', 'Hoàng Kim Yến', '@devseed_07_huy', 'Bánh ngọt kiểu Hà Nội, giữa phố cổ.', 'Hà Nội', 'assets/ma_creator_huy_portrait_v1', 1, now()),
  ('user_devseed_08', 'Bùi Đức Kiên', '@devseed_08_kien', 'Cà phê công sở, wifi khoẻ, bàn nhiều.', 'Hà Nội', 'assets/ma_creator_kien_portrait_v1', 1, now()),
  ('user_devseed_09', 'Ngô Trà My', '@devseed_09_khoa', 'Cà phê sữa đá, view hồ Hoàn Kiếm.', 'Hà Nội', 'assets/ma_creator_khoa_portrait_v1', 1, now()),
  ('user_devseed_10', 'Đặng Như Quỳnh', '@devseed_10_lan', 'Quán lâu đời, làm theo công thức cũ.', 'Hà Nội', 'assets/ma_creator_lan_portrait_v1', 1, now()),
  ('user_devseed_11', 'Trương Thị Mai', '@devseed_11_linh', 'Quán trong hẻm, khách quen từ lâu.', 'Hà Nội', 'assets/ma_creator_linh_portrait_v1', 1, now()),
  ('user_devseed_12', 'Lê Anh Minh', '@devseed_12_long', 'Specialty coffee, rang tại chỗ.', 'Hà Nội', 'assets/ma_creator_long_portrait_v1', 1, now()),
  ('user_devseed_13', 'Phạm Thu Trang', '@devseed_13_ly', 'Bistro nhỏ, nhạc nhẹ, mở tới khuya.', 'Hà Nội', 'assets/ma_creator_ly_portrait_v1', 1, now()),
  ('user_devseed_14', 'Vũ Hoàng Long', '@devseed_14_mai', 'Món Việt, giá bình dân, phục vụ cả ngày.', 'Hà Nội', 'assets/ma_creator_mai_portrait_v1', 1, now()),
  ('user_devseed_15', 'Nguyễn Thị Lan', '@devseed_15_minh', 'Cà phê sân vườn, chỗ ngồi yên tĩnh.', 'Hà Nội', 'assets/ma_creator_minh_portrait_v1', 1, now()),
  ('user_devseed_16', 'Trần Bảo Nam', '@devseed_16_my', 'Cà phê vintage, nhạc jazz cuối tuần.', 'Hà Nội', 'assets/ma_creator_my_portrait_v1', 1, now()),
  ('user_devseed_17', 'Phạm Quốc Huy', '@devseed_17_nam', 'Quán ăn gia đình, mỗi ngày một món.', 'Hà Nội', 'assets/ma_creator_nam_portrait_v1', 1, now()),
  ('user_devseed_18', 'Đỗ Thị Hồng Nhung', '@devseed_18_ngoc', 'Trà trái cây, đồ ngọt. Ship nội thành.', 'Hà Nội', 'assets/ma_creator_ngoc_portrait_v1', 1, now()),
  ('user_devseed_19', 'Ngô Thanh Sơn', '@devseed_19_nhi', 'Cà phê view cao, chụp ảnh ban đêm.', 'Bắc Ninh', 'assets/ma_creator_nhi_portrait_v1', 1, now()),
  ('user_devseed_20', 'Hoàng Thị Thảo Nhi', '@devseed_20_phuong', 'Bánh mì và cà phê sáng, lấy đi cũng được.', 'Bắc Ninh', 'assets/ma_creator_phuong_portrait_v1', 1, now()),
  ('user_devseed_21', 'Lê Quốc Dũng', '@devseed_21_phuong_thanh', 'Cà phê rang mộc, pha máy.', 'Bắc Ninh', 'assets/ma_creator_phuong_thanh_portrait_v1', 1, now()),
  ('user_devseed_22', 'Phan Thị Thu Hà', '@devseed_22_quynh_anh', 'Trà và cà phê, chỗ ngồi ngoài vườn.', 'Bắc Ninh', 'assets/ma_creator_quynh_anh_portrait_v1', 1, now()),
  ('user_devseed_23', 'Vũ Khánh Duy', '@devseed_23_son', 'Cà phê sân vườn cạnh hồ.', 'Bắc Ninh', 'assets/ma_creator_son_portrait_v1', 1, now()),
  ('user_devseed_24', 'Trịnh Thùy Linh', '@devseed_24_thao', 'Quán cà phê trong ngõ, ít khách ồn.', 'Bắc Ninh', 'assets/ma_creator_thao_portrait_v1', 1, now()),
  ('user_devseed_25', 'Đỗ Hoàng Sơn', '@devseed_25_thao_nhi', 'Cà phê sữa đá là ngon nhất.', 'Bắc Ninh', 'assets/ma_creator_thao_nhi_portrait_v1', 1, now()),
  ('user_devseed_26', 'Nguyễn Thị Bích', '@devseed_26_thu_trang', 'Quán cà phê nhỏ, gần chợ.', 'Bắc Ninh', 'assets/ma_creator_thu_trang_portrait_v1', 1, now()),
  ('user_devseed_27', 'Trương Văn Khoa', '@devseed_27_trang', 'Quán ăn gia đình, mở cả ngày.', 'Bắc Ninh', 'assets/ma_creator_trang_portrait_v1', 1, now()),
  ('user_devseed_28', 'Lê Thị Phương Thanh', '@devseed_28_tu', 'Nhà hàng nhỏ, phục vụ tiệc gia đình.', 'Bắc Ninh', 'assets/ma_creator_tu_portrait_v1', 1, now()),
  ('user_devseed_29', 'Cao Thị Yến', '@devseed_29_vy', 'Quán ăn sáng, mở từ 6h.', 'Bắc Ninh', 'assets/ma_creator_vy_portrait_v1', 1, now()),
  ('user_devseed_30', 'Phan Anh Tuấn', '@devseed_30_yen', 'Quán hải sản, nhận đặt bàn.', 'Bắc Ninh', 'assets/ma_creator_yen_portrait_v1', 1, now()),
  ('user_devseed_31', 'An Nhiên', '@devseed_31_an_nhien', 'Chạy bộ quanh hồ Tây sáng sớm.', 'Hà Nội', 'assets/ma_devseed_an_nhien_portrait_v1', 1, now()),
  ('user_devseed_32', 'Bảo Châu', '@devseed_32_bao_chau', 'Pour-over và cà phê single origin.', 'Hà Nội', 'assets/ma_devseed_bao_chau_portrait_v1', 1, now()),
  ('user_devseed_33', 'Bích Ngọc', '@devseed_33_bich_ngoc', 'Cắm hoa, đi chợ phiên cuối tuần.', 'Hà Nội', 'assets/ma_devseed_bich_ngoc_portrait_v1', 1, now()),
  ('user_devseed_34', 'Cao Minh', '@devseed_34_cao_minh', 'Đạp xe, bản đồ cà phê phố cổ.', 'Hà Nội', 'assets/ma_devseed_cao_minh_portrait_v1', 1, now()),
  ('user_devseed_35', 'Chi Lan', '@devseed_35_chi_lan', 'Món ăn nhà làm kiểu Bắc.', 'Hà Nội', 'assets/ma_devseed_chi_lan_portrait_v1', 1, now()),
  ('user_devseed_36', 'Công Thành', '@devseed_36_cong_thanh', 'Đĩa than và nhạc indie.', 'Hà Nội', 'assets/ma_devseed_cong_thanh_portrait_v1', 1, now()),
  ('user_devseed_37', 'Diệp Anh', '@devseed_37_diep_anh', 'Chụp phim, thích ánh sáng tự nhiên.', 'Hà Nội', 'assets/ma_devseed_diep_anh_portrait_v1', 1, now()),
  ('user_devseed_38', 'Đình Khôi', '@devseed_38_dinh_khoi', 'Bia thủ công, hay đi tối.', 'Hà Nội', 'assets/ma_devseed_dinh_khoi_portrait_v1', 1, now()),
  ('user_devseed_39', 'Đoàn Trang', '@devseed_39_doan_trang', 'Bánh ngọt và bánh mì nướng.', 'Hà Nội', 'assets/ma_devseed_doan_trang_portrait_v1', 1, now()),
  ('user_devseed_40', 'Đức Anh', '@devseed_40_duc_anh', 'Tập gym, ăn nhẹ.', 'Hà Nội', 'assets/ma_devseed_duc_anh_portrait_v1', 1, now()),
  ('user_devseed_41', 'Gia Bảo', '@devseed_41_gia_bao', 'Barista, thi latte art.', 'Hà Nội', 'assets/ma_devseed_gia_bao_portrait_v1', 1, now()),
  ('user_devseed_42', 'Giang Hương', '@devseed_42_giang_huong', 'Hiệu sách và cà phê đọc sách.', 'Hà Nội', 'assets/ma_devseed_giang_huong_portrait_v1', 1, now()),
  ('user_devseed_43', 'Hà My', '@devseed_43_ha_my', 'Ăn vặt phố cổ, quán nào cũng thử.', 'Hà Nội', 'assets/ma_devseed_ha_my_portrait_v1', 1, now()),
  ('user_devseed_44', 'Hải Đăng', '@devseed_44_hai_dang', 'Chụp kiến trúc, hay lên sân thượng.', 'Hà Nội', 'assets/ma_devseed_hai_dang_portrait_v1', 1, now()),
  ('user_devseed_45', 'Hiền Lê', '@devseed_45_hien_le', 'Gốm thủ công, làm ở nhà.', 'Hà Nội', 'assets/ma_devseed_hien_le_portrait_v1', 1, now()),
  ('user_devseed_46', 'Hoa Lý', '@devseed_46_hoa_ly', 'Trà đạo và trà hoa.', 'Hà Nội', 'assets/ma_devseed_hoa_ly_portrait_v1', 1, now()),
  ('user_devseed_47', 'Hoàng Nam', '@devseed_47_hoang_nam', 'Ăn vặt vỉa hè, quán quen.', 'Hà Nội', 'assets/ma_devseed_hoang_nam_portrait_v1', 1, now()),
  ('user_devseed_48', 'Hồng Ngọc', '@devseed_48_hong_ngoc', 'Làm móng, thích đồ vintage.', 'Hà Nội', 'assets/ma_devseed_hong_ngoc_portrait_v1', 1, now()),
  ('user_devseed_49', 'Hữu Phúc', '@devseed_49_huu_phuc', 'Mộc, làm đồ gỗ nhỏ.', 'Hà Nội', 'assets/ma_devseed_huu_phuc_portrait_v1', 1, now()),
  ('user_devseed_50', 'Khánh Linh', '@devseed_50_khanh_linh', 'Brunch cuối tuần, cà phê sữa.', 'Hà Nội', 'assets/ma_devseed_khanh_linh_portrait_v1', 1, now()),
  ('user_devseed_51', 'Kim Ngân', '@devseed_51_kim_ngan', 'Áo dài và ảnh chân dung.', 'Hà Nội', 'assets/ma_devseed_kim_ngan_portrait_v1', 1, now()),
  ('user_devseed_52', 'Lâm Giang', '@devseed_52_lam_giang', 'Lặn biển, hay đi xa cuối tuần.', 'Hà Nội', 'assets/ma_devseed_lam_giang_portrait_v1', 1, now()),
  ('user_devseed_53', 'Lan Anh', '@devseed_53_lan_anh', 'Yoga và ăn chay.', 'Hà Nội', 'assets/ma_devseed_lan_anh_portrait_v1', 1, now()),
  ('user_devseed_54', 'Lê Quyên', '@devseed_54_le_quyen', 'Phở bò, quán mở từ 5h.', 'Hà Nội', 'assets/ma_devseed_le_quyen_portrait_v1', 1, now()),
  ('user_devseed_55', 'Linh Đan', '@devseed_55_linh_dan', 'Vẽ minh hoạ, làm sổ tay.', 'Hà Nội', 'assets/ma_devseed_linh_dan_portrait_v1', 1, now()),
  ('user_devseed_56', 'Mai Phương', '@devseed_56_mai_phuong', 'Đi cà phê mỗi sáng.', 'Hà Nội', 'assets/ma_devseed_mai_phuong_portrait_v1', 1, now()),
  ('user_devseed_57', 'Minh Anh', '@devseed_57_minh_anh', 'Chụp chân dung, thích nắng sớm.', 'Hà Nội', 'assets/ma_devseed_minh_anh_portrait_v1', 1, now()),
  ('user_devseed_58', 'Minh Quân', '@devseed_58_minh_quan', 'Rang cà phê, bán theo gói.', 'Hà Nội', 'assets/ma_devseed_minh_quan_portrait_v1', 1, now()),
  ('user_devseed_59', 'Mỹ Duyên', '@devseed_59_my_duyen', 'Nhảy, nhạc Hàn.', 'Hà Nội', 'assets/ma_devseed_my_duyen_portrait_v1', 1, now()),
  ('user_devseed_60', 'Nam Anh', '@devseed_60_nam_anh', 'Chạy bộ quanh hồ Hoàn Kiếm.', 'Hà Nội', 'assets/ma_devseed_nam_anh_portrait_v1', 1, now()),
  ('user_devseed_61', 'Ngọc Hân', '@devseed_61_ngoc_han', 'Bánh ngọt, làm theo mùa.', 'Hà Nội', 'assets/ma_devseed_ngoc_han_portrait_v1', 1, now()),
  ('user_devseed_62', 'Nhật Linh', '@devseed_62_nhat_linh', 'Cà phê và sách, ngồi lâu.', 'Hà Nội', 'assets/ma_devseed_nhat_linh_portrait_v1', 1, now()),
  ('user_devseed_63', 'Phúc Long', '@devseed_63_phuc_long', 'Sửa xe máy, rành đường.', 'Hà Nội', 'assets/ma_devseed_phuc_long_portrait_v1', 1, now()),
  ('user_devseed_64', 'Phương Linh', '@devseed_64_phuong_linh', 'Cây cảnh và hoa tươi.', 'Hà Nội', 'assets/ma_devseed_phuong_linh_portrait_v1', 1, now()),
  ('user_devseed_65', 'Quang Huy', '@devseed_65_quang_huy', 'Chơi game, thỉnh thoảng live.', 'Hà Nội', 'assets/ma_devseed_quang_huy_portrait_v1', 1, now()),
  ('user_devseed_66', 'Quỳnh Mai', '@devseed_66_quynh_mai', 'Bánh ngọt và cà phê.', 'Hà Nội', 'assets/ma_devseed_quynh_mai_portrait_v1', 1, now()),
  ('user_devseed_67', 'Sơn Tùng', '@devseed_67_son_tung', 'Làm nhạc, thu ở nhà.', 'Hà Nội', 'assets/ma_devseed_son_tung_portrait_v1', 1, now()),
  ('user_devseed_68', 'Tâm Như', '@devseed_68_tam_nhu', 'Xà phòng thủ công và nến thơm.', 'Hà Nội', 'assets/ma_devseed_tam_nhu_portrait_v1', 1, now()),
  ('user_devseed_69', 'Thanh Hà', '@devseed_69_thanh_ha', 'Dạy nấu món Việt.', 'Hà Nội', 'assets/ma_devseed_thanh_ha_portrait_v1', 1, now()),
  ('user_devseed_70', 'Thu Hà', '@devseed_70_thu_ha', 'Cà phê và chụp ảnh.', 'Hà Nội', 'assets/ma_devseed_thu_ha_portrait_v1', 1, now()),
  ('user_devseed_71', 'Anh Tuấn', '@devseed_71_anh_tuan', 'Cà phê ở Bắc Ninh, mở sáng sớm.', 'Bắc Ninh', 'assets/ma_devseed_anh_tuan_portrait_v1', 1, now()),
  ('user_devseed_72', 'Bảo Ngọc', '@devseed_72_bao_ngoc', 'Bánh ngọt, hay thử quán mới.', 'Bắc Ninh', 'assets/ma_devseed_bao_ngoc_portrait_v1', 1, now()),
  ('user_devseed_73', 'Cam Tú', '@devseed_73_cam_tu', 'Pour-over, thích vị chua.', 'Bắc Ninh', 'assets/ma_devseed_cam_tu_portrait_v1', 1, now()),
  ('user_devseed_74', 'Diệu Linh', '@devseed_74_dieu_linh', 'Trà hoa và trà sen.', 'Bắc Ninh', 'assets/ma_devseed_dieu_linh_portrait_v1', 1, now()),
  ('user_devseed_75', 'Đức Huy', '@devseed_75_duc_huy', 'Rang cà phê tại nhà.', 'Bắc Ninh', 'assets/ma_devseed_duc_huy_portrait_v1', 1, now()),
  ('user_devseed_76', 'Gia Hân', '@devseed_76_gia_han', 'Bánh mì và bánh ngọt.', 'Bắc Ninh', 'assets/ma_devseed_gia_han_portrait_v1', 1, now()),
  ('user_devseed_77', 'Hải Yến', '@devseed_77_hai_yen', 'Quán trà, ngồi lâu được.', 'Bắc Ninh', 'assets/ma_devseed_hai_yen_portrait_v1', 1, now()),
  ('user_devseed_78', 'Hồng Quân', '@devseed_78_hong_quan', 'Quan họ, hát cuối tuần.', 'Bắc Ninh', 'assets/ma_devseed_hong_quan_portrait_v1', 1, now()),
  ('user_devseed_79', 'Huệ Chi', '@devseed_79_hue_chi', 'Áo dài truyền thống.', 'Bắc Ninh', 'assets/ma_devseed_hue_chi_portrait_v1', 1, now()),
  ('user_devseed_80', 'Khắc Minh', '@devseed_80_khac_minh', 'Chụp ảnh và cà phê.', 'Bắc Ninh', 'assets/ma_devseed_khac_minh_portrait_v1', 1, now()),
  ('user_devseed_81', 'Lâm Anh', '@devseed_81_lam_anh', 'Cà phê sân vườn.', 'Bắc Ninh', 'assets/ma_devseed_lam_anh_portrait_v1', 1, now()),
  ('user_devseed_82', 'Linh Chi', '@devseed_82_linh_chi', 'Đi thử quán cà phê mới.', 'Bắc Ninh', 'assets/ma_devseed_linh_chi_portrait_v1', 1, now()),
  ('user_devseed_83', 'Mai Anh', '@devseed_83_mai_anh', 'Bánh ngọt và trà.', 'Bắc Ninh', 'assets/ma_devseed_mai_anh_portrait_v1', 1, now()),
  ('user_devseed_84', 'Minh Châu', '@devseed_84_minh_chau', 'Cà phê và sách.', 'Bắc Ninh', 'assets/ma_devseed_minh_chau_portrait_v1', 1, now()),
  ('user_devseed_85', 'Ngọc Điệp', '@devseed_85_ngoc_diep', 'Đan lát thủ công.', 'Bắc Ninh', 'assets/ma_devseed_ngoc_diep_portrait_v1', 1, now()),
  ('user_devseed_86', 'Phương Anh', '@devseed_86_phuong_anh', 'Brunch cuối tuần.', 'Bắc Ninh', 'assets/ma_devseed_phuong_anh_portrait_v1', 1, now()),
  ('user_devseed_87', 'Quốc Bảo', '@devseed_87_quoc_bao', 'Barista, pha máy.', 'Bắc Ninh', 'assets/ma_devseed_quoc_bao_portrait_v1', 1, now()),
  ('user_devseed_88', 'Thanh Tùng', '@devseed_88_thanh_tung', 'Cà phê rang mộc.', 'Bắc Ninh', 'assets/ma_devseed_thanh_tung_portrait_v1', 1, now()),
  ('user_devseed_89', 'Thu Phương', '@devseed_89_thu_phuong', 'Cắm hoa và cà phê.', 'Bắc Ninh', 'assets/ma_devseed_thu_phuong_portrait_v1', 1, now()),
  ('user_devseed_90', 'Trang Anh', '@devseed_90_trang_anh', 'Chụp ảnh quán cà phê.', 'Bắc Ninh', 'assets/ma_devseed_trang_anh_portrait_v1', 1, now()),
  ('user_devseed_91', 'Tuấn Anh', '@devseed_91_tuan_anh', 'Xe máy và đi xa.', 'Bắc Ninh', 'assets/ma_devseed_tuan_anh_portrait_v1', 1, now()),
  ('user_devseed_92', 'Vân Anh', '@devseed_92_van_anh', 'Bánh ngọt và cà phê sữa.', 'Bắc Ninh', 'assets/ma_devseed_van_anh_portrait_v1', 1, now()),
  ('user_devseed_93', 'Việt Hoàng', '@devseed_93_viet_hoang', 'Rang và pha cà phê.', 'Bắc Ninh', 'assets/ma_devseed_viet_hoang_portrait_v1', 1, now()),
  ('user_devseed_94', 'Xuân Mai', '@devseed_94_xuan_mai', 'Trà và hoa.', 'Bắc Ninh', 'assets/ma_devseed_xuan_mai_portrait_v1', 1, now()),
  ('user_devseed_95', 'Yến Nhi', '@devseed_95_yen_nhi', 'Đi cà phê, hay chụp ảnh.', 'Bắc Ninh', 'assets/ma_devseed_yen_nhi_portrait_v1', 1, now()),
  ('user_devseed_96', 'Đức Thịnh', '@devseed_96_duc_thinh', 'Cà phê sáng, đọc báo.', 'Bắc Ninh', 'assets/ma_devseed_duc_thinh_portrait_v1', 1, now()),
  ('user_devseed_97', 'Mai Linh', '@devseed_97_mai_linh', 'Làm bánh, bán cuối tuần.', 'Hà Nội', 'assets/ma_devseed_mai_linh_portrait_v1', 1, now()),
  ('user_devseed_98', 'Quốc Anh', '@devseed_98_quoc_anh', 'Đi bộ và chụp phố.', 'Hà Nội', 'assets/ma_devseed_quoc_anh_portrait_v1', 1, now()),
  ('user_devseed_99', 'Thùy Dương', '@devseed_99_thuy_duong', 'Cà phê và hoa.', 'Hà Nội', 'assets/ma_devseed_thuy_duong_portrait_v1', 1, now()),
  ('user_devseed_100', 'Văn Phúc', '@devseed_100_van_phuc', 'Sửa chữa nhỏ, hay ngồi quán.', 'Hà Nội', 'assets/ma_devseed_van_phuc_portrait_v1', 1, now())
ON CONFLICT (user_account_id) DO UPDATE
  SET name        = EXCLUDED.name,
      handle      = EXCLUDED.handle,
      bio         = EXCLUDED.bio,
      city        = EXCLUDED.city,
      avatar_path = EXCLUDED.avatar_path,
      version     = identity.profiles.version + 1,
      updated_at  = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 30 个商家主体（一店一主体，方便对着真实店一家家核）
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES
  ('biz_devseed_01', 'user_devseed_01', 'Cộng Cà Phê', 'ACTIVE', now()),
  ('biz_devseed_02', 'user_devseed_02', 'Kafeville', 'ACTIVE', now()),
  ('biz_devseed_03', 'user_devseed_03', 'Café Nola', 'ACTIVE', now()),
  ('biz_devseed_04', 'user_devseed_04', 'Café Đinh', 'ACTIVE', now()),
  ('biz_devseed_05', 'user_devseed_05', 'Maison de Tet Decor', 'ACTIVE', now()),
  ('biz_devseed_06', 'user_devseed_06', 'Lifted Coffee + Brunch', 'ACTIVE', now()),
  ('biz_devseed_07', 'user_devseed_07', 'Blackbird Coffee', 'ACTIVE', now()),
  ('biz_devseed_08', 'user_devseed_08', 'La Place', 'ACTIVE', now()),
  ('biz_devseed_09', 'user_devseed_09', 'The Note Coffee', 'ACTIVE', now()),
  ('biz_devseed_10', 'user_devseed_10', 'The Hanoi Social Club', 'ACTIVE', now()),
  ('biz_devseed_11', 'user_devseed_11', 'Tranquil Books & Coffee', 'ACTIVE', now()),
  ('biz_devseed_12', 'user_devseed_12', 'Tầng Trệt Cosmo Café', 'ACTIVE', now()),
  ('biz_devseed_13', 'user_devseed_13', 'Red Bean Restaurant', 'ACTIVE', now()),
  ('biz_devseed_14', 'user_devseed_14', 'Coffee Club', 'ACTIVE', now()),
  ('biz_devseed_15', 'user_devseed_15', 'Panorama Restaurant', 'ACTIVE', now()),
  ('biz_devseed_16', 'user_devseed_16', 'Rico South American Steakhouse', 'ACTIVE', now()),
  ('biz_devseed_17', 'user_devseed_17', 'Quán Ăn Ngon', 'ACTIVE', now()),
  ('biz_devseed_18', 'user_devseed_18', 'Pane E Vino', 'ACTIVE', now()),
  ('biz_devseed_19', 'user_devseed_19', 'TDeli Coffee', 'ACTIVE', now()),
  ('biz_devseed_20', 'user_devseed_20', 'Chago Tea & Café', 'ACTIVE', now()),
  ('biz_devseed_21', 'user_devseed_21', 'Siii Coffee', 'ACTIVE', now()),
  ('biz_devseed_22', 'user_devseed_22', 'Sky Garden Coffee', 'ACTIVE', now()),
  ('biz_devseed_23', 'user_devseed_23', 'Ruộng Coffee', 'ACTIVE', now()),
  ('biz_devseed_24', 'user_devseed_24', 'Dallas Coffee Roasters', 'ACTIVE', now()),
  ('biz_devseed_25', 'user_devseed_25', 'Snow Island Coffee', 'ACTIVE', now()),
  ('biz_devseed_26', 'user_devseed_26', 'Cami Coffee', 'ACTIVE', now()),
  ('biz_devseed_27', 'user_devseed_27', 'Yakimono', 'ACTIVE', now()),
  ('biz_devseed_28', 'user_devseed_28', 'Hanwon', 'ACTIVE', now()),
  ('biz_devseed_29', 'user_devseed_29', 'Bao Dimsum', 'ACTIVE', now()),
  ('biz_devseed_30', 'user_devseed_30', 'Cua Ngon 93', 'ACTIVE', now())
ON CONFLICT (id) DO UPDATE
  SET owner_user_id = EXCLUDED.owner_user_id,
      name          = EXCLUDED.name,
      status        = EXCLUDED.status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 30 家店
--
-- reality_scene_id 留空（''）而不是瞎指一个场景：business.stores 上有
-- `idx_stores_reality_scene ... WHERE reality_scene_id <> ''`，指错的场景会让
-- 「附近的店」出现在不相干的地点，比空着更难排查。理由详见文件头第 2 条。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.stores
  (id, business_id, name, address, status, category, reality_scene_id, created_at) VALUES
  ('store_devseed_01', 'biz_devseed_01', 'Cộng Cà Phê — Cầu Gỗ', '116 P. Cầu Gỗ, Hàng Bạc, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê / Cà phê cốt dừa', '', now()),
  ('store_devseed_02', 'biz_devseed_02', 'Kafeville', '23 P. Yên Ninh, Ba Đình, Hà Nội', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_03', 'biz_devseed_03', 'Café Nola', '89 P. Mã Mây, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_04', 'biz_devseed_04', 'Café Đinh', '13 P. Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê / Cà phê trứng', '', now()),
  ('store_devseed_05', 'biz_devseed_05', 'Maison de Tet Decor', '58 P. Từ Hoa, Tây Hồ, Hà Nội', 'ACTIVE', 'Cà phê / Brunch', '', now()),
  ('store_devseed_06', 'biz_devseed_06', 'Lifted Coffee + Brunch', '101 P. Hàng Gà, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê / Brunch', '', now()),
  ('store_devseed_07', 'biz_devseed_07', 'Blackbird Coffee', '5 P. Chân Cầm, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_08', 'biz_devseed_08', 'La Place', '6 P. Ấu Triệu, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_09', 'biz_devseed_09', 'The Note Coffee', '64 P. Lương Văn Can, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_10', 'biz_devseed_10', 'The Hanoi Social Club', '6 Ng. Hội Vũ, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê / Bistro', '', now()),
  ('store_devseed_11', 'biz_devseed_11', 'Tranquil Books & Coffee', '5 P. Nguyễn Quang Bích, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Cà phê sách', '', now()),
  ('store_devseed_12', 'biz_devseed_12', 'Tầng Trệt Cosmo Café', '100 P. Khúc Thừa Dụ, Cầu Giấy, Hà Nội', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_13', 'biz_devseed_13', 'Red Bean Restaurant', '94 Mã Mây, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Món Việt', '', now()),
  ('store_devseed_14', 'biz_devseed_14', 'Coffee Club', '3B Lê Thái Tổ, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Món Âu / Cà phê', '', now()),
  ('store_devseed_15', 'biz_devseed_15', 'Panorama Restaurant', '13 Lý Thái Tổ, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Món Việt / View hồ', '', now()),
  ('store_devseed_16', 'biz_devseed_16', 'Rico South American Steakhouse', '7 Nguyễn Gia Thiều, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Bò bít tết / Nam Mỹ', '', now()),
  ('store_devseed_17', 'biz_devseed_17', 'Quán Ăn Ngon', '18 Phan Bội Châu, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Món Việt', '', now()),
  ('store_devseed_18', 'biz_devseed_18', 'Pane E Vino', '3 Nguyễn Khắc Cần, Hoàn Kiếm, Hà Nội', 'ACTIVE', 'Món Ý', '', now()),
  ('store_devseed_19', 'biz_devseed_19', 'TDeli Coffee', '43 Hồ Ngọc Lân, Kinh Bắc, TP Bắc Ninh', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_20', 'biz_devseed_20', 'Chago Tea & Café', '187 Nguyễn Gia Thiều, TP Bắc Ninh', 'ACTIVE', 'Trà / Cà phê', '', now()),
  ('store_devseed_21', 'biz_devseed_21', 'Siii Coffee', '43 Nguyễn Bỉnh Quân, Võ Cường, TP Bắc Ninh', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_22', 'biz_devseed_22', 'Sky Garden Coffee', '21 Lý Thái Tổ, Võ Cường, TP Bắc Ninh', 'ACTIVE', 'Cà phê / Sân vườn', '', now()),
  ('store_devseed_23', 'biz_devseed_23', 'Ruộng Coffee', '54 P. Lý Chiêu Hoàng, Võ Cường, TP Bắc Ninh', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_24', 'biz_devseed_24', 'Dallas Coffee Roasters', '26 Nguyễn Bỉnh Quân, Kinh Bắc, TP Bắc Ninh', 'ACTIVE', 'Specialty coffee / Rang xay', '', now()),
  ('store_devseed_25', 'biz_devseed_25', 'Snow Island Coffee', '68 Đ. Lê Thái Tổ, Ninh Xá, TP Bắc Ninh', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_26', 'biz_devseed_26', 'Cami Coffee', '390 Nguyễn Thị Lưu, TP Bắc Ninh', 'ACTIVE', 'Cà phê', '', now()),
  ('store_devseed_27', 'biz_devseed_27', 'Yakimono — Nguyễn Đăng Đạo', '24-26 Nguyễn Đăng Đạo, Đại Phúc, TP Bắc Ninh', 'ACTIVE', 'Buffet nướng / Nhật', '', now()),
  ('store_devseed_28', 'biz_devseed_28', 'Hanwon', '10B Nguyễn Đăng Đạo, Tiền An, TP Bắc Ninh', 'ACTIVE', 'Buffet nướng / Hàn', '', now()),
  ('store_devseed_29', 'biz_devseed_29', 'Bao Dimsum', '67 Ngọc Hân Công Chúa, Ninh Xá, TP Bắc Ninh', 'ACTIVE', 'Dimsum / Trung Hoa', '', now()),
  ('store_devseed_30', 'biz_devseed_30', 'Cua Ngon 93', '46 Lương Thế Vinh, Tiền Ninh Vệ, TP Bắc Ninh', 'ACTIVE', 'Hải sản', '', now())
ON CONFLICT (id) DO UPDATE
  SET business_id      = EXCLUDED.business_id,
      name             = EXCLUDED.name,
      address          = EXCLUDED.address,
      status           = EXCLUDED.status,
      category         = EXCLUDED.category,
      reality_scene_id = EXCLUDED.reality_scene_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 成员关系：店主 OWNER（用户 01–30）+ 店员 OPERATOR（用户 31–60，一店一人）
--
-- role 有 CHECK：OWNER / ADMIN / OPERATOR / VIEWER
-- status 有 CHECK：ACTIVE / INVITED / SUSPENDED
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.memberships (business_id, user_id, role, status, created_at) VALUES
  ('biz_devseed_01', 'user_devseed_01', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_02', 'user_devseed_02', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_03', 'user_devseed_03', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_04', 'user_devseed_04', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_05', 'user_devseed_05', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_06', 'user_devseed_06', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_07', 'user_devseed_07', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_08', 'user_devseed_08', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_09', 'user_devseed_09', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_10', 'user_devseed_10', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_11', 'user_devseed_11', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_12', 'user_devseed_12', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_13', 'user_devseed_13', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_14', 'user_devseed_14', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_15', 'user_devseed_15', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_16', 'user_devseed_16', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_17', 'user_devseed_17', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_18', 'user_devseed_18', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_19', 'user_devseed_19', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_20', 'user_devseed_20', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_21', 'user_devseed_21', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_22', 'user_devseed_22', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_23', 'user_devseed_23', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_24', 'user_devseed_24', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_25', 'user_devseed_25', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_26', 'user_devseed_26', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_27', 'user_devseed_27', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_28', 'user_devseed_28', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_29', 'user_devseed_29', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_30', 'user_devseed_30', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_01', 'user_devseed_31', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_02', 'user_devseed_32', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_03', 'user_devseed_33', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_04', 'user_devseed_34', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_05', 'user_devseed_35', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_06', 'user_devseed_36', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_07', 'user_devseed_37', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_08', 'user_devseed_38', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_09', 'user_devseed_39', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_10', 'user_devseed_40', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_11', 'user_devseed_41', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_12', 'user_devseed_42', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_13', 'user_devseed_43', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_14', 'user_devseed_44', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_15', 'user_devseed_45', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_16', 'user_devseed_46', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_17', 'user_devseed_47', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_18', 'user_devseed_48', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_19', 'user_devseed_49', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_20', 'user_devseed_50', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_21', 'user_devseed_51', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_22', 'user_devseed_52', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_23', 'user_devseed_53', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_24', 'user_devseed_54', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_25', 'user_devseed_55', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_26', 'user_devseed_56', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_27', 'user_devseed_57', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_28', 'user_devseed_58', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_29', 'user_devseed_59', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_30', 'user_devseed_60', 'OPERATOR', 'ACTIVE', now())
ON CONFLICT (business_id, user_id) DO UPDATE
  SET role = EXCLUDED.role, status = EXCLUDED.status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 成员目录（display_name 是投影，供商家后台列表直接显示，不用再 JOIN profiles）
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.member_directory
  (business_id, user_id, display_name, role, status, joined_at) VALUES
  ('biz_devseed_01', 'user_devseed_01', 'Nguyễn Thị Bích Ngọc', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_02', 'user_devseed_02', 'Trần Minh Hạnh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_03', 'user_devseed_03', 'Lê Hoàng Anh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_04', 'user_devseed_04', 'Phạm Quỳnh Anh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_05', 'user_devseed_05', 'Vũ Đức Thành', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_06', 'user_devseed_06', 'Đỗ Thùy Linh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_07', 'user_devseed_07', 'Hoàng Kim Yến', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_08', 'user_devseed_08', 'Bùi Đức Kiên', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_09', 'user_devseed_09', 'Ngô Trà My', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_10', 'user_devseed_10', 'Đặng Như Quỳnh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_11', 'user_devseed_11', 'Trương Thị Mai', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_12', 'user_devseed_12', 'Lê Anh Minh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_13', 'user_devseed_13', 'Phạm Thu Trang', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_14', 'user_devseed_14', 'Vũ Hoàng Long', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_15', 'user_devseed_15', 'Nguyễn Thị Lan', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_16', 'user_devseed_16', 'Trần Bảo Nam', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_17', 'user_devseed_17', 'Phạm Quốc Huy', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_18', 'user_devseed_18', 'Đỗ Thị Hồng Nhung', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_19', 'user_devseed_19', 'Ngô Thanh Sơn', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_20', 'user_devseed_20', 'Hoàng Thị Thảo Nhi', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_21', 'user_devseed_21', 'Lê Quốc Dũng', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_22', 'user_devseed_22', 'Phan Thị Thu Hà', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_23', 'user_devseed_23', 'Vũ Khánh Duy', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_24', 'user_devseed_24', 'Trịnh Thùy Linh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_25', 'user_devseed_25', 'Đỗ Hoàng Sơn', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_26', 'user_devseed_26', 'Nguyễn Thị Bích', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_27', 'user_devseed_27', 'Trương Văn Khoa', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_28', 'user_devseed_28', 'Lê Thị Phương Thanh', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_29', 'user_devseed_29', 'Cao Thị Yến', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_30', 'user_devseed_30', 'Phan Anh Tuấn', 'OWNER', 'ACTIVE', now()),
  ('biz_devseed_01', 'user_devseed_31', 'An Nhiên', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_02', 'user_devseed_32', 'Bảo Châu', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_03', 'user_devseed_33', 'Bích Ngọc', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_04', 'user_devseed_34', 'Cao Minh', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_05', 'user_devseed_35', 'Chi Lan', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_06', 'user_devseed_36', 'Công Thành', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_07', 'user_devseed_37', 'Diệp Anh', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_08', 'user_devseed_38', 'Đình Khôi', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_09', 'user_devseed_39', 'Đoàn Trang', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_10', 'user_devseed_40', 'Đức Anh', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_11', 'user_devseed_41', 'Gia Bảo', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_12', 'user_devseed_42', 'Giang Hương', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_13', 'user_devseed_43', 'Hà My', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_14', 'user_devseed_44', 'Hải Đăng', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_15', 'user_devseed_45', 'Hiền Lê', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_16', 'user_devseed_46', 'Hoa Lý', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_17', 'user_devseed_47', 'Hoàng Nam', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_18', 'user_devseed_48', 'Hồng Ngọc', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_19', 'user_devseed_49', 'Hữu Phúc', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_20', 'user_devseed_50', 'Khánh Linh', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_21', 'user_devseed_51', 'Kim Ngân', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_22', 'user_devseed_52', 'Lâm Giang', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_23', 'user_devseed_53', 'Lan Anh', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_24', 'user_devseed_54', 'Lê Quyên', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_25', 'user_devseed_55', 'Linh Đan', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_26', 'user_devseed_56', 'Mai Phương', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_27', 'user_devseed_57', 'Minh Anh', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_28', 'user_devseed_58', 'Minh Quân', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_29', 'user_devseed_59', 'Mỹ Duyên', 'OPERATOR', 'ACTIVE', now()),
  ('biz_devseed_30', 'user_devseed_60', 'Nam Anh', 'OPERATOR', 'ACTIVE', now())
ON CONFLICT (business_id, user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      role         = EXCLUDED.role,
      status       = EXCLUDED.status;

-- ─────────────────────────────────────────────────────────────────────────────
-- 店面照片：30 家店各 1 张封面，前 10 家再各 1 张（共 40 张，互不重复）
--
-- asset_path 有 CHECK：`^ai-personas/|^assets/|^store/` 或 `photo_%` —— 用
-- `assets/<mediaAssetId>`（与 identity.profiles.avatar_path 同口径）。
-- caption 写明是开发占位图，见文件头第 3 条。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.store_photos
  (id, store_id, business_id, uploaded_by, asset_path, caption, sort_order,
   media_asset_id, created_at) VALUES
  ('storephoto_devseed_01_1', 'store_devseed_01', 'biz_devseed_01', 'user_devseed_01', 'assets/ma_devseed_venue_01', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_01', now()),
  ('storephoto_devseed_02_1', 'store_devseed_02', 'biz_devseed_02', 'user_devseed_02', 'assets/ma_devseed_venue_02', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_02', now()),
  ('storephoto_devseed_03_1', 'store_devseed_03', 'biz_devseed_03', 'user_devseed_03', 'assets/ma_devseed_venue_03', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_03', now()),
  ('storephoto_devseed_04_1', 'store_devseed_04', 'biz_devseed_04', 'user_devseed_04', 'assets/ma_devseed_venue_04', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_04', now()),
  ('storephoto_devseed_05_1', 'store_devseed_05', 'biz_devseed_05', 'user_devseed_05', 'assets/ma_devseed_venue_05', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_05', now()),
  ('storephoto_devseed_06_1', 'store_devseed_06', 'biz_devseed_06', 'user_devseed_06', 'assets/ma_devseed_venue_06', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_06', now()),
  ('storephoto_devseed_07_1', 'store_devseed_07', 'biz_devseed_07', 'user_devseed_07', 'assets/ma_devseed_venue_07', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_07', now()),
  ('storephoto_devseed_08_1', 'store_devseed_08', 'biz_devseed_08', 'user_devseed_08', 'assets/ma_devseed_venue_08', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_08', now()),
  ('storephoto_devseed_09_1', 'store_devseed_09', 'biz_devseed_09', 'user_devseed_09', 'assets/ma_devseed_venue_09', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_09', now()),
  ('storephoto_devseed_10_1', 'store_devseed_10', 'biz_devseed_10', 'user_devseed_10', 'assets/ma_devseed_venue_10', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_10', now()),
  ('storephoto_devseed_11_1', 'store_devseed_11', 'biz_devseed_11', 'user_devseed_11', 'assets/ma_devseed_venue_11', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_11', now()),
  ('storephoto_devseed_12_1', 'store_devseed_12', 'biz_devseed_12', 'user_devseed_12', 'assets/ma_devseed_venue_12', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_12', now()),
  ('storephoto_devseed_13_1', 'store_devseed_13', 'biz_devseed_13', 'user_devseed_13', 'assets/ma_devseed_venue_13', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_13', now()),
  ('storephoto_devseed_14_1', 'store_devseed_14', 'biz_devseed_14', 'user_devseed_14', 'assets/ma_devseed_venue_14', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_14', now()),
  ('storephoto_devseed_15_1', 'store_devseed_15', 'biz_devseed_15', 'user_devseed_15', 'assets/ma_devseed_venue_15', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_15', now()),
  ('storephoto_devseed_16_1', 'store_devseed_16', 'biz_devseed_16', 'user_devseed_16', 'assets/ma_devseed_venue_16', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_16', now()),
  ('storephoto_devseed_17_1', 'store_devseed_17', 'biz_devseed_17', 'user_devseed_17', 'assets/ma_devseed_venue_17', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_17', now()),
  ('storephoto_devseed_18_1', 'store_devseed_18', 'biz_devseed_18', 'user_devseed_18', 'assets/ma_devseed_venue_18', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_18', now()),
  ('storephoto_devseed_19_1', 'store_devseed_19', 'biz_devseed_19', 'user_devseed_19', 'assets/ma_devseed_venue_19', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_19', now()),
  ('storephoto_devseed_20_1', 'store_devseed_20', 'biz_devseed_20', 'user_devseed_20', 'assets/ma_devseed_venue_20', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_20', now()),
  ('storephoto_devseed_21_1', 'store_devseed_21', 'biz_devseed_21', 'user_devseed_21', 'assets/ma_devseed_venue_21', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_21', now()),
  ('storephoto_devseed_22_1', 'store_devseed_22', 'biz_devseed_22', 'user_devseed_22', 'assets/ma_devseed_venue_22', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_22', now()),
  ('storephoto_devseed_23_1', 'store_devseed_23', 'biz_devseed_23', 'user_devseed_23', 'assets/ma_devseed_venue_23', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_23', now()),
  ('storephoto_devseed_24_1', 'store_devseed_24', 'biz_devseed_24', 'user_devseed_24', 'assets/ma_devseed_venue_24', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_24', now()),
  ('storephoto_devseed_25_1', 'store_devseed_25', 'biz_devseed_25', 'user_devseed_25', 'assets/ma_devseed_venue_25', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_25', now()),
  ('storephoto_devseed_26_1', 'store_devseed_26', 'biz_devseed_26', 'user_devseed_26', 'assets/ma_devseed_venue_26', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_26', now()),
  ('storephoto_devseed_27_1', 'store_devseed_27', 'biz_devseed_27', 'user_devseed_27', 'assets/ma_devseed_venue_27', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_27', now()),
  ('storephoto_devseed_28_1', 'store_devseed_28', 'biz_devseed_28', 'user_devseed_28', 'assets/ma_devseed_venue_28', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_28', now()),
  ('storephoto_devseed_29_1', 'store_devseed_29', 'biz_devseed_29', 'user_devseed_29', 'assets/ma_devseed_venue_scene_01', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_scene_01', now()),
  ('storephoto_devseed_30_1', 'store_devseed_30', 'biz_devseed_30', 'user_devseed_30', 'assets/ma_devseed_venue_scene_02', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 0, 'ma_devseed_venue_scene_02', now()),
  ('storephoto_devseed_01_2', 'store_devseed_01', 'biz_devseed_01', 'user_devseed_01', 'assets/ma_devseed_venue_scene_03', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_03', now()),
  ('storephoto_devseed_02_2', 'store_devseed_02', 'biz_devseed_02', 'user_devseed_02', 'assets/ma_devseed_venue_scene_04', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_04', now()),
  ('storephoto_devseed_03_2', 'store_devseed_03', 'biz_devseed_03', 'user_devseed_03', 'assets/ma_devseed_venue_scene_05', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_05', now()),
  ('storephoto_devseed_04_2', 'store_devseed_04', 'biz_devseed_04', 'user_devseed_04', 'assets/ma_devseed_venue_scene_06', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_06', now()),
  ('storephoto_devseed_05_2', 'store_devseed_05', 'biz_devseed_05', 'user_devseed_05', 'assets/ma_devseed_venue_scene_07', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_07', now()),
  ('storephoto_devseed_06_2', 'store_devseed_06', 'biz_devseed_06', 'user_devseed_06', 'assets/ma_devseed_venue_scene_08', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_08', now()),
  ('storephoto_devseed_07_2', 'store_devseed_07', 'biz_devseed_07', 'user_devseed_07', 'assets/ma_devseed_venue_scene_09', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_09', now()),
  ('storephoto_devseed_08_2', 'store_devseed_08', 'biz_devseed_08', 'user_devseed_08', 'assets/ma_devseed_venue_scene_10', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_10', now()),
  ('storephoto_devseed_09_2', 'store_devseed_09', 'biz_devseed_09', 'user_devseed_09', 'assets/ma_devseed_venue_scene_11', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_11', now()),
  ('storephoto_devseed_10_2', 'store_devseed_10', 'biz_devseed_10', 'user_devseed_10', 'assets/ma_devseed_venue_scene_12', 'Ảnh minh hoạ cho môi trường phát triển — không phải ảnh thật của quán', 1, 'ma_devseed_venue_scene_12', now())
ON CONFLICT (id) DO UPDATE
  SET store_id       = EXCLUDED.store_id,
      business_id    = EXCLUDED.business_id,
      uploaded_by    = EXCLUDED.uploaded_by,
      asset_path     = EXCLUDED.asset_path,
      caption        = EXCLUDED.caption,
      sort_order     = EXCLUDED.sort_order,
      media_asset_id = EXCLUDED.media_asset_id;

COMMIT;


-- ── 结果自检（应当 100 / 100 / 30 / 30 / 30 / 60 / 40）─────────────────────
SELECT 'identity.user_accounts' AS what, count(*) FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.profiles',          count(*) FROM identity.profiles        WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'business.accounts',          count(*) FROM business.accounts        WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.stores',            count(*) FROM business.stores          WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'business.memberships',       count(*) FROM business.memberships     WHERE business_id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.member_directory',  count(*) FROM business.member_directory WHERE business_id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.store_photos',      count(*) FROM business.store_photos    WHERE id LIKE 'storephoto_devseed_%'
UNION ALL SELECT '新增头像资产',                count(*) FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_%_portrait_v1'
UNION ALL SELECT '店面占位图资产',              count(*) FROM media.media_assets WHERE media_asset_id LIKE 'ma_devseed_venue_%'
-- 下面几条应当全为 0：指了不存在的店 / 头像指了不存在的资产 / 照片指了不存在的资产
UNION ALL SELECT 'profile 指向不存在的账号',    count(*) FROM identity.profiles p
   LEFT JOIN identity.user_accounts u ON u.id = p.user_account_id
   WHERE p.user_account_id LIKE 'user_devseed_%' AND u.id IS NULL
UNION ALL SELECT 'store 指向不存在的账号',      count(*) FROM business.stores s
   LEFT JOIN business.accounts a ON a.id = s.business_id
   WHERE s.id LIKE 'store_devseed_%' AND a.id IS NULL
UNION ALL SELECT '头像指向不存在的资产',        count(*) FROM identity.profiles p
   LEFT JOIN media.media_assets m ON m.media_asset_id = replace(p.avatar_path, 'assets/', '')
   WHERE p.user_account_id LIKE 'user_devseed_%' AND p.avatar_path <> '' AND m.media_asset_id IS NULL
UNION ALL SELECT '照片指向不存在的资产',        count(*) FROM business.store_photos sp
   LEFT JOIN media.media_assets m ON m.media_asset_id = sp.media_asset_id
   WHERE sp.id LIKE 'storephoto_devseed_%' AND m.media_asset_id IS NULL
ORDER BY 1;

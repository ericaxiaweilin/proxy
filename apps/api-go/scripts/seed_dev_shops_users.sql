-- seed_dev_shops_users.sql
--
-- DEV-ONLY 开发种子：**20 家真实店铺 + 30 个用户**。后期整体删除，见配套的
-- seed_dev_shops_users_remove.sql。
--
-- ## 数据来源与边界（重要，别照着扩散）
--
-- 店铺用**真实公开信息**：店名、街道地址、行政区、品类都取自公开的越南本地生活
-- 平台与旅游指南（Foody.vn / mia.vn / toplist.vn / coool.cafe / Vietnam Airlines
-- travel guide / 各店官网）。这些是**事实性公开信息**（营业地址不是谁的版权），
-- 拿来当开发种子不会侵犯任何人。
--
-- 但**用户是合成的**，不是从网上扒的真实个人：越南姓名风格 + 真实行政区，
-- 身份一律 `user_devseed_*` 前缀。理由不是版权 —— 是个人数据。越南
-- Nghị định 13/2023/NĐ-CP 把姓名/账号/画像当个人数据管，而这个项目自己在做
-- LC-15 隐私中心；往库里灌 30 个真实人的资料会跟自己的合规目标打架。
-- 真实商家 + 合成用户，是既能看清真实排版长度、又不碰真人数据的组合。
--
-- ## 为什么单独一个脚本，不进启动种子
--
-- 现有三个启动种子（supply / home rail / media）每次 boot 都灌，属于产品基线。
-- 这批是**临时开发数据**，用户明确说了"后期删除"。塞进 `cmd/api/wire_seed.go`
-- 就得改代码才能删，而 AGENTS.md 规定 app 包只放行为、不放可变业务内容 ——
-- 店铺和用户正是可变业务内容。所以它待在 `scripts/`，一条命令灌、一条命令删。
--
-- ## 幂等
--
-- `ON CONFLICT DO NOTHING` + 固定 ID，可重复执行。**不覆盖**已存在的行 ——
-- AGENTS.md：seed 路径必须 insert-if-absent，绝不 blind overwrite。
--
-- ## 头像
--
-- 复用库里已有的 30 个 creator 肖像媒体资产（`assets/<mediaAssetId>`，
-- 与 seed_creator_portraits.sql 同一套事实源），**不生成假头像文件** ——
-- 造一批指向不存在文件的 avatar_path，只会让 UI 上出现 30 个破图。
--
-- 执行：psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users.sql

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 30 个用户
--
-- 前 20 个是下面店铺的店主（business.accounts.owner_user_id 有外键指过来），
-- 后 10 个是没有店铺的普通用户 —— 用来让 feed / 推荐位 / 私信这些**不依赖店铺**
-- 的界面也有内容可看。全部 status=ACTIVE。
--
-- 姓名与行政区：越南姓名风格 + 真实城市/区（hà Nội / TP.HCM / Đà Nẵng / Huế）。
-- handle 用 @ 开头的规范形式（profiles 上有 lower(ltrim(handle,'@')) 唯一索引）。
-- avatar_path 指向真实存在的媒体资产。
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
  ('user_devseed_30', 'ACTIVE', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO identity.profiles
  (user_account_id, name, handle, bio, city, avatar_path, version, updated_at) VALUES
  -- 01–10：河内 / 河内周边店主
  ('user_devseed_01', 'Nguyễn Thị Bích Ngọc',  '@devseed_bichngoc',  'Pha cà phê trứng kiểu cũ ở Hà Nội. Mở từ 6h sáng.',       'Hà Nội',     'assets/ma_creator_ngoc_portrait_v1',      1, now()),
  ('user_devseed_02', 'Trần Minh Hạnh',      '@devseed_minhhanh',  'Quán nhỏ trong phố cổ. Ngồi được, chụp được.',              'Hà Nội',     'assets/ma_creator_vy_portrait_v1',      1, now()),
  ('user_devseed_03', 'Lê Hoàng Anh',        '@devseed_hoanganh',   'Bán cà phê rang xay, giao cả nội thành.',                        'Hà Nội',     'assets/ma_creator_hong_anh_portrait_v1', 1, now()),
  ('user_devseed_04', 'Phạm Quỳnh Anh',     '@devseed_quynhanh',   'Rượu vang và bistro. Mở tới khuya.',                              'Hà Nội',     'assets/ma_creator_quynh_anh_portrait_v1',1, now()),
  ('user_devseed_05', 'Vũ Đức Thành',        '@devseed_ducthanh',   'Cà phê sân vường, chỗ để làm việc buổi sáng.',                   'Hà Nội',     'assets/ma_creator_duy_khang_portrait_v1',1, now()),
  ('user_devseed_06', 'Đỗ Thùy Linh',        '@devseed_thuylinh',   'Trà sen và nước mía. Mở cửa tới 22h.',                          'Hà Nội',     'assets/ma_creator_ly_portrait_v1',        1, now()),
  ('user_devseed_07', 'Hoàng Kim Yến',       '@devseed_kimyen',     'Bánh ngọt kiểu Hà Nội, giữa phố cổ.',                            'Hà Nội',     'assets/ma_creator_yen_portrait_v1',      1, now()),
  ('user_devseed_08', 'Bùi Đức Kiên',        '@devseed_duckien',    'Cà phê công sở, wifi khoẻ, bàn nhiều.',                         'Hà Nội',     'assets/ma_creator_kien_portrait_v1',     1, now()),
  ('user_devseed_09', 'Ngô Trà My',          '@devseed_tramy',      'Cà phê sữa đá, view hồ Hoàn Kiếm.',                              'Hà Nội',     'assets/ma_creator_my_portrait_v1',       1, now()),
  ('user_devseed_10', 'Đặng Như Quỳnh',      '@devseed_nhuquynh',   'Quán cà phê lâu đời, làm theo công thức cũ.',                    'Hà Nội',     'assets/ma_creator_quynh_anh_portrait_v1',1, now()),
  -- 11–20：胡志明市 / 周边店主
  ('user_devseed_11', 'Trương Thị Mai',      '@devseed_mai',        'Quán cà phê trong hẻm, khách quen từ lâu.',                     'TP. Hồ Chí Minh', 'assets/ma_creator_mai_portrait_v1',   1, now()),
  ('user_devseed_12', 'Lê Anh Minh',         '@devseed_anhminh',    'Specialty coffee, rang tại chỗ.',                                 'TP. Hồ Chí Minh', 'assets/ma_creator_minh_portrait_v1',  1, now()),
  ('user_devseed_13', 'Phạm Thu Trang',      '@devseed_thutrang',   'Quán bar nhỏ, nhạc nhẹ, mở tới 2h sáng.',                     'TP. Hồ Chí Minh', 'assets/ma_creator_thu_trang_portrait_v1',1, now()),
  ('user_devseed_14', 'Vũ Hoàng Long',       '@devseed_hoanglong',  'Món Việt, giá bình dân, phục vụ cả ngày.',                      'TP. Hồ Chí Minh', 'assets/ma_creator_long_portrait_v1', 1, now()),
  ('user_devseed_15', 'Nguyễn Thị Lan',      '@devseed_lan',        'Cà phê sân vường, chỗ ngồi yên tĩnh giữa lõi.',               'TP. Hồ Chí Minh', 'assets/ma_creator_lan_portrait_v1',  1, now()),
  ('user_devseed_16', 'Trần Bảo Nam',        '@devseed_baonam',     'Cà phê vintage, nhạc jazz cuối tuần.',                           'TP. Hồ Chí Minh', 'assets/ma_creator_nam_portrait_v1',  1, now()),
  ('user_devseed_17', 'Phạm Quốc Huy',       '@devseed_quochuy',    'Quán ăn gia đình, mỗi ngày một món.',                           'TP. Hồ Chí Minh', 'assets/ma_creator_huy_portrait_v1',   1, now()),
  ('user_devseed_18', 'Đỗ Thị Hồng Nhung',   '@devseed_hongnhung',  'Trà trái cây, đồ ngọt. Ship nội quận.',                           'TP. Hồ Chí Minh', 'assets/ma_creator_hong_anh_portrait_v1',1, now()),
  ('user_devseed_19', 'Ngô Thanh Sơn',       '@devseed_thanhson',   'Cà phê view cao, chụp ảnh ban đêm.',                             'TP. Hồ Chí Minh', 'assets/ma_creator_son_portrait_v1',  1, now()),
  ('user_devseed_20', 'Hoàng Thị Thảo Nhi',  '@devseed_thaonhi',    'Bánh mì và cà phê sáng, lấy đi cũng được.',                     'TP. Hồ Chí Minh', 'assets/ma_creator_thao_nhi_portrait_v1',1, now()),
  -- 21–30：无店铺的普通用户 —— 让 feed / 推荐 / 私信这些不依赖店铺的界面有内容
  ('user_devseed_21', 'Lê Quốc Dũng',        '@devseed_quocdung',   'Đi cà phê cuối tuần, thích quán có wifi.',                       'TP. Hồ Chí Minh', 'assets/ma_creator_an_portrait_v1',   1, now()),
  ('user_devseed_22', 'Phan Thị Thu Hà',     '@devseed_thuha',      'Tìm quán ăn gia đình, không chịu ồn.',                          'Hà Nội',     'assets/ma_creator_hai_portrait_v1',      1, now()),
  ('user_devseed_23', 'Vũ Khánh Duy',        '@devseed_khanduy',    'Đi bộ khám phá phố cổ sáng sớm.',                                'Hà Nội',     'assets/ma_creator_duy_khang_portrait_v1',1, now()),
  ('user_devseed_24', 'Trịnh Thùy Linh',     '@devseed_thuylinh2',  'Ăn chay, tìm quán có menu rõ.',                                'Đà Nẵng',   'assets/ma_creator_ly_portrait_v1',        1, now()),
  ('user_devseed_25', 'Đỗ Hoàng Sơn',        '@devseed_hoangson',   'Cà phê sữa đá là ngon nhất.',                                    'Huế',       'assets/ma_creator_son_portrait_v1',      1, now()),
  ('user_devseed_26', 'Nguyễn Thị Bích',     '@devseed_bich',       'Chụp ảnh phố, không quan tâm quán nào đẹp.',                     'Hà Nội',     'assets/ma_creator_phuong_portrait_v1',    1, now()),
  ('user_devseed_27', 'Trương Văn Khoa',     '@devseed_vankhoa',    'Đi dã ngoại cuối tuần ở ngoại ô.',                              'TP. Hồ Chí Minh', 'assets/ma_creator_khoa_portrait_v1',  1, now()),
  ('user_devseed_28', 'Lê Thị Phương Thanh', '@devseed_phuongthanh','Nhà sống gần chợ, ăn sáng ở quán đầu ngõ.',                    'TP. Hồ Chí Minh', 'assets/ma_creator_phuong_thanh_portrait_v1',1, now()),
  ('user_devseed_29', 'Cao Thị Yến',         '@devseed_yen',        'Sống ở Huế, hay đi chợ sớm.',                                   'Huế',       'assets/ma_creator_yen_portrait_v1',      1, now()),
  ('user_devseed_30', 'Phan Anh Tuấn',       '@devseed_.anhtuan',   'Chạy xe ôm, biết hết đường Hà Nội.',                            'Hà Nội',     'assets/ma_creator_tu_portrait_v1',      1, now())
ON CONFLICT (user_account_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20 家真实店铺
--
-- 店名 / 地址 / 行政区 / 品类取自公开来源（见文件头）。每个 owner 一个 business.accounts
-- + 一个 business.stores（一店一主体，方便对着真实店一家家核）。
--
-- reality_scene_id 留空（''）而不是瞎指一个场景：business.stores 上有
-- `idx_stores_reality_scene ... WHERE reality_scene_id <> ''`，指错的场景会让
-- 「附近的店」出现在不相干的地点，比空着更难排查。要挂场景再用
-- LinkStoreToRealityScene 明确挂。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
SELECT
  'biz_devseed_' || lpad(g.n::text, 2, '0'),
  'user_devseed_' || lpad(g.n::text, 2, '0'),
  g.biz_name,
  'ACTIVE',
  now()
FROM (VALUES
  ( 1, 'Mộc Cafe'),
  ( 2, 'Cà Phê Trứng 3T — Điện Biên Phủ'),
  ( 3, 'Cà Phê Trứng 3T — Tôn Đức Thắng'),
  ( 4, 'Cà Phê Trứng 3T — Trần Khánh Dư'),
  ( 5, 'Hội Coffee'),
  ( 6, 'Soul Specialty Coffee'),
  ( 7, 'Goya Coffee'),
  ( 8, 'Tiệm Cà Phê Tân Thời'),
  ( 9, 'The August Coffee'),
  (10, 'Mơ đi Hội'),
  (11, 'Café Giảng'),
  (12, 'Café Đình'),
  (13, 'Cà Bóp'),
  (14, 'Aha Cafe'),
  (15, 'RuNam Bistro'),
  (16, 'Cafe Lâm'),
  (17, 'Cafe de Mo'),
  (18, 'Phê La'),
  (19, 'Sài Gòn Chic Cafe'),
  (20, 'Country House Cafe')
) AS g(n, biz_name)
ON CONFLICT (id) DO NOTHING;

INSERT INTO business.stores (id, business_id, name, address, status, category, reality_scene_id, created_at)
SELECT
  'store_devseed_' || lpad(g.n::text, 2, '0'),
  'biz_devseed_' || lpad(g.n::text, 2, '0'),
  g.store_name,
  g.address,
  'ACTIVE',
  g.category,
  '',
  now()
FROM (VALUES
  -- 胡志明市（店名 / 地址来自 Foody.vn、mia.vn、toplist.vn、coool.cafe 的公开页面）
  ( 1, 'Mộc Cafe — Nguyễn Trãi',            '212B/32 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',  'Cà phê / Đồ ngọt'),
  ( 2, 'Cà Phê Trứng 3T — Điện Biên Phủ',   '250 Điện Biên Phủ, Phường Võ Thị Sáu, Quận 3, TP. Hồ Chí Minh',  'Cà phê / Đồ ngọt'),
  ( 3, 'Cà Phê Trứng 3T — Tôn Đức Thắng',   '1A Tôn Đức Thắng, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',      'Cà phê / Đồ ngọt'),
  ( 4, 'Cà Phê Trứng 3T — Trần Khánh Dư',   '5 Trần Khánh Dư, Phường Tân Định, Quận 1, TP. Hồ Chí Minh',      'Cà phê / Đồ ngọt'),
  ( 5, 'Hội Coffee',                        '54 Hẻm 7 Trần Quang Diệu, Phường 14, Quận 3, TP. Hồ Chí Minh',   'Cà phê'),
  ( 6, 'Soul Specialty Coffee',             '386/11 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh',            'Specialty coffee'),
  ( 7, 'Goya Coffee',                       '14 Hoàng Diệu, Phường 10, Phú Nhuận, TP. Hồ Chí Minh',           'Cà phê'),
  ( 8, 'Tiệm Cà Phê Tân Thời',              '386/5 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh',           'Cà phê / Brunch'),
  ( 9, 'The August Coffee',                 'Lầu 4, Chung cư 145 Nguyễn Trãi, Phường Phạm Ngũ Lão, Quận 1, TP. Hồ Chí Minh', 'Cà phê'),
  (10, 'Mơ đi Hội',                         '25A Nguyễn Bỉnh Khiêm, Phường Sài Gòn, Quận 1, TP. Hồ Chí Minh',  'Cà phê / Đồ ngọt'),
  -- 河内（店名 / 地址来自 Vietnam Airlines travel guide、flavorsofhanoi.com、
  --        cabop.vn、aha cafe 官方页、motogo.tours 的公开页面）
  (11, 'Café Giảng',                        '39 Nguyễn Hữu Huân, Phường Nguyễn Hữu Huân, Hoàn Kiếm, Hà Nội',   'Cà phê trứng'),
  (12, 'Café Đình',                         '13 Đinh Tiên Hoàng, Phường Hàng Trống, Hoàn Kiếm, Hà Nội',        'Cà phê trứng'),
  (13, 'Cà Bóp',                            '56 Hàng Gai, Phường Hàng Gai, Hoàn Kiếm, Hà Nội',                 'Cà phê / Bistro'),
  (14, 'Aha Cafe',                          '6 Phố Thuốc Bắc, Phường Hàng Bồ, Hoàn Kiếm, Hà Nội',             'Cà phê'),
  (15, 'RuNam Bistro',                      '13 Nhà Thờ, Phường Nhà Thờ, Hoàn Kiếm, Hà Nội',                  'Bistro'),
  (16, 'Cafe Lâm',                          '60 Nguyễn Hữu Huân, Phường Hàng Bạc, Hoàn Kiếm, Hà Nội',        'Cà phê'),
  (17, 'Cafe de Mo',                        '151 Phùng Hưng, Phường Cửa Đông, Hoàn Kiếm, Hà Nội',              'Cà phê'),
  (18, 'Phê La',                            '24 Hàng Cót, Phường Hàng Bột, Hoàn Kiếm, Hà Nội',                'Cà phê / Trà'),
  (19, 'Sài Gòn Chic Cafe',                  '187 Hai Bà Trưng, Phường Võ Thị Sáu, Quận 3, TP. Hồ Chí Minh',  'Cà phê / Tiệc'),
  (20, 'Country House Cafe',                'Lầu 3, 496 Nguyễn Thị Minh Khai, Phường 2, Quận 3, TP. Hồ Chí Minh', 'Cà phê / Đồ ăn')
) AS g(n, store_name, address, category)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── 结果自检（应当 30 / 20 / 20）──────────────────────────────────────────────
SELECT 'identity.user_accounts (devseed)' AS what, count(*) FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.profiles (devseed)',          count(*) FROM identity.profiles        WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'business.accounts (devseed)',          count(*) FROM business.accounts        WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'business.stores (devseed)',            count(*) FROM business.stores          WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'store 缺 address 或 category',          count(*) FROM business.stores WHERE id LIKE 'store_devseed_%' AND (address = '' OR category = '')
ORDER BY 1;

-- seed_dev_shops_users_posts.sql
--
-- DEV-ONLY：给 seed_dev_shops_users.sql 那 30 个用户各发 1 条公开帖子（共 30 条）。
-- 配套删除见 seed_dev_shops_users_remove.sql（同一个脚本，一起删）。
--
-- ## 为什么单独一个文件：数据在库里 ≠ 界面上看得到
--
-- 2026-09-30 灌完 20 店 + 30 用户之后，用户在模拟器里看不到任何变化。查出来是
-- 两个原因，都不是"数据没灌进去"：
--
-- 1. **feed 只显示帖子，不显示用户。** 30 个用户建好之后 `localnet.posts` 里
--    一条他们的帖子都没有，所以 feed 翻到底也不会出现他们 —— 对一个刷信息流的
--    界面来说，"多了 30 个用户但一个都看不见" 等于没加。
-- 2. **`ListBusinessStores` 是 `WHERE business_id=$1`**，只返回**当前登录商家自己
--    的店**。20 家新店各有独立 owner，模拟器里登录的那个账号一家都看不到 ——
--    这是设计如此（商家只该看到自己的店），不是 bug，但它意味着"新增 20 家店"
--    对当前那个登录态是不可见的。要验证得用其中一个店主的账号登录。
--
-- 所以这个文件补的是**帖子**：让 30 个用户真正出现在 feed 里，店主的帖子同时
-- 也充当"这家店在营业"的可视信号。
--
-- ## 时间戳是关键
--
-- feed 的排序是 `created_at DESC`（见 idx_posts_feed_keyset）。库里现有 107 条帖子
-- 全部停在 2026-09-25 及更早，而这些 devseed 用户是今天才加的。如果 `created_at`
-- 写成 `now()` 就会好；但为了**幂等**（重跑不改变已有行的排序位置），
-- 这里用**固定的过去时间**而不是 now()，落在现有数据之后 —— 既能排到前面，
-- 又重跑不变。
--
-- ## 形状照着现有帖子抄，不猜
--
-- media_refs 的元素是**对象** `{"sortOrder":0,"mediaAssetId":"ma_…"}`，不是裸字符串 ——
-- 我第一版写成 `["ma_…"]`，两种形状混在一起，读模型解析时会拿到 undefined 的
-- mediaAssetId，界面就是一片没有图的帖子。是自检那条「指向不存在资产」把问题揪出来的：
-- 它报 8 条，而那 8 条其实存在，只是取键取不到。
--
-- 现有 mockcreator 帖子的实测形状：`media_refs` 有两种值 —— 47 条是 JSON `null`
-- （`'null'::jsonb`）、其余是数组；**107 条里没有一条是 SQL NULL**（列是 NOT NULL）。
-- 所以"没图"的帖子要写 `'null'::jsonb`，写裸 NULL 会撞 not-null 约束。
-- 这也是我第一版的错：看 `jsonb_typeof` 读到 "null" 就以为列里是 SQL NULL。、
-- `author_type='USER'`、`status='PUBLISHED'`、`visibility='PUBLIC'`、
-- `city_scope` 用简写 `hcm` / `hn` / `danang`、`scene_type` 是 `BRUNCH` /
-- `CINEMA` / `OUTDOOR` / `CAFE` 这一类。第一版我照"直觉"写了 `media_refs: []`
-- 和完整城市名 `TP. Hồ Chí Minh` —— 那会让这些帖子在按 city_scope 分城过滤的
-- 读模型里落空。**照着能跑通的数据抄形状，不要凭想象填。**
--
-- 媒体：部分帖子挂库里真实存在的 READY 图片资产（mediaAssetId），
-- 其余 media_refs 留 null —— 与现有帖子一致。
--
-- scene_type **有 CHECK 约束**，枚举只有这九个：UNKNOWN / ROOFTOP / BRUNCH / SPA /
-- CINEMA / PHOTO / NIGHTLIFE / OUTDOOR / COFFEE。第一版我按直觉填了 `CAFE` /
-- `DINNER` / `BREAKFAST` / `COWORK`，四个都不在枚举里，灌进去直接撞约束 ——
-- 枚举要从 pg_constraint 里读，不要猜（查法见文件末尾）。
--
-- 执行：psql "$DATABASE_URL" -f apps/api-go/scripts/seed_dev_shops_users_posts.sql
--
-- 查枚举：SELECT pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conname='posts_scene_type_check';

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO localnet.posts
  (id, author_type, author_id, author_display_name, body, media_refs,
   visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until)
SELECT
  'post_devseed_' || lpad(g.n::text, 2, '0'),
  'USER',
  'user_devseed_' || lpad(g.n::text, 2, '0'),
  g.display_name,
  g.body,
  g.media_refs,
  'PUBLIC',
  g.city_scope,
  g.scene_type,
  'PUBLISHED',
  '[]'::jsonb,
  ts.created_at,
  NULL
FROM (VALUES
  -- 河内店主（01–10）：真实地址 / 真实店名的场景化内容
  ( 1, 'Nguyễn Thị Bích Ngọc', 'Sáng nay mở quán 6h, cà phê trứng và trà sen. Ai đi ngang Hoàn Kiếm thử một ly nhé.',           'hn',     'COFFEE',     jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_014ca1b45a5b6a2bbfa20f1f'))),
  ( 2, 'Trần Minh Hạnh',      'Quán trong phố cổ, không có máy lạnh, không có wifi. Ngồi tán gẫu mấy tiếng rồi đi.',            'hn',     'COFFEE',     'null'::jsonb),
  ( 3, 'Lê Hoàng Anh',        'Cà phê rang xay tại chỗ, giao nội thành trong 2 tiếng. Đặt trước khi quán đông.',                'hn',     'COFFEE',     'null'::jsonb),
  ( 4, 'Phạm Quỳnh Anh',     'Bistro mở tới khuya. Bữa tối nay có món mới, ngồi trong nhà kính giữa phố.',                    'hn',     'BRUNCH',   jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_028095d623e06ddae7563ed1'))),
  ( 5, 'Vũ Đức Thành',        'Bàn trong góc sân vường hôm nay ngồi hết từ 8h. WiFi ổn, có ổ cắm.',                          'hn',     'COFFEE',   'null'::jsonb),
  ( 6, 'Đỗ Thùy Linh',        'Nước mía vừa nấu xong, mát lạnh. Quán mở tới 22h, mùa này uống điên rồi.',                        'hn',     'COFFEE',     jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_0290232d200ee2da43d931e5'))),
  ( 7, 'Hoàng Kim Yến',       'Bánh cuốn sáng nay còn nóng, 7h bán hết. Phố cổ giờ này chờ lâu nhưng đáng.',                    'hn',     'BRUNCH',   'null'::jsonb),
  ( 8, 'Hoàng Kim Yến',       'Bàn học tập chiều nay đã kín. Ai tìm chỗ có ổ cắm thì ghé tầng hai nhé.',                        'hn',     'COFFEE',   'null'::jsonb),
  ( 9, 'Ngô Trà My',          'Ngắm hồ Hoàn Kiếm buổi sáng, cà phê sữa đá nhé. Tầng hai nhìn được hết một góc hồ.',               'hn',     'COFFEE',     jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_09f039b113af99028358d7c5'))),
  (10, 'Đặng Như Quỳnh',      'Công thức cũ giữ nguyên, trứng và sữa đặc như hồi thập lăm. Bốn mươi năm chưa đổi.',               'hn',     'COFFEE',     'null'::jsonb),
  -- 胡志明市店主（11–20）
  (11, 'Trương Thị Mai',      'Quán trong hẻm, ngồi vỉa hè ăn mì Quảng sáng nay. Cuối tuần hơi đông.',                         'hcm',    'BRUNCH',   jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_0ab73d0bf4c02c8a4834d4fc'))),
  (12, 'Lê Anh Minh',         'Batch mới rang xong, dùng cà phê Đắk Lắk. Hôm nay pha tay không, pha máy cũng được.',          'hcm',    'COFFEE',     'null'::jsonb),
  (13, 'Phạm Thu Trang',      'Nhạc nhẹ từ 21h, quán nhỏ thôi nhưng nhạc vừa phải. Khuya rảnh nhất.',                          'hcm',    'NIGHTLIFE',jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_0dff0c0ca239e845a7c1b355'))),
  (14, 'Vũ Hoàng Long',       'Phở sáng, bán đến 10h là hết. Quán bảy mở từ 5h40.',                                       'hcm',    'BRUNCH',jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_10adf897d9f10e5381a0f8e3'))),
  (15, 'Lê Anh Minh',         'Chiều nay ngồi ngoài vườn mát, uống trà đá. Cây bàng mới trồng thêm bốn cây.',                 'hcm',    'COFFEE',     'null'::jsonb),
  (16, 'Trần Bảo Nam',        'Jazz cuối tuần bắt đầu 20h. Nhạc cũ, không nhạc sàn.',                                     'hcm',    'NIGHTLIFE','null'::jsonb),
  (17, 'Phạm Quốc Huy',       'Món nay là canh chua mắm tôm cuối cùng của mùa. Nhà mình làm ăn, không phải quán ăn.',        'hcm',    'BRUNCH',   'null'::jsonb),
  (18, 'Đỗ Thị Hồng Nhung',   'Trà trái cây mới, đá xay kiểu Đà Lạt. Ship nội quận trước 9h.',                             'hcm',    'COFFEE',     jsonb_build_array(jsonb_build_object('sortOrder', 0, 'mediaAssetId', 'ma_136c12f38e86add5a3bf62c2'))),
  (19, 'Ngô Thanh Sơn',       'Tầng cao nhìn được cả thành phố tối. Đặt bàn trước để chỗ, cuối tuần kín lắm.',               'hcm',    'NIGHTLIFE','null'::jsonb),
  (20, 'Hoàng Thị Thảo Nhi',  'Bánh mì ốp lò, 6h bán. Bỏ qua thì 8h là hết, hết là hết không có lần hai.',                   'hcm',    'BRUNCH','null'::jsonb),
  -- 无店普通用户（21–30）：让 feed 的作者多样性成立
  (21, 'Lê Quốc Dũng',        'Tìm được quán có wifi và ổ cắm sau ba quán. Ghi lại cho người sau.',                            'hcm',    'COFFEE',     'null'::jsonb),
  (22, 'Phan Thị Thu Hà',     'Quán ăn gia đình tối nay, không nghe nhạc, không gọi điện thoại. Ăn xong mới yên.',               'hn',     'BRUNCH',   'null'::jsonb),
  (23, 'Vũ Khánh Duy',        'Sáng sớm đi vòng hồ, gặp sương mù. Đi bộ từ 5h là chuyện thường.',                          'hn',     'OUTDOOR',  'null'::jsonb),
  (24, 'Trịnh Thùy Linh',     'Đà Nẵng hôm nay nắng gắt, quán nào cũng ổn miễn có máy lạnh.',                             'danang', 'COFFEE',     'null'::jsonb),
  (25, 'Đỗ Hoàng Sơn',        'Huế sáng nay yên, phố phường chưa đông. Đi dạo từ lúc 5h cho đỡ nắng.',                        'hue',    'OUTDOOR',  'null'::jsonb),
  (26, 'Nguyễn Thị Bích',     'Chụp phố lúc sáng sớm, không khách nào, chỉ có xe rác.',                                     'hn',     'OUTDOOR',  'null'::jsonb),
  (27, 'Trương Văn Khoa',     'Cuối tuần lái xe đi Vũng Tàu, hai tiếng. Đường ven biển buổi sáng đẹp lắm.',                  'hcm',    'OUTDOOR',  'null'::jsonb),
  (28, 'Lê Thị Phương Thanh', 'Nhà gần chợ, sáng nào cũng ăn ở quán đầu ngõ. Chủ quán nhớ mặt từng người.',                    'hcm',    'BRUNCH',   'null'::jsonb),
  (29, 'Cao Thị Yến',         'Chợ Huế bốn giờ đã đông. Mua mắm tôm về nấu, nồi nước mắm nhà ngoại kéo dài cả buổi.',          'hue',    'OUTDOOR',  'null'::jsonb),
  (30, 'Phan Anh Tuấn',       'Ngày nào không chạy xe thì ngày đó đi cà phê. Lộ trình cũng là một phần công việc.',               'hn',     'COFFEE',     'null'::jsonb)
) AS g(n, display_name, body, city_scope, scene_type, media_refs)
-- 固定时间戳，不用 now()：feed 按 created_at DESC 排序，用 now() 会让每次重跑
-- 把这些帖子顶到最前面（位置一直在变），用固定时间才能既排得进前排又幂等。
-- 时间落在现有数据（止于 2026-09-25）之后。
CROSS JOIN LATERAL (SELECT TIMESTAMPTZ '2026-09-27 08:00:00+07'
                    + (g.n || ' hours')::interval) AS ts(created_at)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── 结果自检 ─────────────────────────────────────────────────────────────────
SELECT 'devseed 帖子' AS what, count(*) FROM localnet.posts WHERE id LIKE 'post_devseed_%'
UNION ALL SELECT '作者确实是 devseed 用户', count(*) FROM localnet.posts p
            JOIN identity.user_accounts u ON u.id = p.author_id WHERE p.id LIKE 'post_devseed_%'
-- jsonb_array_elements 在 media_refs 是 JSON `null`（标量）时报
-- "cannot extract elements from a scalar"，所以先按 jsonb_typeof 过滤掉标量 ——
-- 只对真的是数组的行展开。第一版直接 COALESCE(media_refs,'[]') 也不行：
-- JSON null 不是 SQL NULL，COALESCE 不会替换它。
UNION ALL SELECT 'media_refs 指向不存在资产',
            (SELECT count(*)
               FROM localnet.posts p
               CROSS JOIN LATERAL jsonb_array_elements(p.media_refs) m
               LEFT JOIN media.media_assets a ON a.media_asset_id = m->>'mediaAssetId'
              WHERE p.id LIKE 'post_devseed_%'
                AND jsonb_typeof(p.media_refs) = 'array'
                AND a.media_asset_id IS NULL)
ORDER BY 1;

-- seed_dev_shops_users_posts.sql
--
-- DEV-ONLY：给 seed_dev_shops_users.sql 那 100 个用户各发 1 条公开帖子（共 100 条）。
-- 配套删除见 seed_dev_shops_users_remove.sql（同一个脚本，一起删）。
--
-- ⚠️ 本文件由 apps/api-go/scripts/mockdata/gen_mockdata.py 生成。
--    要改数据请改 mockdata/spec.py，然后重跑生成器。
--
-- ## 为什么单独一个文件：数据在库里 ≠ 界面上看得到
--
-- 2026-09-30 灌完店铺 + 用户之后，用户在模拟器里看不到任何变化。查出来是
-- 两个原因，都不是"数据没灌进去"：
--
-- 1. **feed 只显示帖子，不显示用户。** 用户建好之后 `localnet.posts` 里
--    一条他们的帖子都没有，所以 feed 翻到底也不会出现他们 —— 对一个刷信息流的
--    界面来说，"多了 100 个用户但一个都看不见" 等于没加。
-- 2. **`ListBusinessStores` 是 `WHERE business_id=$1`**，只返回**当前登录商家自己
--    的店**。30 家新店各有独立 owner，模拟器里登录的那个账号一家都看不到 ——
--    这是设计如此（商家只该看到自己的店），不是 bug，但它意味着"新增 30 家店"
--    对当前那个登录态是不可见的。要验证得用其中一个店主的账号登录。
--
-- 所以这个文件补的是**帖子**：让 100 个用户真正出现在 feed 里，店主的帖子同时
-- 也充当"这家店在营业"的可视信号。
--
-- ## 时间戳是关键
--
-- feed 的排序是 `created_at DESC`（见 idx_posts_feed_keyset）。库里现有帖子
-- 停在更早的日期，而这些 devseed 用户是后加的。如果 `created_at` 写成 `now()`
-- 就会好；但为了**幂等**（重跑不改变已有行的排序位置），这里用**固定的过去时间**
-- 而不是 now()，落在现有数据之后 —— 既能排到前面，又重跑不变。
--
-- ## 形状照着现有帖子抄，不猜
--
-- media_refs 的元素是**对象** `{"sortOrder":0,"mediaAssetId":"ma_…"}`，不是裸字符串 ——
-- 第一版写成 `["ma_…"]` 时，两种形状混在一起，读模型解析时会拿到 undefined 的
-- mediaAssetId，界面就是一片没有图的帖子。是自检那条「指向不存在资产」把问题
-- 揪出来的：它报 8 条，而那 8 条其实存在，只是取键取不到。
--
-- 「没图」的帖子写 `'null'::jsonb`（列是 NOT NULL，写裸 NULL 会撞约束）。
-- `author_type='USER'`、`status='PUBLISHED'`、`visibility='PUBLIC'`、
-- `city_scope` 用简写 `hn` / `hcm` / `danang` / `hue` / `bacninh`、
-- `scene_type` 必须落在 CHECK 枚举里（查法见文件末尾）。
-- **照着能跑通的数据抄形状，不要凭想象填。**
--
-- scene_type 枚举只有这九个：UNKNOWN / ROOFTOP / BRUNCH / SPA / CINEMA /
-- PHOTO / NIGHTLIFE / OUTDOOR / COFFEE。
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
  g.post_id,
  'USER',
  g.author_id,
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
  (1, 'post_devseed_01', 'user_devseed_01', 'Nguyễn Thị Bích Ngọc', 'Sáng nay mở quán 6h, cà phê cốt dừa và trà sen. Ai đi ngang Cầu Gỗ thử một ly nhé.', 'hn', 'COFFEE', 'null'::jsonb),
  (2, 'post_devseed_02', 'user_devseed_02', 'Trần Minh Hạnh', 'Quán nhỏ trên Yên Ninh, không máy lạnh, không wifi. Ngồi tán gẫu mấy tiếng rồi đi.', 'hn', 'COFFEE', 'null'::jsonb),
  (3, 'post_devseed_03', 'user_devseed_03', 'Lê Hoàng Anh', 'Cà phê rang xay tại chỗ, giao nội thành trong 2 tiếng. Đặt trước khi quán đông.', 'hn', 'COFFEE', 'null'::jsonb),
  (4, 'post_devseed_04', 'user_devseed_04', 'Phạm Quỳnh Anh', 'Cà phê trứng làm theo công thức cũ. Bốn mươi năm chưa đổi.', 'hn', 'COFFEE', 'null'::jsonb),
  (5, 'post_devseed_05', 'user_devseed_05', 'Vũ Đức Thành', 'Bàn ngoài sân hôm nay ngồi hết từ 8h. Ai tìm chỗ yên tĩnh thì ghé sớm.', 'hn', 'BRUNCH', 'null'::jsonb),
  (6, 'post_devseed_06', 'user_devseed_06', 'Đỗ Thùy Linh', 'Bàn trong góc hôm nay kín từ 8h. Có ổ cắm, ngồi làm việc được.', 'hn', 'COFFEE', 'null'::jsonb),
  (7, 'post_devseed_07', 'user_devseed_07', 'Hoàng Kim Yến', 'Bánh ngọt ra lò 7h, bán hết là hết. Phố cổ giờ này chờ hơi lâu nhưng đáng.', 'hn', 'BRUNCH', 'null'::jsonb),
  (8, 'post_devseed_08', 'user_devseed_08', 'Bùi Đức Kiên', 'Bàn làm việc chiều nay đã kín. Tầng hai còn chỗ, có ổ cắm.', 'hn', 'COFFEE', 'null'::jsonb),
  (9, 'post_devseed_09', 'user_devseed_09', 'Ngô Trà My', 'Ngắm hồ Hoàn Kiếm buổi sáng, cà phê sữa đá. Tầng hai nhìn được một góc hồ.', 'hn', 'COFFEE', 'null'::jsonb),
  (10, 'post_devseed_10', 'user_devseed_10', 'Đặng Như Quỳnh', 'Công thức cũ giữ nguyên, trứng và sữa đặc như hồi thập lăm.', 'hn', 'COFFEE', 'null'::jsonb),
  (11, 'post_devseed_11', 'user_devseed_11', 'Trương Thị Mai', 'Quán trong ngõ, ngồi vỉa hè sáng nay. Cuối tuần hơi đông.', 'hn', 'COFFEE', 'null'::jsonb),
  (12, 'post_devseed_12', 'user_devseed_12', 'Lê Anh Minh', 'Batch mới rang xong, dùng cà phê Đắk Lắk. Hôm nay pha tay không, pha máy cũng được.', 'hn', 'COFFEE', 'null'::jsonb),
  (13, 'post_devseed_13', 'user_devseed_13', 'Phạm Thu Trang', 'Nhạc nhẹ từ 21h, quán nhỏ thôi nhưng nhạc vừa phải. Khuya rảnh nhất.', 'hn', 'NIGHTLIFE', 'null'::jsonb),
  (14, 'post_devseed_14', 'user_devseed_14', 'Vũ Hoàng Long', 'Món Việt bán cả ngày, trưa đông hơn tối. Không nhận đặt bàn trưa.', 'hn', 'BRUNCH', 'null'::jsonb),
  (15, 'post_devseed_15', 'user_devseed_15', 'Nguyễn Thị Lan', 'Chiều nay ngồi ngoài vườn mát, uống trà đá. Cây mới trồng thêm bốn cây.', 'hn', 'COFFEE', 'null'::jsonb),
  (16, 'post_devseed_16', 'user_devseed_16', 'Trần Bảo Nam', 'Jazz cuối tuần bắt đầu 20h. Nhạc cũ, không nhạc sàn.', 'hn', 'NIGHTLIFE', 'null'::jsonb),
  (17, 'post_devseed_17', 'user_devseed_17', 'Phạm Quốc Huy', 'Món nay là canh chua cuối cùng của mùa. Nhà mình làm ăn, không phải quán ăn.', 'hn', 'BRUNCH', 'null'::jsonb),
  (18, 'post_devseed_18', 'user_devseed_18', 'Đỗ Thị Hồng Nhung', 'Trà trái cây mới, đá xay kiểu Đà Lạt. Ship nội thành trước 9h.', 'hn', 'COFFEE', 'null'::jsonb),
  (19, 'post_devseed_19', 'user_devseed_19', 'Ngô Thanh Sơn', 'Tầng cao nhìn được cả thành phố buổi tối. Cuối tuần kín, nên gọi trước.', 'bacninh', 'NIGHTLIFE', 'null'::jsonb),
  (20, 'post_devseed_20', 'user_devseed_20', 'Hoàng Thị Thảo Nhi', 'Bánh mì nướng, 6h bán. Bỏ qua thì 8h là hết, hết là hết không có lần hai.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (21, 'post_devseed_21', 'user_devseed_21', 'Lê Quốc Dũng', 'Cà phê rang mộc, pha máy. Hạt mới về tuần này.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (22, 'post_devseed_22', 'user_devseed_22', 'Phan Thị Thu Hà', 'Trà và cà phê, chỗ ngồi ngoài vườn. Buổi chiều mát hơn trong nhà.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (23, 'post_devseed_23', 'user_devseed_23', 'Vũ Khánh Duy', 'Quán cạnh hồ, sáng sớm có sương. Ngồi ngoài được tới 9h.', 'bacninh', 'OUTDOOR', 'null'::jsonb),
  (24, 'post_devseed_24', 'user_devseed_24', 'Trịnh Thùy Linh', 'Quán trong ngõ, ít khách ồn. Ai cần chỗ yên thì đây.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (25, 'post_devseed_25', 'user_devseed_25', 'Đỗ Hoàng Sơn', 'Cà phê sữa đá là ngon nhất. Đá ít hay nhiều thì nói lúc gọi.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (26, 'post_devseed_26', 'user_devseed_26', 'Nguyễn Thị Bích', 'Quán nhỏ gần chợ, mở từ 6h. Sáng nào cũng có khách quen.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (27, 'post_devseed_27', 'user_devseed_27', 'Trương Văn Khoa', 'Quán ăn gia đình mở cả ngày. Cuối tuần nhận đặt tiệc nhỏ.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (28, 'post_devseed_28', 'user_devseed_28', 'Lê Thị Phương Thanh', 'Nhà hàng nhỏ, phục vụ tiệc gia đình. Đặt trước hai ngày là chắc.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (29, 'post_devseed_29', 'user_devseed_29', 'Cao Thị Yến', 'Quán ăn sáng mở từ 6h, 10h là nghỉ. Món theo ngày.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (30, 'post_devseed_30', 'user_devseed_30', 'Phan Anh Tuấn', 'Hải sản tươi về mỗi sáng. Nhận đặt bàn, cuối tuần nên gọi trước.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (31, 'post_devseed_31', 'user_devseed_31', 'An Nhiên', 'Chạy vòng hồ Tây lúc 5h30, sương còn chưa tan. Đi sớm hơn tuần trước.', 'hn', 'OUTDOOR', 'null'::jsonb),
  (32, 'post_devseed_32', 'user_devseed_32', 'Bảo Châu', 'Vừa thử một ly single origin Ethiopia, chua nhẹ. Uống nguội ngon hơn nóng.', 'hn', 'COFFEE', 'null'::jsonb),
  (33, 'post_devseed_33', 'user_devseed_33', 'Bích Ngọc', 'Chợ phiên cuối tuần nay có nhiều hoa cúc. Mua về cắm được cả tuần.', 'hn', 'OUTDOOR', 'null'::jsonb),
  (34, 'post_devseed_34', 'user_devseed_34', 'Cao Minh', 'Đạp xe vòng phố cổ sáng nay, đường vắng. Ghi lại mấy quán mở sớm.', 'hn', 'OUTDOOR', 'null'::jsonb),
  (35, 'post_devseed_35', 'user_devseed_35', 'Chi Lan', 'Nấu canh cá thì là kiểu Bắc, ăn với cơm nóng. Mất gần một tiếng.', 'hn', 'BRUNCH', 'null'::jsonb),
  (36, 'post_devseed_36', 'user_devseed_36', 'Công Thành', 'Nghe lại đĩa cũ, tiếng viny lách tách. Cuối tuần hay ngồi nghe cả buổi.', 'hn', 'NIGHTLIFE', 'null'::jsonb),
  (37, 'post_devseed_37', 'user_devseed_37', 'Diệp Anh', 'Cuộn phim 35mm vừa tráng xong, màu lên đúng như mong. Chụp ở phố cổ.', 'hn', 'PHOTO', 'null'::jsonb),
  (38, 'post_devseed_38', 'user_devseed_38', 'Đình Khôi', 'Bia thủ công mới, vị đắng nhẹ. Ngồi ngoài trời tới 11h.', 'hn', 'NIGHTLIFE', 'null'::jsonb),
  (39, 'post_devseed_39', 'user_devseed_39', 'Đoàn Trang', 'Bánh mì nướng bơ tỏi, làm ở nhà. Bánh ngọt thì mua ngoài ngon hơn.', 'hn', 'BRUNCH', 'null'::jsonb),
  (40, 'post_devseed_40', 'user_devseed_40', 'Đức Anh', 'Tập xong ăn nhẹ, không ăn cơm. Đổi lại thấy người nhẹ hơn.', 'hn', 'BRUNCH', 'null'::jsonb),
  (41, 'post_devseed_41', 'user_devseed_41', 'Gia Bảo', 'Thi latte art nội bộ, được giải nhì. Đổ hình trái tim vẫn khó nhất.', 'hn', 'COFFEE', 'null'::jsonb),
  (42, 'post_devseed_42', 'user_devseed_42', 'Giang Hương', 'Hiệu sách mới mở gần đây, có chỗ ngồi đọc. Cà phê cũng ổn.', 'hn', 'COFFEE', 'null'::jsonb),
  (43, 'post_devseed_43', 'user_devseed_43', 'Hà My', 'Thử ba quán ăn vặt trong một buổi chiều. Quán thứ hai ngon nhất.', 'hn', 'BRUNCH', 'null'::jsonb),
  (44, 'post_devseed_44', 'user_devseed_44', 'Hải Đăng', 'Lên sân thượng chụp lúc 17h, ánh sáng đẹp nhất trong ngày.', 'hn', 'PHOTO', 'null'::jsonb),
  (45, 'post_devseed_45', 'user_devseed_45', 'Hiền Lê', 'Gốm nung xong mẻ mới, có hai cái bị nứt. Học được cách giữ ẩm.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (46, 'post_devseed_46', 'user_devseed_46', 'Hoa Lý', 'Pha trà sen, để nguội rồi mới uống. Nóng quá là mất mùi.', 'hn', 'COFFEE', 'null'::jsonb),
  (47, 'post_devseed_47', 'user_devseed_47', 'Hoàng Nam', 'Quán vỉa hè quen, chủ nhớ mặt. Ngồi đây không cần gọi menu.', 'hn', 'BRUNCH', 'null'::jsonb),
  (48, 'post_devseed_48', 'user_devseed_48', 'Hồng Ngọc', 'Đồ vintage mua ở chợ trời, sửa lại mặc được. Rẻ hơn mua mới.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (49, 'post_devseed_49', 'user_devseed_49', 'Hữu Phúc', 'Làm xong cái kệ gỗ nhỏ, dùng gỗ thừa. Đo sai một lần phải làm lại.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (50, 'post_devseed_50', 'user_devseed_50', 'Khánh Linh', 'Brunch cuối tuần, cà phê sữa và bánh mì. Ngồi tới trưa mới về.', 'hn', 'BRUNCH', 'null'::jsonb),
  (51, 'post_devseed_51', 'user_devseed_51', 'Kim Ngân', 'Chụp ảnh áo dài ở Văn Miếu, sáng sớm chưa có khách.', 'hn', 'PHOTO', 'null'::jsonb),
  (52, 'post_devseed_52', 'user_devseed_52', 'Lâm Giang', 'Cuối tuần đi xa, đèo dốc nhiều. Về tới nhà là ngủ luôn.', 'hn', 'OUTDOOR', 'null'::jsonb),
  (53, 'post_devseed_53', 'user_devseed_53', 'Lan Anh', 'Yoga buổi sáng, ăn chay cả ngày. Người nhẹ hơn hẳn.', 'hn', 'OUTDOOR', 'null'::jsonb),
  (54, 'post_devseed_54', 'user_devseed_54', 'Lê Quyên', 'Phở bò quán mở từ 5h, tới 9h là hết nước dùng. Phải đi sớm.', 'hn', 'BRUNCH', 'null'::jsonb),
  (55, 'post_devseed_55', 'user_devseed_55', 'Linh Đan', 'Vẽ xong bức minh hoạ, mất hai ngày. Sổ tay sắp hết trang.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (56, 'post_devseed_56', 'user_devseed_56', 'Mai Phương', 'Sáng nào cũng một quán, đổi quán mỗi tuần. Tuần này thử chỗ mới.', 'hn', 'COFFEE', 'null'::jsonb),
  (57, 'post_devseed_57', 'user_devseed_57', 'Minh Anh', 'Chụp chân dung lúc 7h, nắng chếch nên đổ bóng dài. Đẹp hơn trưa.', 'hn', 'PHOTO', 'null'::jsonb),
  (58, 'post_devseed_58', 'user_devseed_58', 'Minh Quân', 'Rang xong mẻ mới, để ba ngày cho bay hết khí rồi mới pha.', 'hn', 'COFFEE', 'null'::jsonb),
  (59, 'post_devseed_59', 'user_devseed_59', 'Mỹ Duyên', 'Tập nhảy bài mới, động tác nhanh hơn bài trước. Mất cả buổi tối.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (60, 'post_devseed_60', 'user_devseed_60', 'Nam Anh', 'Chạy vòng hồ Hoàn Kiếm buổi sáng, vòng này đông người hơn hồ Tây.', 'hn', 'OUTDOOR', 'null'::jsonb),
  (61, 'post_devseed_61', 'user_devseed_61', 'Ngọc Hân', 'Bánh ngọt theo mùa, mùa này là bánh hạt dẻ. Chỉ làm tới hết tháng.', 'hn', 'BRUNCH', 'null'::jsonb),
  (62, 'post_devseed_62', 'user_devseed_62', 'Nhật Linh', 'Ngồi quán cà phê đọc hết nửa cuốn sách. Không ai giục nên ngồi lâu.', 'hn', 'COFFEE', 'null'::jsonb),
  (63, 'post_devseed_63', 'user_devseed_63', 'Phúc Long', 'Sửa xong cái xe, thay dây curoa. Chạy thử một vòng thấy êm.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (64, 'post_devseed_64', 'user_devseed_64', 'Phương Linh', 'Cây cảnh mới về, phải đổi chậu. Ban công hết chỗ rồi.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (65, 'post_devseed_65', 'user_devseed_65', 'Quang Huy', 'Chơi xong một trận dài, mắt mỏi. Nghỉ một hôm không chơi nữa.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (66, 'post_devseed_66', 'user_devseed_66', 'Quỳnh Mai', 'Bánh ngọt và cà phê, chiều nào cũng vậy. Thử quán mới thì thất vọng.', 'hn', 'BRUNCH', 'null'::jsonb),
  (67, 'post_devseed_67', 'user_devseed_67', 'Sơn Tùng', 'Thu xong bài mới ở nhà, nghe lại thấy còn ồn. Phải thu lại đoạn cuối.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (68, 'post_devseed_68', 'user_devseed_68', 'Tâm Như', 'Xà phòng thủ công mẻ mới, mùi sả chanh. Để ba tuần mới dùng được.', 'hn', 'UNKNOWN', 'null'::jsonb),
  (69, 'post_devseed_69', 'user_devseed_69', 'Thanh Hà', 'Dạy nấu một buổi, học viên nấu được phở. Nước dùng trong là khó nhất.', 'hn', 'BRUNCH', 'null'::jsonb),
  (70, 'post_devseed_70', 'user_devseed_70', 'Thu Hà', 'Cà phê và chụp ảnh, sáng nay ra được mấy tấm. Ánh sáng chiều dễ chụp hơn.', 'hn', 'PHOTO', 'null'::jsonb),
  (71, 'post_devseed_71', 'user_devseed_71', 'Anh Tuấn', 'Bắc Ninh sáng sớm yên hơn Hà Nội nhiều. Quán mở từ 6h.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (72, 'post_devseed_72', 'user_devseed_72', 'Bảo Ngọc', 'Thử quán bánh ngọt mới mở, được cái rẻ. Vị thì bình thường.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (73, 'post_devseed_73', 'user_devseed_73', 'Cam Tú', 'Pour-over vị chua nhẹ, uống buổi sáng tỉnh hơn cà phê sữa.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (74, 'post_devseed_74', 'user_devseed_74', 'Diệu Linh', 'Trà hoa cúc pha ấm, để nguội uống dần cả buổi chiều.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (75, 'post_devseed_75', 'user_devseed_75', 'Đức Huy', 'Rang cà phê tại nhà, mẻ đầu hơi khét. Giảm lửa là ổn.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (76, 'post_devseed_76', 'user_devseed_76', 'Gia Hân', 'Bánh mì nướng ở nhà, bơ và mật ong. Đơn giản mà nhanh.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (77, 'post_devseed_77', 'user_devseed_77', 'Hải Yến', 'Quán trà ngồi lâu được, không ai giục. Chiều nào cũng có khách quen.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (78, 'post_devseed_78', 'user_devseed_78', 'Hồng Quân', 'Hát quan họ cuối tuần, đông hơn mọi lần. Mấy cụ ngồi nghe tới hết.', 'bacninh', 'UNKNOWN', 'null'::jsonb),
  (79, 'post_devseed_79', 'user_devseed_79', 'Huệ Chi', 'Áo dài may lại, sửa eo một chút. Mặc vừa hơn hẳn.', 'bacninh', 'UNKNOWN', 'null'::jsonb),
  (80, 'post_devseed_80', 'user_devseed_80', 'Khắc Minh', 'Chụp ảnh quán cà phê buổi sáng, chưa có khách nên chụp được hết.', 'bacninh', 'PHOTO', 'null'::jsonb),
  (81, 'post_devseed_81', 'user_devseed_81', 'Lâm Anh', 'Cà phê sân vườn, ngồi ngoài mát hơn trong nhà. Muỗi nhiều vào chiều tối.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (82, 'post_devseed_82', 'user_devseed_82', 'Linh Chi', 'Đi thử quán mới mở, không gian rộng. Cà phê thì chưa bằng quán quen.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (83, 'post_devseed_83', 'user_devseed_83', 'Mai Anh', 'Bánh ngọt và trà, chiều nay ngồi ngoài. Trời mát nên ngồi được lâu.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (84, 'post_devseed_84', 'user_devseed_84', 'Minh Châu', 'Cà phê và sách, đọc xong một chương. Quán yên, ít nhạc.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (85, 'post_devseed_85', 'user_devseed_85', 'Ngọc Điệp', 'Đan xong cái túi, mất một tuần. Len mua ở chợ, màu không đều lắm.', 'bacninh', 'UNKNOWN', 'null'::jsonb),
  (86, 'post_devseed_86', 'user_devseed_86', 'Phương Anh', 'Brunch cuối tuần ở Bắc Ninh, giá rẻ hơn Hà Nội. Chỗ ngồi rộng.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (87, 'post_devseed_87', 'user_devseed_87', 'Quốc Bảo', 'Pha máy buổi sáng, chỉnh lại độ xay. Đắng quá là do xay mịn.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (88, 'post_devseed_88', 'user_devseed_88', 'Thanh Tùng', 'Cà phê rang mộc, uống đen. Không đường thì thấy được vị hạt.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (89, 'post_devseed_89', 'user_devseed_89', 'Thu Phương', 'Cắm hoa buổi sáng, còn thừa cành thì để riêng một lọ nhỏ.', 'bacninh', 'UNKNOWN', 'null'::jsonb),
  (90, 'post_devseed_90', 'user_devseed_90', 'Trang Anh', 'Chụp ảnh quán cà phê, góc cửa sổ sáng nhất. Buổi chiều ngược sáng.', 'bacninh', 'PHOTO', 'null'::jsonb),
  (91, 'post_devseed_91', 'user_devseed_91', 'Tuấn Anh', 'Đi xa cuối tuần, đường vắng. Về muộn nên hôm sau ngủ bù.', 'bacninh', 'OUTDOOR', 'null'::jsonb),
  (92, 'post_devseed_92', 'user_devseed_92', 'Vân Anh', 'Bánh ngọt và cà phê sữa, chiều nào cũng vậy. Đổi quán thì thấy lạ miệng.', 'bacninh', 'BRUNCH', 'null'::jsonb),
  (93, 'post_devseed_93', 'user_devseed_93', 'Việt Hoàng', 'Rang và pha cà phê, thử tỉ lệ mới. Đậm hơn một chút là vừa.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (94, 'post_devseed_94', 'user_devseed_94', 'Xuân Mai', 'Trà và hoa, sáng nay cắm một lọ. Mùa này hoa rẻ hơn tháng trước.', 'bacninh', 'UNKNOWN', 'null'::jsonb),
  (95, 'post_devseed_95', 'user_devseed_95', 'Yến Nhi', 'Đi cà phê và chụp ảnh, được mấy tấm ưng. Quán mới nên chưa đông.', 'bacninh', 'PHOTO', 'null'::jsonb),
  (96, 'post_devseed_96', 'user_devseed_96', 'Đức Thịnh', 'Cà phê sáng và đọc báo. Ngồi ngoài tới 9h thì nắng lên phải vào.', 'bacninh', 'COFFEE', 'null'::jsonb),
  (97, 'post_devseed_97', 'user_devseed_97', 'Mai Linh', 'Làm bánh cuối tuần, bán cho mấy nhà quen. Đặt trước mới có.', 'hn', 'BRUNCH', 'null'::jsonb),
  (98, 'post_devseed_98', 'user_devseed_98', 'Quốc Anh', 'Đi bộ và chụp phố, sáng sớm vắng. Người bán hàng rong bắt đầu dọn ra.', 'hn', 'PHOTO', 'null'::jsonb),
  (99, 'post_devseed_99', 'user_devseed_99', 'Thùy Dương', 'Cà phê và hoa, ghé quán quen rồi ra chợ hoa. Sáng nào cũng vậy.', 'hn', 'COFFEE', 'null'::jsonb),
  (100, 'post_devseed_100', 'user_devseed_100', 'Văn Phúc', 'Ngồi quán cả sáng, sửa mấy thứ nhỏ ở nhà. Chiều mới ra ngoài.', 'hn', 'COFFEE', 'null'::jsonb)

) AS g(n, post_id, author_id, display_name, body, city_scope, scene_type, media_refs)
-- 固定时间戳，不用 now()：feed 按 created_at DESC 排序，用 now() 会让每次重跑
-- 把这些帖子顶到最前面（位置一直在变），用固定时间才能既排得进前排又幂等。
CROSS JOIN LATERAL (SELECT TIMESTAMPTZ '2026-09-28 08:00:00+07'
                    + (g.n || ' hours')::interval) AS ts(created_at)
-- 冲突时更新**内容**但不碰 created_at：feed 按 created_at DESC 排序，
-- 改时间会让每次重跑都把这些帖子重新洗一遍位置。
ON CONFLICT (id) DO UPDATE
  SET author_type         = EXCLUDED.author_type,
      author_id           = EXCLUDED.author_id,
      author_display_name = EXCLUDED.author_display_name,
      body                = EXCLUDED.body,
      media_refs          = EXCLUDED.media_refs,
      visibility          = EXCLUDED.visibility,
      city_scope          = EXCLUDED.city_scope,
      scene_type          = EXCLUDED.scene_type,
      status              = EXCLUDED.status;

COMMIT;


-- ── 结果自检（应当 100 / 100 / 0 / 0）────────────────────────────────────────
SELECT 'devseed 帖子' AS what, count(*) FROM localnet.posts WHERE id LIKE 'post_devseed_%'
UNION ALL SELECT '作者确实是 devseed 用户', count(*) FROM localnet.posts p
            JOIN identity.user_accounts u ON u.id = p.author_id WHERE p.id LIKE 'post_devseed_%'
UNION ALL SELECT '作者名与 profile 不一致', count(*) FROM localnet.posts p
            JOIN identity.profiles pr ON pr.user_account_id = p.author_id
            WHERE p.id LIKE 'post_devseed_%' AND p.author_display_name <> pr.name
-- jsonb_array_elements 在 media_refs 是 JSON `null`（标量）时会报
-- "cannot extract elements from a scalar"，所以先按 jsonb_typeof 过滤掉标量。
UNION ALL SELECT 'media_refs 指向不存在资产',
            (SELECT count(*)
               FROM localnet.posts p
               CROSS JOIN LATERAL jsonb_array_elements(p.media_refs) m
               LEFT JOIN media.media_assets a ON a.media_asset_id = m->>'mediaAssetId'
              WHERE p.id LIKE 'post_devseed_%'
                AND jsonb_typeof(p.media_refs) = 'array'
                AND a.media_asset_id IS NULL)
ORDER BY 1;

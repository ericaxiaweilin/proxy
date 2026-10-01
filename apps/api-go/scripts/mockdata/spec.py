"""spec.py — mock 数据集的**唯一事实源**。

本文件只放数据，不放 SQL。`gen_mockdata.py` 读它生成三个 .sql。
这样做的原因：100 用户 × 6 张表 + 30 店 × 6 张表 + 100 帖，手写 SQL 一定会
出现「用户 47 的名字在 profiles 和 posts 里不一致」这类漂移；数据只写一遍，
SQL 由它派生，漂移就不可能发生。

口径（与仓库既有约定一致，改之前先读 seed_dev_shops_users.sql 的文件头）：

1. **店铺用真实公开信息**：店名 / 街道地址 / 行政区 / 品类取自公开的越南本地
   生活平台与旅游指南（Foody.vn / PasGo / toplist.vn / wheretarawent 等）。
   营业地址是事实性公开信息，不是谁的版权。
2. **用户是合成的**：越南姓名风格 + 真实行政区，不扒真人。理由不是版权而是
   个人数据 —— 越南 Nghị định 13/2023/NĐ-CP 把姓名/账号/画像当个人数据管，
   而本项目自己在做 LC-15 隐私中心；往库里灌真人资料会跟自己的合规目标打架。
3. **不编真实商家的经营属性**。营业时间 / wifi / 空调温度 / 座位数这些是
   「商家自己页面上一个月采一次」的数据（见 scene-shop-directory.ts 的注释），
   全仓没有生产者。给一家真实存在的店编一条「免费 wifi、24°C、安静」，是在
   断言一个我们并不知道的事实 —— seed_threebeans_bn.sql 当年就是因此**故意
   不写** menu/facilities，理由是「编出来会坑到真人」。本数据集沿用该决定：
   30 家店**不建 business.store_lines**。
4. **不编坐标**。reality.scenes.latitude/longitude 是 NOT NULL，而店铺目录
   （scene-shop-directory.ts）用坐标算「1.2km / 步行约 15 分钟」。给真实地址
   编一组坐标会让那些距离全错 —— 比不显示更糟。所以本数据集**不建
   reality.scenes**，business.stores.reality_scene_id 一律留空（与既有
   devseed 同口径）。要挂场景得先拿到真坐标（OSM 查），再走
   LinkStoreToRealityScene。
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# 前缀
# ─────────────────────────────────────────────────────────────────────────────
USER_PREFIX = "user_devseed_"
BIZ_PREFIX = "biz_devseed_"
STORE_PREFIX = "store_devseed_"
POST_PREFIX = "post_devseed_"
AVATAR_ASSET_PREFIX = "ma_devseed_"
VENUE_ASSET_PREFIX = "ma_devseed_venue_"

# 既有 30 个用户复用 creator 肖像资产（assets/ma_creator_<key>_portrait_v1）。
# 这 30 个 key 是 mockidentity.CreatorFacetKeys + HomeRailPeople 去重后的全集。
CREATOR_KEYS = [
    "an", "duc", "duy_khang", "hai", "hana", "hong_anh", "huy", "kien", "khoa",
    "lan", "linh", "long", "ly", "mai", "minh", "my", "nam", "ngoc", "nhi",
    "phuong", "phuong_thanh", "quynh_anh", "son", "thao", "thao_nhi",
    "thu_trang", "trang", "tu", "vy", "yen",
]
assert len(CREATOR_KEYS) == 30, len(CREATOR_KEYS)

# ─────────────────────────────────────────────────────────────────────────────
# 用户 01–30：店主（Hà Nội / Bắc Ninh），头像 1:1 复用 30 个 creator 肖像
#
# 既有文件里这 30 个人共用了 30 张肖像但**有重复**（04 和 10 都是 quynh_anh，
# 03 和 18 都是 hong_anh，还有 05/23、06/24、07/29、19/25 四组）。
# 用户明确要求「每个用户完整的头像」，30 张肖像正好够 30 个人 1:1 —— 这里按
# 顺序一一对应，重复消失，且没有新造任何文件。
# ─────────────────────────────────────────────────────────────────────────────
OWNER_USERS = [
    # (n, name, city, bio)
    (1,  "Nguyễn Thị Bích Ngọc", "Hà Nội",   "Pha cà phê trứng kiểu cũ. Mở từ 6h sáng."),
    (2,  "Trần Minh Hạnh",       "Hà Nội",   "Quán nhỏ trong phố cổ. Ngồi được, chụp được."),
    (3,  "Lê Hoàng Anh",         "Hà Nội",   "Cà phê rang xay, giao cả nội thành."),
    (4,  "Phạm Quỳnh Anh",       "Hà Nội",   "Bistro mở tới khuya, có nhà kính."),
    (5,  "Vũ Đức Thành",         "Hà Nội",   "Cà phê sân vườn, chỗ làm việc buổi sáng."),
    (6,  "Đỗ Thùy Linh",         "Hà Nội",   "Trà sen và nước mía. Mở tới 22h."),
    (7,  "Hoàng Kim Yến",        "Hà Nội",   "Bánh ngọt kiểu Hà Nội, giữa phố cổ."),
    (8,  "Bùi Đức Kiên",         "Hà Nội",   "Cà phê công sở, wifi khoẻ, bàn nhiều."),
    (9,  "Ngô Trà My",           "Hà Nội",   "Cà phê sữa đá, view hồ Hoàn Kiếm."),
    (10, "Đặng Như Quỳnh",       "Hà Nội",   "Quán lâu đời, làm theo công thức cũ."),
    (11, "Trương Thị Mai",       "Hà Nội",   "Quán trong hẻm, khách quen từ lâu."),
    (12, "Lê Anh Minh",          "Hà Nội",   "Specialty coffee, rang tại chỗ."),
    (13, "Phạm Thu Trang",       "Hà Nội",   "Bistro nhỏ, nhạc nhẹ, mở tới khuya."),
    (14, "Vũ Hoàng Long",        "Hà Nội",   "Món Việt, giá bình dân, phục vụ cả ngày."),
    (15, "Nguyễn Thị Lan",       "Hà Nội",   "Cà phê sân vườn, chỗ ngồi yên tĩnh."),
    (16, "Trần Bảo Nam",         "Hà Nội",   "Cà phê vintage, nhạc jazz cuối tuần."),
    (17, "Phạm Quốc Huy",        "Hà Nội",   "Quán ăn gia đình, mỗi ngày một món."),
    (18, "Đỗ Thị Hồng Nhung",    "Hà Nội",   "Trà trái cây, đồ ngọt. Ship nội thành."),
    (19, "Ngô Thanh Sơn",        "Bắc Ninh", "Cà phê view cao, chụp ảnh ban đêm."),
    (20, "Hoàng Thị Thảo Nhi",   "Bắc Ninh", "Bánh mì và cà phê sáng, lấy đi cũng được."),
    (21, "Lê Quốc Dũng",         "Bắc Ninh", "Cà phê rang mộc, pha máy."),
    (22, "Phan Thị Thu Hà",      "Bắc Ninh", "Trà và cà phê, chỗ ngồi ngoài vườn."),
    (23, "Vũ Khánh Duy",         "Bắc Ninh", "Cà phê sân vườn cạnh hồ."),
    (24, "Trịnh Thùy Linh",      "Bắc Ninh", "Quán cà phê trong ngõ, ít khách ồn."),
    (25, "Đỗ Hoàng Sơn",         "Bắc Ninh", "Cà phê sữa đá là ngon nhất."),
    (26, "Nguyễn Thị Bích",      "Bắc Ninh", "Quán cà phê nhỏ, gần chợ."),
    (27, "Trương Văn Khoa",      "Bắc Ninh", "Quán ăn gia đình, mở cả ngày."),
    (28, "Lê Thị Phương Thanh",  "Bắc Ninh", "Nhà hàng nhỏ, phục vụ tiệc gia đình."),
    (29, "Cao Thị Yến",          "Bắc Ninh", "Quán ăn sáng, mở từ 6h."),
    (30, "Phan Anh Tuấn",        "Bắc Ninh", "Quán hải sản, nhận đặt bàn."),
]

# ─────────────────────────────────────────────────────────────────────────────
# 用户 31–100：70 个新增用户（Hà Nội 40 / Bắc Ninh 30）
#
# 头像用本批 AI 生成的越南面孔（media_store/devseed_<key>_portrait_v1.jpg），
# 与既有 30 个人**不重脸**。key 用于资产 id 与文件名。
# ─────────────────────────────────────────────────────────────────────────────
EXTRA_USERS = [
    # (n, key, name, city, bio)
    (31, "an_nhien",    "An Nhiên",     "Hà Nội",   "Chạy bộ quanh hồ Tây sáng sớm."),
    (32, "bao_chau",    "Bảo Châu",     "Hà Nội",   "Pour-over và cà phê single origin."),
    (33, "bich_ngoc",   "Bích Ngọc",    "Hà Nội",   "Cắm hoa, đi chợ phiên cuối tuần."),
    (34, "cao_minh",    "Cao Minh",     "Hà Nội",   "Đạp xe, bản đồ cà phê phố cổ."),
    (35, "chi_lan",     "Chi Lan",      "Hà Nội",   "Món ăn nhà làm kiểu Bắc."),
    (36, "cong_thanh",  "Công Thành",   "Hà Nội",   "Đĩa than và nhạc indie."),
    (37, "diep_anh",    "Diệp Anh",     "Hà Nội",   "Chụp phim, thích ánh sáng tự nhiên."),
    (38, "dinh_khoi",   "Đình Khôi",    "Hà Nội",   "Bia thủ công, hay đi tối."),
    (39, "doan_trang",  "Đoàn Trang",   "Hà Nội",   "Bánh ngọt và bánh mì nướng."),
    (40, "duc_anh",     "Đức Anh",      "Hà Nội",   "Tập gym, ăn nhẹ."),
    (41, "gia_bao",     "Gia Bảo",      "Hà Nội",   "Barista, thi latte art."),
    (42, "giang_huong", "Giang Hương",  "Hà Nội",   "Hiệu sách và cà phê đọc sách."),
    (43, "ha_my",       "Hà My",        "Hà Nội",   "Ăn vặt phố cổ, quán nào cũng thử."),
    (44, "hai_dang",    "Hải Đăng",     "Hà Nội",   "Chụp kiến trúc, hay lên sân thượng."),
    (45, "hien_le",     "Hiền Lê",      "Hà Nội",   "Gốm thủ công, làm ở nhà."),
    (46, "hoa_ly",      "Hoa Lý",       "Hà Nội",   "Trà đạo và trà hoa."),
    (47, "hoang_nam",   "Hoàng Nam",    "Hà Nội",   "Ăn vặt vỉa hè, quán quen."),
    (48, "hong_ngoc",   "Hồng Ngọc",    "Hà Nội",   "Làm móng, thích đồ vintage."),
    (49, "huu_phuc",    "Hữu Phúc",     "Hà Nội",   "Mộc, làm đồ gỗ nhỏ."),
    (50, "khanh_linh",  "Khánh Linh",   "Hà Nội",   "Brunch cuối tuần, cà phê sữa."),
    (51, "kim_ngan",    "Kim Ngân",     "Hà Nội",   "Áo dài và ảnh chân dung."),
    (52, "lam_giang",   "Lâm Giang",    "Hà Nội",   "Lặn biển, hay đi xa cuối tuần."),
    (53, "lan_anh",     "Lan Anh",      "Hà Nội",   "Yoga và ăn chay."),
    (54, "le_quyen",    "Lê Quyên",     "Hà Nội",   "Phở bò, quán mở từ 5h."),
    (55, "linh_dan",    "Linh Đan",     "Hà Nội",   "Vẽ minh hoạ, làm sổ tay."),
    (56, "mai_phuong",  "Mai Phương",   "Hà Nội",   "Đi cà phê mỗi sáng."),
    (57, "minh_anh",    "Minh Anh",     "Hà Nội",   "Chụp chân dung, thích nắng sớm."),
    (58, "minh_quan",   "Minh Quân",    "Hà Nội",   "Rang cà phê, bán theo gói."),
    (59, "my_duyen",    "Mỹ Duyên",     "Hà Nội",   "Nhảy, nhạc Hàn."),
    (60, "nam_anh",     "Nam Anh",      "Hà Nội",   "Chạy bộ quanh hồ Hoàn Kiếm."),
    (61, "ngoc_han",    "Ngọc Hân",     "Hà Nội",   "Bánh ngọt, làm theo mùa."),
    (62, "nhat_linh",   "Nhật Linh",    "Hà Nội",   "Cà phê và sách, ngồi lâu."),
    (63, "phuc_long",   "Phúc Long",    "Hà Nội",   "Sửa xe máy, rành đường."),
    (64, "phuong_linh", "Phương Linh",  "Hà Nội",   "Cây cảnh và hoa tươi."),
    (65, "quang_huy",   "Quang Huy",    "Hà Nội",   "Chơi game, thỉnh thoảng live."),
    (66, "quynh_mai",   "Quỳnh Mai",    "Hà Nội",   "Bánh ngọt và cà phê."),
    (67, "son_tung",    "Sơn Tùng",     "Hà Nội",   "Làm nhạc, thu ở nhà."),
    (68, "tam_nhu",     "Tâm Như",      "Hà Nội",   "Xà phòng thủ công và nến thơm."),
    (69, "thanh_ha",    "Thanh Hà",     "Hà Nội",   "Dạy nấu món Việt."),
    (70, "thu_ha",      "Thu Hà",       "Hà Nội",   "Cà phê và chụp ảnh."),
    (71, "anh_tuan",    "Anh Tuấn",     "Bắc Ninh", "Cà phê ở Bắc Ninh, mở sáng sớm."),
    (72, "bao_ngoc",    "Bảo Ngọc",     "Bắc Ninh", "Bánh ngọt, hay thử quán mới."),
    (73, "cam_tu",      "Cam Tú",       "Bắc Ninh", "Pour-over, thích vị chua."),
    (74, "dieu_linh",   "Diệu Linh",    "Bắc Ninh", "Trà hoa và trà sen."),
    (75, "duc_huy",     "Đức Huy",      "Bắc Ninh", "Rang cà phê tại nhà."),
    (76, "gia_han",     "Gia Hân",      "Bắc Ninh", "Bánh mì và bánh ngọt."),
    (77, "hai_yen",     "Hải Yến",      "Bắc Ninh", "Quán trà, ngồi lâu được."),
    (78, "hong_quan",   "Hồng Quân",    "Bắc Ninh", "Quan họ, hát cuối tuần."),
    (79, "hue_chi",     "Huệ Chi",      "Bắc Ninh", "Áo dài truyền thống."),
    (80, "khac_minh",   "Khắc Minh",    "Bắc Ninh", "Chụp ảnh và cà phê."),
    (81, "lam_anh",     "Lâm Anh",      "Bắc Ninh", "Cà phê sân vườn."),
    (82, "linh_chi",    "Linh Chi",     "Bắc Ninh", "Đi thử quán cà phê mới."),
    (83, "mai_anh",     "Mai Anh",      "Bắc Ninh", "Bánh ngọt và trà."),
    (84, "minh_chau",   "Minh Châu",    "Bắc Ninh", "Cà phê và sách."),
    (85, "ngoc_diep",   "Ngọc Điệp",    "Bắc Ninh", "Đan lát thủ công."),
    (86, "phuong_anh",  "Phương Anh",   "Bắc Ninh", "Brunch cuối tuần."),
    (87, "quoc_bao",    "Quốc Bảo",     "Bắc Ninh", "Barista, pha máy."),
    (88, "thanh_tung",  "Thanh Tùng",   "Bắc Ninh", "Cà phê rang mộc."),
    (89, "thu_phuong",  "Thu Phương",   "Bắc Ninh", "Cắm hoa và cà phê."),
    (90, "trang_anh",   "Trang Anh",    "Bắc Ninh", "Chụp ảnh quán cà phê."),
    (91, "tuan_anh",    "Tuấn Anh",     "Bắc Ninh", "Xe máy và đi xa."),
    (92, "van_anh",     "Vân Anh",      "Bắc Ninh", "Bánh ngọt và cà phê sữa."),
    (93, "viet_hoang",  "Việt Hoàng",   "Bắc Ninh", "Rang và pha cà phê."),
    (94, "xuan_mai",    "Xuân Mai",     "Bắc Ninh", "Trà và hoa."),
    (95, "yen_nhi",     "Yến Nhi",      "Bắc Ninh", "Đi cà phê, hay chụp ảnh."),
    (96, "duc_thinh",   "Đức Thịnh",    "Bắc Ninh", "Cà phê sáng, đọc báo."),
    (97, "mai_linh",    "Mai Linh",     "Hà Nội",   "Làm bánh, bán cuối tuần."),
    (98, "quoc_anh",    "Quốc Anh",     "Hà Nội",   "Đi bộ và chụp phố."),
    (99, "thuy_duong",  "Thùy Dương",   "Hà Nội",   "Cà phê và hoa."),
    (100, "van_phuc",   "Văn Phúc",     "Hà Nội",   "Sửa chữa nhỏ, hay ngồi quán."),
]

# ─────────────────────────────────────────────────────────────────────────────
# 30 家店：Hà Nội 18（12 咖啡 + 6 餐厅） + Bắc Ninh 12（8 咖啡 + 4 餐厅）
#
# 店名 / 地址 / 品类取自公开来源（Foody.vn / PasGo / toplist.vn /
# wheretarawent.com / travelviet.net 等公开页面）。owner 是用户 01–30。
# reality_scene_id 一律留空（理由见文件头第 4 条）。
# ─────────────────────────────────────────────────────────────────────────────
SHOPS = [
    # (n, kind, city, area, store_name, address, category)
    (1,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "Cộng Cà Phê — Cầu Gỗ",            "116 P. Cầu Gỗ, Hàng Bạc, Hoàn Kiếm, Hà Nội",              "Cà phê / Cà phê cốt dừa"),
    (2,  "cafe",       "Hà Nội",   "Ba Đình",   "Kafeville",                       "23 P. Yên Ninh, Ba Đình, Hà Nội",                          "Cà phê"),
    (3,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "Café Nola",                       "89 P. Mã Mây, Hoàn Kiếm, Hà Nội",                          "Cà phê"),
    (4,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "Café Đinh",                       "13 P. Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội",                 "Cà phê / Cà phê trứng"),
    (5,  "cafe",       "Hà Nội",   "Tây Hồ",    "Maison de Tet Decor",             "58 P. Từ Hoa, Tây Hồ, Hà Nội",                             "Cà phê / Brunch"),
    (6,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "Lifted Coffee + Brunch",          "101 P. Hàng Gà, Hoàn Kiếm, Hà Nội",                        "Cà phê / Brunch"),
    (7,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "Blackbird Coffee",                "5 P. Chân Cầm, Hoàn Kiếm, Hà Nội",                         "Cà phê"),
    (8,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "La Place",                        "6 P. Ấu Triệu, Hoàn Kiếm, Hà Nội",                         "Cà phê"),
    (9,  "cafe",       "Hà Nội",   "Hoàn Kiếm", "The Note Coffee",                 "64 P. Lương Văn Can, Hoàn Kiếm, Hà Nội",                   "Cà phê"),
    (10, "cafe",       "Hà Nội",   "Hoàn Kiếm", "The Hanoi Social Club",           "6 Ng. Hội Vũ, Hoàn Kiếm, Hà Nội",                          "Cà phê / Bistro"),
    (11, "cafe",       "Hà Nội",   "Hoàn Kiếm", "Tranquil Books & Coffee",         "5 P. Nguyễn Quang Bích, Hoàn Kiếm, Hà Nội",                "Cà phê sách"),
    (12, "cafe",       "Hà Nội",   "Cầu Giấy",  "Tầng Trệt Cosmo Café",            "100 P. Khúc Thừa Dụ, Cầu Giấy, Hà Nội",                    "Cà phê"),
    (13, "restaurant", "Hà Nội",   "Hoàn Kiếm", "Red Bean Restaurant",             "94 Mã Mây, Hoàn Kiếm, Hà Nội",                             "Món Việt"),
    (14, "restaurant", "Hà Nội",   "Hoàn Kiếm", "Coffee Club",                     "3B Lê Thái Tổ, Hoàn Kiếm, Hà Nội",                         "Món Âu / Cà phê"),
    (15, "restaurant", "Hà Nội",   "Hoàn Kiếm", "Panorama Restaurant",             "13 Lý Thái Tổ, Hoàn Kiếm, Hà Nội",                         "Món Việt / View hồ"),
    (16, "restaurant", "Hà Nội",   "Hoàn Kiếm", "Rico South American Steakhouse",  "7 Nguyễn Gia Thiều, Hoàn Kiếm, Hà Nội",                    "Bò bít tết / Nam Mỹ"),
    (17, "restaurant", "Hà Nội",   "Hoàn Kiếm", "Quán Ăn Ngon",                    "18 Phan Bội Châu, Hoàn Kiếm, Hà Nội",                      "Món Việt"),
    (18, "restaurant", "Hà Nội",   "Hoàn Kiếm", "Pane E Vino",                     "3 Nguyễn Khắc Cần, Hoàn Kiếm, Hà Nội",                     "Món Ý"),
    (19, "cafe",       "Bắc Ninh", "Kinh Bắc",  "TDeli Coffee",                    "43 Hồ Ngọc Lân, Kinh Bắc, TP Bắc Ninh",                    "Cà phê"),
    (20, "cafe",       "Bắc Ninh", "Kinh Bắc",  "Chago Tea & Café",                "187 Nguyễn Gia Thiều, TP Bắc Ninh",                        "Trà / Cà phê"),
    (21, "cafe",       "Bắc Ninh", "Võ Cường",  "Siii Coffee",                     "43 Nguyễn Bỉnh Quân, Võ Cường, TP Bắc Ninh",               "Cà phê"),
    (22, "cafe",       "Bắc Ninh", "Võ Cường",  "Sky Garden Coffee",               "21 Lý Thái Tổ, Võ Cường, TP Bắc Ninh",                     "Cà phê / Sân vườn"),
    (23, "cafe",       "Bắc Ninh", "Võ Cường",  "Ruộng Coffee",                    "54 P. Lý Chiêu Hoàng, Võ Cường, TP Bắc Ninh",              "Cà phê"),
    (24, "cafe",       "Bắc Ninh", "Kinh Bắc",  "Dallas Coffee Roasters",          "26 Nguyễn Bỉnh Quân, Kinh Bắc, TP Bắc Ninh",               "Specialty coffee / Rang xay"),
    (25, "cafe",       "Bắc Ninh", "Ninh Xá",   "Snow Island Coffee",              "68 Đ. Lê Thái Tổ, Ninh Xá, TP Bắc Ninh",                   "Cà phê"),
    (26, "cafe",       "Bắc Ninh", "Ninh Xá",   "Cami Coffee",                     "390 Nguyễn Thị Lưu, TP Bắc Ninh",                          "Cà phê"),
    (27, "restaurant", "Bắc Ninh", "Đại Phúc",  "Yakimono — Nguyễn Đăng Đạo",      "24-26 Nguyễn Đăng Đạo, Đại Phúc, TP Bắc Ninh",             "Buffet nướng / Nhật"),
    (28, "restaurant", "Bắc Ninh", "Tiền An",   "Hanwon",                          "10B Nguyễn Đăng Đạo, Tiền An, TP Bắc Ninh",                "Buffet nướng / Hàn"),
    (29, "restaurant", "Bắc Ninh", "Ninh Xá",   "Bao Dimsum",                      "67 Ngọc Hân Công Chúa, Ninh Xá, TP Bắc Ninh",              "Dimsum / Trung Hoa"),
    (30, "restaurant", "Bắc Ninh", "Tiền Ninh Vệ", "Cua Ngon 93",                  "46 Lương Thế Vinh, Tiền Ninh Vệ, TP Bắc Ninh",             "Hải sản"),
]

# 每个店的员工（membership OPERATOR）：用户 31–60，一店一人。
STAFF_USER_START = 31

# ─────────────────────────────────────────────────────────────────────────────
# 帖文：100 个用户各 1 条公开帖
#
# city_scope 用简写（hn / bacninh）—— 与库里既有的 hn / hcm / danang / hue 同口径。
# scene_type 必须落在 CHECK 枚举里：
#   UNKNOWN / ROOFTOP / BRUNCH / SPA / CINEMA / PHOTO / NIGHTLIFE / OUTDOOR / COFFEE
# media_refs 的元素是**对象** {"sortOrder":0,"mediaAssetId":"ma_…"}，不是裸字符串；
# 「没图」写 'null'::jsonb（列是 NOT NULL，写裸 NULL 会撞约束）。
# ─────────────────────────────────────────────────────────────────────────────

# 店主帖（用户 01–30）：跟着自己的店走，city_scope 由店的 city 决定。
OWNER_POSTS = {
    1:  ("Sáng nay mở quán 6h, cà phê cốt dừa và trà sen. Ai đi ngang Cầu Gỗ thử một ly nhé.", "COFFEE"),
    2:  ("Quán nhỏ trên Yên Ninh, không máy lạnh, không wifi. Ngồi tán gẫu mấy tiếng rồi đi.", "COFFEE"),
    3:  ("Cà phê rang xay tại chỗ, giao nội thành trong 2 tiếng. Đặt trước khi quán đông.", "COFFEE"),
    4:  ("Cà phê trứng làm theo công thức cũ. Bốn mươi năm chưa đổi.", "COFFEE"),
    5:  ("Bàn ngoài sân hôm nay ngồi hết từ 8h. Ai tìm chỗ yên tĩnh thì ghé sớm.", "BRUNCH"),
    6:  ("Bàn trong góc hôm nay kín từ 8h. Có ổ cắm, ngồi làm việc được.", "COFFEE"),
    7:  ("Bánh ngọt ra lò 7h, bán hết là hết. Phố cổ giờ này chờ hơi lâu nhưng đáng.", "BRUNCH"),
    8:  ("Bàn làm việc chiều nay đã kín. Tầng hai còn chỗ, có ổ cắm.", "COFFEE"),
    9:  ("Ngắm hồ Hoàn Kiếm buổi sáng, cà phê sữa đá. Tầng hai nhìn được một góc hồ.", "COFFEE"),
    10: ("Công thức cũ giữ nguyên, trứng và sữa đặc như hồi thập lăm.", "COFFEE"),
    11: ("Quán trong ngõ, ngồi vỉa hè sáng nay. Cuối tuần hơi đông.", "COFFEE"),
    12: ("Batch mới rang xong, dùng cà phê Đắk Lắk. Hôm nay pha tay không, pha máy cũng được.", "COFFEE"),
    13: ("Nhạc nhẹ từ 21h, quán nhỏ thôi nhưng nhạc vừa phải. Khuya rảnh nhất.", "NIGHTLIFE"),
    14: ("Món Việt bán cả ngày, trưa đông hơn tối. Không nhận đặt bàn trưa.", "BRUNCH"),
    15: ("Chiều nay ngồi ngoài vườn mát, uống trà đá. Cây mới trồng thêm bốn cây.", "COFFEE"),
    16: ("Jazz cuối tuần bắt đầu 20h. Nhạc cũ, không nhạc sàn.", "NIGHTLIFE"),
    17: ("Món nay là canh chua cuối cùng của mùa. Nhà mình làm ăn, không phải quán ăn.", "BRUNCH"),
    18: ("Trà trái cây mới, đá xay kiểu Đà Lạt. Ship nội thành trước 9h.", "COFFEE"),
    19: ("Tầng cao nhìn được cả thành phố buổi tối. Cuối tuần kín, nên gọi trước.", "NIGHTLIFE"),
    20: ("Bánh mì nướng, 6h bán. Bỏ qua thì 8h là hết, hết là hết không có lần hai.", "BRUNCH"),
    21: ("Cà phê rang mộc, pha máy. Hạt mới về tuần này.", "COFFEE"),
    22: ("Trà và cà phê, chỗ ngồi ngoài vườn. Buổi chiều mát hơn trong nhà.", "COFFEE"),
    23: ("Quán cạnh hồ, sáng sớm có sương. Ngồi ngoài được tới 9h.", "OUTDOOR"),
    24: ("Quán trong ngõ, ít khách ồn. Ai cần chỗ yên thì đây.", "COFFEE"),
    25: ("Cà phê sữa đá là ngon nhất. Đá ít hay nhiều thì nói lúc gọi.", "COFFEE"),
    26: ("Quán nhỏ gần chợ, mở từ 6h. Sáng nào cũng có khách quen.", "COFFEE"),
    27: ("Quán ăn gia đình mở cả ngày. Cuối tuần nhận đặt tiệc nhỏ.", "BRUNCH"),
    28: ("Nhà hàng nhỏ, phục vụ tiệc gia đình. Đặt trước hai ngày là chắc.", "BRUNCH"),
    29: ("Quán ăn sáng mở từ 6h, 10h là nghỉ. Món theo ngày.", "BRUNCH"),
    30: ("Hải sản tươi về mỗi sáng. Nhận đặt bàn, cuối tuần nên gọi trước.", "BRUNCH"),
}

# 新增用户帖（31–100）：不挂店，走日常内容。
EXTRA_POSTS = {
    31:  ("Chạy vòng hồ Tây lúc 5h30, sương còn chưa tan. Đi sớm hơn tuần trước.", "OUTDOOR"),
    32:  ("Vừa thử một ly single origin Ethiopia, chua nhẹ. Uống nguội ngon hơn nóng.", "COFFEE"),
    33:  ("Chợ phiên cuối tuần nay có nhiều hoa cúc. Mua về cắm được cả tuần.", "OUTDOOR"),
    34:  ("Đạp xe vòng phố cổ sáng nay, đường vắng. Ghi lại mấy quán mở sớm.", "OUTDOOR"),
    35:  ("Nấu canh cá thì là kiểu Bắc, ăn với cơm nóng. Mất gần một tiếng.", "BRUNCH"),
    36:  ("Nghe lại đĩa cũ, tiếng viny lách tách. Cuối tuần hay ngồi nghe cả buổi.", "NIGHTLIFE"),
    37:  ("Cuộn phim 35mm vừa tráng xong, màu lên đúng như mong. Chụp ở phố cổ.", "PHOTO"),
    38:  ("Bia thủ công mới, vị đắng nhẹ. Ngồi ngoài trời tới 11h.", "NIGHTLIFE"),
    39:  ("Bánh mì nướng bơ tỏi, làm ở nhà. Bánh ngọt thì mua ngoài ngon hơn.", "BRUNCH"),
    40:  ("Tập xong ăn nhẹ, không ăn cơm. Đổi lại thấy người nhẹ hơn.", "BRUNCH"),
    41:  ("Thi latte art nội bộ, được giải nhì. Đổ hình trái tim vẫn khó nhất.", "COFFEE"),
    42:  ("Hiệu sách mới mở gần đây, có chỗ ngồi đọc. Cà phê cũng ổn.", "COFFEE"),
    43:  ("Thử ba quán ăn vặt trong một buổi chiều. Quán thứ hai ngon nhất.", "BRUNCH"),
    44:  ("Lên sân thượng chụp lúc 17h, ánh sáng đẹp nhất trong ngày.", "PHOTO"),
    45:  ("Gốm nung xong mẻ mới, có hai cái bị nứt. Học được cách giữ ẩm.", "UNKNOWN"),
    46:  ("Pha trà sen, để nguội rồi mới uống. Nóng quá là mất mùi.", "COFFEE"),
    47:  ("Quán vỉa hè quen, chủ nhớ mặt. Ngồi đây không cần gọi menu.", "BRUNCH"),
    48:  ("Đồ vintage mua ở chợ trời, sửa lại mặc được. Rẻ hơn mua mới.", "UNKNOWN"),
    49:  ("Làm xong cái kệ gỗ nhỏ, dùng gỗ thừa. Đo sai một lần phải làm lại.", "UNKNOWN"),
    50:  ("Brunch cuối tuần, cà phê sữa và bánh mì. Ngồi tới trưa mới về.", "BRUNCH"),
    51:  ("Chụp ảnh áo dài ở Văn Miếu, sáng sớm chưa có khách.", "PHOTO"),
    52:  ("Cuối tuần đi xa, đèo dốc nhiều. Về tới nhà là ngủ luôn.", "OUTDOOR"),
    53:  ("Yoga buổi sáng, ăn chay cả ngày. Người nhẹ hơn hẳn.", "OUTDOOR"),
    54:  ("Phở bò quán mở từ 5h, tới 9h là hết nước dùng. Phải đi sớm.", "BRUNCH"),
    55:  ("Vẽ xong bức minh hoạ, mất hai ngày. Sổ tay sắp hết trang.", "UNKNOWN"),
    56:  ("Sáng nào cũng một quán, đổi quán mỗi tuần. Tuần này thử chỗ mới.", "COFFEE"),
    57:  ("Chụp chân dung lúc 7h, nắng chếch nên đổ bóng dài. Đẹp hơn trưa.", "PHOTO"),
    58:  ("Rang xong mẻ mới, để ba ngày cho bay hết khí rồi mới pha.", "COFFEE"),
    59:  ("Tập nhảy bài mới, động tác nhanh hơn bài trước. Mất cả buổi tối.", "UNKNOWN"),
    60:  ("Chạy vòng hồ Hoàn Kiếm buổi sáng, vòng này đông người hơn hồ Tây.", "OUTDOOR"),
    61:  ("Bánh ngọt theo mùa, mùa này là bánh hạt dẻ. Chỉ làm tới hết tháng.", "BRUNCH"),
    62:  ("Ngồi quán cà phê đọc hết nửa cuốn sách. Không ai giục nên ngồi lâu.", "COFFEE"),
    63:  ("Sửa xong cái xe, thay dây curoa. Chạy thử một vòng thấy êm.", "UNKNOWN"),
    64:  ("Cây cảnh mới về, phải đổi chậu. Ban công hết chỗ rồi.", "UNKNOWN"),
    65:  ("Chơi xong một trận dài, mắt mỏi. Nghỉ một hôm không chơi nữa.", "UNKNOWN"),
    66:  ("Bánh ngọt và cà phê, chiều nào cũng vậy. Thử quán mới thì thất vọng.", "BRUNCH"),
    67:  ("Thu xong bài mới ở nhà, nghe lại thấy còn ồn. Phải thu lại đoạn cuối.", "UNKNOWN"),
    68:  ("Xà phòng thủ công mẻ mới, mùi sả chanh. Để ba tuần mới dùng được.", "UNKNOWN"),
    69:  ("Dạy nấu một buổi, học viên nấu được phở. Nước dùng trong là khó nhất.", "BRUNCH"),
    70:  ("Cà phê và chụp ảnh, sáng nay ra được mấy tấm. Ánh sáng chiều dễ chụp hơn.", "PHOTO"),
    71:  ("Bắc Ninh sáng sớm yên hơn Hà Nội nhiều. Quán mở từ 6h.", "COFFEE"),
    72:  ("Thử quán bánh ngọt mới mở, được cái rẻ. Vị thì bình thường.", "BRUNCH"),
    73:  ("Pour-over vị chua nhẹ, uống buổi sáng tỉnh hơn cà phê sữa.", "COFFEE"),
    74:  ("Trà hoa cúc pha ấm, để nguội uống dần cả buổi chiều.", "COFFEE"),
    75:  ("Rang cà phê tại nhà, mẻ đầu hơi khét. Giảm lửa là ổn.", "COFFEE"),
    76:  ("Bánh mì nướng ở nhà, bơ và mật ong. Đơn giản mà nhanh.", "BRUNCH"),
    77:  ("Quán trà ngồi lâu được, không ai giục. Chiều nào cũng có khách quen.", "COFFEE"),
    78:  ("Hát quan họ cuối tuần, đông hơn mọi lần. Mấy cụ ngồi nghe tới hết.", "UNKNOWN"),
    79:  ("Áo dài may lại, sửa eo một chút. Mặc vừa hơn hẳn.", "UNKNOWN"),
    80:  ("Chụp ảnh quán cà phê buổi sáng, chưa có khách nên chụp được hết.", "PHOTO"),
    81:  ("Cà phê sân vườn, ngồi ngoài mát hơn trong nhà. Muỗi nhiều vào chiều tối.", "COFFEE"),
    82:  ("Đi thử quán mới mở, không gian rộng. Cà phê thì chưa bằng quán quen.", "COFFEE"),
    83:  ("Bánh ngọt và trà, chiều nay ngồi ngoài. Trời mát nên ngồi được lâu.", "BRUNCH"),
    84:  ("Cà phê và sách, đọc xong một chương. Quán yên, ít nhạc.", "COFFEE"),
    85:  ("Đan xong cái túi, mất một tuần. Len mua ở chợ, màu không đều lắm.", "UNKNOWN"),
    86:  ("Brunch cuối tuần ở Bắc Ninh, giá rẻ hơn Hà Nội. Chỗ ngồi rộng.", "BRUNCH"),
    87:  ("Pha máy buổi sáng, chỉnh lại độ xay. Đắng quá là do xay mịn.", "COFFEE"),
    88:  ("Cà phê rang mộc, uống đen. Không đường thì thấy được vị hạt.", "COFFEE"),
    89:  ("Cắm hoa buổi sáng, còn thừa cành thì để riêng một lọ nhỏ.", "UNKNOWN"),
    90:  ("Chụp ảnh quán cà phê, góc cửa sổ sáng nhất. Buổi chiều ngược sáng.", "PHOTO"),
    91:  ("Đi xa cuối tuần, đường vắng. Về muộn nên hôm sau ngủ bù.", "OUTDOOR"),
    92:  ("Bánh ngọt và cà phê sữa, chiều nào cũng vậy. Đổi quán thì thấy lạ miệng.", "BRUNCH"),
    93:  ("Rang và pha cà phê, thử tỉ lệ mới. Đậm hơn một chút là vừa.", "COFFEE"),
    94:  ("Trà và hoa, sáng nay cắm một lọ. Mùa này hoa rẻ hơn tháng trước.", "UNKNOWN"),
    95:  ("Đi cà phê và chụp ảnh, được mấy tấm ưng. Quán mới nên chưa đông.", "PHOTO"),
    96:  ("Cà phê sáng và đọc báo. Ngồi ngoài tới 9h thì nắng lên phải vào.", "COFFEE"),
    97:  ("Làm bánh cuối tuần, bán cho mấy nhà quen. Đặt trước mới có.", "BRUNCH"),
    98:  ("Đi bộ và chụp phố, sáng sớm vắng. Người bán hàng rong bắt đầu dọn ra.", "PHOTO"),
    99:  ("Cà phê và hoa, ghé quán quen rồi ra chợ hoa. Sáng nào cũng vậy.", "COFFEE"),
    100: ("Ngồi quán cả sáng, sửa mấy thứ nhỏ ở nhà. Chiều mới ra ngoài.", "COFFEE"),
}

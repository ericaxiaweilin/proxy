-- CATALOG-EXPAND-001（2026-10-01，用户：「核心就是要有30个店铺 10个公共景点」）
--
-- 新增 17 条真实地点：河内 11 家店（POI 级）+ 河内 2 个景点（POI 级）+ 北宁 4 家店（地址级）。
--
-- 坐标来源：逐条用 Nominatim 反查，**不是估的**。两个层级，差别写进 description：
--   · POI 级：OSM 有该店/该景点的节点 → 坐标精确到店（或景点）。
--   · 地址级：OSM 没有这家店的节点 → 退到门牌/街道级，坐标是那个门牌点，**不是店面**。
--     北宁那四家 bún chả 全部属于这一类。
-- 为什么要写明：坐标精度影响用户怎么用这个点。POI 级可以当成"到了"，
-- 地址级只能当成"在这一带"。藏着这个差别，用户按导航走过去发现差几十米，
-- 会当成 App 数据不准 —— 而不是当成数据本身标注了精度。
--
-- 反查 MISS 的**没有**硬塞进来。这批期间用 Nominatim 查过 22 家，MISS 的包括
-- Bún Chả Đắc Kim（连获四年 Michelin Selected）、Tuyết Bún Chả 34、Phở Gà Nguyệt、
-- Đền Ngọc Sơn —— 都是越南最有名的馆子，但 OSM 上确实没有节点。宁可少几条，
-- 也不写一个查不到出处的坐标。
--
-- ⚠️ 已应用迁移只许改名不许改内容，所以这是**向前**的新迁移，不是改 095。
--
-- 与 Go 侧 launchScenes() 的 id 集合必须一致：TestSceneSeedMatchesMigrationSeed 钉住两边。

INSERT INTO reality.scenes(id,name,area,type,latitude,longitude,best,active,description,address) VALUES
('cafe_giang','Cà Phê Giảng','Hoàn Kiếm','咖啡 · 店招',21.0342713,105.8544991,'07:00–22:00',true,'1946 年 Nguyễn Văn Giang 创立，鸡蛋咖啡的诞生地。坐标精确到店。','39 Nguyễn Hữu Huân, Khu phố cổ, Phường Hoàn Kiếm, Hà Nội'),
('cafe_dinh','Cà Phê Dinh','Hoàn Kiếm','咖啡 · 店招',21.0319988,105.8523858,'07:00–22:00',true,'Giảng 的次子所开，同一配方；二楼阳台看得见还剑湖。坐标精确到店。','13 Đinh Tiên Hoàng, Khu phố cổ, Phường Hoàn Kiếm, Hà Nội'),
('cafe_phoco','Cafè Phố Cổ','Hoàn Kiếm','咖啡 · 店招',21.0322358,105.8510679,'07:00–23:00',true,'穿过丝绸店上四段窄楼梯，老城屋顶视角。坐标精确到店。','11 Hàng Gai, Khu phố cổ, Phường Hoàn Kiếm, Hà Nội'),
('cafe_note','The Note Coffee','Hoàn Kiếm','咖啡 · 店招',21.0316214,105.8508446,'06:30–23:00',true,'墙面贴满各地便利贴；老城周末夜市的起点。坐标精确到店。','64 Lương Văn Can, Khu phố cổ, Phường Hoàn Kiếm, Hà Nội'),
('cafe_loadingt','Cà Phê Loading T','Hoàn Kiếm','咖啡 · 店招',21.0305248,105.8485873,'07:00–22:00',true,'法区小巷的打字机与旧家具。坐标精确到店。','8 Chân Cầm, Khu phố cổ, Phường Hoàn Kiếm, Hà Nội'),
('buncha_ta','Bún Chả Tà','Hoàn Kiếm','餐厅 · 米其林 Bib Gourmand',21.0343571,105.8544931,'08:00–22:00',true,'米其林 Bib Gourmand 收录的老牌 bún chả。坐标精确到店。','21 Nguyễn Hữu Huân, Phường Ly Thái Tổ, Hoàn Kiếm, Hà Nội'),
('buncha_huonglien','Bún Chả Hương Liên','Hai Bà Trưng','餐厅 · 米其林推荐',21.0180504,105.8538843,'08:00–20:30',true,'2016 年奥巴马与波登来过的那家。坐标精确到店。','24 Lê Văn Huu, Phường Phan Chu Trinh, Hai Bà Trưng, Hà Nội'),
('buncha_chan','Bún Chả Chan','Hai Bà Trưng','餐厅 · 米其林 Bib Gourmand',21.0102216,105.8506706,'以现场公告为准',true,'bún chả 配猪骨熬的汤。坐标精确到店。','114 Mai Hắc Đế, Phường Vân Hồ, Hai Bà Trưng, Hà Nội'),
('pho_batdan','Phở Gia Truyền Bát Đàn','Hoàn Kiếm','餐厅 · 米其林 Bib Gourmand',21.0336377,105.8463792,'06:00–10:00 · 18:00–20:30',true,'老城 Bát Đàn 街的牛河粉，只做早市与晚市。坐标精确到店。','49 Bát Đàn, Phường Cửa Đông, Hoàn Kiếm, Hà Nội'),
('pho_thin','Phở Thìn','Hai Bà Trưng','餐厅 · 河粉',21.0170351,105.8559963,'05:30–21:30',true,'1979 年开店，牛肉先用蒜爆香再入汤。坐标精确到店。','13 Lò Đúc, Phường Hai Bà Trưng, Hà Nội'),
('buncha_74hangquat','Bún Chả 74 Hàng Quạt','Hoàn Kiếm','餐厅 · 巷子',21.0324643,105.8489735,'10:00–14:00',true,'还剑湖西北巷子里的炭火烤肉。坐标精确到店。','74 Hàng Quạt, Phường Hoàn Kiếm, Hà Nội'),
('chua_motcot','Chùa Một Cột · Liên Hoa Đài','Ba Đình','公共景点 · 寺庙',21.0358555,105.8336143,'06:00–18:00',true,'1049 年黎利太宗所建的单柱木亭。坐标精确到景点。','Chùa Một Cột, Phố Ông Ích Khiêm, Phường Ba Đình, Hà Nội'),
('lang_hcm','Lăng Chủ tịch Hồ Chí Minh','Ba Đình','公共景点 · 纪念地',21.0367831,105.8346888,'08:00–11:00 · 周二至周日',true,'1973–1975 年建成的陵墓；参观有时段与着装要求。坐标精确到景点。','1 Đường Hùng Vương, Phường Ba Đình, Hà Nội'),
('buncha_dungrau','Bún Chả Dũng Râu','Từ Sơn','餐厅 · bún chả',21.1172886,105.9575573,'以现场公告为准',true,'炭火烤肉饼配米粉。坐标是街道门牌点，不是店面。','72 Trần Phú, Phường Từ Sơn, TP Bắc Ninh'),
('buncha_thuhien','Bún Chả Thu Hiền','Từ Sơn','餐厅 · bún chả',21.1167452,105.9624094,'以现场公告为准',true,'chấm 与 chan 两种吃法。坐标是街道门牌点，不是店面。','Đường Lê Quang Đạo, Khu đô thị Phú Điền, Từ Sơn, TP Bắc Ninh'),
('buncha_ketnghia','Bún Chả Kết Nghĩa','Kinh Bắc','餐厅 · bún chả',21.1711352,106.0479433,'06:00–14:00',true,'早上六点到下午两点的炭火烤肉。坐标是门牌点，不是店面。','151 Nguyễn Văn Cừ, Phường Kinh Bắc, TP Bắc Ninh'),
('buncha_mydo','Bún Chả Mỹ Độ','Kinh Bắc','餐厅 · bún chả',21.1849344,106.0705472,'以现场公告为准',true,'除传统肉饼外另有 nem 款。坐标是门牌点，不是店面。','75 Hồ Ngọc Lân, Phường Kinh Bắc, TP Bắc Ninh')
ON CONFLICT (id) DO NOTHING;

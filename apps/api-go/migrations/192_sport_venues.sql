-- SPORT-VENUES-001（2026-10-08，用户：打球发布需求要像娱乐一样选运动类别、选球馆球场；首页运动分类是空的）
--
-- 根因：reality.scenes 里一个运动场地都没有（28 条全是咖啡/餐厅/景点），所以首页「运动」入口没有可数的场景，
-- 发布向导的运动模板也只能跳过「选场景」直接绑人。这批 11 条是**逐条用 Nominatim 反查**的 OSM 运动场地，坐标不是估的：
-- 全部 POI 级（OSM 有该场地的节点/面），精确到场地。小区（Vinhomes Ocean Park）内的场地是否对外开放，
-- 描述里已写「以现场为准」，不替小区做承诺。反查没有商业球馆的开放时间/价格，一律「以现场公告为准」。
-- 骑行绿道 OSM 里是线不是点，没有放进来。
--
-- 已应用迁移只许改名不许改内容：这是向前的新迁移。与 Go 侧 launchScenes() 的 id 集合必须一致（TestSceneSeedMatchesMigrationSeed）。

INSERT INTO reality.scenes(id,name,area,type,latitude,longitude,best,active,description,address,category) VALUES
('sport_xoai_arena','Xoài Arena','Long Biên','运动 · 羽毛球场',21.051603,105.881489,'以现场公告为准',true,'Tổ hợp sân cầu lông（多片场地）。坐标精确到场地。','Ngõ 481 Đường Ngọc Lâm, Phường Bồ Đề, Hà Nội','商家'),
('sport_vinhoang','Sân cầu lông công viên Vĩnh Hoàng','Hoàng Mai','运动 · 羽毛球场',20.994137,105.875442,'以现场公告为准',true,'公园里的公共羽毛球场。坐标精确到场地。','Ngõ 185 Phố Dương Văn Bé, Phường Vĩnh Hưng, Hà Nội','其他'),
('sport_tvc','Sân cầu lông TVC','Cầu Giấy','运动 · 羽毛球场',21.026109,105.787277,'以现场公告为准',true,'室内羽毛球馆。坐标精确到场馆。','1 Phố Tôn Thất Thuyết, Dịch Vọng, Phường Cầu Giấy, Hà Nội','其他'),
('sport_quanngua','Cung Thể thao Tổng hợp Quần Ngựa','Ba Đình','运动 · 综合体育馆',21.040267,105.814495,'以现场公告为准',true,'市中心的综合体育馆。坐标精确到场馆。','30 Đường Văn Cao, Quần Ngựa, Phường Ngọc Hà, Hà Nội','其他'),
('sport_pickle_yenhoa','Sân Pickleball Yên Hòa','Cầu Giấy','运动 · 匹克球场',21.017111,105.800717,'以现场公告为准',true,'OSM 收录的匹克球场。坐标精确到场地。','Phố Nguyễn Bá Khoản, Trung Kính Thượng, Phường Yên Hòa, Hà Nội','其他'),
('sport_oceanpark_hall','Khu Thể thao Phức hợp Trong nhà · Ocean Park','Gia Lâm','运动 · 综合体育馆',20.989527,105.947493,'以现场公告为准',true,'Vinhomes Ocean Park 内的室内综合体育馆，是否对外开放以现场为准。坐标精确到场馆。','Đường Hải Đăng, Vinhomes Ocean Park, Xã Gia Lâm, Hà Nội','其他'),
('sport_ngoctrai_bad','Ngọc Trai Sân Cầu Lông','Gia Lâm','运动 · 羽毛球场',20.996561,105.946866,'以现场公告为准',true,'Vinhomes Ocean Park 社区内的羽毛球场，是否对外开放以现场为准。坐标精确到场地。','Ngọc Trai 9, Vinhomes Ocean Park, Xã Gia Lâm, Hà Nội','其他'),
('sport_haiau_bad','Hải Âu Sân Cầu Lông','Gia Lâm','运动 · 羽毛球场',20.990855,105.953859,'以现场公告为准',true,'Vinhomes Ocean Park 社区内的羽毛球场，是否对外开放以现场为准。坐标精确到场地。','Hải Âu 6, Vinhomes Ocean Park, Xã Gia Lâm, Hà Nội','其他'),
('sport_ngoctrai_tennis','Ngọc Trai Tennis Court','Gia Lâm','运动 · 网球场',20.99448,105.94781,'以现场公告为准',true,'Vinhomes Ocean Park 社区内的网球场，是否对外开放以现场为准。坐标精确到场地。','Ngọc Trai 7, Vinhomes Ocean Park, Xã Gia Lâm, Hà Nội','其他'),
('sport_hunganh','Sân cầu lông Hưng Ánh','Bắc Ninh','运动 · 羽毛球场',21.178641,106.078726,'以现场公告为准',true,'Bắc Ninh 的羽毛球场。坐标精确到场地。','Ngách 798/31 Đường Đấu Mã, Phường Võ Cường, TP Bắc Ninh','其他'),
('sport_hungcon','Sân cầu lông Hưng Con','Bắc Ninh','运动 · 羽毛球场',21.159995,106.0403,'以现场公告为准',true,'Bắc Ninh 的羽毛球场。坐标精确到场地。','Ngõ 555 Đường Nguyễn Văn Cừ, Xuân Ổ B, Phường Võ Cường, TP Bắc Ninh','其他')
ON CONFLICT (id) DO NOTHING;

-- SCENE-NO-FABRICATED-001: 场景目录只留**真实存在的地点**。
--
-- 1) 隐藏四个"演示场所"。它们在 reality.scenes 里存在，但**搜不到任何公开
--    记录**，是给 app 自己演示用的占位数据：
--      westlake   21.0669,105.8192 —— "环湖路线"，不是个点（湖很大，哪个坐标都
--                 是随手挑的），给它编个门牌号就是假数据；
--      complex01  21.0062,105.8284
--      banana     21.054,105.868
--      bonsaidon  21.0621,105.8256
--    用 status='HIDDEN' 而不是 DELETE：reality.user_scene_states 里可能已经有
--    用户给它们打过的收藏/去过标记，删行会把用户自己的历史悄悄弄丢。查询
--    （ListScenes / ListNearbyScenes）都带 WHERE status='ACTIVE'，隐藏即下架。
--
-- 2) 补四条**真实公共景点**（OSM / Nominatim 反查，坐标与地址都不是估的）：
--      vanmieu      21.0287903,105.8359533
--        → "Temple of Literature, Van Mieu - Quoc Tu Giam Ward, Hà Nội, 11508"
--      longbien     21.0431405,105.8581747
--        → "Long Biên Bridge, Ngõ 203 Đường Hồng Hà, An Xá, Hong Ha Ward, Hà Nội, 11025"
--      tranquoc     21.0478837,105.8368375
--        → "Tran Quoc Pagoda, Thanh Nien Road, Yen Phu, Tay Ho Ward, Hà Nội, 11214"
--      nguyenphilan 21.1861461,106.0742127
--        → "Nguyen Phi Y Lan Park, Kinh Bac Ward, Kinh Bac, Bắc Ninh City"
--        （距 threebeans_bn 约 350 m —— Bắc Ninh 市中心步行范围内第一次有两个场景）
--
-- 3) 把 069 里写死的 best（开放时间）和 description 里的"密度高"改成**有依据的
--    说法**：查不到就写「以现场公告为准」，不编一个看着专业的时间段。
--    active=false 的场景在详情页显示"近期适合"而不是"现在适合"。

UPDATE reality.scenes SET status='HIDDEN', updated_at=now()
WHERE id IN ('westlake','complex01','banana','bonsaidon');

-- 描述里的"密度高/内容质量高"没有来源 —— 换成场地本身是什么。
UPDATE reality.scenes SET best='全天开放', active=true, description='老城边的小型湖，环湖步道适合散步和傍晚停留。', updated_at=now() WHERE id='trucbach';
UPDATE reality.scenes SET best='全天开放', active=true, description='老城骑楼下的壁画街，适合街拍和散步。', updated_at=now() WHERE id='phunghung';
-- Train Street 经常因管制封闭，能否进要看当天通告 —— 这不是我们该猜的。
UPDATE reality.scenes SET best='以现场公告为准', active=false, description='贴着居民区的铁路窄巷，能否进入取决于当日管制通告。', updated_at=now() WHERE id='train';
UPDATE reality.scenes SET best='以现场公告为准', active=false, description='老别墅改的独立展览空间，按展期开放。', updated_at=now() WHERE id='manzi';
-- 门店营业时间只有商家自己知道；商家认领后由商家维护（见 SCENE-CONTRIB-001）。
UPDATE reality.scenes SET best='以门店公告为准', updated_at=now() WHERE id='threebeans';

INSERT INTO reality.scenes(id,name,area,type,latitude,longitude,best,active,description,address) VALUES
('vanmieu','Văn Miếu – Quốc Tử Giám','Văn Miếu','公共景点 · 古迹',21.0287903,105.8359533,'08:00–17:00 · 售票',false,'越南第一所国子监，售票参观的老城古迹。','Văn Miếu - Quốc Tử Giám, Hà Nội'),
('longbien','Cầu Long Biên','Hồng Hà','公共景点 · 桥',21.0431405,105.8581747,'全天开放',true,'横跨红河的百年铁桥，步行道可过河，日落与火车经过时人最多。','Cầu Long Biên, Phường Hồng Hà, Hà Nội'),
('tranquoc','Chùa Trấn Quốc · Hồ Tây','Tây Hồ','公共景点 · 寺庙',21.0478837,105.8368375,'以现场公告为准',false,'西湖东岸半岛上的古寺，是西湖日落最常去的观景点。','Chùa Trấn Quốc, Đường Thanh Niên, Yên Phụ, Tây Hồ, Hà Nội'),
('nguyenphilan','Công viên Nguyên Phi Ỷ Lan','Bắc Ninh','公共景点 · 公园',21.1861461,106.0742127,'全天开放',true,'Bắc Ninh 市中心的公共公园，傍晚人最多。','Công viên Nguyên Phi Ỷ Lan, Phường Kinh Bắc, TP Bắc Ninh')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,area=EXCLUDED.area,type=EXCLUDED.type,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,best=EXCLUDED.best,active=EXCLUDED.active,description=EXCLUDED.description,address=EXCLUDED.address,status='ACTIVE',updated_at=now();

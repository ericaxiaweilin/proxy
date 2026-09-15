-- SCENE-ADDRESS-001: 场景有坐标，但没有门牌地址。
--
-- reality.scenes 以前只有 area（"Cầu Giấy" 这种**区名**）+ lat/lng。地图 marker
-- 的 description 拼的是 `area · type`，所以用户问"这家店在哪条街"答不上来 ——
-- 区名不是地址，拿它冒充地址就是假数据。地址必须是**独立的字段**，而且可以为空：
-- "没记录地址" 和 "地址是空串" 和 "地址是区名" 是三件不同的事，不许互相冒充。
--
-- SCENE-NO-FABRICATED-001: 同时删掉五个**编出来的**整数列。
--   quality / posts / creators / activities / invites 是 069 迁移里手写死的
--   常数 —— 全仓没有任何 post↔scene 的关联、没有任何"质量"评分来源。它们
--   大部分连 UI 都不显示，却拿去算 recommendation_score（推荐度），等于用编的
--   数字决定用户先看到谁。留着它们，任何新人都会以为"场景有热度数据"。
--
--   删列是安全的：Migrator 用 schema_migrations 记版本，069/070 已 apply 的
--   不会再跑一遍；而且 reality.user_scene_states 对 scene_id 没有外键。
--
-- 坐标 / 地址一律以 OSM(Nominatim) 查到的为准，**不是估的、不是编的**：
--   hoankiem      21.0288313,105.8525357 → Hoàn Kiếm Lake, Hoan Kiem Ward, Hà Nội 11024
--   trucbach      21.0463247,105.8384008 → Truc Bach Lake, Ba Dinh Ward, Hà Nội 11120
--   phunghung     21.0360490,105.8460019 → Phung Hung Street, Old Quarter, Hoàn Kiếm
--   train         21.0295823,105.8433206 → Hanoi Train Street, Hà Trung St, Old Quarter
--   manzi         21.0414885,105.8455896 → 14 Phan Huy Ich Street, Ba Đình, Hà Nội
--   threebeans    21.0359,105.7906       → Đường Cầu Giấy, Dịch Vọng, Cầu Giấy
--   threebeans_bn 21.1861,106.0707       → Lê Văn Thịnh, Suối Hoa, TP Bắc Ninh
--     （与仓库自己的反查夹具一致：internal/api/geocode_test.go 里
--      21.1861,106.0707 解析出 "… Suối Hoa 2, Bắc Ninh, Việt Nam"）
--
-- 查不到权威数据的（见 095）不进目录 —— 宁可少一条，也不给它编一个门牌号。
ALTER TABLE reality.scenes ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

ALTER TABLE reality.scenes
  DROP COLUMN IF EXISTS quality,
  DROP COLUMN IF EXISTS posts,
  DROP COLUMN IF EXISTS creators,
  DROP COLUMN IF EXISTS activities,
  DROP COLUMN IF EXISTS invites;

-- 坐标纠偏 + 补地址（只动查得到权威数据的那几条）
UPDATE reality.scenes SET latitude=21.0463247, longitude=105.8384008, address='Hồ Trúc Bạch, Phường Ba Đình, Hà Nội', updated_at=now() WHERE id='trucbach';
UPDATE reality.scenes SET latitude=21.0360490, longitude=105.8460019, address='Phố Phùng Hưng, Phố Cổ, Hoàn Kiếm, Hà Nội', updated_at=now() WHERE id='phunghung';
UPDATE reality.scenes SET latitude=21.0295823, longitude=105.8433206, address='Hanoi Train Street, Phố Hà Trung, Phố Cổ, Hoàn Kiếm, Hà Nội', updated_at=now() WHERE id='train';
UPDATE reality.scenes SET latitude=21.0414885, longitude=105.8455896, address='14 Phan Huy Ích, Ba Đình, Hà Nội', updated_at=now() WHERE id='manzi';
UPDATE reality.scenes SET address='Đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội', updated_at=now() WHERE id='threebeans';

INSERT INTO reality.scenes(id,name,area,type,latitude,longitude,best,active,description,address) VALUES
('threebeans_bn','Three Beans · Bắc Ninh','Bắc Ninh','咖啡 · 动态场景',21.1861,106.0707,'以门店公告为准',true,'Bắc Ninh 市中心的咖啡场景：早班咖啡、下午办公与周末小型活动。','Lê Văn Thịnh, Suối Hoa, TP Bắc Ninh'),
('hoankiem','Hồ Hoàn Kiếm','Hoàn Kiếm','公共景点 · 湖边',21.0288313,105.8525357,'全天开放',true,'河内老城中心的公共湖景：清晨太极与跑步、白天环湖、周末步行街。','Hồ Hoàn Kiếm, Phường Hoàn Kiếm, Hà Nội')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,area=EXCLUDED.area,type=EXCLUDED.type,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,best=EXCLUDED.best,active=EXCLUDED.active,description=EXCLUDED.description,address=EXCLUDED.address,updated_at=now();

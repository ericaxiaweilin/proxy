CREATE TABLE IF NOT EXISTS reality.scenes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL, type TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  quality INTEGER NOT NULL CHECK (quality BETWEEN 0 AND 100), best TEXT NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0, creators INTEGER NOT NULL DEFAULT 0,
  activities INTEGER NOT NULL DEFAULT 0, invites INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT FALSE, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reality.user_scene_states ADD COLUMN IF NOT EXISTS visited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS reality_scene_geo_idx ON reality.scenes(latitude,longitude) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS reality_scene_visited_timeline_idx ON reality.user_scene_states(actor_id,visited_at DESC) WHERE private_visited;
INSERT INTO reality.scenes(id,name,area,type,latitude,longitude,quality,best,posts,creators,activities,invites,active,description) VALUES
('trucbach','Trúc Bạch 湖边','Ba Đình','湖边 · 夜景',21.0454,105.8361,93,'17:20–19:10',86,31,8,22,true,'湖边步行、夜景与小型聚会密度高。'),
('westlake','West Lake Sunset Loop','Tây Hồ','骑行 · 日落',21.0669,105.8192,96,'16:30–18:40',214,72,21,48,false,'高复访路线，适合骑行、散步和摄影。'),
('phunghung','Phùng Hưng Mural Street','Hoàn Kiếm','街区 · 摄影',21.034,105.8442,88,'08:00–10:30',102,45,4,13,false,'适合街拍、壁画和老城主题内容。'),
('train','Hanoi Train Street','Hoàn Kiếm','街区 · 体验',21.0292,105.8426,84,'15:00–17:30',167,64,3,18,false,'热门城市体验场景。'),
('complex01','Complex 01','Đống Đa','空间 · 活动',21.0062,105.8284,91,'14:00–21:00',74,39,14,19,true,'近期活动密度高。'),
('manzi','Manzi Art Space','Ba Đình','艺术 · 展览',21.0395,105.846,89,'10:00–18:00',43,22,5,9,false,'内容质量高的展览空间。'),
('banana','Red River Banana Island','Long Biên','自然 · 骑行',21.054,105.868,87,'06:30–09:00',58,26,7,17,false,'适合骑行和自然内容。'),
('bonsaidon','Bonsaidon · Tây Hồ','Tây Hồ','商家 · 社交',21.0621,105.8256,90,'14:00–20:30',119,41,17,32,true,'公开活动与 Creator 联动节点。')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,area=EXCLUDED.area,type=EXCLUDED.type,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,quality=EXCLUDED.quality,best=EXCLUDED.best,posts=EXCLUDED.posts,creators=EXCLUDED.creators,activities=EXCLUDED.activities,invites=EXCLUDED.invites,active=EXCLUDED.active,description=EXCLUDED.description,updated_at=now();

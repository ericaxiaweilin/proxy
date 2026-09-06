-- R27 canonical venue seed. Scene variants are derived by Scene Service and
-- intentionally do not claim live attendance or person location.
INSERT INTO reality.scenes(id,name,area,type,latitude,longitude,quality,best,posts,creators,activities,invites,active,description)
VALUES ('threebeans','Three Beans · Cầu Giấy','Cầu Giấy','咖啡 · 动态场景',21.0359,105.7906,94,'07:30–20:30',128,36,12,27,true,'同一门店按时间切换咖啡、出片、下班社交与周末活动场景。')
ON CONFLICT(id) DO NOTHING;

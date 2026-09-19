-- Three Beans · Bắc Ninh 真机实测纠偏（2026-09-18）。
--
-- 用户在店内上报定位 21.1823358,106.0705292，逆编码命中 109 Lý Chiêu Hoàng
-- 独栋（与上报点相距约 10m）。旧值 21.1861,106.0707 是落在 Suối Hoa 街上的
-- mock 点，在店内显示偏约 400m。坐标取该建筑中心（地图锚定，不用单次 GPS
-- 采样）。幂等：UPDATE 可重复执行。
UPDATE reality.scenes SET latitude=21.1824108, longitude=106.0705999, address='109 Lý Chiêu Hoàng, Suối Hoa, TP Bắc Ninh', updated_at=now() WHERE id='threebeans_bn';

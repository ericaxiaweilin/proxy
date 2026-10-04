-- FOR-YOU-CANDIDATES-001（2026-10-04，用户：「改成一个单条件 30km 就可以，默认是能接单的，
-- 30km 全部的，这个距离在越南有摩托车属于可接受的距离」）。
--
-- 以前「附近的人」只认 supply.agent_profiles 里的坐标 —— 等于要求先开通接单资料，
-- 新注册的人一个都进不来。现在默认人人可接单，候选 = 30km 内的全部人；位置来自
-- App 拿到真实定位后上报到自己的资料上（UpdateMyLocation）。没有任何位置的人仍然
-- 不进「附近」：距离未知 ≠ 很近（PERSON-DISTANCE-ZERO-001），也不拿城市中心去凑。
--
-- 这两列只用于服务端算距离；附近接口只返回距离，不把任何人的坐标发给别人。
BEGIN;

ALTER TABLE identity.profiles
    ADD COLUMN IF NOT EXISTS lat                 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lng                 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- 接单资料上的服务坐标：附近查询一直在读 supply.agent_profiles.lat/lng，但没有任何迁移
-- 建过这两列（开发库里是手工加的）——全新库上附近查询会直接报 column does not exist。
-- 这里补上；开发库上 IF NOT EXISTS 是空操作。
ALTER TABLE supply.agent_profiles
    ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

ALTER TABLE identity.profiles DROP CONSTRAINT IF EXISTS profiles_location_range;
ALTER TABLE identity.profiles ADD CONSTRAINT profiles_location_range
    CHECK ((lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180));

COMMIT;

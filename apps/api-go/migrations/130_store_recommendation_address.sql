-- STORE-REC-ADDRESS-001（2026-09-25，用户：「推荐管理城市要用预设的+地址地图」）：
-- 推荐记录带上**位置** —— 门牌地址 + 地图落点。
--
-- 原状：推荐只有城市（092）。城市是粗定位，运营拿到「河内 · Three Beans」
-- 没法判断这家店在哪、更没法照着去谈；设计稿里一直有「详细地址」一栏，表里
-- 却没有这个字段 —— 所以表单里那条 REC_UNCOLLECTED_NOTE 一直写着「填了也只会丢」。
--
-- 坐标口径沿用 069/097（DOUBLE PRECISION + 范围 CHECK）。
-- 地址与坐标**都可选**，这是被两条既有约束逼出来的，不是口味：
--   · 小美草稿（SuggestStoreRecommendation）不可能给出坐标，必填会让 AI 路径直接废掉；
--   · 092 里已有的存量推荐没有地址，必填等于让它们永远不合法。
-- 但坐标**要么都有、要么都没有** —— 只有一半的坐标画不出点，是一份坏数据。
--
-- 仍然是 append-only：这里只加列，不重写任何一行，举证链不动。
-- 读取口径也不变（运营队列 operator-only，「我推荐的店」只看自己），
-- 所以地址没有多开一条对外通道。

ALTER TABLE business.store_recommendations
    ADD COLUMN IF NOT EXISTS address   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- 幂等：约束单独加（049 的写法）。这里刻意不加 NOT VALID ——
-- 存量行的坐标是 NULL，本来就满足这三条，没有需要「不去追认」的历史行。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_recommendations_latitude_range') THEN
        ALTER TABLE business.store_recommendations ADD CONSTRAINT store_recommendations_latitude_range
            CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_recommendations_longitude_range') THEN
        ALTER TABLE business.store_recommendations ADD CONSTRAINT store_recommendations_longitude_range
            CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
    END IF;
    -- 坐标要么都有要么都没有：只有一半的坐标画不出点。
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_recommendations_coordinate_pair') THEN
        ALTER TABLE business.store_recommendations ADD CONSTRAINT store_recommendations_coordinate_pair
            CHECK ((latitude IS NULL) = (longitude IS NULL));
    END IF;
END $$;

COMMENT ON COLUMN business.store_recommendations.address IS
  'STORE-REC-ADDRESS-001: 门牌地址（可空）。落点坐标见 latitude/longitude —— 由客户端地图选点给出。';

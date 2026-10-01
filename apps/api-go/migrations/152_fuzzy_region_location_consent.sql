-- 给 location.location_consents.kind 增加 FUZZY_REGION（模糊位置共享同意）。
-- 2026-10-01。
--
-- 062 把 kind 钉死成 CHECK (kind = 'PRECISE_GPS')。已应用迁移只许改名不许改内容，
-- 所以向前加一条：先 DROP 旧约束再 ADD 新约束（两个动作都写成幂等的 —— 见下）。
--
-- 为什么是**新的 kind** 而不是复用 PRECISE_GPS：
--   PRECISE_GPS  = 把自己的**精确**坐标交给匹配对象 / 服务；
--   FUZZY_REGION = 只交粗化到约 1km 网格的**区域**，永不交精确坐标。
-- 合成一个 kind 就等于让「同意精确」自动等于「同意模糊」—— 那正是越南
-- NĐ 356/2025 Art. 6.3 禁止的默认同意 / 捆绑同意。授权对象不同，就得分两个 kind。
--
-- ⚠️ 这条约束是「枚举取值」闸门：kind 的取值集合必须和 Go 侧
--   internal/location/consent.go 的 NormalizeKind 白名单、以及
--   apps/mobile/src/location-consent-client.ts 的 LocationConsentKind 联合类型
--   三处一致。少改一处，写进来的 kind 会被另一层静默拒掉。

DO $$
BEGIN
    -- 先摘掉旧约束（存在才摘）。不加 IF EXISTS 是因为 DROP CONSTRAINT 本身
    -- 没有 IF EXISTS 形式；用 catalog 查一次比吞掉报错更清楚。
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'location_consents_kind_check'
          AND conrelid = 'location.location_consents'::regclass
    ) THEN
        ALTER TABLE location.location_consents DROP CONSTRAINT location_consents_kind_check;
    END IF;

    -- 再装上新约束。catalog 里已经有一份同名的就跳过 —— 让整条迁移可以重跑，
    -- 而不是第二次执行时报 constraint already exists。
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'location_consents_kind_check'
          AND conrelid = 'location.location_consents'::regclass
    ) THEN
        ALTER TABLE location.location_consents
            ADD CONSTRAINT location_consents_kind_check
            CHECK (kind IN ('PRECISE_GPS', 'FUZZY_REGION'));
    END IF;
END $$;

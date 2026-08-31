-- 042_media_review_decisions_partition.sql
-- R15.20 遗留：media_review_decisions 单表一年后 >>100k 行，按月 RANGE 分区提升
-- 查询与清理效率。采用 PG declarative partitioning，保留 append-only 语义。
--
-- 策略：
--   1. 创建新分区表 media.media_review_decisions_partitioned (PARTITION BY RANGE reviewed_at)
--   2. 创建 12 个子分区 p2026_08 .. p2027_07，覆盖未来一年；超期数据进 default 分区
--   3. 原表数据幂等迁移（ON CONFLICT DO NOTHING，因决策 ID 全局唯一）
--   4. 原表重命名为 _legacy，partitioned 表更名为 media_review_decisions（零downtime 切表）
--   5. 重建索引 / 约束 / RLS / COMMENT；legacy 表保留 30 天供回滚
--
-- 注意：FK 到 media_assets 在分区表上每分区独立校验，PG 12+ 支持。

-- 1. 创建分区母表（若已分区则跳过，用 pg_class.relkind + relispartition 检查）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'media' AND c.relname = 'media_review_decisions'
          AND c.relkind = 'p'  -- partitioned table
    ) THEN
        -- 原表存在且为普通表：先建新分区母表
        CREATE TABLE media.media_review_decisions_partitioned (
            decision_id    TEXT NOT NULL,
            media_asset_id TEXT NOT NULL,
            from_status    TEXT NOT NULL,
            to_status      TEXT NOT NULL,
            reason         TEXT NOT NULL,
            note           TEXT NOT NULL DEFAULT '',
            operator_id    TEXT NOT NULL,
            reviewed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (decision_id, reviewed_at),
            CONSTRAINT media_review_decisions_reason_check
                CHECK (reason IN ('APPROVE','REJECT_NUDITY','REJECT_POLITICS','REJECT_VIOLENCE')),
            CONSTRAINT media_review_decisions_status_check
                CHECK (
                    from_status IN ('QUARANTINED','APPROVED','REJECTED_TECHNICAL',
                                    'REJECTED_CONTENT_NUDITY','REJECTED_CONTENT_POLITICS',
                                    'REJECTED_CONTENT_VIOLENCE')
                    AND to_status IN ('APPROVED','REJECTED_CONTENT_NUDITY',
                                      'REJECTED_CONTENT_POLITICS','REJECTED_CONTENT_VIOLENCE')
                ),
            CONSTRAINT media_review_decisions_asset_fk
                FOREIGN KEY (media_asset_id) REFERENCES media.media_assets(media_asset_id) ON DELETE RESTRICT
        ) PARTITION BY RANGE (reviewed_at);

        -- 2. 创建 12 个月分区 + default
        CREATE TABLE media.media_review_decisions_p2026_08 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
        CREATE TABLE media.media_review_decisions_p2026_09 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
        CREATE TABLE media.media_review_decisions_p2026_10 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
        CREATE TABLE media.media_review_decisions_p2026_11 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
        CREATE TABLE media.media_review_decisions_p2026_12 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
        CREATE TABLE media.media_review_decisions_p2027_01 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
        CREATE TABLE media.media_review_decisions_p2027_02 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
        CREATE TABLE media.media_review_decisions_p2027_03 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
        CREATE TABLE media.media_review_decisions_p2027_04 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
        CREATE TABLE media.media_review_decisions_p2027_05 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
        CREATE TABLE media.media_review_decisions_p2027_06 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
        CREATE TABLE media.media_review_decisions_p2027_07 PARTITION OF media.media_review_decisions_partitioned
            FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
        -- default 分接超期/历史数据（PG 11+ 支持）
        CREATE TABLE media.media_review_decisions_default PARTITION OF media.media_review_decisions_partitioned DEFAULT;

        -- 3. 索引（分区母表上创建，自动传播到各分区）
        CREATE INDEX idx_media_review_decisions_asset_p ON media.media_review_decisions_partitioned (media_asset_id, reviewed_at DESC);
        CREATE INDEX idx_media_review_decisions_operator_p ON media.media_review_decisions_partitioned (operator_id, reviewed_at DESC);

        -- 4. 迁移原表数据（幂等：ON CONFLICT (decision_id, reviewed_at) DO NOTHING）
        INSERT INTO media.media_review_decisions_partitioned
            (decision_id, media_asset_id, from_status, to_status, reason, note, operator_id, reviewed_at)
        SELECT decision_id, media_asset_id, from_status, to_status, reason, note, operator_id, reviewed_at
        FROM media.media_review_decisions
        ON CONFLICT (decision_id, reviewed_at) DO NOTHING;

        -- 5. 切换：原表 → _legacy，分区表 → 正式名
        ALTER TABLE media.media_review_decisions RENAME TO media_review_decisions_legacy;
        ALTER TABLE media.media_review_decisions_partitioned RENAME TO media_review_decisions;

        -- 6. RLS（若原表已启用，继承到新表；否则按 032/033 逻辑重建）
        DO $rls$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_operator') THEN
                ALTER TABLE media.media_review_decisions ENABLE ROW LEVEL SECURITY;
                ALTER TABLE media.media_review_decisions FORCE ROW LEVEL SECURITY;
                IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'media.media_review_decisions'::regclass AND polname = 'media_review_decisions_select_operator') THEN
                    CREATE POLICY media_review_decisions_select_operator ON media.media_review_decisions FOR SELECT TO proxy_api_operator USING (true);
                END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_auditor') AND NOT EXISTS (
                    SELECT 1 FROM pg_policy WHERE polrelid = 'media.media_review_decisions'::regclass AND polname = 'media_review_decisions_select_auditor'
                ) THEN
                    CREATE POLICY media_review_decisions_select_auditor ON media.media_review_decisions FOR SELECT TO proxy_api_auditor USING (true);
                END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_observer') AND NOT EXISTS (
                    SELECT 1 FROM pg_policy WHERE polrelid = 'media.media_review_decisions'::regclass AND polname = 'media_review_decisions_select_observer'
                ) THEN
                    CREATE POLICY media_review_decisions_select_observer ON media.media_review_decisions FOR SELECT TO proxy_api_observer USING (true);
                END IF;
            END IF;
        END
        $rls$;

        COMMENT ON TABLE media.media_review_decisions IS 'R15.18+042: partitioned by RANGE (reviewed_at) monthly, append-only audit trail. Legacy copy kept as media_review_decisions_legacy.';
    END IF;
END
$$;

-- 7. 便利：未来分区创建 helper（运维可 SELECT media.create_next_month_partition('2027-08-01')）
CREATE OR REPLACE FUNCTION media.create_next_month_partition(month_start DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    part_name TEXT := 'media_review_decisions_p' || to_char(month_start, 'YYYY_MM');
    next_month DATE := month_start + INTERVAL '1 month';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
        EXECUTE format('CREATE TABLE %I PARTITION OF media.media_review_decisions FOR VALUES FROM (%L) TO (%L)',
            part_name, month_start::TEXT, next_month::TEXT);
    END IF;
END
$$;

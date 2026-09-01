-- 035_media_review_decisions_partition.sql
-- R15.23: media_review_decisions 表按月分区。
-- 现状: 1 row 没问题, 但 1y 后预期 100k+ 行 (每个 reject case 一行)。
-- 未分区表的成本: 索引大小 O(N), VACUUM / ANALYZE 走整表,
-- 备份 / restore 整张表。分区后:
--   - 索引大小 O(N/12)
--   - 老月份分区可独立 detach + archive
--   - 查询按 reviewed_at 范围只扫相关分区
--
-- 设计:
--   - PARTITION BY RANGE (reviewed_at)
--   - 12 monthly partitions: 2025-09 .. 2026-08 (含当月)
--   - 1 DEFAULT partition 收边界外 (稳态下为空, 但 2030 年新月份不会因为缺分区被拒)
--   - 跟 R15.18 一样的列: decision_id / media_asset_id / from / to / reason / note / operator_id / reviewed_at
--   - 跟 R15.18 一样的 CHECK 约束 (status, reason)
--   - 跟 R15.18 一样的 FK 到 media.media_assets (PG 12+ 支持 partition parent 上的 FK)
--   - 跟 R15.18 一样的索引 (auto-propagate 到所有分区)
--   - 重新挂上 RLS policies (从 032/033/034 切过来, 切换后老表没了)
--
-- 兼容性: migration 是 idempotent — 通过 pg_partitioned_table 探测, 已分区则跳过。
-- 已 ship 部署: 直接跑, 老表 rename 为 _pre23, 数据 copy, 老表 drop。
-- 注意: RENAME 表不会 RENAME 它的索引, 我们先 RENAME 索引, 否则
-- CREATE INDEX 在新表上会因为 _pre23 已有同名索引而 42P07 失败。

DO $$
DECLARE
    already_partitioned BOOLEAN;
    row_count INT;
BEGIN
    -- 探测: 已是 partitioned 则跳过 (idempotent re-apply)
    SELECT EXISTS (
        SELECT 1 FROM pg_partitioned_table pt
        JOIN pg_class c ON pt.partrelid = c.oid
        WHERE c.relname = 'media_review_decisions' AND c.relnamespace = 'media'::regnamespace
    ) INTO already_partitioned;

    IF already_partitioned THEN
        RAISE NOTICE 'media.media_review_decisions 已分区, 跳过';
        RETURN;
    END IF;

    -- 1. 老表 + 索引 RENAME
    -- 顺序: 先 RENAME 索引, 再 RENAME 表 (避免索引被自动跟随时卡到 RENAME 操作)
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_media_review_decisions_asset' AND relnamespace = 'media'::regnamespace) THEN
        ALTER INDEX media.idx_media_review_decisions_asset
            RENAME TO idx_media_review_decisions_asset_pre23;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_media_review_decisions_operator' AND relnamespace = 'media'::regnamespace) THEN
        ALTER INDEX media.idx_media_review_decisions_operator
            RENAME TO idx_media_review_decisions_operator_pre23;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'media_review_decisions_pkey' AND relnamespace = 'media'::regnamespace) THEN
        ALTER INDEX media.media_review_decisions_pkey
            RENAME TO media_review_decisions_pkey_pre23;
    END IF;
    ALTER TABLE media.media_review_decisions
        RENAME TO media_review_decisions_pre23;

    -- 2. 新表 (partitioned)
    -- PRIMARY KEY 必须包含分区键 (partition 限定)
    CREATE TABLE media.media_review_decisions (
        decision_id    TEXT NOT NULL,
        media_asset_id TEXT NOT NULL,
        from_status    TEXT NOT NULL,
        to_status      TEXT NOT NULL,
        reason         TEXT NOT NULL,
        note           TEXT NOT NULL DEFAULT '',
        operator_id    TEXT NOT NULL,
        reviewed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (decision_id, reviewed_at)
    ) PARTITION BY RANGE (reviewed_at);

    -- 3. CHECK 约束 (分区表不自动 propagate, 必须在父表声明一次)
    ALTER TABLE media.media_review_decisions
        ADD CONSTRAINT media_review_decisions_reason_check
        CHECK (reason IN ('APPROVE','REJECT_NUDITY','REJECT_POLITICS','REJECT_VIOLENCE'));

    ALTER TABLE media.media_review_decisions
        ADD CONSTRAINT media_review_decisions_status_check
        CHECK (
            from_status IN ('QUARANTINED','APPROVED','REJECTED_TECHNICAL',
                            'REJECTED_CONTENT_NUDITY','REJECTED_CONTENT_POLITICS',
                            'REJECTED_CONTENT_VIOLENCE')
            AND to_status IN ('APPROVED','REJECTED_CONTENT_NUDITY',
                              'REJECTED_CONTENT_POLITICS','REJECTED_CONTENT_VIOLENCE')
        );

    -- 4. FK 到 media.media_assets (PG 12+ 支持 partitioned parent 上 FK 到非分区表)
    ALTER TABLE media.media_review_decisions
        ADD CONSTRAINT media_review_decisions_asset_fk
        FOREIGN KEY (media_asset_id) REFERENCES media.media_assets(media_asset_id)
        ON DELETE RESTRICT;

    -- 5. 索引 (auto-propagate 到分区)
    CREATE INDEX idx_media_review_decisions_asset
        ON media.media_review_decisions (media_asset_id, reviewed_at DESC);
    CREATE INDEX idx_media_review_decisions_operator
        ON media.media_review_decisions (operator_id, reviewed_at DESC);

    -- 6. 创建 12 monthly partitions (2025-09 到 2026-08) + 1 default
    -- 顺序必须在 INSERT 之前, 否则 row 路由不到分区会报 23514
    CREATE TABLE media.media_review_decisions_2025_09 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
    CREATE TABLE media.media_review_decisions_2025_10 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
    CREATE TABLE media.media_review_decisions_2025_11 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
    CREATE TABLE media.media_review_decisions_2025_12 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
    CREATE TABLE media.media_review_decisions_2026_01 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    CREATE TABLE media.media_review_decisions_2026_02 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
    CREATE TABLE media.media_review_decisions_2026_03 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
    CREATE TABLE media.media_review_decisions_2026_04 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
    CREATE TABLE media.media_review_decisions_2026_05 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
    CREATE TABLE media.media_review_decisions_2026_06 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
    CREATE TABLE media.media_review_decisions_2026_07 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
    CREATE TABLE media.media_review_decisions_2026_08 PARTITION OF media.media_review_decisions
        FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
    CREATE TABLE media.media_review_decisions_default PARTITION OF media.media_review_decisions DEFAULT;

    -- 7. 数据迁移 (老表 → 新表)
    EXECUTE 'INSERT INTO media.media_review_decisions
        (decision_id, media_asset_id, from_status, to_status, reason, note, operator_id, reviewed_at)
        SELECT decision_id, media_asset_id, from_status, to_status, reason, note, operator_id, reviewed_at
        FROM media.media_review_decisions_pre23';
    GET DIAGNOSTICS row_count = ROW_COUNT;
    RAISE NOTICE 'migrated % rows from _pre23 to new partitioned table', row_count;

    -- 8. 老表 drop (我们已先 RENAME 索引, CASCADE 不需要)
    DROP TABLE media.media_review_decisions_pre23;

    -- 9. RLS policies (重挂 — 032/033/034 引用的是老表, 切到新表后需补回)
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_operator') THEN
        ALTER TABLE media.media_review_decisions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE media.media_review_decisions FORCE ROW LEVEL SECURITY;
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'media_review_decisions_select_operator') THEN
            EXECUTE 'CREATE POLICY media_review_decisions_select_operator
                ON media.media_review_decisions
                FOR SELECT TO proxy_api_operator USING (true)';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_auditor') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'media_review_decisions_select_auditor') THEN
            EXECUTE 'CREATE POLICY media_review_decisions_select_auditor
                ON media.media_review_decisions
                FOR SELECT TO proxy_api_auditor USING (true)';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_api_observer') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'media_review_decisions_select_observer') THEN
            EXECUTE 'CREATE POLICY media_review_decisions_select_observer
                ON media.media_review_decisions
                FOR SELECT TO proxy_api_observer USING (true)';
        END IF;
    END IF;
END$$;

COMMENT ON TABLE media.media_review_decisions IS
    'R15.23: media_review_decisions 改为 PARTITION BY RANGE (reviewed_at), 12 monthly 子表 + 1 default。R15.18-22 的列/约束/索引/RLS policy 全部保留。';
COMMENT ON TABLE media.media_review_decisions_2025_09 IS 'R15.23: monthly partition';
COMMENT ON TABLE media.media_review_decisions_2026_08 IS 'R15.23: monthly partition (current month)';
COMMENT ON TABLE media.media_review_decisions_default IS 'R15.23: default partition 收未来新月份 (稳态下应空, 监控告警)';

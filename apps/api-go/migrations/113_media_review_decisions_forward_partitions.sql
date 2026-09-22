-- 113_media_review_decisions_forward_partitions.sql
--
-- 035 给 media.media_review_decisions 建了 12 个月分区 2025-09 .. 2026-08 + 1 个
-- default，注释明说窗口就到 2026-08。
-- 042 声称「创建 12 个子分区 p2026_08 .. p2027_07，覆盖未来一年」，但它的**整个
-- 函数体**挂在一个 `IF NOT EXISTS (relkind='p')` 守卫下 —— 035 之后这张表**已经
-- 是分区表**，所以 042 的 body 从落地那天起就是**不可达的死代码**。
--
-- 2026-09-22 实测（本地库）：分区只有 2025_09..2026_08 + default，
-- p2026_08 / p2027_01 / p2027_07 … **一个都不存在**。042 唯一真正生效的是文件
-- 末尾那句 CREATE FUNCTION media.create_next_month_partition()。
--
-- 后果：2026-09 起所有新决策都落进 default 分区 —— 「按月分区」这个能力（索引
-- O(N/12)、老月份可独立 detach+archive、按 reviewed_at 只扫相关分区）实际上是死的，
-- 而 035 说 default「稳态下为空」。今天正好是 2026-09-22，即窗口刚过期的第一天。
--
-- 本迁移把窗口补到「应用时刻 + 24 个月」，幂等（逐个分区先探测再建）。
-- 顺手把 042 那个 helper 的名字前缀对齐到 035 的既有命名（035 用
-- `media_review_decisions_YYYY_MM`，042 的 helper 会造 `..._pYYYY_MM` —— 同一段
-- 范围两个名字，容易让人以为缺分区）。helper 只有运维会调，改名不影响代码路径。
--
-- ⚠️ 窗口是**一次性**预置的。default 分区一旦出现行，就说明窗口又过期了。
--    运维动作（不需要新迁移）：
--      SELECT media.create_next_month_partition('<下个月的 1 号>'::date);
--    若 default 里已经有落在新分区范围内的行，CREATE TABLE ... PARTITION OF 会
--    明确报 "updated partition constraint for default partition would be violated"
--    —— 那是**正确的大声失败**，处理顺序是：先把那些行搬到一张临时表，
--    建好分区，再 INSERT 回来。
--
-- 为什么需要这张表有分区窗口而不用 default 兜底：审计表按 reviewed_at 归档是
-- 032/035 明确要的能力；default 兜底只保证「不拒写」，不保证「可归档」。

CREATE OR REPLACE FUNCTION media.create_next_month_partition(month_start DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    first_day DATE := date_trunc('month', month_start)::date;
    next_day  DATE := (date_trunc('month', month_start) + INTERVAL '1 month')::date;
    part_name TEXT := 'media_review_decisions_' || to_char(date_trunc('month', month_start)::date, 'YYYY_MM');
BEGIN
    IF to_regclass('media.' || part_name) IS NULL THEN
        EXECUTE format(
            'CREATE TABLE media.%I PARTITION OF media.media_review_decisions FOR VALUES FROM (%L) TO (%L)',
            part_name, first_day::text, next_day::text);
    END IF;
END
$$;

DO $$
DECLARE
    m    DATE;
    stop DATE;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'media' AND c.relname = 'media_review_decisions' AND c.relkind = 'p'
    ) THEN
        RAISE NOTICE '113: media.media_review_decisions 不是分区表，跳过';
        RETURN;
    END IF;

    -- 035 窗口的终点 2026-08 的下一格。
    m    := DATE '2026-09-01';
    stop := (date_trunc('month', now()) + INTERVAL '24 months')::date;
    IF stop < m THEN
        stop := m;  -- 时钟异常时也不漏建
    END IF;

    WHILE m < stop LOOP
        PERFORM media.create_next_month_partition(m);
        m := (m + INTERVAL '1 month')::date;
    END LOOP;
END
$$;

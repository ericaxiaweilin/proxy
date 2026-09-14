-- GHOST-24H-001: 临时动态（24h）的到期时间必须真的存在，feed 必须真的到期不返回。
--
-- 现状（实测全仓 grep）：`ephemeralUntil` 只出现在 contracts 的 zod schema 与
-- mobile 的发布 payload 里，**api-go 里一次都没有** —— Post 结构体没有这个字段、
-- createPostPayload 不解析它、数据库没有列、feed 查询没有过期条件。
--
-- 于是真实发生的事是：
--   1. 用户在发布器里打开「24h 临时动态」；
--   2. 客户端算好 `ephemeralUntil = now + 24h` 放进 CreatePost payload；
--   3. Go 的 JSON 解码**静默忽略未知字段**，服务端不报错、也不存；
--   4. 客户端弹出 toast「24h 动态已发布」；
--   5. 这条帖子**永久存在**。
--
-- 这不是「少做了一个功能」，是一条**对用户撒谎**的路径：应用明明白白承诺
-- 「24 小时后消失」，而它既不消失、也没有任何地方告诉用户它没消失。跟
-- SEARCH-CORPUS-001（通道建好没人接线）、MUTE-REVERSIBLE-001（只能进不能出）
-- 是同一类缺陷——写出来像有，实际没有。
--
-- 而且它带隐私含义：用户正是**因为**相信它会消失，才会发那些不想留下记录
-- 的内容。PDP 91/2025 与 NĐ 356/2025 之下，「承诺了会过期却永久留存」比
-- 「一开始就没提供这个功能」严重得多——后者是功能少，前者是错误陈述。
--
-- 设计口径：
--   - 一列 nullable timestamptz。NULL = 永久动态（既有行为，存量数据全部是 NULL，
--     不需要回填，不需要迁移历史数据）。
--   - 不过期删除：只做**读时过滤**（ephemeral_until > now()），不动 status、
--     不物理删行。理由：feed 分页的 LIMIT 计数必须正确（先删行再 limit 会少给
--     一页；先 limit 再过滤会漏），而且行留着才能举证「这条内容确实到期了」，
--     不是被谁偷偷删掉的。
--   - 不做 CHECK (ephemeral_until > created_at)：now() 不是 immutable，
--     PostgreSQL 不允许在 CHECK 里用。这个约束放到应用层。

ALTER TABLE localnet.posts
    ADD COLUMN IF NOT EXISTS ephemeral_until TIMESTAMPTZ;

-- 到期过滤是 feed 主查询的一部分（`ephemeral_until IS NULL OR ephemeral_until > now()`），
-- 绝大多数行是 NULL，用部分索引只索引真的会过期的那批，避免为一个稀有谓词
-- 维护一张全表索引。
CREATE INDEX IF NOT EXISTS posts_ephemeral_until_idx
    ON localnet.posts (ephemeral_until)
    WHERE ephemeral_until IS NOT NULL;

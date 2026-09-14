-- POLL-VOTE-001: 投票必须真的能投、真的能数票。
--
-- 现状（实测全仓 grep）：投票的 UI 是完整的 —— ComposerV2Screen 有「添加投票」
-- 按钮、可增删选项、可选时长（1 天…），发布时 composer-publish 会算出
-- `payload.poll = { expiresAt, options[] }` 一起发上来，composer-body 还会往正文
-- 拼一段「📊 1 天 / - 选项A / - 选项B」。
--
-- 但服务端**一个 poll 字段都没有**：api-go 里 5 处 `poll` 全是不相干的同名东西
-- （outbox poll、poll for completion、message kind="poll"）。于是真实发生的事：
--   1. 用户建了一个投票；
--   2. Go 的 JSON 解码静默忽略未知字段，服务端不存、不报错；
--   3. 帖子发出去了，正文里躺着一段看起来像投票的文本；
--   4. **没有任何人能投票，也没有任何票数** —— 它只是一个好看的字符串。
--
-- 跟 GHOST-24H-001（24h 动态承诺会消失却永久留存）是同一类缺陷：写出来像有，
-- 实际没有。投票更糟一点 —— 「投票」这个词本身就承诺了「能投」和「有结果」，
-- 一个不能投的投票连装饰都算不上，是把用户当傻子。
--
-- 设计口径：
--   - 投票是**帖子的附属物**（1:1），不是独立实体：post_polls 以 post_id 作主键
--     并级联删除。帖子没了，投票自然没了一一不需要额外的清理任务。
--   - 一人一票：post_poll_votes 的主键是 (post_id, voter_id)。用 UPSERT 实现
--     「改票」：再投同一个选项=幂等，投不同选项=改票，仍然只算一票。
--     这是 X/Threads 的手感，也省掉一个「投错了改不了」的投诉来源。
--   - 票数**永不落库成计数字段**，一律 COUNT(*) 现算。计数列是典型的会跟
--     votes 表慢慢对不上的东西（重投、删除、并发），而对不上的时候你没有任何
--     办法判断哪个是对的。宁可多一次聚合。
--   - 复合外键 (post_id, option_id) → post_poll_options：从数据库层面就杜绝
--     「拿 A 帖子的选项去投 B 帖子的票」，不靠应用层自觉。
--   - 过期**只关闭投票、不隐藏结果**：投票到期后仍然显示最终票数，只是不能再投。
--     用户需要看到结果，把结果一起藏掉等于把投票变成一场没有开奖的抽奖。
--   - multiSelect 目前**明确不支持**：共享契约里有这个字段但客户端从来不发。
--     服务端遇到 true 会显式拒绝（POLL_MULTISELECT_UNSUPPORTED），绝不静默
--     降级成单选 —— 静默降级正是 GHOST-24H-001 的病根。

CREATE TABLE IF NOT EXISTS localnet.post_polls (
    post_id    TEXT PRIMARY KEY REFERENCES localnet.posts (id) ON DELETE CASCADE,
    -- NULL = 不过期。客户端总是会带 expiresAt，留可空是为了不为一条缺省值
    -- 把整个建帖流程打挂。
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- option_id **不是**全局主键，选项的身份是 (post_id, option_id)。
--
-- 一开始把 option_id 单独设成了 PRIMARY KEY，实测立刻出事：两条帖子用了同一批
-- optionId（客户端生成的是 `opt_<ts>_<idx>`，重发/复用草稿就会撞），
-- ON CONFLICT (option_id) 只会改写 label/sort_order，**不会改 post_id** ——
-- 于是第二条帖子的选项整批消失，第一条帖子平白多一次「改标签」。
-- 选项只在一条帖子内部需要唯一，把帖子身份放进主键才是正确的粒度。
CREATE TABLE IF NOT EXISTS localnet.post_poll_options (
    post_id    TEXT NOT NULL REFERENCES localnet.post_polls (post_id) ON DELETE CASCADE,
    option_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 复合外键 (post_id, option_id) 的目标，见上面口径第 4 条。
    PRIMARY KEY (post_id, option_id)
);

-- feed 渲染要按 sort_order 顺序拿选项，顺带覆盖「按帖子取全部选项」。
CREATE INDEX IF NOT EXISTS post_poll_options_post_idx
    ON localnet.post_poll_options (post_id, sort_order);

CREATE TABLE IF NOT EXISTS localnet.post_poll_votes (
    post_id    TEXT NOT NULL,
    option_id  TEXT NOT NULL,
    voter_id   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 一人一票（改票走 UPSERT，见上面口径第 2 条）。
    PRIMARY KEY (post_id, voter_id),
    FOREIGN KEY (post_id, option_id)
        REFERENCES localnet.post_poll_options (post_id, option_id) ON DELETE CASCADE
);

-- 数票时按选项聚合。
CREATE INDEX IF NOT EXISTS post_poll_votes_option_idx
    ON localnet.post_poll_votes (option_id);

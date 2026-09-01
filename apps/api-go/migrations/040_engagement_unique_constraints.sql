-- R15.18 P0: 互动唯一性约束 (TikTok-style "一个用户对一帖只有一个当前状态").
-- 现状: 同一 actor 可以对同一 post 多次点 LIKE / REPOST / BOOKMARK,
-- COUNT(*) 重复计数, post_stats 投影准确性差。本迁移加 unique 约束,
-- 但不丢现有数据 (用 ON CONFLICT DO NOTHING 包住), 启动后会有
-- dedupe 脚本逻辑  (rebuild_post_stats + 一次清理重复行).
--
-- 适用情况: 一个用户对同一 post 只能:
--   1) 有一个 reaction (LIKE / LOVE / ... ; kind 自由)
--   2) 有一个 bookmark
--   3) 有一个 repost (转发必须可撤销 — 这是 toggle, 不是 toggle once)
--
-- Replies 不加 unique — 多 reply 是合法 (跟帖本身).

-- 1. reactions: (post_id, actor_id) 唯一
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_reactions_post_actor_uk') THEN
    -- 先 dedupe: 保留 created_at 最早的一行, 删其余。
	DELETE FROM engagement.reactions
	WHERE id IN (
	  SELECT id FROM (
		SELECT id, ROW_NUMBER() OVER (PARTITION BY post_id, actor_id ORDER BY created_at, id) AS row_number
		FROM engagement.reactions
	  ) duplicates WHERE row_number > 1
	);
    ALTER TABLE engagement.reactions
      ADD CONSTRAINT engagement_reactions_post_actor_uk UNIQUE (post_id, actor_id);
  END IF;
END $$;

-- 2. bookmarks: (post_id, actor_id) 唯一
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_bookmarks_post_actor_uk') THEN
	DELETE FROM engagement.bookmarks
	WHERE id IN (
	  SELECT id FROM (
		SELECT id, ROW_NUMBER() OVER (PARTITION BY post_id, actor_id ORDER BY created_at, id) AS row_number
		FROM engagement.bookmarks
	  ) duplicates WHERE row_number > 1
	);
    ALTER TABLE engagement.bookmarks
      ADD CONSTRAINT engagement_bookmarks_post_actor_uk UNIQUE (post_id, actor_id);
  END IF;
END $$;

-- 3. reposts: (post_id, actor_id) 唯一 (repost 一次就 toggle,
-- 重复 insert 应该被 unique 拒; service 层应该是 toggle 而不是 insert).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_reposts_post_actor_uk') THEN
	DELETE FROM engagement.reposts
	WHERE id IN (
	  SELECT id FROM (
		SELECT id, ROW_NUMBER() OVER (PARTITION BY post_id, actor_id ORDER BY created_at, id) AS row_number
		FROM engagement.reposts
	  ) duplicates WHERE row_number > 1
	);
    ALTER TABLE engagement.reposts
      ADD CONSTRAINT engagement_reposts_post_actor_uk UNIQUE (post_id, actor_id);
  END IF;
END $$;

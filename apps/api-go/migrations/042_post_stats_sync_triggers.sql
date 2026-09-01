-- R15.18 P1 follow-up B: post_stats 投影同步触发器。
-- reactions/bookmarks/reposts 三表的 INSERT/DELETE 同步
-- post_stats 该 post 的对应计数。
--
-- 之前 P0 写了 post_stats 表 + 投影 fallback, 但写路径不同步,
-- 所以 ListPostStats 总是走 fallback (3*N COUNT) 或者返 0. 本迁移
-- 装上触发器, 写路径就跟投影同步, ListPostStats 一次 SELECT 拿
-- 到真值。
--
-- 不用 UPSERT (post_stats 预创建), 直接 INSERT ... ON CONFLICT
-- DO UPDATE SET x = post_stats.x + 1, 避免 COUNT(*). 删时
-- x = GREATEST(x - 1, 0) 防负数。
--
-- replies 表不动, 触发器本轮不上, 原因是 reply 通常不会
-- COUNT 拿来作 sort 关键信号 (不像 reactions).

-- Helper: 调整 post_stats 一行某个计数。
CREATE OR REPLACE FUNCTION localnet.adjust_post_stat(p_post_id TEXT, p_field TEXT, p_delta INT) RETURNS void AS $$
DECLARE
  current_value BIGINT;
  new_value BIGINT;
BEGIN
  -- Ensure row exists (defensive — post_stats 应该是 pre-allocated).
  INSERT INTO localnet.post_stats (post_id) VALUES (p_post_id) ON CONFLICT DO NOTHING;
  IF p_delta > 0 THEN
    EXECUTE format('UPDATE localnet.post_stats SET %I = %I + $1, updated_at = NOW() WHERE post_id = $2 RETURNING %I', p_field, p_field, p_field)
      USING p_delta, p_post_id;
  ELSE
    -- DELETE 路径: 不让计数 < 0 (防御并发).
    EXECUTE format('SELECT %I FROM localnet.post_stats WHERE post_id = $1', p_field) INTO current_value USING p_post_id;
    new_value := GREATEST(current_value + p_delta, 0);
    EXECUTE format('UPDATE localnet.post_stats SET %I = $1, updated_at = NOW() WHERE post_id = $2', p_field)
      USING new_value, p_post_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- reactions: insert/delete 同步 reactions 计数.
CREATE OR REPLACE FUNCTION localnet.sync_reaction_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM localnet.adjust_post_stat(NEW.post_id, 'reactions', 1);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM localnet.adjust_post_stat(OLD.post_id, 'reactions', -1);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reactions_post_stats ON engagement.reactions;
CREATE TRIGGER trg_reactions_post_stats
  AFTER INSERT OR DELETE ON engagement.reactions
  FOR EACH ROW EXECUTE FUNCTION localnet.sync_reaction_count();

-- reposts.
CREATE OR REPLACE FUNCTION localnet.sync_repost_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM localnet.adjust_post_stat(NEW.post_id, 'reposts', 1);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM localnet.adjust_post_stat(OLD.post_id, 'reposts', -1);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reposts_post_stats ON engagement.reposts;
CREATE TRIGGER trg_reposts_post_stats
  AFTER INSERT OR DELETE ON engagement.reposts
  FOR EACH ROW EXECUTE FUNCTION localnet.sync_repost_count();

-- replies. Public reply counts follow reply facts independently.
CREATE OR REPLACE FUNCTION localnet.sync_reply_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM localnet.adjust_post_stat(NEW.post_id, 'replies', 1);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM localnet.adjust_post_stat(OLD.post_id, 'replies', -1);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_replies_post_stats ON engagement.replies;
CREATE TRIGGER trg_replies_post_stats
  AFTER INSERT OR DELETE ON engagement.replies
  FOR EACH ROW EXECUTE FUNCTION localnet.sync_reply_count();

-- Bookmark is private library state, not a public reaction. Never let a save
-- silently increase the visible like count.
DROP TRIGGER IF EXISTS trg_bookmarks_post_stats ON engagement.bookmarks;

-- Initialize existing rows before subsequent triggers apply deltas.
SELECT localnet.rebuild_post_stats();

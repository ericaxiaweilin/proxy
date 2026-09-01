-- R15.18 P0: post_stats 投影表，取代 Feed 读取时 3*N 次 COUNT(*)。
-- 互动（reactions / replies / reposts）写入路径上同步更新；Feed
-- 读取仅做单次 SELECT, O(1) 行, 避免 N+1。
--
-- 这不是事实表。事实仍在 engagement.reactions / engagement.replies
-- / engagement.reposts (R15.6 §16.4). 本表只是读侧聚合投影, 可以
-- 从 engagement 表重算: rebuild_post_stats() (见下).
CREATE TABLE IF NOT EXISTS localnet.post_stats (
  post_id    TEXT PRIMARY KEY REFERENCES localnet.posts(id) ON DELETE CASCADE,
  reactions  BIGINT NOT NULL DEFAULT 0,
  replies    BIGINT NOT NULL DEFAULT 0,
  reposts    BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_stats_updated_at_idx ON localnet.post_stats (updated_at);

-- rebuild_post_stats() 是从事实表重算的应急路径, 比如投影脱
-- 落后调一次. 平时不动, 触发器负责 (本迁移不装触发器, 写路径
-- 改造在 R15.18 P1 跟着, 本轮仓走 SELECT).
CREATE OR REPLACE FUNCTION localnet.rebuild_post_stats() RETURNS void AS $$
BEGIN
  INSERT INTO localnet.post_stats (post_id, reactions, replies, reposts, updated_at)
  SELECT p.id,
    COALESCE((SELECT COUNT(*) FROM engagement.reactions r WHERE r.post_id = p.id), 0),
    COALESCE((SELECT COUNT(*) FROM engagement.replies   rp WHERE rp.post_id = p.id), 0),
    COALESCE((SELECT COUNT(*) FROM engagement.reposts   rs WHERE rs.post_id = p.id), 0),
    NOW()
  FROM localnet.posts p
  ON CONFLICT (post_id) DO UPDATE SET
    reactions  = EXCLUDED.reactions,
    replies    = EXCLUDED.replies,
    reposts    = EXCLUDED.reposts,
    updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

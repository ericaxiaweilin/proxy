-- R15.18 P1: 行为事件 (Feed events) 扩展.
-- 现有 interaction_events 表只有 7 列, 不足以形成推荐闭环.
-- 本迁移加 TikTok 风格信号: feed_session_id, impression_id,
-- content_type, candidate_source, position, watch_ms,
-- duration_ms, completion_rate, client_time, city, app_version,
-- recommendation_request_id, event_source (server|client).
--
-- 事件保留 append-only. 读侧 (list/rebuild) 都按 (actor_id, created_at).
-- 访客 (anonymous) 的事件存为 actor_id = "anon_<hash>" + 真 IP
-- 哈希或设备 id 的辅助. 保留周期由 retention 任务控制, 本轮不接.
ALTER TABLE localnet.interaction_events
  ADD COLUMN IF NOT EXISTS feed_session_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS impression_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'POST',
  ADD COLUMN IF NOT EXISTS candidate_source TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS watch_ms INT,
  ADD COLUMN IF NOT EXISTS duration_ms INT,
  ADD COLUMN IF NOT EXISTS completion_rate REAL,
  ADD COLUMN IF NOT EXISTS client_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS app_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recommendation_request_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS event_source TEXT NOT NULL DEFAULT 'server';

-- R15.18 P1: feed_session_id 是这次冷启 session 的标识
-- (UUID-like, 客户端 1 个 app session 1 个). 用于去重
-- “同一个 session 内对同一 post 的多次 impression” + 算曝光率.
CREATE INDEX IF NOT EXISTS idx_interaction_feed_session
  ON localnet.interaction_events (feed_session_id, created_at DESC);

-- (post_id, position) 找 candidate 在 feed 哪一位, 重排
-- 用 (低位置 + 长 watch_ms) 当正向信号.
CREATE INDEX IF NOT EXISTS idx_interaction_target_position
  ON localnet.interaction_events (target_type, target_id, position);

-- (event_type, created_at) 找今天/post 维度的 PV/UV.
CREATE INDEX IF NOT EXISTS idx_interaction_type_time
  ON localnet.interaction_events (event_type, created_at DESC);

-- R16.1: engagement.post_pins 表 — R15.56 AddPostPin/RemovePostPin/ListPinnedPosts server 端 SQL
--   (apps/api-go/internal/platform/postgres/network.go) 一直引用但 migration 没建表.
--   客户端 R16.0 加 fallback [] 兜底, 但 server 仍 5xx 'command_transaction_failed'.
--   这条 migration 修 server schema gap, 跟 client fallback 不冲突.
--
-- 列跟 server.go 实际 INSERT/SELECT 字段一致:
--   pin_id, owner_id, post_id, created_at
-- UNIQUE (owner_id, post_id) — AddPostPin ON CONFLICT (owner_id, post_id) DO NOTHING

CREATE TABLE IF NOT EXISTS engagement.post_pins (
  pin_id     TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  post_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, post_id)
);

-- ListPinnedPosts ORDER BY created_at ASC, 加 index 加速
CREATE INDEX IF NOT EXISTS post_pins_owner_created_idx
  ON engagement.post_pins (owner_id, created_at ASC);

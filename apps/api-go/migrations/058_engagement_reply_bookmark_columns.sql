-- R16.3: engagement.replies / engagement.bookmarks 列对齐 server.go 引用.
--
-- R16.0 暴露 5xx 三个 list 端点:
--   - ListRepliesByActor: SELECT reply_id, post_id, actor_id, body, created_at
--     FROM engagement.replies (server.go 网络层实际 SQL)
--   - ListBookmarksByActor: SELECT bookmark_id, post_id, actor_id, created_at
--     FROM engagement.bookmarks
--
-- 但 PG schema:
--   - engagement.replies 列: id, post_id, actor_id, body, created_at
--   - engagement.bookmarks 列: id, post_id, actor_id, created_at
--
-- 列名 id 不等于 reply_id/bookmark_id — server.go SELECT 返 'column "reply_id" does not exist',
-- command transaction abort, 客户端 ListUserReplies/ListUserBookmarks 一直 500.
--
-- R16.3 修: 把 'id' rename 到 server.go 期望的 'reply_id' / 'bookmark_id'.

ALTER TABLE engagement.replies RENAME COLUMN id TO reply_id;
ALTER TABLE engagement.bookmarks RENAME COLUMN id TO bookmark_id;
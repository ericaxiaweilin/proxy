-- MUTED-AUTHORS-001: engagement.muted_authors 表缺失, MuteAuthor PG 写路径全灭.
--
-- MuteAuthor (R15.45) 是完整功能链: service 命令处理 + Repository 接口
-- (AddMutedAuthor/IsMuted) + EngagementRepository PG 实现 (network.go) +
-- main.go 已接线生产 (NewEngagementRepository). 但全仓任何迁移都没有建过
-- engagement.muted_authors 表 — PG 模式下每次 mute 都报
-- 'relation "engagement.muted_authors" does not exist' (42P01),
-- service 层吞成 MUTE_AUTHOR_FAILED reject; IsMuted 读路径同样 42P01,
-- feed 过滤链永远返回错误. 8 个内存 service 测试全绿掩盖了这一点
-- (与 dialog/voucher 42601、friendship 42P10 同 class 的 PG-only 炸).
--
-- 领域契约 (internal/engagement/service.go MutedAuthor):
--   - 复合幂等键 (ActorID, AuthorID) — 重复 mute 同一作者必须幂等,
--     AddMutedAuthor 用 ON CONFLICT (actor_id, author_id) DO NOTHING
--     + RETURNING 检测是否新插入.
--   - service 层只在 alreadyExisted=false 时发 AuthorMuted 事件.
-- 故 UNIQUE (actor_id, author_id) 既是业务幂等键也是 upsert arbiter —
-- 表内建, 无需单独索引.

CREATE TABLE IF NOT EXISTS engagement.muted_authors (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    UNIQUE (actor_id, author_id),
    CHECK (length(actor_id) > 0),
    CHECK (length(author_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_engagement_muted_authors_actor
    ON engagement.muted_authors (actor_id, created_at DESC);

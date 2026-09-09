# PR Summary: engagement.muted_authors 建表 + feed 屏蔽过滤 (branch hermes/muted-authors-feed-pg)

- **Branch**: `hermes/muted-authors-feed-pg`（4 commits），基于集成 HEAD `03a337a`（2026-09-09）
- **Author**: hermes（isolated worktree /tmp/kake-muted-feed，集成区未动）
- **Regression IDs**: MUTED-AUTHORS-001（表缺失）+ MUTED-AUTHORS-002（feed 不过滤）
- **Supersedes**: `hermes/muted-authors-pg`（077/078 交付版；本分支原样包含其全部内容并扩展 feed 读路径）

## TL;DR

两个同根 bug，一个功能的两半：

**MUTED-AUTHORS-001（写路径全灭）**：`engagement.muted_authors` 表从未被任何迁移建过，但 MuteAuthor 是完整功能链（service 命令 + Repository 接口 + network.go SQL + main.go 生产接线 + mobile UI）。PG 模式每次 mute 42P01 `relation does not exist`，service 吞成 MUTE_AUTHOR_FAILED。Migration 078 建表修复（UNIQUE (actor_id, author_id) 既是幂等键也是 ON CONFLICT arbiter）。

**MUTED-AUTHORS-002（读路径为零——mute 是装饰品）**：修复 001 后追查读侧，发现 `IsMuted` **全仓零调用方**。mobile feed.tsx `handleMuteAuthor` 长按屏蔽只有本地内存过滤（注释写着"跟 server mute 同步"），server 的 `ListFeedPage` SQL 无任何 muted 过滤——屏蔽的作者下一页/换设备/重登全部重新出现。修复：`ListFeedPage` SQL 加 `NOT EXISTS (… engagement.muted_authors … actor_id=$1 AND author_id=posts.author_id)`，放 SQL 内保证分页 LIMIT 计数正确（循环后过滤会缺页——feed 契约钉死游标页稳定完整）。

## What's in the box

| 文件 | 内容 |
|---|---|
| `migrations/078_muted_authors.sql` | 建表：UNIQUE pair 内联（幂等键+arbiter 二合一）+ CHECK 非空 id + actor 索引 |
| `internal/platform/postgres/network.go` | ListFeedPage 加 NOT EXISTS muted 过滤（MUTED-AUTHORS-002 本体） |
| `internal/platform/postgres/muted_authors_integration_test.go` | 001 lifecycle：插入 → 幂等重 mute 返回原记录 → IsMuted 正负例 |
| `internal/platform/postgres/muted_feed_filter_integration_test.go` | 002 lifecycle：mute 后该作者帖对 viewer 消失 / 控制帖保留 / 另一 viewer 仍见全部（per-viewer 非全局）/ 作者本人仍见自己帖 |
| `scripts/check-regression-contracts.sh` | 001+002 双条目（test 在位 + 迁移/SQL grep pin） |
| `docs/development/pr-reviews/muted-authors-pr-summary.md` | 本文档 |

## 验证

1. **RED→GREEN 双向（两 bug 分别）**：001——移除 078 后必挂 `42P01 relation does not exist`；002——加过滤前测试精确红在 `muted author's post still in feed`，加后绿。
2. **GREEN**: `go vet` / `go build` / `go test ./...` 42 包 0 FAIL；feed 过滤与 TestLocalNetPostgresLifecycle / TestEngagementPostgresRoundTrip 共跑无互扰。
3. **契约**: `check-regression-contracts.sh` 全绿，`MUTED-AUTHORS-001: PASS` + `MUTED-AUTHORS-002: PASS`。
4. **共享库**: 078 已手动 psql -f 应用（幂等 IF NOT EXISTS）；uq/arbiter 走表内 UNIQUE。

## 审计溯源（同 class 收网方法）

postgres 层引用的全部 115 个 `schema.table` 与共享库 pg_tables 对齐，缺 5 归因：muted_authors（本 PR 修复）；experience.experiences（commander 有意 Phase 1 fallback，repo 注释明说表缺退内存 mock）；fulfillment.order_events/evidence（仅 test best-effort cleanup）；supply.agents（测试笔误真身 agent_profiles）。追 mute 读侧时发现 IsMuted 零调用方 → 002。

## Review checklist

- [ ] 迁移编号 078 无冲突（基线最新 076；姊妹补丁 relationship-pg-v2 占 077，一起落地时按 077→078）
- [ ] ListFeedPage 的 NOT EXISTS 用 `actor_id=$1`（viewer）不是 author——语义是"我屏蔽的作者"，per-viewer
- [ ] muted 过滤在 SQL 内不在 Go 循环内（分页计数正确性）
- [ ] cleanup 只删本测试创建的行（TEST-HYGIENE-001）

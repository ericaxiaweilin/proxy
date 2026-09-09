# PR Summary: engagement.muted_authors 建表 (branch hermes/muted-authors-pg)

- **Branch**: `hermes/muted-authors-pg` (1 commit: `e2e90c9`), based on integration HEAD `5de19cf` (2026-09-09)
- **Author**: hermes (isolated worktree /tmp/kake-muted-authors, integration area untouched)
- **Regression ID**: MUTED-AUTHORS-001

## TL;DR

`engagement.muted_authors` 表**从未被任何迁移建过**，但 MuteAuthor 是一条完整功能链：service 命令处理（muteAuthor，R15.45）+ Repository 接口声明（AddMutedAuthor/IsMuted）+ EngagementRepository SQL 实现（network.go:838-866）+ **main.go 已接线生产**（postgres.NewEngagementRepository）。PG 模式下每次 mute 报 42P01 `relation does not exist`，service 层吞成 MUTE_AUTHOR_FAILED；IsMuted（feed 过滤用）读路径同样 42P01。内存 service 测试全绿掩盖——与 dialog/voucher 42601、friendship 42P10 同 class 的 PG-only 炸。

**发现方式（audit-only 收网扫描）**：把 postgres 层引用的全部 115 个 `schema.table` 与共享库 pg_tables 对齐，缺失 5 个，归因如下——只有 muted_authors 是生产缺口：

| 缺失表 | 归因 |
|---|---|
| `engagement.muted_authors` | **P0 生产缺口，本 PR 修复**（写+读路径全死，已接线） |
| `experience.experiences` | commander 有意的 Phase 1 fallback 设计（network.go 注释明说表不存在退内存 mock，repo 未接线该读法以外的路径）——latent risk 记录，不抢修 |
| `fulfillment.order_events` / `fulfillment.evidence` | 仅 test cleanup 引用（best-effort DELETE，注释声明 schema 不总是有这表） |
| `supply.agents` | 测试笔误：真身是 `supply.agent_profiles`（004_supply.sql）。cleanup DELETE 永远打不中、被 t.Logf 吞掉——死代码，修复属于测试卫生，未升格独立 bug |

## What's in the box

- `migrations/078_muted_authors.sql` — 建表。UNIQUE (actor_id, author_id) 内联：既是领域幂等键（重复 mute 幂等）也是 AddMutedAuthor `ON CONFLICT DO NOTHING` 的 arbiter。CHECK 非空 id。幂等（IF NOT EXISTS）。
- `internal/platform/postgres/muted_authors_integration_test.go` — TestMutedAuthorsPostgresLifecycle：首次插入 → **同 pair 重复 mute 返回原记录 + alreadyExisted=true**（钉死幂等键与 arbiter）→ IsMuted 正/负例。TEST-HYGIENE-001 cleanup（精确 pair delete）。
- `scripts/check-regression-contracts.sh` — MUTED-AUTHORS-001 入册（test 在位 + 迁移 grep pin 双保险）。

## 验证

1. **GREEN**: temp cluster（全量迁移含 078）专项 PASS；`go vet` / `go build` / `go test ./...` 42 包 0 FAIL。
2. **共享库双模式**: 手动 `psql -f 078` 应用（幂等）→ `DATABASE_URL` 共享库模式专项 PASS。temp cluster 与共享库都绿。
3. **RED（mutation proof）**: 移除 078 后测试必挂 `42P01 relation "engagement.muted_authors" does not exist`，恢复即绿——测试确实能抓住这个 bug，非摆设。
4. 修复 commit 后才注入 mutation（顺序纪律），还原后工作区干净。

## Latent risks

- `experience.experiences` fallback 是 commander 刻意设计，但意味着体验列表在 PG 模式下永远走 24 条内存 mock——Phase 2 建表时建议补 lifecycle 测试（先例：本 PR + relationship）。
- `supply.agents` 测试笔误意味着 TestSupplyPostgresVerificationLifecycle 的 cleanup 对 agents 行实际没删 `supply.agents`（打不中），真实清理依赖 capability_verifications DELETE 的 FK 级联与否——建议 commander 顺手把 `DELETE FROM supply.agents` 改为 `supply.agent_profiles`（一行改动，我没有越权改不属于本 PR 的测试文件）。
- arbiter 审计工具的 26 个 SUSPECT 中 24 个是 PRIMARY KEY 隐式 arbiter 误报（工具只认显式 `CREATE UNIQUE INDEX`），实测 pkey 兜底。真正的缺口只有 muted_authors（本 PR）与 friendships（姊妹分支 hermes/relationship-pg-v2）。工具可后续升级为连 pg_index 一起读，本轮未动（gate 脚本属 commander 基础设施）。

## Review checklist

- [ ] 迁移 078 编号无冲突（基线最新 076，077 被 hermes/relationship-pg-v2 占用，两个补丁一起落地时顺序 077→078）
- [ ] UNIQUE (actor_id, author_id) 与 domain 幂等键一致（service.go MutedAuthor 注释）
- [ ] cleanup 只删本测试创建的行（TEST-HYGIENE-001）

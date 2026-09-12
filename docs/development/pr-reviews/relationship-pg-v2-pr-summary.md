# relationship PG lifecycle v2（077 改号重交付）— PR summary（FRIEND-UPSERT-001）

- **Branch**: `hermes/relationship-pg-v2`（2 commits：`9590e80` cherry-pick 自 `hermes/relationship-pg-lifecycle` + `9bd2761` 改号 chore），基于集成 HEAD `842199d`（2026-09-09 17:08）
- **Author**: hermes（isolated worktree /tmp/kake-rel-v2，集成区未动）
- **Supersedes**: `hermes/relationship-pg-lifecycle`（c7eb08e，09-07 交付后未被吸收；v2 原样继承其修复与测试，仅迁移改号）
- **Regression ID**: FRIEND-UPSERT-001

## TL;DR（v2 相对 v1 只有一处变化：迁移改号）

收网扫描发现 relationship 是唯一已接线生产但 PG 层零测试的域；lifecycle 测试当场抓住真 bug——migration 040 的 `relationship.friendships` 缺 (user_a, user_b) UNIQUE 约束，而 `UpsertFriendship` 用 `ON CONFLICT (user_a, user_b) DO UPDATE`——PG 模式下**每次好友写操作都 42P10 挂**，8 个内存 service 测试全绿掩盖。

v1 补丁（09-07 交付）未被吸收，且**集成基线 076 编号已被 commander 的 `076_ai_persona_runtime.sql` 占用**（已应用于共享库）。v2 把迁移改号为 `077_relationship_pair_unique.sql`，内容零变化；`check-regression-contracts.sh` 的 grep pin 同步改 077。

## What's in the box

| 文件 | 内容 |
|---|---|
| `migrations/077_relationship_pair_unique.sql` | `CREATE UNIQUE INDEX IF NOT EXISTS uq_friendships_user_pair ON relationship.friendships (user_a, user_b)`（pair 已被 CHECK user_a < user_b 规范化，普通复合唯一索引即正确 arbiter）。幂等 |
| `internal/platform/postgres/relationship_integration_test.go` | TestRelationshipPostgresLifecycle：canonical PENDING 插入 → 同 pair upsert 原地更新（created/updated 必须保持可区分——dialog `$11,$11` 同型 tripwire）→ 双侧 List → 非规范 pair fail-closed → not-found 映射。TEST-HYGIENE-001 cleanup |
| `scripts/check-regression-contracts.sh` | FRIEND-UPSERT-001 条目（test 在位 + 迁移 grep pin 077） |

## 验证（v2 worktree 全部重跑）

1. **GREEN**: `go vet` / `go build` / `go test ./...` 42 包 0 FAIL；relationship + postgres 专项 PASS。
2. **RED（mutation proof，v2 重证）**: 移除 077 后 TestRelationshipPostgresLifecycle 必挂 `SQLSTATE 42P10`，恢复即绿。
3. **共享库**: uq_friendships_user_pair 已在位（09-07 手动应用过，psql `\d` 实证），DATABASE_URL 模式测试绿。fresh DB 路径由 RED 证明覆盖。

## Latent risks

- 基线 040 之后若 commander 重构 migrations 目录（重排编号），077 的 grep pin 需要跟着改——pin 的是文件名不是内容，属已知脆弱点。
- 姊妹分支 `hermes/muted-authors-pg`（MUTED-AUTHORS-001）占 078。两个补丁一起落地时按 077→078 顺序，无冲突（不同文件）。
- commander 若已在基线自行修复 42P10（等效内容不同编号），按吸收判定四层阶梯核对后弃用本补丁。

## Review checklist

- [ ] 迁移编号 077 无冲突（基线最新 076）
- [ ] UNIQUE pair 与 CHECK user_a < user_b 规范化假设一致
- [ ] lifecycle 测试断言含 created≠updated 可区分（防 `$11,$11` 型错值不报错）

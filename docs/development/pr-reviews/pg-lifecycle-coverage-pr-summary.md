# PR Summary: PG adapter lifecycle tripwires (branch hermes/pg-lifecycle-coverage)

- **Branch**: `hermes/pg-lifecycle-coverage` (1 commit: `c2234e0`), based on `feat/facet` @ `dc0faa9`
- **Author**: hermes (isolated worktree, integration area untouched)
- **Supersedes**: none. Companion to `hermes/voucher-pg-test` (voucher/dialog lifecycle tests + real bug fixes) — this branch covers the remaining six adapters.

## TL;DR

6 个 PG adapter 此前零集成测试（activity / facet / experience / marketplace / media_review_decisions / display_identity）。本分支为全部 6 个补上 lifecycle tripwire 测试（3 个新测试文件，719 行），每个测试都经过 RED→GREEN 双向验证（注入 mutation 必挂、还原必过）。全量套件 29 包 0 FAIL。

**没有发现新的真 bug** —— 与 voucher/dialog 扫描不同，这 6 个 adapter 的 SQL 接线经实测全部正确。测试的价值在于把它们钉死，防止未来重构成 silent wire break（正是 voucher 占位符 bug 的教训）。

## What's in the box

3 个新测试文件（均为纯测试，零生产代码改动）：

| 文件 | 覆盖 |
|---|---|
| `activity_facet_integration_test.go` | activity: Seed/List 往返 + ToggleInterest 开关语义 + GREATEST(0,…) clamp + Join 规则（重复→ErrAlreadyJoined、满员→ErrActivityFull、not found 映射）+ 重启持久性。facet: Seed upsert（第二次覆盖显示字段）+ Gap 结构体往返 + 重启持久性 |
| `marketplace_media_integration_test.go` | marketplace: Seed 幂等 + viewer 作用域（Owned/Applied 标志）+ Apply 幂等（冲突返回原申请不加 responses）+ Dismiss 仅对本人隐藏 + not found 映射 + 重启持久性。media_review_decisions: append-only 日志 + ReviewedAt COALESCE(now()) 服务端时钟 + 重复 decision_id 拒绝 + DESC 排序 + asset 过滤 + FK（先建真实 media asset）+ 重启持久性 |
| `experience_identity_integration_test.go` | experience: CreateIntent 12 列 JSONB wire format 往返 + 重复 intent_id no-op + CreateSurfacePlan FK→intent + (surface_id, surface_version) UNIQUE。display_identity: Create/Get 往返 + case-insensitive alias 查找 + owner 隔离 + 乐观并发（stale version→ErrDisplayIdentityConflict、正确 version→version+1）+ BURNER 过期清扫 SweepExpiredBurners + 重启持久性 |

## 验证

1. **GREEN**: 6 个测试单独跑全 PASS；全量 `go test ./...` 29 包 0 FAIL。
2. **RED（mutation proof）**: 对 6 个 adapter 各注入一个代表性 mutation——
   - activity: SELECT 列序对调（interested/joined 错位）
   - facet: ON CONFLICT DO UPDATE → DO NOTHING（upsert 变 no-op）
   - marketplace: owned 标志 `(o.owner_id = $1)` → `false`
   - media_review_decisions: `COALESCE($8, now())` → `$8`（服务端时钟丢失）
   - display_identity: `expectedVersion+1` → `expectedVersion`（version 不再推进）
   - experience: allowed/forbidden 参数对调

   6/6 测试全部 FAIL（0.83s 内全部抓到），还原后全部恢复 PASS。**这是真 tripwire，不是摆设。**
3. `go build ./...` OK。

## Latent risks / 备注

- `go vet ./...` 在本分支报 `metrics.go` copylocks —— 这是基线自带的老问题，已在 `hermes/voucher-pg-test` 分支修复（MetricsSnapshot），本分支刻意不重复修（避免两分支改同一文件造成 commander 合并冲突）。吸收两个分支后 vet 全干净。
- 测试踩过的 schema 事实（未来改 migration 时留意）：facet.objects.relation 是 6 值英文枚举 CHECK；media_review_decisions 的 from_status(6)/to_status(4)/reason(4) 均有 CHECK；decisions 表按月分区（p2026_09）且 FK 挂真实 media asset；experience.surface_plan 有 (surface_id, surface_version) UNIQUE；display_identities 有 (owner_id, lower(alias)) 唯一索引，alias 大小写不敏感。
- 测试数据全部带纳秒时间戳前缀（`*_pg_<run>`），可重跑不互踩。

## 复核清单（commander）

```bash
git fetch . hermes/pg-lifecycle-coverage
git checkout hermes/pg-lifecycle-coverage -- apps/api-go/internal/platform/postgres/ && go test ./apps/api-go/internal/platform/postgres/ -count=1
# 或直接 git am /tmp/pg-lifecycle-coverage.patch
```

与 `hermes/voucher-pg-test` 无文件重叠（那个分支动 voucher.go/dialog.go/metrics.go + 自己的测试文件；本分支只加 3 个新测试文件），两个分支可独立或先后吸收，均无冲突。

# 骨架与技术栈审查 — 2026-09-20

> 对照物：用户 2026-09-20 给出的「三层合规分离 + 支付通道 + 后端架构」清单
> （语言 Go / 数据库 MySQL + Redis / 聊天 WebSocket / 对象存储 AWS S3 或阿里云 OSS /
> 推送 FCM + APNs）。
> 范围：`~/work/kake` 整库（apps/mobile + apps/api-go + apps/market-intelligence-console +
> packages/contracts），基线 `c644f3b`。
> 方法：全部结论来自读代码/配置，不来自 PRD 或口头描述；每条都给了可复核的路径或行号。

## 0. 结论摘要

骨架是健康的，**要改的是清单，不是仓库** —— 除了资金模型。

| 清单项 | 仓库实际 | 判定 |
|---|---|---|
| 语言：Go | Go 1.26.0 | 匹配 |
| 数据库：MySQL + Redis | PostgreSQL 16 + PostGIS 3.4；Redis 零依赖 | 不一致 |
| 聊天：WebSocket | HTTP 命令 API（有意为之） | 不一致 |
| 对象存储：S3 / OSS | 本地磁盘；MinIO 起了但未接 | 不一致 |
| 推送：FCM + APNs | 只有 device token 表，无发送器 | 半接 |
| 支付通道：VNPAY / MoMo / ZaloPay / IAP | 只有一个 VietQR 沙盒桩，App 内未接 | 半接 |

**唯一需要动代码的是资金模型**：仓库已实现托管（escrow），与清单第一层「平台不碰钱」
互斥，必须二选一。详见 §3。

## 1. 骨架（实测）

pnpm monorepo，4 个 workspace（`pnpm-workspace.yaml`: `apps/*` + `packages/*`）：

| workspace | 技术 | 规模 |
|---|---|---|
| `apps/api-go` | Go 1.26.0，模块 `github.com/proxy-app/proxy-api` | 227 个非测试 .go / 188 个测试 .go / 61,687 行非测试代码 |
| `apps/mobile` | Expo `~57.0.12`、RN `0.86.2`、React `19.2.3` | `src/` 下 382 个 ts/tsx；**有 `ios/` + `android/`，是 prebuild，不是 Expo Go** |
| `apps/market-intelligence-console` | React `^19.0.0` + Vite `^6.0.0` | 内部后台，与 App/API 物理隔离 |
| `packages/contracts` | zod `^3.25.76`、TS `^5.8.3`、vitest `^3.2.4` | 共享契约；**以 `dist` 形式被消费**（改 src 必须先 build） |

`apps/api-go/internal/` 下 **49 个域模块**：activity, aiboundary, aipersona, api, benefit,
bootenv, business, citycompanion, clock, command, compliance, contribution, conversation,
demand, engagement, event, experience, facet, fulfillment, geo, identity, invite,
jurisdiction, localcontext, localnet, location, marketplace, media, mockidentity, modelstack,
moderation, notification, openapicmds, outbox, outcome, payment, platform, policy,
policydecisions, profile, reality, realityscene, relationship, safety, scene, socialspace,
storeonboarding, supply, voucher。

**Go 直接依赖只有 3 个**（`apps/api-go/go.mod`）：`h2non/bimg`（libvips 图像处理）、
`jackc/pgx/v5`、`golang.org/x/image`。没有 ORM、没有 Redis 客户端、没有 WebSocket 库、
没有推送 SDK、没有对象存储 SDK —— 这一点很重要，它直接决定了 §2 的判定。

工程门禁是认真的：`.githooks/pre-commit` 跑 g1(build) + g2(tests) + g4(drift + 语义钉)；
`scripts/check-regression-contracts.sh` 里 **387 条回归钉**；`apps/api-go/migrations/` **121 个**迁移；
`apps/api-go/openapi.yaml` 337 行。

## 2. 技术栈：逐项对照

### 2.1 语言：Go —— 匹配

`go.mod` 声明 `go 1.26.0`。无需改动。

### 2.2 数据库：清单写 MySQL，仓库是 PostgreSQL 16 + PostGIS

`infrastructure/local/docker-compose.yml`：

```yaml
postgres:
  image: postgis/postgis:16-3.4
```

`go.mod` 里唯一的 DB 驱动是 `jackc/pgx/v5 v5.10.0`。

**判断：改清单，不要改仓库。** PostGIS 是承重的 —— `internal/geo`、`internal/localcontext`、
地图平价（`Proxy_PRD_v1.3_R15_12_7_Market_Map_Parity_Freeze`）、`market-pin-parity.test.ts`
都依赖地理类型与空间查询。换成 MySQL 等于重做地理层，收益为负。

### 2.3 Redis：起了容器，但代码里零依赖

`go.mod` 与 `go.sum` 里**完全没有 redis**。全库 grep 只命中两处，都在健康检查里：

```go
// apps/api-go/internal/api/server.go:301
checks := map[string]string{"database": "not_configured_local_mode", "redis": "not_configured_local_mode"}
// apps/api-go/internal/api/server.go:304
checks["redis"] = "not_configured_optional"
```

（另有一处是误命中：`insertStoreDispositionSQL` 里的 `...reDis...` 子串。）

**判断**：这是「通道建好了没有调用方」的典型形态 —— compose 里起了 `redis:7-alpine`，
没有任何代码用它。要么接上（做限流/会话/缓存），要么从 compose 里删掉。留着会让人以为
「我们用了 Redis」。

### 2.4 聊天：清单写 WebSocket，仓库**有意**用 HTTP 命令 API

`apps/mobile/src/surfaces/conversation.tsx:505` 的注释原话：

> delivery without pretending the current HTTP command API is a WebSocket.

**判断：这是刻意的架构决定，不是缺失。** 建议在清单里写明「HTTP 命令 API（有意不用 WS）」，
否则下一轮还会有人按清单去找一个不存在的 WebSocket。若将来真要上 WS，
`internal/conversation` 与 `internal/outbox` 是接入点（outbox 已经具备事件投递语义）。

### 2.5 对象存储：清单写 S3 / 阿里云 OSS，仓库落本地磁盘

`apps/api-go/internal/media/image_variants_bimg.go:199` 直接写盘：

```go
if writeErr := os.WriteFile(outputPath, buf, 0644); writeErr != nil {
```

Go 代码里**没有任何 S3 / MinIO / OSS 客户端**。compose 里起了 `minio/minio:latest`，
但无人调用。

**判断**：本地磁盘在单机 MVP 阶段够用，但**不可水平扩展**（多副本会各写各的盘），
且没有 CDN 语义。建议：先把 MinIO 接上（S3 协议，与 AWS S3 同构，切换成本低），
再谈线上用 S3 还是 OSS。注意 **OSS 不是 S3 协议**，真要用阿里云需要单独的适配层。

### 2.6 推送：只有 token 表，没有发送器

有 device token 注册（`identity_integration_test.go` 里 `"token": "apns_token_v1"`、
platform `IOS`），`internal/notification/` 有 `orchestrator.go` + `service.go`。
但 `go.mod` 里**没有** firebase-admin / apns2 之类的 SDK。

**判断**：属于「半接」—— 服务端能记「往哪台设备推」，但没有「谁来推」。
上架前必须补一个发送器（FCM + APNs），否则通知中心是个空壳。

### 2.7 支付通道：App 内完全没接

`apps/mobile/src` 里搜不到 `vnpay` / `momo` / `zalopay` / `vietqr` / `alipay`。
后端只有一个沙盒桩，`apps/api-go/internal/payment/vietqr.go` 自陈：

> VietQRProvider — 越南银行 App 扫码统一方案（NAPAS VietQR）
> MVP 沙盒：生成 VietQR 字符串（模拟），回调由 ConfirmPaymentIntent 驱动，不自建资金通道

IAP 零实现（grep 只命中 `dist/` 与 `ios/Pods/` 构建产物）。好消息是 `apps/mobile`
有 `ios/` + `android/` 原生目录，所以 IAP 在工程上是可做的。

## 3. ⚠️ 最重的一条：资金模型与「第一层：平台不碰钱」互斥

`apps/api-go/migrations/018_payment_ledger.sql`：

```sql
-- ledger_entries
CHECK (entry_type IN ('DEBIT_REQUESTER','CREDIT_HOLD','DEBIT_HOLD','CREDIT_AGENT','CREDIT_REFUND','DEBIT_REFUND'))
-- payout_holds
CHECK (status IN ('HELD','RELEASED','FAILED'))
```

`apps/api-go/internal/payment/service.go` 暴露的命令：
`CreatePaymentIntent` / `ConfirmPaymentIntent` / `RefundPaymentIntent` /
`CreatePayoutHold` / `ReleasePayout`，数据结构含 `PaymentIntent`、`LedgerEntry`、`PayoutHold`。

这是**教科书式托管（escrow）**：需求方被扣款 → 钱进平台 HOLD → 履约完成后释放给服务方。
平台在**支付与履约之间持有用户资金**。PRD 第 10 章标题即
`Payment_Escrow_Settlement_Cancellation_Refund` —— 托管是**已提交的设计**。

而清单第一层写的是：

> 见面 · 双方 · 现金直接给 ✅ ／ 平台 · 只撮合 · 不碰钱 ✅
> 平台不参与资金流转，不构成支付中介服务。

**两者不能同时成立。** `CREDIT_HOLD` 一旦真的走资金通道，平台就是支付中介。
这不是「实现程度」问题，是**设计冲突**，必须二选一：

- **A. 走托管**：承认平台持有资金 → 需要支付牌照或与持牌机构合作（越南需 NAPAS 体系内
  的持牌方），并补齐资金存管、对账、拒付流程。第二、三层可继续按托管记账写。
- **B. 真·不碰钱**：`payment` 模块退回纯记账/凭证（只记「谁答应给谁多少钱」，
  不持有、不划转），线下现金结算。这会**改动已提交的 018 迁移语义**，
  且第二层「咖啡券 B2B 采购」也会受影响（平台采购就要出钱）。

**这一条决定第二、三层怎么写，建议最先拍板。**

## 4. 已经有的合规资产（别丢）

- `apps/api-go/internal/compliance/killswitch.go` —— **真实可用**的远端法务 kill switch：
  - `GET  /v1/legal/status`（公开，App 启动时读）
  - `POST /v1/operator/legal/kill-switch`（运营）
  - `DELETE /v1/operator/legal/kill-switch/{category}`
  - category 含 `AI_MEDIA` / `MARKETPLACE` / `GLOBAL`；KILLED 时对应命令被拒，
    GLOBAL 返回 503 `service_disabled`。
  - 依据：越南 356/2025/ND-CP Art.12 + PRD v1.4 LC-16。
  这正是清单「随时能关掉某一层」的现成抓手 —— 建议直接复用，不要另起一套。
- `docs/compliance/R16.7-LEGAL-COMPLIANCE-PLAN.md` —— 已按 P0/P1/P2 列出越南法缺口，
  引用 Law on E-commerce 122/2025/QH15、Decree 248/2026/ND-CP、
  Personal Data Protection 91/2025/QH15、AI Law 134/2025/QH15。
  清单里的「代扣 7% 税（5% VAT + 2% PIT）」属于这一层的延伸，可挂进该 plan 的 P1。
- `internal/jurisdiction/` 与 `internal/policy/` 已是多市场/策略的落点，
  三层分离可以按 jurisdiction 维度配置，而不是散在业务代码里。

## 5. 结构问题：两套 migrations

| 目录 | 数量 | 状态 |
|---|---|---|
| `apps/api-go/migrations/` | 121 | **生效**。`cmd/migrate/main.go:11` 默认值；`cmd/api/main.go:154` 读 `PROXY_MIGRATIONS_DIR` |
| `infrastructure/migrations/` | 7（`0001_foundation` … `0007_login_challenges`） | 疑似废弃，无调用方 |

建议确认后**删掉废弃的那套**，否则迟早有人往错的那套里加迁移（而且它会静默不生效）。

## 6. 仓库级风险：`design-system-r3.test.ts` 是负载敏感的假红源

```
FAIL src/design-system-r3.test.ts > Proxy Design System R3 typography
  > keeps readable UI text at 11pt or larger (R2 decoration whitelist excluded)
Error: Test timed out in 5000ms.
```

该用例遍历 `components/` + `surfaces/` 全部源码。**单跑 8 项全过、该用例约 1.0s**；
机器 load 9~10 时（例如同时开着两个 expo dev server + RN debugger），全量跑里会超过 5s。
2026-09-20 提交 `c644f3b` 时被它挡下两次，`collect` 阶段分别耗时 78s / 136s。

**它报的是超时而非断言失败 —— 超时 ≠ 违规。** 建议改成读预生成的清单文件，
或把该用例的超时单独放宽；否则每次提交都要赌一次。**尚未改动，待拍板。**

## 7. 待决事项

| # | 事项 | 性质 |
|---|---|---|
| 1 | 资金模型：托管（现设计）还是真·不碰钱 | **设计冲突，最先定**；决定第二、三层 |
| 2 | 技术栈清单是否对齐仓库（MySQL→PostgreSQL、Redis 接或删、WS 写明「有意」、对象存储先接 MinIO） | 文档与配置 |
| 3 | 两套 migrations 删哪套 | 清理 |
| 4 | `design-system-r3.test.ts` 超时 | 仓库级提交阻断风险 |

## 附：复核命令

```bash
# 骨架
ls apps packages && ls apps/api-go/internal | wc -l
# Go 直接依赖（只有 3 个）
sed -n '1,12p' apps/api-go/go.mod
# Postgres + PostGIS / redis / minio
cat infrastructure/local/docker-compose.yml
# Redis 在代码里的唯一痕迹
grep -n -i redis apps/api-go/internal/api/server.go
# 托管证据
grep -n 'entry_type\|CHECK' apps/api-go/migrations/018_payment_ledger.sql
# 本地磁盘存储
grep -n 'os.WriteFile' apps/api-go/internal/media/image_variants_bimg.go
# VietQR 沙盒桩
head -12 apps/api-go/internal/payment/vietqr.go
# 聊天有意不用 WS
grep -n -i websocket apps/mobile/src/surfaces/conversation.tsx
```

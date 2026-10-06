# 门店归因审计：为什么订单/预约永远挂不到店（2026-10-06）

**结论一句话**：`fulfillment.orders.store_id` 这一列建了、也被读，但**全仓没有任何一条创建订单的代码路径会写入非空值**；而 For You/活动预约根本**不落 `fulfillment.orders`**，它走的是另一条 `activity.participants → business.spend_daily` 的投影桥。所以控制台的「挂店订单」必然是 0，而「全部订单」不为 0。

本文件只做调研与提案，未改任何代码。每条结论都带 `path:line`；拿不准的写「unverified」。

---

## 1. 所有创建订单 / 预约的代码路径

### 1.1 `fulfillment.orders`（履约订单）—— 3 个 INSERT、4 个服务入口

| # | 命令 | 服务函数 | 仓储方法 | INSERT SQL | 写 `store_id`？ | 写入值 |
|---|---|---|---|---|---|---|
| A1 | `CreateOffer` | `createOffer` `internal/fulfillment/service.go:1005`，落库调用 `:1085` | `CreateOrderAndPublish` `internal/fulfillment/service.go:122` → `insertOrder` `internal/platform/postgres/fulfillment.go:104` | `internal/platform/postgres/fulfillment.go:111-118` | **是**（列在 `:114`，实参 `:117`） | `order.StoreID`，而 `createOffer` 构造的 `Order`（`internal/fulfillment/service.go:1063-1074`）从不设 `StoreID` ⇒ `''` |
| A2 | `AcceptSlotOffer`（`RespondTopicInvite` 同一落库路径） | `acceptSlotOffer` `internal/fulfillment/service.go:1186` → `acceptOfferAsOrder` `:1218`，落库调用 `:1262` | `AcceptOfferAndCreateOrder` `internal/platform/postgres/fulfillment.go:356` | `internal/platform/postgres/fulfillment.go:399-403` | **否** —— 该 INSERT 的列清单里**根本没有** `store_id` | 落 `DEFAULT ''`（`migrations/129_store_order_attribution.sql:7`） |
| A3 | `ConfirmMarketApplication` | `internal/marketplace/service.go:582`，`EnsureOrder` 在 `:601` | `marketplaceFulfillmentAdapter.EnsureOrder` `cmd/api/wire_fulfillment.go:212-230` → `fulfillmentService.Repository().EnsureOrder` | `internal/platform/postgres/fulfillment.go:49-56` | **是**（列在 `:52`，实参 `:56`） | `order.StoreID`；订单由 `MaterializedOrder` `internal/fulfillment/service.go:2663-2688` 构造，**不设 `StoreID`** ⇒ `''` |
| A4 | `CreateInvitation`（scene 邀约） | `internal/scene/service.go:410-422`（`EnsureInvitationOrder` `:421`） | `sceneFulfillmentAdapter.EnsureInvitationOrder` `cmd/api/wire_fulfillment.go:192-210` | 同 A3 的 `EnsureOrder` SQL | **是**（同 `:52`） | 同 A3 ⇒ `''`。App 侧 `scene-client.ts:106` 的 `createInvitation` **零调用方**（unverified 是否被外部调用） |

命令 → 函数的分发表：`internal/fulfillment/service.go:791-800`。

### 1.2 `fulfillment.orders.store_id` 的**唯一**非空写入点

| 项 | 位置 | 说明 |
|---|---|---|
| 入口 | `recordOutcome`（命令 `RecordOutcome`）`internal/fulfillment/service.go:1881` | |
| payload 字段 | `outcomePayload.StoreID` `internal/fulfillment/service.go:1746` | 可选，空 = 不归因 |
| 校验 | `internal/fulfillment/service.go:1906-1911` | 非空时必须命中 `s.storeLookup`（生产接线 `cmd/api/main.go:436-444`，要求店存在且 `status='ACTIVE'`），否则 `UNKNOWN_STORE` |
| 赋值 | `internal/fulfillment/service.go:1913` `order.StoreID = storeID` | 全仓唯一一处 |
| 落库 | `updateOrder` `internal/platform/postgres/fulfillment.go:203-210`（`SET ... store_id = $8` 在 `:206`） | 由 `commitOrder` `internal/fulfillment/service.go:2548` → `UpdateOrderAndPublish` 调用 |

结构体字段：`Order.StoreID` `internal/fulfillment/service.go:54`（注释明确写「空 = 没归因（老订单/没填），统计时不计入任何店，**不回填**」）。

### 1.3 For You / 活动预约 —— **不落 `fulfillment.orders`**

| 项 | 位置 | 说明 |
|---|---|---|
| 命令 | `JoinActivity` `internal/activity/service.go:296` → `joinActivity` `:605` | |
| INSERT | `internal/platform/postgres/activity.go:177-179` | 写 `activity.participants (activity_id, actor_id, companion_id, slot_key, state, order_no, order_snapshot)` |
| 该表有没有 store/business 列 | **没有** | 建表 `migrations/037_activity_persistence.sql:19-24`；加列 `137_...:15`（`order_no`）、`140_...:4`（`order_snapshot`）、`144_...:46-49`（`state`/`updated_at`）、`162_...:17-19`（`companion_id`/`slot_key`）。**全无 store_id / business_id** |
| 活动行本身 | `internal/platform/postgres/activity.go:30`、`internal/platform/postgres/activity.go:43`（`activity.activities.payload` JSONB） | `Activity` 只有 `venueName`（自由文本）/ `venueType` / `realitySceneId` / `merchantName`（`internal/activity/service.go:405-411`），**没有商家/门店 id** |
| 活动预约的商家归因（旁路） | `s.projectOrder(...)` `internal/activity/service.go:669`（报名）/ `:721`（取消）→ `BusinessRepository.ProjectActivityOrder` `internal/platform/postgres/business.go:405-451` | 用 `business.stores.reality_scene_id = $1 ORDER BY id LIMIT 1` 反查门店再取 `business_id`（`internal/platform/postgres/business.go:406-408`），写 `business.spend_daily`。**从不写 `fulfillment.orders`，也不写任何 store_id** |

> 「join 是 join，履约单是单」这条分界在 App 侧也有注释：`apps/mobile/src/surfaces/me-orders.tsx:151`。

### 1.4 其它不产生订单、但携带「店」的写入

| 表 | 位置 | store 列 |
|---|---|---|
| `voucher.definitions` | `internal/platform/postgres/voucher.go:149-157` | `store_id`（`NULLIF($3,'')`），FK 见 `migrations/107_voucher_definitions.sql:10` |
| `business.store_lines` / `store_photos` / `store_products` | `internal/platform/postgres/business.go:277`、`:216`、`:463` | `store_id` |
| `business.scene_supply_snapshots` | `internal/platform/postgres/business.go:23` | `store_id` + `scene_id` + `current_capacity_pct` / `accepting_traffic`（这才是「门店调度」现成的数据源，`migrations/072_merchant_demand_supply_signals.sql:11-13`） |

---

## 2. 门店在哪定义、被谁引用

### 2.1 门店本体

| 表.列 | 类型 | 定义处 |
|---|---|---|
| `business.stores` (id, business_id, name, address, status, created_at) | `business_id → business.accounts(id)`；`status IN ('ACTIVE','CLOSED')` | `migrations/023_business_workspace.sql:25-33` |
| `business.stores.category` | `TEXT NOT NULL DEFAULT ''` | `migrations/129_store_order_attribution.sql:10-11` |
| `business.stores.reality_scene_id` | `TEXT NOT NULL DEFAULT ''`（**无 FK**） | `migrations/135_store_reality_scene_link.sql:7` |
| `business.accounts` (id, owner_user_id, name, status, created_at) | | `migrations/023_business_workspace.sql:5-12` |
| `business.memberships.business_id / user_id / role / status` | FK → `business.accounts` | `migrations/023_business_workspace.sql:14-23` |

### 2.2 指向门店（`store_id`）的列

| 表.列 | 约束 | 迁移文件 |
|---|---|---|
| `business.store_lines.store_id` | PK, FK → `stores(id) ON DELETE CASCADE` | `migrations/038_business_store_assets.sql:25` |
| `business.store_lines.business_id` | FK → `accounts(id)` | `migrations/038_business_store_assets.sql:26` |
| `business.store_photos.store_id` | NOT NULL, FK → `stores(id)` | `migrations/038_business_store_assets.sql:9` |
| `business.store_photos.business_id` | FK → `accounts(id)` | `migrations/038_business_store_assets.sql:10` |
| `business.store_products.store_id` | NOT NULL, FK → `stores(id)` | `migrations/073_store_products.sql:3` |
| `business.store_products.business_id` | FK → `accounts(id)` | `migrations/073_store_products.sql:4` |
| `business.scene_supply_snapshots.store_id` | NOT NULL, FK → `stores(id)` | `migrations/072_merchant_demand_supply_signals.sql:12` |
| `voucher.definitions.store_id` | FK → `stores(id)`，可空 | `migrations/107_voucher_definitions.sql:10` |
| `voucher.instances.store_id` | FK → `stores(id)`，可空 | `migrations/109_voucher_purchases_instances.sql:38` |
| `fulfillment.orders.store_id` | `TEXT NOT NULL DEFAULT ''`，**无 FK**，部分索引 `WHERE store_id <> ''` | `migrations/129_store_order_attribution.sql:6-9` |

### 2.3 只指向「商家主体」（`business_id` / `merchant_id`），**不指向门店**

| 表.列 | 有无 FK | 迁移文件 |
|---|---|---|
| `business.member_directory.business_id` | FK | `migrations/038_business_store_assets.sql:37` |
| `business.spend_daily.business_id` | FK | `migrations/038_business_store_assets.sql:52` |
| `business.spend_records.business_id` + `order_id`（**自由文本，无 FK**） | FK | `migrations/023_business_workspace.sql:37-38` |
| `business.aggregated_demand_signals.business_id` | FK | `migrations/072_merchant_demand_supply_signals.sql:2` |
| `voucher.definitions.merchant_id` | FK → `accounts(id)` | `migrations/107_voucher_definitions.sql:9` |
| `voucher.purchases.merchant_id` | FK → `accounts(id)` | `migrations/109_voucher_purchases_instances.sql:16` |
| `voucher.instances.merchant_id` | FK → `accounts(id)` | `migrations/109_voucher_purchases_instances.sql:37` |
| `supply.promo_benefits.merchant_id` | **无 FK** | `migrations/167_promo_codes.sql:14` |
| `supply.promo_quotes.merchant_id` | **无 FK** | `migrations/167_promo_codes.sql:26` |
| `supply.promo_auto_benefits.merchant_id` | **无 FK** | `migrations/168_promo_auto_benefit.sql:5` |
| `supply.merchant_creator_promos.merchant_id` | **无 FK** | `migrations/170_merchant_creator_promos.sql:12` |
| `supply.promo_issues.merchant_id` | **无 FK** | `migrations/170_merchant_creator_promos.sql:43` |
| `business.store_recommendations` | **既无 store_id 也无 business_id**，只有自由文本 `store_name` / `city` | `migrations/092_store_recommendations.sql:13-26` |

### 2.4 门店推荐 / 处置（不是订单，但控制台会数）

| 表 | 迁移文件 |
|---|---|
| `business.store_recommendations`（+ `address` / `latitude` / `longitude`） | `migrations/092_store_recommendations.sql:13-26`；`migrations/130_store_recommendation_address.sql:18-21` |
| `business.store_recommendation_dispositions.recommendation_id` | `migrations/093_store_recommendation_dispositions.sql:21-31` |

### 2.5 完全没有门店/商家引用的「订单相关」表

| 表 | 说明 | 迁移文件 |
|---|---|---|
| `activity.participants` | 一行 = 一单，但无 store/business 列 | `migrations/037_activity_persistence.sql:19-24` + `137` / `140` / `144` / `162` 追加列 |
| `activity.activities` | 只有 JSONB `payload`（`venueName` 自由文本 / `realitySceneId`） | `migrations/037_activity_persistence.sql:3-10` |
| `marketplace.opportunities` / `applications` | `owner_id` 是**发布人 user id**；`OwnerType='BUSINESS'` + `Owner=店名` 只存在 payload 里，不可 join | `migrations/036_marketplace_persistence.sql:3-21`；`internal/marketplace/service.go:212-213`、`:478-485` |
| `dispatch.runs` / `dispatch.steps` | 派单流水，无 store/business 列 | `migrations/181_dispatch_runs.sql:16-48` |
| `scene.scenes.venue_id` | `TEXT`，**无 FK**，与 `business.stores` 无任何约束关系 | `migrations/028_scene_value_exchange.sql:13` |
| `outcome.observation_sets.venue_id` | `TEXT NOT NULL`，无 FK | `migrations/020_outcome_intelligence.sql:9` |

---

## 3. 控制台的商家读模型，以及它为什么返回 0

### 3.1 调用链

`apps/api-go/internal/api/server.go:254` → `operatorMerchant` `apps/api-go/internal/api/operator_console.go:150` → `OpsMetrics.Merchants` `apps/api-go/internal/opsmetrics/opsmetrics.go:146`。
前端读 `totals.orders30d` / `storesWithOrders` / `merchants[].orders30d`：`apps/market-intelligence-console/src/pages/Merchant.tsx:15`、`:55-56`、`:93`。

### 3.2 逐商户那一列（`internal/opsmetrics/opsmetrics.go:159`）

```sql
(SELECT COUNT(*) FROM fulfillment.orders o
   JOIN business.stores s ON s.id = o.store_id
  WHERE s.business_id = a.id AND o.created_at >= $1) AS orders_30d
```

### 3.3 整盘 KPI（`internal/opsmetrics/opsmetrics.go:193-196`）

```sql
(SELECT COUNT(*)          FROM fulfillment.orders o JOIN business.stores s ON s.id = o.store_id WHERE o.created_at >= $1),  -- orders30d
(SELECT COUNT(DISTINCT o.store_id) FROM fulfillment.orders o JOIN business.stores s ON s.id = o.store_id WHERE o.created_at >= $1),  -- storesWithOrders
...
(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1)                                                  -- orders30dAll
```

### 3.4 精确的返回 0 的原因（按因果顺序）

1. **列是哨兵空串，不是 NULL。** `migrations/129_store_order_attribution.sql:7` `ADD COLUMN store_id TEXT NOT NULL DEFAULT ''`，`business.stores.id` 是 `TEXT PRIMARY KEY`（`migrations/023_business_workspace.sql:26`），`''` 永远不等于任何真实店 id ⇒ `JOIN ... ON s.id = o.store_id` 匹配 0 行。这是 0 的直接机制。
2. **所有创建路径都只写空串。** A1/A3 写了列但值恒为 `''`（`internal/fulfillment/service.go:2663-2688` 与 `:1063-1074` 都不设 `StoreID`）；A2 连列都没写，落 `DEFAULT ''`（`internal/platform/postgres/fulfillment.go:399-403`）。
3. **唯一非空写入点 `RecordOutcome` 在真实用户流里几乎触发不了。** App 侧的归因选择器要同时满足三个条件才渲染（`apps/mobile/src/surfaces/me-orders.tsx:625-647`）：
   - 完成人是订单的 **AGENT**（`me-orders.tsx:625` `detail.viewerRole === "AGENT"`），需求方不能替店家记；
   - 注入了 `business` 客户端（`me-orders.tsx:108`、`:335`），无则整块不画；
   - 该账号名下至少一家 ACTIVE 企业的店（`apps/mobile/src/my-store-options.ts:21-41`，`:24` 只留 `status === "ACTIVE"`；`me-orders.tsx:628`、`:646` 在 `myStores.length === 0` 时渲染 `null`）。
   任一不满足 ⇒ `storeId` 不进 payload（`me-orders.tsx:436` 是条件展开，`fulfillment-client.ts:201-203`）⇒ 服务端 `storeID == ""` ⇒ `internal/fulfillment/service.go:1906` 直接放过不归因。
4. **`orders30dAll` 用的是无条件计数**，所以页面上「全部订单 ≠ 0、挂店订单 = 0」。这个差值是刻意暴露的，`internal/api/operator_console.go:165-170` 会补一条 note 说明「不是这些店没单，是订单到门店的归因还没建」。
5. **最根本的一条：For You / 活动预约根本不产生 `fulfillment.orders` 行。** `internal/platform/postgres/activity.go:177-179` 只写 `activity.participants`，其商家归因走 `internal/platform/postgres/business.go:405-451` 的 `business.spend_daily` 投影。`opsmetrics.Merchants` 只读 `fulfillment.orders`（`internal/opsmetrics/opsmetrics.go:159`、`:193-196`），**从不读 `activity.participants` 或 `business.spend_daily`** ⇒ 即使 `orders.store_id` 全填满，For You 单也永远不会出现在这一页。

> 注：`internal/api/operator_console.go:148` 注释里的「47 个主体 / 46 家店 / 819 张单」是写代码时的观察值，不是本次审计的测量；本次**未连库**，线上真实数字 unverified。
> 该读模型的集成测试 `internal/platform/postgres/operator_merchant_read_model_integration_test.go:106-114` 直接 `INSERT ... store_id` 种数据，并断言 `orders30dAll > orders30d`（`:177-180`）—— 说明 SQL 本身是对的，缺的确实是数据。

---

## 4. 今天真正承载最多预约的用户流

| 流 | App 入口 | 服务端落哪张表 | 产生 `fulfillment.orders`？ | 带 store？ | App 可达？ |
|---|---|---|---|---|---|
| **For You 活动报名**（含约小美时段） | `apps/mobile/src/surfaces/requester-home.tsx:1358`（`activities.join`）、`apps/mobile/src/surfaces/market.tsx:395`、`apps/mobile/src/components/scene-shop-directory.tsx:372`、`apps/mobile/src/surfaces/reality-scene-map.tsx:569`、`apps/mobile/src/surfaces/me-orders.tsx:1091`、`:1252` | `activity.participants` | **否** | **否**（表无此列），仅旁路投影到 `business.spend_daily` | **是**，6 处入口 |
| 档位 Offer → 接单 | 发单 `apps/mobile/src/surfaces/market.tsx:1766`（`createSlotOffer`）；接单 `apps/mobile/src/surfaces/me-orders.tsx:243`（`acceptSlotOffer`） | `fulfillment.offers` → `fulfillment.orders` | **是**（A2） | 只有用户在完成时手选才有 | **是** |
| 市场机会确认 | `apps/mobile/src/surfaces/market.tsx:352`（`confirmApplication`） | `fulfillment.orders`（A3 物化） | **是** | 否 | **是** |
| `CreateOffer`（旧报价命令，直接建 `OFFERED` 单） | — | `fulfillment.orders`（A1） | 是 | 否 | **否**：App 无任何 `"CreateOffer"` 调用（`apps/mobile/src/order-actions.ts:125` 只是文案表） |
| `CreateTopicInvite` / `RespondTopicInvite` | — | `fulfillment.orders`（同 A2 落库路径） | 是 | 否 | **否**：同上（`order-actions.ts:127` 仅文案） |
| `CreateInvitation`（scene 邀约） | — | `fulfillment.orders`（A4 物化） | 是 | 否 | **否**：`apps/mobile/src/scene-client.ts:106` 零调用方 |
| 商家定向邀约 / 专属码 / 内容任务 | `apps/mobile/src/surfaces/me-orders.tsx`（`supply.listReceivedInvitations` 等） | 各自业务表 | 否 | 否（`supply.*.merchant_id` 无 FK） | 是 |

### 4.1 需求任务（demand-task）流是否可达 —— **确认不可达**

| 断言 | 证据 |
|---|---|
| `buildTaskDraftChanges` 零生产调用方 | 定义 `apps/mobile/src/requester-experience.ts:62`；全仓引用只有 `apps/mobile/src/requester-experience.test.ts:2`、`:14`、`:27` |
| `DemandClient.publishTask`（`PublishTask`）零生产调用方 | 定义 `apps/mobile/src/demand-client.ts:64`；全仓引用只有 `apps/mobile/src/e2e/journey.test.ts:144`、`:228` |
| 草稿本身有人用（所以「部分可达」） | `apps/mobile/src/surfaces/fulfillment-workspace.tsx:121`（`createDraft`）、`:280`、`:296`（`updateDraft`） |
| `buildTaskDraftChanges` 只是包 `index.ts:7` 再导出 | 没有界面用它 |

⇒ **确认**：`demand-client.publishTask` 发出的需求任务在 App 里没有任何触发点，因此 `demand` 任务 → 档位 Offer → 订单这条链**从 App 走不通**（Offer 只能从 `market.tsx` 的市场机会发出，`market.tsx:1766`）。

### 4.2 结论

**承载最多「预约/单」的是 For You 活动报名（`activity.participants`）**，不是 `fulfillment.orders`。理由：

- 它有 6 个真实 App 入口（§4 表第 1 行），而 `fulfillment.orders` 的可达创建路径只有 2 条（market.tsx → AcceptSlotOffer、market.tsx → ConfirmMarketApplication），且都要先过「发单/确认」两道人工动作；
- `activity.participants` 一行就是编号 + 票面快照的一单（`migrations/137_activity_order_numbers.sql:15-16`），语义上**就是订单**；
- 它已经是商家经营数据唯一的真实来源（`business.spend_daily`，`internal/platform/postgres/business.go:405-451` + 回填迁移 `migrations/156_backfill_merchant_spend_daily.sql:17-40`），控制台却只读 `fulfillment.orders`。

**所以「0 单」有两层原因**：① `fulfillment.orders.store_id` 从没被填过；② 最大的一块预约量根本不在这张表里。

---

## 5. 提案（按工作量排序，仅提案，不实现）

> 共同前提：`migrations/143_order_audit_and_guard.sql:84-161` 的 `guard_order_write` 要求 UPDATE 时 `version = OLD.version + 1`（`:113-115`），且 `store_id` **不在**不可变身份列清单里（`:107-112`）。含义：**下单时 INSERT 写 store_id 是零成本**；下单后补写必须挂在某个会 bump version 的命令上。

| # | 改动 | 量 | 会改的文件 |
|---|---|---|---|
| **P1** | 给 `activity.participants` 加 `store_id`，在 `Join` 同一事务里用**已有的确定性解析**（`reality_scene_id` → `ORDER BY id LIMIT 1`，与 `internal/platform/postgres/business.go:406-408` 及回填 `migrations/156_...:29-35` 完全同规则）填上；场景无人认领则留空 | **S** | 新迁移 `apps/api-go/migrations/NNN_activity_participants_store.sql`；`apps/api-go/internal/platform/postgres/activity.go:104-191`（`Join`，`:177-179` INSERT + `:170-175` UPDATE 分支）；`apps/api-go/internal/platform/postgres/business.go:405-451`（改为复用同一解析，避免两套口径） |
| **P2** | 控制台读模型同时统计活动预约（`fulfillment.orders.store_id` ∪ `activity.participants.store_id`），并把两个口径分别列出来，不混成一个数 | **S** | `apps/api-go/internal/opsmetrics/opsmetrics.go:159`、`:193-196`；`apps/api-go/internal/api/operator_console.go:161-170`（note 文案）；`apps/market-intelligence-console/src/pages/Merchant.tsx:15`、`:55-56`、`:93` |
| **P3** | `AcceptSlotOffer` / `CreateOffer` 允许下单时带 `storeId`（**人类断言**，用已接好的 `SetStoreAccess` `cmd/api/main.go:446` 做成员校验，与 `RecordOutcome` 的 `SetStoreLookup` `cmd/api/main.go:436-444` 同款）；A2 的 INSERT 补上 `store_id` 列 | **M** | `apps/api-go/internal/fulfillment/service.go:1111-1120`（`slotOfferPayload`）、`:1182-1184`（`acceptSlotOfferPayload`）、`:1005-1090`（`createOffer`）、`:1218-1270`（`acceptOfferAsOrder`）；`apps/api-go/internal/platform/postgres/fulfillment.go:399-403`；`packages/contracts`（payload schema）；`apps/mobile/src/fulfillment-client.ts:130-146`；`apps/mobile/src/surfaces/market.tsx:1759-1772`；`apps/mobile/src/surfaces/me-orders.tsx:243` |
| **P4** | `fulfillment.orders.store_id` 由 `''` 哨兵改成 `NULL` + `REFERENCES business.stores(id)`，并补 `(store_id) WHERE store_id IS NOT NULL` 索引 —— 门店调度要按店做容量查询，`''` 会污染 `COUNT(*)` | **M** | 新迁移（语义变更照抄 `migrations/050_media_state_semantics.sql` 的写法）；`apps/api-go/internal/platform/postgres/fulfillment.go:161`、`:206`、`:430`、`:479-482`；`apps/api-go/internal/fulfillment/service.go:54`、`:474-476`、`:1906-1913`；`apps/api-go/internal/opsmetrics/opsmetrics.go:159`、`:193-194` |
| **P5** | 把商家主体 id 记进机会/活动，使订单至少能落到**商家**（即使还落不到具体店）：`merchantStamp`（`internal/marketplace/service.go:981-991`、`internal/activity/service.go:1139-1148`）已经拿到 `AuthContext["merchantID"]`，但只用来改展示名（`internal/marketplace/service.go:480-485`、`internal/activity/service.go:409-412`）。把它持久化并串到 `OrderRecord`（`internal/marketplace/service.go:91-99`、`:601`）→ `OrderSnapshot` | **M** | `apps/api-go/internal/marketplace/service.go:213`（`Opportunity.OwnerType`）、`:480-485`、`:91-99`、`:601`；`apps/api-go/internal/activity/service.go:409-412`；`apps/api-go/cmd/api/wire_fulfillment.go:212-230`；`apps/api-go/internal/fulfillment/service.go:60-95`（`OrderSnapshot`）；`apps/api-go/internal/platform/postgres/fulfillment.go:49-56`、`:111-118` |
| **P6** | 「当前门店」默认值（今天只有「当前商家账号」，且只存本机：`apps/mobile/src/active-merchant-store.ts:10`、`:41` 写进 JSON 的字段是 `accountId`，没有 store 维度），让 P3 的选择器有默认项、调度路由不用每次问人 | **L** | `apps/mobile/src/active-merchant-store.ts`（存 `storeId`）；`apps/mobile/src/my-store-options.ts:21-41`；`apps/api-go/internal/business/service.go`（新增 `SetCurrentStore` 等命令 + `internal/platform/postgres/business.go` 实现）；新迁移 `business.store_prefs` |
| **P7** | 门店调度本体：`dispatch.runs` 加 `store_id`，发邀约前读 `business.scene_supply_snapshots.current_capacity_pct` / `accepting_traffic`（列已存在：`migrations/072_merchant_demand_supply_signals.sql:12-13`；读路径 `internal/platform/postgres/business.go:23`、`:28`）做容量闸 | **L** | 新迁移；`apps/api-go/internal/dispatch/dispatch.go`、`internal/dispatch/postgres.go`、`internal/dispatch/memory.go`；`apps/api-go/cmd/api/main.go`（dispatch 循环 + 容量查询接线） |

### 建议顺序

`P1 → P2` 先把**已有事实**（活动预约）如实呈现出来（两个 S，一两天内能看到非 0），再 `P3 → P4` 让履约订单在建单时就带店并把哨兵换成 FK，最后 `P5 → P6 → P7` 才是真正的「门店调度」。**P1/P2 不碰 `fulfillment.orders` 的既有语义**，风险面最小。

### 明确不做的事

- **不回填老订单的 `store_id`**：`internal/fulfillment/service.go:52-54` 与 `internal/platform/postgres/business.go:396-404` 的注释已定调 ——「没人能诚实补上」。
- **不按金额档/场景自动猜店**：`158_store_product_hot.sql:5-8` 已经因为同类理由（用店级销量推单品）拒绝过一次。
- **不在 `RecordOutcome` 里替用户选店**：那是人类断言（`internal/fulfillment/service.go:1904-1911`）。

---

## 未验证 / 待确认

- 线上真实数字（主体数、店数、订单数、`orders30d` 实际值）—— 本次**未连库**，全部 unverified；`internal/api/operator_console.go:148` 的注释数字只是历史观察。
- `scene-client.createInvitation` 是否被 App 以外的调用方使用（只确认了 `apps/mobile` 内零引用）。
- `business.accounts.status` 是否只有 `ACTIVE`/`SUSPENDED` 两值在用（DDL CHECK 见 `migrations/023_business_workspace.sql:11`，无别的迁移放宽它）。
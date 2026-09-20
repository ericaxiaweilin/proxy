# 商户发券 → 平台采购：合规化改造方案

日期：2026-09-20
目标：商户自己发券 → 平台采购 → 每张券可追溯来源
前提（已确认）：**平台不碰钱**；但记账照做、**金融级**、**与普通数据隔离**

---

## 0. 结论先说

**不缺「商户主体」，缺的是把主体接到券上的那一根线。**

我上一份审查（`Merchant_Voucher_Workflow_Audit_2026-09-20.md` §4.1）写的「商户作为已认证主体
全仓不存在」是**错的**，这里更正。我当时 grep 的是 `"MERCHANT"` 字符串和 `MerchantID` 字段，
漏掉了真正的实体名。实际情况：

| 能力 | 状态 | 证据 |
|---|---|---|
| 商户主体（企业账户） | **已有且持久化** | `business.accounts(id, owner_user_id, name, status)`，`023_business_workspace.sql:5` |
| 主体成员 + 角色 | **已有** | `business.memberships(business_id, user_id, role, status)`，`:14` |
| 门店 | **已有** | `business.stores(id, business_id, name, address, status)`，`:25` |
| 成员资格校验 | **已有，20+ 处调用** | `business/service.go:1090 hasRole(ctx, businessID, userID, "OWNER","ADMIN",...)` |
| 商户自服务命令 | **已有，23 条** | `CreateBusinessAccount` / `AddBusinessMember` / `CreateBusinessStore` / `GetMerchantOperatingHome` …（`command_dispatch.go:277`） |
| 商户界面 | **已有** | `surfaces/business-home.tsx`、`merchant-me-r21-replacement.tsx` |
| **「用户代表商户」的服务端归属** | **已有，且是现成模板** | `MERCHANT-PUBLISH-001`，见下 |
| 券上的商户归属 | **缺** | `043_voucher.sql` 无 `merchant_id`/`store_id` |
| 采购记录 | **缺** | 全仓 grep `采购`/`purchase` 零命中 |
| 券的追溯链 | **缺** | `voucher.vouchers` 主键是 `(actor_id, voucher_id)`，链不到商户 |

所以工作量不是「造一个商户体系」，而是**把已有的商户主体接到券的发行/采购/核销三处**。

### 现成的模板：`MERCHANT-PUBLISH-001`

`internal/api/merchant_identity.go` 已经实现了一套**完全正确**的「用户代表商户」机制，
而且它解决的正是上次审查里 `security.go:126` 那条注释说「等真正出现商家自建入口时必须换成
校验 e.Actor 是否为该 ownerId 的主体成员」的那个问题：

```go
// merchant_identity.go:21
var merchantPublishCommands = map[string]bool{
	"PublishMarketOpportunity": true,
	"PublishActivity":          true,
}

// merchant_identity.go:34  resolveMerchantPublish —— 在认证之后、执行之前跑
//   （command_dispatch.go:129，executeCommand 在 :137）
// 1) 取 payload.merchantId
// 2) s.Business.MerchantPublishIdentity(ctx, raw, envelope.Actor.ID)  ← 用**服务端会话身份**验成员资格
// 3) 通过则把 AuthContext["merchantID"]/["merchantName"] 盖上
// 4) 不通过 → MERCHANT_FORBIDDEN（403）
// 5) 声明为空 → 走普通 PERSON 路径，不受影响

// 服务侧只读标注，绝不读 payload：
// activity/service.go:635  merchantStamp(e) → e.AuthContext["merchantID"]
// marketplace/service.go:798 同上
```

**这就是「商户自己发券」要的那根线。** 把它扩到券上，商户归属就是**服务端验过的**，
而不是上次审查里 `benefit` 那种「`p.MerchantID` 调用方传的」的可伪造值。

---

## 1. 目标模型：三层 + 一条追溯链

```
① 发行  voucher.definitions     商户（OWNER/ADMIN）定义「我发什么券」
              │  merchant_id  ← 只从 AuthContext 标注取，绝不从 payload
              ▼
② 采购  voucher.purchases       平台向商户买一批（B2B：合同 / 发票 / MST / 单价 / 数量）
              │  purchase_id
              ▼
③ 实例  voucher.instances       每张券一行，带 purchase_id
              │
              └─ 追溯链：instance → purchase → (merchant_id, definition_id)
```

### ① 发行（商户 → 定义）

```sql
CREATE TABLE voucher.definitions (
    definition_id            TEXT PRIMARY KEY,
    merchant_id              TEXT NOT NULL,      -- FK business.accounts(id)
    store_id                 TEXT,               -- FK business.stores(id)，可空=全部门店
    family                   TEXT NOT NULL CHECK (family IN ('COFFEE','EXPERIENCE','ACTIVITY')),
    face_value_minor         BIGINT NOT NULL CHECK (face_value_minor > 0),
    currency                 TEXT NOT NULL DEFAULT 'VND',
    scope_name               TEXT NOT NULL,
    valid_from               DATE NOT NULL,
    valid_until              DATE NOT NULL,
    redeem_window            TEXT NOT NULL DEFAULT '',
    per_person_limit         INTEGER NOT NULL DEFAULT 1,
    merchant_unit_cost_minor BIGINT NOT NULL,    -- 商户的结算价（平台采购单价的下限）
    status                   TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
    version                  INTEGER NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

命令：`IssueVoucherDefinition`（新增，**进 `merchantPublishCommands`**）。
`merchant_id` 由 `merchantStamp(e)` 取，`hasRole(..., "OWNER","ADMIN")` 已由
`MerchantPublishIdentity` 保证。**这一条就消灭了 B-5 的冒名活动洞。**

### ② 采购（平台 ↔ 商户）

```sql
CREATE TABLE voucher.purchases (
    purchase_id       TEXT PRIMARY KEY,
    definition_id     TEXT NOT NULL REFERENCES voucher.definitions(definition_id),
    merchant_id       TEXT NOT NULL,              -- 冗余，供追溯与对账
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_minor   BIGINT  NOT NULL CHECK (unit_cost_minor >= 0),
    total_minor       BIGINT  NOT NULL CHECK (total_minor >= 0),
    currency          TEXT    NOT NULL DEFAULT 'VND',
    contract_ref      TEXT,                       -- 采购合同号
    invoice_ref       TEXT,                       -- 发票号
    tax_code_snapshot TEXT,                       -- 下单时的 MST 快照（见 §3 合规）
    status            TEXT NOT NULL CHECK (status IN ('DRAFT','ORDERED','CONFIRMED','CANCELLED')),
    ordered_by        TEXT NOT NULL,              -- 操作人（运营）
    ordered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at      TIMESTAMPTZ,
    CHECK (total_minor = quantity * unit_cost_minor)   -- 算术在库层就闭合
);
```

命令：`OrderVoucherPurchase` / `ConfirmVoucherPurchase`（operator-only，保持现状即可 ——
采购是平台侧动作）。

**`CHECK (total_minor = quantity * unit_cost_minor)` 是关键**：金额不自洽的采购单根本进不了库。
这是上次审查里 `benefit` 那种「硬编码百分比 / 常量 0」的反面。

### ③ 实例（可追溯的券）

```sql
CREATE TABLE voucher.instances (
    instance_id            TEXT PRIMARY KEY,
    purchase_id            TEXT NOT NULL REFERENCES voucher.purchases(purchase_id),
    definition_id          TEXT NOT NULL,         -- 冗余
    merchant_id            TEXT NOT NULL,         -- 冗余：券永远知道自己的来源
    store_id               TEXT,                  -- 核销门店，核销时落定
    code                   TEXT NOT NULL UNIQUE,  -- 券码
    holder_actor_id        TEXT,                  -- 持有人，可空=未分发
    status                 TEXT NOT NULL CHECK (status IN
                             ('MINTED','DISTRIBUTED','REDEEMED','EXPIRED','VOIDED')),
    issued_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at             TIMESTAMPTZ,
    redeemed_at            TIMESTAMPTZ,
    redeemed_by_merchant_id TEXT,                 -- 核销方（服务端验过的商户）
    redeemed_by_user_id     TEXT,                 -- 实际按核销键的人（门店员工）
    redemption_evidence     TEXT                  -- 'MERCHANT_SCAN' | 'ORDER_VERIFIED'
);
CREATE INDEX ON voucher.instances (merchant_id, status);
CREATE INDEX ON voucher.instances (holder_actor_id, status);
```

**追溯就是一次 join**：`instance → purchase → (merchant_id, contract_ref, invoice_ref, tax_code_snapshot)`。
`merchant_id` 在实例上是**冗余存**的，所以任何一条核销/结算记录都不会因为采购单被改而丢失来源。
「每个商户卷要追溯来源」到这里是**结构保证**，不是约定。

---

## 2. 资金模型：不碰钱，但账要记全

你的决定是平台不碰钱。那么钱的路径是：

```
采购确认    平台欠商户钱           → 记「应付商户」↑        （钱没动）
线下转账    银行/VietQR 直付商户    → 记「应付」↓「已付」↑    （钱在平台外动，平台只记录事实）
用户核销    商户交付咖啡            → 不动钱，消耗预付资产    （履约事件，不是支付事件）
券过期      商户欠平台（breakage）  → 记「商户欠平台」↑      （必须记，不能静默丢弃）
```

**关键点**：平台的资金动作只发生在**采购**那一步，而且**在平台外的通道里**完成；
核销是**履约**不是支付。这样既满足「不碰钱」，账又是完整的。

### 隔离的账本（按你的要求：金融级 + 不与普通数据混）

独立 schema，双式记账：

```sql
CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE ledger.accounts (
    account_id   TEXT PRIMARY KEY,
    owner_type   TEXT NOT NULL CHECK (owner_type IN ('PLATFORM','MERCHANT','USER','EXTERNAL')),
    owner_id     TEXT NOT NULL,
    kind         TEXT NOT NULL,   -- 'PAYABLE' | 'PREPAID' | 'PAID' | 'BREAKAGE'
    currency     TEXT NOT NULL DEFAULT 'VND',
    UNIQUE (owner_type, owner_id, kind, currency)
);

CREATE TABLE ledger.transactions (
    txn_id          TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,   -- 'VOUCHER_PURCHASE' | 'OFFLINE_SETTLEMENT' | 'VOUCHER_EXPIRY'
    source_type     TEXT NOT NULL,   -- 'voucher_purchase' | 'voucher_instance'
    source_ref      TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_by      TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,     -- 重放不会重复记账
    UNIQUE (source_type, source_ref, kind)
);

CREATE TABLE ledger.entries (
    entry_id     BIGSERIAL PRIMARY KEY,
    txn_id       TEXT NOT NULL REFERENCES ledger.transactions(txn_id),
    account_id   TEXT NOT NULL REFERENCES ledger.accounts(account_id),
    direction    TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency     TEXT NOT NULL DEFAULT 'VND'
);
```

三条硬约束（都是上次审查里缺的）：

1. **有方向**：`DEBIT`/`CREDIT`，回答「谁欠谁」。
2. **有对手方**：一笔 txn 至少两条 entry，`SUM(DEBIT) = SUM(CREDIT)`（在事务里断言，不平就回滚）。
3. **不吞错**：`CreateSettlement` 那四处 `_ =` 全部改成 `if err != nil { return err }`。
   金融级记账不允许「账本行写失败而流程继续」。

`voucher.settlements`（048）**退役**：它无方向、对手方是消费者自己，不是账本。

---

## 3. 合规：越南法下的两个必须

### 3.1 商户必须实名 + 绑定税务身份（MST）

`COMP-SELLER-001`（`supply/seller_identity.go` + `084_seller_real_name.sql`）已经实现了这个判定，
且 fail-closed（查不到 = 未核验）。**但它的主体是 `agent_id`（个体卖家），不是商户。**

改造：按 `084` 的形状给 `business.accounts` 加一份商户级核验（`business_id` + `tax_code` + 有效期），
然后：

- **采购单只能开给已核验、MST 未过期的商户** —— 未核验 → 拒绝开单，fail-closed。
- `purchases.tax_code_snapshot` 落**下单时**的 MST，所以商户后来改了税号也不影响历史凭证。
- 依据：越南电商法 122/2025 + 实施条例 NĐ 248/2026（2026-07-01 生效）禁止匿名销售。

### 3.2 采购必须有凭证链

平台买券 = B2B 采购，需要合同号 + 发票号 + MST。`purchases` 的三个字段
（`contract_ref` / `invoice_ref` / `tax_code_snapshot`）就是这条链。
它们允许为空（P0 可以先不填），但**字段在表里**，所以「补齐凭证」是数据问题不是重构问题。

### 3.3 与 018 托管语义的冲突

`018_payment_ledger.sql` 的 `CREDIT_HOLD` / `payout_holds`（`HELD`/`RELEASED`）
意味着平台替双方持有资金 —— 与「不碰钱」直接冲突。
按你的决定：**改语义，不删表**。`018` 退成审计用途，资金流改由 `ledger` 记应收应付。

---

## 4. 逐条修掉上次审查的缺陷

| 上次的洞 | 这个方案怎么修 |
|---|---|
| **V-1** 消费者自证核销，回执写 `MERCHANT_CONFIRMED` | 核销方必须是 `instance.merchant_id` 的 **ACTIVE 成员**（`hasRole` 校验），
落 `redeemed_by_merchant_id` + `redeemed_by_user_id` + `redemption_evidence='MERCHANT_SCAN'`。
消费者不再能自己确认。 |
| **V-2** `settle()` actor 口径错位 | 按 `instance_id`（全局唯一）结算，不再按 `(actor_id, voucher_id)`。
真实核销终于能到 `SETTLED`。 |
| **V-3** `voucher.settlements` 无方向/对手方 | 退役，改 `ledger.entries`（双式、有方向）。 |
| **V-4** 消费端「模拟风控并结算」按钮恒 403 | 消费者端**移除**结算入口（结算不是消费者动作）；
结算状态改为只读展示。 |
| **V-5** 券无商户外键 | `definitions`/`instances` 都有 `merchant_id`，且 `instances.merchant_id` 冗余存。 |
| **V-6** `fraud.go` 5 行死码 | `per_person_limit` 落到 `definitions`，领取时按 `holder_actor_id` 计数生效。 |
| **B-2** `MerchantContribMinor: 0` | 商户成本 = **采购单价**（`purchases.unit_cost_minor`），是派生值不是硬编码。
方向从「平台全担」翻成「平台采购」。 |
| **B-3** 预算不设防 | 预算 = 已确认采购单的 `SUM(total_minor)`；已用 = 已核销实例数 × 单价。
两者相减即余额，核销时校验。 |
| **B-5** 四处权威洞 | 靠 §1① 的 `merchantPublishCommands` + `hasRole` 修，**离开 operator 门**
—— 正是 `security.go:126` 注释写的终态。 |
| **B-6** 账本写入吞错 | `ledger` 写入失败即回滚，事务内断言借贷平衡。 |
| **B-1** benefit 只有内存实现 | 见 §5 第 0 步：先定正本。 |

---

## 5. 落地顺序（每步可独立验证）

**第 0 步 —— 先定正本（这一步不定，后面全是返工）**
`voucher` 与 `benefit` 两套并行、都各有 `settle`。我的建议：

- **`voucher` 做正本**：它**已经有 Postgres 持久化**（`platform/postgres/voucher.go` 真 INSERT），
  改造它是「加表加列」；而 `benefit` 是**内存实现**，改造它是「从零写持久化层」。
- **`benefit` 降级为活动/分发层**：它的 `Campaign`/`Allocation`/`Offer` 语义有价值，
  但 `063` 那 12 张表零引用，别急着接 —— 先让 `voucher` 这条链跑通。
- `benefit` 里真正值得马上搬过来的只有两件：`EvidenceType`（`MERCHANT_SCAN`/`ORDER_VERIFIED`）
  和成本拆分字段的形状。

**第 1 步 —— 把商户接到券上（最小可验证切片）**
`merchantPublishCommands` 加 `IssueVoucherDefinition`；建 `voucher.definitions`；
命令里 `merchant_id` 只从 `merchantStamp(e)` 取。
验证：伪造 payload 里的 `merchantId` 必须被 `MERCHANT_FORBIDDEN` 拒（**负向注入**）。

**第 2 步 —— 采购与追溯**
建 `voucher.purchases` + `voucher.instances`；`CHECK` 算术闭合；
验证：任取一张券，能一条 join 走通 `instance → purchase → merchant + contract_ref`。

**第 3 步 —— 核销改成商户侧**
`confirmRedemption` 改成校验核销方是 `instance.merchant_id` 的成员；
删掉消费者自证路径。
验证：消费者自己调核销必须失败（负向注入）。

**第 4 步 —— 账本隔离**
建 `ledger` schema；把采购确认 / 线下付款确认 / 过期三个事件接上；
四处 `_ =` 改成不吞错。
验证：构造一笔不平的 txn，必须被拒。

**第 5 步 —— 商户级实名 + MST 闸**
按 `084` 形状加商户核验；采购单对未核验商户 fail-closed。

---

## 6. 需要你定的三件事

1. **正本**：接受「`voucher` 做正本、`benefit` 降级」吗？（§5 第 0 步，其余全部依赖它）
2. **商户实名**：商户级 MST 核验是**新建一张表**（复用 084 形状），还是把商户建成
   `agent_id` 的一种、直接复用 `supply.seller_real_name_verifications`？
   —— 前者干净，后者少一张表但要改 084 的语义。
3. **`018` 的处理**：改成纯应收应付（保留表改语义），还是新开 `ledger` 而 `018` 冻结为只读审计？

---

## 附：复核命令

```bash
cd ~/work/kake/apps/api-go

# 商户主体存在且持久化（我上次审查漏掉的部分）
sed -n '1,45p' migrations/023_business_workspace.sql
grep -n "func (r \*BusinessRepository)" internal/platform/postgres/business.go

# 成员资格校验（20+ 处）
grep -n "hasRole" internal/business/service.go | head -25
sed -n '1090,1101p' internal/business/service.go

# 现成的「用户代表商户」模板
cat internal/api/merchant_identity.go
grep -n "resolveMerchantPublish" -B 6 -A 8 internal/api/command_dispatch.go

# 服务侧只信标注、不信 payload
sed -n '635,645p' internal/activity/service.go
sed -n '795,810p' internal/marketplace/service.go

# 券上仍然没有商户归属
grep -n "merchant" migrations/043_voucher.sql || echo "→ 无 merchant_id / store_id"

# 采购仍然不存在
grep -rn "采购\|purchase" --include="*.go" . | grep -v _test.go   # 零命中

# benefit 仍然只有内存
grep -n "NewMemoryRepository" cmd/api/main.go
```

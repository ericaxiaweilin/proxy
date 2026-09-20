# 商户发券 → 平台采购 工作流审查

日期：2026-09-20
范围：`apps/api-go/internal/voucher/`、`apps/api-go/internal/benefit/`、`migrations/043`、`048`、`063`、`084`、`internal/api/security.go`、`apps/mobile/src/surfaces/voucher.tsx`
方法：只读代码与迁移，所有结论均附行号；未修改任何文件。

---

## 0. 结论摘要

**前提需要先纠正：现在商户根本不能自己发券。**

不是「权限很大」，而是**这条工作流不存在**。全仓唯一的授权门是 `internal/api/security.go` 的 `operatorCommandTypes`，在 `command_dispatch.go:77` 对每条命令 fail-closed 执行。而：

- `CreateVoucher` / `SettleVoucher` 在门内（`security.go:74–75`）→ 只有运营能发。
- 消费者拿到的券**全部来自一段硬编码的 3 行种子**（`voucher/service.go:357–371`），不是任何主体发出的。
- 另一套 `benefit` 域的四条活动管理命令也在门内（`security.go:128–131`），且注释明写这是**止血而非终态**。

所以「商户权限很大」这个担心，在当前代码里对应的真实风险是**反过来的**：**券这条线上**没有任何主体归属——但要注意，**商户主体本身是存在的**（`business.accounts`/`memberships`/`stores`，见 §4.1 的更正），只是**没接到券上**。所以现状不是「商户能冒用身份」，而是「商户想发券也没有入口，且入口一旦打开，券这边没有归属校验可依赖」。

| # | 缺陷 | 严重度 | 一句话 |
|---|---|---|---|
| V-1 | 消费者自证核销，回执写 `MERCHANT_CONFIRMED` | **高** | 核销的唯一参与者是消费者自己 |
| V-2 | `settle()` 的 actor 口径错位 | **高** | 真实核销永远到不了 `SETTLED` |
| V-3 | `voucher.settlements` 无方向、无对手方 | **高** | 名为「账本分离」，实为单向记录 |
| V-4 | 消费端「模拟风控通过并结算」按钮必然 403 | 中 | 终态不可达，报错说成「暂时无法更新」 |
| V-5 | `043` 无 merchant/store 列，`issuer_label` 硬编码 | 中 | 券与商户之间没有外键 |
| V-6 | `voucher/fraud.go` 5 行死码 | 低 | 领取上限/防刷从未接线 |
| B-1 | `benefit` 只有内存实现，`063` 的 12 张表零引用 | **高** | 重启即失忆，schema 是空壳 |
| B-2 | `MerchantContribMinor` 硬编码 0 | **高** | 商家承担 0 成本，与「平台采购」相反 |
| B-3 | `SpentMinor` 从不写、`BudgetMinor` 从不校验 | **高** | 预算不设防 |
| B-4 | `CreatorAllocMinor` 无结算分支 | 中 | 创作者分成结构性无法结算 |
| B-5 | 四处权威洞（已止血） | 中 | 止血不等于修好 |
| B-6 | 所有账本写入吞错 | **高** | 金融级记账不能静默丢行 |

---

## 1. 两套并行系统

仓里有两套「券」，互不相识，职责重叠：

| | `internal/voucher/` | `internal/benefit/` |
|---|---|---|
| 产品语义 | 消费者权益凭证（COFFEE/EXPERIENCE/ACTIVITY） | Benefit Routing Network（Campaign→Allocation→Offer→Claim→Redemption→Settlement） |
| 持久化 | **有** Postgres（`platform/postgres/voucher.go`，真 `INSERT`） | **无**，只有 `benefit.NewMemoryRepository()` |
| 接入点 | `cmd/api/main.go:139,282` | `cmd/api/main.go:464–466` |
| 命令数 | 7（`service.go:122`） | 6（`service.go:86–109`） |
| 归属模型 | 按 `actor_id`（消费者） | 按 `Campaign.OwnerType/OwnerID`（proxy/merchant/creator） |
| 商户可调用 | 否（operator 门） | 否（operator 门，止血态） |
| 账本 | `voucher.settlements` | `benefit.settlements` |
| 成本拆分 | 硬编码百分比（`create()`） | 硬编码常量（`service.go:479–482`） |

两套都在跑、都有 `settle`/`Settlement` 概念、都各自记一本账。**这是本次审查最重要的结构性问题**：在按金融级重建记账之前，必须先决定哪一套是正本。

---

## 2. voucher 侧：逐条证据

### V-1 消费者自证核销，回执却声称商家确认 —— 高

`confirmRedemption`（`voucher/service.go:251–295`）的身份校验是：

```go
if !ok || r.ActorID != e.Actor.ID {
    return reject(e, "REDEMPTION_NOT_FOUND", "voucher.redemption_not_found")
}
```

`r.ActorID` 是**打开核销的那个人**（`openRedemption` 里 `ActorID: e.Actor.ID`，`service.go:236`），也就是消费者。所以这段代码的含义是「打开的人自己来确认」——**整个核销路径没有任何商家参与**。

而它返回的回执是：

```go
"receipt": map[string]any{"redemptionId": r.ID, "redeemedAt": ..., "evidenceStatus": "MERCHANT_CONFIRMED"}
```

`MERCHANT_CONFIRMED` 这个字符串是**凭空写上去的**：没有任何商家动作产生它。同一文件里 `openRedemption` 的提示还写着「扫码或展示不等于核销或结算」（`service.go:246`），而 `confirmRedemption` 恰恰允许消费者自己完成这一步，两句自相矛盾。

UI 层目前是诚实的——按钮文案就是「模拟商家确认核销」、并注明「仅限本地 P0 测试」（`surfaces/voucher.tsx:105`）。所以**当前不是对外虚假陈述**；但 `evidenceStatus: "MERCHANT_CONFIRMED"` 是会被下游（含 `settle()` 与任何对账）读到的字段，一旦有真实结算接上来，它就是伪造的举证。

### V-2 `settle()` 的 actor 口径错位 —— 高

`settle()`（`service.go:317–341`）取券用的是**调用者自己的 actor**：

```go
v, ok, _ := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
```

而 `SettleVoucher` 是 operator-only（`security.go:75`），所以 `e.Actor.ID` 是**运营**。券表主键是 `(actor_id, voucher_id)`（`043_voucher.sql`），消费者的券 `actor_id` 是消费者。

于是：**运营去结算消费者的券 → `VOUCHER_NOT_FOUND`。**

推论：`voucher.settlements` 只可能记到「运营自己持有并自己结算」的行；真实消费者核销的券**永远停在 `REDEEMED`，到不了 `SETTLED`**。这是一条接了一半的通道——建成、有调用方、但调用方拿不到数据。

### V-3 `voucher.settlements` 无方向、无对手方 —— 高

`048_voucher_settlements.sql` 自述是「凭证结算账本（P0 账本分离）」，但列只有：

```sql
settlement_id, voucher_id, actor_id, amount, currency, created_at
FOREIGN KEY (actor_id, voucher_id) REFERENCES voucher.vouchers(actor_id, voucher_id)
```

- 没有借贷方向；
- 没有付款方/收款方；
- `actor_id` 是**券的持有人（消费者）**，也就是受益人，账上却没有另一侧。

写入处同样（`service.go:334`）：`Settlement{... ActorID: e.Actor.ID ...}`，即「消费者结算给自己」。

你要求的「金融级记账」在这里缺的不是精度，是**记账本身**：一条只有金额、没有对手方的记录，无法回答「谁欠谁多少」。

### V-4 消费端结算按钮必然 403 —— 中

`surfaces/voucher.tsx:100` 把 `settle()` 接到了 UI，调用 `client.settle` → `SettleVoucher`（`voucher-client.ts:78`）→ operator 门 → 普通用户恒 403。

失败被渲染成 `setError("结算状态暂时无法更新。")`（`voucher.tsx:100`），于是「你没有权限」被说成「暂时无法更新」——正是要避免的那种把三种事实压成一句含糊话的写法。`screen === "SUCCESS"` 那一屏（`voucher.tsx:110`，「礼券已经完成核销并通过结算 Gate」）因此**不可达**。

### V-5 券与商户之间没有外键 —— 中

`043_voucher.sql` 的 `voucher.vouchers` 列里有 `issuer_label TEXT`、`funding_merchant INTEGER`，**没有 `merchant_id` / `store_id`**。`issuer_label` 在 `create()` 里被写死成字面量：

```go
IssuerLabel: "当前经营主体"
```

（`service.go:354`）——每一张券的发行方都叫「当前经营主体」。券是 `(actor_id, voucher_id)` 的私有物，没有主体间的可结算关系。

### V-6 `voucher/fraud.go` 是 5 行死码 —— 低

全文件即 `MaxPerPerson = 3` / `MaxBatchClaim = 10` / `func IsFraudBatch(claims int) bool`，三个标识符**全仓零调用**。领取上限、防刷阈值从未接线。

---

## 3. benefit 侧：逐条证据

### B-1 只有内存实现，`063` 的 12 张表零引用 —— 高

`cmd/api/main.go:464–466`：

```go
benefitRepo := benefit.NewMemoryRepository()
benefitService := benefit.NewService(benefitRepo)
server.Benefit = benefitService
```

`internal/platform/postgres/` 下**没有任何 `benefit*.go`**。而 `063_benefit_routing_network.sql` 建了 `benefit` schema 的 12 张表（`campaigns`/`definitions`/`capacity_pools`/`allocations`/`offers`/`claims`/`redemptions`/`settlements`/`rewards`/`attribution_edges`/`campaign_audiences`/`campaign_events`），**零个 Go 文件引用其中任何一张**。

即：活动、配额、领取、核销、结算全部**重启即失忆**，而为此准备的 schema 是空壳。这套系统已接入 dispatch（`command_dispatch.go:287–288`）并且有 UI（`surfaces/BenefitClaimScreen.tsx` 显示 `预算: {budgetMinor}`），所以它不是死代码——是**会丢数据的活代码**。

### B-2 商家承担 0 成本 —— 高

`benefit/service.go:477–482`，核销时的成本拆分：

```go
ProxySubsidyMinor:    benefit.RetailValueMinor - benefit.UserPayMinor, // simplified
MerchantContribMinor: 0,
CreatorAllocMinor:    0,
StaffRewardMinor:     0,
```

**折扣 100% 记在平台账上，商家一分不出。** 这与第二层的「平台采购商户的券」在方向上是相反的：采购模型里平台先付给商户、再分发给用户，商户是**收款方**；当前代码里商户既不出钱也不收钱，整个 `MerchantContribMinor` 字段是死的。

下游 `createSettlements`（`service.go:517–560`）三个分支都以 `> 0` 为条件，所以实际上**只有 Proxy 一条会落账**，且 `ActorID` 写死为字面量 `"proxy"`。

### B-3 预算不设防 —— 高

- `Campaign.BudgetMinor`（`model.go:52`）从 payload 直接写入（`service.go:163`），**全仓没有任何地方与它比较**。
- `Campaign.SpentMinor`（`model.go:53`）**全仓仅出现 1 次**——就是它的声明。从不读、从不写。

于是 `budgetMinor` 是一个系统不打算兑现的承诺：核销次数不受预算约束，`spentMinor` 永远序列化为 0。UI 已在展示 `预算: {formatMoney(campaign.budgetMinor)}₫`（`BenefitClaimScreen.tsx:187`），却没有「已用」可对。

### B-4 创作者分成无结算分支 —— 中

`CreatorAllocMinor` 只在两处出现：声明（`model.go:223`）与被赋 0（`service.go:481`）。`createSettlements` 只有 Proxy / Merchant / Staff 三条分支，**没有 Creator**。即便将来把字段填对，也没有落账路径。

### B-5 四处权威洞：已止血，但注释自己写明不是修好 —— 中

`security.go:114–131` 把 `CreateCampaign` / `ActivateCampaign` / `PauseCampaign` / `AllocateBenefit` 收进 operator 门，注释原文：

> 注意这是止血而非终态：等真正出现「商家自建活动」的入口，必须换成校验 `e.Actor` 是否为该 `ownerId` 的主体成员，而不是继续留在 operator 门里。

具体洞：`CreateCampaign` 的 `ownerType`/`ownerId` 直接来自 payload 只判非空（**能建挂在别人名下的活动**）；`ActivateCampaign`/`PauseCampaign` 只带 `campaignId` 不问归属；`AllocateBenefit` 的 `distributorId` 来自 payload。危害链注释也写清了：冒名活动一旦被激活，真实用户来核销，而结算归属按 `campaign.OwnerID` 判 → **被冒名的商家为别人的活动买单**。

唯一真实存在的归属校验在核销处（`service.go:431`）：

```go
if campaign.OwnerType == "merchant" && campaign.OwnerID != "" && campaign.OwnerID != p.MerchantID { … MERCHANT_NOT_CAMPAIGN_OWNER }
```

注意 `p.MerchantID` 同样是**调用方传的**——它只是把「传进来的商家」和「活动的商家」对了一下，不证明调用者就是那个商家。

### B-6 账本写入吞错 —— 高

四处结算写入全部忽略错误：

```
voucher/service.go:334    _ = s.repo.CreateSettlement(...)
benefit/service.go:521    _ = s.repo.CreateSettlement(...)
benefit/service.go:535    _ = s.repo.CreateSettlement(...)
benefit/service.go:549    _ = s.repo.CreateSettlement(...)
```

对金融级记账来说，账本行写失败而流程继续、且不留痕，是最不能接受的一种失败模式。`benefit` 还多一层：`Settlement` 结构体同样没有借贷方向字段。

---

## 4. 合规缺口（对照你的第二层「咖啡券 B2B 采购」）

### 4.1 ⚠️ 更正：商户主体**是存在的**，缺的是「把主体接到券上」

> **本节初稿写错了，2026-09-20 更正。** 初稿说「商户作为已认证主体全仓不存在」——
> 那是因为我 grep 的是 `"MERCHANT"` 字符串和 `MerchantID` 字段，**漏掉了真正的实体名**。
> 实际实体叫 `business`，不叫 `merchant`。

实际情况（`internal/business/` + `migrations/023_business_workspace.sql`）：

| 能力 | 状态 | 证据 |
|---|---|---|
| 商户主体（企业账户） | **已有且持久化** | `business.accounts(id, owner_user_id, name, status)`，`023:5` |
| 主体成员 + 角色 | **已有** | `business.memberships(business_id, user_id, role, status)`，`023:14` |
| 门店 | **已有** | `business.stores(id, business_id, name, address, status)`，`023:25` |
| 成员资格校验 | **已有，20+ 处调用** | `business/service.go:1090 hasRole(ctx, businessID, userID, "OWNER","ADMIN",...)` |
| 商户自服务命令 | **已有，23 条** | `command_dispatch.go:277`；`CreateBusinessAccount` / `AddBusinessMember` / `CreateBusinessStore` / `GetMerchantOperatingHome` … |
| 商户界面 | **已有** | `surfaces/business-home.tsx`、`merchant-me-r21-replacement.tsx` |
| 「用户代表商户」的服务端归属 | **已有，且是现成模板** | `MERCHANT-PUBLISH-001`：`internal/api/merchant_identity.go` |

**真正缺的只有一样：`voucher` / `benefit` 这两套券系统没有接到 `business` 上。**
具体是 `043_voucher.sql` 没有 `merchant_id`/`store_id`，而 `benefit` 的 `p.MerchantID`
是调用方传的、没走 `MERCHANT-PUBLISH-001` 那套成员校验。

**而且修法已有现成模板**：`internal/api/merchant_identity.go` 的
`merchantPublishCommands` + `resolveMerchantPublish`（在 `command_dispatch.go:129`
认证之后、`executeCommand`:137 之前跑）+ 服务侧只读 `e.AuthContext["merchantID"]`
（`activity/service.go:635`、`marketplace/service.go:798`）—— 这套机制解决的
**正是** `security.go:126` 那条注释说「等真正出现商家自建入口时必须换成校验 e.Actor
是否为该 ownerId 的主体成员」的那个问题。把它扩到券上即可。

所以 B-5 那四个洞之所以收在 operator 门里，**不是因为没有主体模型**，
而是因为**没把已有的主体模型接上**。这是个小得多的缺口。
（改造方案见 `Merchant_Voucher_Compliance_Design_2026-09-20.md`。）

### 4.2 已有资产：实名 + 税务身份（但只覆盖 agent）

`internal/supply/seller_identity.go` + `migrations/084_seller_real_name.sql`（COMP-SELLER-001）已经按越南电商法 122/2025 与 NĐ 248/2026（2026-07-01 生效）实现了「收钱的人必须可识别且绑定税务身份（MST）」：

- `supply.seller_real_name_verifications` 有 `tax_code`（MST）、`id_number_hash`（只存哈希）、`verified_by`/`verified_at`、`expires_at`（**过期 ≠ 已核验**）；
- 判定函数 fail-closed：lookup 为 nil / agentID 为空 / 查询报错 → 一律「未核验」（`seller_identity.go:42–55`）。

**但它的主体是 `agent_id`（供给侧的个体卖家），不是商户。** 平台采购商户的券时，付款对象是**商户主体**（`business.accounts`），需要的是**商户级的**实名 + MST + 发票能力——`084` 的形状可以直接复用，但要么新建一张商户级核验表，要么把商户建成 `agent_id` 的一种。**这是第二层合规里最容易被漏掉的一条**：`COMP-SELLER-001` 看起来已经覆盖了「收钱的人必须实名」，但它管的是个体卖家，不管商户。

### 4.3 采购本身没有任何痕迹

「平台向商户采购」在代码里**不存在**：全仓 grep `采购` / `purchase` 在 Go 里**零命中**。没有采购单、没有合同、没有发票、没有代扣。当前 `voucher` 的成本拆分是硬编码百分比（`service.go:354`），`benefit` 是硬编码常量（`service.go:479–482`），两者都不是采购关系。

### 4.4 与「平台不碰钱」的冲突

`migrations/018_payment_ledger.sql` 是教科书式的托管（escrow）：

```sql
entry_type IN ('DEBIT_REQUESTER','CREDIT_HOLD','DEBIT_HOLD','CREDIT_AGENT','CREDIT_REFUND','DEBIT_REFUND')
payout_holds.status IN ('HELD','RELEASED','FAILED')
```

`CREDIT_HOLD` + `payout_holds` 意味着平台**替双方持有资金**。这与你已确认的「核心确实不想碰钱」直接冲突。按你的决定，这里要改的是**语义而非删表**：资金在平台外的通道（VNPAY/MoMo/cash）里流转，平台账本只记**应收应付**，不记「我持有了多少」。

---

## 5. 你的决定落到代码上意味着什么

已确认：**平台不碰钱**；但**记账照做，金融级，且与普通数据隔离**。

三条推论，按依赖顺序：

1. **账本要有主体和方向。** 「谁欠谁」需要 `(payer, payee, direction, amount, currency, occurred_at, source_ref)`。现有的 `voucher.settlements`（无方向、对手方是消费者自己）与 `benefit.settlements`（无方向、只有 ActorType）都**不能**演变成这个形状——它们是分配记录，不是账本。
2. **要按你的话物理隔离。** 独立的 schema（如 `ledger`）、独立的表、独立的写入路径，不与 `voucher` / `benefit` 混在一起；且**账本写入不允许吞错**（当前四处 `_ =` 必须改成失败即回滚）。
3. **两套券系统必须先定正本。** 在双系统并存的前提下建账本，等于给两套语义各记一本账，对账时无法收敛。

第二层的资金流方向（平台采购商户的券）与现在代码的方向（折扣 100% 记平台、商家 0）**相反**。这不是参数问题，是模型问题——`MerchantContribMinor: 0` 这行是符号错误，不是配置错误。

---

## 6. 待你拍板

我不替你做产品形态决定。按依赖顺序：

1. **两套券系统，哪一套是正本？** `voucher`（有持久化、无商户归属）还是 `benefit`（有商户归属模型、无持久化）？这个决定决定了后面所有工作量落在哪。
2. **商户主体怎么建模？** 复用 `084` 的实名+MST 形状新建商户主体表，还是把商户建成 `agent_id` 的一种？（影响 §4.2 的复用程度）
3. **`018` 的托管语义怎么改？** 改成纯应收应付（保留表、改 `entry_type` 语义），还是新开一张非托管账本、`018` 只留审计用途？
4. **V-2 的 actor 错位怎么处理？** 结算改成按 `voucher_id` 定位（需要券表加唯一索引）还是引入独立的结算 worker 按事件驱动？
5. **B-5 的四个洞什么时候修？** 现在收在 operator 门里是安全的；但只要你开始做「商家自建活动」，它就必须先变成主体成员校验。

---

## 附：复核命令

```bash
cd ~/work/kake/apps/api-go

# 两套系统各自的持久化现状
ls internal/platform/postgres/ | grep -i -e voucher -e benefit   # 只有 voucher
grep -rn "NewMemoryRepository" cmd/api/main.go                    # benefit 是内存

# 商户主体不存在（命中全是内容侧字符串）
grep -rn '"MERCHANT"' --include="*.go" . | grep -v _test.go

# 采购不存在
grep -rn "采购\|purchase" --include="*.go" . | grep -v _test.go   # 零命中

# 成本拆分符号
sed -n '477,482p' internal/benefit/service.go                     # MerchantContribMinor: 0

# 预算不设防
grep -rn "BudgetMinor\|SpentMinor" --include="*.go" . | grep -v _test.go

# 账本写入吞错
grep -rn "_ = s.repo.CreateSettlement" --include="*.go" .

# 死码
cat internal/voucher/fraud.go                                     # 5 行，零调用

# 券来自硬编码种子
sed -n '357,371p' internal/voucher/service.go                     # 3 行种子，每个 actor 各一份

# operator 门
grep -n "Voucher\|Campaign\|AllocateBenefit" internal/api/security.go

# 客户端调用了、但被门挡住的命令（实测 7 条）
grep -rhoE 'command\("[A-Za-z]+"' apps/mobile/src | sed 's/.*"\(.*\)"/\1/' | sort -u > /tmp/c.txt
grep -oE '^\t"[A-Za-z]+":' internal/api/security.go | sed 's/[\t":]//g' | sort -u > /tmp/o.txt
comm -12 /tmp/c.txt /tmp/o.txt
```

其中「客户端调用了但被门挡住」实测为 7 条：

```
ConfirmPaymentIntent  CreateVoucher  DecideStoreRecommendation
ListStoreRecommendations  RefundPaymentIntent  SettleVoucher  VerifyCapability
```

可达性：`SettleVoucher`（`surfaces/voucher.tsx:100`）与 `ListStoreRecommendations` + `DecideStoreRecommendation`（`surfaces/store-recommendation-queue.tsx:102,143`，经 `surfaces/me.tsx:2603` 挂载）**有真实 UI 入口**，因此这三个是用户可见的死路；其余四条只存在于 `*-client.ts`，无 surface 调用方，属未接线的半截通道。

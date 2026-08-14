# Proxy PRD v1.1

## Chapter 35 — Multi-Market Legal Entity / Tax / Currency / Settlement Governance

**文档类型**：Legal Entity / Market Tax / Currency / FX / Payment Rail / Invoice / Settlement / Reconciliation / Financial Close  
**状态**：ACTIVE — Multi-Market Expansion / Financial Operations Readiness  
**依赖**：Chapter 27 Provider Integration / Market Launch Readiness、Chapter 30 Scale Architecture / Capacity / FinOps / Multi-Region Readiness、Chapter 31 Enterprise / B2B Scale / Contract Governance、Chapter 32 Enterprise API / SSO / SCIM / Integration Contract、Chapter 33 Enterprise Migration / Adoption / Renewal Governance、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance  
**后续**：Chapter 36 Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance

---

# 0. 本章目标

Proxy 进入多个 Market 后，同一个 Business、Enterprise、Order、Payment 或 Payout 可能同时涉及：

- 不同的 contracting entity、billing entity、collecting entity、payout entity；
- 不同的税务登记、税率、免税证明、发票格式和申报周期；
- 不同的 quote currency、contract currency、transaction currency、settlement currency、reporting currency；
- 不同的 Payment rail、Provider settlement account、cut-off time、reserve、refund 和 dispute 规则；
- 不同的 Region、DataResidencyZone、MarketCell 和 Ledger single-writer owner。

本章把这些差异收口到版本化、可审计、不可静默覆盖的事实链：

```text
Market / Customer / Business Context
→ Legal Entity Assignment
→ Tax Determination
→ Price / Currency / FX Resolution
→ Payment Intent / Funding
→ Order / Fee / Tax / Ledger Facts
→ Invoice / Credit Note
→ Settlement Instruction
→ Provider Settlement
→ Reconciliation
→ Remittance / Financial Close
→ Audit / Reporting / Renewal Evidence
```

本章必须解决：

- 每个交易在什么 Market、由哪个 Legal Entity 承担什么角色；
- Tax、Currency、FX 和 Invoice 如何绑定到 transaction snapshot；
- Payment authorization、refund、payout、settlement、remittance 与 Ledger 如何分层；
- Provider statement、bank / settlement account、Invoice、Tax register 与 Ledger 如何对账；
- 未知结果、重复 callback、FX 差异、税务修正、chargeback 和部分结算如何安全处理；
- Enterprise Contract 的 payment terms、credit limit、price schedule、tax clause 与实际资金事实如何连接但不越权；
- Legal Entity、Market、Provider、Region 或 Settlement Account 变化时如何迁移和退出。

本章不做：

- 不因为一个 Invoice、PurchaseOrder、TaxDetermination 或 SettlementRecord 就自动制造 Ledger 余额；
- 不把 Contract、CreditLimit 或 BudgetReservation 当成 FundingSecured；
- 不用最新 FX rate 覆盖历史 Payment、Invoice、Tax 或 Ledger 金额；
- 不因 Provider settlement 成功就绕过 Payment、Payout、KYC、Safety、Sanctions 或 Ledger gate；
- 不把跨市场汇总报表当作交易事实；
- 不因 Legal Entity 变更而改写既有 Order、Payment、Payout、Invoice、Tax、Audit 或 LegalHold 历史归属。

## 0.1 核心定义

```text
Legal Entity = 承担合同、税务、收款、付款或申报角色的法定主体
Market = 产品、法律、税务、币种、Provider 和支持规则的配置边界
Transaction Currency = 交易事实记录的金额币种
Settlement Currency = Provider / account 实际结算币种
Reporting Currency = 管理或财务报表汇总币种
Tax Determination = 针对特定 source、scope、period 的税务判断
Invoice = 对客户或收款方的账单 / 税务文件，不等同于 Ledger mutation
Settlement = Provider / bank / account 层的资金结算过程
Reconciliation = 多个事实来源的匹配、差异、解释和处置
Financial Close = 对指定 period 的账务、税务、发票和结算状态进行冻结与审计
```

## 0.2 Money Truth 分层

| 层级 | 事实 | 是否可改写 |
|---|---|---|
| Quote / Estimate | 面向用户或 Enterprise 的预估价格、税、FX | 可在 commit 前重新计算，但必须显示版本 |
| Contract Price | Contract / PriceSchedule 中约定的价格和条款 | 只能通过新版本或 amendment 变更 |
| Payment Intent | 授权、capture、refund、provider operation 的状态 | 由 Payment Domain 管理，不由 Invoice 覆盖 |
| Order / Fee / Compensation | 交易、平台费、补偿、税前金额等 Domain facts | 通过 owned command 和 correction 处理 |
| Ledger | 不可变借贷或余额事实 | 不允许数据库覆盖；只能追加 correction / reversal entry |
| Invoice | 对客户 / 法人主体的账单与税务展示 | 通过 credit / debit note 修正，不静默修改已发送发票 |
| Provider Statement | Provider / bank / settlement account 的外部事实 | 原样保留并与本地事实对账 |
| Settlement | Provider 把金额结算到指定 account 或 account 间转移 | 有独立生命周期和 reconciliation |
| Reporting | 按 period、entity、market、currency 汇总的 read model | 可重算，不是交易 source of truth |

---

# 1. Multi-Market Money Constitution

## 1.1 Transaction Principal 仍由 BusinessAccount 决定

Chapter 31 的边界继续有效：

- `BusinessAccount` 仍是 Task、Order、Payment、Billing visibility 和交易历史的 Principal；
- `EnterpriseOrganization` 是商业、采购、治理和汇总层，不自动成为所有下属 Business 的交易 owner；
- Legal Entity 是合同、税务、收款、支付或申报角色，不是新的 UserAccount 或 BusinessAccount；
- 同一 Enterprise 可以拥有多个 BusinessAccount、Market、Legal Entity 和 BillingAccount；
- 一个 Legal Entity 可以服务多个 Business，但每笔交易必须保留当时的 assignment snapshot。

## 1.2 Legal Entity 先于 Tax / Invoice / Settlement

在以下动作前，系统必须已解析并冻结适用的 Legal Entity Assignment：

- 生成最终 TaxDetermination；
- 创建需要确定税务主体的 Invoice；
- 提交 Payment capture 或 payout / settlement instruction；
- 创建法定申报或 remittance record；
- 将 Enterprise Contract 的 price / tax / payment terms 绑定到交易。

如果 Legal Entity assignment 未确定或存在冲突，系统只能返回 `ENTITY_REVIEW_REQUIRED`、`PENDING` 或安全的人工路径。

## 1.3 Invoice 不是 Ledger

Invoice 可以表达：

- billed party、billing entity、line item、tax line、currency、due date；
- source Order、Payment、Fee、Service credit、CreditNote 或允许的 adjustment；
- 已支付、未支付、部分支付、逾期、void 等 billing 状态。

Invoice 不能单独：

- 创建收入、资产、负债或可用余额；
- 证明 Payment 已成功；
- 证明税款已经 remitted；
- 释放 Payout 或 Funding；
- 改写 Ledger、Order 或 Payment 历史。

## 1.4 Tax 不是装饰字段

税务结果必须有：

- source transaction / line；
- seller / service provider entity；
- customer / recipient classification；
- supply type；
- origin / destination；
- market and tax rule version；
- registration / exemption / reverse charge evidence；
- rate、base、amount、currency、rounding；
- determination method、confidence 和 limitation。

没有足够输入时不得默认为 zero tax，除非 `TaxRuleSet` 明确规定该类 supply 为 zero-rated / exempt，并记录规则版本。

## 1.5 Currency 是多个字段，不是一个 currency enum

每个 Money fact 必须明确其语义：

```text
display_currency
quote_currency
contract_currency
transaction_currency
authorization_currency
invoice_currency
settlement_currency
reporting_currency
```

字段不能用一个“当前市场币种”隐式代替。跨币种转换必须记录原币种金额、目标币种金额、FX rate、source、time、rounding 和 conversion purpose。

## 1.6 Settlement 不改变原始金额

Provider 结算金额可能因以下原因与交易金额不同：

- Provider fee；
- FX conversion；
- withholding tax；
- reserve / rolling reserve；
- chargeback / dispute；
- refund；
- timing / cut-off；
- correction / adjustment；
- partial settlement。

这些差异必须以独立的 Fee、Tax、Reserve、Refund、Dispute、FX 或 Adjustment facts 表达，不能修改原始 Order、Payment 或 Ledger entry。

## 1.7 Single Writer 与 Region Ownership

Chapter 30 的 single-writer、home ownership、write epoch、fencing 继续适用于：

- Ledger aggregate；
- PaymentIntent operation；
- Payout；
- SettlementBatch；
- Invoice close / void；
- TaxFilingPeriod close；
- FinancialClose。

跨 Region 只能复制 read model 或受控的 proposal，不能对同一 money aggregate 无 fencing dual-write。

---

# 2. Legal Entity / Market Model

## 2.1 LegalEntity

```text
LegalEntity
├── id
├── legal_name
├── registration_number
├── entity_type: COMPANY / BRANCH / SOLE_PROPRIETOR / NONPROFIT / OTHER
├── incorporation_country
├── tax_residency_country_refs[]
├── registered_address_ref
├── status: DRAFT / ACTIVE / SUSPENDED / WINDING_DOWN / CLOSED
├── roles: CONTRACTING / SELLER / COLLECTING / BILLING / PAYOUT / TAX_REMITTING
├── bank_account_refs[]
├── tax_registration_refs[]
├── effective_from
├── effective_to?
├── compliance_scope_ref
├── owner_ref
└── audit_ref
```

LegalEntity 的名称、注册号和角色变更必须版本化。`CLOSED` entity 不能承接新交易，但仍可处理历史退款、税务申报、审计和 closeout。

## 2.2 LegalEntityAssignment

```text
LegalEntityAssignment
├── id
├── source_type: MARKET / ENTERPRISE / BUSINESS / ORDER / INVOICE / PAYMENT / PAYOUT
├── source_ref
├── market_ref
├── contracting_entity_ref?
├── seller_entity_ref?
├── collecting_entity_ref?
├── billing_entity_ref?
├── payout_entity_ref?
├── tax_remitting_entity_ref?
├── assignment_reason
├── rule_set_version
├── effective_at
├── snapshot_hash
├── status: PROPOSED / APPROVED / ACTIVE / SUPERSEDED / DISPUTED
└── audit_ref
```

Assignment 解决“哪个主体承担哪个角色”，但不自动表示该主体已经完成 KYC、税务注册、银行验证或 Provider onboarding。

## 2.3 MarketEntityProfile

每个 `MarketLaunchProfile` 必须绑定：

```text
MarketEntityProfile
├── market_ref
├── contracting_entity_ref
├── seller_entity_ref
├── collecting_entity_ref
├── billing_entity_ref
├── payout_entity_ref
├── tax_remitting_entity_ref
├── allowed_entity_substitutions[]
├── effective_from
├── effective_to?
├── required_registrations[]
├── required_payment_rails[]
├── required_invoice_format
└── approval_refs[]
```

Market 未绑定完整的 entity role matrix 时不能进入 `APPROVED` 或 `ACTIVE`。

## 2.4 Entity Role Separation

同一个 Legal Entity 可以承担多个角色，但每个角色都需要单独确认：

| 角色 | 主要事实 | 典型责任 |
|---|---|---|
| Contracting Entity | 与 Enterprise / Business 签约 | 合同、服务条款、争议主体 |
| Seller / Service Entity | 提供或销售服务 | 供应、税务、退款义务 |
| Collecting Entity | 接收客户付款 | Payment rail、资金保管、对账 |
| Billing Entity | 生成 Invoice / Credit Note | 发票格式、AR、税务文件 |
| Payout Entity | 向 Agent / Business / Provider 付款 | Payout rail、KYC、withholding |
| Tax Remitting Entity | 向税务机关申报 / 缴纳 | filing、remittance、证据 |

不允许通过默认值假设所有角色都由同一实体承担。

## 2.5 Legal Entity 生命周期

```text
DRAFT
  ↓ registration + ownership + market review
ACTIVE
  ├──→ SUSPENDED
  ├──→ WINDING_DOWN
  └──→ CLOSED
```

`SUSPENDED` 时：

- 禁止新交易绑定该 entity；
- 允许经过批准的历史 refund、payout correction、tax filing 或 legal response；
- 既有 Order、Payment、Invoice、Ledger、Audit 和 LegalHold 不被删除或改写；
- 触发 Market / Contract / Compliance change review。

## 2.6 Entity Change Gate

Legal Entity 新增、替换或关闭前必须检查：

- MarketLaunchProfile；
- TaxRegistration 与 tax residency；
- PaymentRailProfile 与 SettlementAccount；
- EnterpriseContract / DPA / invoice obligation；
- KYC / AML / sanctions / beneficial ownership；
- Provider / bank / payout capability；
- data residency / Region ownership；
- open Order、Payment、Refund、Payout、Invoice、TaxFiling、LegalHold；
- customer notification、migration、rollback 和 support。

---

# 3. Tax Governance

## 3.1 MarketTaxProfile

```text
MarketTaxProfile
├── id
├── market_ref
├── seller_entity_ref
├── tax_jurisdiction_refs[]
├── tax_regime: VAT / GST / SALES_TAX / WITHHOLDING / MIXED / NONE_APPROVED
├── default_tax_currency
├── inclusive_or_exclusive_default
├── taxable_supply_types[]
├── exempt_supply_types[]
├── zero_rated_supply_types[]
├── reverse_charge_rules[]
├── withholding_rules[]
├── invoice_requirements[]
├── filing_cadence
├── rounding_policy_ref
├── effective_from
├── effective_to?
├── legal_basis_refs[]
├── approval_refs[]
└── status: DRAFT / REVIEW / APPROVED / ACTIVE / EXPIRED / RETIRED
```

## 3.2 TaxRegistration

```text
TaxRegistration
├── id
├── legal_entity_ref
├── jurisdiction_ref
├── registration_type: VAT / GST / SALES_TAX / WITHHOLDING / OTHER
├── registration_number_masked
├── effective_from
├── effective_to?
├── verification_status: PENDING / VERIFIED / EXPIRED / REJECTED
├── evidence_ref
├── filing_frequency
└── audit_ref
```

Registration number可以在展示层 masked，但系统内部必须有受控 reference 和访问审计。Registration `PENDING` 不能被当成已注册事实。

## 3.3 TaxRuleSet

```text
TaxRuleSet
├── id
├── market_tax_profile_ref
├── version
├── effective_from
├── effective_to?
├── supply_type_rules[]
├── customer_type_rules[]
├── origin_destination_rules[]
├── registration_threshold_rules[]
├── exemption_rules[]
├── reverse_charge_rules[]
├── withholding_rules[]
├── rounding_rules[]
├── source_refs[]
├── approved_by[]
└── status: DRAFT / ACTIVE / SUPERSEDED / RETIRED
```

TaxRuleSet 采用 append-only version。修正税率必须创建新版本，并保留其生效时间与适用交易范围。

## 3.4 TaxDetermination

```text
TaxDetermination
├── id
├── source_type: ORDER / ORDER_LINE / FEE / INVOICE / PAYOUT / REFUND / CREDIT_NOTE
├── source_ref
├── legal_entity_assignment_ref
├── market_tax_profile_ref
├── tax_rule_set_ref
├── customer_type
├── customer_tax_registration_ref?
├── supply_type
├── origin_ref
├── destination_ref
├── exemption_evidence_ref?
├── reverse_charge_evidence_ref?
├── tax_lines[]
├── total_tax_amount
├── currency
├── determination_method: RULE / PROVIDER / MANUAL_REVIEW
├── confidence: HIGH / MEDIUM / LOW / REVIEW_REQUIRED
├── determined_at
├── effective_at
├── status: ESTIMATE / DETERMINED / OVERRIDDEN_APPROVED / REVERSED / SUPERSEDED / DISPUTED
└── audit_ref
```

## 3.5 TaxLine

```text
TaxLine
├── id
├── source_line_ref
├── jurisdiction_ref
├── tax_type
├── taxable_base
├── rate
├── tax_amount
├── currency
├── inclusive_flag
├── exemption_or_reverse_charge_code?
├── rounding_delta
├── rule_ref
└── audit_ref
```

TaxLine 的 `taxable_base + rate + rounding` 必须能重算出 `tax_amount`。不能只保存一个不可解释的 tax total。

## 3.6 Tax Determination 顺序

```text
Resolve Market
→ Resolve Legal Entity Roles
→ Resolve Customer / Principal Type
→ Resolve Origin / Destination
→ Resolve Product / Supply Type
→ Resolve Registration / Exemption Evidence
→ Select TaxRuleSet Version
→ Calculate Tax Lines
→ Apply Rounding
→ Record Determination
→ Bind to Invoice / Ledger / Settlement as allowed
```

## 3.7 Tax Estimate vs Final Tax

报价阶段可以生成 `ESTIMATE`，但必须：

- 显示 estimate 状态；
- 标记输入可能变化；
- 不把 estimate 当作法定 Invoice；
- 在 commit / invoice 前完成 final determination 或进入人工 review；
- 估算与最终税额不同步时，记录差异原因。

## 3.8 Tax Override

Tax override 只允许在：

- 有明确法律依据；
- 有 customer / exemption / reverse charge evidence；
- 指定 approver；
- 记录原始 rule result、新结果和 reason；
- 有 effective time 和 scope；
- 可被 re-test / audit。

前台、Enterprise Admin、Support 或 API Client 不能直接写任意税率。

## 3.9 Withholding

Withholding 不是普通 Platform Fee。必须单独记录：

- payer / payee entity；
- jurisdiction；
- base；
- rate；
- certificate / exemption；
- withheld amount；
- remittance recipient；
- filing period；
- Payout / Settlement reference。

Withholding 不能通过降低 Agent Earnings 的原始事实来隐藏；应通过独立 withholding line 和 Ledger entry 表达。

---

# 4. Currency / FX Governance

## 4.1 CurrencyProfile

```text
CurrencyProfile
├── id
├── currency_code
├── numeric_code
├── minor_unit
├── cash_rounding_unit?
├── supported_markets[]
├── supported_payment_rails[]
├── supported_settlement_accounts[]
├── reporting_currency_allowed
├── status: ACTIVE / RESTRICTED / RETIRED
├── effective_from
└── audit_ref
```

不同币种的小数位、现金 rounding、payment rail 支持和 reporting conversion 必须通过 CurrencyProfile 配置，不得写死在 UI。

## 4.2 Money Context

每个金额必须带：

```text
amount
currency
minor_unit
scale
money_type
source_ref
effective_at
```

`amount: 100` 不能脱离 currency、minor_unit 和 money_type 单独解释。

## 4.3 FXRateSet

```text
FXRateSet
├── id
├── source_type: CENTRAL_BANK / PROVIDER / MARKET_DATA / TREASURY / MANUAL_APPROVED
├── source_ref
├── base_currency
├── quote_currencies[]
├── rate_type: MID / BUY / SELL / AUTHORIZATION / SETTLEMENT / REPORTING
├── rate_timestamp
├── effective_from
├── effective_to
├── precision
├── fallback_policy_ref
├── integrity_hash
├── approval_ref?
└── status: DRAFT / ACTIVE / EXPIRED / REVOKED
```

## 4.4 FXRateQuote

```text
FXRateQuote
├── id
├── source_currency
├── target_currency
├── source_amount
├── quoted_amount
├── rate
├── rate_set_ref
├── fee_or_spread
├── quoted_at
├── expires_at
├── purpose: DISPLAY / QUOTE / AUTHORIZATION / REFUND / SETTLEMENT / REPORTING
├── locked: true / false
└── audit_ref
```

Quote 过期后必须重新报价或进入 review。不得在用户看不到的情况下用新 FX rate 扣除额外金额。

## 4.5 FX Conversion Fact

每次实际转换必须记录：

```text
MoneyConversion
├── source_amount / source_currency
├── target_amount / target_currency
├── rate_ref
├── fee_or_spread
├── rounding_delta
├── purpose
├── source_operation_ref
├── effective_at
└── audit_ref
```

原始 transaction currency 和授权金额不能因后续 reporting conversion 被覆盖。

## 4.6 FX Gain / Loss

Provider settlement、refund 或 close 产生的 FX difference：

- 使用独立 `FX gain/loss` 或 approved adjustment category；
- 引用原始 Payment / Settlement / Invoice / Ledger；
- 保留 rate source、time、calculation；
- 不修改原始金额；
- 在 reporting currency 中汇总时允许重算，但不能改变 source fact。

## 4.7 Rounding

Rounding 必须明确：

- per line 还是 invoice total；
- tax line 是否单独 rounding；
- half-up / half-even / floor / ceiling；
- cash rounding 是否只影响现金支付；
- residual rounding cents 归属于哪个 line / account；
- refund 是否沿用原始 rounding。

所有 rounding difference 都必须可解释，并能在 reconciliation 中匹配。

## 4.8 Reporting Currency

Reporting currency 只用于：

- management dashboard；
- budget / FinOps；
- financial reporting；
- cross-market aggregation。

Reporting currency 的转换不能：

- 改变用户看到的 contract / invoice currency；
- 改变 Payment authorization；
- 改变 Ledger source entry；
- 改变 Payout amount；
- 作为新的可用资金。

---

# 5. Payment Rail / Account Governance

## 5.1 PaymentRailProfile

```text
PaymentRailProfile
├── id
├── market_ref
├── legal_entity_ref
├── provider_connection_ref
├── payment_methods[]
├── authorization_currencies[]
├── capture_currencies[]
├── refund_currencies[]
├── payout_currencies[]
├── settlement_currencies[]
├── minimum_amount
├── maximum_amount
├── daily_limits
├── settlement_cutoff
├── settlement_delay
├── reserve_rules[]
├── dispute_rules_ref
├── idempotency_policy_ref
├── failover_mode
├── effective_from
├── effective_to?
├── approval_refs[]
└── status: DRAFT / SANDBOX / APPROVED / ACTIVE / DEGRADED / SUSPENDED / RETIRED
```

## 5.2 SettlementAccount

```text
SettlementAccount
├── id
├── legal_entity_ref
├── provider_connection_ref
├── market_refs[]
├── account_reference_masked
├── account_currency
├── account_country
├── account_type: BANK / WALLET / PROVIDER_BALANCE / ESCROW / OTHER
├── verification_status: PENDING / VERIFIED / EXPIRED / REJECTED
├── ownership_evidence_ref
├── residency_constraints[]
├── status: DRAFT / ACTIVE / HOLD / SUSPENDED / CLOSED
├── effective_from
├── effective_to?
└── audit_ref
```

SettlementAccount 只保存必要的 masked reference 和受控 provider reference，不保存完整 bank credential。

## 5.3 Payment Rail Approval

PaymentRailProfile 进入 `ACTIVE` 前必须通过：

- MarketLaunchProfile；
- Legal Entity Assignment；
- currency support；
- ProviderCapability；
- Payment authorization / capture / refund / payout sandbox；
- webhook signature、idempotency、timeout unknown；
- settlement statement format；
- reconciliation dry run；
- KYC / PayoutIdentity / sanctions requirements；
- data residency / provider data processing；
- support、incident、failover 和 rollback。

## 5.4 Payment Rail 不改变 Funding Order

资金主链继续是：

```text
Order / Commit
→ PaymentIntent
→ Provider Authorization / Capture
→ Funding Decision
→ FundingHold / Ledger
→ Order / Slot state
```

Provider `PAID`、Invoice `ISSUED`、PurchaseOrder `APPROVED` 或 Settlement `RECEIVED` 都不能单独跳过 Funding gate。

## 5.5 Provider Unknown Result

Payment、Refund、Payout、Settlement provider 返回 unknown 时：

- 不盲目重复 irreversible operation；
- 记录 ProviderPaymentOperation；
- 通过查询、statement 或 manual case reconcile；
- 必要时 hold 新 funding、refund 或 payout；
- 只有在明确的 idempotency / operation status 后才可继续；
- 不能把 UNKNOWN 强行改成 FAILED 或 SUCCESS。

## 5.6 Account Change

SettlementAccount 新增、替换、验证失败或关闭时：

- 新交易必须重新检查 Entity、Market、Currency、KYC / ownership 和 payout policy；
- 未结算 batch 必须明确 account handoff；
- 既有 provider statement 与 Ledger reference 不得换绑；
- 新账户不能自动获得历史 payout 的收款权；
- 替换操作需要 step-up、SoD、cooling period 或 manual review，按风险级别执行。

---

# 6. Invoice / Billing / Credit Governance

## 6.1 Existing Invoice Boundary

Chapter 31 的 `Invoice` 继续作为 Billing Domain 对象。本章为 Invoice 增加以下必须绑定的跨市场 context：

```text
Invoice
├── billing_entity_ref
├── seller_entity_ref
├── collecting_entity_ref?
├── market_ref
├── tax_determination_refs[]
├── invoice_currency
├── source_currency_refs[]
├── fx_conversion_refs[]
├── legal_format_version
├── payment_rail_ref?
├── settlement_account_ref?
├── period_start / period_end
└── financial_close_ref?
```

## 6.2 Invoice Generation Rules

生成最终 Invoice 前必须确认：

- source Order / Fee / Service credit 存在；
- transaction principal 与 billed party 清晰；
- billing / seller entity assignment 已批准；
- currency、rounding、tax determination 已确定；
- customer tax registration / exemption 已验证或标记 limitation；
- invoice number sequence 不冲突；
- market legal format 满足要求；
- source facts 没有被 void、reversed 或 dispute 阻断；
- 生成过程可重试且不重复开票。

## 6.3 InvoiceGenerationRun

```text
InvoiceGenerationRun
├── id
├── billing_account_ref
├── legal_entity_ref
├── market_ref
├── period_start
├── period_end
├── source_refs[]
├── tax_rule_set_refs[]
├── currency_policy_ref
├── idempotency_key
├── generated_invoice_refs[]
├── skipped_items[]
├── error_items[]
├── run_hash
├── status: DRAFT / RUNNING / PARTIAL / COMPLETE / FAILED / RECONCILIATION_REQUIRED
└── audit_ref
```

## 6.4 Invoice Lifecycle

```text
DRAFT
→ CALCULATED
→ REVIEW_REQUIRED
→ ISSUED
→ PARTIALLY_PAID / PAID / OVERDUE
→ VOIDED / CREDITED / CLOSED
```

已 `ISSUED` 的 Invoice 不得被静默编辑。金额、税、币种、主体或 source 发生变化时，走 CreditNote / DebitNote / InvoiceAdjustment。

## 6.5 InvoiceAdjustment

```text
InvoiceAdjustment
├── id
├── invoice_ref
├── adjustment_type: PRICE / TAX / FX / FEE / REFUND / SERVICE_CREDIT / ROUNDING / ERROR_CORRECTION
├── source_ref
├── original_amount / original_currency
├── adjustment_amount / adjustment_currency
├── reason_code
├── tax_recalculation_ref?
├── approval_refs[]
├── effective_at
├── status: DRAFT / APPROVED / ISSUED / APPLIED / REJECTED
└── audit_ref
```

## 6.6 CreditNote / DebitNote

```text
CreditNote
├── id
├── original_invoice_ref
├── source_ref
├── legal_entity_ref
├── tax_determination_ref
├── currency
├── amount
├── reason
├── issued_at
├── status: DRAFT / ISSUED / APPLIED / VOIDED
└── audit_ref
```

DebitNote 与 CreditNote 必须能追溯到原 Invoice、原始 source、税务重算和实际 refund / adjustment。不能直接删除错误发票以隐藏历史。

## 6.7 Payment Terms / Credit Limit

Payment terms 可以决定：

- due date；
- grace period；
- late fee；
- collection path；
- invoice currency；
- approved credit limit；
- allowed Payment rail。

但 payment terms、CreditLimit、PurchaseOrder 或 Invoice `ISSUED` 不能等同于：

- Payment authorized；
- FundingSecured；
- Ledger posted；
- payout eligible；
- Order completed。

---

# 7. Settlement Model

## 7.1 SettlementInstruction

```text
SettlementInstruction
├── id
├── source_type: PAYMENT / PAYOUT / REFUND / FEE / TAX / RESERVE / CHARGEBACK
├── source_ref
├── legal_entity_assignment_ref
├── source_amount / source_currency
├── settlement_amount / settlement_currency
├── fx_conversion_ref?
├── provider_connection_ref
├── settlement_account_ref
├── idempotency_key
├── requested_at
├── status: DRAFT / APPROVED / SUBMITTED / PROCESSING / SETTLED / UNKNOWN / FAILED / HELD / RECONCILIATION_REQUIRED / CANCELLED
├── hold_refs[]
└── audit_ref
```

## 7.2 SettlementBatch

```text
SettlementBatch
├── id
├── legal_entity_ref
├── market_ref
├── provider_connection_ref
├── settlement_account_ref
├── settlement_currency
├── cutoff_at
├── period_start / period_end
├── instruction_refs[]
├── gross_amount
├── fee_amount
├── tax_withheld_amount
├── reserve_amount
├── net_amount
├── statement_ref?
├── reconciliation_result_ref?
├── status: OPEN / CALCULATING / REVIEW_REQUIRED / APPROVED / SUBMITTED / PROCESSING / PARTIAL / SETTLED / FAILED / RECONCILIATION_REQUIRED / CLOSED
├── approved_by[]
└── audit_ref
```

## 7.3 SettlementRecord

```text
SettlementRecord
├── id
├── batch_ref
├── instruction_ref
├── provider_operation_ref
├── external_settlement_ref
├── source_ref
├── source_amount / source_currency
├── settled_amount / settlement_currency
├── provider_fee
├── tax_withheld
├── reserve_or_hold
├── fx_difference
├── bank_value_date
├── received_at
├── status: EXPECTED / RECEIVED / PARTIAL / MISMATCH / REVERSED / DISPUTED / CONFIRMED
└── audit_ref
```

## 7.4 Settlement Preflight

SettlementBatch 进入 `APPROVED` 前必须确认：

- batch 的 Legal Entity、Market、Currency、Provider 和 Account 一致；
- 所有 instruction 有 source reference 和 idempotency key；
- Payment / Payout / Refund 的 Domain status 允许 settlement；
- KYC / PayoutIdentity / hold / dispute / sanctions gate 满足；
- tax withholding、provider fee、reserve 和 rounding 可解释；
- batch 没有重复 instruction；
- expected amount 与 source / Ledger facts 可对账；
- operator、Finance、Risk / Compliance approvals 满足 SoD；
- provider statement format 和 cut-off 已确定。

## 7.5 Settlement Submission

提交顺序：

```text
Create Instruction
→ Validate Scope / Entity / Currency / Rail
→ Apply Hold / Eligibility
→ Create Batch
→ Reconcile Expected Amount
→ Approve Batch
→ Submit Idempotent Provider Operation
→ Receive Callback / Poll
→ Create SettlementRecord
→ Reconcile Statement / Ledger
→ Release or Preserve Hold
→ Close Batch
```

Provider 返回成功但本地未落记录时，状态为 `UNKNOWN` 或 `RECONCILIATION_REQUIRED`，不得重新提交同一资金操作。

## 7.6 Partial Settlement

部分结算必须拆分为独立 SettlementRecord，并明确：

- 已收到金额；
- 未收到金额；
- fee / tax / reserve 差异；
- 是否继续等待；
- 是否暂停后续 batch；
- source Ledger / Payment / Payout 的允许状态；
- operator owner 与 due date。

不能把 partial settlement 当成 full settlement，也不能自动把短款归为 Provider fee。

## 7.7 Payout Boundary

Payout 仍须满足 Chapter 27 的 gate：

- eligible Order / Compensation fact；
- no active dispute / hold；
- PayoutIdentity verified；
- Market / Payment rail / Currency 支持；
- tax / withholding 已确定；
- payout delay 和 approval 完成；
- provider operation 可幂等；
- settlement / reconciliation path 存在。

SettlementRecord `RECEIVED` 不会回头替代 Payout eligibility，也不能因为 batch 成功就自动解锁其他 payout。

---

# 8. Reconciliation / Financial Close

## 8.1 Reconciliation Sources

每个 Market / Entity / Currency / Provider 组合至少要对账：

```text
Order / Fee / Compensation source
PaymentIntent / Refund / Payout
Ledger entries
Invoice / CreditNote / DebitNote
Tax register / TaxDetermination
Provider operation / statement
SettlementAccount / bank statement
```

## 8.2 ReconciliationResult

Chapter 33 的 `ReconciliationResult` 可以被本章复用并扩展：

```text
ReconciliationResult
├── id
├── reconciliation_type: PAYMENT / INVOICE / TAX / SETTLEMENT / LEDGER / FX / FULL_CLOSE
├── scope: entity + market + provider + currency + period
├── source_snapshot_refs[]
├── expected_total
├── observed_total
├── matched_count
├── unmatched_count
├── difference_by_category[]
├── tolerance_policy_ref
├── checksum_refs[]
├── owner_ref
├── status: PASS / PASS_WITH_EXCEPTION / FAIL / INCOMPLETE
├── finding_refs[]
├── completed_at
└── audit_ref
```

## 8.3 Match Keys

优先使用：

- internal operation id；
- provider operation id；
- external settlement id；
- invoice number / credit note number；
- Ledger entry reference；
- amount、currency、value date、entity、market 的受控组合。

只按金额、日期或 display name 匹配不足以确认同一资金事实。

## 8.4 Difference Categories

```text
MISSING_LOCAL_RECORD
MISSING_PROVIDER_RECORD
AMOUNT_MISMATCH
CURRENCY_MISMATCH
FX_DIFFERENCE
FEE_DIFFERENCE
TAX_DIFFERENCE
ROUNDING_DIFFERENCE
TIMING_DIFFERENCE
DUPLICATE_OPERATION
WRONG_ENTITY
WRONG_ACCOUNT
WRONG_MARKET
UNKNOWN_RESULT
REVERSAL_NOT_LINKED
```

每个 difference 必须有 owner、severity、due date、hold decision 和 resolution path。

## 8.5 Tolerance

Tolerance 只适用于明确的 rounding、timing 或 provider documented difference：

- 必须按 currency、entity、market、operation type 配置；
- 必须有 legal / finance owner approval；
- 不得用 tolerance 掩盖重复扣款、错误主体、错误账户或未授权 payout；
- tolerance 通过时仍保留原始 difference 和计算方法；
- 超出 tolerance 时进入 `FAIL` 或 `RECONCILIATION_REQUIRED`。

## 8.6 SettlementDisputeCase

```text
SettlementDisputeCase
├── id
├── reconciliation_result_ref
├── source_refs[]
├── dispute_type: AMOUNT / DUPLICATE / WRONG_ACCOUNT / WRONG_ENTITY / UNKNOWN / CHARGEBACK / TAX / FX
├── amount / currency
├── severity: P0 / P1 / P2 / P3
├── owner_ref
├── hold_refs[]
├── provider_case_ref?
├── customer_notification_required
├── status: OPEN / INVESTIGATING / PROVIDER_QUERY / CUSTOMER_QUERY / ADJUSTMENT_PENDING / RESOLVED / REJECTED / CLOSED
├── resolution_ref?
└── audit_ref
```

## 8.7 FinancialClose

```text
FinancialClose
├── id
├── legal_entity_ref
├── market_ref
├── reporting_currency
├── period_start / period_end
├── invoice_close_status
├── tax_close_status
├── settlement_close_status
├── ledger_close_status
├── reconciliation_result_refs[]
├── open_case_refs[]
├── approved_exceptions[]
├── close_decision: OPEN / CONDITIONAL / CLOSED / REOPENED
├── owner_ref
├── approved_by[]
├── closed_at?
└── audit_ref
```

FinancialClose `CLOSED` 后，发现新事实必须通过 `REOPENED`、adjustment、credit / debit note 或 correction entry 处理，不得修改原始 period snapshot。

## 8.8 Close Gate

Period close 前必须确认：

- Payment / Refund / Payout / Settlement unknown backlog；
- Invoice generation / delivery / void / credit note；
- TaxDetermination、withholding、remittance；
- Provider / bank statement；
- Ledger balance与 source totals；
- FX rate、rounding 和 fee；
- open dispute、legal hold、incident；
- material exceptions 与 ComplianceReview；
- reporting currency conversion；
- evidence、approver 和 checksum。

存在未解释的 P0 / material mismatch 时，close 必须为 `CONDITIONAL` 或 `OPEN`，不得显示为无条件 CLOSED。

---

# 9. Refund / Chargeback / Dispute / Correction

## 9.1 Refund

Refund 必须引用原始：

- PaymentIntent / capture；
- Order / Invoice；
- TaxDetermination；
- LegalEntityAssignment；
- Currency / FX snapshot；
- Provider operation；
- Ledger correction path。

Refund 是新的 Payment operation，不是把原 Payment 金额改小。退款税务影响必须生成新的 TaxDetermination 或 approved reversal / adjustment。

## 9.2 Cross-Currency Refund

必须明确：

- refund 是否使用原 authorization currency；
- provider 是否按 settlement currency 退款；
- FX rate 采用原始 rate、当前 rate 或 Provider 规则；
- FX difference 由谁承担；
- customer-facing amount；
- tax / invoice correction；
- fee 是否退回；
- rounding。

没有明确规则时不得对用户展示“全额退款”但实际扣除未披露的 FX / fee。

## 9.3 Chargeback / Dispute

Chargeback / dispute 必须独立于普通 refund：

- 记录 provider / network case；
- preserve evidence、Order、Consent、Delivery、Safety 和 communication facts；
- 按 dispute 状态设置 hold / reserve；
- 不自动关闭 Order 或删除 Ledger；
- 记录 representment、deadline、owner、outcome；
- 结论变化时通过 adjustment / reversal entry 表达。

## 9.4 Wrong Entity / Wrong Tax

发现发票或交易绑定错误 entity / tax rule 时：

1. 标记影响范围和 effective time；
2. 停止继续使用错误配置；
3. 保护已产生的 Payment、Order、Ledger、Invoice 和 Audit facts；
4. 由 Finance / Legal / Compliance 决定 correction、credit / debit note、reissue 或 filing amendment；
5. 记录新旧 assignment、原因和客户通知；
6. 完成 reconciliation 与 closeout。

禁止直接更新历史记录中的 entity_ref 或 tax amount 以“修正”历史。

## 9.5 Provider Reversal

Provider reversal / settlement reversal 必须：

- 关联原 provider operation；
- 记录发生时间与 provider reason；
- 通过独立 Payment / Refund / Ledger correction；
- 重新计算 invoice / tax / settlement impact；
- 根据风险 hold payout / funding；
- 完成 customer / Enterprise notification decision。

---

# 10. Tax Filing / Remittance / Financial Evidence

## 10.1 TaxFilingPeriod

```text
TaxFilingPeriod
├── id
├── legal_entity_ref
├── jurisdiction_ref
├── tax_type
├── period_start / period_end
├── filing_due_at
├── source_snapshot_refs[]
├── taxable_base
├── output_tax
├── input_tax_credit?
├── withholding_amount?
├── adjustments[]
├── filing_reference?
├── remittance_record_refs[]
├── reconciliation_result_ref
├── status: OPEN / CALCULATING / REVIEW_REQUIRED / FILED / REMITTED / AMENDED / CLOSED / DISPUTED
├── owner_ref
└── audit_ref
```

## 10.2 RemittanceRecord

```text
RemittanceRecord
├── id
├── tax_filing_period_ref
├── legal_entity_ref
├── authority_ref
├── amount / currency
├── payment_reference
├── payment_operation_ref
├── submitted_at
├── confirmed_at?
├── status: PREPARED / SUBMITTED / CONFIRMED / FAILED / UNKNOWN / RECONCILIATION_REQUIRED
└── audit_ref
```

Remittance `SUBMITTED` 不等于税务机关已确认。`UNKNOWN` 必须通过 authority / bank / provider reconcile。

## 10.3 Filing Gate

TaxFilingPeriod 进入 `FILED` 前：

- scope、entity、jurisdiction、period 已锁定；
- source invoice、credit / debit note、withholding、refund 和 settlement 可追溯；
- reconciliation 有结论；
- manual adjustments 有批准；
- material difference 已披露；
- Compliance / Legal / Finance reviewer 满足 SoD。

## 10.4 Tax Correction

申报后发现错误：

- 建立 amended filing 或 correction；
- 关联原 filing、invoice、tax line 和 Ledger adjustment；
- 保留原始 filing；
- 记录 authority / customer notification；
- 更新相关 Trust / Compliance evidence 的 limitation；
- 不直接覆盖原始 tax total。

## 10.5 Financial Evidence

Chapter 34 的 ComplianceEvidence 可引用本章的：

- TaxFilingPeriod；
- RemittanceRecord；
- ReconciliationResult；
- FinancialClose；
- provider statement checksum；
- invoice / credit note register。

但合规 evidence 只是对控制的证明，不替代本章的财务 source of truth。

---

# 11. Enterprise Contract / Billing Integration

## 11.1 Contract Binding

EnterpriseContract 的以下字段必须与本章对象绑定：

```text
contract_currency
price_schedule_version
tax_treatment
invoice_entity
payment_terms
credit_limit
settlement_terms
refund_terms
service_credit_terms
data_residency_or_market_scope
effective_from / effective_to
```

Contract 未明确的部分必须由 Market / Policy / Legal review 解决，不能由前端或 Billing worker 猜测。

## 11.2 Price Schedule

Price Schedule 必须记录：

- product / service / unit；
- base currency；
- inclusive / exclusive tax；
- tier、minimum、maximum、commit；
- Enterprise discount；
- usage meter reference；
- rounding；
- effective period；
- market / entity scope；
- approval。

Price schedule 的变更通过新 Contract / amendment / Policy version 生效，不能回写已 committed Order。

## 11.3 Service Credit

Service credit 是合同 / Billing adjustment：

- 引用 SLA measurement；
- 绑定 Invoice / CreditNote / Contract；
- 有 Finance / Contract approval；
- 记录 currency、tax impact、effective period；
- 不修改 Agent Earnings、Order completion、Payment success 或 immutable Ledger fact。

## 11.4 Credit Limit / BudgetReservation

CreditLimit 和 BudgetReservation 只能限制或允许下一笔交易的尝试：

- 不能把 credit limit 当现金；
- 不能把 PurchaseOrder 当 Payment authorization；
- 不能让两个 PaymentIntent 消费同一 reservation；
- 不能因 Contract renewal 自动增加 budget；
- 不能在 settlement mismatch 时强行释放未确认资金。

## 11.5 Enterprise Statement

Enterprise Statement 可以汇总：

- Invoice；
- Payment；
- Refund；
- CreditNote / DebitNote；
- Service credit；
- outstanding balance；
- currency conversion；
- tax / fee summary。

Statement 必须显示是 reporting view 或 billing statement，并提供 source refs。Statement 不是 Ledger 的替代品。

---

# 12. Multi-Region / Residency / Settlement Handoff

## 12.1 Home Ownership

以下对象必须有 home Region / MarketCell：

- LegalEntityAssignment；
- PaymentIntent；
- Payout；
- SettlementBatch；
- Invoice sequence；
- TaxFilingPeriod；
- FinancialClose。

Read replica 可以跨 Region 使用，但 write 必须路由到 owner region，并使用 epoch / fencing。

## 12.2 Settlement Region Transfer

Region / MarketCell 转移前：

1. freeze new instructions；
2. fence old writer；
3. classify open Payment / Refund / Payout / Settlement / Tax / Invoice；
4. reconcile provider unknown；
5. transfer ownership with new epoch；
6. verify residency and provider route；
7. resume only approved operation types；
8. record handoff decision。

不能通过 DNS 切换或复制数据库直接把 money write owner 迁到新 Region。

## 12.3 Data Residency

跨境传输必须检查：

- D0–D5 分类；
- Market / Legal Entity；
- Provider / subprocessor；
- purpose / consent / legal basis；
- contract / DPA；
- tax / invoice retention；
- audit / LegalHold；
- encryption / access / deletion。

Reporting aggregate 也不能自动绕过 residency。脱敏、聚合、区域汇总必须有 policy 和 evidence。

## 12.4 Handoff Invariants

```text
No duplicate SettlementInstruction
No duplicate Payment / Refund / Payout operation
No split-brain Ledger write
No invoice sequence collision
No entity role ambiguity
No tax filing period duplication
No raw sensitive data transfer without approval
No historical source_ref rewrite
```

---

# 13. Migration / Entity Change / Exit

## 13.1 Cross-MarketMigrationProgram

Chapter 33 的 MigrationProgram 可以扩展以下 financial workstream：

```text
financial_migration_workstream
├── legal_entity_mapping
├── tax_registration_mapping
├── market_tax_rule_mapping
├── currency / fx mapping
├── payment_rail_mapping
├── settlement_account_mapping
├── invoice_sequence_mapping
├── open_payment / refund / payout mapping
├── provider_statement mapping
├── tax_filing / remittance mapping
├── ledger ownership handoff
└── closeout / rollback
```

## 13.2 Historical Data Rule

迁移不得把：

- 旧 Invoice 当作新 Invoice 重新开具而无 source link；
- 旧 tax flag 当作当前 registration；
- 旧 settlement amount 当作当前 Ledger；
- 旧 currency total 直接转换后覆盖原金额；
- 旧 provider success 当作当前 Payment success；
- 旧 payout record 当作新 account 的 payout entitlement。

历史事实默认 reference-only，除非通过 approved mapping 和 reconciliation 被明确导入。

## 13.3 Entity Replacement

Legal Entity replacement 必须定义：

- old entity / new entity；
- effective timestamp；
- new contract / amendment；
- open transaction handling；
- invoice / tax correction；
- Payment / Refund / Payout route；
- settlement account；
- customer notice；
- filing / remittance；
- data retention / residency；
- rollback / legal limitation。

## 13.4 Entity Winding Down

WINDING_DOWN entity 可以处理：

- 已承诺的退款；
- 未完成的 payout / settlement reconciliation；
- tax filing / remittance；
- invoice correction；
- provider dispute；
- audit / legal response；
- retention / LegalHold。

不得承接未批准的新 Market、Order、Payment、Payout 或 Invoice。

## 13.5 Cross-Market Exit

Market 或 Legal Entity 退出时，ExitPlan 必须列出：

- new transaction stop time；
- existing Order safe handling；
- Payment / Refund / Chargeback；
- Payout / Settlement；
- Invoice / CreditNote；
- Tax filing / remittance；
- provider account close；
- customer / Enterprise communication；
- data export / deletion / LegalHold；
- support / incident owner；
- final FinancialClose；
- audit and evidence retention。

Exit 完成不等于删除历史金额、税务、发票、结算或 Ledger facts。

---

# 14. Operational Governance

## 14.1 Daily Money Operations

- Payment / Refund / Payout / Settlement unknown result；
- duplicate operation detection；
- account / rail / provider status；
- batch cut-off and pending amount；
- payout holds、dispute、chargeback；
- tax registration / certificate expiry；
- invoice generation failure；
- material reconciliation mismatch；
- wrong entity / wrong currency / wrong market signal。

## 14.2 Weekly Review

- Payment / Settlement reconciliation by entity / market / currency；
- provider statement vs Ledger；
- refund / chargeback aging；
- tax determination override；
- FX spread / rounding / fee variance；
- open SettlementDisputeCase；
- invoice delivery / overdue / credit note；
- Legal Entity / rail / account change；
- Enterprise credit / contract scope。

## 14.3 Monthly Close

- Invoice and credit / debit note close；
- TaxFilingPeriod calculation；
- withholding and remittance；
- Payment / Payout / Settlement reconciliation；
- FX and reporting conversion；
- open cases and exceptions；
- FinancialClose decision；
- Chapter 34 evidence collection。

## 14.4 Quarterly / Annual

- MarketTaxProfile / TaxRuleSet review；
- Legal Entity registration and ownership；
- PaymentRailProfile / ProviderCapability；
- SettlementAccount ownership and bank confirmation；
- pricing / Contract / payment terms；
- financial close quality；
- disaster recovery and region handoff；
- external assurance / tax audit readiness；
- renewal / expansion / exit planning。

---

# 15. Access / SoD / Audit

## 15.1 Roles

| 角色 | 可做 | 不可做 |
|---|---|---|
| FinanceOwner | entity、tax、currency、close policy | 单独修改 Ledger 或批准自己的 material adjustment |
| TaxOwner | TaxRuleSet、TaxDetermination、filing | 直接改变 Payment / Payout status |
| PaymentsOwner | PaymentRail、provider operation、settlement | 绕过 KYC、Sanctions 或 Ledger gate |
| SettlementOperator | batch、instruction、statement reconcile | 单独更换 SettlementAccount 或关闭 dispute |
| BillingOwner | Invoice、CreditNote、Statement | 以 Invoice 伪造 Payment / Ledger |
| TreasuryOwner | account、FX、liquidity、reserve | 修改原始 transaction amount |
| LegalReviewer | entity、tax basis、contract、market | 代替 Finance 录入资金事实 |
| ComplianceReviewer | control、evidence、exception、audit | 扩大交易权限或发布未经批准数字 |
| EnterpriseViewer | 查看绑定的 billing / statement / package | 查看其他 Enterprise 或 raw bank data |
| ExternalAssessor | 授权 scope 内查验 | 写入 entity、tax、Payment、Ledger 或 settlement |

## 15.2 Sensitive Operations

以下操作需要 step-up、purpose、SoD 和 Audit：

- 新增或替换 SettlementAccount；
- 改变 LegalEntityAssignment；
- TaxRuleSet / tax override；
- 修改 FX source / fallback；
- 批准 SettlementBatch；
- 生成 CreditNote / DebitNote；
- 关闭 FinancialClose；
- 重新打开已关闭 period；
- 批量 payout / refund；
- export bank / tax / invoice package；
- 修改 Enterprise credit / payment terms。

## 15.3 Audit Events

必须记录：

- actor / principal / delegated context；
- entity、market、currency、provider、account scope；
- before / after references；
- reason、approval、effective time；
- idempotency key；
- source version；
- result / failure / unknown；
- downstream reconciliation / case reference。

原始 bank credential、完整 Payment credential 和 provider secret 不进入 Audit event。

---

# 16. API / Command / Event Contract

## 16.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `CreateLegalEntity` | Legal / Finance | 创建待审核主体 |
| `ApproveLegalEntity` | Authorized approver | 激活主体及角色 |
| `AssignLegalEntity` | Finance / Legal | 创建 assignment snapshot |
| `ApproveMarketEntityProfile` | Market / Legal / Tax | 绑定 market entity matrix |
| `DetermineTax` | Tax engine / Tax owner | 创建 TaxDetermination |
| `ApproveTaxOverride` | Tax / Legal | 记录有限 scope 的 override |
| `CreateFXRateSet` | Treasury | 发布版本化 rate set |
| `QuoteFX` | Pricing / Payment | 创建有 expiry 的 quote |
| `ApprovePaymentRail` | Payments / Market | 激活 payment rail |
| `VerifySettlementAccount` | Finance / Risk | 允许 account 使用 |
| `GenerateInvoice` | Billing | 创建 Invoice 或 run result |
| `IssueCreditNote` | Billing / Finance | 创建修正文件 |
| `CreateSettlementBatch` | Settlement | 创建待审核 batch |
| `ApproveSettlementBatch` | Finance / Payments | 允许提交 batch |
| `SubmitSettlementInstruction` | Payments | 幂等提交 provider operation |
| `ReconcileSettlement` | Settlement / Finance | 生成 reconciliation result |
| `OpenSettlementDispute` | Finance / Support | 创建差异 case |
| `CloseFinancialPeriod` | Finance | 创建 FinancialClose decision |
| `RecordTaxRemittance` | Tax / Finance | 记录 remittance result |
| `ReopenFinancialClose` | Finance / Legal | 有审计地重新打开 period |

## 16.2 P0 Events

```text
LegalEntityCreated
LegalEntityActivated
LegalEntitySuspended
LegalEntityAssignmentApproved
MarketEntityProfileApproved
TaxRegistrationVerified
TaxRuleSetActivated
TaxDeterminationRecorded
TaxDeterminationDisputed
FXRateSetPublished
FXQuoteCreated
PaymentRailActivated
SettlementAccountVerified
InvoiceGenerationCompleted
InvoiceIssued
InvoiceVoided
CreditNoteIssued
SettlementBatchCreated
SettlementBatchApproved
SettlementInstructionSubmitted
SettlementRecordReceived
SettlementRecordUnknown
SettlementReconciliationCompleted
SettlementDisputeOpened
FinancialCloseOpened
FinancialCloseCompleted
FinancialCloseReopened
TaxFilingPrepared
TaxRemittanceConfirmed
CrossMarketEntityChangeStarted
CrossMarketExitStarted
```

Event payload 只携带必要的 money metadata、references、scope、currency 和 totals。完整 bank credential、card data、raw tax document 或 provider secret 不进入 event。

## 16.3 Downstream Boundary

本章 events 可以触发：

- Invoice / Billing read model；
- TaxFilingPeriod；
- Settlement reconciliation；
- Chapter 34 ComplianceReview / Evidence；
- Enterprise RenewalReview；
- Support / Customer Success；
- Market pause / Provider incident；
- Financial reporting。

本章 events 不能未经 Payment、Ledger、Order、Payout、KYC、Safety 或 Contract owned command 直接修改其状态。

---

# 17. Acceptance Criteria

## AC-35-01 — Business Principal Preserved

多市场、Legal Entity、Invoice、Tax、Settlement 变化不得替换 BusinessAccount 作为 Task、Order、Payment 和交易历史的 Principal。

## AC-35-02 — Legal Entity Required

需要最终税务、开票、收款、付款或申报的交易必须有 approved LegalEntityAssignment；冲突时进入 review，不使用默认主体。

## AC-35-03 — Entity Role Matrix

每个 MarketLaunchProfile 必须明确 contracting、seller、collecting、billing、payout 和 tax-remitting entity 角色及 effective period。

## AC-35-04 — Entity Lifecycle

LegalEntity 的 DRAFT、ACTIVE、SUSPENDED、WINDING_DOWN、CLOSED 状态及新交易、历史退款、税务、审计处理边界必须可执行。

## AC-35-05 — Entity Change Gate

新增、替换或关闭 Legal Entity 前必须检查 TaxRegistration、PaymentRail、SettlementAccount、Contract、Provider、Residency、Open Money 和 LegalHold。

## AC-35-06 — Tax Rule Version

TaxRuleSet 必须版本化、带 effective time 和 source / approval；新规则不能覆盖旧 period 的 determination。

## AC-35-07 — Tax Determination Inputs

TaxDetermination 必须记录 entity、market、customer type、supply type、origin / destination、registration / exemption evidence、rule version 和 tax lines。

## AC-35-08 — No Silent Zero Tax

缺少税务输入时不得默认 zero tax，除非当前 TaxRuleSet 明确允许并记录适用规则。

## AC-35-09 — Tax Override Control

Tax override 必须有法律依据、原始结果、新结果、reason、scope、effective time、approver 和审计记录。

## AC-35-10 — Withholding Separate

Withholding 必须独立记录 payer、payee、jurisdiction、base、rate、amount、certificate、remittance 和 payout / settlement reference。

## AC-35-11 — Currency Context

每个金额必须明确 money type、currency、minor unit、scale、source reference 和 effective time；不能只保存裸数字。

## AC-35-12 — FX Versioned

FXRateSet 和 FXRateQuote 必须记录 source、rate type、timestamp、precision、expiry、fee / spread 和 fallback policy。

## AC-35-13 — FX No Historical Rewrite

后续 FX rate、reporting conversion 或 settlement difference 不得覆盖原始 Transaction、Payment、Invoice、Tax 或 Ledger 金额。

## AC-35-14 — Rounding Explainable

Tax、Invoice、Refund、Settlement 和 Reporting 的 rounding policy、residual、currency precision 和计算结果必须可重算。

## AC-35-15 — Payment Rail Approval

PaymentRailProfile 进入 ACTIVE 前必须完成 Market、Entity、Currency、Provider、Payment operation、reconciliation、KYC / payout、residency 和 failover checks。

## AC-35-16 — Settlement Account Verification

SettlementAccount 必须绑定 Legal Entity、Provider、Market、Currency、ownership evidence、verification status 和受控 masked reference。

## AC-35-17 — Funding Boundary

PurchaseOrder、Invoice、CreditLimit、Settlement received 或 Provider paid 不得单独被视为 FundingSecured、Payment success 或 Ledger posted。

## AC-35-18 — Invoice Traceability

Invoice line 必须可追溯到 Order、Payment、Fee、Tax、Service credit 或允许的 source；不得凭空生成应收。

## AC-35-19 — Invoice Immutable After Issue

已 issued Invoice 的主体、金额、币种、税和 source 变化必须通过 CreditNote、DebitNote 或 InvoiceAdjustment，不得静默覆盖。

## AC-35-20 — Idempotent Invoice Run

InvoiceGenerationRun 必须支持 idempotency、partial / failed visibility、sequence safety 和 retry，不重复开具发票。

## AC-35-21 — Settlement Batch Scope

SettlementBatch 的 Legal Entity、Market、Provider、Account、Currency、period、cutoff、gross、fee、tax、reserve 和 net amount 必须一致且可解释。

## AC-35-22 — Settlement Preflight

Batch 提交前必须检查 source status、hold、KYC / payout gate、tax、fee、reserve、duplicate instruction、approval 和 reconciliation expected total。

## AC-35-23 — Unknown Result Safe Handling

Payment、Refund、Payout 或 Settlement 的 unknown provider result 不得被盲目重试、强制标记成功 / 失败或重复 mutation。

## AC-35-24 — Partial Settlement Explicit

部分结算必须拆分已收、未收、fee、tax、reserve、差异、owner、due date 和后续处理，不得显示为 full settlement。

## AC-35-25 — Reconciliation Sources

至少能够按 entity、market、provider、currency、period 对 Order / Payment / Refund / Payout、Ledger、Invoice、Tax、Provider statement 和 SettlementAccount 对账。

## AC-35-26 — Reconciliation Difference

Missing、amount、currency、FX、fee、tax、rounding、timing、duplicate、wrong entity / account / market 和 unknown 差异必须分类、定责、留证和可追踪关闭。

## AC-35-27 — Tolerance Bounded

Tolerance 只能用于已批准的 rounding、timing 或 documented provider difference；不得掩盖重复扣款、错误主体、错误账户或未授权 payout。

## AC-35-28 — Settlement Dispute

重大 reconciliation mismatch 必须创建 SettlementDisputeCase，包含 source、amount、currency、severity、hold、owner、provider case、notification 和 resolution。

## AC-35-29 — Financial Close Gate

FinancialClose 必须检查 unknown backlog、invoice、tax、remittance、settlement、Ledger、FX、open cases、exceptions、Compliance evidence 和 checksum。

## AC-35-30 — Close Is Not Destructive

FinancialClose 关闭后发现新事实必须通过 reopen、adjustment、credit / debit note 或 correction entry 处理，不得覆盖历史 period snapshot。

## AC-35-31 — Refund Linkage

Refund 必须链接原 Payment、Order、Invoice、Tax、Entity、Currency / FX、Provider operation 和 Ledger correction path，且不能把原 Payment 金额直接改小。

## AC-35-32 — Cross-Currency Refund Disclosure

跨币种退款必须明确原授权币种、退款币种、FX 规则、fee、tax、rounding、customer-facing amount 和 difference owner。

## AC-35-33 — Chargeback Separation

Chargeback / dispute 必须独立于普通 refund，保留 evidence、hold / reserve、deadline、representment、outcome 和 Ledger correction。

## AC-35-34 — Tax Filing / Remittance

TaxFilingPeriod 和 RemittanceRecord 必须能追溯至 invoice、tax line、withholding、refund、settlement、filing、authority confirmation 和 amendment。

## AC-35-35 — Region / Migration / Exit Safety

Region、Market、Legal Entity 或 SettlementAccount 迁移 / 退出必须 fence old writer、处理 open money、完成 reconcile、保留历史 facts、满足 residency / retention 并记录 closeout。

## AC-35-36 — No Fabricated Money Fact

系统不得因为 Invoice、PurchaseOrder、CreditLimit、TaxDetermination、Provider paid、Settlement received、Reporting total 或 Enterprise contract 而自动生成 Funding、Payment success、Payout eligibility、Ledger balance 或税款已缴事实。

---

# 18. P0 / P1 Boundary

## 18.1 P0

- LegalEntity、LegalEntityAssignment、MarketEntityProfile；
- MarketTaxProfile、TaxRegistration、TaxRuleSet、TaxDetermination、TaxLine；
- CurrencyProfile、FXRateSet、FXRateQuote、MoneyConversion；
- PaymentRailProfile、SettlementAccount、SettlementInstruction、SettlementBatch、SettlementRecord；
- Invoice 跨市场 context、InvoiceGenerationRun、InvoiceAdjustment、CreditNote；
- ReconciliationResult、SettlementDisputeCase、FinancialClose；
- TaxFilingPeriod、RemittanceRecord；
- Payment / Payout / Refund / Ledger / Funding invariant；
- entity、market、provider、currency、region、residency、period 和 ownership；
- unknown result、duplicate operation、wrong entity、wrong account 和 no dual-write；
- 36 项 AC-35 验收标准及 Chapter 24、27、30、31、32、33、34 cross-domain boundary。

## 18.2 P1

- automated tax rule suggestion；
- predictive FX spread and liquidity forecast；
- provider statement auto-classification；
- customer self-service tax exemption upload；
- invoice anomaly detection；
- settlement batch optimization；
- multi-entity netting proposal；
- automated dispute response drafting；
- continuous close forecasting；
- cross-market scenario simulator；
- treasury dashboard and cash waterfall visualization。

P1 自动化不能改变 P0 的 Entity Assignment、Tax Determination、Payment、Payout、Ledger、Invoice、Settlement、Residency、SoD 或 FinancialClose boundary。

---

# 19. Locked Conclusions / Next Work

本章锁定：

```text
BusinessAccount 继续作为交易 Principal
Legal Entity Assignment 先于最终 Tax、Invoice、Payment、Payout 和 Settlement
Market、Entity、Provider、Currency、Region 和 Period 必须显式绑定
Tax determination 需要可解释输入、规则版本、税行和证据
Quote、Contract、Transaction、Invoice、Settlement、Reporting currency 分层
FX、Fee、Tax、Reserve、Refund、Dispute、Rounding 差异独立表达
Invoice ≠ Payment ≠ Ledger ≠ Settlement ≠ Tax Remittance
Settlement 需要幂等、hold、unknown、partial、statement 和 reconciliation
FinancialClose 不覆盖历史事实，只能追加 correction / adjustment
Legal Entity、Market、Region 或 Account 变化不能改写既有 money facts
```

下一步进入：

```text
Chapter 36 — Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance
```

Chapter 36 将继续收口多市场下的财务报表、资金头寸、流动性、收入确认、递延、成本分摊、预算、Treasury 风险和管理报表，明确 Reporting Read Model 与 Ledger / Invoice / Tax / Settlement Canonical facts 的边界。

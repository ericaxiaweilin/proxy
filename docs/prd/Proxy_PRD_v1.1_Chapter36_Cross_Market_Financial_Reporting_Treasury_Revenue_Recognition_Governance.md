# Proxy PRD v1.1

## Chapter 36 — Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance

**文档类型**：Financial Reporting / Consolidation / Treasury / Liquidity / Revenue Recognition / Cost Allocation / Management Reporting  
**状态**：ACTIVE — Cross-Market Finance / Executive Reporting Readiness  
**依赖**：Chapter 30 Scale Architecture / Capacity / FinOps / Multi-Region Readiness、Chapter 31 Enterprise / B2B Scale / Contract Governance、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 35 Multi-Market Legal Entity / Tax / Currency / Settlement Governance  
**后续**：Chapter 37 Financial Controls / Internal Audit / Risk Appetite / Board Governance

---

# 0. 本章目标

Chapter 35 已定义 Legal Entity、Tax、Currency、FX、Payment Rail、Invoice、Settlement、Reconciliation 和 FinancialClose 的交易与运营事实。本章在这些事实之上定义跨市场的报告、资金和收入治理。

本章要明确：

- Ledger、Invoice、Tax、Settlement、FinancialClose 是 source facts；
- Financial Reporting、Consolidation、Management Report、Treasury Forecast、Revenue Schedule 和 Cost Allocation 是受控的派生视图或计划；
- 报告可以重算、版本化、冻结和重述，但不能反向覆盖 source facts；
- Treasury 只能管理已确认的 cash、hold、reserve、settlement 和 approved movement，不能凭 forecast 制造可用资金；
- Revenue Recognition 必须绑定 contract、performance obligation、transfer / acceptance evidence、period 和 policy version；
- Revenue schedule 不是 Ledger posting，Recognition proposal 不能自动变成收入；
- 跨市场 consolidation 必须处理 entity scope、intercompany、FX translation、elimination、rounding、period close 和 restatement；
- Cost allocation、FinOps 和 unit economics 只能用于经营分析、预算和治理，不能篡改 Agent Earnings、Order、Payment、Payout 或 Ledger；
- 对外报表、Enterprise statement、管理报表、Compliance evidence 和 Board pack 必须明确 audience、scope、period、version、limitation 和 freshness。

## 0.1 本章核心结论

```text
Ledger / Invoice / Tax / Settlement = source facts
Financial Report = versioned derived view
Consolidation = controlled transformation, not new transaction
Treasury Position = confirmed cash / hold / reserve / forecast separation
Revenue Schedule = policy-based proposal / plan, not automatic Ledger posting
Cost Allocation = analytical attribution, not money mutation
Restatement = new report version, not historical source overwrite
Management KPI ≠ accounting fact
Report publication ≠ universal assurance
```

## 0.2 Money and Reporting Truth Matrix

| 对象 / 事实 | Canonical owner | 本章如何使用 | 本章不能做的事 |
|---|---|---|---|
| Order / Fee / Compensation | Order / Money Domain | 作为业务交易和计费来源 | 不把报表调整写回 Order |
| Payment / Refund / Payout | Payment / Payout Domain | 作为 cash event、settled / pending source | 不用 forecast 改 Payment status |
| Ledger | Money Domain | 作为余额、借贷、adjustment 的 source | 不允许直接覆盖或重算成别的余额 |
| Invoice / CreditNote / DebitNote | Billing Domain | 作为 billed / tax document source | 不把 Invoice 总额当成收入或现金 |
| TaxDetermination / TaxFiling | Tax / Finance Domain | 作为 tax reporting 与 remittance source | 不在报告中偷偷改税额 |
| Settlement / Provider Statement | Settlement Domain | 作为 received / pending / fee / reserve source | 不把 expected settlement 当现金 |
| FinancialClose | Finance Domain | 作为 period close gate | 不关闭未解释的 material mismatch |
| RevenueSchedule | Reporting / Finance | 生成 recognition proposal / forecast | 不自动发 Ledger income |
| TreasuryPosition | Treasury | 汇总 confirmed cash、holds、reserve、forecast | 不把 receivable 或 forecast 当 available cash |
| CostAllocationResult | FinOps / Reporting | 用于经营分析和预算 | 不修改实际费用或 Agent Earnings |
| FinancialReport | Reporting | 提供版本化的派生视图 | 不替代 source facts 或法定账簿 |
| ComplianceEvidence | Compliance | 证明报告控制、close、approval、freshness | 不因 report publication 生成合规保证 |

---

# 1. Reporting Constitution

## 1.1 Report 先定义 scope

每个 FinancialReport、ManagementReport、TreasuryForecast、RevenueSchedule、CostAllocationRun 和 ConsolidationRun 必须绑定：

```text
organization_scope
legal_entity_scope
enterprise_scope?
business_scope?
market_scope
provider_scope?
region_scope?
product_scope
currency_scope
period_start / period_end
as_of_time
scenario: ACTUAL / BUDGET / FORECAST / STRESS / PRO_FORMA
policy_version_set
source_snapshot_refs[]
```

没有 scope 的数字只能是草稿或非正式 estimate，不能用于 FinancialClose、Contract settlement、Tax filing、Board decision 或外部 assurance。

## 1.2 Source facts 与 derived views 分离

```text
Source facts
  → snapshot / mapping / policy
  → calculation / consolidation / allocation
  → report dataset
  → review / approval
  → publication / export
```

派生报表可以被重算，但每次重算必须记录 source snapshot、policy version、calculation version、run id 和 operator / system identity。

## 1.3 Reporting 不重写 source

FinancialReport、ConsolidationRun、RevenueSchedule、TreasuryForecast 或 CostAllocationResult 不得直接：

- 修改 Ledger entry、balance 或 account ownership；
- 把 Payment / Refund / Payout 的 `UNKNOWN` 变成 `SUCCESS`；
- 把 Settlement `EXPECTED` 变成 `RECEIVED`；
- 把 Invoice `DRAFT` 变成 `ISSUED`；
- 把 TaxFiling `OPEN` 变成 `FILED`；
- 把 Order、Compensation 或 Agent Earnings 改小以匹配预算；
- 把 Contract Price 或 SLA measurement 改成报表数字；
- 把 forecast、receivable、reserve 或 credit limit 变成 available cash。

如果 source fact 错误，必须走对应 Domain 的 correction、reversal、credit / debit note、reopen 或 amendment。

## 1.4 Period 是事实边界

每个 report 必须明确：

- transaction date；
- service / delivery period；
- invoice issue date；
- payment / settlement value date；
- tax period；
- accounting period；
- report as-of time；
- close status。

“本月”不能作为唯一 period 定义。不同日期语义必须在 report metadata 中分别保存。

## 1.5 Report freshness 有限期

报告必须显示：

- source snapshot time；
- last refresh time；
- latest included event time；
- pending / unknown backlog；
- stale source count；
- calculation version；
- whether period is closed。

一个超过 freshness policy 的 report 可以保留为历史版本，但不能被 UI 标记为 current without limitation。

## 1.6 Report audience 决定披露范围

同一 source 可以生成不同受众版本：

- Finance / Accounting；
- Treasury；
- Executive / Board；
- Enterprise customer；
- Operations；
- Compliance / Assessor；
- Public / Investor-like summary，若有批准。

Audience 变化不允许扩大 raw data 访问。Enterprise statement、Board pack 和 Compliance package 必须经过各自的 scope、redaction、approval 和 audit。

---

# 2. Reporting Domain Objects

## 2.1 ReportingScope

```text
ReportingScope
├── id
├── organization_ref
├── legal_entity_refs[]
├── enterprise_refs[]
├── business_refs[]
├── market_refs[]
├── region_refs[]
├── provider_refs[]
├── product_refs[]
├── currency_scope
├── data_class_scope[]
├── period_definition_ref
├── scenario
├── audience
├── owner_ref
├── approved_by[]
├── effective_from
├── effective_to?
└── audit_ref
```

## 2.2 ReportingPeriod

```text
ReportingPeriod
├── id
├── calendar_type: MARKET / LEGAL_ENTITY / GROUP / TAX / CONTRACT
├── legal_entity_ref?
├── market_ref?
├── period_start
├── period_end
├── cutoff_at
├── close_status: OPEN / SOFT_CLOSED / HARD_CLOSED / REOPENED
├── source_watermark
├── late_event_policy_ref
├── restatement_policy_ref
├── owner_ref
└── audit_ref
```

不同 Legal Entity 或 Tax Jurisdiction 可以使用不同 period，但跨市场汇总必须记录转换和 mapping，不能把不同 cutoff 当成同一时点。

## 2.3 ChartOfAccountsProfile

```text
ChartOfAccountsProfile
├── id
├── legal_entity_ref
├── jurisdiction_ref?
├── version
├── account_definitions[]
├── account_classifications[]
├── allowed_dimensions[]
├── mapping_profile_ref
├── effective_from
├── effective_to?
├── approval_refs[]
└── status: DRAFT / ACTIVE / SUPERSEDED / RETIRED
```

本章不创造 Ledger account 的 mutation 规则，只定义报表和 mapping 如何引用已批准的 account profile。

## 2.4 ReportingMapping

```text
ReportingMapping
├── id
├── source_type: LEDGER / INVOICE / TAX / SETTLEMENT / PAYMENT / COST / REVENUE
├── source_ref_pattern
├── target_report_account
├── dimensions[]
├── transformation_rule
├── exclusion_rules[]
├── effective_from
├── effective_to?
├── version
├── owner_ref
├── approved_by[]
└── audit_ref
```

Mapping 变更必须创建新版本。历史 ReportRun 必须继续引用旧 mapping，不能使历史报表无声地变成新口径。

## 2.5 ReportSourceSnapshot

```text
ReportSourceSnapshot
├── id
├── scope_ref
├── period_ref
├── source_types[]
├── source_watermarks[]
├── record_counts[]
├── total_checksums[]
├── included_event_time
├── excluded_late_events[]
├── unknown_backlog_refs[]
├── generated_at
├── integrity_hash
└── audit_ref
```

Snapshot 是报告计算的输入冻结点，不等同于复制或覆盖 Ledger。需要补入 late event 时，应建立新 snapshot。

## 2.6 ReportRun

```text
ReportRun
├── id
├── report_type
├── scope_ref
├── period_ref
├── scenario
├── source_snapshot_ref
├── mapping_version_set
├── policy_version_set
├── calculation_version
├── started_at
├── completed_at?
├── row_count
├── total_checksums[]
├── warnings[]
├── errors[]
├── status: DRAFT / RUNNING / PARTIAL / COMPLETE / FAILED / SUPERSEDED
├── reviewer_refs[]
└── audit_ref
```

## 2.7 FinancialReport

```text
FinancialReport
├── id
├── report_run_ref
├── report_type: BALANCE_SHEET / INCOME_STATEMENT / CASH_FLOW / TRIAL_BALANCE / TAX_SUMMARY / AR / AP / SETTLEMENT / FINOPS
├── scope_ref
├── period_ref
├── reporting_currency
├── statement_basis: SOURCE / CONSOLIDATED / MANAGEMENT / PRO_FORMA
├── dataset_ref
├── source_snapshot_ref
├── reconciliation_refs[]
├── limitation_refs[]
├── status: DRAFT / REVIEW / APPROVED / PUBLISHED / RESTATED / RETIRED
├── version
├── approved_by[]
├── published_at?
└── audit_ref
```

## 2.8 ConsolidationGroup

```text
ConsolidationGroup
├── id
├── parent_organization_ref
├── legal_entity_refs[]
├── ownership_method: FULL / PROPORTIONAL / EQUITY / MANAGEMENT_ONLY
├── consolidation_currency
├── intercompany_policy_ref
├── fx_translation_policy_ref
├── calendar_policy_ref
├── effective_from
├── effective_to?
├── approval_refs[]
└── status: DRAFT / ACTIVE / SUPERSEDED / CLOSED
```

ConsolidationGroup 是 reporting scope，不自动改变 Legal Entity 的法律主体、合同主体、税务主体或 Ledger owner。

## 2.9 ConsolidationRun

```text
ConsolidationRun
├── id
├── consolidation_group_ref
├── reporting_period_ref
├── source_report_refs[]
├── fx_translation_run_ref
├── intercompany_elimination_run_ref
├── ownership_adjustment_refs[]
├── consolidation_adjustment_refs[]
├── source_checksums[]
├── output_checksum
├── status: DRAFT / RUNNING / REVIEW_REQUIRED / COMPLETE / FAILED / SUPERSEDED
├── reviewer_refs[]
└── audit_ref
```

## 2.10 IntercompanyElimination

```text
IntercompanyElimination
├── id
├── consolidation_run_ref
├── counterparty_entity_refs[]
├── source_invoice_refs[]
├── source_ledger_refs[]
├── source_settlement_refs[]
├── elimination_type: RECEIVABLE_PAYABLE / REVENUE_COST / DIVIDEND / LOAN / FX / OTHER
├── amount / currency
├── elimination_currency_amount
├── matching_method
├── mismatch_refs[]
├── status: PROPOSED / MATCHED / ADJUSTED / APPROVED / REJECTED
└── audit_ref
```

Elimination 只存在于 Consolidated report layer，不删除或抵消各 Legal Entity 的 source Ledger、Invoice 或 Settlement facts。

## 2.11 FXTranslationRun

```text
FXTranslationRun
├── id
├── source_report_refs[]
├── source_currency_refs[]
├── target_reporting_currency
├── rate_set_ref
├── rate_type_policy
├── translation_date_policy
├── translated_rows
├── translation_difference
├── rounding_difference
├── warnings[]
├── status: DRAFT / COMPLETE / REVIEW_REQUIRED / SUPERSEDED
└── audit_ref
```

Translation difference属于reporting adjustment / OCI-like management bucket only when approved by the applicable finance policy; it不能反向修改 source Ledger。

## 2.12 ReportPublication

```text
ReportPublication
├── id
├── report_ref
├── audience
├── channel: INTERNAL / ENTERPRISE_PORTAL / API / TRUST_ROOM / BOARD_PACK / FILE_EXPORT
├── artifact_ref
├── scope_statement
├── freshness_statement
├── limitation_refs[]
├── approved_by[]
├── published_at
├── expires_at?
├── status: DRAFT / APPROVED / PUBLISHED / REVOKED / EXPIRED
└── audit_ref
```

## 2.13 ReportRestatement

```text
ReportRestatement
├── id
├── original_report_ref
├── replacement_report_ref
├── affected_periods[]
├── affected_scopes[]
├── reason_type: SOURCE_CORRECTION / MAPPING_ERROR / FX_ERROR / TAX_CORRECTION / CONSOLIDATION_ERROR / POLICY_CHANGE / FRAUD / OTHER
├── materiality_assessment
├── impact_summary
├── notification_refs[]
├── approval_refs[]
├── status: PROPOSED / REVIEW / APPROVED / PUBLISHED / REJECTED
└── audit_ref
```

## 2.14 TreasuryPosition

```text
TreasuryPosition
├── id
├── scope_ref
├── as_of_time
├── currency
├── confirmed_cash
├── pending_settlement
├── restricted_cash
├── reserve_cash
├── payout_hold
├── customer_funds_or_safeguarded_amount?
├── available_cash
├── committed_outflows
├── liquidity_buffer
├── source_snapshot_ref
├── calculation_version
├── status: ESTIMATE / RECONCILED / REVIEW_REQUIRED / SUPERSEDED
└── audit_ref
```

`available_cash` 必须按 policy 计算，不能简单等于 bank balance。Restricted、reserve、customer funds、pending settlement 和 committed outflows 必须单独展示。

## 2.15 CashAccountPosition

```text
CashAccountPosition
├── id
├── settlement_account_ref
├── legal_entity_ref
├── market_ref
├── currency
├── bank_or_provider_balance
├── ledger_cash_balance
├── pending_inflows
├── pending_outflows
├── restricted_amount
├── reconciliation_result_ref
├── as_of_time
├── status: UNRECONCILED / RECONCILED / MISMATCH / CLOSED
└── audit_ref
```

## 2.16 LiquidityForecast

```text
LiquidityForecast
├── id
├── scope_ref
├── forecast_horizon
├── base_currency
├── opening_confirmed_cash
├── expected_inflows[]
├── committed_outflows[]
├── discretionary_outflows[]
├── reserve_assumptions[]
├── stress_scenarios[]
├── minimum_buffer
├── projected_low_point
├── forecast_confidence
├── source_refs[]
├── generated_at
├── status: DRAFT / REVIEW / APPROVED / EXPIRED / SUPERSEDED
└── audit_ref
```

Forecast 中的 expected inflow 不是 confirmed cash，必须标记 probability、source 和 expected date。

## 2.17 TreasuryMovement

```text
TreasuryMovement
├── id
├── movement_type: TRANSFER / SWEEP / CONVERSION / RESERVE / RELEASE / FUNDING / REPAYMENT / FEE / TAX_REMITTANCE
├── from_account_ref?
├── to_account_ref?
├── legal_entity_refs[]
├── source_ref
├── amount / currency
├── fx_conversion_ref?
├── approval_refs[]
├── idempotency_key
├── effective_at
├── status: PROPOSED / APPROVED / SUBMITTED / PROCESSING / COMPLETED / UNKNOWN / FAILED / REVERSED / HELD
└── audit_ref
```

TreasuryMovement 不得绕过 Payment / Payout / Ledger / Tax / Legal Entity ownership checks。跨 entity movement 必须有合法 purpose、counterparty、tax / accounting treatment 和 reconciliation。

## 2.18 ReservePolicy

```text
ReservePolicy
├── id
├── scope_ref
├── reserve_type: PROVIDER / CHARGEBACK / PAYOUT / TAX / LIQUIDITY / CUSTOMER_FUNDS / RISK
├── calculation_basis
├── rate_or_amount_rule
├── release_condition
├── replenishment_condition
├── currency_policy
├── effective_from
├── effective_to?
├── owner_ref
├── approval_refs[]
└── status: DRAFT / ACTIVE / SUPERSEDED / RETIRED
```

## 2.19 TreasuryRiskExposure

```text
TreasuryRiskExposure
├── id
├── scope_ref
├── risk_type: FX / LIQUIDITY / COUNTERPARTY / CONCENTRATION / RATE / SETTLEMENT / FRAUD
├── exposure_amount
├── currency
├── counterparty_ref?
├── horizon
├── sensitivity
├── limit_ref
├── mitigation_refs[]
├── owner_ref
├── status: OPEN / WITHIN_LIMIT / BREACH / MITIGATING / CLOSED
└── audit_ref
```

Risk exposure 是决策和监控事实，不直接修改 Payment、Payout、Settlement 或 Ledger。

## 2.20 RevenueRecognitionPolicy

```text
RevenueRecognitionPolicy
├── id
├── legal_entity_ref
├── market_refs[]
├── product_refs[]
├── revenue_category
├── recognition_basis: POINT_IN_TIME / OVER_TIME / MILESTONE / USAGE / PRINCIPAL_AGENT_REVIEW
├── satisfaction_evidence_rules[]
├── variable_consideration_policy_ref
├── refund_and_chargeback_policy_ref
├── contract_modification_policy_ref
├── currency_policy_ref
├── effective_from
├── effective_to?
├── legal_or_accounting_basis_refs[]
├── approved_by[]
└── status: DRAFT / ACTIVE / SUPERSEDED / RETIRED
```

本对象只保存已批准的识别政策。具体交易是否满足条件，要由 RevenueAssessment 判断。

## 2.21 RevenueContract

```text
RevenueContract
├── id
├── source_contract_ref
├── customer_ref
├── seller_entity_ref
├── market_ref
├── contract_currency
├── consideration_terms
├── performance_obligation_refs[]
├── contract_start / contract_end
├── modification_refs[]
├── cancellation_terms
├── refund_terms
├── collection_status
├── policy_ref
└── audit_ref
```

RevenueContract 是 Revenue Recognition 视图对 EnterpriseContract / PriceSchedule 的引用，不创建第二份合同事实。

## 2.22 PerformanceObligation

```text
PerformanceObligation
├── id
├── revenue_contract_ref
├── obligation_type: TASK_SERVICE / SUBSCRIPTION / PLATFORM_ACCESS / SUPPORT / MILESTONE / OTHER
├── standalone_selling_price
├── allocated_transaction_price
├── satisfaction_method
├── satisfaction_start / satisfaction_end
├── evidence_requirements[]
├── completion_status: NOT_STARTED / IN_PROGRESS / SATISFIED / CANCELLED / DISPUTED
├── modification_refs[]
└── audit_ref
```

`Order completed`、`Invoice issued`、`Payment received` 和 `PerformanceObligation satisfied` 不是默认同义词；具体映射必须由 policy 和 evidence 决定。

## 2.23 RevenueAssessment

```text
RevenueAssessment
├── id
├── revenue_contract_ref
├── performance_obligation_ref
├── source_refs[]
├── satisfaction_evidence_refs[]
├── consideration_amount
├── allocated_amount
├── recognized_to_date
├── remaining_amount
├── refund_or_chargeback_estimate?
├── collectability_assessment
├── assessment_date
├── policy_version
├── result: NOT_READY / READY_FOR_SCHEDULE / REVIEW_REQUIRED / BLOCKED / SUPERSEDED
└── audit_ref
```

## 2.24 RevenueSchedule

```text
RevenueSchedule
├── id
├── revenue_contract_ref
├── performance_obligation_ref
├── schedule_currency
├── recognition_periods[]
├── deferred_balance
├── recognized_balance
├── remaining_balance
├── source_assessment_refs[]
├── policy_ref
├── calculation_version
├── status: DRAFT / REVIEW / APPROVED / ACTIVE / SUSPENDED / COMPLETED / SUPERSEDED
└── audit_ref
```

## 2.25 RecognitionProposal

```text
RecognitionProposal
├── id
├── revenue_schedule_ref
├── period_ref
├── proposed_revenue
├── proposed_deferred_release
├── proposed_refund_reserve
├── proposed_currency_conversion
├── source_refs[]
├── accounting_review_refs[]
├── status: DRAFT / REVIEW / APPROVED / REJECTED / POSTED / SUPERSEDED
└── audit_ref
```

`APPROVED` 也不等于 Ledger 已过账。只有 Ledger Domain 的 approved posting command 成功后，才可以产生 posted reference。

## 2.26 CostAllocationRun

```text
CostAllocationRun
├── id
├── scope_ref
├── period_ref
├── cost_source_snapshot_ref
├── allocation_profile_refs[]
├── driver_snapshot_refs[]
├── allocated_cost_total
├── unallocated_cost_total
├── variance
├── calculation_version
├── status: DRAFT / RUNNING / REVIEW_REQUIRED / COMPLETE / SUPERSEDED
├── reviewer_refs[]
└── audit_ref
```

## 2.27 CostAllocationResult

```text
CostAllocationResult
├── id
├── run_ref
├── target_type: MARKET / LEGAL_ENTITY / PRODUCT / BUSINESS / ENTERPRISE / REGION / PROVIDER
├── target_ref
├── cost_category
├── allocated_amount
├── currency
├── driver_ref
├── allocation_percentage
├── variance_to_budget
├── source_refs[]
└── audit_ref
```

## 2.28 ManagementReport

```text
ManagementReport
├── id
├── report_run_ref
├── audience: EXECUTIVE / BOARD / FINANCE / OPERATIONS / CUSTOMER_SUCCESS / INVESTMENT_COMMITTEE
├── metric_definitions[]
├── narrative_ref
├── scenario
├── risk_and_limitation_refs[]
├── approval_refs[]
├── status: DRAFT / REVIEW / APPROVED / PUBLISHED / SUPERSEDED
└── audit_ref
```

ManagementReport 可以包含 KPI、预测和经营解释，但必须将 forecast、estimate、actual 和 source fact 分开标记。

## 2.29 FinancialMetricDefinition

```text
FinancialMetricDefinition
├── id
├── metric_code
├── name
├── formula
├── numerator_refs[]
├── denominator_refs[]
├── inclusion_rules[]
├── exclusion_rules[]
├── currency_policy
├── period_policy
├── source_priority
├── version
├── owner_ref
└── status: DRAFT / ACTIVE / RETIRED
```

---

# 3. Reporting Dimensions / Chart / Mapping

## 3.1 Mandatory Reporting Dimensions

跨市场 report 至少能按以下维度切分或说明不可切分原因：

```text
legal_entity
market
enterprise
business_account
product / service
order / source type
payment rail / provider
region / MarketCell
tax jurisdiction
currency
period
scenario
customer / counterparty category
```

个人身份、精确位置、raw KYC、bank credential 和私密内容不是默认的 reporting dimension。

## 3.2 Chart of Accounts Mapping

Source mapping 必须覆盖：

- account code / class；
- source fact type；
- legal entity；
- market；
- tax category；
- currency treatment；
- intercompany flag；
- reporting line；
- elimination rule；
- effective period；
- mapping owner。

未匹配 source 不得静默落入 `Other`。必须进入 `UNMAPPED`、`REVIEW_REQUIRED` 或明确的 residual bucket，并在 report limitation 中显示。

## 3.3 Mapping Validation

每次 ReportRun 前执行：

1. source account completeness；
2. mapping version compatibility；
3. effective period check；
4. legal entity / market dimension check；
5. tax / intercompany classification check；
6. currency and minor unit check；
7. unknown / unmapped record count；
8. checksum and total balance check。

## 3.4 Source Priority

当同一事实有多个 read source 时，默认优先级：

```text
Ledger / owned Domain fact
→ approved Invoice / Tax / Settlement fact
→ reconciled provider / bank statement
→ approved adjustment / correction
→ derived projection
→ estimate / forecast
```

高层级 source 不得被低层级 report 数据覆盖。若 source 之间冲突，报告显示 mismatch 或 limitation，并创建 reconciliation / finding。

## 3.5 Unmapped / Unknown Handling

以下情况至少标记 `REPORTING_REVIEW_REQUIRED`：

- 未知 account；
- 未知 entity / market；
- 缺失 currency；
- source period 不在 report period；
- provider statement 无法匹配；
- tax category 未映射；
- intercompany counterparty 缺失；
- FX rate 过期或无 source；
- RevenueAssessment 缺少 transfer evidence；
- Cost driver 未冻结。

---

# 4. Reporting Period / Close / Snapshot

## 4.1 Period Types

| 类型 | 用途 | 关闭依据 |
|---|---|---|
| Operational Period | 运营和 support metrics | event watermark / operational cutoff |
| Billing Period | Invoice、statement、credit note | billing run and delivery |
| Tax Period | tax filing / remittance | TaxFilingPeriod gate |
| Ledger Period | source ledger balance / posting | Ledger close policy |
| Settlement Period | provider / bank statement | batch、value date、reconcile |
| Reporting Period | report / consolidation | source snapshots and review |
| Contract Period | SLA、commit、service credit | contract version / effective dates |

不同 period 可以重叠，但 report 必须明确引用哪些 period 作为 source。

## 4.2 Soft Close

`SOFT_CLOSED` 表示：

- 常规 posting / invoice / settlement run 已完成；
- late event 仍可通过 approved path 进入；
- report 可以发布为 preliminary；
- open mismatch、unknown、estimate 和 limitation 仍需显示；
- 不得对外称为 final financial close。

## 4.3 Hard Close

`HARD_CLOSED` 至少要求：

- required source snapshot 已冻结；
- Ledger、Invoice、Tax、Settlement、Payment、Payout 可对账；
- material unknown / mismatch 已解决或有批准 exception；
- RevenueRecognitionProposal 有 review；
- FX translation、elimination、rounding 可复算；
- report mapping、policy、calculation version 已锁定；
- FinancialClose、ComplianceEvidence、approval 和 checksum 已记录。

Hard close 仍不是“永远不可变化”。发现 material error 时，只能通过 `ReportRestatement` 或经批准的 source correction 重新处理。

## 4.4 Late Event Policy

Late event 进入已 soft / hard closed period 时：

- 保留 event original time 和 received time；
- 判断 materiality、tax / legal impact 和 customer impact；
- 可进入 next period、reopen 或 restatement；
- 创建 reason、mapping、approval 和 downstream notification；
- 不修改原 event timestamp；
- 不通过删除或重排事件隐藏 late arrival。

## 4.5 Snapshot Freeze

Snapshot freeze 必须包括：

- source watermark；
- source row / event count；
- total by currency；
- total by Legal Entity / Market；
- unknown / mismatch count；
- FX rate set；
- policy / mapping version；
- generated time；
- integrity hash。

## 4.6 Restatement Threshold

是否需要 restatement 由 materiality policy 判断，至少考虑：

- amount；
- percentage of report line；
- tax / legal effect；
- customer / Enterprise invoice effect；
- covenant / Contract / SLA effect；
- fraud / control failure；
- management decision impact；
- prior report audience。

不能只因金额小就忽略可能影响税务、合规、客户权利或安全的错误。

---

# 5. Multi-Market Consolidation

## 5.1 Consolidation Sequence

```text
Lock Reporting Scope
→ Collect Legal Entity Reports
→ Validate Period / Mapping / Currency
→ Reconcile Source Totals
→ Translate to Consolidation Currency
→ Match Intercompany
→ Propose Eliminations
→ Apply Approved Consolidation Adjustments
→ Check Group Invariants
→ Review / Approve
→ Publish Consolidated Report
```

## 5.2 Consolidation Boundary

Consolidation 可以：

- 汇总多个 Legal Entity 的 approved report；
- 做 FX translation；
- 做 intercompany elimination；
- 应用 ownership / management view；
- 生成 group-level KPI 和 statement。

Consolidation 不可以：

- 合并不同 entity 的客户、合同或交易 owner；
- 把一个 entity 的 Ledger entry 移到另一个 entity；
- 消除第三方 Payment、Refund、Payout 或 Tax fact；
- 用 group balance 覆盖 entity balance；
- 绕过各 entity 的 tax、legal、audit 或 data residency scope。

## 5.3 Intercompany Matching

Intercompany matching 至少使用：

- counterparty Legal Entity；
- source Invoice / DebitNote / CreditNote；
- internal Contract / service ref；
- amount / currency；
- period / value date；
- settlement reference；
- tax treatment。

只按相等金额匹配不足以证明 intercompany relationship。

## 5.4 Elimination Rules

Elimination proposal 必须记录：

- source entity facts；
- counterparty facts；
- elimination type；
- amount / currency；
- FX conversion；
- tax impact；
- mismatch；
- approver；
- output report line。

Elimination 的目的只是呈现 group view，不是删除 source evidence。

## 5.5 FX Translation

不同报表类别可使用不同的 approved translation policy，例如：

- balance sheet position rate；
- income / expense period average rate；
- transaction-specific rate；
- settlement actual rate；
- management constant-currency rate。

每个 report 必须写明采用哪一种 policy。不能在同一份报表中混用不同 rate 而不披露。

## 5.6 Consolidation Adjustments

管理层可以提出 consolidation adjustment，但必须：

- 有 source refs；
- 有 reason、policy、effective period；
- 有 Finance approval；
- 与 Legal Entity source report 分离；
- 在 report 中标记 `CONSOLIDATION_ADJUSTMENT`；
- 可被撤回、重算和审计。

不允许通过隐藏 adjustment 来源把管理层判断伪装成 Ledger fact。

## 5.7 Group Close Gate

ConsolidationRun 进入 `COMPLETE` 前：

- 所有 entity reports 的 status 可接受；
- entity scope、calendar、currency mapping 一致；
- intercompany mismatch 已解释；
- material source mismatch 有 finding / exception；
- FX translation 已锁定；
- elimination 有 approval；
- group totals 与 entity totals 可重算；
- limitation 和 late event 已披露。

---

# 6. Treasury / Cash / Liquidity Governance

## 6.1 Cash Categories

TreasuryPosition 必须至少区分：

```text
confirmed_cash
pending_settlement
restricted_cash
reserve_cash
customer_funds_or_safeguarded_amount
payout_hold
committed_outflows
minimum_liquidity_buffer
available_cash
```

这些类别不能全部加总成“现金余额”。

## 6.2 Available Cash Formula

默认模型：

```text
available_cash
= confirmed_cash
  - restricted_cash
  - reserve_cash
  - customer_funds_or_safeguarded_amount
  - committed_outflows
  - minimum_liquidity_buffer
  + approved_releasable_amounts
```

`pending_settlement` 默认不进入 available cash，除非 Treasury policy 明确允许并记录 probability、settlement risk、cutoff 和 approval。

## 6.3 Cash Position Reconciliation

CashAccountPosition 必须对账：

- bank / provider balance；
- Ledger cash balance；
- pending inflow / outflow；
- reserve / hold；
- settlement batch；
- transfer / sweep；
- FX conversion；
- value date；
- bank statement / provider statement。

差异进入 Chapter 35 的 `ReconciliationResult` 或 `SettlementDisputeCase`，不能由 Treasury dashboard 直接“平掉”。

## 6.4 Liquidity Forecast

Forecast 必须拆分：

- confirmed inflow；
- probable inflow；
- receivable / invoice due；
- expected settlement；
- refund / chargeback scenario；
- payout commitment；
- tax remittance；
- payroll / provider / infrastructure cost，如适用；
- debt / financing obligation；
- reserve replenishment；
- discretionary spend。

每项 forecast 记录 expected date、amount、currency、probability、source 和 owner。

## 6.5 Liquidity Stress Scenarios

至少支持：

- Provider settlement delay；
- Payment conversion下降；
- Refund / chargeback spike；
- Payout volume spike；
- FX adverse move；
- Market pause；
- Entity suspension；
- Region failover；
- Tax remittance concentration；
- Enterprise receivable delay；
- Provider reserve increase。

Stress scenario 是决策输入，不是生产状态，也不能直接触发未经批准的资金移动。

## 6.6 Reserve Governance

Reserve 的建立、增加、释放必须有：

- policy；
- calculation basis；
- source event；
- currency；
- owner；
- release condition；
- approval；
- Ledger / settlement reference；
- customer / Enterprise impact，如适用。

Reserve 不是损失、收入或可用现金的替代字段。

## 6.7 TreasuryMovement Gate

TreasuryMovement 进入 `APPROVED` 前必须确认：

- from / to account ownership；
- entity role；
- source purpose；
- currency / FX；
- sanctions / KYC / bank validation；
- liquidity buffer；
- tax / accounting treatment；
- duplicate / idempotency；
- SoD；
- rollback / reversal path。

## 6.8 Treasury Movement No-Go

以下情况禁止自动 movement：

- account ownership 未验证；
- source amount 未对账；
- entity assignment 冲突；
- Provider / bank result unknown；
- movement 会穿透 restricted / customer funds；
- required tax / approval 缺失；
- FX rate 过期；
- destination account 被 hold / suspended；
- 需要通过 movement 修正历史 Ledger。

## 6.9 Counterparty / Concentration Risk

TreasuryRiskExposure 必须按：

- Provider；
- bank / settlement account；
- Legal Entity；
- Market；
- currency；
- payout counterparty；
- customer / Enterprise concentration；
- reserve exposure。

超过 approved limit 时，进入 `BREACH` 或 `MITIGATING`，不能仅通过改变 dashboard threshold 隐藏。

---

# 7. FX Risk / Currency Exposure

## 7.1 Exposure Sources

FX exposure 可以来自：

- transaction currency 与 settlement currency mismatch；
- Invoice currency 与 collection currency mismatch；
- payout currency 与 provider account currency mismatch；
- tax / remittance currency；
- intercompany balances；
- reporting translation；
- committed contract price；
- forecast inflow / outflow；
- reserve / chargeback timing。

每项 exposure 必须说明是 actual、committed、forecast 还是 translation。

## 7.2 FX Risk Measures

可以记录：

- gross exposure；
- net exposure；
- currency mismatch；
- sensitivity；
- rate movement；
- hedge / mitigation reference；
- time horizon；
- limit；
- owner。

Risk metric 不能改变 customer-facing contract currency 或原始 Payment amount。

## 7.3 FX Fallback

FX source unavailable 时：

- 优先使用已批准的 fallback source；
- 检查 rate age、spread、market availability；
- 标记 estimate / manual review；
- 不对用户隐藏 rate change；
- 不在没有 quote lock 的情况下重复扣款；
- 记录 rate source、reason 和 approval。

## 7.4 FX Correction

发现错误 FX rate 时：

1. 保留原始 quote / conversion / settlement；
2. 评估 Payment、Refund、Invoice、Tax、Ledger、Payout 和 report impact；
3. 创建 correction / adjustment / credit note / debit note；
4. 由 Finance / Legal / Payment owner 审批；
5. 重新生成受影响 report；
6. 必要时做 customer / Enterprise notification 和 restatement。

---

# 8. Revenue Recognition Governance

## 8.1 Recognition Is a Separate Decision

以下事实不能单独证明 revenue recognition：

- Contract signed；
- PurchaseOrder approved；
- Invoice issued；
- Payment received；
- Order created；
- Order completed；
- Settlement received；
- SLA target met；
- Enterprise renewed。

RevenueRecognitionPolicy 必须定义具体 performance obligation、transfer / satisfaction evidence、variable consideration、refund / chargeback、contract modification 和 collectability 规则。

## 8.2 Contract Identification

RevenueContract 识别时至少检查：

- parties；
- seller / contracting entity；
- market；
- enforceable terms；
- contract currency；
- price schedule；
- payment terms；
- termination / cancellation；
- modification；
- customer acceptance；
- related contracts / bundle。

系统不能把所有 Enterprise Contract 自动当作一个 revenue contract，也不能把不同 Legal Entity 的合同自动合并。

## 8.3 Performance Obligation

必须判断：

- service / product distinctness；
- stand-alone selling price；
- bundle / allocation；
- point-in-time or over-time；
- delivery / acceptance；
- cancellation / refund right；
- support / access / platform obligation；
- principal vs agent consideration；
- variable consideration constraint。

判断结果必须有 policy version、evidence 和 reviewer。

## 8.4 Principal / Agent Boundary

Marketplace、Provider、Business、Enterprise 或代理关系下，系统不能仅因：

- 资金经过 Proxy；
- Invoice 由 Proxy 生成；
- Provider 被 Proxy 路由；
- SLA 由 Proxy 承诺；
- Customer 通过 Proxy 下单；

就自动把 gross amount 当成 Proxy revenue。需要根据 approved policy、control、obligation、risk、inventory / service responsibility 和 Legal / Finance review 形成结论。

## 8.5 Variable Consideration

Variable consideration 可包含：

- usage；
- volume discount；
- rebate；
- service credit；
- performance bonus；
- refund；
- chargeback；
- penalty；
- cancellation；
- price protection。

必须记录估算方法、constraint、confidence、period、source 和 actual true-up path。

## 8.6 Recognition Evidence

Evidence 可来自：

- accepted delivery / completion；
- customer acceptance；
- verified usage；
- service period elapsed；
- approved milestone；
- support / access availability；
- cancellation window expired；
- collection / collectability review；
- provider / subcontractor evidence。

Evidence 不得包含不必要的 raw personal data。Chapter 34 的 Evidence classification、retention 和 audit boundary 适用。

## 8.7 Revenue Schedule

RevenueSchedule 必须记录：

- total transaction price；
- allocated price；
- recognition basis；
- start / end period；
- recognized to date；
- deferred balance；
- remaining balance；
- refund / chargeback estimate；
- currency / FX policy；
- policy version；
- source assessment。

Schedule 变化时保留旧版本和 reason。不能用当前 schedule 覆盖已批准的历史 schedule。

## 8.8 Deferred Balance

Deferred balance 是 reporting / accounting view，必须与：

- Invoice issued；
- Payment collected；
- Ledger balance；
- service obligation；
- refund / chargeback reserve；
- contract liability policy；

建立可追溯关系，但不能把 deferred balance 当成未受限现金。

## 8.9 Recognition Proposal to Ledger

流程必须是：

```text
RevenueAssessment
→ RevenueSchedule
→ RecognitionProposal
→ Accounting / Finance Review
→ Approved Ledger Posting Command
→ Ledger Entry Reference
→ Report Refresh
```

任何一步失败都必须保留 proposal status 和 reason。Reporting worker 不得直接写 Ledger。

## 8.10 Contract Modification

合同变更、scope expansion、price change、cancellation 或 renewal 时：

- 新旧合同版本和 effective time 明确；
- 判断是 new contract、prospective modification、cumulative catch-up 或 correction；
- 重新评估 performance obligations；
- 更新 price allocation、variable consideration 和 refund；
- 评估 Invoice、Tax、Ledger 和 Customer statement；
- 必要时创建 ReportRestatement。

续约不自动把未履行的旧 obligation 变成已履行，也不自动重新开始历史 revenue schedule。

## 8.11 Refund / Chargeback Impact

Refund、chargeback、service credit 和 cancellation 可能影响：

- recognized revenue；
- deferred balance；
- receivable；
- tax；
- settlement；
- cost / provider fee；
- customer statement。

影响必须通过 adjustment / reversal / credit note / new schedule 表达，不能修改原始 recognition event。

---

# 9. Cost Allocation / FinOps / Unit Economics

## 9.1 Cost Source

CostAllocationRun 的 source 可以来自：

- provider invoice；
- infrastructure usage；
- region / cell capacity；
- KYC / geo / media / notification operation；
- support / operator time；
- payment / refund / chargeback fee；
- compliance / audit program；
- data storage / transfer；
- sales / customer success；
- shared corporate cost。

每项 cost 必须标记 actual、accrued、estimate 或 forecast。

## 9.2 Allocation Driver

Approved driver 可以包括：

- transaction count；
- successful Slot count；
- order value；
- payment operation；
- active user / business；
- storage volume；
- CPU / network usage；
- support case / minutes；
- headcount / FTE；
- contract commitment；
- provider invoice attribution。

Driver 必须有 period、source、owner、version 和 fallback。不能仅为改善某个 Market 的 KPI 而临时改 driver。

## 9.3 CostAllocation Rules

Cost allocation 必须区分：

- direct cost；
- shared cost；
- allocated cost；
- unallocated cost；
- pass-through fee；
- subsidy；
- customer-specific cost；
- corporate overhead；
- one-time incident cost。

Allocation result 是管理视图，不得成为新的 customer charge，除非通过 Contract / PriceSchedule / Invoice 的独立流程批准。

## 9.4 Unit Economics

Unit economics 可以展示：

- revenue / recognized revenue；
- gross payment volume；
- provider fee；
- tax / withholding；
- refund / chargeback leakage；
- KYC / Geo / Media / Notification cost；
- support / operator cost；
- infrastructure cost；
- compliance / audit cost；
- subsidy / service credit；
- contribution margin。

必须区分：

```text
cash collected
recognized revenue
gross payment volume
net revenue
contribution margin
available cash
```

这些概念不能在 dashboard 中合并成一个“收入”字段。

## 9.5 Budget vs Actual

Budget、Forecast、Actual 和 Variance 必须分别存储：

- baseline version；
- approved amount；
- actual source snapshot；
- forecast assumption；
- variance calculation；
- owner；
- period；
- explanation；
- corrective action。

Variance action 不得通过更改 actual source 或关闭成本采集来降低 variance。

## 9.6 FinOps Boundary

Chapter 30 的 `FinOpsBudget` 和 `CostAllocationProfile` 继续有效。本章扩展 report layer，但不能：

- 将 unit economics 当作 Ledger；
- 将 forecast cash 当作 Funding；
- 将 cost allocation 当作 TaxDetermination；
- 将管理层 target 当作 Contract obligation；
- 用削减 Audit、Safety、Privacy、Consent 或 Ledger event 来降低成本。

## 9.7 Cost Anomaly

Cost anomaly 至少分析：

- provider retry / timeout；
- traffic / abuse；
- data leak / exfiltration；
- region failover；
- capacity misconfiguration；
- duplicate payment / refund operation；
- fraud / incident；
- pricing / allocation change；
- invoice error。

不得只通过改 report mapping 将 anomaly 归为 `Other`。

---

# 10. Management Reporting / KPI / Executive Pack

## 10.1 Metric Layers

ManagementReport 必须区分：

```text
Canonical fact
Derived operational metric
Accounting / finance metric
Forecast / scenario metric
Management judgment
Narrative / interpretation
```

## 10.2 KPI Definition

每个 KPI 必须定义：

- name / code；
- formula；
- numerator / denominator；
- source priority；
- inclusion / exclusion；
- period；
- currency；
- timezone；
- freshness；
- owner；
- version；
- known limitations。

## 10.3 Executive Pack

Executive / Board pack 可以包含：

- revenue / gross payment volume；
- cash / liquidity；
- margin / cost；
- market / entity performance；
- Enterprise contract health；
- provider / settlement risk；
- compliance / audit risk；
- forecast / scenario；
- strategic decisions。

每个图表和数字必须能 drill down 到 report run、source snapshot、scope 和 limitation。没有 source link 的手工数字必须标记为 manual input，并有 approver。

## 10.4 Forecast Governance

Forecast 必须保留：

- assumption version；
- scenario name；
- base date；
- confidence；
- source actuals；
- changes from prior forecast；
- owner；
- approval。

Forecast 与 actual 偏差不应导致 actual 被回写。应创建 forecast variance 和 revised forecast version。

## 10.5 Enterprise Reporting

Enterprise-specific report 可以按合同允许范围展示：

- Invoice、Payment、Refund、CreditNote；
- usage / service metric；
- SLA measurement；
- service credit；
- outstanding balance；
- market / business / store scope；
- tax summary；
- approved settlement summary。

不得默认展示：

- 其他 Enterprise 的数据；
- Agent 的 raw personal data；
- raw KYC / payout credential；
- 其他 Business 的 Contract / Invoice；
- Proxy 的全部成本、margin 或 treasury position；
- 内部安全弱点、攻击路径或未发布 incident facts。

## 10.6 Report Publication

ReportPublication 进入 `PUBLISHED` 前必须确认：

- report scope；
- audience permission；
- source freshness；
- actual / estimate / forecast labels；
- redaction；
- limitations；
- approval；
- expiry / refresh cadence；
- audit event。

---

# 11. Restatement / Correction / Reopen

## 11.1 Source Correction vs Report Restatement

| 类型 | 处理方式 | 是否改变 source |
|---|---|---|
| Source fact 错误 | 由 owner Domain correction / reversal / amendment | 会产生新的 source fact，不覆盖旧记录 |
| Mapping 错误 | 新 ReportingMapping + 新 ReportRun | 不改变 source |
| FX translation 错误 | 新 FXTranslationRun / report version | 不改变原始 transaction conversion |
| Tax correction | Tax amendment / CreditNote / DebitNote | 保留原 tax fact，追加 correction |
| Consolidation elimination 错误 | 新 ConsolidationRun | 不删除 entity facts |
| Policy interpretation 变化 | 新 policy version + prospective / restatement decision | 按批准范围处理 |
| Fraud / control failure | Incident / correction / restatement / notification | 保留证据和原始事实 |

## 11.2 Restatement Decision

ReportRestatement 必须判断：

- affected report / period / audience；
- source vs derived cause；
- materiality；
- tax / contract / customer impact；
- external disclosure；
- whether prior publication must be revoked；
- whether ComplianceEvidence / Trust Artifact is affected；
- whether LegalHold / incident applies；
- approval and communication owner。

## 11.3 Reopen Period

Reopen 只能由 authorized Finance owner 发起，并记录：

- period；
- reason；
- affected entities；
- source watermark；
- expected changes；
- downstream impact；
- approval；
- closeout / re-close gate。

Reopen 不等于允许任意写入历史。所有新 facts 仍需经过 Domain command、effective time 和 audit。

## 11.4 Published Report Revocation

已发布 report 因重大错误需要撤回时：

- 标记 `REVOKED` 或 `RESTATED`；
- 保留旧 artifact、发布时间和访问记录；
- 发布 replacement 或 limitation notice；
- 通知受影响 recipient；
- 关联 source correction / incident / finding；
- 重新生成 ComplianceEvidence / Board pack / Enterprise statement，如适用。

---

# 12. Compliance / Audit / Data Boundary

## 12.1 Evidence for Reporting Controls

Chapter 34 可引用：

- ReportSourceSnapshot；
- ReportRun checksum；
- mapping version；
- reconciliation result；
- FinancialClose；
- approval / review；
- TreasuryPosition reconciliation；
- RevenueAssessment evidence；
- CostAllocationRun；
- ReportPublication audit。

这些材料不得自动成为公共 assurance。必须绑定 ComplianceScope、period、control、classification 和 limitation。

## 12.2 Restricted Finance Data

以下数据默认 Restricted：

- bank / settlement account detail；
- treasury position；
- liquidity forecast；
- counterparty exposure；
- payroll / vendor cost；
- customer credit / receivable；
- tax registration / filing；
- revenue contract pricing；
- board / executive forecast；
- fraud / restatement investigation。

Enterprise、Support、Operations 和 API Client 只能获取绑定 scope 的摘要或 approved export。

## 12.3 Audit Trail

必须记录：

- report scope / period；
- source snapshot；
- mapping / policy / calculation version；
- run start / end；
- warnings / exclusions；
- reviewer / approver；
- publication / download / revoke；
- restatement / reopen；
- manual adjustment；
- data access。

不能只保留最终 PDF 而丢失生成过程。

## 12.4 Legal Hold / Retention

Report、source snapshot、reconciliation、restatement、tax、treasury 和 revenue evidence 的 retention 必须交叉考虑：

- Chapter 24 D0–D5；
- FinancialClose / tax filing obligation；
- Contract / invoice / dispute；
- ComplianceReview；
- LegalHold；
- data residency；
- audit / regulator request。

Retained 不等于普通用户可访问；过期材料也不能被无审计删除。

---

# 13. Access / SoD / Approval

## 13.1 Roles

| 角色 | 可做 | 不可做 |
|---|---|---|
| ReportingOwner | 定义 scope、mapping、report cadence | 修改 Ledger、Tax 或 Payment source |
| AccountingOwner | 关闭 period、review statement、批准 recognition posting | 单独修改原始交易事实 |
| TreasuryOwner | 计算 cash、forecast、movement proposal | 把 forecast 当 confirmed cash 或绕过 funding |
| TaxOwner | Tax / filing / remittance review | 仅凭 report 修改客户税额 |
| RevenueReviewer | review obligation、schedule、proposal | 直接创建 Ledger revenue entry |
| FinOpsOwner | cost allocation、budget、variance | 修改 actual cost / Agent Earnings |
| ConsolidationReviewer | elimination、FX translation、group report | 合并 Legal Entity ownership 或 source balance |
| ReportPublisher | 发布 approved report | 跳过 audience、redaction、freshness 或 limitation |
| EnterpriseViewer | 查看授权 statement / report | 查看其他 Enterprise、treasury 或 restricted finance data |
| ExternalAssessor | 在授权 scope 内查验 | 写入 source、mapping、Ledger、Tax 或 Treasury movement |

## 13.2 SoD Rules

默认禁止同一人独立完成：

- mapping author + sole report approver；
- treasury movement requester + sole approver；
- revenue schedule author + sole posting approver；
- cost allocation author + sole actual source owner；
- consolidation elimination proposer + sole reviewer；
- report author + sole external publisher；
- period reopen requester + sole re-close approver；
- restatement proposer + sole materiality approver。

## 13.3 Manual Adjustments

Manual adjustment 必须有：

- source / target；
- amount / currency；
- reason；
- effective period；
- policy / legal basis；
- reviewer；
- expected downstream effect；
- reversal / expiry，如适用；
- audit reference。

禁止用 undocumented spreadsheet override 覆盖系统 report total。

---

# 14. Operational Cadence

## 14.1 Daily

- CashAccountPosition mismatch；
- Payment / Payout / Settlement unknown backlog；
- available cash / reserve breach；
- provider / bank incident；
- FX rate expiry；
- critical report freshness；
- treasury movement pending approval；
- RevenueAssessment blocked；
- cost anomaly；
- access / export anomaly。

## 14.2 Weekly

- TreasuryPosition by entity / market / currency；
- liquidity forecast vs actual；
- settlement / tax / invoice reconciliation；
- FX exposure and concentration；
- revenue schedule changes；
- deferred balance aging；
- cost allocation variance；
- Enterprise statement dispute；
- open report findings。

## 14.3 Monthly

- soft / hard close；
- FinancialReport and ConsolidationRun；
- intercompany elimination；
- TaxFilingPeriod / remittance；
- RevenueRecognitionProposal review；
- budget / actual / forecast；
- ReportPublication inventory；
- ComplianceEvidence collection；
- exception and restatement register。

## 14.4 Quarterly

- chart of accounts / mapping review；
- FX / liquidity stress test；
- reserve policy review；
- revenue policy and contract modification review；
- cost allocation driver review；
- Legal Entity / Market / Provider scope change；
- Board / executive pack；
- external audit / assurance readiness。

## 14.5 Event-driven

立即触发 targeted review：

- Ledger correction or material mismatch；
- Tax rule / entity / filing change；
- Provider settlement outage；
- Payment / Payout / Refund reversal；
- FinancialClose reopen；
- material revenue contract modification；
- restatement / fraud / incident；
- liquidity buffer breach；
- FX exposure limit breach；
- new Market or Legal Entity；
- Enterprise contract price / scope change。

---

# 15. API / Command / Event Contract

## 15.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `CreateReportingScope` | ReportingOwner | 创建 scope / period / audience |
| `FreezeReportSourceSnapshot` | Reporting | 冻结报告输入 watermark 与 checksum |
| `RunFinancialReport` | Reporting | 创建 ReportRun / FinancialReport |
| `RunConsolidation` | Consolidation | 创建 group report / elimination proposal |
| `RunFXTranslation` | Treasury / Reporting | 创建 translation result |
| `ApproveIntercompanyElimination` | Accounting | 批准 reporting-layer elimination |
| `PublishFinancialReport` | ReportPublisher | 在 scope / audience 内发布 artifact |
| `RevokeFinancialReport` | Finance / Legal | 撤回并保留历史版本 |
| `CreateTreasuryPosition` | Treasury | 计算 confirmed / restricted / reserve / available cash |
| `RunLiquidityForecast` | Treasury | 创建 forecast / stress scenarios |
| `ApproveTreasuryMovement` | Treasury / Finance | 批准受控资金 movement |
| `SubmitTreasuryMovement` | Treasury | 幂等提交 movement |
| `CreateRevenueAssessment` | RevenueReviewer | 评估 obligation / transfer evidence |
| `CreateRevenueSchedule` | RevenueReviewer | 生成 recognition schedule |
| `ApproveRecognitionProposal` | Accounting | 批准 proposal 进入 posting path |
| `RunCostAllocation` | FinOps | 生成 cost allocation result |
| `PublishManagementReport` | Finance / Executive | 发布管理报表 |
| `ProposeReportRestatement` | Finance / Compliance | 创建 restatement proposal |
| `ApproveReportRestatement` | Accounting / Legal | 批准 replacement / notification |
| `ReopenReportingPeriod` | Accounting | 有审计地重新打开 period |

## 15.2 P0 Events

```text
ReportingScopeCreated
ReportingPeriodSoftClosed
ReportingPeriodHardClosed
ReportSourceSnapshotFrozen
FinancialReportRunCompleted
FinancialReportPublished
FinancialReportRevoked
ConsolidationRunCompleted
IntercompanyEliminationProposed
IntercompanyEliminationApproved
FXTranslationCompleted
TreasuryPositionReconciled
LiquidityForecastPublished
TreasuryRiskLimitBreached
ReservePolicyApplied
TreasuryMovementApproved
TreasuryMovementSubmitted
TreasuryMovementCompleted
TreasuryMovementUnknown
RevenueAssessmentCompleted
RevenueScheduleCreated
RecognitionProposalApproved
RecognitionProposalPosted
CostAllocationRunCompleted
ManagementReportPublished
ReportRestatementProposed
ReportRestatementApproved
ReportRestated
ReportingPeriodReopened
```

Event payload 只包含必要的 scope、period、currency、totals、references、status 和 limitation，不包含完整 bank credential、raw tax document、private key 或个人敏感数据。

## 15.3 Downstream Boundary

本章 events 可以通知：

- Chapter 34 ComplianceReview / Evidence；
- Chapter 35 FinancialClose / Reconciliation / TaxFiling；
- Enterprise Billing / Statement；
- RenewalReview / Expansion / Exit；
- Support / Customer Success；
- Board / Executive reporting；
- Incident / Risk / Treasury operations。

本章 events 不能未经 owned command 直接：

- 写 Ledger；
- 改 Payment / Refund / Payout；
- 改 Invoice / TaxFiling；
- 释放 Funding / Hold；
- 改 Order / Compensation / Agent Earnings；
- 改 LegalEntity、Contract、KYC 或 Safety state。

---

# 16. Acceptance Criteria

## AC-36-01 — Reporting Scope Required

FinancialReport、ManagementReport、TreasuryForecast、RevenueSchedule、CostAllocationRun 和 ConsolidationRun 必须绑定 Legal Entity / Market / Currency / Period / Scenario / Source scope。

## AC-36-02 — Source And Derived Separation

Report、forecast、consolidation、allocation 和 recognition schedule 必须与 Ledger、Payment、Invoice、Tax、Settlement 等 source facts 分离存储和审计。

## AC-36-03 — No Report Mutation

任何 reporting worker、dashboard 或 export 都不得直接修改 Ledger、Payment、Refund、Payout、Invoice、TaxFiling、Order 或 Contract 状态。

## AC-36-04 — Period Semantics

报告必须区分 transaction、service、invoice、payment、settlement、tax、accounting 和 report as-of time，不能只使用“本月”。

## AC-36-05 — Freshness Disclosure

Report 必须显示 source snapshot time、latest included event、pending / unknown backlog、refresh time、calculation version 和 close status。

## AC-36-06 — Mapping Version

ChartOfAccountsProfile、ReportingMapping 和 policy 变化必须版本化；历史 ReportRun 必须保留原 mapping / policy reference。

## AC-36-07 — Unmapped Visible

未知 account、entity、market、currency、tax category、counterparty、FX rate 或 revenue evidence 不得静默落入 Other，必须显示 unmapped / limitation / review required。

## AC-36-08 — Snapshot Integrity

ReportSourceSnapshot 必须记录 watermark、row / event count、currency / entity totals、unknown backlog、policy version 和 integrity hash。

## AC-36-09 — Period Close Gate

Hard close 前必须完成 Ledger、Invoice、Tax、Settlement、Payment、Payout、FX、Revenue、Reconciliation、approval 和 checksum checks。

## AC-36-10 — Late Event Handling

late event 必须保留 original time、received time、处理 period、materiality、approval 和 downstream impact，不能静默重排或删除。

## AC-36-11 — Consolidation Scope

ConsolidationGroup 必须明确 Legal Entity、ownership method、consolidation currency、intercompany、FX translation 和 calendar policy。

## AC-36-12 — Consolidation No Source Rewrite

Consolidation、elimination 或 adjustment 只能存在于 reporting layer，不得修改 entity Ledger、Invoice、Tax、Payment、Settlement 或 legal ownership。

## AC-36-13 — Intercompany Matching

Intercompany elimination 必须按 entity、counterparty、source document、amount、currency、period、settlement 和 tax context 匹配，不能只按金额匹配。

## AC-36-14 — FX Translation Disclosure

报告必须标明 rate source、rate type、translation date、currency、rounding、translation difference 和 policy version。

## AC-36-15 — Treasury Categories

TreasuryPosition 必须分离 confirmed cash、pending settlement、restricted cash、reserve、customer funds、payout hold、committed outflows 和 liquidity buffer。

## AC-36-16 — Available Cash Bounded

available cash 只能按批准公式从 confirmed cash 扣除 restricted、reserve、customer funds、committed outflows 和 minimum buffer；forecast / receivable / expected settlement 不得默认计入。

## AC-36-17 — Cash Reconciliation

CashAccountPosition 必须能够对账 bank / provider balance、Ledger cash、pending flow、reserve、settlement、transfer、FX 和 value date。

## AC-36-18 — Liquidity Forecast Labeled

LiquidityForecast 必须区分 confirmed、probable、receivable、expected settlement、committed outflow、stress scenario、probability 和 source，不得显示为实际现金。

## AC-36-19 — Treasury Movement Gate

TreasuryMovement 必须检查账户 ownership、entity、purpose、currency、KYC / sanctions、liquidity buffer、tax treatment、idempotency、SoD 和 reversal path。

## AC-36-20 — Reserve Policy

Reserve 必须有 policy、basis、source event、currency、owner、release condition、approval 和 Ledger / settlement reference；reserve 不等于 loss、revenue 或 available cash。

## AC-36-21 — FX Exposure

FX exposure 必须区分 actual、committed、forecast、translation，记录 currency mismatch、horizon、sensitivity、limit、mitigation 和 owner。

## AC-36-22 — Revenue Policy

RevenueRecognitionPolicy 必须定义 performance obligation、recognition basis、transfer evidence、variable consideration、refund / chargeback、modification 和 currency policy。

## AC-36-23 — Revenue Not Inferred

Contract signed、Invoice issued、Payment received、Order completed、Settlement received 或 Enterprise renewed 不得单独生成 revenue recognition 事实。

## AC-36-24 — Performance Obligation

每个 RevenueContract 必须记录 performance obligation、standalone price、allocated price、satisfaction method、period、evidence、cancellation 和 modification。

## AC-36-25 — Principal / Agent Review

涉及 Marketplace、Provider、Business 或 Enterprise 的收入必须经过 approved principal / agent 或等效的 Finance / Legal review，不得默认以 gross amount 作为 Proxy revenue。

## AC-36-26 — Revenue Schedule Version

RevenueSchedule 必须记录 recognized、deferred、remaining、refund / chargeback estimate、currency、policy、calculation version 和 source assessment；变化不能覆盖历史 schedule。

## AC-36-27 — Recognition Posting Boundary

RecognitionProposal 必须经过 Accounting / Finance review 和 Ledger owned posting command；proposal approved 不等于 Ledger posted。

## AC-36-28 — Contract Modification

Contract price、scope、cancellation、renewal 或 service credit 变化必须重新判断 obligation、allocation、variable consideration、Invoice、Tax、Ledger 和 report impact。

## AC-36-29 — Cost Source Classification

CostAllocationRun 必须区分 actual、accrued、estimate、forecast、direct、shared、allocated、unallocated、pass-through 和 subsidy。

## AC-36-30 — Cost Driver Governance

Cost allocation driver 必须有 period、source、owner、version、fallback 和 approval；不能为改善 KPI 临时改变 driver。

## AC-36-31 — Unit Economics Separation

dashboard 必须分开 cash collected、gross payment volume、recognized revenue、net revenue、contribution margin 和 available cash。

## AC-36-32 — Management Metric Definition

每个 KPI 必须有 formula、source priority、period、currency、timezone、freshness、owner、version 和 limitation。

## AC-36-33 — Audience And Redaction

ReportPublication 必须绑定 audience、permission、scope、redaction、freshness、limitation、approval、expiry 和 audit。

## AC-36-34 — Restatement Traceability

ReportRestatement 必须记录原报告、新报告、period、scope、原因、materiality、影响、通知、approval 和 source correction / incident reference。

## AC-36-35 — Reopen Is Controlled

已关闭 period 重新打开必须有 authorized owner、reason、affected scope、expected changes、approval、downstream impact 和 re-close gate，不能任意写历史。

## AC-36-36 — No Fabricated Financial Fact

系统不得因为 report total、forecast、budget、revenue schedule、treasury position、consolidation、cost allocation、management KPI 或 Board pack 自动生成 Ledger、Payment、Funding、Tax、Invoice、Payout 或 Contract 事实。

---

# 17. P0 / P1 Boundary

## 17.1 P0

- ReportingScope、ReportingPeriod、ChartOfAccountsProfile、ReportingMapping、ReportSourceSnapshot、ReportRun、FinancialReport；
- ConsolidationGroup、ConsolidationRun、IntercompanyElimination、FXTranslationRun、ReportPublication、ReportRestatement；
- TreasuryPosition、CashAccountPosition、LiquidityForecast、TreasuryMovement、ReservePolicy、TreasuryRiskExposure；
- RevenueRecognitionPolicy、RevenueContract、PerformanceObligation、RevenueAssessment、RevenueSchedule、RecognitionProposal；
- CostAllocationRun、CostAllocationResult、ManagementReport、FinancialMetricDefinition；
- source / derived separation；
- period / close / snapshot / freshness / mapping / checksum；
- cash / reserve / liquidity / FX / revenue / cost / KPI boundary；
- restatement / reopen / publication / audit / SoD；
- Ledger、Invoice、Tax、Settlement、Payment、Payout、Contract 和 Compliance cross-domain invariants；
- 36 项 AC-36 验收标准。

## 17.2 P1

- automated anomaly root-cause suggestions；
- probabilistic cash forecast；
- automated intercompany matching；
- scenario and sensitivity simulator；
- revenue schedule recommendation；
- AI-assisted management narrative；
- dynamic cost driver optimization；
- self-service Enterprise report builder；
- continuous close prediction；
- multi-currency hedge recommendation；
- external benchmark comparison。

P1 自动化不能改变 P0 的 source facts、posting boundary、Treasury movement approval、revenue policy、period close、restatement、access、SoD 或 Ledger invariant。

---

# 18. Locked Conclusions / Next Work

本章锁定：

```text
Financial Report 是版本化派生视图，不是新的交易事实
Consolidation 只做汇总、折算、抵消和受控 adjustment，不合并法律主体
Treasury 只管理 confirmed cash、hold、reserve、settlement 和 approved movement
Forecast、receivable、credit limit、expected settlement 不能默认成为 available cash
Revenue Recognition 需要 contract、performance obligation、transfer evidence 和 policy
RecognitionProposal 通过 Ledger owned command 才可能形成 posting
Cost Allocation 和 FinOps 只服务于经营分析、预算和治理
Management KPI 必须区分 actual、estimate、forecast、judgment 和 limitation
Period close、reopen、restatement 和 publication 必须可追溯、可审批、可撤回
任何 report、forecast 或 Board pack 都不能反向改写 Ledger、Invoice、Tax、Settlement 或 Contract
```

下一步进入：

```text
Chapter 37 — Financial Controls / Internal Audit / Risk Appetite / Board Governance
```

Chapter 37 将把本章的 Reporting、Treasury、Revenue、Cost、Close 与 Chapter 34 Compliance、Chapter 35 Settlement、Chapter 31 Enterprise Contract 统一到 Internal Control Library、Risk Appetite、Audit Plan、Board Escalation 和 remediation accountability。

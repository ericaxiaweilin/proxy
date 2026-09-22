# Proxy PRD v1.1

## Chapter 38 — Regulatory Change / Policy Migration / Market Re-Approval Governance

**文档类型**：Regulatory Change / Legal Interpretation / Policy Migration / Market Re-Approval / Contract Transition / Effective-date Governance  
**状态**：ACTIVE — Policy Change / Multi-Market Re-Approval Readiness  
**依赖**：Chapter 23 Policy Defaults / Configuration Registry、Chapter 27 Provider Integration / Market Launch Readiness、Chapter 31 Enterprise / B2B Scale / Contract Governance、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 35 Multi-Market Legal Entity / Tax / Currency / Settlement Governance、Chapter 36 Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance、Chapter 37 Financial Controls / Internal Audit / Risk Appetite / Board Governance  
**后续**：Chapter 39 Policy-as-Code / Runtime Decision / Explainability Governance

---

# 0. 本章目标

Proxy 在多个 Market、Provider、Legal Entity 和 Enterprise 中运行后，外部规则和内部 policy 会持续变化：

- 法律、监管、税率、申报、制裁、KYC / AML 要求变化；
- MarketLaunchProfile、ProviderCapability、Payment rail、SettlementAccount 变化；
- Privacy、Consent、Retention、DataResidency、Safety 和 Security policy 变化；
- EnterpriseContract、DPA、SLA、PriceSchedule、Payment terms 和 support obligation 变化；
- RiskAppetite、ControlDefinition、TaxRuleSet、RevenueRecognitionPolicy、ReservePolicy 和 PolicySetVersion 变化；
- Provider outage、assurance withdrawal、incident、audit finding 或 Board decision 需要立即变更运行边界。

本章把变化治理成可追踪的链路：

```text
Change Signal
→ Regulatory / Legal Interpretation
→ Scope and Impact Assessment
→ Policy / Control / Contract Mapping
→ Migration / Transition Plan
→ Approval and Effective-date Decision
→ Dual-version / Compatibility Window
→ Runtime Binding
→ Market Re-approval / Communication
→ Evidence / Monitoring
→ Closeout / Deprecation / Rollback
```

本章必须解决：

- 什么变化需要新 PolicySetVersion、ControlDefinition、TaxRuleSet、Contract version 或 MarketLaunchProfile；
- 变化影响哪些 Market、Legal Entity、Provider、Data class、Enterprise、Open Order、Payment、Payout、Invoice、Tax、Settlement、Report 和 Audit；
- 新规则如何从 discovery 进入 approved、effective、runtime binding 和 re-approval；
- 新规则生效前后如何并行支持 old / new version，而不让同一交易同时使用两个互相冲突的 policy；
- 历史已创建交易、已承诺合同、已发送 Invoice、已确认 Payment、已产生 Ledger 和已关闭 FinancialClose 如何保持原始事实；
- 过渡、沟通、培训、数据迁移、Provider cutover、rollback 和 decommission 如何可执行；
- 监管或客户要求无法立即实施时，如何用有限期 exception、containment、manual review 和 escalation 表达；
- Market 何时需要重新批准、暂停新流量、撤回 Trust Artifact 或重新签署 Contract。

本章不做：

- 不把“政策变化”当作修改历史 Order、Payment、Payout、Ledger、Invoice、Tax、KYC、Safety 或 Audit facts 的理由；
- 不让 PolicySetVersion、ChangeRequest、BoardDecision 或 LegalInterpretation 直接成为 Domain mutation；
- 不在没有 effective_at、scope、approval、migration test 和 rollback 的情况下切换 P0 policy；
- 不把客户通知、FAQ、培训完成或供应商证书当成已完成的法律 / 控制批准；
- 不把新规则默认追溯到所有 open / historical records；
- 不以配置 flag、旧 API、缓存或 UI 文案绕过新规则的 hard stop。

## 0.1 本章核心结论

```text
Change signal ≠ approved change
Legal interpretation ≠ runtime permission
Policy version ≠ historical rewrite
Effective date ≠ retroactive authorization
Migration success ≠ market approval
Customer communication ≠ consent / contract amendment by itself
Rollback ≠ delete facts
Re-approval ≠ universal compliance guarantee
```

## 0.2 Change Types

| 类型 | 例子 | 默认处理 |
|---|---|---|
| Regulatory | 法律、监管、税、KYC、AML、制裁、数据转移要求 | Legal / Compliance review + impact + effective date |
| Contractual | EnterpriseContract、DPA、SLA、PriceSchedule、Payment terms | Contract change + customer scope + migration |
| Policy | PolicySet、Risk、Safety、Privacy、Refund、Payout、Retention | 新版本 + test + runtime binding |
| Provider | ProviderConnection、Capability、Webhook、certificate、subprocessor | Provider change + market / data / failover review |
| Market | MarketLaunchProfile、entity、tax、currency、support、residency | MarketReapprovalReview |
| Control | ControlDefinition、evidence、audit procedure、risk limit | Control / Risk / Audit change review |
| Incident | P0 / P1 Security、Privacy、Safety、Money、Provider 事件 | containment + emergency change + retrospective |
| Data / Migration | schema、mapping、retention、residency、identity | MigrationProgram / mapping / reconcile / closeout |

---

# 1. Change Constitution

## 1.1 Canonical Change Envelope

所有 material change 必须使用 Chapter 30 已有的 `ChangeRequest` 或等效 canonical change envelope，并包含：

```text
change_id
change_type
source_signal_refs[]
requester
owner
affected_scope
current_versions
proposed_versions
reason
legal_or_business_basis
requested_effective_at
rollback_or_stop_condition
approval_route
```

不能只在代码提交、Provider 控制台、合同附件、Spreadsheet 或 Slack 消息里隐藏变化。

## 1.2 Change Is Not Runtime Yet

变化至少经历：

```text
PROPOSED
→ ASSESSED
→ MAPPED
→ APPROVED
→ SCHEDULED
→ EFFECTIVE
→ MONITORED
→ CLOSED / SUPERSEDED / ROLLED_BACK
```

`PROPOSED`、`ASSESSED` 或 `APPROVED` 不能自动被 runtime 读取为 ACTIVE policy。

## 1.3 Version Before Mutation

以下变化必须产生新版本或新 snapshot：

- PolicyDefinition / PolicySetVersion；
- MarketLaunchProfile；
- TaxRuleSet / MarketTaxProfile；
- RiskAppetite / RiskLimit / ControlDefinition；
- EnterpriseContract / DPA / SLA / PriceSchedule；
- ProviderConnection / ProviderCapability；
- Retention / Privacy / Consent / DataResidency policy；
- RevenueRecognitionPolicy / ReservePolicy；
- API / event schema 或 mapping。

不允许原地修改已经被交易、ReportRun、ComplianceReview、AuditWorkpaper 或 Contract 引用的版本。

## 1.4 Scope Before Effective Date

所有 change 必须明确：

- 适用 Market / MarketCell；
- Legal Entity；
- Provider / rail；
- Enterprise / Business scope；
- data category；
- order / payment / payout / invoice scope；
- environment；
- effective_at；
- timezone；
- grandfather / transition rule；
- excluded scope。

没有 scope 的 effective date 不可执行。

## 1.5 Historical Fact Protection

新规则默认只适用于：

- effective_at 之后新创建的对象；
- policy 规定的 open object transition；
- explicit amendment / re-determination；
- legal / regulatory required retrospective correction；
- approved migration batch。

历史事实必须保留创建时的 PolicySnapshot、Contract version、TaxRuleSet、RiskDecision、Provider operation、Consent、Ledger、Invoice 和 Audit references。

## 1.6 Hard Invariant Cannot Be Configured Off

任何 change 都不能关闭或削弱：

- no split-brain Ledger；
- no duplicate irreversible Payment / Refund / Payout；
- KYC / AML / Sanctions hard stop；
- Safety emergency / Incident response；
- Consent / Privacy / D4 / D5 boundary；
- LegalHold / Audit preservation；
- idempotency / reconciliation；
- least privilege / step-up / SoD；
- unknown provider result handling；
- no silent identity merge；
- source / derived fact separation。

## 1.7 Emergency Change

P0 事件可以先执行 emergency containment，但必须：

- 记录 emergency ChangeRequest；
- 限定 scope、TTL 和 action；
- 保留旧版本和原始 facts；
- 指定 Incident Commander / owner；
- 触发 RiskDecision、ComplianceReview 或 Board escalation，如适用；
- 在 policy deadline 内完成 retrospective approval / rejection；
- 评估 customer、Enterprise、Provider、Market 和 regulator communication。

---

# 2. Regulatory / Legal Change Objects

## 2.1 RegulatoryChangeNotice

```text
RegulatoryChangeNotice
├── id
├── issuer_type: REGULATOR / COURT / TAX_AUTHORITY / PROVIDER / CONTRACT / INTERNAL
├── issuer_ref
├── title
├── source_reference
├── issued_at
├── published_at?
├── effective_at?
├── jurisdiction_refs[]
├── market_refs[]
├── entity_refs[]
├── obligation_summary
├── urgency: INFORMATIONAL / PLANNED / URGENT / IMMEDIATE
├── authenticity_status: UNVERIFIED / VERIFIED / DISPUTED
├── owner_ref
├── status: NEW / TRIAGED / ASSESSED / IMPLEMENTING / SATISFIED / CLOSED / REJECTED
└── audit_ref
```

未经验证的 notice 可以触发 triage，但不能直接改变 runtime policy。

## 2.2 RegulatoryRequirement

```text
RegulatoryRequirement
├── id
├── notice_ref
├── jurisdiction_ref
├── obligation_code
├── obligation_text
├── applicability_conditions[]
├── prohibited_conditions[]
├── required_controls[]
├── required_records[]
├── retention_requirements[]
├── reporting_requirements[]
├── effective_from
├── effective_to?
├── interpretation_status: PROPOSED / REVIEWED / APPROVED / REJECTED
├── legal_owner
├── compliance_owner
└── audit_ref
```

## 2.3 LegalInterpretation

```text
LegalInterpretation
├── id
├── requirement_ref
├── question
├── jurisdiction_ref
├── facts_considered[]
├── interpretation
├── assumptions[]
├── exclusions[]
├── confidence: HIGH / MEDIUM / LOW / DISPUTED
├── legal_basis_refs[]
├── reviewer_refs[]
├── issued_at
├── expires_at?
├── supersedes_ref?
├── status: DRAFT / REVIEW / APPROVED / SUPERSEDED / WITHDRAWN
└── audit_ref
```

LegalInterpretation 是适用性判断，不是 runtime permission。低 confidence 或 disputed interpretation 必须触发 conservative path、manual review 或 re-approval。

## 2.4 ObligationMapping

```text
ObligationMapping
├── id
├── requirement_ref
├── interpretation_ref
├── source_domain
├── target_policy_refs[]
├── target_control_refs[]
├── target_contract_refs[]
├── target_market_refs[]
├── target_data_categories[]
├── gap_refs[]
├── mapping_method
├── owner_ref
├── reviewed_by[]
├── version
└── audit_ref
```

## 2.5 ChangeImpactAssessment

```text
ChangeImpactAssessment
├── id
├── change_request_ref
├── source_notice_refs[]
├── affected_markets[]
├── affected_entities[]
├── affected_providers[]
├── affected_products[]
├── affected_data_categories[]
├── affected_contracts[]
├── affected_objects[]
├── impact_dimensions: LEGAL / TAX / SAFETY / PRIVACY / SECURITY / MONEY / FINANCE / OPERATIONS / PROVIDER / SUPPORT / REPUTATION
├── historical_scope
├── open_object_scope
├── new_object_scope
├── customer_impact
├── control_impact
├── risk_assessment_refs[]
├── effort / dependency_summary
├── rollback_feasibility
├── assessed_by
├── status: DRAFT / REVIEW / APPROVED / SUPERSEDED
└── audit_ref
```

## 2.6 ChangeMaterialityDecision

```text
ChangeMaterialityDecision
├── id
├── change_request_ref
├── materiality: LOW / MEDIUM / HIGH / CRITICAL
├── rationale
├── affected_claims[]
├── requires_market_reapproval
├── requires_contract_amendment
├── requires_board_escalation
├── requires_customer_notice
├── requires_regulator_notice
├── requires_data_migration
├── approved_by[]
└── audit_ref
```

---

# 3. Policy Change / Mapping Model

## 3.1 Chapter 23 Policy Objects

Chapter 23 已定义 PolicySet、PolicyDefinition、Policy Snapshot / Version 规则。本章将以下对象视为 canonical policy layer：

```text
PolicySetVersion
PolicyDefinition
PolicySnapshot
```

变化治理不能重新发明第二套 policy object。新增的是 change、mapping、migration、effective binding 和 re-approval 记录。

## 3.2 PolicyChangeProposal

```text
PolicyChangeProposal
├── id
├── change_request_ref
├── current_policy_refs[]
├── proposed_policy_refs[]
├── change_type: NEW / TIGHTEN / RELAX / SPLIT / MERGE / DEPRECATE / EMERGENCY
├── affected_domains[]
├── behavior_diff
├── invariant_impact
├── policy_snapshot_impact
├── test_requirements[]
├── rollout_strategy
├── rollback_strategy
├── owner_ref
├── approver_refs[]
├── effective_at
├── status: DRAFT / REVIEW / APPROVED / SCHEDULED / EFFECTIVE / REJECTED / SUPERSEDED
└── audit_ref
```

## 3.3 PolicyImpactAssessment

```text
PolicyImpactAssessment
├── id
├── policy_change_ref
├── affected_policy_refs[]
├── affected_domain_states[]
├── affected_commands[]
├── affected_events[]
├── affected_read_models[]
├── affected_permissions[]
├── affected_metrics[]
├── affected_contract_terms[]
├── affected_open_objects[]
├── historical_fact_policy
├── compatibility_risk
├── safety_risk
├── privacy_risk
├── money_risk
├── operational_risk
├── required_test_refs[]
├── reviewer_refs[]
└── audit_ref
```

## 3.4 PolicyMapping

```text
PolicyMapping
├── id
├── old_policy_ref
├── new_policy_ref
├── mapping_type: SAME / TIGHTENED / RELAXED / SPLIT / MERGED / NO_EQUIVALENT / RETIRED
├── old_value
├── new_value
├── affected_state_transitions[]
├── affected_snapshots[]
├── grandfather_rule
├── required_manual_review
├── incompatibility_reason?
├── owner_ref
├── approved_by[]
├── effective_at
└── audit_ref
```

## 3.5 PolicyMigrationPlan

```text
PolicyMigrationPlan
├── id
├── policy_change_ref
├── scope_ref
├── mapping_refs[]
├── migration_mode: NO_MIGRATION / NEW_ONLY / LAZY / BATCH / DUAL_READ / DUAL_VERSION / MANUAL_REVIEW
├── population_definition
├── batch_strategy
├── ordering_rules
├── idempotency_key_strategy
├── quarantine_rules[]
├── rollback_rules[]
├── success_criteria[]
├── stop_conditions[]
├── communication_plan_ref?
├── training_plan_ref?
├── owner_ref
├── status: DRAFT / REVIEW / DRY_RUN / PILOT / CUTOVER / VALIDATING / COMPLETE / PAUSED / ROLLED_BACK
└── audit_ref
```

## 3.6 PolicyMigrationBatch

```text
PolicyMigrationBatch
├── id
├── migration_plan_ref
├── batch_number
├── source_snapshot_ref
├── target_version_ref
├── population_count
├── migrated_count
├── skipped_count
├── quarantined_count
├── failed_count
├── checksums[]
├── dry_run_ref?
├── rollback_ref?
├── started_at
├── completed_at?
├── status: PLANNED / RUNNING / PARTIAL / COMPLETE / FAILED / QUARANTINED / ROLLED_BACK
└── audit_ref
```

## 3.7 EffectivePolicyBinding

```text
EffectivePolicyBinding
├── id
├── policy_set_version_ref
├── scope_ref
├── environment
├── effective_at
├── expiry_at?
├── precedence_rules
├── compatible_prior_version_refs[]
├── snapshot_requirement
├── rollout_stage
├── approval_refs[]
├── status: SCHEDULED / ACTIVE / PAUSED / EXPIRED / REVOKED / SUPERSEDED
└── audit_ref
```

Runtime 只能使用 `ACTIVE` binding，并且必须按照 scope、effective time、precedence 和 PolicySnapshot 解析。

## 3.8 PolicyCompatibilityWindow

```text
PolicyCompatibilityWindow
├── id
├── old_version_ref
├── new_version_ref
├── scope_ref
├── start_at
├── end_at
├── allowed_operations[]
├── forbidden_operations[]
├── conversion_rules[]
├── conflict_resolution
├── monitoring_refs[]
├── exit_criteria[]
├── owner_ref
└── status: PLANNED / ACTIVE / EXPIRING / CLOSED / ABORTED
```

Compatibility window 不是永久双轨。超过 end_at 的 old version 必须被 retire、migrate 或明确 re-approve。

## 3.9 PolicyDeprecationRecord

```text
PolicyDeprecationRecord
├── id
├── policy_ref
├── replacement_policy_ref?
├── deprecation_reason
├── last_new_use_at
├── last_existing_use_at?
├── migration_plan_ref?
├── dependent_scope_refs[]
├── communication_refs[]
├── archive_policy_ref
├── status: ANNOUNCED / DRAINING / RETIRED / BLOCKED / REVOKED
└── audit_ref
```

Policy retired 后仍需保留历史 snapshot、transaction reference、audit 和 report lineage。

---

# 4. Impact Assessment / Domain Boundaries

## 4.1 Required Impact Dimensions

ChangeImpactAssessment 至少检查：

```text
Legal / Regulatory
Market / Legal Entity / Tax
KYC / AML / Sanctions
Safety / Incident
Privacy / Consent / Retention / Residency
Security / Access / Secrets
Payment / Payout / Ledger / Funding
Invoice / Revenue / FinancialClose
Provider / Webhook / Reconciliation
Contract / SLA / Price / DPA
Capacity / Availability / Region
Migration / Backfill / Identity
Support / Training / Communication
Trust Center / Audit / Board reporting
```

## 4.2 Historical / Open / New Classification

每个 change 必须把对象分成：

| 类别 | 默认规则 |
|---|---|
| Historical closed | 保留原 snapshot / fact；只有法律或 approved correction 才重评估 |
| Historical open | 按 transition rule 判断是否继续 old policy、迁移或 manual review |
| Newly created | effective_at 后使用新 policy |
| In-flight irreversible | 先安全完成、hold 或 reconcile，不随意切换 provider / rule |
| Contracted obligation | 按 contract version / amendment / notice 处理 |
| Report / close | 以 period、materiality、restatement 和 source policy 处理 |
| Compliance evidence | 重新评估 freshness、scope、claim 和 assurance |

## 4.3 Domain Change Matrix

| Domain | 变化可能影响 | 不能自动做的事 |
|---|---|---|
| Safety | admission、block、emergency、support | 不批量取消既有 Order |
| KYC / AML | required level、documents、expiry、provider | 不把旧 flag 自动升级 VERIFIED |
| Privacy | purpose、consent、retention、residency | 不扩大访问或删除 LegalHold |
| Payment | rail、3DS、currency、retry、refund | 不重复扣款或覆盖 Payment status |
| Ledger | chart mapping、posting policy、close | 不覆盖既有 Ledger entry |
| Tax | rule、registration、invoice、filing | 不静默改历史 tax line |
| Provider | capability、route、webhook、subprocessor | 不把 certificate 当作 Proxy control |
| Contract | price、SLA、DPA、payment terms | 不单方面改客户已签条款 |
| Market | entity、legal、support、currency、launch | 不在未 re-approve 时 ACTIVE |
| Report | mapping、FX、recognition、cost | 不把 derived view 写回 source |

## 4.4 Risk / Control Review

Change 必须关联 Chapter 37 的：

- RiskAssessment；
- RiskLimit；
- RiskDecision；
- RiskAcceptance，如需要；
- ControlDefinition / ControlAssessment；
- InternalAuditPlan / Engagement，如 material；
- BoardEscalation，如达到门槛。

## 4.5 Finance Impact Review

涉及 Money / Tax / Report 的 change 必须检查：

- LegalEntityAssignment；
- TaxRuleSet / TaxDetermination；
- Currency / FX；
- PaymentRail / SettlementAccount；
- Invoice / CreditNote；
- FinancialClose；
- TreasuryPosition / liquidity；
- RevenueRecognitionPolicy / Schedule；
- CostAllocation / reporting mapping；
- restatement / customer statement。

## 4.6 Privacy / Data Impact Review

涉及数据的 change 必须检查：

- D0–D5 category；
- purpose / consent；
- access / role / API scope；
- retention / LegalHold；
- residency / provider / subprocessor；
- export / deletion；
- de-identification / redaction；
- incident / notification。

## 4.7 Contract / Customer Impact Review

需要 Enterprise / Business review 的情况包括：

- scope / Market / Legal Entity 变化；
- price / tax / currency / payment terms；
- SLA / service credit；
- DPA / data residency；
- SSO / SCIM / API compatibility；
- audit / export rights；
- retention / deletion；
- feature retirement；
- support / training / migration window。

客户沟通不能替代合同 amendment、required consent 或 legal notice。

---

# 5. Migration / Transition Governance

## 5.1 Migration Modes

变化可采用：

```text
NEW_ONLY
NO_MIGRATION
LAZY_MIGRATION
BATCH_MIGRATION
DUAL_READ
DUAL_VERSION
MANUAL_REVIEW
HARD_CUTOVER
```

默认优先 `NEW_ONLY` 或 `MANUAL_REVIEW`，除非双轨的 authority、conflict 和 closeout 已被证明。

## 5.2 No Uncontrolled Dual-write

不得对以下 canonical facts 进行无 fencing dual-write：

- PaymentIntent；
- Refund；
- Payout；
- Ledger；
- Order / TaskSlot；
- KYC decision；
- Safety Incident / Block；
- Invoice number sequence；
- TaxFilingPeriod；
- FinancialClose。

可以对 rebuildable read model、analytics 或 proposal 做 shadow，但必须标记非 canonical。

## 5.3 Migration Preflight

PolicyMigrationPlan 进入 DRY_RUN 前必须有：

- old / new version；
- population；
- mapping；
- unknown / conflict rule；
- idempotency；
- checksum；
- rollback / stop；
- data retention；
- permissions；
- audit event；
- owner / reviewer；
- sample / dry-run success criteria。

## 5.4 Dry Run

Dry run 必须：

- 不产生真实 Payment、Payout、Ledger、Invoice、TaxFiling 或 external notification mutation；
- 使用 production-like schema / policy snapshot；
- 输出 match、unknown、conflict、skip、error 和 expected downstream impact；
- 记录 source checksum；
- 允许重复运行并比较结果；
- 对 raw sensitive data 采用受控 / 脱敏方式。

## 5.5 Pilot Batch

Pilot batch 必须选择有代表性的：

- Market / Legal Entity；
- Enterprise / Business；
- roles / permissions；
- policy values；
- provider / rail；
- open / historical objects；
- currency / tax class；
- privacy / residency class。

Pilot batch 失败时不得自动扩大到全量。

## 5.6 Quarantine

至少以下情况进入 quarantine：

- unknown policy value；
- conflicting scope；
- missing Legal Entity / Tax / Provider approval；
- old snapshot cannot map to new policy；
- open Payment / Payout / Ledger operation；
- identity / Business ownership ambiguity；
- retention / residency conflict；
- Contract amendment missing；
- report / close period impact unresolved；
- incompatible API / webhook schema。

Quarantine 必须有 owner、reason、next action、due date 和 safe read / support path。

## 5.7 CutoverDecision

Chapter 33 已有 `CutoverDecision`。本章要求 PolicyMigrationPlan 复用该对象，并增加：

```text
policy_old_version_refs[]
policy_new_version_refs[]
scope_ref
evidence_refs[]
reconciliation_refs[]
open_quarantine_count
open_irreversible_operations
communication_status
rollback_target
decision: GO / CONDITIONAL_GO / HOLD / ROLLBACK / RETIRE
```

## 5.8 Cutover Lock

Cutover lock 期间必须冻结：

- policy scope；
- provider route；
- migration population；
- effective time；
- approval；
- rollout stage；
- rollback target；
- customer communication version；
- support runbook。

未经 ChangeRequest 的紧急变更不得在 lock 期间修改这些内容。

## 5.9 Rollback

Rollback 可以：

- 停止新 policy binding；
- 将新对象路由回 approved prior version；
- 转入 manual review；
- 暂停 new writes / admission / payout / publication；
- 重新 reconcile in-flight operations；
- 发布 correction / communication；
- 保留已产生的 new-version facts。

Rollback 不能：

- 删除已经成功的 Payment / Payout / Ledger / Invoice / Tax / Audit facts；
- 将已执行的 policy pretend as never happened；
- 覆盖 PolicySnapshot；
- 删除失败 batch / quarantine evidence；
- 让 old version 重新接受已不合法的新对象。

## 5.10 Post-cutover Validation

Cutover 后至少验证：

- binding / precedence；
- new / old population count；
- unknown / quarantine；
- command / event schema；
- permissions / API scope；
- Payment / Ledger / Invoice / Tax / Settlement reconciliation；
- Safety / KYC / Privacy behavior；
- provider callback / retry；
- report / Compliance / audit evidence；
- support / customer issue；
- stop conditions。

---

# 6. Policy Runtime / Effective Date

## 6.1 Effective Date Rules

EffectivePolicyBinding 必须明确：

- UTC / market timezone；
- object creation vs state transition；
- open object treatment；
- retry / callback treatment；
- scheduled job treatment；
- cache invalidation；
- read model refresh；
- manual review fallback；
- clock skew / outage behavior。

## 6.2 New Object Default

默认：

```text
new Task / Order / Payment / Payout / Invoice / Consent
created after effective_at
→ new policy, if scope matches
```

但 P0 safety、KYC、sanctions、privacy 或 legal change 可能要求 open object re-review。此时必须有 explicit transition rule，不能由 worker 猜测。

## 6.3 Open Object Transition

对已经创建但未关闭的对象，必须分类：

- continue under old snapshot；
- apply new policy at next state transition；
- pause and manual review；
- migrate to new version；
- cancel / safe exit through Domain command；
- legally required re-determination。

每一类都必须写入 PolicyMigrationPlan 和 customer / operator behavior。

## 6.4 Policy Precedence

Runtime policy resolution 顺序：

```text
Canonical Invariant / Legal Hard Stop
→ Market / Legal Entity approved binding
→ Enterprise Contract entitlement, if allowed
→ PolicySetVersion
→ Object PolicySnapshot
→ Runtime RiskDecision / Safety hold
```

下层不能覆盖上层 hard stop。Enterprise Contract、UI、A/B test、Provider preference 或 Support manual action 不能覆盖 Legal / Safety / Privacy / Money invariant。

## 6.5 Cache / Read Model

Policy cache 必须带：

- version；
- scope；
- effective_at；
- expiry；
- source hash；
- invalidation event；
- stale behavior。

缓存 stale 时，P0 action 默认 deny、pending 或 manual review，不能继续使用未批准旧 policy。

## 6.6 Clock / Replay

Policy evaluation 必须使用 authoritative event time / effective time，并处理：

- clock skew；
- delayed event；
- retry；
- replay；
- duplicate callback；
- out-of-order state transition。

重放事件不得因为新 policy 而重复创建 Payment、Payout、Invoice、Ledger 或 notification mutation。

## 6.7 Policy Conflict

当两个 active binding 冲突时：

- 不随机选择；
- 使用明确 precedence；
- 若无法判定，进入 `POLICY_CONFLICT_REVIEW`；
- 对不可逆操作 deny / hold；
- 记录 conflict、scope、versions、owner 和 resolution。

## 6.8 Feature Flag Boundary

Feature flag 只能控制已批准 policy / experiment scope，不能：

- 关闭 KYC / Safety / Privacy / Ledger invariant；
- 降低已批准 hard limit；
- 修改 historical snapshot；
- 绕过 audit / consent / step-up；
- 让未批准 Market / Provider 进入 ACTIVE。

---

# 7. Market Re-Approval Governance

## 7.1 MarketReapprovalReview

```text
MarketReapprovalReview
├── id
├── market_ref
├── trigger_type: REGULATORY / POLICY / PROVIDER / ENTITY / TAX / CURRENCY / PRIVACY / SAFETY / INCIDENT / CONTRACT / AUDIT
├── change_request_refs[]
├── current_profile_ref
├── proposed_profile_ref
├── affected_provider_refs[]
├── affected_entity_refs[]
├── affected_policy_refs[]
├── affected_contract_refs[]
├── approval_matrix
├── control_health_ref
├── risk_assessment_refs[]
├── migration_plan_refs[]
├── customer_communication_ref?
├── go_no_go_decision?
├── owner_ref
├── status: SCOPING / ASSESSING / REMEDIATING / READY / APPROVED / HOLD / REJECTED / CLOSED
└── audit_ref
```

## 7.2 Re-approval Triggers

Market 至少在以下变化后重新评估：

- Legal / tax / KYC / AML / sanctions；
- Legal Entity role / registration；
- Payment rail / payout currency / SettlementAccount；
- Provider capability / subprocessor / certificate；
- privacy purpose / residency / retention；
- Safety / high-risk task / emergency support；
- Pricing / compensation / refund / cancellation；
- Contract / DPA / SLA / audit rights；
- Risk appetite / hard limit；
- material Incident / finding / report restatement；
- region / capacity / support / rollback；
- policy migration with open object impact。

## 7.3 Approval Matrix

根据 scope，至少检查：

| Owner | 检查 |
|---|---|
| Legal | obligation、liability、terms、jurisdiction |
| Tax / Finance | entity、tax、currency、invoice、settlement、close |
| KYC / AML | identity、document、sanctions、manual review、retention |
| Privacy | purpose、consent、D0–D5、residency、deletion |
| Safety / Risk | prohibited、admission、incident、support、block |
| Security | access、secret、webhook、audit、resilience |
| Provider | capability、route、callback、quota、failover |
| Product | scope、UX、template、notification、metrics |
| Engineering | schema、migration、load、observability、rollback |
| Support / Operations | runbook、training、SLA、case routing |
| Enterprise / Contract | customer scope、amendment、DPA、notice |

## 7.4 Reapproval Decision

```text
APPROVED
CONDITIONAL_APPROVED
HOLD
PAUSE
REJECTED
RETIRE
```

`CONDITIONAL_APPROVED` 必须列出未完成条件、owner、due date、compensating controls、scope 和 expiry。

## 7.5 Approved vs Active

继续保持 Chapter 27 的边界：

- `APPROVED` 表示必要设计、审查和条件已满足；
- `ACTIVE` 还要求 provider、runtime binding、support、monitoring、migration 和 go-live lock 完成；
- `PAUSED` / `RETIRED` 不能接受新的不符合当前 profile 的操作；
- 既有 Order、Payment、Payout、Safety、LegalHold 和 Audit facts 按独立规则处理。

## 7.6 Conditional Approval

Conditional approval 不能用于：

- 缺失法定 KYC / Sanctions approval；
- 缺失 Safety emergency path；
- 未验证 payout / settlement account；
- 未解决 duplicate money operation；
- raw sensitive data boundary 未完成；
- 无法保护 Ledger / Audit facts；
- 无法 rollback 或 reconcile irreversible operation。

---

# 8. Contract / Provider / Data Transition

## 8.1 Contract Transition

涉及 EnterpriseContract 的 change 必须明确：

- current contract version；
- proposed amendment / new contract；
- effective date；
- existing order / invoice treatment；
- pricing / tax / currency；
- SLA / service credit；
- DPA / residency；
- audit / export；
- customer notice / consent；
- non-acceptance / exit path。

系统不能只更新内部 PolicySet，就让客户承担未同意的合同义务。

## 8.2 Provider Transition

Provider change 必须复用 Chapter 27 的 cutover / drain / reconciliation，并增加：

- subprocessor / data processing；
- certificate / assurance；
- provider legal entity；
- settlement account；
- API / webhook compatibility；
- in-flight operations；
- retry / idempotency；
- customer / market impact；
- old provider retirement。

## 8.3 Data Policy Transition

Retention、purpose、residency、consent、export 或 deletion change 必须：

- 标记旧 / 新 data policy；
- 分类 historical / open / new records；
- 检查 LegalHold；
- 重新评估 Provider / subprocessor；
- 处理 user / customer notice；
- 生成 migration / deletion / redaction plan；
- 验证 access / export / deletion evidence；
- 更新 ComplianceEvidence / Trust Artifact。

## 8.4 Safety / KYC Transition

新 safety / KYC requirement 生效时：

- 新对象按新 gate；
- 已 verified / approved 的状态检查 expiry、scope 和 required re-verification；
- 不能把旧 provider flag 直接映射为新等级；
- 新规则要求人工 review 时必须提供 safe pending path；
- Safety / KYC change 不能删除过去的 decision / attempt / incident evidence；
- 不合格的 open object 由 Safety / KYC owned command 处理。

## 8.5 Finance / Tax Transition

Tax / currency / settlement / revenue policy change 必须：

- 绑定 Legal Entity、Market、period 和 effective time；
- 处理 open Invoice、Payment、Refund、Payout、Settlement；
- 保存旧 TaxRuleSet / FX / Revenue policy snapshot；
- 评估 FinancialClose、restatement、credit / debit note；
- 更新 Treasury / liquidity / reserve；
- 重新收集 Compliance / Audit evidence；
- 不直接覆盖 historical tax / Ledger / settlement facts。

## 8.6 Report Transition

报告 mapping、KPI、FX translation、Revenue schedule 或 cost driver 变化必须：

- 新版本 mapping / metric；
- old → new comparability note；
- effective period；
- historical report treatment；
- restatement decision；
- Board / Enterprise / Compliance audience impact；
- source snapshot lineage。

---

# 9. Communication / Training / Support

## 9.1 ChangeCommunicationPlan

```text
ChangeCommunicationPlan
├── id
├── change_request_ref
├── audience_refs[]
├── message_type: NOTICE / CONSENT / CONTRACT / RELEASE / INCIDENT / TRAINING / FAQ
├── channels[]
├── language_refs[]
├── content_version
├── effective_at
├── required_acknowledgement
├── fallback_channel
├── owner_ref
├── approval_refs[]
├── delivery_evidence_refs[]
└── status: DRAFT / REVIEW / APPROVED / SCHEDULED / SENT / PARTIAL / FAILED / CLOSED
```

## 9.2 Communication Rules

Communication 必须说明：

- change 是什么；
- 何时生效；
- 影响谁 / 哪些 scope；
- 用户 / Enterprise 需要做什么；
- 未接受 / 无法迁移时的路径；
- 旧事实和新行为的区别；
- support / dispute / appeal contact；
- privacy / legal basis，如适用。

不能用“系统升级”“体验优化”掩盖支付、税、隐私、KYC、合同或 Safety 影响。

## 9.3 Consent / Contract Boundary

以下场景不能只发通知：

- required consent 变化；
- material DPA / privacy purpose；
- price / payment / currency / tax terms；
- SLA / liability / audit rights；
- data residency / subprocessor；
- termination / renewal；
- safety / high-risk obligations。

需要 consent / amendment / acceptance 时，必须走对应 Contract / Consent / Legal flow。

## 9.4 TrainingMigrationPlan

```text
TrainingMigrationPlan
├── id
├── change_request_ref
├── role_refs[]
├── learning_objectives[]
├── policy_refs[]
├── scenarios[]
├── completion_requirements
├── assessment_method
├── support_material_refs[]
├── due_at
├── owner_ref
├── evidence_refs[]
└── status: DRAFT / ACTIVE / COMPLETE / OVERDUE / RETIRED
```

高风险 operator、Support、Finance、Tax、KYC、Safety、Security 和 Enterprise Admin 的 training 在 change effective 前必须完成或有 approved supervised path。

## 9.5 Support Readiness

Change active 前，Support / Operations 必须具备：

- new / old policy explanation；
- known limitation；
- safe fallback；
- case routing；
- escalation；
- refund / dispute / appeal path；
- customer / Enterprise communication；
- data access restriction；
- rollback / pause behavior。

## 9.6 Adoption / Feedback

Change closeout 记录：

- training completion；
- support volume；
- user / Enterprise complaints；
- misinterpretation；
- policy conflict；
- error / rollback；
- fairness / safety / privacy signal；
- contract / renewal impact。

反馈不能自动变成 policy exception；必须进入 ChangeRequest / Risk / Product / Legal review。

---

# 10. Monitoring / Evidence / Closeout

## 10.1 ChangeReadinessSnapshot

```text
ChangeReadinessSnapshot
├── id
├── change_request_ref
├── scope_ref
├── current_stage
├── approval_status
├── policy_binding_status
├── migration_status
├── provider_status
├── contract_status
├── training_status
├── support_status
├── monitoring_status
├── open_quarantine_count
├── open_finding_count
├── risk_limit_status
├── rollback_readiness
├── generated_at
├── limitation_refs[]
└── audit_ref
```

## 10.2 Change Evidence

Chapter 34 `ComplianceEvidence` 可以引用：

- RegulatoryChangeNotice authenticity；
- LegalInterpretation；
- ImpactAssessment；
- policy diff / mapping；
- migration batch checksum；
- test result；
- MarketReapprovalReview；
- communication delivery；
- training completion；
- cutover / rollback drill；
- post-effective monitoring；
- closeout decision。

## 10.3 Monitoring Window

每次 material change 必须设置 observation window，覆盖：

- policy evaluation error；
- conflict / unknown；
- command reject；
- Payment / Payout / Ledger / Invoice / Tax / Settlement mismatch；
- KYC / Safety / Privacy signal；
- provider callback / retry；
- report / metric drift；
- support / customer issue；
- limit breach；
- rollback trigger。

## 10.4 Stop Conditions

Change 必须暂停、rollback 或升级的条件包括：

- hard invariant violation；
- unknown policy binding；
- duplicate irreversible operation；
- data residency / raw sensitive exposure；
- KYC / Safety / Sanctions bypass；
- wrong entity / tax / currency；
- material reconciliation mismatch；
- critical Provider failure；
- Contract / legal obligation unmet；
- support / training unable to contain harm；
- evidence or approval invalidated。

## 10.5 CloseoutDecision

```text
CloseoutDecision
├── id
├── change_request_ref
├── effective_binding_refs[]
├── migration_batch_refs[]
├── reconciliation_refs[]
├── open_finding_refs[]
├── remaining_risk_refs[]
├── observation_window
├── success_criteria_results[]
├── rollback_available_until?
├── decision: COMPLETE / COMPLETE_WITH_LIMITATION / EXTEND / PAUSE / ROLLBACK / RETIRE
├── approved_by[]
└── audit_ref
```

## 10.6 Deprecation / Retirement

旧 Policy、Provider、Market、Contract、API、Tax rule 或 report mapping 退休前必须：

- 停止新使用；
- 处理 open references；
- 完成 in-flight drain；
- 保存 historical snapshot；
- 完成 customer / Provider notice；
- 更新 runtime binding；
- 更新 docs / training / support；
- 验证 no orphan reference；
- 执行 retention / LegalHold；
- 记录 `DecommissionPlan` / `PolicyDeprecationRecord`。

## 10.7 Closeout ≠ Delete

Change closeout 后仍保留：

- notice；
- interpretation；
- approval；
- old / new versions；
- migration batch；
- quarantine；
- test / monitor；
- customer communication；
- rollback / incident；
- Audit / Compliance / Board references。

---

# 11. Access / SoD / Governance

## 11.1 Roles

| 角色 | 可做 | 不可做 |
|---|---|---|
| ChangeOwner | 组织 change、impact、migration、closeout | 单独批准自己提出的 P0 change |
| LegalOwner | 验证 notice、jurisdiction、interpretation、contract impact | 直接改 runtime policy 或 Ledger |
| ComplianceOwner | control / evidence / reapproval | 代替 Legal 解释法律或代替 Domain 写状态 |
| PolicyOwner | policy diff、test、binding proposal | 关闭 hard invariant 或独自生效 |
| EngineeringOwner | schema、runtime、migration、rollback | 绕过 legal / risk / finance approval |
| MarketOwner | Market profile、support、go / no-go | 未审查就把 Market 设为 ACTIVE |
| ProviderOwner | capability、route、drain、reconcile | 把 provider result 当 Proxy fact |
| Finance / TaxOwner | entity、tax、currency、close impact | 直接覆盖历史 Ledger / tax fact |
| ContractOwner | amendment、notice、customer scope | 单方面改变已签 Contract |
| SupportOwner | training、case routing、communication | 承诺未批准的 exception |
| Auditor | independent review、evidence、retest | 改写 policy、交易或 audit evidence |
| Board / Committee | approval、risk acceptance、pause、resources | 直接执行 Domain command |

## 11.2 SoD Rules

默认禁止同一人独立完成：

- LegalInterpretation author + sole runtime approver；
- PolicyChange author + sole effective approver；
- Migration implementer + sole cutover approver；
- Provider cutover operator + sole reconciliation reviewer；
- Contract negotiator + sole customer notice approver；
- Market owner + sole reapproval approver；
- Change owner + sole closeout verifier；
- Emergency actor + sole retrospective approver。

## 11.3 Sensitive Change Access

以下操作需要 step-up、purpose、scope、SoD 和 Audit：

- 改变 KYC / Safety / Privacy / Payment / Payout / Tax / Ledger policy；
- activate / revoke EffectivePolicyBinding；
- 批量 PolicyMigrationBatch；
- 改变 MarketLaunchProfile；
- Provider cutover / drain；
- Contract / DPA / PriceSchedule migration；
- retention / residency / deletion change；
- report / tax / revenue policy effective；
- rollback / emergency change；
- MarketReapproval decision；
- publish customer / public change notice。

## 11.4 Audit Trail

审计记录至少包含：

- actor / principal / delegated context；
- current / proposed version；
- scope / effective time；
- reason / basis；
- diff / mapping refs；
- approval / dissent；
- result / error / quarantine；
- rollback / closeout；
- affected Domain references。

原始 secret、private key、raw KYC、完整 bank credential 和未授权个人数据不进入 change audit payload。

---

# 12. API / Command / Event Contract

## 12.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `RecordRegulatoryChangeNotice` | Legal / Compliance | 记录变化来源与 authenticity |
| `DefineRegulatoryRequirement` | Legal / Compliance | 创建 obligation |
| `ApproveLegalInterpretation` | Legal | 锁定适用性判断 |
| `CreateChangeImpactAssessment` | ChangeOwner | 创建 scope / impact / dependency |
| `ClassifyChangeMateriality` | Governance / Risk | 决定 board / customer / reapproval 路径 |
| `ProposePolicyChange` | PolicyOwner | 创建 old / new policy diff |
| `ApprovePolicyMapping` | Policy / Compliance | 锁定 old → new mapping |
| `CreatePolicyMigrationPlan` | Engineering / Domain | 创建 migration / rollback / quarantine |
| `RunPolicyMigrationDryRun` | Engineering | 输出 preview / checksum / unknown |
| `CreatePolicyMigrationBatch` | MigrationOwner | 执行受控 batch |
| `ActivateEffectivePolicyBinding` | Authorized approver | 在 scope 内生效 policy |
| `PausePolicyBinding` | Risk / Incident | 暂停新 binding / transition |
| `CreateMarketReapprovalReview` | MarketOwner | 创建 market reapproval |
| `RecordMarketReapprovalDecision` | Approval body | APPROVED / HOLD / PAUSE / RETIRE |
| `PublishChangeCommunication` | Contract / Support | 发布已批准 notice |
| `RecordTrainingMigration` | Support / Operations | 记录 training / supervised path |
| `RecordChangeReadiness` | ChangeOwner | 生成 readiness snapshot |
| `RecordChangeCloseout` | Independent verifier | COMPLETE / LIMITATION / ROLLBACK |
| `DeprecatePolicyOrProvider` | Owner / Governance | 执行 drain / retire / archive |

## 12.2 P0 Events

```text
RegulatoryChangeNoticeRecorded
RegulatoryRequirementDefined
LegalInterpretationApproved
ChangeImpactAssessmentCompleted
ChangeMaterialityClassified
PolicyChangeProposed
PolicyMappingApproved
PolicyMigrationPlanApproved
PolicyMigrationDryRunCompleted
PolicyMigrationBatchStarted
PolicyMigrationBatchCompleted
PolicyMigrationQuarantined
EffectivePolicyBindingScheduled
EffectivePolicyBindingActivated
EffectivePolicyBindingPaused
PolicyCompatibilityWindowOpened
PolicyCompatibilityWindowClosed
PolicyDeprecationAnnounced
MarketReapprovalReviewStarted
MarketReapprovalDecisionRecorded
ChangeCommunicationPublished
TrainingMigrationCompleted
ChangeReadinessSnapshotGenerated
ChangeRollbackStarted
ChangeCloseoutRecorded
PolicyOrProviderRetired
```

事件只携带 change、policy、scope、version、effective time、status、owner、counts、checksum 和 reference，不携带 raw sensitive payload、secret 或完整客户数据。

## 12.3 Downstream Boundary

本章 events 可以通知：

- Chapter 23 Policy runtime；
- Chapter 24 Privacy / Consent / KYC / Safety；
- Chapter 27 Provider / Market readiness；
- Chapter 31 Contract / Enterprise；
- Chapter 33 Migration / Adoption / Renewal；
- Chapter 34 Compliance / Trust Center；
- Chapter 35 Tax / Settlement / FinancialClose；
- Chapter 36 Reporting / Treasury / Revenue；
- Chapter 37 Risk / Audit / Board governance。

本章 events 不能未经 Domain owned command 直接：

- 修改 Order / TaskSlot；
- 创建、重复或逆转 Payment / Refund / Payout；
- 写入或覆盖 Ledger；
- 标记 KYC VERIFIED；
- 关闭 Safety / Incident；
- 修改 Contract / LegalEntity / Invoice / TaxFiling；
- 删除 Consent、Audit、LegalHold 或 Evidence。

---

# 13. Acceptance Criteria

## AC-38-01 — Change Envelope

所有 material change 必须有 ChangeRequest 或 canonical change envelope，包含 source signal、requester、owner、scope、current / proposed version、basis、effective time、approval 和 rollback / stop condition。

## AC-38-02 — No Runtime Before Approval

PROPOSED、ASSESSED 或 APPROVED 状态的 change 不得自动成为 runtime ACTIVE policy；必须经过 scheduled、effective binding 和 audit。

## AC-38-03 — Version Before Mutation

Policy、Market、Tax、Risk、Control、Contract、Provider、Privacy、Revenue、Reserve 和 API / mapping 变化必须版本化，不能原地覆盖已引用版本。

## AC-38-04 — Scope Complete

Change 必须明确 Market、Legal Entity、Provider、Enterprise / Business、data category、environment、object scope、timezone、effective time 和 transition / exclusion rule。

## AC-38-05 — Historical Fact Protection

新 policy 默认不追溯改写历史 Order、Payment、Payout、Ledger、Invoice、Tax、KYC、Safety、Contract、Report 或 Audit facts；例外必须有 legal / correction / migration decision。

## AC-38-06 — Hard Invariant Protection

任何 change、feature flag、PolicySetVersion、BoardDecision 或 emergency change 都不能关闭 Ledger single-writer、idempotency、KYC / Sanctions、Safety、Privacy、LegalHold、SoD、reconciliation 或 source fact invariant。

## AC-38-07 — Regulatory Notice Authenticity

RegulatoryChangeNotice 必须验证 issuer、source、jurisdiction、effective date 和 authenticity；未经验证的 notice 不能直接改变 runtime。

## AC-38-08 — Legal Interpretation

RegulatoryRequirement 与 LegalInterpretation 必须记录适用条件、事实、假设、排除项、法律依据、confidence、reviewer、effective / expiry 和 supersede lineage。

## AC-38-09 — Obligation Mapping

每个 material obligation 必须映射到受影响 Policy、Control、Contract、Market、Data Category 和 gap；不能只存一段法律文本。

## AC-38-10 — Impact Dimensions

ChangeImpactAssessment 必须检查 Legal、Tax、KYC、Safety、Privacy、Security、Money、Finance、Provider、Contract、Capacity、Migration、Support 和 Trust impact。

## AC-38-11 — Materiality Decision

ChangeMaterialityDecision 必须决定是否需要 Market reapproval、Contract amendment、Board escalation、customer / regulator notice、data migration 和 rollback review。

## AC-38-12 — Policy Diff

PolicyChangeProposal 必须提供 old / new version、behavior diff、invariant impact、snapshot impact、test、rollout、rollback、owner、approver 和 effective time。

## AC-38-13 — Policy Mapping

PolicyMapping 必须说明 SAME、TIGHTENED、RELAXED、SPLIT、MERGED、NO_EQUIVALENT 或 RETIRED，以及旧值、新值、grandfather rule、manual review 和不兼容原因。

## AC-38-14 — Migration Preflight

PolicyMigrationPlan 进入 dry run 前必须有 population、mapping、unknown / conflict、idempotency、checksum、quarantine、rollback、retention、permission、owner 和 success criteria。

## AC-38-15 — Dry Run Is Non-mutating

dry run 不得产生真实 Payment、Payout、Ledger、Invoice、TaxFiling 或外部通知 mutation，并必须输出 counts、unknown、conflict、skip、error 和 downstream impact。

## AC-38-16 — Quarantine Visible

Policy migration 遇到 unknown policy value、scope conflict、open irreversible operation、missing approval、residency conflict、Contract gap 或 schema incompatibility 时必须 quarantine，并有 owner、reason、due date 和 safe path。

## AC-38-17 — No Uncontrolled Dual-write

Payment、Refund、Payout、Ledger、Order、TaskSlot、KYC、Safety、Invoice、TaxFilingPeriod 和 FinancialClose 不得进行无 fencing dual-write；shadow read model 必须标记非 canonical。

## AC-38-18 — Cutover Decision

Migration cutover 必须复用 CutoverDecision，记录 old / new versions、scope、evidence、reconciliation、quarantine、open irreversible operations、communication、rollback 和 GO / HOLD / ROLLBACK decision。

## AC-38-19 — Effective Binding

Runtime 只能使用 ACTIVE EffectivePolicyBinding，并按 scope、effective time、precedence、compatibility window 和 PolicySnapshot 解析。

## AC-38-20 — Open Object Rule

已创建但未关闭的 Task、Order、Payment、Payout、Invoice、Consent、KYC、Safety 或 Contract 必须明确 continue old、transition new、pause、manual review、migrate 或 legal re-determination 规则。

## AC-38-21 — Stale Cache Safety

Policy cache 必须带 version、scope、effective time、expiry、source hash、invalidation 和 stale behavior；P0 stale 时不得继续执行未经确认的不可逆操作。

## AC-38-22 — Policy Conflict

冲突的 active bindings 不得随机选择；必须按 precedence 解析，无法解析时进入 POLICY_CONFLICT_REVIEW，并对不可逆操作 deny / hold。

## AC-38-23 — Emergency Change

Emergency change 必须有 scope、TTL、owner、Incident / Risk linkage、preserved versions、retrospective approval deadline 和 customer / regulator impact review。

## AC-38-24 — Market Reapproval Trigger

Legal、Tax、KYC、Privacy、Safety、Provider、Entity、Currency、Settlement、Contract、Risk、Incident、Capacity 或 policy material change 必须能触发 MarketReapprovalReview。

## AC-38-25 — Approval Matrix

MarketReapprovalReview 必须按 scope 检查 Legal、Tax / Finance、KYC / AML、Privacy、Safety / Risk、Security、Provider、Product、Engineering、Support 和 Contract responsibilities。

## AC-38-26 — Approved vs Active

Market `APPROVED` 不得直接等于 `ACTIVE`；runtime binding、provider、support、monitoring、migration、rollback 和 go-live gate 完成后才能 ACTIVE。

## AC-38-27 — Conditional Approval

CONDITIONAL_APPROVED 必须列出未完成条件、owner、due date、compensating control、scope 和 expiry；缺失法定 KYC / Safety / Money / Privacy / Ledger hard gate 时不得 conditional go。

## AC-38-28 — Contract Transition

Contract、DPA、SLA、PriceSchedule、Payment terms 或 audit rights 变化必须记录 old / new version、effective time、open object treatment、notice、acceptance / amendment 和 exit path。

## AC-38-29 — Provider Transition

Provider change 必须覆盖 capability、route、webhook、subprocessor、settlement account、in-flight operation、idempotency、reconciliation、failover、notice 和 retirement。

## AC-38-30 — Data Policy Transition

Privacy、Consent、Retention、Residency、Export 或 Deletion 变化必须分类 historical / open / new data，检查 LegalHold、Provider、purpose、access、notice、migration 和 evidence。

## AC-38-31 — Finance Transition

Tax、Currency、Payment、Settlement、Revenue 或 Reporting policy 变化必须检查 Entity、Period、Invoice、TaxFiling、FinancialClose、Treasury、Restatement 和 historical snapshot。

## AC-38-32 — Communication Is Scoped

ChangeCommunicationPlan 必须记录 audience、message type、channel、language、version、effective time、acknowledgement、fallback、approval 和 delivery evidence；不得用模糊文案隐藏 material impact。

## AC-38-33 — Consent / Amendment Boundary

需要 consent、Contract amendment、DPA acceptance 或 legal notice 的 change 不能只通过 FAQ、release note 或 customer email 完成。

## AC-38-34 — Readiness And Observation

ChangeReadinessSnapshot 和 post-effective monitoring 必须覆盖 binding、migration、provider、contract、training、support、findings、limits、rollback、Payment / Ledger / Tax / Privacy / Safety signals。

## AC-38-35 — Closeout / Retirement

CloseoutDecision 必须记录 success criteria、reconciliation、open findings、remaining risk、observation window、rollback availability 和 COMPLETE / LIMITATION / EXTEND / ROLLBACK / RETIRE decision；旧版本、snapshot、audit 和 evidence 必须保留。

## AC-38-36 — No Fabricated Compliance

系统不得因为 LegalInterpretation、Policy approval、Market reapproval、Customer notice、Training completion、Provider certificate、BoardDecision 或 migration success 自动生成“全部合规”、KYC VERIFIED、Payment success、Ledger balance、Tax filed、Contract accepted 或 Market ACTIVE 事实。

---

# 14. P0 / P1 Boundary

## 14.1 P0

- ChangeRequest / canonical change envelope；
- RegulatoryChangeNotice、RegulatoryRequirement、LegalInterpretation、ObligationMapping、ChangeImpactAssessment、ChangeMaterialityDecision；
- PolicySetVersion、PolicyDefinition、PolicySnapshot 的 change lineage；
- PolicyChangeProposal、PolicyImpactAssessment、PolicyMapping、PolicyMigrationPlan、PolicyMigrationBatch、EffectivePolicyBinding、PolicyCompatibilityWindow、PolicyDeprecationRecord；
- CutoverDecision、MarketReapprovalReview、ChangeCommunicationPlan、TrainingMigrationPlan、ChangeReadinessSnapshot、CloseoutDecision；
- old / open / new object treatment；
- effective date、scope、precedence、cache、dual-version、quarantine、rollback、reconciliation；
- Legal、Tax、KYC、Safety、Privacy、Security、Money、Provider、Contract、Finance、Risk、Audit 和 Board cross-domain invariants；
- 36 项 AC-38 验收标准。

## 14.2 P1

- automated regulatory notice ingestion；
- legal text similarity and obligation suggestion；
- policy diff visualization；
- automated cross-domain impact graph；
- migration anomaly prediction；
- policy compatibility simulator；
- customer-specific transition assistant；
- automated training personalization；
- reapproval evidence recommendation；
- policy deprecation usage analytics；
- machine-generated communication drafts。

P1 自动化不能改变 P0 的 approval、effective binding、hard invariant、historical fact、quarantine、rollback、Market ACTIVE、Contract acceptance、Privacy、KYC、Safety、Money 或 Audit boundary。

---

# 15. Locked Conclusions / Next Work

本章锁定：

```text
Change signal 先验证、解释和评估，再进入 policy / runtime
Policy、Tax、Risk、Control、Contract、Provider 和 Market 变化必须版本化
历史、open、new 和 irreversible object 必须分别处理
Dry run 不写真实事实，quarantine 不可静默跳过
Effective binding 需要 scope、时间、precedence、cache 和 snapshot
Market APPROVED 不等于 ACTIVE，必须完成 provider、support、monitoring、migration 和 rollback
Contract / Consent / Privacy / Tax / KYC / Safety 的 material change 需要对应 approval
Rollback 停止或切换未来行为，但不删除已产生的事实
Closeout 需要 reconciliation、observation、残余风险、证据和 retire lineage
```

下一步进入：

```text
Chapter 39 — Policy-as-Code / Runtime Decision / Explainability Governance
```

Chapter 39 将把 PolicySet、Rule Evaluation、Decision Trace、Explainability、Simulation、Replay、Policy Test、Runtime Guardrail 和 human override 收口为可执行的决策引擎契约，同时继续保持 Policy、Risk、Safety、KYC、Money 与 Ledger 的事实边界。

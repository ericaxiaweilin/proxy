# Proxy PRD v1.1

## Chapter 37 — Financial Controls / Internal Audit / Risk Appetite / Board Governance

**文档类型**：Internal Control / Risk Appetite / Internal Audit / Issue Remediation / Board Escalation / Accountability Governance  
**状态**：ACTIVE — Enterprise Governance / Control Assurance Readiness  
**依赖**：Chapter 24 Account Security / Privacy / Consent / Data Lifecycle、Chapter 28 Pilot Runbook / Launch Operations / Incident Drill、Chapter 30 Scale Architecture / Capacity / FinOps / Multi-Region Readiness、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 35 Multi-Market Legal Entity / Tax / Currency / Settlement Governance、Chapter 36 Cross-Market Financial Reporting / Treasury / Revenue Recognition Governance  
**后续**：Chapter 38 Regulatory Change / Policy Migration / Market Re-Approval Governance

---

# 0. 本章目标

Chapter 34 定义了 Control、Evidence、ComplianceReview、Finding、Exception、Remediation、Attestation 和 Trust Center。Chapter 35 / 36 又增加了跨市场的 Entity、Tax、Settlement、FinancialClose、Treasury、Revenue、Cost 和 Report facts。

本章把这些对象连接到组织治理层：

```text
Risk Appetite
→ Risk Taxonomy / Limit / Indicator
→ Control Library / Control Health
→ Risk Assessment
→ Internal Audit Plan
→ Audit Engagement / Workpaper / Observation
→ Finding / Management Action
→ Retest / Closure / Residual Risk
→ Executive / Committee Escalation
→ Board Decision / Appetite Update
→ Continuous Monitoring
```

本章必须解决：

- 什么风险可以接受、什么风险必须停止、什么风险需要董事会或委员会审批；
- RiskSignal、RiskDecision、Incident、RiskHold、ComplianceFinding、TreasuryRiskExposure 与 Board governance 如何互相引用而不重复造状态机；
- Control owner、Risk owner、Compliance、Internal Audit、Executive 和 Board 的职责如何分离；
- Internal Audit 如何基于风险制定年度计划、定义 scope、采集 evidence、形成 observation、追踪整改和验证关闭；
- P0 / P1 事件、财务重述、流动性突破、资金差异、数据泄露、市场暂停和外部 assurance 撤回如何升级；
- Risk acceptance 如何表达有限期 residual risk，而不是授权绕过 KYC、Safety、Privacy、Payment、Ledger 或 Tax；
- Board pack、risk dashboard 和 committee minutes 如何具备 source、period、limitation、decision 和 accountability；
- 治理决策如何影响 launch、pause、capacity、provider、contract、market 和 funding policy，但不直接改写业务事实。

本章不做：

- 不创建第二套 Incident、RiskDecision、RiskSignal、RiskHold、ComplianceFinding 或 Ledger 状态；
- 不让 BoardDecision、RiskAcceptance、AuditOpinion 或 Executive target 直接修改 Order、Payment、Payout、Ledger、KYC、Safety、Invoice、Tax 或 Contract；
- 不把“董事会知道”“管理层接受”“客户重要”当作安全、法律、隐私、资金或会计控制的替代批准；
- 不把 Internal Audit 变成业务 owner，也不让被审计团队独立关闭自己的高风险 finding；
- 不把 RiskScore、KRI、ControlHealth 或 Board pack 的总分当成全部风险事实；
- 不以删除 signal、降低阈值、改变分类或改写 report 来掩盖 risk appetite breach。

## 0.1 本章核心结论

```text
Risk appetite = approved boundary, not a guarantee
Risk limit breach = escalation / containment, not silent normalization
Control health = evidence-based view, not one score
Internal Audit = independent assurance, not operational ownership
Risk acceptance = scoped, time-bound residual risk decision
Board decision = governance authorization, not transaction command
Finding closure = verified remediation, not verbal confirmation
Executive report = decision support, not canonical Domain fact
```

## 0.2 Three Lines of Accountability

| 线 | 角色 | 责任 | 不能做的事 |
|---|---|---|---|
| First line | Product、Engineering、Operations、Finance、Treasury、Provider、Support | 运行控制、识别风险、处理事件、保留 evidence | 不能隐瞒缺口或自己独立证明全部有效 |
| Second line | Risk、Compliance、Privacy、Security、Legal、Finance Control | 设 policy、review appetite、监控 KRI、挑战风险、批准有限 exception | 不能替代业务执行或修改 Domain facts |
| Third line | Internal Audit | 独立评价 governance、risk、control 和整改有效性 | 不能拥有被审计控制的运行责任 |
| Governance | Executive、Risk Committee、Audit Committee、Board | 批准 appetite、审阅 material risk、要求行动、记录 decision | 不能通过会议纪要直接写入交易状态 |
| External | External Assessor、Regulator、Customer Auditor | 在授权 scope 内提供独立或外部审查 | 不能修改 Proxy 内部状态 |

---

# 1. Governance Constitution

## 1.1 Risk Appetite 是边界

RiskAppetiteStatement 必须定义：

- risk category；
- objective；
- qualitative stance；
- quantitative metric；
- limit / threshold；
- tolerance；
- escalation level；
- owner；
- review cadence；
- exception policy；
- effective period；
- approving body。

Appetite 不能写成“零风险”或“尽量安全”而没有可执行条件。

## 1.2 Inherent / Residual Risk 分离

每次 RiskAssessment 必须区分：

```text
inherent_risk
→ control design / implementation
→ current evidence
→ residual_risk
→ accepted / mitigated / escalated decision
```

Residual risk 降低不表示 inherent risk 消失，也不表示 Control 已经永久有效。

## 1.3 No Risk Score Shortcut

综合 RiskScore 可以辅助排序，但不能隐藏：

- P0 incident；
- law / regulatory breach；
- Safety emergency；
- raw secret / credential exposure；
- unapproved KYC / sanctions bypass；
- duplicate charge / payout / Ledger mismatch；
- liquidity buffer breach；
- material tax / revenue / financial restatement；
- critical provider / market suspension。

上述风险必须单独显示并按 policy 升级，不能被其他低风险指标平均稀释。

## 1.4 Appetite 不替代 Domain Gate

Risk appetite、Board decision、RiskAcceptance 或 AuditOpinion 不能：

- 将 UserAccount 解除 restriction；
- 将 KYC decision 改为 VERIFIED；
- 将 Safety Incident 标记为 resolved；
- 让 Payment / Payout 穿透 hold；
- 让 Ledger 产生未授权金额；
- 使未批准 Market / Provider 进入 ACTIVE；
- 把未签署 Contract 当成有效合同；
- 把未完成 Tax / FinancialClose 当成已完成。

这些动作必须由相应 Domain owner 按 approved command、permission、effective time 和 Audit 执行。

## 1.5 Risk Acceptance 不是免罪

RiskAcceptance 只可以表达：

```text
已识别风险
→ 范围、期间、影响明确
→ 当前 controls 和 compensating controls 已记录
→ residual risk 被授权人接受
→ 有到期日、触发条件和复核
```

RiskAcceptance 不得：

- 取消法定或监管要求；
- 取消 Safety response；
- 授权存储 raw secret / raw KYC；
- 免除 Payment / Ledger reconciliation；
- 永久延长 exception；
- 让管理层 target 压过用户或客户权利。

## 1.6 Governance Evidence

每个 material decision 必须能追溯到：

- proposal；
- scope；
- risk / control evidence；
- alternatives；
- decision maker；
- effective time；
- dissent / limitation，如有；
- owner；
- next review / expiry；
- resulting actions。

“在会上讨论过”不是充分的 governance evidence。

---

# 2. Risk Governance Domain Objects

## 2.1 RiskAppetiteStatement

```text
RiskAppetiteStatement
├── id
├── organization_ref
├── version
├── effective_from
├── effective_to?
├── risk_category_refs[]
├── qualitative_positions[]
├── quantitative_limits[]
├── prohibited_risks[]
├── escalation_rules[]
├── exception_policy_ref
├── owner_ref
├── approved_by[]
├── review_cadence
└── status: DRAFT / REVIEW / APPROVED / ACTIVE / SUPERSEDED / RETIRED
```

## 2.2 RiskTaxonomy

```text
RiskTaxonomy
├── id
├── version
├── categories[]
├── subcategories[]
├── cross_domain_mappings[]
├── severity_scale
├── likelihood_scale
├── impact_scale
├── aggregation_rules
├── effective_from
├── approved_by[]
└── status: DRAFT / ACTIVE / SUPERSEDED / RETIRED
```

RiskTaxonomy 的变化必须保留旧版 mapping。历史 RiskAssessment 不得因为新 taxonomy 自动改变原始评级。

## 2.3 RiskCategory

```text
RiskCategory
├── id
├── taxonomy_ref
├── code
├── name
├── objective
├── risk_owner_role
├── control_family_refs[]
├── key_indicators[]
├── prohibited_conditions[]
├── escalation_body
└── status: ACTIVE / RETIRED
```

P0 默认风险类别至少包括：

```text
Safety
Identity / KYC / Sanctions
Security / Privacy / Data
Payment / Payout / Ledger
Financial Reporting / Tax
Provider / Market
Availability / Resilience
Legal / Contract
Conduct / Fairness
Reputation / Customer Trust
```

## 2.4 RiskLimit

```text
RiskLimit
├── id
├── risk_category_ref
├── scope_ref
├── metric_ref
├── limit_type: HARD_STOP / ESCALATION / WARNING / MONITORING
├── threshold
├── direction: ABOVE / BELOW / OUTSIDE_RANGE / EVENT_COUNT
├── measurement_window
├── breach_action
├── escalation_level
├── effective_from
├── effective_to?
├── owner_ref
├── approved_by[]
└── status: DRAFT / ACTIVE / SUSPENDED / SUPERSEDED / RETIRED
```

## 2.5 RiskIndicator

```text
RiskIndicator
├── id
├── metric_code
├── risk_category_ref
├── formula
├── source_refs[]
├── scope_ref
├── period_policy
├── freshness_policy
├── threshold_refs[]
├── data_quality_checks[]
├── owner_ref
├── version
└── status: DRAFT / ACTIVE / RETIRED
```

## 2.6 RiskMeasurement

```text
RiskMeasurement
├── id
├── indicator_ref
├── scope_ref
├── period_start / period_end
├── as_of_time
├── observed_value
├── denominator?
├── confidence
├── source_snapshot_refs[]
├── data_quality_status
├── limit_status: WITHIN / WARNING / BREACH / UNKNOWN
├── generated_at
└── audit_ref
```

`UNKNOWN` 不是 `WITHIN`。数据不完整时必须显示 unknown、limitation 和 next action。

## 2.7 RiskAssessment

```text
RiskAssessment
├── id
├── scope_ref
├── risk_category_ref
├── asset_refs[]
├── threat_or_hazard
├── inherent_likelihood
├── inherent_impact
├── inherent_rating
├── control_refs[]
├── evidence_refs[]
├── residual_likelihood
├── residual_impact
├── residual_rating
├── assessment_method
├── assessor_ref
├── assessed_at
├── next_review_at
├── decision_ref?
└── status: DRAFT / REVIEW / APPROVED / EXPIRED / SUPERSEDED
```

## 2.8 RiskDecision

Chapter 24 / Canonical Registry 已有 `RiskDecision`。本章只规定其治理引用，不重新定义第二个 RiskDecision：

```text
RiskDecision
├── risk_assessment_ref?
├── risk_signal_refs[]
├── risk_hold_refs[]
├── scope_ref
├── decision: ACCEPT / MITIGATE / TRANSFER / AVOID / PAUSE / ESCALATE / REJECT
├── rationale
├── conditions[]
├── owner_ref
├── approver_refs[]
├── effective_at
├── expires_at?
└── audit_ref
```

RiskDecision 的业务动作仍必须通过对应 Domain command。它只表达风险治理决策。

## 2.9 RiskAcceptance

```text
RiskAcceptance
├── id
├── risk_assessment_ref
├── finding_refs[]
├── exception_refs[]
├── scope_ref
├── residual_risk_statement
├── compensating_control_refs[]
├── accepted_by
├── approval_body
├── start_at
├── expires_at
├── trigger_conditions[]
├── notification_requirements[]
├── review_cadence
├── status: PROPOSED / REVIEW / APPROVED / ACTIVE / EXPIRED / REVOKED / REJECTED
└── audit_ref
```

## 2.10 RiskEvent

```text
RiskEvent
├── id
├── source_type: SIGNAL / INCIDENT / AUDIT / CONTROL / FINANCE / PROVIDER / MARKET / CONTRACT / CUSTOMER
├── source_ref
├── risk_category_ref
├── scope_ref
├── detected_at
├── severity
├── impact_summary
├── affected_asset_refs[]
├── linked_risk_assessment_ref?
├── linked_risk_decision_ref?
├── linked_escalation_ref?
├── status: NEW / TRIAGED / ESCALATED / MITIGATING / MONITORING / CLOSED / REOPENED
└── audit_ref
```

## 2.11 ControlHealthSnapshot

```text
ControlHealthSnapshot
├── id
├── scope_ref
├── period_ref
├── control_refs[]
├── assessment_refs[]
├── evidence_freshness
├── overdue_remediation_count
├── exception_count
├── drift_count
├── coverage_rate
├── health_by_category[]
├── limitations[]
├── generated_at
├── calculation_version
└── audit_ref
```

ControlHealthSnapshot 必须同时展示 critical exceptions、P0 / P1 findings 和 unknown，不得只显示综合健康分。

---

# 3. Risk Appetite / Limit Framework

## 3.1 Appetite Positions

每个 RiskCategory 可以有以下 stance：

| stance | 含义 | 例子 |
|---|---|---|
| `ZERO_TOLERANCE` | 任何已确认事件都必须停止 / escalated | raw secret exposure、伪造 Ledger、未授权 KYC bypass |
| `VERY_LOW` | 允许极少数受控事件，必须快速 contain | P0 security、critical payout mismatch |
| `LOW` | 允许可控残余风险，必须在 limit 内 | Provider delay、minor reconciliation variance |
| `MODERATE` | 允许有证据的探索和业务波动 | 新市场容量、受控价格实验 |
| `HIGH_WITH_GUARDS` | 可接受创新或增长波动，但有明确 hard limits | P1 product experiment、forecast error |
| `PROHIBITED` | 不允许开展或不允许在当前 scope 运行 | 未批准市场、未验证 payout account |

## 3.2 Quantitative Limit Types

Limit 可以基于：

- count；
- amount；
- rate；
- time to detect；
- time to contain；
- backlog age；
- exposure percentage；
- data volume；
- concentration；
- error budget；
- evidence freshness；
- control completion；
- liquidity buffer；
- forecast variance。

每个 limit 必须说明 metric、population、period、scope、threshold 和 breach action。

## 3.3 Hard Stop vs Escalation

```text
HARD_STOP
→ stop new affected operations
→ preserve existing facts
→ open RiskEvent / Incident / Case
→ assess safe continuation / recovery

ESCALATION
→ continue only within approved guardrails
→ notify owner / committee
→ create action and next review
```

硬停止只影响 defined scope。不能因一个 Market 的风险直接删除其他 Market 的历史事实或无依据暂停全体用户。

## 3.4 Prohibited Conditions

以下条件默认是 `PROHIBITED` 或 `HARD_STOP`：

- P0 Safety emergency 无响应 owner；
- raw credential / secret 泄露未 contain；
- 未授权 access 到 raw KYC / D5；
- Payment / Payout duplicate operation；
- Ledger split-brain 或金额不可解释；
- 未验证 SettlementAccount 执行 payout；
- 未批准 Legal Entity 承接交易；
- required KYC / Sanctions / Market Legal gate 未通过；
- financial close 存在未解释 material mismatch；
- Board / regulator required action 逾期且无有效 decision；
- RiskAcceptance 过期但仍继续依赖。

## 3.5 Limit Change

Limit 变更必须：

- 记录旧值、新值、reason、scope、effective time；
- 评估对历史 measurement 的影响；
- 不因已经 breach 就调高 threshold；
- 由适当的 owner / committee 审批；
- 更新 monitoring、alert、runbook 和 report mapping；
- 触发 Chapter 34 Change Review，如适用。

## 3.6 Aggregation Without Masking

Group-level aggregation 可以帮助董事会查看总体 risk，但必须保留：

- individual P0 / P1 events；
- Market / Entity / Provider concentration；
- limit breach；
- data quality；
- unresolved uncertainty；
- correlated risks；
- cross-domain dependency。

一个 group-level `GREEN` 不得隐藏某个 Market 的 `RED` hard-stop。

---

# 4. Risk Assessment / Monitoring

## 4.1 Assessment Triggers

RiskAssessment 至少由以下事件触发：

- 新 Market、Legal Entity、Provider、Product 或 Contract scope；
- 新 data category、Payment rail、Payout route、Revenue policy；
- P0 / P1 Incident；
- ControlDefinition、PolicySet 或 RiskTaxonomy 变更；
- RiskLimit breach；
- FinancialClose reopen / restatement；
- Treasury liquidity / concentration breach；
- external assurance limitation / withdrawal；
- migration cutover / entity replacement；
- customer / regulator / board request；
- material unresolved AuditObservation。

## 4.2 Assessment Method

每次 assessment 必须说明：

- scope；
- asset / process；
- threat / hazard；
- likelihood rationale；
- impact dimensions；
- existing controls；
- evidence；
- assumptions；
- residual risk；
- uncertainty；
- owner；
- review date。

## 4.3 Impact Dimensions

至少考虑：

- user / customer harm；
- Safety；
- Security / Privacy；
- financial loss / liquidity；
- Legal / regulatory；
- tax / accounting；
- provider / market availability；
- Enterprise Contract / SLA；
- reputation / trust；
- operational resilience；
- data residency / retention。

## 4.4 KRI / KCI / KPI Separation

```text
KRI = risk exposure / breach signal
KCI = control operation / effectiveness signal
KPI = business performance signal
```

KPI 达标不能抵消 KRI breach。KCI 未知不能显示为 control healthy。三类 metric 必须在 Board pack 和 dashboard 分列。

## 4.5 Measurement Quality

RiskMeasurement 必须标记：

- source completeness；
- freshness；
- duplicate / missing record；
- denominator quality；
- sampling / estimation；
- calculation version；
- confidence；
- limitation。

数据质量不足时，measurement 为 `UNKNOWN`，触发 data quality issue 或 remediation，不自动判断 within limit。

## 4.6 Continuous Monitoring

自动 monitor 可以检测：

- limit breach；
- control drift；
- evidence expiry；
- privileged access anomaly；
- payment / payout mismatch；
- ledger imbalance；
- treasury buffer breach；
- revenue schedule variance；
- report restatement；
- provider incident；
- market approval expiry；
- overdue remediation；
- concentration risk。

自动 monitor 不能自动：

- 永久封禁用户；
- 关闭 RiskEvent；
- 批准 RiskAcceptance；
- 发布 Board decision；
- 修改 Ledger / Payment / Tax / Contract；
- 降低 risk rating 以消除 alert。

## 4.7 Alert Triage

```text
NEW
→ validate signal
→ classify risk category / scope
→ check duplicate / correlation
→ assess severity / limit
→ create RiskEvent or link Incident / Finding
→ assign owner / next action
→ escalate or monitor
```

误报可以关闭，但必须保存 false-positive reason、evidence、reviewer 和 rule improvement。

---

# 5. Control Library / Control Health

## 5.1 Reuse Chapter 34 Controls

本章复用 Chapter 34 的：

- ControlDefinition；
- ControlImplementation；
- ComplianceEvidence；
- ControlAssessment；
- ComplianceFinding；
- ComplianceException；
- RemediationPlan；
- ComplianceReview。

本章不创建第二套 ControlDefinition 或 ComplianceFinding。新增治理对象只负责 risk linkage、audit independence、board escalation 和 accountability。

## 5.2 Control-to-Risk Mapping

每个 material risk 至少关联：

- preventive controls；
- detective controls；
- corrective controls；
- control owner；
- tester；
- evidence；
- residual risk；
- fallback / compensating control；
- failure escalation。

一个 risk 没有对应 control 时，必须是显式 gap，而不是默认 healthy。

## 5.3 ControlHealthSnapshot

健康快照至少分维度展示：

- design status；
- implementation status；
- operating effectiveness；
- evidence freshness；
- overdue remediation；
- exception expiry；
- drift；
- test coverage；
- P0 / P1 findings；
- unknown / data quality。

## 5.4 Control Failure

Control failure 处理顺序：

1. 判断是否影响正在运行的 operation；
2. 需要时 contain / pause；
3. 创建或关联 ComplianceFinding / RiskEvent / Incident；
4. 保护 source facts 和 evidence；
5. 评估 compensating control；
6. 创建 RemediationPlan；
7. retest；
8. 更新 RiskAssessment、ControlHealthSnapshot 和 Board reporting。

## 5.5 Compensating Control Boundary

Compensating control 必须不低于原始风险目标。以下不构成充分补偿：

- 只写一份说明；
- 只降低 dashboard threshold；
- 只增加一个人工备注；
- 只把风险改名为 accepted；
- 只把 finding 移到下一个 period；
- 只由同一个人自我确认。

## 5.6 Control Health Publication

ControlHealthSnapshot 对不同受众展示不同 detail，但都必须保留：

- date / period；
- scope；
- calculation version；
- critical exclusions；
- open P0 / P1；
- limitations。

对外只能发布经 Chapter 34 TrustCenterArtifact / AuditResponsePackage 审批的版本。

---

# 6. Internal Audit Governance

## 6.1 InternalAuditPlan

```text
InternalAuditPlan
├── id
├── organization_ref
├── plan_year
├── risk_taxonomy_ref
├── risk_assessment_refs[]
├── proposed_engagements[]
├── coverage_map
├── independence_conflicts[]
├── resource_plan
├── planned_start / planned_end
├── priority_rules
├── approved_by
├── status: DRAFT / REVIEW / APPROVED / ACTIVE / REVISED / CLOSED
└── audit_ref
```

## 6.2 Risk-based Planning

Audit plan prioritization至少考虑：

- inherent / residual risk；
- risk appetite breach；
- P0 / P1 incident；
- previous findings；
- control maturity；
- material financial / revenue / tax report；
- provider / market criticality；
- regulatory / contract obligation；
- change velocity；
- data quality / unknown；
- management / Board / regulator request。

不能只按“去年审过所以今年不用审”，也不能只审容易取得证据的低风险领域。

## 6.3 InternalAuditEngagement

```text
InternalAuditEngagement
├── id
├── plan_ref
├── engagement_type: ASSURANCE / ADVISORY / FOLLOW_UP / INVESTIGATION_SUPPORT
├── scope_ref
├── objective
├── risk_refs[]
├── control_refs[]
├── period
├── criteria_refs[]
├── engagement_lead
├── team_refs[]
├── independence_assessment
├── start_at / end_at
├── status: PLANNED / SCOPING / FIELDWORK / REPORTING / FOLLOW_UP / CLOSED / PAUSED
├── report_ref?
└── audit_ref
```

## 6.4 Independence Check

Engagement 开始前必须检查：

- auditor 最近是否负责过被审计 control；
- 是否参与过 implementation / remediation；
- 是否存在 reporting line conflict；
- 是否持有受影响的审批权；
- 是否存在 personal / commercial conflict；
- 是否需要 external reviewer；
- 是否有 conflict mitigation。

发现无法缓解的冲突时，必须更换 lead / reviewer 或标记 limitation。

## 6.5 AuditProcedure

```text
AuditProcedure
├── id
├── engagement_ref
├── objective
├── criteria_ref
├── test_steps[]
├── population_definition
├── sample_method?
├── evidence_requirements[]
├── expected_result
├── exception_handling
├── reviewer_role
└── version
```

## 6.6 AuditWorkpaper

```text
AuditWorkpaper
├── id
├── engagement_ref
├── procedure_ref
├── scope_ref
├── evidence_refs[]
├── sample_refs[]
├── observations[]
├── conclusion
├── limitation_refs[]
├── preparer_ref
├── reviewer_ref
├── prepared_at
├── reviewed_at?
├── status: DRAFT / PREPARED / REVIEWED / LOCKED
└── audit_ref
```

Workpaper 锁定后不能覆盖。更正需要新版本和 reviewer trail。

## 6.7 AuditObservation

```text
AuditObservation
├── id
├── engagement_ref
├── workpaper_ref
├── type: DESIGN_GAP / OPERATING_FAILURE / EVIDENCE_GAP / DATA_QUALITY / SCOPE_LIMITATION / GOOD_PRACTICE
├── description
├── criteria
├── condition
├── cause
├── effect_or_risk
├── severity: P0 / P1 / P2 / P3
├── linked_control_refs[]
├── linked_risk_refs[]
├── linked_finding_ref?
├── management_response_ref?
└── audit_ref
```

AuditObservation 是审计观察，不替代 Chapter 34 的 ComplianceFinding。需要治理整改时必须 link 到 canonical finding 或新建该 finding。

## 6.8 AuditReport

```text
AuditReport
├── id
├── engagement_ref
├── scope_ref
├── period
├── opinion: EFFECTIVE / EFFECTIVE_WITH_ISSUES / INEFFECTIVE / INCOMPLETE / NOT_RATED
├── observation_refs[]
├── finding_refs[]
├── limitation_refs[]
├── executive_summary
├── management_response_refs[]
├── issued_at
├── approved_by[]
├── audience_refs[]
├── status: DRAFT / REVIEW / ISSUED / WITHDRAWN / SUPERSEDED
└── audit_ref
```

`INCOMPLETE` 或 `NOT_RATED` 不能在 Board pack 中被缩写为 effective。

## 6.9 Audit Follow-up

Follow-up 必须验证：

- 原 finding / observation；
- management action；
- implemented change；
- evidence freshness；
- operating effectiveness；
- residual risk；
- new exceptions；
- recurrence / root cause。

管理层自报完成不等于 Internal Audit 关闭。

## 6.10 Audit Scope Limitation

无法取得数据、受 LegalHold / Privacy 限制、系统 outage 或 scope dispute 时：

- 记录 limitation；
- 评估是否影响 opinion；
- 不把 missing evidence 当作 pass；
- 向 Audit Committee / responsible executive 升级；
- 必要时暂停 assurance claim。

---

# 7. Finding / Action / Residual Risk Governance

## 7.1 Canonical Finding Linkage

本章使用 Chapter 34 的 `ComplianceFinding` 作为跨域 finding 的 canonical issue record，并允许以下来源：

```text
InternalAuditEngagement
AuditObservation
RiskLimitBreach
Incident
FinancialClose
TreasuryRiskExposure
ReportRestatement
Customer / Regulator request
```

不允许同一根因在多个系统中各自关闭而没有 cross-reference。

## 7.2 ManagementActionPlan

```text
ManagementActionPlan
├── id
├── finding_ref
├── observation_ref?
├── accountable_executive
├── action_owner
├── action_description
├── root_cause
├── milestones[]
├── dependencies[]
├── target_date
├── resource_commitment
├── interim_control_refs[]
├── success_criteria
├── verification_method
├── status: PROPOSED / APPROVED / IN_PROGRESS / BLOCKED / READY_FOR_VALIDATION / VERIFIED / CANCELLED
└── audit_ref
```

## 7.3 Accountability Assignment

```text
AccountabilityAssignment
├── id
├── object_type
├── object_ref
├── accountable_role
├── responsible_owner
├── consulted_refs[]
├── informed_refs[]
├── authority_scope
├── start_at
├── end_at?
├── acceptance_ref?
└── audit_ref
```

RACI 不能只存在于表格或会议记录。Material risk、P0 finding、Board action 和 overdue remediation 必须有系统中的 accountable owner。

## 7.4 Root Cause

Root cause 应区分：

- policy / governance；
- design；
- implementation；
- operation；
- people / training；
- provider / dependency；
- data / migration；
- capacity / resilience；
- fraud / malicious activity；
- unknown。

`unknown` 是有效状态，但必须有调查计划，不能当作已解决。

## 7.5 Overdue Action

Action 到期未完成时：

```text
owner reminder
→ manager escalation
→ risk / compliance / audit owner
→ committee escalation
→ risk acceptance or scope pause decision
```

延期必须创建新的 RiskAcceptance / Exception 或 Board / Committee decision，并说明 residual risk 变化。

## 7.6 Closure Validation

关闭 action / finding 前必须有：

- success criteria；
- implementation evidence；
- operating evidence；
- independent validation；
- remaining limitations；
- residual risk update；
- control health update；
- re-open trigger。

## 7.7 Recurrence

同一 root cause 复发时：

- 原 finding 标记 `REOPENED` 或关联 recurrence；
- 重新评估 severity / appetite；
- 检查原 remediation 是否设计不足；
- 升级 accountable executive / committee；
- 必要时暂停对应 scope；
- 不得把复发拆成多个 P3 来降低可见性。

---

# 8. Escalation / Incident / Financial Governance

## 8.1 Escalation Levels

```text
L0 — Operator / Control Owner
L1 — Manager / Domain Owner
L2 — Risk / Compliance / Security / Privacy / Finance / Legal
L3 — Executive / Risk Committee / Audit Committee
L4 — Board / Regulator / Contract escalation, as required
```

实际路径按 RiskCategory、scope、severity、market、contract 和 legal obligation 决定。

## 8.2 BoardEscalation

```text
BoardEscalation
├── id
├── source_type: RISK_EVENT / INCIDENT / FINDING / LIMIT_BREACH / RESTATEMENT / LIQUIDITY / MARKET / PROVIDER / LEGAL
├── source_ref
├── risk_category_ref
├── scope_ref
├── severity
├── trigger
├── impact_summary
├── decision_required
├── options[]
├── recommendation
├── owner_ref
├── due_at
├── notified_body
├── status: DRAFT / SUBMITTED / ACKNOWLEDGED / DECIDED / MONITORING / CLOSED
└── audit_ref
```

## 8.3 Escalation Triggers

默认必须至少向 Executive / relevant Committee 升级：

- P0 Safety、Security、Privacy、Money 或 Identity event；
- hard risk limit breach；
- material financial restatement；
- liquidity buffer breach；
- unresolved duplicate charge / payout / Ledger mismatch；
- material tax / legal entity / regulatory issue；
- critical provider / market suspension；
- external assurance withdrawal；
- overdue P0 / P1 action；
- repeated control failure；
- customer / regulator notification obligation；
- risk acceptance expiry without new decision。

## 8.4 Stop / Pause Scope

Escalation 可以建议暂停：

- specific Provider；
- specific Payment / Payout rail；
- specific Market / MarketCell；
- new writes / new commitments；
- specific Enterprise / Business scope；
- risky feature / product；
- treasury movement；
- external publication；
- report / claim publication。

Pause scope 必须尽量最小但足够保护风险。范围不清时，对不可逆资金、Safety、Privacy 或 identity action 采用更保守边界。

## 8.5 Existing Fact Rule

Pause / escalation 不自动：

- cancel existing Order；
- reverse Ledger；
- refund all customers；
- release or seize all payout；
- delete user / Enterprise；
- invalidate KYC history；
- erase evidence。

已有事实由 Order、Payment、Payout、Ledger、Safety、Privacy、KYC、Contract 和 ExitPlan 的独立规则处理。

## 8.6 Financial Escalation

Finance / Treasury 事件必须附带：

- entity / market / currency；
- amount and source；
- confirmed vs estimate；
- Ledger / Invoice / Tax / Settlement refs；
- liquidity / customer fund impact；
- known / unknown operations；
- close / restatement impact；
- proposed containment；
- owner and next update。

金额不大但影响税务、客户资金、审计可信度或重复操作的事件仍可能是 P0 / P1。

## 8.7 Security / Privacy Escalation

Security / Privacy escalation 必须优先保护：

- secrets / credentials；
- raw KYC / D5；
- precise location / D4；
- consent / purpose；
- access logs；
- LegalHold / incident evidence。

不能以“还在调查”为理由关闭 access audit、删除 evidence 或发布无条件安全声明。

---

# 9. Board / Committee Governance

## 9.1 BoardCommittee

```text
BoardCommittee
├── id
├── organization_ref
├── name
├── committee_type: BOARD / AUDIT / RISK / FINANCE / SECURITY / REMUNERATION / EXECUTIVE
├── mandate
├── authority_scope
├── membership_refs[]
├── independence_requirements[]
├── meeting_cadence
├── quorum_rule
├── escalation_types[]
├── effective_from
├── effective_to?
└── status: DRAFT / ACTIVE / SUSPENDED / RETIRED
```

## 9.2 BoardMeeting

```text
BoardMeeting
├── id
├── committee_ref
├── meeting_type: REGULAR / SPECIAL / EMERGENCY
├── scheduled_at
├── held_at?
├── attendees[]
├── conflicts_declared[]
├── quorum_met
├── agenda_refs[]
├── pack_ref
├── decision_refs[]
├── action_refs[]
├── minutes_ref
├── status: SCHEDULED / HELD / ADJOURNED / CANCELLED / APPROVED
└── audit_ref
```

## 9.3 BoardPack

```text
BoardPack
├── id
├── meeting_ref
├── reporting_period
├── risk_appetite_ref
├── risk_dashboard_ref
├── control_health_ref
├── audit_reports[]
├── financial_reports[]
├── treasury_positions[]
├── incidents[]
├── restatements[]
├── open_actions[]
├── limitations[]
├── prepared_by
├── reviewed_by[]
├── version
├── distributed_at?
├── status: DRAFT / REVIEW / APPROVED / DISTRIBUTED / SUPERSEDED
└── audit_ref
```

## 9.4 BoardDecision

```text
BoardDecision
├── id
├── meeting_ref
├── escalation_ref?
├── decision_type: APPROVE / REJECT / REQUEST_ACTION / ACKNOWLEDGE / PAUSE / RESUME / REVIEW / DELEGATE
├── subject
├── rationale
├── conditions[]
├── authority_scope
├── effective_at
├── expires_at?
├── accountable_owner
├── action_refs[]
├── dissent_or_limitation_refs[]
├── status: PROPOSED / APPROVED / RECORDED / SUPERSEDED / REVOKED
└── audit_ref
```

BoardDecision 只能授权治理方向、资源、风险接受、调查或 scope-level pause。它不能直接作为 Payment、Ledger、KYC、Safety 或 Contract command。

## 9.5 Board Action Follow-up

Board action 必须有：

- accountable executive；
- action owner；
- target date；
- success criteria；
- dependency；
- interim control；
- reporting cadence；
- closure verifier；
- escalation if overdue。

## 9.6 Board Information Quality

BoardPack 必须标记：

- actual / forecast / estimate；
- source freshness；
- report version；
- scope；
- materiality；
- unresolved unknown；
- limitation；
- management judgment；
- external assurance status。

不得只用 traffic-light 颜色取代数字、定义和趋势。

## 9.7 Conflicts / Recusal

Board / Committee member 有利益冲突时：

- 记录 conflict；
- 记录 recusal / participation；
- 检查 quorum；
- 限制敏感材料访问；
- 保留 decision trail；
- 必要时由独立委员会或外部顾问处理。

---

# 10. Accountability / Culture / Conduct

## 10.1 Speak-up / Issue Reporting

系统应允许内部人员、Provider、Enterprise 或 Assessor 在授权 scope 内报告：

- control failure；
- fraud / misconduct；
- safety concern；
- privacy / security concern；
- financial reporting concern；
- retaliation concern；
- policy breach。

报告者身份和内容按 privacy、legal privilege、need-to-know 保护，但不能因此删除或压低风险事实。

## 10.2 No Retaliation

任何 risk / audit / safety / privacy issue 的提交、升级或不同意见不能成为：

- 降权；
- 取消 access；
- 恶意 Performance action；
- 隐藏 issue；
- 更改 finding severity；
- 关闭 reporting channel；
- 删除 evidence。

涉嫌 retaliation 必须创建独立 RiskEvent / Incident 或 Legal case。

## 10.3 Incentive Boundary

Revenue、growth、launch、margin、renewal 或 cost target 不能让员工或系统绕过：

- Safety；
- KYC / Sanctions；
- Payment / Payout / Ledger；
- Privacy / Consent；
- Tax / FinancialClose；
- Provider / Market readiness；
- Audit / Board action。

## 10.4 Training

高风险角色至少接受：

- risk appetite；
- control execution；
- incident escalation；
- Privacy / D4 / D5；
- Payment / Ledger / Tax；
- Treasury movement；
- audit evidence；
- retaliation / conflict；
- break-glass。

Training completion 是 control evidence，但不单独证明控制有效。

## 10.5 Accountability Metrics

可监控：

- overdue P0 / P1 actions；
- repeat findings；
- risk acceptance expiry；
- limit breach response time；
- audit plan completion；
- control test completion；
- report restatement count；
- liquidity breach response；
- Board action aging；
- speak-up resolution time；
- training completion；
- unresolved ownerless issue count。

这些 metric 不得被用来惩罚报告问题的人或驱动 issue under-reporting。

---

# 11. Change / Appetite / Policy Review

## 11.1 Appetite Review Triggers

RiskAppetiteStatement 必须在以下情况 review：

- 新 Market / Legal Entity / Provider；
- 新产品、Payment rail、Payout route 或 data class；
- 重大 Incident / limit breach；
- material report restatement；
- liquidity / FX / counterparty exposure change；
- Contract / SLA / customer concentration change；
- external assurance / regulator feedback；
- acquisition / reorganization / entity replacement；
- control maturity or risk profile materially changes。

## 11.2 Risk Taxonomy Migration

RiskTaxonomy 新版本必须提供：

- old → new category mapping；
- severity mapping；
- limit mapping；
- historical comparability note；
- migration owner；
- effective time；
- reporting impact；
- Board / Committee approval。

## 11.3 Limit and Control Change

RiskLimit、ControlDefinition、PolicySet、MarketLaunchProfile、Tax / Finance policy 的变化必须评估：

- risk appetite；
- control health；
- open finding；
- audit plan；
- report / Board pack；
- customer / Enterprise contract；
- Provider / Market readiness；
- training / runbook。

## 11.4 Emergency Change

紧急变更可以先 contain，再补齐审批，但必须：

- 记录谁、何时、为什么；
- 限定 scope 和 TTL；
- 不修改不可逆历史事实；
- 创建 Incident / RiskEvent；
- 规定 retrospective review deadline；
- 评估是否影响 Trust Artifact、AuditReport 或 BoardPack。

## 11.5 Board Approval Does Not Backdate

Board 或 Committee 在某日批准的 policy / appetite / budget / risk acceptance：

- 默认从 effective_at 起生效；
- 不自动追溯批准过去未授权的交易；
- 不把历史 breach 变成不存在；
- 不将旧报告改成新口径；
- 不替代历史 source correction / restatement。

---

# 12. API / Command / Event Contract

## 12.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `CreateRiskAppetiteStatement` | Risk / Executive | 创建 appetite draft |
| `ApproveRiskAppetiteStatement` | Board / Committee | 激活有限期 appetite |
| `CreateRiskTaxonomy` | Risk | 创建 taxonomy version |
| `DefineRiskLimit` | Risk / Domain Owner | 创建 metric threshold |
| `RecordRiskMeasurement` | Monitoring | 记录 measurement / data quality |
| `CreateRiskAssessment` | Risk Owner | 创建 inherent / residual assessment |
| `RecordRiskDecision` | Authorized Risk Owner | 记录 ACCEPT / MITIGATE / PAUSE 等决策 |
| `ApproveRiskAcceptance` | Authorized Committee | 激活 residual risk acceptance |
| `CreateInternalAuditPlan` | Chief Audit / Audit Owner | 创建 risk-based plan |
| `StartAuditEngagement` | Internal Audit | 锁定 engagement scope / independence |
| `LockAuditWorkpaper` | Internal Audit | 锁定工作底稿 |
| `IssueAuditReport` | Internal Audit | 发布审计结论 / limitation |
| `CreateManagementActionPlan` | Accountable Executive | 创建整改行动 |
| `VerifyManagementAction` | Independent Verifier | 验证或 reopen action |
| `CreateBoardEscalation` | Risk / Executive | 提交 material matter |
| `RecordBoardDecision` | Board Secretariat | 记录治理决策 |
| `PublishBoardPack` | Board Secretariat | 分发受控 Board pack |
| `RevokeGovernanceArtifact` | Governance Owner | 撤回错误或过期材料 |

## 12.2 P0 Events

```text
RiskAppetiteStatementApproved
RiskTaxonomyActivated
RiskLimitActivated
RiskMeasurementRecorded
RiskLimitBreached
RiskAssessmentCompleted
RiskDecisionRecorded
RiskAcceptanceApproved
RiskAcceptanceExpired
RiskEventCreated
RiskEventEscalated
ControlHealthSnapshotGenerated
InternalAuditPlanApproved
AuditEngagementStarted
AuditWorkpaperLocked
AuditObservationRecorded
AuditReportIssued
ManagementActionCreated
ManagementActionOverdue
ManagementActionVerified
FindingReopened
BoardEscalationSubmitted
BoardMeetingHeld
BoardDecisionRecorded
BoardActionOverdue
BoardPackPublished
GovernanceArtifactRevoked
```

事件只携带必要的 scope、category、severity、decision、owner、reference、effective / expiry 和 summary，不默认携带 raw KYC、secret、bank credential 或完整 incident payload。

## 12.3 Downstream Boundary

本章 events 可以通知：

- Chapter 24 Risk / Safety / Security / Privacy；
- Chapter 28 Incident Commander / Stop-the-line；
- Chapter 34 ComplianceReview / Finding / Trust Center；
- Chapter 35 FinancialClose / Settlement / Tax；
- Chapter 36 Reporting / Treasury / Revenue；
- Enterprise Renewal / Expansion / Exit；
- Provider / Market launch gate；
- Support / Customer Success。

本章 events 不能未经 Domain owned command 直接：

- cancel Order；
- create or reverse Ledger；
- release Funding / Payout；
- mark KYC verified；
- close Safety Incident；
- change Contract or LegalEntity；
- delete privacy or audit evidence。

---

# 13. Governance Cadence

## 13.1 Daily

- P0 / P1 RiskEvent、Incident、RiskHold；
- hard limit breach；
- unowned or overdue critical action；
- Payment / Payout / Ledger / Tax / Settlement mismatch；
- liquidity / reserve / FX threshold；
- critical provider / market health；
- privileged access / privacy signal；
- Board / Committee urgent escalation queue。

## 13.2 Weekly

- KRI / KCI dashboard；
- open finding / action aging；
- exception / RiskAcceptance expiry；
- control drift / evidence freshness；
- Internal Audit fieldwork；
- management action blockers；
- customer / regulator escalations；
- risk concentration and correlated events。

## 13.3 Monthly

- Risk Committee review；
- control health by category；
- FinancialClose / restatement；
- Treasury / liquidity / revenue risk；
- Provider / Market / Legal Entity changes；
- Audit plan status；
- Board action follow-up；
- policy / limit change requests。

## 13.4 Quarterly

- RiskAppetiteStatement review；
- Board / Audit Committee pack；
- InternalAuditPlan refresh；
- material finding validation；
- scenario / resilience / incident drill；
- external assurance and regulator readiness；
- Enterprise renewal / expansion risk；
- speak-up / conduct review。

## 13.5 Annual

- Board approval of appetite and taxonomy；
- Internal Audit plan approval；
- control library coverage assessment；
- risk universe refresh；
- committee mandate / independence review；
- financial reporting / revenue / tax governance review；
- Business Continuity / Disaster Recovery / crisis exercise；
- governance artifact retention and archive。

## 13.6 Event-driven

立即触发 targeted governance review：

- P0 incident；
- hard risk limit breach；
- material financial restatement；
- liquidity buffer breach；
- external assurance withdrawal；
- regulator / customer notification；
- repeated control failure；
- unapproved market / provider operation；
- Board action overdue；
- material Contract / Legal Entity / policy change。

---

# 14. Acceptance Criteria

## AC-37-01 — Appetite Versioned

RiskAppetiteStatement 必须版本化，包含 risk category、qualitative stance、quantitative limit、exception policy、effective period 和 approving body。

## AC-37-02 — Risk Taxonomy Mapped

RiskTaxonomy 变更必须保留旧版并提供 category、severity、limit 和历史可比 mapping。

## AC-37-03 — Risk Categories Complete

Risk taxonomy 至少覆盖 Safety、Identity / KYC、Security / Privacy、Payment / Ledger、Financial / Tax、Provider / Market、Resilience、Legal / Contract、Conduct 和 Trust 风险。

## AC-37-04 — Limit Metadata

每个 RiskLimit 必须有 metric、scope、window、threshold、direction、breach action、escalation level、owner、effective period 和 approval。

## AC-37-05 — Unknown Is Not Within

RiskMeasurement 数据不完整、过期或无法验证时必须为 UNKNOWN 或带 limitation，不得自动判断为 within limit。

## AC-37-06 — Hard Stop Defined

每个 hard-stop risk limit 必须定义受影响 scope、contain action、owner、next review、resume gate 和历史事实保护规则。

## AC-37-07 — No Risk Score Masking

综合 risk score 不得隐藏 P0 / P1 Incident、Ledger mismatch、privacy exposure、liquidity breach、tax / reporting issue 或 critical provider / market suspension。

## AC-37-08 — Inherent And Residual Separate

RiskAssessment 必须分别记录 inherent risk、controls、evidence、residual risk、uncertainty、assessor 和 next review。

## AC-37-09 — RiskDecision Boundary

RiskDecision 只能表达 ACCEPT、MITIGATE、TRANSFER、AVOID、PAUSE、ESCALATE 或 REJECT 的治理结论，不能直接修改 Order、Payment、Payout、Ledger、KYC、Safety 或 Contract。

## AC-37-10 — Risk Acceptance Bounded

RiskAcceptance 必须绑定 scope、finding / exception、compensating control、accepted by、start / expiry、trigger condition、review cadence 和 notification requirements。

## AC-37-11 — Prohibited Conditions

raw secret exposure、未授权 KYC / Sanctions bypass、duplicate money operation、Ledger split-brain、未验证 payout account、material unresolved close mismatch 和过期 risk acceptance 不得通过普通 risk acceptance 继续运行。

## AC-37-12 — Risk Event Linkage

RiskEvent 必须能够关联 source、risk category、scope、affected assets、assessment、decision、escalation 和 status；不能重复创建不可关联的 incident 状态。

## AC-37-13 — KRI / KCI / KPI Separate

Board、Executive 和运营 dashboard 必须区分 risk indicator、control indicator 和 business KPI，KPI 达标不能抵消 KRI breach。

## AC-37-14 — Control Reuse

Chapter 37 必须复用 Chapter 34 的 ControlDefinition、Evidence、Assessment、Finding、Exception 和 Remediation，不创建第二套同义 canonical 状态。

## AC-37-15 — Control Health Detailed

ControlHealthSnapshot 必须包含 design、implementation、operating effectiveness、evidence freshness、overdue action、exception、drift、P0 / P1 和 unknown 信息，不能只返回总分。

## AC-37-16 — Control Failure Response

Control failure 必须能触发 contain、RiskEvent / Incident / Finding、evidence preservation、compensating control、RemediationPlan、retest 和 risk update。

## AC-37-17 — Audit Plan Risk-based

InternalAuditPlan 必须基于 inherent / residual risk、limit breach、incident、previous findings、material finance、provider / market criticality、change velocity 和 regulatory / contract obligation 排序。

## AC-37-18 — Audit Independence

InternalAuditEngagement 必须记录 auditor independence assessment；存在不可缓解冲突时不得由冲突人员作为唯一 lead / reviewer。

## AC-37-19 — Audit Scope Locked

每个 Audit Engagement 必须锁定 objective、scope、period、criteria、control refs、risk refs、procedure、team 和 limitation policy。

## AC-37-20 — Workpaper Integrity

AuditWorkpaper 必须记录 evidence、sample、procedure、observation、conclusion、preparer、reviewer 和时间；锁定后只能通过新版本更正。

## AC-37-21 — Audit Observation Linkage

AuditObservation 必须关联 criteria、condition、cause、effect / risk、severity、control、risk 和 canonical ComplianceFinding，如需要。

## AC-37-22 — Incomplete Not Effective

AuditReport 为 INCOMPLETE、NOT_RATED 或存在 scope limitation 时，不得在 Board / Trust / customer 文案中缩写为 effective 或 pass。

## AC-37-23 — Finding Single Source

Internal Audit、Incident、RiskLimit、FinancialClose、Treasury、Customer 或 Regulator 发现的同一根因必须链接到 canonical finding，不得在不同系统中独立关闭。

## AC-37-24 — Management Accountability

每个 material finding / action 必须有 accountable executive、action owner、root cause、milestones、target date、success criteria、verification method 和 interim control。

## AC-37-25 — Independent Closure

Finding 或 ManagementActionPlan 关闭必须有独立验证、implementation evidence、operating evidence、residual risk 更新和 reopen trigger；管理层自报完成不等于关闭。

## AC-37-26 — Recurrence Reopens

同一 root cause 复发时，原 finding 必须 reopen 或关联 recurrence，重新评估 severity、appetite、remediation adequacy 和 escalation。

## AC-37-27 — Escalation Levels

系统必须支持 L0 Operator、L1 Manager / Domain、L2 Risk / Compliance / Legal / Finance、L3 Executive / Committee、L4 Board / Regulator 的升级路径和 owner。

## AC-37-28 — Material Escalation Triggers

P0 / P1、hard limit breach、material restatement、liquidity breach、duplicate money mismatch、critical provider / market suspension、assurance withdrawal、overdue P0 / P1 action 和 regulatory notification 必须能创建 BoardEscalation 或同等治理记录。

## AC-37-29 — Pause Scope

Pause / stop decision 必须明确 Provider、rail、Market、MarketCell、new writes、Enterprise、feature、treasury movement 或 publication scope，不得无理由全局扩大或缩小。

## AC-37-30 — Existing Facts Preserved

Risk escalation、BoardDecision、pause 或 risk acceptance 不得自动取消 Order、reverse Ledger、释放 Payout、删除用户、invalidate KYC 或删除 Audit / Privacy evidence。

## AC-37-31 — Board Committee Mandate

BoardCommittee 必须有 mandate、authority scope、membership、independence、quorum、cadence、escalation types 和 effective period。

## AC-37-32 — Board Pack Traceability

BoardPack 必须绑定 reporting period、risk appetite、risk dashboard、control health、audit reports、financial / treasury reports、incidents、restatements、open actions、limitations 和 version。

## AC-37-33 — Board Decision Bounded

BoardDecision 必须记录 subject、rationale、conditions、authority scope、effective / expiry、accountable owner、actions 和 dissent / limitation；不能直接作为 Domain transaction command。

## AC-37-34 — Conflict And Recusal

Board / Committee meeting 必须记录 conflicts、recusal、quorum、attendees、minutes 和 decision trail；冲突未解决时不能由相关人员作为唯一 approver。

## AC-37-35 — Speak-up And No Retaliation

Risk、Audit、Safety、Privacy、Security、Financial reporting 和 conduct concern 必须有受控 reporting path、privacy boundary、owner、status 和 anti-retaliation evidence。

## AC-37-36 — Governance Does Not Fabricate Facts

系统不得因为 RiskAppetite、RiskScore、RiskAcceptance、AuditOpinion、BoardPack、BoardDecision、Executive target 或 Committee meeting 而自动生成或修改 Payment、Funding、Ledger、KYC、Safety、Tax、Invoice、Contract 或 Settlement 事实。

---

# 15. P0 / P1 Boundary

## 15.1 P0

- RiskAppetiteStatement、RiskTaxonomy、RiskCategory、RiskLimit、RiskIndicator、RiskMeasurement、RiskAssessment、RiskAcceptance、RiskEvent、ControlHealthSnapshot；
- 复用 RiskSignal、RiskDecision、Incident、RiskHold、ComplianceFinding、ComplianceException、RemediationPlan；
- InternalAuditPlan、InternalAuditEngagement、AuditProcedure、AuditWorkpaper、AuditObservation、AuditReport；
- ManagementActionPlan、AccountabilityAssignment、BoardEscalation、BoardCommittee、BoardMeeting、BoardPack、BoardDecision；
- three lines、SoD、independence、limit breach、escalation、recurrence、closure verification；
- Risk、Safety、Security、Privacy、Payment、Payout、Ledger、Tax、Settlement、Treasury、Revenue、Contract 和 Compliance cross-domain invariants；
- 36 项 AC-37 验收标准。

## 15.2 P1

- predictive risk scoring；
- automated audit sampling optimization；
- control health graph；
- continuous evidence recommendation；
- scenario-based BoardPack generation；
- automated root-cause clustering；
- risk appetite simulation；
- natural-language governance narrative；
- anonymous speak-up analytics；
- external benchmark mapping；
- autonomous remediation suggestions。

P1 自动化不能改变 P0 的 appetite、limit、SoD、audit independence、finding closure、Board authority、Domain fact、privacy、financial control 或 escalation boundary。

---

# 16. Locked Conclusions / Next Work

本章锁定：

```text
Risk appetite 是批准的边界，不是风险保证
RiskLimit breach 必须可见、可升级、可 contain，不能靠调阈值消失
Risk score 不能隐藏 P0 / P1、资金、隐私、Safety、税务或流动性风险
RiskDecision / RiskAcceptance 只表达治理判断，不直接写入 Domain
Control library 复用 Chapter 34，Internal Audit 保持独立
Audit observation、ComplianceFinding、Remediation 和 management action 必须关联
Finding 关闭需要独立验证，复发必须 reopen
Board pack 需要 source、scope、period、freshness、limitation 和 decision trail
BoardDecision 可以要求暂停、整改、资源或复核，但不能伪造交易事实
Speak-up、冲突、recusal、anti-retaliation 和 accountability 都必须留证
```

下一步进入：

```text
Chapter 38 — Regulatory Change / Policy Migration / Market Re-Approval Governance
```

Chapter 38 将处理法律、监管、税务、Provider、Market、Privacy、Safety、Contract 和 PolicySet 变化的识别、影响评估、mapping、迁移、重审、沟通与生效，确保政策变化不会静默改变历史 Domain facts。

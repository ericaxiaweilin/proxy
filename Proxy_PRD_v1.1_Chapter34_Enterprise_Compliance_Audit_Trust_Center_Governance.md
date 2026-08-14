# Proxy PRD v1.1

## Chapter 34 — Enterprise Compliance / Audit / Trust Center Governance

**文档类型**：Compliance Program / Control Evidence / Audit Response / Trust Center / External Assurance / Remediation Governance  
**状态**：ACTIVE — Enterprise Scale / Continuous Readiness  
**依赖**：Chapter 24 Account Security / Privacy / Consent / Data Lifecycle、Chapter 27 Provider Integration / Market Launch Readiness、Chapter 31 Enterprise / B2B Scale / Contract Governance、Chapter 32 Enterprise API / SSO / SCIM / Integration Contract、Chapter 33 Enterprise Migration / Adoption / Renewal Governance  
**后续**：Chapter 35 Multi-Market Legal Entity / Tax / Currency / Settlement Governance

---

# 0. 本章目标

Enterprise 进入规模化运行后，不能只靠一张“合规通过”标签、一次安全问卷或一份过期认证维持信任。

本章把以下事实连接成一条可审计、可追溯、可持续更新的证据链：

```text
Business / Enterprise Scope
→ Compliance Program
→ Framework + Control Definition
→ Control Implementation
→ Evidence Collection
→ Control Assessment
→ Finding / Exception / Remediation
→ Compliance Review Decision
→ Attestation / Assurance
→ Trust Center Artifact
→ Audit Request Response
→ Continuous Monitoring / Renewal Evidence
```

本章必须解决：

- Compliance 的 scope、period、market、provider、data boundary 如何明确；
- Control 如何被定义、分配 owner、执行、测试和留证；
- Evidence 如何证明一个限定时间与范围内的控制事实，而不是制造无限承诺；
- Audit Request 如何经过授权、最小披露、脱敏、交付和下载审计；
- Trust Center 如何给 Enterprise、Provider、Assessor 或公众展示经过批准的材料；
- Finding、Exception、Remediation 如何被关闭、延期、升级和重新打开；
- Security、Privacy、KYC、Safety、Payment、Ledger、Contract 与 Provider 事实如何互相引用但不互相改写；
- Compliance 状态变化如何触发 review、incident、contract 或 trust artifact 更新，而不自动修改交易状态。

本章不做：

- 不把 ComplianceReview 变成第二套 KYC、Risk、Safety、Ledger 或 Contract 状态机；
- 不把认证、问卷、Trust Center 文案当作“所有行为都安全”的证明；
- 不让 Enterprise Owner、Compliance Admin 或 API Client 读取不属于其 scope 的 raw KYC、私密内容、Secrets 或其他 Business 数据；
- 不因为一个 Provider、Market 或 Enterprise 的 assurance 结果就改写既有 Order、Payment、Payout、Ledger、KYC、Safety 或 Audit fact；
- 不在没有当前证据、批准版本和适用范围的情况下发布“认证”“合规”“保证”类外部声明。

## 0.1 本章核心结论

```text
Compliance status = scoped evidence-based assessment
Compliance review ≠ Domain transaction state
Trust Center artifact ≠ raw audit repository
Attestation ≠ universal warranty
Exception ≠ permission bypass
Audit package ≠ unrestricted data export
Expired evidence ≠ current compliance proof
```

## 0.2 关键事实边界

| 事实 | 归属 | 本章如何引用 | 本章不能做的事 |
|---|---|---|---|
| UserAccount / Session / LoginIdentity | Account Security | 引用当前状态、Access Audit、Recovery evidence | 不创建第二套登录事实 |
| Consent / Privacy / D0–D5 / LegalHold | Privacy & Data Lifecycle | 引用 purpose、retention、hold、redaction | 不因审计删除例外而扩大访问 |
| KYCProfile / KYCDocument / KYC attempt | KYC / Provider | 只引用 decision、level、expiry、provider ref | 不把 audit attachment 直接当 KYC VERIFIED |
| Safety / Risk / Incident | Safety / Risk | 引用 incident、control、response SLA | 不用合规通过关闭安全风险 |
| Payment / Payout / Ledger | Money | 引用 reconciliation、financial control、statement | 不用 evidence 伪造 Ledger entry |
| EnterpriseContract / SLA / Invoice | Enterprise Contract | 引用版本、obligation、measurement | 不把 compliance attestation 变成合同承诺 |
| ProviderConnection / MarketLaunchProfile | Provider / Market | 引用 capability、approval、expiry、incident | 不因 Provider certificate 自动允许新路由 |
| MigrationProgram / AdoptionPlan / RenewalReview | Enterprise Lifecycle | 引用 migration、health、renewal evidence | 不把健康分数当作合规结论 |

---

# 1. Compliance Constitution

## 1.1 Compliance 是有范围的判断

所有 Compliance 结论必须绑定以下 `ComplianceScope`：

```text
scope_id
organization_ref
business_account_refs[]
system_refs[]
environment: PROD / STAGING / SANDBOX / CORPORATE
market_refs[]
provider_refs[]
data_categories[]
framework_ref
control_version_set
period_start
period_end
review_as_of
owner_ref
```

没有 scope 的结论只能是一般性说明，不得作为：

- Enterprise procurement 的正式 assurance；
- Regulator / Assessor 的审计响应；
- Contract 中的 security、privacy、availability 或 compliance 承诺；
- Trust Center 的公开认证声明；
- Provider 或 Market 的上线 Gate。

## 1.2 Evidence 优先于标签

系统可以展示：

- `review_status`；
- `control_pass_rate`；
- `open_finding_count`；
- `critical_exception_count`；
- `evidence_freshness`；
- `attestation_expiry`；
- `trust_artifact_version`。

系统不得只展示一个无 scope、无 period、无 limitations 的 `COMPLIANT` 标签作为全部事实。

## 1.3 Compliance 不重写 Domain Truth

Compliance Review、Control Assessment、External Assurance 或 Trust Center 发布结果不能直接：

- 把 `KYC_PENDING` 改成 `KYC_VERIFIED`；
- 把 `PaymentFailed` 改成 `PaymentSucceeded`；
- 把 `Ledger` 中不存在的钱变成可用余额；
- 把 `SafetyIncident` 改为 resolved；
- 把 `UserAccount`、`EnterpriseMembership` 或 `Business` 的权限提升；
- 把 ProviderConnection 从 `SUSPENDED` 改成 `ACTIVE`；
- 把 MarketLaunchProfile 的未批准市场变成 launch-ready；
- 把 EnterpriseContract 的未签署版本变成有效合同。

这些改变必须通过所属 Domain 的 owned command、approval、effective time 和 Audit。

## 1.4 Control 必须有 owner 和 tester

每个 P0 control 至少需要：

- 一个 accountable owner；
- 一个执行或系统自动化来源；
- 一个独立 reviewer / tester；
- 一个 evidence source；
- 一个评估频率；
- 一个失败处理路径；
- 一个 evidence retention 和 expiry 规则。

同一人不得在无批准的情况下同时作为 Critical Control 的唯一 owner、唯一 tester 和唯一 exception approver。

## 1.5 例外不是绕过

Exception 只能表达：

```text
已识别的 control gap
→ 风险与范围已记录
→ 有限期补偿措施
→ 明确 owner 与到期日
→ 具备升级和关闭条件
```

Exception 不得授予以下权限：

- 绕过 KYC / AML / Sanctions；
- 绕过 Safety / Incident response；
- 绕过 Consent / Privacy / Data residency；
- 修改 Payment / Payout / Ledger；
- 把 raw secret、raw credential 或 raw KYC 放入不允许的系统；
- 把未验证外部陈述发布为认证事实。

## 1.6 Trust Center 是受控的展示层

Trust Center 只能展示经过批准、版本化、已脱敏并且在有效期内的 Artifact。

Trust Center 不等同于：

- 内部 AuditLog；
- Evidence Vault；
- EnterpriseExportRequest 的全部数据；
- Security Incident 的原始调查材料；
- 员工或用户的个人资料；
- KYC、Payout、Bank、Session 或设备原始数据。

---

# 2. Compliance Domain Objects

## 2.1 ComplianceProgram

```text
ComplianceProgram
├── id
├── organization_ref
├── name
├── owner_ref
├── program_type: ENTERPRISE / PROVIDER / MARKET / PRODUCT / INTERNAL
├── status: PLANNING / ACTIVE / PAUSED / CLOSED
├── framework_refs[]
├── scope_refs[]
├── review_cadence
├── evidence_retention_policy_ref
├── escalation_policy_ref
├── created_at
├── updated_at
└── audit_ref
```

一个 Organization 可以有多个 Program，但每个 Review 必须指出所属 Program，不能把不同 scope 的控制结果混成一个总分。

## 2.2 ComplianceFramework

```text
ComplianceFramework
├── id
├── name
├── version
├── issuer_ref
├── framework_type: INTERNAL / CONTRACTUAL / REGULATORY / ASSURANCE
├── effective_from
├── effective_to?
├── control_definition_refs[]
├── evidence_requirements[]
├── assessment_method
├── status: DRAFT / ACTIVE / RETIRED
└── audit_ref
```

Framework version 一旦被 Review 使用，不得原地修改。新增要求必须创建新版本并记录 migration / mapping。

## 2.3 ComplianceScope

```text
ComplianceScope
├── id
├── organization_ref
├── principal_scope_refs[]
├── system_refs[]
├── environment
├── market_refs[]
├── provider_refs[]
├── data_category_refs[]
├── framework_ref
├── control_version_set
├── period_start
├── period_end
├── exclusions[]
├── owner_ref
├── approved_by[]
└── audit_ref
```

任何 exclusion 都必须写明理由、风险、替代 evidence 和是否影响外部声明。

## 2.4 ControlDefinition

```text
ControlDefinition
├── id
├── framework_ref
├── control_code
├── title
├── objective
├── risk_statement
├── control_type: PREVENTIVE / DETECTIVE / CORRECTIVE
├── execution_mode: MANUAL / AUTOMATED / HYBRID
├── frequency
├── owner_role
├── tester_role
├── required_evidence_types[]
├── test_procedure
├── pass_criteria
├── failure_severity
├── exception_allowed
├── retention_policy_ref
├── version
└── status: DRAFT / ACTIVE / RETIRED
```

ControlDefinition 只定义“要控制什么、如何判断”，不保存某个周期的 pass 结果。

## 2.5 ControlImplementation

```text
ControlImplementation
├── id
├── control_definition_ref
├── scope_ref
├── implementation_owner_ref
├── system_or_process_ref
├── implementation_status: DESIGNED / IMPLEMENTED / PARTIAL / NOT_IMPLEMENTED
├── procedure_ref
├── evidence_source_refs[]
├── last_tested_at?
├── known_gaps[]
├── compensating_control_refs[]
└── audit_ref
```

同一个 ControlDefinition 在不同 Market、Provider、Environment 或 Enterprise Scope 中可以有不同 Implementation，但必须分别评估。

## 2.6 ComplianceEvidence

```text
ComplianceEvidence
├── id
├── scope_ref
├── control_ref
├── source_type: SYSTEM / HUMAN / PROVIDER / EXTERNAL_ASSURANCE / CONFIG / METRIC / AUDIT_EVENT
├── source_ref
├── collected_at
├── valid_from
├── valid_to?
├── collector_ref
├── integrity_hash
├── classification: PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED
├── sensitivity_tags[]
├── redaction_status: NONE / PARTIAL / FULL
├── retention_policy_ref
├── legal_hold_ref?
├── status: COLLECTED / VALIDATED / REJECTED / EXPIRED / ARCHIVED
├── limitation_notes[]
└── audit_ref
```

Evidence 必须记录 `source_ref` 和 `integrity_hash`。只上传一张截图而没有来源、时间和范围的材料默认不能作为 P0 Control 的充分证据。

## 2.7 EvidenceCollection

```text
EvidenceCollection
├── id
├── scope_ref
├── review_ref
├── requested_control_refs[]
├── source_system_refs[]
├── collector_ref
├── started_at
├── completed_at?
├── result: COMPLETE / PARTIAL / FAILED
├── evidence_refs[]
├── missing_items[]
├── collection_log_ref
└── audit_ref
```

EvidenceCollection 是采集过程，不是 Evidence 本身。采集失败、缺失和重试必须被留证。

## 2.8 ComplianceReview

```text
ComplianceReview
├── id
├── program_ref
├── scope_ref
├── framework_ref
├── review_type: INITIAL / PERIODIC / CHANGE / INCIDENT / RENEWAL / CUSTOMER_REQUEST
├── status: SCOPING / COLLECTING / TESTING / FINDINGS / REMEDIATING / ATTESTATION / PUBLISHED / CLOSED / PAUSED / EXPIRED
├── period_start
├── period_end
├── control_assessment_refs[]
├── finding_refs[]
├── exception_refs[]
├── attestation_ref?
├── reviewer_refs[]
├── decision: PASS / PASS_WITH_EXCEPTION / FAIL / INCOMPLETE
├── limitations[]
├── approved_at?
├── expires_at?
└── audit_ref
```

`PASS_WITH_EXCEPTION` 必须带 exception、compensating control、owner、due date 和对外披露判断。

## 2.9 ControlAssessment

```text
ControlAssessment
├── id
├── review_ref
├── control_definition_ref
├── implementation_ref
├── evidence_refs[]
├── tester_ref
├── tested_at
├── result: PASS / PARTIAL / FAIL / NOT_APPLICABLE / NOT_TESTED
├── test_notes
├── deficiency_refs[]
├── exception_ref?
├── retest_due_at?
└── audit_ref
```

`NOT_TESTED` 不能在没有 limitation 的情况下被汇总为 `PASS`。

## 2.10 ComplianceFinding

```text
ComplianceFinding
├── id
├── review_ref
├── scope_ref
├── control_ref?
├── source: ASSESSMENT / INCIDENT / MONITOR / AUDIT / CUSTOMER / PROVIDER
├── title
├── description
├── severity: P0 / P1 / P2 / P3
├── affected_assets[]
├── affected_data_categories[]
├── status: OPEN / ACKNOWLEDGED / REMEDIATING / ACCEPTED_RISK / VERIFIED / CLOSED / REOPENED
├── owner_ref
├── due_at
├── remediation_plan_ref?
├── exception_ref?
├── evidence_refs[]
├── impact_assessment
├── discovered_at
├── resolved_at?
└── audit_ref
```

## 2.11 ComplianceException

```text
ComplianceException
├── id
├── scope_ref
├── control_ref
├── finding_ref
├── requester_ref
├── business_justification
├── risk_statement
├── affected_assets[]
├── affected_data_categories[]
├── compensating_control_refs[]
├── start_at
├── expires_at
├── approval_refs[]
├── status: DRAFT / REVIEW / APPROVED / ACTIVE / EXPIRED / REJECTED / REVOKED
├── renewal_count
├── external_disclosure_required
└── audit_ref
```

P0 exception 默认不允许。确需继续运行时，必须转入 Incident / Executive / Legal / Security decision，并且不能降低法定、Safety、KYC、Privacy 或 Ledger 要求。

## 2.12 RemediationPlan

```text
RemediationPlan
├── id
├── finding_ref
├── owner_ref
├── actions[]
├── milestones[]
├── target_due_at
├── dependency_refs[]
├── verification_method
├── status: PLANNED / IN_PROGRESS / BLOCKED / READY_FOR_RETEST / VERIFIED / CANCELLED
├── residual_risk
└── audit_ref
```

## 2.13 ComplianceAttestation

```text
ComplianceAttestation
├── id
├── review_ref
├── issuer_type: INTERNAL_OWNER / EXECUTIVE / EXTERNAL_ASSESSOR / REGULATOR
├── issuer_ref
├── assertion_text
├── scope_ref
├── period_start
├── period_end
├── limitations[]
├── exception_refs[]
├── issued_at
├── expires_at
├── signature_ref
├── status: DRAFT / ISSUED / WITHDRAWN / EXPIRED
└── audit_ref
```

Assertion 必须使用限定性语言，例如“在所述 scope 和 period 内，根据所述程序评估”。不得写成无边界的安全保证。

## 2.14 TrustCenterProfile

```text
TrustCenterProfile
├── id
├── organization_ref
├── audience: PUBLIC / CUSTOMER / PROVIDER / REGULATOR / INTERNAL
├── supported_markets[]
├── supported_products[]
├── security_contact
├── privacy_contact
├── incident_contact
├── published_artifact_refs[]
├── last_reviewed_at
├── next_review_at
├── owner_ref
├── status: DRAFT / ACTIVE / PAUSED / RETIRED
└── audit_ref
```

## 2.15 TrustCenterArtifact

```text
TrustCenterArtifact
├── id
├── profile_ref
├── artifact_type: SECURITY_OVERVIEW / PRIVACY_NOTICE / DPA_SUMMARY / SUBPROCESSOR_LIST / CERTIFICATION / ASSURANCE_REPORT / BCP_SUMMARY / INCIDENT_NOTICE / FAQ
├── title
├── version
├── content_ref
├── claim_refs[]
├── evidence_refs[]
├── scope_ref
├── classification
├── redaction_status
├── approved_by[]
├── published_at?
├── expires_at?
├── status: DRAFT / REVIEW / APPROVED / PUBLISHED / EXPIRED / RETIRED
├── change_reason?
└── audit_ref
```

## 2.16 AuditRequest

```text
AuditRequest
├── id
├── requester_type: INTERNAL / ENTERPRISE / PROVIDER / ASSESSOR / REGULATOR / LEGAL
├── requester_ref
├── organization_ref
├── purpose
├── scope_ref
├── requested_control_refs[]
├── requested_period
├── requested_deadline
├── requested_data_categories[]
├── nda_or_legal_basis_ref?
├── approval_refs[]
├── status: SUBMITTED / TRIAGED / APPROVED / COLLECTING / REVIEW / REDACTION / PACKAGED / SHARED / EXPIRED / CLOSED / REJECTED
├── response_package_ref?
└── audit_ref
```

## 2.17 AuditResponsePackage

```text
AuditResponsePackage
├── id
├── audit_request_ref
├── scope_ref
├── manifest_ref
├── evidence_refs[]
├── attestation_refs[]
├── limitation_refs[]
├── redaction_log_ref
├── package_hash
├── generated_at
├── expires_at
├── download_policy_ref
├── recipient_refs[]
├── status: DRAFT / REVIEW / READY / SHARED / EXPIRED / REVOKED
└── audit_ref
```

## 2.18 ExternalAssuranceReport

```text
ExternalAssuranceReport
├── id
├── issuer_ref
├── report_type
├── scope_ref
├── period_start
├── period_end
├── opinion: UNQUALIFIED / QUALIFIED / ADVERSE / DISCLAIMER / OTHER
├── control_mapping_refs[]
├── exceptions[]
├── limitations[]
├── report_ref
├── authenticity_check_ref
├── received_at
├── expires_at?
├── status: RECEIVED / VALIDATED / SUPERSEDED / REJECTED / EXPIRED
└── audit_ref
```

## 2.19 ComplianceSignal

```text
ComplianceSignal
├── id
├── signal_type: CONTROL_DRIFT / EVIDENCE_EXPIRY / INCIDENT / ACCESS_ANOMALY / PROVIDER_CHANGE / MARKET_CHANGE / CONTRACT_CHANGE / DATA_EVENT
├── source_ref
├── scope_ref
├── detected_at
├── severity
├── affected_control_refs[]
├── recommended_action
├── linked_review_ref?
├── linked_finding_ref?
├── status: NEW / TRIAGED / ACTIONED / DISMISSED / FALSE_POSITIVE
└── audit_ref
```

---

# 3. Compliance Scope 与控制分层

## 3.1 Scope 层级

Compliance scope 按以下层级组织：

```text
Organization
├── Product / System
│   ├── Environment
│   ├── Market
│   ├── Provider
│   └── Data Category
├── BusinessAccount / Enterprise Contract
├── Integration / API Client
└── Period / Framework Version
```

一个公开 Trust Artifact 可以覆盖多个 scope，但必须列明覆盖范围、排除项和最近 review 日期。

## 3.2 控制类别

| 类别 | 控制目标 | 代表性证据 | 事实来源 |
|---|---|---|---|
| Governance | owner、policy、SoD、review cadence | policy version、approval、meeting record | Compliance / Enterprise Governance |
| Account Security | authentication、session、recovery、step-up | config snapshot、access audit、test result | Chapter 24 / 32 |
| Privacy | consent、purpose、retention、deletion、export | ConsentRecord、retention job、redaction log | Chapter 24 |
| Data Security | encryption、secret、classification、access | config、key rotation record、access log | Security / Provider |
| KYC / AML | identity、document、market requirement、manual review | KYC decision、provider result、legal approval | Chapter 24 / 27 |
| Safety | incident、emergency、risk response、support SLA | Incident、runbook drill、response timeline | Safety / Chapter 28 |
| Money | Payment、Payout、Ledger、reconciliation | provider reconciliation、ledger report、statement | Money Domain |
| Provider | capability、routing、callback、failover、subprocessor | ProviderConnection、ProviderCapability、certificate | Chapter 27 |
| Market | legal、tax、currency、residency、launch gate | MarketLaunchProfile、approval matrix | Chapter 27 |
| Enterprise | contract、SLA、membership、billing、export | EnterpriseContract、Invoice、AuditLog | Chapter 31 / 32 |
| Migration | mapping、identity match、checksum、cutover | MigrationRecord、ReconciliationResult | Chapter 33 |
| Availability | capacity、backup、restore、regional failover | drill record、RTO/RPO metric | Chapter 30 |
| Change | version、approval、rollback、deprecation | ChangeRequest、deploy record、rollback test | Engineering |

## 3.3 Control 与 Domain 的关系

```text
ControlDefinition
    ↓ defines test
ControlImplementation
    ↓ operates in scope
ComplianceEvidence
    ↓ supports assessment
ControlAssessment
    ↓ contributes to
ComplianceReview
    ↓ may produce
Finding / Exception / Attestation / Trust Artifact
```

Control 只能产生 compliance evidence 和 review outcome。要改变 Domain fact，必须回到对应 Domain 的 command。

## 3.4 P0 Control 规则

以下控制默认 P0：

- raw secret、credential、token 不进入日志、Evidence、Export 或 Trust Center；
- KYC / AML / Sanctions 的强制要求不能被例外绕过；
- Safety emergency、critical incident、blocked account 的处理路径可用；
- Payment / Payout / Ledger reconciliation 有明确 owner 和 mismatch handling；
- Enterprise export、audit package、Trust artifact 有 scope 和 access audit；
- 生产环境的高权限访问有 least privilege、step-up、SoD 和撤销路径；
- Data retention、LegalHold、deletion 与 privacy request 有可证明结果；
- Provider 与 Market 的上线审批、expiry、suspend / failover 路径有效。

---

# 4. Control Lifecycle

## 4.1 ControlDefinition 生命周期

```text
DRAFT
  ↓ owner + risk review
ACTIVE
  ↓ superseded / withdrawn
RETIRED
```

ControlDefinition 从 `ACTIVE` 变更为新版本时：

- 保留旧版本及其历史评估；
- 新版本写明 effective date；
- 建立旧版到新版的 mapping；
- 对受影响 Review 生成 `CONTROL_VERSION_CHANGE` signal；
- 明确是否需要重新收集 evidence；
- 不把旧版 PASS 自动转成新版 PASS。

## 4.2 Evidence 生命周期

```text
REQUESTED
  ↓ source collected
COLLECTED
  ↓ integrity / scope / freshness check
VALIDATED
  ├──→ EXPIRED
  ├──→ REJECTED
  └──→ ARCHIVED
```

Evidence 过期后仍可作为历史记录，但不能支持当前 period 的无条件结论。

## 4.3 Review 生命周期

| 状态 | 进入条件 | 允许动作 | 退出条件 |
|---|---|---|---|
| `SCOPING` | Program 创建 review | 定义 scope、period、framework | scope 批准 |
| `COLLECTING` | scope 已批准 | 请求、采集、重试 evidence | required evidence 齐备或记录缺失 |
| `TESTING` | evidence collection 完成 | tester 执行 procedure | control assessment 完成 |
| `FINDINGS` | assessment 有 gap | open finding、制定 remediation | finding 有 owner 和 action |
| `REMEDIATING` | 存在未关闭 gap | 修复、补偿、retest | P0/P1 关闭或批准 exception |
| `ATTESTATION` | 结论可被签署 | 生成 attestation、记录 limitations | issuer 签署或拒绝 |
| `PUBLISHED` | 允许外部展示 | 发布绑定的 Trust Artifact | artifact 到期或撤回 |
| `CLOSED` | review 完成 | 只读查询、历史审计 | 新 signal 可 reopen 新 review |
| `PAUSED` | 依赖、事件或法律原因 | 保留事实、暂停外部声明 | 恢复或关闭 |
| `EXPIRED` | period / evidence 过期 | 触发 renewal / refresh | 新 review 建立 |

## 4.4 Review Decision 规则

```text
PASS
    无未处理的 P0/P1 finding，required control 均已测试
PASS_WITH_EXCEPTION
    gap 已公开、exception 有效、compensating control 可验证
FAIL
    P0/P1 gap 未处理，或关键 evidence 无法验证
INCOMPLETE
    scope、evidence、tester、period 或 control mapping 不完整
```

`INCOMPLETE` 不能被外部文案缩写为 `PASS`。

---

# 5. Evidence Constitution

## 5.1 Evidence 最小证明单元

每项 evidence 至少包含：

```text
what: 证明什么 control / assertion
where: 属于哪个 scope / asset / system
when: collected_at + valid period
who: collector / owner / issuer
how: source + collection method
integrity: hash / signature / provider authenticity
limits: 未覆盖什么、是否抽样、是否脱敏
retention: 到期、LegalHold、删除规则
```

## 5.2 Evidence 来源可信度

| 来源 | 默认可信度 | 必须补充 | 不能单独证明 |
|---|---|---|---|
| System-generated | 高 | source、query、time、integrity | 未配置的业务流程 |
| Config snapshot | 中高 | environment、version、effective time | 实际运行一定没有 drift |
| Audit event | 高 | actor、command、result、scope | 未记录的隐式动作 |
| Human attachment | 中 | issuer、签名、period、verification | 全系统状态 |
| Provider certificate | 中高 | issuer、scope、expiry、applicability | Proxy 自身所有控制 |
| External assurance | 高 | opinion、limitation、period、mapping | report scope 之外的功能 |
| Customer questionnaire | 低到中 | respondent、source、review | 独立验证的事实 |
| Screenshot | 低 | source、timestamp、environment | 持续性控制 |

## 5.3 Evidence 完整性

Evidence collection 必须支持：

- 稳定 `evidence_id`；
- source reference；
- content hash；
- collector identity；
- collection timestamp；
- scope and period；
- duplicate detection；
- correction / supersede chain；
- access log；
- download / share expiry。

原始材料被替换时，不能覆盖旧 evidence。应创建新版本并标记 `SUPERSEDES` 关系。

## 5.4 Raw Sensitive Data 边界

默认不得放入 ComplianceEvidence、AuditResponsePackage 或 TrustCenterArtifact：

- Government ID 原图；
- raw KYC document、selfie、liveness video；
- bank account number、card PAN、payment credential；
- session token、API secret、private key；
- 私密聊天全文、未授权员工个人资料；
- 精确 location history；
- 未经 consent 的 camera / media 原文件；
- 可直接识别个人的完整 incident payload。

需要证明控制时，优先使用：

- decision、status、level、expiry；
- masked / tokenized identifier；
- aggregate metric；
- redacted sample；
- provider reference；
- signed attestation；
- query result with least data。

## 5.5 Evidence Retention

Evidence retention 必须与 Chapter 24 的 D0–D5、LegalHold、Contract obligation 和 Market 法律要求交叉计算：

```text
effective_retention
= max(product_requirement,
      legal_requirement,
      contract_requirement,
      active_legal_hold)
```

但 retention 延长不等于访问权限延长。任何延长都必须保留原因、owner、到期检查和访问审计。

---

# 6. Compliance Assessment 与 Testing

## 6.1 测试方法

Control tester 可以使用：

- inquiry：向 owner 询问流程和边界；
- inspection：检查 policy、config、log、approval、evidence；
- observation：观察实际操作或 drill；
- reperformance：重新执行控制或 reconciliation；
- sampling：按 approved sampling method 抽样；
- automated test：系统规则或 continuous monitor；
- external validation：Provider / Assessor / Regulator 的独立结果。

测试记录必须写明方法、样本、排除项、失败项和结论依据。

## 6.2 采样规则

Sampling 必须记录：

```text
population_definition
sample_method
sample_size
sample_period
selection_seed_or_rule
excluded_items
observed_exceptions
tester
```

无法解释样本如何选取时，只能作为 limited evidence，不能支持无保留的 P0 结论。

## 6.3 自动化测试与人工复核

自动化检查可以发现：

- expired evidence；
- missing owner；
- stale access；
- config drift；
- unapproved Provider / Market setting；
- missing audit event；
- overdue remediation；
- unmatched scope；
- excessive export permission。

自动化检查不能自动：

- 关闭 P0 finding；
- 批准 exception；
- 发布认证声明；
- 删除 incident evidence；
- 修改 KYC、Safety、Payment、Ledger 或 Contract 状态。

## 6.4 Assessment 结论

每项 `ControlAssessment` 必须引用：

- ControlDefinition version；
- ControlImplementation；
- evidence ids；
- tester；
- test date；
- result；
- test notes；
- limitation / deficiency；
- retest date，如适用。

## 6.5 Control Metrics

推荐记录：

```text
control_coverage_rate
evidence_freshness_rate
assessment_completion_rate
open_finding_count_by_severity
overdue_remediation_count
exception_expiry_count
stale_privileged_access_count
unredacted_export_attempt_count
provider_certificate_expiry_count
market_approval_expiry_count
audit_response_sla
trust_artifact_staleness
```

Metric 是观察事实，不得直接作为外部 certification assertion，除非对应定义、period、scope、calculation 和 limitation 都已批准。

---

# 7. Findings / Exceptions / Remediation

## 7.1 Finding 严重度

| 等级 | 含义 | 默认响应 | 是否可长期 exception |
|---|---|---|---|
| `P0` | 法律、安全、隐私、凭据、资金或核心控制存在立即重大风险 | 立即 contain、Incident / Executive / Legal review | 默认不可 |
| `P1` | 重要控制失效、范围扩大或期限内无法证明 | owner + 设定短期 due date + escalation | 仅在补偿措施严格受控时 |
| `P2` | 局部、可控、不会立即扩大核心风险 | remediation plan | 可有限期 |
| `P3` | 文档、效率或低风险流程缺口 | backlog / process improvement | 可按 policy |

严重度不能只由客户合同等级决定。Enterprise 高等级不能把 P0 降为 P2。

## 7.2 Finding 创建条件

以下情况至少创建 P1 finding 或 compliance signal：

- required evidence 缺失或无法验证；
- control owner / tester 缺失；
- evidence 已过期但仍被用于 current assertion；
- provider / market approval 到期；
- P0 permission 无法回收；
- audit package 包含不应披露的数据；
- Trust Center artifact 的 claim 超过证据 scope；
- remediation overdue 且没有有效 exception；
- migration reconciliation 的财务或身份差异未解释；
- external assurance 的 limitation 影响当前声明。

## 7.3 Exception Review

Exception 审批至少需要：

- finding 与 control reference；
- business justification；
- risk owner；
- affected asset / data category；
- compensating controls；
- start / expiry；
- external disclosure decision；
- rollback / stop condition；
- reviewer 与 SoD check。

不得用“客户很重要”“续约即将到期”“上线时间紧”作为唯一批准理由。

## 7.4 Compensating Control

补偿控制必须满足：

- 能减少原始风险，而非只记录风险；
- 有独立 owner；
- 有 evidence source；
- 有执行频率；
- 有失败处理；
- 在 exception 到期前完成修复或重新评估。

仅增加一张说明文档、口头承诺或手工备注不构成充分 compensating control。

## 7.5 Remediation 状态

```text
OPEN FINDING
→ ACKNOWLEDGED
→ REMEDIATION PLANNED
→ IN_PROGRESS
→ READY_FOR_RETEST
→ VERIFIED
→ CLOSED
```

关闭 finding 必须有独立 retest 或明确的 verification evidence。关闭后发现同一根因仍存在时，状态改为 `REOPENED`，不能只创建一条新 P3 记录掩盖历史。

## 7.6 Overdue Escalation

```text
due_at - 7d: owner reminder
due_at: manager escalation
due_at + 1d: Compliance owner + Control tester
due_at + 3d: Security / Privacy / Legal / Finance as applicable
due_at + policy threshold: pause claim, scope, integration or launch gate
```

升级不一定自动暂停交易，但必须重新评估是否还能发布相应的 Compliance / Trust 声明。

---

# 8. Compliance Review Governance

## 8.1 Review 类型

| 类型 | 触发条件 | 典型输出 |
|---|---|---|
| `INITIAL` | 新 Program / Market / Provider / Enterprise 上线 | baseline review |
| `PERIODIC` | 月度、季度、年度 cadence | current assessment |
| `CHANGE` | Control、Provider、Market、Contract、System 变更 | impact review |
| `INCIDENT` | P0/P1 Security、Privacy、Safety、Money 事件 | incident-linked review |
| `RENEWAL` | Contract、Assurance、Certification 或 Evidence 到期 | renewal evidence |
| `CUSTOMER_REQUEST` | Enterprise audit questionnaire / due diligence | scoped response |

## 8.2 Review Gate

Review 进入 `ATTESTATION` 前必须满足：

- scope 已批准；
- framework version 已锁定；
- required controls 有 assessment；
- P0/P1 findings 有处理结论；
- exception 已批准且未过期；
- limitations 已列明；
- evidence retention / legal hold 已检查；
- reviewer 和 issuer 不违反 SoD；
- 对外声明范围已审阅。

## 8.3 PASS_WITH_EXCEPTION

允许 `PASS_WITH_EXCEPTION` 的最低条件：

- finding 不是不可绕过的法定、Safety、KYC、Privacy 或 Ledger 控制；
- exception 状态为 `ACTIVE`；
- 有有效的 compensating control；
- due date 和 owner 已记录；
- 外部 recipient 能看到适用的 limitation；
- Trust Center claim 没有掩盖 exception。

## 8.4 Review Pause

Review 必须进入 `PAUSED` 的情况：

- 发生重大 Security / Privacy / Safety / Money incident；
- Scope 发生未批准的重大变化；
- External assurance 被撤回或发现 authenticity 问题；
- Provider / Market approval 失效；
- 关键 evidence 被 legal hold、investigation 或 privacy restriction 阻断；
- 仍在使用的 ControlDefinition 已 retired 且没有 mapping；
- 审计请求范围冲突，无法在合法最小披露下完成。

Paused 期间可以保留历史事实，但不能发布新的无条件 Trust claim。

---

# 9. Trust Center Governance

## 9.1 Trust Center 信息架构

```text
Overview
├── Security Overview
├── Privacy / DPA Summary
├── Data Processing / Residency
├── Subprocessor / Provider List
├── Certifications / Assurance Reports
├── Business Continuity Summary
├── Incident / Status Notices
├── Customer Audit Request
└── Security / Privacy Contact
```

每个页面或材料必须显示：

- artifact version；
- published date；
- review date；
- expiry date，如适用；
- applicable scope；
- exclusions / limitations；
- contact path。

## 9.2 Trust Claim 规则

允许：

- “在指定 period 和 scope 内完成某项独立评估”；
- “支持以下 market / provider / data residency 配置”；
- “根据当前 policy 提供以下安全和隐私控制”；
- “以下 assurance report 可供授权客户访问”；
- “过去某 period 内记录的 incident 摘要”。

不允许：

- “永远安全”；
- “零风险”；
- “所有数据都符合所有法规”；
- “通过认证所以无需客户自己的审查”；
- “SSO / SCIM 已配置所以用户已完成 KYC”；
- “有 SLA 所以所有 Order 都保证完成”；
- “Provider 有证书所以所有 Provider 行为均由 Proxy 负责”。

## 9.3 发布 Gate

TrustCenterArtifact 进入 `PUBLISHED` 前必须通过：

1. 内容 owner review；
2. Security / Privacy / Legal review，按 artifact type；
3. Evidence scope 与 claim mapping；
4. redaction review；
5. expiry / next review date；
6. customer / public audience review；
7. version、change reason 和 rollback / retire plan；
8. audit event。

公开 artifact 不得包含 Enterprise 专属合同价格、员工个人信息、客户名单、raw incident payload、KYC 文件、secret 或未发布 vulnerability detail。

## 9.4 Artifact 过期与撤回

以下情况必须触发 `EXPIRED`、`RETIRED` 或临时 `PAUSED`：

- period 结束且没有新 review；
- supporting evidence 过期；
- control assessment 被撤回；
- ExternalAssuranceReport 被 superseded 或 qualified opinion 改变结论；
- Provider / Market / Contract scope 变化；
- Security / Privacy / Legal review 要求撤回；
- 公开文案超过当前系统实际能力。

撤回不是删除。旧版本必须保留其发布时间、scope、访问记录和撤回原因。

## 9.5 Customer-specific Trust Room

Enterprise-specific 材料可以通过 Customer Trust Room 提供，但必须：

- 绑定 EnterpriseOrganization、合同或 AuditRequest；
- 采用最小 scope；
- 逐文件或按 package 授权；
- 有 expiry、download audit 和 revoke；
- 不允许 recipient 再发布未授权内容；
- 遵守 Chapter 32 的 ExportRequest、step-up、approval 和 redaction boundary。

---

# 10. Audit Request / Response Contract

## 10.1 请求分类

| 请求人 | 常见目的 | 默认数据范围 | 额外要求 |
|---|---|---|---|
| Internal | control testing、incident、renewal | internal scoped evidence | owner / tester / SoD |
| Enterprise | procurement、due diligence、contract audit | approved Trust Artifact / package | contract、NDA、scope |
| Provider | integration / subprocessor assurance | provider-related controls | provider relationship、DPA |
| Assessor | independent assurance | approved test population | engagement letter、workpaper rule |
| Regulator | legal / supervisory request | legal scope | authority、legal hold、legal review |
| Legal | dispute、claim、investigation | matter scope | legal basis、hold、privilege |

## 10.2 请求处理流程

```text
SUBMITTED
→ TRIAGED
→ SCOPE_APPROVED
→ COLLECTING
→ PRIVACY / SECURITY REVIEW
→ REDACTION
→ PACKAGE_REVIEW
→ SHARED
→ EXPIRED / CLOSED
```

## 10.3 Triage 检查

每个 AuditRequest 必须确认：

- requester identity；
- organization / Enterprise relationship；
- purpose；
- legal basis / NDA，如需要；
- requested period；
- requested control / data category；
- deadline 与合理性；
-是否涉及 raw sensitive data；
- 是否影响 incident、legal hold、privacy request；
- 是否需要 executive / legal / privacy approval；
- 是否存在更小的 Trust Artifact 可以满足目的。

## 10.4 Response Package 内容

标准 package 包含：

```text
cover_note
scope_statement
period_statement
framework_and_control_mapping
evidence_manifest
selected_evidence
attestation_or_external_report
limitations_and_exceptions
redaction_log
package_hash
generated_at
expiry_at
recipient_and_access_policy
contact_for_questions
```

Package 不得通过附件方式偷偷加入 scope 外的数据。

## 10.5 Redaction 规则

Redaction 必须保留：

- 文档存在与版本事实；
- 被删除字段的类别，而不是原始值；
- 删除理由；
- 执行人 / 时间；
- 如影响结论，则写入 limitation。

不能通过过度 redaction 隐藏会改变结论的事实。若关键信息必须被隐藏，应将响应结论降级为 `LIMITED` 或 `INCOMPLETE`，而不是继续发布完整 assurance。

## 10.6 交付与访问

AuditResponsePackage 必须支持：

- recipient binding；
- signed URL 或受控下载；
- package expiry；
- per-recipient access；
- download / preview / revoke audit；
- watermark 或 usage notice，如适用；
- revocation on incident / contract termination / legal instruction。

## 10.7 无法满足请求

拒绝或部分满足请求时，返回：

- 请求范围；
- 可提供的替代材料；
- 拒绝理由类别；
- 是否需要更精确的 scope；
- 是否需要 NDA / Legal process；
- 是否会影响 contract SLA；
- escalation contact。

不得用模糊的“系统不支持”掩盖 privacy、security、legal 或 scope 原因。

---

# 11. External Assurance / Attestation

## 11.1 Assurance 类型

```text
Internal control owner assertion
Independent internal audit
External assessor report
Provider assurance / certificate
Regulatory approval / filing
Customer-specific attestation
```

不同 issuer 的证据强度、scope、period 和 limitation 不同，不能只按“有证书 / 没证书”二元判断。

## 11.2 ExternalAssuranceReport 验证

收到外部报告后必须验证：

- issuer authenticity；
- engagement scope；
- covered system / market / provider；
- period；
- opinion；
- exceptions；
- carve-out / subservice organization；
- expiry / superseded status；
- control mapping；
- permitted audience。

报告不覆盖的系统或 period 必须标注为 limitation。

## 11.3 Attestation 语言

推荐结构：

```text
Based on [procedure / framework]
for [scope]
during [period]
we assessed [controls / assertion]
with [limitations / exceptions]
and the result is [decision].
```

中文对外材料也必须保留同等限定：范围、时间、方法、结论和例外。

## 11.4 Attestation 撤回

Attestation 必须在以下情况被 review 或撤回：

- 发现重大事实错误；
- underlying review 被 reopen；
- P0 incident 影响 assertion；
- external report 被撤回、纠正或 opinion 改变；
- scope 或 system materially changed；
- evidence authenticity 受到质疑。

撤回事件必须有原因、effective time、受影响 artifact 和 recipient notification 记录。

---

# 12. Domain-specific Evidence Matrix

## 12.1 Account Security / Privacy

必须能够证明：

- authentication 与 step-up path 存在；
- privileged access 有 owner、scope、review 和 revoke；
- consent purpose、withdrawal 与 retention 正确；
- export、deletion、redaction 有 request 和 result；
- raw KYC / secret 不进入 Trust Center 或普通 audit package；
- Security Incident 与 access anomaly 可关联。

不能从这些 evidence 推断：

- 某个用户完成了 KYC；
- 某个 Business 有权访问全部 Enterprise 数据；
- 某个用户不会发生 takeover；
- 删除请求可以删除不可变财务或审计事实。

## 12.2 Provider / Market

必须能够证明：

- ProviderConnection 的 capability、environment、market 绑定；
- provider secret rotation 与 callback verification；
- KYC / Payment / Media / Notification provider 的 failure / retry / reconciliation；
- MarketLaunchProfile 的 Legal / Tax / KYC / Privacy approval；
- approval、certificate、DPA、subprocessor 信息未过期；
- provider suspend / failover / incident path 已演练或有明确 limitation。

Provider assurance 不会自动替代 Proxy 的 adapter、routing、data minimization、reconciliation 或 incident control。

## 12.3 Enterprise / Contract

必须能够证明：

- EnterpriseContract 版本、effective time、scope、SLA obligation；
- EnterpriseMembership 与 role mapping；
- SSO / SCIM 的 domain verification、deactivate 和 SoD；
- Enterprise export / audit request 的审批与下载记录；
- SLA metric 的定义、period、measurement source；
- PurchaseOrder、Invoice、Payment term 与 Ledger 的边界；
- renewal、expansion、contraction、exit 的 decision trail。

合同、采购单或高等级 SLA 不能替代 KYC、Safety、Privacy 或 Funding Gate。

## 12.4 Migration / Adoption / Renewal

必须能够证明：

- source authority、mapping version、unknown value quarantine；
- identity match evidence、conflict handling；
- migration batch、checksum、cutover decision；
- dual-run authority 与 no-dual-write boundary；
- training、role adoption、support health；
- health scorecard 的维度与 evidence；
- renewal decision 的 contract、SLA、money、security、provider、market evidence。

Migration success、登录人数、客户满意度或 renewal 本身都不能单独作为 compliance proof。

## 12.5 Money / Safety / KYC

Compliance package 可以引用：

- reconciliation result；
- incident timeline；
- KYC decision / expiry / provider reference；
- control test result；
- redacted sample。

Compliance package 不能替代：

- Ledger posting；
- Payment authorization；
- Payout eligibility；
- Safety case resolution；
- KYC verification attempt；
- Market legal approval。

---

# 13. Access / Permission / Segregation of Duties

## 13.1 角色

| 角色 | 可做 | 不可做 |
|---|---|---|
| ComplianceProgramOwner | 创建 Program、scope、cadence | 单独批准自己的 P0 exception |
| ControlOwner | 提供实施与 evidence | 单独给自己的 control 出最终独立结论 |
| ControlTester | 测试、记录 assessment | 修改原始 evidence 或批准自己制造的 exception |
| PrivacyReviewer | 检查 data category、redaction、purpose | 扩大业务权限 |
| SecurityReviewer | 检查 access、secret、incident、residual risk | 修改 Ledger / KYC / Safety 状态 |
| LegalReviewer | 检查 basis、claim、contract、regulatory scope | 代替 Domain owner 伪造业务事实 |
| TrustCenterPublisher | 发布已批准 Artifact | 绕过 scope、expiry 或 redaction gate |
| EnterpriseViewer | 查看绑定 Enterprise 的材料 | 查看其他 Enterprise 或 raw restricted data |
| ExternalAssessor | 在授权 scope 内 review | 更改 Proxy 状态或导出 scope 外数据 |
| Auditor | 查看 audit trail、package、approval | 删除或覆盖历史记录 |

## 13.2 高敏感材料访问

以下操作需要 step-up、purpose、scope 和 Audit：

- 查看 Restricted Evidence；
- 生成 AuditResponsePackage；
- 查看 Incident-linked package；
- 查看 provider security / legal artifact；
- 发布或撤回 TrustCenterArtifact；
- 批准 P1 exception；
- 修改 P0 control definition；
- 批量下载 customer-specific package。

## 13.3 SoD 规则

以下组合默认禁止由同一人独立完成：

- ControlOwner + 独立 Tester；
- Finding owner + 最终关闭 verifier；
- Exception requester + 唯一 approver；
- Trust artifact author + 唯一 publisher；
- Audit package collector + 唯一 redaction approver；
- Provider onboarding owner + 唯一 security approver；
- Contract negotiator + 唯一 compliance attestor。

紧急情况下可以 break-glass，但必须记录 incident、reason、time window、actions 和 retrospective review。

---

# 14. Continuous Monitoring / Drift / Incident Linkage

## 14.1 Signal 来源

ComplianceSignal 可以来自：

- Evidence expiry；
- ControlDefinition version change；
- production config drift；
- privileged access review failure；
- secret rotation failure；
- ProviderConnection / ProviderCapability 变化；
- MarketLaunchProfile approval expiry；
- new subprocessor or DPA change；
- Security / Privacy / Safety / Money incident；
- migration reconciliation mismatch；
- overdue remediation；
- Trust artifact claim mismatch；
- Contract / SLA / renewal scope change。

## 14.2 Drift 处理

检测到 drift 后：

1. 记录 source、time、asset、expected、observed；
2. 评估是否影响当前 Review / Attestation / Trust Artifact；
3. 创建 finding 或 change review；
4. 需要时暂停外部声明；
5. 由 Domain owner 决定是否修复、回滚、切换或暂停；
6. 完成 retest 与 artifact review。

Compliance worker 不得直接覆盖生产配置或 Domain 状态。

## 14.3 Incident Linkage

Security、Privacy、Safety、Provider 或 Money incident 必须能够关联：

```text
incident_ref
→ affected scope
→ affected controls
→ evidence preserved
→ current trust artifacts
→ audit requests / recipients
→ findings / remediation
→ notification decision
```

Incident 关闭不等于 ComplianceReview 自动通过。需要独立评估影响、根因和 evidence 是否仍然有效。

## 14.4 Public Incident Notice

是否在 Trust Center 发布 Incident Notice，必须考虑：

- 法律和监管义务；
- 用户 / Enterprise 合同义务；
- 安全披露风险；
- 是否会暴露个人、凭据、攻击路径；
- 当前 investigation 阶段；
- 影响范围和事实确定性。

不确定信息必须明确标记为 preliminary / under investigation，不得写成最终结论。

---

# 15. Change / Version / Renewal Integration

## 15.1 触发 Compliance Change Review

以下变化必须评估是否创建 `CHANGE` Review：

- 新 Market、Legal Entity、Provider 或 subprocessor；
- 新 data category、residency、retention 或 processing purpose；
- SSO / SCIM / API scope、role mapping 或 export 变化；
- Payment / KYC / Media / Notification adapter 变化；
- EnterpriseContract、DPA、SLA、pricing 或 renewal scope 变化；
- Migration cutover、dual-run authority 或 historical mapping 变化；
- P0/P1 incident 或外部 assurance opinion 变化；
- Trust Center claim、artifact audience 或公开范围变化。

## 15.2 Version Binding

下列对象必须绑定版本：

- ComplianceFramework；
- ControlDefinition；
- PolicySet；
- MarketLaunchProfile；
- EnterpriseContract；
- DPA / Privacy Notice；
- TrustCenterArtifact；
- AuditResponsePackage；
- ExternalAssuranceReport mapping。

不允许只更新一个 URL 或覆盖一个文件，就让历史 review 看起来像使用了新版本。

## 15.3 Renewal Evidence

Chapter 33 的 `ContractRenewalReview` 可以引用本章：

- 当前 ComplianceReview decision；
- 未关闭 P0/P1 finding；
- exception 数量、到期和 disclosure；
- assurance report 与 Trust artifact freshness；
- audit response SLA；
- incident / notification history；
- provider / market approval；
- data processing / DPA 变化。

但 RenewalReview 不能自动批准新的 control scope。Scope expansion 必须经过新的 ComplianceScope、ControlImplementation 和 review。

## 15.4 Exit / Retention

Enterprise Exit 或 Contract terminate 后：

- revoke Enterprise access、Trust Room、API、SSO / SCIM scope；
- 关闭未完成的 AuditRequest 或转移 owner；
- 保留需要的 review、evidence、contract、invoice、incident 和 audit facts；
- 处理 retention、LegalHold、deletion、export obligation；
- 撤回只对该 Enterprise 有效的 Trust Artifact access；
- 不删除系统级公共 assurance 的历史版本；
- 记录 closeout、final access review 和 data disposition。

---

# 16. API / Command / Event Contract

## 16.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `CreateComplianceProgram` | ComplianceProgramOwner | 创建 Program 与初始 scope |
| `ApproveComplianceScope` | Program / Legal / Security owner | 锁定 scope、period、framework |
| `CollectComplianceEvidence` | Collector / System | 创建 EvidenceCollection 与 evidence |
| `EvaluateControl` | ControlTester | 创建 ControlAssessment |
| `OpenComplianceFinding` | Tester / Compliance | 创建 Finding 与 severity |
| `RequestComplianceException` | Risk owner | 创建待审批 exception |
| `ApproveComplianceException` | Authorized approver | 激活有限期 exception |
| `CreateRemediationPlan` | Finding owner | 创建修复计划 |
| `VerifyRemediation` | Independent verifier | 关闭或 reopen finding |
| `CreateAuditRequest` | Authorized requester | 建立审计请求 |
| `GenerateAuditResponsePackage` | Compliance / Privacy | 生成受控 package |
| `PublishTrustArtifact` | TrustCenterPublisher | 发布已批准 artifact |
| `RetireTrustArtifact` | TrustCenterPublisher / Legal | 撤回并保留历史版本 |
| `RecordComplianceAttestation` | Authorized issuer | 记录限定性 assertion |
| `AcknowledgeComplianceSignal` | Owner | triage signal 并关联 action |

每个 command 必须具备：

- principal context；
- scope；
- idempotency key；
- reason / purpose；
- authorization；
- expected version；
- audit event；
- failure code；
- 不改变其他 Domain 状态的边界。

## 16.2 P0 Events

```text
ComplianceProgramCreated
ComplianceScopeApproved
EvidenceCollected
EvidenceValidated
EvidenceExpired
ControlAssessed
ComplianceFindingOpened
ComplianceExceptionApproved
ComplianceExceptionExpired
RemediationOverdue
RemediationVerified
ComplianceReviewDecisionRecorded
ComplianceReviewExpired
ComplianceAttestationIssued
ComplianceAttestationWithdrawn
AuditRequestApproved
AuditResponsePackageReady
AuditResponsePackageShared
TrustArtifactPublished
TrustArtifactExpired
TrustArtifactRetired
ComplianceSignalDetected
```

Event payload 只包含必要 metadata、references、scope 和 summary，不默认包含 raw KYC、secret、private key 或完整 incident payload。

## 16.3 Downstream Boundary

Compliance events 可以通知：

- RenewalReview；
- Provider / Market readiness；
- Support / Customer Success；
- Trust Center；
- Security / Privacy incident workflow；
- Change management。

Compliance events 不能未经 owned command 直接：

- cancel Order；
- release / seize Funding；
- post Ledger；
- verify KYC；
- resolve Safety case；
- change Enterprise owner；
- grant API scope。

---

# 17. Governance Cadence

## 17.1 Daily

- P0/P1 finding、incident、exception expiry；
- privileged access anomaly；
- evidence / certificate / market approval expiry；
- Trust artifact publish queue；
- audit package sharing / revocation；
- overdue remediation。

## 17.2 Weekly

- control coverage 与 evidence freshness；
- Provider / Market changes；
- open AuditRequest SLA；
- new customer due diligence；
- privacy / redaction backlog；
- drift signal triage；
- migration / renewal linked evidence。

## 17.3 Monthly

- ComplianceReview progress；
- findings root cause；
- exception register；
- Trust Center inventory；
- DPA / subprocessor / assurance changes；
- break-glass access retrospective；
- export access review。

## 17.4 Quarterly

- framework / control version review；
- control owner attestation；
- external assurance mapping；
- BCP / incident / restore drill；
- Enterprise renewal evidence；
- public claim and artifact re-approval；
- board / executive risk summary。

## 17.5 Event-driven

以下事件立即触发 targeted review：

- P0 Security / Privacy / Safety / Money incident；
- Provider compromise or major outage；
- Market law / KYC / Tax requirement change；
- new data purpose or residency；
- Contract / DPA material change；
- assurance report withdrawal；
- migration cutover discrepancy；
- Trust claim correction。

---

# 18. Acceptance Criteria

## AC-34-01 — Scope Required

每个 ComplianceReview、Evidence、Assessment、Finding、Exception、Attestation、Trust Artifact 和 AuditResponsePackage 都必须绑定明确的 ComplianceScope。

## AC-34-02 — Scope Tuple Complete

Scope 至少包含 organization、system、environment、market、provider、data category、framework version 和 period；缺失时不能进入 Attestation。

## AC-34-03 — Domain Fact Separation

Compliance outcome 不得直接改写 KYC、Safety、Payment、Payout、Ledger、Contract、Provider 或 Market 的 Domain state。

## AC-34-04 — Framework Version Immutable

Framework 或 ControlDefinition 变更必须创建新版本并保留旧版历史评估。

## AC-34-05 — Control Owner And Tester

每个 P0 control 必须有 owner、tester、test method、evidence source、frequency 和 failure path。

## AC-34-06 — Segregation Of Duties

Control owner、独立 tester、exception approver、trust publisher 和 package redaction approver 的冲突组合必须被阻止或记录 break-glass 审计。

## AC-34-07 — Evidence Metadata

Evidence 必须记录 source、scope、period、collector、integrity hash、classification、retention 和 limitation。

## AC-34-08 — Evidence Integrity

Evidence 更新不能覆盖旧版本；替换必须生成新 evidence，并保留 supersede chain。

## AC-34-09 — Sensitive Data Boundary

raw KYC、secret、token、private key、bank credential 和未授权个人数据不得进入普通 Evidence、Audit Package 或 Trust Center。

## AC-34-10 — Evidence Expiry

过期 evidence 可以作为历史事实保留，但不得支持当前 period 的无条件 PASS 或公开 claim。

## AC-34-11 — Collection Failure Visible

EvidenceCollection 的失败、缺失、重试、partial 结果和未知字段必须可追踪，不能静默变成 complete。

## AC-34-12 — Assessment Result Explicit

ControlAssessment 必须区分 PASS、PARTIAL、FAIL、NOT_APPLICABLE 和 NOT_TESTED；NOT_TESTED 不能自动汇总为 PASS。

## AC-34-13 — Review Gate

Review 进入 Attestation 前必须有 approved scope、locked framework、required assessments、limitations 和 finding decision。

## AC-34-14 — PASS_WITH_EXCEPTION Bounded

PASS_WITH_EXCEPTION 必须引用有效 exception、compensating control、owner、due date、disclosure decision 和 stop condition。

## AC-34-15 — P0 Exception Default Deny

法定、Safety、KYC、Privacy、凭据和 Ledger 核心控制的 P0 gap 默认不可通过普通 exception 继续运行。

## AC-34-16 — Finding Severity Stable

Finding severity 不能因为 Enterprise tier、续约压力或客户重要性被降低；降级必须有独立 risk review 和 Audit。

## AC-34-17 — Remediation Verification

Finding 关闭必须引用独立 retest 或 verification evidence；复发时状态必须变为 REOPENED。

## AC-34-18 — Remediation Overdue Escalation

到期 remediation 必须按 policy 触发 owner、manager、Compliance、Security、Privacy、Legal 或 Finance escalation。

## AC-34-19 — Exception Expiry

Exception 到期后自动变为 EXPIRED 或进入重新审批，不得静默延长。

## AC-34-20 — Trust Artifact Mapping

每个 TrustCenterArtifact 的 claim 必须映射至当前 scope、period、evidence、review 或 external assurance。

## AC-34-21 — Trust Publish Gate

Trust Artifact 发布前必须通过 owner、必要的 Security / Privacy / Legal review、redaction、expiry 和 version 检查。

## AC-34-22 — Trust Claim Limitations

公开材料必须展示适用范围、日期、限制和联系人，不得使用 zero-risk、universal compliance 或无条件保证语言。

## AC-34-23 — Artifact Expiry

Supporting evidence、review、assurance 或 market/provider approval 到期时，相关 Trust Artifact 必须进入 review、pause、expire 或 retire。

## AC-34-24 — Historical Artifact Retention

被撤回或过期的 Trust Artifact 不能被物理覆盖；必须保留发布时间、版本、访问记录和撤回原因。

## AC-34-25 — Audit Request Triage

AuditRequest 必须验证 requester、purpose、scope、period、legal basis / NDA、requested data category 和最小披露替代方案。

## AC-34-26 — Audit Package Manifest

AuditResponsePackage 必须包含 scope statement、period、control mapping、evidence manifest、limitations、redaction log、hash、expiry 和 recipient policy。

## AC-34-27 — Redaction Decision

Redaction 必须可审计；如果被隐藏的信息影响结论，package 必须降级为 limited 或 incomplete，不得伪装为完整 assurance。

## AC-34-28 — Controlled Delivery

Audit package 必须绑定 recipient，支持受控下载、expiry、revoke、preview / download audit。

## AC-34-29 — External Assurance Verification

外部报告必须验证 issuer、scope、period、opinion、limitation、mapping、authenticity 和 expiry。

## AC-34-30 — Attestation Language

Attestation 必须明确 procedure、scope、period、result、limitation 和 exception，不得被 UI 缩写为无边界认证。

## AC-34-31 — Attestation Withdrawal

底层事实重大改变、report 被撤回、incident 影响结论或发现错误时，Attestation 必须支持撤回、通知和历史审计。

## AC-34-32 — Continuous Signal

Evidence expiry、control drift、provider / market change、incident、overdue remediation 和 claim mismatch 必须可生成 ComplianceSignal。

## AC-34-33 — Incident Linkage

Security、Privacy、Safety、Provider 和 Money incident 必须能关联 affected scope、control、preserved evidence、Trust Artifact、recipient 和 remediation。

## AC-34-34 — Export Boundary

Compliance API、Enterprise Export、Audit Package 和 Trust Room 必须沿用 Chapter 24 / 32 的 least privilege、step-up、approval、redaction 和 audit boundary。

## AC-34-35 — Renewal / Exit Integration

Contract renewal、scope expansion、contraction 和 exit 必须引用 ComplianceReview、finding、exception、artifact freshness 和 data disposition 结果。

## AC-34-36 — No Fabricated Assurance

系统不得因存在 certificate、questionnaire、SLA、Trust Center 页面、登录成功或 Enterprise 续约而自动生成“全部合规”“KYC 已完成”“资金安全”或“交易保证”等事实。

---

# 19. P0 / P1 Boundary

## 19.1 P0

- ComplianceScope、Framework、Control、Evidence、Assessment、Finding、Exception、Remediation、Attestation、TrustArtifact、AuditRequest 的 canonical schema；
- scope / period / version / owner / tester / audit_ref；
- raw sensitive data boundary；
- P0/P1 severity、exception、remediation 和 escalation；
- Trust Center publish / expire / retire；
- AuditRequest、redaction、package、controlled delivery；
- ExternalAssurance mapping；
- Provider / Market / Enterprise / Privacy / Security / Money / Safety 的 evidence matrix；
- incident、drift、expiry 的 ComplianceSignal；
- Chapter 24 / 27 / 31 / 32 / 33 的 cross-domain invariants。

## 19.2 P1

- automated evidence sampling optimization；
- continuous control monitoring with predictive scoring；
- customer self-service trust questionnaire mapping；
- differential privacy aggregate benchmark；
- multilingual Trust Center content；
- evidence graph visualization；
- automated external report ingestion；
- policy-as-code authoring UI；
- vendor risk scoring；
- automated package comparison；
- machine-generated remediation suggestions。

P1 自动化不能改变 P0 的 scope、permission、redaction、SoD、exception、Domain fact 和 audit boundary。

---

# 20. Locked Conclusions / Next Work

本章锁定：

```text
Compliance 是有 scope、有 period、有 evidence 的判断
Control definition 与 assessment result 分离
Evidence 记录来源、完整性、限制、保留和访问
Finding、Exception、Remediation 有独立生命周期
Exception 不能绕过 KYC、Safety、Privacy、Money 或 Ledger
Trust Center 是受控展示层，不是原始审计仓库
Audit package 必须最小披露、可撤回、可审计
External assurance 必须验证 issuer、scope、period 和 limitation
Incident、drift、expiry 会触发 targeted review
Renewal / Expansion / Exit 只能引用 compliance evidence，不能自动扩大 scope
```

下一步进入：

```text
Chapter 35 — Multi-Market Legal Entity / Tax / Currency / Settlement Governance
```

Chapter 35 将把 Market、Legal Entity、Tax、Currency、Payment Rail、Settlement、Invoice、Payout、Ledger 与 Enterprise Contract 的跨市场边界收口，明确不同法域下的交易、税务、结算、退款、对账与退出事实。

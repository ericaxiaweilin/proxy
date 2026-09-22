# Proxy PRD v1.1

## Chapter 39 — Policy-as-Code / Runtime Decision / Explainability Governance

**文档类型**：Policy-as-Code / Rule Evaluation / Decision Trace / Explainability / Simulation / Replay / Runtime Guardrail / Human Override  
**状态**：ACTIVE — Runtime Policy / Decision Assurance Readiness  
**依赖**：Chapter 23 Policy Defaults / Configuration Registry、Chapter 25 E2E Acceptance / Test Matrix / Invariant Gate、Chapter 26 Engineering API / Event / Schema Contract、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 37 Financial Controls / Internal Audit / Risk Appetite / Board Governance、Chapter 38 Regulatory Change / Policy Migration / Market Re-Approval Governance  
**后续**：Chapter 40 Decision Data / Model Risk / AI Governance

---

# 0. 本章目标

Chapter 23 定义了 Policy 概念和首发默认值，Chapter 38 定义了 Policy version、effective binding、migration 和 re-approval。本章继续回答一个更接近运行时的问题：

> 当系统在某个时刻面对一个具体请求、候选、Order、Payment、Payout、KYC、Safety 或数据访问动作时，究竟使用了哪些规则、输入、版本和 guardrail，为什么得到这个 decision，下一步是否需要 Domain command？

本章定义：

- Policy-as-Code package、Rule、Expression、Input schema 和 dependency；
- Evaluation Context、Policy Evaluation Run、Decision Trace 和 Explanation；
- Simulation、Replay、Golden test、Regression、Property test 和 release gate；
- Runtime Guardrail、fail-safe、cache、timeout、unknown、conflict 和 degraded behavior；
- Human Override、Manual Review、RiskDecision、Safety hold 和 Domain command 的边界；
- 决策结果如何被 API、Event、Audit、Read Model、Support、Compliance 和 Board 使用；
- 如何保证自动化决策可重现、可解释、可审计、可撤回而不泄漏 D4 / D5、raw KYC、secret 或内部风控细节。

本章不做：

- 不把 Policy Evaluation 变成 Order、Payment、Ledger、KYC、Safety 或 Contract 的第二套状态机；
- 不让 Rule Evaluation 直接写 Ledger、创建 Payment、释放 Payout、标记 KYC VERIFIED 或关闭 Incident；
- 不把一个 risk score、model score 或 explainability text 当作最终 Domain fact；
- 不用模拟、回放、缓存、shadow decision 或 human override 伪造真实业务操作；
- 不允许 feature flag、A/B test、Enterprise tier 或 Provider preference 覆盖 Canonical Invariant；
- 不为了“解释方便”输出 raw KYC、秘密规则、精确 Risk threshold、他人隐私或攻击路径。

## 0.1 本章核心结论

```text
Policy evaluation = deterministic decision computation
Decision result ≠ Domain state mutation
Explanation = scoped reason, not raw rule dump
Simulation / replay = no-side-effect analysis
Guardrail = invariant enforcement, not a suggestion
Human override = bounded review, not a bypass
Cache = optimization, not source of truth
Unknown = unknown, not allow
Policy release = tested version + effective binding + rollback
```

## 0.2 Decision Layers

```text
Canonical Invariant / Legal Hard Stop
→ Market / Legal Entity Binding
→ PolicySetVersion / PolicyDefinition
→ Policy-as-Code Rule Evaluation
→ Runtime Risk / Safety / KYC / Permission Decision
→ Guardrail Evaluation
→ Decision Result / Explanation
→ Domain Command, if authorized
→ Domain State / Event / Audit
```

Policy engine可以建议、拒绝或要求 review；实际状态变化必须由 owned Domain command 完成。

---

# 1. Policy-as-Code Constitution

## 1.1 Rules Are Versioned Artifacts

每个可执行 Rule 必须绑定：

- PolicyDefinition；
- PolicySetVersion；
- code package / source hash；
- schema version；
- effective binding；
- owner；
- reviewer / approver；
- test suite；
- dependency versions；
- rollback target。

不能把一个未版本化的 SQL、脚本、feature flag、Provider console setting 或 prompt 当作 production policy。

## 1.2 Evaluation Must Be Pure by Default

Policy evaluation 默认必须：

- 读取显式输入；
- 不写业务数据库；
- 不发起不可逆 Provider operation；
- 不发送用户通知；
- 不创建 Payment、Payout、Invoice、Ledger、KYC 或 Safety fact；
- 不调用有副作用的 external command；
- 输出 decision、trace、explanation 和 next action。

需要副作用时，必须通过 Domain command / workflow，并再次执行 authorization、version、idempotency 和 state check。

## 1.3 Input Is Not Fact Mutation

Evaluation 可以读取：

- Domain snapshot；
- PolicySnapshot；
- RiskDecision / RiskHold；
- KYC level / expiry；
- Permission / Consent；
- Market / Provider / Entity profile；
- Payment / Ledger / Settlement summary；
- time / location capability result；
- experiment assignment。

Evaluation 不得因为输入缺失而自动写入一个“默认安全”“默认通过”或“默认已验证”的事实。

## 1.4 Explicit Unknown

每个 rule output 必须能表达：

```text
ALLOW
DENY
PENDING
REVIEW_REQUIRED
NOT_APPLICABLE
UNKNOWN
ERROR
```

在 KYC、Safety、Privacy、Payment、Payout、Ledger、Tax 或高风险 action 中，`UNKNOWN` 默认不能映射为 `ALLOW`。

## 1.5 Rule Ordering Is Explicit

规则必须有明确的：

- precedence；
- conflict resolution；
- short-circuit behavior；
- hard-stop behavior；
- fallback；
- timeout；
- version；
- explanation priority。

不能依赖文件顺序、数据库返回顺序、hash iteration 或 Provider response 顺序决定结果。

## 1.6 No Hidden Side Door

以下路径必须经过同一 guardrail：

- User API；
- Enterprise API；
- Operator Console；
- Admin tool；
- Batch worker；
- Provider callback；
- Scheduled job；
- Migration worker；
- Replay / retry worker；
- Internal service-to-service command。

高权限 principal 可以改变 scope，但不能绕过 Canonical Invariant、SoD、Audit、KYC、Safety、Privacy 或 Money gate。

## 1.7 Explainability Is Purpose-bound

解释信息按 audience 分层：

| Audience | 可见内容 | 不可见内容 |
|---|---|---|
| End User | action、high-level reason、next step、appeal path | raw risk score、内部 threshold、他人数据 |
| Enterprise Admin | scope、policy version、contract-relevant reason、support path | 员工 raw KYC、内部 detection rule |
| Operator | safe reason、case routing、required action | 不必要的 D5、模型 secrets、攻击细节 |
| Compliance / Auditor | scope、version、trace、evidence、limitation | 未授权 raw personal data |
| Engineering | rule id、schema、error、latency、dependency | production secret、未授权客户内容 |
| Internal Audit / Board | aggregate、material reason、trend、limitation | raw case payload unless authorized |

---

# 2. Policy-as-Code Domain Objects

## 2.1 PolicyCodePackage

```text
PolicyCodePackage
├── id
├── policy_definition_ref
├── policy_set_version_ref
├── language_or_runtime
├── source_ref
├── source_hash
├── compiled_artifact_ref
├── schema_version
├── dependency_refs[]
├── prohibited_capabilities[]
├── test_suite_refs[]
├── owner_ref
├── reviewer_refs[]
├── build_ref
├── effective_from
├── effective_to?
├── status: DRAFT / BUILT / TESTED / APPROVED / RELEASED / RETIRED / REVOKED
└── audit_ref
```

Prohibited capabilities 至少包括直接写 Ledger、读取 raw KYC、发起 Payment、发送外部通知、访问 secret 或绕过 authorization。

## 2.2 PolicyRule

```text
PolicyRule
├── id
├── code_package_ref
├── rule_code
├── title
├── objective
├── input_schema_ref
├── expression_ref
├── rule_type: HARD_STOP / ELIGIBILITY / PRICING / RANKING / ROUTING / RETENTION / NOTIFICATION / REVIEW
├── priority
├── output_schema_ref
├── dependencies[]
├── conflict_behavior
├── unknown_behavior
├── explanation_template_ref
├── test_case_refs[]
├── status: DRAFT / ACTIVE / RETIRED
└── audit_ref
```

## 2.3 PolicyExpression

```text
PolicyExpression
├── id
├── expression_language
├── normalized_expression
├── source_hash
├── allowed_functions[]
├── prohibited_functions[]
├── null_behavior
├── type_rules
├── unit_rules
├── time_rules
├── side_effect_check
├── version
└── audit_ref
```

Expression 必须支持显式 null / unknown、单位和时间语义，不能把空值、0、false、未加载和权限拒绝混成同一结果。

## 2.4 PolicyInputSchema

```text
PolicyInputSchema
├── id
├── policy_definition_ref
├── fields[]
├── required_fields[]
├── optional_fields[]
├── classification_by_field[]
├── freshness_by_field[]
├── source_requirements[]
├── normalization_rules[]
├── validation_rules[]
├── version
└── status: DRAFT / ACTIVE / RETIRED
```

## 2.5 PolicyOutputSchema

```text
PolicyOutputSchema
├── id
├── policy_definition_ref
├── decision_enum
├── reason_code_enum
├── required_fields[]
├── uncertainty_fields[]
├── next_action_enum
├── command_proposal_types[]
├── audience_visibility[]
├── version
└── status: DRAFT / ACTIVE / RETIRED
```

## 2.6 PolicyEvaluationContext

```text
PolicyEvaluationContext
├── id
├── principal_context_ref
├── domain_object_refs[]
├── market_ref
├── legal_entity_ref?
├── provider_refs[]
├── policy_binding_ref
├── policy_snapshot_refs[]
├── risk_decision_refs[]
├── consent_refs[]
├── kyc_summary_ref?
├── time_context
├── location_capability_ref?
├── input_snapshot_hash
├── data_freshness_summary
├── purpose
├── classification
└── audit_ref
```

PolicyEvaluationContext 只携带满足目的所需的最小输入。D4 / D5 仍需 purpose、scope、TTL、permission 和 Audit。

## 2.7 PolicyEvaluationRun

```text
PolicyEvaluationRun
├── id
├── context_ref
├── rule_refs[]
├── code_package_refs[]
├── input_snapshot_hash
├── started_at
├── completed_at
├── latency_ms
├── dependency_results[]
├── output_ref
├── trace_ref
├── status: RUNNING / COMPLETE / DENIED / PENDING / REVIEW_REQUIRED / UNKNOWN / ERROR / TIMEOUT
├── side_effects: NONE / PROPOSAL_ONLY / BLOCKED
└── audit_ref
```

## 2.8 PolicyDecision

```text
PolicyDecision
├── id
├── evaluation_run_ref
├── decision: ALLOW / DENY / PENDING / REVIEW_REQUIRED / NOT_APPLICABLE / UNKNOWN / ERROR
├── reason_codes[]
├── priority_reason_code
├── next_action
├── command_proposal_refs[]
├── guardrail_result_refs[]
├── explanation_ref
├── expires_at?
├── valid_for_scope
├── status: PROPOSED / RETURNED / APPLIED_TO_COMMAND / EXPIRED / SUPERSEDED
└── audit_ref
```

PolicyDecision 不是 Order、Payment、KYC、Safety 或 Contract state。它必须在 Domain command 执行前重新校验 freshness 和 aggregate version。

## 2.9 DecisionTrace

```text
DecisionTrace
├── id
├── evaluation_run_ref
├── ordered_rule_steps[]
├── input_reference_summary[]
├── normalized_values[]
├── rule_results[]
├── short_circuit_step?
├── conflict_resolution?
├── unknown_resolution?
├── guardrail_steps[]
├── dependency_latency[]
├── trace_hash
├── trace_retention_ref
└── audit_ref
```

Trace 默认不保存 raw KYC、secret、完整聊天、精确位置或未授权个人内容，只保存必要的 reference、category、decision 和 hash。

## 2.10 DecisionExplanation

```text
DecisionExplanation
├── id
├── decision_ref
├── audience
├── summary
├── reason_codes[]
├── required_action
├── appeal_or_review_path?
├── policy_version
├── scope_statement
├── limitation_refs[]
├── redaction_status
├── generated_at
├── expires_at?
└── audit_ref
```

## 2.11 GuardrailEvaluation

```text
GuardrailEvaluation
├── id
├── evaluation_run_ref
├── guardrail_type: INVARIANT / LEGAL / SAFETY / PRIVACY / SECURITY / MONEY / RATE_LIMIT / CAPACITY / VERSION
├── guardrail_ref
├── input_refs[]
├── result: PASS / BLOCK / REVIEW / UNKNOWN / ERROR
├── blocking
├── reason_code
├── evaluated_at
├── expiry_at?
└── audit_ref
```

Guardrail `BLOCK` 不能被低优先级 rule、human override、Enterprise tier 或 Provider response 覆盖，除非对应 Domain / Legal authority 明确规定另一路径。

## 2.12 CommandProposal

```text
CommandProposal
├── id
├── decision_ref
├── command_type
├── target_aggregate_ref
├── expected_version
├── required_permissions[]
├── required_approvals[]
├── idempotency_key
├── expiry_at
├── proposal_reason
├── status: PROPOSED / AUTHORIZED / REJECTED / EXECUTED / EXPIRED / SUPERSEDED
└── audit_ref
```

CommandProposal 只描述下一步建议。只有拥有 Domain authority 的 command handler 可以执行 mutation。

## 2.13 PolicySimulation

```text
PolicySimulation
├── id
├── scenario_name
├── scope_ref
├── current_policy_refs[]
├── candidate_policy_refs[]
├── fixture_refs[]
├── historical_snapshot_refs[]
├── assumptions[]
├── metrics[]
├── divergence_summary
├── safety / money / privacy impact
├── started_at
├── completed_at?
├── status: DRAFT / RUNNING / COMPLETE / PARTIAL / FAILED / REJECTED
├── side_effects: NONE
└── audit_ref
```

## 2.14 PolicyReplay

```text
PolicyReplay
├── id
├── source_event_refs[]
├── source_snapshot_refs[]
├── original_policy_snapshot_refs[]
├── candidate_policy_refs[]
├── event_time_policy
├── replay_mode: DECISION_ONLY / READ_MODEL_ONLY / COMMAND_DRY_RUN
├── output_refs[]
├── divergence_refs[]
├── status: PLANNED / RUNNING / COMPLETE / FAILED / REJECTED
└── audit_ref
```

Replay 默认没有外部副作用，不能重新发 Payment、Payout、Notification、KYC operation 或 Ledger posting。

## 2.15 PolicyTestCase

```text
PolicyTestCase
├── id
├── policy_ref
├── case_type: EXAMPLE / NEGATIVE / BOUNDARY / PROPERTY / REGRESSION / INVARIANT / SECURITY / PRIVACY
├── fixture_ref
├── input_override
├── expected_decision
├── expected_reason_codes[]
├── expected_guardrails[]
├── expected_command_proposals[]
├── forbidden_side_effects[]
├── severity_if_failed
├── owner_ref
└── status: DRAFT / ACTIVE / RETIRED
```

## 2.16 PolicyTestRun

```text
PolicyTestRun
├── id
├── code_package_ref
├── policy_set_version_ref
├── test_case_refs[]
├── environment
├── fixture_version
├── started_at
├── completed_at
├── passed_count
├── failed_count
├── skipped_count
├── invariant_failures[]
├── coverage_summary
├── output_hash
├── status: RUNNING / PASS / FAIL / INCOMPLETE
└── audit_ref
```

## 2.17 HumanOverrideRequest

```text
HumanOverrideRequest
├── id
├── decision_ref
├── requested_by
├── target_scope
├── reason
├── evidence_refs[]
├── override_type: REVIEW / TEMPORARY_ALLOW / TEMPORARY_DENY / RECLASSIFY / REQUEUE
├── prohibited_guardrails[]
├── max_duration
├── required_approver_role
├── resulting_command_type?
├── status: REQUESTED / REVIEW / APPROVED / REJECTED / EXPIRED / REVOKED / EXECUTED
└── audit_ref
```

## 2.18 DecisionReview

```text
DecisionReview
├── id
├── decision_ref
├── review_type: HUMAN / SAFETY / KYC / PAYMENT / PRIVACY / OPERATOR / APPEAL
├── reviewer_ref
├── scope_ref
├── evidence_refs[]
├── findings[]
├── decision: CONFIRM / CHANGE / ESCALATE / HOLD / REJECT
├── explanation_ref
├── reviewed_at
├── expires_at?
└── audit_ref
```

## 2.19 RuntimeDecisionCacheEntry

```text
RuntimeDecisionCacheEntry
├── id
├── decision_ref
├── context_key_hash
├── policy_binding_ref
├── source_version_refs[]
├── created_at
├── expires_at
├── invalidation_events[]
├── stale_behavior
├── status: ACTIVE / STALE / INVALIDATED / EVICTED
└── audit_ref
```

Cache 只能加速相同 context 和有效期内的 decision，不能成为 Canonical source。

## 2.20 DecisionObservation

```text
DecisionObservation
├── id
├── decision_ref
├── command_result_ref?
├── observed_domain_result
├── expected_result
├── divergence_type: NONE / STALE_READ / POLICY_DRIFT / COMMAND_REJECT / PROVIDER_CHANGE / DATA_QUALITY / UNKNOWN
├── impact
├── linked_risk_event_ref?
├── linked_finding_ref?
├── detected_at
└── audit_ref
```

---

# 3. Input / Output / Dependency Contract

## 3.1 Input Categories

PolicyInputSchema 中的字段必须标记：

```text
identity_summary
account_status
kyc_level / expiry
risk_decision / hold
permission / role / scope
consent / purpose
domain_state
aggregate_version
market / entity / provider
money summary
location capability summary
time / timezone
capacity / quota
policy snapshot
```

不允许 rule 直接依赖 UI label、未经验证的 display name、raw Provider enum、未签名 webhook 或过期 read model。

## 3.2 Freshness Requirements

每个 input 必须有：

- source；
- observed_at；
- effective_at；
- freshness TTL；
- stale behavior；
- authority level；
- redaction / classification。

例如：

| Input | 默认要求 | stale 行为 |
|---|---|---|
| Safety hold | strong / immediate | deny 或 review |
| KYC expiry | current | pending / review |
| Payment status | strong source | reconcile / deny irreversible action |
| Ledger balance | strong source | 不允许以 read model 代替 |
| Capacity metric | bounded freshness | throttle / wait / degraded |
| Ranking feature | eventual | 可降级，但不覆盖 hard eligibility |
| User preference | current consent | deny purpose-bound action |

## 3.3 Normalization

Normalization 必须处理：

- enum version；
- timezone；
- currency / unit；
- null / missing；
- source confidence；
- provider mapping；
- locale / language；
- duplicate / stale record；
- identity reference。

Normalization 不能把 Provider `approved`、空 response、timeout 或未知 enum 映射为 Proxy `VERIFIED`、`SUCCESS` 或 `ALLOW`。

## 3.4 Dependency Graph

每个 PolicyRule 必须声明 dependencies：

- rule / policy ref；
- source service；
- version；
- timeout；
- retry behavior；
- fallback；
- criticality；
- side-effect risk。

循环依赖、隐式服务调用和未声明 Provider dependency 不允许进入 release。

## 3.5 Output Reason Codes

Reason code 必须：

- 稳定、可本地化；
- 不泄漏敏感规则；
- 能映射 support / operator path；
- 能关联 PolicyRule / Guardrail；
- 区分 deny、pending、review、unknown、error；
- 允许 future-compatible extension。

不得把 raw exception、SQL、Provider secret、完整 risk score 或内部 detector name 返回给普通用户。

## 3.6 Command Proposal Boundary

Policy engine 只能生成 allowlisted CommandProposal：

- command type；
- target aggregate；
- expected version；
- permission requirement；
- idempotency；
- expiry；
- reason；
- required approvals。

不能返回任意 SQL、任意 URL、任意 Provider method 或任意 JSON patch。

---

# 4. Evaluation Pipeline

## 4.1 Standard Pipeline

```text
Resolve Effective Binding
→ Validate Input Schema
→ Build Evaluation Context
→ Resolve Policy Snapshot
→ Evaluate Hard Guardrails
→ Evaluate Dependencies
→ Evaluate Policy Rules
→ Resolve Conflicts / Unknowns
→ Evaluate Runtime Guardrails
→ Create Decision / Trace / Explanation
→ Create Command Proposal, if allowed
→ Domain Command Revalidates
→ Domain State / Event / Audit
```

## 4.2 Pre-evaluation Gates

Evaluation 前必须确认：

- principal context；
- authorization to evaluate；
- scope；
- policy binding；
- PolicySnapshot；
- input freshness；
- aggregate version；
- purpose / consent，如适用；
- no active hard hold；
- environment / market / entity compatibility。

缺失 scope、policy binding 或 required input 时，不得进入普通 `ALLOW`。

## 4.3 Hard Guardrails First

先执行：

- Legal hard stop；
- Safety block / incident hold；
- KYC / Sanctions requirement；
- Privacy / purpose / consent；
- Payment / Ledger integrity；
- Permission / step-up / SoD；
- Provider / Market approval；
- rate limit / capacity hard limit。

任何 hard guardrail `BLOCK` 时，低优先级 ranking、pricing、sponsored、A/B 或 Enterprise entitlement 不再决定 allow。

## 4.4 Rule Evaluation

Rule evaluation 必须记录：

- rule order；
- inputs used；
- normalized values；
- result；
- reason code；
- dependency outcome；
- latency；
- data freshness；
- short-circuit；
- error / unknown；
- guardrail result。

## 4.5 Conflict Resolution

冲突按以下优先级处理：

```text
Canonical Invariant
→ Legal / Safety / Privacy / Security / Money hard stop
→ Market / Entity approved binding
→ Policy precedence
→ RiskDecision / approved review
→ ranking / optimization preference
→ default fallback
```

不同 source 的同层级冲突不得随机选择；必须返回 `REVIEW_REQUIRED`、`UNKNOWN` 或明确的 deny。

## 4.6 Decision Expiry

Decision 必须设置 expiry，尤其是：

- eligibility；
- risk / safety；
- location / travel；
- capacity；
- payment readiness；
- offer；
- payout；
- sensitive access；
- policy binding。

过期 decision 不能用于不可逆 command。Command handler 必须重新验证。

## 4.7 Command Revalidation

即使 PolicyDecision 为 `ALLOW`，Domain command 仍必须检查：

- aggregate version；
- current state；
- current permission；
- current RiskDecision / Safety hold；
- current Payment / Funding / Ledger；
- current KYC / Consent；
- current PolicySnapshot；
- idempotency；
- effective time。

这是防止 stale read、TOCTOU 和 replay 的最后边界。

## 4.8 Side-effect Firewall

Policy runtime 必须在技术上阻止：

- DB write beyond trace / cache；
- external network mutation；
- provider charge / refund / payout；
- notification send；
- file export；
- secret access；
- raw sensitive data exfiltration。

必要的 action 通过 CommandProposal → Domain command 完成。

---

# 5. Explainability / Decision Trace

## 5.1 Explanation Levels

```text
L0 — status / next action only
L1 — high-level reason code
L2 — relevant policy category / version / scope
L3 — authorized rule path and evidence references
L4 — internal audit trace and normalized inputs
```

普通 User 默认 L0–L1；Enterprise / Operator 按 scope 可到 L2；Compliance / Internal Audit 按授权可到 L3–L4。

## 5.2 User Explanation

User-facing explanation 至少说明：

- 结果；
- high-level reason；
- 是否 temporary；
- next step；
- support / appeal / manual review path；
- expected retry / expiry。

不得展示：

- 他人信息；
- raw KYC failure detail；
- 精确 risk threshold；
- Safety block 对方身份；
- anti-fraud detector；
- provider secret / internal endpoint。

## 5.3 Operator Explanation

Operator 需要：

- case routing；
- safe reason；
- required verification；
- allowed next command；
- scope / TTL；
- escalation；
- data classification。

Operator 不能因为看到更详细 trace 就自动获得修改 Domain 的权限。

## 5.4 Audit Trace

Audit trace 应可回答：

- 使用了哪个 policy version；
- 哪个 effective binding；
- 哪些 input source；
- 哪些 guardrail；
- 哪个 rule first blocked / allowed；
- 哪些 dependency unknown / timeout；
- 是否使用 cache；
- 是否有 human override；
- 是否创建 command proposal；
- Domain command 最终结果是什么。

## 5.5 Explanation Stability

Reason code 和 summary 是 external / support contract，应尽量稳定。Rule implementation 可以优化，但不能在没有版本或 change review 的情况下改变关键解释。

## 5.6 Explanation Limitation

如果无法安全解释完整原因，返回：

- safe high-level reason；
- review / support path；
- trace reference；
- limitation code。

不能用虚假的具体原因填补受保护的信息缺口。

## 5.7 Fairness / Consistency Review

涉及 eligibility、ranking、pricing、exposure、offer、risk、support priority 的 rule，必须检查：

- protected / sensitive attribute usage；
- proxy feature；
- disparate impact signal；
- market / language / device bias；
- false positive / false negative；
- appeal outcome；
- segment consistency；
- explanation availability。

公平性 review 不能覆盖 Safety、KYC、Privacy 或 Money hard stop，但必须识别规则是否错误使用敏感属性。

---

# 6. Simulation / Replay / Experiment

## 6.1 Simulation No Side Effects

Simulation 必须：

- 使用 fixture / snapshot；
- 禁止真实 Provider mutation；
- 禁止真实 notification；
- 禁止写 Ledger / Payment / Payout / Invoice；
- 不改变 RiskDecision / Safety Incident；
- 输出预计 decision、reason、guardrail、latency 和 divergence。

## 6.2 Scenario Dimensions

Simulation 至少覆盖：

- Market / Legal Entity；
- policy old / new；
- user / role / permission；
- KYC level / expiry；
- RiskDecision / Incident / hold；
- payment / settlement / ledger summary；
- provider available / degraded / unknown；
- consent / privacy / retention；
- capacity / rate limit；
- time / timezone / effective date；
- concurrent / retry / out-of-order event。

## 6.3 Counterfactual Result

PolicySimulation 必须区分：

```text
current_decision
candidate_decision
decision_changed
reason_changed
guardrail_changed
command_proposal_changed
side_effect_delta = NONE
```

## 6.4 Replay Modes

| 模式 | 允许 | 禁止 |
|---|---|---|
| Decision-only | 重算 decision / explanation | Domain mutation |
| Read-model-only | 重建 projection / analytics | Payment、Ledger、通知副作用 |
| Command dry-run | 检查 authorization / expected version | 执行 command / Provider operation |
| Incident replay | 重现 trace / timeline | 删除或覆盖 incident evidence |
| Audit replay | 验证 policy / control evidence | 修改审计结论 |

## 6.5 Historical Replay

Replay 必须使用原始：

- event time；
- PolicySnapshot；
- Market / Entity profile；
- KYC / Risk / Consent snapshot；
- provider normalized result；
- aggregate version；
- FX / Tax / Report version，如适用。

用当前 policy 重放历史，只能作为 counterfactual，不得写回历史结果。

## 6.6 Experiment Boundary

A/B 或 policy experiment 必须：

- 有 ExperimentApproval；
- 定义 eligible population；
- 不触碰 hard invariant；
- 不改变 Consent、KYC、Safety、Payment、Payout、Ledger 或 Privacy hard rules；
- 记录 assignment、exposure、policy version；
- 支持 kill switch；
- 有 stop criteria；
- 对 Enterprise / regulated scope 进行额外 review。

Experiment variant 不能直接成为 Market policy 或 Contract entitlement。

## 6.7 Simulation Data Boundary

Fixture / snapshot 必须：

- 脱敏 / tokenized；
- 与 production source 可追溯但不泄露 raw content；
- 有 retention / deletion；
- 禁止包含真实 secret；
- 对 D4 / D5 使用最小字段或 synthetic data；
- 记录使用目的、owner、access 和 output。

---

# 7. Policy Testing / Release Governance

## 7.1 Required Test Layers

每个 P0 policy package 至少通过：

```text
Schema validation
→ Unit / rule examples
→ Negative / deny cases
→ Boundary / threshold cases
→ Invariant tests
→ Security / Privacy tests
→ Money / Ledger tests, if relevant
→ Property / fuzz tests, if applicable
→ Historical regression
→ Simulation comparison
→ Performance / timeout tests
→ Release approval
```

## 7.2 Golden Cases

Golden case 必须覆盖：

- allow；
- deny；
- pending；
- review；
- unknown；
- timeout；
- stale cache；
- conflicting policy；
- expired KYC / Consent / policy；
- Safety hold；
- payment unknown；
- duplicate command；
- no permission；
- wrong Market / Entity / Provider；
- effective date boundary。

## 7.3 Negative Cases

必须验证 rule 不会：

- 把 null 当 allow；
- 把 Provider approved 当 KYC verified；
- 把 Invoice issued 当 Payment success；
- 把 ranking eligibility 当 Safety clearance；
- 把 User display name 当 identity match；
- 把 stale read 当 current truth；
- 把 expired decision 当有效；
- 把 human override 当永久 permission；
- 把 retry 当新 operation；
- 把 replay 当真实 command。

## 7.4 Invariant Tests

Policy package 必须通过 Chapter 25 的 invariant：

- identity / account separation；
- Order / Slot / Offer；
- Payment / Refund / Payout / Ledger；
- Privacy / Security / D4 / D5；
- idempotency / event dedupe；
- Provider unknown / reconciliation；
- Safety block / Incident；
- PolicySnapshot / effective time。

## 7.5 PolicyTestRun Status

```text
PASS
    required tests pass; no blocking invariant failure
FAIL
    one or more P0 / P1 expected behavior or invariant failure
INCOMPLETE
    test fixture、coverage、dependency、environment 或 evidence 不完整
```

`INCOMPLETE` 不能成为 release pass。

## 7.6 Release Gate

PolicyCodePackage 进入 RELEASED 前必须：

- source / artifact hash；
- schema / dependency lock；
- required PolicyTestRun pass；
- simulation / regression result；
- security / privacy review；
- Legal / Safety / Finance / KYC review，如适用；
- effective binding；
- rollback target；
- observability；
- support / training；
- approval / SoD；
- change lineage。

## 7.7 Hotfix Gate

Hotfix 可以缩短流程，但不得跳过：

- hard invariant tests；
- source hash；
- scope / TTL；
- rollback；
- owner；
- emergency audit；
- post-release validation。

## 7.8 Performance / Timeout

Policy runtime 必须定义：

- p50 / p95 / p99 target；
- dependency timeout；
- CPU / memory limit；
- queue / concurrency；
- retry policy；
- circuit breaker；
- fail-safe output；
- observability。

超时不能默认为 allow，尤其是 Payment、Payout、KYC、Safety、Privacy 和 sensitive access。

---

# 8. Runtime Guardrail / Degraded Mode

## 8.1 Guardrail Classes

```text
InvariantGuardrail
LegalGuardrail
SafetyGuardrail
PrivacyGuardrail
SecurityGuardrail
MoneyGuardrail
PermissionGuardrail
MarketProviderGuardrail
CapacityGuardrail
VersionGuardrail
```

每个 Guardrail 必须有 owner、input、result、severity、blocking、fallback 和 audit。

## 8.2 Fail-safe Defaults

| 场景 | 默认行为 |
|---|---|
| KYC dependency unavailable | pending / manual review；不 false VERIFIED |
| Safety signal unavailable | deny risky action / preserve hold |
| Payment unknown | reconcile / hold；不重复 charge |
| Ledger unavailable | no irreversible money mutation |
| Privacy / consent unavailable | deny purpose-bound sensitive action |
| Policy binding unavailable | deny / review；不使用 arbitrary default |
| Provider route ambiguous | hold / manual route |
| Risk signal stale | conservative decision / re-evaluate |
| Capacity limit exceeded | throttle / queue / pause admission |
| Explanation generation failure | safe reason + trace reference，不泄漏内部细节 |

## 8.3 Degraded Mode

Degraded mode 必须明确：

- affected scope；
- allowed operations；
- blocked operations；
- data freshness；
- retry / reconciliation；
- user / Enterprise message；
- owner；
- expiry；
- resume gate。

不能用一个全局 `DEGRADED` 覆盖不同 Provider、Market、Operation 或 Data class 的边界。

## 8.4 Circuit Breaker

Circuit breaker 可以暂停：

- rule package；
- dependency；
- Provider；
- market；
- operation type；
- experiment variant；
- cache use；
- command proposal。

Circuit breaker 不能删除已有 decision trace、Domain events 或 money facts。

## 8.5 Guardrail Override

任何 override 必须先检查 guardrail `blocking`：

- `blocking = true` 的 Canonical / Legal / Safety / Money / Privacy guardrail 默认不可 override；
- `blocking = false` 的 routing / optimization / soft threshold 可以经批准 review；
- override 必须有 scope、TTL、reason、approver、evidence 和 audit；
- 到期自动失效；
- 不继承到新 Market / Enterprise / object；
- 不改变历史 evaluation。

## 8.6 Manual Review Queue

进入 manual review 时必须生成：

- reason code；
- required evidence；
- allowed reviewer role；
- SLA / due date；
- safe user message；
- prohibited action；
- escalation；
- resolution / expiry。

Manual review 不能变成无限期 pending，也不能以 Support note 代替 Domain decision。

---

# 9. Human Override / Appeal / Review

## 9.1 Override Use Cases

允许的 bounded override 例子：

- 补充可信证据后 requeue review；
- 对明确误报进行人工复核；
- 在 provider degraded 时转 approved manual path；
- 对非 hard-stop 的 ranking / routing 结果进行重审；
- 在 migration quarantine 中完成 mapping；
- 对 customer-visible explanation 进行 safe correction。

## 9.2 Prohibited Override

Human override 不得：

- 跳过 KYC / Sanctions；
- 释放 Safety hold；
- 允许 duplicate money operation；
- 修改 Ledger；
- 让未验证 SettlementAccount 收款；
- 访问无 purpose / TTL / permission 的 D4 / D5；
- 把未签署 Contract 当作已接受；
- 永久关闭 policy；
- 隐藏或删除 decision trace。

## 9.3 Override Approval

HumanOverrideRequest 至少需要：

- requesting principal；
- target decision / scope；
- reason；
- evidence；
- permitted override type；
- prohibited guardrails；
- max duration；
- approver role；
- command / review path；
- outcome audit。

## 9.4 Appeal

Appeal path 必须：

- 说明可申诉的 decision 类型；
- 提供 safe reason；
- 允许补充 evidence；
- 由不同于原始自动 decision 的 reviewer 处理，适用时；
- 有 SLA / status；
- 不泄漏他人数据或内部 detection；
- 保留原 decision 和 new review；
- 支持 reopen / escalate。

## 9.5 Review Outcome

DecisionReview 可以：

```text
CONFIRM
CHANGE
ESCALATE
HOLD
REJECT
```

CHANGE 只形成新的 Domain command / RiskDecision / Safety command proposal，不直接覆盖原始 evaluation。

## 9.6 Override Metrics

监控：

- override rate；
- override by reviewer / scope；
- expiry / revoke；
- reversal / recurrence；
- appeal success；
- false positive / negative；
- time to review；
- hard guardrail override attempt；
- concentration / abuse。

发现异常 override pattern 时，创建 RiskEvent / Finding，不只降低 override visibility。

---

# 10. Cache / Replay / Observability

## 10.1 Cache Key

RuntimeDecisionCacheEntry 的 key 必须至少包含：

- principal / scope；
- target object / aggregate version；
- policy binding；
- PolicySnapshot；
- relevant risk / KYC / consent version；
- Market / Entity / Provider；
- time bucket；
- input hash。

不能只按 user id、task id 或 endpoint 缓存所有 decision。

## 10.2 Invalidation Events

至少在以下事件发生时 invalidation：

- RiskDecision / Incident / RiskHold；
- KYC level / expiry；
- Consent withdrawal；
- Permission / Membership change；
- Policy binding change；
- Market / Provider suspend；
- Payment / Funding status；
- Safety block；
- aggregate version change；
- LegalHold / privacy restriction；
- capacity / rate limit hard breach。

## 10.3 Stale Cache

stale cache 的行为按 policy：

- safe read 可以展示 stale 并标记 time；
- new Match / Offer 需要 revalidation；
- Payment / Payout / Ledger 不接受 stale allow；
- D4 / D5 不接受 stale permission；
- Safety / KYC 不接受 stale pass；
- unknown / conflict 转 review 或 deny。

## 10.4 Runtime Metrics

至少记录：

- evaluation count；
- decision distribution；
- rule latency；
- dependency timeout；
- unknown / error；
- guardrail block；
- cache hit / stale；
- command proposal / rejection；
- Domain command divergence；
- override / appeal；
- policy version distribution；
- explanation failure；
- P0 / P1 decision anomaly。

## 10.5 DecisionObservation

当 decision 与 Domain command 结果不一致时，必须记录：

- evaluation context；
- expected aggregate version；
- actual state；
- stale / race / policy drift / provider change；
- command result；
- user / money / safety impact；
- linked risk / finding；
- remediation。

不一致不是允许直接覆盖 Domain state 的理由。

## 10.6 Trace Sampling

Trace 可以按 policy sampling，但以下默认全量保留必要 trace：

- Payment / Payout / Ledger decision；
- KYC / Safety / Privacy sensitive access；
- deny / review / unknown；
- human override / appeal；
- P0 / P1 incident；
- policy migration；
- Market reapproval；
- audit / regulator request。

---

# 11. Security / Privacy / Data Boundary

## 11.1 Rule Package Security

PolicyCodePackage 必须：

- source review；
- signed build；
- artifact integrity；
- dependency scan；
- permission sandbox；
- secret scan；
- reproducible build 或 documented limitation；
- release approval；
- rollback。

## 11.2 Rule Input Minimization

只传入 rule 必需的数据：

- 不传 raw KYC 只为判断 KYC level；
- 不传完整 location 只为判断 capability / zone；
- 不传完整聊天只为判断 evidence presence；
- 不传 bank credential 只为判断 account verified；
- 不传其他用户 identity 只为判断 block relationship。

## 11.3 Explanation Redaction

Explanation / Trace export 必须执行：

- audience check；
- field classification；
- purpose check；
- redaction；
- expiry；
- download audit；
- recipient binding。

## 11.4 Policy Secret Boundary

Policy rule 可以隐藏：

- fraud detector details；
- abuse threshold；
- internal security signal；
- provider secret；
- vulnerability path；
- other user / enterprise data。

但不能用“security”掩盖所有事实。用户应得到足够的 safe reason、next step 和 appeal path。

## 11.5 Retention

PolicyCodePackage、DecisionTrace、Explanation、Simulation、Replay、Test artifact、Override 和 Appeal 按：

- Chapter 24 data lifecycle；
- Chapter 34 Evidence retention；
- Chapter 37 Audit / Board obligation；
- Contract / regulator request；
- LegalHold；
- security incident；

计算 retention。过期后删除或匿名化仍需保留必要 integrity / audit reference。

---

# 12. Governance / Release / Incident

## 12.1 Policy Release Board

P0 policy release 至少需要：

- PolicyOwner；
- EngineeringOwner；
- Risk / Compliance；
- Legal / Tax / KYC / Safety / Privacy / Finance，按影响；
- Test evidence；
- effective binding；
- rollback；
- support / communication；
- Audit trail。

## 12.2 Runtime Incident

以下情况至少创建 DecisionObservation、RiskEvent 或 Incident：

- unexpected allow；
- expected deny becomes allow；
- hard guardrail bypass attempt；
- policy version mismatch；
- unexplained decision divergence；
- decision trace missing；
- explanation leaks restricted data；
- duplicate command proposal；
- cache stale allow；
- replay side effect；
- override abuse；
- systematic segment disparity。

## 12.3 Rollback Governance

Rollback 之前确认：

- current affected scope；
- in-flight proposals；
- Domain facts already committed；
- old binding still legal / safe；
- provider / contract compatibility；
- customer / Enterprise communication；
- audit / compliance impact；
- observation window。

## 12.4 Incident Containment

可先：

- pause package / binding；
- disable experiment；
- force manual review；
- block risky command proposal；
- invalidate cache；
- route to approved fallback；
- preserve trace / evidence。

不能直接：

- delete decisions；
- rewrite PolicySnapshot；
- reverse Ledger；
- modify historical KYC / Safety / Consent；
- re-run replay as real commands。

## 12.5 Review Cadence

```text
Daily: runtime error / unknown / guardrail / stale / override
Weekly: version distribution / divergence / test gap / policy drift
Monthly: rule performance / explanation / fairness / privacy / cost
Quarterly: policy package / dependency / risk / audit / reapproval
Event-driven: P0 incident / legal change / provider change / material divergence
```

---

# 13. Acceptance Criteria

## AC-39-01 — Versioned Code Artifact

每个 production Policy-as-Code package 必须绑定 PolicyDefinition、PolicySetVersion、source / artifact hash、schema、dependencies、tests、owner、approval、effective binding 和 rollback target。

## AC-39-02 — Pure Evaluation Default

Policy evaluation 默认不得写业务状态、发起 Provider mutation、发送通知、创建 Payment、Payout、Invoice、Ledger、KYC 或 Safety fact。

## AC-39-03 — Explicit Unknown

Policy output 必须区分 ALLOW、DENY、PENDING、REVIEW_REQUIRED、NOT_APPLICABLE、UNKNOWN 和 ERROR；高风险场景 UNKNOWN 不得默认 ALLOW。

## AC-39-04 — Rule Ordering

Rule 必须定义 priority、precedence、short-circuit、conflict、unknown、timeout、fallback 和 explanation behavior，不能依赖执行顺序偶然性。

## AC-39-05 — Input Schema

PolicyInputSchema 必须定义 required / optional fields、source、classification、freshness、normalization、validation 和 stale behavior。

## AC-39-06 — Output Schema

PolicyOutputSchema 必须定义 decision、reason code、next action、uncertainty、command proposal 和 audience visibility，不能直接返回任意 mutation payload。

## AC-39-07 — Context Scope

PolicyEvaluationContext 必须绑定 principal、domain object、Market / Entity / Provider、policy binding、snapshot、risk / consent / KYC summary、time、purpose、hash 和 classification。

## AC-39-08 — Freshness

每个关键 input 必须带 source、observed / effective time、TTL、authority 和 stale behavior；stale Safety、KYC、Payment、Ledger、Privacy input 不得生成无条件 allow。

## AC-39-09 — Hard Guardrails First

Legal、Safety、KYC / Sanctions、Privacy、Security、Money、Permission、Provider / Market、Capacity 和 Version guardrail 必须先于 ranking、pricing、sponsored、experiment 或 Enterprise preference。

## AC-39-10 — Decision Is Not State

PolicyDecision、CommandProposal、DecisionTrace 或 HumanOverrideRequest 不得直接成为 Order、Payment、Payout、Ledger、KYC、Safety、Invoice、Tax 或 Contract state。

## AC-39-11 — Command Revalidation

Domain command 执行前必须重新检查 aggregate version、current state、permission、Risk / Safety、KYC / Consent、Payment / Funding / Ledger、PolicySnapshot、effective time 和 idempotency。

## AC-39-12 — Side-effect Firewall

Policy runtime 必须技术上阻止 DB mutation、Provider charge / refund / payout、notification、export、secret access 和 raw sensitive data exfiltration。

## AC-39-13 — Trace Completeness

DecisionTrace 必须记录 policy version、binding、input refs、normalized values、rule steps、guardrails、conflict / unknown、latency、cache 和 command proposal result。

## AC-39-14 — Explanation Levels

系统必须按 User、Enterprise、Operator、Compliance、Engineering、Audit / Board audience 分层解释，不能把 raw risk、他人数据、secret 或检测规则暴露给未授权受众。

## AC-39-15 — Safe User Explanation

用户被 deny、pending、review 或 unknown 时，必须获得稳定的 high-level reason、next step、temporary / expiry 信息和 appeal / support path，如适用。

## AC-39-16 — Explanation Limitation

无法安全展示完整原因时，必须返回 safe reason、trace reference 和 limitation，不得编造具体原因或泄漏受保护信息。

## AC-39-17 — Simulation No Mutation

PolicySimulation 必须使用 fixture / snapshot，无真实 Payment、Payout、Ledger、Invoice、KYC、Safety、Notification 或 Provider side effect。

## AC-39-18 — Replay Boundaries

PolicyReplay 必须区分 decision-only、read-model-only、command dry-run、incident replay 和 audit replay；replay 不得重新执行不可逆 command。

## AC-39-19 — Historical Replay Fidelity

历史 replay 必须使用 original event time、PolicySnapshot、Market / Entity、Risk / KYC / Consent、Provider result、aggregate version 和相关 Finance versions；当前 policy replay 只能作为 counterfactual。

## AC-39-20 — Experiment Guardrails

A/B 或 policy experiment 必须有 ExperimentApproval、eligible scope、assignment、exposure、stop criteria、kill switch，并不得触碰 hard invariant。

## AC-39-21 — Test Layers

P0 policy 必须通过 schema、positive、negative、boundary、invariant、security / privacy、money、regression、simulation、performance 和 release checks。

## AC-39-22 — Negative Cases

测试必须证明 null、Provider approved、Invoice issued、ranking result、stale read、expired decision、human override、retry 和 replay 不会被错误映射为 allow 或真实 mutation。

## AC-39-23 — Invariant Regression

PolicyTestRun 必须覆盖 Chapter 25 的 identity、Marketplace、Money / Ledger、Privacy / Security、idempotency、Provider、Safety 和 PolicySnapshot invariants。

## AC-39-24 — Incomplete Not Pass

PolicyTestRun 为 INCOMPLETE、fixture / dependency / coverage 不完整或存在 blocking invariant failure 时不得 release。

## AC-39-25 — Release Gate

PolicyCodePackage 进入 RELEASED 前必须有 artifact integrity、locked dependencies、required tests、simulation、security / privacy / legal / finance review、effective binding、rollback、observability、support 和 SoD。

## AC-39-26 — Timeout Safe

Policy dependency timeout、circuit break 或 evaluation error 不得在 Payment、Payout、KYC、Safety、Privacy、Ledger 或 sensitive access 中默认 allow。

## AC-39-27 — Guardrail Blocking

blocking 的 Canonical、Legal、Safety、Money、Privacy、Security 或 Version guardrail 不得被低优先级 rule、Enterprise tier、Provider response、feature flag 或普通 human override 覆盖。

## AC-39-28 — Degraded Mode Scoped

Degraded mode 必须定义 affected scope、allowed / blocked operation、freshness、retry / reconcile、user message、owner、expiry 和 resume gate，不能用全局状态掩盖局部风险。

## AC-39-29 — Manual Review Queue

REVIEW_REQUIRED 必须生成 reason、required evidence、reviewer role、SLA、safe message、prohibited action、escalation 和 expiry；不能无限期 pending。

## AC-39-30 — Human Override Bounded

HumanOverrideRequest 必须有 scope、reason、evidence、type、prohibited guardrails、max duration、approver role、command / review path 和 audit；不得跳过 KYC、Safety、Money、Privacy、Ledger 或 Contract hard gate。

## AC-39-31 — Appeal Separation

Appeal 必须保留原始 decision、允许补充 evidence、由适当的不同 reviewer 处理、提供 SLA / status / escalation，并生成新的 DecisionReview，不覆盖原 trace。

## AC-39-32 — Cache Safety

RuntimeDecisionCacheEntry 必须绑定 context hash、aggregate / policy / source versions、created / expiry、invalidation 和 stale behavior；stale cache 不得生成 irreversible allow。

## AC-39-33 — Divergence Observation

PolicyDecision 与 Domain command 结果不一致时必须创建 DecisionObservation，记录 stale read、race、policy drift、provider change、data quality、impact 和 remediation linkage。

## AC-39-34 — Sensitive Trace Boundary

Trace、Explanation、Simulation、Replay、Test fixture 和 export 必须遵守 D4 / D5、raw KYC、secret、bank credential、privacy、purpose、TTL、redaction 和 audit boundary。

## AC-39-35 — Version / Rollback Governance

Policy release、hotfix、pause、rollback 和 retire 必须保留 old / new versions、scope、effective time、in-flight proposal、Domain facts、communication、observation 和 closeout evidence。

## AC-39-36 — No Fabricated Decision Fact

系统不得因为 PolicyDecision、DecisionTrace、Explanation、Simulation、Replay、Test PASS、Guardrail、HumanOverride、Cache 或 CommandProposal 自动生成 Payment success、Funding、Ledger、KYC VERIFIED、Safety resolved、Tax filed、Invoice issued 或 Contract accepted 事实。

---

# 14. P0 / P1 Boundary

## 14.1 P0

- PolicyCodePackage、PolicyRule、PolicyExpression、PolicyInputSchema、PolicyOutputSchema；
- PolicyEvaluationContext、PolicyEvaluationRun、PolicyDecision、DecisionTrace、DecisionExplanation；
- GuardrailEvaluation、CommandProposal、PolicySimulation、PolicyReplay；
- PolicyTestCase、PolicyTestRun、HumanOverrideRequest、DecisionReview、RuntimeDecisionCacheEntry、DecisionObservation；
- pure evaluation、explicit unknown、hard guardrail、side-effect firewall、command revalidation；
- explainability audience、redaction、safe reason、appeal；
- simulation / replay no-side-effect；
- test / release / rollback / effective binding / cache / degraded mode；
- human override、manual review、Risk / Safety / KYC / Money / Privacy boundaries；
- 36 项 AC-39 验收标准。

## 14.2 P1

- visual policy graph editor；
- automated rule synthesis suggestions；
- counterfactual impact explorer；
- explainability localization assistant；
- property-based test generation；
- decision drift clustering；
- fairness slice recommendation；
- policy dependency optimizer；
- adaptive cache TTL；
- semantic diff for rule packages；
- natural-language simulation query。

P1 自动化不能改变 P0 的 deterministic / version / scope / hard guardrail / no-side-effect / privacy / audit / Domain command boundary。

---

# 15. Locked Conclusions / Next Work

本章锁定：

```text
Policy-as-Code 是版本化、可测试、可审计的 rule artifact
Evaluation 默认纯函数和无副作用
ALLOW / DENY / PENDING / REVIEW / UNKNOWN / ERROR 必须显式区分
Hard guardrail 先执行，低优先级优化不能覆盖
Decision、Trace、Explanation 和 CommandProposal 不等于 Domain state
Command handler 必须重新校验 current state、version、permission 和 PolicySnapshot
Simulation / Replay 只能分析，不得重新执行真实资金或安全副作用
Human override 有 scope、TTL、SoD、Evidence 和 appeal，不能绕过 hard invariant
Cache 只是优化，stale / conflict / timeout 必须 fail-safe
Policy release 需要 tests、effective binding、rollback、observability 和 closeout
```

下一步进入：

```text
Chapter 40 — Decision Data / Model Risk / AI Governance
```

Chapter 40 将把用于 Policy、Risk、Ranking、Pricing、Fraud、Support 和 Forecast 的数据集、模型、特征、训练、评估、偏差、漂移、人工监督和 AI 使用边界收口，继续保持 AI / Model output 不替代 Domain truth、Safety、KYC、Money、Privacy 或 Ledger facts。

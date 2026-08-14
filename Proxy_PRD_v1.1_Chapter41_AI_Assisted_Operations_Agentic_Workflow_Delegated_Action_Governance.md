# Proxy PRD v1.1

## Chapter 41 — AI-assisted Operations / Agentic Workflow / Delegated Action Governance

**文档类型**：AI-assisted Operations / Agentic Workflow / Tool Permission / Approval / Action Sandbox / Human Handoff / Delegated Action Governance
**状态**：ACTIVE — Final Product-Contract Boundary Before Implementation
**依赖**：Chapter 18 Operator Console / Manual Intervention、Chapter 23 Policy Defaults / Configuration Registry、Chapter 24 Account Security / Privacy / Consent / Data Lifecycle、Chapter 25 E2E Acceptance / Test Matrix / Invariant Gate、Chapter 26 Engineering API / Event / Schema Contract、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 37 Financial Controls / Internal Audit / Risk Appetite / Board Governance、Chapter 38 Regulatory Change / Policy Migration / Market Re-Approval Governance、Chapter 39 Policy-as-Code / Runtime Decision / Explainability Governance、Chapter 40 Decision Data / Model Risk / AI Governance
**后续**：完成本章后停止横向新增核心 PRD，进入 implementation、contract tests、provider certification、pilot 和 launch readiness。

---

# 0. 本章目标

Chapter 40 已经定义数据、模型、Prompt、RAG、Vendor、Bias、Drift、Human Oversight 和 Model Incident。本章继续回答一个更具体的问题：

> AI 可以在 Proxy 中看什么、想什么、建议什么、调用什么、代表谁提出什么动作，以及在什么条件下必须停止并交给人。

本章把 AI-assisted Operations 与 Agentic Workflow 限制在受控的执行边界内：

- AI 可以读取经过授权的 Read Model、Policy、Case、Evidence 和 operational context；
- AI 可以生成 plan、draft、ranking、summary、question、recommendation 和 CommandProposal；
- AI 可以通过 allowlisted Tool 发起受控、可验证、可审计的 Domain Command；
- AI 不拥有 User、Business、Operator、Provider、Finance、Safety、KYC、Privacy 或 Legal authority；
- Delegated Action 不是“AI 直接改状态”，而是一个带有 principal、scope、purpose、policy snapshot、approval、idempotency、receipt 和 outcome verification 的受控委托；
- 不可逆、高影响、跨租户、资金、身份、安全、隐私、合同、税务和法律动作必须 human-only 或 Domain-owned approval；
- 任何 tool、workflow、prompt、provider 或 model 出现越权、注入、循环、泄露、错误执行或不确定性时，必须 fail closed、暂停、限流或转人工。

本章不做：

- 不定义新的 Marketplace truth、Order truth、Ledger truth、KYC truth、Safety truth 或 Contract truth；
- 不让 AI 绕过 Chapter 18 的 Operator Command boundary；
- 不让 AI 通过 SQL、shell、浏览器自动化、未登记 HTTP 或任意 SDK 直接改生产数据；
- 不把“用户说了”“模型说了”“工具返回了”“审批通过了”自动当作 Domain fact；
- 不让自然语言 permission 取代结构化 Permission、Policy、Scope、Approval 和 Audit；
- 不以 AI 的自动化率、成本节约、响应速度或任务完成率牺牲安全、隐私、金融完整性、用户申诉权或人工可接管性。

## 0.1 本章核心结论

```text
AI actor ≠ UserAccount
AI actor ≠ Operator
Plan ≠ Command
Command proposal ≠ Domain event
Tool result ≠ Source-of-truth fact
Approval ≠ permission outside its scope
Human confirmation ≠ blanket delegation
Automation success ≠ business success
Reversible action ≠ harmless action
Read access ≠ write access
Model confidence ≠ authorization
Workflow completion ≠ Ledger / KYC / Safety / Contract completion
```

## 0.2 Agentic Use Tiers

| Tier | 用途 | 默认行为 |
|---|---|---|
| A0 | 搜索、摘要、分类、内部草稿、只读问答 | 只读；不产生 Domain mutation |
| A1 | Case triage、运营建议、候选排序、缺失信息识别 | 可生成 proposal；需人工或既有 Policy 执行 |
| A2 | 低风险、可逆、范围明确的内部辅助动作 | 允许受控 Delegated Action；必须 preflight、限额、receipt、audit |
| A3 | 影响用户、订单、通知、供应商或运营队列的业务动作 | 明确 approval chain、revalidation、可中止、人工接管 |
| A4 | Money、KYC、Safety、Privacy、Contract、Tax、Ledger、Account closure 或跨租户动作 | human-only / Domain-owned；AI 只能 draft、prepare 或 route |
| PROHIBITED | 任意代码执行、绕过权限、秘密提取、欺骗用户、删除审计、伪造事实、不可审计的自主操作 | 禁止 |

---

# 1. Agentic Operations Constitution

## 1.1 AI 是受限 Actor，不是新的 Principal

AI 运行必须绑定一个真实的调用主体：

```text
requesting_principal
acting_operator_or_business_member
ai_profile
workflow_version
purpose
tenant / business / market / entity scope
policy snapshot
```

AI 不得拥有独立的 UserAccount、BusinessMembership、Operator role、KYC status、payout account、consent 或法律主体身份。所有外部动作必须以真实 principal 的授权上下文和 AI profile 的受限能力共同决定。

## 1.2 Plan、Proposal、Command、Event 分离

标准链路：

```text
User / Operator / System Trigger
→ Context Resolution
→ AI Plan
→ Policy Preflight
→ CommandProposal
→ Approval / Human Confirmation
→ Domain Command
→ Domain Event
→ ActionReceipt
→ Outcome Verification
```

AI plan 说明“建议做什么”；CommandProposal 说明“准备调用哪个 canonical command”；Domain Command 才是可以改变 Domain aggregate 的唯一入口；Domain Event 才是已经发生的事实；ActionReceipt 只证明调用和结果，不替代 Domain event。

## 1.3 最小权限与最小数据

每个 WorkflowRun、ToolInvocation 和 DelegatedAction 都必须限制：

```text
actor
tenant
resource
fields
purpose
market / legal entity
time window
maximum calls
maximum spend / exposure
approval mode
data classification
```

未列入 scope 的字段、对象、tenant、region、工具或动作默认不可见、不可调用、不可推断。

## 1.4 Deterministic Guardrail First

在任何 Model planning 或 Tool call 前，系统必须先执行：

- principal authentication；
- tenant / business isolation；
- Operator / Business / Domain permission；
- data classification；
- purpose / consent / retention；
- high-risk action block；
- policy snapshot；
- resource state freshness；
- quota / budget / rate limit；
- idempotency and replay check；
- tool availability and provider health。

模型不能通过自然语言说服、chain-of-thought、retrieved text、用户紧急程度或历史成功率绕过这些 deterministic gates。

## 1.5 Safe Uncertainty

当 AI 不能确定：

- principal 或 authority；
- 目标资源；
- 当前状态；
- 允许的字段；
- 用户意图；
- 审批责任人；
- 工具结果；
- 是否会产生不可逆影响；

系统必须进入 `NEEDS_CLARIFICATION`、`WAITING_HUMAN`、`PENDING_APPROVAL` 或 `ABORTED_SAFE`，不得自行猜测并继续执行。

## 1.6 Human Override Is a Controlled Command

人工接管不是任意 override。人工必须在明确的 case、scope、reason、evidence、permission、expiry 和 audit context 下执行。人工也不能通过 AI workflow 获得原本没有的 Operator、Finance、Safety、KYC 或 Privacy 权限。

## 1.7 No Automation Against Safety

自动化不得以提高 conversion、fill rate、GMV、margin、response time、support deflection、operator throughput 或 provider acceptance 为理由，降低：

```text
Safety
KYC / AML
Consent / Privacy
Payment integrity
Payout integrity
Ledger reconciliation
Tax / invoice controls
Contract / legal controls
Auditability
User appeal and human access
```

---

# 2. Agent / Workflow Domain Objects

## 2.1 AIOperatorProfile

`AIOperatorProfile` 是 AI-assisted capability 的登记对象，不代表独立人或法律主体。

```text
AIOperatorProfile
├── id
├── name
├── owner_ref
├── domain_scope[]
├── allowed_surfaces[]
├── use_tier
├── model_ref / prompt_ref / retrieval_ref
├── intended_use
├── prohibited_use[]
├── default_data_scope
├── default_tool_scope
├── human_oversight_mode
├── max_run_duration
├── max_steps
├── max_tool_calls
├── status
├── effective_at / expires_at
└── approval_refs[]
```

状态：

```text
DRAFT
PENDING_REVIEW
APPROVED
ACTIVE
PAUSED
SUSPENDED
RETIRED
```

`ACTIVE` 前必须通过 Chapter 40 ModelRelease、Chapter 39 PolicyTestRun、Chapter 34 Compliance / Privacy、Chapter 37 Risk / SoD 以及本章 Tool / Approval gate。

## 2.2 WorkflowDefinition

描述一个可执行工作流的目的、触发器、允许的步骤、输入、输出、停止条件和人工接管规则。

```text
WorkflowDefinition
├── id
├── name
├── purpose
├── owner_ref
├── domain_scope[]
├── trigger_types[]
├── input_schema
├── output_schema
├── allowed_step_types[]
├── allowed_tool_refs[]
├── prohibited_action_classes[]
├── approval_policy_ref
├── stop_conditions[]
├── handoff_policy_ref
├── data_policy_ref
└── status
```

WorkflowDefinition 不允许通过配置动态扩大 Tool、resource、field 或 action scope。

## 2.3 WorkflowVersion

每个 production workflow 必须绑定不可变的 `WorkflowVersion`，包括 steps、transition、prompt、model、retrieval、tool allowlist、policy snapshot、approval chain、budget 和 rollback target。

WorkflowVersion 的任意语义变化必须产生新版本，不能静默编辑 ACTIVE 版本。

## 2.4 WorkflowContext

WorkflowContext 是一次运行的最小上下文，不是全量数据库快照。

```text
WorkflowContext
├── run_ref
├── requesting_principal_ref
├── acting_principal_ref
├── tenant_ref
├── business_ref
├── market / legal_entity_ref
├── case_ref / task_ref / order_ref
├── purpose
├── policy_snapshot_ref
├── data_scope
├── freshness_requirements
├── consent / restriction snapshot
├── correlation_id
├── expiry
└── redaction profile
```

## 2.5 WorkflowRun

记录一次从 trigger 到终止的完整执行。

```text
WorkflowRun
├── id
├── workflow_version_ref
├── profile_ref
├── context_ref
├── trigger_ref
├── status
├── risk_class
├── plan_hash
├── step_count
├── tool_call_count
├── approval_refs[]
├── human_handoff_ref
├── budget_usage
├── started_at / ended_at
├── termination_reason
└── audit_ref
```

状态：

```text
CREATED
CONTEXT_RESOLVING
PLANNING
PENDING_PRECHECK
PENDING_APPROVAL
RUNNING
WAITING_PROVIDER
WAITING_HUMAN
PARTIAL_SUCCESS
SUCCEEDED
FAILED
CANCELLED
EXPIRED
ABORTED_SAFE
COMPENSATION_REQUIRED
```

## 2.6 WorkflowStep

每个 step 必须声明 type、input、output、tool、risk、retry、timeout、approval、side effect 和 stop condition。

允许的 step type：

```text
READ
NORMALIZE
CLASSIFY
ASK_CLARIFICATION
PLAN
PROPOSE
REQUEST_APPROVAL
PREVIEW
DOMAIN_COMMAND
NOTIFY_DRAFT
HANDOFF
VERIFY
COMPENSATE
STOP
```

禁止出现隐式 `EXECUTE_ANYTHING`、`RUN_CODE`、`CALL_ARBITRARY_URL` 或 `PATCH_STATE` step。

## 2.7 ToolDefinition

ToolDefinition 是唯一可被 AI 调用的工具契约。

```text
ToolDefinition
├── id
├── name
├── owner_ref
├── tool_class
├── input_schema
├── output_schema
├── resource_scope
├── field_scope
├── domain_command_ref (if mutating)
├── provider_ref (if external)
├── side_effect_class
├── idempotency_contract
├── timeout / retry policy
├── data classification
├── rate / budget profile
├── human approval requirement
├── audit requirements
├── safe fallback
└── status
```

Tool class：

```text
READ
SEARCH
COMPUTE
DRAFT
COMMUNICATE
DOMAIN_COMMAND
PROVIDER_QUERY
PROVIDER_COMMAND
HUMAN_HANDOFF
```

任意工具都必须有明确 schema；ToolDefinition 不得把 arbitrary JSON、arbitrary URL、arbitrary SQL、arbitrary shell 或任意 code interpreter 暴露给 production workflow。

## 2.8 ToolPermission

ToolPermission 是针对 profile、workflow、principal、tenant、resource、field 和 action 的可审计授权。

```text
ToolPermission
├── id
├── subject_ref
├── ai_profile_ref
├── tool_ref
├── tenant / resource scope
├── field scope
├── action scope
├── purpose
├── conditions
├── approval mode
├── max calls / max value
├── effective_at / expires_at
├── granted_by
├── revoked_at / revoked_by
└── policy snapshot
```

## 2.9 ToolInvocation

ToolInvocation 记录一次工具尝试，包括 preflight、输入 hash、脱敏摘要、permission decision、result class、side effect 和 receipt。完整 secret、token、raw D5 payload 和不必要的个人原文不得写入普通 trace。

状态：

```text
REQUESTED
PRECHECKED
DENIED
APPROVAL_REQUIRED
RUNNING
SUCCEEDED
FAILED
TIMED_OUT
RETRIED
CANCELLED
```

## 2.10 DelegationGrant

DelegationGrant 表示一个真实 principal 在明确范围内委托 AI 生成或发起动作，不是永久授权。

```text
DelegationGrant
├── grantor_principal_ref
├── ai_profile_ref
├── workflow_ref
├── allowed_tools[]
├── allowed_resources[]
├── allowed_actions[]
├── prohibited_actions[]
├── data scope
├── purpose
├── confirmation rule
├── spend / exposure limit
├── start / expiry
├── revoke condition
├── consent / policy refs
└── audit ref
```

默认 `expiry` 必须短于业务任务或 session 的有效期；没有明确 expiry 的 DelegationGrant 不得 ACTIVE。

## 2.11 ApprovalRequest

ApprovalRequest 绑定一个具体 proposal、resource、scope、risk、preview、impact、evidence、approver role、expiry 和 decision。

状态：

```text
CREATED
PENDING
APPROVED
REJECTED
EXPIRED
REVOKED
CONSUMED
```

Approval 只对一个确定版本的 `CommandProposal` 有效；proposal、resource、amount、recipient、scope、policy snapshot 或风险级别变化时必须重新审批。

## 2.12 ApprovalChain

ApprovalChain 根据 action class、money exposure、data class、tenant、market、risk tier 和 SoD 规则决定：

- 是否需要用户确认；
- 是否需要 Operator；
- 是否需要 Domain owner；
- 是否需要 Risk / Privacy / Security；
- 是否需要 dual control；
- 是否只允许 human-only；
- approval 的顺序、并行关系、expiry 和替代路径。

## 2.13 ActionSandbox

ActionSandbox 是执行前的隔离环境或 dry-run boundary。

```text
ActionSandbox
├── id
├── run_ref
├── environment
├── tenant / resource scope
├── masked data policy
├── simulated commands
├── blocked tools
├── network boundary
├── quota / time limit
├── preview output
├── diff / impact summary
├── approval refs
└── expiry
```

Sandbox 默认不得触发真实 Payment、Payout、KYC、Safety、Ledger、Tax、Contract、Notification delivery 或 Provider mutation。

## 2.14 CommandProposal

Chapter 39 已定义 `CommandProposal`。本章只补充其 agentic 字段：

```text
origin_workflow_run
origin_step
acting_principal
ai_profile
tool_invocation
target_aggregate
canonical_command
typed_payload_hash
predicted_side_effects
risk_class
approval_refs
revalidation_requirements
compensation_plan
```

没有 canonical command、明确 target aggregate、typed payload、policy snapshot 和 idempotency key 的 proposal 不得进入 approval 或 execution。

## 2.15 DelegatedAction

DelegatedAction 是经过 permission、preflight 和必要 approval 后允许进入 Domain Command 的执行单元。

```text
PROPOSED
PREVIEWED
APPROVED
REVALIDATION_REQUIRED
EXECUTING
SUCCEEDED
REJECTED
FAILED
PARTIAL
CANCELLED
COMPENSATION_REQUIRED
```

它必须引用 `CommandProposal`，不允许只保存自然语言 action。

## 2.16 ActionReceipt

ActionReceipt 记录工具、Domain 或 Provider 对 action 的结果：

```text
ActionReceipt
├── action_ref
├── command / provider operation ref
├── idempotency key
├── accepted / rejected / unknown
├── domain event refs[]
├── provider receipt ref
├── affected aggregate version
├── side effect summary
├── reconciliation status
├── compensation ref
└── verified_at
```

`accepted` 不是 `completed`；只有 Domain truth、Provider reconciliation 或 human verification 允许把结果标为 completed。

## 2.17 HumanHandoff

HumanHandoff 让人可以接管而不需要重新理解整段上下文。

```text
HumanHandoff
├── run_ref / case_ref
├── reason
├── uncertainty / blocked condition
├── user intent summary
├── evidence refs
├── actions attempted
├── actions not attempted
├── recommended next step
├── required role
├── SLA
├── sensitive data boundary
├── user communication state
└── handoff status
```

## 2.18 AutomationBudget / AutomationRateLimit

预算不只包括钱，也包括：

- tool calls；
- workflow steps；
- notifications；
- provider requests；
- user contact attempts；
- resource exposure；
- retry / compensation attempts；
- time and concurrency；
- model tokens / retrieval size；
- financial or operational exposure。

## 2.19 AgentIncident

以下情况必须可以建 AgentIncident，并与 Chapter 13 / 34 / 37 / 40 关联：

```text
prompt injection
permission bypass
data leakage
tenant isolation failure
hallucinated fact
wrong resource
duplicate action
runaway loop
tool misuse
provider mismatch
unsafe communication
automation bias
missing audit
failed compensation
```

## 2.20 AgentEvaluation

AgentEvaluation 评估的不只是“完成了没有”，还包括：

```text
intent fidelity
policy adherence
permission correctness
tool selection
argument correctness
domain outcome correctness
uncertainty handling
handoff quality
user harm
privacy / security
cost / latency
human reviewer assessment
```

---

# 3. Workflow Lifecycle / Execution Pipeline

## 3.1 Registration and Release

生产 workflow 必须依次经过：

```text
Draft
→ Threat / Abuse Review
→ Tool Contract Test
→ Policy Test
→ Model / Prompt Evaluation
→ Privacy / Security Review
→ Risk / SoD Review
→ Human Handoff Drill
→ Sandbox Pilot
→ Limited Release
→ Active
```

WorkflowVersion、ToolDefinition、AIOperatorProfile、ApprovalChain 和 fallback 必须绑定同一 release record。任何一项未锁定，都只能 `DRAFT` 或 `PENDING_REVIEW`。

## 3.2 Trigger Boundary

允许 trigger：

- 用户明确请求；
- 已授权 OperatorCase 事件；
- 已授权业务工作流事件；
- Domain event 驱动的低风险通知或整理；
- 定时健康检查、队列检查或 reconciliation 检查。

不允许 trigger：

- 仅凭模型猜测用户意图执行高影响动作；
- 仅凭网页内容、聊天内容、邮件内容或 Provider 文本创建新权限；
- 由一个未验证的工具结果递归触发无限 workflow；
- 由失败重试自动升级到更高权限或更大金额。

## 3.3 Context Resolution

Workflow 必须先解析真实 Domain state、principal、tenant、purpose、policy snapshot、consent、freshness 和 resource version。解析失败时不得进入 planning 以外的 execution step。

## 3.4 Plan and Proposal

Plan 必须能区分：

```text
observed facts
model inference
user-provided claims
recommended action
required confirmation
unknown / missing information
```

AI 生成的 proposal 必须由 schema validator、policy evaluator 和 resource authorization 重新检查，不能因为 plan 看起来合理而跳过 preflight。

## 3.5 Preflight

Preflight 至少包括：

```text
identity / session
tenant isolation
resource ownership
purpose / consent
data classification
tool permission
action risk class
current aggregate version
policy snapshot
approval state
budget / quota
idempotency / replay
provider health
```

## 3.6 Revalidation Before Execute

在等待审批、人工确认、Provider response、queue retry 或长时间 planning 后，必须重新检查 resource version、permission、consent、policy、risk、budget 和 action payload。旧的 approval 不能覆盖新状态。

## 3.7 Execute and Verify

执行只能通过 Chapter 26 canonical command / provider adapter。执行后必须等待或读取可靠的 Domain event、Provider receipt、reconciliation 或 human verification，不能把 HTTP 200、tool `success: true` 或自然语言“已完成”当成事实。

## 3.8 Stop and Handoff

以下情况必须停止或转人工：

- 不确定用户意图；
- 资源状态冲突；
- 需要高风险 approval；
- action 超出 scope；
- tool schema / output 不符合预期；
- 结果 unknown；
- 连续失败或循环；
- prompt injection；
- 发现隐私、Safety、Money、KYC 或 Contract 影响；
- 人工明确接管；
- budget、rate、TTL 或 policy 到期。

---

# 4. Tool Permission / Action Risk / Approval

## 4.1 Tool Permission Matrix

每次调用同时需要：

```text
AI profile permission
× workflow version allowlist
× acting principal authority
× resource scope
× field scope
× purpose scope
× policy snapshot
× action risk gate
```

任何一项为空、过期、冲突或无法解释时，结果必须 DENY 或 HUMAN_REVIEW。

## 4.2 Action Risk Classes

| Class | 示例 | 默认审批 |
|---|---|---|
| R0 | 只读检索、内部摘要、字段格式化 | 无额外审批，但需读权限 |
| R1 | 生成草稿、生成运营问题、更新非事实型队列标签 | 可在已批准 workflow 内执行 |
| R2 | 发送已批准模板通知、创建 OperatorCase、安排可逆内部任务 | principal confirmation 或 policy approval |
| R3 | 改变 Task / Slot / Order 的可逆业务状态、发起 replacement / escalation | Domain owner / Operator approval |
| R4 | Payment、Payout、KYC、Safety、Privacy、Contract、Tax、Ledger、Account closure、跨租户 | human-only / Domain-owned；AI 不可自主执行 |
| R5 | 绕过权限、任意代码、删除审计、秘密提取、伪造事实、不可审计动作 | PROHIBITED |

同一 tool 在不同 resource、market、tenant、amount、data class 或 workflow 下可以属于不同 risk class，不能只按 tool name 判断。

## 4.3 Approval Modes

```text
NONE
POLICY_APPROVAL
REQUESTER_CONFIRMATION
OPERATOR_APPROVAL
DOMAIN_OWNER_APPROVAL
DUAL_CONTROL
HUMAN_ONLY
PROHIBITED
```

Approval 必须说明：谁批准、批准什么、作用于哪个 proposal、有效多久、可执行几次、金额/资源上限、是否可撤销、执行后如何验证。

## 4.4 Two-person Control

以下至少需要 dual control：

- 资金流、退款、payout、manual adjustment 或 financial exposure；
- KYC / identity override；
- Safety protective action 的解除或重大升级；
- D4 / D5 数据导出、批量访问或跨租户访问；
- Contract、Tax、Market、LegalEntity 或 Account closure；
- 任何会改变 audit、retention、legal hold 或 compliance evidence 的动作。

AI 可以整理材料、生成 preview、提出 proposal，但不计入第二名控制人。

## 4.5 User Confirmation

用户确认必须展示：

```text
target
action
material fields
side effects
amount / exposure
audience / recipients
expiry
reversibility
what AI did not do
```

默认不能用模糊的“继续”“好的”“自动处理”确认多项不同风险动作；确认 scope 变化时必须重新确认。

---

# 5. Action Sandbox / Preview / Irreversibility

## 5.1 Preview Before Mutation

R2 及以上动作在执行前必须尽可能生成 preview：

- target aggregate 和当前 version；
- proposed state transition；
- policy decision 和 reason code；
- affected users / business / provider；
- notification、money、privacy、safety 和 audit impact；
- expected Domain events；
- rollback / compensation path；
- unresolved uncertainty。

## 5.2 Dry-run Is Not Fake Production

Sandbox、simulation、replay 和 preview 不得：

- 发送真实外部通知；
- 创建真实 Payment / Payout；
- 改写真实 Ledger；
- 触发真实 KYC / Safety / Contract state；
- 消耗真实优惠、库存、配额或资金；
- 让 Provider 误以为已完成交易。

## 5.3 Reversible / Compensatable / Irreversible

每个 DelegatedAction 必须声明：

```text
REVERSIBLE
COMPENSATABLE
IRREVERSIBLE
UNKNOWN
```

`UNKNOWN` 不得自动执行。`IRREVERSIBLE` 默认 human-only。`REVERSIBLE` 也必须考虑通知已经发送、数据已经暴露、Provider 已收费、用户已依赖或业务机会已丢失等实际不可逆影响。

## 5.4 Action Diff

Action diff 必须来自 typed Domain state，而不是只比较自然语言。对金额、收件人、用户、地址、时间、权限、隐私字段、Safety status 和 contract term 的任何变化都视为 material change。

## 5.5 Compensation

失败恢复必须区分：

```text
not started
accepted but not confirmed
partially applied
provider unknown
domain applied
notification sent
compensation available
manual reconciliation required
```

Compensation 不能自动假设与原 action 对称；涉及 money、Safety、KYC、privacy 或 contract 时必须由所属 Domain / Operator / human owner 决定。

---

# 6. Human Handoff / Operator Integration

## 6.1 OperatorCase Integration

Agentic workflow 遇到阻塞、风险、申诉、异常、超时或需要判断时，必须创建或更新 Chapter 18 `OperatorCase`，而不是在 AI 内部无限重试。

OperatorCase 至少引用：

```text
workflow_run
command_proposal
tool_invocations
decision trace
model / prompt / retrieval refs
policy snapshot
evidence refs
attempted actions
blocked actions
required team
SLA
```

## 6.2 Human Handoff Quality

接管人必须能够回答：

- 用户要完成什么；
- AI 观察到什么事实；
- 哪些是推断而非事实；
- AI 已经调用了什么；
- 哪些动作尚未执行；
- 当前最危险或最紧急的风险是什么；
- 接管人拥有什么权限；
- 下一步需要什么 evidence / confirmation；
- 如果不处理会发生什么；
- 如何安全关闭 workflow。

## 6.3 Human Can Stop the Run

Operator、requester、Domain owner 或 incident responder 在权限范围内可以：

```text
PAUSE
CANCEL
REVOKE_DELEGATION
DISABLE_TOOL
SUSPEND_PROFILE
FORCE_HANDOFF
OPEN_INCIDENT
```

停止必须阻止新的 tool call；对已经发出的 Provider / Domain operation，必须进入 unknown / reconciliation / compensation 流程。

## 6.4 No Impersonation

AI 不得伪装成真人 Operator、Requester 或 Agent 与用户沟通。对外通信必须清楚标注自动化身份、可转人工入口、事实来源和无法确认的内容。

AI 不得以“我是你的专属运营”“我已经人工确认”“我代表 Proxy 承诺”创造不真实 authority。

## 6.5 Operator Permission Still Applies

Operator screen 有一个按钮，不代表 AI 可以调用对应动作；Operator permission 有一个 action，也不代表 AI profile 有同样权限。两者必须分别通过 OperatorAccessPolicy、ToolPermission、DelegationGrant 和 Domain command authorization。

---

# 7. Communication / User Trust / External Effects

## 7.1 Draft Before Send

默认情况下，AI 可以生成通知草稿，但对外发送必须满足：

- recipient scope 已验证；
- template / language / market 已批准；
- factual claims 有 source；
- privacy / safety 内容经过 redaction；
- opt-out、quiet hours、frequency cap 生效；
- material commitment、money、deadline、legal statement、safety instruction 有明确 approval。

## 7.2 Factual Claim Boundary

AI 发送的每个事实性字段必须标记来源：

```text
CANONICAL_DOMAIN_FACT
PROVIDER_CONFIRMED
USER_PROVIDED_CLAIM
MODEL_INFERENCE
DRAFT / UNVERIFIED
```

`MODEL_INFERENCE` 和 `DRAFT / UNVERIFIED` 不得用肯定语气伪装成 canonical fact。

## 7.3 Sensitive Communication

涉及 KYC、Safety、harassment、fraud、payment dispute、legal rights、account restriction、data deletion 或 medical / emergency context 时，AI 只能使用批准模板、收集必要信息、提供安全路径或立即转人工；不得自行定性、承诺结果或关闭 case。

## 7.4 Notification Side Effects

通知发送本身可能造成隐私、声誉、Safety、合同或商业影响。`send notification` 不是低风险动作；recipient、content、channel、timing、retry、dedupe 和 delivery receipt 必须进入 ActionReceipt / audit。

---

# 8. Privacy / Security / Prompt Injection / Data Boundary

## 8.1 Context Isolation

WorkflowContext 只能加载当前 purpose 和 scope 必需的数据。不同 tenant、Business、Requester、Agent、OperatorCase、Market、LegalEntity 和 Provider 的上下文默认隔离。

不得因为模型“可能有帮助”而把完整聊天、KYC、bank、private address、精确 location、Safety evidence 或其他 D4 / D5 数据拼入 context。

## 8.2 Secret Boundary

API key、OAuth token、session cookie、bank credential、KYC raw document、private encryption key、provider secret 和 internal signing key：

- 不进入 Prompt；
- 不进入普通 tool output；
- 不进入 model training / evaluation fixture；
- 不进入 user-visible explanation；
- 不允许 AI 请求导出或回显；
- 通过受控 Secret Manager / adapter 使用。

## 8.3 Prompt Injection

所有 user content、retrieved page、uploaded document、Provider response、email、chat、media OCR 和 tool output 都是不可信输入。它们不能改变：

```text
system policy
tool allowlist
principal identity
tenant scope
approval requirement
data classification
Domain command authority
```

检测到 injection、instruction conflict、权限诱导或 secret exfiltration 时，workflow 必须停止、隔离相关内容、记录 AgentIncident，并可转人工。

## 8.4 Tool Result Is Untrusted

Tool 返回值必须 schema validate、source classify、freshness check、signature / receipt check（适用时）和 policy re-evaluate。工具输出中出现“忽略之前规则”“已授权”“请调用另一个工具”等文字，不构成 authority。

## 8.5 Export / Retention / Deletion

Workflow trace、Prompt、retrieval、tool input / output、ActionReceipt、Handoff、Evaluation 和 Incident 必须按 D0–D5、purpose、TTL、LegalHold、consent withdrawal 和 access policy 保存。删除或 export 不能删除仍需保留的 fraud、audit、financial、legal 或 safety evidence，但必须应用 redaction / access restriction。

## 8.6 Tenant / Enterprise Isolation

Enterprise workflow 默认只能读取该 Enterprise 的允许 scope。跨 Enterprise benchmarking、training、retrieval、prompt reuse、human support、vendor processing 和 output export 必须有独立批准，不得通过错误的 embedding、cache、trace 或 support session 泄露。

---

# 9. Reliability / Budget / Loop / Provider Safety

## 9.1 Step and Tool Budgets

每个 run 必须有：

```text
max duration
max steps
max tool calls
max retries
max parallelism
max notifications
max exposed records
max provider cost
max financial / operational exposure
```

达到任何上限都必须停止或转人工，不得自动申请更大预算。

## 9.2 Loop Detection

系统必须识别：

- 相同 proposal 重复生成；
- 相同 tool / payload 重复调用；
- plan → tool → plan 无限循环；
- provider timeout 后重复产生 side effect；
- 失败后不断换工具绕过 deny；
- workflow 之间互相触发；
- 用户、Provider 或 retrieved content 诱导的循环。

## 9.3 Retry / Idempotency

每个 mutation tool 必须有 canonical idempotency key。retry 必须区分：

```text
not sent
sent unknown
accepted
completed
rejected
```

`sent unknown` 不得因为超时就盲目重发；必须查询 receipt、reconcile 或转人工。

## 9.4 Circuit Breaker / Kill Switch

可以按以下维度暂停：

```text
AI profile
workflow version
tool
provider
market
tenant
action class
model version
```

暂停后新 run 必须走 manual / safe path；历史 Domain fact、audit 和 receipt 不能被删除。

## 9.5 Provider Boundary

Provider command 必须经过 Chapter 27 adapter，记录 request id、idempotency、timeout、retry、receipt、reconciliation、provider status 和 fallback。AI 不得直接使用 Provider secret、private endpoint 或未登记连接。

## 9.6 Degraded Mode

当模型、retrieval、tool、Provider、Policy service 或 audit service degraded 时，系统必须选择显式路径：

```text
READ_ONLY
DRAFT_ONLY
MANUAL_REVIEW
SAFE_PENDING
RULE_BASED_FALLBACK
DISABLED
```

不能默默放宽权限或改成最宽松的 allow。

---

# 10. Observability / Audit / Incident / Evaluation

## 10.1 Required Trace

每个 run 至少可关联：

```text
correlation id
principal
tenant / resource
workflow version
model / prompt / retrieval refs
policy snapshot
input / output classification
tool permission decision
approval refs
tool invocation refs
command proposal
domain command / provider operation
events / receipts
human handoff
budget / latency
termination reason
```

Trace 不等于 chain-of-thought。系统应保存可审计的 decision factors、source、reason code、tool calls 和 outcome，而不是向不适当的受众暴露完整内部思考过程或秘密。

## 10.2 Audit Is Append-only

以下事实不能由 AI、Operator 或 Workflow 删除、覆盖或静默重写：

- 谁触发；
- 以谁的 authority 运行；
- 使用哪个 profile / model / workflow version；
- 读了哪些数据类别；
- 请求过哪些 tool；
- 哪些被 deny；
- 谁批准；
- 哪个 command 被执行；
- Provider / Domain 返回了什么结果；
- 谁暂停、回滚、接管或补偿。

## 10.3 Incident Response

AgentIncident 发生后应：

```text
detect
→ pause / revoke / isolate
→ classify impact
→ preserve evidence
→ notify owner / operator / privacy / security / risk
→ review affected actions
→ reconcile domain / provider state
→ compensate or correct
→ communicate where required
→ remediate and re-test
→ close with accountable owner
```

## 10.4 Affected Decision Review

模型或 workflow 事件必须回溯受影响的：

- User / Business communication；
- Task / Slot / Match / Offer / Order；
- Payment / Payout / Refund / Ledger；
- Safety / Risk / KYC / Privacy；
- Contract / Enterprise / Market / Tax；
- Provider operation；
- OperatorCase、audit、report 和 compliance evidence。

回溯结果由所属 Domain 产生 correction、reversal、appeal、notice 或 restatement，不由 AI 自己“修正事实”。

## 10.5 Evaluation in Production

AgentEvaluation 必须抽样检查：

- 是否准确理解用户 intent；
- 是否只读取允许字段；
- 是否正确选择工具；
- 是否在 deny / uncertainty 时停止；
- 是否遵守 approval chain；
- 是否错误扩大动作 scope；
- 是否造成 automation bias 或用户误解；
- 是否正确 handoff；
- 是否产生未预期 side effect。

上线后的成功率不得只统计 `workflow_status = SUCCEEDED`，还要检查 Domain outcome、用户结果、申诉、incident、人工纠正和隐性 harm。

---

# 11. Governance / Ownership / SoD

## 11.1 Roles

```text
AI Product Owner
Workflow Owner
Tool Owner
Model Owner
Domain Owner
Operator / Human Reviewer
Privacy Owner
Security Owner
Model Risk Reviewer
Finance / Treasury Owner
Safety Owner
Vendor Owner
Auditor / Compliance
```

一个人或一个 AI profile 不得同时拥有 proposal、approval、execution、reconciliation 和 closure 的全部权限。

## 11.2 Ownership Rules

- AI Product Owner：使用目的、用户体验、成功标准和禁用标准；
- Workflow Owner：步骤、停止条件、handoff、预算和版本；
- Tool Owner：schema、side effect、adapter、timeout、audit 和安全；
- Domain Owner：业务状态、命令、Invariant 和 outcome；
- Model Owner：模型、Prompt、Retrieval、evaluation、drift 和 rollback；
- Privacy / Security：数据、秘密、访问、供应商和 incident boundary；
- Risk / Compliance：risk tier、SoD、review、exception 和 reporting；
- Human Reviewer：具体复核、evidence、判断、申诉和记录；
- Auditor：独立检查，不替代 owner 作运营决定。

## 11.3 Emergency / Break-glass

Break-glass 只用于安全、服务恢复或重大运营事件：

- 必须有原因、范围、TTL、负责人、后续 review；
- 不能授予 AI 永久权限；
- 不能删除或修改原始 audit；
- 不能绕过 KYC、Safety、Money、Privacy、Ledger、Legal 的不可逆 gate；
- 事后必须进行 independent review 和必要的用户 / 监管通知。

## 11.4 Exception Governance

任何想放宽本章规则的 exception 必须绑定：

```text
business justification
affected users / markets / tenants
risk assessment
compensating controls
expiry
owner
approval chain
monitoring
rollback / exit
```

“这是内部工具”“这是 beta”“这是 AI demo”“这是 Provider 要求”不构成 exception 理由。

---

# 12. API / Command / Event Contract

## 12.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `RegisterAIOperatorProfile` | AI Product / Governance | 登记 AI capability 与 scope |
| `CreateWorkflowDefinition` | Workflow Owner | 创建工作流定义 |
| `ReleaseWorkflowVersion` | Workflow / Risk / Engineering | 发布不可变 workflow 版本 |
| `RegisterToolDefinition` | Tool Owner | 登记 schema、scope 与 side effect |
| `GrantToolPermission` | Authorized Owner | 授予受限 tool permission |
| `CreateDelegationGrant` | Principal / Domain Owner | 创建短期委托 |
| `StartWorkflowRun` | Runtime | 创建并解析执行上下文 |
| `CreateCommandProposal` | Runtime | 创建 typed proposal |
| `CreateActionPreview` | Runtime / Sandbox | 生成影响与 diff 预览 |
| `RequestActionApproval` | Runtime | 发起 approval chain |
| `ApproveDelegatedAction` | Authorized Human / Policy | 批准具体 proposal |
| `ExecuteDelegatedAction` | Domain Runtime | 调用 canonical command |
| `VerifyActionOutcome` | Domain / Reconciliation | 验证 Domain / Provider 结果 |
| `PauseWorkflowRun` | Operator / Owner | 暂停 run |
| `RevokeDelegation` | Grantor / Owner | 撤销委托 |
| `ForceHumanHandoff` | Operator / System | 转人工 |
| `RecordActionReceipt` | Domain / Provider Adapter | 保存可靠 receipt |
| `OpenAgentIncident` | Incident / Security / Runtime | 创建 AI agent 事件 |
| `SuspendTool` | Tool / Security Owner | 关闭工具 |
| `SuspendWorkflowVersion` | Workflow / Risk Owner | 关闭版本 |
| `EvaluateAgentRun` | Evaluator / QA | 记录质量与风险评估 |
| `CompensateDelegatedAction` | Domain Owner | 按 Domain 流程补偿 |

## 12.2 P0 Events

```text
AIOperatorProfileRegistered
AIOperatorProfileApproved
AIOperatorProfileSuspended
WorkflowDefinitionCreated
WorkflowVersionReleased
WorkflowVersionPaused
ToolDefinitionRegistered
ToolPermissionGranted
ToolPermissionRevoked
DelegationGrantCreated
DelegationGrantExpired
WorkflowRunStarted
WorkflowRunBlocked
CommandProposalCreated
ActionPreviewCreated
ActionApprovalRequested
ActionApproved
ActionRejected
ToolInvocationDenied
ToolInvocationStarted
ToolInvocationCompleted
DelegatedActionExecuting
DelegatedActionSucceeded
DelegatedActionFailed
ActionOutcomeUnknown
ActionReceiptRecorded
HumanHandoffCreated
WorkflowRunPaused
WorkflowRunCancelled
AgentIncidentOpened
ToolSuspended
WorkflowVersionSuspended
CompensationRequired
CompensationCompleted
AgentRunEvaluated
```

事件只能说明 profile、workflow、tool、run、proposal、action、resource reference、risk、status、reason、receipt reference 和 metrics summary。禁止把 secret、raw D5、完整 Prompt、未脱敏用户原文或 chain-of-thought 写入普通事件。

## 12.3 Downstream Boundary

Chapter 41 可以驱动：

- Chapter 18 OperatorCase、Queue、Handoff、Case routing；
- Chapter 23 Policy evaluation、Guardrail、Config snapshot；
- Chapter 25 E2E test、invariant gate、contract test；
- Chapter 26 Command、Event、Outbox、Provider adapter、reconciliation；
- Chapter 34 Compliance evidence、Audit、Trust center；
- Chapter 37 Risk、SoD、Board report；
- Chapter 40 Model / Vendor / Incident / Evaluation。

Chapter 41 不得未经所属 Domain command 直接改变：

```text
UserAccount / Identity / KYC
Safety / Risk / Incident resolution
Task / Slot / Order canonical truth
Payment / Payout / Refund / Ledger / Tax / Invoice
Contract / LegalEntity / Market approval
Consent / Retention / LegalHold / Audit
```

---

# 13. Acceptance Criteria

## AC-41-01 — AI Actor Registration

所有 production AI assistant、Operator copilot、agentic workflow、Prompt chain、RAG tool runner、third-party agent 和 automation script 都必须登记 AIOperatorProfile，包含 owner、use tier、intended use、prohibited use、model / prompt / retrieval、scope、oversight、expiry 和 approval。

## AC-41-02 — Workflow Version Immutability

ACTIVE workflow 必须绑定不可变 WorkflowVersion；steps、tools、prompts、models、retrieval、policy、approval、budget、fallback 或 stop condition 发生语义变化时必须产生新版本并重新 release。

## AC-41-03 — Real Principal Binding

每个 WorkflowRun、ToolInvocation、CommandProposal 和 DelegatedAction 都必须绑定真实 requesting / acting principal、tenant、purpose、scope、policy snapshot 和 correlation id；AI 不能成为无主 action 的 authority。

## AC-41-04 — Context Minimization

WorkflowContext 只能包含当前 purpose、resource 和 step 必需的数据，必须执行 D0–D5、consent、retention、redaction、tenant isolation 和 freshness checks；模型“可能需要”不是访问理由。

## AC-41-05 — Plan / Proposal / Command Separation

AI plan、自然语言建议和 CommandProposal 不得直接产生 Domain event；只有经过 typed schema、permission、policy、approval、revalidation 和 canonical Domain Command 的调用才可改变 aggregate。

## AC-41-06 — Tool Allowlist

生产 workflow 只能调用登记的 ToolDefinition；未登记工具、arbitrary URL、arbitrary SQL、shell、未批准 code execution、任意 Provider SDK 或动态生成的 mutation tool 必须被拒绝并记录 audit。

## AC-41-07 — Field-level Permission

ToolPermission 必须限制 tenant、resource、field、action、purpose、market、time、call count 和 exposure；读权限不能推导写权限，读取一个对象不能推导读取关联对象或其他 tenant。

## AC-41-08 — Permission Preflight

每次 tool call 前必须执行 principal、tenant、resource、purpose、data class、policy、risk、budget、expiry、aggregate version、idempotency 和 provider health preflight；任一项 UNKNOWN / CONFLICT / EXPIRED 时必须 DENY 或转人工。

## AC-41-09 — Action Risk Classification

每个 DelegatedAction 必须有 R0–R5 risk class，并根据 resource、amount、recipient、data class、market、tenant、side effect 和 reversibility 动态重评；不能只按工具名称判定风险。

## AC-41-10 — Approval Scope Binding

ApprovalRequest 必须绑定确定的 proposal hash、workflow version、target、payload、amount / exposure、risk、policy snapshot、approver、expiry、次数和验证方式；这些字段变化时必须重新审批。

## AC-41-11 — Dual Control

资金、身份、Safety、D4 / D5、Contract、Tax、Ledger、Account closure、Market / LegalEntity、Audit / LegalHold 相关动作必须 dual control 或 human-only；AI、模型、workflow 和自动规则不能计为第二控制人。

## AC-41-12 — User Confirmation Transparency

需要用户确认的动作必须展示 target、action、material fields、side effects、amount / exposure、recipients、expiry、reversibility 和 AI 未执行事项；模糊确认不能覆盖多个不同风险动作。

## AC-41-13 — Sandbox Preview

R2 及以上动作在执行前必须生成 sandbox / dry-run preview，包含当前 version、state diff、policy reason、affected parties、expected events、notification / money / privacy / safety impact、uncertainty 和 compensation path。

## AC-41-14 — No Real Side Effects in Sandbox

Simulation、replay、preview 和 sandbox 不得发送真实通知、创建真实 Payment / Payout、改 Ledger、触发 KYC / Safety / Contract state、消耗真实优惠或使 Provider 误以为交易已完成。

## AC-41-15 — Irreversibility Gate

每个 action 必须声明 REVERSIBLE、COMPENSATABLE、IRREVERSIBLE 或 UNKNOWN；UNKNOWN 不得自动执行，IRREVERSIBLE 默认 human-only，REVERSIBLE 也必须评估通知、隐私、Provider、用户依赖和声誉等实际不可逆影响。

## AC-41-16 — Revalidation Before Execute

等待 approval、human confirmation、queue retry、Provider response 或超过 freshness window 后，必须重新校验 resource version、permission、consent、policy、risk、budget、payload 和 idempotency；旧 approval 不能覆盖新状态。

## AC-41-17 — Canonical Command Only

DelegatedAction 必须映射到 Chapter 26 已登记的 canonical Domain Command 或 Provider adapter operation，包含 target aggregate、typed payload、idempotency key、owner、policy snapshot 和 expected result；禁止直接 table write 或状态 PATCH。

## AC-41-18 — High-risk Human-only Boundary

AI 不得 autonomous mutation KYC / AML / Sanctions final decision、Safety action、Payment / Payout、Ledger、Account closure、D4 / D5 export、Contract acceptance、Tax filing、Market activation 或 LegalEntity action；只能准备材料、生成 proposal、请求审批或转人工。

## AC-41-19 — Action Receipt Integrity

每个 mutation tool、Domain command 和 Provider operation 都必须生成 ActionReceipt，区分 accepted、rejected、unknown、completed、reconciled 和 compensated；HTTP 200、tool success 或自然语言确认不能单独证明业务完成。

## AC-41-20 — Idempotency and Replay Safety

所有 mutation action 必须有稳定 idempotency key、dedupe record 和 replay policy；`sent unknown` 不得盲目重发，必须查询 receipt、执行 reconciliation 或转人工。

## AC-41-21 — Loop and Budget Control

每次 run 必须有 duration、step、tool、retry、parallelism、notification、record exposure、provider cost、token / retrieval、financial exposure 和 compensation budget；循环、预算耗尽或重复 proposal 必须停止或 handoff。

## AC-41-22 — Kill Switch

授权 Operator / Owner / Incident responder 必须可以按 profile、workflow version、tool、provider、market、tenant、model 或 action class 执行 pause、revoke、disable、force handoff 和 open incident；暂停后不得产生新的 tool call。

## AC-41-23 — Prompt Injection Defense

User content、retrieved text、uploaded document、Provider output、email、chat、OCR、media 和 tool result 必须视为不可信输入，不能修改 system policy、principal、tenant、tool allowlist、approval requirement、data class 或 Domain authority。

## AC-41-24 — Secret and D5 Exclusion

Secret、OAuth token、session cookie、bank credential、raw KYC、private key、未脱敏 D5 和不必要的 private content 不得进入 Prompt、普通 tool output、model fixture、user explanation 或普通 audit；必须通过受控 adapter / secret boundary 使用。

## AC-41-25 — Tool Result Validation

Tool output 必须 schema validate、source classify、freshness check、signature / receipt check（适用时）并重新执行 policy；tool 返回的“已授权”“忽略规则”或“已完成”文字不构成 permission、Domain fact 或 completion proof。

## AC-41-26 — Human Handoff Completeness

触发 uncertainty、high risk、scope conflict、tool failure、unknown result、loop、injection、appeal、incident 或 SLA 时，系统必须创建 OperatorCase / HumanHandoff，包含 intent、facts、inferences、attempts、not attempted、evidence、risk、required role、SLA 和 safe next step。

## AC-41-27 — Human Can Stop and Revoke

有权限的 Operator、requester、Domain owner 或 incident responder 必须能暂停 run、撤销 delegation、禁用 tool、强制 handoff 或取消后续 action；已发出的 operation 必须进入 unknown、reconciliation 或 compensation 流程。

## AC-41-28 — No Impersonation

AI 对外沟通必须披露自动化身份、事实来源、未确认内容和人工入口；不得声称自己是人工 Operator、已经人工确认、代表 Proxy 承诺或拥有超出真实 principal / policy 的 authority。

## AC-41-29 — Communication Approval

对外通知必须验证 recipient、template、language、market、factual source、redaction、opt-out、quiet hours、frequency cap、delivery dedupe 和 material claim approval；发送动作必须有 receipt 和 audit。

## AC-41-30 — Tenant and Enterprise Isolation

Enterprise、Business、Market、LegalEntity 和 support context 必须隔离；cross-tenant retrieval、benchmark、training、cache、human support、vendor processing 或 export 必须有独立授权，不能由 embedding、trace 或 workflow memory 旁路泄露。

## AC-41-31 — Provider Adapter Boundary

AI 不得直接使用 Provider credential、private endpoint 或未登记 SDK；Provider action 必须通过 Chapter 27 adapter，具备 timeout、retry、idempotency、receipt、reconciliation、fallback 和 vendor change governance。

## AC-41-32 — Degraded Mode

模型、retrieval、tool、Provider、Policy 或 audit service degraded 时，系统必须切换到 READ_ONLY、DRAFT_ONLY、MANUAL_REVIEW、SAFE_PENDING、RULE_BASED_FALLBACK 或 DISABLED，并明确记录原因；不得静默放宽 permission 或改成最宽松 allow。

## AC-41-33 — Append-only Audit

系统必须保留 trigger、principal、tenant、profile、model / prompt / workflow version、data class、tool request / deny、approval、command、Provider / Domain result、receipt、pause、handoff、rollback、compensation 和 closure；AI 与 Operator 不能删除或覆盖原始审计。

## AC-41-34 — Agent Incident and Impact Review

Prompt injection、permission bypass、data leakage、wrong resource、duplicate action、runaway、unsafe communication、missing audit、failed compensation 或 provider mismatch 必须创建 AgentIncident，并回溯影响的 Order、Money、KYC、Safety、Privacy、Contract、Provider、Report 和 Audit。

## AC-41-35 — Production Evaluation

AgentEvaluation 必须抽样评估 intent fidelity、permission correctness、tool choice / arguments、policy adherence、uncertainty、handoff、privacy、security、cost、latency、user harm 和 Domain outcome；不能只用 workflow success rate 作为上线质量指标。

## AC-41-36 — No Fabricated Completion

系统不得因为 AI plan、model confidence、tool success、approval、ActionReceipt accepted、human suggestion、Provider 文字或 workflow SUCCEEDED 自动生成 KYC verified、Safety resolved、Payment success、Payout paid、Ledger balance、Tax filed、Contract accepted、Account closed 或 Market active 事实。

---

# 14. P0 / P1 Boundary

## 14.1 P0

- AIOperatorProfile、WorkflowDefinition、WorkflowVersion、WorkflowContext、WorkflowRun、WorkflowStep；
- ToolDefinition、ToolPermission、ToolInvocation、DelegationGrant；
- CommandProposal、ApprovalRequest、ApprovalChain、ActionSandbox、DelegatedAction、ActionReceipt；
- HumanHandoff、OperatorCase integration、AutomationBudget、AutomationRateLimit、AgentIncident、AgentEvaluation；
- plan / proposal / command / event separation；
- deterministic preflight、risk tier、human-only boundary、dual control、revalidation、idempotency、receipt、reconciliation；
- prompt injection、secret、D4 / D5、tenant isolation、provider adapter 和 degraded mode；
- pause、revoke、kill switch、handoff、incident、audit 和 outcome verification；
- 36 项 AC-41 验收标准。

## 14.2 P1

- 多步 workflow visual builder；
- workflow simulation / replay UI；
- policy-aware plan comparison；
- 自动生成 human handoff summary；
- tool quality benchmark；
- agent workload analytics；
- approval queue prioritization assistant；
- synthetic adversarial agent test corpus；
- cross-workflow dependency graph；
- automatic compensation recommendation；
- multi-model planner / verifier ensemble；
- natural-language workflow authoring。

P1 不能改变 P0 的 principal binding、least privilege、tool allowlist、human-only action、Domain command、approval、revalidation、audit、privacy、Safety、Money、KYC、Ledger、Contract、Tax 或 tenant boundary。

---

# 15. Locked Conclusions / Implementation Handoff

本章锁定：

```text
AI 是受限 capability，不是新的 UserAccount / Operator / Business principal
Workflow plan 不是 Domain command
Command proposal 不是 Domain event
Tool result 不是 Source-of-truth fact
所有 mutation 必须有 allowlist、typed schema、permission、policy、idempotency 和 receipt
高风险、不可逆、资金、身份、安全、隐私、合同、税务、Ledger 和跨租户动作必须 human-only 或 Domain-owned
Approval 只对确定的 proposal、scope、payload、version 和期限有效
Sandbox / Preview 不得产生真实 side effect
Unknown、冲突、过期、注入、循环、预算耗尽和 Provider timeout 必须停止或转人工
AI 对外沟通不能冒充人工或伪造 completion
暂停、回滚、补偿只能停止或修复未来行为，不能删除历史 Domain fact、receipt、trace 或 audit
```

本章完成后，Proxy 的 PRD 进入 implementation handoff：

```text
Canonical Registry
→ Screen / Surface Contract
→ Launch Catalog
→ Policy Defaults
→ API / Event / Provider Contract
→ E2E / Invariant / Contract Tests
→ AI / Tool / Approval Safety Tests
→ Pilot Operations
→ Launch Readiness
```

下一阶段不再默认新增横向业务 PRD；任何新的对象、状态、permission、command、event、policy 或 AI action 都必须先回到 Canonical Registry 和本章边界评审。

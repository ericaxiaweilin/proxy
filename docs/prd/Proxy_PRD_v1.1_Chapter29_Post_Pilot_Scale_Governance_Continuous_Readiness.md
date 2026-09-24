# Proxy PRD v1.1
## Chapter 29 — Post-Pilot Scale / Governance / Continuous Readiness

**文档类型**：规模化准入 / Marketplace Governance / SLO / Continuous Readiness / Multi-market Expansion  
**状态**：ACTIVE — Scale Governance v1  
**前置依赖**：Canonical Registry、Chapter 19、Chapter 20、Chapter 23、Chapter 25–28、PostPilotReview  
**后续依赖**：Chapter 30 Scale Architecture / Capacity / FinOps / Multi-Region Readiness、持续 Legal / Provider / Market Review

---

# 0. 本章目标

Pilot 结束后，系统不能从“有限流量安全”直接跳到“无限规模”。本章定义：

```
Pilot exit
Scale readiness scorecard
Transaction / Execution / Liquidity / Economics / Repeat / Safety / Operator gates
SLO / Error Budget
Continuous Provider / Legal / Policy review
Change governance
Experiment governance
Multi-market expansion
Capacity and support readiness
Pause / rollback / retire at scale
```

本章不替代 Chapter 25 的 Invariant，也不降低 Chapter 27 的市场审批和 Chapter 28 的运行门禁。它的作用是把一次性 Launch Gate 变成持续有效的准入系统。

核心原则：

```
Scale is earned, not assumed
one metric never authorizes scale
P0 safety / money / privacy failures override growth metrics
market expansion is a new approval, not a copy operation
every change has an owner, version, blast radius and rollback
readiness expires and must be renewed
```

---

# 1. Scale Constitution

## 1.1 Scale 不是单一开关

Scale 由以下维度共同决定：

```
Domain integrity
Execution quality
Marketplace liquidity
Agent economics
Requester value / repeat
Safety / Privacy / Security
Operator capacity
Provider health
Market legal / tax / KYC validity
```

任一关键维度未达标时，允许：

```
hold current scale
reduce ramp
pause a capability
pause a market
extend observation
retire a provider / scenario
```

不允许用其他维度的增长掩盖 Blocker。

## 1.2 Readiness 有有效期

Scale approval 必须带：

```
approved_at
effective_at
expires_at or review_at
market
policy version
provider versions
scope
approvers
evidence snapshot
```

Provider、Legal、Tax、KYC、Policy、容量或风险发生重大变化时，原 readiness 自动进入 review，不得继续沿用旧批准。

## 1.3 Facts 与 Metrics 分离

Metric 只能描述和监控事实，不能改写事实：

```
low Slot Fill Rate does not create fake Orders
high acceptance does not bypass KYC
low dispute rate does not remove Safety checks
high revenue does not authorize raw-data access
good SLO does not forgive duplicate money effect
```

## 1.4 Scale Decision 的最小证据

任何扩大流量、场景、角色、Provider 或市场的决定至少引用：

```
PostPilotReview
current invariant result
gate scorecard
SLO / error budget
incident and reconciliation summary
provider health
market approval
operator / support capacity
rollback plan
```

---

# 2. Scale Lifecycle

## 2.1 Canonical Scale Status

```
PILOT
SCALE_CANDIDATE
LIMITED_SCALE
GENERAL_AVAILABILITY
MATURE
PAUSED
RETIRING
RETIRED
```

## 2.2 Status Semantics

| Status | 含义 | 新流量 | 主要门禁 |
|---|---|---:|---|
| PILOT | 有限 cohort、人工监控 | 受限 | Chapter 28 |
| SCALE_CANDIDATE | Pilot 结果完成，等待扩大 | 受限 | Chapter 29 evidence |
| LIMITED_SCALE | 按批准比例扩大 | 有 guardrail | 所有 P0 gates |
| GENERAL_AVAILABILITY | 市场范围内可正常使用 | 按市场容量 | 持续 readiness |
| MATURE | SLO、经济、风险长期稳定 | 按容量 | 周期治理 |
| PAUSED | 新 admission 或某能力暂时停止 | 受限 / 0 | Incident / Review |
| RETIRING | 停止新操作，处理存量 | 0 新增 | closeout |
| RETIRED | 不再提供能力，保留事实 | 0 | retention / legal |

## 2.3 Allowed Transitions

```
PILOT → SCALE_CANDIDATE
SCALE_CANDIDATE → LIMITED_SCALE
LIMITED_SCALE → GENERAL_AVAILABILITY
GENERAL_AVAILABILITY → MATURE
any active state → PAUSED
PAUSED → previous active state only after new LaunchDecision
active state → RETIRING
RETIRING → RETIRED
```

禁止：

```
PILOT → GENERAL_AVAILABILITY without intermediate evidence
PAUSED → ACTIVE by feature flag only
RETIRING → ACTIVE without re-approval
RETIRED → ACTIVE by data restore
```

## 2.4 ScaleDecision

```
ScaleDecision
├── decision_id
├── market_id
├── capability_scope[]
├── from_status
├── to_status
├── ramp_percentage or volume_cap
├── policy_snapshot
├── provider_snapshot
├── evidence_snapshot
├── gate_results[]
├── open_risks[]
├── rollback_plan_ref
├── approver_refs[]
├── decided_at
├── review_at
└── rationale
```

---

# 3. Scale Readiness Profile

## 3.1 ScaleReadinessProfile

```
ScaleReadinessProfile
├── profile_id
├── market_id
├── scope_type: MARKET / SCENARIO / ROLE / PROVIDER / CAPABILITY
├── scope_id
├── current_scale_status
├── policy_set_id / version
├── provider_connection_versions[]
├── gate_snapshot_ref
├── SLOProfile_ref
├── ErrorBudget_ref
├── incident_window
├── reconciliation_window
├── capacity_snapshot_ref
├── legal_review_ref
├── privacy_review_ref
├── support_readiness_ref
├── rollback_plan_ref
├── status: DRAFT / REVIEW / APPROVED / EXPIRED / PAUSED
├── approved_by[]
├── approved_at
└── review_at
```

## 3.2 Scope Hierarchy

Readiness 必须能区分：

```
market
scenario family
scenario
role template
provider capability
payment rail
KYC path
geo zone
pilot cohort
```

一个 Provider 在 Market A 的 Payment capability 通过，不代表：

```
Market B payment passes
KYC capability passes
payout passes
all scenario roles pass
multi-market routing passes
```

## 3.3 Readiness Snapshot

每次决策冻结一个不可变 snapshot：

```
metric definitions and versions
raw measurement window
aggregation query version
policy version
provider connection version
incident list
reconciliation result
capacity result
approval result
```

不能在决定之后修改历史 snapshot 让分数变绿。

---

# 4. Scale Gate Model

## 4.1 Gate Classes

| Gate | 回答的问题 | 失败处理 |
|---|---|---|
| Transaction Integrity | 钱、Slot、Order 是否正确 | Blocker / Pause |
| Execution Quality | 真人是否能到场、完成、有证据 | Hold / reduce ramp |
| Liquidity | Demand 与 Supply 是否健康 | Limit scope / extend |
| Economics | Requester、Agent、平台是否可持续 | Limit economics / revise policy |
| Repeat | 用户是否愿意再次使用 | Extend / product action |
| Safety / Privacy | 风险是否可控、数据是否安全 | Blocker / Pause |
| Operator Load | 人工队伍是否能承接异常 | Limit volume / add capacity |
| Provider Health | 外部依赖是否可靠可恢复 | Capability pause |
| Market Compliance | 市场审批是否仍有效 | Market pause |

## 4.2 Hard Blockers

以下不允许以平均值抵消：

```
duplicate charge / refund / payout
oversold atomic Slot
Order created before FundingSecured
raw secret / raw KYC exposure
successful cross-principal access
expired JIT access success
LegalHold deletion
false KYC verification
untraceable Ledger correction
unresolved safety incident with active exposure
missing legal / tax / KYC approval
rollback cannot preserve facts
```

## 4.3 Warning vs Blocker

非 Blocker 的问题必须分类：

```
WARNING: scale can hold, no expansion
DEGRADED: reduce ramp or capability scope
P0_FAIL: pause affected path
BLOCKER: pause and incident response
```

不得把 P0_FAIL 改名为 optimization opportunity。

## 4.4 Metric Definition Governance

每个 gate metric 引用 Chapter 19 的 MetricRegistry：

```
metric_id
metric_version
definition
event source
time window
population
exclusions
owner
guardrail relation
```

如果 metric definition 变化，历史 scorecard 不重算；新定义从新 effective time 起生效。

---

# 5. Gate A — Transaction Integrity

## 5.1 Required Checks

```
atomic Slot conflict
Offer freshness
Funding before paid Order
Payment / Refund / Payout idempotency
Ledger balance and reconciliation
Order state transition
duplicate webhook
outbox / event replay
manual adjustment dual control
```

## 5.2 Entry Conditions

SCALE_CANDIDATE 至少要求：

```
all Chapter 25 transaction invariants green
no unresolved duplicate money effect
no unresolved Slot oversell
all unknown money operations have owner and next action
reconciliation completed for review window
no unauthorized Ledger mutation
```

## 5.3 Ongoing Monitoring

每日检查：

```
FundingSecured to OrderCreated ordering
provider / local amount mismatch
Payout held beyond policy window
Refund stuck / duplicate
aggregate version conflicts
idempotency mismatch
reconciliation backlog
```

任何 hard blocker 立即将相关市场、Provider rail 或 operation scope 设为 PAUSED。

---

# 6. Gate B — Execution Quality

## 6.1 Required Checks

```
arrival within agreed window
Check-in success / rejection reasons
travel buffer adequacy
Evidence submission / scan completeness
completion quality
no-show and replacement
customer support resolution
```

## 6.2 Quality Segmentation

不能只看全市场平均值，至少按以下分组：

```
scenario
role
venue / location type
time of day
Agent experience band
Requester type
single-slot / multi-slot
urgent / same-day / scheduled
```

某个分组持续异常时，优先收窄该分组，不自动惩罚全市场。

## 6.3 Completion Truth

以下不能作为完成质量的替代：

```
Agent clicked complete
Requester did not complain
payment was captured
notification was delivered
rating was submitted
```

完成必须仍满足 Chapter 11 的 execution、Evidence、exception 和 policy 规则。

---

# 7. Gate C — Liquidity

## 7.1 Required Metrics

```
Slot Fill Rate
time to first qualified Offer
time to filled Slot
Offer acceptance rate
Candidate-to-Offer conversion
unfilled reason distribution
Agent Available Now coverage
radius expansion frequency
multi-slot partial fill
```

## 7.2 Liquidity Health

Liquidity 结果必须区分：

```
no supply
wrong capability
time conflict
location conflict
price mismatch
policy restriction
requester cancellation
Provider / system failure
```

不能把所有 Unfilled 都归为市场没有需求或 Agent 不够。

## 7.3 Liquidity Guardrail

当 Fill Rate 下降时，先检查：

```
candidate quality
Offer delivery
Policy radius / wave values
Agent availability freshness
pricing / travel feasibility
KYC / risk false exclusion
provider degradation
```

不得用无限扩大 radius、无限增加 Offer wave 或降低资格标准来制造虚假流动性。

---

# 8. Gate D — Economics

## 8.1 Parties

经济健康至少检查：

```
Requester total price / value
Agent net earnings
travel and waiting cost
platform fee / cost
refund / dispute leakage
Provider cost
support / operator cost
tax / payout obligation
```

## 8.2 Economic Safety

不能为了提高成交：

```
隐藏 fee / tax
压低 Agent earnings below approved floor
绕过 Funding
扩大 urgent premium beyond policy cap
延迟或错误 payout
用人工补贴掩盖不可持续 unit economics
```

## 8.3 Economics Review

每次价格、费率、premium、payout delay、Provider cost 或 subsidy 变化必须：

```
new PolicySet version
economic impact note
Requester / Agent guardrail
tax / legal review where relevant
experiment or change approval
rollback value
post-change monitoring
```

---

# 9. Gate E — Repeat / Value

## 9.1 Required Checks

```
Requester successful repeat
Business repeat order
Agent repeat participation
trusted relationship reuse
completion-to-review quality
support contact after Order
refund / dispute after completion
```

## 9.2 Repeat Is Not a Growth Shortcut

Repeat 不能通过：

```
marketing without consent
blocking export / deletion
hiding cancellation
penalizing user exit
exposing private contact
creating lock-in without value
```

## 9.3 Cohort Analysis

Repeat 必须按 cohort、scenario、role、market、first-order quality 和 support exposure 分析，不能把复购和自动续订、优惠券、强制通知混为一谈。

---

# 10. Gate F — Safety / Privacy / Security

## 10.1 Non-negotiable

```
zero known successful raw secret exposure
zero known successful cross-principal access
zero LegalHold deletion
zero false KYC verification
zero unresolved active critical Safety exposure
zero unlogged D4 / D5 access
```

## 10.2 Safety Trend

持续观察：

```
Incident rate and severity
Safety Block rate
no-show / abuse signal
dispute escalation
location misuse signal
account takeover signal
operator access anomaly
notification failure for critical alerts
```

低事件率不代表系统安全，如果 reporting、Support 或用户反馈能力不足，必须标记 measurement risk。

## 10.3 Privacy Review

每次扩大以下范围前必须进行 Privacy review：

```
new data class
new provider
new market
new location purpose
new operator team
new export field
new retention duration
new experiment population
```

---

# 11. Gate G — Operator Load

## 11.1 Capacity Dimensions

```
active cases
new cases per hour
P0 case response time
Payment reconciliation workload
KYC manual review backlog
Safety incident backlog
D4 / D5 access review
support first response
manual adjustment queue
on-call hours / fatigue
```

## 11.2 Load Rule

如果 Operator load 超过批准容量：

```
stop new risky admission
keep safe existing Order execution
prioritize P0 money / safety / privacy cases
increase staffing or reduce scope
review automation only after safety proof
```

不能以 Operator 加班作为无限规模能力。

## 11.3 Human-in-the-loop Boundary

自动化可以：

```
triage
dedupe
suggest next action
pre-fill case
calculate reconciliation difference
alert on threshold
```

自动化不能未经授权：

```
release held payout
approve identity
close Safety case
delete held data
override market gate
impersonate user
```

---

# 12. Gate H — Provider Health

## 12.1 Provider Scorecard

每个 Provider / capability 至少跟踪：

```
availability
latency
timeout
callback delay
signature failure
duplicate event
reconciliation mismatch
rate-limit usage
cost
support response
credential expiry
data / compliance incident
```

## 12.2 Provider Review

Provider 评审结果：

```
CONTINUE
WATCH
REDUCE_TRAFFIC
FAILOVER
PAUSE_CAPABILITY
RETIRE
```

Provider 的总平均可用率不能掩盖某一个支付 rail、KYC path 或市场 connection 的高风险。

## 12.3 Contract Expiry

以下任一到期时，相关 capability 自动进入 REVIEW：

```
provider contract
credential
webhook key
KYC legal basis
data residency approval
market tax / payout agreement
SLA
```

没有续期批准时，不能让过期连接继续接收新不可逆操作。

---

# 13. Gate I — Market Compliance

## 13.1 Continuous Market Review

每个 ACTIVE 市场按周期复核：

```
Terms / Privacy / Consent version
KYC / AML requirement
age rule
tax / fee / invoice
currency / payment rail
payout obligation
data residency / transfer
retention / deletion
support / emergency path
provider contract
```

## 13.2 Market Change Triggers

以下事件强制重审：

```
new scenario or role
new provider or data transfer
new payment / payout rail
new country / city / zone
material pricing or fee change
new sensitive data
new operator access
new legal notice
material safety incident
policy enum or state change
```

## 13.3 Market Expansion

新市场必须复制的是 Contract 和流程，不是旧市场的批准结果：

```
new MarketLaunchProfile
new provider mapping
new legal / tax / KYC approval
new consent / retention review
new locale / support readiness
new pilot cohort
new E2E / provider tests
new rollback plan
```

---

# 14. SLO / Error Budget

## 14.1 SLOProfile

```
SLOProfile
├── slo_profile_id
├── market_id
├── scope
├── command_availability_target
├── read_model_freshness_target
├── funding_confirmation_target
├── notification_acceptance_target
├── KYC_processing_target
├── reconciliation_completion_target
├── payout_processing_target
├── support_response_target
├── measurement_window
├── exclusions
├── owner
├── approved_version
└── effective_at
```

具体数值由 Engineering SLO、市场容量和 Provider 合同批准；未批准前不能声称达成 SLO。

## 14.2 Initial Scale Defaults

作为首发规模化评审的默认起点，除非批准了更严格值：

| 维度 | 初始目标 |
|---|---|
| P0 command availability | ≥ 99.5% per rolling 7d |
| Critical payment / safety command | ≥ 99.9% accepted or safely classified |
| Read Model freshness | 99% within 60s，敏感写操作仍走 Domain |
| Provider callback handling | 99% within approved processing window |
| Reconciliation | money mismatches triaged same business day |
| Critical notification acceptance | 99% queued / fallback-classified within 5m |
| KYC | pending / unknown all have owner and next action within 1 business day |
| P0 support | first acknowledgement within approved market SLA |

这些目标不覆盖 Hard Blocker；即使平均值达标，单个 duplicate money effect、raw secret exposure 或 cross-principal success 仍然阻塞。

## 14.3 ErrorBudget

```
ErrorBudget
├── error_budget_id
├── slo_profile_id
├── window
├── budget_total
├── consumed
├── remaining
├── burn_rate
├── policy_when_low
├── policy_when_exhausted
├── owner
└── status: HEALTHY / WARNING / EXHAUSTED / FROZEN
```

Error budget 用于控制可靠性与变更速度，不用于允许安全、资金或隐私错误。

## 14.4 Budget Policy

```
HEALTHY → approved ramp / normal change
WARNING → hold expansion / increase review
EXHAUSTED → freeze risky change / reduce traffic
FROZEN → incident or recovery plan
```

---

# 15. Continuous Governance Cadence

## 15.1 Daily

```
money reconciliation
unknown operation review
P0 incident and safety review
provider callback / outage review
KYC backlog
support SLA
guardrail consumption
```

## 15.2 Weekly

```
scale scorecard
liquidity and execution quality
Agent economics
Requester / Business repeat
Operator load
privacy / security access sample
provider health
open change requests
```

## 15.3 Monthly

```
MarketLaunchProfile review
PolicySet review
Legal / Tax / KYC changes
Provider contract / cost review
SLO / error budget
experiment portfolio
retention / deletion results
capacity plan
```

## 15.4 Quarterly or Triggered

```
market expansion
architecture / schema breaking change
material safety incident
material privacy incident
payment rail change
KYC provider change
major pricing / fee change
new operator team
retire / migrate provider
```

---

# 16. Change Governance

## 16.1 ChangeRequest

```
ChangeRequest
├── change_id
├── change_type: CODE / CONFIG / POLICY / PROVIDER / SCHEMA / MARKET
├── scope
├── current_version
├── target_version
├── reason
├── risk_class: LOW / MEDIUM / HIGH / CRITICAL
├── affected_invariants[]
├── affected_metrics[]
├── migration_plan
├── rollout_plan
├── rollback_plan
├── test_refs[]
├── approver_refs[]
├── effective_at
├── expires_at optional
└── status
```

## 16.2 Risk Class

| Class | 示例 | 审批 |
|---|---|---|
| LOW | copy、non-sensitive dashboard | owner review |
| MEDIUM | read model、non-critical notification | owner + QA |
| HIGH | pricing、matching、provider、retention | Product + Engineering + relevant control owner |
| CRITICAL | payment、KYC、privacy、Safety、schema enum、Ledger | dual / multi-control + Launch or Incident review |

## 16.3 Rollout

高风险 Change 必须支持：

```
staging validation
contract / E2E tests
canary or limited scope
metrics watch window
rollback or forward-fix
operator communication
post-change review
```

不允许把一次性全量上线作为默认安全策略。

## 16.4 Config / Policy Change

Policy 变化必须产生：

```
new policy version
effective_at
old value / new value
reason
market / scope
simulation or impact review
approval
rollback value
metric watch
```

已创建的 Offer、Quote、Order 采用 Chapter 23 / 26 的 snapshot 与 revalidation 规则，不能被后台配置静默重写。

---

# 17. Experiment Governance

## 17.1 ExperimentApproval

```
ExperimentApproval
├── experiment_id
├── hypothesis
├── population
├── primary_metric
├── guardrail_metrics[]
├── excluded_users / markets
├── data_classes
├── policy / pricing impact
├── safety / privacy review
├── start / end
├── rollback_rule
├── owner
├── approvers[]
└── status
```

## 17.2 Controlled Experiments

以下实验不能只由 Growth approval：

```
pricing / fee / urgent premium
matching eligibility / candidate exposure
location visibility
KYC / verification flow
notification frequency
consent capture
payment / payout behavior
Safety escalation
operator access
```

## 17.3 Experiment Guardrails

每个 experiment 必须：

```
one primary metric
named guardrails
eligible population
no contamination rule
stop condition
rollback behavior
data access purpose
end date
readout owner
```

Guardrail 触发时停止 treatment 或回退到 approved baseline；不能继续等待 primary metric 变好。

---

# 18. Data / Model / Observability Governance

## 18.1 Readiness Data Quality

Scale scorecard 只有在数据质量通过时才有效：

```
event completeness
duplicate event rate
late event rate
aggregate version gaps
missing policy snapshot
missing principal context
missing provider reference
metric freshness
sample bias
```

数据质量不达标时，结果标记 MEASUREMENT_INVALID，不允许作为 Scale evidence。

## 18.2 Metric Change

Metric 定义、事件来源、排除条件或计算逻辑变化时：

```
new metric version
backfill decision
historical comparability note
dashboard migration
owner approval
experiment impact review
```

## 18.3 AI / Automation Boundary

自动模型可用于：

```
forecast demand
detect anomaly
prioritize case
suggest candidate
suggest Provider failover
draft support response
```

在 P0 规模化阶段，模型不能未经可审计授权：

```
change canonical state
approve KYC
release payout
close incident
grant D4 / D5 access
override Safety restriction
change LegalHold
```

---

# 19. Capacity / Support / FinOps Readiness

## 19.1 CapacityProfile

```
CapacityProfile
├── capacity_profile_id
├── market_id
├── user_capacity
├── task_capacity
├── order_capacity
├── provider_quota
├── queue_capacity
├── operator_capacity
├── support_capacity
├── payment_volume_capacity
├── notification_capacity
├── KYC_review_capacity
├── forecast_window
├── owner
└── review_at
```

## 19.2 Capacity Gate

扩大流量前必须确认：

```
Provider quotas
queue / worker headroom
database / storage headroom
Payment / payout volume
KYC manual review
Support and Operator staffing
notification rate limits
incident response coverage
```

没有容量证据时只能 hold scale 或增加 guardrail，不能凭历史平均流量外推。

## 19.3 FinOps Guardrail

成本监控必须区分：

```
Provider transaction cost
KYC cost per attempt
Geo / route cost
Media storage / scan cost
Notification cost
Support / Operator cost
refund / dispute leakage
subsidy / promotion
```

成本超预算时，不得自动降低 Safety、KYC、Evidence、Notification 或 Privacy controls；只能进入经营决策和受控 Policy change。

---

# 20. Multi-market Expansion

## 20.1 MarketExpansionReview

```
MarketExpansionReview
├── review_id
├── source_market_id
├── target_market_id
├── scenario / role scope
├── provider mapping
├── legal / tax / KYC refs
├── privacy / data transfer refs
├── support / language refs
├── capacity plan
├── pilot plan
├── rollback plan
├── risk differences[]
├── approvers[]
├── decision: GO / HOLD / PILOT / NO_GO
└── effective_at
```

## 20.2 Market Isolation

市场必须隔离：

```
currency
tax
KYC decision requirement
retention override
provider connection
consent document
support queue
policy version
analytics population
```

一个市场的配置变更不能静默影响另一个市场。

## 20.3 Expansion Sequence

```
market definition
legal / privacy / tax / KYC review
provider capability mapping
contract / E2E tests
capacity / support readiness
small pilot
PostPilotReview
limited scale
general availability
```

---

# 21. Continuous Audit / Readiness Snapshot

## 21.1 ReadinessSnapshot

```
ReadinessSnapshot
├── snapshot_id
├── scope
├── captured_at
├── policy version
├── provider versions
├── invariant result
├── gate results
├── SLO / error budget
├── incidents
├── reconciliations
├── privacy / security review
├── market approvals
├── capacity
├── open changes
├── decision
└── evidence_refs[]
```

## 21.2 Audit Sampling

持续抽样：

```
random Order mainline
random Payment / Refund / Payout
random KYC attempt
random D4 / D5 access
random Operator case
random Consent withdrawal
random retention deletion
random market / policy change
```

抽样结果发现不一致时，扩大样本并判断是否为系统性问题。

## 21.3 GovernanceReview

```
GovernanceReview
├── review_id
├── period
├── scope
├── metric_snapshot
├── incident_summary
├── provider_summary
├── legal / privacy summary
├── change summary
├── experiment summary
├── open_risks
├── decisions
├── owners
├── due_dates
└── approved_at
```

---

# 22. Pause / Rollback / Retire at Scale

## 22.1 Triggers

```
Hard Blocker
error budget exhausted
provider contract expiry
market approval expiry
operator overload
capacity exhaustion
material incident
metric invalidation
unreviewed policy drift
```

## 22.2 Scale Pause

暂停可以作用于：

```
one experiment
one scenario
one role
one Provider capability
one payment rail
one market
all new admission
```

已有 Order 仍按 Chapter 28 的 Existing Order Rule 处理。

## 22.3 DecommissionPlan

```
DecommissionPlan
├── plan_id
├── scope
├── reason
├── last_new_operation_at
├── in_flight_handling
├── user communication
├── provider closeout
├── payment / payout reconciliation
├── KYC / data retention
├── support handoff
├── final audit
├── approvers[]
└── completion_at
```

RETIRE 不能删除历史交易、Ledger、KYC decision、Safety、Audit 或 LegalHold facts。

---

# 23. Acceptance Criteria

## AC-29-01 Scale Lifecycle

规模化使用 PILOT、SCALE_CANDIDATE、LIMITED_SCALE、GENERAL_AVAILABILITY、MATURE、PAUSED、RETIRING、RETIRED 状态，并遵守合法转换。

## AC-29-02 No Skip

Pilot 不能无 evidence 直接进入 General Availability；Paused、Retired 不能通过 feature flag 静默恢复。

## AC-29-03 ScaleDecision

每次扩大、收缩、暂停、恢复、退出都有 scope、policy、provider、gate、evidence、approver、review time 和 rollback reference。

## AC-29-04 Readiness Expiry

Readiness 有 effective / review / expiry；Provider、Legal、Tax、KYC、Policy、容量或风险变化会触发重新 review。

## AC-29-05 Gate Composition

Scale decision 同时检查 Transaction、Execution、Liquidity、Economics、Repeat、Safety/Privacy、Operator、Provider 和 Market Compliance。

## AC-29-06 Hard Blocker

Duplicate money、Slot oversell、Funding ordering violation、raw secret、cross-principal success、false KYC、LegalHold deletion 等不可被其他好指标抵消。

## AC-29-07 Metric Registry

每个 gate metric 引用 MetricRegistry 的定义、版本、event source、窗口、population、exclusion 和 owner。

## AC-29-08 Measurement Invalid

事件缺失、重复、乱序、policy context 缺失或 metric freshness 不达标时，scorecard 标记 measurement invalid，不能作为 Scale evidence。

## AC-29-09 Transaction Gate

Scale 前通过 Slot、Funding、Payment、Refund、Payout、Ledger、Webhook、Outbox、Idempotency 和 Manual Adjustment 检查。

## AC-29-10 Execution Gate

Execution scorecard 按 scenario、role、location、time、experience、requester、slot 类型和 urgency 分组，不能只看平均值。

## AC-29-11 Liquidity Gate

Fill、Offer、Candidate、Availability、radius 和 unfilled reason 可区分 Supply、Capability、Time、Location、Price、Risk 和 System 原因。

## AC-29-12 Economics Gate

Requester price、Agent earnings、travel cost、fee、tax、Provider cost、Support cost、refund/dispute leakage 和 subsidy 均进入评估。

## AC-29-13 Repeat Gate

Repeat 按 cohort、scenario、role、market、order quality 和 support exposure 分析，不通过 consent bypass、lock-in 或隐藏取消实现。

## AC-29-14 Safety Gate

Known successful privacy / security / raw secret / false KYC / LegalHold deletion / unlogged D4-D5 access 不能存在。

## AC-29-15 Operator Load Gate

扩大流量前验证 P0 case、KYC、Payment、Safety、Privacy、Support backlog、响应时间和 on-call capacity。

## AC-29-16 Automation Boundary

Automation 可以 triage、suggest、alert，但不能未经授权 release payout、approve identity、close Safety、grant D4/D5 或改 LegalHold。

## AC-29-17 Provider Scorecard

Provider 按 availability、latency、timeout、callback、signature、dedupe、reconcile、rate limit、cost、support 和 credential expiry 评审。

## AC-29-18 Provider Contract Expiry

Provider contract、credential、webhook key、legal basis、residency、tax/payout agreement 到期时，相关能力进入 Review，不继续新不可逆操作。

## AC-29-19 Market Review

ACTIVE 市场周期性复核 Terms、Privacy、Consent、KYC、Tax、Currency、Payout、Residency、Retention、Support 和 Provider。

## AC-29-20 Market Expansion

新市场有独立 MarketLaunchProfile、Provider mapping、Legal/Tax/KYC/Privacy approval、E2E、Capacity、Pilot 和 Rollback。

## AC-29-21 Market Isolation

市场的 currency、tax、KYC、retention、provider、consent、support、policy 和 analytics population 不会静默串扰。

## AC-29-22 SLOProfile

每个规模化 scope 有版本化 SLOProfile、measurement window、exclusions、owner 和 effective time。

## AC-29-23 ErrorBudget

ErrorBudget 能跟踪 total、consumed、remaining、burn rate、warning、exhausted 和 frozen 状态。

## AC-29-24 Budget Policy

Error budget warning 会 hold expansion，exhausted 会 freeze risky change；安全、资金、隐私错误不属于可消费的普通预算。

## AC-29-25 Governance Cadence

Daily、Weekly、Monthly、Quarterly/Triggered review 均有固定输入、owner、输出和 action item。

## AC-29-26 ChangeRequest

Code、Config、Policy、Provider、Schema、Market change 有 risk class、影响 Invariant、测试、rollout、rollback、审批和有效期。

## AC-29-27 Policy Version

价格、匹配、TTL、权限、Retention、Payout 等变化生成新 Policy version，不静默改写既有 Offer、Quote 或 Order snapshot。

## AC-29-28 ExperimentApproval

Pricing、Matching、Location、KYC、Consent、Notification、Payment、Payout、Safety 和 Operator 实验需控制审批和明确 rollback。

## AC-29-29 Experiment Guardrail

每个实验有一个 primary metric、named guardrails、eligible population、stop condition、data purpose 和 end date；guardrail 触发会停止 treatment。

## AC-29-30 CapacityProfile

扩大前检查 Provider quota、queue、storage、Payment、KYC、Support、Operator、Notification 和 incident response headroom。

## AC-29-31 FinOps

Provider、KYC、Geo、Media、Notification、Support、refund、dispute、subsidy 成本可分项观察；超预算不会自动降低安全和隐私控制。

## AC-29-32 ReadinessSnapshot

每次 Scale / Pause / Resume / Market Expansion decision 冻结不可变 readiness snapshot，历史结果不能事后重算变绿。

## AC-29-33 Audit Sampling

持续抽样 Order、Money、KYC、D4/D5、Operator、Consent、Retention 和 Market/Policy change，异常时扩大样本。

## AC-29-34 Scale Pause

Hard Blocker、ErrorBudget exhausted、Provider/Market approval expiry、Operator overload、capacity exhaustion 或 material incident 能暂停相应 scope。

## AC-29-35 Retire Plan

Retire 具备 in-flight handling、provider closeout、money reconciliation、data retention、support handoff、communication 和 final audit。

## AC-29-36 Continuous Readiness

只有当前 Gate、SLO、ErrorBudget、Incident、Provider、Market、Capacity、Privacy 和 rollback evidence 均有效，才能维持或扩大规模。

---

# 24. P0 / P1 Boundary

## 24.1 P0

```
Scale lifecycle and decision
all Chapter 20 scale gates
hard blocker protection
metric registry and measurement validity
SLO / Error Budget
Provider / Market continuous review
high-risk ChangeRequest
pricing / matching / payment / safety experiment control
capacity / support / operator gate
multi-market isolation
readiness snapshot and audit sample
pause / rollback / retire
```

## 24.2 P1

```
fully automated scale approval
predictive budget burn management
multi-region active-active governance
automatic Provider commercial renegotiation
autonomous experiment allocation
continuous legal rule ingestion
```

P1 自动化不能替代 P0 control owner、资金 reconciliation、Privacy review、Safety escalation 或 Market approval。

---

# 25. Locked Conclusions / Next Work

本章锁定：

```
规模化是有状态、有范围、有有效期的准入
Chapter 19 MetricRegistry 是指标定义来源
Chapter 20 gates 与 Chapter 25 invariants 不能被增长指标绕过
Provider、Market、Policy、Legal、Capacity 和 Readiness 都需要持续 review
Error budget 控制可靠性变更速度，不允许消费安全或资金错误
多市场扩展必须新建审批和 Pilot，不复制旧市场批准
Scale、Pause、Resume、Retire 都必须保留不可变 evidence
```

下一步进入：

```
Chapter 30 — Scale Architecture / Capacity / FinOps / Multi-Region Readiness
```

Chapter 30 将把本章的容量、成本、SLO 和多市场要求进一步落成区域架构、数据分区、队列容量、灾备、FinOps 模型和多 Region 运行门禁。


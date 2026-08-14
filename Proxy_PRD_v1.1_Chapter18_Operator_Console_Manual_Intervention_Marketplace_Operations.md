# Proxy PRD v1.1
## Chapter 18 — Operator Console / Manual Intervention / Marketplace Operations

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 02 — Capability Graph
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 05 — Matching Engine
- Chapter 06 — Fast Match / Offer Engine
- Chapter 10 — Payment / Settlement
- Chapter 11 — Execution / Exception
- Chapter 13 — Safety / Risk / Incident Center
- Chapter 14 — Notification / Inbox
- Chapter 15 — Business Workspace
- Chapter 17 — Map / Location

**本章范围**：
- Operator Console
- Manual Intervention Policy
- Escalation Queue
- Case Management
- Match / Replacement Assist
- Graph Gap
- Task Admission Review
- Payment Review
- Dispute Handling
- Safety Incident Handling
- Identity Review
- Manual Adjustment
- Permission / Approval
- Audit
- SLA
- Operator Metrics
- Human-in-the-loop boundary

**本章明确不做**：
- 允许 Operator 直接改数据库
- 任意修改 Order 状态
- 绕过 Ledger 改余额
- 绕过 Eligibility 强行塞 Agent
- 绕过 Safety / KYC / Policy
- 用“后台万能按钮”修所有问题

---

# 1. 本章目标

Operator Console 要解决：

> **当自动系统无法安全、确定地完成任务时，如何由人工有限介入，让任务继续收敛，而不是破坏系统真相。**

正式原则：

```text
System first
↓
Bounded recovery
↓
Policy escalation
↓
Operator intervention
↓
Audited resolution
```

---

# 2. Operator 不是第二套业务系统

Operator Console 只是：

```text
Review
Approve
Reject
Assist
Resolve
Adjust
Escalate
```

不能拥有：

```text
独立订单状态
独立支付真相
独立 Agent 资格
```

---

# 3. 系统优先

以下情况优先自动处理：

```text
Offer timeout
Next wave
Replacement attempt
Payment retry
Notification retry
Auto-confirm
Supply expansion suggestion
```

只有系统达到：

```text
bounded limit
```

才进入人工。

---

# 4. Manual Intervention Trigger

推荐统一：

```text
InterventionTrigger
```

来源：

```text
MATCH_EXHAUSTED
REPLACEMENT_EXHAUSTED
GRAPH_GAP
TASK_ADMISSION_REVIEW
PAYMENT_EXCEPTION
PAYOUT_EXCEPTION
DISPUTE_OPEN
SAFETY_INCIDENT
IDENTITY_REVIEW
FRAUD_REVIEW
DATA_CONFLICT
BUSINESS_ESCALATION
USER_SUPPORT
SYSTEM_INVARIANT_BREACH
```

---

# 5. Case

所有人工问题进入：

```text
OperatorCase
```

---

# 6. OperatorCase Schema

```text
case_id

case_type
priority
status

subject_type
subject_id

task_id optional
slot_id optional
order_id optional
incident_id optional
payment_id optional

reason_codes[]
summary

assigned_team
assigned_operator_id optional

created_at
first_response_at optional
resolved_at optional
closed_at optional
```

---

# 7. Case Status

```text
OPEN
TRIAGED
ASSIGNED
IN_PROGRESS
WAITING_USER
WAITING_PROVIDER
WAITING_INTERNAL
RESOLVED
CLOSED
```

---

# 8. Case Priority

```text
P0_CRITICAL
P1_HIGH
P2_NORMAL
P3_LOW
```

---

# 9. P0_CRITICAL

仅用于：

```text
Safety
Security
Severe fraud
Payment integrity incident
System-wide invariant breach
```

---

# 10. Operator Team

推荐至少：

```text
MARKETPLACE_OPS
TRUST_SAFETY
PAYMENTS
IDENTITY
BUSINESS_SUPPORT
GRAPH_GOVERNANCE
ADMIN
```

---

# 11. Least Privilege

每个 Team 只能看：

```text
完成当前职责所需的数据
```

例如 Marketplace Ops 不应默认看到：

```text
government ID
full bank account
private safety evidence
```

---

# 12. Operator Permission

推荐：

```text
CASE_VIEW
CASE_ASSIGN
CASE_RESOLVE

TASK_REVIEW
TASK_LIMITED_EDIT

MATCH_ASSIST
REPLACEMENT_ASSIST

GRAPH_GAP_REVIEW

PAYMENT_VIEW
PAYMENT_HOLD
REFUND_PROPOSE
REFUND_APPROVE

IDENTITY_VIEW
IDENTITY_DECIDE

SAFETY_VIEW
SAFETY_ACTION

RISK_RESTRICT

MANUAL_ADJUST_PROPOSE
MANUAL_ADJUST_APPROVE
```

---

# 13. 禁止直接 PATCH 状态

Operator 不允许：

```text
PATCH order.status = COMPLETED
```

必须调用：

```text
domain command
```

例如：

```text
ResolveCompletionException
ApproveRefund
ConfirmTaskAdmission
```

---

# 14. Command-based Console

所有按钮必须对应：

```text
Domain Command
```

不是直接数据库写入。

---

# 15. OperatorCase Timeline

Case 页面必须展示统一 Timeline：

```text
Task created
Task committed
Match attempts
Offers
Order
Execution
Payment
Incident
User messages
Operator actions
```

---

# 16. Timeline 的价值

Operator 不能在：

```text
多个后台页面来回猜
```

而要先看到：

> **发生了什么。**

---

# 17. Summary

系统可以生成：

```text
Case Summary
```

但必须基于真实 Domain Events。

---

# 18. AI Summary

P1 可以使用模型：

```text
summarize timeline
highlight contradictions
suggest next policy action
```

但 AI 不拥有最终高影响决策权。

---

# 19. Match Assist

如果：

```text
MatchAttempt = EXHAUSTED
```

进入 Marketplace Ops。

Operator 看到：

```text
Slot Requirements
Supply Counts
Relaxable Nice-to-have
Price Signal
Time Flexibility
Area Flexibility
Previous Waves
```

---

# 20. Operator 不能强行绕过 Eligibility

禁止：

```text
“这个人差不多，直接塞进去”
```

如果 Agent 不满足 Must-have：

```text
cannot assign
```

---

# 21. Operator 可做什么

可以：

```text
suggest requester relax Nice
suggest radius expansion
suggest time change
suggest reward increase
enable Open Apply
contact qualified supply
```

---

# 22. Operator Outreach

Operator 可向：

```text
already qualified agents
```

发送受控邀请。

这仍然创建：

```text
Offer
```

而不是直接 Order。

---

# 23. Manual Candidate Selection

如果 Operator 从 Qualified Pool 选：

```text
candidate
```

必须保存：

```text
operator_selected = true
reason
```

仍经过：

```text
Offer
Agent Accept
Atomic Slot Lock
```

---

# 24. Replacement Assist

当自动 Replacement：

```text
EXHAUSTED
```

Operator 可以：

```text
contact qualified trusted agents
expand qualified wave
ask requester for approved premium
propose schedule adjustment
```

---

# 25. Replacement 不能重新发明 Slot

仍然：

```text
same TaskSlot
replacement_generation++
new Order
```

---

# 26. Graph Gap

当 Demand Builder / Matching 遇到：

```text
unknown role
unknown capability
unknown scenario
```

生成：

```text
GRAPH_GAP
```

---

# 27. GraphGap Object

```text
graph_gap_id

source_type
source_id

raw_requirement
normalized_text

suggested_node_type
suggested_parent_ids[]

status

created_at
resolved_at optional
```

---

# 28. GraphGap Status

```text
OPEN
IN_REVIEW
MAPPED_EXISTING
NEW_NODE_PROPOSED
REJECTED
RESOLVED
```

---

# 29. Graph Governance

Operator 不能直接：

```text
add random capability
```

必须进入：

```text
Graph Draft
Review
Activate
```

流程。

---

# 30. 临时 Graph Gap 处理

如果当前 Task 可以：

```text
use free-text operational note
```

但不能作为：

```text
hard eligibility
```

除非已有正式 Graph Node。

---

# 31. 不能为了成交伪造 Capability Node

正式硬规则：

> **Graph Governance 不能因为一个客户急着要，就绕过审核造一个临时“合法”资格。**

---

# 32. Task Admission Review

当：

```text
admission_status = REVIEW_REQUIRED
```

进入 Trust & Safety / Marketplace Review。

---

# 33. Admission Review View

至少展示：

```text
Task Need Profile
Requester KYC / Trust
Business Verification
Sensitive Requirements
Location Type
Payment Readiness
Historical Risk
Policy reasons
```

---

# 34. Admission Action

允许：

```text
APPROVE
APPROVE_WITH_LIMIT
REQUEST_CLARIFICATION
REJECT
```

---

# 35. Request Clarification

如果 Task 信息不足：

Operator 可以请求：

```text
specific missing facts
```

不能：

```text
generic “please provide more information”
```

---

# 36. Admission Limit

例如：

```text
exact address hidden until match
KYC K2 required
business-only supply
enhanced check-in
```

---

# 37. Payment Review

Payment Ops 可以处理：

```text
authorization mismatch
capture failed
refund failed
payout failed
reconciliation mismatch
chargeback
```

---

# 38. Payment Ops 禁止事项

不能：

```text
直接改 wallet balance
直接改 earnings total
```

只能：

```text
Hold
Retry
Refund
Adjustment Ledger
```

---

# 39. Manual Adjustment

推荐：

```text
ManualAdjustmentRequest
```

Schema：

```text
adjustment_request_id

entity_type
entity_id

adjustment_type
amount
currency

reason_code
reason_text

requested_by
approved_by optional

status

created_at
approved_at optional
executed_at optional
```

---

# 40. Adjustment Status

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
EXECUTED
FAILED
```

---

# 41. Dual Control

超过阈值：

```text
requester != approver
```

---

# 42. Threshold

按：

```text
market
currency
adjustment_type
operator role
```

配置。

---

# 43. Dispute Handling

Dispute 必须进入独立 Case。

Operator 查看：

```text
contract snapshot
chat
execution events
evidence
payment
review
incident
```

---

# 44. Dispute Resolution

可：

```text
FULL_AGENT
FULL_REQUESTER
SPLIT
PLATFORM_SUBSIDY
REQUEST_MORE_EVIDENCE
```

---

# 45. Dispute 不能靠“感觉”

Resolution 必须记录：

```text
policy
evidence
reason codes
```

---

# 46. Split Resolution

例如：

```text
Agent gets 450k
Requester refund 200k
Platform fee adjusted
```

由：

```text
Ledger Adjustment
```

执行。

---

# 47. Safety Incident

Critical Incident 进入：

```text
TRUST_SAFETY
```

专属队列。

---

# 48. Safety View

只对授权 Operator 显示：

```text
precise location if currently needed
emergency contact
sensitive evidence
```

---

# 49. Safety Protective Actions

允许：

```text
revoke temporary contact
pause execution
hold payout
suspend matching
block future match
escalate account
```

---

# 50. Protective Action ≠ Final Judgment

Operator 可以先：

```text
temporary hold
```

再调查。

---

# 51. Identity Review

Identity Team 处理：

```text
document mismatch
duplicate identity
payout identity mismatch
business verification
```

---

# 52. Identity View Boundary

Identity Operator 不需要默认看：

```text
all chats
all task content
all earnings history
```

只看必要上下文。

---

# 53. Business Support

Business Support 处理：

```text
member access
workspace permission
task ownership
billing visibility
store configuration
```

不能直接：

```text
alter payment ledger
```

---

# 54. User Support

普通客服可以：

```text
explain status
create case
guide user
request re-review
```

但不能：

```text
override safety
refund high amounts
edit KYC
```

---

# 55. Escalation Matrix

推荐：

```text
Marketplace Ops
→ Match / Replacement

Trust & Safety
→ Incident / Admission / Risk

Payments
→ Funding / Refund / Payout

Identity
→ KYC / Business Verification

Graph Governance
→ Taxonomy Gap
```

---

# 56. Case Routing

由：

```text
case_type
severity
market
language
```

路由。

---

# 57. SLA

每种 Case 应有：

```text
first_response_sla
resolution_target
```

---

# 58. 示例 SLA 类别

不锁具体分钟数，按运营能力配置：

```text
Critical Safety
Urgent Replacement
Payment Failure
Normal Dispute
Graph Gap
General Support
```

---

# 59. Queue

Operator Home：

```text
Critical
Due Soon
Assigned to Me
Waiting User
Waiting Provider
Backlog
```

---

# 60. Queue Ranking

优先：

```text
safety
execution deadline
money at risk
task start time
case age
```

不是：

```text
VIP user first
```

除非有透明 Business SLA。

---

# 61. Business SLA

企业客户未来可购买：

```text
priority support
```

但：

```text
Safety / payment integrity
```

优先级不能被商业套餐覆盖。

---

# 62. User Communication

Operator 通过：

```text
Case Message
```

与用户沟通。

---

# 63. Case Message 与 Order Chat 分离

Operator Case Communication：

```text
support / review
```

Order Chat：

```text
execution
```

不能混。

---

# 64. User-facing Case Status

用户可看到：

```text
Received
Under Review
Need Your Input
Resolved
```

不暴露内部 Risk Model 细节。

---

# 65. Waiting User

Operator 请求资料后：

```text
WAITING_USER
```

并设置：

```text
deadline
```

---

# 66. Waiting Provider

例如：

```text
payment provider
identity provider
```

进入：

```text
WAITING_PROVIDER
```

避免 Case 假装还在人工处理中。

---

# 67. Resolution

Case 关闭前必须：

```text
resolution_code
resolution_summary
actions_taken
```

---

# 68. Resolution Code

例如：

```text
MATCH_RECOVERED
REPLACEMENT_FOUND
TASK_REJECTED
REFUND_ISSUED
PAYOUT_RELEASED
ACCOUNT_RESTRICTED
GRAPH_MAPPED
NO_ACTION_REQUIRED
```

---

# 69. Reopen

用户提供新证据：

可以：

```text
reopen
```

必须保留：

```text
previous resolution
```

---

# 70. No Hard Delete

Case 不物理删除。

可：

```text
CLOSED
```

按 retention 保留。

---

# 71. Operator Notes

内部 Note：

```text
not user-visible
```

但仍属于：

```text
audit-controlled data
```

---

# 72. Operator Note 禁止记录无关敏感信息

不要写：

```text
主观人格评价
无业务必要的私人细节
```

---

# 73. Evidence Access

Operator 访问 Evidence：

必须根据：

```text
case purpose
```

授权。

---

# 74. Download Control

高敏 Evidence：

P1 可以限制：

```text
download
copy
export
```

---

# 75. AuditLog

所有人工动作写：

```text
OperatorAuditLog
```

---

# 76. Audit Schema

```text
audit_id

operator_id
team
permission_used

case_id

command
entity_type
entity_id

before_state
after_state

reason_code
timestamp
ip / device metadata where appropriate
```

---

# 77. Audit 不等于业务 Event

例如：

```text
RefundIssued
```

是业务 Event。

```text
Operator X clicked Approve Refund
```

是 Audit。

两者都需要。

---

# 78. Immutable Audit

P0 要求：

```text
append-only
```

不能普通 Operator 修改自己历史操作。

---

# 79. Elevated Access

如果 Operator 临时需要高敏权限：

使用：

```text
Just-in-time Access
```

P1。

---

# 80. JIT Access

例如：

```text
view precise execution location for incident
```

需要：

```text
reason
case
time limit
```

---

# 81. Break-glass

P1 对极端 Safety 情况：

```text
break-glass access
```

必须：

```text
critical reason
strong audit
post-review
```

---

# 82. Operator Session

高权限 Operator 需要：

```text
MFA
short session
device control
```

技术细节后续 Security 设计。

---

# 83. Impersonation

不建议 Operator：

```text
login as user
```

如果必须：

P1 只能：

```text
view-as / controlled impersonation
```

且显式审计。

---

# 84. User Consent for Support Access

部分非安全 Case：

可以要求：

```text
support access consent
```

尤其查看：

```text
private content
```

---

# 85. System Invariant Breach

如果发现：

```text
two active Orders on one Slot
negative ledger impossible state
funding missing after Order confirmed
```

必须：

```text
P0_CRITICAL
```

---

# 86. Invariant Recovery

Operator 不直接手修 DB。

流程：

```text
freeze affected entity
run repair command
reconcile
audit
```

---

# 87. Repair Command

推荐：

```text
RepairSlotAssignment
RebuildSettlement
ReconcilePayment
RevokeStaleGrant
```

---

# 88. Repair Command 必须幂等

所有修复命令：

```text
idempotent
```

---

# 89. No Shadow Truth

Operator Console 不能保存：

```text
operator_order_status
operator_payment_balance
```

作为第二真相。

---

# 90. Read Model

Console 可以有丰富：

```text
read model
```

但写入必须回到：

```text
domain command
```

---

# 91. Operator Analytics

不评价：

```text
处理越多越好
```

而关注：

```text
automation recovery rate
case rate
resolution quality
SLA
repeat incident
```

---

# 92. Automation Escape Rate

重要指标：

```text
% tasks requiring manual intervention
```

应该随着系统成熟下降。

---

# 93. Manual Intervention Rate

按：

```text
case type
market
role
scenario
```

分析。

---

# 94. Match Assist Metric

```text
Operator-assisted Fill Rate
Time to Fill after escalation
```

---

# 95. Replacement Metric

```text
Operator-assisted Replacement Success
```

---

# 96. Graph Gap Metric

```text
Graph Gap Rate
Mapped Existing Rate
New Node Rate
Time to Resolve
```

---

# 97. Payment Ops Metric

```text
Payment Exception Rate
Manual Adjustment Rate
Reconciliation Resolution Time
```

---

# 98. Safety Ops Metric

```text
Time to Protective Action
Time to Triage
Repeat Incident Rate
Appeal Overturn Rate
```

---

# 99. Quality Metric

Case Resolution 后可观察：

```text
reopen rate
user re-contact rate
wrong action rate
appeal overturn
```

---

# 100. Operator Burnout Guard

Critical 队列不能无限堆积。

运营系统要支持：

```text
capacity
handover
shift
escalation
```

---

# 101. Marketplace Launch Principle

MVP 早期 Operator 介入可以较多。

但架构上必须：

> **人工是受控降级路径，不是隐藏主链。**

---

# 102. Operator Assist vs Concierge

可以提供：

```text
premium concierge
```

帮助 Business 配 Task。

但最终仍生成：

```text
Task
Slot
Match
Offer
Order
```

不能后台私下撮合。

---

# 103. Operator-created Draft

Operator 可以替用户：

```text
create Task Draft
```

前提：

```text
acting_on_behalf_of
user confirmation before commit
```

---

# 104. Operator 不能替 Agent Accept

正式硬规则：

> **Operator 不能替真人 Agent 接单。**

Agent Accept 必须来自 Agent 本人。

---

# 105. Operator 不能替 Requester 同意重大加价

除非：

```text
预先授权预算政策
```

否则：

```text
requester confirmation required
```

---

# 106. Operator 不能伪造 Evidence

任何：

```text
manual completion
```

必须标记：

```text
OPERATOR_CONFIRMED
```

并有 Reason。

---

# 107. Manual Completion

仅在：

```text
technical failure
valid supporting evidence
```

等异常情况下允许。

---

# 108. User Identity

Operator 不得：

```text
edit legal identity
```

只能：

```text
request re-verification
approve / reject submitted verification
```

---

# 109. Operator Content Moderation

如果普通 Content 被举报：

可：

```text
limit
remove
restore
```

但这属于低优先 Content Case，

不能淹没 Marketplace Safety Queue。

---

# 110. Business Workspace Support

Business 成员权限异常：

Operator 可以：

```text
view membership
guide owner
restore only via authorized process
```

不能：

```text
随意给某员工 Owner
```

---

# 111. Account Recovery

高风险账号恢复：

进入：

```text
Identity / Security Case
```

不是普通客服修改邮箱就完成。

---

# 112. Marketplace Ops 与 Trust & Safety 分离

Marketplace Ops：

```text
成交 / 供给 / Replacement
```

Trust & Safety：

```text
风险 / Incident / Admission
```

不能让同一低权限运营员同时拥有全部安全权限。

---

# 113. Payment Ops 与 Marketplace Ops 分离

Marketplace Ops 可以看：

```text
Payment Protected / Failed
```

但不需要：

```text
full payment instrument
ledger admin
```

---

# 114. Data Access Policy

Operator 查询用户时必须有：

```text
case context
```

禁止：

```text
出于好奇搜真人
```

---

# 115. Search Audit

搜索：

```text
User
Agent
Business
Order
```

也应记录：

```text
operator
reason / case
timestamp
```

尤其高敏主体。

---

# 116. Export

P1 支持受控：

```text
case export
```

用于：

```text
legal
finance
compliance
```

必须权限和审计。

---

# 117. Bulk Actions

P0 尽量限制。

高影响：

```text
bulk suspend
bulk refund
bulk payout adjustment
```

不建议早期开放。

---

# 118. Emergency Bulk Action

系统级 Incident：

P1 可支持：

```text
pause affected market / provider / task type
```

但必须高权限。

---

# 119. Feature Flag

Operator / Admin 可以切：

```text
market feature flag
```

例如：

```text
Disable Cash Handling Tasks
Pause Fast Match
```

但这属于 Admin / Platform Control，不属于普通 Case 操作。

---

# 120. Policy Version

所有 Case Resolution 记录：

```text
policy_version
```

保证：

> 当时为什么这么处理。

---

# 121. Localization

Operator Case 支持：

```text
vi
en
zh
```

用户消息可按原语言展示。

AI 可辅助翻译，但原文保留。

---

# 122. Cross-language Support

Operator 可以看到：

```text
Original
Translated
```

不能只保留翻译后文本。

---

# 123. Case Attachment

可以附：

```text
photo
video
document
payment receipt
```

沿用 Evidence / File Access Policy。

---

# 124. P0 必须实现

```text
OperatorCase
Case Queue
Case Timeline
Team Routing
Least Privilege
Domain Command Actions
Match Assist
Replacement Assist
Task Admission Review
Payment Exception Review
Dispute Handling
Safety Incident Case
Identity Review
Graph Gap
Manual Adjustment Request
Approval
Audit
SLA
User-facing Case Status
```

---

# 125. P1

```text
AI Case Summary
AI Triage Assist
JIT Access
Break-glass
Dual Control
Advanced Workload Routing
Controlled Impersonation
Case Export
Advanced Repair Commands
```

---

# 126. Acceptance Criteria

## AC-OPS-01
Operator Console 不得成为第二套业务真相。

## AC-OPS-02
系统必须优先自动恢复，再进入 Manual Intervention。

## AC-OPS-03
所有人工问题必须进入 OperatorCase。

## AC-OPS-04
Case 必须有 Type / Priority / Status / Ownership。

## AC-OPS-05
Operator 权限必须 Least Privilege。

## AC-OPS-06
Marketplace / Safety / Payments / Identity / Graph 权限必须可拆分。

## AC-OPS-07
Operator 不得直接 PATCH Order / Task / Payment 状态。

## AC-OPS-08
所有写操作必须调用 Domain Command。

## AC-OPS-09
Match Assist 不得绕过 Must-have Eligibility。

## AC-OPS-10
Operator 选 Qualified Candidate 后仍必须走 Offer / Accept / Atomic Slot Lock。

## AC-OPS-11
Operator 不得替 Agent Accept。

## AC-OPS-12
Replacement Assist 必须复用原 TaskSlot。

## AC-OPS-13
Graph Gap 必须进入 Governance 流程。

## AC-OPS-14
Operator 不得为单个紧急客户临时伪造合法 Capability Node。

## AC-OPS-15
Task Admission Review 必须基于 Task / Identity / Risk / Policy。

## AC-OPS-16
Payment Ops 不得直接改余额。

## AC-OPS-17
Manual Financial Adjustment 必须通过 Ledger Adjustment。

## AC-OPS-18
超过阈值的 Adjustment 必须支持双人审批。

## AC-OPS-19
Dispute Resolution 必须记录 Policy / Evidence / Reason。

## AC-OPS-20
Safety Protective Action 与最终责任判定必须分离。

## AC-OPS-21
高敏 Safety 数据只能由授权 Operator 查看。

## AC-OPS-22
Identity Operator 不得默认访问全量 Task / Chat 数据。

## AC-OPS-23
普通客服不得拥有高影响 Safety / Payment / Identity Override。

## AC-OPS-24
Case 必须有统一 Timeline。

## AC-OPS-25
用户可见 Case Status 与内部 Case Status 可以映射但不得泄露内部检测细节。

## AC-OPS-26
Case Resolution 必须有 Resolution Code / Summary。

## AC-OPS-27
Case Reopen 必须保留历史 Resolution。

## AC-OPS-28
Operator Note 不得记录无业务必要的敏感个人判断。

## AC-OPS-29
所有人工动作必须完整 Audit。

## AC-OPS-30
Operator Audit 必须 append-only。

## AC-OPS-31
系统 Invariant Breach 必须进入 Critical Case。

## AC-OPS-32
Invariant Repair 必须使用 Repair Command，不得手工改 DB。

## AC-OPS-33
Repair Command 必须幂等。

## AC-OPS-34
Operator-created Task 只能先创建 Draft，Commit 前需合法 Principal 确认。

## AC-OPS-35
Operator 不得替 Requester 同意未授权重大加价。

## AC-OPS-36
Manual Completion 必须标记 Operator Confirmed 并有 Evidence / Reason。

## AC-OPS-37
Operator Search 高敏主体必须可审计。

## AC-OPS-38
Business 数据恢复 / 权限调整必须遵守 Business Principal 权限模型。

## AC-OPS-39
人工介入率必须作为系统质量指标持续下降。

## AC-OPS-40
Operator Console 的最终目标是安全收敛异常，而不是把自动系统的缺陷长期藏在人工后台里。

---

# 127. 本章锁定结论

1. **Operator 是受控降级路径，不是隐藏主链。**
2. **所有人工问题统一进入 Case。**
3. **Console 可以有丰富 Read Model，但写操作必须回到 Domain Command。**
4. **Operator 不能直接改数据库、改余额、改 Order 状态。**
5. **Match / Replacement 人工辅助仍不能绕过 Eligibility / Offer / Accept / Slot Lock。**
6. **Graph Gap 必须治理，不能临时造标签救单。**
7. **Payment / Safety / Identity / Marketplace Ops 必须权限隔离。**
8. **Financial Adjustment 必须 Ledger-first，高金额支持双人审批。**
9. **Safety Protective Action 与 Final Judgment 分离。**
10. **所有人工操作必须 Audit。**
11. **系统 Invariant 异常必须通过 Repair Command 恢复。**
12. **Operator 不得替真人 Agent 接单。**
13. **Operator 不得替 Requester 同意未授权重大价格变化。**
14. **人工介入率越低、自动收敛率越高，系统才是真的成熟。**
15. **Operator Console 最终服务 Successful Human Execution 与 Marketplace Integrity。**

---

# 128. 下一章

下一份增量 PRD：

> **Chapter 19 — Analytics / Metrics / Experimentation / Marketplace Health**

重点解决：

```text
Proxy 到底看哪些北极星指标
Successful Human Execution 怎么定义
Requester / Agent / Business 各自看什么
Liquidity / Fill / Arrival / Completion / Repeat 怎么串起来
哪些指标绝对不能优化
A/B Test 怎么避免伤害真人
Boost / Ranking / Pricing 怎么做实验
如何判断一个新功能是在提高撮合，还是在鼓励刷人
```

这会把前面所有 Domain 变成可以持续运营、迭代和验证的产品系统。

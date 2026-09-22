# Proxy PRD v1.1
## Chapter 13 — Safety / Risk / Identity Trust / Incident Center

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 05 — Matching Engine
- Chapter 10 — Payment / Settlement
- Chapter 11 — Execution / Evidence / Completion
- Chapter 12 — Rating / Trust / Trusted Proxy / Repeat Relationship

**本章范围**：
- KYC / Trust / Risk Separation
- Task Admission
- Requester Risk
- Agent Risk
- Business Risk
- Risk Signals
- Restricted Tasks
- High-risk Task Review
- Safety Center
- SOS
- Incident Report
- Harassment / Fraud / Scam
- Task Mismatch
- Illegal / Prohibited Request
- Location / Contact Safety
- Emergency Contact
- Operator Intervention
- Risk Hold
- Payment / Matching / Trust Interaction
- Appeal / Review
- Audit / Metrics

---

# 1. 本章目标

Proxy 是真人现实执行平台。

因此安全系统必须回答：

1. 这个人是谁；
2. 这个人过去是否值得信任；
3. 这个人 / Task 当前是否存在风险；
4. 这个 Task 是否应该允许进入 Marketplace；
5. 现场出现危险时，Agent / Requester 怎么立即停止；
6. 平台如何冻结匹配、权限和资金；
7. Operator 怎么介入；
8. 安全事件如何影响后续交易；
9. 如何避免把 Capability、Trust、Risk 混成一个黑盒分数。

---

# 2. 核心原则

正式锁定：

> **KYC ≠ Trust ≠ Risk**

---

# 3. KYC

KYC 回答：

> **你是谁。**

例如：

```text
Identity document verified
Phone verified
Business registration verified
Payout identity verified
```

---

# 4. Trust

Trust 回答：

> **过去交易中，你是否长期表现可靠。**

例如：

```text
12 completed tasks
low cancellation
scope accurate
repeat relationship
```

---

# 5. Risk

Risk 回答：

> **当前是否存在需要限制、审核或阻断的危险信号。**

例如：

```text
fraud signal
harassment report
payment anomaly
unsafe task
identity mismatch
location anomaly
```

---

# 6. 三者不能互相替代

例如：

```text
KYC verified
```

不代表：

```text
safe forever
```

同样：

```text
New Agent
```

没有历史 Trust，

不代表：

```text
High Risk
```

---

# 7. Identity Trust Tier

继续沿用 KYC：

```text
K0
K1
K2
```

示例：

## K0
基础账户。

## K1
基础身份验证完成。

## K2
增强身份 / Business / Payout 等验证完成。

具体要求按市场配置。

---

# 8. Risk Status

推荐：

```text
NORMAL
WATCH
REVIEW_REQUIRED
RESTRICTED
SUSPENDED
BLOCKED
```

---

# 9. NORMAL

没有需要特殊限制的当前风险信号。

---

# 10. WATCH

存在轻度异常：

```text
monitor
```

但不自动阻断正常交易。

---

# 11. REVIEW_REQUIRED

特定交易 / Task / Payout：

需要：

```text
manual or enhanced review
```

---

# 12. RESTRICTED

部分能力受限：

例如：

```text
cannot receive private-home tasks
cannot boost
cannot access high-value tasks
```

---

# 13. SUSPENDED

暂停：

```text
Matching
Offer
New Orders
```

已有 Order 进入：

```text
operator review
```

---

# 14. BLOCKED

禁止继续使用相关业务能力。

---

# 15. Risk 不做单一公开分数

不向用户展示：

```text
Risk Score 82
```

而是展示必要结果：

```text
Verified Business
Payment Protected
Additional verification required
```

---

# 16. RiskSignal

推荐对象：

```text
RiskSignal
```

Schema：

```text
risk_signal_id
subject_type
subject_id

signal_type
severity
source

task_id optional
order_id optional

status
observed_at
expires_at optional
```

---

# 17. Risk Signal Source

```text
SYSTEM
USER_REPORT
PAYMENT
IDENTITY
EXECUTION
OPERATOR
PROVIDER
```

---

# 18. Risk Signal 类型

例如：

```text
IDENTITY_MISMATCH
PAYMENT_FAILURE_PATTERN
PAYMENT_FRAUD
MULTI_ACCOUNT_ABUSE
HARASSMENT_REPORT
THREAT_REPORT
ILLEGAL_TASK
TASK_MISMATCH
LOCATION_SPOOF
CHECKIN_FRAUD
NO_SHOW_PATTERN
OFF_PLATFORM_SCAM
CHARGEBACK_PATTERN
ACCOUNT_TAKEOVER
```

---

# 19. Risk Signal ≠ Final Decision

RiskSignal 只是：

```text
input
```

最终由：

```text
RiskDecision
```

决定。

---

# 20. RiskDecision

```text
risk_decision_id
subject_type
subject_id

decision
reason_codes[]
policy_version

task_id optional
order_id optional

created_at
expires_at optional
```

---

# 21. Risk Decision

```text
ALLOW
ALLOW_WITH_LIMIT
REVIEW
RESTRICT
SUSPEND
BLOCK
```

---

# 22. Task Admission

每个 Task 在进入 Marketplace 前必须经过：

```text
Task Admission
```

---

# 23. Admission Status

继续沿用：

```text
NOT_REQUIRED
PENDING
APPROVED
REVIEW_REQUIRED
REJECTED
```

---

# 24. Admission 输入

至少：

```text
Task description
Industry
Scenario
Role
Location type
Time
Requester trust
Requester KYC
Sensitive requirement
Payment readiness
Historical behavior
```

---

# 25. Prohibited Task

平台必须有：

```text
ProhibitedTaskPolicy
```

不允许进入 Marketplace 的任务直接：

```text
REJECTED
```

---

# 26. Prohibited Task 类型

通用原则：

```text
Illegal activity
Violence
Sexual exploitation
Harassment
Fraud
Deception for unlawful purpose
Dangerous controlled activity
Non-consensual surveillance
Identity impersonation for fraud
```

具体枚举按市场法律和平台政策配置。

---

# 27. Human Agent 与“代理”边界

Proxy 允许：

```text
合法代表
现场协助
代排队
代查看
活动执行
翻译
内容执行
```

不允许：

```text
违法冒充
伪造身份
骗取权限
非法进入
代替完成法律禁止代理的行为
```

---

# 28. High-risk Task

某些 Task 不一定禁止，但需要增强审核。

例如：

```text
Private residence
Late night
High-value goods
Cash handling
Sensitive documents
Child-related context
Restricted access site
```

---

# 29. High-risk Task Policy

可以要求：

```text
Requester KYC >= K1
Agent KYC >= K1
Payment fully secured
Enhanced check-in
Emergency contact
Operator availability
```

---

# 30. Private Residence Task

默认更严格：

```text
exact location hidden until matched
limited candidate exposure
enhanced trust gate
temporary contact
location TTL
```

---

# 31. High-value Goods

例如：

```text
pickup expensive device
```

可以要求：

```text
Agent enhanced verification
handover evidence
serial / receipt evidence
```

---

# 32. Cash Handling

P0 建议：

```text
限制或不支持
```

如果未来支持：

必须单独：

```text
CashHandlingPolicy
limits
evidence
insurance
```

---

# 33. Requester Risk

Requester Risk 可能来自：

```text
payment failures
frequent last-minute cancellation
task mismatch
scope abuse
harassment
unsafe venue
false disputes
chargebacks
```

---

# 34. Agent Risk

Agent Risk 可能来自：

```text
identity mismatch
no-show pattern
check-in fraud
harassment
theft report
fraud
unsafe conduct
```

---

# 35. Business Risk

Business 也必须作为独立 Subject。

例如：

```text
repeated unsafe venue
scope mismatch
non-payment attempt
harassment by staff
```

不能只追踪发 Task 的个人员工。

---

# 36. Principal-level Risk

Business Task 的风险既可能属于：

```text
creator user
```

也可能属于：

```text
Business principal
```

必须区分。

---

# 37. Venue Risk

建议未来支持：

```text
VenueRiskRecord
```

因为：

> 同一个危险 Venue 可能由不同 Business Staff 发 Task。

---

# 38. Venue Risk Signal

例如：

```text
access denied pattern
unsafe environment
repeated harassment report
misleading address
```

---

# 39. Safety Center

Agent / Requester App 应有：

```text
Safety Center
```

入口至少在：

```text
Order Detail
Execution
Chat
```

可快速访问。

---

# 40. Safety Center P0

支持：

```text
Report Issue
Report Safety Concern
Stop Task
Contact Support
Share Task
Emergency Contact
```

---

# 41. SOS

P1 正式支持：

```text
SOS
```

---

# 42. SOS 触发

点击：

```text
SOS
```

后至少：

```text
Create Critical Incident
Capture current order context
Capture permitted location
Alert platform operator
Show emergency options
```

---

# 43. SOS 不自动报警

是否调用本地紧急服务：

取决于：

```text
market
legal support
provider integration
user choice
```

不能假设所有国家都可自动处理。

---

# 44. Incident

推荐对象：

```text
Incident
```

---

# 45. Incident Schema

```text
incident_id

reporter_type
reporter_id

subject_type
subject_id

task_id optional
order_id optional
venue_id optional

incident_type
severity

description
evidence_refs[]

status

created_at
updated_at
resolved_at
```

---

# 46. Incident Type

```text
SAFETY_CONCERN
HARASSMENT
THREAT
VIOLENCE
FRAUD
THEFT
TASK_MISMATCH
ILLEGAL_REQUEST
ACCESS_DENIED
PRIVACY_BREACH
PAYMENT_SCAM
LOCATION_ISSUE
OTHER
```

---

# 47. Incident Severity

```text
LOW
MEDIUM
HIGH
CRITICAL
```

---

# 48. Incident Status

```text
OPEN
TRIAGED
IN_REVIEW
ACTIONED
RESOLVED
CLOSED
```

---

# 49. Immediate Action

高风险 Incident：

可以立刻触发：

```text
pause matching
revoke access
freeze payout
freeze disputed payment
suspend chat contact grants
operator escalation
```

---

# 50. Incident 与 Dispute 分离

Incident：

```text
安全 / 风险事实
```

Dispute：

```text
双方对交易结果 / 责任 / 钱有争议
```

可能同时存在，但不能混为一个对象。

---

# 51. Harassment

Harassment Report 必须支持：

```text
chat evidence
execution evidence
block
do not match again
operator review
```

---

# 52. Harassment Immediate Protection

Reporter 可以立即：

```text
Block
Stop Contact
End Temporary Contact Grant
```

不必等待完整调查结束。

---

# 53. Fraud

Fraud 可包括：

```text
fake task
fake identity
payment scam
false evidence
account takeover
multi-account abuse
```

---

# 54. Fraud 与 Capability 分离

例如：

```text
Agent fraud investigation
```

可能导致：

```text
Risk Restricted
```

但不能简单改：

```text
English capability = false
```

---

# 55. Task Mismatch

已在 Execution 章节定义：

```text
Task says A
actual asks B
```

Safety / Risk 层要处理：

```text
materiality
pattern
responsibility
```

---

# 56. Material Mismatch

例如：

```text
Greeter
→ heavy manual labor
```

属于明显重大不符。

---

# 57. Mismatch Action

可：

```text
Agent stop task
execution hold
operator review
payment protection
requester risk signal
```

---

# 58. Illegal Request During Execution

如果 Chat / 现场临时要求违法行为：

Agent 可以：

```text
Stop Task
Report Illegal Request
```

原 Task 的合法部分与新增非法要求分离。

---

# 59. Unsafe Environment

例如：

```text
暴力
严重醉酒骚扰
明显危险场地
```

Agent 不应因为离开而自动承担 Cancellation Fault。

---

# 60. Safe Exit

需要结构化：

```text
SAFE_EXIT
```

Execution Exception。

---

# 61. Safe Exit Money Flow

如果平台 / Requester 风险导致：

```text
Agent reasonable safe exit
```

可以：

```text
protect partial / full compensation
```

具体金额由 Payment Policy / Operator Resolution。

---

# 62. Location Safety

Precise location 是 D4。

必须：

```text
Order-bound
Purpose-bound
TTL
Audited
```

---

# 63. Location Access Policy

访问者必须满足：

```text
authorized participant
valid execution reason
active order stage
```

---

# 64. No Persistent Stalking Surface

禁止：

```text
查看 Agent 历史轨迹
查看 Agent 今日去了哪里
持续追踪 Trusted Proxy
```

---

# 65. Trusted Relationship 不增加位置权限

即使：

```text
Trusted Proxy
```

也不能：

```text
随时看 Agent location
```

---

# 66. Emergency Contact

属于高敏：

```text
D4 / D5 adjacent
```

只在：

```text
safety need
```

下临时开放。

---

# 67. Emergency Contact Grant

```text
emergency_contact_grant_id
order_id
viewer_id
subject_id
purpose
expires_at
status
```

---

# 68. Contact Revocation

任务结束 / Incident resolved：

```text
revoke
```

---

# 69. Safety Sharing

P1：

Agent 可以：

```text
Share this Order with trusted contact
```

分享：

```text
task type
time
venue
status
```

不一定分享 Requester 私人详情。

---

# 70. Operator

需要：

```text
Operator Console
```

用于：

```text
incident review
risk decision
task admission
payment hold
account restriction
evidence review
```

---

# 71. Operator Permission

不能所有客服都拥有：

```text
full KYC
full location
full payout
```

必须按：

```text
least privilege
```

拆权限。

---

# 72. Operator Role

例如：

```text
SUPPORT
TRUST_SAFETY
PAYMENT_REVIEW
IDENTITY_REVIEW
ADMIN
```

---

# 73. Sensitive Data Access

Operator 访问：

```text
government ID
precise location
emergency contact
```

必须产生：

```text
Access Audit
```

---

# 74. Operator Action

所有高影响动作：

```text
Suspend
Block
Release Hold
Refund
Remove Review
```

必须记录：

```text
reason
policy
operator
timestamp
```

---

# 75. Dual Review

P1 对高影响：

```text
permanent block
large payout freeze
large manual refund
```

建议：

```text
maker-checker
```

---

# 76. Risk Hold

风险发生时可以：

```text
RiskHold
```

作用于：

```text
ACCOUNT
TASK
ORDER
PAYOUT
BOOST
```

---

# 77. RiskHold Schema

```text
risk_hold_id
subject_type
subject_id

scope
reason
status

created_at
expires_at
resolved_at
```

---

# 78. Risk Hold 不自动冻结全部钱

必须尽量：

```text
scope-specific
```

例如：

```text
payout hold only
```

而不是：

```text
整个账户所有资金永久冻结
```

---

# 79. Payment Interaction

Safety / Fraud 可影响：

```text
funding
settlement
payout
refund
```

但通过：

```text
Hold / Adjustment
```

而不是直接改历史账。

---

# 80. Matching Interaction

RiskDecision 可以：

```text
exclude candidate
restrict scenario
require enhanced KYC
```

---

# 81. Boost Interaction

如果：

```text
WATCH / REVIEW / RESTRICTED
```

平台可以暂停：

```text
Boost eligibility
```

防止高风险用户买曝光。

---

# 82. Trust Interaction

Safety Incident 解决后：

可以影响：

```text
Risk Status
Requester Trust
Agent Reliability where relevant
```

但必须 Context-aware。

---

# 83. Capability 不应被无关 Risk 污染

例如：

```text
payment dispute
```

不应该影响：

```text
English B2 capability
```

---

# 84. Reliability Attribution

如果取消原因：

```text
unsafe venue
```

Agent 不应获得：

```text
cancellation fault
```

---

# 85. Appeal

被限制用户应有：

```text
Appeal
```

入口。

---

# 86. Appeal Object

```text
appeal_id
subject_type
subject_id
risk_decision_id

reason
evidence_refs[]

status
created_at
resolved_at
```

---

# 87. Appeal Status

```text
SUBMITTED
UNDER_REVIEW
UPHELD
OVERTURNED
PARTIALLY_OVERTURNED
CLOSED
```

---

# 88. Appeal 不自动解除限制

提交 Appeal：

```text
does not automatically remove hold
```

---

# 89. Expiring Restrictions

部分 RiskDecision 应支持：

```text
expires_at
```

避免所有限制永久化。

---

# 90. Permanent Block

只有：

```text
severe / repeated
```

情况才使用。

---

# 91. False Report Protection

平台必须防止：

```text
恶意 Safety Report
```

成为打击对方信誉的武器。

---

# 92. Report Confidence

可以记录：

```text
evidence strength
corroboration
history
```

但不能要求受害方一定有完整证据才允许保护动作。

---

# 93. Protective Action vs Final Judgment

重要：

> **平台可以先做临时保护，再做最终判定。**

例如：

```text
temporary contact block
temporary payout hold
```

不等于：

```text
final guilt decision
```

---

# 94. Safety UX

Agent Order 页面：

```text
Safety
├── Report Issue
├── Stop Task
├── Contact Support
└── SOS (P1)
```

---

# 95. Requester Safety UX

Requester 也可以：

```text
Report Agent
Stop contact
Request operator help
```

---

# 96. Safety Confirmation

高风险 Task Commit 前可提示：

```text
This task requires verified identity and secure payment.
```

不要制造恐慌式文案。

---

# 97. Task Admission UX

被 Review：

```text
This task needs an additional safety review before matching.
```

---

# 98. Rejected Task UX

显示：

```text
This task cannot be published on Proxy.
```

必要时给：

```text
policy category
```

但不暴露可被规避的内部检测细节。

---

# 99. Risk Data Retention

Risk / Incident 数据保留需根据：

```text
severity
legal requirement
appeal
fraud prevention
```

单独策略。

---

# 100. Privacy

安全系统不能成为借口：

```text
无限保留所有位置
无限查看所有聊天
```

必须遵守：

```text
purpose limitation
retention
least privilege
```

---

# 101. Chat Safety Detection

P1 可辅助检测：

```text
threat
harassment
payment scam
contact scam
illegal request
```

但：

> 自动检测只能作为 Signal，不应单独执行高影响永久封禁。

---

# 102. AI Safety Assist

可以：

```text
classify report
summarize incident
detect duplicated fraud pattern
prioritize operator queue
```

但最终高影响决定：

```text
policy-backed
auditable
human review where needed
```

---

# 103. Risk Model Version

所有自动 RiskDecision 记录：

```text
risk_policy_version
model_version optional
```

---

# 104. Incident Evidence

可以包含：

```text
chat
photo
video
location
check-in
payment event
operator note
```

每种 Evidence 仍受原数据权限控制。

---

# 105. Incident Timeline

Operator 应看到：

```text
Task committed
Order confirmed
EN_ROUTE
ARRIVED
Incident reported
Chat message
Payment hold
Resolution
```

而不是散乱页面。

---

# 106. Risk Event

推荐统一：

```text
RiskEvent
```

用于事件总线：

```text
INCIDENT_OPENED
TASK_REJECTED
ACCOUNT_RESTRICTED
PAYOUT_HELD
CONTACT_REVOKED
APPEAL_SUBMITTED
```

---

# 107. Notification

高风险通知：

```text
in-app
push
operator alert
```

P1 可接：

```text
SMS
```

---

# 108. Notification Privacy

通知锁屏不应泄露：

```text
sensitive incident details
exact location
identity document
```

---

# 109. Business Safety

Business Workspace 应看到：

```text
open safety incidents
restricted staff access
venue warning
```

但只有授权 Role 能看。

---

# 110. Multi-user Business Incident

如果 Incident 涉及：

```text
Business employee
```

平台可分别记录：

```text
User Risk
Business Risk
Venue Risk
```

避免只封一个员工账号就丢失组织风险。

---

# 111. Trusted Proxy Safety

Trusted Relationship 不能：

```text
skip safety checks
```

也不能：

```text
mute reports
```

---

# 112. Repeat Relationship Safety

如果双方后来产生：

```text
block
incident
```

Trusted Relationship 可以：

```text
suspend / remove
```

---

# 113. New Agent Safety

新 Agent 没历史：

可以要求：

```text
baseline KYC / role verification
```

但不能因为“新”就默认 High Risk。

---

# 114. New Requester Safety

新 Requester：

可以：

```text
limit sensitive task exposure
require stronger funding
```

但不是全部拒绝。

---

# 115. Risk-based Progressive Disclosure

高风险 Context：

可以降低：

```text
profile detail
contact access
location precision
```

---

# 116. Risk-based Matching

例如：

```text
private home task
```

只允许：

```text
verified requester
verified agent
```

进入候选。

---

# 117. No Public Safety Shame

平台不应公开：

```text
“危险用户榜”
“高风险真人排行榜”
```

安全限制属于受控内部信号。

---

# 118. Severe Incident Outcome

严重事件可能导致：

```text
BLOCK
law enforcement request handling
data preservation hold
```

具体按法律流程处理。

---

# 119. Data Preservation Hold

如果发生严重事件：

可以：

```text
preserve relevant evidence
```

超过普通 retention。

但必须：

```text
reason
scope
authorized access
```

---

# 120. Safety Metrics

核心：

```text
Incident Rate
Critical Incident Rate
Harassment Rate
Fraud Rate
Task Mismatch Rate
Unsafe Venue Rate
```

---

# 121. Operational Metrics

```text
Time to Triage
Time to Protective Action
Time to Resolve
Appeal Resolution Time
```

---

# 122. Prevention Metrics

```text
High-risk Task Review Rate
Admission Reject Rate
Repeat Incident Rate
Risk Recurrence
```

---

# 123. False-positive Guardrail

必须监控：

```text
Restriction overturned by appeal
Safe user false block
False no-show
Unnecessary payout hold
```

---

# 124. Privacy Guardrail

```text
Unauthorized location access
Expired contact grant still active
Operator excessive access
Incident evidence leakage
```

---

# 125. P0 必须实现

```text
KYC / Trust / Risk Separation
Risk Status
RiskSignal
RiskDecision
Task Admission
Prohibited Task Policy
High-risk Task Review
Incident
Harassment / Fraud / Task Mismatch
Stop Task
Temporary Contact Revocation
Precise Location TTL
Risk Hold
Payment / Matching Restriction
Operator Review
Appeal
Audit
```

---

# 126. P1

```text
SOS
Trusted Contact Sharing
Advanced Fraud Detection
Venue Risk
Chat Safety Assist
AI Incident Triage
Dual-control Safety Actions
Emergency Provider Integration
```

---

# 127. Acceptance Criteria

## AC-SAFE-01
KYC / Trust / Risk 必须是独立领域。

## AC-SAFE-02
KYC Verified 不得等同于 Low Risk。

## AC-SAFE-03
New User 不得默认等同于 High Risk。

## AC-SAFE-04
每个公开 Task 必须经过 Task Admission。

## AC-SAFE-05
Prohibited Task 必须被阻止进入 Marketplace。

## AC-SAFE-06
高风险但合法 Task 必须支持增强审核，而不是一律拒绝。

## AC-SAFE-07
RiskSignal 不得直接等同 Final Risk Decision。

## AC-SAFE-08
RiskDecision 必须版本化、可审计。

## AC-SAFE-09
Risk Restriction 应优先 scope-specific。

## AC-SAFE-10
Risk Hold 不得默认冻结账户全部资金。

## AC-SAFE-11
Safety Incident 与 Payment Dispute 必须分离。

## AC-SAFE-12
Harassment Report 必须支持立即阻断临时联系。

## AC-SAFE-13
Fraud Risk 不得直接修改无关 Capability。

## AC-SAFE-14
Task Mismatch 必须允许 Agent Stop Task。

## AC-SAFE-15
Unsafe / Illegal Request 不得被算作普通 Agent Cancellation Fault。

## AC-SAFE-16
Agent 必须能够安全退出明显危险任务。

## AC-SAFE-17
Precise Location 必须 Order-bound / Purpose-bound / TTL。

## AC-SAFE-18
Trusted Proxy 不得获得永久位置权限。

## AC-SAFE-19
Emergency Contact 必须临时、受控、可审计。

## AC-SAFE-20
Operator 权限必须最小化。

## AC-SAFE-21
Operator 访问 D4 / D5 数据必须有 Access Audit。

## AC-SAFE-22
高影响 Operator Action 必须记录 Reason / Policy / Actor。

## AC-SAFE-23
Risk / Fraud 对 Payment 的影响必须通过 Hold / Adjustment，而非修改历史账。

## AC-SAFE-24
高风险账户可以暂停 Boost。

## AC-SAFE-25
Risk 影响 Reliability 时必须做责任归因。

## AC-SAFE-26
用户必须有 Appeal 入口。

## AC-SAFE-27
Appeal 不应自动解除临时安全限制。

## AC-SAFE-28
临时保护措施与最终责任判定必须分离。

## AC-SAFE-29
恶意 Report 不得自动毁坏对方全局信誉。

## AC-SAFE-30
自动安全模型只能作为 Signal 或 Policy Input，不应单独执行永久高影响封禁。

## AC-SAFE-31
Incident 必须有完整 Timeline。

## AC-SAFE-32
安全通知不得泄露锁屏敏感信息。

## AC-SAFE-33
Business Risk / User Risk / Venue Risk 必须可以独立表达。

## AC-SAFE-34
Trusted Relationship 不得绕过安全审核。

## AC-SAFE-35
Safety 系统必须同时监控 False Positive 与 Privacy Risk。

---

# 128. 本章锁定结论

1. **Proxy 真人安全底座必须建立在 KYC / Trust / Risk 三分离之上。**
2. **Task Admission 是所有真人需求进入 Marketplace 前的安全门。**
3. **禁止任务直接 Reject，高风险合法任务走增强审核。**
4. **RiskSignal 是输入，RiskDecision 才是平台动作依据。**
5. **安全限制要尽量最小范围，而不是动不动全账户冻结。**
6. **Incident、Dispute、Review、Capability 都必须分离。**
7. **骚扰、欺诈、现场严重不符、非法追加要求都必须允许立即停止与上报。**
8. **Unsafe Task 下 Agent 的合理退出不能被当成普通取消违约。**
9. **精确位置、临时电话、紧急联系人都必须 Purpose-bound + TTL + Audit。**
10. **Trusted Proxy / Trusted Team 永远不能绕过 Safety。**
11. **Operator 必须最小权限，高敏访问必须审计。**
12. **风险冻结和支付调整只能通过 Hold / Ledger，不重写历史资金。**
13. **用户必须拥有 Appeal 机制。**
14. **自动模型可辅助安全判断，但高影响永久决定必须可解释、可审计、受 Policy 约束。**
15. **安全系统的目标是让真人敢接、Requester 敢下单，而不是制造全平台恐惧。**

---

# 129. 下一章

下一份增量 PRD：

> **Chapter 14 — Notification / Inbox / Task Communication Center**

重点解决：

```text
Requester / Agent 到底什么时候收到什么通知
Offer / Arrival / Cancellation / Payment / Safety 如何分优先级
哪些必须 Push
哪些只进 Inbox
怎样避免 Agent 被 Offer Spam
Business 多人 Task 怎么汇总通知
系统消息、Chat、Safety Alert 为什么必须分开
```

这会把前面所有状态机真正接到用户每天能感知的产品层。

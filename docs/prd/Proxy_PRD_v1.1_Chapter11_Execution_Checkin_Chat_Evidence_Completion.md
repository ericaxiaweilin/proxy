# Proxy PRD v1.1
## Chapter 11 — Execution / Check-in / Chat / Evidence / Completion

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 06 — Fast Match / Invite / Offer Engine
- Chapter 08 — Availability / Supply Capacity
- Chapter 09 — Pricing / Marketplace Economics
- Chapter 10 — Payment / Escrow / Settlement

**本章范围**：
- Order Execution
- Pre-task Preparation
- Platform Chat
- Contact Boundary
- Departure / EN_ROUTE
- Arrival / Check-in
- Start Work
- Execution Instructions
- Evidence
- Completion
- Auto-confirm
- Exception
- No-show
- Safety
- Location TTL
- Sensitive Data Revocation
- Audit / Metrics

---

# 1. 本章目标

Execution 层要回答：

> **一个真人 Agent 已经接单以后，如何安全、可验证地把现实任务真正完成。**

核心链路：

```text
Order CONFIRMED
↓
Prepare
↓
EN_ROUTE
↓
ARRIVED
↓
IN_PROGRESS
↓
EVIDENCE_SUBMITTED
↓
COMPLETION_REVIEW
↓
COMPLETED
↓
CLOSED
```

---

# 2. Execution 的核心原则

## 2.1 Real-world First

Execution 的事实来源优先：

```text
时间
位置
Check-in
Evidence
双方确认
真实操作记录
```

不是：

```text
Agent 自己说“我做完了”
```

---

## 2.2 Minimum Necessary Disclosure

只有完成当前 Order 真正需要的信息才开放。

---

## 2.3 Evidence ≠ Surveillance

Evidence 用于：

```text
证明任务完成
```

不是：

```text
全程监控真人
```

---

# 3. Execution Context

Order 创建后生成：

```text
ExecutionContext
```

Schema：

```text
execution_context_id
order_id

task_snapshot_id
venue_id optional

arrival_target
scheduled_start
scheduled_end

checkin_policy_id
evidence_policy_id
location_visibility_policy_id

execution_status

created_at
updated_at
```

---

# 4. Pre-task Preparation

Order CONFIRMED 后，Agent 应看到：

```text
Role
Time
Approx / Exact location as allowed
Arrival Target
Duration
Pay
Main Deliverable
Dress / Equipment if required
Requester / Business display identity
Task Chat
Cancellation Terms
Safety Notes
```

---

# 5. Pre-task Checklist

根据 Role 动态生成：

```text
Bring ID if needed
Wear black shirt
Install required app
Bring camera
Prepare bilingual material
```

Checklist 必须来自：

```text
Task / Role / Scenario configuration
```

不能靠自由文本散落。

---

# 6. Platform Chat

Order 创建后解锁：

```text
Order Chat
```

Chat 绑定：

```text
order_id
```

不是通用好友聊天。

---

# 7. Chat Participants

默认：

```text
Requester / authorized Business Staff
Agent
Platform Operator if needed
```

---

# 8. Chat 生命周期

建议：

```text
MATCHED
→ EXECUTION
→ LIMITED_POST_TASK
→ ARCHIVED
```

任务关闭后仍可短期访问用于：

```text
dispute
follow-up
```

但不鼓励永久私聊关系。

---

# 9. Contact Boundary

P0 默认：

```text
Platform Chat first
```

不直接暴露：

```text
phone
email
private social
```

---

# 10. Temporary Contact

如果现实执行确实需要电话：

可以生成：

```text
Masked / Temporary Contact Grant
```

并带：

```text
order_id
purpose
expires_at
```

---

# 11. Contact Grant

```text
contact_grant_id
order_id
subject_id
viewer_id
contact_type
purpose
granted_at
expires_at
status
```

---

# 12. EN_ROUTE

Agent 主动点击：

```text
I'm on my way
```

Order：

```text
CONFIRMED → EN_ROUTE
```

---

# 13. EN_ROUTE 的作用

可以触发：

```text
Requester notification
ETA refresh
Arrival monitoring
Cancellation policy phase change
```

---

# 14. EN_ROUTE 不要求持续 GPS

P0 推荐：

```text
one-time / occasional ETA refresh
```

而不是：

```text
continuous live tracking
```

---

# 15. Precise Location Grant

只有：

```text
valid Order
+
execution purpose
```

才允许短期精确位置。

---

# 16. Arrival

Agent 到场后：

```text
ARRIVED
```

必须由某种 Check-in 信号支持。

---

# 17. Check-in Methods

P0 支持：

```text
GPS_GEOFENCE
QR_CODE
REQUESTER_CONFIRM
BUSINESS_CONFIRM
MANUAL_WITH_EVIDENCE
```

---

# 18. GPS Check-in

检查：

```text
agent location
within allowed geofence
within allowed time window
```

不需要持续轨迹。

---

# 19. QR Check-in

适合：

```text
Business
Venue
Event
```

现场扫描：

```text
Venue QR
```

确认到场。

---

# 20. Requester Confirm

Requester 可以点击：

```text
Agent arrived
```

作为补充信号。

---

# 21. Multiple Signals

高风险 / 高价值任务：

可以要求：

```text
GPS + Business Confirm
```

但 P0 默认不要过度复杂。

---

# 22. Check-in Policy

配置：

```text
checkin_policy_id
allowed_methods[]
required_count
grace_window
geo_radius
```

---

# 23. Arrival Grace Window

例如：

```text
arrival_target = 17:30
grace = 10 min
```

超过：

```text
17:40
```

可能进入：

```text
LATE
```

但不自动等于 No-show。

---

# 24. Late Status

Late 更适合作为：

```text
Execution Event
```

不是 Order 主状态。

例如：

```text
ARRIVED
+
late_by = 8 min
```

---

# 25. Start Work

Agent 到场不等于已经开始执行。

需要：

```text
Start Task
```

或由 Business / Requester 确认。

---

# 26. IN_PROGRESS

进入：

```text
Order = IN_PROGRESS
```

后：

```text
cancellation rules
overtime rules
evidence timing
```

进入执行阶段。

---

# 27. Execution Instructions

执行阶段展示：

```text
Primary Tasks
Checklist
Do / Don't
Contact Person
Venue Instructions
Emergency Procedure
```

---

# 28. Instructions Snapshot

Order 创建时必须冻结：

```text
ExecutionInstructionSnapshot
```

后续重大修改必须：

```text
Agent re-consent
```

---

# 29. Live Instruction Update

Requester 可追加：

```text
minor operational note
```

例如：

```text
Please stand at Entrance B.
```

但不能通过 Chat 偷偷改变：

```text
Role
Duration
Pay
Core Deliverable
Location materially
```

---

# 30. Contract Change Guard

如果 Chat 中出现：

```text
“再多做两小时”
```

系统应引导：

```text
Request Extension
```

而不是只靠消息同意。

---

# 31. Evidence

Evidence 表示：

> **证明某个 Deliverable 已被执行或完成的结构化事实。**

---

# 32. Evidence Object

```text
evidence_id
order_id

evidence_type
source_type

media_reference optional
text_value optional
numeric_value optional
geo_value optional
external_reference optional

submitted_by
submitted_at

verification_status
visibility
```

---

# 33. Evidence Type

P0：

```text
CHECKIN
CHECKOUT
PHOTO
VIDEO
TEXT_NOTE
CHECKLIST
GPS
DURATION
REQUESTER_CONFIRMATION
BUSINESS_CONFIRMATION
EXTERNAL_LINK
```

---

# 34. Evidence 不一定要求媒体

例如：

```text
Queue task
```

可能只需：

```text
check-in
queue number
completion confirmation
```

不一定拍人。

---

# 35. Evidence Policy

```text
EvidencePolicy
```

根据：

```text
Industry
Scenario
Role
Task
```

配置。

---

# 36. Evidence Requirement

每项：

```text
REQUIRED
OPTIONAL
NOT_ALLOWED
```

---

# 37. Private Scene

私人住宅 / 私密商务场景：

可能：

```text
PHOTO = NOT_ALLOWED
```

避免为了“证据”破坏隐私。

---

# 38. Photo Evidence

可以要求：

```text
object / location / result
```

但不要默认要求：

```text
拍 Requester
拍陌生顾客
```

---

# 39. Video Evidence

P0 只作为：

```text
普通视频上传
```

不需要直播。

---

# 40. Evidence Upload

媒体：

```text
upload
processing
ready
failed
```

和 Chapter 06A 的基础视频资产可复用。

---

# 41. Evidence Visibility

默认：

```text
Requester
Agent
Authorized Business
Platform if required
```

不是 Public Feed。

---

# 42. Evidence → Public Content

只有经过：

```text
separate consent
usage rights
privacy check
```

才能转换为 ContentPost / Portfolio。

---

# 43. Check-out

部分 Task 需要：

```text
Check-out
```

用于确认：

```text
duration
departure
completion timing
```

---

# 44. Duration

系统计算：

```text
start_at_actual
end_at_actual
duration_actual
```

与：

```text
scheduled duration
```

分离。

---

# 45. Overtime Detection

如果：

```text
actual > scheduled
```

不自动代表：

```text
paid overtime
```

需要结合：

```text
approved extension
```

---

# 46. Completion Submission

Agent 完成后：

```text
Submit Completion
```

必须检查：

```text
required evidence complete
```

---

# 47. Evidence Missing

如果缺：

```text
Required Evidence
```

则：

```text
cannot submit completion
```

除非：

```text
exception / manual review
```

---

# 48. EVIDENCE_SUBMITTED

Agent 提交后：

```text
Order = EVIDENCE_SUBMITTED
```

---

# 49. Completion Review

进入：

```text
COMPLETION_REVIEW
```

Requester 可以：

```text
Confirm
Report Issue
Request Clarification
```

---

# 50. Requester Confirm

Requester 点击：

```text
Confirm Completed
```

后：

```text
Order = COMPLETED
```

并进入：

```text
Settlement
```

---

# 51. Auto-confirm

Requester 长时间不操作：

达到：

```text
auto_confirm_at
```

后：

如果无：

```text
active dispute
required evidence failure
risk hold
```

则自动确认。

---

# 52. Clarification

Requester 可以：

```text
Ask for explanation
```

但不能无限延迟结算。

必须有：

```text
clarification window
```

---

# 53. Completion Issue

Requester 认为未完成：

```text
Report Issue
```

进入：

```text
Dispute / Exception
```

不是直接：

```text
reject and pay 0
```

---

# 54. Partial Completion

P1 支持：

```text
Deliverable item-level completion
```

例如：

```text
5 checklist items
4 done
1 failed
```

P0 可以先：

```text
Complete / Issue
```

---

# 55. Execution Exception

推荐对象：

```text
ExecutionException
```

---

# 56. Exception Type

```text
AGENT_LATE
AGENT_NO_SHOW
REQUESTER_NO_SHOW
VENUE_CLOSED
TASK_BLOCKED
SAFETY_CONCERN
EQUIPMENT_FAILURE
ACCESS_DENIED
WEATHER
OTHER
```

---

# 57. Exception 不等于 Dispute

Exception 是：

```text
发生了什么
```

Dispute 是：

```text
双方是否对责任 / 结算有争议
```

---

# 58. Safety Concern

Agent 或 Requester 可以：

```text
Report Safety Concern
```

必要时：

```text
pause execution
```

---

# 59. Safety Pause

状态不一定需要新增到 Order 主状态。

可以：

```text
execution_hold = SAFETY
```

---

# 60. Emergency Action

P1 Safety Center：

```text
SOS
Emergency Contact
Share Order
Operator Support
```

---

# 61. Unsafe Task

如果 Agent 到场发现：

```text
materially different
unsafe
illegal
```

可以：

```text
Stop Task
Report
```

不能被强迫继续完成来保住收入。

---

# 62. Material Task Mismatch

例如：

```text
Task says event greeter
actual asks heavy moving
```

属于：

```text
TASK_MISMATCH
```

---

# 63. Mismatch Evidence

可以记录：

```text
chat
photo of environment where lawful
operator note
requester response
```

---

# 64. Mismatch Flow

```text
Agent reports mismatch
↓
Execution Hold
↓
Operator / Policy Review
↓
Continue / Modify with consent / Cancel
```

---

# 65. Location Access

Execution 期间精确位置权限必须：

```text
Order-bound
Purpose-bound
TTL
```

---

# 66. Location Revocation

任务结束 / 取消 / 到期：

```text
precise location grant
→ REVOKED
```

---

# 67. Emergency Contact Access

同样：

```text
only if needed
temporary
audited
```

---

# 68. Post-task Data Revocation

Order CLOSED 后自动撤销：

```text
precise live location
temporary phone
temporary emergency contact
execution-only access token
```

---

# 69. Chat Retention

Chat 可按：

```text
legal / dispute retention
```

保留。

但：

```text
private contact grants
```

仍需过期。

---

# 70. Contact Exchange

双方可能在 Chat 里主动发送：

```text
phone
Zalo
```

P0 可做：

```text
detect / warn
```

但平台不能完全依赖技术封锁。

---

# 71. Off-platform Value

应通过：

```text
Payment Protection
Evidence
Replacement
Dispute
Trusted Proxy
Repeat
```

让双方愿意继续走平台。

---

# 72. Requester View

Order 页面建议：

```text
Agent status
ETA
Arrived
In progress
Evidence
Completion
Payment protected
Contact / Chat
```

---

# 73. Agent View

建议：

```text
Where to go
When
What to do
Who to contact
What evidence required
How much I earn
Current execution state
```

---

# 74. Business View

多人 Task：

```text
Greeter 1 — Arrived
Greeter 2 — In progress
Greeter 3 — Late
Interpreter — Arrived
Content — Evidence submitted
```

---

# 75. Task Execution Read Model

Task 层聚合：

```text
required_slots
arrived
in_progress
completed
exceptions
replacement_required
```

---

# 76. No-show Detection

不能只因为：

```text
没有 GPS
```

就判 No-show。

必须综合：

```text
check-in
chat
grace window
business/requester confirmation
```

---

# 77. Agent No-show

建议成立条件：

```text
expected arrival passed
+
grace window passed
+
no valid arrival evidence
+
no approved exception
```

---

# 78. Requester No-show

如果 Agent：

```text
arrived
```

但：

```text
requester / venue unavailable
```

必须结构化记录。

---

# 79. Replacement Trigger

Agent No-show / Cancel：

如果：

```text
time still feasible
```

则：

```text
Slot reopen
→ Replacement MatchAttempt
```

---

# 80. In-progress Replacement

一般不建议：

```text
一个正在执行的真人任务直接换人
```

但对于：

```text
long event
shift role
```

P1 可支持：

```text
handover
```

---

# 81. Handover

P1：

```text
Order A partial completion
↓
Handover Evidence
↓
Order B replacement
```

---

# 82. Agent Check-in Fraud

风险信号：

```text
location spoof
reused photo
impossible travel
```

可以触发：

```text
risk review
```

但具体 Anti-fraud 后续单独设计。

---

# 83. Evidence Authenticity

P0 可保存：

```text
timestamp
metadata
source
upload hash
```

提高可审计性。

---

# 84. AI Evidence Review

P1 可以辅助：

```text
image / text consistency
checklist completeness
```

但：

> **AI 不应单独决定真人拿不到钱。**

高影响判定需：

```text
policy / human review
```

---

# 85. Execution Event Log

所有关键动作：

```text
EN_ROUTE
ARRIVED
STARTED
CHECKLIST_UPDATED
EVIDENCE_SUBMITTED
ISSUE_REPORTED
COMPLETED
```

写：

```text
ExecutionEvent
```

---

# 86. ExecutionEvent Schema

```text
event_id
order_id
event_type
actor_type
actor_id
timestamp
geo optional
metadata
```

---

# 87. Audit vs Event

ExecutionEvent：

```text
业务事实
```

AuditLog：

```text
谁修改了什么系统状态
```

二者都保留。

---

# 88. Idempotency

以下动作：

```text
arrive
start
submit evidence
confirm completion
report issue
```

必须幂等。

---

# 89. Offline Support

Agent 现场网络差：

P1 支持：

```text
local queue
timestamp
later sync
```

但高风险 Check-in 需保留：

```text
device time
server receive time
```

---

# 90. Evidence Storage

媒体不直接塞数据库。

保存：

```text
media reference
hash
metadata
```

底层存储可替换。

---

# 91. Retention Policy

不同 Evidence：

```text
transaction
safety
content
identity-adjacent
```

保留周期可不同。

---

# 92. Sensitive Media

如果 Evidence 含：

```text
faces
private documents
inside private venue
```

需要更高访问控制。

---

# 93. Content Separation

Chapter 06A 已锁：

```text
Public Content
```

与：

```text
Private Evidence
```

必须分开存权限。

---

# 94. Completion Outcome

Order 完成后输出：

```text
on_time
duration
evidence_complete
completion_confirmed
exception_count
replaced
repeat_eligible
```

供 Outcome Graph 使用。

---

# 95. Agent Passport Feedback

成功完成：

```text
Order Outcome
↓
Capability Passport
```

更新：

```text
Relevant Role Outcome
Reliability
Repeat relationship
```

---

# 96. Requester Trusted Proxy

完成后 Requester 可以：

```text
Save as Trusted Proxy
```

但不自动添加。

---

# 97. Business Trusted Team

Business 可以：

```text
Add to Trusted Team
```

用于未来 Direct Invite。

---

# 98. Rating Timing

Rating 不应该阻塞 Settlement。

可以：

```text
after completion
```

异步完成。

---

# 99. Metrics — Execution

```text
En-route Rate
Arrival Rate
On-time Rate
Start Rate
Completion Rate
Evidence Completion Rate
Exception Rate
No-show Rate
```

---

# 100. Metrics — Time

```text
Time Confirmed → En-route
En-route → Arrival
Arrival → Start
Completion → Settlement
```

---

# 101. Safety Metrics

```text
Safety Incident Rate
Task Mismatch Rate
Emergency Contact Access
Location Grant Duration
```

---

# 102. Privacy Metrics

```text
Temporary Contact Grants
Precise Location Grants
Expired Grants
Revocation Failures
Unauthorized Access Attempts
```

---

# 103. Guardrail Metrics

必须监控：

```text
Completed without evidence when evidence required
Precise location access after Order close
Chat access after revocation
No-show false positive
Settlement blocked by missing requester action
```

---

# 104. P0 必须实现

```text
ExecutionContext
Order Chat
Temporary Contact Grant
EN_ROUTE
ARRIVED
Check-in Policy
GPS / QR / Requester Confirm
IN_PROGRESS
Execution Instructions
Evidence Policy
Photo / Video / Text / Checklist / GPS Evidence
Completion Submission
Requester Confirm
Auto-confirm
Execution Exception
No-show
Replacement Trigger
Location TTL
Post-task Permission Revocation
ExecutionEvent
Audit
```

---

# 105. P1

```text
SOS
Safety Center
Offline Check-in
AI Evidence Assist
Partial Completion
Shift Handover
Advanced QR / Access Control
Masked Phone Provider
```

---

# 106. Acceptance Criteria

## AC-EXEC-01
Order 必须有独立 ExecutionContext。

## AC-EXEC-02
Order Chat 必须绑定 order_id，不得成为通用好友聊天。

## AC-EXEC-03
Match 后只开放完成任务所需的数据。

## AC-EXEC-04
Temporary Contact 必须有 Purpose / TTL / Audit。

## AC-EXEC-05
EN_ROUTE 不得要求持续 GPS Tracking。

## AC-EXEC-06
ARRIVED 必须由 Check-in Evidence 支撑。

## AC-EXEC-07
Check-in 必须支持至少 GPS / QR / Requester Confirm 中的可配置方式。

## AC-EXEC-08
Late 不应成为独立 Order 主状态。

## AC-EXEC-09
IN_PROGRESS 前后 Cancellation Policy 可以不同。

## AC-EXEC-10
Execution Instructions 必须版本化 / Snapshot。

## AC-EXEC-11
重大任务变更不得通过 Chat 静默完成。

## AC-EXEC-12
Evidence 必须是结构化对象。

## AC-EXEC-13
Evidence Requirement 必须支持 REQUIRED / OPTIONAL / NOT_ALLOWED。

## AC-EXEC-14
私人场景必须允许禁止 Photo / Video Evidence。

## AC-EXEC-15
Task Evidence 默认不得公开。

## AC-EXEC-16
Evidence → Content 必须经过额外 Consent / Rights / Privacy Check。

## AC-EXEC-17
Completion Submission 前必须检查 Required Evidence。

## AC-EXEC-18
Requester 不能通过单方面 Reject 直接让 Agent 收入归零。

## AC-EXEC-19
必须支持 Auto-confirm，避免 Requester 不操作导致无限等待。

## AC-EXEC-20
Exception 与 Dispute 必须是独立概念。

## AC-EXEC-21
必须区分 Agent No-show 与 Requester No-show。

## AC-EXEC-22
No-show 判定不能只依赖单一 GPS 信号。

## AC-EXEC-23
安全风险必须允许 Agent 停止执行并上报。

## AC-EXEC-24
Material Task Mismatch 必须支持 Hold / Review。

## AC-EXEC-25
Precise Location 必须 Order-bound / Purpose-bound / TTL。

## AC-EXEC-26
Order 结束后必须自动撤销执行期敏感权限。

## AC-EXEC-27
Confirmed Order 的真实执行事件必须写 ExecutionEvent。

## AC-EXEC-28
关键 Execution Command 必须幂等。

## AC-EXEC-29
AI 可以辅助 Evidence Review，但不得单独做高影响支付裁决。

## AC-EXEC-30
Execution Outcome 必须反馈 Human Agent Outcome Graph。

---

# 107. 本章锁定结论

1. **Execution 是 Proxy 最核心的“线上撮合 → 现实完成”桥梁。**
2. **Order Chat 是交易工具，不是社交关系。**
3. **位置、电话、紧急联系人都必须临时、目的绑定、可撤销。**
4. **Arrival 必须有可验证 Check-in。**
5. **Evidence 是完成证明，不是全程监控。**
6. **私人场景允许明确禁止拍照 / 视频。**
7. **重大任务修改不能藏在 Chat 里。**
8. **Completion 必须有 Evidence / Confirmation / Auto-confirm 闭环。**
9. **Requester 不能单方面一句“不满意”就让真人收入归零。**
10. **Exception 与 Dispute 分离。**
11. **Agent No-show 与 Requester No-show 分离。**
12. **任务不安全或现场与描述严重不符时，Agent 有权暂停并上报。**
13. **Order 关闭后精确位置、临时电话、执行权限必须自动撤销。**
14. **真实执行结果必须回流 Passport、Reliability 与 Outcome Graph。**

---

# 108. 下一章

下一份增量 PRD：

> **Chapter 12 — Rating / Trust / Trusted Proxy / Repeat Relationship**

重点解决：

```text
任务做完以后怎么评价
星级到底要不要做
如何避免“颜值评分”
如何区分 Capability / Reliability / Safety
什么条件进入 Trusted Proxy
Business Trusted Team 怎么形成
复聘怎么越来越快
差评和争议怎么不互相污染
新 Agent 怎么避免被历史垄断
```

这会把一次性交易真正推进成长期信任与重复成交。

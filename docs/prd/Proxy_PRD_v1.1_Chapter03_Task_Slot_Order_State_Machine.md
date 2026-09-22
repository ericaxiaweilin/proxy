# Proxy PRD v1.1
## Chapter 03 — Task / TaskSlot / Order State Machine

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 02 — Capability Graph
- Chapter 02A — Real-world Scene Network（Strategic Extension）
- Chapter 02B — Human Agent Marketplace Foundations

**本章范围**：
- Task
- TaskSlot
- SlotGroup
- Order
- Task Source
- Readiness / Admission / Funding Gate
- Multi-slot
- Partial Fill
- Replacement
- Cancellation
- Execution
- Completion
- Concurrency
- Versioning
- Domain Events
- API Boundary

**本章不细化**：
- Agent 排名算法
- Offer Batch 算法
- Pricing 公式
- Refund 金额
- Payment Rail
- Safety Policy
- Dispute 判责
这些分别在后续章节定义。

---

# 1. 本章目标

本章解决 Proxy 真人交易系统最核心的问题：

1. 什么叫一个 Task；
2. 什么叫一个 Human Agent Slot；
3. 什么时候真正产生 Order；
4. 多人任务如何部分成交；
5. 一个 Agent 取消后如何 Replacement；
6. Task 修改后哪些匹配需要失效；
7. 多个 Agent 同时 Accept 如何避免重复成交；
8. Task / Slot / Order 如何分别终止；
9. 活动、Business、Scene 等不同来源如何进入同一交易主链；
10. 如何避免一个巨大 `status` 字段承载所有业务状态。

---

# 2. 三个核心对象

Proxy 的真人交易核心：

```text
Task
↓
TaskSlot
↓
Order
```

定义必须严格区分。

---

# 3. Task

Task 表示：

> **Requester 希望在现实世界完成的一个整体业务目标。**

例如：

```text
Saturday Grand Opening
Tây Hồ
18:00–21:00
```

Task 可以需要：

```text
Greeter ×3
Interpreter ×1
Content Talent ×1
```

Task 本身不直接绑定某一个 Agent。

---

# 4. TaskSlot

TaskSlot 表示：

> **一个必须由一个真人 Agent 占据并完成的原子执行位置。**

这是本章正式锁定的重要规则：

> **一个 TaskSlot = 一个真人位置 = 同一时间最多一个 Human Agent。**

因此：

```text
Greeter ×3
```

必须拆成：

```text
Slot G1 → Greeter
Slot G2 → Greeter
Slot G3 → Greeter
```

而不是：

```text
Slot Greeter
quantity = 3
```

---

# 5. 为什么 Slot 必须原子化

如果 `quantity = 3` 放在一个 Slot 内，会立即出现：

```text
其中 2 人已接受
1 人未接受
其中 1 人取消
其中 1 人迟到
其中 1 人争议
其中 2 人完成
```

一个 Slot 无法拥有三个不同状态。

因此：

```text
TaskSlot = one human position
```

是长期硬规则。

---

# 6. SlotGroup

为了 UI 和 Business 操作方便，可以有：

```text
SlotGroup
```

例如：

```text
Greeter ×3
```

UI 显示成一个组。

内部：

```text
SlotGroup GREETER_01
├── slot_g1
├── slot_g2
└── slot_g3
```

SlotGroup 只用于：

- 批量创建；
- UI 聚合；
- 批量预算；
- 批量取消未分配 Slot；
- Analytics。

真正交易仍然发生在 TaskSlot。

---

# 7. Order

Order 表示：

> **某一个 Human Agent 与某一个 TaskSlot 在双向确认后形成的正式履约关系。**

严格关系：

```text
1 Task
→ N TaskSlots

1 TaskSlot
→ 0..N historical Orders

1 TaskSlot
→ max 1 active Order

1 Order
→ exactly 1 Agent
```

为什么一个 Slot 可以有多个 historical Order？

因为 Replacement：

```text
slot_g1
├── order_001 Agent A CANCELLED
└── order_002 Agent B ACTIVE
```

历史 Order 不删除。

---

# 8. Order 什么时候产生

Candidate 被看到：

```text
NOT Order
```

Requester Shortlist：

```text
NOT Order
```

Requester Invite：

```text
NOT Order
```

Agent 收到 Offer：

```text
NOT Order
```

Soft Hold：

```text
NOT Order
```

只有：

```text
Valid Task
+
Open TaskSlot
+
Agent Eligible
+
Agent Accepted
+
Requester commitment satisfied
+
Funding gate satisfied
+
Atomic Slot Lock succeeds
```

以后才：

```text
Create Order
```

---

# 9. 双向确认原则

## Curated Match

```text
Requester selects / invites Agent
↓
Agent reviews Task
↓
Agent accepts
↓
Atomic Slot Assignment
↓
Order Created
```

## Fast Match

```text
Requester already authorizes qualified auto-match
↓
Qualified Offer sent
↓
Agent accepts
↓
Atomic Slot Assignment
↓
Order Created
```

两种模式最终都进入同一个：

```text
TaskSlot → Order
```

---

# 10. Task Source

所有 Human Agent 需求必须统一转换成 Task。

推荐：

```text
MANUAL_REQUESTER
BUSINESS_MANUAL
ACTIVITY
SCENE_RULE
SCENE_FORECAST
MEMBERSHIP_CAMPAIGN
SOCIAL_CAMPAIGN
RECURRING_TEMPLATE
OPERATOR
API_PARTNER
```

字段：

```text
source_type
source_id
source_context
```

---

# 11. Source 不建立独立订单体系

例如：

```text
Activity
↓
Agent Need
```

不能创建：

```text
ActivityAgentOrder
```

必须：

```text
Activity
↓
Task
↓
TaskSlot
↓
Order
```

同理：

```text
Scene Rule
Merchant Campaign
Membership Event
```

最终都复用统一交易主链。

---

# 12. P0 自动化边界

Scene / Forecast / Campaign 自动产生需求时：

P0 默认只能：

```text
CREATE_DRAFT_TASK
```

或者：

```text
SUGGEST_TASK
```

不能默认：

```text
AUTO_SPEND
AUTO_CREATE_PAID_ORDER
```

除非未来 Business 明确设置：

```text
Auto-publish Policy
Budget Cap
Role Allowlist
Time Window
```

---

# 13. Task Schema

推荐核心字段：

```text
task_id
created_by_user_id

principal_type
principal_id

source_type
source_id

industry_id
scenario_id
graph_version

title
description

venue_id optional
location
timezone

start_at
end_at
arrival_target
matching_deadline

match_mode

task_version

lifecycle_status
admission_status
funding_status

created_at
updated_at
```

---

# 14. Task 不使用一个巨大 Status

一个 Task 同时可能出现：

```text
Active
4/5 Filled
1 Replacement Required
2 Agents In Progress
Payment Secured
```

如果全部塞进：

```text
task.status
```

一定会产生状态爆炸。

因此 Task 至少拆成多个正交维度。

---

# 15. Task Lifecycle Status

正式定义：

```text
DRAFT
READY
COMMITTED
ACTIVE
COMPLETION_PENDING
COMPLETED
CANCELLED
EXPIRED
REJECTED
```

---

# 16. Task Lifecycle — DRAFT

含义：

```text
Requester / System 正在创建
```

允许：

- 修改 Industry；
- 修改 Scenario；
- 修改 Role；
- 增删 Slot；
- 修改时间；
- 修改地点；
- 修改 Requirement；
- 修改预算。

不允许：

- 展示 Candidate；
- 发送 Offer；
- 创建 Order。

---

# 17. Task Lifecycle — READY

含义：

> Task 已通过基础结构验证，可以进入正式确认。

必须满足：

```text
principal valid
graph resolved
required slots exist
time valid
location valid if required
deliverable defined
budget structure valid
admission not rejected
```

但 Requester 尚未完成 Commitment。

---

# 18. Task Lifecycle — COMMITTED

含义：

Requester 已确认：

```text
Task
Slots
Requirements
Budget
Cancellation Terms
```

并满足当时要求的：

```text
Funding / Authorization Gate
```

此时：

> Task 可以进入 Marketplace。

---

# 19. Task Lifecycle — ACTIVE

含义：

至少一个有效 TaskSlot 仍处于：

```text
OPEN
ASSIGNED
IN_PROGRESS
COMPLETION_PENDING
```

Task 正在真实交易 / 履约阶段。

COMMITTED 通常立即进入 ACTIVE。

---

# 20. Task Lifecycle — COMPLETION_PENDING

含义：

所有 Required Slots 已经进入终态或待完成确认，

系统正在等待：

```text
Evidence Review
Requester Confirmation
Exception Resolution
```

---

# 21. Task Lifecycle — COMPLETED

表示：

> Task 交易生命周期结束，并得到最终 Outcome。

注意：

```text
COMPLETED
```

不代表：

```text
100% perfect success
```

Task 还需要：

```text
task_outcome
```

---

# 22. Task Outcome

推荐：

```text
FULL_SUCCESS
PARTIAL_SUCCESS
FAILED
CANCELLED
```

例如：

```text
5 required slots
4 completed
1 unfilled
```

Task 可能：

```text
lifecycle_status = COMPLETED
task_outcome = PARTIAL_SUCCESS
```

这样比创造：

```text
COMPLETED_PARTIALLY_WITH_ONE_NO_SHOW
```

更干净。

---

# 23. Task Lifecycle — CANCELLED

Requester / Business 主动取消整个 Task。

必须记录：

```text
cancelled_by
cancellation_reason
cancelled_at
```

并对各 Slot / Order 分别执行取消流程。

---

# 24. Task Lifecycle — EXPIRED

典型：

```text
matching deadline passed
+
no viable execution path
```

或者：

```text
start time passed
+
Task never entered execution
```

不能无限保持 ACTIVE。

---

# 25. Task Lifecycle — REJECTED

Task Admission 拒绝。

例如：

```text
Prohibited Task
Risk Review Rejected
Invalid Business Use
```

Rejected Task：

```text
never enters matching
```

---

# 26. Task Admission Status

与 Lifecycle 分开：

```text
NOT_REQUIRED
PENDING
APPROVED
REVIEW_REQUIRED
REJECTED
```

后续 Safety / Moderation 章节定义具体规则。

---

# 27. Task Funding Status

与 Lifecycle 分开：

```text
NOT_REQUIRED
PENDING
AUTHORIZED
SECURED
FAILED
RELEASED
REFUNDING
REFUNDED
```

具体钱如何走，在 Payment 章节定义。

本章只定义：

> Order Creation 所需 Funding Gate 必须满足。

---

# 28. Task Fulfillment Status

这是由 Required Slots 派生的状态。

推荐：

```text
NONE
OPEN
PARTIAL
FULL
REPLACEMENT_REQUIRED
UNFILLED
```

不要允许客户端直接修改。

---

# 29. Fulfillment 派生规则

假设 Required Slots = 5。

## OPEN

```text
0 assigned
5 open
```

## PARTIAL

```text
1–4 assigned/completed
remaining open
```

## FULL

所有 Required Slots 当前都有：

```text
active assigned order
or
completed order
```

## REPLACEMENT_REQUIRED

至少一个曾被 Assigned 的 Required Slot：

```text
active order lost
+
execution still feasible
```

## UNFILLED

matching deadline / start boundary 到达，
仍存在 Required Slot 无法填满。

---

# 30. Task Execution Status

也是派生维度：

```text
NOT_STARTED
UPCOMING
IN_PROGRESS
ENDING
FINISHED
EXCEPTION
```

例如：

```text
Task.lifecycle = ACTIVE
Task.fulfillment = REPLACEMENT_REQUIRED
Task.execution = IN_PROGRESS
```

这就是现实业务真正需要表达的状态。

---

# 31. TaskSlot Schema

推荐：

```text
slot_id
task_id
slot_group_id optional

role_id
slot_priority

must_have[]
nice_to_have[]
attribute_requirements[]
channel_requirements[]

budget
price_unit

slot_version

lifecycle_status
replacement_generation

current_order_id optional

created_at
updated_at
```

---

# 32. Slot Priority

推荐：

```text
REQUIRED
OPTIONAL
```

Task 是否算 Fully Filled：

> 默认只看 REQUIRED Slots。

Optional Slot 未填：

不阻止 Task：

```text
FULL
```

但 UI 应显示：

```text
Required 5/5
Optional 1/2
```

---

# 33. TaskSlot Lifecycle

正式定义：

```text
DRAFT
OPEN
ASSIGNED
IN_PROGRESS
COMPLETION_PENDING
COMPLETED
CANCELLED
UNFILLED
```

---

# 34. Slot — DRAFT

仍属于 Task Draft。

不能：

```text
match
invite
offer
assign
```

---

# 35. Slot — OPEN

表示：

> 这是一个当前可被一个 Human Agent 填充的真人位置。

可以进入：

```text
Fast Match
Curated Match
Repeat Invite
Replacement Match
```

---

# 36. Slot 在 Candidate / Offer 期间仍然是 OPEN

非常重要。

这些状态：

```text
Candidate Generated
Invite Sent
Offer Delivered
Agent Viewed
```

不能直接修改：

```text
TaskSlot.lifecycle
```

应该由：

```text
MatchAttempt
MatchOffer
Invite
SupplyReservation
```

等独立对象表示。

Slot 仍然：

```text
OPEN
```

直到真正原子分配成功。

---

# 37. Slot — ASSIGNED

只有在：

```text
Order Created
```

后进入。

必须满足：

```text
current_order_id != null
```

---

# 38. Slot — IN_PROGRESS

绑定 Order 已经进入实际执行。

例如：

```text
Agent ARRIVED / IN_PROGRESS
```

Slot 同步进入：

```text
IN_PROGRESS
```

---

# 39. Slot — COMPLETION_PENDING

Agent 已提交完成 Evidence，

但仍等待：

```text
Requester Review
Auto Confirmation
Dispute Window
```

---

# 40. Slot — COMPLETED

该真人位置已经完成要求。

必须有：

```text
successful / resolved Order history
```

---

# 41. Slot — CANCELLED

该位置不再需要真人。

例如：

```text
Requester removes optional role
Business reduces open capacity
Whole Task cancelled
```

---

# 42. Slot — UNFILLED

表示：

> 这个真人位置本来需要，但在有效时间内没有找到可执行 Agent。

必须保留。

不能直接删除 Slot。

这对：

```text
Fill Rate
Lost Demand
Supply Gap
```

极其重要。

---

# 43. Replacement

Agent 在 ASSIGNED 后取消：

```text
Order A → CANCELLED
```

如果：

```text
Task still active
Time still feasible
Requester still needs slot
```

则：

```text
Slot
ASSIGNED
→ OPEN

replacement_generation
0 → 1
```

然后：

```text
Replacement Matching
```

---

# 44. Replacement 不创建新 Slot

同一个现实需求仍然是：

```text
slot_g1
```

所以：

> Replacement 创建新的 Order，不创建新的 TaskSlot。

正确：

```text
slot_g1
├── order_A CANCELLED
└── order_B CONFIRMED
```

---

# 45. Replacement 什么时候不发生

例如：

```text
Requester no longer needs slot
Task already ended
Time impossible
Safety blocks task
```

则 Slot：

```text
CANCELLED
or
UNFILLED
```

不重新匹配。

---

# 46. Order Schema

推荐：

```text
order_id
task_id
slot_id
agent_id

order_generation

confirmed_at
scheduled_start_at
scheduled_end_at

execution_status
dispute_status
payment_status_reference

cancellation_actor
cancellation_reason

created_at
updated_at
```

---

# 47. Order Lifecycle

正式定义：

```text
CONFIRMED
EN_ROUTE
ARRIVED
IN_PROGRESS
EVIDENCE_SUBMITTED
COMPLETION_REVIEW
COMPLETED
CLOSED
CANCELLED
```

---

# 48. Order — CONFIRMED

含义：

```text
Human Agent
+
TaskSlot
```

已经形成正式交易关系。

此时可以解锁：

```text
Task Chat
Necessary Venue Details
Execution Instructions
```

---

# 49. Order — EN_ROUTE

Agent 主动表示：

```text
I am heading to the task
```

或由允许的执行信号触发。

不等于：

```text
ARRIVED
```

---

# 50. Order — ARRIVED

到场已确认。

可以由：

```text
GPS Check-in
QR
Merchant Confirmation
Requester Confirmation
Access Control
```

支持。

不要求人脸识别。

---

# 51. Order — IN_PROGRESS

现实任务已经开始执行。

从这一状态开始：

```text
Cancellation
```

通常进入更严格规则。

具体费用由 Cancellation / Payment 章节定义。

---

# 52. Order — EVIDENCE_SUBMITTED

Agent 已提交 Task 要求的完成证据。

例如：

```text
GPS
Photo
Checklist
Duration
Post URL
```

---

# 53. Order — COMPLETION_REVIEW

等待：

```text
Requester Confirmation
Auto Confirmation
Evidence Validation
```

---

# 54. Order — COMPLETED

履约已经确认完成。

但资金可能仍然：

```text
settlement pending
```

因此不把支付结算硬塞进 Execution Lifecycle。

---

# 55. Order — CLOSED

表示：

```text
Execution completed
+
Payment settled / resolved
+
Dispute window handled
```

Order 完全关闭。

---

# 56. Order — CANCELLED

任何执行前后取消最终统一进入：

```text
CANCELLED
```

不要创建：

```text
CANCELLED_BY_AGENT
CANCELLED_BY_REQUESTER
CANCELLED_AFTER_ARRIVAL
...
```

这些通过结构化字段表达：

```text
cancellation_actor
cancellation_reason
cancelled_from_status
cancelled_at
```

---

# 57. Dispute Status 独立

Order 不使用：

```text
DISPUTED
```

代替执行状态。

推荐正交：

```text
NONE
OPEN
UNDER_REVIEW
RESOLVED
```

例如：

```text
execution_status = COMPLETION_REVIEW
dispute_status = OPEN
```

更加清晰。

---

# 58. Payment Status 独立

同理：

```text
Order Execution
```

与：

```text
Payment
```

分开。

例如：

```text
execution_status = COMPLETED
payment_status = HELD
```

可以合法存在。

---

# 59. 一个 Slot 同时只能有一个 Active Order

核心数据库约束：

```text
max_active_orders_per_slot = 1
```

Active 定义：

```text
CONFIRMED
EN_ROUTE
ARRIVED
IN_PROGRESS
EVIDENCE_SUBMITTED
COMPLETION_REVIEW
COMPLETED
```

直到旧 Order 被：

```text
CANCELLED
or CLOSED
```

且业务允许 Replacement / new assignment。

---

# 60. First Accept Atomic Lock

Fast Match 可能同时给多个 Agent Offer。

例如：

```text
A accepts at 18:01:01.120
B accepts at 18:01:01.180
```

必须使用：

```text
Atomic Slot Assignment
```

只有一个成功。

结果：

```text
A → ORDER_CREATED
B → SLOT_ALREADY_FILLED
```

不能产生两个 Order 再人工修。

---

# 61. Slot Assignment Version

推荐：

```text
assignment_version
```

或数据库：

```text
optimistic lock / compare-and-set
```

确保：

```text
OPEN
→ ASSIGNED
```

只成功一次。

---

# 62. Stale Offer Revocation

Slot 成功 Assigned 后：

所有仍有效：

```text
MatchOffer
Invite
Candidate Batch Token
```

必须被标记：

```text
REVOKED_SLOT_FILLED
```

不能继续 Accept。

---

# 63. Agent Schedule Conflict

默认一个 Human Agent：

> 同一时间只能实际执行一个物理 TaskSlot。

Order 创建前必须检查：

```text
existing confirmed order overlap
```

如果重叠：

```text
ASSIGNMENT_REJECTED_CONFLICT
```

P1 可以支持：

```text
remote task
multi-capacity virtual role
```

但线下真人 Task 默认 capacity = 1。

---

# 64. Cross-role 不等于多占 Slot

一个 Agent 可以同时具备：

```text
Greeter
Interpreter
```

但如果活动同时需要：

```text
Greeter ×1
Interpreter ×1
```

同一时间默认仍需要：

```text
2 Human Slots
```

除非 Requester 明确创建：

```text
Hybrid Role
```

例如：

```text
Bilingual Greeter
```

不能因为 Agent 会两项能力就自动少算一个真人。

---

# 65. Task Edit Policy

Task 编辑必须分等级。

---

# 66. L0 — Cosmetic Edit

例如：

```text
Title wording
Internal note
Non-binding description
```

不影响：

```text
Eligibility
Candidate
Order
```

可以直接更新。

---

# 67. L1 — Matching-Relevant Edit

例如：

```text
Must-have
Nice-to-have
Budget
Radius
Arrival target
```

对 OPEN Slots：

```text
slot_version++
invalidate stale candidate / offer if needed
rerun matching
```

---

# 68. L2 — Contract-Relevant Edit

例如：

```text
Role
Start Time
End Time
Exact Venue
Core Deliverable
Pay reduction
High-impact requirement
```

对已经 ASSIGNED 的 Slot：

> 不能静默修改。

必须：

```text
Change Proposal
↓
Agent Re-consent
```

否则：

```text
Old Order terms remain
```

或者走取消 / 重建。

---

# 69. Assigned Order 不被后台静默改合同

正式硬规则：

> **任何影响真人实际工作内容、时间、地点、价格、安全的修改，都必须重新获得 Agent 同意。**

---

# 70. Task Version

每次重要修改：

```text
task_version++
```

Order 必须记录：

```text
accepted_task_version
accepted_slot_version
```

这样争议时可以知道：

> Agent 当时接受的是哪一个版本。

---

# 71. Graph Version

Task 同时继续记录：

```text
graph_version
```

Task Version 与 Graph Version 不同：

```text
task_version
= this task changed

graph_version
= platform requirement definitions version
```

---

# 72. Matching Deadline

Task 应明确：

```text
matching_deadline
```

例如：

```text
Task start 18:00
Matching deadline 17:30
```

到期后 OPEN Required Slots：

根据策略：

```text
UNFILLED
or
Operator Extension
```

不能一直 OPEN。

---

# 73. Task Start Boundary

当：

```text
start_at reached
```

系统应重新检查：

```text
Assigned
Open
Replacement
```

仍然 OPEN 且无法合理到达的 Slot：

```text
UNFILLED
```

同时记录：

```text
lost_demand_reason
```

---

# 74. Multi-slot Partial Fill

例如：

```text
Required Slots = 5

Assigned = 4
Open = 1
```

Task：

```text
lifecycle = ACTIVE
fulfillment = PARTIAL
```

不能因为 4 个 Order 已经创建，就：

```text
Task = COMPLETED
```

---

# 75. Multi-slot During Execution

例如活动已经开始：

```text
4 Agents working
1 Agent no-show
```

可以表示：

```text
Task.lifecycle = ACTIVE
Task.execution = IN_PROGRESS
Task.fulfillment = REPLACEMENT_REQUIRED
```

无需创造新的复杂 Task Status。

---

# 76. Task Completion Rule

进入：

```text
COMPLETION_PENDING
```

的条件：

所有 Required Slots 都已经：

```text
COMPLETED
CANCELLED
UNFILLED
```

或有明确 Exception Resolution。

---

# 77. Full Success

例如：

```text
5 Required Slots
5 Completed
```

得到：

```text
task_outcome = FULL_SUCCESS
```

---

# 78. Partial Success

例如：

```text
5 Required
4 Completed
1 Unfilled
```

得到：

```text
task_outcome = PARTIAL_SUCCESS
```

平台必须保留这个业务结果。

---

# 79. Failed

例如：

```text
0 Required Slots successfully executed
```

或者核心任务目标未达成。

可以：

```text
task_outcome = FAILED
```

具体失败判定规则可按 Scenario 配置。

---

# 80. Whole Task Cancellation

Requester 取消 Task：

## Open Slots

```text
OPEN → CANCELLED
```

## Assigned Slots

不能直接改 Slot。

先：

```text
Order Cancellation Flow
```

成功后：

```text
Order → CANCELLED
Slot → CANCELLED
```

具体费用后续章节定义。

---

# 81. Partial Slot Cancellation

Business 可以：

```text
cancel only 1 open Greeter slot
```

而不取消整个 Task。

这就是 Slot 原子化的价值。

---

# 82. Reduce Quantity

例如：

```text
Greeter ×5
→ Greeter ×3
```

系统应优先取消：

```text
OPEN Slots
```

不能自动取消：

```text
ASSIGNED Slots
```

如果必须减少 Assigned：

需要显式：

```text
Cancel Assigned Order
```

并适用 Cancellation Policy。

---

# 83. Increase Quantity

例如：

```text
Greeter ×3
→ Greeter ×5
```

做法：

```text
create 2 new TaskSlots
```

旧 Slot 不修改。

---

# 84. Recurring Task

Recurring 不应该是一个永远活着的 Task。

正确：

```text
TaskTemplate
↓
Schedule
↓
Task Instance 1
Task Instance 2
Task Instance 3
```

每个实例：

```text
独立 Slot
独立 Order
独立 Payment
独立 Outcome
```

---

# 85. Repeat Task

Requester 点击：

```text
Repeat
```

应复制：

```text
TaskTemplate / Previous Task Structure
```

生成：

```text
New Draft Task
```

而不是重新打开已完成 Task。

---

# 86. Trusted Proxy Rehire

Repeat Task 可以：

```text
prefill preferred_agent_id
```

但仍然必须：

```text
Agent Availability
Eligibility
Agent Accept
```

历史合作不是强制派单。

---

# 87. Order 不允许换 Agent

一旦：

```text
order.agent_id = A
```

不能修改成：

```text
agent_id = B
```

Replacement 必须：

```text
Order A CANCELLED
Create Order B
```

保证审计完整。

---

# 88. Order 不允许换 Slot

同理：

```text
order.slot_id
```

创建后不可变。

如果匹配错 Slot：

```text
Cancel
+
Create correct Order
```

---

# 89. Idempotency

以下命令必须支持 Idempotency Key：

```text
Commit Task
Assign Slot
Create Order
Accept Offer
Cancel Order
Submit Evidence
Confirm Completion
```

避免：

```text
double click
network retry
webhook retry
```

创建重复交易。

---

# 90. State Transition Guard

任何状态更新必须：

```text
Current State
+
Command
+
Permission
+
Business Rule
=
Next State
```

禁止客户端：

```text
PATCH status = COMPLETED
```

直接任意跳转。

---

# 91. State Transition Audit

每次变更记录：

```text
entity_type
entity_id
from_state
to_state
actor_type
actor_id
reason_code
command_id
task_version
timestamp
```

---

# 92. Task Domain Events

推荐：

```text
TASK_CREATED
TASK_READY
TASK_COMMITTED
TASK_ACTIVATED
TASK_UPDATED
TASK_CANCELLED
TASK_EXPIRED
TASK_COMPLETION_PENDING
TASK_COMPLETED
```

---

# 93. Slot Domain Events

```text
SLOT_CREATED
SLOT_OPENED
SLOT_ASSIGNED
SLOT_REOPENED
SLOT_STARTED
SLOT_COMPLETION_PENDING
SLOT_COMPLETED
SLOT_CANCELLED
SLOT_UNFILLED
```

---

# 94. Order Domain Events

```text
ORDER_CONFIRMED
ORDER_EN_ROUTE
ORDER_ARRIVED
ORDER_STARTED
ORDER_EVIDENCE_SUBMITTED
ORDER_COMPLETION_REVIEW
ORDER_COMPLETED
ORDER_CANCELLED
ORDER_CLOSED
```

---

# 95. Domain Event 用途

事件可以驱动：

```text
Notification
Analytics
Payment
Replacement
Availability Update
Merchant Dashboard
Safety
Outcome Learning
```

业务模块不要相互直接写对方状态。

---

# 96. Task Read Model

Requester UI 不应该自己计算复杂状态。

后端返回：

```json
{
  "task_id": "...",
  "lifecycle": "ACTIVE",
  "fulfillment": "PARTIAL",
  "execution": "UPCOMING",
  "required_slots": {
    "total": 5,
    "assigned": 4,
    "open": 1,
    "completed": 0
  }
}
```

---

# 97. Business Dashboard Read Model

例如：

```text
Saturday Grand Opening

Required Slots
4 / 5 Filled

Greeter
3 / 3

Interpreter
1 / 1

Content Talent
0 / 1

Next Action:
Find 1 Content Talent
```

这才是 Business 真正关心的业务状态。

---

# 98. Agent Read Model

Agent 不需要看到 Task 内所有候选人。

只需要：

```text
My Order
Task Context
Time
Location
Deliverables
Pay
Requester Trust
Execution State
```

---

# 99. Privacy Boundary

Order 创建前：

Agent 不获得：

```text
unnecessary precise requester data
private venue contacts
unrelated personal information
```

Order 创建后：

仅按：

```text
Execution Need
```

开放必要字段。

---

# 100. Task Snapshot for Order

Order 创建时必须保存：

```text
AcceptedTaskSnapshot
```

至少包含：

```text
role
time
location level needed
deliverables
pay
must-have
cancellation terms
safety instructions
```

这样后续 Task 修改不会改写历史合同事实。

---

# 101. Task Deletion

任何已经：

```text
COMMITTED
```

或产生过：

```text
Candidate / Offer / Order
```

的 Task：

不能物理删除。

只能：

```text
CANCELLED
EXPIRED
REJECTED
COMPLETED
```

并按 retention policy 保存。

---

# 102. Slot Deletion

同理：

已经 OPEN 过的 Slot 不物理删除。

可以：

```text
CANCELLED
```

保证 Lost Demand / Audit 数据完整。

---

# 103. API — Task Commands

建议：

```text
POST /tasks
POST /tasks/{id}/validate
POST /tasks/{id}/commit
POST /tasks/{id}/activate
POST /tasks/{id}/cancel
POST /tasks/{id}/complete
```

---

# 104. API — Slot Commands

```text
POST /tasks/{task_id}/slots
POST /slots/{id}/open
POST /slots/{id}/cancel
POST /slots/{id}/reopen
```

不提供：

```text
PATCH /slot/status
```

---

# 105. API — Order Commands

```text
POST /orders/{id}/en-route
POST /orders/{id}/arrive
POST /orders/{id}/start
POST /orders/{id}/submit-evidence
POST /orders/{id}/confirm-completion
POST /orders/{id}/cancel
```

---

# 106. Internal Assignment Command

内部：

```text
assign_agent_to_slot(
  slot_id,
  agent_id,
  source_match_id,
  expected_assignment_version
)
```

必须是：

```text
atomic
idempotent
audited
```

---

# 107. Core Invariants

正式锁定以下数据库 / Domain Invariant。

## INV-01

```text
TaskSlot belongs to exactly one Task
```

## INV-02

```text
TaskSlot represents exactly one Human Agent position
```

## INV-03

```text
One Slot has max one active Order
```

## INV-04

```text
One Order belongs to exactly one Slot
```

## INV-05

```text
One Order belongs to exactly one Agent
```

## INV-06

```text
Order.agent_id immutable
```

## INV-07

```text
Order.slot_id immutable
```

## INV-08

```text
Committed Task cannot be physically deleted
```

## INV-09

```text
Assigned contract-relevant changes require Agent re-consent
```

## INV-10

```text
Overlapping physical Orders for same Agent are rejected by default
```

---

# 108. Metrics Derived from State Machine

直接可以得到：

```text
Task Commit Rate
Slot Fill Rate
Time to Fill
Partial Fill Rate
Unfilled Slot Rate
Replacement Rate
No-show Rate
Arrival Rate
Completion Rate
Full Success Rate
Partial Success Rate
Task Cancellation Rate
Agent Cancellation Rate
```

---

# 109. Outcome Graph Feed

状态机必须向 Human Agent Outcome Graph 输出：

```text
Task Context
Slot Role
Capability Requirement
Agent
Accepted At
Arrival
Started
Completed
Cancellation
Replacement
Final Outcome
```

这是 Matching 学习的事实来源。

---

# 110. MVP P0

必须实现：

```text
Task
TaskSlot atomic model
SlotGroup
Order
Task version
Slot version
Task lifecycle
Slot lifecycle
Order lifecycle
Admission gate
Funding gate interface
Partial fill
Replacement
Cancellation
Atomic assignment
Domain event
Audit
```

---

# 111. P1

可以扩展：

```text
Auto-publish Scene Task
Hybrid Roles
Advanced Partial Completion
Enterprise Approval Chain
Bulk Multi-venue Task
Cross-city Task
Complex dependency between Slots
```

---

# 112. Acceptance Criteria

## AC-STATE-01
一个 Task 可以包含多个 TaskSlot。

## AC-STATE-02
一个 TaskSlot 必须表示一个真人位置。

## AC-STATE-03
`Greeter ×3` 必须生成 3 个原子 TaskSlot。

## AC-STATE-04
UI 可以通过 SlotGroup 聚合相同 Role。

## AC-STATE-05
Candidate / Invite / Offer 不得直接创建 Order。

## AC-STATE-06
只有双向确认与 Assignment Gate 成功后才创建 Order。

## AC-STATE-07
一个 Slot 同时最多存在一个 Active Order。

## AC-STATE-08
Replacement 创建新 Order，不创建新 Slot。

## AC-STATE-09
Cancelled Order 不得改写成另一个 Agent。

## AC-STATE-10
Order.agent_id 与 Order.slot_id 创建后不可修改。

## AC-STATE-11
Task 必须支持 Partial Fill。

## AC-STATE-12
Task Lifecycle、Fulfillment、Execution 必须分离。

## AC-STATE-13
Admission 与 Funding 必须是独立 Gate。

## AC-STATE-14
Task Outcome 必须支持 FULL_SUCCESS / PARTIAL_SUCCESS / FAILED / CANCELLED。

## AC-STATE-15
Optional Slot 未填不得阻止 Required Slots 达成 FULL。

## AC-STATE-16
Open Slot 到 Matching Deadline 后必须终止或明确延期。

## AC-STATE-17
Assigned Contract-relevant Task Edit 必须要求 Agent Re-consent。

## AC-STATE-18
Order 必须保存 accepted_task_version / accepted_slot_version。

## AC-STATE-19
Order 必须保存 Accepted Task Snapshot。

## AC-STATE-20
Fast Match 同时 Accept 必须使用 Atomic Slot Lock。

## AC-STATE-21
Slot Filled 后所有 stale Offer / Invite 必须失效。

## AC-STATE-22
同一 Human Agent 默认不能同时执行重叠物理 Order。

## AC-STATE-23
Cross-role Capability 不得自动减少真人 Slot 数量。

## AC-STATE-24
Whole Task Cancellation 必须分别处理 Open Slot 与 Active Order。

## AC-STATE-25
Reduce Quantity 必须优先取消 Open Slot，不能自动取消 Assigned Order。

## AC-STATE-26
Increase Quantity 必须新增 Slot，不修改已存在 Slot 的 quantity。

## AC-STATE-27
Recurring Task 必须产生独立 Task Instances。

## AC-STATE-28
所有 Task Source 最终必须进入统一 Task / Slot / Order 主链。

## AC-STATE-29
已经进入 Marketplace 的 Task / Slot 不得物理删除。

## AC-STATE-30
状态更新必须通过 Command + Transition Guard，不允许任意 PATCH status。

## AC-STATE-31
所有关键 Transition 必须写 Audit Event。

## AC-STATE-32
Domain Event 必须能驱动 Notification / Payment / Replacement / Analytics。

## AC-STATE-33
Scene / Activity 自动需求 P0 默认只能生成 Draft / Suggestion，不得自动支付发布。

## AC-STATE-34
Task Read Model 必须能直接返回 Slot Fill Summary。

## AC-STATE-35
状态机必须向 Human Agent Outcome Graph 输出真实履约事实。

---

# 113. 本章锁定结论

1. **Task = 一个现实业务目标。**
2. **TaskSlot = 一个原子真人位置。**
3. **Order = 一个真人 Agent 与一个 Slot 的正式履约关系。**
4. **多人需求通过多个原子 Slot 表达，不使用 `quantity > 1` 的交易 Slot。**
5. **SlotGroup 只做 UI / 批量管理，不承担交易状态。**
6. **Candidate / Invite / Offer 都不是 Order。**
7. **只有双向确认 + Atomic Assignment 成功才创建 Order。**
8. **一个 Slot 同时最多一个 Active Order。**
9. **Replacement 保留原 Slot，创建新 Order。**
10. **Task 使用 Lifecycle / Fulfillment / Execution 多维状态，避免状态爆炸。**
11. **Admission / Funding / Dispute / Payment 与执行状态分离。**
12. **Task 修改必须版本化；影响合同的修改必须 Agent 重新同意。**
13. **所有 Task 来源统一进入 Task / Slot / Order。**
14. **所有真实交易事实必须保留 Audit / Domain Event。**
15. **状态机最终服务的核心指标是 Slot Fill 与 Successful Human Execution。**

---

# 114. 下一章

下一份增量 PRD 建议：

> **Chapter 04 — Requester Demand Builder / 发布需求系统**

重点解决：

```text
用户如何从一句现实需求
↓
变成完整 Task
↓
拆 Slot
↓
选择 Must / Preference
↓
看到 Supply Impact
↓
确认预算与交付
↓
Commit
```

它会把 Chapter 02 的 Capability Graph 和 Chapter 03 的交易状态机真正接到用户界面。

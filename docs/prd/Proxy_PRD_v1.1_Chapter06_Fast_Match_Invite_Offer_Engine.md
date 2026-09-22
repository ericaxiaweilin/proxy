# Proxy PRD v1.1
## Chapter 06 — Fast Match / Invite / Offer Engine

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 04 — Requester Demand Builder
- Chapter 05 — Matching Engine / Eligibility & Ranking

**本章范围**：
- Curated Invite
- Fast Match Offer
- Offer Batch / Wave
- Offer Timeout
- Agent Accept / Decline
- Atomic Slot Assignment
- Offer Spam Control
- Urgent Replacement
- Offer Fairness
- Availability Interaction
- Agent Response Behavior
- Notification
- Offer Audit

---

# 1. 核心目标

Matching Engine 已经回答：

> 谁合格，谁更适合。

Offer Engine 要回答：

> **什么时候、以什么方式，把这个真实任务交到真人 Agent 面前，并最终形成一个 Order。**

核心主链：

```text
Qualified Candidate Pool
↓
Candidate / Offer Selection
↓
Invite / Offer
↓
Agent Reviews Task
↓
Accept / Decline / Timeout
↓
Atomic Slot Lock
↓
Order Created
```

---

# 2. 两种主要交易模式

## 2.1 Curated Match

Requester 先看有限候选，再邀请。

```text
Qualified Candidate Set
↓
Requester selects 1–3
↓
Invite
↓
Agent Accept
↓
First valid assignment wins
```

适合：

```text
Interpreter
Greeter
MC
UGC Creator
Professional Role
Brand-facing Role
```

---

## 2.2 Fast Match

Requester 已经授权 Proxy：

> 只要符合条件，直接帮我找最快能接的人。

```text
Qualified Pool
↓
Offer Engine
↓
Wave 1
↓
Accept?
├── Yes → Lock Slot
└── No / Timeout → Wave 2
```

适合：

```text
Queue Proxy
Pickup
Simple on-site support
Urgent replacement
Standardized role
```

---

# 3. Invite 与 Offer 分离

定义：

## Invite

Requester 主动发给某个 Candidate。

```text
source = REQUESTER_SELECTION
```

## Offer

系统自动推送给 Agent。

```text
source = FAST_MATCH
```

两者都不等于 Order。

---

# 4. MatchAttempt

推荐新增对象：

```text
MatchAttempt
```

表示：

> 某个 Slot 的一次正式撮合周期。

Schema：

```text
match_attempt_id
task_id
slot_id
match_mode
slot_version
ranking_version
started_at
ended_at
status
```

状态：

```text
ACTIVE
FILLED
EXHAUSTED
CANCELLED
STALE
```

---

# 5. Offer Object

```text
offer_id
match_attempt_id
task_id
slot_id
agent_id

source_type
wave_number
rank_at_send

status

sent_at
viewed_at
responded_at
expires_at

decline_reason
revocation_reason
```

---

# 6. Offer Status

```text
CREATED
SENT
DELIVERED
VIEWED
ACCEPTING
ACCEPTED
DECLINED
EXPIRED
REVOKED
ASSIGNMENT_LOST
FAILED
```

---

# 7. 为什么需要 ACCEPTING

用户点击：

```text
Accept
```

不等于一定已经拿到任务。

必须：

```text
ACCEPTING
↓
Eligibility Recheck
↓
Schedule Recheck
↓
Slot Atomic Lock
↓
Order Create
```

成功才：

```text
ACCEPTED
```

失败可能：

```text
ASSIGNMENT_LOST
```

---

# 8. Accept Final Gate

Agent 点击 Accept 后必须再次检查：

```text
Agent still ACTIVE
Risk still clear
Availability still valid
No schedule conflict
Task version unchanged
Slot version unchanged
Offer not expired
Slot still OPEN
Funding still valid
```

---

# 9. Atomic Assignment

唯一交易真相：

```text
Slot OPEN
+
CAS / Lock
→
Slot ASSIGNED
```

只有一个 Agent 成功。

其他 Agent：

```text
ASSIGNMENT_LOST
```

---

# 10. Fast Match 不建议“一次群发所有人”

禁止默认：

```text
100 qualified agents
→ notify all 100
```

原因：

```text
Agent spam
low trust
notification fatigue
race behavior
poor marketplace quality
```

---

# 11. Wave-based Offer

Fast Match 使用：

```text
Wave 1
Wave 2
Wave 3
...
```

每一 Wave 只发给有限 Agent。

---

# 12. P0 Wave Size

建议起始：

```text
Wave 1: 2–3 Agents
Wave 2: 3–5 Agents
Wave 3: 5–8 Agents
```

根据：

```text
urgency
role
supply depth
historical acceptance
```

动态调整。

---

# 13. Offer Concurrency

Simple / Urgent Task：

```text
parallel small batch
```

比严格单人顺序更适合。

原因：

```text
真人响应慢
App push 不稳定
有人会看但不回
```

---

# 14. Sequential Mode

对于：

```text
Trusted Proxy
High-value professional task
Exclusive direct invite
```

可以：

```text
Agent A only
↓
timeout
↓
Agent B
```

---

# 15. Wave Timeout

Offer TTL 必须：

```text
role-dependent
urgency-dependent
```

例如：

```text
Available Now / urgent:
1–3 min

Same-day:
5–10 min

Scheduled future task:
15–60 min
```

具体数值配置化。

---

# 16. Agent 必须看清楚再 Accept

Offer Card 至少显示：

```text
Role
Time
Approx Location
Duration
Pay
Key Must-have
Requester / Business Trust
Main Deliverable
Cancellation Terms summary
```

---

# 17. Order 前隐私

Offer 阶段不默认展示：

```text
exact private home address
phone number
private contact
full legal identity
```

必要精确数据在 Order 创建后再逐步开放。

---

# 18. Offer CTA

Agent：

```text
Accept
Decline
```

可选：

```text
Ask one clarification
```

但 Clarification 不能无限阻塞 Fast Match。

---

# 19. Decline Reason

推荐快速选项：

```text
TOO_FAR
PAY_TOO_LOW
TIME_NOT_GOOD
ROLE_NOT_INTERESTED
BUSY
TASK_CONTEXT
SAFETY_CONCERN
OTHER
```

---

# 20. Decline 不应默认惩罚

真人有权拒绝任务。

一次 Decline：

```text
no reputation penalty
```

但可以用于：

```text
future preference fit
acceptance prediction
```

---

# 21. Repeated Ignore

Agent 持续：

```text
Available Now
+
大量 Offer 不看不回
```

系统可以降低：

```text
offer priority
```

而不是降低：

```text
capability reputation
```

---

# 22. Available Now Contract

Agent 开启：

```text
Available Now
```

相当于告诉 Proxy：

```text
在这个时间 / 地区 / Role 范围内
可以给我发送更高频实时 Offer
```

因此允许更短 TTL。

---

# 23. Scheduled Availability

未来任务：

Offer 节奏更平缓。

避免：

```text
凌晨
无关推送
过多 reminder
```

---

# 24. Offer Frequency Cap

必须有：

```text
offers_per_hour
offers_per_day
```

上限。

且按：

```text
Agent engagement
Available Now
role preference
```

调整。

---

# 25. Duplicate Offer Protection

同一：

```text
agent_id
+
slot_id
+
match_attempt_id
```

不能重复创建有效 Offer。

---

# 26. Sibling Slot Protection

同一 Task：

```text
Greeter ×3
```

Agent 不应该同时收到：

```text
3 个完全一样的重叠 Slot Offer
```

默认聚合成：

```text
1 Offer
“Greeter role · 3 positions available”
```

Agent 接受后实际锁一个 Slot。

---

# 27. Multiple Slot Choice

如果同 Task 的 Slot：

```text
不同时间
```

可以分别发。

如果完全同时间：

一个真人只能拿一个。

---

# 28. Curated Invite Limit

Requester 初始建议：

```text
1–3 Invites per Slot
```

不是：

```text
select all
```

---

# 29. First Acceptance Policy

Curated 多 Invite：

默认：

```text
first valid accept
→ wins slot
```

其他 Invite：

```text
REVOKED_SLOT_FILLED
```

---

# 30. Optional Requester Final Approval

高价值 Task P1 可支持：

```text
Agent Accept
↓
Requester Final Confirm
```

但这会降低速度。

P0 默认不采用二次审批。

---

# 31. Fast Match Commitment

Requester 选择 Fast Match 前必须明确同意：

> Proxy 可以在所有满足你硬性要求的人中自动完成匹配。

---

# 32. Fast Match 不等于最低价

Fast Match 优化：

```text
fast successful execution
```

不是：

```text
cheapest agent
```

---

# 33. Fast Match Ranking Profile

更重视：

```text
availability
ETA
acceptance probability
reliability
```

---

# 34. Curated Ranking Profile

更重视：

```text
task fit
portfolio
relevant outcome
repeat relationship
```

---

# 35. Sponsored in Fast Match

不出售：

```text
guaranteed first order
```

可以出售：

> **Priority Offer Access**

但仍必须：

```text
Eligible
Safe
Available
Good Fit
```

---

# 36. Priority Offer Access

Sponsored Agent 可：

```text
更早进入某些符合条件的 Wave
```

但不能：

```text
绕过排名底线
```

---

# 37. Sponsored Wave Cap

一 Wave 中：

```text
Sponsored <= configured cap
```

避免整 Wave 全是付费 Agent。

---

# 38. Replacement MatchAttempt

已确认 Agent 取消：

```text
Slot REOPEN
replacement_generation++
```

创建：

```text
New MatchAttempt
type = REPLACEMENT
```

---

# 39. Replacement Priority

紧急 Replacement：

Ranking / Offer 更强调：

```text
arrival
acceptance
reliability
```

---

# 40. Replacement Message

Agent 应看到：

```text
Urgent replacement
Start in 45 min
```

不能隐藏紧迫性。

---

# 41. Replacement Incentive

未来可以：

```text
urgent premium
```

但由 Pricing 章节定义。

---

# 42. Escalation Ladder

当 Wave 失败：

```text
Wave 1
↓
Wave 2
↓
Relax Nice-to-have suggestion
↓
Expand distance suggestion
↓
Adjust time suggestion
↓
Raise reward suggestion
↓
Open Apply
↓
Operator Assist
↓
Unfilled
```

---

# 43. Hard Requirements 永不自动 Relax

即使最后一个 Wave：

```text
Must-have
```

也不能偷偷降低。

---

# 44. Open Apply

Supply 极薄时可以：

```text
Open Apply
```

但只能让：

```text
Eligible Agents
```

看到并申请。

不是公共任务墙。

---

# 45. Task Discovery Boundary

Agent 可看到：

```text
Matched for You
Relevant Open Apply
```

不应获得：

```text
全平台无限 Task Feed
```

---

# 46. Agent Home

建议：

```text
Available Now
Matched for You
Repeat Invitations
Upcoming
Earnings
Capability Progress
```

---

# 47. Offer Notification

渠道：

```text
Push
In-app
```

P1：

```text
SMS / Email
```

只用于高价值 / 紧急。

---

# 48. Offer Reminder

不要反复轰炸。

最多：

```text
initial
+
one reminder
```

如果 TTL 很短：

甚至只发一次。

---

# 49. Accept UX

点击 Accept 后：

```text
Checking availability...
```

成功：

```text
You got the task
```

失败：

```text
This position was just taken.
```

---

# 50. Assignment Lost UX

不能让 Agent 以为：

```text
平台骗我
```

要明确：

```text
Another qualified Proxy accepted moments earlier.
```

并可：

```text
Show next relevant offer
```

---

# 51. Offer Expiry

到：

```text
expires_at
```

自动：

```text
EXPIRED
```

之后 Accept 必须失败。

---

# 52. Task Changed

如果 Task 重大修改：

所有旧 Offer：

```text
REVOKED_TASK_CHANGED
```

新版本重新 Match。

---

# 53. Funding Lost

如果：

```text
payment authorization invalid
```

所有未完成 Offer：

```text
REVOKED_FUNDING
```

---

# 54. Risk Revocation

若 Task / Requester 进入 Risk Block：

```text
all active offers revoked
```

---

# 55. Agent Pause

Agent 点击：

```text
Pause
```

未接受 Offer：

可全部：

```text
withdraw
```

已确认 Order：

不受 Pause 自动取消。

---

# 56. Agent Offer Queue

避免同时显示太多。

建议：

```text
Urgent
Today
Upcoming
```

排序。

---

# 57. Offer Relevance Threshold

即使 ELIGIBLE，也不表示一定要发 Offer。

系统应设置：

```text
minimum offer relevance
```

避免低相关但勉强合格的任务污染 Agent 体验。

---

# 58. Agent Personalization

从 Decline 学习：

```text
喜欢什么 Role
什么时间
什么地区
什么价格
```

用于减少无效 Offer。

---

# 59. 不能学习非法偏好

平台不能因为：

```text
历史上某些人被更常接受
```

就自动推导并扩大：

```text
敏感属性偏见
```

---

# 60. Offer Fairness

Offer 不应永久集中给少量高响应 Agent。

可以给：

```text
New Qualified Agent
```

受控首次机会。

---

# 61. Fairness 不覆盖 Urgency

紧急任务：

```text
execution success
```

优先于公平探索。

---

# 62. Response Reliability

区分：

```text
Offer response reliability
```

与：

```text
Execution reliability
```

不混为一分。

---

# 63. Agent Fatigue

高频完成任务的 Agent：

可以降低：

```text
real-time offer volume
```

保护真人安全。

---

# 64. Quiet Hours

Agent 可配置：

```text
Do Not Disturb
```

除非：

```text
explicit Available Now
```

---

# 65. Business Direct Invite

Business Trusted Team：

```text
Invite An
Invite Minh
```

可以优先发送。

但仍需：

```text
current eligibility
availability
acceptance
```

---

# 66. Repeat Task Fast Path

Repeat Task：

```text
Trusted Proxy first
↓
if decline / timeout
↓
normal Match
```

可以显著提高复聘。

---

# 67. Offer Security

Offer Token 必须：

```text
single-use
short-lived
bound to agent
bound to slot
bound to task version
```

---

# 68. API

推荐：

```text
POST /slots/{id}/match-attempts
POST /offers/{id}/accept
POST /offers/{id}/decline
POST /offers/{id}/view
POST /offers/{id}/clarify
```

---

# 69. Accept API

必须：

```text
idempotent
atomic
```

返回：

```text
ORDER_CREATED
SLOT_ALREADY_FILLED
OFFER_EXPIRED
TASK_CHANGED
SCHEDULE_CONFLICT
RISK_BLOCK
```

---

# 70. Offer Audit

记录：

```text
agent
slot
wave
rank
organic/sponsored
sent
viewed
accepted
declined
expired
assignment result
```

---

# 71. Metrics

核心：

```text
Offer Delivery Rate
View Rate
Response Rate
Accept Rate
Time to Accept
Waves to Fill
Offer-to-Order
Assignment Lost Rate
Decline Reason
Spam Complaint Rate
```

---

# 72. Fast Match Metrics

```text
Median Time to Fill
P90 Time to Fill
Wave 1 Fill Rate
Replacement Fill Time
```

---

# 73. Agent Experience Metrics

```text
Offers per Active Hour
Relevant Offer Rate
Decline Rate
Mute Rate
Available Now Conversion
```

---

# 74. Acceptance Criteria

## AC-OFFER-01
Invite / Offer 都不是 Order。

## AC-OFFER-02
Agent 点击 Accept 后必须重新执行 Final Eligibility Gate。

## AC-OFFER-03
Order 只有 Atomic Slot Assignment 成功后创建。

## AC-OFFER-04
Fast Match 必须使用有限 Wave，不得默认群发所有 Qualified Agent。

## AC-OFFER-05
Offer 必须有 TTL。

## AC-OFFER-06
Slot Filled 后其他 Offer 必须立即失效。

## AC-OFFER-07
Agent Decline 单次不得作为 Reputation Penalty。

## AC-OFFER-08
Available Now 可以接受更高实时 Offer 频率。

## AC-OFFER-09
必须有 Offer Frequency Cap。

## AC-OFFER-10
同一 Slot 不得给同一 Agent 重复有效 Offer。

## AC-OFFER-11
同一时段同 Role 的 sibling Slots 应尽量聚合 Offer。

## AC-OFFER-12
Curated Invite 数量必须有限。

## AC-OFFER-13
Fast Match 不以最低价为目标。

## AC-OFFER-14
Sponsored 不能保证成交。

## AC-OFFER-15
Sponsored 只能影响符合资格的 Offer 顺序。

## AC-OFFER-16
Replacement 必须创建新的 MatchAttempt。

## AC-OFFER-17
Hard Requirement 永不自动 Relax。

## AC-OFFER-18
Open Apply 仍只能暴露给 Eligible Agent。

## AC-OFFER-19
Agent 端不得演变为无限任务墙。

## AC-OFFER-20
重大 Task 修改必须撤销旧 Offer。

## AC-OFFER-21
Risk / Funding 失效必须撤销未完成 Offer。

## AC-OFFER-22
Accept API 必须幂等、原子。

## AC-OFFER-23
Offer 必须完整 Audit。

---

# 75. 本章锁定结论

1. **Matching 给出 Qualified Pool，Offer Engine 负责真人响应。**
2. **Fast Match 使用小批次 Wave，而不是广播。**
3. **Agent Accept 后仍要 Final Gate + Atomic Slot Lock。**
4. **First valid assignment wins。**
5. **Decline 是正常真人行为，不直接处罚。**
6. **Available Now 是供给侧实时交易协议。**
7. **Offer Spam 必须限制。**
8. **Replacement 使用更紧急的 MatchAttempt。**
9. **Sponsored 可以更早获得 Qualified Offer Exposure，但不能买订单。**
10. **Offer Engine 最终优化 Time to Successful Human Assignment。**

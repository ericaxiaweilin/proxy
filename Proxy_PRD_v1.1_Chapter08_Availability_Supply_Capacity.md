# Proxy PRD v1.1
## Chapter 08 — Availability / Supply Capacity /「我现在有空」

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 05 — Matching Engine / Eligibility & Ranking
- Chapter 06 — Fast Match / Invite / Offer Engine
- Chapter 07 — Agent Capability Passport

**本章范围**：
- Availability Model
- Available Now
- Scheduled Availability
- Supply Capacity
- Role Scope
- Location / Work Area
- Min Pay / Task Preference
- Availability Session
- Calendar
- Overlap / Capacity Guard
- Offer Eligibility
- Location Privacy
- Supply Heat / Aggregate
- Agent Habit Loop
- Auto Expiry / Pause
- Supply Forecast Inputs
- API / Audit / Metrics

---

# 1. 本章目标

Availability 要回答：

> **这个真人 Agent 在什么时间、什么范围、以什么角色、什么最低交易条件，当前愿意接任务。**

Capability Passport 回答：

```text
Can this person do it?
```

Availability 回答：

```text
Can this person actually take it now / then?
```

二者必须分离。

---

# 2. 核心原则

> **Agent 有 Capability，不代表当前有 Supply。**

例如：

```text
An
Capability:
GREETER
ENGLISH_B2
```

但：

```text
Saturday 18:00
Not Available
```

则：

```text
INELIGIBLE
```

---

# 3. Supply Capacity 定义

Proxy 不把：

```text
registered agents
```

当作真实 Supply。

真实 Supply 是：

> **在指定时间窗口、地理范围、Role 和交易条件下，愿意且能够接受真人任务的 Capacity。**

因此：

```text
Supply
=
Capability
× Active Role
× Availability
× Time
× Location
× Price Preference
× Current Capacity
× Risk / Eligibility
```

---

# 4. Availability 的两种主模式

## 4.1 Available Now

Agent 临时告诉 Proxy：

> **我现在有空，可以给我推真人任务。**

## 4.2 Scheduled Availability

Agent 提前设置：

```text
Saturday 14:00–22:00
Sunday 09:00–18:00
```

用于未来任务匹配。

---

# 5. AvailabilitySession

正式新增：

```text
AvailabilitySession
```

Schema：

```text
availability_session_id
agent_id

mode
start_at
end_at

location_mode
anchor_location
work_radius

active_role_ids[]

min_pay
price_preference

status

created_at
updated_at
expires_at
```

---

# 6. Availability Mode

```text
NOW
SCHEDULED
```

未来可增加：

```text
RECURRING
```

---

# 7. Availability Status

```text
DRAFT
ACTIVE
PAUSED
OFFERED
MATCHED
EXPIRED
CLOSED
```

---

# 8. DRAFT

Agent 还在设置：

```text
时间
Role
范围
最低价格
```

不进入 Matching。

---

# 9. ACTIVE

表示：

> 当前 Availability 可以被 Matching Engine 消费。

---

# 10. PAUSED

Agent 临时：

```text
不想继续收到新任务
```

但保留 Session 配置。

---

# 11. OFFERED

Agent 当前存在一个或多个相关 Offer。

注意：

```text
OFFERED
```

只是 Supply Session 读模型状态。

不代表不能继续收到其他 Offer。

---

# 12. MATCHED

Agent 已经：

```text
accepted Order
```

导致本 Session 的当前 Capacity 被占用。

对于线下真人任务，默认：

```text
capacity = 1
```

---

# 13. EXPIRED

超过：

```text
end_at / expires_at
```

自动进入。

不能继续参加 Matching。

---

# 14. CLOSED

Agent 主动结束该 Availability Session。

---

# 15. Available Now 入口

Agent Home 最重要按钮之一：

```text
[ 我现在有空 ]
```

建议比：

```text
Browse Jobs
```

更突出。

这是 Proxy 供给侧 Habit Loop 的核心。

---

# 16. Available Now 快速流程

建议 10–20 秒可完成：

```text
我现在有空
↓
挂多久？
↓
在哪个范围？
↓
今天愿意做哪些 Role？
↓
最低多少钱？
↓
Go Available
```

---

# 17. Duration

P0 快捷：

```text
1 hour
2 hours
3 hours
4 hours
Until tonight
Custom
```

---

# 18. Active Role Selection

只能选择：

```text
AgentRole.status = ACTIVE
```

例如：

```text
✓ Greeter
✓ Interpreter
□ UGC Creator
```

不能挂未激活 / 不具备资格的 Role。

---

# 19. Role-specific Availability

Agent 可以：

```text
Available Now
Greeter = Yes
Interpreter = No
```

即使 Passport 两个都具备。

> **Capability ≠ current willingness.**

---

# 20. Location Mode

推荐：

```text
CURRENT_AREA
CUSTOM_AREA
REMOTE_ONLY
```

---

# 21. Current Area

Agent 可以授权：

```text
approximate current location
```

用于：

```text
ETA
Distance
Matching
```

但 Requester 不直接获得精确 GPS。

---

# 22. Custom Area

例如：

```text
Tây Hồ
Cầu Giấy
Bắc Ninh
```

Agent 可以告诉系统：

> 今天只在这个区域工作。

---

# 23. Remote Only

未来 Remote Human Agent：

```text
Moderator
Interpreter
Online Host
```

可：

```text
location_mode = REMOTE_ONLY
```

不计算物理 ETA。

---

# 24. Work Radius

P0：

```text
3 km
5 km
8 km
15 km
Custom
```

---

# 25. Location Privacy Rule

Agent Location 分层：

## L0
无 Task：
```text
不显示具体 Agent Location
```

## L1
Valid Task：
```text
Approx Distance / ETA
```

## L2
Matched：
```text
必要的执行协调位置
```

## L3
Execution：
```text
Precise location if required
TTL
```

---

# 26. No Nearby People

即使大量 Agent：

```text
Available Now
```

Requester 也不能打开地图看到：

```text
一个个真人头像
```

只允许：

```text
Qualified Supply
Heat
ETA
Capacity
```

---

# 27. Min Pay

Available Session 可以设置：

```text
Minimum Pay
```

例如：

```text
>= 500k
```

低于该门槛：

```text
Agent not eligible
```

---

# 28. Role-specific Min Pay

未来可：

```text
Greeter >= 500k
Interpreter >= 800k
```

P0 可以先：

```text
session-wide min pay
```

---

# 29. Availability Calendar

Agent 端提供：

```text
Today
Tomorrow
Week
```

看到：

```text
Available
Booked
Blocked
```

---

# 30. Calendar Source

Calendar 汇总：

```text
Scheduled Availability
Confirmed Orders
Manual Block
Unavailable Time
```

---

# 31. Manual Block

Agent 可以设置：

```text
Personal Busy
Do Not Match
```

不需要说明私人原因。

---

# 32. Confirmed Order 自动占用时间

一旦 Order：

```text
CONFIRMED
```

系统自动建立：

```text
Supply Reservation
```

占用：

```text
task execution window
+
travel buffer
```

---

# 33. SupplyReservation

推荐对象：

```text
supply_reservation_id
agent_id
order_id
start_at
end_at
capacity_units
status
```

---

# 34. Supply Capacity

对于 Physical Human Agent：

```text
capacity_units = 1
```

也就是说：

> 同一时间只能真实执行一个线下 Slot。

---

# 35. Remote Capacity

未来某些 Remote Role 可能支持：

```text
capacity > 1
```

但 P0 统一：

```text
capacity = 1
```

最安全。

---

# 36. Overlap Guard

创建 Order 前检查：

```text
existing reservations
+
travel buffer
```

如果冲突：

```text
INELIGIBLE
```

---

# 37. Travel Buffer

例如：

```text
Task A ends 17:30
Task B starts 18:00
```

不能只看不重叠。

还要：

```text
estimated travel time
+
safety buffer
```

---

# 38. Available Now + Existing Future Order

Agent：

```text
18:00 有 Order
```

15:00 开启：

```text
Available Now for 4 hours
```

系统实际可用窗口应截断：

```text
15:00 → latest feasible pre-order time
```

---

# 39. Auto-truncate

系统可以提示：

```text
You have a confirmed task at 18:00.
Available Now will end at 17:10.
```

不能产生冲突供给。

---

# 40. Scheduled Availability

Agent 设置：

```text
Saturday
14:00–22:00
```

Matching Future Task 可以使用。

---

# 41. Recurring Availability

P1：

```text
Every Saturday
14:00–22:00
```

但每次仍要检查：

```text
Orders
Manual Blocks
Risk
Role Status
```

---

# 42. Temporary Override

Agent 平常：

```text
Max distance = 8km
```

今天：

```text
Available Now
Max distance = 3km
```

当前 Session 以：

```text
3km
```

为准。

---

# 43. Availability Freshness

Available Now 必须有：

```text
freshness
```

因为人会忘记关闭。

---

# 44. Session TTL

例如：

```text
Agent says 3 hours
```

则：

```text
expires_at = start + 3h
```

到期自动关闭。

---

# 45. Auto Expiry

绝不允许：

```text
Available Now forever
```

否则 Supply 数据会快速失真。

---

# 46. Pause / Resume / Close

Agent 可以：

```text
Pause
Resume
I'm done for today
```

已确认 Order 不因 Pause / Close 自动取消。

---

# 47. Offer Interaction

收到 Offer：

不自动：

```text
Availability = MATCHED
```

只有成功创建 Order 后：

```text
capacity occupied
```

---

# 48. Multiple Offers

Agent 可以收到多个非冲突未来 Offer。

如果时间冲突：

Agent Accept 一个后：

```text
其他冲突 Offer 自动失效 / assignment fails
```

---

# 49. Availability Recheck

每次：

```text
Offer Accept
```

都必须重新检查：

```text
Session Active
Time
Capacity
Schedule
Role
Location
```

---

# 50. Supply Exposure

Availability 不等于公开：

```text
Agent 在线状态
```

Requester 只能看到：

```text
market-level availability
```

或 Task-specific Candidate。

---

# 51. Aggregate Supply

例如：

```text
9 qualified Agents available
```

允许。

不允许：

```text
9 个头像现在在线
```

---

# 52. Liquidity Cell

供给统计使用：

```text
Geo Zone
× Time Window
× Role
```

必要时：

```text
Critical Capability
```

---

# 53. Demand Pulse

P1 Agent 可看到匿名聚合需求：

```text
High demand tonight
Tây Hồ
Event Greeter
```

只显示：

```text
Role
Area
Time
Demand Level
Typical Pay Range
```

不是 Task Feed。

---

# 54. Agent Habit Loop

```text
Free Time
↓
Open Proxy
↓
Go Available
↓
Relevant Offers
↓
Accept
↓
Execute
↓
Earn
↓
Passport Improves
↓
Future Better Offers
```

---

# 55. Ghost Supply

如果 Agent：

```text
频繁挂 Available
但长期不响应 Offer
```

系统可以降低：

```text
availability confidence
```

但不能降低：

```text
Capability
```

---

# 56. Availability Confidence

内部可：

```text
HIGH
MEDIUM
LOW
```

基于：

```text
session freshness
recent response behavior
calendar certainty
```

---

# 57. Supply Preview

Demand Builder 可以显示：

```text
Qualified Supply
9 currently available
17 scheduled
Expected Fill: High
```

不显示具体真人。

---

# 58. Supply Types

推荐：

```text
REALTIME_CONFIRMED
SCHEDULED_CONFIRMED
PREDICTED
REGISTERED_ONLY
```

P0 主要展示：

```text
REALTIME_CONFIRMED
SCHEDULED_CONFIRMED
```

---

# 59. Predicted Supply

P1 可根据：

```text
historical availability
role
time
area
```

预测。

必须明确标记：

```text
Expected
```

不能当实时真值。

---

# 60. Agent Earnings Signal

Agent Home 可以显示：

```text
High demand for your roles tonight.
```

并提示：

```text
Go Available
```

但不要使用：

```text
You are losing money!
```

这类强迫式文案。

---

# 61. Availability + Boost

Boost 不能创造 Availability。

如果：

```text
not active supply
```

则：

```text
Boost not applied
```

---

# 62. Availability + Trusted Proxy

Trusted Agent 如果没挂 Available：

Requester 可以未来发：

```text
Direct Availability Request
```

而不是直接当成可用。

---

# 63. Business Trusted Team

Business 可以看到：

```text
3 trusted Proxies available for this Task
```

而不是看到他们当前精确位置。

---

# 64. Location Update Strategy

Available Now：

P0 优先：

```text
session start location
+
occasional refresh
+
accept-time ETA recheck
```

而不是：

```text
continuous tracking
```

---

# 65. Precise Location TTL

Execution 如需精确位置：

```text
Order context only
+
TTL
```

任务结束：

```text
revoke
```

---

# 66. Remote Availability

Remote Role 需要：

```text
Time
Role
Device / Network requirement
Platform access
```

不需要：

```text
work radius
```

---

# 67. Calendar Sync

P1 可接：

```text
Google Calendar
Apple Calendar
```

原则：

```text
read busy/free
```

而不是读取：

```text
meeting title
participants
notes
```

---

# 68. Supply Resolver

推荐：

```text
Capability
+
Role Status
+
Availability Session
+
Order Reservations
+
Manual Blocks
+
Risk
=
Effective Supply
```

---

# 69. EffectiveSupplySnapshot

内部：

```text
agent_id
role_id
time_window
geo_zone
status
confidence
source
computed_at
```

它是 time-bound Snapshot，不是长期身份。

---

# 70. Availability API

推荐：

```text
POST /agents/me/availability-sessions
PATCH /agents/me/availability-sessions/{id}
POST /agents/me/availability-sessions/{id}/pause
POST /agents/me/availability-sessions/{id}/resume
POST /agents/me/availability-sessions/{id}/close
GET /agents/me/calendar
```

---

# 71. Supply Check API

内部：

```text
POST /supply/evaluate
```

输入：

```text
agent
role
task time
location
```

输出：

```text
available
reason
confidence
```

---

# 72. Aggregate Supply API

Requester / Builder：

```text
POST /supply/aggregate
```

返回：

```text
qualified_count
realtime_count
scheduled_count
risk_level
```

不得返回 Agent IDs。

---

# 73. Audit

记录：

```text
session_created
activated
paused
resumed
expired
closed
matched
manual_override
```

精确位置访问另外记录：

```text
viewer
purpose
task
order
timestamp
TTL
```

---

# 74. Metrics — Supply Creation

```text
Available Now Activation Rate
Scheduled Availability Creation
Average Session Duration
Role Coverage
Geo Coverage
```

---

# 75. Metrics — Supply Quality

```text
Active Supply Accuracy
Offer Response Rate
Offer Acceptance Rate
Ghost Supply Rate
Conflict Rate
```

---

# 76. Metrics — Conversion

```text
Availability → Offer
Offer → Order
Availability → Earnings
Earnings per Available Hour
```

---

# 77. Agent-facing Analytics

可以显示：

```text
You were available 6h this week
Received 5 relevant offers
Completed 3 tasks
Earned 1.8M
```

必须是真实可核验数据。

---

# 78. Safety / Fatigue

P1 可支持：

```text
max continuous hours
minimum rest gap
```

高风险 / 体力 Role 可作为 Eligibility Gate。

---

# 79. MVP P0

必须实现：

```text
AvailabilitySession
Available Now
Scheduled Availability
Active Roles
Duration
Work Radius
Min Pay
Pause / Resume / Close
Auto Expiry
Confirmed Order Conflict
Travel Buffer
Atomic Capacity Check
Aggregate Supply
Location Privacy
Audit
```

---

# 80. P1

```text
Recurring Availability
Demand Pulse
Calendar Sync
Availability Request
Supply Prediction
Fatigue Guard
Advanced Geo Zones
```

---

# 81. Acceptance Criteria

## AC-AVAIL-01
Capability 与 Availability 必须是独立对象。

## AC-AVAIL-02
只有 ACTIVE Availability 才能进入实时 Supply。

## AC-AVAIL-03
Available Now 必须有明确 Duration / Expiry。

## AC-AVAIL-04
Available Now 不得永久保持开启。

## AC-AVAIL-05
Agent 只能挂 ACTIVE Role。

## AC-AVAIL-06
Role-specific willingness 必须可表达。

## AC-AVAIL-07
Availability 必须支持 Work Area / Radius。

## AC-AVAIL-08
Agent precise location 不得直接公开给无 Order Requester。

## AC-AVAIL-09
不得提供 Nearby People Map。

## AC-AVAIL-10
Min Pay 必须可以作为 Supply Eligibility Gate。

## AC-AVAIL-11
Confirmed Order 必须占用对应真人时间容量。

## AC-AVAIL-12
Physical Human Agent 默认 capacity = 1。

## AC-AVAIL-13
必须检查 Travel Buffer，不能只检查时间是否直接重叠。

## AC-AVAIL-14
未来 Order 可以自动截断 Available Now 可用窗口。

## AC-AVAIL-15
Offer Accept 时必须重新检查 Availability。

## AC-AVAIL-16
同一 Agent 时间冲突不得产生两个有效 Physical Orders。

## AC-AVAIL-17
Requester Supply Preview 只能展示 Aggregate Supply。

## AC-AVAIL-18
Registered Agent 不得计入真实实时 Supply。

## AC-AVAIL-19
Predicted Supply 必须明确标识为 Expected。

## AC-AVAIL-20
Agent Pause 必须立即停止进入新 Match。

## AC-AVAIL-21
Agent Close 不得影响已确认 Order。

## AC-AVAIL-22
Boost 不得创造不存在的 Availability。

## AC-AVAIL-23
Trusted Proxy 没有 Availability 时不得自动视作可用。

## AC-AVAIL-24
Location 数据必须执行 Purpose-bound Disclosure。

## AC-AVAIL-25
P0 不要求持续 GPS Tracking。

## AC-AVAIL-26
Remote Role 可以使用 REMOTE_ONLY Availability。

## AC-AVAIL-27
Availability Session 必须可审计。

## AC-AVAIL-28
Availability 的核心指标必须是 Availability → Order → Earnings，而不是在线时长。

---

# 82. 本章锁定结论

1. **Capability 说明会什么，Availability 说明什么时候真正愿意接。**
2. **真实 Supply 不是注册人数，而是可交易 Capacity。**
3. **Available Now 是 Agent 端核心 Habit Button。**
4. **Available Now 必须有 Duration、Role、Area、Min Pay 和自动过期。**
5. **Scheduled Availability 支持未来真人任务。**
6. **一个 Physical Human Agent 默认同一时间 Capacity = 1。**
7. **Confirmed Order 必须占用真人时间并考虑 Travel Buffer。**
8. **No Nearby People，Requester 只能看到聚合 Supply 或 Task-specific Candidate。**
9. **Agent Location 默认只作为 Matching Input，不作为公开内容。**
10. **Offer Accept 时必须重新验证 Supply。**
11. **Ghost Supply 影响 Availability Confidence，但不能污染 Capability。**
12. **Demand Pulse 只能作为未来供给激活工具，不做任务墙。**
13. **Agent 供给侧核心循环是 Free Time → Available → Offer → Order → Earn。**
14. **Availability 最终优化 Earnings per Available Hour 和 Successful Human Execution。**

---

# 83. 下一章

下一份增量 PRD：

> **Chapter 09 — Pricing / Quote / Budget / Marketplace Economics**

重点解决：

```text
Human Agent 到底怎么报价
Fixed / Hourly 怎么表达
最低时长
交通费
紧急加价
多 Slot 怎么算
Requester Budget 与 Agent Min Pay 如何相遇
平台抽佣如何展示
如何避免低价竞价把真人市场做坏
```

# Proxy PRD v1.1
## Chapter 02A — Real-world Scene Network / Physical Scene Graph

**文档类型**：增量细化 PRD  
**插入位置**：Capability Graph 之后，Task / TaskSlot / Order State Machine 之前  
**本章定位**：把真实消费场景接入 Proxy，让现实世界的“地点、容量、空位、活动、实时状态”成为 Human Agent 需求的上游数据源与执行上下文。

---

# 1. 核心定义

Proxy 仍然是：

> **Human Agent / 真人代理系统。**

新增的真实场景网络不是替代 Human Agent，而是把现实世界变成真人任务的可计算上下文。

完整闭环：

```text
Real-world Venue
↓
Current Scene State
↓
User / Business Action
↓
Reservation / Activity / Business Need
↓
Human Agent Requirement
↓
Task / TaskSlot
↓
Human Agent Matching
↓
Real-world Execution
↓
Outcome
```

---

# 2. 新的双图架构

Proxy 以后有两张核心 Graph。

## 2.1 Human Capability Graph

```text
Industry
↓
Scenario
↓
Role
↓
Capability
↓
Human Agent
```

回答：

> “什么样的人能做这件事？”

---

## 2.2 Physical Scene Graph

```text
Venue
↓
Zone
↓
Resource
↓
Current State
↓
Reservation / Activity
↓
Human Need
```

回答：

> “现实世界现在发生了什么？”

---

# 3. 两张 Graph 如何连接

真正的 Proxy 核心：

```text
Physical Scene
      │
      ├── Current Demand
      ├── Capacity
      ├── Reservation
      ├── Activity
      └── Operational Need
              ↓
             Task
              ↓
           TaskSlot
              ↓
       Capability Requirement
              ↓
         Human Agent
```

例如：

```text
Coffee Shop
↓
Saturday 19:00
↓
12 / 15 Tables Occupied
↓
User reserves Table 14
↓
Creates “English Coffee Meetup”
↓
Needs:
Greeter ×1
Photographer ×1
English Host ×1
↓
Proxy matches Human Agents
```

---

# 4. 产品边界

Proxy 不做一个普通“附近商家点评 App”。

只有满足以下至少一个条件的 Venue 才真正进入 Scene Network：

1. 有实时状态；
2. 有可预约 Resource；
3. 可以承载 Activity；
4. 可以产生 Human Agent Demand；
5. 可以成为 Human Agent Execution Venue。

因此：

> **Place browsing 可以存在，People browsing 仍然禁止。**

锁定：

```text
Browse Places = Allowed
Browse People without Task = Not Allowed
```

---

# 5. Venue Object

```json
{
  "venue_id": "venue_001",
  "business_id": "biz_001",
  "name": "Proxy Coffee Tây Hồ",
  "venue_type": "CAFE",
  "location": {},
  "timezone": "Asia/Ho_Chi_Minh",
  "status": "OPEN",
  "scene_capabilities": [
    "REAL_TIME_OCCUPANCY",
    "TABLE_RESERVATION",
    "ACTIVITY_HOSTING",
    "AGENT_TASK"
  ]
}
```

---

# 6. Venue Type

P0：

```text
CAFE
RESTAURANT
EVENT_VENUE
COWORKING
RETAIL_STORE
```

P1：

```text
GYM
SALON
HOTEL
EXHIBITION
ENTERTAINMENT
```

场景扩展不改变核心 Scene Graph。

---

# 7. Zone

Venue 可拆为多个 Zone。

例如咖啡店：

```text
Indoor
Outdoor
Window
Quiet Zone
Meeting Area
```

Schema：

```text
zone_id
venue_id
zone_type
capacity
reservation_policy
sensor_mapping
```

---

# 8. Resource

Resource 是可被占用 / 预约 / 锁定的现实资源。

咖啡店：

```text
TABLE
SEAT
ROOM
```

活动场地：

```text
BOOTH
STAGE_SLOT
ROOM
```

Schema：

```text
resource_id
venue_id
zone_id
resource_type
label
capacity
reservable
status
```

---

# 9. Resource State

核心状态：

```text
AVAILABLE
HOLD
RESERVED
OCCUPIED
UNAVAILABLE
OUT_OF_SERVICE
UNKNOWN
```

注意：

> **Empty ≠ Reservable**

摄像头检测到桌子为空，并不代表商家允许预约。

最终可预约条件：

```text
Physical State = AVAILABLE
AND
Merchant Policy = RESERVABLE
AND
No Active Hold / Reservation
```

---

# 10. Scene State Snapshot

所有实时场景更新进入统一对象。

```json
{
  "scene_state_id": "...",
  "venue_id": "venue_001",
  "resource_id": "table_14",
  "state": "AVAILABLE",
  "source": "CAMERA_VISION",
  "confidence": 0.96,
  "observed_at": "...",
  "received_at": "...",
  "expires_at": "..."
}
```

---

# 11. State Freshness

实时状态不是永久真值。

必须显示：

```text
Observed 12 sec ago
Confidence: High
```

状态超过 Freshness TTL：

```text
AVAILABLE
→ UNKNOWN
```

不能继续显示“有空位”。

---

# 12. State Confidence

推荐：

```text
HIGH
MEDIUM
LOW
UNKNOWN
```

Camera / Sensor / POS 不同 Connector 可以产生不同 Confidence。

UI 可以显示：

```text
7 tables likely available
Updated 15 sec ago
```

而不是虚假承诺：

```text
Exactly 7 tables guaranteed
```

---

# 13. Scene Connector Layer

真实场景状态必须来自 Connector。

```text
Scene Connector Service
├── Camera Vision Connector
├── POS Connector
├── Booking Connector
├── Wi-Fi / People Count Connector
├── IoT Sensor Connector
├── Access Control Connector
├── Merchant Manual Connector
└── External Venue API Connector
```

---

# 14. Camera Integration

咖啡店已有摄像头时：

```text
Camera / NVR
↓
Merchant Edge Gateway
↓
Occupancy Detection
↓
Resource State Events
↓
Proxy Scene State API
```

推荐：

> **Raw video should remain at merchant edge whenever possible.**

Proxy 核心系统只接收：

```text
table_14 = OCCUPIED
table_15 = AVAILABLE
zone_A occupancy = 78%
```

而不是：

```text
完整持续视频流
```

---

# 15. Camera Privacy Hard Rule

P0 不需要：

```text
Facial Recognition
Person Identity
Gender Recognition
Age Recognition
Visitor Tracking
Cross-camera Person Tracking
```

摄像头只用于：

```text
Occupancy
Resource State
Anonymous Count
Queue Length
```

核心原则：

> **Understand the scene, not identify the person.**

---

# 16. Edge Vision

建议部署：

```text
Proxy Scene Edge
```

可运行在：

- Merchant local mini-PC；
- Existing NVR host；
- Approved edge device；
- Merchant cloud vision service。

职责：

```text
Camera Input
↓
Zone / Table Mapping
↓
Occupancy Inference
↓
State Event
```

Proxy Cloud 不需要持续拉取原始视频。

---

# 17. Merchant Camera Setup

Merchant Portal：

```text
Add Camera
↓
Map Camera View
↓
Draw Zone / Table Areas
↓
Bind:
ROI A → Table 1
ROI B → Table 2
ROI C → Queue Area
↓
Calibrate
↓
Test
↓
Activate
```

注意：

> ROI 是本地视觉区域映射，不是用户可见的摄像头画面。

---

# 18. Camera State Override

Computer Vision 可能误判。

Merchant 必须可：

```text
Manual Override
```

例如：

```text
Table 12
Vision: AVAILABLE
Merchant: OUT_OF_SERVICE
```

最终：

```text
Effective State = OUT_OF_SERVICE
```

并记录来源。

---

# 19. Multi-source State Resolution

同一 Resource 可能同时有：

```text
Camera
POS
Reservation
Merchant Manual
```

需要 Scene State Resolver。

示例优先级：

```text
OUT_OF_SERVICE override
Reservation Lock
Merchant Manual
Booking System
Vision / Sensor
```

具体规则按 Venue Type 配置。

---

# 20. Place Map

新增一个合法的 Map 类型：

> **Place / Scene Map**

它可以展示：

```text
Cafe A
5 tables available

Cafe B
Low availability

Cafe C
Event tonight
```

这与 People Map 完全不同。

禁止：

```text
Cafe A
An is here
Minh is here
```

除非是已经确认 Order 的 Execution Context。

---

# 21. Consumer Home Loop

真实消费场景可以变成 Proxy 的高频入口。

例如：

```text
现在去哪里？
```

Home：

```text
Live Places Near You

Coffee
├── 5 tables available
├── 12 min away
└── Reserve

Coworking
├── 8 seats available
└── Reserve

Events tonight
├── English Coffee Meetup
└── Join
```

这可以建立：

> **现实生活有行动需求 → 打开 Proxy**

而不是只有“我要雇人”时才打开。

---

# 22. Reservation Hold

用户点击空座：

```text
AVAILABLE
↓
HOLD
↓
RESERVED
```

Hold 必须是原子操作。

Schema：

```text
reservation_hold_id
resource_id
user_id
starts_at
expires_at
status
```

状态：

```text
CREATED
CONFIRMED
EXPIRED
RELEASED
CONFLICTED
```

---

# 23. Hold TTL

示例：

```text
2–5 min Hold
```

用户在 TTL 内完成：

```text
Time
Party Size
Deposit if needed
Confirm
```

未确认：

```text
HOLD
→ AVAILABLE
```

具体 TTL 由 Venue Policy 决定。

---

# 24. Reservation

```json
{
  "reservation_id": "...",
  "venue_id": "...",
  "resource_ids": ["table_14"],
  "principal_id": "...",
  "start_at": "...",
  "end_at": "...",
  "party_size": 4,
  "status": "CONFIRMED"
}
```

---

# 25. Reservation State

```text
DRAFT
→ HOLDING
→ CONFIRMED
→ CHECKED_IN
→ IN_USE
→ COMPLETED
```

异常：

```text
NO_SHOW
CANCELLED
EXPIRED
RELEASED
```

---

# 26. Walk-in vs Reservation

Scene State 必须同时理解：

```text
Walk-in Occupancy
Reservation Inventory
```

不能只用摄像头推断未来可预约性。

例如：

```text
现在有 5 张空桌
但 20:00 已全部预订
```

用户必须看到不同时间维度。

---

# 27. Activity Object

用户或 Business 可以在真实 Venue 发起活动。

```json
{
  "activity_id": "...",
  "venue_id": "...",
  "creator_principal_type": "INDIVIDUAL",
  "creator_principal_id": "...",
  "title": "English Coffee Meetup",
  "start_at": "...",
  "end_at": "...",
  "capacity": 12,
  "visibility": "PUBLIC",
  "status": "PUBLISHED"
}
```

---

# 28. Activity Type

P0：

```text
MEETUP
BUSINESS_EVENT
BRAND_EVENT
WORKSHOP
SOCIAL_ACTIVITY
```

这里的 Activity 是：

> 有地点、时间、容量、目的的现实活动。

不是无限社交 Feed。

---

# 29. Activity → Reservation

活动必须先确保：

```text
Venue Capacity
Resource Availability
Merchant Permission
```

流程：

```text
Create Activity
↓
Select Venue
↓
Check Capacity
↓
Reserve Resource
↓
Publish Activity
```

---

# 30. Activity → Human Agent Need

创建 Activity 时：

```text
Need help?
```

可以添加：

```text
Greeter ×1
Host ×1
Interpreter ×1
Photographer ×1
Content Talent ×1
```

然后：

```text
Activity
↓
AgentNeed
↓
Task
↓
TaskSlot
↓
Matching
```

---

# 31. ActivityAgentNeed

```json
{
  "activity_id": "...",
  "role_id": "GREETER",
  "quantity": 1,
  "must_have": [],
  "nice_to_have": [],
  "budget": 600000,
  "status": "NEED_CREATED"
}
```

后续会被 Task Engine 转成 TaskSlot。

---

# 32. Merchant Generated Agent Demand

Business 也可以从真实 Scene 直接生成需求。

例如：

```text
Tonight 18:00–22:00
Reservations = 84%
Current staffing = Low
```

系统提示：

```text
Suggested:
Greeter ×1
Event Assistant ×1
```

P0：

> **Auto-draft, Merchant confirms.**

不建议 P0 自动花钱发布。

---

# 33. Rule-based Agent Demand

Merchant 可以配置：

```text
IF
reservation_utilization > 80%
AND
time_window = weekend_evening
THEN
suggest GREETER ×1
```

或者：

```text
IF
event_capacity > 30
THEN
suggest EVENT_ASSISTANT ×2
```

---

# 34. P1 Auto-publish Guardrail

未来允许：

```text
Auto-publish Human Agent Demand
```

前提：

```text
Approved Role
Budget Cap
Venue
Time Window
Business Permission
Cancellation Policy
```

例如：

```text
Max automatic weekly budget:
5,000,000 VND
```

---

# 35. Real-time Demand Update

真实场景可以更新 Agent Demand。

例如：

```text
Activity bookings:
6 → 18 → 32
```

Agent Need：

```text
Greeter:
0 → 1 → 2
```

但已经确认的 Agent Order 不应被自动减少。

只能调整：

```text
Open Slots
```

---

# 36. Demand Forecast

Physical Scene Data 可以产生：

```text
Expected Footfall
Reservation Load
Event Capacity
Current Occupancy
Historical Pattern
```

用于预测：

```text
Human Agent Demand
```

这将成为 Business 侧非常强的价值。

---

# 37. Scene-triggered Task

新的 Task Source：

```text
MANUAL_REQUESTER
BUSINESS_DASHBOARD
ACTIVITY
SCENE_RULE
SCENE_FORECAST
OPERATOR
```

Task 必须知道：

```text
source_type
source_id
```

例如：

```text
source_type = ACTIVITY
source_id = activity_123
```

---

# 38. Execution Context

Human Agent Order 可以绑定 Venue。

```text
order.venue_id
order.zone_id
```

这样 Agent 到场时：

```text
Execution Map
Check-in
Venue Instructions
Entry Point
Task Zone
```

都可以由 Scene Network 提供。

---

# 39. Check-in

Venue 可以支持：

```text
GPS
QR
Merchant Confirmation
Access Control
Scene Sensor
```

组合确认 Agent 已到场。

不需要用摄像头做人脸识别。

---

# 40. Consumer User Habit

新增一条 Demand-side Habit：

```text
我想出门 / 消费
↓
打开 Proxy
↓
看真实可用场景
↓
Reserve
↓
Create / Join Activity
↓
Need Human Help?
↓
Human Agent Matching
```

这让 Proxy 从：

> “偶尔雇人的 App”

变成：

> **现实世界行动入口。**

---

# 41. Merchant Habit

Merchant：

```text
打开店
↓
Scene State 自动在线
↓
Reservation 进入
↓
Activity / Demand 增长
↓
Proxy 建议 Human Agent
↓
一键确认 Task
↓
Agents 到场
```

核心：

> 商家不需要重新描述现实状态，因为 Proxy 已经知道 Scene Context。

---

# 42. Agent Habit

Agent：

```text
Available Now
↓
Scene Demand Appears
↓
Proxy matches nearby relevant Venue Task
↓
Accept
↓
Go to Venue
↓
Execute
```

Agent 看到的是：

```text
Task Offer
```

不是窥视 Venue 消费者。

---

# 43. Data Classification

Physical Scene Data 单独分级。

## P0 Public Scene Data

```text
Venue
Opening Status
General Occupancy Level
Reservable Capacity
Activity
```

## P1 Resource State

```text
Table / Seat Availability
Reservation State
```

## P2 Operational Data

```text
Footfall
Business Load
Demand Forecast
```

## P3 Restricted Sensor Data

```text
Raw Camera Stream
Raw Audio
Device Credentials
```

Proxy 主业务系统默认不得访问 P3。

---

# 44. Visitor Privacy

Scene Network 不建立：

```text
VisitorProfile
```

也不把匿名客流数据关联到：

```text
UserAccount
```

除非用户主动：

```text
Reservation
Check-in
Activity Join
```

才形成对应交易关系。

---

# 45. Camera Data Retention

推荐原则：

```text
Raw video:
Merchant-owned / edge retained according to merchant policy

Proxy:
Derived state only
```

Proxy 保存：

```text
State
Confidence
Timestamp
Connector
```

而不是持续保存消费者画面。

---

# 46. Real-time Event Bus

Scene Connector 输出事件：

```text
RESOURCE_AVAILABLE
RESOURCE_OCCUPIED
OCCUPANCY_CHANGED
QUEUE_LENGTH_CHANGED
RESERVATION_CREATED
RESERVATION_CANCELLED
ACTIVITY_CAPACITY_CHANGED
VENUE_STATUS_CHANGED
```

进入：

```text
Scene Event Bus
```

再驱动：

```text
Reservation
UI State
Demand Forecast
Agent Need
Analytics
```

---

# 47. Scene State Resolver

必须有单一有效状态计算层：

```text
Connector Evidence
+
Merchant Policy
+
Reservation Lock
+
Manual Override
=
Effective Scene State
```

UI 不能直接读取某一个 Camera Connector 的原始结果。

---

# 48. State Audit

每次状态变化记录：

```text
previous_state
new_state
source
confidence
observed_at
resolved_at
policy
```

便于：

- Reservation dispute；
- Sensor debugging；
- Merchant support。

---

# 49. Merchant Scene Dashboard

建议：

```text
LIVE NOW

Tables
15 total
5 available
2 reserved
8 occupied

Reservations
Next 2h: 7

Activities
Tonight: 1

Human Agent
Open Slots: 2
Arriving: 3

[Create Task]
```

---

# 50. Consumer Venue Detail

例如咖啡店：

```text
Proxy Coffee Tây Hồ

OPEN
5 tables available
Updated 18 sec ago

Indoor      2
Outdoor     3

Tonight
English Coffee Meetup · 19:00

[Reserve a table]
[Create activity]
```

不显示：

```text
店里有哪些真人 Agent / 顾客
```

---

# 51. Reserve UX

```text
Select Time
↓
Party Size
↓
Available Zone
↓
Resource Hold
↓
Confirm
↓
Reservation
```

如果资源被别人抢先锁定：

```text
HOLD_CONFLICT
```

立即重新查询可用 Resource。

---

# 52. Activity Creation UX

```text
Venue
↓
Date / Time
↓
Capacity
↓
Activity Type
↓
Reserve Space
↓
Need Human Agents?
↓
Roles / Quantity
↓
Publish
```

---

# 53. Human Agent Demand UX

Activity 或 Merchant Scene 页面：

```text
Need people for this scene?

Greeter
Interpreter
Host
Photographer
Content Talent
Event Assistant

[Add Human Agent]
```

Role 来源仍然必须是：

> Capability Graph

不能在 Scene 模块自己发明另一套 Role。

---

# 54. Scene Graph 与 Capability Graph 的边界

Physical Scene Graph：

```text
Where / When / Capacity / State
```

Capability Graph：

```text
Who / What Capability
```

Task：

> 两张 Graph 的连接对象。

```text
Physical Scene
↓
Task Context
↑
Human Capability
```

---

# 55. Scene Graph 不做 Matching

它只能产生：

```text
Human Need
```

不能决定：

```text
An 比 Minh 更适合
```

Ranking 仍属于 Matching Engine。

---

# 56. 商业模式

真实场景层增加新的收入可能：

```text
Reservation Fee
Merchant Scene SaaS
Camera / Edge Connector Fee
Activity Service Fee
Human Agent Commission
Business Automation Subscription
Promoted Venue Placement
```

但：

> Promoted Venue 不得伪造 Occupancy / Availability。

---

# 57. Data Moat

新增数据资产：

```text
Venue
× Time
× Resource
× Occupancy
× Reservation
× Activity
× Human Need
× Human Agent
× Outcome
```

这比单纯：

```text
Agent Profile
```

更难复制。

---

# 58. 新北极星数据

## Consumer

```text
Live Scene → Reservation Conversion
Reservation → Check-in
Activity Creation
```

## Merchant

```text
Reservation Utilization
Scene State Accuracy
Human Need Prediction Accuracy
Human Slot Fill Rate
```

## Human Agent

```text
Scene-triggered Offers
Scene-triggered Order Rate
Arrival Rate
```

---

# 59. Scene Accuracy Metrics

必须监控：

```text
State Accuracy
State Freshness
Camera False Occupied
Camera False Available
Merchant Override Rate
Reservation Conflict Rate
Unknown State Rate
```

---

# 60. MVP 选择

不要一开始连接所有真实世界。

建议第一个垂直：

> **Cafe / Coffee Shop**

原因：

- Resource 简单：Table / Seat；
- Occupancy 易理解；
- 高频消费；
- 适合活动；
- 容易产生 Human Agent 需求；
- 用户理解成本低。

---

# 61. Cafe MVP

P0：

```text
Venue
Zone
Table
Manual State
Camera-derived Occupancy
Availability
Reservation Hold
Reservation
Activity
Activity Agent Need
Merchant Human Agent Task
```

---

# 62. Cafe MVP Camera

最小方案：

```text
Existing CCTV
↓
Edge Detection
↓
Table Occupied / Available
↓
Proxy
```

只输出：

```text
Resource State
Anonymous Count
```

---

# 63. Cafe Example

18:45：

```text
Coffee A
15 Tables

Occupied 9
Reserved 2
Available 4
```

用户：

```text
Reserve Table 12
```

系统：

```text
Table 12
AVAILABLE
→ HOLD
→ RESERVED
```

用户再：

```text
Create:
English Coffee Meetup
19:30
8 people
```

系统建议：

```text
Need Human Agent?

English Host ×1
Photographer ×1
```

确认后：

```text
Activity
→ Task
→ TaskSlots
→ Matching
```

这就是完整的：

> **Real Scene → Human Agent Demand**

---

# 64. Fallback

如果 Camera 断线：

```text
CAMERA_OFFLINE
```

系统：

```text
State Freshness expires
↓
Resource = UNKNOWN
```

然后可切：

```text
Merchant Manual
Booking Inventory
```

不能继续显示旧的“Available”。

---

# 65. Anti-abuse

禁止：

- 利用 camera feed 偷看店内顾客；
- 展示人物截图；
- 导出消费者轨迹；
- 人脸识别寻找某个人；
- 根据可见性推测敏感属性；
- 通过 Scene Map 做 Nearby People；
- 商家伪造 Availability 诱导用户。

---

# 66. Operator

Scene Ops 需要：

```text
Connector Health
Venue Status
Camera Health
State Freshness
Reservation Conflict
Merchant Override
Activity Report
Sensor Privacy Report
```

---

# 67. Acceptance Criteria

## AC-SCENE-01
Proxy 必须支持 Physical Scene Graph。

## AC-SCENE-02
Place Browsing 允许，People Browsing without Task 仍禁止。

## AC-SCENE-03
Venue / Zone / Resource 必须是独立对象。

## AC-SCENE-04
Resource State 必须支持 AVAILABLE / HOLD / RESERVED / OCCUPIED / UNAVAILABLE / UNKNOWN。

## AC-SCENE-05
Camera 检测到空桌不等于允许预约。

## AC-SCENE-06
Reservation Hold 必须具有 TTL 和并发锁。

## AC-SCENE-07
Scene State 必须记录 Source / Confidence / observed_at。

## AC-SCENE-08
过期实时状态必须变成 UNKNOWN。

## AC-SCENE-09
Camera P0 不使用 Facial Recognition。

## AC-SCENE-10
Proxy Cloud 默认只消费 Derived Scene State，不依赖原始视频。

## AC-SCENE-11
Merchant 必须可以 Manual Override。

## AC-SCENE-12
多源 Scene Data 必须由统一 Resolver 产生 Effective State。

## AC-SCENE-13
Activity 必须绑定 Venue / Time / Capacity。

## AC-SCENE-14
Activity 可以生成 Human Agent Requirement。

## AC-SCENE-15
Scene Generated Human Need 必须转换成标准 Task / TaskSlot，不得单独建立另一套 Agent Order。

## AC-SCENE-16
Role 必须来自 Capability Graph。

## AC-SCENE-17
Scene Graph 不参与 Agent Ranking。

## AC-SCENE-18
已经确认的 Human Agent Order 不能因需求下降被自动撤销。

## AC-SCENE-19
P0 自动化只允许 Suggest / Draft Agent Need，自动付费发布需要额外授权策略。

## AC-SCENE-20
Consumer Scene Data 不得自动建立 Visitor Identity。

## AC-SCENE-21
Raw Camera / Audio / Credentials 属于 Restricted Sensor Data。

## AC-SCENE-22
Venue Detail 必须显示状态 Freshness。

## AC-SCENE-23
Reservation Conflict 必须原子处理。

## AC-SCENE-24
Scene Connector 失败不得导致平台继续展示陈旧 Availability。

## AC-SCENE-25
Task 必须支持 source_type / source_id 关联 Activity / Scene Rule。

---

# 68. 本章锁定结论

1. **Proxy 增加 Physical Scene Graph。**
2. **真人 Agent 仍是核心，Scene Network 是 Human Agent Demand 的上游。**
3. **允许浏览 Place，不允许无 Task 浏览 People。**
4. **真实 Venue 状态可以来自 Camera / POS / Booking / Sensor / Manual 等 Connector。**
5. **Camera 只理解 Scene，不识别具体消费者。**
6. **Raw Video 默认留在 Merchant Edge，Proxy 主要接收 Derived State。**
7. **Resource 空闲与是否可预约严格分离。**
8. **Reservation 使用 Hold + TTL + Atomic Lock。**
9. **用户可以在 Venue 上创建现实 Activity。**
10. **Activity 可以产生 Human Agent Need。**
11. **Merchant Scene 状态可以自动建议 Human Agent Demand。**
12. **所有 Human Agent Demand 最终必须进入统一 Task / TaskSlot / Order 主链。**
13. **Physical Scene Graph 与 Capability Graph 通过 Task 相连。**
14. **实时状态必须有 Freshness、Confidence 与 Audit。**
15. **Cafe 作为首个 Physical Scene MVP。**

---

# 69. 下一步

加入这一章后，Proxy 的核心已经从：

```text
Need
→ Human Agent
```

升级为：

```text
Real-world Scene
→ Need
→ Human Agent
→ Execution
```

下一章应该继续：

> **Chapter 03 — Task / TaskSlot / Order State Machine**

并正式支持：

```text
Manual Task
Activity-generated Task
Scene-rule-generated Task
Business-generated Task
```

所有来源最终进入同一套 Human Agent 交易状态机。

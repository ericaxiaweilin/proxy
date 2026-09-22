# Proxy PRD v1.1
## Chapter 17 — Map / Location / Supply Heat / Execution Geography

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 04 — Requester Demand Builder
- Chapter 05 — Matching Engine
- Chapter 08 — Availability / Supply Capacity
- Chapter 11 — Execution / Check-in / Evidence
- Chapter 13 — Safety / Risk
- Chapter 15 — Business Workspace / Multi-store
- Chapter 16 — Merchant Membership / Local Economy Loop

**本章范围**：
- Location Domain
- Requester Supply Map
- Agent Demand Map
- Execution Map
- Geo Zone
- Approximate Area
- Radius
- ETA
- Distance
- Supply Heat
- Demand Heat
- Venue / Store / Activity location
- Location Visibility Grant
- Precise Location TTL
- Map Privacy
- Geocoding / Routing Provider Boundary
- Map API
- Audit / Metrics

**本章明确不做深**：
- 实时 Camera / CCTV Scene Understanding
- Continuous GPS tracking
- Indoor positioning
- 自研地图底图
- 自研导航引擎
- 自研路况预测
这些能力按真实需求接第三方服务。

---

# 1. 本章目标

Proxy 的 Map 不应该回答：

> **“附近有哪些人？”**

而应该回答：

> **“这个现实任务附近有没有足够的合格真人供给？”**

以及：

> **“我作为 Agent，哪里、什么时候存在适合我的真人需求？”**

Matched 之后才回答：

> **“我应该去哪里，什么时候到，怎么完成这次 Order？”**

---

# 2. 核心原则

正式锁定：

> **Map = Task / Supply / Demand / Execution Interface**

不是：

```text
People Discovery Interface
```

---

# 3. 三张地图必须分离

Proxy 至少定义三种 Map Mode：

```text
1. REQUESTER_SUPPLY_MAP
2. AGENT_DEMAND_MAP
3. EXECUTION_MAP
```

它们的数据、权限和 UI 完全不同。

---

# 4. Requester Supply Map

Requester 在：

```text
Task Draft
Valid Task
```

上下文中查看：

```text
哪里有可用供给
大概多少
ETA 如何
某区域是否供给紧张
```

---

# 5. Requester Supply Map 不显示真人

禁止：

```text
Agent avatar pin
Agent live dot
Agent exact location
Agent online people list
```

允许：

```text
Supply Heat
Qualified Capacity
Approx ETA
Coverage Radius
Liquidity Risk
```

---

# 6. Requester Supply Map 示例

例如：

```text
Task:
Saturday 18:00
Tây Hồ
Greeter
English B2
```

Map 可以显示：

```text
Zone A
8 qualified / available
Healthy

Zone B
3 qualified / available
Thin

Zone C
0
Empty
```

---

# 7. Supply Heat

推荐对象：

```text
SupplyHeatCell
```

Schema：

```text
supply_heat_cell_id

geo_zone_id
time_window_start
time_window_end

role_id
critical_capability_ids[]

qualified_capacity
realtime_capacity
scheduled_capacity

median_eta optional

liquidity_status
confidence

computed_at
expires_at
```

---

# 8. Liquidity Status

沿用：

```text
HEALTHY
THIN
CRITICAL
EMPTY
UNKNOWN
```

---

# 9. Supply Heat 是聚合值

必须满足最小匿名阈值。

例如当：

```text
qualified_capacity < privacy_threshold
```

Requester 可以只看到：

```text
Limited supply
```

而不是：

```text
1 Agent exactly here
```

---

# 10. Privacy Threshold

推荐：

```text
GeoAggregationPolicy
```

字段：

```text
minimum_population
minimum_cell_size
maximum_precision
```

具体阈值按 Market 配置。

---

# 11. Agent Demand Map

Agent 看的是：

> **哪里存在与我相关的需求。**

不是：

```text
所有公开 Task
```

---

# 12. Demand Map 输入

Agent Demand Map 根据：

```text
Agent active roles
Capability Passport
Availability
Location preference
Time
Min Pay
```

过滤后生成。

---

# 13. Agent Demand Map 显示

允许：

```text
Demand Heat
Role
Approx Area
Time Window
Typical Pay Range
Demand Level
Fit indicator
```

---

# 14. Agent Demand Map 不展示

无 Task / Offer 权限时，不显示：

```text
Requester private name
exact private address
private phone
exact home location
full task private description
```

---

# 15. DemandHeatCell

推荐：

```text
DemandHeatCell
```

Schema：

```text
demand_heat_cell_id

geo_zone_id
time_window_start
time_window_end

role_id

open_slot_count
estimated_demand_level
typical_pay_range

agent_fit_status optional

computed_at
expires_at
```

---

# 16. Demand Level

推荐：

```text
LOW
MEDIUM
HIGH
VERY_HIGH
```

不要展示：

```text
“87 个任务等你抢”
```

除非真的是可核验的相关 Slot 数。

---

# 17. Demand Heat ≠ Job Feed

点击 Heat Cell：

可以进入：

```text
Go Available
```

或：

```text
Relevant Open Apply
```

而不是展开：

```text
无限任务墙
```

---

# 18. Execution Map

只有：

```text
Order Created
```

以后才出现。

用途：

```text
Task location
Arrival target
ETA
Route
Check-in
Execution geography
```

---

# 19. Execution Map 数据更精确

Matched / Execution 阶段可以逐步开放：

```text
exact venue
entry point
meeting point
route
arrival ETA
```

但仍按：

```text
Purpose
Order
TTL
```

控制。

---

# 20. Location Visibility Levels

正式统一：

```text
L0_AGGREGATE
L1_APPROXIMATE
L2_TASK_CONTEXT
L3_MATCHED
L4_EXECUTION_PRECISE
```

---

# 21. L0_AGGREGATE

无 Task：

```text
heat / zone only
```

没有具体 Agent。

---

# 22. L1_APPROXIMATE

Agent / Requester 在一般场景：

```text
district
neighborhood
approx area
```

---

# 23. L2_TASK_CONTEXT

Valid Task Candidate：

可见：

```text
distance band
approx ETA
```

例如：

```text
~3 km
15–20 min
```

---

# 24. L3_MATCHED

Order 已创建：

可以看到：

```text
exact venue
meeting point
arrival target
```

如果执行所需。

---

# 25. L4_EXECUTION_PRECISE

任务执行阶段：

可以临时开放：

```text
precise agent location
precise requester/venue location
```

仅在实际需要时。

---

# 26. L4 必须 TTL

例如：

```text
grant starts:
60 min before task

expires:
30 min after task end
```

具体按 Scenario 配置。

---

# 27. LocationVisibilityGrant

推荐对象：

```text
LocationVisibilityGrant
```

Schema：

```text
location_grant_id

order_id
subject_type
subject_id

viewer_type
viewer_id

visibility_level
purpose

granted_at
expires_at
revoked_at optional

status
```

---

# 28. Grant Status

```text
ACTIVE
EXPIRED
REVOKED
DENIED
```

---

# 29. Location Purpose

推荐：

```text
MATCHING
ETA
ARRIVAL_COORDINATION
CHECKIN
EXECUTION
SAFETY
```

---

# 30. 精确位置不能因为 Trusted 而开放

正式硬规则：

```text
Trusted Proxy
```

不产生：

```text
permanent location access
```

---

# 31. Location Object

推荐统一：

```text
LocationReference
```

Schema：

```text
location_reference_id

location_type

country
region
city
district optional

address_text optional
lat optional
lng optional

geo_zone_id optional

precision_level

provider_reference optional
created_at
```

---

# 32. Location Type

推荐：

```text
PUBLIC_VENUE
BUSINESS_STORE
PRIVATE_ADDRESS
TEMPORARY_MEETING_POINT
APPROXIMATE_AREA
REMOTE
```

---

# 33. Precision Level

```text
COUNTRY
CITY
DISTRICT
AREA
APPROX_POINT
EXACT_POINT
```

---

# 34. Private Address

私人地址必须：

```text
PRIVATE_ADDRESS
```

默认不进入：

```text
content
public map
candidate card
aggregate map label
```

---

# 35. Public Venue

例如：

```text
Cafe
Event Center
Hotel
Mall
```

可以：

```text
PUBLIC_VENUE
```

在内容 / Activity / Merchant 页面正常展示。

---

# 36. Business Store

Store 可以绑定：

```text
Venue / LocationReference
```

用于：

```text
Task prefill
Activity
Map
Execution
```

---

# 37. Store ≠ Location

一个 Store 的业务实体与：

```text
physical location
```

继续分离。

Store 可以换址，但：

```text
store_id
```

不变。

---

# 38. Activity Location

Activity 可以绑定：

```text
venue_id
```

或：

```text
temporary_location_reference
```

---

# 39. Task Location

每个 Task 必须有：

```text
ExecutionLocation
```

或：

```text
REMOTE
```

---

# 40. Multi-location Task

P0 原则：

> 一个 Task 一个主执行上下文。

如果真实业务有多个地点：

建议：

```text
split into multiple Tasks
```

或 P1 明确设计：

```text
Route Task
```

不要 P0 把 Location 模型复杂化。

---

# 41. Route Task

P1 可能：

```text
Pickup A
↓
Deliver B
```

此时可用：

```text
TaskRoute
```

---

# 42. TaskRoute

Schema：

```text
route_id
task_id

stops[]
route_policy
estimated_distance
estimated_duration
```

---

# 43. P0 Location Input

Demand Builder 支持：

```text
Search place
Drop pin
Current location
Saved Business Store
Saved Venue
Activity Venue
```

---

# 44. Address Confirmation

地图选点后：

Requester 必须确认：

```text
display address
entry instructions
```

避免 Geocoder 自动结果不准确。

---

# 45. Geocoding Provider Boundary

Proxy 不自研：

```text
address search
geocoding
reverse geocoding
```

统一通过：

```text
GeoProviderAdapter
```

---

# 46. GeoProviderAdapter

推荐接口：

```text
search_places()
geocode()
reverse_geocode()
route()
eta()
distance_matrix()
```

---

# 47. Provider 可替换

不同市场可使用：

```text
Google Maps
Mapbox
HERE
local provider
```

产品域不绑定具体厂商。

---

# 48. Routing Provider

Route / ETA 也通过 Adapter。

不要把第三方 Provider ID 直接变成业务主键。

---

# 49. ETA

ETA 必须区分：

```text
estimated travel time
```

与：

```text
arrival commitment
```

---

# 50. ETA 示例

Candidate：

```text
Approx ETA
15–20 min
```

不建议：

```text
17 min 12 sec
```

造成虚假精度。

---

# 51. ETA Freshness

ETA 保存：

```text
computed_at
expires_at
provider
traffic_assumption
```

过期后重新计算。

---

# 52. ETA 不作为永久 Profile 字段

禁止：

```text
agent.eta = 18min
```

它必须属于：

```text
Task / time / location context
```

---

# 53. Distance

Candidate 可以显示：

```text
~3.2 km
```

或：

```text
within 5 km
```

根据 Privacy Policy。

---

# 54. Distance 与直线距离分离

内部可能存在：

```text
geo distance
route distance
```

Matching 更适合使用：

```text
route / ETA
```

而不是仅直线距离。

---

# 55. Travel Feasibility

Eligibility 需要：

```text
Agent current / prior order location
↓
Task venue
↓
ETA + buffer
↓
Can arrive?
```

---

# 56. Previous Order Location

已有 Order 时：

Travel Feasibility 应从：

```text
previous order end location
```

估算，

不是从：

```text
Agent home
```

估算。

---

# 57. Agent Home Address 永不参与公开地图

Home Address 如果存在：

只作为：

```text
private preference / compliance input
```

不能作为地图 pin。

---

# 58. Availability Anchor

Available Now 可以使用：

```text
anchor area
```

或：

```text
approx current point
```

用于匹配。

---

# 59. Availability Radius

例如：

```text
3 km
5 km
10 km
```

形成供给覆盖。

---

# 60. Radius 不代表 Agent 实际位置公开

Requester 只能知道：

```text
this task is within eligible supply radius
```

不能反推：

```text
Agent is exactly here
```

---

# 61. Geo Zone

推荐平台定义：

```text
GeoZone
```

用于：

```text
liquidity
pricing
demand pulse
supply heat
analytics
```

---

# 62. GeoZone Schema

```text
geo_zone_id
market_id

name
zone_type
geometry_reference

parent_zone_id optional

status
version
```

---

# 63. Zone Type

例如：

```text
CITY
DISTRICT
NEIGHBORHOOD
MARKET_CELL
CUSTOM_OPERATION_ZONE
```

---

# 64. Geo Zone 不是行政区唯一映射

Liquidity Cell 可以使用：

```text
operational zones
```

例如商圈：

```text
Old Quarter
West Lake
CBD
```

---

# 65. Geo Zone Versioning

边界变化时：

```text
zone_version
```

必须可审计。

---

# 66. Supply Heat 计算

输入：

```text
Active Role
Capability
Availability
Time
Travel feasibility
Min Pay
Risk
```

输出：

```text
effective capacity
```

---

# 67. Registered Agent 不进 Heat

再次锁定：

```text
registered supply
≠
available supply
```

---

# 68. Scheduled Supply

未来 Task Map：

可显示：

```text
Realtime
Scheduled
```

但必须区分。

---

# 69. Predicted Supply

P1 可显示：

```text
Expected supply
```

必须明确是预测。

---

# 70. Demand Heat 计算

来自：

```text
open TaskSlots
valid future demand
historical recurring demand optional
```

Agent 端 P0 优先：

```text
actual relevant demand
```

---

# 71. Demand Heat Privacy

私人 Task 若数量太少：

只能进入：

```text
aggregate zone
```

不能让 Agent 通过热区猜出：

```text
某个私人家庭正在找人
```

---

# 72. Sensitive Scenario

例如：

```text
private residence
medical-adjacent support
```

需要更粗：

```text
geo aggregation
```

---

# 73. Map CTA — Requester

Requester Supply Map：

```text
Adjust Radius
Adjust Time
Increase Pay
Publish Task
```

而不是：

```text
Tap Agent
```

---

# 74. Map CTA — Agent

Agent Demand Map：

```text
Go Available
Adjust Work Area
Activate Role
View Relevant Open Apply
```

---

# 75. Map CTA — Execution

Execution Map：

```text
Navigate
I'm on my way
Check in
Contact
Report issue
```

---

# 76. Navigation

P0 可跳转：

```text
external map navigation
```

不必自研 Turn-by-turn Navigation。

---

# 77. External Navigation

需要：

```text
open provider route
```

但不要把：

```text
Agent private location
```

暴露给第三方超过必要范围。

---

# 78. Check-in Geofence

Execution Map 可以显示：

```text
check-in zone
```

而不是必须显示一个极精确点。

---

# 79. Geofence

推荐：

```text
center
radius
valid_start
valid_end
```

---

# 80. QR + Map

Business Venue 可同时：

```text
Map arrival
+
QR Check-in
```

提高真实性。

---

# 81. Map and Safety

Safety Incident 期间：

可以：

```text
freeze location sharing
```

或在用户明确需要时：

```text
preserve current location evidence
```

---

# 82. Safety Location Access

只有：

```text
authorized safety operator
```

按 Incident Scope 获取。

---

# 83. Operator Map

P1 Operator Console 可以：

```text
incident order map
```

但不能：

```text
browse all agents live
```

---

# 84. Historical Location

P0 不提供：

```text
Agent location history timeline
```

---

# 85. Execution History

可保留最小必要：

```text
check-in point
check-out point
```

用于：

```text
evidence
dispute
```

不是完整轨迹。

---

# 86. Continuous Tracking

默认：

```text
OFF
```

只有特殊高风险 / 特殊物流场景未来再评估。

---

# 87. Data Retention

精确位置：

```text
shorter retention
```

聚合热力：

```text
longer aggregate retention
```

---

# 88. Heatmap Anonymization

历史供给 / 需求分析应尽量：

```text
aggregate
de-identify
```

而不是长期保留个人点位。

---

# 89. Location Cache

为了性能可以 Cache：

```text
geocode
route
ETA
heat cells
```

但必须：

```text
TTL
```

---

# 90. Location Staleness

任何位置相关结果应有：

```text
freshness
```

例如：

```text
Updated 6 min ago
```

必要时显示给用户。

---

# 91. Permission Request

App 请求定位权限时：

必须解释当前用途：

```text
Find nearby task supply
Estimate ETA
Check in
```

不要用：

```text
Improve your experience
```

这种模糊理由。

---

# 92. Background Location

P0 不要求：

```text
Always Allow
```

优先：

```text
While Using App
```

---

# 93. Precise Location Permission

如果设备允许：

Available Now 可以：

```text
approx location
```

Execution Check-in 才请求：

```text
precise location
```

---

# 94. Location Denied

如果用户拒绝：

仍可使用：

```text
manual area
address search
QR check-in
requester confirm
```

不能直接让产品不可用。

---

# 95. Agent Location Denied

Matching 可以：

```text
lower ETA confidence
```

但不一定完全无法匹配未来 Scheduled Task。

---

# 96. Requester Location Denied

Requester 可：

```text
manually enter task address
```

不强制设备定位。

---

# 97. Business Saved Venue

Business Workspace 可保存：

```text
frequently used venues
```

Demand Builder 一键选择。

---

# 98. Venue Record

推荐：

```text
Venue
```

Schema：

```text
venue_id
business_id optional

display_name
location_reference_id

venue_type
public_visibility

entry_instructions optional

status
```

---

# 99. Venue Public Visibility

```text
PUBLIC
BUSINESS_ONLY
TASK_ONLY
PRIVATE
```

---

# 100. Entry Instructions

例如：

```text
Enter via Gate B
Ask for Events Desk
```

只有：

```text
Matched / Execution
```

才展示。

---

# 101. Venue Change

Order 已确认后改变 Venue：

如果 materially changes：

```text
travel
time
risk
pay
```

属于：

```text
Contract-relevant Change
```

需要 Agent Re-consent。

---

# 102. Nearby Merchant / Content

Consumer 模式未来可以：

```text
Nearby Places
Nearby Activities
```

这是允许的。

禁止：

```text
Nearby Agents
```

---

# 103. Nearby Merchant 与 Supply Map 分离

Consumer Map：

```text
places / activities
```

Requester Supply Map：

```text
human supply aggregate
```

Agent Demand Map：

```text
task demand aggregate
```

不要混成一张地图。

---

# 104. Content Location

ContentPost 可绑定：

```text
Venue
Business
Activity
```

但普通用户私人坐标默认：

```text
not public
```

---

# 105. Map Read Model — Requester

示例：

```json
{
  "mode": "REQUESTER_SUPPLY_MAP",
  "task_id": "T123",
  "slot_group": "GREETER",
  "zones": [
    {
      "zone_id": "WEST_LAKE",
      "liquidity": "HEALTHY",
      "qualified_capacity": 8,
      "eta_band": "15-25 min"
    }
  ]
}
```

---

# 106. Map Read Model — Agent

```json
{
  "mode": "AGENT_DEMAND_MAP",
  "role_id": "GREETER",
  "zones": [
    {
      "zone_id": "WEST_LAKE",
      "demand_level": "HIGH",
      "time_window": "18:00-22:00",
      "typical_pay_range": {
        "min": 550000,
        "max": 750000
      }
    }
  ]
}
```

---

# 107. Map Read Model — Execution

```json
{
  "mode": "EXECUTION_MAP",
  "order_id": "O123",
  "venue": {
    "display_name": "Store A",
    "location_visibility": "EXACT_POINT"
  },
  "arrival_target": "17:30",
  "eta": "18 min",
  "checkin_method": "QR_OR_GPS"
}
```

---

# 108. API — Location

推荐：

```text
POST /geo/search
POST /geo/geocode
POST /geo/route
POST /geo/eta
```

通过 Provider Adapter。

---

# 109. API — Supply Map

```text
POST /tasks/{task_id}/supply-map
```

必须要求：

```text
valid task context
```

---

# 110. API — Demand Map

```text
GET /agents/me/demand-map
```

基于：

```text
active roles
availability
```

返回聚合。

---

# 111. API — Execution Map

```text
GET /orders/{order_id}/execution-map
```

每次执行：

```text
authorization
location grant
```

检查。

---

# 112. No Public People Endpoint

禁止：

```text
GET /map/agents
GET /nearby-agents
GET /online-people
```

---

# 113. Location Audit

精确位置访问记录：

```text
viewer
subject
order
purpose
visibility level
timestamp
provider
```

---

# 114. Location Access Failure

如果过期 Grant 仍被访问：

```text
DENIED
+
security audit event
```

---

# 115. Metrics — Requester Map

```text
Supply Map View
Radius Adjustment
Time Adjustment
Pay Adjustment
Map → Commit
```

---

# 116. Metrics — Agent Map

```text
Demand Map View
Demand Heat → Go Available
Demand Heat → Offer
```

---

# 117. Metrics — Execution

```text
ETA Accuracy
Arrival On-time
Check-in Success
Navigation Open
```

---

# 118. Privacy Metrics

```text
Precise Location Grants
Average Grant Duration
Expired Grants
Revocation Failures
Unauthorized Access
```

---

# 119. Marketplace Metrics

```text
Supply Coverage by Geo
Demand Coverage by Geo
Liquidity Gap
Median ETA
Fill Rate by Geo Zone
```

---

# 120. Guardrail Metrics

必须监控：

```text
Candidate location deanonymization
Heat cell below privacy threshold
Precise location shown before Order
Expired location grant still active
False ETA precision
Stale supply heat
Nearby People endpoint leakage
```

---

# 121. P0 必须实现

```text
LocationReference
GeoZone
Requester Supply Map
Agent Demand Map
Execution Map
SupplyHeatCell
DemandHeatCell
Approx Area
Radius
Distance / ETA
LocationVisibilityGrant
Public Venue / Private Address distinction
Business Saved Venue
Check-in Geofence
Geo Provider Adapter
No Nearby People
TTL / Audit
```

---

# 122. P1

```text
Predicted Supply
Route Task
Advanced Demand Heat
Operator Incident Map
Background ETA refresh
Calendar / traffic-aware travel feasibility
Advanced zone optimization
```

---

# 123. Acceptance Criteria

## AC-MAP-01
Proxy Map 必须服务 Task / Supply / Demand / Execution，而不是 People Discovery。

## AC-MAP-02
Requester Supply Map 不得显示 Agent Avatar / Exact Location。

## AC-MAP-03
Agent Demand Map 不得展示无权限私人 Requester / Address。

## AC-MAP-04
Execution Map 只能在有效 Order Context 中访问。

## AC-MAP-05
Location 必须至少支持 Aggregate / Approximate / Task / Matched / Execution Precise 五级。

## AC-MAP-06
Precise Location 必须 Purpose-bound / Order-bound / TTL。

## AC-MAP-07
Trusted Proxy 不得获得永久 Location Access。

## AC-MAP-08
Supply Heat 必须来自有效 Supply Capacity，不得使用 Registered Agent 数冒充。

## AC-MAP-09
Supply Heat 必须支持匿名阈值。

## AC-MAP-10
小样本 Supply 不得暴露可反推真人身份的地图精度。

## AC-MAP-11
Demand Heat 必须对私人 Task 做地理聚合。

## AC-MAP-12
Demand Map 不得演变为无限公开 Job Feed。

## AC-MAP-13
Requester Map CTA 应优先调整需求，而不是点击真人。

## AC-MAP-14
Agent Map CTA 应优先 Go Available / Adjust Area / Relevant Open Apply。

## AC-MAP-15
LocationReference 必须区分 Public Venue 与 Private Address。

## AC-MAP-16
Private Address 不得进入 Public Content / Public Map。

## AC-MAP-17
Store 与 Location 必须是独立对象。

## AC-MAP-18
P0 一个 Task 应只有一个主执行 Location Context。

## AC-MAP-19
Geocoding / Routing / ETA 必须通过可替换 Provider Adapter。

## AC-MAP-20
ETA 必须带 Freshness / Context，不得存为 Agent 静态字段。

## AC-MAP-21
Matching Travel Feasibility 应优先使用 Route / ETA，而非仅直线距离。

## AC-MAP-22
已有前序 Order 时，应从前序执行地点计算下一单 Travel Feasibility。

## AC-MAP-23
Agent Home Address 不得作为 Public Map Pin。

## AC-MAP-24
Availability Radius 不得被用来反推出 Agent 精确位置。

## AC-MAP-25
GeoZone 必须可版本化。

## AC-MAP-26
Predicted Supply 必须明确标为预测。

## AC-MAP-27
P0 不要求 Continuous GPS Tracking。

## AC-MAP-28
P0 不应要求 Always-on Background Location。

## AC-MAP-29
用户拒绝 Location Permission 后仍应支持 Manual Area / Address / QR 等替代路径。

## AC-MAP-30
Venue Entry Instruction 只有 Match / Execution Context 可见。

## AC-MAP-31
已确认 Order 的重大 Venue Change 必须触发 Agent Re-consent。

## AC-MAP-32
Consumer Nearby Places 与 Human Supply Map 必须分离。

## AC-MAP-33
不得存在公共 Nearby Agents / Online People API。

## AC-MAP-34
所有 Precise Location Access 必须 Audit。

## AC-MAP-35
Map 系统最终优化应是 Fill / ETA / Arrival / Execution，而不是 People Browsing。

---

# 124. 本章锁定结论

1. **Proxy 可以非常重地图，但地图绝不能变成“附近的人”。**
2. **Requester 看 Supply Heat，Agent 看 Demand Heat，Matched 后才看 Execution Map。**
3. **供给地图展示 Capacity / ETA / Liquidity，不展示真人位置。**
4. **需求地图帮助 Agent 决定“什么时候去哪里挂 Available”，不是无限任务墙。**
5. **Execution Map 才进入精确 Venue / Route / Check-in。**
6. **位置权限必须分级、Purpose-bound、Order-bound、TTL、Audit。**
7. **Trusted Relationship 永远不产生永久定位权限。**
8. **Private Address 与 Public Venue 必须从数据层分离。**
9. **Store、Venue、Activity、Task Location 可以连接，但业务对象不能和经纬度混为一体。**
10. **ETA 是 Task Context 动态计算值，不是 Agent Profile 属性。**
11. **Matching 应考虑真实 Travel Feasibility 与前序 Order Location。**
12. **P0 不做持续 GPS、不自研地图、不自研导航。**
13. **第三方地图 / ETA / Routing 通过 Adapter 接入。**
14. **地图最终优化的是 Successful Human Execution，而不是 Location Engagement。**

---

# 125. 下一章

下一份增量 PRD：

> **Chapter 18 — Operator Console / Manual Intervention / Marketplace Operations**

重点解决：

```text
什么时候系统自己解决
什么时候必须人工介入
Operator 怎么看 Task / Match / Payment / Safety
Replacement 找不到怎么办
Graph Gap 怎么处理
Dispute 怎么流转
如何避免 Operator 变成“万能后台手工改数据库”
人工操作怎么最小权限、可审批、可审计
```

这一章会把 Proxy 从“产品逻辑完整”推进到“真实上线后能被运营团队安全地救火和治理”。

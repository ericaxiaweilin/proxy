# Proxy PRD v1.1
## Chapter 20 — MVP Cut / P0-P1 / Launch Scope / Acceptance Gate

**文档类型**：增量细化 PRD  
**状态**：MVP 收敛版 / Launch Constitution  
**前置依赖**：Chapter 01–19 全部核心设计

---

# 1. 本章目标

前面已经把 Proxy 的长期架构做完整。

现在必须回答：

> **第一版到底做什么，才能验证 Human Agent Marketplace 是否成立？**

MVP 不是：

```text
把长期 PRD 做 30%
```

而是：

> **只保留能完成一次真实 Human Execution 闭环所必须的能力。**

---

# 2. MVP 北极星

MVP 唯一核心目标：

```text
真实需求
→ 结构化 Task
→ 找到合适真人
→ Agent 接单
→ 到场
→ 完成
→ Agent 收到钱
→ Requester 愿意再用
```

---

# 3. MVP 成功条件

不是：

```text
注册用户多
Profile 多
内容多
地图好看
会员多
```

而是：

```text
Successful Human Executions
+
Repeat
```

---

# 4. 首发必须窄

正式锁定：

> **Generic Architecture，Narrow Launch。**

产品架构支持：

```text
多行业
多 Scenario
多 Role
```

但首发运营：

```text
1 个 Metro
1–2 个主要场景
3–5 个真人 Role
```

---

# 5. 推荐首发市场结构

建议首发：

```text
Business-led
+
one metro / dense corridor
```

原因：

```text
需求更集中
任务更标准
多人 Slot 更常见
复购更强
更容易建立 Trusted Team
更容易做线下运营
```

---

# 6. 推荐首发场景 A

## Business Event / Grand Opening

例如：

```text
Restaurant Opening
Cafe Opening
Retail Promotion
Exhibition
Brand Event
```

核心 Role：

```text
GREETER
EVENT_ASSISTANT
INTERPRETER
```

---

# 7. 为什么首发这个场景

它同时具备：

```text
明确时间
明确地点
明确人数
明确任务
明确履约结果
可形成重复需求
Business 愿意付费
```

而且天然验证：

```text
Task
Slot
Multi-slot
Matching
Arrival
Evidence
Payment
Trusted Team
```

---

# 8. 推荐首发场景 B

## Business On-site Support

例如：

```text
Site Visit Representative
Business Interpreter
Temporary Meeting Assistant
Event / Exhibition Interpreter
```

核心 Role：

```text
INTERPRETER
SITE_VISIT_REP
BUSINESS_ASSISTANT
```

---

# 9. 首发 Role 数量

建议：

```text
3–5 Roles maximum
```

不要：

```text
首发 30 个 Role
```

否则：

```text
每个 Liquidity Cell 供需都太薄
```

---

# 10. MVP 可以支持 Individual Requester

架构和产品 P0 支持：

```text
INDIVIDUAL REQUESTER
BUSINESS REQUESTER
```

但首发获客和运营：

> **Business 优先。**

---

# 11. Individual P0 场景

只开放风险较低、标准化任务。

例如：

```text
Queue
Simple Pickup
Public-place Site Visit
Interpreter
```

私人住宅、高现金、高价值敏感任务：

```text
先限制
```

---

# 12. 不把 Individual 场景作为冷启动主供需

原因：

```text
需求分散
频次不稳定
地点离散
安全边界更复杂
```

---

# 13. MVP 三个用户闭环

必须同时完整支持：

```text
Requester
Agent
Business
```

但 Business 是 Requester Principal 的增强模式。

---

# 14. Requester MVP 闭环

```text
Create Task
↓
Choose Industry / Scenario
↓
Role / Quantity
↓
Time / Location
↓
Must / Nice
↓
Deliverable
↓
Budget
↓
Supply Preview
↓
Commit
↓
Match
↓
Invite / Fast Match
↓
Order
↓
Execution
↓
Completion
↓
Payment
↓
Repeat
```

---

# 15. Requester P0 不能缺

```text
Task Builder
Supply Preview
Qualified Candidate Set
Fast Match
Curated Match
Payment Protection
Order Tracking
Chat
Completion
Repeat
```

---

# 16. Agent MVP 闭环

```text
Become a Proxy
↓
Identity
↓
Role / Capability
↓
Availability
↓
Offer
↓
Accept
↓
Go to task
↓
Check in
↓
Execute
↓
Evidence
↓
Complete
↓
Earnings
↓
Available Again
```

---

# 17. Agent P0 不能缺

```text
AgentProfile
Capability Passport
Role Activation
Basic Verification
Available Now
Scheduled Availability
Offer
Accept / Decline
Execution
Check-in
Evidence
Earnings
Payout status
```

---

# 18. Business MVP 闭环

```text
Business Workspace
↓
Create Task
↓
Create multiple Slots
↓
Fill
↓
Track arrival
↓
Handle exception
↓
Confirm completion
↓
See spend
↓
Save Trusted Team
↓
Repeat template
```

---

# 19. Business P0 不能缺

```text
BusinessAccount
Basic Membership / Staff roles
Store
Task Template
Multi-slot Dashboard
Trusted Team
Billing View
Exception View
```

---

# 20. MVP 系统主链

正式冻结：

```text
Identity
↓
Capability Graph
↓
Task
↓
Atomic TaskSlot
↓
Matching Eligibility
↓
Ranking
↓
Invite / Offer
↓
Agent Accept
↓
Funding Gate
↓
Order
↓
Execution
↓
Evidence
↓
Completion
↓
Settlement
↓
Outcome / Repeat
```

---

# 21. 任何 P0 功能必须服务这条链

如果功能不能明显帮助：

```text
Create
Match
Accept
Execute
Pay
Repeat
```

则默认：

```text
NOT P0
```

---

# 22. P0 — Identity

必须：

```text
UserAccount
Individual Principal
Business Principal
AgentProfile
Mode Switch
Business Principal Switch
Basic KYC
```

---

# 23. P0 — Capability Graph

只做最小 Graph。

建议：

```text
2 Industries
4–6 Scenarios
3–5 Roles
20–40 Capabilities
```

而不是一次建完整职业世界。

---

# 24. MVP Graph 原则

只建：

> **真实首发 Task 会用到的 Node。**

---

# 25. P0 — Task

必须：

```text
Task
Atomic TaskSlot
SlotGroup
Task Version
Task Source
Task Status
```

---

# 26. P0 — Demand Builder

必须：

```text
Industry
Scenario
Role
Quantity
Time
Location
Must-have
Nice-to-have
Deliverable
Evidence
Budget
```

---

# 27. Natural Language Builder

建议：

```text
P0-lite
```

允许：

```text
一句话输入
→ propose structured fields
```

但高影响字段：

```text
必须人工确认
```

---

# 28. Natural Language 不是 MVP 依赖

如果模型解析不稳定：

用户仍可：

```text
manual structured builder
```

完成 Task。

---

# 29. P0 — Matching

必须：

```text
Hard Eligibility
Availability
Time
Location
Schedule Conflict
Capability
Verification
Risk
Organic Ranking
Finite Candidate Set
```

---

# 30. Matching P0 实现方式

首发：

```text
Deterministic Rules
+
Weighted Ranking
```

不要一开始上：

```text
complex learning-to-rank
```

---

# 31. P0 Candidate Set

```text
4–8 finite candidates
```

无：

```text
infinite scroll
```

---

# 32. P0 — Fast Match

必须支持：

```text
Wave-based Offer
TTL
Accept
Atomic Slot Lock
Sibling Offer Revocation
```

---

# 33. P0 — Curated Match

Requester 可以：

```text
Invite 1–3 qualified candidates
```

---

# 34. P0 — Availability

必须：

```text
Available Now
Scheduled Availability
Role
Time
Area / Radius
Min Pay
Auto Expiry
Conflict Check
```

---

# 35. P0 — Pricing

必须：

```text
FIXED
HOURLY
Minimum Duration
Agent Min Pay
Requester Budget
Agent Earnings
Requester Charge
Platform Fee
```

---

# 36. Price Guidance

P0：

```text
simple configured range
+
recent completed task data where available
```

不要首发做复杂：

```text
ML price elasticity
```

---

# 37. P0 — Payment

必须做到：

```text
Funding Secured before Order
Payment Protected
Settlement
Refund
Agent Earnings Ledger
Basic Payout
```

---

# 38. Payment Provider

首发：

> **直接集成成熟支付服务商。**

不自建金融基础设施。

---

# 39. Escrow 术语谨慎

产品上可以说：

```text
Payment Protected
Funds Secured
```

是否法律意义上的：

```text
Escrow
```

根据市场支付牌照 / Provider 决定。

---

# 40. P0 — Execution

必须：

```text
Order Chat
EN_ROUTE
ARRIVED
Check-in
IN_PROGRESS
Evidence
Completion
Auto-confirm
```

---

# 41. P0 Check-in

建议：

```text
GPS
+
Requester / Business Confirm
```

Business Venue 可增加：

```text
QR
```

---

# 42. P0 Evidence

只做：

```text
Photo
Text
Checklist
Basic Video
Check-in / Check-out
```

---

# 43. P0 Video

只支持：

```text
普通上传
普通播放
```

不做直播。

---

# 44. P0 — Map

必须轻量。

Requester：

```text
Supply indication
Approx area
```

Agent：

```text
Demand / task area
```

Execution：

```text
Venue + Navigate
```

---

# 45. MVP 不需要高级热力地图

首版甚至可以：

```text
地图 + 区域 Supply Card
```

而不是完整动态 Heatmap 引擎。

---

# 46. 地图供应商

直接接：

```text
third-party map / route / geocoding
```

不自研。

---

# 47. P0 — Trust

必须：

```text
System Reliability
Structured bilateral review
Rehire Intent
Trusted Proxy
Business Trusted Team
```

---

# 48. P0 不依赖五星

首发可直接显示：

```text
Completed
On-time
Repeat
Verified
```

而不必强推：

```text
4.9 ★
```

---

# 49. P0 — Safety

绝对不能省：

```text
Task Admission
Prohibited Task Rule
Basic Risk Status
Report Safety Concern
Stop Task
Block
Operator Case
Location TTL
Contact TTL
```

---

# 50. Safety MVP 原则

功能可以简单，

但边界不能缺。

---

# 51. P0 — Operator

必须有一个最小后台。

至少：

```text
Case Queue
Task Review
Match Assist
Replacement Assist
Safety Case
Payment Exception
Manual Adjustment via Command
Audit
```

---

# 52. Operator MVP 不能直接改数据库

即使 MVP：

```text
NO direct DB edits as product workflow
```

---

# 53. P0 — Notification

必须：

```text
In-app
Push

Offer
Task Starts
Arrival
Cancellation
Replacement
Payment Failure
Completion
Safety
```

---

# 54. P0 — Business Workspace

不要做大。

只做：

```text
Business
Members
Store
Tasks
Today
Trusted Team
Spend
```

---

# 55. P0 Business Roles

可以先缩成：

```text
OWNER
TASK_MANAGER
OPERATIONS
BILLING
```

Safety 权限可先：

```text
Owner / explicitly authorized
```

后续再细拆。

---

# 56. P0 — Analytics

至少有：

```text
Successful Human Executions
Committed Slots
Fill Rate
Time to Fill
Offer Acceptance
Arrival
Completion
Cancellation
Replacement
Agent Earnings
Repeat
Manual Intervention
Safety Incidents
```

---

# 57. 内容模块 P0 定位

内容不是首发 Marketplace 阻塞项。

如果做：

```text
Text
Image
Long-form
Basic Video
Share
```

可以作为：

```text
P0.5 / parallel lightweight module
```

---

# 58. 内容不能拖慢 Marketplace Launch

正式原则：

> **如果 Content 与 Human Execution Core 争抢开发资源，Core 优先。**

---

# 59. P0 Content 最小版

若团队资源足够：

```text
Create Post
Image
Long-form
Video Playback
Venue / Business binding
Share
```

---

# 60. P0 不做内容推荐算法

初期：

```text
Latest
Following Business
Nearby Venue / Activity
```

就够。

---

# 61. Membership P0 定位

Chapter 16 的完整会员系统：

```text
NOT launch blocker
```

---

# 62. Membership 架构预留

首发只保留：

```text
MerchantCustomerRelation schema
MembershipProgram schema
```

甚至可以不在用户 UI 上开放。

---

# 63. Earn → Spend

首发：

```text
architecture only
```

不需要马上支持 Agent Wallet 消费。

---

# 64. 为什么不首发 Earn → Spend

因为必须先证明：

```text
Agent can reliably earn
```

否则：

```text
Spend loop
```

没有根。

---

# 65. Live

正式：

```text
NOT MVP
```

未来有真实需求：

```text
integrate paid provider
```

---

# 66. Social Cross-post

```text
P1
```

不是 Marketplace Launch blocker。

---

# 67. Advanced Merchant OS

全部：

```text
P2 / Future
```

包括：

```text
Full Membership CRM
Reservation
Storefront Builder
Campaign Automation
POS
```

---

# 68. CCTV / Scene Network

正式：

```text
FUTURE / PILOT ONLY
```

当前只保留：

```text
venue_id
activity_id
task.source
```

架构接口。

---

# 69. Advanced AI

以下不是 MVP 必需：

```text
Learning-to-rank
Advanced AI evidence review
AI price prediction
AI fraud decision
AI operator auto-resolution
```

---

# 70. MVP AI 的正确位置

只做：

```text
Task parsing assist
Case summary assist
Text moderation assist
```

都必须有：

```text
deterministic fallback
```

---

# 71. 不要把模型做成系统真相

MVP 仍然：

```text
State Machine
Policy
Ledger
Domain Event
```

是真相。

---

# 72. P0 Sponsored Boost

因为商业模型已锁定 Agent Boost，

MVP 可以保留：

```text
simple Boost
```

但建议：

```text
Launch after basic organic liquidity is proven
```

即：

```text
P0.5
```

---

# 73. 为什么 Boost 不应 Day 1 重度上线

如果市场还没有自然成交：

```text
Agent 没有真实曝光价值
```

卖 Boost 会伤害信任。

---

# 74. Boost 上线 Gate

至少满足：

```text
Organic Matching works
Qualified supply exists
Regular orders exist
Exposure has value
```

才启用付费 Boost。

---

# 75. Boost P0.5

只做：

```text
1-day
3-day
Role Boost
Sponsored label
Sponsored cap
```

---

# 76. 不做

MVP 明确不做：

```text
People Search
Nearby People
Infinite Candidate Scroll
Agent Leaderboard
Beauty Ranking
Fan System
Dating / Companion
Public Task Wall
Lowest-price Bidding
Continuous GPS
Native Live
Full CRM
POS
Payroll
Inventory
Advanced Social Network
```

---

# 77. 这些是产品红线，不只是延期

尤其：

```text
People Search
Nearby People
Public Task Wall
Lowest-price Bidding
```

不是：

```text
P1
```

而是：

> **与 Proxy 核心方向冲突，默认长期也不做。**

---

# 78. MVP 页面数量应该收敛

建议首发核心页面约：

```text
Requester: 10–14
Agent: 10–14
Business: 6–10
Shared: 6–8
Operator: 5–8
```

不是继续扩成：

```text
100+ screens
```

---

# 79. Requester 核心页面

建议：

```text
Home
Create Task
Task Review
Supply Preview
Matching
Candidate Detail
Task Detail
Order Detail
Execution
Completion
Payment
Repeat / Trusted
Inbox
Profile / Settings
```

---

# 80. Agent 核心页面

建议：

```text
Agent Home
Become a Proxy
Passport
Roles / Capabilities
Available Now
Availability Calendar
Offer Detail
Upcoming
Execution
Evidence
Earnings
Trusted / Repeat
Inbox
Settings
```

---

# 81. Business 核心页面

建议：

```text
Workspace Home
Create Task
Task Detail
Multi-slot Execution
Trusted Team
Templates
Spend
Members
Store
Inbox
```

---

# 82. Operator 核心页面

建议：

```text
Case Queue
Case Detail / Timeline
Task Review
Match Assist
Payment / Dispute
Safety
Audit
```

---

# 83. MVP 数据对象

P0 必须稳定：

```text
UserAccount
BusinessAccount
BusinessMembership
AgentProfile
AgentRole
AgentCapability
Task
TaskSlot
SlotGroup
MatchAttempt
Offer
Order
AvailabilitySession
SupplyReservation
CompensationTerms
PaymentIntent
FundingHold
LedgerEntry
ExecutionContext
Evidence
Review
TrustedRelationship
Incident
OperatorCase
NotificationEvent
```

---

# 84. P0 Schema 不要偷懒合并

不要因为 MVP：

```text
Task + Order 合一个表
User + Agent 合一个表
price 一个字段
status 一个万能字段
```

这些会直接破坏长期架构。

---

# 85. 哪些地方可以简化

可以简化：

```text
UI
policy coverage
role count
industry count
automation depth
map sophistication
analytics sophistication
```

---

# 86. 哪些地方不能简化

不能简化：

```text
Task / Slot / Order separation
Funding before Order
Ledger
Eligibility vs Ranking
Availability
Data visibility
Safety
Audit
```

---

# 87. Launch Geography

正式建议：

```text
one metro
```

而不是：

```text
全越南 / 全国
```

---

# 88. Launch Zone 选择标准

应该有：

```text
Business density
Agent density
Travel manageable
Repeat demand
Operational support
```

---

# 89. 如果首发越南

运营上更适合选择：

```text
一个高密度城市 / 城市圈
```

而不是把 Supply 分散到多个省市。

产品架构仍保持多市场。

---

# 90. Supply Cold Start

首发前必须准备：

```text
seed agents
```

不是空市场上线。

---

# 91. Seed Agent

每个首发 Role 必须有：

```text
minimum qualified supply
```

---

# 92. 不只看注册量

Launch Gate 看：

```text
Qualified
Verified enough
Available
Responsive
```

---

# 93. Demand Cold Start

首发必须有：

```text
anchor businesses
```

持续产生真实 Task。

---

# 94. Anchor Business

比大量一次性 Consumer 更重要。

目标：

```text
repeat human demand
```

---

# 95. Supply / Demand 同时 seed

不能：

```text
先招 1000 Agents 再找需求
```

也不能：

```text
先签 100 Businesses 但没人执行
```

---

# 96. Cell-by-cell Launch

按：

```text
Geo × Role × Time
```

打开。

而不是：

```text
整个城市所有 Role 一次开放
```

---

# 97. Liquidity Gate

一个 Cell 开放前至少要有：

```text
qualified supply
expected demand
operator coverage
```

---

# 98. Soft Launch

建议：

```text
Invite-only / controlled
```

先跑：

```text
50–200 real executions
```

再扩大。

数字是运营建议，不是架构硬编码。

---

# 99. 为什么先 controlled launch

可以快速发现：

```text
Task schema gap
supply mismatch
payment issue
operator pain
safety edge case
```

---

# 100. Launch Stage 0 — Internal / Friends & Partners

目标：

```text
完整跑通交易
```

不是做数据。

---

# 101. Stage 1 — Controlled Business Pilot

目标：

```text
repeat task
multi-slot
real payment
real agent earnings
```

---

# 102. Stage 2 — Limited Public

当：

```text
Fill
Arrival
Completion
Payment
Safety
```

稳定后扩大。

---

# 103. Stage 3 — Expand Role / Geo

一次只扩：

```text
Role
or
Geo
or
Scenario
```

尽量不要三者同时扩。

---

# 104. Launch Gate — Product

必须：

```text
Task created
Match works
Agent accepts
Order atomic
Payment protected
Execution works
Completion works
Settlement works
```

---

# 105. Launch Gate — Integrity

必须通过：

```text
No double active Order per Slot
No unpaid confirmed Order
No duplicate payout
No stale precise-location grant
No generic people search
```

---

# 106. Launch Gate — Safety

必须：

```text
Task Admission
Report
Stop Task
Block
Operator Case
Emergency handling procedure
```

即使 SOS 自动能力 P1。

---

# 107. Launch Gate — Payment

必须真实测试：

```text
Authorization
Capture
Failure
Refund
Partial Refund
Payout
Reconciliation
```

---

# 108. Launch Gate — Replacement

必须验证：

```text
Agent cancel
↓
Slot reopen
↓
Replacement
↓
new Order
↓
funding carry-forward
```

---

# 109. Launch Gate — Multi-slot

必须测试：

```text
5 Slots
partial fill
replacement
different outcomes
per-order settlement
```

---

# 110. Launch Gate — Data Privacy

必须测试：

```text
No Task → no Candidate
Candidate → no private contact
Matched → controlled location
Closed → revoke location/contact
```

---

# 111. Launch Gate — Business Access

必须测试：

```text
Business A cannot see B
Removed member loses access
Billing role separation
Task ownership survives member removal
```

---

# 112. Launch Gate — Operator

必须：

```text
Operator cannot edit DB as product workflow
all commands audited
financial adjustment ledgered
critical actions permissioned
```

---

# 113. Launch Gate — Analytics

至少能准确回答：

```text
How many committed slots?
How many filled?
How many arrived?
How many completed?
How much did agents earn?
Why were slots unfilled?
```

---

# 114. Launch Gate — Notification

必须验证：

```text
Offer
Cancellation
Replacement
Arrival
Payment failure
Safety
```

不会漏关键动作。

---

# 115. Core Acceptance Gate

建议定义：

```text
MVP_ACCEPTANCE_GATE
```

只有下面全部通过才能扩大流量。

---

# 116. Gate A — Transaction Integrity

```text
PASS
```

条件：

```text
Task / Slot / Order invariant stable
Funding protected
Ledger reconciles
```

---

# 117. Gate B — Human Execution

```text
PASS
```

条件：

```text
real agents actually arrive
real tasks actually complete
```

---

# 118. Gate C — Marketplace Liquidity

```text
PASS
```

条件：

```text
target launch cells
have acceptable fill / time-to-fill
```

具体阈值上线运营时设。

---

# 119. Gate D — Agent Economics

```text
PASS
```

条件：

```text
Agents receive real earnings
payout works
earnings are attractive enough to repeat
```

---

# 120. Gate E — Requester Repeat

```text
PASS
```

条件：

```text
real requesters create repeat tasks
```

---

# 121. Gate F — Safety

```text
PASS
```

条件：

```text
incidents can be reported
execution can be stopped
operator can intervene
sensitive grants revoke
```

---

# 122. Gate G — Operator Load

如果：

```text
几乎每单都需要人工救火
```

即使成交了，

也：

```text
NOT READY TO SCALE
```

---

# 123. Operator Load Gate

重点观察：

```text
Manual Intervention Rate
```

首发允许高一些，

但必须知道原因。

---

# 124. P0 vs P1 总表 — Core

## P0

```text
Identity
Business Principal
Agent Passport
Capability Graph lite
Task / Slot / Order
Demand Builder
Matching
Fast / Curated
Availability
Pricing
Funding / Settlement
Execution
Evidence
Trust / Repeat
Safety
Notification
Business Workspace lite
Operator
Analytics
```

---

# 125. P1 — Marketplace Enhancement

```text
Recurring Availability
Advanced Map Heat
Demand Pulse
Quote Mode
Advanced Verification
Blind Review
Calendar Sync
Advanced Business Approval
Advanced Operator tooling
Learning-to-rank
```

---

# 126. P1 — Growth

```text
Basic Content Expansion
Social Import / Cross-post
Agent Boost
Membership UI
Activities
Merchant Benefits
```

---

# 127. P2 — Strategic Extensions

```text
Native / integrated Live
Merchant Checkout
Advanced CRM
Reservation
Storefront Builder
Scene Network
CCTV / Sensor
Remote Live Staffing
Cross-market Wallet
```

---

# 128. Never / Default No

继续锁定：

```text
Generic People Search
Nearby People
Infinite Candidate Feed
Public Human Leaderboard
Beauty Ranking
Companion / Dating
Lowest-price bidding
Permanent precise location access
Off-task sensitive filtering
```

---

# 129. MVP 开发优先级

建议工程顺序：

```text
1. Identity / Principal
2. Graph Lite
3. Task / Slot / Order
4. Agent Passport
5. Availability
6. Matching
7. Offer / Accept
8. Pricing / Funding
9. Execution / Evidence
10. Payment Settlement
11. Safety
12. Business Workspace
13. Notification
14. Trusted / Repeat
15. Operator
16. Analytics
17. Content Lite
```

---

# 130. 为什么 Content 放最后

Content 有价值，

但第一版必须先证明：

> **Proxy 能让真人成功完成现实任务。**

否则内容增长只会掩盖核心 Marketplace 没跑通。

---

# 131. 不要按页面开发

工程不能：

```text
先做完整 Home
再做完整 Profile
再做完整 Settings
```

应该：

```text
vertical slice
```

---

# 132. Vertical Slice 1

第一条完整链：

```text
Business
→ Greeter Task ×1
→ Agent
→ Accept
→ Payment
→ Check-in
→ Complete
→ Earnings
```

---

# 133. Vertical Slice 2

```text
Business
→ Greeter ×3
→ partial fill
→ replacement
→ all completed
```

---

# 134. Vertical Slice 3

```text
Interpreter
→ scheduled task
→ curated invite
→ completion
→ trusted proxy
→ repeat
```

---

# 135. Vertical Slice 4

```text
Agent cancel
→ replacement
→ funding preserved
→ new agent completes
```

---

# 136. Vertical Slice 5

```text
Task mismatch / safety issue
→ stop
→ incident
→ operator
→ payment resolution
```

---

# 137. MVP Test Data

必须包含：

```text
multiple businesses
multiple agents
multiple roles
multiple stores
availability conflicts
payment failure
safety incident
```

不能只测试：

```text
happy path
```

---

# 138. MVP Load

不需要一开始支持百万用户。

更重要：

```text
state correctness
transaction correctness
privacy correctness
```

---

# 139. Architecture Reserve

即使不做 UI，也必须保留核心字段：

```text
task.source_type
task.source_id

business_id
store_id
venue_id
activity_id optional

execution_mode

provider abstractions

pricing_version
graph_version
policy_version
```

---

# 140. 不提前实现 Reserved Feature

架构预留：

```text
does not mean
build it now
```

---

# 141. Launch Decision Framework

每次想加 P0 功能，必须问：

```text
没有它，
一次真实 Human Execution 能不能安全完成？
```

如果：

```text
能
```

则大概率：

```text
P1 / Later
```

---

# 142. 第二个问题

```text
它是否直接提升：
Fill
Arrival
Completion
Agent Earnings
Repeat
Safety
```

如果都没有：

```text
cut
```

---

# 143. 第三个问题

继续使用长期硬规则：

```text
Does it encourage people browsing?
Does it expose unnecessary human data?
Does it improve real matching / execution?
```

---

# 144. MVP Product Statement

首发版本可以对外简单表达：

> **Proxy helps businesses and individuals find the right real person to show up and get a task done.**

不是：

```text
AI platform
social network
freelance website
gig feed
```

---

# 145. MVP Agent Statement

> **When you have free time, turn on Proxy and get matched with real tasks that fit what you can do.**

---

# 146. MVP Business Statement

> **When you are short a real person for a shift, event or on-site task, create the slots and Proxy fills them.**

---

# 147. MVP Requester Statement

> **Tell Proxy what needs to happen, when and where. Proxy finds a qualified real person to do it.**

---

# 148. MVP 成功后的扩展顺序

建议：

```text
1. Increase liquidity in existing cells
2. Increase repeat
3. Add adjacent Roles
4. Add adjacent Scenarios
5. Add adjacent Geo
6. Add growth/content/membership
```

而不是：

```text
核心没密度
→ 立刻全国扩张
```

---

# 149. Expand Role Gate

新 Role 上线前：

```text
Task schema exists
Capability requirements clear
Supply can be seeded
Evidence defined
Safety policy defined
```

---

# 150. Expand Scenario Gate

新 Scenario：

```text
Role mapping
Task template
pricing
evidence
risk
```

必须准备。

---

# 151. Expand Geo Gate

新 Geo：

```text
supply
anchor demand
payment support
operator support
local policy
```

必须准备。

---

# 152. MVP North Star Dashboard

首页只需要看：

```text
Successful Human Executions

Committed Slots
Filled Slots
Median Time to Fill
Arrival Rate
Completion Rate

Agent Earnings
Repeat Task Rate
Critical Incidents
Manual Intervention Rate
```

---

# 153. MVP 失败信号

如果出现：

```text
用户大量逛 Candidate
但不 Commit

Agent 很多
但没人 Available

Offer 很多
但没人 Accept

Accept 很多
但不 Arrival

Completion 高
但 Agent 不愿 Repeat

GMV 高
但人工介入极高
```

都说明核心尚未成立。

---

# 154. 最大风险：伪流动性

最危险的数据：

```text
10,000 registered Agents
```

但：

```text
5 个真实可用
```

所以任何 Launch 决策都禁止使用：

```text
registered users
```

冒充 Liquidity。

---

# 155. 最大风险：伪成功

例如：

```text
Order Created
```

不能算成功。

真正成功：

```text
Human actually executed
```

---

# 156. 最大风险：功能过多

Proxy 现在最大风险不是功能少，

而是：

> **把长期架构全部同时开发，导致核心真人交易一直不上线。**

---

# 157. MVP 最终产品边界

第一版 Proxy 应该像：

```text
Human Execution Marketplace
```

而不是：

```text
Super App
```

---

# 158. Acceptance Criteria

## AC-MVP-01
MVP 必须围绕完整 Successful Human Execution 闭环设计。

## AC-MVP-02
架构保持 Generic，但首发必须 Narrow。

## AC-MVP-03
首发最多 1 个核心 Metro / Dense Corridor。

## AC-MVP-04
首发建议只打 1–2 个主 Scenario。

## AC-MVP-05
首发 Role 建议控制在 3–5 个。

## AC-MVP-06
Business 应作为首发运营重点 Requester。

## AC-MVP-07
Individual Requester 可以 P0 支持，但不作为冷启动唯一主需求。

## AC-MVP-08
Task / Slot / Order 分离不得为了 MVP 合并。

## AC-MVP-09
Eligibility / Ranking 分离不得为了 MVP 合并。

## AC-MVP-10
Availability 不得用注册 Agent 数替代。

## AC-MVP-11
付费 Order 必须先有 Funding Protection。

## AC-MVP-12
Ledger 不得因 MVP 被省略。

## AC-MVP-13
Execution / Check-in / Completion 必须真实跑通。

## AC-MVP-14
Safety / Stop Task / Incident / Operator 不得延期到规模化后才做。

## AC-MVP-15
No Task No Generic People Search 必须从首版执行。

## AC-MVP-16
P0 不得出现 Nearby People。

## AC-MVP-17
P0 不得出现 Infinite Candidate Scroll。

## AC-MVP-18
P0 不得出现 Public Task Wall。

## AC-MVP-19
P0 不得出现 Lowest-price Bidding。

## AC-MVP-20
Content 不得阻塞 Human Marketplace Core Launch。

## AC-MVP-21
Native Live 不属于 MVP。

## AC-MVP-22
Full Merchant CRM / POS / Storefront 不属于 MVP。

## AC-MVP-23
Scene / CCTV Network 只保留架构接口。

## AC-MVP-24
Advanced AI 不得成为核心主链依赖。

## AC-MVP-25
MVP Matching 应优先使用 deterministic eligibility + rule-weighted ranking。

## AC-MVP-26
Agent Boost 可保留，但建议 Organic Liquidity 证明后再商业化。

## AC-MVP-27
Business Workspace P0 必须以 Human Slots / Execution 为中心。

## AC-MVP-28
MVP 必须支持真实 Replacement 闭环。

## AC-MVP-29
MVP 必须测试 Multi-slot Partial Fill。

## AC-MVP-30
MVP 必须测试 Requester / Agent No-show 与 Payment Failure。

## AC-MVP-31
MVP 必须测试敏感位置 / 联系方式自动撤销。

## AC-MVP-32
MVP 必须测试 Business Data Isolation。

## AC-MVP-33
Operator 不得通过产品流程直接修改数据库。

## AC-MVP-34
核心财务 / 状态动作必须 Audit。

## AC-MVP-35
Launch Analytics 必须能回答 Slot Fill / Arrival / Completion / Agent Earnings / Unfilled Reason。

## AC-MVP-36
首发必须 Seed Supply + Anchor Demand 同时进行。

## AC-MVP-37
市场应按 Liquidity Cell 逐步开放，而非全国一次开放。

## AC-MVP-38
Scale 前必须通过 Transaction / Execution / Liquidity / Economics / Repeat / Safety / Operator Load Gates。

## AC-MVP-39
如果几乎每单都需要 Operator，系统不得大规模扩张。

## AC-MVP-40
MVP 成功后应先加深已有市场 Liquidity / Repeat，再扩 Role / Scenario / Geo。

---

# 159. 本章锁定结论

1. **Proxy 第一版不是 Super App，而是 Human Execution Marketplace。**
2. **Generic architecture，narrow launch。**
3. **建议 Business-led，1 个 Metro，1–2 个核心 Scenario，3–5 个 Role。**
4. **推荐首先验证 Event / Grand Opening + Business On-site Support。**
5. **P0 必须完整跑通 Task → Slot → Match → Accept → Funding → Order → Execution → Earnings → Repeat。**
6. **State / Ledger / Safety / Privacy 等系统真相不能因为 MVP 偷工减料。**
7. **可以砍 UI、行业数量、自动化和算法复杂度，但不能砍交易完整性。**
8. **Content Lite 可以做，但不能拖慢 Marketplace Core。**
9. **Membership / Earn→Spend 当前主要架构预留，先证明 Agent 真的能稳定赚钱。**
10. **Native Live、Advanced Merchant OS、Scene Network 都不是 MVP。**
11. **Agent Boost 保留商业方向，但最好 Organic Liquidity 成立后再正式卖。**
12. **首发必须 Supply + Demand 同时 Seed。**
13. **市场应按 Liquidity Cell 打开，不按“注册用户数量”打开放量。**
14. **真正的 Launch Gate 是真人真的到场、完成、拿到钱、Requester 愿意再用。**
15. **如果人工救火仍然是隐藏主链，就还没有资格 Scale。**

---

# 160. 下一步建议

MVP Cut 已经完成后，不应该继续无止境横向增加模块。

下一步更有价值的是进入：

> **Chapter 21 — P0 Screen Flow / Information Architecture / Page-level Product Spec**

把 MVP 直接压成：

```text
Requester
Agent
Business
Operator
```

四套 P0 页面，

逐页明确：

```text
页面目的
字段
CTA
状态
空状态
错误状态
权限
API 输入输出
```

这样就可以直接进入 UI Prototype / Engineering Backlog。

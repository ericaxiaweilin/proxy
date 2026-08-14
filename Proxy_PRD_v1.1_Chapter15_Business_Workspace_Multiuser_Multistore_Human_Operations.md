# Proxy PRD v1.1
## Chapter 15 — Business Workspace / Multi-user / Multi-store / Human Operations

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 04 — Requester Demand Builder
- Chapter 10 — Payment / Settlement
- Chapter 12 — Trusted Proxy / Repeat Relationship
- Chapter 13 — Safety / Risk
- Chapter 14 — Notification / Inbox

**本章范围**：
- BusinessAccount
- Business Workspace
- Multi-user Membership
- Business Roles / Permission
- Multi-store
- Store / Venue
- Task Ownership
- Multi-slot Operations
- Trusted Team
- Business Dashboard
- Billing Visibility
- Safety Visibility
- Activity / Campaign Human Agent Need
- Operator / Staff Boundaries
- Audit
- Business Analytics

**本章不细化**：
- Storefront page builder
- Membership CRM
- Full Reservation system
- POS / Inventory / Accounting
这些仍属于未来 Merchant OS 扩展，不在本章做深。

---

# 1. 本章目标

Business Workspace 要解决：

> **一个真实商家 / 企业 / 组织如何多人协作地创建、填充、执行、结算和重复使用 Human Agent。**

它不是：

```text
ERP
CRM
POS
HRIS
```

而是：

> **Business Human Operations Workspace**

---

# 2. 核心 Business 心智

正式锁定：

> **临时缺真人执行能力 → 打开 Proxy → 建 Slot → 补齐 → 到场 → 完成。**

例如：

```text
Saturday Grand Opening

Need:
Greeter ×3
Interpreter ×1
Content Talent ×1
```

Business Workspace 的核心任务：

```text
5 slots
↓
find 5 real humans
↓
make sure they show up
↓
complete execution
```

---

# 3. BusinessAccount

BusinessAccount 必须是独立 Principal。

Schema：

```text
business_id

legal_name
display_name

business_type
verification_status

default_currency
default_timezone

status

created_at
updated_at
```

---

# 4. Business Status

```text
DRAFT
ACTIVE
RESTRICTED
SUSPENDED
CLOSED
```

---

# 5. Business ≠ User

正式硬规则：

> Business Task 属于 Business Principal，不属于创建它的员工个人。

Task 必须保存：

```text
created_by_user_id
principal_type = BUSINESS
principal_id = business_id
```

---

# 6. 为什么必须这样

如果员工离职：

```text
Task
Trusted Team
Billing
Outcome
History
```

仍然属于：

```text
Business
```

不能跟员工账号走。

---

# 7. BusinessMembership

用户与 Business 的关系：

```text
BusinessMembership
```

Schema：

```text
membership_id
business_id
user_id

role_id
status

invited_by
joined_at
removed_at
```

---

# 8. Membership Status

```text
INVITED
ACTIVE
SUSPENDED
REMOVED
```

---

# 9. Business Role

P0 推荐：

```text
OWNER
ADMIN
TASK_MANAGER
OPERATIONS
BILLING
SAFETY_MANAGER
VIEWER
```

---

# 10. OWNER

可以：

```text
manage business
manage members
manage roles
manage stores
manage billing
manage tasks
manage trusted team
manage safety
```

---

# 11. ADMIN

接近 Owner，

但不能默认：

```text
transfer ownership
close business
```

---

# 12. TASK_MANAGER

可以：

```text
create task
edit draft
commit task
create slots
invite agents
manage replacement
repeat task
```

---

# 13. OPERATIONS

偏执行：

```text
view upcoming tasks
view assigned agents
check arrivals
confirm completion
communicate with agents
```

不能默认：

```text
view billing details
manage members
```

---

# 14. BILLING

可以：

```text
view charges
funding
refund
invoice
payment method
business balance
```

但不能默认：

```text
change task execution
see sensitive incident details
```

---

# 15. SAFETY_MANAGER

可以：

```text
view business safety incidents
handle venue issues
respond to safety actions
```

不默认拥有：

```text
full billing
full KYC
```

---

# 16. VIEWER

只读：

```text
task summary
status
approved business data
```

---

# 17. Permission 不是 Role 名硬编码

推荐使用：

```text
Permission
```

例如：

```text
TASK_CREATE
TASK_COMMIT
TASK_CANCEL
SLOT_MANAGE
AGENT_INVITE
TRUSTED_TEAM_MANAGE
BILLING_VIEW
BILLING_MANAGE
SAFETY_VIEW
SAFETY_MANAGE
MEMBER_MANAGE
STORE_MANAGE
```

Role 只是 Permission Bundle。

---

# 18. Effective Permission

实际权限：

```text
Business Role
+
Store Scope
+
Policy Restriction
+
Risk Restriction
=
Effective Permission
```

---

# 19. Store

Business 必须支持：

```text
1 Business
→ N Stores
```

推荐对象：

```text
Store
```

Schema：

```text
store_id
business_id

name
store_type

venue_id optional
timezone

status

created_at
updated_at
```

---

# 20. Store Status

```text
ACTIVE
PAUSED
CLOSED
```

---

# 21. Store 与 Venue 分离

Store：

```text
business operating unit
```

Venue：

```text
physical execution location
```

例如：

```text
Business = Coffee Group A

Store = Tây Hồ Branch
Venue = 25 Xuân Diệu
```

未来一个 Store 甚至可以：

```text
temporary venue
event venue
```

---

# 22. Multi-store 权限

某员工可能：

```text
Operations for Store A only
```

因此 Membership 需要未来支持：

```text
scope_type
scope_ids[]
```

例如：

```text
STORE_SCOPE
```

---

# 23. Store Manager

P1 可以增加：

```text
STORE_MANAGER
```

只管理特定 Store。

---

# 24. Workspace Principal Switch

一个用户可能：

```text
Individual
Business A
Business B
```

UI 必须明确：

```text
Working as:
Bonsaidon
```

---

# 25. Business Workspace Home

不应该以：

```text
销售报表
库存
会员列表
```

作为核心。

P0 首页建议：

```text
Today
Human Slots
Upcoming Tasks
Exceptions
Trusted Team
Spend
```

---

# 26. Business Dashboard

核心卡片：

```text
Today

12 Human Slots
10 Filled
1 Replacement
1 Open

5 Agents Arrived
3 In Progress
2 Upcoming
```

---

# 27. First KPI

Business 最先看到：

```text
Slot Fill
```

而不是：

```text
Profile Views
```

---

# 28. Human Operations Dashboard

建议：

```text
Need
Filled
Confirmed
Arrived
In Progress
Completed
Exception
```

---

# 29. Today View

例如：

```text
Grand Opening
18:00–21:00

Greeter
3/3 Filled
2 Arrived

Interpreter
1/1 Filled
On the way

Content
0/1
Replacement / Match needed
```

---

# 30. Action Required

Business Workspace 最重要区域之一：

```text
1 Slot still open
1 Agent cancelled
2 completion reviews
1 payment action
```

---

# 31. Task Creation

Business 使用 Chapter 04 Demand Builder，

但支持更快的：

```text
Business Template
Store Prefill
SlotGroup
Trusted Team
```

---

# 32. Business Task Template

推荐：

```text
BusinessTaskTemplate
```

保存：

```text
industry
scenario
store
venue
slot groups
requirements
deliverables
evidence
default pricing
preferred agents
```

---

# 33. Template 不保存旧 Order

不能保存：

```text
old order IDs
active assignments
old exact execution date
```

---

# 34. Repeat Business Task

主链：

```text
Template
↓
New Draft
↓
Select date
↓
Check Trusted Team
↓
Fill gap with Marketplace
```

---

# 35. Multi-slot Operations

Business 必须支持批量操作：

```text
Add Role
Change quantity
Copy requirement
Copy pricing
Cancel open slots
Invite trusted team
```

但底层仍保持：

```text
atomic TaskSlot
```

---

# 36. SlotGroup UI

例如：

```text
Greeter ×5
```

Business UI 可显示：

```text
3 Assigned
1 Open
1 Replacement Required
```

---

# 37. Business 不直接管理“员工”

Human Agent 是：

```text
Marketplace participant
```

不是：

```text
Business employee record
```

除非未来有独立长期用工产品。

---

# 38. Trusted Team

Business 完成成功 Order 后：

可以：

```text
Add to Trusted Team
```

---

# 39. Trusted Team Structure

推荐：

```text
BusinessTrustedTeam
```

以及：

```text
BusinessTrustedAgent
```

字段：

```text
business_id
store_id optional
agent_id

role_ids[]
status

created_from_order_id
created_by
created_at
```

---

# 40. Trusted Team Status

```text
ACTIVE
PAUSED
REMOVED
BLOCKED
```

---

# 41. Trusted Team 用途

```text
Direct Invite
Repeat Task
Preferred Match
Availability Request
```

---

# 42. Trusted Team 不等于员工排班

正式边界：

> Trusted Team 是 Marketplace Relationship，不是 Employment Relationship。

---

# 43. Trusted Team Availability

Business 只能看到：

```text
available for this task
not available
unknown
```

不看：

```text
Agent 全天私人日历
精确位置
```

---

# 44. Fill from Trusted Team

例如：

```text
Need 5 Greeters

Trusted available = 3
```

可以：

```text
Invite 3 Trusted
+
Marketplace match 2
```

---

# 45. Trusted Fill Rate

核心指标：

```text
Trusted Team Fill Rate
```

长期可以帮助 Business 降低每次重新匹配成本。

---

# 46. Multi-user Task Ownership

Task 属于 Business。

但要记录：

```text
created_by
task_manager
operations_owner
billing_owner optional
```

---

# 47. Task DRI

推荐：

```text
task_owner_user_id
```

代表：

> 当前 Business 内负责这项 Task 的人。

---

# 48. DRI 可转移

如果成员休假 / 离职：

```text
Reassign Task Owner
```

不影响：

```text
Task Principal
```

---

# 49. Business Chat

多人 Business 不应该所有成员都进入所有 Order Chat。

默认：

```text
Task Owner
Operations assigned staff
```

可参与。

---

# 50. Chat Permission

建议：

```text
ORDER_CHAT_READ
ORDER_CHAT_WRITE
```

单独控制。

---

# 51. Billing Visibility

Task Manager 不一定需要看到：

```text
完整公司账单
payment method
```

但可以看：

```text
task budget
approved compensation
```

---

# 52. Billing Detail

只有：

```text
BILLING_VIEW
```

可以看：

```text
service fee
refund
payment method
invoice
ledger detail
```

---

# 53. Safety Visibility

普通 Task Manager 可以看到：

```text
This order is under safety review
```

但不一定能看到：

```text
full incident evidence
```

---

# 54. Safety Manager

有：

```text
SAFETY_VIEW
```

才能看授权 Incident Detail。

---

# 55. Business KYC / Verification

Business 可以有：

```text
verification_status
```

用于：

```text
Requester Trust
high-risk task eligibility
billing
```

---

# 56. Business Verification 不等于无限权限

Verified Business：

仍然不能：

```text
绕过 Task Admission
查看 Agent 私人数据
```

---

# 57. Business Staff Verification

某些高风险操作：

可能要求：

```text
Staff User KYC
```

不能只靠 Business Verified。

---

# 58. Approval Flow

P1 支持：

```text
Task Draft
↓
Manager Approval
↓
Billing Approval
↓
Commit
```

适合企业。

---

# 59. Approval Policy

推荐：

```text
BusinessApprovalPolicy
```

按：

```text
amount
store
scenario
role
```

配置。

---

# 60. Approval 不能改变统一 Task 主链

批准后仍然：

```text
Task Commit
→ Slot
→ Match
→ Order
```

不是另起企业订单体系。

---

# 61. Budget Control

Business 可设置：

```text
monthly budget
store budget
task budget
manager limit
```

---

# 62. Budget Guard

例如 Task Manager 权限：

```text
can commit <= 5M VND
```

超过：

```text
Approval Required
```

---

# 63. Business Billing Principal

支付属于：

```text
Business
```

不是创建 Task 的员工个人。

---

# 64. Business Spend View

建议：

```text
Today
This Week
This Month

Human Agent Compensation
Platform Fees
Refunds
Promotions
```

---

# 65. Spend by Store

P1：

```text
Store A
Store B
```

分别统计。

---

# 66. Spend by Role

例如：

```text
Greeter
Interpreter
Creator
```

用于 Business 决策。

---

# 67. Human Capacity Analytics

Business 真正需要：

```text
How many slots did we need?
How many filled?
How fast?
How many completed?
```

---

# 68. Business KPI

推荐：

```text
Slot Fill Rate
Median Time to Fill
Arrival Rate
Completion Rate
Replacement Rate
Trusted Fill Rate
Human Agent Spend
```

---

# 69. 不优先 KPI

不把：

```text
Agent Profile Views
Average Profile Time
Likes
Followers
```

作为 Business Workspace 核心 KPI。

---

# 70. Store Human Demand History

Store 可以看到：

```text
Friday Dinner
Greeter demand
Weekend Event
Creator demand
```

用于未来模板和预测。

---

# 71. Demand Forecast

P1：

```text
Based on past tasks,
Saturday events usually need 3 Greeters.
```

只建议：

```text
Create Draft
```

不自动花钱。

---

# 72. Activity → Human Need

未来 Activity：

```text
Store Activity
↓
HumanAgentNeed
↓
Task Draft
```

---

# 73. Campaign → Human Need

未来 Campaign：

```text
Membership Night
Promotion
Social Campaign
```

都可以：

```text
Create Human Agent Task Draft
```

---

# 74. Storefront → Human Need

未来 Storefront 只是需求入口之一。

核心交易仍然：

```text
Task / Slot / Order
```

---

# 75. Merchant OS Boundary

当前 Business Workspace 只做：

```text
Human Operations
```

不做：

```text
Inventory
Accounting
Procurement
Payroll
Full CRM
```

---

# 76. Business Feature Gate

所有新 Business 功能必须回答：

```text
Does it increase:
Demand?
Human Agent work?
Execution?
Repeat?
Revenue?
```

否则：

```text
defer
```

---

# 77. Membership Architecture Reserve

只预留：

```text
BusinessAccount
→ MembershipProgram
→ MerchantCustomerRelation
```

本章不开发完整会员体系。

---

# 78. Storefront Reserve

只预留：

```text
Store
→ Storefront
```

不开发完整 Page Builder。

---

# 79. Business Content

Chapter 06A 支持 Business 发：

```text
Text
Image
Long-form
Video
```

Business Workspace 可有：

```text
Content shortcut
```

但内容不是 Human Operations 主核心。

---

# 80. Content → Task

Business Content 可以：

```text
Need Human Agents
```

进入：

```text
Task Draft
```

---

# 81. Social Bridge

Business 可连接：

```text
social accounts
```

用于：

```text
content publishing
campaign
```

但 Social 密钥 / token 不给普通 Staff。

---

# 82. Social Permission

未来：

```text
SOCIAL_VIEW
SOCIAL_PUBLISH
SOCIAL_MANAGE_CONNECTION
```

分开。

---

# 83. Business Notification Routing

Chapter 14 与 Business Role 联动。

例如：

```text
Payment Failed
→ Billing

Agent Cancelled
→ Task Manager / Operations

Safety Incident
→ Safety Manager
```

---

# 84. Business Inbox

建议：

```text
Action Required
Today
Exceptions
Payments
Safety
Updates
```

---

# 85. Normal Events Aggregate

多人 Task：

```text
5 agents accepted
```

合并：

```text
5/5 filled
```

---

# 86. Exception-first

Business 端重点突出：

```text
Slot Open
Replacement
Late
No-show
Payment Failure
Safety
```

---

# 87. Audit

Business 多人环境必须有：

```text
BusinessAuditLog
```

---

# 88. Audit Event

至少：

```text
member invited
member removed
role changed
task created
task committed
task cancelled
slot changed
agent invited
trusted team changed
payment method changed
refund requested
safety action
```

---

# 89. Actor

每条记录：

```text
business_id
user_id
action
entity
before
after
timestamp
```

---

# 90. Permission Audit

高风险：

```text
billing change
safety view
member permission change
```

必须更详细记录。

---

# 91. Member Removal

员工被移除：

```text
membership → REMOVED
```

必须立即失去 Business 权限。

---

# 92. Active Task Handover

如果被移除员工是：

```text
Task Owner
```

必须：

```text
reassign
```

或进入：

```text
Unassigned Business Task
```

不能让 Task 消失。

---

# 93. Ownership Transfer

Business Owner 转移：

P1：

```text
explicit secure flow
```

不能普通 Role Change 完成。

---

# 94. Business Closure

关闭 Business：

必须处理：

```text
active tasks
open orders
funds
payout/refund
members
retention
```

不能直接 delete。

---

# 95. Business Data Isolation

Business A：

不能看到：

```text
Business B task
trusted team
billing
membership
safety
```

即使同一个 User 同时属于两家公司。

---

# 96. Principal Switch Safety

所有 Business API 必须明确：

```text
business_id
```

并校验当前 User Membership。

不能靠前端当前选中的 Workspace 假定权限。

---

# 97. API

推荐：

```text
GET /businesses/{id}/workspace
GET /businesses/{id}/tasks
GET /businesses/{id}/stores
GET /businesses/{id}/trusted-team
GET /businesses/{id}/members

POST /businesses/{id}/members/invite
PATCH /businesses/{id}/members/{membership_id}
POST /businesses/{id}/stores
POST /businesses/{id}/tasks
```

---

# 98. Dashboard Read Model

推荐：

```json
{
  "today": {
    "required_slots": 12,
    "filled": 10,
    "open": 1,
    "replacement_required": 1,
    "arrived": 5,
    "in_progress": 3
  },
  "action_required": 4,
  "upcoming_tasks": 6
}
```

---

# 99. Business Task Read Model

例如：

```text
Grand Opening

5 Required
4 Filled
1 Open

2 Arrived
2 Upcoming

Budget:
3.5M Agent Compensation
350k Platform Fee
```

权限不足时：

```text
hide billing breakdown
```

---

# 100. Business Team Read Model

```text
Trusted Team

Greeter
8

Interpreter
3

Creator
5
```

不是公开 Agent Directory。

---

# 101. Known Relationship Only

Business Trusted Team 页面只能显示：

```text
已有 Relationship 的 Agent
```

不能借此变成：

```text
全平台搜人后台
```

---

# 102. New Agent Discovery

仍然必须：

```text
Task
→ Matching
→ Candidate Set
```

不能：

```text
Business Browse All Agents
```

---

# 103. Multi-store Analytics

P1：

```text
Store A:
95% fill

Store B:
72% fill
```

帮助发现：

```text
supply gap
```

---

# 104. Role Demand Analytics

例如：

```text
Interpreter
Demand rising
Fill time 18 min
```

可以驱动：

```text
future supply activation
```

---

# 105. Business Repeat Analytics

```text
Repeat Task Rate
Trusted Team Usage
Trusted Team Acceptance
Marketplace Fill Gap
```

---

# 106. Business Economics

```text
Human Agent GMV
Platform Fee
Promotion
Refund
Cost per Successful Slot
```

---

# 107. Cost per Successful Slot

这是很有价值的 B 端指标：

```text
total human ops cost
/
completed slots
```

比：

```text
profile view cost
```

更符合 Proxy。

---

# 108. Human Ops Health

长期可定义：

```text
HUMAN OPS HEALTH
```

由：

```text
Fill
Arrival
Completion
Replacement
Repeat
```

组成。

不一定对用户显示 Numeric Score。

---

# 109. P0 必须实现

```text
BusinessAccount
BusinessMembership
Business Roles
Permission Bundles
Multi-user Workspace
Store
Task Owner
Business Task Templates
Multi-slot Dashboard
Trusted Team
Business Billing View
Safety Role Boundary
Notification Routing
Business Audit
Data Isolation
```

---

# 110. P1

```text
Store-scoped membership permissions
Approval Flow
Budget Approval
Business Credit
Multi-store analytics
Demand forecast
Scheduled digest
Advanced social permission
Ownership transfer
```

---

# 111. Acceptance Criteria

## AC-BIZ-01
BusinessAccount 必须是独立 Principal。

## AC-BIZ-02
Business Task 必须属于 Business，不属于员工个人。

## AC-BIZ-03
User 与 Business 必须通过 BusinessMembership 关联。

## AC-BIZ-04
P0 必须支持 Owner / Admin / Task Manager / Operations / Billing / Safety / Viewer。

## AC-BIZ-05
Role 必须映射 Permission Bundle，而不是硬编码所有权限判断。

## AC-BIZ-06
有效权限必须结合 Role / Scope / Risk。

## AC-BIZ-07
一个 Business 必须支持多个 Store。

## AC-BIZ-08
Store 与 Venue 必须是独立概念。

## AC-BIZ-09
Workspace 必须明确当前 Principal。

## AC-BIZ-10
Business Dashboard 第一核心必须是 Human Slot 状态。

## AC-BIZ-11
Business Dashboard 不得以 Profile Views 为核心。

## AC-BIZ-12
Business 必须支持 Task Template。

## AC-BIZ-13
Template 不得保存旧 Order / Assignment。

## AC-BIZ-14
Multi-slot UI 可以聚合，但底层仍必须原子 Slot。

## AC-BIZ-15
Trusted Team 必须来源于真实成功 Order / Relationship。

## AC-BIZ-16
Trusted Team 不得自动成为 Employment Relationship。

## AC-BIZ-17
Business 不得查看 Trusted Agent 的私人日历和精确位置。

## AC-BIZ-18
Trusted Team Direct Invite 仍需 Eligibility / Availability / Accept。

## AC-BIZ-19
Task Owner 可以转移，但 Task Principal 不改变。

## AC-BIZ-20
不是所有 Business Staff 都能进入所有 Order Chat。

## AC-BIZ-21
Billing 与 Operations 权限必须分离。

## AC-BIZ-22
Safety Detail 与普通 Task View 权限必须分离。

## AC-BIZ-23
Verified Business 不得绕过 Task Admission / Agent Privacy。

## AC-BIZ-24
Budget Approval P1 必须复用统一 Task Commit 主链。

## AC-BIZ-25
Business Billing 必须属于 Business Principal。

## AC-BIZ-26
Human Agent Compensation 与 Platform Fee 必须分别展示给有权限用户。

## AC-BIZ-27
Business Workspace 当前不得扩张为 Inventory / Accounting / Full CRM。

## AC-BIZ-28
Activity / Campaign / Storefront 未来只能产生 Task Draft，不建立旁路订单系统。

## AC-BIZ-29
Business Notification 必须支持 Role-based Routing。

## AC-BIZ-30
多人 Task 正常事件必须聚合，Exception 必须突出。

## AC-BIZ-31
Business 多人操作必须完整 Audit。

## AC-BIZ-32
Member Removal 必须立即撤销 Business Access。

## AC-BIZ-33
员工离职不得删除 Business Task / History。

## AC-BIZ-34
不同 Business 数据必须严格隔离。

## AC-BIZ-35
Business API 必须每次校验 Membership / Permission，不得信任前端 Workspace 状态。

## AC-BIZ-36
Trusted Team 页面不得演变为全平台 Agent Directory。

## AC-BIZ-37
陌生 Agent Discovery 必须继续通过 Task Matching。

## AC-BIZ-38
Business 核心指标必须包含 Fill / Arrival / Completion / Replacement / Repeat / Cost per Successful Slot。

## AC-BIZ-39
Merchant OS 扩展必须继续服务 Human Agent Marketplace 主链。

## AC-BIZ-40
Business Workspace 的最终目标必须是降低真实 Human Operations 的组织成本和履约不确定性。

---

# 112. 本章锁定结论

1. **Business Workspace 是 Human Operations Workspace，不是 ERP。**
2. **Business 是独立 Principal，Task / Trust / Spend / History 都归 Business。**
3. **BusinessMembership + Permission 是多人协作底座。**
4. **Operations、Billing、Safety 权限必须拆开。**
5. **一个 Business 支持多个 Store，Store 与 Venue 分离。**
6. **Business Dashboard 首先看 Slot 有没有补齐、Agent 有没有到场、任务有没有完成。**
7. **Task Template + Trusted Team 是 B 端重复使用的核心。**
8. **Trusted Team 是 Marketplace Relationship，不是员工关系。**
9. **Trusted Team 先填，Marketplace 补缺口，是长期 B 端主循环。**
10. **所有 Business 需求最终仍统一进入 Task / Slot / Order。**
11. **Business 多人环境必须做权限、通知路由、审计和数据隔离。**
12. **Merchant OS 未来可以扩展，但当前 Business Workspace 只优先做能提高 Human Agent 撮合与履约效率的能力。**

---

# 113. 下一章

下一份增量 PRD：

> **Chapter 16 — Merchant Membership / Consumer Relationship / Earn → Spend Loop**

这一章不会做传统 CRM 大全，而只细化最有 Proxy 特色的部分：

```text
Consumer 如何成为 Merchant Member
Member Tier / Points / Benefit 怎么建
Agent Earnings 如何自愿转化为消费
Agent 执行任务后如何进入 Merchant 消费关系
Membership / Activity 如何产生 Human Agent Demand
怎样形成：
Earn → Spend → Merchant Revenue → Human Need → Earn
```

这会正式把你之前强调的“能赚钱，又能会员消费”的长期生命力接入核心架构。

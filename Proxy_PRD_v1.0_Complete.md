# Proxy（分身）完整产品需求文档 PRD v1.0
## 泛场景真人代理（Human Agent）撮合平台

**文档状态**：Prototype-ready / MVP Architecture Locked  
**产品名**：Proxy / 分身  
**Slogan**：不是找个人跑腿，是找对的人出现。  
**核心定位**：泛场景真人代理（Human Agent）撮合平台  
**本版目标**：重建完整产品骨架，覆盖发布方、商家/机构、Agent、匹配、地图、供需、履约、支付、Boost、治理与留存。

---

# 1. 产品定义

Proxy 解决的问题不是“谁离我最近”，而是：

> **这个现实任务，到底需要什么样的人出现？**

平台把现实任务转化成结构化的人才需求，再从真人 Agent 网络中匹配满足条件且当前可执行的人。

Proxy 不是：
- 单一行业平台；
- 纯跑腿平台；
- 招聘平台；
- 陪玩/交友平台；
- “附近的人”产品；
- 纯劳动力市场。

Proxy 是：

> **Task-conditioned Human Matching Marketplace**

核心能力由五层构成：

```text
Industry / Scenario / Role
          ↓
Task Need Profile
          ↓
Agent Capability Passport
          ↓
Availability + Location + Price
          ↓
Eligibility / Ranking / Matching
          ↓
Real-world Execution
          ↓
Outcome Learning
```

---

# 2. 核心价值主张

> **不是找个人跑腿，是找对的人出现。**

与普通跑腿平台相比：

```text
普通跑腿：
距离 + 价格 + 速度

Proxy：
任务场景
+ 角色
+ 能力
+ 背景
+ 属性
+ 时间
+ 地理可达性
+ 可靠性
+ 真实履约结果
```

Proxy 的长期壁垒不是“某一个场景”，而是：

> **结构化真人能力网络 + 跨场景 Agent 复用 + Task × Agent × Outcome 数据。**

---

# 3. 用户角色

## 3.1 Requester — Individual

普通个人发布方。

典型需求：
- 代排队；
- 代办；
- 临时现场协助；
- 翻译；
- 陪同办事；
- 现场查看；
- 临时代表本人出现。

核心诉求：
- 快；
- 可信；
- 合适；
- 不需要自己反复找人。

---

## 3.2 Requester — Business

商家 / 公司 / 门店 / 品牌。

典型需求：
- 开业迎宾；
- 活动人员；
- 临时主持；
- 翻译；
- 内容出镜；
- 商务接待；
- 门店巡检；
- 临时现场代表；
- 多人、多角色 Task。

核心诉求：
- 一次找到多种不同的人；
- 多 Slot；
- 统一预算；
- 统一履约；
- 能复用靠谱团队。

---

## 3.3 Requester — Organization / Agency

机构 / 活动公司 / Agency / 运营公司。

核心诉求：
- 高频发布；
- 多任务管理；
- 多城市；
- 多人协作；
- 批量结算；
- 供应池管理。

MVP 先用 Business Requester 覆盖，P1 再增加组织权限。

---

## 3.4 Human Agent

真人执行方。

不是“普通劳动力”，而是拥有结构化 Capability Passport 的真人供给。

核心诉求：
- 自己的具体能力被正确理解；
- 不需要天天抢单；
- 获得更匹配、更高价值的任务；
- 做得越多，能力资产越强；
- 能通过 Boost 增加曝光；
- 控制自己的隐私与可见性。

---

## 3.5 Operator

平台运营 / 风控 / 客服。

职责：
- Agent / Business KYC；
- Task 内容审核；
- 争议处理；
- 高风险 Requester 管理；
- 特殊订单介入；
- Supply shortage 人工协调；
- 商家支持。

---

# 4. Proxy Capability Graph

这是产品信息架构的中心。

```text
Industry
   ↓
Scenario
   ↓
Role
   ↓
Capability
   ↓
Attribute / Evidence
   ↓
Agent
```

Requester 从上往下：

> 我要什么行业 → 什么场景 → 什么角色 → 什么能力 → 匹配真人。

Agent 从下往上：

> 我有什么能力 → 能胜任什么 Role → 能进入哪些 Scenario / Industry。

Agent 与 Industry / Role 是 **many-to-many**。

---

# 5. Industry / Scenario / Role 初始体系

## 5.1 F&B / Retail

### Grand Opening
- Greeter
- Guest / Crowd
- Interpreter
- Content Talent
- Event Assistant

### Daily Operation
- Queue Proxy
- Store Visit
- Mystery Visit
- Pickup / Purchase

---

## 5.2 Event / Exhibition

### Conference
- Reception
- Event Assistant
- Host / MC
- Interpreter
- Guest Support

### Exhibition
- Booth Greeter
- Interpreter
- Product Assistant
- Crowd / Guest

---

## 5.3 Hospitality / Travel

- Local Guide
- Interpreter
- Airport Assist
- Guest Support
- Local Runner

---

## 5.4 Business / Professional Service

- Business Interpreter
- Industry-background Agent
- Technical Assistant
- Site Visit Representative
- Document Runner
- Meeting Support

涉及法律、医疗、技术等专业背景时：
- 必须显示“背景核验”；
- Proxy 不代替持牌专业服务。

---

## 5.5 Content / Marketing

- Content Talent
- Short-video Actor
- Photographer Assistant
- Store Reviewer
- Brand Event Talent

---

## 5.6 Personal Errand

- Queue
- Pickup
- Appointment
- Document Handling
- Site Visit
- Local Assistance

---

# 6. 核心数据对象

## 6.1 User

```text
user_id
role
kyc_level
requester_trust_tier
risk_status
```

## 6.2 AgentProfile

```text
agent_id
identity
city
base_location
industry_ids[]
role_ids[]
capability_ids[]
attribute_values
portfolio
verification
reliability
visibility_policy
```

## 6.3 CapabilityPassport

```text
agent_id
verified_languages
verified_roles
verified_industries
verified_background
completed_task_types
on_time_rate
completion_rate
repeat_hire_count
evidence_assets
```

## 6.4 Task

```text
task_id
requester_id
industry_id
scenario_id
title
description
location
time_window
budget
status
match_mode
```

## 6.5 TaskSlot

多人任务的最小匹配单位。

```text
slot_id
task_id
role_id
quantity
must_have
nice_to_have
evidence_requirement
budget
status
```

## 6.6 Application / Invite

```text
application_id
slot_id
agent_id
source
status
```

source:
- organic_match
- sponsored_match
- agent_apply
- repeat_invite
- operator_invite

## 6.7 Order

一个 Slot 与一个 Agent 的正式交易关系。

```text
order_id
slot_id
agent_id
payment_status
execution_status
location_grant
```

## 6.8 AvailabilitySession

```text
availability_session_id
agent_id
mode
starts_at
ends_at
origin_cell
max_travel_km
allowed_roles[]
minimum_pay
status
```

## 6.9 LiquidityCell

```text
geo_cell
time_bucket
role_id
qualified_supply
available_supply
scheduled_supply
open_demand
expected_fill_rate
median_response_time
median_pay
```

## 6.10 MatchCandidate

```text
task_id
slot_id
agent_id
eligibility_status
fit_score
visibility_level
sponsored
shown_at
clicked_at
invited_at
```

## 6.11 PaymentLedger

```text
order_id
requester_charge
platform_fee
agent_payout
refund
boost_credit_charge
```

## 6.12 TrustedProxyRelation

只能由成功 Order 产生。

```text
requester_id
agent_id
source_order_id
relationship_score
last_hired_at
```

---

# 7. Requester 端完整信息架构

```text
Requester
├── Home
├── Publish Demand
│   ├── Industry
│   ├── Scenario
│   ├── Role / Slot
│   ├── Task Details
│   ├── Requirements
│   ├── Time
│   ├── Location
│   ├── Budget
│   ├── Evidence
│   └── Supply Preview
├── Matching
│   ├── Fast Match
│   └── Curated Match
├── Active Tasks
├── Messages
├── Trusted Proxies
├── Templates
├── Wallet
└── Profile
```

---

# 8. Requester Home

首页不以 Map 为中心。

核心结构：

```text
Proxy

你今天需要什么样的 Proxy？

[ + 发布需求 ]

行业
F&B / Retail
Event
Travel
Business
Content
Personal Errand

Active Tasks

Trusted Proxies

Around your task
Supply Snapshot / Match ETA

Recent / Repeat Task
```

原则：
- Industry 在第一屏；
- Map 是供给 Snapshot；
- 不展示“附近的人”。

---

# 9. 发布需求完整流程

## Step 1 — Requester Type

首次进入或切换：
- Individual
- Business

Business 可填写：
- Company
- Venue
- Billing info

---

## Step 2 — Industry

例如：
- Event

## Step 3 — Scenario

例如：
- Grand Opening

## Step 4 — Role / Slot

例如：

```text
Greeter ×3
Interpreter ×1
Content Talent ×1
```

生成多个 TaskSlot。

---

## Step 5 — Task Details

- 任务说明；
- Dress code；
- 是否面向客户；
- 是否需要设备；
- 是否需要专业背景。

---

## Step 6 — Time

- Start
- End
- Arrival target
- Flexible range

---

## Step 7 — Location

支持：
- Search;
- Map pin;
- Current location;
- Saved Venue;
- Historical location.

---

## Step 8 — Must-have

硬门槛：
- English Verified
- Full availability
- specific certification
- specific role experience

---

## Step 9 — Nice-to-have

偏好：
- closer;
- more experience;
- particular style;
- repeat experience.

---

## Step 10 — Sensitive Requirement

敏感属性只能在场景确有必要时出现。

必须：
- reason code；
- 任务解释；
- 可审计。

---

## Step 11 — Budget

可按：
- Total Task；
- Per Slot；
- Hourly；
- Fixed.

---

## Step 12 — Completion Evidence

例如：
- GPS check-in；
- 时长；
- Photos；
- Video；
- Check-list；
- Requester confirmation.

---

## Step 13 — Supply Preview

先展示：

```text
5km
9 qualified

8km
17 qualified

Expected Match:
5–10 min
```

不是先展示真人。

---

## Step 14 — Match Mode

### Fast Match

适合：
- Queue；
- Pickup；
- Simple task.

Requester 不选人。

### Curated Match

适合：
- Greeter；
- Interpreter；
- Host；
- Professional / Content.

给有限 Candidate Set。

---

# 10. Fast Match

```text
Task
→ Eligibility
→ Active / Scheduled Supply
→ Offer Batch
→ First Qualified Accept
→ Order
```

界面：

```text
Finding your Proxy...

Search radius: 3km
4 Active Supply
ETA 5–8 min

Expanding...
```

如果失败：

```text
Increase radius
Increase pay
Adjust time
Switch preference
Operator assist
```

---

# 11. Curated Match

每个 Slot 最多首批：
- 6–8 Candidates

最多：
- 3 Batch

排序信息优先级：

```text
Why matched
Availability
Capability
Verification
Reliability
Distance
Price
Identity / Avatar
```

没有无限加载。

---

# 12. Candidate Detail

不是公共 Profile。

结构：

```text
Why matched
Availability
Task-related Capability
Verification
Relevant Experience
Reliability
Relevant Portfolio
Limited Personal Info
Invite
```

访问规则：

```text
candidate ∈ current task candidate set
```

否则 API 拒绝。

---

# 13. Requester Business Dashboard

Business 首页：

```text
Active Tasks
Open Slots
Agents Arriving
Unfilled Slots
Budget Used

Upcoming Events
Repeat Team
Saved Venues
Templates

[+ Publish Demand]
```

核心场景：

```text
Saturday Grand Opening
4 / 5 Slots Filled

Greeter      3/3
Interpreter  1/1
Content      0/1

[Find 1 more]
```

---

# 14. Multi-slot Task

一个 Task 可以包含多个 Role。

示例：

```text
TASK: Store Opening

Slot A:
Greeter ×3

Slot B:
Interpreter ×1

Slot C:
Content Talent ×1
```

每个 Slot 独立：
- Candidate；
- Invite；
- Order；
- Cancel；
- Refund；
- Evidence；
- Rating。

---

# 15. Agent Onboarding

完整路径：

```text
Become a Proxy
→ Identity
→ Location
→ Industries
→ Roles
→ Capabilities
→ Languages
→ Professional Background
→ Attributes
→ Portfolio
→ Verification
→ Pricing
→ Working Area
→ Availability
```

---

# 16. Agent Industry Selection

Agent 可多选：

```text
Event
F&B / Retail
Hospitality
Business
Content
Personal Errand
```

再选择 Role：

```text
Greeter
MC
Interpreter
Event Assistant
Queue Proxy
Content Talent
```

系统根据能力反推可进入的 Scenario。

---

# 17. Capability Passport

展示：

```text
Languages
English Verified
Chinese HSK5

Roles
Greeter · 12 completed
Interpreter · 5 completed

Industries
Event · F&B · Hospitality

Reliability
98% on-time
96% completion

Repeat
4 repeat requesters
```

Agent 做得越多，Passport 越强。

---

# 18. Agent Home

Offline：

```text
Good afternoon, An

OFFLINE

[ 我现在有空 ]

Your Industries
Event · F&B · Hospitality

Demand Near You
Tây Hồ    HIGH
Ba Đình   MEDIUM

Matches for You
5

Upcoming Jobs
2

Boost
English Greeter High Demand

Weekly Earnings
```

Live：

```text
LIVE · 1h 34m

Greeter / Queue
8km
Min 500k

5 Fit Tasks Nearby
First Offer ~6 min

[Pause] [Modify]
```

---

# 19. Availability

## Scheduled Availability

例如：

```text
Sat
17:00–22:00
Tây Hồ / Ba Đình
Event / Greeter
Min 500k
8km
```

支持：
- weekly repeat；
- date exception；
- pause.

## Available Now

点击：

> 我现在有空

配置：
- 30m / 1h / 2h / 4h；
- 3 / 5 / 8 / 15km；
- Roles；
- Min Pay.

P0：
- 不自动接单；
- Notify first.

---

# 20. Demand Map

Agent 看：

```text
Tây Hồ
Demand High
English Greeter
600–750k

Ba Đình
Demand Medium
Event Support
450–650k
```

不看：
- Requester 精确私人地址；
- 谁在发布；
- 竞争 Agent。

---

# 21. Map 产品体系

## 21.1 Requester Supply Map

看：
- 匿名供给热度；
- Qualified Capacity；
- Match ETA；
- Radius。

不看：
- Agent 头像；
- 实时坐标；
- Nearby People。

## 21.2 Agent Demand Map

看：
- Demand Heat；
- Price；
- Role Gap；
- Approximate Area。

## 21.3 Execution Map

Order Confirmed 后才出现：
- Task location；
- ETA；
- Route；
- Check-in；
- 临时 location grant。

---

# 22. Location Visibility

```text
L0 No Task
→ Aggregate Supply

L1 Valid Task
→ Qualified Cell

L2 Candidate
→ Distance / ETA range

L3 Order
→ Arrival ETA

L4 Execution
→ Precise location if required + TTL
```

低供给 1–2 人时：
- 不显示精确数量；
- 只显示 Low Supply。

---

# 23. Agent Offer

挂空闲后收到：

```text
Saturday Event Greeter
Tây Hồ
3.1km
18:00–21:00
650k

Why this fits you
✓ Availability
✓ English
✓ Role experience
✓ Pay > Min

Requester Trust
Verified Business

[Decline]
[Accept]
```

一次只推清晰 Offer。

---

# 24. Boost / Sponsored Exposure

保留为核心盈利能力。

原则：

> **Agent 可以买曝光，不能买资格。**

排序：

```text
Hard Eligibility
→ Safety
→ Availability
→ Task Fit
→ Organic Ranking
→ Sponsored Adjustment
→ Candidate Set
```

形式：

### Time Boost
- 1 day
- 3 days
- 7 days

### Role Boost
- English Greeter
- Interpreter

### Area Boost
- Tây Hồ

### Demand Window Boost
- Sat 18:00–22:00
- English Greeter
- Demand High

Candidate Set：

```text
#1 Organic Best Match
#2 Organic
#3 Sponsored · Qualified
#4 Organic
#5 Organic
#6 Sponsored · Qualified
```

规则：
- Sponsored ≤ 20–30%；
- 明确标记；
- #1 默认保护 Organic Best；
- 不能绕过 Must-have；
- 不能绕过隐私；
- 不能购买敏感属性榜单。

Fast Match：
- 不卖“第一名”；
- 可卖 Priority Offer Access。

---

# 25. 支付

Requester：

```text
Create Task
→ Price Estimate
→ Secure Funds
→ Match
→ Execute
→ Confirm
→ Release
```

平台收入：

```text
Task Commission
+ Sponsored Boost
+ Verification
+ Business Tools
```

P0：
- Escrow；
- Commission；
- Refund；
- Agent payout。

---

# 26. Execution

Order 状态：

```text
CONFIRMED
→ EN_ROUTE
→ ARRIVED
→ IN_PROGRESS
→ EVIDENCE_SUBMITTED
→ REQUESTER_REVIEW
→ COMPLETED
→ PAID
```

异常：
- Agent cancel；
- Requester cancel；
- No-show；
- Late；
- Evidence rejected；
- Dispute。

---

# 27. Replacement Matching

Agent Cancel：

```text
Order Cancelled
→ Keep Task / Slot
→ Search Replacement
→ Candidate / Fast Offer
→ New Order
```

Requester 不重新填 Task。

---

# 28. Chat

Chat 必须绑定 Task / Order。

允许：
- 任务澄清；
- Venue；
- 到场沟通；
- Evidence；
- Platform support.

默认不提前暴露：
- 私人联系方式；
- 社交账号。

---

# 29. Evidence

按场景定义。

支持：
- GPS；
- Photo；
- Video；
- Checklist；
- QR；
- Requester confirmation；
- duration.

Evidence 是：
- Payment trigger；
- Dispute evidence；
- Outcome learning source.

---

# 30. Rating

不只五星。

双向评价：

Requester → Agent：
- On-time；
- Capability match；
- Communication；
- Task completion.

Agent → Requester：
- Task accuracy；
- Safety；
- Respect；
- Payment / coordination.

---

# 31. Trusted Proxy

只能由成功订单产生。

```text
Successful Order
→ Trusted Proxy
→ Invite Again
```

可以：
- Repeat Hire；
- Saved Team；
- Find Similar Proxy.

不允许：
- 陌生 Agent 永久收藏。

---

# 32. Requester Retention

功能：
- Repeat Task；
- Saved Template；
- Saved Venue；
- Trusted Proxy；
- Auto Replacement；
- Business Dashboard；
- Multi-slot.

目标：

> 第二次发布比第一次更快。

---

# 33. Agent Retention

来源：
- Availability 有真实任务；
- Capability Passport；
- Repeat Hire；
- Demand Prediction；
- Boost ROI；
- 收入可预测性。

不是：
- 签到；
- 无限抢单。

---

# 34. Anti-Peeking

内部定义：

> Non-transactional People Browsing

核心原则：

> **No Task, No People Search**

禁止：
- People Feed；
- Nearby People；
- Profile Search without Task；
- Infinite Candidate；
- People Map；
- “Who viewed me”；
- Like / Follow / Fans；
- Beauty / Popularity ranking.

---

# 35. Progressive Disclosure

### L0 Public
- Industry；
- Supply count；
- Price；
- ETA；
- no profile.

### L1 Verified Requester
- Aggregate capacity.

### L2 Valid Task
- limited candidate；
- nickname；
- task-relevant fields.

### L3 Secured Task
- richer portfolio；
- relevant verification.

### L4 Matched
- chat；
- execution info.

### L5 Execution
- necessary location.

---

# 36. Agent Visibility Policy

Agent 可设置：

```text
MATCHED_TASK_ONLY
VERIFIED_REQUESTER_ONLY
BUSINESS_ONLY
PAUSED
```

字段控制：
- photo；
- portfolio；
- height；
- background；
- video；
- audio.

最终返回字段：

```text
Purpose Allowed
∩ Agent Allowed
− Risk Restricted
```

---

# 37. Requester Trust Tier

```text
R0 Unverified
R1 KYC
R2 Successful Orders
R3 Trusted Business
RX Restricted
```

风险行为：
- heavy browsing；
- fake tasks；
- repeated sensitive filter；
- batch abuse；
- cancel abuse；
- scraping.

限制：
- hide sensitive filters；
- anonymize；
- batch limit；
- manual review；
- suspend.

---

# 38. Operator Console

P0：
- KYC queue；
- Task review；
- Report；
- Dispute；
- Payment issue；
- High-risk requester；
- Agent verification；
- Supply shortage assist.

P1：
- Business account；
- City liquidity；
- Boost moderation；
- fraud network.

---

# 39. Monetization

## 39.1 Task Commission
10–20% 初始参考范围。

## 39.2 High-value / Scarce Task Fee
稀缺能力组合可更高服务费。

## 39.3 Agent Boost
核心增值收入。

## 39.4 Verification
专业背景 / Capability 验证。

## 39.5 Business Tools P1
- Team；
- Template；
- Billing；
- Bulk posting；
- analytics.

---

# 40. 核心指标

## Demand
- Qualified Tasks
- Open Slots
- Repeat Requester
- Business Repeat Rate

## Supply
- Available Qualified Capacity
- Weekly Available Agents
- Availability → Offer
- Availability → Order

## Matching
- Fill Rate
- Time to Qualified Match
- Candidate Set → Invite
- Invite → Accept
- Profiles Exposed per Successful Order

## Outcome
- Completion Rate
- On-time
- Dispute
- Repeat Hire
- Match Quality Lift

## Network
- Cross-scene Agent Reuse
- Trusted Proxy Repeat Share
- Multi-industry Agent Reuse

## Monetization
- GMV
- Commission
- Boost Revenue
- Boost ROI
- Sponsored → Order Rate

## Privacy
- Non-task Exposure Rate
- Sensitive Filter Abuse
- Candidate Batch Abuse
- Precise Location TTL Compliance

---

# 41. MVP P0

必须有：

### Global
- Role selection；
- Auth；
- KYC basic.

### Requester
- Home；
- Industry；
- Scenario；
- Role；
- Task Builder；
- Location；
- Budget；
- Evidence；
- Fast / Curated；
- Candidate；
- Checkout；
- Active Task.

### Business
- Business requester；
- Multi-slot；
- Saved Venue；
- Basic dashboard.

### Agent
- Onboarding；
- Industry；
- Capability；
- Profile；
- Availability；
- Available Now；
- Demand Map；
- Offer；
- Boost.

### Execution
- Order；
- Chat；
- Map；
- Evidence；
- Payment；
- Rating；
- Trusted Proxy.

### Governance
- No Task, No People Search；
- Candidate batch；
- Location visibility；
- Report；
- dispute.

---

# 42. P1

- Soft Availability；
- Demand forecast；
- Advanced dynamic pricing；
- Organization accounts；
- Business team roles；
- Bulk orders；
- Advanced portfolio；
- Advanced graph recommendation；
- Multi-city；
- Agency tools；
- Subscription；
- advanced fraud.

---

# 43. MVP 页面清单

## Global
1. Splash
2. Mode Select
3. Auth / KYC

## Requester
4. Requester Home
5. Industry
6. Scenario
7. Role / Slots
8. Task Details
9. Requirements
10. Time
11. Location
12. Budget
13. Evidence
14. Supply Preview
15. Fast Match
16. Curated Candidate
17. Candidate Detail
18. Checkout
19. Active Task

## Business
20. Business Dashboard
21. Multi-slot
22. Trusted Team

## Agent
23. Become Agent
24. Industry Selection
25. Role / Capability
26. Verification
27. Capability Passport
28. Agent Home
29. Available Now
30. Weekly Availability
31. Demand Map
32. Task Offer
33. Boost Center

## Common
34. Chat
35. Execution Map
36. Evidence
37. Payment
38. Rating / Trusted Proxy

## Edge
39. Supply Shortage
40. Anti-peeking
41. Replacement
42. Dispute

---

# 44. 原型 v1.0 必须验证的故事

## Story A — Individual Fast Match
个人发布代排队，不挑人。

## Story B — Business Multi-slot
商家开业一次发布：
- Greeter ×3
- Interpreter ×1
- Content ×1

## Story C — Industry to Human
Requester：
Industry → Scenario → Role → Capability → Candidate.

## Story D — Agent Onboarding
Agent：
Industry → Role → Capability → Verification → Passport.

## Story E — Availability
Agent 挂空闲 2h。

## Story F — Demand Activation
Demand Map → High Demand → Availability / Boost.

## Story G — Sponsored
Qualified Candidate 中出现 Sponsored，但第一名仍是 Organic Best.

## Story H — Execution
Match 后才有精确定位。

## Story I — Repeat
成功后加入 Trusted Proxy，再次邀请。

## Story J — Anti-peeking
无 Task 不能浏览真人。

---

# 45. 产品设计原则

1. Task first, people second.
2. Industry / Scenario / Role 是 Requester 的主入口。
3. Capability 是 Agent 的主入口。
4. Map 是供需与履约工具，不是 People Map。
5. Agent Availability 是供给库存。
6. Candidate 有限、可解释。
7. Sponsored 买曝光，不买资格。
8. 成交后平台继续负责履约。
9. Repeat relationship 只能来自真实订单。
10. 优化成功匹配，不优化浏览时长。
11. 同一 Agent 应跨 Industry / Scenario 复用。
12. Outcome 数据反向优化 Matching。

---

# 46. 最终成功标准

Proxy 不是因为“注册了很多人”成功。

而是当：

> 一个 Requester 说出真实任务，系统可以快速理解这个任务需要什么样的人，在合适的时间和地点找到真实可用的 Agent，以有限曝光完成双向匹配，并最终让任务被可靠完成。

同时：

> 一个 Agent 可以把自己的真实能力变成可积累、可验证、可跨场景复用的 Capability Passport，并持续获得越来越适合自己的任务。

这才是 Proxy。

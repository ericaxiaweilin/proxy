# Proxy PRD v1.1
## Chapter 16 — Merchant Membership / Consumer Relationship / Earn → Spend Loop

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 09 — Pricing / Marketplace Economics
- Chapter 10 — Payment / Settlement
- Chapter 12 — Trusted Proxy / Repeat Relationship
- Chapter 15 — Business Workspace / Multi-store / Human Operations

**本章范围**：
- Consumer Identity
- MerchantCustomerRelation
- Membership Program
- Membership Tier
- Points Ledger
- Benefits
- Coupons / Credits Boundary
- Agent Earnings → Consumer Spend
- Same-person Multi-role
- Merchant Member → Agent Conversion
- Agent → Merchant Member Conversion
- Activity / Membership → Human Agent Demand
- Store / Business Membership Scope
- Merchant Data Isolation
- Consent
- Earn → Spend → Demand Flywheel
- Metrics / Acceptance Criteria

**本章明确不做深**：
- 完整 CRM
- 营销自动化大全
- POS
- 库存
- 会计
- Payroll
- 通用电商订单
- 全渠道会员中台
这些只有在未来明确服务 Human Agent Marketplace 时再扩展。

---

# 1. 本章目标

Proxy 长期不应该只有：

```text
Requester pays
↓
Agent earns
```

还应该形成：

```text
Agent earns
↓
Agent / User consumes
↓
Merchant earns
↓
Merchant creates more activity / demand
↓
More Human Agent Tasks
↓
Agent earns again
```

正式飞轮：

```text
Human Agent Earn
↓
Wallet / Earnings
↓
Consumer Spend
↓
Merchant Revenue
↓
Activity / Membership / Campaign Growth
↓
Human Agent Need
↓
Human Agent Earn
```

---

# 2. 核心产品命题

> **Proxy 的长期生命力，不只是“商家数字化”，而是让人既能赚钱，也能消费，并让消费重新制造真人工作机会。**

---

# 3. 三边网络

Proxy 长期是：

```text
Consumer
↕
Human Agent
↕
Merchant
```

同一个自然人可以同时是：

```text
Consumer
Agent
Business Owner / Staff
```

但这些业务身份必须在数据模型中分离。

---

# 4. Consumer 不单独创建第二账户

Consumer 基于：

```text
UserAccount
```

不需要：

```text
ConsumerAccount
```

新的独立登录体系。

---

# 5. MerchantCustomerRelation

用户与某个 Business 的消费 / 会员关系使用：

```text
MerchantCustomerRelation
```

推荐 Schema：

```text
merchant_customer_relation_id

business_id
user_id

status

membership_program_id optional
membership_tier_id optional

joined_at
last_activity_at

marketing_consent
data_consent_version

created_at
updated_at
```

---

# 6. 为什么不能把会员字段塞进 UserAccount

禁止：

```text
user.membership_level = GOLD
```

因为用户可以同时：

```text
Cafe A = Gold
Restaurant B = Silver
Gym C = Basic
```

会员关系属于：

```text
User ↔ Business
```

而不是 User 全局身份。

---

# 7. Relation Status

推荐：

```text
ACTIVE
PAUSED
ENDED
BLOCKED
```

---

# 8. Merchant 数据隔离

Business A 只能看到：

```text
User 与 Business A 的 MerchantCustomerRelation
```

不能看到：

```text
User 在 Business B 的会员等级
积分
消费历史
优惠券
```

---

# 9. Store 与 Business Membership Scope

P0 建议：

> Membership Program 默认属于 Business。

这样：

```text
Business
→ Multiple Stores
→ Shared Membership Program
```

例如：

```text
Coffee Group A
Gold Member
```

可在：

```text
Tây Hồ Store
Cầu Giấy Store
```

通用。

---

# 10. Store-specific Program

P1 支持：

```text
store-specific program
```

但不要 P0 就制造复杂层级。

---

# 11. MembershipProgram

推荐对象：

```text
MembershipProgram
```

Schema：

```text
membership_program_id
business_id

name
description

status
join_policy

points_policy_id optional

created_at
updated_at
```

---

# 12. Program Status

```text
DRAFT
ACTIVE
PAUSED
ENDED
```

---

# 13. Join Policy

P0 支持：

```text
OPEN
INVITE_ONLY
PURCHASE_REQUIRED
```

未来：

```text
ACTIVITY_REQUIRED
```

---

# 14. MembershipTier

推荐对象：

```text
MembershipTier
```

Schema：

```text
tier_id
membership_program_id

name
rank

qualification_rule
benefits[]

status
```

---

# 15. 示例 Tier

```text
Member
Silver
Gold
VIP
```

但名称由 Merchant 自定义。

---

# 16. Tier 不是社会身份

Membership Tier 只表示：

```text
该 Merchant 的客户关系等级
```

不能参与：

```text
Human Agent Capability
Agent Reliability
Global Ranking
```

---

# 17. Tier Qualification

可以基于：

```text
spend
visits
points
activity participation
manual invite
```

具体规则配置化。

---

# 18. Points

积分必须使用：

```text
PointsLedger
```

不能只：

```text
points_balance = 1200
```

然后直接改值。

---

# 19. PointsLedger

Schema：

```text
points_ledger_entry_id

business_id
user_id
membership_program_id

entry_type
points_delta

source_type
source_id optional

expires_at optional

created_at
```

---

# 20. Points Entry Type

例如：

```text
EARN_PURCHASE
EARN_ACTIVITY
EARN_PROMOTION
REDEEM
EXPIRE
ADJUST
REVERSAL
```

---

# 21. Points ≠ Money

正式硬规则：

> **Membership Points 不是 Agent Earnings，不是现金，不是可提现余额。**

---

# 22. Agent Earnings ≠ Membership Points ≠ Proxy Credits

三者严格分开：

```text
Agent Earnings
= withdrawable real money

Membership Points
= merchant-scoped loyalty benefit

Proxy Credits
= platform promotion / internal benefit
```

---

# 23. 绝对禁止工资积分化

禁止：

```text
Agent should earn 600k
↓
平台发 600k points
```

代替现金收入。

---

# 24. Agent Earnings 的默认权利

Agent 完成真实 Order 后：

```text
Agent Earnings
```

必须可以：

```text
withdraw
```

除合法 / 风险 Hold 外。

---

# 25. Earn → Spend 必须自愿

Agent 可以选择：

```text
Withdraw
```

也可以未来选择：

```text
Spend at Merchant
```

但必须是：

> **Agent 主动选择。**

---

# 26. Agent Spend

未来若支持：

```text
Pay with Proxy balance
```

本质是：

```text
Agent Earnings Ledger
→ voluntary wallet debit
→ Merchant Payment
```

不是：

```text
自动转换积分
```

---

# 27. Spend 不降低历史 Earnings

例如 Agent：

```text
earned 1,000,000
spent 300,000
```

历史仍然是：

```text
Total Earnings = 1,000,000
```

只是 Wallet：

```text
Available = 700,000
```

---

# 28. Consumer Payment 与 Human Agent Order 分离

未来 Merchant 消费交易可以有独立：

```text
MerchantTransaction
```

但不能：

```text
复用 Human Agent Order
```

因为：

```text
Human Agent Order
= 真人履约关系

Merchant Transaction
= 消费关系
```

---

# 29. P0 不要求完整 Merchant Checkout

当前只做架构预留。

如果未来需要：

```text
Reservation
Activity Ticket
Membership Purchase
Merchant Checkout
```

再建立 Merchant Transaction Domain。

---

# 30. Benefit

Membership Benefit 推荐对象：

```text
MembershipBenefit
```

例如：

```text
Discount
Free item
Activity access
Priority reservation
Member-only event
Proxy service fee discount
```

---

# 31. Benefit 不得压低 Agent Earnings

例如 Gold Member 获得：

```text
10% Proxy Service Fee discount
```

可以减少：

```text
Requester Service Fee
```

但不能偷偷减少：

```text
Agent agreed earnings
```

---

# 32. Merchant-funded Benefit

Merchant 也可以：

```text
subsidize requester fee
```

从 Merchant Promotion Budget 支出。

---

# 33. Agent Member Benefit

这是 Proxy 很有特色的一点。

Agent 可以同时是 Merchant Member。

例如：

```text
完成 Cafe A 的任务
↓
Agent 自愿加入 Cafe A Member
↓
以后自己消费获得员工式/合作伙伴式优惠
```

但这不是雇佣关系。

---

# 34. Partner Benefit

未来可支持：

```text
Agent Partner Benefit
```

例如：

```text
Completed 3 tasks for this Business
→ Eligible for 10% cafe discount
```

前提：

```text
Merchant explicitly offers
Agent voluntarily joins
```

---

# 35. Partner Benefit ≠ Wage

商家优惠：

```text
can be extra benefit
```

不能代替：

```text
cash compensation
```

---

# 36. Consumer → Agent Conversion

普通 Consumer 可以看到：

```text
Become a Proxy
```

但不能自动成为供给。

流程：

```text
Consumer
↓
Become a Proxy
↓
Agent Onboarding
↓
Capability Passport
↓
Role Activation
↓
Availability
```

---

# 37. Merchant Member → Agent Conversion

Merchant Member：

```text
Gold Member
```

不代表：

```text
qualified Agent
```

只能通过明确 CTA：

```text
Earn with Proxy
```

进入 Agent Onboarding。

---

# 38. 不允许 Merchant 自动招募会员成为 Agent

禁止：

```text
all members automatically available for work
```

用户必须：

```text
opt in
```

---

# 39. Agent → Consumer Conversion

Agent 完成任务后，可以看到：

```text
Explore this venue
Join membership
Use merchant benefit
```

但必须：

```text
non-coercive
```

---

# 40. Agent 执行现场不自动变成 Member

完成：

```text
Cafe Task
```

不能自动：

```text
join Cafe Membership
```

必须用户同意。

---

# 41. MerchantCustomerRelation 来源

可以来自：

```text
DIRECT_JOIN
PURCHASE
RESERVATION
ACTIVITY
AGENT_OPT_IN
CAMPAIGN
```

---

# 42. Consumer Consent

Membership 加入至少需要：

```text
program terms
data use
marketing preference
```

---

# 43. Marketing Consent 分离

加入会员：

```text
does not automatically equal
marketing consent
```

必须：

```text
separate preference
```

---

# 44. Merchant Member Profile

Merchant 可以看到与自己关系相关：

```text
member tier
points
visits
activity
merchant transaction
preferences if consented
```

不能因此看到：

```text
Agent earnings
other merchant relationships
private AgentProfile
```

---

# 45. Same Person, Different Context

同一个 User：

```text
Consumer Mode
Agent Mode
Business Mode
```

数据访问必须按当前业务 Purpose。

---

# 46. Agent Earnings Privacy

Merchant 即使：

```text
这个 Agent 也是自己的 Member
```

也不能看到：

```text
Agent 在全平台赚了多少钱
```

---

# 47. Agent Execution Outcome Privacy

Merchant 只能看到：

```text
自己 Task 中的履约
```

不能因为会员关系看到 Agent 其他 Business 的订单。

---

# 48. Membership Activity

Merchant 可以创建：

```text
Member Night
VIP Tasting
Workshop
Meetup
```

这些是：

```text
Activity
```

---

# 49. Activity → Human Agent Need

例如：

```text
VIP Member Night
```

需要：

```text
Greeter ×2
Interpreter ×1
Photographer ×1
```

主链：

```text
Membership Activity
↓
HumanAgentNeed
↓
Task Draft
↓
Task
↓
Slots
↓
Matching
```

---

# 50. Membership 不直接创建 Order

正式硬规则：

> Membership / Activity / Campaign 只能生成 Human Agent Need / Task Draft。

不能：

```text
Membership module
→ directly assign Agent
```

---

# 51. Membership Campaign → Human Demand

例如：

```text
100 new Gold members
↓
Member launch event
↓
Need 3 event Agents
```

这才是 Merchant OS 与 Human Agent Marketplace 的正确连接。

---

# 52. Consumption Growth → Human Demand

长期可以发现：

```text
reservations increasing
activity signups increasing
store footfall increasing
```

系统提示：

```text
Human capacity may be insufficient.
Create Agent Task?
```

---

# 53. P0 只 Suggest

不得：

```text
auto create paid task
auto spend merchant money
```

---

# 54. Earn → Spend → Earn 示例

完整示例：

```text
Agent An
↓
完成 Event Greeter Task
↓
Earn 700k
↓
自愿使用 150k 在合作 Cafe 消费
↓
Cafe Revenue +
↓
加入 Weekend Member Event
↓
Event demand rises
↓
Cafe creates Greeter ×2
↓
New Agents earn
```

---

# 55. 这不是闭环积分游戏

平台要形成的是：

```text
real money
real consumption
real merchant revenue
real human jobs
```

而不是：

```text
虚拟币内部循环
```

---

# 56. Consumer Content Connection

Chapter 06A 内容层：

```text
Post
Video
Long-form
```

可以连接：

```text
Join Membership
Join Activity
Visit Store
Need a Proxy
```

---

# 57. Merchant Content → Membership

例如：

```text
Cafe new menu post
↓
Join Member
```

---

# 58. Merchant Content → Agent Work

例如：

```text
Grand Opening post
↓
Need Human Agents
```

---

# 59. Membership → Content

会员活动结束：

```text
Activity Recap Content
```

可以继续产生：

```text
more consumer interest
```

---

# 60. Relationship Graph

长期：

```text
User
↔ MerchantCustomerRelation
↔ Business
↔ Store
↔ Activity
↔ HumanAgentNeed
↔ Task
↔ Agent
```

这是 Proxy Local Economy 的核心关系图。

---

# 61. Points Earn

P0 可支持简单规则：

```text
Purchase
Activity
Promotion
```

---

# 62. Points Redemption

P0 若做：

```text
Benefit redemption
```

必须写：

```text
PointsLedger -delta
```

---

# 63. Points Expiry

可配置：

```text
expires_at
```

但必须对 Member 清晰展示。

---

# 64. No Silent Expiry

积分到期规则必须：

```text
visible
```

不能后台悄悄失效。

---

# 65. Coupon

未来可有：

```text
Coupon
```

独立于 Points。

---

# 66. Coupon Scope

例如：

```text
Store
Business
Activity
Membership Tier
```

---

# 67. Proxy Service Fee Coupon

Merchant / Platform 可以发：

```text
Proxy Service Fee Coupon
```

用于 Requester 侧。

仍然：

```text
Agent Earnings unchanged
```

---

# 68. Agent Benefit Coupon

Agent 也可自愿领取：

```text
Merchant discount
```

但：

```text
not wage
```

---

# 69. Merchant Promotion Budget

推荐未来：

```text
MerchantPromotionLedger
```

用于：

```text
membership subsidy
coupon
activity subsidy
Proxy service fee subsidy
```

---

# 70. 会员身份不能成为 Human Agent Eligibility

例如：

```text
VIP member
```

不意味着：

```text
eligible greeter
```

Agent Eligibility 仍来自：

```text
Capability
Role
Verification
Availability
```

---

# 71. 消费金额不能成为通用 Agent Ranking

例如：

```text
high spender
```

不能因此：

```text
rank higher as Agent
```

---

# 72. Agent 收入不能成为 Consumer 优待的隐性强迫

Merchant 可以自愿设计：

```text
Partner Benefits
```

但平台不能：

```text
earn more → must spend more
```

---

# 73. Cross-side Conversion 必须用户主动

任何：

```text
Consumer → Agent
Agent → Member
Member → Agent
Business Staff → Agent
```

都必须：

```text
explicit opt-in
```

---

# 74. Business Staff → Consumer

Business Staff 本人也可以正常消费。

但：

```text
Staff Membership
```

与：

```text
BusinessMembership
```

必须分开。

---

# 75. Business Owner → Agent

理论上允许。

但同一交易不能出现明显冲突：

例如：

```text
Business Principal
```

不能把自己的 Agent Identity 用来接自己发的同一 Slot，

除非未来明确允许特殊测试场景。

P0 直接：

```text
self-dealing blocked
```

---

# 76. Self-dealing Guard

Matching 必须检查：

```text
Agent user
!=
Requester individual principal
```

以及：

```text
conflict-of-interest policy
```

---

# 77. Merchant Member Block

如果 Consumer 被某 Merchant：

```text
membership blocked
```

不代表：

```text
global Proxy account blocked
```

---

# 78. Agent Risk 与 Membership 分离

Agent 被：

```text
Marketplace Risk Restricted
```

不一定自动删除：

```text
合法 Consumer Membership
```

除非安全事件涉及该 Merchant。

---

# 79. Merchant Risk 与 Member Data

Business 被 Suspended：

需要：

```text
restrict merchant operations
```

但 Member 数据仍按 retention / access policy 管理。

---

# 80. Data Minimization

Membership 不应该为了“以后可能有用”无限收集：

```text
occupation
income
family
private social
```

除非明确业务需要和同意。

---

# 81. Merchant Tags

P1 可支持：

```text
member tags
```

但尽量使用：

```text
transaction / activity behavior
```

而不是敏感人格标签。

---

# 82. Sensitive Segmentation

禁止默认按：

```text
race
religion
politics
sexual orientation
```

做会员营销分组。

---

# 83. MerchantCustomerRelation API

推荐：

```text
POST /businesses/{id}/membership/join
GET /me/merchant-relations
GET /businesses/{id}/members/{relation_id}
POST /businesses/{id}/members/{relation_id}/end
```

---

# 84. Membership API

```text
POST /businesses/{id}/membership-programs
POST /membership-programs/{id}/tiers
GET /membership-programs/{id}
```

---

# 85. Points API

```text
POST /points/earn
POST /points/redeem
GET /me/businesses/{business_id}/points-ledger
```

任何余额更新都走 Ledger Command。

---

# 86. Cross-side Conversion API

```text
POST /me/become-agent
POST /businesses/{id}/membership/join
```

不能通过后台直接偷偷创建 AgentProfile。

---

# 87. Membership → Task API

未来：

```text
POST /activities/{id}/create-agent-need
POST /campaigns/{id}/create-agent-need
```

最终结果：

```text
Task Draft
```

---

# 88. Business Workspace Integration

Chapter 15 Business Workspace 增加未来模块入口：

```text
Human Operations
Members
Activities
Content
```

但首页仍优先：

```text
Human Operations
```

---

# 89. Agent Home Integration

Agent Home 可以未来展示：

```text
Earnings
Available Now
Upcoming
Merchant Benefits
```

但：

```text
Benefits
```

不能压过：

```text
Earnings / Offers
```

---

# 90. Consumer Home

长期可支持：

```text
Nearby Places
Activities
Memberships
Content
Need a Proxy
```

---

# 91. 一个 App，多种模式

推荐：

```text
Requester / Consumer Mode
Agent Mode
Business Workspace
```

不是拆三个账户系统。

---

# 92. Earn → Spend Conversion Metric

平台可以观察：

```text
Agent Earnings
→ Merchant Spend
```

但必须使用：

```text
aggregate
```

保护 Agent 财务隐私。

---

# 93. Merchant 不看 Agent 个人 Earn → Spend Ratio

例如 Business 不应看到：

```text
An earned 8M and spent only 100k
```

这种跨域个人财务信息。

---

# 94. Marketplace Metrics

L0：

```text
Successful Human Executions
```

继续保持。

---

# 95. Agent Metrics

```text
Agent Earnings
Earnings per Available Hour
Withdraw Rate
Voluntary Merchant Spend Rate
```

---

# 96. Consumer Metrics

```text
Membership Join
Repeat Spend
Activity Join
Content-assisted Real-world Transaction
```

---

# 97. Merchant Metrics

```text
Member Revenue
Repeat Consumption
Activity Participation
Human Agent Demand
Human Agent GMV
```

---

# 98. Flywheel Metrics

建议：

```text
Earn → Spend Conversion
Spend → Repeat Merchant Visit
Merchant Activity → Human Agent Need
Human Agent Need → Completed Orders
```

---

# 99. Merchant Feature Gate

任何新会员 / 商家功能必须至少提高一个：

```text
Consumer Demand
Merchant Revenue
Human Agent Work
Repeat Transaction
Cross-side Network Effect
```

否则：

```text
defer
```

---

# 100. 不做纯运营工具堆积

例如：

```text
库存管理
员工工资
采购
会计
```

如果不能明显连接：

```text
Demand
Human Agent Work
Repeat
Revenue
```

则不进入 Proxy 当前主线。

---

# 101. P0 建议

当前架构 P0 可实现：

```text
MerchantCustomerRelation
Basic MembershipProgram
Basic Tier
PointsLedger
Basic Benefit
Business-wide membership
Explicit Join / Leave
Marketing Consent separation
Agent / Consumer same-account support
Earn / Points / Credits accounting separation
Membership / Activity → Task Draft hook
Data isolation
Audit
```

---

# 102. P1

```text
Coupons
Partner Benefits
Member Activities
Reservation integration
Merchant promotion budget
Voluntary earnings wallet spend
Advanced tier rules
Store-specific programs
Member tags
```

---

# 103. P2

```text
Merchant checkout
Advanced campaign automation
Cross-merchant platform benefits
Membership marketplace
Advanced local economy wallet
```

但只有数据证明值得再做。

---

# 104. Acceptance Criteria

## AC-MEMBER-01
Consumer 必须复用 UserAccount，不创建第二套登录身份。

## AC-MEMBER-02
Merchant 会员关系必须使用 User ↔ Business 独立关系对象。

## AC-MEMBER-03
会员等级不得存入 UserAccount 全局字段。

## AC-MEMBER-04
不同 Business 的 Member Data 必须隔离。

## AC-MEMBER-05
P0 Membership Program 默认 Business-wide。

## AC-MEMBER-06
Membership Tier 不得影响 Human Agent Capability / Reliability。

## AC-MEMBER-07
Points 必须使用 Ledger。

## AC-MEMBER-08
Membership Points 不得被定义为可提现 Agent Earnings。

## AC-MEMBER-09
Agent Earnings、Membership Points、Proxy Credits 必须严格分离。

## AC-MEMBER-10
不得使用 Points / Coupon 替代真人劳动现金 Compensation。

## AC-MEMBER-11
Agent Earnings 必须保留 Withdraw 权利。

## AC-MEMBER-12
Agent Earnings → Spend 必须用户主动选择。

## AC-MEMBER-13
历史 Earnings 不得因消费被重写。

## AC-MEMBER-14
Human Agent Order 与 Merchant Consumer Transaction 必须是独立 Domain。

## AC-MEMBER-15
Member Benefit 不得偷偷降低 Agent Earnings。

## AC-MEMBER-16
Merchant Service Fee Discount 可以存在，但 Agent Earnings 不变。

## AC-MEMBER-17
Agent 可以成为 Merchant Member，但必须显式 opt-in。

## AC-MEMBER-18
Merchant Member 不得自动成为 Agent。

## AC-MEMBER-19
Consumer → Agent 必须经过完整 Agent Onboarding。

## AC-MEMBER-20
Agent 执行 Merchant Task 后不得自动加入 Membership。

## AC-MEMBER-21
Membership Join 与 Marketing Consent 必须分离。

## AC-MEMBER-22
Merchant 不得因为 Member Relationship 读取 Agent 全平台 Earnings。

## AC-MEMBER-23
Merchant 不得因为会员关系读取 Agent 其他 Business 的订单。

## AC-MEMBER-24
Membership / Activity / Campaign 只能创建 HumanAgentNeed / Task Draft，不得旁路创建 Order。

## AC-MEMBER-25
系统不得自动替 Merchant 创建付费 Human Agent Task。

## AC-MEMBER-26
会员消费金额不得成为 Human Agent Ranking Signal。

## AC-MEMBER-27
任何 Consumer / Agent / Member 跨身份转换必须显式 opt-in。

## AC-MEMBER-28
Business Staff Relationship 与 Consumer Membership 必须分离。

## AC-MEMBER-29
P0 必须防止明显 Self-dealing 同一用户自发 Task 自接 Slot。

## AC-MEMBER-30
Merchant-specific Member Block 不得自动成为 Global Proxy Block。

## AC-MEMBER-31
Membership 数据收集必须遵守 Data Minimization。

## AC-MEMBER-32
敏感属性不得默认用于 Merchant Segmentation。

## AC-MEMBER-33
Merchant Feature 必须通过 Demand / Revenue / Human Work / Repeat / Network Effect Gate。

## AC-MEMBER-34
Proxy 不得因为 Merchant OS 扩展而偏离 Human Agent Marketplace Core。

## AC-MEMBER-35
本章最终目标必须是形成 Real Money → Real Consumption → Merchant Revenue → Human Agent Demand 的正循环。

---

# 105. 本章锁定结论

1. **Proxy 长期不是单纯用工平台，也不是单纯会员消费平台，而是 Consumer × Human Agent × Merchant 三边网络。**
2. **同一个人可以消费、赚钱、经营商家，但数据身份和权限必须分离。**
3. **MerchantCustomerRelation 是 User ↔ Business 会员关系真相。**
4. **会员等级属于 Merchant，不属于 User 全局。**
5. **Agent Earnings、Membership Points、Proxy Credits 永远不能混账。**
6. **真人劳动收入必须是可提现真钱，不能被平台币替代。**
7. **Earn → Spend 只能由 Agent 自愿发生。**
8. **Agent 可以成为 Merchant Member，Member 也可以主动 Become a Proxy。**
9. **所有跨身份转换必须显式 Opt-in。**
10. **Membership / Activity / Campaign 的核心价值之一，是形成新的 Human Agent Demand。**
11. **Merchant 消费增长应该能够回流成更多真人工作机会。**
12. **Proxy 要形成的是 Real Earnings → Real Spend → Real Merchant Revenue → Real Human Jobs，而不是虚拟积分自循环。**
13. **Merchant OS 功能只有在提高 Demand / Revenue / Human Work / Repeat / Network Effect 时才值得做。**

---

# 106. 下一章

下一份增量 PRD 建议回到 Marketplace 主线：

> **Chapter 17 — Map / Location / Supply Heat / Execution Geography**

重点解决：

```text
Requester 地图到底看到什么
Agent 地图到底看到什么
Supply Heat 怎么画
Demand Heat 怎么画
Approx Area / ETA / Radius 怎么表达
为什么永远不能显示 Nearby People
Matched 后什么时候开放精确地点
Execution Map 怎么做
Store / Venue / Activity 怎么和地图连接
```

这一章会把之前已经锁过的 Map 原则正式细化成可开发的页面、状态和数据模型。

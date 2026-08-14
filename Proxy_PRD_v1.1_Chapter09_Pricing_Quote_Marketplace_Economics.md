# Proxy PRD v1.1
## Chapter 09 — Pricing / Quote / Budget / Marketplace Economics

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 04 — Requester Demand Builder
- Chapter 05 — Matching Engine
- Chapter 06 — Fast Match / Offer Engine
- Chapter 07 — Agent Capability Passport
- Chapter 08 — Availability / Supply Capacity

**本章范围**：
- Requester Budget
- Agent Earnings
- Requester Charge
- Compensation Terms
- Fixed / Hourly
- Minimum Duration
- Travel / Urgent / Overtime
- Multi-slot Pricing
- Price Guidance
- Price Floor
- Agent Min Pay
- Quote Mode
- Platform Fee
- Sponsored / Boost accounting boundary
- Anti-race-to-bottom
- Price transparency
- Marketplace economics
- Pricing audit / versioning

**本章不细化**：
- Escrow rail
- Card / bank payment provider
- Refund execution
- Tax calculation
- Invoice issuance
这些放到 Payment / Settlement 章节。

---

# 1. 本章目标

Proxy 的 Pricing System 必须同时满足三个目标：

```text
Requester
→ 愿意付、看得懂、能成交

Human Agent
→ 收入清晰、有最低边界、不会被公开压价

Proxy
→ 交易能够产生可持续收入
```

不能优化成：

```text
谁出价最低谁接单
```

---

# 2. 三个金额必须严格分离

正式定义：

## 2.1 Requester Budget

Requester 对该 TaskSlot 愿意支付的业务预算。

```text
budget
```

---

## 2.2 Agent Earnings

Agent 完成该 Order 后应获得的真人劳动收入。

```text
agent_earnings
```

---

## 2.3 Requester Charge

Requester 实际需要支付给平台的总金额。

```text
requester_charge
```

关系可能是：

```text
Requester Charge
=
Agent Earnings
+
Platform Service Fee
+
Approved Add-ons
+
Taxes / statutory charges if applicable
```

---

# 3. 不允许一个 price 字段解决全部问题

禁止：

```text
price = 700000
```

因为无法知道：

```text
这是 Requester 预算？
Agent 到手？
平台收费前？
含交通？
含税？
含加时？
```

必须使用结构化 Pricing。

---

# 4. CompensationTerms

每一个 TaskSlot 必须有：

```text
CompensationTerms
```

推荐 Schema：

```text
compensation_terms_id
task_id
slot_id

pricing_mode
currency

base_amount
hourly_rate optional
minimum_billable_duration optional
included_duration optional

travel_policy
urgent_policy
overtime_policy

requester_budget_cap optional

platform_fee_policy_id

pricing_version
created_at
updated_at
```

---

# 5. P0 Pricing Mode

P0 建议只支持两种核心模式：

```text
FIXED
HOURLY
```

避免初期价格结构过于复杂。

---

# 6. FIXED

适合：

```text
Queue Proxy
Pickup
Simple Store Visit
3-hour Greeter Shift
Event Support
```

例如：

```text
Greeter
18:00–21:00

Fixed Earnings:
600,000 VND
```

---

# 7. HOURLY

适合：

```text
Interpreter
Event Assistant
Long on-site support
Variable-duration task
```

例如：

```text
250,000 VND / hour
Minimum 2 hours
```

---

# 8. P1 Pricing Mode

未来可扩展：

```text
PER_DELIVERABLE
HALF_DAY
FULL_DAY
CUSTOM_QUOTE
```

特别适合：

```text
Creator
Professional
Photography
Complex business assignment
```

---

# 9. Minimum Duration

Hourly Task 必须支持：

```text
minimum_billable_duration
```

例如：

```text
250k / hour
minimum 2 hours
```

即使实际只工作：

```text
1h20m
```

基础收入仍按：

```text
2h
```

计算。

---

# 10. 为什么需要 Minimum Duration

真人出门执行任务有：

```text
准备时间
交通时间
机会成本
```

如果平台允许：

```text
15 分钟任务
只付 15 分钟钱
```

会严重破坏供给体验。

---

# 11. Time Rounding

P0 推荐明确：

```text
billing increment
```

例如：

```text
30 min
```

而不是精确到秒。

具体按 Market / Role 配置。

---

# 12. Agent Rate Preference

Agent Passport 可以保存：

```text
Default Rate
Role-specific Rate
Min Pay
```

Availability Session 可以临时覆盖：

```text
Today's Min Pay
```

---

# 13. Requester Offer 与 Agent Floor

例如：

```text
Task offered earnings:
500k

Agent min pay:
600k
```

则：

```text
INELIGIBLE
```

不是：

```text
低分候选
```

---

# 14. Price Fit

当：

```text
Task pay >= Agent min pay
```

才进入 Qualified Pool。

之后：

```text
price fit
```

可以影响 Acceptance Probability / Ranking。

---

# 15. Marketplace Price Guidance

Demand Builder 应提供：

```text
Reference Range
```

例如：

```text
Typical for this task:
550k–750k
```

不是强制价格。

---

# 16. Price Guidance Context

参考价必须至少考虑：

```text
Role
Geo
Time
Duration
Urgency
Verification Requirement
Recent Supply
Recent Fill Outcome
```

---

# 17. 不允许使用无关敏感属性定价

例如：

```text
Gender
Ethnicity
Religion
Appearance
```

不得成为通用价格公式变量。

如果某场景存在合法特殊 Requirement：

仍然由：

```text
Task Policy
```

决定资格，不建立敏感属性价格市场。

---

# 18. Reference Range ≠ Guaranteed Market Price

UI 必须明确：

```text
Estimated market range
```

不是：

```text
Guaranteed rate
```

---

# 19. Price Guidance Data Quality

参考价必须记录：

```text
sample size
freshness
market
role
time window
```

数据不足：

显示：

```text
Limited pricing data
```

而不是编一个精确数字。

---

# 20. Price Floor

平台必须支持：

```text
Minimum Compensation Floor
```

来源可能：

```text
Legal minimum
Platform safety floor
Role-specific minimum
Minimum call-out fee
```

---

# 21. Floor Rule

最终最低允许支付：

```text
effective_floor
=
max(
  legal_floor,
  platform_floor,
  role_floor,
  callout_floor
)
```

具体法律数值按市场配置，不硬编码在通用产品层。

---

# 22. Below Floor

Requester 如果输入：

```text
below effective floor
```

则：

```text
Cannot Commit
```

并解释：

```text
Minimum allowed compensation for this task is X.
```

---

# 23. 不做公开竞价大厅

P0 正式禁止：

```text
Requester posts 700k
Agent A: 650k
Agent B: 600k
Agent C: 450k
```

这种公开反向竞价。

原因：

```text
race to bottom
low-quality supply
agent dissatisfaction
unsafe labor behavior
bad brand
```

---

# 24. Agent 不需要公开互相看到报价

Agent 只能看到：

```text
当前 Task 给我的 Compensation Terms
```

不看到：

```text
其他 Agent 报价
```

---

# 25. Requester 也不应该以“最低价排序真人”

Candidate 排序不允许默认：

```text
Cheapest First
```

价格只是 Fit Signal。

---

# 26. Price Recommendation

如果当前预算导致：

```text
Supply = CRITICAL
```

系统可以提示：

```text
Increase to 650k
Estimated available supply:
6 → 12
```

这属于：

```text
Demand Shaping
```

---

# 27. 自动涨价边界

P0：

> 不自动替 Requester 提价。

只能：

```text
Suggest
```

Requester 明确确认后才改 Task Compensation。

---

# 28. Fast Match Budget Cap

未来 Fast Match 可以允许：

```text
Pay up to 700k if needed
```

结构：

```text
base_offer = 600k
max_authorized = 700k
```

系统可以在明确政策内提高 Offer。

P0 可以先不启用自动阶梯涨价。

---

# 29. Urgent Premium

紧急任务可以：

```text
Urgent Premium
```

例如：

```text
starts in < 60 min
replacement task
```

但必须：

```text
Requester sees amount
Agent sees amount
```

---

# 30. Urgent Premium 不等于隐藏 Surge

禁止：

```text
用户不知道为什么突然贵了
```

必须显示：

```text
Base Earnings
Urgent Premium
```

---

# 31. Travel Policy

P0 支持：

```text
TRAVEL_INCLUDED
TRAVEL_FIXED_ALLOWANCE
```

未来：

```text
DISTANCE_BASED
REIMBURSEMENT
```

---

# 32. Travel Allowance

例如：

```text
Agent Earnings
600k

Travel allowance
100k
```

必须单列。

---

# 33. Travel Allowance 与 Location Privacy

Requester 可以知道：

```text
allowance
distance band
```

不需要看到 Agent 家地址。

---

# 34. Transport Support

Business Task 可以提供：

```text
Taxi reimbursed
Shuttle provided
Parking included
```

作为 Compensation Context。

---

# 35. Night / Holiday Premium

未来可按 Market 配置：

```text
NIGHT
HOLIDAY
WEEKEND
```

但不得在核心代码硬编码。

---

# 36. Equipment Allowance

如果任务需要 Agent 自带：

```text
Camera
Laptop
Vehicle
Audio Equipment
```

可以有：

```text
equipment_allowance
```

---

# 37. Expense Reimbursement

P1：

```text
approved expense
receipt
cap
```

与 Agent Labor Earnings 分离。

---

# 38. Overtime

真人任务经常超时。

必须支持：

```text
Order Extension
```

---

# 39. Overtime Rule

默认：

```text
No silent overtime
```

如果 Requester 希望延长：

```text
Request Extension
↓
Agent sees new end time + earnings
↓
Agent accepts
↓
Order terms update
```

---

# 40. Overtime Earnings

例如：

```text
Base:
18:00–21:00
600k

Extension:
21:00–22:00
+220k
```

必须在 Agent 接受前明确。

---

# 41. Agent 可以拒绝加时

拒绝：

```text
does not count as cancellation
```

原 Order 仍按原结束时间完成。

---

# 42. Unplanned Overtime Evidence

如果发生争议：

```text
check-in
check-out
chat
requester confirmation
```

可以作为证据。

具体判责放到 Dispute 章节。

---

# 43. Early Completion

Fixed Task 提前完成：

默认：

```text
Fixed earnings remain unchanged
```

只要交付目标已经合法完成。

---

# 44. Hourly Early Completion

Hourly Task：

按照：

```text
minimum duration
+
actual approved time
```

计算。

---

# 45. Multi-slot Pricing

每个原子 Slot 有自己的：

```text
CompensationTerms
```

SlotGroup 可以批量复制。

---

# 46. Multi-slot Example

```text
Grand Opening

Greeter ×3
600k each
= 1.8M

Interpreter ×1
900k
= 900k

Content Talent ×1
800k
= 800k

Agent Earnings Total
= 3.5M
```

---

# 47. Task-level Budget

Task 可以额外保存：

```text
task_budget_cap
```

用于 Business 控制总预算。

但：

> 每个 Slot 的 Compensation Terms 仍然是交易真相。

---

# 48. Budget Cap Conflict

如果：

```text
sum(slot compensation)
>
task_budget_cap
```

则不能 Commit。

---

# 49. Optional Slot Pricing

Optional Slot 仍需：

```text
explicit compensation
```

不能：

```text
“有空就来帮忙”
```

---

# 50. Complex Task Quote Mode

部分专业任务无法预先固定价。

例如：

```text
Technical Site Visit
Professional Interpreter
Complex Creator Campaign
```

P1 支持：

```text
QUOTE_REQUIRED
```

---

# 51. Quote 不等于公开竞价

Quote 只能发生在：

```text
Valid Task
+
Finite Qualified Candidates
```

Requester 可以邀请：

```text
1–3 qualified Agents
```

提交私密 Quote。

---

# 52. QuoteRequest

对象：

```text
quote_request_id
task_id
slot_id
agent_id

scope_snapshot
deadline

status
```

---

# 53. Quote Status

```text
REQUESTED
SUBMITTED
ACCEPTED
DECLINED
EXPIRED
WITHDRAWN
```

---

# 54. Quote Schema

```text
quote_id
quote_request_id

base_earnings
travel
equipment
other_approved_items

total_agent_earnings

valid_until
message optional
```

---

# 55. Quote Visibility

Requester 只能看到：

```text
自己邀请的 Quote
```

Agent 看不到：

```text
其他 Agent Quote
```

避免竞价压价。

---

# 56. Quote Selection

Requester 选择 Quote 时：

仍不能只看：

```text
Lowest
```

UI 默认强调：

```text
Match Quality
Relevant Outcome
Reliability
Price
```

---

# 57. Quote Acceptance

Requester Accept Quote 后：

```text
CompensationTerms frozen
↓
Agent final accept if required
↓
Order
```

根据具体 Curated Flow 配置。

---

# 58. Platform Fee

必须建立：

```text
PlatformFeePolicy
```

而不是散落在各页面。

---

# 59. Fee Components

未来可以支持：

```text
Requester Service Fee
Agent Service Fee
Business Subscription Discount
Payment Processing Pass-through
```

但必须透明。

---

# 60. P0 商业建议

P0 建议：

> **主要平台交易费优先向 Requester / Business 侧收取。**

原因：

```text
Agent 更容易理解“我做这单到手多少钱”
有利于建立赚钱心智
降低 Supply 流失
```

具体费率不在本章锁死。

---

# 61. Agent-side Fee

架构可以保留：

```text
agent_service_fee
```

但如果启用：

Agent 必须在 Accept 前看到：

```text
Gross Earnings
Platform Fee
Net Earnings
```

不能任务结束才知道被扣钱。

---

# 62. Requester Service Fee

Requester Review 页面显示：

```text
Human Agent Earnings
3,500,000

Proxy Service
350,000

Estimated Total
3,850,000
```

金额示例仅表达 UI 结构，实际费率由 Market Policy 决定。

---

# 63. Fee Snapshot

Order 创建时：

```text
fee_policy_version
fee_snapshot
```

必须冻结。

后续平台改费率：

不能影响已确认 Order。

---

# 64. Platform Fee Value

平台收取交易费必须对应持续价值：

```text
Matching
Payment Protection
Evidence
Replacement
Dispute Support
Trust
Safety
Business Billing
```

否则用户更容易绕平台。

---

# 65. Off-platform 经济设计

不能只依赖：

```text
隐藏联系方式
```

而应让 Requester / Agent 感到：

```text
走 Proxy
=
更安全
更快 Replacement
可审计
可结算
可复聘
```

---

# 66. Cancellation Compensation

取消费用本章只定义原则：

> **越接近执行、Agent 已投入越多，取消保护应越强。**

具体比例放 Payment / Cancellation 章节。

---

# 67. Cancellation Snapshot

Order 必须保存：

```text
cancellation_policy_version
```

Agent Accept 前可看到摘要。

---

# 68. No-show Economics

No-show 可能影响：

```text
payment
refund
reputation
risk
```

但金额规则后续单独定义。

---

# 69. Refund 不回写 Agent Earnings 历史

结算发生退款时：

必须用：

```text
Ledger Adjustment
```

不能修改历史：

```text
original agreed earnings
```

---

# 70. Earnings Ledger Boundary

真正到账由 Payment 章节创建：

```text
AgentEarningsLedger
```

Pricing 本章只计算：

```text
agreed compensation
```

---

# 71. Boost 与 Task Earnings 分离

Agent Boost 是：

```text
Marketing / Sponsored Product
```

不能从某个 Task 的：

```text
Agent Earnings
```

中隐藏扣除。

---

# 72. Boost Wallet / Credits

如果未来 Boost 使用：

```text
Proxy Credits
```

必须与：

```text
Withdrawable Agent Earnings
```

严格分账。

---

# 73. Earn → Spend Loop

长期可以：

```text
Agent Earnings
↓
Withdraw
```

也可以由 Agent 自愿：

```text
Spend at Proxy Merchant
```

但不得：

```text
强制把 Agent 工资变成消费券
```

---

# 74. Membership Points

Merchant Membership Points：

```text
not cash
```

不得与：

```text
Agent Earnings
```

混合。

---

# 75. Pricing Version

所有计算必须带：

```text
pricing_version
```

包括：

```text
floor
reference range
fee
urgent policy
travel policy
```

---

# 76. Compensation Snapshot

Order 创建时保存：

```text
AcceptedCompensationSnapshot
```

至少：

```text
pricing_mode
base earnings
duration
minimum duration
travel
urgent premium
overtime rule
agent fee if any
net earnings
requester charge
currency
```

---

# 77. Contract-relevant Edit

Order 已确认后：

Requester 降低：

```text
Pay
Duration
Travel Allowance
```

属于：

```text
L2 Contract Change
```

必须 Agent Re-consent。

---

# 78. Increase Pay

增加 Pay：

可以发：

```text
Compensation Increase
```

Agent 不需要因为纯增益重新确认整个任务，

但仍需保留 Audit。

---

# 79. Currency

所有金额对象必须：

```text
amount
currency
```

不能假设只有 VND。

---

# 80. Money Precision

后端使用：

```text
integer minor units
```

或等价安全 Money 类型。

禁止：

```text
floating point money
```

---

# 81. Market Policy

推荐：

```text
PricingMarketPolicy
```

按：

```text
country
city / region
role
effective date
```

配置。

---

# 82. Price Experiment

可以实验：

```text
reference range UI
fee presentation
suggested premium
```

但不能对已确认合同偷偷变更。

---

# 83. Anti-discrimination Pricing Audit

Pricing Feature 必须可审计：

```text
which features affected recommendation
```

避免敏感字段渗入。

---

# 84. Price Learning Signals

系统可以学习：

```text
Task committed
Supply count
Offer acceptance
Fill rate
Completion
Requester repeat
Agent repeat
```

用于改善：

```text
Reference Range
```

---

# 85. 不用 CTR 学价格

不能因为：

```text
某类头像被点击多
```

就提高某类人的推荐价格。

---

# 86. Price Elasticity

未来可估算：

```text
Price
→ Available Supply
→ Fill Probability
```

例如：

```text
500k → 25% expected fill
650k → 68%
800k → 84%
```

必须标记：

```text
estimate
```

---

# 87. Demand Builder Price Guidance

推荐 UI：

```text
Your offer
500k

Market signal
Thin supply

Suggested
650k

Why?
More qualified Agents are likely to accept.
```

---

# 88. Agent Pricing Guidance

Agent 设置 Min Pay 时：

可显示：

```text
Typical completed tasks in this role:
550k–750k
```

不强迫接受平台推荐。

---

# 89. Price Anchoring 风险

不要故意把：

```text
高价锚点
```

用于诱导 Requester。

参考价必须来源于真实市场数据。

---

# 90. Agent Earnings Transparency

Offer Card 必须优先显示：

```text
You earn
650,000 VND
```

若存在费用：

```text
Net after Proxy fee
620,000 VND
```

不能只显示：

```text
Task Budget
```

---

# 91. Requester Charge Transparency

Commit 前显示：

```text
Agent compensation
Platform fee
Travel
Other approved items
Total
```

---

# 92. No Hidden Fee

任何在 Commit / Accept 前未披露的强制费用：

```text
Not allowed
```

除非是法律 / 税费变化，并按政策处理。

---

# 93. Business Pricing

Business 可以有：

```text
contract fee policy
volume discount
subscription discount
billing terms
```

但：

```text
Agent agreed earnings
```

仍必须独立记录。

---

# 94. Business Bulk Task

例如：

```text
Greeter ×20
```

可以给 Business：

```text
platform fee discount
```

不等于压低：

```text
Agent Floor
```

---

# 95. Merchant Membership Discount

未来会员权益可以给 Consumer：

```text
Proxy Service Fee Discount
```

但不能让：

```text
Agent Earnings
```

因此减少，除非 Agent 自愿接受新的 Compensation Terms。

---

# 96. Promotional Subsidy

平台可以补贴：

```text
Requester pays less
Agent earns same
```

结构：

```text
Agent Earnings = 650k
Requester Charge before subsidy = 715k
Promotion subsidy = 100k
Requester pays = 615k
```

---

# 97. Subsidy Accounting

补贴来自：

```text
Platform Promotion Budget
Merchant Campaign Budget
Partner Funding
```

不能伪装成 Agent 降价。

---

# 98. Pricing API

建议：

```text
POST /pricing/estimate
POST /pricing/validate
GET /pricing/market-guidance
POST /tasks/{id}/pricing/preview
```

---

# 99. Quote API

P1：

```text
POST /slots/{id}/quote-requests
POST /quote-requests/{id}/submit
POST /quotes/{id}/accept
POST /quotes/{id}/withdraw
```

---

# 100. Pricing Estimate Output

```json
{
  "currency": "VND",
  "recommended_range": {
    "min": 550000,
    "max": 750000
  },
  "effective_floor": 450000,
  "current_offer": 600000,
  "supply_signal": "HEALTHY",
  "estimated_agent_earnings": 600000,
  "estimated_requester_charge": 660000
}
```

示例只表示 Schema。

---

# 101. Pricing Audit

每次 Commit / Accept 保存：

```text
task_id
slot_id
pricing_version
market_policy
requester_budget
agent_floor
agreed_earnings
fees
premium
allowance
currency
timestamp
```

---

# 102. Metrics — Marketplace Economics

核心：

```text
GMV
Agent Earnings
Requester Charge
Platform Revenue
Take Rate
```

---

# 103. Supply-side Economics

```text
Median Earnings per Order
Earnings per Available Hour
Agent Repeat Rate
Agent Earnings Distribution
```

---

# 104. Demand-side Economics

```text
Budget-to-Commit
Price Adjustment Rate
Fill Rate by Price Band
Repeat Rate by Total Charge
```

---

# 105. Guardrail Metrics

必须监控：

```text
Below-floor attempts
Agent earnings decline
Price concentration
Sponsored spend vs earnings
Cancellation compensation
Off-platform bypass indicators
```

---

# 106. Price Fairness

平台要观察：

```text
similar context
similar capability
similar outcome
```

下长期价格是否出现无法解释的大偏差。

不是保证所有人同价，

而是避免系统性不合理差异。

---

# 107. P0 必须实现

```text
Requester Budget
Agent Earnings
Requester Charge
CompensationTerms
FIXED
HOURLY
Minimum Duration
Agent Min Pay Gate
Market Reference Range
Effective Floor
Multi-slot Pricing
Travel Fixed Allowance
Urgent Premium structure
Overtime policy structure
Platform Fee Policy
Pricing Version
Compensation Snapshot
Transparent UI
```

---

# 108. P1

```text
Custom Quote
Distance-based Travel
Expense Reimbursement
Automatic Fast Match Budget Cap
Dynamic Price Elasticity
Business Contract Pricing
Advanced Promotions
```

---

# 109. Acceptance Criteria

## AC-PRICE-01
Requester Budget、Agent Earnings、Requester Charge 必须是独立概念。

## AC-PRICE-02
不得使用单一 `price` 字段承载完整交易价格。

## AC-PRICE-03
每个 TaskSlot 必须拥有明确 CompensationTerms。

## AC-PRICE-04
P0 必须支持 FIXED / HOURLY。

## AC-PRICE-05
Hourly Task 必须支持 Minimum Duration。

## AC-PRICE-06
Agent Min Pay 必须作为 Eligibility Gate。

## AC-PRICE-07
平台必须支持有效最低 Compensation Floor。

## AC-PRICE-08
低于 Floor 的 Task 不得 Commit。

## AC-PRICE-09
不得建立公开反向竞价市场。

## AC-PRICE-10
Agent 不得看到其他 Agent 的私人 Quote。

## AC-PRICE-11
Candidate 默认不得按 Cheapest First 排序。

## AC-PRICE-12
Price Guidance 必须基于 Task Context。

## AC-PRICE-13
敏感无关属性不得进入 Pricing Formula。

## AC-PRICE-14
Supply Thin 时可以建议涨价，但 P0 不得自动涨价。

## AC-PRICE-15
Urgent Premium 必须对双方透明。

## AC-PRICE-16
Travel Allowance 必须与基础 Earnings 分项。

## AC-PRICE-17
Overtime 必须经过 Agent 同意。

## AC-PRICE-18
Agent 拒绝 Overtime 不得算 Cancellation。

## AC-PRICE-19
每个原子 Slot 必须有独立 Compensation Terms。

## AC-PRICE-20
Task Budget Cap 不得替代 Slot Compensation。

## AC-PRICE-21
Quote Mode 只能用于有限 Qualified Candidates。

## AC-PRICE-22
Quote 不得演变为公开最低价竞标。

## AC-PRICE-23
平台费必须在 Commit / Accept 前透明披露。

## AC-PRICE-24
已确认 Order 必须冻结 Fee / Pricing Snapshot。

## AC-PRICE-25
Agent Earnings 与 Boost / Credits 必须分账。

## AC-PRICE-26
Agent Earnings 与 Membership Points 必须分账。

## AC-PRICE-27
Agent 可自愿消费 Earnings，但不得强制转换为平台币。

## AC-PRICE-28
降 Pay 属于 Contract-relevant Change，必须 Agent Re-consent。

## AC-PRICE-29
金额必须包含 Currency。

## AC-PRICE-30
不得使用浮点数存储 Money。

## AC-PRICE-31
Promotional Subsidy 不得降低 Agent 已约定 Earnings。

## AC-PRICE-32
Pricing 必须版本化、可审计。

## AC-PRICE-33
Pricing 学习目标应服务 Fill / Completion / Repeat，而非 Profile CTR。

## AC-PRICE-34
平台必须监控 Race-to-bottom 与 Agent Earnings Health。

---

# 110. 本章锁定结论

1. **Proxy 不做最低价真人竞拍。**
2. **Requester Budget、Agent Earnings、Requester Charge 三者严格分离。**
3. **每个原子 Human Slot 都有独立 Compensation Terms。**
4. **P0 先锁 FIXED + HOURLY。**
5. **Hourly 必须保护 Minimum Duration。**
6. **Agent Min Pay 是 Eligibility Gate，不是 Ranking Preference。**
7. **平台必须有最低 Compensation Floor。**
8. **Price Guidance 用于帮助成交，不用于压价。**
9. **Travel / Urgent / Overtime 必须透明拆项。**
10. **Overtime 是新的双向协议，不允许强制真人无偿加班。**
11. **复杂 Professional Task 可以未来支持私密 Quote，但不做公开竞价。**
12. **P0 商业建议优先让 Requester / Business 承担主要交易服务费，强化 Agent“明确赚钱”的心智。**
13. **Agent Earnings、Boost、Membership Points、Proxy Credits 严格账务隔离。**
14. **平台补贴可以降低 Requester 价格，但不能偷偷降低 Agent Earnings。**
15. **Pricing 最终要同时优化 Human Earnings、Fill Rate、Completion 与 Repeat。**

---

# 111. 下一章

下一份增量 PRD：

> **Chapter 10 — Payment / Escrow / Settlement / Cancellation / Refund**

重点解决：

```text
Requester 什么时候真正付款
钱什么时候锁住
Agent 什么时候确认有保障
什么时候释放 Earnings
取消怎么扣
No-show 怎么处理
Replacement 怎么结算
退款怎么做
Dispute 时钱怎么 Freeze
平台费什么时候确认收入
```

这会把 Chapter 09 的“价格协议”推进成真正的钱流。

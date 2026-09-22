# Proxy PRD v1.1
## Chapter 19 — Analytics / Metrics / Experimentation / Marketplace Health

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order
- Chapter 05 — Matching Engine
- Chapter 06 — Fast Match / Offer
- Chapter 08 — Availability / Supply
- Chapter 09 — Pricing
- Chapter 10 — Payment
- Chapter 11 — Execution
- Chapter 12 — Trust / Repeat
- Chapter 13 — Safety / Risk
- Chapter 15 — Business Workspace
- Chapter 16 — Earn → Spend
- Chapter 18 — Operator Operations

**本章范围**：
- North Star
- Marketplace Funnel
- Liquidity Metrics
- Supply Health
- Demand Health
- Matching Quality
- Execution Quality
- Agent Economics
- Requester Value
- Business Value
- Repeat / Trust
- Safety Guardrails
- Monetization
- Content-assisted Conversion
- Experimentation
- Ranking Experiments
- Pricing Experiments
- Boost Experiments
- Metric Governance
- Anti-Gaming
- Data Quality
- Marketplace Health Scorecard

---

# 1. 本章目标

Analytics 的作用不是：

```text
做很多 Dashboard
```

而是回答：

> **Proxy 是否真的在让“需要真人的人”更快找到“合适的真人”，并最终完成真实世界任务。**

所有核心指标都必须围绕：

```text
Need
→ Match
→ Human Accept
→ Arrival
→ Completion
→ Repeat
```

---

# 2. 北极星指标

正式锁定：

> **Successful Human Executions**

定义：

```text
A Human Agent Order
that:
- was validly funded
- was accepted by the Agent
- reached real execution
- completed the agreed core deliverable
- was not invalidated by fraud / severe policy breach
```

---

# 3. 为什么不是 GMV

GMV 很重要，

但：

```text
high GMV
```

不一定意味着：

```text
better marketplace
```

如果存在：

```text
high cancellation
late arrival
poor completion
forced low pay
```

GMV 可能反而掩盖问题。

---

# 4. 为什么不是 MAU

Proxy 不是社交娱乐平台。

```text
MAU
DAU
Session Time
```

可以观察，

但不能作为产品北极星。

---

# 5. 为什么不是 Profile Views

正式禁止把：

```text
Profile Views
People Browsing
Candidate Dwell Time
Avatar CTR
```

作为核心成功目标。

---

# 6. North Star Supporting Metrics

北极星下面至少：

```text
Task Commit Rate
Slot Fill Rate
Time to Fill
Agent Acceptance Rate
Arrival Rate
On-time Rate
Completion Rate
Repeat Rate
```

---

# 7. Unit of Measurement

必须明确不同指标的原子：

```text
Task
TaskSlot
Order
Agent
Requester Principal
Business
Liquidity Cell
```

不能混着算。

---

# 8. Fill Rate 原子

推荐：

```text
Slot Fill Rate
=
Filled Required Slots
/
Committed Required Slots
```

不是：

```text
Filled Tasks / Total Tasks
```

因为一个 Task 可能有很多 Slot。

---

# 9. Successful Human Execution 原子

最终以：

```text
Completed Order
```

为原子。

---

# 10. Marketplace Funnel

总漏斗：

```text
Need Started
↓
Task Draft
↓
Task Validated
↓
Committed
↓
Slot Opened
↓
Qualified Supply Found
↓
Offer / Invite Sent
↓
Agent Accepted
↓
Order Created
↓
Agent Arrived
↓
Started
↓
Completed
↓
Repeat / Trusted
```

---

# 11. Funnel 不只看转化

每一层还要看：

```text
time
quality
reason for drop
```

---

# 12. Demand Funnel

Requester：

```text
Need
→ Draft
→ Commit
→ Fill
→ Complete
→ Repeat
```

---

# 13. Supply Funnel

Agent：

```text
Signup
→ AgentProfile
→ Qualified Role
→ Availability
→ Offer
→ Accept
→ First Order
→ Repeat Order
→ Stable Earnings
```

---

# 14. Business Funnel

Business：

```text
Create Workspace
→ First Task
→ First Successful Slot
→ Repeat Task
→ Trusted Team
→ Multi-store / recurring usage
```

---

# 15. Core Marketplace Equation

长期可以近似理解：

```text
Successful Human Executions
=
Committed Slots
× Eligibility Coverage
× Offer Reach
× Acceptance
× Arrival
× Completion
```

不是数学上的严格独立概率，

但有利于定位问题。

---

# 16. Liquidity Cell

沿用：

```text
Geo Zone
× Time Window
× Role / Task Template
```

作为 Liquidity 基本分析单元。

---

# 17. Liquidity 的核心问题

一个 Cell 要回答：

```text
有没有足够 Supply？
多久能填？
报价是否合理？
Agent 是否愿意接？
最终是否到场？
```

---

# 18. Liquidity Metrics

推荐：

```text
Qualified Supply
Active Supply
Open Demand
Supply / Demand Ratio
Median Time to Fill
P90 Time to Fill
Wave 1 Fill Rate
Unfilled Rate
```

---

# 19. Supply / Demand Ratio

只能作为辅助。

不能简单：

```text
ratio > 1 = healthy
```

还必须看：

```text
acceptance
time
location
price
reliability
```

---

# 20. Liquidity Status

继续沿用：

```text
HEALTHY
THIN
CRITICAL
EMPTY
UNKNOWN
```

---

# 21. Healthy Cell

不只要求：

```text
有很多 Agent
```

还要求：

```text
fill fast
acceptance healthy
arrival healthy
completion healthy
```

---

# 22. Registered Supply 不参与实时 Liquidity

再次锁定：

```text
registered agents
≠
active supply
```

---

# 23. Active Supply

应定义为：

```text
eligible
+
active role
+
valid availability
+
location/time feasible
+
no conflict
```

---

# 24. Supply Health

Agent 侧核心：

```text
Qualified Agent Count
Active Supply Hours
Available Sessions
Offer Relevance
Offer Acceptance
Earnings per Available Hour
Repeat Work
```

---

# 25. Earnings per Available Hour

重要定义：

```text
Agent Earnings
/
Available Supply Hours
```

这是比：

```text
App Time
```

更有意义的 Agent 价值指标。

---

# 26. Productive Paid Hours

长期推荐指标：

```text
Productive Paid Hours
```

定义：

> Agent 实际完成有支付保障的真人任务时间。

---

# 27. Supply Utilization

```text
Paid Execution Hours
/
Available Hours
```

但不能追求：

```text
100%
```

因为过高可能代表：

```text
过劳
供给不足
```

---

# 28. Agent Earnings Distribution

必须看：

```text
median
P25
P75
top concentration
new agent earnings
```

不能只看平均值。

---

# 29. New Agent Health

推荐：

```text
Time to First Qualified Role
Time to First Offer
Time to First Order
First 30-day Earnings
First Repeat Order
```

---

# 30. New Agent Starvation

重要 Guardrail：

```text
New Qualified Agents
with zero meaningful exposure
```

比例不能过高。

---

# 31. Winner-takes-all Risk

监控：

```text
Top 1% Agent Share
Top 10% Agent Share
Order Concentration
Offer Concentration
```

---

# 32. Repeat Concentration

Repeat 是好事，

但如果：

```text
all demand permanently locked to old agents
```

新供给会死亡。

所以同时看：

```text
Repeat Success
+
New Agent Entry
```

---

# 33. Offer Health

核心：

```text
Offers per Available Hour
Relevant Offer Rate
View Rate
Response Rate
Accept Rate
Expiry Rate
Spam Complaint Rate
Mute Rate
```

---

# 34. Offer View Rate 不是北极星

高 View Rate 可能只是：

```text
标题做得更刺激
```

真正要看：

```text
Offer → Accept → Complete
```

---

# 35. Offer Relevance

可以定义：

```text
Relevant Offer Rate
=
Offers not immediately declined for obvious mismatch
/
Total Offers
```

需结合结构化 Decline Reason。

---

# 36. Decline Reasons

重要用于 Supply Shaping：

```text
TOO_FAR
PAY_TOO_LOW
TIME_NOT_GOOD
ROLE_MISMATCH
TASK_CONTEXT
SAFETY_CONCERN
BUSY
```

---

# 37. Decline 不等于负面

Analytics 不应把：

```text
Decline Rate
```

简单当 Agent 质量差。

要看：

```text
why
```

---

# 38. Demand Health

Requester 侧：

```text
Need → Draft
Draft → Commit
Commit → Fill
Fill → Complete
Complete → Repeat
```

---

# 39. Demand Quality

Task 质量可通过：

```text
Clarification Count
Graph Gap
Requirement Conflict
Policy Reject
Supply Empty
Last-minute Change
Cancellation
```

观察。

---

# 40. Demand Shaping Effectiveness

重要：

```text
Low Supply
↓
Requester adjusts
↓
Supply improves
↓
Task fills
```

指标：

```text
Demand Shaping Acceptance Rate
Post-adjustment Fill Lift
```

---

# 41. Price Adjustment Effect

例如：

```text
500k
→ supply critical

650k
→ supply healthy
```

看：

```text
fill uplift
agent earnings uplift
requester conversion impact
```

---

# 42. Time Flexibility Effect

```text
fixed time
vs
flexible window
```

对：

```text
Fill
ETA
Price
```

影响。

---

# 43. Radius Expansion Effect

观察：

```text
radius +2km
→ qualified supply change
→ time-to-fill change
```

同时监控：

```text
Agent travel burden
```

---

# 44. Matching Quality

不能只看：

```text
ranking click
```

要看：

```text
Qualified → Invite
Invite → Accept
Accept → Arrive
Arrive → Complete
Complete → Rehire
```

---

# 45. Match Success

推荐：

```text
Match Success
=
Order reaches COMPLETED
```

而不是：

```text
Agent clicked Accept
```

---

# 46. Matching Precision

可以近似：

```text
Top-ranked Candidate
→ accept / complete
```

但必须结合：

```text
exposure fairness
```

---

# 47. Candidate Set Quality

指标：

```text
Candidate Set → Invite
Invite → Accept
Candidate Set Coverage
Requester Selection Time
```

---

# 48. People Browsing Guardrail

如果 Candidate Detail Views：

```text
大幅增长
```

但：

```text
Time to Fill
没有下降
```

甚至上升，

说明产品可能在鼓励浏览。

---

# 49. Anti-browsing Metric

推荐：

```text
Candidate Views per Filled Slot
```

长期应该：

```text
低而健康
```

而不是无限增长。

---

# 50. Time to Decision

Requester：

```text
Valid Task
→ Invite / Fast Match commit
```

越短越好，

前提：

```text
completion quality不下降
```

---

# 51. Fast Match Metrics

```text
Wave 1 Fill Rate
Median Waves to Fill
Median Time to Accept
Median Time to Fill
Replacement Fill Time
```

---

# 52. Curated Match Metrics

```text
Candidates Viewed
Invites Sent
Invite Acceptance
Time to Select
Final Completion
```

---

# 53. Fast vs Curated

不能用：

```text
哪个点击多
```

判断。

要看：

```text
Time to Fill
Completion
Requester Repeat
Agent Satisfaction / Economics
```

---

# 54. Execution Health

核心：

```text
Arrival Rate
On-time Rate
Start Rate
Completion Rate
No-show Rate
Exception Rate
Evidence Completion
```

---

# 55. Time Metrics

```text
Order Confirmed → En Route
En Route → Arrived
Arrived → Start
Start → Complete
Complete → Settlement
```

---

# 56. No-show Attribution

必须区分：

```text
AGENT_NO_SHOW
REQUESTER_NO_SHOW
VENUE_FAILURE
EXTERNAL_CAUSE
```

---

# 57. Cancellation Health

按：

```text
actor
phase
reason
```

拆：

```text
Requester cancellation
Agent cancellation
Platform cancellation
```

---

# 58. Last-minute Cancellation

特别监控：

```text
within critical pre-start window
```

因为对真人供给伤害大。

---

# 59. Replacement Health

```text
Replacement Trigger Rate
Replacement Fill Rate
Replacement Time
Replacement Completion Rate
```

---

# 60. Evidence Health

```text
Required Evidence Missing
Evidence Clarification
Evidence Dispute
Evidence Privacy Violation
```

---

# 61. Completion Quality

除了完成率，

还看：

```text
Rehire Intent
Repeat Hire
Dispute Rate
Task Mismatch
```

---

# 62. Repeat Health

核心：

```text
Repeat Task Rate
Rehire Rate
Trusted Proxy Creation
Trusted Team Fill Rate
Repeat Completion
```

---

# 63. Repeat Time to Fill

非常重要：

```text
repeat task
```

应该明显比：

```text
first-time task
```

更快。

---

# 64. Trusted Team Value

Business：

```text
Trusted Team Fill
vs
Marketplace Fill
```

比较：

```text
time
completion
cost
replacement
```

---

# 65. Requester Value Metrics

Individual：

```text
Time to Fill
Completion
Repeat
Total Charge
Issue Rate
```

---

# 66. Requester Effort

可以观察：

```text
steps to commit
clarification count
candidate views
manual interventions
```

目标：

```text
less effort per successful execution
```

---

# 67. Business Value Metrics

Business：

```text
Slot Fill Rate
Median Fill Time
Arrival Rate
Completion Rate
Replacement Rate
Trusted Fill Rate
Cost per Successful Slot
```

---

# 68. Cost per Successful Slot

定义：

```text
total task-side cost
/
completed slots
```

这是重要 B 端价值指标。

---

# 69. Business Human Ops Efficiency

长期可以：

```text
Time spent managing human ops
/
completed slots
```

如果可测。

---

# 70. Agent Value Metrics

Agent：

```text
Earnings
Earnings per Available Hour
Offer Relevance
Repeat Work
Cancellation Compensation
Payout Time
```

---

# 71. Agent Retention

不要只看：

```text
30-day login retention
```

更有意义：

```text
30-day earning retention
```

即：

> Agent 是否再次完成有收入的任务。

---

# 72. Requester Retention

更适合：

```text
repeat successful task
```

而不是：

```text
app reopen
```

---

# 73. Business Retention

核心：

```text
repeat human operations usage
```

例如：

```text
90-day recurring Task usage
```

---

# 74. Marketplace Revenue

收入指标：

```text
Human Agent GMV
Platform Revenue
Take Rate
Boost Revenue
Business Tools Revenue
Verification Revenue
```

---

# 75. GMV 与 Agent Earnings

必须同时看：

```text
GMV
Agent Earnings
Platform Revenue
```

防止平台收入增长来自：

```text
压低 Agent Earnings
```

---

# 76. Take Rate

```text
Platform Revenue
/
GMV
```

只是商业指标。

不能脱离：

```text
Agent health
Requester repeat
```

单独优化。

---

# 77. Boost Health

Agent Boost 已明确保留。

必须监控：

```text
Boost Buyers
Boost Spend
Sponsored Exposure
Sponsored Offer Access
Sponsored Conversion
```

---

# 78. Boost Guardrail

同时必须看：

```text
Organic Agent Exposure
Organic Fill
New Agent Exposure
Completion Quality
Requester Trust
```

---

# 79. Boost 不能破坏自然市场

如果：

```text
Boost revenue ↑
```

但：

```text
organic qualified agent opportunities ↓↓↓
completion ↓
```

则实验失败。

---

# 80. Sponsored Quality

Sponsored Agent 的：

```text
Arrival
Completion
Dispute
Repeat
```

必须至少达到合理 Marketplace Guardrail。

---

# 81. Pricing Health

核心：

```text
Median Agent Earnings
Requester Total Charge
Fill by Price Band
Acceptance by Price Band
Completion by Price Band
```

---

# 82. Race-to-bottom Guard

必须监控：

```text
Median Earnings by Role
P25 Earnings
Effective Floor hit rate
Below-floor attempts
Agent minimum pay trends
```

---

# 83. Price Inflation Guard

也要监控：

```text
Requester abandonment
excessive premiums
fill not improving despite price
```

---

# 84. Safety Metrics

必须独立且高优先：

```text
Incident Rate
Critical Incident Rate
Harassment
Fraud
Task Mismatch
Unsafe Venue
Appeal Overturn
```

---

# 85. Safety 不可作为实验牺牲品

正式硬规则：

> **任何实验都不能以提升转化为理由接受显著 Safety 恶化。**

---

# 86. Privacy Metrics

```text
Unauthorized Profile Access
Precise Location Grant Duration
Expired Grant Failure
Sensitive Data Exposure
Operator Access Anomaly
```

---

# 87. Payment Integrity

```text
Confirmed Order without Funding
Double Charge
Refund Failure
Payout Failure
Reconciliation Mismatch
Dispute Hold Aging
```

---

# 88. Marketplace Integrity

综合监控：

```text
fraud
collusion
self-dealing
fake tasks
fake outcomes
review manipulation
boost abuse
```

---

# 89. Self-dealing

Chapter 16 已锁：

```text
Requester self-assign
```

默认禁止。

Analytics 要监控绕过模式。

---

# 90. Review Integrity

```text
Review Abuse
Retaliation
Suspicious reciprocal reviews
```

---

# 91. Operator Health

```text
Manual Intervention Rate
Case Rate
Case SLA
Reopen Rate
Appeal Overturn
```

---

# 92. Manual Intervention Rate

关键系统质量指标：

```text
Cases requiring operator
/
Committed Tasks
```

随着成熟应下降。

---

# 93. Automation Recovery Rate

```text
Auto recovered exceptions
/
All recoverable exceptions
```

应提高。

---

# 94. Graph Health

```text
Graph Gap Rate
Unknown Requirement Rate
Mapped Existing
New Node Created
Deprecated Nodes
```

---

# 95. Graph Gap Too High

说明：

```text
Capability Graph coverage poor
```

但如果：

```text
0 graph gaps forever
```

也可能说明系统：

```text
在偷偷硬匹配 / 丢需求
```

---

# 96. Content Metrics

内容层只看基础内容：

```text
Views
Saves
Shares
CTA Click
Venue Visit Intent
Membership Join
Activity Join
Task Creation
```

---

# 97. Content North Star

推荐：

```text
Content-assisted Real-world Actions
```

不是：

```text
Watch Time
```

---

# 98. Video Metrics

当前普通视频：

可以看：

```text
play
completion
share
CTA
```

但不能让：

```text
video watch optimization
```

劫持 Marketplace 主目标。

---

# 99. Earn → Spend Metrics

Chapter 16：

```text
Agent Earnings
→ voluntary merchant spend
```

可以观察 aggregate：

```text
Earn-to-Spend Conversion
```

---

# 100. Earn → Spend Guardrail

不得为了提高该指标：

```text
限制提现
强推消费
降低提现体验
```

---

# 101. Merchant Local Economy Metrics

```text
Member Revenue
Activity Participation
Human Agent Demand Generated
Human Agent GMV
Repeat Consumption
```

---

# 102. 三边飞轮指标

可以串：

```text
Human Agent Earnings
↓
Voluntary Spend
↓
Merchant Revenue
↓
Activity / Campaign
↓
Human Agent Need
↓
Completed Orders
```

---

# 103. Experimentation

Proxy 需要统一：

```text
Experiment
```

对象。

---

# 104. Experiment Schema

```text
experiment_id
name

hypothesis
target_population

control_definition
variant_definitions

primary_metric
guardrail_metrics[]

start_at
end_at

status
owner
```

---

# 105. Experiment Status

```text
DRAFT
REVIEW
RUNNING
PAUSED
COMPLETED
ROLLED_BACK
```

---

# 106. Experiment Hypothesis

必须写成：

```text
If we change X,
we expect Y,
without harming Z.
```

例如：

```text
If Fast Match Wave 1 increases from 2 to 3,
Time to Fill decreases,
without increasing Agent Spam or Cancellation.
```

---

# 107. Primary Metric 只能一个

每个实验建议一个：

```text
primary metric
```

避免：

```text
看哪个指标涨就说赢
```

---

# 108. Guardrail Metrics

必须提前锁：

```text
Safety
Privacy
Agent Earnings
Completion
Spam
Fairness
```

---

# 109. Ranking Experiment

可以实验：

```text
signal weights
newcomer exploration
repeat relationship weight
ETA weight
```

---

# 110. Ranking 实验禁止

不能实验：

```text
敏感属性排序
颜值排序
无关社交热度
```

---

# 111. Ranking Primary Metric

推荐：

```text
Completed Orders per Qualified Exposure
```

或：

```text
Successful Human Execution
```

而不是：

```text
candidate click
```

---

# 112. Ranking Guardrail

至少：

```text
new agent exposure
earnings distribution
safety
cancellation
sponsored concentration
```

---

# 113. Fast Match Experiment

例如：

```text
Wave size
TTL
parallel vs sequential
```

Primary：

```text
Time to Fill
```

Guardrail：

```text
offers per agent
spam complaints
assignment lost
completion
```

---

# 114. Pricing Experiment

可以实验：

```text
reference range display
price suggestion wording
premium suggestion
```

---

# 115. Pricing 禁止实验

不能随机：

```text
压低 Agent agreed earnings
```

只为了提高平台 margin。

---

# 116. Pricing Guardrail

```text
Agent earnings
Fill
Requester commit
Cancellation
Repeat
```

---

# 117. Fee Experiment

如果实验：

```text
Requester Service Fee
```

必须明确：

```text
transparent
```

不能对同一已确认合同偷偷变化。

---

# 118. Boost Experiment

可以实验：

```text
Sponsored cap
Sponsored wave access
Boost duration
```

---

# 119. Boost Primary Metric

不能只看：

```text
boost purchase
```

还要看：

```text
incremental successful execution
```

---

# 120. Boost Guardrail

```text
organic fill
newcomer exposure
requester completion
market concentration
```

---

# 121. Notification Experiment

可以实验：

```text
reminder timing
digest
push copy
```

Primary：

```text
Time to Required Action
```

不是：

```text
push open rate
```

---

# 122. Content Experiment

可以实验：

```text
CTA placement
Venue cards
Activity cards
```

Primary：

```text
real-world conversion
```

不是：

```text
scroll depth
```

---

# 123. Safety Experiment Boundary

安全策略实验必须非常谨慎。

禁止：

```text
randomly remove protection
```

可以实验：

```text
education copy
safe UX
review workflow efficiency
```

---

# 124. Payment Experiment Boundary

不能随机：

```text
取消 payment protection
延长 Agent payout
```

来测试留存。

---

# 125. Experiment Eligibility

只有：

```text
policy-approved population
```

进入实验。

---

# 126. Stable Assignment

同一用户 / Business：

尽量：

```text
consistent variant
```

避免流程频繁变化。

---

# 127. Experiment Contamination

Marketplace 是双边 / 三边系统。

Requester 变体可能影响：

```text
Agent outcomes
```

因此实验分析要注意：

```text
network interference
```

---

# 128. Marketplace Experiment Unit

有时不适合按 User 随机。

可能需要：

```text
Geo Cell
Business
Time Window
Market
```

做实验单元。

---

# 129. Network Effect Experiment

例如 Pricing：

如果一半 Requester 加价：

可能改变整个 Cell 的 Supply 行为。

需要谨慎设计。

---

# 130. Experiment Rollback

任何：

```text
Safety
Payment Integrity
Severe Agent Earnings
```

Guardrail 触发，

必须支持：

```text
pause / rollback
```

---

# 131. Experiment Audit

记录：

```text
who launched
who approved
population
metric definitions
results
decision
```

---

# 132. Metric Definition Registry

推荐建立：

```text
MetricRegistry
```

避免同一个：

```text
Fill Rate
```

不同团队算不同。

---

# 133. Metric Definition

每个指标记录：

```text
metric_id
name
definition
numerator
denominator
entity grain
filters
timezone
owner
version
```

---

# 134. Versioning

指标定义变更：

```text
metric_version
```

避免历史趋势失真。

---

# 135. Event Taxonomy

Analytics 基于正式：

```text
Domain Events
```

而不是随手埋点。

---

# 136. Product Analytics Event

UI 行为可以额外：

```text
screen_view
cta_click
```

但真实业务指标应优先使用：

```text
TaskCommitted
OfferAccepted
OrderCompleted
```

---

# 137. No Shadow Analytics Truth

不能：

```text
前端事件说 completed
```

就当：

```text
Order Completed
```

业务真相必须来自 Domain。

---

# 138. Data Quality

需要监控：

```text
Missing Events
Duplicate Events
Late Events
Invalid State Sequence
```

---

# 139. Analytics Reconciliation

核心指标可与：

```text
DB / Ledger / Domain State
```

定期对账。

---

# 140. Anti-Gaming

任何指标一旦成为目标：

可能被 Gaming。

例如：

```text
Time to Fill
```

可能诱导：

```text
降低 Must-have
```

所以必须配：

```text
Completion
Dispute
Safety
```

---

# 141. Goodhart Guard

正式产品原则：

> **任何单一指标都不能在没有 Guardrail 的情况下作为团队目标。**

---

# 142. Agent Gaming

例如：

```text
fake availability
fake evidence
self-review
collusion
```

Analytics 要检测模式。

---

# 143. Requester Gaming

例如：

```text
fake tasks
repeated cancel
off-platform solicitation
false disputes
```

---

# 144. Business Gaming

例如：

```text
split tasks to avoid fee
self-dealing
fake member activity
```

---

# 145. Boost Gaming

例如：

```text
multiple accounts
boost stacking
irrelevant role boost
```

---

# 146. Marketplace Health Scorecard

建议不公开一个总分，

但内部 Scorecard 分区：

```text
Liquidity
Execution
Agent Economics
Requester Value
Business Value
Trust / Repeat
Safety
Payment Integrity
Marketplace Integrity
Operator Health
```

---

# 147. Health Color

内部可：

```text
GREEN
YELLOW
RED
```

但每个 Domain 分开。

不要：

```text
Marketplace Score = 83
```

掩盖结构问题。

---

# 148. Executive Dashboard

建议最顶层：

```text
Successful Human Executions
Slot Fill Rate
Median Time to Fill
Arrival Rate
Completion Rate
Repeat Rate
Agent Earnings
Earnings per Available Hour
Critical Incident Rate
Platform Revenue
```

---

# 149. Launch Dashboard

MVP 更重要：

```text
Committed Slots
Filled Slots
Completed Orders
Unfilled Reasons
Manual Intervention Rate
Agent Earnings
Requester Repeat
```

---

# 150. City Launch Metrics

新城市 / 新区域：

```text
Qualified Supply
Active Supply
Committed Demand
Fill
Time to Fill
Unfilled
```

---

# 151. Role Launch Metrics

新 Role：

```text
Qualified Agents
Verification
Offer Acceptance
Completion
Repeat
```

---

# 152. Scenario Launch Metrics

新 Scenario：

```text
Demand
Graph Gap
Admission
Fill
Exception
Completion
```

---

# 153. Feature Decision Gate

任何新 Feature 上线后必须回答：

```text
Did it improve:
Successful Human Execution?
Time to Fill?
Agent Earnings?
Repeat?
Business Efficiency?
```

以及：

```text
Did it harm:
Safety?
Privacy?
Fairness?
Marketplace Integrity?
```

---

# 154. People Browsing Test

继续沿用最重要的产品问题：

> **这个功能是在提高 Task Matching，还是在鼓励用户逛人？**

---

# 155. Browsing Warning Signals

例如：

```text
Profile Views ↑
Candidate Dwell ↑
People Search ↑
```

同时：

```text
Fill no improvement
Completion no improvement
```

则是危险信号。

---

# 156. Marketplace-first Product Review

每次评审新功能：

必须有：

```text
Expected Marketplace Effect
Primary Metric
Guardrails
Data Exposure Impact
Habit Impact
```

---

# 157. Habit Metrics — Requester

目标行为：

```text
Real need
→ Open Proxy
→ Create / Repeat Task
```

指标：

```text
Repeat Task Creation
Template Use
Trusted Proxy Use
```

---

# 158. Habit Metrics — Agent

目标行为：

```text
Free time
→ Go Available
```

指标：

```text
Available Now activation
Availability → Earnings
```

---

# 159. Habit Metrics — Business

目标行为：

```text
Human capacity gap
→ Create Slots
```

指标：

```text
Template Repeat
Trusted Fill
Marketplace Gap Fill
```

---

# 160. Notification Habit Guard

不能用：

```text
更多 Push
```

制造习惯。

习惯必须来自：

```text
real utility
```

---

# 161. Content Habit Guard

不能把：

```text
无限刷内容
```

作为 Retention 主体。

内容要导向：

```text
place
activity
membership
task
```

---

# 162. Local Economy Health

长期观察：

```text
Agent Earnings
Consumer Spend
Merchant Revenue
Human Agent Demand
```

但不应为了闭环：

```text
人为制造消费压力
```

---

# 163. Financial Privacy

Earn → Spend Analytics：

必须：

```text
aggregate
```

不能把 Agent 个体财务表现开放给 Merchant。

---

# 164. Cohort Analysis

推荐 Cohort：

```text
Agent first order month
Requester first task month
Business first successful slot month
Geo launch cohort
Role launch cohort
```

---

# 165. Cohort 比简单留存更重要

例如：

```text
First-order Agent Cohort
→ 30-day earning
→ 90-day repeat
```

---

# 166. Marketplace Segmentation

按：

```text
market
geo
industry
scenario
role
business size
task urgency
```

分析。

---

# 167. 不用敏感属性做运营绩效目标

敏感属性如有合法公平审计用途，

只能：

```text
restricted fairness analysis
```

不能：

```text
business optimization target
```

---

# 168. Fairness Audit

P1 可以做：

```text
exposure fairness
acceptance fairness
earning opportunity fairness
```

但需要：

```text
policy
legal review
restricted access
```

---

# 169. Data Access

Analytics 用户也要权限分级。

不是：

```text
所有分析师看所有 KYC / Location
```

---

# 170. Aggregation

默认分析优先：

```text
aggregated / de-identified
```

---

# 171. P0 必须实现

```text
Successful Human Executions
Slot Fill Rate
Time to Fill
Offer Funnel
Arrival
Completion
Cancellation
Replacement
Agent Earnings
Earnings per Available Hour
Requester Repeat
Business Repeat
Trusted Fill
Critical Safety
Payment Integrity
Manual Intervention Rate
Metric Registry
Domain Event Analytics
Basic Experiment Framework
Guardrail Framework
Marketplace Health Dashboard
```

---

# 172. P1

```text
Advanced Cohorts
Network-aware Experiments
Price Elasticity
Fairness Audit
Content-assisted Attribution
Local Economy Flywheel Analytics
Advanced Anti-gaming
Marketplace Forecasting
```

---

# 173. Acceptance Criteria

## AC-METRIC-01
Proxy 北极星必须是 Successful Human Executions，而不是 DAU / Profile Views。

## AC-METRIC-02
Successful Human Execution 必须以真实 Completed Order 为基础。

## AC-METRIC-03
Fill Rate 必须以原子 Required TaskSlot 为基础。

## AC-METRIC-04
Registered Agent 不得作为 Active Supply。

## AC-METRIC-05
Liquidity 必须按 Geo × Time × Role / Template 分析。

## AC-METRIC-06
Marketplace Health 不得只由 Supply / Demand Ratio 判断。

## AC-METRIC-07
Agent Economics 必须包含 Earnings per Available Hour。

## AC-METRIC-08
平台必须监控 New Agent First Order / Starvation。

## AC-METRIC-09
必须监控 Order / Offer Concentration 防止 winner-takes-all。

## AC-METRIC-10
Decline 必须结合 Reason 分析，不得直接作为 Agent 负面。

## AC-METRIC-11
Demand Shaping 必须评估对 Fill 的真实提升。

## AC-METRIC-12
Candidate Views 不得作为 Matching 核心成功指标。

## AC-METRIC-13
必须监控 Candidate Views per Filled Slot。

## AC-METRIC-14
Fast Match 必须看 Time to Fill + Completion + Spam Guardrail。

## AC-METRIC-15
Execution 必须区分 Agent No-show / Requester No-show / External Cause。

## AC-METRIC-16
Repeat Task 必须衡量是否真正更快、更稳。

## AC-METRIC-17
Business 必须使用 Cost per Successful Slot 等真实 Human Ops 指标。

## AC-METRIC-18
Agent Retention 应优先使用 earning retention，而非 login retention。

## AC-METRIC-19
Platform Revenue 增长不得脱离 Agent Earnings / Requester Repeat 单独优化。

## AC-METRIC-20
Boost 必须监控 Organic Exposure / New Agent Exposure / Completion。

## AC-METRIC-21
Pricing 必须监控 Race-to-bottom 与 Price Inflation 两边风险。

## AC-METRIC-22
Safety / Privacy / Payment Integrity 必须作为全平台硬 Guardrail。

## AC-METRIC-23
Manual Intervention Rate 必须作为系统成熟度指标。

## AC-METRIC-24
Content 成功必须更多看 Real-world Conversion，而非纯 Watch Time。

## AC-METRIC-25
Earn → Spend 不得通过限制提现等方式强行优化。

## AC-METRIC-26
每个 Experiment 必须有明确 Hypothesis / Primary Metric / Guardrails。

## AC-METRIC-27
每个 Experiment 推荐只有一个 Primary Metric。

## AC-METRIC-28
Ranking Experiment 不得使用无关敏感属性 / 颜值 / 社交热度。

## AC-METRIC-29
Pricing Experiment 不得偷偷降低 Agent agreed earnings。

## AC-METRIC-30
Boost Experiment 不得以牺牲 Organic Marketplace Health 为代价。

## AC-METRIC-31
Safety Protection 不得作为随机实验中的可牺牲变量。

## AC-METRIC-32
Payment Protection / Payout 保障不得为了实验随意降低。

## AC-METRIC-33
Marketplace Experiment 必须考虑 Network Interference。

## AC-METRIC-34
严重 Guardrail 触发必须支持 Pause / Rollback。

## AC-METRIC-35
所有核心指标必须进入 Metric Registry。

## AC-METRIC-36
Metric Definition 必须有 Grain / Numerator / Denominator / Version。

## AC-METRIC-37
真实业务指标必须优先来自 Domain Events，不得仅依赖前端埋点。

## AC-METRIC-38
Analytics 必须监控 Missing / Duplicate / Invalid Event。

## AC-METRIC-39
任何单一 KPI 都必须配 Guardrail，避免 Goodhart。

## AC-METRIC-40
Marketplace Health 最终必须帮助判断产品是否提高真实 Human Execution，而不是提高虚假活跃。

---

# 174. 本章锁定结论

1. **Proxy 北极星是 Successful Human Executions。**
2. **Task / Slot / Order / Agent / Business 的指标粒度必须严格区分。**
3. **Liquidity 看的是有效真人供给与真实成交，不是注册人数。**
4. **Agent 侧最重要的经济指标之一是 Earnings per Available Hour。**
5. **Requester / Business 的价值核心是更快 Fill、更高 Completion、更低 Human Ops 不确定性。**
6. **Repeat / Trusted 是长期效率，不是关系锁死。**
7. **Profile Views、Watch Time、Avatar CTR 不能劫持 Marketplace。**
8. **Boost 可以挣钱，但必须保护 Organic Supply、New Agents 和 Completion。**
9. **Pricing 必须同时防止 Race-to-bottom 和无效价格膨胀。**
10. **Safety、Privacy、Payment Integrity 是所有实验的硬 Guardrail。**
11. **Manual Intervention Rate 越低，说明系统自动收敛能力越成熟。**
12. **所有 Experiment 必须 Hypothesis-first、Primary Metric 单一、Guardrail 预先锁定。**
13. **真实指标优先来自 Domain Events，不来自前端“看起来成功”的行为事件。**
14. **任何功能都必须接受 People Browsing Test：是在提高撮合，还是在鼓励逛人。**
15. **Analytics 的最终职责，是防止 Proxy 从 Human Agent Marketplace 偏离成社交、广告或流量产品。**

---

# 175. 下一章

下一份增量 PRD：

> **Chapter 20 — MVP Cut / P0-P1 / Launch Scope / Acceptance Gate**

重点解决：

```text
这么多设计到底第一版做什么
哪些必须现在有
哪些只是架构预留
哪些绝对不能提前做
首发行业 / Scenario 怎么切
Requester / Agent / Business 各自最小闭环
支付 / Safety / Map / Content 做到什么程度
上线前必须过哪些 Gate
```

这一章会真正开始“收刀”，把现在已经完整的 Proxy 架构压缩成可以开发、可以上线、可以验证的第一版。

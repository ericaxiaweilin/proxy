# Proxy PRD v1.1
## Chapter 12 — Rating / Trust / Trusted Proxy / Repeat Relationship

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 05 — Matching Engine / Eligibility & Ranking
- Chapter 07 — Agent Capability Passport
- Chapter 10 — Payment / Settlement
- Chapter 11 — Execution / Evidence / Completion

**本章范围**：
- Structured Rating
- Reliability
- Capability Feedback
- Safety Feedback
- Requester Trust
- Agent Trust
- Trusted Proxy
- Business Trusted Team
- Repeat Relationship
- Rehire
- Rating Abuse
- Dispute Interaction
- New Agent Fairness
- Outcome Graph
- Review Visibility
- Trust Audit

---

# 1. 本章目标

任务完成后，Proxy 要回答：

1. 这次真人执行到底做得怎么样；
2. 哪些结果可以沉淀成长期 Reliability；
3. 哪些结果只属于当前 Task Context；
4. Requester 是否愿意以后直接再找这个 Agent；
5. Business 是否愿意把这个人放进 Trusted Team；
6. 怎样避免“一个五星评分”把能力、可靠性、安全、颜值混成一团；
7. 怎样让优秀 Agent 越做越值钱，同时新 Agent 仍有第一次机会。

---

# 2. 核心原则

正式锁定：

> **Rating 不是社交评分，而是 Human Execution Outcome 的结构化反馈。**

Proxy 不应依赖：

```text
4.8 stars
```

作为唯一信誉真相。

---

# 3. Trust 维度必须分离

至少拆成：

```text
Capability
Reliability
Safety
Relationship
Requester Trust
Content Performance
```

不能混成：

```text
Overall Human Score = 92
```

---

# 4. 为什么不建议单一星级作为核心

单一五星会混入：

```text
颜值
个人喜好
情绪
文化偏见
价格情绪
与任务无关的社交感受
```

而 Proxy 真正需要的是：

```text
Did the person arrive?
Did they complete?
Did they satisfy the role?
Would you rehire?
```

---

# 5. P0 评价形式

P0 建议：

```text
Structured Outcome Review
+
Optional short comment
```

不要强迫用户写长评。

---

# 6. Requester → Agent Review

完成 Order 后，Requester 评价：

```text
Was the task completed?
○ Yes
○ Partially
○ No

Was the Agent on time?
○ Yes
○ Late
○ Not applicable

Did they meet the role requirements?
○ Yes
○ Partially
○ No

Would you hire this Proxy again?
○ Yes
○ Maybe
○ No
```

---

# 7. Agent → Requester Review

Agent 也必须评价 Requester / Business。

例如：

```text
Was the task description accurate?
Was the location / access clear?
Was the agreed scope respected?
Was the environment safe?
Would you accept tasks from them again?
```

这是双向 Marketplace 必须具备的。

---

# 8. Review Object

推荐：

```text
Review
```

Schema：

```text
review_id
order_id

reviewer_type
reviewer_id

subject_type
subject_id

completion_rating
timeliness_rating
requirement_fit_rating
scope_accuracy_rating
safety_rating
rehire_intent

comment optional

status

created_at
updated_at
```

---

# 9. Review Status

```text
DRAFT
SUBMITTED
WITHHELD
UNDER_REVIEW
PUBLISHED
REMOVED
```

---

# 10. Blind Review

建议 P1 支持：

```text
双向 Blind Review
```

双方提交前：

```text
看不到对方评价
```

减少报复性评分。

P0 也可以先采用延迟公开。

---

# 11. Rating 不阻塞结算

正式硬规则：

> **评价不是 Agent 收款前置条件。**

Order 完成后：

```text
Settlement
```

按 Payment Policy 走。

Review 可以稍后完成。

---

# 12. Review Window

建议：

```text
review_deadline
```

例如若干天内完成。

具体时长配置化。

---

# 13. Missing Review

Requester 不评价：

```text
不等于差评
```

Agent 不评价：

```text
也不等于差评
```

---

# 14. Reliability 来源

Reliability 应优先来自系统事实：

```text
Offer Accepted
Arrival
On-time
Completion
Cancellation
No-show
Evidence
Repeat Hire
```

不是只来自主观 Review。

---

# 15. Reliability Dimensions

推荐：

```text
Acceptance Reliability
Arrival Reliability
On-time Reliability
Completion Reliability
Cancellation Reliability
Response Reliability
Evidence Reliability
```

---

# 16. System-derived vs User-derived

必须区分：

```text
SYSTEM_OBSERVED
USER_REPORTED
PLATFORM_VERIFIED
```

例如：

```text
GPS Check-in on time
```

比：

```text
Requester says on time
```

更强。

---

# 17. Reliability Summary

Requester Candidate View 可显示：

```text
96% on-time
18 completed tasks
2 repeat hires
```

而不是：

```text
Reliability Score 91
```

---

# 18. Context-specific Reliability

例如：

```text
Overall completion: 94%
Event Greeter completion: 99%
```

当前 Task 是 Event Greeter：

优先显示：

```text
99%
```

---

# 19. Capability Feedback

Review 可以反馈：

```text
Task-specific capability performance
```

例如：

```text
English communication
Event reception
Content delivery
```

但只能作用于：

```text
当前 Task 相关 Capability
```

---

# 20. Capability 不被情绪化差评直接删除

一条差评：

```text
does not revoke capability
```

系统要综合：

```text
verification
order outcome
multiple observations
```

---

# 21. Safety Feedback

Safety 是独立高敏域。

例如：

```text
Unsafe behavior
Harassment
Threat
Illegal request
Fraud
```

必须进入：

```text
Safety Review
```

而不是普通星级。

---

# 22. Safety Report ≠ Public Review

安全事件详情：

```text
not publicly visible by default
```

由 Risk / Safety 系统决定：

```text
restriction
suspension
investigation
```

---

# 23. Relationship Trust

一次成功合作后可以形成：

```text
Requester ↔ Agent
```

关系。

推荐对象：

```text
TrustedRelationship
```

---

# 24. TrustedRelationship Schema

```text
trusted_relationship_id

principal_type
principal_id

agent_id

relationship_type

status
created_from_order_id

created_at
updated_at
```

---

# 25. Relationship Type

推荐：

```text
TRUSTED_PROXY
PREFERRED_PROXY
BUSINESS_TRUSTED_TEAM
BLOCKED
DO_NOT_MATCH
```

---

# 26. Trusted Proxy

定义：

> Requester 主动保存、愿意未来优先复聘的真人 Agent。

它不是：

```text
平台自动授予的荣誉称号
```

---

# 27. Trusted Proxy 创建条件

必须至少：

```text
one successful Order
```

然后由 Requester：

```text
Save as Trusted Proxy
```

---

# 28. 不自动添加 Trusted Proxy

正式硬规则：

> **完成任务不等于自动建立长期关系。**

必须用户明确选择。

---

# 29. Trusted Proxy 的价值

以后 Repeat Task：

```text
Trusted Proxy first
↓
Availability Request / Direct Invite
↓
if unavailable
↓
Normal Matching
```

---

# 30. Trusted Proxy 不能绕过 Eligibility

即使是 Trusted：

如果：

```text
Capability expired
Role paused
Unavailable
Risk blocked
Schedule conflict
```

仍然：

```text
not eligible
```

---

# 31. Business Trusted Team

Business 可把成功合作 Agent 加入：

```text
Trusted Team
```

例如：

```text
Cafe A Trusted Team
├── Greeter An
├── Photographer Minh
└── Interpreter Linh
```

---

# 32. Trusted Team 是 Business Relationship

它不意味着：

```text
Agent 全平台排名更高
```

只增强：

```text
该 Business / Store 的 Repeat Matching
```

---

# 33. Trusted Team Scope

推荐支持：

```text
BUSINESS_LEVEL
STORE_LEVEL
ROLE_LEVEL
```

例如：

```text
Cafe A
Greeter Trusted Team
```

---

# 34. Repeat Task 主链

```text
Previous Completed Task
↓
Repeat
↓
New Draft
↓
Trusted Proxy / Trusted Team Check
↓
Availability
↓
Direct Invite
↓
Fallback Matching
```

---

# 35. Rehire Intent

Review 中最重要的问题之一：

```text
Would you hire this Proxy again?
```

结果：

```text
YES
MAYBE
NO
```

这是比“4.6 stars”更有业务价值的信号。

---

# 36. Repeat Relationship Signal

Matching 可以使用：

```text
Successful Prior Orders
Trusted Relationship
Rehire Intent
Same Venue Experience
Same Business Experience
```

---

# 37. Repeat 不造成锁死

平台不能因为：

```text
Requester 一直用熟人
```

就完全关闭新 Agent 入口。

当：

```text
Trusted unavailable
or
Requester chooses explore
```

正常 Matching 继续工作。

---

# 38. Relationship Confidence

P1 可以内部计算：

```text
repeat_count
completion_rate
recent_success
```

但不需要公开一个：

```text
Relationship Score
```

---

# 39. Requester Trust

Agent 也需要知道：

> 这个 Requester / Business 值不值得接。

---

# 40. Requester Trust Inputs

可以包括：

```text
KYC / Business Verification
Funding Success
Task Accuracy
Cancellation Behavior
Requester No-show
Scope Change Behavior
Safety Reports
Dispute Pattern
```

---

# 41. Requester Trust Level

继续沿用：

```text
R0
R1
R2
R3
R-X
```

具体含义可在 Safety / Trust Policy 单独配置。

---

# 42. Agent-facing Requester Trust

Offer Card 可以显示：

```text
Verified Business
12 completed tasks
Low cancellation history
Payment Protected
```

不显示内部 Risk Score。

---

# 43. Business Reputation

Business Reputation 不只来自消费者评价。

Human Agent Marketplace 需要：

```text
Agent-side work experience
```

例如：

```text
Scope accuracy
Payment reliability
Access clarity
Safety
```

---

# 44. Reviewer Eligibility

只有：

```text
Order participant
```

才能评价该 Order。

禁止：

```text
没交易也评论真人
```

---

# 45. One Order, One Review per Side

默认：

```text
one requester-side review
one agent-side review
```

多人 Business 可由：

```text
authorized DRI
```

提交。

---

# 46. Review Edit

提交后：

可在短时间内：

```text
edit
```

到期后锁定。

安全举报不受普通 Review Edit Window 限制。

---

# 47. Review Comment

文字评论：

```text
optional
```

并经过：

```text
moderation
privacy filter
```

---

# 48. 禁止评价无关个人属性

Review UI 不提供：

```text
Looks
Body
Attractiveness
Dating vibe
Personality popularity
```

等维度。

---

# 49. Role-specific Review

不同 Role 可以增加任务相关项。

例如 Interpreter：

```text
Language Accuracy
Communication
```

Creator：

```text
Deliverable Quality
On-time Delivery
```

Greeter：

```text
Guest Reception
Professional Conduct
```

---

# 50. Dynamic Review Template

由：

```text
Scenario
Role
Capability Graph
```

驱动。

---

# 51. Review 不成为敏感属性代理

例如：

```text
“形象好”
```

这种自由文本不能自动转成：

```text
Appearance Score
```

用于全站 Ranking。

---

# 52. Rating Aggregation

如果保留 UI 星级：

建议只作为：

```text
secondary summary
```

而不是核心 Matching Signal。

甚至 P0 可以完全不显示全局五星。

---

# 53. 推荐 P0

Candidate View：

```text
18 completed tasks
96% on-time
4 repeat hires
Strong role outcome
```

比：

```text
4.9 ★
```

更适合 Proxy。

---

# 54. Outcome Graph

Review 只是 Outcome Graph 的一个输入。

完整：

```text
Task
× Slot
× Agent
× Context
× System Evidence
× Review
× Repeat
```

---

# 55. Outcome Record

推荐：

```text
OutcomeRecord
```

Schema：

```text
outcome_id
order_id

role_id
scenario_id
industry_id

completion_status
on_time
cancelled
no_show

requester_review_summary
agent_review_summary

rehire_intent
repeat_created

computed_at
```

---

# 56. Outcome Confidence

来源不同：

```text
SYSTEM_HIGH
MULTI_SOURCE_HIGH
USER_ONLY_MEDIUM
DISPUTED_LOW
```

---

# 57. Disputed Review

如果该 Order 有开放争议：

Review 可以：

```text
SUBMITTED
```

但公开展示可暂时：

```text
WITHHELD
```

避免争议未结论就污染长期信誉。

---

# 58. Dispute Resolution 后

Review 不一定删除。

系统可以：

```text
publish
limit
annotate internally
remove if abusive / false
```

---

# 59. Revenge Review

如果一方：

```text
提出退款失败
↓
马上恶意差评
```

系统可根据：

```text
timing
language
dispute context
```

进入 Moderation。

不能自动删除真实负面反馈。

---

# 60. Review Abuse

包括：

```text
Harassment
Threat
Personal data exposure
Discrimination
Extortion
Retaliation
Fake review
```

---

# 61. Rating Extortion

例如：

```text
“不给我退款我就给你差评”
```

必须支持：

```text
Report Review Abuse
```

---

# 62. Review Moderation

状态：

```text
NORMAL
FLAGGED
UNDER_REVIEW
LIMITED
REMOVED
```

---

# 63. Review Removal

只在：

```text
policy violation
fake
privacy breach
harassment
```

等情况下删除。

不能因为：

```text
Business 不喜欢负面评价
```

就删。

---

# 64. New Agent Fairness

没有历史 Outcome 的 Agent：

```text
not bad
```

只是：

```text
less observed
```

---

# 65. 新 Agent 展示

```text
New Qualified
Identity Verified
Capabilities Verified
Portfolio Available
```

而不是：

```text
No rating
0 stars
```

---

# 66. Bayesian / Confidence-aware Aggregation

P1 内部推荐使用：

```text
sample-size-aware
confidence-aware
```

聚合。

避免：

```text
1 次 5 星
>
100 次 4.8 星
```

这种简单平均。

---

# 67. Small Sample Guard

Candidate UI：

```text
2 completed tasks
```

不要显示：

```text
100% completion
```

却不说明样本太少。

---

# 68. Recency

长期信誉必须考虑：

```text
recent outcomes
```

例如：

```text
last 20 relevant tasks
```

比十年前历史更有价值。

---

# 69. Severe Event Override

严重：

```text
fraud
safety incident
no-show pattern
```

可能进入：

```text
Risk / Restriction
```

而不是只让平均分下降 0.1。

---

# 70. No-show Signal

Agent No-show：

属于：

```text
Reliability + Risk input
```

Requester No-show：

属于 Requester Trust。

不能混淆。

---

# 71. Cancellation Context

Agent 因：

```text
unsafe task
material mismatch
platform failure
```

取消，

不能算成普通 Agent Cancellation Reliability 负面。

---

# 72. Outcome Reason Codes

必须结构化：

```text
AGENT_FAULT
REQUESTER_FAULT
PLATFORM_FAULT
EXTERNAL_CAUSE
MUTUAL
UNKNOWN
```

---

# 73. Trusted Proxy Removal

Requester 可以：

```text
Remove from Trusted Proxy
```

不需要解释。

---

# 74. Block

如果不想再匹配：

```text
Do Not Match Again
```

与：

```text
Safety Block
```

分开。

---

# 75. Do Not Match Again

普通关系偏好：

```text
private
```

不会公开伤害 Agent 全局信誉。

---

# 76. Safety Block

如果涉及安全：

```text
report
review
risk system
```

处理。

---

# 77. Agent-side Block

Agent 也可以：

```text
Do not receive tasks from this Requester / Business again
```

属于私人 Supply Policy。

---

# 78. Mutual Repeat

双方都表达：

```text
Would work together again = YES
```

可以形成：

```text
Strong Repeat Relationship
```

但仍需要一方主动创建 Trusted Relationship。

---

# 79. Repeat CTA

Order 完成页：

Requester：

```text
[ Save as Trusted Proxy ]
[ Repeat this task ]
```

Agent：

```text
[ Accept future invites from this Business ]
```

---

# 80. Repeat Template

Trusted Relationship 应和：

```text
TaskTemplate
```

联动。

例如：

```text
Weekend Greeter Template
Preferred:
An
Minh
```

---

# 81. Preferred Agent 不强绑

Template 里只能保存：

```text
preferred_agent_ids
```

不是：

```text
auto_assigned_agent_ids
```

---

# 82. Business Team Slot Filling

未来 Business：

```text
5 Greeters needed
```

系统：

```text
Trusted Team available = 3
Remaining = 2
```

然后：

```text
3 Trusted Direct Invite
+
2 Marketplace Match
```

这是非常重要的 B 端重复成交能力。

---

# 83. Repeat Fill Rate

核心 Business 指标：

```text
Trusted Team Fill Rate
```

例如：

```text
60% filled from Trusted Team
40% marketplace
```

---

# 84. Agent Benefit

成为某 Business Trusted Team 后：

可以获得：

```text
Repeat Invites
More predictable work
Lower matching friction
```

这强化：

```text
earnings stability
```

---

# 85. Requester Benefit

Requester：

```text
less browsing
less uncertainty
faster repeat
```

符合：

> Minimize People Browsing.

---

# 86. Marketplace Benefit

Trusted Relationship 不减少 Marketplace 价值。

反而平台继续提供：

```text
Availability
Payment
Replacement
Evidence
Dispute
Billing
History
```

---

# 87. Relationship Portability

Trusted Proxy 是：

```text
principal-specific
```

例如：

```text
User A trusts Agent X
```

不能推导：

```text
everyone trusts Agent X
```

---

# 88. Business Trusted Team 隔离

Business A 的 Trusted：

不自动成为：

```text
Business B Trusted
```

---

# 89. Global Signal

可以使用：

```text
repeat hire count
```

作为通用 Outcome Signal。

但不泄露：

```text
具体哪个私人 Requester
```

---

# 90. Review Privacy

公开评论不得暴露：

```text
exact private venue
phone
legal identity
private conversation
sensitive task context
```

---

# 91. Anonymous Display

Requester Review 可以展示：

```text
Verified Business
Individual Requester
```

而不是完整私人身份。

---

# 92. Business Public Review

如果 Business 愿意：

可以显示：

```text
Completed with Bonsaidon
```

前提：

```text
Business visibility permission
```

---

# 93. Agent Portfolio Link

成功 Order：

若双方授权：

可以生成：

```text
Verified Work Experience
```

进入 Agent Passport。

---

# 94. Verified Work Experience

例如：

```text
Grand Opening Greeter
Verified by Proxy
Completed
```

但不一定公开 Business 名。

---

# 95. Trust API

推荐：

```text
POST /orders/{id}/reviews
POST /relationships/trusted-proxy
DELETE /relationships/{id}
POST /relationships/{id}/block
GET /principals/{id}/trusted-proxies
```

---

# 96. Outcome API

内部：

```text
POST /outcomes/compute
GET /agents/{id}/task-context-outcome
```

Candidate API 仍需要：

```text
task_id
slot_id
```

---

# 97. Review Audit

记录：

```text
reviewer
order
original submission
edits
moderation
publication
removal
```

---

# 98. Relationship Audit

记录：

```text
created_from_order
principal
agent
created
removed
blocked
```

---

# 99. Metrics — Review

```text
Review Completion Rate
Requester Review Rate
Agent Review Rate
Rehire Intent YES Rate
Review Abuse Rate
```

---

# 100. Metrics — Trust

```text
Trusted Proxy Creation Rate
Trusted Team Creation Rate
Repeat Invite Rate
Repeat Acceptance Rate
Repeat Completion Rate
```

---

# 101. Metrics — Repeat

```text
Rehire Rate
Repeat Task Rate
Trusted Fill Rate
Time to Fill Repeat Task
```

---

# 102. Metrics — Marketplace Fairness

```text
New Agent First Order Rate
New Qualified Exposure
Repeat Concentration
Top Agent Order Concentration
```

---

# 103. Guardrail Metrics

必须监控：

```text
Rating retaliation
Dispute-correlated review abuse
Safety report suppression
New agent starvation
Trusted team lock-in
Review privacy leak
```

---

# 104. P0 必须实现

```text
Structured bilateral review
Rehire Intent
System-derived reliability
Task-specific outcome summary
Trusted Proxy
Business Trusted Team
Do Not Match Again
Agent-side Block
Repeat CTA
Trusted direct invite
OutcomeRecord
Review Moderation
Audit
```

---

# 105. P1

```text
Blind Review
Confidence-aware aggregation
Advanced Business Reputation
Relationship strength
Review NLP abuse assist
Verified Work Experience cards
Advanced repeat team filling
```

---

# 106. Acceptance Criteria

## AC-TRUST-01
评价必须绑定真实 Order。

## AC-TRUST-02
非交易参与者不得评价真人 Agent。

## AC-TRUST-03
Capability / Reliability / Safety / Relationship 必须分离。

## AC-TRUST-04
P0 不应依赖单一五星作为核心信誉。

## AC-TRUST-05
Review 不得阻塞 Agent Settlement。

## AC-TRUST-06
Requester 未评价不得视为负面。

## AC-TRUST-07
Reliability 必须优先使用系统履约事实。

## AC-TRUST-08
Context-specific Outcome 必须优先于无上下文全局评分。

## AC-TRUST-09
一条主观差评不得自动撤销 Verified Capability。

## AC-TRUST-10
Safety Feedback 必须进入独立 Safety / Risk 流程。

## AC-TRUST-11
Safety Report 详情不得默认公开。

## AC-TRUST-12
Trusted Proxy 必须由成功 Order 后显式创建。

## AC-TRUST-13
成功 Order 不得自动建立 Trusted Proxy。

## AC-TRUST-14
Trusted Proxy 不得绕过当前 Eligibility。

## AC-TRUST-15
Business Trusted Team 必须是 Business-specific Relationship。

## AC-TRUST-16
Business A 的 Trusted Team 不得自动共享给 Business B。

## AC-TRUST-17
Repeat Task 必须重新检查 Availability / Risk / Capability。

## AC-TRUST-18
Requester Trust 必须包含 Task Accuracy / Cancellation / Payment / Safety 等真人交易信号。

## AC-TRUST-19
Agent 必须有评价 Requester / Business 的权利。

## AC-TRUST-20
Review UI 不得提供 Looks / Attractiveness 等无关评分维度。

## AC-TRUST-21
Role-specific Review 只能使用当前任务相关维度。

## AC-TRUST-22
Content Popularity 不得直接进入 Human Execution Reliability。

## AC-TRUST-23
新 Agent 无历史不得等同于低质量。

## AC-TRUST-24
必须支持 New Qualified。

## AC-TRUST-25
小样本信誉展示必须避免误导。

## AC-TRUST-26
严重 Safety / Fraud 应走 Risk Override，而不是只影响平均分。

## AC-TRUST-27
Agent 因 Unsafe Task / Material Mismatch 取消不得错误计为普通 Agent Fault。

## AC-TRUST-28
Do Not Match Again 必须是私人关系偏好，不自动污染全局信誉。

## AC-TRUST-29
双方 Block 必须互相独立。

## AC-TRUST-30
Trusted Relationship 必须支持删除。

## AC-TRUST-31
Business Repeat Task 必须可以先填 Trusted Team，再由 Marketplace 补缺口。

## AC-TRUST-32
Preferred Agent 不等于 Auto-assigned Agent。

## AC-TRUST-33
公开 Review 不得泄露私人 Task / Venue / Contact。

## AC-TRUST-34
Outcome 必须回流 Capability Passport 与 Matching。

## AC-TRUST-35
Trust 系统最终优化 Repeat Successful Human Execution，而不是星级数量。

---

# 107. 本章锁定结论

1. **Proxy 的评价核心不是五星，而是结构化 Human Execution Outcome。**
2. **Capability、Reliability、Safety、Relationship、Popularity 必须分开。**
3. **Reliability 优先使用真实系统事实，不只靠主观打分。**
4. **评价是双向的，Agent 也必须评价 Requester / Business。**
5. **Trusted Proxy 是成功履约后由 Requester 主动建立的复聘关系。**
6. **Business Trusted Team 是 B 端长期供给资产，但只属于该 Business / Store。**
7. **Trusted 不得绕过当前 Eligibility / Availability / Risk。**
8. **Repeat Task 应优先尝试 Trusted，再由 Marketplace 补缺口。**
9. **Do Not Match Again 与 Safety Block 必须分开。**
10. **新 Agent 无历史不是低质量，必须保留 New Qualified 与 Exploration。**
11. **差评、争议、安全事件不能互相粗暴混成一个分数。**
12. **Outcome Graph 继续作为长期数据真相。**
13. **Trust 系统的最终目标是更快、更稳的 Repeat Successful Human Execution。**

---

# 108. 下一章

下一份增量 PRD：

> **Chapter 13 — Safety / Risk / Identity Trust / Incident Center**

重点解决：

```text
真人线下执行怎么保护双方
Requester / Agent 风险等级怎么做
哪些 Task 要额外审核
SOS / Incident 怎么进入平台
危险任务怎么停止
骚扰 / 欺诈 / 非法需求怎么处理
KYC、Trust、Risk 为什么必须继续分离
Temporary Location / Emergency Contact 怎么治理
Operator 怎么介入
```

这会把真人 Marketplace 最关键的安全底座正式补齐。

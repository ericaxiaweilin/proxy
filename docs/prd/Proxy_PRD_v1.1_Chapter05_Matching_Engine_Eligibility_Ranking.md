# Proxy PRD v1.1
## Chapter 05 — Matching Engine / Eligibility & Ranking

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 02 — Capability Graph
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 04 — Requester Demand Builder

**本章范围**：
- Matching Pipeline
- Eligibility
- Hard Constraints
- Qualified Candidate Pool
- Ranking
- Availability
- Distance / ETA
- Reliability
- Outcome History
- Repeat Relationship
- New Agent Exploration
- Exposure Fairness
- Workload / Capacity
- Agent Preferences
- Sponsored / Boost Adjustment
- Candidate Set Construction
- Explainability
- Privacy / Anti-browsing
- Matching Audit
- Model / Rule Boundary

**本章不细化**：
- Offer dispatch timing
- First-accept race
- Offer timeout
- Batch wave algorithm
这些放到下一章 Fast Match / Offer Engine。

---

# 1. 本章目标

Proxy Matching Engine 必须回答两个完全不同的问题：

## Question A — Eligibility

> 这个真人 Agent 有没有资格进入这个 TaskSlot 的候选池？

结果只有：

```text
ELIGIBLE
INELIGIBLE
UNKNOWN / NEEDS_VERIFICATION
```

---

## Question B — Ranking

> 在所有合格真人里，谁对当前 TaskSlot 更合适？

结果：

```text
ranked qualified candidates
```

正式硬规则：

> **Eligibility 和 Ranking 必须分层。**

不能把：

```text
“不满足 Must-have”
```

理解成：

```text
“只是分数低一点”
```

---

# 2. 总 Matching Pipeline

标准主链：

```text
TaskSlot
↓
Requirement Resolution
↓
Safety / Permission Gate
↓
Agent Supply Eligibility
↓
Capability Eligibility
↓
Availability Eligibility
↓
Time / Location Feasibility
↓
Conflict Check
↓
Qualified Candidate Pool
↓
Organic Ranking
↓
Sponsored Adjustment
↓
Candidate Set Construction
↓
Invite / Offer Engine
```

---

# 3. 一条最重要的原则

> **Agent 可以付费获得更多曝光，但不能付费购买 Qualification。**

因此：

```text
Hard Eligibility
→ Safety
→ Availability
→ Task Fit
→ Organic Ranking
→ Sponsored Adjustment
→ Candidate Set
```

Boost 永远在：

```text
Eligibility
```

之后。

---

# 4. Matching Unit

Matching Engine 的输入单位不是：

```text
Task
```

而是：

```text
TaskSlot
```

因为：

```text
Greeter ×3
```

内部有：

```text
slot_g1
slot_g2
slot_g3
```

每个 Slot 都可能：

- 匹配不同 Agent；
- 不同状态；
- Replacement；
- 不同 Offer History。

---

# 5. Matching Context

推荐：

```json
{
  "task_id": "task_001",
  "slot_id": "slot_g1",
  "role_id": "GREETER",
  "task_version": 3,
  "slot_version": 2,
  "graph_version": "v12",
  "principal_type": "BUSINESS",
  "principal_id": "biz_001",
  "time_window": {},
  "location": {},
  "must_have": [],
  "nice_to_have": [],
  "budget": {},
  "match_mode": "CURATED_MATCH",
  "requester_trust": "R2",
  "risk_context": {}
}
```

Matching 结果必须绑定这个版本。

---

# 6. Eligibility 定义

Eligibility 是：

> **当前 Agent 是否满足当前 TaskSlot 的所有不可妥协条件。**

它不是一个 Score。

正确：

```text
eligible = all mandatory gates pass
```

错误：

```text
eligible = score > 70
```

---

# 7. Eligibility Gate 分类

推荐至少包含：

```text
ACCOUNT
RISK
ROLE
CAPABILITY
VERIFICATION
AVAILABILITY
TIME
LOCATION
SCHEDULE_CONFLICT
LEGAL
BUSINESS_POLICY
AGENT_PREFERENCE
TASK_SPECIFIC
```

---

# 8. Account Eligibility

必须：

```text
AgentProfile exists
Agent status ACTIVE
User account ACTIVE
Payout / transaction readiness where required
```

Agent：

```text
PAUSED
SUSPENDED
BANNED
```

不能进入正常候选池。

---

# 9. Risk Eligibility

如果：

```text
risk_status = RESTRICTED / SUSPENDED
```

则按平台策略：

```text
INELIGIBLE
```

高风险 Task 可能需要：

```text
extra verification
```

---

# 10. Role Eligibility

Agent 必须：

```text
AgentRole.status = ACTIVE
```

并满足当前 Role 的基本要求。

系统推导的：

```text
SUGGESTED
```

Role 在 Agent 未确认前：

```text
not eligible for live work
```

---

# 11. Capability Eligibility

所有：

```text
Must-have Capability
```

必须满足。

例如：

```text
LANG_EN_B2
DRIVING_LICENSE
ON_CAMERA
```

其中任一个不满足：

```text
INELIGIBLE
```

---

# 12. Capability Comparator

Requirement 必须支持：

```text
EQUAL
AT_LEAST
AT_MOST
IN
EXISTS
VERIFIED
```

例如：

```text
LANG_EN >= B2
```

---

# 13. Verification Eligibility

Requester 可以要求：

```text
English B2 VERIFIED
```

Agent 只有：

```text
SELF_REPORTED
```

则：

```text
Capability exists
but
Eligibility fails verification gate
```

---

# 14. Verification Unknown

如果：

```text
Capability verification pending
```

推荐：

```text
NEEDS_VERIFICATION
```

不是直接算 Qualified。

Matching Engine 可以：

```text
request verification
```

但不能先推荐给 Requester 作为已合格候选。

---

# 15. Availability Eligibility

Agent 必须满足：

```text
availability covers required execution window
```

来源：

```text
Scheduled Availability
Available Now
Explicit Offer Availability
Trusted Proxy direct availability
```

---

# 16. Partial Availability

例如：

```text
Task 18:00–22:00
Agent available 18:00–20:00
```

如果 Task 要求：

```text
full duration
```

则：

```text
INELIGIBLE
```

除非 Task 明确允许：

```text
partial shift
```

---

# 17. Arrival Feasibility

不能只看：

```text
Agent is free
```

还要检查：

```text
Can agent realistically arrive by arrival_target?
```

输入：

```text
current / planned area
distance
ETA
travel buffer
```

---

# 18. Location Eligibility

可能包含：

```text
work radius
allowed city
agent travel preference
venue restriction
legal geography
```

Agent 明确：

```text
will not travel > 5 km
```

Requester 搜索半径：

```text
15 km
```

不能强行推荐。

---

# 19. Schedule Conflict

同一真人默认：

```text
cannot execute overlapping physical Orders
```

因此：

```text
confirmed schedule conflict
→ INELIGIBLE
```

---

# 20. Buffer Between Tasks

推荐支持：

```text
travel_buffer
```

例如：

```text
Task A ends 17:30
Task B starts 18:00
distance = 12km
```

即使时间不直接重叠，也可能：

```text
not feasible
```

---

# 21. Legal Eligibility

例如：

```text
Age-restricted role
Driving license
Professional license
Work authorization
```

必须在 Eligibility 层处理。

---

# 22. Business Policy Eligibility

某些 Business 可以设置：

```text
verified only
trusted only
business-approved pool
```

但必须遵守平台政策，不能任意增加不合法歧视条件。

---

# 23. Agent Preference Eligibility

Agent 可以设置：

```text
Min Pay
Max Distance
Preferred Role
Blocked Business
Blocked Venue
Unavailable Category
```

其中部分是硬 Gate。

例如：

```text
Min Pay = 600k
Task pays = 400k
```

则：

```text
INELIGIBLE
```

---

# 24. Agent Preference ≠ Requester Filter

Agent 的私人偏好是 Supply-side policy。

Requester 不需要看到：

```text
why Agent declined category
```

Matching Engine 只返回：

```text
not qualified / not available
```

必要时用聚合说明。

---

# 25. Sensitive Attribute Eligibility

只有 Requirement 已经过：

```text
Policy Gate
```

并且 Task 允许使用时，才可以进入 Eligibility。

Matching Engine 不能自己重新开启敏感筛选。

---

# 26. Social Eligibility

例如：

```text
Task requires:
TikTok Connected
```

则：

```text
SocialAccountConnection ACTIVE
+
required verification
```

才满足。

Followers 等动态 Metric 必须：

```text
fresh enough
+
source trusted
```

---

# 27. Data Freshness Eligibility

部分数据有时效性。

例如：

```text
Social Metrics
License
Availability
Location
```

如果：

```text
stale beyond policy
```

不能当成强证明。

---

# 28. Eligibility Result

推荐结构：

```json
{
  "agent_id": "agent_123",
  "slot_id": "slot_g1",
  "status": "ELIGIBLE",
  "gate_results": [
    {
      "gate": "CAPABILITY",
      "status": "PASS"
    },
    {
      "gate": "AVAILABILITY",
      "status": "PASS"
    }
  ],
  "evaluated_at": "...",
  "task_version": 3,
  "slot_version": 2
}
```

---

# 29. Ineligibility Reason

内部必须有精确原因：

```text
MISSING_CAPABILITY
INSUFFICIENT_LEVEL
VERIFICATION_REQUIRED
NOT_AVAILABLE
ETA_TOO_LONG
SCHEDULE_CONFLICT
BELOW_MIN_PAY
AGENT_BLOCK
RISK_BLOCK
LICENSE_EXPIRED
```

---

# 30. Requester 不一定看到完整拒绝原因

为了隐私：

内部：

```text
AGENT_BLOCKED_THIS_BUSINESS
```

Requester 可以只看到：

```text
Not available for this task
```

---

# 31. Qualified Candidate Pool

只有：

```text
Eligibility = ELIGIBLE
```

才进入：

```text
Qualified Candidate Pool
```

此时仍然不是最终 Candidate Set。

---

# 32. Pool Size

Qualified Pool 可以很大：

```text
100+
```

但 Requester 不能看到全部。

Ranking Engine 负责：

```text
有限候选集
```

---

# 33. Organic Ranking

Organic Ranking 只在 Qualified Pool 内运行。

目标：

> **最大化当前 TaskSlot 成功履约概率，同时兼顾质量、响应效率、长期 Marketplace 健康。**

---

# 34. Ranking Signal 分类

推荐：

```text
TASK_FIT
ACCEPTANCE_PROBABILITY
ARRIVAL_FEASIBILITY
RELIABILITY
OUTCOME_HISTORY
REPEAT_RELATIONSHIP
PRICE_FIT
AGENT_PREFERENCE_FIT
WORKLOAD
EXPOSURE_FAIRNESS
NEWCOMER_EXPLORATION
CONTEXTUAL_QUALITY
```

---

# 35. Task Fit

衡量：

```text
Nice-to-have satisfaction
Capability strength
Role experience
Industry experience
Relevant portfolio
Relevant verification
```

注意：

Must-have 已经在 Eligibility 处理。

不能重复把 Must-have 当加分无限放大。

---

# 36. Acceptance Probability

如果 Agent 经常：

```text
decline this role
ignore offers
unavailable in this time window
```

则 Acceptance Probability 可以下降。

但不能因一次合理 Decline 过度惩罚。

---

# 37. Arrival Feasibility Score

可以考虑：

```text
ETA
distance
travel reliability
location confidence
arrival buffer
```

例如：

```text
ETA 8 min
```

通常优于：

```text
ETA 45 min
```

但 Curated Match 不一定把距离作为第一优先。

---

# 38. Reliability

推荐拆：

```text
Acceptance Reliability
Arrival Reliability
Completion Reliability
Cancellation Reliability
Evidence Reliability
```

而不是一个黑盒：

```text
Trust Score 83
```

---

# 39. Outcome History

这是 Proxy 长期最重要的 Ranking Signal。

必须尽量 Context-specific。

例如：

```text
F&B
Grand Opening
Greeter
English
```

中的真实历史结果，比全局星级更重要。

---

# 40. Outcome Context Similarity

推荐：

```text
same role
same scenario
same industry
same time pattern
same business
same venue
```

相似度越高：

```text
historical outcome relevance
```

越高。

---

# 41. Repeat Relationship

如果 Requester / Business 与 Agent 过去成功合作：

```text
Trusted Proxy
Trusted Team
Repeat
```

可以明显提高 Ranking。

但必须仍满足：

```text
Current Eligibility
```

---

# 42. Repeat 不能绕过 Availability

即使 Agent 是：

```text
Trusted Proxy
```

如果当前没空：

```text
INELIGIBLE
```

---

# 43. Price Fit

如果 Task Budget：

```text
600k
```

Agent preferred pay：

```text
550k
```

Fit 较好。

如果 Agent 虽然最低要求符合，但价格偏好远高：

```text
acceptance probability
```

可能下降。

---

# 44. Workload

避免把所有 Task 都压给少数明星 Agent。

Signal：

```text
current active orders
upcoming workload
recent hours
fatigue risk
```

用于：

```text
quality
safety
marketplace distribution
```

---

# 45. Exposure Fairness

长期平台不能形成：

```text
Top 20 agents get 95% exposure
```

否则新供给永远活不起来。

需要：

```text
Exposure Fairness
```

但不能为了公平把明显更差的人硬推第一。

---

# 46. Newcomer Exploration

新 Agent 没有历史 Outcome。

如果完全依赖历史：

```text
new agent can never get first task
```

因此必须有：

```text
Exploration Budget
```

---

# 47. Newcomer Qualification

Newcomer Exploration 只适用于：

```text
Eligible
+
Verified enough
+
Safe
```

的新 Agent。

不是：

```text
没验证也给机会
```

---

# 48. Exploration Slot

Candidate Set 可以保留少量：

```text
New Qualified
```

候选。

例如：

```text
Top Organic ×4
Strong Repeat ×1
New Qualified ×1
Sponsored Qualified ×1
```

具体配额由实验决定。

---

# 49. Agent Preference Fit

Agent 明确偏好：

```text
F&B events
Weekend afternoon
Tây Hồ
```

当前 Task 刚好匹配：

Ranking 可以提高。

这有助于：

```text
Acceptance
Retention
```

---

# 50. Contextual Quality

例如：

```text
Business-facing role
```

可能重视：

```text
professional background
communication
relevant portfolio
```

而：

```text
Queue Proxy
```

更重视：

```text
arrival feasibility
availability
reliability
```

所以 Ranking 权重必须：

```text
Role / Scenario configurable
```

---

# 51. Ranking Profile

推荐：

```text
RankingProfile
```

例如：

```text
FAST_SIMPLE
BRAND_FACING
PROFESSIONAL
CREATOR
REPEAT_FIRST
```

---

# 52. Fast Simple Profile

高权重：

```text
Availability
ETA
Acceptance Probability
Reliability
```

低权重：

```text
Portfolio
Long profile history
```

---

# 53. Brand-facing Profile

高权重：

```text
Relevant Capability
Relevant Outcome
Presentation
Portfolio
Reliability
```

---

# 54. Professional Profile

高权重：

```text
Verification
Professional Background
Relevant Outcome
Repeat Relationship
```

---

# 55. Creator Profile

高权重：

```text
Channel Fit
Relevant Portfolio
Content Outcome
Social Verification
```

不能：

```text
Follower count dominates everything
```

---

# 56. Organic Score

不要求 PRD 现在锁死具体数值公式。

推荐抽象：

```text
OrganicScore =
TaskFit
+ Acceptance
+ Arrival
+ Reliability
+ Outcome
+ Repeat
+ PreferenceFit
+ Fairness
+ Exploration
- WorkloadPenalty
```

具体权重：

```text
configurable
versioned
experimentable
```

---

# 57. 不允许的 Ranking Signal

默认禁止：

```text
beauty score
race
religion
political belief
sexual orientation
irrelevant gender
irrelevant age
raw social popularity
personal wealth
```

---

# 58. Sponsored / Boost

Boost 保留为平台收入能力。

定义：

> **Qualified Agent 购买在相关 Task Context 中更高的曝光概率。**

不是：

> 花钱把自己变成 Qualified。

---

# 59. Sponsored Eligibility

进入 Sponsored Adjustment 前必须：

```text
ELIGIBLE
SAFE
AVAILABLE
TASK_RELEVANT
BOOST_SCOPE_MATCHES
```

---

# 60. Boost Scope

产品可以：

```text
1-day Boost
3-day Boost
7-day Boost
Role Boost
Area Boost
Demand Window Boost
```

例如：

```text
Role = UGC Creator
Area = Tây Hồ
18:00–22:00
```

---

# 61. Sponsored Adjustment

推荐：

```text
Organic Ranking
↓
Sponsored Adjustment
↓
Candidate Set
```

不是：

```text
Sponsored first
↓
Eligibility later
```

---

# 62. Sponsored Cap

正式建议：

```text
Sponsored candidates <= 20–30% of visible Candidate Set
```

MVP 可以先：

```text
max 2 sponsored positions
```

具体后续实验。

---

# 63. First Slot Protection

Curated Candidate Set：

```text
#1
```

建议默认：

```text
Organic Best Match
```

不出售。

---

# 64. Sponsored Label

Requester 必须看到：

```text
Sponsored
```

不能伪装成：

```text
Best Match
```

---

# 65. Sponsored 不改变 Match Reason

例如：

```text
Why matched:
English B2
12 Event Tasks
Available
2.3km away

Sponsored
```

Sponsored 是额外标签。

---

# 66. Boost Abuse Protection

如果 Agent：

```text
high cancellation
risk watch
low reliability
```

平台可以：

```text
disable boost eligibility
```

即使已付款也按产品规则退款 / 暂停。

---

# 67. Candidate Set

Requester 不看整个 Qualified Pool。

系统生成有限：

```text
Candidate Set
```

---

# 68. Candidate Set Size

Curated Match：

推荐：

```text
initial 4–8
```

后续：

```text
max 3 batches
```

避免无限浏览。

---

# 69. Candidate Set Composition

示例：

```text
#1 Organic Best Match
#2 Organic Strong
#3 Repeat / Trusted
#4 Organic
#5 Sponsored Qualified
#6 New Qualified Exploration
```

顺序可以实验。

---

# 70. No Infinite Scroll

正式硬规则：

```text
No endless candidate feed
```

用户看完当前 Batch 后：

```text
Invite
Expand
Adjust Task
Request next finite batch
```

---

# 71. Batch Diversity

Candidate Set 不应该全是：

```text
同一种历史强者
```

可以保证适度：

```text
experience diversity
price diversity
distance diversity
newcomer exploration
```

但不能违反 Task Fit。

---

# 72. Candidate Duplication

同一个 Agent：

```text
one slot batch
```

只出现一次。

---

# 73. Multi-slot Matching

对于：

```text
Greeter ×3
```

不能简单：

```text
每个 Slot 独立都把 An 排第一
```

需要考虑：

```text
agent capacity
already selected sibling slot
team diversity
schedule
```

---

# 74. Multi-slot Allocation

在同一 Task 内：

如果 Agent 已经：

```text
assigned slot_g1
```

且时段完全重叠，

则：

```text
ineligible for slot_g2
```

---

# 75. Team Compatibility

P1 可以增加：

```text
Team Composition
```

例如：

```text
3 Greeters
```

系统可能偏好：

```text
1 experienced lead
2 normal qualified
```

但 P0 不必复杂化。

---

# 76. Candidate Visibility Level

Matching Engine 输出：

```text
agent_id
rank
match_reason_codes
visibility_level
fields_allowed
```

真正字段由：

```text
Progressive Disclosure
```

系统裁剪。

---

# 77. Candidate Card Priority

默认展示顺序：

```text
Why Matched
Availability
Reliability
Capability
Relevant Outcome
Price
Approx Distance / ETA
Identity last
```

不是：

```text
大头像
年龄
性别
长简介
```

---

# 78. Match Reason

每个 Candidate 至少返回 2–4 个可解释原因。

例如：

```text
✓ English B2 verified
✓ 9 similar event tasks
✓ 96% on-time
✓ Available for full shift
```

---

# 79. 不显示黑盒分数

Requester 不需要看到：

```text
Match Score = 87.42
```

建议显示：

```text
Strong Match
Good Match
Qualified
```

以及原因。

---

# 80. Agent 端 Match Explanation

Agent 收到 Offer 时也可以看到：

```text
Why this matches you:
- Event Greeter
- English B2
- 3.2 km
- Fits your availability
```

增强信任。

---

# 81. Rank Stability

短时间内同一 Slot：

```text
rank should not wildly change
```

除非：

```text
availability changes
agent accepts another order
distance / ETA changes materially
task changes
boost starts / expires
```

---

# 82. Rank Version

推荐：

```text
ranking_version
```

记录：

```text
profile
weights
feature version
model version
```

便于审计。

---

# 83. Matching Snapshot

每次生成 Candidate Set：

```text
MatchSnapshot
```

包含：

```text
task_version
slot_version
graph_version
ranking_version
qualified_count
candidate_ids
reason_codes
sponsored_flags
generated_at
```

---

# 84. Stale Match

如果：

```text
TaskSlot.slot_version changed
```

旧 Candidate Set：

```text
STALE
```

不能继续 Invite。

---

# 85. Availability Change

Agent 变为：

```text
PAUSED
Unavailable
Accepted conflicting order
```

则旧 Candidate：

```text
invalidate
```

---

# 86. Eligibility Cache

可以缓存，但必须：

```text
TTL
version-bound
```

特别是：

```text
availability
schedule
risk
```

不能长时间缓存。

---

# 87. Re-ranking

触发：

```text
Task changed
Slot reopened
Agent availability changed
New supply enters
Replacement needed
Boost status changed
```

---

# 88. Replacement Ranking

Replacement TaskSlot 应提高：

```text
arrival feasibility
acceptance probability
reliability
```

权重。

因为：

```text
time is more critical
```

---

# 89. Emergency Replacement

如果离 Start：

```text
< critical window
```

可以使用：

```text
URGENT_REPLACEMENT profile
```

但仍不能放松：

```text
hard eligibility
safety
```

---

# 90. Supply Thin

如果 Qualified Pool：

```text
< minimum healthy threshold
```

Matching Engine 不应该偷偷：

```text
include ineligible agents
```

而是返回：

```text
THIN_SUPPLY
```

给 Demand Shaping。

---

# 91. Supply Empty

如果：

```text
0 eligible
```

返回：

```text
EMPTY
```

以及聚合原因：

```text
too far
verification too strict
availability mismatch
budget below supply preference
```

不能返回私人 Agent 数据。

---

# 92. Relaxation Suggestion

Matching Engine 可以返回：

```text
constraint impact
```

例如：

```text
Move English Verified → Preferred
+14 potential supply
```

但真正修改 Task：

```text
Requester confirms
```

---

# 93. Never Silent Relax

绝不允许：

```text
Task requires English B2
```

但因为没供给，后台悄悄：

```text
show English A2
```

这是硬规则。

---

# 94. Agent Block List

Agent 可以：

```text
block requester
block business
block venue
```

这些关系：

```text
private
```

Matching 作为 Eligibility Gate。

---

# 95. Requester Block List

Requester 也可：

```text
Do not match again
```

对某 Agent。

但平台需区分：

```text
normal preference
safety block
```

---

# 96. Prior Negative Outcome

严重历史：

```text
no-show
fraud
safety incident
```

可能：

```text
hard block
```

普通低评分：

```text
ranking signal
```

不能全部混为一谈。

---

# 97. Marketplace Fairness

公平不是：

```text
所有 Agent 获得完全一样曝光
```

而是：

> **所有合格 Agent 都应有合理获得首次真实 Outcome 的机会，同时不牺牲任务成功率。**

---

# 98. Exploration Budget

可以按：

```text
role
location
time
```

设置：

```text
5–15% exploration exposure
```

具体由实验调优。

---

# 99. Exposure Accounting

记录：

```text
candidate_impression
invite
offer
accept
order
completion
```

用于：

```text
fairness
boost billing
marketplace health
```

---

# 100. Sponsored Billing Event

Boost 收费应绑定：

```text
eligible exposure
```

不能对：

```text
ineligible task
```

计费。

具体计费模型在 Monetization 章节细化。

---

# 101. Cold Start — New Agent

新 Agent 没 Outcome：

可以使用：

```text
verification
portfolio
capability evidence
availability
response behavior
```

形成初始 Ranking。

---

# 102. Cold Start — New Requester

新 Requester：

候选暴露要受：

```text
Requester Trust
KYC
Risk
Task Quality
Funding
```

控制。

---

# 103. Cold Start — New Role

新 Role 没历史 Outcome：

使用：

```text
Capability Fit
Verification
Availability
General Reliability
```

先运行。

之后逐步学习 Context-specific Outcome。

---

# 104. Model Boundary

可以使用模型进行：

```text
context feature extraction
portfolio relevance
task similarity
outcome summarization
```

但：

```text
Eligibility hard gate
```

不能完全交给黑盒模型自由判断。

---

# 105. Rule + Model Architecture

推荐：

```text
Deterministic Eligibility
↓
Feature Builder
↓
Ranking Model / Rules
↓
Policy Post-check
↓
Candidate Set
```

---

# 106. Eligibility Source of Truth

必须来自：

```text
Task Requirement
Capability Graph
Agent Capability
Verification
Availability
Schedule
Risk
Policy
```

不能来自：

```text
LLM guessed that agent probably fits
```

---

# 107. Ranking Model 可替换

P0 可以：

```text
rule-based weighted ranking
```

P1：

```text
learning-to-rank
```

但 API Contract 保持不变。

---

# 108. Outcome Learning

训练信号优先：

```text
Offer Accepted
Arrived
Completed
No-show
Cancelled
Requester Rehire
Repeat Business
```

弱信号：

```text
Candidate clicked
Profile opened
```

不应主导。

---

# 109. Click Bias

不能把：

```text
头像被点击多
```

直接学习成：

```text
better agent
```

否则系统会退化为颜值 / 浏览偏好优化。

---

# 110. Match Objective

长期目标不是：

```text
CTR
```

而是近似：

```text
P(Accept)
× P(On-time)
× P(Complete)
× Quality
× Long-term Repeat
```

---

# 111. Safety Overrides Ranking

任何时候：

```text
Risk Policy
```

可以：

```text
remove candidate
```

即使 Organic Score 很高。

---

# 112. Operator Override

高风险 / 特殊任务可以：

```text
Operator Curated
```

但 Operator 仍不能：

```text
bypass prohibited eligibility
```

每次 Override 必须 Audit。

---

# 113. Matching API

推荐：

```text
POST /slots/{slot_id}/match
```

返回：

```text
match_snapshot_id
qualified_supply
candidate_set
supply_health
```

---

# 114. Candidate API

Candidate Detail 必须要求：

```text
task_id
slot_id
match_snapshot_id
agent_id
```

没有 Task Context：

```text
403 / not allowed
```

---

# 115. Eligibility API

内部：

```text
POST /matching/eligibility/evaluate
```

---

# 116. Re-rank API

```text
POST /slots/{slot_id}/rerank
```

触发时检查：

```text
task_version
slot_version
```

---

# 117. Matching Audit

必须记录：

```text
slot_id
agent_id
eligibility_result
ineligibility_reason
organic_rank
sponsored_adjustment
final_rank
reason_codes
ranking_version
task_version
timestamp
```

敏感内部特征需权限隔离。

---

# 118. Requester-facing Supply Summary

例如：

```text
17 qualified
9 available
6 strong matches
Supply: Healthy
```

不显示：

```text
83 people failed because of private reasons
```

---

# 119. Agent-facing Exposure Transparency

Agent 可以看到：

```text
Eligible for 12 relevant tasks
Shown in 4 candidate sets
Invited to 2
```

P1 可增加。

但不能泄露：

```text
其他 Agent 排名细节
```

---

# 120. Business Repeat Team

Business Trusted Team 可以提高 Ranking。

但建议：

```text
Trusted Team
```

是：

```text
ranking preference
```

而不是自动跳过：

```text
availability
risk
license
```

---

# 121. Matching Across Merchant Membership

未来 Member / Consumer 身份：

不能因为：

```text
是某商家会员
```

就自动获得该商家 Task Eligibility。

只有用户主动：

```text
Become a Proxy
```

并具备对应能力，才可作为 Agent。

---

# 122. Physical Scene Data

未来 Scene Network 可提供：

```text
venue context
travel ETA
urgent demand
```

用于 Ranking。

但 Camera / Scene 数据不能：

```text
识别附近具体人
→ 自动拉来做 Agent
```

---

# 123. Social Data Boundary

社媒 Metrics 只在：

```text
Social / Creator Task
```

使用。

不能因为：

```text
TikTok followers 100k
```

就提升：

```text
Queue Proxy
Interpreter
Greeter
```

等无关任务排名。

---

# 124. Cross-context Learning Boundary

一个 Agent：

```text
UGC Creator performance excellent
```

可以增强：

```text
Content / Marketing
```

相关 Ranking。

不能自动增强：

```text
Professional Interpreter
```

---

# 125. Data Minimization

Ranking 服务可以使用必要特征。

但 Candidate 输出：

```text
only task-relevant explanation
```

不暴露内部全部 feature。

---

# 126. MVP P0

必须实现：

```text
Deterministic Eligibility
Capability Gate
Verification Gate
Availability Gate
Time / Location Feasibility
Schedule Conflict
Agent Preference Gate
Qualified Pool
Rule-based Organic Ranking
Reliability
Outcome
Repeat
ETA
Workload
Newcomer Exploration
Exposure Fairness
Sponsored Qualified Adjustment
Finite Candidate Set
Match Reason
Match Snapshot
Audit
```

---

# 127. P1

```text
Learning-to-Rank
Team Composition
Acceptance Prediction
Context Similarity Model
Dynamic Exploration
Advanced fairness
Urgent replacement profile
Cross-venue supply optimization
```

---

# 128. Key Metrics

## Eligibility

```text
Qualified Rate
Top Ineligibility Reason
Verification Block Rate
Availability Block Rate
Conflict Rate
```

## Ranking

```text
Invite Rate
Offer Acceptance
Arrival Rate
Completion Rate
Rehire Rate
```

## Marketplace Health

```text
Exposure Concentration
New Agent First-task Rate
Median Time to First Order
Supply Utilization
```

## Sponsored

```text
Sponsored Qualified Exposure
Sponsored Conversion
Sponsored Completion
Organic vs Sponsored Outcome
```

---

# 129. Guardrail Metrics

必须监控：

```text
No-show by rank position
Cancellation by rank position
Sponsored failure rate
Newcomer failure rate
Sensitive policy violation
Candidate exposure concentration
```

---

# 130. Acceptance Criteria

## AC-MATCH-01
Matching 必须以 TaskSlot 为单位。

## AC-MATCH-02
Eligibility 与 Ranking 必须是两个独立阶段。

## AC-MATCH-03
不满足 Must-have 的 Agent 不得通过低分方式进入候选池。

## AC-MATCH-04
所有硬 Eligibility 必须是可审计 Gate。

## AC-MATCH-05
Capability Verification 要求必须在 Eligibility 层执行。

## AC-MATCH-06
Availability 必须覆盖实际 Task 执行窗口。

## AC-MATCH-07
必须检查 Arrival Feasibility。

## AC-MATCH-08
必须检查 Agent Schedule Conflict。

## AC-MATCH-09
Agent Min Pay / Max Distance 等硬偏好必须尊重。

## AC-MATCH-10
Sensitive Requirement 只有通过 Policy Gate 后才能用于 Matching。

## AC-MATCH-11
Social Metrics 只能用于相关 Task。

## AC-MATCH-12
只有 ELIGIBLE Agent 才能进入 Qualified Candidate Pool。

## AC-MATCH-13
Organic Ranking 不得改变 Eligibility。

## AC-MATCH-14
Outcome History 必须优先使用 Context-specific 结果。

## AC-MATCH-15
Trusted / Repeat Relationship 不得绕过当前 Availability / Risk。

## AC-MATCH-16
新 Agent 必须有 Exploration 机会。

## AC-MATCH-17
Exploration 不得绕过 Verification / Safety。

## AC-MATCH-18
必须支持 Exposure Fairness。

## AC-MATCH-19
Boost 只能作用于 Qualified Agent。

## AC-MATCH-20
Sponsored Candidate 必须明确标识。

## AC-MATCH-21
推荐首位默认保护 Organic Best Match。

## AC-MATCH-22
Sponsored Candidate 比例必须有限制。

## AC-MATCH-23
Curated Candidate Set 必须是有限集合。

## AC-MATCH-24
不得提供无限 People Feed。

## AC-MATCH-25
Candidate Detail 必须要求 Task / Slot Context。

## AC-MATCH-26
每个 Candidate 必须有 Explainable Match Reason。

## AC-MATCH-27
Requester 不应看到内部黑盒 Numeric Score。

## AC-MATCH-28
Task / Slot Version 改变后旧 MatchSnapshot 必须失效。

## AC-MATCH-29
Supply Thin 不得通过偷偷放宽 Must-have 来解决。

## AC-MATCH-30
任何 Requirement Relaxation 都必须由 Requester 明确确认。

## AC-MATCH-31
Ranking 优化目标必须偏向 Accept / Arrival / Completion / Repeat，而非 Profile CTR。

## AC-MATCH-32
模型不得自由决定 Hard Eligibility。

## AC-MATCH-33
Safety / Risk 可以覆盖 Ranking 结果。

## AC-MATCH-34
Matching 必须保留完整 Audit。

## AC-MATCH-35
Sponsored Outcome 必须单独监控，防止商业化破坏履约质量。

---

# 131. 本章锁定结论

1. **Eligibility 决定“有没有资格”，Ranking 决定“合格以后谁更适合”。**
2. **Matching Engine 以 TaskSlot 为单位。**
3. **Hard Constraint 永远不能通过低分或 Boost 绕过。**
4. **Availability、Arrival、Conflict、Agent Preference 都属于真实真人撮合的核心 Gate。**
5. **Qualified Pool 与 Visible Candidate Set 分离。**
6. **Organic Ranking 优化真实接受、到场、完成和复聘。**
7. **真实 Outcome 比 Profile 浏览行为重要。**
8. **Repeat / Trusted Proxy 是强信号，但仍不能绕过当前 Eligibility。**
9. **新 Agent 必须有受控 Exploration。**
10. **需要 Exposure Fairness，防止供给市场赢家通吃。**
11. **Boost 保留，但只能购买 Qualified Exposure。**
12. **Sponsored 必须标识、限比例、首位保护 Organic。**
13. **Curated Match 必须有限候选集，禁止无限刷人。**
14. **Match Reasons 必须可解释。**
15. **敏感、社媒、消费等数据只能在相关 Task Context 使用。**
16. **Matching 学习目标是 Successful Human Execution，而不是人物点击率。**
17. **所有 MatchSnapshot 必须版本化与可审计。**

---

# 132. 下一章

下一份增量 PRD：

> **Chapter 06 — Fast Match / Invite / Offer Engine**

重点解决：

```text
Qualified Candidates 已经有了
↓
到底一次通知几个人？
↓
同时推还是顺序推？
↓
Offer 多久失效？
↓
谁 Accept 后锁 Slot？
↓
其他 Offer 如何撤销？
↓
Agent Decline 是否惩罚？
↓
Urgent Replacement 怎么快速派？
↓
怎样避免 Agent 被大量 Spam Offer？
```

这一章会把 Matching 真正推进到“真人愿意接单并形成 Order”的实时交易层。

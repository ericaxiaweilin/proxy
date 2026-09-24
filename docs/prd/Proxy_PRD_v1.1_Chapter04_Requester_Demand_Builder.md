# Proxy PRD v1.1
## Chapter 04 — Requester Demand Builder / 发布需求系统

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 01 — Account / Identity / Role System
- Chapter 02 — Capability Graph
- Chapter 02A — Real-world Scene Network（Strategic Extension）
- Chapter 02B — Human Agent Marketplace Foundations
- Chapter 03 — Task / TaskSlot / Order State Machine

**本章范围**：
- Requester Demand Entry
- Natural-language Demand Capture
- Structured Builder
- Principal Selection
- Industry / Scenario / Role
- Multi-slot
- Must-have / Nice-to-have
- Sensitive Requirement Gate
- Time / Location / Venue
- Budget
- Deliverable / Evidence
- Supply Impact
- Match Mode
- Commit
- Template / Repeat
- Business / Activity / Scene Prefill
- Draft / Validation / Error Recovery

**本章不细化**：
- Matching Ranking
- Offer Batch
- Payment Rail
- Refund Formula
- Agent Availability Algorithm
这些在后续章节定义。

---

# 1. 本章目标

发布需求系统要把：

> “我现实中缺一个人”

转换成：

```text
Valid Task
+
Valid Atomic TaskSlots
+
Resolved Capability Requirements
+
Time / Location
+
Budget
+
Deliverables
+
Matching Context
```

最终才能：

```text
COMMIT
→ MARKETPLACE
```

---

# 2. Demand Builder 的产品定位

Demand Builder 不是：

```text
普通表单
```

而是：

> **现实业务需求结构化引擎。**

它负责：

```text
理解需求
↓
补足缺失信息
↓
绑定 Capability Graph
↓
拆 Human Agent Slots
↓
检查政策 / 风险
↓
估算 Qualified Supply
↓
引导 Requester 做可成交的选择
↓
生成 Task Draft
```

---

# 3. 核心原则

## 3.1 Task First

用户先描述：

```text
我要完成什么
```

不是先：

```text
我要搜什么人
```

---

## 3.2 Progressive Structuring

第一次不要让用户填几十个字段。

流程：

```text
Simple Need
↓
Context Questions
↓
Structured Task
```

---

## 3.3 Explainable Constraints

用户每加一个条件，系统要能解释：

```text
这个条件会减少多少 Qualified Supply
```

---

## 3.4 No Silent Guess

模型可以：

```text
suggest
infer candidate
```

但不能未经确认就把高影响信息静默写入正式 Task。

---

# 4. Demand Entry

Requester Home 主入口：

```text
你需要一个人替你完成什么？
```

输入方式：

```text
Natural Language
Template
Recent Task
Activity-generated
Business-generated
Scene-generated
```

---

# 5. Natural-language Input

例如：

```text
周六晚上我咖啡店开业，
需要3个会英语的迎宾，
再要1个中越翻译。
```

系统解析候选：

```text
Industry:
FNB_RETAIL

Scenario:
GRAND_OPENING

SlotGroup A:
GREETER ×3
LANG_EN_B2

SlotGroup B:
INTERPRETER ×1
LANG_ZH_HSK5
LANG_VI_NATIVE

Time:
Saturday Evening

Location:
Missing
```

---

# 6. Natural-language Parse Status

每个字段必须区分：

```text
EXPLICIT
INFERRED
DEFAULTED
UNRESOLVED
```

例如：

```text
Role = GREETER
source = EXPLICIT

Industry = FNB_RETAIL
source = INFERRED

Location
source = UNRESOLVED
```

---

# 7. High-impact Confirmation

以下字段即使模型推断，也必须显式确认：

```text
Role
Quantity
Time
Location
Must-have
Sensitive Attribute
Budget
Deliverable
Pay
Cancellation Terms
```

---

# 8. Task Draft

进入 Builder 后立即创建：

```text
Task.lifecycle = DRAFT
```

并保存：

```text
draft_progress
last_completed_step
source_input
resolved_graph
unresolved_items
```

支持用户中途退出后继续。

---

# 9. Principal Selection

如果用户只有个人身份：

```text
Posting as:
Individual
```

如果有 Business：

```text
Who is this task for?

○ Me
○ Bonsaidon
○ ABC Event
```

Task 写入：

```text
created_by_user_id
principal_type
principal_id
```

---

# 10. Business Prefill

如果选择 Business：

系统可预填：

```text
Saved Venues
Default Billing
Previous Task Templates
Trusted Team
Business Industry
```

但不能自动加入 Human Agent。

---

# 11. Builder Main Flow

推荐主链：

```text
Step 1 你要完成什么？
Step 2 需要哪些真人角色？
Step 3 什么时候？
Step 4 在哪里？
Step 5 必须会什么？
Step 6 有哪些偏好？
Step 7 怎样算完成？
Step 8 预算多少？
Step 9 市场供给如何？
Step 10 选择匹配方式
Step 11 Review & Commit
```

---

# 12. Step 1 — Need / Scenario

UI：

```text
你要完成什么？
```

系统提供：

```text
Industry
Scenario
```

但不要把用户暴露在复杂 Graph 术语中。

例如：

```text
开业
商务会议
展会
代排队
探店内容
现场查看
```

---

# 13. Scenario Suggestion

如果 Natural Language 已经明确：

```text
咖啡店开业
```

可以直接建议：

```text
F&B / Retail
→ Grand Opening
```

用户确认后写入 Graph Node。

---

# 14. Unknown Scenario

如果无法绑定：

```text
GRAPH_GAP
```

UI：

```text
我们还没有完全识别这个场景。
先告诉我们你需要这个人做什么。
```

不要让用户卡死。

---

# 15. Step 2 — Role / Human Slots

UI：

```text
你需要哪些人？
```

例如：

```text
Greeter      3
Interpreter  1
Content      1
```

系统内部生成：

```text
SlotGroup Greeter
├── Slot G1
├── Slot G2
└── Slot G3
```

---

# 16. Quantity Edit

Increase：

```text
3 → 5
```

Draft 阶段：

```text
create 2 new atomic TaskSlots
```

Decrease：

```text
5 → 3
```

Draft 阶段：

```text
remove draft slots
```

Committed 后则遵守 Chapter 03 的取消规则。

---

# 17. Role Template

选择 Role 后：

系统从 Capability Graph 返回：

```text
Required
Recommended
Optional
Prohibited
```

例如：

```text
Greeter

Required:
CUSTOMER_FACING

Recommended:
EVENT_RECEPTION
LANG_EN_B1
```

---

# 18. Step 3 — Time

字段：

```text
Date
Start
End
Arrival Target
Flexible Window
Matching Deadline
```

---

# 19. Time Validation

必须检查：

```text
start_at > now
end_at > start_at
arrival_target <= start_at
matching_deadline <= start_at
```

---

# 20. Flexible Time

用户可以：

```text
Exact
±15m
±30m
±1h
```

Flexible Time 可以扩大 Supply。

系统应显示：

```text
±30 min may add ~6 qualified Agents
```

---

# 21. Step 4 — Location

支持：

```text
Search
Map Pin
Current Location
Saved Venue
Recent Location
Business Store
Activity Venue
```

---

# 22. Location Privacy

Task Draft 阶段可以保存准确地点。

但 Candidate 匹配前后如何暴露给 Agent：

由后续 Visibility Policy 控制。

例如：

```text
Candidate:
Tây Hồ area

Matched:
Exact venue
```

---

# 23. Venue Binding

如果是 Business：

可以绑定：

```text
venue_id
```

而不是重复手输地址。

好处：

```text
Check-in
Instructions
Scene Context
Saved Venue
```

都可复用。

---

# 24. Travel Radius

Requester 可以选择：

```text
3km
5km
8km
15km
Custom
```

但 UI 不应该鼓励：

```text
“附近的人”
```

而是：

```text
Search area for this task
```

---

# 25. Step 5 — Must-have

定义：

> 不满足就不能进入 Eligibility。

例如：

```text
English B2 Verified
Available Full Time
Driving License
TikTok Connected
```

---

# 26. Must-have Supply Impact

每次新增条件：

```text
Qualified Supply
42 → 17
```

系统必须提示。

例如：

```text
English B2 Verified
-25 supply
```

---

# 27. Must-have Warning

如果一个 Must-have 导致：

```text
Qualified Supply < threshold
```

提示：

```text
This requirement may make the task hard to fill.
```

并建议：

```text
Move to Preference
Expand radius
Adjust time
Increase pay
```

---

# 28. Step 6 — Nice-to-have

定义：

> 不影响 Eligibility，只影响 Match Quality / Ranking。

例如：

```text
Hospitality Background
Closer Distance
More Event Experience
Repeat Relationship
```

---

# 29. Must vs Preference UI

必须让用户理解：

```text
Must-have
= 没有就不要推荐

Preference
= 有更好
```

避免 Requester 把所有条件都设成硬门槛。

---

# 30. Sensitive Requirement

敏感 Attribute 不出现在通用筛选器里。

只有：

```text
Scenario
+
Role
+
Policy
```

允许时才显示。

---

# 31. Sensitive Requirement Flow

例如：

```text
Gender
```

系统先问：

```text
Why is this needed for the task?
```

必须选择：

```text
Reason Code
```

必要时：

```text
Additional Explanation
```

然后：

```text
Policy Evaluation
```

---

# 32. Sensitive Outcome

结果：

```text
ALLOWED
ALLOWED_WITH_LIMIT
REVIEW_REQUIRED
NOT_ALLOWED
```

---

# 33. Sensitive Requirement Audit

记录：

```text
requester_id
task_id
attribute_id
reason_code
policy_version
decision
created_at
```

---

# 34. Step 7 — Deliverable

用户必须定义：

> 什么叫完成。

例如 Greeter：

```text
Arrive by 17:30
Stay until 21:00
Welcome guests
Support check-in
```

---

# 35. Evidence Template

系统根据：

```text
Scenario
Role
```

给默认 Evidence。

例如：

```text
GPS Check-in
Duration
Photos
Checklist
Requester Confirmation
```

UGC：

```text
Video File
Post URL
Publish Time
Social Metrics Snapshot
```

---

# 36. Evidence Requirement Level

推荐：

```text
REQUIRED
OPTIONAL
NOT_APPLICABLE
```

不要所有任务都要求拍照。

---

# 37. Privacy-aware Evidence

例如私人场景：

```text
Photo evidence
```

可能不合理。

系统应根据：

```text
Scene Policy
```

禁止或弱化。

---

# 38. Step 8 — Budget

支持：

```text
Per Slot Fixed
Hourly
Task Total
```

P0 建议以：

```text
Per Slot Fixed
Hourly
```

为主。

---

# 39. Multi-slot Budget

例如：

```text
Greeter ×3
600k each

Interpreter ×1
900k

Total
2.7M
```

---

# 40. Budget vs Supply

系统可以显示：

```text
At 500k:
6 qualified

At 650k:
11 likely active

At 800k:
15 likely active
```

注意：

P0 可以只是估算，不必动态定价。

---

# 41. Minimum Pay Gate

如果预算低于平台 / 市场安全底线：

```text
Cannot Commit
```

原因：

```text
Below minimum allowed pay
```

---

# 42. Step 9 — Supply Preview

到这一阶段，用户仍然不一定看到真人。

先看到：

```text
Qualified Supply
Available Now
Scheduled Supply
Expected Match Time
Supply Risk
```

---

# 43. Supply Preview Example

```text
Greeter ×3

Qualified Supply
17

Available during task
9

Expected Fill
High

ETA
5–10 min
```

---

# 44. Per SlotGroup Supply

Multi-slot 必须按组展示。

例如：

```text
Greeter
HIGH

Interpreter
MEDIUM

Content Talent
LOW
```

这比只显示：

```text
Total 21 Agents
```

更有业务价值。

---

# 45. Supply Risk

推荐：

```text
HEALTHY
THIN
CRITICAL
EMPTY
UNKNOWN
```

---

# 46. Supply Adjustment

如果：

```text
CRITICAL / EMPTY
```

系统按影响给出：

```text
+ Expand radius
+ Relax Nice-to-have
+ Move Must → Preference
+ Adjust time
+ Raise pay
+ Change Role
```

不能只说：

```text
No Results
```

---

# 47. Demand Shaping

Proxy 的职责不只是查现有供给。

还要：

> **帮助 Requester 把需求调整成可成交任务。**

这个过程称：

```text
Demand Shaping
```

---

# 48. Demand Shaping Log

记录：

```text
original_requirement
adjustment
supply_before
supply_after
requester_accepted
```

这些数据以后可以优化 Builder。

---

# 49. Step 10 — Match Mode

系统推荐：

```text
FAST_MATCH
CURATED_MATCH
```

Requester 也可在允许范围内切换。

---

# 50. Fast Match Recommendation

适合：

```text
Queue
Pickup
Simple on-site support
Low differentiation role
```

---

# 51. Curated Match Recommendation

适合：

```text
Greeter
Interpreter
MC
UGC Creator
Professional Background
Brand-facing Role
```

---

# 52. Match Mode Explanation

不要用技术词。

例如：

## Fast Match

```text
Proxy 会自动找符合条件且能准时到达的人。
```

## Choose from Matches

```text
先看一小组符合任务的人，再邀请。
```

---

# 53. Step 11 — Review

Review 页面必须显示：

```text
Principal
Industry / Scenario
Time
Location
Slots
Must-have
Preferences
Deliverables
Evidence
Budget
Cancellation Terms
Match Mode
Supply Risk
```

---

# 54. Commitment

Requester 点：

```text
Confirm & Find Proxy
```

系统执行：

```text
Validate Draft
↓
Admission Gate
↓
Funding Gate
↓
Freeze Committed Version
↓
Task READY
↓
Task COMMITTED
↓
Open Slots
↓
Task ACTIVE
```

---

# 55. Validation Result

推荐：

```text
VALID
MISSING_REQUIRED_FIELD
GRAPH_UNRESOLVED
POLICY_BLOCKED
SUPPLY_CRITICAL
FUNDING_REQUIRED
REVIEW_REQUIRED
```

---

# 56. Supply Critical 是否阻止 Commit

默认：

```text
NO
```

用户可以发布低供给任务。

但必须明确：

```text
Low likelihood of fill
```

除非：

```text
Supply = structurally impossible
```

才阻止。

---

# 57. Structurally Impossible

例如：

```text
Role requires legal-age driver
+
user asks 15-year-old
```

属于：

```text
POLICY / GRAPH impossible
```

不是 Supply Thin。

---

# 58. Task Quality Score

可以有内部：

```text
Task Readiness Score
```

评估：

```text
Role clarity
Time clarity
Location clarity
Requirement clarity
Deliverable clarity
Budget validity
```

但不要做成用户“游戏分数”。

UI 用：

```text
Ready to publish
Needs 2 details
```

---

# 59. Clarification Strategy

只有真正影响可执行性时才问。

例如：

```text
“周六帮我找几个迎宾”
```

必须问：

```text
几点？
哪里？
几个人？
```

不应该问十几个无关问题。

---

# 60. Bounded Clarification

推荐：

```text
最多优先解决 1–3 个 blocking questions
```

其余可：

```text
use safe defaults
or
mark optional
```

---

# 61. Free-text Description

Task 仍允许：

```text
description
```

但：

> Free Text 不能替代结构化 Requirement。

例如：

```text
“必须会英语”
```

不能只留在 description。

必须绑定：

```text
LANG_EN_B2
```

---

# 62. Source-of-truth

Builder UI 的所有展示文本最终必须映射到：

```text
Graph IDs
Task Fields
Slot Fields
Policy Decisions
```

不允许只有前端文案，没有后端结构。

---

# 63. Draft Autosave

每个 Step：

```text
autosave
```

断开后恢复：

```text
Resume Draft
```

---

# 64. Draft Expiry

长期未完成：

```text
Draft expires after configurable period
```

但可以：

```text
Archive
Restore
```

---

# 65. Template

完成过的 Task 可生成：

```text
TaskTemplate
```

Template 保存：

```text
Industry
Scenario
Slot Groups
Requirements
Evidence
Venue
Default Duration
Budget Defaults
```

不保存：

```text
old Order
old Agent assignment
old exact time
```

---

# 66. Repeat Task

点击：

```text
Repeat
```

生成：

```text
New Draft Task
```

预填：

```text
Template structure
```

必须重新确认：

```text
Date
Time
Availability
Budget
```

---

# 67. Trusted Proxy Prefill

Repeat Task 可以建议：

```text
Invite trusted An first?
```

但不能：

```text
auto assign
```

仍需：

```text
Availability
Eligibility
Accept
```

---

# 68. Business Template

Business 可有：

```text
Store Opening Template
Weekend Event Template
Customer Visit Template
```

---

# 69. Business Multi-slot Builder

Business 页面可支持：

```text
Add Role
```

快速构建：

```text
Greeter ×3
Interpreter ×1
Content ×2
```

每个组独立：

```text
Requirement
Budget
Evidence
```

---

# 70. Bulk Copy

Business 可：

```text
Copy requirements from Greeter 1 to all Greeters
```

内部仍保持原子 Slot。

---

# 71. Multi-venue Future Support

P1：

```text
One Campaign
↓
Venue A Task
Venue B Task
Venue C Task
```

不要让一个 Task 同时跨多个物理 Venue。

原则：

> 一项 Task 应有一个主要 Execution Context。

跨 Venue 用：

```text
Campaign → multiple Tasks
```

---

# 72. Activity-generated Builder

Activity 已有：

```text
Venue
Time
Capacity
```

所以点击：

```text
Add Human Agents
```

Builder 预填：

```text
Location
Time
Principal
Activity Context
```

用户只需选择：

```text
Role
Quantity
Requirements
Budget
```

---

# 73. Scene-generated Builder

未来 Scene Rule 生成：

```text
Suggested Task Draft
```

例如：

```text
Saturday 18–22
Greeter ×1
```

Merchant 打开后：

```text
Review
Adjust
Commit
```

P0 不直接自动支付。

---

# 74. Social Campaign Builder

例如 Business：

```text
Restaurant Launch
```

选择：

```text
UGC Creator ×2
```

Builder 动态增加：

```text
Channel
Content Deliverable
Publishing Owner
Social Metrics Requirement
Usage Rights
```

具体 Social 条款后续章节细化。

---

# 75. Merchant Membership Campaign

未来：

```text
Gold Member Night
```

可以预填：

```text
Activity
Venue
Time
Expected Attendance
```

再创建 Human Agent Need。

---

# 76. User Behavior Instrumentation

Builder 必须埋点：

```text
demand_started
natural_language_submitted
scenario_selected
role_added
quantity_changed
must_added
must_relaxed
preference_added
sensitive_requested
budget_changed
supply_previewed
supply_adjustment_applied
match_mode_selected
task_committed
draft_abandoned
```

---

# 77. 不采集 People Browsing 指标做核心优化

Builder 优化目标：

```text
Need → Committed Task
```

不是：

```text
Need → More Profile Views
```

---

# 78. Builder Funnel

核心：

```text
Demand Start
↓
Structured
↓
Ready
↓
Committed
↓
Matched
↓
Completed
```

---

# 79. Demand Abandonment

记录原因：

```text
Too Expensive
Not Enough Supply
Too Complex
Changed Mind
Policy Blocked
Time Unavailable
Unknown
```

用于：

```text
Demand Shaping
Pricing
Supply Acquisition
```

---

# 80. Data Security

Draft 里可能包含：

```text
private home address
sensitive context
business details
```

因此 Draft 也属于受保护数据。

不能因为未发布就当 Public。

---

# 81. Candidate Exposure 前置条件

必须满足：

```text
Valid Task
+
Principal Permission
+
Graph Resolved
+
Required Context
+
Trust / Risk Gate
```

否则：

```text
No Candidate API
```

---

# 82. No Task, No People Search

Demand Builder 是所有 Candidate Exposure 的入口。

如果用户退出 Builder 又去“搜人”：

```text
Not Allowed
```

---

# 83. Requester Editing after Commit

进入 COMMITTED 后：

Builder 不再是自由表单。

编辑必须调用：

```text
Change Task
```

并遵守 Chapter 03：

```text
L0 Cosmetic
L1 Matching Relevant
L2 Contract Relevant
```

---

# 84. Contract Change UI

如果修改影响已 Assigned Agent：

显示：

```text
This change affects 3 confirmed Human Agents.
They must accept the new terms.
```

---

# 85. Supply Impact API

Builder 需要统一接口：

```text
POST /tasks/{draft_id}/supply-impact
```

输入：

```text
slot requirements
time
location
budget
```

输出：

```text
qualified_supply
available_supply
risk
delta_by_requirement
```

---

# 86. Supply Impact 不返回真人列表

接口禁止返回：

```text
agent ids
avatars
profiles
```

只返回：

```text
aggregate
```

---

# 87. Requirement Delta

例如：

```json
{
  "change": "ADD_LANG_EN_B2",
  "before": 42,
  "after": 17,
  "delta": -25
}
```

---

# 88. Policy Evaluation API

敏感条件：

```text
POST /tasks/{id}/policy-evaluate
```

返回：

```text
allowed
reason_required
review_required
restriction
```

---

# 89. Graph Resolve API

Natural Language / UI 输入最终：

```text
POST /graph/resolve
```

必须得到稳定 Graph IDs。

---

# 90. Commit API

```text
POST /tasks/{id}/commit
```

服务端必须重新验证全部条件。

不能信任：

```text
前端已经 validate
```

---

# 91. Commit Idempotency

必须支持：

```text
Idempotency-Key
```

避免双击重复发布。

---

# 92. Commit Snapshot

Commit 时记录：

```text
committed_task_version
committed_graph_version
committed_requirements
committed_budget
committed_cancellation_terms
```

---

# 93. Requester UX — Individual Fast Task

例如：

```text
“明早帮我排队买票”
```

系统尽量压缩为：

```text
What
When
Where
Budget
Evidence
```

不要强迫用户走完整 11 屏。

---

# 94. Requester UX — Business Complex Task

例如：

```text
Grand Opening
```

允许展开：

```text
Multiple Roles
Requirements
Venue
Evidence
Budget
Match Mode
```

因此 Builder 应：

> **Adaptive, not one fixed wizard.**

---

# 95. Adaptive Builder

根据复杂度：

```text
Simple Task
→ 4–6 steps

Complex Business Task
→ 8–11 steps
```

但内部对象相同。

---

# 96. Builder Step Engine

推荐每个 Step 由配置定义：

```text
step_id
trigger_condition
required_fields
optional_fields
validation
next_step_rule
```

避免前端硬编码：

```text
Step1 → Step2 → Step3
```

---

# 97. Graph-driven Dynamic Form

Role 决定字段：

```text
Interpreter
→ Language
→ Level
→ Background

UGC Creator
→ Channel
→ Portfolio
→ Social Requirement

Queue Proxy
→ Duration
→ Check-in
```

---

# 98. User Explanation

系统必须让用户知道：

```text
为什么要问这个？
```

例如：

```text
我们询问语言水平，
因为它会直接影响这项任务能否完成。
```

尤其敏感字段。

---

# 99. Default Values

只允许对低风险字段安全默认。

例如：

```text
Match Mode recommendation
Evidence template
Arrival buffer
```

不默认：

```text
Gender
Pay
Exact Time
Exact Location
```

---

# 100. Error Recovery

如果某一步失败：

```text
Supply service unavailable
Graph service timeout
Policy review pending
```

不能丢 Draft。

显示：

```text
Your task is saved.
You can continue when this check is available.
```

---

# 101. Offline / Network Retry

Commit 失败：

```text
do not create duplicate Task
```

使用：

```text
idempotent retry
```

---

# 102. Metrics

## Demand Creation

```text
Demand Start Rate
Draft Completion Rate
Commit Rate
Time to Commit
```

## Task Quality

```text
Graph Resolution Rate
Missing Field Rate
Policy Block Rate
Supply Critical Rate
```

## Demand Shaping

```text
Adjustment Acceptance Rate
Supply Lift after Adjustment
Recovered Demand Rate
```

## Repeat

```text
Template Usage
Repeat Task Rate
Time to Republish
```

---

# 103. MVP P0

必须实现：

```text
Natural Language Entry
Structured Builder
Principal
Industry / Scenario
Role / Atomic Slot creation
Time
Location
Must / Preference
Sensitive Policy Gate
Deliverable
Evidence
Budget
Supply Preview
Supply Impact
Fast / Curated Choice
Review
Commit
Draft Autosave
Repeat Task
Template Basic
```

---

# 104. P1

```text
Advanced adaptive builder
Scene-generated draft
Membership campaign draft
Social advanced deliverables
Multi-venue campaign
AI suggested budget
Advanced demand forecast
Voice input
Image / document input
```

---

# 105. Acceptance Criteria

## AC-BUILDER-01
所有 Candidate Exposure 必须来自 Valid Task Context。

## AC-BUILDER-02
Natural Language 可以作为输入，但最终必须绑定结构化 Graph 与 Task 字段。

## AC-BUILDER-03
高影响推断字段必须由 Requester 明确确认。

## AC-BUILDER-04
每个真人数量必须生成对应数量的原子 TaskSlot。

## AC-BUILDER-05
Role Template 必须来自 Capability Graph。

## AC-BUILDER-06
Must-have 与 Nice-to-have 必须分离。

## AC-BUILDER-07
每个 Must-have 调整必须可以返回 Supply Impact。

## AC-BUILDER-08
Supply Impact API 不得返回真人身份。

## AC-BUILDER-09
Sensitive Attribute 必须经过 Policy Evaluation。

## AC-BUILDER-10
Sensitive Requirement 必须记录 Reason / Policy / Decision。

## AC-BUILDER-11
Task 必须定义 Completion Deliverable。

## AC-BUILDER-12
Evidence Template 必须按 Scenario / Role 动态生成。

## AC-BUILDER-13
Budget 必须至少支持 Per Slot Fixed 与 Hourly。

## AC-BUILDER-14
Multi-slot Business Task 必须按 SlotGroup 展示 Supply Risk。

## AC-BUILDER-15
Supply EMPTY 不得直接等同于 Task Invalid。

## AC-BUILDER-16
Demand Shaping 必须提供可解释的调整选项。

## AC-BUILDER-17
Fast / Curated Match 选择必须发生在 Task Context 内。

## AC-BUILDER-18
Commit 必须由服务端重新执行完整 Validation。

## AC-BUILDER-19
Commit 必须幂等。

## AC-BUILDER-20
Task Draft 必须自动保存并可恢复。

## AC-BUILDER-21
Repeat Task 必须生成新 Draft，而不是复活旧 Task。

## AC-BUILDER-22
Template 不得保存旧 Order / Assignment。

## AC-BUILDER-23
Activity / Scene / Campaign 产生的需求必须预填标准 Builder，而不是旁路创建 Order。

## AC-BUILDER-24
Committed Task 的重大编辑必须遵守 Chapter 03 Change Policy。

## AC-BUILDER-25
Simple Task 与 Complex Business Task 可以不同 UI 路径，但必须生成同一核心数据结构。

## AC-BUILDER-26
Builder 必须支持 Graph Gap，而不是遇到未知需求就直接失败。

## AC-BUILDER-27
Draft 数据必须按照私人 Task 数据保护，不得公开。

## AC-BUILDER-28
Builder 优化目标必须是 Need → Committed → Completed，不是 People Browsing。

---

# 106. 本章锁定结论

1. **Demand Builder 是 Proxy 现实需求结构化入口，不是普通表单。**
2. **自然语言可以作为输入，但最终必须收敛成结构化 Task / Slot。**
3. **高影响条件不能静默推断。**
4. **每一个真人需求数量都必须形成原子 TaskSlot。**
5. **Must-have / Preference 严格分离。**
6. **每个硬条件都要尽量显示 Supply Impact。**
7. **敏感条件必须经过 Policy Gate。**
8. **Deliverable / Evidence 是发布前必要结构。**
9. **Supply Preview 先展示市场容量，不先展示真人。**
10. **Demand Shaping 是平台核心职责。**
11. **Builder 必须适应简单个人任务和复杂 Business 多 Slot 任务。**
12. **Repeat / Template 必须让第二次发布明显更快。**
13. **Activity / Scene / Merchant 等上游需求必须统一进入同一 Builder / Task 主链。**
14. **Commit 是正式进入 Marketplace 的边界。**
15. **No Task, No People Search 继续作为硬规则。**

---

# 107. 下一章

下一份增量 PRD：

> **Chapter 05 — Matching Engine / Eligibility & Ranking**

重点解决：

```text
哪些 Agent 根本不能进候选池
↓
哪些 Agent 属于 Qualified
↓
Qualified 以后怎么排序
↓
Availability / Distance / Reliability / Outcome / Repeat / Boost
分别处在哪一层
```

并正式把：

```text
Eligibility
```

与：

```text
Ranking
```

彻底分开。

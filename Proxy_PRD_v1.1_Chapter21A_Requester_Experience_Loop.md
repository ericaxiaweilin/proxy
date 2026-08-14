# Proxy PRD v1.1
## Chapter 21A — Requester Experience Loop

**状态**：P0 UX CONTRACT  
**依赖**：Canonical Registry R2 / Chapter 21 P0 Surface Contract  
**目标**：强化需求方从模糊想法到现实结果、再到复用的完整体验，不重做 Agent / Business / Payment / Safety 基础架构。

---

# 1. Requester North-star Experience

```text
我有一个模糊想法
→ Proxy 帮我说清楚
→ Proxy 给我几个可选方案
→ 我知道事情正在推进
→ 我确认结果真的变好了
→ 下一次更容易完成
```

Requester 体验不以“填完表单”“浏览更多 Agent”或“停留更久”为成功。

成功定义：

```text
Need understood
→ executable demand formed
→ trade-off understood
→ matching progress trusted
→ outcome verified
→ repeat expression cost reduced
```

---

# 2. Canonical Requester Mainline

```text
Requester Home / Demand Cockpit
→ Need Capture
→ Clarification
→ Solution Compare
→ Demand Preview
→ Matching Room
→ Outcome Review
→ Repeat / Reuse
```

结构化 Industry / Scenario / Role / Capability 编辑器继续存在，但降级为：

```text
Advanced / Structured Editor
```

不再作为大多数 Requester 的第一入口。

---

# 3. R01 — Demand Cockpit

## Purpose
回答：

> 我现在有哪些现实事情需要 Proxy 帮我推进？

不是 Dashboard KPI，不是 Feed。

## Sections

1. Need Capture CTA
2. Needs Attention
3. Upcoming Scenes
4. Reusable Tasks
5. Contextual Inspiration

## Contextual Inspiration rule
只允许来自：

```text
current task
recent completed task
saved template
current location/time liquidity
same scenario operational knowledge
```

禁止：

```text
generic content feed
people recommendations
infinite scroll
engagement bait
```

## Empty State
没有任务时：

```text
No active task
→ Start a new need
→ Optional reusable task
```

不得为了“首页不空”塞陌生 Agent 或泛化内容。

---

# 4. R02 — Need Capture

## Primary Question

> 你想让现实中发生什么变化？

用户输入 Goal，而不是先输入：

```text
Role
Slot
Capability
Evidence
```

## Output
产生 `Need Hypothesis`（UX read model，不新增 Marketplace truth）：

```text
goal_summary
likely_scene
known_constraints
unknown_high_impact_items[]
```

P0 可以由模板 / rule support；AI 只作为未来 Extension Point。

## Rule
不允许把“AI 理解结果”静默变成 Hard Requirement。

---

# 5. R03 — Clarification

## Principle
只问：

```text
high-impact unknowns
```

每个问题必须同时显示：

```text
Why are we asking?
What will this affect?
```

影响类别：

```text
Eligibility
Supply depth
Price
Time to fill
Risk
Evidence
Execution
```

## P0 Pattern
一次显示 1–3 个高影响问题。

低影响问题后置或使用 Graph Default。

## Anti-pattern
禁止：

```text
20-question wizard
ask because database field exists
ask the same fact twice
hide material impact
```

---

# 6. R04 — Solution Compare

## Purpose
把 Demand Shaping 变成用户可理解的取舍。

P0 预设方案：

```text
SPEED_FIRST
QUALITY_FIRST
BUDGET_FIRST
TRUSTED_FIRST
```

## Each Solution shows

```text
same goal
matching mode
estimated budget range
expected supply health
estimated fill confidence
constraints retained
constraints relaxed
trade-off explanation
```

## Rule
方案之间的 Goal 不变。

Hard Requirement 不得被系统偷偷变成 Nice-to-have。

---

# 7. R05 — Demand Preview

## Must show

```text
Goal
People / Atomic Slots
Time
Location
Price / range
Risk
Deliverables
Evidence
Unknowns
Material assumptions
```

## Unknowns
任何还没确定的事实必须显式显示：

```text
UNKNOWN
```

不能为了让页面“看起来完成”伪造确定性。

## Confirmation
超过预授权范围的：

```text
price change
time change
location change
scope change
hard requirement change
```

必须重新确认。

---

# 8. R06 — Matching Room

## Purpose
让用户知道：

```text
现在发生了什么
为什么还在等
哪些 Slot 已经推进
当前障碍是什么
下一步是什么
有什么替代方案
什么变化需要我确认
```

## Must show

```text
Task / Slot progress
Qualified supply depth
Offers sent / reviewing / declined facts
Accepted / final-recheck status
specific waiting reason
next system action
requester action if required
fallback options
```

## Prohibited

```text
fake countdown
fake scarcity
"238 Agents searching" without evidence
infinite matching animation
hidden hard-constraint relaxation
```

## States

```text
MATCHING_HEALTHY
NO_QUALIFIED_CANDIDATE
THIN_SUPPLY
AWAITING_AGENT_RESPONSE
AWAITING_PAYMENT
AWAITING_REQUESTER_CONFIRMATION
REPLACEMENT_REQUIRED
NETWORK_UNCERTAIN
```

这些是 UI read-model states，不替代 Task / Slot / Offer / Order canonical status。

---

# 9. R07 — Outcome Review

## Purpose
不只问“满意吗”，而是证明现实目标有没有变好。

## Must show

```text
Goal achieved?
Slot outcome
Arrival / on-time facts
Deliverables
Evidence
Deviation
Budget deviation
Exceptions
Issue / dispute if any
Value generated
Repeat learning
```

## Outcome states

```text
FULL_SUCCESS
PARTIAL_SUCCESS
FAILED
CANCELLED
```

不得用强制五星替代 Outcome。

Review 不阻塞 Settlement。

## Partial Success
必须分别显示：

```text
what was completed
what was not completed
financial effect
available remedy
```

---

# 10. R08 — Repeat / Reuse

## Rule
Repeat：

```text
creates new Task Draft
```

不是复活旧 Order。

## Can reuse

```text
Goal
Scenario
Role mix
TaskNeedProfile structure
Evidence Policy
Trusted Relationship preference
Venue reference where appropriate
```

## Must reconfirm

```text
Time
Location / meeting point
Headcount
Current Compensation
Availability
Current Eligibility / Verification
Risk
Funding
```

## Ignore behavior
用户点击：

```text
Not now
```

则：

```text
no repeated nagging
no Trust penalty
no forced notification sequence
```

---

# 11. Required Requester State Coverage

P0 Prototype / Engineering 必须覆盖：

1. Empty State
2. Loading State
3. No Candidate
4. Candidate Shortage
5. Price / Time Change
6. Payment Pending
7. Agent Last-minute Cancellation
8. Safety / Support Exception
9. Network Offline
10. User Confirmation Required
11. Partial Outcome
12. Repeat Suggestion Ignored

每个状态必须定义：

```text
what happened
what is still true
what is unknown
who acts next
what user can do
what system will not do automatically
```

---

# 12. UX Red Lines

禁止：

```text
Generic Feed
Fake Countdown
Fake Scarcity
Infinite Scroll
Forced Five-star Rating
Celebration animation that hides problems
Interruptions optimized for dwell time
People browsing as fallback
```

---

# 13. Luna Engineering Entry Gate

需求方页面进入工程化前必须满足：

```text
8 core screens clickable
12 required states inspectable
all CTA mapped to domain action
all displayed statuses are read models or canonical states
no UI-only business truth
no provider dependency in prototype
no AI dependency in P0 completion path
```

Luna 首批页面工程顺序：

```text
Demand Cockpit
→ Need Capture
→ Clarification
→ Solution Compare
→ Demand Preview
→ Matching Room
→ Outcome Review
→ Repeat
```

视觉 polish、复杂动画、内容增长组件排在这条链之后。

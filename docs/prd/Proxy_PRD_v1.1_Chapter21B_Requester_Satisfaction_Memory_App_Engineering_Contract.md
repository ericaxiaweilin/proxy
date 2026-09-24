# Proxy PRD v1.1
## Chapter 21B — Requester Satisfaction / Memory / Progress / App Engineering Contract

**状态**：P0 ENGINEERING CONTRACT  
**依赖**：Canonical Registry R2 / Chapter 21A  
**目的**：不重写 Requester UX 概念，只补足可实现对象、状态、Command、Event、Read Model 与 App Shell 行为。

---

# 1. P0 Closure

Requester 满足感闭环统一为：

```text
Need Draft
→ Need Facts: CONFIRMED / INFERRED / UNKNOWN
→ DemandSolution Compare / Select
→ Demand Preview Confirmation
→ Funding
→ Matching Progress
→ Execution / Outcome Facts
→ SatisfactionCapture
→ Recovery if needed
→ RequesterMemory confirmation
→ Repeat
```

硬规则：

```text
Outcome Fact ≠ Satisfaction
Satisfaction ≠ Settlement Gate
Inferred Preference ≠ Confirmed Memory
Candidate Selection ≠ Order
Stale Progress ≠ Live Progress
```

---

# 2. Need Draft State Contract

## 2.1 NeedFact

```text
need_fact_id
draft_id
fact_type
value
state
source
confidence optional
confirmed_at optional
updated_at
```

`state`：

```text
UNKNOWN
INFERRED
CONFIRMED
REJECTED
SUPERSEDED
```

`source`：

```text
USER_EXPLICIT
TEMPLATE
GRAPH_DEFAULT
SYSTEM_INFERENCE
PRIOR_CONFIRMED_MEMORY
```

只有 `CONFIRMED` 可以进入 Hard Requirement / Material Commitment。

## 2.2 Commands / Events

```text
SaveNeedDraft
ConfirmNeedFact
RejectNeedFact
SupersedeNeedFact
```

Events：

```text
NeedDraftSaved
NeedFactConfirmed
NeedFactRejected
NeedFactSuperseded
```

Draft 必须支持恢复；页面跳转、键盘关闭、冷启动都不能丢失用户原话。

---

# 3. DemandSolution Contract

## 3.1 Object

```text
DemandSolution
--------------
solution_id
draft_id
strategy_type
status
matching_mode
budget_range
supply_health
fill_confidence
constraints_retained[]
constraints_relaxed[]
tradeoffs[]
sacrifices[]
created_at
updated_at
```

`strategy_type`：

```text
SPEED_FIRST
QUALITY_FIRST
BUDGET_FIRST
TRUSTED_FIRST
```

`status`：

```text
GENERATED
COMPARED
SELECTED
REJECTED
SUPERSEDED
```

同一 Draft 同时最多一个 `SELECTED`。

## 3.2 Commands / Events

```text
CompareDemandSolution
SelectDemandSolution
RejectDemandSolution
SupersedeDemandSolution
```

```text
DemandSolutionCompared
DemandSolutionSelected
DemandSolutionRejected
DemandSolutionSuperseded
```

方案必须显示 `what_you_gain` 与 `what_you_give_up`。Hard Requirement 不允许被方案静默放宽。

---

# 4. Demand Preview Final Confirmation

## 4.1 DemandConfirmation

```text
confirmation_id
task_draft_id
task_version
selected_solution_id
scope_confirmed
material_change_policy_confirmed
funding_authorization_confirmed
max_budget_authorization
status
confirmed_at
```

`status`：

```text
DRAFT
READY
CONFIRMED
RECONFIRMATION_REQUIRED
SUPERSEDED
```

## 4.2 Material Change

以下变化超出已授权边界时：

```text
price
time
location
scope
hard requirement
slot count
material deliverable
```

必须：

```text
DemandConfirmation.CONFIRMED
→ RECONFIRMATION_REQUIRED
→ user confirms new version
```

不能通过 Chat / background update 静默替换。

Commands：

```text
ConfirmDemandPreview
RequestMaterialReconfirmation
ConfirmMaterialChange
RejectMaterialChange
```

Events：

```text
DemandPreviewConfirmed
MaterialReconfirmationRequested
MaterialChangeConfirmed
MaterialChangeRejected
```

Funding 仍是独立 Gate；Demand confirmation 不等于 Payment success。

---

# 5. ProgressPulse Read Model

`ProgressPulse` 不是交易 Source of Truth，只是 Requester-facing projection。

```text
progress_pulse_id
task_id
slot_id optional
stage
summary
last_updated
source_event
source_event_id optional
projection_sequence
freshness
stale
next_expected_action
waiting_reason optional
```

`freshness`：

```text
FRESH
AGING
STALE
UNKNOWN
```

规则：

- 每次 UI 状态变化必须能追到 `source_event`；
- 超过 Policy TTL 标记 `STALE=true`；
- STALE 时不得继续宣称“当前有 N 人 reviewing”；
- App 从后台恢复后必须重新读取 ProgressPulse；
- Provider polling 结果必须先映射为 Domain/Projection event，再进入 UI。

---

# 6. Candidate Compare Contract

Candidate Compare 是 Task-scoped Read Model，不创建 Generic Agent Directory。

每个候选 UI state：

```text
COMPARED
SELECTED
REJECTED
INVITED
UNAVAILABLE
STALE
```

规则：

```text
SELECTED Candidate
≠ Offer Accepted
≠ Order
```

选择只影响下一步 `InviteAgent / Offer(source_type=REQUESTER_SELECTION)`。

Compare 至少显示：

```text
Must eligibility
Why matched
Availability
ETA / distance band
Reliability
Relevant verification
Relevant portfolio
Price
Sponsored label if any
Selection state
```

---

# 7. SatisfactionCapture

## 7.1 Object

```text
SatisfactionCapture
-------------------
satisfaction_id
task_id
principal_type
principal_id
outcome_assessment
quality
speed
communication
price_value
trust
process_experience
recovery_intent
reuse_intent
comment optional
status
submitted_at
updated_at
```

`outcome_assessment`：

```text
ACHIEVED
PARTIAL
NOT_ACHIEVED
```

体验维度 P0：

```text
BAD
OK
GOOD
```

P0 不强制五星；未来可以扩展量表，但不能让评分替代事实型 Outcome。

`recovery_intent`：

```text
NONE
RECOVERY
REFUND
DISPUTE
SUPPORT
```

`reuse_intent`：

```text
YES
MAYBE
NO
```

`status`：

```text
DRAFT
SUBMITTED
AMENDED
WITHDRAWN
```

## 7.2 Commands / Events

```text
SaveSatisfactionDraft
SubmitSatisfaction
AmendSatisfaction
WithdrawSatisfaction
RequestRecovery
```

```text
SatisfactionDraftSaved
SatisfactionSubmitted
SatisfactionAmended
SatisfactionWithdrawn
RecoveryRequested
```

## 7.3 Invariants

- Satisfaction 不阻塞 Settlement；
- `NOT_ACHIEVED` 不自动退款；
- `GOOD` 不自动创建 TrustedRelationship；
- Recovery 必须进入对应 Payment / Dispute / Support Domain；
- 未提交 Satisfaction 不等于负面评价。

---

# 8. RequesterMemory / Preferences

Requester Memory 必须 user-visible / editable / deletable。

## 8.1 RequesterMemoryItem

```text
memory_item_id
principal_type
principal_id
memory_type
value
source
confirmation_status
status
created_from_task_id optional
created_from_satisfaction_id optional
created_at
updated_at
deleted_at optional
```

`source`：

```text
EXPLICIT
EXPLICIT_EDIT
SATISFACTION
OUTCOME_SUGGESTED
TEMPLATE
```

`confirmation_status`：

```text
SUGGESTED
CONFIRMED
REJECTED
```

`status`：

```text
ACTIVE
DELETED
```

只有：

```text
ACTIVE + CONFIRMED
```

可以影响未来默认方案或 Clarification default。

禁止从：

```text
profile dwell time
people clicks
feed watch time
ignored recommendations
```

静默生成长期偏好。

Commands：

```text
SaveRequesterMemory
ConfirmSuggestedMemory
UpdateRequesterMemory
DeleteRequesterMemory
```

Events：

```text
RequesterMemorySaved
RequesterMemoryConfirmed
RequesterMemoryUpdated
RequesterMemoryDeleted
```

删除后后续 Matching / Recommendation 不得继续使用该项。

---

# 9. Contextual Inspiration Feedback

P1 UI 行为，但数据契约现在保留：

```text
ACTIVE
SAVED
DISMISSED
NOT_RELEVANT
```

Commands：

```text
SaveInspiration
DismissInspiration
MarkInspirationNotRelevant
```

`NOT_RELEVANT` 可以降低同类 Contextual Inspiration，但不能转换为真人 Agent 偏好或全局画像。

---

# 10. App Shell P0 Contract

## 10.1 Safe Area

所有固定 CTA / Bottom Navigation 必须支持：

```text
safe-area-inset-top
safe-area-inset-bottom
```

## 10.2 Keyboard

- Textarea/input focus 后 CTA 不得被软键盘永久遮挡；
- Draft 在键盘收起、切页、App background 后仍存在；
- 键盘 Return 不默认提交高影响 Command。

## 10.3 Back

Back 行为：

```text
visual navigation back
≠ reverse domain command
```

返回 Preview 不自动 Cancel Task；返回 Funding 不自动 Release Hold。

## 10.4 Cold Start / Resume

Cold Start 恢复：

```text
last safe route
local unsent draft
pending command status
```

不能恢复一个未经 Server ACK 的“成功态”。

Background Resume 必须重新读取：

```text
Offer status
ProgressPulse
Payment/Funding status
Order lifecycle
Safety incident
```

## 10.5 Offline Retry

所有高影响写 Command：

```text
client_command_id / idempotency_key
pending local state
server acknowledgement
retry-safe
```

Offline 时不能把：

```text
CommitTask
Payment
AcceptOffer
ConfirmCompletion
```

显示为成功。

## 10.6 Deep Link

P0 deep-link target 至少：

```text
Task
Matching Room
Offer
Order
Payment Action
Material Confirmation
Safety Case
```

打开 Deep Link 后必须重新做：

```text
auth
principal permission
current lifecycle
freshness
```

不能信任 Push payload 自带的旧状态。

## 10.7 Push / Notification Fatigue

即时 Push 只服务：

```text
Action Required
Safety
Money
Execution timing
Offer expiry where user action is required
```

普通进度变化应：

```text
Inbox / aggregation / digest
```

并继续遵守 Quiet Hours / Frequency Cap / Dedupe。

---

# 11. App Bottom Navigation

P0 Bottom Navigation：

```text
Home
Tasks
Wallet
Me
```

必须全部具备真实 Route。

Requester：

- Home → Demand Cockpit
- Tasks → Draft / Matching / Upcoming / Completed
- Wallet → Funding / Payment / Refund projection
- Me → Principal / Memory / Notification / Privacy / App settings

不得保留无行为的“装饰按钮”。

---

# 12. E2E P0 Acceptance Cases

至少通过：

1. Need textarea 输入 → 切到其他页 → 返回，内容不丢；
2. INFERRED / CONFIRMED / UNKNOWN 同时可见；
3. Clarification answer 切换后状态保留；
4. 四个 DemandSolution 都能 SELECT；非 selected 可以 REJECT；
5. Preview 三个确认条件未完成不能 Commit；
6. Material Change 强制重新确认；
7. Matching Room 能进入 Progress Detail；
8. Progress stale 时显示 STALE + source_event；
9. Candidate Compare 可保存 selected/rejected；
10. Outcome Review 后独立进入 SatisfactionCapture；
11. Satisfaction 可表达 achieved/partial/not achieved；
12. Recovery = Refund / Dispute / Support 能进入对应流程；
13. Memory 可以查看、编辑、删除；
14. Suggested Memory 未确认前不参与未来默认；
15. Inspiration 支持 Save / Dismiss / Not relevant；
16. Home / Tasks / Wallet / Me 全部可点击；
17. Back 不触发 Domain rollback；
18. Cold start 能恢复 Draft；
19. Offline 未 ACK Command 不显示成功；
20. Deep Link 打开后重新检查 current state；
21. 后台恢复后 ProgressPulse 旧数据进入 STALE；
22. Repeat ignored 不继续 nag；
23. 没有强制五星；
24. 没有假倒计时 / 假稀缺 / infinite feed。

---

# 13. Engineering Boundary

这一章完成后，Requester P0 的核心 UX 不应再通过增加新概念继续膨胀。

下一步工程化应转向：

```text
Read Model schemas
Command API contracts
Event schemas
Persistence
Navigation / App shell tests
Provider adapters
E2E automation
```

而不是继续添加 Feed、AI persona、复杂动效或新的社交功能。

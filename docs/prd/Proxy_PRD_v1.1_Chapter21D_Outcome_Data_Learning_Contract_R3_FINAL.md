# Proxy PRD v1.1
## Chapter 21D — Outcome Data / Before-After / Learning Engineering Contract

**状态**：P0 / ENGINEERING CONTRACT  
**依赖**：Canonical Registry R2 + Chapter 21A/B/C + P0 Engineering Acceptance Addendum R3 FINAL  
**目标**：让 Proxy 不只知道“任务完成了”，还能够结构化回答：真人执行产生了什么变化、什么做法有效、下一次如何更容易得到好结果。

---

# 1. North-star Data Loop

```text
Requester Need
→ Expected Outcome
→ Human Execution
→ Evidence
→ OutcomeObservation
→ OutcomeDelta
→ Requester Satisfaction
→ Recovery / Acceptance
→ Confirmed Learning
→ Next Task Better
```

长期数据优势不是照片仓库，而是：

```text
Need
× Context
× Requirement
× Capability
× Execution
× Evidence
× OutcomeObservation
× OutcomeDelta
× Satisfaction
× Repeat
```

---

# 2. Strict Data Separation

必须区分三层：

## 2.1 Objective Fact

可直接观察 / 测量的事实，例如：

```text
queue_wait_minutes = 9
english_menu_available = true
arrival_timestamp
checklist_item_completed
```

## 2.2 Agent Assessment

真人 Agent 的现场判断：

```text
restroom_cleanliness = 4/5
food_presentation = GOOD
service_clarity = POOR
```

必须标明：

```text
observation_type = AGENT_ASSESSMENT
observer_agent_id
```

不得伪装成客观事实。

## 2.3 Requester Satisfaction

继续由现有 `SatisfactionCapture` 拥有：

```text
quality
speed
communication
value
trust
process
recovery
reuse
```

规则：

```text
Agent says GOOD
≠ objective outcome improved
≠ Requester is satisfied
```

---

# 3. ObservationTemplate

Scenario / Role 可以配置可版本化的 Observation Template。

```text
ObservationTemplate
-------------------
template_id
version
scenario_id
role_id optional
observation_targets[]
evidence_requirements[]
comparison_policy
comparison_policy_version
retention_policy_id
status
```

每个 target：

```text
target_id
label
observation_type
value_type
unit / scale optional
required
why_it_matters
allowed_evidence_types[]
privacy_constraints[]
```

模板不得因为数据库字段存在就要求 Agent 收集信息。

---

# 4. OutcomeObservation

P0 Source Object：

```text
OutcomeObservation
------------------
observation_id
principal_id
task_id
order_id optional
slot_id optional
scenario_id
template_id
template_version
target_id

observation_type:
  OBJECTIVE_FACT
  AGENT_ASSESSMENT

value_type
value
unit optional
severity optional
note optional

observer_type
observer_id
observed_at
venue/site reference optional

evidence_refs[]
source_event
confidence / provenance optional
created_at
```

规则：
- 必须 Task-bound；
- 不允许形成公开 People content；
- 不允许跨 Task 偷偷复用精确位置或私人媒体；
- Assessment 必须保留 observer provenance。

## 4.1 ObservationSet Finalization Gate

P0 必须显式区分：

```text
ObservationSet
--------------
observation_set_id
task_id
template_id
template_version
status:
  DRAFT
  FINALIZED
finalized_by optional
finalized_at optional
revision_of optional
```

状态机：

```text
RecordOutcomeObservation / AttachEvidence
→ DRAFT
→ FinalizeObservationSet
→ FINALIZED
→ CreateOutcomeComparison
```

硬规则：

- `CreateOutcomeComparison` 只能读取 `FINALIZED` ObservationSet；
- `DRAFT` 不得生成 Before / After Delta；
- `FINALIZED` 后不得直接 mutate observation value；
- 如需修正，创建新 revision / correction record，并保留旧版本审计引用；
- Finalize 与 Create Comparison 必须是两个独立命令 / 事件。

---

# 5. Evidence Boundary

`EvidenceAsset` 与 `OutcomeObservation` 不是同一个对象。

```text
Raw Evidence
→ proves / supports observation

OutcomeObservation
→ structured fact / assessment
```

例如：

```text
menu_photo.jpg
→ EvidenceAsset

english_menu_available = false
→ OutcomeObservation
```

长期数据壁垒优先保留结构化 Observation，而不是无限期保存原始媒体。

---

# 6. Media / Privacy / Retention

Raw media：

```text
photo
video
audio
precise location
```

必须使用：

```text
retention_policy_id
purpose
access scope
expiry / deletion policy
```

不得在 PRD 中硬编码某个国家固定 30 / 90 天；由 Launch Market / Legal Policy 决定。

默认禁止为了 Outcome Learning 要求：
- 顾客正脸；
- 员工无必要特写；
- 持续录像；
- Always-on GPS；
- 与 Task 无关的私人空间。

原始 Evidence 删除后，允许保留合法、可审计的结构化 Observation 与非敏感 provenance reference，具体受市场政策约束。

---

# 7. OutcomeDelta

Before / After 的 Canonical 语义：

```text
Baseline Observation
→ Result Observation
→ OutcomeDelta
```

不是简单：

```text
Before Photo
→ After Photo
```

P0：

```text
OutcomeDelta
------------
delta_id
principal_id
comparison_target_id
baseline_observation_id
result_observation_id
comparison_policy_version

delta_type:
  NUMERIC
  STATE_CHANGE
  ORDINAL
  NO_CHANGE

comparison_result:
  IMPROVED
  WORSE
  SAME
  UNKNOWN

before_value
after_value
delta_value / delta_label
confidence optional
created_at
```

可比较必须满足：
- 同一或兼容的 observation target；
- template lineage compatible；
- same Store / Venue / comparison entity when required；
- unit / scale compatible；
- 不得比较语义不同的两个指标。

`comparison_result` 必须由 `ObservationTemplate.comparison_policy_version` 决定，不得使用通用规则“值变化 = IMPROVED”。

P0 Restaurant policy 示例：

```text
queue_wait_minutes:
  NUMERIC
  LOWER_BETTER

english_menu_available:
  STATE_CHANGE
  MISSING < AVAILABLE

greeter_present:
  STATE_CHANGE
  MISSING < PRESENT

restroom_cleanliness:
  ORDINAL 1–5
  HIGHER_BETTER

food_presentation:
  ORDINAL 1–5
  HIGHER_BETTER
```

无法映射、单位不兼容、状态不在 policy 中、数据缺失时：

```text
comparison_result = UNKNOWN
```

每一个 `OutcomeDelta` 必须冻结：

```text
comparison_policy_version
```

以保证未来模板规则升级后，历史 Delta 仍可审计。

---

# 8. Restaurant Experience P0 Example

## Objective Facts

```text
queue_wait_minutes
english_menu_available
greeter_present
first_dish_wait_minutes optional
```

## Agent Assessment

```text
restroom_cleanliness 1–5
food_presentation 1–5
service_clarity 1–5
```

## Evidence

```text
entrance photo
menu photo
food presentation photo
timestamp / checklist
```

不要求顾客正脸。

示例：

```text
Queue wait
16m → 9m → -7m IMPROVED

English menu
MISSING → AVAILABLE → IMPROVED

Peak greeter
MISSING → PRESENT → IMPROVED
```

---

# 9. Learning Promotion

OutcomeDelta 不允许自动成为 Requester Memory 或 Hard Requirement。

流程：

```text
Observed Pattern
→ Suggested Learning
├→ ConfirmOutcomeLearning → CONFIRMED
└→ DismissOutcomeLearning → DISMISSED
```

P0：

```text
OutcomeLearning
---------------
learning_id
principal_id
source_delta_ids[]
summary
status:
  SUGGESTED
  CONFIRMED
  DISMISSED
  EXPIRED
confirmed_by optional
confirmed_at optional
```

Confirmed Learning 可以用于：
- 下一次 Clarification 默认建议；
- Demand Solution 推荐；
- Evidence Template 建议；
- Requester Memory；
- Business Outcome History。

禁止自动用于：

```text
Hard Requirement
Eligibility exclusion
Safety decision
Cash eligibility
```

若要升级成 Hard Requirement，必须重新进入 Requester confirmation / Material Change 规则。

---

# 10. Agent Outcome-Verified Capability

长期可以使用 Outcome 数据增强 Capability Verification，但不得只按订单数。

例如：

```text
Restaurant Experience
30 completed
24 useful outcomes
17 repeat engagements
12 verified improvements
```

`OUTCOME_VERIFIED` 必须基于 policy threshold / evidence quality / anti-gaming 规则。

订单数 / 成功执行次数只能触发：

```text
Outcome Verification Review
```

不能直接产生：

```text
QUALIFIED → PROVEN
QUALIFIED → OUTCOME_VERIFIED
```

最终 Verification 必须由独立 policy gate 生成可审计 decision。

禁止：

```text
one good rating
→ OUTCOME_VERIFIED
```

---

# 11. Business Outcome History

同一个 Business / Store / Venue 可以形成：

```text
Audit #001
→ Improvement task
→ Audit #002
→ OutcomeDelta
→ recurring issue / improvement trend
```

Business Workspace 可显示：
- repeated observation targets；
- recurring issues；
- verified improvements；
- confirmed learning；
- comparable trend。

它不是 ERP，也不是泛化 BI。

---

# 12. Commands

```text
CreateObservationTemplateVersion
RecordOutcomeObservation
AttachEvidenceToObservation
FinalizeObservationSet
CreateOutcomeComparison
ConfirmOutcomeLearning
DismissOutcomeLearning
DeleteRequesterOutcomeMemory
```

所有写命令必须：
- actor-scoped；
- task / principal scoped；
- idempotent where applicable；
- audited。

---

# 13. Events

```text
OutcomeObservationRecorded
ObservationSetFinalized
OutcomeDeltaCreated
OutcomeLearningSuggested
OutcomeLearningConfirmed
OutcomeLearningDismissed
EvidenceRetentionExpired
OutcomeMemoryDeleted
```

---

# 14. Read Models

```text
TaskOutcomeSummary
BeforeAfterComparison
BusinessOutcomeHistory
RecurringIssueSummary
AgentOutcomeCapabilitySummary
```

Read Model 不能反向拥有 Canonical Truth。

---

# 15. Matching / AI Boundary

未来模型可以学习：

```text
什么 Task / Context
+ 什么 Capability
+ 什么 Execution Pattern
→ 更可能产生好 Outcome
```

但 P0/P1 必须保证：

```text
model inference
≠ source truth
≠ hard eligibility
```

Outcome Learning 可以影响 ranking / suggestion 时，必须：
- 可解释；
- 有 provenance；
- 不使用被删除/过期/禁止的数据；
- 不把敏感媒体内容直接变成人群画像。

---

# 16. Acceptance Criteria

1. Restaurant Observation Template 区分 Objective Fact 与 Agent Assessment；
2. OutcomeObservation 绑定 Task / Template / Observer / Evidence refs；
3. ObservationSet 必须 `DRAFT → FINALIZED` 后才允许 `CreateOutcomeComparison`；
4. Before / After 使用 compatible FINALIZED Observation，而不是只拼两张照片；
5. Raw Evidence retention 与 Structured Outcome retention 分离；
6. OutcomeDelta 冻结 `comparison_policy_version`；
7. Delta 结果只允许 `IMPROVED / WORSE / SAME / UNKNOWN`，并由 Template policy 判定；
8. Suggested Learning 不自动进入 Hard Requirement；
9. Requester 可 `ConfirmOutcomeLearning / DismissOutcomeLearning / DeleteRequesterOutcomeMemory`；
10. Business Outcome History 能看到 recurring issue / verified improvement；
11. Satisfaction 仍是独立层，不覆盖 Objective Outcome；
12. 订单数只能触发 Outcome Verification Review，不得直接升级 Capability verification；
13. Agent Capability 的 Outcome Verification 不等于订单数/五星评分。

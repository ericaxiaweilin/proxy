# Proxy PRD v1.1
## Chapter 23 — Policy Defaults / Configuration Registry

**文档类型**：P0 Policy Defaults / Configuration Registry / Launch Configuration Contract  
**状态**：ACTIVE — Proposed Launch Default Set v1  
**前置依赖**：Canonical Registry、Chapter 03、Chapter 05、Chapter 06、Chapter 08、Chapter 09、Chapter 10、Chapter 11、Chapter 13、Chapter 14、Chapter 15、Chapter 17、Chapter 18、Chapter 20、Chapter 21、Chapter 22  
**后续依赖**：Chapter 24 Account Security / Privacy / Consent / Data Lifecycle、Provider Integration Contract、首发市场 Legal / Payment Review  

---

# 0. 本章目标

前面的章节已经定义了大量 Policy 概念，但没有把默认值落地。本章定义 Proxy 首发使用的：

```text
PSET_LAUNCH_V1
```

它回答：

- Candidate Set 默认多少人
- Offer Wave 如何分批、多久过期
- Matching 何时扩大距离、何时停止
- Available Now 多久自动过期
- Travel Buffer、Availability Freshness 如何计算
- Fixed / Hourly 的默认计费粒度
- Funding 何时必须 secured
- Auto-confirm、Dispute、Settlement、Payout 如何衔接
- 取消、No-show、Replacement 的默认补偿规则
- Check-in、Evidence、Precise Location 的默认 TTL
- Safety、KYC、Task Admission 的默认门槛
- Notification 的 Quiet Hours、频控和提醒时间
- Business Approval、Budget、Operator Case 的默认行为

本章的原则：

```text
没有默认值 = 不能进入 Active Launch
有默认值 = 仍必须 versioned / auditable / snapshot-bound
市场或法律需要调整 = 新建 PolicySetVersion，不原地改旧版本
```

---

# 1. 状态与适用范围

## 1.1 默认值的状态

本章给出的值是：

```text
首发默认建议
```

在具体 Market Launch 前，必须完成：

```text
Market approval
Payment / PSP review
Safety review
Legal / compliance review
Operations sign-off
```

未完成审批前：

```text
PolicySet.status = REVIEW_REQUIRED
```

通过后：

```text
PolicySet.status = APPROVED
```

进入受控试点：

```text
PolicySet.status = PILOT
```

正式首发：

```text
PolicySet.status = ACTIVE
```

## 1.2 P0 默认覆盖范围

本章覆盖：

```text
Core Graph
Matching
Availability
Pricing
Payment
Settlement
Cancellation / Refund
Execution / Evidence
Safety / Risk / Admission
Location / Contact
Notification
Business
Operator
```

不在本章最终锁定：

```text
具体首发城市
具体法定税率
具体 PSP / KYC / Map / Push Provider
法律意见
账户完整生命周期 enum
完整 API / Event schema
```

## 1.3 Market override 原则

市场配置可以：

```text
收紧安全门槛
缩短敏感数据 TTL
降低 Agent 暴露频率
提高最低验证要求
提高 Operator 审核覆盖
```

市场配置不能：

```text
绕过 Funding Before Paid Order
降低 Must Capability 为 Nice
扩大 D4 / D5 暴露
让 Trusted 绕过 Safety
让 Operator 直接改 Ledger
让 AI 成为交易真相
```

---

# 2. Policy Constitution

## 2.1 不可配置硬规则

以下不是 Policy Default，而是 Canonical Invariant，任何配置都不能关闭：

```text
1 TaskSlot = 1 atomic human position
1 TaskSlot → max 1 active Order
Funding secured before paid Order
Ledger first
Eligibility before Ranking
No Task, no generic people search
Trusted does not bypass current eligibility / safety
Precise Location = Order-bound + Purpose-bound + TTL + Audit
Order Chat is not generic social chat
Operator uses Domain Command, not database patch
Operator cannot accept Offer for Agent
Operator cannot invent Evidence
AI is not system truth
```

## 2.2 Policy 影响层级

执行时按以下优先级计算：

```text
Canonical Invariant / Legal Hard Stop
→ Market Policy
→ PolicySetVersion
→ Catalog / Template Binding
→ Business Configuration within allowed range
→ Task / Order Snapshot
→ Runtime Risk Decision
```

低层级配置不能放宽高层级限制。

## 2.3 Policy 决策与状态分离

Policy 负责：

```text
what is allowed
when it expires
which threshold applies
what command is required
```

Policy 不直接成为：

```text
Task lifecycle
Order lifecycle
Payment ledger
RiskDecision
Agent reliability score
```

---

# 3. PolicySetVersion 数据模型

## 3.1 Launch Policy Set

建议字段：

```text
policy_set_version_id
policy_set_key
market_id
catalog_version_id
status
effective_at
retired_at
parent_version_id
approved_by[]
approval_record_refs[]
change_id
change_reason
created_at
updated_at
```

首发默认：

```text
policy_set_key = PSET_LAUNCH_V1
status = REVIEW_REQUIRED → APPROVED → PILOT → ACTIVE
parent_version_id = null for first launch version
```

## 3.2 PolicyDefinition

```text
policy_id
policy_type
policy_version
scope_type
scope_id
parameters
constraints
effective_at
status
```

`policy_type` 使用 Canonical Registry 的正式名称：

```text
MatchingPolicy
CandidateSetPolicy
OfferWavePolicy
ExposureFairnessPolicy
SponsoredPolicy
AvailabilityPolicy
TravelFeasibilityPolicy
PricingMarketPolicy
CompensationPolicy
FundingPolicy
SettlementPolicy
CancellationPolicy
RefundPolicy
PayoutPolicy
CheckinPolicy
EvidencePolicy
CompletionPolicy
AutoConfirmPolicy
ProhibitedTaskPolicy
TaskAdmissionPolicy
RiskPolicy
HighRiskTaskPolicy
LocationAccessPolicy
ContactAccessPolicy
NotificationPolicy
FrequencyCapPolicy
QuietHoursPolicy
BusinessPermissionPolicy
BusinessApprovalPolicy
BudgetPolicy
OperatorAccessPolicy
ManualAdjustmentPolicy
CaseRoutingPolicy
```

## 3.3 参数单位

每一个值必须明确单位和类型：

```text
duration_seconds
distance_meters
count
percentage_basis_points
money_minor_units
boolean
enum
set / list
```

禁止使用无法判断单位的字段：

```text
ttl = 5
radius = 8
cap = 20
```

必须写成：

```text
offer_ttl_seconds = 420
initial_radius_meters = 3000
sponsored_visible_cap_percent = 20
```

## 3.4 Snapshot 规则

以下对象创建或进入下一关键状态时，必须保存 Policy Snapshot：

```text
Task committed
TaskSlot opened
Offer sent
Offer accepted
Order created
Order cancelled
Evidence submitted
Completion confirmed
Refund approved
Settlement created
Payout initiated
Operator high-impact command executed
```

Snapshot 至少包含：

```text
policy_set_version_id
policy_ids[]
policy_versions[]
catalog_version_id where relevant
graph_version where relevant
snapshot_at
```

---

# 4. Launch Policy Bundle 总表

| Domain | Default Policy ID | P0 默认状态 | 是否交易快照 |
|---|---|---|---|
| Graph | `GRAPH_LAUNCH_V1` | ACTIVE | Task / Offer |
| Matching | `MATCH_LAUNCH_STANDARD_V1` | ACTIVE | MatchAttempt / Offer |
| Candidate Set | `CANDIDATE_SET_LAUNCH_V1` | ACTIVE | Candidate snapshot |
| Offer Wave | `OFFER_WAVE_LAUNCH_V1` | ACTIVE | Offer |
| Availability | `AVAILABILITY_LAUNCH_V1` | ACTIVE | Offer / Order recheck |
| Travel | `TRAVEL_FEASIBILITY_LAUNCH_V1` | ACTIVE | MatchAttempt / Order |
| Pricing | `PRICING_MARKET_LAUNCH_V1` | REVIEW_REQUIRED | Quote / Compensation |
| Compensation | `COMPENSATION_LAUNCH_V1` | REVIEW_REQUIRED | TaskSlot |
| Funding | `FUNDING_LAUNCH_V1` | REVIEW_REQUIRED | Task / Order |
| Settlement | `SETTLEMENT_LAUNCH_V1` | REVIEW_REQUIRED | Order / Settlement |
| Cancellation | `CANCEL_STANDARD_BUSINESS_SHIFT_V1` | REVIEW_REQUIRED | Task / Order |
| Execution | `CHECKIN_LAUNCH_V1` | ACTIVE | Order |
| Evidence | `EVIDENCE_LAUNCH_V1` | ACTIVE | Order / Evidence |
| Safety | `SAFETY_LAUNCH_V1` | REVIEW_REQUIRED | Task / Order / Case |
| Location | `LOCATION_ACCESS_LAUNCH_V1` | ACTIVE | Grant |
| Notification | `NOTIFICATION_LAUNCH_V1` | ACTIVE | Notification |
| Business | `BUSINESS_WORKSPACE_LAUNCH_V1` | ACTIVE | Business Task |
| Operator | `OPERATOR_LAUNCH_V1` | ACTIVE | Command / Audit |

`REVIEW_REQUIRED` 表示参数已有明确默认，但仍需市场 / 支付 / 安全审批后才可进入交易链。

## 4.1 Chapter 22 Template Binding Profiles

Chapter 22 使用的细粒度 `*_V1` 名称是 Template Binding Profile，不是新的 Domain Object。它们必须解析到本章的正式 Policy：

| Template Binding Profile | 正式 Policy | 默认差异 |
|---|---|---|
| `MATCH_EVENT_ROLE_V1` | `MATCH_LAUNCH_STANDARD_V1` | Event Role、商业 / 公开 Venue |
| `MATCH_MULTI_SLOT_EVENT_V1` | `MATCH_LAUNCH_STANDARD_V1` + `OFFER_WAVE_LAUNCH_V1` | Multi-slot；每 Slot 独立 Wave |
| `MATCH_LANGUAGE_PAIR_AND_TRAVEL_V1` | `MATCH_LAUNCH_STANDARD_V1` + `TRAVEL_FEASIBILITY_LAUNCH_V1` | 语言对 Must；Travel 必须通过 |
| `MATCH_ROLE_AND_TRAVEL_V1` | `MATCH_LAUNCH_STANDARD_V1` + `TRAVEL_FEASIBILITY_LAUNCH_V1` | Role / Travel 硬门槛 |
| `MATCH_ROLE_TRAVEL_AND_VENUE_V1` | `MATCH_LAUNCH_STANDARD_V1` + `TRAVEL_FEASIBILITY_LAUNCH_V1` | Role、Travel、Venue 同时校验 |
| `PRICE_FIXED_SHIFT_V1` | `PRICING_MARKET_LAUNCH_V1` + `COMPENSATION_LAUNCH_V1` | FIXED per Slot / shift |
| `PRICE_FIXED_SHIFT_OR_HOURLY_V1` | `PRICING_MARKET_LAUNCH_V1` + `COMPENSATION_LAUNCH_V1` | Cell 可选 FIXED / HOURLY |
| `PRICE_HOURLY_OR_FIXED_V1` | `PRICING_MARKET_LAUNCH_V1` + `COMPENSATION_LAUNCH_V1` | Role / Template 可选 |
| `PRICE_HOURLY_OR_FIXED_VISIT_V1` | `PRICING_MARKET_LAUNCH_V1` + `COMPENSATION_LAUNCH_V1` | Visit 可选 FIXED / HOURLY |
| `PRICE_HOURLY_WITH_MINIMUM_DURATION_V1` | `PRICING_MARKET_LAUNCH_V1` + `COMPENSATION_LAUNCH_V1` | HOURLY + minimum duration |
| `CHECKIN_QR_OR_REQUESTER_CONFIRM_V1` | `CHECKIN_LAUNCH_V1` | QR / Requester Confirm 至少一种 |
| `CHECKIN_REQUESTER_CONFIRM_OR_QR_V1` | `CHECKIN_LAUNCH_V1` | Requester Confirm / QR 至少一种 |
| `EVID_EVENT_GREETER_V1` | `EVIDENCE_LAUNCH_V1` | Check-in + Checklist / Confirm |
| `EVID_EVENT_SUPPORT_V1` | `EVIDENCE_LAUNCH_V1` | Check-in + Checklist + Contact Confirm |
| `EVID_INTERPRETER_V1` | `EVIDENCE_LAUNCH_V1` | Check-in + Requester Confirm；不录音录像 |
| `EVID_SITE_VISIT_V1` | `EVIDENCE_LAUNCH_V1` | Check-in + Visit Handoff；照片需显式允许 |
| `EVID_BUSINESS_ASSISTANT_V1` | `EVIDENCE_LAUNCH_V1` | Check-in + Checklist / Confirm |
| `COMMERCIAL_OR_PUBLIC_VENUE_ONLY_V1` | `LOCATION_ACCESS_LAUNCH_V1` | 仅商业 / 公开 Venue |
| `COMMERCIAL_OR_PUBLIC_EVENT_VENUE_V1` | `LOCATION_ACCESS_LAUNCH_V1` | 允许商业活动 / Event Venue |
| `BUSINESS_OR_PUBLIC_VENUE_V1` | `LOCATION_ACCESS_LAUNCH_V1` | Business Office / Commercial / Public |
| `COMMERCIAL_OR_PUBLIC_PLACE_ONLY_V1` | `LOCATION_ACCESS_LAUNCH_V1` | 禁止住宅 / 孤立地点 |
| `BUSINESS_OFFICE_OR_PUBLIC_PLACE_V1` | `LOCATION_ACCESS_LAUNCH_V1` | Business Office / Public Place |
| `CONTACT_BUSINESS_DESIGNATED_PERSON` | `CONTACT_ACCESS_LAUNCH_V1` | 只联系指定 Business 联系人 |
| `CONTACT_ORDER_BOUND_ONLY` | `CONTACT_ACCESS_LAUNCH_V1` | 不建立永久私人联系方式 |

如果 Profile 需要不同的 Hard Eligibility、资金、隐私或安全行为，必须创建新的 Policy Version，并完成审批；不能只改 Profile 名称。

---

# 5. Core Graph Policy

## 5.1 `GRAPH_LAUNCH_V1`

首发只允许 Chapter 22 已定义的 Catalog Role：

```text
ROLE_GREETER
ROLE_EVENT_ASSISTANT
ROLE_INTERPRETER
ROLE_SITE_VISIT_REP
ROLE_BUSINESS_ASSISTANT
```

Role 进入 Qualified Pool 必须同时满足：

```text
CatalogActivation = ACTIVE or PILOT
AgentRole.status = ACTIVE
AgentProfile.status = ACTIVE
all MUST Capability active
verification threshold satisfied
current Risk / Availability / Travel gate passed
```

## 5.2 Launch Verification Threshold

| Role | Must Capability 最低状态 | Offer Accept 前 | Payout 前 |
|---|---|---|---|
| GREETER | `SELF_REPORTED`；Pilot 可接受 | User KYC ≥ K1 | K2 |
| EVENT_ASSISTANT | `EVIDENCED` | User KYC ≥ K1 | K2 |
| INTERPRETER | Language Pair `EVIDENCED` | User KYC ≥ K1 | K2 |
| SITE_VISIT_REP | `EVIDENCED` | User KYC ≥ K1；Pilot Review | K2 |
| BUSINESS_ASSISTANT | `EVIDENCED` | User KYC ≥ K1；Pilot Review | K2 |

说明：

```text
K1 = IDENTITY_VERIFIED
K2 = AGENT_TRANSACTION_READY
```

Capability Verification 不得写入 KYC enum。

## 5.3 Graph 失效

以下情况立即使相关 Capability / Role 不可用于新 Offer：

```text
verification expired
verification revoked
graph node retired
agent explicitly paused role
catalog activation paused
policy binding missing
```

已有 Order 不被静默改成不存在；需要通过 Safety / Operator / Replacement 流程处理。

---

# 6. Matching Policy Defaults

## 6.1 `MATCH_LAUNCH_STANDARD_V1`

统一顺序固定为：

```text
Requirement Resolution
→ Account / Safety / Permission Gate
→ Role / Capability Eligibility
→ Verification Gate
→ Availability Gate
→ Time / Location Feasibility
→ Schedule Conflict
→ Agent Preference
→ Qualified Pool
→ Organic Ranking
→ Sponsored Adjustment
→ Finite Candidate Set
→ Invite / Offer
```

默认参数：

| 参数 | 默认值 |
|---|---:|
| `initial_radius_meters` | 3,000 |
| `radius_step_2_meters` | 5,000 |
| `radius_step_3_meters` | 8,000 |
| `max_radius_meters` | 15,000 |
| `max_radius_expansions` | 3 |
| `max_active_offers_per_agent` | 3 |
| `max_active_offer_per_agent_per_task` | 1 |
| `same_task_sibling_slot_limit` | 1 |
| `hard_requirement_relaxation` | NEVER |
| `repeat_bypass_eligibility` | false |
| `trusted_bypass_safety` | false |
| `ai_bypass_eligibility` | false |
| `rank_version_required` | true |
| `eligibility_snapshot_required` | true |

## 6.2 半径扩展

只有以下条件同时满足时，才允许进入下一半径：

```text
当前半径没有足够 Qualified Pool
当前 Wave 已完成或明确无法填充
Agent travel preference 允许更远距离
Travel Feasibility 仍然通过
没有新的 Safety / Venue 限制
Requester 页面显示供给不足或距离扩展提示
```

禁止静默：

```text
把 Agent preference 当成可忽略
把 Must Capability 当成 Nice
把私密地点扩大给更多候选人
```

## 6.3 Eligibility Cache

| Cache | 默认 TTL | 立即失效事件 |
|---|---:|---|
| Capability / Verification | 10 分钟 | verification changed / revoked |
| Availability | 60 秒 | session paused / expired / matched |
| Schedule conflict | 30 秒 | Order created / cancelled / time changed |
| Risk eligibility | 5 分钟 | new RiskDecision / Incident / restriction |
| Travel feasibility | 5 分钟 | venue / schedule / route change |
| Candidate ranking | 60 秒 | supply / task / policy / boost change |

缓存永远不是 Eligibility 的最终真相。`AcceptOffer` 必须重新检查。

## 6.4 `CANDIDATE_SET_LAUNCH_V1`

| 参数 | 默认值 |
|---|---:|
| `default_visible_candidates` | 6 |
| `minimum_visible_candidates` | 4，若 Qualified Pool 足够 |
| `maximum_visible_candidates` | 8 |
| `maximum_candidate_batches` | 3 |
| `infinite_scroll` | false |
| `full_qualified_pool_exposure` | false |
| `candidate_snapshot_ttl_seconds` | 900 |
| `minimum_organic_share_percent` | 80 |
| `maximum_sponsored_share_percent` | 20 |
| `first_candidate_must_be_organic` | true |

Qualified Pool 少于 4 时，页面必须展示真实数量和供给不足原因，不能用不合格候选人补齐数量。

## 6.5 `OFFER_WAVE_LAUNCH_V1`

### Wave Size

```text
Wave 1 = 3 Agents
Wave 2 = 5 Agents
Wave 3 = 8 Agents
maximum waves = 3
```

对于 `TaskSlot`，Wave 数量是尝试发送的 Agent 数，不是创建 Order 的数量。

### Offer TTL

| Task urgency | Offer TTL | Wave timeout | 最后可发时间 |
|---|---:|---:|---:|
| Available Now / urgent | 120 秒 | 120 秒 | start 前 10 分钟 |
| Same-day | 420 秒 | 300 秒 | start 前 30 分钟 |
| Scheduled | 900 秒 | 600 秒 | start 前 60 分钟 |

Offer 在生成时写入 `expires_at`。Push 延迟不自动延长 TTL。

### Invite TTL

```text
Curated Invite / Scheduled = 1,800 秒
Curated Invite / Same-day = 900 秒
Curated Invite / Urgent = 300 秒
```

### Wave 规则

```text
one slot → one active MatchAttempt
one agent / one task sibling slot at a time
first valid accept wins slot
other accepted-in-flight attempts → ASSIGNMENT_LOST
last wave fails → EXHAUSTED or replacement / operator path
```

## 6.6 Matching Deadline

默认：

```text
Scheduled Task: start_at - 60 min
Same-day Task: start_at - 30 min
Urgent Task: start_at - 10 min
```

Deadline 后：

```text
不再自动扩大半径
不再自动放宽要求
可进入 Operator Match Assist
可向 Requester 提供调整时间 / 补偿 / 取消选项
```

## 6.7 `EXPOSURE_FAIRNESS_LAUNCH_V1`

默认：

```text
unanswered_offer_cap_per_agent_per_hour = 3
same_agent_repeat_impression_cooldown = 30 min
new_agent_exploration_share = 10% of organic exposure where qualified
same_agent_same_task_max_impressions = 2 per MatchAttempt
```

Fairness 不能压过：

```text
Safety
Eligibility
Travel Feasibility
hard time deadline
```

## 6.8 `SPONSORED_LAUNCH_V1`

```text
qualification_bypass = false
ranking_stage = after Qualified Pool
visible_label_required = true
visible_share_cap = 20%
first_slot_protection = organic
impression_billing_before_valid_candidate = false
```

Boost 不能买到：

```text
资格
精确位置
Requester 私人联系方式
Order
```

---

# 7. Availability / Travel Defaults

## 7.1 `AVAILABILITY_LAUNCH_V1`

| 参数 | 默认值 |
|---|---:|
| `available_now_default_ttl_seconds` | 10,800（3 小时） |
| `available_now_max_ttl_seconds` | 28,800（8 小时） |
| `available_now_heartbeat_interval_seconds` | 900（15 分钟） |
| `available_now_stale_after_seconds` | 1,200（20 分钟） |
| `scheduled_window_min_duration_seconds` | 1,800（30 分钟） |
| `future_schedule_edit_cutoff_seconds` | 900（15 分钟） |
| `recurring_availability` | P1 / false |
| `available_now_forever` | false |
| `auto_expire` | true |
| `confirmed_order_blocks_window` | true |

Available Now 到期后：

```text
AvailabilitySession = EXPIRED
不再进入新 Matching
已有 Offer 不自动变成 Order
已有 Order 不因 Session 过期而取消
```

## 7.2 Work Radius

允许值：

```text
3 km / 5 km / 8 km / 15 km / Custom within market max
```

首发默认：

```text
default_work_radius_meters = 8,000
launch_max_work_radius_meters = 15,000
```

Agent 的更小偏好优先于 Requester 的更大半径。

## 7.3 `TRAVEL_FEASIBILITY_LAUNCH_V1`

| 参数 | 默认值 |
|---|---:|
| `default_travel_buffer_seconds` | 1,800（30 分钟） |
| `minimum_travel_buffer_seconds` | 900（15 分钟） |
| `site_visit_travel_buffer_seconds` | 2,700（45 分钟） |
| `route_eta_max_age_seconds` | 300（5 分钟） |
| `route_unavailable_behavior` | INELIGIBLE；允许 Operator Review |
| `continuous_tracking_required` | false |
| `remote_task_enabled` | false for Launch Catalog |

冲突判断：

```text
Task A end
+ route ETA
+ travel buffer
≤ Task B start
```

否则 Task B 不得进入 Qualified Pool。

## 7.4 Future Order 自动截断

如果 Agent 已有未来 Order：

```text
Available Now end_at
≤ next_order.start_at - route_eta - travel_buffer
```

系统必须显示截断原因，不能让 Agent 以为完整时段都可接单。

## 7.5 Minimum Pay Gate

每个 Role / Template 必须有市场化的 Earnings Floor：

```text
effective_min_pay
= max(role_floor, agent_session_floor, template_floor)
```

没有配置 Role Floor 的 Cell：

```text
不能进入 ACTIVE
```

Agent 可以设置更高的最低收入，不得降低平台或 Market 的最低保护。

---

# 8. Pricing / Compensation Defaults

## 8.1 `PRICING_MARKET_LAUNCH_V1`

P0 只启用：

```text
FIXED
HOURLY
```

默认关闭：

```text
OPEN_BIDDING
PUBLIC_AUCTION
UNBOUNDED_CUSTOM_QUOTE
LOWEST_PRICE_SORT
HIDDEN_SURGE
```

## 8.2 Fixed

适用：

```text
GREETER shift
EVENT_ASSISTANT shift
RETAIL_PROMOTION_TEAM
standard site visit
```

规则：

```text
per_slot_compensation = required
slot_group_total = sum only
fixed_amount_rounding = market_currency_minor_unit
no post-order silent amount change = true
```

## 8.3 Hourly

默认：

| Role | Minimum billable duration | Rounding unit |
|---|---:|---:|
| INTERPRETER | 2 小时 | 30 分钟 |
| EVENT_ASSISTANT | 2 小时 | 30 分钟 |
| SITE_VISIT_REP | 1 小时 | 30 分钟 |
| BUSINESS_ASSISTANT | 1 小时 | 30 分钟 |

如果实际工作少于最低时长，仍按已确认的 Minimum Duration 处理，除非 Cancellation / Safe Exit policy 另有规定。

## 8.4 `COMPENSATION_LAUNCH_V1`

每个 TaskSlot 必须生成：

```text
base_earnings
travel_allowance
urgent_premium
overtime_terms
expense_terms
platform_fee_snapshot
currency
pricing_version
```

默认：

```text
travel_policy = TRAVEL_INCLUDED
fixed_travel_allowance = only when Template explicitly binds it
urgent_premium_default_percent = 15%
urgent_premium_max_percent = 25%
overtime_requires_agent_accept = true
overtime_requires_new_funding = true
overtime_rounding_seconds = 1,800
expense_reimbursement = false for P0 unless Template explicitly enables
```

Urgent Premium：

```text
必须在 Requester Review 中单独展示
必须进入 CompensationTerms snapshot
不能后台自动增加
超过 25% 需要 Operator / Market policy review
```

## 8.5 Price Guidance

默认展示：

```text
Reference Range = comparable completed orders P25–P75
```

最低数据门槛：

```text
至少 20 个可比完成 Order
```

不足时：

```text
显示“数据不足”
不伪造价格区间
使用 Catalog / Market approved floor
```

可比维度：

```text
Role
Scenario
Geo Cell
Time Band
Duration
Verification Requirement
Urgency
```

不得使用无关敏感属性定价。

## 8.6 Budget Guard

Commit 前必须满足：

```text
sum(slot requester charge)
+ platform fee
+ configured travel / premium
≤ task_budget_cap
```

超出：

```text
不能 Commit
不能自动提高预算
不能由 Agent Accept 触发隐性加价
```

---

# 9. Funding / Payment / Settlement Defaults

## 9.1 `FUNDING_LAUNCH_V1`

默认流程：

```text
Task Review
→ PaymentIntent created
→ full requester charge authorized / secured
→ Task funding_status = SECURED
→ MatchAttempt opens
→ Offer may be sent
```

默认参数：

| 参数 | 默认值 |
|---|---:|
| `funding_required_before_matching` | true for paid Task |
| `funding_required_before_offer` | true |
| `funding_required_before_paid_order` | true |
| `partial_funding_for_multi_slot` | false for initial commit |
| `single_currency_per_order` | true |
| `funding_recheck_on_offer_accept` | true |
| `funding_revalidation_before_start_seconds` | 86,400（24 小时） |
| `funding_failure_retry_count` | 3 user-initiated attempts |
| `funding_failure_order_creation` | forbidden |

Multi-slot 默认要求整个 Task 的预算保护成功后再开始撮合。后续若市场需要按 Slot 分段授权，必须新增 Policy 版本和账本测试。

## 9.2 Funding Failure

Funding 失败时：

```text
Task 不进入正常 Matching
TaskSlot 不进入 ASSIGNED
Offer 不可被接受为 Paid Order
已有未接受 Offer 可 REVOKED
Requester 进入 Payment Action Required
```

## 9.3 Provider Degraded Mode

Payment Provider 不可用时：

```text
不创建新的 Paid Order
不重复扣款
不以客户端成功页作为资金事实
保留 PaymentIntent / provider reference
进入 Payment Case 或自动重试队列
```

## 9.4 `SETTLEMENT_LAUNCH_V1`

默认顺序：

```text
Order COMPLETED
→ Completion Review
→ Auto-confirm or Requester Confirm
→ dispute window remains open
→ Settlement PENDING
→ undisputed amount released after dispute deadline
→ Agent Earnings AVAILABLE / Payout eligible
```

默认参数：

| 参数 | 默认值 |
|---|---:|
| `requester_completion_review_window_seconds` | 86,400（24 小时） |
| `dispute_window_seconds` | 259,200（72 小时） |
| `settlement_release_before_dispute_close` | false |
| `settlement_release_after_dispute_close` | true |
| `payout_delay_after_settlement_seconds` | 86,400（24 小时） |
| `review_blocks_settlement` | false unless independent dispute / risk hold |
| `partial_undisputed_settlement` | true |
| `duplicate_payout_protection` | true |

## 9.5 Auto-confirm

默认：

```text
auto_confirm_after_evidence_seconds = 86,400
```

自动确认前必须没有：

```text
active dispute
required evidence failure
Safety Hold
Payment Hold
open completion clarification within window
```

Requester 主动 Confirm 可以提前进入 Settlement，但不能绕过资金、Risk、Dispute 和 Ledger 规则。

## 9.6 Payout

Agent 必须：

```text
KYC ≥ K2
payout account ready
no payout-specific restriction
Settlement eligible
```

Payout 失败：

```text
不回写历史 Earnings
Ledger 保留 EARNED / AVAILABLE 事实
Payout 状态进入 FAILED
允许 provider retry / support case
```

最低 Payout Threshold 由 Market currency 配置；未配置时禁止进入 ACTIVE，不允许工程自行设零。

---

# 10. Cancellation / Refund / No-show Defaults

## 10.1 统一阶段

取消 Policy 使用：

```text
BEFORE_CONFIRMATION
CONFIRMED_PRE_TRAVEL
EN_ROUTE
ARRIVED
IN_PROGRESS
```

时间分段默认：

```text
EARLY: > 24h before start
LATE: 2h–24h before start
LAST_MINUTE: < 2h before start
```

## 10.2 `CANCEL_STANDARD_BUSINESS_SHIFT_V1`

以下比例针对“未完成部分的 Agent base compensation”。平台费、PSP fee、税和促销补贴按独立 Refund Policy 计算，不能用一个总比例覆盖所有账本行。

| 场景 | Requester unused refund | Agent compensation | 默认行为 |
|---|---:|---:|---|
| 无 Order / 未接受 Offer | 100% | 0% | Funding release / refund |
| Confirmed，EARLY | 100% | 0% | 取消并释放未使用资金 |
| Confirmed，LATE | 80% | 20% | 保留 Agent cancellation compensation |
| Confirmed，LAST_MINUTE | 50% | 50% | 需要保留取消证据 |
| EN_ROUTE | 25% | 75% | 可加已批准 Travel allowance |
| ARRIVED | 0% of committed base | 100% | 进入 requester / venue no-show 或 cancellation 处理 |
| IN_PROGRESS | 按已完成部分 | 按已完成部分 | P0 使用结构化 completed portion |

## 10.3 `CANCEL_HOURLY_SUPPORT_V1`

| 阶段 | Requester unused refund | Agent compensation |
|---|---:|---:|
| 无 Order / 未接受 | 100% | 0% |
| EARLY | 100% | 0% |
| LATE | 75% | 25% |
| LAST_MINUTE | 50% | 50% |
| EN_ROUTE | 25% | 75% |
| ARRIVED | 0% of committed base | 100% |

## 10.4 `CANCEL_REVIEW_REQUIRED_SUPPORT_V1`

用于 `SITE_VISIT_REP`、HIGH_REVIEW Venue 或发生 Safety / Material Mismatch 的任务。

默认沿用 Hourly Support 比例，但以下情况进入 Operator Review：

```text
private / restricted access claim
Requester disputes Agent Safe Exit
Venue unavailable but arrival evidence exists
high-value or sensitive material allegation
compensation exceeds configured manual threshold
```

## 10.5 Agent Cancellation

默认：

```text
Agent voluntary cancellation before safe-exit evidence = base earnings 0
Slot reopens
new MatchAttempt created if time feasible
original funding carries forward
replacement does not double-charge Requester
```

以下不应默认归因于 Agent Fault：

```text
unsafe environment
illegal request
material task mismatch
Requester harassment
platform / provider failure
venue unavailable
```

## 10.6 Replacement

默认：

```text
same TaskSlot
new MatchAttempt
new Offer
new Order if accepted
funding carry-forward = true
replacement premium = explicit Requester consent
```

如果剩余时间已经不足：

```text
停止自动扩张
进入 Operator Match Assist
提供 cancel / reschedule / unfilled 选择
```

## 10.7 No-show Defaults

### Agent No-show

成立条件：

```text
expected arrival passed
arrival grace exhausted
no valid arrival evidence
no approved ExecutionException
at least one contact attempt recorded
```

默认值：

```text
arrival_grace_seconds = 600（10 分钟）
contact_attempt_minimum = 1
agent_base_compensation = 0%
requester_refund_or_replacement_funding = true
replacement_attempt = if time feasible
```

### Requester / Venue No-show

成立条件：

```text
Agent valid arrival evidence
Requester / Venue unavailable
contact attempts recorded
grace window exhausted
```

默认值：

```text
agent_base_compensation = 100%
approved_travel_allowance = preserved
requester_no_show = separate outcome
```

单一 GPS 失败不能直接判定任何一方 No-show。

---

# 11. Check-in / Evidence / Completion Defaults

## 11.1 `CHECKIN_LAUNCH_V1`

默认允许：

```text
QR_CODE
REQUESTER_CONFIRM
BUSINESS_CONFIRM
GPS_GEOFENCE as configured fallback
```

默认参数：

| 参数 | 默认值 |
|---|---:|
| `checkin_window_open_seconds_before_start` | 1,800（30 分钟） |
| `checkin_window_close_seconds_after_start` | 900（15 分钟） |
| `arrival_grace_seconds` | 600（10 分钟） |
| `default_required_signal_count` | 1 |
| `default_geofence_radius_meters` | 150 |
| `maximum_configured_geofence_radius_meters` | 300 |
| `continuous_gps_required` | false |
| `manual_with_evidence` | Operator / exception only |

Role 默认：

| Role | Required default | Fallback |
|---|---|---|
| GREETER | QR 或 Requester Confirm | GPS assisted |
| EVENT_ASSISTANT | QR 或 Business Confirm | Requester Confirm |
| INTERPRETER | Requester Confirm 或 QR | Business Confirm |
| SITE_VISIT_REP | QR 或 Requester Confirm | GPS assisted + Case |
| BUSINESS_ASSISTANT | Requester Confirm 或 QR | Business Confirm |

## 11.2 `EVIDENCE_LAUNCH_V1`

默认 Evidence 类型：

```text
CHECKIN_SIGNAL
CHECKLIST
TEXT_HANDOFF
REQUESTER_CONFIRMATION
OPTIONAL_PHOTO only when Template allows
```

默认关闭：

```text
continuous_video
continuous_audio
full_meeting_recording
background_surveillance
```

Evidence 默认可见范围：

```text
Agent
Requester / authorized Business
Platform where required
Operator with purpose / audit
```

默认不是 Public Content。

## 11.3 Required Evidence Gate

`SubmitCompletion` 之前必须：

```text
all REQUIRED Evidence present
upload status = READY
Evidence linked to Order / Deliverable
visibility policy resolved
```

缺失时只能：

```text
补交
提出受控 Exception
进入 Operator Review
```

## 11.4 `COMPLETION_LAUNCH_V1`

默认：

```text
requester_confirm_required = true
clarification_window_seconds = 43,200（12 小时）
max_clarification_cycles = 1
review_does_not_block_settlement = true
check_out_required_for_hourly = true
check_out_required_for_fixed = false unless Template binds it
```

## 11.5 `AUTO_CONFIRM_LAUNCH_V1`

```text
auto_confirm_after_evidence_seconds = 86,400（24 小时）
auto_confirm_blocked_by_active_dispute = true
auto_confirm_blocked_by_safety_hold = true
auto_confirm_blocked_by_required_evidence_failure = true
 auto_confirm_event_audited = true
 ```

---

# 12. Safety / Admission / Risk Defaults

## 12.0 `SAFETY_LAUNCH_V1`

本节的 Prohibited Task、Admission、Risk、High-risk 和 Safety Stop 规则共同构成 `SAFETY_LAUNCH_V1`。它必须与 `TaskAdmissionPolicy`、`RiskPolicy` 和 `HighRiskTaskPolicy` 分开记录，不能合并成一个公开风险分数。

## 12.1 `PROHIBITED_TASK_LAUNCH_V1`

P0 直接拒绝：

```text
illegal activity
violence / force
sexual exploitation
harassment or fraud
non-consensual surveillance
identity impersonation for fraud
medical advice / care
legal advice / representation
financial / investment advice
cash handling
high-value goods custody
identity document custody
binding contract signing
private residence without approved policy
unverified isolated location
overnight unsupervised task
```

Task Admission 不能通过改 Role 名称、自由文本或 Operator 按钮绕过。

## 12.2 `TASK_ADMISSION_LAUNCH_V1`

| 条件 | 默认 Admission |
|---|---|
| 标准商业 / 公开地点、低风险模板 | `APPROVED` 或 `NOT_REQUIRED` |
| Exhibition / crowd-heavy / late-night | `REVIEW_REQUIRED` |
| Private residence | `REJECTED` for P0 Catalog |
| Cash / high-value / sensitive document | `REJECTED` |
| Regulated professional context | `REJECTED` unless separately approved |
| Capability verification missing | `PENDING` |
| Payment readiness missing | `PENDING` |
| Requester / Business risk restriction | `REVIEW_REQUIRED` or `REJECTED` |

## 12.3 KYC Gate

| Actor / Action | 默认最低要求 |
|---|---|
| Agent 创建 Passport | K0 |
| Agent 激活低风险 Role | K1 before paid Offer acceptance |
| Agent Accept paid Offer | K1 + Capability threshold |
| Agent payout | K2 |
| Business owner Commit paid Task | Business active + owner K1 + funding ready |
| Business member Draft Task | Active Membership + `TASK_CREATE` |
| Business member Commit | `TASK_COMMIT` + budget / payment permission |
| Individual paid Task Pilot | K1 before Commit |
| High-review Task requester | K1 |

KYC、Capability Verification、Trust、Risk 仍然独立计算。

## 12.4 `RISK_LAUNCH_V1`

默认行为：

```text
WATCH = allow with monitoring
REVIEW_REQUIRED = hold new high-impact action
RESTRICTED = scope-specific ineligible
SUSPENDED = no normal marketplace action
BLOCKED = prohibited action
```

默认禁止：

```text
Risk status directly changing unrelated Capability
Risk score as public Trust score
automatic permanent ban from one unreviewed signal
full wallet freeze for unrelated risk
```

## 12.5 `HIGH_RISK_TASK_LAUNCH_V1`

如果未来通过 Legal / Safety 批准某个高风险 Template，至少需要：

```text
Requester KYC ≥ K1
Agent KYC ≥ K1
full Funding secured
enhanced Check-in
temporary Contact Grant
Operator coverage during execution window
incident path tested
```

在首发 Catalog 中，Chapter 22 已列出的高风险类型默认不开放。

## 12.6 Safety Stop

用户触发 Safety Stop 后：

```text
Order enters safety hold / controlled exception
new contact exposure stops
precise location grant is revoked when safe to do so
IncidentOpened emitted
P0_CRITICAL OperatorCase created
affected parties receive safety notification
```

Safety Stop 不自动等于最终责任判定。

---

# 13. Location / Contact / Data Exposure Defaults

## 13.1 `LOCATION_ACCESS_LAUNCH_V1`

默认 Location Visibility：

```text
Catalog / Draft = venue type + area + approximate location
Valid Task = approximate area + travel feasibility
Offer = necessary venue summary
Order = exact meeting point when required
Closed Order = revoke execution-specific location
```

默认参数：

| 参数 | 默认值 |
|---|---:|
| `candidate_precise_location_access` | false |
| `offer_precise_location_access` | false unless policy explicitly requires |
| `execution_location_grant_start_seconds_before_start` | 1,800 |
| `execution_location_grant_max_after_scheduled_end_seconds` | 7,200（2 小时） |
| `execution_location_hard_max_seconds` | 43,200（12 小时） |
| `location_cache_ttl_seconds` | 300（5 分钟） |
| `closed_order_location_access` | false |
| `historical_agent_trajectory` | false |
| `always_on_background_location` | false |

## 13.2 `CONTACT_ACCESS_LAUNCH_V1`

默认：

```text
Order-bound masked contact = true
private phone exchange by default = false
contact grant begins = start 前 2 小时
contact grant expires = Order closed or scheduled end + 2 小时
closed Order contact access = false
trusted relationship permanent contact = false
```

## 13.3 Emergency Contact

默认：

```text
purpose = safety only
grant_ttl_seconds = 3,600（1 小时）
viewer = authorized safety participant / Operator Safety team
audit_required = true
automatic public emergency dispatch = false in P0
```

## 13.4 Data Classification Guard

| Data | 默认允许页面 | 默认限制 |
|---|---|---|
| D0 | Catalog / Supply summary | 无个人精确位置 |
| D1 | Candidate / Offer | Valid Task Context |
| D2 | Passport / Candidate Detail | per-field visibility |
| D3 | Task / Order / Business | object / business scope |
| D4 | Execution / Safety / Operator | Order + purpose + TTL + audit |
| D5 | KYC / Payout / Security | restricted provider / authorized Operator |

---

# 14. Notification Defaults

## 14.0 `NOTIFICATION_LAUNCH_V1`

本节的 Quiet Hours、Frequency Cap、Offer Reminder、Task / Order Reminder 和 Deduplication 共同构成 `NOTIFICATION_LAUNCH_V1`。NotificationEvent 是事实记录，Delivery Policy 只决定发送渠道和节奏，不改变业务状态。

## 14.1 `QUIET_HOURS_LAUNCH_V1`

默认：

```text
quiet_hours_start = 22:30 local time
quiet_hours_end = 07:00 local time
timezone = active user / Task timezone as applicable
```

可以穿透 Quiet Hours 的类别：

```text
P0 safety
account security / takeover
active Order payment failure
urgent incident action
```

不能因为 Business VIP 或 Boost 穿透 Safety / Quiet Hours 规则。

## 14.2 `FREQUENCY_CAP_LAUNCH_V1`

默认：

| 通知类别 | 每小时 | 每日 | 例外 |
|---|---:|---:|---|
| Real-time Offer | 6 | 20 | Available Now 提高上限 |
| Available Now Offer | 12 | 30 | 仍受安全和疲劳保护 |
| Marketing / Content | 2 | 3 | 可关闭 |
| Order reminders | 不适用 | 按 Order lifecycle | 不重复发送 |
| Safety / Payment Critical | 不适用 | 不限但需去重 | P0_CRITICAL |

频控达到后：

```text
Inbox only
or aggregate
or next wave delay
```

## 14.3 Offer Notification

```text
Offer TTL ≥ 300s:
initial PUSH_AND_INBOX
one reminder at expires_at - 120s

Offer TTL < 300s:
initial PUSH_AND_INBOX
no reminder
```

Offer expired / revoked：

```text
更新 Inbox 状态
不重复发送已失效 CTA
```

## 14.4 Task / Order Reminder

默认：

| 事件 | 时间 |
|---|---:|
| Scheduled Order reminder | start 前 24 小时 |
| Near-start reminder | start 前 2 小时 |
| Arrival readiness | start 前 30 分钟 |
| Completion review | EvidenceSubmitted 后立即 |
| Auto-confirm reminder | auto-confirm 前 2 小时 |
| Payment failure | 事件发生后立即 |
| Replacement needed | 事件发生后立即 |

若距离 start 小于提醒间隔，则只发送仍有行动价值的提醒。

## 14.5 Aggregation / Deduplication

默认：

```text
same-type aggregation_window_seconds = 30
same object + same event dedupe = true
retry must not create duplicate InboxItem = true
```

通知事实由 `NotificationEvent` 和 `NotificationDelivery` 记录，不能由 Push provider 回执反推业务状态。

---

# 15. Business Workspace Defaults

## 15.1 `BUSINESS_WORKSPACE_LAUNCH_V1`

P0 支持角色：

```text
OWNER
ADMIN
TASK_MANAGER
OPERATIONS
BILLING
SAFETY_MANAGER
VIEWER
```

默认权限：

| Role | Draft | Commit | Payment | Multi-slot | Safety | Members |
|---|---:|---:|---:|---:|---:|---:|
| OWNER | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADMIN | ✓ | ✓ | policy-bound | ✓ | ✓ | ✓ |
| TASK_MANAGER | ✓ | budget-bound | — | ✓ | report | — |
| OPERATIONS | view / edit allowed fields | — | — | ✓ | report | — |
| BILLING | view | — | ✓ | view spend | — | — |
| SAFETY_MANAGER | view | — | — | view | ✓ | — |
| VIEWER | view | — | — | view | report | — |

所有权限还要叠加：

```text
BusinessMembership.status = ACTIVE
store scope
task scope
Risk restriction
Business policy
```

## 15.2 `BUSINESS_APPROVAL_LAUNCH_V1`

受控 Pilot 默认：

```text
multi-step approval = false
Task Manager can Commit only within Business budget / permission
Owner / Admin can Commit and approve payment
self-approval conflict = blocked when approval is enabled
```

如果 Business 开启审批：

```text
Task Draft
→ Approval Required
→ separate approver
→ CommitTask
```

Safety、Payment Integrity 和 Canonical Invariant 不受 Business Approval 降级影响。

## 15.3 `BUDGET_LAUNCH_V1`

默认：

```text
Business must have an explicit budget cap before paid Commit
Store budget scope is optional but recommended
Task budget cap is required for multi-slot Task
budget check = before Secure Funding and before material compensation increase
over-budget auto approval = false
```

Business 没有配置预算：

```text
可以保存 Draft
不能 Secure Funding
不能 Commit paid Task
```

## 15.4 Member Removal

成员变为 `REMOVED` 后：

```text
立即失去新 Business 操作权限
按 Business policy 保留必要历史只读访问
不删除 Task / Order / Payment / Trusted Team
Active Task 的 DRI / approver 必须可转移
```

---

# 16. Operator Defaults

## 16.1 `CASE_ROUTING_LAUNCH_V1`

Operator Case 默认优先级：

```text
P0_CRITICAL
P1_HIGH
P2_NORMAL
P3_LOW
```

Queue 排序：

```text
Safety severity
→ execution deadline
→ money at risk
→ Task start time
→ case age
```

不能默认按 VIP、消费额或 Boost 付费排序安全 Case。

## 16.2 默认 SLA

| Case 类型 | First Response | Mitigation / Resolution Target |
|---|---:|---:|
| Critical Safety | 5 分钟 | 30 分钟内完成保护动作 |
| Urgent Replacement | 10 分钟 | 30 分钟内给出替换 / 取消路径 |
| Payment Failure blocking Order | 30 分钟 | 4 小时 |
| Normal Dispute | 4 小时 | 72 小时 |
| Graph / Catalog Gap | 1 工作日 | 5 工作日 |
| General Support | 1 工作日 | 3 工作日 |

SLA 是运营目标，不是自动改变业务状态的理由。

## 16.3 `OPERATOR_LAUNCH_V1`

默认允许：

```text
CASE_VIEW
CASE_ASSIGN
CASE_RESOLVE
TASK_REVIEW
TASK_LIMITED_EDIT
MATCH_ASSIST
REPLACEMENT_ASSIST
PAYMENT_VIEW
PAYMENT_HOLD
REFUND_PROPOSE
SAFETY_VIEW
SAFETY_ACTION
RISK_RESTRICT
```

默认禁止：

```text
direct database patch
direct ledger edit
accept Offer for Agent
invent Evidence
silently lower Must Capability
silently reveal D4 / D5
delete immutable AuditLog
```

## 16.4 JIT Sensitive Access

默认：

```text
D4 / D5 Operator access requires reason
JIT access default TTL = 30 min
break-glass access default TTL = 15 min
all sensitive reads audited
access expiry revokes session grant
```

Break-glass 只用于：

```text
immediate safety threat
active payment integrity incident
system invariant breach
```

必须事后补充 Review 和 Audit。

## 16.5 `MANUAL_ADJUSTMENT_LAUNCH_V1`

默认：

```text
manual financial adjustment = separate request
requester != approver = true
dual control = required for every manual ledger adjustment in P0
amount / currency / reason / policy version = required
execute only after approval
ledger entry append-only
```

自动按 RefundPolicy 执行的正常退款不等于 Operator Manual Adjustment；但仍必须幂等和可审计。

---

# 17. Provider / Degraded Mode Defaults

## 17.1 通用 Provider 状态

Provider 适配器必须支持：

```text
AVAILABLE
DEGRADED
UNAVAILABLE
RECOVERING
```

Provider 状态不直接覆盖 Domain Truth。

## 17.2 Map / Route Provider

不可用时：

```text
不展示伪造 ETA
不自动扩大到未经计算的距离
Travel Feasibility = UNKNOWN / INELIGIBLE per policy
可进入 Operator Review
```

已有 Order：

```text
不强制开启持续 GPS
允许 QR / Requester Confirm / Business Confirm fallback
```

## 17.3 Push Provider

不可用时：

```text
Inbox Event 必须保留
关键 Action 进入备用渠道 if enabled
不能把未送达 Push 当作用户已读 / 已接受
```

## 17.4 Media Provider

上传失败时：

```text
Evidence = UPLOAD_FAILED / DRAFT
不能伪造 EVIDENCE_SUBMITTED
允许重试
Completion Gate 保持阻塞，除非受控 Exception
```

---

# 18. Idempotency / Retry / Reconciliation Defaults

## 18.1 Command Idempotency

所有高影响 Command 必须接受：

```text
idempotency_key
principal_context
object_version
policy_set_version_id
```

默认幂等保留期：

```text
financial commands = 7 days minimum
Offer Accept / Order commands = through Order closed + 7 days
notification commands = 72 hours
operator commands = immutable audit retention policy
```

## 18.2 Duplicate Webhook

Provider webhook 去重键：

```text
provider
provider_event_id
event_type
```

重复 webhook：

```text
return previous result
do not append duplicate ledger entry
do not create duplicate payout / refund
```

## 18.3 Reconciliation

默认：

```text
Payment reconciliation = at least daily
Payout reconciliation = at least daily
Critical mismatch alert = immediate
unreconciled money = Operator Payment Case
```

---

# 19. Policy Change / Rollback / Kill Switch

## 19.1 Change 类型

以下变化必须新建 PolicySetVersion：

```text
Offer TTL
Candidate count
Wave size
radius
Availability TTL
pricing mode / floor
funding timing
refund / compensation ratio
auto-confirm / dispute window
location / contact TTL
KYC / Risk gate
notification frequency
Business permission
Operator threshold / SLA
```

## 19.2 Effective At

新 Policy：

```text
future Task Draft uses new version after effective_at
existing Task / Offer / Order uses snapshot
new Replacement uses current policy only if replacement command allows
```

禁止追溯性修改：

```text
已经发出的 Offer TTL
已经创建的 CompensationTerms
已经发生的 Refund ratio
已经授予的 Location grant audit fact
已经写入的 Ledger
```

## 19.3 Kill Switch

每个 Launch Cell 至少有：

```text
pause_new_tasks
pause_new_offers
pause_new_orders
pause_precise_location_grants
pause_payout_initiation
force_operator_review
```

Kill Switch 默认只影响新动作：

```text
不静默删除历史
不直接取消已有 Order
不改写 Ledger
```

Safety / Payment Integrity 紧急情况下，可由受权 Operator 使用 Domain Command 保护已有 Order，并生成 Incident / Case / Audit。

---

# 20. Policy Configuration API / Read Model

## 20.1 Query

```text
GetActivePolicySet
GetPolicyDefinition
GetPolicySnapshot
GetCatalogPolicyBindings
GetEffectivePolicyForTask
GetEffectivePolicyForOrder
GetBusinessPolicyOverrides
GetOperatorPolicyScope
```

## 20.2 Configuration Command

```text
CreatePolicySetDraft
UpdatePolicyDefinition
SubmitPolicyReview
ApprovePolicySet
ActivatePolicySet
PausePolicySet
RetirePolicySet
CreateMarketOverride
ApproveMarketOverride
```

这些 Command 不得被普通 Requester、Agent 或 Business UI 调用。

## 20.3 Read Model 必备字段

```text
policy_set_version_id
policy_id
policy_version
scope
effective_at
status
parameters with units
constraints
source / approval references
explanation
```

页面必须显示对用户有意义的规则摘要，但不能暴露安全敏感的内部风控细节。

---

# 21. Launch Activation Checklist

PolicySet 从 `REVIEW_REQUIRED` 进入 `PILOT` 前必须：

```text
所有 P0 Policy 都有 ID、版本和单位
所有 Chapter 22 Template 都有 Policy Binding
所有价格 Template 都有 Market Earnings Floor
所有支付行为都有 Funding / Settlement / Refund mapping
所有 D4 / D5 访问都有 TTL / Purpose / Audit
所有高风险模板都有 Admission / Operator path
所有 Notification critical event 都有 Delivery Policy
所有 Operator 高影响动作都有 Permission / Command / Audit
Provider degraded mode 已定义
Idempotency / reconciliation 已测试
```

## 21.1 Pilot 额外 Gate

```text
50–200 real executions target
no unresolved P0 invariant breach
funding and payout reconcile
replacement path succeeds in test
No-show attribution test passes
location revocation test passes
Business A / B isolation test passes
Operator first-response coverage assigned
```

## 21.2 Active Launch Gate

```text
Policy approvals complete
Cell supply / demand gate passes
Operator coverage passes
Safety coverage passes
Payment provider readiness passes
legal / market override recorded
rollback owner assigned
```

---

# 22. Policy 级验收标准

## AC-23-01 Versioned Policy

Given 任一 Policy 影响资金、资格、安全、取消或数据暴露，  
When 该 Policy 被应用，  
Then 必须有 PolicySetVersion、effective_at、audit reference，不能读取未版本化常量。

## AC-23-02 Snapshot Isolation

Given Policy v1 创建了 Offer，  
When Policy v2 修改 Offer TTL，  
Then已有 Offer 使用 v1 snapshot，新 Offer 才使用 v2。

## AC-23-03 Candidate Limit

Given Qualified Pool 大于候选集上限，  
When Requester 打开 Matching，  
Then最多返回 8 个 Candidate，默认 6 个，不能无限滚动。

## AC-23-04 Wave Limit

Given Fast Match 为一个 Slot 运行，  
When系统发送 Offers，  
Then必须按照 3 / 5 / 8 的最多三轮 Wave 发送，不能广播全部 Qualified Agent。

## AC-23-05 Offer Expiry

Given Offer TTL 已过期，  
When Agent 点击 Accept，  
Then服务端返回 EXPIRED，不得创建 Order 或锁定 Slot。

## AC-23-06 Radius Expansion

Given 3km 内没有足够候选人，  
When系统尝试扩大范围，  
Then只能按 5km → 8km → 15km 顺序，并保留供给不足 / 扩围原因。

## AC-23-07 Hard Requirement

Given Agent 缺少 Must Capability，  
When系统进入下一 Wave，  
Then不得通过扩大半径、Boost、Trusted 或 AI 把该 Agent 加入候选人。

## AC-23-08 Availability Expiry

Given Available Now 已达到 3 小时默认 TTL，  
When没有 Agent 明确延长，  
ThenSession 自动 EXPIRED，不再进入新 Matching。

## AC-23-09 Travel Conflict

Given Agent 的两个 Order 表面上不重叠但 Travel Buffer 不足，  
WhenMatching 计算，  
Then后一个 Order 必须被判定为不可用。

## AC-23-10 Funding Gate

Given PaymentIntent 没有 SECURED，  
When Agent Accept Offer，  
Then不得创建 Paid Order。

## AC-23-11 Overtime Funding

Given执行需要加时，  
WhenRequester 尚未授权新增 Funding，  
Then不得把实际超时自动计入 Agent Earnings。

## AC-23-12 Ledger First

Given发生 Refund、Settlement 或 Payout，  
When系统处理资金变化，  
Then必须先产生可审计 Ledger / payment fact，不能直接覆盖余额。

## AC-23-13 Auto-confirm Guard

Given EvidenceSubmitted 已超过 24 小时，  
When存在 active dispute 或 Safety Hold，  
Then不得自动确认或释放争议资金。

## AC-23-14 Dispute Window

Given Order 已确认完成，  
When72 小时 dispute window 尚未结束，  
ThenSettlement 必须按 Policy 保留对应保护，不得把所有资金当作最终可提现。

## AC-23-15 Cancellation Phase

Given Requester 在不同时间阶段取消同一类 Order，  
When系统计算 Refund / Compensation，  
Then必须使用取消时的 Phase 和 Policy Snapshot，不得只读取一个全局比例。

## AC-23-16 Safe Exit

Given Agent 报告 unsafe environment 并提交合理 Evidence，  
WhenOrder 进入 Safe Exit，  
Then不得自动套用普通 Agent Fault 取消，必须进入 Exception / Safety Case。

## AC-23-17 No-show Attribution

Given GPS 信号缺失但 Agent 有 QR / Requester Confirm，  
When系统判断 No-show，  
Then不得仅凭 GPS 缺失判定 No-show。

## AC-23-18 Check-in Privacy

Given Template 只要求 QR 或 Requester Confirm，  
When Agent 执行 Task，  
Then系统不得为了方便而自动开启持续 GPS 追踪。

## AC-23-19 Evidence Gate

Given Template 要求 Checklist 和 Confirmation，  
When Agent 提交 Completion，  
Then缺任一 Required Evidence 都不能直接完成，除非受控 Exception 被批准。

## AC-23-20 Location TTL

Given Order 已结束，  
When用户打开旧 Deep Link，  
Then精确位置和临时联系方式必须不可访问或显示已撤销。

## AC-23-21 Safety Stop

Given用户触发 Safety Stop，  
When系统接受命令，  
Then必须创建 Incident / Case、保护 Order、处理 Location / Contact Grant，并记录 Audit。

## AC-23-22 Quiet Hours

Given当前时间处于 22:30–07:00，  
When发送普通 Offer Reminder，  
Then应抑制或进入 Inbox；只有 P0 Critical 事件可默认穿透。

## AC-23-23 Notification Deduplication

Given同一 Domain Event 发生重复 webhook 或 Push retry，  
When Notification 服务处理，  
Then不得创建重复 Inbox Item 或重复用户 CTA。

## AC-23-24 Business Isolation

Given用户被移出 Business A，  
When访问 Business A 的新 Task / Spend / Members，  
Then服务端拒绝新操作；历史事实按 policy 保留必要访问。

## AC-23-25 Business Budget

Given Business 没有预算上限或 Task 超预算，  
When用户 Commit paid Task，  
Then只能保存 Draft / Approval Required，不得 Secure Funding。

## AC-23-26 Approval Separation

Given Business 开启 Approval Flow，  
When Task creator 同时尝试批准自己的高影响付款，  
Then系统必须阻止自批准或要求独立 approver。

## AC-23-27 Operator JIT

Given Operator 查看 D4 / D5，  
When未提供 reason 或 JIT grant 已过期，  
Then服务端拒绝访问并写入 Audit。

## AC-23-28 Operator Dual Control

Given Operator 创建 ManualAdjustmentRequest，  
When同一 Operator 尝试审批并执行，  
Then P0 必须拒绝自审批，且不能直接改 Ledger。

## AC-23-29 Provider Degraded

Given Payment / Map / Push / Media Provider 处于 UNAVAILABLE，  
When用户执行相关操作，  
Then系统进入定义的 degraded path，不得伪造 Order、ETA、Evidence、Payment 或 Notification 已成功。

## AC-23-30 Kill Switch

Given Cell 被设置 `pause_new_orders`，  
When已有 Order 继续执行，  
Then新 Order 被阻止，已有 Order 不被静默取消，且所有动作可审计。

## AC-23-31 Reconciliation

Given Provider 重复发送支付 webhook，  
When Reconciliation 运行，  
Then不能出现重复 Ledger、Refund 或 Payout，差异必须进入 Payment Case。

## AC-23-32 Policy Explanation

Given页面因为 Policy 阻止某个动作，  
When返回错误，  
Then必须返回结构化 reason code 和用户可理解的解释，不得只显示“系统错误”。

---

# 23. 本章锁定结论

## 23.1 P0 Launch Default Set

```text
PolicySet = PSET_LAUNCH_V1
Candidate Set = default 6 / max 8
Offer Waves = 3 / 5 / 8，最多 3 Wave
Offer TTL = 2m urgent / 7m same-day / 15m scheduled
Matching Radius = 3km → 5km → 8km → 15km
Available Now TTL = 3h，最大 8h
Travel Buffer = 默认 30m
Pricing = FIXED / HOURLY
Urgent Premium = 默认 15%，上限 25%
Funding = Paid Matching 前 SECURED
Auto-confirm = 24h
Dispute Window = 72h
Payout Delay = Settlement 后 24h
Arrival Grace = 10m
Check-in Window = start 前 30m 至 start 后 15m
Location Grant = Order-bound / Purpose-bound / TTL / Audit
Quiet Hours = 22:30–07:00
Offer Push = initial + max one reminder
Operator JIT = 30m；Break-glass = 15m
Manual Financial Adjustment = always dual control in P0
```

## 23.2 必须由 Market 补齐的值

以下不能由工程自行猜测：

```text
currency code
role earnings floor
fixed / hourly amount
platform fee rate
tax / VAT
PSP fee treatment
payout threshold
manual adjustment money threshold if later relaxed
legal KYC / AML requirement
insurance requirement
market-specific prohibited service list
```

缺少这些值时，相关 Template / Cell 不能进入 `ACTIVE`。

## 23.3 后续章节

下一步进入：

```text
Chapter 24 — Account Security / Privacy / Consent / Data Lifecycle
```

Chapter 24 需要收口：

```text
UserAccount lifecycle
Signup / Login / OTP / Passwordless
Session / Device / Logout all
Recovery / Takeover
Account deletion / export
Consent Ledger
Location / Camera / Media permission
KYC document lifecycle
D0–D5 retention / deletion / legal hold
Block / Do-not-match lifecycle
Age eligibility
Business owner security
Operator sensitive-data access
```

# Proxy PRD v1.1
## Chapter 21C — Agent Earnings / Liquidity Control / Cash Settlement Engineering Contract

**状态**：P0 / Pilot Engineering Contract  
**依赖**：Canonical Registry R2 + Chapter 21A/21B  
**目标**：补齐 Agent 留存、Marketplace 供需控制和 Cash Mode；不增加泛化 Feed/社交。

## 1. Agent North Star

```text
我有时间和能力
→ 看见真实赚钱机会
→ 看懂这单值不值得
→ 安全完成
→ 按约定结算
→ Outcome 积累
→ Repeat / Trusted 增加
→ 收入逐渐可预测
```

二级 North Star：`Agent Net Earnings per Available Hour`。  
不要用 DAU、在线时长、挂机次数替代赚钱体验。

## 2. Agent 留存

```text
First Earnings
→ Reliable Earnings
→ Repeat Earnings
→ Predictable Earnings
```

平台不能保证“六项全满足”，但应优化可控项：无效 Offer 更少、时间浪费更少、结算更确定、拒绝不合适任务不受普通惩罚、表现可积累、Repeat 可转化为稳定收入。

## 3. Agent Earnings Cockpit Read Model

```text
AgentEarningsCockpit
confirmed_today
pending_earnings
withdrawable_earnings
available_window
repeat_income_share
trusted_business_count
upcoming_repeat_value
qualified_opportunity_count
```

## 4. Opportunity Economics

```text
OpportunityEconomics
task_slot_id
take_home_amount
currency
estimated_occupied_minutes
estimated_travel_minutes
estimated_wait_minutes
estimated_out_of_pocket_cost
effective_earning_per_hour
settlement_method
funding_protection_status
requester_trust_tier
requester_cancellation_signal
cash_reliability_signal
repeat_probability_band
why_fit[]
material_risks[]
last_updated
```

`effective_earning_per_hour` 是解释性估算，不是收入承诺。

## 5. AgentWorkPreference

```text
agent_profile_id
preferred_roles[]
preferred_zones[]
preferred_time_windows[]
minimum_pay
maximum_travel_distance
settlement_methods_allowed[]
avoid_task_types[]
avoid_principal_ids[]
updated_at
```

普通 Decline ≠ Reliability penalty。接受后违约、欺诈或安全问题进入其他信号体系。

## 6. 赛马机制

奖励：
- Reliable Availability
- Successful Execution
- Response Quality
- Outcome Quality
- Relevant Repeat History

不奖励：
- App 打开次数
- 挂机时长
- 无意义签到
- 购买 qualification

原则：`Reward Contribution ≠ Reward Power`。

## 7. Newcomer Protection

`Unknown ≠ Poor`。

```text
KYC Ready
+ Role Qualified
+ Availability Valid
+ Risk Clear
→ New Qualified
→ Protected Exploration
```

保底的是 Qualified Exposure，不是保证订单/保证收入。比例由 Liquidity Cell 动态配置。

## 8. Liquidity Cell

控制维度：

```text
Geo Zone × Time Window × Role/Capability × Price Band
```

状态：

```text
OVERSUPPLIED
HEALTHY
TIGHT
SHORTAGE
CRITICAL_SHORTAGE
```

输入至少包括：
`open_demand_slots / qualified_supply / active_supply / fill_rate / time_to_fill / offer_acceptance / utilization / cancellation / price / newcomer_share / repeat_share / freshness`

输出：
`SupplyAdmissionPolicy / SupplyActivationPolicy / NewcomerExposurePolicy / BoostInventoryPolicy / DemandShapingPolicy / AcquisitionPolicy`

## 9. Oversupplied

Supply >> Demand 时：
- Admission → CONTROLLED / WAITLIST
- 降低 acquisition
- 提高 Opportunity Quality
- 引导到其他 Role/Area/Time
- 保留新人探索
- Boost 可 LIMITED / DISABLED

禁止制造假 Demand / 假稀缺。

## 10. Shortage

Demand >> Supply 时：
- Demand Pulse
- Dormant Agent activation
- Targeted acquisition
- Referral
- Geo/Time expansion
- Reward uplift
- Operator sourcing
- Requester Demand Shaping

Reward uplift 必须显示 base / uplift / reason / source / last_updated。Hard Requirement 不自动放宽。

## 11. Boost

Boost 继续保留，但必须 Liquidity-controlled：

```text
ENABLED
LIMITED
DISABLED
```

Boost 买曝光，不买资格，也不保证订单。

## 12. Requester Contribution

好 Demand 也应获得更好的供给响应。正向信号：
- Task clarity
- 合理价格
- Settlement commitment
- 低 Material Change
- 及时确认
- 低取消
- Repeat demand
- Cash reliability

但不能因为花钱多就绕过 Safety / Agent consent。

## 13. SettlementMethod

P0：

```text
PLATFORM_PAY
CASH_ON_SITE
```

Reserved：

```text
LOCAL_TRANSFER_ON_SITE
PROTECTED_CASH
```

Settlement Method 必须在 Agent Accept 前冻结在 Compensation / Accepted Snapshot 中。

## 14. Cash Mode

`Cash ≠ off-platform`。

即使现场现金，Task / Slot / Offer / Order / Snapshot / Execution / Evidence / CashSettlement / Satisfaction / Outcome 全部仍在 Proxy。

Cash Offer 必须显示：
- CASH_ON_SITE
- NOT platform-funded
- agreed amount
- overtime/travel rule
- Cash Eligibility
- Requester cash reliability

不得显示 Funding Protected。

## 15. CashEligibilityDecision

```text
ALLOW
ALLOW_WITH_LIMIT
PLATFORM_PAY_REQUIRED
REVIEW
```

输入：Task risk、category、amount、Requester/Agent trust-risk、cash dispute history、region/legal policy。

## 16. CashSettlement

```text
cash_settlement_id
order_id
currency
amount_due
amount_snapshot_ref
adjustment_refs[]
status
requester_confirmation
agent_confirmation
payment_due_at
requester_confirmed_at
agent_confirmed_at
dispute_case_id?
created_at
updated_at
```

Status：

```text
PENDING_EXECUTION
PAYMENT_DUE
AWAITING_COUNTERPART
SETTLED
DISPUTED
CANCELLED
WAIVED
```

Requester：
`PENDING / MARKED_PAID / DISPUTED`

Agent：
`PENDING / MARKED_RECEIVED / DISPUTED`

只有 `MARKED_PAID + MARKED_RECEIVED` 才能 SETTLED；任一 DISPUTED → DISPUTED。

## 17. Commands

```text
SelectSettlementMethod
AcceptCashTerms
FinalizeCashAmount
MarkCashPaid
MarkCashReceived
DisputeCashSettlement
ResolveCashDispute
RestrictCashEligibility
```

必须 idempotent、actor-scoped、order-scoped、audited。禁止直接 PATCH `cash_status=SETTLED`。

## 18. Events

```text
SettlementMethodSelected
CashEligibilityEvaluated
CashSettlementCreated
CashAmountFinalized
CashMarkedPaid
CashMarkedReceived
CashSettlementSettled
CashSettlementDisputed
CashEligibilityRestricted
```

Cash outcome 可以产生 Reliability/Risk Signal，但 signal ≠ final RiskDecision。

## 19. Agent Metrics

建议：
- First Earning Conversion
- Availability Repeat Rate
- Qualified Offer Rate
- Offer Acceptance Rate
- Net Earnings / Available Hour
- Time Wasted / Completed Order
- Payout Reliability
- Cash Settlement Clean Rate
- 30-day Earned Retention
- Repeat Income Share
- Trusted Relationship Growth

关键指标：**30-day Earned Retention** = 首月赚到钱的 Agent，第二个月仍通过 Proxy 获得真实收入的比例。

## 20. Anti-patterns

禁止：
`fake demand / fake scarcity / fake countdown / normal decline penalty / infinite job feed / sell qualification / pay-to-win ranking / fake guaranteed jobs / hide cash risk / cash black hole`

## 21. P0 Acceptance

必须验证：
1. Earnings Cockpit 可见；
2. Offer 有 Opportunity Economics；
3. Work Preferences 可修改；
4. Newcomer 有 Protected Exploration；
5. Liquidity Cell 可切 Oversupplied/Healthy/Shortage；
6. Cell Policy 联动 Admission/Activation/Newcomer/Boost；
7. Settlement Method 可选 Platform/Cash；
8. Cash Offer 明确 NOT platform-funded；
9. Cash 完成后 PAYMENT_DUE；
10. Requester/Agent 分别确认；
11. 双方一致才 SETTLED；
12. 任一异议进入 DISPUTED；
13. Cash 仍进入 Outcome/Satisfaction/Repeat；
14. Platform Pay 仍 Funding Secured before Order；
15. Cash 不绕过 Eligibility/Safety/Risk。

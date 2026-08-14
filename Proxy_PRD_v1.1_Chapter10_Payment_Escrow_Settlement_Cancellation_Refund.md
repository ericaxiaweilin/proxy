# Proxy PRD v1.1
## Chapter 10 — Payment / Escrow / Settlement / Cancellation / Refund

**文档类型**：增量细化 PRD  
**前置依赖**：
- Chapter 03 — Task / TaskSlot / Order State Machine
- Chapter 06 — Fast Match / Offer Engine
- Chapter 09 — Pricing / Quote / Marketplace Economics

**本章范围**：
- Funding Gate
- Payment Intent / Authorization
- Escrow / Held Funds
- Settlement
- Agent Earnings Ledger
- Requester Payment Ledger
- Platform Fee Recognition
- Cancellation
- Refund
- No-show
- Replacement
- Overtime / Adjustment
- Dispute Freeze
- Promotion / Subsidy
- Payout
- Audit / Idempotency / Reconciliation

**本章不细化**：
- 具体支付服务商
- 银行 / 钱包 API
- 国家税务申报
- 发票格式
- KYC / AML 细则
这些根据上线市场和支付供应商后单独设计。

---

# 1. 本章目标

Payment 系统必须保证：

```text
Requester
→ 知道什么时候扣钱、为什么扣、可以退多少

Agent
→ 接单前知道赚多少，并确认资金有保障

Proxy
→ 每一笔资金流都可追踪、可审计、可对账
```

核心原则：

> **Payment State 不得依赖 UI 文案或 Order Status 隐式推断。**

---

# 2. 三条资金主链

必须分开：

## 2.1 Requester Money

```text
Requester
→ Authorization / Capture
→ Held Funds
→ Settlement / Refund
```

## 2.2 Agent Earnings

```text
Completed Order
→ Earnings Accrued
→ Available
→ Payout
```

## 2.3 Platform Revenue

```text
Service Fee
→ Earned
→ Recognized
```

三者必须分别记账。

---

# 3. Payment Domain Objects

推荐：

```text
PaymentIntent
FundingHold
PaymentLedgerEntry
AgentEarningsLedger
Refund
Payout
Settlement
FeeLedger
PromotionLedger
DisputeHold
```

---

# 4. PaymentIntent

表示：

> Requester 对 Task / Order 的支付意图。

Schema：

```text
payment_intent_id
principal_type
principal_id

task_id optional
order_id optional

currency
amount

status
payment_method_reference

pricing_snapshot_id
fee_snapshot_id

created_at
updated_at
```

---

# 5. PaymentIntent Status

```text
CREATED
REQUIRES_ACTION
AUTHORIZED
CAPTURED
PARTIALLY_CAPTURED
FAILED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED
```

---

# 6. FundingHold

表示：

> 已为某个 Task / Order 锁定可用资金。

Schema：

```text
funding_hold_id
task_id
order_id optional

authorized_amount
captured_amount
released_amount
refunded_amount

currency
status

expires_at
created_at
updated_at
```

---

# 7. Funding Status

推荐：

```text
PENDING
AUTHORIZED
SECURED
PARTIALLY_SECURED
FAILED
RELEASED
REFUNDED
PARTIALLY_REFUNDED
```

---

# 8. Order Creation Funding Gate

正式锁定：

> **任何需要 Requester 付费的 Order，在创建前必须满足 Funding Gate。**

也就是：

```text
Agent Accept
+
Slot Atomic Lock
+
Funding Secured
=
Order Created
```

如果：

```text
Funding FAILED
```

则：

```text
Order not created
```

---

# 9. Funding Strategy

P0 推荐：

```text
Task Commit
→ authorize estimated amount

Order Create
→ allocate / capture required amount
```

多人任务：

```text
Task-level authorization
→ per Order allocation
```

---

# 10. 为什么不等完成后再收费

如果：

```text
Agent 已经出门工作
```

Requester 才发现：

```text
支付失败
```

平台会失去供给信任。

因此必须：

> **先确保资金，再让真人正式进入履约。**

---

# 11. Multi-slot Funding

例如：

```text
5 Slots
```

可以：

```text
authorize total estimated charge
```

然后随着 Order 创建：

```text
allocate per Slot
```

---

# 12. Partial Fill Funding

如果：

```text
5 required
只 fill 4
```

未形成 Order 的 Slot：

```text
unused authorization
```

最终：

```text
release / cancel
```

不能当成平台收入。

---

# 13. Funding Expiry

如果支付供应商 Authorization 有时效：

系统必须：

```text
renew
or
re-authorize
```

不能让已确认未来 Task 在执行前突然失去资金保障。

---

# 14. Payment Snapshot

Order 创建时必须冻结：

```text
pricing_snapshot
fee_snapshot
promotion_snapshot
cancellation_policy_snapshot
```

---

# 15. Ledger-first 原则

正式硬规则：

> **任何资金变化必须追加 Ledger Entry，不允许通过直接覆盖余额表达历史。**

---

# 16. Requester Payment Ledger

例如：

```text
AUTHORIZE +3,850,000
CAPTURE +3,850,000
REFUND -650,000
```

---

# 17. Agent Earnings Ledger

例如：

```text
ORDER_EARNED +600,000
TRAVEL_ALLOWANCE +100,000
CANCELLATION_COMP +200,000
ADJUSTMENT -50,000
PAYOUT -850,000
```

---

# 18. Platform Fee Ledger

例如：

```text
SERVICE_FEE_EARNED +60,000
SERVICE_FEE_REFUND -20,000
BOOST_REVENUE +100,000
```

---

# 19. Promotion Ledger

例如：

```text
PLATFORM_SUBSIDY +100,000
MERCHANT_SUBSIDY +50,000
```

用于说明：

> Requester 少付的钱来自哪里。

---

# 20. Agent Earnings Status

推荐：

```text
PENDING
EARNED
AVAILABLE
PAYOUT_PENDING
PAID
REVERSED
HELD
```

---

# 21. PENDING

Order 已确认，但尚未满足收入确认条件。

---

# 22. EARNED

任务完成且达到收入确认条件。

---

# 23. AVAILABLE

已过必要 Dispute / Review Window，可以提现。

---

# 24. HELD

出现：

```text
Dispute
Risk Review
Fraud Check
```

暂时不可 payout。

---

# 25. PAID

已经成功 payout。

---

# 26. Payout

Payout 独立对象：

```text
payout_id
agent_id
currency
amount

status

payout_method_reference
provider_reference

created_at
processed_at
```

---

# 27. Payout Status

```text
REQUESTED
PROCESSING
PAID
FAILED
REVERSED
```

---

# 28. Agent Wallet

Agent UI 可以展示：

```text
Pending Earnings
Available to Withdraw
Paid Out
```

不要只展示一个总余额。

---

# 29. Requester Wallet / Credits

如果未来支持：

```text
Refund Balance
Promo Credit
```

必须区分：

```text
Cash-equivalent refundable balance
vs
Promotional Credit
```

---

# 30. Settlement

Settlement 表示：

> 一个 Order 的最终资金分配。

Schema：

```text
settlement_id
order_id

requester_paid
agent_earned
platform_fee
travel
premium
promotion
refund

currency

status
settled_at
```

---

# 31. Settlement Status

```text
PENDING
PARTIAL
SETTLED
REVERSED
DISPUTED
```

---

# 32. Completion → Settlement

典型 P0：

```text
Order COMPLETED
↓
Completion Review / Dispute Window
↓
Agent Earnings EARNED
↓
Platform Fee EARNED
↓
Settlement
```

---

# 33. Auto-release

可以支持：

```text
Requester does nothing
```

达到：

```text
auto_confirm_at
```

后：

```text
auto complete / settle
```

避免 Agent 永远等确认。

---

# 34. Requester Confirmation

Requester 可以：

```text
Confirm Completion
```

加速：

```text
Settlement
```

---

# 35. Dispute Window

每个 Order 需要：

```text
dispute_deadline
```

具体时长按市场 / Role 配置。

---

# 36. Cancellation Policy

取消费用不能只有一个比例。

必须至少考虑：

```text
Who cancelled
When
Order state
Agent committed effort
Travel started?
Arrived?
Task started?
```

---

# 37. Cancellation Actor

```text
REQUESTER
AGENT
BUSINESS
PLATFORM
SYSTEM
```

---

# 38. Cancellation Phase

推荐：

```text
BEFORE_CONFIRMATION
AFTER_CONFIRMATION
PRE_TRAVEL
EN_ROUTE
ARRIVED
IN_PROGRESS
```

---

# 39. Requester Cancellation Principle

> **越接近执行、Agent 已投入越多，Agent 保护越强。**

---

# 40. Agent Cancellation Principle

> **Agent 有取消权，但越接近执行，平台需要更快 Replacement，并可能影响 Reliability。**

具体 Reputation 规则后续 Trust 章节细化。

---

# 41. Cancellation Rule Engine

推荐：

```text
CancellationPolicy
```

字段：

```text
policy_id
market
role
phase

requester_refund_ratio
agent_compensation_ratio
platform_fee_rule

effective_at
version
```

---

# 42. 不在核心代码写死取消比例

例如：

```text
24h = 100%
12h = 50%
```

这种具体值必须配置化。

---

# 43. Requester Cancels Before Agent Accept

如果还没有 Order：

```text
No Agent Compensation
```

未使用 Funding：

```text
release
```

---

# 44. Requester Cancels Confirmed Order

根据 Policy：

可能：

```text
Requester partial refund
Agent cancellation compensation
Platform service fee partial retain
```

---

# 45. Requester Cancels EN_ROUTE

Agent 已经出发：

通常应有更高：

```text
Agent Compensation
```

并保留：

```text
travel evidence
```

---

# 46. Requester Cancels ARRIVED

Agent 已经到场：

一般视为较高投入。

系统必须支持：

```text
arrival-based compensation
```

---

# 47. Cancellation During IN_PROGRESS

此时应区分：

```text
completed portion
remaining portion
```

P0 可以使用简化规则。

P1 支持：

```text
partial work settlement
```

---

# 48. Agent Cancels

Agent 主动取消：

```text
Order CANCELLED
Slot REOPEN
Replacement MatchAttempt
```

钱流：

Requester 的未履约部分：

```text
retain for replacement
or
release/refund
```

取决于 Task 是否继续。

---

# 49. Replacement Funding

重要：

> **Replacement 不应该要求 Requester 为同一个 Slot 重复支付两次，除非存在明确额外费用。**

原 Slot Funding 可以：

```text
carry forward
```

到 Replacement Order。

---

# 50. Replacement Premium

如果紧急替补需要：

```text
urgent premium
```

必须：

```text
Requester explicit authorization
```

不能后台自动超预算。

---

# 51. Agent Cancellation Compensation

正常情况下 Agent 自己取消：

```text
no base earnings
```

但如果存在：

```text
platform-caused issue
unsafe requester
invalid task
```

可能是：

```text
Platform / Requester cancellation
```

不能错误归因给 Agent。

---

# 52. No-show

No-show 必须结构化。

---

# 53. Agent No-show

定义建议：

```text
Agent failed to arrive
+
no valid exception
+
required confirmation / grace window exhausted
```

---

# 54. Requester No-show

某些 Task 也可能：

```text
Requester / venue unavailable
Agent arrives but cannot execute
```

必须支持：

```text
REQUESTER_NO_SHOW
```

不能全部算 Agent 失败。

---

# 55. No-show Evidence

可能：

```text
GPS check-in
chat
call attempts metadata
venue confirmation
timestamp
```

---

# 56. Agent No-show Money Flow

典型方向：

```text
Requester refund / replacement funding preserved
Agent earnings = 0 or adjusted
Platform fee adjusted
```

具体规则配置。

---

# 57. Requester No-show Money Flow

如果 Agent 已合理到场：

应支持：

```text
Agent compensation
```

---

# 58. Arrival Grace Window

每个 Scenario 可以有：

```text
grace_minutes
```

例如：

```text
5 / 10 / 15 min
```

配置化。

---

# 59. Overtime Payment

Chapter 09 已锁：

```text
Request Extension
↓
Agent Accept
```

本章执行：

```text
additional authorization / capture
↓
new ledger entries
```

---

# 60. Extension Funding Gate

如果 Requester 要加时：

```text
Funding must be secured
```

Agent 才能正式接受延长。

---

# 61. Expense Reimbursement

P1：

```text
ExpenseClaim
```

字段：

```text
expense_claim_id
order_id
category
amount
receipt
status
```

---

# 62. Expense Status

```text
SUBMITTED
APPROVED
REJECTED
PAID
```

---

# 63. Dispute

Dispute 不直接改写 Payment。

新增：

```text
DisputeHold
```

---

# 64. DisputeHold

Schema：

```text
dispute_hold_id
order_id

held_requester_amount
held_agent_earnings

reason
status

created_at
resolved_at
```

---

# 65. Dispute Status

```text
OPEN
UNDER_REVIEW
PARTIALLY_RESOLVED
RESOLVED
CLOSED
```

---

# 66. Dispute Freeze Principle

出现有效争议：

```text
undisputed portion
```

可以继续结算，

争议部分：

```text
HELD
```

不要默认冻结整单所有资金。

---

# 67. Partial Settlement

例如：

```text
Base 600k
Travel 100k
```

争议只有：

```text
Travel 100k
```

可以：

```text
Base settle
Travel hold
```

---

# 68. Dispute Resolution

结果可能：

```text
FULL_AGENT
FULL_REQUESTER
SPLIT
PLATFORM_SUBSIDY
```

任何结果都通过：

```text
Ledger Adjustment
```

表达。

---

# 69. Never Rewrite Original Contract

正式硬规则：

> **争议解决、退款、补偿都不能修改原始 agreed compensation snapshot。**

只追加：

```text
Adjustment Entries
```

---

# 70. Refund

Refund 独立对象：

```text
refund_id
payment_intent_id
order_id optional

amount
currency
reason

status
provider_reference
```

---

# 71. Refund Status

```text
REQUESTED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

---

# 72. Partial Refund

必须支持：

```text
partial
```

因为真人任务经常：

```text
部分完成
部分取消
```

---

# 73. Refund Destination

根据原支付方式：

```text
original payment method
```

或：

```text
eligible wallet balance
```

具体由市场 / Provider 决定。

---

# 74. Promo Credit Refund

如果 Requester 使用：

```text
Promo Credit
```

退款时：

现金和 Credit 必须按规则分别恢复。

---

# 75. Promotion Subsidy

例如：

```text
Agent earns 650k
Requester pays 550k
Platform subsidizes 100k
```

结算必须明确：

```text
100k
→ Promotion Ledger
```

---

# 76. Merchant-funded Promotion

同理：

```text
Business campaign subsidy
```

必须独立来源。

---

# 77. Platform Fee Recognition

平台不能在：

```text
Task Draft
```

就确认收入。

建议：

```text
Order Completion / Settlement
```

后确认。

---

# 78. Cancellation Fee Recognition

如果 Policy 允许平台保留：

```text
Cancellation Service Fee
```

则另记：

```text
fee type
```

不能混成正常 Completed Commission。

---

# 79. Payment Provider Boundary

核心域只使用：

```text
Payment Adapter
```

不要把：

```text
Stripe / MoMo / ZaloPay / VNPay
```

等 Provider 逻辑写死在 Order Service。

---

# 80. Payment Adapter

推荐接口：

```text
authorize()
capture()
release()
refund()
get_status()
```

---

# 81. Provider Reference

所有外部交易保存：

```text
provider
provider_reference
provider_event_id
```

---

# 82. Webhook Idempotency

支付 Provider Webhook 必须：

```text
idempotent
```

同一个：

```text
provider_event_id
```

只能处理一次。

---

# 83. Payment Command Idempotency

以下命令都必须支持：

```text
Idempotency-Key
```

例如：

```text
authorize
capture
refund
release
payout
```

---

# 84. Reconciliation

必须有：

```text
Internal Ledger
↔
Payment Provider
↔
Bank / Payout Provider
```

对账能力。

---

# 85. Reconciliation Status

```text
MATCHED
MISMATCH
MISSING_INTERNAL
MISSING_PROVIDER
REVIEW_REQUIRED
```

---

# 86. Money Invariant

系统必须满足：

```text
Requester Captured
+
Promotion Funding
=
Agent Earnings
+
Platform Fees
+
Refunds
+
Held Amount
+
Adjustments
```

按单 / 币种可对账。

---

# 87. Currency Boundary

一个 Order P0：

```text
single currency
```

不支持同一 Order 多币种混结算。

---

# 88. FX

跨币种：

P1 以后单独做。

当前不在 Transaction Core 内隐式换汇。

---

# 89. Agent Payout Method

Agent 可维护：

```text
Bank
Wallet
Other supported rail
```

但敏感 payout 信息：

```text
D5 Restricted
```

不进入普通 AgentProfile。

---

# 90. Payout Eligibility

Payout 前至少检查：

```text
KYC / payout readiness
fraud hold
available balance
market rules
```

---

# 91. Minimum Payout

未来可有：

```text
minimum payout threshold
```

按 Market Policy 配置。

---

# 92. Auto Payout

P1 可支持：

```text
Daily
Weekly
Manual
```

由 Agent 选择。

---

# 93. Earnings Spend

未来如果 Agent 自愿：

```text
Spend at Proxy Merchant
```

必须作为：

```text
wallet debit
```

与 Payout 一样写 Ledger。

---

# 94. Forced Spend 禁止

正式硬规则：

```text
Agent earnings
```

不得：

```text
强制转换成 Merchant Credit
强制限制在 Proxy 内消费
```

---

# 95. Business Billing

P1 Business 可支持：

```text
Prepaid Balance
Monthly Billing
Approved Credit Line
```

但 Order Funding Gate 必须知道：

```text
payment guarantee source
```

---

# 96. Business Credit

如果使用：

```text
Business Credit Line
```

也必须是：

```text
Funding Secured
```

不是“以后再说”。

---

# 97. Payment Risk

高风险 Requester：

可能要求：

```text
full prepayment
```

低风险 Business：

未来可：

```text
contract billing
```

具体由 Risk / Business Policy 决定。

---

# 98. Payment UI — Requester

Task Commit 前：

```text
Agent Compensation
Platform Service
Travel
Urgent Premium
Promotion
Estimated Total
```

---

# 99. Payment UI — Agent

Offer 前：

```text
You earn
Base
Travel
Premium
Estimated Net
```

---

# 100. Payment UI — Order

双方都能看到：

```text
Agreed Compensation
Adjustments
Current Payment State
```

但权限不同。

---

# 101. Agent 不看 Requester Payment Method

Agent 不需要看到：

```text
card
bank
billing details
```

只需要：

```text
Payment Protected
```

---

# 102. Requester 不看 Agent Payout Method

同理。

---

# 103. Funding Badge

Order 可以显示：

```text
Payment Protected
```

前提：

```text
funding_status = SECURED
```

不能只是营销文案。

---

# 104. Cancellation UI

取消前明确显示：

```text
Refund
Agent Compensation
Platform Fee
```

如果金额尚需计算：

显示：

```text
Estimated
```

并在确认前给最终值。

---

# 105. Replacement UI

Agent 取消后 Requester：

```text
Finding replacement
Your existing payment remains protected
```

如果需要额外 Premium：

必须先确认。

---

# 106. Failed Replacement

如果 Replacement 最终失败：

未使用部分资金：

```text
refund / release
```

按 Policy 执行。

---

# 107. Partial Task Success

Task：

```text
5 Slots
4 completed
1 unfilled
```

Settlement 必须按：

```text
Order / Slot
```

计算。

不能因为 Task Partial Success：

```text
统一打 80% 钱
```

---

# 108. Per-order Settlement

正式硬规则：

> **钱流最终以 Order 为结算原子。**

Task 只是聚合。

---

# 109. Task-level Invoice

Business 可以获得：

```text
Task Summary Invoice
```

但底层由：

```text
multiple Order settlements
```

组成。

---

# 110. Audit

所有资金动作记录：

```text
actor
entity
amount
currency
reason
policy_version
provider_reference
timestamp
command_id
```

---

# 111. Access Control

Requester：

```text
只能看自己的付款
```

Agent：

```text
只能看自己的 Earnings
```

Business Staff：

按：

```text
Business Permission
```

查看。

---

# 112. Operator Adjustment

如果客服 / 财务需要：

```text
manual adjustment
```

必须：

```text
reason
operator_id
approval if above threshold
audit
```

---

# 113. Dual Control

高金额人工 Adjustment：

P1 建议：

```text
maker-checker
```

避免单人改账。

---

# 114. P0 必须实现

```text
PaymentIntent
FundingHold
Order Funding Gate
Requester Payment Ledger
Agent Earnings Ledger
Fee Ledger
Settlement
Refund
Cancellation Policy
Replacement Funding Carry-forward
No-show categories
Dispute Hold
Partial Refund
Payment Adapter
Webhook Idempotency
Reconciliation
Audit
```

---

# 115. P1

```text
Business Credit Line
Monthly Billing
Expense Claims
Auto Payout
Wallet Spend
Advanced Dispute Split
Dual-control Adjustments
Cross-border / FX
```

---

# 116. Core Metrics

## Payment Health

```text
Authorization Success
Capture Success
Refund Success
Payout Success
Reconciliation Mismatch
```

## Marketplace

```text
Protected GMV
Settled GMV
Agent Earnings
Platform Revenue
Refund Rate
Cancellation Compensation
```

## Agent

```text
Time to Earnings Available
Payout Time
Payout Failure
```

---

# 117. Guardrail Metrics

```text
Confirmed Orders without secured funding
Double charge
Double refund
Negative ledger anomaly
Stuck payout
Dispute hold aging
Replacement double payment
```

其中：

```text
Confirmed Orders without secured funding
```

目标应接近：

```text
0
```

---

# 118. Acceptance Criteria

## AC-PAY-01
任何付费 Order 创建前必须通过 Funding Gate。

## AC-PAY-02
Funding 未 Secured 时不得创建正式 Order。

## AC-PAY-03
Requester Payment、Agent Earnings、Platform Fee 必须分账。

## AC-PAY-04
所有资金变化必须通过追加 Ledger Entry 表达。

## AC-PAY-05
不得通过覆盖余额修改历史交易事实。

## AC-PAY-06
Order 必须冻结 Pricing / Fee / Promotion / Cancellation Snapshot。

## AC-PAY-07
Partial Fill 时未使用资金必须释放或退款。

## AC-PAY-08
未来任务的支付 Authorization 必须考虑 Expiry / Renewal。

## AC-PAY-09
Agent Wallet 必须区分 Pending / Available / Paid。

## AC-PAY-10
Agent Earnings 与 Payout 必须是独立状态。

## AC-PAY-11
Settlement 必须以 Order 为原子。

## AC-PAY-12
Task-level Payment 只能作为 Order Settlement 的聚合。

## AC-PAY-13
必须支持 Auto-confirm / Auto-release 防止无限等待。

## AC-PAY-14
Cancellation 必须考虑 Actor / Phase / Agent Effort。

## AC-PAY-15
Cancellation Policy 必须版本化配置。

## AC-PAY-16
Requester 在 EN_ROUTE / ARRIVED 后取消必须支持 Agent Compensation。

## AC-PAY-17
Agent Cancel 后原 Slot Funding 可以用于 Replacement。

## AC-PAY-18
同一个 Slot Replacement 不得默认向 Requester 重复收费。

## AC-PAY-19
Replacement Premium 必须额外授权。

## AC-PAY-20
必须区分 Agent No-show 与 Requester No-show。

## AC-PAY-21
Requester No-show 时必须支持 Agent 到场补偿。

## AC-PAY-22
Overtime 必须先完成额外 Funding Gate。

## AC-PAY-23
Dispute 必须支持只冻结争议金额。

## AC-PAY-24
Dispute Resolution 必须通过 Ledger Adjustment 表达。

## AC-PAY-25
不得修改原始 agreed compensation snapshot。

## AC-PAY-26
必须支持 Partial Refund。

## AC-PAY-27
Promo Credit 与 Cash Refund 必须分账。

## AC-PAY-28
平台 Subsidy 不得减少已约定 Agent Earnings。

## AC-PAY-29
Platform Fee Recognition 必须与真实交易状态关联。

## AC-PAY-30
Boost Revenue 不得混入 Task Agent Earnings。

## AC-PAY-31
Payment Provider 必须通过 Adapter 接入。

## AC-PAY-32
Webhook 必须幂等。

## AC-PAY-33
Authorize / Capture / Refund / Payout 等命令必须幂等。

## AC-PAY-34
系统必须具备内部 Ledger 与 Provider 对账能力。

## AC-PAY-35
一个 P0 Order 只能使用单一 Currency。

## AC-PAY-36
Payout Account 属于 Restricted Data，不得进入 Agent Public Profile。

## AC-PAY-37
Agent Earnings 不得强制转换为平台消费币。

## AC-PAY-38
Funding Badge 只有在真实 Secured 时才可展示。

## AC-PAY-39
取消前必须向用户展示 Refund / Compensation 影响。

## AC-PAY-40
高风险人工财务调整必须完整 Audit。

---

# 119. 本章锁定结论

1. **正式 Order 必须先有真实 Funding Protection。**
2. **Requester Money、Agent Earnings、Platform Revenue 三套资金账分离。**
3. **所有钱流 Ledger-first，不回写历史。**
4. **一个 Order 是最终结算原子。**
5. **Partial Fill、Replacement、Partial Success 都按 Order 独立结算。**
6. **Cancellation 必须保护真人已投入的时间和成本。**
7. **Agent Cancel 后优先走 Replacement，而不是让 Requester 重复付款。**
8. **Agent No-show 与 Requester No-show 必须区分。**
9. **Dispute 只冻结争议部分，不默认冻结整单。**
10. **Refund / Compensation / Dispute Resolution 都通过 Adjustment Ledger 处理。**
11. **Agent Earnings 必须有 Pending → Earned → Available → Paid 的完整生命周期。**
12. **Payment Provider 可替换，Order Core 不绑定具体支付公司。**
13. **所有支付命令与 Webhook 必须幂等。**
14. **必须具备内部账与支付供应商的 Reconciliation。**
15. **Agent 必须看到“这单有支付保障”，Requester 必须看到“钱为什么被扣”。**

---

# 120. 下一章

下一份增量 PRD：

> **Chapter 11 — Execution / Check-in / Chat / Evidence / Completion**

重点解决：

```text
Order 成立以后
↓
双方怎么沟通
↓
什么时候开放精确地点
↓
Agent 怎么出发 / 到场 / 开始
↓
怎么 Check-in
↓
什么 Evidence 才算完成
↓
Requester 怎么确认
↓
异常怎么进入 Replacement / Dispute
↓
任务结束后哪些敏感权限自动撤销
```

这会把“钱已经锁住的真人订单”真正推进到现实世界履约。

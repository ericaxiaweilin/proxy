# Proxy PRD v1.1 — Canonical Registry R2.1 Amendment
## Cash Settlement / Settlement Commitment

**状态**：ACTIVE DELTA  
**范围**：只修正 Cash Mode 与 R2 C-07 冲突；其余 R2 不变。

## AMEND-01 — C-07R Settlement Commitment Before Paid Order

### PLATFORM_PAY

```text
Agent Accept
+ Eligibility Recheck
+ Atomic Slot Lock
+ Funding Secured
→ Order
```

### CASH_ON_SITE

```text
Requester selected CASH_ON_SITE
+ CashEligibility ALLOW/ALLOW_WITH_LIMIT
+ CompensationTerms frozen
+ Offer explicitly shows CASH
+ Agent accepts Cash terms
+ Eligibility Recheck
+ Atomic Slot Lock
→ Order
```

Cash 的 `Task.funding_status = NOT_REQUIRED`，不得伪造 `SECURED` 或 Funding Protection。

## AMEND-02 — SettlementMethod

P0：`PLATFORM_PAY / CASH_ON_SITE`  
Reserved：`LOCAL_TRANSFER_ON_SITE / PROTECTED_CASH`

`CompensationTerms` 增加：
`settlement_method / settlement_policy_version`

`AcceptedCompensationSnapshot` 冻结这些字段。

## AMEND-03 — CashSettlement

新增 P0 Canonical Transaction Object：`CashSettlement`。  
Cash settlement truth 归 CashSettlement；Order execution lifecycle 仍归 `Order.lifecycle_status`。

## AMEND-04 — CashSettlement Status

```text
PENDING_EXECUTION
PAYMENT_DUE
AWAITING_COUNTERPART
SETTLED
DISPUTED
CANCELLED
WAIVED
```

Requester：`PENDING / MARKED_PAID / DISPUTED`  
Agent：`PENDING / MARKED_RECEIVED / DISPUTED`

## AMEND-05 — Cash Invariant

`Cash ≠ Off-platform`。

Cash Order 仍必须拥有：
`Task / TaskSlot / Offer / Order / AcceptedTaskSnapshot / AcceptedCompensationSnapshot / Execution / Evidence / CashSettlement / Outcome`

## AMEND-06 — Bilateral Confirmation

只有：

```text
Requester = MARKED_PAID
AND Agent = MARKED_RECEIVED
```

才可 `CashSettlement = SETTLED`。

任一方 `DISPUTED` → `CashSettlement = DISPUTED`。

## AMEND-07 — Cash Reliability

Cash outcome 可产生 `RiskSignal / ReliabilitySignal`，但 signal ≠ final RiskDecision。Cash dispute 不自动 BLOCK/SUSPEND/判欺诈。

## AMEND-08 — Cash Eligibility

```text
ALLOW
ALLOW_WITH_LIMIT
PLATFORM_PAY_REQUIRED
REVIEW
```

依据 amount / task-category risk / principal trust / dispute history / market-legal policy。

## AMEND-09 — Ledger Boundary

现场现金不是 Proxy 托管资金：

```text
Cash received ≠ Platform Wallet balance
```

不得创建虚假的 PaymentIntent/FundingHold 表示现金经过平台。

## AMEND-10 — Updated Mainline

Platform Pay：
`Offer → Accept → Recheck → Slot Lock → Funding Secured → Order → Execution → Evidence → Settlement`

Cash：
`Cash Method → Cash Eligibility → Offer shows Cash → Accept → Recheck → Slot Lock → Order + CashSettlement(PENDING_EXECUTION) → Execution → Evidence → PAYMENT_DUE → bilateral confirmations → SETTLED/DISPUTED → Outcome`

# Proxy PRD v1.1 — P0 Engineering Acceptance Addendum R1

**状态**：ENGINEERING GATE  
**原则**：不新增产品概念，只补进入 App 工程前必须通过的硬验收。

## AC-P0-01 — Material Change 不得绕过 Reconfirmation

```text
CONFIRMED
→ RECONFIRMATION_REQUIRED
→ Demand Preview / candidate version
→ ConfirmMaterialChange
→ new confirmed version
→ Matching Room
```

至少覆盖：price / time / location / scope / hard requirement / settlement method。

验收：
- 新版本号与 impact 可见；
- 用户确认前不可继续 Matching；
- `ConfirmMaterialChange` 绑定 candidate demand version；
- 旧版本保留审计引用。

## AC-P0-02 — Recovery Before Retention

当 Satisfaction 表明 `NOT_ACHIEVED`，或 Recovery 为 `RECOVERY / REFUND / DISPUTE / SUPPORT`，且 Recovery 尚未 `RESOLVED / WAIVED`：

```text
Repeat recommendation = HIDDEN
```

验收：
- Recovery OPEN 时无 Repeat CTA；
- Refund / Dispute / Support 能回写 Recovery resolution；
- Outcome / Satisfaction facts 不被 Recovery 覆盖；
- `NOT_ACHIEVED` 不得直接进入 Repeat。

## AC-P0-03 — Settlement Method 必须在 Commit 前冻结

```text
Demand Preview
→ select Settlement Method
→ policy / eligibility
→ requester confirms settlement
→ Settlement Method frozen
→ CommitTask
```

`PLATFORM_PAY`：Commit 后进入 Funding Gate。  
`CASH_ON_SITE`：Commit 前完成 Cash Eligibility 与 Cash Terms。

Commit 后修改 Settlement Method 属于 Material Change。

## AC-P0-04 — Cash Eligibility 必须进入 Agent Accept Gate

Agent Accept / Final Recheck 时，Cash 必须同时满足：

```text
settlement_method = CASH_ON_SITE
cash_eligibility = ALLOW
cash_terms_accepted = true
settlement_method_frozen = true
```

否则：

```text
NO Atomic Slot Lock
NO Cash Order
```

原型至少展示：
`ALLOW / REVIEW / PLATFORM_PAY_REQUIRED`

## Agent Work Preferences — Luna 实现范围

Agent 模块至少实现：

```text
preferred roles
preferred zones
preferred time windows
minimum pay
maximum travel distance
settlement methods
avoid task types
avoid principals
```

## Engineering Start Order

Requester：
`App Shell → Need Draft / Read Model → Demand Solution → Demand Preview Gate → Matching / Progress → Outcome / Satisfaction → Memory / Repeat`

并行第二线：
`Agent Earnings / Work Preferences → Liquidity Control → Cash Settlement`

真实 RN 设备仍需验证：
`Safe Area / Keyboard / Back / Cold Start / Background Resume / Push / Deep Link / Offline Retry / Notification Fatigue`

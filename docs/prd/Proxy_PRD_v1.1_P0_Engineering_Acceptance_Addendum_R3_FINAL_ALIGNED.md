# Proxy PRD v1.1 — P0 Engineering Acceptance Addendum R3 FINAL

**状态**：FINAL ENGINEERING GATE  
**原则**：不新增产品概念，只锁定进入 App 工程前的最终 P0 验收。

## AC-P0-01 — Material Change 不得绕过 Reconfirmation

至少覆盖：`price / time / location / scope / hard requirement / settlement method`。

```text
CONFIRMED
→ RECONFIRMATION_REQUIRED
→ Demand Preview candidate version
→ ConfirmMaterialChange
→ new confirmed version
→ next gate / Matching Room
```

禁止任何页面直接 mutate current version 后跳 Matching。

## AC-P0-02 — Recovery Before Retention

当 `NOT_ACHIEVED` 或存在 `RECOVERY / REFUND / DISPUTE / SUPPORT` 且 Recovery 未 `RESOLVED / WAIVED`：

```text
Repeat recommendation = HIDDEN
```

## AC-P0-03 — Settlement Method 必须在 Initial Commit 前冻结

```text
Demand Preview
→ Select Settlement Method
→ Cash Eligibility / Cash Terms（if Cash）
→ Settlement Method FROZEN
→ CommitTask
```

Funding Gate 禁止提供 direct settlement switch。

## AC-P0-04 — Commit 后 Settlement Method 只能走 Material Change

```text
Request Settlement Change
→ RECONFIRMATION_REQUIRED
→ Demand Preview vNext
→ Settlement re-confirmation
→ ConfirmMaterialChange
```

新版本为 `PLATFORM_PAY` → Funding Gate；新版本为 `CASH_ON_SITE` → Matching。

## AC-P0-05 — Cash Eligibility 必须进入 Agent Accept Gate

Cash Agent Accept 必须同时满足：

```text
settlement_method = CASH_ON_SITE
cash_eligibility = ALLOW
cash_terms_accepted = true
settlement_method_frozen = true
```

否则 NO Atomic Slot Lock / NO Cash Order。

## AC-P0-06 — 所有 Commit 路径必须汇入 Demand Preview Gate

Structured / Legacy Review 不得直接 `Commit → Funding`。

## AC-P0-07 — Agent Work Preferences 范围

至少：`preferred roles / zones / time windows / minimum pay / max travel / settlement methods / avoid task types / avoid principals`。

## Engineering Start Order

Requester：
`App Shell → Need Draft / Read Model → Demand Solution → Demand Preview Gate → Matching / Progress → Outcome / Satisfaction → Memory / Repeat`

并行第二线：
`Agent Earnings / Work Preferences → Liquidity Control → Cash Settlement`

## Real-device Gate

React Native 真机验证：`Safe Area / Keyboard / Back / Cold Start / Background Resume / Push / Deep Link / Offline Retry / Idempotent resubmit / Notification Fatigue`。


---

# Outcome Intelligence — Additional P0 Acceptance

## AC-P0-08 — Observation Type Separation

`OBJECTIVE_FACT` 与 `AGENT_ASSESSMENT` 必须在 schema、UI 和 provenance 上区分。

## AC-P0-09 — Evidence / Observation Retention Boundary

Raw media retention 使用 `retention_policy_id`；删除 Raw Evidence 不得被 UI 表述为删除已合法形成的结构化 Outcome，最终法律行为由 Launch Market Policy 决定。

## AC-P0-10 — Before / After Comparison Compatibility

只有 target / template lineage / unit / comparison entity 兼容时才能形成 OutcomeDelta。

## AC-P0-11 — Learning Requires Promotion

`OutcomeLearning = SUGGESTED` 不得自动影响 Hard Requirement / Eligibility。只有 CONFIRMED learning 才可用于未来默认建议，且仍不能绕过 Requester confirmation。

## AC-P0-12 — Outcome-Verified Capability Is Policy-Gated

Agent 的 `OUTCOME_VERIFIED` 不得由订单数、五星或单次 Outcome 自动产生；必须使用独立 Verification Policy / anti-gaming gate。

成功订单数最多只能触发：

```text
Outcome Verification Review
```

不得直接 `QUALIFIED → PROVEN / OUTCOME_VERIFIED`。

## AC-P0-13 — Observation Finalization Gate

Before / After 必须严格：

```text
ObservationSet DRAFT
→ FinalizeObservationSet
→ FINALIZED
→ CreateOutcomeComparison
```

禁止 `DRAFT → OutcomeDelta`。

FINALIZED 后不得直接修改旧 Observation；修正必须创建可审计 revision / correction。

## AC-P0-14 — Comparison Policy Is Template-Versioned

每一个 OutcomeDelta 必须记录：

```text
comparison_policy_version
```

比较结果只允许：

```text
IMPROVED
WORSE
SAME
UNKNOWN
```

不得使用“非数值只要变化 = IMPROVED”的通用逻辑。

Template 必须为每个 target 定义方向 / rank / compatibility；缺失或不可解释的数据返回 `UNKNOWN`。

## AC-P0-15 — Suggested Learning Supports Dismiss

`OutcomeLearning = SUGGESTED` 时必须同时支持：

```text
ConfirmOutcomeLearning
DismissOutcomeLearning
```

Dismiss 后：

```text
status = DISMISSED
NO Requester Memory promotion
NO ranking/default suggestion influence
```

Confirmed Learning 的 Requester Memory 可以通过：

```text
DeleteRequesterOutcomeMemory
```

删除。

## AC-P0-16 — Outcome Intelligence PRD / Prototype Version Alignment

最终 Luna Handoff 必须使用同一版本族：

```text
Chapter 21D → depends on P0 Addendum R3 FINAL
P0 Addendum title / filename → R3 FINAL
Prototype → v1.5.2 Outcome Finalization
```

Handoff 不得只交原型和品牌；必须包含 Chapter 21D 与 P0 Addendum。

# Proxy PRD v1.1
## P0 Engineering Acceptance Addendum R11 — Network Contribution

**状态**：P0 ENGINEERING GATE  
**依赖**：Chapter 21J R1 / Chapter 21I R2 / Canonical Registry R2.7

---

# Gate A — One App / One Identity
- Consumer Root Tabs 仍为 `首页 / 任务 / 动态 / 我的`。
- 不新增 BD App / BD Account。
- Network Contributor 必须绑定既有 Principal。

# Gate B — Access Review
必须支持：

```text
NOT_APPLIED / PENDING / APPROVED / RESTRICTED / REVOKED
```

`APPROVED` 只开放 Contribution 权限，不授予 Driver Verification / Legal Signature / Reward Ledger admin。

# Gate C — Three P0 Contribution Types
必须至少端到端支持：

```text
MERCHANT_REFERRAL
DRIVER or AGENT_REFERRAL
REQUESTER_REFERRAL
```

# Gate D — Campaign Snapshot
用户开始参与时冻结：

```text
campaign_id
reward_policy_snapshot
attribution_rule_snapshot
eligibility_policy_snapshot
```

后续 Campaign 修改不得静默改写已参与条件。

# Gate E — No Download Reward
Driver / Agent / Requester 的主要 Reward 不得以 App download / raw registration 为 Value Event。

# Gate F — Merchant Value Event
至少要求：

```text
Merchant / Venue ACTIVE
+ first attributable consumption / reservation / order
```

仅签约或仅 Active 不自动等于 Rewarded。

# Gate G — Supply Value Event
Driver / Agent 至少要求：

```text
Qualification / Capability Verification
+ Service ACTIVE
+ real availability where applicable
+ First Completed Order
+ acceptable Outcome
```

# Gate H — Requester Value Event
Requester Referral 至少要求：

```text
new Principal
+ real Need
+ First Completed Order
```

# Gate I — Attribution Safety
必须识别并阻止：

```text
self referral
duplicate target
existing account as new-user referral
duplicate merchant
prior valid attribution conflict
expired campaign
```

# Gate J — Single Level Only
P0 只允许 `DIRECT_SINGLE_LEVEL` Reward Attribution。
不得递归给上级邀请人分佣。

# Gate K — Domain Truth Drives State
Contribution 状态只能由服务端事件 / Policy / Review 推进。
客户端不得直接设置：

```text
VERIFIED
VALUE_CREATED
REWARDED
SETTLED
```

# Gate L — Reward Ledger
Reward 必须：

```text
Verified Value Event
→ RewardGrant
→ LedgerEntry
→ Earnings Projection
```

不得直接 `UPDATE balance`。

# Gate M — Privacy
Referrer UI 不得暴露被邀请 Driver / Agent 的完整 KYC、精确位置、其他订单或审核私密材料。

# Gate N — Ops / Product Database Boundary
即使 Operations DB 与 Product DB 分离：
- Auto-Ops 不得直接改 Agreement / Order / Qualification / Reward Ledger。
- 必须经 Domain Command + validation。

# Gate O — Frontend Flow
原型 / App 必须能走：

```text
我的
→ 参与运营
→ 审核
→ Campaign
→ Merchant / Driver-Agent / Requester
→ Progress
→ Value Event
→ Reward
→ Contribution Data
```

# Gate P — Replay
任一 Reward 必须可回放：

```text
Campaign
→ Contributor
→ Referral / Discovery
→ Target
→ Review
→ Activation
→ Value Event
→ Reward Policy Snapshot
→ Reward Grant
→ Ledger Entry
```

每跳有稳定 ID。

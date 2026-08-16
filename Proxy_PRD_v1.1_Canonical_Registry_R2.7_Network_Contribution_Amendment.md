# Proxy PRD v1.1 — Canonical Registry R2.7 Network Contribution Amendment

**状态**：CANONICAL AMENDMENT  
**基础**：R2.6 Adaptive Media Presentation + R14.1 Auto-Ops Network Growth

## 最新优先级

```text
R2.7 Network Contribution Amendment
→ Chapter 21J R1
→ Acceptance R11
→ R2.6 Adaptive Media Presentation Amendment
→ Chapter 21I R2
→ R2.4 Location Context Amendment
→ Chapter 21H R2
→ older contracts
```

## Canonical Decisions

1. 前期 Consumer / Agent / Network Operations 共用一个 App；不新增独立 BD App。
2. `Network Contributor` 是 Capability / Entitlement，不是永久 `role = BD`。
3. 运营入口放在 `我的`，入口本身可以有独立审核。
4. P0 Contribution 至少覆盖 Merchant、Driver/Agent、Requester 三类。
5. 任何 Reward 必须绑定 `Verified Value Event`，不得以下载 / 空注册作为主要成功事件。
6. Contribution Review 至少拆成 Access Review、Target Domain Review、Reward Gate 三层。
7. Attribution P0 为 `DIRECT_SINGLE_LEVEL`；禁止递归多级分佣。
8. Existing Principal、Duplicate Merchant、Self Referral、Prior Attribution Conflict 不得重复计奖。
9. Auto-Ops 可以根据 Liquidity / Merchant Gap / Demand Growth 投放 Campaign，但奖金与预算受预授权 Policy 约束。
10. 用户参与 Campaign 时必须冻结 Reward / Attribution / Eligibility Policy Snapshot。
11. `RewardGrant / LedgerEntry` 属于 Product Truth；Auto-Ops / LLM 不得直接改 Wallet Balance。
12. Operations DB 与 Product DB 可以分离；任何 Product Truth mutation 必须走 Domain Command。
13. Referrer 只能看到最小必要进度，不得看到目标用户的完整 KYC、精确位置或无关订单。
14. Merchant Referral 主要 Value Gate = Merchant/Venue Active + attributable consumption。
15. Driver/Agent Referral 主要 Value Gate = Qualification/Verification + Active Supply + First Completed Order。
16. Requester Referral 主要 Value Gate = New Principal + Real Need + First Completed Order。
17. “让 Agent 赚到钱 + 满足 Requester 需求”继续高于拉新增长指标。

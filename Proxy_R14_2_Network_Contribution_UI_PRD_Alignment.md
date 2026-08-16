# Proxy R14.2 — Network Contribution UI / PRD Alignment

**Prototype**：`Proxy_P0_Prototype_R14_2_Network_Contribution_CN.html`

## 本轮补齐的产品缺口

R14.1 已有：
- One App / One Identity
- `参与 Proxy`
- `我的网络贡献`
- Merchant Referral / Auto-Ops 示例

R14.2 正式泛化为统一 Network Contribution System。

## IA

```text
我的
→ 参与运营 · 网络贡献
→ 参与资格审核
→ 系统投放机会
→ 场景 Flow
→ 贡献数据与奖励
```

不新增 Root Tab，不新增 BD App。

## 三条演示链

### Merchant
```text
推荐商家
→ Dedup / Review
→ Auto-Ops Offer
→ Merchant Confirmation
→ Agreement
→ Venue Active
→ First Attributable Consumption
→ Reward
```

### Driver / Agent
```text
推荐
→ 注册
→ Qualification / Verification
→ Active Supply
→ First Completed Order
→ Reward
```

### Requester
```text
邀请
→ New Principal
→ First Need
→ First Order
→ Completed
→ Reward
```

## 审核

UI 明确分开：
1. Network Contributor Access
2. Target Domain Review
3. Reward Gate

## 数据投放

`系统投放机会` 根据市场缺口展示 Campaign：
- Driver / Agent Supply TIGHT
- Merchant / Venue gap
- Requester real-order growth

Demo 金额是 Prototype Config，不是生产硬编码。

## 收益

`贡献数据与奖励` 展示：
- exposure
- share / invite
- register / confirm
- qualified / verified
- activated
- value created
- reward pending / settled

Reward 必须由服务端 Verified Value Event 驱动。

## 数据边界

Product Truth：
`Principal / Contribution / ReferralInvite / Attribution / Merchant / Agent Qualification / Order / Outcome / RewardGrant / LedgerEntry`

Ops Control：
`Campaign Recommendation / Placement / Market Gap / Funnel Aggregate / Auto-Ops Decision`

Ops Control 不直接改 Product Truth。

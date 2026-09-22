# Proxy PRD v1.1
## Chapter 21J — R14.2 Network Contribution System R1

**状态**：CURRENT PRODUCT CONTRACT · CONSUMER / OPERATIONS FRONTEND UNIFIED  
**依赖**：Chapter 21I R2 · Chapter 21H R2 · Canonical Registry R2.6 · R14.1 Auto-Ops Network Growth Alignment  
**目标**：把“用户本身就是网络增长节点”从运营理念变成可审核、可归因、可自动投放、可奖励、可审计的软件能力。

---

# 1. 产品定义

Proxy 前期不拆 Consumer App / BD App / Agent Growth App。

Canonical：

```text
One App
+ One UserAccount
+ One Principal graph
+ Contextual Capabilities / Entitlements
= Consumer + Service + Network Operations in one frontend
```

用户可以同时是：

```text
Requester
Human Agent
Creator
Merchant Referrer
Driver / Agent Referrer
Requester Referrer
Partner Scout
Activity Organizer
```

上述不是永久职位标签。系统只在某个上下文中判断该 Principal 是否拥有对应 Capability / Entitlement。

> 不是谁是 BD，而是谁此刻有资格完成网络增长的这一步。

---

# 2. 北极星顺序

Network Contribution 不能反过来绑架 Marketplace。

优先级固定：

```text
1. Requester 的真实需求被解决
2. Agent 因真实服务赚到钱
3. 帮助网络扩张的人因 Verified Value 获得额外收益
```

禁止用注册量、下载量、邀请量替代真实价值。

---

# 3. P0 Contribution Types

R14.2 首批支持：

```text
MERCHANT_REFERRAL
DRIVER_REFERRAL
AGENT_REFERRAL
REQUESTER_REFERRAL
VENUE_DISCOVERY
```

`CONTENT_DEMAND_ORIGIN` 继续属于 Demand Attribution，不自动等于有奖励的 Referral。

未来可扩展：

```text
ACTIVITY_ORIGIN
CREATOR_COMMERCE_ORIGIN
SPECIALIST_REFERRAL
MERCHANT_TO_MERCHANT_REFERRAL
```

任何新增类型必须定义明确的 `Verified Value Event`。

---

# 4. 一级入口 / IA

Consumer Bottom Navigation 不变：

```text
首页 / 任务 / 动态 / 我的
```

Network Operations 不新增 Root Tab。

进入：

```text
我的
→ 参与运营 · 网络贡献
```

同一区域还提供：

```text
贡献数据与奖励
钱包与结算
```

前端不展示传统 CRM 术语作为主要用户语言：

```text
Lead
Opportunity
Pipeline
Account
```

用户语言应是：

```text
推荐
审核中
已通过
正在合作
等待首单
奖励待解锁
已到账
```

---

# 5. Network Contributor Access

运营前端与消费前端一体，不代表所有运营动作无需审核。

新增：

```text
NetworkContributorAccess {
  principal_id
  status
  policy_version
  submitted_at?
  approved_at?
  restricted_reason?
  revoked_at?
}
```

状态：

```text
NOT_APPLIED
PENDING
APPROVED
RESTRICTED
REVOKED
```

Access 审核至少关注：

```text
Principal ACTIVE
基础 Identity / Account health
self-referral risk
device / account cluster risk
历史 abuse / fraud signal
市场 / capability policy
```

通过 Network Contributor Access **不等于**获得：

```text
Driver Qualification authority
Capability Verification authority
Merchant legal signatory authority
contract exception approval
refund / compensation authority
Reward Ledger mutation authority
```

---

# 6. Contribution Campaign / 数据投放

Auto-Ops 可以根据市场状态产生或推荐 Network Contribution Campaign。

```text
ContributionCampaign {
  campaign_id
  contribution_type
  market_id
  area_id?
  target_segment
  trigger_reason
  eligibility_policy_ref
  reward_policy_ref
  budget_policy_ref
  starts_at
  ends_at?
  state
}
```

典型触发：

```text
Driver Supply TIGHT
→ 推荐 Driver Referral Campaign

City Companion routes repeatedly visit non-partner cafes
→ Merchant Referral Campaign

Requester demand growth below target
→ Requester Referral Campaign
```

Auto-Ops 可在预授权预算与 Policy 内：

```text
选择投放人群
控制频率
推荐 Campaign
暂停低质量 Campaign
根据真实 Funnel 调整曝光
```

不得：

```text
LLM 自由决定奖金金额
超预算自动加钱
为刷注册放宽 Value Gate
覆盖 Attribution 历史
```

用户参与 Campaign 时，必须冻结：

```text
CampaignSnapshot
RewardPolicySnapshot
AttributionRuleSnapshot
```

避免后续政策变化追溯改写已参与用户的条件。

---

# 7. Canonical NetworkContribution

```text
NetworkContribution {
  contribution_id
  contributor_principal_id
  contribution_type
  campaign_id?
  target_type
  target_id?
  referral_invite_id?
  attribution_id
  state
  submitted_at
  qualified_at?
  activated_at?
  value_created_at?
  rewarded_at?
  reject_reason?
}
```

状态：

```text
DRAFT
SUBMITTED
DEDUP_CHECK
UNDER_REVIEW
QUALIFIED
ACTIVATED
VALUE_CREATED
REWARDED
REJECTED
EXPIRED
```

状态只能由对应 Domain Event / Review / Policy 推进，客户端不得直接置成功。

---

# 8. ReferralInvite

```text
ReferralInvite {
  referral_invite_id
  contributor_principal_id
  campaign_id?
  invite_code
  contribution_type
  created_at
  expires_at?
  state
}
```

Invite / QR / deep link 只是 Attribution 入口，不是 Reward Truth。

---

# 9. Merchant Referral

Canonical：

```text
Discover Merchant
→ Contribution SUBMITTED
→ Entity Resolution / Dedup
→ Quality / Network Value Review
→ QUALIFIED
→ Merchant Contact / Relationship Node
→ Merchant Principal Confirmation
→ Standard Agreement / Policy Gate
→ SIGNED
→ Merchant + Venue ACTIVE
→ First Attributable Consumption
→ VALUE_CREATED
→ RewardGrant
```

Merchant `ACTIVE` 本身不一定足够解锁奖励。

P0 默认 Verified Value Event：

```text
Merchant / Venue ACTIVE
+ 至少一笔符合 Campaign 规则的 attributable consumption / reservation / order
```

Duplicate / 已合作 Merchant：

```text
→ REJECTED / DUPLICATE
→ 不重复 Reward
```

---

# 10. Driver / Agent Referral

Canonical：

```text
Invite
→ New Principal / valid target
→ Driver / Agent application
→ Identity / Qualification
→ required CapabilityVerification
→ AgentService ACTIVE
→ Availability ACTIVE
→ First Completed Order
→ acceptable Outcome
→ VALUE_CREATED
→ RewardGrant
```

禁止：

```text
App download = reward
registration = main reward
declared capability = verified capability
referrer approves qualification
```

只有真实可用供给和真实订单价值才是主要 Reward Gate。

若对应 Driver / Agent category 尚未在该 Market 正式开放，Campaign 不得投放成“可立即赚取”。

---

# 11. Requester Referral

Canonical：

```text
Direct Invite
→ New Principal
→ First Qualified Need
→ First Confirmed Order
→ First Completed Order
→ Outcome
→ VALUE_CREATED
→ RewardGrant
```

Existing Principal 不得重新包装为“新用户”。

下载 / 注册不能作为主奖励事件。

---

# 12. Attribution

R14.2 默认：

```text
DIRECT_SINGLE_LEVEL
```

即：

```text
A 邀请 B
B 产生 Value
→ A 可获得对应 Reward

B 再邀请 C
C 产生 Value
→ Reward 归 B
→ 不继续向上给 A 分成
```

禁止多级下线式递归奖励。

Contribution Attribution 必须与既有 Demand Attribution 共存，不得覆盖：

```text
AGENT_OWNED
PARTNER_REFERRED
PROXY_OWNED
NETWORK_REPEAT
```

至少处理：

```text
existing account
self referral
duplicate merchant
duplicate target
prior valid attribution
campaign expiry
fraud / device cluster
```

---

# 13. Review / 审核是三层，不是一个万能审核

```text
A. Contributor Access Review
   谁可以进入运营贡献入口

B. Target / Domain Review
   商家是否真实 / Driver 是否合格 / Agent capability 是否 VERIFIED

C. Reward Gate
   是否真的产生 Campaign 定义的 Verified Value Event
```

三者不得合并成单个 `approved=true`。

---

# 14. Reward Truth

Reward 是财务事实，必须进入 Product Truth / Ledger。

```text
Verified Value Event
→ RewardPolicy evaluation
→ RewardGrant
→ LedgerEntry
→ User Earnings projection
```

```text
RewardGrant {
  reward_grant_id
  contribution_id
  policy_snapshot_id
  amount
  currency
  state
  value_event_id
  granted_at?
}
```

状态：

```text
PENDING
ELIGIBLE
GRANTED
SETTLED
CANCELLED_BEFORE_GRANT
```

已 `SETTLED` 的历史事实不得静默删除；纠错使用独立 adjustment / clawback ledger event。

Auto-Ops / LLM 不得直接修改 Wallet Balance。

---

# 15. Product Truth Plane vs Operations Control Plane

产品真相：

```text
Principal
Agent / Driver Qualification
Merchant
Venue
Agreement
Need
Order
Outcome
NetworkContribution
ReferralInvite
Attribution
RewardGrant
LedgerEntry
```

运营控制面：

```text
ContributionCampaign recommendation
placement / exposure
market gap snapshot
funnel aggregate
Auto-Ops decision
frequency cap
campaign experiment
review queue projection
```

Operations DB 可以与 Product DB 分离。

硬边界：

> Operations Control Plane 只能通过 Domain Command 改 Product Truth，不得直接写 Order / Agreement / Qualification / Reward Ledger。

---

# 16. 用户可见数据

`我的 → 贡献数据与奖励` 至少展示：

```text
Campaign exposure
share / invite
registered / merchant confirmed
qualified / verified
activated
first Need / first Order where relevant
Verified Value Created
reward pending
reward settled
```

只展示该 Contributor 有权看到的最小数据。

推荐 Driver / Agent 时不得泄露：

```text
完整 KYC
精确位置
其他订单
私密审核材料
```

---

# 17. Auto-Ops Role

Auto-Ops 可以：

```text
识别 Liquidity Gap
选择合适 Contribution Campaign
推荐给合格用户
执行 frequency cap
去重
低风险资料补全
提醒推进
计算 Funnel
检测 reward-ready event
生成运营日报
```

需要明确授权 / Domain Review：

```text
Qualification VERIFY
Merchant legal signature
non-standard contract
high subsidy
fraud adjudication with material penalty
Reward Ledger mutation outside policy
```

---

# 18. R14.2 P0 UI

必须可点击验证：

```text
我的
→ 参与运营 · 网络贡献
→ Access 审核
→ 系统投放机会
   ├─ 推荐司机 / Agent
   ├─ 推荐商家
   └─ 邀请新用户
→ 各自进度
→ Verified Value
→ Reward
→ 贡献数据与奖励
```

Merchant 继续使用 R14.1 Auto-Ops flow。

---

# 19. 不做

R14.2 不做：

```text
多级分销 / MLM
永久 BD Role
独立 BD App
无限 Campaign Marketplace
用户自行改奖金
以下载量作为主要奖励
Referrer 代替平台审核 Driver / Agent
Referrer 代替公司签法律合同
复杂广告投放平台
完整企业级 CRM
```

---

# 20. 成功标准

R14.2 成功不是“邀请人数很多”。

至少证明三条 Traceable Contribution：

```text
A. Merchant
User Referral
→ Merchant Review
→ Agreement
→ Venue Active
→ Attributable Consumption
→ Reward

B. Driver / Agent
Invite
→ Qualification / Verification
→ Active Supply
→ First Completed Order
→ Reward

C. Requester
Invite
→ New Principal
→ Need
→ First Completed Order
→ Reward
```

并且每一跳都能回答：

```text
谁贡献的
为什么投放给他
目标是谁
谁审核
什么事件真正创造价值
为什么奖励 / 为什么不奖励
钱最终通过哪条 Ledger Entry 入账
```

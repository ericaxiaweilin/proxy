# Proxy PRD v1.1
## Chapter 21G — Demand Network / Revenue Architecture R2

**状态**：CURRENT DEMAND / REVENUE CONTRACT · R2  
**替代**：Chapter 21G R1  
**依赖**：Chapter 21H R1 / Chapter 21C R3 / Canonical Registry R2.3

---

# 1. 商业北极星保持不变

```text
Own / Attribute Demand
→ Route demand to qualified supply
→ Help Agent convert and execute well
→ Preserve relationship / outcome data
→ Generate repeat / cross-scene demand
→ Monetize the network where value is strongest
```

> **掌握需求入口，养好供给网络，从网络价值赚钱。**

Personal Human Service 不以最大化人工费 Take Rate 为目标。

---

# 2. Demand Origin R2：渠道 + 网络链路

R1 的一级来源继续保留：

```text
PROXY_OWNED
PARTNER_REFERRED
AGENT_OWNED
NETWORK_REPEAT
```

R2 新增 `source_type / source_id / creator / conversation`，用于描述订单在 Proxy 网络中怎样生成。

```text
DemandAttributionLineage {
  demand_origin
  external_source?
  source_type
  source_id
  creator_principal_id?
  conversation_id?
  need_id
  order_id?
}
```

source_type 示例：

```text
APP_DIRECT
SEARCH
POST_TO_DM
POST_TO_NEED
PROFILE_TO_DM
ACTIVITY_TO_NEED
VENUE_TO_NEED
PARTNER_LINK
AGENT_IMPORT
REPEAT
```

`Demand Origin` 是归因，不是客户所有权声明。

---

# 3. 订单前数据成为网络资产

R2 以后必须观测：

```text
Discovery
→ Post / Profile / Venue / Activity
→ Follow / Reply / Bookmark
→ Conversation
→ Intent
→ Need
→ Offer / Cooperation
→ Order
```

Proxy 的壁垒不只是“知道最后成交了谁”，而是理解需求为什么出现。

---

# 4. Revenue Architecture 不因 Social 化改变

## Personal Human Service

```text
0% / low labor take rate allowed
Direct Settlement allowed by CategoryPolicy
```

典型：城市同行、摄影、翻译、私人协助、部分活动支持。

## Standardized Service

```text
Platform Pay + commission allowed
```

典型：代驾、标准接送、标准保障产品等。

## Merchant Commerce

```text
reservation / attribution / promotion / merchant commission
```

## Agent Growth Tools

```text
Pro / Boost / AI / CRM / translation / analytics / content tools
```

付费永远不能购买：

```text
Eligibility
Identity verification
Capability verification
Trust
Safety clearance
```

---

# 5. Social Monetization Guardrail

不得因为 Feed 开放而把产品转成“卖流量给最会付钱的人”。

Sponsored Post / Boost：

```text
Eligibility / Safety / Relevance
→ Organic quality floor
→ Paid exposure
```

不是：

```text
Pay
→ bypass qualification
→ occupy feed
```

---

# 6. R2 核心指标

```text
Demand Ownership Rate
Attributed Demand Rate
Post → Qualified Conversation Rate
Conversation → Need Rate
Need → Confirmed Cooperation Rate
Order Origin Coverage
Agent-owned Demand Preserved Rate
Cross-scene Conversion
Merchant-attributed GMV
Network GMV
Agent Earned Retention
```

人工服务 Take Rate 不是 Network Health North Star。

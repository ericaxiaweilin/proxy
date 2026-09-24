# Proxy PRD v1.1
## Chapter 21I — R14 Real Network Vertical Slice R1

**状态**：CURRENT BUILD CONTRACT · R14  
**依赖**：Canonical Registry R2.4 / Chapter 21H R2 / Chapter 21G R2 / Chapter 21C R3 / Chapter 21F R3 / Engineering Acceptance R8  
**目标**：停止继续扩张原型页面，打通第一条真实、可追踪、可运营的真人订单链路。

---

# 1. R14 只验证一件事

R14 的北极星不是“实现多少页面”，而是完成第一条：

```text
Post
→ Profile
→ DM
→ Need
→ City Companion
→ Qualified Candidates
→ Cooperation Confirmation
→ Order
→ Human Execution
→ Outcome
→ Repeat
```

并且系统能够解释：

```text
这笔需求从哪里来
用户看到了什么
为什么开始聊天
聊天如何形成 Need
为什么这些 Agent 有资格进入候选
用户选择了谁
双方确认了什么
真人是否真实完成
结果怎么样
是否形成复购
```

这条链称为：

> **Traceable Human Order**

R14 成功标准不是 UI 完整度，而是至少一笔真实订单可以被完整回放。

---

# 2. R14 Build Scope

## 2.1 必做

```text
Identity / Account
Agent Profile
Agent Capability
Availability
LocalContext
Post / Media
Follow / Reply / Repost / Bookmark
Profile
Conversation / DM
Need
TaskNeedProfile
City Companion Route Proposal
Eligibility
Candidate Batch
Offer / Cooperation Confirmation
Order
Direct Settlement Record
Execution State
Outcome
Satisfaction
Repeat Relationship
Interaction Event
Demand Attribution Lineage
Ops Console Minimum
```

## 2.2 暂缓

R14 不做：

```text
复杂钱包
大型积分 / Loyalty
复杂会员等级
大规模广告系统
全量企业工作台
多城市全面铺开
机器学习 Feed Ranker
复杂图数据库可视化
全部 Task Category
重型 Merchant Ads Manager
原生直播
```

上述能力可以保留架构接口，但不得拖慢第一条真实订单。

---

# 3. 核心对象边界

R14 必须保留独立对象：

```text
Post
Conversation
Need
Task
Order
Outcome
```

不得把它们合成一个万能 `case` / `activity` / `transaction` 对象。

核心关系：

```text
Post
  ↓ origin
Conversation
  ↓ explicit conversion
Need
  ↓ commit
Task
  ↓ matching
Candidate / Offer
  ↓ confirmation
Order
  ↓ execution
Outcome
  ↓
RepeatRelationship
```

其中：

- Post 是 durable content；
- Conversation 是关系与协商；
- Need 是需求真相；
- Task 是可执行工作；
- Order 是双方已确认合作；
- Outcome 是完成后的结果事实与主观反馈。

---

# 4. 第一 Hero Category：City Companion

R14 只要求 City Companion 成为首个 relationship-heavy Hero Category。

Canonical 流程：

```text
用户看到 Agent Post
→ 看 Profile / 当前 Service
→ 发起 DM
→ 双方自由聊天
→ Proxy 建议整理为 Need
→ 用户明确确认
→ AI 生成可编辑路线
→ Eligibility + Availability
→ 有限候选集
→ 用户选择
→ 双方确认合作卡
→ 直接结算
→ 履约
→ Outcome
```

关键规则：

1. DM 不自动创建 Need。
2. AI 不静默改写已确认交易条件。
3. Route 是建议计划，不是未经确认的旅行套餐。
4. City Companion 的人工服务费可采用 `DIRECT_SETTLEMENT`。
5. Direct Settlement 不表示平台隐瞒交易，也不表示平台代为判断 Agent 的个人税务义务。
6. Proxy 可记录双方确认的 Compensation Terms，但资金不一定经过 Proxy。
7. Candidate 必须经过 Eligibility Before Ranking。
8. 照片可以在 City Companion 有较高展示权重，但不得建立全站人物照片墙。

---

# 5. Agent 是 Supply + Creator + Distribution Node

R14 Agent Profile 至少包含：

```text
identity state
public profile
photos / media
service SKUs
capabilities
verification states
languages
availability
market / service areas
historical completed orders
fulfillment metrics
satisfaction metrics
content
```

Agent 可发布 Post。

Agent 自带客户必须被尊重：

```text
external_origin = AGENT_OWNED
external_source = TikTok / Facebook / Zalo / Direct Link ...
```

如果客户随后进入 Proxy：

```text
Agent-owned TikTok
→ Agent Proxy Profile
→ Post
→ DM
→ Need
→ Order
```

Proxy 必须同时保留：

- 外部来源属于 Agent；
- Proxy 内部具体转化路径；
- creator attribution；
- conversation / need / order lineage。

不得为了平台归因覆盖 Agent 自带来源。

---

# 6. Conversation / IM 是 P0 Core

## 6.1 Conversation

```text
Conversation {
  conversation_id
  conversation_type
  origin_type
  origin_id
  market_id?
  state
  created_at
}
```

`origin_type` 至少：

```text
POST
PROFILE
SERVICE
ACTIVITY
NEED
OFFER
ORDER
```

## 6.2 Message

```text
Message {
  message_id
  conversation_id
  sender_principal_id
  message_type
  body?
  media_ref?
  created_at
  edited_at?
  deleted_at?
}
```

P0 至少支持：

```text
TEXT
IMAGE
SYSTEM_CONTEXT
STRUCTURED_SUGGESTION
```

硬规则：

- 聊天顶部必须知道为什么双方开始聊；
- ordinary chat 不修改 Need / Order；
- 结构化建议必须由用户明确接受后才能成为正式事实；
- Order 后的 Conversation 可以继续存在，但交易状态必须读取 Order 真源。

---

# 7. Local Context

R14 延续 R2.4：

```text
LocalContext != Device Location
LocalContext != Task Location
LocalContext != Order Meeting Point
LocalContext != Exact GPS Grant
```

Feed / Post discovery / Activity / local supply 读取 `Market / Coarse Area`。

精确位置只在：

```text
meeting
pickup
check-in
execution
emergency support
```

等目的下 Purpose Bound 授权。

---

# 8. Feed P0：先可解释，不训练复杂模型

R14 Feed 采用：

```text
Candidate Sources
→ Eligibility / Visibility / Safety
→ Feature Hydration
→ Simple Utility Ranking
→ Diversity
→ Serving
→ Event Recording
```

候选源：

```text
FOLLOWING
RELATIONSHIP
CURRENT_MARKET
RECENT
AGENT_AVAILABILITY
MERCHANT_ACTIVITY
EXPLORATION
```

R14 不要求 ML Ranker。

首版 Utility 可用透明分数：

```text
freshness
+ relationship
+ local relevance
+ service relevance
+ availability relevance
+ useful conversation history
+ successful outcome history
- safety risk
- repeated author penalty
- duplicate content penalty
```

Like / dwell / photo open 可以作为 feature，不能成为 North Star。

---

# 9. Event Stream 必须 Day 1 上线

R14 必须统一记录：

```text
POST_IMPRESSION
POST_DWELL
MEDIA_OPEN
PROFILE_OPEN
FOLLOW
LIKE
REPLY
REPOST
BOOKMARK
SHARE
CONVERSATION_STARTED
MESSAGE_SENT
SERVICE_OPEN
NEED_DRAFT_CREATED
NEED_CREATED
ROUTE_PROPOSAL_CREATED
CANDIDATE_BATCH_CREATED
CANDIDATE_VIEWED
AGENT_SHORTLISTED
COOPERATION_CONFIRMED
ORDER_CONFIRMED
EXECUTION_STARTED
EXECUTION_COMPLETED
OUTCOME_FINALIZED
REPEAT_CREATED
```

统一 Event 结构：

```text
InteractionEvent {
  event_id
  actor_principal_id?
  event_type
  object_type
  object_id?
  source_surface
  source_type?
  source_id?
  market_id?
  area_id?
  session_id?
  conversation_id?
  need_id?
  order_id?
  occurred_at
  metadata
}
```

Event 是 Append-Only 行为记录，不作为 Order / Need / Payment 真源。

---

# 10. Demand Attribution

必须支持多段 lineage，而不是单个 `utm_source`：

```text
DemandAttributionLineage {
  lineage_id
  external_origin?
  external_source?
  first_proxy_source_type?
  first_proxy_source_id?
  creator_principal_id?
  conversation_id?
  need_id
  order_id?
  created_at
}
```

示例：

```text
TikTok
→ Linh Profile
→ Post
→ DM
→ Need
→ Order
```

需要能回答：

- 这单最初是谁带来的；
- 哪篇内容触发了关系；
- 哪个 Conversation 转成 Need；
- 哪个 Need 转成 Order；
- 是否 Agent-owned acquisition；
- 是否 Proxy-owned acquisition；
- 是否 Repeat。

---

# 11. Matching P0

R14 匹配顺序固定：

```text
Need Truth
→ TaskNeedProfile
→ Eligibility
→ Availability
→ Geographic / Time Feasibility
→ Safety / Risk
→ Candidate Generation
→ Ranking
→ finite candidate set
```

禁止：

```text
先排名再资格检查
关键词直接把某人塞进候选
Boost 购买 Eligibility
Trust 绕过资格
照片 CTR 绕过资格
```

Candidate 返回时必须携带：

```text
candidate_batch_id
agent_id
eligibility_snapshot_ref
availability_snapshot_ref
ranking_reason
current offer / quote context
```

---

# 12. Direct Settlement

City Companion R14 默认支持：

```text
settlement_mode = DIRECT_SETTLEMENT
```

Proxy 记录：

```text
agreed_amount
currency
duration
included_scope
excluded_scope
payment_method_label
payer
payee
confirmed_at
```

但不得假装 Proxy 已经实际验证线下现金完成，除非双方有明确确认信号。

Direct Settlement 不能污染 Platform Pay Ledger。

标准化服务 / Merchant Commerce 后续仍可使用 Platform Pay。

---

# 13. Outcome

R14 Outcome 至少回答：

```text
是否按约到场
实际执行时间
重大变更
是否完成约定范围
客观结果
用户是否解决需求
是否愿意复用
是否举报 / 争议
```

Requester Satisfaction 继续：

```text
这次真的解决你的需求了吗？
- 完全解决
- 部分解决
- 没解决

如果再次遇到类似需求，你会怎么做？
- 直接复用
- 看情况
- 不再使用
```

履约事实不要求用户重复打分。

---

# 14. Ops Console Minimum

R14 运营后台只做真实运营必要项：

```text
User lookup
Agent review
Agent verification
Agent suspend / restore
Post moderation
Report review
Conversation abuse report
Need / Order lookup
Execution issue
Outcome / complaint
Supply cell
Demand source
```

运营操作必须有审计日志。

禁止运营后台直接改写：

```text
历史 Message
已确认 Compensation Snapshot
历史 Order truth
Outcome objective evidence
Attribution original source
```

如需纠错，用 correction / amendment / moderation state，不直接覆盖历史事实。

---

# 15. R14 Success Gate

R14 只有满足以下条件才算完成：

```text
1. 真实用户账号
2. 真实 Agent 账号
3. 真实 Post
4. 真实 Profile
5. 真实 DM
6. DM 可明确转成 Need
7. Need 生成真实 Candidate Batch
8. Candidate 来自真实 Agent / Availability
9. 双方确认 Order
10. 真人实际履约
11. Outcome 完成
12. Event / Attribution 可回放完整 lineage
13. Ops 可以查询并处理异常
```

最重要的验收：

> **系统可以完整重放一笔 Traceable Human Order。**

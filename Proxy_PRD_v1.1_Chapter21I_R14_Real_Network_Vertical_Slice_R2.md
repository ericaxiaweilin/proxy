# Proxy PRD v1.1
## Chapter 21I — R14 Real Network Vertical Slice R2

**状态**：CURRENT BUILD CONTRACT · R14 · MEDIA PRESENTATION ALIGNED  
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


---

# 16. Post Adaptive Media Rail — P0

R14 的 Post 媒体呈现必须支持 **1–6 个 MediaAsset**。这不是单独的“图片社区模式”，而是 Post 的基础表达能力。

核心原则：

> **单图自然放大，多图横向连续滑动；图片框跟媒体比例走，不用固定死尺寸，不使用九宫格。**

## 16.1 Media 数量

P0：

```text
min = 0
max = 6
```

允许：

```text
0 media  → 纯文字 Post
1 media  → 自适应大图 / 视频卡
2–6      → Adaptive Media Rail
```

超过 6 个时，客户端不得静默截断后仍宣称发布成功；应在发布前明确限制或提示用户调整。

## 16.2 单图规则

当 `media_count = 1`：

```text
读取 MediaAsset.width / height / aspect_ratio
→ 按原始比例计算展示尺寸
→ 在 Feed 内容宽度内自然放大
→ 使用统一圆角
```

禁止：

```text
所有单图强制固定 16:9
所有单图固定相同高度
强制 center-crop 导致主体被切掉
为了页面整齐把竖图压成横图
```

允许对极端长图 / 极端竖图设置 `max_render_height`，但必须保留完整查看入口。

推荐 UI：

```text
width  = feed content width
height = derived from aspect_ratio
radius = 14–16px
object-fit = contain / ratio-preserving presentation by default
```

## 16.3 多图规则

当 `media_count >= 2`：

使用：

> **Adaptive Media Rail**

而不是九宫格。

行为：

```text
horizontal scroll
inertial scrolling
rounded media cards
partial next-card reveal
optional soft snap
full-screen gallery on tap
```

每个 Media Card 的宽度可根据 `aspect_ratio` 自适应，不要求 2–6 张图片全部同宽。

但整个 Rail 应维持稳定的视觉高度，避免每滑一张整个 Feed 上下跳动。

目标视觉：

```text
┌───────────────┐  ┌────────────┐  ┌───────────────
│               │  │            │  │
│    media 1    │  │  media 2   │  │    media 3   →
│               │  │            │  │
└───────────────┘  └────────────┘  └───────────────
```

下一张应自然露出一部分，让用户无需额外教学即可理解“可以横滑”。

## 16.4 Full-screen Gallery

点击任意 Media 后进入 Viewer：

```text
1 / N
← swipe →
```

至少支持：

```text
左右滑动
返回 Feed
查看原比例媒体
图片缩放（客户端支持时）
视频播放（Media P0 Ready 后）
```

关闭 Viewer 后应返回原 Post、原 Media index 与尽可能接近的 Feed scroll position。

## 16.5 Media Read Model

Post 的持久化关系可以继续使用现有 `media_refs[]` / Post-Media 关联结构；不要求为了横滑 UI 修改 Post 核心对象。

但 Feed Read Model 必须 Hydrate 至少：

```text
PostMediaItem {
  media_asset_id
  media_type: IMAGE | VIDEO
  thumbnail_url?
  playback_url?
  width
  height
  aspect_ratio
  duration_ms?
  processing_status
  sort_order
}
```

硬规则：

1. `sort_order` / media_refs 顺序就是作者确认的展示顺序；
2. 只有可公开且 `READY` 的 Media 才能作为正式 Feed Media；
3. 第一项默认作为 Post cover / preview anchor；
4. 删除其中一个 Media 不得改变其它 MediaAsset 的稳定 ID；
5. Feed 不得使用 Post 自身保存的旧 thumbnail / availability 等字段冒充 Media / Business 真源。

## 16.6 IMAGE / VIDEO 统一容器

Adaptive Media Rail 不应只为图片设计。

目标结构：

```text
Post
└── media[]
    ├── IMAGE
    ├── IMAGE
    ├── VIDEO
    └── IMAGE
```

P0 当前可以先上线 IMAGE 呈现；普通 VIDEO 的 `MediaAsset / processing_status / playback_url / thumbnail` 接口保持兼容，不要求为了视频重新设计 Post。

普通视频仍不是 TikTok-style 连刷，也不是 Native Live。

## 16.7 Feed Ranking Boundary

媒体形态不能改变 Proxy 的网络目标。

不得把：

```text
image swipe count
photo CTR
video watch time
```

单独作为 Feed North Star。

高价值下游仍然是：

```text
Profile Open
Qualified Conversation
Need Created
Order Origin
Successful Outcome
Repeat Relationship
```

尤其不得因为某类人物照片点击率高，就把 Feed 训练成人物照片墙。

## 16.8 Event 建议

Media P0 至少记录：

```text
MEDIA_IMPRESSION
MEDIA_OPEN
MEDIA_SWIPE
GALLERY_OPEN
GALLERY_INDEX_VIEW
```

未来 VIDEO Ready 后再增加：

```text
VIDEO_START
VIDEO_PROGRESS
VIDEO_COMPLETE
VIDEO_UNMUTE
```

这些事件用于理解内容如何产生真实需求，不替代 Domain Truth。

## 16.9 R14 Media Presentation Gate

R14 App 对接真实 API 前至少验证：

```text
1 张图  → 原比例自适应大图
2 张图  → 圆角横滑
3 张图  → 圆角横滑
6 张图  → 圆角横滑，上限正确
7 张图  → 发布前明确拒绝 / 提示
横图 / 竖图 / 方图混排 → 不出现固定死裁切
点击第 N 张 → Viewer 从第 N 张开始
退出 Viewer → 回原 Post / 原位置
```

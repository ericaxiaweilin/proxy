# Proxy 产品总纲 vNext

## 1. 产品定位

Proxy 不是社交平台，也不是传统 Marketplace。

它是一个：

> **以人与现实需求为入口，由 AI 完成供需匹配、关系编排与资源调度的撮合市场。**

内容、主页、照片、关系只是用户表达和发现的界面。

真正的内核是：

**Need / Offer → Match → Orchestrate → Commit → Fulfill**

Threads/X 解决：

**表达 → 内容 → 关系 → 互动**

Proxy 解决：

**表达 → 意图 → 匹配 → 小圈子 → 行动 → 履约**

---

## 2. 产品风格

### 核心原则：前台轻，后台重

用户侧：

> **像成熟社交产品一样自然。**

后台：

> **像工业系统一样严密。**

不要再把后台的数据结构直接映射成 UI。

以前：

```text
gender
height
weight
occupation
interest
language
availability
capability
...
```

然后做成：

> 请完善您的个人资料

这个思路停止。

现在应该是：

```text
后台知道很多
       ↓
用户只看到当前需要的东西
```

---

## 3. 用户侧视觉语言

### 学 Threads / X 的部分

大胆学习成熟范式：

- 内容优先
- Profile 极简
- 少 Card
- 少阴影
- 少解释
- 少参数面板
- 大量留白
- 黑白作为主体
- 清晰 Typography
- Media 直接展示
- 成熟手势
- Progressive Disclosure
- 发布而不是填表
- 用户主动表达，而不是平台调查用户

但：

> **学习设计原则，不复刻产品。**

Proxy 保留自己的品牌、交互组件和市场能力。

---

## 4. Proxy 的视觉性格

建议定为：

> **克制、直接、现实、行动导向。**

不是：

- 金融 App
- SaaS Dashboard
- CRM
- ERP
- 小红书
- 第二个 Threads

### 色彩

继续：

**黑 / 白 + 单一 Proxy Accent**

Accent 只用于：

- 当前状态
- 主 CTA
- Match
- Action
- 关键提醒

不要：

```text
一个功能一种颜色
各种渐变
大面积阴影
大量彩色标签
```

---

## 5. 用户主页

Profile ≠ 用户数据库。

主页只需要：

```text
头像

Name
@handle

Bio

必要的：
Location · Verified · Status

Follow / Message / Action

────────────────

动态      照片      记录

Post
Post
Post
```

用户是 Creator 还是消费者，不需要在主页定义。

今天：

> 小美找摄影师

她是需求方。

明天：

> 商家找小美拍摄

她就是供给方。

Proxy 不应该强迫一个人选择：

```text
我是 Buyer
我是 Seller
我是 Creator
我是 Provider
```

---

## 6. 用户主动表达 > 平台要求填写

例如身高。

不要：

```text
完善 Creator Profile

身高 ______
体重 ______
三围 ______
```

而是小美自己发：

> 河内接穿搭 / UGC  
> 145cm · S size  
> 中越双语  
> 周末可以拍摄

信息仍然存在。

但：

**前者是系统索取。**

**后者是用户为了自己的目标主动表达。**

---

## 7. 后台不能因此减少数据

Proxy 做的是撮合，如果后台没有结构数据，就无法做精准匹配。

内部依然要建立严密的 User Graph：

```text
User
│
├── Identity
├── Trust
├── Location
├── Languages
├── Interests
├── Behaviors
├── Relationships
├── Capabilities
├── Availability
├── Transaction History
├── Preference
├── Commercial Intent
├── Privacy Policy
└── Derived Attributes
```

数据来源不只是用户填写，而可以是：

```text
Explicit
用户主动设置

Declared
用户内容表达

Observed
行为产生

Transactional
履约产生

Inferred
AI 推断
```

并且一定区分：

**事实 / 用户声明 / 系统推断。**

---

## 8. 商家永远不能直接拥有“用户数据库”

商家应该拥有：

> **筛选条件。**

而不是：

> **用户资料。**

例如 SPA：

```text
目标

河内
3km
22–35
对 SPA / Beauty 感兴趣
周末活跃
近期存在消费意图
接受商家优惠
```

商家提交 Target。

之后：

```text
Merchant Target
        ↓
Proxy Matching
        ↓
Eligibility
        ↓
Privacy
        ↓
Circle Boundary
        ↓
Frequency Control
        ↓
Ranking
        ↓
Eligible Audience
```

商家不需要拿到用户数据库本身。

---

## 9. 小圈子是核心机制之一

Proxy 不应该默认所有人都可以找所有人。

真正的网络应该有边界：

```text
Public
↓
Interest Circle
↓
Location Circle
↓
Activity Circle
↓
Friend Circle
↓
Transaction Circle
↓
Private Circle
```

一个 Need 能不能进入某个 Circle，要经过：

```text
relationship
permission
intent
trust
location
time
eligibility
```

判断。

因此：

> **Proxy 的网络不是 Follow Graph，而是动态 Eligibility Graph。**

---

## 10. Feed 的角色

Feed 可以大量学习 Threads，没有必要重新发明 Post。

普通 Post：

```text
Huyen

今天去了西湖。

[photo]

♡   Reply   Share
```

Proxy 的区别不是把 Post 做得很奇怪，而是：

### Post 可以产生 Action

例如：

```text
周六去宁平，有人一起吗？

[Photo]

同行 · 周六 · 宁平

[一起去]
```

---

## 11. Post + Proxy Component

建议底层正式采用：

```text
Post
│
├── Text
├── Media
├── Location
├── Visibility
├── Author
│
└── Attachments[]
```

Attachment 可以是：

```text
Need
Offer
Event
Coupon
Promotion
Product
Service
Reservation
Gift Voucher
Location
Group
Collaboration
```

这样：

**Post 是表达层。**

**Component 是市场层。**

两者不要混成几十种 Feed UI。

---

## 12. 照片墙

不是：

```text
PhotoWall Database
```

而是：

```text
Post
 └ Media[]

        ↓ Aggregate

Media
```

用户发带照片的 Post。

主页：

**动态**看到 Post。

**照片**自动聚合 Media。

一个数据源即可。

---

## 13. 商家内容必须比 Threads 重

这不是缺点。

商家本来就是来做生意的。

例如商家发布：

```text
周末 SPA 体验 20% OFF

[photo]

[领取]
```

用户只看到这些。

但是后台可能是：

```text
Campaign
├── Merchant
├── Store
├── Creative
├── Audience
├── Location Radius
├── Schedule
├── Budget
├── Coupon
├── Inventory
├── Frequency
├── Eligibility
├── Attribution
└── Conversion
```

这部分绝对不能为了所谓“极简”而删除。

### 原则

> **消费者承担最少复杂度。**
>
> **主动做生意的人承担必要复杂度。**

---

## 14. Proxy UX 的复杂度不是固定的

建议以后按照用户的 **Commitment Level** 控制界面复杂度。

### L0 Browse

最轻。

```text
看人
看帖
看照片
看商家
```

接近 Threads。

### L1 Interest

开始出现：

```text
感兴趣
一起去
领取
联系
```

### L2 Match

出现条件：

```text
时间
地点
人数
要求
价格
```

### L3 Commit

必须明确：

```text
双方
费用
规则
时间
取消
隐私
```

### L4 Fulfillment

进入：

```text
状态
调度
沟通
核销
异常
完成
```

所以：

> **越接近现实承诺，Proxy 越严谨。**

可以浓缩成：

## 轻浏览，重确认

---

## 15. Proxy 真正的核心技术链

```text
Experience Layer
        ↓
Intent Layer
        ↓
Market Graph
        ↓
Matching Engine
        ↓
Orchestration Engine
        ↓
Scheduling Engine
        ↓
Transaction / Commitment
        ↓
Fulfillment
        ↓
Trust / Feedback
```

---

## 16. Experience Layer

负责：

- Feed
- Profile
- Media
- Search
- Market
- Chat
- Merchant
- Coupon
- Event
- Need / Offer

这一层：

> **允许大量借鉴成熟产品。**

不要在这里耗掉 Proxy 最大的研发创新资源。

---

## 17. Intent Layer

用户可能只说：

> 周六有人去宁平吗？

Intent Layer 转成：

```text
intent: companion

origin: Hanoi
destination: Ninh Binh
date: Saturday

party_size: unknown
budget: unknown
transport: unknown
```

AI 判断哪些必须问，哪些可以暂时不知道，而不是强迫用户先填 12 个字段。

---

## 18. Market Graph

Graph 至少包含：

```text
User
Merchant
Need
Offer
Place
Event
Coupon
Service
Group
Relationship
Capability
Availability
Trust
Transaction
```

以及 Edge：

```text
likes
follows
knows
visited
purchased
served
available_for
interested_in
eligible_for
near
matches
invited
joined
```

最终不是简单查询数据库，而是：

> **在动态市场网络里寻找可执行组合。**

---

## 19. Matching Engine

回答：

> 谁和谁合适？

输入：

```text
Intent
Hard Constraints
Soft Preferences
Location
Time
Trust
Relationship
Price
Capability
History
Privacy
```

输出：

```text
Candidate Set
+
Match Score
+
Reason
+
Confidence
```

---

## 20. Orchestration Engine

这个应该成为 Proxy 最大的技术发力点之一。

Matching 只是：

> A 和 B 合适。

Orchestration 要回答：

> **现在应该怎么让这件事发生？**

例如：

```text
小美想去宁平

系统找到：
A
B
C
D
```

并不是简单推荐四个人。

Orchestrator 可能决定：

```text
小美 + A + B
组成 3 人圈

C 时间不完全匹配
暂不加入

附近 Merchant X
有相关优惠券
可作为活动节点

集合地点选择 Y
```

这已经变成：

> **资源编排。**

---

## 21. Scheduling Engine

回答：

> 谁在什么时候应该做什么？

例如：

```text
同行
预约
翻译
拍摄
SPA
餐厅
交通
```

都存在：

```text
time
capacity
resource
location
dependency
```

因此 Scheduling 可以处理：

```text
Availability
Capacity
Time Window
Location
Travel Time
Dependency
Priority
```

这就是 Proxy 从“推荐平台”走向：

> **行动网络**

的关键。

---

## 22. Trust Engine

撮合必须有 Trust。

但 Trust 不应该只是：

```text
4.9 ⭐
```

而应该由：

```text
Identity
Completion
Cancellation
No-show
Response
Transaction
Dispute
Relationship
Behavior
```

组成。

而且不同场景权重不同。

一个人适合一起喝咖啡，不代表适合托付高价值交易。

所以 Trust 应该是 context-aware。

---

## 23. Permission / Privacy Engine

必须从第一天做成独立能力。

核心模型：

```text
Data ≠ Visible Data ≠ Matchable Data
```

例如：

```text
gender = female
```

但：

```text
public_visible = false
match_usage = true
merchant_visible = false
```

这三个完全是不同权限。

---

## 24. 推荐系统和撮合系统不要混

Feed Recommendation：

> **你可能想看什么。**

Market Matching：

> **谁能和你完成这件事。**

因此技术上建议长期分开：

```text
Content Recommendation Engine

≠

Market Matching Engine
```

后者必须更重约束、更可解释、更强调确定性。

---

## 25. AI 的定位

AI 不应该成为 Proxy 的 UI 主角。

不是：

> “这是一个 AI App。”

而是 AI 在下面做：

```text
Understand
Structure
Search
Match
Rank
Compose
Schedule
Explain
Monitor
Re-plan
```

用户感受到的是：

> **事情很容易办成。**

而不是：

> **AI 很聪明。**

---

## 26. 最终技术架构

```text
                 PROXY

┌─────────────────────────────┐
│       Experience Layer      │
│ Feed / Profile / Market     │
│ Merchant / Chat / Activity  │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│        Intent Engine        │
│ Understand / Clarify        │
│ Need / Offer / Context      │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│         Market Graph        │
│ User / Merchant / Need      │
│ Offer / Place / Relationship│
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       Matching Engine       │
│ Constraint / Score / Rank   │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│     Orchestration Engine    │
│ Group / Resource / Action   │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       Scheduling Engine     │
│ Time / Capacity / Location  │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ Commitment / Transaction    │
│ Confirm / Pay / Coupon      │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│          Fulfillment        │
│ Execute / Track / Re-plan   │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ Trust / Feedback / Learning │
└─────────────────────────────┘

横向贯穿：
Identity
Permission
Privacy
Safety
Audit
Data
```

---

# Proxy 产品哲学

> **1. 像社交产品一样好用，像市场平台一样完整。**

> **2. 前台轻，后台重。**

> **3. 用户表达意图，系统负责结构化。**

> **4. 商家定义条件，Proxy 掌握匹配，不出售用户数据库。**

> **5. Match 只是开始，Orchestration + Scheduling 才是核心。**

> **6. Proxy 的目标不是让用户多停留，而是让现实中的事情更容易发生。**

Threads 希望你继续刷。

**Proxy 最终应该允许用户离开屏幕——因为事情已经被撮合好了。**

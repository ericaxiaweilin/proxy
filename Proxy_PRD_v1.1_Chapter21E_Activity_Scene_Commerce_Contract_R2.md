# Proxy PRD v1.1
## Chapter 21E — Activity / Scene Commerce Contract R2

**状态**：P0 / P0.5 PRODUCT CONTRACT · R2  
**依赖**：Canonical Registry R2 / Chapter 21A R3  
**目标**：定义 Proxy 活动主功能，使真人社交活动与真实本地消费场景形成闭环，同时严格与付费能力需求分离。

---

# 1. Activity 定义

Activity 的基本语义：

> 我们一起参加一件现实中的事情。

不是：

> 我付钱购买某个人的能力、时间或结果。

因此：

```text
Activity ≠ Paid Human Task
```

若用户提出：

```text
需要中文口译
需要专业摄影
需要商务陪同
需要某能力完成明确职责
```

即使发生在咖啡店 / 餐厅，也进入正常需求订单。

---

# 2. P0 场景范围

第一阶段活动场景只开放：

```text
咖啡店
餐厅
```

原因属于产品 / 风险策略，不在消费者页面长期展示。

消费者只看到实际可选场景和商家。

P0 禁止活动自由填写任意集合地址。

每个活动必须：

```text
linked_merchant_id != null
linked_venue_id != null
```

即：必须绑定 Proxy 已接入商家场景。

---

# 3. 活动来源

活动来源是元数据，不是长期频道。

```text
MERCHANT
USER
PLATFORM_SPECIAL
```

## 3.1 商家活动

由平台商家创建真实门店活动，例如：

```text
周日下午拍照季
新品尝鲜晚餐
双人到店送甜点
```

目标：真实到店与消费。

## 3.2 用户活动

用户围绕已接入商家创建：

```text
咖啡拍照搭子
一起吃新菜
```

目标：共同参与，不购买对方服务。

## 3.3 平台特别企划

Proxy 官方活动只在特殊时期出现：

```text
节日
城市主题周
联合商家特别企划
新品 / 开业合作
```

不得把“平台活动”做成活动页长期固定频道。

没有真实平台企划时，不占首页位置。

---

# 4. 活动价格与消费必须分离

每个活动都有 `activity_price`，允许：

```text
0₫
固定价格
自定义价格
```

但 `activity_price = 0` 只表示：

```text
参与本活动没有额外现金活动费
```

不表示：

```text
场景消费 = 0
Proxy 没有商业价值
参与者价值 = 0
```

同时必须独立表达：

```text
consumption_policy
estimated_venue_spend
merchant_offer
```

消费规则至少：

```text
各自消费
发起人承担
商家套餐
商家补贴 / 权益
```

示例：

```text
活动：咖啡拍照搭子
活动价格：0₫
地点：木光咖啡
预计消费：90k–140k / 人
消费方式：各自消费
```

---

# 5. Scene Commerce

0₫ Activity 不是免费软件功能，而是 Consumer Traffic Engine。

核心闭环：

```text
用户活动意图
→ Proxy 活动
→ 平台商家
→ 参与者匹配
→ 真实到店
→ 真实消费
→ 商家归因
```

Proxy 商业收入可以来自：

```text
到店 / 预订佣金
商家活动推广
商家权益套餐
归因服务
场景导流合作
```

不要求必须从参与者现金报酬抽成。

---

# 6. 活动首页

活动是“任务”内一级主功能：

```text
任务
├─ 需求
└─ 活动
```

活动首页推荐结构：

```text
活动提醒 / 当前真正相关推广（最多一个强位）
推荐 / 咖啡 / 餐厅 / 我的活动
活动列表
发起活动
```

禁止长期展示：

```text
当前开放场景说明
归因解释
0₫互助宣传语
平台活动固定分类
产品架构说明
```

高价值首屏位置用于：

```text
用户已参加活动提醒
临近开始
名额变化
商家真实活动
平台特别企划（仅存在时）
```

---

# 7. 商家推广规则

商家可以购买活动相关曝光，但：

```text
Relevance before Sponsorship
```

排序先看：

```text
活动类型适配
时间
位置
用户偏好
价格 / 消费区间
真实可预约 / 可承接能力
```

再允许 Sponsored Boost。

合作商家可展示：

```text
合作 / 推广标识
活动权益
预计消费
剩余名额 / 可预约状态
```

禁止：

```text
出价最高的无关商家占第一
假到店量
假活动人数
买评价
```

---

# 8. 活动社交层

P0 不照搬内容社区互动模型。

## 8.1 感兴趣

需要。

替代普通 Like：

```text
感兴趣
```

它是实际意图信号，可用于：

```text
临近提醒
名额提醒
相似活动推荐
供需判断
```

## 8.2 分享

P0 必须支持。

至少支持生成可分享活动卡 / 链接，可外发至：

```text
Zalo
Messenger
系统分享
Proxy 内部分享（未来）
```

## 8.3 公共评论

P0 禁止开放式公共评论区。

原因：避免活动页演化为灌水、骚扰、平台外导流和人物评论市场。

替代方案：

```text
活动问答
```

特点：
- 围绕活动事实；
- 发起人 / 商家可回答；
- 不做楼中楼争吵；
- 不做热评榜；
- 不以停留时长优化。

## 8.4 活动群聊

只有确认参加后开放。

用途：

```text
集合
迟到
座位
活动装备
必要协调
```

不是公开围观聊天。

## 8.5 活动后评价

只有真实到店 / 已确认参与者可以评价：

```text
Verified Participant Review
```

不允许未参与用户制造“人气评价”。

---

# 9. 活动与需求的互相连接

Activity 和 Task 可以共享同一个 Venue Context。

例如：

```text
木光咖啡拍照活动
→ 用户觉得需要专业摄影师
→ 转为发布需求
→ Venue 继承木光咖啡
```

或者：

```text
岚庭餐厅商家晚餐活动
→ 用户需要中文商务陪同
→ 转为付费需求订单
→ Venue 继承岚庭餐厅
```

但不得：

```text
把 Paid Task 伪装成 Activity
```

Domain 原则：

```text
Activity may reference Venue
Task may reference Venue
Activity does not become Task merely because price > 0
Task determination is based on whether another human owes capability / service / outcome
```

---

# 10. P0 Activity Read Model

建议最小对象：

```text
Activity
activity_id
origin_type: MERCHANT / USER / PLATFORM_SPECIAL
organizer_principal_id
linked_merchant_id
linked_venue_id
parent_activity_id?          // only when genuinely derived
activity_title
activity_time
activity_price
consumption_policy
estimated_venue_spend
merchant_offer?
capacity?
joined_count
interested_count
share_count
status
```

参与关系：

```text
ActivityParticipation
activity_id
user_id
status: INTERESTED / JOINED / CANCELLED / ATTENDED
joined_at
attendance_evidence?
```

问答：

```text
ActivityQuestion
ActivityAnswer
```

群聊必须绑定：

```text
activity_id + confirmed participation
```

---

# 11. P0 Acceptance

必须验证：

1. 活动是任务域一级主功能，不在 Home 作为小控件；
2. 需求与活动清晰分离；
3. 咖啡 / 餐厅活动必须选平台商家；
4. 活动价格允许显示 0₫；
5. 场景消费单独显示；
6. 商家活动和用户活动混合推荐，不做来源频道；
7. 平台特别企划仅存在时出现；
8. 感兴趣替代点赞；
9. 支持分享；
10. 无开放公共评论；
11. 有活动问答；
12. 参加后才开放活动群聊；
13. 活动后评价只来自真实参与者；
14. 商家推广不能绕过相关性；
15. 从活动产生专业能力需求时跳转需求订单，并继承场景上下文。


---

# 12. R2 活动首页运营位优先级

活动页不使用高价值首屏空间解释产品规则。

动态首位优先级：

```text
1. 用户已参加活动的临近提醒 / 状态变化
2. 与用户当前意图高度相关的真实商家活动
3. Proxy 特别企划（仅真实存在时）
4. 普通推荐活动
```

禁止首位常驻：

```text
“当前开放场景”说明
“固定营业场所更安全”说明
“0₫互助”功能宣传
“平台活动”固定频道入口
```

商家付费位必须明确标识推广，但仍遵守 `Relevance before Sponsorship`。

---

# 13. R2 活动卡操作层

活动详情 / Feed 的社交操作控制为：

```text
感兴趣
分享
活动问答
参加活动
```

只有 `JOINED` 后：

```text
活动群聊
```

只有 `ATTENDED` / 有真实到店证据后：

```text
参与者评价
```

普通点赞、公开评论、未参加用户群聊仍不进入 P0。

---

# 14. 与城市同行 / 导游需求的关系

城市同行、城市导游属于付费能力 / 时间服务时，进入 `Task`，不进入 `Activity`。

它可以消费 Activity / Scene Commerce 的商家资源：

```text
城市同行 Task
→ 行程内选择 Proxy 咖啡店 / 餐厅
→ 真实到店 / 预订 / 消费
→ 商家归因
```

但：

```text
付费城市同行 / 导游 ≠ Activity
```

详细规则由 `Chapter 21F — City Companion / Licensed Guide Contract` 定义。

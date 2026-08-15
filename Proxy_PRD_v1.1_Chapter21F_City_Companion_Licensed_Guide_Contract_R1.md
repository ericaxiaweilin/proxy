# Proxy PRD v1.1
## Chapter 21F — City Companion / Licensed Guide Contract R1

**状态**：PRIORITY SCENE CONTRACT · P0.5 / LAUNCH CANDIDATE  
**依赖**：Canonical Registry R2 / Chapter 21A R3 / Chapter 21E R2 / Cash Amendment R2.1 / P0 Engineering Acceptance R3 FINAL ALIGNED  
**目标**：把“城市同行 / 地陪 / 城市导游”定义为 Proxy 高价值真人服务场景，在不把平台做成人物橱窗的前提下，形成高客单、可验证履约、本地消费导流与复购。

---

# 1. 产品判断

城市同行 / 城市导游是 Proxy 应重点建设的高价值场景之一。

它符合 Proxy 核心：

```text
陌生城市中的真实需求
×
本地人的时间
×
语言 / 经验 / 城市知识 / 社交能力
×
真实到场执行
→ 高价值 Human Agent Order
```

与低价临时劳务不同，这类订单的价值主要来自：

```text
本地知识
语言能力
路线与时间安排
社交体验
陪同执行
可信赖程度
临场处理
```

因此不应以最低时薪竞争。

---

# 2. 必须区分两种服务语义

## 2.1 城市同行（City Companion / Local Host）

消费者文案建议使用：

```text
城市同行
本地陪同
城市体验
```

典型需求：

```text
第一次来河内，想找一个本地人带我吃饭、喝咖啡、逛几个地方
需要中文 / 英文沟通
希望有人帮我处理本地沟通、点餐、路线和现场问题
想拍照、体验本地生活
```

该产品卖的是约定时间内的合法同行、沟通和现场协助。

但产品命名不能作为规避旅游行业监管的工具。若实际服务内容构成受监管的旅游向导活动，应自动进入持证导游路径。

## 2.2 持证城市导游（Licensed City Guide）

典型需求：

```text
正式城市游览
景点讲解
文化 / 历史讲解
按旅游行程带领游客
为外国游客提供正式导游服务
```

此路径必须校验适用的导游资格 / 卡证 / 业务关系要求。

对外国游客，若属于正式导游业务，必须进入符合越南旅游法要求的国际导游供给池，不允许普通 City Companion 通过改名绕过资格要求。

---

# 3. Legal Classification Gate — OPEN

越南首发前必须由当地律师 / 旅游行业合规顾问冻结分类边界。

产品不得采用：

```text
“只要叫地陪就一定不属于导游”
```

作为法律假设。

系统至少需要：

```text
requested_scope
traveler_type: DOMESTIC / INTERNATIONAL
formal_guiding_required
attraction_interpretation_required
itinerary_guidance_level
language_requirement
```

分类输出：

```text
CITY_COMPANION_ALLOWED
LICENSED_GUIDE_REQUIRED
LEGAL_REVIEW_REQUIRED
REJECT
```

`LICENSED_GUIDE_REQUIRED` 时，未完成对应资格验证的 Agent 不得进入候选集。

---

# 4. 需求入口与交互模式

典型输入：

> 我第一次来河内，想找一个会中文的本地女生陪我玩一天，吃点好吃的、拍照、看看城市。

默认推荐：

```text
Semantic Entry
→ CITY_LOCAL_EXPERIENCE
→ Guided Interaction
```

Proxy 不让用户填写旅游行业数据库表单，而只确认会改变订单的内容。

建议最小问题：

```text
日期 / 时长
主要语言
希望体验什么
接送 / 集合地点
正式景点讲解是否需要
预算 / 最终价格
```

系统可自动生成：

```text
建议路线
每段预计时间
咖啡 / 餐厅场景
交通建议
用餐预算
候选能力要求
安全默认
```

---

# 5. 8 小时产品包

P0.5 建议优先提供标准时长包，而不是让用户和 Agent 从零谈时薪。

```text
4 小时 · 半日城市同行
8 小时 · 一日城市同行
自定义时长 · 需要重新报价
```

价格必须属于当前 Task / Offer，不属于人的长期“标价”。

用户提供的河内市场观察可作为 Pilot benchmark：

```text
8h ≈ 2,500,000₫
```

该数字只作为实验参考，不写入 Canonical Price Floor；正式价格由真实供需、能力、语言、日期、时段和服务范围校准。

价格页面必须明确：

```text
本单服务价格
预计时长
超时价格 / 规则
餐饮是否包含
门票是否包含
交通是否包含
额外消费由谁承担
取消规则
```

禁止用含糊“全天价格”隐藏大量额外费用。

---

# 6. Fair Price / No Race to Bottom

城市同行不做公开反向竞价。

```text
Requester Need
→ Proxy 推荐价格区间 / 发布价格
→ Qualified Agent 接受或私密 Counter Offer
```

Agent 之间不得看到彼此最低报价并互相压价。

可用定价因子：

```text
base duration
language premium
licensed guide premium
weekend / holiday
urgency
specialized knowledge
photo / social assistance
night-time extension
travel distance
```

平台应优先提高高质量供给的收入，而不是用低价扩大 GMV。

---

# 7. 候选卡

普通城市同行候选第一层：

```text
姓名 / 头像
本单报价
履约率
满意率
已完成城市同行单量
语言
```

按需显示 1–3 个本单证明：

```text
中文：已验证
河内城市同行：26 单
摄影 / 拍照协助：已验证或历史结果
餐饮 / 夜生活熟悉度
```

正式导游路径额外显示：

```text
国际 / 国内 / 景点导游资格
资格状态
有效期
适用语言
相关导游历史
```

不显示不可解释的 `96% fit`。

不把“漂亮”做成平台主标签或公开排行榜。用户可以基于候选照片和个人偏好做最终选择，但 Proxy 主排序仍以资格、可用性、履约和本单适配为基础。

---

# 8. 照片与人物展示

城市同行是面对面体验，候选照片有合理选择价值，但必须继续遵守：

```text
Task First
People Second
Price attaches to Task, not Human
```

禁止：

```text
城市美女榜
附近美女无限瀑布流
照片下面挂长期售价
财富 / 打赏榜驱动排名
```

允许：

```text
需求成立后显示有限候选
候选照片
生活方式 / 兴趣 / 语言 / 职业背景
本单相关经历
```

照片访问和展示范围受 Agent consent / privacy policy 控制。

---

# 9. 行程与场景商业闭环

城市同行是 Proxy Scene Commerce 的强入口。

```text
Requester
→ 城市同行订单
→ Proxy / Agent 建议路线
→ 咖啡店 / 餐厅 / 合作场景
→ 到店 / 预订 / 消费
→ 商家归因
```

P0.5 可优先连接已有安全可控商业场景：

```text
咖啡店
餐厅
```

后续可在合规与运营成熟后扩展：

```text
景点
博物馆
商场
演出 / 展览
酒吧 / Lounge
摄影场景
```

商家推荐必须：

```text
用户意图相关
明确标识合作 / 推广
允许用户替换
不得以导游佣金诱导强制购物 / 消费
```

---

# 10. 履约主链

```text
Need
→ Classification Gate
→ Guided Need Build
→ Route / Scope Preview
→ Price Confirmation
→ Qualified Finite Candidates
→ Offer / Accept
→ Order
→ Check-in
→ In-progress itinerary
→ Check-out
→ Outcome / Satisfaction
→ Repeat / Trusted Relationship
```

建议订单事实：

```text
meeting_point
planned_start
planned_end
actual_check_in
actual_check_out
agreed_scope
planned_scenes[]
material_route_changes[]
completion_evidence
```

不要求平台持续监控私人生活；只记录订单履约需要的事实。

---

# 11. 安全与支持

全天同行比短时任务暴露更多现实风险，因此需要轻量但明确的订单安全能力：

```text
身份验证
紧急联系人 / 支持入口
订单内集合点与计划时段
可选位置共享
Material Scope Change 记录
投诉 / 骚扰 / 欺诈 / 安全事件入口
```

不得用“安全”为理由把产品做成持续 GPS 监控软件。

---

# 12. Outcome 与复购

用户首屏只判断：

```text
这次城市体验是否达到目的？
下次来 / 带朋友来是否愿意再次选择？
```

系统自动形成：

```text
on-time
completed duration
cancellation / no-show
material route changes
merchant scenes visited
repeat selection
```

长期高价值信号：

```text
Requester Repeat
Trusted Guide / Companion
Language Outcome
City Experience Satisfaction
Merchant Conversion
```

---

# 13. 商业模型

优先收入来源：

```text
Requester transaction / fulfillment fee
Guarantee / priority matching
Licensed / verified specialist premium service
Merchant reservation / attributed consumption commission
Hotel / accommodation referral partnership
Business traveler / concierge partnership
```

不要求主要从 Agent 收入中高比例抽成。

以用户提供的 `2.5m₫ / 8h` 市场观察做纯示例：

```text
50 单 / 天  → 125m₫ GMV / 天
100 单 / 天 → 250m₫ GMV / 天
```

若平台有效收入率为 12%：

```text
15m–30m₫ / 天
≈ 450m–900m₫ / 30 天
```

若为 15%：

```text
18.75m–37.5m₫ / 天
≈ 562.5m–1.125b₫ / 30 天
```

以上只是 unit economics scenario，不是收入预测；还未扣除税、退款、支付、客服、获客、合规与激励成本。

---

# 14. 供给侧重点

优质城市同行 Agent 可来自：

```text
外语能力者
旅游 / 酒店 / 餐饮从业者
本地生活熟悉者
摄影 / 内容能力者
有国际客人接待经验者
持证导游
```

Agent Earnings Cockpit 应直接回答：

```text
这单 4h / 8h
我到手多少
额外消费谁承担
距离多远
需要什么语言 / 资格
为什么我有资格
```

优秀 Agent 的职业经历、语言能力和真实 Outcome 应转化为更高价值订单。

---

# 15. 首发入口建议

消费者不必先进入“导游目录”。

首页自然语言：

> 第一次来河内，想找个人带我玩一天。

或轻量快捷入口：

```text
城市同行
```

之后由语义分类决定：

```text
普通城市同行
持证导游
需要进一步确认
```

---

# 16. P0.5 Acceptance

必须验证：

1. 城市同行是 `Task`，不是 `Activity`；
2. “正式导游”实际业务进入资格 Gate；
3. 外国游客正式导游不能进入未验证普通供给池；
4. 用户可以选择 4h / 8h / 自定义时长；
5. 服务价格与餐饮 / 门票 / 交通费用分离；
6. 候选卡显示履约、满意、完成量和本单相关能力；
7. 持证导游显示资格状态与适用范围；
8. 不出现人物价格橱窗；
9. 场景商家可以被行程引用并形成归因；
10. 合作商家不能靠佣金强制进入行程；
11. 行程重大变化可记录并重新确认；
12. Outcome / Repeat 可沉淀为 Trusted Relationship；
13. 单语言 UI；
14. 税务、旅游业务分类、导游合同 / 平台角色在正式上线前通过 Launch Gate。

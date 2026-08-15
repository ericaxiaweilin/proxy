# Proxy PRD v1.1 — R10.8 / City Guide Alignment R2

**状态**：CURRENT WORKING ALIGNMENT  
**日期**：2026-08-16

## 1. 当前 Source of Truth 关系

优先级不变：

```text
Canonical Registry R2
→ topical latest chapter
→ Chapter 20 MVP Cut
→ older increments
```

本轮新增 / 更新：

```text
Chapter 21A R3 — Adaptive Requester UX + Decision UI + Memory + Localization Runtime
Chapter 21E R2 — Activity / Scene Commerce refinements
Chapter 21F R1 — City Companion / Licensed Guide priority scene
P0 Engineering Acceptance R5 — runtime + guide gates
```

## 2. R10.8 原型已覆盖

```text
需求语义入口 / 三种交互模式
方案比较 / 需求预览
自适应候选卡 / 候选比较
渐进式 Satisfaction
Requester Memory / Suggested Memory
活动 / 需求分离
咖啡店 / 餐厅活动场景
活动感兴趣 / 分享 / 问答 / JOIN 后聊天
单语言消费者界面目标
```

## 3. R10.8 后新增但原型尚未完整覆盖

```text
City Companion / Local Host
Licensed City Guide Gate
4h / 8h city guide package
city itinerary preview
licensed guide credential card
route-linked scene commerce
hotel / concierge acquisition surface
```

因此：

```text
PRD = ahead of prototype for Chapter 21F
```

下一轮原型应优先补：

```text
城市同行语义入口
→ 4h / 8h
→ 路线 / 语言 / 讲解要求
→ City Companion vs Licensed Guide Gate
→ 有限候选
→ 行程预览
→ 价格 / 额外费用确认
→ Order / execution
```

## 4. 法律 Launch Gate

城市同行与正式导游的业务分类不得由前端名称决定。

正式上线前必须由越南当地法律 / 旅游合规顾问冻结：

```text
什么服务范围属于旅游向导
国际游客导游资格要求
平台与导游 / 旅行社 / 导游服务企业的合同结构
税务 / 付款 / 保险 / 责任
```

## 5. 用户提供的商业假设

当前讨论采用用户提供的河内观察作为实验输入：

```text
8h 高质量城市同行 / 导游 ≈ 2.5m₫
```

该数值不是 Canonical Price Floor，也不是市场事实冻结值，只用于产品与 unit economics 讨论。

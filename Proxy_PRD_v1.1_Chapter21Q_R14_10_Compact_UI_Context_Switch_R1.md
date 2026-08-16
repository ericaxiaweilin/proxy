# Proxy PRD v1.1
## Chapter 21Q — R14.10 Compact UI + Me-only Context Switch R1

**状态**：CURRENT PRODUCT CONTRACT  
**依赖**：R14.9 Hard Demand Domain · R14.8 Navigation Budget · R14.6 Contextual Persona IA

# 1. UI Density

R14.9 的产品逻辑保留，但 Phone Surface 不再采用“大展示稿”密度。

P0 原则：

```text
真实 App 密度
> 展示稿视觉冲击
```

重点压缩：
- Phone frame
- screen padding
- hero height
- industry / category cards
- metrics
- order / lead cards
- identity cards
- bottom nav

不得通过缩小字体到不可读来换密度。

# 2. Context Switch

身份切换只属于：

```text
我的
```

正常用户 Surface：

```text
Home
Tasks
Feed
```

不再显示可点击 Context Switch Pill。

原因：

```text
Home = 当前身份完成目标
Me   = 身份 / 资产 / 设置
```

Requester Me / Agent Me / Business Me 都必须保留：

```text
切换身份
```

# 3. Agent Home

Agent Home 只保留：

```text
new eligible demand
pending reply
active order
time-sensitive action
available now
```

不在 Header 放身份切换。

# 4. Requester Home

保留 R14.9：

```text
Hard Demand Category
+ Natural-language Goal
```

但 UI 更紧凑。

删除面向用户的工程说明：

```text
页面切换 2/5
Hard semantic boundary
AI UI plan
```

这些属于 Debug / Ops / PRD，不属于消费者 UI。

# 5. Agent Discovery

真实照片 / 视频 /风格继续保留。

但正常用户 UI 不再出现：

```text
人物发现不是美女榜
Beauty Score
Attractiveness Score
身材评分
永久分数
```

这些是内部 Policy / Ranking Boundary，不需要教育普通用户。

排序原则仍然保持：

```text
Eligibility
+ LocalContext
+ Availability
+ relationship / content utility
+ qualified conversation
+ Need
+ Order
+ Outcome
+ Repeat
```

# 6. Product Copy Rule

内部规则 ≠ 用户文案。

以下内容默认只属于：

```text
PRD
Ops Console
Engineering Acceptance
Policy
```

除非用户确实需要理解原因，否则不占消费者页面。

# 7. Mainline Preservation

R14.10 不改变 R14.9 Demand Contract：

```text
Hard Category
→ Goal
→ DemandPlan
→ UI Controller
→ Matching
→ Waiting / Active
```

也不改变：

```text
Agent Home
→ Lead / Order
→ Accept
→ Runtime Gate
→ Execute
```

以及：

```text
Business Home
→ Business Need / Enterprise Ops / Today Execution
```

# Proxy PRD v1.1
## Chapter 21A — Requester Experience Loop R3

**状态**：P0 UX CONTRACT · R3  
**依赖**：Canonical Registry R2 / Chapter 21 / Chapter 21B / Chapter 21D R3 FINAL  
**替代**：Chapter 21A R2 中与方案比较、候选比较、偏好记忆、中文化运行时相关的旧交互约定；其余未冲突规则继续有效。  
**目标**：让不同现实需求自动进入合适的交互模式；减少填写、减少工程字段暴露，同时保持价格、范围、地点、能力和结算等重大决定由用户显式控制。

---

# 1. 需求方北极星体验

```text
我有一个现实需求
→ Proxy 理解是什么类型的问题
→ 自动选择最合适的交互方式
→ 系统能确定的内容不让我重复填写
→ 只让我确认真正影响成交的内容
→ 给出有限且合格的候选 / 方案
→ 真人履约
→ 我判断问题是否真的被解决
→ 下次表达成本更低
```

成功不定义为：

```text
填完更多字段
浏览更多人
停留更久
完成更多评分项
```

成功定义为：

```text
Need understood
→ minimum human input
→ explicit material control
→ executable demand
→ qualified finite matching
→ successful human execution
→ outcome decision
→ lower repeat expression cost
```

---

# 2. 前台一级信息架构

P0 需求方底部主导航保持：

```text
首页 / 任务 / 钱包 / 我的
```

其中：

```text
首页 = 状态与下一步
任务 = 行动入口
```

`活动` 不作为首页小组件；活动属于任务域里的一级主功能：

```text
任务
├─ 需求
└─ 活动
```

硬规则：
- 首页不长期放“活动功能介绍”“当前开放场景”等产品自我解释；
- 首页优先显示真实待处理、即将发生、异常和下一步；
- 活动与付费需求是并列产品行为，不互相冒充；
- 付费购买某个人的能力 / 时间 / 结果仍进入需求主链；
- 一起参加真实消费场景进入活动主链。

---

# 3. 语义入口 → 交互策略

用户不需要先理解 Proxy 的完整服务分类。

主入口：

> 你现在需要什么？

系统执行：

```text
自然语言 / 轻入口
→ 需求理解
→ 任务类型判定
→ Interaction Policy
→ 对应交互模式
```

`Interaction Policy` 是前台交互策略，不新增 Marketplace 事实真相。

P0 至少支持三种模式：

## 3.1 快速执行
适合高度标准化、明确、可大量自动补全的服务。

例：酒后代驾。

用户最小操作原则：

```text
起点（定位并最终可调整）
目的地
必要车辆信息
最终价格确认
```

系统自动处理：

```text
当前时间
服务类型
人数
路线 / 距离
资格策略
附近供给
默认支付方式
风险规则
```

消费者界面不需要强调“AI”。

## 3.2 智能辅助
适合用户知道目标，但不知道如何定义专业任务。

例：餐厅体验检查。

```text
用户说目标
→ Proxy 生成可修改方案
→ 检查重点
→ 人员组合
→ 建议时间
→ 交付结构
→ 预算范围
→ 用户确认 / 调整
```

用户不是替数据库填写字段，而是审核 Proxy 准备好的可执行方案。

## 3.3 对话构建
适合复杂、非标准、重大未知较多的需求。

例：新店开业现场支持。

```text
一句需求
→ 只问 1–3 个当前最高影响问题
→ 重新构建方案
→ 再问必要问题
→ 需求确认
```

禁止一次性把全部数据库字段做成问卷。

---

# 4. 自动补全与显式确认

前台不以“是不是 AI 填的”为中心，而以“错误后果是否重大”为中心。

信息分三类：

## 4.1 系统事实
例如：

```text
当前时间
定位
账户身份
默认支付方式
历史保存车辆
距离 / 路线
```

默认直接使用，不逐字段显示 AI 标记。

## 4.2 安全默认 / 可修改默认
例如：

```text
现在出发
1 位执行者
默认结算方式
上次车辆
```

可以自动补全；必要时轻量提示“Proxy 已帮你补全”。

## 4.3 重大推断
若会改变以下任一项：

```text
Price
Eligibility
Location
Time
Scope
Hard Requirement
Settlement
Safety / Risk
```

必须在提交前显式展示并确认。

前台推荐文案：

```text
Proxy 已整理好，你只需要确认 2 项
```

而不是铺满：

```text
INFERRED / UNKNOWN / AI FILLED
```

原则：

> Minimum Human Input, Maximum Explicit Control.

---

# 5. Need Capture / Clarification

Primary Question：

> 你想让现实中发生什么变化？

输出仍可形成内部 `Need Hypothesis`：

```text
goal_summary
likely_scene
known_constraints
unknown_high_impact_items[]
```

但消费者界面不直接展示工程状态枚举。

澄清只问：

```text
high-impact unknowns
```

每次最多 1–3 个。

低影响未知：
- 使用安全默认；或
- 后置；或
- 保持未知但不阻塞。

禁止：

```text
ask because a database field exists
20-question wizard
repeat known facts
turn inferred value into hard requirement silently
```

---

# 6. Demand Preview

需求确认页必须围绕“用户现在真正要买什么”组织。

至少展示：

```text
目标
时间
地点
人数 / 名额
核心要求
价格 / 预算
交付结果
结算方式
仍需确认的重大项
```

普通系统事实不需要逐项要求用户再次确认。

Material Change 保持：

```text
CONFIRMED
→ RECONFIRMATION_REQUIRED
→ candidate version
→ user confirmation
→ new confirmed version
```

价格、地点、时间、范围、必要条件、结算方式变化不得静默生效。

---

# 7. 自适应候选卡

候选卡的目标不是展示完整能力档案，而是回答：

```text
这单多少钱？
他以前做事靠不靠谱？
其他需求方是否满意？
他为什么适合这单？
多久能到 / 距离多远？
```

## 7.1 通用第一层信息

```text
本单报价
履约率
满意率
已完成单量
距离 / 到达时间（适用时）
```

不得将人的长期档案价格化；价格属于当前 Task / Offer。

## 7.2 本单相关能力

能力型任务仅展示 1–3 个与当前需求相关的证明：

翻译：

```text
中文能力：已验证
商务口译：11 单
```

代驾：

```text
驾驶资格：已验证
代驾历史：126 单
```

门店体验：

```text
餐饮从业经验
门店体验历史
目标顾客画像适配
```

与本单无关的能力默认折叠到详情。

## 7.3 禁止不可解释综合分

消费者端默认禁止：

```text
96% fit
AI score 8.7
mystery match index
```

如果需要表达资格：

```text
核心要求全部符合
符合 3 / 3 项核心要求
```

## 7.4 推广

付费曝光必须：

```text
先通过 Eligibility
→ 才能购买曝光
```

前台只轻量显示：

```text
推广 · 已通过本单筛选
```

Boost 永远不能购买：

```text
KYC
Capability
Trust
Eligibility
Outcome
Reliability
```

---

# 8. Matching Room

匹配进度页展示：

```text
现在发生了什么
哪几个名额已推进
为什么还在等待
下一步系统做什么
是否需要用户确认
```

不得使用：

```text
fake countdown
fake scarcity
unverifiable searching animation
hidden hard-requirement relaxation
```

候选集是有限集合；不因为没有结果回退到人员目录。

---

# 9. Outcome / Satisfaction

结果反馈页不再要求用户填写：

```text
质量：好 / 一般 / 差
速度：好 / 一般 / 差
沟通：好 / 一般 / 差
可信度：高 / 中 / 低
过程体验：省心 / 一般 / 费心
```

这些维度没有清晰参照物，并会产生语义冲突。

首屏只问两个核心决策：

## 9.1 结果是否解决

```text
完全解决
部分解决
没解决
```

必须同时展示本单原始约定目标作为评价基准。

## 9.2 下次真实选择

```text
会，直接再用
看情况
不会
```

只有部分解决 / 没解决 / 看情况 / 不会时，才渐进展开原因。

系统自动记录：

```text
到场
准时
取消
No-show
完成时间
Evidence
Operator intervention
Recovery
```

用户不重复评分系统已经知道的事实。

Recovery 独立于 Satisfaction，并继续遵守 Recovery Before Retention。

---

# 10. 单语言界面规则

同一个消费者界面不得中英越混排。

```text
zh-CN surface → 中文
vi-VN surface → 越南语
en surface → English
```

内部可以继续使用：

```text
TaskSlot
OutcomeDelta
Eligibility
CASH_ON_SITE
```

但消费者 UI 应映射为本地语言。

允许保留：
- 品牌名 `Proxy`；
- 人名、商户固有名称；
- 必须保留的标准证书名称，例如 `HSK5`。

工程枚举、状态码和内部对象名不得因为实现方便直接泄漏到消费者页面。

---

# 11. 与活动主线的关系

活动详细规则由：

`Chapter 21E — Activity / Scene Commerce Contract`

负责。

需求与活动严格分离：

```text
需求 = 我需要某个人提供能力 / 时间 / 结果
活动 = 我们一起参加一个现实活动
```

二者可以共享同一个商家场景，但不是同一个交易类型。

---

# 12. Required Requester State Coverage

继续覆盖：

1. 空状态
2. 加载
3. 没有候选
4. 候选不足
5. 价格 / 时间变化
6. 付款处理中
7. 执行者临时取消
8. 安全 / 支持异常
9. 网络断开
10. 用户重新确认
11. 部分达成
12. 暂不复用

新增必须验证：

13. 快速执行最小输入
14. 智能辅助方案审核
15. 对话构建只问高影响未知
16. 候选卡不显示不可解释综合匹配分
17. 单语言消费者界面
18. 活动与付费需求之间正确跳转

---

# 13. 工程入口 Gate

需求方进入工程化前至少满足：

```text
Semantic Entry can resolve interaction policy
Quick Execute path is independently completable
Guided path is independently completable
Conversational Build path is independently completable
Material fields require explicit confirmation
Candidate cards are task-adaptive
Eligibility precedes ranking / promotion
Satisfaction is progressive, not a rating questionnaire
Consumer locale is internally consistent
Activity and paid Task remain separate domain paths
```

主线实施顺序：

```text
App Shell
→ Semantic Need Entry
→ Interaction Policy
→ Need Draft / Clarification
→ Solution / Demand Preview
→ Adaptive Matching
→ Execution
→ Outcome Decision
→ Memory / Repeat
```


---

# 14. R3 决策界面收敛规则

R3 新增：消费者端所有“比较 / 选择 / 记住”页面必须表现为真实决策界面，不得退化成后台管理面板。

## 14.1 方案比较

`DemandSolution` 状态仍保留在 Domain，但消费者界面不直接展示状态机。

推荐交互：

```text
方案卡整卡可选
→ 选中态清晰但克制
→ 只保留一个弱操作：暂不考虑
→ 页面底部一个主 CTA：确认当前方案并预览需求
```

禁止：

```text
[选择] [排除]
[选择] [排除]
[选择] [排除]
```

这种成对按钮矩阵会把消费者界面做成后台操作台。

方案卡必须回答：

```text
这个方案解决什么？
大约多少钱？
速度 / 确定性如何？
选择它会放弃什么？
```

## 14.2 需求预览必须保持主链可达

复杂需求主线必须真实可达：

```text
Need / Clarification
→ Solution Compare
→ Demand Preview
→ Settlement Commitment / Funding Gate
→ Matching
```

“目录里有页面”不等于验收通过。必须验证真实点击链可达、页面依赖函数存在、页面可渲染、关键 CTA 能推进状态。

## 14.3 候选比较

候选比较不得使用“每个人一个选择按钮 + 每个人一个排除按钮”的按钮矩阵。

推荐：

```text
三张轻量可选候选行 / 卡
→ 点卡即选择
→ 选中态同步到底部决策栏
→ 查看详情（次操作）
→ 确认选择并继续（主操作）
```

`暂不考虑候选` 应进入候选详情 / 更多操作，不和主选择动作同权重。

比较字段应保持任务自适应：

```text
报价
履约率
满意率
完成单量 / 相关经验
ETA / 距离（适用时）
1–3 个本单能力证明（仅能力型任务）
```

---

# 15. 偏好记忆与建议 UI

Requester Memory 必须区分：

```text
已确认记忆
Suggested Memory
```

## 15.1 已确认记忆

消费者卡片只展示：

```text
偏好名称
自然语言值
来源的用户可理解描述
已记住
```

禁止直接展示：

```text
source: SATISFACTION
source: EXPLICIT
CONFIRMED
OUTCOME_SUGGESTED
```

整卡可进入编辑页；删除放在编辑页，不在列表首层重复堆“修改 / 删除”按钮。

## 15.2 建议记忆

建议不得自动写入 RequesterMemory。

```text
建议
→ 用户明确“记住”
→ CONFIRMED RequesterMemory

建议
→ 用户“忽略”
→ DISMISSED
→ 不影响未来默认、排序或 Hard Requirement
```

前台推荐：

```text
建议你确认 · 不会自动生效

口译偏好
开业任务优先提前锁定已验证口译人员

根据上次结果提出的建议
[忽略] [记住]
```

---

# 16. 本地化运行时安全

消费者单语言规则不仅是文案要求，也是运行时约束。

任何本地化实现不得修改：

```text
<style>
<script>
class name
id
CSS selector
JS variable / enum
route id
```

本地化只能处理允许的可见文本节点 / 受控资源字符串。

禁止使用“全 DOM 字符串替换”导致：

```text
.quietaction → .quiet操作
.memoryvalue → .memory内容
.confirmed → .已确认
```

这类错误会使 CSS selector 与 DOM class 失配，并产生未样式化原生控件。

必须有测试：

```text
CSS text before localization == CSS text after localization
JS source before localization == JS source after localization
route ids unchanged
class / id unchanged
```

---

# 17. R3 UI 质量 Gate

除功能完整性外，必须增加实际运行时页面检查：

```text
all registered routes render
all sidebar / nav entries are reachable
no undefined helper/function on click path
no raw browser-default primary action controls
no horizontal overflow on target viewport
bottom navigation does not cover content
localized consumer surface contains no high-risk internal enums
```

静态“页面数量 = 目录数量”只能作为第一层检查，不能替代真实主链可达性检查。

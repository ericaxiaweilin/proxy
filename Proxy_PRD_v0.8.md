# Proxy（分身）产品需求文档（PRD）v0.8

> 产品定位：泛场景真人代理（Human Agent）撮合平台
>
> 核心主张：**不是找个人跑腿，是找对的人出现。**
>
> 本版基于：PRD v0.2、MVP 功能规格 v0.3、检索匹配与治理规则 v0.4、PRD v0.5/v0.6 继续收敛；本轮重点把 Requester 的核心匹配体验拆到页面、状态、后端访问 Contract、埋点与验收标准。

---

## 0. 文档目的与本版结论

本 PRD 的目标不是继续扩功能，而是把 Proxy 第一阶段产品定义收敛到可以直接进入：

1. 原型设计；
2. 技术拆分；
3. 运营规则设计；
4. MVP 验收；
5. 小范围城市冷启动。

### 0.1 本版关键决策

- Proxy 仍定位为“泛场景真人代理平台”，但 **MVP 只验证两个任务场景：代排队 + 活动陪同**。
- 第一阶段真正要验证的不是“有没有人愿意接单”，而是：**结构化属性检索是否能提升匹配成功率与付费意愿**。
- “属性组合筛选”必须属于 P0；高级排序、个性化推荐、动态权重属于 P1。
- 所有订单必须是“任务交易”，不能变成“购买某个人本身”。
- 敏感属性筛选必须绑定任务理由，不能开放自由外观描述。
- 活动陪同采用“父任务 + 人员席位 Slot”模型，避免多人任务在订单、放款、取消、评价上失控。
- 资金状态、任务状态、人员状态拆开管理，避免一个字段承担所有业务状态。

---

## 1. 产品背景与问题定义

现代生活与商业活动中存在大量“需要另一个人替我出现、替我执行、替我代表”的临时需求，但现有解决方式通常分散在跑腿、兼职、陪同、陪玩、活动执行等不同平台中。

Proxy 不把所有 Agent 视为同质化劳动力，而是把“人与任务之间是否匹配”作为核心产品问题。

### 1.1 用户问题

#### 发布方

- 我不是只想找“最近的人”，而是找“适合这个场景的人”。
- 临时任务很难快速找到可信、可履约、属性合适的人。
- 在微信群、Facebook 群、兼职群里找人，信息不结构化，筛选成本高。
- 即使找到人，也缺少担保、履约证据、纠纷处理机制。

#### Agent

- 现有跑腿/零工市场高度价格化、同质化，个人差异难以体现。
- 自己会英语、主持、摄影、懂某行业，但这些能力无法直接转化为更匹配的任务。
- 新人缺少评价时很难获得第一批订单。
- 线下见面任务存在骚扰、临时加需求、拒付等风险。

### 1.2 核心机会

Proxy 要把以下三件事组合到一个产品中：

1. 结构化 Agent 档案；
2. 线下真实任务执行；
3. 多场景复用同一套 Agent 供给。

核心不是做更多任务品类，而是形成一套可扩展的“任务需要什么人 → 找到合适的人 → 安全完成交易”的通用撮合基础设施。

---

## 2. 产品定位

### 2.1 一句话定位

**Proxy 是一个按任务需求寻找真人代理的撮合平台。**

### 2.2 用户心智

不是：

- 外卖；
- 跑腿；
- 纯兼职招聘；
- 交友；
- 付费陪伴；
- 人力外包。

而是：

> “我有一个明确任务，需要一个符合条件的人在指定时间、指定地点替我出现并完成。”

### 2.3 核心价值主张

#### 对发布方

找“适合任务的人”，而不是找“最快接单的人”。

#### 对 Agent

把个人真实属性、技能和履约能力转化为更适合自己的任务机会。

#### 对平台

沉淀可跨场景复用的结构化 Agent 数据与履约数据。

---

## 3. MVP 要验证的核心假设

### H1：任务存在付费需求

用户愿意为“真人替我出现/执行”支付服务费，而不是继续使用熟人、群聊、临时兼职等非平台方式。

### H2：结构化匹配有价值

使用场景相关属性筛选的任务，其接单成功率、发布方满意度或复购率显著优于只按距离/价格寻找 Agent 的任务。

### H3：同一 Agent 可以跨场景复用

至少一部分 Agent 能同时承接不同类型任务，从而证明 Proxy 不是两个独立垂直业务的简单拼接。

### H4：任务化治理可以控制风险

通过任务描述、明确交付物、平台审核、证据留存与敏感属性限制，可以把产品保持在“任务撮合”而非“人本身交易”的边界内。

---

## 4. MVP 范围

### 4.1 首发场景

#### 场景 A：代排队

特点：

- C2C 为主；
- 高频潜力较高；
- 属性要求弱；
- 强位置、强时间约束；
- 适合验证基础交易闭环。

#### 场景 B：活动陪同

特点：

- B2C 为主；
- 频率低于代排队；
- 属性匹配价值更强；
- 可能多人协作；
- 适合验证 Proxy 的核心差异化能力。

### 4.2 P0：首版必须具备

- 手机号/邮箱登录；
- 用户角色切换；
- Agent 实名认证；
- Agent 基础结构化档案；
- Agent 可用时间/接单状态；
- 两类任务发布；
- 场景相关属性组合筛选；
- Agent 任务大厅；
- 候选 Agent 检索页；
- 接单/选人；
- 基础支付/资金锁定状态；
- 订单状态机；
- 到场定位打卡；
- 图片凭证上传；
- 发布方确认完成；
- 自动放款兜底规则；
- 双向评价；
- 举报/纠纷入口；
- 基础运营后台；
- 敏感属性任务审核。

### 4.3 P1：上线后补齐

- 高级推荐排序；
- 履约分模型；
- 动态定价；
- 新手保护权重自动化；
- 活动多人任务分批放款；
- 作品集；
- 证书/技能认证；
- 更精细的通知策略；
- 黑名单/风控策略；
- 数据看板。

### 4.4 P2：验证核心假设后再做

- 语音/视频样本；
- 平台在线技能测试；
- 专业陪同；
- 内容出镜；
- 代购/代办；
- 转让信息栏；
- AI 自动生成匹配条件；
- 跨城市规模化扩张。

### 4.5 明确不做

第一阶段不做：

- 任何形式的约会/交友产品；
- 性暗示或成人服务；
- 长期雇佣撮合；
- 家政大类平台；
- 全品类 Freelancer Marketplace；
- 代考、作弊、违法代办；
- 无明确任务内容的“陪我几个小时”式开放订单。

---

## 5. 用户角色与权限

### 5.1 Requester（发布方）

可为个人或商家。

核心权限：

- 发布任务；
- 选择/筛选 Agent；
- 支付；
- 查看履约证据；
- 确认完成；
- 评价；
- 发起纠纷。

### 5.2 Agent（执行方）

核心权限：

- 建立档案；
- 设定可接单状态；
- 浏览任务；
- 报名/接单；
- 执行任务；
- 提交凭证；
- 收款；
- 评价发布方；
- 举报/求助。

### 5.3 Operator（平台运营）

核心权限：

- 审核敏感任务；
- 审核 Agent 资料；
- 查看订单轨迹；
- 处理举报；
- 仲裁；
- 手动暂停/退款/放款；
- 封禁账号；
- 配置标签、场景、审核规则。

---

## 6. 核心业务对象

### 6.1 User

平台自然人账号。

一个 User 可以同时拥有：

- Requester 身份；
- Agent 身份。

避免后续产生两个账号体系。

### 6.2 AgentProfile

Agent 的结构化档案。

### 6.3 Task

发布方表达的一次明确需求。

### 6.4 TaskSlot

任务中的一个可被具体 Agent 占用的执行席位。

- 代排队：默认 1 个 Slot；
- 活动陪同：可有 N 个 Slot。

### 6.5 Application

Agent 对某 Task/Slot 的报名记录。

### 6.6 Order

Requester 与某个 Agent/Slot 形成的正式履约关系。

多人任务中：

- 1 个 Task；
- N 个 TaskSlot；
- N 个 Order。

这样可以分别处理：

- 某人取消；
- 某人未到场；
- 某人凭证不合格；
- 某人单独退款/放款；
- 某人单独评价。

### 6.7 Evidence

任务履约凭证，包括：

- 定位打卡；
- 时间戳；
- 图片；
- 视频（P1）；
- 文本备注；
- 发布方确认记录。

### 6.8 PaymentLedger

平台记录的资金状态账本。

资金实际处理可由合规支付服务商承接，产品层不把“平台自己持有资金”写死。

---

## 7. Agent 档案系统

### 7.1 基础字段

| 字段 | 类型 | MVP | 是否参与检索 |
|---|---|---:|---:|
| 昵称 | 文本 | P0 | 否 |
| 头像 | 图片 | P0 | 否 |
| 性别 | 单选/不透露 | P0 | 场景控制 |
| 年龄段 | 区间 | P0 | 场景控制 |
| 身高 | 数值 | P0 可选 | 场景控制 |
| 城市/区域 | 定位+选择 | P0 | 是 |
| 语言能力 | 多选 | P0 | 是 |
| 技能标签 | 多选 | P0 | 是 |
| 风格标签 | 多选 | P1 | 是 |
| 职业/教育背景 | 多选 | P1 | 是 |
| 可用时间 | 时间段 | P0 | 是 |
| 接单状态 | 在线/忙碌/暂停 | P0 | 是 |
| 实名状态 | 系统字段 | P0 | 硬门槛 |
| 履约分 | 系统字段 | P1 | 排序 |
| 任务次数 | 系统字段 | P0 | 展示 |
| 取消率 | 系统字段 | P1 | 排序/风控 |
| 作品集 | 多媒体 | P1 | 辅助决策 |

### 7.2 属性标签原则

属性分为三类：

#### A. 强业务属性

与任务能力直接相关：

- 语言；
- 主持；
- 摄影；
- 驾驶；
- 行业经验。

默认允许用于检索。

#### B. 场景属性

可能只在特定场景合理：

- 性别；
- 身高；
- 风格。

必须由场景配置决定是否展示。

#### C. 禁止属性

平台不允许将以下维度作为公开检索标签：

- 民族；
- 宗教；
- 政治立场；
- 私密健康信息；
- 性取向；
- 任何明显用于成人服务的身体属性。

---

## 8. 任务发布系统

### 8.1 通用任务字段

所有任务必须包含：

- 任务场景；
- 任务标题；
- 具体地点；
- 开始时间；
- 预计结束时间/截止时间；
- 任务交付物；
- 报酬；
- 取消规则；
- 联系方式是否允许订单成立后展示；
- 是否涉及敏感属性筛选。

### 8.2 代排队字段

- 门店名称；
- 门店地址；
- 排队开始时间；
- 最晚到场时间；
- 排队截止时间；
- 交接方式；
- 是否允许离场等待；
- 悬赏金额；
- 备注；
- 可选语言能力要求。

默认不展示：

- 性别；
- 身高；
- 风格。

### 8.3 活动陪同字段

- 活动名称；
- 商家/组织名称；
- 活动地址；
- 到场时间；
- 结束时间；
- 所需人数；
- 角色类型；
- 服装要求；
- 是否需要主持；
- 是否需要外语；
- 是否拍照；
- 是否出镜；
- 是否发布社媒；
- 素材使用范围；
- 单人报酬；
- 敏感属性筛选及任务理由。

### 8.4 任务交付物必须结构化

不能只允许一个“备注”字段。

示例：

#### 代排队

- 到场打卡；
- 排队位置照片；
- 排到后通知；
- 交接确认。

#### 活动陪同

- 到场打卡；
- 停留满约定时长；
- 完成指定角色；
- 提交 X 张照片；
- 提交指定素材。

这决定后续能否客观判断任务是否完成。

---

## 9. 检索与匹配系统

### 9.1 检索分两层

#### 第一层：基础筛选

所有场景可用：

- 距离；
- 可用时间；
- 报价/报酬匹配；
- 实名状态；
- 当前接单状态。

#### 第二层：场景属性筛选

由场景配置动态展示。

| 场景 | 可筛选属性 |
|---|---|
| 代排队 | 距离、时间、语言能力 |
| 活动陪同 | 距离、时间、语言、主持/技能、性别、身高、风格 |
| 专业陪同（未来） | 距离、时间、职业/教育背景、语言、认证 |
| 内容出镜（未来） | 距离、时间、作品集、风格、技能 |

### 9.2 P0 搜索逻辑

P0 不需要复杂 AI 推荐。

流程：

1. 先过滤不可用 Agent；
2. 再过滤硬条件；
3. 再按基础排序展示；
4. 发布方可以继续调整筛选条件。

P0 基础排序：

- 距离；
- 是否当前可接单；
- 历史完成单量；
- 新 Agent 保护。

### 9.3 P1 排序逻辑

可升级为：

综合分 = 距离 + 履约 + 响应速度 + 价格竞争力 + 新手保护修正

注意：

- 属性条件用于过滤；
- 不生成“颜值分”“人气榜”；
- 敏感属性不参与公开热度排行榜。

### 9.4 零结果策略

搜索无结果时不得直接显示“没有合适的人”。

系统依次建议：

1. 放宽非必要属性；
2. 扩大距离；
3. 调整时间；
4. 提高报酬；
5. 转为公开报名。

同时明确告诉用户是哪类条件导致候选池显著缩小。

---

## 10. 敏感属性治理

### 10.1 允许筛选的前提

发布方选择性别、身高、风格等敏感属性前，必须：

1. 选择系统预置的“任务需要原因”；
2. 不能自由输入外观评价类描述；
3. 任务进入审核队列。

### 10.2 示例原因标签

- 指定角色设定需要；
- 指定服装尺码/舞台呈现需要；
- 指定男声/女声主持；
- 活动主题角色需要；
- 客户明确要求某角色类型。

### 10.3 禁止文案

例如：

- 只要美女；
- 长得好看优先；
- 身材好；
- 可陪酒；
- 可私下继续；
- 看照片决定多少钱。

此类描述直接拒绝发布。

### 10.4 结果展示规则

- 不做颜值榜；
- 不做“最受欢迎外形”；
- 不做敏感属性点击热度；
- Agent 可选择不公开部分敏感属性；
- 不公开不应直接降低基础排序优先级。

---

## 11. Task / Slot / Order 状态机

### 11.1 Task 状态

```text
DRAFT
→ PENDING_REVIEW（仅需要审核时）
→ OPEN
→ PARTIALLY_FILLED（多人任务）
→ FILLED
→ IN_PROGRESS
→ COMPLETED

异常终态：
CANCELLED
EXPIRED
REJECTED
```

### 11.2 TaskSlot 状态

```text
OPEN
→ RESERVED
→ ASSIGNED
→ IN_PROGRESS
→ EVIDENCE_SUBMITTED
→ COMPLETED

异常：
CANCELLED
NO_SHOW
DISPUTED
```

### 11.3 Order 状态

```text
CREATED
→ PAYMENT_SECURED
→ CONFIRMED
→ IN_PROGRESS
→ EVIDENCE_SUBMITTED
→ WAITING_REQUESTER_CONFIRMATION
→ COMPLETED
→ PAID_OUT

异常：
CANCELLED
REFUND_PENDING
REFUNDED
DISPUTED
ARBITRATION
```

### 11.4 Payment 状态单独管理

```text
UNPAID
→ AUTHORIZED / SECURED
→ CAPTURED
→ PAYOUT_PENDING
→ PAID_OUT

或：
REFUND_PENDING
→ REFUNDED
```

禁止仅靠 Order.status 推断资金真实状态。

---

## 12. 场景 A：代排队完整流程

### 12.1 发布

Requester：

1. 选择“代排队”；
2. 填门店与位置；
3. 设定最晚到场/截止时间；
4. 选择交接方式；
5. 填写报酬；
6. 支付；
7. 发布。

### 12.2 接单

Agent：

1. 在任务大厅看到任务；
2. 查看距离、时间、报酬、交接方式；
3. 点击接单；
4. 系统再次确认预计到场时间；
5. 接单成功。

### 12.3 执行

Agent 到店：

1. 定位打卡；
2. 上传排队现场照片；
3. 开始计时；
4. 排到后点击“已排到”；
5. 通知 Requester；
6. 双方完成交接。

### 12.4 完成

Requester：

- 扫码确认或 App 内确认；
- 系统进入放款流程；
- 双方评价。

### 12.5 异常

#### 无人接单

- 到设定阈值后提示加价；
- 可扩大范围；
- 可取消并退款。

#### Agent 迟到

- 超过最晚到场时间仍未打卡；
- 自动释放该 Agent；
- 任务重新开放；
- 是否扣分依据取消原因。

#### Requester 未确认

- Agent 已提交定位 + 照片 + “已交接”证据；
- 超过确认时限进入自动放款或人工复核。

#### 门店规则导致无法代排

Agent 可选择“现场不可执行”，上传现场规则/照片；平台依据证据决定取消责任归属。

---

## 13. 场景 B：活动陪同完整流程

### 13.1 发布

商家：

1. 创建活动任务；
2. 设置人数 N；
3. 每人一个 Slot；
4. 设置时间、地点、角色、交付物；
5. 设置允许筛选的属性；
6. 敏感属性必须选择理由；
7. 支付预算；
8. 进入审核或直接发布。

### 13.2 选人模式

支持两种：

#### A. 商家主动选人

商家通过检索列表邀请 Agent。

#### B. 开放报名

Agent 主动报名，商家从报名池选择。

P0 可以两者都保留，但 UI 以“开放报名”为默认，主动选人作为增强方式。

### 13.3 多人任务席位

每个 Agent 被选择后占用一个 Slot。

当：

- 3/5 人已确认 → Task = PARTIALLY_FILLED；
- 5/5 人已确认 → Task = FILLED。

### 13.4 执行

每个 Agent 独立：

- 到场打卡；
- 开始任务；
- 完成规定时长；
- 上传素材；
- 提交完成。

### 13.5 完成与放款

P0：

- 商家统一审核；
- 但每个 Agent 的订单独立确认/放款。

P1：

- 支持到场 50% + 素材通过 50% 的分阶段放款。

### 13.6 某个 Agent 缺席

只影响对应 Slot/Order，不应导致整场任务自动失败。

系统可重新开放该 Slot，直到活动的“最晚补人时间”。

---

## 14. Agent 任务大厅

### 14.1 卡片必须展示

- 任务类型；
- 距离；
- 开始时间；
- 预计时长；
- 报酬；
- 所需技能；
- 是否需审核/认证；
- 任务状态；
- 是否多人任务。

### 14.2 Agent 筛选

- 距离；
- 时间；
- 报酬；
- 场景；
- 是否即时任务；
- 是否需要特定技能。

### 14.3 不展示

Agent 端不应看到发布方使用了哪些敏感属性去筛选其他候选人，避免强化歧视感知。

---

## 15. 支付与结算

### 15.1 原则

产品需要表达的是“资金已锁定/已保障”，具体支付架构可依据当地支付能力实现。

### 15.2 费用组成

用户看到：

- Agent 报酬；
- 平台服务费；
- 其他明确费用；
- 总支付金额。

Agent 看到：

- 任务报酬；
- 平台抽成；
- 预计到账金额。

### 15.3 MVP 佣金

建议首版统一基础佣金，避免过早把复杂佣金逻辑引入交易链路。

敏感属性任务高佣金可保留为商业策略，不建议首版作为核心产品规则。

---

## 16. 取消、爽约与责任归属

取消必须记录：

- 谁取消；
- 取消时间；
- 距任务开始多久；
- 取消原因；
- 是否已产生实际成本；
- 是否影响履约分；
- 是否退款；
- 是否补偿对方。

### 16.1 MVP 建议分段

#### 未接单前

Requester 可无责取消。

#### 接单后但距离任务开始较远

允许无责/低成本取消。

#### 临近任务开始

取消方承担违约成本。

#### 已开始执行

原则上不能无责取消，需进入异常/纠纷流程。

具体比例作为运营配置，不写死在客户端。

---

## 17. 任务凭证与完成判定

### 17.1 凭证组成

- 时间；
- 地点；
- 图片/素材；
- 系统行为记录；
- 双方确认。

### 17.2 凭证原则

凭证必须与“发布任务时定义的交付物”一一对应。

如果任务发布时没有结构化交付物，后续仲裁几乎无法客观判断。

### 17.3 防伪基础能力

P0：

- 图片上传时间；
- GPS 打卡；
- 订单内拍照优先；
- 防重复提交；
- 关键操作时间戳。

P1：

- EXIF/设备信息辅助；
- 图片相似度检测；
- 地理围栏；
- 异常位置检测。

---

## 18. 评价与信誉体系

### 18.1 双向评价

Requester 评价 Agent：

- 是否准时；
- 是否按要求完成；
- 沟通；
- 总体满意度。

Agent 评价 Requester：

- 需求是否真实清晰；
- 是否临时加需求；
- 沟通是否尊重；
- 是否按时确认。

### 18.2 防止评价变成外貌评价

活动陪同任务的评价项不得出现：

- 颜值；
- 身材；
- 性感；
- 外形打分。

允许的是：

- 是否符合任务角色；
- 仪表是否符合预先约定；
- 表达能力；
- 主持/沟通能力。

---

## 19. 安全、举报与纠纷

### 19.1 Agent 任务执行页常驻安全入口

必须支持：

- 举报；
- 紧急求助；
- 结束任务并说明原因；
- 联系平台客服。

### 19.2 联系信息保护

- 接单前不展示双方私人联系方式；
- 订单成立后优先使用平台聊天；
- 电话号码可使用脱敏/虚拟号能力时再升级。

### 19.3 纠纷类型

至少包括：

- Agent 未到场；
- Requester 临时加需求；
- 拒付/拖延确认；
- 凭证不完整；
- 素材不符合约定；
- 骚扰；
- 人身安全；
- 违规任务；
- 现场不可执行。

### 19.4 仲裁后台需要看到

- 任务原始描述；
- 修改历史；
- 订单时间线；
- 双方聊天记录（平台内）；
- 定位；
- 凭证；
- 付款状态；
- 取消记录；
- 历史举报；
- 历史纠纷。

---

## 20. 审核运营后台

### 20.1 任务审核队列

支持：

- 查看任务；
- 查看触发规则；
- 通过；
- 拒绝；
- 要求修改；
- 封禁发布方敏感属性权限。

### 20.2 Agent 审核

L0：实名认证。

L1：自主填写。

L2：资料认证。

L3：平台测试（后续）。

### 20.3 场景配置后台

运营可以配置：

- 场景名称；
- 发布字段；
- 可筛选属性；
- 是否需要审核；
- 默认交付物；
- 取消规则；
- 推荐价格；
- 是否允许多人任务。

这一步很重要：未来新增场景应该优先“配置”，而不是每加一个场景就重写一套产品逻辑。

---

## 21. 页面信息架构

### 21.1 Requester 端

1. 首页；
2. 发布任务；
3. 任务发布确认；
4. Agent 检索结果；
5. Agent 详情；
6. 报名候选池；
7. 订单详情；
8. 凭证查看；
9. 评价；
10. 纠纷提交；
11. 我的任务；
12. 消息中心。

### 21.2 Agent 端

1. 任务大厅；
2. 任务详情；
3. 报名/接单确认；
4. 执行任务；
5. 凭证提交；
6. 我的订单；
7. 收益；
8. 我的档案；
9. 认证中心；
10. 评价与履约；
11. 安全/举报；
12. 消息中心。

### 21.3 平台运营端

1. Dashboard；
2. 任务审核；
3. Agent 审核；
4. 订单查询；
5. 纠纷仲裁；
6. 用户/封禁；
7. 场景配置；
8. 标签配置；
9. 运营数据；
10. 财务对账。

---

## 22. 通知系统

### 22.1 Requester

- 任务审核通过/拒绝；
- 有 Agent 接单/报名；
- Agent 已出发；
- Agent 已到场；
- Agent 已提交凭证；
- 即将自动放款；
- 纠纷状态更新。

### 22.2 Agent

- 新匹配任务；
- 报名通过；
- 即将开始；
- 距离要求到场时间不足；
- Requester 发送消息；
- 凭证被打回；
- 放款完成；
- 纠纷状态更新。

### 22.3 通知原则

避免所有任务都群发给所有 Agent。

P0 可以基于：

- 城市/距离；
- 可用时间；
- 技能匹配；
- 场景偏好。

做基础推送过滤。

---

## 23. 数据埋点与核心指标

### 23.1 漏斗

Requester：

```text
打开发布页
→ 完成任务表单
→ 完成支付
→ 任务成功发布
→ 获得候选/接单
→ Agent 到场
→ 成功完成
→ 再次发布
```

Agent：

```text
完成注册
→ 完成实名认证
→ 完成档案
→ 浏览任务
→ 报名/接单
→ 到场
→ 完成
→ 再次接单
```

### 23.2 MVP 北极星指标

建议第一阶段不要只看 GMV。

优先看：

**有效任务完成率 = 成功完成订单数 / 已支付并发布订单数**

### 23.3 核心验证指标

- 首次接单时间；
- 候选池大小；
- 属性筛选使用率；
- 使用属性筛选后的完成率；
- 未使用属性筛选的完成率；
- Requester 复购率；
- Agent 30 天复接率；
- Agent 跨场景接单率；
- 平均任务毛利；
- 取消率；
- 爽约率；
- 纠纷率；
- 敏感任务拒审率。

### 23.4 必须记录的匹配数据

每次搜索记录：

- 场景；
- 使用的筛选项；
- 候选数量；
- 用户是否放宽条件；
- 点击了哪些 Agent；
- 最终选了谁；
- 最终是否完成。

否则后续无法证明“结构化检索”是否真的是护城河。

---

## 24. MVP 验收标准

### AC-01 Agent 注册

- 未实名认证不可接单；
- 完成基础档案后可进入任务大厅。

### AC-02 任务发布

- 两类场景都能完成发布；
- 缺少必要字段不能提交；
- 敏感属性任务进入审核。

### AC-03 属性筛选

- 不同场景显示不同属性；
- 代排队默认不出现性别/身高；
- 活动陪同可按配置展示；
- 多个属性可组合过滤；
- 零结果有放宽建议。

### AC-04 接单

- Agent 不可同时接受时间冲突的任务；
- 订单成立后对应 Slot 被锁定。

### AC-05 凭证

- Agent 可完成定位打卡；
- 可上传规定数量图片；
- 凭证带时间戳。

### AC-06 放款

- Requester 可确认完成；
- 超时可进入自动放款/人工规则；
- 每个 Order 独立结算。

### AC-07 多人活动

- Task 可配置 N 个 Slot；
- 每个 Slot 可由不同 Agent 占用；
- 单个 Agent 取消不影响其他 Agent 的订单状态。

### AC-08 安全

- 任务执行页常驻举报入口；
- 敏感任务可人工下架；
- 运营可查看完整订单时间线。

---

## 25. 冷启动策略

### 25.1 地理范围

首版不建议同时覆盖整个越南。

应优先选择一个城市/一个高密度区域，保证：

- 供给密度；
- 任务响应速度；
- 线下运营可触达；
- 仲裁成本可控。

### 25.2 Agent 冷启动

第一批供给不追求数量，而追求“档案可被检索”。

招募时需要覆盖不同：

- 区域；
- 可用时段；
- 语言；
- 主持/摄影等技能；
- 基础人群结构。

### 25.3 任务冷启动

不应该只靠用户自然发布。

可以由平台/合作商户产生一部分种子任务，目的是让 Agent 有真实履约记录，而不是制造虚假交易。

---

## 26. 商业模式

### 26.1 第一阶段

主要收入：

- 订单服务费/佣金。

### 26.2 第二阶段

可测试：

- 企业套餐；
- 高频商户工具；
- 认证服务；
- 优先曝光。

### 26.3 暂不建议第一阶段上线

- Agent 付费买排名；
- 敏感属性任务高价曝光；
- 复杂会员体系。

原因：会干扰 MVP 对“真实匹配价值”的验证。

---

## 27. 核心风险

### 27.1 产品被理解成“租人/陪伴”

解决原则：

- 必须有明确任务；
- 必须有交付物；
- 必须有时间地点；
- 禁止模糊陪伴描述；
- 禁止性暗示。

### 27.2 属性筛选演化成外貌市场

解决原则：

- 场景决定可筛选字段；
- 敏感属性必须绑定理由；
- 禁止自由外貌文案；
- 结果不按外貌热度排序。

### 27.3 供给池过小导致筛选后没人

解决原则：

- 只在供给足够的区域上线；
- 零结果自动建议放宽条件；
- MVP 不开放过多标签；
- 先保证 5-10 个高频、可解释筛选维度，而不是 50 个标签。

### 27.4 多场景导致冷启动失焦

解决原则：

- 品牌和架构保持泛场景；
- 运营只打两个场景；
- 若供给被摊薄，优先收缩到代排队跑交易密度，再保留活动陪同作为结构化匹配验证场景。

---

## 28. 产品阶段路线图

### Phase A / Prototype

目标：跑通原型与产品逻辑。

- Agent 建档；
- 发布任务；
- 属性筛选；
- 任务大厅；
- Slot/Order；
- 凭证；
- 完成/结算；
- 审核后台。

### Phase B / Closed Beta

目标：真实小规模交易。

- 单城市；
- 限定 Agent；
- 人工运营辅助；
- 手动仲裁；
- 收集匹配数据。

### Phase C / Matching Improvement

目标：证明结构化匹配价值。

- 履约分；
- 推荐排序；
- 新手保护；
- 动态价格；
- 作品集；
- 资料认证。

### Phase D / Expand

只有当以下条件成立后再扩场景：

- 两个 MVP 场景完成率稳定；
- 有可重复的 Agent 供给获取方式；
- 结构化筛选能证明提升转化或复购；
- 纠纷率可控；
- 至少部分 Agent 有跨场景复用行为。

---

## 29. 当前仍需产品负责人最终拍板的事项

### D1 首发城市

决定冷启动供给结构、支付、审核和运营方式。

### D2 代排队是否允许“过号带位”

涉及门店规则与线下争议，需要明确平台支持边界。

### D3 活动陪同是否允许“发布社媒”作为强制交付物

涉及个人账号、广告披露、素材授权等额外问题，建议 MVP 默认可选，不作为核心必选项。

### D4 支付方式

产品只定义资金状态，不预设平台自建托管。

### D5 敏感属性范围

建议首版极度克制，优先开放：

- 语言；
- 技能；
- 角色需要；

性别/身高/风格仅限明确活动场景。

---

## 30. 最终产品判断标准

Proxy 第一阶段是否成立，不看“功能做了多少”，看三件事：

1. 用户是否愿意发布并支付真实任务；
2. “按任务需要找对的人”是否比普通跑腿匹配产生更好的交易结果；
3. 同一套 Agent 档案能否被多个场景复用。

如果第 2 点无法成立，Proxy 会退化成普通跑腿/零工平台；
如果第 3 点无法成立，Proxy 会退化成多个垂直业务的拼盘。

因此，**结构化 Agent 档案 + 场景约束属性检索 + 可验证履约数据**，必须从 MVP 第一版开始就是主链，而不是上线后再补的增强功能。


---

## 31. Proxy 的核心能力：Task-conditioned Human Matching

### 31.1 核心能力不是“标签筛选”

Proxy 的核心能力不能定义成“用户可以按性别、身高、技能筛人”。

这是功能，不是能力，也很容易被其他平台复制。

Proxy 真正需要建立的核心能力是：

> **把一个现实世界任务，转换成“这个任务需要什么样的人”的结构化需求；在合规和隐私约束下找到合适的真人；再用真实履约结果反向证明哪些属性真的影响任务成功。**

内部可定义为：

**Task-conditioned Human Matching（任务条件化真人匹配）**。

其完整闭环为：

```text
现实任务
→ Task Need Profile（任务需要什么）
→ Candidate Eligibility（谁有资格进入候选池）
→ Match Ranking（谁更适合）
→ Progressive Disclosure（该展示多少个人信息）
→ Selection / Acceptance（双方选择）
→ Real-world Execution（线下执行）
→ Evidence / Outcome（真实结果）
→ Match Learning（哪些条件真正有效）
→ 下一次匹配更准
```

### 31.2 Proxy 的五层核心能力

#### Layer 1：Task Schema

不是让 Requester 直接“搜人”，而是先表达任务：

- 要做什么；
- 什么时间；
- 什么地点；
- 需要什么能力；
- 哪些条件是必须；
- 哪些条件只是偏好；
- 为什么某个敏感属性与任务有关；
- 最终交付物是什么。

这一步把模糊需求变成结构化的 **Task Need Profile**。

#### Layer 2：Agent Capability Passport

AgentProfile 不只是“个人资料页”，而应逐步演化成一个可参与匹配的 **Capability Passport（能力护照）**：

- 可验证身份；
- 当前所在区域；
- 可用时间；
- 语言；
- 技能；
- 已验证能力；
- 场景履约记录；
- 可靠性；
- 接单偏好；
- 信息可见性偏好。

重点不是“这个人长什么样”，而是“这个人在哪些任务条件下可靠”。

#### Layer 3：Eligibility + Matching

系统先判断：

> **这个 Agent 是否有资格被这个 Task 看见？**

再判断：

> **在合格候选人中，谁更值得优先推荐？**

必须把 Eligibility 与 Ranking 分开。

敏感属性原则上只能进入 Eligibility，不应该形成“越符合越高分”的外貌竞赛式排序。

#### Layer 4：Trust & Visibility

不是所有 Requester 都有权看到所有 Agent 信息。

候选信息的可见范围由以下因素共同决定：

- 是否已经登录；
- Requester 是否实名认证；
- 是否有真实 Task；
- Task 是否通过审核；
- 是否已锁定资金/建立交易承诺；
- Requester 历史信誉；
- Agent 自己的隐私设置。

**谁能看见谁，本身就是 Proxy 核心能力的一部分。**

#### Layer 5：Outcome Graph

Proxy 最有价值的数据不是：

> “平台有 10 万个用户填写了身高和语言。”

而是：

> “什么任务，在什么时间地点，用什么条件匹配了什么 Agent，最终是否成功、是否准时、是否满意、是否复购。”

形成：

```text
Task × Requirement × Agent × Context × Outcome
```

的 **Match Outcome Graph（匹配结果图谱）**。

这是后续推荐、定价、供给运营和场景扩张真正可以积累的长期资产。

---

## 32. 如何把核心能力放大

### 32.1 从“Browse People”改成“Describe Task First”

Proxy 第一原则：

> **任务先于人。**

不提供类似社交/陪玩产品的“首页无限刷人”。

Requester 主入口应该是：

```text
你需要一个人替你完成什么？
```

而不是：

```text
看看附近有哪些人。
```

首页可以展示：

- 可完成的任务场景；
- 当前区域供给数量；
- 平均响应时间；
- 成交案例；
- 推荐任务模板；

但不直接展示大量个人头像瀑布流。

### 32.2 将筛选器升级为 Task Need Builder

不要让用户直接面对几十个筛选标签。

例如活动任务：

```text
你需要他/她做什么？
→ 接待来宾
→ 主持
→ 英语沟通
→ 拍摄
→ 出镜
```

系统再自动生成：

```text
Must have
- 可用时间 18:00–21:00
- 距离 < 8km
- English

Nice to have
- 有活动经验
- 主持能力
```

只有当任务角色合理需要时，才开放敏感属性。

### 32.3 每个候选必须回答“为什么是这个人”

候选卡片不能只展示头像、年龄、价格。

应优先展示：

> **匹配原因**

例如：

- ✓ 周六 18:00–21:00 可用
- ✓ 距活动 3.2km
- ✓ English verified
- ✓ 完成过 7 次活动类任务
- ✓ 近 10 单准时率 100%

这样用户心智会从“挑人”逐渐转向“挑匹配结果”。

### 32.4 建立“角色模板”而不是“人群标签”

可以逐渐沉淀：

- Queue Proxy；
- Bilingual Greeter；
- Event Host；
- Photographer Assistant；
- Local Guide；

角色模板本质上是一组：

```text
Task requirements + Evidence requirements + Suggested skills
```

而不是“年轻女生”“高个男生”等人群标签。

### 32.5 复购时优先复用“可靠的人”

Proxy 不应该让每次交易都重新搜人。

任务完成后，Requester 可以：

- 再次邀请；
- 加入“Trusted Proxies”；
- 为某个任务模板建立常用人选池。

这会把一次匹配升级成长期交易关系，同时减少下一次搜索成本。

### 32.6 Agent 端做反向匹配

Agent 不需要刷海量任务。

系统应该告诉他：

> “为什么这个任务适合你。”

例如：

- 距离近；
- 时间不冲突；
- 英语能力符合；
- 你的历史活动履约表现高；
- 报酬符合你的最低报价。

最终形成双向：

```text
Requester → 找对的人
Agent → 找适合自己的任务
```

### 32.7 用真实结果训练“什么条件有用”

长期不能假设所有属性都有价值。

系统应记录：

- 某属性是否被选中；
- 是否最终成交；
- 是否完成；
- 满意度；
- 取消/纠纷；
- 是否再次邀请。

如果某个属性长期与成功结果无明显关系，应降低其产品权重，甚至从场景筛选器移除。

这使 Proxy 的结构化标签体系不是越做越多，而是越做越有效。

---

## 33. 防偷窥 / 防逛人产品原则

### 33.1 定义“偷窥”

Proxy 需要防的不是正常的候选比较，而是：

- 没有真实任务，仅浏览大量 Agent；
- 高频查看照片但不形成任务；
- 反复使用性别/身高/风格组合进行猎艳式搜索；
- 批量保存、抓取、下载 Agent 信息；
- 通过虚假 Task 解锁个人资料；
- 把 Proxy 当“找人/看人/约人”产品使用。

产品内部统一称为：

**Non-transactional People Browsing（非交易目的个人浏览）**。

### 33.2 第一原则：No Task, No People Search

没有 Task Context 时，不允许进入完整 Agent 搜索。

未创建任务的用户只能看到：

- 某区域有多少可用 Agent；
- 能力分布；
- 平均价格；
- 平均响应时间；
- 示例卡片/脱敏案例。

不能自由浏览真实 Agent 列表。

### 33.3 第二原则：Progressive Disclosure

个人信息不是一次全部打开，而是随着真实交易意图逐渐解锁。

#### Visibility L0 — Public

未登录/未认证：

可见：

- 场景；
- 供给数量；
- 聚合统计；
- 脱敏示例。

不可见：

- 真实 Agent 列表；
- 个人头像；
- 精确资料。

#### Visibility L1 — Verified Requester

Requester 已登录/完成基础认证，但没有真实 Task：

可见：

- 聚合供给；
- 能力覆盖情况；
- 价格区间。

仍不可无限浏览个人档案。

#### Visibility L2 — Valid Task

已经创建字段完整、逻辑合理的 Task：

可见有限候选卡片：

- 昵称/名字首字母；
- 粗粒度区域；
- 与任务有关的技能；
- 完成单量；
- 匹配理由；
- Agent 自愿公开的基础头像状态。

不展示：

- 手机；
- 社交账号；
- 精确住址；
- 与当前 Task 无关的敏感信息。

#### Visibility L3 — Reviewed / Secured Task

Task 已通过必要审核，并产生真实交易承诺（例如支付授权/资金锁定）：

可以解锁：

- 完整候选卡片；
- 与任务有关的认证资料；
- 相关作品集；
- 更多历史履约信息。

仍不展示私人联系方式。

#### Visibility L4 — Matched

双方正式形成 Order 后：

解锁：

- 平台聊天；
- 任务执行需要的信息；
- 必要情况下的联系能力。

#### Visibility L5 — Execution Window

仅在任务执行时间窗内，根据任务需要临时开启：

- 精细定位；
- 实时位置共享；
- 紧急联系方式。

任务结束后自动回收。

### 33.4 第三原则：只暴露“当前任务需要的信息”

系统必须做 **Purpose-bound Disclosure（按用途披露）**。

例如：

如果 Task 只是代排队，则候选卡不应该因为 Agent 档案里有身高而展示身高。

如果活动需要 English，则展示：

> English — Verified

而不是顺带把所有职业、照片、风格标签全部展示出来。

### 33.5 第四原则：不给无限候选池

不使用无限瀑布流。

每次生成一个 **Qualified Candidate Set**，例如 12–20 人。

如果用户仍未找到：

- 修改任务条件；
- 扩大范围；
- 提高预算；
- 获取下一批候选。

而不是一直向下刷几百个人。

这不仅保护隐私，也会让产品更像“匹配工具”，而不是“人类目录”。

### 33.6 第五原则：Agent 控制自己的可见性

AgentProfile 增加：

```text
visibility_mode
```

建议支持：

- MATCHED_TASK_ONLY：仅匹配到合适任务时展示；
- VERIFIED_REQUESTER_ONLY：只对已认证发布方展示；
- BUSINESS_ONLY：只接受认证商家主动邀请；
- PAUSED：暂时不出现在任何候选池。

并允许 Agent 分字段控制：

- 头像；
- 身高；
- 作品集；
- 职业背景；
- 视频/音频样本。

### 33.7 第六原则：阻止批量采集

技术和产品同时限制：

- Candidate API 必须带 `task_id`；
- 服务端校验该 Task 是否属于当前 Requester；
- 返回字段依据 `visibility_level` 动态裁剪；
- 候选结果使用短期访问凭证；
- 限制异常高频 profile view；
- 限制同一账号/设备批量翻页；
- 检测连续敏感属性组合搜索；
- 防止原图 URL 长期公开；
- 作品素材使用短期签名 URL；
- 不允许搜索引擎索引个人档案页。

注意：

**无法真正阻止用户用另一台手机拍屏幕，因此“防截图”不能成为主方案。**

核心应是：让不该看到的人从一开始就拿不到信息，并让异常访问可被记录、限制和追责。

### 33.8 第七原则：偷窥风险影响 Requester 权限

建立 Requester Trust Tier：

```text
R0  未认证
R1  实名认证
R2  有成功履约
R3  高信誉个人/认证商家
R-X 风险受限
```

风险信号例如：

- 大量看候选但长期不发布/不成交；
- 高频建立又取消 Task；
- 重复用敏感属性缩小候选；
- 高频打开作品集；
- 多次被 Agent 举报；
- 多设备异常抓取行为。

被判为 R-X 后，可以：

- 关闭敏感属性筛选；
- 仅显示匿名候选卡；
- 要求人工审核 Task；
- 限制候选批次数；
- 暂停账号。

---

## 34. Candidate Visibility 状态机

候选可见性必须由后端统一控制，而不是前端“隐藏一下”。

```text
NO_CONTEXT
  ↓ create valid task
TASK_CONTEXT
  ↓ requester verified
TASK_VERIFIED
  ↓ task approved / payment secured when required
COMMITTED
  ↓ agent selected / accepts
MATCHED
  ↓ execution starts
EXECUTION_ACCESS
  ↓ task ends
CLOSED
```

对应后端输出：

```text
visibility_level = 0..5
```

任何 Agent Profile API 都必须同时检查：

```text
viewer_id
requester_trust_tier
task_id
task_scene
candidate_id
eligibility_result
visibility_level
agent_visibility_policy
```

没有合法 Task Context，不返回个人级结果。

---

## 35. 新增核心数据对象

### 35.1 TaskNeedProfile

```text
task_id
scene_id
must_have[]
nice_to_have[]
required_certifications[]
sensitive_requirements[]
sensitive_reason_codes[]
availability_window
location_constraint
budget_constraint
evidence_requirements[]
```

### 35.2 MatchCandidate

```text
task_id
agent_id
eligibility_status
match_reasons[]
exclusion_reasons[]
rank_score
visibility_level
risk_flags[]
shown_at
clicked_at
selected_at
```

### 35.3 AgentVisibilityPolicy

```text
agent_id
visibility_mode
photo_visibility
portfolio_visibility
sensitive_field_visibility
business_only
paused_until
```

### 35.4 ProfileExposureEvent

所有个人级曝光都记录：

```text
viewer_id
task_id
agent_id
visibility_level
fields_exposed[]
source
viewed_at
session_id
device_id
```

该事件用于：

- 防批量采集；
- 防偷窥风控；
- 隐私审计；
- 推荐效果分析。

---

## 36. 核心能力指标

### 36.1 不再只看“属性筛选使用率”

真正需要验证的是匹配能力是否创造了增量价值。

建议增加北极星辅助指标：

### Qualified Match Rate（QMR）

```text
形成有效候选集的已支付任务 / 已支付任务
```

有效候选集定义：

- 至少 X 个符合硬条件的 Agent；
- 至少 1 个最终愿意接受任务。

### Time to Qualified Match（TQM）

从 Task 发布到出现首个合格且可接单 Agent 的时间。

### Match Quality Lift（MQL）

比较：

```text
结构化匹配任务的完成率/满意度/复购
vs
仅基础距离+价格任务
```

目标是证明：Proxy 的匹配逻辑产生正向提升。

### Cross-scene Reuse Rate

同一 Agent 在不同场景成功履约的比例。

用于验证平台是否真的具有“泛场景真人代理”网络效应。

### 36.2 防偷窥指标

新增：

- Non-task Individual Exposure Rate：无有效 Task Context 的个人级曝光率，目标 = 0；
- Profiles Viewed per Completed Order：每个成功订单平均暴露多少个 Agent；
- Sensitive-filter Abuse Rate；
- Suspicious Browsing Session Rate；
- Profile Scraping Block Count；
- Agent Privacy Complaint Rate；
- Risk-restricted Requester Rate。

**好的匹配系统不是让用户看更多人，而是用更少的个人曝光完成更高质量的交易。**

---

## 37. 对产品首页和主链的直接影响

### 37.1 Requester 首页

第一屏核心 CTA：

> **你需要一个人替你完成什么？**

下面展示任务场景，而不是 Agent 瀑布流。

第二屏展示：

- 当前城市可用 Proxy 数量；
- 平均响应时间；
- 已完成任务；
- 典型成功案例。

### 37.2 搜索页

页面标题不建议叫：

> 找人

建议叫：

> **为这个任务匹配 Proxy**

候选卡第一信息层级：

1. 为什么匹配；
2. 是否可用；
3. 距离；
4. 任务相关能力；
5. 履约表现；
6. 报价；
7. 最后才是个人视觉信息。

### 37.3 Agent Detail

页面不设计成社交主页。

信息结构：

```text
Why matched
→ Availability
→ Task-related capabilities
→ Verified information
→ Relevant experience
→ Reliability
→ Relevant portfolio
→ Limited profile information
→ Invite / Select CTA
```

不要出现：

- 粉丝数；
- 获赞数；
- 人气榜；
- 谁看过我；
- 附近的人；
- 类似的人无限推荐。

这些功能会把 Proxy 推向社交/陪伴产品心智。

---

## 38. v0.6 核心产品原则

从本版开始，Proxy 增加以下不可轻易推翻的产品原则：

1. **Task first, people second.**
2. **No Task, no people search.**
3. **Match reasons before personal appearance.**
4. **Only expose data required by the current task.**
5. **Sensitive attributes require task justification.**
6. **Agent controls visibility.**
7. **Candidate access is progressive, auditable and revocable.**
8. **Optimize for successful matches, not profile browsing time.**
9. **The moat is Task × Agent × Outcome data, not a large photo directory.**
10. **Every new feature must answer：它是在提高任务匹配效率，还是在鼓励用户逛人？如果是后者，默认不做。**

---

# v0.7 页面级拆解：Requester 核心匹配主链

> 本轮不改变 v0.6 的核心原则，而是把 `Task first → Qualified Candidate Set → Progressive Disclosure → 双向选择 → Order` 拆成可以直接进入低保真原型和前后端接口设计的页面级规格。

## 39. Requester 核心交互架构

### 39.1 主链

```text
P01 首页
→ P02 场景选择
→ P03 Task Need Builder
→ P04 Task Review / Commitment
→ P05 Matching
→ P06 Qualified Candidate Set
→ P07 Candidate Detail
→ P08 Invite / Select
→ P09 Agent Accept / Decline
→ P10 Match Confirmed
→ Order Detail
```

### 39.2 核心约束

- 不存在独立的“找人”入口；
- 不存在无 Task Context 的真实 Agent 列表；
- 候选集必须由 `task_id` 生成；
- 候选个人信息由 `visibility_level` 动态裁剪；
- 每一次候选曝光都记录 `ProfileExposureEvent`；
- Requester 只能围绕当前 Task 比较候选，不能把 Agent 收藏成无任务的人肉通讯录；
- “Trusted Proxies”只能来自已经成功履约的历史 Order。

### 39.3 页面设计目标

主链每一步只回答一个问题：

| 页面 | 用户要解决的问题 |
|---|---|
| 首页 | 我可以让 Proxy 帮我完成什么？ |
| 场景选择 | 这属于哪类任务？ |
| Task Need Builder | 这个任务具体需要什么？ |
| Review / Commitment | 需求是否清楚、预算是否成立、是否需要审核？ |
| Matching | 系统正在找怎样的人？ |
| Candidate Set | 哪几个人真正符合当前任务？ |
| Candidate Detail | 为什么这个人适合、我还需要知道什么？ |
| Invite / Select | 我愿意把这个具体任务发给谁？ |
| Agent Accept | 对方是否愿意接受当前任务？ |
| Match Confirmed | 双方是否已经形成正式履约关系？ |

---

## 40. P01 Requester 首页

### 40.1 页面目标

让用户以“任务”而不是“人”开始。

### 40.2 首屏结构

#### Hero

主文案：

> **你需要一个人替你完成什么？**

主 CTA：

> 发布一个任务

次 CTA：

> 看看 Proxy 能做什么

#### 快捷场景

MVP 只展示：

- 代排队；
- 活动陪同。

每个场景卡展示：

- 场景名称；
- 1 句任务解释；
- 预计响应时间区间；
- 参考价格区间；
- “开始发布”。

### 40.3 可展示的供给信息

允许展示聚合信息：

- 当前城市可用 Proxy 数；
- 本周完成任务数；
- 平均首次响应时间；
- 某类技能覆盖人数。

禁止展示：

- 附近 Agent 头像；
- 在线女生/男生；
- 新注册 Agent；
- 推荐的人；
- 热门 Agent；
- 个人排行榜。

### 40.4 登录前行为

未登录用户可以：

- 查看场景；
- 查看价格/供给聚合；
- 开始填写任务草稿。

当用户第一次需要：

- 保存 Task；
- 获得个人级候选；
- 邀请 Agent；

再要求登录。

这样避免过早登录阻断需求表达，同时确保个人级曝光前已建立身份。

### 40.5 验收标准

- 首页不存在跳转真实 Agent 列表的路径；
- 所有个人级匹配都必须经过创建 Task；
- 未登录状态不能请求 Candidate API。

---

## 41. P02 场景选择

### 41.1 页面目标

把模糊意图映射到平台可治理的 Task Schema。

### 41.2 交互

首版不做自由创建任意场景。

用户只能选择平台已配置 Scene：

```text
代排队
活动陪同
```

可保留：

> 没有适合的场景？告诉我们你的需求

但该入口只收集需求，不直接进入交易。

### 41.3 为什么不直接开放“其他”

因为任意文本场景会直接破坏：

- 属性治理；
- 交付物定义；
- 审核规则；
- 仲裁标准；
- Match Eligibility。

泛场景是架构能力，不等于首版允许无限场景。

---

## 42. P03 Task Need Builder

### 42.1 页面目标

把“我要找一个人”转换成 `TaskNeedProfile`。

### 42.2 Builder 分为 5 步

```text
Step 1 做什么
Step 2 什么时候 / 在哪里
Step 3 必须具备什么能力
Step 4 希望具备什么偏好
Step 5 如何证明完成
```

不要把几十个字段一次摊开。

### 42.3 Step 1：任务内容

#### 代排队

采集：

- 门店；
- 排什么；
- 需要排到什么状态；
- 交接方式。

#### 活动陪同

先选择角色：

- 接待；
- 主持；
- 活动协助；
- 嘉宾/氛围参与；
- 摄影协助。

角色选择影响后续字段和允许筛选属性。

### 42.4 Step 2：时间与地点

必须结构化：

- 地址；
- 开始时间；
- 最晚到场时间；
- 预计结束时间；
- 是否允许时间浮动；
- 搜索半径。

系统实时检查：

- 时间是否已经过去；
- 时间范围是否合法；
- 地点是否可定位；
- 当前供给是否极低。

### 42.5 Step 3：Must-have

Must-have 是进入候选池的硬门槛。

P0 允许：

- 可用时间；
- 地理范围；
- 实名；
- 语言；
- 技能；
- 场景允许的敏感属性。

UI 必须明确提示：

> 设为“必须”会减少可匹配人数。

每增加一个 Must-have，实时显示：

```text
预计可匹配供给：42 → 17
```

优先展示数量，不展示个人。

### 42.6 Step 4：Nice-to-have

Nice-to-have 不做硬过滤，只用于：

- Match Reason；
- P1 排序；
- 候选解释。

例如：

- 有活动经验；
- 有主持经验；
- 距离更近；
- 完成单量更多。

必须避免让用户把所有偏好都设为硬门槛。

### 42.7 敏感属性 Gate

当用户尝试添加性别/身高/风格：

先出现原因选择：

> 为什么当前任务需要这个条件？

只能选择平台预置 Reason Code。

通过后才展示对应控件。

系统记录：

```text
sensitive_requirement
reason_code
scene_id
requester_id
```

不允许在备注中补充“颜值”等绕过描述。

### 42.8 Step 5：Evidence Requirements

用户不是自由写“完成后给我证明”。

平台根据 Scene + Role 给默认交付物，用户在允许范围内调整。

例如活动接待：

- 到场 GPS；
- 开始打卡；
- 停留满约定时长；
- 2 张现场照片；
- 完成结束打卡。

### 42.9 Budget

预算不是一个孤立价格输入框。

系统应展示：

- Agent 预计报酬；
- 平台服务费；
- 总预算；
- 当前条件下的建议价格区间；
- 当前供给压力提示。

P0 建议价可以是运营配置区间，不需要动态算法。

### 42.10 Task Quality Score（内部）

建议增加非用户公开的 `task_quality_score`，判断 Task 是否已经足够进入 Matching。

维度：

- 场景明确；
- 时间明确；
- 地点明确；
- 交付物明确；
- 预算合理；
- 没有违规文本；
- 敏感条件理由合法。

低于阈值不能进入 Candidate Generation，而是返回具体缺项。

---

## 43. P04 Task Review / Commitment

### 43.1 页面目标

在系统暴露真实候选前，让 Requester 明确自己正在创建一个真实交易需求。

### 43.2 页面内容

按卡片总结：

```text
任务
时间
地点
Must-have
Nice-to-have
交付物
报酬
总预算
取消规则
```

敏感条件单独显示：

> 此任务包含受限匹配条件：English / 指定角色性别……

并显示原因。

### 43.3 CTA

普通任务：

> 确认并开始匹配

需要审核任务：

> 提交审核并开始匹配

根据支付实现，可在此阶段：

- 支付授权；或
- 锁定预算；或
- 进入支付后再匹配。

产品要求是：进入高可见性候选前必须形成真实 Commitment。

### 43.4 防虚假 Task

以下行为进入风险信号：

- 高频创建 Task 后立即取消；
- 每次只为解锁候选；
- Task 参数高度重复但无成交；
- 敏感条件频繁变化；
- 多次进入 Candidate Set 后不邀请任何人。

---

## 44. P05 Matching 状态页

### 44.1 页面目标

把“算法黑盒”变成可理解的任务匹配过程。

### 44.2 UI

显示：

> 正在为这个任务寻找合适的 Proxy

并展示系统正在检查的维度：

- 时间；
- 距离；
- 必要能力；
- 实名状态；
- 当前可接单状态。

不要展示：

- “正在筛选女生”；
- “正在筛选 170cm+”；

敏感条件只在 Task Review 中以合规理由呈现，不把其做成刺激性匹配动画。

### 44.3 Matching Result 状态

后端返回：

```text
MATCH_READY
MATCH_THIN
MATCH_EMPTY
TASK_REVIEW_REQUIRED
SUPPLY_TEMPORARILY_UNAVAILABLE
```

#### MATCH_READY

候选数量达到最低阈值。

#### MATCH_THIN

候选过少，但仍可展示，同时建议放宽一个 Nice-to-have/非关键 Must-have。

#### MATCH_EMPTY

不展示空白页，返回条件瓶颈：

> 当前时间范围内有 18 位可用 Proxy，但“English + 主持经验”组合暂时无人同时满足。

然后提供可控放宽：

- 保留 English，取消主持经验；
- 扩大距离；
- 调整时间；
- 提高报酬；
- 开放报名。

---

## 45. P06 Qualified Candidate Set

### 45.1 页面定位

这是“当前任务的合格候选集”，不是 Agent Marketplace。

页面标题：

> **适合这个任务的 Proxy**

副标题：

> 根据你设置的时间、地点和任务要求生成

### 45.2 初始候选数量

MVP 建议：

- 初始展示最多 8 人；
- 可请求“换一批”；
- 每个 Task 默认最多 3 批；
- 每批最多 8 人；
- 同一 Agent 不重复；
- 达到上限后要求修改 Task 条件，而不是无限刷。

具体阈值应做运营配置，不写死在客户端。

### 45.3 Candidate Card 信息层级

卡片必须按以下优先级：

#### 1. Match Reasons

例如：

- 时间完全匹配；
- 距离 2.8 km；
- English 已认证；
- 完成过 6 次活动任务。

#### 2. Availability

- 可接单；
- 最早预计到达时间。

#### 3. Reliability

P0：

- 已完成 X 单；
- 实名认证。

P1：

- 准时率；
- 履约分；
- 取消率。

#### 4. Task-related Capability

只显示当前 Task 用到的能力。

#### 5. Price

显示：

- 当前任务预计报酬；
- 是否在用户预算内。

#### 6. Personal Identity

最后才展示：

- 头像；
- 昵称；
- 必要的场景相关信息。

### 45.4 头像规则

头像是身份信任信息，不是主要排序元素。

建议：

- L2 候选卡可展示小尺寸头像；
- 未产生 Commitment 时不展示大图；
- 头像不支持点击直接放大；
- 原图不以永久公开 URL 返回；
- Candidate Card 不做以大头像为主体的 Tinder/陪玩式卡片。

### 45.5 可执行操作

每张卡只允许：

- 查看为什么匹配；
- 查看详情；
- 邀请/选择。

不提供：

- 点赞；
- 关注；
- 私信；
- 加好友；
- 收藏陌生 Agent；
- 分享 Agent Profile；
- 查看相似的人。

### 45.6 Shortlist

允许 `Shortlist`，但必须严格绑定 `task_id`。

建议最多 3–5 人。

Task 结束后自动失效。

它不是跨任务收藏夹。

### 45.7 Compare

如需要比较功能，只比较任务相关维度：

| 维度 | Agent A | Agent B | Agent C |
|---|---|---|---|
| 时间 | ✓ | ✓ | ✓ |
| 距离 | 2.8 km | 4.1 km | 1.9 km |
| English | Verified | Self-declared | Verified |
| 活动经验 | 6 单 | 12 单 | 3 单 |
| 报酬 | ... | ... | ... |

不做外貌并排比较。

---

## 46. P07 Candidate Detail

### 46.1 页面目标

回答：

> 这个人为什么值得我把“当前任务”交给他？

不是让用户认识这个人的完整私人生活。

### 46.2 页面结构

```text
A. Why matched
B. 当前任务可用性
C. 当前任务相关能力
D. 认证状态
E. 相关场景履约记录
F. Reliability
G. 当前任务相关作品/证据
H. 有限基础个人信息
I. Invite / Select CTA
```

### 46.3 Why Matched

必须固定在首屏。

系统明确展示：

- 满足了哪些 Must-have；
- 满足了哪些 Nice-to-have；
- 哪些能力经过认证；
- 哪些只是自主填写。

### 46.4 隐藏无关字段

如果当前任务不需要：

- 身高；
- 风格；
- 职业背景；

则即使 AgentProfile 中存在，也不返回给当前 Requester。

这是后端字段裁剪，不是前端 CSS 隐藏。

### 46.5 Portfolio

P1 才开放完整作品集。

且必须：

- 与当前场景相关；
- Agent 已授权该层级可见；
- 使用短期签名 URL；
- 不提供原文件批量下载。

### 46.6 Contact

Candidate Detail 永远不显示：

- 手机号；
- Facebook/Zalo/Instagram；
- 个人邮箱；
- 精确住址。

直到形成 Order，也优先使用平台聊天而非开放私联。

### 46.7 Profile Exposure

进入详情页时必须写：

```text
ProfileExposureEvent
```

至少记录：

- viewer；
- task；
- candidate；
- visibility level；
- exposed fields；
- timestamp；
- session/device。

---

## 47. P08 Invite / Select

### 47.1 关键原则：不是单方面买下这个人

Requester 点击候选后，不应直接形成 Order。

需要双向确认：

```text
Requester Invite
→ Agent Review Task
→ Agent Accept
→ Order Created / Slot Assigned
```

### 47.2 Invite 确认页

Requester 再次看到：

- 任务；
- 时间；
- 地点；
- 报酬；
- 交付物；
- 取消规则；
- 邀请对象。

CTA：

> 发送任务邀请

### 47.3 邀请策略

#### 单人任务

P0 建议允许同时邀请有限数量候选，例如 1–3 人。

一旦某人接受并确认：

- Slot 锁定；
- 其他未接受邀请自动失效。

这样避免一人不回应导致长时间卡死，又避免向几十个人群发。

#### 多人任务

每个 Slot 独立发出 Invite / Application Accept。

### 47.4 Agent 看到什么

Agent 只看到完成任务需要的信息：

- Requester 基础可信状态；
- 商家认证状态；
- Task；
- 时间地点；
- 交付物；
- 报酬；
- 取消规则。

Agent 不看到：

- Requester 搜过多少人；
- 其他候选是谁；
- 敏感属性排序；
- 自己在候选中的排名。

---

## 48. P09 Agent Accept / Decline

### 48.1 Accept 前确认

Agent 必须确认：

- 时间无冲突；
- 能按要求到场；
- 理解交付物；
- 接受报酬；
- 接受取消规则。

### 48.2 Decline Reason

可选结构化原因：

- 时间不合适；
- 距离太远；
- 报酬不合适；
- 任务要求不合适；
- 不希望接受该类型任务；
- 其他。

这些数据用于供给和匹配优化，但不惩罚正常拒单。

### 48.3 Invitation Expiry

邀请应有过期时间。

即时任务可更短；预约任务可更长。

阈值由 Scene/时间紧迫度配置。

过期后不再占用候选关系。

---

## 49. P10 Match Confirmed

### 49.1 成功状态

双方确认后：

```text
TaskSlot = ASSIGNED
Order = CONFIRMED
CandidateRelation = MATCHED
Visibility = L4
```

### 49.2 新解锁能力

可以开放：

- 平台聊天；
- 更精确的集合点信息；
- 执行前确认；
- 必要的任务联系人。

### 49.3 仍然不能开放

- Agent 私人社交账号；
- 无任务关系的个人联系方式；
- 与执行无关的精确信息。

---

## 50. Candidate Access Contract

所有个人级候选接口必须遵守统一后端 Contract。

### 50.1 Candidate List Request

至少需要：

```text
viewer_id
requester_id
task_id
candidate_batch_token
```

服务端自行读取：

```text
requester_trust_tier
task_scene
task_status
task_need_profile
payment_commitment
risk_state
```

### 50.2 Candidate Detail Request

必须校验：

```text
candidate ∈ current qualified candidate set
```

不能仅凭 `agent_id` 查询任意 Agent Detail。

### 50.3 Response Field Policy

后端先计算：

```text
visibility_level
purpose_allowed_fields[]
agent_allowed_fields[]
risk_restricted_fields[]
```

最终：

```text
fields_exposed =
purpose_allowed
∩ agent_allowed
- risk_restricted
```

### 50.4 Candidate Batch Token

建议候选集返回短期 `candidate_batch_token`：

- 与 task 绑定；
- 与 requester 绑定；
- 有过期时间；
- 不能跨 Task 重放；
- 超过候选批次数后失效。

目的不是密码学创新，而是阻止前端被简单改造后无限枚举 `agent_id`。

---

## 51. Anti-browsing / Anti-scraping 规则拆解

### 51.1 产品层

- 无 Task 无真人列表；
- 有限候选批次；
- Shortlist 绑定 Task；
- 无陌生人永久收藏；
- 无无限推荐；
- 无分享 Profile；
- 无排行榜；
- 无 profile follower 模型。

### 51.2 API 层

- Candidate API 必须有 task context；
- Candidate Detail 只能访问当前候选集；
- 素材短期 URL；
- 字段级权限；
- 请求频控；
- 批次 token；
- 设备/会话审计。

### 51.3 Risk Signals

至少采集：

```text
candidate_list_requests_per_task
candidate_detail_views_per_task
portfolio_views_per_task
candidate_batch_count
invite_rate_after_view
transaction_rate_after_view
sensitive_filter_change_count
task_create_cancel_rate
unique_agents_viewed_7d
unique_agents_viewed_30d
device_account_fanout
```

### 51.4 初版风险规则

P0 不必做复杂模型，可以从规则开始。

例如出现组合信号：

- 7 天浏览大量独立 Agent；
- 成交率接近 0；
- 高频使用敏感属性；
- 高频创建/取消 Task；

则进入风险限制。

不要仅因“看了 10 个候选”就处罚，因为正常交易本身需要比较。

### 51.5 风险限制阶梯

```text
NORMAL
→ FRICTION_ADDED
→ SENSITIVE_FILTER_RESTRICTED
→ ANONYMIZED_RESULTS
→ MANUAL_REVIEW_REQUIRED
→ TEMPORARILY_SUSPENDED
```

每一步应可审计、可解除。

---

## 52. Requester Trust Tier 对功能的影响

| 能力 | R0 未认证 | R1 实名 | R2 有成功履约 | R3 高信誉/商家 | R-X 风险 |
|---|---:|---:|---:|---:|---:|
| 创建 Task | 有限 | 是 | 是 | 是 | 受限 |
| 查看聚合供给 | 是 | 是 | 是 | 是 | 是 |
| 获取个人候选 | 否 | 是 | 是 | 是 | 匿名/受限 |
| 敏感条件 | 否 | 审核 | 审核/策略放宽 | 商家规则 | 禁止 |
| Portfolio | 否 | 高承诺后 | 是 | 是 | 否 |
| 多批候选 | 否 | 有限 | 正常 | 正常 | 受限 |
| 主动邀请 | 否 | 是 | 是 | 是 | 可能人工审核 |

具体阈值由运营策略控制。

---

## 53. 核心匹配数据闭环

每一次 Task 都必须形成一条可学习链路：

```text
TaskNeedProfile
→ Eligible Pool
→ Candidate Set
→ Exposure
→ Detail View
→ Shortlist
→ Invite
→ Accept / Decline
→ Order
→ Execution
→ Outcome
→ Rating / Rehire
```

### 53.1 为什么每一层都要记录

如果只记录最终订单，会不知道：

- 用户为什么没有选某些人；
- 某条件是不是把供给池卡死；
- 某属性到底促进成交还是仅促进点击；
- 某类候选是否“看起来吸引点击，但并不提高履约”；
- 哪些条件应该从 Must-have 降级为 Nice-to-have。

### 53.2 关键原则

**Proxy 不能优化 CTR 本身。**

个人头像点击率高，不代表这个属性对任务成功有价值。

优先优化：

- Qualified Match Rate；
- Invite → Accept；
- Accept → Completed；
- Completed → Rehire；
- Match Quality Lift；
- Exposure Efficiency。

### 53.3 Exposure Efficiency

新增指标：

```text
Exposure Efficiency =
成功形成 Order 的 Task 数 / 个人 Profile Exposure 总量
```

或反向观察：

```text
Profiles Exposed per Successful Order
```

目标不是让用户多看，而是在保障选择权的情况下，用更少曝光完成交易。

---

## 54. 页面级埋点

### P01 首页

- scene_card_view
- scene_card_click
- create_task_start

### P03 Task Need Builder

- task_field_completed
- must_have_added
- must_have_removed
- nice_to_have_added
- sensitive_requirement_attempted
- sensitive_reason_selected
- estimated_supply_changed

### P06 Candidate Set

- candidate_set_generated
- candidate_card_exposed
- candidate_detail_opened
- candidate_shortlisted
- candidate_batch_requested

### P07 Candidate Detail

- field_group_exposed
- portfolio_opened
- invite_clicked

### P08/P09 双向确认

- invite_sent
- invite_expired
- invite_accepted
- invite_declined
- decline_reason

### P10 Match Confirmed

- order_created
- matched_visibility_unlocked

---

## 55. 页面级 Acceptance Criteria

### AC-09 No Task, No People Search

- 未提供有效 `task_id` 时 Candidate API 不返回真实 Agent；
- 首页不存在真实 Agent Feed；
- 搜索引擎不能索引 Agent Detail。

### AC-10 Task Need Builder

- Must-have 与 Nice-to-have 明确区分；
- 敏感条件必须先选择合法 reason code；
- Builder 可以反馈预计供给数量变化；
- Task 缺少必要交付物不能进入匹配。

### AC-11 Candidate Set

- 候选只来自当前 Task 的 Eligibility 结果；
- 首批候选有上限；
- 不支持无限滚动；
- Shortlist 与 Task 绑定并在 Task 终止后失效。

### AC-12 Candidate Card

- Match Reasons 位于头像/个人信息之前；
- 不展示与当前 Task 无关的敏感字段；
- 不出现点赞、关注、粉丝、人气榜、类似的人。

### AC-13 Candidate Detail

- 仅当前 Candidate Set 中的 Agent 可访问；
- 返回字段由后端按 purpose + Agent policy + risk policy 裁剪；
- 访问产生 ProfileExposureEvent。

### AC-14 Invite

- 单人 Task 同时邀请数有限；
- 一人 Accept 后其他并发邀请失效；
- 未形成双方确认前不得创建 CONFIRMED Order。

### AC-15 Privacy

- 订单前不展示手机号/社交账号/精确地址；
- Portfolio 仅在允许层级访问；
- 素材 URL 非永久公开地址。

### AC-16 Abuse Control

- 风险 Requester 可被限制敏感筛选；
- 可限制候选批次；
- 风险状态可由运营后台查看；
- 限制行为有审计记录。

---

## 56. 这套主链的产品护城河如何形成

### 第 1 阶段：Schema

别人可以复制 UI，但 Proxy 先积累：

```text
不同任务到底需要哪些条件
```

### 第 2 阶段：Eligibility

积累：

```text
哪些 Agent 在哪些上下文中真正可履约
```

### 第 3 阶段：Selection

积累：

```text
Requester 在候选集中为什么邀请 / 不邀请
```

### 第 4 阶段：Outcome

积累：

```text
谁最终完成、取消、迟到、复购、被再次邀请
```

### 第 5 阶段：Network

形成：

```text
Requester ↔ Trusted Proxy ↔ Scene Capability ↔ Outcome
```

最终 Proxy 的资产不再是“很多人填了标签”，而是：

> **我们比别人更清楚：在一个具体真实世界任务中，什么样的人会成功完成，而且能用最少的个人曝光把双方撮合起来。**

---

## 57. 下一轮应该继续拆什么

优先级建议：

### A. Agent 端主链（下一轮优先）

```text
Agent Onboarding
→ Capability Passport
→ Availability
→ Task Match Feed
→ Task Detail
→ Accept / Apply
→ Execution Mode
→ Evidence Submission
→ Earnings / Reputation
```

重点解决：

- Agent 为什么愿意填结构化档案；
- 如何避免 Agent 端变成刷任务市场；
- 怎样让 Agent 知道“为什么这单适合我”；
- 隐私设置如何自然嵌入建档；
- 什么数据可以逐步形成 Capability Passport。

### B. Matching Engine Contract

进一步把：

```text
TaskNeedProfile
AgentCapabilityPassport
EligibilityResult
MatchReason
RankingResult
VisibilityDecision
```

拆到字段、输入输出和规则优先级。

### C. Operator 风控/审核后台

把敏感 Task、Profile Exposure、Requester Risk、Dispute Timeline 做成后台操作流。


---

# v0.8 产品端供需匹配与双边留存系统

> 本轮目标：把 Proxy 从“单次匹配产品”升级为“有流动性管理能力的双边 Marketplace”。
>
> 核心问题不再是平台注册了多少 Requester / Agent，而是：在一个具体的 **区域 × 时间 × 场景/角色** 中，是否有足够真实可用供给，在需求仍愿意等待的时间内完成高质量交易。

## 58. Marketplace 的核心运营单位：Liquidity Cell

Proxy 不以“全平台注册人数”判断供需健康，而使用：

```text
Liquidity Cell = Geo Zone × Time Window × Role / Task Template
```

例如：

```text
Tây Hồ × 周六 18:00–22:00 × Bilingual Greeter
Hoàn Kiếm × 周日上午 × Queue Proxy
```

### 58.1 每个 Cell 必须计算

- Active Supply：当前时窗真实可接单 Agent 数；
- Supply Capacity：Agent 在该时窗可承接的剩余 Slot；
- Open Demand：尚未满足的任务/Slot；
- Qualified Supply：满足当前需求硬条件的 Agent 数；
- Fill Rate：最终成功填满的 Slot 比例；
- Time to Qualified Match；
- Agent Utilization：已成交可用 Slot / 总可用 Slot；
- Demand Abandonment：发布后取消/放弃的需求；
- Supply Idle Rate：明确上线但长期收不到合适任务的 Agent 比例。

关键原则：

> **100 个注册 Agent 不等于 100 个供给。**
>
> 周六晚上真正可用、在附近、愿意接当前任务且满足条件的人，才是有效供给。

---

## 59. 供需匹配不只做“Ranking”，而做 Match Orchestration

匹配引擎必须同时解决：

1. 谁符合；
2. 先把任务给谁；
3. 给多少人；
4. 等多久；
5. 无人响应后怎么扩；
6. 如何避免同一批头部 Agent 吃掉全部订单；
7. 如何在匹配效率和隐私曝光之间取得平衡。

### 59.1 两种主匹配模式

#### Mode A — Fast Match

适用：

- 代排队；
- 属性要求弱；
- 强时间约束；
- Requester 更关心“快点有人接”。

流程：

```text
Task Qualified
→ 系统生成 Rank 1–N 合格 Agent
→ 小批量定向推送
→ 第一位合格 Agent Accept
→ Slot Lock
→ Order
```

Requester 不需要浏览大量 Agent。

前台文案应是：

> 正在为你找一位符合条件、能准时到达的 Proxy。

#### Mode B — Curated Match

适用：

- 活动陪同；
- 主持/语言/角色匹配；
- Requester 对具体能力有明显选择需求。

流程：

```text
Task Qualified
→ Qualified Candidate Set
→ Requester 查看少量候选
→ Invite
→ Agent Accept
→ Order
```

仍遵循 Candidate Exposure 上限和 Progressive Disclosure。

### 59.2 Open Apply 只作为 fallback

“任务大厅公开抢单”不能成为核心默认机制。

只有：

- 定向匹配无人响应；
- 供给密度不足；
- Requester 明确允许；

才进入 Open Apply。

否则 Proxy 会退化成普通兼职/跑腿任务市场。

---

## 60. Match Escalation Ladder

每个 Task 都走有限升级流程：

```text
L0 Exact Match
→ L1 Expand Candidate Batch
→ L2 Relax Nice-to-have
→ L3 Expand Distance / Time Flex
→ L4 Raise Reward Recommendation
→ L5 Open Apply
→ L6 Operator Assist / Unfilled
```

系统不能无脑一次把任务广播给所有 Agent。

### 60.1 Requester 看到的是“解决方案”而不是“0 Results”

例如：

> 当前 3km 内只有 1 位符合全部条件的人。
>
> 扩到 6km：预计 7 位可匹配。
>
> 或保留 3km，将“活动经验”从必须改为偏好：预计 5 位可匹配。

这同时帮助平台完成需求塑形（Demand Shaping）。

---

## 61. 需求侧产品留存：降低下一次发布成本

Requester 留存不是靠 Feed，而是靠：

> **第二次用 Proxy 比第一次明显更省事、更稳。**

### 61.1 Saved Task Template

每个成功 Task 自动沉淀为模板，例如：

```text
Grand Opening Greeter
- 18:00–21:00
- English
- 现场接待
- GPS + 2 photos
- Budget 500k–700k
```

下一次：

> 再发一次类似任务

只修改时间、地点、人数即可。

### 61.2 Trusted Proxies

只有成功履约过的 Agent 才能进入 Trusted Proxies。

Requester 可：

- 优先邀请上次合作的人；
- 为某个 Task Template 建立常用 Proxy Pool；
- 当 Trusted Proxy 不可用时自动寻找“相似能力替补”。

### 61.3 Repeat / Recurring Task

P1 支持：

- Repeat once；
- 每周重复；
- 商家活动日程；
- 固定时间段预留需求。

重复任务不是直接绑定某一个人，而是：

```text
Task Template
→ Preferred Trusted Proxies
→ Replacement Candidate Pool
```

防止双方离开平台后整个交易链断掉。

### 61.4 Match Guarantee / Auto-rematch

一旦 Agent 接单后取消：

> Requester 不重新从头发布。

系统直接：

```text
原 Task / Slot
→ Replacement Match
→ 下一位 Qualified Agent
```

这是需求侧留存的重要价值：

> 用户购买的不只是“某一个 Agent”，而是 Proxy 帮我把这个 Slot 解决掉。

### 61.5 Business Workspace（P1/P2）

对商家逐步提供：

- 常用 Task Template；
- Trusted Proxy Pool；
- 历史活动；
- 月度预算；
- 多 Slot 状态；
- 发票/结算；
- 团队成员权限。

从“一次活动找人”升级到：

> **商家的弹性真人执行层。**

---

## 62. 供给侧产品留存：让 Agent 获得越来越可预测的好任务

Agent 留存不能依赖刷任务和抢单刺激。

长期价值必须是：

> **我的能力越清楚、履约越好，Proxy 越知道什么任务应该找我，我得到的任务越稳定、越合适。**

### 62.1 Agent Home 不做无限 Task Feed

首页重点展示：

```text
Your Availability
Matched for You
Repeat Invitations
Upcoming Orders
Earnings
Capability Progress
```

而不是 100 个无关任务列表。

### 62.2 Availability Calendar = 核心供给库存

Agent 主动声明：

- 哪天；
- 哪个时间段；
- 哪个区域；
- 可接受的任务角色；
- 最低报酬；
- 最大旅行距离。

例如：

```text
Saturday 17:00–22:00
Tây Hồ / Ba Đình
Event / Greeter / English
Min 500k
```

这是平台真正可以拿来匹配的“库存”。

### 62.3 Demand Pulse

Agent 不需要看到 Requester 个人或具体任务详情，也可以看到聚合需求：

> 本周六 Tây Hồ 活动类需求较高。
>
> 18:00–22:00 English Greeter 供给不足。

CTA：

> 将我设为该时段可用

目的：主动把供给激活到真正缺人的 Liquidity Cell。

### 62.4 Capability Compounding

每次完成任务后，Agent 的能力护照增加：

- 场景履约记录；
- Verified Experience；
- 准时率；
- Repeat Hire；
- 经验证技能；
- 可承担角色。

不是做等级游戏，而是让 Agent 明确知道：

> 什么真实行为会让我获得更适合、更高价值的任务。

### 62.5 Repeat Client / Trusted Relationship

Agent 可以看到：

- 某商家再次邀请你；
- 你有 X 个 Repeat Requester；
- X% 收入来自重复合作。

但不能看到自己在候选榜里排名第几。

### 62.6 新 Agent 首单机制

新 Agent 不能因为没有历史数据永远没有机会。

P0/P1 采用：

- 新人 Candidate Exposure 配额；
- 首单任务优先匹配低风险、交付物清晰的 Task；
- 完成首批任务后快速建立 Verified Experience。

不建议简单送钱买活跃，而是尽快让新人获得真实 Outcome Data。

---

## 63. Marketplace Balance：不能只追求“最佳人选”

如果每一单都永远推荐同样的 Top Agent，会出现：

- 头部过载；
- 新人永远冷启动失败；
- 大量 Agent 没单后离开；
- Requester 看到的候选池越来越单一；
- 平台供给逐渐塌缩。

所以排序分两步：

```text
Eligibility Gate
→ Marketplace-aware Ranking
```

Ranking 可逐步考虑：

- Task Fit；
- Acceptance Probability；
- Distance / ETA；
- Reliability；
- 当前负载；
- 最近曝光次数；
- 新 Agent 探索额度；
- 重复合作关系；
- Agent 自己的角色/收入偏好。

但任何平衡权重都不能突破 Task 的硬条件。

---

## 64. 供需两边的核心飞轮

### 64.1 Demand Flywheel

```text
清晰表达 Task
→ 快速得到 Qualified Match
→ 安全完成
→ Task Template 沉淀
→ Trusted Proxy 沉淀
→ 下次发布成本降低
→ Repeat / Recurring Demand
→ 更多 Outcome Data
→ 匹配更准
```

### 64.2 Supply Flywheel

```text
填写 Capability + Availability
→ 收到真正适合的任务
→ 成功履约
→ Verified Outcome 增加
→ 更容易进入高质量 Candidate Set
→ Repeat Invitation 增加
→ 收入更可预测
→ 更愿意持续声明 Availability
→ 有效供给增加
```

### 64.3 Marketplace Flywheel

```text
更多真实 Demand
→ 平台知道哪里缺 Supply
→ 定向激活正确 Agent
→ TQM 降低 / Fill Rate 上升
→ Requester 更愿意复用
→ Agent 得到更多真实订单
→ Availability 更稳定
→ Liquidity 更高
```

---

## 65. 产品端必须避免的错误留存方式

Proxy 不应该用以下机制制造“活跃”：

- 无限刷 Agent；
- 无限刷 Task；
- 颜值/人气榜；
- 无意义签到；
- 为浏览时长优化；
- 频繁骚扰式 Push；
- 付费提高敏感属性曝光；
- Agent 拼低价抢单；
- Requester 收藏大量未合作陌生 Agent。

Proxy 应优化：

> **更少浏览 → 更快形成匹配 → 更多真实履约 → 更多重复关系。**

---

## 66. 供需健康 Dashboard

运营后台必须按 Liquidity Cell 看，而不是只看 DAU。

### 66.1 Demand Metrics

- Tasks Created；
- Qualified Tasks；
- Paid / Committed Tasks；
- Fill Rate；
- TQM；
- Completion Rate；
- Repeat Task Rate；
- Repeat Requester Rate；
- Auto-rematch Success Rate；
- Demand Abandonment Rate。

### 66.2 Supply Metrics

- Weekly Active Available Agents；
- Declared Availability Hours；
- Qualified Supply per Cell；
- Acceptance Rate；
- Agent Utilization；
- Median Earnings per Available Hour；
- Time to First Order；
- 4-week Supply Retention；
- Repeat Invitation Share；
- Supply Idle Rate。

### 66.3 Matching Metrics

- Qualified Match Rate；
- Time to Qualified Match；
- Candidate Exposure per Successful Order；
- Invite → Accept Rate；
- Match → Completion Rate；
- Replacement Match Rate；
- Cross-scene Reuse Rate。

### 66.4 Marketplace Health

新增：

```text
Coverage Ratio = Qualified Supply Capacity / Open Demand Slots
```

不要追求无限高。

- 太低：需求无法成交；
- 太高：大量 Agent 长期没单并流失。

平台运营目标应该是让核心 Liquidity Cell 处于“有选择但不严重过剩”的健康区间。

---

## 67. 冷启动时的产品策略

### 67.1 不同时冷启动全城所有场景

按：

```text
一个区域
× 两个场景
× 几个核心时间窗
```

做密度。

### 67.2 先锁 Demand Anchor

比单纯招 1000 个 Agent 更重要的是先拿到可重复需求源，例如：

- 活动公司；
- 餐厅/商场开业；
- 展会/品牌活动；
- 高频排队地点附近用户群。

有稳定 Demand Anchor 后再按缺口定向招 Agent。

### 67.3 Agent 招募按“供给缺口”而不是按人数 KPI

例如后台发现：

```text
周五/周六 18:00–22:00
English Greeter
Tây Hồ
Coverage Ratio = 0.55
```

运营才定向补该类型供给。

而不是：

> 本月再拉 500 个兼职注册。

---

## 68. P0 / P1 产品优先级

### P0 必做

- Agent Availability；
- Fast Match / Curated Match 两种模式；
- 小批量定向匹配；
- Match Escalation；
- Task Template；
- Repeat Task；
- Trusted Proxy（仅成功订单产生）；
- Auto-rematch；
- Agent Match Feed；
- 基础供需 Dashboard；
- Time to First Order；
- Supply / Demand Cell 埋点。

### P1

- Recurring Task；
- Demand Pulse；
- Business Proxy Pool；
- Marketplace-aware Ranking；
- Availability Forecast；
- Agent 收益预测；
- 更自动化的新 Agent 探索机制；
- 商家 Workspace。

### P2

- 智能动态供给激励；
- 预测性预匹配；
- 企业容量预留；
- 城市间供给调度；
- 复杂动态价格。

---

## 69. 本轮最终产品原则

1. **供给不是注册 Agent，而是可用 Slot。**
2. **需求不是注册 Requester，而是真实 Qualified Task。**
3. **匹配不是搜索结果页，而是持续直到 Slot 被解决的 Orchestration。**
4. **需求留存靠 Template + Trusted Proxy + Guarantee，让下一次更省事。**
5. **供给留存靠更合适、更稳定、更可预测的任务，而不是让 Agent 刷任务。**
6. **平台扩张按 Liquidity Cell 密度扩，不按城市地图面积扩。**
7. **先做重复关系，再追求无限新增用户。**
8. **Marketplace 的长期资产是 Task × Agent × Outcome，而不是注册量。**

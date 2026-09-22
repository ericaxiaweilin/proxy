# Proxy PRD v1.1
## Chapter 22 — P0 Launch Catalog / Scenario & Role Template Pack

**文档类型**：首发目录 / 场景与 Role 模板包 / Catalog Configuration Contract  
**状态**：ACTIVE — Launch Catalog v1  
**前置依赖**：Canonical Registry、Chapter 07、Chapter 09、Chapter 11、Chapter 13、Chapter 20、Chapter 21  
**后续依赖**：Chapter 23 Policy Defaults、Chapter 24 Account / Privacy Lifecycle、Engineering API / Event Contract  

---

# 0. 本章目标

Chapter 21 定义了页面如何消费 Launch Catalog。本章把首发范围真正落成可配置目录：

```text
Market
→ Geo Cell
→ Industry
→ Scenario
→ Role
→ Atomic Capability
→ Requirement Template
→ Verification Requirement
→ Deliverable
→ Evidence Policy
→ Pricing Unit
→ Risk Class
→ Check-in Method
→ Location Type
→ Cancellation Policy
→ Matching Policy
```

本章的核心结果不是“列出很多行业”，而是形成一套能够直接驱动以下行为的配置：

- Task Builder 显示哪些行业、场景和 Role
- 一个 Task 如何生成多个原子 TaskSlot
- Agent 哪些 Capability 能满足 Must / Nice
- 哪些 Agent 可以进入 Qualified Pool
- 哪些任务需要额外 Verification 或 Task Admission
- 需要什么 Deliverable 和 Evidence
- 使用 Fixed 还是 Hourly 定价
- 允许什么地点、Check-in 和联系信息
- Matching、Cancellation、No-show 和 Safety 应绑定哪组 Policy
- 一个 Geo × Role × Time Cell 何时可以开放

本章不锁定：

- 具体首发城市 / Metro 名称
- 具体货币金额、Offer TTL、候选人数、No-show grace 等数值
- 具体支付、KYC、地图和媒体供应商
- 任何市场特定法律结论

这些内容由市场选择、Chapter 23 和 Provider / Legal Contract 进一步确定。

---

# 1. 首发产品结论

## 1.1 Generic Architecture，Narrow Launch

Proxy 的架构可以支持：

```text
多行业
多 Scenario
多 Role
多 Geo
```

首发只开放：

```text
1 个 Metro / dense corridor
1–2 个主要 Scenario Family
3–5 个真人 Role
有限的 Template
有限的 Venue Type
有限的时间 Cell
```

## 1.2 推荐首发 Scenario Family

首发目录锁定两类 Scenario Family：

```text
SCN_BUSINESS_EVENT_GRAND_OPENING
SCN_BUSINESS_ONSITE_SUPPORT
```

两类都以 Business-led demand 为主，同时允许少量低风险 Individual Requester Task，但不以 Individual 作为冷启动主供需。

## 1.3 推荐首发 Role 集合

目录支持五个 Launch Role：

```text
GREETER
EVENT_ASSISTANT
INTERPRETER
SITE_VISIT_REP
BUSINESS_ASSISTANT
```

单个首发 Cell 不要求五个 Role 同时开放。初始建议优先激活：

```text
GREETER
EVENT_ASSISTANT
INTERPRETER
```

随后根据真实供需、Operator 覆盖和安全结果，逐步开启：

```text
SITE_VISIT_REP
BUSINESS_ASSISTANT
```

## 1.4 推荐首发 Industry

目录预置以下 Industry：

| Industry ID | 名称 | 首发建议 | 说明 |
|---|---|---|---|
| `IND_FOOD_BEVERAGE` | Food & Beverage | ACTIVE CANDIDATE | 餐厅、咖啡店、门店开业与活动 |
| `IND_RETAIL` | Retail | ACTIVE CANDIDATE | 零售门店、促销、品牌活动 |
| `IND_EVENTS_EXHIBITIONS` | Events / Exhibitions | PILOT ONLY | 展会、展览、品牌活动，需更强 Operator 覆盖 |
| `IND_BUSINESS_SERVICES` | Business Services | PILOT ONLY | 商务拜访、会议和现场支持 |

`ACTIVE CANDIDATE` 不等于立即对公众开放。只有通过 Market、Geo、Role、Supply、Demand、Safety 和 Operator Gate 后，Catalog Activation 才能变成 `ACTIVE`。

## 1.5 P0 明确排除

以下类型不得通过 Chapter 22 的 P0 Catalog 激活：

```text
PRIVATE_RESIDENCE
HIGH_VALUE_GOODS_HANDLING
CASH_HANDLING
MEDICAL_ADVICE_OR_CARE
LEGAL_OR_REGULATED_ADVICE
SECURITY_OR_FORCE_SERVICE
IDENTITY_DOCUMENT_HANDLING
UNVERIFIED_ISOLATED_LOCATION
OVERNIGHT_UNSUPERVISED_TASK
TASK_REQUIRING_AGENT_TO_SIGN_BINDING_CONTRACT
```

如果未来要支持，必须新增 Scenario Policy、Risk Policy、Legal Review 和 Operator Runbook，不能仅在 Catalog 中把 `enabled = true`。

---

# 2. Catalog 分层模型

## 2.1 层级关系

```text
LaunchCatalogVersion
├── MarketDefinition
├── GeoCellDefinition[]
├── IndustryDefinition[]
├── ScenarioDefinition[]
├── RoleDefinition[]
├── CapabilityDefinition[]
├── RequirementTemplate[]
├── EvidenceTemplate[]
├── PolicyBinding[]
└── CatalogActivation[]
```

用户创建 Task 时的解析顺序：

```text
Catalog Activation
→ Industry
→ Scenario
→ Template
→ Role
→ Requirement Resolution
→ Policy Binding
→ Task / Slot Draft
```

## 2.2 Catalog 与 Marketplace Domain 的边界

Catalog 是配置和产品展示层，不能取代 Marketplace Domain：

```text
Catalog Role ≠ AgentRole
Catalog Template ≠ Task
Catalog Slot Default ≠ TaskSlot
Catalog Price Guidance ≠ CompensationTerms
Catalog Risk Class ≠ RiskDecision
Catalog Evidence Default ≠ Submitted Evidence
```

当用户真正创建 Task：

```text
Catalog Template
→ resolved Task Draft
→ Task / Slot / CompensationTerms / EvidencePolicy snapshot
```

交易创建后必须保存当时使用的：

```text
catalog_version
graph_version
policy_set_version
template_version
```

之后 Catalog 更新，不得静默修改已有 Task、Offer、Order 或 Settlement。

---

# 3. Catalog Version / Status / Activation

## 3.1 LaunchCatalogVersion

建议字段：

```text
catalog_version_id
catalog_key
market_id
default_currency_code
status
effective_at
retired_at

graph_version
policy_set_version
provider_capability_set_version

created_by
approved_by
change_reason
created_at
updated_at
```

## 3.2 Catalog Status

```text
DRAFT
REVIEW_REQUIRED
APPROVED
PILOT_ONLY
ACTIVE
PAUSED
RETIRED
```

语义：

| Status | 语义 |
|---|---|
| `DRAFT` | 可以编辑，不能被生产 Task Builder 使用 |
| `REVIEW_REQUIRED` | 已有内容，但需要 Graph / Safety / Operations 审阅 |
| `APPROVED` | 可用于指定 Pilot Activation，尚未开放 |
| `PILOT_ONLY` | 仅允许受控 Business / 邀请用户使用 |
| `ACTIVE` | 对符合条件的用户开放 |
| `PAUSED` | 暂停新 Task 使用，已有交易按快照继续 |
| `RETIRED` | 不再创建新 Task，历史引用保留 |

## 3.3 CatalogActivation

Catalog 的开放粒度必须至少到：

```text
market
geo_cell
scenario
role
time_band
requester_type
```

建议字段：

```text
activation_id
catalog_version_id
market_id
geo_cell_id
industry_id
scenario_id
role_id
time_band_id
requester_types[]

activation_status
minimum_supply_gate_ref
minimum_demand_gate_ref
operator_coverage_gate_ref
safety_gate_ref

activated_at
paused_at
activated_by
```

Activation 状态：

```text
PENDING
PILOT
ACTIVE
PAUSED
BLOCKED
RETIRED
```

## 3.4 Activation 不等于 Role Active

必须同时满足：

```text
Catalog Role = 可被目录引用
AgentRole = Agent 明确激活的真人供给身份
CatalogActivation = 某个 Cell 对该 Role 开放
```

任何一个条件缺失都不能进入 Qualified Pool。

## 3.5 Activation Gate

一个 Cell 从 `PENDING` 进入 `PILOT`，至少需要：

```text
Catalog approved
Graph version active
Policy bindings complete
Minimum qualified supply prepared
Anchor demand prepared
Operator coverage assigned
Safety review passed
Provider readiness passed
```

从 `PILOT` 进入 `ACTIVE`，还需要：

```text
Real execution evidence
No unresolved P0 safety blocker
Funding / settlement integrity
Replacement path tested
Requester and Agent support path tested
Cell liquidity reviewed
```

---

# 4. Industry Catalog

## 4.1 Food & Beverage

```text
industry_id: IND_FOOD_BEVERAGE
display_name: Food & Beverage
status: ACTIVE CANDIDATE
```

允许的 P0 语境：

```text
餐厅开业
咖啡店开业
门店促销
公开品牌活动
```

默认不允许：

```text
后厨操作
酒精分发
现金柜台
食品安全判断
私人住址配送
```

## 4.2 Retail

```text
industry_id: IND_RETAIL
display_name: Retail
status: ACTIVE CANDIDATE
```

允许的 P0 语境：

```text
门店开业
门店促销
品牌活动
公开场地客户引导
```

默认不允许：

```text
高价值库存搬运
现金处理
珠宝 / 受监管物品保管
单独进入仓库或住宅
```

## 4.3 Events / Exhibitions

```text
industry_id: IND_EVENTS_EXHIBITIONS
display_name: Events / Exhibitions
status: PILOT ONLY
```

允许的 P0 语境：

```text
展会入口
公开展览
品牌活动
商业发布会
```

进入 `ACTIVE` 前必须确认：

- Venue 有明确运营方
- 入场 / Check-in 方式可用
- Crowd / emergency SOP 已配置
- Event Organizer 或 Business 有现场联系人
- Operator 在活动时间段可响应

## 4.4 Business Services

```text
industry_id: IND_BUSINESS_SERVICES
display_name: Business Services
status: PILOT ONLY
```

允许的 P0 语境：

```text
商务会议支持
公开或商业场地 Site Visit
语言协助
资料 / 流程协助
```

默认不允许：

```text
法律意见
医疗意见
投资 / 金融建议
代表 Business 签订合同
代表客户作出专业监管结论
```

---

# 5. Scenario Family Catalog

## 5.1 SCN_BUSINESS_EVENT_GRAND_OPENING

| 字段 | 配置 |
|---|---|
| `scenario_id` | `SCN_BUSINESS_EVENT_GRAND_OPENING` |
| 名称 | Business Event / Grand Opening |
| requester types | `BUSINESS` 为主；`INDIVIDUAL` 仅在低风险模板允许时开放 |
| supported industries | Food & Beverage、Retail、Events / Exhibitions |
| default venue types | `COMMERCIAL_VENUE`、`PUBLIC_EVENT_VENUE`、`EXHIBITION_VENUE` |
| allowed roles | GREETER、EVENT_ASSISTANT、INTERPRETER |
| risk class | `MODERATE`；大型活动可进入 `HIGH_REVIEW` |
| default pricing modes | FIXED、HOURLY |
| default check-in | QR、Requester Confirm；GPS 作为可配置辅助信号 |
| default evidence | Checklist、Requester Confirm、Text Handoff；媒体默认不要求 |
| cancellation binding | `CANCEL_STANDARD_BUSINESS_SHIFT_V1` |
| matching binding | `MATCH_MULTI_SLOT_EVENT_V1` |
| admission | 标准公开商业场地可自动；大型活动 / 特殊 Venue 进入 Review Required |

场景目标：

```text
在明确时间和商业场地完成迎宾、现场协助或语言支持
```

不包含：

```text
保安
现金收银
高价值物品保管
全程拍摄监控
医疗 / 法律 / 专业监管服务
```

## 5.2 SCN_BUSINESS_ONSITE_SUPPORT

| 字段 | 配置 |
|---|---|
| `scenario_id` | `SCN_BUSINESS_ONSITE_SUPPORT` |
| 名称 | Business On-site Support |
| requester types | `BUSINESS` 为主；低风险公开场地模板可支持 `INDIVIDUAL` |
| supported industries | Business Services、Food & Beverage、Retail |
| default venue types | `BUSINESS_OFFICE`、`COMMERCIAL_VENUE`、`PUBLIC_PLACE` |
| allowed roles | INTERPRETER、SITE_VISIT_REP、BUSINESS_ASSISTANT |
| risk class | `MODERATE`；非公开或孤立地点必须 `HIGH_REVIEW` 或禁止 |
| default pricing modes | HOURLY、FIXED |
| default check-in | Requester Confirm、QR；必要时 GPS 辅助 |
| default evidence | Checklist、Text Handoff、Requester Confirm |
| cancellation binding | `CANCEL_HOURLY_SUPPORT_V1` |
| matching binding | `MATCH_ROLE_AND_TRAVEL_V1` |
| admission | 商业 / 公开地点可自动；私人住宅、高价值物品、专业服务要求拒绝或 Review Required |

场景目标：

```text
在明确的 Business 任务范围内完成语言、现场、会议或资料流程协助
```

不包含：

```text
代表 Requester / Business 签署法律文件
独立作出专业判断
处理现金或高价值资产
代替授权员工作出 Business 决策
```

---

# 6. Role Catalog

## 6.1 Role 总表

| Role ID | 中文名称 | 主 Scenario | 初始建议 | 定价模式 | 基础风险 |
|---|---|---|---|---|---|
| `ROLE_GREETER` | 迎宾 / 引导 | Business Event | ACTIVE CANDIDATE | FIXED | LOW–MODERATE |
| `ROLE_EVENT_ASSISTANT` | 活动协助 | Business Event | ACTIVE CANDIDATE | FIXED / HOURLY | MODERATE |
| `ROLE_INTERPRETER` | 口译 / 商务语言协助 | 两类 Scenario | ACTIVE CANDIDATE | HOURLY | MODERATE |
| `ROLE_SITE_VISIT_REP` | 现场访问代表 | On-site Support | PILOT ONLY | HOURLY / FIXED | MODERATE–HIGH REVIEW |
| `ROLE_BUSINESS_ASSISTANT` | 商务会议协助 | On-site Support | PILOT ONLY | HOURLY / FIXED | MODERATE |

基础风险只是 Catalog 元数据，不是运行时 `RiskDecision`，也不能替代 User / Business / Venue 的实际 Risk 检查。

## 6.2 Role 配置最小字段

每个 Role 必须定义：

```text
role_id
role_key
display_name
description
supported_scenario_ids[]
must_capability_ids[]
nice_capability_ids[]
minimum_qualification_status
verification_requirement_refs[]
default_deliverable_template_id
default_evidence_template_id
allowed_pricing_modes[]
allowed_venue_types[]
risk_class
checkin_policy_ref
cancellation_policy_ref
matching_policy_ref
visibility_policy_ref
```

## 6.3 ROLE_GREETER

### Role intent

```text
在公开或商业活动场地完成迎接、基本引导和信息转交
```

### Must Capabilities

```text
CAP_EVENT_RECEPTION
CAP_BASIC_CUSTOMER_WELCOME
CAP_VENUE_NAVIGATION
CAP_INSTRUCTION_FOLLOWING
```

### Nice Capabilities

```text
CAP_SECOND_LANGUAGE_CONVERSATION
CAP_EVENT_FLOW_AWARENESS
CAP_PRIOR_PUBLIC_FACING_WORK
```

### Qualification / Verification

```text
minimum_qualification: QUALIFIED
identity_requirement: market KYC policy
must capability source: USER_CLAIM or EVIDENCED
preferred verification: PLATFORM_VERIFIED or OUTCOME_VERIFIED
```

首次执行不要求 Agent 具备历史 Outcome，但必须满足当前 Task 的 Must Capability 和身份 / Risk Gate。

### Deliverable

```text
在约定时间到达
完成迎宾 / 基本引导
按照任务说明处理常见问题
将无法处理的问题交给指定 Business 联系人
完成交接 Checklist
```

### Evidence

```text
REQUIRED: Check-in signal
REQUIRED: completion checklist or requester confirmation
OPTIONAL: text handoff
NOT_REQUIRED_BY_DEFAULT: photo / video
```

### Policy bindings

```text
pricing: PRICE_FIXED_SHIFT_V1
checkin: CHECKIN_QR_OR_REQUESTER_CONFIRM_V1
matching: MATCH_EVENT_ROLE_V1
cancellation: CANCEL_STANDARD_BUSINESS_SHIFT_V1
location: COMMERCIAL_OR_PUBLIC_VENUE_ONLY_V1
```

## 6.4 ROLE_EVENT_ASSISTANT

### Role intent

```text
在活动现场执行结构化清单、队列 / 动线协助和基础现场支持
```

### Must Capabilities

```text
CAP_EVENT_SETUP_SUPPORT
CAP_CHECKLIST_EXECUTION
CAP_QUEUE_OR_FLOW_SUPPORT
CAP_BASIC_EXCEPTION_ESCALATION
```

### Nice Capabilities

```text
CAP_EVENT_FLOW_AWARENESS
CAP_SECOND_LANGUAGE_CONVERSATION
CAP_BASIC_DEVICE_OPERATION
```

### Qualification / Verification

```text
minimum_qualification: QUALIFIED
must capability source: EVIDENCED preferred
event / crowd-related requirement: scenario risk policy
platform review: required for HIGH_REVIEW venue or crowd profile
```

### Deliverable

```text
完成分配的 Event Checklist
执行指定现场协助动作
记录异常并交接给 Business 联系人
不得承担保安、现金或高价值物品保管职责
```

### Evidence

```text
REQUIRED: Check-in
REQUIRED: checklist completion
REQUIRED: requester or designated contact confirmation
OPTIONAL: text exception report
MEDIA: only if Task explicitly allows and rights / privacy check passes
```

### Policy bindings

```text
pricing: PRICE_FIXED_SHIFT_OR_HOURLY_V1
checkin: CHECKIN_QR_OR_REQUESTER_CONFIRM_V1
matching: MATCH_MULTI_SLOT_EVENT_V1
cancellation: CANCEL_STANDARD_BUSINESS_SHIFT_V1
location: COMMERCIAL_OR_PUBLIC_EVENT_VENUE_V1
```

## 6.5 ROLE_INTERPRETER

### Role intent

```text
在约定的语言对、场景和时段内提供真人口译 / 语言协助
```

### Must Capabilities

```text
CAP_ORAL_INTERPRETATION
CAP_LANGUAGE_PAIR
CAP_CONTEXTUAL_LISTENING
CAP_CONFIDENTIALITY_AWARENESS
```

### Nice Capabilities

```text
CAP_BUSINESS_TERMINOLOGY
CAP_EVENT_TERMINOLOGY
CAP_WRITTEN_SUMMARY
CAP_DOMAIN_BACKGROUND
```

### Qualification / Verification

```text
minimum_qualification: QUALIFIED
language pair: EVIDENCED required before Offer
professional / domain claim: separate capability record
platform or operator verification: required where Task marks VERIFIED_ONLY
```

语言能力不得由一个综合分数表达。Requester 看到的是 Task-relevant language pair 和验证来源，不是内部 numeric trust score。

### Deliverable

```text
在指定时间和场景内提供口译
按要求进行语言转述，不擅自加入事实或专业意见
对无法确认的术语进行澄清
在结束时完成简短交接
```

### Evidence

```text
REQUIRED: Check-in
REQUIRED: requester / designated contact confirmation
OPTIONAL: structured session checklist
NOT_ALLOWED_BY_DEFAULT: recording or full meeting capture
```

### Policy bindings

```text
pricing: PRICE_HOURLY_WITH_MINIMUM_DURATION_V1
checkin: CHECKIN_REQUESTER_CONFIRM_OR_QR_V1
matching: MATCH_LANGUAGE_PAIR_AND_TRAVEL_V1
cancellation: CANCEL_HOURLY_SUPPORT_V1
location: BUSINESS_OR_PUBLIC_VENUE_V1
```

## 6.6 ROLE_SITE_VISIT_REP

### Role intent

```text
代表 Requester / Business 到约定的商业或公开地点完成现场访问、观察和结构化交接
```

### Must Capabilities

```text
CAP_SITE_VISIT_ARRIVAL
CAP_OBSERVATION_AND_NOTE_TAKING
CAP_CHECKLIST_EXECUTION
CAP_HANDOFF_COMMUNICATION
```

### Nice Capabilities

```text
CAP_DOMAIN_BACKGROUND
CAP_PHOTO_DOCUMENTATION
CAP_SECOND_LANGUAGE_CONVERSATION
CAP_ROUTE_PLANNING
```

### Qualification / Verification

```text
minimum_qualification: QUALIFIED
site-visit capability: EVIDENCED required
venue / privacy review: required
high-risk or isolated location: REVIEW_REQUIRED or prohibited
```

### Deliverable

```text
按约定路线和时间到达
完成访问 Checklist
记录用户要求范围内的观察结果
把事实、待确认事项和个人推测分开
向 Requester / Business 完成交接
```

### Evidence

```text
REQUIRED: Check-in
REQUIRED: structured visit checklist or text handoff
OPTIONAL: photo evidence only when Task explicitly permits
PRIVATE / SENSITIVE SCENE: photo default NOT_ALLOWED
```

### Policy bindings

```text
pricing: PRICE_HOURLY_OR_FIXED_VISIT_V1
checkin: CHECKIN_QR_OR_REQUESTER_CONFIRM_V1
matching: MATCH_ROLE_TRAVEL_AND_VENUE_V1
cancellation: CANCEL_REVIEW_REQUIRED_SUPPORT_V1
location: COMMERCIAL_OR_PUBLIC_PLACE_ONLY_V1
```

## 6.7 ROLE_BUSINESS_ASSISTANT

### Role intent

```text
提供限定范围内的会议、资料、时间和现场流程协助，不替代专业人员或 Business 决策者
```

### Must Capabilities

```text
CAP_MEETING_LOGISTICS
CAP_NOTE_TAKING
CAP_MATERIAL_HANDOFF
CAP_SCHEDULE_FOLLOWING
```

### Nice Capabilities

```text
CAP_SECOND_LANGUAGE_CONVERSATION
CAP_BUSINESS_TERMINOLOGY
CAP_STRUCTURED_SUMMARY
CAP_BASIC_DEVICE_OPERATION
```

### Qualification / Verification

```text
minimum_qualification: QUALIFIED
capability source: EVIDENCED preferred
professional advice claim: not accepted as Task capability
regulated / legal / financial context: blocked unless separately approved
```

### Deliverable

```text
准备会议所需的非敏感材料
按照清单完成现场协助
记录约定范围内的行动项
完成资料和事项交接
不得代表 Business 作出授权决定或签署文件
```

### Evidence

```text
REQUIRED: Check-in
REQUIRED: checklist or requester confirmation
OPTIONAL: structured text handoff
NOT_REQUIRED_BY_DEFAULT: audio / video recording
```

### Policy bindings

```text
pricing: PRICE_HOURLY_OR_FIXED_V1
checkin: CHECKIN_REQUESTER_CONFIRM_OR_QR_V1
matching: MATCH_ROLE_AND_TRAVEL_V1
cancellation: CANCEL_HOURLY_SUPPORT_V1
location: BUSINESS_OFFICE_OR_PUBLIC_PLACE_V1
```

---

# 7. Atomic Capability Catalog

## 7.1 Capability 定义规则

Atomic Capability 必须能被单独验证、单独过期、单独暴露和单独用于 Eligibility。

不能把以下内容直接做成一个黑盒：

```text
“适合做活动”
“综合能力很强”
“看起来可靠”
```

## 7.2 Launch Capability 列表

| Capability ID | 名称 | 适用 Role | 初始验证来源 | Must / Nice 默认 |
|---|---|---|---|---|
| `CAP_EVENT_RECEPTION` | 活动迎宾 | GREETER | USER_CLAIM / EVIDENCED | Must |
| `CAP_BASIC_CUSTOMER_WELCOME` | 基础客户接待 | GREETER | USER_CLAIM / EVIDENCED | Must |
| `CAP_VENUE_NAVIGATION` | 场地引导 | GREETER | USER_CLAIM / OUTCOME_VERIFIED | Must |
| `CAP_INSTRUCTION_FOLLOWING` | 按指令执行 | GREETER | EVIDENCED / OUTCOME_VERIFIED | Must |
| `CAP_EVENT_SETUP_SUPPORT` | 活动现场支持 | EVENT_ASSISTANT | EVIDENCED | Must |
| `CAP_CHECKLIST_EXECUTION` | 清单执行 | EVENT_ASSISTANT / SITE_VISIT_REP | EVIDENCED | Must |
| `CAP_QUEUE_OR_FLOW_SUPPORT` | 队列 / 动线协助 | EVENT_ASSISTANT | EVIDENCED | Must |
| `CAP_BASIC_EXCEPTION_ESCALATION` | 基础异常升级 | EVENT_ASSISTANT | EVIDENCED | Must |
| `CAP_ORAL_INTERPRETATION` | 口译 | INTERPRETER | EVIDENCED / PLATFORM_VERIFIED | Must |
| `CAP_LANGUAGE_PAIR` | 语言对 | INTERPRETER | EVIDENCED | Must |
| `CAP_CONTEXTUAL_LISTENING` | 场景理解 | INTERPRETER | EVIDENCED / OUTCOME_VERIFIED | Must |
| `CAP_CONFIDENTIALITY_AWARENESS` | 保密意识 | INTERPRETER | USER_CLAIM + policy acknowledgement | Must |
| `CAP_SITE_VISIT_ARRIVAL` | 现场访问到达 | SITE_VISIT_REP | OUTCOME_VERIFIED preferred | Must |
| `CAP_OBSERVATION_AND_NOTE_TAKING` | 观察与记录 | SITE_VISIT_REP | EVIDENCED | Must |
| `CAP_HANDOFF_COMMUNICATION` | 交接沟通 | SITE_VISIT_REP / BUSINESS_ASSISTANT | EVIDENCED | Must |
| `CAP_MEETING_LOGISTICS` | 会议流程协助 | BUSINESS_ASSISTANT | EVIDENCED | Must |
| `CAP_NOTE_TAKING` | 结构化记录 | BUSINESS_ASSISTANT | EVIDENCED | Must |
| `CAP_MATERIAL_HANDOFF` | 资料交接 | BUSINESS_ASSISTANT | USER_CLAIM / EVIDENCED | Must |
| `CAP_SCHEDULE_FOLLOWING` | 时间与流程跟进 | BUSINESS_ASSISTANT | EVIDENCED | Must |
| `CAP_SECOND_LANGUAGE_CONVERSATION` | 第二语言交流 | 多 Role | EVIDENCED | Nice |
| `CAP_EVENT_FLOW_AWARENESS` | 活动动线理解 | GREETER / EVENT_ASSISTANT | EVIDENCED | Nice |
| `CAP_PRIOR_PUBLIC_FACING_WORK` | 公众场合经验 | GREETER | USER_CLAIM / EVIDENCED | Nice |
| `CAP_BASIC_DEVICE_OPERATION` | 基础设备操作 | EVENT_ASSISTANT / BUSINESS_ASSISTANT | USER_CLAIM / EVIDENCED | Nice |
| `CAP_BUSINESS_TERMINOLOGY` | 商务术语 | INTERPRETER / BUSINESS_ASSISTANT | EVIDENCED | Nice |
| `CAP_EVENT_TERMINOLOGY` | 活动术语 | INTERPRETER | EVIDENCED | Nice |
| `CAP_WRITTEN_SUMMARY` | 书面摘要 | INTERPRETER | EVIDENCED | Nice |
| `CAP_DOMAIN_BACKGROUND` | 场景领域背景 | INTERPRETER / SITE_VISIT_REP | separate proof | Nice |
| `CAP_PHOTO_DOCUMENTATION` | 任务限定拍摄 | SITE_VISIT_REP | task policy + evidence proof | Nice |
| `CAP_ROUTE_PLANNING` | 路线规划 | SITE_VISIT_REP | USER_CLAIM / EVIDENCED | Nice |
| `CAP_STRUCTURED_SUMMARY` | 结构化总结 | BUSINESS_ASSISTANT | EVIDENCED | Nice |
```

## 7.3 Capability 资格规则

```text
Task Must Capability
∩ Agent Capability Record active
∩ verification requirement satisfied
∩ AgentRole status active
∩ current Risk / Availability / Travel gate passed
```

才可以得到：

```text
Qualified for this TaskSlot
```

Nice Capability：

```text
只影响 ranking / explanation / candidate display
不能替代 Must Capability
```

## 7.4 Capability 不能跨 Role 自动迁移

例如：

```text
CAP_SECOND_LANGUAGE_CONVERSATION
```

不能自动推出：

```text
CAP_ORAL_INTERPRETATION
```

又例如：

```text
CAP_NOTE_TAKING
```

不能自动推出：

```text
CAP_BUSINESS_ADVICE
```

跨 Role 推导必须有明确 GraphEdge、验证要求和有效期。

---

# 8. Scenario / Role / Capability Matrix

| Scenario | GREETER | EVENT_ASSISTANT | INTERPRETER | SITE_VISIT_REP | BUSINESS_ASSISTANT |
|---|---:|---:|---:|---:|---:|
| Business Event / Grand Opening | ✓ | ✓ | ✓ | — | — |
| Business On-site Support | — | — | ✓ | ✓ | ✓ |

## 8.1 Event Role 组合规则

允许：

```text
GREETER only
EVENT_ASSISTANT only
GREETER + EVENT_ASSISTANT
GREETER + INTERPRETER
EVENT_ASSISTANT + INTERPRETER
GREETER + EVENT_ASSISTANT + INTERPRETER
```

不允许在 P0 自动生成：

```text
security team
cash handling team
medical support team
unbounded “general helper” role
```

## 8.2 On-site Support 组合规则

允许：

```text
INTERPRETER only
SITE_VISIT_REP only
BUSINESS_ASSISTANT only
INTERPRETER + BUSINESS_ASSISTANT
```

必须 Review 或拒绝：

```text
SITE_VISIT_REP + high-value goods
BUSINESS_ASSISTANT + legal signing
INTERPRETER + regulated professional advice
任何 Role + private residence by default
```

---

# 9. Scenario Template Pack

## 9.1 Template 字段标准

每个 Scenario Template 必须完整定义：

```text
template_id
template_version
scenario_id
industry_ids[]
status

slot_group_defaults[]
allowed_slot_range
default_schedule_shape
allowed_venue_types[]
location_visibility_level

must_requirements[]
nice_requirements[]
deliverable_items[]
evidence_requirements[]

pricing_mode
pricing_unit
compensation_policy_ref
requester_budget_policy_ref

risk_class
task_admission_policy_ref
checkin_policy_ref
location_policy_ref
matching_policy_ref
cancellation_policy_ref
notification_policy_ref

individual_requester_allowed
business_requester_allowed
operator_review_required
```

## 9.2 TPL_EVENT_GREETER_TEAM

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_EVENT_GREETER_TEAM` |
| 场景 | `SCN_BUSINESS_EVENT_GRAND_OPENING` |
| industry | Food & Beverage、Retail |
| status | ACTIVE CANDIDATE；按 Cell 激活 |
| default slots | `GREETER ×2` |
| allowed range | `GREETER ×1–6`，具体上限由 Catalog Activation / Operations Gate 控制 |
| duration shape | 明确开始 / 结束时间的 shift |
| venue | `COMMERCIAL_VENUE`、`PUBLIC_EVENT_VENUE` |
| requester | BUSINESS；低风险场地可允许 INDIVIDUAL |
| pricing | FIXED per Slot / shift |
| risk | LOW–MODERATE |
| check-in | QR 或 Requester Confirm |
| evidence | Check-in + completion checklist / requester confirmation |
| cancellation | `CANCEL_STANDARD_BUSINESS_SHIFT_V1` |
| matching | `MATCH_MULTI_SLOT_EVENT_V1` |
| admission | 标准场地可自动；特殊 Crowd / Venue Review Required |

### Must

```text
明确活动时间和场地
每个 Slot 一个真人
CAP_EVENT_RECEPTION
CAP_BASIC_CUSTOMER_WELCOME
CAP_VENUE_NAVIGATION
CAP_INSTRUCTION_FOLLOWING
有明确 Business 联系人
```

### Nice

```text
第二语言交流
活动动线经验
公众场合服务经验
```

### Deliverable

```text
按时到达
完成迎宾和值守
执行基本场地引导
将超出范围的问题升级
完成每个 Slot 的交接
```

### NOT_ALLOWED

```text
收现金
保管高价值物品
执行保安或强制驱离
代替 Business 作价格 / 法律 / 医疗判断
```

## 9.3 TPL_EVENT_SUPPORT_TEAM

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_EVENT_SUPPORT_TEAM` |
| 场景 | `SCN_BUSINESS_EVENT_GRAND_OPENING` |
| industry | Food & Beverage、Retail、Events / Exhibitions |
| status | ACTIVE CANDIDATE；Exhibition 默认 PILOT ONLY |
| default slots | `EVENT_ASSISTANT ×1` |
| allowed range | `EVENT_ASSISTANT ×1–4` |
| duration shape | FIXED shift 或 HOURLY，按 Cell policy |
| venue | `COMMERCIAL_VENUE`、`PUBLIC_EVENT_VENUE`、`EXHIBITION_VENUE` |
| requester | BUSINESS |
| pricing | FIXED / HOURLY |
| risk | MODERATE；Crowd-heavy venue 可 HIGH_REVIEW |
| check-in | QR、Requester Confirm；必要时 GPS 辅助 |
| evidence | Checklist + requester / designated contact confirmation |
| cancellation | `CANCEL_STANDARD_BUSINESS_SHIFT_V1` |
| matching | `MATCH_MULTI_SLOT_EVENT_V1` |
| admission | 大型活动、展会或夜间活动需 Operator / Safety review |

### Must

```text
CAP_EVENT_SETUP_SUPPORT
CAP_CHECKLIST_EXECUTION
CAP_QUEUE_OR_FLOW_SUPPORT
CAP_BASIC_EXCEPTION_ESCALATION
现场联系人和异常升级路径
```

### Nice

```text
活动动线经验
第二语言交流
基础设备操作
```

### Deliverable

```text
完成现场 Checklist
协助指定队列 / 动线 / 资料发放
记录并升级异常
完成交接
```

### NOT_ALLOWED

```text
保安 / 武力服务
现金或高价值库存处理
未经同意拍摄参与者
独立处理医疗 / 安全事故
```

## 9.4 TPL_EVENT_INTERPRETER_SUPPORT

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_EVENT_INTERPRETER_SUPPORT` |
| 场景 | `SCN_BUSINESS_EVENT_GRAND_OPENING` |
| industry | Food & Beverage、Retail、Events / Exhibitions |
| status | PILOT ONLY → 通过语言供给和安全 Gate 后可 ACTIVE |
| default slots | `INTERPRETER ×1` |
| allowed range | `INTERPRETER ×1–2` |
| duration shape | HOURLY with minimum duration |
| venue | `COMMERCIAL_VENUE`、`PUBLIC_EVENT_VENUE`、`EXHIBITION_VENUE` |
| requester | BUSINESS |
| pricing | HOURLY |
| risk | MODERATE |
| check-in | Requester Confirm / QR |
| evidence | Check-in + requester confirmation；不默认录音录像 |
| cancellation | `CANCEL_HOURLY_SUPPORT_V1` |
| matching | `MATCH_LANGUAGE_PAIR_AND_TRAVEL_V1` |
| admission | 语言对或会议内容属于 regulated / legal / medical 时拒绝或另行审核 |

### Must

```text
CAP_ORAL_INTERPRETATION
CAP_LANGUAGE_PAIR
CAP_CONTEXTUAL_LISTENING
CAP_CONFIDENTIALITY_AWARENESS
明确语言对
明确会议 / 活动范围
```

### Nice

```text
商务术语
活动术语
书面摘要
相关领域背景
```

### Deliverable

```text
在约定时段提供口译
准确转述，不替参与方新增观点
无法确认的内容进行澄清
完成简短会后交接
```

### NOT_ALLOWED

```text
未经授权录音
代替专业人员给出法律 / 医疗 / 金融意见
签署或批准 Business 文件
将会议内容公开为 Content
```

## 9.5 TPL_RETAIL_PROMOTION_TEAM

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_RETAIL_PROMOTION_TEAM` |
| 场景 | `SCN_BUSINESS_EVENT_GRAND_OPENING` |
| industry | Retail |
| status | ACTIVE CANDIDATE |
| default slots | `GREETER ×2`、`EVENT_ASSISTANT ×1` |
| allowed range | `GREETER ×1–4`、`EVENT_ASSISTANT ×1–3` |
| duration shape | FIXED shift |
| venue | `COMMERCIAL_VENUE`、`PUBLIC_EVENT_VENUE` |
| requester | BUSINESS |
| pricing | FIXED per Slot / shift |
| risk | MODERATE |
| check-in | QR / Requester Confirm |
| evidence | Checklist + designated contact confirmation |
| cancellation | `CANCEL_STANDARD_BUSINESS_SHIFT_V1` |
| matching | `MATCH_MULTI_SLOT_EVENT_V1` |
| admission | 不允许涉及现金柜台、高价值库存或孤立仓储区 |

### Must

```text
GREETER:
CAP_EVENT_RECEPTION
CAP_BASIC_CUSTOMER_WELCOME
CAP_VENUE_NAVIGATION
CAP_INSTRUCTION_FOLLOWING

EVENT_ASSISTANT:
CAP_CHECKLIST_EXECUTION
CAP_QUEUE_OR_FLOW_SUPPORT
CAP_BASIC_EXCEPTION_ESCALATION
```

### Deliverable

```text
完成指定促销时段的迎宾 / 引导 / 流程协助
遵守 Business 提供的公开活动说明
不进行现金或高价值库存处理
完成 Slot-level handoff
```

## 9.6 TPL_ONSITE_INTERPRETER

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_ONSITE_INTERPRETER` |
| 场景 | `SCN_BUSINESS_ONSITE_SUPPORT` |
| industry | Business Services、Food & Beverage、Retail |
| status | ACTIVE CANDIDATE；按语言对和 Geo Cell 激活 |
| default slots | `INTERPRETER ×1` |
| allowed range | `INTERPRETER ×1–2` |
| duration shape | HOURLY with minimum duration |
| venue | `BUSINESS_OFFICE`、`COMMERCIAL_VENUE`、`PUBLIC_PLACE` |
| requester | BUSINESS；低风险公开场地可支持 INDIVIDUAL |
| pricing | HOURLY |
| risk | MODERATE；regulated content 需拒绝 / Review |
| check-in | Requester Confirm / QR |
| evidence | Check-in + requester confirmation；不默认保存会议内容 |
| cancellation | `CANCEL_HOURLY_SUPPORT_V1` |
| matching | `MATCH_LANGUAGE_PAIR_AND_TRAVEL_V1` |
| admission | 私人住宅、单独隔离场所、regulated professional meeting 默认不开放 |

### Must

```text
CAP_ORAL_INTERPRETATION
CAP_LANGUAGE_PAIR
CAP_CONTEXTUAL_LISTENING
CAP_CONFIDENTIALITY_AWARENESS
明确语言对和会议边界
```

### Deliverable

```text
完成约定时间内的语言协助
对不确定术语做澄清
把事实转述与个人意见分开
完成交接
```

## 9.7 TPL_SITE_VISIT_REP

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_SITE_VISIT_REP` |
| 场景 | `SCN_BUSINESS_ONSITE_SUPPORT` |
| industry | Business Services、Food & Beverage、Retail |
| status | PILOT ONLY |
| default slots | `SITE_VISIT_REP ×1` |
| allowed range | `SITE_VISIT_REP ×1` |
| duration shape | FIXED visit 或 HOURLY |
| venue | `BUSINESS_OFFICE`、`COMMERCIAL_VENUE`、`PUBLIC_PLACE` |
| requester | BUSINESS；INDIVIDUAL 需单独低风险模板 |
| pricing | HOURLY / FIXED |
| risk | MODERATE–HIGH_REVIEW |
| check-in | QR / Requester Confirm；GPS 仅作为辅助 |
| evidence | Checklist / Text Handoff；Photo 需显式允许 |
| cancellation | `CANCEL_REVIEW_REQUIRED_SUPPORT_V1` |
| matching | `MATCH_ROLE_TRAVEL_AND_VENUE_V1` |
| admission | 未验证地点、孤立地点、高价值物品、私人住宅默认拒绝 |

### Must

```text
CAP_SITE_VISIT_ARRIVAL
CAP_OBSERVATION_AND_NOTE_TAKING
CAP_CHECKLIST_EXECUTION
CAP_HANDOFF_COMMUNICATION
访问目的、路线、联系人、交付格式明确
```

### Deliverable

```text
按约定完成现场访问
提交结构化观察 / Checklist
区分事实、待确认事项和推测
完成交接
```

### NOT_ALLOWED

```text
代签合同
保管高价值物品
拍摄未授权人员或敏感区域
独立作专业 / 法律 / 估值判断
```

## 9.8 TPL_BUSINESS_MEETING_ASSISTANT

| 字段 | 配置 |
|---|---|
| `template_id` | `TPL_BUSINESS_MEETING_ASSISTANT` |
| 场景 | `SCN_BUSINESS_ONSITE_SUPPORT` |
| industry | Business Services、Food & Beverage、Retail |
| status | PILOT ONLY |
| default slots | `BUSINESS_ASSISTANT ×1` |
| allowed range | `BUSINESS_ASSISTANT ×1–2` |
| duration shape | HOURLY / FIXED meeting block |
| venue | `BUSINESS_OFFICE`、`COMMERCIAL_VENUE`、`PUBLIC_PLACE` |
| requester | BUSINESS |
| pricing | HOURLY / FIXED |
| risk | MODERATE |
| check-in | Requester Confirm / QR |
| evidence | Checklist / Requester Confirm / Text Handoff |
| cancellation | `CANCEL_HOURLY_SUPPORT_V1` |
| matching | `MATCH_ROLE_AND_TRAVEL_V1` |
| admission | 法律、金融、医疗和签约场景默认禁止 |

### Must

```text
CAP_MEETING_LOGISTICS
CAP_NOTE_TAKING
CAP_MATERIAL_HANDOFF
CAP_SCHEDULE_FOLLOWING
会议范围、资料范围、交付格式明确
```

### Deliverable

```text
完成会前准备和现场流程协助
按指定格式记录行动项
完成资料和事项交接
```

### NOT_ALLOWED

```text
录音录像默认关闭
代替 Business 决策
签署文件
提供法律 / 医疗 / 金融建议
接触未经授权的敏感资料
```

---

# 10. Individual Requester Catalog

## 10.1 Individual P0 原则

Individual Requester 在架构上支持，但首发只能访问低风险、标准化、公共或商业场地任务。

默认：

```text
INDIVIDUAL_ALLOWED = false
```

只有 Template 明确配置为 `true` 且 Activation 通过安全 Gate 时，Individual 才能创建。

## 10.2 可考虑的低风险模板

以下只作为后续或受控 Pilot，不自动进入 Business 主冷启动：

| Template | 允许场景 | 推荐状态 | 约束 |
|---|---|---|---|
| `TPL_PUBLIC_QUEUE_PROXY` | 公共场地排队 | PILOT ONLY | 禁止住宅、现金、高价值物品 |
| `TPL_SIMPLE_PUBLIC_PICKUP` | 公共 / 商业场地简单取件 | PILOT ONLY | 禁止现金、药品、身份证件和高价值物品 |
| `TPL_PUBLIC_SITE_VISIT` | 公共地点现场访问 | PILOT ONLY | 必须有明确地点、联系人和 Evidence 范围 |
| `TPL_INDIVIDUAL_INTERPRETER` | 低风险公共场地语言协助 | PILOT ONLY | 不能涉及法律、医疗、金融或敏感隐私内容 |

## 10.3 Individual 默认拒绝

```text
PRIVATE_RESIDENCE
HIGH_VALUE_ITEM
CASH_HANDLING
MEDICAL
LEGAL
FINANCIAL
MINOR_UNSUPERVISED
OVERNIGHT
ISOLATED_LOCATION
```

任何 Individual 高风险需求都必须在 Task Admission 阶段拒绝或进入明确的 Review，不允许通过改写 Task 标题绕过。

---

# 11. Requirement Template Contract

## 11.1 Must / Nice 结构

每个 Template 的 Requirement 必须标记：

```text
requirement_id
capability_id or structured rule
priority: MUST / NICE
qualification_threshold
verification_requirement_ref
user_visible_explanation
blocking_behavior
```

`MUST` 缺失时：

```text
不能进入 Qualified Pool
```

`NICE` 缺失时：

```text
可以进入 Qualified Pool
但影响 ranking / explanation / candidate display
```

## 11.2 Structured Rules

除 Capability 外，Template 可以定义结构化 Task Rule：

```text
language_pair
minimum_availability_window
venue_type
travel_feasibility
minimum_role_qualification
required_contact_method
evidence_acceptance
```

这些规则必须有明确的 evaluator；不能写成只有运营人员理解的自由文本。

## 11.3 Requirement Resolution

```text
Template defaults
→ Requester edits
→ Graph resolution
→ Must / Nice classification
→ Verification resolution
→ Admission / Risk resolution
→ TaskNeedProfile snapshot
```

Requester 可以增加合理的 Task-specific Must / Nice，但不能：

- 删除场景强制的 Safety Requirement
- 把 Must 降级为 Nice
- 以自由文本加入受禁止的敏感属性要求
- 用 Appearance、Gender、Ethnicity、Religion 等无关敏感属性替代 Capability

---

# 12. Deliverable Catalog

## 12.1 Deliverable 不是一句宣传文案

每个 Template 必须把核心结果拆为结构化 `deliverable_items`：

```text
deliverable_item_id
description
required
acceptance_signal
requester_visible
evidence_requirement_ref
```

## 12.2 Launch Deliverable Set

| Deliverable ID | 适用 Role | 结果定义 | 默认验收信号 |
|---|---|---|---|
| `DELIVER_EVENT_GREETING_SHIFT` | GREETER | 完成迎宾和引导值守 | Check-in + Checklist + Requester Confirm |
| `DELIVER_EVENT_SUPPORT_CHECKLIST` | EVENT_ASSISTANT | 完成现场协助清单 | Checklist + Contact Confirm |
| `DELIVER_INTERPRETATION_SESSION` | INTERPRETER | 完成约定语言协助时段 | Check-in + Requester Confirm |
| `DELIVER_SITE_VISIT_HANDOFF` | SITE_VISIT_REP | 完成访问并提交结构化交接 | Check-in + Visit Handoff |
| `DELIVER_MEETING_ASSIST_HANDOFF` | BUSINESS_ASSISTANT | 完成会议流程协助和事项交接 | Checklist + Requester Confirm |

## 12.3 Completion 规则

```text
Required Deliverable Item
→ Required Evidence / Confirmation
→ Completion Review
```

不得因为聊天中说过“完成了”就自动完成 Required Deliverable。

---

# 13. Evidence Template Catalog

## 13.1 Evidence 类型

P0 支持：

```text
CHECKIN_SIGNAL
CHECKLIST
TEXT_HANDOFF
REQUESTER_CONFIRMATION
OPTIONAL_PHOTO
```

P0 默认不使用：

```text
continuous_video
continuous_audio
full_meeting_recording
background_surveillance
```

## 13.2 Evidence 配置

| Evidence Template | Required | Optional | Not Allowed by Default |
|---|---|---|---|
| `EVID_EVENT_GREETER_V1` | Check-in、Checklist / Requester Confirm | Text handoff | Photo / video |
| `EVID_EVENT_SUPPORT_V1` | Check-in、Checklist、Contact Confirm | Exception text、Task-approved photo | Crowd recording |
| `EVID_INTERPRETER_V1` | Check-in、Requester Confirm | Session checklist | Audio / video recording |
| `EVID_SITE_VISIT_V1` | Check-in、Visit Handoff | Task-approved photo | Private / sensitive scene media |
| `EVID_BUSINESS_ASSISTANT_V1` | Check-in、Checklist / Requester Confirm | Text handoff | Meeting recording |

## 13.3 Evidence 与 Content 分离

Task Evidence 默认只服务于：

```text
Execution
→ Completion
→ Dispute / Safety if needed
```

不得自动进入公共 Content。若未来要转为 Content，必须另行通过：

```text
Consent
Rights
Privacy
Subject visibility
Content policy
```

---

# 14. Pricing Unit 与 Compensation Binding

## 14.1 P0 Pricing Mode

Launch Catalog 只绑定：

```text
FIXED
HOURLY
```

不开放：

```text
公开竞价大厅
最低价排序真人
不透明 surge
无上限 custom quote
```

## 14.2 Pricing Unit Matrix

| Role / Template | Default pricing mode | Pricing unit | 备注 |
|---|---|---|---|
| GREETER | FIXED | per Slot / shift | Slot 独立 CompensationTerms |
| EVENT_ASSISTANT | FIXED / HOURLY | per Slot / shift or hour | 由时长和现场复杂度决定 |
| INTERPRETER | HOURLY | per hour with minimum duration | 语言对和时间段影响 guidance |
| SITE_VISIT_REP | FIXED / HOURLY | per visit or hour | 复杂访问需 Review / later quote |
| BUSINESS_ASSISTANT | HOURLY / FIXED | per meeting block or hour | 不包含专业服务费 |

## 14.3 Amount 不在本章硬编码

Template 只引用：

```text
pricing_policy_ref
compensation_default_ref
price_guidance_ref
currency_code from MarketDefinition
```

Chapter 23 才定义：

```text
base amount
hourly rate
minimum duration
travel allowance
urgent premium
platform fee
budget cap
```

## 14.4 每个 Slot 必须有 CompensationTerms

即使使用批量模板：

```text
SlotGroup default
→ clone per TaskSlot
→ CompensationTerms per Slot
```

禁止：

```text
Task price 一个字段
SlotGroup total 作为 Agent Earnings
“按现场再说”无结构化金额
```

## 14.5 Travel Binding

P0 只使用：

```text
TRAVEL_INCLUDED
TRAVEL_FIXED_ALLOWANCE
```

Travel allowance 必须与 Agent Earnings 分开显示，并且不需要向 Requester 暴露 Agent 家庭地址。

---

# 15. Risk / Safety / Admission Binding

## 15.1 Risk Class 语义

Catalog 的 `risk_class` 是配置层的初始提示：

```text
LOW
MODERATE
HIGH_REVIEW
PROHIBITED
```

它不是：

```text
RiskStatus
RiskDecision
公开 Trust Score
```

运行时必须继续计算：

```text
User Risk
Agent Risk
Business Risk
Venue Risk
Task Risk
```

## 15.2 Task Admission Binding

| Catalog 条件 | Admission 默认行为 |
|---|---|
| 标准商业 / 公开场地，低复杂度 | `NOT_REQUIRED` 或自动 `APPROVED`，以市场配置为准 |
| Crowd-heavy Event / Exhibition | `PENDING` / `REVIEW_REQUIRED` |
| 非公开、特殊地点或高敏感内容 | `REVIEW_REQUIRED` 或 `REJECTED` |
| Prohibited Task 类型 | `REJECTED` |
| 需要额外身份 / 资质 | `PENDING`，验证完成后再评估 |

## 15.3 Venue Type

Launch Catalog 可用 Venue Type：

```text
COMMERCIAL_VENUE
PUBLIC_EVENT_VENUE
EXHIBITION_VENUE
BUSINESS_OFFICE
PUBLIC_PLACE
```

默认禁止：

```text
PRIVATE_RESIDENCE
ISOLATED_UNVERIFIED_LOCATION
HIGH_VALUE_STORAGE_AREA
UNCONTROLLED_NIGHT_LOCATION
```

## 15.4 Location Visibility

| 阶段 | 可见信息 |
|---|---|
| Catalog / Draft | Venue type、区域、Approx location |
| Valid Task / Candidate | Task-relevant area、Approx distance、Travel feasibility |
| Invite / Offer | 必要的 venue summary，不默认给精确私人地址 |
| Valid Order | 允许 Purpose、TTL 和 Audit 的精确 meeting point |
| Order Closed | 撤销精确位置、临时联系方式和执行 grant |

## 15.5 Contact Policy

所有模板必须绑定：

```text
CONTACT_BUSINESS_DESIGNATED_PERSON
CONTACT_ORDER_BOUND_ONLY
NO_PERMANENT_PRIVATE_CONTACT
```

不允许在模板中配置：

```text
双方直接交换私人手机号作为默认流程
Order 外的永久地址共享
通过 Trusted Relationship 永久保留位置访问
```

## 15.6 Prohibited Task 检查

Task Builder 在下列任何输入出现时，必须阻止 Commit 或进入 Review：

```text
cash handling
high-value item handling
medical / legal / financial advice
contract signing
private residence without approved policy
unverified isolated location
force / security duty
identity document transport or custody
```

不能通过把 Role 改名为 `EVENT_ASSISTANT` 规避 ProhibitedTaskPolicy。

---

# 16. Check-in / Execution Binding

## 16.1 Check-in 方法

Launch Catalog 可绑定：

```text
QR_CHECKIN
REQUESTER_CONFIRM
GPS_ASSISTED_CHECKIN
```

P0 不要求持续 GPS。`EN_ROUTE` 也不等于持续位置监控。

## 16.2 Role 默认 Check-in

| Role | 默认 Check-in | 备选 | 备注 |
|---|---|---|---|
| GREETER | QR / Requester Confirm | GPS assisted | 公开商业场地优先 |
| EVENT_ASSISTANT | QR / Requester Confirm | GPS assisted | 大型活动需现场联系人 |
| INTERPRETER | Requester Confirm / QR | GPS assisted | 不需要持续追踪 |
| SITE_VISIT_REP | QR / Requester Confirm | GPS assisted | 需更强访问证据 |
| BUSINESS_ASSISTANT | Requester Confirm / QR | GPS assisted | 会议场景优先人工确认 |

## 16.3 No-show

Template 必须绑定 No-show 语义：

```text
Agent No-show
Requester No-show
Late / Grace
Safety / Reasonable Safe Exit
```

不能因为单一 GPS 信号失败就直接判定 Agent No-show。应结合：

```text
Check-in signal
Requester confirmation
Order Chat / contact attempt
time window
Execution Exception
```

Chapter 23 定义具体 grace window 和 compensation；本章只绑定 policy ref。

## 16.4 Deliverable 与 Completion

Template 必须指定：

```text
required evidence
completion confirmation actor
auto-confirm eligibility
exception path
```

默认不允许：

```text
无 Check-in、无 Evidence、无 Confirmation 直接标记完成
```

---

# 17. Matching Policy Binding

## 17.1 统一 Pipeline

所有 Template 都使用：

```text
TaskSlot
↓
Requirement Resolution
↓
Account / Safety / Permission Gate
↓
Role / Capability Eligibility
↓
Verification Gate
↓
Availability Gate
↓
Time / Location Feasibility
↓
Schedule Conflict
↓
Agent Preference
↓
Qualified Pool
↓
Organic Ranking
↓
Sponsored Adjustment
↓
Finite Candidate Set
↓
Invite / Offer
```

## 17.2 Template 不能绕过 Hard Eligibility

任何 Template 都不得把以下字段配置成资格旁路：

```text
Boost
Repeat
Popularity
TrustedRelationship
AI recommendation
Requester preference
```

它们最多影响合格候选人的排序、解释和曝光。

## 17.3 Multi-slot Template

Event Team Template 必须支持：

```text
SlotGroup
→ N atomic TaskSlot
→ each Slot independent MatchAttempt
→ each Slot max 1 active Order
```

部分填充时：

```text
filled Slot 继续履约
unfilled Slot 继续匹配 / replacement / cancel
```

不能因为一个 Slot 失败就把全部成功 Slot 自动标记失败。

## 17.4 Candidate Set

Template 可以引用 CandidateSetPolicy，但不能硬编码页面显示人数。

```text
CandidateSetPolicy
→ concrete value in Chapter 23
```

Requester 只看有限 Candidate Set，不看整个 Qualified Pool。

---

# 18. Cancellation / Replacement Binding

## 18.1 Policy Ref

Launch Template 使用以下 Policy Ref：

```text
CANCEL_STANDARD_BUSINESS_SHIFT_V1
CANCEL_HOURLY_SUPPORT_V1
CANCEL_REVIEW_REQUIRED_SUPPORT_V1
```

具体窗口、退款比例、Agent compensation、grace period 和 evidence 要求进入 Chapter 23。

## 18.2 Safe Exit

以下情况不能默认归类为普通 Agent Fault：

```text
unsafe environment
material mismatch
illegal request during execution
request exceeds agreed scope
location / contact safety issue
```

Template 必须提供：

```text
Request Safe Exit
Open Incident
ExecutionException
Operator Support
```

## 18.3 Replacement

Replacement 的 Catalog 行为：

```text
same TaskSlot
new MatchAttempt
new Offer
new Order if accepted
same Task context with version / policy checks
```

不创建 Replacement Slot，也不复用已取消 Order 的历史状态。

---

# 19. Business Template 与运营配置

## 19.1 BusinessTaskTemplate 来源

Business 可以从 Launch Template 创建自己的 `BusinessTaskTemplate`，但只能保存允许的配置字段：

```text
场景
Role / Slot default
Must / Nice within allowed range
Deliverable wording within policy
Venue reference
Schedule shape
Budget hint
```

不能保存或复用：

```text
精确私人地址作为公开默认
付款凭据
KYC / D5 数据
绕过 Safety 的自由文本
被禁止的能力要求
```

## 19.2 Template Version

Business Template 变更必须生成新版本或明确 Draft 版本：

```text
BusinessTaskTemplate v1
→ duplicate / edit
→ v2 Draft
→ validation
→ Active
```

已创建 Task 不会被模板后续修改影响。

## 19.3 Operator 配置权限

Operator 可以：

```text
review template
pause activation
assist replacement
request correction
view graph / policy gap
```

Operator 不能：

```text
直接修改 Role qualification
直接替 Agent accept
直接删除 Evidence
直接修改 CompensationTerms 历史
直接改 Ledger
```

---

# 20. 首发 Cell 设计

## 20.1 Cell 定义

```text
LiquidityCell = GeoCell × Role × TimeBand × Scenario
```

例如：

```text
Downtown Corridor × GREETER × Weekend Evening × Grand Opening
```

Cell 不是新的交易对象，而是 Launch Operations 和 Supply / Demand Analytics 的配置维度。

## 20.2 Cell Activation 记录

每个 Cell 必须有：

```text
geo_cell_id
role_id
scenario_id
time_band_id
status
qualified_supply_count
verified_supply_count
available_supply_count
anchor_demand_count
operator_coverage_status
safety_gate_status
last_reviewed_at
```

其中 count 只是运营 Read Model，不是 Eligibility 的唯一依据。

## 20.3 Cell 开放顺序

```text
Graph / Catalog Ready
→ Supply Seed
→ Anchor Demand
→ Operator Coverage
→ Pilot
→ Real Execution Review
→ Active
```

## 20.4 Cell 暂停条件

出现以下任意情况时，可以暂停 Cell 新 Task：

```text
无足够 Qualified Supply
连续无法完成真实执行
P0 Safety incident 未处理
Payment / Settlement integrity blocker
Provider outage 影响 Check-in 或资金
Operator coverage 缺失
模板 / Policy 版本错误
```

暂停只阻止新 Task，不得静默取消已有 Order。已有 Order 按 Safety / Cancellation / Provider degraded mode 处理。

---

# 21. Launch Catalog API / Read Model Boundary

## 21.1 Query

页面与 Task Builder 至少需要：

```text
GetLaunchCatalog
GetCatalogVersion
ListActiveIndustries
ListActiveScenarios
ListActiveRoles
GetScenarioTemplate
GetRoleRequirements
GetTemplatePolicySummary
GetCatalogActivation
ResolveTaskRequirements
ValidateTaskAgainstCatalog
```

## 21.2 Command

Catalog 与 Activation 的高影响写操作使用：

```text
CreateCatalogDraft
SubmitCatalogReview
ApproveCatalogVersion
ActivateCatalogCell
PauseCatalogCell
RetireCatalogVersion
CreateScenarioTemplate
UpdateScenarioTemplate
ApproveScenarioTemplate
```

这些不是用户交易 Command；它们的 Actor、权限和审计主体是 Product / Graph / Safety / Operations 管理角色。

## 21.3 Task 侧 Command

用户消费 Catalog 时仍使用 Marketplace Command：

```text
CreateTaskDraft
ResolveRequirements
CommitTask
```

Catalog 不能让 UI 直接调用：

```text
PATCH task.role_id
PATCH task.risk_class
PATCH slot.quantity
```

## 21.4 Read Model 必备字段

Catalog Read Model 至少返回：

```text
catalog_version
template_version
available_actions
requester_type eligibility
supported venue types
must / nice summary
verification summary
pricing mode and unit
risk / admission summary
evidence summary
policy references
activation status
explanation when unavailable
```

---

# 22. Catalog 变更与快照

## 22.1 任何影响履约的变化都要新版本

以下变化必须新建 Catalog / Template Version：

```text
Role meaning
Must Capability
Verification threshold
Deliverable
Evidence Requirement
Pricing mode / unit
Venue type
Risk class
Check-in method
Cancellation / Matching binding
Requester type availability
```

## 22.2 不允许原地修改

禁止：

```text
修改 Active Template 的 Must Capability 并覆盖旧版本
修改当前 Task 读取的价格默认值
修改已发 Offer 的 Evidence Requirement
修改已存在 Order 的 Venue Policy
```

正确做法：

```text
Draft v2
→ Review
→ Approve
→ Activate for new Tasks
```

## 22.3 Existing Transaction Protection

已有对象保存必要快照：

```text
TaskNeedProfile snapshot
CompensationTerms snapshot
EvidencePolicy snapshot
Risk / Admission policy reference
Catalog / Graph / Policy version
```

新版本只影响：

```text
new Task Draft
new MatchAttempt when explicitly re-resolved
new Offer / Replacement after policy permits
```

---

# 23. 首发运营使用顺序

## 23.1 Stage 0 — Catalog / Graph Seed

完成：

```text
2 Scenario Family
5 Role definitions
至少 20 个可用 Atomic Capability
5 个核心 Deliverable
5 个 Evidence Template
Policy bindings
Prohibited Task rules
```

## 23.2 Stage 1 — Controlled Business Pilot

推荐先激活：

```text
TPL_EVENT_GREETER_TEAM
TPL_EVENT_SUPPORT_TEAM
TPL_RETAIL_PROMOTION_TEAM
TPL_ONSITE_INTERPRETER
```

但每个 Template 仍按 Geo × Role × Time Cell 单独打开。

## 23.3 Stage 2 — Evaluate Real Execution

观察：

```text
Qualified → Offer response
Offer → Order conversion
Order → Arrival
Arrival → Deliverable completion
Completion → Settlement
Replacement rate
Requester repeat
Agent repeat availability
Safety / mismatch rate
```

## 23.4 Stage 3 — Expand

只有当已有 Cell 通过 Gate，才允许：

```text
增加 Role
增加 Scenario Template
增加 Geo Cell
开放 Individual Template
降低人工 Review 比例
```

不得以“已经有很多注册用户”为扩张条件。

---

# 24. Catalog 管理权限

| Action | Product / Catalog | Graph Governance | Safety | Marketplace Ops | Operator |
|---|---:|---:|---:|---:|---:|
| Create Draft | ✓ | — | — | — | — |
| Edit Capability Requirement | ✓ | ✓ | review | — | — |
| Edit Risk / Prohibited Rule | — | — | ✓ | review | — |
| Bind Matching Policy | ✓ | review | — | ✓ | — |
| Bind Cancellation Policy | ✓ | — | review | ✓ | — |
| Approve Template | ✓ | ✓ | ✓ when risk relevant | ✓ | — |
| Activate Cell | — | — | gate | ✓ | — |
| Pause Cell | — | — | ✓ safety reason | ✓ | ✓ assist / propose |
| Retire Version | ✓ | ✓ | ✓ if safety impact | ✓ | — |
| Modify Existing Task | — | — | — | Domain Command only | Domain Command only |

权限名最终进入 Business / Operator Permission Contract；本表表达职责边界，不替代最终授权系统。

---

# 25. Catalog 数据质量规则

## 25.1 完整性

一个可被 `APPROVED` 的 Template 必须有：

```text
至少一个 Scenario
至少一个 Role
至少一个 Slot Group
至少一个 Must Requirement
至少一个 Deliverable
至少一个 Evidence Requirement
至少一个 Pricing Mode
至少一个 Venue Type
Risk / Admission binding
Check-in binding
Cancellation binding
Matching binding
```

## 25.2 一致性

系统必须阻止：

```text
Role 不支持该 Scenario
Capability 不存在于 Graph Version
Must Capability 同时被标记为禁止
Template pricing mode 不在 Role allowed modes
Venue type 与 Risk Policy 冲突
Evidence 被标记 REQUIRED 但没有上传 / 确认方式
Individual requester 使用仅 Business 的 Template
PILOT_ONLY Template 被公开 Task Builder 返回
RETIRED Catalog 被新 Task 使用
```

## 25.3 可解释性

当 Template / Role 不可用时，Read Model 必须返回可解释原因：

```text
ROLE_NOT_ACTIVE_IN_CELL
NO_QUALIFIED_SUPPLY
VERIFICATION_REQUIRED
VENUE_NOT_ALLOWED
REQUESTER_TYPE_NOT_ALLOWED
TASK_ADMISSION_REVIEW_REQUIRED
CATALOG_PAUSED
PROVIDER_NOT_READY
```

不能只返回：

```text
NOT_AVAILABLE
```

---

# 26. Catalog 级验收标准

## AC-22-01 Narrow Launch

Given Catalog Version 处于首发状态，  
When Product 读取可用目录，  
Then返回的 Scenario、Role、Template 必须受 Market、Geo Cell、Time Band 和 Activation 限制，不得返回全量未来目录。

## AC-22-02 Version Snapshot

Given 用户使用 Template 创建 Task，  
When Task Draft 被解析或 Commit，  
Then必须保存 Catalog、Template、Graph 和 Policy version reference。

## AC-22-03 Role Limit

Given Launch Catalog 进入 Pilot，  
When Operations 选择首发 Role，  
Then单个首发 Cell 不得无控制地开放超过配置上限的 Role，默认建议不超过 3–5 个。

## AC-22-04 Role Qualification

Given Agent 只有某个 Role 的自我描述，  
When Template 要求更高 Verification，  
Then Agent 不得进入该 Template 的 Qualified Pool，必须显示缺失的验证要求。

## AC-22-05 Must / Nice

Given Agent 缺少 Nice Capability 但满足全部 Must Capability，  
When Matching 运行，  
Then Agent 可以进入 Qualified Pool，Nice 只影响排序或解释。

## AC-22-06 Must Block

Given Agent 缺少一个 Must Capability，  
When Matching 运行，  
Then Agent 不得进入 Qualified Pool，不得通过 Boost、Trusted 或 AI 进入候选集。

## AC-22-07 Atomic Slots

Given Template 定义 `GREETER ×3`，  
When Task Draft 解析完成，  
Then必须创建三个独立 TaskSlot，每个 Slot 可以独立 Match、Order、Completion 和 Replacement。

## AC-22-08 Compensation Binding

Given Template 使用批量 Slot Group，  
When Task Commit 前生成报价，  
Then每个 TaskSlot 必须拥有独立 CompensationTerms，不能只有一个 Task-level price。

## AC-22-09 Pricing Scope

Given Launch Template 处于 P0，  
When用户查看 Pricing Mode，  
Then只能返回 FIXED 或 HOURLY；不得出现公开竞价或无上限 Custom Quote。

## AC-22-10 Evidence Completeness

Given Template 定义 Required Evidence，  
When Agent 提交 Completion，  
Then系统必须检查对应 Evidence / Confirmation；缺失时不能直接进入完成确认。

## AC-22-11 Privacy Default

Given Template 使用 Commercial Venue 或 Business Office，  
When Candidate 或 Offer 页面读取地点，  
Then只能返回任务相关的地点摘要；精确 meeting point 需 Valid Order + Purpose + TTL。

## AC-22-12 Prohibited Task

Given Requester 在 Template 中加入现金、高价值物品、法律 / 医疗 / 金融建议或住宅要求，  
When系统执行 Catalog / Admission 校验，  
Then必须阻止 Commit 或进入明确 Review，不能通过改写 Role 绕过。

## AC-22-13 Individual Boundary

Given Individual Requester 选择一个 Business-only Template，  
When用户查看 Launch Catalog，  
Then Template 不得返回为可用；若通过 Deep Link 访问，服务端必须拒绝。

## AC-22-14 Cell Gate

Given Geo × Role × Time Cell 没有最低 Qualified Supply 或 Operator Coverage，  
When用户创建 Task，  
Then Cell 不得进入 Active Matching，页面必须显示供给 / 运营不可用原因。

## AC-22-15 Paused Cell

Given Cell 被暂停，  
When已有 Order 继续执行，  
Then暂停只阻止新 Task / 新 Offer，不得静默取消已有 Order；既有交易按自己的 Policy Snapshot 继续。

## AC-22-16 Catalog Update Isolation

Given Template v2 修改了 Must Capability 或 Evidence，  
When已有 Task 使用 Template v1，  
Then已有 Task 不得被静默修改；只有新 Draft 或明确重新解析的流程使用 v2。

## AC-22-17 Role Transfer Boundary

Given Agent 具备 `CAP_SECOND_LANGUAGE_CONVERSATION`，  
When Template 要求 `CAP_ORAL_INTERPRETATION`，  
Then系统不得自动认为两者相等，除非 Graph 有明确边和验证规则。

## AC-22-18 Check-in Privacy

Given Template 只要求 QR 或 Requester Confirm，  
When Agent 执行 Task，  
Then系统不得为了方便而自动开启持续 GPS 追踪。

## AC-22-19 Operator Boundary

Given Operator 发现 Template 或 Cell 不可用，  
When Operator 处理异常，  
Then只能暂停、提交 Review、发起受控 Command 或创建 Case，不能直接改 Role qualification、Evidence 或 Ledger。

## AC-22-20 Catalog Explainability

Given Template 未被返回给用户，  
When客户端读取不可用原因，  
Then必须返回结构化 reason code 和可理解的解释，不得只返回通用错误。

---

# 27. 本章锁定结论

## 27.1 首发 Catalog

```text
2 Scenario Family
5 Launch Role
7 个核心 Template
有限 Industry
有限 Geo × Role × Time Cell
```

## 27.2 首发推荐激活

```text
GREETER
EVENT_ASSISTANT
INTERPRETER
```

推荐先跑：

```text
TPL_EVENT_GREETER_TEAM
TPL_EVENT_SUPPORT_TEAM
TPL_RETAIL_PROMOTION_TEAM
TPL_ONSITE_INTERPRETER
```

`SITE_VISIT_REP` 和 `BUSINESS_ASSISTANT` 先保留为受控 Pilot，待真实执行和安全数据证明后扩展。

## 27.3 每个 Template 必须绑定

```text
Role
Atomic Capability
Must / Nice
Verification
Deliverable
Evidence
Pricing Unit
Risk Class
Check-in
Location Type
Cancellation Policy
Matching Policy
```

缺一项就不能进入 `APPROVED`，更不能进入 `ACTIVE`。

## 27.4 本章没有硬编码的内容

```text
具体城市
具体金额
具体 TTL
具体 Wave Size
具体 Refund Ratio
具体 KYC Provider
具体 Map / Payment Provider
```

这些内容必须在后续配置和工程合同中显式出现，禁止工程人员自行猜测。

## 27.5 下一章

下一步进入：

```text
Chapter 23 — Policy Defaults / Configuration Registry
```

Chapter 23 必须为本章引用的 Policy Ref 提供具体的、可版本化、可快照绑定的默认值：

```text
Matching
Availability
Pricing
Payment
Cancellation
No-show
Safety
Location
Evidence
Notification
Business
Operator
```

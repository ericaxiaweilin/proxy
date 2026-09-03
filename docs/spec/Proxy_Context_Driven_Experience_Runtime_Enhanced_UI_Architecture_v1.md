# Proxy Context-Driven Experience Runtime
## 增强 UI / 动态体验架构设计文档 v1.0

**文档状态**：Architecture Review Draft  
**适用阶段**：当前仍处于基础功能与架构评审阶段，本文定义目标架构与边界，不要求立即工程实施。  
**关联系统**：Proxy Decision Engine / Context Field / Surface Composition / Realtime Update  

> **核心结论：前端不再拥有“页面”，前端拥有“表达能力”；页面由后台根据用户、世界与市场状态实时编译出来。**

---

# 1. 文档目的

Proxy 当前已经形成 `Context Field → Decision Engine → SurfacePlan` 的数据驱动链路，但如果 UI 只能在一组预制页面和预制卡片之间切换，就无法完整承接 Decision Engine 未来产生的大量新场景。

例如“下雨”最初可以映射为 `fast_delivery` 模块提权，但当 Context 同时包含暴雨、下班、交通拥堵、配送紧张、附近餐厅排队、用户时间预算等信息时，系统真正想表达的体验可能是一个产品团队从未预先设计过的新组合。

本文的目标是把原来的 **Server-Driven UI / 后端热更新 UI** 升级为：

> **Context-Driven Experience Runtime**

它必须同时满足：

- 前端保持轻、稳定、高性能；
- 后台可以实时改变内容、布局、模块和表达结构；
- 新场景不必都依赖客户端发版；
- 不允许后台直接生成任意 HTML / CSS / JavaScript；
- 所有动态 UI 都必须可验证、可审计、可回滚、可降级；
- Native 组件与动态组合可以长期共存；
- 高频动态结构可以从 Primitive Composition 晋升为 Native Experience Component。

---

# 2. 从 Server-Driven UI 到 Context-Driven Experience Runtime

传统 Server-Driven UI 通常解决：

```text
后台配置变化
↓
返回不同模块 / 排序 / 内容
↓
客户端渲染已有组件
```

这足以解决“模块开关、排序、运营位”等问题，但不足以承接 Proxy 的 Context Field。

Proxy 的目标链路应升级为：

```text
World / User / Market
        ↓
Context Field
        ↓
Decision Engine
        ↓
Experience Intent
        ↓
Experience Orchestrator
        ↓
Surface Compiler
     ↙             ↘
Native Component   Primitive Composition
        ↓
SurfacePlan
        ↓
Realtime Delta
        ↓
Frontend Runtime Renderer
```

这里最重要的变化是：

- **Decision Engine 不直接控制 UI**；
- **Experience Intent 是决策和表达之间的稳定语义层**；
- **Surface Compiler 决定怎样表达，而不是 Decision Model 决定怎样画**；
- **Frontend Runtime 只执行经过校验的 UI Schema / SurfacePlan**。

---

# 3. 设计原则

## 3.1 Generative Composition，不是 Generative HTML

允许：

```json
{
  "type": "stack",
  "children": [
    {"type": "title", "text": "雨势正在变大"},
    {"type": "eta", "value_min": 64},
    {"type": "merchant_list", "source": "candidate_set_82"}
  ]
}
```

禁止：

```html
<script>
  // backend generated arbitrary code
</script>
```

后台生成的是**受约束的表达结构**，而不是任意可执行代码。

## 3.2 前端拥有能力，不拥有最终页面

客户端预先实现：

- 可稳定执行的 Native Components；
- 通用 UI Primitives；
- Layout / Interaction / State Runtime；
- Schema Validator；
- Delta Patcher；
- Capability Registry。

后台拥有：

- Experience Intent；
- Surface Policy；
- Composition；
- SurfacePlan；
- Delta；
- Fallback Plan。

## 3.3 数据变化不等于 UI 必须变化

任何 Context Change 都必须先经过：

```text
Context Change
↓
Decision Recompute
↓
Human Value / Intervention Budget
↓
Experience Eligibility
↓
Surface Change
```

例如“开始下小雨”不代表必须弹窗。只有当变化对当前任务/用户获得感足够重要时，才允许改变 Surface。

## 3.4 先组合，后抽象

UI 的演化遵循与 Tag 相同的思想：

```text
先允许具体组合
↓
观察真实场景和使用数据
↓
发现稳定高频结构
↓
固化为 Native Experience Component
```

而不是产品经理预先猜 100 种场景并设计 100 张卡片。

---

# 4. 三层 UI 能力模型

## 4.1 Layer 1：Native Domain Components

这是预先实现、稳定、高性能、强业务语义的组件。

典型组件：

```text
PostCard
MerchantCard
CouponCard
Map
Profile
NeedCard
OfferCard
CompanionCard
ReservationCard
ProductCard
ServiceCard
RouteCard
PaymentSummary
```

Native Domain Component 的特点：

- 业务语义明确；
- 有成熟视觉与交互；
- 性能和可访问性可深度优化；
- 适合高频稳定场景；
- 由客户端版本管理；
- 后端只传数据和配置，不改变其核心交互语义。

## 4.2 Layer 2：UI Primitives

这是动态体验真正需要补齐的层。

### 基础表达

```text
Text
Title
Subtitle
Image
Icon
Badge
Divider
Spacer
```

### 布局

```text
Row
Column
Stack
Grid
List
Carousel
Section
Slot
```

### 状态 / 数值

```text
Price
Distance
ETA
Countdown
Status
Progress
Score
Availability
```

### Action

```text
PrimaryAction
SecondaryAction
Choice
Chip
Toggle
Confirm
Dismiss
```

### 业务引用 Primitive

```text
Map
Route
Merchant
Person
Offer
Coupon
Place
Need
Reservation
```

### 输入

```text
Input
Select
DateTimeChoice
Quantity
LocationChoice
Confirm
```

### 提示

```text
Alert
Notice
InlineMessage
Warning
Success
EmptyState
```

这些 Primitive 不代表最终产品页面，它们是 Surface Compiler 可以安全组合的“语言词汇”。

## 4.3 Layer 3：Promoted Native Experience Components

当某个 Primitive Composition 被证明：

- 高频出现；
- 结构长期稳定；
- 具备明显性能收益；
- 需要复杂本地交互；
- 需要动画、缓存或硬件能力；
- 业务指标明显优于通用组合；

就可以晋升为 Native Experience Component。

例如：

```text
Heavy Rain + Commute + Meal
↓
长期出现且使用量高
↓
RainCommuteCard / RainAfterWorkPanel
```

因此三层不是互相替代，而是长期并存：

```text
Native Domain Components
       +
UI Primitives
       +
Promoted Native Experiences
```

---

# 5. 更新能力梯度：L0-L4

原来的“热更新”应升级为 **五级更新梯度**（L0 到 L4）。

| Level | 类型 | 示例 | 是否需要客户端发版 |
|---|---|---|---|
| L0 | Data Update | ETA 31m → 64m、库存 8 → 3 | 否 |
| L1 | Content Update | 卡片文本、价格、状态更新 | 否 |
| L2 | Composition Update | 模块增删、排序、密度、hero/compact | 否 |
| L3 | Primitive UI Generation | 用 Primitive 组合一个从未存在过的表达结构 | 否 |
| L4 | New Native Capability | AR、新支付控件、新视频编辑器、新硬件能力 | 是 |

关键边界：

> **L0-L3 都可以通过后端实时更新；只有客户端根本不具备某种能力时，才进入 L4。**

---

# 6. Experience Intent：Decision 与 UI 之间的语义层

Decision Engine 不应该返回：

```text
show_rain_popup
```

应该返回更加稳定的体验意图：

```json
{
  "experience_intent": {
    "type": "HELP_USER_HANDLE_RAIN_AFTER_WORK",
    "priority": 0.82,
    "intervention": "SOFT_NUDGE",
    "objective": "REDUCE_TIME_AND_DECISION_COST",
    "expires_in_s": 900
  }
}
```

Experience Intent 只描述：

- 系统现在想帮助用户完成什么；
- 为什么现在值得表达；
- 主动程度；
- 生命周期；
- 允许使用哪些数据域；
- 是否允许交互；
- 是否存在强制 guardrail。

它不描述具体 UI。

建议核心字段：

```text
intent_id
type
objective
priority
intervention_level
context_snapshot_id
decision_id
allowed_actions
forbidden_actions
required_information
expires_at
reason_codes
```

---

# 7. Experience Orchestrator

Experience Orchestrator 负责把 `Experience Intent` 转成表达方案。

输入：

```text
Experience Intent
Client Capability
Current Surface State
Registered Native Components
Primitive Registry
Surface Policy
User Interaction State
```

输出：

```text
SurfacePlan
```

基本策略：

```text
Experience Intent
↓
是否有匹配的成熟 Native Experience？
├ Yes → Native Plan
└ No
   ↓
   Primitive Composer
   ↓
   UI Schema
↓
Capability Check
↓
Policy / Safety Validation
↓
SurfacePlan
```

它必须和 Decision Engine 分离，原因是：

- 同一个 Decision 可以在 Feed、Map、Merchant、Notification 中有不同表达；
- UI 版本演进不应该改变决策模型；
- 设计系统变化不应该重训模型；
- 表达失败不应该污染 Intent 判断。

---

# 8. Surface Compiler

Surface Compiler 是后端“体验编译器”。

它不运行任意代码，而是将受约束 Schema 编译成客户端可执行 SurfacePlan。

编译步骤：

```text
Experience Intent
↓
Select Pattern / Native Candidate
↓
Resolve Data Bindings
↓
Compose UI Schema
↓
Validate Schema
↓
Check Client Capability
↓
Apply Surface Policy
↓
Apply Human Value / Intervention Constraints
↓
Compile SurfacePlan
↓
Generate Delta vs current Surface
```

Compiler 必须保证：

- 每个 node 类型存在于 Registry；
- 属性类型正确；
- 深度、节点数、图片数、交互数受限制；
- Action 必须来自允许的 Action Registry；
- 不允许脚本；
- 不允许未知网络请求；
- 不允许绕过 Permission / Privacy / Payment Policy；
- 必须生成可追踪的 `surface_plan_id`。

---

# 9. UI Schema

推荐把 UI Schema 设计为 declarative tree。

示例：

```json
{
  "schema_version": "ui_schema_v3",
  "root": {
    "type": "stack",
    "props": {
      "spacing": "m"
    },
    "children": [
      {
        "type": "alert",
        "props": {
          "level": "context",
          "text": "雨势正在变大"
        }
      },
      {
        "type": "text",
        "props": {
          "text": "现在回家预计 64 分钟"
        }
      },
      {
        "type": "grid",
        "props": {"columns": 2},
        "children": [
          {
            "type": "metric",
            "props": {"label": "附近吃饭", "value": "3个选择"}
          },
          {
            "type": "metric",
            "props": {"label": "直接配送", "value": "25–40分钟"}
          }
        ]
      },
      {
        "type": "merchant_list",
        "data_ref": "candidate_set_82",
        "props": {"limit": 3}
      },
      {
        "type": "primary_action",
        "props": {
          "label": "看看最快方案",
          "action_id": "open_fastest_plan"
        }
      }
    ]
  }
}
```

## 9.1 Schema 限制建议

每个 Schema 至少约束：

```text
max_depth
max_nodes
max_actions
max_images
max_lists
max_remote_data_refs
max_text_length
allowed_component_types
allowed_action_types
```

避免“逻辑正确但 UI 无限膨胀”。

---

# 10. SurfacePlan

SurfacePlan 是客户端最终执行对象。

建议结构：

```json
{
  "surface_plan_id": "sp_185",
  "surface_id": "home",
  "surface_version": 185,
  "decision_id": "dec_82A1",
  "experience_intent_id": "exp_rain_31",
  "context_snapshot_id": "ctx_1842",

  "render_mode": "PRIMITIVE_COMPOSITION",
  "native_component": null,
  "schema_ref": "uis_8821",

  "slots": {
    "top_context": ["node_rain_31"],
    "primary": ["nearby_meal", "fast_delivery"],
    "secondary": ["coupon_wallet"]
  },

  "ttl_s": 600,
  "fallback_plan_id": "fb_92",
  "policy_version": "surface_policy_v5"
}
```

客户端原则：

> **客户端只能执行 SurfacePlan，不允许因为本地猜测自行把 PASSIVE 升级成 PUSH、POPUP 或强制 Modal。**

---

# 11. Client Capability Protocol

为了真正做到 Backend Forward-Compatible UI，客户端必须主动告诉后台“我会什么”。

启动 / session 建立时：

```json
{
  "client_version": "2.7.1",
  "platform": "ios",
  "ui_runtime_version": "3.2",

  "capabilities": [
    "stack:v3",
    "grid:v2",
    "merchant_card:v5",
    "map:v4",
    "route:v2",
    "choice:v3",
    "coupon:v4",
    "delta_patch:v2"
  ],

  "limits": {
    "max_schema_depth": 8,
    "max_nodes": 80,
    "supports_stream_delta": true
  }
}
```

后台流程：

```text
Experience Plan Candidate
↓
Capability Check
├ Fully Supported → Rich Surface
├ Partially Supported → Degraded Composition
└ Unsupported → Generic Native Fallback
```

Capability 必须 versioned，例如：

```text
map:v4
route:v2
merchant_card:v5
```

不能只写 `supports_map=true`，否则无法处理协议演进。

---

# 12. Realtime Delta：后端更新 → 前端马上更新

旧模式：

```text
Backend updated
↓
Frontend refetch full Surface
↓
full rerender
```

目标模式：

```text
Context Changed
↓
Decision Recompute
↓
Experience Recompile
↓
SurfacePlan v184 → v185
↓
Plan Delta
↓
Frontend Delta Patcher
↓
只更新受影响区域
```

示例：

```json
{
  "surface_id": "home",
  "base_version": 184,
  "new_version": 185,
  "delta_id": "delta_981",

  "operations": [
    {
      "op": "insert",
      "slot": "top_context",
      "node": "rain_context_31"
    },
    {
      "op": "update",
      "node": "fast_delivery",
      "patch": {
        "priority": 2,
        "eta": "25–40分钟"
      }
    },
    {
      "op": "remove",
      "node": "outdoor_companion"
    }
  ]
}
```

建议支持操作：

```text
insert
remove
update
move
replace
show
hide
invalidate
```

---

# 13. Delta 版本、顺序与一致性

Realtime UI 最大风险之一不是渲染，而是**状态乱序**。

因此 Delta 必须至少包含：

```text
surface_id
base_version
new_version
delta_id
created_at
expires_at
```

客户端规则：

```text
if local_version == base_version:
    apply delta
else:
    reject delta
    request latest SurfacePlan snapshot
```

禁止：

```text
v184 客户端直接应用 base_version=186 的 patch
```

这避免：

- 网络乱序；
- 断线重连；
- 多设备并发；
- stale context；
- UI 节点被重复 insert/remove。

---

# 14. Realtime Transport

传输方式是实现细节，架构只要求支持实时增量。

可选：

```text
WebSocket
SSE
Push Channel
Long-lived App Connection
```

不同场景可以不同：

- App 前台：WebSocket / SSE；
- App 后台：Push 唤醒 + fetch latest plan；
- 低频 Surface：普通 HTTP pull；
- 高实时场景：持续连接。

关键不是传输协议，而是统一 `SurfacePlan + Delta` 语义。

---

# 15. Frontend Runtime Renderer

前端 Runtime 不只是一个 JSON Renderer，它至少承担：

```text
Schema Validation
Capability Check
Data Binding
Layout
Action Dispatch
Local Interaction State
Delta Patch
Fallback
Telemetry
Accessibility
```

## 15.1 本地交互状态不能被 Delta 粗暴覆盖

例如用户正在：

- 输入文本；
- 选择时间；
- 展开一个商家；
- 浏览 Carousel；

后台 Delta 到达时，不能因为 `SurfacePlan v185` 就把用户操作重置。

因此节点应区分：

```text
server_state
local_ephemeral_state
committed_state
```

默认规则：

> **Delta 更新 server_state，不覆盖仍有效的 local_ephemeral_state，除非节点被明确 invalidate。**

---

# 16. Action Registry

动态 UI 最大风险是“动态按钮能做任何事情”。

因此所有 Action 必须注册：

```text
open_surface
open_merchant
open_map
open_route
apply_coupon
start_match
submit_choice
confirm_reservation
dismiss
refresh
```

每个 Action 定义：

```text
action_id
input_schema
permission
requires_confirmation
risk_level
allowed_surfaces
telemetry_policy
```

支付、身份、位置权限等高风险 Action 必须使用 Native Flow，Primitive UI 只能发起，不能自行实现。

---

# 17. 安全与治理边界

## 17.1 禁止远程执行代码

绝对禁止：

```text
remote JS
remote CSS executable logic
WebView arbitrary HTML
runtime downloaded plugin code
```

## 17.2 Schema Allowlist

只有 Registry 中存在的：

```text
Primitive
Component
Action
Data Binding
```

才允许进入 SurfacePlan。

## 17.3 Human Value Guardrail 继续有效

Context-driven UI 不能绕过：

```text
Explicit Negative
Privacy
Anger Risk
Intervention Budget
Frequency Budget
Safety
Hard Resource Constraint
```

## 17.4 UI 变化本身也是一次 Intervention

需要记录：

```text
surface_change_id
reason
before_version
after_version
changed_nodes
intervention_level
user_response
```

否则未来无法知道：

> 用户是在响应“内容”，还是在响应“页面被系统重新组织”本身。

---

# 18. Fallback Architecture

动态 UI 必须假设任何一层都可能失败。

## 18.1 Capability Fallback

```text
Rich Primitive Composition
↓ unsupported
Simplified Primitive Composition
↓ unsupported
Native Generic Card
↓ unavailable
Current Stable Surface
```

## 18.2 Compiler Fallback

如果 Surface Compiler：

- schema validation failed；
- timeout；
- unknown component；
- policy conflict；

则不能返回半成品 UI。

应返回：

```text
fallback_plan_id
```

## 18.3 Realtime Fallback

Delta 失败：

```text
reject delta
↓
request latest snapshot
↓
render stable SurfacePlan
```

## 18.4 Decision Fallback

如果新的 Context 不够重要：

```text
NO_UI_CHANGE
```

这是非常重要的合法结果。

---

# 19. Primitive → Pattern → Native 的晋升机制

动态组合不是永久形态。

建议建立 Experience Pattern Registry：

```text
Primitive Composition
↓
Pattern Signature
↓
Usage / Stability / Outcome
↓
Promote Candidate
↓
Design Review
↓
Native Experience Component
```

## 19.1 Pattern Signature

例如：

```text
Alert
+ ETA
+ 2-option Grid
+ MerchantList
+ PrimaryAction
```

如果大量不同 Context 重复产生相同结构，可形成 Pattern。

## 19.2 晋升指标

建议观察：

```text
render_count
unique_users
schema_stability
node_variance
interaction_rate
fulfillment_lift
latency
client_cost
error_rate
accessibility issues
```

## 19.3 晋升不是“抽象掉差异”

Native Component 仍然可以接受 Context Data。

例如 `RainCommuteCard` 固化的是交互骨架，不是固定文案、固定商家、固定推荐逻辑。

---

# 20. 完整案例：暴雨下班

## Step 1：Context Change

```text
weather:
  light_rain → heavy_rain

mobility_friction:
  .27 → .72

delivery_capacity:
  .88 → .61

commute_eta:
  31m → 64m
```

生成：

```text
ContextSnapshot v1842
```

## Step 2：Decision Engine

系统不是：

```text
if rain:
    show_rain_popup()
```

而是重新计算：

```text
Gravity
Resource
Supply
Human Value
Intervention Budget
```

得到：

```text
回家出行成本 ↑
附近消费价值 ↑
配送便利价值 ↑
配送供给开始紧张
主动打扰风险可接受
```

Decision：

```json
{
  "action": "SOFT_NUDGE",
  "experience_intent": {
    "type": "HELP_USER_HANDLE_RAIN_AFTER_WORK",
    "objective": "REDUCE_TIME_AND_DECISION_COST"
  }
}
```

## Step 3：Experience Orchestrator

检查：

```text
Native RainCommuteCard available?
```

如果没有：

```text
Primitive Composition
```

生成：

```text
[Alert]
雨势正在变大

[Text]
现在回家预计 64 分钟

[Grid]
附近吃饭        直接配送
3个选择         25–40分钟

[List]
Restaurant A
Restaurant B
Restaurant C

[PrimaryAction]
看看最快方案
```

## Step 4：Surface Compiler

检查：

```text
schema valid
client supports grid:v2
client supports merchant_card:v5
client supports delta_patch:v2
Human Value PASS
```

输出：

```text
SurfacePlan v185
```

## Step 5：Delta

```text
v184 → v185
```

只更新：

```text
insert top_context
update fast_delivery
remove outdoor_companion
```

用户正在浏览的其他区域保持不变。

## Step 6：Outcome

记录：

```text
surface_delta_exposed
user_opened_fastest_plan
merchant_selected
order_committed
fulfilled
```

后续系统可以判断：

- 这个 Experience Intent 是否真正帮助用户；
- 哪种 Primitive Pattern 更有效；
- 是否值得晋升为 Native RainCommuteCard；
- UI 变化是否造成额外 Anger / confusion。

---

# 21. 认知侧与表达侧的对称架构

Proxy 最终形成两条对称链路。

## 认知侧

```text
Facts
↓
Features
↓
Tags / State
↓
Gravity / Intent
↓
Decision
```

## 表达侧

```text
Primitives
↓
Components
↓
Patterns
↓
Surface
↓
Experience
```

两者通过：

```text
Decision
↓
Experience Intent
```

连接。

这使 Proxy 不需要让模型同时承担“判断”和“画 UI”两个完全不同的问题。

---

# 22. 可观测性与核心指标

## 22.1 Compiler / Runtime

```text
surface_compile_p50 / p95 / p99
schema_validation_fail_rate
capability_fallback_rate
delta_apply_success_rate
delta_reject_rate
full_snapshot_recovery_rate
render_error_rate
```

## 22.2 Experience Quality

```text
experience_exposure
experience_engagement
experience_completion
experience_fulfillment
surface_hide / dismiss
interaction_abandonment
UI-induced anger / confusion proxy
```

## 22.3 Dynamic Composition Health

```text
primitive_composition_ratio
native_component_ratio
promoted_pattern_count
schema_node_p95
average_depth
pattern_reuse_rate
```

## 22.4 Realtime Health

```text
delta_delivery_latency
delta_staleness
out_of_order_rate
reconnect_snapshot_rate
surface_version_gap
```

指标目标不能一开始写成行业固定真理，应在真实用户和真实 Surface 上逐步校准。

---

# 23. 性能预算原则

动态 UI 不能让“前台轻”变成 Runtime 很重。

建议架构预算维度：

```text
Surface Compile latency
Schema payload size
Delta payload size
Node count
Image count
Render cost
Memory cost
Main-thread cost
```

初始原则：

- 优先 Delta，而不是 full plan；
- 优先 Native Component 处理复杂高频结构；
- Primitive Composition 控制树深和节点数量；
- 大列表使用业务 Native List / Virtualized List，而不是展开成大量 Primitive；
- Map / Video / Payment 等重能力由 Native Component 承担。

---

# 24. 测试体系

## 24.1 Schema Contract Test

测试：

```text
unknown primitive
invalid props
excess depth
unknown action
unsupported capability
invalid data binding
```

## 24.2 Golden Surface Test

同一：

```text
Experience Intent + Client Capability + Policy Version
```

应产生稳定可复现的 SurfacePlan。

## 24.3 Delta Replay Test

保存：

```text
v184 snapshot
+ delta 185
+ delta 186
```

必须可以完整 replay 到最终状态。

## 24.4 Compatibility Test

测试旧客户端：

```text
client v2.4
missing grid:v2
```

是否正确 fallback。

## 24.5 Human Value Test

测试高频 Context 变化是否导致：

```text
UI jumping
layout thrashing
repeated alert
attention hijacking
```

动态能力越强，越需要防止“页面不停自己变化”。

---

# 25. Anti-Thrashing：防止 UI 频繁跳动

Context 是实时的，但 Surface 不能跟着每个数值抖动。

需要：

```text
change_threshold
minimum_stable_window
surface_cooldown
priority_margin
interaction_lock
```

例如：

```text
rain_probability .48 → .51
```

不应该触发 UI 变化。

而：

```text
commute ETA 31m → 64m
+ heavy rain confirmed
+ delivery capacity falling
```

才可能达到 Experience Change Threshold。

原则：

> **实时数据驱动 ≠ 实时 UI 抖动。**

---

# 26. 权限与隐私

Surface Compiler 只能消费 Decision Engine 已经允许暴露给当前 Surface 的数据。

例如后台内部可能知道：

```text
price_accept_p75
latent affinity
merchant targeting eligibility
```

但 UI Schema 不代表这些字段都可以直接显示。

需要：

```text
Internal Feature
↓
Decision
↓
Presentation-safe Data Projection
↓
Surface Compiler
```

禁止把敏感推断直接变成：

> “因为我们判断你收入较高，所以给你推荐……”

Reason Code 与用户可见 Explanation 应分开管理。

---

# 27. 与 Notification / Push 的关系

Experience Runtime 不等于 App 内页面专用。

同一个 Experience Intent 可以投影到：

```text
In-app Surface
Notification
Push
Widget
Merchant-side task
```

但不同 Channel 必须重新经过 Intervention Policy。

例如：

```text
SOFT_NUDGE
```

可能允许：

```text
Feed insert
```

但不允许：

```text
Push notification
```

所以：

```text
Experience Intent
↓
Channel Policy
↓
Channel-specific Surface Compiler
```

---

# 28. Architecture Freeze 建议

在进入正式工程代码前，建议至少冻结以下稳定边界：

1. `ExperienceIntent` 是 Decision 和 UI 的唯一语义桥梁；
2. `SurfacePlan` 是客户端的正式执行 Contract；
3. 后台只生成受控 UI Schema，不生成任意可执行代码；
4. UI 分为 Native Domain / Primitive / Promoted Native Experience 三层；
5. Client Capability 必须 versioned；
6. Realtime 更新使用 Versioned Delta；
7. Delta 乱序时回退到 full snapshot；
8. Action 必须通过 Action Registry；
9. Context Change 必须经过 Decision / Human Value 后才能改变 UI；
10. Primitive Composition 高频稳定后允许晋升 Native；
11. 本地用户交互状态不能被服务器 Delta 随意覆盖；
12. `NO_UI_CHANGE` 是合法而重要的输出；
13. Privacy / Safety / Explicit Negative / Anger / Intervention Budget 不能被 Surface Policy 绕过。

具体技术选型（WebSocket / SSE、具体 Renderer 框架、数据库、编译实现）可以后置，不需要现在冻结。

---

# 29. 最终目标架构

```text
                 REAL WORLD
        ┌──────────┼──────────┐
        │          │          │
      User       World      Market
        └──────────┼──────────┘
                   ↓
             Context Field
                   ↓
             Decision Engine
                   ↓
            Experience Intent
                   ↓
         Experience Orchestrator
                   ↓
             Surface Compiler
          ┌────────┴────────┐
          │                 │
  Native Components   UI Primitives
          │                 │
          └────────┬────────┘
                   ↓
               SurfacePlan
                   ↓
             Versioned Delta
                   ↓
          Frontend UI Runtime
                   ↓
               Experience
                   ↓
        Interaction / Fulfillment
                   ↓
                Outcome
                   ↺
```

最终产品原则：

> **前端不再拥有页面，前端拥有表达能力。**

> **后台不直接“画页面”，后台根据现实世界和用户状态编译 Experience。**

> **不是 Generative HTML，而是 Governed Generative Composition。**

> **数据越动态，表达越灵活；表达越灵活，约束、版本、审计和 Fallback 必须越严格。**

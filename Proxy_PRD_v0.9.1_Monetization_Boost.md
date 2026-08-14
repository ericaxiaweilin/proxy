# Proxy 产品需求文档 PRD v0.9
## Map + Availability + Marketplace Liquidity

**状态**：Prototype-ready  
**本版核心新增**：地图供需层、Agent 挂空闲、Availability Session、Liquidity Cell、Demand Pulse、分级定位权限、Map-driven Match Orchestration。

---

## 0. 本版核心结论

Proxy 不应该把地图做成“附近的人”，也不应该把 Agent 的 Online 状态做成社交产品式“在线”。

本版定义：

> **Map = 实时供需与任务执行界面。**  
> **Availability = Agent 把自己的时间、位置范围、能力和价格偏好变成平台可调度的 Supply Capacity。**

完整链路：

```text
Demand
→ Location / Time / Role
→ Liquidity Cell
→ Qualified Supply Capacity
→ Match Mode
→ Candidate / Dispatch
→ Order
→ Execution Location
→ Outcome
```

长期原则仍然是：

> **Task first, people second.**

---

## 1. 产品北极星

Proxy 的核心能力：

> **Task-conditioned Human Matching + Real-time Human Availability**

平台必须同时理解：

- 任务需要什么人；
- 什么时间有空；
- 什么区域能到；
- Agent 是否愿意接这种任务；
- 最低报酬；
- 实际履约结果。

长期数据资产：

```text
Task × Requirement × Time × Location × Capability × Availability × Price × Outcome
```

---

## 2. Marketplace 最小单位：Liquidity Cell

定义：

```text
Area × Time Window × Role / Capability
```

例如：

```text
Tây Hồ × Saturday 18:00–22:00 × English Greeter
```

每个 Cell 计算：

- Open Slots
- Qualified Supply
- Available-now Supply
- Scheduled Supply
- Expected Acceptance Rate
- Median Response Time
- Estimated Fill Probability
- Median Pay
- Supply / Demand Ratio

Requester 只看到：
- 当前供给充足/紧张；
- 预计匹配时间；
- Qualified Supply 数量区间；
- 区域供给热度。

Agent 只看到：
- Demand High / Medium / Low；
- 适合自己的任务缺口；
- 典型报价；
- 当前距离。

---

## 3. 三种地图

### 3.1 Requester Supply Map

用途：理解“在哪里有供给”。

可以显示：
- 匿名 Supply Heat；
- Qualified Capacity；
- 预计匹配时间；
- 当前搜索半径；
- 扩大范围后的供给变化。

禁止：
- Agent 头像地图；
- 精确 Agent 坐标；
- 点地图查看陌生 Agent；
- Nearby Women / Men；
- 人员实时轨迹。

### 3.2 Agent Demand Map

用途：理解“哪里值得上线”。

显示：
- Demand Heat；
- 高需求区域；
- 任务数量区间；
- 典型报价；
- Fit；
- 距离。

未接单前：
- 私宅不显示精确地址；
- 只显示区域或 POI 级任务位置。

### 3.3 Execution Map

只在 Match Confirmed 后出现。

显示：
- Task 地点；
- Agent ETA；
- 路线；
- Check-in 范围；
- 必要的 Live Location。

精确定位必须：
- 有 Order；
- 有 Task Purpose；
- 有 TTL；
- 可审计；
- 任务结束自动关闭。

---

## 4. 定位权限层级

### L0 — No Task
仅城市/区域供给热度、价格、ETA；没有真人。

### L1 — Valid Task
允许匿名 Qualified Supply Cell，例如：
- 3km 内约 4–6 位；
- High / Medium / Low Supply。

### L2 — Candidate Set
允许：
- 距离；
- ETA 区间；
- 是否在范围内。

不返回 Agent 精确当前位置。

### L3 — Order Confirmed
允许：
- Arrival ETA；
- 模糊移动状态；
- 距离 Task 的实时变化。

### L4 — Execution Window
任务确实需要时：
- 精确定位；
- Agent 明确可见共享状态；
- 有自动关闭时间。

---

## 5. Agent Availability System

这是本版最重要的新能力。

Agent 不再靠每天刷任务大厅维持供给。

### 5.1 Scheduled Availability

示例：

```text
Saturday
17:00–22:00
Tây Hồ / Ba Đình
Event Staff / Greeter
English
Min 500k
Max travel 8km
```

支持：
- 单次；
- 每周重复；
- 日期例外；
- 自动暂停。

### 5.2 “我现在有空” / Available Now

Agent 首页核心 CTA：

> **我现在有空**

点击后创建 Availability Session。

可设置：

**挂多久**
- 30 min
- 1h
- 2h
- 4h
- 自定义结束时间

**愿意去多远**
- 3km
- 5km
- 8km
- 15km

**愿意接什么**
- Queue
- Event Staff
- Interpreter
- Content
- Professional Help

**最低报酬**

**自动接受**
- P0：不允许自动接单；
- 只支持 Notify me first。

### 5.3 AvailabilitySession

```json
{
  "availability_session_id": "...",
  "agent_id": "...",
  "mode": "AVAILABLE_NOW",
  "starts_at": "...",
  "ends_at": "...",
  "origin_cell": "...",
  "max_travel_km": 8,
  "allowed_roles": ["queue", "greeter"],
  "minimum_pay": 500000,
  "auto_match_policy": "NOTIFY_FIRST",
  "status": "ACTIVE"
}
```

状态：

```text
DRAFT → ACTIVE → OFFERED → MATCHED
                    ↓
                  PAUSED
ACTIVE → EXPIRED
ACTIVE → CLOSED
```

### 5.4 Soft Availability（P1）

> “如果有特别适合的任务，可以叫我。”

适合高技能、稀缺语言、专业背景、低频高价 Agent。

---

## 6. Agent 首页

Offline 状态：

```text
当前 Offline

[ 我现在有空 ]

This week
Sat 17:00–22:00 Available

Demand near you
Tây Hồ   High
Ba Đình  Medium

3 Matches for you
1 Repeat Invite
```

Live 状态：

```text
LIVE · 1h 34m left

Greeter / Queue
8 km
Min 500k

附近 5 个 Fit Task
预计首个 Offer 6 min

[暂停] [修改]
```

---

## 7. Demand Pulse

平台不能等任务发布后才发现供给不足。

Agent 可以看到：

```text
Saturday 18:00–22:00
Tây Hồ
English Greeter
DEMAND HIGH
```

CTA：
- 将这个时间设为可用；
- 今晚挂空闲。

Demand Pulse 只显示聚合市场信息，不暴露具体 Requester。

---

## 8. Requester Home + Map Snapshot

Requester 首页 Hero 下方增加：

```text
Around your task

Tây Hồ
12 available capacity
Fast Match ~8 min

[Open Map]
```

注意：
- 没有 Task 时只能看到聚合供给；
- 点击地图不能进入真人目录。

---

## 9. Map-driven Task Creation

地点支持：
1. 搜索地址；
2. 地图选点；
3. 使用当前位置；
4. 历史地点；
5. 商家 Saved Venue。

选择地点后实时显示：

```text
3km  → 4 qualified
5km  → 9 qualified
8km  → 17 qualified
```

让用户理解“搜索范围”如何影响成交概率。

---

## 10. Match Mode

### Fast Match

适合：
- Queue；
- Pickup；
- Simple Presence；
- Basic Execution。

流程：

```text
Task
→ Eligibility
→ Active / Scheduled Supply
→ Batch Offer
→ First Qualified Acceptance
→ Order
```

Requester 不选人。

### Curated Match

适合：
- Greeter；
- Host；
- Interpreter；
- Professional Background；
- Content Role。

流程：

```text
Task
→ Qualified Supply
→ Candidate Set
→ Requester Invite
→ Agent Accept
→ Order
```

地图只帮助理解范围和供给，不负责“浏览 Agent”。

---

## 11. Supply Shortage Orchestration

0 结果不能只显示 No Results。

必须提供：

```text
当前：0 exact matches

3km → 5km
预计 +4

Hosting Experience
Must → Preference
预计 +3

500k → 650k
预计可激活 +2

18:00 → 18:30
预计 +5
```

地图同步更新匿名供给热度。

---

## 12. Agent Offer Strategy

Agent 挂空闲后不能被疯狂群发任务。

P0：
- 一次一个清晰 Offer；
- 有倒计时；
- Decline 可选原因；
- Decline 不直接处罚。

Offer 必须展示：
- Role；
- Approximate Location；
- Travel Distance；
- Start Time；
- Duration；
- Pay；
- Deliverables；
- Requester Trust；
- Why Matched。

---

## 13. 供给留存

Agent 留存来自：

### A. Availability → Task
让 Agent 感觉“挂空闲真的有用”。

核心指标：
```text
Availability Session → Offer Rate
Availability Session → Order Rate
```

### B. Capability Passport
完成真实任务累积：
- Verified Role Experience；
- On-time；
- Completion；
- Language；
- Repeat Hire。

### C. Repeat Requester
成功订单后进入 Trusted Proxy。

### D. Demand Prediction
提前告诉 Agent 哪个时间、区域值得上线。

---

## 14. 需求留存

第二次发布必须比第一次简单。

功能：
- Saved Task Template；
- Saved Venue；
- Repeat Task；
- Trusted Proxy；
- Find Similar Proxy；
- Auto Replacement；
- Multi-slot Task。

---

## 15. Trusted Proxy

只允许从成功 Order 产生。

```text
Successful Order
→ Trusted Proxy
→ Future Task
→ Invite Again
```

不允许陌生 Agent 永久收藏。

---

## 16. Anti-Peeking + Map Guardrail

严禁：
- 在线 Agent 地图；
- 头像地图；
- Nearby Women / Men；
- 无任务点地图看 Profile；
- 长期跟踪 Agent 活动范围；
- 精确“谁在哪里”。

允许：
- 匿名 Supply Heat；
- Qualified Capacity；
- Match ETA；
- Order 后必要执行定位。

### 防推断攻击
- 1–2 个供给不显示精确人数，只显示 Low Supply；
- 查询频率限制；
- 敏感条件连续修改触发 Risk；
- Candidate Batch Limit；
- Exposure Audit；
- Map Zoom 限制；
- 精确 Agent 坐标永不进入搜索 API。

---

## 17. 新增数据对象

### LiquidityCell

```text
cell_id
geo_cell
time_bucket
role
qualified_supply
active_supply
scheduled_supply
open_demand
expected_accept_rate
median_response_seconds
estimated_fill_rate
updated_at
```

### LocationVisibilityGrant

```text
subject_id
viewer_id
task_id
order_id
visibility_level
starts_at
expires_at
reason
```

### DemandPulse

```text
geo_cell
time_bucket
role
demand_level
supply_gap_level
recommended_activation_window
```

---

## 18. 事件埋点

Requester：
- map_open
- task_location_selected
- search_radius_changed
- supply_cell_viewed
- supply_adjustment_applied
- candidate_set_generated
- candidate_exposed
- invite_sent
- repeat_task

Agent：
- availability_started
- availability_modified
- availability_paused
- availability_expired
- demand_pulse_viewed
- demand_pulse_activated
- offer_received
- offer_accepted
- offer_declined
- availability_to_order

---

## 19. 核心指标

Marketplace：
- Fill Rate
- Time to Qualified Match
- Time to First Offer
- Offer Acceptance Rate
- Available Qualified Capacity
- Supply / Demand Ratio by Cell

Availability：
- Weekly Available Agents
- Available Now Sessions
- Availability → Offer Rate
- Availability → Order Rate
- Median Session Duration
- Session Repeat Rate

Privacy：
- Profiles Exposed per Successful Order
- Candidate Exposure / Task
- Sensitive Filter Abuse Rate
- Precise Location Grant Count
- Location Grant TTL Compliance

Retention：
- Repeat Requester 30d
- Repeat Agent Availability 4-week
- Trusted Proxy Repeat Share
- Cross-scene Agent Reuse

---

## 20. P0 / P1

### P0
- Requester Map Snapshot
- Task Location Picker
- Aggregate Supply Map
- Search Radius
- Fast Match
- Curated Match
- Scheduled Availability
- “我现在有空”
- Availability duration / radius / role / min pay
- Basic Demand Pulse
- Execution Map
- Candidate Batch Limit
- No Task, No People Search

### P1
- Demand Forecast
- Soft Availability
- Dynamic Incentive
- Advanced Heatmap
- Automatic activation recommendation
- Personalized availability suggestion
- Advanced ETA / routing
- Multi-city liquidity management

---

## 21. v0.2 原型必须验证

1. Requester 首页有 Map，但看不到真人；
2. 地图选择 Task Location；
3. Radius 改变 Qualified Supply；
4. Supply Map 只显示匿名 Capacity；
5. Agent 可以“挂空闲”；
6. Availability Session 有结束时间、距离、角色、最低报酬；
7. Agent 可以看 Demand Map；
8. Offer 清晰解释 Why Fit；
9. Match 后才有 Execution Map；
10. 地图不会成为 People Browser。

---

## 22. 产品 IA

Requester：

```text
Home
├── Fast Match
├── Create Task
├── Supply Map
├── Active Tasks
└── Me

Task
├── Need
├── Location
├── Supply
├── Candidate / Dispatch
├── Match
└── Execution
```

Agent：

```text
Home
├── Available Now
├── Weekly Availability
├── Demand Map
├── Matches
├── Upcoming
├── Earnings
└── Capability Passport
```

---

## 23. 本版明确删除 / 保留的方向

### 保留：Agent 付费提升曝光（受控 Sponsored Exposure）

Agent 付费买排序保留，作为平台重要的增值收入来源，但必须满足：

- 不能绕过 Eligibility；
- 不能绕过 Availability；
- 不能突破 Location / Privacy 权限；
- 不能覆盖安全、认证、任务硬条件；
- 必须明确标记 Sponsored / Boosted；
- 必须限制每个 Candidate Batch 中的 Sponsored 数量；
- Sponsor 只影响“曝光机会”，不能让低 Fit Agent 压过明显高 Fit Agent；
- 用户仍然可以看到自然匹配结果。

推荐产品定义：

> **Boost = 提升进入 Qualified Candidate Set 或 Sponsored Slot 的概率，不等于购买最终排名。**

### 删除 / 禁止

1. 附近的人 / 真人地图；
2. 无限任务大厅作为 Agent 主入口；
3. 陌生 Agent 永久收藏；
4. 无任务情况下按敏感属性不断探索供给。

---

## 24. Agent Boost / Sponsored Exposure 商业化机制

这是 Proxy 的重要盈利扩展能力。

### 24.1 为什么保留

Agent 侧天然存在付费意愿：

- 想更快拿到第一单；
- 想在高需求时段提高曝光；
- 想推广新 Capability；
- 想在特定区域 / 角色增加接单概率；
- 新 Agent 希望缩短冷启动时间。

因此平台可以同时拥有：

```text
Requester Task Commission
+ Agent Sponsored Exposure
+ Verification / Capability Service
+ Business SaaS Tools
```

### 24.2 Boost 不等于绕过匹配

排序流程：

```text
1. Hard Eligibility
2. Safety / Trust Gate
3. Availability Gate
4. Task Fit Score
5. Organic Ranking
6. Sponsored Exposure Adjustment
7. Candidate Set
```

付费只能发生在第 6 层。

Agent 如果不满足：

- 时间；
- 距离；
- Must-have；
- 认证；
- 任务类型；
- 安全限制；

即使付费也不能出现。

### 24.3 推荐产品形态

#### A. Boost This Week

Agent 购买：

- 1 day
- 3 days
- 7 days

提升在符合任务里的曝光概率。

#### B. Boost by Role

例如：

> Boost “English Greeter”

只对该 Capability 有效。

#### C. Boost by Area

例如：

> Boost Tây Hồ / Ba Đình

只对目标 Liquidity Cell 有效。

#### D. High-demand Boost

Demand Pulse 出现：

> Saturday 18:00–22:00  
> Tây Hồ  
> English Greeter demand high

Agent 可以购买：

> Boost me for this window

这类 Boost 转化率最高，也最符合 Marketplace 逻辑。

### 24.4 Candidate Batch 展示规则

例如一批 6 人：

```text
#1 Organic Best Match
#2 Organic
#3 Sponsored Qualified
#4 Organic
#5 Organic
#6 Sponsored Qualified
```

建议：

- Sponsored 不超过 20–30%；
- Sponsored 必须清晰标记；
- 首位默认保留给自然最佳匹配；
- Boost 不能影响 Hard Match；
- Boost 不能进入 Fast Match 自动派单的安全优先逻辑。

### 24.5 Fast Match 的商业化

Fast Match 不建议直接“买第一名”。

可以卖：

> **Priority Offer Access**

但仍必须：

```text
Eligibility
→ Reliability
→ Distance
→ Availability
→ Priority Access
```

不能出现：

> 付钱最多的人，无论多远/多差都先接到。

### 24.6 定价方式

P0 可以非常简单：

- 1-day Boost
- 3-day Boost
- 7-day Boost

P1：

- Role Boost
- Area Boost
- Time-window Boost
- Demand-driven Boost
- Credit Pack

后续再考虑：

- CPC（曝光/点击）
- CPA（成交）
- Subscription
- Hybrid Credits

### 24.7 收入与体验平衡指标

必须监控：

- Sponsored CTR
- Sponsored → Invite Rate
- Sponsored → Order Rate
- Organic vs Sponsored Completion Rate
- Sponsored Dispute Rate
- Requester Conversion Rate
- Candidate Set Satisfaction
- Agent ROI on Boost

如果 Sponsored 的：

- Completion Rate 明显更差；
- Dispute Rate 明显更高；
- Requester Conversion 明显下降；

必须降低 Boost 权重。

### 24.8 Sponsored Anti-abuse

禁止：

- 买敏感属性曝光；
- 买“附近的人”曝光；
- 无 Task 的公开人榜；
- 通过 Boost 绕过 Candidate Batch Limit；
- 通过 Boost 无限展示头像；
- 假认证后购买曝光。

### 24.9 用户心智

Requester 应看到：

> Sponsored · Qualified for your task

而不是：

> Recommended because paid

系统仍然必须解释：

- Why matched；
- Capability；
- Distance；
- Availability；
- Reliability。

Boost 只是商业曝光机制，不替代匹配解释。

---

## 25. Acceptance Criteria

- [ ] Requester 首页地图只显示匿名市场供给；
- [ ] 没 Task 时不能访问 Agent；
- [ ] Task Location + Radius 改变 Qualified Supply；
- [ ] Agent 可开启 Available Now Session；
- [ ] Session 有 TTL；
- [ ] Demand Map 不暴露 Requester 私人精确地址；
- [ ] Match Confirmed 后才有 Execution Map；
- [ ] Fast Match 不要求 Requester 选人；
- [ ] Curated Match 只给有限候选；
- [ ] Supply shortage 有调整建议；
- [ ] Location 权限可审计；
- [ ] 地图不会变成偷窥入口。

---

## 26. 下一版

原型走查后进入 PRD v1.0，重点补：
- Task / Slot / Order 最终状态机；
- Payment；
- Chat；
- Execution Evidence；
- Dispute；
- Multi-slot；
- Business Requester；
- Operator Console。

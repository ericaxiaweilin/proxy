# Proxy Personalization & Orchestration Engineering Spec v1.0

> Internal Architecture Specification  
> Scope: User Modeling / Tag System / Gravity Event / Resource Envelope / Evidence Gate / Human Value Guardrail / Matching / Orchestration / Outcome Learning

---

## 0. Product Thesis

Proxy 的核心不是“把用户分成几十类”，而是建立一个**高维、动态、可验证、可回流学习的人类需求状态模型**。

核心问题不是：

> 这个用户属于哪一种人？

而是：

> **这个用户，在这个时间、地点、事件和资源条件下，更可能想做什么？什么方案现实可行？什么主动干预真正有获得感、且不会产生愤怒？**

Proxy 的个性化原则：

```text
Population Prior
      ↓
Fine-grained Tags
      ↓
Continuous Features
      ↓
Realtime Context
      ↓
Gravity Events
      ↓
Resource Envelope
      ↓
Current Intent
      ↓
Evidence Gate
      ↓
Human Value Guardrail
      ↓
Eligibility
      ↓
Retrieval
      ↓
Ranking
      ↓
Orchestration
      ↓
Fulfillment
      ↓
Outcome / New Evidence
      ↺
```

---

# 1. 千人千面：高维状态，而不是 Persona

传统 Persona 会把用户压缩成：

```text
Female
25岁
Hanoi
喜欢旅行
喜欢咖啡
价格敏感
```

这种画像只能做粗方向。

Proxy 必须保留真实差异：

```text
周五18–22点旅行搜索高
最近7天保存宁平内容≥3
过去30天完成2次短途同行
接受30–100km短途
小团偏好
凌晨出发接受
超过4人同行接受率低
河内3km咖啡响应高
连续3次快速划走SPA推广
Creator合作响应≤2小时
同行履约率≥90%
```

原则：

> **先保存事实差异，再从数据中发现结构。**
>
> **抽象是数据分析的产物，不是数据进入系统之前的前提。**

同一个用户可以同时拥有：

```text
100+ 长期标签
50+ 中期标签
80+ 短期标签
20+ Context 特征
3–5 Active Intents
100+ Relationship Features
50+ Transaction Features
30+ Negative Preferences
```

标签数量大不是问题。

真正的问题是：

- 无法检索
- 无法组合
- 无法衰减
- 不知道来源
- 不知道证据质量
- 不知道是否被系统自身污染

---

# 2. 数据地基层

## 2.1 Event Store

所有真实行为必须先以事件保存，而不是立即压缩成标签。

```yaml
event:
  event_id:
  user_id:
  timestamp:
  event_type:

  object_id:
  object_type:

  session_id:
  location:
  merchant_id:
  campaign_id:
  content_id:

  dwell_ms:
  distance:
  price:
  rank_position:

  origin:
    organic
    explicit
    transactional
    system_exposed
    merchant_exposed

  exposure_lineage:
    recommendation_id:
    policy_id:
    model_version:
    predicted_score:
```

关键原则：

> Event = 事实。

不要发生：

```text
用户保存了一次宁平帖子
→ 只留下 #喜欢旅行
```

原始行为必须保留。

---

## 2.2 Feature Store

Feature Store 保存连续数值状态。

示例：

```text
ninhbinh_save_7d = 4
coffee_search_7d = 6
weekend_evening_activity_ratio_28d = 0.67
median_lunch_amount_30d = 52K
p75_lunch_amount_30d = 68K
spa_quick_skip_rate_7d = 0.81
distance_tolerance_coffee_p75 = 2.8km
companion_fulfillment_rate_90d = 0.96
```

原则：

> Feature = 数值状态。

工程建议：

```text
Raw Event Stream
    ↓
Kafka / Pulsar
    ↓
Flink / Spark Streaming
    ↓
Online Feature Store
+
Offline Feature Store
```

可选实现：

- Feast
- Redis / RocksDB / Cassandra（在线）
- ClickHouse / BigQuery / Snowflake / Lakehouse（离线）
- 自研统一 Feature Registry

---

# 3. Tag System：细粒度标签仓

标签不是“人格”，而是**可读、可检索、可组合的状态描述**。

## 3.1 Tag 示例

```text
周末18–22点高活跃
最近7天保存宁平内容≥3
河内3km咖啡高响应
过去30天优惠券核销≥2
连续3次快速划走SPA推广
Creator合作响应≤2小时
同行履约率≥90%
TikTok外链点击≥2 / 14d
```

## 3.2 Tag 数据结构

```yaml
user_tag:
  user_id:
  tag_id:

  strength:
  confidence:

  source:
  evidence_count:
  source_diversity:

  first_seen:
  last_seen:

  ttl:
  decay:

  positive_or_negative:

  allowed_use:
    analytics:
    recommendation:
    matching:
    orchestration:
    merchant_targeting:
    public:
```

## 3.3 关键工程原则

```text
Event = 事实
Feature = 连续数值
Tag = 可解释状态
Embedding = 高维压缩
Graph = 关系结构
```

任何一层都不替代另一层。

---

# 4. Embedding 与高维稀疏问题

几万甚至几十万种 Tag 会造成高维稀疏。

正确方式不是删标签，而是保留：

```text
Fine Tags = 可解释
Embedding = 高效相似度
```

用户可以同时拥有：

```text
500+ active tags
```

模型另外学习：

```text
User Embedding = 256 / 512 / 1024 dimensions
```

用于：

- ANN Retrieval
- Similar User
- Similar Merchant / Offer
- Intent Candidate Search

可选：

- HNSW
- FAISS
- ScaNN
- Two-Tower

---

# 5. Market Graph

Proxy 不只需要“用户有什么标签”，还必须知道：

> 用户和其他实体之间发生过什么关系。

节点：

```text
User
Merchant
Place
Content
Need
Offer
Event
Coupon
Service
Transaction
Group
```

边：

```text
viewed
saved
visited
purchased_from
fulfilled_with
rejected
accepted
joined
invited
near
similar
```

前期先使用 Graph Features：

```text
common_neighbors
2-hop distance
shared_fulfillment
merchant_overlap
place_overlap
interaction_recency
relationship_strength
```

后期数据足够再考虑：

- GraphSAGE
- GAT
- Heterogeneous GNN
- HGT

原则：

> GNN 不负责基本 3km 空间过滤。  
> Geo / Time / Capacity 等硬条件先由 Eligibility 完成。

---

# 6. Gravity Event：未来需求引力

## 6.1 定义

Gravity Event 不是 Interest，也不是 Intent。

```text
Interest = 我长期喜欢什么
Gravity Event = 什么需求正在逼近
Intent = 我现在具体想做什么
```

例如：

```text
coffee_interest = 0.82
meal_gravity = 0.91
sushi_intent = 0.12
```

随着午饭时间逼近：

```text
11:00 meal_gravity = 0.30
11:30 meal_gravity = 0.61
12:00 meal_gravity = 0.84
12:30 meal_gravity = 0.96
```

再结合：

```text
Sushi interest .82
附近寿司 1.2km
午餐预算 80K–180K
今天无广告疲劳
过去周三常吃日料
```

可能得到：

```text
Sushi Lunch Intent
0.12 → 0.73
```

---

## 6.2 Gravity Event 分类

### G0 — 几乎必然

```text
吃饭
睡觉
规律通勤
回家
```

### G1 — 周期高概率

```text
周末娱乐
咖啡
健身
日常补货
```

### G2 — 条件触发

```text
下雨 → 打车
旅行 → 酒店
生日 → 礼物 / 聚会
演唱会 → 交通 / 餐饮
```

### G3 — 行为积累形成

```text
连续看相机
连续搜索MacBook
反复收藏宁平旅行
```

### G4 — 用户明确声明

```text
“周六我想去宁平”
```

此时已经接近 Explicit Intent。

---

## 6.3 Event Template 与 Event Instance

Template：

```yaml
event_template:
  type: MEAL
  recurrence: 2-4/day
  time_windows:
    breakfast:
    lunch:
    dinner:
  typical_delay:
  substitutable: true
```

Instance：

```yaml
event_instance:
  user_id:
  type: MEAL
  expected_time: 12:05-13:00
  probability: 0.91
  location: office area
  social_mode: alone_or_coworker
  expected_budget: 50K-120K
  distance_tolerance: <=2.5km
  urgency: rising
```

---

# 7. Gravity 算法

第一阶段优先简单可靠：

```text
Histogram / KDE
Logistic Regression
LightGBM / CatBoost
Survival Analysis
```

Gravity 真正关心的是：

> 距离下一次事件发生还有多久？

因此 Survival / Hazard 特别适合：

```text
P(next_meal <= 30min)
P(next_meal <= 60min)
P(next_meal <= 120min)
```

后期：

- Cox / Weibull / Log-normal survival
- Hawkes Process
- Temporal Point Process
- Transformer Sequence Model

不建议早期直接上复杂 Neural TPP。

---

# 8. Resource Envelope：财、时、空和现实边界

“财”不要预测净资产。

真正需要的是：

> **某个具体场景下的可消费/可投入边界。**

Resource Envelope：

```text
Money
Time
Distance
Attention
Effort
Social Willingness
Risk Tolerance
```

---

## 8.1 Contextual Affordability

例如月收入 30TR 的工程师：

```text
WORKDAY_LUNCH

P10 = 30K
P25 = 42K
P50 = 52K
P75 = 68K
P90 = 95K
```

不是：

```text
收入30TR
→ 午饭可承受300K
```

正确预测：

```text
P(accept | scene, price, context)
```

例如：

```text
Lunch <=80K        0.92
80K–150K           0.76
150K–300K          0.31
>300K               0.09
```

算法：

- Logistic Regression
- CatBoost / LightGBM
- Quantile Regression

原则：

> Income ≠ Spending Capacity  
> Spending Capacity ≠ Willingness to Pay  
> Willingness to Pay ≠ Contextual Willingness to Pay

---

# 9. Evidence Gate：反向污染防护

Proxy 最大的建模风险之一：

```text
系统猜用户喜欢咖啡
↓
大量推咖啡
↓
用户不可避免点了一些
↓
系统把这些行为当自然证据
↓
“她果然喜欢咖啡”
↓
继续推
```

这是 self-reinforcing contamination。

---

## 9.1 Exposure Lineage

所有行为必须知道来源：

```text
organic
explicit
transactional
system_exposed
merchant_exposed
pure_model_inference
```

证据优先级：

```text
Explicit / Transactional
        >
Repeated Organic Behavior
        >
Single Organic Behavior
        >
System-induced Behavior
        >
Pure Model Inference
```

---

## 9.2 User × Event × Context × Action Gate

不能只用全局：

```text
confidence > 0.8
```

必须细化：

```text
User
× Event
× Context
× Action
```

例如：

```text
Huyen × 午餐 × 11:55办公室 × Feed Card
θ = 0.72

Huyen × 午餐 × 11:55办公室 × Push
θ = 0.91
```

---

## 9.3 三个独立变量

```text
Probability
Confidence
Evidence Coverage
```

不能混成一个。

示例：

A：

```text
Meal Gravity = .87
Confidence = .90
Coverage = .94
```

B：

```text
Meal Gravity = .87
Confidence = .71
Coverage = .28
```

两者不能获得相同的线上决策权。

---

## 9.4 Contamination Risk

每个：

```text
User × Tag
User × Event
```

维护：

```text
contamination_risk
```

来源：

```text
system_exposure_dependency
model_generated_evidence_ratio
feedback_loop_depth
low_source_diversity
contradiction
freshness
```

示例：

```text
travel_interest
score .91
confidence .94
coverage .88
contamination .08
→ DECISION_READY
```

```text
luxury_spa_interest
score .81
confidence .76
coverage .32
contamination .68
→ LEARN_ONLY
```

---

# 10. Negative Feedback Circuit Breaker

不是所有“不点”都算拒绝。

层级：

```text
Seen but no action       → 极弱负反馈
Quick skip               → 弱负反馈
Repeated quick skip      → 中负反馈
Not interested           → 强负反馈
Hide                     → 强负反馈
Block / Report           → 极强负反馈
```

策略示例：

```text
quick_skip ×3
→ cooldown 24h

hide
→ cooldown 7d

not_interested
→ cooldown 30d

block merchant
→ merchant永久禁止主动触达
```

具体时间通过线上数据校准。

---

# 11. Decision Eligibility 状态机

不要只有 active / inactive。

```text
OBSERVE
LEARN_ONLY
PASSIVE
SOFT_NUDGE
ACTIVE_ORCHESTRATE
BLOCKED
```

含义：

| State | 用途 |
|---|---|
| OBSERVE | 只收集数据 |
| LEARN_ONLY | 可用于模型学习，不影响线上 |
| PASSIVE | 用户主动搜索时参与 Rank |
| SOFT_NUDGE | Feed / Market 中自然出现 |
| ACTIVE_ORCHESTRATE | 主动撮合 / Push / 组局 |
| BLOCKED | 负反馈或硬边界直接禁止 |

---

# 12. Human Value Guardrail：获得感 / 愤怒感

这是点火前的一级心理防护墙。

前面的模型回答：

> 系统算得对不对？

Human Value Guardrail 回答：

> 就算算对了，这次动作对用户来说值不值得？会不会冒犯、烦扰或让用户觉得被坑？

---

## 12.1 Gain Score｜获得感

获得感不是“便宜”。

它是：

```text
质量提升
+ 便利提升
+ 时间节省
+ 优惠
+ 兴趣匹配
+ 社交匹配
+ 稀缺性
+ 当前事件契合

-

额外价格
- 距离
- 等待
- 决策成本
- 风险
```

原则：

> 贵不是问题，贵得没有理由才是问题。

---

## 12.2 Anger / Violation Risk｜愤怒感

来源：

```text
Price Violation
Repetition Violation
Manipulation Feeling
Privacy Creep
Bad Timing
Distance Violation
Low-quality Mismatch
Unwanted Commercial Pressure
```

Anger Risk 可以一票否决。

---

## 12.3 30TR 工程师午餐例子

用户典型工作餐：

```text
P50 = 52K
P75 = 68K
P90 = 95K
```

候选：

### 20K

可能：

```text
便宜
但质量 / 卫生 / 环境不匹配
→ Gain 未必高
```

### 50K

```text
≈ 典型区间
→ 安全
```

### 100K

```text
Price Stretch ≈ 1.92×
```

如果：

```text
步行2分钟
不用排队
用户喜欢
原价150K
今天100K
同事同行
```

Gain 可能足够高，可以推荐。

### 200K

普通工作午餐：

```text
Price Stretch ≈ 3.85×
无特殊事件
无额外价值
→ Anger Risk High
→ BLOCK ACTIVE PUSH
```

但如果：

```text
生日午餐
明确搜索高级日料
历史此场景接受200–500K
```

则 200K 可以合理。

所以必须：

```text
User × Event × Context
```

而不是用收入做简单判断。

---

# 13. Intervention Budget｜主动干预预算

每个用户还应维护：

```text
Intervention Budget
```

例如：

```text
今日已发生：
餐饮主动推荐 1次
商家优惠 1次
同行提醒 1次

Intervention Budget = LOW
```

即使：

```text
Gravity = .93
```

也不一定 Push。

可以只：

```text
在 Market / Feed 自然排序靠前
```

---

# 14. 动态点火模型

点火不是单一概率。

基础组合逻辑：

```text
Score =
Base Probability × w1
+ Behavior Frequency × w2
+ Context Alignment × w3
- Negative Penalty × w4
```

但线上真正触发必须额外通过：

```text
Fire =
Eligible
AND Score > θ(user,event,context,action)
AND EvidenceCoverage >= E_min
AND ContaminationRisk <= C_max
AND NegativeBreaker = false
AND ResourceGuardrail = PASS
AND GainScore >= G_min
AND AngerRisk <= A_max
AND InterventionBudget > 0
```

---

## 14.1 点火状态参考

不把以下数字当“工业统一标准”，只作为起始策略区间：

| Score / State | 行为 |
|---|---|
| <0.5 / OBSERVE | 只收集，不影响用户 |
| 0.5–0.75 / PASSIVE | 用户主动搜索时参与 Rank |
| 0.75–0.9 / SOFT_NUDGE | Feed / Market 顺势出现 |
| >=0.9 / ACTIVE_ORCHESTRATE | 只有通过全部 Guardrail 才允许主动触发 |

阈值最终按：

```text
User × Event × Context × Action
```

动态校准。

---

# 15. Eligibility：硬过滤

Prediction 与 Feasibility 分开。

不能：

```text
Gravity .92
价格不合适
→ Score降一点
```

应该：

```text
Gravity .92

Eligibility:
price FAIL
time PASS
distance PASS
capacity PASS

→ BLOCKED
```

硬约束包括：

```text
权限
时间
距离
营业
库存
容量
预算硬上限
年龄/资格
安全
隐私
关系边界
```

---

# 16. Retrieval / Ranking / Orchestration

## 16.1 Retrieval

从：

```text
1,000,000 candidates
→ 1,000
```

使用：

```text
Eligibility Filter
Tag Inverted Index
Geo Index
ANN
Two-Tower
```

Geo：

- H3
- S2
- PostGIS
- Redis GEO

---

## 16.2 Ranking

输入：

```text
Tags
Features
Gravity
Intent
Resource Envelope
Graph Features
Embedding Similarity
Distance
Time
Trust
History
Gain Score
Anger Risk
```

前期优先：

- LightGBM
- CatBoost

后期：

- DIN
- DCN
- DeepFM
- Transformer Ranker

---

## 16.3 Orchestration

Ranking 回答：

> 谁更合适？

Orchestration 回答：

> 怎么让事情发生？

例如同行：

```text
maximize:
compatibility
+ trust
+ completion probability
+ convenience
+ user gain

subject to:
3 <= group_size <= 4
time overlap >= 4h
budget compatible
distance <= threshold
vehicle capacity
merchant capacity
privacy constraints
```

算法：

- CP-SAT
- Integer Programming
- Min-cost Flow
- Assignment
- Routing

Google OR-Tools 是很合适的起点。

---

# 17. Outcome / Reward System

系统最终必须知道：

> 刚才那个判断到底对不对？

闭环：

```text
Decision
↓
Exposure
↓
Response
↓
Commit
↓
Fulfillment
↓
Cancellation / No-show / Repeat
↓
Outcome
↓
New Evidence
↺
```

Reward 不能只优化 CTR。

Proxy 更应该优化：

```text
Successful Fulfillment
× User Gain
× Low Regret
× Low Anger
× Repeat Willingness
```

示意：

```text
deep_view              +0.05
save                   +0.2
intent_created         +0.5
match_accept           +1
commit                 +2
fulfillment            +5
repeat_fulfillment     +8

hide                   -2
cancel                 -3
no_show                -8
dispute               -10
block                  -12
```

具体权重必须通过数据学习和业务目标校准。

---

# 18. 防止系统自证正确：因果与对照

Proxy 后期必须保留部分：

```text
Holdout
Randomized Exploration
```

否则无法知道：

> 用户点击是因为真的喜欢，还是因为系统一直给他看？

建议：

```text
Propensity Logging
Contextual Bandit
Inverse Propensity Weighting
A/B Holdout
```

例如：

```text
系统推荐咖啡后转化 = 14%
自然对照组           = 12%

真实推荐 Lift ≈ 2pp
```

而不是把 14% 全归功于模型。

---

# 19. 推荐算法演进路线

| Problem | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Tag | Rule / SQL | Auto tag discovery | learned representations |
| Interest | weighted events + decay | GBDT | sequence model |
| Gravity | histogram / logistic | survival / GBDT | TPP / Transformer |
| Resource | quantile / CatBoost | richer contextual model | deep response model |
| Graph | graph features | GraphSAGE | hetero GNN |
| Retrieval | filter + inverted index | ANN | Two-Tower |
| Ranking | LightGBM / CatBoost | DIN / DCN | sequence ranker |
| Orchestration | CP-SAT | hybrid score + optimization | learned policy + optimizer |
| Exploration | simple controlled random | contextual bandit | advanced bandit |
| Long-term Policy | — | — | RL only after reward/data mature |

原则：

> 不要过早把“复杂模型”当作能力本身。  
> 数据质量、证据链、Outcome 和 Guardrail 比模型名字重要。

---

# 20. 建议核心服务拆分

```text
event-service
feature-service
tag-service
tag-factory
embedding-service
graph-service

gravity-service
intent-service
resource-envelope-service

evidence-gate-service
negative-breaker-service
human-value-guardrail-service

eligibility-service
retrieval-service
ranking-service
orchestration-service

outcome-service
experiment-service
model-registry
audit-service
```

---

# 21. 核心数据对象

## UserState

```yaml
UserState:
  user_id:

  population_prior:
  active_tags:
  continuous_features:
  embeddings:

  graph_state:
  current_context:

  gravity_events:
  active_intents:
  resource_envelopes:

  evidence_state:
  intervention_budget:
```

## UserEventState

```yaml
UserEventState:
  user_id:
  event_type:
  context_key:

  probability:
  confidence:
  evidence_coverage:
  contamination_risk:

  first_seen:
  last_seen:
  freshness:
  ttl:

  negative_state:
  cooldown_until:

  resource_feasibility:
  gain_score:
  anger_risk:

  action_state:
    OBSERVE
    LEARN_ONLY
    PASSIVE
    SOFT_NUDGE
    ACTIVE_ORCHESTRATE
    BLOCKED
```

---

# 22. Proxy 的最终个性化模型

```text
WHO
这个人是谁
        ↓
WHAT HAS ACTUALLY HAPPENED
真实事实、行为、交易
        ↓
WHAT IS STABLE
长期 Tag / Feature / Relation
        ↓
WHAT IS CHANGING
短期行为、Context
        ↓
WHAT IS PULLING
哪些 Gravity Events 正在逼近
        ↓
WHAT IS AFFORDABLE
钱 / 时间 / 距离 / 注意力 / 社交意愿
        ↓
WHAT IS WANTED NOW
Current Intent
        ↓
IS THE EVIDENCE TRUSTWORTHY
Evidence Gate / Contamination Check
        ↓
WILL THIS FEEL VALUABLE
Gain Score
        ↓
WILL THIS FEEL ANNOYING / OFFENSIVE
Anger / Violation Risk
        ↓
WHAT IS POSSIBLE
Eligibility
        ↓
WHO / WHAT CAN SATISFY IT
Retrieval / Ranking
        ↓
HOW TO MAKE IT HAPPEN
Orchestration
        ↓
DID IT ACTUALLY HELP
Fulfillment / Outcome
        ↓
NEW EVIDENCE
        ↺
```

---

# 23. Final Principles

1. **不要先把人压缩成 Persona。**
2. **先保留细粒度真实差异。**
3. **Event、Feature、Tag、Embedding、Graph 各司其职。**
4. **Interest、Gravity、Intent 三者严格分离。**
5. **Resource 不是财富，而是场景可行边界。**
6. **模型猜测不能自动升级成事实。**
7. **系统制造的行为不能和自然行为等权。**
8. **任何强决策都必须经过 User × Event × Context × Action 的 Evidence Gate。**
9. **Gain 不够可以不主动；Anger Risk 高必须阻断。**
10. **Prediction 与 Feasibility 分离。**
11. **Ranking 不等于 Orchestration。**
12. **最终优化目标不是 CTR，而是高获得感、低愤怒、可履约、可复用的现实世界结果。**

---

## Product Positioning

如果上述体系被真正实现，Proxy 的能力不再只是“推荐系统”或“本地生活工具”，而是一套：

> **动态人类需求建模 + 市场撮合 + 现实世界编排系统。**

它的技术核心可以概括为：

> **千人千面，一人千面，一时一面。**
>
> **标签理解你是谁，引力推演你接下来需要什么，资源边界决定什么现实可行，证据门防止系统自我欺骗，获得感/愤怒感防护墙决定是否值得主动干预，Orchestration 负责把事情真正做成。**

# Proxy｜邀约 + User Scene Intelligence PRD v0.2

> 定位：Proxy「市场」中的撮合形式之一  
> 本版本新增：Club Signal、User Scene Vector、价格带、Funding Fit、Scene Gate、Trust Unlock、邀约履历/评价/高阶 Scene 解锁  
> 核心目标：允许经济投入不对称，但确保 Host / Guest 双边获得感、尊严、真实消费与长期 Repeat 同时成立。

---

# 0. 本版本最重要的变化

v0.1：

```text
Host Intent
→ Budget
→ Scene
→ Invite
→ Check-in
→ Benefit
→ Complete
```

v0.2：

```text
Club / Behavior / Spend / History
            ↓
Signal Collector
            ↓
User Scene Vector
            ↓
Trust / Unlock Level
            ↓
Host × Guest × Merchant × Price
            ↓
Scene Composer
            ↓
Rule Gates
            ↓
Invite / Commit / Consume
            ↓
Scene Memory
            ↓
Vector + Trust Update
            ↓
Better Next Scene
```

「邀约」只是前台入口。

真正沉淀的是：

```text
User Scene Intelligence
+
Scene Exchange Engine
+
Trust Unlock System
```

---

# 1. 为什么要做“解锁”

Proxy 不应该让所有用户一注册就获得所有能力。

原因：

1. 高金额 Host-funded Scene 风险更高。
2. Trip / Half-day Scene 需要更强 Reliability。
3. Guest 的邀约履历、评价属于更高敏感度信息，不应该默认公开。
4. Host 需要足够的保护，防止 Benefit Abuse / No-show。
5. Guest 也需要保护，避免新账号直接发高压、高金额邀约。
6. Merchant / Creator 侧也需要真实身份与历史行为作为信号。

因此：

```text
Feature Access
≠
Paid Membership Only

Feature Access
=
Verification
+ Scene Completion
+ Reliability
+ Mutual Rating
+ Time / History
```

---

# 2. Trust / Scene Maturity Levels

前台可以不显示 L0/L1/L2 数字，只表现为“已解锁”。

## L0 · New

可用：

```text
Browse Market
Join Club
Save Scene
Self-funded Scene
AA Scene
Basic Profile
```

限制：

```text
不可发高金额 Host-funded
不可查看他人完整邀约履历
不可参加 Trip / Half-day 高承诺 Scene
评价权重低
```

---

## L1 · Verified

条件示例：

```text
基础身份验证
+ 手机 / 账号验证
+ 完成偏好 / Club 冷启动
```

解锁：

```text
Basic Invite
Host Upgrade
Low-budget Host Sponsored
Accept / Decline / Ask
Basic Scene Rating
```

---

## L2 · Reliable

条件示例：

```text
≥ 3 Completed Scenes
No-show 低
Cancel 正常
双方评价无重大问题
```

解锁：

```text
完整 Host Sponsored
Invite History Summary
Reliability Badge
中等预算 Scene
Workshop / Exhibition / Dinner
更高评价权重
```

---

## L3 · Trusted

条件示例：

```text
≥ 8 Completed Scenes
长期 Reliability 良好
无 Abuse / Safety Block
```

解锁：

```text
Half-day Scene
Short Trip
High-budget Host Sponsored
更完整的 Scene History
Repeat Relationship Features
Advanced Club / Premium Scene
```

---

## L4 · Established

条件示例：

```text
长期高质量 Scene 记录
双方 Repeat 高
Merchant / Participant Trust 高
```

解锁：

```text
Creator / Community Host
Private Club
Curated Premium Scene
Merchant Co-sponsored Campaign
高级组织能力
```

---

# 3. 隐私原则：不是“所有人都能看到评价”

评价 / 履历需要分层。

## Public

可公开：

```text
Completed Scenes: 8
Reliable Participant
Photo / Rooftop / Exhibition
Response Speed
```

不要公开：

```text
具体跟谁约过
对方花了多少钱
某个 Host 给她消费多少
精确收入 / 身高推断
被谁拒绝几次
```

## Relationship-scoped

只有实际双方发生过 Scene 才可以看到：

```text
双方上次 Scene
上次是否完成
彼此的私有评价
Repeat Signal
```

## Internal only

```text
No-show history
Abuse risk
Transaction sensitivity
Peer comparison intensity
Price affinity
User Scene Vector
```

---

# 4. User Scene Vector

不是静态“小美类型”。

```json
{
  "aesthetic_drive": 0.91,
  "display_drive": 0.84,
  "peer_comparison": 0.70,
  "self_pay_affinity": 0.46,
  "host_funded_affinity": 0.87,
  "transaction_sensitivity": 0.93,
  "reliability": 0.88,
  "price_affinity": {
    "coffee": 0.45,
    "beauty": 0.82,
    "travel": 0.64
  },
  "scene_affinity": {
    "photo_cafe": 0.95,
    "rooftop": 0.91,
    "brunch": 0.79,
    "spa": 0.24
  }
}
```

---

# 5. Cold-start Archetypes（内部预设，不是永久标签）

## X1 · 出片型

```text
Aesthetic HIGH
Display HIGH
Photo HIGH
Host-funded MEDIUM/HIGH
```

优先：

```text
Photo Cafe
Rooftop
Photo Booth
City Walk
Travel Photo
```

---

## X2 · 精致省钱型

```text
Aesthetic HIGH
Price Sensitivity HIGH
Self-pay MEDIUM
Host-funded HIGH
Transaction Sensitivity HIGH
```

优先：

```text
Low-cost / High Aesthetic
Host Upgrade
Merchant Benefit
Photo Cafe
Dessert
```

---

## X3 · Premium 展示型

```text
Aesthetic HIGH
Display HIGH
Premium Price Affinity HIGH
```

优先：

```text
Hotel
Premium Rooftop
Fine Dining
Travel
Premium Workshop
```

---

## X4 · 体验型

```text
Experience HIGH
Photo MEDIUM
Display MEDIUM
```

优先：

```text
Workshop
Exhibition
Pottery
Flower
Travel
```

---

## X5 · 独立消费型

```text
Self-pay HIGH
Host-funded LOW
Transaction Sensitivity HIGH
```

优先：

```text
SELF
AA
Host Upgrade
```

避免：

```text
Full Host Sponsored as default
```

---

## X6 · Host-benefit 型

```text
Self-pay LOW/MEDIUM
Host-funded HIGH
Aesthetic HIGH
Transaction Sensitivity HIGH
```

优先：

```text
Host Sponsored Scene
Host Upgrade
Merchant Sponsored
```

严格避免：

```text
Cash Offer
Person Price
```

---

# 6. Club = Cold-start Signal Collector

Club 不是人口属性。

例如：

```text
170俱乐部
周末出片
50K咖啡
Rooftop
精致省钱
Premium Weekend
```

只生成 signal：

```json
{
  "signal_type": "CLUB_JOIN",
  "source": "170_CLUB",
  "effects": {
    "aesthetic_identity": 0.20,
    "display_drive": 0.10,
    "photo_affinity": 0.15
  },
  "confidence": 0.45
}
```

不能推断：

```text
height = 170+
income = 30M
```

---

# 7. Signal 权重

初始建议：

```text
Actual Spend          1.00
Repeat                0.95
Scene Complete        0.95
Accept                0.75
Post                  0.75
Save                  0.55
Club Join             0.40
Click                 0.20
```

原则：

```text
真实行为 > 主动声明 > 浏览信号
```

---

# 8. Price Model 更新

禁止单一：

```text
User = P3
```

改成：

```text
Category Price Affinity
```

例如：

```json
{
  "coffee": {
    "normal": 55000,
    "stretch": 90000
  },
  "brunch": {
    "normal": 250000,
    "stretch": 450000
  },
  "beauty": {
    "normal": 1500000,
    "stretch": 6000000
  },
  "travel": {
    "normal": 700000,
    "stretch": 1800000
  }
}
```

---

# 9. Funding Fit

输入：

```text
Self-pay Affinity
Host-funded Affinity
Transaction Sensitivity
Relationship Context
Host Budget
Scene Type
```

输出：

```text
SELF
AA
HOST
HOST_UPGRADE
MERCHANT_SPONSOR
MIXED
```

示例：

### X5 独立消费型

```text
Self-pay HIGH
Host-funded LOW
Transaction HIGH
```

推荐：

```text
AA > HOST_UPGRADE > HOST
```

### X6 Host-benefit 型

```text
Self-pay LOW
Host-funded HIGH
Transaction HIGH
```

推荐：

```text
HOST_UPGRADE / HOST
```

但 UI 只表达 Scene Benefit，不表达 Person Price。

---

# 10. Aesthetic Model 更新

拆成两个对象：

```text
SceneAestheticPotential
PersonalAestheticValue
```

例如 Rooftop：

```json
{
  "scene_aesthetic_potential": {
    "photo": 0.92,
    "ootd": 0.84,
    "background": 0.95,
    "social_post": 0.88
  }
}
```

对不同 Guest：

```text
X1 出片型 → Personal Value 0.93
X4 体验型 → Personal Value 0.62
```

---

# 11. Scene Composer 输入

正式输入：

```text
Host Vector
Guest Scene Vector
Trust Level
Scene Goal
Funding Mode
Host Budget
Guest Price Affinity
Merchant Inventory
Real Price
Time
Location
Relationship Context
```

---

# 12. Scene Composer 输出

```json
{
  "scene_type": "ROOFTOP_PHOTO",
  "merchant_id": "",
  "estimated_total": 420000,
  "funding_mode": "HOST_UPGRADE",
  "host_amount": 365000,
  "guest_amount": 55000,
  "duration_min": 150,
  "personal_aesthetic_value": 0.91,
  "host_gain_score": 0.76,
  "guest_gain_score": 0.89,
  "transaction_risk": 0.18,
  "participation_risk": 0.12,
  "unlock_required": "L2"
}
```

---

# 13. Scene Ranking

```text
Positive Value
=
User Scene Fit
× Funding Fit
× Price Fit
× Personal Aesthetic Value
× Host Gain
× Guest Gain
× Merchant Conversion
× Repeat Potential
```

Penalty：

```text
Transaction Risk
Participation Risk
Price Overreach
Unlock Violation
```

概念：

```text
Final Score
=
Positive Value
- Risk Penalties
```

---

# 14. P0 Engineering Input Checkpoints

所有 Scene 推荐 / 邀约发布前必须通过。

## CP-01 Identity / Access

输入：

```text
host_trust_level
guest_trust_level
required_unlock_level
```

检查：

```text
Host 是否有权限发起
Guest 是否有权限接收
Scene 是否超过双方当前 Level
```

Fail：

```text
ACCESS_LOCKED
```

---

## CP-02 Scene Independence

检查：

```text
目标 Guest 不参加时，
这个 Scene 是否仍然是一个真实消费 Scene？
```

Fail：

```text
PERSON_TRANSACTION_RISK
```

---

## CP-03 Funding Legitimacy

检查：

```text
钱是否进入真实 Merchant / Venue / Activity / Benefit
```

禁止：

```text
Direct Cash to Guest
Hourly Person Price
Guaranteed Person Participation for Cash
```

---

## CP-04 Price Fit

输入：

```text
real_market_price
host_budget
guest_category_price_affinity
scene_price_corridor
```

检查：

```text
价格是否真实
是否明显超出用户舒适价格
是否存在 Budget → Person Price 关系
```

---

## CP-05 Aesthetic Fit

输入：

```text
scene_aesthetic_potential
guest_scene_vector
```

输出：

```text
personal_aesthetic_value
```

如果 Guest 是 Photo-first，但 Scene 美学沉淀低：

```text
降低 Ranking
```

---

## CP-06 Funding Fit

检查：

```text
SELF / AA / HOST / HOST_UPGRADE
是否符合 Guest Funding Affinity
```

高 Transaction Sensitivity 时：

```text
优先 Scene Benefit 表达
避免金额前置
```

---

## CP-07 Host Gain

必须：

```text
host_gain_score > threshold
```

Host 不能只出钱。

必须至少有：

```text
Shared Time
Shared Activity
Host Identity
Relationship Opportunity
```

---

## CP-08 Guest Gain

必须：

```text
guest_gain_score > threshold
```

至少：

```text
Aesthetic
Experience
Benefit
Social Value
Convenience
```

---

## CP-09 Dignity / Transaction Risk

必须阻断：

```text
Payment → Ownership
Benefit → Emotional / Physical Obligation
```

输出：

```text
transaction_risk
```

超过阈值：

```text
BLOCK
```

---

## CP-10 Participation Risk

输入：

```text
Reliability
No-show history
Cancel history
Scene level
Duration
Price
```

高风险：

```text
降低 Budget Ceiling
需要再次确认
限制 Trip / Half-day
```

---

## CP-11 Merchant / Price Evidence

必须有：

```text
真实 Merchant
真实商品 / 服务
真实价格
真实取消规则
```

否则不能进入高信任 Host-funded Scene。

---

## CP-12 Benefit Unlock

规则：

```text
Benefit 不得在 Accept 后直接变成无条件可提现 / 可脱离 Scene 使用权益
```

默认：

```text
BOTH_CHECKED_IN
+
MERCHANT_VERIFIED
```

---

# 15. Invite Visibility Rules

不是所有信息都对所有人开放。

## New / L0

Guest 收到：

```text
Scene
时间
大概地点
Funding Mode
基础 Host 信息
```

## L1 / L2

增加：

```text
Host Reliability
Scene History Summary
双方共同 Club / Scene 信号
```

## L3+

增加：

```text
更完整 Scene Pattern
Repeat History（relationship scoped）
高级 Trip / Half-day
```

---

# 16. 邀约履历

前台不显示：

```text
谁给她花多少钱
跟多少男性约会
被拒绝几次
```

前台可显示：

```text
Completed 8 Scenes
Reliable Participant
Photo / Rooftop / Workshop
98% Confirmed Attendance
```

内部：

```text
invite_accept_rate
completion_rate
no_show_rate
host_repeat_rate
guest_repeat_rate
benefit_abuse_signal
```

---

# 17. 评价体系

不能做成传统 Dating Review。

不允许：

```text
颜值评分
身材评分
“值不值这个钱”
情感表现评分
亲密行为评价
```

只允许 Scene 行为维度：

```text
Arrived as agreed
Communication
Respect
Scene participation
Reliability
Would join another Scene
```

Merchant：

```text
Scene accuracy
Price accuracy
Aesthetic fit
Service
Redemption
```

---

# 18. Scene State Machine + Unlock

```text
DRAFT
→ COMPOSED
→ POLICY_CHECK
→ ACCESS_CHECK
→ INVITED
→ ACCEPTED
→ CONFIRMED
→ PAYMENT_READY
→ CHECKIN_PENDING
→ ACTIVE
→ BENEFIT_ACTIVE
→ CONSUMED
→ COMPLETED
→ MEMORY_CREATED
→ VECTOR_UPDATED
→ TRUST_UPDATED
→ REPEAT_ELIGIBLE
```

失败：

```text
ACCESS_LOCKED
PRICE_OVERREACH
PERSON_TRANSACTION_RISK
FUNDING_POLICY_BLOCK
NO_SHOW
DISPUTED
SAFETY_BLOCK
```

---

# 19. 核心数据对象新增

## UserSceneVector

```json
{
  "user_id": "",
  "aesthetic_drive": 0.0,
  "display_drive": 0.0,
  "peer_comparison": 0.0,
  "self_pay_affinity": 0.0,
  "host_funded_affinity": 0.0,
  "transaction_sensitivity": 0.0,
  "reliability": 0.0,
  "scene_affinity": {},
  "price_affinity": {},
  "updated_at": ""
}
```

## TrustProfile

```json
{
  "user_id": "",
  "level": "L2",
  "completed_scenes": 4,
  "no_show_rate": 0.0,
  "cancel_rate": 0.08,
  "reliability": 0.91,
  "unlocked_features": [
    "HOST_SPONSORED",
    "INVITE_HISTORY_SUMMARY",
    "MID_BUDGET_SCENE"
  ]
}
```

## SignalEvent

```json
{
  "signal_id": "",
  "user_id": "",
  "type": "CLUB_JOIN",
  "source": "WEEKEND_PHOTO",
  "weight": 0.40,
  "confidence": 0.60,
  "effects": {},
  "created_at": ""
}
```

---

# 20. P0

必须：

```text
Club Signal
User Scene Vector
Trust Level
Unlock Gate
Scene Goal
Budget
Funding Mode
Price Fit
Aesthetic Fit
Host Gain
Guest Gain
Transaction Risk
Scene Independence
Invite
Accept
Commitment
Check-in
Benefit Unlock
Scene Complete
Scene Memory
Vector Update
Trust Update
```

---

# 21. P1

```text
Advanced Club
Relationship-aware Ranking
Merchant Sponsored
Host Upgrade Intelligent Split
Trip / Half-day Unlock
Invite History Summary
Private Mutual Rating
Scene Reliability
Creator / Community Host
Premium Scene
```

---

# 22. 核心产品原则

```text
不问用户“你是谁”
通过用户愿意加入什么、选择什么、花什么、完成什么来理解她
```

```text
不让所有人一注册就拥有所有权力
高价值 / 高承诺 Scene 必须通过真实行为逐步解锁
```

```text
不公开敏感画像
User Scene Vector 只用于内部推荐与保护
```

```text
允许经济投入不对称
但不允许尊严不对称
```

```text
Pay for Scene
≠
Pay for Person
```

```text
Benefit
≠
Free Extraction
```

---

# 23. 最终工程架构

```text
CLUB / BEHAVIOR / SPEND / HISTORY
              ↓
        SIGNAL COLLECTOR
              ↓
       USER SCENE VECTOR
              ↓
        TRUST / UNLOCK
              ↓
HOST VECTOR × GUEST VECTOR
              ↓
 PRICE + FUNDING + MERCHANT
              ↓
        SCENE COMPOSER
              ↓
    12 ENGINEERING CHECKPOINTS
              ↓
            INVITE
              ↓
     COMMITMENT / CHECK-IN
              ↓
       BENEFIT / CONSUMPTION
              ↓
          SCENE MEMORY
              ↓
    VECTOR + TRUST UPDATE
              ↓
        BETTER NEXT SCENE
```

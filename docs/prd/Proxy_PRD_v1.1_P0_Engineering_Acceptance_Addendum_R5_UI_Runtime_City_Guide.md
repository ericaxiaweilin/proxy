# Proxy PRD v1.1 — P0 Engineering Acceptance Addendum R5

**状态**：CURRENT ADDITIVE ENGINEERING GATE · R5  
**依赖**：P0 Engineering Acceptance Addendum R3 FINAL ALIGNED  
**原则**：R5 不替代 R3 的 Cash / Outcome / Material Change Gate，也不删除 R4；R5 增加实际可达性、UI 运行时安全、偏好记忆和城市同行 / 持证导游场景验收。

---

## AC-P0-17 — Semantic Entry Resolves Interaction Policy

每个新 Need 必须先解析到一个可审计的交互策略：

```text
QUICK_EXECUTE
GUIDED
CONVERSATIONAL_BUILD
```

生产实现不得依赖 UI 关键词硬编码直接决定业务真相。

---

## AC-P0-18 — Minimum Human Input / Material Confirmation

系统可自动获得的非重大事实不得强制用户重复填写。

会改变以下任一项的推断必须在 Commit 前显式确认：

```text
price
location
time
scope
hard requirement
settlement
eligibility-impacting facts
safety / risk material facts
```

---

## AC-P0-19 — Consumer UI Does Not Expose Internal Inference States by Default

消费者主链不得把：

```text
INFERRED
UNKNOWN
AI FILLED
TaskSlot
EligibilityDecision
```

当作默认信息架构。

允许在真正需要确认时使用自然语言：

```text
Proxy 已帮你补全
需要你确认
```

---

## AC-P0-20 — Candidate Card Is Task-Adaptive

候选卡第一层只允许展示：

```text
current offer price
fulfillment rate
satisfaction rate
completed count
ETA / distance when relevant
1–3 task-specific capability proofs when needed
```

禁止默认显示不可解释综合匹配百分比。

标准化服务可以省略能力证明；能力型任务再展开。

---

## AC-P0-21 — Promotion Cannot Change Eligibility

```text
Eligibility
→ finite candidate admission
→ organic ranking
→ optional paid exposure
```

任何推广候选必须已通过本单资格筛选。

消费者标识建议：

```text
推广 · 已通过本单筛选
```

---

## AC-P0-22 — Progressive Satisfaction

Outcome / Satisfaction 首屏只要求：

```text
Outcome: achieved / partial / not achieved
Reuse intent: yes / maybe / no
```

只有负向 / 不确定选择才展开原因。

系统已知事实（到场、准时、取消、完成时间、证据等）不得要求用户再次用“好 / 一般 / 差”评分。

R3 `Recovery Before Retention` 保持有效。

---

## AC-P0-23 — Activity Is a Main Task-Domain Function

前台：

```text
任务
├─ 需求
└─ 活动
```

活动不得作为 Home 上的长期功能说明卡。

---

## AC-P0-24 — Activity / Paid Task Separation

```text
Activity = shared real-world participation
Task = one human owes capability / time / outcome to requester
```

付费能力需求不得因发生在餐厅 / 咖啡店就进入 Activity。

Activity 与 Task 可以共享 Venue Context。

---

## AC-P0-25 — P0 Activity Venue Gate

P0 Activity 只允许：

```text
CAFE
RESTAURANT
```

且：

```text
linked_merchant_id required
linked_venue_id required
```

消费者不能用自由文本绕过平台场景选择。

---

## AC-P0-26 — Activity Price and Venue Spend Are Separate

必须同时支持：

```text
activity_price = 0₫ or paid
venue_spend = independent
consumption_policy = split / host / package / subsidy
```

0₫ 不得被文案包装成“0₫互助”作为主卖点；它只是活动价格事实。

---

## AC-P0-27 — Activity Social Layer Is Action-Oriented

P0：

```text
Interested     REQUIRED
Share          REQUIRED
Activity Q&A   REQUIRED
Participant Chat after JOINED   REQUIRED
Verified Participant Review     REQUIRED / P0.5 allowed
```

禁止：

```text
public generic comments
like-count engagement ranking
unjoined public group chat
```

---

## AC-P0-28 — Platform Special Activities Are Ephemeral

`PLATFORM_SPECIAL` 不得作为长期活动分类频道。

只有存在真实企划时才渲染特别企划位；结束后撤下。

---

## AC-P0-29 — Merchant Promotion Is Relevance-Gated

商家付费只能提升已经适合当前活动的场景曝光。

```text
relevance / availability / scene fit
→ eligible merchant set
→ ranking
→ sponsored boost
```

不得用广告费绕过活动适配。

---

## AC-P0-30 — Single-Locale Consumer Surface

同一消费者 surface 必须使用单一 locale：

```text
zh-CN
vi-VN
en
```

内部枚举可保持英文，但不得直接泄漏到用户主流程。

品牌 `Proxy`、人名、商户固有名、标准证书名称可以保留原文。

---

## R4 Prototype Acceptance Set

至少可检查：

1. 酒后代驾进入快速执行；
2. 门店体验进入智能辅助；
3. 新店开业进入对话构建；
4. 重大推断要求确认；
5. 候选卡展示履约 / 满意 / 完成单量；
6. 候选卡按任务展示能力证明；
7. 不显示 `96% fit`；
8. 推广候选先通过资格；
9. Satisfaction 使用两问 + 渐进展开；
10. 活动位于任务一级功能；
11. 活动必须绑定平台咖啡店 / 餐厅；
12. 活动价格 0₫ 可正常展示；
13. 到店消费独立展示；
14. 感兴趣 / 分享 / 问答 / 参加后群聊可点击；
15. 需要专业能力时从 Activity 跳 Paid Task；
16. 中文原型主要消费者主链不混用英文工程术语。


---

## AC-P0-31 — Real Mainline Reachability, Not Registry Parity Only

不得仅以：

```text
nav count == screen count
```

作为页面完整性证明。

必须验证真实点击链：

```text
Need → Clarification → Solution Compare → Demand Preview → Settlement → Matching
Candidates → Candidate Compare → Candidate Detail → Offer
Outcome → Satisfaction → Memory / Repeat
```

所有 route target、onclick helper、render helper 必须存在且能实际推进状态。

---

## AC-P0-32 — Decision UI Must Not Degrade Into Admin Button Matrix

方案比较 / 候选比较禁止：

```text
每个对象一组 [选择] [排除]
```

消费者主决策必须采用：

```text
selectable card / row
+ clear selected state
+ one primary continue CTA
+ secondary detail / dismiss action
```

---

## AC-P0-33 — Memory Suggestion Requires Explicit Acceptance

`OUTCOME_SUGGESTED` 不得自动进入有效 RequesterMemory。

```text
Suggest → Remember → CONFIRMED
Suggest → Dismiss → DISMISSED
```

建议状态不得影响未来 Hard Requirement / eligibility / ranking，直到用户明确确认。

消费者 UI 不展示内部 `source:` / enum。

---

## AC-P0-34 — Localization Must Not Mutate Runtime Structure

本地化不得修改：

```text
STYLE
SCRIPT
class
id
route id
enum
JS variable
```

验收必须验证：

```text
CSS before == CSS after localization
route ids unchanged
class/id unchanged
no browser-default fallback controls caused by selector breakage
```

---

## AC-P0.5-35 — City Companion / Licensed Guide Classification Gate

城市同行请求必须在进入候选前分类：

```text
CITY_COMPANION_ALLOWED
LICENSED_GUIDE_REQUIRED
LEGAL_REVIEW_REQUIRED
REJECT
```

实际服务构成正式旅游导游时，不得以“城市同行 / 地陪”命名绕过导游资格要求。

---

## AC-P0.5-36 — Guide Qualification Is Eligibility

`LICENSED_GUIDE_REQUIRED` 时，候选必须满足配置中的导游资格策略。

至少验证：

```text
guide credential type
validity
language / scope compatibility
traveler type compatibility
required contractual / assignment evidence where applicable
```

资格失败不得通过 Boost / Sponsored / Trusted Relationship 绕过。

---

## AC-P0.5-37 — City Guide Pricing Transparency

必须分离：

```text
service price
included hours
overtime rule
transport expense
meal expense
ticket expense
merchant / venue spend
```

8 小时包不允许用一个总价隐藏重要额外费用。

---

## AC-P0.5-38 — City Guide Candidate Card Is Task-Adaptive

普通城市同行至少：

```text
offer price
fulfillment rate
satisfaction rate
completed city orders
language proof when material
```

持证导游 additionally：

```text
guide credential
validity / scope
language
relevant guide history
```

禁止人物长期价格橱窗与不可解释匹配分。

---

## AC-P0.5-39 — Route / Scene Commerce Cannot Become Forced Shopping

城市同行 / 导游订单可以推荐平台商家，但：

```text
relevance first
sponsorship disclosed
user can replace
no merchant commission changes guide eligibility
no forced purchase / forced shopping path
```

---

## AC-P0.5-40 — City Guide Outcome / Repeat

订单结束后至少形成：

```text
completed / partial / not achieved
reuse intent
actual duration
on-time facts
material route changes
visited merchant scenes
trusted-repeat signal
```

不得再次要求用户评价系统已经知道的准时 / 时长等事实。

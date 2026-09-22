# Proxy PRD v1.1
## P0 Engineering Acceptance Addendum R8 — Global Local Context

**状态**：P0 ENGINEERING GATE  
**依赖**：Canonical Registry R2.4 / Chapter 21H R2 / Acceptance R7

---

# Gate A — Root Shell

Consumer Root IA 仍为：

```text
首页 / 任务 / 动态 / 我的
```

Root surfaces：

```text
rhome
tasks
postfeed
me
ahome (Agent root)
```

必须：

- 显示当前 `LocalContext`；
- Root Tab 不显示 Back；
- 二级详情页才显示 Back。

---

# Gate B — LocalContext State

必须存在独立状态：

```text
LocalContext {
  market_id
  market_label
  area_id?
  area_label?
  source
  precision
}
```

不得把以下对象混成同一个字段：

```text
LocalContext
Device Location
Task Location
Order Meeting Point
Exact GPS Grant
```

---

# Gate C — City / Area Switching

P0 Prototype 至少演示：

```text
河内
北宁
胡志明市
```

切换后必须真实影响至少：

```text
Home local teaser
RECOMMENDED Feed
NEARBY Feed
new Post city scope
new local Need default context where applicable
```

不得只是改顶部文案而数据不变。

---

# Gate D — Feed Scope

`RECOMMENDED`：P0 可限定当前 Market。  
`NEARBY`：必须限定当前 Market，并按当前 Area / distance 排序。  
`FOLLOWING`：允许跨城，但当前 Market 可优先。

若没有足够定位精度，不得伪造精确距离。

---

# Gate E — Exact Location Privacy

全局 Local Context 最多到：

```text
CITY / COARSE_AREA
```

以下不得因浏览 Feed / Nearby 被自动公开：

```text
家庭地址
酒店房间
精确 GPS
订单集合点
代驾上车点
```

Exact Location 必须 Purpose Bound，并由 Task / Order 权限单独控制。

---

# Gate F — Task Truth Isolation

用户在首页从“河内”切换到“北宁”后：

- 已创建 Task 的地点不得被静默修改；
- 已确认 Order / Meeting Point 不得被重写；
- 新需求可以继承当前 LocalContext 作为默认值，但 Material Location 仍需按场景确认。

---

# Gate G — Home Semantics

首页 Hero 必须明确当前城市，例如：

```text
今天想在河内做什么？
```

“附近正在发生”必须能够解释附近属于哪个 Local Context。

Home ≠ Feed：只显示少量高价值本地 teaser。

---

# Gate H — Location Selector

必须支持：

```text
手动切换城市 / 区域
设备位置入口
当前位置 / 浏览位置来源说明
位置隐私说明
```

设备权限被拒绝时，手动城市选择仍可完成主要本地发现流程。

---

# Gate I — Existing Social Gates Preserved

R8 不取消 R7：

```text
Post / Activity boundary
Post → DM
Attribution lineage
Eligibility Before Ranking
Network Utility ranking
People Directory prohibition
Wallet secondary IA
```

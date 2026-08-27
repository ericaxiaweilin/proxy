# Proxy 模块分页触控逻辑｜技术概览与设计规范

## 1. 核心目标

Proxy 的模块内部采用**横向连续分页模型**，不采用传统的：

`进入详情 → 返回 → 重新选择分页`

交互方式。

统一逻辑：

**点击进入模块 → 左右滑动切换模块内部页面 → 返回退出整个模块**

模块应被理解为一个完整的连续空间，不是多个独立页面。

---

## 2. 信息架构

整体层级统一为：

```text
Proxy 首页
│
├── 同行
│   ├── Page 1
│   ├── Page 2
│   ├── Page 3
│   └── Page 4
│
├── 翻译
│   ├── Page 1
│   ├── Page 2
│   └── Page 3
│
├── 拍照
│
└── 礼品券
```

### 一级：模块 / 场景

操作：

```text
点击进入
```

例如：

- 同行
- 翻译
- 拍照
- 礼品券
- 消费场景

---

### 二级：模块内部分页

操作：

```text
← 左滑 / 右滑 →
```

例如同行：

```text
概览 ←→ 同行人 ←→ 行程 ←→ 状态
```

禁止使用：

```text
详情
↓
返回
↓
点击另一个页面
```

---

### 三级：页面内对象

操作：

```text
点击
```

例如：

- 点击同行人
- 点击商家
- 点击订单
- 点击礼券
- 点击某项功能

---

### 四级：内容浏览 / 临时操作

操作：

```text
上下滚动
弹层
Bottom Sheet
Dialog
```

原则上不要因为轻量操作继续创建新的深层页面。

---

# 3. 手势规范

## 横向滑动

负责：

**同一模块内部 Page 切换**

```text
Swipe Left  → 下一页
Swipe Right → 上一页
```

要求：

- 页面跟手移动
- 支持拖动进度
- 松手后自动吸附
- 不允许滑动结束后突然硬切换
- 第一页 / 最后一页加入轻微阻尼
- 默认禁止无限循环

---

## 纵向滑动

负责：

**当前 Page 内容滚动**

横向分页和纵向内容滚动必须分别处理。

需要避免：

```text
用户上下滚动时误触发左右翻页
```

建议：

当：

```text
|dx| > |dy| × threshold
```

才进入横向分页状态。

例如：

```text
horizontalGesture =
abs(dx) > abs(dy) * 1.2
```

进入横向锁定以后，本次 Gesture 不再切换成纵向。

---

# 4. 返回逻辑

返回操作只负责：

**退出当前模块**

例如：

```text
Proxy 首页
   ↓
同行模块
   ↓
当前处于 Page 3

执行返回

→ Proxy 首页
```

禁止：

```text
Page 3
返回
Page 2
返回
Page 1
返回
首页
```

分页不是导航历史。

---

# 5. 页面状态

模块需要保存：

```text
currentPage
scrollPosition
必要的页面临时状态
```

推荐默认：

```text
再次进入模块
→ 回到用户上次停留 Page
```

例如：

```text
同行 Page 3
→ 退出
→ 再次进入同行
→ Page 3
```

部分特殊模块可以配置：

```text
restorePage = false
```

重新从 Page 1 开始。

---

# 6. 分页组件设计

建议建立统一组件：

```text
ProxyModulePager
```

职责：

```text
Module Container
    ↓
Horizontal Pager
    ↓
Page
    ↓
Vertical Scroll / Content
```

建议接口：

```ts
ProxyModulePager({
  pages,
  initialPage,
  rememberPage,
  onPageChange,
  swipeEnabled
})
```

页面自身不负责：

```text
上一页
下一页
返回
分页历史
```

这些统一由 Pager 管理。

---

# 7. UI 导航规范

不采用传统 App 的重型 Tab Bar。

禁止设计成：

```text
[首页] [同行人] [行程] [状态]
```

避免让用户形成：

> 必须点击 Tab 才能导航

Proxy 应强调：

> 滑动就是主要分页方式。

---

## 推荐方案 A

顶部：

```text
同行                         2 / 4
```

简洁显示当前分页状态。

---

## 推荐方案 B

底部：

```text
—   ●   —   —
```

弱分页指示。

---

## 推荐方案 C

标题滑动：

```text
同行人    行程    状态
          ━━━━
```

允许点击标题跳转，但：

**点击只是辅助方式，滑动仍然是主要交互。**

---

# 8. 动画规范

分页动画原则：

```text
连续
跟手
轻
快速
无明显 AI / Web 页面感
```

建议：

```text
drag → follow finger
release → snap
```

动画时间：

```text
180–280ms
```

不要使用：

- Fade 切页
- 页面瞬间替换
- 大幅缩放
- 复杂 3D
- 卡片飞入
- 重阴影动画

Proxy 的感觉应该是：

**一个实体界面在横向移动。**

而不是：

**进入了另一张网页。**

---

# 9. 边界反馈

第一页：

```text
← 不允许继续翻
```

最后一页：

```text
→ 不允许继续翻
```

可以产生轻微：

```text
drag resistance
```

然后回弹。

不要：

```text
Page 4 → Page 1
```

除非某个模块明确要求循环模式。

---

# 10. 与页面点击的冲突处理

为了避免卡片点击与滑动冲突：

### 小位移

```text
dragDistance < threshold
```

判定为：

```text
Tap
```

### 大位移

```text
dragDistance >= threshold
```

判定为：

```text
Swipe
```

建议阈值：

```text
8–16px
```

根据设备实际 DPI 调整。

---

# 11. 嵌套横向组件规则

模块 Page 内原则上避免再出现：

```text
Horizontal Carousel
```

否则容易与主分页手势冲突。

如果必须存在横向列表：

例如：

```text
图片
商品
同行人头像
```

需要定义独立 Gesture Zone。

例如：

```text
Carousel 区域
→ 优先消费横向手势

页面其他区域
→ Pager 接管
```

不要让父子两层同时响应。

---

# 12. 技术实现原则

不要把模块分页做成多个 Router Page。

错误：

```text
/travel/overview
/travel/member
/travel/plan
/travel/status
```

然后通过 Router 跳转。

推荐：

```text
/travel
```

内部：

```text
Pager
├── Overview
├── Member
├── Plan
└── Status
```

即：

**Router 管模块。**

**Pager 管模块内部页面。**

这样：

- Back 行为简单
- 状态更稳定
- 滑动动画自然
- 不污染导航历史
- 更容易保持页面状态

---

# 13. Router 规范

Router 层只记录：

```text
Home
→ Module
→ 必要的独立 Detail
```

不记录：

```text
Module Page 1
Module Page 2
Module Page 3
```

因此：

```text
Browser Back
Android Back
iOS Back Gesture
Proxy Back Button
```

行为全部统一成：

```text
退出 Module
```

而不是回到上一个分页。

---

# 14. 模块标准数据结构

建议每个 Module 定义：

```ts
ModuleDefinition {
  id
  title
  icon
  pages[]
  initialPage
  rememberPage
  swipeEnabled
}
```

Page：

```ts
PageDefinition {
  id
  title
  component
}
```

例如：

```ts
travel = {
  id: "travel",
  title: "同行",
  rememberPage: true,
  pages: [
    Overview,
    Companion,
    Itinerary,
    Status
  ]
}
```

---

# 15. Proxy 全局交互原则

统一遵守：

```text
模块切换 → 点击

模块内分页 → 左右滑动

页面内浏览 → 上下滑动

对象操作 → 点击

轻量详情 → Bottom Sheet / Overlay

退出模块 → Back
```

不要让不同模块各自建立独立导航规则。

---

# 16. 最终体验目标

用户应该形成非常自然的肌肉记忆：

```text
看到一个 Proxy 功能
→ 点进去

想看这个功能的其他内容
→ 左右滑

想看更多当前内容
→ 上下滑

想操作某个东西
→ 点

想离开
→ 返回
```

最终目标：

**Proxy 不是传统“点击页面 + 返回页面”的 App。**

它应该更像：

**一个可以通过手势直接操控的连续工具界面。**

---

# 17. 架构层统一接入（2026-08-27 新增，不逐个模块改）

此前 `voucher` 作为 `7667206` 试点直接 `import { ProxyModulePager }`，导致“券能滑、动态/市场不能滑”。

**已回退**：`apps/mobile/src/surfaces/voucher.tsx` 已 `git checkout 1d2629f` 回到 R3 纯审核视觉（`tabs` + `VoucherFamilyMark`，无 `Pager`），与 `Proxy_App_Design_System_R3_Visual.html` 一致。

**新增架构**：
- `apps/mobile/src/architecture/paginated-module.tsx` — `PaginatedModuleShell` + `tabsToPagerPages`，模块只声明 `pages`，滑动由架构注入
- `apps/mobile/src/architecture/module-registry.ts` — `PAGINATED_MODULES` 注册表，新增分页模块只需在此加一条（`id/pages`），`App Shell` 自动包裹
- 原则：`ProxyModulePager` 不再由各 `surface` 直接 `import`，改为架构层统一托管；`Router` 管模块，`Pager` 管 Page，符合 §12。

迁移示例（券，已验证）：
```ts
// 审核视觉保持不变，仅交互由架构接管
import { tabsToPagerPages, PaginatedModuleShell } from "../architecture/paginated-module";
const pages = tabsToPagerPages({ tabs: ["AVAILABLE","USED","EXPIRED"] as const, activeTab: tab, renderPage: (t)=> <VoucherListPage tab={t} .../> });
return <PaginatedModuleShell definition={{ id:"voucher", pages }} onExit={onBack} />;
```
后续 `动态: 推荐/关注`、`市场: 机会/活动`、`任务: 全部/我参与` 等同理在 `module-registry.ts` 追加即可。
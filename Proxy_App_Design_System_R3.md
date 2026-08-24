# Proxy App Design System R3 — 全 App 视觉 / UX / Icon / Typography 规范

> 这是后续所有 Proxy 原型的唯一基准。任何页面在进入功能细化前，先满足本规范。

## 0. 一句话原则

**真实对象 > 真实状态 > 下一动作 > 解释。** 视觉上强调“真人、时间、资产、连接”；不把页面做成 AI 功能说明书。

---
## 1. 品牌资产

### 1.1 正式 Proxy Logo
- 资产：**黑色圆角方块 + 白色水獭脸**。
- Header：32×32px。
- 普通品牌入口：44×44px。
- Proxy 中心一级入口：56×56px。
- 分享/营销：64–80px。
- **禁止**：外面再套蓝/紫/绿背景；裁切水獭；重绘五官；把启动轮廓水獭当模块 Logo。

### 1.2 启动/登录 Mascot
- 使用已审核的水獭轮廓，只用于启动、登录、极少数品牌空状态。
- 允许低频眨眼；不进入 Composer，不作为模块图标。

### 1.3 Logo 安全区
- 正式 Logo 四周至少保留 **0.25× Logo 宽度** 的空白。
- Logo 与 Proxy 字标并排：间距 10px；字标使用 `Page H2` 或 `Card Title`，不得另做装饰字体。

---
## 2. Typography — 字体必须锁死

### 2.1 字体族
```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;
font-variant-numeric: tabular-nums;
```
- 中文：优先 PingFang SC / 系统中文。
- 英文与数字：优先 SF Pro / Segoe UI。
- **不引入 Inter、Poppins 等额外字体作为产品依赖**；原型可预览，但生产以系统字体为基准。

### 2.2 字体 Token

| Token | Size | Line-height | Weight | Tracking | 用途 |
|---|---:|---:|---:|---:|---|
| Display | 40px | 48px | 900 | -0.040em | 启动/登录品牌标题 |
| Page H1 | 28px | 34px | 900 | -0.035em | 一级页面标题，如「我的」 |
| Page H2 | 24px | 30px | 900 | -0.030em | 二级页标题，如「Creator 经营」 |
| Section | 17px | 24px | 800 | -0.015em | 区块标题 |
| Card Title | 15px | 21px | 800 | -0.010em | 模块名、对象名 |
| Object Title | 14px | 20px | 800 | 0 | Creator/券/活动名称 |
| Body | 14px | 20px | 500 | 0 | 正文和说明 |
| Meta | 12px | 17px | 500 | 0 | 时间、来源、二级信息 |
| Caption | 11px | 15px | 600 | 0 | 标签、辅助信息；全 App 最小正文级别 |
| Button | 14px | 18px | 800 | 0 | 主要/次要按钮 |
| Nav | 10px | 12px | 600 | 0 | 底部导航文字，仅此处允许 10px |
| Number XL | 28px | 32px | 900 | -0.020em | 销售额/主 KPI |
| Number L | 20px | 24px | 900 | -0.015em | 卡片 KPI |

**硬规则：**
- 除 Bottom Nav 外，**任何可读正文不得小于 11px**。
- 390px 原型里禁止再出现 6–9px 正文。
- 同一卡片最多 3 个字号层级。
- 数字采用 tabular numbers，避免 KPI 跳动。
- 一级模块卡只允许：模块名 + 一行真实状态；禁止放功能介绍长句。

---
## 3. Color — 两个品牌强调体系 + 中性色

| Token | HEX | 用途 |
|---|---|---|
| Brand Pink | `#FF2474` | Gradient 起点 |
| Brand Violet | `#8533F5` | Gradient 终点 |
| Brand Gradient | `135deg #FF2474 → #8533F5` | 少量身份/Creator/品牌识别 |
| Signal Lime | `#D6FB24` | 行动、缺口、券、可调度、关键状态 |
| Ink | `#17131F` | 主文字 / 深色发送按钮 |
| Deep | `#17131D` | 今日/核心摘要卡 |
| BG | `#F7F4F9` | 页面背景 |
| Panel | `#FFFFFF` | 卡片 |
| Soft | `#F4F0F6` | 次级标签 |
| Line | `#E6DFEB` | 1px 边框 |
| Muted | `#7E7586` | 次级文字 |

- 禁止每模块一种颜色。
- 禁止大面积蓝色作为 Proxy 主色。
- **所有卡片默认无阴影：`box-shadow:none`。**
- 状态色是信息色，不扩展成新的品牌色体系。

---
## 4. Shape / Grid / Size

| 对象 | 尺寸 / 规则 |
|---|---|
| 基准 viewport | 390×844 |
| 页面左右边距 | 16px |
| 区块间距 | 16–20px |
| 卡片间距 | 10–12px |
| 普通卡圆角 | 20–24px |
| 小卡/标签圆角 | 12–16px / pill 999px |
| 边框 | 1px `Line` |
| 阴影 | **0** |
| 一级 2 列模块卡 | `calc((100%-10px)/2)`，**1:1 正方形** |
| 一级模块 icon box | 56×56px，radius 16px |
| 行式模块 icon box | 44×44px，radius 14px |
| 详情页对象 avatar/icon | 48–52px |
| Touch target | 最小 44×44px |

### 4.1 一级模块卡布局
- `display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;`
- Icon、模块名、状态全部**水平居中**。
- Icon 到模块名 12px；模块名到状态 6px。
- 卡片内部不能左一块右一块，除非它是单行 `wide row`。

---
## 5. Icon System — 不再临时画图标

### 5.1 统一绘制规则
- 画板：24×24。
- 线宽：**2.2px**。
- `stroke-linecap: round; stroke-linejoin: round; fill:none`。
- 图形视觉尺寸：24–28px；放在 56px icon box 中默认 26px。
- 禁止 emoji、Unicode 字符（例如“券”“P”“✦”）充当模块图标。
- 禁止同一语义在不同页面换图形。
- 模块图标只使用 2 种容器：`Brand Gradient` 或 `Signal Lime`；Proxy 中心例外，直接使用正式 Logo。

### 5.2 全 App 模块 Icon Registry

| 分组 | 模块 | 固定图形 | Icon 容器 | 一级卡状态行 |
|---|---|---|---|---|
| 全局导航 | **首页** | `home` | 无彩底/导航中性色 | 回到主入口 |
| 全局导航 | **市场** | `diamond` | 无彩底/导航中性色 | 进入交易/需求市场 |
| 全局导航 | **动态** | `target` | 无彩底/导航中性色 | 进入动态流 |
| 全局导航 | **消息** | `chat` | 无彩底/导航中性色 | 使用聊天气泡，禁止信封 |
| 全局导航 | **我的** | `me-ring` | Brand Gradient | 身份与个人/商家资产入口 |
| 首页模式 | **体验** | `target` | 无彩底/导航中性色 | 模式，不作为独立彩色模块 |
| 首页模式 | **机会** | `diamond` | 无彩底/导航中性色 | 模式，不作为独立彩色模块 |
| 首页模式 | **活动** | `ring` | 无彩底/导航中性色 | 模式，不作为独立彩色模块 |
| 用户 · 我的 | **礼品券** | `cup` | Signal Lime | 显示可用张数与去使用 |
| 用户 · 我的 | **主页与二维码** | `profile-ring` | Brand Gradient | Proxy 名片、二维码、公开资料 |
| 用户 · 我的 | **社媒与联系** | `arrow-up-right` | Signal Lime | TikTok / Zalo / Instagram 等 |
| 用户 · 我的 | **访问与转化** | `route` | Signal Lime | 来源 → 主页 → 聊天/订单 |
| 用户 · 我的 | **好友与关系** | `target` | Brand Gradient | 好友、请求、关系发现 |
| 用户 · 我的 | **添加好友** | `plus` | Signal Lime | 二维码、邀请、通讯录 |
| 用户 · 我的 | **我的订单** | `diamond` | Brand Gradient | 发布/参与/成交订单 |
| 用户 · 我的 | **能力与可用时间** | `clock` | Signal Lime | 能力、区域、空闲时间 |
| 用户 · 我的 | **我的活动** | `ring` | Signal Lime | 已参加/我发起 |
| 用户 · 我的 | **关注与收藏** | `star` | Signal Lime | 人、商家、动态、活动 |
| 用户 · 我的 | **钱包与结算** | `coin` | Signal Lime | 付款、收入、退款 |
| 用户 · 我的 | **设置与隐私** | `gear` | Signal Lime | 通知、权限、隐私、安全 |
| 商家 · 我的 | **Creator 经营** | `target` | Brand Gradient | 真人 / 档期 / 到店 / 带客 |
| 商家 · 我的 | **券** | `ticket` | Signal Lime | 金额 / 到期 / 领取人 / 核销态 |
| 商家 · 我的 | **活动导流** | `arrow-up-right` | Signal Lime | 空档 / 锁人 / 缺口 / 券码 |
| 商家 · 我的 | **线上店铺** | `store-lines` | Brand Gradient | 关注 / 访问 / 内容 / 转化 |
| 商家 · 我的 | **销售中心** | `coin` | Signal Lime | 销售 / 新客 / 复购 / 来源 |
| 商家 · 我的 | **经营** | `spark` | Signal Lime | 待办 / 草稿 / 记录 / 复盘 |
| 商家 · 我的 | **Proxy 中心** | `正式水獭 Logo` | 正式 Logo | 必须使用正式水獭品牌 Logo |

### 5.3 通用 Action Icon

| 动作 | 图形 | 尺寸 |
|---|---|---:|
| 返回 | chevron-left | 24px |
| 关闭 | X | 24px |
| 信息 | i-circle | 22–24px，**禁止用邮箱表示通知/信息** |
| 相机/图片 | camera | 24px |
| 语音 | microphone | 24px |
| 发送 | arrow-up | 24px |
| QR | qr-grid | 24px |
| 更多 | horizontal ellipsis | 24px |

---
## 6. Module Card Content Rules

### 6.1 一级模块卡
必须只有 3 层：
1. 固定 Module Icon。
2. Module Name。
3. **一行真实状态**。

示例：
- Creator 经营 → `24 人 · 5 核心`
- 券 → `4 张进行中 · 1 张今天到期`
- 活动导流 → `3 个档期 · 缺 4 位小美`
- 线上店铺 → `8,426 关注 · 今日 1,284 访问`
- 销售中心 → `今日 12.6M · 新客 18`
- 经营 → `3 待办 · 5 草稿`

禁止：`真人 / 档期 / 到店 / 带客` 这类功能介绍作为状态行。

### 6.2 二级页
进入模块后，第一屏必须出现真实业务对象或真实趋势，不得再次出现“关系 / 权益 / 邀约 / 表现”四个空按钮。

---
## 7. Object Patterns — 真实业务对象的固定结构

### 7.1 Creator Card
`真人头像 48–52` + 姓名/昵称 + 空闲时间标签 + 最近到店 + 带客 + 内容更新 + 影响消费 + 状态。

### 7.2 券 Asset Card
`券种 icon` + 真实券名 + 金额/权益 + 有效期 + 当前领取人 + 已领取/已核销 + 实时状态。**四种券是创建时的类型，不是商家首页固定四格。**

### 7.3 活动导流 Card
档期 + 场景名 + 需要小美数 + 已锁真人头像/名字 + 缺口 + 定向券 + 预估/实际到店结果。

### 7.4 Online Store
店铺预览 + 关注数 + UV/PV + 流量来源 + 访问→行为→到店/消费漏斗 + 热门内容缩略卡 + 店铺管理。

### 7.5 Sales
销售额 + 订单/客单/新客/复购 + 来源拆分。Creator/券/活动来源必须可反查到真实对象。

---
## 8. Navigation / Interaction

- Bottom Nav 固定 5 项：首页 / 市场 / 动态 / 消息 / 我的。
- 消息必须是 **chat bubble**，不用 envelope。
- 一级页面保留 Bottom Nav；进入二级业务详情后可隐藏 Bottom Nav，使用顶部返回。
- 一级模块**整卡可点击**，不额外塞“查看”。
- 重要数字、来源、状态都应可点击穿透。
- 身份切换只放「我的」底部。用户“个人状态”是市场状态，不是身份切换。
- Press 状态：背景变 `Soft` 120–160ms；不浮起、不加阴影。

---
## 9. Composer

- 输入框内只有：**相机/图片、语音、发送**。
- 相机/语音：白底 + 黑色线性 icon。
- 发送：Ink 黑底 + 白箭头。
- 不放水獭，不用粉紫渐变，不用红色。

---
## 10. Copy / Voice

一级页面文案只表达：**对象、状态、时间、动作、结果**。

禁止：
- 智能辅助 / 智能诊断 / 高级洞察 / 核心业务 / 支撑模块 / 一眼看清 / 帮你经营 / 经营得更好。

允许：
- `周二 14:00–17:00 还缺 2 位小美`
- `4 张券今天到期`
- `Linh 周三全天可调`
- `Creator 带来 3.2M 销售`

---
## 11. Motion

- 页面切换：180–220ms。
- Press：120–160ms。
- 启动水獭：低频眨眼。
- 禁止卡片漂浮、光晕、弹跳、呼吸阴影。

---
## 12. Accessibility / QA

- Touch ≥44px。
- 正文 ≥11px，Body 推荐 14px。
- 文字/背景对比符合常规移动端可读性。
- 颜色不能是唯一状态编码，必须同时有文字。
- 每页上线前检查：Logo 正确 / Icon Registry 正确 / Font Token 正确 / 无阴影 / 一级卡居中 / 二级页有真实对象 / 数据可穿透 / 无废话 / 无 6–9px 正文。

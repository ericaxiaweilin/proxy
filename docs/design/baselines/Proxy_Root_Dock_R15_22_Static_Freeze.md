# Proxy Root Dock R15.22 静态冻结基线

冻结时间：2026-08-29

状态：`STATIC_UI_APPROVED` / `MOTION_INCOMPLETE`

本版本是继续开发液态交互的可回滚基线，不代表动态效果完成。

## 冻结来源

- 页面参考：`docs/design/references/proxy_dock_liquid_glass_v6.html`
- 生产实现：`apps/mobile/src/shell/app-shell.tsx`
- 冻结时生产实现 SHA-256：`4a864917d2b1e734f7ea066a136de7a13ba96eb03884aa96bdb83ce2e50821e6`
- Icon Registry：`apps/mobile/src/components/proxy-icon.tsx`
- 自动检查：`REPO_ROOT="$PWD" go -C apps/api-go run ./cmd/gatecheck liquid-dock`

## 已审核并冻结

- Root 顺序固定：首页 / 市场 / 动态 / 消息 / 我的。
- 图标继续使用 `ProxyIcon` 注册表，不换成 SF Symbol、emoji 或临时 SVG。
- iPhone 基准：水平边距 14，最大宽度 430，常规高度 68。
- Dock 内边 edge 6；5 个等宽 slot。
- Lens 宽 `min(64, slotWidth - 6)`，高度 54，必须在 slot 中心。
- Dock 连续圆角 34；Lens 连续圆角 28。
- Dock 使用 native clear glass；Lens 使用 native regular glass。
- 无旧式卡片阴影；保留极细边框与四向折射高光。
- 静态 UI、图标、标签、badge 和点击切换可继续作为开发基线。

## 明确未完成

1. 按压时水滴没有达到可感知、自然的局部膨胀。
2. 横向拖动时只完成几何拉伸/压缩/倾斜，尚未产生光线随形扭曲和折射迁移。
3. 尚未建立慢速拖动、快速甩动、反向中断和 Reduce Motion 的完整 motion matrix。

## MinMax M3 允许修改

- `RootNav` 内 Lens 的按压/拖动动画参数和动画值。
- Lens 内部折射层、sheen、glint、tint 随动画值的变化。
- 专属 motion helper/test；不得改业务页面。

## 禁止修改

- Root Tab 数量、顺序、route/page sequence、点击结果。
- `ProxyIcon` 名称、路径、大小和品牌 Logo。
- Dock/Lens 静态尺寸、位置、圆角、边距和未按压状态。
- Feed、Market、Messages、Me、认证、数据和 API。
- 增加未安装依赖；如确需依赖，先单独提交依赖变更，不与 motion patch 混合。

## 动态效果验收

- 按下 80–140ms 内 Lens 中心膨胀，松手无跳变并弹回冻结尺寸。
- 拖动时 Lens 沿速度方向拉伸，垂直轻压；边缘高光、sheen 和 tint 同方向迁移，表现为折射而非普通缩放。
- 慢拖无抖动；快速甩动最多跨到合法相邻/目标 tab；中途反向不闪烁。
- 图标/文字不被 Lens 形变裁切，不随折射层模糊。
- Reduce Motion 下关闭扭曲，仅保留短距离淡化/位移。
- iPhone 15 真机录屏；60fps 观察无明显 JS 卡顿。
- `pnpm --filter @proxy/mobile typecheck`、Metro bundle 与 `check-liquid-dock-baseline` 通过。

## 回滚

动态实现失败时只回滚 MinMax motion patch，恢复本冻结提交；不得回退五导航、页面手势或其他模块。

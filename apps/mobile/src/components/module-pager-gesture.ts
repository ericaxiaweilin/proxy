// Proxy 模块分页触控规范（docs/design/Proxy_Module_Pagination_Touch_Spec.md）§3/§10 的纯函数层。
// 手势判定与 UI 解耦，全部可单测；组件层 module-pager.tsx 只消费这些判定结果。

/** 规范 §3：|dx| > |dy| × 1.2 才进入横向分页锁定。 */
export function shouldLockHorizontal(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) * HORIZONTAL_LOCK_RATIO;
}

export const HORIZONTAL_LOCK_RATIO = 1.2;

/** 规范 §10：小位移判 Tap、大位移判 Swipe，阈值按 DPI 调整（默认 12px）。 */
export const TAP_SLOP_PX = 12;

export type SwipeDecision = "tap" | "next" | "prev" | "none";

/**
 * 松手时的最终决策。
 * - tap：位移在 tap 阈值内 → 交给子元素的 onPress
 * - next/prev：横向锁定位移超过页宽的 snapRatio 或速度达标
 * - none：未锁横向或位移不足
 */
export function decideSwipe(input: {
  dx: number;
  dy: number;
  pageWidth: number;
  vx?: number;
}): SwipeDecision {
  const { dx, dy, pageWidth, vx = 0 } = input;
  if (!shouldLockHorizontal(dx, dy)) return "none";
  if (Math.abs(dx) <= TAP_SLOP_PX && Math.abs(vx) < 0.5) return "tap";
  const distanceThreshold = pageWidth * SNAP_DISTANCE_RATIO;
  const fastFlick = Math.abs(vx) >= FLICK_VELOCITY_PX_PER_MS;
  if (fastFlick || Math.abs(dx) > distanceThreshold) {
    return dx < 0 ? "next" : "prev";
  }
  return "none";
}

/** 规范 §8：吸附动画 180–280ms。 */
export const SNAP_MS_MIN = 180;
export const SNAP_MS_MAX = 280;
export const SNAP_DISTANCE_RATIO = 0.35;
export const FLICK_VELOCITY_PX_PER_MS = 0.5;

// —— 规范 §4/§13「返回统一退整个模块」的触屏形态：右滑过头退出 ——
// 第 1 页继续向右拖会越过边界阻尼（offset.x 变负）；松手时越界深度超过
// 阈值即提交退出。只读原生滚动事件，不与子页面/翻页手势竞争。

/** 松手时右滑超过页宽该比例即提交退出，否则回弹。 */
export const EXIT_COMMIT_RATIO = 0.32;

/**
 * 退出松手决策：仅接受向右（overscroll 为正）且超过阈值的滑动；
 * 不足阈值或方向不对一律留在模块内，绝不误触。
 */
export function decideExitRelease(input: { overscrollPx: number; pageWidth: number }): "exit" | "none" {
  return input.overscrollPx > 0 && input.overscrollPx > input.pageWidth * EXIT_COMMIT_RATIO ? "exit" : "none";
}

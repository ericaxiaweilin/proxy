// 核心操作最短路径 — 架构层统一，非逐模块
// 依据：docs/design/Proxy_Module_Pagination_Touch_Spec.md §15
// 点进 → 左右滑（分页） → 上下滑（浏览） → 点（对象） → 返回（退模块）
//
// 本文件不含 UI，仅定义可测试的纯规则，供 App Shell 与各 Module 共享
// 具体手势阈值在 module-pager-gesture.ts，导航规则在 module-registry.ts

export type CoreAction =
  | { type: "ENTER_MODULE"; moduleId: string }
  | { type: "SWIPE_PAGE"; direction: "next" | "prev" }
  | { type: "SCROLL_PAGE"; direction: "up" | "down" }
  | { type: "TAP_OBJECT"; objectId: string }
  | { type: "OPEN_SHEET"; objectId: string }
  | { type: "EXIT_MODULE" };

export type CoreActionCost = {
  steps: number;
  requiresTap: number;
  requiresSwipe: number;
  requiresScroll: number;
};

// 最短路径度量：进入模块后，横向分页只滑不点，纵向浏览只滚不点，对象只点一次，退出只按一次返回
export function measureCorePath(actions: CoreAction[]): CoreActionCost {
  let steps = actions.length;
  let requiresTap = actions.filter((a) => a.type === "ENTER_MODULE" || a.type === "TAP_OBJECT").length;
  let requiresSwipe = actions.filter((a) => a.type === "SWIPE_PAGE").length;
  let requiresScroll = actions.filter((a) => a.type === "SCROLL_PAGE").length;
  return { steps, requiresTap, requiresSwipe, requiresScroll };
}

// 校验：模块内分页必须用 SWIPE_PAGE，不能用 ENTER_MODULE + TAP_OBJECT 模拟“返回再进”
export function isPaginationViaSwipe(actions: CoreAction[]): boolean {
  return actions.every((a) => a.type !== "ENTER_MODULE" || a.moduleId !== "same-module-page");
}

// 校验：退出必须用 EXIT_MODULE（Back 统一退模块），不能逐页返回
export function isExitViaSingleBack(actions: CoreAction[]): boolean {
  const exits = actions.filter((a) => a.type === "EXIT_MODULE");
  return exits.length <= 1;
}

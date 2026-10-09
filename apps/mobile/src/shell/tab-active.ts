import { createContext, useContext, useEffect, useRef } from "react";

// TAB-KEEP-ALIVE-001：根 tab 访问过就一直挂着，只是隐藏。子树用这个知道「我现在是否可见」，
// 隐藏时要暂停会产生副作用的东西（浏览停留计时、轮询…），否则后台的 tab 会在悄悄计数。
export const TabActiveContext = createContext(true);

export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}

/**
 * 回到这个 tab 时刷新数据——但只有隐藏超过 minIdleMs 才刷（来回快速切不重复拉网）。
 * 首次挂载不触发（页面自己的 effect 已经拉过了）。
 */
export function useOnTabActivated(refresh: () => void, minIdleMs = 30_000): void {
  const active = useTabActive();
  const hiddenAt = useRef<number | undefined>(undefined);
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!active) {
      hiddenAt.current = Date.now();
      return;
    }
    const since = hiddenAt.current;
    hiddenAt.current = undefined;
    if (since !== undefined && Date.now() - since >= minIdleMs) latest.current();
  }, [active, minIdleMs]);
}

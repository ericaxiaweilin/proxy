import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { LocalNetClient } from "./localnet-client";
import { endPostView } from "./post-impression";

// CONTENT-ANALYTICS-001（2026-09-23，用户：「检查日志链路是否完整…小美 a 发了一个帖文…几百点赞 几千上万浏览」）：
// 链路审计发现：整个 App 只有「他人主页」的全屏看图会上报曝光 / 停留，动态信息流 —— 浏览量真正来自的地方 ——
// 一条都不报，战绩里的「浏览」基本全是 0。这里补上信息流卡片曝光：
//   - 卡片可见 ≥ 50%（比屏幕还高的卡按占屏 50% 算）开始计时；
//   - 离开视口 / 页面卸载 / App 切后台 时结算，停留 < 0.8 秒算一划而过，不记（不然快速滑动刷出一堆假浏览）；
//   - 自己的帖子不记；开关（隐私与数据 → 动态浏览统计）关了 endPostView 自己短路。

export const MIN_IMPRESSION_MS = 800;

export type CardFrame = { y: number; height: number };

// 当前视口里「算看到了」的帖子。
export function visiblePostIds(cards: Readonly<Record<string, CardFrame>>, scrollY: number, viewportHeight: number): Set<string> {
  const out = new Set<string>();
  if (viewportHeight <= 0) return out;
  for (const [postId, frame] of Object.entries(cards)) {
    if (frame.height <= 0) continue;
    const top = frame.y - scrollY;
    const visible = Math.max(0, Math.min(top + frame.height, viewportHeight) - Math.max(top, 0));
    if (visible >= Math.min(frame.height, viewportHeight) * 0.5) out.add(postId);
  }
  return out;
}

export function useFeedImpressions(localNet: Pick<LocalNetClient, "recordPostImpression">, visible: ReadonlySet<string>): void {
  const started = useRef(new Map<string, number>());
  const latestVisible = useRef<ReadonlySet<string>>(visible);
  latestVisible.current = visible;
  const flush = (postId: string, startedAt: number): void => {
    if (Date.now() - startedAt < MIN_IMPRESSION_MS) return;
    void endPostView(localNet, postId, startedAt);
  };
  useEffect(() => {
    const now = Date.now();
    for (const [postId, startedAt] of started.current) {
      if (!visible.has(postId)) {
        started.current.delete(postId);
        flush(postId, startedAt);
      }
    }
    for (const postId of visible) {
      if (!started.current.has(postId)) started.current.set(postId, now);
    }
  });
  useEffect(() => {
    const flushAll = (): void => {
      for (const [postId, startedAt] of started.current) flush(postId, startedAt);
      started.current.clear();
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        flushAll();
        return;
      }
      // 回到前台：屏幕上还是那几张卡，重新开始计时（后台那段不算停留）。
      const now = Date.now();
      for (const postId of latestVisible.current) started.current.set(postId, now);
    });
    return () => { sub.remove(); flushAll(); };
    // localNet 变了才重挂；flush 读的是 ref。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localNet]);
}

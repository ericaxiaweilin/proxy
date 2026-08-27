// 架构层统一右滑退出 — 任意全屏子页无需各自写 Back，仅包一层即得
// 依据：Proxy_Module_Pagination_Touch_Spec.md §4/§13（Back 统一退模块）+ §3 横竖分离
import { useRef } from "react";
import { PanResponder, View, useWindowDimensions } from "react-native";
import { decideExitRelease } from "../components/module-pager-gesture";
import { shouldStartSwipeBack } from "./swipe-back-gesture";

export function SwipeBackShell({ onExit, children }: { onExit: () => void; children: React.ReactNode }): React.JSX.Element {
  const { width } = useWindowDimensions();
  const widthRef = useRef(width);
  const exitRef = useRef(onExit);
  widthRef.current = width;
  exitRef.current = onExit;
  const overscroll = useRef(0);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // 只允许从系统返回边缘开始，避免抢占照片横滑、筛选 rail 和横向分页。
      onMoveShouldSetPanResponder: (_, g) => shouldStartSwipeBack({ startX: g.x0, dx: g.dx, dy: g.dy }),
      onPanResponderGrant: () => {
        overscroll.current = 0;
      },
      onPanResponderMove: (_, g) => {
        if (g.dx > 0) overscroll.current = Math.max(overscroll.current, g.dx);
      },
      onPanResponderRelease: (_, g) => {
        // PanResponder 右滑 vx 为正；纯规则沿用 contentOffset 语义（右滑为负）。
        if (decideExitRelease({ overscrollPx: overscroll.current, pageWidth: widthRef.current, velocityPxPerMs: -g.vx }) === "exit") {
          exitRef.current();
        }
        overscroll.current = 0;
      },
      onPanResponderTerminate: () => {
        overscroll.current = 0;
      },
    })
  ).current;
  return <View style={{ flex: 1 }} {...responder.panHandlers}>{children}</View>;
}

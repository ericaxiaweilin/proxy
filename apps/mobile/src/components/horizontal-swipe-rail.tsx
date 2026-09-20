// R15.34.2: HorizontalSwipeRail — 通用横滑 rail 容器 (PanResponder 隔离)
//
// 解决问题：
//   当 rail 放在 app-shell (iOS 上是 native UITabBar) / PAGE_SEQUENCE
//   容器内, 水平 ScrollView 的横滑手势会被外层 (iOS 系统 tab 切换 /
//   Android panResponder 切页) 抢走 — 用户横滑会切 tab 而不是滚
//   rail 内容。
//
//   feed (R15.3) / recommend mode (R15.34) 的 filter chip rail 已经
//   解决过 — 用 PanResponder.create 拦截 dx 主导手势, 自己驱动
//   scrollTo()。本组件把这套机制抽出来给所有横滑内容用：
//     - 推荐人 stories (小圆形 avatar 横滑)
//     - 推荐人 cards (portrait card 横滑)
//     - feed 的多图横滑 (AdaptiveMediaCollection 的 ScrollView)
//     - 任何未来需要横滑且不能被外层切 tab 抢的场景
//
// 用法：
//   <HorizontalSwipeRail contentContainerStyle={...} style={...}>
//     {items.map((x) => <View key={x.id}>...</View>)}
//   </HorizontalSwipeRail>
//
// 内部已用 ref + onScroll 维护 scrollX 状态, 调用方不需要管。
//
// 关键参数：
//   - threshold: 触发"接管横滑"的 dx 阈值。默认 6 (跟 app-shell
//     切页的 onMoveShouldSetPanResponder 阈值一致, 这样我们比
//     切页先反应过来)。
//   - 垂直手势 (|dy| > |dx|) 不拦 — 父级 ScrollView 仍能正常滚。

import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { PanResponder, ScrollView, StyleSheet, View, type NativeSyntheticEvent, type NativeScrollEvent, type StyleProp, type ViewStyle } from "react-native";

export interface HorizontalSwipeRailProps {
  children: ReactNode;
  // ScrollView style — 默认 {}
  style?: StyleProp<ViewStyle>;
  // contentContainerStyle — 默认 { paddingRight: 18 }
  contentContainerStyle?: StyleProp<ViewStyle>;
  // 是否展示横滑指示器 — 默认 false
  showScrollIndicator?: boolean;
  // 触发"接管横滑"的 dx 阈值 — 默认 6
  threshold?: number;
  // 轨道内有按钮时，轻点必须交给子项；只有真正横移后才接管。
  preserveChildPresses?: boolean;
  // MEDIA-RAIL-NEST-001: 以下三个是给"需要吸附对齐"的调用方（目前只有
  // AdaptiveMediaRail）用的可选透传——本组件内部已经有一个真实 ScrollView，
  // 调用方不应该再在 children 外面套第二个 ScrollView（那会导致两层横滑
  // 手势/滚动位置打架，帖子多图轮播曾经因此整个不显示）。
  onMomentumScrollEnd?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  snapToOffsets?: number[];
  snapToAlignment?: "start" | "center" | "end";
  decelerationRate?: "fast" | "normal" | number;
}

export const HorizontalSwipeRail = forwardRef<ScrollView, HorizontalSwipeRailProps>(function HorizontalSwipeRail({
  children,
  style,
  contentContainerStyle,
  showScrollIndicator = false,
  threshold = 6,
  preserveChildPresses = false,
  onMomentumScrollEnd,
  snapToOffsets,
  snapToAlignment,
  decelerationRate
}, forwardedRef) {
  const railRef = useRef<ScrollView>(null);
  useImperativeHandle(forwardedRef, () => railRef.current as ScrollView);
  const railScrollXRef = useRef(0);
  // 手指 1:1 基准：grant 瞬间快照当前偏移，整个手势内都用
  // “快照 - 手指累计位移”。之前误用持续更新的 railScrollXRef
  // 做被减数——手动 scrollTo 触发的 onScroll 会回写它，导致位移
  // 被重复累加，内容比手指跑得快（轻滑就飞出去）。
  const railGrantXRef = useRef(0);
  // R15.34.3: 全面更激进的 PanResponder 隔离。
  //   onStartShouldSetPanResponder: () => true  — start 就抢手势
  //     (避免 iOS 26 系统 tab 切换手势在 start 阶段赢走事件)。
  //   onMoveShouldSetPanResponder: 保留 dx>dy 判定 — 垂直手势不能拦
  //     (否则父 ScrollView 上下滚都动不了)。
  //   onMoveShouldSetPanResponderCapture: 同样规则, 但 Capture 阶段
  //     先下手为强 (iOS RN 的 responder 顺序有时 Capture 优先)。
  //   onShouldBlockNativeResponder: true  — 拒绝让 RN 把触摸下沉到 native
  //     子 View (iOS 26 tab bar 可能会跨 layer 抢手势)。
  //   onPanResponderTerminationRequest: () => false  — 拒绝外部抢走。
  const railPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !preserveChildPresses,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > Math.abs(gs.dy) && (!preserveChildPresses || Math.abs(gs.dx) > threshold),
      onMoveShouldSetPanResponderCapture: (_, gs) => Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > threshold,
      onPanResponderGrant: () => {
        // 快照 grant 时刻的偏移；move 全程只认它，保证严格 1:1。
        railGrantXRef.current = railScrollXRef.current;
      },
      onPanResponderMove: (_, gs) => {
        // 横滑时由本组件消费, 不让外层 PAGE_SEQUENCE / iOS 系统
        // tab 切换手势抢占。松手即停，不加额外惯性——手指多快内容多快。
        railRef.current?.scrollTo({ x: railGrantXRef.current - gs.dx, animated: false });
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true
    })
  ).current;

  return (
    <View {...railPanResponder.panHandlers} style={styles.capture}>
      <ScrollView
        ref={railRef}
        horizontal
        showsHorizontalScrollIndicator={showScrollIndicator}
        contentContainerStyle={contentContainerStyle}
        style={style}
        onScroll={(e) => {
          railScrollXRef.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
        {...(onMomentumScrollEnd ? { onMomentumScrollEnd } : {})}
        {...(snapToOffsets ? { snapToOffsets } : {})}
        {...(snapToAlignment ? { snapToAlignment } : {})}
        {...(decelerationRate !== undefined ? { decelerationRate } : {})}
      >
        {children}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  // R15.34.2: 外层 capture — 仅承担 PanResponder 拦截, 无视觉
  capture: {}
});

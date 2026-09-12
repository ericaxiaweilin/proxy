import { registerRootComponent } from "expo";
import { createElement } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { ProxyApp } from "./native-app";

export * from "./demand-client";
export * from "./requester-experience";

// UI-SAFEAREA-001: 全 app insets 一直是 0 —— 顶栏品牌行被状态栏 / Dynamic Island
// 吃掉（实测 ax frame y=9，即 paddingTop 8 起排），所有页面整体上移 59pt / 下移 34pt。
//
// 根因：这里原先手搓 SafeAreaFrameContext / SafeAreaInsetsContext，值取
// `initialWindowMetrics`，取不到就兜底全 0。而 native 侧 RNCSafeAreaContext.mm 的
// getConstants 在 TurboModule 初始化时用 RCTKeyWindow() 读 window.safeAreaInsets；
// RN 0.86 bridgeless 下这个时机 key window 还没就绪 → 返回 NSNull →
// `initialWindowMetrics === null` → 上下文永远是 0。
//
// 修法：交给库自带的 SafeAreaProvider。它的原生 provider 视图在 layoutSubviews 后经
// onInsetsChange 上报真实 insets（Fabric 事件路径，不依赖那个 eager 常量）。
// 若 initialWindowMetrics 意外缺失，用 initialSafeAreaInsets 兜底 0，保证首帧有值
// （不会白屏、不比现状更差），随后仍由原生事件纠正。
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

function ProxyRoot(): React.JSX.Element {
  const providerProps = initialWindowMetrics
    ? { initialMetrics: initialWindowMetrics }
    : { initialSafeAreaInsets: ZERO_INSETS };

  return createElement(
    SafeAreaProvider,
    providerProps,
    createElement(ProxyApp)
  );
}

registerRootComponent(ProxyRoot);

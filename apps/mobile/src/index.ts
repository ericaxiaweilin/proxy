import { registerRootComponent } from "expo";
import { createElement } from "react";
import { Dimensions } from "react-native";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  initialWindowMetrics
} from "react-native-safe-area-context";
import { ProxyApp } from "./native-app";

export * from "./demand-client";
export * from "./requester-experience";

function ProxyRoot(): React.JSX.Element {
  const window = Dimensions.get("window");
  const frame = initialWindowMetrics?.frame ?? {
    x: 0,
    y: 0,
    width: window.width,
    height: window.height
  };
  const insets = initialWindowMetrics?.insets ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  };

  // react-native-safe-area-context 5.7's native provider still dispatches its
  // initial onInsetsChange event through the legacy RCTEventEmitter path.
  // RN 0.86 bridgeless does not expose that callable module, so the event
  // red-screens before the application can mount. The synchronous native
  // constants contain the same launch metrics without emitting a view event.
  return createElement(
    SafeAreaFrameContext.Provider,
    { value: frame },
    createElement(
      SafeAreaInsetsContext.Provider,
      { value: insets },
      createElement(ProxyApp)
    )
  );
}

registerRootComponent(ProxyRoot);

import { registerRootComponent } from "expo";
import { createElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProxyApp } from "./native-app";

export * from "./demand-client";
export * from "./requester-experience";

function ProxyRoot(): React.JSX.Element {
  return createElement(SafeAreaProvider, null, createElement(ProxyApp));
}

registerRootComponent(ProxyRoot);

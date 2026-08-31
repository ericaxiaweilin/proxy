import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { View } from "react-native";

export type ProxyNativeTabSelectEvent = { index: number };

export type ProxyNativeTabBarProps = ViewProps & {
  selectedIndex: number;
  onTabSelect?: (event: NativeSyntheticEvent<ProxyNativeTabSelectEvent>) => void;
};

// Non-iOS fallback. AppShell renders this component only in its iOS branch,
// but this file keeps TypeScript and Android module resolution safe.
export function ProxyNativeTabBarView(props: ProxyNativeTabBarProps): React.JSX.Element {
  return <View pointerEvents="none" style={props.style} />;
}

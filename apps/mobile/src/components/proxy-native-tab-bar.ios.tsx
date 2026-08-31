import { requireNativeView } from "expo";
import type { ProxyNativeTabBarProps } from "./proxy-native-tab-bar";

export const ProxyNativeTabBarView = requireNativeView<ProxyNativeTabBarProps>("ProxyNativeTabBar");

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const shellPath = resolve(root, "apps/mobile/src/shell/app-shell.tsx");
const iosEntryPath = resolve(root, "apps/mobile/src/components/proxy-native-tab-bar.ios.tsx");
const moduleConfigPath = resolve(root, "apps/mobile/modules/proxy-native-tab-bar/expo-module.config.json");
const swiftViewPath = resolve(root, "apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift");
const swiftModulePath = resolve(root, "apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarModule.swift");
const podspecPath = resolve(root, "apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBar.podspec");

const errors = [];
for (const file of [shellPath, iosEntryPath, moduleConfigPath, swiftViewPath, swiftModulePath, podspecPath]) {
  if (!existsSync(file)) errors.push(`missing native liquid dock baseline file: ${file}`);
}

if (!errors.length) {
  const shell = readFileSync(shellPath, "utf8");
  const iosEntry = readFileSync(iosEntryPath, "utf8");
  const swift = readFileSync(swiftViewPath, "utf8");
  const config = readFileSync(moduleConfigPath, "utf8");
  const requirements = [
    [shell, "import { ProxyNativeTabBarView }", "AppShell must import the native iOS tab bar"],
    [shell, 'if (Platform.OS === "ios")', "AppShell must keep an explicit iOS native branch"],
    [shell, "<ProxyNativeTabBarView", "iOS branch must render the native tab bar"],
    [shell, "<GlassContainer", "Android fallback dock must remain available"],
    [iosEntry, 'requireNativeView<ProxyNativeTabBarProps>("ProxyNativeTabBar")', "iOS entry must bind the Expo native view"],
    [swift, "UITabBarDelegate", "native dock must be backed by UITabBar"],
    [swift, "UITabBarAppearance", "native dock must use the system tab appearance"],
    [swift, "onTabSelect", "native tab selection must return to React Native"],
    [config, "ProxyNativeTabBarModule", "Expo autolinking config must register the module"]
  ];
  for (const [source, needle, message] of requirements) {
    if (!source.includes(needle)) errors.push(message);
  }
}

if (errors.length) {
  console.error(`Liquid dock baseline failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Liquid dock baseline passed: iOS native UITabBar + Android fallback are intact.");

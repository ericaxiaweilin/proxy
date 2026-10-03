package main

import (
	"fmt"
	"strings"
)

// liquidDockPaths are the files the R15.22 static freeze is made of. Deleting
// one of them is how "the native dock was quietly replaced by the JS dock" looks.
var liquidDockPaths = []string{
	"apps/mobile/src/shell/app-shell.tsx",
	"apps/mobile/src/components/proxy-native-tab-bar.ios.tsx",
	"apps/mobile/modules/proxy-native-tab-bar/expo-module.config.json",
	"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift",
	"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarModule.swift",
	"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBar.podspec",
}

func init() { checks["liquid-dock"] = liquidDock }

func liquidDock(root string, _ []string) error {
	sources := map[string]string{}
	var missing []string
	for _, rel := range liquidDockPaths {
		body, err := read(root, rel)
		if err != nil {
			missing = append(missing, rel)
			continue
		}
		sources[rel] = body
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing native liquid dock baseline file: %s", strings.Join(missing, ", "))
	}

	requirements := []struct{ file, needle, message string }{
		{"apps/mobile/src/shell/app-shell.tsx", "import { ProxyNativeTabBarView }", "AppShell must import the native iOS tab bar"},
		{"apps/mobile/src/shell/app-shell.tsx", `if (Platform.OS === "ios")`, "AppShell must keep an explicit iOS native branch"},
		{"apps/mobile/src/shell/app-shell.tsx", "<ProxyNativeTabBarView", "iOS branch must render the native tab bar"},
		{"apps/mobile/src/shell/app-shell.tsx", "<GlassContainer", "Android fallback dock must remain available"},
		{"apps/mobile/src/components/proxy-native-tab-bar.ios.tsx", `requireNativeView<ProxyNativeTabBarProps>("ProxyNativeTabBar")`, "iOS entry must bind the Expo native view"},
		{"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift", "UITabBarDelegate", "native dock must be backed by UITabBar"},
		{"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift", "UITabBarAppearance", "native dock must use the system tab appearance"},
		{"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift", "onTabSelect", "native tab selection must return to React Native"},
		{"apps/mobile/modules/proxy-native-tab-bar/expo-module.config.json", "ProxyNativeTabBarModule", "Expo autolinking config must register the module"},
	}
	var failures []string
	for _, req := range requirements {
		if !strings.Contains(sources[req.file], req.needle) {
			failures = append(failures, req.message)
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("Liquid dock baseline failed:\n- %s", strings.Join(failures, "\n- "))
	}
	fmt.Println("Liquid dock baseline passed: iOS native UITabBar + Android fallback are intact.")
	return nil
}

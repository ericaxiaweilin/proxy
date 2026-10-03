package main

// R15.22 root-dock static freeze. The gate reads six fixed paths, so a fixture
// tree can prove it is still capable of going red — which the real repo never
// shows, because the dock is currently intact.

import (
	"strings"
	"testing"
)

const dockAppShell = `import { Platform } from "react-native";
import { ProxyNativeTabBarView } from "../components/proxy-native-tab-bar";
import { GlassContainer } from "../components/glass-container";

export function AppShell({ tabs, active }: Props) {
  if (Platform.OS === "ios") {
    return <ProxyNativeTabBarView tabs={tabs} active={active} />;
  }
  return (
    <GlassContainer>
      {tabs.map((tab) => <TabCell key={tab.id} tab={tab} />)}
    </GlassContainer>
  );
}
`

const dockIosEntry = `import { requireNativeView } from "expo-modules-core";

const ProxyNativeTabBarView = requireNativeView<ProxyNativeTabBarProps>("ProxyNativeTabBar");
export { ProxyNativeTabBarView };
`

const dockSwiftView = `import ExpoModulesCore
import UIKit

final class ProxyNativeTabBarView: UIView, UITabBarDelegate {
  let tabBar = UITabBar()
  var onTabSelect: ((Int) -> Void)?

  override func didMoveToWindow() {
    let appearance = UITabBarAppearance()
    tabBar.standardAppearance = appearance
    tabBar.delegate = self
  }
}
`

func dockFixture() map[string]string {
	return map[string]string{
		"apps/mobile/src/shell/app-shell.tsx":                                        dockAppShell,
		"apps/mobile/src/components/proxy-native-tab-bar.ios.tsx":                    dockIosEntry,
		"apps/mobile/modules/proxy-native-tab-bar/expo-module.config.json":           "{\"name\":\"proxy-native-tab-bar\",\"iosModules\":[\"ProxyNativeTabBarModule\"]}\n",
		"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift":   dockSwiftView,
		"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarModule.swift": "import ExpoModulesCore\n\nfinal class ProxyNativeTabBarModule: Module {}\n",
		"apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBar.podspec":     "Pod::Spec.new do |s| end\n",
	}
}

func TestLiquidDockGateAcceptsIntactNativeDock(t *testing.T) {
	if err := liquidDock(fixtureRoot(t, dockFixture()), nil); err != nil {
		t.Fatalf("liquid-dock gate rejected an intact native dock: %v", err)
	}
}

// The freeze is exactly this claim: the iOS dock is the native UITabBar, not the
// JS dock. Deleting the native view is how a silent replacement looks.
func TestLiquidDockGateRejectsDeletedNativeView(t *testing.T) {
	files := dockFixture()
	delete(files, "apps/mobile/modules/proxy-native-tab-bar/ios/ProxyNativeTabBarView.swift")
	err := liquidDock(fixtureRoot(t, files), nil)
	if err == nil {
		t.Fatal("liquid-dock gate passed with the native tab bar view deleted")
	}
	if !strings.Contains(err.Error(), "missing native liquid dock baseline file") {
		t.Fatalf("unexpected failure: %v", err)
	}
}

func TestLiquidDockGateRejectsMissingNativeBranch(t *testing.T) {
	files := dockFixture()
	files["apps/mobile/src/shell/app-shell.tsx"] = strings.Replace(
		dockAppShell, `if (Platform.OS === "ios")`, `if (Platform.OS === "web")`, 1)
	err := liquidDock(fixtureRoot(t, files), nil)
	if err == nil {
		t.Fatal("liquid-dock gate passed when the iOS native branch was retargeted")
	}
	if !strings.Contains(err.Error(), "explicit iOS native branch") {
		t.Fatalf("unexpected failure: %v", err)
	}
}

// The Android fallback dock is a separate claim: the native module only ships on
// iOS, so removing GlassContainer leaves Android with no dock at all.
func TestLiquidDockGateRejectsRemovedAndroidFallback(t *testing.T) {
	files := dockFixture()
	files["apps/mobile/src/shell/app-shell.tsx"] = strings.Replace(
		dockAppShell, "<GlassContainer>", "<View>", 1)
	err := liquidDock(fixtureRoot(t, files), nil)
	if err == nil {
		t.Fatal("liquid-dock gate passed with the Android fallback dock removed")
	}
	if !strings.Contains(err.Error(), "Android fallback") {
		t.Fatalf("unexpected failure: %v", err)
	}
}

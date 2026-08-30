import ExpoModulesCore

public class ProxyNativeTabBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ProxyNativeTabBar")

    View(ProxyNativeTabBarView.self) {
      Events("onTabSelect")
      Prop("selectedIndex") { (view: ProxyNativeTabBarView, index: Int) in
        view.setSelectedIndex(index)
      }
    }
  }
}

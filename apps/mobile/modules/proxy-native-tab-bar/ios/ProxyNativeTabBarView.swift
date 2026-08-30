import ExpoModulesCore
import UIKit

final class ProxyNativeTabBarView: ExpoView, UITabBarDelegate {
  private let tabBar = UITabBar(frame: .zero)
  private let onTabSelect = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    clipsToBounds = false

    tabBar.delegate = self
    tabBar.isTranslucent = true
    tabBar.clipsToBounds = false

    let labels = ["首页", "市场", "动态", "消息", "我的"]
    let symbols = ["house", "diamond", "circle.circle", "message", "person.crop.circle"]
    tabBar.items = symbols.enumerated().map { index, symbol in
      let item = UITabBarItem(title: nil, image: UIImage(systemName: symbol), tag: index)
      item.accessibilityLabel = labels[index]
      return item
    }

    // UIKit owns the live backdrop sampling and iOS Liquid Glass selection
    // lens. React Native overlays the approved Proxy SVG glyphs and labels.
    // Keeping the native glyphs transparent preserves native item geometry,
    // hit testing and the system lens without replacing Proxy's icon system.
    let appearance = UITabBarAppearance()
    appearance.configureWithDefaultBackground()
    for itemAppearance in [
      appearance.stackedLayoutAppearance,
      appearance.inlineLayoutAppearance,
      appearance.compactInlineLayoutAppearance
    ] {
      itemAppearance.normal.iconColor = .clear
      itemAppearance.selected.iconColor = .clear
      itemAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor.clear]
      itemAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor.clear]
    }
    tabBar.standardAppearance = appearance
    tabBar.scrollEdgeAppearance = appearance

    addSubview(tabBar)
    setSelectedIndex(0)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    tabBar.frame = bounds
  }

  func setSelectedIndex(_ index: Int) {
    guard let items = tabBar.items, !items.isEmpty else { return }
    let safeIndex = min(max(index, 0), items.count - 1)
    if tabBar.selectedItem !== items[safeIndex] {
      tabBar.selectedItem = items[safeIndex]
    }
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    onTabSelect(["index": item.tag])
  }
}

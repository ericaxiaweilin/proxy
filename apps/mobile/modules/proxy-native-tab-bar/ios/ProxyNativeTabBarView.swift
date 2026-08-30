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
    tabBar.tintColor = .label
    tabBar.unselectedItemTintColor = .secondaryLabel
    tabBar.backgroundColor = .clear
    tabBar.isOpaque = false
    tabBar.clipsToBounds = false

    let labels = ["首页", "市场", "动态", "消息", "我的"]
    tabBar.items = labels.enumerated().map { index, label in
      let item = UITabBarItem(title: label, image: Self.proxyTabImage(index: index), tag: index)
      item.accessibilityLabel = labels[index]
      if index == 3 {
        item.badgeValue = "9+"
      }
      return item
    }

    // UIKit owns both the approved Proxy glyphs/labels and Liquid Glass.
    // Do not add a React overlay here: two renderers cause duplicated tabs.
    applyLiquidAppearance()

    addSubview(tabBar)
    setSelectedIndex(0)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let size = tabBar.sizeThatFits(bounds.size)
    tabBar.frame = CGRect(x: 0, y: bounds.height - size.height, width: bounds.width, height: size.height)
  }

  private func applyLiquidAppearance() {
    if #available(iOS 13.0, *) {
      let appearance = UITabBarAppearance()
      appearance.configureWithTransparentBackground()
      // Use a system material blur to achieve the liquid glass effect.
      appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterial)
      appearance.backgroundColor = .clear
      appearance.shadowColor = .clear

      for itemAppearance in [
        appearance.stackedLayoutAppearance,
        appearance.inlineLayoutAppearance,
        appearance.compactInlineLayoutAppearance
      ] {
        itemAppearance.normal.iconColor = .secondaryLabel
        itemAppearance.selected.iconColor = .label
        itemAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor.secondaryLabel]
        itemAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor.label]
      }

      tabBar.standardAppearance = appearance
      if #available(iOS 15.0, *) {
        tabBar.scrollEdgeAppearance = appearance
      }
    } else {
      // iOS 12 and earlier fallback: keep translucency and remove default shadow/background
      tabBar.barStyle = .default
      tabBar.isTranslucent = true
      tabBar.backgroundImage = UIImage()
      tabBar.shadowImage = UIImage()
      tabBar.backgroundColor = .clear
    }
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    // Re-apply appearance to adapt to style changes (e.g., dark/light mode).
    applyLiquidAppearance()
  }

  func setSelectedIndex(_ index: Int) {
    guard let items = tabBar.items, !items.isEmpty else { return }
    let clamped = max(0, min(index, items.count - 1))
    let target = items[clamped]
    if tabBar.selectedItem !== target {
      tabBar.selectedItem = target
    }
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    onTabSelect(["index": item.tag])
  }

  private static func proxyTabImage(index: Int) -> UIImage? {
    let size = CGSize(width: 24, height: 24)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { context in
      let path = UIBezierPath()
      path.lineWidth = 2.2
      path.lineCapStyle = .round
      path.lineJoinStyle = .round
      UIColor.black.setStroke()

      switch index {
      case 0: // home
        path.move(to: CGPoint(x: 4, y: 10.5)); path.addLine(to: CGPoint(x: 12, y: 4)); path.addLine(to: CGPoint(x: 20, y: 10.5))
        path.move(to: CGPoint(x: 6.5, y: 10)); path.addLine(to: CGPoint(x: 6.5, y: 19)); path.addLine(to: CGPoint(x: 17.5, y: 19)); path.addLine(to: CGPoint(x: 17.5, y: 10))
      case 1: // diamond
        path.move(to: CGPoint(x: 12, y: 4)); path.addLine(to: CGPoint(x: 20, y: 12)); path.addLine(to: CGPoint(x: 12, y: 20)); path.addLine(to: CGPoint(x: 4, y: 12)); path.close()
      case 2: // target
        path.append(UIBezierPath(ovalIn: CGRect(x: 5, y: 5, width: 14, height: 14)))
        path.append(UIBezierPath(ovalIn: CGRect(x: 9, y: 9, width: 6, height: 6)))
      case 3: // chat
        path.move(to: CGPoint(x: 5, y: 6)); path.addLine(to: CGPoint(x: 19, y: 6)); path.addLine(to: CGPoint(x: 19, y: 15)); path.addLine(to: CGPoint(x: 9, y: 15)); path.addLine(to: CGPoint(x: 5, y: 18)); path.close()
      default: // me ring
        path.append(UIBezierPath(ovalIn: CGRect(x: 8.6, y: 4.6, width: 6.8, height: 6.8)))
        path.move(to: CGPoint(x: 6.2, y: 19)); path.addCurve(to: CGPoint(x: 17.8, y: 19), controlPoint1: CGPoint(x: 7.4, y: 15.5), controlPoint2: CGPoint(x: 10, y: 13.7))
        path.append(UIBezierPath(ovalIn: CGRect(x: 3, y: 3, width: 18, height: 18)))
      }
      path.stroke()
      context.cgContext.setBlendMode(.normal)
    }.withRenderingMode(.alwaysTemplate)
  }
}

import Foundation
internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    // A physical iPhone cannot use Metro's localhost default.
    // Priority: launch environment `METRO_HOST` → Info.plist `MetroHost`
    // (per-build override) → Bonjour hostname.
    //
    // 为什么需要 override：手机侧 mDNS 缓存过旧地址时（实测把
    // Thanhs-MacBook-Air.local 解析成已失效的 10.20.30.223），packager status
    // 一直超时、拉不到 bundle，App 会回落内置/缓存旧 JS —— 表现就是「改了没生效，
    // 像装了个旧包」。此时把 Metro 指到 Mac 当前可达的 IPv4 即可。
    //
    // DEVICE-METROHOST-001（2026-09-12 事故）：曾经有人为了救急，把当时的 Mac IP
    // 写进 **受版本控制** 的 Info.plist 并提交（commit d4dadba），于是 Bonjour 兜底
    // 对所有人永久失效 —— 之后 IP 一变，真机就再也打不开。所以：
    //   * 受版本控制的 Info.plist **不得** 出现 `MetroHost`（门禁守门）。
    //   * 临时救急请用环境变量，它不需要改文件、不需要重编译：
    //       METRO_HOST=192.168.1.23 ./scripts/dev-ios-device.sh install
    //     或直接：
    //       xcrun devicectl device process launch -d <device> \
    //         -e '{"METRO_HOST":"192.168.1.23"}' com.proxy.creator.dev.c4673fy8u7
    //     （注意：只有从 devicectl / Xcode 启动才带得上环境变量；从桌面点图标启动
    //      走的是 Info.plist / Bonjour 兜底。）
    let envHost: String? = {
      let raw = ProcessInfo.processInfo.environment["METRO_HOST"] ?? ""
      return raw.isEmpty ? nil : raw
    }()
    let metroHost = envHost
      ?? (Bundle.main.object(forInfoDictionaryKey: "MetroHost") as? String)
      ?? "Thanhs-MacBook-Air.local"
    var components = URLComponents()
    components.scheme = "http"
    components.host = metroHost
    components.port = 8081
    components.path = "/.expo/.virtual-metro-entry.bundle"
    components.queryItems = [
      URLQueryItem(name: "platform", value: "ios"),
      URLQueryItem(name: "dev", value: "true"),
      URLQueryItem(name: "minify", value: "false"),
      URLQueryItem(name: "modulesOnly", value: "false"),
      URLQueryItem(name: "runModule", value: "true"),
    ]
    return components.url
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

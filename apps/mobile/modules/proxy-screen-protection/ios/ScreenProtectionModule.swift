import Foundation
import React

// Lotus RFC §4 — iOS 软告警 (无 FLAG_SECURE，只能检测后上报)
// 监听 UIApplication.userDidTakeScreenshotNotification，转发给 JS
@objc(ScreenProtection)
class ScreenProtection: RCTEventEmitter {
  private var hasListeners = false

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(didTakeScreenshot),
      name: UIApplication.userDidTakeScreenshotNotification,
      object: nil
    )
    // iOS 11+ screen capture 监听（录屏）
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(screenCaptureChanged),
      name: UIScreen.capturedDidChangeNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc override func supportedEvents() -> [String]! {
    return ["onScreenshotDetected", "userDidTakeScreenshot"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func enable() { /* iOS 无硬阻断，仅占位保证 JS 调用不崩 */ }
  @objc func disable() {}

  @objc private func didTakeScreenshot() {
    guard hasListeners else { return }
    sendEvent(withName: "onScreenshotDetected", body: nil)
    sendEvent(withName: "userDidTakeScreenshot", body: nil)
  }

  @objc private func screenCaptureChanged() {
    guard hasListeners else { return }
    if UIScreen.main.isCaptured {
      sendEvent(withName: "onScreenshotDetected", body: ["captured": true])
    }
  }

  @objc override static func requiresMainQueueSetup() -> Bool { return false }
}

package com.proxy.app

import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// Lotus RFC §4 — Android 硬阻断截屏/录屏 (FLAG_SECURE)
// JS 侧通过 NativeModules.ScreenProtection.enable/disable 控制；
// 截屏事件由 JS 侧的 screenshot-protection.ts 订阅，Android 侧 FLAG_SECURE 直接黑屏。
class ScreenProtectionModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName() = "ScreenProtection"

    @ReactMethod
    fun enable() {
        currentActivity?.runOnUiThread {
            currentActivity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    @ReactMethod
    fun disable() {
        currentActivity?.runOnUiThread {
            currentActivity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    // 可选：转发截屏检测给 JS（需 ContentObserver 实现，MVP 先由 JS 侧轮询/或仅用 FLAG_SECURE）
    private fun sendEvent(name: String) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, null)
    }
}

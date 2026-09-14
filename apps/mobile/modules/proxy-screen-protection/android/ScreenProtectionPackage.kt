package com.proxy.screenprotection

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

// Lotus RFC §4 — 手动注册包（prebuild 再生 MainApplication 时由
// with-screen-protection config plugin 重新插入 add(ScreenProtectionPackage())）。
class ScreenProtectionPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ScreenProtectionModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}

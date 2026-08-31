// Lotus RFC §4 — RN 防截屏 + 截屏告警 (iOS 软告警 + Android FLAG_SECURE 硬阻断)
// 客户端职责：
//  - screenshotProtected=true 的消息在 viewer 挂载时启用 FLAG_SECURE (Android) / overlay hint (iOS)
//  - 截屏发生时上报 POST /v1/commands/RecordScreenshot，经 conversation-client → server → SECURITY_ALERT

import { NativeModules, Platform } from "react-native";
import type { ConversationClient } from "../conversation-client";

type ScreenshotSubscription = { remove: () => void };

function hasNativeScreenProtection(): boolean {
  const m = (NativeModules as Record<string, unknown>).ScreenProtection as
    | { enable?: () => void; disable?: () => void }
    | undefined;
  return Boolean(m?.enable && m?.disable);
}

export function enableScreenshotProtection(): void {
  if (Platform.OS === "android" && hasNativeScreenProtection()) {
    (NativeModules as unknown as { ScreenProtection: { enable: () => void } }).ScreenProtection.enable();
  }
}

export function disableScreenshotProtection(): void {
  if (Platform.OS === "android" && hasNativeScreenProtection()) {
    (NativeModules as unknown as { ScreenProtection: { disable: () => void } }).ScreenProtection.disable();
  }
}

// iOS: 监听 RCTDeviceEventEmitter userDidTakeScreenshotNotification
// Android: 监听 Window callback (需原生侧转发). JS 侧提供统一订阅.
export function subscribeScreenshotEvent(callback: () => void): ScreenshotSubscription {
  // React Native 0.72+ iOS 会在截屏时触发 AppState? 这里用 NativeEventEmitter 占位,
  // 无原生模块时退化为 noop, 不影响构建.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeEventEmitter } = require("react-native") as { NativeEventEmitter: new (m: unknown) => { addListener: (ev: string, cb: () => void) => { remove: () => void } } };
    const emitter = new NativeEventEmitter(NativeModules.ScreenProtection ?? {});
    const sub = emitter.addListener("onScreenshotDetected", callback);
    // iOS 原生转发的备用事件名
    const sub2 = emitter.addListener("userDidTakeScreenshot", callback);
    return {
      remove() {
        sub.remove();
        sub2.remove();
      },
    };
  } catch {
    return { remove() {} };
  }
}

export function attachScreenshotReporter(conversationClient: ConversationClient, getVisibleMessageIds: () => string[]): ScreenshotSubscription {
  return subscribeScreenshotEvent(() => {
    const ids = getVisibleMessageIds();
    for (const id of ids) {
      void conversationClient.recordScreenshot(id).catch(() => {});
    }
  });
}

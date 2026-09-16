// 截图导出：把 view-shot 截出来的图落到相册，或交给系统分享面板。
//
// 为什么单独一个模块：这段逻辑原来在「我的二维码 / 邀请码 / 店铺码」三处各抄了一遍，
// 而三处抄的都是同一个坏调用 —— 坏一次等于坏三次，修也只修一处。
//
// 两个坑，都在这里说清楚：
//
// 1) `captureRef` 在 iOS 上返回的是**裸绝对路径**（`/var/mobile/.../tmp/ReactNative/xxx.png`），
//    没有 `file://` 前缀。相册模块对裸路径还算宽容（Expo 的 URL 转换会补成 file URL），
//    但系统分享面板拿到无 scheme 的 URL 时，能选的动作会少掉一截。统一补成真 file URL。
//
// 2) `MediaLibrary.saveToLibraryAsync` 在 expo-media-library@57 里是个**只会 throw 的占位实现**：
//    主入口 `src/index.ts` 结尾是 `export * from './legacyWarnings'`，把真实现盖掉了，
//    legacyWarnings 里每个函数都是 `throw errorOnLegacyMethodUse(...)`。
//    真实现在 `expo-media-library/legacy` 子路径。
//    也就是说 PROFILE-QR-002 最初那版「保存到相册」**在真机上从来没有成功过一次**：
//    调用即抛，相册里什么都没有。改用新 API `Asset.create()`（走 ExpoMediaLibraryNext 原生模块）。
//
// 注意：这里不写单测。源码级 grep 测试曾经让「保存坏了」这件事一路绿灯 —— 它证明的是
// 「这行代码还在」，不是「这个功能能用」。真正的验证只有一条：在真机上点一下，相册里有图。

import { Asset, requestPermissionsAsync } from "expo-media-library";

/** 截图工具给的是裸路径；补成 file:// 才能被分享面板/相册稳定识别。已带 scheme 的原样透传。 */
export function toFileUrl(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `file://${trimmed.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/**
 * 保存结果。权限不足和保存失败必须分开报 —— 前者要引导去设置，后者要重试，
 * 合成一句「保存失败请重试」会让用户对着一个永远不会好的按钮反复点。
 */
export type SaveImageToAlbumResult =
  | { ok: true }
  | { ok: false; code: "permission" | "failed"; reason: string };

/** 把本地图片存进相册。失败必须带回真实原因，不吞。 */
export async function saveImageToAlbum(uri: string): Promise<SaveImageToAlbumResult> {
  try {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) {
      return { ok: false, code: "permission", reason: "需要相册权限才能保存。" };
    }
    await Asset.create(toFileUrl(uri));
    return { ok: true };
  } catch (err) {
    return { ok: false, code: "failed", reason: describeError(err) };
  }
}

/** 原生错误的 message 是人话时就用它；否则给个能对上日志的字符串，不要吞成「未知错误」。 */
export function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return String(err);
}

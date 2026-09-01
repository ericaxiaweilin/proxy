// media-classify.ts — 纯逻辑媒体分类与共享类型（零 React Native / Expo 依赖）。
//
// 抽离自 media-client.ts：Vitest 单测不能触碰任何原生模块入口
// （react-native 的 Flow 语法会让 Rollup 解析失败）。凡是发帖链路里
// 需要在测试中使用的纯函数 / 类型，一律放这里，media-client.ts 只做
// re-export 保持既有 import 路径兼容。
//
// 内容：
//   - UploadableImage / UploadMediaType / MediaClient 等共享类型
//   - mediaTypeForMime：MIME → IMAGE/VIDEO/AUDIO 分类（含 GIF 显式 IMAGE）

export type UploadableImage = {
  uri: string;
  fileName?: string;
  mimeType?: string;
  width: number;
  height: number;
};

export type UploadMediaType = "IMAGE" | "VIDEO" | "AUDIO";

export type ResumableMediaUploadSession = {
  mediaAssetId: string;
  storageKey: string;
  uploadUrl: string;
  offset: number;
  totalBytes: number;
};

export function mediaTypeForMime(mimeType?: string): UploadMediaType {
  if (mimeType?.startsWith("video/")) return "VIDEO";
  if (mimeType?.startsWith("audio/")) return "AUDIO";
  return "IMAGE";
}

// GIF 虽是 image/*，走 IMAGE 通道（服务端按动画元数据单独准入）。
export function isAnimatedImageMime(mimeType?: string): boolean {
  return mimeType === "image/gif";
}

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

// TWIN-PHOTO-SIM-001: 下面两个纯解析函数供 Vitest 直测（media-client 里的方法
// 只是 command() 薄封装，直接 import 会拖进 expo 原生依赖）。服务端已按
// principal 过滤，客户端再按 IMAGE+READY 收紧，一张坏 item 不得吃掉整屏
//（坏的跳过，不是整包抛错）。
export type OwnReadyPhoto = { mediaAssetId: string; width: number; height: number };

export function parseOwnReadyPhotos(value: unknown): OwnReadyPhoto[] {
  if (!value || typeof value !== "object") return [];
  const assets = (value as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return [];
  const out: OwnReadyPhoto[] = [];
  for (const item of assets) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.mediaType !== "IMAGE" || row.processingStatus !== "READY") continue;
    if (typeof row.mediaAssetId !== "string" || row.mediaAssetId === "") continue;
    const width = typeof row.width === "number" ? row.width : 0;
    const height = typeof row.height === "number" ? row.height : 0;
    out.push({ mediaAssetId: row.mediaAssetId, width, height });
  }
  return out;
}

export type TwinPhotoResult = {
  mediaAssetId: string; width: number; height: number;
  simulated: boolean; template: string; sourceAssetId: string;
};

export function parseTwinPhotoResult(value: unknown): TwinPhotoResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  const asset = root.asset;
  if (!asset || typeof asset !== "object") return undefined;
  const row = asset as Record<string, unknown>;
  if (typeof row.mediaAssetId !== "string" || row.mediaAssetId === "") return undefined;
  // 诚实闸：仿真产物必须自带 twinSimulated 标记才认，否则调用方不得把它
  // 当成普通照片往下传（ badges/发布链路靠这个区分）。
  if (row.twinSimulated !== true || typeof row.twinPersonaId !== "string" || row.twinPersonaId === "") return undefined;
  return {
    mediaAssetId: row.mediaAssetId,
    width: typeof row.width === "number" ? row.width : 0,
    height: typeof row.height === "number" ? row.height : 0,
    simulated: true,
    template: typeof root.template === "string" ? root.template : "",
    sourceAssetId: typeof root.sourceAssetId === "string" ? root.sourceAssetId : "",
  };
}

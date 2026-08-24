import type { UploadableImage } from "./media-client";

export type DraftMediaStatus = "LOCAL" | "UPLOADING" | "READY" | "FAILED";

export type DraftMediaItem = {
  localId: string;
  image: UploadableImage;
  altText: string;
  status: DraftMediaStatus;
  progress?: number | undefined;
  mediaAssetId?: string | undefined;
  error?: string | undefined;
};

export function createDraftMedia(image: UploadableImage, localId: string): DraftMediaItem {
  return { localId, image, altText: "", status: "LOCAL" };
}

export function moveDraftMedia(items: readonly DraftMediaItem[], from: number, to: number): DraftMediaItem[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

export function pendingDraftMedia(items: readonly DraftMediaItem[]): DraftMediaItem[] {
  return items.filter((item) => item.status !== "READY" || !item.mediaAssetId);
}

export function draftMediaRefs(items: readonly DraftMediaItem[]): Array<{ mediaAssetId: string; sortOrder: number; altText?: string }> | undefined {
  if (items.some((item) => item.status !== "READY" || !item.mediaAssetId)) return undefined;
  return items.map((item, sortOrder) => ({
    mediaAssetId: item.mediaAssetId!,
    sortOrder,
    ...(item.altText.trim() ? { altText: item.altText.trim() } : {})
  }));
}

export function mediaStatusLabel(item: DraftMediaItem): string {
  if (item.status === "UPLOADING") return item.progress !== undefined && item.progress < 1
    ? `上传 ${Math.round(item.progress * 100)}%`
    : "服务端处理中…";
  if (item.status === "READY") return "已就绪";
  if (item.status === "FAILED") return "失败 · 可重试";
  return "待上传";
}

export function normalizeRestoredDraftMedia(items: readonly DraftMediaItem[]): DraftMediaItem[] {
  return items.map((item) => item.status === "UPLOADING"
    ? { ...item, status: "FAILED", progress: undefined, error: "上传在后台中断，请重试" }
    : { ...item });
}

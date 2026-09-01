// composer-publish.ts — ComposerV2Screen 的发布逻辑（无 RN 依赖，便于单测）。
//
// 抽离自 ComposerV2Screen.publish()。包含：
//   - body 序列化（assembleComposerBody）
//   - 上传 / 草稿 / 发布 命令拼装
//   - 24h 切换 / 投票 → schema 字段映射
//   - payload 的 idempotencyKey 生成
//   - applyUploadOutcomes（上传结果合并回 media）
//
// 调用方只需提供 localNet.createPost / mediaClient.uploadMedia 即可。
// ComposerV2Screen.publish() 目前仍以内联方式接入 upload（保留了 abort controller
// 与状态机的进度上报细节）；后续可以逐步迁移到 performPublish()，以复用本模块的单测覆盖。

import type { CreatePostPayload, FeedPost } from "@proxy/contracts";
import {
  type LocalNetClient
} from "./localnet-client";
import { mediaTypeForMime } from "./media-classify";
import type { MediaClient } from "./media-client";
import type { DraftMediaItem } from "./composer-media";
import { assembleComposerBody, parsePollDurationMs, shouldSerializePoll } from "./composer-body";
import type { AnyLocation } from "./components/location-picker-sheet";

export type ComposerDraftForPublish = {
  body: string;
  media: DraftMediaItem[];
  visibility: "PUBLIC" | "FOLLOWERS";
  includeCity: boolean;
  quoteTargetId: string | null;
  place: AnyLocation | null;
  topic: string | null;
  gifWord: string | null;
  poll: { open: boolean; options: string[]; durationLabel: string };
  isGhost24h: boolean;
};

export type UploadOutcome =
  | { kind: "ok"; localId: string; mediaAssetId: string }
  | { kind: "paused"; localId: string; message: string }
  | { kind: "cancelled"; localId: string }
  | { kind: "failed"; localId: string; message: string };

/**
 * 把媒体项上传到后端。仅处理非 READY 的项；已 READY 直接返回既有 mediaAssetId。
 * 由调用方传入"上传每个文件"的实现——这里只走 happy path（不抛错代表 ok）。
 *
 * 不在这里实现真实 abort controller；那是组件层的事。
 */
export async function uploadPendingMedia(
  items: DraftMediaItem[],
  mediaClient: MediaClient,
  onProgress?: (localId: string, progress: number) => void
): Promise<UploadOutcome[]> {
  const pending = items.filter((it) => it.status !== "READY" || !it.mediaAssetId);
  return Promise.all(
    pending.map(async (item) => {
      try {
        const mediaType = mediaTypeForMime(item.image.mimeType);
        const uploaded = await mediaClient.uploadMedia({
          ...item.image,
          mediaType,
          defaultMime: mediaType === "AUDIO" ? "audio/mp4" : mediaType === "VIDEO" ? "video/mp4" : "image/jpeg"
        }, {
          ...(item.uploadSession ? { resumeSession: item.uploadSession } : {}),
          onProgress: (progress) => onProgress?.(item.localId, progress)
        });
        return { kind: "ok", localId: item.localId, mediaAssetId: uploaded.mediaAssetId };
      } catch (err) {
        return {
          kind: "failed",
          localId: item.localId,
          message: err instanceof Error ? err.message : "上传失败"
        };
      }
    })
  );
}

/**
 * 根据草稿构造 CreatePostPayload（含 schema 字段）。不发送，只构造。
 * idempotencyKey 可由调用方传入；不传则不写入 payload.idempotencyKey（命令本身可选）。
 */
export function buildCreatePostPayload(
  draft: ComposerDraftForPublish,
  quotePost?: FeedPost,
  overrides: Partial<Pick<CreatePostPayload, "body" | "mediaRefs" | "authorType" | "authorDisplayName" | "visibility" | "cityScope">> = {}
): CreatePostPayload {
  const finalBody = assembleComposerBody({
    body: draft.body,
    gifWord: draft.gifWord,
    poll: draft.poll,
    place: draft.place,
    topic: draft.topic,
    isGhost24h: draft.isGhost24h,
    quoteTarget: quotePost
  });
  const payload: CreatePostPayload = {
    authorType: "USER",
    authorDisplayName: "你",
    body: finalBody,
    visibility: draft.visibility
  };
  if (draft.includeCity) payload.cityScope = "hn";
  if (draft.quoteTargetId) payload.contextRefs = [{ contextType: "QUOTE_POST", contextId: draft.quoteTargetId }];
  if (draft.isGhost24h) {
    payload.ephemeralUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  }
  if (shouldSerializePoll(draft.poll)) {
    payload.poll = {
      expiresAt: new Date(Date.now() + parsePollDurationMs(draft.poll.durationLabel)).toISOString(),
      options: draft.poll.options.map((label, sortOrder) => ({
        optionId: `opt_${Date.now().toString(36)}_${sortOrder}`,
        label: label.trim() || `选项 ${sortOrder + 1}`,
        sortOrder
      }))
    };
  }
  // 调用方可以在此处覆盖 body（如果已经预先 assemble 过）/ mediaRefs / 头部字段。
  return { ...payload, ...overrides };
}

/**
 * 把上传结果合并回 DraftMediaItem 列表。READY 失败/取消/暂停的项保留原状态。
 */
export function applyUploadOutcomes(
  items: DraftMediaItem[],
  outcomes: UploadOutcome[]
): DraftMediaItem[] {
  const byId = new Map(outcomes.map((o) => [o.localId, o]));
  return items.map((item) => {
    const outcome = byId.get(item.localId);
    if (!outcome) return item;
    if (outcome.kind === "ok") {
      return { ...item, status: "READY", progress: 1, mediaAssetId: outcome.mediaAssetId, uploadSession: undefined, error: undefined };
    }
    if (outcome.kind === "paused") {
      return { ...item, status: "PAUSED", error: outcome.message };
    }
    if (outcome.kind === "cancelled") {
      return { ...item, status: "FAILED", error: "照片上传已取消" };
    }
    return { ...item, status: "FAILED", error: outcome.message };
  });
}

/**
 * 检查草稿是否有内容（决定发布按钮是否可点）。
 */
export function draftHasContent(draft: ComposerDraftForPublish): boolean {
  return Boolean(
    draft.body.trim() ||
    draft.media.length > 0 ||
    draft.gifWord ||
    shouldSerializePoll(draft.poll) ||
    draft.place ||
    draft.topic ||
    draft.quoteTargetId
  );
}

/**
 * 生成 idempotency key。同一草稿多次点击发布应使用同一 key 以避免重发。
 */
export function newPublishIdempotencyKey(): string {
  return `mobile_post_publish_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// 为了避免 LocalNetClient / MediaClient 的循环依赖，这里只取它们的方法签名。
// 真实调用方在 ComposerV2Screen 里拼装；本文件只暴露函数供调用。
export type PublishDeps = {
  localNet: LocalNetClient;
  mediaClient: MediaClient;
};

export async function performPublish(
  draft: ComposerDraftForPublish,
  quotePost: FeedPost | undefined,
  deps: PublishDeps,
  options: {
    idempotencyKey: string;
    onUploadProgress?: (localId: string, progress: number) => void;
  }
): Promise<{ ok: true; payload: CreatePostPayload } | { ok: false; reason: "no-media-ready" | "upload-failed" }> {
  const outcomes = await uploadPendingMedia(draft.media, deps.mediaClient, options.onUploadProgress);
  if (outcomes.some((o) => o.kind === "failed" || o.kind === "cancelled" || o.kind === "paused")) {
    return { ok: false, reason: "upload-failed" };
  }
  const completed = applyUploadOutcomes(draft.media, outcomes);
  if (completed.length > 0 && completed.some((it) => it.status !== "READY" || !it.mediaAssetId)) {
    return { ok: false, reason: "no-media-ready" };
  }
  const payload = buildCreatePostPayload(draft, quotePost);
  const mediaRefs = completed
    .filter((it) => it.mediaAssetId)
    .map((it, sortOrder) => ({
      mediaAssetId: it.mediaAssetId!,
      sortOrder,
      ...(it.altText.trim() ? { altText: it.altText.trim() } : {})
    }));
  if (mediaRefs.length > 0) payload.mediaRefs = mediaRefs;
  await deps.localNet.createPost(payload, options.idempotencyKey);
  return { ok: true, payload };
}

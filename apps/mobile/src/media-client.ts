import type { TransportResponse } from "./auth-client";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { isRestartableUploadSessionStatus, uploadOriginalWithRetry } from "./media-upload-retry";

// 纯逻辑/类型已抽到 media-classify.ts（零原生依赖，供 Vitest 单测使用）。
// 这里 re-export 保持既有 import 路径兼容。
import {
  isAnimatedImageMime,
  mediaTypeForMime,
  type ResumableMediaUploadSession,
  type UploadMediaType,
  type UploadableImage
} from "./media-classify";
export { isAnimatedImageMime, mediaTypeForMime } from "./media-classify";
export type { ResumableMediaUploadSession, UploadMediaType, UploadableImage } from "./media-classify";

export type MediaUploadOptions = {
  onProgress?: (progress: number) => void;
  onSession?: (session: ResumableMediaUploadSession) => void;
  resumeSession?: ResumableMediaUploadSession;
  signal?: AbortSignal;
};

const UPLOAD_CHUNK_BYTES = 1024 * 1024;

class UploadSessionUnavailableError extends Error {
  public constructor(public readonly status: number) {
    super(`照片续传会话不可用（${status}）`);
    this.name = "UploadSessionUnavailableError";
  }
}

type MediaAuthClient = {
  getAccessToken(): Promise<string | undefined>;
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class MediaClient {
  private sequence = 0;

  public constructor(private readonly input: {
    authClient: MediaAuthClient;
    secureSessionStore: SecureSessionStore;
    baseUrl: string;
    now?: () => Date;
  }) {}

  public async uploadImage(image: UploadableImage, options: MediaUploadOptions = {}): Promise<{ mediaAssetId: string; storageKey: string }> {
    return this.uploadMedia({ ...image, mediaType: "IMAGE", defaultMime: "image/jpeg" }, options);
  }

  /**
   * 通用媒体上传（IMAGE / VIDEO / AUDIO）。走同一条断点续传链路：
   * CreateMediaAsset → 分块 PUT（SHA256 校验）→ CompleteMediaUpload → ProcessMediaAsset → 轮询 READY。
   * 音频由服务端 ffprobe 复核时长（≤30s），客户端上限只是体验层。
   */
  public async uploadMedia(file: UploadableImage & { mediaType: UploadMediaType; durationMs?: number; defaultMime?: string }, options: MediaUploadOptions = {}): Promise<{ mediaAssetId: string; storageKey: string }> {
    try {
    return await this.uploadMediaInternal(file, options);
    } catch (err) {
      console.log(`[proxy.R15.63.DEBUG.media] uploadMedia THROW message=${err instanceof Error ? err.message : String(err)} stack=${err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" | ") : "no stack"}`);
      throw err;
    }
  }

  private async uploadMediaInternal(file: UploadableImage & { mediaType: UploadMediaType; durationMs?: number; defaultMime?: string }, options: MediaUploadOptions = {}): Promise<{ mediaAssetId: string; storageKey: string }> {
    const mimeType = file.mimeType || file.defaultMime || "application/octet-stream";
    console.log(`[proxy.R15.63.DEBUG.media] uploadMedia start mime=${mimeType} mediaType=${file.mediaType} uri=${file.uri.slice(0, 40)}`);
    const accessToken = await this.input.authClient.getAccessToken();
    if (!accessToken) { console.log("[proxy.R15.63.DEBUG.media] uploadMedia FAIL: no access token"); throw new Error("上传媒体前需要有效会话"); }
    const localFile = new File(file.uri);
    if (!localFile.exists) { console.log(`[proxy.R15.63.DEBUG.media] uploadMedia FAIL: file not exists uri=${file.uri}`); throw new Error(file.mediaType === "AUDIO" ? "无法读取录音文件" : "无法读取所选照片"); }
    const totalBytes = localFile.size;
    if (!totalBytes || totalBytes <= 0) { console.log(`[proxy.R15.63.DEBUG.media] uploadMedia FAIL: empty file bytes=${totalBytes}`); throw new Error(file.mediaType === "AUDIO" ? "录音为空，请重新录制" : "所选照片为空或大小不可读"); }
    console.log(`[proxy.R15.63.DEBUG.media] uploadMedia file ok totalBytes=${totalBytes}`);

    const createSession = async (): Promise<ResumableMediaUploadSession> => {
      const storageKey = `${this.nextId(file.mediaType.toLowerCase())}${extensionFor(mimeType)}`;
      const created = await this.command("CreateMediaAsset", { type: "MediaAsset", id: "new" }, {
        mediaType: file.mediaType,
        originalStorageKey: storageKey,
        mimeType,
        width: file.width ?? 0,
        height: file.height ?? 0
      });
      const freshSession = {
        mediaAssetId: stringField(created, "mediaAssetId"),
        storageKey,
        uploadUrl: stringField(created, "uploadUrl"),
        offset: 0,
        totalBytes
      };
      options.onSession?.(freshSession);
      return freshSession;
    };

    let session = options.resumeSession?.totalBytes === totalBytes ? options.resumeSession : undefined;
    if (!session) {
      session = await createSession();
      console.log(`[proxy.R15.63.DEBUG.media] CreateMediaAsset ok mediaAssetId=${session.mediaAssetId} uploadUrl=${session.uploadUrl}`);
    }

    let uploadEndpoint = `${this.input.baseUrl}${session.uploadUrl}`;
    let offset: number;
    try {
      offset = await this.queryUploadOffset(uploadEndpoint, accessToken, options.signal);
    } catch (error) {
      // Upload sessions are intentionally ephemeral. A persisted local draft can
      // outlive a server restart/session TTL; 404/409 means resume is impossible,
      // but the retained local original is still valid, so start a fresh asset.
      if (!(error instanceof UploadSessionUnavailableError) || !isRestartableUploadSessionStatus(error.status)) throw error;
      if (error.status === 409) {
        const existing = await this.command("GetMediaAsset", { type: "MediaAsset", id: session.mediaAssetId }, { mediaAssetId: session.mediaAssetId });
        const asset = existing.asset;
        const processingStatus = asset && typeof asset === "object" && "processingStatus" in asset
          ? (asset as { processingStatus?: unknown }).processingStatus
          : undefined;
        if (processingStatus === "READY") {
          options.onProgress?.(1);
          return { mediaAssetId: session.mediaAssetId, storageKey: session.storageKey };
        }
        if (processingStatus === "PROCESSING") {
          await this.waitUntilReady(session.mediaAssetId, options.signal);
          options.onProgress?.(1);
          return { mediaAssetId: session.mediaAssetId, storageKey: session.storageKey };
        }
      }
      session = await createSession();
      uploadEndpoint = `${this.input.baseUrl}${session.uploadUrl}`;
      offset = await this.queryUploadOffset(uploadEndpoint, accessToken, options.signal);
    }
    if (offset < 0 || offset > totalBytes) throw new Error("照片续传位置无效，请重新选择照片");
    session = { ...session, offset };
    options.onSession?.(session);
    options.onProgress?.(offset / totalBytes);
    const handle = localFile.open();
    try {
      handle.offset = offset;
      while (offset < totalBytes) {
        throwIfAborted(options.signal);
        const chunk = handle.readBytes(Math.min(UPLOAD_CHUNK_BYTES, totalBytes - offset));
        if (chunk.byteLength === 0) throw new Error("照片读取提前结束");
        const end = offset + chunk.byteLength - 1;
        const checksum = hexDigest(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, chunk));
        let response: Response | undefined;
        await uploadOriginalWithRetry(async () => {
          throwIfAborted(options.signal);
          response = await fetch(uploadEndpoint, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": mimeType,
              "Content-Range": `bytes ${offset}-${end}/${totalBytes}`,
              "X-Chunk-SHA256": checksum
            },
            body: chunk as unknown as BodyInit,
            ...(options.signal ? { signal: options.signal } : {})
          });
          return response.status;
        }, undefined, 3, options.signal);
        const chunkStatus = response ?? { status: 0 } as Response;
        console.log(`[proxy.R15.63.DEBUG.media] upload chunk status=${chunkStatus.status} range=${offset}-${end}/${totalBytes} uploadOffset=${chunkStatus.headers.get("Upload-Offset")}`);
        const acceptedOffset = Number(response?.headers.get("Upload-Offset") ?? end + 1);
        if (!Number.isInteger(acceptedOffset) || acceptedOffset < end + 1 || acceptedOffset > totalBytes) {
          throw new Error("照片服务返回了无效续传位置");
        }
        offset = acceptedOffset;
        handle.offset = offset;
        session = { ...session, offset };
        options.onSession?.(session);
        options.onProgress?.(offset / totalBytes);
      }
    } finally {
      handle.close();
    }

    throwIfAborted(options.signal);
    await this.command("CompleteMediaUpload", { type: "MediaAsset", id: session.mediaAssetId }, { originalStorageKey: session.storageKey });
    options.onProgress?.(1);
    throwIfAborted(options.signal);
    await this.command("ProcessMediaAsset", { type: "MediaAsset", id: session.mediaAssetId }, { originalPath: "" });
    await this.waitUntilReady(session.mediaAssetId, options.signal);
    return { mediaAssetId: session.mediaAssetId, storageKey: session.storageKey };
  }

  private async queryUploadOffset(uploadEndpoint: string, accessToken: string, signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    const response = await fetch(uploadEndpoint, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${accessToken}` },
      ...(signal ? { signal } : {})
    });
    if (response.status < 200 || response.status >= 300) throw new UploadSessionUnavailableError(response.status);
    const value = Number(response.headers.get("Upload-Offset") ?? "0");
    if (!Number.isInteger(value) || value < 0) throw new Error("照片服务缺少有效续传位置");
    return value;
  }

  private async waitUntilReady(mediaAssetId: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + 60_000;
    let delayMs = 300;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const result = await this.command("GetMediaAsset", { type: "MediaAsset", id: mediaAssetId }, { mediaAssetId });
      const asset = result.asset;
      const status = asset && typeof asset === "object" && "processingStatus" in asset
        ? (asset as { processingStatus?: unknown }).processingStatus
        : undefined;
      if (status === "READY") return;
      if (status === "FAILED") throw new Error("照片处理失败，请重试");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(Math.round(delayMs * 1.5), 2_000);
    }
    throw new Error("照片仍在处理中，请稍后重试发布");
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const session = await this.requireSession();
    const envelope = {
      commandId: this.nextId("command"), commandType, commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId }, principal: session.principal, target,
      idempotencyKey: this.nextId("idempotency"), authContext: { sessionId: session.auth.sessionId },
      purpose: "conversation_media", correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(), payload
    };
    console.log(`[proxy.R15.63.DEBUG.media] command ${commandType} start mediaAssetId=${target.id}`);
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) { console.log(`[proxy.R15.63.DEBUG.media] command ${commandType} FAIL: parse result null`); throw new Error("媒体服务返回格式错误"); }
    if (result.outcome === "REJECTED") { console.log(`[proxy.R15.63.DEBUG.media] command ${commandType} REJECTED messageKey=${result.error?.messageKey ?? "?"} errorCode=${result.error?.errorCode ?? "?"} category=${result.error?.category ?? "?"} retryability=${result.error?.retryability ?? "?"} requiredAction=${result.error?.requiredAction ?? "?"} safeDetails=${JSON.stringify(result.error?.safeDetails ?? {})}`); throw new Error(result.error?.messageKey || "媒体命令被拒绝"); }
    if (response.status < 200 || response.status >= 300) { console.log(`[proxy.R15.63.DEBUG.media] command ${commandType} http status=${response.status}`); throw new Error(`媒体命令失败（${response.status}）`); }
    console.log(`[proxy.R15.63.DEBUG.media] command ${commandType} ok status=${response.status}`);
    if (!result.operationRef) return {};
    try {
      const value = JSON.parse(result.operationRef) as unknown;
      return value && typeof value === "object" ? value as Record<string, unknown> : {};
    } catch {
      throw new Error("媒体服务返回数据无效");
    }
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    console.log(`[proxy.R15.63.DEBUG.media] requireSession start`);
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) { console.log(`[proxy.R15.63.DEBUG.media] requireSession FAIL: no session or no principal session=${!!session} principal=${!!session?.principal}`); throw new Error("上传照片前需要登录或访客会话"); }
    if (session.serverSession === false) { console.log(`[proxy.R15.63.DEBUG.media] requireSession FAIL: serverSession=false`); throw new Error("上传照片需要真实登录 (offline session 不能上传)"); }
    if (session.signedOut === true) { console.log(`[proxy.R15.63.DEBUG.media] requireSession FAIL: signedOut=true`); throw new OfflineFallbackSessionError(); }
    console.log(`[proxy.R15.63.DEBUG.media] requireSession ok userAccountId=${session.userAccountId} principal=${session.principal.type}:${session.principal.id}`);
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `mobile_media_${prefix}_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("照片上传已取消");
  error.name = "AbortError";
  throw error;
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/avif") return ".avif";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/heic" || mimeType === "image/heif") return ".heic";
  if (mimeType.startsWith("audio/")) {
    if (mimeType === "audio/mp4" || mimeType === "audio/aac" || mimeType === "audio/x-m4a" || mimeType === "audio/m4a") return ".m4a";
    if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
    if (mimeType === "audio/mpeg") return ".mp3";
    return ".m4a";
  }
  if (mimeType.startsWith("video/")) {
    if (mimeType === "video/quicktime") return ".mov";
    if (mimeType === "video/webm") return ".webm";
    return ".mp4";
  }
  return ".jpg";
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new Error(`媒体服务缺少 ${key}`);
  return field;
}

function hexDigest(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

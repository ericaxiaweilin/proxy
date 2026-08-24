import type { TransportResponse } from "./auth-client";
import { File, UploadType } from "expo-file-system";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { uploadOriginalWithRetry } from "./media-upload-retry";

export type UploadableImage = {
  uri: string;
  fileName?: string;
  mimeType?: string;
  width: number;
  height: number;
};

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

  public async uploadImage(image: UploadableImage): Promise<{ mediaAssetId: string; storageKey: string }> {
    const mimeType = image.mimeType || "image/jpeg";
    const storageKey = `${this.nextId("image")}${extensionFor(mimeType)}`;
    const created = await this.command("CreateMediaAsset", { type: "MediaAsset", id: "new" }, {
      mediaType: "IMAGE",
      originalStorageKey: storageKey,
      mimeType,
      width: image.width,
      height: image.height
    });
    const mediaAssetId = stringField(created, "mediaAssetId");
    const uploadUrl = stringField(created, "uploadUrl");
    const accessToken = await this.input.authClient.getAccessToken();
    if (!accessToken) throw new Error("上传照片前需要有效会话");

    const localFile = new File(image.uri);
    if (!localFile.exists) throw new Error("无法读取所选照片");
    await uploadOriginalWithRetry(async () => {
      const response = await localFile.upload(`${this.input.baseUrl}${uploadUrl}`, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mimeType },
        mimeType,
        sessionType: "foreground"
      });
      return response.status;
    });

    await this.command("CompleteMediaUpload", { type: "MediaAsset", id: mediaAssetId }, { originalStorageKey: storageKey });
    await this.command("ProcessMediaAsset", { type: "MediaAsset", id: mediaAssetId }, { originalPath: "" });
    return { mediaAssetId, storageKey };
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
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("媒体服务返回格式错误");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey || "媒体命令被拒绝");
    if (response.status < 200 || response.status >= 300) throw new Error(`媒体命令失败（${response.status}）`);
    if (!result.operationRef) return {};
    try {
      const value = JSON.parse(result.operationRef) as unknown;
      return value && typeof value === "object" ? value as Record<string, unknown> : {};
    } catch {
      throw new Error("媒体服务返回数据无效");
    }
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("上传照片前需要登录或访客会话");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `mobile_media_${prefix}_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/heic" || mimeType === "image/heif") return ".heic";
  return ".jpg";
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new Error(`媒体服务缺少 ${key}`);
  return field;
}

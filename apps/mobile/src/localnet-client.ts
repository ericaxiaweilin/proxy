// LocalNet 客户端：动态读模型（ListFeedPosts）+ 发布（CreatePost）。
// 新架构：内容数据全部由服务端下发，前端不再内嵌种子内容；
// operationRef 承载读模型 payload（zod 校验，fail-closed）。
import type { CommandResult, CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { ListFeedPostsPayloadSchema } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export type LocalNetClientOptions = {
  authClient: AuthenticatedCommandTransport;
  secureSessionStore: SecureSessionStore;
  baseUrl: string;
  now?: () => Date;
};

export type FeedReadModel = {
  posts: FeedPost[];
  media: Record<string, FeedMediaItem[]>;
};

export class LocalNetProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalNetProtocolError";
  }
}

export class LocalNetCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(result.error?.messageKey ?? "localnet command rejected");
    this.name = "LocalNetCommandRejectedError";
  }
}

export class LocalNetClient {
  private commandSequence = 0;

  public constructor(private readonly input: LocalNetClientOptions) {}

  /** 相对媒体 URL（/v1/media/play|thumb/{id}）拼接 API base，供 Image/播放器使用。 */
  public resolveMediaUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${this.input.baseUrl}${path}`;
  }

  public async listFeedPosts(): Promise<FeedReadModel> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListFeedPosts", { type: "Feed", id: "local" }, {});
    const payload = ListFeedPostsPayloadSchema.parse(this.decodeOperationRef(result));
    return { posts: payload.posts, media: payload.media };
  }

  public async createPost(payload: CreatePostPayload, idempotencyKey?: string): Promise<string> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "CreatePost", { type: "Post", id: "new" }, payload as unknown as Record<string, unknown>, idempotencyKey);
    if (result.aggregate?.type !== "Post") {
      throw new LocalNetProtocolError("create post response did not contain a Post aggregate");
    }
    return result.aggregate.id;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new LocalNetProtocolError("an authenticated principal is required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private async sendCommand(
    session: StoredSession & { principal: NonNullable<StoredSession["principal"]> },
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: idempotencyKey ?? this.nextId("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "localnet_feed",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new LocalNetProtocolError("localnet command response was malformed");
    if (result.outcome === "REJECTED") throw new LocalNetCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new LocalNetProtocolError(`unexpected localnet command status: ${response.status}`);
    }
    return result;
  }

  private decodeOperationRef(result: CommandResult): unknown {
    if (!result.operationRef) throw new LocalNetProtocolError("localnet response missing operationRef");
    try {
      return JSON.parse(result.operationRef);
    } catch {
      throw new LocalNetProtocolError("localnet operationRef was not valid JSON");
    }
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_localnet_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}

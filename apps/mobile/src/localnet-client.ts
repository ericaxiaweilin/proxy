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
  requestPublic?(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
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
    // 动态 ALL 固定读取全局公开时间流。地址只用于用户显式选择的
    // 二级筛选，不能进入服务端 ListFeedPosts payload。
    const result = await this.sendCommand(
      undefined,
      "ListFeedPosts",
      { type: "Feed", id: "local" },
      {},
      undefined,
      true
    );
    const payload = ListFeedPostsPayloadSchema.parse(this.decodeOperationRef(result));
    return { posts: payload.posts, media: payload.media };
  }

  public async listMyFeedPosts(): Promise<FeedReadModel> {
    const session = await this.requireSession();
    const read = await this.listFeedPosts();
    return {
      posts: read.posts.filter((post) => post.authorId === session.userAccountId),
      media: read.media
    };
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

  private async optionalSession(): Promise<(StoredSession & { principal: NonNullable<StoredSession["principal"]> }) | undefined> {
    const session = await this.input.secureSessionStore.read();
    return session?.principal ? session as StoredSession & { principal: NonNullable<StoredSession["principal"]> } : undefined;
  }

  private async sendCommand(
    session: (StoredSession & { principal: NonNullable<StoredSession["principal"]> }) | undefined,
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>,
    idempotencyKey?: string,
    publicRead = false
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: session ? { type: "USER", id: session.userAccountId } : { type: "PUBLIC", id: "anonymous_reader" },
      principal: session?.principal ?? { type: "PUBLIC", id: "anonymous_reader" },
      target,
      idempotencyKey: idempotencyKey ?? this.nextId("idempotency"),
      authContext: session ? { sessionId: session.auth.sessionId } : {},
      purpose: "localnet_feed",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const request = publicRead && this.input.authClient.requestPublic
      ? this.input.authClient.requestPublic.bind(this.input.authClient)
      : this.input.authClient.request.bind(this.input.authClient);
    const response = await request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    if (response.status < 200 || response.status >= 300) {
      throw new LocalNetProtocolError(`动态服务暂时不可用（${response.status}），请稍后重试`);
    }
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      // Reverse proxies may return an HTML error page while the API restarts.
      // Never leak the raw JSON parser "unexpected character <" error into UI.
      throw new LocalNetProtocolError("动态服务返回异常，请稍后重试");
    }
    const result = parseCommandResult(responseBody);
    if (!result) throw new LocalNetProtocolError("localnet command response was malformed");
    if (result.outcome === "REJECTED") throw new LocalNetCommandRejectedError(result);
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

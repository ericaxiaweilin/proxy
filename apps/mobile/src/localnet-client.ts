// LocalNet 客户端：动态读模型（ListFeedPosts）+ 发布（CreatePost）。
// 新架构：内容数据全部由服务端下发，前端不再内嵌种子内容；
// operationRef 承载读模型 payload（zod 校验，fail-closed）。
import type { CommandResult, CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { ListFeedPostsPayloadSchema } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
  requestPublic?(path: string, init: { method: "GET" } | { method: "POST"; body: unknown }): Promise<TransportResponse>;
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
  nextCursor: string | undefined;
  hasMore: boolean;
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
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    // R15.65: 防御 — caller 可能以裸方法 (this 丢) 传过来。
    // 拿不到 input.baseUrl 时返回空串, 避免 TypeError: Cannot read property 'input' of undefined
    const baseUrl = (this as unknown as { input?: { baseUrl?: string } })?.input?.baseUrl;
    if (!baseUrl) return "";
    return `${baseUrl}${path}`;
  }

  public async listFeedPosts(cursor?: string, limit = 25, searchQuery?: string): Promise<FeedReadModel> {
    // 动态 ALL 固定读取全局公开时间流。地址只用于用户显式选择的
    // 二级筛选，不能进入服务端 ListFeedPosts payload。
    // R15.92: searchQuery — client 端过滤 (server ListFeedPosts 暂不接 search params,
    //   Phase 2 server 加 search 后可走 ListFeedPosts search 或独立 SearchPosts 端点).
    if (this.input.authClient.requestPublic) {
      const query = [`limit=${Math.max(1, Math.min(50, limit))}`];
      if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
      // R15.92: 暂不把 searchQuery 传 server, client 侧 filter.
      const response = await this.input.authClient.requestPublic(`/v1/feed?${query.join("&")}`, { method: "GET" });
      if (response.status < 200 || response.status >= 300) {
        throw new LocalNetProtocolError(`动态服务暂时不可用（${response.status}），请稍后重试`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LocalNetProtocolError("动态服务返回异常，请稍后重试");
      }
      const payload = ListFeedPostsPayloadSchema.parse(body);
      const posts = searchQuery && searchQuery.trim().length > 0
        ? payload.posts.filter((p) => {
            const q = searchQuery.toLowerCase();
            return p.body.toLowerCase().includes(q) || (p.authorDisplayName?.toLowerCase().includes(q) ?? false);
          })
        : payload.posts;
      return { posts, media: payload.media, nextCursor: payload.nextCursor || undefined, hasMore: payload.hasMore === true };
    }
    const result = await this.sendCommand(
      undefined,
      "ListFeedPosts",
      { type: "Feed", id: "local" },
      { cursor, limit },
      undefined,
      true
    );
    const payload = ListFeedPostsPayloadSchema.parse(this.decodeOperationRef(result));
    const posts = searchQuery && searchQuery.trim().length > 0
      ? payload.posts.filter((p) => {
          const q = searchQuery.toLowerCase();
          return p.body.toLowerCase().includes(q) || (p.authorDisplayName?.toLowerCase().includes(q) ?? false);
        })
      : payload.posts;
    return { posts, media: payload.media, nextCursor: payload.nextCursor || undefined, hasMore: payload.hasMore === true };
  }

  public async listMyFeedPosts(): Promise<FeedReadModel> {
    const session = await this.requireSession();
    const read = await this.listFeedPosts();
    return {
      posts: read.posts.filter((post) => post.authorId === session.userAccountId),
      media: read.media,
      nextCursor: read.nextCursor,
      hasMore: read.hasMore
    };
  }

  public async createPost(payload: CreatePostPayload, idempotencyKey?: string): Promise<string> {
    const session = await this.requireSession();
    console.log(`[proxy.R15.63.DEBUG.post] CreatePost start bodyLen=${payload.body?.length ?? 0} mediaRefs=${payload.mediaRefs?.length ?? 0} idempotencyKey=${idempotencyKey ?? "none"}`);
    const result = await this.sendCommand(session, "CreatePost", { type: "Post", id: "new" }, payload as unknown as Record<string, unknown>, idempotencyKey);
    if (result.aggregate?.type !== "Post") {
      console.log(`[proxy.R15.63.DEBUG.post] CreatePost FAIL: aggregate.type=${result.aggregate?.type} outcome=${result.outcome} error=${JSON.stringify(result.error ?? null)}`);
      throw new LocalNetProtocolError("create post response did not contain a Post aggregate");
    }
    console.log(`[proxy.R15.63.DEBUG.post] CreatePost ok postId=${result.aggregate.id}`);
    return result.aggregate.id;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new LocalNetProtocolError("an authenticated principal is required");
    // R15.34.1 P0 fix: 防止“离线 fallback guest”能发写命令 (CreatePost)。
    //   createNativeGuestSession 在 API 不可达/限流/服务端错误时会降级
    //   造一个 fake accessToken 的本地 session，让用户能读匿名内容。
    //   但这条 session server 端没有记录，accessToken 是假的，CreatePost
    //   上去 server 一定返 INVALID_ACCESS_TOKEN。客户端必须先拦。
    //   读路径 (listFeedPosts 走 publicRead) 不走这里，不受限制。
    if (session.serverSession === false) {
      throw new LocalNetProtocolError("publishing requires a real sign-in (offline session cannot post)");
    }
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
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

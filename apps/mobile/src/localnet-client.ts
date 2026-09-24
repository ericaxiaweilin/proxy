// LocalNet 客户端：动态读模型（ListFeedPosts）+ 发布（CreatePost）。
// 新架构：内容数据全部由服务端下发，前端不再内嵌种子内容；
// operationRef 承载读模型 payload（zod 校验，fail-closed）。
import type { CommandResult, CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { ListFeedPostsPayloadSchema } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { filterPostsByFeedSearch, normalizeFeedSearchQuery } from "./feed-search";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

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

// TWIN-SIGNALS-001: 单条帖子曝光聚合（战绩页读模型）。数字含义：
// impressions 看了几次 / viewers 多少人看过 / totalWatchMs 累计看了多久。
export type PostImpressionStats = {
  postId: string;
  impressions: number;
  viewers: number;
  totalWatchMs: number;
};

function isPostImpressionStats(value: unknown): value is PostImpressionStats {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.postId === "string" && item.postId !== ""
    && typeof item.impressions === "number" && typeof item.viewers === "number"
    && typeof item.totalWatchMs === "number";
}

// PROFILE-VISIT-001: 主页访问聚合。opens 打开了多少次，uniqueViewers 多少个
// 不同的人打开过——一个人一份主页，不像帖子那样按 id 分组。
export type ProfileViewStats = {
  opens: number;
  uniqueViewers: number;
};

function isProfileViewStats(value: unknown): value is ProfileViewStats {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.opens === "number" && typeof item.uniqueViewers === "number";
}

// PROFILE-VIEWERS-001: 按人分组的主页访问明细——"3 次访问"回答不了"是谁"，
// 这个才回答。actorId 是谁由调用方自己对着已经有的好友列表查真名，
// localnet 不认识"好友"这个概念。
export type ProfileViewerStat = {
  actorId: string;
  opens: number;
  lastOpenedAt: string;
};

function isProfileViewerStat(value: unknown): value is ProfileViewerStat {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.actorId === "string" && item.actorId !== ""
    && typeof item.opens === "number" && typeof item.lastOpenedAt === "string";
}

// MEDIA-DWELL-001: 一张照片/视频的曝光聚合——同一个帖子里的多张照片分开算，
// 不再全记在帖子一个 watchMs 里。
export type MediaImpressionStats = {
  postId: string;
  mediaAssetId: string;
  impressions: number;
  viewers: number;
  totalWatchMs: number;
};

function isMediaImpressionStats(value: unknown): value is MediaImpressionStats {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.postId === "string" && item.postId !== ""
    && typeof item.mediaAssetId === "string" && item.mediaAssetId !== ""
    && typeof item.impressions === "number" && typeof item.viewers === "number"
    && typeof item.totalWatchMs === "number";
}

// CONTENT-ANALYTICS-001: 用户侧分析面板（近 30 天发的帖子的合计）。逐人明细不下发客户端 ——
// 以前的 VIEWER-ACTIVITY-001「这个人看了哪张、看了几秒」改为仅运营（ANALYTICS scope）。
export type ContentAnalytics = {
  sinceDays: number;
  posts: number;
  impressions: number;
  uniqueViewers: number;
  totalWatchMs: number;
  topPostId?: string;
  topPostViews: number;
};

function isContentAnalytics(value: unknown): value is ContentAnalytics {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["sinceDays", "posts", "impressions", "uniqueViewers", "totalWatchMs", "topPostViews"].every((key) => typeof item[key] === "number");
}

export class LocalNetProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalNetProtocolError";
  }
}

export class LocalNetCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(commandErrorMessage(result.error, "localnet command rejected"));
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

  public async listFeedPosts(cursor?: string, limit = 25, searchQuery?: string, fresh = false): Promise<FeedReadModel> {
    // 动态 ALL 固定读取全局公开时间流。地址只用于用户显式选择的
    // 二级筛选，不能进入服务端 ListFeedPosts payload。
    //
    // SEARCH-CORPUS-001: searchQuery 走**服务端**过滤（R15.94 起 server 的
    // listFeed 就接 search 字段）。这里原来的注释写「server ListFeedPosts 暂不接
    // search params, Phase 2 …」，那是 R15.94 之前的事实，已经过期；它让这条通道
    // 看起来还没通，于是 client 的 searchQuery 参数全仓无人传，
    // 搜索只在**已加载的那几页**里做本地过滤 —— 搜「人」只能搜到你恰好滚过的几条。
    // 过滤字段语义统一在 ./feed-search（逐字对应 Go 侧 postMatchesSearch）。
    const search = normalizeFeedSearchQuery(searchQuery);
    if (this.input.authClient.requestPublic) {
      const query = [`limit=${Math.max(1, Math.min(50, limit))}`];
      if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
      if (search !== "") {
        query.push(`search=${encodeURIComponent(search)}`);
      }
      // FEED-FRESH-001: 发布后立刻重载必须穿透 /v1/feed 的 15s HTTP 缓存，
      // 否则刚发的帖子大概率撞上发帖前缓存的那一页、用户当场看不到。
      // _fresh 只换 cache key，服务端忽略该参数。平时不带，缓存照常省流量。
      if (fresh) query.push(`_fresh=${Date.now()}`);
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
      // 服务端已按同一份字段语义过滤过；这里再走一次同一个 helper 只是兜底
      // （老 server / 缓存回放）。字段集完全一致，所以不会把服务端已认可的结果丢掉。
      return {
        posts: filterPostsByFeedSearch(payload.posts, search),
        media: payload.media,
        nextCursor: payload.nextCursor || undefined,
        hasMore: payload.hasMore === true
      };
    }
    const result = await this.sendCommand(
      undefined,
      "ListFeedPosts",
      { type: "Feed", id: "local" },
      // SEARCH-CORPUS-001: 这条分支以前**不带** search，于是登录态下的搜索
      // 只会在服务端返回的那一页里做本地过滤。server 的 listFeed 读的就是
      // payload.search（跟公开分支同一个 handler），所以这里必须同样带上，
      // 两条分支的搜索语义才一致。
      search === "" ? { cursor, limit } : { cursor, limit, search },
      undefined,
      true
    );
    const payload = ListFeedPostsPayloadSchema.parse(this.decodeOperationRef(result));
    return {
      posts: filterPostsByFeedSearch(payload.posts, search),
      media: payload.media,
      nextCursor: payload.nextCursor || undefined,
      hasMore: payload.hasMore === true
    };
  }

  public async listMyFeedPosts(): Promise<FeedReadModel> {
    const session = await this.requireSession();
    // R16.6 fix: paginate through the feed until we find posts owned by the
    // current viewer. Without paging, the newest N posts (often agent_linh
    // integration seeds or other users) shadow the viewer's older content and
    // the profile goes blank. Cap at 10 pages × 50 = 500 to avoid runaway.
    const PAGE_CAP = 10;
    const PAGE_SIZE = 50;
    const mine: FeedReadModel = { posts: [], media: {}, nextCursor: undefined, hasMore: false };
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_CAP; page += 1) {
      const read = await this.listFeedPosts(cursor, PAGE_SIZE);
      const ownPosts = read.posts.filter((post) => post.authorId === session.userAccountId);
      mine.posts.push(...ownPosts);
      for (const post of ownPosts) {
        const items = read.media[post.postId];
        if (items) mine.media[post.postId] = items;
      }
      if (ownPosts.length > 0) {
        mine.nextCursor = read.nextCursor;
        mine.hasMore = read.hasMore;
        return mine;
      }
      if (!read.hasMore || !read.nextCursor) break;
      cursor = read.nextCursor;
    }
    return mine;
  }

  /**
   * PROFILE-SAVED-001 — 按 ID 批量取帖子。
   *
   * 收藏夹里只有 postId。之前只能从动态流里「捞」，于是收藏一条不在前 25 条
   * 里的帖子就等于丢了（用户会以为收藏被吞了）。这条直取：服务端用与动态流
   * 相同的可见性口径，取不到的 ID 直接跳过（帖子可能已删）。
   */
  public async listPostsByIds(postIds: readonly string[]): Promise<FeedReadModel> {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const raw of postIds) {
      const id = raw.trim();
      if (id.length === 0 || seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
      if (unique.length >= 100) break;
    }
    if (unique.length === 0) {
      return { posts: [], media: {}, nextCursor: undefined, hasMore: false };
    }
    const session = await this.requireSession();
    const result = await this.sendCommand(
      session,
      "ListPostsByIds",
      // 服务端 validateEnvelope 要求 target.id 非空（fail-closed，先于 dispatch）。
      // 批量按 ID 读没有单一聚合，用显式哨兵值而不是空串：空串会被拒成
      // INVALID_COMMAND_ENVELOPE，收藏 tab 每次都会抛错。与 CreatePost 的
      // "new" 同属「命名操作、不假装是真实聚合」的哨兵惯例。
      { type: "Post", id: "by_ids" },
      { postIds: unique }
    );
    const payload = ListFeedPostsPayloadSchema.parse(this.decodeOperationRef(result));
    return { posts: payload.posts, media: payload.media, nextCursor: undefined, hasMore: false };
  }

  /**
   * MENTION-001: 个人主页 TAGGED tab —— 「提到我的帖子」。
   *
   * 之前是客户端拿**一页**动态（默认 25 条）做 strings.Contains 筛的：比你这一页
   * 更早的提及直接消失（被提到 50 次也只看到 2 次），而且 "@thanh2" 会被算成
   * 提到了 "@thanh"。现在交给服务端扫全量已发布帖子，可见性/静音口径与动态流
   * 完全一致且 fail-closed。
   */
  public async listPostsMentioning(handle: string, limit = 30): Promise<FeedReadModel> {
    const normalized = handle.trim().replace(/^@+/, "").toLowerCase();
    if (normalized.length === 0) {
      // fail-closed：没有可用的 handle 就别去问服务端，更不能退化成「整条动态流」。
      return { posts: [], media: {}, nextCursor: undefined, hasMore: false };
    }
    const session = await this.requireSession();
    const result = await this.sendCommand(
      session,
      "ListPostsMentioning",
      // 服务端 validateEnvelope 要求 target.id 非空。批量提及读没有单一聚合，
      // 用显式哨兵值（与 ListPostsByIds 的 by_ids、CreatePost 的 new 同属惯例）。
      { type: "Post", id: "mentions" },
      { handle: normalized, limit: Math.max(1, Math.min(50, limit)) }
    );
    const payload = ListFeedPostsPayloadSchema.parse(this.decodeOperationRef(result));
    return {
      posts: payload.posts,
      media: payload.media,
      nextCursor: undefined,
      hasMore: payload.hasMore ?? false
    };
  }

  /**
   * TWIN-SIGNALS-001 — 曝光上报（analytics，失败静默）。
   *
   * 这条链路不影响任何业务状态：没登录（访客）直接跳过不发；发送失败
   * 不抛错、不重试 —— 重试只会制造重复曝光。调用方（埋点处）用
   * `void` 触发，不用等。
   */
  public async recordPostImpression(postId: string, watchMs: number): Promise<void> {
    try {
      if (!postId) return;
      const session = await this.optionalSession();
      if (!session) return;
      await this.sendCommand(
        session,
        "RecordPostImpression",
        { type: "Post", id: postId },
        { targetType: "POST", targetId: postId, watchMs: Math.max(0, Math.floor(watchMs)) }
      );
    } catch {
      // 埋点失败静默，见方法注释。
    }
  }

  /**
   * TWIN-SIGNALS-001 — 战绩读侧：只查自己的帖子。
   *
   * 空数组是真答案（"没人看过"），只有缺数组才是协议异常 ——
   * 「没人看」和「没读出来」在战绩页是两种长相，必须分开。
   */
  public async listPostImpressionStats(): Promise<PostImpressionStats[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(
      session,
      "ListPostImpressionStats",
      { type: "Post", id: "impression_stats" },
      {}
    );
    const body = this.decodeOperationRef(result) as { stats?: unknown };
    if (!Array.isArray(body.stats)) throw new LocalNetProtocolError("战绩响应缺少 stats 数组");
    return body.stats.filter(isPostImpressionStats);
  }

  // PROFILE-VISIT-001: 有人打开了我的主页——埋点失败静默，同 recordPostImpression。
  public async recordProfileOpen(ownerId: string): Promise<void> {
    try {
      if (!ownerId) return;
      const session = await this.optionalSession();
      if (!session) return;
      // 自己打开自己的主页不算"被看"——个人主页管理页也走这条渲染路径，
      // 不加这行的话每次自己进个人主页都会给自己 +1 次访问。
      if (session.userAccountId === ownerId) return;
      await this.sendCommand(
        session,
        "RecordProfileOpen",
        { type: "Profile", id: ownerId },
        { targetType: "PROFILE", targetId: ownerId }
      );
    } catch {
      // 埋点失败静默，见方法注释。
    }
  }

  /**
   * PROFILE-VISIT-001 — 主页访问战绩：只查自己的主页。
   * 没人看过是真答案（{opens:0, uniqueViewers:0}），不是协议异常。
   * sinceDays 可选：>0 只数窗口内（「我的 → 分析」传 30）；缺省全量，
   * friend-crm 的访问/回访行继续用全量口径。
   */
  public async listProfileViewStats(sinceDays?: number): Promise<ProfileViewStats> {
    const session = await this.requireSession();
    const result = await this.sendCommand(
      session,
      "ListProfileViewStats",
      { type: "Profile", id: "view_stats" },
      { ...(sinceDays !== undefined && sinceDays > 0 ? { sinceDays } : {}) }
    );
    const body = this.decodeOperationRef(result);
    if (!isProfileViewStats(body)) throw new LocalNetProtocolError("主页访问战绩响应格式不对");
    return body;
  }

  /**
   * PROFILE-VIEWERS-001 — 按人分组的主页访问明细：只查自己的。空数组是
   * 真答案（没人看过），只有缺数组才是协议异常。名字/头像不在这里解析——
   * 调用方对着自己已有的好友列表去认，这里只给 actorId。
   */
  public async listProfileViewers(): Promise<ProfileViewerStat[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(
      session,
      "ListProfileViewers",
      { type: "Profile", id: "viewers" },
      {}
    );
    const body = this.decodeOperationRef(result) as { viewers?: unknown };
    if (!Array.isArray(body.viewers)) throw new LocalNetProtocolError("主页访客明细响应缺少 viewers 数组");
    return body.viewers.filter(isProfileViewerStat);
  }

  // MEDIA-DWELL-001: 一段照片停留——每次划到下一张都要 flush 上一张，不是
  // 整个查看会话关闭才报一次（那样多张照片的时间会全记在一个数字里，见
  // MediaViewer 里的分段逻辑）。埋点失败静默，同 recordPostImpression。
  public async recordMediaImpression(mediaAssetId: string, watchMs: number): Promise<void> {
    try {
      if (!mediaAssetId) return;
      const session = await this.optionalSession();
      if (!session) return;
      await this.sendCommand(
        session,
        "RecordMediaImpression",
        { type: "Media", id: mediaAssetId },
        { targetType: "MEDIA", targetId: mediaAssetId, watchMs: Math.max(0, Math.floor(watchMs)) }
      );
    } catch {
      // 埋点失败静默，见方法注释。
    }
  }

  /**
   * MEDIA-DWELL-001 — 单张媒体战绩读侧：只查自己帖子里的媒体。
   * 空数组是真答案，只有缺数组才是协议异常，同 listPostImpressionStats。
   */
  public async listMediaImpressionStats(): Promise<MediaImpressionStats[]> {
    const session = await this.requireSession();
    const result = await this.sendCommand(
      session,
      "ListMediaImpressionStats",
      { type: "Post", id: "media_impression_stats" },
      {}
    );
    const body = this.decodeOperationRef(result) as { stats?: unknown };
    if (!Array.isArray(body.stats)) throw new LocalNetProtocolError("媒体战绩响应缺少 stats 数组");
    return body.stats.filter(isMediaImpressionStats);
  }

  // CONTENT-ANALYTICS-001: 全屏看图时双击 / 捏合放大 —— 运营侧信号，用户侧不展示。埋点失败静默。
  public async recordMediaZoom(mediaAssetId: string): Promise<void> {
    try {
      if (!mediaAssetId) return;
      const session = await this.optionalSession();
      if (!session) return;
      await this.sendCommand(session, "RecordMediaZoom", { type: "Media", id: mediaAssetId }, { targetType: "MEDIA", targetId: mediaAssetId });
    } catch {
      // 埋点失败静默。
    }
  }

  /**
   * CONTENT-ANALYTICS-001 — 用户侧分析面板：近 sinceDays 天（默认 30）发的帖子的合计。
   * 只有聚合，没有逐人明细（谁、看了几秒、放大几次只给运营）。
   * 逐人明细接口（ListMediaActivityForViewer / ListPostAudience）已改为仅运营，客户端不再调用。
   */
  public async getContentAnalytics(): Promise<ContentAnalytics> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "GetContentAnalytics", { type: "Post", id: "content_analytics" }, {});
    const body = this.decodeOperationRef(result) as { analytics?: unknown };
    if (!isContentAnalytics(body.analytics)) throw new LocalNetProtocolError("分析面板响应缺少 analytics");
    return body.analytics;
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

  // AI-TWIN-POST-AUDIENCE-003: 帖文编排的"编辑"就是切这个开关（公开 ⇄
  // 指定好友），不是重新发一条帖子。服务端只允许作者本人切、只在
  // PUBLIC/TARGETED 之间切（见 apps/api-go 的 updatePostAudience）。
  public async updatePostAudience(postId: string, visibility: "PUBLIC" | "TARGETED", audienceTargetIds: string[]): Promise<void> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "UpdatePostAudience", { type: "Post", id: postId }, { postId, visibility, audienceTargetIds });
    if (result.outcome !== "ACCEPTED") {
      throw new LocalNetProtocolError(commandErrorMessage(result.error, "受众没改成，请稍后重试。"));
    }
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

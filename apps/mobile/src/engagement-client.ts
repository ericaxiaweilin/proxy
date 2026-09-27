import type { CommandResult, FollowCounts, FollowingState, PinnedPostsList, UserRepliesList, UserBookmarksList, PostEngagement, PostRepliesList, MutedAuthorsList, PostPollView, ReceivedEngagementStats } from "@proxy/contracts";
import {
  parseFollowCounts,
  parseFollowingState,
  parsePinnedPostsList,
  parseUserRepliesList,
  parseUserBookmarksList,
  parseMutedAuthorsList,
  PostEngagementSchema,
  PostRepliesListSchema,
  PostPollViewSchema,
  ReceivedEngagementStatsSchema
} from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export type EngagementCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class EngagementProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EngagementProtocolError";
  }
}

export class EngagementCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(commandErrorMessage(result.error, "engagement command rejected"));
    this.name = "EngagementCommandRejectedError";
  }
}

/**
 * Dynamic-feed engagement command client. UI state is updated only after the
 * authenticated server command succeeds; the app shell never owns these facts.
 */
export class EngagementClient {
  private commandSequence = 0;

  public constructor(private readonly input: {
    authClient: EngagementCommandTransport;
    secureSessionStore: SecureSessionStore;
    now?: () => Date;
  }) {}

  public async followProfile(followeeId: string): Promise<void> {
    await this.command("FollowProfile", { type: "Profile", id: followeeId }, { followeeId });
  }

  public async reactToPost(postId: string, kind = "LIKE", active = true): Promise<PostEngagement> {
	const result = await this.command("ReactToPost", { type: "Post", id: postId }, { postId, kind, active });
	return this.parseEngagement(result);
  }

  public async replyToPost(postId: string, body: string): Promise<void> {
    const normalized = body.trim();
    if (!normalized) throw new EngagementProtocolError("reply body is required");
    await this.command("ReplyToPost", { type: "Post", id: postId }, { postId, body: normalized });
  }

  /**
   * REPOST-POST-001（2026-09-25）：转发。
   *
   * 原型每一行操作区是 4 个按钮（♡/💬/↻/⤴），第 3 个就是转发。服务端
   * `RepostPost` 从 R14 起就完整实现（engagement/service.go 的 repost()，
   * 含 TestRepostPost_DuplicateAndGhost 的 23505/23503 业务码测试），
   * 但客户端**一直没有这个方法** ⇒ 手机上无处可转发，`reposts` 恒为 0。
   * 这不是「服务端还没做」，是客户端少了一根线。
   *
   * 幂等：服务端把重复转发判成 **REJECTED / ALREADY_REPOSTED**（不是
   * Accepted + state，跟 PinPost/UnpinPost 的写法不一样），所以这里自己认这个
   * 业务码 —— 对用户来说「已经转过了」不是失败，双击不该弹错。其他错误照抛，
   * 不吞。
   */
  public async repostPost(postId: string): Promise<"REPOSTED" | "ALREADY_REPOSTED"> {
    try {
      await this.command("RepostPost", { type: "Post", id: postId }, { postId });
      return "REPOSTED";
    } catch (err) {
      if (err instanceof EngagementCommandRejectedError && err.result.error?.errorCode === "ALREADY_REPOSTED") {
        return "ALREADY_REPOSTED";
      }
      throw err;
    }
  }

  public async getPostEngagement(postId: string): Promise<PostEngagement> {
	return this.parseEngagement(await this.command("GetPostEngagement", { type: "Post", id: postId }, { postId }));
  }

  /**
   * ANALYTICS-ME-001 — 自己帖子收到的互动合计（30 天窗口，服务端聚合）。
   * 自赞/自评不计入；只能查自己的，别人的聚合不暴露。
   */
  public async getReceivedEngagementStats(): Promise<ReceivedEngagementStats> {
    const result = await this.command("GetReceivedEngagementStats", { type: "User", id: "received_engagement" }, {});
    if (!result.operationRef) throw new EngagementProtocolError("received engagement response missing operationRef");
    const raw = JSON.parse(result.operationRef) as { stats?: unknown };
    return ReceivedEngagementStatsSchema.parse(raw.stats);
  }

  public async listPostReplies(postId: string, limit = 20): Promise<PostRepliesList> {
	const result = await this.command("ListPostReplies", { type: "Post", id: postId }, { postId, limit });
	if (!result.operationRef) throw new EngagementProtocolError("listPostReplies response missing operationRef");
	return PostRepliesListSchema.parse(JSON.parse(result.operationRef));
  }

  private parseEngagement(result: CommandResult): PostEngagement {
	if (!result.operationRef) throw new EngagementProtocolError("engagement response missing operationRef");
	const raw = JSON.parse(result.operationRef) as { engagement?: unknown };
	return PostEngagementSchema.parse(raw.engagement);
  }

  public async bookmarkPost(postId: string): Promise<void> {
    await this.command("BookmarkPost", { type: "Post", id: postId }, { postId });
  }

  public async recordFeedPreference(postId: string, action: "NOT_INTERESTED" | "REDUCE_TOPIC" | "REDUCE_AUTHOR", authorId?: string): Promise<void> {
    await this.command("RecordFeedPreference", { type: "Post", id: postId }, { postId, action, ...(authorId ? { authorId } : {}) });
  }

  public async reportPost(postId: string, reason: "SPAM" | "HARASSMENT" | "UNSAFE" | "OTHER"): Promise<void> {
    await this.command("ReportPost", { type: "Post", id: postId }, { postId, reason });
  }

  /**
   * MuteAuthor (R15.45) — 屏蔽一个作者。
   *
   * 与 recordFeedPreference(REDUCE_AUTHOR) 的区别：
   *   - REDUCE_AUTHOR: feed 算法信号（"少推 Ta"），可能仍偶尔出现
   *   - MuteAuthor: 关系层（"我屏蔽 Ta"），feed 永久过滤
   *
   * 幂等：重复 mute 同一 author 不报错。
   * 可逆（MUTE-REVERSIBLE-001）：用 unmuteAuthor 解掉，或在 "我屏蔽的人" 列表里
   *   解除。以前这行把「屏蔽不可撤销、等 Phase 2 再说」写成了产品分期，其实是
   *   服务端根本没有这条命令。真实的后果是：屏蔽后 Ta 的帖子被 feed 永久过滤
   *   （PG 侧 NOT EXISTS），你再也点不到 Ta 的帖子菜单或头像，于是**没有任何入口**
   *   能撤销这次屏蔽。一个只能进不能出的关系操作不是功能，是陷阱。
   */
  public async muteAuthor(authorId: string): Promise<void> {
    await this.command("MuteAuthor", { type: "Profile", id: authorId }, { authorId });
  }

  /**
   * MUTE-REVERSIBLE-001 — 解除对某个作者的屏蔽。
   *
   * 幂等：本来没屏蔽也成功（服务端 state=NOT_MUTED），所以重复点「解除」不报错。
   * 返回值让界面能区分「真的解掉了」和「本来就没屏蔽」—— 两者都算成功，
   * 但不该显示成同一句话。
   */
  public async unmuteAuthor(authorId: string): Promise<"UNMUTED" | "NOT_MUTED"> {
    const result = await this.command("UnmuteAuthor", { type: "Profile", id: authorId }, { authorId });
    return result.aggregate?.state === "UNMUTED" ? "UNMUTED" : "NOT_MUTED";
  }

  /**
   * MUTE-REVERSIBLE-001 — 列出「我屏蔽的人」，最新在前。
   *
   * 跟 unmuteAuthor 是一对：没有这条查询，被屏蔽的人会从 feed 里彻底消失，
   * 也就没有入口能把屏蔽解掉，这条链路仍然是死的。
   *
   * 返回的 authorDisplayName 由服务端**读时**用跟评论同一个 profile 解析器填
   * （屏蔽列表里的人帖子全被过滤掉了，客户端没有别的名字来源）。解析不到时是
   * undefined，界面必须退化成中性标签，绝不能把 authorId 当名字显示。
   *
   * 刻意**不做** listPinnedPosts / listUserReplies 那种「5xx 就吞掉返空列表」的
   * fallback：那些列表是装饰性的，这个是用户唯一的解除入口。服务端不可用时渲染
   * 「还没有屏蔽任何人」是在骗人 —— 用户会以为屏蔽丢了、而且没有任何可操作的
   * 下一步。这里让错误抛出去，由界面给「读取失败 · 重试」。
   */
  public async listMutedAuthors(limit?: number): Promise<MutedAuthorsList> {
    const session = await this.requireSession();
    const result = await this.command(
      "ListMutedAuthors",
      { type: "Profile", id: session.userAccountId },
      { ...(limit ? { limit } : {}) }
    );
    if (!result.operationRef) {
      throw new EngagementProtocolError("listMutedAuthors response missing operationRef");
    }
    return parseMutedAuthorsList(JSON.parse(result.operationRef));
  }

  /**
   * POLL-VOTE-001 — 给帖内投票投一票。
   *
   * 返回**服务端算出来的最新票数**，不是「旧数字 +1」。刻意不在本地乐观地
   * 自己加一：百分比条要是按本地猜测先画出来、再被服务端纠正，用户会看到
   * 数字跳一下，而「投票结果」恰好是用户最不该怀疑的东西。
   *
   * 一人一票：重复投同一个选项幂等；投另一个选项 = 改票（仍然只算一票）。
   *
   * 会被服务端明确拒绝的几种情况（抛 EngagementCommandRejectedError，
   * result.error.errorCode 可读）：
   *   - POLL_CLOSED —— 已截止。注意结果仍然要显示，只是不能再投。
   *   - POLL_OPTION_NOT_FOUND —— 选项不属于这条帖子。
   *   - POLL_NOT_FOUND —— 这条帖子没有投票。
   */
  public async votePostPoll(postId: string, optionId: string): Promise<PostPollView> {
    const result = await this.command("VotePostPoll", { type: "Post", id: postId }, { postId, optionId });
    if (!result.operationRef) {
      throw new EngagementProtocolError("votePostPoll response missing operationRef");
    }
    const raw = JSON.parse(result.operationRef) as { poll?: unknown };
    return PostPollViewSchema.parse(raw.poll);
  }

  // R15.54 — UnfollowProfile: 幂等, 之前没 follow 返 NOT_FOLLOWING
  public async unfollowProfile(followeeId: string): Promise<"UNFOLLOWED" | "NOT_FOLLOWING"> {
    const result = await this.command("UnfollowProfile", { type: "Profile", id: followeeId }, { followeeId });
    return result.aggregate?.state === "UNFOLLOWED" ? "UNFOLLOWED" : "NOT_FOLLOWING";
  }

  // R15.54 — GetFollowCounts: 返 { userId, followers, following }
  public async getFollowCounts(userId: string): Promise<FollowCounts> {
    const result = await this.command("GetFollowCounts", { type: "Profile", id: userId }, { userId });
    if (!result.operationRef) {
      throw new EngagementProtocolError("getFollowCounts response missing operationRef");
    }
    return parseFollowCounts(JSON.parse(result.operationRef));
  }

  // R15.54 — IsFollowing: anonymous OK (followerId="" 返 false)
  public async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const result = await this.command("IsFollowing", { type: "Profile", id: followeeId }, { followerId, followeeId });
    if (!result.operationRef) {
      throw new EngagementProtocolError("isFollowing response missing operationRef");
    }
    const state: FollowingState = parseFollowingState(JSON.parse(result.operationRef));
    return state.isFollowing;
  }

  // R15.56 — PinPost: 幂等 (ALREADY_PINNED). 限 3 个上限 (server PIN_LIMIT_EXCEEDED)
  public async pinPost(postId: string): Promise<"PINNED" | "ALREADY_PINNED"> {
    const result = await this.command("PinPost", { type: "Post", id: postId }, { postId });
    return result.aggregate?.state === "ALREADY_PINNED" ? "ALREADY_PINNED" : "PINNED";
  }

  // R15.56 — UnpinPost: 幂等 (NOT_PINNED)
  public async unpinPost(postId: string): Promise<"UNPINNED" | "NOT_PINNED"> {
    const result = await this.command("UnpinPost", { type: "Post", id: postId }, { postId });
    return result.aggregate?.state === "NOT_PINNED" ? "NOT_PINNED" : "UNPINNED";
  }

  // R15.56 — ListPinnedPosts: 返 { ownerId, postIds, count }
  public async listPinnedPosts(ownerId: string): Promise<PinnedPostsList> {
    // ENGAGEMENT-FALLBACK-EMPTY-001: 这里以前 try/catch 把所有错误（含协议错）
    // 吞成空列表 + 计数 0。后果不只是"少显示一点" —— promise 永远 resolve，
    // 调用方根本没机会知道失败了：个人主页的收藏/回复/置顶会照常渲染成
    // 「还没有收藏／还没有回复」，用户以为自己的东西没了。
    // 注释里写的理由（engagement 表未建、server 5xx）已经过期：三个命令在
    // apps/api-go 里都有实现，并且都有真实 PostgreSQL round-trip 集成测试。
    // 同文件的 listMutedAuthors（上一屏）一直就是这个口径：宁可抛，不假空。
    const result = await this.command("ListPinnedPosts", { type: "Profile", id: ownerId }, { ownerId });
    if (!result.operationRef) {
      throw new EngagementProtocolError("listPinnedPosts response missing operationRef");
    }
    return parsePinnedPostsList(JSON.parse(result.operationRef));
  }

  // R15.61 — ListUserReplies: 返 user 全部 reply 帖 (含父 post 上下文)
  public async listUserReplies(userId: string, limit?: number): Promise<UserRepliesList> {
    // ENGAGEMENT-FALLBACK-EMPTY-001: 这里以前 try/catch 把所有错误（含协议错）
    // 吞成空列表 + 计数 0。后果不只是"少显示一点" —— promise 永远 resolve，
    // 调用方根本没机会知道失败了：个人主页的收藏/回复/置顶会照常渲染成
    // 「还没有收藏／还没有回复」，用户以为自己的东西没了。
    // 注释里写的理由（engagement 表未建、server 5xx）已经过期：三个命令在
    // apps/api-go 里都有实现，并且都有真实 PostgreSQL round-trip 集成测试。
    // 同文件的 listMutedAuthors（上一屏）一直就是这个口径：宁可抛，不假空。
    const result = await this.command("ListUserReplies", { type: "Profile", id: userId }, { userId, ...(limit ? { limit } : {}) });
    if (!result.operationRef) {
      throw new EngagementProtocolError("listUserReplies response missing operationRef");
    }
    return parseUserRepliesList(JSON.parse(result.operationRef));
  }

  // R15.62 — ListUserBookmarks: 返 user 全部 bookmark post IDs
  public async listUserBookmarks(userId: string, limit?: number): Promise<UserBookmarksList> {
    // ENGAGEMENT-FALLBACK-EMPTY-001: 这里以前 try/catch 把所有错误（含协议错）
    // 吞成空列表 + 计数 0。后果不只是"少显示一点" —— promise 永远 resolve，
    // 调用方根本没机会知道失败了：个人主页的收藏/回复/置顶会照常渲染成
    // 「还没有收藏／还没有回复」，用户以为自己的东西没了。
    // 注释里写的理由（engagement 表未建、server 5xx）已经过期：三个命令在
    // apps/api-go 里都有实现，并且都有真实 PostgreSQL round-trip 集成测试。
    // 同文件的 listMutedAuthors（上一屏）一直就是这个口径：宁可抛，不假空。
    const result = await this.command("ListUserBookmarks", { type: "Profile", id: userId }, { userId, ...(limit ? { limit } : {}) });
    if (!result.operationRef) {
      throw new EngagementProtocolError("listUserBookmarks response missing operationRef");
    }
    return parseUserBookmarksList(JSON.parse(result.operationRef));
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const envelope = {
      commandId: this.nextId("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "feed_engagement",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (err) {
      throw new EngagementProtocolError("engagement response body read failed: " + (err instanceof Error ? err.message : String(err)));
    }
    const result = parseCommandResult(responseBody);
    if (!result) {
      const bodyStr = (() => { try { return JSON.stringify(responseBody); } catch { return String(responseBody); } })();
      throw new EngagementProtocolError(`engagement command response was malformed (status=${response.status}): ${bodyStr.slice(0, 200)}`);
    }
    if (result.outcome === "REJECTED") throw new EngagementCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new EngagementProtocolError(`unexpected engagement command status: ${response.status}`);
    }
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    // R15.38: 三种 "不能写" 状态都抛 OfflineFallbackSessionError, 让
    //   feed 表面能统一识别 "访客不能 X" 这个提示, 不再说 "请检查连接"。
    //   - 根本没 session (fresh guest) — keychain 完全空
    //   - 离线 fallback (serverSession === false) — 是 “伪” session
    //   - 软登出 (signedOut === true) — session 还在但被锁
    if (!session?.principal) throw new OfflineFallbackSessionError();
    if (session.serverSession === false) {
      throw new OfflineFallbackSessionError();
    }
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_engagement_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}

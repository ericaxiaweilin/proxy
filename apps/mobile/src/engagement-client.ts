import type { CommandResult, FollowCounts, FollowingState, PinnedPostsList } from "@proxy/contracts";
import {
  parseFollowCounts,
  parseFollowingState,
  parsePinnedPostsList
} from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

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
    super(result.error?.messageKey ?? "engagement command rejected");
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

  public async reactToPost(postId: string, kind = "LIKE"): Promise<void> {
    await this.command("ReactToPost", { type: "Post", id: postId }, { postId, kind });
  }

  public async replyToPost(postId: string, body: string): Promise<void> {
    const normalized = body.trim();
    if (!normalized) throw new EngagementProtocolError("reply body is required");
    await this.command("ReplyToPost", { type: "Post", id: postId }, { postId, body: normalized });
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
   * 不可逆：当前 client 不提供 unmute；Phase 2 在 "我屏蔽的人" 列表里 unmute。
   */
  public async muteAuthor(authorId: string): Promise<void> {
    await this.command("MuteAuthor", { type: "Profile", id: authorId }, { authorId });
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
    const result = await this.command("ListPinnedPosts", { type: "Profile", id: ownerId }, { ownerId });
    if (!result.operationRef) {
      throw new EngagementProtocolError("listPinnedPosts response missing operationRef");
    }
    return parsePinnedPostsList(JSON.parse(result.operationRef));
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
    // R15.38 DEBUG: log full response for diagnosis (guarded for test env)
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      // eslint-disable-next-line no-console
      const bodyStr = (() => { try { return JSON.stringify(responseBody); } catch { return String(responseBody); } })();
      console.log(`[proxy.R15.38.DEBUG.engagement] ${commandType} status=${response.status} body=${bodyStr.slice(0, 600)}`);
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
    // R15.38.5 DEBUG: 看清楚 keychain 里到底是设是设
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        `[proxy.R15.38.5.DEBUG.engagement] requireSession session=${session ? "present" : "absent"} ` +
        `principal=${session?.principal ? `${session.principal.type}:${session.principal.id}` : "absent"} ` +
        `serverSession=${session?.serverSession} signedOut=${session?.signedOut ?? false}`
      );
    }
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

import type { CommandResult } from "@proxy/contracts";
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
    const result = parseCommandResult(await response.json());
    if (!result) throw new EngagementProtocolError("engagement command response was malformed");
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

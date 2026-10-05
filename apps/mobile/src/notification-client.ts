import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

/** 收件箱的一页（MERCHANT-CREATOR-NOTIFY-001）。 */
export type InboxPage = {
  items: InboxItem[];
  /** 下一页游标（不透明字符串），空串表示没有下一页。 */
  nextCursor: string;
  hasMore: boolean;
  /** 全部未读数，与本页无关。铃铛角标必须用这个，不能数当前页。 */
  unreadTotal: number;
};

export type InboxItem = {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  deepLink?: string;
  read: boolean;
  createdAt: string;
};

export class NotificationClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async registerDevice(input: { deviceId: string; platform: string; token: string }): Promise<void> {
    await this.command("RegisterDeviceToken", { type: "DeviceToken", id: input.deviceId }, input as unknown as Record<string, unknown>);
  }

  /**
   * 取收件箱一页（MERCHANT-CREATOR-NOTIFY-001）。
   *
   * 分页是真的必需而不是「以后再说」：服务端以前一次全量返回，本地库已经 926 行
   * 且只增不减 —— 一年后打开 App 是一次几百行的请求，弱网下首屏直接卡住。
   *
   * `unreadTotal` 是全部未读数，与本页无关：铃铛角标以前是前端数当前列表算的，
   * 有了分页它会被页大小封顶（角标显示 20 而真实未读 300）。假数字比旧数字危险 ——
   * 用户据此判断「我有没有漏看消息」。所以角标必须用这个字段。
   */
  public async listInboxPage(input?: { limit?: number; cursor?: string }): Promise<InboxPage> {
    const payload: Record<string, unknown> = {};
    if (input?.limit !== undefined) payload.limit = input.limit;
    if (input?.cursor !== undefined) payload.cursor = input.cursor;
    const body = this.body(await this.command("ListInbox", { type: "Inbox", id: "list" }, payload));
    // NOTIF-EMPTY-LIST-001：`items` 缺失或为 null 表示**空收件箱**，不是协议破损。
    //
    // 服务端（Go）把 nil 切片序列化成 `null` 而不是 `[]` —— 这条路径上一版
    // 直接 `if (!Array.isArray(body.items)) throw`，于是**收件箱为空的用户**
    // 看到的是「通知没取到，下拉重试」的失败态，而不是「还没有通知」的空态。
    // 现网只有 2 个收件人有行，其余全部命中，所以这个 bug 对绝大多数用户
    // 都是 100% 复现的。
    //
    // 服务端已修（空列表发 `[]`）。这里同时放宽：真正的破损是「items 存在但不是
    // 数组」（比如是个对象或字符串），那仍然抛 —— 别把「服务端换了协议」也一起吞掉。
    const items = body.items ?? [];
    if (!Array.isArray(items)) throw new Error("inbox malformed");
    const unreadTotal = typeof body.unreadTotal === "number" ? body.unreadTotal : 0;
    const nextCursor = typeof body.nextCursor === "string" ? body.nextCursor : "";
    return { items: items as InboxItem[], nextCursor, hasMore: Boolean(body.hasMore) || nextCursor !== "", unreadTotal };
  }

  /**
   * 只取第一页（既有调用点用这个）。返回的是**一页**，不是全部 ——
   * 要翻页用 listInboxPage。
   */
  public async listInbox(): Promise<InboxItem[]> {
    return (await this.listInboxPage()).items;
  }

  /** 全部未读数（铃铛角标用，与分页无关）。 */
  public async unreadTotal(): Promise<number> {
    return (await this.listInboxPage()).unreadTotal;
  }

  public async markRead(inboxId: string): Promise<void> {
    await this.command("MarkInboxRead", { type: "InboxItem", id: inboxId }, { inboxId });
  }

  public async resolveDeepLink(deepLink: string): Promise<boolean> {
    const body = this.body(await this.command("ResolveDeepLink", { type: "DeepLink", id: "resolve" }, { deepLink }));
    return Boolean(body.resolved);
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_notif_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "notification",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("notification command malformed");
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "notification rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected notification status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("notifications require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) return {};
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("notification payload malformed");
    return value as Record<string, unknown>;
  }
}

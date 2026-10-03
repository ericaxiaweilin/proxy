import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

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

  public async listInbox(): Promise<InboxItem[]> {
    const body = this.body(await this.command("ListInbox", { type: "Inbox", id: "list" }, {}));
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
    return items as InboxItem[];
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

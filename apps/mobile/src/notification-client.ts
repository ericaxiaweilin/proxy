import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

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
    if (!Array.isArray(body.items)) throw new Error("inbox malformed");
    return body.items as InboxItem[];
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
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "notification rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected notification status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) return {};
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("notification payload malformed");
    return value as Record<string, unknown>;
  }
}

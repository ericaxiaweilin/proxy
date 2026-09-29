import type { CommandResult, GetWalletResult, ListWalletEntriesResult } from "@proxy/contracts";
import { GetWalletResultSchema, ListWalletEntriesResultSchema } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type WalletCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class WalletProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletProtocolError";
  }
}

export class WalletCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(`wallet command rejected: ${result.error?.errorCode ?? "unknown"}`);
    this.name = "WalletCommandRejectedError";
  }
}

// WALLET-001 移动端命令客户端（与 EngagementClient 同形状：信封 + 会话门禁）。
export class WalletClient {
  private commandSequence = 0;

  public constructor(private readonly input: {
    authClient: WalletCommandTransport;
    secureSessionStore: SecureSessionStore;
    now?: () => Date;
  }) {}

  public async getWallet(): Promise<GetWalletResult> {
    const result = await this.command("GetWallet", { type: "Wallet", id: "me" }, {});
    if (!result.operationRef) throw new WalletProtocolError("wallet response missing operationRef");
    return GetWalletResultSchema.parse(JSON.parse(result.operationRef));
  }

  public async listEntries(limit = 20): Promise<ListWalletEntriesResult> {
    const result = await this.command("ListWalletEntries", { type: "Wallet", id: "me" }, { limit });
    if (!result.operationRef) throw new WalletProtocolError("wallet entries response missing operationRef");
    return ListWalletEntriesResultSchema.parse(JSON.parse(result.operationRef));
  }

  public async exchangeBeans(itemId: string): Promise<{ diamonds: number; beans: number }> {
    const result = await this.command("ExchangeBeans", { type: "Wallet", id: "me" }, { itemId });
    if (result.outcome === "REJECTED") throw new WalletCommandRejectedError(result);
    if (!result.operationRef) throw new WalletProtocolError("exchange response missing operationRef");
    const raw = JSON.parse(result.operationRef) as { diamonds?: unknown; beans?: unknown };
    return { diamonds: typeof raw.diamonds === "number" ? raw.diamonds : 0, beans: typeof raw.beans === "number" ? raw.beans : 0 };
  }

  public async confirmRecharge(packageId: string, provider: string): Promise<{ diamonds: number; beans: number }> {
    const result = await this.command("ConfirmRecharge", { type: "Wallet", id: "me" }, { packageId, provider });
    if (result.outcome === "REJECTED") throw new WalletCommandRejectedError(result);
    if (!result.operationRef) throw new WalletProtocolError("recharge response missing operationRef");
    const raw = JSON.parse(result.operationRef) as { diamonds?: unknown; beans?: unknown };
    return { diamonds: typeof raw.diamonds === "number" ? raw.diamonds : 0, beans: typeof raw.beans === "number" ? raw.beans : 0 };
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
      purpose: "wallet",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (err) {
      throw new WalletProtocolError(`unexpected wallet command status: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = parseCommandResult(responseBody);
    if (!result) throw new WalletProtocolError("wallet command response malformed");
    if (response.status < 200 || response.status >= 300) {
      throw new WalletProtocolError(`unexpected wallet command status: ${response.status}`);
    }
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new OfflineFallbackSessionError();
    if (session.serverSession === false) {
      throw new OfflineFallbackSessionError();
    }
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.commandSequence}`;
  }
}

import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export class BusinessClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async createAccount(name: string): Promise<{ businessId: string }> {
    const body = this.body(await this.command("CreateBusinessAccount", { type: "BusinessAccount", id: "new" }, { name }));
    return { businessId: requiredString(body, "businessId") };
  }

  public async listMyAccounts(): Promise<Array<{ id: string; name: string; status: string }>> {
    const body = this.body(await this.command("ListMyBusinessAccounts", { type: "BusinessAccount", id: "mine" }, {}));
    if (!Array.isArray(body.accounts)) throw new Error("business accounts malformed");
    return body.accounts as Array<{ id: string; name: string; status: string }>;
  }

  public async addMember(businessId: string, userId: string, role?: string): Promise<void> {
    await this.command("AddBusinessMember", { type: "BusinessAccount", id: businessId }, { businessId, userId, role });
  }

  public async createStore(businessId: string, name: string, address: string): Promise<{ storeId: string }> {
    const body = this.body(await this.command("CreateBusinessStore", { type: "Store", id: "new" }, { businessId, name, address }));
    return { storeId: requiredString(body, "storeId") };
  }

  public async listStores(businessId: string): Promise<unknown[]> {
    const body = this.body(await this.command("ListBusinessStores", { type: "BusinessAccount", id: businessId }, { businessId }));
    return (body.stores as unknown[]) ?? [];
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_biz_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "business",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("business command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "business rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected business status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("business actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) return {};
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("business payload malformed");
    return value as Record<string, unknown>;
  }
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") throw new Error(`business payload missing ${key}`);
  return value;
}

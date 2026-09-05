import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type BusinessStoreSummary = { id?: string; storeId?: string; name?: string; address: string };

export function merchantMarketIdFromStores(stores: readonly BusinessStoreSummary[]): string {
  const address = stores.find((store) => store.address.trim())?.address.toLocaleLowerCase() ?? "";
  if (/hồ chí minh|ho chi minh|saigon|sài gòn|hcm/.test(address)) return "hcm";
  if (/đà nẵng|da nang|danang/.test(address)) return "dn";
  if (/bắc ninh|bac ninh|北宁/.test(address)) return "bn";
  if (/hà nội|ha noi|hanoi|河内|tay ho|tây hồ|hoàn kiếm/.test(address)) return "hn";
  // The current merchant baseline is Bonsaidon Hanoi. Keep the fallback
  // explicit until BusinessAccount owns a canonical marketId field.
  return "hn";
}

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

  public async listStores(businessId: string): Promise<BusinessStoreSummary[]> {
    const body = this.body(await this.command("ListBusinessStores", { type: "BusinessAccount", id: businessId }, { businessId }));
    if (!Array.isArray(body.stores)) return [];
    return body.stores.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      if (typeof row.address !== "string") return [];
      return [{ ...(typeof row.id === "string" ? { id: row.id } : {}), ...(typeof row.storeId === "string" ? { storeId: row.storeId } : {}), ...(typeof row.name === "string" ? { name: row.name } : {}), address: row.address }];
    });
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

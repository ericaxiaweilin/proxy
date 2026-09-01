import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type AgentPassport = {
  profile: { agentId: string; name: string; bio: string; languages: string[]; serviceAreas: string[]; status: string };
  capabilities: Array<{ capability: string; declared: boolean; verified: boolean }>;
  verifications: Array<{ id: string; capability: string; status: string }>;
  availability: Array<{ id: string; startAt: string; endAt: string; marketId: string; status: string }>;
};

export class SupplyClient {
  private seq = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async getAgentPassport(agentId?: string): Promise<AgentPassport> {
    const payload: Record<string, unknown> = {};
    if (agentId) payload.agentId = agentId;
    const body = this.body(await this.command("GetAgentPassport", { type: "AgentProfile", id: agentId ?? "mine" }, payload));
    return body as unknown as AgentPassport;
  }

  public async declareCapability(input: { capability: string }): Promise<void> {
    await this.command("DeclareCapability", { type: "AgentProfile", id: "mine" }, input as unknown as Record<string, unknown>);
  }

  public async verifyCapability(input: { agentId: string; capability: string }): Promise<void> {
    await this.command("VerifyCapability", { type: "AgentProfile", id: input.agentId }, input as unknown as Record<string, unknown>);
  }

  public async setAvailabilityWindow(input: { startAt: string; endAt: string; marketId: string }): Promise<{ windowId: string }> {
    const body = this.body(await this.command("SetAvailabilityWindow", { type: "AvailabilityWindow", id: "new" }, input as unknown as Record<string, unknown>));
    return { windowId: (body.windowId as string) ?? (body.id as string) ?? "" };
  }

  public async querySuppliers(input: { marketId?: string; capability?: string; limit?: number }): Promise<unknown[]> {
    // 后端 QuerySuppliers 要求 marketId + startAt + durationH，capability 映射到 Capabilities/Languages
    const startAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    const payload: Record<string, unknown> = {
      marketId: input.marketId ?? "hn",
      startAt,
      durationH: 8,
      serviceType: "CITY_COMPANION",
      languages: input.capability ? [input.capability] : undefined,
      capabilities: input.capability ? [input.capability] : undefined,
    };
    // 清理 undefined
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    const body = this.body(await this.command("QuerySuppliers", { type: "AgentProfile", id: "query" }, payload));
    return (body.suppliers as unknown[]) ?? (body.candidates as unknown[]) ?? [];
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (p: string) => `mobile_supply_${p}_${Date.now().toString(36)}_${(++this.seq).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "supply",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("supply command malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "supply rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected supply status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("supply actions require a real sign-in (offline session cannot act)");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) return {};
    try {
      const v = JSON.parse(result.operationRef) as unknown;
      if (v && typeof v === "object") return v as Record<string, unknown>;
    } catch {}
    return {};
  }
}

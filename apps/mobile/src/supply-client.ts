import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export type AgentPassport = {
  profile: { agentId: string; name: string; bio: string; languages: string[]; serviceAreas: string[]; status: string };
  capabilities: Array<{ capability: string; declared: boolean; verified: boolean }>;
  verifications: Array<{ id: string; capability: string; status: string }>;
  availability: Array<{ id: string; startAt: string; endAt: string; marketId: string; status: string }>;
};

export class SupplyProtocolError extends Error {}

// SUPPLY-BODY-001: operationRef 是服务端 payload 的 JSON 串。解析不出来就是
// 协议损坏，不能静默返回 {} —— 那跟"成功但为空"长得一模一样：供给列表会显示
// 0 个可邀约的人（看起来是"没有供给"），实际上是一次失败。同理，解析出来不是
// 对象（裸数字 / null / 字符串）也是损坏，一样要抛，不能退化成空对象。
export function parseSupplyBody(operationRef: string | undefined): Record<string, unknown> {
  if (!operationRef) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(operationRef) as unknown;
  } catch {
    throw new SupplyProtocolError("supply response payload was malformed");
  }
  if (!parsed || typeof parsed !== "object") throw new SupplyProtocolError("supply response payload was not an object");
  return parsed as Record<string, unknown>;
}

export type SupplierCandidate = {
  agentId: string;
  name: string;
  photos: string[];
  languages: string[];
  serviceType: string;
  referencePrice: number;
  currency: string;
  availability?: { startAt: string; endAt: string; marketId: string };
  eligibility: { eligible: boolean; capabilitiesOk: boolean; availabilityOk: boolean; marketOk: boolean };
};

export function parseSupplierCandidates(value: unknown): SupplierCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.agentId !== "string" || typeof item.name !== "string") return [];
    const eligibility = item.eligibility && typeof item.eligibility === "object" ? item.eligibility as Record<string, unknown> : {};
    const availability = item.availability && typeof item.availability === "object" ? item.availability as Record<string, unknown> : undefined;
    const parsedAvailability = availability && typeof availability.startAt === "string" && typeof availability.endAt === "string" && typeof availability.marketId === "string" ? { startAt: availability.startAt, endAt: availability.endAt, marketId: availability.marketId } : undefined;
    return [{ agentId: item.agentId, name: item.name,
      photos: Array.isArray(item.photos) ? item.photos.filter((photo): photo is string => typeof photo === "string" && photo.length > 0) : [],
      languages: Array.isArray(item.languages) ? item.languages.filter((language): language is string => typeof language === "string") : [],
      serviceType: typeof item.serviceType === "string" ? item.serviceType : "",
      referencePrice: typeof item.referencePrice === "number" ? item.referencePrice : 0,
      currency: typeof item.currency === "string" ? item.currency : "VND",
      ...(parsedAvailability ? { availability: parsedAvailability } : {}),
      eligibility: { eligible: eligibility.eligible === true, capabilitiesOk: eligibility.capabilitiesOk === true, availabilityOk: eligibility.availabilityOk === true, marketOk: eligibility.marketOk === true },
    }];
  });
}

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

  public async querySuppliers(input: { marketId?: string; capability?: string; limit?: number }): Promise<SupplierCandidate[]> {
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
    return parseSupplierCandidates(body.suppliers ?? body.candidates).slice(0, input.limit ?? 20);
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
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "supply rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected supply status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("supply actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    return parseSupplyBody(result.operationRef);
  }
}

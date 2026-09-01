import type { CommandResult } from "@proxy/contracts";
import type { MarketOpportunity } from "./market-fixtures";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type MarketApplication = { applicationId: string; opportunityId: string; quote: string; scope: string; status: string };

export class MarketplaceClient {
  private sequence = 0;
  public constructor(private readonly input: { authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> }; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  public async list(): Promise<MarketOpportunity[]> {
    // R15.22 fix: 匿名 iPhone 端也要看到机会计数 (Home tab "机会 / 活动"硬编码
    // 24/46/18 随 R15.22 WIP 被改为 API 加载 — server 端 ListMarketOpportunities
    // (apps/api-go/internal/marketplace/service.go:81) 不限 actor, 仅需
    // optional session, 不再要 requireSession.
    const body = this.body(await this.command("ListMarketOpportunities", { type: "Market", id: "local" }, {}, true));
    if (!Array.isArray(body.opportunities)) throw new Error("market opportunity list was malformed");
    return body.opportunities as MarketOpportunity[];
  }
  public async publish(opportunity: Omit<MarketOpportunity, "id" | "owner" | "ownerType" | "match" | "responses" | "posted" | "verified" | "signal" | "signalClass" | "countdown">): Promise<MarketOpportunity> {
    const body = this.body(await this.command("PublishMarketOpportunity", { type: "MarketOpportunity", id: "new" }, opportunity, false));
    if (!body.opportunity || typeof body.opportunity !== "object") throw new Error("published opportunity was malformed");
    return body.opportunity as MarketOpportunity;
  }
  public async apply(opportunityId: string, quote: string, scope: string): Promise<MarketApplication> {
    const body = this.body(await this.command("ApplyToMarketOpportunity", { type: "MarketOpportunity", id: opportunityId }, { opportunityId, quote, scope }, false));
    if (!body.application || typeof body.application !== "object") throw new Error("market application was malformed");
    return body.application as MarketApplication;
  }
  public async dismiss(opportunityId: string): Promise<void> { await this.command("DismissMarketOpportunity", { type: "MarketOpportunity", id: opportunityId }, { opportunityId }, false); }

  // R15.22 fix: optionalSession param — list() 匿名可调, 写操作 (publish/apply/
  // dismiss) 仍需 requireSession 保持现状. 同 LocalNetClient.sendCommand.
  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>, allowAnonymous: boolean): Promise<CommandResult> {
    const session = allowAnonymous ? await this.optionalSession() : await this.requireSession();
    const next = (prefix: string) => `mobile_market_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    // R15.22 fix: 匿名走 PUBLIC actor (server 端 requiresAuthentication 不拒
    // ListMarketOpportunities), 读 session 本身抛错 (keychain entitlement
    // 缺失) 时 也走 PUBLIC.
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: session ? { type: "USER", id: session.userAccountId } : { type: "PUBLIC", id: "anonymous_reader" },
      principal: session?.principal ?? { type: "PUBLIC", id: "anonymous_reader" },
      target,
      idempotencyKey: next("idempotency"),
      authContext: session ? { sessionId: session.auth.sessionId } : {},
      purpose: "market_opportunity",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("market command response was malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? "market command rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected market command status: ${response.status}`);
    return result;
  }
  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> { const session = await this.input.secureSessionStore.read(); if (!session?.principal) throw new Error("an authenticated principal is required"); if (session.serverSession === false) throw new Error("marketplace actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError(); return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> }; }
  // R15.22 fix: 同 LocalNetClient.optionalSession — 读 session 抛错或空, 返回
  // undefined, 走 PUBLIC actor.
  private async optionalSession(): Promise<(StoredSession & { principal: NonNullable<StoredSession["principal"]> }) | undefined> {
    try {
      const session = await this.input.secureSessionStore.read();
      return session?.principal ? (session as StoredSession & { principal: NonNullable<StoredSession["principal"]> }) : undefined;
    } catch {
      return undefined;
    }
  }
  private body(result: CommandResult): Record<string, unknown> { if (!result.operationRef) throw new Error("market response missing payload"); const value = JSON.parse(result.operationRef) as unknown; if (!value || typeof value !== "object") throw new Error("market payload was malformed"); return value as Record<string, unknown>; }
}

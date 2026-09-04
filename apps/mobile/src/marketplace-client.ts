import type { CommandResult } from "@proxy/contracts";
import { MarketOpportunitySchema, ListMarketOpportunitiesPayloadSchema } from "@proxy/contracts";
import type { MarketOpportunity } from "./market-fixtures";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export type MarketApplication = { applicationId: string; opportunityId: string; quote: string; scope: string; status: string };

export class MarketplaceClient {
  private sequence = 0;
  public constructor(private readonly input: { authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>; requestPublic?(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> }; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  public async list(userFix?: { lat: number; lng: number } | undefined): Promise<MarketOpportunity[]> {
    // R15.22 fix: 匿名 iPhone 端也要看到机会计数 (Home tab "机会 / 活动"硬编码
    // 24/46/18 随 R15.22 WIP 被改为 API 加载 — server 端 ListMarketOpportunities
    // (apps/api-go/internal/marketplace/service.go:81) 不限 actor, 仅需
    // optional session, 不再要 requireSession.
    //
    // R15.x: if a foreground-location fix is available (the user
    // granted GPS in the Map view and we cached it), pass it
    // through so the server can recompute Travel via haversine.
    // Without this, NEARBY/RECOMMEND sort order is the editor's
    // "河内 18 min" placeholder for every viewer.
    const payload: Record<string, unknown> = {};
    if (userFix
        && Number.isFinite(userFix.lat) && Number.isFinite(userFix.lng)
        && userFix.lat >= -90 && userFix.lat <= 90
        && userFix.lng >= -180 && userFix.lng <= 180
        && !(userFix.lat === 0 && userFix.lng === 0)) {
      payload.userLat = userFix.lat;
      payload.userLng = userFix.lng;
    }
    const body = this.body(await this.command("ListMarketOpportunities", { type: "Market", id: "local" }, payload, true));
    // R16.x: wire schema 是权威。MoneyFlow / PriceLabel 是 wire 必填，
    // 服务端 normalize 后必下发。本地 zod parse 关闭“裸金额”这条路径。
    const parsed = ListMarketOpportunitiesPayloadSchema.safeParse(body);
    if (!parsed.success) throw new Error(`market opportunity list was malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    return parsed.data.opportunities as MarketOpportunity[];
  }
  public async publish(opportunity: Omit<MarketOpportunity, "id" | "owner" | "ownerType" | "match" | "responses" | "posted" | "verified" | "signal" | "signalClass" | "countdown">): Promise<MarketOpportunity> {
    // R16.x: 资金方向必填。客户端必须传 MoneyFlow + PriceLabel。
    // 客户端 SDK 服务于 wire schema，这里交 zod 路径闸一下。
    const candidate = { ...opportunity, owner: "", ownerType: "PERSON" as const, match: "", responses: 0, posted: "", verified: false, signal: "", signalClass: "", countdown: "" };
    const parsed = MarketOpportunitySchema.safeParse(candidate);
    if (!parsed.success) throw new Error(`published opportunity shape invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
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
    // Public discovery must never be poisoned by an expired/stale account
    // session. It deliberately omits bearer credentials even when Keychain
    // still contains an old login.
    const session = allowAnonymous ? undefined : await this.requireSession();
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
    const request = allowAnonymous && this.input.authClient.requestPublic
      ? this.input.authClient.requestPublic.bind(this.input.authClient)
      : this.input.authClient.request.bind(this.input.authClient);
    const response = await request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
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

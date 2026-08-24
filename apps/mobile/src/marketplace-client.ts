import type { CommandResult } from "@proxy/contracts";
import type { MarketOpportunity } from "./market-fixtures";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";

export type MarketApplication = { applicationId: string; opportunityId: string; quote: string; scope: string; status: string };

export class MarketplaceClient {
  private sequence = 0;
  public constructor(private readonly input: { authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> }; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  public async list(): Promise<MarketOpportunity[]> {
    const body = this.body(await this.command("ListMarketOpportunities", { type: "Market", id: "local" }, {}));
    if (!Array.isArray(body.opportunities)) throw new Error("market opportunity list was malformed");
    return body.opportunities as MarketOpportunity[];
  }
  public async publish(opportunity: Omit<MarketOpportunity, "id" | "owner" | "ownerType" | "match" | "responses" | "posted" | "verified" | "signal" | "signalClass" | "countdown">): Promise<MarketOpportunity> {
    const body = this.body(await this.command("PublishMarketOpportunity", { type: "MarketOpportunity", id: "new" }, opportunity));
    if (!body.opportunity || typeof body.opportunity !== "object") throw new Error("published opportunity was malformed");
    return body.opportunity as MarketOpportunity;
  }
  public async apply(opportunityId: string, quote: string, scope: string): Promise<MarketApplication> {
    const body = this.body(await this.command("ApplyToMarketOpportunity", { type: "MarketOpportunity", id: opportunityId }, { opportunityId, quote, scope }));
    if (!body.application || typeof body.application !== "object") throw new Error("market application was malformed");
    return body.application as MarketApplication;
  }
  public async dismiss(opportunityId: string): Promise<void> { await this.command("DismissMarketOpportunity", { type: "MarketOpportunity", id: opportunityId }, { opportunityId }); }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_market_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = { commandId: next("command"), commandType, commandVersion: 1, actor: { type: "USER", id: session.userAccountId }, principal: session.principal, target, idempotencyKey: next("idempotency"), authContext: { sessionId: session.auth.sessionId }, purpose: "market_opportunity", correlationId: next("correlation"), requestedAt: (this.input.now ?? (() => new Date()))().toISOString(), payload };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("market command response was malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? "market command rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected market command status: ${response.status}`);
    return result;
  }
  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> { const session = await this.input.secureSessionStore.read(); if (!session?.principal) throw new Error("an authenticated principal is required"); return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> }; }
  private body(result: CommandResult): Record<string, unknown> { if (!result.operationRef) throw new Error("market response missing payload"); const value = JSON.parse(result.operationRef) as unknown; if (!value || typeof value !== "object") throw new Error("market payload was malformed"); return value as Record<string, unknown>; }
}

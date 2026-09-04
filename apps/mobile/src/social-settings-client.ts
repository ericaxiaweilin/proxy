import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import type { SocialSettingsRecord } from "./social-settings-store";

export class SocialSettingsClient {
  private sequence = 0;
  public constructor(private readonly input: { authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> }; secureSessionStore: SecureSessionStore; now?: () => Date }) {}

  public async read(): Promise<SocialSettingsRecord> {
    return this.toRecord(this.body(await this.command("GetAccountPreferences", {})).preferences);
  }

  public async write(value: SocialSettingsRecord): Promise<SocialSettingsRecord> {
    const preferences = {
      socialAccounts: value.accounts,
      showOnMerchant: value.merchant,
      showOnProfile: value.profile,
      showInfluence: value.influence,
      collaborationEnabled: value.collaborationEnabled ?? false,
      collaborationTypes: value.collaborationTypes ?? [],
      collaborationRate: value.collaborationRate ?? "",
      collaborationContact: value.collaborationContact ?? "",
    };
    return this.toRecord(this.body(await this.command("UpdateAccountPreferences", preferences)).preferences);
  }

  private async command(commandType: string, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (kind: string) => `mobile_preferences_${kind}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = { commandId: next("command"), commandType, commandVersion: 1, actor: { type: "USER", id: session.userAccountId }, principal: session.principal, target: { type: "AccountPreferences", id: session.userAccountId }, idempotencyKey: next("idempotency"), authContext: { sessionId: session.auth.sessionId }, purpose: "account_preferences", correlationId: next("correlation"), requestedAt: (this.input.now ?? (() => new Date()))().toISOString(), payload };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("account preferences response malformed");
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "account preferences rejected");
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected account preferences status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal || session.serverSession === false || session.signedOut === true) throw new Error("account preferences require a real sign-in");
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new Error("account preferences payload missing");
    const parsed = JSON.parse(result.operationRef) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("account preferences payload malformed");
    return parsed as Record<string, unknown>;
  }

  private toRecord(value: unknown): SocialSettingsRecord {
    if (!value || typeof value !== "object") throw new Error("account preferences malformed");
    const p = value as Record<string, unknown>;
    if (!Array.isArray(p.socialAccounts) || typeof p.showOnMerchant !== "boolean" || typeof p.showOnProfile !== "boolean" || typeof p.showInfluence !== "boolean") throw new Error("account preferences malformed");
    return { accounts: p.socialAccounts as SocialSettingsRecord["accounts"], merchant: p.showOnMerchant, profile: p.showOnProfile, influence: p.showInfluence, collaborationEnabled: p.collaborationEnabled === true, collaborationTypes: Array.isArray(p.collaborationTypes) ? p.collaborationTypes.filter((item): item is string => typeof item === "string") : [], collaborationRate: typeof p.collaborationRate === "string" ? p.collaborationRate : "", collaborationContact: typeof p.collaborationContact === "string" ? p.collaborationContact : "" };
  }
}

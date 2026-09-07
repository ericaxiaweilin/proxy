import type { TransportResponse } from "./auth-client";

export type PlatformAIAccount = {
  accountId: string; personaId: string; handle: string; displayName: string;
  avatarPath: string; avatarMediaAssetId?: string; avatarVersion?: number; description: string; role: string; personality: string;
  welcomeMessage: string; suggestedPrompts: string[]; ugcSamples: string[];
  personaType: "PLATFORM_AI"; status: "ACTIVE"; aiStatus: "AI";
};
type PublicTransport = { requestPublic(path: string, init?: { method: "GET" }): Promise<TransportResponse> };

export class AIAccountClient {
  public constructor(private readonly transport: PublicTransport) {}
  public async listRecommended(): Promise<PlatformAIAccount[]> {
    const response = await this.transport.requestPublic("/v1/ai/accounts", { method: "GET" });
    if (response.status !== 200) throw new Error(`AI account catalog failed: ${response.status}`);
    const raw = await response.json() as { accounts?: unknown };
    if (!Array.isArray(raw.accounts)) throw new Error("AI account catalog malformed");
    return raw.accounts.filter(isPlatformAIAccount);
  }
}

function isPlatformAIAccount(value: unknown): value is PlatformAIAccount {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.personaType === "PLATFORM_AI" && item.status === "ACTIVE" && item.aiStatus === "AI"
    && ["accountId", "personaId", "handle", "displayName", "avatarPath", "description", "role", "personality", "welcomeMessage"].every((key) => typeof item[key] === "string" && item[key] !== "")
    && Array.isArray(item.suggestedPrompts) && item.suggestedPrompts.length >= 2 && item.suggestedPrompts.every((prompt) => typeof prompt === "string" && prompt.length > 0)
    && Array.isArray(item.ugcSamples) && item.ugcSamples.length >= 2 && item.ugcSamples.every((post) => typeof post === "string" && post.length > 0);
}

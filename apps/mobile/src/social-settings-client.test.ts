import { describe, expect, it } from "vitest";
import type { TransportResponse } from "./auth-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";
import { SocialSettingsClient } from "./social-settings-client";

function response(body: unknown): TransportResponse { return { status: 200, json: async () => body }; }

describe("UI-SOCIAL-002 — account social settings sync", () => {
  it("uses authenticated account ownership and round-trips server preferences", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({ userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" }, auth: { sessionId: "session_1", userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-09-04T01:00:00.000Z", refreshExpiresAt: "2026-10-04T00:00:00.000Z", rotation: 1 } });
    const requests: Record<string, unknown>[] = [];
    const preferences = { socialAccounts: [], showOnMerchant: true, showOnProfile: false, showInfluence: false, collaborationEnabled: true, collaborationTypes: ["UGC"], collaborationRate: "500000", collaborationContact: "Zalo Huyen" };
    const client = new SocialSettingsClient({ secureSessionStore: store, authClient: { request: async (_path, init) => { requests.push(init.body as Record<string, unknown>); return response({ commandId: "cmd", outcome: "ACCEPTED", aggregate: { type: "AccountPreferences", id: "user_1", version: 1, state: "UPDATED" }, eventRefs: [], operationRef: JSON.stringify({ preferences }), correlationId: "corr" }); } } });
    expect((await client.write({ accounts: [], merchant: true, profile: false, influence: false, collaborationEnabled: true, collaborationTypes: ["UGC"], collaborationRate: "500000", collaborationContact: "Zalo Huyen" })).collaborationContact).toBe("Zalo Huyen");
    expect(requests[0]?.actor).toEqual({ type: "USER", id: "user_1" });
    expect(requests[0]?.target).toEqual({ type: "AccountPreferences", id: "user_1" });
  });
});

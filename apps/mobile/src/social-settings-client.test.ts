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

  it("UI-SOCIAL-003 distinguishes a missing server record so local upgrade data can migrate", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({ userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" }, auth: { sessionId: "session_1", userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-09-04T01:00:00.000Z", refreshExpiresAt: "2026-10-04T00:00:00.000Z", rotation: 1 } });
    const client = new SocialSettingsClient({ secureSessionStore: store, authClient: { request: async () => response({ commandId: "cmd", outcome: "ACCEPTED", aggregate: { type: "AccountPreferences", id: "user_1", version: 0, state: "READ" }, eventRefs: [], operationRef: JSON.stringify({ exists: false, preferences: { socialAccounts: [], showOnMerchant: false, showOnProfile: false, showInfluence: false } }), correlationId: "corr" }) } });
    await expect(client.read()).resolves.toBeUndefined();
  });

  it("UI-SOCIAL-003 serializes rapid writes so an older response cannot overwrite the latest state", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({ userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" }, auth: { sessionId: "session_1", userAccountId: "user_1", principal: { type: "INDIVIDUAL", id: "user_1" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-09-04T01:00:00.000Z", refreshExpiresAt: "2026-10-04T00:00:00.000Z", rotation: 1 } });
    let active = 0; let maxActive = 0;
    const client = new SocialSettingsClient({ secureSessionStore: store, authClient: { request: async (_path, init) => { active += 1; maxActive = Math.max(maxActive, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; const payload = (init.body as { payload: Record<string, unknown> }).payload; return response({ commandId: "cmd", outcome: "ACCEPTED", aggregate: { type: "AccountPreferences", id: "user_1", version: 1, state: "UPDATED" }, eventRefs: [], operationRef: JSON.stringify({ preferences: payload }), correlationId: "corr" }); } } });
    const base = { accounts: [], merchant: false, profile: false, influence: false };
    await Promise.all([client.write({ ...base, collaborationContact: "old" }), client.write({ ...base, collaborationContact: "latest" })]);
    expect(maxActive).toBe(1);
  });
});

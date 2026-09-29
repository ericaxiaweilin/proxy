import { describe, expect, it } from "vitest";
import { WalletClient } from "./wallet-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

function authed(seen: Array<Record<string, unknown>>, responder: (env: Record<string, unknown>) => Record<string, unknown>) {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  void store.write({
    userAccountId: "user_001",
    principal: { type: "INDIVIDUAL", id: "user_001" },
    auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
  });
  return new WalletClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
    const envelope = init.body as Record<string, unknown>;
    seen.push(envelope);
    return { status: 200, json: async () => responder(envelope) };
  } } });
}

const walletPayload = {
  diamonds: 140, beans: 7,
  vip: { active: false },
  rechargePackages: [{ id: "r120", diamonds: 120, bonusDiamonds: 20, priceVND: 25000 }],
  exchangeCatalog: [{ id: "diamonds_1", costBeans: 3, kind: "DIAMONDS", amount: 1, enabled: true }],
  providers: [{ id: "SIMULATED", name: "模拟支付", enabled: true }]
};

function ok(operationRef: unknown) {
  return (env: Record<string, unknown>) => ({
    commandId: env.commandId, outcome: "ACCEPTED", eventRefs: [], correlationId: env.correlationId, operationRef: JSON.stringify(operationRef)
  });
}

describe("WALLET-001 wallet client", () => {
  it("getWallet parses balances, catalogs and providers", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const result = await authed(seen, ok(walletPayload)).getWallet();
    expect(seen[0]?.commandType).toBe("GetWallet");
    expect(result.diamonds).toBe(140);
    expect(result.beans).toBe(7);
    expect(result.rechargePackages).toHaveLength(1);
    expect(result.providers[0]?.enabled).toBe(true);
  });

  it("listEntries parses the ledger lines", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const entries = [{ id: "we_1", userId: "user_001", currency: "DIAMOND", delta: 140, reason: "RECHARGE_CREDIT", createdAt: "2026-09-29T00:00:00Z" }];
    const result = await authed(seen, ok({ entries })).listEntries(20);
    expect(seen[0]?.commandType).toBe("ListWalletEntries");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.delta).toBe(140);
  });

  it("exchangeBeans returns the new balances", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const result = await authed(seen, ok({ diamonds: 1, beans: 7, itemId: "diamonds_1" })).exchangeBeans("diamonds_1");
    expect(seen[0]?.commandType).toBe("ExchangeBeans");
    expect(result).toEqual({ diamonds: 1, beans: 7 });
  });

  it("confirmRecharge returns the new balances", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const result = await authed(seen, ok({ diamonds: 140, beans: 0, packageId: "r120", credited: 140 })).confirmRecharge("r120", "SIMULATED");
    expect(seen[0]?.commandType).toBe("ConfirmRecharge");
    expect(result.diamonds).toBe(140);
  });
});

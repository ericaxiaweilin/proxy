import { describe, expect, it } from "vitest";
import { CONSENT_PURPOSES, createBehaviorAnalyticsStore } from "./behavior-analytics-settings";
import { endAppSession, endSceneView, endScreenView, screenIdOf } from "./post-impression";

function memoryDriver() {
  const map = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> { return map.get(key) ?? null; },
    async setItem(key: string, value: string): Promise<void> { map.set(key, value); },
    async deleteItem(key: string): Promise<void> { map.delete(key); },
  };
}

describe("usage tracker", () => {
  it("page ids become server-acceptable screen ids", () => {
    expect(screenIdOf("MARKET_OPP")).toBe("market_opp");
    expect(screenIdOf("A B/c")).toBe("a_b_c");
    expect(/^[a-z0-9_-]{1,40}$/.test(screenIdOf("x".repeat(80)))).toBe(true);
  });

  it("sends nothing without explicit consent, and nothing for sub-second stays", async () => {
    const calls: string[] = [];
    const client = {
      recordScreenView: async (id: string) => { calls.push(`screen:${id}`); },
      recordAppSession: async () => { calls.push("session"); },
      recordSceneView: async (id: string) => { calls.push(`scene:${id}`); },
    };
    const store = createBehaviorAnalyticsStore(memoryDriver());
    await endScreenView(client, "home", Date.now() - 5000, store);
    await endAppSession(client, Date.now() - 5000, store);
    expect(calls).toEqual([]); // 从未同意

    await store.write(CONSENT_PURPOSES[0]!, true);
    await endScreenView(client, "home", Date.now() - 200, store);
    expect(calls).toEqual([]); // <1s 不记
    await endScreenView(client, "home", Date.now() - 5000, store);
    await endAppSession(client, Date.now() - 5000, store);
    await endSceneView(client, "cafe_giang", Date.now() - 6000, store);
    expect(calls).toEqual(["screen:home", "session", "scene:cafe_giang"]);
  });
});

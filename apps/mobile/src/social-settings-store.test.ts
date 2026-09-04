import { describe, expect, it } from "vitest";
import { InMemorySecureStorageDriver } from "./secure-session";
import { createSocialSettingsStore } from "./social-settings-store";

describe("UI-SOCIAL-001 — social settings persist", () => {
  it("round trips user-controlled accounts and visibility", async () => {
    const store = createSocialSettingsStore(new InMemorySecureStorageDriver());
    const value = { accounts: [{ key: "zalo", mark: "Z", name: "Zalo", handle: "Huyen", url: "https://zalo.me/huyen", visibility: "商家可见" as const }], merchant: true, profile: false, influence: false, collaborationEnabled: true, collaborationTypes: ["UGC"], collaborationRate: "500000", collaborationContact: "Zalo Huyen" };
    await store.write(value);
    expect(await store.read()).toEqual(value);
  });
});

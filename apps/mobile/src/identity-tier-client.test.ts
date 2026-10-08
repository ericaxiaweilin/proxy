import { describe, expect, it } from "vitest";
import { fetchIdentityTier, tierLabel, tierProgress } from "./identity-tier-client";

const level = { tier: "BRONZE" as const, name: "铜", stars: 2, min: 100, points: 175, next: { tier: "BRONZE" as const, name: "铜", stars: 3, min: 250 }, toNext: 75, highest: false };

describe("identity tier client", () => {
  it("renders the label and progress inside the current level", () => {
    expect(tierLabel(level)).toBe("铜★★");
    expect(tierProgress(level)).toBe(50);
    expect(tierProgress({ tier: "GOLD", name: "金", stars: 3, min: 3600, points: 4000, highest: true })).toBe(100);
  });
  it("an unreadable response draws nothing", async () => {
    expect(await fetchIdentityTier({ request: async () => ({ status: 500, json: async () => ({}) }) })).toBeUndefined();
    expect(await fetchIdentityTier({ request: async () => { throw new Error("offline"); } })).toBeUndefined();
    expect(await fetchIdentityTier({ request: async () => ({ status: 200, json: async () => ({ level: { points: 0, name: "铜", stars: 1, tier: "BRONZE", min: 0, highest: false } }) }) })).toMatchObject({ level: { points: 0 } });
  });
});

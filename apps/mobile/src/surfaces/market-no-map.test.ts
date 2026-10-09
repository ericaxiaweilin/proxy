import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 市场就是下订单 / 报名活动：不需要在地图上看「哪里有订单」。地图入口整个移除（用户 2026-10-09）。
// 同时它也是一次闪退的现场：react-native-maps 的 AIRMap insertReactSubview 在子节点增删时抛 NSRangeException。
describe("market has no map entry", () => {
  const src = readFileSync(new URL("./market.tsx", import.meta.url), "utf8");
  it("no map toggle, no MarketMap, no react-native-maps in the market surface", () => {
    expect(src).not.toContain("react-native-maps");
    expect(src).not.toContain("function MarketMap");
    expect(src).not.toContain("<MarketMap");
    expect(src).not.toContain('"MAP"');
    expect(src).not.toContain("viewToggle");
  });
  it("still gets the device fix itself for nearby sorting, city label and weather", () => {
    expect(src).toContain("getCurrentFix(expoLocationApi");
  });
});

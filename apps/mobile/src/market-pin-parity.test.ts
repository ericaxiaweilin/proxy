import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MARKET-PIN-PARITY-001: 市场地图里订单钉是实心靛青，探索点钉挂了
// opacity=0.85 的淡紫 —— 在活动页（只有探索点）看起来比订单钉小一圈。
// 同一种原生图钉只许用颜色区分语义，不许用透明度造出尺寸差。
describe("MARKET-PIN-PARITY-001", () => {
  const market = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");

  it("renders explorer spots at full strength like order pins", () => {
    expect(market).toContain("EXPLORER_SPOTS.map((spot) => (");
    expect(market).not.toContain("opacity={0.85}");
    // 颜色语义保留：订单靛青，探索紫（聚合后变量改名，语义不变）。
    expect(market).toContain('pinColor="#0B7A73"');
    expect(market).toContain('m.tag === "HOT" ? "#7A2DC7" : "#9A8AB5"');
  });
});

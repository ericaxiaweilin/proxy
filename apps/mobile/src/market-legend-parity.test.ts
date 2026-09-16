import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MARKET-LEGEND-PARITY-001: 订单/活动副标题长短不一，图例行换行行数不同，
// 整张地图卡一高一矮。图例行锁死高度 + 副标题两行封顶，两边恒等高。
describe("MARKET-LEGEND-PARITY-001", () => {
  const market = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");

  it("locks the legend row height and caps the subtitle", () => {
    expect(market).toMatch(/mapLegend:\s*\{[^}]*height:\s*34[^}]*\}/);
    expect(market).toContain("numberOfLines={2} style={styles.mapLegendSub}");
    expect(market).toContain("flexShrink: 1");
  });
});

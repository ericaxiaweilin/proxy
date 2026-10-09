import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MARKET-MAP-USER-CENTER-001: 市场地图初开摆的是河内硬编码（没图钉时）或
// 订单 centroid —— 用户在北宁点开地图，看到的还是河内，非要点一下
// “用我当前位置”。壳里明明有活的人位（设备跟随/CUSTOM/DEVICE），
// 地图初开就该以人为中心。缺省（没接线）才退回 centroid/河内。
describe("MARKET-MAP-USER-CENTER-001", () => {
  const market = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("./shell/app-shell.tsx", import.meta.url)), "utf8");

  it("passes the shell live location into the market surface", () => {
    expect(shell).toContain("userCenter={sceneMapOrigin");
    expect(shell).toContain("lat: sceneMapOrigin.latitude");
  });

});

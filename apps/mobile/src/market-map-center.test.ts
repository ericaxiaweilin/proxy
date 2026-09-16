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

  it("prefers the viewer center for the initial region, Hanoi stays the last resort", () => {
    expect(market).toContain("userCenter");
    expect(market).toContain("if (userCenter) {");
    // 河内硬编码只许出现在无图钉又无人的回落分支。
    expect(market).toContain("latitude: 21.0285, longitude: 105.8542");
    // 人位晚到（存档恢复/GPS 首 fix）时补飞过去，但不抢用户自己点的。
    expect(market).toContain("if (!userCenter || userRegion) return;");
    expect(market).toContain("animateToRegion");
    // 文案不许撒谎：没蓝点时不许写“蓝点是您”。
    expect(market).toContain("点右下角“用我当前位置”显示蓝点");
  });

  it("passes the shell live location into the market surface", () => {
    expect(shell).toContain("userCenter={sceneMapOrigin");
    expect(shell).toContain("lat: sceneMapOrigin.latitude");
  });

  it("lights the blue dot on the shell center like the home scene map", () => {
    // 场景页 showsUserLocation={!!origin} 进门亮蓝点；市场页之前只认按钮
    // locGranted，同一份人位进门不亮。无授权时 iOS 本来就不渲染，不撒谎。
    expect(market).toContain("showsUserLocation={locGranted || !!userCenter}");
  });
});

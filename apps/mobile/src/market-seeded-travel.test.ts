import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { travelMinutesFromViewer, type MarketOpportunity } from "./market-fixtures.js";

// MARKET-SEEDED-TRAVEL-001: 市场列表/详情把 travel 当成"看的人的通勤时间"显示，
// 但 travel 只有在 travelSource === "user_distance" 时才是按看的人的位置算出来的。
// 种子数据里写死的 18/24/52/20（service.go SeedDefaults，注释原话：客户端还没给
// 前台定位时 seeded Travel 顶上）跟正在看的人在哪毫无关系 —— 显示成"通勤约 18 分钟"
// 是拿编辑的占位数字冒充实时推算。服务端专门返了 travelSource 来区分。
function opp(travel: number | null, travelSource?: MarketOpportunity["travelSource"]): MarketOpportunity {
  return { travel, travelSource } as unknown as MarketOpportunity;
}

describe("MARKET-SEEDED-TRAVEL-001", () => {
  it("returns the minutes when the server computed them from the viewer", () => {
    expect(travelMinutesFromViewer(opp(27, "user_distance"))).toBe(27);
  });

  it("hides the seeded placeholder — it says nothing about the viewer", () => {
    // 种子数据里写死的 18/24/52/20。
    expect(travelMinutesFromViewer(opp(18, "seeded"))).toBeNull();
    expect(travelMinutesFromViewer(opp(52, "seeded"))).toBeNull();
  });

  it("hides it when the source is unknown or missing", () => {
    expect(travelMinutesFromViewer(opp(18, "unknown"))).toBeNull();
    // 老数据 / 没有定位时服务端会整个省掉这个字段。
    expect(travelMinutesFromViewer(opp(18, undefined))).toBeNull();
    expect(travelMinutesFromViewer(opp(18))).toBeNull();
  });

  it("hides it when there is no number at all", () => {
    expect(travelMinutesFromViewer(opp(null, "user_distance"))).toBeNull();
  });

  it("the detail screen never renders the raw travel field", () => {
    const source = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");
    // 反向钉：不能直接拿 travel 就用 —— 那正是把占位数字当通勤时间显示的那行。
    expect(source).not.toContain("opportunity.travel != null");
    // 正向：必须走派生函数。
    // import + 调用点；渲染处用的是派生出来的 viewerTravelMinutes。
    expect((source.match(/travelMinutesFromViewer/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("const viewerTravelMinutes = travelMinutesFromViewer(opportunity);");
  });
});

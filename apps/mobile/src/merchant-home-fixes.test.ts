import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { decisionKindLabel, demandSupplyStateLabel } from "./merchant-home-labels";
import { activityCoverUri } from "./media-thumb-url";

// MERCHANT-HOME-001（2026-10-02）：经营主页一个接口失败不能拖垮整页。
//
// 以前 getMerchantOperatingHome 是 Promise.all 里**唯一没有 .catch 的** ——
// 它一抛错，门店 / 成员 / 成交 / 菜单的结果一起被丢掉，整页只剩 loadError。
// 经营信号读不到 ≠ 整家店不存在。
describe("MERCHANT-HOME-001 经营信号失败不拖垮整页", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/business-home.tsx", import.meta.url)), "utf8");

  it("getMerchantOperatingHome 有兜底，和其它三路同口径", () => {
    // 只钉"这一路有 .catch"，不钉变量名 —— 之前写死 first.id，另一个 agent
    // 把变量改名成 id 就红了，而行为（有兜底）根本没变。钉变量名就是在给
    // 重命名上锁，那不是这条测试要管的事。
    expect(src).toMatch(/business\.getMerchantOperatingHome\([^)]+\)\.catch\(\(\) => undefined\)/);
  });

  it("home 为 undefined 时保持待接入态，不清旧值、不整页报错", () => {
    expect(src).toContain("if (home !== undefined) setOperatingHome(home);");
  });
});

// MERCHANT-HOME-002（2026-10-02）：场景卡要能看到活动封面。
//
// 以前 toCard 只读那个**没有任何写入者**的 coverImageUrl，所以"高价值场景 /
// 正在进行"永远画不出封面（不是没传，是没读）。
describe("MERCHANT-HOME-002 商家场景卡读活字段的封面", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/business-home.tsx", import.meta.url)), "utf8");

  it("toCard 优先读 coverMediaAssetId", () => {
    expect(src).toContain("coverMediaAssetId: entry.coverMediaAssetId");
    // 死字段只能做回落，不能是第一顺位。先剥注释再比顺序 —— 修复说明里会提到
    // 死字段的名字，那是解释不是代码（跟门禁里同一个坑）。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const card = code.slice(code.indexOf("const toCard ="));
    const liveAt = card.indexOf("entry.coverMediaAssetId");
    const deadAt = card.indexOf("entry.coverImageUrl");
    expect(liveAt).toBeGreaterThanOrEqual(0);
    expect(deadAt).toBeGreaterThanOrEqual(0);
    expect(liveAt).toBeLessThan(deadAt);
  });

  it("渲染走共享 helper，不在 JSX 里手拼 URL", () => {
    const branch = src.slice(src.indexOf("scenePackages.map((pkg)"));
    expect(branch).toContain("scenePackageUri(pkg)");
    expect(branch).not.toContain("v1/media/thumb/");
  });

  it("封面解析本身是对的（有资产优先，死字段回落，都没有就空）", () => {
    expect(activityCoverUri({ coverMediaAssetId: "ma_1" }, "http://x")).toBe("http://x/v1/media/thumb/ma_1");
    expect(activityCoverUri({ coverImageUrl: "https://old/x.jpg" }, "http://x")).toBe("https://old/x.jpg");
    expect(activityCoverUri({}, "http://x")).toBeUndefined();
  });
});

// MERCHANT-HOME-004（2026-10-02）：服务端枚举不能直接印给中文商家。
//
// 原来 controlPlane 的「决策」格和 balanceHead 的状态 pill 直接显示
// NO_ACTION / DEMAND_RISING / INSUFFICIENT_SIGNAL —— 商家看到的是一串英文代号。
describe("MERCHANT-HOME-004 枚举有中文名，未知值不吞", () => {
  it("决策 kind 全覆盖 resolver 会吐的三种", () => {
    expect(decisionKindLabel("NO_ACTION")).toBe("暂不行动");
    expect(decisionKindLabel("STOP_TRAFFIC")).toBe("停止引流");
    expect(decisionKindLabel("LOW_PEAK_FILL")).toBe("低峰补量");
    expect(decisionKindLabel(undefined)).toBe("暂不行动");
  });

  it("供需状态全覆盖 resolver 会吐的六种", () => {
    expect(demandSupplyStateLabel("INSUFFICIENT_SIGNAL")).toBe("信号不足");
    expect(demandSupplyStateLabel("BALANCED")).toBe("供需平衡");
    expect(demandSupplyStateLabel("OVER_CAPACITY_RISK")).toBe("超容风险");
    expect(demandSupplyStateLabel("CAPACITY_TIGHT")).toBe("容量偏紧");
    expect(demandSupplyStateLabel("DEMAND_RISING")).toBe("需求上升");
    expect(demandSupplyStateLabel("SUPPLY_EXCESS")).toBe("供给过剩");
    expect(demandSupplyStateLabel(undefined)).toBe("信号不足");
  });

  it("服务端加了新状态也不能静默消失", () => {
    // 吞掉等于告诉商家"一切正常"。回落原文，至少商家能拿着它来问。
    expect(demandSupplyStateLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(decisionKindLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("组件真的在用映射，而不是还印着原文", () => {
    const src = readFileSync(fileURLToPath(new URL("./surfaces/business-home.tsx", import.meta.url)), "utf8");
    expect(src).toContain("decisionKindLabel(operatingHome?.bestNextDecision.kind)");
    expect(src).toContain("demandSupplyStateLabel(operatingHome?.demandSupply.state)");
    expect(src).not.toMatch(/\{operatingHome\?\.bestNextDecision\.kind \?\? "NO_ACTION"\}/);
  });
});

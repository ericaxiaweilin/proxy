import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { badgeProgress, badgeMissingIds, SCENE_BADGES } from "../scene-badges";

// BADGE-WALL-001: 个人徽章墙 + 场景进度。进度规则必须和 evaluateSceneBadges
// 同构 —— 改规则两边一起改，这里钉住配对。注释先剥掉再断言，只认代码。
describe("BADGE-WALL-001 badge progress mirrors the award rules", () => {
  it("counts set badges and thresholds against check-in history", () => {
    // coffee_hunter 要 [threebeans, threebeans_bn] 全集。
    expect(badgeProgress("coffee_hunter", ["threebeans"])).toEqual({ total: 2, done: 1 });
    expect(badgeProgress("coffee_hunter", ["threebeans", "threebeans_bn"])).toEqual({ total: 2, done: 2 });
    expect(badgeProgress("checkin_3", ["a", "b"])).toEqual({ total: 3, done: 2 });
    expect(badgeProgress("checkin_3", ["a", "b", "c", "d"])).toEqual({ total: 3, done: 3 });
  });

  it("has no progress concept for hasAny and footprint badges", () => {
    // landmark / 小美同框是 hasAny（中一个就算），footprint_10 要的是足迹数
    // 不在打卡史里 —— 缺数据源就别算，别拿打卡史去套。
    expect(badgeProgress("landmark", [])).toBeUndefined();
    expect(badgeProgress("xiaomei_company", ["threebeans"])).toBeUndefined();
    expect(badgeProgress("footprint_10", ["a", "b"])).toBeUndefined();
    expect(badgeProgress("no-such-badge", ["a"])).toBeUndefined();
  });

  it("names only the missing scenes the catalog knows", () => {
    const known = new Set(["threebeans", "threebeans_bn"]);
    expect(badgeMissingIds("coffee_hunter", ["threebeans"], known)).toEqual(["threebeans_bn"]);
    expect(badgeMissingIds("coffee_hunter", ["threebeans"], new Set())).toEqual([]);
    // 叫不上名字的店不点名，只计个数 —— threebeans 认识就点它，threebeans_bn 不认识就不提。
    expect(badgeMissingIds("coffee_hunter", [], new Set(["threebeans"]))).toEqual(["threebeans"]);
  });

  it("keeps every catalog badge addressable", () => {
    expect(SCENE_BADGES.length).toBeGreaterThan(0);
    for (const badge of SCENE_BADGES) {
      expect(badge.id.length).toBeGreaterThan(0);
    }
  });
});

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const meCode = stripComments(readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8"));
const mapCode = stripComments(readFileSync(fileURLToPath(new URL("./reality-scene-map.tsx", import.meta.url)), "utf8"));

describe("BADGE-WALL-001 wall and progress are wired, not decorated", () => {
  it("loads earned badges and history on the personal wall with retry", () => {
    expect(meCode).toContain("listMyBadges()");
    expect(meCode).toContain("listMyCheckinHistory()");
    expect(meCode).toContain("badgeWallNonce");
    expect(meCode).toContain("badgeGrid");
  });

  it("shows progress per scene on the scene homepage from history", () => {
    expect(mapCode).toContain("badgeHistoryIds");
    expect(mapCode).toContain("sceneBadgeRows");
    expect(mapCode).toContain("badgeMissingIds(");
  });
});

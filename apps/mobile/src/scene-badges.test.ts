import { describe, expect, it } from "vitest";
import {
  SCENE_BADGES,
  evaluateSceneBadges,
  newlyEarnedBadges,
  sceneBadgeById,
} from "./scene-badges";

describe("SCENE-BADGE-001 scene badge rules", () => {
  it("catalog has unique ids and the ten promised badges", () => {
    const ids = SCENE_BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "first_checkin",
      "checkin_3",
      "checkin_5",
      "checkin_10",
      "lake_trio",
      "coffee_hunter",
      "oldtown_walk",
      "landmark",
      "xiaomei_company",
      "footprint_10",
    ]);
  });

  it("no check-in earns nothing", () => {
    expect(evaluateSceneBadges({ checkedInSceneIds: [], visitedSceneIds: [] })).toEqual([]);
  });

  it("first check-in anywhere earns 初到打卡", () => {
    const earned = evaluateSceneBadges({ checkedInSceneIds: ["hoankiem"], visitedSceneIds: [] });
    expect(earned).toContain("first_checkin");
  });

  it("three distinct check-ins earn 打卡新秀, five earn 常客", () => {
    const three = evaluateSceneBadges({ checkedInSceneIds: ["a", "b", "c"], visitedSceneIds: [] });
    expect(three).toContain("checkin_3");
    expect(three).not.toContain("checkin_5");
    const five = evaluateSceneBadges({ checkedInSceneIds: ["a", "b", "c", "d", "e"], visitedSceneIds: [] });
    expect(five).toContain("checkin_5");
  });

  it("lake trio requires all three lakes checked in", () => {
    const two = evaluateSceneBadges({ checkedInSceneIds: ["hoankiem", "trucbach"], visitedSceneIds: [] });
    expect(two).not.toContain("lake_trio");
    const all = evaluateSceneBadges({ checkedInSceneIds: ["hoankiem", "trucbach", "tranquoc"], visitedSceneIds: [] });
    expect(all).toContain("lake_trio");
  });

  it("coffee hunter requires both Three Beans stores", () => {
    const one = evaluateSceneBadges({ checkedInSceneIds: ["threebeans"], visitedSceneIds: [] });
    expect(one).not.toContain("coffee_hunter");
    const both = evaluateSceneBadges({ checkedInSceneIds: ["threebeans", "threebeans_bn"], visitedSceneIds: [] });
    expect(both).toContain("coffee_hunter");
  });

  it("landmark badge earns from any one landmark check-in", () => {
    const earned = evaluateSceneBadges({ checkedInSceneIds: ["longbien"], visitedSceneIds: [] });
    expect(earned).toContain("landmark");
  });

  it("xiaomei company badge earns when checking in at a persona-bound scene", () => {
    const earned = evaluateSceneBadges({ checkedInSceneIds: ["trucbach"], visitedSceneIds: [] });
    expect(earned).toContain("xiaomei_company");
    const unbound = evaluateSceneBadges({ checkedInSceneIds: ["nguyenphilan"], visitedSceneIds: [] });
    expect(unbound).not.toContain("xiaomei_company");
  });

  it("footprints alone do not count as check-ins, but ten footprints earn the map badge", () => {
    const foot = Array.from({ length: 10 }, (_, i) => `scene_${i}`);
    const earned = evaluateSceneBadges({ checkedInSceneIds: [], visitedSceneIds: foot });
    expect(earned).toEqual(["footprint_10"]);
  });

  it("duplicate check-in ids never inflate counts", () => {
    const earned = evaluateSceneBadges({ checkedInSceneIds: ["hoankiem", "hoankiem", "hoankiem"], visitedSceneIds: [] });
    expect(earned).toEqual(["first_checkin", "landmark"]);
  });

  it("newlyEarnedBadges only returns the delta, in catalog order", () => {
    const should = ["first_checkin", "checkin_3", "lake_trio"];
    expect(newlyEarnedBadges(should, ["checkin_3"])).toEqual(["first_checkin", "lake_trio"]);
    expect(newlyEarnedBadges(should, should)).toEqual([]);
  });

  it("sceneBadgeById resolves and unknown id is undefined", () => {
    expect(sceneBadgeById("lake_trio")?.name).toBe("湖畔三连");
    expect(sceneBadgeById("nope")).toBeUndefined();
  });
});

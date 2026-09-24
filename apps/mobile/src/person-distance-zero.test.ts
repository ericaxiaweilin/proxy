// PERSON-DISTANCE-ZERO-001
//
// 服务端真人（首页搜索全站用户）转成本地人物卡时，以前一律填 `distanceM: 0`。
// 服务端没有这个人的坐标，0 不是"很近"，是"没有数据" —— 但它会在详情页渲染成
// 「0 m」（等于断言对方就在你脚下），并让每个人无条件通过「附近 <1000m」筛选。
//
// 没有坐标就必须留空，展示侧说「距离未知」，筛选侧把它排除在「附近」之外。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("./native-clients", () => ({ localApiBaseUrl: "http://127.0.0.1:1" }));

import { SCENE_RECOMMEND } from "./recommend-fixtures";

const home = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

describe("PERSON-DISTANCE-ZERO-001 no invented proximity for real people", () => {
  it("does not stamp a distance onto server people", () => {
    // 反向钉：profileWireToPerson 里不许再出现任何 distanceM 赋值。
    const fn = home.slice(home.indexOf("function profileWireToPerson"), home.indexOf("async function runServerPeopleSearch"));
    expect(fn).not.toMatch(/distanceM\s*:/);
  });

  it("excludes people with no distance from the nearby filter", () => {
    // 距离未知的人不能算「附近」—— 恒 0 的时候每个人都会通过。
    // HOME-MORE-DIST-001（2026-09-22）：半径从写死 1km 改成用户可选
    // （1~100km，默认 10km，见 MORE_DISTANCE_KM）。改的是半径，不是这条规则：
    // 任何半径都必须把 distanceM === undefined 排除在外 —— 距离未知 ≠ 很近。
    expect(home).toContain("p.distanceM === undefined || p.distanceM >= moreDistanceKm * 1000");
  });

  it("renders an honest placeholder instead of a fake zero distance", () => {
    expect(home).toContain('humanScenePreview.person.distanceM === undefined ? t("distanceUnknown")');
  });

  it("keeps the distance on the demo recommendation list", () => {
    // 反向钉：改的是"服务端真人"，不是把 demo 列表的距离也删了。
    // fixture 里每个人都有坐标距离，这是 demo 内容本身，该显示还得显示。
    const people = Object.values(SCENE_RECOMMEND).flatMap((feed) => feed.people);
    expect(people.length).toBeGreaterThan(0);
    const withoutDistance = people.filter((p) => p.distanceM === undefined);
    expect(withoutDistance.map((p) => p.id)).toEqual([]);
  });
});

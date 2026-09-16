// RECOMMEND-REPUTATION-FABRICATED-001
//
// 推荐人列表是本地 fixture（没有服务端人物 feed），但详情页把它渲染成了
// 「历史信誉与评价」：星级、好评百分比、完成次数、一句引号里的"用户评价"、
// 以及一份带日期的历史活动记录。这些值曾经全部由 `(index + offset) % n`
// 算出来 —— 挂在真人姓名下的凭空信誉，还附了「非公开记录不展示」的隐私说明。
//
// fixture 本身（姓名 / 一句话描述 / 距离 / 标签）可以继续是 demo 内容；
// 但**评价类字段**声称的是"被测量过的历史"，没有真数据就必须为空。

import { describe, expect, it, vi } from "vitest";

// recommend-fixtures 经 native-clients 间接拉进 react-native，vitest 在这个
// 仓库里没有 RN 渲染环境、直接 import 会解析失败。只需要替掉那一个常量，
// 就能在**真实数据**上跑断言（而不是像别的契约测试那样只能读源码文本）。
vi.mock("./native-clients", () => ({ localApiBaseUrl: "http://127.0.0.1:1" }));

import { SCENE_RECOMMEND, type RecommendPerson } from "./recommend-fixtures";

function allPeople(): RecommendPerson[] {
  return Object.values(SCENE_RECOMMEND).flatMap((feed) => feed.people);
}

describe("RECOMMEND-REPUTATION-FABRICATED-001 recommendation reputation is never invented", () => {
  it("carries no star rating for any recommended person", () => {
    const rated = allPeople().filter((p) => p.rating !== undefined);
    expect(rated.map((p) => p.id)).toEqual([]);
  });

  it("carries no positive-rate percentage for any recommended person", () => {
    const rated = allPeople().filter((p) => p.positiveRate !== undefined);
    expect(rated.map((p) => p.id)).toEqual([]);
  });

  it("carries no completed-activity count for any recommended person", () => {
    const counted = allPeople().filter((p) => p.completedActivities !== undefined);
    expect(counted.map((p) => p.id)).toEqual([]);
  });

  it("carries no review summary prose for any recommended person", () => {
    const reviewed = allPeople().filter((p) => p.reviewSummary !== undefined);
    expect(reviewed.map((p) => p.id)).toEqual([]);
  });

  it("carries no availability claim for any recommended person", () => {
    // 「今天 18:00 后可用」是关于真人的实时断言，不是 fixture 该编的东西。
    const claimed = allPeople().filter((p) => p.availabilityText !== undefined);
    expect(claimed.map((p) => p.id)).toEqual([]);
  });

  it("carries no public activity history rows for any recommended person", () => {
    const withHistory = allPeople().filter((p) => (p.publicActivityHistory ?? []).length > 0);
    expect(withHistory.map((p) => p.id)).toEqual([]);
  });

  it("still describes the person themselves (the fixture was not gutted)", () => {
    // 反向钉：清掉的是"被测量过的历史"，不是这个 demo 列表本身。
    // 名字 / 一句话描述 / 距离 / 标签必须还在，否则整页会空掉。
    const people = allPeople();
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.name).toBeTruthy();
      expect(person.bio).toBeTruthy();
      expect(person.initials).toBeTruthy();
      expect(typeof person.distanceM).toBe("number");
      expect(Array.isArray(person.tags)).toBe(true);
    }
  });

  it("keeps the reputation fields on the type so the server feed can fill them", () => {
    // 反向钉：不能为了"现在没有"就把读模型删了 —— 服务端人物 feed 落地后
    // 要能直接填这些字段，UI 的回落分支才不是死代码。
    const source = allPeople();
    expect(source).toBeDefined();
    const optionalShape: Partial<RecommendPerson> = {
      rating: 4.5,
      positiveRate: 90,
      completedActivities: 3,
      reviewSummary: "真实评价",
      availabilityText: "真实可用时间",
      publicActivityHistory: [{ id: "real", title: "t", scene: "s", dateLabel: "d", rating: 5 }],
    };
    expect(Object.keys(optionalShape).sort()).toEqual([
      "availabilityText",
      "completedActivities",
      "positiveRate",
      "publicActivityHistory",
      "rating",
      "reviewSummary",
    ]);
  });
});

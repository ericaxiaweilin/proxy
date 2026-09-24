import { describe, expect, it } from "vitest";
import { ACTION_SCENE_KEYWORDS, PRIMARY_ACTION_IDS, sceneCategoryEntries, type SceneCategoryAction, type SceneCategoryBrief } from "./scene-category-entries";

// SCENE-HOME-ENTRY-001：首页入口卡上那些数字是**用户会当成事实读的**（「23 家」
// 「12 人去过」），所以这块不能只靠 grep 文本钉守着 —— 下面全是真行为断言。
// 对应组件里 scene-activity-discovery.test.ts 只留 UI 接线钉。

const ACTIONS: readonly SceneCategoryAction[] = [
  { id: "coffee", label: "咖啡" },
  { id: "dining", label: "用餐" },
  { id: "city-walk", label: "City Walk" },
  { id: "photo", label: "拍照" },
  { id: "cycling", label: "骑行" },
  { id: "exhibition", label: "看展" },
];

function scene(overrides: Partial<SceneCategoryBrief> & { name: string }): SceneCategoryBrief {
  return { area: "", type: "", imageUrl: "", category: "", visitedCount: 0, ...overrides };
}

describe("sceneCategoryEntries: 首页场景入口卡的计数只有真实来源", () => {
  it("只给真的有场景的动作出卡，顺序跟调用方的动作目录一致", () => {
    const entries = sceneCategoryEntries([
      scene({ name: "Cà phê Bệt", type: "咖啡 · 户外", category: "商家" }),
      scene({ name: "老城区漫步", type: "City Walk", category: "景点" }),
    ], ACTIONS);
    expect(entries.map((entry) => entry.actionId)).toEqual(["coffee", "city-walk"]);
    expect(entries.map((entry) => entry.label)).toEqual(["咖啡", "City Walk"]);
  });

  it("场景目录为空时一张卡都不出 —— 不显示「0 家」，也不拿本地 fixture 顶", () => {
    expect(sceneCategoryEntries([], ACTIONS)).toEqual([]);
  });

  it("动作没有归属词时不匹配任何场景（不做兜底全匹配）", () => {
    const entries = sceneCategoryEntries(
      [scene({ name: "随便一个地方", type: "咖啡" })],
      [{ id: "no-such-action", label: "不存在" }],
    );
    expect(entries).toEqual([]);
  });

  it("计数单位看命中的顶类：过半是商家用「家」，否则用「个」", () => {
    const twoShops = sceneCategoryEntries([
      scene({ name: "A 咖啡", category: "商家" }),
      scene({ name: "B 咖啡", category: "商家" }),
      scene({ name: "C 咖啡", category: "景点" }),
    ], ACTIONS);
    expect(twoShops[0]!.unit).toBe("家");

    const twoSpots = sceneCategoryEntries([
      scene({ name: "A 咖啡", category: "商家" }),
      scene({ name: "B 咖啡", category: "景点" }),
      scene({ name: "C 咖啡", category: "景点" }),
    ], ACTIONS);
    expect(twoSpots[0]!.unit).toBe("个");

    // 一半一半（1 家 1 个）算「家」—— merchantCount * 2 >= count 的边界。
    const half = sceneCategoryEntries([
      scene({ name: "A 咖啡", category: "商家" }),
      scene({ name: "B 咖啡", category: "景点" }),
    ], ACTIONS);
    expect(half[0]!.unit).toBe("家");
  });

  it("visitedCount 只累加真实有限数，缺失/NaN 当 0，不把总数算成 NaN", () => {
    const entries = sceneCategoryEntries([
      scene({ name: "A 咖啡", visitedCount: 12 }),
      scene({ name: "B 咖啡", visitedCount: Number.NaN }),
      scene({ name: "C 咖啡", visitedCount: 3 }),
    ], ACTIONS);
    expect(entries[0]!.count).toBe(3);
    expect(entries[0]!.visitedTotal).toBe(15);
  });

  it("区域去重、丢掉空值、最多留 2 个", () => {
    const entries = sceneCategoryEntries([
      scene({ name: "A 咖啡", area: "Hoàn Kiếm" }),
      scene({ name: "B 咖啡", area: "Hoàn Kiếm" }),
      scene({ name: "C 咖啡", area: "Ba Đình" }),
      scene({ name: "D 咖啡", area: "Cầu Giấy" }),
      scene({ name: "E 咖啡", area: "" }),
    ], ACTIONS);
    expect(entries[0]!.areas).toEqual(["Hoàn Kiếm", "Ba Đình"]);
  });

  it("配图取「第一条真的有图」的命中场景，不是盲取第一条", () => {
    const entries = sceneCategoryEntries([
      scene({ name: "A 咖啡", imageUrl: "" }),
      scene({ name: "B 咖啡", imageUrl: "/v1/media/thumb/real.jpg" }),
    ], ACTIONS);
    expect(entries[0]!.imageUrl).toBe("/v1/media/thumb/real.jpg");

    const noPhoto = sceneCategoryEntries([scene({ name: "A 咖啡", imageUrl: "" })], ACTIONS);
    expect(noPhoto[0]!.imageUrl).toBe("");
  });

  it("归属词大小写不敏感，且三个字段（name / area / type）都参与匹配", () => {
    const byType = sceneCategoryEntries([scene({ name: "X", type: "SPECIALTY COFFEE" })], ACTIONS);
    expect(byType.map((entry) => entry.actionId)).toEqual(["coffee"]);
    const byArea = sceneCategoryEntries([scene({ name: "X", area: "Old Quarter" })], ACTIONS);
    expect(byArea.map((entry) => entry.actionId)).toEqual(["city-walk"]);
    const byName = sceneCategoryEntries([scene({ name: "西湖岸边" })], ACTIONS);
    expect(byName.map((entry) => entry.actionId)).toEqual(["city-walk"]);
  });

  it("只算自己那一类的场景，别的类的数字不会串到这张卡上", () => {
    const entries = sceneCategoryEntries([
      scene({ name: "A 咖啡", category: "商家", visitedCount: 5 }),
      scene({ name: "老城路线", type: "City Walk", category: "景点", visitedCount: 100 }),
    ], ACTIONS);
    const coffee = entries.find((entry) => entry.actionId === "coffee")!;
    const walk = entries.find((entry) => entry.actionId === "city-walk")!;
    expect(coffee.count).toBe(1);
    expect(coffee.visitedTotal).toBe(5);
    expect(walk.count).toBe(1);
    expect(walk.visitedTotal).toBe(100);
  });

  it("6 个主动作就是原型首页那一行，且每个都有归属词（否则那一行会有点不动的按钮）", () => {
    expect([...PRIMARY_ACTION_IDS]).toEqual(["coffee", "dining", "city-walk", "photo", "cycling", "exhibition"]);
    for (const id of PRIMARY_ACTION_IDS) {
      expect(ACTION_SCENE_KEYWORDS[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

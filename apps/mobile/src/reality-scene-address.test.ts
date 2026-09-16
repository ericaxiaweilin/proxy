// SCENE-ADDRESS-001 tripwires：场景的地址行。
//
// 用户问「Three Beans 这家店的地址有没有？在 maps 上显示了吗？」
// 答：以前**没有**。reality.scenes 只有 area（"Cầu Giấy" 这种区名）+ lat/lng，
// 地图 marker 的 description 拼的是 `区 · 类型` —— 用户问"在哪条街"答不上来。
// 现在服务端多给一个 address；这里钉住它的回退行为。
import { describe, expect, it } from "vitest";
import { hasSceneAddress, isVerifiedScene, sceneAddressLine, sceneCountsLine, sceneHeatScore, sceneSignalLine, sceneSourceLabel, sceneSourceSuffix } from "./reality-scene-address";

describe("SCENE-ADDRESS-001 sceneAddressLine", () => {
  it("有街道地址就显示地址（Bắc Ninh 那家 Three Beans）", () => {
    expect(sceneAddressLine({
      address: "Lê Văn Thịnh, Suối Hoa, TP Bắc Ninh",
      area: "Bắc Ninh",
      type: "咖啡 · 动态场景"
    })).toBe("Lê Văn Thịnh, Suối Hoa, TP Bắc Ninh");
  });

  it("有街道地址就显示地址（Cầu Giấy 那家 Three Beans）", () => {
    expect(sceneAddressLine({
      address: "Đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội",
      area: "Cầu Giấy",
      type: "咖啡 · 动态场景"
    })).toBe("Đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội");
  });

  it("没有地址时退回「区 · 类型」—— 不许返回空串", () => {
    expect(sceneAddressLine({ area: "Ba Đình", type: "湖边 · 夜景" })).toBe("Ba Đình · 湖边 · 夜景");
  });

  it("空串 / 纯空格都算「没有地址」，一样走回退", () => {
    expect(sceneAddressLine({ address: "", area: "Tây Hồ", type: "骑行 · 日落" })).toBe("Tây Hồ · 骑行 · 日落");
    expect(sceneAddressLine({ address: "   ", area: "Tây Hồ", type: "骑行 · 日落" })).toBe("Tây Hồ · 骑行 · 日落");
  });

  it("地址前后空格要 trim，不是照原样显示", () => {
    expect(sceneAddressLine({ address: "  Lê Văn Thịnh, Suối Hoa  ", area: "Bắc Ninh", type: "咖啡" })).toBe("Lê Văn Thịnh, Suối Hoa");
  });

  it("回退结果**带上 type** —— 「没地址」和「地址就是区名」必须长得不一样", () => {
    const fallback = sceneAddressLine({ area: "Bắc Ninh", type: "咖啡 · 动态场景" });
    expect(fallback).not.toBe("Bắc Ninh");
    expect(fallback).toContain("咖啡 · 动态场景");
  });
});

describe("SCENE-ADDRESS-001 hasSceneAddress", () => {
  it("有内容才算有地址", () => {
    expect(hasSceneAddress({ address: "Lê Văn Thịnh, Suối Hoa" })).toBe(true);
  });

  it("undefined / 空串 / 纯空格都算没地址", () => {
    expect(hasSceneAddress({})).toBe(false);
    expect(hasSceneAddress({ address: "" })).toBe(false);
    expect(hasSceneAddress({ address: "   " })).toBe(false);
  });
});

// SCENE-REAL-COUNTS-001: 场景上的数字必须是真的。
//
// 服务端按 reality.user_scene_states 聚合出 saved/visited/planned 三个真数。
// 以前卡片上那些 posts 312 / creators 118 是写死的常数，全仓根本没有
// post↔scene 的关联 —— 那不是数据，是编的。
describe("SCENE-REAL-COUNTS-001 sceneCountsLine", () => {
  it("有数就照实显示", () => {
    expect(sceneCountsLine({ visitedCount: 12, savedCount: 5, plannedCount: 3 })).toBe("12 人去过 · 5 人收藏 · 3 人计划去");
  });

  it("只有其中一项就只显示那一项", () => {
    expect(sceneCountsLine({ visitedCount: 7 })).toBe("7 人去过");
    expect(sceneCountsLine({ savedCount: 2 })).toBe("2 人收藏");
  });

  // SCENE-CHECKIN-001: 「在这里」是唯一会自己变化的数，排在最前。
  it("有人在这里时先说「人说在这里」—— 是声明，不是定位证据", () => {
    expect(sceneCountsLine({ hereCount: 3, visitedCount: 9 })).toBe("3 人说在这里 · 9 人去过");
    expect(sceneCountsLine({ hereCount: 1 })).toBe("1 人说在这里");
    // 不许写成"现场有 N 人" —— 那是核实过的口吻，我们没有核销。
    expect(sceneCountsLine({ hereCount: 3 })).not.toContain("现场有");
    expect(sceneCountsLine({ hereCount: 3 })).not.toContain("已核实");
  });

  it("一个都没有时不显示 0 —— 空态不许和零态长得一样", () => {
    expect(sceneCountsLine({})).toBe("还没有人收藏或去过 · 你可以是第一个");
    expect(sceneCountsLine({ savedCount: 0, visitedCount: 0, plannedCount: 0 })).toBe("还没有人收藏或去过 · 你可以是第一个");
    // 关键：不许出现 "0 人"
    expect(sceneCountsLine({})).not.toContain("0 人");
  });

  it("负数 / 小数不可能来自 COUNT，收到就当 0 处理", () => {
    expect(sceneCountsLine({ visitedCount: -3 })).toBe("还没有人收藏或去过 · 你可以是第一个");
    expect(sceneCountsLine({ visitedCount: 4.9 })).toBe("4 人去过");
  });
});

// SCENE-CONTRIB-001: 用户提交的场景必须跟查过的场景**长得不一样**。
describe("SCENE-CONTRIB-001 sceneSourceLabel", () => {
  it("社区提交的要标出来 —— 它的坐标是别人随手点的", () => {
    expect(sceneSourceLabel("COMMUNITY")).toBe("社区提交 · 坐标未经核实");
  });

  it("OSM 查过的不加角标，否则满屏噪音", () => {
    expect(sceneSourceLabel("OSM")).toBe("");
    expect(isVerifiedScene("OSM")).toBe(true);
  });

  // 关键：老数据没有 source 字段。返回空串会让"来源不明"看起来像"已核实"。
  it("没有 source 时说「来源未知」，不许静默当成已核实", () => {
    expect(sceneSourceLabel(undefined)).toBe("坐标来源未知");
    expect(sceneSourceLabel("")).toBe("坐标来源未知");
    expect(sceneSourceLabel("SOMETHING_ELSE")).toBe("坐标来源未知");
    expect(isVerifiedScene(undefined)).toBe(false);
    expect(isVerifiedScene("COMMUNITY")).toBe(false);
  });

  it("sceneSourceSuffix 只在需要时加角标", () => {
    expect(sceneSourceSuffix("OSM")).toBe("");
    expect(sceneSourceSuffix("COMMUNITY")).toBe(" · 社区提交 · 坐标未经核实");
    expect(sceneSourceSuffix(undefined)).toBe(" · 坐标来源未知");
  });
});

// SCENE-NO-FABRICATED-001: 列表行上那句"信号"不许再是编出来的。
//
// 以前是 `scene.active ? "正在发生" : … : Scene Quality 93`：
// "正在发生" 来自 seed 里一个静态布尔值，跟此刻现场有没有人毫无关系；
// "Scene Quality 93" 是迁移里手写死的整数，没有任何评分来源。
describe("SCENE-NO-FABRICATED-001 sceneSignalLine", () => {
  const forbidden = ["正在发生", "Scene Quality", "热门", "高密度", "人气"];

  it("用户自己的标记优先 —— 这是我们知道的事", () => {
    expect(sceneSignalLine({ visited: true })).toBe("你标记过去过");
    expect(sceneSignalLine({ saved: true })).toBe("你收藏了这里");
    expect(sceneSignalLine({ planned: true })).toBe("你计划去这里");
  });

  it("没有本人标记时用真实聚合计数", () => {
    expect(sceneSignalLine({ visitedCount: 3, savedCount: 1 })).toBe("3 人去过 · 1 人收藏");
  });

  it("谁都没动过就说谁都没动过，不编一个热度词", () => {
    const line = sceneSignalLine({});
    expect(line).toBe("还没有人收藏或去过 · 你可以是第一个");
    for (const word of forbidden) expect(line).not.toContain(word);
  });

  // 反向钉：无论输入是什么，都不许吐出那几个假信号词。
  it("任何输入都不许出现「正在发生 / Scene Quality / 热门」", () => {
    const cases = [
      {},
      { active: true },
      { visited: false, saved: false, planned: false, visitedCount: 0, savedCount: 0, plannedCount: 0 },
      { visitedCount: 99, savedCount: 99, plannedCount: 99 },
    ] as Parameters<typeof sceneSignalLine>[];
    for (const c of cases) {
      const line = sceneSignalLine(c as never);
      for (const word of forbidden) expect(line).not.toContain(word);
    }
  });
});

describe("sceneHeatScore", () => {
  it("weighs live presence highest and ignores garbage", () => {
    expect(sceneHeatScore({})).toBe(0);
    expect(sceneHeatScore({ savedCount: 5, visitedCount: 12, plannedCount: 3 })).toBe(20);
    expect(sceneHeatScore({ hereCount: 3 })).toBe(9);
    expect(sceneHeatScore({ hereCount: -2, visitedCount: NaN })).toBe(0);
  });
});

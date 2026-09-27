import { describe, expect, it } from "vitest";
import {
  BADMINTON_ALL_CITIES,
  BADMINTON_CITY_GROUPS,
  BADMINTON_DEFAULT_CITIES,
  BADMINTON_FILTERS,
  BADMINTON_HOT_CITIES,
  BADMINTON_INITIAL_FAVORITES,
  BADMINTON_LOCATED_CITY,
  BADMINTON_RECENT_CITIES,
  BADMINTON_RIDERS,
  badmintonCityExists,
  badmintonCityFooterLabel,
  badmintonCityMatches,
  badmintonHighlightSegments,
  badmintonLevelLabel,
  badmintonLocationLabel,
  badmintonRiderCountLabel,
  badmintonRiderTags,
  badmintonRiders,
  badmintonSearchTokens,
  badmintonStatusLabel,
  formatHours,
  formatVnd
} from "./badminton-companion";

// SPORT-BADMINTON-001 的**真行为**测试：调函数、看返回值。
// 界面接线（卡片在不在、点了开不开）在 surfaces/badminton-companion.test.ts 里钉，
// 因为那是源码级的东西，放这里会变成两种性质的断言混一个文件。
const ids = (riders: readonly { id: string }[]): string[] => riders.map((r) => r.id);
const query = (over: Partial<{ cities: readonly string[]; keyword: string; filter: "recommended" | "nearest" | "chinese" | "advanced" }>) => ({
  cities: [] as readonly string[],
  keyword: "",
  filter: "recommended" as const,
  ...over
});

describe("SPORT-BADMINTON-001 城市表自洽", () => {
  it("同一个城市不会出现在两个地区组里", () => {
    const seen = new Set<string>();
    for (const group of BADMINTON_CITY_GROUPS) {
      for (const city of group.cities) {
        expect(seen.has(city), `${city} 重复出现在地区分组里`).toBe(false);
        seen.add(city);
      }
    }
    expect(BADMINTON_ALL_CITIES.length).toBe(seen.size);
  });

  it("热门 / 最近 / 默认选中 / 定位 都是城市表里的真城市", () => {
    // 任意一条落空，界面上就会出现一个点了没反应的城市 chip。
    for (const city of [...BADMINTON_HOT_CITIES, ...BADMINTON_RECENT_CITIES, ...BADMINTON_DEFAULT_CITIES, BADMINTON_LOCATED_CITY]) {
      expect(badmintonCityExists(city), `${city} 不在城市表里`).toBe(true);
    }
  });

  it("每条陪打数据的城市都在城市表里，否则筛选永远够不到它", () => {
    for (const rider of BADMINTON_RIDERS) {
      expect(badmintonCityExists(rider.city), `${rider.id} 的城市 ${rider.city} 不在城市表里`).toBe(true);
    }
  });

  it("首屏收藏态指向真存在的记录", () => {
    for (const id of BADMINTON_INITIAL_FAVORITES) {
      expect(BADMINTON_RIDERS.some((r) => r.id === id), `收藏了不存在的 ${id}`).toBe(true);
    }
  });

  it("四个筛选 chip 一个不少", () => {
    expect(BADMINTON_FILTERS.map((f) => f.id)).toEqual(["recommended", "nearest", "chinese", "advanced"]);
    expect(BADMINTON_FILTERS.map((f) => f.label)).toEqual(["推荐", "最近", "会中文", "水平高"]);
  });
});

describe("SPORT-BADMINTON-001 列表判定", () => {
  it("默认两个城市 + 推荐序：评分降序，同分看单量", () => {
    // 北宁 / 北江 三条：Hana 5.0 排头，Linh 与 Anna 同为 4.9，Linh 128 单在前。
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ cities: BADMINTON_DEFAULT_CITIES })))).toEqual(["r2", "r1", "r4"]);
  });

  it("没选城市时是全部六条，不是空", () => {
    // 原型 getFiltered 的行为：selectedCities 为空就不过滤。
    // 如果这里变空，用户清空城市后会看到「没有找到匹配的陪打」—— 那是假的。
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ cities: [] })))).toHaveLength(6);
  });

  it("城市筛选真的筛，选海防就只剩海防那一条", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ cities: ["海防"] })))).toEqual(["r3"]);
  });

  it("关键词大小写不敏感，且能命中场馆名", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "racket" })))).toEqual(["r6", "r3"]);
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "BADMINTON" })))).toEqual(["r2"]);
  });

  it("关键词能命中城市", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "北宁" })))).toEqual(["r1", "r4"]);
  });

  it("「最近」按距当前定位升序，不是按评分", () => {
    const list = badmintonRiders(BADMINTON_RIDERS, query({ filter: "nearest" }));
    expect(ids(list)).toEqual(["r1", "r4", "r2", "r5", "r3", "r6"]);
    const distances = list.map((r) => r.distanceFromLocatedKm);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("「水平高」只留高级", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ filter: "advanced" })))).toEqual(["r2", "r4", "r6"]);
  });

  it("筛选和城市是叠加的，不是二选一", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ cities: BADMINTON_DEFAULT_CITIES, filter: "advanced" })))).toEqual(["r2", "r4"]);
  });

  it("搜索「会中文」和点「会中文」chip 拿到同一批人", () => {
    // 这条是防回归的核心：标签按语言组合取词，中英双语那两位上屏写的是「中英双语」。
    // 如果搜索只扫上屏文字，搜「会中文」就漏掉他们，而 chip 走 languages 判定不漏 ——
    // 同一个意图两个结果，用户会以为搜索坏了。
    const bySearch = ids(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "会中文" })));
    const byChip = ids(badmintonRiders(BADMINTON_RIDERS, query({ filter: "chinese" })));
    expect(bySearch).toEqual(byChip);
    expect(bySearch).toContain("r4"); // 中英双语那位必须在内
    expect(bySearch).toContain("r6");
  });

  it("搜索「中英双语」只留双语的两位", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "中英双语" })))).toEqual(["r4", "r6"]);
  });

  it("搜索「高级」和「水平高」chip 拿到同一批人", () => {
    expect(ids(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "高级" })))).toEqual(
      ids(badmintonRiders(BADMINTON_RIDERS, query({ filter: "advanced" })))
    );
  });

  it("搜不到就是空数组，不是「不过滤」", () => {
    // 关键词落空时返回全部，是搜索框最典型的静默撒谎。
    expect(badmintonRiders(BADMINTON_RIDERS, query({ keyword: "乒乓球" }))).toEqual([]);
  });

  it("排序是确定的：同分同单也每次一个顺序", () => {
    const once = ids(badmintonRiders(BADMINTON_RIDERS, query({})));
    const twice = ids(badmintonRiders(BADMINTON_RIDERS, query({})));
    expect(once).toEqual(twice);
    // 输入顺序不影响输出顺序（说明排序真的发生了，不是靠数据文件恰好有序）。
    const reversed = [...BADMINTON_RIDERS].reverse();
    expect(ids(badmintonRiders(reversed, query({})))).toEqual(once);
  });

  it("不改动传进来的数组", () => {
    const input = [...BADMINTON_RIDERS];
    badmintonRiders(input, query({ filter: "nearest" }));
    expect(ids(input)).toEqual(ids(BADMINTON_RIDERS));
  });
});

describe("SPORT-BADMINTON-001 取词与格式化", () => {
  it("状态只有两种形态，收藏数从 collected 现算", () => {
    const lin = BADMINTON_RIDERS.find((r) => r.id === "r1")!;
    const hana = BADMINTON_RIDERS.find((r) => r.id === "r2")!;
    expect(badmintonStatusLabel(lin)).toBe("今晚 19:00 有空");
    expect(badmintonStatusLabel(hana)).toBe("3 人收藏");
    // 把数字改了，文案跟着变 —— 说明没有第二份写死的串。
    expect(badmintonStatusLabel({ ...hana, collected: 9 })).toBe("9 人收藏");
  });

  it("标签从字段现算，不是另存的一份", () => {
    const anna = BADMINTON_RIDERS.find((r) => r.id === "r4")!;
    expect(badmintonRiderTags(anna)).toEqual(["中英双语", "高级", "2 小时"]);
    expect(badmintonRiderTags({ ...anna, level: "beginner", hours: 1.5 })).toEqual(["中英双语", "初级", "1.5 小时"]);
  });

  it("水平取词三级齐全", () => {
    expect(badmintonLevelLabel("beginner")).toBe("初级");
    expect(badmintonLevelLabel("intermediate")).toBe("中级");
    expect(badmintonLevelLabel("advanced")).toBe("高级");
  });

  it("小时数不带多余的 .0", () => {
    expect(formatHours(2)).toBe("2");
    expect(formatHours(1.5)).toBe("1.5");
  });

  it("价格按 vi-VN 的「.」分组", () => {
    expect(formatVnd(350000)).toBe("350.000");
    expect(formatVnd(1000000)).toBe("1.000.000");
    expect(formatVnd(1620)).toBe("1.620");
    expect(formatVnd(999)).toBe("999");
    expect(formatVnd(0)).toBe("0");
  });

  it("定位行三档取词", () => {
    expect(badmintonLocationLabel([])).toBe("选择城市");
    expect(badmintonLocationLabel(["北宁"])).toBe("北宁");
    expect(badmintonLocationLabel(["北宁", "北江"])).toBe("北宁 · 北江");
    expect(badmintonLocationLabel(["北宁", "北江", "海防"])).toBe("北宁 · 北江 +1");
  });

  it("城市页底部三档取词", () => {
    expect(badmintonCityFooterLabel([])).toBe("未选择城市");
    expect(badmintonCityFooterLabel(["北宁"])).toBe("已选 1 个城市 · 北宁");
    expect(badmintonCityFooterLabel(["北宁", "北江", "海防"])).toBe("已选 3 个城市 · 北宁、北江、海防");
    expect(badmintonCityFooterLabel(["北宁", "北江", "海防", "河内"])).toBe("已选 4 个城市 · 北宁、北江、海防 +1");
  });

  it("城市搜索：空关键词不返回全部城市", () => {
    // 空关键词返回 25 个城市当「搜索结果」，搜索框一聚焦就刷一屏，是假的。
    expect(badmintonCityMatches("")).toEqual([]);
    expect(badmintonCityMatches("   ")).toEqual([]);
    expect(badmintonCityMatches("北")).toEqual(["北宁", "北江"]);
    expect(badmintonCityMatches("胡志明")).toEqual(["胡志明市"]);
    expect(badmintonCityMatches("火星")).toEqual([]);
  });

  it("人数取词", () => {
    expect(badmintonRiderCountLabel(3)).toBe("3 位");
    expect(badmintonRiderCountLabel(0)).toBe("0 位");
  });

  it("高亮只切分不改写，且全部命中都标", () => {
    const joined = (text: string, kw: string): string => badmintonHighlightSegments(text, kw).map((s) => s.text).join("");
    expect(joined("Linh · 羽毛球陪打", "羽毛球")).toBe("Linh · 羽毛球陪打");
    expect(joined("Hana · 羽毛球陪打", "羽毛球")).toBe("Hana · 羽毛球陪打");

    const hits = badmintonHighlightSegments("badminton club · badminton", "badminton");
    expect(hits.filter((s) => s.hit)).toHaveLength(2);
    expect(joined("badminton club · badminton", "badminton")).toBe("badminton club · badminton");

    // 大小写不敏感，但高亮出来的仍是**原文**的大小写。
    const upper = badmintonHighlightSegments("Bắc Giang Badminton Club", "badminton");
    expect(upper.find((s) => s.hit)?.text).toBe("Badminton");

    // 没命中 → 一整段、不标；空关键词 → 一整段、不标。
    expect(badmintonHighlightSegments("Linh", "球")).toEqual([{ text: "Linh", hit: false }]);
    expect(badmintonHighlightSegments("Linh", "")).toEqual([{ text: "Linh", hit: false }]);
  });

  it("搜索字段集把「会说中文」当成一个 token，跟标签怎么写无关", () => {
    const anna = BADMINTON_RIDERS.find((r) => r.id === "r4")!; // 中英双语
    const tokens = badmintonSearchTokens(anna);
    expect(tokens).toContain("中英双语");
    expect(tokens).toContain("会中文");
    expect(tokens).toContain("英文");
  });
});

describe("SPORT-BADMINTON-001 演示数据的诚实边界", () => {
  it("没有任何一条陪打数据自称通过了 KYC", () => {
    // 本仓库的 KYC 是有真实状态的（provider-application-client.ts），
    // 而且真的当接单闸用（ORDER-APPLY-KYC-GATE-001）。
    // 给编出来的人写「已通过 KYC 认证」，就是把没做过的核验写成已完成态。
    for (const rider of BADMINTON_RIDERS) {
      expect(Object.keys(rider), `${rider.id} 带了 kyc 字段`).not.toContain("kyc");
      for (const value of Object.values(rider)) {
        if (typeof value === "string") expect(value).not.toContain("KYC");
      }
    }
  });

  it("演示数据里没有收藏态 —— 收藏是用户状态，不是数据属性", () => {
    for (const rider of BADMINTON_RIDERS) {
      expect(Object.keys(rider), `${rider.id} 带了 favorite 字段`).not.toContain("favorite");
      expect(Object.keys(rider), `${rider.id} 自己存了一份 tags`).not.toContain("tags");
    }
  });
});

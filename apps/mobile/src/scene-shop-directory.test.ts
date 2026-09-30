import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sceneCategoryEntries } from "./scene-category-entries";
import {
  SHOP_SORTS, WALK_METERS_PER_MINUTE, availableShopSorts, filterShopsByAreas, formatShopDistance,
  recommendationScore, sceneDistanceMeters, shopAreaFacets, shopCardChips, shopCardSignal, shopCategoryBadge, shopCountText,
  shopDetailTags, shopDirectoryRows, shopDistanceBar, shopHereLine, shopInfoCells, shopListEndText,
  shopListLocationLine, shopRating, shopRatingCell, shopRatingChip, shopVisitedChip, sortShops, walkMinutes,
  isFarAway, scenePhotoWallTiles, sceneAssetWallTiles, sceneMerchantWallTiles, sceneActionStateText, sceneActionSubtitle, shopAddressLine, shopCardDistance, shopHeroDistanceSuffix,
  type SceneShopBrief,
} from "./scene-shop-directory";

// SCENE-SHOP-DIRECTORY-001（2026-09-24，原型 deepseek_html_20260924_412dba
// 「Scene · 精修版」第 2/3 屏：咖啡列表 / 单店详情）。
//
// 这一屏的每个数字用户都看得见，所以全部走行为断言，不靠 grep 文本钉。
// 唯一一条文本钉是反向的：钉住「原型里那些没有数据源的字段**没有**被搬过来」。

function shop(over: Partial<SceneShopBrief> & { id: string }): SceneShopBrief {
  return {
    name: over.id,
    area: "Cầu Giấy",
    type: "咖啡 · 动态场景",
    imageUrl: "",
    category: "商家",
    visitedCount: 0,
    latitude: 21.0359,
    longitude: 105.7906,
    ...over,
  };
}

// 形状照抄 /v1/reality-scenes 的真实返回（三家咖啡 + 一个湖 + 一条壁画街）。
const CAFE_CAUGIAY = shop({ id: "threebeans", name: "Three Beans · Cầu Giấy", savedCount: 1, visitedCount: 1 });
const CAFE_BACNINH = shop({ id: "threebeans_bn", name: "Three Beans · Bắc Ninh", area: "Bắc Ninh", latitude: 21.1824, longitude: 106.0706, savedCount: 1, visitedCount: 1, hereCount: 2 });
const LAKE = shop({ id: "hoankiem", name: "Hồ Hoàn Kiếm", area: "Hoàn Kiếm", type: "公共景点 · 湖边", category: "景点", latitude: 21.0288, longitude: 105.8525, visitedCount: 4 });
const MURAL = shop({ id: "phunghung", name: "Phùng Hưng Mural Street", area: "Hoàn Kiếm", type: "公共景点 · 街区", category: "景点", latitude: 21.036, longitude: 105.846, visitedCount: 2 });
const CATALOG = [CAFE_CAUGIAY, CAFE_BACNINH, LAKE, MURAL] as const;

const HANOI_CENTER = { latitude: 21.0288, longitude: 105.8525 };

describe("SCENE-SHOP-DIRECTORY-001: the list page shows exactly the shops its entry card counted", () => {
  it("returns the action's own scenes and nothing else", () => {
    const rows = shopDirectoryRows(CATALOG, "coffee");
    expect(rows.map((row) => row.id).sort()).toEqual(["threebeans", "threebeans_bn"]);
    // 湖边/街区是别的分类的，不能混进咖啡列表。
    expect(rows.map((row) => row.id)).not.toContain("hoankiem");
  });

  it("agrees with the home entry card's count — one matcher, not two", () => {
    // 这条是整块改动的核心不变量：卡片写「2 家」而点进去 3 家，是没人能解释的差。
    const entry = sceneCategoryEntries(CATALOG, [{ id: "coffee", label: "咖啡" }])[0];
    expect(entry).toBeDefined();
    expect(shopDirectoryRows(CATALOG, "coffee")).toHaveLength(entry!.count);
  });

  it("an unknown action id yields an empty list, not the whole catalog", () => {
    expect(shopDirectoryRows(CATALOG, "no-such-action")).toHaveLength(0);
  });
});

describe("SCENE-SHOP-DIRECTORY-001: distance and walk time are derived, never invented", () => {
  it("computes a real great-circle distance and refuses to guess without a fix", () => {
    const meters = sceneDistanceMeters(HANOI_CENTER, CAFE_CAUGIAY);
    expect(meters).toBeDefined();
    // 实际约 6.4km；给一个宽但真实的区间，避免把公式改成"常数"还能过。
    expect(meters!).toBeGreaterThan(5_000);
    expect(meters!).toBeLessThan(8_000);
    // 同一点 = 0。
    expect(sceneDistanceMeters(HANOI_CENTER, HANOI_CENTER)).toBe(0);
    // 没有定位 → undefined，不是 0（0 会渲染成「0m」，看着像就在脚下）。
    expect(sceneDistanceMeters(undefined, CAFE_CAUGIAY)).toBeUndefined();
    // 脏坐标 → undefined，不编一个距离。
    expect(sceneDistanceMeters(HANOI_CENTER, { latitude: Number.NaN, longitude: 105 })).toBeUndefined();
  });

  it("formats like the prototype and stays blank when there is no distance", () => {
    expect(formatShopDistance(800)).toBe("800m");
    expect(formatShopDistance(1234)).toBe("1.2km");
    expect(formatShopDistance(0)).toBe("0m");
    expect(formatShopDistance(undefined)).toBe("");
    expect(formatShopDistance(-5)).toBe("");
    expect(formatShopDistance(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("turns distance into a walk time at the prototype's 80 m/min, floored at 1 minute", () => {
    expect(WALK_METERS_PER_MINUTE).toBe(80);
    expect(walkMinutes(1200)).toBe(15); // 原型：1.2km → 步行约 15 分钟
    expect(walkMinutes(40)).toBe(1);
    expect(walkMinutes(undefined)).toBeUndefined();
    expect(walkMinutes(-1)).toBeUndefined();
  });
});

describe("SCENE-SHOP-DIRECTORY-001: sorting only offers what the data supports", () => {
  it("hides 「最近」 when there is no fix — a sort that cannot sort is a dead button", () => {
    expect(availableShopSorts(true).map((sort) => sort.id)).toEqual(["recommended", "nearest", "saved", "visited"]);
    expect(availableShopSorts(false).map((sort) => sort.id)).toEqual(["recommended", "saved", "visited"]);
    // 原型还有 出图最多 / 评分最高 / 最近新开 —— 三项都没有数据源，一律不做。
    for (const unsupported of ["出图最多", "评分最高", "最近新开"]) {
      expect(SHOP_SORTS.map((sort) => sort.label)).not.toContain(unsupported);
    }
  });

  it("sorts by real distance, and puts shops we cannot place last", () => {
    const rows = sortShops(CATALOG, "nearest", HANOI_CENTER);
    // 壁画街 ~0.9km、湖 0、咖啡 Cầu Giấy ~6.4km、北宁 ~25km
    expect(rows[0]!.id).toBe("hoankiem");
    expect(rows[rows.length - 1]!.id).toBe("threebeans_bn");
    // 没有定位时「最近」不该出现，但真被调到了也不能崩、不能乱：顺序确定。
    const noFix = sortShops(CATALOG, "nearest", undefined).map((row) => row.id);
    expect(noFix).toHaveLength(CATALOG.length);
  });

  it("orders by real counts with a deterministic tie-break", () => {
    expect(sortShops(CATALOG, "visited").map((row) => row.id)).toEqual(["hoankiem", "phunghung", "threebeans", "threebeans_bn"]);
    // savedCount 全是 1（或 0）⇒ 同分，必须按 id 稳定排序，否则两次渲染自己换位。
    expect(sortShops(CATALOG, "saved").map((row) => row.id)).toEqual(["threebeans", "threebeans_bn", "hoankiem", "phunghung"]);
  });

  it("recommends by the server's own formula: real engagement minus real distance", () => {
    // 同一个位置、同样的距离项 ⇒ 互动量高的排前面。
    const near = shop({ id: "aaa", name: "aaa", savedCount: 5, latitude: 21.0288, longitude: 105.8525 });
    const far = shop({ id: "bbb", name: "bbb", savedCount: 0, latitude: 21.0288, longitude: 105.8525 });
    expect(sortShops([far, near], "recommended", HANOI_CENTER)[0]!.id).toBe("aaa");
    // 互动量相同 ⇒ 近的赢（距离项真的进了公式，不是摆设）。
    const close = shop({ id: "ccc", name: "ccc", savedCount: 3, latitude: 21.0288, longitude: 105.8525 });
    const distant = shop({ id: "ddd", name: "ddd", savedCount: 3, latitude: 21.1824, longitude: 106.0706 });
    expect(sortShops([distant, close], "recommended", HANOI_CENTER)[0]!.id).toBe("ccc");
    // 公式本身：log1p(saved + 2*visited + 2*planned) * 8 - km * 2.5
    const sample = shop({ id: "sample", name: "sample", savedCount: 1, visitedCount: 1, plannedCount: 0, latitude: 21.0288, longitude: 105.8525 });
    expect(recommendationScore(sample, HANOI_CENTER)).toBeCloseTo(Math.log1p(3) * 8.0, 6);
  });

  it("keeps the client formula in step with the Go service that owns it", () => {
    // 公开目录不带 recommendationScore（那个字段只在 ListNearbyScenes 里填），
    // 所以「推荐」的顺序是客户端按同一个公式算的。服务端改了公式而这里没跟，
    // 两边对"推荐"的定义就悄悄分叉 —— 这条钉直接读那个 Go 文件。
    const go = readFileSync(fileURLToPath(new URL("../../api-go/internal/realityscene/service.go", import.meta.url)), "utf8");
    expect(go).toContain("math.Log1p(engagement)*8.0 - (s.DistanceMeters/1000)*2.5");
    expect(go).toContain("float64(s.SavedCount + 2*s.VisitedCount + 2*s.PlannedCount)");
  });
});

describe("SCENE-SHOP-DIRECTORY-001: area filters come from the result set itself", () => {
  it("offers no filter when there is only one area to choose", () => {
    expect(shopAreaFacets([CAFE_CAUGIAY])).toEqual([]);
    expect(shopAreaFacets([CAFE_CAUGIAY, shop({ id: "x", name: "x", area: "Cầu Giấy" })])).toEqual([]);
  });

  it("lists the real areas, deduped, and narrows without ever emptying by accident", () => {
    expect(shopAreaFacets(CATALOG)).toEqual(["Cầu Giấy", "Bắc Ninh", "Hoàn Kiếm"]);
    // 空数组 = 不筛（不是"筛到空"）。
    expect(filterShopsByAreas(CATALOG, [])).toHaveLength(CATALOG.length);
    expect(filterShopsByAreas(CATALOG, ["Bắc Ninh"]).map((row) => row.id)).toEqual(["threebeans_bn"]);
    expect(filterShopsByAreas(CATALOG, ["Bắc Ninh", "Cầu Giấy"]).map((row) => row.id).sort()).toEqual(["threebeans", "threebeans_bn"]);
  });
});

describe("SCENE-SHOP-DIRECTORY-001: card and detail lines only say what is true", () => {
  it("prefers the live signal, then saved, then visited — and says nothing when all are zero", () => {
    expect(shopCardSignal(shop({ id: "a", name: "a", hereCount: 2, savedCount: 9, visitedCount: 9 }))).toBe("2 人此刻在这里");
    expect(shopCardSignal(shop({ id: "b", name: "b", savedCount: 9, visitedCount: 9 }))).toBe("9 人收藏");
    expect(shopCardSignal(shop({ id: "c", name: "c", visitedCount: 9 }))).toBe("9 人去过");
    expect(shopCardSignal(shop({ id: "d", name: "d" }))).toBe("");
    // 脏数据不许污染文案。
    expect(shopCardSignal(shop({ id: "e", name: "e", savedCount: Number.NaN }))).toBe("");
    expect(shopCardSignal(shop({ id: "f", name: "f", savedCount: -3 }))).toBe("");
  });

  it("states plainly when nobody is there right now", () => {
    expect(shopHereLine(3)).toBe("3 位此刻在这里");
    expect(shopHereLine(0)).toBe("此刻无人在这里");
    expect(shopHereLine(undefined)).toBe("此刻无人在这里");
  });

  it("builds tags from the real type and area — never a 「营业中」 we cannot know", () => {
    // 「动态场景」是内部类型词，不给用户看。
    expect(shopDetailTags(CAFE_CAUGIAY)).toEqual(["咖啡", "Cầu Giấy"]);
    // area 已经出现在 type 里就不重复。
    expect(shopDetailTags(shop({ id: "g", name: "g", type: "湖边 · Cầu Giấy", area: "Cầu Giấy" }))).toEqual(["湖边", "Cầu Giấy"]);
    expect(shopDetailTags(shop({ id: "h", name: "h", type: "", area: "" }))).toEqual([]);
    // active 是静态布尔，不代表此刻开门 —— 不许拿它渲染营业状态。
    expect(shopDetailTags(shop({ id: "i", name: "i", type: "咖啡", area: "X" }))).not.toContain("营业中");
  });

  it("fills the info strip with the prototype's three cells: rating / 去过 / 收藏", () => {
    // SCENE-HOME-PROTOTYPE-001：原型 deepseek_html_20260927_7fc18d 的 stats-card
    // 就是 ★评分 / 去过 / 收藏 三格；距离单独放在动作按钮下面的 dist-bar 里，
    // 不再占一格。去过 / 收藏是真实聚合，0 就是 0，照常显示。
    expect(shopInfoCells(shop({ id: "k", name: "k", savedCount: 1, visitedCount: 2, hereCount: 3 }))).toEqual([
      { value: "2", label: "去过" },
      { value: "1", label: "收藏" },
    ]);
    // 0 也是真实计数：去过 0 / 收藏 0 照样画（不是「—」也不是整条消失）。
    expect(shopInfoCells(shop({ id: "k2", name: "k2" }))).toEqual([
      { value: "0", label: "去过" },
      { value: "0", label: "收藏" },
    ]);
    // 有真实评分时它打头。
    const withRating = shopInfoCells(shop({ id: "k3", name: "k3", rating: 4.8, ratingCount: 12 }));
    expect(withRating).toHaveLength(3);
    expect(withRating[0]).toEqual({ value: "4.8", label: "12 条评价" });
    // 距离条：有定位才有文案；没定位返回空串（整条不画）。
    expect(shopDistanceBar(shop({ id: "k4", name: "k4", latitude: 21.0288, longitude: 105.8525 }), HANOI_CENTER)).toContain("距离你");
    expect(shopDistanceBar(shop({ id: "k5", name: "k5" }))).toBe("");
    // 评分那一格没有数据源 ⇒ 不出现，也不写「—」。
    for (const cell of shopInfoCells(shop({ id: "k6", name: "k6" }))) {
      expect(cell.value).not.toContain("—");
    }
  });

  it("tells the user what the page actually is instead of claiming a radius", () => {
    expect(shopListLocationLine(true)).toBe("已按你的当前位置排序 · 距离为直线距离");
    expect(shopListLocationLine(false)).toBe("未取得定位 · 不含距离，也没有「最近」排序");
    // 公开目录不按半径筛 ⇒ 不许写「3km 内」。
    expect(shopListLocationLine(true)).not.toContain("3km");
    expect(shopCountText(2, "家")).toBe("2 家");
    expect(shopCountText(-1, "家")).toBe("0 家");
    expect(shopListEndText(2, "家")).toBe("已加载全部 2 家");
  });

  it("shows the real area coverage from the listed rows, never a fabricated radius", () => {
    // 原型这行有地址：区域取当前列表真实覆盖的 area，去重去空。
    expect(shopListLocationLine(true, ["西湖区", "还剑湖区"])).toBe(
      "西湖区 · 还剑湖区 · 已按你的当前位置排序 · 距离为直线距离"
    );
    expect(shopListLocationLine(false, ["西湖区"])).toBe(
      "西湖区 · 未取得定位 · 不含距离，也没有「最近」排序"
    );
    expect(shopListLocationLine(true, ["  ", "西湖区", "西湖区"])).toBe(
      "西湖区 · 已按你的当前位置排序 · 距离为直线距离"
    );
    expect(
      shopListLocationLine(true, ["A 区", "B 区", "C 区", "D 区", "E 区"])
    ).toBe("A 区 · B 区 · C 区等 5 个区域 · 已按你的当前位置排序 · 距离为直线距离");
    expect(shopListLocationLine(true, [])).not.toContain(" · 已按");
  });
});

// ---------------------------------------------------------------------------
// SCENE-RATING-CHIP-001（2026-09-27，用户：「所有场景对齐运动」——
// 「你看运动 list 有评分 销量 城市 价格 收藏 营业时间」）
//
// 运动卡那行 chip 是 ★ 评分 / N 单 / 城市。场景这边**评分现在有真实来源**
// （SCENE-REVIEW-001 的场景评价域 + main.go 的 SetRatingLookup），公开目录本来
// 就返回 rating / ratingCount —— 之前这一屏把它丢了。数量那格场景没有订单域，
// 按真实语义换成「N 人去过」；价格和营业时间全仓没有生产者，不搬。
// ---------------------------------------------------------------------------

describe("SCENE-RATING-CHIP-001: the rating chip only exists when the server really sent an aggregate", () => {
  it("renders the real average, rounded the way the map surface already does", () => {
    expect(shopRatingChip(shop({ id: "a", rating: 4.8, ratingCount: 12 }))).toBe("★ 4.8");
    // 5 要写成 5.0，不是 "5" —— 跟 reality-scene-map 的 toFixed(1) 一致。
    expect(shopRatingChip(shop({ id: "b", rating: 5, ratingCount: 3 }))).toBe("★ 5.0");
    expect(shopRating(shop({ id: "b2", rating: 4.75, ratingCount: 4 }))).toEqual({ stars: "4.8", count: 4 });
  });

  it("treats a missing or zero count as 'no reviews yet', never as a score", () => {
    // 服务端两个字段都带 omitempty：只有 rating 没有 count = 没评价，不算分。
    expect(shopRatingChip(shop({ id: "c", rating: 4.8 }))).toBe("");
    expect(shopRatingChip(shop({ id: "d", ratingCount: 12 }))).toBe("");
    expect(shopRatingChip(shop({ id: "e", rating: 4.8, ratingCount: 0 }))).toBe("");
    expect(shopRatingChip(shop({ id: "f" }))).toBe("");
    // 0 分不是合法评分 ⇒ 不许画成「★ 0.0」；NaN 同理。
    expect(shopRatingChip(shop({ id: "g", rating: 0, ratingCount: 5 }))).toBe("");
    expect(shopRatingChip(shop({ id: "h", rating: Number.NaN, ratingCount: 5 }))).toBe("");
    expect(shopRating(shop({ id: "i", rating: 4.8, ratingCount: 0 }))).toBeUndefined();
  });

  it("puts the real rating first in the detail info strip, and nothing when there is none", () => {
    expect(shopInfoCells(shop({ id: "o", name: "o", rating: 4.8, ratingCount: 12 }))[0])
      .toEqual({ value: "4.8", label: "12 条评价" });
    expect(shopRatingCell(shop({ id: "o2", name: "o2" }))).toBeUndefined();
    // 没评价时那一格不占位、不写「—」。
    const without = shopInfoCells(shop({ id: "p", name: "p" }));
    expect(without.some((cell) => cell.label.includes("评分") || cell.value.includes("—"))).toBe(false);
  });
});

describe("SCENE-RATING-CHIP-001: the card chip row mirrors the sports card, with no invented field", () => {
  it("orders the chips rating → volume → city → type, exactly like the sports card", () => {
    const full = shop({
      id: "j", name: "j", area: "Cầu Giấy", type: "咖啡 · 动态场景",
      rating: 4.8, ratingCount: 12, visitedCount: 7,
    });
    expect(shopCardChips(full)).toEqual([
      { kind: "RATING", text: "★ 4.8" },
      { kind: "VISITED", text: "7 人去过" },
      { kind: "AREA", text: "Cầu Giấy" },
      { kind: "TYPE", text: "咖啡" },
    ]);
  });

  it("never borrows the sports card's demo fields that this repo cannot source", () => {
    const texts = shopCardChips(shop({
      id: "k", name: "k", area: "Cầu Giấy", type: "咖啡", rating: 4.8, ratingCount: 12, visitedCount: 7,
    })).map((chip) => chip.text).join(" | ");
    // 「87 单」—— 场景没有订单域，不写"单"。
    expect(texts).not.toContain("单");
    // 「450.000₫/时」和封面「18:00-22:00」—— 全仓没有 price / hours 生产者。
    expect(texts).not.toContain("₫");
    expect(texts).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("stays short when there is nothing real to say, instead of padding with placeholders", () => {
    expect(shopCardChips(shop({ id: "l", name: "l", area: "Cầu Giấy", type: "咖啡 · 动态场景" }))).toEqual([
      { kind: "AREA", text: "Cầu Giấy" },
      { kind: "TYPE", text: "咖啡" },
    ]);
    // 0 去过不画「0 人去过」。
    expect(shopVisitedChip(shop({ id: "m", name: "m", visitedCount: 0 }))).toBe("");
    expect(shopVisitedChip(shop({ id: "n", name: "n", visitedCount: 3 }))).toBe("3 人去过");
    // 空 area / 空 type 也不画空 chip。
    expect(shopCardChips(shop({ id: "q", name: "q", area: "", type: "" }))).toEqual([]);
  });

  it("does not repeat the area as both a city chip and a type tag", () => {
    const chips = shopCardChips(shop({ id: "r", name: "r", area: "Cầu Giấy", type: "湖边 · Cầu Giấy" }));
    expect(chips.filter((chip) => chip.text === "Cầu Giấy")).toHaveLength(1);
    // 去重是按文本来的，所以调用方拿 text 当 key 不会撞。
    expect(new Set(chips.map((chip) => `${chip.kind}:${chip.text}`)).size).toBe(chips.length);
  });
});

// ---------------------------------------------------------------------------
// 源码级：新那一屏必须**消费**纯模块，而且不许把原型里没有数据源的东西搬过来
// ---------------------------------------------------------------------------

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const componentRaw = readFileSync(fileURLToPath(new URL("./components/scene-shop-directory.tsx", import.meta.url)), "utf8");
const component = stripComments(componentRaw);

// SCENE-HOME-PROTOTYPE-001（2026-09-28）：同一份原型有**两份实现** —— 组件
// components/scene-shop-directory.tsx，和场景地图的详情面
// surfaces/reality-scene-map.tsx。以前这条钉只读前者，所以后者一路漂到
// 「★ 5.0」「☆ 收藏 / ✓ 已打卡 / 导航去这里 ›」这种**文本字符冒充图标**的
// 写法都没人拦（BACK-GLYPH-001 修的是同一类错）。用户看到的是地图面，
// 于是报了「场景主页没有对齐原型设计」。两份实现现在一起钉。
const surface = stripComments(readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8"));

// 从 from 切到它之后第一个 to（两端都不含）。用来把断言**限定在某个区块内**：
// 同一批文件里还留着几处**没改**的同类写法 —— 行内状态前缀 `✓`（"✓ 已选择" /
// "✓ 本店已打卡" 这种，全仓十几处约定）和 `更多 ›`（跟 badminton-companion 同款的
// 位置选择器 idiom）—— 不限定范围就会把「区块已修好」误判成红。
const sliceBetween = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = start < 0 ? -1 : source.indexOf(to, start + from.length);
  return start < 0 || end < 0 ? "" : source.slice(start, end);
};

describe("SCENE-SHOP-DIRECTORY-001: the screen consumes the tested module instead of re-deriving", () => {
  it("imports the derivations rather than owning a second copy", () => {
    expect(component).toContain('from "../scene-shop-directory"');
    expect(component).toContain("shopDirectoryRows(");
    expect(component).toContain("shopInfoCells(");
    // 这些数字在 .tsx 里自己算一遍就没人测得到了。
    expect(component).not.toContain("const SHOP_SORTS");
    expect(component).not.toContain("Math.log1p");
    expect(component).not.toContain("6371000");
    expect(component).not.toContain("export function shopDirectoryRows");
  });

  it("does not port the prototype fields that have no source in this repo", () => {
    // 剥注释后断言：注释里解释「为什么不做」时会写到这些词，那不算把它们做出来了。
    for (const fabricated of [
      "本月热门", "评分最高", "最近新开", "出图最多", "带机位", "可预约", "安静",
      "营业中", "212 条评分", "出图墙", "在这里的小美们", "位在此出图",
    ]) {
      expect(component, `原型字段「${fabricated}」没有数据源，不该出现在这一屏`).not.toContain(fabricated);
    }
    // 也不许自己写死一个评分/人数。
    expect(component).not.toMatch(/[0-9]\.[0-9]\s*★/);
  });

  it("still performs real actions instead of showing dead buttons", () => {
    // 打卡走共享命令出口（不是自己拼一份 POST），导航走既有的系统地图深链。
    expect(component).toContain('from "../scene-commands"');
    expect(component).toContain('"SetRealitySceneCheckIn"');
    expect(component).toContain("meetupDirectionsUrls");
  });
});

describe("SCENE-RATING-CHIP-001: the card consumes the chip row instead of hardcoding one", () => {
  it("renders chips from the tested module and colours them by kind", () => {
    expect(component).toContain("shopCardChips(");
    expect(component).toContain('chip.kind === "RATING"');
    expect(component).toContain('chip.kind === "AREA"');
    // 颜色跟运动卡的 rideTagGold / rideTagLime 用同一对 token，不是各挑一个近似色。
    expect(component).toContain("color.warn");
    expect(component).toContain("color.stateInfoBg");
  });

  it("does not write a rating, a price or an opening time into the source", () => {
    // 写死一个「4.8 ★」就没人测得到了。
    expect(component).not.toMatch(/[0-9]\.[0-9]\s*★/);
    // 价格和营业时间全仓没有生产者，源码里也不许出现。
    expect(component).not.toContain("₫");
    expect(component).not.toContain("18:00-22:00");
  });
});

describe("SCENE-CATEGORY-BADGE-001: cover badge comes from the real category enum, no fabricated license/status", () => {
  it("returns the human label for the three known categories", () => {
    expect(shopCategoryBadge(shop({ id: "a", category: "商家" }))).toBe("商家");
    expect(shopCategoryBadge(shop({ id: "b", category: "景点" }))).toBe("景点");
    expect(shopCategoryBadge(shop({ id: "c", category: "其他" }))).toBe("其他");
  });
  it("returns empty when the server didn't send a category, so the badge disappears", () => {
    // 工厂默认给 category="商家"，所以用裸对象模拟「服务端没发」的状态。
    expect(shopCategoryBadge({})).toBe("");
    expect(shopCategoryBadge({ category: "" })).toBe("");
    expect(shopCategoryBadge({ category: "  " })).toBe("");
  });
  it("refuses to translate unknown values into a badge", () => {
    // 演示数据里那些「场馆持证」「营业中」类伪资质不能藏在这里 —— 直接抛空串。
    expect(shopCategoryBadge(shop({ id: "g", category: "营业中" }))).toBe("");
    expect(shopCategoryBadge(shop({ id: "h", category: "场馆持证" }))).toBe("");
    expect(shopCategoryBadge(shop({ id: "i", category: "VIP" }))).toBe("");
  });
  it("the card renders the badge only when the helper returned a label", () => {
    expect(component).toContain("shopCategoryBadge(scene)");
    expect(component).toContain("styles.coverBadge");
    expect(component).toContain("styles.coverBadgeText");
  });
});

describe("SCENE-SHOP-POLISH-001（原型 f05cb0：地址行 / 远距离 / 人话状态）", () => {
  it("far away: no absurd km or walk minutes", () => {
    expect(isFarAway(11_730_300)).toBe(true);
    expect(isFarAway(1_200)).toBe(false);
    expect(isFarAway(undefined)).toBe(false);
    expect(shopCardDistance(11_730_300)).toBe("");
    expect(shopHeroDistanceSuffix(11_730_300)).toBe("");
    expect(shopHeroDistanceSuffix(1_200)).toBe(" · 距你 1.2km");
    expect(formatShopDistance(11_730_300)).not.toContain(".");
    expect(shopListLocationLine(true, ["Cầu Giấy"], true)).toContain("不显示距离");
  });

  it("address line never fakes a street from the area", () => {
    expect(shopAddressLine({ area: "Cầu Giấy", address: "12 Trần Thái Tông" })).toBe("12 Trần Thái Tông · Cầu Giấy");
    expect(shopAddressLine({ area: "Cầu Giấy", address: "12 Trần Thái Tông, Cầu Giấy" })).toBe("12 Trần Thái Tông, Cầu Giấy");
    expect(shopAddressLine({ area: "Cầu Giấy" })).toBe("");
  });

  it("action states are plain words, never raw enum codes", () => {
    expect(sceneActionStateText("REQUIRES_HUMAN_ACCEPTANCE")).toBe("需要对方同意");
    expect(sceneActionStateText("SOMETHING_NEW")).toBe("");
    // 用户反馈（"邀请真人 发布机会 报名活动废话很多"）：副标题不再拼 moneyMeaning
    // 那句免责声明腔，只留状态短句。
    expect(sceneActionSubtitle({ state: "ACCEPTS_APPLICATIONS", moneyMeaning: "报酬由你出" })).toBe("接受报名");
    expect(sceneActionSubtitle({ state: "SOMETHING_NEW", moneyMeaning: "免费" })).toBe("");
  });
});

describe("SCENE-PHOTO-WALL-001 photo wall tiles", () => {
  it("one tile per image/video, in post order, audio and url-less items skipped, capped", () => {
    const model = {
      posts: [
        { postId: "p1", authorId: "u1", authorDisplayName: " Linh " },
        { postId: "p2", authorId: "u2" },
      ],
      media: {
        p1: [
          { mediaAssetId: "a", mediaType: "IMAGE", thumbnailUrl: "/t/a" },
          { mediaAssetId: "b", mediaType: "AUDIO", thumbnailUrl: "/t/b" },
          { mediaAssetId: "c", mediaType: "IMAGE" },
        ],
        p2: [{ mediaAssetId: "d", mediaType: "VIDEO", feedUrl: "/f/d" }],
      },
    };
    expect(scenePhotoWallTiles(model)).toEqual([
      { key: "p1:a", postId: "p1", path: "/t/a", author: "Linh" },
      { key: "p2:d", postId: "p2", path: "/f/d", author: "" },
    ]);
    expect(scenePhotoWallTiles(model, 1)).toHaveLength(1);
    expect(scenePhotoWallTiles({ posts: [], media: {} })).toEqual([]);
  });
});

describe("SCENE-PHOTO-WALL-002 asset fallback", () => {
  it("fills an empty post wall with hero and menu photos, deduped and capped, never null", () => {
    // Three Beans：帖子墙空，但传过主图/菜单/招牌 —— 墙必须拿资产补，不能空白。
    const detail = {
      heroImageUrl: "https://cdn/x/hero.jpg",
      menu: [{ imageUrl: "https://cdn/x/menu1.jpg" }, { imageUrl: " https://cdn/x/menu1.jpg " }, { imageUrl: "" }],
      fullMenu: [{ imageUrl: "https://cdn/x/sign.jpg" }, { imageUrl: "https://cdn/x/hero.jpg" }],
    };
    expect(sceneAssetWallTiles(detail)).toEqual([
      { key: "asset:hero:1", postId: "", path: "https://cdn/x/hero.jpg", author: "" },
      { key: "asset:menu:2", postId: "", path: "https://cdn/x/menu1.jpg", author: "" },
      { key: "asset:menu:3", postId: "", path: "https://cdn/x/sign.jpg", author: "" },
    ]);
    expect(sceneAssetWallTiles(detail, 2)).toHaveLength(2);
    expect(sceneAssetWallTiles(undefined)).toEqual([]);
    expect(sceneAssetWallTiles({})).toEqual([]);
    expect(sceneAssetWallTiles({ menu: [], fullMenu: [] })).toEqual([]);
  });
});

describe("STORE-SCENE-LINK-001 sceneMerchantWallTiles", () => {
  it("builds thumb URLs from the wired store's real photos", () => {
    const photos = [{ mediaAssetId: "ma_cover", caption: "门店主视觉" }, { mediaAssetId: "ma_inside", caption: "" }];
    expect(sceneMerchantWallTiles(photos, "http://localhost:8080")).toEqual([
      { key: "merchant:ma_cover", postId: "", path: "http://localhost:8080/v1/media/thumb/ma_cover", author: "门店主视觉" },
      { key: "merchant:ma_inside", postId: "", path: "http://localhost:8080/v1/media/thumb/ma_inside", author: "" },
    ]);
  });

  it("returns nothing when unclaimed, empty, or without a known API base", () => {
    expect(sceneMerchantWallTiles(undefined, "http://localhost:8080")).toEqual([]);
    expect(sceneMerchantWallTiles([], "http://localhost:8080")).toEqual([]);
    expect(sceneMerchantWallTiles([{ mediaAssetId: "ma_cover" }], undefined)).toEqual([]);
    expect(sceneMerchantWallTiles([{ mediaAssetId: "  " }], "http://localhost:8080")).toEqual([]);
  });
});

describe("SCENE-HOME-DETAIL-001: the detail modal mirrors the design's three new sections from real backend data", () => {
  it("the hero pill row filters the area out so the address line is the only place area appears", () => {
    // 设计稿：详情头图上「咖啡 · 动态场景」下面再来一颗「Bắc Ninh」胶囊就是同一份信息
    // 出现两次（address 行里已经有 "109 Lý Chiêu Hoàng, Suối Hoa, TP B... · Bắc Ninh"）。
    expect(component).toContain("detailTags.filter((tag) => tag !== selected?.area.trim())");
  });
  it("renders the '现在最适合' block from detail.variants and detail.liveState", () => {
    expect(component).toContain("现在最适合");
    expect(component).toContain("styles.bestGrid");
    expect(component).toContain("styles.bestCard");
    expect(component).toContain("detail.liveState.state.replaceAll(\"_\", \" \")");
  });
  it("renders the '适合一起的人' block, preferring companionSuggestions when present", () => {
    expect(component).toContain("适合一起的人");
    expect(component).toContain("detail.companionSuggestions");
    expect(component).toContain("detail.humans.map");
    // 占位候选文案必须出现 —— FIXTURE 数据按既有规矩保留这个尾标。
    expect(component).toContain("占位候选");
  });
  it("renders the '这个 Scene 喝什么' menu block, with an honest empty state when the menu is missing", () => {
    expect(component).toContain("这个 Scene 喝什么");
    expect(component).toContain("detail.menu.map");
    // UI-COPY-HONEST-001：空态说「这家店还没有菜单」，不说「菜单还没回传 —— 这不是
    // 加载失败，是后端这条接口还没接进来」。后者是把自己的实现状态抖给用户看。
    expect(component).toContain("这家店还没有菜单");
    expect(component).not.toContain("菜单还没回传");
    expect(component).not.toContain("接口还没接进来");
  });
  it("does not hardcode any people names, menu names, or recommendation texts", () => {
    // 这些必须由 detail.humans / detail.menu / detail.variants 带进来 —— 写死一个
    // 就是 SCENE-NO-FABRICATED-001。占了「适合一起的人」的 placeholder 候选 Mai /
    // Linh / Trang 是 demo surface 的演示数据，不许进真实详情。
    expect(component).not.toContain("Mai");
    expect(component).not.toContain("Linh");
    expect(component).not.toContain("Trang");
    expect(component).not.toContain("AVAILABLE NOW");
    // 价格 / 营业时间仍由 SCENE-RATING-CHIP-001 的同一组反向钉守着。
  });
});

describe("SCENE-HOME-PROTOTYPE-001: detail mirrors the 场景名片 prototype (deepseek_html_20260927_7fc18d)", () => {
  it("has the prototype's three-button action row: 收藏 / 打卡 / 导航", () => {
    // 原型 action-row3：三颗等宽按钮。以前是「导航 + 我在这里」两颗 + hero
    // 角落的心形 —— 收藏被藏起来了，用户照原型看就是「缺收藏」。
    expect(component).toContain("styles.actionRow3");
    expect(component).toContain("styles.actSave");
    expect(component).toContain("styles.actCheckin");
    expect(component).toContain("styles.actNav");
    expect(component).toContain('? "已收藏" : "收藏"');
    expect(component).toContain('? "已打卡" : "打卡"');
    // 三颗都是真命令，不是死按钮。
    expect(component).toContain("void toggleSaved(selected)");
    expect(component).toContain("void persistCheckIn(selected");
    expect(component).toContain("openNavigation(selected)");
  });
  it("shows the prototype's distance bar separately from the stats card", () => {
    // 原型 dist-bar：距离 + 100 米自动打卡说明，单独一行（不在 stats 里）。
    expect(component).toContain("shopDistanceBar(selected, origin)");
    expect(component).toContain("styles.distBar");
  });
  it("renders 适合一起的人 as the prototype's dark match-card with the 匹配推荐 label", () => {
    expect(component).toContain("styles.matchCard");
    expect(component).toContain("匹配推荐");
    expect(component).toContain("styles.matchTitle");
    // 原型还有「查看全部匹配」按钮 —— 真实 app 没有那个目的地，做了就是
    // placeholder-honest-actions.test.ts 钉的死按钮，所以**故意不做**。
    expect(component).not.toContain("查看全部匹配");
  });
  it("renames the intent block to 你想在这里做什么？ and drops the unsourced footnote", () => {
    expect(component).toContain("你想在这里做什么？");
    expect(component).not.toContain("这里能做的事");
    // UI-COPY-HONEST-001：这条脚注原来叫「the prototype footnote」，但原型里**根本没有**
    // 这行（docs/design/references 全仓搜不到）—— 钉的是个伪原型依据。它又是免责套话
    // （「以双方确认为准」），对所有场景都一样、没有信息量。删掉，脚注不再回来。
    expect(component).not.toContain("匹配结果仅供参考");
    expect(component).not.toContain("实际约见以双方确认为准");
  });
  it("surface reality-scene-map draws the three action buttons as glyphs, not as text characters", () => {
    const row = sliceBetween(surface, "styles.actionRow3", "styles.distBar");
    expect(row).not.toBe("");
    // 反向针先判：以前这里写的是「☆ 收藏 / ✓ 已打卡 / 导航去这里 ›」——★/☆/✓/›
    // 是**文本字符**，形状和垂直基线随字号漂，`filled` 这种状态没地方落
    // （`☆ 收藏` 变 `★ 已收藏` 只是换了个字符，不是换了一个字形）。
    expect(row).not.toContain("☆");
    expect(row).not.toContain("★");
    expect(row).not.toContain("›");
    expect(row).not.toContain("✓");
    // 正向针：三颗各有一个真字形，而且都有「已…」落地态。
    expect(row).toContain('name="replyLike"');
    expect(row).toContain('name="check"');
    expect(row).toContain('name="arrowUpRight"');
    expect(row).toContain('? "已收藏" : "收藏"');
    expect(row).toContain('? "已打卡" : "打卡"');
    expect(row).toContain("styles.action3Save");
    expect(row).toContain("styles.action3Checkin");
    expect(row).toContain("styles.action3Nav");
  });
  it("surface reality-scene-map draws the stat-card rating as the filled star glyph, not a ★ character", () => {
    const card = sliceBetween(surface, "const ratingCount =", "styles.reviewEntry");
    expect(card).not.toBe("");
    // 反向针先判：以前是文本 "★ 5.0" —— 原型 `.stat-star` 是**实心金**星，
    // 字符没法填色，也没法跟数字分开放（原型是图标 + 数字两颗，数字 22px）。
    expect(card).not.toContain("★");
    expect(card).toContain('filled name="star"');
    expect(card).toContain("styles.statCellRating");
  });
  it("surface reality-scene-map draws the review star picker as filled glyphs, not ★ characters", () => {
    const picker = sliceBetween(surface, "styles.reviewStarsRow", "styles.reviewCommentInput");
    expect(picker).not.toBe("");
    // 反向针先判：以前是文本 "★" 换个 color 冒充「点亮」—— 字符不是字形
    // （BACK-GLYPH-001 同款）：填不了色，也拿不到实心/描边两种形态。
    expect(picker).not.toContain("★");
    expect(picker).toContain('filled={n <= reviewStars} name="star"');
  });
  it("surface reality-scene-map draws the earned-badge tick as a glyph, not a ✓ character", () => {
    const row = sliceBetween(surface, "styles.badgeNameRow", "styles.badgeShareBtn");
    expect(row).not.toBe("");
    // 反向针先判：以前把 " ✓" 直接拼进 Text（`{badge.name} ✓`）—— 勾的形状和
    // 垂直基线跟着 14pt 的字号漂，而且「没点亮」时那个字符还在。改成真字形，
    // 只有 earned 才画。
    expect(row).not.toContain("✓");
    expect(row).toContain('<ProxyIcon color={color.mint} name="check" size={13} />');
  });
  it("surface reality-scene-map's pin quick-sheet uses real chevrons, not › characters", () => {
    // 快打卡弹层那一排（导航 / 看详情）—— 用 pinSheetRow 起、nearbyError 收，
    // 不要用 styles.actionText 当收尾：那颗在**同一行里排在 chevron 前面**，
    // 切出来会把 chevron 切掉（第一版就是这么错的）。
    const sheet = sliceBetween(surface, "styles.pinSheetRow", "styles.nearbyError");
    expect(sheet).not.toBe("");
    // 反向针先判：导航那颗尾部拼的是 `›`、看详情那颗整颗就是个 `›`。
    expect(sheet).not.toContain("›");
    expect(sheet).toContain('name="arrowUpRight"');
    expect(sheet).toContain('name="chevronRight"');
  });
  it("component scene-shop-directory draws its card-foot and intent chevrons as glyphs", () => {
    // 卡脚那颗（列表卡右下）原来直接写 `<Text>›</Text>`。
    const foot = sliceBetween(component, "styles.cardFoot", "styles.listEnd");
    expect(foot).not.toBe("");
    expect(foot).not.toContain("›");
    expect(foot).toContain('<ProxyIcon color={color.muted} name="chevronRight" size={16} />');
    // 意图卡那颗（「你想在这里做什么？」三张卡右边）原来也是 `<Text>›</Text>`。
    // UI-COPY-HONEST-001 删掉了紧跟其后的 intentFootnote 免责脚注，所以这里的切片
    // 终点从 styles.intentFootnote 改成收尾的 `</View> : null}`。
    const intent = sliceBetween(component, "detail.actions.map(", "</View> : null}");
    expect(intent).not.toBe("");
    expect(intent).not.toContain("›");
    expect(intent).toContain('<ProxyIcon color={color.muted} name="chevronRight" size={16} />');
  });
  it("surface reality-scene-map uses the prototype's intent-block title and keeps the 匹配推荐 card", () => {
    expect(surface).not.toContain("怎么组织这次现实行动");
    expect(surface).toContain("你想在这里做什么？");
    expect(surface).toContain("styles.matchCard");
    expect(surface).toContain("匹配推荐");
    // 死按钮同样不许在地图面上回来。
    expect(surface).not.toContain("查看全部匹配");
  });
  it("surface reality-scene-map carries the prototype's 这里的活动 / 照片墙 sections", () => {
    expect(surface).toContain("这里的活动");
    expect(surface).toContain("照片墙");
    expect(surface).toContain("SCENE_PHOTO_WALL_EMPTY");
  });
  it("surface reality-scene-map glues the stats card to the cover so the -26px overlap lands on the photo", () => {
    // SCENE-HOME-PROTOTYPE-001（2026-09-28）：原型里 `.cover` 后面**直接**就是
    // `.stats-card{margin:-26px 16px 14px}` —— 那 -26 是拿去压在封面照片上的。
    // 实现里这两块之间不能夹任何别的区块：以前夹了一行 heroFacets，于是 -26 压
    // 在那行胶囊上（胶囊被裁掉一半、卡片也没压到照片）。同原型的另一份实现
    // scene-shop-directory.tsx 也是 hero 紧跟 infoStrip。
    const coverToCard = sliceBetween(surface, "styles.coverWrap", "styles.statsCard");
    expect(coverToCard).not.toBe("");
    // 反向针先判（正向针先判的话，把胶囊挪回来时正向针先开火，这几条永远没被执行过）。
    expect(coverToCard).not.toContain("styles.heroFacets");
    expect(coverToCard).not.toContain("styles.venueIntro");
    expect(coverToCard).not.toContain("styles.sceneCounts");
    // 正向针：胶囊没被删掉，只是挪到了统计卡**下面**（仍在动作行上面）。
    expect(surface.indexOf("styles.heroFacets")).toBeGreaterThan(surface.indexOf("styles.statsCard"));
    expect(surface.indexOf("styles.heroFacets")).toBeLessThan(surface.indexOf("styles.actionRow3"));
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sceneCategoryEntries } from "./scene-category-entries";
import {
  SHOP_SORTS, WALK_METERS_PER_MINUTE, availableShopSorts, filterShopsByAreas, formatShopDistance,
  recommendationScore, sceneDistanceMeters, shopAreaFacets, shopCardSignal, shopCountText,
  shopDetailTags, shopDirectoryRows, shopHereLine, shopInfoCells, shopListEndText,
  shopListLocationLine, sortShops, walkMinutes,
  isFarAway, scenePhotoWallTiles, sceneActionStateText, sceneActionSubtitle, shopAddressLine, shopCardDistance, shopHeroDistanceSuffix,
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

  it("fills the info strip with real cells only, capped at the three the layout has", () => {
    // 没定位、没有任何计数 ⇒ 整条不画，而不是三个「—」。
    expect(shopInfoCells(shop({ id: "j", name: "j" }))).toEqual([]);
    const cells = shopInfoCells(shop({ id: "k", name: "k", savedCount: 1, visitedCount: 2, hereCount: 3, latitude: 21.0288, longitude: 105.8525 }), HANOI_CENTER);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toEqual({ value: "0m", label: "步行约 1 分钟" });
    expect(cells[1]).toEqual({ value: "3 位", label: "此刻在这里" });
    expect(cells[2]).toEqual({ value: "1 人", label: "收藏了这个场景" });
    // 评分那一格没有数据源 ⇒ 不出现，也不写「—」。
    for (const cell of cells) {
      expect(cell.label).not.toContain("评分");
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
// 源码级：新那一屏必须**消费**纯模块，而且不许把原型里没有数据源的东西搬过来
// ---------------------------------------------------------------------------

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const componentRaw = readFileSync(fileURLToPath(new URL("./components/scene-shop-directory.tsx", import.meta.url)), "utf8");
const component = stripComments(componentRaw);

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
    expect(sceneActionSubtitle({ state: "ACCEPTS_APPLICATIONS", moneyMeaning: "报酬由你出" })).toBe("接受报名 · 报酬由你出");
    expect(sceneActionSubtitle({ state: "SOMETHING_NEW", moneyMeaning: "免费" })).toBe("免费");
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

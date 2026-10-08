// EXPLORE-REAL-001（2026-10-08）：动态 › 探索（surfaces/coffee-scenes.tsx）。
//
// 这一屏以前整屏是占位数据（假的人 / 假店铺与假评分 / 假活动 + 一行「示例数据」，
// 连网速·吸烟·空调·插座·噪音那排 LEGEND 与七个筛不动的 chip 都是编的）。现在它
// 三段全走真数据，所以这里守两件事：
//
//   ① **数字**：此刻多少人、评分多少条、活动还剩几场 —— 用户看得见的部分全走
//      行为断言（coffee-scenes-model 的纯函数），不靠 grep 文本钉。
//   ② **占位物不许回来**：那条「示例数据」提示、那些人名、那套假设施属性、那排
//      筛不动的 chip，用反向断言钉住（.tsx 在 vitest 里渲染不了，只能读源码）。
//
// 跟 SCENE-SHOP-DIRECTORY-001 / SEC-CATEGORY-ICONS-001 同一套做法：逻辑放纯 .ts
// 测行为，.tsx 只钉「走的是哪条路径 / 没有占位物」。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sceneCategoryEntries } from "../scene-category-entries";
import { formatShopDistance, sceneDistanceMeters } from "../scene-shop-directory";
import {
  EXPLORE_EMPTY_TEXT,
  EXPLORE_ERROR_TEXT,
  EXPLORE_LOADING_TEXT,
  EXPLORE_SECTION_TITLES,
  activityMetaLine,
  activityPeopleLine,
  activityStartMs,
  coffeeVenues,
  hereNowLine,
  hereNowScenes,
  loadExploreScenes,
  metaLine,
  photoUri,
  ratingLine,
  upcomingActivities,
  venueDistanceText,
  type ExploreActivity,
  type ExploreFetch,
  type ExploreScene,
} from "../coffee-scenes-model";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");
// 本仓的注释会解释「为什么删掉这些占位物」，被删的字面量原文也会出现在注释里。
// 不剥注释的话，把实现删掉、注释留着，断言照样绿（sec-category-icons.test.ts 同款）。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const surface = stripComments(read("./coffee-scenes.tsx"));

// 形状照抄 GET /v1/reality-scenes 的真实返回：四家咖啡 + 一个湖。
function venue(over: Partial<ExploreScene> & { id: string }): ExploreScene {
  return {
    name: over.id,
    area: "Cầu Giấy",
    type: "咖啡 · 动态场景",
    category: "商家",
    imageUrl: "",
    latitude: 21.0359,
    longitude: 105.7906,
    visitedCount: 0,
    ...over,
  };
}

const CAFE_PLAIN = venue({ id: "threebeans", name: "Three Beans · Cầu Giấy" });
const CAFE_HERE = venue({ id: "bacninh", name: "Three Beans · Bắc Ninh", area: "Bắc Ninh", hereCount: 2 });
const CAFE_BUSY = venue({ id: "lelong", name: "Lê Lộc Coffee", hereCount: 5, visitedCount: 9 });
const CAFE_RATED = venue({ id: "rated", name: "Rated Roasters", rating: 4.8, ratingCount: 12 });
const LAKE = venue({ id: "hoankiem", name: "Hồ Hoàn Kiếm", type: "公共景点 · 湖边", category: "景点" });
const CATALOG = [CAFE_PLAIN, CAFE_HERE, CAFE_BUSY, CAFE_RATED, LAKE] as const;

const HANOI_CENTER = { latitude: 21.0288, longitude: 105.8525 };

function activity(over: Partial<ExploreActivity> & { activityId: string }): ExploreActivity {
  return {
    title: over.activityId,
    time: "",
    venueName: "",
    joined: 0,
    ...over,
  };
}

function catalogFetch(body: unknown, status = 200): { impl: ExploreFetch; urls: string[] } {
  const urls: string[] = [];
  const impl: ExploreFetch = async (url: string) => {
    urls.push(url);
    // 多带一个 status（真实 fetch 有）—— 用变量返回，别写成对象字面量触发多余属性检查。
    const response = { ok: status >= 200 && status < 300, json: async () => body, status };
    return response;
  };
  return { impl, urls };
}

describe("EXPLORE-REAL-001 the catalog is the real public one, counts and all", () => {
  it("keeps the counts the layout needs — the wire fields SceneSpot drops", () => {
    // 这里就是为什么探索页不直接用 loadSceneSpots：SceneSpot 没有 hereCount /
    // rating / ratingCount，而「此刻」段与评分完全由它们决定（详见模型文件头）。
    const body = {
      scenes: [
        {
          id: "a", name: "Three Beans", area: "Cầu Giấy", type: "咖啡 · 动态场景", category: "商家",
          imageUrl: "", latitude: 21.03, longitude: 105.79, visitedCount: 3, hereCount: 2, savedCount: 1,
          rating: 4.8, ratingCount: 12,
        },
      ],
    };
    return loadExploreScenes(catalogFetch(body).impl, "http://api.test").then((rows) => {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "a", hereCount: 2, savedCount: 1, visitedCount: 3, rating: 4.8, ratingCount: 12 });
    });
  });

  it("reads the public endpoint — no login, no new route", () => {
    const call = catalogFetch({ scenes: [] });
    return loadExploreScenes(call.impl, "http://api.test/").then(() => {
      expect(call.urls).toEqual(["http://api.test/v1/reality-scenes"]);
    });
  });

  it("leaves a missing count undefined instead of padding it with 0", () => {
    // rating/ratingCount 服务端 omitempty：没评价时整对都不出现。补 0 就等于把
    // 「还没有人评过」说成「0 分」（0 只在**显示**口径里等于不画）。
    const body = { scenes: [{ id: "a", name: "A", area: "", type: "咖啡", category: "商家", imageUrl: "", latitude: 0, longitude: 0 }] };
    return loadExploreScenes(catalogFetch(body).impl, "http://api.test").then((rows) => {
      expect(rows[0]?.hereCount).toBeUndefined();
      expect(rows[0]?.rating).toBeUndefined();
      expect(rows[0]?.ratingCount).toBeUndefined();
      // visitedCount 缺 = 没有这个数，显示口径按 0（那一格不画）。
      expect(rows[0]?.visitedCount).toBe(0);
    });
  });

  it("drops one malformed record but keeps the rest", () => {
    const body = {
      scenes: [
        { id: "a", name: "A" },
        { nope: true },
        null,
        { id: "b", name: "B", area: "", type: "咖啡", category: "商家", imageUrl: "", latitude: 1, longitude: 2 },
      ],
    };
    return loadExploreScenes(catalogFetch(body).impl, "http://api.test").then((rows) => {
      expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    });
  });

  it("ignores a non-numeric count instead of rendering NaN", () => {
    const body = { scenes: [{ id: "a", name: "A", area: "", type: "咖啡", category: "商家", imageUrl: "", latitude: 0, longitude: 0, hereCount: "3" }] };
    return loadExploreScenes(catalogFetch(body).impl, "http://api.test").then((rows) => {
      expect(rows[0]?.hereCount).toBeUndefined();
      expect(hereNowLine(rows[0]?.hereCount)).toBe("");
    });
  });

  it("fails loudly when the catalog request fails", () => {
    // 静默回落成空列表 = 用户看到「附近没有店」，那是撒谎。
    return expect(loadExploreScenes(catalogFetch({}, 500).impl, "http://api.test")).rejects.toThrow();
  });
});

describe("EXPLORE-REAL-001 此刻 is exactly the venues with real check-ins", () => {
  it("lists the same coffee scenes the home entry card counts", () => {
    // 一处匹配词、两个消费者（首页入口卡的「N 家」与这里的行数）—— 不两处各写一遍。
    expect(coffeeVenues(CATALOG).map((scene) => scene.id)).toEqual(["threebeans", "bacninh", "lelong", "rated"]);
    expect(sceneCategoryEntries(CATALOG, [{ id: "coffee", label: "咖啡" }])[0]?.count).toBe(4);
  });

  it("keeps only hereCount > 0, busiest first", () => {
    expect(hereNowScenes(CATALOG).map((scene) => scene.id)).toEqual(["lelong", "bacninh"]);
  });

  it("is stable when two venues report the same head count", () => {
    const a = venue({ id: "aaa", hereCount: 2 });
    const b = venue({ id: "bbb", hereCount: 2 });
    expect(hereNowScenes([b, a]).map((scene) => scene.id)).toEqual(["aaa", "bbb"]);
    expect(hereNowScenes([a, b]).map((scene) => scene.id)).toEqual(["aaa", "bbb"]);
  });

  it("never renders a head count it does not have", () => {
    expect(hereNowLine(2)).toBe("2 人此刻在这里");
    expect(hereNowLine(1)).toBe("1 人此刻在这里");
    // 0 / 缺 / 负数 / NaN 一律整段不画，绝不是「0 人此刻在这里」。
    expect(hereNowLine(0)).toBe("");
    expect(hereNowLine(undefined)).toBe("");
    expect(hereNowLine(-3)).toBe("");
    expect(hereNowLine(Number.NaN)).toBe("");
  });

  it("shows no person names and no avatars — hereCount is an aggregate, not a roster", () => {
    expect(surface).not.toContain("Mia");
    expect(surface).not.toContain("Luna");
    expect(surface).not.toContain("Sara");
    expect(surface).not.toContain("已待");
    expect(surface).not.toContain("可陪");
    expect(surface).not.toContain("styles.sceneAvatar");
    expect(surface).not.toContain("styles.scenePerson");
  });
});

describe("EXPLORE-REAL-001 咖啡店 only claims what really exists", () => {
  it("renders the rating together with its count, and only then", () => {
    expect(ratingLine(CAFE_RATED)).toBe("★ 4.8 · 12 条评价");
    // 没人评过 = 整段不画（不是 0 分、也不是自己补一句「暂无评分」）。
    expect(ratingLine(CAFE_PLAIN)).toBe("");
    expect(ratingLine(venue({ id: "x", rating: 0, ratingCount: 5 }))).toBe("");
    expect(ratingLine(venue({ id: "y", rating: 4.5, ratingCount: 0 }))).toBe("");
  });

  it("shows a distance only from a real device fix", () => {
    expect(venueDistanceText(CAFE_PLAIN, undefined)).toBe("");
    const meters = sceneDistanceMeters(HANOI_CENTER, CAFE_PLAIN);
    expect(venueDistanceText(CAFE_PLAIN, HANOI_CENTER)).toBe(formatShopDistance(meters));
  });

  it("drops a distance that means nothing（不在附近）", () => {
    // SCENE-DISTANCE-FAR-001 同一口径：直线 11730km 对谁都没意义，不画。
    const saigon = venue({ id: "saigon", latitude: 10.8231, longitude: 106.6297 });
    expect(venueDistanceText(saigon, HANOI_CENTER)).toBe("");
  });

  it("renders the photo the scene really has, and no stand-in", () => {
    expect(photoUri("https://cdn.test/a.jpg", "http://api.test")).toBe("https://cdn.test/a.jpg");
    expect(photoUri("/v1/media/thumb/abc", "http://api.test/")).toBe("http://api.test/v1/media/thumb/abc");
    // 没图就是没图：不拿首字母或 emoji 顶替成一张图。
    expect(photoUri("", "http://api.test")).toBeUndefined();
    expect(photoUri("   ", "http://api.test")).toBeUndefined();
    expect(photoUri(undefined, "http://api.test")).toBeUndefined();
  });

  it("drops the invented attributes and the filters that could not filter", () => {
    for (const legend of ["无烟", "室外", "空调", "插座", "网速", "噪音", "标记说明", "新店开业", "适合办公", "热门", "高评分"]) {
      expect(surface, `编出来的属性/筛选项又回来了：${legend}`).not.toContain(legend);
    }
  });
});

describe("EXPLORE-REAL-001 活动 shows only real upcoming ones", () => {
  const NOW = new Date("2026-10-08T09:00:00Z");

  it("drops a cancelled activity (cancelled is a state, not an upcoming event)", () => {
    const cancelled = activity({ activityId: "c", title: "Cancelled", time: "2026-10-10T15:00", status: "CANCELLED" });
    expect(upcomingActivities([cancelled], NOW)).toHaveLength(0);
  });

  it("drops an activity whose start time has already passed", () => {
    const past = activity({ activityId: "p", title: "Past", time: "2026-10-07T15:00" });
    const future = activity({ activityId: "f", title: "Future", time: "2026-10-09T15:00" });
    expect(upcomingActivities([past, future], NOW).map((row) => row.activityId)).toEqual(["f"]);
  });

  it("keeps a free-text time instead of guessing that it already passed", () => {
    // activity.time 是发布者自己写的自由文本（「周六 15:00」）。猜不出它是不是已经
    // 过了就藏着 = 让「没发时间的活动」和「不存在」长得一样。
    const free = activity({ activityId: "t", title: "周六咖啡拉花体验课", time: "周六 15:00" });
    expect(activityStartMs(free)).toBeUndefined();
    expect(upcomingActivities([free], NOW).map((row) => row.activityId)).toEqual(["t"]);
  });

  it("never invents a start time out of prose", () => {
    expect(activityStartMs(activity({ activityId: "a", time: "下个月 3 号左右" }))).toBeUndefined();
    expect(activityStartMs(activity({ activityId: "b", time: "" }))).toBeUndefined();
    expect(activityStartMs(activity({ activityId: "c", time: "下周六下午" }))).toBeUndefined();
    // 真时间戳才给毫秒。
    expect(typeof activityStartMs(activity({ activityId: "d", time: "2026-10-09T15:00" }))).toBe("number");
  });

  it("sorts the dated ones by start time and keeps prose ones in server order", () => {
    const late = activity({ activityId: "late", time: "2026-10-20T15:00" });
    const soon = activity({ activityId: "soon", time: "2026-10-09T15:00" });
    const proseA = activity({ activityId: "pa", time: "周六 15:00" });
    const proseB = activity({ activityId: "pb", time: "周日 15:00" });
    expect(upcomingActivities([late, proseA, proseB, soon], NOW).map((row) => row.activityId)).toEqual(["soon", "late", "pa", "pb"]);
  });

  it("shows the venue and time exactly as stored", () => {
    expect(activityMetaLine(activity({ activityId: "a", venueName: "Proxy Coffee Roastery", time: "周六 15:00" }))).toBe(
      "Proxy Coffee Roastery · 周六 15:00"
    );
    expect(activityMetaLine(activity({ activityId: "b", time: "周六 15:00" }))).toBe("周六 15:00");
    expect(activityMetaLine(activity({ activityId: "c" }))).toBe("");
  });

  it("says joined / capacity, and no capacity means no quota — not 0 slots", () => {
    expect(activityPeopleLine(activity({ activityId: "a", joined: 3, capacity: 8 }))).toBe("已报名 3 / 8 人");
    expect(activityPeopleLine(activity({ activityId: "b", joined: 3 }))).toBe("已报名 3 人");
    // joined 是服务端权威计数：没人报名就说 0，不藏。
    expect(activityPeopleLine(activity({ activityId: "c", joined: 0 }))).toBe("已报名 0 人");
  });

  it("no longer shows the invented sample activity", () => {
    expect(surface).not.toContain("拉花体验课");
    expect(surface).not.toContain("示例数据");
    expect(surface).toContain("listActivities()");
  });
});

describe("EXPLORE-REAL-001 the copy on this surface is only titles and state lines", () => {
  it("joins the real bits and drops the empty ones", () => {
    expect(metaLine(["Cầu Giấy", "", "★ 4.8 · 12 条评价"])).toBe("Cầu Giấy · ★ 4.8 · 12 条评价");
    expect(metaLine(["", undefined])).toBe("");
    expect(metaLine([])).toBe("");
  });

  it("ships exactly three section titles", () => {
    expect(Object.values(EXPLORE_SECTION_TITLES)).toEqual(["此刻", "咖啡店", "活动"]);
  });

  it("gives every section its own honest empty line", () => {
    expect(Object.values(EXPLORE_EMPTY_TEXT)).toEqual([
      "此刻还没有人在咖啡店打卡",
      "还没有咖啡店场景",
      "还没有即将开始的活动",
    ]);
  });

  it("has one plain line for loading and one for failure — no spinner, no slogan", () => {
    expect(EXPLORE_LOADING_TEXT).toBe("正在加载…");
    expect(EXPLORE_ERROR_TEXT).toBe("加载失败，请稍后重试");
  });

  it("renders all three sections off the real loaders", () => {
    expect(surface).toContain("loadExploreScenes(fetch, localApiBaseUrl)");
    expect(surface).toContain(
      "new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore })"
    );
    expect(surface).toContain("getCurrentFix(expoLocationApi");
    for (const [key, title] of Object.entries(EXPLORE_SECTION_TITLES)) {
      expect(surface, `${title} 段没挂上标题常量`).toContain(`title={EXPLORE_SECTION_TITLES.${key}}`);
      expect(surface, `${title} 段没有自己的空态文案`).toContain(`emptyText={EXPLORE_EMPTY_TEXT.${key}}`);
    }
  });

  it("leaves no PLACEHOLDER constant and no sample-data banner behind", () => {
    expect(surface).not.toContain("PLACEHOLDER");
    expect(surface).not.toContain("示例数据");
  });
});
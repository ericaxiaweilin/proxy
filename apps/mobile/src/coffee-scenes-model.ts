// EXPLORE-REAL-001（2026-10-08）：动态 › 探索（surfaces/coffee-scenes.tsx 的
// CoffeeScenesHub）的**纯逻辑**。
//
// 这一屏以前整屏是占位数据：假的人（Mia / Luna / Sara）、假的店铺与假评分、假的
// 活动，外加一行常驻的「示例数据」提示 —— 组件头注释里写着「后端没有『谁在店里』
// 『店铺库』这些模型」。这个前提今天已经不成立：
//   · 店铺库 = 公开目录 GET /v1/reality-scenes（免登录），每条本来就带
//     hereCount（SCENE-CHECKIN-001 的真实打卡聚合）、rating / ratingCount
//     （SCENE-REVIEW-001 的真实评价聚合）、savedCount / visitedCount
//     （SCENE-REAL-COUNTS-001）。
//   · 活动 = ActivityClient.listActivities（匿名可读，同首页 For You 那份）。
// 所以下面没有一个数字是发明的：算不出来就是空串，调用方整块不画。
//
// 为什么单独一个 .ts（SCENE-SHOP-DIRECTORY-001 / SCENE-HOME-ENTRY-001 同款理由）：
// surfaces/*.tsx 被 react-native / Metro 的 asset require 拉进来，vitest import
// 不了，只能靠 grep 文本钉；而这里算的全是**用户看得见的数字与顺序**（「此刻
// 多少人」「评分多少」「还剩几场」）—— 最不能只靠文本钉守着的部分。
//
// ⚠️ 一条不许绕过的口径：评分/计数**缺数据就是没有**。服务端 rating /
// ratingCount 都带 omitempty（count == 0 时整对都不出现），只看 rating 会把
// 「还没有人评过」画成「0 分」；所以两个字段必须成对判断（复用 scene-shop-directory
// 的 shopRating），hereCount <= 0 一律不画这一段 —— 不是画成「0 人」。

import { parseSceneSpots, type SceneSpot } from "./activity-create-form";
import { scenesForAction } from "./scene-category-entries";
import {
  formatShopDistance,
  isFarAway,
  sceneDistanceMeters,
  shopRating,
  type SceneOrigin,
  type SceneShopBrief,
} from "./scene-shop-directory";

/**
 * 探索页要画的场景 = 公开目录里咖啡分类命中的那些（字段 = 目录返回的子集，
 * 计数全部可选）。直接复用场景目录那一份 Brief：多写一份形状就多一处会漂的
 * 真相（SCENE-HOME-ENTRY-001 头部同一件事）。
 */
export type ExploreScene = SceneShopBrief;

/** 与 `loadSceneSpots` 同一个 fetch 形状（公开 GET，免登录）。 */
export type ExploreFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** 探索页要画的活动字段（`Activity` 的子集；capacity 缺 = 这条不设名额）。 */
export type ExploreActivity = {
  activityId: string;
  title: string;
  time: string;
  venueName: string;
  joined: number;
  capacity?: number | undefined;
  status?: string | undefined;
};

// ---------------------------------------------------------------------------
// 加载：GET /v1/reality-scenes（公开、免登、同首页场景目录）
// ---------------------------------------------------------------------------

/** body 里每条场景的原始记录，按 id 索引（parseSceneSpots 会丢掉的计数从这里补）。 */
function rawScenesById(body: unknown): ReadonlyMap<string, Record<string, unknown>> {
  const list = Array.isArray((body as { scenes?: unknown } | undefined)?.scenes)
    ? (body as { scenes: unknown[] }).scenes
    : [];
  const out = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === "string") out.set(id, item as Record<string, unknown>);
  }
  return out;
}

/**
 * 把 tolerant 解析出的场景与原始计数对齐。
 *
 * 身份字段（id / name / area / type / 坐标 / 图）一律走 `parseSceneSpots` ——
 * 它是目录那条路的唯一一份容错解析（一条脏记录不能把整页变成「取不到」）。它
 * **不带** hereCount / rating / ratingCount（SceneSpot 没有这几个字段），而这一
 * 屏的「此刻」段与评分完全由它们决定，所以这里只补那几个可选数（hereCount /
 * savedCount / plannedCount / rating / ratingCount，都是服务端 omitempty 的）：
 * **只补服务端真的发下来的有限数字**，别的一律留 undefined（= 不画），不补 0
 * 充数。
 */
export function exploreScenesFrom(spots: readonly SceneSpot[], body: unknown): ExploreScene[] {
  const raw = rawScenesById(body);
  const numberAt = (id: string, field: string): number | undefined => {
    const value = raw.get(id)?.[field];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  return spots.map((spot) => {
    const visited = numberAt(spot.id, "visitedCount");
    const saved = numberAt(spot.id, "savedCount");
    const planned = numberAt(spot.id, "plannedCount");
    const here = numberAt(spot.id, "hereCount");
    const rating = numberAt(spot.id, "rating");
    const ratingCount = numberAt(spot.id, "ratingCount");
    return {
      id: spot.id,
      name: spot.name,
      area: spot.area,
      type: spot.type,
      category: spot.category,
      imageUrl: spot.imageUrl,
      latitude: spot.latitude,
      longitude: spot.longitude,
      // 目录没 visitedCount 就是「没有这个数」，而 0 在显示口径里等于不画 ——
      // 与场景目录那一份（hot-scenes / scene-shop-directory）同一处置。
      visitedCount: visited ?? 0,
      ...(saved === undefined ? {} : { savedCount: saved }),
      ...(planned === undefined ? {} : { plannedCount: planned }),
      ...(here === undefined ? {} : { hereCount: here }),
      ...(rating === undefined ? {} : { rating }),
      ...(ratingCount === undefined ? {} : { ratingCount }),
    };
  });
}

/**
 * 拉公开场景目录。同一个 URL / 同一个免登录口径 / 同一份容错解析 —— 不新加端点。
 * 失败就抛给调用方（那一段显示「加载失败」），不静默回落到空列表：空列表在用户
 * 眼里是「附近没有店」。
 */
export async function loadExploreScenes(fetchImpl: ExploreFetch, baseUrl: string): Promise<ExploreScene[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/reality-scenes`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`scene catalog status ${(response as { status?: unknown }).status ?? "?"}`);
  const body = await response.json();
  return exploreScenesFrom(parseSceneSpots(body), body);
}

// ---------------------------------------------------------------------------
// 分段
// ---------------------------------------------------------------------------

/**
 * 咖啡店段：只留咖啡分类命中的真实场景。
 *
 * 复用首页入口卡那一份 `scenesForAction` —— 「N 家」和点进来看到的行数必须是同
 * 一批场景，两处各写一遍子串匹配迟早对不上（SCENE-SHOP-DIRECTORY-001）。
 */
export function coffeeVenues(scenes: readonly ExploreScene[]): readonly ExploreScene[] {
  return scenesForAction(scenes, "coffee");
}

/** 真实计数：非数字/负数一律按 0（跟场景目录那一份 realCount 同口径）。 */
function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 此刻段：hereCount > 0 的场景，按此刻在场人数**降序**，同数以 id 兜底 ——
 * 否则两次渲染之间顺序自己换位，用户会以为点错了。
 *
 * 不画人名/头像是有意的：`hereCount` 是「声明自己此刻在这里的人数」这个**聚合**，
 * 公开目录里没有、也不该有「是谁」（SCENE-CHECKIN-001 明确不许带出）。
 */
export function hereNowScenes(scenes: readonly ExploreScene[]): readonly ExploreScene[] {
  return scenes
    .filter((scene) => count(scene.hereCount) > 0)
    .sort((a, b) => count(b.hereCount) - count(a.hereCount) || byId(a, b));
}

// ---------------------------------------------------------------------------
// 文案（没有数据的整段不画，所以每个都返回空串而不是「0 人」/「—」）
// ---------------------------------------------------------------------------

/** 把若干段拼成一行；空段丢掉，全空 → 空串（调用方整行不画）。 */
export function metaLine(parts: ReadonlyArray<string | undefined>): string {
  return parts.map((part) => (part ?? "").trim()).filter((part) => part !== "").join(" · ");
}

/** 「N 人此刻在这里」；没有人在此刻 → 空串（不是「0 人」）。 */
export function hereNowLine(hereCount: number | undefined): string {
  const here = count(hereCount);
  return here > 0 ? `${here} 人此刻在这里` : "";
}

/**
 * 评分那一段：「★ 4.8 · 12 条评价」。
 *
 * 只有 ratingCount > 0 才成段 —— 服务端没评价时 rating/ratingCount 整对都不
 * 出现，只看 rating 会把「还没有人评过」画成 0 分（scene-shop-directory 的
 * shopRating 正是这条闸，已被钉在测试里）。
 */
export function ratingLine(scene: ExploreScene): string {
  const rating = shopRating(scene);
  return rating ? `★ ${rating.stars} · ${rating.count} 条评价` : "";
}

/**
 * 距离：**只有真的拿到设备定位、且不算「不在附近」时才有**。
 * 没定位 → 空串（不拿河内市中心当「你的位置」，那会把所有距离都算成假的）；
 * 超过 FAR_AWAY_METERS → 空串（直线距离 11730km 对谁都没意义）。
 */
export function venueDistanceText(scene: ExploreScene, origin: SceneOrigin | undefined): string {
  const meters = sceneDistanceMeters(origin, scene);
  return isFarAway(meters) ? "" : formatShopDistance(meters);
}

/**
 * 真实照片的绝对 URL。相对路径按目录那一条规则拼 base；拼不出来（空串 / 协议
 * 不认识）→ undefined —— 调用方整格不画，**不**拿首字母或 emoji 顶替成一张图。
 */
export function photoUri(imageUrl: string | undefined, baseUrl: string): string | undefined {
  const trimmed = (imageUrl ?? "").trim();
  if (trimmed === "") return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (baseUrl.trim() === "") return undefined;
  return `${baseUrl.replace(/\/$/, "")}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

// ---------------------------------------------------------------------------
// 活动
// ---------------------------------------------------------------------------

/**
 * 只认**真的可解析**的时间戳（ISO 日期开头）。`activity.time` 是发布者自己写的
 * 自由文本（「周六 15:00」这类），`Date.parse` 对它返回 NaN —— 那时候返回
 * undefined，调用方就**不**拿它判断过去/未来（见 upcomingActivities）。
 */
const ISO_START = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})/;

/** 能解析出时刻就返回毫秒时间戳；自由文本 / 不可解析 → undefined。 */
export function activityStartMs(activity: ExploreActivity): number | undefined {
  const time = activity.time.trim();
  if (!ISO_START.test(time)) return undefined;
  const ms = Date.parse(time.replace(" ", "T"));
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * 「即将开始」的真实活动。
 *
 * 两条过滤，都只用服务端真的给的字段：
 *   · status == CANCELLED —— 取消的活动不是「即将开始」（取消是状态位，不是删除）。
 *   · 能解析出时刻且已经过去 —— 已经开场/结束的别再往前推。
 * **解析不出时刻的留着**：time 是自由文本，猜不出它是不是已经过了，藏起来等于
 * 让「没发时间的活动」和「不存在」长得一样。
 *
 * 顺序：能解析的按开始时刻升序在前（真的最近的一件排最前），解析不出的按服务端
 * 原序接在后面 —— 原序也是稳定的，不自己重排。
 */
export function upcomingActivities<T extends ExploreActivity>(list: readonly T[], now: Date): readonly T[] {
  const current = now.getTime();
  const kept = list.filter((activity) => {
    if (activity.status === "CANCELLED") return false;
    const start = activityStartMs(activity);
    return start === undefined || start >= current;
  });
  const dated = kept.filter((activity) => activityStartMs(activity) !== undefined);
  const undated = kept.filter((activity) => activityStartMs(activity) === undefined);
  return [
    ...dated.sort((a, b) => (activityStartMs(a) ?? 0) - (activityStartMs(b) ?? 0) || a.activityId.localeCompare(b.activityId)),
    ...undated,
  ];
}

/** 活动那一行：地点 + 时间，**照服务端存的原样**（time 是自由文本，不改写）。 */
export function activityMetaLine(activity: ExploreActivity): string {
  return metaLine([activity.venueName, activity.time]);
}

/**
 * 报名人数：`已报名 3 / 8 人`。capacity 缺 = 这条活动不设名额（不是 0 名额），
 * 那就只说 `已报名 3 人`。joined 是服务端权威计数，0 就照实写 0。
 */
export function activityPeopleLine(activity: ExploreActivity): string {
  const joined = count(activity.joined);
  const capacity = count(activity.capacity);
  return capacity > 0 ? `已报名 ${joined} / ${capacity} 人` : `已报名 ${joined} 人`;
}

// ---------------------------------------------------------------------------
// 三段的标题 / 空态 / 加载 / 失败文案
//
// 放在这里而不是散在 JSX 里，是为了让「这一屏一共说了哪几句话」有一处可查、可
// 钉的地方。文案上限：每段一个标题 + 空/加载/失败各一行，一句宣传语都不加。
// ---------------------------------------------------------------------------

export const EXPLORE_SECTION_TITLES = {
  here: "此刻",
  coffee: "咖啡店",
  activities: "活动",
} as const;

export const EXPLORE_EMPTY_TEXT = {
  here: "此刻还没有人在咖啡店打卡",
  coffee: "还没有咖啡店场景",
  activities: "还没有即将开始的活动",
} as const;

export const EXPLORE_LOADING_TEXT = "正在加载…";
export const EXPLORE_ERROR_TEXT = "加载失败，请稍后重试";
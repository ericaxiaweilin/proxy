// SITE-SEARCH-001：全站搜索的编排层 —— 把 site-search.ts 的纯逻辑接到真实客户端上。
//
// 一次搜索同时问六个来源（人 / 活动 / 场景 / 机会 / 我的订单 / 动态），**每个来源独立成败**：
// 动态服务挂了，人和活动照常出结果，只在结果里如实标出「动态暂时没搜到」——
// 绝不因为一个来源失败就整页报错，更不能把「没查到」显示成「没有」（那是本仓最忌讳的假空态）。
//
// 三类「不是没有，而是没法查」如实分开报告，界面各自有各自的文案：
//   · failed     —— 来源出错了（网络 / 服务端），可以重试；
//   · needsLogin —— 访客搜不了人（服务端 SearchProfiles 要求登录）和「我的订单」；
//   · tooShort   —— 人物搜索不足 2 个码点（与服务端 MinProfileSearchQuery 同口径）。
// 公开浏览不需要账号：活动 / 场景 / 机会 / 动态对访客照常可搜。
import type { FeedPost } from "@proxy/contracts";
import {
  activityHits,
  isNumberQuery,
  opportunityHits,
  orderHits,
  personHits,
  personQueryLongEnough,
  placeHits,
  postHits,
  SITE_SEARCH_KINDS,
  stripHandleAt,
  type SearchableActivity,
  type SearchableFulfillmentOrder,
  type SearchableJoinOrder,
  type SearchableOpportunity,
  type SearchableProfile,
  type SearchableScene,
  type SiteSearchHit,
  type SiteSearchKind,
  type SiteSearchScope,
} from "./site-search";

export type SiteSearchSources = {
  /** 已登录（有账号）。访客搜不了人和订单。 */
  signedIn: boolean;
  searchProfiles?: ((query: string) => Promise<readonly SearchableProfile[]>) | undefined;
  searchPosts?: ((query: string) => Promise<readonly FeedPost[]>) | undefined;
  listActivities?: (() => Promise<readonly SearchableActivity[]>) | undefined;
  listOpportunities?: (() => Promise<readonly SearchableOpportunity[]>) | undefined;
  listScenes?: (() => Promise<readonly SearchableScene[]>) | undefined;
  listMyOrders?: (() => Promise<readonly SearchableFulfillmentOrder[]>) | undefined;
  listMyJoinOrders?: (() => Promise<readonly SearchableJoinOrder[]>) | undefined;
};

export type SiteSearchOutcome = {
  query: string;
  scope: SiteSearchScope;
  hits: SiteSearchHit[];
  failed: SiteSearchKind[];
  needsLogin: SiteSearchKind[];
  tooShort: SiteSearchKind[];
};

/** 全部范围下要问哪些来源。编号查询（客服报号）只问带编号的三类，别去扫人和动态。 */
export function kindsToSearch(scope: SiteSearchScope, rawQuery: string): readonly SiteSearchKind[] {
  if (scope !== "all") return [scope];
  return isNumberQuery(rawQuery) ? ["order", "activity", "opportunity"] : SITE_SEARCH_KINDS;
}

/** 来源结果 → 命中，或者标记失败。来源没接线（undefined）时静默跳过，仅供测试与未来裁剪用。 */
async function settle<T>(run: (() => Promise<T>) | undefined): Promise<{ ok: true; value: T } | { ok: false } | undefined> {
  if (!run) return undefined;
  try {
    return { ok: true, value: await run() };
  } catch {
    return { ok: false };
  }
}

export async function runSiteSearch(
  sources: SiteSearchSources,
  rawQuery: string,
  scope: SiteSearchScope,
): Promise<SiteSearchOutcome> {
  const query = rawQuery.trim();
  const outcome: SiteSearchOutcome = { query, scope, hits: [], failed: [], needsLogin: [], tooShort: [] };
  if (query === "") return outcome;

  const kinds = kindsToSearch(scope, query);
  const wants = (kind: SiteSearchKind): boolean => kinds.includes(kind);

  const personQuery = stripHandleAt(query);
  const personRun = wants("person")
    ? !sources.signedIn
      ? (outcome.needsLogin.push("person"), undefined)
      : !personQueryLongEnough(query)
        ? (outcome.tooShort.push("person"), undefined)
        : sources.searchProfiles
          ? () => sources.searchProfiles!(personQuery)
          : undefined
    : undefined;

  const orderWanted = wants("order");
  if (orderWanted && !sources.signedIn) outcome.needsLogin.push("order");
  const orderRun = orderWanted && sources.signedIn ? sources.listMyOrders : undefined;
  const joinRun = orderWanted && sources.signedIn ? sources.listMyJoinOrders : undefined;

  const [people, posts, activities, opportunities, scenes, orders, joins] = await Promise.all([
    settle(personRun),
    settle(wants("post") ? (sources.searchPosts ? () => sources.searchPosts!(query) : undefined) : undefined),
    settle(wants("activity") ? sources.listActivities : undefined),
    settle(wants("opportunity") ? sources.listOpportunities : undefined),
    settle(wants("place") ? sources.listScenes : undefined),
    settle(orderRun),
    settle(joinRun),
  ]);

  const hits: SiteSearchHit[] = [];
  const fail = (kind: SiteSearchKind): void => {
    if (!outcome.failed.includes(kind)) outcome.failed.push(kind);
  };

  if (people) people.ok ? hits.push(...personHits(people.value, query)) : fail("person");
  if (posts) posts.ok ? hits.push(...postHits(posts.value, query)) : fail("post");
  if (activities) activities.ok ? hits.push(...activityHits(activities.value, query)) : fail("activity");
  if (opportunities) opportunities.ok ? hits.push(...opportunityHits(opportunities.value, query)) : fail("opportunity");
  if (scenes) scenes.ok ? hits.push(...placeHits(scenes.value, query)) : fail("place");

  // 订单有两个来源（接单/下单订单 + 活动报名订单）。一个挂了另一个的结果照给，
  // 但订单类仍标 failed —— 「可能少了几条」也是要说的实话。
  if (orders || joins) {
    const orderList = orders?.ok ? orders.value : [];
    const joinList = joins?.ok ? joins.value : [];
    hits.push(...orderHits(orderList, joinList, query));
    if (orders?.ok === false || joins?.ok === false) fail("order");
  }

  outcome.hits = hits;
  return outcome;
}

// ---------------------------------------------------------------------------
// 缓存：活动 / 机会 / 场景 / 订单是「整表拉下来本地过滤」，边输边搜不能每个字都重拉一遍。
// ---------------------------------------------------------------------------

/** 带 TTL 的异步缓存。失败不缓存（下次输入自动重试），并发调用共用同一个在途 promise。 */
export function cachedLoader<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let entry: { at: number; value: Promise<T> } | undefined;
  return () => {
    const current = now();
    if (entry && current - entry.at < ttlMs) return entry.value;
    const value = load();
    entry = { at: current, value };
    value.catch(() => {
      if (entry?.value === value) entry = undefined;
    });
    return value;
  };
}

/** 公开列表（活动 / 机会 / 场景）变化慢，缓存久一点；我的订单刚下完单就要搜得到，缓存短一点。 */
export const PUBLIC_LIST_TTL_MS = 60_000;
export const MY_ORDERS_TTL_MS = 10_000;

// ---------------------------------------------------------------------------
// 场景目录（GET /v1/reality-scenes，公开免登）。只留 active 的：下线的场景搜到点进去是空的。
// ---------------------------------------------------------------------------

export function parseSearchableScenes(body: unknown): SearchableScene[] {
  const list = (body as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(list)) throw new Error("scene catalog malformed");
  const out: SearchableScene[] = [];
  for (const item of list as Array<Record<string, unknown> | null>) {
    if (!item || typeof item.id !== "string" || item.id === "" || typeof item.name !== "string" || item.active !== true) continue;
    out.push({
      id: item.id,
      name: item.name,
      area: typeof item.area === "string" ? item.area : undefined,
      type: typeof item.type === "string" ? item.type : undefined,
      category: typeof item.category === "string" ? item.category : undefined,
    });
  }
  return out;
}

export async function loadSearchableScenes(
  fetchImpl: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>,
  baseUrl: string,
): Promise<SearchableScene[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/reality-scenes`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`scene catalog status ${response.status ?? "?"}`);
  return parseSearchableScenes(await response.json());
}

// ---------------------------------------------------------------------------
// 真实客户端 → 来源。用结构类型而不是 import 客户端类，测试里直接喂假客户端。
// ---------------------------------------------------------------------------

export type SiteSearchClients = {
  isGuest: boolean;
  profile?: { searchProfiles(query: string, limit?: number): Promise<readonly SearchableProfile[]> } | undefined;
  localNet?: { listFeedPosts(cursor?: string, limit?: number, searchQuery?: string): Promise<{ posts: readonly FeedPost[] }> } | undefined;
  activities?: {
    listActivities(): Promise<readonly SearchableActivity[]>;
    listMyActivities(): Promise<{ joinOrders: readonly SearchableJoinOrder[] }>;
  } | undefined;
  marketplace?: { list(): Promise<readonly SearchableOpportunity[]> } | undefined;
  fulfillment?: { listMyOrders(): Promise<readonly SearchableFulfillmentOrder[]> } | undefined;
  /** 公开场景目录（GET /v1/reality-scenes）。 */
  listScenes?: (() => Promise<readonly SearchableScene[]>) | undefined;
};

/** 每页动态最多取几条：搜索预览用，不是翻页列表。 */
export const POST_SEARCH_LIMIT = 12;
export const PERSON_SEARCH_LIMIT = 10;

export function buildSiteSearchSources(clients: SiteSearchClients, now: () => number = Date.now): SiteSearchSources {
  const { profile, localNet, activities, marketplace, fulfillment, listScenes } = clients;
  const myActivities = activities ? cachedLoader(() => activities.listMyActivities(), MY_ORDERS_TTL_MS, now) : undefined;
  return {
    signedIn: !clients.isGuest,
    searchProfiles: profile ? (query) => profile.searchProfiles(query, PERSON_SEARCH_LIMIT) : undefined,
    searchPosts: localNet
      ? async (query) => (await localNet.listFeedPosts(undefined, POST_SEARCH_LIMIT, query)).posts
      : undefined,
    listActivities: activities ? cachedLoader(() => activities.listActivities(), PUBLIC_LIST_TTL_MS, now) : undefined,
    listOpportunities: marketplace ? cachedLoader(() => marketplace.list(), PUBLIC_LIST_TTL_MS, now) : undefined,
    listScenes: listScenes ? cachedLoader(listScenes, PUBLIC_LIST_TTL_MS, now) : undefined,
    listMyOrders: fulfillment ? cachedLoader(() => fulfillment.listMyOrders(), MY_ORDERS_TTL_MS, now) : undefined,
    listMyJoinOrders: myActivities ? async () => (await myActivities()).joinOrders : undefined,
  };
}

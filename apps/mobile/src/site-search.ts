// SITE-SEARCH-001：全站搜索的纯逻辑（归一 / 打分 / 分组 / 各类实体 → 命中行）。
//
// 为什么单独一个 .ts：`surfaces/*.tsx` 会被 react-native 的 asset require 拉进来，
// vitest 根本 import 不了；而这里算的是**用户看得见的结论**——「搜到了什么」「谁排前面」
// 「为什么没搜到」——只靠 grep 文本钉不住。同 scene-shop-directory.ts / feed-search.ts
// 的做法：逻辑放纯模块，JSX 与网络留在别处（site-search-service.ts / surfaces/site-search.tsx）。
//
// 修的是什么：修之前每个「搜索」按钮各搜各的——
//   · 首页搜索框只在 For You 四宫格那几个推荐实体里匹配，什么都没命中就落到死胡同
//     文案「没有找到“{q}”」，用户连活动/机会/场景/帖子有没有都不知道；
//   · 动态页只搜已加载的帖子，消息页只搜会话，「我的」只搜自己的主页，
//     场景页只搜场景，市场页只搜活动——五个按钮五套范围，谁也不是「全站」。
// 现在它们共用一个入口：同一句话同时问 人 / 活动 / 场景 / 机会 / 我的订单 / 动态。
//
// 三条不能丢的规矩（每条都有对应测试）：
//   1. **没有的东西不编**。某个来源失败/未登录/查询太短，结果里如实标出来
//      （failed / needsLogin / tooShort），绝不把「没查」说成「没有」。
//   2. **订单只搜自己的**。订单来源永远是 viewer 自己的 listMyOrders / listMyActivities，
//      别人的订单编号搜不到——这里根本没有任何全站订单查询。
//   3. **已取消的活动不出现在搜索结果里**（它已经不能报名了，搜到只会误导）。
//      订单是历史记录，取消的订单仍可搜到，并带状态角标。

import type { Activity, ActivityJoinOrder, FeedPost, MarketOpportunity } from "@proxy/contracts";
import { postMatchesFeedSearch, normalizeFeedSearchQuery } from "./feed-search";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type SiteSearchKind = "person" | "activity" | "place" | "opportunity" | "order" | "post";
export type SiteSearchScope = "all" | SiteSearchKind;

export const SITE_SEARCH_KINDS: readonly SiteSearchKind[] = ["person", "activity", "place", "opportunity", "order", "post"];
export const SITE_SEARCH_SCOPES: readonly SiteSearchScope[] = ["all", ...SITE_SEARCH_KINDS];

export function isSiteSearchScope(value: string): value is SiteSearchScope {
  return (SITE_SEARCH_SCOPES as readonly string[]).includes(value);
}

/** 一条命中。导航需要的少量附加信息用可选字段带上，避免点开时再查一遍。 */
export type SiteSearchHit = {
  kind: SiteSearchKind;
  /** `${kind}:${id}` —— 列表 key；同一实体在同一次搜索里只会出现一次。 */
  key: string;
  /** 实体主键：userAccountId / activityId / sceneId / opportunityId / orderId / postId。 */
  id: string;
  title: string;
  /** 副标题（地点·时间 / @handle·城市 …）；没有就是空串，不画。 */
  subtitle: string;
  /** 右侧角标代码（订单状态 / OWNED）；没有就是 undefined，不画。文案由界面按当前语言翻译。 */
  badge?: SiteSearchBadge | undefined;
  /** 订单 / 机会 / 活动的面向人的全数字编号；界面在副标题里带上，方便对照客服口中的号。 */
  number?: string | undefined;
  score: number;
  /** person：头像路径 / 城市，供打开他人主页时带过去。 */
  avatarPath?: string | undefined;
  city?: string | undefined;
  /** order：fulfillment = 接单/下单订单；activityJoin = 活动报名订单（点开进活动详情）。 */
  orderKind?: "FULFILLMENT" | "ACTIVITY_JOIN" | undefined;
  /** order(activityJoin) / post(引用活动) 时的活动 id。 */
  activityId?: string | undefined;
  /** post：作者 id，供进动态页后定位。 */
  authorId?: string | undefined;
};

export type SiteSearchBadge =
  | "OWNED"
  | "OFFERED" | "CONFIRMED" | "EXECUTING" | "COMPLETED" | "CANCELLED"
  | "REQUESTED" | "WAITLISTED" | "ATTENDED" | "NO_SHOW";

const ORDER_BADGES: readonly SiteSearchBadge[] = [
  "OFFERED", "CONFIRMED", "EXECUTING", "COMPLETED", "CANCELLED", "REQUESTED", "WAITLISTED", "ATTENDED", "NO_SHOW",
];

/** 未知状态返回 undefined（不画角标），不把英文枚举原样甩给用户。 */
export function orderBadge(state: string | undefined): SiteSearchBadge | undefined {
  return ORDER_BADGES.find((badge) => badge === state);
}

export type SiteSearchGroup = {
  kind: SiteSearchKind;
  /** 该类命中的总数（可能大于 hits.length）。 */
  total: number;
  hits: SiteSearchHit[];
  /** total > hits.length —— 全部范围下用来出「查看全部」。 */
  hasMore: boolean;
};

// ---------------------------------------------------------------------------
// 归一 / 分词
// ---------------------------------------------------------------------------

/**
 * 折叠到可比较形态：全角转半角（NFKC）、小写、去越南语/拉丁变音符号、đ→d、压空白。
 *
 * 越南语是这个 app 的主力语言之一：用户键入「ha noi」必须找得到「Hà Nội」，
 * 键入「cafe」必须找得到「Café」。CJK 与谚文不受影响（变音符号区间只覆盖拉丁组合符，
 * 末尾 NFC 把谚文重新合成回音节）。
 */
export function foldSiteText(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** 查询按空白切词；每个词都要命中（AND）。 */
export function siteQueryTokens(raw: string): string[] {
  const folded = foldSiteText(raw);
  return folded === "" ? [] : folded.split(" ");
}

/** 去掉前导 @ —— 「@linh」和「linh」在人物搜索里是同一个意思。 */
export function stripHandleAt(raw: string): string {
  return raw.trim().replace(/^@+/, "").trim();
}

/** 与服务端 MinProfileSearchQuery 同口径（码点数，不是字节数，不是 UTF-16 单元）。 */
export const MIN_PERSON_QUERY_CODE_POINTS = 2;

export function codePointLength(raw: string): number {
  return [...raw.trim()].length;
}

/** 人物搜索是否够长。前导 @ 不计入长度（服务端也是先归一 handle 再比）。 */
export function personQueryLongEnough(raw: string): boolean {
  return codePointLength(stripHandleAt(raw)) >= MIN_PERSON_QUERY_CODE_POINTS;
}

/**
 * 纯数字查询（允许中间有空格 / 连字符 / 前导 #，客服报号时常这样断开）。
 * 返回归一后的数字串；不是纯数字返回 undefined。
 */
export function digitsOfQuery(raw: string): string | undefined {
  const compact = raw.trim().replace(/^#/, "").replace(/[\s-]+/g, "");
  return /^[0-9]+$/.test(compact) ? compact : undefined;
}

/**
 * 「像编号」的查询：≥ 6 位纯数字。更短的数字（「2」「300」）多半是在搜时间/价格，
 * 拿去扫订单号只会满屏噪音，所以不进编号通道，只走普通文本匹配。
 */
export const MIN_NUMBER_QUERY_DIGITS = 6;

export function isNumberQuery(raw: string): boolean {
  const digits = digitsOfQuery(raw);
  return digits !== undefined && digits.length >= MIN_NUMBER_QUERY_DIGITS;
}

// ---------------------------------------------------------------------------
// 打分
// ---------------------------------------------------------------------------

const EXACT = 100;
const PREFIX = 80;
const WORD_START = 70;
const CONTAINS = 55;
/** 字段越靠后权重越低（第 0 个是主字段，如标题）。 */
const FIELD_PENALTY = 3;

/**
 * 多字段文本打分。`fields` 按重要性排序（标题在前）。
 * 每个词取它命中的最好字段；任何一个词完全没命中 → 0（整条不算命中）。
 * 返回值 0 = 不命中，>0 = 命中，越大越靠前。
 */
export function scoreFields(fields: ReadonlyArray<string | undefined>, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const folded = fields.map((field) => foldSiteText(field));
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (let index = 0; index < folded.length; index += 1) {
      const field = folded[index]!;
      if (field === "") continue;
      let base = 0;
      if (field === token) base = EXACT;
      else if (field.startsWith(token)) base = PREFIX;
      else if (field.includes(` ${token}`)) base = WORD_START;
      else if (field.includes(token)) base = CONTAINS;
      if (base === 0) continue;
      best = Math.max(best, Math.max(1, base - index * FIELD_PENALTY));
    }
    if (best === 0) return 0;
    total += best;
  }
  return Math.round(total / tokens.length);
}

/** 编号打分：整号 > 号头 > 尾号（客服常报后 6~8 位）> 中段。 */
export function scoreNumber(digits: string, number: string | undefined): number {
  if (!number || digits === "") return 0;
  if (number === digits) return EXACT;
  if (number.startsWith(digits)) return 90;
  if (number.endsWith(digits)) return 85;
  if (number.includes(digits)) return 60;
  return 0;
}

/**
 * 服务端头像路径（`assets/<id>`）→ 缩略图相对路径。
 * 与首页 profileWireToPerson 同口径：`avatar-` 开头的是内置占位头像，不是上传的媒体，
 * 没有对应的 /v1/media/thumb；拿不到就返回 undefined，界面回落首字母，不猜不编。
 */
export function avatarThumbPath(avatarPath: string | undefined): string | undefined {
  if (!avatarPath || !avatarPath.startsWith("assets/")) return undefined;
  const id = avatarPath.slice("assets/".length).trim();
  if (id === "" || id.startsWith("avatar-")) return undefined;
  return `/v1/media/thumb/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// 各类实体 → 命中行
// ---------------------------------------------------------------------------

function hit(base: Omit<SiteSearchHit, "key">): SiteSearchHit {
  return { ...base, key: `${base.kind}:${base.id}` };
}

/** 服务端 ProfileWire 的子集 —— 结构兼容，测试里直接喂字面量。 */
export type SearchableProfile = {
  userAccountId: string;
  name: string;
  handle: string;
  bio?: string | undefined;
  city?: string | undefined;
  avatarPath?: string | undefined;
};

/**
 * 服务端已按 name / handle 过滤过；这里只是**排序**（精确名字 > 前缀 > 包含）。
 * 服务端认可的人不能在这里被丢掉，所以分数 floor 到 1。
 */
export function personHits(profiles: readonly SearchableProfile[], rawQuery: string): SiteSearchHit[] {
  const tokens = siteQueryTokens(stripHandleAt(rawQuery));
  const seen = new Set<string>();
  const out: SiteSearchHit[] = [];
  for (const profile of profiles) {
    if (!profile.userAccountId || seen.has(profile.userAccountId)) continue;
    seen.add(profile.userAccountId);
    const handle = profile.handle.replace(/^@+/, "");
    const title = profile.name || (handle ? `@${handle}` : profile.userAccountId);
    const score = Math.max(1, scoreFields([profile.name, handle, profile.bio, profile.city], tokens));
    out.push(hit({
      kind: "person",
      id: profile.userAccountId,
      title,
      subtitle: [handle ? `@${handle}` : "", profile.city ?? ""].filter(Boolean).join(" · "),
      score,
      avatarPath: profile.avatarPath || undefined,
      city: profile.city || undefined,
    }));
  }
  return out;
}

export type SearchableActivity = Pick<Activity, "activityId" | "title" | "venueName" | "desc" | "time" | "venueTypeLabel"> & {
  code?: string | undefined;
  theme?: string | undefined;
  merchantName?: string | undefined;
  status?: "PUBLISHED" | "CANCELLED" | undefined;
};

export function activityHits(activities: readonly SearchableActivity[], rawQuery: string): SiteSearchHit[] {
  const tokens = siteQueryTokens(rawQuery);
  const digits = isNumberQuery(rawQuery) ? digitsOfQuery(rawQuery) : undefined;
  const out: SiteSearchHit[] = [];
  for (const activity of activities) {
    // 已取消的活动不能报名，搜到只会误导（规矩 3）。
    if (activity.status === "CANCELLED") continue;
    const score = digits !== undefined
      ? scoreNumber(digits, activity.code)
      : scoreFields([activity.title, activity.venueName, activity.theme, activity.merchantName, activity.venueTypeLabel, activity.desc], tokens);
    if (score === 0) continue;
    out.push(hit({
      kind: "activity",
      id: activity.activityId,
      title: activity.title,
      subtitle: [activity.venueName, activity.time].filter(Boolean).join(" · "),
      number: activity.code || undefined,
      score,
      activityId: activity.activityId,
    }));
  }
  return out;
}

export type SearchableScene = {
  id: string;
  name: string;
  type?: string | undefined;
  category?: string | undefined;
  area?: string | undefined;
};

export function placeHits(scenes: readonly SearchableScene[], rawQuery: string): SiteSearchHit[] {
  const tokens = siteQueryTokens(rawQuery);
  const out: SiteSearchHit[] = [];
  for (const scene of scenes) {
    const score = scoreFields([scene.name, scene.area, scene.type, scene.category], tokens);
    if (score === 0) continue;
    out.push(hit({
      kind: "place",
      id: scene.id,
      title: scene.name,
      subtitle: [scene.area, scene.type].filter(Boolean).join(" · "),
      score,
    }));
  }
  return out;
}

export type SearchableOpportunity = Pick<MarketOpportunity, "id" | "title" | "shortTitle" | "theme" | "location" | "owner" | "skills" | "date" | "time"> & {
  number?: string | undefined;
  desc?: string | undefined;
  ownedByViewer?: boolean | undefined;
};

export function opportunityHits(opportunities: readonly SearchableOpportunity[], rawQuery: string): SiteSearchHit[] {
  const tokens = siteQueryTokens(rawQuery);
  const digits = isNumberQuery(rawQuery) ? digitsOfQuery(rawQuery) : undefined;
  const out: SiteSearchHit[] = [];
  for (const item of opportunities) {
    const score = digits !== undefined
      ? scoreNumber(digits, item.number)
      : scoreFields([item.title, item.shortTitle, item.theme, item.location, item.skills, item.owner, item.desc], tokens);
    if (score === 0) continue;
    out.push(hit({
      kind: "opportunity",
      id: item.id,
      title: item.title,
      subtitle: [item.location, [item.date, item.time].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
      ...(item.ownedByViewer ? { badge: "OWNED" as const } : {}),
      number: item.number || undefined,
      score,
    }));
  }
  return out;
}

export type SearchableFulfillmentOrder = {
  orderId: string;
  orderNo?: string | undefined;
  lifecycle: string;
  snapshot: {
    serviceSku: string;
    requester: string;
    agent: string;
    meetingContext: string;
    startTime: string;
  };
};

export type SearchableJoinOrder = Pick<ActivityJoinOrder, "activityId"> & {
  orderNo?: string | undefined;
  state?: string | undefined;
  snapshot?: {
    activity: { title: string; venueName?: string | undefined; time?: string | undefined };
    companion?: { name: string } | undefined;
    place?: { name: string } | undefined;
  } | undefined;
};

/**
 * 订单命中：接单/下单订单 + 活动报名订单。来源只可能是 viewer 自己的列表（规矩 2）。
 * 数字查询走编号通道（orderNo），文字查询走服务/对手方/活动名。
 */
export function orderHits(
  orders: readonly SearchableFulfillmentOrder[],
  joinOrders: readonly SearchableJoinOrder[],
  rawQuery: string,
): SiteSearchHit[] {
  const tokens = siteQueryTokens(rawQuery);
  const digits = isNumberQuery(rawQuery) ? digitsOfQuery(rawQuery) : undefined;
  const out: SiteSearchHit[] = [];
  for (const order of orders) {
    const score = digits !== undefined
      ? scoreNumber(digits, order.orderNo)
      : scoreFields([order.snapshot.serviceSku, order.snapshot.requester, order.snapshot.agent, order.snapshot.meetingContext, order.snapshot.startTime], tokens);
    if (score === 0) continue;
    out.push(hit({
      kind: "order",
      id: order.orderId,
      title: order.snapshot.serviceSku || order.orderNo || order.orderId,
      subtitle: order.snapshot.startTime,
      badge: orderBadge(order.lifecycle),
      number: order.orderNo || undefined,
      score,
      orderKind: "FULFILLMENT",
    }));
  }
  for (const join of joinOrders) {
    // 没有编号的报名行（老服务端）在数字查询里没有可比的东西；文字查询照常。
    const activity = join.snapshot?.activity;
    const score = digits !== undefined
      ? scoreNumber(digits, join.orderNo)
      : scoreFields([activity?.title, activity?.venueName, join.snapshot?.place?.name, join.snapshot?.companion?.name, activity?.time], tokens);
    if (score === 0) continue;
    out.push(hit({
      kind: "order",
      // 同一活动只会有一条报名订单；加前缀避免与 fulfillment orderId 撞 key。
      id: `join:${join.activityId}`,
      title: activity?.title || join.orderNo || join.activityId,
      subtitle: [activity?.venueName ?? "", activity?.time ?? ""].filter(Boolean).join(" · "),
      badge: orderBadge(join.state),
      number: join.orderNo || undefined,
      score,
      orderKind: "ACTIVITY_JOIN",
      activityId: join.activityId,
    }));
  }
  return out;
}

/**
 * 动态命中。posts 已经是服务端按 body / 作者名 / 城市过滤过的结果；这里再走一次与服务端
 * 逐字对应的 postMatchesFeedSearch 兜底（老 server / 缓存回放），字段集一致，所以不会丢
 * 服务端认可的帖子。时间线是按新旧排的，所以同分时保持输入顺序（新的在前）。
 */
export function postHits(posts: readonly FeedPost[], rawQuery: string): SiteSearchHit[] {
  const normalized = normalizeFeedSearchQuery(rawQuery);
  const tokens = siteQueryTokens(rawQuery);
  const out: SiteSearchHit[] = [];
  for (const post of posts) {
    if (!postMatchesFeedSearch(post, normalized)) continue;
    const body = post.body.replace(/\s+/g, " ").trim();
    const score = Math.max(1, scoreFields([body, post.authorDisplayName, post.cityScope], tokens));
    out.push(hit({
      kind: "post",
      id: post.postId,
      title: post.authorDisplayName || post.authorId,
      subtitle: body.length > 80 ? `${body.slice(0, 80)}…` : body,
      score,
      authorId: post.authorId,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 排序 / 分组
// ---------------------------------------------------------------------------

/** 编号查询把订单类放最前（客服报号 = 找订单）；其余按「人 → 活动 → 场景 → 机会 → 订单 → 动态」。 */
export function siteSearchGroupOrder(rawQuery: string): readonly SiteSearchKind[] {
  return isNumberQuery(rawQuery)
    ? ["order", "activity", "opportunity", "person", "place", "post"]
    : ["person", "activity", "place", "opportunity", "order", "post"];
}

/** 全部范围下每类最多显示几条；单类范围下显示到这个上限为止。 */
export const SITE_SEARCH_GROUP_PREVIEW = 4;
export const SITE_SEARCH_SCOPED_LIMIT = 30;

/** 稳定排序：分数高在前，同分保持来源顺序。同 key 只留分数最高的一条。 */
export function rankSiteSearchHits(hits: readonly SiteSearchHit[]): SiteSearchHit[] {
  const best = new Map<string, { hit: SiteSearchHit; index: number }>();
  hits.forEach((candidate, index) => {
    const current = best.get(candidate.key);
    if (!current || candidate.score > current.hit.score) best.set(candidate.key, { hit: candidate, index: current?.index ?? index });
  });
  return [...best.values()]
    .sort((a, b) => b.hit.score - a.hit.score || a.index - b.index)
    .map((entry) => entry.hit);
}

export function groupSiteSearchHits(
  hits: readonly SiteSearchHit[],
  scope: SiteSearchScope,
  rawQuery: string,
): SiteSearchGroup[] {
  const ranked = rankSiteSearchHits(hits);
  const kinds = scope === "all" ? siteSearchGroupOrder(rawQuery) : [scope];
  const limit = scope === "all" ? SITE_SEARCH_GROUP_PREVIEW : SITE_SEARCH_SCOPED_LIMIT;
  const groups: SiteSearchGroup[] = [];
  for (const kind of kinds) {
    const ofKind = ranked.filter((candidate) => candidate.kind === kind);
    if (ofKind.length === 0) continue;
    groups.push({ kind, total: ofKind.length, hits: ofKind.slice(0, limit), hasMore: ofKind.length > limit });
  }
  return groups;
}

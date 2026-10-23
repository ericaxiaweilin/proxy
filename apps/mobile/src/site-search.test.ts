// SITE-SEARCH-001：全站搜索纯逻辑的行为钉。
// 每条断言都对应一个「修之前会错」的具体场景，不是覆盖率凑数。
import { describe, expect, it } from "vitest";
import type { FeedPost } from "@proxy/contracts";
import {
  activityHits,
  avatarThumbPath,
  codePointLength,
  digitsOfQuery,
  foldSiteText,
  groupSiteSearchHits,
  isNumberQuery,
  isSiteSearchScope,
  opportunityHits,
  orderBadge,
  orderHits,
  personHits,
  personQueryLongEnough,
  placeHits,
  postHits,
  rankSiteSearchHits,
  scoreFields,
  scoreNumber,
  siteQueryTokens,
  siteSearchGroupOrder,
  SITE_SEARCH_GROUP_PREVIEW,
  SITE_SEARCH_KINDS,
  SITE_SEARCH_SCOPED_LIMIT,
  stripHandleAt,
  type SearchableActivity,
  type SearchableFulfillmentOrder,
  type SearchableJoinOrder,
  type SearchableOpportunity,
  type SiteSearchHit,
} from "./site-search";

const ORDER_NO = "200260929103015000123";
const JOIN_NO = "100260929110000000042";
const OPP_NO = "201260929090000000007";
const ACT_CODE = "300260929080000000009";

function activity(over: Partial<SearchableActivity> & { activityId: string; title: string }): SearchableActivity {
  return { venueName: "", desc: "", time: "", venueTypeLabel: "", ...over };
}

describe("SITE-SEARCH-001 normalisation", () => {
  it("folds Vietnamese diacritics and đ so 'ha noi' finds 'Hà Nội' and 'cafe' finds 'Café'", () => {
    expect(foldSiteText("Hà Nội")).toBe("ha noi");
    expect(foldSiteText("Đường Láng")).toBe("duong lang");
    expect(foldSiteText("Café")).toBe("cafe");
  });

  it("folds full-width latin/digits from CJK IMEs and collapses whitespace", () => {
    expect(foldSiteText("　ＣＡＦＥ　　１２３ ")).toBe("cafe 123");
  });

  it("leaves CJK, kana and hangul intact (folding must not mangle other scripts)", () => {
    expect(foldSiteText("咖啡")).toBe("咖啡");
    expect(foldSiteText("がっこう")).toBe("がっこう");
    expect(foldSiteText("한국어")).toBe("한국어");
  });

  it("tokenises on whitespace and returns [] for a blank query", () => {
    expect(siteQueryTokens("  西湖   咖啡 ")).toEqual(["西湖", "咖啡"]);
    expect(siteQueryTokens("   ")).toEqual([]);
  });

  it("counts query length in code points, not UTF-16 units (astral chars)", () => {
    expect(codePointLength("咖啡")).toBe(2);
    expect(codePointLength("😀")).toBe(1);
    expect("😀".length).toBe(2);
  });

  it("strips a leading @ for people search and does not count it toward the 2-character floor", () => {
    expect(stripHandleAt("@linh")).toBe("linh");
    expect(stripHandleAt("@@ linh")).toBe("linh");
    expect(personQueryLongEnough("@l")).toBe(false);
    expect(personQueryLongEnough("@li")).toBe(true);
    expect(personQueryLongEnough("咖")).toBe(false);
    expect(personQueryLongEnough("咖啡")).toBe(true);
  });

  it("recognises number queries only from 6 digits, tolerating spaces, dashes and a leading #", () => {
    expect(digitsOfQuery("# 2002609-29 103015")).toBe("200260929103015");
    expect(digitsOfQuery("abc123")).toBeUndefined();
    expect(isNumberQuery("300")).toBe(false);
    expect(isNumberQuery("12345")).toBe(false);
    expect(isNumberQuery("123456")).toBe(true);
    expect(isNumberQuery("咖啡123456")).toBe(false);
  });

  it("knows exactly the six kinds plus 'all' as scopes", () => {
    expect([...SITE_SEARCH_KINDS]).toEqual(["person", "activity", "place", "opportunity", "order", "post"]);
    for (const scope of ["all", ...SITE_SEARCH_KINDS]) expect(isSiteSearchScope(scope)).toBe(true);
    for (const junk of ["", "ALL", "orders", "people"]) expect(isSiteSearchScope(junk)).toBe(false);
  });
});

describe("SITE-SEARCH-001 scoring", () => {
  it("ranks exact > prefix > word-start > contains", () => {
    const tokens = siteQueryTokens("bean");
    const exact = scoreFields(["Bean"], tokens);
    const prefix = scoreFields(["Bean Street"], tokens);
    const word = scoreFields(["Green Bean"], tokens);
    const contains = scoreFields(["Xbeanx"], tokens);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(0);
  });

  it("prefers a hit in the title field over the same hit in a later field", () => {
    const tokens = siteQueryTokens("湖边");
    expect(scoreFields(["湖边散步", "河内"], tokens)).toBeGreaterThan(scoreFields(["河内", "湖边散步"], tokens));
  });

  it("requires EVERY token to match (AND), so extra words narrow instead of widen", () => {
    expect(scoreFields(["西湖咖啡", "河内"], siteQueryTokens("西湖 咖啡"))).toBeGreaterThan(0);
    expect(scoreFields(["西湖咖啡", "河内"], siteQueryTokens("西湖 火锅"))).toBe(0);
  });

  it("returns 0 for an empty token list instead of matching everything", () => {
    expect(scoreFields(["anything"], [])).toBe(0);
  });

  it("scores numbers: full > prefix > suffix (customer service reads the tail) > middle > none", () => {
    expect(scoreNumber(ORDER_NO, ORDER_NO)).toBe(100);
    expect(scoreNumber("2002609", ORDER_NO)).toBe(90);
    expect(scoreNumber("000123", ORDER_NO)).toBe(85);
    expect(scoreNumber("929103", ORDER_NO)).toBe(60);
    expect(scoreNumber("999999", ORDER_NO)).toBe(0);
    expect(scoreNumber("123456", undefined)).toBe(0);
  });
});

describe("SITE-SEARCH-001 people", () => {
  const profiles = [
    { userAccountId: "u2", name: "Linh Tran", handle: "@linh_t", bio: "coffee", city: "河内", avatarPath: "assets/a2" },
    { userAccountId: "u1", name: "Linh", handle: "linh", bio: "", city: "", avatarPath: "" },
    { userAccountId: "u1", name: "Linh", handle: "linh", bio: "", city: "", avatarPath: "" },
  ];

  it("ranks the exact name first, de-duplicates by account and never drops a server-approved person", () => {
    const hits = personHits(profiles, "linh");
    expect(hits.map((h) => h.id)).toEqual(["u2", "u1"]);
    const ranked = rankSiteSearchHits(hits);
    expect(ranked[0]!.id).toBe("u1");
    expect(hits.every((h) => h.score >= 1)).toBe(true);
  });

  it("matches on @handle typed with the @", () => {
    const [first] = personHits([profiles[0]!], "@linh_t");
    expect(first!.score).toBeGreaterThan(1);
    expect(first!.subtitle).toBe("@linh_t · 河内");
    expect(first!.avatarPath).toBe("assets/a2");
    expect(first!.city).toBe("河内");
  });

  it("falls back to @handle, then the id, when a profile has no display name", () => {
    expect(personHits([{ userAccountId: "u9", name: "", handle: "solo" }], "solo")[0]!.title).toBe("@solo");
    expect(personHits([{ userAccountId: "u9", name: "", handle: "" }], "x")[0]!.title).toBe("u9");
  });
});

describe("SITE-SEARCH-001 avatar path", () => {
  it("turns an uploaded asset path into a thumb path and refuses anything else", () => {
    expect(avatarThumbPath("assets/abc123")).toBe("/v1/media/thumb/abc123");
    expect(avatarThumbPath("assets/a b")).toBe("/v1/media/thumb/a%20b");
    expect(avatarThumbPath("assets/avatar-3")).toBeUndefined(); // built-in placeholder, no media row
    expect(avatarThumbPath("assets/")).toBeUndefined();
    expect(avatarThumbPath("https://x/y.png")).toBeUndefined();
    expect(avatarThumbPath("")).toBeUndefined();
    expect(avatarThumbPath(undefined)).toBeUndefined();
  });
});

describe("SITE-SEARCH-001 activities", () => {
  const activities = [
    activity({ activityId: "a1", title: "西湖咖啡局", venueName: "Bean Coffee", time: "周六 15:00" }),
    activity({ activityId: "a2", title: "湖边散步", venueName: "西湖公园" }),
    activity({ activityId: "a3", title: "西湖夜跑", status: "CANCELLED" }),
    activity({ activityId: "a4", title: "无关活动", code: ACT_CODE }),
  ];

  it("finds by title/venue and ranks the title hit above the venue hit", () => {
    const hits = rankSiteSearchHits(activityHits(activities, "西湖"));
    expect(hits.map((h) => h.id)).toEqual(["a1", "a2"]);
  });

  it("never returns a CANCELLED activity — it can no longer be joined", () => {
    expect(activityHits(activities, "夜跑")).toEqual([]);
  });

  it("finds an activity by its public code, and carries the number for display", () => {
    const [found] = activityHits(activities, ACT_CODE);
    expect(found!.id).toBe("a4");
    expect(found!.number).toBe(ACT_CODE);
    // ...also from the last 6 digits
    expect(activityHits(activities, "000009").map((h) => h.id)).toEqual(["a4"]);
  });

  it("does not scan the number column for short digit queries (they mean time/price, not a code)", () => {
    expect(activityHits(activities, "300")).toEqual([]);
  });

  it("reports the activity id so the shell can open exactly that detail page", () => {
    expect(activityHits(activities, "咖啡")[0]!.activityId).toBe("a1");
  });
});

describe("SITE-SEARCH-001 places", () => {
  const scenes = [
    { id: "s1", name: "Bean Coffee", area: "还剑湖", type: "咖啡馆", category: "cafe" },
    { id: "s2", name: "老街小馆", area: "Hà Nội 老城", type: "餐厅", category: "food" },
  ];

  it("matches name, area, type and category", () => {
    expect(placeHits(scenes, "bean").map((h) => h.id)).toEqual(["s1"]);
    expect(placeHits(scenes, "还剑").map((h) => h.id)).toEqual(["s1"]);
    expect(placeHits(scenes, "餐厅").map((h) => h.id)).toEqual(["s2"]);
    expect(placeHits(scenes, "food").map((h) => h.id)).toEqual(["s2"]);
  });

  it("finds a diacritic place from an unaccented query", () => {
    expect(placeHits(scenes, "ha noi").map((h) => h.id)).toEqual(["s2"]);
  });

  it("puts the area and type in the subtitle", () => {
    expect(placeHits(scenes, "bean")[0]!.subtitle).toBe("还剑湖 · 咖啡馆");
  });
});

describe("SITE-SEARCH-001 opportunities", () => {
  const opps: SearchableOpportunity[] = [
    { id: "o1", number: OPP_NO, title: "找人陪逛老街", shortTitle: "逛老街", theme: "陪伴", location: "还剑湖", owner: "Linh", skills: "中文", date: "周日", time: "10:00", ownedByViewer: true },
    { id: "o2", title: "翻译协助", shortTitle: "翻译", theme: "协助", location: "机场", owner: "Minh", skills: "英语", date: "周一", time: "08:00" },
  ];

  it("searches title, location, skills and owner", () => {
    expect(opportunityHits(opps, "老街").map((h) => h.id)).toEqual(["o1"]);
    expect(opportunityHits(opps, "机场").map((h) => h.id)).toEqual(["o2"]);
    expect(opportunityHits(opps, "英语").map((h) => h.id)).toEqual(["o2"]);
    expect(opportunityHits(opps, "minh").map((h) => h.id)).toEqual(["o2"]);
  });

  it("marks the viewer's own opportunity and finds it by its public number", () => {
    const [own] = opportunityHits(opps, OPP_NO);
    expect(own!.id).toBe("o1");
    expect(own!.badge).toBe("OWNED");
    expect(own!.number).toBe(OPP_NO);
    // an opportunity with no number is simply not reachable by number (not a crash, not a false hit)
    expect(opportunityHits(opps, "123456")).toEqual([]);
  });
});

describe("SITE-SEARCH-001 orders (own orders only)", () => {
  const orders: SearchableFulfillmentOrder[] = [
    { orderId: "ord1", orderNo: ORDER_NO, lifecycle: "CONFIRMED", snapshot: { serviceSku: "陪逛老街", requester: "我", agent: "Linh", meetingContext: "还剑湖", startTime: "周日 10:00" } },
    { orderId: "ord2", lifecycle: "CANCELLED", snapshot: { serviceSku: "翻译协助", requester: "我", agent: "Minh", meetingContext: "机场", startTime: "周一 08:00" } },
  ];
  const joins: SearchableJoinOrder[] = [
    { activityId: "a1", orderNo: JOIN_NO, state: "CONFIRMED", snapshot: { activity: { title: "西湖咖啡局", venueName: "Bean Coffee", time: "周六 15:00" }, companion: { name: "Linh" }, place: { name: "Bean Coffee" } } },
    { activityId: "a5", state: "CANCELLED" },
  ];

  it("finds a fulfillment order by its number, full or last 6 digits, and shows the state badge", () => {
    expect(orderHits(orders, joins, ORDER_NO).map((h) => h.id)).toEqual(["ord1"]);
    const [tail] = orderHits(orders, joins, "000123");
    expect(tail!.id).toBe("ord1");
    expect(tail!.badge).toBe("CONFIRMED");
    expect(tail!.number).toBe(ORDER_NO);
    expect(tail!.orderKind).toBe("FULFILLMENT");
  });

  it("finds an activity-join order by its number and routes it to the activity", () => {
    const [found] = orderHits(orders, joins, JOIN_NO);
    expect(found!.orderKind).toBe("ACTIVITY_JOIN");
    expect(found!.activityId).toBe("a1");
    expect(found!.id).toBe("join:a1");
    expect(found!.key).toBe("order:join:a1");
  });

  it("finds orders by service / counterpart / place text, including cancelled ones (history stays searchable)", () => {
    expect(orderHits(orders, joins, "翻译").map((h) => h.id)).toEqual(["ord2"]);
    expect(orderHits(orders, joins, "翻译")[0]!.badge).toBe("CANCELLED");
    expect(orderHits(orders, joins, "bean").map((h) => h.id)).toEqual(["join:a1"]);
  });

  it("does not let a number query match an order that has no number", () => {
    expect(orderHits([orders[1]!], [], "200260929103015")).toEqual([]);
  });

  it("a join row with no snapshot still searches by its number and does not throw", () => {
    const noSnap: SearchableJoinOrder[] = [{ activityId: "a7", orderNo: "100260929110000000099" }];
    expect(orderHits([], noSnap, "100260929110000000099").map((h) => h.id)).toEqual(["join:a7"]);
    expect(orderHits([], noSnap, "咖啡")).toEqual([]);
  });

  it("maps only known states to badges; an unknown state draws no badge", () => {
    expect(orderBadge("EXECUTING")).toBe("EXECUTING");
    expect(orderBadge("NO_SHOW")).toBe("NO_SHOW");
    expect(orderBadge("WHATEVER")).toBeUndefined();
    expect(orderBadge(undefined)).toBeUndefined();
  });
});

describe("SITE-SEARCH-001 posts", () => {
  const post = (over: Partial<FeedPost> & { postId: string; body: string }): FeedPost => ({
    authorType: "USER", authorId: "u1", mediaRefs: [], status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-29T00:00:00Z", ...over,
  });

  it("keeps only posts matching body / author / city with the same semantics as the server", () => {
    const posts = [
      post({ postId: "p1", body: "今天去 Bean Coffee 坐了一下午", authorDisplayName: "Linh" }),
      post({ postId: "p2", body: "无关", authorDisplayName: "Bean 老板" }),
      post({ postId: "p3", body: "无关", cityScope: "Bean 市" }),
      post({ postId: "p4", body: "完全无关", authorDisplayName: "Minh" }),
    ];
    expect(postHits(posts, "bean").map((h) => h.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("uses the author as title and a trimmed one-line body as subtitle; long bodies are ellipsized", () => {
    const [short] = postHits([post({ postId: "p1", body: "  第一行\n第二行  ", authorDisplayName: "Linh" })], "第一行");
    expect(short!.title).toBe("Linh");
    expect(short!.subtitle).toBe("第一行 第二行");
    const [long] = postHits([post({ postId: "p2", body: `咖啡${"啊".repeat(200)}` })], "咖啡");
    expect(long!.subtitle.endsWith("…")).toBe(true);
    expect([...long!.subtitle].length).toBe(81);
    expect(long!.title).toBe("u1"); // no display name → author id, never blank
  });

  it("gives every server-approved post a positive score", () => {
    expect(postHits([post({ postId: "p1", body: "Café", authorDisplayName: "x" })], "café")[0]!.score).toBeGreaterThan(0);
  });
});

describe("SITE-SEARCH-001 ranking and grouping", () => {
  const mk = (kind: SiteSearchHit["kind"], id: string, score: number): SiteSearchHit => ({ kind, key: `${kind}:${id}`, id, title: id, subtitle: "", score });

  it("sorts by score desc, keeps source order on ties, and de-duplicates a key keeping the best score", () => {
    const ranked = rankSiteSearchHits([mk("person", "a", 50), mk("person", "b", 50), mk("person", "c", 90), mk("person", "a", 70)]);
    expect(ranked.map((h) => `${h.id}:${h.score}`)).toEqual(["c:90", "a:70", "b:50"]);
  });

  it("orders groups people → activities → places → opportunities → orders → posts for a text query", () => {
    expect([...siteSearchGroupOrder("咖啡")]).toEqual(["person", "activity", "place", "opportunity", "order", "post"]);
  });

  it("puts orders first for a number-like query — someone reading out a number is looking for an order", () => {
    expect(siteSearchGroupOrder(ORDER_NO)[0]).toBe("order");
    expect(siteSearchGroupOrder("12345")[0]).toBe("person");
  });

  it("caps each group in 'all' scope, reports the true total and flags hasMore", () => {
    const many = Array.from({ length: SITE_SEARCH_GROUP_PREVIEW + 3 }, (_, i) => mk("activity", `a${i}`, 100 - i));
    const [group] = groupSiteSearchHits(many, "all", "x");
    expect(group!.hits).toHaveLength(SITE_SEARCH_GROUP_PREVIEW);
    expect(group!.total).toBe(SITE_SEARCH_GROUP_PREVIEW + 3);
    expect(group!.hasMore).toBe(true);
  });

  it("shows a single kind up to the scoped limit when a scope is chosen, and hides other kinds", () => {
    const hits = [
      ...Array.from({ length: SITE_SEARCH_GROUP_PREVIEW + 3 }, (_, i) => mk("activity", `a${i}`, 100 - i)),
      mk("person", "p", 90),
    ];
    const groups = groupSiteSearchHits(hits, "activity", "x");
    expect(groups.map((g) => g.kind)).toEqual(["activity"]);
    expect(groups[0]!.hits).toHaveLength(SITE_SEARCH_GROUP_PREVIEW + 3);
    expect(groups[0]!.hasMore).toBe(false);
    expect(SITE_SEARCH_SCOPED_LIMIT).toBeGreaterThan(SITE_SEARCH_GROUP_PREVIEW);
  });

  it("omits empty groups entirely (no 'people (0)' headings)", () => {
    expect(groupSiteSearchHits([mk("post", "p", 5)], "all", "x").map((g) => g.kind)).toEqual(["post"]);
    expect(groupSiteSearchHits([], "all", "x")).toEqual([]);
  });
});

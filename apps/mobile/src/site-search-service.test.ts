// SITE-SEARCH-001：编排层的行为钉 —— 来源独立成败、如实报告「没法查」、缓存不吞失败。
import { describe, expect, it, vi } from "vitest";
import type { FeedPost } from "@proxy/contracts";
import {
  buildSiteSearchSources,
  cachedLoader,
  kindsToSearch,
  loadSearchableScenes,
  MY_ORDERS_TTL_MS,
  parseSearchableScenes,
  PUBLIC_LIST_TTL_MS,
  runSiteSearch,
  type SiteSearchSources,
} from "./site-search-service";

const ORDER_NO = "200260929103015000123";

const post = (postId: string, body: string): FeedPost => ({
  postId, authorType: "USER", authorId: "u1", body, mediaRefs: [], status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-29T00:00:00Z",
});

function fullSources(over: Partial<SiteSearchSources> = {}): SiteSearchSources {
  return {
    signedIn: true,
    searchProfiles: async () => [{ userAccountId: "u2", name: "咖啡师小林", handle: "lin", bio: "", city: "河内" }],
    searchPosts: async () => [post("p1", "今天喝了咖啡")],
    listActivities: async () => [{ activityId: "a1", title: "咖啡局", venueName: "Bean", desc: "", time: "周六", venueTypeLabel: "" }],
    listOpportunities: async () => [{ id: "o1", title: "找咖啡搭子", shortTitle: "", theme: "", location: "还剑湖", owner: "Minh", skills: "", date: "", time: "" }],
    listScenes: async () => [{ id: "s1", name: "咖啡馆 Bean", area: "老城" }],
    listMyOrders: async () => [{ orderId: "ord1", orderNo: ORDER_NO, lifecycle: "CONFIRMED", snapshot: { serviceSku: "咖啡陪伴", requester: "我", agent: "Linh", meetingContext: "", startTime: "周日" } }],
    listMyJoinOrders: async () => [],
    ...over,
  };
}

describe("SITE-SEARCH-001 runSiteSearch", () => {
  it("asks all six sources for one text query and returns hits of every kind", async () => {
    const outcome = await runSiteSearch(fullSources(), "咖啡", "all");
    const kinds = new Set(outcome.hits.map((h) => h.kind));
    expect([...kinds].sort()).toEqual(["activity", "opportunity", "order", "person", "place", "post"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.needsLogin).toEqual([]);
    expect(outcome.tooShort).toEqual([]);
  });

  it("isolates failures: a dead feed service still returns people/activities and reports only 'post' as failed", async () => {
    const outcome = await runSiteSearch(fullSources({ searchPosts: async () => { throw new Error("503"); } }), "咖啡", "all");
    expect(outcome.failed).toEqual(["post"]);
    expect(outcome.hits.some((h) => h.kind === "person")).toBe(true);
    expect(outcome.hits.some((h) => h.kind === "activity")).toBe(true);
    expect(outcome.hits.some((h) => h.kind === "post")).toBe(false);
  });

  it("reports every failing source, not just the first", async () => {
    const boom = async (): Promise<never> => { throw new Error("down"); };
    const outcome = await runSiteSearch(fullSources({ listActivities: boom, listScenes: boom, searchProfiles: boom }), "咖啡", "all");
    expect([...outcome.failed].sort()).toEqual(["activity", "person", "place"]);
    expect(outcome.hits.some((h) => h.kind === "opportunity")).toBe(true);
  });

  it("does not turn 'all sources failed' into an empty-but-successful result", async () => {
    const boom = async (): Promise<never> => { throw new Error("offline"); };
    const outcome = await runSiteSearch({
      signedIn: true, searchProfiles: boom, searchPosts: boom, listActivities: boom, listOpportunities: boom, listScenes: boom, listMyOrders: boom, listMyJoinOrders: boom,
    }, "咖啡", "all");
    expect(outcome.hits).toEqual([]);
    expect([...outcome.failed].sort()).toEqual(["activity", "opportunity", "order", "person", "place", "post"]);
  });

  it("guests can browse public things but people and orders report needsLogin — and never call the server", async () => {
    const searchProfiles = vi.fn(async () => []);
    const listMyOrders = vi.fn(async () => []);
    const listMyJoinOrders = vi.fn(async () => []);
    const outcome = await runSiteSearch(fullSources({ signedIn: false, searchProfiles, listMyOrders, listMyJoinOrders }), "咖啡", "all");
    expect([...outcome.needsLogin].sort()).toEqual(["order", "person"]);
    expect(searchProfiles).not.toHaveBeenCalled();
    expect(listMyOrders).not.toHaveBeenCalled();
    expect(listMyJoinOrders).not.toHaveBeenCalled();
    expect(outcome.failed).toEqual([]);
    for (const kind of ["activity", "opportunity", "place", "post"] as const) {
      expect(outcome.hits.some((h) => h.kind === kind), kind).toBe(true);
    }
  });

  it("does not ask the server for people when the query is under 2 characters, and says so (tooShort)", async () => {
    const searchProfiles = vi.fn(async () => []);
    const outcome = await runSiteSearch(fullSources({ searchProfiles }), "咖", "all");
    expect(outcome.tooShort).toEqual(["person"]);
    expect(searchProfiles).not.toHaveBeenCalled();
    // ...but everything else still searches a single character
    expect(outcome.hits.some((h) => h.kind === "activity")).toBe(true);
  });

  it("strips the leading @ before asking the server for people", async () => {
    const searchProfiles = vi.fn(async () => []);
    await runSiteSearch(fullSources({ searchProfiles }), "@lin", "all");
    expect(searchProfiles).toHaveBeenCalledWith("lin");
  });

  it("passes the raw (trimmed) query to the feed search", async () => {
    const searchPosts = vi.fn(async () => []);
    await runSiteSearch(fullSources({ searchPosts }), "  咖啡  ", "all");
    expect(searchPosts).toHaveBeenCalledWith("咖啡");
  });

  it("only queries the chosen kind when a scope is set", async () => {
    const searchProfiles = vi.fn(async () => []);
    const listActivities = vi.fn(async () => []);
    const searchPosts = vi.fn(async () => [post("p1", "咖啡")]);
    const outcome = await runSiteSearch(fullSources({ searchProfiles, listActivities, searchPosts }), "咖啡", "post");
    expect(searchProfiles).not.toHaveBeenCalled();
    expect(listActivities).not.toHaveBeenCalled();
    expect(outcome.hits.map((h) => h.kind)).toEqual(["post"]);
  });

  it("a number-like query only asks numbered kinds (orders, activities, opportunities) — not people or feed", async () => {
    expect([...kindsToSearch("all", ORDER_NO)]).toEqual(["order", "activity", "opportunity"]);
    expect(kindsToSearch("all", "12345")).toHaveLength(6);
    expect([...kindsToSearch("post", ORDER_NO)]).toEqual(["post"]);
    const searchProfiles = vi.fn(async () => []);
    const searchPosts = vi.fn(async () => []);
    const outcome = await runSiteSearch(fullSources({ searchProfiles, searchPosts }), ORDER_NO, "all");
    expect(searchProfiles).not.toHaveBeenCalled();
    expect(searchPosts).not.toHaveBeenCalled();
    expect(outcome.hits.map((h) => h.id)).toEqual(["ord1"]);
  });

  it("keeps the working half of orders when one order source fails, but still flags 'order' as possibly incomplete", async () => {
    const outcome = await runSiteSearch(fullSources({
      listMyJoinOrders: async () => { throw new Error("join list down"); },
    }), ORDER_NO, "all");
    expect(outcome.hits.map((h) => h.id)).toEqual(["ord1"]);
    expect(outcome.failed).toEqual(["order"]);
  });

  it("returns an empty outcome for a blank query without touching any source", async () => {
    const searchPosts = vi.fn(async () => []);
    const outcome = await runSiteSearch(fullSources({ searchPosts }), "   ", "all");
    expect(outcome).toEqual({ query: "", scope: "all", hits: [], failed: [], needsLogin: [], tooShort: [] });
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("skips unwired sources silently rather than flagging them failed", async () => {
    const outcome = await runSiteSearch({ signedIn: true, listActivities: async () => [{ activityId: "a1", title: "咖啡局", venueName: "", desc: "", time: "", venueTypeLabel: "" }] }, "咖啡", "all");
    expect(outcome.failed).toEqual([]);
    expect(outcome.hits.map((h) => h.kind)).toEqual(["activity"]);
  });
});

describe("SITE-SEARCH-001 cachedLoader", () => {
  it("serves repeated keystrokes from one fetch inside the TTL and refetches after it", async () => {
    let clock = 0;
    const load = vi.fn(async () => [1]);
    const cached = cachedLoader(load, 1000, () => clock);
    await cached(); await cached(); await cached();
    expect(load).toHaveBeenCalledTimes(1);
    clock = 999; await cached();
    expect(load).toHaveBeenCalledTimes(1);
    clock = 1000; await cached();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const load = vi.fn(() => new Promise<number>((resolve) => setTimeout(() => resolve(1), 5)));
    const cached = cachedLoader(load, 1000);
    await Promise.all([cached(), cached(), cached()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failure — the next keystroke retries instead of replaying the error", async () => {
    let calls = 0;
    const cached = cachedLoader(async () => { calls += 1; if (calls === 1) throw new Error("flaky"); return "ok"; }, 60_000);
    await expect(cached()).rejects.toThrow("flaky");
    await expect(cached()).resolves.toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("SITE-SEARCH-001 buildSiteSearchSources", () => {
  it("wires each real client method with the right arguments", async () => {
    const searchProfiles = vi.fn(async () => []);
    const listFeedPosts = vi.fn(async () => ({ posts: [post("p1", "x")] }));
    const listActivities = vi.fn(async () => []);
    const listMyActivities = vi.fn(async () => ({ joinOrders: [{ activityId: "a1", orderNo: "100260929110000000042" }] }));
    const list = vi.fn(async () => []);
    const listMyOrders = vi.fn(async () => []);
    const sources = buildSiteSearchSources({
      isGuest: false,
      profile: { searchProfiles },
      localNet: { listFeedPosts },
      activities: { listActivities, listMyActivities },
      marketplace: { list },
      fulfillment: { listMyOrders },
      listScenes: async () => [],
    });
    expect(sources.signedIn).toBe(true);
    await sources.searchProfiles!("lin");
    expect(searchProfiles).toHaveBeenCalledWith("lin", 10);
    expect((await sources.searchPosts!("咖啡")).map((p) => p.postId)).toEqual(["p1"]);
    expect(listFeedPosts).toHaveBeenCalledWith(undefined, 12, "咖啡");
    await sources.listActivities!(); await sources.listOpportunities!(); await sources.listMyOrders!();
    expect((await sources.listMyJoinOrders!()).map((j) => j.activityId)).toEqual(["a1"]);
    expect([listActivities, list, listMyOrders, listMyActivities].every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it("marks guests as not signed in, and leaves unwired clients undefined", () => {
    const sources = buildSiteSearchSources({ isGuest: true });
    expect(sources.signedIn).toBe(false);
    expect(sources.searchProfiles).toBeUndefined();
    expect(sources.listMyOrders).toBeUndefined();
    expect(sources.listMyJoinOrders).toBeUndefined();
  });

  it("caches the public lists longer than the viewer's own orders (a just-placed order must be findable soon)", async () => {
    expect(MY_ORDERS_TTL_MS).toBeLessThan(PUBLIC_LIST_TTL_MS);
    let clock = 0;
    const listMyOrders = vi.fn(async () => []);
    const list = vi.fn(async () => []);
    const sources = buildSiteSearchSources({ isGuest: false, fulfillment: { listMyOrders }, marketplace: { list } }, () => clock);
    await sources.listMyOrders!(); await sources.listOpportunities!();
    clock = MY_ORDERS_TTL_MS;
    await sources.listMyOrders!(); await sources.listOpportunities!();
    expect(listMyOrders).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("SITE-SEARCH-001 scene catalog", () => {
  it("keeps only active scenes with an id and a name, and fills optional strings as undefined", () => {
    const scenes = parseSearchableScenes({
      scenes: [
        { id: "s1", name: "Bean", area: "老城", type: "咖啡", category: "cafe", active: true },
        { id: "s2", name: "已下线", active: false },
        { id: "", name: "无 id", active: true },
        { id: "s4", active: true },
        null,
        { id: "s5", name: "最简", active: true, area: 3 },
      ],
    });
    expect(scenes).toEqual([
      { id: "s1", name: "Bean", area: "老城", type: "咖啡", category: "cafe" },
      { id: "s5", name: "最简", area: undefined, type: undefined, category: undefined },
    ]);
  });

  it("treats a malformed body as a failure (so the place source reports 'failed', not 'no places')", () => {
    expect(() => parseSearchableScenes({})).toThrow();
    expect(() => parseSearchableScenes(null)).toThrow();
  });

  it("loads from the public catalog URL and throws on a non-2xx status", async () => {
    const seen: string[] = [];
    const ok = await loadSearchableScenes(async (url) => { seen.push(url); return { ok: true, json: async () => ({ scenes: [{ id: "s1", name: "Bean", active: true }] }) }; }, "https://api.example.com/");
    expect(seen).toEqual(["https://api.example.com/v1/reality-scenes"]);
    expect(ok.map((s) => s.id)).toEqual(["s1"]);
    await expect(loadSearchableScenes(async () => ({ ok: false, status: 503, json: async () => ({}) }), "https://api.example.com")).rejects.toThrow("503");
  });
});

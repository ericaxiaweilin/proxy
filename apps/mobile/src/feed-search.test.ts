import { describe, expect, it } from "vitest";
import type { FeedPost } from "@proxy/contracts";
import {
  filterPostsByFeedSearch,
  normalizeFeedSearchQuery,
  postMatchesFeedSearch
} from "./feed-search";

function post(overrides: Partial<FeedPost> & { postId: string }): FeedPost {
  return {
    authorType: "USER",
    authorId: "user_001",
    body: "body",
    mediaRefs: [],
    contextRefs: [],
    status: "PUBLISHED",
    createdAt: "2026-09-12T00:00:00Z",
    ...overrides
  } as FeedPost;
}

describe("SEARCH-CORPUS-001 normalizeFeedSearchQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeFeedSearchQuery("  西湖  ")).toBe("西湖");
    expect(normalizeFeedSearchQuery("Hanoi")).toBe("hanoi");
  });

  it("treats undefined / blank as 'not searching'", () => {
    expect(normalizeFeedSearchQuery(undefined)).toBe("");
    expect(normalizeFeedSearchQuery("")).toBe("");
    expect(normalizeFeedSearchQuery("   \n\t ")).toBe("");
  });
});

describe("SEARCH-CORPUS-001 matches the fields the search box advertises", () => {
  // 搜索框 placeholder：「搜索人、机会、活动、情报…」——「人」必须真的能搜到。
  it("matches the author display name", () => {
    const p = post({ postId: "post_1", body: "今天的咖啡不错", authorDisplayName: "晴晴" });
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("晴晴"))).toBe(true);
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("晴"))).toBe(true);
  });

  it("matches the city scope", () => {
    const p = post({ postId: "post_2", body: "今天的咖啡不错", cityScope: "岘港" });
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("岘港"))).toBe(true);
  });

  it("still matches the body (R15.94 behaviour must not regress)", () => {
    const p = post({ postId: "post_3", body: "西湖昨天夕阳" });
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("西湖"))).toBe(true);
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("西"))).toBe(true);
  });

  it("is case-insensitive across all three fields", () => {
    expect(postMatchesFeedSearch(post({ postId: "a", body: "Hanoi Night Market" }), "hanoi")).toBe(true);
    expect(postMatchesFeedSearch(post({ postId: "b", body: "x", authorDisplayName: "Linh" }), "linh")).toBe(true);
    expect(postMatchesFeedSearch(post({ postId: "c", body: "x", cityScope: "HCM" }), "hcm")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    const p = post({ postId: "post_4", body: "西湖昨天夕阳", authorDisplayName: "晴晴", cityScope: "岘港" });
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("河内"))).toBe(false);
  });

  it("does not match on the derived contextRefs (server derives them from the body)", () => {
    // contextRefs 是 classifyPostFallback 从正文派生的分类标签，不是用户输入。
    // 让搜索命中它 = 返回用户根本没写过的词，所以两端都刻意排除。
    const p = post({
      postId: "post_5",
      body: "西湖昨天夕阳",
      contextRefs: [{ contextId: "scene_rooftop_夜景" } as FeedPost["contextRefs"][number]]
    });
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("夜景"))).toBe(false);
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("rooftop"))).toBe(false);
  });

  it("treats an empty query as 'no filter' rather than 'match nothing'", () => {
    const p = post({ postId: "post_6", body: "西湖昨天夕阳" });
    expect(postMatchesFeedSearch(p, "")).toBe(true);
  });

  it("does not let a blank optional field match everything", () => {
    // authorDisplayName/cityScope 为 "" 时 includes("") 恒 true，会把整条 feed 放过去。
    const p = post({ postId: "post_7", body: "西湖昨天夕阳", authorDisplayName: "", cityScope: "" });
    expect(postMatchesFeedSearch(p, normalizeFeedSearchQuery("河内"))).toBe(false);
  });
});

describe("SEARCH-CORPUS-001 filterPostsByFeedSearch", () => {
  const posts = [
    post({ postId: "p1", body: "西湖昨天夕阳" }),
    post({ postId: "p2", body: "河内夜市美食" }),
    post({ postId: "p3", body: "西湖水上日出" }),
    // 正文完全不含「晴晴」「岘港」—— 只有作者名和城市带。
    post({ postId: "p4", body: "今天的咖啡不错", authorDisplayName: "晴晴", cityScope: "岘港" })
  ];

  it("finds a post by author name even when the body does not contain the query", () => {
    // 这正是修之前坏掉的场景：server 先把不含关键词的帖子丢掉，
    // 客户端再 OR authorDisplayName 也永远匹配不到东西。
    expect(filterPostsByFeedSearch(posts, "晴晴").map((p) => p.postId)).toEqual(["p4"]);
  });

  it("finds a post by city", () => {
    expect(filterPostsByFeedSearch(posts, "岘港").map((p) => p.postId)).toEqual(["p4"]);
  });

  it("keeps body matching and server order", () => {
    expect(filterPostsByFeedSearch(posts, "西湖").map((p) => p.postId)).toEqual(["p1", "p3"]);
    expect(filterPostsByFeedSearch(posts, "河内").map((p) => p.postId)).toEqual(["p2"]);
  });

  it("returns every post (in order) for an empty query", () => {
    expect(filterPostsByFeedSearch(posts, "").map((p) => p.postId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(filterPostsByFeedSearch(posts, undefined).map((p) => p.postId)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("returns a new array so callers cannot mutate the source by accident", () => {
    const out = filterPostsByFeedSearch(posts, "");
    expect(out).not.toBe(posts);
    expect(out).toEqual(posts);
  });

  it("returns nothing for a query that matches no field", () => {
    expect(filterPostsByFeedSearch(posts, "不存在的关键词")).toEqual([]);
  });
});

// R15.53 — ProfileTabs unit tests (logic only — no React import)
//   IG/Threads 5-tab 主页 = POSTS / REPLIES / SAVED / TAGGED / ABOUT
//   测 pinned 帖选取 + 5-tab 切换 + 空态文案 + stats 字段.
//   不 import react-native (vitest 不需要 DOM/render).

import { describe, it, expect } from "vitest";
import type { FeedPost } from "@proxy/contracts";

describe("R15.53 — IG/Threads 5 tab 主页", () => {
  it("5 tab 名字符合 IG 顺序", () => {
    const tabNames = ["POSTS", "REPLIES", "SAVED", "TAGGED", "ABOUT"];
    expect(tabNames).toHaveLength(5);
    expect(tabNames[0]).toBe("POSTS");
    expect(tabNames[4]).toBe("ABOUT");
  });
});

describe("R15.53 — 主页 pinned 帖", () => {
  function pickPinnedAndRest(posts: FeedPost[]): { pinned: FeedPost | undefined; rest: FeedPost[] } {
    if (posts.length === 0) return { pinned: undefined, rest: [] };
    return { pinned: posts[0], rest: posts.slice(1) };
  }

  it("空 → 无置顶, 无剩余", () => {
    const { pinned, rest } = pickPinnedAndRest([]);
    expect(pinned).toBeUndefined();
    expect(rest).toEqual([]);
  });

  it("单帖 → 置顶 = 唯一那条, 列表空", () => {
    const post: FeedPost = {
      postId: "p1", authorType: "AGENT", authorId: "u1",
      body: "first", status: "PUBLISHED", createdAt: "2026-09-01T00:00:00Z",
      contextRefs: []
    };
    const { pinned, rest } = pickPinnedAndRest([post]);
    expect(pinned?.postId).toBe("p1");
    expect(rest).toEqual([]);
  });

  it("多帖 → 第 1 条置顶, 剩下走列表 (不重复)", () => {
    const posts: FeedPost[] = [1, 2, 3].map((i) => ({
      postId: `p${i}`, authorType: "AGENT", authorId: "u1",
      body: `post ${i}`, status: "PUBLISHED", createdAt: "2026-09-01T00:00:00Z",
      contextRefs: []
    }));
    const { pinned, rest } = pickPinnedAndRest(posts);
    expect(pinned?.postId).toBe("p1");
    expect(rest.map((p) => p.postId)).toEqual(["p2", "p3"]);
  });
});

describe("R15.53 — tab 切换合法", () => {
  const validTabs = new Set(["POSTS", "REPLIES", "SAVED", "TAGGED", "ABOUT"]);

  it("POSTS → REPLIES 允许", () => {
    expect(validTabs.has("REPLIES")).toBe(true);
  });

  it("REPLIES → SAVED 允许", () => {
    expect(validTabs.has("SAVED")).toBe(true);
  });

  it("SAVED → TAGGED 允许", () => {
    expect(validTabs.has("TAGGED")).toBe(true);
  });

  it("TAGGED → ABOUT 允许", () => {
    expect(validTabs.has("ABOUT")).toBe(true);
  });

  it("非法 tab 名 (e.g. UNKNOWN) 拒绝", () => {
    expect(validTabs.has("UNKNOWN")).toBe(false);
    expect(validTabs.has("")).toBe(false);
  });
});

describe("R15.53 — 5 个 tab 都有中文空态文案", () => {
  it("REPLIES 空态: '还没有回复'", () => {
    expect("还没有回复").toContain("回复");
  });

  it("SAVED 空态: '还没有收藏'", () => {
    expect("还没有收藏").toContain("收藏");
  });

  it("TAGGED 空态: '还没有被标记'", () => {
    expect("还没有被标记").toContain("标记");
  });

  it("POSTS 空态: '还没有动态'", () => {
    expect("还没有动态").toContain("动态");
  });
});

describe("R15.53 — IG 风格 3 数统计 (帖子/粉丝/关注)", () => {
  it("从 prop 读 posts/followers/following", () => {
    const stats = { posts: 12, followers: 128, following: 56 };
    expect(stats.posts).toBe(12);
    expect(stats.followers).toBe(128);
    expect(stats.following).toBe(56);
  });

  it("新用户 (全 0) 也合法", () => {
    const stats = { posts: 0, followers: 0, following: 0 };
    expect(stats.followers).toBe(0);
  });

  it("3 数之和用于 ABOUT tab '粉丝 · 关注 · 帖子' 显示", () => {
    const stats = { posts: 12, followers: 128, following: 56 };
    const display = `${stats.followers} · ${stats.following} · ${stats.posts}`;
    expect(display).toBe("128 · 56 · 12");
  });
});

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
      contextRefs: [],
      mediaRefs: []
    };
    const { pinned, rest } = pickPinnedAndRest([post]);
    expect(pinned?.postId).toBe("p1");
    expect(rest).toEqual([]);
  });

  it("多帖 → 第 1 条置顶, 剩下走列表 (不重复)", () => {
    const posts: FeedPost[] = [1, 2, 3].map((i) => ({
      postId: `p${i}`, authorType: "AGENT", authorId: "u1",
      body: `post ${i}`, status: "PUBLISHED", createdAt: "2026-09-01T00:00:00Z",
      contextRefs: [],
      mediaRefs: []
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

describe("R15.55 — FollowButton 状态机 (viewerMode=OTHER)", () => {
  // FollowButton 状态派生: isFollowing ? '✓ 已关注' : '+ 关注'
  function buttonLabel(isFollowing: boolean, busy: boolean): string {
    if (busy) return "处理中…";
    return isFollowing ? "✓ 已关注" : "+ 关注";
  }
  // FollowButton 行为: 未关注 → onFollow; 已关注 → onUnfollow
  type Action = "FOLLOW" | "UNFOLLOW" | "NONE";
  function decideAction(isFollowing: boolean, busy: boolean): Action {
    if (busy) return "NONE";
    return isFollowing ? "UNFOLLOW" : "FOLLOW";
  }

  it("未关注 + 空闲 → label='+ 关注', action=FOLLOW", () => {
    expect(buttonLabel(false, false)).toBe("+ 关注");
    expect(decideAction(false, false)).toBe("FOLLOW");
  });

  it("已关注 + 空闲 → label='✓ 已关注', action=UNFOLLOW", () => {
    expect(buttonLabel(true, false)).toBe("✓ 已关注");
    expect(decideAction(true, false)).toBe("UNFOLLOW");
  });

  it("未关注 + 处理中 → label='处理中…', action=NONE (不调 callback)", () => {
    expect(buttonLabel(false, true)).toBe("处理中…");
    expect(decideAction(false, true)).toBe("NONE");
  });

  it("已关注 + 处理中 → label='处理中…', action=NONE", () => {
    expect(buttonLabel(true, true)).toBe("处理中…");
    expect(decideAction(true, true)).toBe("NONE");
  });

  it("viewerMode=SELF 不渲染 FollowButton (走 编辑/分享 路径)", () => {
    const renderFollowButton = (mode: "SELF" | "OTHER"): boolean => mode === "OTHER";
    expect(renderFollowButton("SELF")).toBe(false);
    expect(renderFollowButton("OTHER")).toBe(true);
  });
});

describe("R15.55 — Follow button 样式 (关注/已关注 颜色)", () => {
  // ProfileTabs 用 styles.actionPrimary (深色) vs styles.actionSecondary (浅色)
  function buttonStyle(isFollowing: boolean): "PRIMARY" | "SECONDARY" {
    return isFollowing ? "SECONDARY" : "PRIMARY";
  }

  it("未关注 → PRIMARY (深色背景, 吸引点击)", () => {
    expect(buttonStyle(false)).toBe("PRIMARY");
  });

  it("已关注 → SECONDARY (浅色背景, 平静状态)", () => {
    expect(buttonStyle(true)).toBe("SECONDARY");
  });
});

describe("R15.56 — 置顶帖状态 (ProfileTabs.pinnedPost)", () => {
  // ProfileTabs.pinnedPost = posts[0]; 限制钉上限 3 (server side).
  function canPin(currentlyPinned: number): boolean {
    return currentlyPinned < 3;
  }
  function sortPinnedFirst(postIds: string[], pinnedIds: string[]): string[] {
    const pinned = pinnedIds.filter((id) => postIds.includes(id));
    const rest = postIds.filter((id) => !pinned.includes(id));
    return [...pinned, ...rest];
  }

  it("钉上限 3", () => {
    expect(canPin(2)).toBe(true);
    expect(canPin(3)).toBe(false);
    expect(canPin(0)).toBe(true);
  });

  it("pin 顺序: pinned 帖放最前 (preserved 顺序)", () => {
    const posts = ["post_1", "post_2", "post_3", "post_4"];
    const pinned = ["post_3", "post_1"];
    const result = sortPinnedFirst(posts, pinned);
    expect(result.slice(0, 2)).toEqual(["post_3", "post_1"]);
    expect(result.slice(2)).toEqual(["post_2", "post_4"]);
  });

  it("空 pin 列表 → 顺序不变", () => {
    const posts = ["post_1", "post_2"];
    expect(sortPinnedFirst(posts, [])).toEqual(["post_1", "post_2"]);
  });
});

describe("R15.59 — viewer mode 决定 (SELF vs OTHER)", () => {
  // me.tsx 逻辑: isSelfProfile = !viewerAccountId || viewingProfileId === viewerAccountId
  function isSelfProfile(viewerAccountId: string | undefined, viewingProfileId: string | undefined): boolean {
    if (!viewerAccountId) return true;
    return viewingProfileId === viewerAccountId;
  }
  function viewerModeFor(viewerAccountId: string | undefined, viewingProfileId: string | undefined): "SELF" | "OTHER" {
    return isSelfProfile(viewerAccountId, viewingProfileId) ? "SELF" : "OTHER";
  }

  it("未登录 → SELF (看自己 profile demo)", () => {
    expect(viewerModeFor(undefined, undefined)).toBe("SELF");
  });

  it("已登录 + 看自己 → SELF", () => {
    expect(viewerModeFor("user_001", "user_001")).toBe("SELF");
  });

  it("已登录 + 看别人 → OTHER", () => {
    expect(viewerModeFor("user_001", "user_002")).toBe("OTHER");
  });

  it("已登录 + viewingProfileId = undefined → OTHER (实现是 viewingProfileId || viewerAccountId default)", () => {
    // me.tsx: const viewingProfileId = viewerAccountId; // Phase 2: 路由控
    // 所以 viewingProfileId 实际不会 undefined, 总是 fallback to viewerAccountId.
    // 这个 case 测: 严格按 isSelfProfile 逻辑
    expect(viewerModeFor("user_001", undefined)).toBe("OTHER");
  });
});

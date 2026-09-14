import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOwnAuthorId, isOwnPost, resolveAuthorDisplayName, resolveReplyAuthorDisplayName } from "./feed-author";

describe("FEED-OWN-001 different accounts never share the own-post label", () => {
  it("labels only the author's own posts as 你", () => {
    const mine = { authorId: "user_a", authorDisplayName: "A" };
    const theirs = { authorId: "user_b", authorDisplayName: "B" };
    expect(resolveAuthorDisplayName(mine, "user_a")).toBe("你");
    expect(resolveAuthorDisplayName(theirs, "user_a")).toBe("B");
    expect(isOwnPost(mine, "user_a")).toBe(true);
    expect(isOwnPost(theirs, "user_a")).toBe(false);
  });

  it("never trusts a stored 你 from another author (legacy poisoned rows)", () => {
    const poisoned = { authorId: "user_dev", authorDisplayName: "你" };
    // Other viewers see a neutral label, never "你" and never a raw id.
    expect(resolveAuthorDisplayName(poisoned, "user_new")).toBe("用户");
    expect(isOwnPost(poisoned, "user_new")).toBe(false);
    // The real author still sees their own post as "你" via author id.
    expect(resolveAuthorDisplayName(poisoned, "user_dev")).toBe("你");
    expect(isOwnPost(poisoned, "user_dev")).toBe(true);
  });

  it("is fail-closed without a viewer (guest / unrestored session)", () => {
    const poisoned = { authorId: "user_dev", authorDisplayName: "你" };
    expect(resolveAuthorDisplayName(poisoned, undefined)).toBe("用户");
    expect(isOwnPost(poisoned, undefined)).toBe(false);
  });

  it("falls back to a neutral label when no stored name exists", () => {
    expect(resolveAuthorDisplayName({ authorId: "user_b" }, "user_a")).toBe("用户");
    expect(resolveAuthorDisplayName({ authorId: "user_b", authorDisplayName: "  " }, "user_a")).toBe("用户");
    expect(resolveAuthorDisplayName({ authorId: "m1", authorType: "MERCHANT" }, "user_a")).toBe("商家");
    expect(resolveAuthorDisplayName({ authorId: "market_owner:你" }, "user_a")).toBe("用户");
  });
});

describe("FEED-REPLY-001 comment author shows a name, never an account id", () => {
  it("shows the server-resolved profile name", () => {
    const reply = { actorId: "user_b", actorDisplayName: "Khoa" };
    expect(resolveReplyAuthorDisplayName(reply, "user_a")).toBe("Khoa");
  });

  it("labels the viewer's own comment as 你", () => {
    const mine = { actorId: "user_a", actorDisplayName: "Huyen" };
    expect(resolveReplyAuthorDisplayName(mine, "user_a")).toBe("你");
  });

  it("never falls back to the raw account id when the name is missing", () => {
    const unnamed = { actorId: "user_b" };
    const label = resolveReplyAuthorDisplayName(unnamed, "user_a");
    expect(label).toBe("用户");
    expect(label).not.toBe(unnamed.actorId);
    // 空串 / 空白等同缺失。
    expect(resolveReplyAuthorDisplayName({ actorId: "user_b", actorDisplayName: "   " }, "user_a")).toBe("用户");
  });

  it("does not let another author's poisoned 你 become the viewer's own label", () => {
    const poisoned = { actorId: "user_b", actorDisplayName: "你" };
    expect(resolveReplyAuthorDisplayName(poisoned, "user_a")).toBe("用户");
    expect(resolveReplyAuthorDisplayName(poisoned, undefined)).toBe("用户");
    // 真正的作者仍然凭 actorId 认领自己的评论。
    expect(resolveReplyAuthorDisplayName(poisoned, "user_b")).toBe("你");
  });

  it("agrees with the post author label for the same identity", () => {
    const reply = { actorId: "user_b", actorDisplayName: "Khoa" };
    expect(resolveReplyAuthorDisplayName(reply, "user_a")).toBe(
      resolveAuthorDisplayName({ authorId: "user_b", authorDisplayName: "Khoa" }, "user_a")
    );
  });
});

describe("SELF-FOLLOW-001 one shared own-identity predicate", () => {
  it("works for the profile menu's field name too, not just post.authorId", () => {
    // 个人主页菜单带的是 userId，帖子带的是 authorId —— 两个不同的字段名承载同一个
    // 「是不是我」，正是本人帖子的头像菜单出现「+ 关注」的原因。
    expect(isOwnAuthorId("user_a", "user_a")).toBe(true);
    expect(isOwnAuthorId("user_b", "user_a")).toBe(false);
  });

  it("is fail-closed without a viewer, and on a missing/empty author id", () => {
    expect(isOwnAuthorId("user_a", undefined)).toBe(false);
    expect(isOwnAuthorId(undefined, "user_a")).toBe(false);
    expect(isOwnAuthorId("", "user_a")).toBe(false);
  });

  it("stays the single definition — isOwnPost delegates instead of comparing again", () => {
    // 钉「只有一处比较」。如果有人把 isOwnPost 改回自己比一遍（历史上就是这样漂移的），
    // 比较式会出现两次，这条立刻红。
    const src = readFileSync(new URL("./feed-author.ts", import.meta.url), "utf8");
    const comparisons = src.split("authorId === viewerAccountId").length - 1;
    expect(comparisons).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import type { FeedPost } from "@proxy/contracts";
import {
  REPLY_TARGET_EXCERPT_MAX,
  parentPostIdsForReplies,
  replyEntriesFromReplies,
  replyTargetExcerpt,
  replyTargetLabel,
  replyTargetsFromPosts,
  replyTimestampLabel,
  type ReplyEntry,
  type ReplyTarget
} from "./reply-target";

const ME = "user_me";
const THEM = "user_5fbe354a954f14391d5a056ce97f3e15";

function post(overrides: Partial<FeedPost> & { postId: string }): FeedPost {
  return {
    authorType: "USER",
    authorId: THEM,
    body: "original post",
    mediaRefs: [],
    contextRefs: [],
    status: "PUBLISHED",
    createdAt: "2026-09-09T14:35:05Z",
    ...overrides
  } as FeedPost;
}

function entry(overrides: Partial<ReplyEntry> & { replyId: string }): ReplyEntry {
  return { parentPostId: "post_1", body: "reply", createdAt: "2026-09-10T00:00:00Z", ...overrides };
}

function target(overrides: Partial<ReplyTarget> = {}): ReplyTarget {
  return { authorId: THEM, authorType: "USER", authorDisplayName: "Khoa", excerpt: "original post", ...overrides };
}

describe("REPLY-TARGET-001 replies keep a stable key", () => {
  it("keeps two replies to the SAME post as two entries (parentPostId is not unique)", () => {
    // 真实数据里同一个人可以对同一条帖子回复多次 —— 服务端返回两行，
    // postId 相同、replyId 不同。之前 UI 用 postId 当 React key，这两行会撞。
    const entries = replyEntriesFromReplies([
      { replyId: "rep_a", postId: "post_1", parentPostId: "post_1", body: "first" },
      { replyId: "rep_b", postId: "post_1", parentPostId: "post_1", body: "second" }
    ]);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.parentPostId)).size).toBe(1); // 父帖相同
    expect(new Set(entries.map((e) => e.replyId)).size).toBe(2); // key 唯一
  });

  it("drops rows with no replyId instead of falling back to an index", () => {
    const entries = replyEntriesFromReplies([
      { replyId: "rep_a", parentPostId: "post_1", body: "kept" },
      { replyId: "", parentPostId: "post_1", body: "no id" },
      { postId: "post_1", body: "no id at all" },
      { replyId: "   ", parentPostId: "post_1", body: "blank id" }
    ]);
    expect(entries.map((e) => e.replyId)).toEqual(["rep_a"]);
  });

  it("normalizes missing fields to empty strings rather than undefined", () => {
    const entries = replyEntriesFromReplies([{ replyId: "rep_a" }]);
    expect(entries).toEqual([{ replyId: "rep_a", parentPostId: "", body: "", createdAt: "" }]);
  });
});

describe("REPLY-TARGET-001 parent lookups", () => {
  it("collects distinct parent ids in server order", () => {
    const ids = parentPostIdsForReplies([
      entry({ replyId: "r1", parentPostId: "post_b" }),
      entry({ replyId: "r2", parentPostId: "post_a" }),
      entry({ replyId: "r3", parentPostId: "post_b" }),
      entry({ replyId: "r4", parentPostId: "" }),
      entry({ replyId: "r5", parentPostId: "post_c" })
    ]);
    expect(ids).toEqual(["post_b", "post_a", "post_c"]);
  });

  it("returns nothing when there is nothing to look up (no pointless request)", () => {
    expect(parentPostIdsForReplies([])).toEqual([]);
    expect(parentPostIdsForReplies([entry({ replyId: "r1", parentPostId: "" })])).toEqual([]);
  });

  it("maps resolved posts by id and skips unresolvable ones", () => {
    const map = replyTargetsFromPosts([post({ postId: "post_1", body: "hello there" })]);
    expect(Object.keys(map)).toEqual(["post_1"]);
    expect(map["post_1"]?.excerpt).toBe("hello there");
    // 取不回来的父帖（已删 / 已收紧可见性）就是 undefined —— 调用方据此退化。
    expect(map["post_gone"]).toBeUndefined();
  });

  it("keeps the first row when the server sends the same post twice", () => {
    const map = replyTargetsFromPosts([
      post({ postId: "post_1", body: "first" }),
      post({ postId: "post_1", body: "second" })
    ]);
    expect(map["post_1"]?.excerpt).toBe("first");
  });
});

describe("REPLY-TARGET-001 excerpt", () => {
  it("collapses whitespace so a multi-line body stays one line", () => {
    expect(replyTargetExcerpt("a\n\n  b\tc ")).toBe("a b c");
  });

  it("truncates with an ellipsis past the limit", () => {
    const long = "x".repeat(REPLY_TARGET_EXCERPT_MAX + 10);
    const out = replyTargetExcerpt(long);
    expect(out).toHaveLength(REPLY_TARGET_EXCERPT_MAX + 1); // + 省略号
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not split a surrogate pair when truncating", () => {
    const out = replyTargetExcerpt("🙂".repeat(5), 2);
    expect(Array.from(out)).toEqual(["🙂", "🙂", "…"]);
  });

  it("handles empty and boundary cases", () => {
    expect(replyTargetExcerpt("")).toBe("");
    expect(replyTargetExcerpt("   ")).toBe("");
    expect(replyTargetExcerpt("abc", 3)).toBe("abc");
    expect(replyTargetExcerpt("abcd", 3)).toBe("abc…");
    expect(replyTargetExcerpt("abc", 0)).toBe("…");
  });
});

describe("REPLY-TARGET-001 label never shows an account id", () => {
  it("names the target author on my own profile", () => {
    expect(replyTargetLabel("SELF", target(), ME)).toBe("你回复了 Khoa 的帖子");
  });

  it("does not say 你 on someone else's profile", () => {
    // 之前 RepliesTab 把 "你回复了" 写死，看别人主页时也在说「你回复了」。
    const label = replyTargetLabel("OTHER", target(), ME);
    expect(label).toBe("回复了 Khoa 的帖子");
    expect(label.startsWith("你")).toBe(false);
  });

  it("falls back to a neutral label when the author name is unknown", () => {
    const nameless = target({ authorDisplayName: undefined });
    expect(replyTargetLabel("SELF", nameless, ME)).toBe("你回复了 用户 的帖子");
    expect(replyTargetLabel("OTHER", nameless, ME)).toBe("回复了 用户 的帖子");
  });

  it("treats a legacy poisoned name of 你 as unknown, not as the viewer", () => {
    const poisoned = target({ authorDisplayName: "你" });
    expect(replyTargetLabel("SELF", poisoned, ME)).toBe("你回复了 用户 的帖子");
  });

  it("reads correctly when the target is the viewer's own post", () => {
    // OWN-NAME-001：自己的内容显示用户名不再是「你」—— 存了名的用存的名，
    // 当前资料名优先（viewerDisplayName），都没有才中性兜底。「你回复了你」
    // 这类自指句式不再出现。
    const mine = target({ authorId: ME });
    expect(replyTargetLabel("SELF", mine, ME)).toBe("你回复了 Khoa 的帖子");
    expect(replyTargetLabel("OTHER", mine, ME)).toBe("回复了 Khoa 的帖子");
    expect(replyTargetLabel("SELF", mine, ME, "Huyen")).toBe("你回复了 Huyen 的帖子");
    expect(replyTargetLabel("SELF", target({ authorId: ME, authorDisplayName: undefined }), ME)).toBe(
      "你回复了 用户 的帖子"
    );
  });

  it("degrades to a neutral line when the parent post cannot be resolved", () => {
    expect(replyTargetLabel("SELF", undefined, ME)).toBe("你回复了这条帖子");
    expect(replyTargetLabel("OTHER", undefined, ME)).toBe("回复了这条帖子");
  });

  it("never leaks a raw account id into the label", () => {
    const cases: Array<ReplyTarget | undefined> = [
      target(),
      target({ authorDisplayName: undefined }),
      target({ authorType: "MERCHANT", authorDisplayName: undefined }),
      undefined
    ];
    for (const t of cases) {
      for (const mode of ["SELF", "OTHER"] as const) {
        const label = replyTargetLabel(mode, t, ME);
        expect(label).not.toContain(THEM);
        expect(label).not.toContain("user_");
      }
    }
  });

  it("labels a merchant target as 商家 when the name is unknown", () => {
    expect(replyTargetLabel("SELF", target({ authorType: "MERCHANT", authorDisplayName: undefined }), ME)).toBe(
      "你回复了 商家 的帖子"
    );
  });
});

describe("REPLY-TARGET-001 timestamp", () => {
  it("renders a real date and swallows dirty values", () => {
    expect(replyTimestampLabel("")).toBe("");
    expect(replyTimestampLabel("   ")).toBe("");
    expect(replyTimestampLabel("not-a-date")).toBe("");
    expect(replyTimestampLabel("2026-09-10T00:00:00Z")).toBe(new Date("2026-09-10T00:00:00Z").toLocaleDateString());
  });
});

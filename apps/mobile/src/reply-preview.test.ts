import { describe, expect, it } from "vitest";
import {
  REPLY_PREVIEW_LIMIT,
  hiddenReplyCount,
  repliesMatchingFirst,
  shouldOfferReplyToggle,
  visibleReplies
} from "./reply-preview";

const many = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

describe("FEED-REPLY-002 comments are never fully collapsed", () => {
  it("previews 5 comments without a toggle when there are 5 or fewer", () => {
    const five = ["c1", "c2", "c3", "c4", "c5"];
    expect(visibleReplies(five, false)).toEqual(five);
    expect(hiddenReplyCount(five.length)).toBe(0);
    expect(shouldOfferReplyToggle(five.length)).toBe(false);
    // 3 条也要全部显示 —— 评论不允许「一条都看不到」。
    expect(visibleReplies(["c1", "c2", "c3"], false)).toEqual(["c1", "c2", "c3"]);
  });

  it("shows the first 5 and hides only the rest when there are more than 5", () => {
    expect(REPLY_PREVIEW_LIMIT).toBe(5);
    expect(visibleReplies(many, false)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(hiddenReplyCount(many.length)).toBe(2);
    expect(shouldOfferReplyToggle(many.length)).toBe(true);
  });

  it("shows every comment once expanded", () => {
    expect(visibleReplies(many, true)).toEqual(many);
    expect(hiddenReplyCount(many.length)).toBe(2); // 折叠条数不变，只是不再遮挡
  });

  it("keeps server order (oldest first) instead of reordering", () => {
    expect(visibleReplies(many, false)[0]).toBe("c1");
    expect(visibleReplies(many, true)[0]).toBe("c1");
  });

  it("handles the empty and boundary cases", () => {
    expect(visibleReplies([], false)).toEqual([]);
    expect(visibleReplies([], true)).toEqual([]);
    expect(hiddenReplyCount(0)).toBe(0);
    expect(shouldOfferReplyToggle(0)).toBe(false);
    expect(visibleReplies(["c1", "c2", "c3", "c4", "c5", "c6"], false)).toHaveLength(5);
    expect(shouldOfferReplyToggle(6)).toBe(true);
  });
});

// SEARCH-CORPUS-003: 评论参与了动态搜索，但卡片只显示前 5 条 —— 一条帖子
// 可能因为第 17 条评论才出现在结果里。不把命中的那条排上来，用户找不到
// 「这条为什么在这儿」的答案，搜索就只是名义上支持了评论。
describe("SEARCH-CORPUS-003 repliesMatchingFirst", () => {
  const comments = [
    { body: "第一家" }, { body: "第二家" }, { body: "第三家" },
    { body: "第四家" }, { body: "第五家" }, { body: "这家河粉好吃" }
  ];

  it("puts the matching comment first so the preview explains the hit", () => {
    const ordered = repliesMatchingFirst(comments, (c) => c.body.includes("河粉"));
    expect(ordered[0]!.body).toBe("这家河粉好吃");
    // 关键：命中会导致帖子出现在搜索结果里，但被折叠在第 6 条 —— 排上来才看得见。
    expect(visibleReplies(ordered, false)[0]!.body).toBe("这家河粉好吃");
  });

  it("only reorders — never drops or duplicates a comment", () => {
    const ordered = repliesMatchingFirst(comments, (c) => c.body.includes("河粉"));
    expect(ordered).toHaveLength(comments.length);
    expect(new Set(ordered.map((c) => c.body))).toEqual(new Set(comments.map((c) => c.body)));
  });

  it("keeps the original order when nothing matches", () => {
    expect(repliesMatchingFirst(comments, () => false).map((c) => c.body))
      .toEqual(comments.map((c) => c.body));
  });

  it("handles empty and single-element lists", () => {
    expect(repliesMatchingFirst([], () => true)).toEqual([]);
    expect(repliesMatchingFirst(comments.slice(0, 1), () => true)).toEqual(comments.slice(0, 1));
  });
});

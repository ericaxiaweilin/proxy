import { describe, expect, it } from "vitest";
import {
  REPLY_PREVIEW_LIMIT,
  hiddenReplyCount,
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

import { describe, expect, it } from "vitest";
import { mergePostEngagement, mergeReactedPostIds } from "./post-engagement-model";

describe("POST-REACTION-TRUTH-001", () => {
  it("hydrates a fresh remount from server counts and viewer reaction", () => {
    const server = [{ postId: "post_1", followed: false, reactions: 37, replies: 4, reposts: 2, bookmarked: false, reacted: true }];
    expect(mergePostEngagement({}, server).post_1?.reactions).toBe(37);
    expect(mergeReactedPostIds(new Set(), server).has("post_1")).toBe(true);
  });

  it("applies unlike truth without inventing a local count", () => {
    const server = [{ postId: "post_1", followed: false, reactions: 36, replies: 4, reposts: 2, bookmarked: false, reacted: false }];
    expect(mergeReactedPostIds(new Set(["post_1"]), server).has("post_1")).toBe(false);
    expect(mergePostEngagement({}, server).post_1?.reactions).toBe(36);
  });
});

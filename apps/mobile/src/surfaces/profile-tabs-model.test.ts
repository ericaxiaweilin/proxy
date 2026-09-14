import { describe, expect, it } from "vitest";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import {
  PROFILE_TAB_ORDER,
  selectPinnedPostAndRest,
  selectPostMedia,
  visibleProfileTabs
} from "./profile-tabs-model";

const post = (postId: string): FeedPost => ({
  postId,
  authorType: "AGENT",
  authorId: "user_1",
  body: postId,
  status: "PUBLISHED",
  createdAt: "2026-09-04T00:00:00Z",
  contextRefs: [],
  mediaRefs: []
});

const media = (mediaAssetId: string): FeedMediaItem => ({
  mediaAssetId,
  mediaType: "IMAGE",
  galleryUrl: `/media/${mediaAssetId}`
} as FeedMediaItem);

describe("UI-PROFILE-001 — first post remains visible without a real pin", () => {
  it("keeps every post in the normal list when pinnedIds is empty", () => {
    const posts = [post("p1"), post("p2")];
    const result = selectPinnedPostAndRest(posts, []);
    expect(result.pinned).toBeUndefined();
    expect(result.rest.map((entry) => entry.postId)).toEqual(["p1", "p2"]);
  });

  it("removes only the actual pinned post rather than the first row", () => {
    const posts = [post("p1"), post("p2"), post("p3")];
    const result = selectPinnedPostAndRest(posts, ["p2"]);
    expect(result.pinned?.postId).toBe("p2");
    expect(result.rest.map((entry) => entry.postId)).toEqual(["p1", "p3"]);
  });

  it("does not hide content when the server returns a stale pin id", () => {
    const posts = [post("p1")];
    const result = selectPinnedPostAndRest(posts, ["missing"]);
    expect(result.pinned).toBeUndefined();
    expect(result.rest.map((entry) => entry.postId)).toEqual(["p1"]);
  });
});

describe("UI-PROFILE-002 — saved/tagged media comes only from matching posts", () => {
  it("does not substitute unrelated profile photos for an empty tagged list", () => {
    expect(selectPostMedia([], { unrelated: [media("m1")] })).toEqual([]);
  });

  it("returns media only for the supplied tagged or saved posts", () => {
    const result = selectPostMedia([post("tagged")], {
      tagged: [media("tagged-media")],
      unrelated: [media("private-photo")]
    });
    expect(result.map((entry) => entry.item.mediaAssetId)).toEqual(["tagged-media"]);
  });
});

describe("PROFILE-TABS-001 — a saved collection is private, not a profile tab", () => {
  it("gives the owner the full IG/Threads 5 tabs", () => {
    expect(visibleProfileTabs("SELF")).toEqual(PROFILE_TAB_ORDER);
    expect(visibleProfileTabs("SELF")).toContain("SAVED");
  });

  it("never shows SAVED on somebody else's profile", () => {
    const tabs = visibleProfileTabs("OTHER");
    expect(tabs).not.toContain("SAVED");
    expect(tabs).toEqual(["POSTS", "REPLIES", "TAGGED", "ABOUT"]);
  });

  it("fails closed when the viewer identity is unknown", () => {
    // 不知道看的人是谁 → 不给收藏。宁可少一个 tab，也不能把别人的私库摆出来。
    expect(visibleProfileTabs(undefined)).not.toContain("SAVED");
    expect(visibleProfileTabs(undefined)).toEqual(visibleProfileTabs("OTHER"));
  });

  it("keeps the remaining tabs in the IG/Threads order", () => {
    expect(PROFILE_TAB_ORDER).toEqual(["POSTS", "REPLIES", "SAVED", "TAGGED", "ABOUT"]);
    for (const mode of ["SELF", "OTHER", undefined] as const) {
      const tabs = visibleProfileTabs(mode);
      for (let i = 1; i < tabs.length; i += 1) {
        expect(PROFILE_TAB_ORDER.indexOf(tabs[i]!)).toBeGreaterThan(
          PROFILE_TAB_ORDER.indexOf(tabs[i - 1]!)
        );
      }
    }
  });

  it("hands back a fresh array so callers cannot mutate the tab order", () => {
    const first = visibleProfileTabs("SELF");
    first.pop();
    expect(visibleProfileTabs("SELF")).toEqual(PROFILE_TAB_ORDER);
  });
});

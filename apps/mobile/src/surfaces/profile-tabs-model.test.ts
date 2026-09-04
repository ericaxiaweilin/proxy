import { describe, expect, it } from "vitest";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import { selectPinnedPostAndRest, selectPostMedia } from "./profile-tabs-model";

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

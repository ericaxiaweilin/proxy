import { describe, expect, it } from "vitest";
import { createDraftMedia, draftMediaDragTarget, draftMediaRefs, moveDraftMedia, normalizeRestoredDraftMedia, pendingDraftMedia } from "./composer-media";

const image = { uri: "file:///portrait.jpg", width: 1200, height: 1800, mimeType: "image/jpeg" };

describe("composer media state", () => {
  it("keeps author order stable while moving one item", () => {
    const items = [createDraftMedia(image, "a"), createDraftMedia({ ...image, uri: "file:///b.jpg" }, "b")];
    expect(moveDraftMedia(items, 1, 0).map((item) => item.localId)).toEqual(["b", "a"]);
  });

  it("maps a horizontal drag to a clamped author-order slot", () => {
    expect(draftMediaDragTarget(1, 250, 236, 4)).toBe(2);
    expect(draftMediaDragTarget(2, -500, 236, 4)).toBe(0);
    expect(draftMediaDragTarget(0, -500, 236, 4)).toBe(0);
    expect(draftMediaDragTarget(3, 500, 236, 4)).toBe(3);
  });

  it("retries only media that is not already ready", () => {
    const ready = { ...createDraftMedia(image, "a"), status: "READY" as const, mediaAssetId: "media_a" };
    const failed = { ...createDraftMedia(image, "b"), status: "FAILED" as const, error: "network" };
    expect(pendingDraftMedia([ready, failed]).map((item) => item.localId)).toEqual(["b"]);
  });

  it("fails closed until every media item is ready and preserves alt text", () => {
    const local = createDraftMedia(image, "a");
    expect(draftMediaRefs([local])).toBeUndefined();
    expect(draftMediaRefs([{ ...local, status: "READY", mediaAssetId: "media_a", altText: "  河内街头全身照  " }])).toEqual([
      { mediaAssetId: "media_a", sortOrder: 0, altText: "河内街头全身照" }
    ]);
  });

  it("restores an interrupted upload as retryable instead of successful", () => {
    const uploading = { ...createDraftMedia(image, "a"), status: "UPLOADING" as const };
    expect(normalizeRestoredDraftMedia([uploading])[0]).toMatchObject({ status: "FAILED", error: "上传在后台中断，请重试" });
  });
});

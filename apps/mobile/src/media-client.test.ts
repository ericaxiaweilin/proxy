import { describe, expect, it, vi } from "vitest";
import { isRestartableUploadSessionStatus, uploadOriginalWithRetry } from "./media-upload-retry";
import { mediaTypeForMime, parseOwnReadyPhotos, parseTwinPhotoResult } from "./media-classify";

describe("composer media MIME routing", () => {
  it("routes GIF through the image pipeline without flattening its MIME", () => {
    expect(mediaTypeForMime("image/gif")).toBe("IMAGE");
  });

  it("routes video and audio to their native server pipelines", () => {
    expect(mediaTypeForMime("video/mp4")).toBe("VIDEO");
    expect(mediaTypeForMime("video/quicktime")).toBe("VIDEO");
    expect(mediaTypeForMime("audio/mp4")).toBe("AUDIO");
  });
});

describe("original media upload retry", () => {
  it("restarts expired or conflicting resumable sessions from the retained original", () => {
    expect(isRestartableUploadSessionStatus(404)).toBe(true);
    expect(isRestartableUploadSessionStatus(409)).toBe(true);
    expect(isRestartableUploadSessionStatus(401)).toBe(false);
    expect(isRestartableUploadSessionStatus(500)).toBe(false);
  });
  it("retries transient transport failures without recreating the media asset", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce(503)
      .mockResolvedValueOnce(204);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await uploadOriginalWithRetry(attempt, sleep);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 300);
    expect(sleep).toHaveBeenNthCalledWith(2, 900);
  });

  it("does not retry permanent validation failures", async () => {
    const attempt = vi.fn().mockResolvedValue(415);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(uploadOriginalWithRetry(attempt, sleep)).rejects.toThrow("415");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops immediately after user cancellation", async () => {
    const controller = new AbortController();
    const attempt = vi.fn().mockImplementation(async () => {
      controller.abort();
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(uploadOriginalWithRetry(attempt, sleep, 3, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("twin photo parsers (TWIN-PHOTO-SIM-001)", () => {
  it("keeps only own READY photos and skips one bad item without dropping the screen", () => {
    expect(parseOwnReadyPhotos({
      assets: [
        { mediaAssetId: "ma_ok", mediaType: "IMAGE", processingStatus: "READY", width: 640, height: 480 },
        { mediaAssetId: "ma_processing", mediaType: "IMAGE", processingStatus: "PROCESSING" },
        { mediaAssetId: "ma_video", mediaType: "VIDEO", processingStatus: "READY" },
        null,
        { mediaAssetId: "", mediaType: "IMAGE", processingStatus: "READY" },
      ],
    })).toEqual([{ mediaAssetId: "ma_ok", width: 640, height: 480 }]);
  });
  it("returns [] on malformed envelopes instead of throwing", () => {
    expect(parseOwnReadyPhotos(null)).toEqual([]);
    expect(parseOwnReadyPhotos({})).toEqual([]);
    expect(parseOwnReadyPhotos({ assets: "nope" })).toEqual([]);
  });
  it("accepts a simulated twin result only with the twinSimulated mark", () => {
    const good = {
      asset: { mediaAssetId: "ma_sim", width: 1080, height: 1440, twinSimulated: true, twinPersonaId: "aip_1" },
      template: "portrait", sourceAssetId: "ma_src",
    };
    expect(parseTwinPhotoResult(good)).toEqual({
      mediaAssetId: "ma_sim", width: 1080, height: 1440, simulated: true, template: "portrait", sourceAssetId: "ma_src",
    });
    // 掉了仿真标记的产物不得往下传（ badges/发布链路靠这个区分）。
    expect(parseTwinPhotoResult({ asset: { mediaAssetId: "ma_sim", twinSimulated: false, twinPersonaId: "aip_1" } })).toBeUndefined();
    expect(parseTwinPhotoResult({ asset: { mediaAssetId: "ma_sim", twinSimulated: true } })).toBeUndefined();
    expect(parseTwinPhotoResult(null)).toBeUndefined();
  });
});

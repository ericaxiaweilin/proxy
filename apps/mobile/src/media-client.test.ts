import { describe, expect, it, vi } from "vitest";
import { isRestartableUploadSessionStatus, uploadOriginalWithRetry } from "./media-upload-retry";

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

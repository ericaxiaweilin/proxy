import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, FeedMediaItemSchema, MAX_AUDIO_DURATION_MS, MediaVariantSchema } from "./index.js";

describe("command envelope", () => {
  it("rejects a command without idempotency", () => {
    const result = CommandEnvelopeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a canonical command envelope", () => {
    const result = CommandEnvelopeSchema.safeParse({
      commandId: "cmd_001",
      commandType: "FinalizeObservationSet",
      commandVersion: 1,
      actor: { type: "USER", id: "user_001" },
      principal: { type: "BUSINESS", id: "business_001" },
      target: { type: "ObservationSet", id: "obsset_001" },
      idempotencyKey: "idem_obsset_001",
      authContext: { sessionId: "session_001" },
      purpose: "outcome_observation",
      correlationId: "corr_001",
      requestedAt: "2026-08-14T00:00:00.000Z",
      payload: {}
    });
    expect(result.success).toBe(true);
  });
});

describe("social media pipeline contracts", () => {
  it("accepts a recipe-versioned gallery variant", () => {
    expect(MediaVariantSchema.parse({
      mediaVariantId: "mv_001",
      mediaAssetId: "ma_001",
      purpose: "GALLERY",
      recipeVersion: "image_recipe_v1",
      format: "image/jpeg",
      width: 1920,
      height: 2560,
      bytes: 840000,
      url: "/v1/media/variant/mv_001",
      contentHash: "sha256:abc",
      status: "READY"
    }).purpose).toBe("GALLERY");
  });

  it("keeps legacy URLs compatible while accepting purpose URLs", () => {
    const item = FeedMediaItemSchema.parse({
      mediaAssetId: "ma_001",
      mediaType: "IMAGE",
      thumbnailUrl: "/legacy/thumb",
      feedUrl: "/v1/media/variant/feed",
      galleryUrl: "/v1/media/variant/gallery",
      originalAvailable: true,
      width: 3024,
      height: 4032,
      aspectRatio: 0.75,
      processingStatus: "READY",
      moderationStatus: "APPROVED",
      sortOrder: 0
    });
    expect(item.galleryUrl).toContain("gallery");
  });
});

describe("AUDIO media (voice posts, ≤30s)", () => {
  it("accepts AUDIO as a FeedMediaItem mediaType", () => {
    const item = FeedMediaItemSchema.parse({
      mediaAssetId: "ma_audio_001",
      mediaType: "AUDIO",
      playbackUrl: "/v1/media/play/ma_audio_001",
      width: 0,
      height: 0,
      aspectRatio: 0,
      durationMs: 12_345,
      processingStatus: "READY",
      moderationStatus: "APPROVED",
      sortOrder: 0
    });
    expect(item.mediaType).toBe("AUDIO");
    expect(item.durationMs).toBe(12_345);
  });

  it("exposes MAX_AUDIO_DURATION_MS = 30s as the shared ceiling", () => {
    expect(MAX_AUDIO_DURATION_MS).toBe(30_000);
  });

  it("still rejects unknown media types", () => {
    expect(() =>
      FeedMediaItemSchema.parse({
        mediaAssetId: "ma_x",
        mediaType: "LIVE_STREAM",
        width: 0,
        height: 0,
        aspectRatio: 0,
        processingStatus: "READY",
        moderationStatus: "APPROVED",
        sortOrder: 0
      })
    ).toThrow();
  });
});

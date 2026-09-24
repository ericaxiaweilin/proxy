import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, FeedMediaItemSchema, ListFeedPostsPayloadSchema, MAX_AUDIO_DURATION_MS, MediaVariantSchema } from "./index";

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
      dominantColorHex: "#C8B49A",
      originalAvailable: true,
      width: 3024,
      height: 4032,
      aspectRatio: 0.75,
      processingStatus: "READY",
      moderationStatus: "APPROVED",
      sortOrder: 0
    });
    expect(item.galleryUrl).toContain("gallery");
    expect(item.dominantColorHex).toBe("#C8B49A");
  });
});

describe("FeedMediaItem AI provenance (LC-06)", () => {
  const base = {
    mediaAssetId: "ma_ai_001",
    mediaType: "IMAGE" as const,
    width: 1024,
    height: 1024,
    aspectRatio: 1,
    processingStatus: "READY",
    moderationStatus: "APPROVED" as const,
    sortOrder: 0
  };

  it("carries the closed set declared by media_assets.ai_generation_source", () => {
    for (const source of ["USER_UPLOADED", "AI_PERSONA", "MODEL_API", "UNKNOWN"] as const) {
      expect(FeedMediaItemSchema.parse({ ...base, aiGenerationSource: source }).aiGenerationSource).toBe(source);
    }
  });

  it("rejects a provenance value outside the DB closed set", () => {
    // migration 108 的 CHECK 只认这四个。契约这边放宽，客户端就会见到它无法归类的
    // 值 —— 而「AI 做的就标注」这条规则正是靠这个字段判定，归不了类就判不了。
    expect(FeedMediaItemSchema.safeParse({ ...base, aiGenerationSource: "AI_GENERATED" }).success).toBe(false);
  });

  it("stays parseable when the field is absent (backward compat)", () => {
    // 向后兼容是本 schema 的既有约定；「服务端不会悄悄丢掉它」由 Go 侧钉住。
    expect(FeedMediaItemSchema.parse(base).aiGenerationSource).toBeUndefined();
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

  // R15.14: LocationContext 顶 chip 真的影响 feed — 服务器在
  // ListFeedPostsPayload 多了两个 echo 字段 (viewingCity,
  // unfiltered) 证明 filter 跟顶 chip 同源。
  it("ListFeedPostsPayload accepts viewingCity echo (LocationContext filter evidence)", () => {
    const parsed = ListFeedPostsPayloadSchema.parse({
      posts: [],
      media: {},
      note: "R15.14 contract smoke",
      viewingCity: "河内",
      unfiltered: false
    });
    expect(parsed.viewingCity).toBe("河内");
    expect(parsed.unfiltered).toBe(false);
  });

  it("ListFeedPostsPayload treats viewingCity as optional (legacy callers unaffected)", () => {
    // R15.13 P4 / R14 client code 调 listFeedPosts() 不传 viewingCity
    // — server 现在 echo 空 + unfiltered=true。schema 不能 reject
    // 老 shape，否则 client 升级中转 P4 → P14 出现类型竞争。
    const parsed = ListFeedPostsPayloadSchema.parse({ posts: [], media: {} });
    expect(parsed.viewingCity).toBeUndefined();
    expect(parsed.unfiltered).toBeUndefined();
  });

  // R15.15 P1: Post.SceneType 字段 — 解锁 per-(city, sceneType)
  // 背景缓存。
  it("FeedPostSchema accepts sceneType (per-(city, sceneType) backdrop unlock)", () => {
    const parsed = ListFeedPostsPayloadSchema.parse({
      posts: [{
        postId: "p1", authorType: "AGENT", authorId: "u1",
        body: "rooftop", status: "PUBLISHED", createdAt: "2026-08-28T00:00:00Z",
        cityScope: "河内", sceneType: "ROOFTOP"
      }],
      media: {}
    });
    expect(parsed.posts[0]?.sceneType).toBe("ROOFTOP");
  });

  it("FeedPostSchema rejects unknown sceneType (fail-closed on contract drift)", () => {
    // 如果 server 调 CreatePost 接受 WHATEVER_THIS_IS，client
    // 拿到的 sceneType 就不在 zod 联合里 — schema 需 reject。
    const result = ListFeedPostsPayloadSchema.safeParse({
      posts: [{
        postId: "p1", authorType: "AGENT", authorId: "u1",
        body: "x", status: "PUBLISHED", createdAt: "2026-08-28T00:00:00Z",
        sceneType: "WHATEVER_THIS_IS"
      }],
      media: {}
    });
    expect(result.success).toBe(false);
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

  // R15.17: content rejection statuses — 扩入 3 个新 status
  // (NUDITY / POLITICS / VIOLENCE), 仍只 admin ReviewMediaAsset 写入。
  it("R15.17 accepts the three content rejection statuses", () => {
    for (const status of [
      "REJECTED_CONTENT_NUDITY",
      "REJECTED_CONTENT_POLITICS",
      "REJECTED_CONTENT_VIOLENCE"
    ]) {
      const item = FeedMediaItemSchema.parse({
        mediaAssetId: "ma_r1517",
        mediaType: "IMAGE",
        width: 100,
        height: 100,
        aspectRatio: 1.0,
        processingStatus: "READY",
        moderationStatus: status,
        sortOrder: 0
      });
      expect(item.moderationStatus).toBe(status);
    }
  });

  it("R15.17 still rejects unknown moderation status", () => {
    expect(() =>
      FeedMediaItemSchema.parse({
        mediaAssetId: "ma_r1517_bad",
        mediaType: "IMAGE",
        width: 100,
        height: 100,
        aspectRatio: 1.0,
        processingStatus: "READY",
        moderationStatus: "REJECTED_CONTENT_OTHER",
        sortOrder: 0
      })
    ).toThrow();
  });
});

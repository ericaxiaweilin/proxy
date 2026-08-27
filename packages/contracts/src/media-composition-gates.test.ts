// Proxy Social Media Pipeline §5.2.1 / §5.2.2 / Gate 3 — 5 档自动验收。
//
// 每个测试都是一条 gate：失败 = 拒绝合入。这不是单测，是 release gate。
// 改任意一行对应产品代码前先看这些 case —— case 描述就是契约。

import { describe, expect, it } from "vitest";
import {
  FRAME_BACKGROUND_HEX,
  resolveFillStrategy,
  canSafelyCover,
  resolveFrameBackground,
  shouldUseExtendedBackdrop,
  selectVariantForViewport,
  selectVideoPlaybackUrl,
  isForbiddenInFeed,
  isFrameBackgroundSafe,
  selectImageShape,
  FEED_WIDE_BREAKPOINT_PT,
  V2_HINT_CONFIDENCE_THRESHOLD,
  PREFERRED_FORWARD_BUFFER_SECONDS,
  COLD_START_TO_FIRST_FRAME_BUDGET_MS,
  shouldPreloadVideo,
  FULLSCREEN_MODE
} from "./media-composition";


const PORTRAIT_4_5 = 4 / 5; // 0.8
const PORTRAIT_9_16 = 9 / 16; // 0.5625
const LANDSCAPE_3_2 = 3 / 2; // 1.5

describe("人物安全裁剪几何", () => {
  it("9:16 全身安全区无法装进 4:5 cover，必须完整展示", () => {
    const safeRect = { x: 0.2, y: 0.02, width: 0.6, height: 0.96 };
    expect(canSafelyCover({ safeRect, sourceAspect: PORTRAIT_9_16, frameAspect: PORTRAIT_4_5 })).toBe(false);
    expect(resolveFillStrategy({
      hint: { subjectType: "PERSON", subjectCount: 1, faceBoxes: [], bodyBoxes: [], safeCropRect: safeRect, confidence: 0.95, recipeVersion: "test" },
      sourceAspect: PORTRAIT_9_16,
      frameAspect: PORTRAIT_4_5
    })).toBe("contain");
  });

  it("4:5 半身安全区可装进相同比例，允许安全铺满", () => {
    const safeRect = { x: 0.12, y: 0.04, width: 0.76, height: 0.82 };
    expect(canSafelyCover({ safeRect, sourceAspect: PORTRAIT_4_5, frameAspect: PORTRAIT_4_5 })).toBe(true);
    expect(resolveFillStrategy({
      hint: { subjectType: "PERSON", subjectCount: 1, faceBoxes: [], bodyBoxes: [], safeCropRect: safeRect, confidence: 0.95, recipeVersion: "test" },
      sourceAspect: PORTRAIT_4_5,
      frameAspect: PORTRAIT_4_5
    })).toBe("cover");
  });

  it("横向多人联合安全区过宽时不允许窄画布 cover", () => {
    expect(canSafelyCover({
      safeRect: { x: 0.03, y: 0.15, width: 0.94, height: 0.7 },
      sourceAspect: 16 / 9,
      frameAspect: 1
    })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Gate A — Variant Selection (档位选择)
//
// 不变量：屏宽 < 410pt 必须用 FEED_1X (1080px)；>= 410pt 必须用 FEED_2X (1600px)；
// 2x 缺失时降级 1x；都缺失时降级 galleryUrl；都不存在返回 undefined。
// 这条对应 §5.2 性能预算"高密度屏不拉伸；低密度屏不浪费流量"。
// -----------------------------------------------------------------------------

describe("Gate A · selectVariantForViewport", () => {
  const fullItem = {
    feedUrl: "/v1/.../FEED_1X",
    feed2xUrl: "/v1/.../FEED_2X",
    galleryUrl: "/v1/.../GALLERY",
    thumbnailUrl: "/v1/.../THUMB",
    playbackUrl: "/v1/.../PLAY"
  };

  it("A1 · iPhone 393pt → FEED_1X", () => {
    const sel = selectVariantForViewport(fullItem, 393);
    expect(sel.purpose).toBe("FEED_1X");
    expect(sel.url).toBe("/v1/.../FEED_1X");
  });

  it("A2 · iPhone Pro Max 430pt → FEED_2X", () => {
    const sel = selectVariantForViewport(fullItem, 430);
    expect(sel.purpose).toBe("FEED_2X");
    expect(sel.url).toBe("/v1/.../FEED_2X");
  });

  it("A3 · iPad 768pt → FEED_2X", () => {
    const sel = selectVariantForViewport(fullItem, 768);
    expect(sel.purpose).toBe("FEED_2X");
    expect(sel.url).toBe("/v1/.../FEED_2X");
  });

  it("A4 · iPad Pro 1024pt → FEED_2X", () => {
    const sel = selectVariantForViewport(fullItem, 1024);
    expect(sel.purpose).toBe("FEED_2X");
    expect(sel.url).toBe("/v1/.../FEED_2X");
  });

  it("A5 · 边界 410pt (inclusive) → FEED_2X", () => {
    const sel = selectVariantForViewport(fullItem, 410);
    expect(sel.purpose).toBe("FEED_2X");
  });

  it("A6 · 边界 409pt → FEED_1X", () => {
    const sel = selectVariantForViewport(fullItem, 409);
    expect(sel.purpose).toBe("FEED_1X");
  });

  it("A7 · 小屏 320pt → FEED_1X", () => {
    const sel = selectVariantForViewport(fullItem, 320);
    expect(sel.purpose).toBe("FEED_1X");
    expect(sel.url).toBe("/v1/.../FEED_1X");
  });

  it("A8 · 2x 缺失时降级 1x（不返 undefined）", () => {
    const sel = selectVariantForViewport(
      { feedUrl: "/1x", galleryUrl: "/g" },
      430
    );
    expect(sel.purpose).toBe("FEED_2X");
    expect(sel.url).toBe("/1x");
  });

  it("A9 · 1x/2x 全缺时降级 galleryUrl", () => {
    const sel = selectVariantForViewport(
      { galleryUrl: "/g" },
      430
    );
    expect(sel.purpose).toBe("FEED_2X");
    expect(sel.url).toBe("/g");
  });

  it("A10 · 完全空 item → undefined（不抛错）", () => {
    const sel = selectVariantForViewport({}, 393);
    expect(sel.url).toBeUndefined();
  });

  it("A11 · 完全空 item wide → undefined（不抛错）", () => {
    const sel = selectVariantForViewport({}, 430);
    expect(sel.url).toBeUndefined();
  });

  it("A12 · 断点常量 = 410 (iPhone Pro Max 起点)", () => {
    expect(FEED_WIDE_BREAKPOINT_PT).toBe(410);
  });

  // -------------------------------------------------------------------
  // Gate A v2 — compositionHint 准入 + HINT/NATURAL 优先级
  //   v2 派生：1X_HINT (按 safeCropRect cover) / 1X_NATURAL (原比例 contain + 深紫黑补边)
  //   v2 准入阈值 confidence ≥ 0.4（与服务端 image_variants_v2.go:LowConfidenceThreshold 一致）
  // -------------------------------------------------------------------

  it("A13 · 1X + hint=0.4 + feed2xHintUrl → FEED_1X_HINT (不裁主体)", () => {
    const sel = selectVariantForViewport(
      {
        feedUrl: "/1x",
        feed2xUrl: "/2x",
        feed2xHintUrl: "/1x_hint",
        feed2xNaturalUrl: "/1x_natural",
        compositionHint: { confidence: 0.4 },
      },
      393
    );
    expect(sel.purpose).toBe("FEED_1X_HINT");
    expect(sel.url).toBe("/1x_hint");
  });

  it("A14 · 1X + hint=0.39 (<0.4) → 走普通 FEED_1X (不进 v2)", () => {
    // 低置信度：hasV2Hint=false, 跳到降级链。
    // 旧 selectVariantForViewport 降级链含 feed2xUrl (此处不提供)，会走到 feedUrl。
    // 关键不变量：purpose 不是 FEED_1X_HINT/NATURAL。
    const sel = selectVariantForViewport(
      {
        feedUrl: "/1x",
        feed2xHintUrl: "/1x_hint",
        feed2xNaturalUrl: "/1x_natural",
        compositionHint: { confidence: 0.39 },
      },
      393
    );
    expect(sel.purpose).toBe("FEED_1X");
    expect(sel.url).toBe("/1x");
  });

  it("A15 · 1X + hint 准入 + HINT 缺失 → 降级 NATURAL", () => {
    const sel = selectVariantForViewport(
      {
        feedUrl: "/1x",
        feed2xNaturalUrl: "/1x_natural",
        compositionHint: { confidence: 0.9 },
      },
      393
    );
    expect(sel.purpose).toBe("FEED_1X_NATURAL");
    expect(sel.url).toBe("/1x_natural");
  });

  it("A16 · 1X + hint 准入 + HINT/NATURAL 全缺 → 降级普通 FEED_1X", () => {
    const sel = selectVariantForViewport(
      {
        feedUrl: "/1x",
        feed2xUrl: "/2x",
        compositionHint: { confidence: 0.9 },
      },
      393
    );
    expect(sel.purpose).toBe("FEED_1X");
    expect(sel.url).toBe("/1x");
  });

  it("A17 · 宽屏 (430pt) + hint 准入 → 仍走普通 FEED_2X (v2 没 2X 档)", () => {
    const sel = selectVariantForViewport(
      {
        feedUrl: "/1x",
        feed2xUrl: "/2x",
        feed2xHintUrl: "/1x_hint",
        feed2xNaturalUrl: "/1x_natural",
        compositionHint: { confidence: 0.9 },
      },
      430
    );
    expect(sel.purpose).toBe("FEED_2X");
    expect(sel.url).toBe("/2x");
  });

  it("A18 · 1X + 无 hint 字段 → 不进 v2, 走普通 FEED_1X", () => {
    const sel = selectVariantForViewport(
      { feedUrl: "/1x", feed2xHintUrl: "/1x_hint" },
      393
    );
    expect(sel.purpose).toBe("FEED_1X");
    expect(sel.url).toBe("/1x");
  });

  it("A19 · V2_HINT_CONFIDENCE_THRESHOLD = 0.4 (与 LowConfidenceThreshold 同步)", () => {
    expect(V2_HINT_CONFIDENCE_THRESHOLD).toBe(0.4);
  });

  it("A20 · HINT 优先于 NATURAL（同时存在时选 HINT）", () => {
    const sel = selectVariantForViewport(
      {
        feed2xHintUrl: "/1x_hint",
        feed2xNaturalUrl: "/1x_natural",
        compositionHint: { confidence: 0.9 },
      },
      393
    );
    expect(sel.purpose).toBe("FEED_1X_HINT");
    expect(sel.url).toBe("/1x_hint");
  });
});

// -----------------------------------------------------------------------------
// Gate B — Fill Strategy (填充策略)
//
// 不变量：低置信度 (<0.4) 必须 contain（人像 9:16 / 商品 / 文字）；
// TEXT_HEAVY / 人物 / 商品只有安全区确实容得下 cover 裁剪窗口才铺满；否则 contain。
// -----------------------------------------------------------------------------

describe("Gate B · resolveFillStrategy", () => {
  it("B1 · 无 hint → contain（不中心裁）", () => {
    expect(
      resolveFillStrategy({ hint: undefined, sourceAspect: PORTRAIT_4_5, frameAspect: 1 })
    ).toBe("contain");
  });

  it("B2 · 置信度 0.39 (< 0.4) → contain", () => {
    expect(
      resolveFillStrategy({
        hint: { subjectType: "PERSON", subjectCount: 1, faceBoxes: [], bodyBoxes: [], confidence: 0.39, recipeVersion: "v1" },
        sourceAspect: PORTRAIT_4_5,
        frameAspect: 1
      })
    ).toBe("contain");
  });

  it("B3 · 置信度 0.40 (= 0.4) 但比例不同 → 仍完整展示", () => {
    // PERSON + safeCropRect 完整 → cover
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "PERSON", subjectCount: 1, faceBoxes: [], bodyBoxes: [],
          safeCropRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          confidence: 0.4, recipeVersion: "v1"
        },
        sourceAspect: PORTRAIT_4_5,
        frameAspect: 1
      })
    ).toBe("contain");
  });

  it("B4 · 9:16 PERSON 的全图安全区装不进 4:5 → contain", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "PERSON", subjectCount: 1, faceBoxes: [], bodyBoxes: [],
          safeCropRect: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0.9, recipeVersion: "v1"
        },
        sourceAspect: PORTRAIT_9_16,
        frameAspect: PORTRAIT_4_5
      })
    ).toBe("contain");
  });

  it("B5 · PRODUCT + safeCropRect → cover", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "PRODUCT", subjectCount: 1, faceBoxes: [], bodyBoxes: [],
          safeCropRect: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
          confidence: 0.85, recipeVersion: "v1"
        },
        sourceAspect: 1,
        frameAspect: 1
      })
    ).toBe("cover");
  });

  it("B6 · 海报文字占满 4:3 原图，放进方形时必须 contain", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "TEXT_HEAVY", subjectCount: 0, faceBoxes: [], bodyBoxes: [],
          textSafeArea: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0.95, recipeVersion: "v1"
        },
        sourceAspect: 4 / 3,
        frameAspect: 1
      })
    ).toBe("contain");
  });

  it("B7 · TEXT_HEAVY 但缺 textSafeArea → contain（保安全）", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "TEXT_HEAVY", subjectCount: 0, faceBoxes: [], bodyBoxes: [],
          confidence: 0.95, recipeVersion: "v1"
        },
        sourceAspect: 4 / 3,
        frameAspect: 1
      })
    ).toBe("contain");
  });

  it("B8 · SCENE 即使有 focalPoint 也不自动裁图", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "SCENE", subjectCount: 0, faceBoxes: [], bodyBoxes: [],
          focalPoint: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
          confidence: 0.9, recipeVersion: "v1"
        },
        sourceAspect: LANDSCAPE_3_2,
        frameAspect: LANDSCAPE_3_2
      })
    ).toBe("contain");
  });

  it("B8a · 多人 KTV 合照禁止自动裁剪", () => {
    expect(resolveFillStrategy({
      hint: {
        subjectType: "PERSON", subjectCount: 5,
        faceBoxes: [], bodyBoxes: [],
        safeCropRect: { x: 0.08, y: 0.1, width: 0.84, height: 0.75 },
        confidence: 0.96, recipeVersion: "test"
      },
      sourceAspect: 16 / 9,
      frameAspect: 1
    })).toBe("contain");
  });

  it("B8b · 人物广告和文字图禁止自动裁剪", () => {
    expect(resolveFillStrategy({
      hint: {
        subjectType: "MIXED_PERSON_TEXT", subjectCount: 1,
        faceBoxes: [], bodyBoxes: [],
        textSafeArea: { x: 0.05, y: 0.04, width: 0.9, height: 0.92 },
        safeCropRect: { x: 0.05, y: 0.04, width: 0.9, height: 0.92 },
        confidence: 0.98, recipeVersion: "test"
      },
      sourceAspect: 4 / 5,
      frameAspect: 4 / 5
    })).toBe("contain");
  });

  it("B9 · SCENE + aspect 偏差 > 20% → contain（不中心裁）", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "SCENE", subjectCount: 0, faceBoxes: [], bodyBoxes: [],
          focalPoint: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
          confidence: 0.9, recipeVersion: "v1"
        },
        sourceAspect: 16 / 9,
        frameAspect: 1
      })
    ).toBe("contain");
  });

  it("B10 · UNKNOWN + 高置信度 → contain（保安全）", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "UNKNOWN", subjectCount: 0, faceBoxes: [], bodyBoxes: [],
          confidence: 0.9, recipeVersion: "v1"
        },
        sourceAspect: 1,
        frameAspect: 1
      })
    ).toBe("contain");
  });

  it("B11 · custom threshold 0.7 生效", () => {
    expect(
      resolveFillStrategy({
        hint: {
          subjectType: "PERSON", subjectCount: 1, faceBoxes: [], bodyBoxes: [],
          safeCropRect: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0.65,
          recipeVersion: "v1"
        },
        sourceAspect: PORTRAIT_9_16,
        frameAspect: PORTRAIT_4_5,
        lowConfidenceThreshold: 0.7
      })
    ).toBe("contain");
  });
});

// -----------------------------------------------------------------------------
// Gate C — No Placeholder (无占位)
//
// 不变量：Feed 不渲染 PLACEHOLDER variant（BlurHash 32-64px 模糊）。
// 客户端 PLACEHOLDER 只在 onError fallback / Gallery 首帧使用。
// -----------------------------------------------------------------------------

describe("Gate C · isForbiddenInFeed", () => {
  it("C1 · PLACEHOLDER 是禁止档位", () => {
    expect(isForbiddenInFeed("PLACEHOLDER")).toBe(true);
  });

  it("C2 · FEED_1X 允许", () => {
    expect(isForbiddenInFeed("FEED_1X")).toBe(false);
  });

  it("C3 · FEED_2X 允许", () => {
    expect(isForbiddenInFeed("FEED_2X")).toBe(false);
  });

  it("C4 · GALLERY 允许（用户点开大图时使用）", () => {
    expect(isForbiddenInFeed("GALLERY")).toBe(false);
  });

  it("C5 · ORIGINAL 允许（罕见 case，但 contract 上允许）", () => {
    expect(isForbiddenInFeed("ORIGINAL")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Gate D — Frame Background (深紫黑不变量)
//
// 不变量：Frame 背景 = #0E0A14。不用 offWhite/white：夜景/深色照片 contain
// 时会出现强白边。颜色在编译期被 contract 锁定。
// -----------------------------------------------------------------------------

describe("Gate D · isFrameBackgroundSafe", () => {
  it("D1 · #0E0A14 锁定", () => {
    expect(FRAME_BACKGROUND_HEX).toBe("#0E0A14");
  });

  it("D2 · #0E0A14 通过", () => {
    expect(isFrameBackgroundSafe("#0E0A14")).toBe(true);
  });

  it("D3 · 白色禁止（夜景/深色 contain 强白边）", () => {
    expect(isFrameBackgroundSafe("#FFFFFF")).toBe(false);
  });

  it("D4 · offWhite #F7F4F9 禁止", () => {
    expect(isFrameBackgroundSafe("#F7F4F9")).toBe(false);
  });

  it("D5 · undefined 禁止（fallback 必须是 hex）", () => {
    expect(isFrameBackgroundSafe(undefined)).toBe(false);
  });

  it("D6 · 浅灰 #E5E5E5 禁止（不能有白边伪色）", () => {
    expect(isFrameBackgroundSafe("#E5E5E5")).toBe(false);
  });
});

describe("Gate D2 · resolveFrameBackground（完整展示无灰边）", () => {
  it("使用服务端图片主色作为 contain 画布", () => {
    expect(resolveFrameBackground("#c8b49a")).toBe("#C8B49A");
  });

  it("缺失或非法主色必须回落审核基色", () => {
    expect(resolveFrameBackground(undefined)).toBe(FRAME_BACKGROUND_HEX);
    expect(resolveFrameBackground("gray")).toBe(FRAME_BACKGROUND_HEX);
    expect(resolveFrameBackground("#FFF")).toBe(FRAME_BACKGROUND_HEX);
  });
});

describe("Gate D3 · 同图柔化延展层", () => {
  it("横图完整放进方形画布时启用延展背景", () => {
    expect(shouldUseExtendedBackdrop({
      strategy: "contain",
      sourceAspect: 16 / 9,
      frameAspect: 1
    })).toBe(true);
  });

  it("近乎同尺寸不重复解码背景图", () => {
    expect(shouldUseExtendedBackdrop({
      strategy: "contain",
      sourceAspect: 0.8,
      frameAspect: 0.8
    })).toBe(false);
  });

  it("前景 cover 时不需要延展背景", () => {
    expect(shouldUseExtendedBackdrop({
      strategy: "cover",
      sourceAspect: 0.8,
      frameAspect: 1
    })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Gate I — Video URL Selection (VIDEO 必须走 playbackUrl)
//
// 不变量：VIDEO item 渲染时只能选 playbackUrl，不能选 thumbnailUrl/feedUrl。
// 原因：expo-video 拿 JPEG thumbnail 会报 "This media format is not supported"。
// 上一版选 thumbnailUrl 给 VIDEO 坑过所有 VIDEO 帖文。
// -----------------------------------------------------------------------------

describe("Gate I · selectVideoPlaybackUrl", () => {
  it("I1 · VIDEO + playbackUrl → playbackUrl", () => {
    expect(selectVideoPlaybackUrl({ mediaType: "VIDEO", playbackUrl: "/v1/media/play/abc" })).toBe("/v1/media/play/abc");
  });

  it("I2 · VIDEO + 无 playbackUrl → undefined（不猜 thumbnailUrl）", () => {
    expect(selectVideoPlaybackUrl({ mediaType: "VIDEO", playbackUrl: undefined })).toBeUndefined();
  });

  it("I3 · VIDEO + playbackUrl + 有 thumbnailUrl → 仍选 playbackUrl", () => {
    expect(selectVideoPlaybackUrl({
      mediaType: "VIDEO",
      playbackUrl: "/v1/media/play/abc",
      thumbnailUrl: "/v1/media/thumb/abc"
    } as any)).toBe("/v1/media/play/abc");
  });

  it("I4 · IMAGE + playbackUrl → undefined（非 VIDEO）", () => {
    expect(selectVideoPlaybackUrl({ mediaType: "IMAGE", playbackUrl: "/v1/media/play/abc" })).toBeUndefined();
  });

  it("I5 · IMAGE → 不返回 playbackUrl（避免选错路径）", () => {
    expect(selectVideoPlaybackUrl({ mediaType: "IMAGE" })).toBeUndefined();
  });

  it("I6 · VIDEO 路径必返回 string (当存在) — 不返回空字符串", () => {
    const url = selectVideoPlaybackUrl({ mediaType: "VIDEO", playbackUrl: "/v1/media/play/abc" });
    expect(url).toBeTruthy();
    expect(url?.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// Gate J (coldStartToFirstFrame ≤ 500ms) — VIDEO 装帧策略自动验收
// =====================================================================
// 每个 case 是一条不变量：失败 = 拒绝合入 (与 Gate A-H 同样的 release gate 角色)。

describe("Gate J — coldStartToFirstFrame ≤ 500ms", () => {
  it("PREFERRED_FORWARD_BUFFER_SECONDS = 3 (iOS AVPlayerItem 提前缓冲 3s)", () => {
    expect(PREFERRED_FORWARD_BUFFER_SECONDS).toBe(3);
  });

  it("PREFERRED_FORWARD_BUFFER_SECONDS > 0 (必须 > 0 才能预装帧)", () => {
    expect(PREFERRED_FORWARD_BUFFER_SECONDS).toBeGreaterThan(0);
  });

  it("COLD_START_TO_FIRST_FRAME_BUDGET_MS ≤ 500 (用户感知阈值)", () => {
    expect(COLD_START_TO_FIRST_FRAME_BUDGET_MS).toBeLessThanOrEqual(500);
  });

  it("shouldPreloadVideo: 屏内时不预装 (避免浪费)", () => {
    expect(shouldPreloadVideo(500, 852)).toBe(false);
    expect(shouldPreloadVideo(800, 852)).toBe(false);
    expect(shouldPreloadVideo(852, 852)).toBe(false);
  });

  it("shouldPreloadVideo: 屏外 200pt 内预装 (快滚入屏内)", () => {
    expect(shouldPreloadVideo(900, 852)).toBe(true);
    expect(shouldPreloadVideo(1000, 852)).toBe(true);
    expect(shouldPreloadVideo(1050, 852)).toBe(true);
  });

  it("shouldPreloadVideo: 屏外 > 200pt 不预装 (太远, 浪费带宽)", () => {
    expect(shouldPreloadVideo(2000, 852)).toBe(false);
    expect(shouldPreloadVideo(5000, 852)).toBe(false);
  });

  it("shouldPreloadVideo: 自定义 margin (e.g. iPad 1080pt 大屏)", () => {
    // margin=100, viewport=852: 预装阈值为 y ∈ [852, 952]
    expect(shouldPreloadVideo(900, 852, 100)).toBe(true);
    expect(shouldPreloadVideo(952, 852, 100)).toBe(true);
    expect(shouldPreloadVideo(953, 852, 100)).toBe(false);
    // 屏内 (y <= viewport) 不预装
    expect(shouldPreloadVideo(500, 852, 100)).toBe(false);
  });

  it("FULLSCREEN_MODE = NATIVE_AVPLAYER_VC (不重复造 Modal 轮子)", () => {
    expect(FULLSCREEN_MODE).toBe("NATIVE_AVPLAYER_VC");
  });
});

// =====================================================================
// Gate N — selectImageShape: 4 形态 frame 比例
// =====================================================================
// 【用开源代替重复造轮子】fill / 裁切 / 模糊占位交给 expo-image contentFit/contentPosition/placeholder
// selectImageShape 只管 frame 比例 (RN 布局层的事)

describe("Gate N — selectImageShape (4 形态 frame 比例)", () => {
  it("source 1:1 → SQUARE", () => {
    expect(selectImageShape(1.0)).toBe("SQUARE");
  });
  it("source 4:5 (0.8) → PORTRAIT_4_5", () => {
    expect(selectImageShape(0.8)).toBe("PORTRAIT_4_5");
  });
  it("source 3:4 (0.75) → PORTRAIT_4_5", () => {
    expect(selectImageShape(0.75)).toBe("PORTRAIT_4_5");
  });
  it("source 9:16 (0.5625) → STORY_9_16 (避免大片 #0E0A14 灰边)", () => {
    expect(selectImageShape(9 / 16)).toBe("STORY_9_16");
  });
  it("source 1:1.91 (0.524) → STORY_9_16 (超长)", () => {
    expect(selectImageShape(1 / 1.91)).toBe("STORY_9_16");
  });
  it("source 2:3 (0.667) → PORTRAIT_4_5 (实际生产数据)", () => {
    expect(selectImageShape(2 / 3)).toBe("PORTRAIT_4_5");
  });
  it("source 0.85 (临界) → PORTRAIT_4_5", () => {
    expect(selectImageShape(0.85)).toBe("PORTRAIT_4_5");
  });
  it("source 0.6 (临界) → STORY_9_16", () => {
    expect(selectImageShape(0.6)).toBe("STORY_9_16");
  });
  it("source 16:9 (1.78) → SQUARE", () => {
    expect(selectImageShape(16 / 9)).toBe("SQUARE");
  });
  it("source 21:9 (2.33) → LANDSCAPE", () => {
    expect(selectImageShape(21 / 9)).toBe("LANDSCAPE");
  });
});

// =====================================================================
// Pass 2 audit closures — boundary tests for the 3 new functions
// (shouldUseExtendedBackdrop, canSafelyCover, resolveFrameBackground)
// and the tightened resolveFillStrategy rules. Pinned so a refactor
// that drops any of these invariants fails at unit-test time.
// =====================================================================

describe("Pass 2 · shouldUseExtendedBackdrop boundary gates", () => {
  it("sourceAspect=0 returns false (degenerate input)", () => {
    expect(shouldUseExtendedBackdrop({ strategy: "contain", sourceAspect: 0, frameAspect: 1 })).toBe(false);
  });
  it("frameAspect=0 returns false (degenerate input)", () => {
    expect(shouldUseExtendedBackdrop({ strategy: "contain", sourceAspect: 1, frameAspect: 0 })).toBe(false);
  });
  it("negative sourceAspect returns false", () => {
    expect(shouldUseExtendedBackdrop({ strategy: "contain", sourceAspect: -1, frameAspect: 1 })).toBe(false);
  });
  it("strategy=natural returns false (1:1 pixel; no padded area)", () => {
    expect(shouldUseExtendedBackdrop({ strategy: "natural", sourceAspect: 0.5, frameAspect: 1 })).toBe(false);
  });
  it("exact 3% aspect delta is NOT enough to enable backdrop (>3% required)", () => {
    // Use rational arithmetic so the comparison is bit-exact: frm=100, src=103
    // |103-100|/100 = 0.03 → must reject (the function uses `> 0.03`).
    const frm = 100;
    const src = 103;
    expect(shouldUseExtendedBackdrop({ strategy: "contain", sourceAspect: src, frameAspect: frm })).toBe(false);
  });
  it("just over 3% aspect delta enables backdrop", () => {
    // frm=1000, src=1031 → |1031-1000|/1000 = 0.031 > 0.03 → enable
    const frm = 1000;
    const src = 1031;
    expect(shouldUseExtendedBackdrop({ strategy: "contain", sourceAspect: src, frameAspect: frm })).toBe(true);
  });
});

describe("Pass 2 · canSafelyCover boundary gates", () => {
  it("undefined safeRect returns false", () => {
    expect(canSafelyCover({ safeRect: undefined, sourceAspect: 0.8, frameAspect: 0.8 })).toBe(false);
  });
  it("sourceAspect=0 returns false", () => {
    expect(canSafelyCover({ safeRect: { x: 0, y: 0, width: 1, height: 1 }, sourceAspect: 0, frameAspect: 0.8 })).toBe(false);
  });
  it("frameAspect=0 returns false", () => {
    expect(canSafelyCover({ safeRect: { x: 0, y: 0, width: 1, height: 1 }, sourceAspect: 0.8, frameAspect: 0 })).toBe(false);
  });
  it("exact equality: safeRect.height === cropHeight is safe (<=)", () => {
    // 4:5 source → 1:1 frame: cropHeight = 0.8 / 1.0 = 0.8
    // safeRect.height = 0.8 → must be safe
    expect(canSafelyCover({
      safeRect: { x: 0, y: 0, width: 1, height: 0.8 },
      sourceAspect: 0.8,
      frameAspect: 1.0,
    })).toBe(true);
  });
  it("exact equality in width axis: safeRect.width === cropWidth is safe (<=)", () => {
    // 1:1 source → 4:5 frame: cropWidth = 1.0 * 0.8 = 0.8... wait, 4:5 is 0.8, smaller
    // Actually: frameAspect(0.8) < sourceAspect(1.0), so we crop the width
    // cropWidth = 0.8 / 1.0 = 0.8; safeRect.width = 0.8 → safe
    expect(canSafelyCover({
      safeRect: { x: 0, y: 0, width: 0.8, height: 1 },
      sourceAspect: 1.0,
      frameAspect: 0.8,
    })).toBe(true);
  });
  it("just over the crop window rejects cover (1% over)", () => {
    expect(canSafelyCover({
      safeRect: { x: 0, y: 0, width: 1, height: 0.81 }, // 0.81 > 0.8
      sourceAspect: 0.8,
      frameAspect: 1.0,
    })).toBe(false);
  });
});

describe("Pass 2 · resolveFrameBackground boundary gates", () => {
  it("empty string returns the default", () => {
    expect(resolveFrameBackground("")).toBe(FRAME_BACKGROUND_HEX);
  });
  it("8-digit hex (#RRGGBBAA) returns the default (regex anchors 6 digits only)", () => {
    expect(resolveFrameBackground("#FF00FF80")).toBe(FRAME_BACKGROUND_HEX);
  });
  it("non-hex characters in 7-char string return the default", () => {
    expect(resolveFrameBackground("#FFG000")).toBe(FRAME_BACKGROUND_HEX);
  });
  it("missing # prefix returns the default", () => {
    expect(resolveFrameBackground("FFFFFF")).toBe(FRAME_BACKGROUND_HEX);
  });
  it("numeric string returns the default", () => {
    expect(resolveFrameBackground("123456")).toBe(FRAME_BACKGROUND_HEX);
  });
  it("lowercase hex is uppercased", () => {
    expect(resolveFrameBackground("#abcdef")).toBe("#ABCDEF");
  });
  it("mixed case hex is uppercased", () => {
    expect(resolveFrameBackground("#aBcDeF")).toBe("#ABCDEF");
  });
  it("exactly the default hex is returned as-is (uppercased)", () => {
    expect(resolveFrameBackground("#0e0a14")).toBe("#0E0A14");
  });
});

describe("Pass 2 · resolveFillStrategy tightened rules", () => {
  const personHint = (overrides: Partial<{ subjectType: "PERSON" | "PRODUCT" | "TEXT_HEAVY" | "SCENE" | "MIXED_PERSON_PRODUCT" | "MIXED_PERSON_TEXT" | "UNKNOWN"; subjectCount: number; safeCropRect: { x: number; y: number; width: number; height: number }; confidence: number }> = {}) => ({
    subjectType: overrides.subjectType ?? "PERSON",
    subjectCount: overrides.subjectCount ?? 1,
    faceBoxes: [],
    bodyBoxes: [],
    ...(overrides.safeCropRect ? { safeCropRect: overrides.safeCropRect } : {}),
    confidence: overrides.confidence ?? 0.95,
    recipeVersion: "test",
  });

  it("TEXT_HEAVY is always contain, even with a tight safeCropRect", () => {
    expect(resolveFillStrategy({
      hint: personHint({ subjectType: "TEXT_HEAVY", safeCropRect: { x: 0, y: 0, width: 1, height: 1 } }),
      sourceAspect: 0.8, frameAspect: 0.8,
    })).toBe("contain");
  });
  it("MIXED_PERSON_TEXT is always contain (advertising + portrait mix)", () => {
    expect(resolveFillStrategy({
      hint: personHint({ subjectType: "MIXED_PERSON_TEXT", safeCropRect: { x: 0, y: 0, width: 1, height: 1 } }),
      sourceAspect: 0.8, frameAspect: 0.8,
    })).toBe("contain");
  });
  it("MIXED_PERSON_PRODUCT is always contain", () => {
    expect(resolveFillStrategy({
      hint: personHint({ subjectType: "MIXED_PERSON_PRODUCT", safeCropRect: { x: 0, y: 0, width: 1, height: 1 } }),
      sourceAspect: 0.8, frameAspect: 0.8,
    })).toBe("contain");
  });
  it("subjectCount > 1 is always contain (multi-person / group photos)", () => {
    expect(resolveFillStrategy({
      hint: personHint({ subjectCount: 2, safeCropRect: { x: 0, y: 0, width: 1, height: 1 } }),
      sourceAspect: 0.8, frameAspect: 0.8,
    })).toBe("contain");
  });
  it("aspect delta 2% with safe safeCropRect allows cover", () => {
    expect(resolveFillStrategy({
      hint: personHint({ safeCropRect: { x: 0, y: 0, width: 1, height: 0.8 } }),
      sourceAspect: 0.8, frameAspect: 0.816, // delta = 0.016/0.816 ≈ 0.0196 ≈ 2%
    })).toBe("cover");
  });
  it("aspect delta 5% rejects cover even with safe safeCropRect", () => {
    expect(resolveFillStrategy({
      hint: personHint({ safeCropRect: { x: 0, y: 0, width: 1, height: 0.8 } }),
      sourceAspect: 0.8, frameAspect: 0.84, // delta = 0.04/0.84 ≈ 0.0476 ≈ 5%
    })).toBe("contain");
  });
  it("aspect delta 2% with UNSAFE safeCropRect (full-body 9:16) rejects cover", () => {
    // sourceAspect = 9/16 (0.5625), frameAspect = 0.5738 (≈2% wider)
    // cropHeight = 0.5625 / 0.5738 ≈ 0.9805
    // safeRect.height = 0.96 → fits (within 0.9805)
    // But safeRect.height = 0.99 → fails
    expect(resolveFillStrategy({
      hint: personHint({ safeCropRect: { x: 0.02, y: 0.01, width: 0.96, height: 0.99 } }),
      sourceAspect: 9 / 16, frameAspect: 0.5738,
    })).toBe("contain");
  });
  it("aspect delta 2% with safe 9:16 full-body safeCropRect ALLOWS cover (tight math)", () => {
    // sourceAspect = 0.5625, frameAspect = 0.5738 (≈2% wider)
    // cropHeight = 0.5625 / 0.5738 ≈ 0.9805
    // safeRect.height = 0.98 → 0.98 <= 0.9805 → true
    expect(resolveFillStrategy({
      hint: personHint({ safeCropRect: { x: 0.02, y: 0.01, width: 0.96, height: 0.98 } }),
      sourceAspect: 9 / 16, frameAspect: 0.5738,
    })).toBe("cover");
  });
});

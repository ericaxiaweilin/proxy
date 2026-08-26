// Proxy Social Media Pipeline §5.2.1 / §5.2.2 / Gate 3 — 5 档自动验收。
//
// 每个测试都是一条 gate：失败 = 拒绝合入。这不是单测，是 release gate。
// 改任意一行对应产品代码前先看这些 case —— case 描述就是契约。

import { describe, expect, it } from "vitest";
import {
  FRAME_BACKGROUND_HEX,
  resolveFillStrategy,
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
} from "./media-composition.js";


const PORTRAIT_4_5 = 4 / 5; // 0.8
const PORTRAIT_9_16 = 9 / 16; // 0.5625
const LANDSCAPE_3_2 = 3 / 2; // 1.5

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
// TEXT_HEAVY + textSafeArea → cover；SCENE + focalPoint + aspect 接近 → cover；
// 人物/商品 + safeCropRect → cover；其他 contain。
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

  it("B3 · 置信度 0.40 (= 0.4) → 走真实逻辑", () => {
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
    ).toBe("cover");
  });

  it("B4 · PERSON + safeCropRect → cover (不裁主体)", () => {
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
    ).toBe("cover");
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

  it("B6 · TEXT_HEAVY + textSafeArea → cover（海报/菜单）", () => {
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
    ).toBe("cover");
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

  it("B8 · SCENE + focalPoint + aspect 接近 → cover", () => {
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
    ).toBe("cover");
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

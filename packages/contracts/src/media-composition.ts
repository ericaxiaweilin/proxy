/**
 * Media Composition Hint — Proxy Social Media Pipeline §5.2.2
 *
 * 服务端媒体 Worker 在派生阶段给出"主体在哪儿 / 哪里不能裁"。
 * 客户端只消费此合同，不复制检测逻辑。
 *
 * 加进 FeedMediaItem 后，前端从"按宽高比猜"升级为"按主体类型 + 安全区"布局。
 */
import { z } from "zod";

export const MediaSubjectTypeSchema = z.enum([
  "PERSON",
  "PRODUCT",
  "TEXT_HEAVY",
  "SCENE",
  "MIXED_PERSON_PRODUCT",
  "MIXED_PERSON_TEXT",
  "UNKNOWN"
]);
export type MediaSubjectType = z.infer<typeof MediaSubjectTypeSchema>;

export const MediaBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1)
});
export type MediaBox = z.infer<typeof MediaBoxSchema>;

export const MediaCompositionHintSchema = z.object({
  subjectType: MediaSubjectTypeSchema,
  subjectCount: z.number().int().nonnegative(),
  faceBoxes: z.array(MediaBoxSchema).default([]),
  bodyBoxes: z.array(MediaBoxSchema).default([]),
  textSafeArea: MediaBoxSchema.optional(),
  focalPoint: MediaBoxSchema.optional(),
  safeCropRect: MediaBoxSchema.optional(),
  confidence: z.number().min(0).max(1),
  recipeVersion: z.string().min(1)
});
export type MediaCompositionHint = z.infer<typeof MediaCompositionHintSchema>;

/**
 * Front-end fill strategy.
 * "contain" = 整张图，背景用同图 blur（人像 9:16 等）
 * "cover"   = 仅在源图与画布几乎同尺寸时铺满（最多 3% 比例差）
 * "natural" = 1:1 像素，无变形（spec / logo）
 *
 * 服务端 hint 低置信度 → 必须回落 contain；客户端不得自作主张。
 */
export type MediaFillStrategy = "contain" | "cover" | "natural";

/**
 * 只有完整展示会产生可见留边、且源图与画布比例确实不同时才渲染柔化延展层。
 * 前景仍是 contain 原图；延展层可以 cover，因为它只是背景，不承载内容。
 */
export function shouldUseExtendedBackdrop(input: {
  strategy: MediaFillStrategy;
  sourceAspect: number;
  frameAspect: number;
}): boolean {
  if (input.strategy !== "contain" || input.sourceAspect <= 0 || input.frameAspect <= 0) return false;
  return Math.abs(input.sourceAspect - input.frameAspect) / input.frameAspect > 0.03;
}

/**
 * 判断 cover 所需的裁剪窗口能否完整包含服务端安全区。
 * sourceAspect/frameAspect 决定实际会裁宽还是裁高；只看“有 safeCropRect”不够，
 * 全身 9:16 放进 4:5 时，裁剪窗口高度只有约 70%，必须回退 contain 才不会裁脚。
 */
export function canSafelyCover(input: {
  safeRect: MediaBox | undefined;
  sourceAspect: number;
  frameAspect: number;
}): boolean {
  const { safeRect, sourceAspect, frameAspect } = input;
  if (!safeRect || sourceAspect <= 0 || frameAspect <= 0) return false;
  if (frameAspect > sourceAspect) {
    const cropHeight = sourceAspect / frameAspect;
    return safeRect.height <= cropHeight;
  }
  if (frameAspect < sourceAspect) {
    const cropWidth = frameAspect / sourceAspect;
    return safeRect.width <= cropWidth;
  }
  return true;
}

/**
 * 从服务端 hint + 客户端帧宽高比，解析"该用哪种填充"。
 * 这是唯一允许前端推导 fill 策略的入口。
 * 见 Social_Media_Pipeline_Plan_Gates_R1.md §5.2.2 "首版回落矩阵"。
 */
export function resolveFillStrategy(input: {
  hint: MediaCompositionHint | undefined;
  sourceAspect: number;
  frameAspect: number;
  lowConfidenceThreshold?: number;
}): MediaFillStrategy {
  const threshold = input.lowConfidenceThreshold ?? 0.4;
  const hint = input.hint;
  if (!hint || hint.confidence < threshold) {
    // 无识别结果或低置信度：完整展示，绝不中心裁。
    return "contain";
  }
  // 广告/海报、多人、人物与文字/商品混合图禁止自动裁剪。
  if (
    hint.subjectType === "TEXT_HEAVY"
    || hint.subjectType === "MIXED_PERSON_TEXT"
    || hint.subjectType === "MIXED_PERSON_PRODUCT"
    || hint.subjectCount > 1
  ) return "contain";

  // 核心不是裁图。只有源图与画布几乎同一比例、且服务端安全区完整时，
  // 才允许消除几乎不可见的边缘余量；其余全部完整展示。
  const aspectDelta = Math.abs(input.sourceAspect - input.frameAspect) / input.frameAspect;
  if (aspectDelta <= 0.03 && hint.safeCropRect) {
    return canSafelyCover({ safeRect: hint.safeCropRect, sourceAspect: input.sourceAspect, frameAspect: input.frameAspect })
      ? "cover"
      : "contain";
  }
  return "contain";
}

/**
 * Proxy Social Media Pipeline §5.2.1 / Gate 3 — 档位选择 Gate。
 *
 * 不允许客户端任意挑选 FeedMediaItem 里的 URL 字段。
 * 所有档位选择必须经过本函数：保证 iPhone 393pt 用 FEED_1X (1080px)、
 * iPad/Pro Max 410pt+ 用 FEED_2X (1600px)、GALLERY (2560px) 只在用户点开
 * 大图时使用 (n/a here)、ORIGINAL 不在 Feed 中使用。
 *
 * Gate A 不变量：
 *   1. viewportWidth < 410pt → feedUrl
 *   2. viewportWidth >= 410pt → feed2xUrl ?? feedUrl
 *   3. 优先 2x 降级到 1x；任何降级路径都明确，不留全不空
 *   4. 1x/2x 都为空时回退 galleryUrl（最差情况保持能看，不是空白）
 *   5. 【v2 升级】有 compositionHint 且 confidence ≥ 0.4 → 优先 v2 派生
 *      - v2 HINT (FEED_1X_HINT): 服务端按 safeCropRect 裁过的人像/商品/文字
 *      - v2 NATURAL (FEED_1X_NATURAL): 无人脸时的原比例 + 深紫黑补边 contain
 *      - v2 只有 1X 档，没有 2X；屏宽 ≥ 410pt 时仍降级到普通 FEED_2X
 *   6. v2 HINT 缺失 → 降级到 v2 NATURAL → 降级到普通 FEED_1X/2X
 *
 * 这条直接对应 §5.2 性能预算（"滚动过程中不得因图片解码持续掉到 45fps 以下"）
 * —— 高密度屏拿 2x = 不拉伸；低密度屏拿 1x = 不浪费流量。
 */
export type FeedRenderVariant = "FEED_1X" | "FEED_2X" | "FEED_1X_HINT" | "FEED_1X_NATURAL" | "GALLERY";

export type FeedRenderSelection = {
  purpose: FeedRenderVariant;
  url: string | undefined;
};

export const FEED_WIDE_BREAKPOINT_PT = 410;

/**
 * §5.2 / §5.2.3 — VIDEO item 必须走 playbackUrl（原始流，H264/H265）；不是 thumbnailUrl。
 * 这个决策绝不能被 IMAGE 路径表名反过来覆写——上一版 selectVariantForViewport
 * 选 thumbnailUrl 给 VIDEO，导致 expo-video 加载 "This media format is not supported"。
 * 修复：VIDEO 路径独立选 playbackUrl，不走主 chooser。
 */
export function selectVideoPlaybackUrl(item: { playbackUrl?: string | undefined; mediaType: string }): string | undefined {
  if (item.mediaType !== "VIDEO") return undefined;
  return item.playbackUrl;
}

/**
 * v2 派生使用门槛：compositionHint confidence ≥ 0.4 才消费
 * (与服务端 image_variants_v2.go:LowConfidenceThreshold 一致)。
 */
export const V2_HINT_CONFIDENCE_THRESHOLD = 0.4;

export function selectVariantForViewport(
  item: {
    feedUrl?: string | undefined;
    feed2xUrl?: string | undefined;
    feed2xHintUrl?: string | undefined;
    feed2xNaturalUrl?: string | undefined;
    galleryUrl?: string | undefined;
    thumbnailUrl?: string | undefined;
    playbackUrl?: string | undefined;
    compositionHint?: { confidence?: number | undefined } | undefined;
  },
  viewportWidth: number
): FeedRenderSelection {
  // v2 派生准入：compositionHint confidence ≥ 0.4
  const hint = item.compositionHint;
  const hasV2Hint = !!(hint && typeof hint.confidence === "number" && hint.confidence >= V2_HINT_CONFIDENCE_THRESHOLD);
  // 屏宽 < 410pt：v2 派生覆盖 1X 档；屏宽 ≥ 410pt：v2 没有 2X，降级到普通 FEED_2X
  if (viewportWidth < FEED_WIDE_BREAKPOINT_PT) {
    if (hasV2Hint) {
      const hintUrl = item.feed2xHintUrl;
      if (hintUrl) {
        return { purpose: "FEED_1X_HINT", url: hintUrl };
      }
      const naturalUrl = item.feed2xNaturalUrl;
      if (naturalUrl) {
        return { purpose: "FEED_1X_NATURAL", url: naturalUrl };
      }
    }
    return {
      purpose: "FEED_1X",
      url: item.feedUrl ?? item.feed2xUrl ?? item.galleryUrl ?? item.thumbnailUrl ?? item.playbackUrl
    };
  }
  // 宽屏：v2 没有 2X 派生，直接走普通 FEED_2X 路径
  return {
    purpose: "FEED_2X",
    url: item.feed2xUrl ?? item.feedUrl ?? item.galleryUrl ?? item.thumbnailUrl ?? item.playbackUrl
  };
}

/**
 * Proxy Social Media Pipeline §5.2.1 / Gate 3 — 占位反 Gate。
 *
 * 强制：Feed 内不显示 placeholderUrl（BlurHash 32-64px 模糊图）。
 * 理由：v2 派生流水线已稳，FEED_1X/2X JPEG 在 1.2s 预算内可见。
 * 以前 v1 走了 placeholder-first，导致用户看到“毛玻璃”——还要点一下才
 * 换原图。客户端只能把 placeholderUrl 用在 onError fallback / Gallery 首帧。
 *
 * Gate C 不变量：
 *   1. Feed 首屏渲染不调 placeholderUrl
 *   2. onError 时可重试 placeholderUrl（别黑屏）
 *   3. PLACEHOLDER 独立 purpose，不在 FeedVariantSelection 考虑范围内
 */
export const FEED_FORBIDDEN_PURPOSES: ReadonlyArray<FeedRenderVariant | "PLACEHOLDER"> = [
  "PLACEHOLDER"
];

export function isForbiddenInFeed(purpose: string): boolean {
  return FEED_FORBIDDEN_PURPOSES.indexOf(purpose as FeedRenderVariant | "PLACEHOLDER") >= 0;
}

/**
 * Proxy Social Media Pipeline §5.2.1 / Gate 3 — 背景色不变量。
 *
 * Frame 背景锁定为 #0E0A14（深紫黑）。
 * 不用 offWhite / white：夜景 / 深色照片 contain 时会出现强白边。
 * 写死 hex，禁用任何透明/白/灰同色系——夜间看是黑的，不能变灰。
 */
/**
 * Gate J (coldStartToFirstFrame) — VIDEO 装帧策略。
 * “装帧” = AVPlayer 从头/手 key frame 准备出第一帧到 surface 可显示状态。
 * 目标：tap → 首帧 ≤ 500ms（实际 ⇁200ms）。
 *
 * 策略（不重复造轮子，用 expo-video 已有 API）：
 *   1. setup.preferredForwardBufferDuration = PREFERRED_FORWARD_BUFFER_SECONDS
 *      （iOS AVPlayerItem）让 AVPlayer 后台提前缓冲 N 秒。
 *   2. 上一段 VIDEO 还在屏内时，换上下一段 feed 视频时，expo-video 会 release
 *      旧 player + create 新 player，丢失已装帧状态。Gate J 优化：当 feed 视频
 *      在屏外 100pt 内时提前 create player + 装帧。
 *   3. tap 调 videoViewRef.current.enterFullscreen() 走 native AVPlayerViewController
 *      fullscreen，不需重走装帧流程。
 */
export const PREFERRED_FORWARD_BUFFER_SECONDS = 3;
export const COLD_START_TO_FIRST_FRAME_BUDGET_MS = 500;

/**
 * 计算某个 VIDEO item 在 feed 屏内时是否需要预装帧。
 * 预装帧阈值：item 顶部在屏外 200pt 内 = 快滚入屏内 → 预装。
 */
export function shouldPreloadVideo(
  itemTopY: number,
  viewportHeight: number,
  preloadMargin = 200
): boolean {
  // itemTopY > viewportHeight 表示 item 顶在屏外下方
  // itemTopY + preloadMargin >= viewportHeight 表示 item 顶在屏外 200pt 内
  return itemTopY > viewportHeight && itemTopY - viewportHeight <= preloadMargin;
}

/**
 * §5.2.3 fullscreen 模式：expo-video native AVPlayerViewController vs 自造 Modal。
 * 必须是 native fullscreen（不走自造 Modal）：
 *   - iOS AVPlayerViewController system fullscreen 0ms 装帧 (player 已在 surface 后台装帧)。
 *   - 自造 Modal (RN View + Portal) 需要 RN reconciliation + Modal mount + React state sync — 1-2s 装帧。
 *   - 自造 Modal 也丢失 PiP、AirPlay、倍速、字幕、下载等 native 能力。
 */
export const FULLSCREEN_MODE = "NATIVE_AVPLAYER_VC" as const;
export type FullscreenMode = typeof FULLSCREEN_MODE;

export const FRAME_BACKGROUND_HEX = "#0E0A14";

/**
 * contain 留边使用服务端从当前图片派生出的主色；格式异常或缺失时回到审核基色。
 * 这只改变画布背景，不改变 ORIGINAL/GALLERY，也不参与可见性或审核判断。
 */
export function resolveFrameBackground(dominantColorHex: string | undefined): string {
  return dominantColorHex && /^#[0-9A-Fa-f]{6}$/.test(dominantColorHex)
    ? dominantColorHex.toUpperCase()
    : FRAME_BACKGROUND_HEX;
}

export function isFrameBackgroundSafe(backgroundColor: string | undefined): boolean {
  return backgroundColor === FRAME_BACKGROUND_HEX;
}

/**
 * R15.13 P4：客户端在 contain 模式下选 frame 背景时，优先用后端
 * 经 "Memory aggregate dominant-color" 推荐的 sceneAestheticBackdrop
 * （代表同场景中已完成的真实场景里最常出现的主色），其次才退到本
 * 张图的 dominantColorHex，最后是审核基色 FRAME_BACKGROUND_HEX。
 * 三层 fallback 的顺序不能变：它是“平台记忆 > 单图 > 静态基色”的
 * 信号递减序列，错位会让 #0E0A14 灰边重新出现并抹掉 P4 的价值。
 */
export function resolveSceneAestheticFrame(input: {
  sceneAestheticBackdrop?: string;
  dominantColorHex?: string;
}): string {
  if (input.sceneAestheticBackdrop && /^#[0-9A-Fa-f]{6}$/.test(input.sceneAestheticBackdrop)) {
    return input.sceneAestheticBackdrop.toUpperCase();
  }
  return resolveFrameBackground(input.dominantColorHex);
}

/**
 * Gate N — 9:16+ 长图走 STORY 形态 (3:4 拉满 + 底部 60pt caption)。
 * 避免 9:16+ 图在 4:5 frame 上下大片 #0E0A14 灰边。
 * 【用开源代替重复造轮子】选 frame 比例是 React Native 布局层的事，
 * 交给 SocialMediaFrame + AdaptiveMediaCollection。fill / 裁切 / 模糊占位
 * 全部交给 expo-image 的 contentFit / contentPosition / placeholder。
 */
export type ImageShape = "SQUARE" | "PORTRAIT_4_5" | "STORY_9_16" | "LANDSCAPE";

export function selectImageShape(sourceAspect: number): ImageShape {
  if (sourceAspect <= 0.6) return "STORY_9_16";  // ≤ 9:16 ~ 3:5
  if (sourceAspect <= 0.85) return "PORTRAIT_4_5"; // 3:5 ~ 4:5
  if (sourceAspect < 1.25) return "SQUARE";        // 4:5 ~ 5:4
  if (sourceAspect > 1.91) return "LANDSCAPE";     // > 1.91:1
  return "SQUARE";
}

// =====================================================================

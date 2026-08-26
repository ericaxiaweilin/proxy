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
 * "cover"   = 整画布铺满，仅在 safeCropRect 完整时使用
 * "natural" = 1:1 像素，无变形（spec / logo）
 *
 * 服务端 hint 低置信度 → 必须回落 contain；客户端不得自作主张。
 */
export type MediaFillStrategy = "contain" | "cover" | "natural";

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
    // 低置信度：宁可 contain，绝不中心裁
    return "contain";
  }
  // 文字 / 海报：textSafeArea 完整时 cover
  if (hint.subjectType === "TEXT_HEAVY" && hint.textSafeArea) return "cover";
  // 场景 / 风景：focalPoint 存在 + frameAspect 与 sourceAspect 接近时 cover
  if (hint.subjectType === "SCENE" && hint.focalPoint) {
    const aspectDelta = Math.abs(input.sourceAspect - input.frameAspect) / input.frameAspect;
    return aspectDelta < 0.2 ? "cover" : "contain";
  }
  // 人物 / 商品：safeCropRect 完整时 cover，否则 contain（人像 + 商品 / 人像 + 文字 → 同理）
  if (hint.safeCropRect) return "cover";
  return "contain";
}

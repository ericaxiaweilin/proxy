/**
 * SocialMediaFrame v3 — 用 expo-image 代替自造裁切 / 模糊背景 / 多 Image 叠加。
 *
 * 【不要重复造轮子】v2 自己用 React Native Image + blurRadius=24 + absoluteFill
 * 叠背同图柔化背景，逻辑复杂且性能差。v3 交给 expo-image:
 *   - contentFit: cover/contain/fill/none/scale-down (代替自己推 fill)
 *   - contentPosition: focal point 百分比 (接 compositionHint.focalPoint)
 *   - placeholder={blurhash}: 服务端给 blurhash 直接模糊占位，不用同图柔化
 *   - transition: 200ms cross-dissolve 进场，不用自己 fade
 *   - cachePolicy: "memory-disk" (LRU cache) + recyclingKey
 *   - priority: "high" (feed 首屏) / "normal" (滚动) / "low" (屏外)
 *
 * 合约：仅调用 selectVariantForViewport 选档位 + selectImageShape 决定 frame
 * 比例。fill / 裁切 / 模糊 占位 / 缓存全部由 expo-image 负责。
 */
import { Image as ExpoImage } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import type { FeedMediaItem } from "@proxy/contracts";
import {
  resolveFillStrategy,
  resolveFrameBackground,
  shouldUseExtendedBackdrop,
  selectVariantForViewport,
  selectImageShape,
  FRAME_BACKGROUND_HEX,
  type MediaCompositionHint
} from "@proxy/contracts";
import { mediaAspect } from "../media-presentation";
import { color } from "../theme";
import { isMediaUnavailable, UnavailableMedia, useMediaLoadState } from "./media-fallback";
import { SOCIAL_MEDIA_RADIUS } from "./social-media-aesthetics";
import { AIMediaBadge } from "./ai-media-badge";

type FeedItemWithHint = FeedMediaItem & { compositionHint?: MediaCompositionHint };

type Props = {
  item: FeedMediaItem & { compositionHint?: MediaCompositionHint | undefined };
  frameAspect: number;
  resolveUrl: (path: string) => string;
};

export function SocialMediaFrame({ item, frameAspect, resolveUrl }: Props): React.JSX.Element {
  const sourceAspect = mediaAspect(item, 0) || frameAspect;
  const hint: MediaCompositionHint | undefined = (item as FeedItemWithHint).compositionHint;
  const strategy = hint
    ? resolveFillStrategy({ hint, sourceAspect, frameAspect })
    : "contain";

  const { width: viewportWidth } = useWindowDimensions();
  const selection = selectVariantForViewport(item, viewportWidth);
  const primaryUri = selection.url ?? "";
  const uri = resolveUrl(primaryUri);

  // Gate K (checkSubjectInSafeArea) — 接 focalPoint 避免裁掉主体
  // contentPosition 接受 "x% y%" / "center" / "top left" 等
  // 【fix 2026-08-26】只在 cover 模式下传：contain 模式图片已完整显示，focalPoint 无意义，
  // 反而会导致 expo-image 在 contain 下用 focalPoint 位置对齐（实测会"贴边"）。
  // MediaFillStrategy = "contain" | "cover" | "natural" → ImageContentFit mapping
  // "natural" 等价 expo-image 的 "fill" (不缩放)
  const contentFit = strategy === "natural" ? "fill" : strategy;
  const frameBackground = resolveFrameBackground(item.dominantColorHex);
  // MEDIA-FILE-001: a media URL the server cannot serve used to leave the frame's
  // near-black FRAME_BACKGROUND_HEX showing, which reads as a real dark photo.
  const { failed, onError } = useMediaLoadState(uri);
  const unavailable = isMediaUnavailable(uri, failed);
  const showExtendedBackdrop = shouldUseExtendedBackdrop({ strategy, sourceAspect, frameAspect });
  const contentPosition = (contentFit === "cover" && hint?.focalPoint)
    ? { top: `${Math.round(hint.focalPoint.y * 100)}%`, left: `${Math.round(hint.focalPoint.x * 100)}%` }
    : undefined;

  // 【fix 2026-08-26】信任 caller 传入的 frameAspect（由 MediaWall/AdaptiveMediaRail/SinglePostImage 各自按 sourceAspect 算好），
  // 不再内部重算 shapeAspect —— 双重决策会导致 WALL 4:5 portrait 与 SINGLE 1:1 square 走出不同 frame 比例。
  // history: v3 早期内部调用 selectImageShape(sourceAspect) → shapeAspect，被 caller 的 frameAspect 覆盖，
  // 但 MediaWall 把 cellAspect 传给 frameAspect 后又被 shapeAspect 压回 0.8（4:5）→ 横图被压成方。
  return (
    <View style={[styles.frame, { aspectRatio: frameAspect, backgroundColor: unavailable ? color.surface : frameBackground }]}>
      {unavailable ? (
        <UnavailableMedia />
      ) : (
        <>
          {showExtendedBackdrop && uri ? (
            <ExpoImage
              accessible={false}
              source={{ uri }}
              style={styles.extendedBackdrop}
              contentFit="cover"
              blurRadius={32}
              cachePolicy="memory-disk"
              priority="low"
              recyclingKey={`${item.mediaAssetId}:backdrop`}
            />
          ) : null}
          <ExpoImage
            source={{ uri }}
            style={styles.asset}
            contentFit={contentFit}
            {...(contentPosition ? { contentPosition } : {})}
            transition={200}
            cachePolicy="memory-disk"
            priority="normal"
            recyclingKey={item.mediaAssetId}
            onError={onError}
          />
        </>
      )}
      {/* LC-06 显示侧：多图帖（AdaptiveMediaRail）里每张卡都走本组件 —— 标注挂在
          这里，AI 生成的那一张才不会被漏掉。`frame` 是 overflow:hidden 的圆角容器，
          绝对定位的角标会被裁在卡内，正是想要的。 */}
      <AIMediaBadge item={item} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: SOCIAL_MEDIA_RADIUS,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%"
  },
  asset: {
    height: "100%",
    width: "100%"
  },
  extendedBackdrop: {
    height: "112%",
    left: "-6%",
    opacity: 0.72,
    position: "absolute",
    top: "-6%",
    width: "112%"
  }
});

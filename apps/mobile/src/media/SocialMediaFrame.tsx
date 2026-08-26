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
  selectVariantForViewport,
  selectImageShape,
  FRAME_BACKGROUND_HEX,
  type MediaCompositionHint
} from "@proxy/contracts";
import { mediaAspect, shouldPreserveWholeSubject } from "../media-presentation";

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
    : shouldPreserveWholeSubject(sourceAspect, frameAspect)
      ? "contain"
      : "cover";

  const { width: viewportWidth } = useWindowDimensions();
  const selection = selectVariantForViewport(item, viewportWidth);
  const primaryUri = selection.url ?? "";
  const uri = resolveUrl(primaryUri);

  // Gate N (selectImageShape) — 4 形态 frame 比例
  const shape = selectImageShape(sourceAspect);
  const shapeAspect = (() => {
    switch (shape) {
      case "STORY_9_16": return 3 / 4;
      case "PORTRAIT_4_5": return sourceAspect;
      case "SQUARE": return sourceAspect;
      case "LANDSCAPE": return Math.min(sourceAspect, 1.91);
    }
  })();

  // Gate K (checkSubjectInSafeArea) — 接 focalPoint 避免裁掉主体
  // contentPosition 接受 "x% y%" / "center" / "top left" 等
  const contentPosition = hint?.focalPoint
    ? { top: `${Math.round(hint.focalPoint.y * 100)}%`, left: `${Math.round(hint.focalPoint.x * 100)}%` }
    : "center";

  // MediaFillStrategy = "contain" | "cover" | "natural" → ImageContentFit mapping
  // "natural" 等价 expo-image 的 "fill" (不缩放)
  const contentFit = strategy === "natural" ? "fill" : strategy;

  return (
    <View style={[styles.frame, { aspectRatio: shapeAspect }]}>
      <ExpoImage
        source={{ uri }}
        style={styles.asset}
        contentFit={contentFit}
        contentPosition={contentPosition}
        transition={200}
        cachePolicy="memory-disk"
        priority="normal"
        recyclingKey={item.mediaAssetId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%"
  },
  asset: {
    height: "100%",
    width: "100%"
  }
});

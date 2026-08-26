/**
 * SocialMediaFrame v2 — Proxy Social Media Pipeline §5.2.1 + §5.2.2
 *
 * 重写目标：消除"灰边 / 显示不全 / 高度抖动"。
 * 关键不变量：
 *   1. 人像混合（4:5 半身 + 9:16 全身）使用统一 4:5 portrait 画布
 *   2. 全身照 contain + 同图柔化背景（blurRadius），背景用 #0E0A14（深紫黑）
 *   3. 填充策略由服务端 compositionHint 决定（resolveFillStrategy）
 *   4. 宽高比来自服务端（width/height + aspectRatio），不靠客户端探测
 *   5. 占位使用 placeholderUrl（BlurHash / 64px 派生）
 *
 * 兼容策略：组件接受旧 FeedMediaItem 形状（无 compositionHint）→ 自动回落到
 * shouldPreserveWholeSubject 启发式（保持现状行为），等后端 hint 全量后切换。
 */
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { FeedMediaItem } from "@proxy/contracts";
import {
  resolveFillStrategy,
  type MediaCompositionHint
} from "@proxy/contracts";
import { color } from "../theme";
import {
  mediaAspect,
  shouldPreserveWholeSubject
} from "../media-presentation";

type Props = {
  item: FeedMediaItem & { compositionHint?: MediaCompositionHint };
  frameAspect: number;
  resolveUrl: (path: string) => string;
};

export function SocialMediaFrame({ item, frameAspect, resolveUrl }: Props): React.JSX.Element {
  const declaredAspect = mediaAspect(item, 0);
  const [loadedAspect, setLoadedAspect] = useState(0);
  const sourceAspect = declaredAspect || loadedAspect || frameAspect;

  // 决策：fill 策略 = 服务端 hint 优先；缺失时回落到既有启发式
  const strategy = item.compositionHint
    ? resolveFillStrategy({ hint: item.compositionHint, sourceAspect, frameAspect })
    : shouldPreserveWholeSubject(sourceAspect, frameAspect)
      ? "contain"
      : "cover";

  const useBackdrop = strategy === "contain";
  const uri = resolveUrl(item.feedUrl ?? item.thumbnailUrl ?? item.playbackUrl ?? "");
  const placeholderUri = item.placeholderUrl ? resolveUrl(item.placeholderUrl) : undefined;

  return (
    <View style={styles.frame}>
      {useBackdrop ? (
        <Image
          blurRadius={24}
          resizeMode="cover"
          source={placeholderUri ? { uri: placeholderUri } : { uri }}
          style={styles.backdrop}
        />
      ) : null}
      <Image
        onLoad={(event) => {
          const source = event.nativeEvent.source;
          if (!declaredAspect && source.width > 0 && source.height > 0) {
            setLoadedAspect(source.width / source.height);
          }
        }}
        resizeMode={strategy === "cover" ? "cover" : strategy === "contain" ? "contain" : "center"}
        source={placeholderUri ? { uri: placeholderUri } : { uri }}
        style={styles.asset}
      />
    </View>
  );
}

// 深紫黑 = 0E0A14。
// 不用 offWhite / white，因为夜景 / 深色照片 contain 时会有强烈白边。
// 这条直接对应 §5.2.1 "背景不能使用纯白导致夜景/深色照片出现强烈边框"。
const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    backgroundColor: "#0E0A14",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%"
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0E0A14"
  },
  asset: {
    height: "100%",
    width: "100%"
  }
});

/**
 * AdaptiveMediaCollection v2 — Proxy Social Media Pipeline §5.2 / §5.2.1 / §5.2.2
 *
 * 三种形态：
 *   1 张：SINGLE  → 内容宽度铺满、原比例（clamp 4:5 ~ 1.91:1）
 *   2/3/5：RAIL   → 稳定高度 clamp(W*1.05, 280, 440)；下张露 12-18%
 *   4/6：WALL    → 两列照片墙；格子宽 = (W - gap) / 2；高度按 sourceAspect
 *
 * 关键不变量：
 *   - 数量只决定"形态"，主体类型由服务端 compositionHint 决定每个格子怎么填
 *   - WALL 不再使用 1:1 强制 cover（旧的"灰边 / 显示不全"主因）
 *   - WALL 格子是固定宽，**高度按单图 sourceAspect**，contain 优先
 *   - 删除/重试一个媒体不改变其他媒体 ID 和顺序
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem } from "@proxy/contracts";
import type { MediaCompositionHint } from "@proxy/contracts";
import { color } from "../theme";
import {
  mediaAspect,
  mediaCollectionMode,
  mediaRailMetrics,
  nearestRailIndex
} from "../media-presentation";
import { SocialMediaFrame } from "./SocialMediaFrame";

type ItemWithHint = FeedMediaItem & { compositionHint?: MediaCompositionHint };

type Props = {
  items: FeedMediaItem[];
  currentIndex: number;
  resolveUrl: (path: string) => string;
  onIndexChange: (index: number) => void;
  onOpen: (index: number) => void;
};

const CARD_GAP = 10;
const WALL_GAP = 6;
const RAIL_HORIZONTAL_PADDING = 18;

export function AdaptiveMediaCollection(props: Props): React.JSX.Element {
  const mode = mediaCollectionMode(props.items.length);
  if (mode === "WALL") return <MediaWall {...props} />;
  if (mode === "SINGLE") return <SinglePostImage item={props.items[0]!} resolveUrl={props.resolveUrl} onPress={() => props.onOpen(0)} />;
  return <AdaptiveMediaRail {...props} />;
}

function SinglePostImage({ item, resolveUrl, onPress }: {
  item: ItemWithHint;
  resolveUrl: (path: string) => string;
  onPress: () => void;
}): React.JSX.Element {
  const declaredAspect = mediaAspect(item, 0);
  const [loadedAspect, setLoadedAspect] = useState(0);
  const sourceAspect = declaredAspect || loadedAspect || 4 / 3;
  // 规范 §5.1：横图 ≤ 1.91:1；竖图 ≥ 4:5；中间按原比例
  const displayAspect = Math.max(4 / 5, Math.min(1.91, sourceAspect));
  const uri = resolveUrl(item.feedUrl ?? item.thumbnailUrl ?? item.playbackUrl ?? "");
  const placeholderUri = item.placeholderUrl ? resolveUrl(item.placeholderUrl) : undefined;
  return (
    <Pressable
      accessibilityLabel="查看原图"
      onPress={onPress}
      style={[styles.singleStage, { aspectRatio: displayAspect }]}
    >
      <View style={styles.singleFill}>
        <Image
          onLoad={(event) => {
            const source = event.nativeEvent.source;
            if (!declaredAspect && source.width > 0 && source.height > 0) {
              setLoadedAspect(source.width / source.height);
            }
          }}
          resizeMode="contain"
          source={placeholderUri ? { uri: placeholderUri } : { uri }}
          style={styles.singleAsset}
        />
      </View>
    </Pressable>
  );
}

function AdaptiveMediaRail({ items, currentIndex, resolveUrl, onIndexChange, onOpen }: Props): React.JSX.Element {
  const [contentWidth, setContentWidth] = useState(320);
  const railRef = useRef<ScrollView>(null);
  const metrics = useMemo(() => mediaRailMetrics(items, contentWidth), [items, contentWidth]);
  useEffect(() => {
    const target = metrics.offsets[Math.max(0, Math.min(currentIndex, metrics.offsets.length - 1))] ?? 0;
    railRef.current?.scrollTo({ x: target, animated: false });
  }, [currentIndex, metrics.offsets]);
  return (
    <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        contentContainerStyle={{ paddingLeft: 0, paddingRight: RAIL_HORIZONTAL_PADDING }}
        decelerationRate="fast"
        horizontal
        onMomentumScrollEnd={(event) => onIndexChange(nearestRailIndex(metrics.offsets, event.nativeEvent.contentOffset.x))}
        ref={railRef}
        snapToOffsets={metrics.offsets}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
      >
        {items.map((item, index) => {
          const cardWidth = metrics.cardWidths[index] ?? contentWidth * 0.84;
          return (
            <Pressable
              accessibilityLabel={`查看第 ${index + 1} 张媒体`}
              key={item.mediaAssetId}
              onPress={() => onOpen(index)}
              style={{ height: metrics.railHeight, marginRight: CARD_GAP, width: cardWidth }}
            >
              <SocialMediaFrame item={item as ItemWithHint} frameAspect={cardWidth / metrics.railHeight} resolveUrl={resolveUrl} />
              <View style={styles.railBadge}><Text style={styles.railBadgeText}>{index + 1}/{items.length}</Text></View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.railHint}>{currentIndex + 1}/{items.length} · 左右滑动查看</Text>
    </View>
  );
}

function MediaWall({ items, onOpen }: Props): React.JSX.Element {
  const [contentWidth, setContentWidth] = useState(320);
  const cellWidth = (contentWidth - WALL_GAP) / 2;
  return (
    <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <View style={styles.wall}>
        {items.map((item, index) => {
          const aspect = mediaAspect(item, 1);
          // 4:5 portrait 画布优先；其他按 sourceAspect；最高 4:5（不被压成横条）
          const cellAspect = aspect >= 1 ? 1 : Math.max(4 / 5, aspect);
          return (
            <Pressable
              accessibilityLabel={`查看第 ${index + 1} 张媒体`}
              key={item.mediaAssetId}
              onPress={() => onOpen(index)}
              style={[
                styles.wallCell,
                {
                  height: cellWidth / cellAspect,
                  marginRight: index % 2 === 0 ? WALL_GAP : 0,
                  width: cellWidth
                }
              ]}
            >
              <SocialMediaFrame item={item as ItemWithHint} frameAspect={cellAspect} resolveUrl={onOpenResolveUrl} />
              <View style={styles.railBadge}><Text style={styles.railBadgeText}>{index + 1}/{items.length}</Text></View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function onOpenResolveUrl(_path: string): string {
  // 留作内部兜底；实际 URL 解析在调用方注入。
  return _path;
}

const styles = StyleSheet.create({
  // 单图：深紫黑底（消除灰边）
  singleStage: {
    backgroundColor: "#0E0A14",
    borderRadius: 14,
    overflow: "hidden",
    width: "100%"
  },
  singleFill: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  singleAsset: {
    height: "100%",
    width: "100%"
  },
  // Rail
  rail: {
    marginLeft: 0
  },
  railBadge: {
    backgroundColor: "rgba(14,10,20,0.55)",
    borderRadius: 999,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: "absolute",
    right: 8
  },
  railBadgeText: {
    color: color.white,
    fontSize: 11,
    fontWeight: "700"
  },
  railHint: {
    color: color.muted,
    fontSize: 11,
    marginTop: 6
  },
  // Wall
  wall: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start"
  },
  wallCell: {
    backgroundColor: "#0E0A14",
    borderRadius: 12,
    marginBottom: WALL_GAP,
    overflow: "hidden"
  }
});

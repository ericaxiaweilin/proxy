/**
 * ThreadsPostMedia — me.tsx personalhub 帖子的图片区（也被 ProfileTabs/PostCard
 * 复用，覆盖个人主页和他人主页两处）。
 *
 * MEDIA-ROW-HARDEN-001 (2026-09-20): 2+ 张图跟主 Feed（AdaptiveMediaCollection）
 * 同一套规则——横滑，默认一屏露完整 2 张，卡片宽度固定 = (容器宽 - gap) / 2，
 * 高度按黄金比例（1:1.618），不看任何一张照片自己的 sourceAspect。之前是
 * 单行 flex:1 等分（不滑动），3/4 张图会被硬挤成又窄又长的条状，完全不可读——
 * 这正是真机上传真实套图时露出来的问题。单张图（variant "one"）不变。
 */
import { useState } from "react";
import { Image as ExpoImage } from "expo-image";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { color } from "../theme";
import type { FeedMediaItem } from "@proxy/contracts";
import { HorizontalSwipeRail } from "./horizontal-swipe-rail";
import { AIMediaBadge } from "../media/ai-media-badge";

const FALLBACK_BG = "#EEE";
// MEDIA-ROW-HARDEN-001: 跟 media-presentation.ts 的 MEDIA_ROW_GOLDEN_RATIO
// 保持同一个数字——两处都是"2 张一排"卡片的同一条规则，数字必须对得上。
const GOLDEN_RATIO = 1.618;
const ROW_GAP = 6;

type Props = {
  items: FeedMediaItem[];
  resolveUrl: (path: string) => string;
  onOpen: (index: number) => void;
};

function MediaCell({ item, resolveUrl, onPress, big, cellSize }: { item: FeedMediaItem; resolveUrl: (path: string) => string; onPress: () => void; big?: boolean; cellSize?: { width: number; height: number } }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={[styles.mediaCell, big ? styles.mediaCellBig : null, cellSize ?? null]}>
      <ExpoImage
        accessibilityLabel={item.feedUrl ?? item.thumbnailUrl ?? "媒体"}
        contentFit="cover"
        source={{ uri: resolveUrl(item.feedUrl ?? item.thumbnailUrl ?? item.galleryUrl ?? "") }}
        style={StyleSheet.absoluteFill}
        transition={120}
      />
      {/* LC-06 显示侧：本组件覆盖个人主页 / 他人主页的帖子图片区（单图 + 多图），
          是"公共空间"里 AI 生成的图能被看到的另一条路。mediaCell 已经是
          position:relative + overflow:hidden，角标会被裁在圆角卡内。 */}
      <AIMediaBadge item={item} />
    </Pressable>
  );
}

export function ThreadsPostMedia({ items, resolveUrl, onOpen }: Props): React.JSX.Element {
  const [rowWidth, setRowWidth] = useState(0);
  if (items.length === 0) return <></>;
  if (items.length === 1) {
    const only = items[0];
    if (!only) return <></>;
    return (
      <View style={[styles.postMedia, styles.one]}>
        <MediaCell big item={only} resolveUrl={resolveUrl} onPress={() => onOpen(0)} />
      </View>
    );
  }
  const cardWidth = rowWidth > 0 ? (rowWidth - ROW_GAP) / 2 : 0;
  const cardHeight = cardWidth * GOLDEN_RATIO;
  return (
    <View onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)} style={styles.postMediaRowWrap}>
      {cardWidth > 0 ? (
        // SWIPE-RAIL-001：帖子多图横滑不能触发外层切页（跟 AdaptiveMediaCollection 同一套隔离）。
        <HorizontalSwipeRail contentContainerStyle={styles.rowContent} preserveChildPresses threshold={3}>
          {items.map((item, i) => (
            <MediaCell
              key={`${item.mediaAssetId}-${i}`}
              item={item}
              resolveUrl={resolveUrl}
              onPress={() => onOpen(i)}
              cellSize={{ width: cardWidth, height: cardHeight }}
            />
          ))}
        </HorizontalSwipeRail>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 单张图（variant "one"）：不变——整行大图，容器自己就是圆角裁切边框。
  postMedia: {
    backgroundColor: "#F2F2F2",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    marginTop: 11,
    overflow: "hidden"
  },
  one: { flexDirection: "column" },
  // MEDIA-ROW-HARDEN-001: 2+ 张图的外壳只管上边距——圆角/裁切挪到每张卡片
  // 自己身上（见 mediaCell），因为现在是横滑，容器本身不再是"一整块"。
  postMediaRowWrap: { marginTop: 11 },
  rowContent: { gap: ROW_GAP },
  // .media-cell: bg #eee overflow hidden position relative
  mediaCell: {
    backgroundColor: FALLBACK_BG,
    borderRadius: 12,
    overflow: "hidden",
    padding: 0,
    position: "relative"
  },
  // 单图专属：flex:1 撑满 postMedia 容器宽度 + min-h 210（沿用原 .two 高度）。
  // 只用在 variant "one"——多图横滑卡片靠 cellSize 给的固定宽高，套 flex:1
  // 会跟 ScrollView 内容区的自动宽度打架（flexBasis:0% 在不定宽容器里
  // 算不出真实尺寸，宽度会跌成 0 或不可预期）。
  mediaCellBig: { flex: 1, minHeight: 210 }
});

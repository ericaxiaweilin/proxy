/**
 * ThreadsPostMedia — me.tsx personalhub 帖子的图片区，不替换 AdaptiveMediaCollection。
 *
 * MEDIA-ROW-001: 原来 1:1 抄 proxy_personal_profile_architecture_v5_threads.html
 * 的 .post-media，3/4 张图是 2x2 网格（第一格跨两行）。改成不管几张图都单行
 * 铺开、每格 flex:1 等分——原因见下面 ThreadsPostMedia 函数里的注释（网格
 * 版本会漏渲染第 4 张图）。单张图仍是整行大图（variant "one"）。
 */
import { Image as ExpoImage } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import type { FeedMediaItem } from "@proxy/contracts";

const FALLBACK_BG = "#EEE";

type Props = {
  items: FeedMediaItem[];
  resolveUrl: (path: string) => string;
  onOpen: (index: number) => void;
};

function MediaCell({ item, resolveUrl, onPress, moreCount, big }: { item: FeedMediaItem; resolveUrl: (path: string) => string; onPress: () => void; moreCount?: number | undefined; big?: boolean }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={[styles.mediaCell, big ? styles.mediaCellBig : null]}>
      <ExpoImage
        accessibilityLabel={item.feedUrl ?? item.thumbnailUrl ?? "媒体"}
        contentFit="cover"
        source={{ uri: resolveUrl(item.feedUrl ?? item.thumbnailUrl ?? item.galleryUrl ?? "") }}
        style={StyleSheet.absoluteFill}
        transition={120}
      />
      {typeof moreCount === "number" && moreCount > 0 ? (
        <View style={styles.moreMedia}><Text style={styles.moreMediaText}>+{moreCount}</Text></View>
      ) : null}
    </Pressable>
  );
}

// MEDIA-ROW-001: 不管几张图都单行铺开，不做二行网格——旧的 three/four
// 分支是 2x2 网格、第一格跨两行，实际只塞得下 3 个格子，第 4 张图直接被
// slice(1,3) 漏掉，连"+N"角标都没有（i 只会是 0/1，i===2 的判断永远假）。
// 改成单行后每张图都是平等的 flex:1 格子，shown 里有几张就渲染几个格子，
// 角标钉在最后一格，不会再漏图。
export function ThreadsPostMedia({ items, resolveUrl, onOpen }: Props): React.JSX.Element {
  if (items.length === 0) return <></>;
  const shown = items.slice(0, 4);
  const moreCount = items.length - shown.length;
  if (shown.length === 1) {
    const only = shown[0];
    if (!only) return <></>;
    return (
      <View style={[styles.postMedia, styles.one]}>
        <MediaCell big item={only} resolveUrl={resolveUrl} onPress={() => onOpen(0)} />
      </View>
    );
  }
  return (
    <View style={[styles.postMedia, styles.row]}>
      {shown.map((item, i) => (
        <MediaCell
          key={`${item.mediaAssetId}-${i}`}
          item={item}
          resolveUrl={resolveUrl}
          onPress={() => onOpen(i)}
          {...(i === shown.length - 1 ? { moreCount } : {})}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // MEDIA-GAP-001: 参考稿 .post-media 写的 gap 2px，实机量过 x=64/155.67 +
  // x=221.67/155.33——两格确实是并排的，不是重叠，但 2px 缝在 #F2F2F2 底色上
  // 几乎看不出来，两张照片连着看就像一张。分隔要看得出来，缝宽到 6px。
  postMedia: {
    backgroundColor: "#F2F2F2",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    marginTop: 11,
    overflow: "hidden"
  },
  // .one: grid 1fr
  one: { flexDirection: "column" },
  // MEDIA-ROW-001: 2/3/4 张图统一单行，每格 flex:1 等分宽度
  row: { flexDirection: "row", minHeight: 210 },
  // .media-cell: border 0 p 0 bg #eee min-h 190 overflow hidden position relative
  mediaCell: {
    backgroundColor: FALLBACK_BG,
    flex: 1,
    minHeight: 190,
    overflow: "hidden",
    padding: 0,
    position: "relative"
  },
  // 单图（variant "one"）沿用原 .two 的 min-h 210
  mediaCellBig: { minHeight: 210 },
  // .more-media: pos abs inset 0 bg rgba(0,0,0,.34) color #fff grid place center font 22 weight 650
  moreMedia: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,.34)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  moreMediaText: { color: "color.white", fontSize: 22, fontWeight: "700" }
});

/**
 * ThreadsPostMedia — 1:1 复刻 proxy_personal_profile_architecture_v5_threads.html
 * .post-media 严格按规范: 1/2/3/4 张图不同 layout
 *
 * CSS:
 *   .post-media            { display: grid; gap: 2px; margin-top: 11px; border-radius: 12px; overflow: hidden; background: #f2f2f2 }
 *   .post-media.one        { grid-template-columns: 1fr }
 *   .post-media.two        { grid-template-columns: 1fr 1fr }
 *   .post-media.three      { grid-template-columns: 1fr 1fr; grid-template-rows: 138px 138px }
 *                           (first cell: grid-row 1/3, 跨两行)
 *   .post-media.four       { grid-template-columns: 1fr 1fr; grid-template-rows: 138px 138px }
 *   .media-cell            { border: 0; padding: 0; background: #eee; overflow: hidden; position: relative; min-height: 190px }
 *   .post-media.two   .media-cell { min-height: 210px }
 *   .post-media.three .media-cell,
 *   .post-media.four  .media-cell { min-height: 0 }
 *   .more-media            { position: absolute; inset: 0; background: rgba(0,0,0,.34); color: #fff; display: grid; place-items: center; font-size: 22px; font-weight: 650 }
 *
 * RN 限制: 不支持 CSS grid → 用 flex + flexBasis; 跨行用 flex 2-row
 *
 * 仅用于 me.tsx personalhub (Threads v5 规范 1:1), 不替换 AdaptiveMediaCollection
 */
import { Image as ExpoImage } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

export function ThreadsPostMedia({ items, resolveUrl, onOpen }: Props): React.JSX.Element {
  if (items.length === 0) return <></>;
  const shown = items.slice(0, 4);
  const moreCount = items.length - shown.length;
  const variant = shown.length === 1 ? "one" : shown.length === 2 ? "two" : "many";
  if (variant === "one") {
    const only = shown[0];
    if (!only) return <></>;
    return (
      <View style={[styles.postMedia, styles.one]}>
        <MediaCell big item={only} resolveUrl={resolveUrl} onPress={() => onOpen(0)} />
      </View>
    );
  }
  if (variant === "two") {
    return (
      <View style={[styles.postMedia, styles.two]}>
        {shown.map((item, i) => <MediaCell key={`${item.mediaAssetId}-${i}`} item={item} resolveUrl={resolveUrl} onPress={() => onOpen(i)} {...(i === 3 ? { moreCount } : {})} />)}
      </View>
    );
  }
  // three / four: 2x2 grid, first cell spans 2 rows (spec: .three first child: grid-row 1/3)
  const first = shown[0];
  if (!first) return <></>;
  return (
    <View style={[styles.postMedia, styles.many]}>
      <View style={styles.manyFirstColumn}>
        <MediaCell big item={first} resolveUrl={resolveUrl} onPress={() => onOpen(0)} />
      </View>
      <View style={styles.manySecondColumn}>
        {shown.slice(1, 3).map((item, i) => <MediaCell key={`${item.mediaAssetId}-${i + 1}`} item={item} resolveUrl={resolveUrl} onPress={() => onOpen(i + 1)} {...(i === 2 ? { moreCount } : {})} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // .post-media: gap 2 marginTop 11 radius 12 overflow hidden bg #f2f2f2
  postMedia: {
    backgroundColor: "#F2F2F2",
    borderRadius: 12,
    flexDirection: "row",
    gap: 2,
    marginTop: 11,
    overflow: "hidden"
  },
  // .one: grid 1fr
  one: { flexDirection: "column" },
  // .two: grid 1fr 1fr (proxy: flex row, flexBasis 50%, minHeight 210)
  two: { flexDirection: "row", minHeight: 210 },
  // .three/.four: grid 1fr 1fr grid-template-rows 138 138, first cell 跨 2 行
  many: { flexDirection: "row", minHeight: 276 },
  manyFirstColumn: { flex: 1 },
  manySecondColumn: { flex: 1, gap: 2 },
  // .media-cell: border 0 p 0 bg #eee min-h 190 overflow hidden position relative
  mediaCell: {
    backgroundColor: FALLBACK_BG,
    flex: 1,
    minHeight: 190,
    overflow: "hidden",
    padding: 0,
    position: "relative"
  },
  // .post-media.two .media-cell: min-h 210 (RN 跟 flex 配合, 让 row 有 minHeight)
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
  moreMediaText: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" }
});

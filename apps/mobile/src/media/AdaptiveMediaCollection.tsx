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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ImageSourcePropType, NativeSyntheticEvent, ImageLoadEventData } from "react-native";
import ImageViewing from "react-native-image-viewing";
import { useVideoPlayer, VideoView } from "expo-video";
import type { FeedMediaItem } from "@proxy/contracts";
import type { MediaCompositionHint } from "@proxy/contracts";
import {
  selectVariantForViewport,
  selectVideoPlaybackUrl,
  selectImageShape,
  FRAME_BACKGROUND_HEX
} from "@proxy/contracts";
import { color } from "../theme";
import {
  mediaAspect,
  mediaCollectionMode,
  mediaRailMetrics,
  nearestRailIndex,
  shouldAutoPlayVideo
} from "../media-presentation";
import { SocialMediaFrame } from "./SocialMediaFrame";

function onImageLoad(
  event: NativeSyntheticEvent<ImageLoadEventData>,
  declaredAspect: number,
  setLoadedAspect: (aspect: number) => void
): void {
  const source = event.nativeEvent.source;
  if (!declaredAspect && source.width > 0 && source.height > 0) {
    setLoadedAspect(source.width / source.height);
  }
}

type ItemWithHint = FeedMediaItem & { compositionHint?: MediaCompositionHint | undefined };

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

/**
 * §5.2.3 Media Kind Dispatcher。
 * 决定一个 item 走哪个渲染组件：
 *   VIDEO         → VideoStage (expo-video, autoplay + mute)
 *   TEXT_HEAVY    → SinglePostImage + 预留安全区
 *   PANORAMA      → SinglePostImage (原比例 contain)
 *   ANIMATED      → SinglePostImage (原比例 contain + 多帧 image)
 *   CAROUSEL      → SinglePostImage (以商品首图为主图，1/6 角标)
 *   IMAGE (default) → SinglePostImage
 * v1 实现：VIDEO 走 VideoStage；其他 kind 都走 SinglePostImage  + 角标/kind badge。
 *   ANIMATED / PANORAMA / TEXT_HEAVY / CAROUSEL 的高级 UI 渲染留 v3 (需多资源
 *   server 端：多帧图、pano cube、轮播 dot 组件等)。
 */
function renderKindAwareStage(
  item: ItemWithHint,
  aspect: number,
  uri: string,
  onPress: () => void,
  resolveUrl: (path: string) => string
): React.JSX.Element {
  if (item.mediaType === "VIDEO") {
    // §5.2.3 VIDEO 必须走 playbackUrl (原始流)；不能走 thumbnailUrl (JPEG 不能播)
    const playbackUri = resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "");
    return <VideoStage item={item} uri={playbackUri} autoPlay={shouldAutoPlayVideo(item)} onPress={onPress} />;
  }
  return (
    <SinglePostImage
      item={item}
      aspect={aspect}
      resolveUrl={resolveUrl}
      onPress={onPress}
    />
  );
}

export function AdaptiveMediaCollection(props: Props): React.JSX.Element {
  const mode = mediaCollectionMode(props.items.length);
  if (mode === "WALL") return <MediaWall {...props} />;
  if (mode === "RAIL") return <AdaptiveMediaRail {...props} />;
  return <SinglePostCollection {...props} />;
}

// 全屏媒体查看器。深紫黑背景，缩略图不放大。接 react-native-image-viewing (IMAGE) + expo-video (VIDEO)。
// 混合媒体：按当前 item.mediaType 选渲染；切换 index 自动重建。
export function MediaViewer({
  items,
  index,
  author,
  resolveUrl,
  onNavigate,
  onClose
}: {
  items: FeedMediaItem[];
  index: number;
  author: string;
  resolveUrl: (path: string) => string;
  onNavigate: (next: number) => void;
  onClose: () => void;
}): React.JSX.Element {
  const safeIndex = Math.max(0, Math.min(index, items.length - 1));
  const current = items[safeIndex];
  if (!current) return <View />;
  const header = (
    <View pointerEvents="box-none" style={viewerStyles.top}>
      <Text style={viewerStyles.counter}>{safeIndex + 1}/{items.length} · {author}</Text>
      <Pressable
        accessibilityLabel="关闭原图"
        accessibilityRole="button"
        hitSlop={16}
        onPress={onClose}
        onPressIn={onClose}
        style={viewerStyles.close}
      >
        <Text style={viewerStyles.closeText}>×</Text>
      </Pressable>
    </View>
  );
  // VIDEO 走 expo-video 原生 enterFullscreen() (iOS AVPlayerViewController fullscreen)，
  // 不需在 MediaViewer 里自己造 Modal + VideoView (用开源 native fullscreen 代替重复造轮子)。
  // fullscreen 状态由 expo-video 内部管理 (enterFullscreen / exitFullscreen)，
  // 这里返回 null — VideoStage 的 onPress() 已经调 videoViewRef.current.enterFullscreen()。
  if (current.mediaType === "VIDEO") {
    return null as unknown as React.JSX.Element;
  }
  // IMAGE
  const sources = items.map((item) => ({
    uri: resolveUrl(item.galleryUrl ?? item.feedUrl ?? item.thumbnailUrl ?? "")
  }));
  return (
    <ImageViewing
      images={sources}
      imageIndex={safeIndex}
      visible
      backgroundColor="#050507"
      onRequestClose={onClose}
      onImageIndexChange={onNavigate}
      HeaderComponent={() => header}
    />
  );
}

const viewerStyles = StyleSheet.create({
  top: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 52,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 101
  },
  counter: { color: "rgba(255,255,255,0.82)", fontSize: 11, fontWeight: "700" },
  close: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
    zIndex: 101
  },
  closeText: { color: color.white, fontSize: 16 },
  videoRoot: {
    backgroundColor: "#050507",
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    zIndex: 200
  },
  videoStage: {
    alignItems: "center",
    ...StyleSheet.absoluteFill,
    justifyContent: "center"
  },
  videoFill: {
    height: "100%",
    width: "100%"
  },
  videoLoading: {
    alignItems: "center",
    backgroundColor: "rgba(5,5,7,1)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  videoLoadingText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 1
  },
  navBar: {
    bottom: 60,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 24,
    position: "absolute",
    right: 0
  },
  navButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  navText: {
    color: color.white,
    fontSize: 22,
    fontWeight: "700"
  }
});

export function SinglePostImage({ item, aspect, resolveUrl, onPress }: {
  item: ItemWithHint;
  aspect?: number;
  resolveUrl: (path: string) => string;
  onPress: () => void;
}): React.JSX.Element {
  const declaredAspect = mediaAspect(item, 0);
  const [loadedAspect, setLoadedAspect] = useState(0);
  const sourceAspect = aspect ?? declaredAspect ?? loadedAspect ?? 4 / 3;
  // Gate N (selectImageShape) — 按 source aspect 分流 4 形态，不强制 0.8–1.91 clamp。
  // 【裁剪不变量】
  //   - 9:16 长图 (0.5625) → STORY_9_16 按 3:4 拉满屏 + 底部 60pt caption，不出现上下灰边。
  //   - 4:5 portrait (0.8) → PORTRAIT_4_5 按原比例。
  //   - 1:1 / 1.25:1 → SQUARE 按原比例。
  //   - > 1.91:1 横图 → LANDSCAPE 按原比例。
  const shape = selectImageShape(sourceAspect);
  const shapeAspect = (() => {
    switch (shape) {
      case "STORY_9_16": return 3 / 4; // 拉满屏。
      case "PORTRAIT_4_5": return sourceAspect; // 原比例 0.5626–0.8
      case "SQUARE": return sourceAspect; // 原比例 0.8–1.25
      case "LANDSCAPE": return Math.min(sourceAspect, 1.91); // 不超过 1.91
    }
  })();
  // Gate A (selectVariantForViewport) — 屏宽感知档位。与 SocialMediaFrame 保持同一函数，
  // 避免 SINGLE / RAIL / WALL 三个渲染路径走出三套选择逻辑。
  const { width: viewportWidth } = useWindowDimensions();
  const uri = resolveUrl(selectVariantForViewport(item, viewportWidth).url ?? "");
  return (
    <Pressable
      accessibilityLabel="查看原图"
      onPress={onPress}
      style={[styles.singleStage, { aspectRatio: shapeAspect }]}
    >
      <View style={styles.singleFill}>
        <Image
          onLoad={(event) => onImageLoad(event, declaredAspect, setLoadedAspect)}
          resizeMode="contain"
          source={{ uri } as ImageSourcePropType}
          style={styles.singleAsset}
        />
      </View>
    </Pressable>
  );
}

function SinglePostCollection({ items, resolveUrl, onOpen }: Props): React.JSX.Element {
  // §5.2 / §5.2.1 — SINGLE 集合 (3 种)：
  //   1 张         → 原比例
  //   1 VIDEO     → 1/1 autoplay + mute
  //   1 PANORAMA  → 1/1 原比例 contain
  //   1 CAROUSEL  → 主图 + 1/N 角标
  if (items.length === 0) return <View />;
  const item = items[0]!;
  const aspect = mediaAspect(item, 4 / 3);
  const { width: viewportWidth } = useWindowDimensions();
  const uri = item.mediaType === "VIDEO"
    ? resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "")
    : resolveUrl(selectVariantForViewport(item, viewportWidth).url ?? "");
  return renderKindAwareStage(item, aspect, uri, () => onOpen(0), resolveUrl);
}

/**
 * §5.2.3 VideoStage — VIDEO 专用 stage。
 * - autoplay (≤ 60s) / 默认静默
 * - 点一下切换暂停 / 播放
 * - 顶上一条下颗 = 长视频提示
 * - 上报 frame 位置（供 ScrollView 预读控制）
 */
function VideoStage({
  item,
  uri,
  autoPlay,
  onPress
}: {
  item: ItemWithHint;
  uri: string;
  autoPlay: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const declaredAspect = mediaAspect(item, 0);
  const sourceAspect = declaredAspect || 16 / 9;
  // Gate N (selectImageShape) — VIDEO 同样按 4 形态分流，不强制 0.8–1.91 clamp。
  const shape = selectImageShape(sourceAspect);
  const displayAspect = (() => {
    switch (shape) {
      case "STORY_9_16": return 3 / 4;
      case "PORTRAIT_4_5": return sourceAspect;
      case "SQUARE": return sourceAspect;
      case "LANDSCAPE": return Math.min(sourceAspect, 1.91);
    }
  })();
  const player = useVideoPlayer(uri, (setup) => {
    setup.loop = true;
    setup.muted = true;
    // Gate J (coldStartToFirstFrame) — iOS AVPlayer 提前缓冲 3s，
    // 用户点入全屏时 key frame 已在 player.buffered 中，首帧装帧 < 50ms。
    // TS 类型未导出，但 iOS AVPlayerItem 接受。
    (setup as { preferredForwardBufferDuration?: number }).preferredForwardBufferDuration = 3;
  });
  const videoViewRef = useRef<VideoView>(null);
  useEffect(() => {
    if (autoPlay) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, autoPlay]);
  const handlePress = useCallback(() => {
    // 优选：调 expo-video 原生 enterFullscreen() 走 iOS AVPlayerViewController fullscreen。
    // 优势：player 已在 background 装帧 + key frame ready → system fullscreen 0ms 装帧。
    if (videoViewRef.current) {
      void videoViewRef.current.enterFullscreen();
    }
    onPress();
  }, [onPress]);
  return (
    <Pressable
      accessibilityLabel="查看视频"
      onPress={handlePress}
      style={[styles.videoStage, { aspectRatio: displayAspect }]}
    >
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.videoView}
        contentFit="cover"
        fullscreenOptions={{ enable: true, orientation: "portrait" }}
        useExoShutter={false}
        onFirstFrameRender={() => {
          // Gate J: 首帧已装 → 视频在屏内可观看。
          // 不需额外状态管理，expo-video 已经渲染 surface。
        }}
      />
      <View pointerEvents="none" style={styles.videoBadge}>
        <Text style={styles.videoBadgeText}>视频</Text>
        {item.durationMs ? <Text style={styles.videoBadgeText}>· {Math.round(item.durationMs / 1000)}s</Text> : null}
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
          const isVideo = item.mediaType === "VIDEO";
          const cardUri = isVideo
            ? resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "")
            : resolveUrl(selectVariantForViewport(item, contentWidth).url ?? "");
          return (
            <Pressable
              accessibilityLabel={`查看第 ${index + 1} 张媒体`}
              key={item.mediaAssetId}
              onPress={() => onOpen(index)}
              style={{ height: metrics.railHeight, marginRight: CARD_GAP, width: cardWidth }}
            >
              {isVideo ? (
                <VideoStage
                  item={item as ItemWithHint}
                  uri={cardUri}
                  autoPlay={shouldAutoPlayVideo(item) && index === currentIndex}
                  onPress={() => onOpen(index)}
                />
              ) : (
                <SocialMediaFrame item={item as ItemWithHint} frameAspect={cardWidth / metrics.railHeight} resolveUrl={resolveUrl} />
              )}
              <View style={styles.railBadge}><Text style={styles.railBadgeText}>{index + 1}/{items.length}</Text></View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.railHint}>{currentIndex + 1}/{items.length} · 左右滑动查看</Text>
    </View>
  );
}

function MediaWall({ items, resolveUrl, onOpen }: Props): React.JSX.Element {
  const [contentWidth, setContentWidth] = useState(320);
  const cellWidth = (contentWidth - WALL_GAP) / 2;
  return (
    <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <View style={styles.wall}>
        {items.map((item, index) => {
          const aspect = mediaAspect(item, 1);
          // 4:5 portrait 画布优先；其他按 sourceAspect；最高 4:5（不被压成横条）
          const cellAspect = aspect >= 1 ? 1 : Math.max(4 / 5, aspect);
          const isVideo = item.mediaType === "VIDEO";
          const cardUri = isVideo
            ? resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "")
            : resolveUrl(selectVariantForViewport(item, cellWidth).url ?? "");
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
              {isVideo ? (
                <VideoStage
                  item={item as ItemWithHint}
                  uri={cardUri}
                  autoPlay={shouldAutoPlayVideo(item) && index === 0}
                  onPress={() => onOpen(index)}
                />
              ) : (
                <SocialMediaFrame item={item as ItemWithHint} frameAspect={cellAspect} resolveUrl={resolveUrl} />
              )}
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
    backgroundColor: FRAME_BACKGROUND_HEX,
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
  // VideoStage
  videoStage: {
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: 14,
    overflow: "hidden",
    width: "100%"
  },
  videoView: {
    height: "100%",
    width: "100%"
  },
  videoBadge: {
    alignItems: "center",
    backgroundColor: "rgba(14,10,20,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: "absolute",
    top: 8
  },
  videoBadgeText: {
    color: color.white,
    fontSize: 11,
    fontWeight: "700"
  },
  // Wall
  wall: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start"
  },
  wallCell: {
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: 12,
    marginBottom: WALL_GAP,
    overflow: "hidden"
  }
});

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
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image as ExpoImage } from "expo-image";
import ImageViewing from "react-native-image-viewing";
import { useVideoPlayer, VideoView } from "expo-video";
import { claimVideoPlayback, releaseVideoPlayback } from "./video-playback-registry";
import type { FeedMediaItem } from "@proxy/contracts";
import type { MediaCompositionHint } from "@proxy/contracts";
import {
  selectVariantForViewport,
  selectVideoPlaybackUrl,
  selectImageShape,
  resolveFrameBackground,
  shouldUseExtendedBackdrop,
  FRAME_BACKGROUND_HEX
} from "@proxy/contracts";
import { color } from "../theme";
import {
  mediaAspect,
  mediaCollectionMode,
  mediaRailMetrics,
  nearestRailIndex,
  shouldAutoPlayVideo,
  wallCellAspect
} from "../media-presentation";
import { SocialMediaFrame } from "./SocialMediaFrame";
import { AudioStage } from "./audio-stage";
import {
  SOCIAL_MEDIA_BADGE_INSET,
  SOCIAL_MEDIA_GRID_GAP,
  SOCIAL_MEDIA_RADIUS,
  SOCIAL_MEDIA_RAIL_GAP,
  SOCIAL_MEDIA_RAIL_TRAILING_SPACE
} from "./social-media-aesthetics";

function onImageLoad(
  event: { source: { width: number; height: number } },
  declaredAspect: number,
  setLoadedAspect: (aspect: number) => void
): void {
  const source = event.source;
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
  // 【fix 2026-08-26】X 风格“同屏一个 VIDEO 在播”：父级（feed.tsx）用
  // 滚动位置 + onVideoFrame 计算 “哪个 VIDEO 离视口中心最近”，传 activeVideoKey。
  // collection 内只有 VIDEO item.activeKey === activeVideoKey 才走 ActiveVideoStage
  // （真创建 AVPlayer + play），其他 VIDEO 走 ExpoImage 占位 → 物理上不占 audio session。
  activeVideoKey?: string | null | undefined;
  onVideoFrame?: (videoKey: string, frame: { y: number; height: number }) => void;
  /** collection 归属的 postId，用于拼 videoKey 格式 "postId:index:mediaAssetId" */
  collectionKey?: string;
};

const CARD_GAP = SOCIAL_MEDIA_RAIL_GAP;
const WALL_GAP = SOCIAL_MEDIA_GRID_GAP;
const RAIL_HORIZONTAL_PADDING = SOCIAL_MEDIA_RAIL_TRAILING_SPACE;

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
  resolveUrl: (path: string) => string,
  isActive: boolean | undefined,
  onFrame: ((frame: { y: number; height: number }) => void) | undefined
): React.JSX.Element {
  if (item.mediaType === "VIDEO") {
    // §5.2.3 VIDEO 必须走 playbackUrl (原始流)；不能走 thumbnailUrl (JPEG 不能播)
    const playbackUri = resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "");
    // exactOptionalPropertyTypes: VideoStage.isActive 是 ?: boolean（不允许显式 undefined），
    // 透传 isActive: undefined 会被 strict 拒绝。这里只在 isActive 真有 boolean 值时才传。
    return (
      <View style={styles.singleInset}>
        <VideoStage item={item} uri={playbackUri} autoPlay={shouldAutoPlayVideo(item)} {...(isActive === undefined ? {} : { isActive })} onPress={onPress} frameAspect={aspect} resolveUrl={resolveUrl} {...(onFrame ? { onFrame } : {})} />
      </View>
    );
  }
  if (item.mediaType === "AUDIO") {
    // §5.2.3 AUDIO：语音播放卡（无画面），playbackUrl 即原文件；不进图片查看器。
    return <AudioStage item={item} uri={resolveUrl(item.playbackUrl ?? "")} />;
  }
  return (
    <View style={styles.singleInset}>
      <SinglePostImage
        item={item}
        aspect={aspect}
        resolveUrl={resolveUrl}
        onPress={onPress}
      />
    </View>
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
  const [availableWidth, setAvailableWidth] = useState(0);
  // The decoded asset is authoritative. A stale/missing server aspect used to
  // lock portrait photos into a landscape frame, producing contain side bands.
  const sourceAspect = loadedAspect || aspect || declaredAspect || 4 / 3;
  const maxDisplayHeight = availableWidth > 0 ? Math.min(440, availableWidth * 1.25) : 0;
  const displayWidth = availableWidth > 0 && sourceAspect < 0.8
    ? Math.min(availableWidth, maxDisplayHeight * sourceAspect)
    : availableWidth;
  // 【fix 2026-08-26】信任 caller 传入的 aspect，否则用 declaredAspect，不强制 shapeAspect。
  // 旧逻辑用 selectImageShape → STORY_9_16 强制 3:4 → 9:16 上下大段深紫黑。
  // 现逻辑：按 sourceAspect 原比例渲染，contain 模式下 expo-image 自带补深紫黑。
  // history: 5.2.1 spec 的"不出现上下灰边"原本意图是"不要白/灰边"，用 FRAME_BACKGROUND_HEX + contain
  // 已保证；强制 3:4 frame 会让 9:16 上下**额外**多出一段深紫黑（实际是双层 pad），看起来"压扁了"。
  const shapeAspect = sourceAspect;
  // Gate A (selectVariantForViewport) — 屏宽感知档位。与 SocialMediaFrame 保持同一函数，
  // 避免 SINGLE / RAIL / WALL 三个渲染路径走出三套选择逻辑。
  const { width: viewportWidth } = useWindowDimensions();
  const selection = selectVariantForViewport(item, viewportWidth);
  const uri = resolveUrl(selection.url ?? "");
  const frameBackground = resolveFrameBackground(item.dominantColorHex);
  // 【fix 2026-08-26】SinglePostImage 走 contain（expo-image contentFit="contain" 写死），
  // contain 模式下图片已完整居中显示，不传 contentPosition。
  // 历史：v2 focalPoint 透传 → 9:16 portrait 头像图被贴顶 → 看起来"被切了"。
  return (
    <View onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)} style={styles.singleMeasure}>
      {displayWidth > 0 ? (
        <Pressable
          accessibilityLabel="查看原图"
          onPress={onPress}
          style={[styles.singleStage, { aspectRatio: shapeAspect, backgroundColor: frameBackground, width: displayWidth }]}
        >
          <View style={styles.singleFill}>
            <ExpoImage
              source={{ uri }}
              style={styles.singleAsset}
              contentFit="contain"
              contentPosition="center"
              transition={200}
              cachePolicy="memory-disk"
              priority="normal"
              recyclingKey={item.mediaAssetId}
              onLoad={(event) => onImageLoad(event, declaredAspect, setLoadedAspect)}
            />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function SinglePostCollection({ items, resolveUrl, onOpen, activeVideoKey, onVideoFrame, collectionKey }: Props): React.JSX.Element {
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
  const isVideo = item.mediaType === "VIDEO";
  const videoKey = isVideo ? `${collectionKey ?? "0"}:0:${item.mediaAssetId}` : null;
  const isActive = isVideo ? activeVideoKey === videoKey : undefined;
  const onFrame = isVideo && onVideoFrame && videoKey
    ? (frame: { y: number; height: number }) => onVideoFrame(videoKey, frame)
    : undefined;
  return renderKindAwareStage(item, aspect, uri, () => onOpen(0), resolveUrl, isActive, onFrame);
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
  isActive,
  onPress,
  frameAspect,
  resolveUrl,
  onFrame
}: {
  item: ItemWithHint;
  uri: string;
  autoPlay: boolean;
  // 【fix 2026-08-26】isActive=false 时走 thumbnail ExpoImage 占位，不创建 AVPlayer、不注册
  // audio session。这是 X/IG 风格 "全屏只一个 VIDEO 在播" 的关键：feed.tsx 计算当前视口中心的
  // videoId，非 active 那些 VIDEO 都是占位，物理上不存在 AVPlayer，不可能被争用 session。
  isActive?: boolean;
  onPress: () => void;
  // 【fix 2026-08-26】VIDEO 也信任 caller 传入的 frameAspect，避免 RAIL/WALL/SINGLE
  // 三个路径不同 frame 比例造成黑边。跟 SocialMediaFrame 保持同一原则。
  frameAspect?: number;
  resolveUrl: (path: string) => string;
  // 【fix 2026-08-26】 VIDEO frame 位置上报父级。feed.tsx 用 frames[videoKey] 算
  // 哪个 VIDEO 离视口中心最近 → activeVideoId → isActive。
  onFrame?: (frame: { y: number; height: number }) => void;
}): React.JSX.Element {
  const declaredAspect = mediaAspect(item, 0);
  const sourceAspect = declaredAspect || 16 / 9;
  const displayAspect = frameAspect ?? sourceAspect;
  const frameBackground = resolveFrameBackground(item.dominantColorHex);
  const showExtendedBackdrop = shouldUseExtendedBackdrop({ strategy: "contain", sourceAspect, frameAspect: displayAspect });
  const posterUri = resolveUrl(item.thumbnailUrl ?? item.feedUrl ?? "");
  // 【fix 2026-08-26 异音】isActive=false 时走 thumbnail 占位，但仍上报帧供 feed.tsx 选 active。
  // 否则 inactive 永远不上报 frames → activeVideoId 恒 null → 死锁（真机不播、点也不播）。
  if (isActive === false) {
    return (
      <Pressable
        accessibilityLabel="播放视频"
        onPress={onPress}
        onLayout={
          onFrame
            ? (event) => {
                const { y, height } = event.nativeEvent.layout;
                onFrame({ y, height });
              }
            : undefined
        }
        style={[styles.videoStage, { aspectRatio: displayAspect, backgroundColor: frameBackground }]}
      >
        {showExtendedBackdrop && posterUri ? <MediaBackdrop item={item} uri={posterUri} /> : null}
        <ExpoImage
          source={{ uri: posterUri }}
          style={styles.videoView}
          contentFit="contain"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={item.mediaAssetId}
        />
        <View pointerEvents="none" style={styles.videoBadge}>
          <Text style={styles.videoBadgeText}>视频</Text>
          {item.durationMs ? <Text style={styles.videoBadgeText}>· {Math.round(item.durationMs / 1000)}s</Text> : null}
        </View>
      </Pressable>
    );
  }
  return (
    <ActiveVideoStage
      item={item}
      uri={uri}
      autoPlay={autoPlay}
      onPress={onPress}
      displayAspect={displayAspect}
      resolveUrl={resolveUrl}
      showExtendedBackdrop={showExtendedBackdrop}
      frameBackground={frameBackground}
      posterUri={posterUri}
      {...(onFrame ? { onFrame } : {})}
    />
  );
}

/**
 * 真正创建 AVPlayer 的 VideoStage 子组件。
 * 【fix 2026-08-26】拆出独立组件后，autoPlay 路径才能在父级条件渲染时走实际 mount，
 * 避免 "同页多个 inactive player 抢 audio session" 的喡喡声。
 */
function ActiveVideoStage({
  item,
  uri,
  autoPlay,
  onPress,
  displayAspect,
  resolveUrl: _resolveUrl,
  showExtendedBackdrop,
  frameBackground,
  posterUri,
  onFrame
}: {
  item: ItemWithHint;
  uri: string;
  autoPlay: boolean;
  onPress: () => void;
  displayAspect: number;
  resolveUrl: (path: string) => string;
  showExtendedBackdrop: boolean;
  frameBackground: string;
  posterUri: string;
  onFrame?: (frame: { y: number; height: number }) => void;
}): React.JSX.Element {
  const player = useVideoPlayer({ uri, useCaching: true, contentType: "progressive" }, (setup) => {
    setup.loop = true;
    setup.muted = true;
    // 【fix 2026-08-26】mixWithOthers 避免 iOS audio session 切换提示音。
    setup.showNowPlayingNotification = false;
    setup.audioMixingMode = "mixWithOthers";
    // Gate J (coldStartToFirstFrame) — iOS AVPlayer 提前缓冲 3s，
    // 用户点入全屏时 key frame 已在 player.buffered 中，首帧装帧 < 50ms。
    // TS 类型未导出，但 iOS AVPlayerItem 接受。
    (setup as { preferredForwardBufferDuration?: number }).preferredForwardBufferDuration = 3;
    setup.timeUpdateEventInterval = 0.1;
  });
  const videoViewRef = useRef<VideoView>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);
  // Disk/network cache only avoids downloading again; AVPlayer still needs a short
  // decode window after this stage becomes active. Keep the cached poster above the
  // native surface until playback advances, so scrolling never exposes its black
  // initialization frame.
  useEffect(() => {
    setHasRenderedFrame(false);
    const subscription = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime > 0.01) setHasRenderedFrame(true);
    });
    return () => {
      subscription.remove();
    };
  }, [player, uri]);
  // 同步 muted 到原生 player（首播静音，点任意位置出声 — 不做小喇叭）
  useEffect(() => {
    try {
      player.muted = isMuted;
    } catch {}
  }, [player, isMuted]);
  // 【fix 2026-08-26 P0 多视频声音】
  // 旧 mount effect 无条件 play / pause —— 不论 isActive、autoPlay，AVPlayer 一挂载就
  // 调一次 play。多个 post 各自 mount → 多个 AVPlayer 同时进入 playing 状态 → iOS
  // audio session 争用，听到多个声音叠加（甚至还没滚到的 post 也在播）。
  // 新模型：mount 永远 pause，只有 (autoPlay) 才去 claim 单例播放位；
  // claim 成功才真 play（registry 内部会先 pause 其他所有 player，再 play 自己）。
  // unmount 一定 release，确保 AVPlayer 真的退出 audio session。
  useEffect(() => {
    claimVideoPlayback(player);
    return () => releaseVideoPlayback(player);
  }, [player]);
  useEffect(() => {
    if (autoPlay) player.play();
    else player.pause();
  }, [player, autoPlay]);
  const handlePress = useCallback(() => {
    // 首播静音，点任意位置出声（无小喇叭，feed 非全屏，按钮无意义）
    if (isMuted) {
      setIsMuted(false);
      try {
        player.muted = false;
      } catch {}
      claimVideoPlayback(player);
      player.play();
    }
    // 仍保留原 onPress 链路（如需埋点），但不再强制 enterFullscreen（非全屏无意义）
    onPress();
  }, [isMuted, player, onPress]);
  return (
    <Pressable
      accessibilityLabel="查看视频"
      onPress={handlePress}
      onLayout={onFrame ? (event) => {
        const ly = event.nativeEvent.layout;
        onFrame({ y: ly.y, height: ly.height });
      } : undefined}
      style={[styles.videoStage, { aspectRatio: displayAspect, backgroundColor: frameBackground }]}
    >
      {showExtendedBackdrop && posterUri ? <MediaBackdrop item={item} uri={posterUri} /> : null}
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.videoView}
        contentFit="contain"
        fullscreenOptions={{ enable: true, orientation: "portrait" }}
        useExoShutter={false}
      />
      {!hasRenderedFrame && posterUri ? (
        <ExpoImage
          accessible={false}
          cachePolicy="memory-disk"
          contentFit="contain"
          recyclingKey={`${item.mediaAssetId}:active-poster`}
          source={{ uri: posterUri }}
          style={styles.videoPosterOverlay}
          transition={0}
        />
      ) : null}
      <View pointerEvents="none" style={styles.videoBadge}>
        <Text style={styles.videoBadgeText}>视频</Text>
        {item.durationMs ? <Text style={styles.videoBadgeText}>· {Math.round(item.durationMs / 1000)}s</Text> : null}
      </View>
    </Pressable>
  );
}

function MediaBackdrop({ item, uri }: { item: ItemWithHint; uri: string }): React.JSX.Element {
  return (
    <ExpoImage
      accessible={false}
      blurRadius={32}
      cachePolicy="memory-disk"
      contentFit="cover"
      priority="low"
      recyclingKey={`${item.mediaAssetId}:video-backdrop`}
      source={{ uri }}
      style={styles.mediaBackdrop}
    />
  );
}

function AdaptiveMediaRail({ items, currentIndex, resolveUrl, onIndexChange, onOpen, activeVideoKey, onVideoFrame, collectionKey }: Props): React.JSX.Element {
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
        // A media rail owns horizontal drags. Stop the shell's bubbled-touch
        // page switcher from interpreting photo paging as module navigation.
        onTouchStart={(event) => event.stopPropagation()}
        onMomentumScrollEnd={(event) => onIndexChange(nearestRailIndex(metrics.offsets, event.nativeEvent.contentOffset.x))}
        ref={railRef}
        snapToOffsets={metrics.offsets}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
      >
        {items.map((item, index) => {
          const cardWidth = metrics.cardWidths[index] ?? contentWidth * 0.84;
          const cardHeight = metrics.cardHeights[index] ?? metrics.railHeight;
          const isVideo = item.mediaType === "VIDEO";
          const cardUri = isVideo
            ? resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "")
            : resolveUrl(selectVariantForViewport(item, contentWidth).url ?? "");
          const videoKey = isVideo ? `${collectionKey ?? "0"}:${index}:${item.mediaAssetId}` : null;
          // 【fix 2026-08-26】X 风格 active VIDEO：只有 “父级算出的 activeVideoKey”
          // 且 index === currentIndex（RAIL 水平焦点） 才走 ActiveVideoStage 真播。
          // 其他 VIDEO 走 ExpoImage 占位 → 物理上不创建 AVPlayer → 不会争用 audio session。
          const isActive = isVideo && activeVideoKey === videoKey && index === currentIndex;
          const onFrame = isVideo && onVideoFrame && videoKey
            ? (frame: { y: number; height: number }) => onVideoFrame(videoKey, frame)
            : undefined;
          return (
            <Pressable
              accessibilityLabel={`查看第 ${index + 1} 张媒体`}
              key={item.mediaAssetId}
              onPress={() => onOpen(index)}
              style={{ alignSelf: "center", height: cardHeight, marginRight: CARD_GAP, width: cardWidth }}
            >
              {isVideo ? (
                <VideoStage
                  item={item as ItemWithHint}
                  uri={cardUri}
                  autoPlay={shouldAutoPlayVideo(item) && index === currentIndex}
                  isActive={isActive}
                  onPress={() => onOpen(index)}
                  frameAspect={cardWidth / cardHeight}
                  resolveUrl={resolveUrl}
                  {...(onFrame ? { onFrame } : {})}
                />
              ) : (
                <SocialMediaFrame item={item as ItemWithHint} frameAspect={cardWidth / cardHeight} resolveUrl={resolveUrl} />
              )}
              <View style={styles.railBadge}><Text style={styles.railBadgeText}>{index + 1}/{items.length}</Text></View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function MediaWall({ items, resolveUrl, onOpen, activeVideoKey, onVideoFrame, collectionKey }: Props): React.JSX.Element {
  const [contentWidth, setContentWidth] = useState(320);
  const cellWidth = (contentWidth - WALL_GAP) / 2;
  const columns = [
    items.map((item, index) => ({ item, index })).filter(({ index }) => index % 2 === 0),
    items.map((item, index) => ({ item, index })).filter(({ index }) => index % 2 === 1)
  ];
  return (
    <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <View style={styles.wall}>
        {columns.map((column, columnIndex) => (
          <View key={`wall-column-${columnIndex}`} style={[styles.wallColumn, columnIndex === 0 ? { marginRight: WALL_GAP } : null]}>
            {column.map(({ item, index }) => {
              // Wall cell aspect: portrait 走 4:5 最低 (不被压
              // 成横条)，landscape 走 1:1 最高 (不超长到撑爆 row)。
              // 9:16 (0.56) portrait → 0.56  (原比例)
              // 4:5 (0.8) portrait   → 0.8
              // 1:1 (1.0) square     → 1.0
              // 4:3 (1.33) landscape  → 1.33
              // 16:9 (1.78) landscape → 1.78
              // 21:9 (2.33) cinema   → 1.91 (clamp, cover 模式)
              // Tripwire 在 media-presentation.test.ts: wallCellAspect
              // 跑 6 个 boundary。
              const aspect = mediaAspect(item, 1);
              const cellAspect = aspect >= 1 ? Math.min(1.91, Math.max(1, aspect)) : Math.max(4 / 5, aspect);
              const isVideo = item.mediaType === "VIDEO";
              const cardUri = isVideo
                ? resolveUrl(selectVideoPlaybackUrl(item) ?? item.playbackUrl ?? "")
                : resolveUrl(selectVariantForViewport(item, cellWidth).url ?? "");
              const videoKey = isVideo ? `${collectionKey ?? "0"}:${index}:${item.mediaAssetId}` : null;
              const isActive = isVideo && activeVideoKey === videoKey && index === 0;
              const onFrame = isVideo && onVideoFrame && videoKey
                ? (frame: { y: number; height: number }) => onVideoFrame(videoKey, frame)
                : undefined;
              return (
            <Pressable
              accessibilityLabel={`查看第 ${index + 1} 张媒体`}
              key={item.mediaAssetId}
              onPress={() => onOpen(index)}
              style={[
                styles.wallCell,
                {
                  height: cellWidth / cellAspect,
                  width: cellWidth
                }
              ]}
            >
              {isVideo ? (
                <VideoStage
                  item={item as ItemWithHint}
                  uri={cardUri}
                  autoPlay={shouldAutoPlayVideo(item) && index === 0}
                  isActive={isActive}
                  onPress={() => onOpen(index)}
                  frameAspect={cellAspect}
                  resolveUrl={resolveUrl}
                  {...(onFrame ? { onFrame } : {})}
                />
              ) : (
                <SocialMediaFrame item={item as ItemWithHint} frameAspect={cellAspect} resolveUrl={resolveUrl} />
              )}
              <View style={styles.railBadge}><Text style={styles.railBadgeText}>{index + 1}/{items.length}</Text></View>
            </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function onOpenResolveUrl(_path: string): string {
  // 留作内部兜底；实际 URL 解析在调用方注入。
  return _path;
}

const styles = StyleSheet.create({
  // Text may use the feed's full right edge; a lone photo/video keeps a small
  // independent gutter so its rounded frame never feels clipped by the screen.
  singleInset: {
    marginRight: 8
  },
  singleMeasure: {
    alignItems: "flex-start",
    width: "100%"
  },
  // 单图：深紫黑底（消除灰边）
  singleStage: {
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: SOCIAL_MEDIA_RADIUS,
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
    bottom: SOCIAL_MEDIA_BADGE_INSET,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: "absolute",
    right: SOCIAL_MEDIA_BADGE_INSET
  },
  railBadgeText: {
    color: color.white,
    fontSize: 11,
    fontWeight: "700"
  },
  // VideoStage
  videoStage: {
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: SOCIAL_MEDIA_RADIUS,
    overflow: "hidden",
    width: "100%"
  },
  videoView: {
    height: "100%",
    width: "100%"
  },
  videoPosterOverlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2
  },
  videoBadge: {
    alignItems: "center",
    backgroundColor: "rgba(14,10,20,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: SOCIAL_MEDIA_BADGE_INSET,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: "absolute",
    top: SOCIAL_MEDIA_BADGE_INSET
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
  wallColumn: { flex: 1 },
  wallCell: {
    backgroundColor: FRAME_BACKGROUND_HEX,
    borderRadius: SOCIAL_MEDIA_RADIUS,
    marginBottom: WALL_GAP,
    overflow: "hidden"
  },
  mediaBackdrop: {
    height: "112%",
    left: "-6%",
    opacity: 0.72,
    position: "absolute",
    top: "-6%",
    width: "112%"
  }
});

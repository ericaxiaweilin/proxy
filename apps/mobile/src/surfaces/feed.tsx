// Feed Surface（稳定 Surface：动态 tab / LocalNet Feed）。
// 新架构（服务端驱动）：内容全部来自后端 ListFeedPosts 读模型（operationRef payload），
// 发布走 CreatePost 命令；前端不再内嵌内容 seed（首次空读模型时经 CreatePost 写入演示帖）。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
// （r153search + networktabs + feedfilterrail + preferencehint + postcard + mediaRail +
// postactions + postintent + feedfab），刻度按 R15.11 Social Baseline 对齐。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Image, Modal, PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import ImageViewing from "react-native-image-viewing";
import * as ImagePicker from "expo-image-picker";
import type { CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type EngagementClient } from "../engagement-client";
import { type MarketplaceClient } from "../marketplace-client";
import { type MediaClient } from "../media-client";
import { createDraftMedia, draftMediaDragTarget, draftMediaRefs, mediaStatusLabel, moveDraftMedia, normalizeRestoredDraftMedia, pendingDraftMedia, type DraftMediaItem } from "../composer-media";
import { clearComposerDraft, readComposerDraft, retainComposerImage, writeComposerDraft } from "../expo-composer-draft-store";
import { isOpportunityPost, mergeFeedContent } from "../feed-content";
import { mediaAspect, mediaCollectionMode, mediaRailMetrics, nearestRailIndex, shouldPreserveWholeSubject } from "../media-presentation";
// v2 重构：深紫黑底 + compositionHint 驱动 fill。Sprint C 替换完成。
// 旧 AdaptiveMediaCollection / AdaptiveMediaRail / SocialMediaFrame / SinglePostImage
// 已从本文件迁出 → apps/mobile/src/media/
import { AdaptiveMediaCollection, SinglePostImage, MediaViewer } from "../media/AdaptiveMediaCollection";

// Re-export v2 组件，保持其他 surface （me.tsx 等）从 ./feed 导入的兼容性。
export { AdaptiveMediaCollection, SinglePostImage, MediaViewer };
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { VoiceRecordPanel } from "../components/voice-record-panel";
import { color, shadows } from "../theme";
import { CommunityHub } from "./community";
import { CustomFeedHub } from "./custom-feed";
import { StatusFeed } from "./status";
import { type SocialSpaceClient } from "../socialspace-client";

type FeedTab = "RECOMMENDED" | "FOLLOWING";
type FeedSection = "POSTS" | "STATUS" | "COMMUNITY";
type FilterKey = "ALL" | "人/关系" | "机会/需求" | "活动/团体" | "情报/行业信息" | "附近";

// 模块级缓存：组件卸载/重载时保留数据，避免闪烁
let cachedPosts: FeedPost[] = [];
let cachedMedia: Record<string, FeedMediaItem[]> = {};
let cachedPostIds: Set<string> = new Set();
let cachedComposerDraft = "";

// 种子媒体资产固定 ID（后端 seedPostgresMedia 幂等写入，READY）。

const AUTHOR_TYPE_META: Record<FeedPost["authorType"], { label: string; reason: string }> = {
  USER: { label: "用户 · 河内", reason: "为你推荐：本地用户的公开动态" },
  AGENT: { label: "城市同行 · 已验证", reason: "为你推荐：当前可用时间与你最近需求接近" },
  MERCHANT: { label: "商家 · 河内", reason: "为你推荐：附近商家的公开动态" },
  PLATFORM_SPECIAL: { label: "Proxy 特别企划", reason: "为你推荐：平台特别企划" }
};

function scenarioIconForPost(post: FeedPost): ProxyIconName {
  const text = post.body + " " + post.contextRefs.map((r) => r.contextId).join(" ");
  if (text.includes("摄影") || text.includes("拍照")) return "camera";
  if (text.includes("咖啡")) return "cup";
  if (text.includes("城市同行") || text.includes("路线") || text.includes("同行")) return "route";
  if (text.includes("翻译") || text.includes("口译") || text.includes("中文") || text.includes("接待")) return "chat";
  if (text.includes("活动") || text.includes("开业") || text.includes("品鉴")) return "ticket";
  return "diamond";
}

function authorName(post: FeedPost): string {
  return post.authorDisplayName !== undefined && post.authorDisplayName !== "" ? post.authorDisplayName : post.authorId;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

function formatDurationMs(durationMs: number | undefined): string {
  if (!durationMs) return "";
  const total = Math.round(durationMs / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

const TABS: ReadonlyArray<{ id: FeedTab; label: string }> = [
  { id: "RECOMMENDED", label: "推荐" },
  { id: "FOLLOWING", label: "关注" }
];

const SECTIONS: ReadonlyArray<{ id: FeedSection; label: string; icon: ProxyIconName }> = [
  { id: "POSTS", label: "动态", icon: "target" },
  { id: "STATUS", label: "状态", icon: "clock" },
  { id: "COMMUNITY", label: "社区", icon: "user" }
];

const FILTERS: ReadonlyArray<{ id: FilterKey; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "人/关系", label: "人 / 关系" },
  { id: "机会/需求", label: "机会 / 需求" },
  { id: "活动/团体", label: "活动 / 团体" },
  { id: "情报/行业信息", label: "情报 / 行业信息" },
  { id: "附近", label: "河内 · 附近" }
];

const CUSTOM_FEED_LABELS: Readonly<Record<string, string>> = {
  friends: "朋友",
  hanoi: "河内",
  merchant: "商家",
  opportunity: "机会",
  photo: "摄影",
  startup: "创业"
};

const COMPOSER_MEDIA_ITEM_SPAN = 236;

function ComposerMediaCard({
  item,
  index,
  itemCount,
  publishing,
  onAltText,
  onCancel,
  onMove,
  onPause,
  onRemove,
  onReplace
}: {
  item: DraftMediaItem;
  index: number;
  itemCount: number;
  publishing: boolean;
  onAltText: (altText: string) => void;
  onCancel: () => void;
  onMove: (from: number, to: number) => void;
  onPause: () => void;
  onRemove: () => void;
  onReplace: () => void;
}): React.JSX.Element {
  const dragX = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const dragResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !publishing,
    onMoveShouldSetPanResponder: (_event, gesture) => !publishing && Math.abs(gesture.dx) > 4,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => setDragging(true),
    onPanResponderMove: (_event, gesture) => dragX.setValue(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      const target = draftMediaDragTarget(index, gesture.dx, COMPOSER_MEDIA_ITEM_SPAN, itemCount);
      dragX.setValue(0);
      setDragging(false);
      if (target !== index) onMove(index, target);
    },
    onPanResponderTerminate: () => {
      dragX.setValue(0);
      setDragging(false);
    }
  }), [dragX, index, itemCount, onMove, publishing]);

  return (
    <Animated.View style={[styles.composerMediaItem, dragging && styles.composerMediaItemDragging, { transform: [{ translateX: dragX }] }]}>
      <View
        accessibilityLabel={`拖动第 ${index + 1} 张照片排序`}
        accessibilityRole="adjustable"
        style={styles.composerMediaDragHandle}
        {...dragResponder.panHandlers}
      >
        <Text style={styles.composerMediaDragText}>按住左右拖动排序</Text>
        <Text style={styles.composerMediaDragGlyph}>≡</Text>
      </View>
      <Image resizeMode="contain" source={{ uri: item.image.uri }} style={styles.composerMediaThumb} />
      <Text style={[styles.composerMediaStatus, item.status === "FAILED" && styles.composerMediaStatusFailed]}>{mediaStatusLabel(item)}</Text>
      <TextInput
        accessibilityLabel={`第 ${index + 1} 张照片替代文本`}
        editable={!publishing}
        maxLength={500}
        onChangeText={onAltText}
        placeholder="描述照片（可选）"
        placeholderTextColor={color.muted}
        style={styles.composerMediaAlt}
        value={item.altText}
      />
      <View style={styles.composerMediaActions}>
        <Pressable disabled={publishing || index === 0} onPress={() => onMove(index, index - 1)}>
          <Text style={[styles.composerMediaAction, index === 0 && styles.disabledText]}>前移</Text>
        </Pressable>
        <Pressable disabled={publishing || index === itemCount - 1} onPress={() => onMove(index, index + 1)}>
          <Text style={[styles.composerMediaAction, index === itemCount - 1 && styles.disabledText]}>后移</Text>
        </Pressable>
        {item.status === "UPLOADING" ? (
          <>
            <Pressable onPress={onPause}>
              <Text style={styles.composerMediaAction}>暂停</Text>
            </Pressable>
            <Pressable onPress={onCancel}>
              <Text style={styles.composerMediaRemove}>取消</Text>
            </Pressable>
          </>
        ) : (
          <Pressable disabled={publishing} onPress={onReplace}>
            <Text style={styles.composerMediaAction}>替换</Text>
          </Pressable>
        )}
        <Pressable disabled={publishing} onPress={onRemove}>
          <Text style={styles.composerMediaRemove}>移除</Text>
        </Pressable>
      </View>
      {item.error ? <Text numberOfLines={2} style={styles.composerMediaError}>{item.error}</Text> : null}
    </Animated.View>
  );
}

export function FeedSurface({
  localNet,
  marketplace,
  mediaClient,
  engagement,
  socialSpace,
  onOpenChat,
  onOpenFeedPrefs,
  onChromeVisibilityChange,
  refreshTrigger,
  bottomNavVisible,
  // R15.14: LocationContext — 顶 chip 选的城市。变化时 feed
  // 重新拉。空 / undefined = 不过滤 (legacy)。
  viewingCity,
  initialTab
}: {
  localNet: LocalNetClient;
  marketplace: MarketplaceClient;
  mediaClient: MediaClient;
  engagement: EngagementClient;
  socialSpace: SocialSpaceClient;
  onOpenChat: (author: string) => void;
  onOpenFeedPrefs: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  refreshTrigger?: number;
  bottomNavVisible?: boolean;
  viewingCity?: string;
  // R15.22 sub-page sync (initialTab from RootNav 8-page sequence)
  initialTab?: FeedTab;
}): React.JSX.Element {
  const [tab, setTab] = useState<FeedTab>(initialTab ?? "RECOMMENDED");
  const [section, setSection] = useState<FeedSection>("POSTS");
  const [feedFilter, setFeedFilter] = useState<FilterKey>("ALL");
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">(cachedPosts.length > 0 ? "READY" : "LOADING");
  const [posts, setPosts] = useState<FeedPost[]>(cachedPosts);
  const [media, setMedia] = useState<Record<string, FeedMediaItem[]>>(cachedMedia);
  const [following, setFollowing] = useState<ReadonlySet<string>>(new Set());
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<ReadonlySet<string>>(new Set());
  const [engagementBusy, setEngagementBusy] = useState<ReadonlySet<string>>(new Set());
  const [engagementError, setEngagementError] = useState<string>();
  const [engagementNotice, setEngagementNotice] = useState<string>();
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  // 发布器状态（X 式 compose）
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState(cachedComposerDraft);
  const [draftMedia, setDraftMedia] = useState<DraftMediaItem[]>([]);
  const [draftVisibility, setDraftVisibility] = useState<"PUBLIC" | "FOLLOWERS">("PUBLIC");
  const [draftIncludeCity, setDraftIncludeCity] = useState(true);
  const [composerError, setComposerError] = useState<string>();
  const [quoteTargetId, setQuoteTargetId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const uploadActionsRef = useRef<Map<string, "PAUSE" | "CANCEL">>(new Map());
  const draftMediaSequenceRef = useRef(0);
  const publishIdempotencyRef = useRef<string | undefined>(undefined);
  const draftRestoredRef = useRef(false);
  const [viewer, setViewer] = useState<{ postId: string; index: number } | null>(null);
  const [mediaPositions, setMediaPositions] = useState<Record<string, number>>({});
  const [customFeedHubOpen, setCustomFeedHubOpen] = useState(false);
  const [selectedCustomFeed, setSelectedCustomFeed] = useState<string | null>(null);
  // X 式内联视频自动播放：滑近视口中心自动播（默认静音）、滑出即停，同一时刻仅一条在播。
  const [cardYs, setCardYs] = useState<Record<string, number>>({});
  const [frames, setFrames] = useState<Record<string, { y: number; height: number }>>({});
  const [scrollY, setScrollY] = useState(0);
  const [stickyHeaderVisible, setStickyHeaderVisible] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  // 长按减少推荐菜单
  const [contextMenu, setContextMenu] = useState<{ postId: string; x: number; y: number } | null>(null);
  const [contextActionBusy, setContextActionBusy] = useState(false);
  const [reportMode, setReportMode] = useState(false);
  const [hiddenPosts, setHiddenPosts] = useState<ReadonlySet<string>>(new Set());
  // 新更新提示：后台刷新检测到新帖时显示
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingPosts, setPendingPosts] = useState<FeedPost[]>([]);
  const [pendingMedia, setPendingMedia] = useState<Record<string, FeedMediaItem[]>>({});
  const scrollRef = useRef<ScrollView>(null);
  const lastScrollYRef = useRef(0);
  const scrollDirectionDistanceRef = useRef(0);
  const chromeVisibleRef = useRef(true);
  const postIdsRef = useRef<Set<string>>(cachedPostIds);

  useEffect(() => {
    let active = true;
    void readComposerDraft().then((snapshot) => {
      if (!active) return;
      if (snapshot && (snapshot.body.trim() || snapshot.media.length > 0 || snapshot.quoteTargetId)) {
        cachedComposerDraft = snapshot.body;
        setDraft(snapshot.body);
        setDraftMedia(normalizeRestoredDraftMedia(snapshot.media));
        setDraftVisibility(snapshot.visibility);
        setDraftIncludeCity(snapshot.includeCity);
        setQuoteTargetId(snapshot.quoteTargetId);
        publishIdempotencyRef.current = snapshot.publishIdempotencyKey;
        setComposerOpen(true);
      }
      draftRestoredRef.current = true;
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    for (const controller of uploadControllersRef.current.values()) controller.abort();
    uploadControllersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const persist = (): void => {
      try {
        writeComposerDraft({
          version: 1,
          body: draft,
          media: draftMedia,
          visibility: draftVisibility,
          includeCity: draftIncludeCity,
          quoteTargetId,
          publishIdempotencyKey: publishIdempotencyRef.current,
          updatedAt: new Date().toISOString()
        });
      } catch {
        // Draft remains in memory; the composer reports upload failures separately.
      }
    };
    const timer = setTimeout(persist, 250);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "inactive" || state === "background") persist();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [draft, draftIncludeCity, draftMedia, draftVisibility, quoteTargetId]);

  const activeVideoId = useMemo(() => {
    if (viewportHeight === 0) return null;
    const videoKeys = Object.keys(frames);
    if (videoKeys.length === 0) return null;
    if (videoKeys.length === 1) return videoKeys[0]; // 唯一视频 → 强制播放

    // 多视频：按中心距离 + 可见度选
    let best: string | null = null;
    let bestScore = -1;
    const centerY = scrollY + viewportHeight / 2;
    for (const videoKey of videoKeys) {
      const frame = frames[videoKey];
      if (!frame) continue; // 类型收窄
      const cardY = cardYs[videoKey.split(':')[0] ?? ''] ?? 0; // postId 是 videoKey 第一段
      const top = cardY + frame.y - scrollY;
      const visible = Math.max(0, Math.min(top + frame.height, viewportHeight) - Math.max(top, 0));
      if (visible < frame.height * 0.5) continue; // 不足 50% 不参与竞争
      const frameCenter = top + frame.height / 2;
      const dist = Math.abs(frameCenter - centerY);
      const score = visible / (dist + 1); // 可见度/距离 综合分
      if (score > bestScore) {
        bestScore = score;
        best = videoKey;
      }
    }
    return best;
  }, [cardYs, frames, scrollY, viewportHeight]);

  // 【新增】视频帧位置上报：videoKey 格式 "postId:index:mediaAssetId"
  const onVideoFrame = useCallback((videoKey: string, frame: { y: number; height: number }) => {
    setFrames((prev) => ({ ...prev, [videoKey]: frame }));
  }, []);

  function onFeedScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const nextY = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = nextY - lastScrollYRef.current;
    setScrollY(nextY);
    if (nextY <= 48) {
      setStickyHeaderVisible(false);
      scrollDirectionDistanceRef.current = 0;
      if (!chromeVisibleRef.current) {
        chromeVisibleRef.current = true;
        onChromeVisibilityChange?.(true);
      }
    } else if (Math.abs(delta) >= 1) {
      const previousDirection = Math.sign(scrollDirectionDistanceRef.current);
      const nextDirection = Math.sign(delta);
      scrollDirectionDistanceRef.current = previousDirection !== 0 && previousDirection !== nextDirection
        ? delta
        : scrollDirectionDistanceRef.current + delta;
      if (scrollDirectionDistanceRef.current <= -18) {
        setStickyHeaderVisible(true);
        if (!chromeVisibleRef.current) {
          chromeVisibleRef.current = true;
          onChromeVisibilityChange?.(true);
        }
        scrollDirectionDistanceRef.current = 0;
      } else if (scrollDirectionDistanceRef.current >= 28) {
        setStickyHeaderVisible(false);
        if (chromeVisibleRef.current) {
          chromeVisibleRef.current = false;
          onChromeVisibilityChange?.(false);
        }
        scrollDirectionDistanceRef.current = 0;
      }
    }
    lastScrollYRef.current = nextY;
  }

  useEffect(() => () => onChromeVisibilityChange?.(true), [onChromeVisibilityChange]);

  function toggleEmbeddedComposer(): void {
    if (composerOpen) {
      setComposerOpen(false);
      return;
    }
    openComposer();
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }

  const loadFeed = useCallback(async (): Promise<void> => {
    // 有缓存时不显示 LOADING
    if (cachedPosts.length === 0) {
      setPhase("LOADING");
    }
    try {
      const [postResult, marketResult] = await Promise.allSettled([
        localNet.listFeedPosts(viewingCity),
        marketplace.list()
      ]);
      if (postResult.status === "rejected" && marketResult.status === "rejected") throw new Error("feed sources unavailable");
      const read = postResult.status === "fulfilled" ? postResult.value : { posts: [], media: {} };
      const opportunities = marketResult.status === "fulfilled" ? marketResult.value : [];
      const unifiedPosts = mergeFeedContent(read.posts, opportunities, Date.now());
      // “全部”是统一内容流：帖子 + 服务端市场机会/需求。
      cachedPosts = unifiedPosts;
      cachedMedia = read.media;
      cachedPostIds = new Set(unifiedPosts.map((p) => p.postId));
      postIdsRef.current = cachedPostIds;
      setPosts(unifiedPosts);
      setMedia(read.media);
      setPhase("READY");
    } catch {
      setPhase("ERROR");
    }
  }, [localNet, marketplace, viewingCity]);

  // 后台静默刷新：不显示 LOADING，只检测新帖
  const backgroundRefresh = useCallback(async (): Promise<void> => {
    try {
      const [postResult, marketResult] = await Promise.allSettled([
        localNet.listFeedPosts(viewingCity),
        marketplace.list()
      ]);
      if (postResult.status === "rejected" && marketResult.status === "rejected") return;
      const read = postResult.status === "fulfilled" ? postResult.value : { posts: [], media: {} };
      const opportunities = marketResult.status === "fulfilled" ? marketResult.value : [];
      const unifiedPosts = mergeFeedContent(read.posts, opportunities, Date.now());
      if (unifiedPosts.length === 0) return;
      const currentIds = postIdsRef.current;
      const newPosts = unifiedPosts.filter((p) => !currentIds.has(p.postId));
      if (newPosts.length > 0) {
        setPendingCount(newPosts.length);
        setPendingPosts(unifiedPosts);
        setPendingMedia(read.media);
      }
    } catch {
      // 静默失败
    }
  }, [localNet, marketplace, viewingCity]);

  // 切换到 Feed tab 时触发后台刷新
  useEffect(() => {
    if (refreshTrigger !== undefined && phase === "READY") {
      void backgroundRefresh();
    }
  }, [refreshTrigger, phase, backgroundRefresh]);

  // 首次加载
  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // 点击"展示最新"：将 pending 内容刷入正式列表
  function showLatest(): void {
    // 更新缓存
    cachedPosts = pendingPosts;
    cachedMedia = pendingMedia;
    cachedPostIds = new Set(pendingPosts.map((p) => p.postId));
    postIdsRef.current = cachedPostIds;
    setPosts(pendingPosts);
    setMedia(pendingMedia);
    setPendingCount(0);
    setPendingPosts([]);
    setPendingMedia({});
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function commitEngagement(
    busyKey: string,
    stateKey: string,
    command: () => Promise<void>,
    apply: (next: ReadonlySet<string>) => void,
    current: ReadonlySet<string>
  ): Promise<void> {
    if (current.has(stateKey) || engagementBusy.has(busyKey)) return;
    setEngagementError(undefined);
    setEngagementBusy((value) => new Set(value).add(busyKey));
    try {
      await command();
      apply(new Set(current).add(stateKey));
    } catch {
      setEngagementError("互动没有提交成功，请检查连接后重试。");
    } finally {
      setEngagementBusy((value) => {
        const next = new Set(value);
        next.delete(busyKey);
        return next;
      });
    }
  }

  async function submitReply(): Promise<void> {
    if (!replyTargetId || !replyDraft.trim() || replying) return;
    setReplying(true);
    setEngagementError(undefined);
    try {
      await engagement.replyToPost(replyTargetId, replyDraft);
      setReplyTargetId(null);
      setReplyDraft("");
    } catch {
      setEngagementError("回复没有提交成功，请检查连接后重试。");
    } finally {
      setReplying(false);
    }
  }

  async function submitFeedPreference(action: "NOT_INTERESTED" | "REDUCE_TOPIC" | "REDUCE_AUTHOR"): Promise<void> {
    if (!contextMenu || contextActionBusy) return;
    const post = posts.find((item) => item.postId === contextMenu.postId);
    if (!post) return;
    setContextActionBusy(true);
    setEngagementError(undefined);
    setEngagementNotice(undefined);
    try {
      await engagement.recordFeedPreference(post.postId, action, post.authorId);
      if (action === "NOT_INTERESTED") setHiddenPosts((prev) => new Set(prev).add(post.postId));
      setEngagementNotice(action === "REDUCE_AUTHOR" ? "已记录：将减少推荐此作者。" : action === "REDUCE_TOPIC" ? "已记录：将减少推荐类似内容。" : "已隐藏，并记录到推荐偏好。");
      setContextMenu(null);
      setReportMode(false);
    } catch {
      setEngagementError("偏好没有保存成功，请检查连接后重试。");
    } finally {
      setContextActionBusy(false);
    }
  }

  async function submitPostReport(reason: "SPAM" | "HARASSMENT" | "UNSAFE" | "OTHER"): Promise<void> {
    if (!contextMenu || contextActionBusy) return;
    setContextActionBusy(true);
    setEngagementError(undefined);
    setEngagementNotice(undefined);
    try {
      await engagement.reportPost(contextMenu.postId, reason);
      setEngagementNotice("举报已提交，平台将按审核流程处理。");
      setContextMenu(null);
      setReportMode(false);
    } catch {
      setEngagementError("举报没有提交成功，请检查连接后重试。");
    } finally {
      setContextActionBusy(false);
    }
  }

  function openComposer(quoteId?: string): void {
    if ((quoteId ?? null) !== quoteTargetId) publishIdempotencyRef.current = undefined;
    setQuoteTargetId(quoteId ?? null);
    setComposerOpen(true);
  }

  function invalidatePublishAttempt(): void {
    publishIdempotencyRef.current = undefined;
  }

  async function pickComposerImages(source: "camera" | "library"): Promise<void> {
    setComposerError(undefined);
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setComposerError(source === "camera" ? "需要相机权限才能拍照。" : "需要照片权限才能选择图片。"); return; }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, 6 - draftMedia.length),
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
        });
    if (result.canceled) return;
    const selected = result.assets.map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height, ...(asset.fileName ? { fileName: asset.fileName } : {}), ...(asset.mimeType ? { mimeType: asset.mimeType } : {}) }));
    invalidatePublishAttempt();
    const localItems = selected.map((image) => {
      draftMediaSequenceRef.current += 1;
      return createDraftMedia(image, `draft_media_${Date.now().toString(36)}_${draftMediaSequenceRef.current.toString(36)}`);
    });
    let retentionFailed = false;
    const retained = await Promise.all(localItems.map(async (item) => {
      try {
        return await retainComposerImage(item);
      } catch {
        retentionFailed = true;
        return item;
      }
    }));
    setDraftMedia((current) => [...current, ...retained].slice(0, 6));
    if (retentionFailed) setComposerError("部分照片暂时无法复制到草稿目录；当前会话仍可发布，重启 App 前请完成或重新选择。 ");
  }

  async function replaceComposerImage(localId: string): Promise<void> {
    setComposerError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setComposerError("需要照片权限才能替换图片。"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const current = draftMedia.find((item) => item.localId === localId);
    if (!current) return;
    invalidatePublishAttempt();
    const replacement = {
      ...createDraftMedia({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {})
      }, localId),
      altText: current.altText
    };
    try {
      const retained = await retainComposerImage(replacement);
      setDraftMedia((items) => items.map((item) => item.localId === localId ? retained : item));
    } catch {
      setDraftMedia((items) => items.map((item) => item.localId === localId ? replacement : item));
      setComposerError("替换照片暂时无法复制到草稿目录；重启 App 前请完成发布或重新选择。");
    }
  }

  async function publish(): Promise<void> {
    if ((!draft.trim() && draftMedia.length === 0) || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setComposerError(undefined);
    try {
      const pending = pendingDraftMedia(draftMedia);
      if (pending.length > 0) {
        const pendingIds = new Set(pending.map((item) => item.localId));
        setDraftMedia((current) => current.map((item) => pendingIds.has(item.localId)
          ? { ...item, status: "UPLOADING", progress: item.progress ?? 0, error: undefined }
          : item));
      }
      let uploadPaused = false;
      const uploadResults = await Promise.allSettled(pending.map(async (item) => {
        const controller = new AbortController();
        uploadControllersRef.current.set(item.localId, controller);
        try {
          const isAudio = item.image.mimeType?.startsWith("audio/") ?? false;
          const uploaded = await mediaClient.uploadMedia({
            ...item.image,
            mediaType: isAudio ? "AUDIO" : "IMAGE",
            defaultMime: isAudio ? "audio/mp4" : "image/jpeg"
          }, {
            signal: controller.signal,
            ...(item.uploadSession ? { resumeSession: item.uploadSession } : {}),
            onProgress: (progress) => setDraftMedia((current) => current.map((candidate) => candidate.localId === item.localId
              ? { ...candidate, progress }
              : candidate)),
            onSession: (uploadSession) => setDraftMedia((current) => current.map((candidate) => candidate.localId === item.localId
              ? { ...candidate, uploadSession }
              : candidate))
          });
          setDraftMedia((current) => current.map((candidate) => candidate.localId === item.localId
            ? { ...candidate, status: "READY", progress: 1, mediaAssetId: uploaded.mediaAssetId, uploadSession: undefined, error: undefined }
            : candidate));
          return { localId: item.localId, mediaAssetId: uploaded.mediaAssetId };
        } catch (error) {
          const action = uploadActionsRef.current.get(item.localId);
          const paused = controller.signal.aborted && action === "PAUSE";
          if (paused) uploadPaused = true;
          const message = paused ? "上传已暂停，点击发布即可续传" : controller.signal.aborted ? "照片上传已取消" : error instanceof Error ? error.message : "上传失败";
          setDraftMedia((current) => current.map((candidate) => candidate.localId === item.localId
            ? { ...candidate, status: paused ? "PAUSED" : "FAILED", error: message }
            : candidate));
          throw error;
        } finally {
          uploadControllersRef.current.delete(item.localId);
          uploadActionsRef.current.delete(item.localId);
        }
      }));
      if (uploadResults.some((result) => result.status === "rejected")) {
        setComposerError(uploadPaused
          ? "照片上传已暂停，草稿和断点均已保留；再次点击发布即可续传。"
          : "有照片上传或处理失败。失败项已保留，可直接重试；帖子尚未发布。");
        return;
      }
      const uploadedById = new Map(uploadResults.flatMap((result) => result.status === "fulfilled" ? [[result.value.localId, result.value.mediaAssetId] as const] : []));
      const completedMedia = draftMedia.map((item) => {
        const mediaAssetId = uploadedById.get(item.localId) ?? item.mediaAssetId;
        return mediaAssetId ? { ...item, status: "READY" as const, progress: 1, mediaAssetId, uploadSession: undefined, error: undefined } : item;
      });
      setDraftMedia(completedMedia);
      const mediaRefs = draftMediaRefs(completedMedia);
      if (completedMedia.length > 0 && !mediaRefs) {
        setComposerError("照片尚未全部就绪，帖子没有发布。请重试失败项。");
        return;
      }
      const payload: CreatePostPayload = {
        authorType: "USER",
        authorDisplayName: "你",
        body: draft.trim(),
        visibility: draftVisibility,
        ...(draftIncludeCity ? { cityScope: "hn" } : {})
      };
      if (mediaRefs && mediaRefs.length > 0) payload.mediaRefs = mediaRefs;
      if (quoteTargetId) payload.contextRefs = [{ contextType: "QUOTE_POST", contextId: quoteTargetId }];
      publishIdempotencyRef.current ??= `mobile_post_publish_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      await localNet.createPost(payload, publishIdempotencyRef.current);
      setDraft("");
      cachedComposerDraft = "";
      setDraftMedia([]);
      setQuoteTargetId(null);
      setComposerOpen(false);
      publishIdempotencyRef.current = undefined;
      clearComposerDraft();
      await loadFeed();
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "发布失败，请稍后重试。");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  function mediaFor(postId: string): FeedMediaItem[] {
    return (media[postId] ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function findQuote(post: FeedPost): FeedPost | undefined {
    const ref = post.contextRefs.find((entry) => entry.contextType === "QUOTE_POST");
    if (!ref) return undefined;
    return posts.find((candidate) => candidate.postId === ref.contextId);
  }

  const getVisibleForTab = (forTab: FeedTab): FeedPost[] =>
    posts.filter((post) => {
      if (hiddenPosts.has(post.postId)) return false;
      if (forTab === "FOLLOWING") {
      if (!(following.has(post.authorId) || authorName(post) === "你")) return false;
    }
    if (feedFilter !== "ALL") {
      const ctxTypes = new Set(post.contextRefs.map((r) => r.contextType));
      switch (feedFilter) {
        case "人/关系":
          if (post.authorType !== "USER" && !ctxTypes.has("PEOPLE_RELATIONSHIP")) return false;
          break;
        case "机会/需求":
          if (!isOpportunityPost(post)) return false;
          break;
        case "活动/团体":
          if (!ctxTypes.has("ACTIVITY")) return false;
          break;
        case "情报/行业信息":
          if (post.authorType !== "MERCHANT" && !ctxTypes.has("VENUE") && !ctxTypes.has("INDUSTRY_INFO")) return false;
          break;
        case "附近":
          if (post.cityScope !== "hn") return false;
          break;
      }
    }
    if (selectedCustomFeed) {
      const feedMap: Record<string, (post: FeedPost) => boolean> = {
        friends: (p) => following.has(p.authorId) || authorName(p) === "你",
        hanoi: (p) => p.cityScope === "hn",
        photo: (p) => p.contextRefs.some((r) => r.contextId.includes("摄影") || r.contextId.includes("拍照")),
        opportunity: isOpportunityPost,
        merchant: (p) => p.authorType === "MERCHANT",
        startup: (p) => p.contextRefs.some((r) => r.contextId.includes("创业") || r.contextId.includes("AI"))
      };
      const checker = feedMap[selectedCustomFeed];
      if (checker && !checker(post)) return false;
    }
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (normalizedQuery) {
      const searchable = [authorName(post), post.body, post.cityScope, ...post.contextRefs.map((entry) => entry.contextId)]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(normalizedQuery)) return false;
    }
    return true;
  });
  const visible = getVisibleForTab(tab);
  const quoteTarget = quoteTargetId ? posts.find((post) => post.postId === quoteTargetId) : undefined;
  const viewerPost = viewer ? posts.find((post) => post.postId === viewer.postId) : undefined;
  const viewerItems = viewerPost ? mediaFor(viewerPost.postId) : [];

  if (customFeedHubOpen) {
    return <CustomFeedHub onBack={() => setCustomFeedHubOpen(false)} onOpenFeed={(id) => { setSelectedCustomFeed(id); setFeedFilter("ALL"); setCustomFeedHubOpen(false); }} />;
  }

  const bottomPad = bottomNavVisible === false ? 16 : 120;
  return (
    <View style={styles.root}>
    <ScrollView
      ref={scrollRef}
      style={styles.scrollRoot}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
      onScroll={onFeedScroll}
      onLayout={(event) => { const ly = event?.nativeEvent?.layout; if (ly) setViewportHeight(ly.height); }}
      scrollEventThrottle={16}
    >
      {/* R15.3 feedhead：≡ + 标题 + ＋ */}
      <View style={styles.feedHead}>
        <Text style={styles.feedTitle}>动态</Text>
        <View style={styles.feedTools}>
          <Pressable accessibilityLabel="定制频道" onPress={() => setCustomFeedHubOpen(true)} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>≡</Text>
          </Pressable>
          <Pressable accessibilityLabel={searchOpen ? "关闭动态搜索" : "搜索动态"} onPress={() => setSearchOpen((value) => !value)} style={styles.iconBtn}>
            <ProxyIcon color={color.ink} name="search" size={18} />
          </Pressable>
          <Pressable onPress={toggleEmbeddedComposer} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>{composerOpen ? "×" : "＋"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionTabs}>
        {SECTIONS.map((entry) => {
          const active = section === entry.id;
          return (
            <Pressable key={entry.id} onPress={() => setSection(entry.id)} style={[styles.sectionTab, active && styles.sectionTabOn]}>
              <ProxyIcon color={active ? color.white : color.muted} name={entry.icon} size={16} />
              <Text style={[styles.sectionTabText, active && styles.sectionTabTextOn]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {section === "STATUS" ? (
        <StatusFeed client={socialSpace} onReply={onOpenChat} />
      ) : section === "COMMUNITY" ? (
        <CommunityHub client={socialSpace} />
      ) : (
      <>
      {selectedCustomFeed ? (
        <View style={styles.customFeedBanner}>
          <Text style={styles.customFeedBannerText}>定制频道 · {CUSTOM_FEED_LABELS[selectedCustomFeed] ?? selectedCustomFeed}</Text>
          <Pressable onPress={() => setSelectedCustomFeed(null)}>
            <Text style={styles.customFeedBannerAction}>退出频道</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 搜索只在使用时占一行；入口与发帖按钮并列。 */}
      {searchOpen ? <View style={styles.r153search}>
        <View style={styles.searchMag}>
          <ProxyIcon color={color.ink} name="search" size={16} />
        </View>
        <TextInput
          autoFocus
          style={styles.r153searchInput}
          placeholder="搜索人、机会、活动、情报…"
          placeholderTextColor={color.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery ? <Pressable accessibilityLabel="清空动态搜索" onPress={() => setSearchQuery("")}><Text style={styles.searchArrow}>×</Text></Pressable> : null}
      </View> : null}

      {/* R15.3 networktabs：2 列（推荐 / 关注） */}
      <View style={styles.tabs}>
        {TABS.map((entry) => {
          const active = tab === entry.id;
          return (
            <Pressable key={entry.id} onPress={() => setTab(entry.id)} style={styles.tabItem}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{entry.label}</Text>
              {active ? (
                <View style={styles.tabBar}>
                  <View style={[styles.tabBarSeg, { backgroundColor: color.magenta }]} />
                  <View style={[styles.tabBarSeg, { backgroundColor: "#BE22B5" }]} />
                  <View style={[styles.tabBarSeg, { backgroundColor: color.violet }]} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* R15.3 feedfilterrail：可横滑筛选 + 附近按钮 */}
      <ScrollView contentContainerStyle={styles.filterRailContent} horizontal showsHorizontalScrollIndicator={false} style={styles.filterRail}>
        {FILTERS.map((f) => {
          const active = feedFilter === f.id;
          return (
            <Pressable key={f.id} onPress={() => { setFeedFilter(f.id); setSelectedCustomFeed(null); }} style={[styles.filterChip, active && styles.filterChipActive]}>
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* R15.3 preferencehint：推荐由你和算法共同决定 */}
      <View style={styles.prefHint}>
        <View style={styles.prefHintLeft}>
          <Text style={styles.prefHintTitle}>推荐由你和算法共同决定</Text>
          <Text style={styles.prefHintSub}>搜索意图优先 · 可随时减少 / 屏蔽</Text>
        </View>
        <Pressable onPress={onOpenFeedPrefs}>
          <Text style={styles.prefHintBtn}>调整 ›</Text>
        </Pressable>
      </View>

      {/* 新更新提示条 */}
      {pendingCount > 0 ? (
        <Pressable onPress={showLatest} style={styles.updateBanner}>
          <Text style={styles.updateBannerText}>{pendingCount} 条更新 · 点击查看最新</Text>
        </Pressable>
      ) : null}

      {/* R15.14 跟随地点的过滤指示器 — 访客不会因“换了城市但
          feed 空”而以为是 bug。顶 LocationContext 在 app-shell
          里，这里在 feed 表面重复一次 (另可点击"换城市" 不能
          — 仅提示。LocationContext 是唯一的切换入口)。 */}
      {viewingCity ? (
        <View style={styles.locationFilterBanner}>
          <Text style={styles.locationFilterBannerText}>
            正在显示 {viewingCity} 的本地动态。顶 LocationContext 可换。
          </Text>
        </View>
      ) : null}

      {/* 发布器（X 式 compose：正文 + 照片/普通视频 + 引用绑定 → CreatePost） */}
      {composerOpen ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(value) => { invalidatePublishAttempt(); cachedComposerDraft = value; setDraft(value); }}
            multiline
            maxLength={1000}
            placeholder="说点本地的事情…"
            placeholderTextColor={color.muted}
            style={styles.composerInput}
          />
          {quoteTarget ? (
            <View style={styles.composerQuote}>
              <Text style={styles.composerQuoteText} numberOfLines={1}>
                引用 {authorName(quoteTarget)}：{quoteTarget.body}
              </Text>
              <Pressable onPress={() => { invalidatePublishAttempt(); setQuoteTargetId(null); }}>
                <Text style={styles.composerQuoteRemove}>移除</Text>
              </Pressable>
            </View>
          ) : null}
          {draftMedia.length > 0 ? (
            <ScrollView
              contentContainerStyle={styles.composerMediaPreviewContent}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.composerMediaPreview}
            >
              {draftMedia.map((item, index) => (
                <ComposerMediaCard
                  index={index}
                  item={item}
                  itemCount={draftMedia.length}
                  key={item.localId}
                  onAltText={(altText) => {
                    invalidatePublishAttempt();
                    setDraftMedia((current) => current.map((candidate) => candidate.localId === item.localId ? { ...candidate, altText } : candidate));
                  }}
                  onCancel={() => {
                    uploadActionsRef.current.set(item.localId, "CANCEL");
                    uploadControllersRef.current.get(item.localId)?.abort();
                    invalidatePublishAttempt();
                    setDraftMedia((current) => current.filter((candidate) => candidate.localId !== item.localId));
                  }}
                  onMove={(from, to) => {
                    invalidatePublishAttempt();
                    setDraftMedia((current) => moveDraftMedia(current, from, to));
                  }}
                  onPause={() => {
                    uploadActionsRef.current.set(item.localId, "PAUSE");
                    uploadControllersRef.current.get(item.localId)?.abort();
                  }}
                  onRemove={() => {
                    invalidatePublishAttempt();
                    setDraftMedia((current) => current.filter((candidate) => candidate.localId !== item.localId));
                  }}
                  onReplace={() => void replaceComposerImage(item.localId)}
                  publishing={publishing}
                />
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.composerMetaRow}>
            <Pressable onPress={() => { invalidatePublishAttempt(); setDraftVisibility((value) => value === "PUBLIC" ? "FOLLOWERS" : "PUBLIC"); }} style={styles.composerMetaChip}>
              <Text style={styles.composerMetaText}>{draftVisibility === "PUBLIC" ? "所有人可见" : "仅关注者"}</Text>
            </Pressable>
            <Pressable onPress={() => { invalidatePublishAttempt(); setDraftIncludeCity((value) => !value); }} style={[styles.composerMetaChip, draftIncludeCity && styles.composerMetaChipOn]}>
              <Text style={styles.composerMetaText}>{draftIncludeCity ? "河内 · 已添加" : "不添加位置"}</Text>
            </Pressable>
            <Text style={styles.composerCount}>{draft.length}/1000</Text>
          </View>
          <View style={styles.composerTools}>
            <Pressable
              disabled={draftMedia.length >= 6 || publishing}
              onPress={() => void pickComposerImages("library")}
              style={[styles.composerTool, (draftMedia.length >= 6 || publishing) && styles.disabled]}
            >
              <Text style={styles.composerToolText}>照片 {draftMedia.length}/6</Text>
            </Pressable>
            <Pressable
              disabled={draftMedia.length >= 6 || publishing}
              onPress={() => void pickComposerImages("camera")}
              style={[styles.composerTool, (draftMedia.length >= 6 || publishing) && styles.disabled]}
            >
              <Text style={styles.composerToolText}>拍照</Text>
            </Pressable>
            <VoiceRecordPanel
              disabled={publishing || draftMedia.length >= 6}
              onDone={(recording) => {
                invalidatePublishAttempt();
                draftMediaSequenceRef.current += 1;
                const localId = `draft_media_${Date.now().toString(36)}_${draftMediaSequenceRef.current.toString(36)}`;
                const item: DraftMediaItem = {
                  localId,
                  image: {
                    uri: recording.uri,
                    mimeType: "audio/mp4",
                    width: 0,
                    height: 0
                  },
                  altText: `语音 ${Math.round(recording.durationMs / 1000)} 秒`,
                  status: "LOCAL"
                };
                setDraftMedia((current) => [...current, item].slice(0, 6));
              }}
            />
            <Pressable disabled={publishing || (!draft.trim() && draftMedia.length === 0)} onPress={() => void publish()} style={[styles.composerPublish, (publishing || (!draft.trim() && draftMedia.length === 0)) && styles.disabled]}>
              <Text style={styles.composerPublishText}>{publishing ? "发布中…" : "发布"}</Text>
            </Pressable>
          </View>
          {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
        </View>
      ) : null}

      {engagementError ? <Text style={styles.engagementError}>{engagementError}</Text> : null}
      {engagementNotice ? <Text style={styles.engagementNotice}>{engagementNotice}</Text> : null}
      {phase === "LOADING" ? (
        <View style={styles.feedEmpty}>
          <ActivityIndicator color={color.magenta} />
          <Text style={styles.feedEmptyText}>正在读取本地动态（ListFeedPosts）…</Text>
        </View>
      ) : phase === "ERROR" ? (
        <View style={styles.feedEmpty}>
          <Text style={styles.feedEmptyText}>读模型暂时不可用（本地 API 未连接？）。</Text>
          <Pressable onPress={() => void loadFeed()} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.feedEmpty}>
          <Text style={styles.feedEmptyText}>
            {viewingCity
              ? `${viewingCity} 还无人在 Proxy 发帖。换个城市, 或你作为首位发布者 — 任何一条都会被推到。`
              : feedFilter !== "ALL"
              ? `当前筛选下没有足够内容。换个筛选，或直接搜索你想找的东西。`
              : "这里还没有足够的动态。关注本地的人和商家后会更有用。"}
          </Text>
        </View>
      ) : (
        <>
          {visible.map((post) => {
          const quoted = findQuote(post);
          const items = mediaFor(post.postId);
          const name = authorName(post);
          const meta = AUTHOR_TYPE_META[post.authorType];
          const isFollow = following.has(post.authorId);
          const isLiked = liked.has(post.postId);
          const isSaved = bookmarked.has(post.postId);
          const chips = post.contextRefs.filter((entry) => entry.contextType !== "QUOTE_POST");
          const isCityCompanion = post.authorType === "AGENT";
          return (
            <View
              key={post.postId}
              style={styles.postCard}
              onLayout={(event) => { const ly = event?.nativeEvent?.layout; if (ly) setCardYs((prev) => ({ ...prev, [post.postId]: ly.y })); }}
            >
              {/* posthead */}
              <View style={styles.postHead}>
                <View style={styles.postAvatarWrap}>
                  <View style={styles.postAvatar}>
                    <Text style={styles.postAvatarText}>{name.charAt(0)}</Text>
                  </View>
                  <View style={styles.scenarioBadge}>
                    <ProxyIcon color={color.violet} name={scenarioIconForPost(post)} size={11} />
                  </View>
                </View>
                <View style={styles.postIdentity}>
                  <Text style={styles.postName}>{name}</Text>
                  <Text numberOfLines={1} style={styles.postMeta}>
                    {meta.label} · {relativeTime(post.createdAt)}
                  </Text>
                </View>
                {name !== "你" ? (
                  <Pressable
                    disabled={isFollow || engagementBusy.has(`follow:${post.authorId}`)}
                    onPress={() => void commitEngagement(`follow:${post.authorId}`, post.authorId, () => engagement.followProfile(post.authorId), setFollowing, following)}
                    style={[styles.followBtn, isFollow && styles.followBtnOn]}
                  >
                    <Text style={[styles.followBtnText, isFollow && styles.followBtnTextOn]}>
                      {isFollow ? "已关注" : "关注"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              <Text style={styles.postReason}>{meta.reason}</Text>
              <Text style={styles.postCopy}>{post.body}</Text>

              {/* 服务端媒体（READY Hydrate）：多图横滑轨 / 单图全宽 / 视频内联自动播放（X 式，滑近中心播、滑出停，带声音） */}
              {items.length > 1 ? (
                <AdaptiveMediaCollection
                  items={items}
                  currentIndex={mediaPositions[post.postId] ?? 0}
                  resolveUrl={(path) => localNet.resolveMediaUrl(path)}
                  onIndexChange={(index) => setMediaPositions((current) => ({ ...current, [post.postId]: index }))}
                  onOpen={(index) => {
                    setMediaPositions((current) => ({ ...current, [post.postId]: index }));
                    setViewer({ postId: post.postId, index });
                  }}
                  activeVideoKey={activeVideoId}
                  onVideoFrame={onVideoFrame}
                  collectionKey={post.postId}
                />
              ) : items.length === 1 && items[0] ? (
                <AdaptiveMediaCollection
                  items={items}
                  currentIndex={0}
                  resolveUrl={(path) => localNet.resolveMediaUrl(path)}
                  onIndexChange={() => {}}
                  onOpen={(index) => {
                    setMediaPositions((current) => ({ ...current, [post.postId]: index }));
                    setViewer({ postId: post.postId, index });
                  }}
                  activeVideoKey={activeVideoId}
                  onVideoFrame={onVideoFrame}
                  collectionKey={post.postId}
                />
              ) : null}

              {/* 基线 .contextrefs：上下文标签 chips（服务端 contextRefs），首个为 strong */}
              {chips.length > 0 ? (
                <View style={styles.contextRefs}>
                  {chips.map((entry, index) => (
                    <View key={`${entry.contextType}_${entry.contextId}`} style={[styles.contextRef, index === 0 && styles.contextRefStrong]}>
                      <Text style={[styles.contextRefText, index === 0 && styles.contextRefTextStrong]}>{entry.contextId}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* X 式引用帖文（quote card：服务端 contextRef QUOTE_POST） */}
              {quoted ? (
                <View style={styles.quoteCard}>
                  <View style={styles.quoteHead}>
                    <View style={styles.quoteAvatar}>
                      <Text style={styles.quoteAvatarText}>{authorName(quoted).charAt(0)}</Text>
                    </View>
                    <Text style={styles.quoteAuthor}>{authorName(quoted)}</Text>
                    <Text style={styles.quoteMeta}>引用帖文</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.quoteBody}>{quoted.body}</Text>
                  {mediaFor(quoted.postId)[0] ? <Text style={styles.quoteMediaLabel}>🎞 含媒体附件</Text> : null}
                </View>
              ) : null}

              {/* postactions：♡ / 回复 / 引用 / 收藏 / 分享 / ···(更多) */}
              <View style={styles.postActions}>
                <Pressable disabled={isLiked || engagementBusy.has(`like:${post.postId}`)} onPress={() => void commitEngagement(`like:${post.postId}`, post.postId, () => engagement.reactToPost(post.postId), setLiked, liked)} style={styles.postAction}>
                  <Text style={[styles.postActionText, isLiked && styles.postActionOn]}>
                    {isLiked ? "♥" : "♡"} {isLiked ? 1 : 0}
                  </Text>
                </Pressable>
                <Pressable onPress={() => { setReplyTargetId(post.postId); setReplyDraft(""); }} style={styles.postAction}>
                  <Text style={styles.postActionText}>回复</Text>
                </Pressable>
                <Pressable onPress={() => openComposer(post.postId)} style={styles.postAction}>
                  <Text style={styles.postActionText}>引用</Text>
                </Pressable>
                <Pressable disabled={isSaved || engagementBusy.has(`bookmark:${post.postId}`)} onPress={() => void commitEngagement(`bookmark:${post.postId}`, post.postId, () => engagement.bookmarkPost(post.postId), setBookmarked, bookmarked)} style={styles.postAction}>
                  <Text style={[styles.postActionText, isSaved && styles.postActionOn]}>收藏 {isSaved ? 1 : 0}</Text>
                </Pressable>
                <Pressable onPress={() => void Share.share({ message: `${post.body}\n\nProxy · ${name}` })} style={styles.postAction}>
                  <Text style={styles.postActionText}>分享</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="更多帖子操作"
                  onPress={() => { setReportMode(false); setContextMenu({ postId: post.postId, x: 0, y: 0 }); }}
                  style={styles.postAction}
                >
                  <Text style={styles.postActionText}>···</Text>
                </Pressable>
              </View>

              {/* postintent（基线文案）：城市同行动态 → 聊一下 / 按这个想法找同行 */}
              {isCityCompanion ? (
                <View style={styles.postIntent}>
                  <Pressable onPress={() => onOpenChat(name)} style={styles.intentChat}>
                    <Text style={styles.intentChatText}>聊一下</Text>
                  </Pressable>
                  <Pressable onPress={() => onOpenChat(name)} style={styles.intentNeed}>
                    <Text style={styles.intentNeedText}>按这个想法找同行</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
        </>
      )}
      </>
      )}

      {/* 全屏媒体查看器（真实文件：图片 thumbnailUrl / 视频 playbackUrl） */}
      {viewer && viewerPost && viewerItems[viewer.index] ? (
        <MediaViewer
          key={viewer.postId}
          items={viewerItems}
          index={viewer.index}
          author={authorName(viewerPost)}
          resolveUrl={(path) => localNet.resolveMediaUrl(path)}
          onNavigate={(next) => {
            setMediaPositions((current) => ({ ...current, [viewer.postId]: next }));
            setViewer({ postId: viewer.postId, index: next });
          }}
          onClose={() => setViewer(null)}
        />
      ) : null}

      {/* 长按减少推荐菜单（X 式 ··· 菜单） */}
      {contextMenu ? (
        <Modal transparent animationType="fade" onRequestClose={() => setContextMenu(null)}>
          <Pressable style={styles.menuOverlay} onPress={() => setContextMenu(null)}>
            <Pressable style={styles.menuContent} onPress={(event) => event.stopPropagation()}>
              <Text style={styles.menuTitle}>{reportMode ? "举报原因" : "调整推荐"}</Text>
              {reportMode ? (
                <>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitPostReport("SPAM")}><Text style={styles.menuItemText}>垃圾信息或广告</Text></Pressable>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitPostReport("HARASSMENT")}><Text style={styles.menuItemText}>骚扰或攻击</Text></Pressable>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitPostReport("UNSAFE")}><Text style={styles.menuItemText}>不安全内容</Text></Pressable>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitPostReport("OTHER")}><Text style={styles.menuItemText}>其他问题</Text></Pressable>
                </>
              ) : (
                <>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitFeedPreference("NOT_INTERESTED")}><Text style={styles.menuItemText}>不感兴趣</Text></Pressable>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitFeedPreference("REDUCE_TOPIC")}><Text style={styles.menuItemText}>减少这类内容</Text></Pressable>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => void submitFeedPreference("REDUCE_AUTHOR")}><Text style={styles.menuItemText}>少看这个人</Text></Pressable>
                  <Pressable disabled={contextActionBusy} style={styles.menuItem} onPress={() => setReportMode(true)}><Text style={styles.menuItemText}>举报</Text></Pressable>
                </>
              )}
              <Pressable style={styles.menuCancel} onPress={() => { setReportMode(false); setContextMenu(null); }}>
                <Text style={styles.menuCancelText}>取消</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {replyTargetId ? (
        <Modal transparent animationType="fade" onRequestClose={() => setReplyTargetId(null)}>
          <Pressable style={styles.replyOverlay} onPress={() => setReplyTargetId(null)}>
            <Pressable style={styles.replySheet} onPress={(event) => event.stopPropagation()}>
              <Text style={styles.replyTitle}>回复帖文</Text>
              <TextInput
                autoFocus
                maxLength={500}
                multiline
                onChangeText={setReplyDraft}
                placeholder="写下公开回复…"
                placeholderTextColor={color.muted}
                style={styles.replyInput}
                value={replyDraft}
              />
              <View style={styles.replyActions}>
                <Pressable onPress={() => setReplyTargetId(null)} style={styles.replyCancel}><Text style={styles.replyCancelText}>取消</Text></Pressable>
                <Pressable disabled={!replyDraft.trim() || replying} onPress={() => void submitReply()} style={[styles.replySubmit, (!replyDraft.trim() || replying) && styles.disabled]}><Text style={styles.replySubmitText}>{replying ? "提交中…" : "回复"}</Text></Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

    </ScrollView>
    {stickyHeaderVisible ? (
      <View style={styles.stickyFeedHead}>
        <Text style={styles.stickyFeedTitle}>动态</Text>
        <View style={styles.feedTools}>
          <Pressable accessibilityLabel="定制频道" onPress={() => setCustomFeedHubOpen(true)} style={styles.stickyIconBtn}>
            <Text style={styles.iconBtnText}>≡</Text>
          </Pressable>
          <Pressable accessibilityLabel={searchOpen ? "关闭动态搜索" : "搜索动态"} onPress={() => { setSearchOpen((value) => !value); scrollRef.current?.scrollTo({ y: 0, animated: true }); }} style={styles.stickyIconBtn}>
            <ProxyIcon color={color.ink} name="search" size={17} />
          </Pressable>
          <Pressable onPress={toggleEmbeddedComposer} style={styles.stickyIconBtn}>
            <Text style={styles.iconBtnText}>{composerOpen ? "×" : "＋"}</Text>
          </Pressable>
        </View>
      </View>
    ) : null}
    {section === "POSTS" ? (
      <Pressable accessibilityLabel={composerOpen ? "关闭发布器" : "发布帖文"} onPress={toggleEmbeddedComposer} style={styles.feedFab}>
        <Text style={styles.feedFabText}>{composerOpen ? "×" : "＋"}</Text>
      </Pressable>
    ) : null}
    </View>
  );
}
// 【fix 2026-08-26 P0 多视频声音】
// 旧 VideoCard 已废弃 —— useVideoPlayer 会在所有 FeedMediaItem.VIEO post mount
// 时创建 AVPlayer 沨入“任意帖都准许播”的状态，与 AdaptiveMediaCollection 的
// “全屏仅 1 个 VIDEO 在播”语义冲突。视频渲染完全走 AdaptiveMediaCollection 内
// 的 ActiveVideoStage（入网“同屏一个 VIDEO 在播”单例播放位）。死代码删除。

// 全屏查看器（图片）：视频已改为内联自动播放，不再弹出。

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1, position: "relative" },
  scrollRoot: { flex: 1 },
  content: { paddingBottom: 88, paddingHorizontal: 18, paddingTop: 10 },

  // 基线 .feedhead：h2 21 bold。
  feedHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 2, marginTop: 5 },
  feedTitle: { color: color.ink, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  feedTools: { flexDirection: "row", gap: 6 },
  stickyFeedHead: {
    alignItems: "center",
    backgroundColor: "rgba(252,250,253,0.97)",
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 18,
    paddingVertical: 7,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20
  },
  stickyFeedTitle: { color: color.ink, fontSize: 18, fontWeight: "800" },
  stickyIconBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, height: 38, justifyContent: "center", width: 38 },
  iconBtn: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  iconBtnText: { color: color.ink, fontSize: 14, fontWeight: "900" },
  sectionTabs: { backgroundColor: "#F0EBF3", borderRadius: 16, flexDirection: "row", gap: 4, marginBottom: 10, marginTop: 9, padding: 4 },
  sectionTab: { alignItems: "center", borderRadius: 12, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", minHeight: 42, paddingHorizontal: 8 },
  sectionTabOn: { backgroundColor: color.ink },
  sectionTabText: { color: color.muted, fontSize: 12, fontWeight: "800" },
  sectionTabTextOn: { color: color.white },
  feedNote: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: 8, marginTop: 0 },
  // 基线 .feedfab：violet bg radius 999 48×48。
  feedFab: {
    alignItems: "center",
    backgroundColor: color.violet,
    borderRadius: 999,
    bottom: 16,
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    shadowColor: "#7C2AFF",
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.27,
    shadowRadius: 26,
    width: 48,
    zIndex: 30
  },
  feedFabText: { color: color.white, fontSize: 24 },

  // 基线 .r153search：white border ln radius 17 padding 11。
  r153search: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginBottom: 9,
    marginTop: 5,
    paddingHorizontal: 11,
    minHeight: 52,
    paddingVertical: 9,
    shadowColor: color.ink,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.03,
    shadowRadius: 14
  },
  searchMag: {
    alignItems: "center",
    backgroundColor: "#F5F1F7",
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  searchMagText: { fontSize: 16 },
  r153searchInput: {
    color: color.ink,
    flex: 1,
    fontSize: 14,
    paddingVertical: 0
  },
  searchArrow: { color: color.muted, fontSize: 15 },

  // 基线 .feedfilterrail：横滑筛选。
  filterRail: {
    marginBottom: 6
  },
  filterRailContent: { gap: 8, paddingRight: 18 },
  customFeedBanner: { alignItems: "center", backgroundColor: "#F3EFF5", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 10, paddingVertical: 6 },
  customFeedBannerText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  customFeedBannerAction: { color: color.muted, fontSize: 11, fontWeight: "700" },
  filterChip: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 8
  },
  filterChipActive: {
    backgroundColor: color.ink,
    borderColor: color.ink
  },
  filterChipText: {
    color: "#62596A",
    fontSize: 12,
    fontWeight: "800"
  },
  filterChipTextActive: {
    color: color.white
  },

  // 基线 .preferencehint：bg #F8F5FA border #ECE4F0 radius 12 padding 9 8。
  prefHint: {
    alignItems: "center",
    backgroundColor: "#F8F5FA",
    borderColor: "#ECE4F0",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 9,
    marginTop: 5,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  prefHintLeft: { flex: 1 },
  prefHintTitle: { fontSize: 11, fontWeight: "700" },
  prefHintSub: { color: color.muted, fontSize: 11, marginTop: 1 },
  prefHintBtn: { color: "#6036A6", fontSize: 11, fontWeight: "900" },

  // 新更新提示条。
  updateBanner: {
    backgroundColor: color.violet,
    borderRadius: 12,
    marginBottom: 10,
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 8
  },
  updateBannerText: {
    color: color.white,
    fontSize: 11,
    fontWeight: "700",
  },

  // R15.14: 地点过滤指示器 — 走 visit 模式 (轻量横条) 不夺
  // 焦点。区别于 updateBanner (dynamic purple 变装)，这里
  // 走低调灰底 + 紫边。
  locationFilterBanner: {
    backgroundColor: "#F2EDF5",
    borderColor: "#DDD5E3",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 7
  },
  locationFilterBannerText: {
    color: "#62586A",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center"
  },

  // 基线 .postcompose：bg white border ln radius 17 padding 11。
  composer: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 8,
    padding: 11,
    ...shadows.card
  },
  composerInput: { color: color.ink, fontSize: 15, lineHeight: 22, minHeight: 112, paddingHorizontal: 2, paddingTop: 4, textAlignVertical: "top" },
  composerQuote: {
    alignItems: "center",
    backgroundColor: "#F8F5FA",
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  composerQuoteText: { color: color.muted, flex: 1, fontSize: 11 },
  composerQuoteRemove: { color: "#B91451", fontSize: 11, fontWeight: "700" },
  composerMediaPreview: { marginTop: 8 },
  composerMediaPreviewContent: { gap: 8, paddingRight: 12 },
  composerMediaItem: { backgroundColor: "#FAF8FB", borderColor: color.line, borderRadius: 12, borderWidth: 1, padding: 8, width: 228 },
  composerMediaItemDragging: { elevation: 8, opacity: 0.94, shadowColor: "#17121F", shadowOffset: { height: 5, width: 0 }, shadowOpacity: 0.22, shadowRadius: 10, zIndex: 20 },
  composerMediaDragHandle: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 30, paddingBottom: 5, paddingHorizontal: 2 },
  composerMediaDragText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  composerMediaDragGlyph: { color: color.ink, fontSize: 18, fontWeight: "800", lineHeight: 20 },
  composerMediaThumb: { backgroundColor: "#F0ECF3", borderRadius: 9, height: 142, width: "100%" },
  composerMediaStatus: { color: "#4F6840", fontSize: 11, fontWeight: "700", marginTop: 4 },
  composerMediaStatusFailed: { color: "#B91451" },
  composerMediaAlt: { backgroundColor: color.white, borderColor: color.line, borderRadius: 8, borderWidth: 1, color: color.ink, fontSize: 11, marginTop: 6, minHeight: 36, paddingHorizontal: 8, paddingVertical: 6 },
  composerMediaActions: { flexDirection: "row", gap: 14, marginTop: 6 },
  composerMediaAction: { color: color.violet, fontSize: 11, fontWeight: "700" },
  composerMediaRemove: { color: "#B91451", fontSize: 11, fontWeight: "700", marginTop: 2, textAlign: "center" },
  composerMediaError: { color: "#B91451", fontSize: 11, lineHeight: 15, marginTop: 4 },
  disabledText: { color: color.muted, opacity: 0.45 },
  composerMetaRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  composerMetaChip: { backgroundColor: "#F8F5FA", borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  composerMetaChipOn: { backgroundColor: color.lime, borderColor: color.lime },
  composerMetaText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  composerCount: { color: color.muted, fontSize: 11, marginLeft: "auto" },
  composerTools: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  composerTool: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  composerToolOn: { backgroundColor: color.ink, borderColor: color.ink },
  composerToolText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  composerPublish: { backgroundColor: color.lime, borderRadius: 999, marginLeft: "auto", paddingHorizontal: 14, paddingVertical: 6 },
  composerPublishText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  composerError: { color: "#B91451", fontSize: 11, lineHeight: 15, marginTop: 7 },
  disabled: { opacity: 0.45 },
  replyOverlay: { alignItems: "center", backgroundColor: "rgba(17,13,22,0.45)", flex: 1, justifyContent: "flex-end", padding: 18 },
  replySheet: { backgroundColor: color.white, borderRadius: 18, padding: 14, width: "100%", ...shadows.card },
  replyTitle: { color: color.ink, fontSize: 17, fontWeight: "800" },
  replyInput: { backgroundColor: "#F8F5FA", borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 15, lineHeight: 21, marginTop: 10, minHeight: 108, padding: 10, textAlignVertical: "top" },
  replyActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 10 },
  replyCancel: { borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  replyCancelText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  replySubmit: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  replySubmitText: { color: color.white, fontSize: 12, fontWeight: "800" },

  // 基线 .networktabs：border-bottom var(--ln)。
  tabs: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row" },
  tabItem: { alignItems: "center", flex: 1, paddingBottom: 9, paddingTop: 11 },
  tabText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  tabTextActive: { color: color.ink },
  tabBar: {
    borderRadius: 3,
    bottom: -1,
    flexDirection: "row",
    height: 3,
    left: "28%",
    overflow: "hidden",
    position: "absolute",
    right: "28%"
  },
  tabBarSeg: { flex: 1 },

  feedEmpty: {
    alignItems: "center",
    borderColor: "#D9D0DE",
    borderRadius: 17,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
    padding: 22
  },
  feedEmptyText: { color: color.muted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  retryBtn: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  retryBtnText: { color: color.white, fontSize: 11, fontWeight: "700" },
  // 连续信息流：帖文不做独立卡片。横向贴近屏幕，仅保留极淡的底部分界。
  // X / Threads 的信息密度来自统一页面画布，而不是每条内容再套一层圆角容器。
  postCard: {
    backgroundColor: "transparent",
    borderBottomColor: "rgba(35,28,42,0.09)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -18,
    paddingHorizontal: 8,
    paddingVertical: 12
  },
  postHead: { alignItems: "center", flexDirection: "row", gap: 8 },
  postAvatarWrap: { height: 44, position: "relative", width: 44 },
  postAvatar: {
    alignItems: "center",
    backgroundColor: "#F0EAF5",
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  postAvatarText: { color: color.ink, fontSize: 16, fontWeight: "700" },
  scenarioBadge: { alignItems: "center", backgroundColor: color.white, borderColor: color.offWhite, borderRadius: 999, borderWidth: 2, bottom: -2, height: 20, justifyContent: "center", position: "absolute", right: -3, width: 20 },
  engagementError: { color: color.magenta, fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  engagementNotice: { color: "#53651A", fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  postIdentity: { flex: 1, minWidth: 0 },
  postName: { color: color.ink, fontSize: 13, fontWeight: "900" },
  postMeta: { color: color.muted, fontSize: 11, marginTop: 1 },
  followBtn: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  followBtnOn: { backgroundColor: color.ink, borderColor: color.ink },
  followBtnText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  followBtnTextOn: { color: color.white },

  postReason: { color: "#81788A", fontSize: 11, lineHeight: 15, marginTop: 5 },
  postCopy: { color: color.ink, fontSize: 14, lineHeight: 20, marginVertical: 5 },

  // 基线 .mediaAsset：height 156，radius 14。
  mediaAsset: {
    backgroundColor: "#2A2135",
    borderRadius: 14,
    height: 156,
    width: "100%"
  },
  videoStage: { borderRadius: 14, height: 156, overflow: "hidden", width: "100%" },
  videoView: { backgroundColor: "#2A2135", height: "100%", width: "100%" },
  videoTap: { height: "100%", left: 0, position: "absolute", top: 0, width: "100%" },
  videoMute: {
    alignItems: "center",
    backgroundColor: "rgba(17,13,22,0.72)",
    borderRadius: 999,
    height: 22,
    justifyContent: "center",
    left: 8,
    position: "absolute",
    top: 8,
    width: 22
  },
  videoMuteText: { fontSize: 11 },
  mediaRail: { flexDirection: "row", marginVertical: 8 },
  mediaWall: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginVertical: 8 },
  mediaWallCell: { aspectRatio: 1, flexBasis: "49%", flexGrow: 1, maxWidth: "50%" },
  mediaWallBadge: {
    backgroundColor: "rgba(17,13,22,0.72)",
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 3,
    position: "absolute",
    right: 6,
    top: 6
  },
  socialMediaFrame: {
    backgroundColor: "#17131F",
    borderRadius: 14,
    height: "100%",
    overflow: "hidden",
    width: "100%"
  },
  socialMediaBackdrop: {
    height: "112%",
    left: "-6%",
    opacity: 0.38,
    position: "absolute",
    top: "-6%",
    width: "112%"
  },
  socialMediaAsset: { height: "100%", width: "100%" },
  singleMediaStage: {
    alignItems: "center",
    backgroundColor: "#17131F",
    borderRadius: 14,
    justifyContent: "center",
    marginVertical: 8,
    overflow: "hidden",
    width: "100%"
  },
  singleMediaImage: { height: "100%", width: "100%" },
  railAsset: {
    backgroundColor: "#2A2135",
    borderRadius: 14,
    height: 156,
    marginRight: 8
  },
  mediaRailHint: { color: color.muted, fontSize: 11, marginBottom: 6, marginTop: -4 },
  mediaBadge: {
    backgroundColor: "rgba(17,13,22,0.72)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
    position: "absolute",
    right: 8,
    top: 8
  },
  mediaBadgeText: { color: color.white, fontSize: 11, fontWeight: "700" },

  // 基线 .contextrefs：gap 5 wrap margin 7 0。
  contextRefs: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginVertical: 7 },
  contextRef: { backgroundColor: "#F5F1F7", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 },
  contextRefStrong: { backgroundColor: "#F0E7FF" },
  contextRefText: { color: "#5D5365", fontSize: 11, fontWeight: "700" },
  contextRefTextStrong: { color: "#6330B2" },

  // X 式引用卡：描边内嵌。
  quoteCard: {
    borderColor: "#E8E0EC",
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 7,
    padding: 8
  },
  quoteHead: { alignItems: "center", flexDirection: "row", gap: 5 },
  quoteAvatar: {
    alignItems: "center",
    backgroundColor: "#F0EAF5",
    borderRadius: 999,
    height: 21,
    justifyContent: "center",
    width: 21
  },
  quoteAvatarText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  quoteAuthor: { color: color.ink, fontSize: 11, fontWeight: "700" },
  quoteMeta: { color: color.muted, fontSize: 11, marginLeft: "auto" },
  quoteBody: { color: "#4A4250", fontSize: 11, lineHeight: 15, marginTop: 4 },
  quoteMediaLabel: { color: color.muted, fontSize: 11, marginTop: 4 },

  postUtility: {
    backgroundColor: "#FBFFE9",
    borderColor: "#DEEDA9",
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 7,
    paddingHorizontal: 8,
    paddingVertical: 7
  },
  postUtilityText: { color: "#5A6536", fontSize: 11, lineHeight: 15 },

  postActions: {
    borderTopColor: "#F2EDF4",
    borderTopWidth: 1,
    flexDirection: "row",
    marginTop: 7,
    paddingTop: 7
  },
  postAction: { alignItems: "center", flex: 1, paddingVertical: 5 },
  postActionText: { color: "#756D7A", fontSize: 11, fontWeight: "600" },
  postActionOn: { color: "#6C36C8", fontWeight: "700" },

  postIntent: { flexDirection: "row", gap: 6, marginTop: 8 },
  intentChat: { backgroundColor: color.ink, borderRadius: 12, flex: 1, padding: 9 },
  intentChatText: { color: color.white, fontSize: 11, fontWeight: "700", textAlign: "center" },
  intentNeed: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 9
  },
  intentNeedText: { color: color.ink, fontSize: 11, fontWeight: "700", textAlign: "center" },

  // 长按减少推荐菜单（X 式 ··· 菜单）。
  menuOverlay: {
    backgroundColor: "rgba(0,0,0,0.4)",
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },
  menuContent: {
    backgroundColor: color.white,
    borderRadius: 16,
    width: "80%",
    overflow: "hidden"
  },
  menuTitle: {
    color: color.muted,
    fontSize: 11,
    fontWeight: "700",
    padding: 12,
    paddingBottom: 6
  },
  menuItem: {
    borderColor: "#F0EBF2",
    borderBottomWidth: 1,
    padding: 12
  },
  menuItemText: {
    color: color.ink,
    fontSize: 11,
    fontWeight: "600"
  },
  menuCancel: {
    backgroundColor: "#F8F5FA",
    padding: 12,
    alignItems: "center"
  },
  menuCancelText: {
    color: color.muted,
    fontSize: 11,
    fontWeight: "700"
  },

  // 全屏媒体查看器：深色底 #17131F。
  viewerRoot: { backgroundColor: "#17131F", flex: 1 },
  viewerTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 52,
    zIndex: 100
  },
  viewerCounter: { color: "rgba(255,255,255,0.82)", fontSize: 11, fontWeight: "700" },
  viewerClose: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
    zIndex: 101
  },
  viewerCloseText: { color: color.white, fontSize: 16 },
  viewerStage: { alignItems: "center", flex: 1, flexDirection: "row", justifyContent: "center", paddingHorizontal: 8 },
  viewerNav: { alignItems: "center", height: 52, justifyContent: "center", width: 40 },
  viewerNavText: { color: "rgba(255,255,255,0.85)", fontSize: 26 },
  viewerAsset: { backgroundColor: "#0F0C14", borderRadius: 16, flex: 1, height: 380 },
  viewerCaption: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    paddingBottom: 34,
    paddingHorizontal: 24,
    paddingTop: 12,
    textAlign: "center"
  }
});

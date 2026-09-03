// Feed Surface（稳定 Surface：动态 tab / LocalNet Feed）。
// 新架构（服务端驱动）：内容全部来自后端 ListFeedPosts 读模型（operationRef payload），
// 发布走 CreatePost 命令；前端不再内嵌内容 seed（首次空读模型时经 CreatePost 写入演示帖）。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
// （r153search + networktabs + feedfilterrail + preferencehint + postcard + mediaRail +
// postactions + postintent + feedfab），刻度按 R15.11 Social Baseline 对齐。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { GlassContainer, GlassView } from "expo-glass-effect";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import ImageViewing from "react-native-image-viewing";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type SecureSessionStore, OfflineFallbackSessionError } from "../secure-session";
import { mapEngagementError } from "./feed-error-map";
import { type EngagementClient } from "../engagement-client";
import { type MediaClient } from "../media-client";
import { ComposerV2Screen } from "./ComposerV2Screen";
import { FilterChipRail } from "../components/filter-chip-rail";
import { isOpportunityPost } from "../feed-content";
import { mediaAspect, mediaCollectionMode, mediaRailMetrics, nearestRailIndex, shouldPreserveWholeSubject } from "../media-presentation";
// v2 重构：深紫黑底 + compositionHint 驱动 fill。Sprint C 替换完成。
// 旧 AdaptiveMediaCollection / AdaptiveMediaRail / SocialMediaFrame / SinglePostImage
// 已从本文件迁出 → apps/mobile/src/media/
import { AdaptiveMediaCollection, SinglePostImage, MediaViewer } from "../media/AdaptiveMediaCollection";
import { readFeedDiskCache, writeFeedDiskCache } from "../feed-disk-cache";

// Re-export v2 组件，保持其他 surface （me.tsx 等）从 ./feed 导入的兼容性。
export { AdaptiveMediaCollection, SinglePostImage, MediaViewer };

// R15.50: 举报原因白名单提到 module 顶层
// (R15.45 原在 FeedSurface 函数内 const, PostMenuModal 引用不到 — 随手修).
const POST_REPORT_REASONS = ["SPAM", "HARASSMENT", "UNSAFE", "OTHER"] as const;
export type PostReportReason = (typeof POST_REPORT_REASONS)[number];
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
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

// 种子媒体资产固定 ID（后端 seedPostgresMedia 幂等写入，READY）。

const AUTHOR_TYPE_META: Record<FeedPost["authorType"], { label: string; reason: string; aiBadge?: boolean }> = {
  USER: { label: "用户 · 河内", reason: "为你推荐：本地用户的公开动态" },
  AGENT: { label: "城市同行 · 已验证", reason: "为你推荐：当前可用时间与你最近需求接近" },
  MERCHANT: { label: "商家 · 河内", reason: "为你推荐：附近商家的公开动态" },
  PLATFORM_SPECIAL: { label: "Proxy 特别企划", reason: "为你推荐：平台特别企划" },
  // R15.76: R1 AI Identity System PRD — AI Native (平台虚拟供给) 在 4 个
  //   authorType 之外独立一档. 限 mock 帖表现 (server schema 暂不返, 前面是 PLATFORM_SPECIAL 视觉但加 aiBadge).
  AI_NATIVE: { label: "AI 助手 · 河内", reason: "为你推荐：平台虚拟供给, 由 Proxy 透明生成", aiBadge: true }
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

export function FeedSurface({
  localNet,
  mediaClient,
  engagement,
  socialSpace,
  secureSessionStore,
  onOpenChat,
  onOpenFeedPrefs,
  onOpenProfile,
  onChromeVisibilityChange,
  // R15.93: 外部传入 search query (主页 sheet 提交时 app-shell set 进 feed)
  externalSearchQuery,
  refreshTrigger,
  bottomNavVisible,
  // R15.63: 当前 session userAccountId, 用来在 feed post menu 区分自己/他人 (pin 项只对自己)
  viewerAccountId,
  initialTab,
  currentSection,
  onSectionChange
}: {
  localNet: LocalNetClient;
  mediaClient: MediaClient;
  engagement: EngagementClient;
  socialSpace: SocialSpaceClient;
  // R15.37: 透传给 composer 以拦截 "未登录发帖"。
  secureSessionStore?: SecureSessionStore | undefined;
  onOpenChat: (author: string) => void;
  onOpenFeedPrefs: () => void;
  onOpenProfile?: ((target: { userId: string; name: string; city?: string | undefined; posts: FeedPost[]; mediaByPost: Record<string, FeedMediaItem[]> }) => void) | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  viewerAccountId?: string | undefined;
  refreshTrigger?: number;
  bottomNavVisible?: boolean;
  // R15.22 sub-page sync (initialTab from RootNav 8-page sequence)
  initialTab?: FeedTab;
  // R15.23: section (动态/状态/社区) 改 controlled — 由 AppShell 同步 swipe 跨 page 状态
  currentSection?: FeedSection;
  onSectionChange?: (section: FeedSection) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<FeedTab>(initialTab ?? "RECOMMENDED");
  // R15.23: 优先用 controlled prop (currentSection)，fallback 到内部 state (用于独立 mount / 测试)
  const [internalSection, setInternalSection] = useState<FeedSection>("POSTS");
  const section = currentSection ?? internalSection;
  const setSection = (next: FeedSection): void => {
    if (currentSection === undefined) setInternalSection(next);
    onSectionChange?.(next);
  };
  const [feedFilter, setFeedFilter] = useState<FilterKey>("ALL");
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">(cachedPosts.length > 0 ? "READY" : "LOADING");
  const feedRetryAttemptRef = useRef(0);
  const [lastFeedError, setLastFeedError] = useState<string | undefined>();
  const [posts, setPosts] = useState<FeedPost[]>(cachedPosts);
  const [media, setMedia] = useState<Record<string, FeedMediaItem[]>>(cachedMedia);
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [following, setFollowing] = useState<ReadonlySet<string>>(new Set());
  const { width: viewportWidth } = useWindowDimensions();
  const [postMenuPostId, setPostMenuPostId] = useState<string | undefined>();
  const [mutedAuthors, setMutedAuthors] = useState<ReadonlySet<string>>(new Set());
  const [postMenuError, setPostMenuError] = useState<string | undefined>();
  // R15.63: viewer 点开自己 post 的 menu 时, 可调 engagement.pinPost
  const [pinBusy, setPinBusy] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<ReadonlySet<string>>(new Set());
  const [engagementBusy, setEngagementBusy] = useState<ReadonlySet<string>>(new Set());
  const [engagementError, setEngagementError] = useState<string>();
  const [engagementNotice, setEngagementNotice] = useState<string>();
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  // 发布器状态（v2 全面迁出到 ComposerV2Screen；这里只保留触发器）
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerQuoteId, setComposerQuoteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // R15.93: externalSearchQuery 同步 (主页 search sheet 提交时 app-shell 传).
  //   接受后同时拉一次 listFeedPosts(q) — 刷新过滤后的 feed.
  //   跟 local searchQuery (line 793 TextInput) 互不干扰.
  const [externalQuery, setExternalQuery] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (externalSearchQuery !== undefined && externalSearchQuery.length > 0) {
      setExternalQuery(externalSearchQuery);
      setSearchQuery(externalSearchQuery);
      // R15.93: 触发 listFeedPosts(q) 重拉
      void localNet.listFeedPosts(undefined, 25, externalSearchQuery).then((read) => {
        setPosts(read.posts);
        setMediaByPost(read.media);
        setFeedCursor(read.nextCursor);
        setHasMore(read.hasMore === true);
        setPhase("LOADED");
      }).catch(() => undefined);
    }
  }, [externalSearchQuery, localNet]);
  const [viewer, setViewer] = useState<{ postId: string; index: number } | null>(null);
  const [mediaPositions, setMediaPositions] = useState<Record<string, number>>({});
  const [customFeedHubOpen, setCustomFeedHubOpen] = useState(false);
  // R15.69: 点头像弹 关注/访问个人主页 菜单 (R15.45 旧实现, 重启)
  const [profileActions, setProfileActions] = useState<{ userId: string; name: string; city?: string | undefined; posts: FeedPost[]; mediaByPost: Record<string, FeedMediaItem[]>; anchor: { x: number; y: number } }>();
  const [profileFollowing, setProfileFollowing] = useState(false);
  const [profileFollowBusy, setProfileFollowBusy] = useState(false);
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
  // R15.34.1: filterRail 横滑逻辑已抽到共享组件 FilterChipRail
  // (components/filter-chip-rail.tsx)。原本 feed 这边的
  // filterRailRef / filterRailScrollXRef / filterRailPanResponder
  // 全部删除。Home (推荐人 mode) 和 FEED (动态筛选) 现在用同一份
  // 公共组件，PanResponder 隔离外层 PAGE_SEQUENCE 切页的逻辑一致。

  // 发布器状态全部迁出到 ComposerV2Screen（包含上传、草稿、状态机）。
  // 父组件只管打开/关闭，初始 quoteId 通过 composerQuoteId 透传。

  const activeVideoId = useMemo(() => {
    if (viewportHeight === 0) return null;
    const videoKeys = Object.keys(frames);
    if (videoKeys.length === 0) return null;
    if (videoKeys.length === 1) return videoKeys[0]; // 唯一视频 → 强制播放

    // 多视频：按中心距离 + 可见度选
    let best: string | null = null;
    let bestScore = -1;
    const centerY = viewportHeight / 2;
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
    const { contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentSize.height - (nextY + layoutMeasurement.height) < 900) {
      void loadMoreFeed();
    }
  }

  useEffect(() => () => onChromeVisibilityChange?.(true), [onChromeVisibilityChange]);

  function toggleEmbeddedComposer(): void {
    if (composerOpen) {
      setComposerOpen(false);
      setComposerQuoteId(null);
      return;
    }
    setComposerQuoteId(null);
    setComposerOpen(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }

  function openComposerFor(quoteId: string): void {
    setComposerQuoteId(quoteId);
    setComposerOpen(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }

  const loadFeed = useCallback(async (): Promise<void> => {
    // 动态帖文与地址解绑：帖文不按 viewingCity 过滤，地址仅作 Status/社区等筛选项
    if (cachedPosts.length === 0) {
      setPhase("LOADING");
    }
    try {
      const read = await localNet.listFeedPosts();
      cachedPosts = read.posts;
      cachedMedia = read.media;
      cachedPostIds = new Set(read.posts.map((p) => p.postId));
      postIdsRef.current = cachedPostIds;
      setPosts(read.posts);
      setMedia(read.media);
      setNextCursor(read.nextCursor);
      setHasMore(read.hasMore);
      writeFeedDiskCache(read.posts, read.media);
      feedRetryAttemptRef.current = 0;
      setPhase("READY");
    } catch (error) {
      console.error("[proxy.feed] public feed load failed", error, (error as Error)?.message, (error as Error)?.stack);
      feedRetryAttemptRef.current += 1;
      // A transient API restart must not blank an already hydrated timeline.
      setPhase(cachedPosts.length > 0 ? "READY" : "ERROR");
      (global as any).__lastFeedError = error;
    }
  }, [localNet]);

  async function loadMoreFeed(): Promise<void> {
    if (!hasMore || !nextCursor || loadingMoreRef.current || phase !== "READY") return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const read = await localNet.listFeedPosts(nextCursor);
      const known = new Set(cachedPosts.map((post) => post.postId));
      const appended = read.posts.filter((post) => !known.has(post.postId));
      cachedPosts = [...cachedPosts, ...appended];
      cachedMedia = { ...cachedMedia, ...read.media };
      cachedPostIds = new Set(cachedPosts.map((post) => post.postId));
      postIdsRef.current = cachedPostIds;
      setPosts(cachedPosts);
      setMedia(cachedMedia);
      setNextCursor(read.nextCursor);
      setHasMore(read.hasMore);
      writeFeedDiskCache(cachedPosts, cachedMedia);
    } catch (error) {
      console.error("[proxy.feed] next page load failed", error);
      // Keep the current timeline and cursor; the next near-end scroll retries.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  // 后台静默刷新：不显示 LOADING，只检测新帖（同解绑）
  const backgroundRefresh = useCallback(async (): Promise<void> => {
    try {
      const read = await localNet.listFeedPosts();
      if (read.posts.length === 0) return;
      const currentIds = postIdsRef.current;
      const newPosts = read.posts.filter((p) => !currentIds.has(p.postId));
      if (newPosts.length > 0) {
        setPendingCount(newPosts.length);
        setPendingPosts(read.posts);
        setPendingMedia(read.media);
      }
    } catch {
      // 静默失败
    }
  }, [localNet]);

  // 切换到 Feed tab 时触发后台刷新
  useEffect(() => {
    if (refreshTrigger !== undefined && phase === "READY") {
      void backgroundRefresh();
    }
  }, [refreshTrigger, phase, backgroundRefresh]);

  // 首屏先读手机磁盘，再静默刷新服务器。App 重启、API 短暂离线时
  // 仍能立即显示上次成功同步的完整时间线。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await readFeedDiskCache();
      if (!cancelled && disk && cachedPosts.length === 0) {
        cachedPosts = disk.posts;
        cachedMedia = disk.media;
        cachedPostIds = new Set(disk.posts.map((post) => post.postId));
        postIdsRef.current = cachedPostIds;
        setPosts(disk.posts);
        setMedia(disk.media);
        setPhase("READY");
      }
      if (!cancelled) await loadFeed();
    })();
    return () => { cancelled = true; };
  }, [loadFeed]);

  // P0 availability: recover without requiring the user to kill/reopen the app.
  useEffect(() => {
    if (phase !== "ERROR") return;
    const delay = Math.min(8_000, 1_000 * 2 ** Math.min(feedRetryAttemptRef.current, 3));
    const timer = setTimeout(() => void loadFeed(), delay);
    return () => clearTimeout(timer);
  }, [phase, loadFeed]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && (phase === "ERROR" || cachedPosts.length === 0)) void loadFeed();
    });
    return () => subscription.remove();
  }, [phase, loadFeed]);

  // 点击"展示最新"：将 pending 内容刷入正式列表
  function showLatest(): void {
    const pendingIDs = new Set(pendingPosts.map((post) => post.postId));
    cachedPosts = [...pendingPosts, ...posts.filter((post) => !pendingIDs.has(post.postId))];
    cachedMedia = { ...media, ...pendingMedia };
    cachedPostIds = new Set(pendingPosts.map((p) => p.postId));
    postIdsRef.current = cachedPostIds;
    setPosts(pendingPosts);
    setMedia(pendingMedia);
    setPendingCount(0);
    setPendingPosts([]);
    setPendingMedia({});
    writeFeedDiskCache(cachedPosts, cachedMedia);
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
    } catch (error) {
      // R15.38 DEBUG: 临时诊断, 看新逻辑是否走对路径
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        // eslint-disable-next-line no-console
        console.log(
          `[proxy.R15.38.DEBUG] engagement error type=${error instanceof Error ? error.name : typeof error} ` +
          `msg=${error instanceof Error ? error.message : String(error)} ` +
          `isOffline=${error instanceof OfflineFallbackSessionError || (error instanceof Error && (error.message.includes("require a real sign-in") || error.message.includes("offline session cannot")))}`
        );
      }
      setEngagementError(mapEngagementError(error, "互动没有提交成功，请检查连接后重试。"));
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
    } catch (error) {
      setEngagementError(mapEngagementError(error, "回复没有提交成功，请检查连接后重试。"));
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
    } catch (error) {
      setEngagementError(mapEngagementError(error, "偏好没有保存成功，请检查连接后重试。"));
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
    } catch (error) {
      setEngagementError(mapEngagementError(error, "举报没有提交成功，请检查连接后重试。"));
    } finally {
      setContextActionBusy(false);
    }
  }

  // 发布器 (pickComposerImages / replaceComposerImage / publish) 全部迁出到 ComposerV2Screen。
  // 这里只保留打开入口（toggleEmbeddedComposer）。

  // ---------- R15.45: post menu handlers (举报 / 不感兴趣 / 屏蔽作者) ----------

  // 举报原因白名单 (跟 server engagement.service.go reportPost payload 对齐)
  // R15.50: 提到 module 顶层 (line 32) — PostMenuModal 要用.

  const openPostMenu = useCallback((postId: string) => {
    setPostMenuError(undefined);
    setPostMenuPostId(postId);
  }, []);

  const closePostMenu = useCallback(() => {
    setPostMenuPostId(undefined);
    setPostMenuError(undefined);
  }, []);

  const postMenuPost = postMenuPostId ? posts.find((p) => p.postId === postMenuPostId) : undefined;

  // R15.69: 点头像弹 关注/访问个人主页 菜单 — 头像 onPress 触发, 名字 onPress 走 onOpenProfile 直接访问
  async function openProfileActions(target: NonNullable<typeof profileActions>): Promise<void> {
    setProfileActions(target);
    setProfileFollowing(following.has(target.userId));
  }
  async function toggleProfileFollow(): Promise<void> {
    if (!profileActions || profileFollowBusy) return;
    setProfileFollowBusy(true);
    try {
      if (profileFollowing) await engagement.unfollowProfile(profileActions.userId);
      else await engagement.followProfile(profileActions.userId);
      const next = new Set(following);
      if (profileFollowing) next.delete(profileActions.userId);
      else next.add(profileActions.userId);
      setFollowing(next);
      setProfileFollowing(!profileFollowing);
    } catch (error) {
      setEngagementError(mapEngagementError(error, "关注没有提交成功, 请检查连接后重试。"));
    } finally {
      setProfileFollowBusy(false);
    }
  }

  async function handleReportPost(reason: PostReportReason): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    try {
      await engagement.reportPost(postMenuPost.postId, reason);
      setPosts((prev) => prev.filter((p) => p.postId !== postMenuPost.postId));
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "举报失败");
    }
  }

  async function handleNotInterested(): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    try {
      await engagement.recordFeedPreference(postMenuPost.postId, "NOT_INTERESTED");
      setPosts((prev) => prev.filter((p) => p.postId !== postMenuPost.postId));
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleMuteAuthor(): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    try {
      await engagement.muteAuthor(postMenuPost.authorId);
      // 本地记录 + 立即过滤该作者所有 post (跟 server mute 同步)
      const mutedId = postMenuPost.authorId;
      setMutedAuthors((prev) => new Set(prev).add(mutedId));
      setPosts((prev) => prev.filter((p) => p.authorId !== mutedId));
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "屏蔽失败");
    }
  }

  // R15.63: post menu 的 "置顶/取消置顶" — R15.56 PinPost endpoint 接线
  async function handlePinPost(): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    setPinBusy(true);
    try {
      const result = await engagement.pinPost(postMenuPost.postId);
      if (result === "PINNED" || result === "ALREADY_PINNED") {
        setPinnedIds((prev) => new Set(prev).add(postMenuPost.postId));
      }
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "置顶失败");
    } finally {
      setPinBusy(false);
    }
  }

  async function handleUnpinPost(): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    setPinBusy(true);
    try {
      const result = await engagement.unpinPost(postMenuPost.postId);
      if (result === "UNPINNED" || result === "NOT_PINNED") {
        setPinnedIds((prev) => {
          const next = new Set(prev);
          next.delete(postMenuPost.postId);
          return next;
        });
      }
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "取消置顶失败");
    } finally {
      setPinBusy(false);
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
  const quoteTarget = composerQuoteId ? posts.find((post) => post.postId === composerQuoteId) : undefined;
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

      {/* R15.3 feedfilterrail：只由外层 PanResponder 判定横向手势并驱动本 ScrollView。
          不在内层再注册 responder，避免纵向滚动被第二套手势逻辑截获。
          R15.34.1: 抽到共享 FilterChipRail (components/filter-chip-rail.tsx)，
          requester-home 复用同一份。feed 这边的 filterRailRef /
          filterRailScrollXRef / filterRailPanResponder 已删除。 */}
      <FilterChipRail
        items={FILTERS.map((f) => ({ id: f.id, label: f.label }))}
        activeId={feedFilter}
        onChange={(id) => {
          setFeedFilter(id as FilterKey);
          setSelectedCustomFeed(null);
        }}
        marginBottom={6}
        testPrefix="动态筛选"
      />

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

      {/* 发布器 v2 — 全部状态/上传/草稿都在 ComposerV2Screen 内部，父组件只透传 trigger */}
      <ComposerV2Screen
        initialQuoteId={composerQuoteId}
        localNet={localNet}
        mediaClient={mediaClient}
        secureSessionStore={secureSessionStore}
        onClose={() => { setComposerOpen(false); setComposerQuoteId(null); }}
        onPublished={async () => { setComposerOpen(false); setComposerQuoteId(null); await loadFeed(); }}
        posts={posts}
        visible={composerOpen}
      />

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
          {lastFeedError ? <Text style={[styles.feedEmptyText, { marginTop: 8, color: color.error }]}>{lastFeedError}</Text> : null}
          <Pressable onPress={() => void loadFeed()} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.feedEmpty}>
          <Text style={styles.feedEmptyText}>
			{feedFilter !== "ALL"
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
              {/* posthead — R15.69 拆头像/名字为 2 个 Pressable:
                  点头像 弹 关注/访问个人主页 菜单 (openProfileActions),
                  点名字 直接访问个人主页 (onOpenProfile).
                  之前 1 个 Pressable 包整段, 点头部任何位置都直接去主页. */}
              <View style={styles.postHead}>
                <Pressable
                  accessibilityLabel={`${name} 的操作`}
                  onPress={(event) => void openProfileActions({ userId: post.authorId, name, city: post.cityScope, posts: posts.filter((candidate) => candidate.authorId === post.authorId), mediaByPost: media, anchor: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY } })}
                  style={styles.postAvatarPressable}
                >
                <View style={styles.postAvatarWrap}>
                  <View style={styles.postAvatar}>
                    <Text style={styles.postAvatarText}>{name.charAt(0)}</Text>
                  </View>
                  <View style={styles.scenarioBadge}>
                    <ProxyIcon color={color.violet} name={scenarioIconForPost(post)} size={10} />
                  </View>
                  {meta.aiBadge ? (
                    <View style={styles.aiAuthorBadge} accessibilityLabel="AI 生成">
                      <Text style={styles.aiAuthorBadgeText}>AI</Text>
                    </View>
                  ) : null}
                </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={`查看 ${name} 的主页`}
                  onPress={() => onOpenProfile?.({ userId: post.authorId, name, city: post.cityScope, posts: posts.filter((candidate) => candidate.authorId === post.authorId), mediaByPost: media })}
                  style={styles.postIdentityPressable}
                >
                <View style={styles.postIdentity}>
                  <View style={styles.postNameLine}>
                    <Text style={styles.postName}>{name}</Text>
                    <Text style={styles.postMeta}>· {relativeTime(post.createdAt)}</Text>
                  </View>
                  {meta.label ? <Text style={styles.postMeta}>{meta.label}</Text> : null}
                </View>
                </Pressable>
                <Pressable
                  accessibilityLabel="更多"
                  onPress={() => openPostMenu(post.postId)}
                  style={styles.postMenu}
                >
                  <Text style={styles.postMenuText}>⋯</Text>
                </Pressable>
              </View>

              <View style={styles.postBody}>
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
                <Pressable onPress={() => openComposerFor(post.postId)} style={styles.postAction}>
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
            </View>
          );
        })}
        {loadingMore ? (
          <View style={styles.feedEmpty}>
            <ActivityIndicator color={color.magenta} />
          </View>
        ) : null}
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
      </>
      )}

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
    {/* R15.45 + R15.63: post menu modal (举报 / 不感兴趣 / 屏蔽作者 / 置顶(仅自己)) */}
    <PostMenuModal
      open={postMenuPostId !== undefined}
      post={postMenuPost}
      error={postMenuError}
      onClose={closePostMenu}
      onReport={handleReportPost}
      onNotInterested={handleNotInterested}
      onMuteAuthor={handleMuteAuthor}
      isOwn={!!viewerAccountId && !!postMenuPost && postMenuPost.authorId === viewerAccountId}
      isPinned={postMenuPost ? pinnedIds.has(postMenuPost.postId) : false}
      pinBusy={pinBusy}
      onPin={handlePinPost}
      onUnpin={handleUnpinPost}
    />
    {/* R15.69: 点头像弹 关注/访问个人主页 菜单 (双行上下排) */}
    <Modal transparent animationType="fade" visible={profileActions !== undefined} onRequestClose={() => setProfileActions(undefined)}>
      <Pressable onPress={() => setProfileActions(undefined)} style={styles.profileActionOverlay}>
        <GlassContainer spacing={8} style={[styles.profileGlassContainer, { left: Math.max(12, Math.min(viewportWidth - 200, (profileActions?.anchor.x ?? 24) - 28)), top: (profileActions?.anchor.y ?? 80) + 20 }]}>
          <GlassView glassEffectStyle="clear" isInteractive style={styles.profileGlassDropFull}>
            <Pressable disabled={profileFollowBusy} onPress={(event) => { event.stopPropagation(); void toggleProfileFollow(); }} style={styles.profileDropPress}><Text style={styles.profileDropText}>{profileFollowBusy ? "处理中…" : profileFollowing ? "✓ 已关注" : "+ 关注"}</Text></Pressable>
          </GlassView>
          <GlassView glassEffectStyle="clear" isInteractive style={styles.profileGlassDropFull}>
            <Pressable onPress={(event) => { event.stopPropagation(); const target = profileActions; setProfileActions(undefined); if (target) { const { anchor: _anchor, ...profileTarget } = target; onOpenProfile?.(profileTarget); } }} style={styles.profileDropPress}><Text style={styles.profileDropText}>访问个人主页</Text></Pressable>
          </GlassView>
        </GlassContainer>
      </Pressable>
    </Modal>
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
  // R15.23: 对齐 threads 规范 (.post padding 18 18 14, 430pt 屏幕)。iPhone 15 (393pt) 头像距屏 18pt
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

  // 基线 .feedfilterrail：横滑筛选。外层 View 捕获横滑以隔离 PAGE_SEQUENCE 切页
  //   R15.34.1: 抽到共享 FilterChipRail (components/filter-chip-rail.tsx)。
  //   requester-home 也复用同一份。feed 这里的 filterRailCapture /
  //   filterRail / filterRailContent / filterChip* 样式不再使用，删除。
  customFeedBanner: { alignItems: "center", backgroundColor: "#F3EFF5", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 10, paddingVertical: 6 },
  customFeedBannerText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  customFeedBannerAction: { color: color.muted, fontSize: 11, fontWeight: "700" },

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

  // 发布器 (composer / composerInput / composerQuote / composerMedia* / composerMeta* /
  // composerTool* / composerPublish* / composerError / composerError) 全部迁出到
  // ComposerV2Screen。父组件只保留 trigger 状态与样式。

  // 基线 .postcompose：bg white border ln radius 17 padding 11。
  // 仍被 ComposerV2Screen 外部容器/外层其它 UI 引用，保留为视觉基线。
  disabled: { opacity: 0.45 },
  disabledText: { color: color.muted, opacity: 0.45 },

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
  // Use a compact 14pt feed edge and break out the parent's right gutter so copy can
  // use the screen. Media independently preserves its decoded source aspect.
  postCard: {
    backgroundColor: "transparent",
    borderBottomColor: "#E8E8E8",
    borderBottomWidth: 1,
    // The page chrome already owns 18pt horizontal padding. Break the feed
    // row back out to the screen edge so it is not inset twice: avatar sits
    // at 14pt, while text/media can use the full width on the right.
    marginHorizontal: -18,
    paddingLeft: 14,
    paddingRight: 0,
    paddingTop: 16,
    paddingBottom: 14
  },
  // 44pt avatar + flexible identity + 32pt menu, gap 10.
  postHead: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  // R15.69: 拆头像/名字 2 个 Pressable, 头像 = 弹 关注菜单, 名字 = 直接访个人主页
  postAvatarPressable: { alignItems: "center" },
  postIdentityPressable: { alignItems: "flex-start", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },
  postProfileTrigger: { alignItems: "flex-start", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },

  // R15.69: 关注/访问主页 菜单 (双行上下排) — 200 宽 + 44 行高 + 24 圆角
  profileActionOverlay: { backgroundColor: "rgba(20,18,31,0.32)", flex: 1 },
  profileGlassContainer: { flexDirection: "column", gap: 8, position: "absolute", width: 200 },
  profileGlassDropFull: { borderRadius: 14, height: 44, overflow: "hidden", width: 200 },
  profileDropPress: { alignItems: "center", height: "100%", justifyContent: "center", paddingHorizontal: 12, width: "100%" },
  profileDropText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  postAvatarWrap: { height: 44, position: "relative", width: 44 },
  postAvatar: {
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  postAvatarText: { color: color.white, fontSize: 16, fontWeight: "700" },
  scenarioBadge: { alignItems: "center", backgroundColor: color.white, borderColor: color.offWhite, borderRadius: 999, borderWidth: 2, bottom: -2, height: 20, justifyContent: "center", position: "absolute", right: -3, width: 20 },
  // R15.76: AI 徽章 — 在头像左下角贴贴 (跟 scenarioBadge 不撞位置). 设计上 8pt
  //   装饰文字 (R2/R3 守门免白名单: AI 徽章装饰跟 personalAvaLetter 同).
  aiAuthorBadge: { alignItems: "center", backgroundColor: color.violet, borderColor: color.white, borderRadius: 999, borderWidth: 2, bottom: -2, height: 16, justifyContent: "center", left: -3, position: "absolute", width: 22 },
  aiAuthorBadgeText: { color: color.white, fontSize: 9, fontWeight: "800", lineHeight: 11 },
  engagementError: { color: color.magenta, fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  engagementNotice: { color: "#53651A", fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  postIdentity: { flex: 1, minWidth: 0 },
  postNameLine: { alignItems: "center", flexDirection: "row", gap: 6, minWidth: 0 },
  postName: { color: color.ink, fontSize: 13, fontWeight: "700" },
  postMeta: { color: color.muted, fontSize: 11 },
  // R15.23: Threads UX 没有 follow 按钮, 改 ⋯ 菜单 (32pt 宽, 19px 文字 #555)
  postMenu: { alignItems: "center", height: 28, justifyContent: "center", width: 32 },
  postMenuText: { color: "#555", fontSize: 19, lineHeight: 22 },

  // 44pt avatar + 10pt gap: body aligns with the identity while the row's
  // right edge remains flush with the screen.
  postBody: { marginTop: -12, paddingLeft: 54 },
  postReason: { color: "#81788A", fontSize: 11, marginTop: 5 },
  // R15.23: post-text 严格规范 fontSize 14 lineHeight 1.48 ≈ 20.72 → 21
  postCopy: { color: color.ink, fontSize: 14, lineHeight: 21, marginTop: 5 },

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

  // R15.23: actions gap 22 → 20, marginTop 11 → 12 (Threads 规范)
  postActions: {
    flexDirection: "row",
    gap: 20,
    marginTop: 12
  },
  postAction: { alignItems: "center", flex: 1, paddingVertical: 5 },
  postActionText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  postActionOn: { color: "#6C36C8" },

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

// ---------- R15.45: PostMenuModal ----------

type PostMenuModalProps = {
  open: boolean;
  post: FeedPost | undefined;
  error: string | undefined;
  onClose: () => void;
  onReport: (reason: PostReportReason) => Promise<void> | void;
  onNotInterested: () => Promise<void> | void;
  onMuteAuthor: () => Promise<void> | void;
  // R15.63: viewer 是 post 作者本人时显示置顶项 (R15.56 endpoint 接线)
  isOwn?: boolean | undefined;
  isPinned?: boolean | undefined;
  pinBusy?: boolean | undefined;
  onPin?: (() => Promise<void> | void) | undefined;
  onUnpin?: (() => Promise<void> | void) | undefined;
};

function PostMenuModal({ open, post, error, onClose, onReport, onNotInterested, onMuteAuthor, isOwn, isPinned, pinBusy, onPin, onUnpin }: PostMenuModalProps): React.JSX.Element {
  const [showReportReasons, setShowReportReasons] = useState(false);
  if (!open) return <View />;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={postMenuStyles.backdrop}>
        <Pressable onPress={(e) => e.stopPropagation()} style={postMenuStyles.sheet}>
          {!showReportReasons ? (
            <>
              <Text style={postMenuStyles.title}>更多操作</Text>
              <Text style={postMenuStyles.subtitle}>选一项作用于这篇帖子</Text>
              {error ? <Text style={postMenuStyles.error}>{error}</Text> : null}
              <Pressable onPress={() => { void onNotInterested(); }} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowIcon}>👎</Text>
                <View style={postMenuStyles.rowCopy}>
                  <Text style={postMenuStyles.rowTitle}>不感兴趣</Text>
                  <Text style={postMenuStyles.rowHint}>减少类似内容推送</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setShowReportReasons(true)} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowIcon}>⚠️</Text>
                <View style={postMenuStyles.rowCopy}>
                  <Text style={postMenuStyles.rowTitle}>举报</Text>
                  <Text style={postMenuStyles.rowHint}>按平台规则处理</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => { void onMuteAuthor(); }} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowIcon}>🚫</Text>
                <View style={postMenuStyles.rowCopy}>
                  <Text style={postMenuStyles.rowTitle}>屏蔽作者</Text>
                  <Text style={postMenuStyles.rowHint}>不再看 Ta 的任何内容</Text>
                </View>
              </Pressable>
              {isOwn ? (
                <Pressable
                  disabled={pinBusy}
                  onPress={() => { if (isPinned) { void onUnpin?.(); } else { void onPin?.(); } }}
                  style={postMenuStyles.row}
                >
                  <Text style={postMenuStyles.rowIcon}>{isPinned ? "📍" : "📌"}</Text>
                  <View style={postMenuStyles.rowCopy}>
                    <Text style={postMenuStyles.rowTitle}>{isPinned ? "取消置顶" : "置顶到个人主页"}</Text>
                    <Text style={postMenuStyles.rowHint}>{isPinned ? "在个人主页不再置顶显示" : "在个人主页顶部显示（最多 3 篇）"}</Text>
                  </View>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} style={postMenuStyles.cancel}>
                <Text style={postMenuStyles.cancelText}>取消</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={postMenuStyles.title}>举报原因</Text>
              <Text style={postMenuStyles.subtitle}>选一个最贴近的</Text>
              {error ? <Text style={postMenuStyles.error}>{error}</Text> : null}
              <Pressable onPress={() => { void onReport("SPAM"); }} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowTitle}>垃圾广告</Text>
              </Pressable>
              <Pressable onPress={() => { void onReport("HARASSMENT"); }} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowTitle}>骚扰 / 人身攻击</Text>
              </Pressable>
              <Pressable onPress={() => { void onReport("UNSAFE"); }} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowTitle}>不安全 / 违规</Text>
              </Pressable>
              <Pressable onPress={() => { void onReport("OTHER"); }} style={postMenuStyles.row}>
                <Text style={postMenuStyles.rowTitle}>其他</Text>
              </Pressable>
              <Pressable onPress={() => setShowReportReasons(false)} style={postMenuStyles.cancel}>
                <Text style={postMenuStyles.cancelText}>返回</Text>
              </Pressable>
            </>
          )}
          {post ? null : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const postMenuStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: color.appBg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 24 },
  title: { color: color.ink, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  subtitle: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  error: { color: "#dc2626", fontSize: 12, lineHeight: 18, marginBottom: 10, padding: 8, backgroundColor: "rgba(220, 38, 38, 0.08)", borderRadius: 6 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  rowIcon: { fontSize: 18, marginRight: 12 },
  rowCopy: { flex: 1 },
  rowTitle: { color: color.ink, fontSize: 14, fontWeight: "500", marginBottom: 2 },
  rowHint: { color: color.muted, fontSize: 11, lineHeight: 16 },
  cancel: { marginTop: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.12)", alignItems: "center" },
  cancelText: { color: color.ink, fontSize: 13, fontWeight: "500" }
});

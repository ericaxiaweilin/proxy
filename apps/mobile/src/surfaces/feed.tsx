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
import type { FeedMediaItem, FeedPost, PostEngagement, PostPollView, PostReply } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type SecureSessionStore, OfflineFallbackSessionError } from "../secure-session";
import { type AIAccountClient } from "../ai-account-client";
import { localApiBaseUrl } from "../native-clients";
import { resolveAuthorAvatar, type AvatarAccount } from "../media/author-avatar";
import { mapEngagementError, mapFollowError } from "./feed-error-map";
import { type EngagementClient } from "../engagement-client";
import type { ProfileClient } from "../profile-client";
import { type MediaClient } from "../media-client";
import { ComposerV2Screen } from "./ComposerV2Screen";
import { FilterChipRail } from "../components/filter-chip-rail";
import { useScrollChrome } from "../shell/scroll-chrome";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { isOpportunityPost } from "../feed-content";
import { mediaAspect, mediaCollectionMode, mediaRailMetrics, nearestRailIndex, shouldPreserveWholeSubject } from "../media-presentation";
// v2 重构：深紫黑底 + compositionHint 驱动 fill。Sprint C 替换完成。
// 旧 AdaptiveMediaCollection / AdaptiveMediaRail / SocialMediaFrame / SinglePostImage
// 已从本文件迁出 → apps/mobile/src/media/
import { AdaptiveMediaCollection, SinglePostImage, MediaViewer } from "../media/AdaptiveMediaCollection";
import { Directory, File, Paths } from "expo-file-system";
import { avatarFileName, createProfileStore } from "../profile-store";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { readFeedDiskCache, writeFeedDiskCache } from "../feed-disk-cache";
import { normalizeFeedSearchQuery } from "../feed-search";
import { mergePostEngagement, mergeReactedPostIds } from "../post-engagement-model";

// Re-export v2 组件，保持其他 surface （me.tsx 等）从 ./feed 导入的兼容性。
export { AdaptiveMediaCollection, SinglePostImage, MediaViewer };

// R15.50: 举报原因白名单提到 module 顶层
// (R15.45 原在 FeedSurface 函数内 const, PostMenuModal 引用不到 — 随手修).
const POST_REPORT_REASONS = ["SPAM", "HARASSMENT", "UNSAFE", "OTHER"] as const;
export type PostReportReason = (typeof POST_REPORT_REASONS)[number];
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import { CommunityHub } from "./community";
import { CustomFeedHub, type CustomFeed } from "./custom-feed";
import { readCustomFeedsAsync } from "../expo-custom-feed-store";
import { defaultFeedPrefs, readFeedPrefsAsync, writeFeedPrefs } from "../expo-feed-prefs-store";
import { feedScopeLabel, isFeedScopeActive, isPostWithinScope } from "../feed-scope-filter";
import type { FeedScope } from "../feed-scope-filter";
import { StatusFeed } from "./status";
import { type SocialSpaceClient } from "../socialspace-client";
import { isOwnAuthorId, isOwnPost as isOwnPostById, resolveAuthorDisplayName, resolveReplyAuthorDisplayName } from "../feed-author";
import { hiddenReplyCount, repliesMatchingFirst, shouldOfferReplyToggle, visibleReplies } from "../reply-preview";

type FeedTab = "RECOMMENDED" | "FOLLOWING";
type FeedSection = "POSTS" | "STATUS" | "COMMUNITY";
type FilterKey = "ALL" | "人/关系" | "机会/需求" | "活动/团体" | "情报/行业信息" | "附近";

// 模块级缓存：组件卸载/重载时保留数据，避免闪烁
let cachedPosts: FeedPost[] = [];
let cachedMedia: Record<string, FeedMediaItem[]> = {};
let cachedPostIds: Set<string> = new Set();
// AVATAR-FLASH-001: 上次解析出的本人头像 URI（带所属账户）。首帧同步初值用它，
// 切 tab 再回来不闪；effect 照常异步重验，不一致就纠正（换头像后最多闪一帧旧图，
// 不闪黑）。按账户 key，切换账号不串。
let cachedViewerAvatar: { accountId: string; uri: string } | undefined;

// 本人头像：与“我的→个人总管理”同源（profileStore 本地记录 + document
// 目录重锚 + 存在性校验，AVATAR-001 同款逻辑）。动态之前写死黑底圆圈，
// 自己的帖子也显示黑头——现在本人帖子用真头像，他人暂无来源仍用首字 fallback。
// PROFILE-READ-001: 按账户隔离，和 me 页同一 key 规则（组件内 useMemo 实例）。
const FEED_AVATAR_DIR = new Directory(Paths.document, "proxy-profile");

// 种子媒体资产固定 ID（后端 seedPostgresMedia 幂等写入，READY）。

const AUTHOR_TYPE_META: Record<FeedPost["authorType"], { label: string; reason: string; aiBadge?: boolean }> = {
  USER: { label: "用户 · 河内", reason: "为你推荐：本地用户的公开动态" },
  AGENT: { label: "城市同行 · 已验证", reason: "为你推荐：当前可用时间与你最近需求接近" },
  MERCHANT: { label: "商家 · 河内", reason: "为你推荐：附近商家的公开动态" },
  PLATFORM_SPECIAL: { label: "Proxy 特别企划", reason: "为你推荐：平台特别企划" },
  // R15.76: R1 AI Identity System PRD — AI Native (平台虚拟供给) 在 4 个
  //   authorType 之外独立一档. 小美帖走这档：对外只叫 AI生成（小美≠助手）。
  AI_NATIVE: { label: "AI生成 · 小美", reason: "为你推荐：平台小美公开动态，由 Proxy 透明生成", aiBadge: true }
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

// FEED-OWN-001: "你" is viewer-relative and resolved per call site via
// resolveAuthorDisplayName(post, viewerAccountId) — never a stored name.

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
  viewerAccountId,
  profileClient,
  aiAccountsClient,
  onOpenRealityScene,
  onOpenProfile,
  onChromeVisibilityChange,
  refreshTrigger,
  bottomNavVisible,
  initialTab,
  currentSection,
  onSectionChange,
  initialSearchQuery,
  onSearchSeedConsumed
}: {
  localNet: LocalNetClient;
  mediaClient: MediaClient;
  engagement: EngagementClient;
  socialSpace: SocialSpaceClient;
  // R15.37: 透传给 composer 以拦截 "未登录发帖"。
  secureSessionStore?: SecureSessionStore | undefined;
  onOpenChat: (author: string) => void;
  onOpenFeedPrefs: () => void;
  // 本人账号 id：用于判定“自己的帖子”并显示真头像；没有则退回名字判断。
  viewerAccountId?: string | undefined;
  // FEED-AVATAR-REMOTE-001: 本机头像文件丢失时（重装/清理）向服务端要回
  // 远端指针。缺省则只用到本地记录为止，之后是首字。
  profileClient?: ProfileClient | undefined;
  // MEDIA-PIPELINE-001: AI 账号目录，用于解析 AGENT 帖头像；缺省则 AI 帖走首字。
  aiAccountsClient?: AIAccountClient | undefined;
  onOpenRealityScene?: ((sceneId: string) => void) | undefined;
  onOpenProfile?: ((profile: { userId: string; name: string; city?: string | undefined; posts: FeedPost[]; mediaByPost: Record<string, FeedMediaItem[]> }) => void) | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  refreshTrigger?: number;
  bottomNavVisible?: boolean;
  // R15.22 sub-page sync (initialTab from RootNav 8-page sequence)
  initialTab?: FeedTab;
  // R15.23: section (动态/状态/社区) 改 controlled — 由 AppShell 同步 swipe 跨 page 状态
  currentSection?: FeedSection;
  onSectionChange?: (section: FeedSection) => void;
  // 外部带入的搜索种子（AI 主页“查看个人主页”）：mount 即生效并通知消费，
  // 防止下次进动态复用旧词。
  initialSearchQuery?: string | undefined;
  onSearchSeedConsumed?: (() => void) | undefined;
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
  // R15.69 (restored): 点头像弹 关注/访问个人主页 菜单（液态玻璃，双行上下排）
  const [profileActions, setProfileActions] = useState<{ userId: string; name: string; city?: string | undefined; posts: FeedPost[]; mediaByPost: Record<string, FeedMediaItem[]>; anchor: { x: number; y: number } }>();
  const [profileFollowing, setProfileFollowing] = useState(false);
  const [profileFollowBusy, setProfileFollowBusy] = useState(false);
  const [postMenuPostId, setPostMenuPostId] = useState<string | undefined>();
  const [mutedAuthors, setMutedAuthors] = useState<ReadonlySet<string>>(new Set());
  const [postMenuError, setPostMenuError] = useState<string | undefined>();
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set());
	const [postEngagement, setPostEngagement] = useState<Record<string, PostEngagement>>({});
	const [postReplies, setPostReplies] = useState<Record<string, PostReply[]>>({});
	const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
	// FEED-REPLY-002: 已经拉过评论的帖子，翻页回来不再重复拉。
	const requestedRepliesRef = useRef<Set<string>>(new Set());
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
  const [searchOpen, setSearchOpen] = useState(Boolean(initialSearchQuery));
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery ?? "");
  // SEARCH-CORPUS-001: 当前生效的搜索词（归一后）。放在这里而不是搜索 effect 里，
  // 是因为 backgroundRefresh / showLatest 也要读它来决定「现在能不能合并全量动态」。
  const lastSearchRef = useRef("");
  // 搜索种子只消费一次：mount 即通知调用方清除，下次进动态不再复用。
  useEffect(() => {
    if (initialSearchQuery) onSearchSeedConsumed?.();
  }, []);
  const [viewer, setViewer] = useState<{ postId: string; index: number } | null>(null);
  // 本人头像 URI：首帧用模块缓存同步初值（AVATAR-FLASH-001），不闪黑；
  // 同步读 profileStore，不依赖 effect 异步延迟；本地文件不存在时保持
  // undefined，渲染走首字 fallback，不显示原始默认黑头像。effect 照常异步重验并纠正。
  const [viewerAvatarUri, setViewerAvatarUri] = useState<string | undefined>(
    () => (cachedViewerAvatar && viewerAccountId && cachedViewerAvatar.accountId === viewerAccountId ? cachedViewerAvatar.uri : undefined)
  );
  const [viewerAvatarLoaded, setViewerAvatarLoaded] = useState<boolean>(false);
  const feedProfileStore = useMemo(
    () => createProfileStore(nativeSecureStorageDriver, viewerAccountId),
    [viewerAccountId]
  );
  useEffect(() => {
    // 启动优化：并行异步初始化，不阻塞首帧渲染（避免 6s+ 启动）。
    // 头像 / 账号数据缺失时渲染直接走 fallback，不显示原始默认黑头像。
    let active = true;
    setViewerAvatarLoaded(false);
    setAiAccountsById(new Map());
    // 并行读 profile + AI 账号，不串行等待
    const avatarTask = feedProfileStore.read().then(async (record) => {
      if (!active) return;
      const thumbOf = (pointer: string): string | undefined => {
        const id = pointer.startsWith("assets/") ? pointer.slice("assets/".length).trim() : "";
        return id ? `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(id)}` : undefined;
      };
      const done = (uri: string | undefined): void => {
        if (!active) return;
        // 首帧缓存：解析出真图就记住，下次 mount 同步初值不再闪黑。
        if (uri && viewerAccountId) cachedViewerAvatar = { accountId: viewerAccountId, uri };
        setViewerAvatarUri(uri);
        setViewerAvatarLoaded(true);
      };
      const stored = record?.avatarPath ?? "";
      if (!stored) {
        // 无头像记录：保持 undefined 走首字。注意不能构造 user_<accountId>
        // 别名 URL —— 服务端 thumb 路由只认真实 media id（ResolveServingPath
        // 直接 GetAsset），别名必 404，一张必坏的图还不如首字。
        done(undefined);
        return;
      }
      // 1) 本机文件命中直接用（离线可读，无需网络）。
      const name = avatarFileName(stored);
      try {
        const names = new Set(FEED_AVATAR_DIR.list().map((entry) => entry.name));
        if (names.has(name)) {
          done(new File(FEED_AVATAR_DIR, name).uri);
          return;
        }
      } catch {
        // 目录不可读：往下走远端回退，不崩。
      }
      // 2) 本地记录里的远端指针（重装后文件没了、keychain 记录还在的情形）。
      // FEED-AVATAR-REMOTE-001: 指针与本机文件名分开存（profileStore.remoteAvatarPath），
      // 远端 assets/<mediaId> 永远对不上 avatar-<ts>.jpg —— 对不上就回退服务端
      // thumb（与个人主页同一张），不留黑头。
      const known = thumbOf(record?.remoteAvatarPath ?? "");
      if (known) {
        done(known);
        return;
      }
      // 3) 现场向服务端要回远端指针（与个人主页同一张），并写回记录自愈 ——
      // 下次连这一步都省了。拿不到就首字，不黑头。
      if (profileClient && viewerAccountId) {
        try {
          const remote = await profileClient.getProfile(viewerAccountId);
          if (!active) return;
          if (remote.avatarPath) {
            const existing = await feedProfileStore.read().catch(() => undefined);
            if (existing) {
              void feedProfileStore.write({ ...existing, remoteAvatarPath: remote.avatarPath }).catch(() => undefined);
            }
          }
          done(thumbOf(remote.avatarPath));
          return;
        } catch {
          // 远端也拿不到：往下走首字。
        }
      }
      done(undefined);
    }).catch(() => { if (active) setViewerAvatarLoaded(true); });

    const aiTask = aiAccountsClient ? aiAccountsClient.listRecommended().then((accounts) => {
      if (!active) return;
      setAiAccountsById(new Map(accounts.map((account) => [account.accountId, {
        accountId: account.accountId,
        personaId: account.personaId,
        avatarPath: account.avatarPath,
        avatarMediaAssetId: account.avatarMediaAssetId,
        avatarVersion: account.avatarVersion
      }])));
    }).catch(() => undefined) : Promise.resolve();

    Promise.all([avatarTask, aiTask]).catch(() => undefined);
    return () => { active = false; };
  }, [feedProfileStore, aiAccountsClient, profileClient, viewerAccountId]);
  // MEDIA-PIPELINE-001: AI 账号目录已在上方并行初始化（启动优化），此处仅保留状态。
  const [aiAccountsById, setAiAccountsById] = useState<ReadonlyMap<string, AvatarAccount>>(new Map());
  function isOwnPost(post: FeedPost): boolean {
    // FEED-OWN-001: strict author-id check only. Unknown viewer is
    // fail-closed (never own); display-name matching is forbidden.
    return isOwnPostById(post, viewerAccountId);
  }
  const [mediaPositions, setMediaPositions] = useState<Record<string, number>>({});
  const [customFeedHubOpen, setCustomFeedHubOpen] = useState(false);
  const [selectedCustomFeed, setSelectedCustomFeed] = useState<string | null>(null);
  // 推荐偏好（偏好页写入）：静音主题硬过滤、时间范围过滤、权重重排。
  // 前台恢复时重读，偏好页改完回来即生效。
  // SYNC-FS-001: File.json() 异步，mount/前台时异步 hydration，首屏先用默认。
  const [feedPrefs, setFeedPrefs] = useState(defaultFeedPrefs);
  useEffect(() => {
    let cancelled = false;
    void readFeedPrefsAsync().then((prefs) => { if (!cancelled) setFeedPrefs(prefs); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  // 自定频道定义（name/desc）：AI 生成的频道用它切词过滤 + 横幅显示真名，
  // 而不是裸 id。读本地持久化，与 CustomFeedHub 同源。
  const [storedCustomFeeds, setStoredCustomFeeds] = useState<CustomFeed[]>([]);
  useEffect(() => {
    let cancelled = false;
    void readCustomFeedsAsync([]).then((feeds) => { if (!cancelled) setStoredCustomFeeds(feeds); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [customFeedHubOpen]);
  const customFeedDef = useMemo(() => {
    if (!selectedCustomFeed) return undefined;
    return storedCustomFeeds.find((f) => f.id === selectedCustomFeed);
  }, [selectedCustomFeed, storedCustomFeeds]);
  const customFeedTokens = useMemo(() => {
    if (!customFeedDef) return [];
    return `${customFeedDef.name} ${customFeedDef.desc}`
      .split(/[\s\/·,，、。!！?？:：;；]+/)
      .map((t) => t.trim().toLocaleLowerCase())
      .filter((t) => t.length >= 2);
  }, [customFeedDef]);
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
  // (scroll-chrome state now lives in useScrollChrome — see shell/scroll-chrome.ts)
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

  // SCROLL-CHROME-001: shared controller (see shell/scroll-chrome.ts). The local
  // copy fed on its own layout change: hiding chrome shrank the bottom padding,
  // the clamped offset produced an upward delta, and the chrome came straight
  // back — an oscillation near the end of the list.
  const scrollChrome = useScrollChrome(onChromeVisibilityChange);
  function onFeedScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { y, action } = scrollChrome(event);
    setScrollY(y);
    if (y <= 48) setStickyHeaderVisible(false);
    else if (action === "show") setStickyHeaderVisible(true);
    else if (action === "hide") setStickyHeaderVisible(false);
    const { contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentSize.height - (y + layoutMeasurement.height) < 900) {
      void loadMoreFeed();
    }
  }

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

  const loadFeed = useCallback(async (rawQuery?: string): Promise<void> => {
    // 动态帖文与地址解绑：帖文不按 viewingCity 过滤，地址仅作 Status/社区等筛选项
    //
    // SEARCH-CORPUS-001: 带查询时走**服务端**搜索（server listFeed 接 search 字段），
    // 这样搜索覆盖整个 feed 语料，而不是「你已经滚过的那几页」。修之前
    // listFeedPosts 的 searchQuery 参数全仓无人传，搜索只在本地对已加载的
    // 帖做子串匹配 —— 搜「人」只能搜到恰好滚过的几条。
    const search = normalizeFeedSearchQuery(rawQuery);
    const searching = search !== "";
    if (cachedPosts.length === 0) {
      setPhase("LOADING");
    }
    try {
      const read = await localNet.listFeedPosts(undefined, searching ? 50 : 25, searching ? search : undefined);
      // 搜索结果不是 feed 本身：写回模块级缓存会让退出搜索后（以及冷启动读盘时）
      // 看到的是上次的搜索结果，所以只在非搜索加载时更新缓存与磁盘缓存。
      if (!searching) {
        cachedPosts = read.posts;
        cachedMedia = read.media;
        cachedPostIds = new Set(read.posts.map((p) => p.postId));
        postIdsRef.current = cachedPostIds;
        writeFeedDiskCache(read.posts, read.media);
      }
      setPosts(read.posts);
      setMedia(read.media);
      setNextCursor(read.nextCursor);
      setHasMore(read.hasMore);
      feedRetryAttemptRef.current = 0;
	  setPhase("READY");
	  void hydrateEngagement(read.posts);
    } catch (error) {
      console.error("[proxy.feed] public feed load failed", error, (error as Error)?.message, (error as Error)?.stack);
      feedRetryAttemptRef.current += 1;
      setLastFeedError(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      (global as any).__lastFeedError = error;
      // A transient API restart must not blank an already hydrated timeline.
      setPhase(cachedPosts.length > 0 ? "READY" : "ERROR");
    }
  }, [localNet]);

  async function loadMoreFeed(): Promise<void> {
    if (!hasMore || !nextCursor || loadingMoreRef.current || phase !== "READY") return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    // SEARCH-CORPUS-001: 搜索中翻的是**搜索结果**的下一页，游标来自搜索响应，
    // 所以必须把同一个查询带上，否则第二页会悄悄变回未过滤的全量。
    const search = lastSearchRef.current;
    try {
      const read = await localNet.listFeedPosts(nextCursor, search === "" ? 25 : 50, search === "" ? undefined : search);
      if (search !== "") {
        // 搜索结果不进模块级缓存/磁盘缓存，避免退出搜索后 feed 被搜索结果污染。
        setPosts((prev) => {
          const known = new Set(prev.map((post) => post.postId));
          return [...prev, ...read.posts.filter((post) => !known.has(post.postId))];
        });
        setMedia((prev) => ({ ...prev, ...read.media }));
        setNextCursor(read.nextCursor);
        setHasMore(read.hasMore);
        void hydrateEngagement(read.posts);
        return;
      }
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
	  void hydrateEngagement(appended);
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
    // SEARCH-CORPUS-001: 搜索中不做「N 条新动态」合并 —— 它拿的是**未过滤**的首屏，
    // 合并进来会让搜索结果凭空多出无关帖（点「展示最新」更是直接退出搜索）。
    if (lastSearchRef.current !== "") return;
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
      if (state === "active") void readFeedPrefsAsync().then(setFeedPrefs).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [phase, loadFeed]);

  // SEARCH-CORPUS-001: 输入搜索词后走服务端搜索（防抖 250ms），清空则立刻恢复全量。
  // 只在「查询真的变了」时触发，免得 mount 时把首屏那次 loadFeed 又打一遍。
  // 注意这里不写入模块级缓存 —— loadFeed 自己会区分搜索与非搜索。
  useEffect(() => {
    const query = normalizeFeedSearchQuery(searchQuery);
    if (query === lastSearchRef.current) return;
    lastSearchRef.current = query;
    const timer = setTimeout(() => void loadFeed(query), query === "" ? 0 : 250);
    return () => clearTimeout(timer);
  }, [searchQuery, loadFeed]);

  // 点击"展示最新"：将 pending 内容刷入正式列表
  function showLatest(): void {
    // SEARCH-CORPUS-001: 搜索中不存在「展示最新」—— pendingPosts 是未过滤的全量，
    // 合并进来等于静默退出搜索，而且会把搜索结果写进 feed 缓存。
    if (lastSearchRef.current !== "") return;
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
      setEngagementError(mapEngagementError(error, "互动没有提交成功，请检查连接后重试。"));
    } finally {
      setEngagementBusy((value) => {
        const next = new Set(value);
        next.delete(busyKey);
        return next;
      });
    }
  }

	async function hydrateEngagement(items: FeedPost[]): Promise<void> {
	  const settled = await Promise.all(items.map(async (post) => {
		try { return await engagement.getPostEngagement(post.postId); } catch { return undefined; }
	  }));
	  const available = settled.filter((item): item is PostEngagement => item !== undefined);
	  if (available.length === 0) return;
	  setPostEngagement((previous) => mergePostEngagement(previous, available));
	  setLiked((previous) => mergeReactedPostIds(previous, available));
	  // FEED-REPLY-002: 评论不再全折叠。帖子一进列表就把评论拉下来，首屏直接
	  // 显示前 5 条；只拉有评论的帖子，且每个帖子只拉一次。
	  for (const item of available) {
		if (item.replies > 0) void hydrateReplyPreviews(item.postId);
	  }
	}

	async function hydrateReplyPreviews(postId: string): Promise<void> {
	  if (requestedRepliesRef.current.has(postId)) return;
	  requestedRepliesRef.current.add(postId);
	  try {
		const listed = await engagement.listPostReplies(postId);
		setPostReplies((previous) => ({ ...previous, [postId]: listed.replies }));
	  } catch {
		// 拉不到就允许下次再试，但不要因为一条评论炸掉整屏。
		requestedRepliesRef.current.delete(postId);
	  }
	}

	function toggleReplies(postId: string): void {
	  setExpandedReplies((previous) => {
		const next = new Set(previous);
		if (next.has(postId)) next.delete(postId); else next.add(postId);
		return next;
	  });
	}

	async function toggleLike(postId: string): Promise<void> {
	  const busyKey = `like:${postId}`;
	  if (engagementBusy.has(busyKey)) return;
	  setEngagementBusy((value) => new Set(value).add(busyKey));
	  setEngagementError(undefined);
	  try {
		const truth = await engagement.reactToPost(postId, "LIKE", !liked.has(postId));
		setPostEngagement((previous) => mergePostEngagement(previous, [truth]));
		setLiked((previous) => mergeReactedPostIds(previous, [truth]));
	  } catch (error) {
		setEngagementError(mapEngagementError(error, "点赞没有提交成功，请检查连接后重试。"));
	  } finally {
		setEngagementBusy((value) => { const next = new Set(value); next.delete(busyKey); return next; });
	  }
	}

	/**
	 * POLL-VOTE-001 — 投一票，并**整体替换**这条帖子的投票读模型。
	 *
	 * 为什么用服务端返回的结果整体替换、而不是在本地给某个选项 +1：
	 * 一人一票意味着「改票」是常态 —— 投过 A 再投 B，本地得同时给 A 减一、
	 * B 加一，还得知道之前投的是哪个。任何一步猜错，用户看到的百分比就跟
	 * 服务端对不上，而投票结果恰好是最不该被怀疑的东西。服务端本来就把最新
	 * 票数算好了回给我们，直接用。
	 */
	async function votePoll(postId: string, optionId: string): Promise<void> {
	  const busyKey = `poll:${postId}`;
	  if (engagementBusy.has(busyKey)) return;
	  setEngagementBusy((value) => new Set(value).add(busyKey));
	  setEngagementError(undefined);
	  try {
		const poll = await engagement.votePostPoll(postId, optionId);
		applyPoll(postId, poll);
	  } catch (error) {
		setEngagementError(mapEngagementError(error, "投票没有提交成功，请稍后重试。"));
	  } finally {
		setEngagementBusy((value) => { const next = new Set(value); next.delete(busyKey); return next; });
	  }
	}

	/** 把一份新的投票读模型写回 posts（pending 列表里也可能有同一条帖子）。 */
	function applyPoll(postId: string, poll: PostPollView): void {
	  setPosts((previous) => previous.map((post) => (post.postId === postId ? { ...post, poll } : post)));
	  setPendingPosts((previous) => previous.map((post) => (post.postId === postId ? { ...post, poll } : post)));
	}

	async function openReplies(postId: string): Promise<void> {
	  setReplyTargetId(postId);
	  setReplyDraft("");
	  setExpandedReplies((previous) => new Set(previous).add(postId));
	  try {
		const listed = await engagement.listPostReplies(postId);
		setPostReplies((previous) => ({ ...previous, [postId]: listed.replies }));
	  } catch (error) {
		setEngagementError(mapEngagementError(error, "评论暂时无法读取，请稍后重试。"));
	  }
	}

  async function submitReply(): Promise<void> {
    if (!replyTargetId || !replyDraft.trim() || replying) return;
    setReplying(true);
    setEngagementError(undefined);
    try {
	  const postId = replyTargetId;
	  await engagement.replyToPost(postId, replyDraft);
	  const [truthResult, listResult] = await Promise.allSettled([engagement.getPostEngagement(postId), engagement.listPostReplies(postId)]);
	  if (truthResult.status === "fulfilled") setPostEngagement((previous) => mergePostEngagement(previous, [truthResult.value]));
	  if (listResult.status === "fulfilled") {
		setPostReplies((previous) => ({ ...previous, [postId]: listResult.value.replies }));
		setPostEngagement((previous) => previous[postId] ? ({ ...previous, [postId]: { ...previous[postId], replies: listResult.value.count } }) : previous);
	  }
	  setExpandedReplies((previous) => new Set(previous).add(postId));
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

  // R15.69 (restored): 点头像弹 关注/访问个人主页 菜单 — 头像 onPress 触发,
  // 名字 onPress 走 onOpenProfile 直接访问
  async function openProfileActions(target: NonNullable<typeof profileActions>): Promise<void> {
    setProfileActions(target);
    setProfileFollowing(following.has(target.userId));
  }
  async function toggleProfileFollow(): Promise<void> {
    if (!profileActions || profileFollowBusy) return;
    // SELF-FOLLOW-001: 本人不显示「关注」，这里再兜一道，免得将来 UI 改动把它露出来。
    // 服务端同样拒绝自关注（CANNOT_FOLLOW_SELF），两层都 fail-closed。
    if (isOwnAuthorId(profileActions.userId, viewerAccountId)) return;
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
      setEngagementError(mapFollowError(error, profileFollowing ? "unfollow" : "follow"));
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

  function mediaFor(postId: string): FeedMediaItem[] {
    return (media[postId] ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function findQuote(post: FeedPost): FeedPost | undefined {
    const ref = post.contextRefs.find((entry) => entry.contextType === "QUOTE_POST");
    if (!ref) return undefined;
    return posts.find((candidate) => candidate.postId === ref.contextId);
  }

  // 偏好权重归一：帖子→偏好类别→权重分（缺省 50）。只用于排序。
  function feedWeightFor(post: FeedPost): number {
    const ctxTypes = new Set(post.contextRefs.map((r) => r.contextType));
    let category = "lifestyle";
    if (isOpportunityPost(post)) category = "opportunity";
    else if (ctxTypes.has("ACTIVITY")) category = "activity";
    else if (post.authorType === "MERCHANT") category = "commercial";
    else if (ctxTypes.has("INDUSTRY_INFO") || ctxTypes.has("VENUE")) category = "intelligence";
    else if (post.authorType === "USER" || ctxTypes.has("PEOPLE_RELATIONSHIP")) category = "people";
    return feedPrefs.weights[category] ?? 50;
  }

  // `scope` is a parameter (not feedPrefs.scope) so the banner can ask "how many
  // posts would I see without the time filter?" using the exact same predicate —
  // the count and the filter can never drift apart again.
  const getVisibleForTab = (forTab: FeedTab, scope: FeedScope = feedPrefs.scope): FeedPost[] =>
    posts.filter((post) => {
      if (hiddenPosts.has(post.postId)) return false;
      // 偏好-时间范围：7D/30D 按创建时间过滤，长期不过滤（FEED-SCOPE-001）。
      if (!isPostWithinScope(post.createdAt, scope)) return false;
      // 偏好-不想看：主题切词命中正文/上下文/作者即隐藏。
      if (feedPrefs.muted.length > 0) {
        const haystack = [resolveAuthorDisplayName(post, viewerAccountId), post.body, ...post.contextRefs.map((entry) => entry.contextId)]
          .filter((value): value is string => typeof value === "string")
          .join(" ")
          .toLocaleLowerCase();
        const hit = feedPrefs.muted.some((topic) =>
          topic.split(/[\s\/]+/).map((t) => t.trim().toLocaleLowerCase()).filter((t) => t.length >= 2)
            .some((token) => haystack.includes(token)));
        if (hit) return false;
      }
      if (forTab === "FOLLOWING") {
      if (!(following.has(post.authorId) || isOwnPost(post))) return false;
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
        friends: (p) => following.has(p.authorId) || isOwnPost(p),
        hanoi: (p) => p.cityScope === "hn",
        photo: (p) => p.contextRefs.some((r) => r.contextId.includes("摄影") || r.contextId.includes("拍照")),
        opportunity: isOpportunityPost,
        merchant: (p) => p.authorType === "MERCHANT",
        startup: (p) => p.contextRefs.some((r) => r.contextId.includes("创业") || r.contextId.includes("AI"))
      };
      const checker = feedMap[selectedCustomFeed];
      if (checker) {
        if (!checker(post)) return false;
      } else if (customFeedTokens.length > 0) {
        // AI 生成的自定频道（id=ai_…）：内置 feedMap 没有规则，
        // 用频道名+描述切词做本地过滤；之前直接看全部。
        const haystack = [resolveAuthorDisplayName(post, viewerAccountId), post.body, ...post.contextRefs.map((entry) => entry.contextId)]
          .filter((value): value is string => typeof value === "string")
          .join(" ")
          .toLocaleLowerCase();
        if (!customFeedTokens.some((token) => haystack.includes(token))) return false;
      }
    }
    // SEARCH-CORPUS-003: 搜索结果**由服务端判定**，本地不再重跑谓词。
    //
    // 这里以前会用 ./feed-search 的共享谓词再滤一遍（SEARCH-CORPUS-001）。那在
    // 「搜索字段只有正文 / 作者名 / 城市」时是成立的：这些字段客户端全都看得到，
    // 两端语义可以严格一致，本地那一遍只是兜底。
    //
    // 评论进搜索之后就不成立了：客户端一次只拉到前 20 条评论，服务端看的是全部。
    // 本地再滤一遍只会**比服务端更窄** —— 靠第 21 条评论命中的帖子会被客户端
    // 丢掉，表现就是「服务端明明匹配了，列表里却没有」，正是 SEARCH-CORPUS-001
    // 修的那个病换了个地方复发。
    //
    // 所以搜索态下不再本地过滤。谓词的唯一实现仍在 ./feed-search
    // （个人主页那一屏数据全在本地，用它），这里只是不再拿它去覆盖服务端。
    return true;
  });
  // 偏好-权重：只重排不隐藏。类别按帖子属性归一后取权重分，
  // V8 sort 稳定，同分保持服务端顺序。
  const unranked = getVisibleForTab(tab);
  const scored = unranked.map((post, index) => ({ post, index, score: feedWeightFor(post) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const visible = scored.map((entry) => entry.post);
  // FEED-SCOPE-001: 时间范围是相对 Date.now() 滚动的，帖文会一天天无声消失 ——
  // 实测默认 7D 隐藏了 62% 的帖文，而时间线上没有任何提示，看起来就是「数据丢了」。
  // 生效时把「正在筛选」和「藏了多少」摆出来，并给一个一键看全部的出口。
  const scopeHiddenCount = isFeedScopeActive(feedPrefs.scope)
    ? getVisibleForTab(tab, "PERSISTENT").length - unranked.length
    : 0;
  const clearScopeFilter = useCallback(() => {
    const next = { ...feedPrefs, scope: "PERSISTENT" as const };
    setFeedPrefs(next);
    writeFeedPrefs(next);
  }, [feedPrefs]);
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
      // REPLY-INLINE-001: 回复框内联在帖子下方，键盘弹起时必须把它顶进可见区。
      // 以前整个 feed 没有任何键盘避让（也没有 KeyboardAvoidingView），而回复框
      // 又是一个贴在屏幕底部的 Modal —— 键盘一弹正好把它盖住，用户是在盲打。
      //   - automaticallyAdjustKeyboardInsets：键盘出现时收 ScrollView 的
      //     contentInset，聚焦的输入框才会被滚进可见区（只调 inset 不会自动滚）。
      //   - keyboardShouldPersistTaps="handled"：不加这个，键盘开着时第一次点
      //     「发送」只会被当成“收起键盘”，按钮根本点不动。
      //   - on-drag：往下拖即可收键盘，符合流媒体 App 的手感。
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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

      {scopeHiddenCount > 0 ? (
        <View style={styles.scopeBanner} testID="feed-scope-banner-v1">
          <Text style={styles.scopeBannerText}>
            正在按「{feedScopeLabel(feedPrefs.scope)}」筛选 · 已隐藏 {scopeHiddenCount} 篇更早的
          </Text>
          <Pressable accessibilityLabel="显示全部帖文" onPress={clearScopeFilter}>
            <Text style={styles.scopeBannerAction}>显示全部</Text>
          </Pressable>
        </View>
      ) : null}

      {section === "STATUS" ? (
        <StatusFeed client={socialSpace} onReply={onOpenChat} viewerAccountId={viewerAccountId} />
      ) : section === "COMMUNITY" ? (
        <CommunityHub client={socialSpace} />
      ) : (
      <>
      {selectedCustomFeed ? (
        <View style={styles.customFeedBanner}>
          <Text style={styles.customFeedBannerText}>定制频道 · {CUSTOM_FEED_LABELS[selectedCustomFeed] ?? customFeedDef?.name ?? selectedCustomFeed}</Text>
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
        viewerAccountId={viewerAccountId}
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
          const name = resolveAuthorDisplayName(post, viewerAccountId);
          // MEDIA-PIPELINE-001: 头像走统一管线（本人/AI 账号/AI 人像/首字）。
          const avatar = resolveAuthorAvatar(
            { authorType: post.authorType, authorId: post.authorId },
            { baseUrl: localApiBaseUrl, viewerAccountId, viewerAvatarUri: isOwnPost(post) ? viewerAvatarUri : undefined, avatarSource: isOwnPost(post) ? viewerAvatarUri ? { uri: viewerAvatarUri } : undefined : undefined, aiAccountsById, displayName: name }
          );
          const meta = AUTHOR_TYPE_META[post.authorType];
          const isFollow = following.has(post.authorId);
          const isLiked = liked.has(post.postId);
		  const isSaved = bookmarked.has(post.postId);
		  const truth = postEngagement[post.postId];
		  // FEED-REPLY-002: 评论默认展开前 5 条，超出才折叠；不再「全折叠」。
		  const replies = postReplies[post.postId] ?? [];
		  const repliesExpanded = expandedReplies.has(post.postId);
		  // SEARCH-CORPUS-003: 搜索时把命中的评论排到前面，否则「这条为什么在
		  // 结果里」没有答案 —— 命中的那条可能正好在被折叠的第 17 条。
		  const replyQuery = normalizeFeedSearchQuery(searchQuery);
		  const orderedReplies = replyQuery === ""
		    ? replies
		    : repliesMatchingFirst(replies, (reply) => reply.body.toLowerCase().includes(replyQuery));
		  const shownReplies = visibleReplies(orderedReplies, repliesExpanded);
		  const collapsedReplies = hiddenReplyCount(replies.length);
		  const offerReplyToggle = shouldOfferReplyToggle(replies.length);
          const chips = post.contextRefs.filter((entry) => entry.contextType !== "QUOTE_POST");
          const isCityCompanion = post.authorType === "AGENT";
          return (
            <View
              key={post.postId}
              style={styles.postCard}
              onLayout={(event) => { const ly = event?.nativeEvent?.layout; if (ly) setCardYs((prev) => ({ ...prev, [post.postId]: ly.y })); }}
            >
              {/* posthead — R15.69 (restored) 拆头像/名字为 2 个 Pressable:
                  点头像 弹 关注/访问个人主页 菜单 (openProfileActions),
                  点名字 直接访问个人主页 (onOpenProfile). */}
              <View style={styles.postHead}>
                <Pressable
                  accessibilityLabel={`${name} 的操作`}
                  onPress={(event) => void openProfileActions({ userId: post.authorId, name, city: post.cityScope, posts: posts.filter((candidate) => candidate.authorId === post.authorId), mediaByPost: media, anchor: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY } })}
                  style={styles.postAvatarPressable}
                >
                  <View style={styles.postAvatarWrap}>
                  <View style={styles.postAvatarClip}>
                    {isOwnPost(post) && !viewerAvatarLoaded && viewerAvatarUri === undefined ? (
                      // AVATAR-FLASH-001: 头像还没算出来时不画 #111 黑底占位 ——
                      // 那个"黑头闪一下再换照片"就是它。透明占位同尺寸，不抖。
                      <View style={[styles.postAvatar, { backgroundColor: "transparent" }]} />
                    ) : avatar.kind === "image" ? (
                      <CircularAvatarImage accessibilityLabel={`${name}头像`} size={44} source={avatar.source} />
                    ) : (
                      <View style={styles.postAvatar}>
                        <Text style={styles.postAvatarText}>{avatar.letter}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.scenarioBadge}>
                    <ProxyIcon color={color.violet} name={scenarioIconForPost(post)} size={10} />
                  </View>
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
                  {meta.aiBadge ? <Text style={styles.aiBadge}>AI生成</Text> : null}
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
                    <Pressable disabled={entry.contextType !== "REALITY_SCENE" || !onOpenRealityScene} onPress={() => onOpenRealityScene?.(entry.contextId)} key={`${entry.contextType}_${entry.contextId}`} style={[styles.contextRef, index === 0 && styles.contextRefStrong]}>
                      <Text style={[styles.contextRefText, index === 0 && styles.contextRefTextStrong]}>{entry.contextType === "REALITY_SCENE" ? "查看场景 ›" : entry.contextId}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* X 式引用帖文（quote card：服务端 contextRef QUOTE_POST） */}
              {quoted ? (
                <View style={styles.quoteCard}>
                  <View style={styles.quoteHead}>
                    <View style={styles.quoteAvatar}>
                      <Text style={styles.quoteAvatarText}>{resolveAuthorDisplayName(quoted, viewerAccountId).charAt(0)}</Text>
                    </View>
                    <Text style={styles.quoteAuthor}>{resolveAuthorDisplayName(quoted, viewerAccountId)}</Text>
                    <Text style={styles.quoteMeta}>引用帖文</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.quoteBody}>{quoted.body}</Text>
                  {mediaFor(quoted.postId)[0] ? <Text style={styles.quoteMediaLabel}>🎞 含媒体附件</Text> : null}
                </View>
              ) : null}

              {/* POLL-VOTE-001 — 帖内投票。 */}
              {post.poll ? (
                <PollCard
                  busy={engagementBusy.has(`poll:${post.postId}`)}
                  poll={post.poll}
                  onVote={(optionId) => void votePoll(post.postId, optionId)}
                />
              ) : null}

              {/* postactions：♡ / 回复 / 引用 / 收藏 / 分享 / ···(更多) */}
              <View style={styles.postActions}>
			<Pressable disabled={engagementBusy.has(`like:${post.postId}`)} onPress={() => void toggleLike(post.postId)} style={styles.postAction}>
			  <Text style={[styles.postActionText, isLiked && styles.postActionOn]}>
				{isLiked ? "♥" : "♡"} {truth?.reactions ?? 0}
			  </Text>
			</Pressable>
			<Pressable onPress={() => void openReplies(post.postId)} style={styles.postAction}>
			  <Text style={styles.postActionText}>回复 {truth?.replies ?? 0}</Text>
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
		  {shownReplies.length > 0 ? (
			<View style={styles.postReplies}>
			  {shownReplies.map((reply) => (
				<View key={reply.replyId} style={styles.postReply}>
				  {/* FEED-REPLY-001: 显示作者名，绝不回显 actorId。 */}
				  <Text style={styles.postReplyAuthor}>{resolveReplyAuthorDisplayName(reply, viewerAccountId)}</Text>
				  <Text style={styles.postReplyBody}>{reply.body}</Text>
				</View>
			  ))}
			  {offerReplyToggle && !repliesExpanded ? (
				<Pressable accessibilityLabel="查看全部回复" hitSlop={8} onPress={() => toggleReplies(post.postId)}>
				  <Text style={styles.postRepliesMore}>查看其余 {collapsedReplies} 条回复</Text>
				</Pressable>
			  ) : null}
			  {offerReplyToggle && repliesExpanded ? (
				<Pressable accessibilityLabel="收起回复" hitSlop={8} onPress={() => toggleReplies(post.postId)}>
				  <Text style={styles.postRepliesMore}>收起回复</Text>
				</Pressable>
			  ) : null}
			</View>
		  ) : null}

              {/* REPLY-INLINE-001：回复框内联在这条帖子下方。
                  点「回复」就地展开一行输入框，无遮罩、无上滑动画。
                  以前它是一个 <Modal> + justifyContent:"flex-end" 的底部白卡
                  （还带「回复帖文」标题），而且整个 feed 没有任何键盘避让 ——
                  键盘一弹正好把贴在底部的输入框盖住。 */}
              {replyTargetId === post.postId ? (
                <View style={styles.inlineReply}>
                  <TextInput
                    autoFocus
                    maxLength={500}
                    multiline
                    onChangeText={setReplyDraft}
                    onSubmitEditing={() => { if (replyDraft.trim() && !replying) void submitReply(); }}
                    placeholder={`回复 ${name}…`}
                    placeholderTextColor={color.muted}
                    style={styles.inlineReplyInput}
                    value={replyDraft}
                  />
                  <View style={styles.inlineReplyActions}>
                    <Pressable
                      accessibilityLabel="取消回复"
                      hitSlop={8}
                      onPress={() => { setReplyTargetId(null); setReplyDraft(""); }}
                      style={styles.inlineReplyCancel}
                    >
                      <Text style={styles.inlineReplyCancelText}>取消</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="发送回复"
                      disabled={!replyDraft.trim() || replying}
                      onPress={() => void submitReply()}
                      style={[styles.inlineReplySend, (!replyDraft.trim() || replying) && styles.disabled]}
                    >
                      <Text style={styles.inlineReplySendText}>{replying ? "发送中…" : "发送"}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {/* postintent（基线文案）：城市同行动态 → 聊一下 / 按这个想法找同行 */}
              {isCityCompanion ? (
                <View style={styles.postIntent}>
                  <Pressable onPress={() => onOpenChat(name)} style={styles.intentChat}>
                    <Text style={styles.intentChatText}>聊一下</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      // 按这个想法找同行：用帖子的首个上下文主题（没有则取正文前 8 字）
                      // 打开动态搜索并填入，列表即按该想法过滤——之前与“聊一下”完全同行为。
                      const idea = post.contextRefs[0]?.contextId ?? post.body.slice(0, 8);
                      setSearchOpen(true);
                      setSearchQuery(idea);
                    }}
                    style={styles.intentNeed}
                    accessibilityLabel="按这个想法找同行"
                  >
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
          author={resolveAuthorDisplayName(viewerPost, viewerAccountId)}
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
      <Pressable accessibilityLabel={composerOpen ? "关闭发布器" : "发布帖文"} onPress={toggleEmbeddedComposer} style={[styles.feedFab, { bottom: bottomNavVisible === false ? 28 : 116 }]}>
        <Text style={styles.feedFabText}>{composerOpen ? "×" : "＋"}</Text>
      </Pressable>
    ) : null}
    {/* R15.45: post menu modal (举报 / 不感兴趣 / 屏蔽作者) */}
    <PostMenuModal
      open={postMenuPostId !== undefined}
      post={postMenuPost}
      error={postMenuError}
      onClose={closePostMenu}
      onReport={handleReportPost}
      onNotInterested={handleNotInterested}
      onMuteAuthor={handleMuteAuthor}
    />
    {/* R15.69 (restored): 点头像弹 关注/访问个人主页 菜单 (双行上下排) */}
    <Modal transparent animationType="fade" visible={profileActions !== undefined} onRequestClose={() => setProfileActions(undefined)}>
      <Pressable onPress={() => setProfileActions(undefined)} style={styles.profileActionOverlay}>
        <GlassContainer spacing={8} style={[styles.profileGlassContainer, { left: Math.max(12, Math.min(viewportWidth - 200, (profileActions?.anchor.x ?? 24) - 28)), top: (profileActions?.anchor.y ?? 80) + 20 }]}>
          {/* SELF-FOLLOW-001: 自己的帖子不显示「关注」——关注自己没有意义，后端也会
              拒绝（CANNOT_FOLLOW_SELF）。未知 viewer 沿用既有约定 fail-closed
              （当作不是自己），所以只有明确是自己时才隐藏这一行。 */}
          {profileActions && !isOwnAuthorId(profileActions.userId, viewerAccountId) ? (
            <GlassView glassEffectStyle="clear" isInteractive style={styles.profileGlassDropFull}>
              <Pressable disabled={profileFollowBusy} onPress={(event) => { event.stopPropagation(); void toggleProfileFollow(); }} style={styles.profileDropPress}><Text style={styles.profileDropText}>{profileFollowBusy ? "处理中…" : profileFollowing ? "✓ 已关注" : "+ 关注"}</Text></Pressable>
            </GlassView>
          ) : null}
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
  // 与市场 + 号同式：ink 底 54×54，底栏显隐跟随（116/28）。
  feedFab: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 27,
    height: 54,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    width: 54,
    ...shadows.card
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
  scopeBanner: { alignItems: "center", backgroundColor: color.warn, borderRadius: 10, flexDirection: "row", gap: 8, justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 10, paddingVertical: 6 },
  scopeBannerText: { color: color.ink, flexShrink: 1, fontSize: 11, fontWeight: "700" },
  scopeBannerAction: { color: color.ink, fontSize: 11, fontWeight: "700", textDecorationLine: "underline" },
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

  // REPLY-INLINE-001 — 内联回复框：贴着帖子下方就地展开，不再是底部白卡。
  // 没有遮罩、没有标题、没有上滑动画，也不占 minHeight 108 那种厚卡片高度；
  // 单行起步、随输入长高（maxHeight 兜底），手感对齐 Threads / Instagram。
  inlineReply: {
    backgroundColor: "#F8F5FA",
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    padding: 10
  },
  inlineReplyInput: {
    color: color.ink,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 132,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top"
  },
  inlineReplyActions: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 6 },
  inlineReplyCancel: { paddingHorizontal: 6, paddingVertical: 6 },
  inlineReplyCancelText: { color: color.muted, fontSize: 12, fontWeight: "700" },
  inlineReplySend: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  inlineReplySendText: { color: color.white, fontSize: 12, fontWeight: "800" },

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
  // R15.69 (restored): 拆头像/名字 2 个 Pressable, 头像 = 弹 关注菜单, 名字 = 直接访个人主页
  postAvatarPressable: { alignItems: "center" },
  postIdentityPressable: { alignItems: "flex-start", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },
  // R15.69 (restored): 关注/访问主页 菜单 (双行上下排) — 200 宽 + 44 行高 + 24 圆角
  profileActionOverlay: { backgroundColor: "rgba(20,18,31,0.32)", flex: 1 },
  profileGlassContainer: { flexDirection: "column", gap: 8, position: "absolute", width: 200 },
  profileGlassDropFull: { borderRadius: 14, height: 44, overflow: "hidden", width: 200 },
  profileDropPress: { alignItems: "center", height: "100%", justifyContent: "center", paddingHorizontal: 12, width: "100%" },
  profileDropText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  postAvatarWrap: { height: 44, position: "relative", width: 44 },
  postAvatarClip: { borderRadius: 22, height: 44, overflow: "hidden", width: 44 },
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
  engagementError: { color: color.magenta, fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  engagementNotice: { color: "#53651A", fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  postIdentity: { flex: 1, minWidth: 0 },
  postNameLine: { alignItems: "center", flexDirection: "row", gap: 6, minWidth: 0 },
  postName: { color: color.ink, fontSize: 13, fontWeight: "700" },
  postMeta: { color: color.muted, fontSize: 11 },
  aiBadge: { alignSelf: "flex-start", backgroundColor: "#F4F0FF", borderRadius: 6, color: "#5B3FA3", fontSize: 10, fontWeight: "700", marginTop: 2, paddingHorizontal: 6, paddingVertical: 2 },
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
  // POLL-VOTE-001 — 投票卡片。浅色底 + 描边，跟引用卡同一套卡片语言。
  pollCard: { gap: 6, marginVertical: 7 },
  pollOption: {
    backgroundColor: "#F5F1F7",
    borderColor: "#E8E0EC",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: "relative"
  },
  pollOptionMine: { backgroundColor: "#F0E7FF", borderColor: "#C9A6FF" },
  // 百分比条：绝对定位铺在选项底，宽度由票数比例给出。
  pollBar: { backgroundColor: "rgba(133,51,245,0.14)", bottom: 0, left: 0, position: "absolute", top: 0 },
  pollOptionRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  pollOptionLabel: { color: color.ink, flexShrink: 1, fontSize: 14 },
  pollOptionLabelMine: { color: "#5B2CB5", fontWeight: "700" },
  pollOptionCount: { color: color.muted, fontSize: 12 },
  pollOptionCountMine: { color: "#5B2CB5", fontWeight: "700" },
  pollMeta: { color: color.muted, fontSize: 11, marginTop: 2 },

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
	postReplies: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, gap: 8, paddingHorizontal: 4, paddingVertical: 10 },
	postReply: { flexDirection: "row", gap: 8 },
	postReplyAuthor: { color: color.ink, fontSize: 12, fontWeight: "800" },
	postReplyBody: { color: color.ink, flex: 1, fontSize: 13, lineHeight: 18 },
	// FEED-REPLY-002: 展开/收起控件。
	postRepliesMore: { color: color.muted, fontSize: 12, fontWeight: "700", paddingTop: 2 },
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

// ---------- POLL-VOTE-001: 帖内投票卡片 ----------

type PollCardProps = {
  poll: PostPollView;
  busy: boolean;
  onVote: (optionId: string) => void;
};

/**
 * 帖内投票卡片。
 *
 * 三条纪律，都不是审美问题：
 *  1. **投票前不显示票数**。先看到别人的选择会带节奏 —— 这是投票类 UI 的
 *     底线，不是可选项。
 *  2. **投过票或截止后一律显示结果**，而且截止后结果**必须**还能看。把结果
 *     一起藏掉，等于把投票变成一场没有开奖的抽奖。
 *  3. **未截止时永远可以改票**（服务端 UPSERT，一人一票）。所以这里禁用条件
 *     只有「已截止」和「请求进行中」，不包括「已经投过了」—— 否则界面写着
 *     "可改票" 却点不动，是典型的自相矛盾。
 *  4. closed 用服务端给的布尔值，**不**拿 expiresAt 跟本地时钟比：客户端时钟
 *     可能不准，而"到底还能不能投"只能以服务端为准。
 */
export function PollCard({ poll, busy, onVote }: PollCardProps): React.JSX.Element {
  const voted = Boolean(poll.votedOptionId);
  const showResults = voted || poll.closed;
  return (
    <View style={styles.pollCard}>
      {poll.options.map((option) => {
        const percent = poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
        const mine = poll.votedOptionId === option.optionId;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showResults ? `${option.label}，${option.voteCount} 票` : `投票给 ${option.label}`}
            disabled={poll.closed || busy}
            key={option.optionId}
            onPress={() => onVote(option.optionId)}
            style={[styles.pollOption, mine && styles.pollOptionMine]}
          >
            {showResults ? <View style={[styles.pollBar, { width: `${percent}%` }]} /> : null}
            <View style={styles.pollOptionRow}>
              <Text numberOfLines={2} style={[styles.pollOptionLabel, mine && styles.pollOptionLabelMine]}>
                {option.label}
              </Text>
              {showResults ? (
                <Text style={[styles.pollOptionCount, mine && styles.pollOptionCountMine]}>
                  {percent}% · {option.voteCount}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.pollMeta}>
        {poll.closed ? `已截止 · 共 ${poll.totalVotes} 票` : `共 ${poll.totalVotes} 票${voted ? " · 可改票" : ""}`}
      </Text>
    </View>
  );
}

// ---------- R15.45: PostMenuModal ----------

type PostMenuModalProps = {
  open: boolean;
  post: FeedPost | undefined;
  error: string | undefined;
  onClose: () => void;
  onReport: (reason: PostReportReason) => Promise<void> | void;
  onNotInterested: () => Promise<void> | void;
  onMuteAuthor: () => Promise<void> | void;
};

function PostMenuModal({ open, post, error, onClose, onReport, onNotInterested, onMuteAuthor }: PostMenuModalProps): React.JSX.Element {
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

// Feed Surface（稳定 Surface：动态 tab / LocalNet Feed）。
// 新架构（服务端驱动）：内容全部来自后端 ListFeedPosts 读模型（operationRef payload），
// 发布走 CreatePost 命令；前端不再内嵌内容 seed（首次空读模型时经 CreatePost 写入演示帖）。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
// （r153search + networktabs + feedfilterrail + preferencehint + postcard + mediaRail +
// postactions + postintent + feedfab），刻度按 R15.11 Social Baseline 对齐。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import ImageViewing from "react-native-image-viewing";
import { useVideoPlayer, VideoView } from "expo-video";
import * as ImagePicker from "expo-image-picker";
import type { CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type EngagementClient } from "../engagement-client";
import { type MarketplaceClient } from "../marketplace-client";
import { type MediaClient, type UploadableImage } from "../media-client";
import { isOpportunityPost, mergeFeedContent } from "../feed-content";
import { mediaAspect, portraitRailLayout, shouldPreserveWholeSubject } from "../media-presentation";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import { CommunityHub } from "./community";
import { CustomFeedHub } from "./custom-feed";
import { StatusFeed } from "./status";

type FeedTab = "RECOMMENDED" | "FOLLOWING";
type FeedSection = "POSTS" | "STATUS" | "COMMUNITY";
type FilterKey = "ALL" | "人/关系" | "机会/需求" | "活动/团体" | "情报/行业信息" | "附近";

// 模块级缓存：组件卸载/重载时保留数据，避免闪烁
let cachedPosts: FeedPost[] = [];
let cachedMedia: Record<string, FeedMediaItem[]> = {};
let cachedPostIds: Set<string> = new Set();
let cachedComposerDraft = "";

// 种子媒体资产固定 ID（后端 seedPostgresMedia 幂等写入，READY）。
const SEED_IMAGE_IDS = ["seed_media_hoankiem", "seed_media_coffee", "seed_media_westlake"];
const SEED_VIDEO_ID = "seed_media_route_video";
const SEED_OPENING_VIDEO_ID = "seed_media_opening_video";

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

export function FeedSurface({
  localNet,
  marketplace,
  mediaClient,
  engagement,
  onOpenChat,
  onOpenFeedPrefs,
  refreshTrigger
}: {
  localNet: LocalNetClient;
  marketplace: MarketplaceClient;
  mediaClient: MediaClient;
  engagement: EngagementClient;
  onOpenChat: (author: string) => void;
  onOpenFeedPrefs: () => void;
  refreshTrigger?: number;
}): React.JSX.Element {
  const [tab, setTab] = useState<FeedTab>("RECOMMENDED");
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
  // 发布器状态（X 式 compose）
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState(cachedComposerDraft);
  const [draftImages, setDraftImages] = useState<UploadableImage[]>([]);
  const [draftVisibility, setDraftVisibility] = useState<"PUBLIC" | "FOLLOWERS">("PUBLIC");
  const [draftIncludeCity, setDraftIncludeCity] = useState(true);
  const [composerError, setComposerError] = useState<string>();
  const [quoteTargetId, setQuoteTargetId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [viewer, setViewer] = useState<{ postId: string; index: number } | null>(null);
  const [customFeedHubOpen, setCustomFeedHubOpen] = useState(false);
  const [selectedCustomFeed, setSelectedCustomFeed] = useState<string | null>(null);
  // X 式内联视频自动播放：滑近视口中心自动播（默认静音）、滑出即停，同一时刻仅一条在播。
  const [cardYs, setCardYs] = useState<Record<string, number>>({});
  const [frames, setFrames] = useState<Record<string, { y: number; height: number }>>({});
  const [scrollY, setScrollY] = useState(0);
  const [stickyHeaderVisible, setStickyHeaderVisible] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [muted, setMuted] = useState(true);
  // 长按减少推荐菜单
  const [contextMenu, setContextMenu] = useState<{ postId: string; x: number; y: number } | null>(null);
  const [hiddenPosts, setHiddenPosts] = useState<ReadonlySet<string>>(new Set());
  // 新更新提示：后台刷新检测到新帖时显示
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingPosts, setPendingPosts] = useState<FeedPost[]>([]);
  const [pendingMedia, setPendingMedia] = useState<Record<string, FeedMediaItem[]>>({});
  const scrollRef = useRef<ScrollView>(null);
  const lastScrollYRef = useRef(0);
  const postIdsRef = useRef<Set<string>>(cachedPostIds);

  const activeVideoId = useMemo(() => {
    if (viewportHeight === 0) return null;
    let best: string | null = null;
    let bestVisible = 0;
    for (const [videoId, frame] of Object.entries(frames)) {
      const cardY = cardYs[videoId] ?? 0;
      const top = cardY + frame.y - scrollY;
      const visible = Math.max(0, Math.min(top + frame.height, viewportHeight) - Math.max(top, 0));
      if (visible >= frame.height * 0.5 && visible > bestVisible) {
        best = videoId;
        bestVisible = visible;
      }
    }
    return best;
  }, [cardYs, frames, scrollY, viewportHeight]);

  function onFeedScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const nextY = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = nextY - lastScrollYRef.current;
    setScrollY(nextY);
    if (nextY <= 48) {
      setStickyHeaderVisible(false);
    } else if (delta < -3) {
      setStickyHeaderVisible(true);
    } else if (delta > 3) {
      setStickyHeaderVisible(false);
    }
    lastScrollYRef.current = nextY;
  }

  function toggleEmbeddedComposer(): void {
    if (composerOpen) {
      setComposerOpen(false);
      return;
    }
    openComposer();
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }

  // 首次空读模型时经 CreatePost 写入演示帖（内容归服务端所有，前端不内嵌）。
  const seedDemoPosts = useCallback(async (): Promise<void> => {
    const linhBody = "今天带第一次来河内的客人走了一条“少景点、多咖啡和拍照”的路线。下午太热，所以把西湖放晚一点，中间多留了一个室内咖啡休息。";
    const linhId = await localNet.createPost({
      authorType: "AGENT",
      authorDisplayName: "Linh",
      body: linhBody,
      mediaRefs: SEED_IMAGE_IDS.map((id, index) => ({ mediaAssetId: id, sortOrder: index })),
      visibility: "PUBLIC",
      cityScope: "hn",
      contextRefs: [
        { contextType: "SERVICE", contextId: "城市同行" },
        { contextType: "ROUTE", contextId: "轻松拍照路线" },
        { contextType: "VENUE", contextId: "木光咖啡" }
      ]
    });
    await localNet.createPost({
      authorType: "AGENT",
      authorDisplayName: "Mai",
      body: "明天下午 13:00–18:00 临时空出来。想轻松逛西湖、喝咖啡、拍点照片的话可以直接聊，我会先看你想要什么节奏。",
      mediaRefs: [{ mediaAssetId: SEED_VIDEO_ID, sortOrder: 0 }],
      visibility: "PUBLIC",
      cityScope: "hn",
      contextRefs: [
        { contextType: "SERVICE", contextId: "城市同行" },
        { contextType: "AVAILABILITY", contextId: "明天下午可接" }
      ]
    });
    await localNet.createPost({
      authorType: "USER",
      authorDisplayName: "Huyen",
      body: "周六下午有人想一起找家好看的咖啡店互相拍照吗？不收服务费，各自点自己的饮料就行。",
      visibility: "PUBLIC",
      cityScope: "hn",
      contextRefs: [
        { contextType: "ACTIVITY", contextId: "用户活动" },
        { contextType: "QUOTE_POST", contextId: linhId }
      ]
    });
    await localNet.createPost({
      authorType: "MERCHANT",
      authorDisplayName: "Bonsaidon",
      body: "周六新店开业，现场准备了小型品鉴环节。欢迎来坐坐，也欢迎认识更多本地朋友。",
      mediaRefs: [{ mediaAssetId: SEED_OPENING_VIDEO_ID, sortOrder: 0 }],
      visibility: "PUBLIC",
      cityScope: "hn",
      contextRefs: [
        { contextType: "VENUE", contextId: "门店场景" },
        { contextType: "ACTIVITY", contextId: "周六新店开业" }
      ]
    });
  }, [localNet]);

  const loadFeed = useCallback(async (): Promise<void> => {
    // 有缓存时不显示 LOADING
    if (cachedPosts.length === 0) {
      setPhase("LOADING");
    }
    try {
      const [postResult, marketResult] = await Promise.allSettled([
        localNet.listFeedPosts(),
        marketplace.list()
      ]);
      if (postResult.status === "rejected" && marketResult.status === "rejected") throw new Error("feed sources unavailable");
      let read = postResult.status === "fulfilled" ? postResult.value : { posts: [], media: {} };
      if (postResult.status === "fulfilled" && read.posts.length === 0) {
        await seedDemoPosts();
        read = await localNet.listFeedPosts();
      }
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
  }, [localNet, marketplace, seedDemoPosts]);

  // 后台静默刷新：不显示 LOADING，只检测新帖
  const backgroundRefresh = useCallback(async (): Promise<void> => {
    try {
      const [postResult, marketResult] = await Promise.allSettled([
        localNet.listFeedPosts(),
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
  }, [localNet, marketplace]);

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

  function openComposer(quoteId?: string): void {
    setQuoteTargetId(quoteId ?? null);
    setComposerOpen(true);
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
          selectionLimit: Math.max(1, 6 - draftImages.length),
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
        });
    if (result.canceled) return;
    const selected = result.assets.map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height, ...(asset.fileName ? { fileName: asset.fileName } : {}), ...(asset.mimeType ? { mimeType: asset.mimeType } : {}) }));
    setDraftImages((current) => [...current, ...selected].slice(0, 6));
  }

  async function publish(): Promise<void> {
    if ((!draft.trim() && draftImages.length === 0) || publishing) return;
    setPublishing(true);
    setComposerError(undefined);
    try {
      const uploaded = await Promise.all(draftImages.map((image) => mediaClient.uploadImage(image)));
      const payload: CreatePostPayload = {
        authorType: "USER",
        authorDisplayName: "你",
        body: draft.trim(),
        visibility: draftVisibility,
        ...(draftIncludeCity ? { cityScope: "hn" } : {})
      };
      if (uploaded.length > 0) payload.mediaRefs = uploaded.map((item, index) => ({ mediaAssetId: item.mediaAssetId, sortOrder: index }));
      if (quoteTargetId) payload.contextRefs = [{ contextType: "QUOTE_POST", contextId: quoteTargetId }];
      await localNet.createPost(payload);
      setDraft("");
      cachedComposerDraft = "";
      setDraftImages([]);
      setQuoteTargetId(null);
      setComposerOpen(false);
      await loadFeed();
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "发布失败，请稍后重试。");
    } finally {
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

  const visible = posts.filter((post) => {
    if (hiddenPosts.has(post.postId)) return false;
    if (tab === "FOLLOWING") {
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
    return true;
  });
  const quoteTarget = quoteTargetId ? posts.find((post) => post.postId === quoteTargetId) : undefined;
  const viewerPost = viewer ? posts.find((post) => post.postId === viewer.postId) : undefined;
  const viewerItems = viewerPost ? mediaFor(viewerPost.postId) : [];

  if (customFeedHubOpen) {
    return <CustomFeedHub onBack={() => setCustomFeedHubOpen(false)} onOpenFeed={(id) => { setSelectedCustomFeed(id); setFeedFilter("ALL"); setCustomFeedHubOpen(false); }} />;
  }

  return (
    <View style={styles.root}>
    <ScrollView
      ref={scrollRef}
      style={styles.scrollRoot}
      contentContainerStyle={styles.content}
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
        <StatusFeed onReply={onOpenChat} />
      ) : section === "COMMUNITY" ? (
        <CommunityHub />
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

      {/* R15.3 r153search：🔍 + input + › */}
      <Pressable style={styles.r153search}>
        <View style={styles.searchMag}>
          <Text style={styles.searchMagText}>⌕</Text>
        </View>
        <TextInput
          style={styles.r153searchInput}
          placeholder="搜索人、机会、活动、情报…"
          placeholderTextColor={color.muted}
          editable={false}
        />
        <Text style={styles.searchArrow}>›</Text>
      </Pressable>

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

      {/* 发布器（X 式 compose：正文 + 照片/普通视频 + 引用绑定 → CreatePost） */}
      {composerOpen ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(value) => { cachedComposerDraft = value; setDraft(value); }}
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
              <Pressable onPress={() => setQuoteTargetId(null)}>
                <Text style={styles.composerQuoteRemove}>移除</Text>
              </Pressable>
            </View>
          ) : null}
          {draftImages.length > 0 ? (
            <View style={styles.composerMediaPreview}>
              {draftImages.map((image, index) => (
                <Pressable key={`${image.uri}_${index}`} onPress={() => setDraftImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <Image source={{ uri: image.uri }} style={styles.composerMediaThumb} />
                  <Text style={styles.composerMediaRemove}>移除</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.composerMetaRow}>
            <Pressable onPress={() => setDraftVisibility((value) => value === "PUBLIC" ? "FOLLOWERS" : "PUBLIC")} style={styles.composerMetaChip}>
              <Text style={styles.composerMetaText}>{draftVisibility === "PUBLIC" ? "所有人可见" : "仅关注者"}</Text>
            </Pressable>
            <Pressable onPress={() => setDraftIncludeCity((value) => !value)} style={[styles.composerMetaChip, draftIncludeCity && styles.composerMetaChipOn]}>
              <Text style={styles.composerMetaText}>{draftIncludeCity ? "河内 · 已添加" : "不添加位置"}</Text>
            </Pressable>
            <Text style={styles.composerCount}>{draft.length}/1000</Text>
          </View>
          <View style={styles.composerTools}>
            <Pressable
              disabled={draftImages.length >= 6}
              onPress={() => void pickComposerImages("library")}
              style={[styles.composerTool, draftImages.length >= 6 && styles.disabled]}
            >
              <Text style={styles.composerToolText}>照片 {draftImages.length}/6</Text>
            </Pressable>
            <Pressable
              disabled={draftImages.length >= 6}
              onPress={() => void pickComposerImages("camera")}
              style={[styles.composerTool, draftImages.length >= 6 && styles.disabled]}
            >
              <Text style={styles.composerToolText}>拍照</Text>
            </Pressable>
            <Pressable onPress={() => void publish()} style={styles.composerPublish}>
              <Text style={styles.composerPublishText}>{publishing ? "发布中…" : "发布"}</Text>
            </Pressable>
          </View>
          {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
        </View>
      ) : null}

      {engagementError ? <Text style={styles.engagementError}>{engagementError}</Text> : null}
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
              {/* posthead */}
              <View style={styles.postHead}>
                <View style={styles.postAvatar}>
                  <Text style={styles.postAvatarText}>{name.charAt(0)}</Text>
                </View>
                <View style={styles.scenarioBadge}>
                  <ProxyIcon color={color.violet} name={scenarioIconForPost(post)} size={12} />
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
                <AdaptiveMediaRail
                  items={items}
                  resolveUrl={(path) => localNet.resolveMediaUrl(path)}
                  onOpen={(index) => setViewer({ postId: post.postId, index })}
                />
              ) : items.length === 1 && items[0] && items[0].mediaType === "VIDEO" && items[0].playbackUrl ? (
                <VideoCard
                  videoId={post.postId}
                  item={items[0]}
                  active={activeVideoId === post.postId}
                  muted={muted}
                  resolveUrl={(path) => localNet.resolveMediaUrl(path)}
                  onFrame={(frame) => setFrames((prev) => ({ ...prev, [post.postId]: frame }))}
                  onUnmountFrame={() => setFrames((prev) => {
                    const next = { ...prev };
                    delete next[post.postId];
                    return next;
                  })}
                  onToggleMute={() => setMuted((prev) => !prev)}
                />
              ) : items.length === 1 && items[0] ? (
                <SinglePostImage
                  item={items[0]}
                  resolveUrl={(path) => localNet.resolveMediaUrl(path)}
                  onPress={() => setViewer({ postId: post.postId, index: 0 })}
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

              <View style={styles.postUtility}>
                <Text style={styles.postUtilityText}>服务端读模型 · 媒体 READY Hydration · 可见性 fail-closed</Text>
              </View>

              {/* postactions：♡ / 回复 / 引用 / 收藏 / 分享 / ···(更多) */}
              <View style={styles.postActions}>
                <Pressable disabled={isLiked || engagementBusy.has(`like:${post.postId}`)} onPress={() => void commitEngagement(`like:${post.postId}`, post.postId, () => engagement.reactToPost(post.postId), setLiked, liked)} style={styles.postAction}>
                  <Text style={[styles.postActionText, isLiked && styles.postActionOn]}>
                    {isLiked ? "♥" : "♡"} {isLiked ? 1 : 0}
                  </Text>
                </Pressable>
                <Pressable style={styles.postAction}>
                  <Text style={styles.postActionText}>回复</Text>
                </Pressable>
                <Pressable onPress={() => openComposer(post.postId)} style={styles.postAction}>
                  <Text style={styles.postActionText}>引用</Text>
                </Pressable>
                <Pressable disabled={isSaved || engagementBusy.has(`bookmark:${post.postId}`)} onPress={() => void commitEngagement(`bookmark:${post.postId}`, post.postId, () => engagement.bookmarkPost(post.postId), setBookmarked, bookmarked)} style={styles.postAction}>
                  <Text style={[styles.postActionText, isSaved && styles.postActionOn]}>收藏 {isSaved ? 1 : 0}</Text>
                </Pressable>
                <Pressable style={styles.postAction}>
                  <Text style={styles.postActionText}>分享</Text>
                </Pressable>
                <Pressable
                  onPress={() => setContextMenu({ postId: post.postId, x: 0, y: 0 })}
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
                  <Pressable style={styles.intentNeed}>
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
          key={`${viewer.postId}_${viewer.index}`}
          items={viewerItems}
          index={viewer.index}
          author={authorName(viewerPost)}
          resolveUrl={(path) => localNet.resolveMediaUrl(path)}
          onNavigate={(next) => setViewer({ postId: viewer.postId, index: next })}
          onClose={() => setViewer(null)}
        />
      ) : null}

      {/* 长按减少推荐菜单（X 式 ··· 菜单） */}
      {contextMenu ? (
        <Modal transparent animationType="fade" onRequestClose={() => setContextMenu(null)}>
          <Pressable style={styles.menuOverlay} onPress={() => setContextMenu(null)}>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>减少此类内容</Text>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setHiddenPosts((prev) => new Set([...prev, contextMenu.postId]));
                  setContextMenu(null);
                }}
              >
                <Text style={styles.menuItemText}>不感兴趣</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => setContextMenu(null)}>
                <Text style={styles.menuItemText}>减少这类内容</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => setContextMenu(null)}>
                <Text style={styles.menuItemText}>少看这个人</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => setContextMenu(null)}>
                <Text style={styles.menuItemText}>举报</Text>
              </Pressable>
              <Pressable style={styles.menuCancel} onPress={() => setContextMenu(null)}>
                <Text style={styles.menuCancelText}>取消</Text>
              </Pressable>
            </View>
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

// 人像组图规则：Rail 保持统一画布，半身照约 4:5 铺满；9:16 等全身照
// 在同一画布内 contain + 柔和背景，保证头顶与脚都不被裁掉，也不会缩成窄条。
function AdaptiveMediaRail({ items, resolveUrl, onOpen }: {
  items: FeedMediaItem[];
  resolveUrl: (path: string) => string;
  onOpen: (index: number) => void;
}): React.JSX.Element {
  const [contentWidth, setContentWidth] = useState(320);
  const { portraitSet, railHeight, portraitCardWidth } = portraitRailLayout(items, contentWidth);

  return (
    <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        decelerationRate="fast"
        horizontal
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        style={styles.mediaRail}
      >
        {items.map((item, index) => {
          const aspect = mediaAspect(item);
          const cardWidth = portraitSet
            ? portraitCardWidth
            : Math.max(contentWidth * 0.72, Math.min(contentWidth * 0.92, railHeight * aspect));
          return (
            <Pressable
              accessibilityLabel={`查看第 ${index + 1} 张媒体`}
              key={item.mediaAssetId}
              onPress={() => onOpen(index)}
              style={{ height: railHeight, marginRight: 10, width: cardWidth }}
            >
              <SocialMediaFrame
                item={item}
                frameAspect={cardWidth / railHeight}
                resolveUrl={resolveUrl}
              />
              <View style={styles.mediaBadge}>
                <Text style={styles.mediaBadgeText}>{index + 1}/{items.length}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.mediaRailHint}>{items.length} 张 · 左右滑动查看</Text>
    </View>
  );
}

function SocialMediaFrame({ item, frameAspect, resolveUrl }: {
  item: FeedMediaItem;
  frameAspect: number;
  resolveUrl: (path: string) => string;
}): React.JSX.Element {
  const declaredAspect = mediaAspect(item, 0);
  const [loadedAspect, setLoadedAspect] = useState(0);
  const sourceAspect = declaredAspect || loadedAspect || frameAspect;
  const preserveWholeSubject = shouldPreserveWholeSubject(sourceAspect, frameAspect);
  const uri = resolveUrl(item.feedUrl ?? item.thumbnailUrl ?? item.playbackUrl ?? "");

  return (
    <View style={styles.socialMediaFrame}>
      {preserveWholeSubject ? (
        <Image blurRadius={24} resizeMode="cover" source={{ uri }} style={styles.socialMediaBackdrop} />
      ) : null}
      <Image
        onLoad={(event) => {
          const source = event.nativeEvent.source;
          if (!declaredAspect && source.width > 0 && source.height > 0) setLoadedAspect(source.width / source.height);
        }}
        resizeMode={preserveWholeSubject ? "contain" : "cover"}
        source={{ uri }}
        style={styles.socialMediaAsset}
      />
    </View>
  );
}

// 单图不使用固定高度：常见比例按原比例展示；超长/超宽图限制卡片高度并 contain，
// 避免默认 Feed 裁掉脸或身体。点击后再进入原比例高清查看。
function SinglePostImage({ item, resolveUrl, onPress }: {
  item: FeedMediaItem;
  resolveUrl: (path: string) => string;
  onPress: () => void;
}): React.JSX.Element {
  const declaredAspect = item.aspectRatio > 0
    ? item.aspectRatio
    : item.width > 0 && item.height > 0
      ? item.width / item.height
      : 0;
  const [loadedAspect, setLoadedAspect] = useState(0);
  const sourceAspect = declaredAspect || loadedAspect || 4 / 3;
  const displayAspect = Math.max(4 / 5, Math.min(1.91, sourceAspect));
  const needsLetterbox = Math.abs(displayAspect - sourceAspect) > 0.01;
  return (
    <Pressable accessibilityLabel="查看原图" onPress={onPress} style={[styles.singleMediaStage, { aspectRatio: displayAspect }]}>
      <Image
        source={{ uri: resolveUrl(item.feedUrl ?? item.thumbnailUrl ?? item.playbackUrl ?? "") }}
        onLoad={(event) => {
          const source = event.nativeEvent.source;
          if (!declaredAspect && source.width > 0 && source.height > 0) setLoadedAspect(source.width / source.height);
        }}
        resizeMode={needsLetterbox ? "contain" : "cover"}
        style={styles.singleMediaImage}
      />
    </Pressable>
  );
}

// 图片查看器加载服务端原始文件（playbackUrl 对 IMAGE 指向原文件），缩略图不再被放大。
// 成熟开源查看器负责 iOS/Android 双指缩放、双击缩放、左右翻页和下滑关闭。
function MediaViewer({
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
  const sources = items.map((item) => ({
    uri: resolveUrl(item.mediaType === "IMAGE" ? (item.galleryUrl ?? item.playbackUrl ?? item.thumbnailUrl ?? "") : (item.thumbnailUrl ?? ""))
  }));
  return (
    <ImageViewing
      images={sources}
      imageIndex={index}
      visible
      backgroundColor="#050507"
      onRequestClose={onClose}
      onImageIndexChange={onNavigate}
      HeaderComponent={({ imageIndex }) => (
        <View style={styles.viewerTop}>
          <Text style={styles.viewerCounter}>{imageIndex + 1}/{items.length} · {author}</Text>
          <Pressable accessibilityLabel="关闭原图" onPress={onClose} style={styles.viewerClose}>
            <Text style={styles.viewerCloseText}>×</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

// X 式内联视频卡：滑近视口中心自动播（默认静音）、滑出即停；轻点暂停/继续，角标切静音。
function VideoCard({
  videoId,
  item,
  active,
  muted,
  resolveUrl,
  onFrame,
  onUnmountFrame,
  onToggleMute
}: {
  videoId: string;
  item: FeedMediaItem;
  active: boolean;
  muted: boolean;
  resolveUrl: (path: string) => string;
  onFrame: (frame: { y: number; height: number }) => void;
  onUnmountFrame: () => void;
  onToggleMute: () => void;
}): React.JSX.Element {
  const player = useVideoPlayer(resolveUrl(item.playbackUrl ?? ""), (setup) => {
    setup.loop = true;
    setup.muted = true;
  });
  const activeRef = useRef(active);
  activeRef.current = active;
  const onUnmountRef = useRef(onUnmountFrame);
  onUnmountRef.current = onUnmountFrame;
  useEffect(() => {
    if (activeRef.current) {
      player.play();
    }
  }, [player]);
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);
  useEffect(() => {
    if (active) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, active]);
  useEffect(() => {
    return () => {
      onUnmountRef.current();
    };
  }, []);
  return (
    <View style={styles.videoStage} onLayout={(event) => onFrame({ y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })}>
      <VideoView player={player} style={styles.videoView} contentFit="cover" />
      <Pressable style={styles.videoTap} onPress={() => {
        if (player.playing) player.pause(); else player.play();
      }} />
      <Pressable onPress={onToggleMute} style={styles.videoMute}>
        <Text style={styles.videoMuteText}>{muted ? "🔇" : "🔊"}</Text>
      </Pressable>
      {item.durationMs ? (
        <View style={styles.mediaBadge}>
          <Text style={styles.mediaBadgeText}>{formatDurationMs(item.durationMs)}</Text>
        </View>
      ) : null}
    </View>
  );
}

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
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  updateBannerText: {
    color: color.white,
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
  composerInput: { color: color.ink, fontSize: 11, lineHeight: 16, minHeight: 44, textAlignVertical: "top" },
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
  composerMediaPreview: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  composerMediaThumb: { borderRadius: 9, height: 58, width: 58 },
  composerMediaRemove: { color: "#B91451", fontSize: 11, fontWeight: "700", marginTop: 2, textAlign: "center" },
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
  // 基线 .postcard：radius 18，margin 9，padding 12。
  postCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 4.5,
    padding: 12,
    ...shadows.card
  },
  postHead: { alignItems: "center", flexDirection: "row", gap: 8 },
  postAvatar: {
    alignItems: "center",
    backgroundColor: "#F0EAF5",
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  postAvatarText: { color: color.ink, fontSize: 15, fontWeight: "700" },
  scenarioBadge: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, height: 20, justifyContent: "center", width: 20 },
  engagementError: { color: color.magenta, fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  postIdentity: { flex: 1, minWidth: 0 },
  postName: { color: color.ink, fontSize: 11, fontWeight: "700" },
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

  postReason: { color: "#81788A", fontSize: 11, marginTop: 7 },
  postCopy: { color: "#2C2631", fontSize: 11, lineHeight: 16, marginVertical: 7 },

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
    paddingTop: 52
  },
  viewerCounter: { color: "rgba(255,255,255,0.82)", fontSize: 11, fontWeight: "700" },
  viewerClose: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34
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

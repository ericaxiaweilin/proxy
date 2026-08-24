// Feed Surface（稳定 Surface：动态 tab / LocalNet Feed）。
// 新架构（服务端驱动）：内容全部来自后端 ListFeedPosts 读模型（operationRef payload），
// 发布走 CreatePost 命令；前端不再内嵌内容 seed（首次空读模型时经 CreatePost 写入演示帖）。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
// （r153search + networktabs + feedfilterrail + preferencehint + postcard + mediaRail +
// postactions + postintent + feedfab），刻度按 R15.11 Social Baseline 对齐。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type EngagementClient } from "../engagement-client";
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
  engagement,
  onOpenChat,
  onOpenFeedPrefs,
  refreshTrigger
}: {
  localNet: LocalNetClient;
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
  const [draft, setDraft] = useState("");
  const [draftMedia, setDraftMedia] = useState<"IMAGE" | "VIDEO" | null>(null);
  const [quoteTargetId, setQuoteTargetId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [viewer, setViewer] = useState<{ postId: string; index: number } | null>(null);
  const [customFeedHubOpen, setCustomFeedHubOpen] = useState(false);
  const [selectedCustomFeed, setSelectedCustomFeed] = useState<string | null>(null);
  // X 式内联视频自动播放：滑近视口中心自动播（默认静音）、滑出即停，同一时刻仅一条在播。
  const [cardYs, setCardYs] = useState<Record<string, number>>({});
  const [frames, setFrames] = useState<Record<string, { y: number; height: number }>>({});
  const [scrollY, setScrollY] = useState(0);
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
    setScrollY(event.nativeEvent.contentOffset.y);
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
      let read = await localNet.listFeedPosts();
      if (read.posts.length === 0) {
        await seedDemoPosts();
        read = await localNet.listFeedPosts();
      }
      // 更新缓存
      cachedPosts = read.posts;
      cachedMedia = read.media;
      cachedPostIds = new Set(read.posts.map((p) => p.postId));
      postIdsRef.current = cachedPostIds;
      setPosts(read.posts);
      setMedia(read.media);
      setPhase("READY");
    } catch {
      setPhase("ERROR");
    }
  }, [localNet, seedDemoPosts]);

  // 后台静默刷新：不显示 LOADING，只检测新帖
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

  /** 绑定一条随机服务端动态作为引用（X 式 quote 的随机入口）。 */
  function bindRandomQuote(): void {
    const pool = posts.filter((post) => post.postId !== quoteTargetId);
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) setQuoteTargetId(pick.postId);
  }

  async function publish(): Promise<void> {
    if (!draft.trim() || publishing) return;
    setPublishing(true);
    try {
      const payload: CreatePostPayload = {
        authorType: "USER",
        authorDisplayName: "你",
        body: draft.trim(),
        visibility: "PUBLIC",
        cityScope: "hn"
      };
      if (draftMedia === "IMAGE") payload.mediaRefs = [{ mediaAssetId: SEED_IMAGE_IDS[0] ?? "seed_media_hoankiem", sortOrder: 0 }];
      if (draftMedia === "VIDEO") payload.mediaRefs = [{ mediaAssetId: SEED_VIDEO_ID, sortOrder: 0 }];
      if (quoteTargetId) payload.contextRefs = [{ contextType: "QUOTE_POST", contextId: quoteTargetId }];
      await localNet.createPost(payload);
      setDraft("");
      setDraftMedia(null);
      setQuoteTargetId(null);
      setComposerOpen(false);
      await loadFeed();
    } catch {
      // fail-closed：发布失败保留草稿，提示由读模型层统一呈现
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
          if (post.authorType !== "USER") return false;
          break;
        case "机会/需求":
          if (!ctxTypes.has("AVAILABILITY") && post.authorType !== "AGENT") return false;
          break;
        case "活动/团体":
          if (!ctxTypes.has("ACTIVITY")) return false;
          break;
        case "情报/行业信息":
          if (post.authorType !== "MERCHANT" && !ctxTypes.has("VENUE")) return false;
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
        opportunity: (p) => p.contextRefs.some((r) => r.contextType === "AVAILABILITY") || p.authorType === "AGENT",
        merchant: (p) => p.authorType === "MERCHANT",
        startup: (p) => p.contextRefs.some((r) => r.contextId.includes("创业") || r.contextId.includes("AI"))
      };
      const checker = feedMap[selectedCustomFeed];
      if (checker && !checker(post)) return false;
    }
    return true;
  });
  const [page, setPage] = useState(1);
  const pageSize = 3;
  useEffect(() => { setPage(1); }, [tab, feedFilter, selectedCustomFeed]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  const pageStart = (page - 1) * pageSize;
  const paginatedVisible = visible.slice(pageStart, pageStart + pageSize);

  function changePage(next: number): void {
    setPage(Math.max(1, Math.min(pageCount, next)));
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  const quoteTarget = quoteTargetId ? posts.find((post) => post.postId === quoteTargetId) : undefined;
  const viewerPost = viewer ? posts.find((post) => post.postId === viewer.postId) : undefined;
  const viewerItems = viewerPost ? mediaFor(viewerPost.postId) : [];

  if (customFeedHubOpen) {
    return <CustomFeedHub onBack={() => setCustomFeedHubOpen(false)} onOpenFeed={(id) => { setSelectedCustomFeed(id); setFeedFilter("ALL"); setCustomFeedHubOpen(false); }} />;
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
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
          <Pressable onPress={() => (composerOpen ? setComposerOpen(false) : openComposer())} style={styles.iconBtn}>
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
            onChangeText={setDraft}
            multiline
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
          <View style={styles.composerTools}>
            <Pressable
              onPress={() => setDraftMedia(draftMedia === "IMAGE" ? null : "IMAGE")}
              style={[styles.composerTool, draftMedia === "IMAGE" && styles.composerToolOn]}
            >
              <Text style={styles.composerToolText}>照片 · 1–6</Text>
            </Pressable>
            <Pressable
              onPress={() => setDraftMedia(draftMedia === "VIDEO" ? null : "VIDEO")}
              style={[styles.composerTool, draftMedia === "VIDEO" && styles.composerToolOn]}
            >
              <Text style={styles.composerToolText}>普通视频</Text>
            </Pressable>
            <Pressable onPress={bindRandomQuote} style={styles.composerTool}>
              <Text style={styles.composerToolText}>🎲 随机引用</Text>
            </Pressable>
            <Pressable onPress={() => void publish()} style={styles.composerPublish}>
              <Text style={styles.composerPublishText}>{publishing ? "发布中…" : "发布"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {engagementError ? <Text style={styles.engagementError}>{engagementError}</Text> : null}
      {phase === "READY" && visible.length > 0 ? (
        <View style={styles.pageSummary}>
          <Text style={styles.pageSummaryTitle}>内容流</Text>
          <Text style={styles.pageSummaryText}>第 {page} / {pageCount} 页 · 共 {visible.length} 条</Text>
        </View>
      ) : null}
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
          {paginatedVisible.map((post) => {
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
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaRail}>
                    {items.map((item, index) => (
                      <Pressable key={item.mediaAssetId} onPress={() => setViewer({ postId: post.postId, index })}>
                        <Image
                          source={{ uri: localNet.resolveMediaUrl(item.thumbnailUrl ?? "") }}
                          style={{ backgroundColor: "#2A2135", borderRadius: 14, height: 156, marginRight: 8, width: railWidth(item) }}
                        />
                        {index === 0 ? (
                          <View style={styles.mediaBadge}>
                            <Text style={styles.mediaBadgeText}>1/{items.length}</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={styles.mediaRailHint}>{items.length} 张 · 左右滑动查看</Text>
                </>
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
                (() => {
                  const item = items[0];
                  return (
                    <Pressable onPress={() => setViewer({ postId: post.postId, index: 0 })}>
                      <Image
                        source={{ uri: localNet.resolveMediaUrl(item.thumbnailUrl ?? "") }}
                        style={{ backgroundColor: "#2A2135", borderRadius: 14, height: 156, width: "100%" }}
                      />
                    </Pressable>
                  );
                })()
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
        {pageCount > 1 ? (
          <View style={styles.pageControls}>
            <Pressable disabled={page === 1} onPress={() => changePage(page - 1)} style={[styles.pageButton, page === 1 && styles.pageButtonDisabled]}>
              <Text style={[styles.pageButtonText, page === 1 && styles.pageButtonTextDisabled]}>‹ 上一页</Text>
            </Pressable>
            <View style={styles.pageIndicator}>
              <Text style={styles.pageIndicatorText}>{page} / {pageCount}</Text>
            </View>
            <Pressable disabled={page === pageCount} onPress={() => changePage(page + 1)} style={[styles.pageButton, page === pageCount && styles.pageButtonDisabled]}>
              <Text style={[styles.pageButtonText, page === pageCount && styles.pageButtonTextDisabled]}>下一页 ›</Text>
            </Pressable>
          </View>
        ) : null}
        </>
      )}
      </>
      )}

      {/* 全屏媒体查看器（真实文件：图片 thumbnailUrl / 视频 playbackUrl） */}
      {viewer && viewerPost && viewerItems[viewer.index] ? (
        <MediaViewer
          key={`${viewer.postId}_${viewer.index}`}
          item={viewerItems[viewer.index] as FeedMediaItem}
          counter={`${(viewer.index ?? 0) + 1}/${viewerItems.length}`}
          author={authorName(viewerPost)}
          resolveUrl={(path) => localNet.resolveMediaUrl(path)}
          onNavigate={(next) => setViewer({ postId: viewer.postId, index: next })}
          onClose={() => setViewer(null)}
          hasPrev={(viewer.index ?? 0) > 0}
          hasNext={(viewer.index ?? 0) < viewerItems.length - 1}
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

      {/* R15.3 feedfab：渐变浮动发布按钮 */}
      {section === "POSTS" ? (
        <Pressable onPress={() => (composerOpen ? setComposerOpen(false) : openComposer())} style={styles.feedFab}>
          <Text style={styles.feedFabText}>{composerOpen ? "×" : "＋"}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function railWidth(item: FeedMediaItem): number {
  const aspect = item.aspectRatio > 0 ? item.aspectRatio : 4 / 3;
  return Math.max(110, Math.min(230, Math.round(156 * aspect)));
}

// 全屏查看器：视频用 expo-video 播服务端 playbackUrl；图片展示 thumbnailUrl。
function MediaViewer({
  item,
  counter,
  author,
  resolveUrl,
  onNavigate,
  onClose,
  hasPrev,
  hasNext
}: {
  item: FeedMediaItem;
  counter: string;
  author: string;
  resolveUrl: (path: string) => string;
  onNavigate: (next: number) => void;
  onClose: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}): React.JSX.Element {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewerRoot}>
        <View style={styles.viewerTop}>
          <Text style={styles.viewerCounter}>{counter} · {author}</Text>
          <Pressable onPress={onClose} style={styles.viewerClose}>
            <Text style={styles.viewerCloseText}>×</Text>
          </Pressable>
        </View>
        <View style={styles.viewerStage}>
          {hasPrev ? (
            <Pressable onPress={() => onNavigate((viewerIndexFromCounter(counter) ?? 1) - 1)} style={styles.viewerNav}>
              <Text style={styles.viewerNavText}>‹</Text>
            </Pressable>
          ) : null}
          {item.mediaType === "VIDEO" && item.playbackUrl ? (
            <Image source={{ uri: resolveUrl(item.thumbnailUrl ?? "") }} style={{ backgroundColor: "#0F0C14", borderRadius: 16, flex: 1, height: 380 }} resizeMode="contain" />
          ) : (
            <Image source={{ uri: resolveUrl(item.thumbnailUrl ?? "") }} style={{ backgroundColor: "#0F0C14", borderRadius: 16, flex: 1, height: 380 }} resizeMode="contain" />
          )}
          {hasNext ? (
            <Pressable onPress={() => onNavigate((viewerIndexFromCounter(counter) ?? 0) + 1)} style={styles.viewerNav}>
              <Text style={styles.viewerNavText}>›</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.viewerCaption}>{author} · {item.mediaType === "VIDEO" ? "视频（服务端 playbackUrl）" : "图片（服务端 thumbnailUrl）"}</Text>
      </View>
    </Modal>
  );
}

function viewerIndexFromCounter(counter: string): number | undefined {
  const head = counter.split("/")[0];
  const parsed = Number(head);
  return Number.isFinite(parsed) ? parsed - 1 : undefined;
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
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 18, paddingTop: 10 },

  // 基线 .feedhead：h2 21 bold。
  feedHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 2, marginTop: 5 },
  feedTitle: { color: color.ink, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  feedTools: { flexDirection: "row", gap: 6 },
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
    bottom: 12,
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    shadowColor: "#7C2AFF",
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.27,
    shadowRadius: 26,
    width: 48
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
  pageSummary: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 3, marginTop: 8 },
  pageSummaryTitle: { color: color.ink, fontSize: 14, fontWeight: "900" },
  pageSummaryText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  pageControls: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", marginTop: 12 },
  pageButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, flex: 1, minHeight: 42, justifyContent: "center", paddingHorizontal: 12 },
  pageButtonDisabled: { backgroundColor: "#F3EFF5", opacity: 0.55 },
  pageButtonText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  pageButtonTextDisabled: { color: color.muted },
  pageIndicator: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, minWidth: 54, paddingHorizontal: 10, paddingVertical: 8 },
  pageIndicatorText: { color: color.white, fontSize: 11, fontWeight: "900" },

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

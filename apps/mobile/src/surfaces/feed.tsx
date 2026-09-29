// Feed Surface（稳定 Surface：动态 tab / LocalNet Feed）。
// 新架构（服务端驱动）：内容全部来自后端 ListFeedPosts 读模型（operationRef payload），
// 发布走 CreatePost 命令；前端不再内嵌内容 seed（首次空读模型时经 CreatePost 写入演示帖）。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
// （r153search + networktabs + feedfilterrail + preferencehint + postcard + mediaRail +
// postactions + postintent + feedfab），刻度按 R15.11 Social Baseline 对齐。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { GlassContainer, GlassView } from "expo-glass-effect";
import { Image as ExpoImage } from "expo-image";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { usePullToRefresh } from "../components/pull-to-refresh";
import ImageViewing from "react-native-image-viewing";
import type { Activity, FeedMediaItem, FeedPost, PostEngagement, PostPollView, PostReply } from "@proxy/contracts";
import { type LocalNetClient } from "../localnet-client";
import { type SecureSessionStore, OfflineFallbackSessionError } from "../secure-session";
import { type AIAccountClient } from "../ai-account-client";
// ACTIVITY-REF-001：解析活动引用（contextId = activityId）需要活动读模型。
import type { ActivityClient } from "../activity-client";
import { localApiBaseUrl } from "../native-clients";
import { resolveAuthorAvatar, type AvatarAccount, type AvatarHumanAccount, initialAvatarTint } from "../media/author-avatar";
import { resolveAssetSource } from "../media/asset-sources";
import { mapEngagementError, mapFollowError } from "./feed-error-map";
import { type EngagementClient } from "../engagement-client";
import type { ProfileClient } from "../profile-client";
import { type MediaClient } from "../media-client";
import { ComposerV2Screen } from "./ComposerV2Screen";
import { FilterChipRail } from "../components/filter-chip-rail";
import { useScrollChrome } from "../shell/scroll-chrome";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { Asset, AssetField, MediaType, Query, requestPermissionsAsync } from "expo-media-library";
import { isOpportunityPost } from "../feed-content";
// ACTIVITY-REF-001：活动引用的唯一词表。实体引用（contextId = activityId）
// 与分类标签（contextId = 人话）必须分开对待 —— 详见 activity-ref.ts 顶部。
import { contextRefHaystack, contextRefLabels, labelContextRefs, referencedActivityId } from "../activity-ref";
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
import type { ConversationClient, ConversationInboxItem } from "../conversation-client";
import { dedupeInboxDialogs, resolveAvatarSource } from "../conversation-inbox-model";

// Re-export v2 组件，保持其他 surface （me.tsx 等）从 ./feed 导入的兼容性。
export { AdaptiveMediaCollection, SinglePostImage, MediaViewer };

// R15.50: 举报原因白名单提到 module 顶层
// (R15.45 原在 FeedSurface 函数内 const, PostMenuModal 引用不到 — 随手修).
const POST_REPORT_REASONS = ["SPAM", "HARASSMENT", "UNSAFE", "OTHER"] as const;
export type PostReportReason = (typeof POST_REPORT_REASONS)[number];
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import { CoffeeScenesHub } from "./coffee-scenes";
import { CustomFeedHub, type CustomFeed } from "./custom-feed";
import { readCustomFeedsAsync } from "../expo-custom-feed-store";
import { defaultFeedPrefs, readFeedPrefsAsync, writeFeedPrefs } from "../expo-feed-prefs-store";
import { feedScopeLabel, isFeedScopeActive, isPostWithinScope } from "../feed-scope-filter";
import type { FeedScope } from "../feed-scope-filter";
import { type SocialSpaceClient } from "../socialspace-client";
import { isOwnAuthorId, isOwnPost as isOwnPostById, resolveAuthorDisplayName, resolveReplyAuthorDisplayName } from "../feed-author";
import { hiddenReplyCount, repliesMatchingFirst, shouldOfferReplyToggle, visibleReplies } from "../reply-preview";
import { ProxyLoading } from "../components/proxy-foundation";
import { useFeedImpressions, visiblePostIds, type CardFrame } from "../feed-impressions";

type FeedTab = "RECOMMENDED" | "FOLLOWING";
// CAFE-SCENE-001: 原来是 "POSTS" | "STATUS" | "COMMUNITY"——用「咖啡场景」
// (CoffeeScenesHub) 替换掉「状态」+「社区」两个 tab，见 coffee-scenes.tsx。
type FeedSection = "POSTS" | "CAFE";
type FilterKey = "ALL" | "人/关系" | "机会/需求" | "活动/团体" | "情报/行业信息" | "附近";

// 模块级缓存：组件卸载/重载时保留数据，避免闪烁
let cachedPosts: FeedPost[] = [];
let cachedMedia: Record<string, FeedMediaItem[]> = {};
let cachedPostIds: Set<string> = new Set();
// ENGAGEMENT-CACHE-001（2026-09-26，用户报的 P0：「帖文的评论 点赞…切换来回就不
// 显示了 要重新刷新才显示」）：互动态以前**没有**跟着帖文一起缓存。
// TAB-SWITCH-JANK-001 定的口径是「remount 有缓存就同步渲染、不重注水」，而注水
// （hydrateEngagement）只活在 loadFeed 里 —— remount 撞上
// `feedNetworkLoadedThisSession` 那条早退，压根不调 loadFeed。
// 结果：切走再切回来，帖文还在（cachedPosts），心却是空的、点赞/评论/转发计数全 0、
// 评论预览也空了，必须下拉刷新（才会重跑 loadFeed）才回来。三样一起缓存上。
let cachedPostEngagement: Record<string, PostEngagement> = {};
let cachedLikedPostIds: ReadonlySet<string> = new Set();
let cachedPostReplies: Record<string, PostReply[]> = {};
// POST-THREAD-001（2026-09-28，用户「没那么简单 x threads 点击评论 会单独跳全部
// 评论页 我们照着学吧」）：草稿缓存这一段历史——先是 REPLY-DRAFT-CACHE-001
// （删掉「取消」按钮，关闭内联输入框=保留非空草稿），再是 REPLY-DRAFT-CACHE-002
// （草稿带 savedAt，读的时候超过 10 分钟就当过期不回填）。现在整套「就地内联展开
// 输入框」被替换成 Threads 式独立帖子详情页（见 openThread/closeThread），但草稿
// 缓存本身的语义不变：离开详情页（closeThread）=保留非空草稿；发送成功=删除该
// postId 的草稿；读的时候（openThread）超过 10 分钟当过期，不回填、顺手删掉——
// 不是「定时清理」，是「读的时候才判断」，不需要额外计时器。
const REPLY_DRAFT_TTL_MS = 10 * 60 * 1000;
// POST-THREAD-001：评论抽屉「表情」按钮弹出的快捷表情行（点一下插进草稿末尾）。
const THREAD_QUICK_EMOJI = ["😂", "❤️", "👍", "🔥", "😍", "😭", "🙏", "🎉"] as const;
// REPLY-IMAGE-001 之后图片评论已上线（相册选图 + 上传 + 行渲染）；GIF 还没有
// 后端能力——图标照原型画出来，点了如实说明，不假装能发。
const THREAD_TEXT_ONLY_NOTICE = "评论暂时只能发文字，GIF 评论还没上线";
let cachedReplyDrafts: Record<string, { text: string; savedAt: number }> = {};
// TAB-SWITCH-JANK-001: 本 session 是否做过一次网络 fresh 加载。切 tab 是 remount
// 不是冷启动——remount 有缓存就同步渲染（毫秒级），不再每次 fresh 重拉；冷启动
// （两级缓存都空）仍走 fresh（FEED-FRESH-002 那条 stale 缓存的教训保留）。
let feedNetworkLoadedThisSession = false;
// AVATAR-FLASH-001: 上次解析出的本人头像 URI（带所属账户）。首帧同步初值用它，
// 切 tab 再回来不闪；effect 照常异步重验，不一致就纠正（换头像后最多闪一帧旧图，
// 不闪黑）。按账户 key，切换账号不串。
let cachedViewerAvatar: { accountId: string; uri: string } | undefined;

// AVATAR-OTHER-HUMAN-002 (2026-09-21): 其他真人作者的头像缓存。
//
// 背景：`FeedPostSchema` 没有头像字段，服务端 feed 查询也不 JOIN
// `identity.profiles`，所以「非本人、非 AI」的作者在动态里一律只能画首字黑圈。
// 本地库实测：69 条 PUBLISHED 里 46 条（67%）如此，其中 23 条的作者在服务端
// **真有**头像资产（`identity.profiles.avatar_path = assets/<mediaAssetId>`）。
// AI 账号有 listRecommended 批量接口，真人没有 —— 只能按 accountId 逐个
// getProfile，所以这里必须做会话级缓存，否则每次 remount 都是请求风暴。
//
// 值是 `null` 表示「查过了，但没有头像」—— 与「没查过」区分开，避免反复重查
// 那些注定没有头像的账号。
let humanAvatarCache: Map<string, AvatarHumanAccount | null> = new Map();
// 在飞去重：同一个 accountId 并发只查一次。
const humanAvatarInFlight = new Set<string>();
// 并发上限：首屏最多同时挂 6 个 getProfile，失败静默（渲染走首字兜底）。
const AUTHOR_AVATAR_FETCH_CONCURRENCY = 6;
// 不进这个管线的 authorType：AGENT / AI_NATIVE 各有自己的解析路径（AI 账号表、
// 打包人像），PLATFORM_SPECIAL 是平台内容、没有对应账号。其余（USER / MERCHANT
// 以及以后新增的真人类型）都去查真实 profile。
const AUTHOR_AVATAR_SKIP_TYPES: ReadonlySet<string> = new Set(["AGENT", "AI_NATIVE", "PLATFORM_SPECIAL"]);
// FOLLOW-STATE-HYDRATE-001：关注态回读的并发上限。和头像那条同一套做法 ——
// 「我关注了谁」同样没有批量接口（只有逐个 IsFollowing），所以只能限并发 + 去重。
// 和头像不同的一点：这里**不**按 authorType 跳过，关注对 AGENT / AI 账号一样成立
// （ai-assistants-row 就在关注 AI 账号），只跳过本人。
const FOLLOW_PROBE_CONCURRENCY = 6;

function snapshotHumanAvatars(): ReadonlyMap<string, AvatarHumanAccount> {
  const out = new Map<string, AvatarHumanAccount>();
  for (const [accountId, account] of humanAvatarCache) {
    if (account) out.set(accountId, account);
  }
  return out;
}

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
  // ACTIVITY-REF-001：只用标签文案做关键词判定。实体引用的 contextId 是
  // activityId，混进来会让任何带 "ai" 之类子串的 id 把帖文判成别的话题。
  const text = post.body + " " + contextRefHaystack(post);
  if (text.includes("摄影") || text.includes("拍照")) return "camera";
  if (text.includes("咖啡")) return "cup";
  if (text.includes("城市同行") || text.includes("路线") || text.includes("同行")) return "route";
  if (text.includes("翻译") || text.includes("口译") || text.includes("中文") || text.includes("接待")) return "chat";
  if (text.includes("活动") || text.includes("开业") || text.includes("品鉴")) return "ticket";
  return "diamond";
}

// FEED-OWN-001: "你" is viewer-relative and resolved per call site via
// resolveAuthorDisplayName(post, viewerAccountId, viewerDisplayName) — never a stored name.

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

// SEC-CATEGORY-ICONS-001：推荐 / 关注 挂上原型 02「推荐 / 关注 / 动态 / 探索 / 分类」
// 那节的分类字形（推荐 = 五角星，关注 = 人 + 信号点）。原型 03 的推荐/关注 tab 本身是
// 纯文字 —— 但同屏上面的分段控件（动态 / 探索）一直是有字形的，只有这两个 tab 空着。
const TABS: ReadonlyArray<{ id: FeedTab; icon: ProxyIconName; label: string }> = [
  { id: "RECOMMENDED", icon: "recommend", label: "推荐" },
  { id: "FOLLOWING", icon: "follow", label: "关注" }
];

// SEC-CATEGORY-ICONS-002：这一行和下面的 TABS 行（推荐 / 关注）**同屏**，原型 02 节
// 把「动态」「探索」也定义成同一套 32 栅格 / 描边 1.9 的分类字形。
// 以前这里挂 target / cup —— 两个都是 24 栅格 / 描边 2.2，尺寸同为 16 时线重
// 1.47px vs 下面那行 0.95px，两行看上去一粗一细。target / cup 本身不动（各有 15+ 调用点）。
// EXPLORE-RENAME-001：第二格的产品名从「咖啡场景」改成「探索」（字形 = 原型 02 的罗盘指针）。
// ⚠️ `id: "CAFE"` 是内部标识、不是用户可见文案，**故意不跟着改名** —— `"CAFE"` 在
//    activity-client / market / tasks 等 7+ 个文件里是**场地类型**（咖啡店），
//    这里的 PageId.FEED_CAFE 又是导航路由；跟显示名一起改会把两种含义搅在一起。
const SECTIONS: ReadonlyArray<{ id: FeedSection; label: string; icon: ProxyIconName }> = [
  { id: "POSTS", label: "动态", icon: "dynamicRing" },
  { id: "CAFE", label: "探索", icon: "explore" }
];

// SEC-CATEGORY-ICONS-002：原型 deepseek_html_20260926_9d241a.html 的 06「真实场景组合」
// 把首页顶部画成**三行** —— 分段控件（动态 / 探索）→ Tabs（推荐 / 关注）→
// **分类胶囊**（全部 / 人关系 / 机会需求 / 活动团体），三行都带图标。
// FilterChipRail 本来就有 icon 槽（requester-home 那边传 assetIcon 在用），
// feed 这边只传 { id, label } 把槽空着 —— 所以这一行一直是纯文字。
// 后两项（情报 / 行业信息、附近）原型 02 里没有对应字形，保持纯文字（icon 可选）。
const FILTERS: ReadonlyArray<{ id: FilterKey; label: string; icon?: ProxyIconName }> = [
  { id: "ALL", label: "全部", icon: "allGrid" },
  { id: "人/关系", label: "人 / 关系", icon: "peoplePair" },
  { id: "机会/需求", label: "机会 / 需求", icon: "clockDot" },
  { id: "活动/团体", label: "活动 / 团体", icon: "hexGroup" },
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
  conversationClient,
  onOpenChat,
  onOpenFeedPrefs,
  viewerAccountId,
  profileClient,
  aiAccountsClient,
  activityClient,
  onOpenActivity,
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
  // FEED-SHARE-TO-USER-001: "分享"弹站内用户列表要真实联系人（收件箱），
  // 跟 messages.tsx 的"建群"候选人同一个客户端。缺省时分享退回纯原生分享。
  conversationClient?: ConversationClient | undefined;
  onOpenChat: (author: string) => void;
  onOpenFeedPrefs: () => void;
  // 本人账号 id：用于判定“自己的帖子”并显示真头像；没有则退回名字判断。
  viewerAccountId?: string | undefined;
  // FEED-AVATAR-REMOTE-001: 本机头像文件丢失时（重装/清理）向服务端要回
  // 远端指针。缺省则只用到本地记录为止，之后是首字。
  profileClient?: ProfileClient | undefined;
  // MEDIA-PIPELINE-001: AI 账号目录，用于解析 AGENT 帖头像；缺省则 AI 帖走首字。
  aiAccountsClient?: AIAccountClient | undefined;
  // ACTIVITY-REF-001: 活动读模型。用来把帖文里的活动引用（contextId =
  // activityId）解析成标题/时间/场地。缺省时活动卡片只显示「活动已不可用」，
  // 不显示 id、也不假装解析成功。
  activityClient?: ActivityClient | undefined;
  // 点活动卡片 → 打开该活动详情。缺省则卡片不可点（仍然显示快照）。
  onOpenActivity?: ((activityId: string) => void) | undefined;
  onOpenRealityScene?: ((sceneId: string) => void) | undefined;
  onOpenProfile?: ((profile: { userId: string; name: string; city?: string | undefined; posts: FeedPost[]; mediaByPost: Record<string, FeedMediaItem[]>; avatarUri?: string | undefined }) => void) | undefined;
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
  // FOLLOW-STATE-HYDRATE-001: 用户在**本会话里自己点过**的关注态。回读结果不许覆盖它 ——
  // 回读可能在 toggle 之前就发出去了（读到的还是旧值），不挡的话会出现「刚取消关注、
  // 切一下又变回已关注」。只记用户明确决定过的 id，其余照常由回读决定。
  const followDecisionsRef = useRef<Map<string, boolean>>(new Map());
  // 本 mount 内在飞的 isFollowing（按作者去重）。刻意用 ref 而不是模块级集合：
  // remount 必须重查。若用模块级，切模块回来时新 mount 会看到上一次 mount 留下的
  // 「在飞」记录而跳过回读 —— 那就是这个 bug 原地复发。
  const followProbeInFlightRef = useRef<Set<string>>(new Set());
  const { width: viewportWidth } = useWindowDimensions();
  // R15.69 (restored): 点头像弹 关注/访问个人主页 菜单（液态玻璃，双行上下排）
  const [profileActions, setProfileActions] = useState<{ userId: string; name: string; city?: string | undefined; posts: FeedPost[]; mediaByPost: Record<string, FeedMediaItem[]>; avatarUri?: string | undefined; anchor: { x: number; y: number } }>();
  const [profileFollowing, setProfileFollowing] = useState(false);
  const [profileFollowBusy, setProfileFollowBusy] = useState(false);
  const [postMenuPostId, setPostMenuPostId] = useState<string | undefined>();
  const [mutedAuthors, setMutedAuthors] = useState<ReadonlySet<string>>(new Set());
  const [postMenuError, setPostMenuError] = useState<string | undefined>();
  // ENGAGEMENT-CACHE-001: 初值取模块级缓存（见文件头）。remount（切 tab 回来）时
  // 组件状态是全新的，只有这三样有缓存，心 / 计数 / 评论预览才会立刻正确。
  const [liked, setLiked] = useState<ReadonlySet<string>>(cachedLikedPostIds);
	const [postEngagement, setPostEngagement] = useState<Record<string, PostEngagement>>(cachedPostEngagement);
	const [postReplies, setPostReplies] = useState<Record<string, PostReply[]>>(cachedPostReplies);
	const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
	// FEED-REPLY-002: 已经拉过评论的帖子，翻页回来不再重复拉。
	const requestedRepliesRef = useRef<Set<string>>(new Set());
	// TAB-SWITCH-JANK-001: 同一波注水里攒批的帖子 id（见 hydrateReplyPreviews）。
	const replyCoalesceRef = useRef<Set<string>>(new Set());
	const replyFlushScheduledRef = useRef(false);
	// TAB-SWITCH-JANK-001: 切进切出抖 tab 时后台刷新节流（见 backgroundRefresh）。
	const lastBackgroundRefreshAtRef = useRef(0);
  const [engagementBusy, setEngagementBusy] = useState<ReadonlySet<string>>(new Set());
  const [engagementError, setEngagementError] = useState<string>();
	// ENGAGEMENT-CACHE-001: 镜像回模块级缓存。effect 在 commit 之后跑（unmount 时
	// React 会先把待跑的 passive effect 刷完），晚一拍无所谓 —— 缓存是留给**下一次
	// remount** 用的。别改成在 setState 里写：那样要包一层 setter，收益为零。
	useEffect(() => { cachedLikedPostIds = liked; }, [liked]);
	useEffect(() => { cachedPostEngagement = postEngagement; }, [postEngagement]);
	useEffect(() => { cachedPostReplies = postReplies; }, [postReplies]);
  const [engagementNotice, setEngagementNotice] = useState<string>();
  // FEED-ACTION-ICONS-001 补（2026-09-26，用户「对齐原型 下面的logo」）：转发那
  // 颗之前在 feed 上根本不画（FEED-ACTION-DEDUP-001 那轮删了），但原型动作行是 4
  // 颗（♡/💬/↻/⇧）—— 现在补回来。失败要能重试，静默吞掉转发最糟。
  const [repostFailed, setRepostFailed] = useState<ReadonlySet<string>>(new Set());
  // POST-THREAD-001: 当前打开的评论抽屉（null = 抽屉关着）。
  const [threadPostId, setThreadPostId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [threadEmojiOpen, setThreadEmojiOpen] = useState(false);
  const [threadNotice, setThreadNotice] = useState<string | null>(null);
  // REPLY-IMAGE-001: 评论图片。相册多选（上限与契约 PostReply.media 同口径 6 张，
  // 只收 IMAGE；相机拍摄/GIF 不在首版），选中先本地预览，发送时逐张 uploadImage，
  // 拿到 mediaAssetId 再调 replyToPost。
  const [replyAlbumOpen, setReplyAlbumOpen] = useState(false);
  const [replyAlbumAssets, setReplyAlbumAssets] = useState<Array<{ id: string; width: number; height: number }>>([]);
  const [replyAlbumOffset, setReplyAlbumOffset] = useState(0);
  const [replyAlbumHasMore, setReplyAlbumHasMore] = useState(false);
  const [replyAlbumLoading, setReplyAlbumLoading] = useState(false);
  const [replyAlbumLoadingMore, setReplyAlbumLoadingMore] = useState(false);
  const [replyAlbumResolvingId, setReplyAlbumResolvingId] = useState<string | undefined>(undefined);
  const [replyImages, setReplyImages] = useState<Array<{ uri: string; width: number; height: number; assetId: string; fileName?: string; mimeType?: string }>>([]);
  const [replyUploading, setReplyUploading] = useState(false);
  const [replyViewer, setReplyViewer] = useState<{ uris: string[]; index: number } | undefined>(undefined);
  // POST-THREAD-001（用户「输入重复...没有数字按键」排查出来的根因之一）：
  // TextInput 的 autoFocus 塞进 <Modal> 里不总是可靠——键盘弹起会跟 Modal 的
  // slide 动画抢时机，动画还没走完时那次 focus 调用经常被吞掉，表现就是抽屉
  // 弹出来了、输入框在，但键盘死活不弹，敲什么都没反应。slide 动画结束
  // （默认 ~300ms）之后再手动 focus 一次兜底，不能只靠 autoFocus 单打一次。
  const threadInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (threadPostId === null) return;
    const timer = setTimeout(() => threadInputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [threadPostId]);
  // Modal onShow 用：slide 动画结束 = 内容挂载完成，此时聚焦最可靠；
  // 350ms 再补一次。抽屉不关只换帖时 onShow 不重发，靠上面 threadPostId 的 effect。
  function focusThreadInput(): void {
    threadInputRef.current?.focus();
    setTimeout(() => threadInputRef.current?.focus(), 350);
  }
  // 发布器状态（v2 全面迁出到 ComposerV2Screen；这里只保留触发器）
  const [composerOpen, setComposerOpen] = useState(false);
  // FEED-SHARE-TO-USER-001: 分享目标帖子 + 候选人（聊过天的真人，跟"建群"
  // 同一诚实数据源）+ 发送中状态。候选人按需加载（打开分享面板才拉），
  // 不在帖子列表渲染时就预取收件箱。
  const [shareTarget, setShareTarget] = useState<FeedPost | null>(null);
  const [shareContacts, setShareContacts] = useState<ConversationInboxItem[] | undefined>(undefined);
  const [shareContactsError, setShareContactsError] = useState(false);
  const [shareSendingTo, setShareSendingTo] = useState<string | null>(null);
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

  // ACTIVITY-REF-001: 活动引用解析表。帖文里只存 activityId，标题/时间/场地都在
  // 活动读模型里，而仓库里**没有** GetActivity 命令 —— 只能拉一次列表建表，
  // 不是每帖拉一次。refreshTrigger 变化（发完帖 / 下拉刷新）时重拉。
  //
  // 拉不到 = 空表。卡片会显示「活动已不可用」，不会退回去印 activityId 冒充标题：
  // 「活动没了」和「活动叫这个名字」必须长得不一样。
  const [activityById, setActivityById] = useState<ReadonlyMap<string, Activity>>(new Map());
  useEffect(() => {
    if (!activityClient) return;
    let active = true;
    void activityClient.listActivities().then((list) => {
      if (!active) return;
      setActivityById(new Map(list.map((item) => [item.activityId, item])));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activityClient, refreshTrigger]);

  // AVATAR-OTHER-HUMAN-002: 真人作者头像。
  // 真相源是模块级 humanAvatarCache（跨 remount 存活）；这个计数器只是让缓存
  // 增长后能触发一次重算 —— 不另存一份 state，就不会出现「缓存有了、state 还是
  // 旧的」这种两处状态互相追不上的 bug。
  // OWN-NAME-001：自己的帖子显示自己的当前用户名（不再是「你」）。拿不到就用帖子保存的名字。
  const [viewerDisplayName, setViewerDisplayName] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!profileClient || !viewerAccountId) return undefined;
    let cancelled = false;
    profileClient.getProfile(viewerAccountId)
      .then((profile) => { if (!cancelled) setViewerDisplayName(profile.name?.trim() || undefined); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [profileClient, viewerAccountId]);
  const [humanAvatarVersion, setHumanAvatarVersion] = useState(0);
  const humanAvatarsById = useMemo(() => snapshotHumanAvatars(), [humanAvatarVersion]);
  useEffect(() => {
    if (!profileClient) return;
    let cancelled = false;
    const wanted: string[] = [];
    for (const post of posts) {
      const authorId = post.authorId;
      if (authorId === viewerAccountId) continue; // 本人走本地文件优先那条路
      if (AUTHOR_AVATAR_SKIP_TYPES.has(post.authorType)) continue;
      if (humanAvatarCache.has(authorId) || humanAvatarInFlight.has(authorId)) continue;
      if (!wanted.includes(authorId)) wanted.push(authorId);
    }
    if (wanted.length === 0) return;
    void (async () => {
      for (let i = 0; i < wanted.length; i += AUTHOR_AVATAR_FETCH_CONCURRENCY) {
        if (cancelled) return;
        const chunk = wanted.slice(i, i + AUTHOR_AVATAR_FETCH_CONCURRENCY);
        for (const accountId of chunk) humanAvatarInFlight.add(accountId);
        await Promise.all(chunk.map(async (accountId) => {
          try {
            const profile = await profileClient.getProfile(accountId);
            const path = (profile?.avatarPath ?? "").trim();
            // 没有头像也记下来（null），否则每次 remount 都会重查这些注定空的账号。
            humanAvatarCache.set(accountId, path === "" ? null : { avatarPath: path, avatarVersion: profile.version });
          } catch {
            // 查不到就当作没有头像：动态渲染走首字兜底，绝不因为头像失败影响内容。
            humanAvatarCache.set(accountId, null);
          } finally {
            humanAvatarInFlight.delete(accountId);
          }
        }));
        if (cancelled) return;
        setHumanAvatarVersion((version) => version + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [posts, profileClient, viewerAccountId]);
  // FOLLOW-STATE-HYDRATE-001（2026-09-26，用户：「点头像 → 关注 → 已关注 → 切模块回来
  // 被重置」）：`following` 过去**只有** toggleProfileFollow 一个写点，从不回读 ——
  // 它实际是「本会话手动点过谁」的内存集合，remount（切模块）即清空。四个消费点
  // 因此全部失真：头像菜单的 关注/已关注、关注 tab 的过滤、friends 自定义流、
  // 帖子卡上的 isFollow。服务端一直是好的（engagement.follows 有行、IsFollowing
  // 读得回来），缺的是客户端这一根回读线。
  // 做法照同文件的头像补查：按 posts 里的作者去重 → 限并发逐个 isFollowing →
  // 单个失败不挡整批 → 只并入（并回放用户自己的决定），不整份替换。
  useEffect(() => {
    if (!viewerAccountId) return undefined;
    let cancelled = false;
    const wanted: string[] = [];
    for (const post of posts) {
      const authorId = post.authorId;
      if (!authorId) continue;
      if (isOwnAuthorId(authorId, viewerAccountId)) continue;
      if (followProbeInFlightRef.current.has(authorId)) continue;
      if (!wanted.includes(authorId)) wanted.push(authorId);
    }
    if (wanted.length === 0) return undefined;
    void (async () => {
      const found: string[] = [];
      for (let i = 0; i < wanted.length; i += FOLLOW_PROBE_CONCURRENCY) {
        if (cancelled) return;
        const chunk = wanted.slice(i, i + FOLLOW_PROBE_CONCURRENCY);
        for (const authorId of chunk) followProbeInFlightRef.current.add(authorId);
        await Promise.all(chunk.map(async (authorId) => {
          try {
            if (await engagement.isFollowing(viewerAccountId, authorId)) found.push(authorId);
          } catch {
            // 查不到就当作未关注（保持现状），绝不因为一次失败清空整批。
          } finally {
            followProbeInFlightRef.current.delete(authorId);
          }
        }));
      }
      if (cancelled || found.length === 0) return;
      setFollowing((current) => {
        const next = new Set([...current, ...found]);
        for (const [authorId, on] of followDecisionsRef.current) {
          if (on) next.add(authorId);
          else next.delete(authorId);
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [posts, viewerAccountId, engagement]);
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
  // CONTENT-ANALYTICS-001: 卡片高度，给信息流曝光判定用（见 feed-impressions.ts）。
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const [frames, setFrames] = useState<Record<string, { y: number; height: number }>>({});
  const [scrollY, setScrollY] = useState(0);
  const [stickyHeaderVisible, setStickyHeaderVisible] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  // 新更新提示：后台刷新检测到新帖时显示
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingPosts, setPendingPosts] = useState<FeedPost[]>([]);
  const [pendingMedia, setPendingMedia] = useState<Record<string, FeedMediaItem[]>>({});
  // FEED-FRESH-001: pill 点下去之后翻页要接着新页走 —— 旧代码不更新 cursor，
  // loadMore 会拿过期游标重复拉第一页；postIds 只记新帖会导致老帖被反复
  // 认成"新动态"，pill 阴魂不散。
  const [pendingCursor, setPendingCursor] = useState<string | undefined>(undefined);
  const [pendingHasMore, setPendingHasMore] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  // (scroll-chrome state now lives in useScrollChrome — see shell/scroll-chrome.ts)
  const postIdsRef = useRef<Set<string>>(cachedPostIds);
  // R15.34.1: filterRail 横滑逻辑已抽到共享组件 FilterChipRail
  // (components/filter-chip-rail.tsx)。原本 feed 这边的
  // filterRailRef / filterRailScrollXRef / filterRailPanResponder
  // 全部删除。Home (推荐人 mode) 和 FEED (动态筛选) 现在用同一份
  // 公共组件，PanResponder 隔离外层 PAGE_SEQUENCE 切页的逻辑一致。

  // 发布器状态全部迁出到 ComposerV2Screen（包含上传、草稿、状态机）。
  // 父组件只管打开/关闭。

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

  // CONTENT-ANALYTICS-001: 信息流卡片曝光 + 停留（以前信息流一条都不报，战绩里的浏览全靠他人主页那一处）。
  // 自己的帖子不算浏览。
  const ownPostIds = useMemo(() => new Set(posts.filter((post) => isOwnPostById(post, viewerAccountId)).map((post) => post.postId)), [posts, viewerAccountId]);
  const seenPostIds = useMemo(() => {
    const cards: Record<string, CardFrame> = {};
    for (const [postId, y] of Object.entries(cardYs)) {
      const height = cardHeights[postId];
      if (height !== undefined && !ownPostIds.has(postId)) cards[postId] = { y, height };
    }
    return visiblePostIds(cards, scrollY, viewportHeight);
  }, [cardYs, cardHeights, ownPostIds, scrollY, viewportHeight]);
  useFeedImpressions(localNet, seenPostIds);

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
      return;
    }
    setComposerOpen(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  }

  // FEED-SHARE-TO-USER-001: 打开分享面板即拉一次收件箱。候选人跟 messages.tsx
  // 的"建群"同一诚实数据源（收件箱里真聊过天的人），过滤规则也一致：
  // 只留 DM、去掉 AI 账号和唯一的 AI 助手——分享给一个 AI 或一个群没有意义。
  function openSharePanel(post: FeedPost): void {
    setShareTarget(post);
    setShareContactsError(false);
    if (!conversationClient) return;
    setShareContacts(undefined);
    void conversationClient.listConversations()
      .then((items) => {
        const humans = dedupeInboxDialogs(items).filter((item) =>
          item.conversation.conversationType === "DM"
          && !!item.counterpartyId
          && item.counterpartyId !== "proxy_ai"
          && item.counterpartyId !== "user_proxy_ai"
          && !/^ai_account_/.test(item.counterpartyId)
        );
        setShareContacts(humans);
      })
      .catch(() => { setShareContacts([]); setShareContactsError(true); });
  }

  function closeSharePanel(): void {
    setShareTarget(null);
    setShareContacts(undefined);
    setShareContactsError(false);
    setShareSendingTo(null);
  }

  function shareViaSystemSheet(post: FeedPost, authorName: string): void {
    void Share.share({ message: `${post.body}\n\nProxy · ${authorName}` });
    closeSharePanel();
  }

  async function sendPostToUser(post: FeedPost, authorName: string, peerUserId: string): Promise<void> {
    if (!conversationClient || shareSendingTo) return;
    setShareSendingTo(peerUserId);
    setEngagementError(undefined);
    try {
      await conversationClient.startConversation({
        originType: "POST",
        originId: post.postId,
        participantId: peerUserId,
        conversationType: "DM",
        firstMessage: `分享了一条动态：${post.body}\n\nProxy · ${authorName}`,
      });
      setEngagementNotice("已分享给对方。");
      closeSharePanel();
    } catch (error) {
      setEngagementError(error instanceof Error && /authenticated principal|real sign-in|signed out/i.test(error.message) ? "分享失败：请登录后重试" : "分享失败，请稍后重试");
      setShareSendingTo(null);
    }
  }

  const loadFeed = useCallback(async (rawQuery?: string, fresh = false): Promise<void> => {
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
      // FEED-FRESH-001: 发布后重载带 fresh 穿透 HTTP 缓存（见 localnet-client）。
      const read = await localNet.listFeedPosts(undefined, searching ? 50 : 25, searching ? search : undefined, fresh);
      // 搜索结果不是 feed 本身：写回模块级缓存会让退出搜索后（以及冷启动读盘时）
      // 看到的是上次的搜索结果，所以只在非搜索加载时更新缓存与磁盘缓存。
      if (!searching) {
        cachedPosts = read.posts;
        cachedMedia = read.media;
        cachedPostIds = new Set(read.posts.map((p) => p.postId));
        postIdsRef.current = cachedPostIds;
        feedNetworkLoadedThisSession = true;
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

  // PULL-REFRESH-001: 下拉重拉第一页，fresh 穿透 HTTP 缓存（同发布后的重载，FEED-FRESH-001）；
  // 正在搜索时按当前查询重拉。
  const feedPull = usePullToRefresh(useCallback(() => loadFeed(searchQuery || undefined, true), [loadFeed, searchQuery]));

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
    // TAB-SWITCH-JANK-001: 切进切出抖一下 tab 就重拉+重注水整屏——30s 内只刷一次。
    // banner 照常工作，只是抖 tab 不会反复触发； genuinely 有新帖时点 banner 照进。
    const now = Date.now();
    if (now - lastBackgroundRefreshAtRef.current < 30_000) return;
    lastBackgroundRefreshAtRef.current = now;
    try {
      const read = await localNet.listFeedPosts();
      if (read.posts.length === 0) return;
      const currentIds = postIdsRef.current;
      const newPosts = read.posts.filter((p) => !currentIds.has(p.postId));
      if (newPosts.length > 0) {
        setPendingCount(newPosts.length);
        setPendingPosts(read.posts);
        setPendingMedia(read.media);
        setPendingCursor(read.nextCursor);
        setPendingHasMore(read.hasMore);
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
  // FEED-FRESH-002: 这一次刷新必须 fresh=true。/v1/feed 的响应头是
  // `max-age=15, stale-while-revalidate=120, stale-if-error=86400`——
  // 首屏这次请求如果不带 _fresh，一旦请求过程中有任何瞬时网络问题，
  // stale-if-error 允许网络层（NSURLCache 等）直接吐一份最多 24 小时前的
  // 缓存当正常 200 返回，JS 这边完全看不出区别（不进 catch，也不报错），
  // 就会一直卡在旧数据——实测复现：发新帖后几次重启 app，"动态" 首屏
  // 永远停在很多天前的帖子，个人主页（走另一个不受这条缓存影响的调用）
  // 却看得到新帖。发帖后的重载已经用 fresh=true 绕过这条缓存，首屏这次
  // 之前漏了，补上。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // TAB-SWITCH-JANK-001: remount（切 tab 回来）有缓存就同步渲染，不再 fresh
      // 重拉——新帖由节流后的后台刷新发现并经 banner 合并。只有本 session 还没做过
      // 网络加载（冷启动）才走 fresh，FEED-FRESH-002 的 stale 教训保留。
      if (feedNetworkLoadedThisSession) return;
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
      if (!cancelled) await loadFeed(undefined, true);
    })();
    return () => { cancelled = true; };
  }, [loadFeed]);

  // P0 availability: recover without requiring the user to kill/reopen the app.
  // FEED-FRESH-002: 恢复路径同样要 fresh=true——不然重试撞上的还是那条
  // stale-if-error=86400 缓存，看着像重试了，拿到的其实是同一份旧数据。
  useEffect(() => {
    if (phase !== "ERROR") return;
    const delay = Math.min(8_000, 1_000 * 2 ** Math.min(feedRetryAttemptRef.current, 3));
    const timer = setTimeout(() => void loadFeed(undefined, true), delay);
    return () => clearTimeout(timer);
  }, [phase, loadFeed]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && (phase === "ERROR" || cachedPosts.length === 0)) void loadFeed(undefined, true);
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
    // FEED-FRESH-001: 按并集合并 —— 新帖置顶、老帖保留；ids 取并集（只记新帖
    // 会让老帖下次又被认成新的）；游标跟新页走（不更新就重复拉第一页）。
    const pendingIDs = new Set(pendingPosts.map((post) => post.postId));
    cachedPosts = [...pendingPosts, ...posts.filter((post) => !pendingIDs.has(post.postId))];
    cachedMedia = { ...media, ...pendingMedia };
    cachedPostIds = new Set([...pendingPosts.map((p) => p.postId), ...postIdsRef.current]);
    postIdsRef.current = cachedPostIds;
    setPosts(cachedPosts);
    setMedia(cachedMedia);
    setNextCursor(pendingCursor);
    setHasMore(pendingHasMore);
    setPendingCount(0);
    setPendingPosts([]);
    setPendingMedia({});
    setPendingCursor(undefined);
    setPendingHasMore(true);
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
	  // TAB-SWITCH-JANK-001: 同一波 hydration 里 N 个帖子同时调进来——以前每个
	  // 都独立 fetch + 独立 setPostReplies，全列表过滤排序重算重渲染 N 次。
	  // 改成合并：同一 tick 进来的 id 攒一批，一次拉完、一次 setState 刷入。
	  // 调用点 `hydrateReplyPreviews(item.postId)` 保持原样（FEED-REPLY-002 钉着它）。
	  replyCoalesceRef.current.add(postId);
	  if (replyFlushScheduledRef.current) return;
	  replyFlushScheduledRef.current = true;
	  await Promise.resolve();
	  const batch = [...replyCoalesceRef.current];
	  replyCoalesceRef.current.clear();
	  replyFlushScheduledRef.current = false;
	  if (batch.length === 0) return;
	  try {
		const listed = await Promise.all(batch.map(async (id) => {
		  try { return { id, replies: (await engagement.listPostReplies(id)).replies }; }
		  catch {
			// 单条拉不到就允许下次再试，但不要因为一条评论炸掉整屏。
			requestedRepliesRef.current.delete(id);
			return undefined;
		  }
		}));
		const merged: Record<string, PostReply[]> = {};
		for (const entry of listed) if (entry) merged[entry.id] = entry.replies;
		if (Object.keys(merged).length > 0) setPostReplies((previous) => ({ ...previous, ...merged }));
	  } catch {
		// 整批失败就允许下次再试，但不要因为评论炸掉整屏。
		for (const id of batch) requestedRepliesRef.current.delete(id);
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
	 * FEED-ACTION-ICONS-001 补（2026-09-26）：转发。原型动作行第 3 颗（↻）—— 服务端
	 * `RepostPost` 从 R14 起就有，幂等（重复转发返 REJECTED / ALREADY_REPOSTED，
	 * 客户端视为成功），这里不再发明新协议。成功后服务端只回事件引用、不回新计数，
	 * 所以再读一次真值，不去猜 +1。失败要能重试（和 ProfileTabs 一致）：
	 * `repostFailed` 这个 Set 记下失败过的 postId，行内下方显示一行"重试"。
	 */
	async function repost(postId: string): Promise<void> {
	  const busyKey = `repost:${postId}`;
	  if (engagementBusy.has(busyKey)) return;
	  setEngagementBusy((value) => new Set(value).add(busyKey));
	  setRepostFailed((previous) => {
		const next = new Set(previous); next.delete(postId); return next;
	  });
	  try {
		await engagement.repostPost(postId);
		const truth = await engagement.getPostEngagement(postId);
		setPostEngagement((previous) => mergePostEngagement(previous, [truth]));
	  } catch (error) {
		setRepostFailed((previous) => new Set(previous).add(postId));
		setEngagementError(mapEngagementError(error, "转发没有提交成功，点重试再试。"));
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

	// POST-THREAD-001（2026-09-28）：三轮修正。
	// 第一轮（用户「没那么简单 x threads 点击评论 会单独跳全部评论页 我们照着
	// 学吧」）：点「评论」以前是就地展开一个内联输入框（REPLY-INLINE-001/
	// REPLY-DRAFT-CACHE-001/002），改成了跳转一个带返回箭头的整屏页面。
	// 第二轮（用户「没做对 做的一踏糊涂」+ 原型 proxy_comment_keyboard_v2.html）：
	// 整屏页面是错的，改成从底部弹起的抽屉（Modal + 遮罩，同 PostMenuModal 那套
	// 写法），但当时又手多加了"整帖内容 + 全部评论"塞进抽屉。
	// 第三轮（用户「点击评论 弹出整个帖文和输入框 输入重复...直接输入框」+
	// 追问后确认用系统真键盘）：原型的评论抽屉本来就只有"拖动把手 + 输入框"，
	// 没有帖文回顾、没有评论列表——那两样是重复的（帖子已经在背后的动态列表里
	// 能看到），删掉。键盘也确认用系统真键盘（自带 123/表情/语音），不照抄
	// 原型里那套自绘 26 键假键盘。openThread 因此不再需要拉全部评论——抽屉
	// 只负责写新评论，不负责展示旧评论。
	function openThread(postId: string): void {
	  setThreadPostId(postId);
	  const cached = cachedReplyDrafts[postId];
	  const cachedFresh = cached !== undefined && Date.now() - cached.savedAt < REPLY_DRAFT_TTL_MS;
	  if (cached !== undefined && !cachedFresh) delete cachedReplyDrafts[postId];
	  setReplyDraft(cachedFresh ? cached.text : "");
	  setThreadEmojiOpen(false);
	  setThreadNotice(null);
	}

  // 把某条 postId 的草稿写回缓存（带时间戳）；空草稿直接删掉，不留一条空
  // 字符串占位。closeThread 收草稿走这条。
  function persistReplyDraft(postId: string, text: string): void {
    if (text.trim()) cachedReplyDrafts[postId] = { text, savedAt: Date.now() };
    else delete cachedReplyDrafts[postId];
  }

  // 从帖子详情页返回 —— 保留非空草稿（10 分钟内回来还能接着写）。
  function closeThread(): void {
    const id = threadPostId;
    if (id !== null) persistReplyDraft(id, replyDraft);
    setThreadPostId(null);
    setReplyDraft("");
    setThreadEmojiOpen(false);
    setThreadNotice(null);
  }

  // REPLY-IMAGE-001 相册：只查 IMAGE，按创建时间倒序分页（对话窗口同款
  // expo-media-library Query 写法；评论不需要相机位/视频，只要相册照片）。
  const REPLY_ALBUM_PAGE_SIZE = 60;
  const REPLY_IMAGE_MAX = 6;

  async function fetchReplyAlbumPage(offset: number): Promise<Array<{ id: string; width: number; height: number }>> {
    const found = await new Query()
      .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE])
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .offset(offset)
      .limit(REPLY_ALBUM_PAGE_SIZE)
      .exe();
    const thumbs = await Promise.all(found.map(async (a) => {
      try {
        const shape = await a.getShape();
        return { id: a.id, width: shape?.width ?? 0, height: shape?.height ?? 0 };
      } catch {
        return undefined;
      }
    }));
    return thumbs.filter((t): t is { id: string; width: number; height: number } => t !== undefined);
  }

  async function openReplyAlbum(): Promise<void> {
    // iOS 键盘是独立系统窗口，盖在应用所有浮层之上——不先收起，相册就被挡在后面。
    threadInputRef.current?.blur();
    setThreadNotice(null);
    const permission = await requestPermissionsAsync();
    if (!permission.granted) {
      setThreadNotice("请允许 Proxy 读取照片");
      return;
    }
    setReplyAlbumLoading(true);
    try {
      const page = await fetchReplyAlbumPage(0);
      setReplyAlbumAssets(page);
      setReplyAlbumOffset(page.length);
      setReplyAlbumHasMore(page.length === REPLY_ALBUM_PAGE_SIZE);
      setReplyAlbumOpen(true);
    } catch {
      setThreadNotice("相册打不开，请重试");
    } finally {
      setReplyAlbumLoading(false);
    }
  }

  async function loadMoreReplyAlbumSilently(): Promise<void> {
    if (replyAlbumLoadingMore || !replyAlbumHasMore) return;
    setReplyAlbumLoadingMore(true);
    try {
      const page = await fetchReplyAlbumPage(replyAlbumOffset);
      setReplyAlbumAssets((prev) => [...prev, ...page]);
      setReplyAlbumOffset((prev) => prev + page.length);
      setReplyAlbumHasMore(page.length === REPLY_ALBUM_PAGE_SIZE);
    } catch {
      // 静默失败：滚到底会重新触发，不打断浏览（对话窗口同款语义）。
    } finally {
      setReplyAlbumLoadingMore(false);
    }
  }

  // 文件名后缀 → MIME（对话窗口同款：iPhone 默认 HEIC，不带 mimeType 会被
  // 服务端字节检测挡掉，"选完发不出去"的根因）。
  function replyMimeFromFilename(filename: string | undefined): string | undefined {
    const ext = filename?.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "heic": return "image/heic";
      case "heif": return "image/heif";
      case "jpg": case "jpeg": return "image/jpeg";
      case "png": return "image/png";
      case "gif": return "image/gif";
      case "webp": return "image/webp";
      default: return undefined;
    }
  }

  // 点选即 resolve 原图（单张 iCloud 等待跟系统相册一致），多选上限 6 张。
  async function toggleReplyAlbumAsset(thumb: { id: string; width: number; height: number }): Promise<void> {
    const selectedIndex = replyImages.findIndex((img) => img.assetId === thumb.id);
    if (selectedIndex >= 0) {
      setReplyImages((prev) => prev.filter((_, i) => i !== selectedIndex));
      return;
    }
    if (replyImages.length >= REPLY_IMAGE_MAX) {
      setThreadNotice("评论最多 6 张图片");
      return;
    }
    if (replyAlbumResolvingId) return;
    setReplyAlbumResolvingId(thumb.id);
    setThreadNotice(null);
    try {
      const asset = new Asset(thumb.id);
      const [uri, filename] = await Promise.all([asset.getUri(), asset.getFilename().catch(() => undefined)]);
      if (!uri) { setThreadNotice("这张照片读取失败，请重试或换一张"); return; }
      const mimeType = replyMimeFromFilename(filename);
      setReplyImages((prev) => [...prev, { uri, width: thumb.width, height: thumb.height, assetId: thumb.id, ...(filename ? { fileName: filename } : {}), ...(mimeType ? { mimeType } : {}) }]);
    } catch {
      setThreadNotice("这张照片读取失败，请重试或换一张");
    } finally {
      setReplyAlbumResolvingId(undefined);
    }
  }

  // REPLY-IMAGE-001: 回复图片全屏查看（react-native-image-viewing，原图 play 路由）。
  function openReplyViewer(reply: PostReply, index: number): void {
    const uris = (reply.media ?? []).map((m) => localNet.resolveMediaUrl(`/v1/media/play/${encodeURIComponent(m.mediaAssetId)}`)).filter((uri) => uri !== "");
    if (uris.length === 0) return;
    setReplyViewer({ uris, index: Math.min(Math.max(index, 0), uris.length - 1) });
  }

  async function submitReply(): Promise<void> {
    if (!threadPostId || replying || replyUploading) return;
    const body = replyDraft.trim();
    if (!body && replyImages.length === 0) return;
    setReplying(true);
    setReplyUploading(replyImages.length > 0);
    setEngagementError(undefined);
    try {
	  const postId = threadPostId;
      const refs: Array<{ mediaAssetId: string; sortOrder: number }> = [];
      for (let i = 0; i < replyImages.length; i++) {
        const img = replyImages[i]!;
        const uploaded = await mediaClient.uploadImage({ uri: img.uri, width: img.width, height: img.height, ...(img.fileName ? { fileName: img.fileName } : {}), ...(img.mimeType ? { mimeType: img.mimeType } : {}) });
        refs.push({ mediaAssetId: uploaded.mediaAssetId, sortOrder: i });
      }
	  await engagement.replyToPost(postId, body, refs);
	  const [truthResult, listResult] = await Promise.allSettled([engagement.getPostEngagement(postId), engagement.listPostReplies(postId, 50)]);
	  if (truthResult.status === "fulfilled") setPostEngagement((previous) => mergePostEngagement(previous, [truthResult.value]));
	  if (listResult.status === "fulfilled") {
		setPostReplies((previous) => ({ ...previous, [postId]: listResult.value.replies }));
		setPostEngagement((previous) => previous[postId] ? ({ ...previous, [postId]: { ...previous[postId], replies: listResult.value.count } }) : previous);
	  }
      // 发出去之后留在详情页（Threads 同款）；这条草稿已经发出去了，删掉。
      delete cachedReplyDrafts[postId];
      setReplyDraft("");
      setReplyImages([]);
    } catch (error) {
      setEngagementError(mapEngagementError(error, "回复没有提交成功，请检查连接后重试。"));
    } finally {
      setReplying(false);
      setReplyUploading(false);
    }
  }


  function renderPostCard(post: FeedPost, options: { showReplyPreview: boolean }): React.JSX.Element {
          const quoted = findQuote(post);
          // ACTIVITY-REF-001：活动引用（contextId = activityId）。解析到就画活动
          // 卡片；解析不到（活动已下架 / 列表没拉到）画一张说明卡，不画裸 id。
          const activityRefId = referencedActivityId(post);
          const referencedActivity = activityRefId ? activityById.get(activityRefId) : undefined;
          const items = mediaFor(post.postId);
          const name = resolveAuthorDisplayName(post, viewerAccountId, viewerDisplayName);
          // MEDIA-PIPELINE-001: 头像走统一管线（本人/AI 账号/AI 人像/首字）。
          const avatar = resolveAuthorAvatar(
            { authorType: post.authorType, authorId: post.authorId },
            { baseUrl: localApiBaseUrl, viewerAccountId, viewerAvatarUri: isOwnPost(post) ? viewerAvatarUri : undefined, avatarSource: isOwnPost(post) ? viewerAvatarUri ? { uri: viewerAvatarUri } : undefined : undefined, aiAccountsById, humanAvatarsById, displayName: name }
          );
          const meta = AUTHOR_TYPE_META[post.authorType];
          // FEED-PROFILE-AVATAR-001：帖子上有头像，点进主页必须同一个 —— 把解出来的
          // 远端 uri 顺手带给个人主页（只有 {uri} 串能带，打包图 number 带不过去，就不带）。
          const profileAvatarUri = avatar.kind === "image" && typeof avatar.source === "object" && avatar.source !== null && typeof (avatar.source as { uri?: unknown }).uri === "string"
            ? (avatar.source as { uri: string }).uri
            : undefined;
          const isFollow = following.has(post.authorId);
          const isLiked = liked.has(post.postId);
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
          // ACTIVITY-REF-001：活动实体引用走下面的活动卡片，不进 chip 行 ——
          // 否则 chip 文案会印出一行裸 activityId。
          const chips = labelContextRefs(post);
          return (
            <View
              key={post.postId}
              style={styles.postCard}
              onLayout={(event) => { const ly = event?.nativeEvent?.layout; if (ly) { setCardYs((prev) => ({ ...prev, [post.postId]: ly.y })); setCardHeights((prev) => ({ ...prev, [post.postId]: ly.height })); } }}
            >
              {/* posthead — R15.69 (restored) 拆头像/名字为 2 个 Pressable:
                  点头像 弹 关注/访问个人主页 菜单 (openProfileActions),
                  点名字 直接访问个人主页 (onOpenProfile). */}
              <View style={styles.postHead}>
                <Pressable
                  accessibilityLabel={`${name} 的操作`}
                  onPress={(event) => void openProfileActions({ userId: post.authorId, name, city: post.cityScope, posts: posts.filter((candidate) => candidate.authorId === post.authorId), mediaByPost: media, ...(profileAvatarUri ? { avatarUri: profileAvatarUri } : {}), anchor: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY } })}
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
                      // AVATAR-FALLBACK-TINT-001：没有头像 → 按 id 的柔和底色 + 首字，不再是 #111 黑圆。
                      <View style={[styles.postAvatar, { backgroundColor: initialAvatarTint(post.authorId).backgroundColor }]}>
                        <Text selectable style={[styles.postAvatarText, { color: initialAvatarTint(post.authorId).color }]}>{avatar.letter}</Text>
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
                  onPress={() => onOpenProfile?.({ userId: post.authorId, name, city: post.cityScope, posts: posts.filter((candidate) => candidate.authorId === post.authorId), mediaByPost: media, ...(profileAvatarUri ? { avatarUri: profileAvatarUri } : {}) })}
                  style={styles.postIdentityPressable}
                >
                <View style={styles.postIdentity}>
                  <View style={styles.postNameLine}>
                    <Text selectable style={styles.postName}>{name}</Text>
                    <Text selectable style={styles.postMeta}>· {relativeTime(post.createdAt)}</Text>
                  </View>
                  {meta.label ? <Text selectable style={styles.postMeta}>{meta.label}</Text> : null}
                  {meta.aiBadge ? <Text selectable style={styles.aiBadge}>AI生成</Text> : null}
                </View>
                </Pressable>
                <Pressable
                  accessibilityLabel="更多"
                  onPress={() => openPostMenu(post.postId)}
                  style={styles.postMenu}
                >
                  <Text selectable style={styles.postMenuText}>⋯</Text>
                </Pressable>
              </View>

              <View style={styles.postBody}>
                <Text selectable style={styles.postReason}>{meta.reason}</Text>
                <Text selectable style={styles.postCopy}>{post.body}</Text>

              {/* 服务端媒体（READY Hydrate）：多图横滑轨 / 单图全宽 / 视频内联自动播放（X 式，滑近中心播、滑出停，带声音） */}
              {/* MEDIA-EDGE-BLEED-002（2026-09-20）：静止态要跟文字缩进对齐，
                  但横滑之后要能滑到屏幕真正左边缘——单靠"不破出屏幕"做不到，
                  因为 ScrollView 的可视区本身也会被限制在缩进内，滑多远都露不出
                  缩进线以外的像素。所以这里恢复 postMediaBleed 破出去（可视区
                  撑到真正的屏幕左边缘），但把等量的留白（68 = postCard.paddingLeft
                  14 + postBody.paddingLeft 54）转移到 AdaptiveMediaCollection 内部
                  的 leadingInset —— 只在静止态（第 1 张）生效，横滑到第 2 张起就
                  不再补这段留白，卡片能贴到破出去的容器左边缘。单图没有横滑这个
                  动作，不套 bleed，跟文字一样停在缩进线上。 */}
              {items.length > 1 ? (
                <View style={styles.postMediaBleed}>
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
                    leadingInset={68}
                  />
                </View>
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
                      <Text selectable style={[styles.contextRefText, index === 0 && styles.contextRefTextStrong]}>{entry.contextType === "REALITY_SCENE" ? "查看场景 ›" : entry.contextId}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* ACTIVITY-REF-001 — 活动引用卡片（服务端 contextRef ACTIVITY +
                  relationType REFERS_TO）。判定是白名单，只有明确带标记的才算引用；
                  分类标签（AUTO_CLASSIFIED / 老 seed 的人话行）继续走 chip 行。
                  解析不到时**不画 id**：说清「已不可用」，与「活动叫这个名字」区分开。 */}
              {activityRefId ? (
                referencedActivity ? (
                  <Pressable
                    accessibilityLabel={`查看活动 ${referencedActivity.title}`}
                    disabled={!onOpenActivity}
                    onPress={() => onOpenActivity?.(referencedActivity.activityId)}
                    style={styles.activityRefCard}
                  >
                    <View style={styles.activityRefHead}>
                      <ProxyIcon color={color.violet} name="ticket" size={14} />
                      <Text selectable style={styles.activityRefKicker}>活动</Text>
                      {onOpenActivity ? <Text selectable style={styles.activityRefMore}>查看 ›</Text> : null}
                    </View>
                    <Text selectable numberOfLines={2} style={styles.activityRefTitle}>{referencedActivity.title}</Text>
                    <Text selectable style={styles.activityRefMeta}>
                      {referencedActivity.time} · {referencedActivity.venueIcon} {referencedActivity.venueName} · 已报名 {referencedActivity.joined}{referencedActivity.capacity === undefined ? "" : `/${referencedActivity.capacity}`}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.activityRefCard}>
                    <View style={styles.activityRefHead}>
                      <ProxyIcon color={color.violet} name="ticket" size={14} />
                      <Text selectable style={styles.activityRefKicker}>活动</Text>
                    </View>
                    <Text selectable style={styles.activityRefMissing}>引用的活动已不可用（已结束或已下架）</Text>
                  </View>
                )
              ) : null}

              {/* X 式引用帖文（quote card：服务端 contextRef QUOTE_POST） */}
              {quoted ? (
                <View style={styles.quoteCard}>
                  <View style={styles.quoteHead}>
                    <View style={styles.quoteAvatar}>
                      <Text selectable style={styles.quoteAvatarText}>{resolveAuthorDisplayName(quoted, viewerAccountId, viewerDisplayName).charAt(0)}</Text>
                    </View>
                    <Text selectable style={styles.quoteAuthor}>{resolveAuthorDisplayName(quoted, viewerAccountId, viewerDisplayName)}</Text>
                    <Text selectable style={styles.quoteMeta}>引用帖文</Text>
                  </View>
                  <Text selectable numberOfLines={2} style={styles.quoteBody}>{quoted.body}</Text>
                  {mediaFor(quoted.postId)[0] ? <Text selectable style={styles.quoteMediaLabel}>🎞 含媒体附件</Text> : null}
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

              {/* FEED-ACTION-ICONS-001: 喜欢/回复/分享以前全是纯文字
                  （"回复 3"/"分享"），喜欢那颗心也只是 ♥/♡ 两个字符塞进
                  Text——不是图标，字重跟着字号变形，且比同一屏其它按钮的图标
                  风格不统一。换成 ProxyIcon，跟真实社交 App 的操作行一致：
                  喜欢/回复带数字，分享只是图标，不用文字解释。
                  FEED-ACTION-DEDUP-001（用户：「帖文为什么有重复的...2个
                  按钮，保持一个，并且移除书签logo和引用logo」）：引用（打开
                  编辑器预填这条帖子）跟分享都是"把这条帖子传出去"，功能重复；
                  书签当时写进去了但"收藏"页的动态 tab 还没接读接口，点了收藏
                  看不到任何效果。两个都删，只留分享。引用本身没有消失——写新帖
                  时 ComposerV2Screen 自己的"引用"面板还能选任意帖子引用，只是
                  不再有从这条帖子直接跳转预填的快捷方式。
                  FEED-MENU-DEDUP-001（用户：「还是有2个...logo 在一个帖文里
                  整合下」）：这一行原来还有第 4 个"···"，跟帖头右上角的"⋯"
                  是两套完全独立的菜单（选项还互相有缺）。行内那颗删了，
                  帖头"⋯"（下面 PostMenuModal）是唯一入口，选项合并成
                  不感兴趣/减少这类内容/少看这个人/屏蔽作者/举报五项。 */}
              {/* FEED-ACTION-ICONS-001（用户「对齐原型 下面的logo」）：
                  原型动作行是 4 颗：♡ / 💬 / ↻ / ⇧。原来这行只有 3 颗（少 ↻），而且
                  评论用的是 chat（方角气泡，几何跟回复 tab 的 replyBubble 圆气泡不同）、
                  分享用的是 shareUp（自造上传箭头，跟回复行的 replyShare Feather 路径
                  不同）—— 都是「几何不一致」。现在按 REPLY-ACTION-ICONS-001 在回复行
                  立的那套标准来：4 颗都用 replyLike / replyBubble / replyRepost /
                  replyShare，同源字形、1.8 描边。计数跟 ProfileTabs 一样，没有真相
                 （engagement 没拉到）就回填 0 —— 跟现状保持一致（不编数字）。 */}
              <View style={styles.postActions}>
                <Pressable accessibilityLabel={`喜欢 · ${truth?.reactions ?? 0}`} disabled={engagementBusy.has(`like:${post.postId}`)} onPress={() => void toggleLike(post.postId)} style={styles.postAction}>
                  <ProxyIcon color={isLiked ? color.magenta : color.ink} filled={isLiked} name="replyLike" size={18} />
                  <Text selectable style={[styles.postActionCount, isLiked && styles.postActionOn]}>{truth?.reactions ?? 0}</Text>
                </Pressable>
                <Pressable accessibilityLabel={`查看评论 · ${truth?.replies ?? 0}`} onPress={() => openThread(post.postId)} style={styles.postAction}>
                  <ProxyIcon color={color.ink} name="replyBubble" size={18} />
                  <Text selectable style={styles.postActionCount}>{truth?.replies ?? 0}</Text>
                </Pressable>
                <Pressable accessibilityLabel={`转发 · ${truth?.reposts ?? 0}`} disabled={engagementBusy.has(`repost:${post.postId}`)} onPress={() => void repost(post.postId)} style={styles.postAction}>
                  <ProxyIcon color={color.ink} name="replyRepost" size={18} />
                  <Text selectable style={styles.postActionCount}>{truth?.reposts ?? 0}</Text>
                </Pressable>
                <Pressable accessibilityLabel="分享帖子" onPress={() => openSharePanel(post)} style={styles.postAction}>
                  <ProxyIcon color={color.ink} name="replyShare" size={18} />
                </Pressable>
              </View>
              {/* 转发失败要看得见、能重试 —— 和 ProfileTabs.repostFailed 同形。 */}
              {repostFailed.has(post.postId) ? (
                <Pressable accessibilityLabel="重试转发" onPress={() => void repost(post.postId)} style={styles.postActionRetry}>
                  <Text selectable style={styles.postActionRetryText}>转发没有提交成功，点这里重试。</Text>
                </Pressable>
              ) : null}
		  {options.showReplyPreview && shownReplies.length > 0 ? (
			<View style={styles.postReplies}>
			  {shownReplies.map((reply) => (
				<View key={reply.replyId} style={styles.postReply}>
				  {/* FEED-REPLY-001: 显示作者名，绝不回显 actorId。 */}
				  <Text selectable style={styles.postReplyAuthor}>{resolveReplyAuthorDisplayName(reply, viewerAccountId, viewerDisplayName)}</Text>
				  <Text selectable style={styles.postReplyBody}>{reply.body}</Text>
				  {/* REPLY-IMAGE-001: 评论图片缩略图，点开全屏查看器。 */}
				  {reply.media && reply.media.length > 0 ? (
				    <View style={styles.replyMediaRow}>
				      {reply.media.map((m, mediaIndex) => {
				        const source = resolveAssetSource({ kind: "mediaId", id: m.mediaAssetId }, { baseUrl: localApiBaseUrl });
				        if (!source || typeof source === "number") return null;
				        return (
				          <Pressable
				            key={`${reply.replyId}:${m.mediaAssetId}:${mediaIndex}`}
				            accessibilityLabel="查看评论图片"
				            onPress={() => openReplyViewer(reply, mediaIndex)}
				            style={styles.replyMediaCell}
				          >
				            <Image source={source} style={styles.replyMediaThumb} />
				          </Pressable>
				        );
				      })}
				    </View>
				  ) : null}
				</View>
			  ))}
			  {offerReplyToggle && !repliesExpanded ? (
				<Pressable accessibilityLabel="查看全部回复" hitSlop={8} onPress={() => toggleReplies(post.postId)}>
				  <Text selectable style={styles.postRepliesMore}>查看其余 {collapsedReplies} 条回复</Text>
				</Pressable>
			  ) : null}
			  {offerReplyToggle && repliesExpanded ? (
				<Pressable accessibilityLabel="收起回复" hitSlop={8} onPress={() => toggleReplies(post.postId)}>
				  <Text selectable style={styles.postRepliesMore}>收起回复</Text>
				</Pressable>
			  ) : null}
			</View>
		  ) : null}


              {/* FEED-POST-CLEAN-001：帖子卡底部的两个 CTA 按钮已移除 —— 产品要求
                  所有帖文都不显示，保持清爽。原先只对 AGENT 帖（城市同行）渲染，
                  所以此前只有部分帖文带这两个按钮。 */}

              </View>
            </View>
          );
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
      // FOLLOW-STATE-HYDRATE-001: 记下用户自己的决定。回读可能在这次 toggle 之前就
      // 发出了（读到的还是旧值），并回去会把「刚取消关注」翻成「已关注」。
      followDecisionsRef.current.set(profileActions.userId, !profileFollowing);
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

  // FEED-MENU-DEDUP-001（用户：「还是有2个...logo 在一个帖文里 整合下」）：
  // 帖头 ⋯（PostMenuModal：不感兴趣/举报/屏蔽作者）跟操作行 ···（内嵌
  // contextMenu：不感兴趣/减少这类内容/少看这个人/举报）是两套独立菜单，
  // 同一条帖子上露两个"更多"入口，选项还互相有缺——合并成一个，这两条
  // （减少这类内容/少看这个人）是原来那套独有的，搬进来补全。跟
  // 不感兴趣/举报/屏蔽作者不同：这两条只是记偏好信号，不摘帖子，所以
  // 用 engagementNotice 给个"记下了"的反馈，而不是 postMenuError 那条
  // （那条是给失败用的）。
  async function handleReduceTopic(): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    try {
      await engagement.recordFeedPreference(postMenuPost.postId, "REDUCE_TOPIC");
      setEngagementNotice("已记录：将减少推荐类似内容。");
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleReduceAuthor(): Promise<void> {
    if (!postMenuPost) return;
    setPostMenuError(undefined);
    try {
      await engagement.recordFeedPreference(postMenuPost.postId, "REDUCE_AUTHOR", postMenuPost.authorId);
      setEngagementNotice("已记录：将减少推荐此作者。");
      closePostMenu();
    } catch (err) {
      setPostMenuError(err instanceof Error ? err.message : "操作失败");
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

  // 偏好权重归一函数已删除（FEED-TIME-SORT-001）：时间线只按创建时间倒序。
  // feedPrefs.weights 还存在（偏好页照常读写），但排序不再消费 —— 类目偏好
  // 不再决定先后，自己的帖子也不再加分。

  // `scope` is a parameter (not feedPrefs.scope) so the banner can ask "how many
  // posts would I see without the time filter?" using the exact same predicate —
  // the count and the filter can never drift apart again.
  const getVisibleForTab = (forTab: FeedTab, scope: FeedScope = feedPrefs.scope): FeedPost[] =>
    posts.filter((post) => {
      // 偏好-时间范围：7D/30D 按创建时间过滤，长期不过滤（FEED-SCOPE-001）。
      if (!isPostWithinScope(post.createdAt, scope)) return false;
      // 偏好-不想看：主题切词命中正文/上下文/作者即隐藏。
      if (feedPrefs.muted.length > 0) {
        const haystack = [resolveAuthorDisplayName(post, viewerAccountId, viewerDisplayName), post.body, ...contextRefLabels(post)]
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
        photo: (p) => contextRefLabels(p).some((label) => label.includes("摄影") || label.includes("拍照")),
        opportunity: isOpportunityPost,
        merchant: (p) => p.authorType === "MERCHANT",
        startup: (p) => contextRefLabels(p).some((label) => label.includes("创业") || label.includes("AI"))
      };
      const checker = feedMap[selectedCustomFeed];
      if (checker) {
        if (!checker(post)) return false;
      } else if (customFeedTokens.length > 0) {
        // AI 生成的自定频道（id=ai_…）：内置 feedMap 没有规则，
        // 用频道名+描述切词做本地过滤；之前直接看全部。
        const haystack = [resolveAuthorDisplayName(post, viewerAccountId, viewerDisplayName), post.body, ...contextRefLabels(post)]
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
  // TAB-SWITCH-JANK-001: 过滤+权重+排序是纯派生——以前每次 setState（注水每条
  // 评论都 set 一次）全量重跑。用 useMemo 钉死输入，注水只重渲染行，不重算。
  // FEED-TIME-SORT-001（2026-09-25，用户：「公共帖文让测试账户帖文展示最上面，
  // 这个不对，按时间排序就可以」）：时间线按创建时间倒序，不再按偏好权重重排，
  // 也不再给自己的帖子加分 —— 刚发的（谁的都一样）自然在上面，老帖沉底，
  // 谁都不置顶。feedPrefs.weights 还存着（偏好页照常写），但排序不再消费它。
  const { visible, scopeHiddenCount } = useMemo(() => {
    const unranked = getVisibleForTab(tab);
    const ranked = [...unranked].sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
      return 0;
    });
    return {
      visible: ranked,
      scopeHiddenCount: isFeedScopeActive(feedPrefs.scope)
        ? getVisibleForTab(tab, "PERSISTENT").length - unranked.length
        : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, tab, feedPrefs, following, feedFilter, selectedCustomFeed, customFeedTokens, viewerAccountId]);
  // FEED-SCOPE-001: 时间范围是相对 Date.now() 滚动的，帖文会一天天无声消失 ——
  // 实测默认 7D 隐藏了 62% 的帖文，而时间线上没有任何提示，看起来就是「数据丢了」。
  // 生效时把「正在筛选」和「藏了多少」摆出来，并给一个一键看全部的出口。
  const clearScopeFilter = useCallback(() => {
    const next = { ...feedPrefs, scope: "PERSISTENT" as const };
    setFeedPrefs(next);
    writeFeedPrefs(next);
  }, [feedPrefs]);
  const viewerPost = viewer ? posts.find((post) => post.postId === viewer.postId) : undefined;
  const viewerItems = viewerPost ? mediaFor(viewerPost.postId) : [];

  if (customFeedHubOpen) {
    return <CustomFeedHub onBack={() => setCustomFeedHubOpen(false)} onOpenFeed={(id) => { setSelectedCustomFeed(id); setFeedFilter("ALL"); setCustomFeedHubOpen(false); }} />;
  }

  // POST-THREAD-001（2026-09-28，用户「点击评论 弹出整个帖文和输入框 输入
  // 重复 并且没有数字按键 直接输入框」+ 确认用系统真键盘）：原型
  // proxy_comment_keyboard_v2.html 的评论抽屉只有「拖动把手 + 输入框」——没有
  // 帖文回顾、没有评论列表。上一版又手多加了整帖内容 + 全部评论，跟背后动态
  // 列表里本来就能看到的东西重复，删掉；抽屉只负责写新评论，不负责展示旧的。
  // 键盘用系统真键盘（自带 123/表情/语音），不照抄原型那套自绘 26 键假键盘；
  // 右侧图片/表情/GIF 三个工具图标同理不画——ReplyToPost 命令只收纯文本
  // body，没有附件字段，没有真能力支撑的图标不画。
  const threadPost = threadPostId ? posts.find((candidate) => candidate.postId === threadPostId) : undefined;
  const threadAuthorName = threadPost ? resolveAuthorDisplayName(threadPost, viewerAccountId, viewerDisplayName) : "";

  const bottomPad = bottomNavVisible === false ? 16 : 120;
  return (
    <View style={styles.root}>
    <ScrollView
      ref={scrollRef}
      refreshControl={<RefreshControl refreshing={feedPull.refreshing} onRefresh={feedPull.onRefresh} />}
      style={styles.scrollRoot}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
      onScroll={onFeedScroll}
      onLayout={(event) => { const ly = event?.nativeEvent?.layout; if (ly) setViewportHeight(ly.height); }}
      scrollEventThrottle={16}
      // 动态列表里唯一会聚焦的输入框是搜索框（r153search）；回复输入框已经
      // 搬到独立的帖子详情页（POST-THREAD-001），不再需要这个 ScrollView 顶
      // 它。这三条键盘避让配置留给搜索框继续用：
      //   - automaticallyAdjustKeyboardInsets：键盘出现时收 ScrollView 的
      //     contentInset，聚焦的输入框才会被滚进可见区（只调 inset 不会自动滚）。
      //   - keyboardShouldPersistTaps="handled"：不加这个，键盘开着时第一次点
      //     搜索结果里的按钮只会被当成"收起键盘"，按钮根本点不动。
      //   - on-drag：往下拖即可收键盘，符合流媒体 App 的手感。
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {/* R15.3 feedhead：≡ + 标题 + ＋ */}
      <View style={styles.feedHead}>
        <Text selectable style={styles.feedTitle}>动态</Text>
        <View style={styles.feedTools}>
          <Pressable accessibilityLabel="定制频道" onPress={() => setCustomFeedHubOpen(true)} style={styles.iconBtn}>
            <Text selectable style={styles.iconBtnText}>≡</Text>
          </Pressable>
          <Pressable accessibilityLabel={searchOpen ? "关闭动态搜索" : "搜索动态"} onPress={() => setSearchOpen((value) => !value)} style={styles.iconBtn}>
            <ProxyIcon color={color.ink} name="search" size={18} />
          </Pressable>
          <Pressable onPress={toggleEmbeddedComposer} style={styles.iconBtn}>
            <Text selectable style={styles.iconBtnText}>{composerOpen ? "×" : "＋"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionTabs}>
        {SECTIONS.map((entry) => {
          const active = section === entry.id;
          return (
            <Pressable key={entry.id} onPress={() => setSection(entry.id)} style={[styles.sectionTab, active && styles.sectionTabOn]}>
              {/* ICON-INK-001（2026-09-26，用户：「logo不能发灰 必须黑 对齐 threads
                  风格」）：未选中那格原来用 color.muted —— 截图里量到字形最深像素
                  (124,117,133)，确实是灰的。改成 ink：**字形恒为黑**，选中态由
                  「ink 底 + 白字」那个药丸承担，不靠图标变灰。
                  尺寸 16 → 18 对齐同屏下面那行分类胶囊（18px / ink），用户对那行的
                  观感是认可的；16px 时 32 栅格字形的描边只有 0.95px，太细，即使颜色
                  是 ink 也会被抗锯齿读成灰（推荐那颗星实测最深 25% 平均 (176,173,180)）。 */}
              <ProxyIcon color={active ? color.white : color.ink} name={entry.icon} size={18} />
              <Text selectable style={[styles.sectionTabText, active && styles.sectionTabTextOn]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {scopeHiddenCount > 0 ? (
        <View style={styles.scopeBanner} testID="feed-scope-banner-v1">
          <Text selectable style={styles.scopeBannerText}>
            正在按「{feedScopeLabel(feedPrefs.scope)}」筛选 · 已隐藏 {scopeHiddenCount} 篇更早的
          </Text>
          <Pressable accessibilityLabel="显示全部帖文" onPress={clearScopeFilter}>
            <Text selectable style={styles.scopeBannerAction}>显示全部</Text>
          </Pressable>
        </View>
      ) : null}

      {section === "CAFE" ? (
        <CoffeeScenesHub />
      ) : (
      <>
      {selectedCustomFeed ? (
        <View style={styles.customFeedBanner}>
          <Text selectable style={styles.customFeedBannerText}>定制频道 · {CUSTOM_FEED_LABELS[selectedCustomFeed] ?? customFeedDef?.name ?? selectedCustomFeed}</Text>
          <Pressable onPress={() => setSelectedCustomFeed(null)}>
            <Text selectable style={styles.customFeedBannerAction}>退出频道</Text>
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
        {searchQuery ? <Pressable accessibilityLabel="清空动态搜索" onPress={() => setSearchQuery("")}><Text selectable style={styles.searchArrow}>×</Text></Pressable> : null}
      </View> : null}

      {/* R15.3 networktabs：2 列（推荐 / 关注） */}
      <View style={styles.tabs}>
        {TABS.map((entry) => {
          const active = tab === entry.id;
          return (
            <Pressable key={entry.id} onPress={() => setTab(entry.id)} style={styles.tabItem}>
              {/* 尺寸与间距跟同屏上面的分段控件 sectionTab 取同一套（18pt / gap 5）——
                  两行图标在同一个屏幕上必须是同一个系统。
                  ICON-INK-001（用户：「logo不能发灰 必须黑 对齐 threads 风格」）：
                  字形颜色不再跟选中态走 —— 未选中那栏也是 ink。这条**推翻**了
                  SEC-CATEGORY-ICONS-001 当初「图标要跟选中态走」的判断，理由写在
                  sec-category-icons.test.ts 那条钉上。 */}
              <ProxyIcon color={color.ink} name={entry.icon} size={18} />
              <Text selectable style={[styles.tabText, active && styles.tabTextActive]}>{entry.label}</Text>
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
        items={FILTERS.map((f) => ({ id: f.id, label: f.label, ...(f.icon ? { icon: f.icon } : {}) }))}
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
          <Text selectable style={styles.prefHintTitle}>按时间排序</Text>
          <Text selectable style={styles.prefHintSub}>新的在上 · 筛选和屏蔽依然有效</Text>
        </View>
        <Pressable onPress={onOpenFeedPrefs}>
          <Text selectable style={styles.prefHintBtn}>调整 ›</Text>
        </Pressable>
      </View>

      {/* 新更新提示条 */}
      {pendingCount > 0 ? (
        <Pressable onPress={showLatest} style={styles.updateBanner}>
          <Text selectable style={styles.updateBannerText}>{pendingCount} 条更新 · 点击查看最新</Text>
        </Pressable>
      ) : null}

      {/* 发布器 v2 — 全部状态/上传/草稿都在 ComposerV2Screen 内部，父组件只透传 trigger */}
      <ComposerV2Screen
        localNet={localNet}
        mediaClient={mediaClient}
        {...(activityClient ? { activityClient } : {})}
        secureSessionStore={secureSessionStore}
        viewerAccountId={viewerAccountId}
        onClose={() => setComposerOpen(false)}
        onPublished={async () => { setComposerOpen(false); await loadFeed(undefined, true); }}
        posts={posts}
        visible={composerOpen}
      />

      {engagementError ? <Text selectable style={styles.engagementError}>{engagementError}</Text> : null}
      {engagementNotice ? <Text selectable style={styles.engagementNotice}>{engagementNotice}</Text> : null}
      {phase === "LOADING" ? (
        <View style={styles.feedEmpty}>
          <ProxyLoading tone="brand" />
          <Text selectable style={styles.feedEmptyText}>正在读取本地动态（ListFeedPosts）…</Text>
        </View>
      ) : phase === "ERROR" ? (
        <View style={styles.feedEmpty}>
          <Text selectable style={styles.feedEmptyText}>读模型暂时不可用（本地 API 未连接？）。</Text>
          {lastFeedError ? <Text selectable style={[styles.feedEmptyText, { marginTop: 8, color: color.error }]}>{lastFeedError}</Text> : null}
          <Pressable onPress={() => void loadFeed(undefined, true)} style={styles.retryBtn}>
            <Text selectable style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.feedEmpty}>
          <Text selectable style={styles.feedEmptyText}>
			{feedFilter !== "ALL"
			  ? `当前筛选下没有足够内容。换个筛选，或直接搜索你想找的东西。`
			  : "这里还没有足够的动态。关注本地的人和商家后会更有用。"}
          </Text>
        </View>
      ) : (
        <>
          {visible.map((post) => renderPostCard(post, { showReplyPreview: true }))}
        {loadingMore ? (
          <View style={styles.feedEmpty}>
            <ProxyLoading tone="brand" />
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
          author={resolveAuthorDisplayName(viewerPost, viewerAccountId, viewerDisplayName)}
          resolveUrl={(path) => localNet.resolveMediaUrl(path)}
          onNavigate={(next) => {
            setMediaPositions((current) => ({ ...current, [viewer.postId]: next }));
            setViewer({ postId: viewer.postId, index: next });
          }}
          onClose={() => setViewer(null)}
          // CONTENT-ANALYTICS-001: 看别人的照片才记停留 / 放大；自己看自己不算浏览。
          analytics={isOwnPostById(viewerPost, viewerAccountId) ? undefined : localNet}
        />
      ) : null}
      {/* REPLY-IMAGE-001：评论图片全屏查看。 */}
      {replyViewer ? (
        <ImageViewing
          images={replyViewer.uris.map((uri) => ({ uri }))}
          imageIndex={replyViewer.index}
          visible
          onRequestClose={() => setReplyViewer(undefined)}
        />
      ) : null}

      </>
      )}

    </ScrollView>
    {stickyHeaderVisible ? (
      <View style={styles.stickyFeedHead}>
        <Text selectable style={styles.stickyFeedTitle}>动态</Text>
        <View style={styles.feedTools}>
          <Pressable accessibilityLabel="定制频道" onPress={() => setCustomFeedHubOpen(true)} style={styles.stickyIconBtn}>
            <Text selectable style={styles.iconBtnText}>≡</Text>
          </Pressable>
          <Pressable accessibilityLabel={searchOpen ? "关闭动态搜索" : "搜索动态"} onPress={() => { setSearchOpen((value) => !value); scrollRef.current?.scrollTo({ y: 0, animated: true }); }} style={styles.stickyIconBtn}>
            <ProxyIcon color={color.ink} name="search" size={17} />
          </Pressable>
          <Pressable onPress={toggleEmbeddedComposer} style={styles.stickyIconBtn}>
            <Text selectable style={styles.iconBtnText}>{composerOpen ? "×" : "＋"}</Text>
          </Pressable>
        </View>
      </View>
    ) : null}
    {section === "POSTS" ? (
      <Pressable accessibilityLabel={composerOpen ? "关闭发布器" : "发布帖文"} onPress={toggleEmbeddedComposer} style={[styles.feedFab, { bottom: bottomNavVisible === false ? 28 : 116 }]}>
        <Text selectable style={styles.feedFabText}>{composerOpen ? "×" : "＋"}</Text>
      </Pressable>
    ) : null}
    {/* POST-THREAD-001：评论抽屉——只有「拖动把手 + 输入框」，跟原型
        proxy_comment_keyboard_v2.html 一样，不重复回顾帖文/评论列表（背后的
        动态列表本来就看得到）。跟 PostMenuModal/SharePostSheet 同一套
        Modal+遮罩写法：点遮罩关闭，点 sheet 内部不关闭（stopPropagation）。
        键盘用系统真键盘——TextInput 聚焦自动弹出，不照抄原型的自绘假键盘。 */}
    <Modal animationType="slide" onRequestClose={closeThread} onShow={focusThreadInput} transparent visible={threadPost !== undefined}>
      <Pressable onPress={closeThread} style={styles.threadBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.threadAvoid}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.threadSheet}>
            <View style={styles.threadDragHandle} />
            <View style={styles.threadComposerBar}>
              {threadEmojiOpen ? (
                <View style={styles.threadEmojiRow}>
                  {THREAD_QUICK_EMOJI.map((emoji) => (
                    <Pressable accessibilityLabel={`插入 ${emoji}`} key={emoji} onPress={() => setReplyDraft((draft) => draft + emoji)} style={styles.threadEmojiKey}>
                      <Text style={styles.threadEmojiText}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.threadComposerPill}>
                <TextInput
                  autoFocus
                  key={threadPostId ?? "closed"}
                  maxLength={500}
                  multiline
                  onChangeText={setReplyDraft}
                  onSubmitEditing={() => { if ((replyDraft.trim() || replyImages.length > 0) && !replying && !replyUploading) void submitReply(); }}
                  placeholder={`回复 ${threadAuthorName}…`}
                  placeholderTextColor={color.muted}
                  ref={threadInputRef}
                  style={styles.threadComposerInput}
                  value={replyDraft}
                />
                <View style={styles.threadComposerTools}>
                  <Pressable accessibilityLabel="添加图片" hitSlop={6} onPress={() => void openReplyAlbum()}>
                    <ProxyIcon color={replyImages.length > 0 ? color.ink : color.muted} name="composerImage" size={20} />
                  </Pressable>
                  <Pressable accessibilityLabel={threadEmojiOpen ? "收起表情" : "表情"} hitSlop={6} onPress={() => setThreadEmojiOpen((open) => !open)}>
                    <ProxyIcon color={threadEmojiOpen ? color.ink : color.muted} name="composerSmile" size={20} />
                  </Pressable>
                  <Pressable accessibilityLabel="GIF" hitSlop={6} onPress={() => setThreadNotice(THREAD_TEXT_ONLY_NOTICE)}>
                    <ProxyIcon color={color.muted} name="composerGif" size={20} />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityLabel={replying || replyUploading ? "发送中" : "发送回复"}
                  disabled={(!replyDraft.trim() && replyImages.length === 0) || replying || replyUploading}
                  onPress={() => void submitReply()}
                  style={[styles.threadComposerSend, ((!replyDraft.trim() && replyImages.length === 0) || replying || replyUploading) && styles.disabled]}
                >
                  {replying || replyUploading ? <ProxyLoading size="small" tone="onDark" /> : <ProxyIcon color={color.white} name="arrowUp" size={16} />}
                </Pressable>
              </View>
              {replyImages.length > 0 ? (
                <ScrollView horizontal contentContainerStyle={styles.replyPreviewRow} showsHorizontalScrollIndicator={false}>
                  {replyImages.map((img, index) => (
                    <View key={`${img.assetId}:${index}`} style={styles.replyPreviewCell}>
                      <Image source={{ uri: img.uri }} style={styles.replyPreviewThumb} />
                      <Pressable
                        accessibilityLabel={`移除第 ${index + 1} 张图片`}
                        hitSlop={8}
                        onPress={() => setReplyImages((prev) => prev.filter((_, i) => i !== index))}
                        style={styles.replyPreviewRemove}
                      >
                        <Text selectable style={styles.replyPreviewRemoveText}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {threadNotice ? <Text selectable style={styles.threadNotice}>{threadNotice}</Text> : null}
            </View>
          </Pressable>
          {/* REPLY-IMAGE-001 相册：只收 IMAGE，多选上限 6 张（对话窗口同款网格语言，
              不要相机位/视频）。选完点完成回到输入框，预览条里可删。 */}
          {replyAlbumOpen ? (
            <Pressable onPress={() => undefined} style={styles.replyAlbumScrim}>
              <View style={styles.replyAlbumSheet}>
                <View style={styles.threadDragHandle} />
                <View style={styles.replyAlbumHead}>
                  <Pressable accessibilityLabel="关闭相册" onPress={() => setReplyAlbumOpen(false)} style={styles.replyAlbumHeadBtn}>
                    <Text selectable style={styles.replyAlbumHeadBtnText}>关闭</Text>
                  </Pressable>
                  <Text selectable style={styles.replyAlbumTitle}>相册</Text>
                  <Pressable
                    accessibilityLabel={replyImages.length > 0 ? `选好了，${replyImages.length} 张` : "选好了"}
                    disabled={replyImages.length === 0}
                    onPress={() => setReplyAlbumOpen(false)}
                    style={styles.replyAlbumHeadBtn}
                  >
                    <Text selectable style={[styles.replyAlbumHeadBtnText, replyImages.length === 0 && styles.replyAlbumHeadBtnTextDisabled]}>
                      {replyImages.length > 0 ? `完成（${replyImages.length}）` : "完成"}
                    </Text>
                  </Pressable>
                </View>
                {replyAlbumLoading ? (
                  <ActivityIndicator color={color.ink} style={styles.replyAlbumSpinner} />
                ) : (
                  <FlatList
                    data={replyAlbumAssets}
                    keyExtractor={(item) => item.id}
                    numColumns={4}
                    columnWrapperStyle={styles.replyAlbumRow}
                    contentContainerStyle={styles.replyAlbumGrid}
                    onEndReachedThreshold={0.4}
                    onEndReached={() => void loadMoreReplyAlbumSilently()}
                    renderItem={({ item }) => {
                      const order = replyImages.findIndex((img) => img.assetId === item.id);
                      const resolving = replyAlbumResolvingId === item.id;
                      return (
                        <Pressable
                          accessibilityLabel={order >= 0 ? `已选第 ${order + 1} 张，点按取消` : "选择这张照片"}
                          disabled={Boolean(replyAlbumResolvingId)}
                          onPress={() => void toggleReplyAlbumAsset(item)}
                          style={styles.replyAlbumTile}
                        >
                          <ExpoImage accessibilityLabel="相册照片" cachePolicy="memory-disk" contentFit="cover" recyclingKey={`reply-album:${item.id}`} source={{ uri: item.id }} style={styles.replyAlbumThumb} transition={0} />
                          {order >= 0 ? (
                            <View pointerEvents="none" style={styles.replyAlbumPicked}>
                              <Text selectable style={styles.replyAlbumPickedText}>{order + 1}</Text>
                            </View>
                          ) : null}
                          {resolving ? (
                            <View pointerEvents="none" style={styles.replyAlbumResolving}>
                              <ActivityIndicator color="#ffffff" />
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    }}
                    ListEmptyComponent={<Text selectable style={styles.replyAlbumEmpty}>相册是空的</Text>}
                    ListFooterComponent={replyAlbumLoadingMore ? <ActivityIndicator color={color.ink} style={styles.replyAlbumSpinner} /> : null}
                  />
                )}
              </View>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
    {/* R15.45: post menu modal (举报 / 不感兴趣 / 屏蔽作者) */}
    <PostMenuModal
      open={postMenuPostId !== undefined}
      post={postMenuPost}
      error={postMenuError}
      onClose={closePostMenu}
      onReport={handleReportPost}
      onNotInterested={handleNotInterested}
      onMuteAuthor={handleMuteAuthor}
      onReduceTopic={handleReduceTopic}
      onReduceAuthor={handleReduceAuthor}
    />
    {/* FEED-SHARE-TO-USER-001: "分享"弹站内联系人列表（弹用户头像可选），
        选中直接发一条私信；列表最下面留一条"更多分享方式"给系统原生分享
        （发外部 App / 复制链接），不砍掉这条现有能力。 */}
    <SharePostSheet
      contacts={shareContacts}
      contactsError={shareContactsError}
      onClose={closeSharePanel}
      onPickContact={(peerUserId) => {
        if (!shareTarget) return;
        void sendPostToUser(shareTarget, resolveAuthorDisplayName(shareTarget, viewerAccountId, viewerDisplayName), peerUserId);
      }}
      onUseSystemShare={() => {
        if (!shareTarget) return;
        shareViaSystemSheet(shareTarget, resolveAuthorDisplayName(shareTarget, viewerAccountId, viewerDisplayName));
      }}
      sendingTo={shareSendingTo}
      target={shareTarget}
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
              <Pressable disabled={profileFollowBusy} onPress={(event) => { event.stopPropagation(); void toggleProfileFollow(); }} style={styles.profileDropPress}><Text selectable style={styles.profileDropText}>{profileFollowBusy ? "处理中…" : profileFollowing ? "✓ 已关注" : "+ 关注"}</Text></Pressable>
            </GlassView>
          ) : null}
          <GlassView glassEffectStyle="clear" isInteractive style={styles.profileGlassDropFull}>
            <Pressable onPress={(event) => { event.stopPropagation(); const target = profileActions; setProfileActions(undefined); if (target) { const { anchor: _anchor, ...profileTarget } = target; onOpenProfile?.(profileTarget); } }} style={styles.profileDropPress}><Text selectable style={styles.profileDropText}>访问个人主页</Text></Pressable>
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
  // SECTION-TAB-SIZE-001（2026-09-26，用户：「顶部的探索 动态可以稍微做大点」）：
  // 字号 12 → 13.5 —— 原型 03 节 .preview-segment 就是 13.5px，也正是同屏下面
  // tab 行 tabText 的档位，两行这才对得上；行高 42 → 46 跟着字号放。
  // 图标尺寸不在这里，在渲染处（两行都 18）。
  sectionTab: { alignItems: "center", borderRadius: 12, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", minHeight: 46, paddingHorizontal: 8 },
  sectionTabOn: { backgroundColor: color.ink },
  sectionTabText: { color: color.muted, fontSize: 13.5, fontWeight: "800" },
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

  // POST-THREAD-001 — 评论抽屉：从底部弹起的 sheet（对齐原型
  // proxy_comment_keyboard_v2.html），不是整屏页面、没有返回箭头/标题栏、
  // 没有帖文回顾/评论列表（那些背后的动态列表本来就看得到，抽屉只负责写新
  // 评论）。遮罩 0.2 透明度黑、sheet 圆角 24（只顶部），高度跟着内容走（拖动
  // 把手 + 一颗输入药丸），不是原型那种给假键盘留位置的固定 60vh。
  threadBackdrop: { backgroundColor: "rgba(0,0,0,0.2)", flex: 1, justifyContent: "flex-end" },
  // KAV 按标准用法撑满（内容沉底）：抽屉输入条位置不变，相册浮层 absolute 才能铺全屏。
  threadAvoid: { flex: 1, justifyContent: "flex-end" },
  threadSheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  threadDragHandle: { alignSelf: "center", backgroundColor: "#E0E0E0", borderRadius: 2, height: 4, marginBottom: 6, marginTop: 10, width: 40 },
  // 原型的输入区是一颗圆角灰色药丸（input-box），输入框 + 发送键都在里面；
  // 原型右侧还有图片/表情/GIF 三个工具图标 + 一套自绘 26 键假键盘——确认过
  // 用系统真键盘（自带 123/表情/语音），且 ReplyToPost 命令只收纯文本 body，
  // 没有附件字段，这三个图标和假键盘都不画。
  threadComposerBar: { paddingBottom: 16, paddingHorizontal: 16, paddingTop: 4 },
  threadComposerPill: { alignItems: "center", backgroundColor: "#F0F0F0", borderRadius: 22, flexDirection: "row", gap: 12, minHeight: 44, paddingLeft: 16, paddingRight: 8, paddingVertical: 6 },
  threadComposerInput: {
    color: color.ink,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 100,
    minHeight: 24,
    paddingVertical: 0
  },
  threadComposerSend: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, height: 32, justifyContent: "center", marginLeft: 4, width: 32 },
  // 原型 .right-tools：图片/表情/GIF 三个 20pt 灰图标，间距 12，靠右贴着发送键。
  threadComposerTools: { alignItems: "center", flexDirection: "row", gap: 12 },
  threadEmojiRow: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 8, paddingHorizontal: 4 },
  threadEmojiKey: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  threadEmojiText: { fontSize: 24 },
  threadNotice: { color: color.muted, fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
  // REPLY-IMAGE-001 评论图片：发送前预览条 + 相册浮层 + 回复行缩略图。
  replyPreviewRow: { gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  replyPreviewCell: { height: 72, width: 72 },
  replyPreviewThumb: { borderRadius: 12, height: 72, width: 72 },
  replyPreviewRemove: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 11, height: 22, justifyContent: "center", position: "absolute", right: -6, top: -6, width: 22 },
  replyPreviewRemoveText: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 16 },
  replyAlbumScrim: { backgroundColor: "rgba(0,0,0,0.45)", bottom: 0, justifyContent: "flex-end", left: 0, position: "absolute", right: 0, top: 0 },
  replyAlbumSheet: { backgroundColor: color.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "78%", paddingBottom: 20 },
  replyAlbumHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  replyAlbumHeadBtn: { minWidth: 64 },
  replyAlbumHeadBtnText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  replyAlbumHeadBtnTextDisabled: { color: color.muted },
  replyAlbumTitle: { color: color.ink, fontSize: 15, fontWeight: "800" },
  replyAlbumGrid: { paddingHorizontal: 12 },
  replyAlbumRow: { gap: 8, marginBottom: 8 },
  replyAlbumTile: { alignItems: "center", aspectRatio: 1, backgroundColor: color.surface, borderRadius: 10, flex: 1, justifyContent: "center", maxWidth: "23.5%", overflow: "hidden" },
  replyAlbumThumb: { borderRadius: 10, height: "100%", width: "100%" },
  replyAlbumPicked: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, height: 24, justifyContent: "center", position: "absolute", right: 6, top: 6, width: 24 },
  replyAlbumPickedText: { color: color.white, fontSize: 12, fontWeight: "800" },
  replyAlbumResolving: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  replyAlbumSpinner: { marginVertical: 16 },
  replyAlbumEmpty: { color: color.muted, fontSize: 13, paddingVertical: 24, textAlign: "center" },
  replyMediaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  replyMediaCell: { borderRadius: 8, height: 72, overflow: "hidden", width: 72 },
  replyMediaThumb: { height: 72, width: 72 },

  // 基线 .preview-tabs（原型 deepseek_html_20260926_9d241a.html「图标系统 · 完整版」
  // 手机内预览那一节，就是本行这一处）：
  //   容器 display:flex; gap:24px; border-bottom:1px solid var(--line); padding-left:4px
  //   子项 padding:8px 4px 14px; font-size:13.5px
  //   下划线 left:0; right:0; bottom:-1px; height:3px; border-radius:2px
  // 旧实现是「flex:1 平分 + 下划线 left/right:28%」，于是两个标签被推到左右两端、
  // 下划线只占中间一小段 —— 原型是「贴着左边、彼此间隔 24」，这就是「没对齐」的来源。
  tabs: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 24, paddingLeft: 4 },
  // SEC-CATEGORY-ICONS-001：加了字形之后这里要变成横向一行（字形 + 文字）。
  // 下划线 tabBar 是绝对定位的，不受 flexDirection 影响。
  tabItem: { alignItems: "center", flexDirection: "row", gap: 5, paddingBottom: 14, paddingHorizontal: 4, paddingTop: 8 },
  // 字距 -0.2 来自原型 .tabs-tab 的 letter-spacing（.preview-tabs 只覆盖了 padding/font-size）。
  tabText: { color: color.muted, fontSize: 13.5, fontWeight: "800", letterSpacing: -0.2 },
  tabTextActive: { color: color.ink },
  // 下划线铺满整个标签（原型 left:0; right:0），不再左右各缩进 28%。
  // 渐变仍用本仓品牌色 magenta→violet：原型那支 mock 自己的调色板是暖米色系
  // （--rose/--purple），和全 App 20 多处 `from={color.magenta} to={color.violet}` 不是一套，
  // 这里对齐的是几何，不换品牌色。
  tabBar: {
    borderRadius: 2,
    bottom: -1,
    flexDirection: "row",
    height: 3,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0
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
  // MEDIA-EDGE-BLEED-002: 抵消 postCard.paddingLeft(14) + postBody.paddingLeft(54)，
  // 让多图轮播的可视区（不是内容留白）撑到真正的屏幕左边缘——留白本身通过
  // AdaptiveMediaCollection 的 leadingInset={68} 在内容侧补回，只在静止态生效。
  postMediaBleed: { marginLeft: -68 },
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
    backgroundColor: color.ink,
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
    backgroundColor: color.ink,
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
  // ACTIVITY-REF-001 — 活动引用卡。跟引用卡同一套卡片语言（描边内嵌），
  // 但用紫色票根标头区分「这是活动，不是帖文」。
  activityRefCard: {
    borderColor: "#E8E0EC",
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 7,
    padding: 8
  },
  activityRefHead: { alignItems: "center", flexDirection: "row", gap: 5 },
  activityRefKicker: { color: "#6330B2", fontSize: 11, fontWeight: "800" },
  activityRefMore: { color: "#8A7E93", fontSize: 11, fontWeight: "700", marginLeft: "auto" },
  activityRefTitle: { color: "#2B2531", fontSize: 13, fontWeight: "800", lineHeight: 18, marginTop: 5 },
  activityRefMeta: { color: "#5D5365", fontSize: 11, lineHeight: 15, marginTop: 3 },
  // 「活动已不可用」是**说明**，不是标题 —— 故意不用标题的字号/颜色，
  // 免得跟真标题长得一样、被当成活动名字读过去。
  activityRefMissing: { color: "#8A7E93", fontSize: 12, fontStyle: "italic", lineHeight: 16, marginTop: 5 },

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
  pollOptionLabelMine: { color: color.factInferredFg, fontWeight: "700" },
  pollOptionCount: { color: color.muted, fontSize: 12 },
  pollOptionCountMine: { color: color.factInferredFg, fontWeight: "700" },
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
    backgroundColor: color.inspireSavedBg,
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
  postAction: { alignItems: "center", flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 5 },
	postReplies: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, gap: 8, paddingHorizontal: 4, paddingVertical: 10 },
	postReply: { flexDirection: "row", gap: 8 },
	postReplyAuthor: { color: color.ink, fontSize: 12, fontWeight: "800" },
	postReplyBody: { color: color.ink, flex: 1, fontSize: 13, lineHeight: 18 },
	// FEED-REPLY-002: 展开/收起控件。
	postRepliesMore: { color: color.muted, fontSize: 12, fontWeight: "700", paddingTop: 2 },
  postActionCount: { color: color.ink, fontSize: 12, fontWeight: "700" },
  postActionOn: { color: "#6C36C8" },
  // FEED-ACTION-ICONS-001 补（2026-09-26）：转发失败行内提示。和 ProfileTabs 同一个形状。
  postActionRetry: { paddingHorizontal: 8, paddingVertical: 6 },
  postActionRetryText: { color: "#D33D5B", fontSize: 12, fontWeight: "700" },

  // 全屏媒体查看器：深色底 color.ink。
  viewerRoot: { backgroundColor: color.ink, flex: 1 },
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
              <Text selectable numberOfLines={2} style={[styles.pollOptionLabel, mine && styles.pollOptionLabelMine]}>
                {option.label}
              </Text>
              {showResults ? (
                <Text selectable style={[styles.pollOptionCount, mine && styles.pollOptionCountMine]}>
                  {percent}% · {option.voteCount}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      <Text selectable style={styles.pollMeta}>
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
  // FEED-MENU-DEDUP-001: 原来是操作行那套独立菜单（contextMenu）独有的两条，
  // 合并菜单后搬进来——跟不感兴趣/举报/屏蔽作者不同，这两条不摘帖子，只记信号。
  onReduceTopic: () => Promise<void> | void;
  onReduceAuthor: () => Promise<void> | void;
};

function PostMenuModal({ open, post, error, onClose, onReport, onNotInterested, onMuteAuthor, onReduceTopic, onReduceAuthor }: PostMenuModalProps): React.JSX.Element {
  const [showReportReasons, setShowReportReasons] = useState(false);
  if (!open) return <View />;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={postMenuStyles.backdrop}>
        <Pressable onPress={(e) => e.stopPropagation()} style={postMenuStyles.sheet}>
          {!showReportReasons ? (
            <>
              <Text selectable style={postMenuStyles.title}>更多操作</Text>
              <Text selectable style={postMenuStyles.subtitle}>选一项作用于这篇帖子</Text>
              {error ? <Text selectable style={postMenuStyles.error}>{error}</Text> : null}
              <Pressable onPress={() => { void onNotInterested(); }} style={postMenuStyles.row}>
                <ProxyIcon color={color.ink} name="thumbDown" size={26} style={postMenuStyles.rowIconSlot} />
                <View style={postMenuStyles.rowCopy}>
                  <Text selectable style={postMenuStyles.rowTitle}>不感兴趣</Text>
                  <Text selectable style={postMenuStyles.rowHint}>减少类似内容推送</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => { void onReduceTopic(); }} style={postMenuStyles.row}>
                <ProxyIcon color={color.ink} name="listMinus" size={26} style={postMenuStyles.rowIconSlot} />
                <View style={postMenuStyles.rowCopy}>
                  <Text selectable style={postMenuStyles.rowTitle}>减少这类内容</Text>
                  <Text selectable style={postMenuStyles.rowHint}>不摘这条，以后少推类似的</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => { void onReduceAuthor(); }} style={postMenuStyles.row}>
                <ProxyIcon color={color.ink} name="personMinus" size={26} style={postMenuStyles.rowIconSlot} />
                <View style={postMenuStyles.rowCopy}>
                  <Text selectable style={postMenuStyles.rowTitle}>少看这个人</Text>
                  <Text selectable style={postMenuStyles.rowHint}>不摘这条，以后少推这个作者</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => { void onMuteAuthor(); }} style={postMenuStyles.row}>
                <ProxyIcon color={color.ink} name="banCircle" size={26} style={postMenuStyles.rowIconSlot} />
                <View style={postMenuStyles.rowCopy}>
                  <Text selectable style={postMenuStyles.rowTitle}>屏蔽作者</Text>
                  <Text selectable style={postMenuStyles.rowHint}>不再看 Ta 的任何内容</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setShowReportReasons(true)} style={postMenuStyles.row}>
                <ProxyIcon color={color.ink} name="alertTriangle" size={26} style={postMenuStyles.rowIconSlot} />
                <View style={postMenuStyles.rowCopy}>
                  <Text selectable style={postMenuStyles.rowTitle}>举报</Text>
                  <Text selectable style={postMenuStyles.rowHint}>按平台规则处理</Text>
                </View>
              </Pressable>
              <Pressable onPress={onClose} style={postMenuStyles.cancel}>
                <Text selectable style={postMenuStyles.cancelText}>取消</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text selectable style={postMenuStyles.title}>举报原因</Text>
              <Text selectable style={postMenuStyles.subtitle}>选一个最贴近的</Text>
              {error ? <Text selectable style={postMenuStyles.error}>{error}</Text> : null}
              <Pressable onPress={() => { void onReport("SPAM"); }} style={postMenuStyles.row}>
                <Text selectable style={postMenuStyles.rowTitle}>垃圾广告</Text>
              </Pressable>
              <Pressable onPress={() => { void onReport("HARASSMENT"); }} style={postMenuStyles.row}>
                <Text selectable style={postMenuStyles.rowTitle}>骚扰 / 人身攻击</Text>
              </Pressable>
              <Pressable onPress={() => { void onReport("UNSAFE"); }} style={postMenuStyles.row}>
                <Text selectable style={postMenuStyles.rowTitle}>不安全 / 违规</Text>
              </Pressable>
              <Pressable onPress={() => { void onReport("OTHER"); }} style={postMenuStyles.row}>
                <Text selectable style={postMenuStyles.rowTitle}>其他</Text>
              </Pressable>
              <Pressable onPress={() => setShowReportReasons(false)} style={postMenuStyles.cancel}>
                <Text selectable style={postMenuStyles.cancelText}>返回</Text>
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
  // FEED-MENU-ICONS-001：菜单行图标的槽。只补右间距 —— ProxyIcon 自己的 frame
  // 已经是 `alignItems/justifyContent: center` 的 size×size 盒，所以图标在槽里天然居中，
  // 不用再包一层 View。原型 .menu-icon 的 32×32 盒是给 26pt 的 svg 留白的，但这一行
  // 的高度由右边两行文字（14+11）撑着，图标盒改 26 不会动版式。
  // rowIcon 保留给**还没换**的那一个 emoji（分享面板「更多分享方式」那一行）：它是
  // Text 的字号样式，和这里的图标槽不是一个东西，别合并。
  // 这里刻意不写出那个 emoji 的字面量 —— 注释里写着它，将来「feed 里不该再有 emoji」
  // 这类反向钉会被自己的说明喂红（本仓库第四次踩这个坑）。
  rowIconSlot: { marginRight: 12 },
  rowCopy: { flex: 1 },
  rowTitle: { color: color.ink, fontSize: 14, fontWeight: "500", marginBottom: 2 },
  rowHint: { color: color.muted, fontSize: 11, lineHeight: 16 },
  cancel: { marginTop: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.12)", alignItems: "center" },
  cancelText: { color: color.ink, fontSize: 13, fontWeight: "500" }
});

// FEED-SHARE-TO-USER-001: 分享面板——候选人是收件箱里真聊过天的人（跟
// messages.tsx 的"建群"同一诚实数据源），选中直接发一条私信
// （originType: "POST"，服务端 conversation.Service 已经认这个 origin，
// 不用新加后端能力）。系统原生分享作为兜底放在列表最后一行，不砍。
type SharePostSheetProps = {
  target: FeedPost | null;
  contacts: ConversationInboxItem[] | undefined;
  contactsError: boolean;
  sendingTo: string | null;
  onPickContact: (peerUserId: string) => void;
  onUseSystemShare: () => void;
  onClose: () => void;
};

function SharePostSheet({ target, contacts, contactsError, sendingTo, onPickContact, onUseSystemShare, onClose }: SharePostSheetProps): React.JSX.Element {
  if (!target) return <View />;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={postMenuStyles.backdrop}>
        <Pressable onPress={(e) => e.stopPropagation()} style={postMenuStyles.sheet}>
          <Text selectable style={postMenuStyles.title}>分享给</Text>
          <Text selectable style={postMenuStyles.subtitle}>选一位聊过天的联系人，直接发一条私信</Text>
          {contacts === undefined ? (
            <Text selectable style={sharePostStyles.loading}>加载联系人…</Text>
          ) : contactsError ? (
            <Text selectable style={postMenuStyles.error}>联系人读取失败，可以用下面的"更多分享方式"。</Text>
          ) : contacts.length === 0 ? (
            <Text selectable style={sharePostStyles.empty}>还没有聊过天的联系人。找个人先聊几句，就能在这里直接分享了。</Text>
          ) : (
            <ScrollView style={sharePostStyles.list}>
              {contacts.map((item) => {
                const peerUserId = item.counterpartyId as string;
                const displayName = item.counterpartySnapshot?.displayName?.trim() || "用户";
                const avatarSource = resolveAvatarSource(item.counterpartySnapshot?.avatarRef?.trim() ?? "", localApiBaseUrl);
                const busy = sendingTo === peerUserId;
                return (
                  <Pressable disabled={sendingTo !== null} key={peerUserId} onPress={() => onPickContact(peerUserId)} style={postMenuStyles.row}>
                    <View style={sharePostStyles.avatar}>
                      {avatarSource ? (
                        <CircularAvatarImage accessibilityLabel={`${displayName}头像`} size={36} uri={avatarSource.uri} />
                      ) : (
                        <Text selectable style={sharePostStyles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={postMenuStyles.rowCopy}>
                      <Text selectable style={postMenuStyles.rowTitle}>{displayName}</Text>
                    </View>
                    {busy ? <Text selectable style={sharePostStyles.sending}>发送中…</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <Pressable onPress={onUseSystemShare} style={postMenuStyles.row}>
            <Text selectable style={postMenuStyles.rowIcon}>⤴️</Text>
            <View style={postMenuStyles.rowCopy}>
              <Text selectable style={postMenuStyles.rowTitle}>更多分享方式</Text>
              <Text selectable style={postMenuStyles.rowHint}>发到微信 / 复制链接等系统分享面板</Text>
            </View>
          </Pressable>
          <Pressable onPress={onClose} style={postMenuStyles.cancel}>
            <Text selectable style={postMenuStyles.cancelText}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const sharePostStyles = StyleSheet.create({
  loading: { color: color.muted, fontSize: 12, paddingVertical: 16, textAlign: "center" },
  empty: { color: color.muted, fontSize: 12, lineHeight: 18, paddingVertical: 16, textAlign: "center" },
  list: { maxHeight: 320 },
  avatar: { alignItems: "center", backgroundColor: color.surface, borderRadius: 18, height: 36, justifyContent: "center", marginRight: 12, width: 36 },
  avatarInitial: { color: color.ink, fontSize: 14, fontWeight: "700" },
  sending: { color: color.muted, fontSize: 11 }
});

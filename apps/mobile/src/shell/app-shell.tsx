// App Shell：RootNav 五标签 首页 / 市场 / 动态 / 消息 / 我的。
// R4 (2026-08-24)：Market = 机会 / 活动；移除体验上架，机会单向由客户发布、小美报名。
// EXPERIENCE 仅作历史路由别名，新 UI 不展示体验货架。
// Active Context（REQUESTER | BUSINESS）只是 Product State，切换不新增路由；
// 视觉基线：Proxy_Market_Xiaomei_Value_Negotiation_R4.html 布局 + R3 紫粉 token 保留。
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Image, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { AccessibilityInfo } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassContainer, GlassView } from "expo-glass-effect";
import { ProxyNativeTabBarView } from "../components/proxy-native-tab-bar";
import type {
  ExperienceAction,
  ExperienceManifest,
  TasksExperienceParams
} from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import { ContextSwitcherSheet } from "../components/context-switcher";
import {
  DEFAULT_LOCATION,
  LocationPickerSheet,
  formatLocationTitle,
  formatRadius,
  type AnyLocation,
  type CustomLocation,
  type PresetLocation
} from "../components/location-picker-sheet";
import { loadActiveCustomId, loadCustomHistory, loadFollowDevice, saveFollowDevice } from "../components/location-store";
import { LegalStatusBanner } from "../components/legal-status-banner";
import type { LegalStatus, LegalStatusClient } from "../legal-status-client";
import { makeDeviceLocation } from "../components/location-options";
// DEVICE-LOCATION-001: 位置要跟着人走。device-location.ts 是纯逻辑（可单测），
// device-location-native.ts 是全仓唯一 import expo-location 的地方。
import { startDeviceLocationWatch, getCurrentFix, type DeviceLocationState } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { type ConversationClient } from "../conversation-client";
import { type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
// I18N-SETTINGS-001：底栏 / 页头 chrome 的文案从这里取。见 rootTabs() 的注释。
import { useI18n, type MessageKey } from "../i18n";
import { type DemandClient } from "../demand-client";
import { type VoucherClient } from "../voucher-client";
import { type EngagementClient } from "../engagement-client";
import type { ModerationClient } from "../moderation-client";
import { type MarketplaceClient } from "../marketplace-client";
import { type ExperienceClient } from "../experience-client";
import { keepManifestRevision } from "../experience-refresh";
import { dispatchExperienceAction } from "../experience-dispatcher";
import { handleModuleBack } from "../components/module-back";
import { type LocalNetClient } from "../localnet-client";
import { type SecureSessionStore } from "../secure-session";
import { type MediaClient } from "../media-client";
import { type SocialSpaceClient } from "../socialspace-client";
import { type FulfillmentClient } from "../fulfillment-client";
import { type PaymentClient } from "../payment-client";
import { type InboxItem, type NotificationClient } from "../notification-client";
import { type BusinessClient } from "../business-client";
import { type ProfileClient } from "../profile-client";
import { type SessionClient } from "../session-client";import { type AIAccountClient, type PlatformAIAccount } from "../ai-account-client";
import { type RelationshipClient } from "../relationship-client";
import { type SupplyClient } from "../supply-client";
import { type SocialSettingsClient } from "../social-settings-client";
import { BusinessHome } from "../surfaces/business-home";
import { ConversationSurface } from "../surfaces/conversation";
import { FeedSurface } from "../surfaces/feed";
import { FeedPrefsSurface } from "../surfaces/feed-prefs";
import { FulfillmentWorkspace, type WorkspaceTarget } from "../surfaces/fulfillment-workspace";
import { HomeAssistantSurface } from "../surfaces/home-assistant";
import { MarketSurface, type MarketViewMode } from "../surfaces/market";
import { MeSurface } from "../surfaces/me";
import { MessagesSurface } from "../surfaces/messages";
import { meSubPage } from "../surfaces/me-sub-pages";
import type { MeSubPage } from "../surfaces/me-types";
import { RequesterHome, type RequesterGoal } from "../surfaces/requester-home";
import { resolveHomePersonAccountId, type RecommendPerson } from "../recommend-fixtures";
import { GREET_MAX_UNANSWERED, countUnansweredOwnMessages, pickGreetingLine } from "../greet-state";
import { RoomCreateSurface } from "../surfaces/room-create";
import { RoomSurface } from "../surfaces/room";
import { AIAccountProfileSurface } from "../surfaces/ai-account-profile";
import { OtherProfileSurface, type OtherProfileTarget } from "../surfaces/other-profile";
import { RealitySceneMapSurface } from "../surfaces/reality-scene-map";
import { HotScenesSurface } from "../surfaces/hot-scenes";
// ACTIVITY-REF-001：动态里的活动引用卡片点开落到这里（带 initialActivityId）。
import { ActivityDetailSurface } from "../surfaces/activity-detail";
import { VoucherSurface } from "../surfaces/voucher";
import { color, foundation, shadows } from "../theme";
import { type ActiveContext } from "../uiplan/types";
import { type MarketTab } from "../market-fixtures";
import type { SceneToolId } from "@proxy/contracts";
import { SCENE_TOOLS } from "@proxy/contracts";
import { selectShellChromeVisible } from "./app-shell-selectors";
import { selectMotionProfile } from "./app-shell-selectors";
import { ProxyBackGlyph } from "../components/proxy-foundation";
// NOTIF-BELL-001：角标文案 / 未读计数是纯函数（放 .ts 才能被 vitest import）。
import { badgeText, unreadCount } from "../notification-bell";
import { NotificationCenterSurface } from "../surfaces/notification-center";

// P0 原型的品牌图标，直接使用原始资源，不做裁剪、重绘或视觉加工。
const OTTER_LOGO = require("../../assets/otter-logo.png");

// R15.12.7 冻结：第二 Tab = 市场，对全部身份固定为「市场」。
type RootTab = "HOME" | "MARKET" | "FEED" | "MESSAGES" | "ME";
// R15.22 子页序列：horizontal swipe 跨 8 page (HOME, MARKET_OPP, MARKET_ACT, FEED_POSTS, FEED_CAFE, MSG_CHAT, MSG_FRIENDS, ME)
// R15.23 改：FEED tab 内部 section (动态/状态/社区) 各自独立成 page — 横向 swipe 必须先走完 section 才到 MESSAGES，避免 "动态 → 直接消息" 的跳页。
// CAFE-SCENE-001: 状态+社区合并成一个「咖啡场景」section/page，9 page 变 8 page。
type PageId = "HOME" | "MARKET_OPP" | "MARKET_ACT" | "FEED_POSTS" | "FEED_CAFE" | "MSG_CHAT" | "MSG_FRIENDS" | "ME";
const PAGE_SEQUENCE: ReadonlyArray<PageId> = ["HOME", "MARKET_OPP", "MARKET_ACT", "FEED_POSTS", "FEED_CAFE", "MSG_CHAT", "MSG_FRIENDS", "ME"];
const PAGE_TO_ROOT: Record<PageId, RootTab> = {
  HOME: "HOME", MARKET_OPP: "MARKET", MARKET_ACT: "MARKET",
  FEED_POSTS: "FEED", FEED_CAFE: "FEED",
  MSG_CHAT: "MESSAGES", MSG_FRIENDS: "MESSAGES",
  ME: "ME"
};
// R15.33: 撤了 MAP tab。这里原本是 6 tab 跳页表，现在变回 5 tab。
const PAGE_TO_FEED_SECTION: Partial<Record<PageId, "POSTS" | "CAFE">> = {
  FEED_POSTS: "POSTS", FEED_CAFE: "CAFE"
};
const ROOT_TO_FIRST_PAGE: Record<RootTab, PageId> = {
  HOME: "HOME", MARKET: "MARKET_OPP", FEED: "FEED_POSTS",
  MESSAGES: "MSG_FRIENDS", ME: "ME"
};

// I18N-SETTINGS-001（2026-10-01）：底栏标签原来在这里写死中文 —— 换语言之后
// **每个 tab 上都还是中文**，用户第一眼看到的五个字永远不跟着走。改成按当前
// 语言取字典。
//
// 形状保持不变（id / icon / badge 全是常量），只有 label 从常量变成 t() 的结果。
// 注意这是**渲染时**取：t 必须在组件里调（RootNav 里 useI18n），
// 不能在模块顶层求值 —— 顶层求值发生在首次 import 时，那时还没有语言。
function rootTabs(t: (key: MessageKey) => string): ReadonlyArray<{ id: RootTab; icon: ProxyIconName; label: string; badge?: string }> {
  return [
    { id: "HOME", icon: "home", label: t("tabHome") },
    // MARKET-TAB-PENTAGON-001（2026-10-01，用户「把市场的logo换成这个」）：市场这一格
    // 的 logo 从通用菱形 diamond 换成用户给的五边形 pentagon。**只换这一格** ——
    // diamond 还被「我的订单 / feed 分类兜底 / 城市选项 / 草稿卡片」复用着（见
    // proxy-icon.tsx 里 gem 那段注释），改 diamond 的字形会波及那 4 处。
    { id: "MARKET", icon: "pentagon", label: t("tabMarket") },
    { id: "FEED", icon: "target", label: t("tabFeed") },
    { id: "MESSAGES", icon: "chat", label: t("tabMessages"), badge: "9+" },
    { id: "ME", icon: "meRing", label: t("tabMe") }
  ];
}

export function AppShell({
  localNet,
  activities,
  experience,
  conversation,
  media,
  demand,
  vouchers,
  engagement,
  moderation,
  marketplace,
  socialSpace,
  fulfillment,
  payment,
  notification,
  business,
  supply,
  socialSettings,
  profile,
  sessionClient,
  aiAccounts,
  relationship,
  scene,
  isGuest,
  ensureConversationSession,
  onSignOut,
  sessionAuthClient,
  localApiBaseUrl,
  legalStatus,
  // R15.37: 透传到 FeedSurface → ComposerV2Screen，拦 “未登录不发”。
  secureSessionStore
}: {
  localNet: LocalNetClient;
  activities: ActivityClient;
  experience: ExperienceClient;
  conversation: ConversationClient;
  media: MediaClient;
  demand: DemandClient;
  vouchers: VoucherClient;
  engagement: EngagementClient;
  // COMP-REPORT-002: 举报入口客户端，透传到会话页等需要举报的表面。
  moderation: ModerationClient;
  marketplace: MarketplaceClient;
  socialSpace: SocialSpaceClient;
  fulfillment: FulfillmentClient;
  payment: PaymentClient;
  notification: NotificationClient;
  business: BusinessClient;
  supply: SupplyClient;
  profile: ProfileClient;
  sessionClient: SessionClient;
  aiAccounts: AIAccountClient;
  relationship: RelationshipClient;
  socialSettings: SocialSettingsClient;
  scene?: import("../scene-client").SceneClient | undefined;
  isGuest?: boolean;
  ensureConversationSession?: (() => Promise<void>) | undefined;
  onSignOut: () => void;
  sessionAuthClient: import("../auth-client").SessionAuthClient;
  localApiBaseUrl: string;
  // LEGAL-BANNER-001: 法律状态客户端（公开接口，无需登录）。
  legalStatus: LegalStatusClient;
  secureSessionStore?: SecureSessionStore | undefined;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compactWidth = width < 375;
  // I18N-SETTINGS-001：访客页与身份切换面板的文案。必须挂在组件顶层 ——
  // 放条件里就是 hooks-not-in-conditional 门禁要抓的东西。
  const { t } = useI18n();
  const [tab, setTab] = useState<RootTab>("HOME");
  // LEGAL-BANNER-001: 法律 kill 状态。开机拉一次，每次回前台刷新一次。
  // 拉失败静默（不知道≠没事，但拦界面更糟），下次回前台再试；用户手动关掉
  // 只管当次会话（组件自己在无 kill 时返回 null）。
  const [legalStatusState, setLegalStatusState] = useState<LegalStatus | null>(null);
  const [legalDismissed, setLegalDismissed] = useState(false);
  // NOTIF-BELL-001（2026-10-01，用户：「新增了铃铛提醒」）：首页顶栏的铃铛 + 通知中心。
  //
  // 这里补的是一跳**断了的接线**，不是新开一条通道：`notification` 这个 prop 在
  // native-app.tsx 里早就实例化好传下来了（`new NotificationClient({...})`），
  // AppShell 却只把它写进类型（下面 `notification: NotificationClient`）、
  // 从来没读过一次。服务端那半边也齐：`internal/notification` 的
  // ListInbox / MarkInboxRead / SendInboxNotification 都在，现网
  // `notification.inbox_items` 有 845 行真数据（OfferCreated 698 / TaskPublished 60 /
  // SlotOfferCreated 43 / OfferAccepted 42 / OrderCreated 2）。缺的只有用户能看见的那一头。
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState<ReadonlyArray<InboxItem>>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void legalStatus.getStatus().then((s) => { if (!cancelled) setLegalStatusState(s); }).catch(() => undefined);
    };
    void refresh();
    const sub = AppState.addEventListener("change", (next) => { if (next === "active") void refresh(); });
    return () => { cancelled = true; sub.remove(); };
  }, [legalStatus]);
  // NOTIF-BELL-001：拉 inbox 算角标。三个时机都拉：进首页（铃铛只在首页出现）、
  // 通知中心关闭（用户可能在里面标了已读，角标必须跟着降）、以及 notification 换实例。
  //
  // 拉失败**保持上一次的角标**，不清零 —— 清零等于对用户说「你没有未读」，
  // 而事实是「不知道」。宁可显示一个旧数字，也不显示一个假的 0。
  useEffect(() => {
    if (tab !== "HOME") return;
    let cancelled = false;
    void notification.listInbox()
      .then((next) => {
        if (!cancelled) setInboxItems(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [notification, notificationCenterOpen, tab]);
  const [context, setContext] = useState<ActiveContext>("REQUESTER");
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget>();
  const [feedChatAuthor, setFeedChatAuthor] = useState<string>();
  // MSG-GROUPS-TAB-001: convoId/convoTitle（打开一条已有消息支线）已经摘掉——
  // 唯一入口是消息模块的 Convo 列表页，那张列表已经不存在了（见 messages.tsx）。
  const [messageChat, setMessageChat] = useState<{ author: string; conversationId?: string; aiAccount?: PlatformAIAccount; avatarSource?: number | { uri: string }; initialDraft?: string; peerUserId?: string }>();
  // ROOM-CREATE-001: "创建房间"面板 + 建好之后的房间聊天页，各自独立于
  // messageChat（房间是 GROUP + 场景，跟 1:1 对话的展示/交互不是一回事，
  // 见 room-create.tsx / room.tsx 顶部注释）。
  const [roomCreateCandidates, setRoomCreateCandidates] = useState<ReadonlyArray<RecommendPerson>>();
  // HOME-MORE-ROOMS-001: 开房大卡上点的场景（SCENE_OPTIONS 下标）。
  const [roomCreateSceneIndex, setRoomCreateSceneIndex] = useState<number>(0);
  const [roomChatId, setRoomChatId] = useState<string>();
  // HOME-MORE-ROOMS-002（2026-09-23，用户：「点击聊天房卡片创建 先弹回 home 再进入创建
  // 这个多此一举」）：从「更多 → 聊天房」开的创建页 / 房间，叠在「更多」整页 Modal
  // **里面**（overlay），不先关「更多」再开新 Modal —— 之前那样中间会闪一下首页。
  // 从消息页进房不在任何 Modal 里，仍走下面的独立 Modal。
  const [roomLayerInMore, setRoomLayerInMore] = useState<boolean>(false);
  const [openAIProfile, setOpenAIProfile] = useState<PlatformAIAccount>();
  const [openHumanProfile, setOpenHumanProfile] = useState<OtherProfileTarget>();
  // BRAND-CHROME-L1-001: 「我的」子页（个人主页等）跟 openAIProfile/openHumanProfile
  // 一样是盖住整个 body 的目的地，只是写入方在 MeSurface 内部而不是这一层
  // —— 品牌 logo/字标和底部 tab bar 只属于 1 级模块，子页必须收起来。
  const [meSubPageOpen, setMeSubPageOpen] = useState(false);
  const [viewerAccountId, setViewerAccountId] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void secureSessionStore?.read().then((session) => { if (!cancelled) setViewerAccountId(session?.userAccountId); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [secureSessionStore]);
  const messageChatAuthor = messageChat?.author;
  // CONVO-AVATAR-PROFILE-001: 对话窗口点头像直接进对方主页。AI 进 AI 主页；
  // 真人：有 id 直接进，没有 id 靠名字精确匹配（有且仅有一个才进，
  // 0 个或多个都明说不瞎进）。以前这里点头像会先弹一张"关注/进入主页看看"
  // 选择 sheet 挡在主页前面——多一步不必要的确认，点头像的意图已经很清楚
  // 是"进去看看"，关注留给主页自己那颗关注按钮。
  async function openPeerProfile(peer: { userId?: string; name: string; aiAccount?: PlatformAIAccount; avatarUri?: string }): Promise<void> {
    if (peer.aiAccount) {
      setOpenAIProfile(peer.aiAccount);
      return;
    }
    let userId = resolveHomePersonAccountId((peer.userId ?? "").trim());
    const name = (peer.name ?? "").trim();
    if (!userId) {
      if (name.length < 2 || name === "对方" || name === "对话") throw new Error("对方信息不全，打不开主页。");
      const normalized = name.replace(/^@+/, "").toLowerCase();
      const found = await profile.searchProfiles(name, 10);
      const exact = found.filter((candidate) => {
        const handle = (candidate.handle ?? "").replace(/^@+/, "").toLowerCase();
        return handle === normalized || (candidate.name ?? "") === name;
      });
      if (exact.length !== 1 || !exact[0]) throw new Error("没找到对方的主页。");
      userId = exact[0].userAccountId;
    }
    const displayName = name || userId;
    // AVATAR-CARRY-001: 对话窗口已经有对方真头像（peerAvatarSource），带过来
    // 直接用——不然主页只能画首字母圆圈，跟聊天里看到的真人照片对不上。
    setOpenHumanProfile({ userId, name: displayName, ...(peer.avatarUri ? { avatarUri: peer.avatarUri } : {}), posts: [], mediaByPost: {} });
  }
  const [marketEntry, setMarketEntry] = useState<{
    tab: MarketTab;
    viewMode: MarketViewMode;
  }>({ tab: "OPPORTUNITY", viewMode: "LIST" });
  // R15.22: 子页 override (swipe 跨 7 page). null = 跟随 tab + sub-tab 状态.
  const [pageOverride, setPageOverride] = useState<PageId | undefined>();
  // ADD-FRIEND-FROM-MESSAGES-001: 信息 → 添加好友是跨模块的（加好友表面住在
  // Me，relationship / profileClient / 本人身份都在那边齐了）。MeSurface 切走
  // tab 就卸载，所以用「请求 + 消费」而不是「初始值」：Me 消费后这里清空，
  // 下次正常进「我的」不会又弹回添加好友。
  const [meOpenSubPage, setMeOpenSubPage] = useState<MeSubPage>();
  const clearMeOpenSubPage = useCallback((): void => setMeOpenSubPage(undefined), []);
  // R15.23: feedSection 是 FEED tab 内部的 section 状态 (动态/咖啡场景)。
  // 跨 page 切到 FEED_* 时同步设过来；swipe 切到 next/prev page 时也同步更新。
  const [feedSection, setFeedSection] = useState<"POSTS" | "CAFE">("POSTS");
  const currentPage: PageId = pageOverride ?? ((): PageId => {
    if (tab === "HOME") return "HOME";
    if (tab === "MARKET") return marketEntry.tab === "ACTIVITY" ? "MARKET_ACT" : "MARKET_OPP";
    if (tab === "FEED") {
      // R15.23: 跟随 feedSection 而非写死 FEED_REC
      if (feedSection === "CAFE") return "FEED_CAFE";
      return "FEED_POSTS";
    }
    if (tab === "MESSAGES") return "MSG_FRIENDS";
    return "ME";
  })();
  const goToPage = (page: PageId): void => {
    setPageOverride(page);
    const root = PAGE_TO_ROOT[page];
    if (root !== tab) setTab(root);
    if (page === "MARKET_OPP") setMarketEntry((s) => ({ ...s, tab: "OPPORTUNITY" }));
    else if (page === "MARKET_ACT") setMarketEntry((s) => ({ ...s, tab: "ACTIVITY" }));
    // R15.23: 同步 FEED section
    const nextFeedSection = PAGE_TO_FEED_SECTION[page];
    if (nextFeedSection) setFeedSection(nextFeedSection);
  };
  const [experienceManifest, setExperienceManifest] =
    useState<ExperienceManifest>();
  const [feedRefreshTrigger, setFeedRefreshTrigger] = useState(0);
  const [feedPrefsOpen, setFeedPrefsOpen] = useState(false);
  // AI 主页“查看个人主页”的搜索种子：进动态即消费（Feed 通知后清除），
  // 离开动态也清除，下次正常进不带旧词。
  const [feedSearchSeed, setFeedSearchSeed] = useState<string | undefined>(undefined);
  const [feedChromeVisible, setFeedChromeVisible] = useState(true);
  // chrome-parity: HOME / MESSAGES 主信息流的滑动显隐信号（与 FEED/MARKET
  // 同一套上滑藏、下滑/回顶显逻辑；信号由各自 Surface 上报）。
  const [homeChromeVisible, setHomeChromeVisible] = useState(true);
  const [messageChromeVisible, setMessageChromeVisible] = useState(true);
  const rootSwipeBlockedRef = useRef(false);
  const setRootSwipeBlocked = useCallback((blocked: boolean): void => {
    rootSwipeBlockedRef.current = blocked;
  }, []);
  // R15.34.3: body 横滑切页 panResponder — 转换自 onTouchStart/Move/End,
  //   让 RN responder 谈判系统能识别 “子组件先抢” (FilterChipRail /
  //   multi-image ScrollView / stories), 避免原来的 plain touch
  //   handler 总是赢走横滑。
  // 消息页左滑留给行内删除：用 ref 读当前页（闭包只建一次，直接读
  // currentPage 会是首屏旧值），MSG_* 页禁止向左跳页，向右保留。
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  function isMessagesPage(page: PageId): boolean {
    return page === "MSG_CHAT" || page === "MSG_FRIENDS";
  }
  const bodySwipePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (rootSwipeBlockedRef.current) return false;
        // 消息页左滑归行内删除，不参与整页抢夺。
        if (isMessagesPage(currentPageRef.current) && gs.dx < 0) return false;
        const absDx = Math.abs(gs.dx);
        const absDy = Math.abs(gs.dy);
        const swipeThreshold = 56;
        return absDx > swipeThreshold && absDx > absDy * 1.25;
      },
      onPanResponderRelease: (_, gs) => {
        const dx = gs.dx;
        const dy = gs.dy;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const swipeThreshold = 56;
        const isHorizontalSwipe = absDx > swipeThreshold && absDx > absDy * 1.25;
        const canSwipeRoot = !rootSwipeBlockedRef.current && !realitySceneOpen && !hotScenesOpen && !activityDetailId && !homeAssistant && !sceneComposerTool && !workspaceTarget && !feedChatAuthor && !feedPrefsOpen && !messageChatAuthor && !voucherOpen;
        if (isHorizontalSwipe && canSwipeRoot) {
          const page = currentPageRef.current;
          const idx = PAGE_SEQUENCE.indexOf(page);
          if (idx < 0) return;
          if (dx < 0 && !isMessagesPage(page) && idx < PAGE_SEQUENCE.length - 1) goToPage(PAGE_SEQUENCE[idx + 1]!);
          else if (dx > 0 && idx > 0) goToPage(PAGE_SEQUENCE[idx - 1]!);
        }
      },
      onPanResponderTerminate: () => {
        // 什么都不做 — 子组件接管了
      }
    })
  ).current;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [homeAssistant, setHomeAssistant] = useState<{ text: string; mode?: HomeIntentMode; attachment?: HomeAttachment }>();
  const openProxyAIConversation = useCallback((): void => {
    setWorkspaceTarget(undefined);
    setHomeAssistant({ text: "" });
  }, []);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [sceneComposerTool, setSceneComposerTool] = useState<SceneToolId | undefined>(undefined);
  // R15.13 P5：首页/动态顶部的本地范围（仅 city + area，不做 GPS 精确定位）。
  // 之前 LocationContext 是个纯静态的 “河内 · 还剑湖附近 + 切换⌄” 文本，
  // “切换⌄” 点了什么都不会发生 — 现在它真的跳出一个 picker sheet。
  //
  // R15.13 P6：state 升型为 AnyLocation (PRESET | CUSTOM)。CUSTOM
  // 多带 gridX/gridY/radiusMeters — 真实 lat/lng 走 gridToLatLng
  // 计算，仅在渲染时计算一次 (避免在 LocationContext 重复)。
  const [currentLocation, setCurrentLocation] = useState<AnyLocation>(DEFAULT_LOCATION);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  // DEVICE-LOCATION-001: 设备定位。
  //   deviceLocationState —— 五个状态分得清：没授权 / 定位中 / 跟随中 / 不可用 / 停了。
  //     「没授权」「不可用」绝不能显示成「河内 · 还剑湖附近」那种"看起来成功了"的样子。
  //   followDevice —— 是否用设备位置覆盖当前范围。用户手动选过地点就关掉（手动优先）。
  //   locationRestoreDone —— 上次保存的自定义地点读完之前不启动跟随，否则会出现
  //     "先被设备覆盖、用户手动选的地点又被吃掉" 的竞态。
  const [deviceLocationState, setDeviceLocationState] = useState<DeviceLocationState>({ kind: "idle" });
  const [followDevice, setFollowDevice] = useState(true);
  const [locationRestoreDone, setLocationRestoreDone] = useState(false);
  const [realitySceneOpen, setRealitySceneOpen] = useState(false);
  // HOT-SCENES-PAGE-001：首页热榜「更多」进的那一整页——跟 realitySceneOpen
  // 同一个待遇（覆盖整个 body 的目的地，不属于任何一个 tab）。
  const [hotScenesOpen, setHotScenesOpen] = useState(false);
  // 创建活动从地点行进的全页场景地图：跟 realitySceneOpen 同一个待遇
  //（覆盖整个 body 的目的地，底栏只有一级模块有）。
  const [activityMapPickOpen, setActivityMapPickOpen] = useState(false);
  // ACTIVITY-REF-001：从动态里的活动卡片进活动详情。存 id 而不是 boolean ——
  // 「打开活动详情」必须指向**某一个**活动。以前只有不带 id 的 ACTIVITY_DETAIL
  // 路由（coming-soon.tsx），点进去只能落到活动列表，不是引用指向的那个活动。
  const [activityDetailId, setActivityDetailId] = useState<string>();
  const [realitySceneSelection, setRealitySceneSelection] = useState<string>();
  const [realitySceneAI, setRealitySceneAI] = useState<PlatformAIAccount>();
  const [realitySceneHuman, setRealitySceneHuman] = useState<OtherProfileTarget>();
  const [aiProfileReturnToScene, setAIProfileReturnToScene] = useState(false);
  const [humanProfileReturnToScene, setHumanProfileReturnToScene] = useState(false);

  // R15.13 P6：mount 时拉一次"上次激活的自定义坐标" — 跨会话保留
  // 用户放置的 pin / 半径。如果从未放过，sheet 也仍能从 history
  // 拉回 (loadCustomHistory 在 sheet 内部调，这里只关心 active)。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const activeId = await loadActiveCustomId();
      if (cancelled) return;
      const storedFollow = await loadFollowDevice().catch(() => undefined);
      if (cancelled) return;
      // DEVICE-LOCATION-002: 开关和手动地点同一持久层。用户明确开过跟随就
      // 不再被存过的手动地点打回 false（之前开关只活内存，冷启动必丢）。
      if (storedFollow !== undefined) {
        setFollowDevice(storedFollow);
      }
      if (!activeId) return;
      const items = await loadCustomHistory();
      const found = items.find((entry) => entry.id === activeId);
      if (cancelled) return;
      // 有存过的手动地点 = 用户自己选过。开关没明确开过才手动优先；
      // 明确开过跟随的，手动地点只当首帧回退（首个 tracking fix 一到就覆盖）。
      if (found) {
        setCurrentLocation(found);
        if (storedFollow !== true) setFollowDevice(false);
      }
    })().finally(() => { if (!cancelled) setLocationRestoreDone(true); });
    return () => { cancelled = true; };
  }, []);

  // DEVICE-LOCATION-001：订阅设备位置，人走几公里就刷新几次。
  //
// 现成方案 = expo-location 的 watchPositionAsync。既有用法（market /
// reality-scene-map / map-canvas）都是按钮触发的一次性 getCurrentPositionAsync，
// 取完就完 —— 所以必须自己订阅。
// DistanceInterval 1000m + 低精度：对"移动几公里要更新"正好够，省电，也
// 不碰精确定位那条需要服务端同意的线（/v1/location/consent 是另一条路）。
  //
  // 同意：iOS 的「使用 App 期间」系统弹窗本身就是法规要求的同意 UI，
  // 没拿到授权就停在 permission_denied —— 不静默降级、不拿旧坐标假装。
  useEffect(() => {
    if (!locationRestoreDone || !followDevice) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      stop = await startDeviceLocationWatch({
        location: expoLocationApi,
        onState: (next) => {
          if (cancelled) return;
          setDeviceLocationState(next);
          // 只有真的拿到坐标才改当前范围；其余状态只影响提示文案。
          if (next.kind === "tracking") {
            setCurrentLocation(makeDeviceLocation(next.latitude, next.longitude, next.address ? { address: next.address } : {}));
          }
        }
      });
      if (cancelled) stop();
    })();
    return () => { cancelled = true; stop?.(); };
  }, [locationRestoreDone, followDevice]);

  // DEVICE-LOCATION-003: 每次打开 App 就定一次位（跟随开着才定）。
  // watch 负责"走着走着更新"，这里负责"打开就是新的" —— 之前冷启动只恢复
  // 旧地点，watch 的首个 fix 又要等距离/时间闸，首页地址半天不动。
  // 拿不到就当没发生：回退链（手动地点/默认）照旧，不许编坐标。
  useEffect(() => {
    if (!locationRestoreDone || !followDevice) return;
    let cancelled = false;
    void (async () => {
      const fix = await getCurrentFix(expoLocationApi);
      if (cancelled || !fix) return;
      setCurrentLocation(makeDeviceLocation(fix.latitude, fix.longitude, fix.address ? { address: fix.address } : {}));
      setDeviceLocationState({ kind: "tracking", latitude: fix.latitude, longitude: fix.longitude, ...(fix.address ? { address: fix.address } : {}) });
    })();
    return () => { cancelled = true; };
  }, [locationRestoreDone, followDevice]);

  // 规范 §4/§13：Android 硬件返回 = 退整个模块，不逐页退（模块内层级由
  // useModuleBackHandler 注册栈先消费）。顺序即最上层优先：后挂载的 Tab 状态先判。
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (handleModuleBack()) return true;
      if (activityDetailId) { setActivityDetailId(undefined); return true; }
      if (realitySceneOpen) { setRealitySceneAI(undefined); setRealitySceneHuman(undefined); setRealitySceneOpen(false); return true; }
      if (hotScenesOpen) { setHotScenesOpen(false); return true; }
      if (voucherOpen) { setVoucherOpen(false); return true; }
      if (tab === "ME" && messageChatAuthor) { setMessageChat(undefined); return true; }
      if (tab === "MESSAGES" && messageChatAuthor) { setMessageChat(undefined); return true; }
      if (tab === "FEED" && feedPrefsOpen) { setFeedPrefsOpen(false); return true; }
      if (tab === "FEED" && feedChatAuthor) { setFeedChatAuthor(undefined); return true; }
      if (tab === "HOME" && homeAssistant) { setHomeAssistant(undefined); return true; }
      if (tab === "HOME" && workspaceTarget) { setWorkspaceTarget(undefined); return true; }
      if (tab === "HOME" && sceneComposerTool) { setSceneComposerTool(undefined); return true; }
      return false;
    });
    return () => subscription.remove();
  });

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    setExperienceManifest(undefined);

    const refreshManifest = async (): Promise<void> => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const manifest = await experience.getManifest(context);
        if (!cancelled && manifest.context === context) {
          // The experience service is polled in the background, but an unchanged
          // server revision must be a no-op. Replacing the object every 15 seconds
          // used to repaint the whole shell and could interrupt an active press.
          setExperienceManifest((current) => keepManifestRevision(current, manifest));
        }
      } catch {
        // Keep the last validated revision during a transient outage. With no
        // validated revision, Me falls back to the local registered baseline.
      } finally {
        requestInFlight = false;
      }
    };

    void refreshManifest();
    const refreshTimer = setInterval(() => void refreshManifest(), 15_000);
    const appStateSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshManifest();
    });

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      appStateSubscription.remove();
    };
  }, [context, experience]);

  function selectTab(next: RootTab): void {
    setFeedChromeVisible(true);
    setHomeChromeVisible(true);
    setMessageChromeVisible(true);
    if (next === "MARKET") {
      setMarketEntry({ tab: "OPPORTUNITY", viewMode: "LIST" });
    }
    if (next === "FEED") {
      setFeedRefreshTrigger((prev) => prev + 1);
    }

    setTab(next);
    // 离开 Home 时收起工作区；离开 Feed 时收起会话占位（导航预算内）。
    if (next !== "HOME") setWorkspaceTarget(undefined);
    if (next !== "HOME") setHomeAssistant(undefined);
    if (next !== "FEED") {
      setFeedChatAuthor(undefined);
      setFeedPrefsOpen(false);
      setFeedSearchSeed(undefined);
    }
    if (next !== "MESSAGES") setMessageChat(undefined);
    if (next !== "ME") setVoucherOpen(false);
  }

  function openMarket(entry: { tab: MarketTab; viewMode?: MarketViewMode }): void {
    setMarketEntry({ tab: entry.tab, viewMode: entry.viewMode ?? "LIST" });
    setWorkspaceTarget(undefined);
    setHomeAssistant(undefined);
    setFeedChatAuthor(undefined);
    setMessageChat(undefined);
    setTab("MARKET");
  }

  // R15.12.7：Keep the dispatcher surface contract ("TASKS") — server only knows
  // TASKS. Map to Market tabs: view NEED → 机会, view ACTIVITY → 活动。
  function openMarketFromExperienceParams(params: TasksExperienceParams): void {
    openMarket({ tab: params.view === "ACTIVITY" ? "ACTIVITY" : "OPPORTUNITY" });
  }

  function executeExperienceAction(action: ExperienceAction): void {
    dispatchExperienceAction(action, {
      openSurface: (_surface, params) => {
        openMarketFromExperienceParams(params);
      }
    });
  }

  function enterWorkspace(selection: RequesterGoal): void {
    setWorkspaceTarget({ category: selection.category, goal: selection.goal });
  }

  function openHomeAssistant(text: string, mode?: HomeIntentMode, attachment?: HomeAttachment): void {
    setWorkspaceTarget(undefined);
    setHomeAssistant({ text, ...(mode ? { mode } : {}), ...(attachment ? { attachment } : {}) });
  }

  const openContextSwitcher = useCallback((): void => {
    setSwitcherOpen(true);
  }, []);
  const insets = useSafeAreaInsets();
  // Feed and Market streams own scroll-driven shell chrome (top header +
  // bottom dock hide on scroll down, restore on scroll up). Chat,
  // Home/Me forms and Feed's nested chat/preferences keep navigation
  // stable so moving through messages cannot unexpectedly summon/hide it.
  // PROFILE-FROM-ANY-TAB-001: openHumanProfile 和 openAIProfile 一样是「盖住整个
  // body 的目的地」，不是某个 tab 的子页面 —— 所以也要一起收掉导航 chrome。
  // 否则从动态点进他人主页后底栏还在，用户切个 tab 就会被留在一个没人负责关闭的
  // 主页上（它的写入方不在那个 tab，返回键也回不到正确的来源）。
  const isNavVisible = !realitySceneOpen && !hotScenesOpen && !activityMapPickOpen && !activityDetailId && !openAIProfile && !openHumanProfile && !meSubPageOpen && selectShellChromeVisible({
    tab,
    feedChromeVisible,
    homeChromeVisible,
    messageChromeVisible,
    feedChatOpen: Boolean(feedChatAuthor),
    feedPrefsOpen,
    messageChatOpen: Boolean(messageChatAuthor)
  });
  // SCENE-MAP-LOCATION-001: 场景地图的初始原点。地图面自己 state 每次挂载
  // 都从 undefined 开始，只有点"定位"按钮才设值 —— 关掉再进就回到河内默认。
  // 壳里有活的设备定位（tracking）就给它；其次是用户自己定的地点
  // （DEVICE 整条 / CUSTOM 有坐标）；都没有才让地图走目录模式（河内默认）。
  const sceneMapOrigin = deviceLocationState.kind === "tracking"
    ? { latitude: deviceLocationState.latitude, longitude: deviceLocationState.longitude }
    : currentLocation.kind === "DEVICE"
      ? { latitude: currentLocation.device.lat, longitude: currentLocation.device.lng }
      : currentLocation.kind === "CUSTOM" && currentLocation.custom.lat !== undefined && currentLocation.custom.lng !== undefined
        ? { latitude: currentLocation.custom.lat, longitude: currentLocation.custom.lng }
        : undefined;

  // HOME-MORE-ROOMS-002: 同一对创建页 / 房间，按入口决定是独立 Modal 还是叠在「更多」里。
  // 两处都挂着，但同一时刻只有入口那一处 visible。
  function renderRoomLayers(presentation: "modal" | "overlay"): React.JSX.Element {
    const here = presentation === "overlay" ? roomLayerInMore : !roomLayerInMore;
    return (
      <>
        <RoomCreateSurface
          candidates={roomCreateCandidates ?? []}
          initialSceneIndex={roomCreateSceneIndex}
          conversationClient={conversation}
          onClose={() => setRoomCreateCandidates(undefined)}
          onCreated={(conversationId) => { setRoomCreateCandidates(undefined); setRoomChatId(conversationId); }}
          presentation={presentation}
          visible={here && roomCreateCandidates !== undefined}
        />
        <RoomSurface
          conversationClient={conversation}
          conversationId={roomChatId ?? ""}
          mediaClient={media}
          onClose={() => setRoomChatId(undefined)}
          presentation={presentation}
          profileClient={profile}
          visible={here && roomChatId !== undefined}
        />
      </>
    );
  }

  return (
    <>
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={[styles.root, width >= 768 && styles.rootWide]}>
        <StatusBar animated={false} backgroundColor={color.offWhite} barStyle="dark-content" translucent={false} />
        {/* LEGAL-BANNER-001: 有 kill 才显示（组件内部判空），置顶。 */}
        {legalStatusState && !legalDismissed ? <LegalStatusBanner status={legalStatusState} onDismiss={() => setLegalDismissed(true)} /> : null}
        {/* HEADER-HOME-ONLY-001: 市场/动态/消息/我的各自顶部已经有自己的标题
            （"市场"/"动态"/"消息"/"我的"），品牌 logo+字标再叠一遍是纯重复——
            5 个 tab 里有 4 个顶部堆两层标题。品牌头只在首页留（首页没有自己的
            标题行，需要它标识"这是 Proxy"）。*/}
        {/* NOTIF-BELL-001: 角标数的是 inboxItems 里的真未读数（0 条 ⇒ badgeText 回
            undefined ⇒ 不画角标），不是原型那个写死的 "9+"。 */}
        {isNavVisible && tab === "HOME" ? (
          <Header
            badge={badgeText(unreadCount(inboxItems))}
            compact={compactWidth}
            onOpenNotifications={() => setNotificationCenterOpen(true)}
          />
        ) : null}
        {/* 首页的本地范围说明属于 root Chrome 且只在首页出现 —— 消息页不再重复
            （MSG-LOCATION-DUPE-001：入口只在 Home 留一个）；“我的”根页由 Me Surface
            自己渲染，避免泄漏到其详情页。 */}
        {isNavVisible && tab === "HOME" ? (
          <LocationContext
            location={currentLocation}
            deviceState={deviceLocationState}
            onOpenSceneMap={() => setRealitySceneOpen(true)}
            onSwitchLocation={() => setLocationSheetOpen(true)}
          />
        ) : null}
        {/*
          ============================================================
          R15.34.3 — Body 横滑切页: 改用 PanResponder
          ============================================================
          之前 onTouchStart/Move/End 是 plain touch handler, 不会走
          RN responder 谈判 → 任何子组件 (FilterChipRail / 多图
          ScrollView / stories) 的 PanResponder 都拦不住 body 拿到的
          原始 touch events, 所以 swipe 总是被外层 PAGE_SEQUENCE 抢走
          切 tab。

          现在改成 PanResponder:
          - onStartShouldSetPanResponder: () => false (start 不抢, 让
            子组件先抢)
          - onMoveShouldSetPanResponder: 必须在 dx > 56 + dx > dy*1.25
            才抢 (跟原来 onTouchEnd 一样的逻辑)
          - 这样子组件的 PanResponder (dx > 6, 或 start 抢) 会先于 body
            拿到 responder, body 的 PanResponder 抢不到, 不触发切页
          - 触摸到了没被任何子组件接住的地方 (比如空白背景), body 自己的
            PanResponder 才有机会拿到, 这时是真正的 “扫切 tab”
          ============================================================
        */}
        <View
          {...bodySwipePanResponder.panHandlers}
          style={styles.body}
        >
        {/*
          ============================================================
          PROFILE-FROM-ANY-TAB-001 — 个人主页必须挂在 tab 分支**之上**。

          这两支（openAIProfile / openHumanProfile）的**写入方不在 HOME**：
            - 动态页点头像 → 菜单「访问个人主页」(feed.tsx onOpenProfile → app-shell 的
              onOpenProfile)
            - 动态页 → 现实场景图 → 点某个人 / 某个 AI 账号
          而它们此前只写在 `tab === "HOME"` 分支里面。于是从动态进入时：
          状态被设了 → 重新渲染 → 链子在 `tab === "FEED"` 处就返回了 →
          **没有任何分支去读它** → 菜单一关，屏幕纹丝不动。
          （用户看到的现象就是「点头像选访问个人主页没反应」。）

          放在这一层与 realitySceneOpen 同级，因为它们语义相同：覆盖整个 body 的
          目的地，不属于任何一个 tab。移动它们之前请先读这段 —— 放回 tab 分支里
          会立刻让动态入口再次失效，而且不会有任何测试变红。
          ============================================================
        */}
        {activityDetailId ? (
          <ActivityDetailSurface
            client={activities}
            moderation={moderation}
            initialActivityId={activityDetailId}
            onBack={() => setActivityDetailId(undefined)}
          />
        ) : realitySceneOpen ? (
          <RealitySceneMapSurface apiBaseUrl={localApiBaseUrl} authClient={sessionAuthClient} featuredAIAccount={realitySceneAI} featuredHuman={realitySceneHuman} initialSceneId={realitySceneSelection} {...(sceneMapOrigin ? { initialOrigin: sceneMapOrigin } : {})} secureSessionStore={secureSessionStore} onBack={() => { setRealitySceneAI(undefined); setRealitySceneHuman(undefined); setRealitySceneSelection(undefined); setRealitySceneOpen(false); }} onOpenAIProfile={(account) => { setAIProfileReturnToScene(true); setRealitySceneOpen(false); setOpenAIProfile(account); }} onOpenHumanProfile={(person) => { setHumanProfileReturnToScene(true); setRealitySceneOpen(false); setOpenHumanProfile({ ...person, posts: [], mediaByPost: {} }); }} />
        ) : hotScenesOpen ? (
          // HOT-SCENES-PAGE-001：跟 realitySceneOpen 同一个「点场景卡 → 进详情」
          // 落点——带 sceneId 直达该场景，不带 = 总览（SCENE-MAP-DEFAULT-001 同一条道理）。
          <HotScenesSurface
            apiBaseUrl={localApiBaseUrl}
            onBack={() => setHotScenesOpen(false)}
            onOpenSceneMap={(sceneId) => {
              setHotScenesOpen(false);
              setRealitySceneAI(undefined);
              setRealitySceneHuman(undefined);
              setRealitySceneSelection(sceneId);
              setRealitySceneOpen(true);
            }}
          />
        ) : openAIProfile ? (
          <AIAccountProfileSurface
            account={openAIProfile}
            engagement={engagement}
            {...(secureSessionStore ? { secureSessionStore } : {})}
            onBack={() => { setOpenAIProfile(undefined); if (aiProfileReturnToScene) { setAIProfileReturnToScene(false); setRealitySceneOpen(true); } }}
            onViewPosts={(account) => {
              // 查看个人主页：关主页页，进动态看她的全部内容（搜索种子即消费）。
              setOpenAIProfile(undefined);
              setAIProfileReturnToScene(false);
              setFeedSearchSeed(account.displayName);
              setTab("FEED");
            }}
            onMessage={(account, initialDraft) => {
              setOpenAIProfile(undefined);
              setMessageChat({ author: account.displayName, aiAccount: account, ...(initialDraft ? { initialDraft } : {}) });
              setPageOverride("MSG_CHAT");
              setTab("MESSAGES");
            }}
          />
        ) : openHumanProfile ? (
          <OtherProfileSurface
            key={openHumanProfile.userId}
            target={openHumanProfile}
            engagement={engagement}
            localNet={localNet}
            moderation={moderation}
            {...(secureSessionStore ? { secureSessionStore } : {})}
            onBack={() => { setOpenHumanProfile(undefined); if (humanProfileReturnToScene) { setHumanProfileReturnToScene(false); setRealitySceneOpen(true); } }}
            onMessage={(name, avatarUri) => {
              setOpenHumanProfile(undefined);
              setMessageChat({ author: name, ...(avatarUri ? { avatarSource: { uri: avatarUri } } : {}) });
              setPageOverride("MSG_CHAT");
              setTab("MESSAGES");
            }}
          />
        ) : tab === "HOME" ? (
          sceneComposerTool ? (
            <SceneComposerSurface tool={sceneComposerTool} scene={scene} onBack={() => setSceneComposerTool(undefined)} onCreated={() => setSceneComposerTool(undefined)} />
          ) : homeAssistant && context === "BUSINESS" ? (
            <HomeAssistantSurface
              conversationClient={conversation}
              mediaClient={media}
              initialText={homeAssistant.text}
              {...(homeAssistant.attachment ? { initialAttachment: homeAssistant.attachment } : {})}
              {...(homeAssistant.mode ? { mode: homeAssistant.mode } : {})}
              {...(ensureConversationSession ? { ensureSession: ensureConversationSession } : {})}
              onBack={() => setHomeAssistant(undefined)}
              onOpenMarket={(tab) => {
                setHomeAssistant(undefined);
                openMarket({ tab });
              }}
              onOpenXiaomei={() => {
                setHomeAssistant(undefined);
              }}
              onOpenFeed={() => {
                setHomeAssistant(undefined);
                selectTab("FEED");
              }}
            />
          ) : context === "BUSINESS" ? (
            <BusinessHome
              onOpenMarket={() => openMarket({ tab: "OPPORTUNITY" })}
              onOpenMe={() => setTab("ME")}
              // CREATOR-HOME-001：横滑卡点人脸进 Proxy 公开主页（平台现成的
              // OtherProfileSurface，feed 点头像走的同一条），不是弹框。
              onOpenCreatorProfile={(userId, name, avatarUri) => setOpenHumanProfile({ userId, name, ...(avatarUri ? { avatarUri } : {}), posts: [], mediaByPost: {} })}
              onChat={(text, mode, attachment) => openHomeAssistant(text, mode, attachment)}
              bottomNavVisible={isNavVisible}
              business={business}
              activities={activities}
              supply={supply}
            />
          ) : workspaceTarget ? (
            <FulfillmentWorkspace
              target={workspaceTarget}
              conversationClient={conversation}
              demandClient={demand}
              onBack={() => setWorkspaceTarget(undefined)}
            />
          ) : (
            <RequesterHome
              onChooserVisibilityChange={setRootSwipeBlocked}
              onEnterWorkspace={enterWorkspace}
              onOpenFeed={() => selectTab("FEED")}
              onOpenMarket={(tab) => openMarket({ tab })}
              onChromeVisibilityChange={setHomeChromeVisible}
              localNet={localNet}
              onChat={(text, mode, attachment) => openHomeAssistant(text, mode, attachment)}
              onOpenAssistantConversation={openProxyAIConversation}
              conversationPanel={homeAssistant ? (
                <HomeAssistantSurface
                  embedded
                  conversationClient={conversation}
                  mediaClient={media}
                  initialText={homeAssistant.text}
                  {...(homeAssistant.attachment ? { initialAttachment: homeAssistant.attachment } : {})}
                  {...(homeAssistant.mode ? { mode: homeAssistant.mode } : {})}
                  {...(ensureConversationSession ? { ensureSession: ensureConversationSession } : {})}
                  onBack={() => setHomeAssistant(undefined)}
                  onOpenMarket={(tab) => {
                    setHomeAssistant(undefined);
                    openMarket({ tab });
                  }}
                  onOpenXiaomei={() => {
                    setHomeAssistant(undefined);
                  }}
                  onOpenFeed={() => {
                    setHomeAssistant(undefined);
                    selectTab("FEED");
                  }}
                />
              ) : undefined}
              demandClient={demand}
              marketplace={marketplace}
              activities={activities}
              experiences={experience}
              relationship={relationship}
              {...(isGuest ? { isGuest } : {})}
              // HOME-PEOPLE-SEARCH-001: 首页人名搜全站，没有它新注册用户搜不到。
              profileClient={profile}
              {...(viewerAccountId ? { viewerAccountId } : {})}
              onOpenHumanScene={(person, sceneId) => {
                setRealitySceneAI(undefined);
                setRealitySceneHuman({ userId: person.id, name: person.name, city: person.bio, avatarUri: person.photoUri, posts: [], mediaByPost: {} });
                setRealitySceneSelection(sceneId);
                setRealitySceneOpen(true);
              }}
              onOpenHumanProfile={(person) => setOpenHumanProfile({
                userId: resolveHomePersonAccountId(person.id),
                name: person.name,
                city: person.bio,
                avatarUri: person.photoUri,
                posts: [],
                mediaByPost: {},
              })}
              onMessageHuman={(person, initialDraft) => {
                setMessageChat({ author: person.name, ...(person.photoUri ? { avatarSource: { uri: person.photoUri } } : {}), peerUserId: resolveHomePersonAccountId(person.id), ...(initialDraft ? { initialDraft } : {}) });
                setPageOverride("MSG_CHAT");
                setTab("MESSAGES");
              }}
              onGreetHuman={async (person, lines) => {
                // HOME-MORE-GREET-001: 「邀约」直接发一句招呼。PROFILE 源 DM —— 同一对账号
                // 服务端复用同一个会话，这句话续在已有聊天里，不另开一条。
                const peerUserId = resolveHomePersonAccountId(person.id);
                // HOME-MORE-GREET-003: 已经连发 GREET_MAX_UNANSWERED 条、对方本人还没回，就不再发。
                // 只数对方本人的回复（AI 代回复署名 proxy_ai，不算）。
                const inbox = await conversation.listConversations();
                const dm = inbox.find((item) => item.conversation.conversationType === "DM" && (item.counterpartyId === peerUserId || (item.conversation.participants ?? []).includes(peerUserId)));
                let alreadySent: ReadonlyArray<string> = [];
                if (dm) {
                  const listed = await conversation.listMessages(dm.conversation.conversationId);
                  const payload = typeof listed.operationRef === "string" ? JSON.parse(listed.operationRef) as { messages?: Array<{ senderId?: unknown; body?: unknown }>; actorId?: unknown } : {};
                  const rows = payload.messages ?? [];
                  if (typeof payload.actorId === "string") {
                    if (countUnansweredOwnMessages(rows, payload.actorId, peerUserId) >= GREET_MAX_UNANSWERED) return "awaiting_reply";
                    const me = payload.actorId;
                    alreadySent = rows.filter((row) => row.senderId === me && typeof row.body === "string").map((row) => row.body as string);
                  }
                }
                // HOME-MORE-GREET-004: 避开跟这个人聊天里我已经发过的句子 —— 同一句发两遍，
                // 对面（AI 代回复）都会吐槽「又是这句」。全发过了才允许重复。
                const line = pickGreetingLine(lines, alreadySent);
                // 被拒（REJECTED）时 client 会抛，首页据此显示"没发出去"。
                await conversation.startConversation({
                  originType: "PROFILE", originId: peerUserId, participantId: peerUserId,
                  conversationType: "DM", firstMessage: line,
                });
                return "sent";
              }}
              onOpenRoomCreate={(candidates, sceneIndex) => { setRoomLayerInMore(true); setRoomCreateSceneIndex(sceneIndex ?? 0); setRoomCreateCandidates(candidates); }}
              loadRooms={() => conversation.listConversations()}
              onOpenRoom={(conversationId) => { setRoomLayerInMore(true); setRoomChatId(conversationId); }}
              moreRoomLayer={roomLayerInMore ? renderRoomLayers("overlay") : null}
              moreRoomLayerOpen={roomLayerInMore && (roomCreateCandidates !== undefined || roomChatId !== undefined)}
              onCreateScene={setSceneComposerTool}
              // SCENE-MAP-DEFAULT-001（2026-09-20）：无参数时以前硬编码跳
              // "threebeans"，把"打开附近场景地图"这个入口悄悄变成"直达
              // 某一家咖啡馆的详情页"——点哪个都是同一个结果，跟没有地图
              // 一样。RealitySceneMapSurface 本来就支持 initialSceneId
              // 缺省显示地图/列表总览（reality-scene-map.tsx 的 selectedId
              // 初值就是 initialSceneId，undefined 时渲染总览，不是详情）；
              // 带 sceneId（场景推荐卡点进来）才应该直达该场景详情。
              onOpenSceneMap={(sceneId) => {
                setRealitySceneAI(undefined);
                setRealitySceneHuman(undefined);
                setRealitySceneSelection(sceneId);
                setRealitySceneOpen(true);
              }}
              // HOT-SCENES-PAGE-001：热榜「更多」进的是热门场景整页（排序/筛选/
              // 网格），不是直接跳场景地图——两者是不同的落点。
              onOpenHotScenes={() => setHotScenesOpen(true)}
              sceneApiBaseUrl={localApiBaseUrl}
              bottomNavVisible={isNavVisible}
            />
          )
        ) : tab === "MARKET" ? (
          <MarketSurface
              activities={activities}
              marketplace={marketplace}
              fulfillment={fulfillment}
              profileClient={profile}
              media={media}
              supply={supply}
              moderation={moderation}
              marketLabel="河内"
              initialTab={marketEntry.tab}
              onOpenRealityScene={(sceneId) => { setRealitySceneSelection(sceneId); setRealitySceneOpen(true); }}
              onChromeVisibilityChange={setFeedChromeVisible}
              onMapPickOpenChange={setActivityMapPickOpen}
              bottomNavVisible={isNavVisible}
              userCenter={sceneMapOrigin ? { lat: sceneMapOrigin.latitude, lng: sceneMapOrigin.longitude } : undefined}
              // ORDER-APPLY-KYC-GATE-001：市场接单没过 KYC → 切「我的」直达 KYC认证。
              onRequireKYC={() => { setTab("ME"); setMeOpenSubPage(meSubPage("providerapply") ?? undefined); }}
            />
        ) : tab === "FEED" ? (
          feedChatAuthor ? (
            <ConversationSurface
              author={feedChatAuthor}
              conversationClient={conversation}
              activityClient={activities}
              mediaClient={media}
              moderationClient={moderation}
              onBack={() => setFeedChatAuthor(undefined)}
              onOpenPeerProfile={openPeerProfile}
            />
          ) : feedPrefsOpen ? (
            <FeedPrefsSurface onBack={() => setFeedPrefsOpen(false)} />
          ) : (
            <FeedSurface
              key={feedSearchSeed ?? "feed"}
              engagement={engagement}
              profileClient={profile}
              localNet={localNet}
              mediaClient={media}
              socialSpace={socialSpace}
              secureSessionStore={secureSessionStore}
              conversationClient={conversation}
              {...(viewerAccountId ? { viewerAccountId } : {})}
              {...(feedSearchSeed ? { initialSearchQuery: feedSearchSeed } : {})}
              onSearchSeedConsumed={() => setFeedSearchSeed(undefined)}
              onChromeVisibilityChange={setFeedChromeVisible}
              onOpenChat={setFeedChatAuthor}
              onOpenFeedPrefs={() => setFeedPrefsOpen(true)}
              // MEDIA-PIPELINE-001: AI 账号目录透传，动态解析 AGENT 帖头像。
              aiAccountsClient={aiAccounts}
              onOpenRealityScene={(sceneId) => { setRealitySceneSelection(sceneId); setRealitySceneOpen(true); }}
              // ACTIVITY-REF-001：帖文里的活动引用（contextId = activityId）解析成
              // 卡片要活动读模型；点卡片进活动详情。两者都从这一层透传下去。
              activityClient={activities}
              onOpenActivity={(activityId) => setActivityDetailId(activityId)}
              onOpenProfile={(profile) => setOpenHumanProfile(profile)}
              refreshTrigger={feedRefreshTrigger}
              bottomNavVisible={isNavVisible}
              // R15.23: sub-tab 推荐/关注 保留（initialTab）；section 动态/状态/社区 由 app-shell 控
              initialTab="RECOMMENDED"
              // R15.23: section 改 controlled — swipe 跨 page 时 app-shell 同步更新
              currentSection={feedSection}
              onSectionChange={setFeedSection}
            />
          )
        ) : tab === "MESSAGES" ? (
          messageChatAuthor ? (
            <ConversationSurface
              author={messageChatAuthor}
              {...(messageChat?.conversationId ? { conversationId: messageChat.conversationId } : {})}
              {...(messageChat?.aiAccount ? { aiAccount: messageChat.aiAccount } : {})}
              {...(messageChat?.avatarSource ? { peerAvatarSource: messageChat.avatarSource } : {})}
              {...(messageChat?.peerUserId ? { peerUserId: messageChat.peerUserId } : {})}
              {...(messageChat?.initialDraft ? { initialDraft: messageChat.initialDraft } : {})}
              {...(ensureConversationSession ? { ensureSession: ensureConversationSession } : {})}
              conversationClient={conversation}
              activityClient={activities}
              mediaClient={media}
              moderationClient={moderation}
              onBack={() => setMessageChat(undefined)}
              onOpenPeerProfile={openPeerProfile}
            />
          ) : (
            <MessagesSurface conversationClient={conversation} profileClient={profile} apiBaseUrl={localApiBaseUrl} relationship={relationship} onOpenConversation={(author, conversationId, aiAccount, avatarSource, peerUserId) => setMessageChat(conversationId ? { author, conversationId, ...(aiAccount ? { aiAccount } : {}), ...(avatarSource ? { avatarSource } : {}), ...(peerUserId ? { peerUserId } : {}) } : { author, ...(peerUserId ? { peerUserId } : {}) })} onOpenRoom={(conversationId) => { setRoomLayerInMore(false); setRoomChatId(conversationId); }} onChromeVisibilityChange={setMessageChromeVisible} bottomNavVisible={isNavVisible} />
          )
        ) : isGuest ? (
          <View style={styles.guestMe}>
            <Text selectable style={styles.guestMeTitle}>{t("guestMeTitle")}</Text>
            <Text selectable style={styles.guestMeSub}>{t("guestMeSub")}</Text>
            <Pressable onPress={onSignOut} style={styles.guestMeCTA}><Text selectable style={styles.guestMeCTAText}>{t("guestMeCta")}</Text></Pressable>
          </View>
        ) : voucherOpen ? (
            <VoucherSurface client={vouchers} context={context} onBack={() => setVoucherOpen(false)} />
          ) : (
            <MeSurface
              key={viewerAccountId ?? "pending-account"}
              context={context}
              localNet={localNet}
              // PROFILE-ENGAGEMENT-WIRE-001（P0，2026-09-24，用户：「我的个人主页里 没有任何互动的信息 空白的」）：
              // MeSurface 一直没拿到 engagement —— 个人主页帖子没有 ♡ 喜欢、没有赞数 / 评论（PROFILE-REPLIES-VISIBLE-001
              // 的注水因此从不执行），主页洞察读不出来显示「—」。其他 surface 都传了，只漏了这里。
              engagement={engagement}
              fulfillment={fulfillment}
              business={business}
              supply={supply}
              activities={activities}
              profileClient={profile}
              sessionClient={sessionClient}
              mediaClient={media}
              relationshipClient={relationship}
              socialSettingsClient={socialSettings}
              moderation={moderation}
              requestedSubPage={meOpenSubPage}
              onRequestedSubPageConsumed={clearMeOpenSubPage}
              {...(viewerAccountId ? { viewerAccountId } : {})}
              {...(experienceManifest?.context === context
                ? {
                    experienceSections: experienceManifest.me.sections,
                    ...(experienceManifest.me.mode ? { experienceMode: experienceManifest.me.mode } : {})
                  }
                : {})}
              onOpenSwitcher={openContextSwitcher}
              onOpenFeed={() => selectTab("FEED")}
              onOpenMarket={() => selectTab("MARKET")}
              onOpenVouchers={() => setVoucherOpen(true)}
              // CREATOR-HOME-001：经营列表点头像进帖文主页（和 feed 横滑卡同一条）。
              onOpenCreatorProfile={(userId, name, avatarUri) => setOpenHumanProfile({ userId, name, ...(avatarUri ? { avatarUri } : {}), posts: [], mediaByPost: {} })}
              onOpenRealitySceneMap={() => { setRealitySceneSelection(undefined); setRealitySceneOpen(true); }}
              onExperienceAction={executeExperienceAction}
              onOpenConversation={(author, peerUserId) => {
                setMessageChat({ author, ...(peerUserId ? { peerUserId } : {}) });
                setTab("MESSAGES");
              }}
              onSignOut={onSignOut}
              onSubPageOpenChange={setMeSubPageOpen}
              bottomNavVisible={isNavVisible}
              {...(scene ? { scene } : {})}
            />
          )}
        </View>
        {isNavVisible ? <RootNav activePage={currentPage} compact={compactWidth} bottomInset={insets.bottom} onCommitPage={goToPage} /> : null}
        <ContextSwitcherSheet
          current={context}
          onClose={() => setSwitcherOpen(false)}
          onManageBusiness={() => {
            setSwitcherOpen(false);
            setContext("BUSINESS");
          }}
          onSelect={setContext}
          open={switcherOpen}
          options={[
            { id: "REQUESTER", icon: "meRing", title: t("ctxRequesterTitle"), desc: t("ctxRequesterDesc") },
            { id: "BUSINESS", icon: "storeLines", title: t("ctxBusinessTitle"), desc: t("ctxBusinessDesc") }
          ]}
        />
        <LocationPickerSheet
          current={currentLocation}
          baseUrl={localApiBaseUrl}
          deviceState={deviceLocationState}
          followDevice={followDevice}
          onFollowDevice={(next) => { setFollowDevice(next); void saveFollowDevice(next).catch(() => undefined); }}
          onClose={() => setLocationSheetOpen(false)}
          onSelect={(next) => {
            // 手动选地点 = 用户明确要这个范围，跟随让位（否则下一次回调又把它冲掉）。
            // 选择本身也要落盘，否则下次冷启动恢复流程只记得"开过跟随"，把这次手动选择吃了。
            setFollowDevice(false);
            void saveFollowDevice(false).catch(() => undefined);
            setCurrentLocation(next);
          }}
          open={locationSheetOpen}
        />
        {/* NOTIF-BELL-001: 通知中心。默认 presentation="modal" —— 首页不在任何 Modal
            里，直接包 Modal 是安全的（跟 LocationPickerSheet 同一层）。 */}
        {/* NOTIF-DEEPLINK-ROUTE-001：通知里那条深链**有对应页面**时才跳。
            归属在服务端判过了（resolveDeepLink），这里只负责落页：
            进「我的」页，再开那一条子页 —— 和首页 KYC 那个入口同一条路径。 */}
        <NotificationCenterSurface
          client={notification}
          onClose={() => setNotificationCenterOpen(false)}
          onNavigate={(route) => {
            setNotificationCenterOpen(false);
            setTab("ME");
            setMeOpenSubPage(meSubPage(route) ?? undefined);
          }}
          visible={notificationCenterOpen}
        />
        {renderRoomLayers("modal")}
      </View>
      </SafeAreaView>
    </>
  );
}



// 基线 .header.root：只有 Otter logo + Proxy 字标（上下文徽章不在此层，见 Me 的 contextline）。
//
// UI-SAFEAREA-001: 顶栏不再自己加安全区。外层 app-shell 已经用
// <SafeAreaView edges={["top"]}> 整体让出状态栏，顶栏若再叠一次 insets.top 就是
// 双计（实测品牌行 y=127 = 59 状态栏 + 59 重复）。此前几次「顶栏让出状态栏时间 /
// 高度随安全区长」的改动都发生在 insets 恒为 0 的环境里，等于没生效，只在真值到位后
// 变成双计。安全区只在 SafeAreaView 一处生效，顶栏保持基线 52/46 高。
// NOTIF-BELL-001（2026-10-01，用户：「新增了铃铛提醒」）：顶栏右端加一颗铃铛。
// 原型（docs/design/references/Proxy_Home_Notifications_20261001_7b9953.html）里
// logo / 位置 / 切换 / 铃铛 是**同一行**；本仓库把「位置 + 切换」拆成了下面独立的
// LocationContext 一行（HEADER-HOME-ONLY-001 / MSG-LOCATION-DUPE-001 定的），
// 所以铃铛落在品牌这一行的右端 —— 位置跟原型一致（右上角），不动那两行结构。
//
// 角标由调用方算好传进来（badgeText(unreadCount(...))），这里不自己数 ——
// 0 条时传 undefined，**不画角标**，而不是画一个 "0"。
function Header({ badge, compact, onOpenNotifications }: { badge?: string | undefined; compact: boolean; onOpenNotifications: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.headerBrand}>
        <Image resizeMode="contain" source={OTTER_LOGO} style={[styles.headerLogo, compact && styles.headerLogoCompact]} />
        <Text selectable style={[styles.headerName, compact && styles.headerNameCompact]}>Proxy</Text>
      </View>
      <Pressable
        accessibilityLabel={t("notifBellA11y")}
        accessibilityRole="button"
        onPress={onOpenNotifications}
        style={({ pressed }) => [styles.headerBell, pressed && styles.headerBellPressed]}
      >
        <ProxyIcon color={color.ink} name="bell" size={24} />
        {badge ? (
          <View style={styles.headerBellBadge}>
            <Text selectable style={styles.headerBellBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

// R15.13 Scene Composer — P0 minimal: Intent → Anchor → Participation → Cost → Benefit → Invite Preview
function SceneComposerSurface({ tool, onBack, onCreated, scene }: { tool: SceneToolId; onBack: () => void; onCreated: () => void; scene?: import("../scene-client").SceneClient | undefined }): React.JSX.Element {
  const meta = SCENE_TOOLS.find((t: { id: SceneToolId }) => t.id === tool);
  const [cost, setCost] = useState("HOST_SPONSORED");
  const [participation, setParticipation] = useState("OPEN_SIGNUP");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const guard = cost === "HOST_PAY" ? "HIGH_TRANSACTION_FEELING" : "GOOD_FIT";
  // SCENE-COMPOSER-PREVIEW-001: 「对方将看到」原来是一句写死的样例文案，被当成
  // 用户刚填的内容展示给他自己看。场景此刻还没创建，那句里的确认人数是从 0
  // 编出来的，地点和时间也不是用户选的（他选的是下面三个 chip）。现在预览由
  // 工具名 + 起始时间 + 参与方式 + 费用方式拼出来，和 createScene 用同一个
  // startsAt，两边说的必须是同一个场景。
  const startsAt = new Date(Date.now() + 86400000);
  const participationLabel = participation === "OPEN_SIGNUP" ? "公开报名" : participation === "PRIVATE_INVITE" ? "私邀关系" : "混合";
  const costLabel = cost === "HOST_SPONSORED" ? "发起方承担" : cost === "AA" ? "AA 分摊" : "商家权益";
  const previewBody = `${meta?.label ?? tool} · ${startsAt.toLocaleString()} · ${participationLabel} · ${costLabel}`;
  async function handleCreate(){
    if(!scene){ onCreated(); return; }
    setBusy(true); setError(undefined);
    try{
      await scene.createScene(tool, meta?.intentPrompt ?? "拍照", participation, cost, startsAt.toISOString());
      onCreated();
    }catch(e:any){ setError(e?.result?.error?.messageKey ?? e?.message ?? "创建失败"); } finally{ setBusy(false); }
  }
  return (
    <View style={styles.composerRoot}>
      <Pressable onPress={onBack} style={styles.composerBack}><ProxyBackGlyph label="返回" /></Pressable>
      <Text selectable style={styles.composerTitle}>{meta?.label ?? tool} · Scene Composer</Text>
      <Text selectable style={styles.composerSub}>P0: 把意图变成可邀请的 Scene — 预算进场景而非买人</Text>
      <View style={styles.composerField}><Text selectable style={styles.composerLabel}>意图</Text><View style={styles.composerInput}><Text selectable style={styles.composerInputText}>例如：周六下午想在西湖拍照 · 2–4人</Text></View></View>
      <View style={styles.composerRow}><Pressable onPress={() => setParticipation("OPEN_SIGNUP")} style={[styles.composerChip, participation==="OPEN_SIGNUP"&&styles.composerChipActive]}><Text selectable style={[styles.composerChipText, participation==="OPEN_SIGNUP"&&styles.composerChipTextActive]}>公开报名</Text></Pressable><Pressable onPress={() => setParticipation("PRIVATE_INVITE")} style={[styles.composerChip, participation==="PRIVATE_INVITE"&&styles.composerChipActive]}><Text selectable style={[styles.composerChipText, participation==="PRIVATE_INVITE"&&styles.composerChipTextActive]}>私邀关系</Text></Pressable><Pressable onPress={() => setParticipation("HYBRID")} style={[styles.composerChip, participation==="HYBRID"&&styles.composerChipActive]}><Text selectable style={[styles.composerChipText, participation==="HYBRID"&&styles.composerChipTextActive]}>混合</Text></Pressable></View>
      <View style={styles.composerRow}><Pressable onPress={() => setCost("HOST_SPONSORED")} style={[styles.composerChip, cost==="HOST_SPONSORED"&&styles.composerChipActive]}><Text selectable style={[styles.composerChipText, cost==="HOST_SPONSORED"&&styles.composerChipTextActive]}>Host Sponsored</Text></Pressable><Pressable onPress={() => setCost("AA")} style={[styles.composerChip, cost==="AA"&&styles.composerChipActive]}><Text selectable style={[styles.composerChipText, cost==="AA"&&styles.composerChipTextActive]}>AA</Text></Pressable><Pressable onPress={() => setCost("MERCHANT_SPONSORED")} style={[styles.composerChip, cost==="MERCHANT_SPONSORED"&&styles.composerChipActive]}><Text selectable style={[styles.composerChipText, cost==="MERCHANT_SPONSORED"&&styles.composerChipTextActive]}>商家权益</Text></Pressable></View>
      {guard!=="GOOD_FIT" ? <View style={styles.guardWarn}><Text selectable style={styles.guardWarnText}>Guard: 交易感过重 — 建议加场景权益而非直付</Text></View> : <View style={styles.guardOk}><Text selectable style={styles.guardOkText}>Guard: GOOD_FIT · 拿掉目标人仍成立</Text></View>}
      <View style={styles.invitePreview}><Text selectable style={styles.invitePreviewTitle}>对方将看到</Text><Text selectable style={styles.invitePreviewBody}>{previewBody}</Text><Text selectable style={styles.invitePreviewHint}>独立同意 · 可婉拒</Text></View>
      {error ? <Text selectable style={styles.guardWarnText}>{error}</Text> : null}
      <Pressable onPress={handleCreate} style={[styles.composerCTA, busy && {opacity:0.6}]} disabled={busy}><Text selectable style={styles.composerCTAText}>{busy ? "创建中…" : "创建 Scene 草稿"}</Text></Pressable>
    </View>
  );
}

// 基线 .locationcontext：⌖ 图标块 + 城市 / 本地范围说明 + 切换⌄。
// 自定义位置的坐标只用于数据层和地图定位；摘要层只呈现用户可理解的覆盖范围。
function LocationContext({
  location,
  deviceState,
  onOpenSceneMap,
  onSwitchLocation
}: {
  location: AnyLocation;
  deviceState: DeviceLocationState;
  onOpenSceneMap: () => void;
  onSwitchLocation: () => void;
}): React.JSX.Element {
  // DEVICE-LOCATION-001：副标题要能区分「跟随中」「定位中」「没授权」「不可用」——
  // 四者不许长得一样，更不许失败态伪装成成功的样子。
  // I18N-SETTINGS-001：这四句状态原来写死中文。四态不许长得一样这条约束不变
  // （那是 DEVICE-LOCATION-001 钉的），只是每态换成对应语言的键。
  const { t } = useI18n();
  const deviceSub =
    deviceState.kind === "acquiring" ? t("locStateAcquiring")
    : deviceState.kind === "permission_denied" ? t("locStateDenied")
    : deviceState.kind === "unavailable" ? t("locStateUnavailable", { message: deviceState.message })
    : "";
  // UI-COPY-HONEST-001（2026-10-01，用户：「home 首页的废话 你正在看的本地范围xxx
  // 移除 很多废话要移除」）：原来无论有没有事要說都渲染一行字幕 ——
  // 「你正在看的本地范围 · 仅城市 / 区域」/「跟随你的位置 · 移动后自动更新 · 仅城市 / 区域」
  // 都在解释一件用户没问的事，而且「切换⌄」按钮就在旁边，不该再用文字教用户怎么用。
  //
  // 现在**没有值得说的事就不渲染这一行**：只有定位中 / 未授权 / 不可用 /
  // 手动选的地图点（那四件事用户确实需要知道）才出字幕。
  const sub = location.kind === "CUSTOM"
    ? t("locScopeMapPick", { radius: formatRadius(location.custom.radiusMeters) })
    : deviceSub;
  return (
    <View style={styles.locationRow}>
    <Pressable
      accessibilityLabel={t("locOpenMapA11y")}
      accessibilityRole="button"
      onPress={onOpenSceneMap}
      style={({ pressed }) => [styles.locationMain, pressed && styles.locationRowPressed]}
    >
      <View style={styles.locationPin}>
        {/* MAP-FOOTPRINT-LOGO-001：首页场景地图入口用原型「折叠地图」logo。
            27 小格里用 21（48 栅格原画显小一圈，等效原来 route 17 的分量）。 */}
        <ProxyIcon color={color.ink} name="mapFold" size={21} />
      </View>
      <View style={styles.locationCopy}>
        <Text selectable numberOfLines={2} style={styles.locationCity}>{formatLocationTitle(location)}</Text>
        {sub ? (
          <Text selectable numberOfLines={1} style={styles.locationSub}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
      <Pressable accessibilityLabel={t("locSwitchScopeA11y")} accessibilityRole="button" onPress={onSwitchLocation} style={styles.locationSwitchButton}><Text selectable style={styles.locationSwitch}>{t("locSwitch")}</Text></Pressable>
    </View>
  );
}

// iOS 26 / proxy_transparent_swipe_dock_v2.html 基线：透明毛玻璃 + lens 跟手 + 橙标惯性
// 参 v2.html: --accent #ff8a00, glass blur24 saturate155, lens blur30 saturate180, progress×100%, velocity拉伸, scale/lift/opacity插值
function RootNav({
  activePage,
  compact,
  bottomInset,
  onCommitPage
}: {
  activePage: PageId;
  compact: boolean;
  bottomInset?: number;
  onCommitPage: (page: PageId) => void;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  // I18N-SETTINGS-001：语言变化时整排 tab 标签重取。这里是**渲染时**取，
  // 不是模块顶层 —— 顶层在 import 时就求值完了，那时还没有语言状态。
  const { t } = useI18n();
  const tabs = rootTabs(t);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [liquidMotion, setLiquidMotion] = useState(0);
  const [liquidLean, setLiquidLean] = useState(0);
  // R15.22 motion patch: Reduce Motion 系统设置降级 (无障碍).
  // 用户开 Reduce Motion 时, liquid dock 的拖动拉伸 + press spring 全部停掉,
  // 仅保留静态 lens 状态, 符合 iOS/Android 系统级动效偏好.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduceMotion(!!v); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (e) => setReduceMotion(!!e));
    return () => { mounted = false; sub.remove(); };
  }, []);
  const pressProgress = useRef(new Animated.Value(0)).current;
  const dockWidth = measuredWidth > 0 ? measuredWidth : Math.min(430, Math.max(0, width - 28));
  const edge = 6;
  const slotWidth = dockWidth > 0 ? (dockWidth - edge * 2) / tabs.length : 72;
  const dockHeight = compact ? 60 : 68;
  const lensHeight = compact ? 50 : 54;
  const lensWBase = Math.min(64, slotWidth - 6);
  const accent = color.ink;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const lensPosition = useCallback((tabProgress: number) => edge + tabProgress * slotWidth + (slotWidth - lensWBase) / 2, [lensWBase, slotWidth]);

  const setLensPressed = useCallback((next: boolean) => {
    setPressing(next);
    const { useSpring } = selectMotionProfile(reduceMotion);
    if (!useSpring) {
      // Reduce Motion: 直接跳到目标值, 不 spring.
      pressProgress.setValue(next ? 1 : 0);
      return;
    }
    Animated.spring(pressProgress, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 320,
      mass: 0.55
    }).start();
  }, [pressProgress, reduceMotion]);

  // ============================================================
  // REANIMATED-VALUE-DRIVEN LENS (RN 内置 Animated + useNativeDriver):
  //   lensX = Animated.Value, 跟手指 setValue 跳过 React 渲染.
  //   commit 时 spring 动画 (damping 24, stiffness 285, mass 0.72).
  //   dock tab 高亮 离散 (仅 activePage 变才更新, dragging 中不变).
  // ============================================================
  const initialTabIdx = Math.max(0, tabs.findIndex((t) => t.id === PAGE_TO_ROOT[activePage]));
  const lensX = useRef(new Animated.Value(lensPosition(initialTabIdx))).current;
  const progressRef = useRef<number>(initialTabIdx);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startProgressRef = useRef(initialTabIdx);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const velocityRef = useRef(0);
  // progress 浮点 用于 dock tab scale/lift/opacity influence (跟手指平滑)
  const [progress, setProgress] = useState<number>(initialTabIdx);

  // activePage 外部变 → spring lens 到新位置 + 更新 progress (供 dock influence 用)
  useEffect(() => {
    if (draggingRef.current) return;
    const tabIdx = tabs.findIndex((t) => t.id === PAGE_TO_ROOT[activePage]);
    if (tabIdx < 0) return;
    progressRef.current = tabIdx;
    setProgress(tabIdx);
    Animated.spring(lensX, {
      toValue: lensPosition(tabIdx),
      useNativeDriver: true,
      damping: 24,
      stiffness: 285,
      mass: 0.72
    }).start();
  }, [activePage, lensPosition, tabs, lensX]);

  const commit = useCallback((tabProgress: number) => {
    const tabIdx = clamp(Math.round(tabProgress), 0, tabs.length - 1);
    progressRef.current = tabIdx;
    setProgress(tabIdx);
    const targetTab = tabs[tabIdx];
    if (!targetTab) return;
    const targetPage = ROOT_TO_FIRST_PAGE[targetTab.id];
    onCommitPage(targetPage);
    Animated.spring(lensX, {
      toValue: lensPosition(tabIdx),
      useNativeDriver: true,
      damping: 24,
      stiffness: 285,
      mass: 0.72
    }).start();
  }, [tabs, lensPosition, lensX, onCommitPage]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 6,
      onPanResponderGrant: (evt) => {
        draggingRef.current = true;
        startXRef.current = evt.nativeEvent.pageX;
        lastXRef.current = evt.nativeEvent.pageX;
        lastTRef.current = Date.now();
        startProgressRef.current = progressRef.current;
        velocityRef.current = 0;
        lensX.stopAnimation();
        setLensPressed(true);
      },
      onPanResponderMove: (evt) => {
        if (!draggingRef.current) return;
        const now = Date.now();
        const x = evt.nativeEvent.pageX;
        const dx = x - startXRef.current;
        const dt = Math.max(1, now - lastTRef.current);
        const vx = (x - lastXRef.current) / dt;
        lastXRef.current = x;
        lastTRef.current = now;
        velocityRef.current = vx;
        // Reduce Motion: 拖动拉伸归零, 仅保留按压 spring.
        if (reduceMotion) {
          setLiquidMotion(0);
          setLiquidLean(0);
        } else {
          setLiquidMotion(clamp(Math.abs(dx) / 90 + Math.abs(vx) / 1.8, 0, 1));
          setLiquidLean(clamp(vx / 1.8, -1, 1));
        }
        const deltaSlots = dx / Math.max(1, slotWidth);
        const next = clamp(startProgressRef.current + deltaSlots, 0, tabs.length - 1);
        progressRef.current = next;
        // setValue 走 native thread — 跳过 React 渲染, 60fps 顺滑
        lensX.setValue(lensPosition(next));
        // setProgress 走 React 渲染 (dock tab influence 需要)
        setProgress(next);
      },
      onPanResponderRelease: () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const projected = progressRef.current + velocityRef.current * 0.02;
        if (!reduceMotion) {
          setLiquidMotion(0);
          setLiquidLean(0);
        }
        setLensPressed(false);
        commit(projected);
      },
      onPanResponderTerminate: () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const projected = progressRef.current + velocityRef.current * 0.02;
        if (!reduceMotion) {
          setLiquidMotion(0);
          setLiquidLean(0);
        }
        setLensPressed(false);
        commit(projected);
      }
    })
  ).current;

  // iOS must use the real UIKit tab bar. Its selected lens samples live
  // content behind the dock and produces system refraction; opacity/blur
  // layers cannot reproduce that behavior. Android retains the custom dock
  // below as its platform fallback.
  if (Platform.OS === "ios") {
    return (
      <View style={[styles.dockWrap, { bottom: Math.max(bottomInset ?? 0, 8), width: dockWidth }]}>
        <View style={[styles.nativeTabShell, { height: dockHeight, width: dockWidth }]}>
          <ProxyNativeTabBarView
            onTabSelect={(event) => commit(event.nativeEvent.index)}
            selectedIndex={initialTabIdx}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.dockWrap, { bottom: Math.max(bottomInset ?? 0, 8), width: dockWidth }]}>
      {/*
        ============================================================
        LIQUID-GLASS DOCK — 静态冻结基线 (R15.22 审核过)
        ============================================================
        底栏 (nav): GlassContainer + GlassView glassEffectStyle="clear"
          (8px padding, 0.32 hairline border, dock 高度 60/68)
        水滴 (lens): 与 dock 同一 GlassContainer 的兄弟 GlassView
          静态基线:
            · width  = lensWBase = min(64, slotWidth-6)   (窄于 slot 6px+)
            · height = lensHeight = 50/54
            · borderRadius 28, borderCurve "continuous"
            · border hairline rgba(255,255,255,0.34)
            · top 7, left 0, overflow hidden
            · transform translateX = lensX (snap 到 tab center)
            · scale = 1 (静态不加)
            · glassEffectStyle = "regular", tintColor undefined
            · 子件 lensAccent opacity 0 (静态隐藏)
          交互态仅增, 不改基线:
            · 按压 pressing: scale 1.12, material regular → clear
        后续 PR 动静态值必须更新本注释并附 evidence。
        ============================================================
      */}
      <GlassContainer spacing={12} style={[styles.glassContainer, { width: dockWidth }]}>
        <GlassView
          glassEffectStyle="clear"
          isInteractive={false}
          onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
          style={[styles.nav, compact && styles.navCompact, { height: dockHeight, overflow: "hidden" }]}
        >
          <View pointerEvents="none" style={styles.topRefraction} />
          <View pointerEvents="none" style={styles.bottomRefraction} />
          <View pointerEvents="none" style={styles.leftGlint} />
          <View pointerEvents="none" style={styles.rightGlint} />
        </GlassView>
        <Animated.View
            pointerEvents="none"
            style={[
              styles.lens,
              pressing && styles.lensPressed,
              {
                width: lensWBase,
                height: lensHeight,
                transform: [
                  { translateX: lensX },
                  { translateY: liquidMotion * 0.4 },
                  {
                    scaleX: Animated.add(
                      pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }),
                      liquidMotion * 0.16
                    )
                  },
                  {
                    scaleY: Animated.add(
                      pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }),
                      -liquidMotion * 0.055
                    )
                  },
                  { rotate: `${liquidLean * 1.15}deg` }
                ]
              }
            ]}
          >
            <GlassView
              glassEffectStyle={{
                style: pressing ? "clear" : "regular",
                animate: true,
                animationDuration: 0.12
              }}
              isInteractive={false}
              style={[
                StyleSheet.absoluteFill,
                { borderRadius: 28, overflow: "hidden" }
              ]}
            >
              <View pointerEvents="none" style={[styles.lensSheen, pressing && styles.lensSheenPressed]} />
              <View pointerEvents="none" style={styles.lensAccent} />
              {/* R15.22 motion patch: lens 内部折射层 — 随 lean 同向增亮, 静态 opacity 0. */}
              <View
                pointerEvents="none"
                style={[
                  styles.lensGlintLeft,
                  { opacity: liquidMotion * Math.max(0, -liquidLean) * 0.5 }
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.lensGlintRight,
                  { opacity: liquidMotion * Math.max(0, liquidLean) * 0.5 }
                ]}
              />
            </GlassView>
          </Animated.View>
        <View
          {...panResponder.panHandlers}
          style={[styles.navInteractionLayer, { height: dockHeight }]}
        >
          {tabs.map((entry, i) => {
            // dock tab influence: progress 浮点跟手指平滑
            // 离散高亮: i === initialTabIdx (commit 后才更新)
            const isActiveVisual = i === initialTabIdx;
            const d = Math.abs(i - progress);
            const influence = clamp(1 - d * 0.7, 0, 1);
            const scale = 1 + influence * 0.1;
            const lift = -influence * 0.6;
            const opacity = 0.72 + influence * 0.28;
            return (
              <Pressable
                key={entry.id}
                onPress={() => {
                  if (draggingRef.current) return;
                  commit(i);
                }}
                onPressIn={() => setLensPressed(true)}
                onPressOut={() => setLensPressed(false)}
                style={styles.navItem}
                hitSlop={8}
              >
                <View style={[
                  styles.navContent,
                  { transform: [{ scale }, { translateY: lift }], opacity }
                ]}>
                  <View style={styles.navIcon}>
                    <ProxyIcon color={isActiveVisual ? accent : "#8d8d92"} name={entry.icon} size={22} />
                    {entry.badge ? <View style={styles.navBadgeDot} /> : null}
                  </View>
                  <Text selectable
                    numberOfLines={1}
                    style={[
                      styles.navLabel,
                      isActiveVisual ? styles.navLabelActive : null
                    ]}
                  >
                    {entry.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </GlassContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: color.offWhite, flex: 1 },
  root: { backgroundColor: color.offWhite, flex: 1, paddingTop: Platform.OS === "android" ? 24 : 0 },
  rootWide: { alignSelf: "center", maxWidth: 720, width: "100%" },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 18
  },
  headerCompact: { height: 46, paddingHorizontal: 14 },
  headerBrand: { alignItems: "center", flexDirection: "row", gap: 10 },
  headerLogo: {
    backgroundColor: "#08090A",
    borderRadius: 11,
    height: 40,
    marginLeft: 1,
    width: 40
  },
  headerLogoCompact: { borderRadius: 10, height: 36, width: 36 },
  headerName: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  headerNameCompact: { fontSize: 26, lineHeight: 32 },
  // NOTIF-BELL-001：铃铛 + 角标。原型那条角标是 top:-4 / right:-6 的红底白字胶囊；
  // 这里贴着铃铛右上角，并用顶栏底色描一圈 —— 不描的话红胶囊会跟铃铛的描边糊在一起。
  headerBell: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  headerBellPressed: { opacity: 0.6 },
  headerBellBadge: {
    alignItems: "center",
    backgroundColor: foundation.danger,
    borderColor: color.offWhite,
    borderRadius: 999,
    borderWidth: 1.5,
    justifyContent: "center",
    minWidth: 16,
    paddingHorizontal: 4,
    position: "absolute",
    right: -8,
    top: -6
  },
  headerBellBadgeText: { color: color.white, fontSize: 10, fontWeight: "900", lineHeight: 13 },
  locationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 15,
    paddingTop: 3
  },
  locationMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 8 },
  locationSwitchButton: { alignItems: "center", alignSelf: "stretch", justifyContent: "center", paddingLeft: 8 },
  // R15.13 P5：LocationContext 变成真可按 — “切换⌄” 现在真的会跳出 picker。
  // pressed 状态给个轻微背景色，用户能看到交互发生。
  locationRowPressed: { backgroundColor: "#F1EAF7" },
  locationPin: {
    alignItems: "center",
    backgroundColor: "#F1EAF7",
    borderRadius: 10,
    height: 27,
    justifyContent: "center",
    width: 27
  },
  locationCopy: { flex: 1 },
  locationCity: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  locationSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  locationSwitch: { color: "#6E6575", fontSize: 12, fontWeight: "800" },
  body: { flex: 1 },
  dockWrap: {
    position: "absolute",
    alignSelf: "center",
    alignItems: "center",
    gap: 0,
    zIndex: 100
  },
  nativeTabShell: { overflow: "visible" },
  nativeTabOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 8
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 10, opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" as const },
  hintLine: { width: 22, height: 1, backgroundColor: "transparent" },
  hintText: { color: "transparent", fontSize: 11, letterSpacing: 0.2, height: 0 },
  nav: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: 34,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 66,
    paddingHorizontal: 8,
    paddingVertical: 0,
    alignItems: "center",
    overflow: "hidden"
  },
  navCompact: { height: 60, borderRadius: 30 },
  topRefraction: {
    position: "absolute",
    top: 1,
    left: 24,
    right: 24,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.50)"
  },
  bottomRefraction: {
    position: "absolute",
    bottom: 1,
    left: 34,
    right: 34,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)"
  },
  leftGlint: {
    position: "absolute",
    left: 2,
    top: 18,
    width: StyleSheet.hairlineWidth,
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.20)"
  },
  rightGlint: {
    position: "absolute",
    right: 2,
    top: 18,
    width: StyleSheet.hairlineWidth,
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)"
  },
  glassContainer: { width: "100%" },
  navInteractionLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 8,
    zIndex: 2
  },
  lens: {
    position: "absolute",
    top: 7,
    left: 0,
    height: 54,
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderColor: "rgba(255,255,255,0.34)",
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 1,
    overflow: "hidden"
  },
  lensPressed: {
    backgroundColor: "rgba(255,255,255,0)",
    borderColor: "rgba(255,255,255,0.12)"
  },
  lensDragging: { opacity: 1 },
  lensSheen: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.7)",
    opacity: 0.16
  },
  lensSheenPressed: { opacity: 0 },
  // R15.22 motion patch: lens 内部折射层, Reduce Motion 下保持 opacity 0.
  lensGlintLeft: { position: "absolute", left: 2, top: 8, width: 1.5, height: 22, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.85)", opacity: 0 },
  lensGlintRight: { position: "absolute", right: 2, top: 8, width: 1.5, height: 22, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.85)", opacity: 0 },
  lensAccent: {
    position: "absolute",
    left: "50%",
    bottom: 4,
    width: 18,
    height: 2,
    borderRadius: 999,
    backgroundColor: color.ink,
    marginLeft: -9,
    opacity: 0
  },
  navItem: { alignItems: "center", flex: 1, gap: 4, justifyContent: "center", height: "100%", backgroundColor: "transparent", zIndex: 2 },
  navContent: { alignItems: "center", flexDirection: "column", gap: 2, justifyContent: "center" },
  navIcon: { alignItems: "center", height: 26, justifyContent: "center", width: 26 },
  navBadgeDot: { position: "absolute", top: -1, right: -2, width: 7, height: 7, borderRadius: 999, backgroundColor: color.ink, borderColor: "rgba(255,255,255,0.95)", borderWidth: 1.5 },
  navLabel: { color: "#8d8d92", fontSize: 11, fontWeight: "500", lineHeight: 13, letterSpacing: -0.12, textAlign: "center" },
  navLabelActive: { color: "#111111", fontWeight: "600" },

  composerRoot: { flex: 1, padding: 16, gap: 10, backgroundColor: color.offWhite },
  composerBack: { alignSelf: "flex-start", paddingVertical: 6 },
  // composerBackText 已删：字形和标签都由公共组件 ProxyBackGlyph 画（BACK-GLYPH-001）。
  composerTitle: { color: color.ink, fontSize: 22, fontWeight: "900" },
  composerSub: { color: color.muted, fontSize: 12, lineHeight: 17 },
  composerField: { marginTop: 6, gap: 6 },
  composerLabel: { color: color.ink, fontSize: 12, fontWeight: "800" },
  composerInput: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 14, padding: 12 },
  composerInputText: { color: color.muted, fontSize: 13 },
  composerRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  composerChip: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  composerChipActive: { backgroundColor: color.ink, borderColor: color.ink },
  composerChipText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  composerChipTextActive: { color: color.white },
  invitePreview: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 6, marginTop: 4 },
  invitePreviewTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  invitePreviewBody: { color: color.ink, fontSize: 13, lineHeight: 18 },
  invitePreviewHint: { color: color.muted, fontSize: 11 },
  composerCTA: { backgroundColor: color.ink, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  composerCTAText: { color: color.white, fontSize: 14, fontWeight: "900" },
  guardWarn: { backgroundColor: color.stateDangerBg, borderColor: color.stateDangerBorder, borderWidth: 1, borderRadius: 12, padding: 10 },
  guardWarnText: { color: color.error, fontSize: 12, fontWeight: "700" },
  guardOk: { backgroundColor: color.organicBg, borderColor: color.mint, borderWidth: 1, borderRadius: 12, padding: 10 },
  guardOkText: { color: color.organicFg, fontSize: 12, fontWeight: "700" },

  guestMe: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: color.offWhite },
  guestMeTitle: { color: color.ink, fontSize: 20, fontWeight: "900" },
  guestMeSub: { color: color.muted, fontSize: 13, textAlign: "center", lineHeight: 18 },
  guestMeCTA: { backgroundColor: color.ink, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  guestMeCTAText: { color: color.white, fontSize: 14, fontWeight: "900" },
});

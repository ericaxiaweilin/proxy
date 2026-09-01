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
  formatRadius,
  gridToLatLng,
  type AnyLocation,
  type CustomLocation,
  type PresetLocation
} from "../components/location-picker-sheet";
import { loadActiveCustomId, loadCustomHistory } from "../components/location-store";
import { type ConversationClient } from "../conversation-client";
import { type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type DemandClient } from "../demand-client";
import { type VoucherClient } from "../voucher-client";
import { type EngagementClient } from "../engagement-client";
import { type MarketplaceClient } from "../marketplace-client";
import { type ExperienceClient } from "../experience-client";
import { keepManifestRevision } from "../experience-refresh";
import { dispatchExperienceAction } from "../experience-dispatcher";
import { handleModuleBack } from "../components/module-back";
import { type LocalNetClient } from "../localnet-client";
import { type MediaClient } from "../media-client";
import { type SocialSpaceClient } from "../socialspace-client";
import { type FulfillmentClient } from "../fulfillment-client";
import { type PaymentClient } from "../payment-client";
import { type NotificationClient } from "../notification-client";
import { type BusinessClient } from "../business-client";
import { type SupplyClient } from "../supply-client";
import { BusinessHome } from "../surfaces/business-home";
import { ConversationSurface } from "../surfaces/conversation";
import { FeedSurface } from "../surfaces/feed";
import { FeedPrefsSurface } from "../surfaces/feed-prefs";
import { FulfillmentWorkspace, type WorkspaceTarget } from "../surfaces/fulfillment-workspace";
import { HomeAssistantSurface } from "../surfaces/home-assistant";
import { MarketExperienceSurface } from "../surfaces/market-experience";
import { MarketSurface, type MarketViewMode } from "../surfaces/market";
import { MeSurface } from "../surfaces/me";
import { MessagesSurface } from "../surfaces/messages";
import { MapExploreSurface } from "../surfaces/map-explore";
import { RequesterHome, type RequesterGoal } from "../surfaces/requester-home";
import { VoucherSurface } from "../surfaces/voucher";
import { color, shadows } from "../theme";
import { type ActiveContext } from "../uiplan/types";
import { type MarketTab } from "../market-fixtures";
import type { SceneToolId } from "@proxy/contracts";
import { SCENE_TOOLS } from "@proxy/contracts";
import { selectShellChromeVisible } from "./app-shell-selectors";
import { selectMotionProfile } from "./app-shell-selectors";

// P0 原型的品牌图标，直接使用原始资源，不做裁剪、重绘或视觉加工。
const OTTER_LOGO = require("../../assets/otter-logo.png");

// R15.12.7 冻结：第二 Tab = 市场，对全部身份固定为「市场」。
type RootTab = "HOME" | "MARKET" | "FEED" | "MAP" | "MESSAGES" | "ME";
// R15.22 子页序列：horizontal swipe 跨 9 page (HOME, MARKET_OPP, MARKET_ACT, FEED_POSTS, FEED_STATUS, FEED_COMMUNITY, MSG_CHAT, MSG_FRIENDS, ME)
// R15.23 改：FEED tab 内部 3 个 section (动态/状态/社区) 各自独立成 page — 横向 swipe 必须先走完 section 才到 MESSAGES，避免 "动态 → 直接消息" 的跳页。
type PageId = "HOME" | "MARKET_OPP" | "MARKET_ACT" | "FEED_POSTS" | "FEED_STATUS" | "FEED_COMMUNITY" | "MSG_CHAT" | "MSG_FRIENDS" | "ME";
const PAGE_SEQUENCE: ReadonlyArray<PageId> = ["HOME", "MARKET_OPP", "MARKET_ACT", "FEED_POSTS", "FEED_STATUS", "FEED_COMMUNITY", "MSG_CHAT", "MSG_FRIENDS", "ME"];
const PAGE_TO_ROOT: Record<PageId, RootTab> = {
  HOME: "HOME", MARKET_OPP: "MARKET", MARKET_ACT: "MARKET",
  FEED_POSTS: "FEED", FEED_STATUS: "FEED", FEED_COMMUNITY: "FEED",
  MSG_CHAT: "MESSAGES", MSG_FRIENDS: "MESSAGES",
  ME: "ME"
};
// R15.32: MAP tab is its own page (no horizontal swipe siblings — it
// owns the full screen). Defined alongside PageId below.
const PAGE_TO_FEED_SECTION: Partial<Record<PageId, "POSTS" | "STATUS" | "COMMUNITY">> = {
  FEED_POSTS: "POSTS", FEED_STATUS: "STATUS", FEED_COMMUNITY: "COMMUNITY"
};
const ROOT_TO_FIRST_PAGE: Record<RootTab, PageId> = {
  HOME: "HOME", MARKET: "MARKET_OPP", FEED: "FEED_POSTS",
  MESSAGES: "MSG_FRIENDS", ME: "ME", MAP: "HOME" // not used; MAP is full-screen
};

function rootTabs(): ReadonlyArray<{ id: RootTab; icon: ProxyIconName; label: string; badge?: string }> {
  return [
    { id: "HOME", icon: "home", label: "首页" },
    { id: "MARKET", icon: "diamond", label: "市场" },
    { id: "FEED", icon: "target", label: "动态" },
    { id: "MAP", icon: "pin", label: "地图" },
    { id: "MESSAGES", icon: "chat", label: "消息", badge: "9+" },
    { id: "ME", icon: "meRing", label: "我的" }
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
  marketplace,
  socialSpace,
  fulfillment,
  payment,
  notification,
  business,
  supply,
  scene,
  isGuest,
  ensureConversationSession,
  onSignOut,
  sessionAuthClient,
  localApiBaseUrl
}: {
  localNet: LocalNetClient;
  activities: ActivityClient;
  experience: ExperienceClient;
  conversation: ConversationClient;
  media: MediaClient;
  demand: DemandClient;
  vouchers: VoucherClient;
  engagement: EngagementClient;
  marketplace: MarketplaceClient;
  socialSpace: SocialSpaceClient;
  fulfillment: FulfillmentClient;
  payment: PaymentClient;
  notification: NotificationClient;
  business: BusinessClient;
  supply: SupplyClient;
  scene?: import("../scene-client").SceneClient | undefined;
  isGuest?: boolean;
  ensureConversationSession?: (() => Promise<void>) | undefined;
  onSignOut: () => void;
  sessionAuthClient: import("../auth-client").SessionAuthClient;
  localApiBaseUrl: string;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compactWidth = width < 375;
  const [tab, setTab] = useState<RootTab>("HOME");
  const [context, setContext] = useState<ActiveContext>("REQUESTER");
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget>();
  const [feedChatAuthor, setFeedChatAuthor] = useState<string>();
  const [messageChat, setMessageChat] = useState<{ author: string; conversationId?: string }>();
  const messageChatAuthor = messageChat?.author;
  const [marketEntry, setMarketEntry] = useState<{
    tab: MarketTab;
    viewMode: MarketViewMode;
  }>({ tab: "OPPORTUNITY", viewMode: "LIST" });
  // R15.22: 子页 override (swipe 跨 7 page). null = 跟随 tab + sub-tab 状态.
  const [pageOverride, setPageOverride] = useState<PageId | undefined>();
  // R15.23: feedSection 是 FEED tab 内部的 section 状态 (动态/状态/社区)。
  // 跨 page 切到 FEED_* 时同步设过来；swipe 切到 next/prev page 时也同步更新。
  const [feedSection, setFeedSection] = useState<"POSTS" | "STATUS" | "COMMUNITY">("POSTS");
  const currentPage: PageId = pageOverride ?? ((): PageId => {
    if (tab === "HOME") return "HOME";
    if (tab === "MARKET") return marketEntry.tab === "ACTIVITY" ? "MARKET_ACT" : "MARKET_OPP";
    if (tab === "FEED") {
      // R15.23: 跟随 feedSection 而非写死 FEED_REC
      if (feedSection === "STATUS") return "FEED_STATUS";
      if (feedSection === "COMMUNITY") return "FEED_COMMUNITY";
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
  const [openExperience, setOpenExperience] = useState<string>();
  const [experienceManifest, setExperienceManifest] =
    useState<ExperienceManifest>();
  const [feedRefreshTrigger, setFeedRefreshTrigger] = useState(0);
  const [feedPrefsOpen, setFeedPrefsOpen] = useState(false);
  const [feedChromeVisible, setFeedChromeVisible] = useState(true);
  const touchStartY = useRef<number | undefined>(undefined);
  const lastTouchY = useRef<number | undefined>(undefined);
  const touchStartX = useRef<number | undefined>(undefined);
  const lastTouchX = useRef<number | undefined>(undefined);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [homeAssistant, setHomeAssistant] = useState<{ text: string; mode?: HomeIntentMode; attachment?: HomeAttachment }>();
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

  // R15.13 P6：mount 时拉一次"上次激活的自定义坐标" — 跨会话保留
  // 用户放置的 pin / 半径。如果从未放过，sheet 也仍能从 history
  // 拉回 (loadCustomHistory 在 sheet 内部调，这里只关心 active)。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const activeId = await loadActiveCustomId();
      if (cancelled || !activeId) return;
      const items = await loadCustomHistory();
      const found = items.find((entry) => entry.id === activeId);
      if (!cancelled && found) setCurrentLocation(found);
    })();
    return () => { cancelled = true; };
  }, []);

  // 规范 §4/§13：Android 硬件返回 = 退整个模块，不逐页退（模块内层级由
  // useModuleBackHandler 注册栈先消费）。顺序即最上层优先：后挂载的 Tab 状态先判。
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (handleModuleBack()) return true;
      if (voucherOpen) { setVoucherOpen(false); return true; }
      if (tab === "ME" && messageChatAuthor) { setMessageChat(undefined); return true; }
      if (tab === "MESSAGES" && messageChatAuthor) { setMessageChat(undefined); return true; }
      if (tab === "FEED" && feedPrefsOpen) { setFeedPrefsOpen(false); return true; }
      if (tab === "FEED" && feedChatAuthor) { setFeedChatAuthor(undefined); return true; }
      if (tab === "MARKET" && openExperience) { setOpenExperience(undefined); return true; }
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
    if (next === "MARKET") {
      setMarketEntry({ tab: "OPPORTUNITY", viewMode: "LIST" });
      setOpenExperience(undefined);
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
    }
    if (next !== "MESSAGES") setMessageChat(undefined);
    if (next !== "ME") setVoucherOpen(false);
  }

  function openMarket(entry: { tab: MarketTab; viewMode?: MarketViewMode }): void {
    setMarketEntry({ tab: entry.tab, viewMode: entry.viewMode ?? "LIST" });
    setOpenExperience(undefined);
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
  // Only the primary Feed stream owns scroll-driven shell chrome. Chat,
  // Home/Market/Me forms and Feed's nested chat/preferences keep navigation
  // stable so moving through messages cannot unexpectedly summon/hide it.
  const isNavVisible = selectShellChromeVisible({
    tab,
    feedChromeVisible,
    feedChatOpen: Boolean(feedChatAuthor),
    feedPrefsOpen,
    messageChatOpen: Boolean(messageChatAuthor)
  });

  return (
    <>
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={[styles.root, width >= 768 && styles.rootWide]}>
        <StatusBar animated={false} backgroundColor={color.offWhite} barStyle="dark-content" translucent={false} />
        {isNavVisible ? <Header compact={compactWidth} /> : null}
        {/* 首页的本地范围说明属于 root Chrome；“我的”根页由 Me Surface 自己渲染，避免泄漏到其详情页。 */}
        {isNavVisible && (tab === "HOME" || tab === "MESSAGES") ? (
          <LocationContext
            location={currentLocation}
            onPress={() => setLocationSheetOpen(true)}
          />
        ) : null}
        <View
          onTouchEnd={() => {
            const startX = touchStartX.current;
            const endX = lastTouchX.current ?? startX;
            const startY = touchStartY.current;
            const endY = lastTouchY.current ?? startY;
            if (startX !== undefined && endX !== undefined && startY !== undefined && endY !== undefined) {
              const dx = endX - startX;
              const dy = endY - startY;
              const absDx = Math.abs(dx);
              const absDy = Math.abs(dy);
              const swipeThreshold = 56;
              const isHorizontalSwipe = absDx > swipeThreshold && absDx > absDy * 1.25;
              const canSwipeRoot = !homeAssistant && !sceneComposerTool && !workspaceTarget && !feedChatAuthor && !feedPrefsOpen && !messageChatAuthor && !voucherOpen && !openExperience;
              if (isHorizontalSwipe && canSwipeRoot) {
                const idx = PAGE_SEQUENCE.indexOf(currentPage);
                if (idx < 0) return;
                if (dx < 0 && idx < PAGE_SEQUENCE.length - 1) goToPage(PAGE_SEQUENCE[idx + 1]!);
                else if (dx > 0 && idx > 0) goToPage(PAGE_SEQUENCE[idx - 1]!);
              }
            }
            touchStartY.current = undefined;
            lastTouchY.current = undefined;
            touchStartX.current = undefined;
            lastTouchX.current = undefined;
          }}
          onTouchMove={(event) => {
            const y = event.nativeEvent.pageY;
            const x = event.nativeEvent.pageX;
            lastTouchY.current = y;
            lastTouchX.current = x;
          }}
          onTouchStart={(event) => {
            touchStartY.current = event.nativeEvent.pageY;
            lastTouchY.current = event.nativeEvent.pageY;
            touchStartX.current = event.nativeEvent.pageX;
            lastTouchX.current = event.nativeEvent.pageX;
          }}
          style={styles.body}
        >
        {tab === "HOME" ? (
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
                openMarket({ tab: "OPPORTUNITY" });
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
              onChat={(text, mode, attachment) => openHomeAssistant(text, mode, attachment)}
              bottomNavVisible={isNavVisible}
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
              onEnterWorkspace={enterWorkspace}
              onOpenFeed={() => selectTab("FEED")}
              onOpenMarket={(tab) => openMarket({ tab })}
              onChat={(text, mode, attachment) => openHomeAssistant(text, mode, attachment)}
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
                    openMarket({ tab: "OPPORTUNITY" });
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
              onCreateScene={setSceneComposerTool}
              bottomNavVisible={isNavVisible}
            />
          )
        ) : tab === "MARKET" ? (
          openExperience ? (
            <MarketExperienceSurface experienceId={openExperience} onBack={() => setOpenExperience(undefined)} />
          ) : (
            <MarketSurface
              activities={activities}
              marketplace={marketplace}
              fulfillment={fulfillment}
              media={media}
              supply={supply}
              marketLabel="河内"
              initialTab={marketEntry.tab}
              onOpenExperience={setOpenExperience}
              onOpenActivity={() => undefined}
              bottomNavVisible={isNavVisible}
            />
          )
        ) : tab === "FEED" ? (
          feedChatAuthor ? (
            <ConversationSurface
              author={feedChatAuthor}
              conversationClient={conversation}
              onBack={() => setFeedChatAuthor(undefined)}
            />
          ) : feedPrefsOpen ? (
            <FeedPrefsSurface onBack={() => setFeedPrefsOpen(false)} />
          ) : (
            <FeedSurface
              engagement={engagement}
              localNet={localNet}
              mediaClient={media}
              socialSpace={socialSpace}
              onChromeVisibilityChange={setFeedChromeVisible}
              onOpenChat={setFeedChatAuthor}
              onOpenFeedPrefs={() => setFeedPrefsOpen(true)}
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
              conversationClient={conversation}
              onBack={() => setMessageChat(undefined)}
            />
          ) : (
            <MessagesSurface conversationClient={conversation} onOpenConversation={(author, conversationId) => setMessageChat(conversationId ? { author, conversationId } : { author })} bottomNavVisible={isNavVisible} initialTab={currentPage === "MSG_CHAT" ? "CHAT" : "FRIENDS"} />
          )
        ) : tab === "MAP" ? (
          // R15.32: Instagram-style map. Anonymous GET /v1/map/items,
          // uses sessionAuthClient.requestPublic. The full-screen map
          // ignores isNavVisible since it has its own bottom HUD.
          <MapExploreSurface
            requester={sessionAuthClient}
            baseUrl={localApiBaseUrl}
            onClose={isNavVisible ? undefined : () => setTab("HOME")}
          />
        ) : isGuest ? (
          <View style={styles.guestMe}>
            <Text style={styles.guestMeTitle}>需要登录</Text>
            <Text style={styles.guestMeSub}>访客可浏览首页/市场/动态，个人资料、关系与订单需登录后查看</Text>
            <Pressable onPress={onSignOut} style={styles.guestMeCTA}><Text style={styles.guestMeCTAText}>去登录 / 注册</Text></Pressable>
          </View>
        ) : voucherOpen ? (
            <VoucherSurface client={vouchers} context={context} onBack={() => setVoucherOpen(false)} />
          ) : (
            <MeSurface
              context={context}
              localNet={localNet}
              fulfillment={fulfillment}
              business={business}
              supply={supply}
              {...(experienceManifest?.context === context
                ? {
                    experienceSections: experienceManifest.me.sections,
                    ...(experienceManifest.me.mode ? { experienceMode: experienceManifest.me.mode } : {})
                  }
                : {})}
              onOpenSwitcher={openContextSwitcher}
              onOpenFeed={() => selectTab("FEED")}
              onOpenVouchers={() => setVoucherOpen(true)}
              onExperienceAction={executeExperienceAction}
              onOpenConversation={(author) => {
                setMessageChat({ author });
                setTab("MESSAGES");
              }}
              onSignOut={onSignOut}
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
            { id: "REQUESTER", icon: "meRing", title: "用户", desc: "找服务、看订单、参加活动，也可以开放自己的服务能力" },
            { id: "BUSINESS", icon: "storeLines", title: "商家", desc: "经营店铺、找服务、发布订单与活动" }
          ]}
        />
        <LocationPickerSheet
          current={currentLocation}
          onClose={() => setLocationSheetOpen(false)}
          onSelect={setCurrentLocation}
          open={locationSheetOpen}
        />
      </View>
      </SafeAreaView>
    </>
  );
}



// 基线 .header.root：只有 Otter logo + Proxy 字标（上下文徽章不在此层，见 Me 的 contextline）。
function Header({ compact }: { compact: boolean }): React.JSX.Element {
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.headerBrand}>
        <Image resizeMode="contain" source={OTTER_LOGO} style={[styles.headerLogo, compact && styles.headerLogoCompact]} />
        <Text style={[styles.headerName, compact && styles.headerNameCompact]}>Proxy</Text>
      </View>
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
  async function handleCreate(){
    if(!scene){ onCreated(); return; }
    setBusy(true); setError(undefined);
    try{
      await scene.createScene(tool, meta?.intentPrompt ?? "拍照", participation, cost, new Date(Date.now()+86400000).toISOString());
      onCreated();
    }catch(e:any){ setError(e?.result?.error?.messageKey ?? e?.message ?? "创建失败"); } finally{ setBusy(false); }
  }
  return (
    <View style={styles.composerRoot}>
      <Pressable onPress={onBack} style={styles.composerBack}><Text style={styles.composerBackText}>‹ 返回</Text></Pressable>
      <Text style={styles.composerTitle}>{meta?.label ?? tool} · Scene Composer</Text>
      <Text style={styles.composerSub}>P0: 把意图变成可邀请的 Scene — 预算进场景而非买人</Text>
      <View style={styles.composerField}><Text style={styles.composerLabel}>意图</Text><View style={styles.composerInput}><Text style={styles.composerInputText}>例如：周六下午想在西湖拍照 · 2–4人</Text></View></View>
      <View style={styles.composerRow}><Pressable onPress={() => setParticipation("OPEN_SIGNUP")} style={[styles.composerChip, participation==="OPEN_SIGNUP"&&styles.composerChipActive]}><Text style={[styles.composerChipText, participation==="OPEN_SIGNUP"&&styles.composerChipTextActive]}>公开报名</Text></Pressable><Pressable onPress={() => setParticipation("PRIVATE_INVITE")} style={[styles.composerChip, participation==="PRIVATE_INVITE"&&styles.composerChipActive]}><Text style={[styles.composerChipText, participation==="PRIVATE_INVITE"&&styles.composerChipTextActive]}>私邀关系</Text></Pressable><Pressable onPress={() => setParticipation("HYBRID")} style={[styles.composerChip, participation==="HYBRID"&&styles.composerChipActive]}><Text style={[styles.composerChipText, participation==="HYBRID"&&styles.composerChipTextActive]}>混合</Text></Pressable></View>
      <View style={styles.composerRow}><Pressable onPress={() => setCost("HOST_SPONSORED")} style={[styles.composerChip, cost==="HOST_SPONSORED"&&styles.composerChipActive]}><Text style={[styles.composerChipText, cost==="HOST_SPONSORED"&&styles.composerChipTextActive]}>Host Sponsored</Text></Pressable><Pressable onPress={() => setCost("AA")} style={[styles.composerChip, cost==="AA"&&styles.composerChipActive]}><Text style={[styles.composerChipText, cost==="AA"&&styles.composerChipTextActive]}>AA</Text></Pressable><Pressable onPress={() => setCost("MERCHANT_SPONSORED")} style={[styles.composerChip, cost==="MERCHANT_SPONSORED"&&styles.composerChipActive]}><Text style={[styles.composerChipText, cost==="MERCHANT_SPONSORED"&&styles.composerChipTextActive]}>商家权益</Text></Pressable></View>
      {guard!=="GOOD_FIT" ? <View style={styles.guardWarn}><Text style={styles.guardWarnText}>Guard: 交易感过重 — 建议加场景权益而非直付</Text></View> : <View style={styles.guardOk}><Text style={styles.guardOkText}>Guard: GOOD_FIT · 拿掉目标人仍成立</Text></View>}
      <View style={styles.invitePreview}><Text style={styles.invitePreviewTitle}>对方将看到</Text><Text style={styles.invitePreviewBody}>West Lake Rooftop · 周六 16:00 · 3人已确认 · 饮品 included · 交通支持 — 你也会参加</Text><Text style={styles.invitePreviewHint}>独立同意 · 可婉拒</Text></View>
      {error ? <Text style={styles.guardWarnText}>{error}</Text> : null}
      <Pressable onPress={handleCreate} style={[styles.composerCTA, busy && {opacity:0.6}]} disabled={busy}><Text style={styles.composerCTAText}>{busy ? "创建中…" : "创建 Scene 草稿"}</Text></Pressable>
    </View>
  );
}

// 基线 .locationcontext：⌖ 图标块 + 城市 / 本地范围说明 + 切换⌄。
// R15.13 P6：如果 location 是 CUSTOM (用户自定义坐标)，在副标题
// 显示 "lat, lng · 半径 X km" — 让用户记住自己放的位置。
function LocationContext({
  location,
  onPress
}: {
  location: AnyLocation;
  onPress: () => void;
}): React.JSX.Element {
  const sub = location.kind === "CUSTOM"
    ? (() => {
        const { lat, lng } = gridToLatLng(location.city, location.custom.gridX, location.custom.gridY);
        return `自定义 · ${lat.toFixed(4)}, ${lng.toFixed(4)} · 半径 ${formatRadius(location.custom.radiusMeters)}`;
      })()
    : "你正在看的本地范围 · 仅城市 / 区域";
  return (
    <Pressable
      accessibilityLabel="切换本地范围"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.locationRow, pressed && styles.locationRowPressed]}
    >
      <View style={styles.locationPin}>
        <ProxyIcon color={color.ink} name="route" size={17} />
      </View>
      <View style={styles.locationCopy}>
        <Text style={styles.locationCity}>{location.city} · {location.area}</Text>
        <Text numberOfLines={1} style={styles.locationSub}>
          {sub}
        </Text>
      </View>
      <Text style={styles.locationSwitch}>切换⌄</Text>
    </Pressable>
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
  const tabs = rootTabs();
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
  const slotWidth = dockWidth > 0 ? (dockWidth - edge * 2) / 5 : 72;
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
                  <Text
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
  locationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 15,
    paddingTop: 3
  },
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
  hintText: { color: "transparent", fontSize: 1, letterSpacing: 0.2, height: 0 },
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
  navLabel: { color: "#8d8d92", fontSize: 10.5, fontWeight: "500", lineHeight: 13, letterSpacing: -0.12, textAlign: "center" },
  navLabelActive: { color: "#111111", fontWeight: "600" },

  composerRoot: { flex: 1, padding: 16, gap: 10, backgroundColor: color.offWhite },
  composerBack: { alignSelf: "flex-start", paddingVertical: 6 },
  composerBackText: { color: color.muted, fontSize: 14, fontWeight: "700" },
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
  guardWarn: { backgroundColor: "#FFF0F3", borderColor: "#FFC4D3", borderWidth: 1, borderRadius: 12, padding: 10 },
  guardWarnText: { color: "#B5194E", fontSize: 12, fontWeight: "700" },
  guardOk: { backgroundColor: "#EDF9F6", borderColor: "#1FC8A9", borderWidth: 1, borderRadius: 12, padding: 10 },
  guardOkText: { color: "#137C6C", fontSize: 12, fontWeight: "700" },

  guestMe: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: color.offWhite },
  guestMeTitle: { color: color.ink, fontSize: 20, fontWeight: "900" },
  guestMeSub: { color: color.muted, fontSize: 13, textAlign: "center", lineHeight: 18 },
  guestMeCTA: { backgroundColor: color.ink, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  guestMeCTAText: { color: color.white, fontSize: 14, fontWeight: "900" },
});

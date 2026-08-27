// App Shell：RootNav 五标签 首页 / 市场 / 动态 / 消息 / 我的。
// R4 (2026-08-24)：Market = 机会 / 活动；移除体验上架，机会单向由客户发布、小美报名。
// EXPERIENCE 仅作历史路由别名，新 UI 不展示体验货架。
// Active Context（REQUESTER | BUSINESS）只是 Product State，切换不新增路由；
// 视觉基线：Proxy_Market_Xiaomei_Value_Negotiation_R4.html 布局 + R3 紫粉 token 保留。
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Image, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  ExperienceAction,
  ExperienceManifest,
  TasksExperienceParams
} from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import { ContextSwitcherSheet } from "../components/context-switcher";
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
import { RequesterHome, type RequesterGoal } from "../surfaces/requester-home";
import { VoucherSurface } from "../surfaces/voucher";
import { color, shadows } from "../theme";
import { type ActiveContext } from "../uiplan/types";
import { type MarketTab } from "../market-fixtures";
import type { SceneToolId } from "@proxy/contracts";
import { SCENE_TOOLS } from "@proxy/contracts";

// P0 原型的品牌图标，直接使用原始资源，不做裁剪、重绘或视觉加工。
const OTTER_LOGO = require("../../assets/otter-logo.png");

// R15.12.7 冻结：第二 Tab = 市场，对全部身份固定为「市场」。
type RootTab = "HOME" | "MARKET" | "FEED" | "MESSAGES" | "ME";

function rootTabs(): ReadonlyArray<{ id: RootTab; icon: ProxyIconName; label: string; badge?: string }> {
  return [
    { id: "HOME", icon: "home", label: "首页" },
    { id: "MARKET", icon: "diamond", label: "市场" },
    { id: "FEED", icon: "target", label: "动态" },
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
  scene,
  isGuest,
  onSignOut
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
  scene?: import("../scene-client").SceneClient | undefined;
  isGuest?: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compactWidth = width < 375;
  const [tab, setTab] = useState<RootTab>("HOME");
  const [context, setContext] = useState<ActiveContext>("REQUESTER");
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget>();
  const [feedChatAuthor, setFeedChatAuthor] = useState<string>();
  const [messageChatAuthor, setMessageChatAuthor] = useState<string>();
  const [marketEntry, setMarketEntry] = useState<{
    tab: MarketTab;
    viewMode: MarketViewMode;
  }>({ tab: "OPPORTUNITY", viewMode: "LIST" });
  const [openExperience, setOpenExperience] = useState<string>();
  const [experienceManifest, setExperienceManifest] =
    useState<ExperienceManifest>();
  const [feedRefreshTrigger, setFeedRefreshTrigger] = useState(0);
  const [feedPrefsOpen, setFeedPrefsOpen] = useState(false);
  const [feedChromeVisible, setFeedChromeVisible] = useState(true);
  const [scrollChromeVisible, setScrollChromeVisible] = useState(true);
  const touchStartY = useRef<number | undefined>(undefined);
  const lastTouchY = useRef<number | undefined>(undefined);
  const touchStartX = useRef<number | undefined>(undefined);
  const lastTouchX = useRef<number | undefined>(undefined);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [homeAssistant, setHomeAssistant] = useState<{ text: string; mode?: HomeIntentMode; attachment?: HomeAttachment }>();
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [sceneComposerTool, setSceneComposerTool] = useState<SceneToolId | undefined>(undefined);

  // 规范 §4/§13：Android 硬件返回 = 退整个模块，不逐页退（模块内层级由
  // useModuleBackHandler 注册栈先消费）。顺序即最上层优先：后挂载的 Tab 状态先判。
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (handleModuleBack()) return true;
      if (voucherOpen) { setVoucherOpen(false); return true; }
      if (tab === "ME" && messageChatAuthor) { setMessageChatAuthor(undefined); return true; }
      if (tab === "MESSAGES" && messageChatAuthor) { setMessageChatAuthor(undefined); return true; }
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
    setScrollChromeVisible(true);
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
    if (next !== "MESSAGES") setMessageChatAuthor(undefined);
    if (next !== "ME") setVoucherOpen(false);
  }

  function openMarket(entry: { tab: MarketTab; viewMode?: MarketViewMode }): void {
    setMarketEntry({ tab: entry.tab, viewMode: entry.viewMode ?? "LIST" });
    setOpenExperience(undefined);
    setWorkspaceTarget(undefined);
    setHomeAssistant(undefined);
    setFeedChatAuthor(undefined);
    setMessageChatAuthor(undefined);
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
  const isNavVisible = scrollChromeVisible && (tab !== "FEED" || feedChromeVisible || !!feedChatAuthor || feedPrefsOpen);

  return (
    <>
      <SafeAreaView edges={isNavVisible ? ["top", "bottom"] : ["top"]} style={styles.safeArea}>
      <View style={[styles.root, width >= 768 && styles.rootWide]}>
        <StatusBar animated={false} backgroundColor={color.offWhite} barStyle="dark-content" translucent={false} />
        {scrollChromeVisible ? <Header compact={compactWidth} /> : null}
        {/* 首页的本地范围说明属于 root Chrome；“我的”根页由 Me Surface 自己渲染，避免泄漏到其详情页。 */}
        {scrollChromeVisible && (tab === "HOME" || tab === "MESSAGES") ? <LocationContext /> : null}
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
                const order: ReadonlyArray<RootTab> = ["HOME", "MARKET", "FEED", "MESSAGES", "ME"];
                const idx = order.indexOf(tab);
                if (dx < 0 && idx < order.length - 1) selectTab(order[idx + 1]!);
                else if (dx > 0 && idx > 0) selectTab(order[idx - 1]!);
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
            const previousY = lastTouchY.current ?? touchStartY.current ?? y;
            const delta = y - previousY;
            if (Math.abs(delta) >= 6) setScrollChromeVisible(delta > 0);
            lastTouchY.current = y;
            lastTouchX.current = x;
          }}
          onTouchStart={(event) => {
            touchStartY.current = event.nativeEvent.pageY;
            lastTouchY.current = event.nativeEvent.pageY;
            touchStartX.current = event.nativeEvent.pageX;
            lastTouchX.current = event.nativeEvent.pageX;
          }}
          style={[styles.body, (isNavVisible && tab !== "FEED" ? { paddingBottom: 120 } : undefined)]}
        >
        {tab === "HOME" ? (
          sceneComposerTool ? (
            <SceneComposerSurface tool={sceneComposerTool} scene={scene} onBack={() => setSceneComposerTool(undefined)} onCreated={() => setSceneComposerTool(undefined)} />
          ) : homeAssistant ? (
            <HomeAssistantSurface
              conversationClient={conversation}
              mediaClient={media}
              initialText={homeAssistant.text}
              {...(homeAssistant.attachment ? { initialAttachment: homeAssistant.attachment } : {})}
              {...(homeAssistant.mode ? { mode: homeAssistant.mode } : {})}
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
              demandClient={demand}
              onCreateScene={setSceneComposerTool}
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
              marketLabel="河内"
              initialTab={marketEntry.tab}
              onOpenExperience={setOpenExperience}
              onOpenActivity={() => undefined}
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
            <FeedSurface engagement={engagement} localNet={localNet} marketplace={marketplace} mediaClient={media} socialSpace={socialSpace} onChromeVisibilityChange={setFeedChromeVisible} onOpenChat={setFeedChatAuthor} onOpenFeedPrefs={() => setFeedPrefsOpen(true)} refreshTrigger={feedRefreshTrigger} bottomNavVisible={isNavVisible} />
          )
        ) : tab === "MESSAGES" ? (
          messageChatAuthor ? (
            <ConversationSurface
              author={messageChatAuthor}
              conversationClient={conversation}
              onBack={() => setMessageChatAuthor(undefined)}
            />
          ) : (
            <MessagesSurface onOpenConversation={setMessageChatAuthor} />
          )
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
                setMessageChatAuthor(author);
                setTab("MESSAGES");
              }}
              onSignOut={onSignOut}
            />
          )}
        </View>
        {isNavVisible ? <RootNav activeTab={tab} compact={compactWidth} onSelect={selectTab} /> : null}
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
function LocationContext(): React.JSX.Element {
  return (
    <View style={styles.locationRow}>
      <View style={styles.locationPin}>
        <ProxyIcon color={color.ink} name="route" size={17} />
      </View>
      <View style={styles.locationCopy}>
        <Text style={styles.locationCity}>河内 · 还剑湖附近</Text>
        <Text numberOfLines={1} style={styles.locationSub}>
          你正在看的本地范围 · 仅城市 / 区域
        </Text>
      </View>
      <Text style={styles.locationSwitch}>切换⌄</Text>
    </View>
  );
}

// iOS 26 / proxy_transparent_swipe_dock_v2.html 基线：透明毛玻璃 + lens 跟手 + 橙标惯性
// 参 v2.html: --accent #ff8a00, glass blur24 saturate155, lens blur30 saturate180, progress×100%, velocity拉伸, scale/lift/opacity插值
function RootNav({
  activeTab,
  compact,
  onSelect
}: {
  activeTab: RootTab;
  compact: boolean;
  onSelect: (tab: RootTab) => void;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const tabs = rootTabs();
  const order: ReadonlyArray<RootTab> = ["HOME", "MARKET", "FEED", "MESSAGES", "ME"];
  const activeIndex = Math.max(0, order.indexOf(activeTab));
  const [progress, setProgress] = useState<number>(activeIndex);
  const [velocity, setVelocity] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startProgressRef = useRef(activeIndex);
  const lastXRef = useRef(0);
  const lastTRef = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    if (!draggingRef.current) setProgress(activeIndex);
  }, [activeIndex]);

  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [pressing, setPressing] = useState(false);
  const dockWidth = measuredWidth > 0 ? measuredWidth : Math.min(620, Math.max(0, width - 28));
  const slotWidth = dockWidth > 0 ? (dockWidth - 16) / 5 : 72;
  const dockHeight = compact ? 64 : 66;
  const lensHeight = compact ? 52 : 54;
  const accent = color.ink;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const commit = useCallback((idx: number) => {
    const next = clamp(Math.round(idx), 0, 4);
    setDragging(false);
    draggingRef.current = false;
    setVelocity(0);
    const targetTab = order[next];
    if (targetTab !== undefined) onSelect(targetTab);
    setProgress(next);
  }, [onSelect]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 6,
      onPanResponderGrant: (evt) => {
        draggingRef.current = true;
        setDragging(true);
        startXRef.current = evt.nativeEvent.pageX;
        lastXRef.current = evt.nativeEvent.pageX;
        lastTRef.current = Date.now();
        startProgressRef.current = progressRef.current;
        setVelocity(0);
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
        setVelocity(vx);
        const deltaSlots = dx / Math.max(1, slotWidth);
        const next = clamp(startProgressRef.current + deltaSlots, 0, 4);
        setProgress(next);
      },
      onPanResponderRelease: () => {
        if (!draggingRef.current) return;
        const projected = progressRef.current + velocity * 0.22;
        commit(projected);
      },
      onPanResponderTerminate: () => {
        if (!draggingRef.current) return;
        const projected = progressRef.current + velocity * 0.22;
        commit(projected);
      }
    })
  ).current;

  const velocityNorm = Math.min(1, Math.abs(velocity) / 1.2);
  const lensScaleX = 0.45 + velocityNorm * 0.55;

  return (
    <View style={styles.dockWrap}>
      <View
        onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
        style={[styles.nav, compact && styles.navCompact, { height: dockHeight }]}
      >
        <View pointerEvents="none" style={styles.dockHighlight} />
        <View
          pointerEvents="none"
          style={[
            styles.lens,
            {
              width: slotWidth,
              height: lensHeight,
              transform: [{ translateX: progress * slotWidth }, { scale: pressing ? 1.06 : 1 }],
            },
            dragging && styles.lensDragging
          ]}
        >
          <View style={[styles.lensAccent, { transform: [{ scaleX: lensScaleX }] }]} />
        </View>
        {tabs.map((entry, i) => {
          const d = Math.abs(i - progress);
          const influence = clamp(1 - d, 0, 1);
          const scale = 1 + influence * 0.1;
          const lift = -influence * 0.6;
          const opacity = 0.72 + influence * 0.28;
          const active = i === Math.round(progress) && !dragging ? i === activeIndex : false;
          const isActiveVisual = Math.abs(i - progress) < 0.35;
          return (
            <Pressable
              key={entry.id}
              onPress={() => { if (!draggingRef.current) commit(i); }}
              onPressIn={() => setPressing(true)}
              onPressOut={() => setPressing(false)}
              style={styles.navItem}
              hitSlop={8}
            >
              <View style={[styles.navIcon, { transform: [{ scale }, { translateY: lift }], opacity }]}>
                <ProxyIcon color={isActiveVisual ? accent : "#8d8d92"} name={entry.icon} size={22} />
                {entry.badge ? <View style={styles.navBadgeDot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
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
    bottom: 2,
    left: 14,
    right: 14,
    maxWidth: 620,
    alignSelf: "center",
    alignItems: "center",
    gap: 0,
    zIndex: 10
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 10, opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" as const },
  hintLine: { width: 22, height: 1, backgroundColor: "transparent" },
  hintText: { color: "transparent", fontSize: 1, letterSpacing: 0.2, height: 0 },
  nav: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.84)",
    borderColor: "rgba(255,255,255,0.48)",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 66,
    paddingHorizontal: 8,
    paddingVertical: 0,
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "rgba(23,19,31,0.10)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 8
  },
  navCompact: { height: 64, borderRadius: 22 },
  dockHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    opacity: 0.9
  },
  lens: {
    position: "absolute",
    top: 6,
    left: 8,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderColor: "rgba(255,255,255,0.82)",
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 1,
    shadowColor: "rgba(23,19,31,0.12)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6
  },
  lensDragging: { opacity: 0.98 },
  lensAccent: {
    position: "absolute",
    left: "50%",
    bottom: 4,
    width: 18,
    height: 2,
    borderRadius: 999,
    backgroundColor: color.ink,
    marginLeft: -9,
    opacity: 0.9
  },
  navItem: { alignItems: "center", flex: 1, gap: 4, justifyContent: "center", height: "100%", backgroundColor: "transparent", zIndex: 2 },
  navIcon: { alignItems: "center", height: 26, justifyContent: "center", width: 26 },
  navBadgeDot: { position: "absolute", top: -1, right: -2, width: 7, height: 7, borderRadius: 999, backgroundColor: color.ink, borderColor: "rgba(255,255,255,0.95)", borderWidth: 1.5 },
  navLabel: { color: "#8d8d92", fontSize: 11, fontWeight: "600", lineHeight: 11, letterSpacing: 0.1, textAlign: "center", width: "100%" },
  navLabelActive: { color: "#111111", fontWeight: "700" },

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

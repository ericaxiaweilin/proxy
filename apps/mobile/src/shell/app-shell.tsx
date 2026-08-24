// App Shell：RootNav 五标签 首页 / 市场 / 动态 / 消息 / 我的。
// R4 (2026-08-24)：Market = 机会 / 活动；移除体验上架，机会单向由客户发布、小美报名。
// EXPERIENCE 仅作历史路由别名，新 UI 不展示体验货架。
// Active Context（REQUESTER | BUSINESS）只是 Product State，切换不新增路由；
// 视觉基线：Proxy_Market_Xiaomei_Value_Negotiation_R4.html 布局 + R3 紫粉 token 保留。
import { useCallback, useEffect, useState } from "react";
import { AppState, Image, Platform, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
import { type LocalNetClient } from "../localnet-client";
import { type MediaClient } from "../media-client";
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [homeAssistant, setHomeAssistant] = useState<{ text: string; mode?: HomeIntentMode; attachment?: HomeAttachment }>();
  const [voucherOpen, setVoucherOpen] = useState(false);

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

  return (
    <>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={[styles.root, width >= 768 && styles.rootWide]}>
        <StatusBar animated={false} backgroundColor={color.offWhite} barStyle="dark-content" translucent={false} />
        <Header compact={compactWidth} />
        {/* 首页的本地范围说明属于 root Chrome；“我的”根页由 Me Surface 自己渲染，避免泄漏到其详情页。 */}
        {tab === "HOME" || tab === "MESSAGES" ? <LocationContext /> : null}
        <View style={styles.body}>
        {tab === "HOME" ? (
          homeAssistant ? (
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
            />
          )
        ) : tab === "MARKET" ? (
          openExperience ? (
            <MarketExperienceSurface experienceId={openExperience} onBack={() => setOpenExperience(undefined)} />
          ) : (
            <MarketSurface
              activities={activities}
              marketplace={marketplace}
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
            <FeedSurface engagement={engagement} localNet={localNet} marketplace={marketplace} onOpenChat={setFeedChatAuthor} onOpenFeedPrefs={() => setFeedPrefsOpen(true)} refreshTrigger={feedRefreshTrigger} />
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
        ) : (
          voucherOpen ? (
            <VoucherSurface client={vouchers} context={context} onBack={() => setVoucherOpen(false)} />
          ) : (
            <MeSurface
              context={context}
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
              onSignOut={onSignOut}
            />
          )
        )}
        </View>
        <RootNav activeTab={tab} compact={compactWidth} onSelect={selectTab} />
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

// 基线 .bottom：悬浮白胶囊（圆角 16 + 边框 + 阴影），激活项 magenta 文字 + #FFF0F6 底。
function RootNav({
  activeTab,
  compact,
  onSelect
}: {
  activeTab: RootTab;
  compact: boolean;
  onSelect: (tab: RootTab) => void;
}): React.JSX.Element {
  return (
    <View style={[styles.nav, compact && styles.navCompact]}>
      {rootTabs().map((entry) => {
        const active = activeTab === entry.id;
        return (
          <Pressable
            key={entry.id}
            onPress={() => onSelect(entry.id)}
            style={[styles.navItem, active && styles.navItemActive]}
          >
            <View style={styles.navIcon}>
              <ProxyIcon color={active ? color.magenta : "#83798B"} name={entry.icon} size={24} />
              {entry.badge ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{entry.badge}</Text></View> : null}
            </View>
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{entry.label}</Text>
          </Pressable>
        );
      })}
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
  nav: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    height: 62,
    marginHorizontal: 15,
    marginVertical: 8,
    padding: 4,
    ...shadows.nav
  },
  navCompact: { height: 58, marginHorizontal: 10 },
  navItem: { alignItems: "center", borderRadius: 11, flex: 1, gap: 1, justifyContent: "center" },
  navItemActive: { backgroundColor: color.bottomActiveBg },
  navIcon: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  navBadge: { alignItems: "center", backgroundColor: color.magenta, borderColor: color.white, borderRadius: 8, borderWidth: 1.5, height: 16, justifyContent: "center", minWidth: 16, paddingHorizontal: 3, position: "absolute", right: -12, top: -7 },
  navBadgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  navLabel: { color: "#83798B", fontSize: 11, fontWeight: "700", lineHeight: 14 },
  navLabelActive: { color: color.magenta }
});

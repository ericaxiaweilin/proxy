// Market Surface — R4 (2026-08-24): 订单 / 活动 双 Tab。
// R4 决策：移除“体验上架”以保护小美身价；订单由客户单向发布，小美报名/报价。
// 视觉：沿用项目 R3 token（magenta/violet/ink/muted/line/surface），仅复用 R4 的卡片结构与价格可见性，
// 不引入原型暖黄 #F3A61D 作为主色，保持 Proxy 紫粉基线。
// R15.x: MAP 视图换成 react-native-maps 真地图 + expo-location GPS。
//   - 初始 region = 当前 user location（未授权时用机会 centroid）
//   - pin 位置 = MarketOpportunity.coord (grid) → gridToLatLng 转真实经纬度
//   - “热门地点” = MARKER 显式声明的探索点 (VENDOR_SPOT) — 重要但仅是探索，不会被默认高亮
//   - “快速真实地址” = showUserLocation 蓝点 + “用我当前位置”按钮
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import * as Location from "expo-location";
import { useModuleBackHandler } from "../components/module-back";
import { useScrollChrome } from "../shell/scroll-chrome";
import type { Activity, OpportunityTemplate, ListOpportunityTemplatesPayload, ActivityPresetInfo } from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import { describeJoinError } from "../activity-client";
import { type FulfillmentClient } from "../fulfillment-client";
import { type ProfileClient, type ProfileWire } from "../profile-client";
import { type MarketplaceClient, type MarketApplication } from "../marketplace-client";
import { nearestCityLabel } from "../market-city-label";
import { type MediaClient } from "../media-client";
import { type SupplyClient, type SupplierCandidate } from "../supply-client";
import { useMerchantIdentity } from "../use-merchant-identity";
import {  OPPORTUNITY_LENS_LABEL,
  buildSlotOfferInput,
  composePriceRange,
  validateOpportunityPriceRange,
  type MarketOpportunity,
  type MarketTab,
  type OpportunityLens
} from "../market-fixtures";
import { gridToLatLng } from "../components/location-options";
import { ProxyIcon } from "../components/proxy-icon";
import { ProxyTabs } from "../components/proxy-foundation";
import { PaginatedModuleShell, tabsToPagerPages } from "../architecture/paginated-module";
import { color, shadows } from "../theme";
import { R37OpportunityCard, TYPE_LABEL, type OpportunityType, inferOpportunityTypeForFilter } from "./r37-opportunity-card";
// R37-DETAIL-001: 订单详情头部用 R37.4 批准的类型 logo，跟卡片同一套视觉。
import { MarketTypeLogo } from "../components/market-type-logo";
import { R37TypePalette } from "./r37-type-palette";
import { ActivityDetail, ActivityFeedCard } from "./tasks";
import { DemandWizard } from "./demand-wizard";
import { ActivityWizard } from "./activity-wizard";
import { resolveAuthorDisplayName } from "../feed-author";
// COMP-REPORT-002: 机会 / 定向邀约的举报入口。
import { ReportSheet } from "../components/report-sheet";
import { opportunityReportTarget, type ModerationClient, type ReportTarget } from "../moderation-client";

// “热门探索点” = 可以是河内市中心的著名地点 (西湖、还剑湖)，
// 不过是真实经纬度，作为"探索"显示的独立 marker (PURPLE_HOT)。
// 这些不是“用户附近”，是“运营推广点”。如果 server 返回了
// 真实推荐点，该结构被覆盖。
const EXPLORER_SPOTS: ReadonlyArray<{ id: string; name: string; lat: number; lng: number; tag: "HOT" | "EXPLORE" }> = [
  { id: "spot_westlake", name: "西湖", lat: 21.057, lng: 105.821, tag: "HOT" },
  { id: "spot_hoankiem", name: "还剑湖", lat: 21.0285, lng: 105.8524, tag: "EXPLORE" },
  { id: "spot_oldquarter", name: "老城区", lat: 21.034, lng: 105.847, tag: "EXPLORE" }
];

export type MarketViewMode = "LIST" | "MAP";
type OpportunityStatusFilter = "ALL" | "APPLIED" | "CREATED" | "EXECUTING";

const OPPORTUNITY_STATUS_FILTERS: ReadonlyArray<{ id: OpportunityStatusFilter; label: string; icon: "storeLines" | "check" | "plus" | "clock" }> = [
  { id: "ALL", label: "全部", icon: "storeLines" },
  { id: "APPLIED", label: "已申请", icon: "check" },
  { id: "CREATED", label: "已创建", icon: "plus" },
  { id: "EXECUTING", label: "执行中", icon: "clock" }
];

type ActivityFilter = "RECOMMENDED" | "CAFE" | "RESTAURANT" | "MINE";

const ACTIVITY_FILTERS: ReadonlyArray<{ id: ActivityFilter; label: string }> = [
  { id: "RECOMMENDED", label: "趋势" },
  { id: "CAFE", label: "附近" },
  { id: "RESTAURANT", label: "本周" },
  { id: "MINE", label: "我的活动" }
];

// scenarioIconForOpportunity was removed with R4OpportunityCard.
// Type-driven icons now live in r37-opportunity-card.tsx using
// approved order-type logo PNGs (assets/order-type-logos/*.png).

// OPPORTUNITY_COORDS removed: pin locations now derive from
// MarketOpportunity.coord via gridToLatLng (see MarketMap).

function normalizeTab(tab: MarketTab): "OPPORTUNITY" | "ACTIVITY" {
  if (tab === "ACTIVITY") return "ACTIVITY";
  return "OPPORTUNITY";
}

export function MarketSurface({
  activities,
  marketplace,
  fulfillment,
  media,
  supply,
  marketLabel,
  moderation,
  profileClient,
  initialTab = "OPPORTUNITY",
  onOpenExperience,
  onOpenRealityScene,
  onChromeVisibilityChange,
  bottomNavVisible
}: {
  activities: ActivityClient;
  marketplace: MarketplaceClient;
  fulfillment?: FulfillmentClient;
  media?: MediaClient;
  supply?: SupplyClient;
  moderation: ModerationClient;
  // APPLICANT-PROFILE-001: 选人工作台把报名人 applicantId 解析成真人名字。
  // 缺省 = 没接线：退回截断 ID（原来唯一的样子），不编名字。
  profileClient?: ProfileClient | undefined;
  marketLabel: string;
  initialTab?: MarketTab;
  onOpenExperience?: ((experienceId: string) => void) | undefined;
  onOpenRealityScene?: ((sceneId: string) => void) | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
}): React.JSX.Element {
  const normalized = normalizeTab(initialTab);
  const [tab, setTab] = useState<"OPPORTUNITY" | "ACTIVITY">(normalized);
  const [pagerPage, setPagerPage] = useState<number | undefined>(undefined);
  const [view, setView] = useState<MarketViewMode>("LIST");
  const [lens, setLens] = useState<OpportunityLens>("NOW");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("RECOMMENDED");
  const [search, setSearch] = useState("");
  const [activityPhase, setActivityPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [activityItems, setActivityItems] = useState<Activity[]>([]);
  const [opportunityPhase, setOpportunityPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [opportunityItems, setOpportunityItems] = useState<MarketOpportunity[]>([]);
  const [opportunityError, setOpportunityError] = useState<string>();
  // R15.x: a foreground-location fix shared between the LIST
  // and MAP views. The map's "用我的位置" button sets it; the
  // LIST view's NEARBY/RECOMMEND sort uses it to ask the server
  // to recompute Travel via haversine. We never persist this
  // across app launches — foreground GPS only.
  const [userFix, setUserFix] = useState<{ lat: number; lng: number } | undefined>(undefined);
  // R15.x (P1 market 附近): when the viewer has shared a fix,
  // surface a real-world city label rather than the editor's
  // hard-coded "河内". Falls back to the prop (which is also
  // "河内" by default) until then. The label is used in the
  // header sub-line and the pin tooltip; it is *not* a privacy
  // surface — we only show the city name, never the exact fix.
  const effectiveMarketLabel = useMemo(() => {
    if (!userFix) return marketLabel;
    return nearestCityLabel(userFix.lat, userFix.lng, marketLabel);
  }, [userFix, marketLabel]);
  // M4: 真实供给匹配（QuerySuppliers）— 按市场/能力过滤，展示给“适合你”筛选
  const [supplierMatches, setSupplierMatches] = useState<unknown[] | undefined>(undefined);
  const [supplierError, setSupplierError] = useState<string | undefined>(undefined);
  const [activityDetail, setActivityDetail] = useState<Activity | null>(null);
  const [interestedIn, setInterestedIn] = useState<ReadonlySet<string>>(new Set());
  const [joinedIds, setJoinedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [activityNotice, setActivityNotice] = useState<string | undefined>(undefined);
  const [oppDetail, setOppDetail] = useState<MarketOpportunity | null>(null);
  const [oppQuoteMode, setOppQuoteMode] = useState<"budget" | "standard" | "premium" | "custom">("standard");
  const [activityPublishOpen, setActivityPublishOpen] = useState(false);
  // R58 一期：发布需求向导（Moment 模板 → 规格确认 → 成功）。
  const [demandWizardOpen, setDemandWizardOpen] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [selectOpp, setSelectOpp] = useState<MarketOpportunity | null>(null);

  // 规范 §4/§13：Android 硬件返回按真实嵌套深度逐层收起，最上层先消费；
  // 全部收起后返回 false 交给 shell 关模块。
  useModuleBackHandler(selectOpp ? () => { setSelectOpp(null); return true; } : undefined);
  useModuleBackHandler(publishMenuOpen ? () => { setPublishMenuOpen(false); return true; } : undefined);
  useModuleBackHandler(activityPublishOpen ? () => { setActivityPublishOpen(false); return true; } : undefined);
  useModuleBackHandler(demandWizardOpen ? () => { setDemandWizardOpen(false); return true; } : undefined);
  useModuleBackHandler(activityDetail ? () => { setActivityDetail(null); return true; } : undefined);
  useModuleBackHandler(oppDetail ? () => { setOppDetail(null); return true; } : undefined);
  // SCROLL-CHROME-001: shared controller (see shell/scroll-chrome.ts).
  // 底部防回弹保留为 canHide 否决：隐藏底栏会把内容区 paddingBottom 从 120 切到 16，
  // 内容总高度瞬间 -104；若此时已在底部，offset 会被钳制回弹，回弹的上位移又会触发
  // 恢复，形成来回弹。距底部不足一个隐藏高度时直接保持可见（Safari 到底保留工具栏
  // 同款行为）。现在控制器另外还会忽略状态切换后那一瞬的布局回弹事件。
  const onMarketScroll = useScrollChrome(onChromeVisibilityChange, {
    canHide: (e) => {
      const y = Math.max(0, e.nativeEvent.contentOffset.y);
      const viewportH = e.nativeEvent.layoutMeasurement.height;
      const contentH = e.nativeEvent.contentSize.height;
      return contentH - (y + viewportH) >= 140;
    }
  });

  const loadActivities = useCallback(async (): Promise<void> => {
    setActivityPhase("LOADING");
    try {
      const read = await activities.listActivities();
      setActivityItems(read);
      setActivityPhase("READY");
    } catch (e) {
      // 不要静默吞错 — surface 到 console + state, 排查
      // “活动数据空” / “schema 不接受” / “server down” 三类问题。
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[market] listActivities failed", msg);
      setActivityItems([]);
      setActivityPhase("ERROR");
    }
  }, [activities]);

  useEffect(() => {
    if (tab === "ACTIVITY") void loadActivities();
  }, [tab, loadActivities]);

  const loadOpportunities = useCallback(async (): Promise<void> => {
    setOpportunityPhase("LOADING");
    try {
      // R15.x (P1 market 附近): Map view 的 "用我当前位置" 拿到
      // foreground-location fix 后, setUserFix 会被调用. 这里读
      // userFix 传 marketplace.list(), server (service.go haversine
      // path) 用它重算 Travel minutes + 标 travelSource="user_
      // distance". 不传时 server 走 seeded Travel + "seeded".
      // userFix 在 useEffect 依赖里 — 授权后列表会自动重排。
      setOpportunityItems(await marketplace.list(userFix));
      setOpportunityError(undefined);
      setOpportunityPhase("READY");
    } catch {
      setOpportunityItems([]);
      setOpportunityError("订单服务暂时不可用，请检查连接后重试。");
      setOpportunityPhase("ERROR");
    }
  }, [marketplace, userFix]);

  useEffect(() => {
    if (tab === "OPPORTUNITY") void loadOpportunities();
  }, [tab, loadOpportunities]);

  // M4: 机会页拉取真实供给（QuerySuppliers market=hn capability=ZH），用于“供给匹配”状态行
  useEffect(() => {
    if (!supply || tab !== "OPPORTUNITY") {
      setSupplierMatches(undefined);
      setSupplierError(undefined);
      return;
    }
    let cancelled = false;
    // 轻量拉取，不阻塞机会列表
    supply.querySuppliers({ marketId: "hn", capability: "ZH", limit: 6 })
      .then((list) => { if (!cancelled) { setSupplierMatches(list); setSupplierError(undefined); } })
      .catch((e) => { if (!cancelled) setSupplierError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [supply, tab]);

  async function dismissOpportunity(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await marketplace.dismiss(id);
      setOpportunityItems((items) => items.filter((item) => item.id !== id));
      setOpportunityError(undefined);
    } catch {
      setOpportunityError("未能保存“不感兴趣”，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function applyToOpportunity(opportunity: MarketOpportunity, quote: string): Promise<void> {
    if (busy || opportunity.appliedByViewer) return;
    setBusy(true);
    try {
      await marketplace.apply(opportunity.id, quote, opportunity.skills);
      const applied = { ...opportunity, appliedByViewer: true, responses: opportunity.responses + 1 };
      setOpportunityItems((items) => items.map((item) => item.id === applied.id ? applied : item));
      setOppDetail(applied);
      setOpportunityError(undefined);
    } catch {
      setOpportunityError("回应没有提交成功，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmOpportunity(opportunity: MarketOpportunity): Promise<void> {
    if (busy || !opportunity.viewerApplicationId) return;
    setBusy(true);
    try {
      const confirmed = await marketplace.confirmApplication(opportunity.viewerApplicationId);
      const next = { ...opportunity, viewerApplicationStatus: "CONFIRMED" as const, viewerOrderRef: confirmed.orderRef };
      setOpportunityItems((items) => items.map((item) => item.id === next.id ? next : item));
      setOppDetail(next);
      setOpportunityError(undefined);
    } catch { setOpportunityError("合作确认没有保存成功，请重试。"); }
    finally { setBusy(false); }
  }

  // 快速 Offer 改走选人工作台：目标必须是报名名单里的真实 applicantId，
  // 金额发布者现填。写死 agent_linh 的演示位已删除，没有报名人不发 Offer。
  function openOfferWorkbench(opportunity: MarketOpportunity): void {
    setOppDetail(null);
    setSelectOpp(opportunity);
  }

  function upsertActivity(next: Activity): void {
    setActivityItems((current) => current.map((entry) => (entry.activityId === next.activityId ? next : entry)));
  }

  async function toggleInterest(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActivityNotice(undefined);
    try {
      const { activity, interested } = await activities.toggleInterest(activityId);
      upsertActivity(activity);
      const next = new Set(interestedIn);
      if (interested) next.add(activityId);
      else next.delete(activityId);
      setInterestedIn(next);
    } catch {
      setActivityNotice("操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function joinActivity(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActivityNotice(undefined);
    try {
      const { activity } = await activities.join(activityId);
      upsertActivity(activity);
      const next = new Set(joinedIds);
      next.add(activityId);
      setJoinedIds(next);
    } catch (e) {
      setActivityNotice(describeJoinError(e));
    } finally {
      setBusy(false);
    }
  }

  const visibleActivities = activityItems.filter((item) => {
    if (activityFilter === "CAFE") {
      if (item.venueType !== "CAFE") return false;
    } else if (activityFilter === "RESTAURANT") {
      if (item.venueType !== "RESTAURANT") return false;
    } else if (activityFilter === "MINE") {
      if (!(joinedIds.has(item.activityId) || interestedIn.has(item.activityId))) return false;
    }
    const q = search.trim().toLowerCase();
    if (q && !`${item.title}${item.venueName}${item.time}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const remoteLens = lens === "REMOTE";

  function openDemandWizard(): void {
    setPublishMenuOpen(false);
    setActivityPublishOpen(false);
    setDemandWizardOpen(true);
    setTab("OPPORTUNITY");
    setPagerPage(0);
  }

  function openActivityPublisher(): void {
    setPublishMenuOpen(false);
    setDemandWizardOpen(false);
    setActivityPublishOpen(true);
    setTab("ACTIVITY");
    setPagerPage(1);
    void loadActivities();
  }

  function renderMarketPage(pageTab: "OPPORTUNITY" | "ACTIVITY"): React.JSX.Element {
    const bottomPad = bottomNavVisible === false ? 16 : 120;
    return (
    <View style={styles.marketPage}>
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, pageTab === "OPPORTUNITY" ? styles.contentFlat : null, { paddingBottom: bottomPad }]} onScroll={onMarketScroll} scrollEventThrottle={16}>
      <View style={styles.marketHead}>
        <Text style={styles.marketTitle}>市场</Text>
        <View style={styles.headActions}>
          <Pressable onPress={() => setView(view === "MAP" ? "LIST" : "MAP")} style={[styles.viewToggle, view === "MAP" && styles.viewToggleOn]}>
            <ProxyIcon color={view === "MAP" ? color.white : color.ink} name={view === "MAP" ? "storeLines" : "route"} size={18} />
          </Pressable>
          <Pressable onPress={() => setPublishMenuOpen(true)} style={styles.plusBtn}>
            <ProxyIcon color={color.white} name="plus" size={18} />
          </Pressable>
        </View>
      </View>

      <ProxyTabs
        activeId={pageTab}
        items={[{ id: "OPPORTUNITY", label: "订单" }, { id: "ACTIVITY", label: "活动" }]}
        onChange={(id) => {
          setTab(id);
          setPagerPage(id === "ACTIVITY" ? 1 : 0);
          setActivityDetail(null);
          setOppDetail(null);
        }}
        style={styles.foundationTabs}
      />

      {supply ? (
        <Text style={styles.offerMsg}>
          {supplierMatches === undefined ? "供给匹配中…（hn·ZH）" : supplierError ? `供给查询失败：${supplierError}` : `供给匹配 ${supplierMatches.length} 人（hn·ZH 已核验）`}
        </Text>
      ) : null}
      {demandWizardOpen && pageTab === "OPPORTUNITY" ? (
        <DemandWizard
          marketplace={marketplace}
          supply={supply}
          onBack={() => setDemandWizardOpen(false)}
          onPublished={(opportunity) => {
            setOpportunityItems((items) => [opportunity, ...items]);
          }}
          onViewMarket={() => setDemandWizardOpen(false)}
          onCreateActivity={() => { setDemandWizardOpen(false); openActivityPublisher(); }}
        />
      ) : activityPublishOpen && pageTab === "ACTIVITY" ? (
        <ActivityWizard
          activities={activities}
          scenes={activityItems}          onBack={() => setActivityPublishOpen(false)}
          onOpenDemand={() => { setActivityPublishOpen(false); openDemandWizard(); }}
          onReloadScenes={() => void loadActivities()}
          onPublished={(activity) => {
            setActivityItems((items) => [activity, ...items]);
            setActivityPublishOpen(false);
            setTab("ACTIVITY");
            setPagerPage(1);
          }}
          onViewActivities={() => {
            setActivityPublishOpen(false);
            setTab("ACTIVITY");
            setPagerPage(1);          }}
        />
      ) : selectOpp ? (
        <SelectWorkbench marketplace={marketplace} fulfillment={fulfillment} profileClient={profileClient} opportunity={selectOpp} onBack={() => setSelectOpp(null)} />
      ) : view === "MAP" ? (
        <MarketMap
          tab={pageTab}
          opportunities={opportunityItems}
          lens={lens}
          remoteLens={remoteLens}
          marketLabel={effectiveMarketLabel}
          onOpenExperience={onOpenExperience}
          onOpenOpportunity={(id) => {
            const found = opportunityItems.find((x) => x.id === id);
            if (found) setOppDetail(found);
          }}
          onUserFix={setUserFix}
        />
      ) : pageTab === "OPPORTUNITY" ? (
        oppDetail ? (
          <OpportunityDetail
            key={oppDetail.id}
            opportunity={oppDetail}
            moderation={moderation}
            quoteMode={oppQuoteMode}
            setQuoteMode={setOppQuoteMode}
            onBack={() => setOppDetail(null)}
            busy={busy}
            onApply={(quote) => void applyToOpportunity(oppDetail, quote)}
            onConfirm={() => void confirmOpportunity(oppDetail)}
            onOpenSelect={() => {
              const cur = oppDetail;
              setOppDetail(null);
              if (cur) setSelectOpp(cur);
            }}
          />
        ) : (
          <>
            {opportunityError ? <Text style={styles.marketError}>{opportunityError}</Text> : null}
            {opportunityPhase === "LOADING" ? <ActivityIndicator color={color.magenta} style={{ marginVertical: 8 }} /> : null}
            <OpportunityTab items={opportunityItems} marketLabel={effectiveMarketLabel} onOpen={(o) => setOppDetail(o)} onDismiss={(id) => void dismissOpportunity(id)} />
          </>
        )
      ) : (
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <TextInput onChangeText={setSearch} placeholder="搜活动、地点、主题…" placeholderTextColor="#A9A2B0" style={styles.searchInput} value={search} />
              <Text style={styles.searchIcon}>⌕</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.lensRow} style={styles.lensScroll}>
            {ACTIVITY_FILTERS.map((entry) => (
              <Pressable key={entry.id} onPress={() => setActivityFilter(entry.id)} style={[styles.lens, activityFilter === entry.id && styles.lensOn]}>
                <Text style={[styles.lensText, activityFilter === entry.id && styles.lensTextOn]}>{entry.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>趋势活动</Text>
            <Text style={styles.sectionHint}>多人 / 兴趣 / 品牌场景</Text>
          </View>
          {activityPhase === "LOADING" && activityItems.length === 0 ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator color={color.magenta} />
              <Text style={styles.emptyText}>正在读取活动读模型（ListActivities）…</Text>
            </View>
          ) : activityPhase === "ERROR" ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>活动读模型暂时不可用（本地 API 未连接？）。</Text>
              <Pressable onPress={() => void loadActivities()} style={styles.retryBtn}>
                <Text style={styles.retryText}>重试</Text>
              </Pressable>
            </View>
          ) : visibleActivities.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{activityFilter === "MINE" ? "还没有参加或感兴趣的活动。" : "附近暂时没有符合的活动。"}</Text>
            </View>
          ) : activityDetail ? (
            <ActivityDetail
              item={activityDetail}
              interested={interestedIn.has(activityDetail.activityId)}
              joined={joinedIds.has(activityDetail.activityId)}
              busy={busy}
              onToggleInterested={() => void toggleInterest(activityDetail.activityId)}
              onJoin={() => void joinActivity(activityDetail.activityId)}
              onOpenRealityScene={onOpenRealityScene}
              onBack={() => { setActivityNotice(undefined); setActivityDetail(null); }}
              notice={activityNotice}
            />
          ) : (
            visibleActivities.map((item) => (
              <View key={item.activityId}>
                <ActivityFeedCard item={item} onPress={() => setActivityDetail(item)} />
                <View style={styles.hostFlag}>
                  <Text style={styles.hostFlagText}>Host / Creator 可参与</Text>
                </View>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
    {!activityPublishOpen && !demandWizardOpen && !selectOpp && !oppDetail && !activityDetail ? <Pressable accessibilityLabel="创建订单或活动" onPress={() => setPublishMenuOpen(true)} style={[styles.floatingPublish, { bottom: bottomNavVisible === false ? 28 : 116 }]}>
      <ProxyIcon color={color.white} name="plus" size={24} />
    </Pressable> : null}
    </View>
    );
  }

  const pagerPages = tabsToPagerPages({
    tabs: ["OPPORTUNITY", "ACTIVITY"] as const,
    activeTab: tab,
    renderPage: renderMarketPage,
    titleOf: (item) => item === "OPPORTUNITY" ? "订单" : "活动",
  });

  return (<>
    <PaginatedModuleShell
      definition={{ id: "market", pages: pagerPages, initialPage: normalized === "ACTIVITY" ? 1 : 0 }}
      page={pagerPage}
      onPageChange={(index) => {
        setTab(index === 1 ? "ACTIVITY" : "OPPORTUNITY");
        setPagerPage(undefined);
        setActivityDetail(null);
        setOppDetail(null);
      }}
    />
    <Modal animationType="fade" onRequestClose={() => setPublishMenuOpen(false)} transparent visible={publishMenuOpen}>
      <Pressable accessibilityLabel="关闭发布选择" onPress={() => setPublishMenuOpen(false)} style={styles.publishMenuBackdrop}>
        {/* UI-PUBLISH-ENTRY-001: 面板必须用 Pressable 吞点击，不能再用
            <View onStartShouldSetResponder>。后者在触摸开始时抢走 responder，
            使面板内的「创建订单 / 创建活动」永远收不到点击，反而被外层 backdrop
            当成点击关闭——表现为「+ → 创建订单」点了只关弹层、进不去向导。 */}
        <Pressable accessibilityLabel="发布选择面板" onPress={() => undefined} testID="publish-menu-sheet-v1" style={[styles.publishMenuSheet, { marginBottom: bottomNavVisible === false ? 24 : 104 }]}>
          <View style={styles.publishMenuGrab} />
          <Text style={styles.publishMenuTitle}>创建</Text>
          <Text style={styles.publishMenuHint}>订单按 Moment 向导发布；活动用于多人共同参与。</Text>
          <View style={styles.publishMenu}>
            <Pressable accessibilityLabel="创建订单" onPress={openDemandWizard} style={styles.publishMenuPrimary}>
              <ProxyIcon color={color.white} name="plus" size={20} /><Text style={styles.publishMenuPrimaryText}>创建订单</Text>
            </Pressable>
            <Pressable accessibilityLabel="创建活动" onPress={openActivityPublisher} style={styles.publishMenuSecondary}>
              <ProxyIcon color={color.ink} name="star" size={20} /><Text style={styles.publishMenuSecondaryText}>创建活动</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  </>);
}

function OpportunityTab({
  items: sourceItems,
  marketLabel,
  onOpen,
  onDismiss
}: {
  items: MarketOpportunity[];
  marketLabel: string;
  onOpen: (o: MarketOpportunity) => void;
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  const [typeFilter, setTypeFilter] = useState<OpportunityType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<OpportunityStatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const base = sourceItems;
  let items = [...base];
  if (statusFilter === "APPLIED") items = items.filter((o) => o.appliedByViewer);
  if (statusFilter === "CREATED") items = items.filter((o) => o.ownedByViewer);
  if (statusFilter === "EXECUTING") items = items.filter((o) => o.viewerApplicationStatus === "CONFIRMED" || Boolean(o.viewerOrderRef));
  if (typeFilter !== "all") items = items.filter((o) => inferOpportunityTypeForFilter(o) === typeFilter);
  const q = query.trim().toLowerCase();
  if (q) items = items.filter((o) => `${o.title ?? ""}${o.location ?? ""}${o.id}`.toLowerCase().includes(q));
  return (
    <>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput onChangeText={setQuery} placeholder="搜订单…" placeholderTextColor="#A9A2B0" style={styles.searchInput} value={query} />
          <Text style={styles.searchIcon}>⌕</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusFilterRow}>
        {OPPORTUNITY_STATUS_FILTERS.map((entry) => {
          const active = statusFilter === entry.id;
          return <Pressable key={entry.id} onPress={() => setStatusFilter(entry.id)} style={[styles.statusFilter, active && styles.statusFilterOn]}>
            <ProxyIcon color={active ? color.white : color.ink} name={entry.icon} size={17} />
            <Text style={[styles.statusFilterText, active && styles.statusFilterTextOn]}>{entry.label}</Text>
          </Pressable>;
        })}
      </ScrollView>

      <R37TypePalette active={typeFilter} onChange={setTypeFilter} />

      <View style={styles.oppStack}>
        {items.map((opportunity) => (
          <R37OpportunityCard key={opportunity.id} opportunity={opportunity} onDismiss={() => onDismiss(opportunity.id)} onOpen={() => onOpen(opportunity)} />
        ))}
      </View>
    </>
  );
}

// R4OpportunityCard was replaced by R37OpportunityCard (see ./r37-opportunity-card.tsx).

function OpportunityDetail({
  opportunity,
  moderation,
  quoteMode,
  setQuoteMode,
  onBack,
  onOpenSelect,
  onApply,
  onConfirm,
  busy
}: {
  opportunity: MarketOpportunity;
  moderation: ModerationClient;
  quoteMode: "budget" | "standard" | "premium" | "custom";
  setQuoteMode: (m: "budget" | "standard" | "premium" | "custom") => void;
  onBack: () => void;
  onOpenSelect: () => void;
  onApply: (quote: string) => void;
  onConfirm: () => void;
  busy: boolean;
}): React.JSX.Element {
  const budget = opportunity.price;
  const fair = `${Math.round(parseInt(budget.replace(/\D/g, "")) * 0.95).toLocaleString()} – ${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.35).toLocaleString()}₫`;
  // R37-DETAIL-001: 跟卡片用同一个推断函数 + 同一张文案表 —— 卡片显示
  // 「咖啡 + 拍照」、点进来变成 OPPORTUNITY 这种断裂就是这么来的。
  const detailType = inferOpportunityTypeForFilter(opportunity);
  const detailTypeLabel = TYPE_LABEL[detailType];
  // 自定义报价：输入框的数字才是依据；为空/非数字时不许提交，
  // 也不再静默回退到客户预算（之前选自定义照样按预算发出）。
  const [customQuote, setCustomQuote] = useState("");
  const [quoteError, setQuoteError] = useState<string | undefined>(undefined);
  // COMP-REPORT-002: 机会 / 邀约举报。targetId 用服务端 opportunity.id，
  // 不用界面上那个 PX-O 展示编号（客户端随机的，服务端查不到）。
  const [reporting, setReporting] = useState<ReportTarget | undefined>(undefined);
  const [reportDone, setReportDone] = useState<string | undefined>(undefined);
  const reportTarget = opportunityReportTarget(opportunity);
  const customDigits = customQuote.replace(/[^0-9]/g, "");
  const customValid = customDigits.length > 0;
  const quote = quoteMode === "custom"
    ? (customValid ? `${Number(customDigits).toLocaleString()}₫` : "")
    : quoteMode === "premium"
      ? `${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.25).toLocaleString()}₫`
      : quoteMode === "standard" ? (fair.split("–")[0]?.trim() ?? budget) : budget;
  return (
    <View style={styles.oppDetailRoot}>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>订单详情</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>

      <View style={styles.detailHero}>
        <View style={styles.detailHeroTypeRow}>
          <MarketTypeLogo type={detailType} size="FILTER" />
          <View style={styles.detailHeroTypeMeta}>
            <Text style={styles.detailHeroKicker}>标准订单类型</Text>
            <Text style={styles.detailHeroTypeTitle}>{detailTypeLabel.label}</Text>
          </View>
        </View>
        <Text style={styles.detailHeroTitle}>{opportunity.title}</Text>
        <Text style={styles.detailHeroSub}>先回答：值不值得接、条件是否公平、你能不能按自己的条件做。</Text>
      </View>

      <View style={styles.r4PriceStrip}>
        <View style={styles.r4PriceCell}>
          <Text style={styles.r4PriceLabel}>{opportunity.priceLabel ?? "完成后你可获得"}</Text>
          <Text style={styles.r4PriceValue}>{budget || "费用待确认"}</Text>
        </View>
        {opportunity.moneyFlow !== "TBD" && opportunity.moneyFlow !== "FREE" ? (
          <View style={[styles.r4PriceCell, styles.r4PriceCellHot]}>
            <Text style={styles.r4PriceLabel}>Proxy 建议区间</Text>
            <Text style={styles.r4PriceValue}>{fair}</Text>
          </View>
        ) : null}
        <View style={styles.r4PriceCell}>
          <Text style={styles.r4PriceLabel}>{opportunity.moneyFlow === "TBD" ? "双方面谈" : opportunity.moneyFlow === "FREE" ? "同好/社区" : "你的历史"}</Text>
          <Text style={styles.r4PriceValue}>{opportunity.moneyFlow === "FREE" ? "0₫" : opportunity.moneyFlow === "TBD" ? "—" : `约 ${budget}`}</Text>
        </View>
      </View>

      <View style={styles.valueBox}>
        <View style={styles.valueHead}>
          <Text style={styles.valueTitle}>当前预算竞争力</Text>
          <Text style={styles.valueBadge}>中等</Text>
        </View>
        <View style={styles.valueBar}>
          <View style={[styles.valueFill, { width: "68%" }]} />
        </View>
        <Text style={styles.valueText}>客户预算处在 Proxy 公平区间内。可以直接按建议回应，不需要先接受低价。你的最低条件仅 Agent 可见，不对客户公开。</Text>
      </View>

      <View style={styles.factGrid}>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>时间</Text>
          <Text style={styles.factValue}>{opportunity.date} {opportunity.time}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>地点</Text>
          <Text style={styles.factValue}>{opportunity.location}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>发布方</Text>
          {/* PROFILE-READ-001: 服务端曾把个人机会 Owner 写死成 "你"；
              存量行经 079 回填清成空，此处对残留脏串同样中性兜底，
              永不把 "你" 展示给非作者。wire 暂无 ownerId，不做归属判定。 */}
          <Text style={styles.factValue}>{resolveAuthorDisplayName({ authorId: `market_owner:${opportunity.owner}`, authorType: opportunity.ownerType === "BUSINESS" ? "MERCHANT" : "USER", authorDisplayName: opportunity.owner })} {opportunity.verified ? "✓" : ""}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>当前回应</Text>
          <Text style={styles.factValue}>{opportunity.responses} 人</Text>
        </View>
      </View>
      {opportunity.desc ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>备注</Text>
          <Text style={styles.noteText}>{opportunity.desc}</Text>
        </View>
      ) : null}

      <View style={styles.aiBox}>
        <View style={styles.aiHead}>
          <Text style={styles.aiTitle}>Proxy · 给小美的判断</Text>
          <Text style={styles.aiStrong}>值得考虑</Text>
        </View>
        <View style={styles.aiChecks}>
          <Text style={styles.aiCheck}>✓ {opportunity.match} 匹配；你的组合满足硬条件。</Text>
          <Text style={styles.aiCheck}>₫ 按类似履约，不建议低于预算 85% 接单。</Text>
          <Text style={styles.aiCheck}>↗ 通勤约 {opportunity.travel ?? 20} 分钟，平台托管付款。</Text>
        </View>
      </View>

      <View style={styles.quoteGrid}>
        {(
          [
            ["budget", budget, "客户预算 · 成交更快"],
            ["standard", fair.split("–")[0] ?? budget, "Proxy 建议 · 保持价值"],
            ["premium", `${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.25).toLocaleString()}₫`, "含更完整交付"],
            ["custom", "自定义", "自己决定金额与范围"]
          ] as const
        ).map(([id, label, sub]) => (
          <Pressable key={id} onPress={() => setQuoteMode(id)} style={[styles.quoteOption, quoteMode === id && styles.quoteOptionOn]}>
            <Text style={styles.quotePrice}>{label}</Text>
            <Text style={styles.quoteSub}>{sub}</Text>
          </Pressable>
        ))}
      </View>

      {quoteMode === "custom" ? (
        <View>
          <TextInput keyboardType="number-pad" onChangeText={(v) => { setCustomQuote(v); setQuoteError(undefined); }} placeholder="输入你的报价金额（₫）" placeholderTextColor="#A9A2B0" style={styles.publishPriceInput} value={customQuote} />
          {quoteError ? <Text style={styles.marketError}>{quoteError}</Text> : null}
        </View>
      ) : null}

      <View style={styles.r4Actions}>
        <Pressable onPress={onBack} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>返回</Text>
        </Pressable>
        <Pressable
          disabled={busy || opportunity.appliedByViewer || opportunity.ownedByViewer}
          onPress={() => {
            if (quoteMode === "custom" && !customValid) {
              setQuoteError("请先填写自定义报价金额。");
              return;
            }
            setQuoteError(undefined);
            onApply(quote);
          }}
          style={styles.r4ActionPrimary}
        >
          <Text style={styles.r4ActionPrimaryText}>{opportunity.appliedByViewer ? "已回应" : opportunity.ownedByViewer ? "这是你发布的订单" : busy ? "提交中…" : quoteMode === "custom" && customValid ? `以 ${quote} 回应` : "按我的条件回应"}</Text>
        </Pressable>
      </View>
      {opportunity.ownedByViewer ? (
        <Pressable onPress={onOpenSelect} style={[styles.r4ActionGhost, { marginTop: 7 }]}>
          <Text style={styles.r4ActionGhostText}>查看客户选人视角 ›</Text>
        </Pressable>
      ) : null}

      {opportunity.viewerApplicationStatus === "SELECTED" ? (
        <View style={[styles.aiBox, { marginTop: 8 }]}>
          <Text style={styles.aiTitle}>发布者已选择你的申请</Text>
          <Text style={styles.aiCheck}>再次核对本次报价与范围后，由你本人确认合作；AI 助理不能代确认。</Text>
          <Pressable disabled={busy} onPress={onConfirm} style={[styles.r4ActionPrimary, { marginTop: 8 }]}>
            <Text style={styles.r4ActionPrimaryText}>{busy ? "确认中…" : "本人确认合作"}</Text>
          </Pressable>
        </View>
      ) : opportunity.viewerApplicationStatus === "CONFIRMED" ? (
        <Text style={styles.detailHint}>双方已确认合作 · {opportunity.viewerOrderRef}</Text>
      ) : opportunity.viewerApplicationStatus === "NOT_SELECTED" ? (
        <Text style={styles.detailHint}>本次申请未被选择。</Text>
      ) : null}

      <Text style={styles.detailHint}>价格只属于这次需求。你的主页不会永久显示“小时价”。AI 不替客户压价，也不替你接受。</Text>

      {/* COMP-REPORT-002: 机会 / 邀约举报入口。常驻在详情页底部，不做成
          长按菜单 —— 用户读到一条可疑的邀约时，不该还要先猜哪里能举报。 */}
      <Pressable accessibilityLabel={reportTarget.label} onPress={() => { setReportDone(undefined); setReporting(reportTarget); }} style={styles.reportLink}>
        <Text style={styles.reportLinkText}>⚑ {reportTarget.label}</Text>
      </Pressable>
      {reportDone ? <Text style={styles.detailHint}>{reportDone}</Text> : null}
      {reporting ? (
        <ReportSheet
          moderation={moderation}
          targetType={reporting.targetType}
          targetId={reporting.targetId}
          title={reporting.label}
          {...(opportunity.title ? { subtitle: opportunity.title } : {})}
          onClose={() => setReporting(undefined)}
          onDone={() => { setReporting(undefined); setReportDone("举报已提交，我们会尽快处理。"); }}
        />
      ) : null}
    </View>
  );
}

// R16.x: 资金方向必须在发布 UI 上明确选 — 不能只填一个裸金额。EARN 是默认
// （接单者赚），FREE / TBD / PAY 各占一个按钮，选了哪个按钮后 Price 输入
// 框联动（FREE 可为 0， TBD 必须为空）。
type PublishMoneyFlow = "EARN" | "PAY" | "FREE" | "TBD";

// priceLabelForPublisher 是发布者 PublishDemand 页面上的语义描述。
// server 端是 PriceLabel 唯一权威（opportunityPriceLabel() 接单者视角
// “完成后你可获得 / 你需支付 / 免费 / 费用待确认”），client SDK
// 不再本地镜像那份中文。publisher 视角的文案是 UI-only，作用是让
// publisher 在 PublishDemand 看到 “你付金额，接单者完成后获得”
// 而不是接单者视角的 “完成后你可获得”。
function priceLabelForPublisher(flow: PublishMoneyFlow): string {
  switch (flow) {
    case "FREE":
      return "免费发布";
    case "PAY":
      return "你须先支付";
    case "TBD":
      return "费用待你与接单者面谈";
    default:
      return "你付金额，接单者完成后获得";
  }
}

// PUBLISH_FLOW_OPTIONS 是发布者 (requester) 看到的 chip 列表。chip
// 描述的语义是发布者视角 ("你付")，与卡片上对接单者展示的 PriceLabel
// ("完成后你可获得") 是不同视角的同一个事实。故意保留。
const PUBLISH_FLOW_OPTIONS: ReadonlyArray<{ id: PublishMoneyFlow; label: string; sub: string }> = [
  { id: "EARN", label: "你付给接单者", sub: "你付金额，接单者完成后获得" },
  { id: "PAY", label: "接单者预付", sub: "受托代购/订位等委托场景" },
  { id: "FREE", label: "免费任务", sub: "0₫ · 同好/社区" },
  { id: "TBD", label: "费用待确认", sub: "双方面谈 · 不显示金额" }
];

// FREEFORM_PRESET is the activity line's "skip the catalog" sentinel —
// same pattern as CUSTOM_TEMPLATE on the opportunity line.
const FREEFORM_PRESET: ActivityPresetInfo = {
  id: "", title: "", mark: "", theme: false, tags: [], sub: "", capacity: "", time: ""
};

// OPP-CATALOG-002 (R58 activity line): two-step creation. Step 1 =
// preset cards from the server catalog (搜索"生成"语义匹配走机会线
// 同款 Suggest 不适用 — 活动预设量小，直接渲染全量卡)；step 2 = the
// one-screen spec sheet (人数/时间/地点/主题/报名/费用) prefilled from
// the preset. Wire payload is the existing PublishActivity shape.
function PublishActivityForm({ activities, marketplace, venueOptions, onBack, onPublished }: { activities: ActivityClient; marketplace: MarketplaceClient; venueOptions: Activity[]; onBack: () => void; onPublished: (activity: Activity) => void }): React.JSX.Element {
  const venues = useMemo(() => {
    const unique = new Map<string, Activity>();
    venueOptions.forEach((item) => { if (item.realitySceneId && !unique.has(item.realitySceneId)) unique.set(item.realitySceneId, item); });
    return [...unique.values()];
  }, [venueOptions]);
  const [selectedSceneId, setSelectedSceneId] = useState(venues[0]?.realitySceneId ?? "");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [capacity, setCapacity] = useState("6");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [activityTraceId, setActivityTraceId] = useState<string>();
  // R58 成功卡：已发布的活动暂存，等用户点“查看活动”再交回父组件。
  const [createdActivity, setCreatedActivity] = useState<Activity | undefined>(undefined);
  // R58 step 1: server-catalog presets (falls back to free-form when
  // the catalog is unavailable — the legacy path stays reachable).
  const [presets, setPresets] = useState<ActivityPresetInfo[]>([]);
  const [presetPhase, setPresetPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [pickedPreset, setPickedPreset] = useState<ActivityPresetInfo>();
  const venue = venues.find((item) => item.realitySceneId === selectedSceneId);
  useEffect(() => {
    if (!selectedSceneId && venues[0]?.realitySceneId) setSelectedSceneId(venues[0].realitySceneId);
  }, [selectedSceneId, venues]);

  useEffect(() => {
    let alive = true;
    marketplace.listCatalog()
      .then((snap) => { if (alive) { setPresets(snap.activityPresets ?? []); setPresetPhase("READY"); } })
      .catch(() => { if (alive) setPresetPhase("ERROR"); });
    return () => { alive = false; };
  }, [marketplace]);

  function pickPreset(preset: ActivityPresetInfo): void {
    setPickedPreset(preset);
    setTitle(preset.title);
    setTime(preset.time);
    const seats = /^(\d+)/.exec(preset.capacity)?.[1];
    if (seats) setCapacity(seats);
  }

  async function submit(): Promise<void> {
    const seats = Number.parseInt(capacity, 10);
    if (!venue) { setError("请先选择一个真实场景"); return; }
    if (!title.trim() || !time.trim()) { setError("请填写活动名称和时间"); return; }
    if (!Number.isFinite(seats) || seats < 2 || seats > 50) { setError("人数须为 2–50 人"); return; }
    setBusy(true); setError(undefined);
    try {
      const created = await activities.publish({
        title: title.trim(), time: time.trim(), capacity: seats,
        venueName: venue.venueName, venueIcon: venue.venueIcon ?? "☕",
        venueType: venue.venueType === "RESTAURANT" ? "RESTAURANT" : "CAFE",
        realitySceneId: venue.realitySceneId ?? "", desc: desc.trim() || "一起参加活动",
        consumptionTerm: "SPLIT"
      });
      // R58 TraceID — 活动编号 PX-A：发布成功先留在表单展示成功卡，
      // “查看活动”才把控制权交回父组件（刷新列表+切tab）。
      setActivityTraceId(formatTraceId("A"));
      setCreatedActivity(created);
    } catch (e) { setError(e instanceof Error ? e.message : "活动发布失败，请重试"); }
    finally { setBusy(false); }
  }

  // R58 活动线三屏：成功卡 → 预设选卡 → 一屏规格表单。
  if (createdActivity && activityTraceId) {
    return <View style={styles.activityPublishPanel}>
      <View style={styles.publishSuccessCard}>
        <Text style={styles.publishSuccessCheck}>✓</Text>
        <Text style={styles.publishSuccessTitle}>活动已创建</Text>
        <Text style={styles.publishFlowSub}>活动已经进入市场 · 活动，其他用户可以查看并报名。</Text>
        <View style={styles.publishTraceBox}>
          <Text style={styles.publishFlowSub}>活动编号</Text>
          <Text style={styles.publishTraceId}>{activityTraceId}</Text>
        </View>
        <View style={styles.publishFlowRow}>
          <Pressable onPress={() => { setCreatedActivity(undefined); setActivityTraceId(undefined); setPickedPreset(undefined); setTitle(""); setTime(""); setDesc(""); }} style={styles.r4ActionGhost}>
            <Text style={styles.r4ActionGhostText}>再建一个</Text>
          </Pressable>
          <Pressable onPress={() => onPublished(createdActivity)} style={styles.r4ActionGhost}>
            <Text style={styles.r4ActionGhostText}>查看活动 ›</Text>
          </Pressable>
        </View>
      </View>
    </View>;
  }

  if (!pickedPreset) {
    // step 1 — preset cards from the server catalog (R58 activity1).
    return <View style={styles.activityPublishPanel}>
      <View style={styles.detailHead}><Pressable onPress={onBack}><Text style={styles.detailBackText}>‹</Text></Pressable><Text style={styles.detailTitle}>创建活动</Text></View>
      <Text style={styles.activityPublishTitle}>想组织什么？</Text>
      <Text style={styles.publishFlowSub}>活动强调多人参与；先选一个完整玩法，也可以直接自定义。</Text>
      {presetPhase === "LOADING" ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {presetPhase === "ERROR" ? <Text style={styles.marketError}>活动目录加载失败，可直接自定义填写。</Text> : null}
      {presetPhase === "READY" ? <View style={styles.publishTemplateGrid}>
        {presets.map((p) => (
          <Pressable key={p.id} onPress={() => pickPreset(p)} style={[styles.publishTemplateCard, p.theme && { borderColor: "#B79BD1", borderWidth: 1.5 }]}>
            <Text style={styles.publishTemplateMark}>{p.mark}</Text>
            <Text style={styles.publishTemplateTitle}>{p.title}</Text>
            <Text style={styles.publishTemplateSub}>{p.sub}</Text>
          </Pressable>
        ))}
      </View> : null}
      {presetPhase === "READY" ? <Pressable onPress={() => setPickedPreset(FREEFORM_PRESET)} style={[styles.r4ActionGhost, { marginTop: 12 }]}>
        <Text style={styles.r4ActionGhostText}>找不到？自定义活动 ›</Text>
      </Pressable> : null}
    </View>;
  }

  return <View style={styles.activityPublishPanel}>
    <View style={styles.detailHead}>
      <Pressable onPress={() => { if (pickedPreset.id) setPickedPreset(undefined); else onBack(); }}><Text style={styles.detailBackText}>‹</Text></Pressable>
      <Text style={styles.detailTitle}>活动设置</Text>
    </View>
    {pickedPreset.id ? (
      <View style={styles.publishTemplateSummary}>
        <Text style={styles.publishTemplateSub}>Activity</Text>
        <Text style={styles.publishTemplateSummaryTitle}>{pickedPreset.title}</Text>
        <Pressable onPress={() => setPickedPreset(undefined)} style={styles.publishTemplateChange}>
          <Text style={styles.publishTemplateChangeText}>更换活动 ›</Text>
        </Pressable>
      </View>
    ) : null}
    <Text style={styles.activityPublishTitle}>{pickedPreset.id ? "完善活动" : "发起真实活动"}</Text>
    <TextInput onChangeText={setTitle} placeholder="活动名称" placeholderTextColor="#A9A2B0" style={styles.activityPublishInput} value={title} />
    <TextInput onChangeText={setTime} placeholder="时间，例如 周六 14:00" placeholderTextColor="#A9A2B0" style={styles.activityPublishInput} value={time} />
    <TextInput keyboardType="number-pad" onChangeText={setCapacity} placeholder="人数" placeholderTextColor="#A9A2B0" style={styles.activityPublishInput} value={capacity} />
    <TextInput multiline onChangeText={setDesc} placeholder="活动说明（可选）" placeholderTextColor="#A9A2B0" style={[styles.activityPublishInput, { minHeight: 72 }]} value={desc} />
    <Text style={styles.activityPublishLabel}>选择真实场景</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusFilterRow}>
      {venues.map((item) => <Pressable key={item.realitySceneId} onPress={() => setSelectedSceneId(item.realitySceneId ?? "")} style={[styles.statusFilter, selectedSceneId === item.realitySceneId && styles.statusFilterOn]}>
        <Text style={[styles.statusFilterText, selectedSceneId === item.realitySceneId && styles.statusFilterTextOn]}>{item.venueIcon} {item.venueName}</Text>
      </Pressable>)}
    </ScrollView>
    {venues.length === 0 ? <Text style={styles.marketError}>当前没有可绑定的真实场景，请先刷新活动数据。</Text> : null}
    {error ? <Text style={styles.marketError}>{error}</Text> : null}
    <Pressable disabled={busy || venues.length === 0} onPress={() => void submit()} style={[styles.r4ActionPrimary, (busy || venues.length === 0) && styles.offerBtnDisabled]}><Text style={styles.r4ActionPrimaryText}>{busy ? "发布中…" : "确认发布活动"}</Text></Pressable>
  </View>;
}

// CUSTOM_TEMPLATE is the "skip the catalog" sentinel: it routes the
// flow straight to the free-form editor with the editor's own legacy
// defaults (no prefill). A real template card prefills title + price.
const CUSTOM_TEMPLATE: OpportunityTemplate = {
  id: "", group: "HOT", title: "", sub: "", icon: "", mark: "", tags: [],
  price: "", range: "", standard: ""
};

// K → VND conversion + suggest error hints live in
// ../market-template-price (unit-tested there).
import { templatePriceToVND, describeSuggestError, requiredProviderCount, momentPriceQuote, quoteToVND, formatTraceId } from "../market-template-price";

// OPP-CATALOG-001 (R58): step-1 picker renders the delivery-style two
// pane — a category rail (热门/见面/娱乐/出行/主题, server-owned) over
// the same 16 cards. The engine data (categories/specs/policies/pricing)
// comes from listCatalog(); when the server predates the engine the
// payload falls back to card-only and the rail degrades to the HOT /
// THEME / MORE groups (graceful, never a blank screen).
function PublishTemplatePicker({ marketplace, onBack, onPicked, onCustom }: { marketplace: MarketplaceClient; onBack: () => void; onPicked: (template: OpportunityTemplate) => void; onCustom: () => void }): React.JSX.Element {
  const [catalog, setCatalog] = useState<ListOpportunityTemplatesPayload>();
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [pickedId, setPickedId] = useState<string>();
  // OPP-SUGGEST-001: 搜索"生成" — 语义层映射到目录卡；AI 未配置或无
  // 匹配时降级提示，手选卡片不受影响。
  const [searchQuery, setSearchQuery] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string>();
  const [activeCategory, setActiveCategory] = useState<string>("hot");

  async function runSuggest(): Promise<void> {
    if (suggesting || !searchQuery.trim()) return;
    setSuggesting(true);
    setSuggestError(undefined);
    try {
      const { template } = await marketplace.suggestTemplate(searchQuery.trim());
      setPickedId(template.id);
      // jump the rail to the category that actually contains the hit
      const cat = catalog?.categories?.find((c) => c.items.includes(template.id));
      if (cat) setActiveCategory(cat.id);
    } catch (e) {
      // AI_NOT_CONFIGURED / SUGGESTION_NO_MATCH / 网络 — 都只降级提示。
      setSuggestError(e instanceof Error ? describeSuggestError(e.message) : "生成失败，请手选卡片。");
    } finally {
      setSuggesting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    marketplace.listCatalog()
      .then((snap) => { if (alive) { setCatalog(snap); setPhase("READY"); } })
      .catch(() => { if (alive) setPhase("ERROR"); });
    return () => { alive = false; };
  }, [marketplace]);

  const templates = catalog?.templates ?? [];
  const categories = catalog?.categories;
  const rail: { id: string; label: string; hint: string; items: OpportunityTemplate[] }[] =
    categories && categories.length > 0
      ? categories.map((c) => ({
          id: c.id, label: c.label, hint: c.hint,
          items: c.items.map((id) => templates.find((t) => t.id === id)).filter((t): t is OpportunityTemplate => Boolean(t))
        }))
      : [{ id: "hot", label: "热门", hint: "高频 Moment", items: templates.filter((t) => t.group === "HOT") },
         { id: "theme", label: "主题", hint: "完整组合玩法", items: templates.filter((t) => t.group === "THEME") },
         { id: "more", label: "更多", hint: "长尾场景", items: templates.filter((t) => t.group === "MORE") }];
  const active = rail.find((c) => c.id === activeCategory) ?? rail[0];
  const pickedTemplate = templates.find((t) => t.id === pickedId);
  if (!active) return <ActivityIndicator style={{ marginTop: 24 }} />; // rail is never empty: engine payload or fallback

  return <View>
    <View style={styles.detailHead}>
      <Pressable onPress={onBack} style={styles.detailBack}><Text style={styles.detailBackText}>‹</Text></Pressable>
      <Text style={styles.detailTitle}>发布需求</Text>
      <Text style={styles.detailMore}>•••</Text>
    </View>
    <View style={styles.detailHero}>
      <Text style={styles.detailHeroKicker}>CREATE DEMAND</Text>
      <Text style={styles.detailHeroTitle}>想约什么？</Text>
      <Text style={styles.detailHeroSub}>热门直接点；更特别的玩法从主题里选。</Text>
    </View>
    <View style={styles.publishSearchRow}>
      <TextInput
        onChangeText={setSearchQuery}
        placeholder="直接说：今晚想找人喝咖啡"
        placeholderTextColor="#A9A2B0"
        style={styles.publishSearchInput}
        value={searchQuery}
      />
      <Pressable disabled={suggesting || !searchQuery.trim()} onPress={() => void runSuggest()} style={[styles.publishSearchGo, (suggesting || !searchQuery.trim()) && styles.offerBtnDisabled]}>
        <Text style={styles.publishSearchGoText}>{suggesting ? "…" : "生成"}</Text>
      </Pressable>
    </View>
    {suggestError ? <Text style={styles.marketError}>{suggestError}</Text> : null}
    {phase === "LOADING" ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
    {phase === "ERROR" ? <View style={styles.r4Card}>
      <Text style={styles.marketError}>场景目录加载失败，可直接自定义发布。</Text>
      <Pressable onPress={onCustom} style={[styles.r4ActionPrimary, { marginTop: 12 }]}><Text style={styles.r4ActionPrimaryText}>自定义发布</Text></Pressable>
    </View> : null}
    {phase === "READY" ? <>
      {rail.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusFilterRow} style={{ marginTop: 10 }}>
          {rail.map((c) => (
            <Pressable key={c.id} onPress={() => setActiveCategory(c.id)} style={[styles.statusFilter, active.id === c.id && styles.statusFilterOn]}>
              <Text style={[styles.statusFilterText, active.id === c.id && styles.statusFilterTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.r4Card}>
        <Text style={styles.r4Title}>{active.label} · {active.hint}</Text>
        <View style={styles.publishTemplateGrid}>
          {active.items.map((t) => (
            <Pressable key={t.id} onPress={() => setPickedId(t.id)} style={[styles.publishTemplateCard, pickedId === t.id && styles.publishTemplateCardOn]}>
              <Text style={styles.publishTemplateMark}>{t.mark || t.title.slice(0, 1)}</Text>
              <Text style={styles.publishTemplateTitle}>{t.title}</Text>
              <Text style={styles.publishTemplateSub}>{t.sub || t.tags.slice(0, 2).join(" · ")}</Text>
              <Text style={styles.publishTemplateRange}>参考 {t.range}</Text>
            </Pressable>
          ))}
          {active.items.length === 0 ? <Text style={styles.marketError}>这个分类下暂没有场景卡。</Text> : null}
        </View>
        <Pressable onPress={onCustom} style={[styles.r4ActionGhost, { marginTop: 12 }]}><Text style={styles.r4ActionGhostText}>找不到？自定义发布 ›</Text></Pressable>
      </View>
      <View style={styles.r4Actions}>
        <Pressable onPress={onCustom} style={styles.r4ActionGhost}><Text style={styles.r4ActionGhostText}>自定义</Text></Pressable>
        <Pressable disabled={!pickedId} onPress={() => { if (pickedTemplate) onPicked(pickedTemplate); }} style={[styles.r4ActionPrimary, !pickedId && styles.offerBtnDisabled]}>
          <Text style={styles.r4ActionPrimaryText}>下一步 · 服务与价格</Text>
        </Pressable>
      </View>
    </> : null}
  </View>;
}

function PublishDemand({ marketplace, supply, onBack, onPublished }: { marketplace: MarketplaceClient; supply?: SupplyClient; onBack: () => void; onPublished: (opportunity: MarketOpportunity) => void }): React.JSX.Element {
  // OPP-TEMPLATE-001: two-step flow. Step 1 = server catalog picker
  // (HOT / THEME / MORE); step 2 = the free-form editor, prefilled from
  // the picked card. "自定义" keeps the editor's own defaults.
  const [pickedTemplate, setPickedTemplate] = useState<OpportunityTemplate>();
  // OPP-CATALOG-001 (R58): the Moment engine payload — fetched with the
  // picker, consumed in step 2 (specs / ratio policy / dynamic pricing).
  const [catalog, setCatalog] = useState<ListOpportunityTemplatesPayload>();
  // R58 spec sheet selections: chips rendered from the engine, not
  // hardcoded lists (人数/时间/时长/地点一律来自服务端目录).
  const [momentGroup, setMomentGroup] = useState<string>();
  const [momentTime, setMomentTime] = useState<string>();
  const [momentDuration, setMomentDuration] = useState<string>();
  const [momentPlace, setMomentPlace] = useState<string>();
  const [prefValues, setPrefValues] = useState<Record<string, { value: string; add: number }>>({});
  const [traceId, setTraceId] = useState<string>();
  // OPP-TARGETED-001: 定向邀约 — 选人后发布只对 TA 可见（公开市场 = 不选）。
  const [candidates, setCandidates] = useState<SupplierCandidate[]>([]);
  const [candidatesPhase, setCandidatesPhase] = useState<"HIDDEN" | "LOADING" | "READY" | "ERROR">("HIDDEN");
  const [targetAgent, setTargetAgent] = useState<SupplierCandidate>();
  const [title, setTitle] = useState("周六城市同行 + 拍照");
  const [time, setTime] = useState("10:00–18:00");
  const [location, setLocation] = useState("河内 · 西湖 / 老城区");
  // 价格区间两框：最低必填（EARN/PAY），最高可选，只填一边即单价。
  // wire 上仍走 price 自由字符串（composePriceRange 合成），server 侧
  // 校验/normalize 不用改。
  const [priceMin, setPriceMin] = useState("1,500,000₫");
  const [priceMax, setPriceMax] = useState("");
  const [moneyFlow, setMoneyFlow] = useState<PublishMoneyFlow>("EARN");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  // MERCHANT-PUBLISH-001: 有店才显示身份选择；无店/未登录保持个人发布。
  const merchant = useMerchantIdentity();

  // Fetch the catalog engine once per mount — the spec sheet in step 2
  // reads specs/policies/pricing from it (R58: 服务器目录是唯一词表源).
  useEffect(() => {
    let alive = true;
    marketplace.listCatalog()
      .then((snap) => { if (alive) setCatalog(snap); })
      .catch(() => { if (alive) { setCatalog(undefined); } });
    return () => { alive = false; };
  }, [marketplace]);

  const engineSpec = catalog?.specs?.find((s) => s.templateId === pickedTemplate?.id);
  const enginePolicy = catalog?.policies?.find((p) => p.templateId === pickedTemplate?.id);
  const enginePricing = catalog?.pricing?.find((r) => r.templateId === pickedTemplate?.id);

  // OPP-TARGETED-001: 展开选人节才拉候选（QuerySuppliers 与机会页供给
  // 匹配同源同参 hn·ZH）；收起即清空，不残留上一次的选择。
  useEffect(() => {
    if (candidatesPhase === "HIDDEN" || !supply) { setCandidates([]); setTargetAgent(undefined); return; }
    let alive = true;
    setCandidatesPhase("LOADING");
    supply.querySuppliers({ marketId: "hn", capability: "ZH", limit: 12 })
      .then((list) => { if (alive) { setCandidates(list); setCandidatesPhase("READY"); } })
      .catch(() => { if (alive) setCandidatesPhase("ERROR"); });
    return () => { alive = false; };
  }, [candidatesPhase === "HIDDEN", supply]);

  // 资金方向联动：TBD 强制清空 Price，FREE 强制填 0。
  function onPickFlow(next: PublishMoneyFlow): void {
    setMoneyFlow(next);
    if (next === "TBD") { setPriceMin(""); setPriceMax(""); }
    else if (next === "FREE") { setPriceMin("0₫"); setPriceMax(""); }
  }

  const priceRequired = moneyFlow === "EARN" || moneyFlow === "PAY";

  // OPP-TEMPLATE-001: picking a card prefills the editor — title/theme
  // from the card, price from its suggested quote (K → VND), skills
  // from its tags. The user still reviews and edits; the wire payload
  // is unchanged (same fields the free-form path sends).
  function pickTemplate(template: OpportunityTemplate): void {
    setPickedTemplate(template);
    setTitle(`${template.title} · ${template.tags.join(" / ")}`);
    setPriceMin(templatePriceToVND(template.price));
    setPriceMax("");
    setTraceId(undefined);
    // R58: reset the Moment spec sheet for the new card (engine chips
    // arrive with the catalog fetch; defaults land when it resolves).
    setMomentGroup(undefined);
    setMomentTime(undefined);
    setMomentDuration(undefined);
    setMomentPlace(undefined);
    setPrefValues({});
  }

  // R58: engine chip defaults — first option of every dimension, first
  // option of every preference row (matches the prototype's presets).
  useEffect(() => {
    if (!engineSpec) return;
    setMomentGroup((prev) => prev ?? engineSpec.groups[0]);
    setMomentTime((prev) => prev ?? engineSpec.times[0]);
    setMomentDuration((prev) => prev ?? engineSpec.durations[0]);
    setMomentPlace((prev) => prev ?? engineSpec.places[0]);
    if (momentPlace === "地图选点" && engineSpec.places[0] !== "地图选点") {
      // keep whatever the user typed; only seed on first arrival
    }
  }, [engineSpec, momentPlace]);

  useEffect(() => {
    if (!enginePolicy?.prefs) { setPrefValues({}); return; }
    setPrefValues((prev) => {
      const next: Record<string, { value: string; add: number }> = { ...prev };
      for (const pref of enginePolicy.prefs ?? []) {
        const first = pref.options[0];
        if (first && next[pref.key] === undefined) next[pref.key] = { value: first.value, add: first.add };
      }
      return next;
    });
  }, [enginePolicy]);

  if (!pickedTemplate) {
    return <PublishTemplatePicker
      marketplace={marketplace}
      onBack={onBack}
      onPicked={pickTemplate}
      onCustom={() => setPickedTemplate(CUSTOM_TEMPLATE)}
    />;
  }

  // R58 dynamic quote — recomputed from the engine whenever a chip or a
  // preference changes; drives both the breakdown lines and the price
  // prefill (K totals via quoteToVND keep the wire format identical).
  const baseK = pickedTemplate && pickedTemplate.id ? Number.parseInt((/^(\d+(?:\.\d+)?)K$/.exec(pickedTemplate.price.trim())?.[1] ?? "0"), 10) : 0;
  const providers = requiredProviderCount(momentGroup ?? "1 人", enginePolicy);
  // wire type (duration?: ...|undefined) → structural engine type; the
  // exactOptionalPropertyTypes flag forbids passing optional-undefined
  // straight through, so project into a clean object per property.
  const pricingLite = enginePricing
    ? {
        ...(enginePricing.duration ? { duration: enginePricing.duration } : {}),
        ...(enginePricing.time ? { time: enginePricing.time } : {}),
        ...(enginePricing.group ? { group: enginePricing.group } : {}),
        ...(enginePricing.perPair ? { perPair: enginePricing.perPair } : {})
      }
    : undefined;
  const quote = momentPriceQuote(
    baseK,
    { group: momentGroup ?? "1 人", time: momentTime ?? "", duration: momentDuration ?? "" },
    pricingLite,
    Object.values(prefValues).map((p) => p.add),
    providers
  );
  const prefAddTotal = Object.values(prefValues).reduce((sum, p) => sum + p.add, 0);
  const engineActive = Boolean(pickedTemplate?.id) && Boolean(engineSpec) && Boolean(momentGroup && momentTime && momentDuration);

  async function publish(): Promise<void> {
    if (publishing || !title.trim() || !location.trim()) return;
    const composedPrice = composePriceRange(priceMin, priceMax);
    if (priceRequired) {
      const validation = validateOpportunityPriceRange(composedPrice);
      if (!validation.ok) { setError(validation.error); return; }
    }
    setPublishing(true);
    setError(undefined);
    try {
      // R16.x (MONEYFLOW-005): PriceLabel 是 server-authoritative，
      // client 不再携带 priceLabel 到 wire。server normalize 推
      // opportunityPriceLabel(MoneyFlow)，wire 返回后由
      // MarketOpportunitySchema.parse 严格验证。
      const opportunity = await marketplace.publish({
        title: title.trim(), shortTitle: pickedTemplate && pickedTemplate.id ? pickedTemplate.title : "同行",
        theme: pickedTemplate && pickedTemplate.id ? pickedTemplate.title : "城市同行", date: "周六", time: time.trim(),
        location: location.trim(), price: composedPrice,
        skills: pickedTemplate && pickedTemplate.id ? pickedTemplate.tags.join(" · ") : "中文 · 摄影 · 本地路线",
        lens: ["BOOKED", "NEARBY"], travel: 20,
        moneyFlow,
        // OPP-TARGETED-001: 选中了人就发定向邀约（只对 TA 可见、只收
        // TA 报名）；没选 = 公开市场，wire 不带 targetUserId。
        ...(targetAgent ? { targetUserId: targetAgent.agentId } : {}),
        ...(merchant.merchantId ? { merchantId: merchant.merchantId } : {})
      });
      // R58 TraceID — 需求编号（PX-N）/邀约编号（PX-O），成功页展示+复制。
      // onPublished 刷新市场列表但不再立即关闭表单：R58 成功页留在
      // 原地展示编号与概要，“查看市场”退出、“再发一个”重置回选卡。
      setTraceId(formatTraceId(targetAgent ? "O" : "N"));
      onPublished(opportunity);
    } catch (error) {
      // MERCHANT-PUBLISH-001: 无成员资格 publisher 会被 server 403。
      if (error instanceof Error && /merchant_forbidden/i.test(error.message)) {
        setError("该店铺无发布权限（仅店主/管理员可以以店铺名义发布）。");
      } else {
        setError("发布没有写入服务器，请检查连接后重试。");
      }
    } finally {
      setPublishing(false);
    }
  }
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={() => { if (pickedTemplate && pickedTemplate.id) setPickedTemplate(undefined); else onBack(); }} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>发布需求</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      {pickedTemplate && pickedTemplate.id ? (
        <View style={styles.publishTemplateSummary}>
          <Text style={styles.publishTemplateSub}>你要发布</Text>
          <Text style={styles.publishTemplateSummaryTitle}>{pickedTemplate.title}</Text>
          <Text style={styles.publishTemplateSummaryStandard}>{pickedTemplate.standard}</Text>
          <Pressable onPress={() => setPickedTemplate(undefined)} style={styles.publishTemplateChange}>
            <Text style={styles.publishTemplateChangeText}>更换需求 ›</Text>
          </Pressable>
        </View>
      ) : null}
      {engineActive && enginePolicy ? (
        <View style={styles.r4Card}>
          <View style={styles.publishSpecHead}>
            <Text style={styles.r4Title}>Moment 规格</Text>
            <Text style={styles.publishRatioBadge}>{enginePolicy.mode} · {enginePolicy.ratio}</Text>
          </View>
          <Text style={styles.publishFlowSub}>{enginePolicy.ratioText}</Text>
          {providers > 1 ? (
            <Text style={styles.publishProviderNeed}>保持 {enginePolicy.ratio}：{momentGroup ?? ""} 位客户 · 需匹配 {providers} 位搭档，多组自动合并同一个需求。</Text>
          ) : null}
          {[
            { label: "人数", values: engineSpec?.groups ?? [], current: momentGroup, onPick: setMomentGroup },
            { label: "时间", values: engineSpec?.times ?? [], current: momentTime, onPick: setMomentTime },
            { label: "时长", values: engineSpec?.durations ?? [], current: momentDuration, onPick: setMomentDuration },
            { label: "地点", values: engineSpec?.places ?? [], current: momentPlace, onPick: setMomentPlace }
          ].map((dim) => (
            <View key={dim.label} style={styles.publishSpecRow}>
              <Text style={styles.factLabel}>{dim.label}</Text>
              <View style={styles.publishFlowRow}>
                {dim.values.map((v) => (
                  <Pressable key={v} onPress={() => { dim.onPick(v); if (dim.label === "时间") setTime(v); if (dim.label === "地点" && v !== "地图选点") setLocation(v); }} style={[styles.publishFlowChip, dim.current === v && styles.publishFlowChipOn]}>
                    <Text style={[styles.publishFlowLabel, dim.current === v && styles.publishFlowLabelOn]}>{v}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {enginePolicy.prefs && enginePolicy.prefs.length > 0 ? (
            <View style={[styles.publishSpecRow, { borderTopWidth: 1, borderTopColor: "#E7E2EA" }]}>
              <Text style={styles.factLabel}>偏好</Text>
              {enginePolicy.prefs.map((pref) => (
                <View key={pref.key} style={{ marginTop: 6 }}>
                  <Text style={styles.publishFlowSub}>{pref.label}</Text>
                  <View style={styles.publishFlowRow}>
                    {pref.options.map((opt) => (
                      <Pressable
                        key={opt.value}
                        onPress={() => setPrefValues((prev) => ({ ...prev, [pref.key]: { value: opt.value, add: opt.add } }))}
                        style={[styles.publishFlowChip, prefValues[pref.key]?.value === opt.value && styles.publishFlowChipOn]}
                      >
                        <Text style={[styles.publishFlowLabel, prefValues[pref.key]?.value === opt.value && styles.publishFlowLabelOn]}>{opt.value}{opt.add > 0 ? ` · +${opt.add}K` : ""}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.publishPriceBreakdown}>
            <Text style={styles.r4PriceLabel}>动态报价</Text>
            <Text style={styles.publishQuoteTotal}>{quoteToVND(quote.total)}{enginePricing?.perPair && providers > 1 ? ` · ${providers} 组 × ${quoteToVND(quote.perUnit)}` : ""}</Text>
            <Text style={styles.publishFlowSub}>
              基础 {baseK}K{quote.addOns.length > 0 ? quote.addOns.map((a) => ` · ${a.label} ${a.amount > 0 ? "+" : ""}${a.amount}K`).join("") : ""} · 偏好环境仅用于匹配，不按行为收费
            </Text>
            <Pressable onPress={() => setPriceMin(quoteToVND(quote.total))} style={[styles.r4ActionGhost, { marginTop: 8, alignSelf: "flex-start" }]}>
              <Text style={styles.r4ActionGhostText}>按此报价填入价格框 ›</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={styles.detailHero}>
        <Text style={styles.detailHeroKicker}>CREATE DEMAND</Text>
        <TextInput onChangeText={setTitle} style={[styles.detailHeroTitle, styles.publishInput]} value={title} />
        <Text style={styles.detailHeroSub}>Proxy 在发布前就告诉客户合理价格，避免把需求故意压成低价再让真人竞价。</Text>
      </View>
      <View style={styles.r4Card}>
        <Text style={styles.r4Title}>你想完成什么</Text>
        <View style={styles.factGrid}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>时间</Text>
            <TextInput onChangeText={setTime} style={styles.publishFactInput} value={time} />
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>地点</Text>
            <TextInput onChangeText={setLocation} style={styles.publishFactInput} value={location} />
          </View>
        </View>
        <View style={[styles.r4PriceCellHot, { borderRadius: 11, marginTop: 8, padding: 10 }]}>
          <Text style={styles.r4PriceLabel}>资金方向</Text>
          <View style={styles.publishFlowRow}>
            {PUBLISH_FLOW_OPTIONS.map((opt) => (
              <Pressable key={opt.id} onPress={() => onPickFlow(opt.id)} style={[styles.publishFlowChip, moneyFlow === opt.id && styles.publishFlowChipOn]}>
                <Text style={[styles.publishFlowLabel, moneyFlow === opt.id && styles.publishFlowLabelOn]}>{opt.label}</Text>
                <Text style={styles.publishFlowSub}>{opt.sub}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.r4PriceLabel}>{priceLabelForPublisher(moneyFlow)} · {moneyFlow === "TBD" ? "金额由双方面谈确定" : moneyFlow === "FREE" ? "0₫ 免费" : "公开在卡片上"}</Text>
          {priceRequired ? (
            <View style={styles.publishPriceRow}>
              <View style={styles.publishPriceCell}>
                <Text style={styles.factLabel}>最低</Text>
                <TextInput onChangeText={setPriceMin} style={styles.publishPriceInput} value={priceMin} placeholder={moneyFlow === "EARN" ? "例如 1,500,000₫" : "例如 500,000₫"} />
              </View>
              <View style={styles.publishPriceCell}>
                <Text style={styles.factLabel}>最高（可选）</Text>
                <TextInput onChangeText={setPriceMax} style={styles.publishPriceInput} value={priceMax} placeholder="例如 2,000,000₫" />
              </View>
            </View>
          ) : (
            <Text style={[styles.publishPriceInput, styles.publishPricePlaceholder]}>{moneyFlow === "TBD" ? "金额不公开在卡片上" : "0₫"}</Text>
          )}
          <Text style={styles.r4PriceLabel}>平台保底：100,000 VND · 上限 10,000,000 VND</Text>
        </View>
        <View style={styles.r4Match}>
          <Text style={styles.r4MatchText}>会完整展示给回应者 · 预计 6–10 位合格回应 · 竞争力：中等</Text>
        </View>
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>低于 100,000 VND 不能发布</Text>
        <Text style={styles.aiCheck}>Proxy 对付费机会执行最低保底；免费同行请明确选择“免费任务”。</Text>
      </View>
      <View style={styles.r4Card}>
        <Text style={styles.r4Title}>选人 · 可选</Text>
        <Text style={styles.publishFlowSub}>不选 = 发布到公开市场；选 TA = 定向邀约，只有 TA 能看到并回应。</Text>
        {targetAgent ? (
          <View style={[styles.publishFlowChip, styles.publishFlowChipOn, { marginTop: 8 }]}>
            <Text style={[styles.publishFlowLabel, styles.publishFlowLabelOn]}>{targetAgent.name}</Text>
            <Text style={styles.publishFlowSub}>已选定 · 发布后仅 TA 可见</Text>
          </View>
        ) : null}
        <View style={styles.publishFlowRow}>
          {candidatesPhase === "HIDDEN" ? (
            supply ? (
              <Pressable onPress={() => setCandidatesPhase("LOADING")} style={styles.publishFlowChip}>
                <Text style={styles.publishFlowLabel}>＋ 选个人邀约</Text>
              </Pressable>
            ) : null
          ) : null}
          {candidatesPhase === "LOADING" ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
          {candidatesPhase === "ERROR" ? (
            <View style={styles.publishFlowRow}>
              <Text style={styles.marketError}>候选加载失败。</Text>
              <Pressable onPress={() => setCandidatesPhase("LOADING")} style={styles.publishFlowChip}><Text style={styles.publishFlowLabel}>重试</Text></Pressable>
              <Pressable onPress={() => setCandidatesPhase("HIDDEN")} style={styles.publishFlowChip}><Text style={styles.publishFlowLabel}>不选了</Text></Pressable>
            </View>
          ) : null}
          {candidatesPhase === "READY" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusFilterRow}>
              {candidates.map((candidate) => (
                <Pressable key={candidate.agentId} onPress={() => setTargetAgent(targetAgent?.agentId === candidate.agentId ? undefined : candidate)} style={[styles.publishThemeCard, targetAgent?.agentId === candidate.agentId && styles.publishThemeCardOn]}>
                  <Text style={styles.publishTemplateMark}>{candidate.name.slice(0, 1)}</Text>
                  <Text style={styles.publishTemplateTitle}>{candidate.name}</Text>
                  <Text style={styles.publishTemplateRange}>{candidate.languages.join(" · ") || "CITY_COMPANION"}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => { setCandidatesPhase("HIDDEN"); setTargetAgent(undefined); }} style={styles.publishThemeCard}>
                <Text style={styles.publishTemplateTitle}>不选 · 公开市场</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>
      </View>
      {merchant.accounts.length > 0 ? (
        <View style={styles.r4Card}>
          <Text style={styles.r4Title}>发布身份</Text>
          <View style={styles.publishFlowRow}>
            <Pressable onPress={() => merchant.setMerchantId(undefined)} style={[styles.publishFlowChip, !merchant.merchantId && styles.publishFlowChipOn]}>
              <Text style={[styles.publishFlowLabel, !merchant.merchantId && styles.publishFlowLabelOn]}>个人</Text>
              <Text style={styles.publishFlowSub}>以自己名义</Text>
            </Pressable>
            {merchant.accounts.map((shop) => (
              <Pressable key={shop.id} onPress={() => merchant.setMerchantId(shop.id)} style={[styles.publishFlowChip, merchant.merchantId === shop.id && styles.publishFlowChipOn]}>
                <Text style={[styles.publishFlowLabel, merchant.merchantId === shop.id && styles.publishFlowLabelOn]}>{shop.name}</Text>
                <Text style={styles.publishFlowSub}>以店铺名义</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.r4Actions}>
        {traceId ? null : (
          <>
            <Pressable onPress={onBack} style={styles.r4ActionGhost}>
              <Text style={styles.r4ActionGhostText}>预览小美视角</Text>
            </Pressable>
            <Pressable disabled={publishing} onPress={() => void publish()} style={styles.r4ActionPrimary}>
              <Text style={styles.r4ActionPrimaryText}>{publishing ? "发布中…" : targetAgent ? `向 ${targetAgent.name} 发出邀约` : "发布到市场"}</Text>
            </Pressable>
          </>
        )}
      </View>
      {error ? <Text style={styles.marketError}>{error}</Text> : null}
      {/* R58 TraceID 成功页 — 编号 + 概要 + 复制 + 去市场/再发一个 */}
      {traceId ? (
        <View style={styles.publishSuccessCard}>
          <Text style={styles.publishSuccessCheck}>✓</Text>
          <Text style={styles.publishSuccessTitle}>{targetAgent ? "邀约已发出" : "需求已发布"}</Text>
          <Text style={styles.publishFlowSub}>
            {targetAgent ? `已经向 ${targetAgent.name} 发出需求，等待确认。` : "你的需求已经进入市场，符合条件的人可以报名或报价。"}
          </Text>
          <View style={styles.publishTraceBox}>
            <Text style={styles.publishFlowSub}>{targetAgent ? "订单编号" : "需求编号"}</Text>
            <Text style={styles.publishTraceId}>{traceId}</Text>
          </View>
          <View style={styles.publishFlowRow}>
            <Pressable onPress={() => { setTraceId(undefined); setPickedTemplate(undefined); setTargetAgent(undefined); }} style={styles.r4ActionGhost}>
              <Text style={styles.r4ActionGhostText}>再发一个</Text>
            </Pressable>
            <Pressable onPress={() => { setTraceId(undefined); onBack(); }} style={styles.r4ActionGhost}>
              <Text style={styles.r4ActionGhostText}>查看市场 ›</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
// APPLICANT-PROFILE-001: 报名人行的人名。
//
// 解析得到名字就显示名字（+ handle），解析不到就回退原来的截断 ID ——
// 未知保持未知，不编名字。空名字（wire 里 name 为空）同样
// 走回退：空字符串渲染出来是一行空白标题，比截断 ID 更糟。
function applicantTitle(profile: ProfileWire | undefined, applicantId: string): string {
  const name = profile?.name?.trim();
  if (!name) return `申请人 ${applicantId.slice(0, 10)}`;
  const handle = profile?.handle?.trim().replace(/^@/, "");
  return handle ? `${name} @${handle}` : name;
}
function SelectWorkbench({ marketplace, fulfillment, profileClient, opportunity, onBack }: { marketplace: MarketplaceClient; fulfillment?: FulfillmentClient | undefined; profileClient?: ProfileClient | undefined; opportunity: MarketOpportunity; onBack: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [candidates, setCandidates] = useState<MarketApplication[]>([]);
  const [workingId, setWorkingId] = useState<string>();
  const [error, setError] = useState<string>();
  // 快速 Offer：目标固定为报名名单里的真实 applicantId，金额发布者现填（VND）。
  const [offerAmount, setOfferAmount] = useState("1200000");
  const [offerWorkingId, setOfferWorkingId] = useState<string>();
  const [offerMsg, setOfferMsg] = useState<string>();
  // APPLICANT-PROFILE-001：applicantId → profile 的 best-effort 解析表。
  // 这面本就只给发布者看（"报名明细 · 仅发布者可见"），名字/handle 是报名人
  // 自己选的公开身份（与扫码分享同一口径），不是联系方式（电话/社媒仍按
  // "合作后"漏斗 gating）。单个解析失败只影响那一行（回退截断 ID），
  // 不整面报错 —— 一个人的资料读不到，不该挡住整份报名名单。
  const [applicantProfiles, setApplicantProfiles] = useState<Record<string, ProfileWire | undefined>>({});
  const requestedApplicantIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!profileClient) return;
    const ids = [...new Set(candidates.map((c) => c.applicantId))].filter((id) => !requestedApplicantIds.current.has(id));
    if (ids.length === 0) return;
    requestedApplicantIds.current = new Set([...requestedApplicantIds.current, ...ids]);
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(ids.map(async (id) => {
        try {
          return [id, await profileClient.getProfile(id)] as const;
        } catch {
          return [id, undefined] as const;
        }
      }));
      if (cancelled) return;
      setApplicantProfiles((prev) => {
        const next = { ...prev };
        for (const [id, profile] of entries) next[id] = profile;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [profileClient, candidates]);
  const load = useCallback(async (): Promise<void> => {
    setPhase("LOADING");
    try {
      setCandidates(await marketplace.listApplications(opportunity.id));
      setPhase("READY");
      setError(undefined);
    } catch {
      setPhase("ERROR");
      setError("报名名单加载失败，请检查登录状态或网络后重试。");
    }
  }, [marketplace, opportunity.id]);
  useEffect(() => { void load(); }, [load]);
  async function select(candidate: MarketApplication): Promise<void> {
    if (workingId) return;
    setWorkingId(candidate.applicationId);
    try { await marketplace.selectApplication(opportunity.id, candidate.applicationId); await load(); }
    catch { setError("选择没有保存成功，请重试。"); }
    finally { setWorkingId(undefined); }
  }
  async function offer(candidate: MarketApplication): Promise<void> {
    if (!fulfillment) { setOfferMsg("Offer 服务未就绪"); return; }
    if (offerWorkingId) return;
    const built = buildSlotOfferInput(opportunity.id, candidate.applicantId, offerAmount);
    if (!built.ok) { setOfferMsg(built.error); return; }
    setOfferWorkingId(candidate.applicationId);
    setOfferMsg(undefined);
    try {
      const created = await fulfillment.createSlotOffer(built.input);
      setOfferMsg(`已发 Offer · ${created.offerId.slice(0, 8)} · 5分钟内有效，对方接单后生成订单`);
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "发 Offer 失败");
    } finally {
      setOfferWorkingId(undefined);
    }
  }
  const selectedCount = candidates.filter((item) => item.status === "SELECTED" || item.status === "CONFIRMED").length;
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>选人工作台</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      <View style={styles.detailHero}>
        <Text style={styles.detailHeroKicker}>报名明细 · 仅发布者可见</Text>
        <Text style={styles.detailHeroTitle}>{opportunity.title}</Text>
        <Text style={styles.detailHeroSub}>
          {opportunity.date} {opportunity.time} · {opportunity.location} · {candidates.length} 份真实报名
        </Text>
      </View>
      <View style={styles.r4PriceStrip}>
        {[[String(candidates.length), "报名"], [String(candidates.filter((x) => x.status === "SUBMITTED").length), "待选择"], [String(selectedCount), "已选择"], [String(candidates.filter((x) => x.status === "CONFIRMED").length), "已确认"]].map(([n, l]) => (
          <View key={l} style={styles.r4PriceCell}>
            <Text style={[styles.r4PriceValue, { textAlign: "center" }]}>{n}</Text>
            <Text style={[styles.r4PriceLabel, { textAlign: "center" }]}>{l}</Text>
          </View>
        ))}
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>申请制，不把任何人直接上架</Text>
        <Text style={styles.aiCheck}>这里只展示真人主动提交的本次报价与范围。没有可靠履约数据时，不伪造推荐排名。</Text>
      </View>
      {phase === "LOADING" ? <ActivityIndicator color={color.magenta} /> : null}
      {error ? <Text style={styles.marketError}>{error}</Text> : null}
      {phase === "READY" && candidates.length === 0 ? <Text style={styles.detailHint}>还没有人报名。候选人不会由平台或 AI 自动补位。</Text> : null}
      {phase === "READY" && candidates.length > 0 ? (
        <View style={styles.r4Card}>
          <Text style={styles.r4Title}>快速 Offer 金额 · VND</Text>
          <TextInput keyboardType="number-pad" onChangeText={setOfferAmount} style={styles.publishPriceInput} value={offerAmount} placeholder="例如 1200000" />
          <Text style={styles.detailHint}>给选中的报名人发 5 分钟 Offer，对方接单后直接生成订单。金额至少 100,000 VND。</Text>
        </View>
      ) : null}
      {offerMsg ? <Text style={styles.offerMsg}>{offerMsg}</Text> : null}
      {candidates.map((c) => (
        <View key={c.applicationId} style={[styles.r4Card, (c.status === "SELECTED" || c.status === "CONFIRMED") && { borderColor: color.magenta }]}>
          <View style={styles.r4Top}>
            <Text style={styles.r4Title}>{applicantTitle(applicantProfiles[c.applicantId], c.applicantId)}</Text>
            <View style={styles.r4FitBadge}>
              <Text style={styles.r4FitText}>{c.status === "SUBMITTED" ? "待选择" : c.status === "SELECTED" ? "等待对方确认" : c.status === "CONFIRMED" ? "双方已确认" : "未选择"}</Text>
            </View>
          </View>
          <Text style={styles.r4Meta}>本次报价 {c.quote} · {c.scope || "申请人未填写服务范围"}</Text>
          <View style={styles.r4Actions}>
            <Pressable disabled={c.status !== "SUBMITTED" || Boolean(workingId)} onPress={() => void select(c)} style={c.status === "SUBMITTED" ? styles.r4ActionPrimary : styles.r4ActionGhost}>
              <Text style={c.status === "SUBMITTED" ? styles.r4ActionPrimaryText : styles.r4ActionGhostText}>{workingId === c.applicationId ? "保存中…" : c.status === "SUBMITTED" ? "选择并发出合作邀请" : "状态已记录"}</Text>
            </Pressable>
            {c.status === "SUBMITTED" && fulfillment ? (
              <Pressable disabled={Boolean(offerWorkingId)} onPress={() => void offer(c)} style={styles.r4ActionGhost} accessibilityLabel={`给申请人发 Offer`}>
                <Text style={styles.r4ActionGhostText}>{offerWorkingId === c.applicationId ? "发 Offer 中…" : "发 Offer →"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function MarketMap({
  tab,
  opportunities,
  lens,
  remoteLens,
  marketLabel,
  onOpenExperience,
  onOpenOpportunity,
  onUserFix
}: {
  tab: "OPPORTUNITY" | "ACTIVITY";
  opportunities: MarketOpportunity[];
  lens: OpportunityLens;
  remoteLens: boolean;
  marketLabel: string;
  onOpenExperience?: ((experienceId: string) => void) | undefined;
  onOpenOpportunity: (id: string) => void;
  // R15.x (P1 market 附近): parent passes a callback that the
  // map invokes whenever a foreground-location fix is obtained
  // (or refreshed). Parent uses this to (a) re-sort the LIST view
  // by haversine distance via server, and (b) re-render the map's
  // blue dot.
  onUserFix: (fix: { lat: number; lng: number } | undefined) => void;
}): React.JSX.Element {
  // 机会的本地集：跳过“远程”不显示；用 opportunities prop
  // 里机会的 coord 走 gridToLatLng 投影到真实经纬度。
  const localOpportunities = useMemo(
    () => opportunities.filter((o) => o.location !== "远程"),
    [opportunities]
  );
  const opportunityPins = useMemo(
    () =>
      localOpportunities
        .map((o, i) => {
          if (!o.coord) return null;
          const { lat, lng } = gridToLatLng(marketLabel, o.coord[0], o.coord[1]);
          return { id: o.id, label: String(i + 1), title: o.shortTitle, lat, lng };
        })
        .filter(
          (p): p is { id: string; label: string; title: string; lat: number; lng: number } => p !== null
        ),
    [localOpportunities, marketLabel]
  );
  // 默认 region: 用本地机会的 centroid (未拿到 GPS 之前)。
  const fallbackRegion: Region = useMemo(() => {
    if (opportunityPins.length === 0) {
      return { latitude: 21.0285, longitude: 105.8542, latitudeDelta: 0.12, longitudeDelta: 0.12 };
    }
    const avgLat = opportunityPins.reduce((s, p) => s + p.lat, 0) / opportunityPins.length;
    const avgLng = opportunityPins.reduce((s, p) => s + p.lng, 0) / opportunityPins.length;
    return { latitude: avgLat, longitude: avgLng, latitudeDelta: 0.08, longitudeDelta: 0.08 };
  }, [opportunityPins]);
  const mapRef = useRef<MapView | null>(null);
  const [userRegion, setUserRegion] = useState<Region | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locGranted, setLocGranted] = useState(false);
  // 以 ~2km delta 跟 map-canvas.tsx 一致：用户看到的是“附近”的街景。
  const userRegionDelta = { latitudeDelta: 0.02, longitudeDelta: 0.02 };
  async function useMyLocation(): Promise<void> {
    if (locBusy) return;
    setLocError(null);
    setLocBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("未授权定位 — iOS: 设置 → Proxy → 位置");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      const region: Region = { latitude, longitude, ...userRegionDelta };
      setUserRegion(region);
      setLocGranted(true);
      // R15.x (P1 market 附近): also propagate up so LIST view can
      // re-sort via server haversine.
      onUserFix({ lat: latitude, lng: longitude });
      if (mapRef.current) {
        mapRef.current.animateToRegion(region, 350);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "获取位置失败";
      setLocError(msg);
    } finally {
      setLocBusy(false);
    }
  }
  const isOpportunity = tab === "OPPORTUNITY";
  const titleText = isOpportunity ? "订单地图" : "活动地图";
  const subText =
    locGranted && userRegion
      ? "以您当前位置为中心 — 蓝点是您"
      : isOpportunity
        ? "默认以订单分布为中心 — 需点击右下角“用我当前位置”"
        : "活动暂无位置坐标 — 只显示探索点与你的位置";
  const privacyTitle = "地址粒度";
  const privacyText =
    "您看到的真实地址仅供探索；具体商户地址需由业务确实需要且您授权后才提升精度。热门推荐点是参考点，不代表您当前位置。";
  // 活动没有坐标（Activity 契约无 lat/lng），活动 Tab 不渲染机会图钉：
  // 之前把机会 id 强转成 Activity 传进详情，点开是坏页面。
  const onPinPress = (id: string): void => onOpenOpportunity(id);
  return (
    <View style={styles.mapWrap}>
      <View style={styles.mapLegend}>
        <Text style={styles.mapLegendTitle}>{titleText}</Text>
        <Text style={styles.mapLegendSub}>{subText}</Text>
      </View>
      <View style={styles.geoMap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={fallbackRegion}
          showsUserLocation={locGranted}
          showsMyLocationButton={false}
          showsCompass
          provider={Platform.OS === "ios" ? undefined : "google"}
          testID="market-map-view"
        >
          {isOpportunity ? opportunityPins.map((pin) => (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
              title={pin.title}
              description="可点开查看订单详情"
              onPress={() => onPinPress(pin.id)}
              pinColor="#0B7A73"
            />
          )) : null}
          {/* 热门探索点：紫色 marker，仅作为“可以去看看” — 不走 onPinPress */}
          {EXPLORER_SPOTS.map((spot) => (
            <Marker
              key={spot.id}
              coordinate={{ latitude: spot.lat, longitude: spot.lng }}
              title={spot.name}
              description={spot.tag === "HOT" ? "热门探索点" : "探索点"}
              pinColor={spot.tag === "HOT" ? "#7A2DC7" : "#9A8AB5"}
              opacity={0.85}
            />
          ))}
          {/* 您当前位置的覆盖圈：准确可视、但隐私级别仍然是“粗粒度” */}
          {userRegion ? (
            <Circle
              center={{ latitude: userRegion.latitude, longitude: userRegion.longitude }}
              radius={250}
              strokeColor="rgba(11,122,115,0.45)"
              fillColor="rgba(11,122,115,0.10)"
            />
          ) : null}
        </MapView>
        <Pressable
          style={styles.geoLocateBtn}
          onPress={useMyLocation}
          disabled={locBusy}
          testID="market-map-locate"
        >
          <ProxyIcon color={locGranted ? color.white : color.ink} name="route" size={14} />
          <Text style={locGranted ? styles.geoLocateBtnTextOn : styles.geoLocateBtnText}>
            {locBusy ? "定位中..." : locGranted ? "已用我的位置" : "用我当前位置"}
          </Text>
        </Pressable>
        {locError ? (
          <View style={styles.geoLocateError}>
            <Text style={styles.geoLocateErrorText}>{locError}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.geoPrivacy}>
        <ProxyIcon color={color.ink} name="route" size={14} />
        <View style={styles.geoPrivacyCopy}>
          <Text style={styles.geoPrivacyTitle}>{privacyTitle}</Text>
          <Text style={styles.geoPrivacyText}>{privacyText}</Text>
        </View>
      </View>
      {remoteLens ? (
        <View style={styles.mapRemote}>
          <Text style={styles.mapRemoteText}>远程订单不依赖地理位置。{"\n"}地图仅保留可定位的本地订单；远程订单请切回列表查看完整结果。</Text>
        </View>
      ) : null}
    </View>
  );
}

function mapConfig(): { _removed: true } {
  // R15.x: 旧 mapConfig 被 MarketMap 内的 useMemo + state 取代。
  // 保留一个 stub 以免外部遗留调用导致编译失败（defensive — 当前
  // 文件内未发现额外调用方）。如闲置超过 1 个 release 可删除。
  return { _removed: true };
}

const styles = StyleSheet.create({
  marketPage: { backgroundColor: color.offWhite, flex: 1 },
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 120, paddingHorizontal: 18, paddingTop: 10 },
  contentFlat: { paddingHorizontal: 0 },
  marketHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 4, paddingHorizontal: 12 },
  marketTitle: { color: color.ink, fontSize: 30, fontWeight: "800", lineHeight: 36 },
  marketSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  headActions: { alignItems: "center", flexDirection: "row", gap: 6 },
  viewToggle: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, height: 44, justifyContent: "center", width: 44, ...shadows.card },
  viewToggleOn: { backgroundColor: color.ink, borderColor: color.ink },
  viewToggleText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  viewToggleTextOn: { color: color.white },
  plusBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  plusBtnText: { color: color.white, fontSize: 22, fontWeight: "700" },
  publishMenuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,19,26,0.32)", paddingHorizontal: 14 },
  publishMenuSheet: { backgroundColor: color.white, borderColor: color.line, borderRadius: 24, borderWidth: 1, paddingBottom: 14, paddingHorizontal: 14, paddingTop: 8, ...shadows.card },
  publishMenuGrab: { alignSelf: "center", backgroundColor: color.line, borderRadius: 99, height: 4, marginBottom: 8, width: 38 },
  publishMenuTitle: { color: color.ink, fontSize: 20, fontWeight: "900" },
  publishMenuHint: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: 12, marginTop: 3 },
  publishMenu: { flexDirection: "column", gap: 8 },
  publishMenuPrimary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48 },
  publishMenuPrimaryText: { color: color.white, fontSize: 14, fontWeight: "800" },
  publishMenuSecondary: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48 },
  publishMenuSecondaryText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  floatingPublish: { alignItems: "center", backgroundColor: color.ink, borderRadius: 27, height: 54, justifyContent: "center", position: "absolute", right: 18, width: 54, ...shadows.card },
  statusFilterRow: { gap: 7, paddingHorizontal: 12, paddingVertical: 5 },
  statusFilter: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 38, paddingHorizontal: 12 },
  statusFilterOn: { backgroundColor: color.ink, borderColor: color.ink },
  statusFilterText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  statusFilterTextOn: { color: color.white },
  activityPublishPanel: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, margin: 12, padding: 14, ...shadows.card },
  activityPublishTitle: { color: color.ink, fontSize: 22, fontWeight: "800", marginBottom: 10 },
  activityPublishInput: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 14, marginBottom: 8, minHeight: 46, paddingHorizontal: 12, paddingVertical: 10 },
  activityPublishLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 4 },
  offerBar: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, paddingHorizontal: 12 },
  offerBtn: { backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  offerBtnDisabled: { opacity: 0.5 },
  offerBtnText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  offerBtnPrimary: { backgroundColor: color.lime, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  offerBtnPrimaryText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  offerMsg: { color: color.muted, fontSize: 11, marginTop: 6 },
  offerList: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, gap: 6, marginTop: 8, padding: 8 },
  offerCard: { alignItems: "center", backgroundColor: color.surface, borderRadius: 10, flexDirection: "row", justifyContent: "space-between", padding: 8 },
  offerCopy: { flex: 1 },
  offerId: { color: color.ink, fontSize: 12, fontWeight: "800" },
  offerMeta: { color: color.muted, fontSize: 11, marginTop: 2 },
  offerAccept: { backgroundColor: color.ink, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  offerAcceptText: { color: color.white, fontSize: 11, fontWeight: "800" },
  offerEmpty: { color: color.muted, fontSize: 11, textAlign: "center" },
  foundationTabs: { marginHorizontal: 12, marginVertical: 8 },
  oppStack: { marginTop: 4 },
  searchRow: { marginTop: 6, paddingHorizontal: 12 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flexDirection: "row", overflow: "hidden" },
  searchInput: { flex: 1, fontSize: 14, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon: { color: color.ink, fontSize: 15, paddingHorizontal: 10 },
  lensRow: { flexDirection: "row", gap: 5, paddingRight: 12 },
  lensSmRow: { flexDirection: "row", gap: 5, paddingRight: 12 },
  lensScroll: { marginVertical: 7 },
  lensRowCompact: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 6 },
  lens: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 13, paddingVertical: 8 },
  lensOn: { backgroundColor: color.ink, borderColor: color.ink },
  lensText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  lensTextOn: { color: color.white },
  lensSm: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  lensSmOn: { backgroundColor: color.ink, borderColor: color.ink },
  lensSmText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  lensSmTextOn: { color: color.white },
  badge: { alignItems: "center", backgroundColor: color.magenta, borderColor: color.white, borderRadius: 999, borderWidth: 2, height: 15, justifyContent: "center", minWidth: 15, paddingHorizontal: 4, position: "absolute", right: 5, top: 4 },
  badgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  localScope: { alignItems: "center", flexDirection: "row", gap: 5, marginVertical: 2, paddingHorizontal: 1 },
  localScopeGlyph: { color: color.violet, fontSize: 11 },
  localScopeText: { color: color.muted, fontSize: 11 },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 8 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionHint: { color: color.muted, fontSize: 11 },
  // R4 世代的上下文条
  contextBar: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 11, paddingVertical: 10 },
  contextCopy: { flex: 1 },
  contextTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  contextSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  contextBadge: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  contextBadgeText: { color: "#5B2CB5", fontSize: 11, fontWeight: "800" },
  r4Card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginVertical: 5, padding: 12, ...shadows.card },
  r4CardFlat: { backgroundColor: "transparent", borderBottomColor: "rgba(35,28,42,0.09)", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 12, marginVertical: 0 },
  r4Top: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  scenarioIcon: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, height: 28, justifyContent: "center", width: 28 },
  marketError: { color: color.magenta, fontSize: 11, lineHeight: 16, marginVertical: 7 },
  publishInput: { borderBottomColor: "rgba(255,255,255,0.35)", borderBottomWidth: 1, color: color.white, paddingVertical: 5 },
  publishFactInput: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 3, paddingVertical: 2 },
  publishPriceInput: { color: color.ink, fontSize: 14, fontWeight: "900", paddingVertical: 3 },
  publishPricePlaceholder: { color: color.muted, fontStyle: "italic" },
  publishPriceRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  publishPriceCell: { flex: 1 },
  publishFlowRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 6 },
  publishFlowChip: { backgroundColor: color.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, minWidth: 120 },
  publishFlowChipOn: { backgroundColor: color.magenta },
  publishFlowLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  publishFlowLabelOn: { color: "#fff" },
  publishFlowSub: { color: color.muted, fontSize: 11, marginTop: 1 },
  // OPP-TEMPLATE-001: catalog picker cards + step-2 summary.
  publishTemplateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  publishTemplateCard: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 12, width: "31%" },
  publishTemplateCardOn: { borderColor: color.ink, borderWidth: 2 },
  publishThemeCard: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginBottom: 6, minHeight: 88, minWidth: 128, paddingHorizontal: 12, paddingVertical: 10 },
  publishThemeCardOn: { borderColor: color.ink, borderWidth: 2 },
  publishTemplateMark: { color: color.ink, fontSize: 17, fontWeight: "900", marginBottom: 6 },
  publishTemplateTitle: { color: color.ink, fontSize: 12, fontWeight: "800", textAlign: "center" },
  publishTemplateSub: { color: color.muted, fontSize: 11, marginTop: 2, textAlign: "center" },
  publishTemplateRange: { color: color.muted, fontSize: 11, marginTop: 4 },
  publishTemplateSummary: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 10, paddingHorizontal: 14, paddingVertical: 12 },
  // OPP-CATALOG-001 (R58): Moment 规格节样式 — chips 复用 publishFlowChip，
  // 比例徽章/多搭档提示/动态报价分解是新增。
  publishSpecHead: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  publishRatioBadge: { backgroundColor: "#F1EDF5", borderRadius: 8, color: "#6B5E7E", fontSize: 11, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3 },
  publishProviderNeed: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  publishSpecRow: { marginTop: 10 },
  publishPriceBreakdown: { backgroundColor: "#F7F5FA", borderRadius: 11, marginTop: 12, padding: 10 },
  publishQuoteTotal: { color: color.ink, fontSize: 17, fontWeight: "700", marginTop: 2 },
  // R58 成功页（TraceID）：编号框 + 概要。
  publishSuccessCard: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 14, paddingHorizontal: 14, paddingVertical: 16 },
  publishSuccessCheck: { color: "#3D8B5F", fontSize: 22, fontWeight: "900" },
  publishSuccessTitle: { color: color.ink, fontSize: 15, fontWeight: "900", marginTop: 4 },
  publishTraceBox: { alignSelf: "stretch", backgroundColor: "#F7F5FA", borderRadius: 11, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8 },
  publishTraceId: { color: color.ink, fontSize: 14, fontWeight: "700", letterSpacing: 0.5, marginTop: 2 },
  publishTemplateSummaryTitle: { color: color.ink, fontSize: 15, fontWeight: "900", marginTop: 2 },
  publishTemplateSummaryStandard: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  publishTemplateChange: { alignSelf: "flex-end", marginTop: 8 },
  publishTemplateChangeText: { color: color.magenta, fontSize: 11, fontWeight: "800" },
  // OPP-SUGGEST-001: publish search box (生成 → catalog card).
  publishSearchRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 10 },
  publishSearchInput: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, fontSize: 12, paddingHorizontal: 12, paddingVertical: 10 },
  publishSearchGo: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, justifyContent: "center", minHeight: 38, paddingHorizontal: 14 },
  publishSearchGoText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  r4Title: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "800", lineHeight: 17 },
  r4Budget: { color: color.ink, fontSize: 13, fontWeight: "900" },
  r4Meta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  r4PriceStrip: { flexDirection: "row", gap: 6, marginTop: 8 },
  r4PriceCell: { backgroundColor: color.surface, borderRadius: 10, flex: 1, padding: 8 },
  r4PriceCellHot: { backgroundColor: "#FFF2C7" },
  r4PriceLabel: { color: color.muted, fontSize: 11 },
  r4PriceValue: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 2 },
  r4Tags: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  r4Tag: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  r4TagHot: { backgroundColor: "#FFF0F6" },
  r4TagText: { color: "#5E5665", fontSize: 11 },
  r4TagTextHot: { color: "#B91451", fontWeight: "800" },
  r4Match: { alignItems: "center", borderTopColor: "#F1EDF3", borderTopWidth: 1, flexDirection: "row", gap: 8, justifyContent: "space-between", marginTop: 9, paddingTop: 8 },
  r4MatchText: { color: color.muted, flex: 1, fontSize: 11, lineHeight: 15 },
  r4FitBadge: { backgroundColor: "#FFF0F6", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  r4FitText: { color: "#B91451", fontSize: 11, fontWeight: "800" },
  r4Actions: { flexDirection: "row", gap: 7, marginTop: 9 },
  r4ActionGhost: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 40 },
  r4ActionGhostText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  r4ActionPrimary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, flex: 1, justifyContent: "center", minHeight: 40 },
  r4ActionPrimaryText: { color: color.white, fontSize: 12, fontWeight: "800" },
  // 详情
  detailHead: { alignItems: "center", flexDirection: "row", gap: 4, marginBottom: 8 },
  detailBack: { paddingHorizontal: 6, paddingVertical: 4 },
  detailBackText: { color: color.ink, fontSize: 22, fontWeight: "700" },
  detailTitle: { color: color.ink, flex: 1, fontSize: 16, fontWeight: "800" },
  detailMore: { color: color.muted, fontSize: 16 },
  detailHero: { backgroundColor: color.ink, borderRadius: 18, marginBottom: 10, padding: 14 }, detailHeroTypeRow: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 10 }, detailHeroTypeMeta: { flex: 1, minWidth: 0 }, detailHeroTypeTitle: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 18, marginTop: 2 },
  detailHeroKicker: { color: "#CDC8BF", fontSize: 11, fontWeight: "800" },
  detailHeroTitle: { color: color.white, fontSize: 18, fontWeight: "800", lineHeight: 24, marginTop: 4 },
  detailHeroSub: { color: "#D8D4CA", fontSize: 11, lineHeight: 16, marginTop: 6 },
  valueBox: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, marginTop: 10, padding: 10 },
  valueHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  valueTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  valueBadge: { backgroundColor: "#FFF2C7", borderRadius: 999, color: "#7A5B00", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4 },
  valueBar: { backgroundColor: "#EEEAF1", borderRadius: 999, height: 8, marginVertical: 7, overflow: "hidden" },
  valueFill: { backgroundColor: color.magenta, borderRadius: 999, height: "100%" },
  valueText: { color: color.muted, fontSize: 11, lineHeight: 15 },
  factGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  noteBox: { backgroundColor: color.surface, borderRadius: 10, marginTop: 6, padding: 8 },
  noteLabel: { color: color.muted, fontSize: 11 },
  noteText: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 2 },
  fact: { backgroundColor: color.surface, borderRadius: 10, flexBasis: "48%", flexGrow: 1, padding: 8 },
  factLabel: { color: color.muted, fontSize: 11 },
  factValue: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 2 },
  aiBox: { backgroundColor: "#F1EAFE", borderColor: "#E6DBF8", borderRadius: 15, borderWidth: 1, marginTop: 10, padding: 10 },
  aiHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  aiTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  aiStrong: { color: "#5B2CB5", fontSize: 11, fontWeight: "800" },
  aiChecks: { gap: 4, marginTop: 7 },
  aiCheck: { color: "#3E2E5A", fontSize: 11, lineHeight: 15 },
  quoteGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  quoteOption: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexBasis: "48%", flexGrow: 1, padding: 9 },
  quoteOptionOn: { backgroundColor: "#FFF0F6", borderColor: color.magenta },
  quotePrice: { color: color.ink, fontSize: 12, fontWeight: "800" },
  quoteSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  detailHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 10, textAlign: "center" },
  // COMP-REPORT-002: oppDetailRoot 需要 flex:1 —— 举报弹层是绝对定位
  // (StyleSheet.absoluteFill)，没有撑满的根节点就盖不住整屏。
  oppDetailRoot: { flex: 1 },
  reportLink: { alignItems: "center", borderColor: color.line, borderRadius: 999, borderWidth: 1, marginTop: 12, paddingVertical: 9 },
  reportLinkText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  emptyBox: { alignItems: "center", borderColor: "#D9D0DE", borderRadius: 17, borderStyle: "dashed", borderWidth: 1, gap: 8, marginTop: 12, padding: 22 },
  emptyText: { color: color.muted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  retryBtn: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  retryText: { color: color.white, fontSize: 11, fontWeight: "700" },
  hostFlag: { marginHorizontal: 12, marginTop: -4, marginBottom: 7 },
  hostFlagText: { backgroundColor: "#F3EEFA", borderRadius: 999, color: "#633B99", fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 4 },
  mapWrap: { marginVertical: 9 },
  mapLegend: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  mapLegendTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  mapLegendSub: { color: color.muted, fontSize: 11, textAlign: "right" },
  geoMap: { backgroundColor: "#F7F5F8", borderColor: color.line, borderRadius: 19, borderWidth: 1, height: 330, marginVertical: 8, overflow: "hidden", position: "relative" },
  geoDistrict: { backgroundColor: "rgba(255,255,255,0.78)", borderRadius: 8, color: "#8E8595", fontSize: 11, fontWeight: "900", paddingHorizontal: 6, paddingVertical: 4, position: "absolute" },
  geoPin: { alignItems: "center", backgroundColor: "#0B7A73", borderColor: color.white, borderRadius: 999, borderWidth: 2, height: 31, justifyContent: "center", minWidth: 31, paddingHorizontal: 7, position: "absolute", transform: [{ translateX: -15.5 }, { translateY: -15.5 }] },
  geoPinText: { color: color.white, fontSize: 11, fontWeight: "900" },
  geoLocateBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, bottom: 10, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 7, position: "absolute", right: 10, ...shadows.card },
  geoLocateBtnText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  geoLocateBtnTextOn: { color: color.white, fontSize: 11, fontWeight: "700" },
  geoLocateError: { backgroundColor: "rgba(255,255,255,0.92)", borderColor: "#E6B100", borderRadius: 10, borderWidth: 1, left: 10, paddingHorizontal: 10, paddingVertical: 6, position: "absolute", right: 10, top: 10 },
  geoLocateErrorText: { color: "#7A5B00", fontSize: 11, fontWeight: "700" },
  geoPrivacy: { alignItems: "flex-start", backgroundColor: "#FFF8DF", borderColor: "#F0DA85", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 7, marginVertical: 7, padding: 9 },
  geoPrivacyGlyph: { color: color.ink, fontSize: 12 },
  geoPrivacyCopy: { flex: 1 },
  geoPrivacyTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  geoPrivacyText: { color: "#78672F", fontSize: 11, lineHeight: 15, marginTop: 2 },
  mapRemote: { backgroundColor: "#F7F4FA", borderColor: "#D8CFDE", borderRadius: 13, borderStyle: "dashed", borderWidth: 1, marginTop: 8, padding: 10 },
  mapRemoteText: { color: color.muted, fontSize: 11, lineHeight: 15 },
  mapResult: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, marginTop: 8, padding: 10 },
  mapResultTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  mapResultMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  mapResultBtn: { alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 10, marginTop: 8, paddingHorizontal: 10, paddingVertical: 7 },
  mapResultBtnText: { color: color.white, fontSize: 11, fontWeight: "800" }
});

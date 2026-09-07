// Market Surface — R4 (2026-08-24): 机会 / 活动 双 Tab。
// R4 决策：移除“体验上架”以保护小美身价；机会由客户单向发布，小美报名/报价。
// 视觉：沿用项目 R3 token（magenta/violet/ink/muted/line/surface），仅复用 R4 的卡片结构与价格可见性，
// 不引入原型暖黄 #F3A61D 作为主色，保持 Proxy 紫粉基线。
// R15.x: MAP 视图换成 react-native-maps 真地图 + expo-location GPS。
//   - 初始 region = 当前 user location（未授权时用机会 centroid）
//   - pin 位置 = MarketOpportunity.coord (grid) → gridToLatLng 转真实经纬度
//   - “热门地点” = MARKER 显式声明的探索点 (VENDOR_SPOT) — 重要但仅是探索，不会被默认高亮
//   - “快速真实地址” = showUserLocation 蓝点 + “用我当前位置”按钮
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useModuleBackHandler } from "../components/module-back";
import type { Activity } from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import { type FulfillmentClient } from "../fulfillment-client";
import { type MarketplaceClient, type MarketApplication } from "../marketplace-client";
import { nearestCityLabel } from "../market-city-label";
import { type MediaClient } from "../media-client";
import { type SupplyClient } from "../supply-client";
import { useMerchantIdentity } from "../use-merchant-identity";
import {
  OPPORTUNITY_LENS_LABEL,
  composePriceRange,
  type MarketOpportunity,
  type MarketTab,
  type OpportunityLens
} from "../market-fixtures";
import { gridToLatLng } from "../components/location-options";
import { ProxyIcon } from "../components/proxy-icon";
import { PaginatedModuleShell, tabsToPagerPages } from "../architecture/paginated-module";
import { color, shadows } from "../theme";
import { R37OpportunityCard, type OpportunityType, inferOpportunityTypeForFilter } from "./r37-opportunity-card";
import { R37TypePalette } from "./r37-type-palette";
import { ActivityDetail, ActivityFeedCard } from "./tasks";

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
  initialTab = "OPPORTUNITY",
  onOpenExperience,
  onOpenActivity,
  onOpenRealityScene,
  onChromeVisibilityChange,
  bottomNavVisible
}: {
  activities: ActivityClient;
  marketplace: MarketplaceClient;
  fulfillment?: FulfillmentClient;
  media?: MediaClient;
  supply?: SupplyClient;
  marketLabel: string;
  initialTab?: MarketTab;
  onOpenExperience?: ((experienceId: string) => void) | undefined;
  onOpenActivity: (activity: Activity) => void;
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
  const [oppDetail, setOppDetail] = useState<MarketOpportunity | null>(null);
  const [oppQuoteMode, setOppQuoteMode] = useState<"budget" | "standard" | "premium" | "custom">("standard");
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectOpp, setSelectOpp] = useState<MarketOpportunity | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>();

  // 规范 §4/§13：Android 硬件返回按真实嵌套深度逐层收起，最上层先消费；
  // 全部收起后返回 false 交给 shell 关模块。
  useModuleBackHandler(selectOpp ? () => { setSelectOpp(null); return true; } : undefined);
  useModuleBackHandler(publishOpen ? () => { setPublishOpen(false); return true; } : undefined);
  useModuleBackHandler(activityDetail ? () => { setActivityDetail(null); return true; } : undefined);
  useModuleBackHandler(oppDetail ? () => { setOppDetail(null); return true; } : undefined);
  const [offerMsg, setOfferMsg] = useState<string>();
  const [myOffers, setMyOffers] = useState<Array<{ offerId: string; status: string; expiresAt: string }>>([]);
  const [showOffers, setShowOffers] = useState(false);
  const lastScrollYRef = useRef(0);
  const chromeVisibleRef = useRef(true);
  const scrollDirectionDistanceRef = useRef(0);
  function onMarketScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastScrollYRef.current;
    if (y <= 48) {
      chromeVisibleRef.current = true;
      onChromeVisibilityChange?.(true);
      scrollDirectionDistanceRef.current = 0;
    } else if (Math.abs(delta) >= 1) {
      const prevDir = Math.sign(scrollDirectionDistanceRef.current);
      const nextDir = Math.sign(delta);
      scrollDirectionDistanceRef.current = prevDir !== 0 && prevDir !== nextDir ? delta : scrollDirectionDistanceRef.current + delta;
      if (scrollDirectionDistanceRef.current <= -18) {
        if (!chromeVisibleRef.current) { chromeVisibleRef.current = true; onChromeVisibilityChange?.(true); }
        scrollDirectionDistanceRef.current = 0;
      } else if (scrollDirectionDistanceRef.current >= 28) {
        if (chromeVisibleRef.current) { chromeVisibleRef.current = false; onChromeVisibilityChange?.(false); }
        scrollDirectionDistanceRef.current = 0;
      }
    }
    lastScrollYRef.current = y;
  }

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
      setOpportunityError("机会服务暂时不可用，请检查连接后重试。");
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

  async function createOfferForLinh(opportunity: MarketOpportunity): Promise<void> {
    if (!fulfillment) { setOfferMsg("Offer 服务未就绪"); return; }
    if (offerBusy) return;
    setOfferBusy(true);
    setOfferMsg(undefined);
    try {
      const offer = await fulfillment.createSlotOffer({ taskId: opportunity.id, slotId: `${opportunity.id}_slot_1`, agentId: "agent_linh" });
      setOfferMsg(`已发 Offer 给 Linh · ${offer.offerId.slice(0, 8)} · 5分钟内有效`);
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "发 Offer 失败");
    } finally {
      setOfferBusy(false);
    }
  }

  async function loadMyOffers(): Promise<void> {
    if (!fulfillment) { setOfferMsg("Offer 服务未就绪"); return; }
    setOfferBusy(true);
    try {
      const list = await fulfillment.listAgentOffers();
      setMyOffers(list.map((offer) => ({ offerId: offer.offerId, status: offer.status, expiresAt: offer.expiresAt })));
      setShowOffers(true);
      setOfferMsg(list.length === 0 ? "暂无 Offer" : `已加载 ${list.length} 个 Offer`);
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "加载 Offer 失败");
    } finally {
      setOfferBusy(false);
    }
  }

  async function acceptOffer(offerId: string): Promise<void> {
    if (!fulfillment) return;
    setOfferBusy(true);
    try {
      const res = await fulfillment.acceptSlotOffer(offerId);
      setOfferMsg(`已接单 · Order ${res.orderId.slice(0, 8)} · 可打卡`);
      void loadMyOffers();
      // store last order for check-in demo
      setLastOrderId(res.orderId);
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "接单失败");
    } finally {
      setOfferBusy(false);
    }
  }

  async function checkInLastOrder(): Promise<void> {
    const orderId = lastOrderId;
    if (!fulfillment || !orderId) { setOfferMsg("请先接单"); return; }
    setOfferBusy(true);
    try {
      await fulfillment.checkInOrder(orderId, { marketId: "hn", locationLabel: "河内·还剑湖" });
      setOfferMsg(`已打卡 · Order ${orderId.slice(0, 8)}`);
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "打卡失败");
    } finally {
      setOfferBusy(false);
    }
  }

  async function submitEvidenceLastOrder(): Promise<void> {
    const orderId = lastOrderId;
    if (!fulfillment || !media || !orderId) { setOfferMsg(!media ? "媒体服务未连接" : "请先接单/打卡"); return; }
    setOfferBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setOfferMsg("需要相机权限才能提交履约凭证");
        return;
      }
      const picked = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current
      });
      if (picked.canceled || !picked.assets[0]) {
        setOfferMsg("已取消凭证拍摄");
        return;
      }
      const asset = picked.assets[0];
      const uploaded = await media.uploadImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {})
      });
      await fulfillment.submitEvidence(orderId, { mediaAssetId: uploaded.mediaAssetId, evidenceType: "PHOTO" });
      setOfferMsg(`证据已提交 · Order ${orderId.slice(0, 8)}`);
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "提交证据失败");
    } finally {
      setOfferBusy(false);
    }
  }

  function upsertActivity(next: Activity): void {
    setActivityItems((current) => current.map((entry) => (entry.activityId === next.activityId ? next : entry)));
  }

  async function toggleInterest(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity, interested } = await activities.toggleInterest(activityId);
      upsertActivity(activity);
      const next = new Set(interestedIn);
      if (interested) next.add(activityId);
      else next.delete(activityId);
      setInterestedIn(next);
    } finally {
      setBusy(false);
    }
  }

  async function joinActivity(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity } = await activities.join(activityId);
      upsertActivity(activity);
      const next = new Set(joinedIds);
      next.add(activityId);
      setJoinedIds(next);
    } finally {
      setBusy(false);
    }
  }

  const visibleActivities = activityItems.filter((item) => {
    if (activityFilter === "CAFE") return item.venueType === "CAFE";
    if (activityFilter === "RESTAURANT") return item.venueType === "RESTAURANT";
    if (activityFilter === "MINE") return joinedIds.has(item.activityId) || interestedIn.has(item.activityId);
    return true;
  });

  const remoteLens = lens === "REMOTE";

  function renderMarketPage(pageTab: "OPPORTUNITY" | "ACTIVITY"): React.JSX.Element {
    const bottomPad = bottomNavVisible === false ? 16 : 120;
    return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, pageTab === "OPPORTUNITY" ? styles.contentFlat : null, { paddingBottom: bottomPad }]} onScroll={onMarketScroll} scrollEventThrottle={16}>
      <View style={styles.marketHead}>
        <View>
          <Text style={styles.marketTitle}>市场</Text>
          <Text style={styles.marketSub}>{effectiveMarketLabel} · 机会 · 活动</Text>
        </View>
        <View style={styles.headActions}>
          <Pressable onPress={() => setView(view === "MAP" ? "LIST" : "MAP")} style={[styles.viewToggle, view === "MAP" && styles.viewToggleOn]}>
            <ProxyIcon color={view === "MAP" ? color.white : color.ink} name={view === "MAP" ? "storeLines" : "route"} size={18} />
          </Pressable>
          <Pressable onPress={() => setPublishOpen(true)} style={styles.plusBtn}>
            <ProxyIcon color={color.white} name="plus" size={18} />
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["OPPORTUNITY", "机会"],
            ["ACTIVITY", "活动"]
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => {
              setTab(id);
              setPagerPage(id === "ACTIVITY" ? 1 : 0);
              setActivityDetail(null);
              setOppDetail(null);
            }}
            style={[styles.tab, pageTab === id && styles.tabOn]}
          >
            <Text style={[styles.tabText, pageTab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* M4 Offer wave: requester 发 Offer (5m TTL) + agent 接单，idempotency + slot 唯一 + 过期校验 */}
      <View style={styles.offerBar}>
        <Pressable disabled={offerBusy} onPress={() => void loadMyOffers()} style={[styles.offerBtn, offerBusy && styles.offerBtnDisabled]}>
          <Text style={styles.offerBtnText}>{offerBusy ? "加载中…" : "我的 Offer"}</Text>
        </Pressable>
        {oppDetail ? (
          <Pressable disabled={offerBusy} onPress={() => void createOfferForLinh(oppDetail)} style={[styles.offerBtnPrimary, offerBusy && styles.offerBtnDisabled]}>
            <Text style={styles.offerBtnPrimaryText}>发 Offer 给 Linh</Text>
          </Pressable>
        ) : null}
        <Pressable disabled={offerBusy || myOffers.length === 0} onPress={() => setShowOffers((v) => !v)} style={[styles.offerBtn, (offerBusy || myOffers.length === 0) && styles.offerBtnDisabled]}>
          <Text style={styles.offerBtnText}>{showOffers ? "收起" : `列表(${myOffers.length})`}</Text>
        </Pressable>
        <Pressable disabled={offerBusy} onPress={() => void checkInLastOrder()} style={[styles.offerBtn, offerBusy && styles.offerBtnDisabled]}>
          <Text style={styles.offerBtnText}>打卡</Text>
        </Pressable>
        <Pressable disabled={offerBusy} onPress={() => void submitEvidenceLastOrder()} style={[styles.offerBtn, offerBusy && styles.offerBtnDisabled]}>
          <Text style={styles.offerBtnText}>证据</Text>
        </Pressable>
      </View>
      {offerMsg ? <Text style={styles.offerMsg}>{offerMsg}</Text> : null}
      {supply ? (
        <Text style={styles.offerMsg}>
          {supplierMatches === undefined ? "供给匹配中…（hn·ZH）" : supplierError ? `供给查询失败：${supplierError}` : `供给匹配 ${supplierMatches.length} 人（hn·ZH 已核验）`}
        </Text>
      ) : null}
      {showOffers ? (
        <View style={styles.offerList}>
          {myOffers.length === 0 ? (
            <Text style={styles.offerEmpty}>暂无 Offer</Text>
          ) : (
            myOffers.map((o) => (
              <View key={o.offerId} style={styles.offerCard}>
                <View style={styles.offerCopy}>
                  <Text style={styles.offerId}>{o.offerId.slice(0, 8)}</Text>
                  <Text style={styles.offerMeta}>{o.status} · {new Date(o.expiresAt).toLocaleTimeString()}</Text>
                </View>
                <Pressable disabled={offerBusy || o.status !== "OFFERED"} onPress={() => void acceptOffer(o.offerId)} style={[styles.offerAccept, (offerBusy || o.status !== "OFFERED") && styles.offerBtnDisabled]}>
                  <Text style={styles.offerAcceptText}>{o.status === "OFFERED" ? "接受" : o.status}</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      ) : null}

      {publishOpen ? (
        <PublishDemand
          marketplace={marketplace}
          onBack={() => setPublishOpen(false)}
          onPublished={(opportunity) => {
            setOpportunityItems((items) => [opportunity, ...items]);
            setPublishOpen(false);
          }}
        />
      ) : selectOpp ? (
        <SelectWorkbench marketplace={marketplace} opportunity={selectOpp} onBack={() => setSelectOpp(null)} />
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
          onOpenActivity={(a) => setActivityDetail(a)}
          onUserFix={setUserFix}
        />
      ) : pageTab === "OPPORTUNITY" ? (
        oppDetail ? (
          <OpportunityDetail
            opportunity={oppDetail}
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
          {activityPhase === "LOADING" ? (
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
              onBack={() => setActivityDetail(null)}
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
    );
  }

  const pagerPages = tabsToPagerPages({
    tabs: ["OPPORTUNITY", "ACTIVITY"] as const,
    activeTab: tab,
    renderPage: renderMarketPage,
    titleOf: (item) => item === "OPPORTUNITY" ? "机会" : "活动",
  });

  return (
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
  );
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
  const base = sourceItems;
  let items = [...base];
  if (typeFilter !== "all") items = items.filter((o) => inferOpportunityTypeForFilter(o) === typeFilter);
  return (
    <>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput placeholder="搜机会…" placeholderTextColor="#A9A2B0" style={styles.searchInput} />
          <Text style={styles.searchIcon}>⌕</Text>
        </View>
      </View>

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
  quoteMode,
  setQuoteMode,
  onBack,
  onOpenSelect,
  onApply,
  onConfirm,
  busy
}: {
  opportunity: MarketOpportunity;
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
  const quote = quoteMode === "premium"
    ? `${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.25).toLocaleString()}₫`
    : quoteMode === "standard" ? (fair.split("–")[0]?.trim() ?? budget) : budget;
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>机会详情</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>

      <View style={styles.detailHero}>
        <Text style={styles.detailHeroKicker}>OPPORTUNITY</Text>
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
          <Text style={styles.factValue}>{opportunity.owner} {opportunity.verified ? "✓" : ""}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>当前回应</Text>
          <Text style={styles.factValue}>{opportunity.responses} 人</Text>
        </View>
      </View>

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

      <View style={styles.r4Actions}>
        <Pressable onPress={onBack} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>返回</Text>
        </Pressable>
        <Pressable disabled={busy || opportunity.appliedByViewer || opportunity.ownedByViewer} onPress={() => onApply(quote)} style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>{opportunity.appliedByViewer ? "已回应" : opportunity.ownedByViewer ? "这是你发布的机会" : busy ? "提交中…" : "按我的条件回应"}</Text>
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

function PublishDemand({ marketplace, onBack, onPublished }: { marketplace: MarketplaceClient; onBack: () => void; onPublished: (opportunity: MarketOpportunity) => void }): React.JSX.Element {
  const [title, setTitle] = useState("周六城市同行 + 拍照");
  const [time, setTime] = useState("10:00–18:00");
  const [location, setLocation] = useState("河内 · 西湖 / 老城区");
  // 价格区间两框：最低必填（EARN/PAY），最高可选，只填一边即单价。
  // wire 上仍走 price 自由字符串（composePriceRange 合成），server 侧
  // 校验/normalize 不用改。
  const [priceMin, setPriceMin] = useState("1,500,000₫");
  const [priceMax, setPriceMax] = useState("2,000,000₫");
  const [moneyFlow, setMoneyFlow] = useState<PublishMoneyFlow>("EARN");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  // MERCHANT-PUBLISH-001: 有店才显示身份选择；无店/未登录保持个人发布。
  const merchant = useMerchantIdentity();

  // 资金方向联动：TBD 强制清空 Price，FREE 强制填 0。
  function onPickFlow(next: PublishMoneyFlow): void {
    setMoneyFlow(next);
    if (next === "TBD") { setPriceMin(""); setPriceMax(""); }
    else if (next === "FREE") { setPriceMin("0₫"); setPriceMax(""); }
  }

  const priceRequired = moneyFlow === "EARN" || moneyFlow === "PAY";

  async function publish(): Promise<void> {
    if (publishing || !title.trim() || !location.trim()) return;
    if (priceRequired && !priceMin.trim()) return;
    setPublishing(true);
    setError(undefined);
    try {
      // R16.x (MONEYFLOW-005): PriceLabel 是 server-authoritative，
      // client 不再携带 priceLabel 到 wire。server normalize 推
      // opportunityPriceLabel(MoneyFlow)，wire 返回后由
      // MarketOpportunitySchema.parse 严格验证。
      const opportunity = await marketplace.publish({
        title: title.trim(), shortTitle: "同行", theme: "城市同行", date: "周六", time: time.trim(),
        location: location.trim(), price: composePriceRange(priceMin, priceMax), skills: "中文 · 摄影 · 本地路线",
        lens: ["BOOKED", "NEARBY"], travel: 20,
        moneyFlow,
        ...(merchant.merchantId ? { merchantId: merchant.merchantId } : {})
      });
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
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>发布需求</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
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
          <Text style={styles.r4PriceLabel}>公平参考：1.8 – 2.4M₫ · 8h + 中文 + 摄影 + 本地熟悉度</Text>
        </View>
        <View style={styles.r4Match}>
          <Text style={styles.r4MatchText}>会完整展示给回应者 · 预计 6–10 位合格回应 · 竞争力：中等</Text>
        </View>
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>如果坚持 1.5–2.0M₫ 也可以发布</Text>
        <Text style={styles.aiCheck}>Proxy 不阻止低预算，但会原样告诉小美“客户预算”和“公平参考”，小美可按更高条件回应。</Text>
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
        <Pressable onPress={onBack} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>预览小美视角</Text>
        </Pressable>
        <Pressable disabled={publishing} onPress={() => void publish()} style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>{publishing ? "发布中…" : "发布需求"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.marketError}>{error}</Text> : null}
    </View>
  );
}

function SelectWorkbench({ marketplace, opportunity, onBack }: { marketplace: MarketplaceClient; opportunity: MarketOpportunity; onBack: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [candidates, setCandidates] = useState<MarketApplication[]>([]);
  const [workingId, setWorkingId] = useState<string>();
  const [error, setError] = useState<string>();
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
      {candidates.map((c) => (
        <View key={c.applicationId} style={[styles.r4Card, (c.status === "SELECTED" || c.status === "CONFIRMED") && { borderColor: color.magenta }]}>
          <View style={styles.r4Top}>
            <Text style={styles.r4Title}>申请人 {c.applicantId.slice(0, 10)}</Text>
            <View style={styles.r4FitBadge}>
              <Text style={styles.r4FitText}>{c.status === "SUBMITTED" ? "待选择" : c.status === "SELECTED" ? "等待对方确认" : c.status === "CONFIRMED" ? "双方已确认" : "未选择"}</Text>
            </View>
          </View>
          <Text style={styles.r4Meta}>本次报价 {c.quote} · {c.scope || "申请人未填写服务范围"}</Text>
          <View style={styles.r4Actions}>
            <Pressable disabled={c.status !== "SUBMITTED" || Boolean(workingId)} onPress={() => void select(c)} style={c.status === "SUBMITTED" ? styles.r4ActionPrimary : styles.r4ActionGhost}>
              <Text style={c.status === "SUBMITTED" ? styles.r4ActionPrimaryText : styles.r4ActionGhostText}>{workingId === c.applicationId ? "保存中…" : c.status === "SUBMITTED" ? "选择并发出合作邀请" : "状态已记录"}</Text>
            </Pressable>
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
  onOpenActivity,
  onUserFix
}: {
  tab: "OPPORTUNITY" | "ACTIVITY";
  opportunities: MarketOpportunity[];
  lens: OpportunityLens;
  remoteLens: boolean;
  marketLabel: string;
  onOpenExperience?: ((experienceId: string) => void) | undefined;
  onOpenOpportunity: (id: string) => void;
  onOpenActivity: (activity: Activity) => void;
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
  const titleText = isOpportunity ? "机会地图" : "活动地图";
  const subText =
    locGranted && userRegion
      ? "以您当前位置为中心 — 蓝点是您"
      : "默认以机会分布为中心 — 需点击右下角“用我当前位置”";
  const privacyTitle = "地址粒度";
  const privacyText =
    "您看到的真实地址仅供探索；具体商户地址需由业务确实需要且您授权后才提升精度。热门推荐点是参考点，不代表您当前位置。";
  const onPinPress = isOpportunity
    ? (id: string) => onOpenOpportunity(id)
    : (id: string) => onOpenActivity(id as unknown as Activity);
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
          {opportunityPins.map((pin) => (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
              title={pin.title}
              description="可点开查看机会详情"
              onPress={() => onPinPress(pin.id)}
              pinColor="#0B7A73"
            />
          ))}
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
          <Text style={styles.mapRemoteText}>远程机会不依赖地理位置。{"\n"}地图仅保留可定位的本地机会；远程机会请切回列表查看完整结果。</Text>
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
  tabs: { backgroundColor: color.surface, borderRadius: 14, flexDirection: "row", gap: 5, marginVertical: 8, marginHorizontal: 12, padding: 4 },
  tab: { borderRadius: 11, flex: 1, minHeight: 44, justifyContent: "center", paddingVertical: 9 },
  tabOn: { backgroundColor: color.white, ...shadows.card },
  tabText: { color: color.muted, fontSize: 14, fontWeight: "800", textAlign: "center" },
  tabTextOn: { color: color.ink },
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
  detailHero: { backgroundColor: color.ink, borderRadius: 18, marginBottom: 10, padding: 14 },
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

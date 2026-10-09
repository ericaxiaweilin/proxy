// 动态 › 探索（CAFE-SCENE-001 的版式）。
//
// 版式是最初设计的那一版：「实时咖啡场景」横滑卡 + 活动预告卡 + 「本周热门」店铺卡 + 全部店铺（筛选）+ 场景详情底部弹层。
// 只换数据，不改排版（EXPLORE-REAL-001 误把它改成了纯文字列表，这里恢复）：
//   · 数据全部来自现成接口，没有新加：公开场景目录 /v1/reality-scenes（咖啡分类）、ActivityClient.listActivities；
//   · 假的东西不回来：没有人名 / 头像 /「已待 35 分钟」（公开目录里没有「是谁」），没有网速 / 吸烟 / 空调 / 插座 / 噪音那排属性
//     与标记说明（没有任何生产者），没有评价就不画评分，没拿到定位就不画距离；
//   · 能点的都是真的：点场景 / 店铺 → 打开场景详情（onOpenScene）；活动「加入」→ 真的报名（ActivityClient.join）。
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import type { Activity } from "@proxy/contracts";
import { ActivityClient } from "../activity-client";
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { localApiBaseUrl, nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import type { SceneOrigin } from "../scene-shop-directory";
import {
  EXPLORE_EMPTY_TEXT,
  EXPLORE_ERROR_TEXT,
  EXPLORE_LOADING_TEXT,
  activityMetaLine,
  activityPeopleLine,
  coffeeVenues,
  hereNowLine,
  hereNowScenes,
  loadExploreScenes,
  metaLine,
  photoUri,
  ratingLine,
  upcomingActivities,
  venueDistanceText,
  type ExploreScene,
} from "../coffee-scenes-model";

type LoadState = "LOADING" | "READY" | "ERROR";
type ShopFilter = "all" | "here" | "near" | "top";

const SHOP_FILTERS: readonly { id: ShopFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "here", label: "🔥 此刻有人" },
  { id: "near", label: "📍 附近" },
  { id: "top", label: "⭐ 高评分" },
];

const NEAR_KM = 2;

function distanceKm(scene: ExploreScene, origin: SceneOrigin | undefined): number | undefined {
  const text = venueDistanceText(scene, origin);
  if (text === "") return undefined;
  const m = text.match(/^([\d.]+)\s*(km|m)$/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  return m[2]!.toLowerCase() === "km" ? v : v / 1000;
}

function matchesFilter(scene: ExploreScene, filter: ShopFilter, origin: SceneOrigin | undefined): boolean {
  switch (filter) {
    case "all": return true;
    case "here": return (scene.hereCount ?? 0) > 0;
    case "near": { const d = distanceKm(scene, origin); return d !== undefined && d <= NEAR_KM; }
    case "top": return (scene.ratingCount ?? 0) > 0 && (scene.rating ?? 0) >= 4.6;
  }
}

export function CoffeeScenesHub({ onOpenScene }: { onOpenScene?: ((sceneId: string) => void) | undefined }): React.JSX.Element {
  const [view, setView] = useState<"HOME" | "ALL_SHOPS">("HOME");
  const [scenes, setScenes] = useState<readonly ExploreScene[]>([]);
  const [catalogState, setCatalogState] = useState<LoadState>("LOADING");
  const [activities, setActivities] = useState<readonly Activity[]>([]);
  const [activityState, setActivityState] = useState<LoadState>("LOADING");
  const [origin, setOrigin] = useState<SceneOrigin>();
  const [activeScene, setActiveScene] = useState<ExploreScene>();
  const [shopFilter, setShopFilter] = useState<ShopFilter>("all");
  const [joined, setJoined] = useState<ReadonlySet<string>>(new Set());
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string>();
  const activityClient = useMemo(() => new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }), []);

  // 公开场景目录：免登录；失败就明说失败，不留一片空白让人以为是「附近没有店」。
  useEffect(() => {
    let cancelled = false;
    void loadExploreScenes(fetch, localApiBaseUrl)
      .then((rows) => { if (!cancelled) { setScenes(rows); setCatalogState("READY"); } })
      .catch(() => { if (!cancelled) setCatalogState("ERROR"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void activityClient.listActivities()
      .then((list) => {
        if (cancelled) return;
        setActivities(upcomingActivities(list, new Date()));
        setActivityState("READY");
      })
      .catch(() => { if (!cancelled) setActivityState("ERROR"); });
    return () => { cancelled = true; };
  }, [activityClient]);

  // 定位只为距离服务：取不到就没有距离（不拿河内市中心当「你的位置」）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fix = await getCurrentFix(expoLocationApi, { requestPermission: true });
      if (!cancelled && fix) setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
    })();
    return () => { cancelled = true; };
  }, []);

  const venues = useMemo(() => coffeeVenues(scenes), [scenes]);
  const hereNow = useMemo(() => hereNowScenes(venues), [venues]);
  const event = activities[0];

  async function joinEvent(activity: Activity): Promise<void> {
    if (joinBusy || joined.has(activity.activityId)) return;
    setJoinBusy(true);
    setJoinError(undefined);
    try {
      await activityClient.join(activity.activityId);
      setJoined((prev) => new Set(prev).add(activity.activityId));
    } catch (err) {
      setJoinError(err instanceof Error && err.message ? err.message : "加入失败，请稍后重试");
    } finally {
      setJoinBusy(false);
    }
  }

  const stateLine = (state: LoadState): React.JSX.Element | null =>
    state === "LOADING" ? <Text selectable style={styles.stateText}>{EXPLORE_LOADING_TEXT}</Text>
      : state === "ERROR" ? <Text selectable style={styles.stateText}>{EXPLORE_ERROR_TEXT}</Text> : null;

  if (view === "ALL_SHOPS") {
    const filtered = venues.filter((s) => matchesFilter(s, shopFilter, origin));
    return (
      <View>
        <Pressable onPress={() => setView("HOME")} style={styles.back}><ProxyBackGlyph label="返回探索" /></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {SHOP_FILTERS.map((f) => (
            <Pressable key={f.id} onPress={() => setShopFilter(f.id)} style={[styles.filterTab, shopFilter === f.id && styles.filterTabOn]}>
              <Text selectable style={[styles.filterTabText, shopFilter === f.id && styles.filterTabTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {stateLine(catalogState)}
        {catalogState === "READY" ? <Text selectable style={styles.resultCount}>共 {filtered.length} 家</Text> : null}
        {catalogState === "READY" && venues.length === 0 ? <Text selectable style={styles.stateText}>{EXPLORE_EMPTY_TEXT.coffee}</Text> : null}
        {filtered.map((s) => <ShopCard key={s.id} onPress={onOpenScene ? () => onOpenScene(s.id) : undefined} origin={origin} shop={s} />)}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>☕ 此刻在咖啡店</Text>
        <Text selectable style={styles.sectionSub}>Live Now</Text>
      </View>
      {stateLine(catalogState)}
      {catalogState === "READY" && hereNow.length === 0 ? <Text selectable style={[styles.stateText, styles.sceneScroll]}>{EXPLORE_EMPTY_TEXT.here}</Text> : null}
      {hereNow.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sceneScroll}>
          {hereNow.map((s) => {
            const photo = photoUri(s.imageUrl, localApiBaseUrl);
            const dist = venueDistanceText(s, origin);
            const rating = ratingLine(s);
            return (
              <Pressable key={s.id} onPress={() => setActiveScene(s)} style={styles.sceneCard}>
                <View style={styles.liveTag}><View style={styles.liveDot} /><Text selectable style={styles.liveText}>{hereNowLine(s.hereCount)}</Text></View>
                <View style={styles.scenePerson}>
                  {photo
                    ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`live:${s.id}`} source={{ uri: photo }} style={styles.sceneAvatar} transition={0} />
                    : <View style={styles.sceneAvatar}><Text selectable style={styles.sceneAvatarText}>☕</Text></View>}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} selectable style={styles.scenePersonName}>{s.name}</Text>
                    {s.area ? <Text selectable style={styles.scenePersonWaited}>{s.area}</Text> : null}
                  </View>
                </View>
                {dist ? <Text selectable style={styles.scenePlace}>📍 {dist}</Text> : null}
                {rating ? <Text selectable style={styles.sceneActivity}>{rating}</Text> : null}
                <View style={styles.sceneMetaGrid}>
                  <View style={styles.sceneMeta}><Text selectable style={styles.sceneMetaValue}>{s.hereCount}</Text><Text selectable style={styles.sceneMetaKey}>在场</Text></View>
                </View>
                <View style={styles.sceneJoinRow}>
                  <Text selectable style={styles.sceneTag}>{s.type}</Text>
                  <Pressable onPress={(event) => { event.stopPropagation(); onOpenScene?.(s.id); }} style={styles.sceneJoinBtn}>
                    <Text selectable style={styles.sceneJoinBtnText}>去看看</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {stateLine(activityState)}
      {activityState === "READY" && !event ? <Text selectable style={[styles.stateText, styles.sceneScroll]}>{EXPLORE_EMPTY_TEXT.activities}</Text> : null}
      {event ? (
        <View style={styles.eventCard}>
          <Text selectable style={styles.eventBadge}>✦ 活动预告</Text>
          <Text selectable style={styles.eventTitle}>{event.title}</Text>
          <View style={styles.eventHost}>
            <View style={styles.eventHostAvatar}><Text selectable style={styles.eventHostAvatarText}>{(event.venueName || event.title).slice(0, 1)}</Text></View>
            <Text selectable style={styles.eventHostText}>{activityMetaLine(event)}</Text>
          </View>
          {event.desc ? <Text numberOfLines={3} selectable style={styles.eventDesc}>{event.desc}</Text> : null}
          <View style={styles.eventBottomRow}>
            <Text selectable style={styles.eventSpots}>{activityPeopleLine(event)}</Text>
            <Pressable disabled={joinBusy} onPress={() => void joinEvent(event)} style={[styles.eventJoinBtn, joined.has(event.activityId) && styles.eventJoinBtnOn]}>
              <Text selectable style={styles.eventJoinBtnText}>{joined.has(event.activityId) ? "已加入 ✓" : joinBusy ? "…" : "加入"}</Text>
            </Pressable>
          </View>
          {joinError ? <Text selectable style={styles.joinError}>{joinError}</Text> : null}
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>🔥 本周热门</Text>
        {venues.length > 3 ? (
          <Pressable onPress={() => setView("ALL_SHOPS")} style={styles.moreBtn}>
            <Text selectable style={styles.moreBtnText}>更多</Text>
            <ProxyIcon color={color.muted} name="arrowUpRight" size={11} />
          </Pressable>
        ) : null}
      </View>
      {catalogState === "READY" && venues.length === 0 ? <Text selectable style={styles.stateText}>{EXPLORE_EMPTY_TEXT.coffee}</Text> : null}
      {venues.slice(0, 3).map((s) => <ShopCard key={s.id} onPress={onOpenScene ? () => onOpenScene(s.id) : undefined} origin={origin} shop={s} />)}

      <Modal animationType="slide" transparent visible={Boolean(activeScene)} onRequestClose={() => setActiveScene(undefined)}>
        <Pressable onPress={() => setActiveScene(undefined)} style={styles.modalOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}>
            {activeScene ? (
              <>
                <View style={styles.modalDrag} />
                <View style={styles.modalTop}>
                  <View style={styles.modalAvatar}><Text selectable style={styles.modalAvatarText}>☕</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text selectable style={styles.modalName}>{activeScene.name}</Text>
                    <Text selectable style={styles.modalStatus}>{hereNowLine(activeScene.hereCount)}</Text>
                  </View>
                </View>
                <View style={styles.modalBlock}>
                  <Text selectable style={styles.modalBlockTitle}>场景信息</Text>
                  {activeScene.area ? <ModalRow label="📍 区域" value={activeScene.area} /> : null}
                  <ModalRow label="☕ 类型" value={activeScene.type} />
                  {ratingLine(activeScene) ? <ModalRow label="★ 评价" value={ratingLine(activeScene).replace(/^★\s*/, "")} /> : null}
                  {venueDistanceText(activeScene, origin) ? <ModalRow label="🚶 距离" value={venueDistanceText(activeScene, origin)} /> : null}
                </View>
                <View style={styles.modalActionRow}>
                  <Pressable onPress={() => setActiveScene(undefined)} style={styles.modalCancel}>
                    <Text selectable style={styles.modalCancelText}>关闭</Text>
                  </Pressable>
                  {onOpenScene ? (
                    <Pressable onPress={() => { const id = activeScene.id; setActiveScene(undefined); onOpenScene(id); }} style={styles.modalConfirm}>
                      <Text selectable style={styles.modalConfirmText}>查看场景</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ModalRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.modalRow}>
      <Text selectable style={styles.modalRowLabel}>{label}</Text>
      <Text selectable style={styles.modalRowValue}>{value}</Text>
    </View>
  );
}

function ShopCard({ shop, origin, onPress }: { shop: ExploreScene; origin: SceneOrigin | undefined; onPress?: (() => void) | undefined }): React.JSX.Element {
  const photo = photoUri(shop.imageUrl, localApiBaseUrl);
  const hot = (shop.hereCount ?? 0) > 0;
  const sub = metaLine([venueDistanceText(shop, origin), shop.area, hereNowLine(shop.hereCount)]);
  const rating = ratingLine(shop);
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={styles.shopCard}>
      <View style={styles.shopRow1}>
        <View style={styles.shopThumb}>
          {photo
            ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`shop:${shop.id}`} source={{ uri: photo }} style={styles.shopThumbImg} transition={0} />
            : <Text selectable style={styles.shopThumbEmoji}>☕</Text>}
          {hot ? <View style={styles.shopBadgeHot}><Text selectable style={styles.shopBadgeText}>HOT</Text></View> : null}
        </View>
        <View style={styles.shopInfo}>
          <Text selectable style={styles.shopName}>{shop.name}</Text>
          {sub ? <Text selectable style={styles.shopSub}>{sub}</Text> : null}
        </View>
        {rating ? (
          <View style={styles.shopScore}>
            <Text selectable style={styles.shopScoreValue}>{shop.rating}</Text>
            <Text selectable style={styles.shopScoreSub}>{shop.ratingCount} 评价</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 原来是给 `‹ 返回咖啡场景` 那份 Text 用的文字样式；现在字形和标签都走公共组件
  // ProxyBackGlyph（BACK-GLYPH-001），这里只留它承担的那点外边距。
  back: { marginBottom: 8, marginTop: 4 },

  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: color.ink, fontSize: 15, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  moreBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingVertical: 5 },
  moreBtnText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  sceneScroll: { marginBottom: 20 },
  sceneCard: { backgroundColor: color.ink, borderRadius: 20, marginRight: 10, overflow: "hidden", padding: 14, width: 208 },
  liveTag: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(31,200,169,0.18)", borderRadius: 10, flexDirection: "row", gap: 5, marginBottom: 11, paddingHorizontal: 8, paddingVertical: 4 },
  liveDot: { backgroundColor: color.mint, borderRadius: 3, height: 6, width: 6 },
  liveText: { color: "#8FE8D4", fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  scenePerson: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 11 },
  sceneAvatar: { alignItems: "center", backgroundColor: color.violet, borderRadius: 999, height: 44, justifyContent: "center", width: 44 },
  sceneAvatarText: { color: color.white, fontSize: 17, fontWeight: "800" },
  scenePersonName: { color: color.white, fontSize: 14, fontWeight: "800" },
  scenePersonWaited: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 1 },
  scenePlace: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginBottom: 3 },
  sceneActivity: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 11 },
  sceneMetaGrid: { flexDirection: "row", gap: 6, marginBottom: 13 },
  sceneMeta: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 11, flex: 1, paddingVertical: 6 },
  sceneMetaValue: { color: color.lime, fontSize: 12, fontWeight: "800" },
  sceneMetaKey: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 },
  sceneJoinRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sceneTag: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "600", paddingHorizontal: 7, paddingVertical: 3 },
  sceneJoinBtn: { backgroundColor: color.magenta, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 7 },
  sceneJoinBtnOn: { backgroundColor: "rgba(255,255,255,0.15)" },
  sceneJoinBtnText: { color: color.white, fontSize: 12, fontWeight: "700" },

  eventCard: { backgroundColor: color.violet, borderRadius: 20, marginBottom: 20, padding: 18 },
  eventBadge: { alignSelf: "flex-start", backgroundColor: color.magenta, borderRadius: 10, color: color.white, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: 12, paddingHorizontal: 9, paddingVertical: 4, textTransform: "uppercase" },
  eventTitle: { color: color.white, fontSize: 18, fontWeight: "800", marginBottom: 5 },
  eventHost: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 13 },
  eventHostAvatar: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 999, height: 18, justifyContent: "center", width: 18 },
  eventHostAvatarText: { color: color.white, fontSize: 11, fontWeight: "800" },
  eventHostText: { color: "rgba(255,255,255,0.65)", fontSize: 11.5 },
  eventDetailGrid: { flexDirection: "row", gap: 9, marginBottom: 13 },
  eventDetail: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 13, flex: 1, paddingVertical: 9 },
  eventDetailValue: { color: color.white, fontSize: 13, fontWeight: "800" },
  eventDetailKey: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 3 },
  eventDesc: { color: "rgba(255,255,255,0.75)", fontSize: 11.5, lineHeight: 16, marginBottom: 16 },
  eventBottomRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eventSpots: { color: "rgba(255,255,255,0.6)", fontSize: 11 },
  eventSpotsStrong: { color: color.white, fontWeight: "800" },
  eventJoinBtn: { backgroundColor: color.magenta, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 9 },
  eventJoinBtnOn: { backgroundColor: "rgba(255,255,255,0.25)" },
  eventJoinBtnText: { color: color.white, fontSize: 13, fontWeight: "700" },

  filterRow: { marginBottom: 12 },
  filterTab: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, marginRight: 7, paddingHorizontal: 13, paddingVertical: 7 },
  filterTabOn: { backgroundColor: color.ink, borderColor: color.ink },
  filterTabText: { color: color.ink, fontSize: 12, fontWeight: "600" },
  filterTabTextOn: { color: color.white },
  resultCount: { color: color.muted, fontSize: 11, marginBottom: 9 },

  shopCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 9, padding: 12, ...shadows.card },
  shopRow1: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 10 },
  shopThumb: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 104, justifyContent: "center", position: "relative", width: 104 },
  shopThumbEmoji: { fontSize: 44 },
  shopBadgeHot: { backgroundColor: color.magenta, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, position: "absolute", right: -6, top: -6 },
  shopBadgeNew: { backgroundColor: color.mint, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, position: "absolute", right: -6, top: -6 },
  shopBadgeText: { color: color.white, fontSize: 11, fontWeight: "800" },
  shopInfo: { flex: 1, minWidth: 0 },
  shopName: { color: color.ink, fontSize: 14, fontWeight: "700" },
  shopSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  shopScore: { alignItems: "flex-end" },
  shopScoreValue: { color: color.magenta, fontSize: 15, fontWeight: "800" },
  shopScoreSub: { color: color.muted, fontSize: 11, marginTop: 2 },


  modalOverlay: { backgroundColor: "rgba(23,19,31,0.55)", flex: 1, justifyContent: "flex-end" },
  modalSheet: { backgroundColor: color.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "76%", padding: 20, paddingBottom: 28 },
  modalDrag: { alignSelf: "center", backgroundColor: color.line, borderRadius: 2, height: 4, marginBottom: 16, width: 40 },
  modalTop: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 15 },
  modalAvatar: { alignItems: "center", backgroundColor: color.violet, borderRadius: 999, height: 50, justifyContent: "center", width: 50 },
  modalAvatarText: { color: color.white, fontSize: 18, fontWeight: "800" },
  modalName: { color: color.ink, fontSize: 17, fontWeight: "800" },
  modalStatus: { color: color.muted, fontSize: 11.5, marginTop: 3 },
  modalBlock: { backgroundColor: color.surface, borderRadius: 15, marginBottom: 11, padding: 13 },
  modalBlockTitle: { color: color.magenta, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: 9, textTransform: "uppercase" },
  modalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  modalRowLabel: { color: color.ink, fontSize: 12.5 },
  modalRowValue: { color: color.ink, fontSize: 12.5, fontWeight: "700" },
  modalActionRow: { flexDirection: "row", gap: 9, marginTop: 6 },
  modalCancel: { alignItems: "center", backgroundColor: color.surface, borderRadius: 16, flex: 0.4, paddingVertical: 14 },
  modalCancelText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  modalConfirm: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, flex: 1, paddingVertical: 14 },
  modalConfirmText: { color: color.white, fontSize: 14, fontWeight: "700" },
  stateText: { color: color.muted, fontSize: 12, marginBottom: 8 },
  shopThumbImg: { borderRadius: 14, height: 56, width: 56 },
  joinError: { color: "#BD3434", fontSize: 11, marginTop: 6 }
});

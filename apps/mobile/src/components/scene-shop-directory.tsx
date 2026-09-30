// SCENE-SHOP-DIRECTORY-001（2026-09-24，原型 deepseek_html_20260924_412dba
// 「Scene · 精修版」第 2/3 屏）：分类列表页 + 单店详情页。
//
// 首页那张分类入口卡点进来就是这一屏：先是一页按分类收窄的真实场景列表，
// 再点进去是单个场景的详情。两屏共用一个全屏 Modal（原型也是一路 push，
// 返回逐层收），所以内部用 mode 切，而不是两个 Modal 叠着。
//
// ⚠️ 原型上有、这一屏**故意没有**的东西（都有原因，别当成漏做）：
//   · 评分 —— **2026-09-27 起有了**（SCENE-RATING-CHIP-001）。SCENE-REVIEW-001
//     的场景评价域已落地、也已接进公开目录，所以卡片 chip 行现在照
//     「运动 · 羽毛球」的样式画 ★ 评分 / N 人去过 / 城市。规矩不变：只有
//     ratingCount > 0 才画，没有真实评价就整颗不出现。
//   · 价格（`₫/时`）与封面营业时间（`18:00-22:00`）—— 运动卡上这两项是演示
//     值，场景这边**全仓没有生产者**（migrations 与 internal 里没有 price /
//     openHours 之类的列或字段），所以不搬。要做先得有商家自采数据那条链。
//   · 「本月热门」/「最近新开」/「出图最多」排序 —— 场景没有图片计数，也
//     没有开业时间列（只有 updated_at，那是行更新时间）。
//   · 设施标签（带机位 / 可预约 / 安静）与「营业中」—— 用户已明确：单店详情
//     是商家自己页面上一个月采一次的数据，目前先不管；`active` 又是个静态
//     布尔，拿它渲染营业状态正是 SCENE-NO-FABRICATED-001 删掉「正在发生」的
//     原因。
//   · 「N 位在此出图」—— 真实有的是 SCENE-CHECKIN-001 的 hereCount（此刻声明
//     "在这里"的人），措辞就按真实语义写，不借"出图"这个词。
//   · 「这个场景的出图墙」—— 没有"这个场景的图片"这条查询。
//   · 底部「发布到这个场景」—— 这一屏够不到任何真实的发布入口（首页那个
//     onCompose 是关键词路由器，不是发布器）。点下去只弹一句提示的按钮就是
//     placeholder-honest-actions.test.ts 专门钉的死按钮，所以不放。
//   · 排序项/筛选片**只放数据真的支持的**：一个筛不掉任何东西的 chip 是死按钮。
//
// 反过来，能真做的都真做了：收藏（SetRealitySceneCheckIn 同族的场景状态命令）、
// 打卡（带 SCENE-CHECKIN-100M-001 的 100 米门禁）、导航（MEETUP-NAV-001 的
// 系统地图深链）、活动报名（复用现成 ActivityClient，不新造报名机制）。
// 「让小美来这个场景」走的是**转交**：那条链路要选人 + 填报酬 + 两步命令，
// 复制一份就是第二个真相，所以交给场景自己的那一屏去做。

import { useEffect, useMemo, useState } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color } from "../theme";
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { checkinEligibility, checkinHint } from "../scene-checkin";
import { meetupDirectionsUrls } from "../meetup-share";
import { sceneAddressLine, sceneSourceSuffix } from "../reality-scene-address";
import { ActivityClient } from "../activity-client";
import {
  activitiesAtScene, activitySignupLabel, canSignUp, isSceneActivity, sceneActivityFeed, sceneActivityFeedText,
  type SceneActivity, type SceneActivityFeedState,
} from "../scene-activities";
import { localApiBaseUrl, nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { LocalNetClient } from "../localnet-client";
import { sendSceneCommand, type AuthenticatedStoredSession } from "../scene-commands";
import {
  availableShopSorts, sceneDistanceMeters, shopAreaFacets, shopCardChips, shopCardSignal,
  shopCategoryBadge, shopCountText, shopDetailTags, shopDirectoryRows, shopDistanceBar, shopHereLine, shopInfoCells, shopListEndText,
  SCENE_PHOTO_WALL_EMPTY, scenePhotoWallTiles, sceneAssetWallTiles, sceneMerchantWallTiles, type ScenePhotoTile,
  shopAddressLine, shopCardDistance, shopHeroDistanceSuffix, shopListLocationLine, isFarAway, sceneActionSubtitle,
  type SceneOrigin, type SceneShopBrief, type ShopSortId,
} from "../scene-shop-directory";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { ProxyIcon } from "./proxy-icon";
// SCENE-LOCATION-PICKER-001: 场景卡的区域筛选跟「运动 · 羽毛球」共用同一套
// 弹出式城市/区域选择器，不再各卡各写一份筛选 UI。
import { LocationListPicker } from "./location-list-picker";

// SCENE-SHOP-DETAIL-001：详情只读我们需要的那几项 —— 这一屏不做 Studio，
// 所以不把整个 SceneDetail 的形状抄过来（抄了就得跟着服务端一起改）。
// 只认下面这几个字段，缺哪项就少画哪块。
//
// ⚠️ 这里**故意不**省略 backend 已经发下来的 humans / menu / variants /
// liveState —— 详见 `SCENE-HOME-DETAIL-001`：详情页要照参考稿画「适合一起
// 的人」「现在最适合」「这个 Scene 喝什么」三块，每一块都要求真实数据；屏
// 蔽这些字段就是「有数据不渲染」，下一次人照旧会觉得「缺」。
type ShopDetail = {
  sceneId: string;
  venueName: string;
  heroImageUrl: string;
  logoUrl?: string | undefined;
  // SCENE-COMPANION-001：「适合一起的人」—— 已登录且真的命中好友信号时画真实
  // 横滑；否则退回 detail.humans 这个标了 FIXTURE 占位候选的版本。
  companionSuggestions?: ReadonlyArray<{ id: string; name: string; avatarUrl: string; signal: "CHECKED_IN_HERE" | "JOINED_ACTIVITY_HERE" }> | undefined;
  humans: ReadonlyArray<{ id: string; name: string; role: string; availability: string; fitReason: string; sceneFit?: number | undefined; isAI: boolean; source?: string | undefined; avatarUrl: string }>;
  // SCENE-NOW-BEST-001：「现在最适合」—— 当前时段/容量/状态都来自这块。
  variants: ReadonlyArray<{ id: string; name: string; window: string; facets: ReadonlyArray<string>; bestFor: string }>;
  selectedVariant: string;
  liveState: { state: string; label: string; bestWindow: string; capacityPct?: number | undefined; freshUntil?: string | undefined };
  // SCENE-MENU-001：「这个 Scene 喝什么」—— 来自服务端真实菜单。
  menu: ReadonlyArray<{ id: string; name: string; priceLabel: string; sceneFit: string; available: boolean; imageUrl: string }>;
  fullMenu: ReadonlyArray<{ id: string; name: string; priceLabel: string; sceneFit: string; available: boolean; imageUrl: string }>;
  actions: ReadonlyArray<{ type: string; label: string; state: string; moneyMeaning: string }>;
  aiVisits?: ReadonlyArray<{ personaId: string; displayName: string }> | undefined;
  truthBoundary: string;
  // STORE-SCENE-LINK-001：认领了这个场景的店铺真的传过的相册，没认领/没照片
  // 就是 undefined——不回落到 hero/menu 占位图（那是 sceneAssetWallTiles 的活）。
  merchantPhotos?: ReadonlyArray<{ mediaAssetId: string; caption?: string | undefined }> | undefined;
};

function isShopDetail(value: unknown): value is ShopDetail {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.sceneId !== "string" || typeof item.venueName !== "string" || typeof item.heroImageUrl !== "string") return false;
  if (item.logoUrl !== undefined && typeof item.logoUrl !== "string") return false;
  if (item.truthBoundary !== undefined && typeof item.truthBoundary !== "string") return false;
  if (!Array.isArray(item.actions)) return false;
  for (const action of item.actions) {
    if (!action || typeof action !== "object") return false;
    const a = action as Record<string, unknown>;
    if (typeof a.label !== "string" || typeof a.state !== "string" || typeof a.moneyMeaning !== "string") return false;
  }
  // 三个新段：缺字段（undefined）= 数据还没拉到，调用方整段不画；空数组 = 数据
  // 拿到了但确实为空，调用方按空态文案走。两件事不能混。
  if (item.companionSuggestions !== undefined && !Array.isArray(item.companionSuggestions)) return false;
  if (item.merchantPhotos !== undefined && !Array.isArray(item.merchantPhotos)) return false;
  if (!Array.isArray(item.humans)) return false;
  if (!Array.isArray(item.variants)) return false;
  if (typeof item.selectedVariant !== "string") return false;
  if (!item.liveState || typeof item.liveState !== "object") return false;
  const ls = item.liveState as Record<string, unknown>;
  if (typeof ls.state !== "string" || typeof ls.label !== "string" || typeof ls.bestWindow !== "string") return false;
  if (!Array.isArray(item.menu)) return false;
  if (!Array.isArray(item.fullMenu)) return false;
  return true;
}

// 目录记录的收窄 + 归一化。
//
// 服务端 `imageUrl` 带 omitempty（没图时整个字段不出现），所以不能拿"字段必须
// 是 string"去卡整条记录 —— 那会把一家没有配图的真实场景判成脏数据，整页变成
// 「场景目录暂时取不到」。有就是有，没有就是空串（卡片回灰底），跟
// MERCHANT-LOGO-001 对 logo 的处置一致。
//
// 反过来，`category` / 坐标 / 计数这些**没有 omitempty** 的字段必须真的在：
// 缺了说明契约变了，整页报错比悄悄少画一家诚实。
function toSceneShopBrief(value: unknown): SceneShopBrief | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<Record<keyof SceneShopBrief, unknown>>;
  if (typeof item.id !== "string" || item.id.length === 0) return undefined;
  if (typeof item.name !== "string" || typeof item.area !== "string" || typeof item.type !== "string") return undefined;
  if (typeof item.category !== "string") return undefined;
  if (typeof item.latitude !== "number" || !Number.isFinite(item.latitude)) return undefined;
  if (typeof item.longitude !== "number" || !Number.isFinite(item.longitude)) return undefined;
  if (typeof item.visitedCount !== "number" || !Number.isFinite(item.visitedCount)) return undefined;
  const optional = (input: unknown): number | undefined => (typeof input === "number" && Number.isFinite(input) ? input : undefined);
  return {
    id: item.id,
    name: item.name,
    area: item.area,
    type: item.type,
    category: item.category,
    latitude: item.latitude,
    longitude: item.longitude,
    imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
    visitedCount: item.visitedCount,
    ...(typeof item.address === "string" && item.address.trim() !== "" ? { address: item.address } : {}),
    ...(typeof item.source === "string" && item.source !== "" ? { source: item.source } : {}),
    ...(optional(item.savedCount) !== undefined ? { savedCount: optional(item.savedCount)! } : {}),
    ...(optional(item.plannedCount) !== undefined ? { plannedCount: optional(item.plannedCount)! } : {}),
    ...(optional(item.hereCount) !== undefined ? { hereCount: optional(item.hereCount)! } : {}),
    // SCENE-RATING-CHIP-001：rating / ratingCount 服务端两个都带 omitempty，
    // 没评价时整对不出现 —— 所以跟上面几项一样按可选透传。**不在这一层判断
    // "算不算有评价"**：那是 shopRating 的活（count 当闸），这里只负责别把
    // 服务端真的发过来的数丢掉。
    ...(optional(item.rating) !== undefined ? { rating: optional(item.rating)! } : {}),
    ...(optional(item.ratingCount) !== undefined ? { ratingCount: optional(item.ratingCount)! } : {}),
  };
}

function absoluteNetworkURL(base: string, path: string | undefined): string | undefined {
  const trimmed = (path ?? "").trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

export function SceneShopDirectory({
  actionId,
  label,
  unit,
  apiBaseUrl,
  onClose,
  onOpenScene,
}: {
  actionId: string;
  label: string;
  unit: string;
  apiBaseUrl: string | undefined;
  onClose: () => void;
  onOpenScene?: ((sceneId: string) => void) | undefined;
}): React.JSX.Element {
  const safeArea = useSafeAreaInsets();
  const [scenes, setScenes] = useState<readonly SceneShopBrief[]>([]);
  const [catalogState, setCatalogState] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [origin, setOrigin] = useState<SceneOrigin>();
  const [sortId, setSortId] = useState<ShopSortId>("recommended");
  const [areas, setAreas] = useState<readonly string[]>([]);
  // SCENE-LOCATION-PICKER-001: 区域选择器是否打开——跟 badminton-companion.tsx
  // 的 screen 状态机同一个道理，靠 state 切内容，不再套第二个 Modal。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ShopDetail>();
  const [detailState, setDetailState] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [session, setSession] = useState<AuthenticatedStoredSession>();
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [here, setHere] = useState<ReadonlySet<string>>(new Set());
  const [activities, setActivities] = useState<readonly SceneActivity[]>([]);
  const [activityState, setActivityState] = useState<SceneActivityFeedState>("LOADING");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // 公开目录（/v1/reality-scenes）：不需要登录，失败就明说失败 —— 不留一片
  // 空列表让人以为是"附近没有"。
  useEffect(() => {
    let cancelled = false;
    if (!apiBaseUrl) { setCatalogState("ERROR"); return; }
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/reality-scenes`, { headers: { Accept: "application/json", "X-Proxy-App-Version": "1.0.0" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`scene catalog status ${response.status}`);
        const body = await response.json() as { scenes?: unknown };
        if (!Array.isArray(body.scenes)) throw new Error("scene catalog malformed");
        const valid = body.scenes.map(toSceneShopBrief);
        if (valid.some((row) => row === undefined)) throw new Error("scene catalog contained invalid records");
        if (!cancelled) { setScenes(valid as SceneShopBrief[]); setCatalogState("READY"); }
      })
      .catch(() => { if (!cancelled) setCatalogState("ERROR"); });
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  // 定位：这一屏的「最近」排序和距离角标都靠它。取不到就是取不到 ——
  // 不拿河内市中心当"你的位置"（那会把所有距离都算成假的）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fix = await getCurrentFix(expoLocationApi, { requestPermission: true });
        if (!cancelled && fix) setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
      } catch { /* 没定位：列表不含距离，排序项里也不会出现「最近」 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 收藏/打卡是**账号状态**，必须从服务端读回来 —— 只存在内存里，重开 app
  // 就显示成"没收藏"，而服务端其实记着。
  useEffect(() => {
    let cancelled = false;
    void nativeSecureSessionStore.read().then(async (next) => {
      if (cancelled || !next?.principal) return;
      const authenticated = next as AuthenticatedStoredSession;
      setSession(authenticated);
      const payload = await sendSceneCommand(sessionAuthClient, authenticated, "ListMyRealitySceneState", "me", {});
      if (cancelled) return;
      const states = Array.isArray(payload.states) ? payload.states : [];
      setSaved(new Set(states.filter((row) => row && typeof row === "object" && (row as { saved?: unknown }).saved === true && typeof (row as { sceneId?: unknown }).sceneId === "string").map((row) => (row as { sceneId: string }).sceneId)));
      const checkIns = Array.isArray(payload.checkIns) ? payload.checkIns : [];
      setHere(new Set(checkIns.filter((row): row is string => typeof row === "string")));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setDetail(undefined); return; }
    setDetail(undefined);
    setDetailState("LOADING");
    setNotice(undefined);
    void fetch(`${apiBaseUrl?.replace(/\/$/, "") ?? ""}/v1/scenes/${encodeURIComponent(selectedId)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error(`status ${response.status}`); return response.json(); })
      .then((value: unknown) => { if (!isShopDetail(value)) throw new Error("malformed"); if (!cancelled) { setDetail(value); setDetailState("READY"); } })
      .catch(() => { if (!cancelled) setDetailState("ERROR"); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, selectedId]);

  // 这个场景上的活动。没登录 = 看得到列表但报不了名，所以状态分开存
  //（"没有活动" / "取不到" / "没登录" 是三件事）。
  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setActivities([]); setActivityState("LOADING"); return; }
    setActivityState(session ? "LOADING" : "SIGNED_OUT");
    void new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore })
      .listActivities()
      .then((list) => {
        if (cancelled) return;
        const rows = list.filter(isSceneActivity);
        setActivities(activitiesAtScene(rows, selectedId));
        setActivityState(rows.length === 0 ? "EMPTY" : "READY");
      })
      .catch(() => { if (!cancelled) setActivityState("ERROR"); });
    return () => { cancelled = true; };
  }, [selectedId, session]);
  const activityFeed = sceneActivityFeed([...activities], activityState);

  // SCENE-PHOTO-WALL-001：照片墙 = 发帖时标记了这个场景的帖子里的图（需要登录：走帖子可见性规则）。
  const localNet = useMemo(
    () => new LocalNetClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore, baseUrl: apiBaseUrl ?? localApiBaseUrl }),
    [apiBaseUrl],
  );
  const [wall, setWall] = useState<readonly ScenePhotoTile[]>([]);
  const [wallState, setWallState] = useState<"LOADING" | "READY" | "ERROR" | "SIGNED_OUT">("LOADING");
  useEffect(() => {
    let cancelled = false;
    setWall([]);
    if (!selectedId) return;
    if (!session) { setWallState("SIGNED_OUT"); return; }
    setWallState("LOADING");
    void localNet.listPostsAtScene(selectedId, 30)
      .then((model) => { if (!cancelled) { setWall(scenePhotoWallTiles(model)); setWallState("READY"); } })
      .catch(() => { if (!cancelled) setWallState("ERROR"); });
    return () => { cancelled = true; };
  }, [localNet, selectedId, session]);

  const matched = useMemo(() => shopDirectoryRows(scenes, actionId), [scenes, actionId]);
  const facets = useMemo(() => shopAreaFacets(matched), [matched]);
  const rows = useMemo(
    () => shopDirectoryRows(scenes, actionId, { sortId, areas, ...(origin ? { origin } : {}) }),
    [scenes, actionId, sortId, areas, origin],
  );
  const sorts = availableShopSorts(origin !== undefined);
  const selected = selectedId ? matched.find((scene) => scene.id === selectedId) : undefined;
  const hereChecked = selectedId ? here.has(selectedId) : false;

  const toggleArea = (area: string): void => {
    setAreas((current) => current.includes(area) ? current.filter((item) => item !== area) : [...current, area]);
  };

  // 打卡沿用 SCENE-CHECKIN-100M-001 的门禁：100 米内才算到过。定位拿不到就
  // 明说需要定位，不是"默认能打"。
  const checkinDistance = selected ? sceneDistanceMeters(origin, selected) : undefined;
  const checkinAllowed = checkinEligibility(checkinDistance).eligible;

  const persistCheckIn = async (scene: SceneShopBrief, enabled: boolean): Promise<void> => {
    if (!session) { setNotice("请先登录，打卡才会同步。"); return; }
    // SCENE-CHECKIN-GATE-001：checkinAllowed 以前算了没用 —— 11,761 公里外照样打卡成功。取消永远可以。
    if (enabled && !checkinAllowed) { setNotice(checkinHint(false, checkinDistance)); return; }
    setBusy("checkin");
    setNotice(undefined);
    const snapshot = here;
    setHere((current) => { const next = new Set(current); if (enabled) next.add(scene.id); else next.delete(scene.id); return next; });
    const payload: Record<string, unknown> = { sceneId: scene.id, enabled };
    if (checkinDistance !== undefined) payload.distanceMeters = checkinDistance;
    try {
      await sendSceneCommand(sessionAuthClient, session, "SetRealitySceneCheckIn", scene.id, payload);
      setNotice(enabled ? "已打卡，90 分钟后自动结束。" : "已取消打卡。");
    } catch {
      setHere(snapshot);
      setNotice("同步失败，已恢复之前的状态，请重试。");
    } finally { setBusy(undefined); }
  };

  const toggleSaved = async (scene: SceneShopBrief): Promise<void> => {
    if (!session) { setNotice("请先登录，收藏才会同步。"); return; }
    setBusy("saved");
    setNotice(undefined);
    const snapshot = saved;
    const enabling = !saved.has(scene.id);
    setSaved((current) => { const next = new Set(current); if (enabling) next.add(scene.id); else next.delete(scene.id); return next; });
    try {
      // 收藏和打卡、去过共用同一族场景状态命令，payload 都是 { sceneId, enabled }
      //（见场景面的 persistToggle）—— 命令名一致，不另造一个。
      await sendSceneCommand(sessionAuthClient, session, "SetRealitySceneSaved", scene.id, { sceneId: scene.id, enabled: enabling });
      setNotice(enabling ? "已收藏。" : "已取消收藏。");
    } catch {
      setSaved(snapshot);
      setNotice("同步失败，已恢复之前的状态，请重试。");
    } finally { setBusy(undefined); }
  };

  const joinActivity = async (activityId: string): Promise<void> => {
    setBusy(activityId);
    setNotice(undefined);
    try {
      await new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }).join(activityId);
      const list = await new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }).listActivities();
      if (selectedId) setActivities(activitiesAtScene(list.filter(isSceneActivity), selectedId));
      setNotice("报名成功。");
    } catch {
      setNotice("报名失败，请稍后重试。");
    } finally { setBusy(undefined); }
  };

  const openNavigation = (scene: SceneShopBrief): void => {
    const urls = meetupDirectionsUrls({ lat: scene.latitude, lng: scene.longitude });
    if (!urls || (scene.latitude === 0 && scene.longitude === 0)) { setNotice("这个场景没有可用坐标，打不开导航"); return; }
    setNotice(undefined);
    void Linking.openURL(Platform.OS === "ios" ? urls.apple : urls.google).catch(() => setNotice("打不开导航，请重试"));
  };

  const shareScene = async (scene: SceneShopBrief): Promise<void> => {
    try {
      await Share.share({ message: `${scene.name} · ${sceneAddressLine(scene)} —— 在 Proxy 上看看这个场景` });
    } catch { /* 用户取消分享不算失败 */ }
  };

  const detailTags = selected ? shopDetailTags(selected) : [];
  const infoCells = selected ? shopInfoCells(selected) : [];
  // 详情大图优先用服务端的 heroImageUrl（MEDIA-VERSION 会随媒体变），拿不到
  // 才退回目录里的 imageUrl。两个都没有就是灰底 —— 不编一张占位图。
  const heroUri = detail?.heroImageUrl || (selected ? absoluteNetworkURL(apiBaseUrl ?? "", selected.imageUrl) : undefined);

  return (
    <Modal animationType="slide" onRequestClose={() => (selectedId ? setSelectedId(undefined) : onClose())} visible>
      <View style={[styles.page, { paddingTop: safeArea.top }]}>
        {pickerOpen ? (
          <LocationListPicker
            bottomInset={safeArea.bottom}
            footerLabel={areas.length > 0 ? `已选 ${areas.length} 个区域` : "未选择区域 · 默认显示全部"}
            markerItem={undefined}
            onBack={() => setPickerOpen(false)}
            onClear={() => setAreas([])}
            onConfirm={() => setPickerOpen(false)}
            onToggle={toggleArea}
            searchPlaceholder="搜索区域名称"
            sections={[{ title: "区域", hint: `${facets.length} 个区域`, items: facets }]}
            selected={areas}
            title="选择区域"
          />
        ) : selectedId === undefined ? (
          <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
            <View style={styles.topbar}>
              <Pressable accessibilityLabel="返回" hitSlop={8} onPress={onClose} style={styles.roundButton}><ProxyBackGlyph /></Pressable>
              <Text selectable style={styles.topbarTitle}>{label}</Text>
              <View style={styles.topbarSpacer} />
            </View>

            <View style={styles.listHead}>
              <Text selectable style={styles.listTitle}>{`附近${label}`}<Text selectable style={styles.listCount}>{`  ${shopCountText(rows.length, unit)}`}</Text></Text>
              <Text selectable style={styles.listLocation}>{shopListLocationLine(origin !== undefined, rows.map((row) => row.area), rows.length > 0 && rows.every((row) => isFarAway(sceneDistanceMeters(origin, row))))}</Text>
            </View>

            {/* 排序条：只放这一趟真的能用的项。没有定位就不给「最近」。 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
              {sorts.map((sort) => (
                <Pressable accessibilityLabel={`排序 ${sort.label}`} key={sort.id} onPress={() => setSortId(sort.id)} style={[styles.sortChip, sortId === sort.id && styles.sortChipOn]}>
                  <Text selectable style={[styles.sortChipText, sortId === sort.id && styles.sortChipTextOn]}>{sort.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {/* SCENE-LOCATION-PICKER-001: 只有唯一区域就不给这一行——点了没反应
                的入口是死按钮。弹出的是跟「运动 · 羽毛球」共用的同一个选择器。 */}
            {facets.length > 1 ? (
              <Pressable accessibilityLabel="选择区域" onPress={() => setPickerOpen(true)} style={styles.locationRow}>
                <ProxyIcon color={color.magenta} name="pin" size={16} />
                <Text selectable numberOfLines={1} style={styles.locationText}>
                  {areas.length === 0 ? "全部区域" : areas.join("、")}
                </Text>
                <Text selectable style={styles.locationMore}>更多 ›</Text>
              </Pressable>
            ) : null}

            {catalogState === "ERROR" ? <Text selectable style={styles.empty}>目录没能加载，刷新再试试。</Text>
              : catalogState === "LOADING" ? <Text selectable style={styles.empty}>正在加载附近场景…</Text>
                : rows.length === 0 ? <Text selectable style={styles.empty}>{areas.length > 0 ? "这个区域还没有接入的场景，取消筛选看看。" : `附近还没有接入的${label}场景。`}</Text>
                  : <View style={styles.cardList}>{rows.map((scene) => {
                    const photo = absoluteNetworkURL(apiBaseUrl ?? "", scene.imageUrl);
                    const distance = shopCardDistance(sceneDistanceMeters(origin, scene));
                    const address = shopAddressLine(scene);
                    const signal = shopCardSignal(scene);
                    return <Pressable accessibilityLabel={`场景 ${scene.name}`} key={scene.id} onPress={() => setSelectedId(scene.id)} style={styles.card}>
                      <View style={styles.cardPhoto}>
                        {photo ? <Image contentFit="cover" source={{ uri: photo }} style={styles.cardImage} /> : <View style={[styles.cardImage, styles.photoPlaceholder]}><Text selectable style={styles.photoPlaceholderText}>{scene.type.slice(0, 2) || "场景"}</Text></View>}
                        {scene.hereCount !== undefined && scene.hereCount > 0 ? <View style={styles.liveDot} /> : null}
                        {/* SCENE-CATEGORY-BADGE-001：分类角标 —— 真实枚举，缺值不画，
                            资质/状态类角标不许在这里出现（SCENE-NO-FABRICATED-001）。 */}
                        {shopCategoryBadge(scene) ? <View style={styles.coverBadge}><Text selectable style={styles.coverBadgeText}>{shopCategoryBadge(scene)}</Text></View> : null}
                        {/* SCENE-DISTANCE-BADGE-001（用户：「所有的场景必须标注距离数」，
                            对齐原型 deepseek_html_20260924_412dba 的 .shop-photo .distance）：
                            距离原来跟 signal 拼在同一行文字里，signal 有内容、distance 还
                            没算出来时整颗消失，看着像"这张卡没有距离"。改成封面上独立的
                            角标，跟 hot-scenes.tsx 的 distanceBadge 同一个位置/口径——没有
                            真实坐标或还没拿到定位时，这颗角标本身就不画（不垄假距离）。 */}
                        {distance ? <View style={styles.cardDistanceBadge}><Text selectable style={styles.cardDistanceText}>{distance}</Text></View> : null}
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.cardTitleRow}>
                          <Text selectable numberOfLines={1} style={styles.cardName}>{scene.name}</Text>
                          <Pressable accessibilityLabel={saved.has(scene.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => { void toggleSaved(scene); }} style={styles.heart}><ProxyIcon color={color.magenta} filled={saved.has(scene.id)} name="heart" size={20} /></Pressable>
                        </View>
                        {signal ? <Text selectable style={styles.cardSignal}>{signal}</Text> : null}
                        {address ? <Text selectable numberOfLines={1} style={styles.cardAddress}>{`📍 ${address}`}</Text> : null}
                        {/* SCENE-RATING-CHIP-001: chip 行照「运动 · 羽毛球」卡 ——
                            ★ 评分（金）/ N 人去过 / 城市（蓝）三色，再接类型标签。
                            每一颗都有真实来源，缺哪颗就少哪颗（不画灰占位、不写「—」）。 */}
                        <View style={styles.tagRow}>{shopCardChips(scene).map((chip) => (
                          <View key={`${chip.kind}:${chip.text}`} style={[styles.tag, chip.kind === "RATING" && styles.tagRating, chip.kind === "AREA" && styles.tagArea]}>
                            <Text selectable style={[styles.tagText, chip.kind === "RATING" && styles.tagRatingText, chip.kind === "AREA" && styles.tagAreaText]}>{chip.text}</Text>
                          </View>
                        ))}</View>
                        <View style={styles.cardFoot}>
                          <Text selectable style={styles.cardFootText}>{shopHereLine(scene.hereCount)}</Text>
                          {/* SCENE-HOME-PROTOTYPE-001（2026-09-28）：原来是文本字符 `›`
                              （原型自己也是这么写的），但字符不是字形 —— 形状/基线随
                              fontSize 漂、粗细跟 chevronLeft 对不上。换真字形。 */}
                          <ProxyIcon color={color.muted} name="chevronRight" size={16} />
                        </View>
                      </View>
                    </Pressable>;
                  })}</View>}

            {rows.length > 0 ? <Text selectable style={styles.listEnd}>{shopListEndText(rows.length, unit)}</Text> : null}
            {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              {heroUri ? <Image contentFit="cover" source={{ uri: heroUri }} style={styles.heroImage} /> : <View style={[styles.heroImage, styles.photoPlaceholder]}><Text selectable style={styles.heroPlaceholderText}>{selected?.type.slice(0, 2) || "场景"}</Text></View>}
              <View pointerEvents="none" style={styles.heroShade} />
              <View style={styles.heroTopbar}>
                {/* BACK-GLYPH-001：tone="onDark" 不能省 —— 这颗钮的底色是
                    heroRound 的 rgba(0,0,0,0.55)（压在封面照片上的半透明黑胶囊），
                    原来的字形是 heroRoundText 的白字。默认 ink 会变成黑底黑箭头 = 看不见。
                    同一排的 ↑ / ♥ 仍是白字，三个钮必须同色。 */}
                <Pressable accessibilityLabel="返回" hitSlop={8} onPress={() => setSelectedId(undefined)} style={styles.heroRound}><ProxyBackGlyph tone="onDark" /></Pressable>
                <View style={styles.heroRight}>
                  <Pressable accessibilityLabel="分享" hitSlop={8} onPress={() => { if (selected) void shareScene(selected); }} style={styles.heroRound}><Text selectable style={styles.heroRoundText}>↑</Text></Pressable>
                  <Pressable accessibilityLabel={selected && saved.has(selected.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => { if (selected) void toggleSaved(selected); }} style={styles.heroRound}><Text selectable style={[styles.heroRoundText, selected && saved.has(selected.id) && styles.heroRoundTextOn]}>{selected && saved.has(selected.id) ? "♥" : "♡"}</Text></Pressable>
                </View>
              </View>
              <View style={styles.heroCopy}>
                <Text selectable style={styles.heroTitle}>{detail?.venueName ?? selected?.name ?? ""}</Text>
                {selected && shopAddressLine(selected) ? <Text selectable numberOfLines={2} style={styles.heroAddress}>{`📍 ${shopAddressLine(selected)}${shopHeroDistanceSuffix(sceneDistanceMeters(origin, selected))}`}</Text> : null}
                {/* SCENE-HOME-DETAIL-001：详情胶囊只留「类型」（"咖啡 · 动态场景"）——
                    区名（Bắc Ninh）已经在上面 address 行里出现过了，再贴一颗胶囊
                    就是同一份信息出现两次。type 仍照搬 detailTags 的第一项。 */}
                <View style={styles.heroTags}>
                  {hereChecked ? <View style={[styles.tag, styles.tagLive]}><Text selectable style={styles.tagLiveText}>我在这里</Text></View> : null}
                  {detailTags.filter((tag) => tag !== selected?.area.trim()).slice(0, 2).map((tag) => <View key={tag} style={styles.heroTag}><Text selectable style={styles.heroTagText}>{tag}</Text></View>)}
                </View>
              </View>
            </View>

            <View style={styles.detailBody}>
              {/* 来源角标只给社区提交的（坐标未核实，用户该知道）；「坐标来源未知」是内部数据状态，不给用户看。 */}
              {selected?.source === "COMMUNITY" ? <Text selectable style={styles.address}>{`${sceneAddressLine(selected)}${sceneSourceSuffix(selected.source)}`}</Text> : null}

              {infoCells.length > 0 ? <View style={styles.infoStrip}>{infoCells.map((cell) => <View key={cell.label} style={styles.infoCell}><Text selectable style={styles.infoValue}>{cell.value}</Text><Text selectable style={styles.infoLabel}>{cell.label}</Text></View>)}</View> : null}

              {detailState === "ERROR" ? <Text selectable style={styles.empty}>没能打开这个场景，刷新再试试。</Text> : null}

              {/* SCENE-HOME-PROTOTYPE-001：原型 deepseek_html_20260927_7fc18d 的 action-row3
                  是**三颗**并排按钮 —— 收藏（rose，可切「已收藏」）/ 打卡（ink，可切
                  「已打卡」）/ 导航（白底）。以前这里是「导航 + 我在这里」两颗 + hero
                  右上角一颗心形，收藏被藏进角落，用户照原型看就是「缺收藏」。
                  三颗都走真实命令：收藏 = SetRealitySceneSaved 同族，打卡带
                  SCENE-CHECKIN-100M-001 的 100 米门禁，导航走系统地图深链。 */}
              <View style={styles.actionRow3}>
                <Pressable accessibilityLabel={selected && saved.has(selected.id) ? "取消收藏" : "收藏"} disabled={busy === "saved" || !selected} onPress={() => { if (selected) void toggleSaved(selected); }} style={[styles.actSave, selected && saved.has(selected.id) && styles.actSaveOn, (busy === "saved" || !selected) && styles.actionButtonBusy]}>
                  <ProxyIcon color={selected && saved.has(selected.id) ? color.white : color.magenta} filled={selected?.id !== undefined && saved.has(selected.id)} name="heart" size={15} />
                  <Text selectable style={[styles.actSaveText, selected && saved.has(selected.id) && styles.actSaveTextOn]}>{selected && saved.has(selected.id) ? "已收藏" : "收藏"}</Text>
                </Pressable>
                <Pressable accessibilityLabel={hereChecked ? "取消打卡" : "打卡"} disabled={busy === "checkin" || !selected || (!hereChecked && !checkinAllowed)} onPress={() => { if (selected) void persistCheckIn(selected, !hereChecked); }} style={[styles.actCheckin, hereChecked && styles.actCheckinOn, (busy === "checkin" || !selected || (!hereChecked && !checkinAllowed)) && styles.actionButtonBusy]}>
                  <ProxyIcon color={color.white} name="check" size={15} />
                  <Text selectable style={styles.actCheckinText}>{hereChecked ? "已打卡" : "打卡"}</Text>
                </Pressable>
                <Pressable accessibilityLabel="导航到这里" onPress={() => { if (selected) openNavigation(selected); }} style={styles.actNav}>
                  <ProxyIcon color={color.ink} name="arrowUpRight" size={15} />
                  <Text selectable style={styles.actNavText}>导航</Text>
                </Pressable>
              </View>

              {/* 原型 dist-bar：距离 + 100 米自动打卡说明。拿不到定位就不画这一条。 */}
              {selected && shopDistanceBar(selected, origin) ? <View style={styles.distBar}>
                <ProxyIcon color={color.muted} name="clock" size={14} />
                <Text selectable style={styles.distBarText}>{shopDistanceBar(selected, origin)}</Text>
              </View> : null}
              <Text selectable style={styles.checkinHint}>{checkinHint(hereChecked, checkinDistance)}</Text>

              {/* 邀约那条链路要选人 + 填报酬 + 两步命令 —— 复制一份就是第二个
                  真相，所以转交给场景自己的那一屏去做。 */}
              <Pressable accessibilityLabel="让小美来这个场景" disabled={!selected || !onOpenScene} onPress={() => { if (selected) onOpenScene?.(selected.id); }} style={[styles.primaryAction, (!selected || !onOpenScene) && styles.actionButtonBusy]}>
                <Text selectable style={styles.primaryActionText}>让小美来这个场景</Text>
                <Text selectable style={styles.primaryActionSub}>约她出图 / 同行 · 选人、时间、报酬在场景页里定</Text>
              </Pressable>

              {/* SCENE-HOME-DETAIL-001（2026-09-27）：参考稿第 3 屏比对了下面三块，
                  之前这一屏**故意没画**（缺数据源）。后端已经发下来 humans /
                  menu / variants / liveState —— 这次接进来。注意：每块都对真实数据
                  诚实 —— 没有就空态，不许拿 demo 数据糊。 */}

              {detail ? <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>现在最适合</Text>
                <View style={styles.bestGrid}>
                  <View style={styles.bestCard}>
                    <Text selectable style={styles.bestCardTitle}>{((detail.variants.find((variant) => variant.id === detail.selectedVariant)?.bestFor) ?? "").trim() || "—"}</Text>
                  </View>
                  <View style={styles.bestCard}>
                    <Text selectable style={styles.bestCardTitle}>{detail.liveState.state.replaceAll("_", " ")}</Text>
                    {/* GEO-HONEST-001：没有容量来源时不编数字，有才印。 */}
                    <Text selectable style={styles.bestCardSub}>{detail.liveState.bestWindow}{detail.liveState.capacityPct === undefined ? "" : ` · 容量 ${detail.liveState.capacityPct}%`}</Text>
                  </View>
                </View>
              </View> : null}

              {detail ? <View style={styles.matchCard}>
                {/* SCENE-HOME-PROTOTYPE-001：原型把「适合一起的人」做成深色
                    match-card —— 「匹配推荐」金标签 + 标题 + 副题 + 头像横排 +
                    白底的「看全部」按钮。文案层级照原型，数据仍来自
                    companionSuggestions（真实好友信号）→ detail.humans（诚实
                    占位候选）→ 空态，三档不变。
                    （原型那颗「看全部」跳转按钮**故意不做**：真实 app 没有
                    那个目的地，做了就是 placeholder-honest-actions.test.ts
                    钉的死按钮。） */}
                <View style={styles.matchLabel}><Text selectable style={styles.matchLabelText}>匹配推荐</Text></View>
                <Text selectable style={styles.matchTitle}>适合一起的人</Text>
                {detail.companionSuggestions && detail.companionSuggestions.length > 0 ? (
                  <ScrollView horizontal contentContainerStyle={styles.humanRail} showsHorizontalScrollIndicator={false}>
                    {detail.companionSuggestions.map((person) => <View key={person.id} style={styles.humanPlain}>
                      <View style={styles.humanRing}>{person.avatarUrl ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`companion:${person.id}`} source={{ uri: person.avatarUrl }} style={styles.humanAvatarImage} transition={0} /> : <View style={styles.humanAvatarFallback}><Text selectable style={styles.humanAvatarText}>{person.name.slice(0, 1).toUpperCase()}</Text></View>}</View>
                      <Text selectable style={styles.humanPlainNameLight}>{person.name}</Text>
                      <Text selectable style={styles.humanPlainSubLight}>{person.signal === "CHECKED_IN_HERE" ? "最近来过这里" : "报名过这里的活动"}</Text>
                    </View>)}
                  </ScrollView>
                ) : detail.humans.length > 0 ? (
                  <ScrollView horizontal contentContainerStyle={styles.humanRail} showsHorizontalScrollIndicator={false}>
                    {detail.humans.map((human) => <View key={human.id} style={styles.humanPlain}>
                      <View style={styles.humanRing}>{human.avatarUrl ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-human:${human.id}`} source={{ uri: human.avatarUrl }} style={styles.humanAvatarImage} transition={0} /> : <View style={styles.humanAvatarFallback}><Text selectable style={styles.humanAvatarText}>{human.name.slice(0, 1).toUpperCase()}</Text></View>}</View>
                      <Text selectable style={styles.humanPlainNameLight}>{human.name}</Text>
                      <Text selectable style={styles.humanPlainSubLight}>{`${human.availability}${human.source === "FIXTURE" ? " · 占位候选" : ""}`}</Text>
                    </View>)}
                  </ScrollView>
                ) : (
                  <Text selectable style={styles.matchSub}>这个场景现在还没有挂出可约时间的人 —— 这不是加载失败，也不是「再等等就会有人」的承诺。可以先收藏这个场景。</Text>
                )}
              </View> : null}

              {detail ? <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>这个 Scene 喝什么</Text>
                {detail.menu.length > 0 ? <ScrollView horizontal contentContainerStyle={styles.menuRail} showsHorizontalScrollIndicator={false}>
                  {detail.menu.map((item) => <View key={item.id} style={styles.menuCard}>
                    <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-menu:${item.id}`} source={{ uri: item.imageUrl }} style={styles.menuImage} transition={0} />
                    <Text selectable numberOfLines={1} style={styles.menuName}>{item.name}</Text>
                    <Text selectable style={styles.menuFit}>{`${item.sceneFit} · ${item.available ? "可售" : "售罄"}`}</Text>
                    <Text selectable style={styles.menuPrice}>{item.priceLabel}</Text>
                  </View>)}
                </ScrollView> : <Text selectable style={styles.blockEmpty}>这家店还没有菜单</Text>}
              </View> : null}

              {detail && detail.aiVisits && detail.aiVisits.length > 0 ? <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>绑定这个场景的小美</Text>
                <View style={styles.personRow}>{detail.aiVisits.map((visit) => <View key={visit.personaId} style={styles.person}>
                  <View style={styles.personAvatar}><Text selectable style={styles.personAvatarText}>{visit.displayName.slice(0, 1).toUpperCase()}</Text></View>
                  <Text selectable numberOfLines={1} style={styles.personName}>{visit.displayName}</Text>
                </View>)}</View>
              </View> : null}

              <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>这里的活动</Text>
                {/* SCENE-HOME-PROTOTYPE-001：原型的 event-scroll 是横滑卡片，
                    不是竖排行。卡上只画有真实字段的东西——标题/时间/人数/报名
                    状态；原型每张卡的"进行中/已结束"徽标、头像堆叠、★评分都没
                    有对应字段（SceneActivity 只有自由文本 time，没有
                    startsAt/endsAt/status，也没有 participants 头像或活动评分
                    域），照 GEO-HONEST-001 不画、不猜。"发起新活动"虚线卡复用
                    下面意图卡同一个 onOpenScene 出口，不是死按钮。 */}
                {activityFeed.state === "READY" ? (
                  <ScrollView horizontal contentContainerStyle={styles.eventRail} showsHorizontalScrollIndicator={false}>
                    {activityFeed.items.map((activity) => <View key={activity.activityId} style={styles.eventCard}>
                      <Text selectable numberOfLines={2} style={styles.eventTitle}>{activity.title}</Text>
                      <View style={styles.eventMetaRow}><ProxyIcon color={color.muted} name="clock" size={12} /><Text selectable style={styles.eventMetaText}>{activity.time}</Text></View>
                      <View style={styles.eventMetaRow}><ProxyIcon color={color.muted} name="peoplePair" size={12} /><Text selectable style={styles.eventMetaText}>{activity.people}</Text></View>
                      <Pressable accessibilityLabel={activitySignupLabel(activity)} disabled={!canSignUp(activity) || busy === activity.activityId} onPress={() => { void joinActivity(activity.activityId); }} style={[styles.eventJoin, (!canSignUp(activity) || busy === activity.activityId) && styles.actionButtonBusy]}>
                        <Text selectable style={styles.eventJoinText}>{activitySignupLabel(activity)}</Text>
                      </Pressable>
                    </View>)}
                    {detail && detail.actions.length > 0 ? (
                      <Pressable accessibilityLabel="发起新活动" onPress={() => { if (selected) onOpenScene?.(selected.id); }} style={styles.eventCreateCard}>
                        <Text selectable style={styles.eventCreateText}>+ 发起新活动</Text>
                      </Pressable>
                    ) : null}
                  </ScrollView>
                ) : <Text selectable style={styles.blockEmpty}>{sceneActivityFeedText(activityFeed)}</Text>}
              </View>

              <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>照片墙</Text>
                {/* STORE-SCENE-LINK-001 + SCENE-PHOTO-WALL-002：三层，真实数据
                    优先——认领了这个场景的店铺相册（商家真的传的）+ 帖子墙
                    （用户真的发的）叠加展示；两个都空才回落到 hero/menu 占位图。
                    资产/商家 tile 的 postId 是空串，借它分辨要不要走
                    localNet.resolveMediaUrl（那是帖子媒体资产 id 专用的解析，
                    资产图/商家图早就是现成的绝对 URL，直接用）。 */}
                {(() => {
                  const merchantTiles = sceneMerchantWallTiles(detail?.merchantPhotos, apiBaseUrl);
                  const realTiles = [...merchantTiles, ...wall];
                  const displayTiles = realTiles.length > 0 ? realTiles : sceneAssetWallTiles(detail);
                  if (displayTiles.length === 0) {
                    return <Text selectable style={styles.blockEmpty}>{
                      wallState === "LOADING" ? "正在读取照片墙…"
                        : wallState === "ERROR" ? "照片墙暂时取不到，请稍后重试。"
                          : wallState === "SIGNED_OUT" ? "登录后才能看到这里的照片墙。"
                            : SCENE_PHOTO_WALL_EMPTY
                    }</Text>;
                  }
                  return <View style={styles.wallGrid}>{displayTiles.map((tile) => {
                    const uri = tile.postId ? localNet.resolveMediaUrl(tile.path) : tile.path;
                    return <View key={tile.key} style={styles.wallTile}>
                      {uri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`wall:${tile.key}`} source={{ uri }} style={styles.wallImage} transition={0} /> : null}
                      {tile.author ? <Text selectable numberOfLines={1} style={styles.wallAuthor}>{tile.author}</Text> : null}
                    </View>;
                  })}</View>;
                })()}
              </View>

              {detail && detail.actions.length > 0 ? <View style={styles.block}>
                {/* SCENE-HOME-PROTOTYPE-001：原型把这块叫「你想在这里做什么？」，
                    三张意图卡（想找人一起来？/ 想找人做事？/ 想参加现成的？）+
                    脚注「匹配结果仅供参考，实际约见以双方确认为准」。标题跟着原型
                    改；卡片文案仍来自服务端 detail.actions（label + 状态副标题），
                    不写死。 */}
                <Text selectable style={styles.blockTitle}>你想在这里做什么？</Text>
                {detail.actions.map((action) => <Pressable accessibilityLabel={action.label} key={action.type} onPress={() => { if (selected) onOpenScene?.(selected.id); }} style={styles.actionRow}>
                  <View style={styles.activityCopy}>
                    <Text selectable style={styles.activityTitle}>{action.label}</Text>
                    <Text selectable style={styles.activityMeta}>{sceneActionSubtitle(action)}</Text>
                  </View>
                  <ProxyIcon color={color.muted} name="chevronRight" size={16} />
                </Pressable>)}
              </View> : null}

              {detail ? <Text selectable style={styles.boundary}>{detail.truthBoundary}</Text> : null}
              {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: color.offWhite, flex: 1 },
  scrollBody: { paddingBottom: 40 },
  topbar: { alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  roundButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  topbarTitle: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "900" },
  topbarSpacer: { width: 40 },
  listHead: { paddingBottom: 12, paddingHorizontal: 16 },
  listTitle: { color: color.ink, fontSize: 26, fontWeight: "900", letterSpacing: -0.8 },
  listCount: { color: color.muted, fontSize: 13, fontWeight: "800" },
  listLocation: { color: color.muted, fontSize: 11.5, fontWeight: "700", lineHeight: 17, marginTop: 6 },
  chipBar: { alignItems: "center", gap: 7, paddingBottom: 10, paddingHorizontal: 16 },
  sortChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 7 },
  sortChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  sortChipText: { color: color.muted, fontSize: 12, fontWeight: "800" },
  sortChipTextOn: { color: color.white },
  // SCENE-LOCATION-PICKER-001: 跟 badminton-companion.tsx 的 locationRow 同款——
  // 点开的是共用的 LocationListPicker，不再是一行横滑 chip。
  locationRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 12, marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 11 },
  locationText: { color: color.ink, flex: 1, fontSize: 12.5, fontWeight: "800" },
  locationMore: { color: color.muted, fontSize: 11.5, fontWeight: "800" },
  empty: { color: color.muted, fontSize: 13, lineHeight: 20, paddingHorizontal: 16, paddingVertical: 22 },
  cardList: { gap: 10, paddingHorizontal: 16 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 11 },
  cardPhoto: { borderRadius: 13, height: 112, overflow: "hidden", position: "relative", width: 96 },
  cardImage: { backgroundColor: color.surface, height: "100%", width: "100%" },
  liveDot: { backgroundColor: color.mint, borderRadius: 4, height: 8, position: "absolute", right: 6, top: 6, width: 8 },
  // SCENE-CATEGORY-BADGE-001：封面左上角分类角标。mint 底白字、绝对定位、
  // 跟 liveDot 共享 112pt 高的封面（top:6 距顶边），左缘跟卡片内边距对齐。
  coverBadge: { backgroundColor: color.mint, borderRadius: 5, left: 6, paddingHorizontal: 6, paddingVertical: 2, position: "absolute", top: 6 },
  coverBadgeText: { color: color.white, fontSize: 11, fontWeight: "900", letterSpacing: 0.2 },
  cardDistanceBadge: { backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 5, bottom: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, position: "absolute" },
  cardDistanceText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  photoPlaceholderText: { color: color.muted, fontSize: 15, fontWeight: "900" },
  heroPlaceholderText: { color: "rgba(255,255,255,0.5)", fontSize: 30, fontWeight: "900" },
  cardAddress: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 5 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  cardName: { color: color.ink, flex: 1, fontSize: 14.5, fontWeight: "900" },
  heart: { paddingHorizontal: 2 },
  cardSignal: { color: color.muted, fontSize: 11, fontWeight: "800", marginTop: 6 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  tag: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  // SCENE-RATING-CHIP-001: 跟运动卡 rideTagGold / rideTagLime 用同一对 token，
  // 保证「★ 评分」和「城市」在两张卡上是同一个颜色，不是各挑一个近似色。
  tagRating: { backgroundColor: color.warn },
  tagRatingText: { color: color.ink },
  tagArea: { backgroundColor: color.stateInfoBg },
  tagAreaText: { color: color.ink },
  tagLive: { backgroundColor: color.factConfirmedBg },
  tagLiveText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "900" },
  cardFoot: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 9, paddingTop: 8 },
  cardFootText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  wallGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 10 },
  wallTile: { aspectRatio: 1, backgroundColor: color.surface, borderRadius: 10, overflow: "hidden", width: "32.4%" },
  wallImage: { height: "100%", width: "100%" },
  wallAuthor: { backgroundColor: "rgba(0,0,0,0.45)", bottom: 0, color: color.white, fontSize: 11, fontWeight: "800", left: 0, paddingHorizontal: 6, paddingVertical: 2, position: "absolute", right: 0 },
  listEnd: { color: color.muted, fontSize: 11, fontWeight: "800", paddingTop: 22, textAlign: "center" },
  notice: { color: color.ink, fontSize: 12, fontWeight: "700", lineHeight: 18, paddingHorizontal: 16, paddingTop: 14 },
  hero: { backgroundColor: color.ink, height: 300, overflow: "hidden", position: "relative" },
  heroImage: { backgroundColor: color.deep, height: "100%", width: "100%" },
  heroTopbar: { flexDirection: "row", justifyContent: "space-between", left: 0, paddingHorizontal: 16, paddingTop: 10, position: "absolute", right: 0, top: 0 },
  heroRight: { flexDirection: "row", gap: 8 },
  heroRound: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  heroRoundText: { color: color.white, fontSize: 18, fontWeight: "900", lineHeight: 20 },
  heroRoundTextOn: { color: color.magenta },
  heroCopy: { bottom: 18, left: 16, position: "absolute", right: 16 },
  heroShade: { backgroundColor: "rgba(0,0,0,0.28)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  heroTitle: { color: color.white, fontSize: 29, fontWeight: "900", letterSpacing: -0.9, marginBottom: 6 },
  heroAddress: { color: "rgba(255,255,255,0.88)", fontSize: 12, fontWeight: "700", lineHeight: 17, marginBottom: 10 },
  heroTags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  heroTag: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  heroTagText: { color: color.white, fontSize: 11, fontWeight: "800" },
  detailBody: { paddingHorizontal: 16, paddingTop: 14 },
  address: { color: color.muted, fontSize: 11.5, fontWeight: "700", lineHeight: 17 },
  infoStrip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", marginTop: 12, paddingVertical: 14 },
  infoCell: { alignItems: "center", flex: 1, paddingHorizontal: 6 },
  infoValue: { color: color.ink, fontSize: 14, fontWeight: "900" },
  infoLabel: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 4, textAlign: "center" },
  // SCENE-HOME-PROTOTYPE-001：原型 action-row3 —— 三颗等宽按钮，收藏(rose)/
// 打卡(ink)/导航(白底)。收藏与打卡都有"已..."的落地态，跟原型 toggleSave /
// doCheckin 一致。
actionRow3: { flexDirection: "row", gap: 8, marginTop: 14 },
  actSave: { alignItems: "center", backgroundColor: color.attentionBg, borderColor: color.attentionBorder, borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 14 },
  actSaveOn: { backgroundColor: color.magenta, borderColor: color.magenta },
  actSaveText: { color: color.magenta, fontSize: 12.5, fontWeight: "900" },
  actSaveTextOn: { color: color.white },
  actCheckin: { alignItems: "center", backgroundColor: color.ink, borderColor: color.ink, borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 14 },
  // 已打卡：原型把按钮翻成 --good 绿底白字（doCheckin 里 btn.style.background）。
  actCheckinOn: { backgroundColor: color.mint, borderColor: color.mint },
  actCheckinText: { color: color.white, fontSize: 12.5, fontWeight: "900" },
  actNav: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 14 },
  actNavText: { color: color.ink, fontSize: 12.5, fontWeight: "900" },
  // 原型 dist-bar：软底圆角一行，距离 + 100 米自动打卡说明。
  distBar: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, flexDirection: "row", gap: 9, marginTop: 10, paddingHorizontal: 14, paddingVertical: 11 },
  distBarText: { color: color.muted, flex: 1, fontSize: 11.5, fontWeight: "700", lineHeight: 16 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  actionButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flex: 1, paddingVertical: 15 },
  actionButtonOn: { backgroundColor: color.ink, borderColor: color.ink },
  actionButtonBusy: { opacity: 0.45 },
  actionText: { color: color.ink, fontSize: 12.5, fontWeight: "900" },
  actionTextOn: { color: color.white },
  checkinHint: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  primaryAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 15, marginTop: 14, paddingVertical: 14 },
  primaryActionText: { color: color.white, fontSize: 13.5, fontWeight: "900" },
  primaryActionSub: { color: color.darkCardText, fontSize: 11, fontWeight: "700", marginTop: 4 },
  block: { marginTop: 22 },
  blockTitle: { color: color.ink, fontSize: 14.5, fontWeight: "900", marginBottom: 10 },
  blockEmpty: { color: color.muted, fontSize: 12, lineHeight: 18 },
  // SCENE-HOME-DETAIL-001：「现在最适合」两张卡（左 variant.bestFor，右 liveState）。
  bestGrid: { flexDirection: "row", gap: 8 },
  bestCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, padding: 12 },
  bestCardTitle: { color: color.ink, fontSize: 13, fontWeight: "900", lineHeight: 18 },
  bestCardSub: { color: color.muted, fontSize: 11, fontWeight: "700", lineHeight: 15, marginTop: 6 },
  // SCENE-HOME-DETAIL-001：「适合一起的人」—— 头像横滑，跟运动卡同款圆头像
  // 放大（64），名字 + 可约状态居中跟在下面。
  humanRail: { gap: 12, paddingRight: 16 },
  humanPlain: { alignItems: "center", width: 80 },
  humanRing: { alignItems: "center", backgroundColor: color.factInferredBg, borderColor: color.line, borderRadius: 32, borderWidth: 2, height: 64, justifyContent: "center", overflow: "hidden", width: 64 },
  humanAvatarImage: { height: 60, width: 60 },
  humanAvatarFallback: { alignItems: "center", backgroundColor: color.factInferredBg, borderRadius: 30, height: 60, justifyContent: "center", width: 60 },
  humanAvatarText: { color: color.factInferredFg, fontSize: 22, fontWeight: "900" },
  humanPlainName: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 6, textAlign: "center" },
  humanPlainSub: { color: color.muted, fontSize: 11, fontWeight: "700", lineHeight: 14, marginTop: 2, textAlign: "center" },
  // SCENE-HOME-DETAIL-001：「这个 Scene 喝什么」菜单横滑卡片。
  menuRail: { gap: 8, paddingRight: 16 },
  menuCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 8, width: 132 },
  menuImage: { backgroundColor: color.surface, borderRadius: 10, height: 92, marginBottom: 6, width: "100%" },
  menuName: { color: color.ink, fontSize: 12, fontWeight: "900" },
  menuFit: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },
  menuPrice: { color: color.ink, fontSize: 12, fontWeight: "900", marginTop: 4 },
  // UI-COPY-HONEST-001：intentFootnote / intentFootnoteText 已删 —— 那条免责脚注
  // （「匹配结果仅供参考，实际约见以双方确认为准」）原型里根本没有（docs/design/references
  // 全仓搜不到），是实现自己加的免责套话，对所有场景都一样、没有信息量。样式随之删除。
  // SCENE-HOME-PROTOTYPE-001：原型 match-card —— 深色圆角卡，金底「匹配推荐」
  // 小标签 + 大标题 + 副题；头像是亮环（暗底上用白/亮字）。
  matchCard: { backgroundColor: color.deep, borderRadius: 20, marginTop: 22, overflow: "hidden", padding: 16 },
  matchLabel: { alignSelf: "flex-start", backgroundColor: "rgba(245,180,0,0.18)", borderRadius: 6, marginBottom: 12, paddingHorizontal: 9, paddingVertical: 4 },
  matchLabelText: { color: "#F5C842", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  matchTitle: { color: color.white, fontSize: 17, fontWeight: "900", letterSpacing: -0.3, lineHeight: 23, marginBottom: 5 },
  matchSub: { color: color.darkCardText, fontSize: 11.5, fontWeight: "700", lineHeight: 17, marginBottom: 14 },
  // 暗底上的亮字版（humanPlainName / humanPlainSub 是给浅色底用的）。
  humanPlainNameLight: { color: color.white, fontSize: 12, fontWeight: "800", marginTop: 6, textAlign: "center" },
  humanPlainSubLight: { color: color.darkCardText, fontSize: 11, fontWeight: "700", lineHeight: 14, marginTop: 2, textAlign: "center" },
  personRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  person: { alignItems: "center", width: 76 },
  personAvatar: { alignItems: "center", backgroundColor: color.factInferredBg, borderRadius: 30, height: 60, justifyContent: "center", width: 60 },
  personAvatarText: { color: color.factInferredFg, fontSize: 22, fontWeight: "900" },
  personName: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 6, textAlign: "center" },
  activityRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  activityCopy: { flex: 1, minWidth: 0 },
  activityTitle: { color: color.ink, fontSize: 12.5, fontWeight: "900", lineHeight: 17 },
  activityMeta: { color: color.muted, fontSize: 11, fontWeight: "700", lineHeight: 15, marginTop: 3 },
  activityJoin: { backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  activityJoinText: { color: color.white, fontSize: 11.5, fontWeight: "900" },
  // SCENE-HOME-PROTOTYPE-001：原型 event-scroll 的横滑事件卡。
  eventRail: { gap: 10, paddingVertical: 2 },
  eventCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 6, padding: 12, width: 176 },
  eventTitle: { color: color.ink, fontSize: 12.5, fontWeight: "900", lineHeight: 17, minHeight: 34 },
  eventMetaRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  eventMetaText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  eventJoin: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, marginTop: 4, paddingVertical: 8 },
  eventJoinText: { color: color.white, fontSize: 11, fontWeight: "900" },
  eventCreateCard: { alignItems: "center", borderColor: color.line, borderRadius: 16, borderStyle: "dashed", borderWidth: 1, justifyContent: "center", minHeight: 120, width: 120 },
  eventCreateText: { color: color.muted, fontSize: 12, fontWeight: "800", textAlign: "center" },
  actionRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  boundary: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 20 },
});

// SCENE-SHOP-DIRECTORY-001（2026-09-24，原型 deepseek_html_20260924_412dba
// 「Scene · 精修版」第 2/3 屏）：分类列表页 + 单店详情页。
//
// 首页那张分类入口卡点进来就是这一屏：先是一页按分类收窄的真实场景列表，
// 再点进去是单个场景的详情。两屏共用一个全屏 Modal（原型也是一路 push，
// 返回逐层收），所以内部用 mode 切，而不是两个 Modal 叠着。
//
// ⚠️ 原型上有、这一屏**故意没有**的东西（都有原因，别当成漏做）：
//   · 评分（`4.8 ★` / `212 条评分`）—— 全仓没有评价域，`reality.scenes`
//     也没有评分列。SCENE-NO-FABRICATED-001 删掉的「Scene Quality 93」就是
//     这一类写死的数。
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
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { sendSceneCommand, type AuthenticatedStoredSession } from "../scene-commands";
import {
  availableShopSorts, sceneDistanceMeters, shopAreaFacets, shopCardSignal,
  shopCountText, shopDetailTags, shopDirectoryRows, shopHereLine, shopInfoCells, shopListEndText,
  shopAddressLine, shopCardDistance, shopHeroDistanceSuffix, shopListLocationLine, isFarAway, sceneActionSubtitle,
  type SceneOrigin, type SceneShopBrief, type ShopSortId,
} from "../scene-shop-directory";

// SCENE-SHOP-DETAIL-001：详情只读我们需要的那几项 —— 这一屏不做菜单/变体/
// 徽章/Studio，所以不把整个 SceneDetail 的形状抄过来（抄了就得跟着服务端
// 一起改）。只认下面这几个字段，缺哪项就少画哪块。
type ShopDetail = {
  sceneId: string;
  venueName: string;
  heroImageUrl: string;
  logoUrl?: string | undefined;
  actions: ReadonlyArray<{ type: string; label: string; state: string; moneyMeaning: string }>;
  aiVisits?: ReadonlyArray<{ personaId: string; displayName: string }> | undefined;
  truthBoundary: string;
};

function isShopDetail(value: unknown): value is ShopDetail {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Record<keyof ShopDetail, unknown>>;
  if (typeof item.sceneId !== "string" || typeof item.venueName !== "string" || typeof item.heroImageUrl !== "string") return false;
  if (item.logoUrl !== undefined && typeof item.logoUrl !== "string") return false;
  if (item.truthBoundary !== undefined && typeof item.truthBoundary !== "string") return false;
  if (!Array.isArray(item.actions)) return false;
  return item.actions.every((action) => action && typeof action === "object"
    && typeof (action as { label?: unknown }).label === "string"
    && typeof (action as { state?: unknown }).state === "string"
    && typeof (action as { moneyMeaning?: unknown }).moneyMeaning === "string");
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
  const infoCells = selected ? shopInfoCells(selected, origin) : [];
  // 详情大图优先用服务端的 heroImageUrl（MEDIA-VERSION 会随媒体变），拿不到
  // 才退回目录里的 imageUrl。两个都没有就是灰底 —— 不编一张占位图。
  const heroUri = detail?.heroImageUrl || (selected ? absoluteNetworkURL(apiBaseUrl ?? "", selected.imageUrl) : undefined);

  return (
    <Modal animationType="slide" onRequestClose={() => (selectedId ? setSelectedId(undefined) : onClose())} visible>
      <View style={[styles.page, { paddingTop: safeArea.top }]}>
        {selectedId === undefined ? (
          <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
            <View style={styles.topbar}>
              <Pressable accessibilityLabel="返回" hitSlop={8} onPress={onClose} style={styles.roundButton}><Text selectable style={styles.roundButtonText}>‹</Text></Pressable>
              <Text selectable style={styles.topbarTitle}>{label}</Text>
              <View style={styles.topbarSpacer} />
            </View>

            <View style={styles.listHead}>
              <Text selectable style={styles.listTitle}>{`附近${label}`}<Text selectable style={styles.listCount}>{`  ${shopCountText(rows.length, unit)}`}</Text></Text>
              <Text selectable style={styles.listLocation}>{shopListLocationLine(origin !== undefined, rows.map((row) => row.area), rows.length > 0 && rows.every((row) => isFarAway(sceneDistanceMeters(origin, row))))}</Text>
            </View>

            {/* 排序/筛选条：只放这一趟真的能用的项。没有定位就不给「最近」；
                只有唯一区域就不给筛选条 —— 点了没反应的 chip 是死按钮。 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
              {sorts.map((sort) => (
                <Pressable accessibilityLabel={`排序 ${sort.label}`} key={sort.id} onPress={() => setSortId(sort.id)} style={[styles.sortChip, sortId === sort.id && styles.sortChipOn]}>
                  <Text selectable style={[styles.sortChipText, sortId === sort.id && styles.sortChipTextOn]}>{sort.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {facets.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
              {facets.map((area) => (
                <Pressable accessibilityLabel={`筛选 ${area}`} key={area} onPress={() => toggleArea(area)} style={[styles.filterChip, areas.includes(area) && styles.filterChipOn]}>
                  <Text selectable style={[styles.filterChipText, areas.includes(area) && styles.filterChipTextOn]}>{areas.includes(area) ? `${area} ×` : area}</Text>
                </Pressable>
              ))}
            </ScrollView> : null}

            {catalogState === "ERROR" ? <Text selectable style={styles.empty}>场景目录暂时取不到，请稍后重试。</Text>
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
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.cardTitleRow}>
                          <Text selectable numberOfLines={1} style={styles.cardName}>{scene.name}</Text>
                          <Pressable accessibilityLabel={saved.has(scene.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => { void toggleSaved(scene); }} style={styles.heart}><Text selectable style={[styles.heartText, saved.has(scene.id) && styles.heartTextOn]}>{saved.has(scene.id) ? "♥" : "♡"}</Text></Pressable>
                        </View>
                        {signal || distance ? <Text selectable style={styles.cardSignal}>{[signal, distance].filter(Boolean).join(" · ")}</Text> : null}
                        {address ? <Text selectable numberOfLines={1} style={styles.cardAddress}>{`📍 ${address}`}</Text> : null}
                        <View style={styles.tagRow}>{shopDetailTags(scene).map((tag) => <View key={tag} style={styles.tag}><Text selectable style={styles.tagText}>{tag}</Text></View>)}</View>
                        <View style={styles.cardFoot}>
                          <Text selectable style={styles.cardFootText}>{shopHereLine(scene.hereCount)}</Text>
                          <Text selectable style={styles.cardChevron}>›</Text>
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
                <Pressable accessibilityLabel="返回" hitSlop={8} onPress={() => setSelectedId(undefined)} style={styles.heroRound}><Text selectable style={styles.heroRoundText}>‹</Text></Pressable>
                <View style={styles.heroRight}>
                  <Pressable accessibilityLabel="分享" hitSlop={8} onPress={() => { if (selected) void shareScene(selected); }} style={styles.heroRound}><Text selectable style={styles.heroRoundText}>↑</Text></Pressable>
                  <Pressable accessibilityLabel={selected && saved.has(selected.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => { if (selected) void toggleSaved(selected); }} style={styles.heroRound}><Text selectable style={[styles.heroRoundText, selected && saved.has(selected.id) && styles.heroRoundTextOn]}>{selected && saved.has(selected.id) ? "♥" : "♡"}</Text></Pressable>
                </View>
              </View>
              <View style={styles.heroCopy}>
                <Text selectable style={styles.heroTitle}>{detail?.venueName ?? selected?.name ?? ""}</Text>
                {selected && shopAddressLine(selected) ? <Text selectable numberOfLines={2} style={styles.heroAddress}>{`📍 ${shopAddressLine(selected)}${shopHeroDistanceSuffix(sceneDistanceMeters(origin, selected))}`}</Text> : null}
                <View style={styles.heroTags}>
                  {hereChecked ? <View style={[styles.tag, styles.tagLive]}><Text selectable style={styles.tagLiveText}>我在这里</Text></View> : null}
                  {detailTags.map((tag) => <View key={tag} style={styles.heroTag}><Text selectable style={styles.heroTagText}>{tag}</Text></View>)}
                </View>
              </View>
            </View>

            <View style={styles.detailBody}>
              {/* 来源角标只给社区提交的（坐标未核实，用户该知道）；「坐标来源未知」是内部数据状态，不给用户看。 */}
              {selected?.source === "COMMUNITY" ? <Text selectable style={styles.address}>{`${sceneAddressLine(selected)}${sceneSourceSuffix(selected.source)}`}</Text> : null}

              {infoCells.length > 0 ? <View style={styles.infoStrip}>{infoCells.map((cell) => <View key={cell.label} style={styles.infoCell}><Text selectable style={styles.infoValue}>{cell.value}</Text><Text selectable style={styles.infoLabel}>{cell.label}</Text></View>)}</View> : null}

              {detailState === "ERROR" ? <Text selectable style={styles.empty}>这个场景的详情暂时取不到，稍后再试。</Text> : null}

              {/* 能真做的两件事：导航（系统地图深链）和打卡（100 米门禁）。 */}
              <View style={styles.actions}>
                <Pressable accessibilityLabel="导航到这里" onPress={() => { if (selected) openNavigation(selected); }} style={styles.actionButton}><Text selectable style={styles.actionText}>导航到这里</Text></Pressable>
                <Pressable accessibilityLabel="我在这里" disabled={busy === "checkin" || !selected} onPress={() => { if (selected) void persistCheckIn(selected, !hereChecked); }} style={[styles.actionButton, hereChecked && styles.actionButtonOn, (busy === "checkin" || !selected) && styles.actionButtonBusy]}><Text selectable style={[styles.actionText, hereChecked && styles.actionTextOn]}>{hereChecked ? "取消打卡" : "我在这里"}</Text></Pressable>
              </View>
              <Text selectable style={styles.checkinHint}>{checkinHint(hereChecked, checkinDistance)}</Text>

              {/* 邀约那条链路要选人 + 填报酬 + 两步命令 —— 复制一份就是第二个
                  真相，所以转交给场景自己的那一屏去做。 */}
              <Pressable accessibilityLabel="让小美来这个场景" disabled={!selected || !onOpenScene} onPress={() => { if (selected) onOpenScene?.(selected.id); }} style={[styles.primaryAction, (!selected || !onOpenScene) && styles.actionButtonBusy]}>
                <Text selectable style={styles.primaryActionText}>让小美来这个场景</Text>
                <Text selectable style={styles.primaryActionSub}>约她出图 / 同行 · 选人、时间、报酬在场景页里定</Text>
              </Pressable>

              {detail && detail.aiVisits && detail.aiVisits.length > 0 ? <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>绑定这个场景的小美</Text>
                <View style={styles.personRow}>{detail.aiVisits.map((visit) => <View key={visit.personaId} style={styles.person}>
                  <View style={styles.personAvatar}><Text selectable style={styles.personAvatarText}>{visit.displayName.slice(0, 1).toUpperCase()}</Text></View>
                  <Text selectable numberOfLines={1} style={styles.personName}>{visit.displayName}</Text>
                </View>)}</View>
              </View> : null}

              <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>这里的活动</Text>
                {activityFeed.state === "READY" ? activityFeed.items.map((activity) => <View key={activity.activityId} style={styles.activityRow}>
                  <View style={styles.activityCopy}>
                    <Text selectable style={styles.activityTitle}>{activity.title}</Text>
                    <Text selectable style={styles.activityMeta}>{`${activity.time} · ${activity.people}`}</Text>
                  </View>
                  <Pressable accessibilityLabel={activitySignupLabel(activity)} disabled={!canSignUp(activity) || busy === activity.activityId} onPress={() => { void joinActivity(activity.activityId); }} style={[styles.activityJoin, (!canSignUp(activity) || busy === activity.activityId) && styles.actionButtonBusy]}>
                    <Text selectable style={styles.activityJoinText}>{activitySignupLabel(activity)}</Text>
                  </Pressable>
                </View>) : <Text selectable style={styles.blockEmpty}>{sceneActivityFeedText(activityFeed)}</Text>}
              </View>

              {detail && detail.actions.length > 0 ? <View style={styles.block}>
                <Text selectable style={styles.blockTitle}>这里能做的事</Text>
                {detail.actions.map((action) => <Pressable accessibilityLabel={action.label} key={action.type} onPress={() => { if (selected) onOpenScene?.(selected.id); }} style={styles.actionRow}>
                  <View style={styles.activityCopy}>
                    <Text selectable style={styles.activityTitle}>{action.label}</Text>
                    <Text selectable style={styles.activityMeta}>{sceneActionSubtitle(action)}</Text>
                  </View>
                  <Text selectable style={styles.cardChevron}>›</Text>
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
  roundButtonText: { color: color.ink, fontSize: 22, fontWeight: "800", lineHeight: 24 },
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
  filterChip: { backgroundColor: color.surface, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipOn: { backgroundColor: color.factInferredBg },
  filterChipText: { color: color.ink, fontSize: 11.5, fontWeight: "800" },
  filterChipTextOn: { color: color.factInferredFg },
  empty: { color: color.muted, fontSize: 13, lineHeight: 20, paddingHorizontal: 16, paddingVertical: 22 },
  cardList: { gap: 10, paddingHorizontal: 16 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, padding: 11 },
  cardPhoto: { borderRadius: 13, height: 112, overflow: "hidden", position: "relative", width: 96 },
  cardImage: { backgroundColor: color.surface, height: "100%", width: "100%" },
  liveDot: { backgroundColor: color.mint, borderRadius: 4, height: 8, position: "absolute", right: 6, top: 6, width: 8 },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  photoPlaceholderText: { color: color.muted, fontSize: 15, fontWeight: "900" },
  heroPlaceholderText: { color: "rgba(255,255,255,0.5)", fontSize: 30, fontWeight: "900" },
  cardAddress: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 5 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  cardName: { color: color.ink, flex: 1, fontSize: 14.5, fontWeight: "900" },
  heart: { paddingHorizontal: 2 },
  heartText: { color: color.muted, fontSize: 16, lineHeight: 18 },
  heartTextOn: { color: color.magenta },
  cardSignal: { color: color.muted, fontSize: 11, fontWeight: "800", marginTop: 6 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  tag: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  tagLive: { backgroundColor: color.factConfirmedBg },
  tagLiveText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "900" },
  cardFoot: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 9, paddingTop: 8 },
  cardFootText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  cardChevron: { color: color.muted, fontSize: 16 },
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
  actionRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  boundary: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 20 },
});

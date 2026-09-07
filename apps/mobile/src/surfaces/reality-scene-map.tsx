import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import { ProxyIcon } from "../components/proxy-icon";
import { color } from "../theme";
import type { SessionAuthClient } from "../auth-client";
import type { SecureSessionStore, StoredSession } from "../secure-session";
import { parseCommandResult } from "../login-client";
import type { PlatformAIAccount } from "../ai-account-client";
import { aiAccountPhoto } from "../ai-persona-presentation";

type SceneFilter = "ALL" | "UNSEEN" | "ACTIVE" | "SAVED" | "VISITED";
type SceneView = "MAP" | "LIST";
type AuthenticatedStoredSession = StoredSession & { principal: NonNullable<StoredSession["principal"]> };

type RealityScene = {
  id: string;
  name: string;
  area: string;
  type: string;
  latitude: number;
  longitude: number;
  quality: number;
  best: string;
  posts: number;
  creators: number;
  activities: number;
  invites: number;
  active: boolean;
  description: string;
  distanceMeters?: number;
  recommendationScore?: number;
};

type DynamicSceneAction = { type: "DIRECT_INVITE" | "OPEN_TASK" | "PUBLIC_ACTIVITY"; label: string; state: string; moneyMeaning: string };
type SceneDetail = {
  sceneId: string;
  venueId: string;
  venueName: string;
  heroImageUrl: string;
  mediaVersion: number;
  selectedVariant: string;
  variants: Array<{ id: string; name: string; window: string; facets: string[]; bestFor: string }>;
  liveState: { state: string; label: string; bestWindow: string; capacityPct: number; freshUntil: string };
  menu: Array<{ id: string; name: string; priceLabel: string; sceneFit: string; available: boolean; imageUrl: string }>;
  fullMenu: Array<{ id: string; name: string; priceLabel: string; sceneFit: string; available: boolean; imageUrl: string }>;
  humans: Array<{ id: string; name: string; role: string; availability: string; fitReason: string; sceneFit: number; isAI: boolean; avatarUrl: string }>;
  actions: DynamicSceneAction[];
  truthBoundary: string;
};

type FeaturedHuman = { userId: string; name: string; city?: string | undefined; avatarUri?: string | undefined };

export function RealitySceneMapSurface({ apiBaseUrl, authClient, featuredAIAccount, featuredHuman, initialSceneId, secureSessionStore, onBack, onOpenAIProfile, onOpenHumanProfile }: { apiBaseUrl: string; authClient: SessionAuthClient; featuredAIAccount?: PlatformAIAccount | undefined; featuredHuman?: FeaturedHuman | undefined; initialSceneId?: string | undefined; secureSessionStore?: SecureSessionStore | undefined; onBack: () => void; onOpenAIProfile?: (account: PlatformAIAccount) => void; onOpenHumanProfile?: (person: FeaturedHuman) => void }): React.JSX.Element {
  const [view, setView] = useState<SceneView>("MAP");
  const [filter, setFilter] = useState<SceneFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSceneId);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [visitedAt, setVisitedAt] = useState<ReadonlyMap<string, string>>(new Map());
  const [planned, setPlanned] = useState<ReadonlySet<string>>(new Set());
  const [scenes, setScenes] = useState<ReadonlyArray<RealityScene>>([]);
  const [session, setSession] = useState<AuthenticatedStoredSession>();
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number }>();
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearbyError, setNearbyError] = useState<string>();
  const [detail, setDetail] = useState<SceneDetail>();
  const [detailError, setDetailError] = useState<string>();
  const [actionExplanation, setActionExplanation] = useState<string>();
  const [selectedAction, setSelectedAction] = useState<DynamicSceneAction>();
  const [selectedHumanId, setSelectedHumanId] = useState<string>();
  const [selectedMenuId, setSelectedMenuId] = useState<string>();
  const [fullMenuOpen, setFullMenuOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/reality-scenes`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Proxy-App-Version": "1.0.0" }
    }).then(async (response) => {
      if (!response.ok) throw new Error(`scene catalog status ${response.status}`);
      const body = await response.json() as { scenes?: unknown };
      if (!Array.isArray(body.scenes) || body.scenes.length === 0) throw new Error("scene catalog malformed");
      const valid = body.scenes.filter(isRealityScene);
      if (valid.length !== body.scenes.length) throw new Error("scene catalog contained invalid records");
      if (!cancelled) setScenes(valid);
    }).catch(() => {
      // Keep the last-known launch projection during an outage. Server data wins
      // as soon as it validates; malformed partial responses never replace it.
    });
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!secureSessionStore) return;
    void secureSessionStore.read().then(async (nextSession) => {
      if (cancelled || !nextSession?.principal) return;
      const authenticated = nextSession as AuthenticatedStoredSession;
      setSession(authenticated);
      const payload = await sendSceneCommand(authClient, authenticated, "ListMyRealitySceneState", "me", {});
      if (cancelled) return;
      const states = Array.isArray(payload.states) ? payload.states : [];
      setSaved(new Set(states.filter((item) => isUserSceneState(item) && item.saved).map((item) => (item as { sceneId: string }).sceneId)));
      setPlanned(new Set(states.filter((item) => isUserSceneState(item) && item.planned).map((item) => (item as { sceneId: string }).sceneId)));
      setVisited(new Set(states.filter((item) => isUserSceneState(item) && item.privateVisited).map((item) => (item as { sceneId: string }).sceneId)));
      setVisitedAt(new Map(states.filter((item) => isUserSceneState(item) && item.privateVisited && typeof item.visitedAt === "string").map((item) => [item.sceneId, item.visitedAt as string])));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [authClient, secureSessionStore]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setDetail(undefined); setDetailError(undefined); return; }
    setDetail(undefined); setDetailError(undefined); setActionExplanation(undefined); setSelectedAction(undefined); setActionResult(undefined); setFullMenuOpen(false); setWhyOpen(false);
    const variant = featuredAIAccount?.boundSceneId === selectedId ? featuredAIAccount.boundSceneVariant : undefined;
    const suffix = variant ? `?variant=${encodeURIComponent(variant)}` : "";
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/scenes/${encodeURIComponent(selectedId)}${suffix}`, { headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error(`status ${response.status}`); return response.json(); })
      .then((value: unknown) => { if (!isSceneDetail(value)) throw new Error("malformed"); if (!cancelled) { setDetail(value); setSelectedHumanId(value.humans[0]?.id); setSelectedMenuId(value.menu[0]?.id); } })
      .catch(() => { if (!cancelled) setDetailError("动态场景暂时不可用，请稍后重试"); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, featuredAIAccount, selectedId]);

  const selectVariant = (variantId: string): void => {
    if (!selectedId) return;
    setDetailError(undefined); setActionExplanation(undefined);
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/scenes/${encodeURIComponent(selectedId)}?variant=${encodeURIComponent(variantId)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error(`status ${response.status}`); return response.json(); })
      .then((value: unknown) => { if (!isSceneDetail(value)) throw new Error("malformed"); setDetail(value); setSelectedHumanId(value.humans[0]?.id); setSelectedMenuId(value.menu[0]?.id); setFullMenuOpen(false); setWhyOpen(false); })
      .catch(() => setDetailError("场景切换失败，请重试"));
  };

  const commitSceneAction = async (): Promise<void> => {
    if (!detail || !selected || !selectedAction || actionBusy) return;
    if (!secureSessionStore || !session) { setActionResult("请先登录，再确认现实行动"); return; }
    setActionBusy(true); setActionResult(undefined);
    try {
      const variant = detail.variants.find((item) => item.id === detail.selectedVariant) ?? detail.variants[0]!;
      const selectedMenuItem = detail.menu.find((item) => item.id === selectedMenuId);
      if (selectedAction.type === "DIRECT_INVITE") {
        const human = detail.humans.find((item) => item.id === selectedHumanId);
        if (!human) throw new Error("请先选择要邀请的真人");
        const menuItem = detail.menu.find((item) => item.id === selectedMenuId);
        const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const created = await sendSceneCommand(authClient, session, "CreateScene", "new", { tool: "DIRECT_INVITE", intent: `${variant.name} · ${variant.bestFor}`, participation: "双人见面 · 需双方确认", cost: "各自消费", startsAt });
        const sceneId = typeof created.aggregateId === "string" ? created.aggregateId : undefined;
        if (!sceneId) throw new Error("场景创建失败");
        const invitation = await sendSceneCommand(authClient, session, "CreateInvitation", sceneId, { sceneId, inviteeUserId: human.id, card: { what: variant.bestFor, where: detail.venueName, when: `${variant.window}（双方可在聊天中修改）`, who: human.name, hostLabel: "你", menuItemId: menuItem?.id, menuItemName: menuItem?.name } });
        setActionResult(`邀请已发送给 ${human.name}${menuItem ? ` · ${menuItem.name}` : ""} · 状态 ${String(invitation.aggregateState ?? "PENDING")} · 尚未生成订单`);
      } else if (selectedAction.type === "OPEN_TASK") {
        const result = await sendSceneCommand(authClient, session, "PublishMarketOpportunity", "new", { title: `${variant.name} · ${variant.bestFor}`, shortTitle: variant.name, theme: variant.facets.join(" / "), date: "近期", time: variant.window, location: detail.venueName, price: "150K", moneyFlow: "EARN", skills: "Scene fit / UGC", lens: ["NOW", "NEARBY"], menuItemId: selectedMenuItem?.id, menuItemName: selectedMenuItem?.name });
        setActionResult(`机会 ${String(result.aggregateId ?? "")} 已发布 · 150K 是完成者可获得的报酬 · 等待候选申请`);
      } else {
        const result = await sendSceneCommand(authClient, session, "PublishActivity", "new", { title: `${variant.name} · ${variant.bestFor}`, time: variant.window, capacity: 8, venueName: detail.venueName, venueIcon: "coffee", venueType: "CAFE", realitySceneId: detail.sceneId, desc: `${variant.facets.join(" · ")}。报名不等于到场。`, consumptionTerm: "SPLIT", menuItemId: selectedMenuItem?.id, menuItemName: selectedMenuItem?.name });
        setActionResult(`活动 ${String(result.aggregateId ?? "")} 已发布 · 免费报名、到店消费各自承担 · 已进入“我的活动”`);
      }
    } catch (error) { setActionResult(error instanceof Error ? error.message : "操作失败，请重试"); }
    finally { setActionBusy(false); }
  };

  const selected = scenes.find((scene) => scene.id === selectedId);
  const filtered = useMemo(() => {
    const matching = scenes.filter((scene) => {
    const term = query.trim().toLocaleLowerCase();
    if (term && !`${scene.name} ${scene.area} ${scene.type}`.toLocaleLowerCase().includes(term)) return false;
    if (filter === "ACTIVE") return scene.active;
    if (filter === "SAVED") return saved.has(scene.id);
    if (filter === "VISITED") return visited.has(scene.id);
    if (filter === "UNSEEN") return !visited.has(scene.id);
    return true;
    });
    if (filter === "VISITED") matching.sort((a, b) => Date.parse(visitedAt.get(b.id) ?? "") - Date.parse(visitedAt.get(a.id) ?? ""));
    return matching;
  }, [filter, query, saved, scenes, visited, visitedAt]);

  const toggle = (source: ReadonlySet<string>, id: string, commit: (next: ReadonlySet<string>) => void): void => {
    const next = new Set(source);
    if (next.has(id)) next.delete(id); else next.add(id);
    commit(next);
  };
  const persistToggle = (source: ReadonlySet<string>, id: string, commit: (next: ReadonlySet<string>) => void, commandType: string): void => {
    if (!session?.principal) return;
    const enabled = !source.has(id);
    toggle(source, id, commit);
    void sendSceneCommand(authClient, session, commandType, id, { sceneId: id, enabled }).catch(() => commit(source));
  };
  const persistVisited = (id: string): void => {
    if (!session?.principal) return;
    const enabled = !visited.has(id); const previousVisited = visited; const previousTimes = visitedAt;
    toggle(visited, id, setVisited);
    const nextTimes = new Map(visitedAt); if (enabled) nextTimes.set(id, new Date().toISOString()); else nextTimes.delete(id); setVisitedAt(nextTimes);
    void sendSceneCommand(authClient, session, "SetPrivateRealitySceneVisited", id, { sceneId: id, enabled }).catch(() => { setVisited(previousVisited); setVisitedAt(previousTimes); });
  };
  const recommendNearby = async (): Promise<void> => {
    if (nearbyBusy || !session) return;
    setNearbyBusy(true); setNearbyError(undefined);
    try {
      // LOC-FIX-001: 先看现状再申请。之前直接 request，拒绝过的用户每次
      // 点都是系统静默拒绝 → 笼统报错；且 getCurrentPositionAsync 无超时，
      // 室内无 fix 时按钮卡死“正在定位和计算…”（用户看到的“失败”）。
      const existing = await Location.getForegroundPermissionsAsync();
      let status = existing.status;
      if (status !== "granted") {
        const request = await Location.requestForegroundPermissionsAsync();
        status = request.status;
      }
      if (status !== "granted") throw new Error("未授权定位 — 去 iOS 设置 → Proxy → 位置，允许“使用 App 期间”");
      const grant = await authClient.request("/v1/location/consent/grant", { method: "POST", body: { durationSeconds: 1800 } });
      if (grant.status < 200 || grant.status >= 300) throw new Error("位置授权未生效（请检查登录状态后重试）");
      // 有缓存 fix 直接用（秒回）；没有才开 GPS，且最多等 10 秒。
      // expo-location v57 的 getCurrentPositionAsync 没有 timeout 参数，
      // 不自己 race 就会在室内无 fix 时一直转（用户看到的“失败”就是卡死）。
      const cached = await Location.getLastKnownPositionAsync().catch(() => null);
      const fix = cached ?? await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("定位超时（10 秒无 GPS 信号）— 请到开阔处重试，或用搜场景切换地址")), 10_000)),
      ]);
      const { latitude, longitude } = fix.coords;
      const response = await authClient.request("/v1/reality-scenes/nearby", { method: "POST", body: { latitude, longitude, radiusKm: 15 } });
      const body = await response.json() as { scenes?: unknown };
      if (response.status < 200 || response.status >= 300 || !Array.isArray(body.scenes)) throw new Error("附近场景暂时不可用");
      const valid = body.scenes.filter(isRealityScene);
      if (valid.length !== body.scenes.length) throw new Error("附近场景数据异常");
      setScenes(valid); setOrigin({ latitude, longitude }); setFilter("ALL"); setView("MAP");
    } catch (error) { setNearbyError(error instanceof Error ? error.message : "无法获取附近场景"); }
    finally { setNearbyBusy(false); }
  };

  if (selected) {
    const activeVariant = detail?.variants.find((item) => item.id === detail.selectedVariant);
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.detailContent}>
        <View style={styles.detailTop}><Pressable accessibilityLabel="返回" onPress={() => { if (selectedId && selectedId !== initialSceneId) setSelectedId(undefined); else onBack(); }} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable><View style={styles.detailTopCopy}><Text style={styles.detailTopTitle}>{detail?.venueName ?? selected.name}</Text><Text style={styles.detailTopSub}>{activeVariant?.name ?? selected.area} · {selected.area}</Text></View><View style={styles.topSpacer} /></View>
        <View style={styles.hero}>
          {detail?.heroImageUrl ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene:${detail.sceneId}:${detail.mediaVersion}`} source={{ uri: detail.heroImageUrl }} style={styles.heroMap} transition={0} /> : <MapView initialRegion={{ latitude: selected.latitude, longitude: selected.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }} pointerEvents="none" style={styles.heroMap}><Marker coordinate={{ latitude: selected.latitude, longitude: selected.longitude }} pinColor={selected.active ? color.magenta : color.violet} /></MapView>}
          <Text style={styles.eyebrow}>LIVE SCENE · {detail?.venueName ?? selected.name}</Text>
          <Text style={styles.detailTitle}>{activeVariant?.name ?? selected.name}</Text>
          <Text style={styles.detailDescription}>{activeVariant ? `${activeVariant.window} · ${activeVariant.bestFor}` : selected.description}</Text>
          {activeVariant ? <View style={styles.heroFacets}>{activeVariant.facets.map((facet) => <View key={facet} style={styles.heroFacet}><Text style={styles.heroFacetText}>{facet}</Text></View>)}</View> : null}
        </View>
        {detail ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.variantRail}>
              {detail.variants.map((variant) => <Pressable key={variant.id} onPress={() => selectVariant(variant.id)} style={[styles.variantPill, detail.selectedVariant === variant.id && styles.variantPillSelected]}><Text style={[styles.variantPillText, detail.selectedVariant === variant.id && styles.variantPillTextSelected]}>{variant.name.replace(" Coffee", "").replace(" Social", "")}</Text></Pressable>)}
            </ScrollView>
            {featuredAIAccount?.boundSceneId === detail.sceneId ? <View testID="ai-scene-binding" style={styles.aiBindingCard}><Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-ai:${featuredAIAccount.accountId}:${featuredAIAccount.avatarVersion ?? 1}`} source={aiAccountPhoto(featuredAIAccount)} style={styles.aiBindingAvatar} transition={0} /><View style={styles.aiBindingCopy}><Text style={styles.aiBindingEyebrow}>AI 小美 × 当前 Scene</Text><Text style={styles.aiBindingTitle}>{featuredAIAccount.displayName} · {featuredAIAccount.boundActivityTitle}</Text><Text style={styles.aiBindingText}>{featuredAIAccount.role}，可围绕这个场景聊天、陪伴和生成 UGC 灵感；不能到场、接单或报名活动。</Text><Pressable accessibilityLabel={`查看${featuredAIAccount.displayName}主页`} onPress={() => onOpenAIProfile?.(featuredAIAccount)} style={styles.aiProfileButton}><Text style={styles.aiProfileButtonText}>查看小美主页</Text></Pressable></View></View> : null}
            {featuredHuman ? <View testID="human-scene-binding" style={styles.humanBindingCard}>{featuredHuman.avatarUri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-person:${featuredHuman.userId}`} source={{ uri: featuredHuman.avatarUri }} style={styles.aiBindingAvatar} transition={0} /> : null}<View style={styles.aiBindingCopy}><Text style={styles.humanBindingEyebrow}>真人 × 当前 Scene</Text><Text style={styles.aiBindingTitle}>{featuredHuman.name}适合这个场景</Text><Text style={styles.aiBindingText}>这是基于场景的真人推荐，尚未代表本人到场或接受邀请。可进入主页了解后，再发起好友或现实活动邀请。</Text><Pressable accessibilityLabel={`查看${featuredHuman.name}主页`} onPress={() => onOpenHumanProfile?.(featuredHuman)} style={styles.aiProfileButton}><Text style={styles.aiProfileButtonText}>查看真人主页</Text></Pressable></View></View> : null}
            <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>现在最适合</Text><Pressable onPress={() => setWhyOpen((open) => !open)}><Text style={styles.sectionLink}>{whyOpen ? "收起依据" : "为什么"}</Text></Pressable></View>
            <View style={styles.bestGrid}><View style={styles.bestCard}><Text style={styles.bestTitle}>{activeVariant?.bestFor}</Text><Text style={styles.bestSub}>按当前时段、现场状态和可用资源推荐。</Text></View><View style={styles.bestCard}><Text style={styles.bestTitle}>{detail.liveState.state.replaceAll("_", " ")}</Text><Text style={styles.bestSub}>{detail.liveState.bestWindow} · 容量 {detail.liveState.capacityPct}%</Text></View></View>
            {whyOpen ? <View style={styles.whyCard}><Text style={styles.whyTitle}>推荐依据</Text><Text style={styles.whyText}>当前时段：{activeVariant?.window}</Text><Text style={styles.whyText}>场景标签：{activeVariant?.facets.join(" · ")}</Text><Text style={styles.whyText}>现场状态：{detail.liveState.label}，数据有效至 {new Date(detail.liveState.freshUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text><Text style={styles.whyBoundary}>这是场景推荐，不代表真人在场，也不生成到访、订单或履约证明。</Text></View> : null}
            <Text style={styles.sectionTitle}>适合一起的人</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.humanRail}>
              {detail.humans.map((human) => <Pressable key={human.id} onPress={() => setSelectedHumanId(human.id)} style={[styles.humanCard, selectedHumanId === human.id && styles.humanCardSelected]}><Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-human:${human.id}`} source={{ uri: human.avatarUrl }} style={styles.humanAvatar} transition={0} /><Text style={styles.humanName}>{human.name}</Text><Text style={styles.humanRole}>{human.role}</Text><Text style={styles.humanFit}>Scene fit {human.sceneFit}%</Text><Text style={styles.humanAvailability}>{selectedHumanId === human.id ? "✓ 已选择" : human.availability}</Text></Pressable>)}
            </ScrollView>
            <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>{fullMenuOpen ? `${detail.venueName} · 完整菜单` : "这个 Scene 喝什么"}</Text><Pressable onPress={() => setFullMenuOpen((open) => !open)}><Text style={styles.sectionLink}>{fullMenuOpen ? "只看当前 Scene" : "完整菜单"}</Text></Pressable></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuRail}>{(fullMenuOpen ? detail.fullMenu : detail.menu).map((item) => <Pressable disabled={!item.available} key={item.id} onPress={() => setSelectedMenuId(item.id)} style={[styles.menuCard, selectedMenuId === item.id && styles.menuCardSelected]}><Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-sku:${item.id}`} source={{ uri: item.imageUrl }} style={styles.menuImage} transition={0} /><Text numberOfLines={1} style={styles.menuName}>{item.name}</Text><Text style={styles.menuFit}>{item.sceneFit} · {item.available ? selectedMenuId === item.id ? "✓ 已选择" : "可售" : "售罄"}</Text><Text style={styles.menuPrice}>{item.priceLabel}</Text></Pressable>)}</ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => persistToggle(saved, selected.id, setSaved, "SetRealitySceneSaved")} style={[styles.action, saved.has(selected.id) && styles.actionSelected]}><Text style={styles.actionText}>{saved.has(selected.id) ? "★ 已收藏" : "☆ 收藏"}</Text></Pressable>
              <Pressable onPress={() => persistVisited(selected.id)} style={styles.action}><Text style={styles.actionText}>{visited.has(selected.id) ? "✓ 已去过" : "标记去过"}</Text></Pressable>
              <Pressable onPress={() => persistToggle(planned, selected.id, setPlanned, "SetRealityScenePlanned")} style={styles.primaryAction}><Text style={styles.primaryActionText}>{planned.has(selected.id) ? "✓ 已计划" : "去这里"}</Text></Pressable>
            </View>
            <Text style={styles.sectionTitle}>怎么组织这次现实行动</Text>
            <View style={styles.executionCard}>
              {detail.actions.map((action) => <Pressable key={action.type} onPress={() => { setSelectedAction(action); setActionResult(undefined); setActionExplanation(`${action.label}：${action.moneyMeaning}`); }} style={[styles.executionAction, selectedAction?.type === action.type && styles.executionActionSelected]}><Text style={styles.executionLabel}>{action.label}</Text><Text style={styles.executionState}>{action.type === "DIRECT_INVITE" ? "需本人接受" : action.type === "OPEN_TASK" ? "候选人申请" : "公开报名"}</Text></Pressable>)}
            </View>
            {actionExplanation ? <View style={styles.boundaryCard}><Text style={styles.boundaryStrong}>{actionExplanation}</Text><Text style={styles.boundaryText}>{detail.truthBoundary}</Text>{selectedAction ? <Pressable disabled={actionBusy} onPress={() => { void commitSceneAction(); }} style={styles.confirmAction}><Text style={styles.confirmActionText}>{actionBusy ? "处理中…" : `确认${selectedAction.label}`}</Text></Pressable> : null}{actionResult ? <Text style={styles.actionResult}>{actionResult}</Text> : null}</View> : null}
          </>
        ) : detailError ? <Text style={styles.nearbyError}>{detailError}</Text> : <Text style={styles.loadingDetail}>正在加载当前时段的人、菜单与活动方式…</Text>}
        <Text style={styles.sectionTitle}>场景数据</Text>
        <View style={styles.dataCard}>
          <DataRow label="Scene Quality" value={String(selected.quality)} />
          <DataRow label="最佳时间" value={selected.best} />
          {visitedAt.get(selected.id) ? <DataRow label="最近足迹" value={new Date(visitedAt.get(selected.id)!).toLocaleString()} /> : null}
          <DataRow label="隐私" value="历史公开记录 · 非实时位置" last />
        </View>
        <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>Reality Evidence · Scene Memory</Text></View>
        <View style={styles.memoryCard}><Text style={styles.memoryTitle}>{visited.has(selected.id) ? "已私人标记去过" : "暂无已核验现实记录"}</Text><Text style={styles.memoryText}>{visited.has(selected.id) ? "这只是你的私人足迹标记；完成订单、现场核销或上传并通过审核的证据，才会写入 Scene Memory。" : "完成订单、现场核销或上传并通过审核的证据后，这里才会沉淀同行人、消费项目、内容与关系变化。"}</Text></View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.roundButton}><Text style={styles.backText}>‹</Text></Pressable>
        <View style={styles.topCopy}><Text style={styles.title}>场景地图</Text><Text style={styles.subtitle}>{origin ? `当前位置附近 · ${scenes.length} 个热门场景` : `场景目录 · ${scenes.length} 个 Scene`}</Text></View>
        <Pressable accessibilityLabel={view === "MAP" ? "切换列表" : "切换地图"} onPress={() => setView(view === "MAP" ? "LIST" : "MAP")} style={styles.roundButton}><ProxyIcon color={color.ink} name={view === "MAP" ? "storeLines" : "crosshair"} size={21} /></Pressable>
      </View>
      <Pressable disabled={nearbyBusy || !session} onPress={() => { void recommendNearby(); }} style={styles.nearbyButton}><ProxyIcon color={color.white} name="crosshair" size={18} /><Text style={styles.nearbyButtonText}>{nearbyBusy ? "正在定位和计算…" : !session ? "登录后可用当前位置推荐" : "按当前位置推荐附近热门场景"}</Text></Pressable>
      {nearbyError ? <Text style={styles.nearbyError}>{nearbyError}</Text> : null}
      <View style={styles.stats}>
        <Stat value={Math.max(0, scenes.filter((scene) => !visited.has(scene.id)).length)} label="未探索" onPress={() => setFilter("UNSEEN")} />
        <Stat value={scenes.filter((scene) => scene.active).length} label="正在发生" onPress={() => setFilter("ACTIVE")} />
        <Stat value={visited.size} label="我的足迹" onPress={() => setFilter("VISITED")} />
      </View>
      <View style={styles.searchBox}><ProxyIcon color={color.muted} name="search" size={19} /><TextInput value={query} onChangeText={setQuery} placeholder="搜场景、区域、主题" placeholderTextColor={color.muted} style={styles.searchInput} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRail} contentContainerStyle={styles.filters}>
        {([['ALL','全部'], ['UNSEEN','没去过'], ['ACTIVE','正在发生'], ['SAVED','收藏'], ['VISITED','足迹']] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setFilter(id)} style={[styles.filter, filter === id && styles.filterActive]}><Text style={[styles.filterText, filter === id && styles.filterTextActive]}>{label}</Text></Pressable>
        ))}
      </ScrollView>
      {view === "MAP" ? (
        <View style={styles.mapWrap}>
          <MapView key={origin ? `${origin.latitude}:${origin.longitude}` : "catalog"} initialRegion={{ latitude: origin?.latitude ?? 21.036, longitude: origin?.longitude ?? 105.842, latitudeDelta: origin ? 0.12 : 0.115, longitudeDelta: origin ? 0.12 : 0.115 }} showsUserLocation={!!origin} style={StyleSheet.absoluteFill}>
            {filtered.map((scene) => <Marker key={scene.id} coordinate={{ latitude: scene.latitude, longitude: scene.longitude }} onPress={() => setSelectedId(scene.id)} pinColor={scene.active ? color.magenta : visited.has(scene.id) ? color.muted : color.violet} title={scene.name} description={`${scene.area} · ${scene.type}`} />)}
          </MapView>
          <View pointerEvents="none" style={styles.privacyPill}><Text style={styles.privacyText}>公开足迹 · 非实时位置</Text></View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.map((scene) => <SceneRow key={scene.id} scene={scene} visited={visited.has(scene.id)} saved={saved.has(scene.id)} onPress={() => setSelectedId(scene.id)} />)}
          {!filtered.length ? <Text style={styles.empty}>没有符合条件的场景</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

function isSceneDetail(value: unknown): value is SceneDetail {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SceneDetail>;
  return typeof item.sceneId === "string" && typeof item.heroImageUrl === "string" && item.heroImageUrl.length > 0 && typeof item.mediaVersion === "number" && typeof item.selectedVariant === "string" && Array.isArray(item.variants) && item.variants.length > 0 && !!item.liveState && Array.isArray(item.menu) && item.menu.every((menu) => typeof menu.imageUrl === "string" && menu.imageUrl.length > 0) && Array.isArray(item.fullMenu) && item.fullMenu.length >= item.menu.length && item.fullMenu.every((menu) => typeof menu.imageUrl === "string" && menu.imageUrl.length > 0) && Array.isArray(item.humans) && item.humans.every((human) => human.isAI === false && typeof human.avatarUrl === "string" && human.avatarUrl.length > 0) && Array.isArray(item.actions) && item.actions.length === 3 && typeof item.truthBoundary === "string";
}

function isRealityScene(value: unknown): value is RealityScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as Partial<RealityScene>;
  return typeof scene.id === "string" && typeof scene.name === "string" && typeof scene.area === "string" && typeof scene.type === "string" && typeof scene.latitude === "number" && Number.isFinite(scene.latitude) && typeof scene.longitude === "number" && Number.isFinite(scene.longitude) && typeof scene.quality === "number" && typeof scene.best === "string" && typeof scene.posts === "number" && typeof scene.creators === "number" && typeof scene.activities === "number" && typeof scene.invites === "number" && typeof scene.active === "boolean" && typeof scene.description === "string" && (scene.distanceMeters === undefined || typeof scene.distanceMeters === "number");
}

function isUserSceneState(value: unknown): value is { sceneId: string; saved: boolean; planned: boolean; privateVisited: boolean; visitedAt?: string } {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.sceneId === "string" && typeof item.saved === "boolean" && typeof item.planned === "boolean" && typeof item.privateVisited === "boolean";
}

async function sendSceneCommand(authClient: SessionAuthClient, session: AuthenticatedStoredSession, commandType: string, targetId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const response = await authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: {
    commandId: `scene_${nonce}`, commandType, commandVersion: 1,
    actor: { type: "USER", id: session.userAccountId }, principal: session.principal,
    target: { type: "RealityScene", id: targetId }, idempotencyKey: `scene_idem_${nonce}`,
    authContext: { sessionId: session.auth.sessionId }, purpose: "reality_scene_user_state",
    correlationId: `scene_corr_${nonce}`, requestedAt: new Date().toISOString(), payload
  }});
  const result = parseCommandResult(await response.json());
  if (!result || response.status < 200 || response.status >= 300 || result.outcome === "REJECTED") throw new Error(result?.error?.messageKey ?? "reality scene command failed");
  let decoded: Record<string, unknown> = {};
  if (result.operationRef) {
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("reality scene response malformed");
    decoded = value as Record<string, unknown>;
  }
  return { ...decoded, aggregateId: result.aggregate?.id, aggregateState: result.aggregate?.state };
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></Pressable>;
}

function SceneRow({ scene, visited, saved, onPress }: { scene: RealityScene; visited: boolean; saved: boolean; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.sceneRow}><View style={[styles.sceneDot, scene.active && styles.sceneDotActive, visited && styles.sceneDotVisited]} /><View style={styles.sceneCopy}><Text style={styles.sceneName}>{scene.name}</Text><Text style={styles.sceneMeta}>{scene.area} · {scene.type}{scene.distanceMeters !== undefined ? ` · ${formatDistance(scene.distanceMeters)}` : ""}</Text><Text style={styles.sceneSignal}>{scene.active ? "正在发生" : visited ? "去过" : saved ? "已收藏" : `Scene Quality ${scene.quality}`}</Text></View><ProxyIcon color={color.muted} name="arrowUpRight" size={19} /></Pressable>;
}
function formatDistance(meters: number): string { return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`; }

function DataRow({ label, value, last = false }: { label: string; value: string; last?: boolean }): React.JSX.Element {
  return <View style={[styles.dataRow, last && styles.dataRowLast]}><Text style={styles.dataLabel}>{label}</Text><Text style={styles.dataValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  topBar: { alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  topCopy: { flex: 1 }, title: { color: color.ink, fontSize: 27, fontWeight: "900", lineHeight: 34 }, subtitle: { color: color.muted, fontSize: 12, marginTop: 1 },
  roundButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  stats: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 }, stat: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 9 }, statValue: { color: color.ink, fontSize: 19, fontWeight: "900" }, statLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  nearbyButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: color.ink, borderRadius: 15, flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 8, marginHorizontal: 16, paddingVertical: 12 }, nearbyButtonText: { color: color.white, fontSize: 13, fontWeight: "800" }, nearbyError: { color: color.error, fontSize: 12, marginBottom: 8, marginHorizontal: 16 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: 16, paddingHorizontal: 13 }, searchInput: { color: color.ink, flex: 1, fontSize: 15, height: 46 },
  filterRail: { flexGrow: 0, height: 54, maxHeight: 54, minHeight: 54 },
  filters: { alignItems: "center", gap: 8, height: 54, paddingHorizontal: 16 }, filter: { alignItems: "center", alignSelf: "center", backgroundColor: color.surface, borderRadius: 18, height: 34, justifyContent: "center", paddingHorizontal: 15 }, filterActive: { backgroundColor: color.ink }, filterText: { color: color.muted, fontSize: 13, fontWeight: "700", lineHeight: 18 }, filterTextActive: { color: color.white },
  mapWrap: { borderColor: color.line, borderRadius: 22, borderWidth: 1, flex: 1, marginBottom: 14, marginHorizontal: 16, overflow: "hidden" }, privacyPill: { alignSelf: "center", backgroundColor: "rgba(23,19,31,0.84)", borderRadius: 14, bottom: 12, paddingHorizontal: 12, paddingVertical: 7, position: "absolute" }, privacyText: { color: color.white, fontSize: 11, fontWeight: "700" },
  list: { gap: 9, paddingBottom: 24, paddingHorizontal: 16 }, sceneRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 82, padding: 14 }, sceneDot: { backgroundColor: color.violet, borderRadius: 9, height: 18, width: 18 }, sceneDotActive: { backgroundColor: color.magenta }, sceneDotVisited: { backgroundColor: color.muted }, sceneCopy: { flex: 1 }, sceneName: { color: color.ink, fontSize: 16, fontWeight: "800" }, sceneMeta: { color: color.muted, fontSize: 12, marginTop: 3 }, sceneSignal: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 5 }, empty: { color: color.muted, paddingTop: 40, textAlign: "center" },
  detailContent: { paddingBottom: 36, paddingHorizontal: 13 }, detailTop: { alignItems: "center", flexDirection: "row", minHeight: 56 }, backButton: { alignItems: "center", height: 38, justifyContent: "center", width: 38 }, detailTopCopy: { flex: 1 }, detailTopTitle: { color: color.ink, fontSize: 17, fontWeight: "900" }, detailTopSub: { color: color.muted, fontSize: 11, marginTop: 2 },   topSpacer: { width: 38 }, backText: { color: color.ink, fontSize: 24, fontWeight: "800", lineHeight: 28 }, hero: { backgroundColor: "#F6F2E9", borderColor: color.line, borderRadius: 20, borderWidth: 1, overflow: "hidden", padding: 15, paddingTop: 242 }, heroMap: { height: 226, left: 0, position: "absolute", right: 0, top: 0 }, statePill: { alignSelf: "flex-start", backgroundColor: color.surface, borderRadius: 14, marginTop: 4, paddingHorizontal: 10, paddingVertical: 6 }, statePillActive: { backgroundColor: color.attentionBg }, stateText: { color: color.muted, fontSize: 11, fontWeight: "800" }, stateTextActive: { color: color.error }, eyebrow: { color: "#8B6000", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 12 }, detailTitle: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 31, marginTop: 5 }, detailDescription: { color: color.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  heroFacets: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 }, heroFacet: { backgroundColor: "#FFF3CB", borderColor: "#E4C35B", borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 }, heroFacetText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  aiBindingCard: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderColor: color.violet, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 14, padding: 13 }, aiBindingAvatar: { borderRadius: 30, height: 60, width: 60 }, aiBindingCopy: { flex: 1 }, aiBindingEyebrow: { color: color.violet, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 }, aiBindingTitle: { color: color.ink, fontSize: 14, fontWeight: "900", marginTop: 4 }, aiBindingText: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 5 }, aiProfileButton: { alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 12, marginTop: 9, paddingHorizontal: 12, paddingVertical: 8 }, aiProfileButtonText: { color: color.white, fontSize: 11, fontWeight: "900" },
  humanBindingCard: { alignItems: "center", backgroundColor: "#FFF8E3", borderColor: "#E4C35B", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 14, padding: 13 }, humanBindingEyebrow: { color: "#735700", fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  metrics: { flexDirection: "row", gap: 7, marginTop: 10 }, metric: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 11 }, metricValue: { color: color.ink, fontSize: 17, fontWeight: "900" }, metricLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 }, action: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, paddingVertical: 13 }, actionSelected: { backgroundColor: color.proxyPurpleSoft }, actionText: { color: color.ink, fontSize: 13, fontWeight: "800" }, primaryAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, flex: 1, paddingVertical: 13 }, primaryActionText: { color: color.white, fontSize: 13, fontWeight: "800" },
  liveCard: { alignItems: "center", backgroundColor: color.attentionBg, borderRadius: 18, flexDirection: "row", justifyContent: "space-between", marginTop: 12, padding: 15 }, liveLabel: { color: color.error, fontSize: 13, fontWeight: "900" }, liveWindow: { color: color.ink, fontSize: 17, fontWeight: "900", marginTop: 3 }, capacity: { color: color.ink, fontSize: 13, fontWeight: "800" },
  variantRail: { gap: 9, paddingRight: 16 }, variantCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, minHeight: 116, padding: 13, width: 178 }, variantCardSelected: { backgroundColor: color.ink, borderColor: color.ink }, variantName: { color: color.ink, fontSize: 15, fontWeight: "900" }, variantNameSelected: { color: color.white }, variantWindow: { color: color.violet, fontSize: 12, fontWeight: "800", marginTop: 5 }, variantBest: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  variantPill: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 }, variantPillSelected: { backgroundColor: color.ink, borderColor: color.ink }, variantPillText: { color: color.ink, fontSize: 12, fontWeight: "700" }, variantPillTextSelected: { color: color.white }, bestGrid: { flexDirection: "row", gap: 9 }, bestCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 105, padding: 13 }, bestTitle: { color: color.ink, fontSize: 14, fontWeight: "900", lineHeight: 19 }, bestSub: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 7 },
  whyCard: { backgroundColor: "#FFF8E3", borderColor: "#E4C35B", borderRadius: 16, borderWidth: 1, marginTop: 9, padding: 13 }, whyTitle: { color: color.ink, fontSize: 13, fontWeight: "900" }, whyText: { color: color.ink, fontSize: 11, lineHeight: 17, marginTop: 5 }, whyBoundary: { borderTopColor: "#E8D99D", borderTopWidth: 1, color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 9, paddingTop: 8 },
  humanRail: { gap: 9, paddingRight: 16 }, humanCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, padding: 13, width: 150 }, humanCardSelected: { borderColor: color.violet, borderWidth: 2 }, humanAvatar: { backgroundColor: color.proxyPurpleSoft, borderRadius: 22, height: 44, width: 44 }, humanAvatarText: { color: color.violet, fontSize: 19, fontWeight: "900" }, humanName: { color: color.ink, fontSize: 16, fontWeight: "900", marginTop: 9 }, humanRole: { color: color.muted, fontSize: 11, marginTop: 3 }, humanFit: { color: color.violet, fontSize: 11, fontWeight: "800", marginTop: 8 }, humanAvailability: { color: color.ink, fontSize: 11, marginTop: 3 },
  sectionTitleRow: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" }, sectionLink: { color: "#735700", fontSize: 11, fontWeight: "700", marginBottom: 9 }, menuRail: { gap: 10, paddingRight: 16 }, menuCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, overflow: "hidden", paddingBottom: 10, width: 154 }, menuCardSelected: { borderColor: "#D7A600", borderWidth: 2 }, menuImage: { height: 104, width: "100%" }, menuName: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 9, paddingHorizontal: 10 }, menuFit: { color: color.muted, fontSize: 11, marginTop: 3, paddingHorizontal: 10 }, menuPrice: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 7, paddingHorizontal: 10 },
  executionCard: { flexDirection: "row", gap: 7 }, executionAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 15, flex: 1, minHeight: 68, justifyContent: "center", paddingHorizontal: 5 }, executionActionSelected: { backgroundColor: color.violet }, executionLabel: { color: color.white, fontSize: 12, fontWeight: "900", textAlign: "center" }, executionState: { color: color.muted, fontSize: 11, marginTop: 5 }, boundaryCard: { backgroundColor: color.proxyPurpleSoft, borderRadius: 16, marginTop: 9, padding: 13 }, boundaryStrong: { color: color.ink, fontSize: 12, fontWeight: "800", lineHeight: 18 }, boundaryText: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 6 }, confirmAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, marginTop: 12, paddingVertical: 11 }, confirmActionText: { color: color.white, fontSize: 13, fontWeight: "900" }, actionResult: { color: color.ink, fontSize: 12, fontWeight: "700", lineHeight: 18, marginTop: 10 }, loadingDetail: { color: color.muted, fontSize: 12, paddingVertical: 22, textAlign: "center" },
  sectionTitle: { color: color.ink, fontSize: 18, fontWeight: "900", marginBottom: 8, marginTop: 20 }, dataCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14 }, dataRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 }, dataRowLast: { borderBottomWidth: 0 }, dataLabel: { color: color.ink, fontSize: 13, fontWeight: "700" }, dataValue: { color: color.muted, fontSize: 13 }, memoryCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, padding: 14 }, memoryTitle: { color: color.ink, fontSize: 14, fontWeight: "900" }, memoryText: { color: color.muted, fontSize: 11, lineHeight: 18, marginTop: 7 }
});

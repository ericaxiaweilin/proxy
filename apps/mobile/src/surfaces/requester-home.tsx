// RequesterHome（稳定 Surface，R15.12.7 rhome）：
// r157HomeTop + r1572HomeComposer('USER') + 继续/2项 + r157Action 周六新店开业 + r157Action 周末摄影散步
// + r157MarketPulse + bottom。无 hero / attention / teaser / rail / quick / reusable。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（rhome，HTML 5197-5203）。
// Experience Runtime 插槽：top_context banner 由 SurfacePlan 驱动（§10 Slots），本地态不被 Delta 覆盖（§15.1）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { buildHomeSearchIndex, matchHomeSearchIntent, type HomeSearchSuggestion } from "../home-search-intent";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";
import type { HardDemandCategory } from "../uiplan/types";
import type { DemandClient, RequesterHomeDraftItem, RequesterHomeTaskItem } from "../demand-client";
import type { MarketplaceClient } from "../marketplace-client";
import type { ActivityClient } from "../activity-client";
import { ActivityCommandRejectedError, ActivityProtocolError } from "../activity-client";
import type { ExperienceClient } from "../experience-client";
import type { AIAccountClient, PlatformAIAccount } from "../ai-account-client";
import type { EngagementClient } from "../engagement-client";
import { aiAccountPhoto } from "../ai-persona-presentation";
import { BUNDLED_AI_COMPANIONS } from "../ai-companion-catalog";
import { type SceneToolId } from "@proxy/contracts";
import { FilterChipRail } from "../components/filter-chip-rail";
import { HorizontalSwipeRail } from "../components/horizontal-swipe-rail";
import {
  RECOMMEND_FILTER_CHIPS,
  RECOMMEND_MODE_ORDER,
  SCENE_RECOMMEND,
  type RecommendFeed,
  type RecommendFilter,
  type RecommendPerson
} from "../recommend-fixtures";

export interface RequesterGoal {
  category: HardDemandCategory;
  goal: string;
}

// Server-backed read-model items get projected to this card-shape
// so the existing card UI stays untouched. kind=DRAFT shows a
// progress tag; kind=TASK shows no tag (the matching is in flight).
type ContinueCard = {
  key: string;
  icon: ProxyIconName;
  title: string;
  sub: string;
  progress?: string;
  headcount?: string;
};

function projectDraft(d: RequesterHomeDraftItem): ContinueCard {
  return {
    key: `draft:${d.id}`,
    icon: "diamond",
    title: d.sourceInput,
    sub: `草稿 · 已填 ${d.draftProgress}%`,
    progress: `${d.draftProgress}%`
  };
}

function projectTask(t: RequesterHomeTaskItem): ContinueCard {
  return {
    key: `task:${t.id}`,
    icon: "circle",
    title: t.sourceInput,
    sub: `已发布 · 等待匹配`
  };
}

// Empty-state fallback used when the user is not signed in yet
// (demandClient not provided) or the read model returned no rows.
// Preserves the original two placeholder cards so the visual baseline
// doesn't shift when the user is anonymous.
const PLACEHOLDER_ITEMS: ReadonlyArray<ContinueCard> = [
  { key: "ph:new", icon: "diamond", title: "周六新店开业", sub: "正在匹配 · 还差 1 位", progress: "80%" },
  { key: "ph:walk", icon: "circle", title: "周末摄影散步", sub: "你已感兴趣 · 周六 15:30", headcount: "8/12" }
];

export function RequesterHome({
  onEnterWorkspace,
  onOpenMarket,
  onOpenFeed,
  onChat,
  conversationPanel,
  topContext,
  demandClient,
  marketplace,
  activities,
  experiences,
  aiAccounts,
  engagement,
  onMessageAI,
  onOpenAIProfile,
  onOpenHumanScene,
  onOpenHumanProfile,
  viewerAccountId,
  onCreateScene,
  onOpenSceneMap,
  sceneApiBaseUrl,
  onChromeVisibilityChange,
  onChooserVisibilityChange,
  bottomNavVisible,
}: {
  onEnterWorkspace: (selection: RequesterGoal) => void;
  onOpenMarket?: ((tab: MarketTab) => void) | undefined;
  onOpenFeed?: (() => void) | undefined;
  onChat?: ((text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void) | undefined;
  conversationPanel?: ReactNode;
  topContext?: ReactNode;
  demandClient?: DemandClient;
  // R15.22 fix: 机会/活动计数从 API 拉, 替换 r157MarketPulse 硬编码 24/46/18.
  // server 端 ListMarketOpportunities / ListActivities 不限 actor, 匿名可读.
  marketplace?: MarketplaceClient;
  activities?: ActivityClient;
  // R15.49 — experience count 从 server 拉 (替换 hardcode 24).
  experiences?: ExperienceClient;
  aiAccounts?: AIAccountClient;
  engagement?: EngagementClient;
  onMessageAI?: (account: PlatformAIAccount) => void;
  onOpenAIProfile?: (account: PlatformAIAccount) => void;
  onOpenHumanScene?: (person: RecommendPerson, sceneId: string) => void;
  onOpenHumanProfile?: (person: RecommendPerson) => void;
  viewerAccountId?: string;
  onCreateScene?: ((tool: SceneToolId) => void) | undefined;
  onOpenSceneMap?: ((sceneId?: string) => void) | undefined;
  sceneApiBaseUrl?: string | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  onChooserVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode | undefined>("SERVICE");
  const [composerOpen, setComposerOpen] = useState(false);
  // 4 宫格：各槽位独立下标，点格子弹选择窗（弹窗控制格子），主页入口保留。
  const [personIndex, setPersonIndex] = useState(0);
  const [timeIndex, setTimeIndex] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);
  const [placeIndex, setPlaceIndex] = useState(0);
  const [chooser, setChooser] = useState<"person" | "time" | "activity" | "place" | null>(null);
  const [momentOpen, setMomentOpen] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | undefined>(undefined);
  const [continueItems, setContinueItems] = useState<ReadonlyArray<ContinueCard>>(PLACEHOLDER_ITEMS);
  // R15.34: 推荐人模式。当前选中的 mode (e.g. PHOTO) 决定
  // SCENE_RECOMMEND 里取哪份推荐列表。默认走 PHOTO — 首页打开就
  // 看到摄影好搭子。
  const [recommendMode, setRecommendMode] = useState<string>(RECOMMEND_MODE_ORDER[0]!);
  // R15.34: 筛选 sheet 开 / 关 + 已选 chip。空数组 = "全部"。
  const [filterSheetOpen, setFilterSheetOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<ReadonlyArray<string>>([]);
  const [recommendedAI, setRecommendedAI] = useState<PlatformAIAccount[]>(BUNDLED_AI_COMPANIONS);
  // 首页一键加好友：头像右下 + 徽标直接调 engagement.followProfile，
  // 本次会话内记住已加状态。主页仍是关系的源头（profile 的
  // toggleFollow / 发消息不变，进主页照样能做）。
  const [followedIds, setFollowedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [followBusyId, setFollowBusyId] = useState<string | undefined>(undefined);
  const [followMsg, setFollowMsg] = useState<string | undefined>(undefined);

  useEffect(() => {
    onChooserVisibilityChange?.(chooser !== null);
    return () => {
      if (chooser !== null) onChooserVisibilityChange?.(false);
    };
  }, [chooser, onChooserVisibilityChange]);

  async function toggleHomeFollow(id: string, name: string): Promise<void> {
    if (!engagement || !viewerAccountId) {
      setFollowMsg("登录后可加好友");
      return;
    }
    if (followBusyId !== undefined) return;
    const followed = followedIds.has(id);
    setFollowBusyId(id);
    setFollowMsg(undefined);
    try {
      if (followed) await engagement.unfollowProfile(id);
      else await engagement.followProfile(id);
      setFollowedIds((prev) => {
        const next = new Set(prev);
        if (followed) next.delete(id);
        else next.add(id);
        return next;
      });
      setFollowMsg(followed ? `已取消关注 ${name}` : `已加好友 · ${name}`);
    } catch {
      setFollowMsg("加好友失败，登录后重试");
    } finally {
      setFollowBusyId(undefined);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void aiAccounts?.listRecommended().then((accounts) => { if (!cancelled && accounts.length > 0) setRecommendedAI(accounts); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [aiAccounts]);

  // R15.34: 算当前 mode 的推荐 feed + 应用筛选过滤
  //   - filter: 多个 chip 可叠加 (附近 AND 最近活跃), 都需满足
  //   - "在线" 过滤：要求 person.online
  //   - "会中文" 过滤：要求 person.tags 里有 "会中文" lang tag
  //   - "共同好友" 过滤：要求 mutualFriends >= 1
  //   - "最近活跃" 过滤：要求 person.tags 里有 "最近活跃" social tag
  //   - "附近" 过滤：要求 distanceM < 1000
  // server 端接上后，filter 逻辑移过去；这里只负责本地预览。
  const recommendFeed: RecommendFeed = SCENE_RECOMMEND[recommendMode] ?? SCENE_RECOMMEND[RECOMMEND_MODE_ORDER[0]!]!;
  const filteredPeople: ReadonlyArray<RecommendPerson> = recommendFeed.people.filter((p) => {
    if (activeFilters.includes("online") && !p.online) return false;
    if (activeFilters.includes("lang_zh") && !p.tags.some((t) => t.text === "会中文" && t.kind === "lang")) return false;
    if (activeFilters.includes("mutual") && p.mutualFriends < 1) return false;
    if (activeFilters.includes("active") && !p.tags.some((t) => t.text === "最近活跃" && t.kind === "social")) return false;
    if (activeFilters.includes("near") && p.distanceM >= 1000) return false;
    return true;
  });
  // HomeItemsLoadState distinguishes the three post-auth states:
  //   "idle"    — no fetch attempted yet (initial render)
  //   "loading" — fetch in flight (placeholder still visible)
  //   "loaded"  — fetch succeeded (real items, possibly empty)
  //   "error"   — fetch failed (placeholder visible + error chip)
  // Without this, a transient network blip is indistinguishable
  // from "user has no in-progress needs" or "user is anonymous".
  const [homeItemsState, setHomeItemsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");

  // R36.x SCENE-RECOMMEND-001: 真实场景列表（公开接口，免登录），用于
  // 地图入口真计数 + 场景推荐横滑。失败/未配置时保持空，不展示假场景。
  type SceneBrief = { id: string; name: string; area: string; type: string; description: string; best: string; active: boolean; imageUrl: string };
  const [sceneBriefs, setSceneBriefs] = useState<SceneBrief[]>([]);
  useEffect(() => {
    if (!sceneApiBaseUrl) return;
    let cancelled = false;
    void fetch(`${sceneApiBaseUrl.replace(/\/$/, "")}/v1/reality-scenes`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((body) => {
        if (cancelled) return;
        const list = Array.isArray((body as { scenes?: unknown }).scenes) ? (body as { scenes: Array<Record<string, unknown>> }).scenes : [];
        setSceneBriefs(list.filter((s) => s && typeof s.id === "string" && typeof s.name === "string").map((s) => ({
          id: String(s.id),
          name: String(s.name ?? ""),
          area: typeof s.area === "string" ? s.area : "",
          type: typeof s.type === "string" ? s.type : "",
          description: typeof s.description === "string" ? s.description : "",
          best: typeof s.best === "string" ? s.best : "",
          active: s.active === true,
          imageUrl: typeof s.imageUrl === "string" ? s.imageUrl : "",
        })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sceneApiBaseUrl]);
  const activeSceneCount = sceneBriefs.filter((s) => s.active).length;

  function applyHomeSearchSuggestion(s: HomeSearchSuggestion): void {
    setSearchQuery("");
    setComposerOpen(false);
    if (s.slot === "person") {
      const at = filteredPeople.findIndex((p) => p.id === s.id);
      if (at >= 0) setPersonIndex(at);
    } else if (s.slot === "time") {
      const at = distinctTimes.indexOf(s.id);
      if (at >= 0) setTimeIndex(at);
    } else if (s.slot === "activity") {
      const at = storeActivities.findIndex((a) => a.activityId === s.id);
      if (at >= 0) setActivityIndex(at);
    } else {
      const at = sceneBriefs.findIndex((scene) => scene.id === s.id);
      if (at >= 0) setPlaceIndex(at);
    }
  }

  function handleHomeChatSend(text: string, mode?: HomeIntentMode, attachment?: HomeAttachment): void {
    setSearchQuery("");
    setComposerOpen(false);
    if (!onChat) return;
    onChat(text, mode, attachment);
  }

  // 整组换（remix）— 与四宫格 remix 按钮同一套真实数据轮换逻辑。
  function remixForYou(): void {
    setComposerOpen(false);
    if (filteredPeople.length > 1) setPersonIndex((current) => (current + 1) % filteredPeople.length);
    if (distinctTimes.length > 1) setTimeIndex((current) => (current + 1) % distinctTimes.length);
    if (storeActivities.length > 1) setActivityIndex((current) => (current + 1) % storeActivities.length);
    if (sceneBriefs.length > 1) setPlaceIndex((current) => (current + 1) % sceneBriefs.length);
  }

  // “换人/改时间/换场景/换活动” — 关掉 composer 后弹对应槽位的真实候选
  // chooser（clarify 流程复用四宫格弹窗，数据同源）。
  function refineHomeSearchSlot(slot: "person" | "time" | "activity" | "place"): void {
    setSearchQuery("");
    setComposerOpen(false);
    setChooser(slot);
  }

  // R36.x STORE-ACTIVITY-001: 店铺场景活动推荐（公开 listActivities，
  // 免登录）。本店（Three Beans）优先排前，其次按时间。
  type StoreActivityBrief = { activityId: string; title: string; venueName: string; time: string; joined: number; capacity: number; coverImageUrl: string | undefined; realitySceneId: string | undefined };
  const [storeActivities, setStoreActivities] = useState<StoreActivityBrief[]>([]);
  useEffect(() => {
    if (!activities) return;
    let cancelled = false;
    void activities.listActivities()
      .then((list) => {
        if (cancelled) return;
        const briefs = list.map((a) => ({
          activityId: a.activityId,
          title: a.title,
          venueName: a.venueName,
          time: a.time,
          joined: a.joined,
          capacity: a.capacity ?? 0,
          coverImageUrl: a.coverImageUrl,
          realitySceneId: a.realitySceneId,
        }));
        setStoreActivities(briefs);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activities]);

  // Home Search/Conversation v3 — 全站搜索合一：把真实推荐人/店铺活动/
  // 场景/时段装进搜索索引。人名/活动名/场景名/时段都能被同一输入命中。
  // 数据全部来自上方已拉取的真实列表，不造演示数据；列表为空时
  // lookup 自然无候选，输入直接走模型对话。
  const distinctTimes = [...new Set(storeActivities.map((a) => a.time).filter(Boolean))];
  const searchIndex = buildHomeSearchIndex({
    people: filteredPeople.map((p) => ({ id: p.id, name: p.name, bio: p.bio })),
    activities: storeActivities.map((a) => ({ id: a.activityId, title: a.title, venueName: a.venueName })),
    scenes: sceneBriefs.map((s) => ({ id: s.id, name: s.name, area: s.area, type: s.type })),
    times: distinctTimes
  });
  const [searchQuery, setSearchQuery] = useState("");
  const searchMatch = matchHomeSearchIntent(searchQuery, searchIndex);
  const searchSuggestions: ReadonlyArray<HomeSearchSuggestion> = searchMatch.kind === "lookup" ? searchMatch.suggestions : [];

  // 报名：对当前活动格报名（真接口），顺手把 joined 刷进本地 rail。
  // 注意：这是"我去参加活动"，不是"邀请小美来"。真邀请（createInvitation）
  // 要求被邀人是服务端实名用户，推荐流还是 fixture、没有真实 userId，
  // 接上之前按钮不挂邀请文案，免得链路名实不符。
  // 报名失败说人话：以前所有失败都报"登录后重试"，登录着的用户被误导。
  // 按错因分流——没登录/掉登录才提登录；报过名/满员/活动没了说具体事；
  // 其他归网络或稍后重试。错误码口径见 activity/service.go joinActivity。
  function joinErrorMessage(error: unknown): string {
    if (error instanceof ActivityCommandRejectedError) {
      switch (error.result.error?.errorCode) {
        case "ACTIVITY_ALREADY_JOINED":
          return "你已报过名，不用重复点";
        case "ACTIVITY_FULL":
          return "名额已满，下次早点来";
        case "ACTIVITY_NOT_FOUND":
          return "该活动不存在或已结束";
        case "ACTIVITY_ACTOR_REQUIRED":
        case "AI_ACTION_FORBIDDEN":
          return "登录已过期，请重新登录";
        default:
          return "报名失败，请稍后重试";
      }
    }
    if (error instanceof ActivityProtocolError) {
      // 本地就没有可用登录（principal 缺失/离线 fallback/已登出）才提登录；
      // 畸形响应走稍后重试。requireSession 把原错包了一层，只剩 message 可认。
      if (/principal is required|offline fallback|signed out|re-authenticate|sign in/i.test(error.message)) {
        return "登录后可报名";
      }
      return "报名失败，请稍后重试";
    }
    return "网络异常，请检查连接后重试";
  }

  async function joinSelected(activityId: string | undefined): Promise<void> {
    setJoinMsg(undefined);
    if (!activityId) {
      setJoinMsg("先选一个活动");
      return;
    }
    if (!activities) {
      setJoinMsg("登录后可报名");
      return;
    }
    setJoinBusy(true);
    try {
      const result = await activities.join(activityId);
      setStoreActivities((prev) => prev.map((a) => (a.activityId === activityId ? { ...a, joined: result.activity.joined } : a)));
      setJoinMsg(`已报名 · ${result.activity.joined} 人参加`);
    } catch (e) {
      setJoinMsg(joinErrorMessage(e));
    } finally {
      setJoinBusy(false);
    }
  }

  useEffect(() => {
    if (!demandClient) {
      // Anonymous: keep placeholder so the layout is non-empty.
      setContinueItems(PLACEHOLDER_ITEMS);
      setHomeItemsState("idle");
      return;
    }
    let cancelled = false;
    setHomeItemsState("loading");
    (async () => {
      // R15.22 fix: 匿名 session 没 principal, listHomeItems 调
      // requireSession() 立即抛 DemandProtocolError — 不应误报 "加载失败"
      // 仍保持 placeholder + idle 状态, 由顶 chip 提示登入。
      // hasAuthenticatedSession 内部已包 try/catch, 但这里仍 wrap 一层以防意外.
      let hasSession = false;
      try {
        hasSession = await demandClient.hasAuthenticatedSession();
      } catch {
        hasSession = false;
      }
      if (!hasSession) {
        if (cancelled) return;
        setContinueItems(PLACEHOLDER_ITEMS);
        setHomeItemsState("idle");
        return;
      }
      try {
        const home = await demandClient.listHomeItems(10);
        if (cancelled) return;
        const cards: ContinueCard[] = [];
        for (const d of home.drafts) cards.push(projectDraft(d));
        for (const t of home.tasks) cards.push(projectTask(t));
        setContinueItems(cards);
        setHomeItemsState("loaded");
      } catch {
        // Fail closed: keep the placeholder strip so a transient
        // network blip doesn't wipe the surface, but flag the
        // state so the section header can show an error chip.
        if (!cancelled) {
          setContinueItems(PLACEHOLDER_ITEMS);
          setHomeItemsState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demandClient]);

  const lastYRef = useRef(0);
  const dirRef = useRef(0);
  const visibleRef = useRef(true);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastYRef.current;
    // 滑动即把展开的模型对话收回单行。
    if (Math.abs(delta) >= 4) setComposerOpen(false);
    if (y <= 48) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
    else if (Math.abs(delta) >= 1) {
      const prevDir = Math.sign(dirRef.current);
      const nextDir = Math.sign(delta);
      dirRef.current = prevDir !== 0 && prevDir !== nextDir ? delta : dirRef.current + delta;
      if (dirRef.current <= -18) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
      else if (dirRef.current >= 28) { if (visibleRef.current) { visibleRef.current = false; onChromeVisibilityChange?.(false); } dirRef.current = 0; }
    }
    lastYRef.current = y;
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
      {topContext ?? null}
      {/* Search and Proxy share one top-level intent entry. It stays one line
          until the user explicitly starts/resumes a conversation. */}
      {conversationPanel ?? (onChat ? (
        <>
          <Pressable onPress={() => setComposerOpen(true)} style={styles.composerSingle} accessibilityLabel="搜索或询问 Proxy">
            <ProxyIcon color={color.muted} name="search" size={18} />
            <Text style={styles.composerSingleText}>搜索场景、地点，或问 Proxy</Text>
            <Text style={styles.composerSingleChev}>›</Text>
          </Pressable>
          {composerOpen ? (
            <View>
              <HomeChatBox
                contextLabel="用户"
                placeholder="搜索地点、活动，或直接说你想做什么"
                mode={intentMode}
                onSelectMode={(mode) => setIntentMode((current) => current === mode ? undefined : mode)}
                onQueryChange={setSearchQuery}
                searchSuggestions={searchSuggestions}
                onApplySuggestion={applyHomeSearchSuggestion}
                onSend={handleHomeChatSend}
              />
              {/* 原型 v3 的 clarify 流：命中换槽位/整组换意图时给一个明确的
                  执行 chip，点选后复用四宫格的真实候选弹窗。 */}
              {searchMatch.kind === "remix" ? (
                <Pressable accessibilityLabel="整组换一套候选" onPress={() => remixForYou()} style={styles.searchActionChip}>
                  <Text style={styles.searchActionText}>✦ 帮你整组换一套 →</Text>
                </Pressable>
              ) : null}
              {searchMatch.kind === "exchange" ? (
                <Pressable
                  accessibilityLabel={`更换${searchMatch.slot === "person" ? "人" : searchMatch.slot === "time" ? "时间" : searchMatch.slot === "activity" ? "活动" : "场景"}候选`}
                  onPress={() => refineHomeSearchSlot(searchMatch.slot)}
                  style={styles.searchActionChip}
                >
                  <Text style={styles.searchActionText}>
                    {searchMatch.slot === "person" ? "换个人，选一个 →" : searchMatch.slot === "time" ? "换时间，选一个 →" : searchMatch.slot === "activity" ? "换活动，选一个 →" : "换场景，选一个 →"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => { setSearchQuery(""); setComposerOpen(false); }} style={styles.composerCollapse}>
                <Text style={styles.composerCollapseText}>收起 ↑</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null)}
      {/* R15.35: 去掉 “今天想做什么？” 标题 — 是解释性废话，
          用户已看 chrome 顶部 LocationContext，进来就看到 mode chips，
          不需要再加一层 招呼。直接让 mode chips 成为第一个交互点。 */}

      {/* R15.34: 推荐人 mode 切换 — 单行路由。
          6 个 SCENE_TOOLS + 2 个用户列出的额外场景（翻译、陪诊）。
          默认走 PHOTO。点切 mode 会重置 activeFilters (筛选跟模式走)。 */}
      <View style={styles.recommendModes}>
        <FilterChipRail
          items={RECOMMEND_MODE_ORDER.map((modeId) => {
            const feed = SCENE_RECOMMEND[modeId];
            return {
              id: modeId,
              label: feed ? (
                modeId === "PHOTO" ? "拍照" : modeId === "COMPANION" ? "同行" : modeId === "COFFEE_MEAL" ? "吃饭" : modeId === "ACTIVITY" ? "活动" : modeId === "TRIP" ? "出去玩" : modeId === "CREATOR" ? "创作" : modeId === "TRANSLATE" ? "翻译" : "陪诊"
              ) : modeId
            };
          })}
          activeId={recommendMode}
          onChange={(id) => {
            setRecommendMode(id);
            setActiveFilters([]);
          }}
          marginBottom={4}
          testPrefix="推荐人模式"
        />
      </View>

      {/* R15.34: 推荐人 section — 标题 + stories 横滑 + cards 横滑。
          stories 是小圆形 avatar (首字母 + online 指示点 + 共同好友/场景
          tag)，cards 是 165×220 portrait card (大首字母 + 距离 + 2 tag)。 */}
      <View style={styles.peopleHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.peopleTitleRow}><Text style={styles.peopleTitle}>真人推荐</Text><View style={styles.humanBadge}><Text style={styles.humanBadgeText}>真人</Text></View></View>
          <Text style={styles.peopleSceneTitle}>{recommendFeed.title}</Text>
          <Text style={styles.peopleSub}>{recommendFeed.subtitle}</Text>
        </View>
        <Pressable onPress={() => setFilterSheetOpen(true)} style={styles.filterTrigger}>
          <Text style={styles.filterTriggerText}>筛选 〉</Text>
        </Pressable>
      </View>

      {/* R34.5 frozen rule: the discovery node itself is only circle avatar + name. */}
      {/* R15.34.2: 包 HorizontalSwipeRail 隔离 iOS 系统 tab 切换手势 */}
      <HorizontalSwipeRail
        style={styles.stories}
        contentContainerStyle={styles.storiesContent}
      >
        {filteredPeople.map((p) => (
          <Pressable
            key={`story:${p.id}`}
            onPress={() => onOpenHumanScene?.(p, recommendFeed.boundSceneId)}
            style={styles.story}
            accessibilityLabel={`推荐人 ${p.name}，${p.online ? "在线" : "离线"}`}
          >
            <View style={styles.avatar}>
              <View style={styles.avatarInner}>
                {p.photoUri ? <Image source={{ uri: p.photoUri }} style={styles.avatarPhoto} /> : <Text style={styles.avatarInitials}>{p.initials}</Text>}
              </View>
              {p.online ? <View style={styles.onlineDot} /> : null}
              <Pressable
                onPress={() => void toggleHomeFollow(p.id, p.name)}
                disabled={followBusyId === p.id}
                style={[styles.addBadge, followedIds.has(p.id) && styles.addBadgeDone]}
                accessibilityLabel={followedIds.has(p.id) ? `已加好友 ${p.name}` : `加好友 ${p.name}`}
              >
                <Text style={styles.addBadgeText}>{followBusyId === p.id ? "…" : followedIds.has(p.id) ? "✓" : "+"}</Text>
              </Pressable>
            </View>
            <Text style={styles.storyName} numberOfLines={1}>{p.name}</Text>
          </Pressable>
        ))}
      </HorizontalSwipeRail>

      {followMsg ? (
        <Text style={styles.followMsg}>{followMsg}</Text>
      ) : null}

      {recommendedAI.length > 0 ? <View style={styles.aiSection}>
        <View style={styles.aiSectionHead}>
          <View><Text style={styles.aiTitle}>AI 推荐</Text><Text style={styles.aiSub}>先看她为什么适合当前场景</Text></View>
          <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI 生成</Text></View>
        </View>
        <HorizontalSwipeRail style={styles.aiRail} contentContainerStyle={styles.aiRailContent}>
          {recommendedAI.map((account) => (
            <Pressable key={account.accountId} accessibilityLabel={`查看${account.displayName}主页`} onPress={() => onOpenAIProfile?.(account)} style={styles.aiCard}>
              <View style={styles.aiAvatarWrap}>
                <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`ai-avatar:${account.accountId}:${account.avatarVersion ?? 1}`} source={aiAccountPhoto(account)} style={styles.aiAvatar} transition={0} />
                <Pressable
                  onPress={() => void toggleHomeFollow(account.accountId, account.displayName)}
                  disabled={followBusyId === account.accountId}
                  style={[styles.addBadge, followedIds.has(account.accountId) && styles.addBadgeDone]}
                  accessibilityLabel={followedIds.has(account.accountId) ? `已加好友 ${account.displayName}` : `加好友 ${account.displayName}`}
                >
                  <Text style={styles.addBadgeText}>{followBusyId === account.accountId ? "…" : followedIds.has(account.accountId) ? "✓" : "+"}</Text>
                </Pressable>
              </View>
              <Text style={styles.aiName} numberOfLines={1}>{account.displayName}</Text>
              <Text style={styles.aiHandle} numberOfLines={1}>AI 生成</Text>
            </Pressable>
          ))}
        </HorizontalSwipeRail>
      </View> : null}
      {/* R34_12_1 4-Grid: selection stays with discovery content; the unified
          search/model entry itself lives at the top of Home. */}
      {onChat ? (
        <>
          {(() => {
            const gridPerson = filteredPeople.length > 0 ? filteredPeople[personIndex % filteredPeople.length] : undefined;
            const gridTime = distinctTimes.length > 0 ? distinctTimes[timeIndex % distinctTimes.length] : undefined;
            const gridActivity = storeActivities.length > 0 ? storeActivities[activityIndex % storeActivities.length] : undefined;
            const gridPlace = sceneBriefs.length > 0 ? sceneBriefs[placeIndex % sceneBriefs.length] : undefined;
            if (!gridPerson && !gridActivity && !gridPlace && !gridTime) return null;
            const remixAll = (): void => {
              setComposerOpen(false);
              if (filteredPeople.length > 1) setPersonIndex((current) => (current + 1) % filteredPeople.length);
              if (distinctTimes.length > 1) setTimeIndex((current) => (current + 1) % distinctTimes.length);
              if (storeActivities.length > 1) setActivityIndex((current) => (current + 1) % storeActivities.length);
              if (sceneBriefs.length > 1) setPlaceIndex((current) => (current + 1) % sceneBriefs.length);
            };
            const composed = [gridPerson ? `和${gridPerson.name}` : "", gridTime ?? "", gridActivity ? gridActivity.title : "", gridPlace ? `@${gridPlace.name}` : ""].filter(Boolean).join(" ");
            const tiles = [
              gridPerson ? { key: `person:${gridPerson.id}`, slot: "person" as const, imageUri: gridPerson.photoUri, glyph: "●", label: gridPerson.name, sub: "一起的人 · 点更换" } : undefined,
              gridTime ? { key: `time:${gridTime}`, slot: "time" as const, imageUri: gridPlace?.imageUrl, glyph: "◷", label: gridTime, sub: gridPlace ? gridPlace.name : "时间" } : undefined,
              gridActivity ? { key: `act:${gridActivity.activityId}`, slot: "activity" as const, imageUri: gridPlace?.imageUrl, glyph: "☕", label: gridActivity.title, sub: gridActivity.venueName } : undefined,
              gridPlace ? { key: `place:${gridPlace.id}`, slot: "place" as const, imageUri: gridPlace.imageUrl, glyph: "●", label: gridPlace.name, sub: "地点" } : undefined,
            ];
            return (
              <View>
                <View style={styles.forYouHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.peopleTitleRow}><Text style={styles.peopleTitle}>为你组合</Text><View style={styles.forYouBadge}><Text style={styles.forYouBadgeText}>For You</Text></View></View>
                    <Text style={styles.peopleSub}>选人 · 定时间 · 配活动场景，一键出图或邀约</Text>
                  </View>
                </View>
                <View style={styles.gridStage}>
                  <View style={styles.grid4}>
                    {tiles.map((t) => t ? (
                      <Pressable key={t.key} onPress={() => { setComposerOpen(false); setChooser(t.slot); }} style={styles.gridTile}>
                        {t.imageUri ? <Image source={{ uri: t.imageUri }} style={styles.gridImage} /> : <View style={styles.gridImageMissing}><Text style={styles.gridGlyph}>{t.glyph}</Text></View>}
                        <View style={styles.gridOverlay}>
                          <Text style={[styles.gridLabel, !t.imageUri && styles.gridLabelDark]} numberOfLines={1}>{t.label}</Text>
                          <Text style={[styles.gridSub, !t.imageUri && styles.gridSubDark]} numberOfLines={1}>{t.sub}</Text>
                        </View>
                      </Pressable>
                    ) : null)}
                  </View>
                  <Pressable
                    accessibilityHint="同时更换人物、时间、活动和地点"
                    accessibilityLabel="整组换一组"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={remixAll}
                    style={({ pressed }) => [styles.gridRemixButton, pressed && styles.gridRemixButtonPressed]}
                  >
                    <ProxyIcon color={color.white} name="remix" size={25} />
                  </Pressable>
                </View>
                {composed ? (
                  <View>
                    <Text style={styles.chainHint}>直接约她：点头像进 Scene 主页聊 · 想等人来：发布需求等小美接单</Text>
                    <View style={styles.gridCtaRow}>
                    <Pressable onPress={() => setMomentOpen(true)} style={[styles.gridCta, styles.gridCtaHalf]} accessibilityLabel="出图">
                      <Text style={styles.gridCtaTextSmall}>✦ 出图</Text>
                    </Pressable>
                    <Pressable disabled={joinBusy} onPress={() => void joinSelected(gridActivity?.activityId)} style={[styles.gridCta, styles.gridCtaHalf]} accessibilityLabel="报名参加活动">
                      <Text style={styles.gridCtaTextSmall}>{joinBusy ? "报名中…" : "报名 →"}</Text>
                    </Pressable>
                    <Pressable onPress={() => onOpenMarket?.("OPPORTUNITY")} style={[styles.gridCta, styles.gridCtaHalf]} accessibilityLabel="发布需求等小美报名">
                      <Text style={styles.gridCtaTextSmall}>发布需求</Text>
                    </Pressable>
                    </View>
                  </View>
                ) : null}
                {joinMsg ? <Text style={styles.joinMsg}>{joinMsg}</Text> : null}
                {chooser ? (
                  <Modal transparent animationType="fade" visible onRequestClose={() => setChooser(null)}>
                    <Pressable onPress={() => setChooser(null)} style={styles.sheetBackdrop}>
                      <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        <View style={styles.sheetGrab} />
                        <Text style={styles.sheetTitle}>{chooser === "person" ? "选一起的人" : chooser === "time" ? "选时间" : chooser === "activity" ? "选活动" : "选地点"}</Text>
                        {chooser === "person" ? (
                          <HorizontalSwipeRail contentContainerStyle={styles.personChooserRail}>
                            {filteredPeople.map((p, i) => {
                              const selected = i === personIndex % filteredPeople.length;
                              return (
                                <Pressable
                                  accessibilityLabel={`选择 ${p.name}`}
                                  key={p.id}
                                  onPress={() => { setPersonIndex(i); setChooser(null); }}
                                  style={[styles.personChooserCard, selected && styles.personChooserCardSelected]}
                                >
                                  {p.photoUri ? (
                                    <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: p.photoUri }} style={styles.personChooserPhoto} transition={0} />
                                  ) : (
                                    <View style={[styles.personChooserPhoto, styles.personChooserFallback]}><Text style={styles.personChooserInitials}>{p.initials}</Text></View>
                                  )}
                                  <View style={styles.personChooserCopy}>
                                    <Text numberOfLines={1} style={styles.personChooserName}>{p.name}</Text>
                                    <Text numberOfLines={1} style={styles.personChooserBio}>{p.bio}</Text>
                                  </View>
                                  {selected ? <View style={styles.personChooserSelectedBadge}><ProxyIcon color={color.white} name="check" size={13} /></View> : null}
                                </Pressable>
                              );
                            })}
                          </HorizontalSwipeRail>
                        ) : chooser === "time" ? (
                          <HorizontalSwipeRail contentContainerStyle={styles.timeChooserRail}>
                            {distinctTimes.map((t, i) => {
                              const selected = i === timeIndex % distinctTimes.length;
                              return (
                                <Pressable key={t} onPress={() => { setTimeIndex(i); setChooser(null); }} style={[styles.timeChooserCard, selected && styles.timeChooserCardSelected]}>
                                  <ProxyIcon color={selected ? color.white : color.ink} name="clock" size={22} />
                                  <Text numberOfLines={2} style={[styles.timeChooserValue, selected && styles.timeChooserValueSelected]}>{t}</Text>
                                  <Text style={[styles.timeChooserHint, selected && styles.timeChooserHintSelected]}>{selected ? "当前选择" : "选择时段"}</Text>
                                </Pressable>
                              );
                            })}
                          </HorizontalSwipeRail>
                        ) : chooser === "activity" ? (
                          <HorizontalSwipeRail contentContainerStyle={styles.photoChooserRail}>
                            {storeActivities.map((a, i) => {
                              const scene = sceneBriefs.find((s) => s.id === a.realitySceneId || s.name === a.venueName);
                              const photo = a.coverImageUrl || scene?.imageUrl;
                              const selected = i === activityIndex % storeActivities.length;
                              return (
                                <Pressable key={a.activityId} onPress={() => { setActivityIndex(i); setChooser(null); }} style={[styles.photoChooserCard, selected && styles.photoChooserCardSelected]}>
                                  {photo ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: photo }} style={styles.photoChooserImage} transition={0} /> : <View style={[styles.photoChooserImage, styles.photoChooserFallback]}><ProxyIcon color={color.muted} name="cup" size={30} /></View>}
                                  <View style={styles.photoChooserCopy}>
                                    <Text numberOfLines={1} style={styles.photoChooserName}>{a.title}</Text>
                                    <Text numberOfLines={1} style={styles.photoChooserMeta}>{a.venueName}{a.time ? ` · ${a.time}` : ""}</Text>
                                  </View>
                                  {selected ? <View style={styles.photoChooserSelectedBadge}><ProxyIcon color={color.white} name="check" size={13} /></View> : null}
                                </Pressable>
                              );
                            })}
                          </HorizontalSwipeRail>
                        ) : (
                          <HorizontalSwipeRail contentContainerStyle={styles.photoChooserRail}>
                            {sceneBriefs.map((s, i) => {
                              const selected = i === placeIndex % sceneBriefs.length;
                              return (
                                <Pressable key={s.id} onPress={() => { setPlaceIndex(i); setChooser(null); }} style={[styles.photoChooserCard, selected && styles.photoChooserCardSelected]}>
                                  {s.imageUrl ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: s.imageUrl }} style={styles.photoChooserImage} transition={0} /> : <View style={[styles.photoChooserImage, styles.photoChooserFallback]}><ProxyIcon color={color.muted} name="storefront" size={30} /></View>}
                                  <View style={styles.photoChooserCopy}>
                                    <Text numberOfLines={1} style={styles.photoChooserName}>{s.name}</Text>
                                    <Text numberOfLines={1} style={styles.photoChooserMeta}>{s.area}{s.type ? ` · ${s.type}` : ""}</Text>
                                  </View>
                                  {selected ? <View style={styles.photoChooserSelectedBadge}><ProxyIcon color={color.white} name="check" size={13} /></View> : null}
                                </Pressable>
                              );
                            })}
                          </HorizontalSwipeRail>
                        )}
                      </View>
                    </Pressable>
                  </Modal>
                ) : null}
                {momentOpen ? (
                  <Modal transparent animationType="fade" visible onRequestClose={() => setMomentOpen(false)}>
                    <Pressable onPress={() => setMomentOpen(false)} style={styles.sheetBackdrop}>
                      <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        <View style={styles.sheetGrab} />
                        <Text style={styles.sheetTitle}>邀约 Moment</Text>
                        <View style={styles.momentGrid}>
                          {tiles.map((t) => t ? (
                            <View key={`m:${t.key}`} style={styles.momentCell}>
                              {t.imageUri ? <Image source={{ uri: t.imageUri }} style={styles.momentImage} /> : <View style={styles.momentImageMissing}><Text style={styles.gridGlyph}>{t.glyph}</Text></View>}
                              <Text style={styles.momentLabel} numberOfLines={1}>{t.label}</Text>
                            </View>
                          ) : null)}
                        </View>
                        <Text style={styles.momentCopy} numberOfLines={2}>{composed}</Text>
                        <Pressable
                          onPress={() => { setMomentOpen(false); void Share.share({ message: composed }); }}
                          style={[styles.gridCta, { marginTop: 10 }]}
                          accessibilityLabel="分享邀约"
                        >
                          <Text style={styles.gridCtaText}>分享邀请 →</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  </Modal>
                ) : null}
              </View>
            );
          })()}
        </>
      ) : null}

      {sceneBriefs.length > 0 ? (
        <View>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>场景</Text>
            <Text style={styles.sectionHint}>{activeSceneCount > 0 ? `${activeSceneCount} 个正在发生` : `${sceneBriefs.length} 个待探索`}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sceneWideRail}>
            {sceneBriefs.slice(0, 6).map((s) => (
              <Pressable key={s.id} onPress={() => onOpenSceneMap?.(s.id)} style={styles.sceneWideCard} accessibilityLabel={`场景 ${s.name}`}>
                {s.imageUrl ? <Image source={{ uri: s.imageUrl }} style={styles.sceneWideImage} /> : <View style={styles.sceneWideImageMissing} />}
                <Text style={styles.sceneCardName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.sceneCardMeta} numberOfLines={1}>{s.area}{s.type ? ` · ${s.type}` : ""}</Text>
                {s.best ? <Text style={styles.sceneCardMeta} numberOfLines={1}>{s.best}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {storeActivities.length > 0 ? (
        <View>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>店铺场景活动</Text>
            <Text style={styles.sectionHint}>报名 · 到店 · 复盘</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sceneRail}>
            {storeActivities.slice(0, 8).map((a) => (
              <Pressable key={a.activityId} onPress={() => onOpenMarket?.("ACTIVITY")} style={styles.sceneCard} accessibilityLabel={`活动 ${a.title}`}>
                <Text style={styles.sceneCardName} numberOfLines={1}>{a.title}</Text>
                <Text style={styles.sceneCardMeta} numberOfLines={1}>{a.venueName}{a.time ? ` · ${a.time}` : ""}</Text>
                <Text style={styles.sceneCardDesc} numberOfLines={2}>{a.joined > 0 ? `${a.joined} 人已参加` : "等你来开场"}{a.capacity > 0 ? ` · 限 ${a.capacity} 人` : ""}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* R15.34: 继续进行 — 大 thumb 卡片 list。只渲染 server 返回的
          continueItems；未加载/失败时显示诚实状态，不展示假数据。 */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>继续进行</Text>
        <Text style={styles.sectionHint}>
          {homeItemsState === "loaded"
            ? `${continueItems.length} 项`
            : homeItemsState === "error"
            ? " · 加载失败"
            : homeItemsState === "loading"
            ? " · 加载中"
            : ""}
        </Text>
      </View>
      {continueItems.length === 0 ? (
        <View style={styles.actionCard}>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>没有进行中的需求</Text>
            <Text style={styles.actionSub}>在上方输入开始一个新草稿。</Text>
          </View>
        </View>
      ) : (
        (homeItemsState === "loaded" ? continueItems : []).map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onOpenMarket?.("OPPORTUNITY")}
            style={styles.continueCard}
            accessibilityLabel={`继续进行 ${item.title}`}
          >
            <View style={styles.continueThumb}>
              <Text style={styles.continueThumbText}>{(item.title[0] ?? "?").toUpperCase()}</Text>
            </View>
            <View style={styles.continueCopy}>
              <Text style={styles.continueTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.continueSub} numberOfLines={1}>{item.sub}</Text>
            </View>
            {item.progress !== undefined ? (
              <View style={styles.actionTag}>
                <Text style={styles.actionTagText}>{item.progress}</Text>
              </View>
            ) : item.headcount !== undefined ? (
              <View style={styles.actionTag}>
                <Text style={styles.actionTagText}>{item.headcount}</Text>
              </View>
            ) : (
              <Text style={styles.continueChevron}>›</Text>
            )}
          </Pressable>
        ))
      )}
      {homeItemsState === "loading" ? (
        <Text style={styles.emptyNote}>加载中…</Text>
      ) : homeItemsState === "error" ? (
        <Text style={styles.emptyNote}>加载失败，下拉或稍后重试</Text>
      ) : null}

      {/* R15.34: 推荐筛选 sheet — 5 个 chip 叠加过滤 (多选)，Modal 模态。
          之前是 ScrollView 内的 absolute 定位，bottom 落在滚动内容最底下，
          打开后 sheet 在屏外、筛选点不了。现在走 Modal，与选人/出图弹窗一致。 */}
      {filterSheetOpen ? (
        <Modal transparent animationType="fade" visible={filterSheetOpen} onRequestClose={() => setFilterSheetOpen(false)}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setFilterSheetOpen(false)}
          accessibilityLabel="关闭筛选"
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetGrab} />
            <Text style={styles.sheetTitle}>推荐筛选</Text>
            <View style={styles.filterChips}>
              {RECOMMEND_FILTER_CHIPS.map((chip: RecommendFilter) => {
                const on = activeFilters.includes(chip.id);
                return (
                  <Pressable
                    key={chip.id}
                    onPress={() => {
                      setActiveFilters((prev) =>
                        prev.includes(chip.id) ? prev.filter((c) => c !== chip.id) : [...prev, chip.id]
                      );
                    }}
                    style={[styles.filterChip, on && styles.filterChipOn]}
                    accessibilityLabel={`筛选 ${chip.label}${on ? "，已选" : ""}`}
                  >
                    <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>{chip.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setFilterSheetOpen(false)}
              style={styles.sheetApplyBtn}
              accessibilityLabel="应用筛选"
            >
              <Text style={styles.sheetApplyText}>应用</Text>
            </Pressable>
          </View>
        </Pressable>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  aiSection: { marginTop: 8 },
  aiSectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  aiTitle: { color: color.ink, fontSize: 17, fontWeight: "900" },
  aiSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  aiBadge: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  aiBadgeText: { color: color.violet, fontSize: 11, fontWeight: "900" },
  aiRail: { marginBottom: 10 },
  aiRailContent: { gap: 15, paddingHorizontal: 16 },
  aiCard: { alignItems: "center", width: 104 },
  aiAvatar: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, height: 88, width: 88 },
  aiName: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 7, textAlign: "center" },
  aiHandle: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 2, textAlign: "center" },
  aiDescription: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 5, minHeight: 30 },
  aiProfileLink: { color: color.violet, fontSize: 11, fontWeight: "800", marginTop: 7 },
  sceneWideRail: { gap: 12, paddingRight: 16, paddingVertical: 4 },
  sceneWideCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 5, padding: 10, width: 220 },
  sceneWideImage: { borderRadius: 12, height: 132, width: "100%" },
  sceneWideImageMissing: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 12, height: 132, justifyContent: "center", width: "100%" },
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 13 },

  // R15.35: 移除 "今天想做什么？" 标题相关样式（homeTop / homeTopCopy /
  // homeTopTitle / homeTopLoc 都已无使用点）。直接让 mode chips 紧接
  // 顶部 LocationContext 出现，不再需要招招呼局。
  // 基线 .sectionhead：margin-top 10；b 12 / span 9。
  sectionHead: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
    marginTop: 14
  },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  emptyNote: { color: color.muted, fontSize: 12, paddingVertical: 8, textAlign: "center" },
  composerSingle: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 24, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 14, paddingVertical: 12 },
  composerSingleText: { color: color.muted, flex: 1, fontSize: 13 },
  composerSingleIcons: { alignItems: "center", flexDirection: "row", gap: 10 },
  composerSingleChev: { color: color.muted, fontSize: 18, fontWeight: "800" },
  composerCollapse: { alignItems: "center", paddingVertical: 6 },
  composerCollapseText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  // Home Search/Conversation v3：意图确认 chip — 命中 remix/exchange 后的
  // 明确执行入口，样式跟基线 CTA 一致（ink 底白字）。
  searchActionChip: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, marginTop: 7, paddingVertical: 13 },
  searchActionText: { color: color.white, fontSize: 13, fontWeight: "800" },
  gridStage: { position: "relative" },
  grid4: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  gridRemixButton: { alignItems: "center", backgroundColor: "#171715", borderColor: color.offWhite, borderRadius: 29, borderWidth: 2, elevation: 7, height: 58, justifyContent: "center", left: "50%", marginLeft: -29, marginTop: -24, position: "absolute", top: "50%", width: 58, zIndex: 8 },
  gridRemixButtonPressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
  gridTile: { borderRadius: 18, height: 172, overflow: "hidden", width: "48.4%" },
  gridImage: { borderRadius: 18, height: "100%", width: "100%" },
  gridImageMissing: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 18, height: "100%", justifyContent: "center", width: "100%" },
  gridGlyph: { color: color.muted, fontSize: 30 },
  gridOverlay: { bottom: 0, gap: 1, left: 0, padding: 10, position: "absolute", right: 0 },
  gridLabel: { color: "#ffffff", fontSize: 13, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 5 },
  gridLabelDark: { color: color.ink, textShadowColor: "transparent" },
  gridSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 5 },
  gridSubDark: { color: color.muted, textShadowColor: "transparent" },
  gridCta: { alignItems: "center", backgroundColor: "#171715", borderRadius: 22, flexDirection: "row", justifyContent: "center", marginTop: 10, paddingVertical: 14 },
  gridCtaHalf: { flex: 1, marginTop: 0, paddingVertical: 9 },
  gridCtaRow: { flexDirection: "row", gap: 8 },
  gridCtaText: { color: color.white, fontSize: 15, fontWeight: "800" },
  gridCtaTextSmall: { color: color.white, fontSize: 13, fontWeight: "800" },
  // 双链路提示：链路 A（直接约她走头像→Scene→主页）vs 链路 B（发布需求等人来）。
  chainHint: { color: color.muted, fontSize: 11, marginTop: 8, textAlign: "center" },
  joinMsg: { color: color.muted, fontSize: 11, marginTop: 6, textAlign: "center" },
  personChooserRail: { gap: 10, paddingBottom: 2, paddingRight: 8 },
  personChooserCard: { backgroundColor: color.offWhite, borderColor: "transparent", borderRadius: 18, borderWidth: 2, overflow: "hidden", position: "relative", width: 142 },
  personChooserCardSelected: { borderColor: color.ink },
  personChooserPhoto: { height: 164, width: "100%" },
  personChooserFallback: { alignItems: "center", backgroundColor: color.lime, justifyContent: "center" },
  personChooserInitials: { color: color.ink, fontSize: 28, fontWeight: "900" },
  personChooserCopy: { gap: 2, paddingHorizontal: 10, paddingVertical: 9 },
  personChooserName: { color: color.ink, fontSize: 15, fontWeight: "900" },
  personChooserBio: { color: color.muted, fontSize: 11 },
  personChooserSelectedBadge: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, height: 26, justifyContent: "center", position: "absolute", right: 7, top: 7, width: 26 },
  photoChooserRail: { gap: 10, paddingBottom: 2, paddingRight: 8 },
  photoChooserCard: { backgroundColor: color.offWhite, borderColor: "transparent", borderRadius: 18, borderWidth: 2, overflow: "hidden", position: "relative", width: 210 },
  photoChooserCardSelected: { borderColor: color.ink },
  photoChooserImage: { height: 138, width: "100%" },
  photoChooserFallback: { alignItems: "center", backgroundColor: color.offWhite, justifyContent: "center" },
  photoChooserCopy: { gap: 2, paddingHorizontal: 10, paddingVertical: 9 },
  photoChooserName: { color: color.ink, fontSize: 15, fontWeight: "900" },
  photoChooserMeta: { color: color.muted, fontSize: 11 },
  photoChooserSelectedBadge: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, height: 26, justifyContent: "center", position: "absolute", right: 7, top: 7, width: 26 },
  timeChooserRail: { gap: 10, paddingBottom: 2, paddingRight: 8 },
  timeChooserCard: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 9, minHeight: 126, padding: 14, width: 142 },
  timeChooserCardSelected: { backgroundColor: color.ink, borderColor: color.ink },
  timeChooserValue: { color: color.ink, fontSize: 16, fontWeight: "900", lineHeight: 21 },
  timeChooserValueSelected: { color: color.white },
  timeChooserHint: { color: color.muted, fontSize: 11 },
  timeChooserHintSelected: { color: "rgba(255,255,255,0.68)" },
  momentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  momentCell: { gap: 3, width: "48%" },
  momentImage: { borderRadius: 12, height: 120, width: "100%" },
  momentImageMissing: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 12, height: 120, justifyContent: "center", width: "100%" },
  momentLabel: { color: color.ink, fontSize: 12, fontWeight: "700" },
  momentCopy: { color: color.ink, fontSize: 14, fontWeight: "700", lineHeight: 20, marginTop: 10, textAlign: "center" },
  sceneRail: { gap: 10, paddingRight: 16, paddingVertical: 4 },
  sceneCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 3, padding: 11, width: 208 },
  sceneCardName: { color: color.ink, fontSize: 14, fontWeight: "900" },
  sceneCardMeta: { color: color.muted, fontSize: 11, lineHeight: 15 },
  sceneCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  // 基线 .r157Action：white card，icon 块 + 标题/副标题 + 右侧数值。
  actionCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginVertical: 5,
    padding: 12,
    ...shadows.card
  },
  actionIcon: {
    alignItems: "center",
    backgroundColor: "#F3EDFF",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  actionCopy: { flex: 1 },
  actionTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  actionSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  actionTag: { backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  actionTagText: { color: color.ink, fontSize: 11, fontWeight: "800", lineHeight: 15 },

  // R15.34.1: 推荐人 mode 切换单行路由 — 不够就左右滑动
  //   走共享 FilterChipRail (见 components/filter-chip-rail.tsx)。
  //   这里只保留外层 marginTop。FilterChipRail 内部已带 PanResponder
  //   隔离外层 PAGE_SEQUENCE 切页。
  recommendModes: { marginTop: 4 },

  // R15.34: 推荐人 section 头
  peopleHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 18, marginBottom: 12 },
  peopleTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  peopleTitle: { color: color.ink, fontSize: 22, fontWeight: "800", lineHeight: 26 },
  humanBadge: { backgroundColor: "#EAF7EE", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  humanBadgeText: { color: "#18733B", fontSize: 11, fontWeight: "900" },
  peopleSceneTitle: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 5 },
  peopleSub: { color: color.muted, fontSize: 12, lineHeight: 16, marginTop: 4 },
  filterTrigger: { paddingHorizontal: 4, paddingVertical: 4 },
  filterTriggerText: { color: color.muted, fontSize: 13, fontWeight: "600" },

  // R15.34: stories 横滑
  stories: { marginHorizontal: -16 },
  storiesContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 8 },
  story: { alignItems: "center", minWidth: 92, maxWidth: 104 },
  avatar: {
    backgroundColor: color.lime,
    borderRadius: 999,
    height: 88,
    padding: 2,
    position: "relative",
    width: 88
  },
  avatarInner: {
    alignItems: "center",
    backgroundColor: "#F0ECE8",
    borderColor: color.offWhite,
    borderRadius: 999,
    borderWidth: 3,
    flex: 1,
    justifyContent: "center",
    width: "100%"
  },
  avatarInitials: { color: color.ink, fontSize: 24, fontWeight: "800" },
  avatarPhoto: { borderRadius: 999, height: "100%", width: "100%" },
  // 在线点挪到右上，给右下的 + 好友徽标让位。
  onlineDot: { backgroundColor: color.lime, borderColor: color.offWhite, borderRadius: 999, borderWidth: 2, height: 14, position: "absolute", right: 3, top: 3, width: 14 },
  // + 好友徽标：右下黑圆白字，加完变绿勾。真人 stories 和 AI 头像共用。
  addBadge: { alignItems: "center", backgroundColor: "#171715", borderColor: color.white, borderRadius: 999, borderWidth: 2, bottom: -2, height: 28, justifyContent: "center", position: "absolute", right: -2, width: 28 },
  addBadgeDone: { backgroundColor: "#18733B" },
  addBadgeText: { color: color.white, fontSize: 16, fontWeight: "900", lineHeight: 20 },
  aiAvatarWrap: { position: "relative" },
  followMsg: { color: color.muted, fontSize: 11, marginTop: 6, textAlign: "center" },
  // 为你组合 For You 独立主题头：4 宫格不再裸奔。
  forYouHead: { marginTop: 18, marginBottom: 4 },
  forYouBadge: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  forYouBadgeText: { color: color.violet, fontSize: 11, fontWeight: "900" },
  storyName: { color: color.ink, fontSize: 12, fontWeight: "700", marginTop: 5, textAlign: "center" },
  personReveal: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 7, marginTop: 8, padding: 13, ...shadows.card },
  personRevealHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  personRevealName: { color: color.ink, fontSize: 16, fontWeight: "900" },
  personRevealDistance: { color: color.muted, fontSize: 11, fontWeight: "700" },
  personRevealLine: { color: color.ink, fontSize: 12, lineHeight: 18 },
  personRevealLabel: { color: color.muted, fontWeight: "700" },
  personRevealReason: { backgroundColor: "#F1FFD0", borderRadius: 10, color: "#4D6200", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 2, paddingHorizontal: 9, paddingVertical: 7 },

  // R15.34: 继续进行卡片 (大 thumb + 标题 + 副标 + chevron)
  continueCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    marginVertical: 5,
    padding: 11,
    ...shadows.card
  },
  continueThumb: {
    alignItems: "center",
    backgroundColor: "#B7C9D2",
    borderRadius: 13,
    height: 52,
    justifyContent: "center",
    width: 62
  },
  continueThumbText: { color: color.white, fontSize: 18, fontWeight: "900" },
  continueCopy: { flex: 1 },
  continueTitle: { color: color.ink, fontSize: 14, fontWeight: "700" },
  continueSub: { color: color.muted, fontSize: 12, marginTop: 4 },
  continueChevron: { color: color.muted, fontSize: 22, fontWeight: "300" },

  // R15.34: 推荐筛选 sheet (覆盖层)
  sheetBackdrop: {
    backgroundColor: "rgba(0,0,0,0.32)",
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 50
  },
  sheet: {
    backgroundColor: color.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    bottom: 0,
    left: 0,
    padding: 18,
    paddingBottom: 32,
    position: "absolute",
    right: 0
  },
  sheetGrab: { alignSelf: "center", backgroundColor: "#DDD", borderRadius: 4, height: 4, marginBottom: 14, width: 42 },
  sheetTitle: { color: color.ink, fontSize: 20, fontWeight: "800", marginBottom: 12 },
  filterChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  filterChipOn: { backgroundColor: color.lime, borderColor: color.lime },
  filterChipText: { color: color.ink, fontSize: 13, fontWeight: "600" },
  filterChipTextOn: { color: color.ink, fontWeight: "800" },
  sheetApplyBtn: { backgroundColor: color.ink, borderRadius: 16, marginTop: 18, padding: 13 },
  sheetApplyText: { color: color.white, fontSize: 14, fontWeight: "800", textAlign: "center" },
});

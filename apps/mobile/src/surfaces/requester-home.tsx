// RequesterHome（稳定 Surface，R15.12.7 rhome）：
// r157HomeTop + r1572HomeComposer('USER') + 继续/2项 + r157Action 周六新店开业 + r157Action 周末摄影散步
// + r157MarketPulse + bottom。无 hero / attention / teaser / rail / quick / reusable。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（rhome，HTML 5197-5203）。
// Experience Runtime 插槽：top_context banner 由 SurfacePlan 驱动（§10 Slots），本地态不被 Delta 覆盖（§15.1）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";
import type { HardDemandCategory } from "../uiplan/types";
import type { DemandClient, RequesterHomeDraftItem, RequesterHomeTaskItem } from "../demand-client";
import type { MarketplaceClient } from "../marketplace-client";
import type { ActivityClient } from "../activity-client";
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
  onOpenHumanProfile,
  viewerAccountId,
  onCreateScene,
  onOpenSceneMap,
  sceneApiBaseUrl,
  onChromeVisibilityChange,
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
  onOpenHumanProfile?: (person: RecommendPerson) => void;
  viewerAccountId?: string;
  onCreateScene?: ((tool: SceneToolId) => void) | undefined;
  onOpenSceneMap?: ((sceneId?: string) => void) | undefined;
  sceneApiBaseUrl?: string | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode | undefined>("SERVICE");
  const [continueItems, setContinueItems] = useState<ReadonlyArray<ContinueCard>>(PLACEHOLDER_ITEMS);
  // R15.34: 推荐人模式。当前选中的 mode (e.g. PHOTO) 决定
  // SCENE_RECOMMEND 里取哪份推荐列表。默认走 PHOTO — 首页打开就
  // 看到摄影好搭子。
  const [recommendMode, setRecommendMode] = useState<string>(RECOMMEND_MODE_ORDER[0]!);
  // R15.34: 筛选 sheet 开 / 关 + 已选 chip。空数组 = "全部"。
  const [filterSheetOpen, setFilterSheetOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<ReadonlyArray<string>>([]);
  const [recommendedAI, setRecommendedAI] = useState<PlatformAIAccount[]>(BUNDLED_AI_COMPANIONS);
  const [selectedAIAccount, setSelectedAIAccount] = useState<PlatformAIAccount>();

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
  // R15.22 fix: 市场脉动计数状态.
  //   - opportunityCount: server 端 ListMarketOpportunities 返的 list 长度
  //   - activityCount:    server 端 ListActivities 返的 list 长度
  //   - experienceCount:  R15.49 接入 server ListExperiences 返 list 长度,
  //     替换 r157 基线 24 hardcode.
  //   - pulseState: "idle" | "loading" | "loaded" | "error"
  //     初始 state="loading", 拉成功→loaded, 失败→error 但继续展示
  //     最后已知计数 (或 fallback) — 与 homeItemsState 互不干扰.
  const [opportunityCount, setOpportunityCount] = useState<number | null>(null);
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const [experienceCount, setExperienceCount] = useState<number | null>(null);
  const [pulseState, setPulseState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
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

  // R36.x STORE-ACTIVITY-001: 店铺场景活动推荐（公开 listActivities，
  // 免登录）。本店（Three Beans）优先排前，其次按时间。
  type StoreActivityBrief = { activityId: string; title: string; venueName: string; time: string; joined: number; capacity: number };
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
        }));
        setStoreActivities(briefs);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activities]);

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

  // R15.22 fix: 市场脉动计数 (机会/活动) 从 server 拉 — 替代 r157MarketPulse
  // 硬编码 24/46/18. R15.49 把"体验 24"也接入 ListExperiences.
  // marketplace / activities / experiences 跟 demandClient 同样为 undefined 表示匿名
  // (R15.22 WIP 期间, 上层可能未传), 跟 homeItemsState 一样保持
  // placeholder, 不报 "加载失败".
  useEffect(() => {
    if (!marketplace && !activities && !experiences) {
      setPulseState("idle");
      return;
    }
    let cancelled = false;
    setPulseState("loading");
    (async () => {
      // 并行拉取, 各自包 try/catch — 某个失败不影响另一个.
      const next: { opportunityCount: number | null; activityCount: number | null; experienceCount: number | null; anyError: boolean } = {
        opportunityCount: null,
        activityCount: null,
        experienceCount: null,
        anyError: false
      };
      if (marketplace) {
        try {
          const opportunities = await marketplace.list();
          if (cancelled) return;
          next.opportunityCount = opportunities.length;
        } catch {
          next.anyError = true;
        }
      }
      if (activities) {
        try {
          const list = await activities.listActivities();
          if (cancelled) return;
          next.activityCount = list.length;
        } catch {
          next.anyError = true;
        }
      }
      if (experiences) {
        try {
          const list = await experiences.listExperiences();
          if (cancelled) return;
          next.experienceCount = list.length;
        } catch {
          next.anyError = true;
        }
      }
      if (cancelled) return;
      if (next.opportunityCount !== null) setOpportunityCount(next.opportunityCount);
      if (next.activityCount !== null) setActivityCount(next.activityCount);
      if (next.experienceCount !== null) setExperienceCount(next.experienceCount);
      setPulseState(next.anyError ? "error" : "loaded");
    })();
    return () => {
      cancelled = true;
    };
  }, [marketplace, activities, experiences]);
  const lastYRef = useRef(0);
  const dirRef = useRef(0);
  const visibleRef = useRef(true);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastYRef.current;
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
            setSelectedAIAccount(undefined);
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
            onPress={() => onOpenHumanProfile?.(p)}
            style={styles.story}
            accessibilityLabel={`推荐人 ${p.name}，${p.online ? "在线" : "离线"}`}
          >
            <View style={styles.avatar}>
              <View style={styles.avatarInner}>
                {p.photoUri ? <Image source={{ uri: p.photoUri }} style={styles.avatarPhoto} /> : <Text style={styles.avatarInitials}>{p.initials}</Text>}
              </View>
              {p.online ? <View style={styles.onlineDot} /> : null}
            </View>
            <Text style={styles.storyName} numberOfLines={1}>{p.name}</Text>
          </Pressable>
        ))}
      </HorizontalSwipeRail>

      <View style={styles.loadMoreRow}>
        <Text style={styles.loadMoreText}>
          继续刷 · <Text style={styles.loadMoreCount}>{filteredPeople.length}</Text>/{recommendFeed.people.length}
        </Text>
      </View>

      {recommendedAI.length > 0 ? <View style={styles.aiSection}>
        <View style={styles.aiSectionHead}>
          <View><Text style={styles.aiTitle}>AI 推荐</Text><Text style={styles.aiSub}>先看她为什么适合当前场景</Text></View>
          <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI 生成</Text></View>
        </View>
        <HorizontalSwipeRail style={styles.aiRail} contentContainerStyle={styles.aiRailContent}>
          {recommendedAI.map((account) => (
            <Pressable key={account.accountId} accessibilityLabel={`查看${account.displayName}的场景匹配`} onPress={() => setSelectedAIAccount((current) => current?.accountId === account.accountId ? undefined : account)} style={styles.aiCard}>
              <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`ai-avatar:${account.accountId}:${account.avatarVersion ?? 1}`} source={aiAccountPhoto(account)} style={styles.aiAvatar} transition={0} />
              <Text style={styles.aiName} numberOfLines={1}>{account.displayName}</Text>
              <Text style={styles.aiHandle} numberOfLines={1}>AI 生成</Text>
            </Pressable>
          ))}
        </HorizontalSwipeRail>
        {selectedAIAccount ? <View style={styles.aiScenePreview} testID="ai-scene-preview">
          <View style={styles.aiScenePreviewHead}><View><Text style={styles.aiSceneEyebrow}>AI 小美 × 当前 Scene</Text><Text style={styles.aiSceneName}>{selectedAIAccount.displayName} · {selectedAIAccount.role}</Text></View><View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI 生成</Text></View></View>
          <Text style={styles.aiSceneContext}>{recommendFeed.title}</Text>
          <Text style={styles.aiSceneReason}>{selectedAIAccount.description}</Text>
          <Text style={styles.aiSceneFit}>为什么推荐：{selectedAIAccount.personality}；适合围绕“{recommendFeed.subtitle}”聊天、陪伴或一起生成 UGC 灵感。</Text>
          <Text style={styles.aiSceneBoundary}>她没有实体到场能力，不接单、不报名活动，也不产生到访或履约证明。</Text>
          <Pressable onPress={() => onOpenAIProfile?.(selectedAIAccount)} style={styles.aiProfileButton}><Text style={styles.aiProfileButtonText}>查看完整主页</Text></Pressable>
          <Text style={styles.aiProfileHint}>添加好友和发消息在个人主页继续</Text>
        </View> : null}
      </View> : null}
      {/* 基线 .r1572HomeComposer('USER')：HomeChatBox（无示例 / 无提示） */}
      {conversationPanel ?? (onChat ? (
        <HomeChatBox
          contextLabel="用户"
          placeholder="例如：周六下午想在西湖拍照"
          mode={intentMode}
          onSelectMode={(mode) => {
            setIntentMode((current) => current === mode ? undefined : mode);
          }}
          onSend={(text, mode, attachment) => onChat(text, mode, attachment)}
        />
      ) : null)}

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

      {/* R15.22 fix: 市场脉动计数 (机会 / 活动) 从 server 拉, 体验 仍使用 r157
          基线 24 作 fallback (ListExperiences 暂未联). 拉倒后空闲, onPress
          仍走 "OPPORTUNITY" — R15.22 WIP 期间保持 visual baseline, 待
          owner 补 ListExperiences 后再加 experience tab. */}
      <Pressable onPress={() => onOpenMarket?.("OPPORTUNITY")} style={styles.marketPulse}>
        <View style={styles.marketPulseGradient}>
          <View style={styles.marketPulseCopy}>
            <Text style={styles.marketPulseTitle}>市场正在发生</Text>
            <Text style={styles.marketPulseDesc}>体验、机会、活动。</Text>
          </View>
          <View style={styles.marketPulseNums}>
            {(
              [
                [experienceCount !== null ? String(experienceCount) : "—", "体验"],
                [opportunityCount !== null ? String(opportunityCount) : "—", "机会"],
                [activityCount !== null ? String(activityCount) : "—", "活动"]
              ] as const
            ).map(([value, label]) => (
              <View key={label} style={styles.marketPulseNum}>
                <Text style={styles.marketPulseValue}>{value}</Text>
                <Text style={styles.marketPulseNumLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      </Pressable>

      {/* R15.34: 推荐筛选 sheet — 5 个 chip 叠加过滤 (多选)。
          打开时为模态，点击遮罩或"应用"按钮关闭。
          隐藏在 screen 之外 (right: -1000)，状态控制位置/不透明。 */}
      {filterSheetOpen ? (
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setFilterSheetOpen(false)}
          accessibilityLabel="关闭筛选"
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
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
          </Pressable>
        </Pressable>
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
  aiScenePreview: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginHorizontal: 16, marginTop: 4, padding: 14, ...shadows.card }, aiScenePreviewHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, aiSceneEyebrow: { color: color.violet, fontSize: 10, fontWeight: "900", letterSpacing: 0.4 }, aiSceneName: { color: color.ink, fontSize: 16, fontWeight: "900", marginTop: 4 }, aiSceneContext: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 12 }, aiSceneReason: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 5 }, aiSceneFit: { backgroundColor: color.proxyPurpleSoft, borderRadius: 12, color: color.ink, fontSize: 11, lineHeight: 17, marginTop: 9, padding: 10 }, aiSceneBoundary: { color: color.muted, fontSize: 10, lineHeight: 15, marginTop: 8 }, aiProfileButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, marginTop: 12, paddingVertical: 11 }, aiProfileButtonText: { color: color.white, fontSize: 12, fontWeight: "900" }, aiProfileHint: { color: color.muted, fontSize: 10, marginTop: 7, textAlign: "center" },
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

  // 基线 .r157MarketPulse：dark 渐变底，radius 18，flex 左右；nums 3 格。
  marketPulse: {
    alignItems: "center",
    backgroundColor: color.deep,
    borderRadius: 24,
    flexDirection: "row",
    gap: 10,
    marginBottom: 6,
    marginTop: 12,
    overflow: "hidden",
    padding: 0,
    ...shadows.card
  },
  marketPulseGradient: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
    width: "100%"
  },
  marketPulseCopy: { flex: 1 },
  marketPulseTitle: { color: color.white, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  marketPulseDesc: { color: "#D8CFDC", fontSize: 11, lineHeight: 15, marginTop: 3 },
  marketPulseNums: { flexDirection: "row", gap: 5 },
  marketPulseNum: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 16, paddingHorizontal: 8, paddingVertical: 7 },
  marketPulseValue: { color: color.white, fontSize: 20, fontWeight: "900", lineHeight: 24, textAlign: "center" },
  marketPulseNumLabel: { color: "#D4CAD9", fontSize: 11, lineHeight: 15, textAlign: "center" },

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
  story: { alignItems: "center", minWidth: 64, maxWidth: 80 },
  avatar: {
    backgroundColor: color.lime,
    borderRadius: 999,
    height: 62,
    padding: 2,
    position: "relative",
    width: 62
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
  avatarInitials: { color: color.ink, fontSize: 18, fontWeight: "800" },
  avatarPhoto: { borderRadius: 999, height: "100%", width: "100%" },
  onlineDot: { backgroundColor: color.lime, borderColor: color.offWhite, borderRadius: 999, borderWidth: 2, bottom: 2, height: 11, position: "absolute", right: 2, width: 11 },
  storyName: { color: color.ink, fontSize: 12, fontWeight: "700", marginTop: 5, textAlign: "center" },
  personReveal: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, gap: 7, marginTop: 8, padding: 13, ...shadows.card },
  personRevealHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  personRevealName: { color: color.ink, fontSize: 16, fontWeight: "900" },
  personRevealDistance: { color: color.muted, fontSize: 11, fontWeight: "700" },
  personRevealLine: { color: color.ink, fontSize: 12, lineHeight: 18 },
  personRevealLabel: { color: color.muted, fontWeight: "700" },
  personRevealReason: { backgroundColor: "#F1FFD0", borderRadius: 10, color: "#4D6200", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 2, paddingHorizontal: 9, paddingVertical: 7 },

  loadMoreRow: { alignItems: "center", marginTop: 4 },
  loadMoreText: { color: color.ink, fontSize: 12, fontWeight: "600" },
  loadMoreCount: { color: color.ink, fontSize: 12, fontWeight: "800" },

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

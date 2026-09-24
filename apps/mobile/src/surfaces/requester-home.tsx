// RequesterHome（稳定 Surface，R15.12.7 rhome）：
// r157HomeTop + r1572HomeComposer('USER') + 继续/2项 + r157Action 周六新店开业 + r157Action 周末摄影散步
// + r157MarketPulse + bottom。无 hero / attention / teaser / rail / quick / reusable。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（rhome，HTML 5197-5203）。
// Experience Runtime 插槽：top_context banner 由 SurfacePlan 驱动（§10 Slots），本地态不被 Delta 覆盖（§15.1）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScrollChrome } from "../shell/scroll-chrome";
import { type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { HomeSearchDock } from "../components/home-search-dock";
import { buildHomeSearchIndex, matchHomeSearchIntent, shouldSearchServerPeople, type HomeSearchSuggestion } from "../home-search-intent";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { resolveHomePersonAccountId } from "../recommend-fixtures";
import { color, shadows } from "../theme";
// HOME-I18N-001：语言选择。i18n 是模块级 store（不需要 Provider，不动
// app-shell），preferences 负责落盘，LanguageSheet 是原型那个选择面板。
import { GREETING_LINES, ICEBREAKER_LINES, useI18n, type MessageKey, type MessageVars } from "../i18n";
import { loadPreferences } from "../preferences";
import { LanguageSheet } from "../components/language-sheet";
import { SCENE_OPTIONS } from "./room-create";
import { useTrackedRefresh } from "../components/pull-to-refresh";
import { isInvited, loadGreetState, saveGreetState, type GreetState } from "../greet-state";
import type { ConversationInboxItem } from "../conversation-client";
import type { HardDemandCategory } from "../uiplan/types";
import type { DemandClient, RequesterHomeDraftItem, RequesterHomeTaskItem } from "../demand-client";
import type { LocalNetClient } from "../localnet-client";
import { buildCreatePostPayload, newPublishIdempotencyKey } from "../composer-publish";
import type { MarketplaceClient } from "../marketplace-client";
import type { ActivityClient } from "../activity-client";
import { ActivityCommandRejectedError, ActivityProtocolError } from "../activity-client";
import type { ExperienceClient } from "../experience-client";
import type { AIAccountClient, PlatformAIAccount } from "../ai-account-client";
import type { RelationshipClient } from "../relationship-client";
import type { ProfileClient, ProfileWire } from "../profile-client";
import { localApiBaseUrl } from "../native-clients";
import { aiAccountPhoto } from "../ai-persona-presentation";
import { BUNDLED_AI_COMPANIONS } from "../ai-companion-catalog";
import { type SceneToolId } from "@proxy/contracts";
import { FilterChipRail } from "../components/filter-chip-rail";
import { HorizontalSwipeRail } from "../components/horizontal-swipe-rail";
import { SCENE_ACTIONS, SceneActivityDiscovery } from "../components/scene-activity-discovery";
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
// 卡片**不存翻译好的字符串**，只存"哪个键 + 什么变量"，渲染时才 t()。
//
// 为什么：这两张卡是在一个只依赖 demandClient 的 effect 里从服务端数据投影出来的
// （见下面 continueItems 那个 useEffect）。如果在这里就把文案翻译好存进 state，
// 那么切语言时 **effect 不会重跑**（依赖没变），卡片会一直停在旧语言 ——
// 页面其余部分都换过去了，就这两张卡还留着上一次的语言。
//
// 另一个选项是给 effect 加 lang 依赖 —— 那会为了改两句文案去重新拉一次
// listHomeItems（一次网络往返）。存键不存串，就不需要那次请求。
type ContinueCard = {
  key: string;
  icon: ProxyIconName;
  title: string;
  subKey: MessageKey;
  subVars?: MessageVars;
  progress?: string;
  headcount?: string;
};

function projectDraft(d: RequesterHomeDraftItem): ContinueCard {
  return {
    key: `draft:${d.id}`,
    icon: "diamond",
    title: d.sourceInput,
    subKey: "draftProgress",
    subVars: { p: d.draftProgress },
    progress: `${d.draftProgress}%`
  };
}

function projectTask(item: RequesterHomeTaskItem): ContinueCard {
  return {
    key: `task:${item.id}`,
    icon: "circle",
    title: item.sourceInput,
    subKey: "publishedWaiting"
  };
}

// HOME-FRIEND-ID-001（2026-09-22 修）：首页真人卡用的是本地 fixture id
// （u_linh），服务端账号是 user_mockcreator_linh；而关系链状态表是按服务端
// 账号 id 建的（见本文件 listMyFriendships 那段：next.set(item.userId, …)）。
// 两边对不上，于是两个症状同时存在：
//   ① 点 + 把 fixture id 当 targetUserId 发出去 → 申请落在**不存在的账号**上，
//      没有真人能收到同意入口（库里攒了 12 条无人可同意的 PENDING）；
//   ② 即使对方同意了，卡片也永远显示「+ 添加」，因为按 u_linh 查不到状态。
// resolveHomePersonAccountId 是唯一的事实源映射（recommend-fixtures）。
//
// HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）：上一版在这里把「没账号的 fixture
// 人」当成正常情况处理 —— 不发申请、不读状态，只回一句「还没有账号，暂时加不了
// 好友」。那只是把错误说得更礼貌：列表顶着「真人」徽标，点进去却不能加。
// 现在 rail 上 28 个人全部有服务端账号，relationshipKeyFor 不再返回 undefined；
// 这条早退分支保留为最后一道闸（fixture 与服务端再次漂移时仍然不发幽灵申请，
// 并会被 requester-home-friend-id.test.ts 的「accountless 必须为空」钉红）。
function relationshipKeyFor(id: string): string | undefined {
  const resolved = resolveHomePersonAccountId(id);
  return resolved.startsWith("u_") ? undefined : resolved;
}

export function RequesterHome({
  onEnterWorkspace,
  onOpenMarket,
  onOpenFeed,
  onChat,
  onOpenAssistantConversation,
  conversationPanel,
  topContext,
  demandClient,
  localNet,
  marketplace,
  activities,
  experiences,
  aiAccounts,
  relationship,
  profileClient,
  onMessageAI,
  onOpenAIProfile,
  onOpenHumanScene,
  onOpenHumanProfile,
  onMessageHuman,
  onGreetHuman,
  onOpenRoomCreate,
  loadRooms,
  onOpenRoom,
  moreRoomLayer,
  moreRoomLayerOpen,
  viewerAccountId,
  isGuest,
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
  onOpenAssistantConversation?: (() => void) | undefined;
  conversationPanel?: ReactNode;
  topContext?: ReactNode;
  demandClient?: DemandClient;
  // Moment 发布到动态：调用方传入 localNet（发帖写接口），没传则不渲染发布按钮。
  localNet?: LocalNetClient;
  // R15.22 fix: 机会/活动计数从 API 拉, 替换 r157MarketPulse 硬编码 24/46/18.
  // server 端 ListMarketOpportunities / ListActivities 不限 actor, 匿名可读.
  marketplace?: MarketplaceClient;
  activities?: ActivityClient;
  // R15.49 — experience count 从 server 拉 (替换 hardcode 24).
  experiences?: ExperienceClient;
  aiAccounts?: AIAccountClient;
  relationship?: RelationshipClient;
  // HOME-PEOPLE-SEARCH-001: 全站真人搜索。没有它，首页人名搜索只能命中
  // 本地推荐预览，新注册用户永远搜不到。
  profileClient?: ProfileClient;
  onMessageAI?: (account: PlatformAIAccount) => void;
  onOpenAIProfile?: (account: PlatformAIAccount) => void;
  onOpenHumanScene?: (person: RecommendPerson, sceneId: string) => void;
  onOpenHumanProfile?: (person: RecommendPerson) => void;
  // HOME-MORE-SHEET-003: 原型的"拼桌/邀约"是先选一句破冰开场白，再带着它
  // 进对话——initialDraft 是这句话，真的会出现在聊天输入框里（不是原型
  // 那种"假装已发送"的静态动画），用户还能改了再发，不是替他点了发送。
  onMessageHuman?: (person: RecommendPerson, initialDraft?: string) => void;
  // HOME-MORE-GREET-001: 「邀约」= 直接发一句招呼（不进聊天页、不弹面板）。调用方负责真发
  // （PROFILE 源 DM，已有会话就续在里面），失败要 reject，这边才能说"没发出去"。
  // 返回 "awaiting_reply" = 已经连发 3 条、对方本人没回，这次没发（HOME-MORE-GREET-003）。
  // lines = 当前语言的招呼句子池；调用方避开跟这个人聊天里我已经发过的句子再随机挑一句。
  onGreetHuman?: (person: RecommendPerson, lines: ReadonlyArray<string>) => Promise<"sent" | "awaiting_reply">;
  // ROOM-CREATE-001: "创建房间"入口——把当前"更多"页可见的候选人交给调用方，
  // 由它打开创建房间流程（真实 GROUP conversation，见 room-create.tsx）。
  // HOME-MORE-ROOMS-001: sceneIndex = 开房大卡上点的场景 chip（SCENE_OPTIONS 下标），缺省 = 默认场景。
  onOpenRoomCreate?: (candidates: ReadonlyArray<RecommendPerson>, sceneIndex?: number) => void;
  // HOME-MORE-ROOMS-001: 「更多 → 聊天房」列表 —— 读我已有的房（GROUP + roomScene 的会话），
  // 点一行进房。没接（老调用方 / 测试）就不显示聊天房 chip。
  loadRooms?: () => Promise<ConversationInboxItem[]>;
  onOpenRoom?: (conversationId: string) => void;
  // HOME-MORE-ROOMS-002: 调用方渲染好的创建页 / 房间（overlay 形态），叠在「更多」整页
  // Modal 里面 —— 开房 / 进房不用先关「更多」，也就不会中间闪回首页。
  moreRoomLayer?: ReactNode;
  moreRoomLayerOpen?: boolean;
  viewerAccountId?: string;
  isGuest?: boolean;
  // 访客模式：不拉关系链、不弹关系失败提示。访客点 + 号走 handleHomeFriend
  // 里的"登录后可添加好友"，徽标无意义；且访客可能带着已失效的老 session
  //（PUBLIC 但 secure store 还有 userAccountId），此时拉必失败，弹了纯属噪音。
  onCreateScene?: ((tool: SceneToolId) => void) | undefined;
  onOpenSceneMap?: ((sceneId?: string) => void) | undefined;
  sceneApiBaseUrl?: string | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  onChooserVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
}): React.JSX.Element {
  const safeArea = useSafeAreaInsets();
  // Home Search/Conversation v3：常驻搜索 dock（原型 .searchDock）。
  // searchQuery 只驱动全站实体匹配；模型历史统一由消息模块持久化。
  const [searchQuery, setSearchQuery] = useState("");
  const [responseText, setResponseText] = useState<string>();
  const [responseWhy, setResponseWhy] = useState<string>();
  const [clarifyQuestion, setClarifyQuestion] = useState<string>();
  const [clarifyChoices, setClarifyChoices] = useState<ReadonlyArray<string>>();
  // HOME-PEOPLE-SEARCH-001: 全站真人结果（服务端 searchProfiles）。本地
  // people 索引只是推荐预览，新注册用户不在里面；够长且有 client 就问
  // 服务端，结果区独立展示，不断本地流程。
  const [serverPeople, setServerPeople] = useState<ReadonlyArray<ProfileWire> | undefined>(undefined);
  const [serverPeopleState, setServerPeopleState] = useState<"idle" | "busy" | "failed">("idle");
  const [serverPeopleQuery, setServerPeopleQuery] = useState("");
  const serverPeopleSeq = useRef(0);
  // 4 宫格：各槽位独立下标，点格子弹选择窗（弹窗控制格子），主页入口保留。
  const [personIndex, setPersonIndex] = useState(0);
  const [timeIndex, setTimeIndex] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);
  const [placeIndex, setPlaceIndex] = useState(0);
  const [chooser, setChooser] = useState<"person" | "time" | "activity" | "place" | null>(null);
  // HOME-AVATAR-FALLBACK-001: 真人头像挂了回落首字母（图走服务端 thumb；
  // 加载失败不断白圈）。与 ai-assistants-row 的 broken 集同 pattern，按人记。
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<ReadonlySet<string>>(new Set());
  const markAvatarBroken = (id: string): void => {
    setBrokenAvatarIds((current) => (current.has(id) ? current : new Set(current).add(id)));
  };
  const [momentOpen, setMomentOpen] = useState(false);
  const [momentBusy, setMomentBusy] = useState(false);
  const [momentMsg, setMomentMsg] = useState<string | undefined>(undefined);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | undefined>(undefined);
  const [continueItems, setContinueItems] = useState<ReadonlyArray<ContinueCard>>([]);
  // R15.34: 推荐人模式。当前选中的 mode (e.g. PHOTO) 决定
  // SCENE_RECOMMEND 里取哪份推荐列表。默认走 PHOTO — 首页打开就
  // 看到摄影好搭子。
  const [recommendMode, setRecommendMode] = useState<string>(RECOMMEND_MODE_ORDER[0]!);
  // R15.34: 筛选 sheet 开 / 关 + 已选 chip。空数组 = "全部"。
  const [filterSheetOpen, setFilterSheetOpen] = useState<boolean>(false);
  // HOME-MORE-ROOMS-001（2026-09-23，原型 deepseek_html_20260923_2308b7.html）：
  // 「更多」整页的「聊天房」chip 不再直接跳创建页，而是把下面的列表切成
  // 「开房大卡 + 正在进行的房间」。rooms 只在切进来时读，失败/空态分开显示。
  const [moreMode, setMoreMode] = useState<"people" | "rooms">("people");
  const [rooms, setRooms] = useState<{ status: "idle" | "loading" | "ready" | "failed"; items: ConversationInboxItem[] }>({ status: "idle", items: [] });
  const [activeFilters, setActiveFilters] = useState<ReadonlyArray<string>>([]);
  // HOME-MORE-SEARCH-001（2026-09-22，用户反馈"漏了一个搜索按钮 点击弹出框"）：
  // 跟 messages.tsx/feed.tsx 同一套图标切换 + 内联搜索框模式，本地按名字/简介
  // 过滤——"更多"页本来就是本地 fixture 预览，没有单独的服务端搜索可接。
  const [moreSearchOpen, setMoreSearchOpen] = useState<boolean>(false);
  const [moreSearchQuery, setMoreSearchQuery] = useState<string>("");
  // HOME-MORE-DIST-001：距离半径 + 距离面板。半径是**设置**（不是开关）——
  // 原型的 distance-chip 恒为深色、没有 off 态，点它是展开滑杆而不是开关。
  const [moreDistanceIndex, setMoreDistanceIndex] = useState<number>(MORE_DISTANCE_DEFAULT_INDEX);
  const [moreDistanceOpen, setMoreDistanceOpen] = useState<boolean>(false);
  // HOME-I18N-001：语言。i18n 是模块级 store，这里只是它的一个消费者。
  // 冷启动时用落盘值覆盖一次（见下面的 effect），默认 zh。
  const { t, lang, option: appLangOption, rideTimes, setLanguage: applyLanguage } = useI18n();
  // PULL-REFRESH-001: 首页下拉 = 让下面几个加载 effect 重跑（nonce 进 deps），
  // 请求用 trackHomeLoad 包住，全部回来才收起转圈。「更多」真人列表也用同一套。
  const { refreshing: homeRefreshing, onRefresh: onHomeRefresh, nonce: homeRefreshNonce, track: trackHomeLoad } = useTrackedRefresh();
  const [languageSheetOpen, setLanguageSheetOpen] = useState<boolean>(false);

  // HOME-MORE-ROOMS-001: 读「我已有的房」。只认服务端真实的 GROUP 会话且带 roomScene ——
  // 没有公开可加入的房间目录（那需要独立的房间域），所以不画别人的房、不画假「加入」。
  // HOME-MORE-ROOMS-002: 创建页 / 房间关掉、回到聊天房列表时重读一次 —— 刚建的房、
  // 刚看过的未读数要跟着变。
  const roomLayerWasOpen = useRef(false);
  useEffect(() => {
    if (roomLayerWasOpen.current && !moreRoomLayerOpen && filterSheetOpen && moreMode === "rooms") refreshRooms();
    roomLayerWasOpen.current = moreRoomLayerOpen === true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreRoomLayerOpen]);

  function refreshRooms(): void {
    if (!loadRooms || isGuest) return;
    setRooms((prev) => ({ status: "loading", items: prev.items }));
    loadRooms()
      .then((items) => {
        const mine = items
          .filter((item) => item.conversation.conversationType === "GROUP" && item.conversation.roomScene !== undefined)
          .sort((a, b) => b.conversation.lastMessageAt.localeCompare(a.conversation.lastMessageAt));
        setRooms({ status: "ready", items: mine });
      })
      .catch(() => setRooms((prev) => ({ status: "failed", items: prev.items })));
  }
  // 破冰开场白跟着语言走（原来写死在模块级数组里，切语言不跟着变）。
  const icebreakerLines = ICEBREAKER_LINES[lang] ?? ICEBREAKER_LINES.zh;
  const [recommendedAI, setRecommendedAI] = useState<PlatformAIAccount[]>(BUNDLED_AI_COMPANIONS);
  type HomeRelationshipState = "NONE" | "OUTGOING" | "INCOMING" | "FRIEND";
  const [relationshipStates, setRelationshipStates] = useState<ReadonlyMap<string, HomeRelationshipState>>(() => new Map());
  const [relationshipBusyId, setRelationshipBusyId] = useState<string | undefined>(undefined);
  const [relationshipMsg, setRelationshipMsg] = useState<string | undefined>(undefined);
  const [humanScenePreview, setHumanScenePreview] = useState<{ person: RecommendPerson; sceneId: string } | undefined>(undefined);
  // HOME-MORE-SHEET-003: "更多真人"列表每行的破冰邀请——原型叫它 拼桌/邀约，
  // 不是加好友。选中的开场白进 initialDraft，真的带到聊天输入框里。
  const [icebreakerTarget, setIcebreakerTarget] = useState<RecommendPerson | undefined>(undefined);
  // HOME-MORE-GREET-001: 「邀约」= 一点就发一句招呼；失败 / 无法发送时顶部一行提示。
  // 挑哪一句由调用方定（它读得到跟这个人的聊天记录，能避开已经发过的句子）。
  // HOME-MORE-GREET-002（2026-09-23）：点下去立刻就是「已邀约」，请求在后台发 ——
  // StartConversation 带首条消息时服务端会**同步**生成真人账号的 AI 代回复再返回，
  // 等它回来才变状态 = 等对方回复。只有发送失败才撤回并提示。
  // HOME-MORE-GREET-003（2026-09-23，用户：「已邀约 切换到 home-更多 又重置了 … 可以发 3 条
  // 连续 超过没有回复等待回复吧 但是状态不能重置 必须要冷静 12H 后才能重置状态」）：
  //   - 「已邀约」落盘（greet-state.ts，按登录账号分开存），12 小时内切页面 / 重启都不重置；
  //   - 「已邀约」还能再点，再发一句；连发 3 条对方本人没回，就提示等回复、不再发。
  const [greetState, setGreetState] = useState<GreetState>({});
  const greetStateRef = useRef<GreetState>({});
  const greetInFlight = useRef<Set<string>>(new Set());
  const [greetMsg, setGreetMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    greetStateRef.current = {};
    setGreetState({});
    if (!viewerAccountId || isGuest) return;
    void loadGreetState(viewerAccountId, Date.now()).then((loaded) => {
      if (cancelled) return;
      greetStateRef.current = loaded;
      setGreetState(loaded);
    });
    return () => { cancelled = true; };
  }, [viewerAccountId, isGuest]);

  function writeGreetState(next: GreetState): void {
    greetStateRef.current = next;
    setGreetState(next);
    // 落盘失败不挡用户 —— 本次会话里状态照样对，最多是重启后提前回到「邀约」。
    if (viewerAccountId) void saveGreetState(viewerAccountId, next).catch(() => undefined);
  }

  function greet(person: RecommendPerson): void {
    if (isGuest) { setGreetMsg(t("greetLoginFirst")); return; }
    const accountId = resolveHomePersonAccountId(person.id);
    // 没有服务端账号的人发不出去（HOME-RAIL-ACCOUNT-001 之后 rail 人都应该有账号）——
    // 如实说，不假装发出去了。
    if (!onGreetHuman || accountId === person.id) { setGreetMsg(t("greetNoAccount", { name: person.name })); return; }
    if (greetInFlight.current.has(accountId)) return;
    const lines = GREETING_LINES[lang] ?? GREETING_LINES.zh;
    const previousAt = greetStateRef.current[accountId];
    const restore = (): void => {
      const next = { ...greetStateRef.current };
      if (previousAt === undefined) delete next[accountId]; else next[accountId] = previousAt;
      writeGreetState(next);
    };
    writeGreetState({ ...greetStateRef.current, [accountId]: Date.now() });
    setGreetMsg("");
    greetInFlight.current.add(accountId);
    onGreetHuman(person, lines)
      .then((outcome) => {
        // 没发出去（等回复）：已邀约状态保留，但冷静期不因为这次没发出的点击往后延。
        if (outcome === "awaiting_reply") {
          if (previousAt !== undefined) restore();
          setGreetMsg(t("greetAwaitReply", { name: person.name }));
        }
      })
      .catch(() => {
        restore();
        setGreetMsg(t("greetFailed"));
      })
      .finally(() => { greetInFlight.current.delete(accountId); });
  }
  const [publicHistoryOpen, setPublicHistoryOpen] = useState(false);

  useEffect(() => {
    onChooserVisibilityChange?.(chooser !== null);
    return () => {
      if (chooser !== null) onChooserVisibilityChange?.(false);
    };
  }, [chooser, onChooserVisibilityChange]);

  // HOME-I18N-001：冷启动读一次落盘语言。放在 effect 里而不是模块顶层 ——
  // 模块顶层就 await 会让 i18n 反过来依赖 SecureStore，测试里就没法直接
  // import 它了（见 i18n.ts 文件头约束 1）。
  useEffect(() => {
    void loadPreferences().then((prefs) => applyLanguage(prefs.language));
  }, [applyLanguage]);

  // 查询一改，全站结果即过期：不清掉会把上一个词的人挂在新查询下面。
  useEffect(() => {
    serverPeopleSeq.current += 1;
    setServerPeople(undefined);
    setServerPeopleState("idle");
  }, [searchQuery]);

  useEffect(() => {
    // GUEST-RELATIONSHIP-001: 访客不拉关系链。上面的 isGuest 注释解释了
    // 为什么：访客要么没 viewerAccountId（早退已拦），要么带着已失效的老
    // session（早退拦不住，拉必失败）。两种都不该弹"好友状态暂时无法加载"。
    // 切到访客时顺手清掉上一手的失败提示（同值 setState 不会重渲染）。
    if (isGuest) {
      setRelationshipMsg(undefined);
      return;
    }
    if (!relationship || !viewerAccountId) return;    let cancelled = false;
    void trackHomeLoad(relationship.listMyFriendships()).then((payload) => {
      if (cancelled) return;
      const next = new Map<string, HomeRelationshipState>();
      payload.active.forEach((item) => next.set(item.userId, "FRIEND"));
      payload.pending.forEach((item) => next.set(item.userId, item.direction === "INCOMING" ? "INCOMING" : "OUTGOING"));
      setRelationshipStates(next);
    }).catch(() => {
      if (!cancelled) setRelationshipMsg(t("relationshipLoadFailed"));
    });
    return () => { cancelled = true; };
  }, [relationship, viewerAccountId, isGuest, homeRefreshNonce]);

  // HOME-PEOPLE-SEARCH-001: 服务端用户转本地人物卡形状，供主页入口复用。
  // 主页按 userId 拉服务端数据，这里只传身份目标，不传业务断言。
  function profileWireToPerson(wire: ProfileWire): RecommendPerson {
    const name = wire.name || wire.handle || wire.userAccountId;
    const first = [...name.trim()][0] ?? "?";
    // 服务端搜出来的人自带 avatarPath（assets/<id>），转成 thumb 直出 ——
    // 之前这里直接丢掉，全站真人清一色灰首字母。不可见/失效的由卡片
    // onError 回落首字母（markAvatarBroken），不猜不编。
    const avatarAssetId = wire.avatarPath.startsWith("assets/")
      ? wire.avatarPath.slice("assets/".length).trim()
      : "";
    return {
      id: wire.userAccountId,
      name,
      initials: first.toUpperCase(),
      ...(avatarAssetId !== "" && !avatarAssetId.startsWith("avatar-")
        ? { photoUri: `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(avatarAssetId)}` }
        : {}),
      bio: [wire.handle ? `@${wire.handle.replace(/^@+/, "")}` : "", wire.city].filter(Boolean).join(" · "),
      tags: [],
      // PERSON-DISTANCE-ZERO-001: 不填距离。服务端没有这个人的坐标，
      // 填 0 会让详情页显示「0 m」并让人无条件通过「附近」筛选。
      online: false,
      mutualFriends: 0,
    };
  }

  async function runServerPeopleSearch(query: string, speak: boolean): Promise<void> {
    if (!profileClient) return;
    const seq = (serverPeopleSeq.current += 1);
    setServerPeople(undefined);
    setServerPeopleState("busy");
    setServerPeopleQuery(query);
    try {
      const found = await profileClient.searchProfiles(query);
      if (serverPeopleSeq.current !== seq) return;
      setServerPeople(found);
      setServerPeopleState("idle");
      if (speak) {
        setClarifyChoices(undefined);
        if (found.length > 0) {
          showResponse(t("foundPeople", { n: found.length }), t("foundPeopleSub"));
        } else {
          showResponse(
            t("notFoundQuery", { q: query }),
            t("notFoundQuerySub")
          );
        }
      }
    } catch {
      if (serverPeopleSeq.current !== seq) return;
      setServerPeople(undefined);
      setServerPeopleState("failed");
      if (speak) {
        setClarifyChoices(undefined);
        showResponse(t("serverSearchFailedTitle"), t("serverSearchFailedSub"));
      }
    }
  }

  // 关系链状态表按服务端账号 id 建；调用点给的多半是 fixture id（u_linh）。
  // 这两个包装把「界面用的 id」翻成「账号 id」再查，调用点不必各自记住这件事。
  function relationshipStateFor(id: string): HomeRelationshipState {
    const key = relationshipKeyFor(id);
    return key === undefined ? "NONE" : relationshipStates.get(key) ?? "NONE";
  }

  function relationshipBusyFor(id: string): boolean {
    const key = relationshipKeyFor(id);
    return key !== undefined && relationshipBusyId === key;
  }

  async function handleHomeFriend(id: string, name: string): Promise<void> {
    if (!relationship || !viewerAccountId) {
      setRelationshipMsg(t("loginToAddFriend"));
      return;
    }
    if (relationshipBusyId !== undefined) return;
    const key = relationshipKeyFor(id);
    if (key === undefined) {
      // 这个人只存在于本地 fixture，服务端没有账号。以前这里会把 fixture id
      // 当 targetUserId 发出去，落成一条永远没人能同意的申请。不发，说清楚。
      setRelationshipMsg(t("noAccountYet", { name }));
      return;
    }
    const current = relationshipStateFor(key);
    if (current === "OUTGOING" || current === "FRIEND") return;
    setRelationshipBusyId(key);
    setRelationshipMsg(undefined);
    try {
      const nextState: HomeRelationshipState = current === "INCOMING" ? "FRIEND" : "OUTGOING";
      if (current === "INCOMING") await relationship.acceptFriendRequest(key);
      else await relationship.sendFriendRequest(key);
      setRelationshipStates((prev) => {
        const next = new Map(prev);
        next.set(key, nextState);
        return next;
      });
      setRelationshipMsg(current === "INCOMING" ? t("becameFriends", { name }) : t("friendRequestSent", { name }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      setRelationshipMsg(
        reason.includes("self_forbidden") ? t("cannotAddSelf")
          : reason.includes("authenticated") || reason.includes("sign-in") ? t("loginToAddFriend")
            : t("friendActionFailed")
      );
    } finally {
      setRelationshipBusyId(undefined);
    }
  }

  function relationshipGlyph(id: string): string {
    if (relationshipBusyFor(id)) return "…";
    const state = relationshipStateFor(id);
    if (state === "FRIEND") return "✓";
    if (state === "OUTGOING") return "↗";
    if (state === "INCOMING") return "!";
    return "+";
  }

  function relationshipLabel(id: string, name: string): string {
    const state = relationshipStateFor(id);
    if (state === "FRIEND") return t("friendLabelFriend", { name });
    if (state === "OUTGOING") return t("friendLabelOutgoing", { name });
    if (state === "INCOMING") return t("friendLabelIncoming", { name });
    return t("friendLabelAdd", { name });
  }

  useEffect(() => {
    let cancelled = false;
    if (aiAccounts) void trackHomeLoad(aiAccounts.listRecommended()).then((accounts) => { if (!cancelled && accounts.length > 0) setRecommendedAI(accounts); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [aiAccounts, homeRefreshNonce]);

  // R15.34: 算当前 mode 的推荐 feed + 应用筛选过滤
  //   - filter: 多个 chip 可叠加 (附近 AND 最近活跃), 都需满足
  //   - "在线" 过滤：要求 person.online
  //   - "会中文" 过滤：要求 person.tags 里有 "会中文" lang tag
  //   - "共同好友" 过滤：要求 mutualFriends >= 1
  //   - "最近活跃" 过滤：要求 person.tags 里有 "最近活跃" social tag
  //   - 距离：半径来自「距离」控件（HOME-MORE-DIST-001），不再是写死的 1km
  // server 端接上后，filter 逻辑移过去；这里只负责本地预览。
  const recommendFeed: RecommendFeed = SCENE_RECOMMEND[recommendMode] ?? SCENE_RECOMMEND[RECOMMEND_MODE_ORDER[0]!]!;
  const recommendActionLabel = ({
    PHOTO: t("modePhoto"),
    COMPANION: t("modeCompanion"),
    COFFEE_MEAL: t("actionCoffeeMeal"),
    ACTIVITY: t("actionActivityTogether"),
    TRIP: t("actionTrip"),
    CREATOR: t("actionCreator"),
    TRANSLATE: t("modeTranslate"),
    MEDICAL: t("modeMedical")
  } as Record<string, string>)[recommendMode] ?? recommendFeed.title;
  const moreDistanceKm = MORE_DISTANCE_KM[moreDistanceIndex] ?? 10;
  const filteredPeople: ReadonlyArray<RecommendPerson> = recommendFeed.people.filter((p) => {
    if (activeFilters.includes("online") && !p.online) return false;
    if (activeFilters.includes("lang_zh") && !p.tags.some((t) => t.text === "会中文" && t.kind === "lang")) return false;
    // PERSON-DISTANCE-ZERO-001: 没有坐标的人不算「附近」—— 以前 distanceM 恒为 0，
    // 于是每个服务端真人都能通过 <1000m 的附近筛选。
    // HOME-MORE-DIST-001：半径改成用户可选（1~100km，默认 10km），但
    // 「距离未知 ≠ 很近」这条不变 —— 任何半径都排除 undefined。
    if (p.distanceM === undefined || p.distanceM >= moreDistanceKm * 1000) return false;
    // HOME-MORE-SEARCH-001: 按名字/简介本地过滤。
    const q = moreSearchQuery.trim().toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !p.bio.toLowerCase().includes(q)) return false;
    return true;
  });

  // R36.x SCENE-RECOMMEND-001: 真实场景列表（公开接口，免登录），用于
  // 地图入口真计数 + 场景推荐横滑。失败/未配置时保持空，不展示假场景。
  type SceneBrief = { id: string; name: string; area: string; type: string; description: string; best: string; active: boolean; imageUrl: string };
  const [sceneBriefs, setSceneBriefs] = useState<SceneBrief[]>([]);
  useEffect(() => {
    if (!sceneApiBaseUrl) return;
    let cancelled = false;
    void trackHomeLoad(fetch(`${sceneApiBaseUrl.replace(/\/$/, "")}/v1/reality-scenes`, { headers: { Accept: "application/json" } }))
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
  }, [sceneApiBaseUrl, homeRefreshNonce]);
  const activeSceneCount = sceneBriefs.filter((s) => s.active).length;
  const previewScene = humanScenePreview ? sceneBriefs.find((scene) => scene.id === humanScenePreview.sceneId) : undefined;
  const previewSceneImage = previewScene?.imageUrl
    ? (/^https?:\/\//i.test(previewScene.imageUrl) ? previewScene.imageUrl : sceneApiBaseUrl ? `${sceneApiBaseUrl.replace(/\/$/, "")}/${previewScene.imageUrl.replace(/^\//, "")}` : undefined)
    : undefined;
  const previewSceneOptions = humanScenePreview
    ? [
        ...(previewScene ? [previewScene] : []),
        ...sceneBriefs.filter((scene) => scene.id !== previewScene?.id && scene.imageUrl),
      ].slice(0, 2)
    : [];

  function applyHomeSearchSuggestion(s: HomeSearchSuggestion): void {
    setSearchQuery("");
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

  function showResponse(text: string, why: string = ""): void {
    setResponseText(text);
    setResponseWhy(why || text);
  }

  // 整组换（remix）— 与原型及四宫格 remix 按钮完全对齐
  function remixForYou(): void {
    if (filteredPeople.length > 1) setPersonIndex((current) => (current + 1) % filteredPeople.length);
    if (distinctTimes.length > 1) setTimeIndex((current) => (current + 1) % distinctTimes.length);
    if (storeActivities.length > 1) setActivityIndex((current) => (current + 1) % storeActivities.length);
    if (sceneBriefs.length > 1) setPlaceIndex((current) => (current + 1) % sceneBriefs.length);
    showResponse(t("recombo"), t("recomboSub"));
    setSearchQuery("");
    setClarifyChoices(undefined);
  }

  function refineHomeSearchSlot(slot: "person" | "time" | "activity" | "place"): void {
    setSearchQuery("");
    setClarifyChoices(undefined);
    setChooser(slot);
    if (slot === "person") {
      showResponse(t("swapPerson"), t("othersUnchanged"));
    } else if (slot === "place") {
      showResponse(t("swapScene"), t("othersUnchanged"));
    } else if (slot === "time") {
      showResponse(t("swapTime"), t("othersUnchanged"));
    } else {
      showResponse(t("swapActivity"), t("othersUnchanged"));
    }
  }

  // 对齐原型 execute(q) 核心自然语言与实体执行器：
  function handleExecuteHomeQuery(raw: string, attachment?: HomeAttachment): void {
    const q = (raw || "").trim();
    if (!q) return;

    // 1. 周末 -> 澄清问询
    if (q === "周末" || q.includes("周末有空")) {
      setClarifyQuestion(t("clarifyTimeQuestion"));
      setClarifyChoices([t("afternoon"), t("evening")]);
      showResponse(t("needTimeCondition"), t("needTimeConditionSub"));
      return;
    }

    // 2. 找人 / 换人 / 会中文
    if (q.includes("会中文") || q.includes("换个人") || q.includes("换人") || q.includes("找人")) {
      setClarifyChoices(undefined);
      refineHomeSearchSlot("person");
      return;
    }

    // 3. 太远 / 找场景 / 拍照
    if (q.includes("太远") || q.includes("近一点") || q.includes("找场景") || q.includes("拍照")) {
      setClarifyChoices(undefined);
      refineHomeSearchSlot("place");
      return;
    }

    // 4. 晚上 / 今晚 -> 只改时间
    if (q.includes("晚上") || q.includes("今晚")) {
      setClarifyChoices(undefined);
      const eveningIdx = distinctTimes.findIndex((t) => t.includes("晚"));
      if (eveningIdx >= 0) setTimeIndex(eveningIdx);
      showResponse(t("timeToTonight"), t("othersUnchanged"));
      return;
    }

    // 5. 散步 / City Walk -> 改活动
    if (q.includes("散步") || q.includes("City Walk") || q.includes("走走")) {
      setClarifyChoices(undefined);
      const walkIdx = storeActivities.findIndex((a) => a.title.includes("散步") || a.title.includes("Walk"));
      if (walkIdx >= 0) setActivityIndex(walkIdx);
      showResponse(t("activityToWalk"), t("othersUnchanged"));
      return;
    }

    // 6. 咖啡 -> 整体配好 (人/时间/活动/场景联动)
    if (q.includes("咖啡")) {
      setClarifyChoices(undefined);
      // IDENTITY-ID-001: 按身份 id 匹配，不再用显示名子串 —— 用户名可编辑、可重复，
      // 按名字找人在改名或存在同名用户时会串到别人身上。
      const linhIdx = filteredPeople.findIndex((p) => p.id === "u_linh");
      if (linhIdx >= 0) setPersonIndex(linhIdx);
      const coffeeActIdx = storeActivities.findIndex((a) => a.title.includes("咖啡"));
      if (coffeeActIdx >= 0) setActivityIndex(coffeeActIdx);
      const beanSceneIdx = sceneBriefs.findIndex((s) => s.name.toLowerCase().includes("bean"));
      if (beanSceneIdx >= 0) setPlaceIndex(beanSceneIdx);
      showResponse(t("coffeeCombo"), t("coffeeComboSub"));
      return;
    }

    // 7. 配一套 / 随便
    if (q.includes("配一套") || q.includes("随便") || q.includes("换一套")) {
      remixForYou();
      return;
    }

    // 8. 搜索词直接匹配具体候选
    const consumedLocal = searchSuggestions.length > 0;
    if (consumedLocal) {
      applyHomeSearchSuggestion(searchSuggestions[0]!);
    }

    // 8b. HOME-PEOPLE-SEARCH-001: 全站真人兜底。本地 people 索引只是推荐
    // 预览，新注册用户不在里面；够长且有 client 就问服务端。本地命中也不拦
    // （同名会藏人），结果区独立展示，不断本地流程。
    if (shouldSearchServerPeople(q, !!profileClient)) {
      if (!consumedLocal) {
        setClarifyChoices(undefined);
        showResponse(t("searchingServer", { q }), t("searchingServerSub"));
      }
      void runServerPeopleSearch(q, !consumedLocal);
      return;
    }

    // 9. 无命中仍保持搜索语义。模型对话只能由左侧 AI 标识显式进入。
    if (!consumedLocal) {
      setClarifyChoices(undefined);
      showResponse(
        attachment ? t("imageNeedsChat") : t("notFoundQuery", { q }),
        t("notFoundQuerySub2")
      );
    }
  }

  // 活动数据只供四宫格“选活动”使用。完整活动发现和报名归市场活动模块，
  // Home 不再复制一条活动列表。
  type StoreActivityBrief = { activityId: string; title: string; venueName: string; time: string; joined: number; capacity: number; coverImageUrl: string | undefined; realitySceneId: string | undefined };
  const [storeActivities, setStoreActivities] = useState<StoreActivityBrief[]>([]);
  useEffect(() => {
    if (!activities) return;
    let cancelled = false;
    void trackHomeLoad(activities.listActivities())
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
  }, [activities, homeRefreshNonce]);

  // Home Search/Conversation v3 — 一个输入框同时做实体匹配和模型对话。
  // 索引里的四个分组**来源不一样**，别把它们混为一谈：
  //   - activities / scenes / times：来自上方已拉取的真实接口列表；
  //   - people：本地推荐预览 + 服务端全站（ProfileClient.searchProfiles，
  //     PROFILE-SEARCH-001 已上，HOME-PEOPLE-SEARCH-001 已接）：输入人名先匹配
  //     本地推荐，够长（≥2 码点）且有 ProfileClient 就再问服务端全站用户，
  //     结果独立展示。只看本地会漏掉新注册用户。
  // 列表为空时 lookup 自然无候选，输入直接走模型对话。
  const distinctTimes = [...new Set(storeActivities.map((a) => a.time).filter(Boolean))];
  const searchIndex = buildHomeSearchIndex({
    people: filteredPeople.map((p) => ({ id: p.id, name: p.name, bio: p.bio })),
    activities: storeActivities.map((a) => ({ id: a.activityId, title: a.title, venueName: a.venueName })),
    scenes: sceneBriefs.map((s) => ({ id: s.id, name: s.name, area: s.area, type: s.type })),
    times: distinctTimes
  });
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
          return t("joinAlready");
        case "ACTIVITY_FULL":
          return t("joinFull");
        case "ACTIVITY_NOT_FOUND":
          return t("joinGone");
        case "ACTIVITY_ACTOR_REQUIRED":
        case "AI_ACTION_FORBIDDEN":
          return t("sessionExpired");
        default:
          return t("joinFailed");
      }
    }
    if (error instanceof ActivityProtocolError) {
      // 本地就没有可用登录（principal 缺失/离线 fallback/已登出）才提登录；
      // 畸形响应走稍后重试。requireSession 把原错包了一层，只剩 message 可认。
      if (/principal is required|offline fallback|signed out|re-authenticate|sign in/i.test(error.message)) {
        return t("loginToJoin");
      }
      return t("joinFailed");
    }
    return t("networkError");
  }

  async function joinSelected(activityId: string | undefined): Promise<void> {
    setJoinMsg(undefined);
    if (!activityId) {
      setJoinMsg(t("pickActivityFirst"));
      return;
    }
    if (!activities) {
      setJoinMsg(t("loginToJoin"));
      return;
    }
    setJoinBusy(true);
    try {
      const result = await activities.join(activityId);
      setStoreActivities((prev) => prev.map((a) => (a.activityId === activityId ? { ...a, joined: result.activity.joined } : a)));
      setJoinMsg(t("joinedWithCount", { n: result.activity.joined }));
    } catch (e) {
      setJoinMsg(joinErrorMessage(e));
    } finally {
      setJoinBusy(false);
    }
  }

  useEffect(() => {
    if (!demandClient) {
      // Anonymous and untouched state have no active-work surface.
      setContinueItems([]);
      return;
    }
    let cancelled = false;
    void trackHomeLoad((async () => {
      // R15.22 fix: 匿名 session 没 principal, listHomeItems 调
      // requireSession() 立即抛 DemandProtocolError — 不应误报 "加载失败"
      // 由登录入口表达身份状态，不伪造“进行中”事项。
      // hasAuthenticatedSession 内部已包 try/catch, 但这里仍 wrap 一层以防意外.
      let hasSession = false;
      try {
        hasSession = await demandClient.hasAuthenticatedSession();
      } catch {
        hasSession = false;
      }
      if (!hasSession) {
        if (cancelled) return;
        setContinueItems([]);
        return;
      }
      try {
        const home = await demandClient.listHomeItems(10);
        if (cancelled) return;
        const cards: ContinueCard[] = [];
        for (const d of home.drafts) cards.push(projectDraft(d));
        for (const task of home.tasks) cards.push(projectTask(task));
        setContinueItems(cards);
      } catch {
        // Fail closed. Retain a previously loaded projection if one exists,
        // but never manufacture an active-work section from a read failure.
        if (cancelled) return;
      }
    })());
    return () => {
      cancelled = true;
    };
  }, [demandClient, homeRefreshNonce]);

  // SCROLL-CHROME-001: 共享控制器。卸载回显 chrome 也由它负责（与动态一致）：
  // 切走时壳会重置，内部替换（如进 Scene Composer）时靠这里复位，避免停在隐藏态。
  const onScroll = useScrollChrome(onChromeVisibilityChange);
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={homeRefreshing} onRefresh={onHomeRefresh} />} style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
      {topContext ?? null}
      {/* Home Search/Conversation v3（原型 .searchDock）：单行输入默认搜索；
          左侧 AI 标识显式进入消息模块中的唯一 Proxy AI 会话。 */}
      {onChat ? (
        <HomeSearchDock
          value={searchQuery}
          onChangeText={setSearchQuery}
          suggestions={searchSuggestions}
          onApplySuggestion={applyHomeSearchSuggestion}
          intentRemix={searchMatch.kind === "remix"}
          intentSlot={searchMatch.kind === "exchange" ? searchMatch.slot : null}
          onRemix={() => remixForYou()}
          onExchange={refineHomeSearchSlot}
          onExecute={handleExecuteHomeQuery}
          responseText={responseText}
          responseWhy={responseWhy}
          clarifyQuestion={clarifyQuestion}
          clarifyChoices={clarifyChoices}
          onSelectClarify={(c) => {
            setClarifyChoices(undefined);
            handleExecuteHomeQuery(c);
          }}
          onOpenConversation={() => onOpenAssistantConversation?.()}
        />
      ) : null}
      {/* HOME-PEOPLE-SEARCH-001: 全站真人结果。本地推荐是 fixture 预览，
          新注册用户只会出现在这里。点主页进对方主页，+ 直接加好友。 */}
      {serverPeople !== undefined && serverPeople.length > 0 ? (
        <View>
          <Text selectable style={styles.serverPeopleTitle}>{t("serverPeopleTitle", { n: serverPeople.length })}</Text>
          {serverPeople.map((person) => {
            const isSelf = !!viewerAccountId && person.userAccountId === viewerAccountId;
            const displayName = person.name || person.handle || person.userAccountId;
            const sub = [person.handle ? `@${person.handle.replace(/^@+/, "")}` : "", person.city].filter(Boolean).join(" · ");
            const state = relationshipStates.get(person.userAccountId) ?? "NONE";
            const busy = relationshipBusyId === person.userAccountId;
            return (
              <View key={`server-person:${person.userAccountId}`} style={styles.serverPeopleRow}>
                <View style={styles.serverPeopleCopy}>
                  <Text selectable style={styles.serverPeopleName}>{displayName}</Text>
                  {sub ? <Text selectable style={styles.serverPeopleSub}>{sub}</Text> : null}
                </View>
                <Pressable accessibilityLabel={`${displayName} · ${t("viewProfile")}`} onPress={() => onOpenHumanProfile?.(profileWireToPerson(person))}>
                  <Text selectable style={styles.serverPeopleAction}>{t("home")}</Text>
                </Pressable>
                {isSelf ? <Text selectable style={styles.serverPeopleSub}>{t("thisIsYou")}</Text> : (
                  <Pressable
                    accessibilityLabel={`${displayName} · ${t("addFriend")}`}
                    disabled={busy || state === "OUTGOING" || state === "FRIEND"}
                    onPress={() => void handleHomeFriend(person.userAccountId, displayName)}
                  >
                    <Text selectable style={styles.serverPeopleAction}>{state === "FRIEND" ? t("alreadyFriend") : state === "OUTGOING" ? t("requestSent") : t("addFriend")}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      {serverPeopleState === "failed" ? (
        <View style={styles.serverPeopleRow}>
          <Text selectable style={styles.serverPeopleSub}>{t("serverSearchFailed")}</Text>
          <Pressable
            accessibilityLabel={t("retryServerSearch")}
            onPress={() => { if (serverPeopleQuery) void runServerPeopleSearch(serverPeopleQuery, true); }}
          >
            <Text selectable style={styles.serverPeopleAction}>{t("retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {/* 点左侧 AI 标识后在 Home 内展开独立对话输入框；默认输入仍只搜索。 */}
      {conversationPanel ?? null}
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
            const actionIconId = modeId === "PHOTO" ? "photo" : modeId === "COMPANION" ? "city-walk" : modeId === "COFFEE_MEAL" ? "dining" : modeId === "ACTIVITY" ? "music" : modeId === "TRIP" ? "travel" : modeId === "CREATOR" ? "explore-store" : modeId === "TRANSLATE" || modeId === "HOSPITAL" ? "translation" : modeId === "MEDICAL" ? "urban-support" : "city-walk";
            return {
              id: modeId,
              assetIcon: SCENE_ACTIONS.find((action) => action.id === actionIconId)!.icon,
              label: feed ? (
                modeId === "PHOTO" ? t("modePhoto") : modeId === "COMPANION" ? t("modeCompanion") : modeId === "COFFEE_MEAL" ? t("modeMeal") : modeId === "ACTIVITY" ? t("modeActivity") : modeId === "TRIP" ? t("modeTrip") : modeId === "CREATOR" ? t("modeCreator") : modeId === "TRANSLATE" ? t("modeTranslate") : t("modeMedical")
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
          <View style={styles.peopleTitleRow}><Text selectable style={styles.peopleTitle}>{t("title")}</Text><View style={styles.humanBadge}><Text selectable style={styles.humanBadgeText}>{t("humanBadge")}</Text></View></View>
        </View>
        {/* HOME-I18N-002（2026-09-23）：语言入口不在首页页头，挪到「更多」整页的
            「中文」chip（见下方 filterChips）。 */}
        <Pressable onPress={() => setFilterSheetOpen(true)} style={styles.filterTrigger} accessibilityLabel={t("more")}>
          <Text selectable style={styles.filterTriggerText}>{t("more")}</Text>
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
            onPress={() => { setPublicHistoryOpen(false); setHumanScenePreview({ person: p, sceneId: recommendFeed.boundSceneId }); }}
            style={styles.story}
            // 用 chipOnline 而不是另立一个 online 键：原型里这两个键
            // （online / chipOnline）6 种语言的取值**完全相同**，留两份只会
            // 以后改一处漏一处。
            accessibilityLabel={`${p.name} · ${p.online ? t("chipOnline") : t("offline")}`}
          >
            <View style={styles.avatar}>
              <View style={styles.avatarInner}>
                {p.photoUri && !brokenAvatarIds.has(p.id) ? <Image source={{ uri: p.photoUri }} style={styles.avatarPhoto} onError={() => markAvatarBroken(p.id)} /> : <Text selectable style={styles.avatarInitials}>{p.initials}</Text>}
              </View>
              {p.online ? <View style={styles.onlineDot} /> : null}
              <Pressable
                onPress={() => void handleHomeFriend(p.id, p.name)}
                disabled={relationshipBusyFor(p.id) || relationshipStateFor(p.id) === "OUTGOING" || relationshipStateFor(p.id) === "FRIEND"}
                style={[styles.addBadge, relationshipStateFor(p.id) === "FRIEND" && styles.addBadgeDone, relationshipStateFor(p.id) === "OUTGOING" && styles.addBadgePending]}
                accessibilityLabel={relationshipLabel(p.id, p.name)}
              >
                <Text selectable style={styles.addBadgeText}>{relationshipGlyph(p.id)}</Text>
              </Pressable>
            </View>
            <Text selectable style={styles.storyName} numberOfLines={1}>{p.name}</Text>
          </Pressable>
        ))}
      </HorizontalSwipeRail>

      {relationshipMsg ? (
        <Text selectable style={styles.followMsg}>{relationshipMsg}</Text>
      ) : null}

      {/* AI-ROW-DUPE-001: 首页只保留一行 AI 推荐。曾经在这上面还挂了一条
          AI 助手横滑行（同一个组件、同一个服务端目录 /v1/ai/assistants），
          于是页面出现两条一模一样的 AI 生成横滑行。删掉上面那条，
          留下下面这条带「AI 生成」徽标的「AI 推荐」。再挂回去会被门禁挡下。 */}
      {recommendedAI.length > 0 ? <View style={styles.aiSection}>
        <View style={styles.aiSectionHead}>
          <View><Text selectable style={styles.aiTitle}>{t("aiRecommend")}</Text><Text selectable style={styles.aiSub}>{t("aiRecommendSub")}</Text></View>
          <View style={styles.aiBadge}><Text selectable style={styles.aiBadgeText}>{t("aiGenerated")}</Text></View>
        </View>
        <HorizontalSwipeRail style={styles.aiRail} contentContainerStyle={styles.aiRailContent}>
          {recommendedAI.map((account) => (
            <Pressable key={account.accountId} accessibilityLabel={t("viewProfileA11y", { name: account.displayName })} onPress={() => onOpenAIProfile?.(account)} style={styles.aiCard}>
              <View style={styles.aiAvatarWrap}>
                <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`ai-avatar:${account.accountId}:${account.avatarVersion ?? 1}`} source={aiAccountPhoto(account)} style={styles.aiAvatar} transition={0} />
                {/* AI-FRIEND-DEAD-PENDING-001（按钮级合规审计 2026-09-22）：
                    平台 AI 账号不会 accept 好友申请。旧的 + 号却走真人同一套
                    SendFriendRequest，于是生成一条永远卡在 PENDING 的死记录，
                    UI 还诚实地告诉用户「好友申请已发送」。

                    这个位置用户的真实意图是「接触她」；AI 已有完整发消息链，
                    所以 + 改成消息箭头，直接进对话。不是隐藏按钮，也不是弹一句
                    "AI 不接受"后什么都不做 —— 后者仍是死动作。

                    服务端 relationship 另有 AI 账号拒绝守卫（AI-FRIEND-REQUEST-001），
                    防 curl / 老客户端继续造 PENDING；这里解决当前产品语义。 */}
                <Pressable
                  onPress={(event) => { event.stopPropagation(); onMessageAI?.(account); }}
                  disabled={!onMessageAI}
                  style={styles.addBadge}
                  accessibilityLabel={t("messageToA11y", { name: account.displayName })}
                >
                  <Text selectable style={styles.addBadgeText}>↗</Text>
                </Pressable>
              </View>
              <Text selectable style={styles.aiName} numberOfLines={1}>{account.displayName}</Text>
              <Text selectable style={styles.aiHandle} numberOfLines={1}>{t("aiGenerated")}</Text>
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
                        if (filteredPeople.length > 1) setPersonIndex((current) => (current + 1) % filteredPeople.length);
              if (distinctTimes.length > 1) setTimeIndex((current) => (current + 1) % distinctTimes.length);
              if (storeActivities.length > 1) setActivityIndex((current) => (current + 1) % storeActivities.length);
              if (sceneBriefs.length > 1) setPlaceIndex((current) => (current + 1) % sceneBriefs.length);
            };
            const composed = [gridPerson ? t("withPerson", { name: gridPerson.name }) : "", gridTime ?? "", gridActivity ? gridActivity.title : "", gridPlace ? `@${gridPlace.name}` : ""].filter(Boolean).join(" ");
            const tiles = [
              gridPerson ? { key: `person:${gridPerson.id}`, slot: "person" as const, imageUri: gridPerson.photoUri, glyph: "●", label: gridPerson.name, sub: t("tilePersonSub") } : undefined,
              gridTime ? { key: `time:${gridTime}`, slot: "time" as const, imageUri: gridPlace?.imageUrl, glyph: "◷", label: gridTime, sub: gridPlace ? gridPlace.name : t("tileTime") } : undefined,
              gridActivity ? { key: `act:${gridActivity.activityId}`, slot: "activity" as const, imageUri: gridPlace?.imageUrl, glyph: "☕", label: gridActivity.title, sub: gridActivity.venueName } : undefined,
              gridPlace ? { key: `place:${gridPlace.id}`, slot: "place" as const, imageUri: gridPlace.imageUrl, glyph: "●", label: gridPlace.name, sub: t("tilePlace") } : undefined,
            ];
            return (
              <View>
                <View style={styles.forYouHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.peopleTitleRow}><Text selectable style={styles.peopleTitle}>{t("combo")}</Text><View style={styles.forYouBadge}><Text selectable style={styles.forYouBadgeText}>For You</Text></View></View>
                    <Text selectable style={styles.peopleSub}>{t("gridSub")}</Text>
                  </View>
                </View>
                <View style={styles.gridStage}>
                  <View style={styles.grid4}>
                    {tiles.map((t) => t ? (
                      <Pressable key={t.key} onPress={() => setChooser(t.slot)} style={styles.gridTile}>
                        {t.imageUri ? <Image source={{ uri: t.imageUri }} style={styles.gridImage} /> : <View style={styles.gridImageMissing}><Text selectable style={styles.gridGlyph}>{t.glyph}</Text></View>}
                        <View style={styles.gridOverlay}>
                          <Text selectable style={[styles.gridLabel, !t.imageUri && styles.gridLabelDark]} numberOfLines={1}>{t.label}</Text>
                          <Text selectable style={[styles.gridSub, !t.imageUri && styles.gridSubDark]} numberOfLines={1}>{t.sub}</Text>
                        </View>
                      </Pressable>
                    ) : null)}
                  </View>
                  <Pressable
                    accessibilityHint={t("changeAllHint")}
                    accessibilityLabel={t("changeAllLabel")}
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
                    <Text selectable style={styles.chainHint}>{t("chainHint")}</Text>
                    <View style={styles.gridCtaRow}>
                    <Pressable onPress={() => { setMomentMsg(undefined); setMomentOpen(true); }} style={[styles.gridCta, styles.gridCtaHalf]} accessibilityLabel={t("makeImageA11y")}>
                      <Text selectable style={styles.gridCtaTextSmall}>{t("makeImage")}</Text>
                    </Pressable>
                    <Pressable disabled={joinBusy} onPress={() => void joinSelected(gridActivity?.activityId)} style={[styles.gridCta, styles.gridCtaHalf]} accessibilityLabel={t("joinCtaA11y")}>
                      <Text selectable style={styles.gridCtaTextSmall}>{joinBusy ? t("joinInProgress") : t("joinCta")}</Text>
                    </Pressable>
                    <Pressable onPress={() => onOpenMarket?.("OPPORTUNITY")} style={[styles.gridCta, styles.gridCtaHalf]} accessibilityLabel={t("publishDemandA11y")}>
                      <Text selectable style={styles.gridCtaTextSmall}>{t("publishDemand")}</Text>
                    </Pressable>
                    </View>
                  </View>
                ) : null}
                {joinMsg ? <Text selectable style={styles.joinMsg}>{joinMsg}</Text> : null}
                {momentMsg && !momentOpen ? <Text selectable style={styles.joinMsg}>{momentMsg}</Text> : null}
                {chooser ? (
                  <Modal transparent animationType="fade" visible onRequestClose={() => setChooser(null)}>
                    <Pressable onPress={() => setChooser(null)} style={styles.sheetBackdrop}>
                      <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        <View style={styles.sheetGrab} />
                        <Text selectable style={styles.sheetTitle}>{chooser === "person" ? t("choosePerson") : chooser === "time" ? t("chooseTime") : chooser === "activity" ? t("chooseActivity") : t("choosePlace")}</Text>
                        {chooser === "person" ? (
                          <HorizontalSwipeRail contentContainerStyle={styles.personChooserRail}>
                            {filteredPeople.map((p, i) => {
                              const selected = i === personIndex % filteredPeople.length;
                              return (
                                <Pressable
                                  accessibilityLabel={t("chooseA11y", { name: p.name })}
                                  key={p.id}
                                  onPress={() => { setPersonIndex(i); setChooser(null); }}
                                  style={[styles.personChooserCard, selected && styles.personChooserCardSelected]}
                                >
                                  {p.photoUri && !brokenAvatarIds.has(p.id) ? (
                                    <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: p.photoUri }} style={styles.personChooserPhoto} transition={0} onError={() => markAvatarBroken(p.id)} />
                                  ) : (
                                    <View style={[styles.personChooserPhoto, styles.personChooserFallback]}><Text selectable style={styles.personChooserInitials}>{p.initials}</Text></View>
                                  )}
                                  <View style={styles.personChooserCopy}>
                                    <Text selectable numberOfLines={1} style={styles.personChooserName}>{p.name}</Text>
                                    <Text selectable numberOfLines={1} style={styles.personChooserBio}>{p.bio}</Text>
                                  </View>
                                  {selected ? <View style={styles.personChooserSelectedBadge}><ProxyIcon color={color.white} name="check" size={13} /></View> : null}
                                </Pressable>
                              );
                            })}
                          </HorizontalSwipeRail>
                        ) : chooser === "time" ? (
                          <HorizontalSwipeRail contentContainerStyle={styles.timeChooserRail}>
                            {distinctTimes.map((slot, i) => {
                              const selected = i === timeIndex % distinctTimes.length;
                              return (
                                <Pressable key={slot} onPress={() => { setTimeIndex(i); setChooser(null); }} style={[styles.timeChooserCard, selected && styles.timeChooserCardSelected]}>
                                  <ProxyIcon color={selected ? color.white : color.ink} name="clock" size={22} />
                                  <Text selectable numberOfLines={2} style={[styles.timeChooserValue, selected && styles.timeChooserValueSelected]}>{slot}</Text>
                                  <Text selectable style={[styles.timeChooserHint, selected && styles.timeChooserHintSelected]}>{selected ? t("currentChoice") : t("chooseSlot")}</Text>
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
                                    <Text selectable numberOfLines={1} style={styles.photoChooserName}>{a.title}</Text>
                                    <Text selectable numberOfLines={1} style={styles.photoChooserMeta}>{a.venueName}{a.time ? ` · ${a.time}` : ""}</Text>
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
                                    <Text selectable numberOfLines={1} style={styles.photoChooserName}>{s.name}</Text>
                                    <Text selectable numberOfLines={1} style={styles.photoChooserMeta}>{s.area}{s.type ? ` · ${s.type}` : ""}</Text>
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
                        <Text selectable style={styles.sheetTitle}>{t("inviteMoment")}</Text>
                        <View style={styles.momentGrid}>
                          {tiles.map((t) => t ? (
                            <View key={`m:${t.key}`} style={styles.momentCell}>
                              {t.imageUri ? <Image source={{ uri: t.imageUri }} style={styles.momentImage} /> : <View style={styles.momentImageMissing}><Text selectable style={styles.gridGlyph}>{t.glyph}</Text></View>}
                              <Text selectable style={styles.momentLabel} numberOfLines={1}>{t.label}</Text>
                            </View>
                          ) : null)}
                        </View>
                        <Text selectable style={styles.momentCopy} numberOfLines={2}>{composed}</Text>
                        {momentMsg && momentOpen ? <Text selectable style={styles.joinMsg}>{momentMsg}</Text> : null}
                        {localNet ? (
                          <Pressable
                            disabled={momentBusy}
                            onPress={() => {
                              if (momentBusy) return;
                              setMomentBusy(true);
                              setMomentMsg(undefined);
                              const payload = buildCreatePostPayload({
                                body: composed,
                                media: [],
                                visibility: "PUBLIC",
                                includeCity: true,
                                quoteTargetId: null,
                                place: null,
                                topic: null,
                                gifWord: null,
                                poll: { open: false, options: ["", ""], durationLabel: t("oneDay") },
                                isGhost24h: false,
                              });
                              void localNet.createPost(payload, newPublishIdempotencyKey()).then(() => {
                                setMomentOpen(false);
                                setMomentMsg(t("postedToFeed"));
                                // 发完直达动态：Tab 切换重挂 FeedSurface 即重新拉取，
                                // 新帖出现在最上面。之前停在首页，用户看不到结果。
                                onOpenFeed?.();
                              }).catch((error: unknown) => {
                                // 发布失败：sheet 留着，错误说明白，可重试。
                                // 游客/掉登录直接报英文原错等于没说，映射成人话。
                                const raw = error instanceof Error ? error.message : "";
                                if (/principal|signed|sign in|auth|session|401|403|INVALID_ACCESS_TOKEN|登录/i.test(raw)) {
                                  setMomentMsg(t("loginToPost"));
                                } else {
                                  setMomentMsg(raw || t("postFailed"));
                                }
                              }).finally(() => setMomentBusy(false));
                            }}
                            style={[styles.gridCta, { marginTop: 10 }]}
                            accessibilityLabel={t("postToFeed")}
                          >
                            <Text selectable style={styles.gridCtaText}>{momentBusy ? t("posting") : t("postToFeed")}</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          disabled={momentBusy}
                          onPress={() => {
                            if (momentBusy) return;
                            setMomentBusy(true);
                            setMomentMsg(undefined);
                            void Share.share({ message: composed }).then((result) => {
                              // 用户取消分享：静默关 sheet，不报“已分享”。
                              setMomentOpen(false);
                              if (!result || result.action === Share.sharedAction) setMomentMsg(t("inviteShared"));
                            }).catch(() => {
                              // 调起失败：sheet 保持打开并给重试机会，不吞错。
                              setMomentMsg(t("shareFailed"));
                            }).finally(() => setMomentBusy(false));
                          }}
                          style={[styles.gridCta, { marginTop: 10 }]}
                          accessibilityLabel={t("shareInvite")}
                        >
                          <Text selectable style={styles.gridCtaText}>{momentBusy ? t("sharing") : t("shareInviteCta")}</Text>
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

      {/* “继续进行”是状态机投影，不是常驻导航。只有服务端返回真实草稿/
          订单状态时才出现；0、匿名、初始加载和首次失败均不占首页空间。 */}
      {continueItems.length > 0 ? <View>
        <View style={styles.sectionHead}>
          <Text selectable style={styles.sectionTitle}>{t("continueSection")}</Text>
          <Text selectable style={styles.sectionHint}>{t("itemsCount", { n: continueItems.length })}</Text>
        </View>
        {continueItems.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onOpenMarket?.("OPPORTUNITY")}
            style={styles.continueCard}
            accessibilityLabel={`${t("continueSection")} ${item.title}`}
          >
            <View style={styles.continueThumb}>
              <Text selectable style={styles.continueThumbText}>{(item.title[0] ?? "?").toUpperCase()}</Text>
            </View>
            <View style={styles.continueCopy}>
              <Text selectable style={styles.continueTitle} numberOfLines={1}>{item.title}</Text>
              {/* HOME-I18N-001：渲染时才翻译 —— 卡片存的是 key，切语言这里跟着变。 */}
              <Text selectable style={styles.continueSub} numberOfLines={1}>{t(item.subKey, item.subVars)}</Text>
            </View>
            {item.progress !== undefined ? (
              <View style={styles.actionTag}>
                <Text selectable style={styles.actionTagText}>{item.progress}</Text>
              </View>
            ) : item.headcount !== undefined ? (
              <View style={styles.actionTag}>
                <Text selectable style={styles.actionTagText}>{item.headcount}</Text>
              </View>
            ) : (
              <Text selectable style={styles.continueChevron}>›</Text>
            )}
          </Pressable>
        ))}
      </View> : null}

      {/* Scene/Activity 是撮合完成后的见面道具，不抢人物发现首屏。
          放在进行中链路之后，并替代旧的重复“场景”横栏。 */}
      <View style={styles.sectionHead}>
        <Text selectable style={styles.peopleTitle}>{t("nearbyScenes")}</Text>
        <Pressable accessibilityLabel={t("nearbyScenes")} onPress={() => onOpenSceneMap?.()}>
          <Text selectable style={styles.filterTriggerText}>{t("map")}</Text>
        </Pressable>
      </View>
      <SceneActivityDiscovery
        apiBaseUrl={sceneApiBaseUrl}
        scenes={sceneBriefs}
        viewerAccountId={viewerAccountId}
        onOpenScene={(sceneId) => onOpenSceneMap?.(sceneId)}
        onCompose={(prompt) => handleExecuteHomeQuery(prompt)}
      />

      {humanScenePreview ? <Modal animationType="slide" onRequestClose={() => setHumanScenePreview(undefined)} visible>
        <View style={styles.humanScenePage}>
          <View style={[styles.humanSceneHeader, { height: 54 + safeArea.top, paddingTop: safeArea.top }]}><Pressable accessibilityLabel={t("backHome")} hitSlop={12} onPress={() => setHumanScenePreview(undefined)} style={styles.humanSceneBack}><Text selectable style={styles.humanSceneBackText}>{t("backShort")}</Text></Pressable><Text selectable style={styles.humanSceneHeaderTitle}>{t("humanProfile")}</Text><View style={styles.humanSceneHeaderSpacer} /></View>
            <ScrollView contentContainerStyle={styles.humanSceneContent} showsVerticalScrollIndicator={false}>
              <View style={styles.humanSceneTop}>
                <Text selectable style={styles.humanSceneEyebrow}>{humanScenePreview.person.online ? t("nearbyNowVisible") : t("nearbyRecommend")}</Text>
              </View>
              <View style={styles.humanScenePerson}>
                <View style={styles.humanSceneAvatarRing}>{humanScenePreview.person.photoUri && !brokenAvatarIds.has(humanScenePreview.person.id) ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: humanScenePreview.person.photoUri }} style={styles.humanSceneAvatar} transition={0} onError={() => markAvatarBroken(humanScenePreview.person.id)} /> : <Text selectable style={styles.humanSceneInitials}>{humanScenePreview.person.initials}</Text>}</View>
                <View style={styles.humanScenePersonCopy}>
                  <Text selectable style={styles.humanSceneName}>{humanScenePreview.person.name}</Text>
                  <Text selectable style={styles.humanSceneBio}>{humanScenePreview.person.bio}</Text>
                  {humanScenePreview.person.rating !== undefined && humanScenePreview.person.completedActivities !== undefined ? <Text selectable style={styles.humanSceneRating}>★ {humanScenePreview.person.rating.toFixed(1)} · {t("activityCount", { n: humanScenePreview.person.completedActivities })}</Text> : null}
                </View>
              </View>
              <View style={styles.humanSceneActionsTop}>
                <Pressable accessibilityLabel={relationshipLabel(humanScenePreview.person.id, humanScenePreview.person.name)} disabled={relationshipBusyFor(humanScenePreview.person.id) || relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" || relationshipStateFor(humanScenePreview.person.id) === "FRIEND"} onPress={() => void handleHomeFriend(humanScenePreview.person.id, humanScenePreview.person.name)} style={[styles.humanSceneTopAction, styles.humanSceneTopActionPrimary, (relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" || relationshipStateFor(humanScenePreview.person.id) === "FRIEND") && styles.humanSceneAddDone]}><Text selectable style={styles.humanSceneTopActionPrimaryText}>{relationshipBusyFor(humanScenePreview.person.id) ? t("adding") : relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" ? t("addingShort") : relationshipStateFor(humanScenePreview.person.id) === "FRIEND" ? t("added") : relationshipStateFor(humanScenePreview.person.id) === "INCOMING" ? t("acceptAdd") : t("addAction")}</Text></Pressable>
                <Pressable accessibilityLabel={t("viewProfile")} onPress={() => { const person = humanScenePreview.person; setHumanScenePreview(undefined); onOpenHumanProfile?.(person); }} style={styles.humanSceneTopAction}><Text selectable style={styles.humanSceneTopActionText}>{t("home")}</Text></Pressable>
                <Pressable accessibilityLabel={t("messageAction")} onPress={() => { const person = humanScenePreview.person; setHumanScenePreview(undefined); onMessageHuman?.(person); }} style={styles.humanSceneTopAction}><Text selectable style={styles.humanSceneTopActionText}>{t("messageAction")}</Text></Pressable>
              </View>
              {relationshipMsg ? <Text selectable style={styles.humanSceneNotice}>{relationshipMsg}</Text> : null}
              <View style={styles.humanSceneFacts}>
                <View style={styles.humanSceneFact}><ProxyIcon color="#DCE6F7" name="clock" size={18} /><Text selectable style={styles.humanSceneFactValue}>{humanScenePreview.person.availabilityText ?? t("availabilityUnknown")}</Text></View>
                <View style={styles.humanSceneFact}><ProxyIcon color="#DCE6F7" name="route" size={18} /><Text selectable style={styles.humanSceneFactValue}>{humanScenePreview.person.distanceM === undefined ? t("distanceUnknown") : humanScenePreview.person.distanceM < 1000 ? `${humanScenePreview.person.distanceM} m` : `${(humanScenePreview.person.distanceM / 1000).toFixed(1)} km`}</Text></View>
                <Pressable accessibilityLabel={t("viewPublicHistory")} onPress={() => setPublicHistoryOpen((open) => !open)} style={styles.humanSceneFact}><ProxyIcon color="#DCE6F7" name="check" size={18} /><Text selectable style={styles.humanSceneFactValue}>{humanScenePreview.person.completedActivities !== undefined ? t("historyCount", { n: humanScenePreview.person.completedActivities }) : t("noPublicPosts")}</Text></Pressable>
              </View>
              {publicHistoryOpen ? <View style={styles.humanSceneHistory}><View style={styles.humanSceneHistoryHead}><Text selectable style={styles.humanSceneHistoryTitle}>{t("publicActivity")}</Text><Text selectable style={styles.humanSceneHistoryPrivacy}>{t("privateHidden")}</Text></View>{humanScenePreview.person.publicActivityHistory?.length ? humanScenePreview.person.publicActivityHistory.map((item) => <View key={item.id} style={styles.humanSceneHistoryRow}><View style={styles.humanSceneHistoryCopy}><Text selectable style={styles.humanSceneHistoryName}>{item.title}</Text><Text selectable style={styles.humanSceneHistoryMeta}>{item.scene} · {item.dateLabel}</Text></View><Text selectable style={styles.humanSceneHistoryRating}>★ {item.rating.toFixed(1)}</Text></View>) : <Text selectable style={styles.humanSceneHistoryEmpty}>{t("noActivity")}</Text>}</View> : null}
              <Text selectable style={styles.humanSceneSectionTitle}>{t("whatSheCanDo")}</Text>
              <View style={styles.humanScenePills}>{humanScenePreview.person.capabilities?.map((item) => <View key={item} style={styles.humanScenePill}><Text selectable style={styles.humanScenePillText}>{item}</Text></View>)}</View>
              <Text selectable style={styles.humanSceneSectionTitle}>{t("relatedToRecommend")}</Text>
              <View style={styles.humanSceneLinkRow}>
                <View style={styles.humanSceneLinkChip}><Text selectable style={styles.humanSceneLinkLabel}>{t("currentAction")}</Text><Text selectable style={styles.humanSceneLinkValue}>{recommendActionLabel}</Text></View>
                <Pressable accessibilityLabel={t("viewFullScene")} onPress={() => { const current = humanScenePreview; setHumanScenePreview(undefined); onOpenHumanScene?.(current.person, current.sceneId); }} style={styles.humanSceneLinkCard}>
                  {previewSceneImage ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: previewSceneImage }} style={StyleSheet.absoluteFill} transition={0} /> : null}
                  <View style={styles.humanSceneLinkShade} />
                  <Text selectable style={styles.humanSceneLinkLabelLight}>{t("currentScene")}</Text><Text selectable style={styles.humanSceneLinkValueLight}>{previewScene?.name ?? humanScenePreview.person.sceneNames?.[0] ?? t("viewSceneFallback")} ›</Text>
                </Pressable>
                <View style={styles.humanSceneLinkChip}><Text selectable style={styles.humanSceneLinkLabel}>{t("currentTheme")}</Text><Text selectable style={styles.humanSceneLinkValue}>{humanScenePreview.person.themes?.slice(0, 2).join(" · ") || recommendFeed.sceneTag}</Text></View>
              </View>
              <View style={styles.humanSceneDetailCard}><Text selectable style={styles.humanSceneDetailTitle}>{t("relatedTheme")}</Text><Text selectable style={styles.humanSceneDetailText}>{humanScenePreview.person.themes?.join(" · ") || recommendFeed.sceneTag}</Text><Text selectable style={styles.humanSceneDetailTitle}>{t("suitableScenes")}</Text><Text selectable style={styles.humanSceneDetailText}>{humanScenePreview.person.sceneNames?.join(" · ") || previewScene?.name || t("sceneTagFallback")}</Text><Text selectable style={styles.humanSceneDetailTitle}>{t("language")}</Text><Text selectable style={styles.humanSceneDetailText}>{humanScenePreview.person.languages?.join(" · ") || t("languageFromProfile")}</Text></View>
              <View style={styles.humanSceneDetailCard}><Text selectable style={styles.humanSceneDetailTitle}>{t("reputation")}</Text>{humanScenePreview.person.rating !== undefined && humanScenePreview.person.positiveRate !== undefined && humanScenePreview.person.completedActivities !== undefined ? <Text selectable style={styles.humanSceneTrust}>{t("trustLine", { rating: humanScenePreview.person.rating.toFixed(1), rate: humanScenePreview.person.positiveRate, n: humanScenePreview.person.completedActivities })}</Text> : null}<Text selectable style={styles.humanSceneDetailText}>{humanScenePreview.person.reviewSummary ?? t("reviewSummaryEmpty")}</Text></View>
              {previewSceneOptions.length > 0 ? <>
                <View style={styles.humanSceneSceneHead}><Text selectable style={styles.humanSceneSectionTitle}>{t("canGoTogether")}</Text><Text selectable style={styles.humanSceneSceneHint}>{t("sceneSuggestions")}</Text></View>
                <View style={styles.humanSceneSceneRow}>{previewSceneOptions.map((scene) => {
                  const uri = /^https?:\/\//i.test(scene.imageUrl) ? scene.imageUrl : sceneApiBaseUrl ? `${sceneApiBaseUrl.replace(/\/$/, "")}/${scene.imageUrl.replace(/^\//, "")}` : undefined;
                  return <Pressable accessibilityLabel={t("viewSceneA11y", { name: scene.name })} key={scene.id} onPress={() => { const person = humanScenePreview.person; setHumanScenePreview(undefined); onOpenHumanScene?.(person, scene.id); }} style={styles.humanSceneSceneCard}>
                    {uri ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri }} style={StyleSheet.absoluteFill} transition={0} /> : null}<View style={styles.humanSceneSceneShade} /><Text selectable numberOfLines={1} style={styles.humanSceneSceneName}>{scene.name}</Text><Text selectable numberOfLines={1} style={styles.humanSceneSceneMeta}>{scene.area || scene.best || t("nearbySceneFallback")}</Text>
                  </Pressable>;
                })}</View>
              </> : null}
              <Text selectable style={styles.humanSceneReason}>{t("sceneReason")}</Text>
            </ScrollView>
        </View>
      </Modal> : null}

      {/* HOME-MORE-SHEET-001: 真人行右上角由“筛选”改为“更多”，底部弹出改为
          最新原型（deepseek 20260921 page-people/list-item）：顶部保留 4 个筛选
          chips（附近/最近活跃/会中文/在线，即时生效）+ 下方全员列表。行点头像/
          信息进 Scene 预览，右下 + 走真实好友申请，主页直达对方主页。 */}
      {filterSheetOpen ? (
        // HOME-MORE-SHEET-002（2026-09-22，用户反馈"为什么显示半页 不是整页"，
        // 照 deepseek_html_20260921_3970cc.html 的 page-people 重做）：原型里
        // 点"查看全部"进的是一个独立整页（page-nav 返回箭头 + 标题 + 筛选 chips
        // + 全屏列表），不是从底部弹起、盖住 85% 屏幕的 sheet。这里改成同一套
        // 全屏 Modal（跟下面 humanScenePreview 用的 animationType="slide" 一致），
        // 顶部换成真正的返回箭头 + 标题，列表占满剩余高度，去掉底部多余的
        // "完成"按钮——筛选即时生效，退出这页就是点返回，不需要再"应用"一次。
        <Modal animationType="slide" visible={filterSheetOpen} onRequestClose={() => setFilterSheetOpen(false)}>
          {/* HOME-MORE-SHEET-005（2026-09-22，用户反馈"更多 点返回没反应"）：
              这个整页 Modal 漏了顶部安全区。morePage 的 paddingTop 只有 8，
              而它是**非 transparent 的全屏 Modal**，内容从 y=0 起算 ⇒ 返回箭头
              落在状态栏/刘海那一条（现代 iPhone 是 47~59pt）里，那一条的触摸
              由系统状态栏接管，所以点上去"无响应"——不是 handler 没接。
              同文件的 humanSceneHeader（:1209）、scene-activity-discovery 的
              pickerPage、qr-zoom-overlay 的 header 都加了 inset，只有这里漏了。 */}
          <View style={[styles.morePage, { paddingTop: safeArea.top + 8 }]}>
            {/* HOME-MORE-SHEET-006（2026-09-22，用户反馈"真人推荐·N位的废话
                不要了，返回按钮放在附近筛选按钮旁边"）：去掉单独一行的标题栏，
                返回箭头直接并进筛选 chip 那一行，排在"附近"前面。 */}
            <View style={styles.filterChips}>
              <Pressable accessibilityLabel={t("back")} hitSlop={12} onPress={() => setFilterSheetOpen(false)} style={styles.morePageBackInline}>
                <Text selectable style={styles.morePageBackIcon}>‹</Text>
              </Pressable>
              {/* HOME-MORE-ROOMS-001：chip 行照原型 .filter-chips —— 单行横滑，返回箭头和
                  搜索固定在两端。之前 flexWrap 换行：语言 chip 显示「Tiếng Việt」这类长名、
                  或距离选到 100km 时，「聊天房」被挤到第二行，正好落进返回箭头的 hitSlop。 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterChipScroll} contentContainerStyle={styles.filterChipScrollContent}>
                {/* HOME-MORE-DIST-001（2026-09-22，照 deepseek_html_20260922_1c2e2c.html
                    的 distance-chip）：「附近」不再是一个写死 1km 的开关，而是原型的
                    距离控件 —— 深色药丸 + 📍 + 当前半径 + ▾。点它是展开滑杆
                    （1/3/5/10/20/50/100 km，默认 10km），不是开关：半径是**设置**，
                    恒生效。▾ 只在面板打开时翻转（跟原型同一条规则）。 */}
                <Pressable
                  accessibilityLabel={t("distanceChipA11y", { km: moreDistanceKm })}
                  onPress={() => setMoreDistanceOpen((open) => !open)}
                  style={[styles.filterChip, styles.distanceChip]}
                >
                  {/* 数字 + kmUnit 分开拼，跟原型 renderDistanceChip 同一条规则：
                      zh 的 kmUnit 是 "km 内"，vi/en 是 "km"，ko 是 "km 이내"，
                      所以不能把 "km 内" 写死在 JSX 里。 */}
                  <Text selectable style={styles.distanceChipText}>📍 {moreDistanceKm}{t("kmUnit")}</Text>
                  <Text selectable style={[styles.distanceChipArrow, moreDistanceOpen && styles.distanceChipArrowOpen]}>▾</Text>
                </Pressable>
                {RECOMMEND_FILTER_CHIPS.map((chip: RecommendFilter) => {
                  // HOME-I18N-002（2026-09-23，用户：「多语言筛选按钮做在 home 这个不对
                  // 应该做在已有的更多-中文按钮」）：「中文」chip 就是语言入口 ——
                  // 显示当前语言的本名（中文 / Tiếng Việt / English …），点开选择语言
                  // 面板。面板用 overlay 形态叠在本页 Modal 里，不嵌第二个 Modal。
                  if (chip.id === "lang_zh") {
                    return (
                      <Pressable
                        key={chip.id}
                        accessibilityLabel={t("languageChipA11y", { name: appLangOption.name })}
                        accessibilityState={{ expanded: languageSheetOpen }}
                        onPress={() => setLanguageSheetOpen(true)}
                        style={styles.filterChip}
                      >
                        <Text selectable style={styles.filterChipText}>{appLangOption.name}</Text>
                      </Pressable>
                    );
                  }
                  const on = activeFilters.includes(chip.id);
                  const labelKey = CHIP_LABEL_KEY[chip.id];
                  return (
                    <Pressable
                      key={chip.id}
                      onPress={() => {
                        setActiveFilters((prev) =>
                          prev.includes(chip.id) ? prev.filter((c) => c !== chip.id) : [...prev, chip.id]
                        );
                      }}
                      style={[styles.filterChip, on && styles.filterChipOn]}
                      accessibilityLabel={`${t("filterChipA11y", { label: labelKey ? t(labelKey) : chip.label })}${on ? t("selectedSuffix") : ""}`}
                    >
                      <Text selectable style={[styles.filterChipText, on && styles.filterChipTextOn]}>{labelKey ? t(labelKey) : chip.label}</Text>
                    </Pressable>
                  );
                })}
                {loadRooms ? (
                  // HOME-MORE-ROOMS-001：「聊天房」是本页的一个视图切换（原型 chip.active），
                  // 不是直接跳创建页 —— 切进来先看到开房大卡 + 已有的房。
                  <Pressable
                    accessibilityLabel={t("chipChatRoom")}
                    accessibilityState={{ selected: moreMode === "rooms" }}
                    onPress={() => {
                      if (moreMode === "rooms") { setMoreMode("people"); return; }
                      setMoreMode("rooms");
                      setMoreDistanceOpen(false);
                      refreshRooms();
                    }}
                    style={[styles.filterChip, moreMode === "rooms" && styles.filterChipOn]}
                  >
                    <Text selectable style={[styles.filterChipText, moreMode === "rooms" && styles.filterChipTextOn]}>{t("chipChatRoom")}</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
              <Pressable
                accessibilityLabel={moreSearchOpen ? t("closeSearch") : t("search")}
                onPress={() => { if (moreSearchOpen) { setMoreSearchOpen(false); setMoreSearchQuery(""); } else setMoreSearchOpen(true); }}
                style={styles.moreSearchIconBtn}
              >
                <ProxyIcon color={color.ink} name="search" size={18} />
              </Pressable>
            </View>
            {/* HOME-MORE-DIST-001：距离滑杆面板。7 档（1/3/5/10/20/50/100 km），
                每一档是一个可点的段 —— 没有滑杆依赖，也不需要拖动精度：
                段本身就是无障碍元素（每档一个 label），点一下就选中。
                当前档位同时用数字（大号）+ 骑行时间提示说清楚，避免"滑到哪了"
                只能靠颜色猜。 */}
            {moreDistanceOpen ? (
              <View style={styles.distancePanel}>
                <View style={styles.distancePanelHead}>
                  <Text selectable style={styles.distancePanelNum}>{moreDistanceKm}</Text>
                  <Text selectable style={styles.distancePanelUnit}>{t("kmUnit")}</Text>
                  <Text selectable style={styles.distancePanelHint}>{t("ridePrefix")}{rideTimes[moreDistanceIndex] ?? ""}</Text>
                </View>
                <View style={styles.distanceTrack}>
                  {MORE_DISTANCE_KM.map((km, index) => (
                    <Pressable
                      key={`more-distance:${km}`}
                      accessibilityLabel={`${t("distanceTierA11y", { km })}${index === moreDistanceIndex ? t("selectedSuffix") : ""}`}
                      hitSlop={8}
                      onPress={() => setMoreDistanceIndex(index)}
                      style={[styles.distanceSeg, index <= moreDistanceIndex && styles.distanceSegOn]}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            {moreSearchOpen ? (
              <View style={styles.moreSearchBox}>
                <ProxyIcon color={color.muted} name="search" size={15} />
                <TextInput
                  accessibilityLabel={t("searchPeople")}
                  autoFocus
                  onChangeText={setMoreSearchQuery}
                  placeholder={t("searchPlaceholder")}
                  placeholderTextColor={color.muted}
                  style={styles.moreSearchInput}
                  value={moreSearchQuery}
                />
                {moreSearchQuery ? (
                  <Pressable accessibilityLabel={t("clearSearch")} onPress={() => setMoreSearchQuery("")}>
                    <ProxyIcon color={color.muted} name="close" size={15} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {moreMode === "rooms" ? (
              <ScrollView refreshControl={<RefreshControl refreshing={rooms.status === "loading"} onRefresh={refreshRooms} />} style={styles.moreList} contentContainerStyle={styles.moreListContent} showsVerticalScrollIndicator={false}>
                {/* HOME-MORE-ROOMS-001：开房大卡（原型 .create-room-card）。整卡 = 默认场景开房，
                    4 个场景 chip = 带着该场景开房。创建页叠在本页里（moreRoomLayer），不关本页。 */}
                <Pressable
                  accessibilityLabel={t("createRoomA11y")}
                  disabled={!onOpenRoomCreate || isGuest}
                  onPress={() => onOpenRoomCreate?.(filteredPeople)}
                  style={({ pressed }) => [styles.roomCreateCard, pressed && styles.roomCreateCardPressed]}
                >
                  <View style={styles.roomCreateTop}>
                    <View style={styles.roomCreateIcon}><Text selectable style={styles.roomCreateIconText}>✨</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text selectable style={styles.roomCreateTitle}>{t("roomsCreateTitle")}</Text>
                      <Text selectable style={styles.roomCreateDesc}>{isGuest ? t("roomsLoginFirst") : t("roomsCreateDesc")}</Text>
                    </View>
                  </View>
                  <View style={styles.roomCreateRow}>
                    {SCENE_OPTIONS.slice(0, 4).map((scene, index) => (
                      <Pressable
                        key={`room-scene:${scene.roomName}`}
                        accessibilityLabel={`${t("createRoomA11y")} · ${scene.title}`}
                        disabled={!onOpenRoomCreate || isGuest}
                        onPress={() => onOpenRoomCreate?.(filteredPeople, index)}
                        style={styles.roomCreateScene}
                      >
                        <Text selectable style={styles.roomCreateSceneEmoji}>{scene.emoji}</Text>
                        <Text selectable numberOfLines={1} style={styles.roomCreateSceneLabel}>{scene.title}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Pressable>

                <View style={styles.roomSectionHead}>
                  <Text selectable style={styles.roomSectionTitle}>{t("roomsOngoing")}</Text>
                  {rooms.status === "ready" ? <Text selectable style={styles.roomSectionCount}>{rooms.items.length}</Text> : null}
                </View>
                {isGuest ? <Text selectable style={styles.moreEmpty}>{t("roomsLoginFirst")}</Text> : null}
                {!isGuest && rooms.status === "loading" && rooms.items.length === 0 ? <Text selectable style={styles.moreEmpty}>{t("roomsLoading")}</Text> : null}
                {!isGuest && rooms.status === "failed" ? (
                  <Pressable accessibilityLabel={t("roomsLoadFailed")} onPress={refreshRooms}>
                    <Text selectable style={styles.moreEmpty}>{t("roomsLoadFailed")}</Text>
                  </Pressable>
                ) : null}
                {!isGuest && rooms.status === "ready" && rooms.items.length === 0 ? <Text selectable style={styles.moreEmpty}>{t("roomsEmpty")}</Text> : null}
                {rooms.items.map((item) => {
                  const scene = item.conversation.roomScene!;
                  const meetup = item.activeMeetup;
                  const meta = meetup ? `${meetup.place} · ${meetup.timeLabel}` : scene.sceneDesc;
                  const enter = (): void => {
                    onOpenRoom?.(item.conversation.conversationId);
                  };
                  return (
                    <Pressable
                      key={`room:${item.conversation.conversationId}`}
                      accessibilityLabel={t("roomOpenA11y", { name: scene.roomName })}
                      onPress={enter}
                      style={({ pressed }) => [styles.roomCard, pressed && styles.roomCardPressed]}
                    >
                      <View style={styles.roomCover}><Text selectable style={styles.roomCoverEmoji}>{scene.emoji}</Text></View>
                      <View style={styles.roomBody}>
                        <View style={styles.roomTop}>
                          <Text selectable numberOfLines={1} style={styles.roomName}>{scene.roomName}</Text>
                          {item.unreadCount ? <Text selectable style={styles.roomUnread}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text> : null}
                        </View>
                        <Text selectable numberOfLines={1} style={styles.roomMeta}>{meta}</Text>
                        {item.latestMessage?.body ? <Text selectable numberOfLines={1} style={styles.roomLatest}>{item.latestMessage.body}</Text> : null}
                        <View style={styles.roomFooter}>
                          <Text selectable style={styles.roomMembersText}>{t("roomMembers", { n: item.conversation.participants.length })}</Text>
                          <View style={styles.roomEnterBtn}><Text selectable style={styles.roomEnterBtnText}>{t("roomEnter")}</Text></View>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <>
              {relationshipMsg ? <Text selectable style={styles.followMsg}>{relationshipMsg}</Text> : null}
              {greetMsg ? <Text selectable style={styles.followMsg}>{greetMsg}</Text> : null}
              <ScrollView refreshControl={<RefreshControl refreshing={homeRefreshing} onRefresh={onHomeRefresh} />} style={styles.moreList} contentContainerStyle={styles.moreListContent} showsVerticalScrollIndicator={false}>
                {filteredPeople.map((p) => {
                  const distance = p.distanceM === undefined ? t("distanceUnknown") : p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`;
                  const openPreview = (): void => {
                    setFilterSheetOpen(false);
                    setPublicHistoryOpen(false);
                    setHumanScenePreview({ person: p, sceneId: recommendFeed.boundSceneId });
                  };
                  // HOME-MORE-SHEET-003：原型列表每行只有一个动作 —— 拼桌 / 邀约，不是加好友。
                  // HOME-MORE-GREET-001（2026-09-23）：两个动作按「是不是同一窗景」分，不按在线分：
                  //   - 同一窗景（已知距离 ≤ SAME_SCENE_RADIUS_M）→「拼桌」，弹破冰面板约见面；
                  //   - 其余（更远 / 距离未知）→「邀约」= 纯打招呼，点一下直接发一句，不弹面板。
                  const sameScene = isSameScene(p);
                  const invited = !sameScene && isInvited(greetState, resolveHomePersonAccountId(p.id), Date.now());
                  const actionLabel = sameScene ? t("actionTable") : invited ? t("invited") : t("actionInvite");
                  return (
                    <View key={`more:${p.id}`} style={styles.moreRow}>
                      <Pressable onPress={openPreview} accessibilityLabel={t("viewHumanProfileA11y", { name: p.name })} style={styles.moreAvatarWrap}>
                        {p.photoUri && !brokenAvatarIds.has(p.id) ? <Image source={{ uri: p.photoUri }} style={styles.moreAvatar} onError={() => markAvatarBroken(p.id)} /> : <View style={styles.moreAvatarFallback}><Text selectable style={styles.moreAvatarInitials}>{p.initials}</Text></View>}
                        {p.online ? <View style={styles.moreOnlineDot} /> : null}
                      </Pressable>
                      <Pressable onPress={openPreview} style={styles.moreInfo} accessibilityLabel={t("viewHumanProfileA11y", { name: p.name })}>
                        <View style={styles.moreNameRow}><Text selectable style={styles.moreName} numberOfLines={1}>{p.name}</Text><Text selectable style={styles.moreMeta}>{distance}</Text></View>
                        {p.bio ? <Text selectable style={styles.moreBio} numberOfLines={1}>{p.bio}</Text> : null}
                        {/* HOME-MORE-SHEET-007（2026-09-22，用户反馈"共同好友
                            移除，最多保持 2 个标签"）：去掉共同好友数，标签本来
                            就 slice(0,2) 封顶，维持不变。 */}
                        <View style={styles.moreTags}>
                          {p.online ? <Text selectable style={styles.moreTagLive}>{t("chipOnline")}</Text> : null}
                          {p.tags.slice(0, 2).map((t) => <Text selectable key={`${t.kind}:${t.text}`} style={styles.moreTag}>{t.text}</Text>)}
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={() => { if (sameScene) setIcebreakerTarget(p); else greet(p); }}
                        style={[styles.moreActionBtn, invited && styles.moreActionBtnDone]}
                        accessibilityLabel={sameScene ? t("icebreakerTitle", { name: p.name, action: actionLabel }) : invited ? `${actionLabel} · ${t("greetA11y", { name: p.name })}` : t("greetA11y", { name: p.name })}
                      >
                        {/* HOME-MORE-GREET-002：邀约 = 气泡（打个招呼），已邀约 = ✓。拼桌不带图标。 */}
                        {sameScene ? null : <ProxyIcon color={invited ? color.muted : color.ink} name={invited ? "check" : "chat"} size={13} />}
                        <Text selectable style={[styles.moreActionBtnText, invited && styles.moreActionBtnTextDone]}>{actionLabel}</Text>
                      </Pressable>
                    </View>
                  );
                })}
                {filteredPeople.length === 0 ? <Text selectable style={styles.moreEmpty}>{t("emptyFiltered")}</Text> : null}
              </ScrollView>
              </>
            )}

            {/* HOME-MORE-SHEET-004（2026-09-22，用户反馈"拼桌/邀约点击没反应"）：
                根因是这个面板之前用了第二个 <Modal>，跟外层"更多"整页的 Modal
                同时存在——iOS 一次只能呈现一个 Modal，第二个 present 请求被
                无声吞掉，state 其实改了（setIcebreakerTarget 生效），只是
                UI 没弹出来。改成普通 View 叠在同一个 Modal 内部（sheetBackdrop
                本来就是 position:absolute 铺满整屏），不再嵌套 Modal。 */}
            {icebreakerTarget ? (
              <Pressable style={styles.sheetBackdrop} onPress={() => setIcebreakerTarget(undefined)} accessibilityLabel={t("closeIcebreaker")}>
                <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                  <View style={styles.sheetGrab} />
                  <View style={styles.icebreakerHead}>
                    <Text selectable style={styles.sheetTitle}>{t("icebreakerTitle", { name: icebreakerTarget.name, action: t("actionTable") })}</Text>
                    <Pressable accessibilityLabel={t("close")} onPress={() => setIcebreakerTarget(undefined)}><Text selectable style={styles.icebreakerClose}>✕</Text></Pressable>
                  </View>
                  {icebreakerLines.map((line) => (
                    <Pressable
                      key={line}
                      accessibilityLabel={t("sendLineA11y", { line })}
                      onPress={() => {
                        const target = icebreakerTarget;
                        setIcebreakerTarget(undefined);
                        setFilterSheetOpen(false);
                        onMessageHuman?.(target, line);
                      }}
                      style={styles.icebreakerItem}
                    >
                      <Text selectable style={styles.icebreakerItemText}>{line}</Text>
                      <Text selectable style={styles.icebreakerItemArrow}>→</Text>
                    </Pressable>
                  ))}
                </View>
              </Pressable>
            ) : null}
            {/* HOME-I18N-002：语言面板叠在本页 Modal 里面（overlay，不是第二个 Modal）。 */}
            <LanguageSheet presentation="overlay" visible={languageSheetOpen} onClose={() => setLanguageSheetOpen(false)} />
            {/* HOME-MORE-ROOMS-002：创建页 / 房间叠在最上层（overlay），返回就回到聊天房列表。 */}
            {moreRoomLayer}
          </View>
        </Modal>
      ) : null}

    </ScrollView>
  );
}


// HOME-MORE-DIST-001（2026-09-22，照 deepseek_html_20260922_1c2e2c.html 的
// distance-chip / DISTANCES / rideTimes）：距离半径是可选值，不是写死的 1km。
// 默认 10km 跟原型一致 —— 本仓 fixture 的距离全在 240m~1.6km，所以默认半径下
// 一个人都不会被这个控件挡掉；放宽/收紧是用户主动做的。
const MORE_DISTANCE_KM: ReadonlyArray<number> = [1, 3, 5, 10, 20, 50, 100];

// HOME-MORE-GREET-001（2026-09-23，用户：「线下很近的 2 个人 比如 200m 以内 我们认为处于
// 同一个窗景」）：同一窗景 = 已知距离 ≤ 200m。距离未知的人不算（跟 PERSON-DISTANCE-ZERO-001
// 同一条规则：不知道就不能当成"就在旁边"）。
const SAME_SCENE_RADIUS_M = 200;
function isSameScene(person: RecommendPerson): boolean {
  return person.distanceM !== undefined && person.distanceM <= SAME_SCENE_RADIUS_M;
}
const MORE_DISTANCE_DEFAULT_INDEX = 3; // = 10km

// HOME-I18N-001：骑行时间原来写死在这（中文），现在跟着语言走 —— 取 i18n 的
// rideTimes（原型 I18N 里那 7 档，6 种语言都齐）。
//
// 筛选 chip 的可见文案同理：fixture 里存的是中文 label，展示时按 **id** 换成
// 当前语言的键。用 id 而不是中文串当查找键 —— 拿中文当键的话，文案改一个字
// 整行就会静默回落到中文，而且只有那一种语言坏掉，很难发现。
const CHIP_LABEL_KEY: Record<string, MessageKey> = {
  online: "chipOnline",
  lang_zh: "chipChinese"
};

const styles = StyleSheet.create({
  aiSection: { marginTop: 8 },
  aiSectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  aiTitle: { color: color.ink, fontSize: 17, fontWeight: "900" },
  aiSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  aiBadge: { backgroundColor: color.proxyPurpleSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  aiBadgeText: { color: color.violet, fontSize: 11, fontWeight: "900" },
  aiRail: { marginBottom: 10, marginHorizontal: -16 },
  aiRailContent: { gap: 12, paddingHorizontal: 16 },
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
  gridLabel: { color: "color.white", fontSize: 13, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 5 },
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
  humanScenePage: { backgroundColor: "#162030", flex: 1 },
  humanSceneHeader: { alignItems: "center", backgroundColor: "#162030", borderBottomColor: "rgba(255,255,255,0.12)", borderBottomWidth: 1, flexDirection: "row", height: 54, paddingHorizontal: 16 },
  humanSceneBack: { flex: 1 },
  humanSceneBackText: { color: "#DCE6F7", fontSize: 14, fontWeight: "800" },
  humanSceneHeaderTitle: { color: color.white, fontSize: 16, fontWeight: "900" },
  humanSceneHeaderSpacer: { flex: 1 },
  humanSceneContent: { padding: 18, paddingBottom: 40 },
  humanSceneTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  humanSceneEyebrow: { color: "#DCE6F7", fontSize: 12, fontWeight: "700" },
  humanSceneClose: { alignItems: "center", borderColor: "rgba(255,255,255,0.35)", borderRadius: 21, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  humanSceneCloseText: { color: color.white, fontSize: 27, fontWeight: "300", lineHeight: 30 },
  humanScenePerson: { alignItems: "center", flexDirection: "row", gap: 14, marginTop: 10 },
  humanSceneAvatarRing: { alignItems: "center", borderColor: "rgba(150,203,255,0.9)", borderRadius: 999, borderWidth: 2, height: 96, justifyContent: "center", padding: 3, width: 96 },
  humanSceneAvatar: { borderRadius: 999, height: "100%", width: "100%" },
  humanSceneInitials: { color: color.white, fontSize: 24, fontWeight: "900" },
  humanScenePersonCopy: { flex: 1, minWidth: 0 },
  humanSceneName: { color: color.white, fontSize: 28, fontWeight: "900" },
  humanSceneBio: { color: "#CFDAEA", fontSize: 13, lineHeight: 18, marginTop: 4 },
  humanSceneRating: { color: "#FFCE55", fontSize: 12, fontWeight: "800", marginTop: 6 },
  humanSceneActionsTop: { flexDirection: "row", gap: 8, marginTop: 16 },
  humanSceneTopAction: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.24)", borderRadius: 999, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 46 },
  humanSceneTopActionPrimary: { backgroundColor: "#586CFF", borderColor: "#586CFF" },
  humanSceneTopActionText: { color: color.white, fontSize: 13, fontWeight: "900" },
  humanSceneTopActionPrimaryText: { color: color.white, fontSize: 13, fontWeight: "900" },
  humanSceneFacts: { flexDirection: "row", gap: 7, marginTop: 14 },
  humanSceneFact: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.18)", borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, justifyContent: "center", minHeight: 62, paddingHorizontal: 6 },
  humanSceneFactValue: { color: "#DCE6F7", fontSize: 11, fontWeight: "700", textAlign: "center" },
  humanSceneHistory: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.18)", borderRadius: 16, borderWidth: 1, marginTop: 9, padding: 12 },
  humanSceneHistoryHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  humanSceneHistoryTitle: { color: color.white, fontSize: 13, fontWeight: "900" },
  humanSceneHistoryPrivacy: { color: "#AAB9CE", fontSize: 11 },
  humanSceneHistoryRow: { alignItems: "center", borderTopColor: "rgba(255,255,255,0.12)", borderTopWidth: 1, flexDirection: "row", paddingVertical: 10 },
  humanSceneHistoryCopy: { flex: 1 },
  humanSceneHistoryName: { color: color.white, fontSize: 13, fontWeight: "800" },
  humanSceneHistoryMeta: { color: "#AAB9CE", fontSize: 11, marginTop: 3 },
  humanSceneHistoryRating: { color: "#FFCE55", fontSize: 12, fontWeight: "900" },
  humanSceneHistoryEmpty: { color: "#AAB9CE", fontSize: 12, paddingVertical: 12 },
  humanScenePills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 9 },
  humanScenePill: { backgroundColor: "rgba(88,108,255,0.2)", borderColor: "rgba(150,203,255,0.45)", borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  humanScenePillText: { color: color.white, fontSize: 12, fontWeight: "800" },
  humanSceneSectionTitle: { color: color.white, fontSize: 14, fontWeight: "900", marginTop: 18 },
  humanSceneLinkRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  humanSceneLinkChip: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.2)", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 72, padding: 10 },
  humanSceneLinkCard: { borderColor: "rgba(255,255,255,0.2)", borderRadius: 14, borderWidth: 1, flex: 1.2, minHeight: 72, overflow: "hidden", padding: 10 },
  humanSceneLinkShade: { backgroundColor: "rgba(8,13,24,0.48)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  humanSceneLinkLabel: { color: "#AAB9CE", fontSize: 11 },
  humanSceneLinkValue: { color: color.white, fontSize: 12, fontWeight: "800", marginTop: 8 },
  humanSceneLinkLabelLight: { color: "#E0E8F4", fontSize: 11 },
  humanSceneLinkValueLight: { color: color.white, fontSize: 12, fontWeight: "900", marginTop: 8 },
  humanSceneSceneHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 13 },
  humanSceneSceneHint: { color: "#AAB9CE", fontSize: 11 },
  humanSceneSceneRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  humanSceneSceneCard: { borderColor: "rgba(255,255,255,0.2)", borderRadius: 15, borderWidth: 1, flex: 1, height: 92, justifyContent: "flex-end", overflow: "hidden", padding: 10 },
  humanSceneSceneShade: { backgroundColor: "rgba(8,13,24,0.35)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  humanSceneSceneName: { color: color.white, fontSize: 13, fontWeight: "900" },
  humanSceneSceneMeta: { color: "#E0E8F4", fontSize: 11, marginTop: 2 },
  humanSceneDetailCard: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.18)", borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 13 },
  humanSceneDetailTitle: { color: "#AAB9CE", fontSize: 11, fontWeight: "700", marginTop: 4 },
  humanSceneDetailText: { color: color.white, fontSize: 13, lineHeight: 19, marginBottom: 7, marginTop: 4 },
  humanSceneTrust: { color: "#FFCE55", fontSize: 13, fontWeight: "900", marginTop: 7 },
  humanSceneReason: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, color: "#DCE6F7", fontSize: 12, lineHeight: 18, marginTop: 12, padding: 11 },
  humanSceneNotice: { color: "#FFCE55", fontSize: 11, marginTop: 8 },
  humanSceneAdd: { alignItems: "center", backgroundColor: "#586CFF", borderRadius: 999, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 12, minHeight: 48 },
  humanSceneAddDone: { backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.3)", borderWidth: 1 },
  humanSceneAddText: { color: color.white, fontSize: 14, fontWeight: "900" },
  humanSceneActions: { flexDirection: "row", gap: 8, marginTop: 9 },
  humanSceneAction: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.86)", borderRadius: 999, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 44 },
  humanSceneActionText: { color: color.ink, fontSize: 13, fontWeight: "900" },
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
  addBadgePending: { backgroundColor: "#66511F" },
  addBadgeText: { color: color.white, fontSize: 16, fontWeight: "900", lineHeight: 20 },
  aiAvatarWrap: { position: "relative" },
  followMsg: { color: color.muted, fontSize: 11, marginTop: 6, textAlign: "center" },
  serverPeopleTitle: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 10 },
  serverPeopleRow: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 8 },
  serverPeopleCopy: { flex: 1, minWidth: 0 },
  serverPeopleName: { color: color.ink, fontSize: 13, fontWeight: "700" },
  serverPeopleSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  serverPeopleAction: { color: color.violet, fontSize: 12, fontWeight: "800" },
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
    maxHeight: "85%",
    padding: 18,
    paddingBottom: 32,
    position: "absolute",
    right: 0
  },
  sheetGrab: { alignSelf: "center", backgroundColor: "#DDD", borderRadius: 4, height: 4, marginBottom: 14, width: 42 },
  sheetTitle: { color: color.ink, fontSize: 20, fontWeight: "800", marginBottom: 12 },
  // HOME-MORE-DIST-001（2026-09-22，照原型 .chip / .chip.active）：chip 换成原型
  // 的样子 —— 无边框、#f5f5f5 底、13px/600，选中转**深色**（#1a1a1a + 白字），
  // 不再是之前的 lime 高亮 + 可见描边。原型里 4 个 chip 共用同一条规则，
  // 所以这里改的是整行，不是单独某一个 —— 否则一行里两种 chip 长相会显得坏掉。
  filterChips: { alignItems: "center", flexDirection: "row", gap: 8 },
  filterChipScroll: { flex: 1 },
  filterChipScrollContent: { alignItems: "center", gap: 8 },
  filterChip: { backgroundColor: color.offWhite, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  filterChipOn: { backgroundColor: color.ink },
  filterChipText: { color: color.ink, fontSize: 13, fontWeight: "600" },
  filterChipTextOn: { color: color.white, fontWeight: "800" },
  // HOME-MORE-DIST-001：距离控件 = 原型的 .chip.distance-chip —— 恒深色，
  // 📍 + 当前半径 + ▾。
  distanceChip: { alignItems: "center", backgroundColor: color.ink, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  distanceChipText: { color: color.white, fontSize: 13, fontWeight: "800" },
  // 原型这里是 font-size:10px，但本仓 design-system-r3 要求 UI 文本 >= 11pt
  //（可读性门禁，不是建议），所以取 11。视觉上跟 10 没差，规则不破。
  distanceChipArrow: { color: color.white, fontSize: 11, opacity: 0.7 },
  distanceChipArrowOpen: { transform: [{ rotate: "180deg" }] },
  distancePanel: { paddingBottom: 12, paddingHorizontal: 8, paddingTop: 4 },
  distancePanelHead: { alignItems: "baseline", flexDirection: "row", gap: 6 },
  distancePanelNum: { color: color.ink, fontSize: 24, fontWeight: "800" },
  distancePanelUnit: { color: color.ink, fontSize: 13, fontWeight: "600" },
  distancePanelHint: { color: color.muted, fontSize: 12, marginLeft: "auto" },
  distanceTrack: { flexDirection: "row", gap: 4, marginTop: 10 },
  distanceSeg: { backgroundColor: color.line, borderRadius: 999, flex: 1, height: 6 },
  distanceSegOn: { backgroundColor: color.ink },
  // HOME-MORE-BTN-TAP-001（2026-09-22 教训）：这一行是 flexWrap 容器，之前
  // "创建房间"按钮用 marginLeft:"auto" 撞过一次点击不生效（真根因后来查出来是
  // 两个 Modal 同时 visible，但没验证过 auto margin 是否也有份）——保险起见，
  // 搜索图标不再用 auto margin 撑到最右，就按 JSX 顺序自然排在"聊天房"后面。
  moreSearchIconBtn: { alignItems: "center", height: 34, justifyContent: "center", width: 30 },
  moreSearchBox: { alignItems: "center", backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 8, paddingHorizontal: 12, paddingVertical: 9 },
  moreSearchInput: { color: color.ink, flex: 1, fontSize: 14, padding: 0 },
  // HOME-MORE-SHEET-002: 整页版"更多真人"——独立页头（返回箭头 + 标题），
  // 不是底部弹窗。
  morePage: { backgroundColor: color.white, flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  // HOME-MORE-SHEET-006: 返回箭头并进筛选 chip 行，不再单独占一行标题。
  morePageBackInline: { alignItems: "center", height: 34, justifyContent: "center", width: 28 },
  morePageBackIcon: { color: color.ink, fontSize: 26, fontWeight: "600" },
  // HOME-MORE-SHEET-001: 更多真人列表行（照原型 list-item）。
  moreList: { flex: 1, marginTop: 8 },
  moreListContent: { gap: 4, paddingBottom: 4 },
  moreRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 12 },
  moreAvatarWrap: { height: 52, position: "relative", width: 52 },
  moreAvatar: { borderRadius: 999, height: "100%", width: "100%" },
  moreAvatarFallback: { alignItems: "center", backgroundColor: "#F0ECE8", borderRadius: 999, height: "100%", justifyContent: "center", width: "100%" },
  moreAvatarInitials: { color: color.ink, fontSize: 18, fontWeight: "800" },
  moreOnlineDot: { backgroundColor: color.lime, borderColor: color.white, borderRadius: 999, borderWidth: 2, bottom: 2, height: 12, position: "absolute", right: 2, width: 12 },
  moreInfo: { flex: 1, gap: 4, minWidth: 0 },
  moreNameRow: { alignItems: "baseline", flexDirection: "row", gap: 8 },
  moreName: { color: color.ink, flexShrink: 1, fontSize: 15, fontWeight: "700" },
  moreMeta: { color: color.muted, fontSize: 12 },
  moreBio: { color: color.ink, fontSize: 12 },
  moreTags: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  moreTagLive: { backgroundColor: color.ink, borderRadius: 4, color: color.white, fontSize: 11, fontWeight: "700", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  moreTag: { backgroundColor: color.offWhite, borderRadius: 4, color: color.muted, fontSize: 11, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  // HOME-MORE-SHEET-003: 每行唯一的动作按钮（拼桌/邀约），照原型 li-action-btn。
  moreActionBtn: { alignItems: "center", borderColor: color.ink, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 4, paddingHorizontal: 14, paddingVertical: 7 },
  moreActionBtnText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  moreActionBtnDone: { backgroundColor: color.offWhite, borderColor: color.line },
  moreActionBtnTextDone: { color: color.muted },
  moreEmpty: { color: color.muted, fontSize: 12, paddingVertical: 16, textAlign: "center" },
  // HOME-MORE-ROOMS-001：照 deepseek_html_20260923_2308b7.html 的 .create-room-card /
  // .room-card。原型 10px 的小字统一抬到 11（design-system-r3 下限）。
  roomCreateCard: { backgroundColor: color.ink, borderRadius: 20, marginBottom: 20, marginTop: 4, overflow: "hidden", padding: 20 },
  roomCreateCardPressed: { transform: [{ scale: 0.985 }] },
  roomCreateTop: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 16 },
  roomCreateIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.15)", borderRadius: 14, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  roomCreateIconText: { fontSize: 22 },
  roomCreateTitle: { color: color.white, fontSize: 16, fontWeight: "800", letterSpacing: -0.2, marginBottom: 3 },
  roomCreateDesc: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "500" },
  roomCreateRow: { flexDirection: "row", gap: 8 },
  roomCreateScene: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, borderWidth: 1, flex: 1, gap: 4, paddingHorizontal: 6, paddingVertical: 12 },
  roomCreateSceneEmoji: { fontSize: 18 },
  roomCreateSceneLabel: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "600" },
  roomSectionHead: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 12 },
  roomSectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  roomSectionCount: { backgroundColor: color.offWhite, borderRadius: 8, color: color.muted, fontSize: 11, fontWeight: "700", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
  roomCard: { alignItems: "flex-start", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 12, padding: 14 },
  roomCardPressed: { backgroundColor: color.offWhite },
  roomCover: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 16, height: 60, justifyContent: "center", width: 60 },
  roomCoverEmoji: { fontSize: 28 },
  roomBody: { flex: 1, gap: 5, minWidth: 0 },
  roomTop: { alignItems: "center", flexDirection: "row", gap: 8 },
  roomName: { color: color.ink, flex: 1, fontSize: 14.5, fontWeight: "800", letterSpacing: -0.2, minWidth: 0 },
  roomUnread: { backgroundColor: color.ink, borderRadius: 8, color: color.white, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
  roomMeta: { color: color.muted, fontSize: 12, fontWeight: "500" },
  roomLatest: { color: color.ink, fontSize: 12, fontWeight: "500" },
  roomFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  roomMembersText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  roomEnterBtn: { backgroundColor: color.ink, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 7 },
  roomEnterBtnText: { color: color.white, fontSize: 12, fontWeight: "800" },
  icebreakerHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  icebreakerClose: { color: color.muted, fontSize: 18, paddingHorizontal: 6 },
  icebreakerItem: { alignItems: "center", backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginBottom: 10, padding: 14 },
  icebreakerItemText: { color: color.ink, flex: 1, fontSize: 14, fontWeight: "600" },
  icebreakerItemArrow: { color: color.muted, fontSize: 16, marginLeft: 8 },
});

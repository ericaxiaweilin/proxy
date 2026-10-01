// RequesterHome（稳定 Surface，R15.12.7 rhome）：
// r157HomeTop + r1572HomeComposer('USER') + 继续/2项 + r157Action 周六新店开业 + r157Action 周末摄影散步
// + r157MarketPulse + bottom。无 hero / attention / teaser / rail / quick / reusable。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（rhome，HTML 5197-5203）。
// Experience Runtime 插槽：top_context banner 由 SurfacePlan 驱动（§10 Slots），本地态不被 Delta 覆盖（§15.1）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { ActivityOrderSnapshotSchema, type ActivityJoinRecipe, type ActivityOrderSnapshot } from "@proxy/contracts";
import { ActivityOrderTicket, peopleCountLabel } from "../components/activity-order-ticket";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScrollChrome } from "../shell/scroll-chrome";
import { type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { HomeSearchDock } from "../components/home-search-dock";
import { buildHomeSearchIndex, matchHomeSearchIntent, shouldExpireServerPeopleResults, shouldSearchServerPeople, type HomeSearchSuggestion } from "../home-search-intent";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { resolveHomePersonAccountId } from "../recommend-fixtures";
import { meetupDirectionsUrls } from "../meetup-share";
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
import { ActivityCommandRejectedError, ActivityProtocolError, orderNoFromJoinRejection } from "../activity-client";
import { pickRefreshedActivity } from "../for-you-slots";
import type { ExperienceClient } from "../experience-client";
import type { RelationshipClient } from "../relationship-client";
import type { ProfileClient, ProfileWire } from "../profile-client";
import { localApiBaseUrl } from "../native-clients";
import { type Activity, type SceneToolId } from "@proxy/contracts";
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
import { PhotoScrim, ProxyBackGlyph } from "../components/proxy-foundation";

import { activitiesAtCoffeeShops, detectComboConflicts, detectOrderConflict, sceneIdOfActivity, stripAreaSuffix, type ExistingOrder, type OrderConflict } from "../requester-home-combo";
// SCENE-DISTANCE-BADGE-001（用户：「所有的场景必须标注距离数」）：真实设备定位 +
// 真实 haversine 距离，跟 hot-scenes.tsx / scene-shop-directory.tsx 同一套口径。
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { sceneDistanceMeters, shopCardDistance, type SceneOrigin } from "../scene-shop-directory";

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

// FORYOU-LOGO-001（2026-09-27 晚，原型 deepseek_html_20260927_c89beb 新版主 Logo）：
// 4 个**实心**矩形 + 中心大圆，大圆带白描边环压在四矩形交点上 —— 白环把圆和
// 矩形分开，图形整体更重。纯 View 摆放，不引 svg 依赖。
// 几何按原型 100 viewBox 的 40px 变体等比：pad 4 / rect 42 / 第二列 x=54 /
// 圆角 12；圆 SVG r=16 + 描边 4（描边中心在圆周上）→ RN 用外径 36（r=18）+
// 白边 4 的圆 View，可见墨芯正好 r=14≈SVG 的内沿。
function ForYouGlyph({ size }: { size: number }) {
  const pad = size * 4 / 100;
  const rect = size * 42 / 100;
  const off = size * 54 / 100;
  const dot = size * 36 / 100;
  const ring = size * 4 / 100;
  const cell: ViewStyle = { backgroundColor: color.ink, borderRadius: size * 12 / 100, height: rect, position: "absolute", width: rect };
  return (
    <View style={{ height: size, width: size }}>
      <View style={[cell, { left: pad, top: pad }]} />
      <View style={[cell, { left: off, top: pad }]} />
      <View style={[cell, { left: pad, top: off }]} />
      <View style={[cell, { left: off, top: off }]} />
      <View style={{ backgroundColor: color.ink, borderColor: color.white, borderRadius: dot / 2, borderWidth: ring, height: dot, left: (size - dot) / 2, position: "absolute", top: (size - dot) / 2, width: dot }} />
    </View>
  );
}

// 单边虚线在 iOS 上**画不出来**：RN 只支持四边等宽的 dashed 边框（仓库里那些
// dashed 空态卡都是 borderWidth 统一才生效的），单边（borderTopWidth /
// borderBottomWidth）会打 "Unsupported dashed / dotted border style" 并且
// **整条不画** —— 2026-09-28 模拟器像素级实测：撕票线和 meta 分隔线一起消失，
// 那两段里一个非白像素都没有。所以虚线用一排小方块自己画，绕开 RN 的 border。
// ⚠️ 下面门禁里有一条反向钉扫 dashed 边框字面量，所以这段注释也不写那个写法。
function DashedRule({ ruleColor, style }: { ruleColor: string; style?: ViewStyle }) {
  return (
    <View pointerEvents="none" style={[styles.dashedRule, style]}>
      {Array.from({ length: 24 }, (_, index) => (
        <View key={index} style={[styles.dashedRuleDash, { backgroundColor: ruleColor }]} />
      ))}
    </View>
  );
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
  relationship,
  profileClient,
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
  onOpenHotScenes,
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
  relationship?: RelationshipClient;
  // HOME-PEOPLE-SEARCH-001: 全站真人搜索。没有它，首页人名搜索只能命中
  // 本地推荐预览，新注册用户永远搜不到。
  profileClient?: ProfileClient;
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
  // HOT-SCENES-PAGE-001：热榜「更多」的真实落点（排序/筛选/网格整页），
  // 不是 onOpenSceneMap（那个是场景地图总览/详情）。没接就退回旧行为。
  onOpenHotScenes?: (() => void) | undefined;
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
  // HOME-RAIL-SERVER-001：rail 的服务端推荐人。与 serverPeople（搜索结果）是两回事 ——
  // 那是"用户搜了某个名字"，这里是"打开首页就有谁在附近"。
  const [nearbyWire, setNearbyWire] = useState<ReadonlyArray<ProfileWire> | undefined>(undefined);
  const nearbySeq = useRef(0);
  const [serverPeople, setServerPeople] = useState<ReadonlyArray<ProfileWire> | undefined>(undefined);
  const [serverPeopleState, setServerPeopleState] = useState<"idle" | "busy" | "failed">("idle");
  const [serverPeopleQuery, setServerPeopleQuery] = useState("");
  const serverPeopleSeq = useRef(0);
  // 4 宫格：各槽位独立下标，点格子弹选择窗（弹窗控制格子），主页入口保留。
  // HOME-FORYOU-POOL-001（2026-09-26，用户：「这个 home 的 for you 要好好做…随机根据
  // 用户的 location 推荐可用资源组合池」）：四个 index 原来**全从 0 起步** ⇒ 所有人首屏
  // 看到的组合一模一样，那就不叫随机推荐。改成每个 mount 取一次随机种子，四个 index 由
  // 它派生（useState 惰性初始化，只算一次，不会每次 render 都跳）。
  const [forYouSeed] = useState(() => Math.floor(Math.random() * 0x7fffffff) + 1);
  const [personIndex, setPersonIndex] = useState(() => forYouSeed);
  const [timeIndex, setTimeIndex] = useState(() => forYouSeed >> 3);
  const [activityIndex, setActivityIndex] = useState(() => forYouSeed >> 7);
  const [placeIndex, setPlaceIndex] = useState(() => forYouSeed >> 11);
  const [chooser, setChooser] = useState<"person" | "time" | "activity" | "place" | null>(null);
  // HOME-FORYOU-SELECT-001（2026-09-28，原型 deepseek_html_20260928_7d0503
  // 的 combo-cta「选择」）：点一下直接进「确认这个组合」sheet，真的
  // joinSelected 命令从那里发出——跟 DIRECT-INVITE-CONFIRM-001 同一条
  // "先选、再确认、命令最后发"的规矩，不能一下单就把钱/名额的事定了。
  // 用户实测反馈（"点击选择 就变成已选择 中间环节跳过了"）：先前"选择→
  // 已选择→再点一下才进 sheet"的两段式，在真机上被读成"点了选择却什么
  // 都没发生"，不是更清楚的确认，是多余的一步——去掉，一次点击直达 sheet。
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  // HOME-FORYOU-ORDER-003（2026-09-28，原型 docs/design/references/
  // Proxy_MyTickets_20260928_d7fef9.html「我的票券」）：报名成功之后进这一屏，
  // 不是关掉 sheet 就完了。
  // ⚠️ 这两步**共用一个 Modal**（`joinConfirmOpen`），`orderDone` 只切内容。
  // 不许写成两个兄弟 Modal：报名成功那一批 state 里"关 A + 开 B"落在**同一次
  // 提交**，iOS 在 A 还在 dismiss 的时候会丢掉 B 的 present —— 点了确认下单
  // 什么都不出现、也不报错。整页 Modal 里再套 Modal 同理会被无声吞掉
  // （HOME-MORE-SHEET-004；surfaces/badminton-companion.tsx 文件头第 1 条
  // 把"整页只有一个 Modal，内部换屏只切 state"写成了这个仓库的规矩）。
  const [orderDone, setOrderDone] = useState(false);
  // HOME-FORYOU-ORDER-005（用户「这个已下单的☑️ 显示3s可以自动消失 停留在recipe
  // 而不是持续」）：下单成功后顶部那块绿勾+「已下单」+ 人数/状态只闪 3 秒，
  // 之后让出 hero 区 —— 留下面的票券本体（订单编号 + 活动/时间/地点/费用 +
  // 一起的人 + 底部分享/联系）。触发点：orderDone 转 true 的瞬间开 3s 定时器；
  // 关闭流程或重新提交时清掉。
  const [orderHeroVisible, setOrderHeroVisible] = useState(false);
  useEffect(() => {
    if (!orderDone) {
      setOrderHeroVisible(false);
      return;
    }
    setOrderHeroVisible(true);
    const timer = setTimeout(() => setOrderHeroVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [orderDone]);
  const [orderCodeCopied, setOrderCodeCopied] = useState(false);
  // ORDER-NO-001：个人订单号（纯数字：场地类别码3位+越南日期+每日序号，如 1002609270002）。
  // JoinActivity 成功 payload 带 orderNo；已下过单走 rejection 的 safeDetails。
  // 老服务端没有该字段时回落活动 code（ORDER-002 的旧行为）。
  const [orderNo, setOrderNo] = useState("");
  // ORDER-RECIPE-001：服务端在下单那一刻存的票面快照（活动当时的样子 + 这次 For You
  // 的选择）。成功页照它画票，跟「我的订单」是同一份数据；老服务端不下发时退回
  // 用四宫格手头的数据拼一份（ticketSnapshot）。
  const [orderSnapshot, setOrderSnapshot] = useState<ActivityOrderSnapshot | undefined>(undefined);
  // HOME-FORYOU-ORDER-004（用户「点击确认下单 为什么没有下一步的UI」）：这单之前就下过
  // （JoinActivity 回 ACTIVITY_ALREADY_JOINED）也照样进已下单页——票本来就在你手上，
  // 只是副标题如实说「之前已经下过」，不假装这次新下了一单。
  const [orderExisting, setOrderExisting] = useState(false);
  // HOME-FORYOU-REFRESH-001：中心圆圈正在重新拉可用插槽。
  const [slotRefreshing, setSlotRefreshing] = useState(false);
  function closeOrderFlow(): void {
    setOrderDone(false);
    setOrderHeroVisible(false);
    setOrderExisting(false);
    setOrderCodeCopied(false);
    setOrderNo("");
    setJoinConfirmOpen(false);
  }
  const [confirmNavMsg, setConfirmNavMsg] = useState<string | undefined>(undefined);
  function openGridPlaceNavigation(place: { latitude: number; longitude: number }): void {
    const urls = meetupDirectionsUrls({ lat: place.latitude, lng: place.longitude });
    if (!urls || (place.latitude === 0 && place.longitude === 0)) {
      setConfirmNavMsg("这个地点没有可用坐标，打不开导航");
      return;
    }
    setConfirmNavMsg(undefined);
    const url = Platform.OS === "ios" ? urls.apple : urls.google;
    void Linking.openURL(url).catch(() => setConfirmNavMsg("打不开导航，请重试"));
  }
  // HOME-FORYOU-LOCK-001（2026-09-27，原型 deepseek_html_20260927_548d6b「可换可锁」）：
  // 每个格子可锁定（金框 + 右上角锁）。锁定后： remix 跳过该轴、chooser 拒开。
  const [lockedSlots, setLockedSlots] = useState<ReadonlySet<"person" | "time" | "activity" | "place">>(() => new Set());
  function toggleSlotLock(slot: "person" | "time" | "activity" | "place"): void {
    setLockedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot); else next.add(slot);
      return next;
    });
  }
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
  // HOME-PEOPLE-SEARCH-RACE-001：但「提交后清空输入框」不是新查询 —— 那是
  // 这次搜索的收尾。照旧无条件作废，会把同一次提交刚发出的请求一起废掉
  //（seq 一变，回来的答案被 runServerPeopleSearch 的守卫丢掉）：结果列表和
  // 失败态就都永远不出现，用户只看到输入框被擦干净。判据见
  // home-search-intent.ts 的 shouldExpireServerPeopleResults。
  useEffect(() => {
    if (!shouldExpireServerPeopleResults(searchQuery)) return;
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
      // PERSON-DISTANCE-ZERO-001: 距离只在**服务端真的量过**时才带。
      // 以前这里恒不填，因为服务端从不返回坐标 —— 于是每个服务端真人都被
      // 「附近」半径剔掉，rail 上一个都进不来。现在 ListNearbyProfiles 带回
      // server-measured distanceM（HOME-RAIL-SERVER-001），所以可以带。
      // 仍是「没有就 undefined」，绝不填 0：0 会渲染成「0 m」并让人
      // 无条件通过任何半径的附近筛选。
      ...(typeof wire.distanceM === "number" && Number.isFinite(wire.distanceM) && wire.distanceM >= 0
        ? { distanceM: wire.distanceM }
        : {}),
      online: false,
      mutualFriends: 0,
    };
  }

  // localHit：这次查询本地推荐已经命中了（四宫格换过人 / 场景 / 时间）。
  // 它只影响「什么都没找到」那句文案 —— 本地命中了就不能报「本地推荐和全站
  // 都没命中」，那是假的。见 HOME-PEOPLE-SEARCH-RACE-001。
  async function runServerPeopleSearch(query: string, speak: boolean, localHit = false): Promise<void> {
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
        } else if (localHit) {
          // 本地推荐命中了、全站没有同名的人 —— 两件事分开说。
          showResponse(t("notFoundSiteWideOnly", { q: query }), t("notFoundSiteWideOnlySub"));
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

  // SCENE-HOME-HOT-RAIL-001（2026-09-27）：AI 推荐行下架，目录接口的
  // listRecommended 拉取连同对应 prop 一起从首页摘除。
  // /v1/ai/assistants 的其他 surface 不受影响。

  // R15.34: 算当前 mode 的推荐 feed + 应用筛选过滤
  //   - filter: 多个 chip 可叠加 (附近 AND 最近活跃), 都需满足
  //   - "在线" 过滤：要求 person.online
  //   - "会中文" 过滤：要求 person.tags 里有 "会中文" lang tag
  //   - "共同好友" 过滤：要求 mutualFriends >= 1
  //   - "最近活跃" 过滤：要求 person.tags 里有 "最近活跃" social tag
  //   - 距离：半径来自「距离」控件（HOME-MORE-DIST-001），不再是写死的 1km
  // server 端接上后，filter 逻辑移过去；这里只负责本地预览。
  // HOME-RAIL-SERVER-001：rail 的推荐人**先看服务端**（nearbyPeople，来自
  // ListNearbyProfiles），服务端没有内容或还没回来时才退回 SCENE_RECOMMEND 的
  // 本地 fixture。
  //
  // 为什么要服务端优先：rail 原来永远是 fixture 里那 7 个人 —— 库里注册多少用户
  // 界面都不变。服务端优先之后，rail 才是活的。
  //
  // 为什么不干脆删掉 fixture：服务端失败/未登录/没有定位时 rail 会空掉，首页
  // 开天窗比"显示 7 个预览人物"更糟。所以 fixture 降级成兜底，而不是删掉。
  // 它不再是主来源，注释里那句「server 端接上后 filter 逻辑移过去」到这里生效。
  // 服务端 nearby 的线 → rail 用的形状。走 profileWireToPerson 所以头像、句柄、
  // 距离的转换只有一处（HOME-RAIL-SERVER-001）。
  const nearbyPeople: ReadonlyArray<RecommendPerson> = useMemo(
    () => (nearbyWire ?? []).map(profileWireToPerson),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profileWireToPerson 是组件内函数，身份每渲染都变；这里只关心数据本身
    [nearbyWire]
  );
  const baseRecommendFeed: RecommendFeed = SCENE_RECOMMEND[recommendMode] ?? SCENE_RECOMMEND[RECOMMEND_MODE_ORDER[0]!]!;
  const recommendFeed: RecommendFeed =
    nearbyPeople.length > 0
      ? { ...baseRecommendFeed, people: [...nearbyPeople] }
      : baseRecommendFeed;
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
  // SCENE-HOME-ENTRY-001（2026-09-24）：多带两个**接口本来就有**的真实字段
  // —— category（SCENE-CATEGORY-001 的封闭顶类，决定入口卡写「N 家」还是
  // 「N 个」）和 visitedCount（SCENE-REAL-COUNTS-001 的真实派生计数）。
  // 以前没透传，首页就没法说出任何真实数字。
  // SCENE-RATING-CHIP-001（对齐 deepseek_html_20260928_7d0503「新版首页」的
  // 热门场景卡）：接口本来就有 rating/ratingCount（SCENE-REVIEW-001），首页
  // 这份 SceneBrief 之前没透传，跟 HotScenesSurface 已经在用的字段对不齐。
  // 两个字段必须成对判断——count > 0 才算「有评分」，没数据不冒充 0 分。
  // SCENE-DISTANCE-BADGE-001：latitude/longitude 加进来才能算距离——服务端
  // 这两个字段本来就 always-present（无 omitempty），只是这份 SceneBrief
  // 之前没透传。缺真实坐标就是 NaN，sceneDistanceMeters 的 finite 检查会
  // 挡住，不会冒充一个假距离。
  type SceneBrief = { id: string; name: string; area: string; type: string; description: string; best: string; active: boolean; imageUrl: string; category: string; visitedCount: number; latitude: number; longitude: number; rating?: number | undefined; ratingCount?: number | undefined };
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
          category: typeof s.category === "string" ? s.category : "",
          visitedCount: typeof s.visitedCount === "number" && Number.isFinite(s.visitedCount) ? s.visitedCount : 0,
          latitude: typeof s.latitude === "number" ? s.latitude : NaN,
          longitude: typeof s.longitude === "number" ? s.longitude : NaN,
          ...(typeof s.rating === "number" && Number.isFinite(s.rating) ? { rating: s.rating } : {}),
          ...(typeof s.ratingCount === "number" && Number.isFinite(s.ratingCount) ? { ratingCount: s.ratingCount } : {}),
        })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sceneApiBaseUrl, homeRefreshNonce]);
  const activeSceneCount = sceneBriefs.filter((s) => s.active).length;

  // SCENE-DISTANCE-BADGE-001：真实设备定位，取不到就没有距离——不编一个位置
  // （同 hot-scenes.tsx / scene-shop-directory.tsx 的口径）。
  const [homeOrigin, setHomeOrigin] = useState<SceneOrigin>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fix = await getCurrentFix(expoLocationApi, { requestPermission: true });
        if (!cancelled && fix) setHomeOrigin({ latitude: fix.latitude, longitude: fix.longitude });
      } catch { /* 没定位：热门场景卡不带距离角标 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // HOME-RAIL-SERVER-001：拿到定位后向服务端要「附近的真人」，把 rail 从
  // 固定的 7 个 fixture 人物变成活的。
  //
  // 依赖 homeOrigin 而不是自己再取一次定位 —— 同一份定位只有一个来源
  // （SCENE-DISTANCE-BADGE-001 的热门场景距离角标也用它）。取两次会出现
  // 「角标说 3km、rail 按另一个点算」的自相矛盾。
  //
  // 半径用「距离」控件的当前档位（moreDistanceKm），这样控件切到 200km
  // 时 rail 真的会多出人，而不是切了控件只改本地 fixture 的过滤。
  useEffect(() => {
    if (!profileClient) return;
    const seq = (nearbySeq.current += 1);
    let cancelled = false;
    void (async () => {
      try {
        // **没有定位也照发请求**，只是把原点换成河内（HANOI_FALLBACK_ORIGIN）。
        //
        // 第一版是 `if (!profileClient || !homeOrigin) return` —— 模拟器默认
        // 没有定位（getCurrentFix 返回 undefined），于是请求**一次都不发**，
        // rail 永远显示那 7 个 fixture 人物。数据侧和服务端都对了，界面就是不动：
        // 「没定位」被当成了「没数据」，而这两件事完全不同。
        //
        // 用河内做兜底原点，是因为服务端那批开发坐标就是按河内分层的
        // （scripts/dev-distance-tiers.mjs），所以兜底也能看到按距离排好的内容。
        // 它影响的是"以哪为原点排序"，不是伪造任何人的位置 ——
        // 每个被返回的人的 distanceM 仍然是服务端量到他的真实距离。
        const origin = homeOrigin ?? HANOI_FALLBACK_ORIGIN;
        const found = await profileClient.listNearby(
          { latitude: origin.latitude, longitude: origin.longitude },
          { maxDistanceKm: moreDistanceKm, limit: 30 }
        );
        // 自己不能出现在「附近的真人」里
        const withoutSelf = viewerAccountId ? found.filter((p) => p.userAccountId !== viewerAccountId) : found;
        if (!cancelled && seq === nearbySeq.current) setNearbyWire(withoutSelf);
      } catch {
        // 没有定位 / 未登录 / 服务端不可用 —— 保持 undefined 让 rail 退回
        // fixture。**不显示错误**：首页推荐位不该因为定位失败就弹一条提示，
        // fixture 兜底本身就是正确答案。
        if (!cancelled && seq === nearbySeq.current) setNearbyWire(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [profileClient, homeOrigin, moreDistanceKm, viewerAccountId]);

  // SCENE-HOME-HOT-RAIL-001：热榜 = 全部 active 场景按真实 visitedCount 降序取
  // 前 9（commander 2026-09-27：多做几个卡片）。0 去过的场景照进（真实数字
  // 照写「0 人去过」），但 TOP N 角标只给**真的有去过人数**的前 3 ——
  // 0 去过挂 TOP 是冒充热榜。同分按 id 稳定排序，避免刷新时卡片跳位。
  const hotScenes = useMemo(() => (
    sceneBriefs
      .filter((s) => s.active)
      .sort((a, b) => b.visitedCount - a.visitedCount || a.id.localeCompare(b.id))
      .slice(0, 9)
  ), [sceneBriefs]);
  const hotSceneImageUrl = (scene: SceneBrief): string | undefined => {
    if (!scene.imageUrl) return undefined;
    if (/^https?:\/\//i.test(scene.imageUrl)) return scene.imageUrl;
    return sceneApiBaseUrl ? `${sceneApiBaseUrl.replace(/\/$/, "")}/${scene.imageUrl.replace(/^\//, "")}` : undefined;
  };
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
      const at = sceneActivities.findIndex((a) => a.activityId === s.id);
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
  // HOME-FORYOU-REFRESH-001（用户「点击圆圈就是刷新全部可用插槽」）：换组 = 先重新
  // 拉活动（别人刚报满的、我刚下过单的都要反映出来），再只在「有名额、我没下过单、
  // 和锁定的地点 / 时间不冲突」的活动里换一个**不同的**（for-you-slots.ts）。
  // 以前是在本地旧列表上对每条轴 Math.random()：会抽到已满 / 已下单的活动，会无视
  // 锁定的地点 / 时间当场制造冲突（「选择」被禁用），还会抽回同一个。
  // 一个可用的都没有就如实说，不配一个下单必失败的组合。
  function remixForYou(): void {
    void refreshAvailableSlots();
  }

  async function refreshAvailableSlots(): Promise<void> {
    if (slotRefreshing) return;
    setSearchQuery("");
    setClarifyChoices(undefined);
    // HOME-FORYOU-LOCK-001：锁定的轴跳过不重掷。人不占名额，照旧随机。
    if (!lockedSlots.has("person") && filteredPeople.length > 1) setPersonIndex(Math.floor(Math.random() * filteredPeople.length));
    const current = sceneActivities.length > 0 ? sceneActivities[activityIndex % sceneActivities.length] : undefined;
    const lockedPlace = lockedSlots.has("place") && sceneBriefs.length > 0 ? sceneBriefs[placeIndex % sceneBriefs.length] : undefined;
    const lockedTime = lockedSlots.has("time") && distinctTimes.length > 0 ? distinctTimes[timeIndex % distinctTimes.length] : undefined;
    let fresh = storeActivities;
    let joinedByMe: ReadonlySet<string> = new Set<string>();
    if (activities) {
      setSlotRefreshing(true);
      try {
        fresh = (await activities.listActivities()).map(toStoreActivityBrief);
        setStoreActivities(fresh);
        if (!isGuest) {
          // 读不到「我的活动」不阻塞换组：下单时服务端仍会判重（ACTIVITY_ALREADY_JOINED）。
          joinedByMe = await activities.listMyActivities().then((mine) => new Set(mine.joined.map((a) => a.activityId))).catch(() => new Set<string>());
        }
      } catch {
        // 拉不到新数据：用手上的列表换，但如实告诉用户名额可能已变。
        showResponse(t("slotRefreshFailed"), t("slotRefreshFailedSub"));
      } finally {
        setSlotRefreshing(false);
      }
    }
    const freshSceneActivities = activitiesAtCoffeeShops(fresh, sceneBriefs);
    const pick = pickRefreshedActivity(
      freshSceneActivities,
      sceneBriefs,
      { activityId: !lockedSlots.has("activity") ? undefined : current?.activityId, placeSceneId: lockedPlace?.id, time: lockedTime },
      joinedByMe,
      current?.activityId,
    );
    if (pick.kind === "none") {
      showResponse(pick.reason === "LOCKED_ACTIVITY_UNAVAILABLE" ? t("slotLockedUnavailable") : t("slotNoneAvailable"), t("slotNoneAvailableSub"));
      return;
    }
    const picked = freshSceneActivities[pick.index]!;
    setActivityIndex(pick.index);
    // 没锁的时间 / 地点本来就跟着活动走（渲染时派生）；index 也对齐，解锁那一刻不跳。
    if (!lockedSlots.has("time")) {
      const at = [...new Set(freshSceneActivities.map((a) => a.time).filter(Boolean))].indexOf(picked.time);
      if (at >= 0) setTimeIndex(at);
    }
    if (!lockedSlots.has("place")) {
      const sceneId = sceneIdOfActivity(picked, sceneBriefs);
      const at = sceneBriefs.findIndex((scene) => scene.id === sceneId);
      if (at >= 0) setPlaceIndex(at);
    }
    showResponse(t("recombo"), t("recomboSub"));
  }

  function refineHomeSearchSlot(slot: "person" | "time" | "activity" | "place"): void {
    // HOME-FORYOU-LOCK-001：锁定的格子不接受更换 —— 跟点格子一个口径。
    if (lockedSlots.has(slot)) {
      showResponse(t("lockedBlock"), t("lockedBlockSub"));
      return;
    }
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
      const walkIdx = sceneActivities.findIndex((a) => a.title.includes("散步") || a.title.includes("Walk"));
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
      const coffeeActIdx = sceneActivities.findIndex((a) => a.title.includes("咖啡"));
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
    // HOME-PEOPLE-SEARCH-RACE-001：本地命中时**也要**说话。本地命中只换了
    // 四宫格；服务端一条都没找到时（fixture 里的人本来就不在服务端），用户
    // 会再次看到「什么都没发生」。文案分开写：本地命中时不能报
    //「本地推荐没有命中，正在问服务端」（那是假的）。
    if (shouldSearchServerPeople(q, !!profileClient)) {
      setClarifyChoices(undefined);
      showResponse(
        t("searchingServer", { q }),
        consumedLocal ? t("searchingServerLocalHitSub") : t("searchingServerSub")
      );
      void runServerPeopleSearch(q, true, consumedLocal);
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
  // HOME-FORYOU-ORDER-001：确认下单页要诚实地区分"免费/收费"（用户反馈：
  // "免费收费只是一个选择啊"，不能预设永远免费）——moneyFlow/priceLabel/
  // venueSpend/desc/benefit 服务端本来就发了（Activity 契约里就有），
  // 只是这个精简 brief 类型之前没接，现在补上。
  // HOME-FORYOU-ORDER-002（用户："for you的确认下单页面还缺了一个订单编号"）：
  // ORDER-NO-001 之后加入活动有独立的个人订单号（JoinActivity 回 orderNo，
  // 纯数字：场地类别码3位+越南日期+每日序号，如 1002609270002；重复下单走 safeDetails 带回原号）。
  // 下单页优先显示个人订单号；老服务端没有该字段时回落活动自己的 code
  //（PX-A-yymmdd-####，PublishActivity 时生成，老的/种子活动没有就是没有，不补假号）。
  type StoreActivityBrief = { activityId: string; code: string | undefined; title: string; venueName: string; time: string; people: string; joined: number; capacity: number; coverImageUrl: string | undefined; realitySceneId: string | undefined; priceLabel: string; moneyFlow: string; venueSpend: string; desc: string; benefit: string };
  const [storeActivities, setStoreActivities] = useState<StoreActivityBrief[]>([]);
  // 首屏加载与中心圆圈刷新（HOME-FORYOU-REFRESH-001）共用同一份映射。
  function toStoreActivityBrief(a: Activity): StoreActivityBrief {
    return {
      activityId: a.activityId,
      code: a.code,
      title: a.title,
      venueName: a.venueName,
      time: a.time,
      people: a.people,
      joined: a.joined,
      capacity: a.capacity ?? 0,
      coverImageUrl: a.coverImageUrl,
      realitySceneId: a.realitySceneId,
      priceLabel: a.priceLabel,
      moneyFlow: a.moneyFlow,
      venueSpend: a.venueSpend,
      desc: a.desc,
      benefit: a.benefit,
    };
  }
  useEffect(() => {
    if (!activities) return;
    let cancelled = false;
    void trackHomeLoad(activities.listActivities())
      .then((list) => {
        if (cancelled) return;
        const briefs = list.map(toStoreActivityBrief);
        setStoreActivities(briefs);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activities, homeRefreshNonce]);
  // HOME-FORYOU-ORDER-GUARD-001（用户「确认下单后 收到 recipe 再次返回 home 可以同参数
  // 再次下单 这个违法基本资源冲突逻辑 要做守卫和检查提示」）：Home 知道我手上已有
  // 哪些单（跟「我的订单」同一个来源 ListMyActivities），四宫格下单前先查冲突。
  // 未登录 / 读失败就是空列表——服务端照样会拒重复单和同时段单（真正的守卫在那）。
  type MyForYouOrder = ExistingOrder & { snapshot?: ActivityOrderSnapshot | undefined };
  const [myOrders, setMyOrders] = useState<MyForYouOrder[]>([]);
  useEffect(() => {
    if (!activities) return;
    let cancelled = false;
    void activities.listMyActivities()
      .then((payload) => {
        if (cancelled) return;
        setMyOrders(payload.joined.map((a) => {
          const order = payload.joinOrders.find((o) => o.activityId === a.activityId);
          return {
            activityId: a.activityId,
            title: order?.snapshot?.activity.title ?? a.title,
            time: order?.snapshot?.activity.time ?? a.time,
            orderNo: order?.orderNo,
            cancelled: order?.state === "CANCELLED",
            snapshot: order?.snapshot,
          };
        }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activities, homeRefreshNonce]);
  function rememberMyOrder(activityId: string, orderNumber: string | undefined, snapshot: ActivityOrderSnapshot | undefined): void {
    const act = storeActivities.find((a) => a.activityId === activityId);
    setMyOrders((prev) => prev.some((o) => o.activityId === activityId) ? prev : [...prev, {
      activityId,
      title: snapshot?.activity.title ?? act?.title ?? "",
      time: snapshot?.activity.time ?? act?.time ?? "",
      orderNo: orderNumber,
      snapshot,
    }]);
  }
  function orderConflictText(conflict: OrderConflict): string {
    return conflict.kind === "ALREADY_ORDERED"
      ? t("orderConflictAlready", { orderNo: conflict.orderNo ?? "—" })
      : t("orderConflictTime", { time: conflict.time, title: conflict.title });
  }

  // HOME-FORYOU-SCENE-001：四宫格「场景」格只从挂在真实咖啡店场景上的活动里选；
  // activityIndex 一律索引这份列表（选择器 / 整组换 / 意图预设 / 渲染同一份）。
  const sceneActivities = useMemo(() => activitiesAtCoffeeShops(storeActivities, sceneBriefs), [storeActivities, sceneBriefs]);

  // Home Search/Conversation v3 — 一个输入框同时做实体匹配和模型对话。
  // 索引里的四个分组**来源不一样**，别把它们混为一谈：
  //   - activities / scenes / times：来自上方已拉取的真实接口列表；
  //   - people：本地推荐预览 + 服务端全站（ProfileClient.searchProfiles，
  //     PROFILE-SEARCH-001 已上，HOME-PEOPLE-SEARCH-001 已接）：输入人名先匹配
  //     本地推荐，够长（≥2 码点）且有 ProfileClient 就再问服务端全站用户，
  //     结果独立展示。只看本地会漏掉新注册用户。
  // 列表为空时 lookup 自然无候选，输入直接走模型对话。
  const distinctTimes = [...new Set(sceneActivities.map((a) => a.time).filter(Boolean))];
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
        case "FOR_YOU_COMPANION_REQUIRED":
          return t("comboNeedPerson");
        case "ACTIVITY_TIME_CONFLICT": {
          const details = error.result.error?.safeDetails ?? {};
          return t("orderConflictTime", { time: typeof details.time === "string" ? details.time : "", title: typeof details.title === "string" ? details.title : "" });
        }
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

  async function joinSelected(activityId: string | undefined, recipe?: ActivityJoinRecipe): Promise<"joined" | "already" | "failed"> {
    setJoinMsg(undefined);
    setOrderSnapshot(undefined);
    if (!activityId) {
      setJoinMsg(t("pickActivityFirst"));
      return "failed";
    }
    if (!activities) {
      setJoinMsg(t("loginToJoin"));
      return "failed";
    }
    // HOME-FORYOU-PERSON-001：For You 下单必须带同行人（服务端同样会拒）。
    if (recipe?.source === "FOR_YOU" && !recipe.companion) {
      setJoinMsg(t("comboNeedPerson"));
      return "failed";
    }
    // HOME-FORYOU-ORDER-GUARD-001：提交前再查一次资源冲突（四宫格那一步已经拦过，
    // 这里防确认页开着期间状态变了）。
    const target = storeActivities.find((a) => a.activityId === activityId);
    const conflict = target ? detectOrderConflict({ activityId, time: target.time }, myOrders) : undefined;
    if (conflict) {
      setJoinMsg(orderConflictText(conflict));
      return "failed";
    }
    setJoinBusy(true);
    try {
      const result = await activities.join(activityId, recipe);
      setStoreActivities((prev) => prev.map((a) => (a.activityId === activityId ? { ...a, joined: result.activity.joined } : a)));
      setJoinMsg(t("joinedWithCount", { n: result.activity.joined }));
      setOrderNo(result.orderNo ?? "");
      setOrderSnapshot(result.snapshot ?? undefined);
      rememberMyOrder(activityId, result.orderNo, result.snapshot ?? undefined);
      return "joined";
    } catch (e) {
      if (e instanceof ActivityCommandRejectedError && e.result.error?.errorCode === "ACTIVITY_ALREADY_JOINED") {
        const prior = e.result.error?.safeDetails?.orderNo;
        setOrderNo(typeof prior === "string" ? prior : "");
        // 重复下单：服务端把当初存的票面带回来，照原样画（不是用这次四宫格的选择）。
        const priorSnapshot = ActivityOrderSnapshotSchema.safeParse(e.result.error?.safeDetails?.snapshot);
        setOrderSnapshot(priorSnapshot.success ? priorSnapshot.data : undefined);
        rememberMyOrder(activityId, typeof prior === "string" ? prior : undefined, priorSnapshot.success ? priorSnapshot.data : undefined);
        return "already";
      }
      setJoinMsg(joinErrorMessage(e));
      return "failed";
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
    <ScrollView refreshControl={<RefreshControl refreshing={homeRefreshing} onRefresh={onHomeRefresh} />} style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled">
      {/* HOME-SEARCH-TAP-001：键盘开着时点「发送」只被当成"收起键盘"，按钮
          根本点不动（要连点两次才提交）。RN 的 ScrollView 默认
          keyboardShouldPersistTaps="never"：那次点击被键盘收起吞掉，不会传给
          子节点。feed 的搜索框早就踩过同一个坑（surfaces/feed.tsx），这里同样
          改成 handled。 */}
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
      {/* R34_12_1 4-Grid: selection stays with discovery content; the unified
          search/model entry itself lives at the top of Home. */}
      {onChat ? (
        <>
          {(() => {
            // HOME-FORYOU-POOL-001：**活动是主轴** —— 它自己带着场地和时间。
            // 原来 place / time 是另外两条独立轴各自取模，于是能配出两种不可能的组合：
            // ① 活动**不在**那个场地办（活动挂 realitySceneId，场地是另一条轴）；
            // ② 时间**不是**那场活动的时间（distinctTimes 本就是从活动时间派生的）。
            // 现在：场地跟着活动走（口径与活动选择器 :1236 一致），时间直接取活动自己的；
            // 只有活动没有已知场地时，才退回 placeIndex 那条兜底。
            const gridPerson = filteredPeople.length > 0 ? filteredPeople[personIndex % filteredPeople.length] : undefined;
            const gridActivity = sceneActivities.length > 0 ? sceneActivities[activityIndex % sceneActivities.length] : undefined;
            const gridActivitySceneId = gridActivity ? sceneIdOfActivity(gridActivity, sceneBriefs) : undefined;
            // 可用门禁（圆圈刷新的核心测试点）：活动是唯一“成立”判据——sceneActivities
            // 只收挂真实咖啡店的活动（activitiesAtCoffeeShops），每个都有已知场地。
            // 没有可用活动就不配组合：人/地点/时间单独摆出来也组不成一次可约，
            // 不可用的不能被刷到。时间是个例外：活动本身没写时间时，用池子里别的
            // 真实活动时间顶一下（时间值本身是真实档位，不影响“可约”）。
            if (!gridActivity) return null;
            const gridPlace = gridActivitySceneId ? sceneBriefs.find((s) => s.id === gridActivitySceneId) : undefined;
            if (!gridPlace) return null;
            const gridTime = gridActivity?.time || (distinctTimes.length > 0 ? distinctTimes[timeIndex % distinctTimes.length] : undefined);
            // HOME-FORYOU-CONFLICT-001（用户："自由切换被派生了...如果有资源
            // 冲突 要的就是提示 点击选择不能下一步 提示换"）：地点/时间只在
            // 用户**真的锁定**了才拿去跟活动的真实场地/时间比——没锁的轴本来
            // 就该跟着活动走，那不叫冲突。冲突存在时禁用「选择」+ 显示提示，
            // 不再让派生悄悄吃掉锁定。
            const lockedPlaceScene = lockedSlots.has("place") && sceneBriefs.length > 0 ? sceneBriefs[placeIndex % sceneBriefs.length] : undefined;
            const lockedTimeValue = lockedSlots.has("time") && distinctTimes.length > 0 ? distinctTimes[timeIndex % distinctTimes.length] : undefined;
            // 显示冻结：锁定的地点/时间显示锁定的值，不跟活动静默走（上面派生只
            // 负责未锁定的默认行为 + 冲突判定）。锁了还变就是 CONFLICT-001 说的
            // “被派生”——冻结之后冲突提示 + 禁用选择才真正有意义。
            const displayPlace = lockedSlots.has("place") && lockedPlaceScene !== undefined ? lockedPlaceScene : gridPlace;
            const displayTime = lockedSlots.has("time") && lockedTimeValue !== undefined ? lockedTimeValue : gridTime;
            const comboConflicts = detectComboConflicts(gridActivity, sceneBriefs, { place: lockedPlaceScene, time: lockedTimeValue });
            const comboConflictText = comboConflicts.map((conflict) => conflict.slot === "place"
              ? t("comboConflictPlace", { locked: conflict.lockedSceneName, activity: conflict.activitySceneName ?? "" })
              : t("comboConflictTime", { locked: conflict.lockedTime, activity: conflict.activityTime })).join(" · ");
            // HOME-FORYOU-PERSON-001（用户「人呢 没人怎么同行呢 没人怎么进行下一步 逻辑不通
            // 违背规则」）：For You 是「人 + 时间 + 场景 + 地点」四样一起下单，没人就不是
            // 一个组合——不许进确认下单，也不许下出一张「没有同行人」的票。
            // HOME-FORYOU-ORDER-GUARD-001：已经下过这一单 / 这个时间段已经有单，也不能再下。
            const orderConflict = detectOrderConflict({ activityId: gridActivity.activityId, time: gridActivity.time }, myOrders);
            const existingOrder = orderConflict?.kind === "ALREADY_ORDERED" ? myOrders.find((o) => o.activityId === gridActivity.activityId && !o.cancelled) : undefined;
            const comboBlocked = comboConflicts.length > 0 || !gridPerson || orderConflict !== undefined;
            const comboBlockText = orderConflict ? orderConflictText(orderConflict) : !gridPerson ? t("comboNeedPerson") : comboConflictText;
            const remixAll = (): void => {
              // HOME-FORYOU-LOCK-001：中心键与 remixForYou 收成**同一条**重配链
              // （锁定轴跳过的口径只维护一份）。
              remixForYou();
            };
            const composed = [gridPerson ? t("withPerson", { name: gridPerson.name }) : "", displayTime ?? "", gridActivity && gridActivity.venueName !== displayPlace?.name ? gridActivity.venueName : "", displayPlace ? `@${displayPlace.name}` : ""].filter(Boolean).join(" ");
            // HOME-FORYOU-DEDUP-001（用户「three beans cau giay 有重复的 3 个」）：
            // 场景（店）就是活动的承载场所，店名只在「场景」格出现一次——
            // 时间格副标题不再抄店名，地点格改显示区域（Cầu Giấy），场景格
            // 店名去掉跟地点格重复的「· 区域」后缀。
            const sceneShopName = gridActivity ? stripAreaSuffix(gridActivity.venueName, displayPlace?.area) : "";
            // ORDER-RECIPE-001：这次下单要存进票面的 For You 选择（能下单时没有锁定冲突，
            // 地点/时间就是活动真实的那一份）。头像只有远端地址才存得下（打包在 App 里的
            // 图没有地址），服务端也只收 http(s)。
            const forYouRecipe: ActivityJoinRecipe = {
              source: "FOR_YOU",
              ...(gridTime ? { time: gridTime } : {}),
              place: { name: gridPlace.name, ...(gridPlace.area ? { area: gridPlace.area } : {}) },
              ...(gridPerson ? { companion: { id: gridPerson.id, name: gridPerson.name, ...(gridPerson.bio ? { bio: gridPerson.bio } : {}), ...(typeof gridPerson.photoUri === "string" && /^https?:\/\//.test(gridPerson.photoUri) ? { photoUrl: gridPerson.photoUri } : {}) } } : {}),
            };
            const ticketSnapshot: ActivityOrderSnapshot = orderSnapshot ?? {
              orderNo: orderNo || gridActivity.code || gridActivity.activityId,
              orderedAt: new Date().toISOString(),
              source: "FOR_YOU",
              activity: { activityId: gridActivity.activityId, title: gridActivity.title, priceLabel: gridActivity.priceLabel, moneyFlow: gridActivity.moneyFlow, venueSpend: gridActivity.venueSpend, venueName: gridActivity.venueName, time: gridActivity.time, joined: gridActivity.joined, capacity: gridActivity.capacity },
              ...(forYouRecipe.time ? { time: forYouRecipe.time } : {}),
              ...(forYouRecipe.place ? { place: forYouRecipe.place } : {}),
              ...(forYouRecipe.companion ? { companion: forYouRecipe.companion } : {}),
            };
            const ticketCompanionPhoto = gridPerson && ticketSnapshot.companion?.id === gridPerson.id && gridPerson.photoUri ? { uri: gridPerson.photoUri } : undefined;
            const tiles = [
              gridPerson
                ? { key: `person:${gridPerson.id}`, slot: "person" as const, imageUri: gridPerson.photoUri, glyph: "●", label: gridPerson.name, sub: t("tilePersonSub") }
                : { key: "person:none", slot: "person" as const, imageUri: undefined, glyph: "●", label: t("tileNoPerson"), sub: t("tileNoPersonSub") },
              displayTime ? { key: `time:${displayTime}`, slot: "time" as const, imageUri: displayPlace?.imageUrl, glyph: "◷", label: displayTime, sub: t("tileTime") } : undefined,
              gridActivity ? { key: `act:${gridActivity.activityId}`, slot: "activity" as const, imageUri: displayPlace?.imageUrl, glyph: "☕", label: sceneShopName, sub: gridActivity.title } : undefined,
              displayPlace ? { key: `place:${displayPlace.id}`, slot: "place" as const, imageUri: displayPlace.imageUrl, glyph: "●", label: displayPlace.area || displayPlace.name, sub: t("tilePlace") } : undefined,
            ];
            return (
              <View>
                <View style={styles.forYouHead}>
                  <View style={{ flex: 1 }}>
                    {/* FORYOU-LOGO-001：新版主 Logo 28px + 「为你组合」+ 黑底白字 For You 药丸。 */}
                    <View style={styles.peopleTitleRow}>
                      <ForYouGlyph size={28} />
                      <Text selectable style={styles.peopleTitle}>{t("combo")}</Text>
                      <View style={styles.forYouBadge}><Text selectable style={styles.forYouBadgeText}>For You</Text></View>
                    </View>
                    <Text selectable style={styles.peopleSub}>{t("gridSub")}</Text>
                  </View>
                </View>
                <View style={styles.gridStage}>
                  <View style={styles.grid4}>
                    {tiles.map((tile) => tile ? (
                      /* HOME-FORYOU-LOCK-001：外壳必须是 **View**，点击层和锁钮
                         是兄弟 —— 锁钮嵌在 Pressable 里会被外层吞触摸，锁就永远
                         切不动（2026-09-27 用户实测踩坑）。 */
                      <View key={tile.key} style={[styles.gridTile, lockedSlots.has(tile.slot) && styles.gridTileLocked]}>
                        <Pressable onPress={() => { if (lockedSlots.has(tile.slot)) { showResponse(t("lockedBlock"), t("lockedBlockSub")); return; } setChooser(tile.slot); }} style={styles.gridTileTap}>
                          {tile.imageUri ? <Image source={{ uri: tile.imageUri }} style={styles.gridImage} /> : <View style={styles.gridImageMissing}><Text selectable style={styles.gridGlyph}>{tile.glyph}</Text></View>}
                          <View style={styles.gridOverlay}>
                            <Text selectable style={[styles.gridLabel, !tile.imageUri && styles.gridLabelDark]} numberOfLines={1}>{tile.label}</Text>
                            <Text selectable style={[styles.gridSub, !tile.imageUri && styles.gridSubDark]} numberOfLines={1}>{tile.sub}</Text>
                          </View>
                        </Pressable>
                        {/* 锁钮：开锁 = 锁环抬起悬空（白）；关锁 = 锁环扣上 + 金底深图。 */}
                        <Pressable accessibilityLabel={lockedSlots.has(tile.slot) ? t("unlockSlot") : t("lockSlot")} hitSlop={6} onPress={() => toggleSlotLock(tile.slot)} style={[styles.gridLock, lockedSlots.has(tile.slot) && styles.gridLockOn]}>
                          <View style={[styles.gridLockShackle, lockedSlots.has(tile.slot) ? styles.gridLockShackleOn : styles.gridLockShackleOff]} />
                          <View style={[styles.gridLockBody, lockedSlots.has(tile.slot) && styles.gridLockBodyOn]} />
                        </Pressable>
                      </View>
                    ) : null)}
                  </View>
                  <Pressable
                    accessibilityHint={t("changeAllHint")}
                    accessibilityLabel={t("changeAllLabel")}
                    accessibilityRole="button"
                    disabled={slotRefreshing}
                    hitSlop={8}
                    onPress={remixAll}
                    style={({ pressed }) => [styles.gridRemixButton, pressed && styles.gridRemixButtonPressed]}
                  >
                    <ProxyIcon color={color.white} name="remix" size={25} />
                  </Pressable>
                </View>
                {lockedSlots.size > 0 ? <Text selectable style={styles.gridLockInfo}>{t("lockedHint", { n: lockedSlots.size })}</Text> : null}
                {composed ? (
                  <View>
                    {/* SEARCH-REPLY-BUDGET-001：搜索/重配的回复条插在搜索框下面，
                        会把这一块整体往下顶。按钮底边正好在浮动 dock 上沿（零余量），
                        被顶了就整颗藏到玻璃 dock 后面。所以有回复时**让出上面那行
                        提示**（双链路提示是常驻说明，回复是当下要说的话，此时后者
                        更有用），并收掉按钮的上边距 —— 两处共让 ~31pt，正好抵掉
                        回复条的 ~29pt，按钮留在原处。改这里必须同步改
                        home-search-dock 的 responseBar / responseInner。 */}
                    {responseText ? null : <Text selectable style={styles.chainHint}>{t("chainHint")}</Text>}
                    {/* HOME-FORYOU-LOCK-001 同批（commander 2026-09-27）：格下
                        三个入口收成一个 —— 保留报名这条和原型「选择 → 确认支付」
                        对应的交易链；出图 / 发布需求从四宫格摘除（发布需求在
                        附近场景区仍有入口）。
                        HOME-FORYOU-SELECT-001（用户三轮反馈：先是"还是报名 不是
                        选择"，改成两段式"选择→已选择→再点一下"之后又反馈"中间
                        环节跳过了"——两段式在真机上被读成第一下点击什么都没
                        发生，去掉；再反馈"选择不是报名而是直接进入下单"——sheet
                        标题和按钮文案改成跟 DIRECT-INVITE-CONFIRM-001 同一套
                        "确认下单"词汇，不叫"报名"。一次点击直达「确认下单」
                        sheet，真的 joinSelected 从 sheet 里的按钮发出，命令
                        本身没变（这仍是真的加入一场有名额上限的活动，不是
                        平台代收款的商业订单——"下单"是这个 app 里"敲定一个
                        真实计划"的通用说法，不是"付了钱"的意思）。 */}
                    <Pressable
                      disabled={comboBlocked}
                      onPress={() => { setJoinMsg(undefined); setOrderDone(false); setOrderCodeCopied(false); setOrderNo(""); setJoinConfirmOpen(true); }}
                      style={[styles.gridCta, responseText && styles.gridCtaFlush, comboBlocked && styles.gridCtaDisabled]}
                      accessibilityLabel={comboBlocked ? comboBlockText : t("selectComboCtaA11y")}
                    >
                      <Text selectable style={styles.gridCtaTextSmall}>{t("selectComboCta")}</Text>
                    </Pressable>
                    {/* HOME-FORYOU-ORDER-001（用户："这个原型你没有吗 选择-跳出这个
                        啊"，指向 deepseek_html_20260927_226eac「确认下单」整屏）：
                        跟 DIRECT-INVITE-CONFIRM-001 同一套版式——人/时间/活动/地点/
                        费用分块 + 底部合计与提交。每一块都是这一屏已经拿在手里的
                        真数据；费用块诚实读 gridActivity 真实的 moneyFlow/
                        priceLabel/venueSpend（用户："免费收费只是一个选择啊"，不
                        预设永远免费）——今天仓库里的活动全是 FREE + 到店消费，
                        但字段本来就支持 PAY_TO_JOIN/PAID_TO_ATTEND，读真值就对了，
                        不用为了"看起来像下单"去编一个人工报酬输入框（那是
                        DIRECT_INVITE 邀真人才有的形状，这里的人是推荐 fixture，
                        没有真实收款方）。 */}
                    {comboBlocked ? <Text selectable style={styles.comboConflictText}>{comboBlockText}</Text> : null}
                    {existingOrder ? (
                      <Pressable
                        accessibilityLabel={t("viewExistingOrder")}
                        onPress={() => {
                          // 没存票面的老单：只用活动本身 + 订单号拼，不借当前四宫格的人/地点冒充当时的选择。
                          setOrderNo(existingOrder.orderNo ?? "");
                          setOrderSnapshot(existingOrder.snapshot ?? {
                            orderNo: existingOrder.orderNo ?? gridActivity.code ?? gridActivity.activityId,
                            orderedAt: "",
                            activity: { activityId: gridActivity.activityId, title: gridActivity.title, time: gridActivity.time, venueName: gridActivity.venueName, priceLabel: gridActivity.priceLabel, moneyFlow: gridActivity.moneyFlow, venueSpend: gridActivity.venueSpend, joined: gridActivity.joined, capacity: gridActivity.capacity },
                            time: gridActivity.time,
                            place: { name: gridActivity.venueName },
                          });
                          setOrderExisting(true);
                          setOrderCodeCopied(false);
                          setOrderDone(true);
                          setJoinConfirmOpen(true);
                        }}
                        style={styles.viewExistingOrderBtn}
                      >
                        <Text selectable style={styles.viewExistingOrderText}>{t("viewExistingOrder")} ›</Text>
                      </Pressable>
                    ) : null}
                    <Modal animationType="slide" onRequestClose={closeOrderFlow} visible={joinConfirmOpen}>
                      {orderDone ? (
                        <View style={[styles.confirmPage, styles.orderPage]}>
                          {/* HOME-FORYOU-ORDER-003：已下单票券页，版式照原型
                              Proxy_MyTickets_20260928_d7fef9「我的票券」。
                              原型里**删了两样**，都是没有真能力的东西：
                              · 二维码：CheckinActivity 只是个普通命令、不认码，
                                画一个"能扫"的码是假能力（placeholder-honest-actions）。
                              · 开场前两小时那条：这个 App 没有推送通道
                                （package.json 里没有 expo-notifications，
                                全仓没有 Notifications. 调用），写出来是一句
                                兑现不了的承诺。
                              ⚠️ 这段注释刻意**不写**那两句被禁的原话 —— 门禁里
                              有反向钉扫这个文件，注释里写着它会把钉自己喂红
                              （REPLY-EMPTY-VIEWER-001 踩过同一个坑）。
                              二维码那个位置换成**订单编号**（用户明确要的）。
                              底部加日历那个位置同理换成「分享」：没有 expo-calendar，
                              而且 activity.time 是活动自己写的自由文本、不是可解析
                              的时间戳，编不出一个真的日历事件。 */}
                          {orderHeroVisible ? (
                            <View style={[styles.orderHero, { paddingTop: safeArea.top + 12 }]}>
                              <View style={styles.orderSuccessIcon}><ProxyIcon color={color.white} name="check" size={24} /></View>
                              <Text selectable style={styles.orderTitle}>已下单</Text>
                              <Text selectable style={styles.orderSub}>{orderExisting ? "你之前已经下过这一单" : ticketSnapshot.companion ? `到时候见 · ${ticketSnapshot.companion.name}` : "已加入这场活动"}</Text>
                              <View style={styles.orderMetaRow}>
                                <View style={styles.orderMetaItem}>
                                  <Text selectable style={styles.orderMetaLabel}>人数</Text>
                                  <Text selectable style={styles.orderMetaValue}>{peopleCountLabel(ticketSnapshot)}</Text>
                                </View>
                                <View style={styles.orderMetaItem}>
                                  <Text selectable style={styles.orderMetaLabel}>状态</Text>
                                  <Text selectable style={[styles.orderMetaValue, styles.orderMetaValueGood]}>已确认</Text>
                                </View>
                              </View>
                            </View>
                          ) : null}
                          {/* HOME-FORYOU-ORDER-006：hero 退场后 ScrollView 从 y=0 开始，
                              orderTicket 的 -14 上叠会把订单编号 chip 顶进状态栏/
                              灵动岛底下（屏顶只剩 2pt）。hero 不在时补 safeArea 顶距，
                              票券落在状态栏下方（净空 safeArea.top+10）；hero 在时
                              保持原版式（-14 塞进 hero 圆角）。 */}
                          <ScrollView contentContainerStyle={[styles.confirmScroll, !orderHeroVisible && { paddingTop: safeArea.top + 24 }]} style={styles.confirmScrollFlex}>
                            <ActivityOrderTicket
                              companionPhotoSource={ticketCompanionPhoto}
                              copied={orderCodeCopied}
                              onCopyOrderNo={() => { void Clipboard.setStringAsync(ticketSnapshot.orderNo).then(() => setOrderCodeCopied(true)).catch(() => undefined); }}
                              overlapHero
                              snapshot={ticketSnapshot}
                            />
                          </ScrollView>
                          <View style={[styles.confirmFooter, { paddingBottom: safeArea.bottom + 16 }]}>
                            <Pressable
                              onPress={() => { void Share.share({ message: `${gridActivity?.title ?? "活动"} · ${gridTime ?? ""} · ${gridPlace?.name ?? ""}${gridActivity?.code ? ` · ${gridActivity.code}` : ""}` }); }}
                              style={styles.orderGhostBtn}
                            >
                              <Text selectable style={styles.orderGhostBtnText}>分享</Text>
                            </Pressable>
                            {gridPerson ? (
                              <Pressable onPress={() => { closeOrderFlow(); onMessageHuman?.(gridPerson); }} style={[styles.confirmActionCta, { flex: 1.4 }]}>
                                <Text selectable style={styles.confirmActionCtaText}>联系{gridPerson.name}</Text>
                              </Pressable>
                            ) : (
                              <Pressable onPress={closeOrderFlow} style={[styles.confirmActionCta, { flex: 1.4 }]}>
                                <Text selectable style={styles.confirmActionCtaText}>完成</Text>
                              </Pressable>
                            )}
                          </View>
                          {/* HOME-FORYOU-ORDER-007：成功页没有返回入口 —— 确认页有
                              confirmTopBar 的返回键，这页没有；全屏 Modal iOS 不能
                              下滑关闭，选了同行人时底部只有「分享/联系」，用户被困住。
                              绝对定位盖在左上角：hero 在时 onDark（白字形压深底），
                              退场后 ink（浅底）。位置在票券左上角外侧 —— chip 居中，
                              左上只有卡片留白，不抢点击区。 */}
                          <Pressable accessibilityLabel="返回" onPress={closeOrderFlow} style={[styles.orderBackButton, { top: safeArea.top + 6 }]}>
                            <ProxyBackGlyph tone={orderHeroVisible ? "onDark" : "ink"} />
                          </Pressable>
                        </View>
                      ) : (
                        <View style={[styles.confirmPage, { paddingTop: safeArea.top }]}>
                          <View style={styles.confirmTopBar}>
                            <Pressable accessibilityLabel="返回" onPress={() => setJoinConfirmOpen(false)} style={styles.confirmBackButton}><ProxyBackGlyph /></Pressable>
                            <Text selectable style={styles.confirmTitle}>{t("confirmJoinTitle")}</Text>
                            <View style={styles.confirmTopSpacer} />
                          </View>
                          <ScrollView contentContainerStyle={styles.confirmScroll} style={styles.confirmScrollFlex}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.confirmRecapRail}>
                              {tiles.map((tile) => tile ? (
                                <View key={`recap:${tile.key}`} style={styles.confirmRecapCard}>
                                  {tile.imageUri ? <Image source={{ uri: tile.imageUri }} style={styles.confirmRecapImage} /> : <View style={[styles.confirmRecapImage, styles.momentImageMissing]}><Text selectable style={styles.gridGlyph}>{tile.glyph}</Text></View>}
                                  <PhotoScrim />
                                  <Text selectable numberOfLines={1} style={styles.confirmRecapName}>{tile.label}</Text>
                                </View>
                              ) : null)}
                            </ScrollView>
                            <View style={styles.confirmBlock}>
                              <Text selectable style={styles.confirmBlockTitle}>一起的人</Text>
                              {gridPerson ? (
                                <View style={styles.confirmPersonRow}>
                                  {gridPerson.photoUri ? <Image source={{ uri: gridPerson.photoUri }} style={styles.confirmPersonAvatar} /> : <View style={[styles.confirmPersonAvatar, styles.photoChooserFallback]}><Text selectable style={styles.personChooserInitials}>{gridPerson.initials}</Text></View>}
                                  <View style={styles.confirmPersonInfo}>
                                    <Text selectable style={styles.confirmPersonName}>{gridPerson.name}</Text>
                                    <Text selectable style={styles.confirmBodyText}>{gridPerson.bio}</Text>
                                  </View>
                                </View>
                              ) : <Text selectable style={styles.confirmBodyText}>还没选人</Text>}
                            </View>
                            <View style={styles.confirmBlock}>
                              <Text selectable style={styles.confirmBlockTitle}>时间</Text>
                              <Text selectable style={styles.confirmRecapLine}>{gridTime ?? "时间待定"}</Text>
                            </View>
                            {gridActivity ? (
                              <View style={styles.confirmBlock}>
                                <View style={styles.confirmBlockTitleRow}>
                                  <Text selectable style={styles.confirmBlockTitle}>{gridActivity.title}</Text>
                                  {gridActivity.people ? <Text selectable style={styles.confirmBlockTag}>{gridActivity.people}</Text> : null}
                                </View>
                                {gridActivity.desc ? <Text selectable style={styles.confirmBodyText}>{gridActivity.desc}</Text> : null}
                                {gridActivity.benefit ? <Text selectable style={styles.confirmMenuLine}>{gridActivity.benefit}</Text> : null}
                                {gridActivity.code ? <Text selectable style={styles.confirmMenuLine}>活动编号：{gridActivity.code}</Text> : null}
                              </View>
                            ) : null}
                            {gridPlace ? (
                              <View style={styles.confirmBlock}>
                                <Text selectable style={styles.confirmBlockTitle}>地点</Text>
                                <Text selectable style={styles.confirmPersonName}>{gridPlace.name}</Text>
                                <Text selectable style={styles.confirmBodyText}>{gridPlace.area}</Text>
                                <Pressable onPress={() => openGridPlaceNavigation(gridPlace)} style={styles.confirmGhostBtn}><Text selectable style={styles.confirmGhostBtnText}>导航去这里</Text></Pressable>
                                {confirmNavMsg ? <Text selectable style={styles.confirmBodyText}>{confirmNavMsg}</Text> : null}
                              </View>
                            ) : null}
                            {gridActivity && (gridActivity.priceLabel || gridActivity.venueSpend) ? (
                              <View style={[styles.confirmBlock, styles.confirmFeeBlock]}>
                                <Text selectable style={styles.confirmBlockTitle}>费用</Text>
                                {gridActivity.priceLabel ? (
                                  <View style={styles.confirmFeeRow}>
                                    <Text selectable style={styles.confirmFeeRowLabel}>报名</Text>
                                    <Text selectable style={[styles.confirmFeeRowValue, gridActivity.moneyFlow === "FREE" && styles.confirmFeeRowValueGood]}>{gridActivity.priceLabel}</Text>
                                  </View>
                                ) : null}
                                {gridActivity.venueSpend ? (
                                  <View style={styles.confirmFeeRow}>
                                    <Text selectable style={styles.confirmFeeRowLabel}>到店消费</Text>
                                    <Text selectable style={styles.confirmFeeRowValue}>{gridActivity.venueSpend}</Text>
                                  </View>
                                ) : null}
                                {gridActivity.venueSpend ? <Text selectable style={styles.confirmBodyText}>直接付给商家，不经过平台。</Text> : null}
                              </View>
                            ) : null}
                            <View style={styles.confirmNotice}>
                              <Text selectable style={styles.confirmNoticeTitle}>下单须知</Text>
                              <Text selectable style={styles.confirmNoticeItem}>报名成功即算加入名额，不代表已到场。</Text>
                              <Text selectable style={styles.confirmNoticeItem}>推荐的同行人是系统推荐，不代表对方已确认参加。</Text>
                            </View>
                          </ScrollView>
                          {joinMsg && joinConfirmOpen ? <Text selectable style={styles.confirmJoinError}>{joinMsg}</Text> : null}
                          <View style={[styles.confirmFooter, { paddingBottom: safeArea.bottom + 16 }]}>
                            <View style={styles.confirmFooterTotal}>
                              <Text selectable style={styles.confirmFooterTotalLabel}>合计</Text>
                              <Text selectable style={styles.confirmFooterTotalValue}>{gridActivity?.priceLabel || "免费参加"}</Text>
                            </View>
                            <Pressable
                              accessibilityLabel={t("joinCtaA11y")}
                              disabled={joinBusy}
                              onPress={() => { void joinSelected(gridActivity?.activityId, forYouRecipe).then((outcome) => { if (outcome !== "failed") { setOrderExisting(outcome === "already"); setOrderCodeCopied(false); setOrderDone(true); } }); }}
                              style={styles.confirmActionCta}
                            >
                              <Text selectable style={styles.confirmActionCtaText}>{joinBusy ? t("joinInProgress") : t("joinCta")}</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </Modal>
                  </View>
                ) : null}
                {joinMsg && !joinConfirmOpen ? <Text selectable style={styles.joinMsg}>{joinMsg}</Text> : null}
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
                            {sceneActivities.map((a, i) => {
                              const scene = sceneBriefs.find((s) => s.id === a.realitySceneId || s.name === a.venueName);
                              const photo = a.coverImageUrl || scene?.imageUrl;
                              const selected = i === activityIndex % sceneActivities.length;
                              return (
                                <Pressable key={a.activityId} onPress={() => { setActivityIndex(i); setChooser(null); }} style={[styles.photoChooserCard, selected && styles.photoChooserCardSelected]}>
                                  {photo ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: photo }} style={styles.photoChooserImage} transition={0} /> : <View style={[styles.photoChooserImage, styles.photoChooserFallback]}><ProxyIcon color={color.muted} name="cup" size={30} /></View>}
                                  <View style={styles.photoChooserCopy}>
                                    <Text selectable numberOfLines={1} style={styles.photoChooserName}>{a.venueName}</Text>
                                    <Text selectable numberOfLines={1} style={styles.photoChooserMeta}>{a.title}{a.time ? ` · ${a.time}` : ""}</Text>
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

      {/* AI-ROW-DUPE-001: 首页曾经同时渲染两条 AI 行 —— 上面一条 AI 助手
          横滑行 (AIAssistantsRow)、下面一条「AI 推荐」，都来自 /v1/ai/assistants。
          2026-09-27 产品决定（commander）：AI 推荐行**整条下架**，换成
          SCENE-HOME-HOT-RAIL-001 的热门场景横滑。AI-ROW-DUPE-001 仍守着
          「不许再挂回任何 AI 目录行」。 */}
      {/* SCENE-HOME-HOT-RAIL-001（原型 deepseek_html_20260927_d56fab）：
          封面 + 白字标题 + TOP N 角标 + 分类/区域 + 「N 人去过」。排序只按
          真实 visitedCount 降序；0 去过的照进（真实数字照写）但**不挂角标**
          —— 没有周榜聚合，「本周热榜 / 实时更新」不许写；评分和头像栈没有
          生产者，不画（SCENE-NO-FABRICATED-001）。「更多」进场景地图 ——
          那里有真实的全量目录，不是死按钮。 */}
      {hotScenes.length > 0 ? <View style={styles.hotSection}>
        {/* SCENE-HOME-HOT-RAIL-001：头部与真人推荐（peopleHead）同构 —— 标题
            直接复用 peopleTitle/peopleSub（同字号同左边距），头部容器不加
            自己的 paddingHorizontal（否则双重缩进没对齐）。「更多」= 灰字 +
            › 的可点链接（同 filterTrigger 的语言），不是黑药丸。 */}
        <View style={styles.hotSectionHead}>
          <View style={{ flex: 1 }}>
            <Text selectable style={styles.peopleTitle}>{t("hotScenes")}</Text>
            <Text selectable style={styles.peopleSub}>{t("hotScenesSub")}</Text>
          </View>
          <View style={styles.hotTag}><Text selectable style={styles.hotTagText}>{t("hotScenesTag")}</Text></View>
          <Pressable accessibilityLabel={t("hotScenesMore")} onPress={() => (onOpenHotScenes ?? onOpenSceneMap)?.()} style={styles.hotMore}>
            <Text selectable style={styles.hotMoreText}>{t("hotScenesMore")}</Text>
            <Text selectable style={styles.hotMoreChevron}>›</Text>
          </Pressable>
        </View>
        <HorizontalSwipeRail style={styles.hotRail} contentContainerStyle={styles.hotRailContent}>
          {hotScenes.map((scene, index) => (
            <Pressable key={scene.id} accessibilityLabel={scene.name} onPress={() => onOpenSceneMap?.(scene.id)} style={styles.hotCard}>
              <View style={styles.hotCover}>
                {(() => { const uri = hotSceneImageUrl(scene); return uri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`hot-scene:${scene.id}`} source={{ uri }} style={styles.hotCoverImage} transition={0} /> : <View style={[styles.hotCoverImage, styles.hotCoverFallback]}><Text selectable style={styles.hotCoverFallbackText}>{scene.type.slice(0, 2) || "场景"}</Text></View>; })()}
                <View style={styles.hotCoverShade} />
                {index < 3 && scene.visitedCount > 0 ? <View style={[styles.hotBadge, index === 0 && styles.hotBadgeFirst, index === 1 && styles.hotBadgeSecond]}>
                  <Text selectable style={[styles.hotBadgeText, (index === 0 || index === 1) && styles.hotBadgeTextOn]}>{`TOP ${index + 1}`}</Text>
                </View> : null}
                {/* SCENE-DISTANCE-BADGE-001（用户：「所有的场景必须标注距离数」）：
                    这个横滑之前完全没有距离——加真实定位 + haversine，没坐标/
                    没定位就不画，不冒充。 */}
                {(() => { const distance = shopCardDistance(sceneDistanceMeters(homeOrigin, scene)); return distance ? <View style={styles.hotDistanceBadge}><Text selectable style={styles.hotDistanceText}>{distance}</Text></View> : null; })()}
                <Text selectable style={styles.hotCoverTitle} numberOfLines={2}>{scene.name}</Text>
              </View>
              <View style={styles.hotBody}>
                <Text selectable style={styles.hotMeta} numberOfLines={1}>{[scene.category, scene.area].filter(Boolean).join(" · ") || scene.type}</Text>
                <View style={styles.hotFoot}>
                  <Text selectable style={styles.hotCount}>{t("hotScenesVisits", { count: scene.visitedCount })}</Text>
                  {(scene.ratingCount ?? 0) > 0 && typeof scene.rating === "number" ? (
                    <View style={styles.hotRatingRow}>
                      <Text selectable style={styles.hotRatingStar}>★</Text>
                      <Text selectable style={styles.hotRatingText}>{scene.rating.toFixed(1)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </HorizontalSwipeRail>
      </View> : null}

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
      />

      {humanScenePreview ? <Modal animationType="slide" onRequestClose={() => setHumanScenePreview(undefined)} visible>
        <View style={styles.humanScenePage}>
          <View style={[styles.humanSceneHeader, { height: 54 + safeArea.top, paddingTop: safeArea.top }]}><Pressable accessibilityLabel={t("backHome")} hitSlop={12} onPress={() => setHumanScenePreview(undefined)} style={styles.humanSceneBack}><ProxyBackGlyph label={t("backShort")} tone="ink" /></Pressable><Text selectable style={styles.humanSceneHeaderTitle}>{t("humanProfile")}</Text><View style={styles.humanSceneHeaderSpacer} /></View>
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
                <Pressable accessibilityLabel={relationshipLabel(humanScenePreview.person.id, humanScenePreview.person.name)} disabled={relationshipBusyFor(humanScenePreview.person.id) || relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" || relationshipStateFor(humanScenePreview.person.id) === "FRIEND"} onPress={() => void handleHomeFriend(humanScenePreview.person.id, humanScenePreview.person.name)} style={[styles.humanSceneTopAction, styles.humanSceneTopActionPrimary, (relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" || relationshipStateFor(humanScenePreview.person.id) === "FRIEND") && styles.humanSceneAddDone]}><Text selectable style={[styles.humanSceneTopActionPrimaryText, (relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" || relationshipStateFor(humanScenePreview.person.id) === "FRIEND") && styles.humanSceneAddDoneText]}>{relationshipBusyFor(humanScenePreview.person.id) ? t("adding") : relationshipStateFor(humanScenePreview.person.id) === "OUTGOING" ? t("addingShort") : relationshipStateFor(humanScenePreview.person.id) === "FRIEND" ? t("added") : relationshipStateFor(humanScenePreview.person.id) === "INCOMING" ? t("acceptAdd") : t("addAction")}</Text></Pressable>
                <Pressable accessibilityLabel={t("viewProfile")} onPress={() => { const person = humanScenePreview.person; setHumanScenePreview(undefined); onOpenHumanProfile?.(person); }} style={styles.humanSceneTopAction}><Text selectable style={styles.humanSceneTopActionText}>{t("home")}</Text></Pressable>
                <Pressable accessibilityLabel={t("messageAction")} onPress={() => { const person = humanScenePreview.person; setHumanScenePreview(undefined); onMessageHuman?.(person); }} style={styles.humanSceneTopAction}><Text selectable style={styles.humanSceneTopActionText}>{t("messageAction")}</Text></Pressable>
              </View>
              {relationshipMsg ? <Text selectable style={styles.humanSceneNotice}>{relationshipMsg}</Text> : null}
              <View style={styles.humanSceneFacts}>
                <View style={styles.humanSceneFact}><ProxyIcon color={color.muted} name="clock" size={18} /><Text selectable style={styles.humanSceneFactValue}>{humanScenePreview.person.availabilityText ?? t("availabilityUnknown")}</Text></View>
                <View style={styles.humanSceneFact}><ProxyIcon color={color.muted} name="route" size={18} /><Text selectable style={styles.humanSceneFactValue}>{humanScenePreview.person.distanceM === undefined ? t("distanceUnknown") : humanScenePreview.person.distanceM < 1000 ? `${humanScenePreview.person.distanceM} m` : `${(humanScenePreview.person.distanceM / 1000).toFixed(1)} km`}</Text></View>
                <Pressable accessibilityLabel={t("viewPublicHistory")} onPress={() => setPublicHistoryOpen((open) => !open)} style={styles.humanSceneFact}><ProxyIcon color={color.muted} name="check" size={18} /><Text selectable style={styles.humanSceneFactValue}>{humanScenePreview.person.completedActivities !== undefined ? t("historyCount", { n: humanScenePreview.person.completedActivities }) : t("noPublicPosts")}</Text></Pressable>
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
                <ProxyBackGlyph />
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
// 默认 10km 跟原型一致。
//
// 2026-09-30 用户要求把档位扩到 1000km（越南南北跨度就这个量级：河内 ↔ 胡志明
// 直线约 1100km，所以要真的能筛到"另一个城市的人"，必须有 1000 这一档）。
// 同时补上 200 / 500 —— 原来 [1,3,5,10,20,50,100] 在 50→100 之间是空的，
// 200/500 补上了中高距离段的空档。
//
// 档位是"半径"，语义仍然只有一条：距离未知（distanceM === undefined）的人
// **任何**半径都不算（PERSON-DISTANCE-ZERO-001）。放宽半径不等于把没有坐标的
// 人当成就在旁边。
// HANOI_FALLBACK_ORIGIN is where the nearby read is centred when the device has
// no location (a simulator with no simulated position, or a user who declined
// the permission). Hanoi is deliberate: the server-side dev coordinates are
// tiered around Hanoi (scripts/dev-distance-tiers.mjs), so the rail still shows
// properly ordered content instead of falling back to the fixture.
//
// It changes which point distances are measured FROM. It never invents anyone's
// position — every returned distanceM is still the server measuring that person.
const HANOI_FALLBACK_ORIGIN = { latitude: 21.0278, longitude: 105.8342 } as const;

const MORE_DISTANCE_KM: ReadonlyArray<number> = [1, 3, 5, 10, 20, 50, 100, 200, 500, 1000];

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
  hotSection: { marginTop: 8 },
  hotSectionHead: { alignItems: "flex-end", flexDirection: "row", gap: 8, marginBottom: 10, marginTop: 12 },
  hotTag: { backgroundColor: color.stateWarnBg, borderColor: color.stateWarnBorder, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  hotTagText: { color: color.factUnknownFg, fontSize: 11, fontWeight: "900" },
  hotMore: { alignItems: "center", flexDirection: "row", paddingHorizontal: 4, paddingVertical: 4 },
  hotMoreText: { color: color.muted, fontSize: 13, fontWeight: "600" },
  hotMoreChevron: { color: color.muted, fontSize: 16, fontWeight: "800", marginLeft: 2 },
  hotRail: { marginBottom: 10, marginHorizontal: -16 },
  hotRailContent: { gap: 12, paddingHorizontal: 16 },
  hotCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, overflow: "hidden", width: 156 },
  hotCover: { height: 104, justifyContent: "flex-end", position: "relative" },
  hotCoverImage: { height: "100%", position: "absolute", width: "100%" },
  hotCoverFallback: { alignItems: "center", backgroundColor: color.surface, justifyContent: "center" },
  hotCoverFallbackText: { color: color.muted, fontSize: 22, fontWeight: "900" },
  hotCoverShade: { backgroundColor: "rgba(23, 19, 31, 0.42)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  hotBadge: { alignItems: "center", backgroundColor: color.white, borderRadius: 6, left: 8, paddingHorizontal: 7, paddingVertical: 3, position: "absolute", top: 8 },
  hotBadgeFirst: { backgroundColor: color.magenta },
  hotBadgeSecond: { backgroundColor: color.factUnknownBg },
  hotBadgeText: { color: color.ink, fontSize: 11, fontWeight: "900", letterSpacing: 0.2 },
  hotBadgeTextOn: { color: color.white },
  hotDistanceBadge: { alignItems: "center", backgroundColor: "rgba(23,19,31,0.55)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, position: "absolute", right: 8, top: 8 },
  hotDistanceText: { color: color.white, fontSize: 11, fontWeight: "900", letterSpacing: 0.2 },
  hotCoverTitle: { bottom: 10, color: color.white, fontSize: 14.5, fontWeight: "900", left: 12, position: "absolute", right: 12, textShadowColor: "rgba(0, 0, 0, 0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  hotBody: { gap: 6, padding: 12, paddingTop: 10 },
  hotMeta: { color: color.muted, fontSize: 11, fontWeight: "700" },
  hotFoot: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingTop: 8 },
  hotCount: { color: color.muted, fontSize: 11, fontWeight: "800" },
  hotRatingRow: { alignItems: "center", flexDirection: "row", gap: 3 },
  hotRatingStar: { color: "#F5B400", fontSize: 11 },
  hotRatingText: { color: "#8C6A00", fontSize: 11, fontWeight: "900" },
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
  gridTile: { borderRadius: 18, height: 172, overflow: "hidden", position: "relative", width: "48.4%" },
  gridTileTap: { height: "100%", width: "100%" },
  gridTileLocked: { borderColor: "#F5B400", borderWidth: 2.5 },
  // FORYOU-LOCK-A-001（2026-09-28，原型 deepseek_html_20260928_c004b0 方案A「玻璃质感」）：
  // 28px 圆角 9，半透明黑底 + 白描边；锁定金底 + 白描边 + 金光晕。RN 侧无 blur
  // 依赖（真模糊要引 expo-blur，commander 定），玻璃感先靠底色 + 描边还原。
  // 锁形沿用 View 拼法，开环/闭环区分保留（见下面 shackle Off/On）。
  gridLock: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.42)", borderColor: "rgba(255,255,255,0.15)", borderRadius: 9, borderWidth: 1, height: 28, justifyContent: "center", position: "absolute", right: 10, top: 10, width: 28, zIndex: 3 },
  gridLockOn: { backgroundColor: "#F5B400", borderColor: "rgba(255,255,255,0.3)", elevation: 4, shadowColor: "#F5B400", shadowOffset: { height: 2, width: 0 }, shadowOpacity: 0.5, shadowRadius: 6 },
  // 开锁：锁环抬起 + 右移悬空，和锁体之间有明显缺口；关锁：锁环扣进锁体。
  // 锁形 = 原型方案A的空心线条锁（14px glyph）：U 形环 + 空心圆角矩形体，描边 1.5；
  // 开锁 = 环整体抬起 2.5 + 右移（右腿脱离锁体，左腿还连着）；闭锁 = 腿压进锁体 1。
  gridLockShackle: { borderColor: color.white, borderTopWidth: 1.5, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderTopLeftRadius: 3, borderTopRightRadius: 3, height: 6, marginBottom: -1, width: 7 },
  gridLockShackleOff: { marginBottom: 1.5, transform: [{ translateX: 1.5 }] },
  gridLockShackleOn: { borderColor: color.ink },
  gridLockBody: { backgroundColor: "transparent", borderColor: color.white, borderRadius: 2, borderWidth: 1.5, height: 7, width: 11 },
  gridLockBodyOn: { borderColor: color.ink },
  gridLockInfo: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 8, textAlign: "center" },
  gridImage: { borderRadius: 18, height: "100%", width: "100%" },
  gridImageMissing: { alignItems: "center", backgroundColor: color.offWhite, borderRadius: 18, height: "100%", justifyContent: "center", width: "100%" },
  gridGlyph: { color: color.muted, fontSize: 30 },
  gridOverlay: { bottom: 0, gap: 1, left: 0, padding: 10, position: "absolute", right: 0 },
  gridLabel: { color: color.white, fontSize: 13, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 5 },
  gridLabelDark: { color: color.ink, textShadowColor: "transparent" },
  gridSub: { color: "rgba(255,255,255,0.85)", fontSize: 11, textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 5 },
  gridSubDark: { color: color.muted, textShadowColor: "transparent" },
  gridCta: { alignItems: "center", backgroundColor: "#171715", borderRadius: 22, flexDirection: "row", gap: 6, justifyContent: "center", marginTop: 10, paddingVertical: 14 },
  // HOME-FORYOU-CONFLICT-001：锁定轴和活动冲突时，「选择」按钮变灰、点不动。
  gridCtaDisabled: { backgroundColor: color.line },
  // SEARCH-REPLY-BUDGET-001：有回复时收掉按钮上边距（配合隐藏的提示行一起
  // 抵消回复条的高度，见 :1244 那段）。marginTop: 0 而不是删掉 —— 显式写 0
  // 才不会继承 gridCta 的 10。
  gridCtaFlush: { marginTop: 0 },
  gridCtaText: { color: color.white, fontSize: 15, fontWeight: "800" },
  gridCtaTextSmall: { color: color.white, fontSize: 13, fontWeight: "800" },
  comboConflictText: { color: color.error, fontSize: 12, lineHeight: 17, marginTop: 8, textAlign: "center" },
  // 双链路提示：链路 A（直接约她走头像→Scene→主页）vs 链路 B（发布需求等人来）。
  chainHint: { color: color.muted, fontSize: 11, marginTop: 8, textAlign: "center" },
  joinMsg: { color: color.muted, fontSize: 11, marginTop: 6, textAlign: "center" },
  // 确认下单失败（满员/已下架/网络）贴在底栏上方，不再埋在可滚动内容最底下看不见。
  viewExistingOrderBtn: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6 },
  viewExistingOrderText: { color: color.ink, fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
  confirmJoinError: { color: color.error, fontSize: 13, fontWeight: "600", paddingHorizontal: 20, paddingVertical: 8, textAlign: "center" },
  // HOME-FORYOU-ORDER-001：确认下单整屏，跟 reality-scene-map.tsx 的
  // DIRECT-INVITE-CONFIRM-001 同一套版式/取值，方便两处视觉一致。
  confirmPage: { backgroundColor: color.white, flex: 1 },
  confirmTopBar: { alignItems: "center", flexDirection: "row", minHeight: 56, paddingHorizontal: 13 },
  confirmBackButton: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  // ORDER-007：成功页返回键 —— 38pt 点击区跟 confirmBackButton 同规格；绝对定位
  // 挂在 orderPage 上（zIndex 压过 hero），top 由内联 safeArea.top+6 给。
  orderBackButton: { alignItems: "center", height: 38, justifyContent: "center", left: 12, position: "absolute", width: 38, zIndex: 1 },
  confirmTitle: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "900", textAlign: "center" },
  confirmTopSpacer: { width: 38 },
  confirmScrollFlex: { flex: 1 },
  confirmScroll: { paddingBottom: 24, paddingHorizontal: 16 },
  confirmRecapRail: { gap: 8, paddingBottom: 4 },
  confirmRecapCard: { borderRadius: 14, height: 84, overflow: "hidden", position: "relative", width: 84 },
  confirmRecapImage: { height: "100%", width: "100%" },
  // PHOTO-SCRIM-001（2026-09-28，用户："为什么还是被标注层遮挡半页图片"）：
  // 这里原来是 `confirmRecapShade: { backgroundColor: "rgba(0,0,0,0.32)", height: "55%" }`
  // —— 一块**硬边平涂色带**，把 84×84 照片卡的下半页整块压暗，并在 45% 处留下
  // 一条横切边。原型 deepseek_html_20260927_226eac 的 `.recap-card::after` 是
  // `linear-gradient(180deg, transparent 45%, rgba(0,0,0,.7) 100%)`：整张卡覆盖、
  // 上 45% 全透明。改用全 App 唯一的 <PhotoScrim />（见 proxy-foundation.tsx）。
  // 文字可读性靠下面的 textShadow 兜底，不再靠底图大面积变黑（同 SCENE-CARD-SHADE-009）。
  confirmRecapName: { bottom: 6, color: color.white, fontSize: 11, fontWeight: "900", left: 7, position: "absolute", right: 7, textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 4 },
  confirmBlock: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 14 },
  confirmBlockTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  confirmBlockTitle: { color: color.ink, fontSize: 13, fontWeight: "900", marginBottom: 10 },
  confirmBlockTag: { color: color.muted, fontSize: 11, fontWeight: "800" },
  confirmBodyText: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  confirmPersonRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  confirmPersonAvatar: { borderRadius: 26, height: 52, width: 52 },
  confirmPersonInfo: { flex: 1, minWidth: 0 },
  confirmPersonName: { color: color.ink, fontSize: 14.5, fontWeight: "900" },
  confirmMenuLine: { color: color.muted, fontSize: 11.5, fontWeight: "700", lineHeight: 17, marginTop: 8 },
  confirmRecapLine: { color: color.ink, fontSize: 12.5, fontWeight: "800" },
  confirmGhostBtn: { alignItems: "center", backgroundColor: color.surface, borderRadius: 10, marginTop: 10, paddingVertical: 10 },
  confirmGhostBtnText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  confirmFeeBlock: { backgroundColor: "#FFF8E3", borderColor: "#E4C35B" },
  confirmFeeRow: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", marginTop: 6 },
  confirmFeeRowLabel: { color: color.ink, fontSize: 12.5, fontWeight: "700" },
  confirmFeeRowValue: { color: color.ink, flexShrink: 1, fontSize: 13, fontWeight: "900", textAlign: "right" },
  confirmFeeRowValueGood: { color: color.proxyGreen },
  confirmNotice: { backgroundColor: color.surface, borderRadius: 16, marginTop: 12, padding: 14 },
  confirmNoticeTitle: { color: color.muted, fontSize: 11, fontWeight: "900", letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" },
  confirmNoticeItem: { color: color.ink, fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  confirmFooter: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingTop: 12 },
  confirmFooterTotal: { flex: 1 },
  confirmFooterTotalLabel: { color: color.muted, fontSize: 11, fontWeight: "800" },
  confirmFooterTotalValue: { color: color.ink, fontSize: 20, fontWeight: "900", marginTop: 2 },
  confirmActionCta: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 14 },
  confirmActionCtaText: { color: color.white, fontSize: 14, fontWeight: "900" },
  // HOME-FORYOU-ORDER-003：「已下单」票券页。版式照原型
  // docs/design/references/Proxy_MyTickets_20260928_d7fef9.html（我的票券）。
  // ⚠️ orderPage 是这一屏的页面底色，撕票线的冲孔（orderTearHole）读的就是它
  // —— 两处必须同色，改一个就得改另一个，否则孔会变成两个白点。
  orderPage: { backgroundColor: color.offWhite, flex: 1 },
  orderHero: { alignItems: "center", backgroundColor: "#1A1814", borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: 20, paddingHorizontal: 20 },
  orderSuccessIcon: { alignItems: "center", backgroundColor: color.proxyGreen, borderRadius: 28, height: 56, justifyContent: "center", marginBottom: 14, width: 56 },
  orderTitle: { color: color.white, fontSize: 22, fontWeight: "900" },
  orderSub: { color: "rgba(255,255,255,0.6)", fontSize: 12.5, fontWeight: "700", marginTop: 8, textAlign: "center" },
  orderMetaRow: { flexDirection: "row", gap: 14, marginTop: 18, width: "100%" },
  orderMetaItem: { flex: 1 },
  orderMetaLabel: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  orderMetaValue: { color: color.white, fontSize: 13, fontWeight: "900", marginTop: 4 },
  orderMetaValueGood: { color: "#7DD99E" },
  // overflow:"hidden" 不是装饰 —— 撕票线那两个冲孔就是靠它把外半圆裁掉，
  // 只剩卡片边缘一道 12pt 的缺口（原型 left:-32px 被 .ticket 裁切后同形）。
  orderTicket: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginTop: -14, overflow: "hidden" },
  // 票券上半（编号 + 提示）单独包一层，因为撕票线必须**通到卡片边缘**才能冲孔，
  // 不能再待在 orderTicket 的内边距里。
  orderTicketBody: { paddingHorizontal: 16, paddingTop: 16 },
  orderCodeChip: { alignItems: "center", alignSelf: "center", backgroundColor: color.surface, borderRadius: 10, flexDirection: "row", gap: 7, paddingHorizontal: 13, paddingVertical: 9 },
  orderCodeText: { color: color.ink, fontSize: 13.5, fontWeight: "900", letterSpacing: 1 },
  orderCodeHint: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 7, textAlign: "center" },
  orderTear: { height: 26, position: "relative" },
  orderTearLine: { left: 22, position: "absolute", right: 22, top: 12 },
  orderTearHole: { backgroundColor: color.offWhite, borderRadius: 11, height: 22, position: "absolute", top: 2, width: 22 },
  orderTearHoleLeft: { left: -10 },
  orderTearHoleRight: { right: -10 },
  orderMetaBlock: { paddingBottom: 16, paddingHorizontal: 16, paddingTop: 6 },
  orderMetaRowLine: { flexDirection: "row", gap: 12, justifyContent: "space-between", paddingVertical: 10, position: "relative" },
  orderMetaRowRule: { bottom: 0, left: 0, position: "absolute", right: 0 },
  // 单边虚线画不出来（见 DashedRule 上面那段）：虚线是一排小方块。
  dashedRule: { flexDirection: "row", height: 1.5, justifyContent: "space-between", overflow: "hidden" },
  dashedRuleDash: { borderRadius: 1, height: 1.5, width: 5 },
  orderMetaRowLabel: { color: color.muted, fontSize: 11.5, fontWeight: "800", paddingTop: 2 },
  orderMetaRowValue: { color: color.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  orderPeopleLabel: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  orderPeopleTitle: { color: color.muted, fontSize: 11, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  orderPeopleCount: { color: color.muted, fontSize: 11, fontWeight: "800" },
  orderReminder: { alignItems: "flex-start", backgroundColor: color.warnBannerBg, borderColor: color.warnBannerBorder, borderRadius: 16, borderWidth: 1.5, flexDirection: "row", gap: 10, marginTop: 12, padding: 14 },
  orderReminderText: { color: color.warnBannerText, flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 19 },
  orderGhostBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, justifyContent: "center", paddingVertical: 14 },
  orderGhostBtnText: { color: color.ink, fontSize: 14, fontWeight: "900" },
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
  // HOME-HUMAN-PROFILE-LIGHT-001（用户："真人推荐-点击头像进入 真人主页 页面
  // 背景黑的 改下 正常白色的"）：这一屏原来是深色主题（导航/事实卡/详情卡都用
  // 半透明白覆在 #162030 深底上）。改成跟 App 其余页面一致的白底——半透明白
  // 覆盖层换成 color.surface/color.line，原来在深底上才看得清的白字/浅蓝字
  // 换成 color.ink/color.muted。真正需要留深色的只有两张贴真实照片的卡片
  // （humanSceneLinkCard「当前 Scene」/ humanSceneSceneCard「可以一起去的
  // 地方」——它们的深色遮罩是为了在照片上读文字，跟页面整体主题无关，不动）。
  humanScenePage: { backgroundColor: color.offWhite, flex: 1 },
  humanSceneHeader: { alignItems: "center", backgroundColor: color.offWhite, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", height: 54, paddingHorizontal: 16 },
  humanSceneBack: { flex: 1 },
  humanSceneHeaderTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  humanSceneHeaderSpacer: { flex: 1 },
  humanSceneContent: { padding: 18, paddingBottom: 40 },
  humanSceneTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  humanSceneEyebrow: { color: color.muted, fontSize: 12, fontWeight: "700" },
  humanScenePerson: { alignItems: "center", flexDirection: "row", gap: 14, marginTop: 10 },
  humanSceneAvatarRing: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderColor: "rgba(91,143,213,0.6)", borderRadius: 999, borderWidth: 2, height: 96, justifyContent: "center", padding: 3, width: 96 },
  humanSceneAvatar: { borderRadius: 999, height: "100%", width: "100%" },
  humanSceneInitials: { color: color.violet, fontSize: 24, fontWeight: "900" },
  humanScenePersonCopy: { flex: 1, minWidth: 0 },
  humanSceneName: { color: color.ink, fontSize: 28, fontWeight: "900" },
  humanSceneBio: { color: color.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  humanSceneRating: { color: "#8C6A00", fontSize: 12, fontWeight: "800", marginTop: 6 },
  humanSceneActionsTop: { flexDirection: "row", gap: 8, marginTop: 16 },
  humanSceneTopAction: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 46 },
  humanSceneTopActionPrimary: { backgroundColor: "#586CFF", borderColor: "#586CFF" },
  humanSceneTopActionText: { color: color.ink, fontSize: 13, fontWeight: "900" },
  humanSceneTopActionPrimaryText: { color: color.white, fontSize: 13, fontWeight: "900" },
  humanSceneFacts: { flexDirection: "row", gap: 7, marginTop: 14 },
  humanSceneFact: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, justifyContent: "center", minHeight: 62, paddingHorizontal: 6 },
  humanSceneFactValue: { color: color.ink, fontSize: 11, fontWeight: "700", textAlign: "center" },
  humanSceneHistory: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 9, padding: 12 },
  humanSceneHistoryHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  humanSceneHistoryTitle: { color: color.ink, fontSize: 13, fontWeight: "900" },
  humanSceneHistoryPrivacy: { color: color.muted, fontSize: 11 },
  humanSceneHistoryRow: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", paddingVertical: 10 },
  humanSceneHistoryCopy: { flex: 1 },
  humanSceneHistoryName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  humanSceneHistoryMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  humanSceneHistoryRating: { color: "#8C6A00", fontSize: 12, fontWeight: "900" },
  humanSceneHistoryEmpty: { color: color.muted, fontSize: 12, paddingVertical: 12 },
  humanScenePills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 9 },
  humanScenePill: { backgroundColor: color.proxyPurpleSoft, borderColor: color.violet, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  humanScenePillText: { color: color.violet, fontSize: 12, fontWeight: "800" },
  humanSceneSectionTitle: { color: color.ink, fontSize: 14, fontWeight: "900", marginTop: 18 },
  humanSceneLinkRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  humanSceneLinkChip: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 72, padding: 10 },
  // 贴真实场景照片的卡片——深色遮罩是给盖在照片上的文字读性用的，跟页面
  // 整体是白底还是黑底无关，不跟着这次改色。
  humanSceneLinkCard: { borderColor: "rgba(255,255,255,0.2)", borderRadius: 14, borderWidth: 1, flex: 1.2, minHeight: 72, overflow: "hidden", padding: 10 },
  humanSceneLinkShade: { backgroundColor: "rgba(8,13,24,0.48)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  humanSceneLinkLabel: { color: color.muted, fontSize: 11 },
  humanSceneLinkValue: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 },
  humanSceneLinkLabelLight: { color: "#E0E8F4", fontSize: 11 },
  humanSceneLinkValueLight: { color: color.white, fontSize: 12, fontWeight: "900", marginTop: 8 },
  humanSceneSceneHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 13 },
  humanSceneSceneHint: { color: color.muted, fontSize: 11 },
  humanSceneSceneRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  // 同 humanSceneLinkCard：贴真实场景照片，遮罩不跟着改色。
  humanSceneSceneCard: { borderColor: "rgba(255,255,255,0.2)", borderRadius: 15, borderWidth: 1, flex: 1, height: 92, justifyContent: "flex-end", overflow: "hidden", padding: 10 },
  humanSceneSceneShade: { backgroundColor: "rgba(8,13,24,0.35)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  humanSceneSceneName: { color: color.white, fontSize: 13, fontWeight: "900" },
  humanSceneSceneMeta: { color: "#E0E8F4", fontSize: 11, marginTop: 2 },
  humanSceneDetailCard: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 13 },
  humanSceneDetailTitle: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 4 },
  humanSceneDetailText: { color: color.ink, fontSize: 13, lineHeight: 19, marginBottom: 7, marginTop: 4 },
  humanSceneTrust: { color: "#8C6A00", fontSize: 13, fontWeight: "900", marginTop: 7 },
  humanSceneReason: { backgroundColor: color.surface, borderRadius: 14, color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 12, padding: 11 },
  humanSceneNotice: { color: color.muted, fontSize: 11, marginTop: 8 },
  humanSceneAddDone: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 1 },
  humanSceneAddDoneText: { color: color.ink },
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
  followMsg: { color: color.muted, fontSize: 11, marginTop: 6, textAlign: "center" },
  serverPeopleTitle: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 10 },
  serverPeopleRow: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 8 },
  serverPeopleCopy: { flex: 1, minWidth: 0 },
  serverPeopleName: { color: color.ink, fontSize: 13, fontWeight: "700" },
  serverPeopleSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  serverPeopleAction: { color: color.violet, fontSize: 12, fontWeight: "800" },
  // 为你组合 For You 独立主题头：4 宫格不再裸奔。
  forYouHead: { marginTop: 18, marginBottom: 4 },
  forYouBadge: { backgroundColor: color.ink, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 },
  forYouBadgeText: { color: color.white, fontSize: 11, fontWeight: "900", letterSpacing: 0.2 },
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

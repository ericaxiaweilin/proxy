import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Circle, Marker } from "react-native-maps";
import * as Location from "expo-location";
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { commandErrorMessage } from "../command-error-message";
import { sceneAddressLine, sceneCountsLine, sceneHeatScore, sceneSignalLine, sceneSourceSuffix } from "../reality-scene-address";
import { captureRef } from "react-native-view-shot";
import { checkinEligibility, checkinHint } from "../scene-checkin";
import { SCENE_BADGES, SCENE_BADGE_REQUIREMENTS, sceneBadgeById, badgeProgress, badgeMissingIds } from "../scene-badges";
// SCENE-NAV-001: 主页里的导航出口走 MEETUP-NAV-001 同一套系统地图深链，
// 不手拼 URL、不自写导航引擎 —— 坐标校验与双端 scheme 都在那一边钉着。
import { meetupDirectionsUrls } from "../meetup-share";
// SCENE-EVENT-SIGNUP-001: 场景上的活动列表 + 报名。复用现成的 ActivityClient，
// 不新造一套报名机制 —— 活动域（名额 / participants / 事务）本来就是真的。
import { ActivityClient } from "../activity-client";
import {
  activitiesAtScene, activitySignupLabel, canSignUp, isSceneActivity, sceneActivityFeed, sceneActivityFeedText,
  type SceneActivity, type SceneActivityFeedState
} from "../scene-activities";
import { ProxyIcon } from "../components/proxy-icon";
import { useModuleBackHandler } from "../components/module-back";
// SCENE-HUMANS-001: 一起玩的人只露圆头像 + 名字 + 可约状态 —— 和首页同款圆头像
//（CircularAvatarImage，真圆裁剪），role / fit% / fitReason 不在这一屏重复：
// 详情都在个人主页，邀约时要看再点过去。
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { color } from "../theme";
import type { SessionAuthClient } from "../auth-client";
import type { SecureSessionStore, StoredSession } from "../secure-session";
import { parseCommandResult } from "../login-client";
import { localApiBaseUrl } from "../native-clients";

// GEO-HONEST-001: 取不到位置时地图的兜底中心。
//
// 它是**视口默认值** —— 不是"用户位置"，也不是任何场景的坐标。原先写成内联
// 字面量 `21.036, 105.842`，在代码里读起来和真实坐标没有区别，容易被下一个人
// 当成实测数据。提成具名常量，把语义写进名字。
const HANOI_CENTER_FALLBACK = { latitude: 21.036, longitude: 105.842 } as const;

// IDENTITY-ID-001: 真人头像与账号同源。服务端可能返回以 "/" 开头的媒体路径（账号头像
// 资产，见 internal/mockidentity），这里统一拼 API base；空串表示该人暂无头像，卡片
// 回落首字母（不再对外链/空串渲染破图）。
function humanAvatarUri(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === "") return undefined;
  return trimmed.startsWith("/") ? `${localApiBaseUrl}${trimmed}` : trimmed;
}
import type { PlatformAIAccount } from "../ai-account-client";
import { aiAccountPhoto } from "../ai-persona-presentation";

type SceneFilter = "ALL" | "UNSEEN" | "ACTIVE" | "SAVED" | "VISITED";
type SceneView = "MAP" | "LIST";
// SCENE-CATEGORY-001: 场景顶类，封闭三态。前端只认这三个 —— picker 三选一，
// 标记颜色和徽标都按它 key；后端细分（咖啡店/湖/海滩…）继续走 type。
type SceneCategory = "商家" | "景点" | "其他";
type AuthenticatedStoredSession = StoredSession & { principal: NonNullable<StoredSession["principal"]> };

type RealityScene = {
  id: string;
  name: string;
  area: string;
  type: string;
  // SCENE-CATEGORY-001: 顶类（封闭三态，服务端 098 迁移回填 + 校验）。
  // 缺失或不在三态里 = 脏数据，按现有规矩整单报错，不猜。
  category: SceneCategory;
  // SCENE-ADDRESS-001: 门牌/街道级地址。可选 —— 老数据没有这个字段，
  // 没有就是没有，不许拿 area（区名）冒充。渲染时走 sceneAddress() 回退。
  address?: string;
  latitude: number;
  longitude: number;
  // best 是**开放/最佳到访时间**（"全天开放" / "08:00–17:00 · 售票" /
  // "以现场公告为准"）。查不到就写"以现场公告为准"，不编一个时间段。
  best: string;
  active: boolean;
  description: string;
  // SCENE-NO-FABRICATED-001: 这里曾经还有 quality / posts / creators /
  // activities / invites 五个数字，全是迁移里手写死的常数，没有任何来源。
  // 已删除 —— 服务端不再下发，客户端也不许再有。
  //
  // SCENE-REAL-COUNTS-001: 真实派生的计数（服务端按 user_scene_states 聚合）。
  savedCount?: number;
  visitedCount?: number;
  plannedCount?: number;
  // SCENE-CHECKIN-001: 当前"在这里"的人数。会自己过期，不是写死的热度。
  hereCount?: number;
  // SCENE-CONTRIB-001: 数据来源。"OSM" = 坐标查过；"COMMUNITY" = 用户提交，
  // 坐标没查过。缺失 = 来源不明，一律按"未核实"显示。
  source?: string;
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
  // MERCHANT-LOGO-001: 商家 logo，可选 —— 服务端 omitempty，没有就是没有，
  // 详情页回字母块（和线上店铺管理面同款），不编占位图。
  logoUrl?: string;
  selectedVariant: string;
  variants: Array<{ id: string; name: string; window: string; facets: string[]; bestFor: string }>;
  // GEO-HONEST-001: capacityPct / freshUntil 是可空的。服务端在没有真实来源时
  // 会**省略**它们，而不是填一个看着像真的数字。所以这两个字段必须在类型上
  // 就是 optional —— 否则 undefined 会一路渲染成「容量 undefined%」。
  liveState: { state: string; label: string; bestWindow: string; capacityPct?: number | undefined; freshUntil?: string | undefined };
  menu: Array<{ id: string; name: string; priceLabel: string; sceneFit: string; available: boolean; imageUrl: string }>;
  fullMenu: Array<{ id: string; name: string; priceLabel: string; sceneFit: string; available: boolean; imageUrl: string }>;
  // sceneFit / source 同理由 optional：没有评分来源时省略，UI 不编一个百分比。
  humans: Array<{ id: string; name: string; role: string; availability: string; fitReason: string; sceneFit?: number | undefined; isAI: boolean; source?: string | undefined; avatarUrl: string }>;
  actions: DynamicSceneAction[];
  truthBoundary: string;
  // SCENE-BADGE-001：绑定本场景的小美（真实映射，不编计数）。
  aiVisits?: Array<{ personaId: string; displayName: string; boundSceneId: string }>;
};

type FeaturedHuman = { userId: string; name: string; city?: string | undefined; avatarUri?: string | undefined };

export function RealitySceneMapSurface({ apiBaseUrl, authClient, featuredAIAccount, featuredHuman, initialSceneId, initialOrigin, secureSessionStore, onBack, onOpenAIProfile, onOpenHumanProfile }: { apiBaseUrl: string; authClient: SessionAuthClient; featuredAIAccount?: PlatformAIAccount | undefined; featuredHuman?: FeaturedHuman | undefined; initialSceneId?: string | undefined; initialOrigin?: { latitude: number; longitude: number } | undefined; secureSessionStore?: SecureSessionStore | undefined; onBack: () => void; onOpenAIProfile?: (account: PlatformAIAccount) => void; onOpenHumanProfile?: (person: FeaturedHuman) => void }): React.JSX.Element {
  const [view, setView] = useState<SceneView>("MAP");
  const [filter, setFilter] = useState<SceneFilter>("ALL");
  // 供热：图钉换成真实聚合圈（sceneHeatScore），0 分不渲染。
  // Circle 本体不可点（该版本 react-native-maps 无 onPress），详情走列表行。
  const [heat, setHeat] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSceneId);
  // SCENE-NAV-PIN-001: 图钉快打卡 —— 点图钉不再直通详情（导航埋在详情第三颗
  // 按钮里太深，用户找不到），而是先弹快打卡：导航去这里 / 看详情二选一。
  // 看详情才进 selectedId 老链（自动足迹/打卡门禁照旧）；导航直接走
  // openSceneNavigation 同一条系统地图深链。热力圈不可点，不受影响。
  const [pinSheetId, setPinSheetId] = useState<string>();
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [visitedAt, setVisitedAt] = useState<ReadonlyMap<string, string>>(new Map());
  const [planned, setPlanned] = useState<ReadonlySet<string>>(new Set());
  // SCENE-CHECKIN-001: 本人当前有效的「我在这里」。从服务端拉回来，不能只存在
  // 本地内存 —— 否则重开 app 按钮就显示成"没在这里"，而服务端其实还记着。
  const [here, setHere] = useState<ReadonlySet<string>>(new Set());
  // BADGE-WALL-001: 本人去过的所有场景（all-time）。undefined = 还没拉到，
  // 进度块直接不画 —— 空数组是“一家没去过”，undefined 是“不知道”，两回事。
  const [badgeHistoryIds, setBadgeHistoryIds] = useState<ReadonlyArray<string> | undefined>(undefined);
  // SCENE-EVENT-SIGNUP-001: 这个场景上已发布的活动。列表状态单独存 —— "没有
  // 活动" / "取不到" / "没登录" 是三件不同的事，不能都显示成一句"暂无"。
  const [sceneActivities, setSceneActivities] = useState<ReadonlyArray<SceneActivity>>([]);
  const [sceneActivitiesState, setSceneActivitiesState] = useState<SceneActivityFeedState>("LOADING");
  const [activityBusyId, setActivityBusyId] = useState<string>();
  const [activityMsg, setActivityMsg] = useState<string>();
  // 收藏/去过/去这里三态的操作反馈：未登录提示、同步失败回滚+提示。
  const [triStateMsg, setTriStateMsg] = useState<string | undefined>(undefined);
  // SCENE-BADGE-001：打卡获得的徽章提示（自动消失）。
  const [badgeNotice, setBadgeNotice] = useState<string | undefined>(undefined);
  // SCENE-BADGE-001：徽章墙（ListMyBadges → 已获得/未获得）。
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<ReadonlySet<string>>(new Set());
  const [badgesError, setBadgesError] = useState<string | undefined>(undefined);
  const openBadges = (): void => {
    if (!session?.principal) {
      setBadgesError("请先登录，徽章才会同步。");
      setBadgesOpen(true);
      return;
    }
    setBadgesError(undefined);
    void sendSceneCommand(authClient, session, "ListMyBadges", "me", {})
      .then((result) => {
        const list = Array.isArray(result.badges) ? (result.badges as Array<{ badgeId?: string }>) : [];
        setEarnedBadges(new Set(list.map((b) => b.badgeId ?? "")));
        setBadgesOpen(true);
      })
      .catch(() => setBadgesError("徽章加载失败，请重试。"));
  };
  // SCENE-BADGE-001：小美绑定场景（与她同框）—— 打卡这类场景有专属徽章。
  const isXiaomeiScene = (id: string): boolean => (SCENE_BADGE_REQUIREMENTS.xiaomei_company ?? []).includes(id);
  // SCENE-BADGE-002：分享徽章卡 —— 把已获得的徽章截成图，走系统分享。
  const badgeShareRef = useRef<View>(null);
  const [badgeShareNotice, setBadgeShareNotice] = useState<string | undefined>(undefined);
  async function shareBadgeCard(): Promise<void> {
    try {
      const uri = await captureRef(badgeShareRef, { format: "png", quality: 0.9 });
      const earnedNames = SCENE_BADGES.filter((b) => earnedBadges.has(b.id)).map((b) => b.name);
      await Share.share({
        url: uri,
        message: `我在 Proxy 集齐了 ${earnedNames.length} 枚打卡徽章${earnedNames.length > 0 ? `：${earnedNames.join("、")}` : ""}。来一起打卡吧！`,
      });
      setBadgeShareNotice(undefined);
    } catch {
      setBadgeShareNotice("分享失败，请重试。");
    }
  }
  const [scenes, setScenes] = useState<ReadonlyArray<RealityScene>>([]);
  const [session, setSession] = useState<AuthenticatedStoredSession>();
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | undefined>(initialOrigin);
  // SCENE-CHECKIN-FRESH-001: 定位有保质期。origin 以前一旦落定就冻住 —— 离店
  // 不更新，90 分钟打卡过期后重进详情，又按旧坐标自动打一次（在家给店打卡）。
  // 每次落定位都打时间戳；超过 10 分钟算过期，打卡门禁不再认它。
  const [originAt, setOriginAt] = useState<number | undefined>(() => (initialOrigin ? Date.now() : undefined));
  const [locating, setLocating] = useState(false);
  // SCENE-MAP-LOCATION-001: 壳透传进来的起点（设备实时位置优先）。面每次挂载
  // state 都重置，只在 origin 还没值时接 —— 用户亲手点的定位和地图内状态不抢。
  // 之前这里永远从 undefined 开始，关掉再进就回到河内默认（21.036, 105.842）。
  useEffect(() => {
    if (!initialOrigin) return;
    setOrigin((prev) => prev ?? initialOrigin);
    setOriginAt((prev) => prev ?? Date.now());
  }, [initialOrigin]);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearbyError, setNearbyError] = useState<string>();
  const [detail, setDetail] = useState<SceneDetail>();
  const [detailError, setDetailError] = useState<string>();
  // SCENE-NAV-001: 导航失败的行内错（坐标无效 / 调不起地图应用），两种说法分开。
  const [navError, setNavError] = useState<string>();
  const [actionExplanation, setActionExplanation] = useState<string>();
  const [selectedAction, setSelectedAction] = useState<DynamicSceneAction>();
  const [selectedHumanId, setSelectedHumanId] = useState<string>();
  const [selectedMenuId, setSelectedMenuId] = useState<string>();
  const [fullMenuOpen, setFullMenuOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string>();
  const [inviteAmountText, setInviteAmountText] = useState("150,000");
  // SCENE-STUDIO-001: 场景 Studio 出图 —— 选中的时段场景 × 点中的菜单 ×
  // 绑定本场景的小美，三元素原样拼一张卡，截屏走系统分享（徽章卡同一条
  // captureRef 链）。选什么出什么：菜单没选 / 本场景没绑定小美，按钮直接
  // disabled 并明说缺什么，绝不拿默认替身凑数。
  const studioShareRef = useRef<View>(null);
  const [studioShareNotice, setStudioShareNotice] = useState<string | undefined>(undefined);
  const studioXiaomei = featuredAIAccount?.boundSceneId === detail?.sceneId ? featuredAIAccount : undefined;
  const studioMenu = detail?.menu.find((item) => item.id === selectedMenuId) ?? detail?.fullMenu.find((item) => item.id === selectedMenuId);
  const studioReady = studioMenu !== undefined && studioXiaomei !== undefined;
  async function shareStudioCard(): Promise<void> {
    if (!studioReady || !detail || !studioMenu || !studioXiaomei) return;
    try {
      const uri = await captureRef(studioShareRef, { format: "png", quality: 0.9 });
      await Share.share({
        url: uri,
        message: `${detail.venueName} · ${studioMenu.name} × ${studioXiaomei.displayName} —— 在 Proxy 约一场现实见面吧！`,
      });
      setStudioShareNotice(undefined);
    } catch {
      setStudioShareNotice("分享失败，请重试。");
    }
  }

  // 本页挂在 app-shell 的 SafeAreaView（edges top）里面，状态栏已经让出，
  // 这里再加 insets.top 就是双计（59+49 的大空白）。只留内容间距 8。
  const insets = useSafeAreaInsets();
  const rootPad = { paddingTop: 0, paddingBottom: Math.max(insets.bottom, 0) };
  // §4/§13：系统返回逐层收起——详情→列表→关闭（与屏上 ‹ 同序，后注册先消费，详情优先）。
  useModuleBackHandler(() => { onBack(); return true; });
  useModuleBackHandler(selectedId && selectedId !== initialSceneId ? () => { setSelectedId(undefined); return true; } : undefined);
  // SCENE-NAV-PIN-001: 系统返回先收快打卡（后注册先消费，详情之前）。
  useModuleBackHandler(pinSheetId ? () => { setPinSheetId(undefined); return true; } : undefined);

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
      const checkIns = Array.isArray(payload.checkIns) ? payload.checkIns : [];
      setHere(new Set(checkIns.filter((item): item is string => typeof item === "string")));
      // BADGE-WALL-001: 打卡史（all-time，不过期过滤）给徽章进度用。失败就
      // 保持 undefined，进度块直接不画 —— 拿空集去算会把“没拉到”画成“一家没去”。
      try {
        const historyPayload = await sendSceneCommand(authClient, authenticated, "ListMyCheckinHistory", "me", {});
        const ids = Array.isArray(historyPayload.sceneIds) ? historyPayload.sceneIds : undefined;
        if (!cancelled) setBadgeHistoryIds(ids?.filter((id): id is string => typeof id === "string"));
      } catch {
        if (!cancelled) setBadgeHistoryIds(undefined);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [authClient, secureSessionStore]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setDetail(undefined); setDetailError(undefined); return; }
    setDetail(undefined); setDetailError(undefined); setNavError(undefined); setActionExplanation(undefined); setSelectedAction(undefined); setActionResult(undefined); setFullMenuOpen(false); setWhyOpen(false);
    const variant = featuredAIAccount?.boundSceneId === selectedId ? featuredAIAccount.boundSceneVariant : undefined;
    const suffix = variant ? `?variant=${encodeURIComponent(variant)}` : "";
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/scenes/${encodeURIComponent(selectedId)}${suffix}`, { headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error(`status ${response.status}`); return response.json(); })
      .then((value: unknown) => { if (!isSceneDetail(value)) throw new Error("malformed"); if (!cancelled) { setDetail(value); setSelectedHumanId(value.humans[0]?.id); setSelectedMenuId(value.menu[0]?.id); } })
      .catch(() => { if (!cancelled) setDetailError("动态场景暂时不可用，请稍后重试"); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, featuredAIAccount, selectedId]);

  // SCENE-EVENT-SIGNUP-001: 换场景就重拉该场景的活动。
  useEffect(() => {
    if (!selectedId) { setSceneActivities([]); setSceneActivitiesState("LOADING"); return; }
    loadSceneActivities(selectedId);
  }, [authClient, secureSessionStore, selectedId]);
  const activityFeed = sceneActivityFeed([...sceneActivities], sceneActivitiesState);

  const selectVariant = (variantId: string): void => {
    if (!selectedId) return;
    setDetailError(undefined); setActionExplanation(undefined);
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/scenes/${encodeURIComponent(selectedId)}?variant=${encodeURIComponent(variantId)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error(`status ${response.status}`); return response.json(); })
      .then((value: unknown) => { if (!isSceneDetail(value)) throw new Error("malformed"); setDetail(value); setSelectedHumanId(value.humans[0]?.id); setSelectedMenuId(value.menu[0]?.id); setFullMenuOpen(false); setWhyOpen(false); })
      .catch(() => setDetailError("场景切换失败，请重试"));
  };

  // 现实行动失败说人话：sendSceneCommand 抛的是服务端 messageKey
  //（scene.not_allowed 这类），直接展示用户看不懂。按码分流；自有中文
  // 报错原样透出。DIRECT_INVITE 是两步（先建场景再发邀请），第二步挂了
  // 场景已落库（无删场景命令），必须告诉用户场景已创建、只是邀请没发出去。
  function sceneActionErrorMessage(error: unknown): string {
    const msg = error instanceof Error ? error.message : "操作失败，请重试";
    if (/scene\.not_found|SCENE_NOT_FOUND/.test(msg)) return "该场景不存在或已下架";
    if (/scene\.not_allowed|INVITATION_NOT_ALLOWED|not allowed/i.test(msg)) return "只有场景房主可以发邀请";
    if (/invalid_invite|INVALID_INVITATION/.test(msg)) return "邀请信息不完整，请重试";
    if (/fetch failed|load failed|network|NETWORK|status \d+/.test(msg)) return "网络异常，请检查连接后重试";
    if (/command failed|malformed/.test(msg)) return "服务暂时不可用，请稍后重试";
    if (/^[a-z0-9_.:-]+$/i.test(msg) && /[._]/.test(msg)) return "操作失败，请稍后重试";
    return msg;
  }

  const commitSceneAction = async (): Promise<void> => {
    if (!detail || !selected || !selectedAction || actionBusy) return;
    if (!secureSessionStore || !session) { setActionResult("请先登录，再确认现实行动"); return; }
    setActionBusy(true); setActionResult(undefined);
    let createdSceneId: string | undefined;
    try {
      const variant = detail.variants.find((item) => item.id === detail.selectedVariant) ?? detail.variants[0]!;
      const selectedMenuItem = detail.menu.find((item) => item.id === selectedMenuId);
      if (selectedAction.type === "DIRECT_INVITE") {
        const human = detail.humans.find((item) => item.id === selectedHumanId);
        if (!human) throw new Error("请先选择要邀请的真人");
        const inviteAmount = Number(inviteAmountText.replace(/[^\d]/g, ""));
        if (!Number.isInteger(inviteAmount) || inviteAmount < 100 || inviteAmount > 10_000_000) throw new Error("请输入 100–10,000,000 VND 的有效报酬");
        const inviteAmountLabel = `${inviteAmount.toLocaleString("en-US")}₫`;
        const menuItem = detail.menu.find((item) => item.id === selectedMenuId);
        const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const created = await sendSceneCommand(authClient, session, "CreateScene", "new", { tool: "DIRECT_INVITE", intent: `${variant.name} · ${variant.bestFor}`, anchor: { venueId: detail.sceneId, venueName: detail.venueName }, participation: "双人见面 · 需双方确认", cost: "HOST_PAY", fundingMode: "HOST", budgetMinor: inviteAmount, currency: "VND", venueId: detail.sceneId, startsAt });
        const sceneId = typeof created.aggregateId === "string" ? created.aggregateId : undefined;
        if (!sceneId) throw new Error("场景创建失败");
        createdSceneId = sceneId;
        await sendSceneCommand(authClient, session, "CreateInvitation", sceneId, { sceneId, inviteeUserId: human.id, card: { what: variant.bestFor, where: detail.venueName, when: `${variant.window}（双方可在聊天中修改）`, who: human.name, hostLabel: "你", compensation: inviteAmountLabel, menuItemId: menuItem?.id, menuItemName: menuItem?.name } });
        setActionResult(`邀请已发送给 ${human.name}${menuItem ? ` · ${menuItem.name}` : ""} · 报酬 ${inviteAmountLabel} · 对方接受后生成订单`);
      } else if (selectedAction.type === "OPEN_TASK") {
        const result = await sendSceneCommand(authClient, session, "PublishMarketOpportunity", "new", { title: `${variant.name} · ${variant.bestFor}`, shortTitle: variant.name, theme: variant.facets.join(" / "), date: "近期", time: variant.window, location: detail.venueName, price: "", moneyFlow: "TBD", skills: "Scene fit / UGC", lens: ["NOW", "NEARBY"], menuItemId: selectedMenuItem?.id, menuItemName: selectedMenuItem?.name });
        setActionResult(`机会 ${String(result.aggregateId ?? "")} 已发布 · 报酬由双方面谈确定 · 等待真人候选报名`);
      } else {
        const result = await sendSceneCommand(authClient, session, "PublishActivity", "new", { title: `${variant.name} · ${variant.bestFor}`, time: variant.window, capacity: 8, venueName: detail.venueName, venueIcon: "coffee", venueType: "CAFE", realitySceneId: detail.sceneId, desc: `${variant.facets.join(" · ")}。报名不等于到场。`, consumptionTerm: "SPLIT", menuItemId: selectedMenuItem?.id, menuItemName: selectedMenuItem?.name });
        setActionResult(`活动 ${String(result.aggregateId ?? "")} 已发布 · 免费报名、到店消费各自承担 · 已进入“我的活动”`);
      }
    } catch (error) {
      const reason = sceneActionErrorMessage(error);
      if (createdSceneId) setActionResult(`场景已创建但邀请未发出：${reason}。场景还在，可稍后重邀。`);
      else setActionResult(reason);
    }
    finally { setActionBusy(false); }
  };

  const selected = scenes.find((scene) => scene.id === selectedId);
  // BADGE-WALL-001: 本店徽章进度 —— 这家能点亮哪些徽章、还差几家（打卡史实时
  // 算）。history 没拉到时返回 undefined，调用方直接不画 —— 拿空集去算会把
  // “没拉到”画成“一家没去”，比不画坏得多。
  const sceneBadgeRows = useMemo(() => {
    if (!selected || badgeHistoryIds === undefined) return undefined;
    const knownIds = new Set(scenes.map((s) => s.id));
    const nameOf = (id: string): string | undefined => {
      const found = scenes.find((s) => s.id === id)?.name;
      return typeof found === "string" && found.length > 0 ? found : undefined;
    };
    return SCENE_BADGES
      .filter((b) => (SCENE_BADGE_REQUIREMENTS[b.id] ?? []).includes(selected.id))
      .map((b) => {
        const progress = badgeProgress(b.id, badgeHistoryIds);
        const missingNames = badgeMissingIds(b.id, badgeHistoryIds, knownIds)
          .map((id) => nameOf(id))
          .filter((n): n is string => n !== undefined);
        return { badge: b, progress, missingNames, visited: badgeHistoryIds.includes(selected.id) };
      });
  }, [selected, badgeHistoryIds, scenes]);
  const filtered = useMemo(() => {
    const matching = scenes.filter((scene) => {
    const term = query.trim().toLocaleLowerCase();
    if (term && !`${scene.name} ${scene.area} ${scene.type} ${scene.category}`.toLocaleLowerCase().includes(term)) return false;
    if (filter === "ACTIVE") return scene.active;
    if (filter === "SAVED") return saved.has(scene.id);
    if (filter === "VISITED") return visited.has(scene.id);
    if (filter === "UNSEEN") return !visited.has(scene.id);
    return true;
    });
    if (filter === "VISITED") matching.sort((a, b) => Date.parse(visitedAt.get(b.id) ?? "") - Date.parse(visitedAt.get(a.id) ?? ""));
    return matching;
  }, [filter, query, saved, scenes, visited, visitedAt]);
  // SCENE-NAV-PIN-001: 快打卡认的人和图钉同一份（filtered 当前视野）——
  // 筛选/搜索把这家筛没了，卡自动收，不留灵异卡片。
  const pinScene = pinSheetId ? filtered.find((scene) => scene.id === pinSheetId) : undefined;

  const toggle = (source: ReadonlySet<string>, id: string, commit: (next: ReadonlySet<string>) => void): void => {
    const next = new Set(source);
    if (next.has(id)) next.delete(id); else next.add(id);
    commit(next);
  };
  const persistToggle = (source: ReadonlySet<string>, id: string, commit: (next: ReadonlySet<string>) => void, commandType: string): void => {
    // 未登录：之前直接 return，点的按钮毫无反馈；现在明说。
    if (!session?.principal) {
      setTriStateMsg("请先登录，收藏与计划才会同步。");
      return;
    }
    setTriStateMsg(undefined);
    const enabled = !source.has(id);
    toggle(source, id, commit);
    // 失败：之前静默回滚；现在回滚并展示原因，可重试。
    void sendSceneCommand(authClient, session, commandType, id, { sceneId: id, enabled }).catch(() => {
      commit(source);
      setTriStateMsg("同步失败，已恢复之前的状态，请重试。");
    });
  };
  // SCENE-CHECKIN-001: 「我在这里」。
  //
  // distanceMeters 只在**有当前位置**时才带：没授权定位就不带 —— 声明照样成立，
  // 只是没有距离佐证。反过来也不会因为没有位置就拦住用户，那等于逼人交位置。
  // SCENE-CONTRIB-001: 拉社区提案列表。自己提交的不给"确认"按钮 —— 服务端也会拒，
  // 但按钮先置灰才不会让人点了才知道白点。
  // SCENE-CONTRIB-001: 社区提交 UI 已整段撤下（commander 重做设计中），
  // 相关 state 与函数一并删除 —— 后端提案管线不动，等新 UI 直接接。
  // SCENE-EVENT-SIGNUP-001: 拉这个场景的活动。ListActivities 是公开的
  // （匿名可读），所以没登录也能看；报名那一步才要 session。
  const loadSceneActivities = (sceneId: string): void => {
    if (!secureSessionStore) { setSceneActivities([]); setSceneActivitiesState("SIGNED_OUT"); return; }
    setSceneActivitiesState("LOADING");
    setActivityMsg(undefined);
    void new ActivityClient({ authClient, secureSessionStore })
      .listActivities()
      .then((list) => {
        const valid = list.filter(isSceneActivity);
        const at = activitiesAtScene(valid, sceneId);
        setSceneActivities(at);
        setSceneActivitiesState(at.length > 0 ? "READY" : "EMPTY");
      })
      .catch(() => { setSceneActivities([]); setSceneActivitiesState("ERROR"); });
  };
  const joinSceneActivity = (activityId: string): void => {
    if (!secureSessionStore) { setActivityMsg("请先登录，才能报名。"); return; }
    setActivityBusyId(activityId);
    setActivityMsg(undefined);
    void new ActivityClient({ authClient, secureSessionStore })
      .join(activityId)
      .then((result) => {
        // 用服务端返回的整条活动替换本地那条 —— 人数是服务端算的，
        // 本地自加一会在别人同时报名时算错。
        const updated = result.activity as unknown;
        if (isSceneActivity(updated) && updated.realitySceneId === selectedId) {
          setSceneActivities((current) => current.map((item) => (item.activityId === updated.activityId ? updated : item)));
        }
        setActivityMsg("报名成功 —— 名额已扣，到店消费各自承担。");
      })
      .catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : "";
        if (/already_joined/i.test(msg)) setActivityMsg("你已经报名过这个活动了。");
        else if (/full/i.test(msg)) setActivityMsg("名额已经满了，去晚了一步。");
        else if (/not_found/i.test(msg)) setActivityMsg("这个活动已经不存在了。");
        else setActivityMsg("报名失败，请稍后重试。");
      })
      .finally(() => setActivityBusyId(undefined));
  };
  // SCENE-CHECKIN-100M-001: 打卡只认 GPS 真值。100 米内可打（含自动打卡），
  // 之外拒绝并明说距离；没定位（origin 未知）= 没证据 = 不能打。
  // 取消（enabled=false）不设门 —— 随时可撤自己的声明。
  const persistCheckIn = (scene: RealityScene): void => {
    if (!session?.principal) {
      setTriStateMsg("请先登录，才能打卡。");
      return;
    }
    setTriStateMsg(undefined);
    // SCENE-CHECKIN-FRESH-001: 手动打卡同样不认过期定位 —— 冻住的旧坐标在
    // 家也能"进圈"，点下去就是一张幽灵打卡。定位中稍等，过期了指去地图刷新。
    if (locating) {
      setTriStateMsg("正在重新定位，稍等几秒再打卡。");
      return;
    }
    if (origin !== undefined && !originFresh()) {
      setTriStateMsg("定位超过10分钟了：点地图右上角的定位图标刷新后，再回来打卡。");
      return;
    }
    const enabled = !here.has(scene.id);
    if (enabled) {
      const distance = origin ? metersBetween(origin, scene) : undefined;
      const eligibility = checkinEligibility(distance);
      if (!eligibility.eligible) {
        setTriStateMsg(checkinHint(false, distance));
        return;
      }
    }
    toggle(here, scene.id, setHere);
    const payload: Record<string, unknown> = { sceneId: scene.id, enabled };
    const distance = origin ? metersBetween(origin, scene) : undefined;
    if (distance !== undefined) payload.distanceMeters = distance;
    void sendSceneCommand(authClient, session, "SetRealitySceneCheckIn", scene.id, payload)
      .then((result) => {
        // SCENE-BADGE-001：打卡成功的响应里带 newlyEarnedBadges，弹「恭喜获得徽章」。
        const newly = Array.isArray(result.newlyEarnedBadges) ? (result.newlyEarnedBadges as string[]) : [];
        if (newly.length > 0) {
          setBadgeNotice(newly.map((id) => sceneBadgeById(id)?.name ?? id).join("、"));
        }
        setTriStateMsg(enabled ? "已打卡，90 分钟后自动结束。" : undefined);
      })
      .catch(() => {
        setHere(here);
        setTriStateMsg("同步失败，已恢复之前的状态，请重试。");
      });
  };
  // SCENE-NAV-001: 主页里的导航出口 —— tap 进主页的习惯不动，导航是第三颗按钮。
  // 走 MEETUP-NAV-001 同一套系统地图深链（iOS Apple Maps / Android Google Maps，
  // 默认步行，进系统应用后可切方式）；坐标非法 fail-closed，不编点。
  const openSceneNavigation = (scene: RealityScene): void => {
    const urls = meetupDirectionsUrls({ lat: scene.latitude, lng: scene.longitude });
    // (0,0) 落在大西洋正中间（Null Island）：上游拿它当“没填坐标”时，
    // 不能把人往海里导 —— 和非法坐标走同一个诚实出口。
    if (!urls || (scene.latitude === 0 && scene.longitude === 0)) {
      setNavError("这个场景没有可用坐标，打不开导航");
      return;
    }
    setNavError(undefined);
    const url = Platform.OS === "ios" ? urls.apple : urls.google;
    void Linking.openURL(url).catch(() => setNavError("打不开导航，请重试"));
  };
  const persistVisited = (id: string): void => {
    if (!session?.principal) {
      setTriStateMsg("请先登录，足迹才会同步。");
      return;
    }
    setTriStateMsg(undefined);
    const enabled = !visited.has(id); const previousVisited = visited; const previousTimes = visitedAt;
    toggle(visited, id, setVisited);
    const nextTimes = new Map(visitedAt); if (enabled) nextTimes.set(id, new Date().toISOString()); else nextTimes.delete(id); setVisitedAt(nextTimes);
    void sendSceneCommand(authClient, session, "SetPrivateRealitySceneVisited", id, { sceneId: id, enabled }).catch(() => {
      setVisited(previousVisited);
      setVisitedAt(previousTimes);
      setTriStateMsg("同步失败，已恢复之前的状态，请重试。");
    });
  };
  // SCENE-CHECKIN-FRESH-001: 门禁认的位置必须是 10 分钟内的真值 —— 冻住的
  // 旧坐标等于"人在店里"的假证据（离店后重进详情会按旧坐标自动打卡）。
  const ORIGIN_FRESH_MS = 10 * 60 * 1000;
  function originFresh(): boolean {
    return origin !== undefined && originAt !== undefined && Date.now() - originAt < ORIGIN_FRESH_MS;
  }
  // SCENE-FOOTPRINT-AUTO-001: 近场自动足迹。打开场景详情时，若设备位置在
  // 300m 内且已登录，记一次私人足迹（走同一 persistVisited 审计链）。
  // 只认实时距离 + 当面打开的详情，不编到访；每场景一次，失败静默。
  const autoFootprintDone = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!selected || !session?.principal || !origin || !originFresh()) return;
    if (visited.has(selected.id) || autoFootprintDone.current.has(selected.id)) return;
    if (metersBetween(origin, selected) > 300) return;
    autoFootprintDone.current = new Set(autoFootprintDone.current).add(selected.id);
    persistVisited(selected.id);
    setTriStateMsg("已按你的当前位置自动标记足迹。");
  }, [selected, session, origin, originAt, visited]);
  // 详情打开时定位过期，后台静默重取（不申请权限，拒绝/超时都静默）。
  // 久坐店里的人无感续上；离店的人拿回真坐标，门禁自然拒绝 —— 两边都不打扰。
  // 重取落地后下面的自动打卡/足迹 effect 会重跑，用新坐标重新判定。
  useEffect(() => {
    if (!selected || !session?.principal) return;
    if (origin !== undefined && originAt !== undefined && Date.now() - originAt < ORIGIN_FRESH_MS) return;
    let cancelled = false;
    setLocating(true);
    void (async () => {
      try {
        const fix = await getCurrentFix(expoLocationApi, { requestPermission: false });
        if (!fix || cancelled) return;
        setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
        setOriginAt(Date.now());
      } catch { /* 没定位就保持原样，门禁用过期口径处理 */ } finally {
        if (!cancelled) setLocating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, session]);
  // SCENE-CHECKIN-100M-001: 进圈自动打卡。打开场景详情时设备位置在 100m 内且
  // 已登录，自动记一次打卡（走同一 persistCheckIn 门禁链，圈外/无定位直接不打，
  // 不弹失败 —— 没证据不是失败）。每场景一次，失败静默（门禁内已判过 eligible）。
  const autoCheckinDone = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!selected || !session?.principal || !origin || !originFresh()) return;
    if (here.has(selected.id) || autoCheckinDone.current.has(selected.id)) return;
    if (!checkinEligibility(metersBetween(origin, selected)).eligible) return;
    autoCheckinDone.current = new Set(autoCheckinDone.current).add(selected.id);
    persistCheckIn(selected);
    setTriStateMsg("已按你的当前位置自动打卡。");
    // 只认进圈那一刻的 here/menu 状态 —— 与自动足迹同口径，guard 靠 ref。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, session, origin, originAt, here]);
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
      // DEVICE-LOCATION-003: 取 fix 走共用 helper（缓存秒回 → GPS → 10 秒超时），
      // 别在这里再手写一遍。授权前面已要过，这里不再弹。精度用 Low（15km
      // 附近列表够用，省电；要精确定位的那条路走服务端同意）。
      const fix = await getCurrentFix(expoLocationApi, { requestPermission: false });
      if (!fix) throw new Error("定位超时（10 秒无 GPS 信号）— 请到开阔处重试，或用搜场景切换地址");
      const { latitude, longitude } = fix;
      const response = await authClient.request("/v1/reality-scenes/nearby", { method: "POST", body: { latitude, longitude, radiusKm: 15 } });
      const body = await response.json() as { scenes?: unknown };
      if (response.status < 200 || response.status >= 300 || !Array.isArray(body.scenes)) throw new Error("附近场景暂时不可用");
      const valid = body.scenes.filter(isRealityScene);
      if (valid.length !== body.scenes.length) throw new Error("附近场景数据异常");
      setScenes(valid); setOrigin({ latitude, longitude }); setOriginAt(Date.now()); setFilter("ALL"); setView("MAP");
    } catch (error) { setNearbyError(error instanceof Error ? error.message : "无法获取附近场景"); }
    finally { setNearbyBusy(false); }
  };

  // SCENE-MAP-GESTURE-001: 详情原来是 early-return 整页替换，地图每次进出都
  // 卸载/重装原生 MapView，iOS 手势在重装后死亡（滑动/缩放卡死）。
  // 改为详情盖层：地图常驻挂载，进出只显隐盖层，手势不再断。
  const activeVariant = selected ? detail?.variants.find((item) => item.id === detail.selectedVariant) : undefined;
  const detailBody = selected ? (
      <ScrollView style={[styles.root, rootPad]} contentContainerStyle={styles.detailContent}>
        <View style={styles.detailTop}><Pressable accessibilityLabel="返回" onPress={() => { if (selectedId && selectedId !== initialSceneId) setSelectedId(undefined); else onBack(); }} style={styles.backButton}><Text selectable style={styles.backText}>‹</Text></Pressable><View style={styles.detailTopCopy}>{/* MERCHANT-LOGO-001: 商家标志 —— 有 logo 上图，没有回字母块（和线上店铺管理面同款），不编占位图。 */}<View style={styles.venueRow}>{detail?.logoUrl ? <Image accessibilityLabel={`${detail?.venueName ?? selected.name}商家标志`} cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-logo:${detail.sceneId}`} source={{ uri: detail.logoUrl }} style={styles.venueLogo} transition={0} /> : <View style={styles.venueLogo}><Text selectable style={styles.venueLogoText}>{(detail?.venueName ?? selected.name).slice(0, 1).toUpperCase()}</Text></View>}<View style={styles.venueCopy}><Text selectable style={styles.detailTopTitle}>{detail?.venueName ?? selected.name}</Text><Text selectable style={styles.detailTopSub}>{activeVariant ? `${activeVariant.name} · ${selected.area}` : `${selected.type} · ${selected.area}`}</Text>{/* SCENE-CATEGORY-001: 顶类徽标 —— 去过/未开放照样显示分类（置灰的是标记，不是身份）。 */}<View style={styles.categoryBadge}><Text selectable style={styles.categoryBadgeText}>{selected.category}</Text></View></View></View></View><View style={styles.topSpacer} /></View>
        <View style={styles.hero}>
          {detail?.heroImageUrl ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene:${detail.sceneId}:${detail.mediaVersion}`} source={{ uri: detail.heroImageUrl }} style={styles.heroMap} transition={0} /> : <MapView initialRegion={{ latitude: selected.latitude, longitude: selected.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }} pointerEvents="none" style={styles.heroMap}><Marker coordinate={{ latitude: selected.latitude, longitude: selected.longitude }} pinColor={selected.active ? color.magenta : color.violet} /></MapView>}
          {/* 封面只留：硬件优点（facets，没开 variant 时回落类型）+ 真实计数。
              地址不在主页写 —— 地图上有，重复写就是废话。名字只在上面出现一次，
              这里不再重复标题。 */}
          <View style={styles.heroFacets}>{(activeVariant ? activeVariant.facets : [selected.type]).map((facet) => <View key={facet} style={styles.heroFacet}><Text selectable style={styles.heroFacetText}>{facet}</Text></View>)}</View>
          {/* 评分数据源还没有（唯一诚实的是收藏/去过/在场计数）—— 有评分管线
              之前拿计数当"评价"，绝不编分。 */}
          <Text style={styles.sceneCounts} selectable>{sceneCountsLine(selected)}</Text>
        </View>
        <Text style={styles.venueIntro} selectable>{activeVariant ? `${activeVariant.window} · ${activeVariant.bestFor}` : selected.description}</Text>
        {detail ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.variantRail}>
              {detail.variants.map((variant) => <Pressable key={variant.id} onPress={() => selectVariant(variant.id)} style={[styles.variantPill, detail.selectedVariant === variant.id && styles.variantPillSelected]}><Text selectable style={[styles.variantPillText, detail.selectedVariant === variant.id && styles.variantPillTextSelected]}>{variant.name.replace(" Coffee", "").replace(" Social", "")}</Text></Pressable>)}
            </ScrollView>
            {featuredAIAccount?.boundSceneId === detail.sceneId ? <View testID="ai-scene-binding" style={styles.aiBindingCard}><Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-ai:${featuredAIAccount.accountId}:${featuredAIAccount.avatarVersion ?? 1}`} source={aiAccountPhoto(featuredAIAccount)} style={styles.aiBindingAvatar} transition={0} /><View style={styles.aiBindingCopy}><Text selectable style={styles.aiBindingEyebrow}>AI 小美 × 当前 Scene</Text><Text selectable style={styles.aiBindingTitle}>{featuredAIAccount.displayName} · {featuredAIAccount.boundActivityTitle}</Text><Text selectable style={styles.aiBindingText}>{featuredAIAccount.role}，可围绕这个场景聊天、陪伴和生成 UGC 灵感；不能到场、接单或报名活动。</Text><Pressable accessibilityLabel={`查看${featuredAIAccount.displayName}主页`} onPress={() => onOpenAIProfile?.(featuredAIAccount)} style={styles.aiProfileButton}><Text selectable style={styles.aiProfileButtonText}>查看小美主页</Text></Pressable></View></View> : null}
            {featuredHuman ? <View testID="human-scene-binding" style={styles.humanBindingCard}>{featuredHuman.avatarUri ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-person:${featuredHuman.userId}`} source={{ uri: featuredHuman.avatarUri }} style={styles.aiBindingAvatar} transition={0} /> : null}<View style={styles.aiBindingCopy}><Text selectable style={styles.humanBindingEyebrow}>真人 × 当前 Scene</Text><Text selectable style={styles.aiBindingTitle}>{featuredHuman.name}适合这个场景</Text><Text selectable style={styles.aiBindingText}>这是基于场景的真人推荐，尚未代表本人到场或接受邀请。可进入主页了解后，再发起好友或现实活动邀请。</Text><Pressable accessibilityLabel={`查看${featuredHuman.name}主页`} onPress={() => onOpenHumanProfile?.(featuredHuman)} style={styles.aiProfileButton}><Text selectable style={styles.aiProfileButtonText}>查看真人主页</Text></Pressable></View></View> : null}
            <View style={styles.sectionTitleRow}><Text selectable style={styles.sectionTitle}>现在最适合</Text><Pressable onPress={() => setWhyOpen((open) => !open)}><Text selectable style={styles.sectionLink}>{whyOpen ? "收起依据" : "为什么"}</Text></Pressable></View>
            <View style={styles.bestGrid}><View style={styles.bestCard}><Text selectable style={styles.bestTitle}>{activeVariant?.bestFor}</Text><Text selectable style={styles.bestSub}>按当前时段、现场状态和可用资源推荐。</Text></View><View style={styles.bestCard}><Text selectable style={styles.bestTitle}>{detail.liveState.state.replaceAll("_", " ")}</Text>{/* GEO-HONEST-001: 没有容量来源时明说"未知"，绝不回落到一个数字。 */}<Text selectable style={styles.bestSub}>{detail.liveState.bestWindow}{detail.liveState.capacityPct === undefined ? " · 容量未知" : ` · 容量 ${detail.liveState.capacityPct}%`}</Text></View></View>
            {whyOpen ? <View style={styles.whyCard}><Text selectable style={styles.whyTitle}>推荐依据</Text><Text selectable style={styles.whyText}>当前时段：{activeVariant?.window}</Text><Text selectable style={styles.whyText}>场景标签：{activeVariant?.facets.join(" · ")}</Text>{/* GEO-HONEST-001: 时效声明只在对数据真有来源时才出现 —— 给编造的数字配一个"有效至"时间戳，比数字本身更误导。 */}<Text selectable style={styles.whyText}>现场状态：{detail.liveState.label}{detail.liveState.freshUntil === undefined ? "（容量数据未接入，故无时效）" : `，数据有效至 ${new Date(detail.liveState.freshUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</Text><Text selectable style={styles.whyBoundary}>这是场景推荐，不代表真人在场，也不生成到访、订单或履约证明。</Text></View> : null}
            <Text selectable style={styles.sectionTitle}>适合一起的人</Text>
            {/* SCENE-HUMANS-EMPTY-001: 选人是付费决策点 —— 没有人时必须说出"没有人"，
                不能只留标题和一个空横滑（那会被读成"还在加载"）。文案说明它不是一个
                失败状态，也不是"再等等就会有人"的承诺。 */}
            {detail.humans.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.humanRail}>
              {/* SCENE-HUMANS-002: 纯圆头 rail，不要白卡片 —— 和首页同款圆头像放大
                  （64），名字 + 可约状态居中跟在下面。选中态改用头像外圈紫环
                  （卡片删了，边框无处可画）；点按仍是“选中邀约对象”，链不断。 */}
              {detail.humans.map((human) => <Pressable key={human.id} accessibilityLabel={`选择${human.name}`} onPress={() => setSelectedHumanId((prev) => (prev === human.id ? undefined : human.id))} style={styles.humanPlain}><View style={[styles.humanRing, selectedHumanId === human.id && styles.humanRingSelected]}>{humanAvatarUri(human.avatarUrl) !== undefined ? <CircularAvatarImage accessibilityLabel={`${human.name}头像`} size={64} uri={humanAvatarUri(human.avatarUrl)!} /> : <View style={styles.humanAvatarFallback}><Text selectable style={styles.humanAvatarText}>{human.name.slice(0, 1).toUpperCase()}</Text></View>}</View><Text selectable style={styles.humanPlainName}>{human.name}</Text><Text selectable style={styles.humanPlainSub}>{selectedHumanId === human.id ? "✓ 已选择" : human.availability}{human.source === "FIXTURE" ? " · 占位候选" : ""}</Text></Pressable>)}
              {/* SCENE-HUMANS-001: 只露圆头像 + 名字 + 可约状态。点按仍是“选中邀约对象”
                  （DIRECT_INVITE 靠 selectedHumanId 找人，链不断）；role 与 fit% 删掉，
                  可约原文（本周可约/上午可约…）是服务端真值，原样展示不改写。
                  SCENE-HUMANS-004: rail 只渲染一遍 —— 上面那一行 map 就是全部，
                  这里不许再挂第二遍（曾经两遍 identical 并排，每个人出现两次）。 */}
            </ScrollView>
            ) : (
              <Text selectable style={styles.humanEmpty}>这个场景现在还没有挂出可约时间的人 —— 这不是加载失败，也不是「再等等就会有人」的承诺。可以先收藏这个场景。</Text>
            )}
            <View style={styles.sectionTitleRow}><Text selectable style={styles.sectionTitle}>{fullMenuOpen ? `${detail.venueName} · 完整菜单` : "这个 Scene 喝什么"}</Text><Pressable onPress={() => setFullMenuOpen((open) => !open)}><Text selectable style={styles.sectionLink}>{fullMenuOpen ? "只看当前 Scene" : "完整菜单"}</Text></Pressable></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuRail}>{(fullMenuOpen ? detail.fullMenu : detail.menu).map((item) => <Pressable disabled={!item.available} key={item.id} onPress={() => setSelectedMenuId(item.id)} style={[styles.menuCard, selectedMenuId === item.id && styles.menuCardSelected]}><Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-sku:${item.id}`} source={{ uri: item.imageUrl }} style={styles.menuImage} transition={0} /><Text selectable numberOfLines={1} style={styles.menuName}>{item.name}</Text><Text selectable style={styles.menuFit}>{item.sceneFit} · {item.available ? selectedMenuId === item.id ? "✓ 已选择" : "可售" : "售罄"}</Text><Text selectable style={styles.menuPrice}>{item.priceLabel}</Text></Pressable>)}</ScrollView>
            {/* SCENE-CHECKIN-100M-001: 详情只留两个动作 —— 收藏（意愿）与打卡
                （到场证明，100m 门禁）。「标记去过 / 去这里 / 我在这里」三个人工
                声明入口已撤：无验证的手点不产生到场事实；去过由 300m 自动足迹记，
                计划走活动报名。底层 planned/visited 数据照常加载展示，不断历史。 */}
            <View style={styles.actions}>
              <Pressable onPress={() => persistToggle(saved, selected.id, setSaved, "SetRealitySceneSaved")} style={[styles.action, saved.has(selected.id) && styles.actionSelected]}><Text selectable style={styles.actionText}>{saved.has(selected.id) ? "★ 已收藏" : "☆ 收藏"}</Text></Pressable>
              <Pressable accessibilityLabel={here.has(selected.id) ? "取消打卡" : "打卡"} onPress={() => persistCheckIn(selected)} style={here.has(selected.id) ? [styles.action, styles.actionSelected] : styles.primaryAction}><Text selectable style={here.has(selected.id) ? styles.actionText : styles.primaryActionText}>{here.has(selected.id) ? "✓ 已打卡" : "打卡"}</Text></Pressable>
              {/* SCENE-NAV-001: 第三颗按钮只管送人过去，不碰收藏/打卡的门禁链。 */}
              <Pressable accessibilityLabel="导航去这里" onPress={() => openSceneNavigation(selected)} style={styles.action}><Text selectable style={styles.actionText}>导航去这里 ›</Text></Pressable>
            </View>
            {navError ? <Text selectable style={styles.nearbyError}>{navError}</Text> : null}
            <View style={styles.actions}>
              <Text selectable style={styles.checkInHint}>{checkinHint(here.has(selected.id), origin && originFresh() ? metersBetween(origin, selected) : undefined)}</Text>
            </View>
            {/* BADGE-WALL-001: 本店徽章进度 —— 这家能点亮哪些、还差几家点谁的名。
                到访印记（去过/没去过）来自打卡史，不是有效期内的 here 集合。 */}
            {sceneBadgeRows !== undefined && sceneBadgeRows.length > 0 ? (
              <View style={styles.badgeProgressBox}>
                <Text selectable style={styles.badgeProgressTitle}>
                  {sceneBadgeRows[0]?.visited ? "✓ 本店已打卡" : "本店未打卡"} · 可点亮
                </Text>
                {sceneBadgeRows.map((row) => (
                  <View key={row.badge.id} style={styles.badgeProgressRow}>
                    <Text selectable style={styles.badgeProgressName}>{row.badge.icon} {row.badge.name}</Text>
                    {row.progress !== undefined ? (
                      <Text selectable style={styles.badgeProgressText}>
                        {row.progress.done}/{row.progress.total}{row.missingNames.length > 0 ? ` · 还差${row.missingNames.join("、")}` : ""}
                      </Text>
                    ) : (
                      <Text selectable style={styles.badgeProgressText}>{row.badge.desc}</Text>
                    )}
                  </View>
                ))}
              </View>
            ) : null}
            {triStateMsg ? <Text selectable style={styles.nearbyError}>{triStateMsg}</Text> : null}
            {(detail?.aiVisits && detail.aiVisits.length > 0) || isXiaomeiScene(selected.id) ? (
              <Text selectable style={styles.xiaomeiSceneHint}>
                ✨ {detail?.aiVisits && detail.aiVisits.length > 0
                  ? `小美「${detail.aiVisits.map((v) => v.displayName).join("、")}」常来这里 —— 在这里打卡可获得「与小美同框」徽章。`
                  : "这是小美的绑定场景 —— 在这里打卡可获得「与小美同框」徽章。"}
              </Text>
            ) : null}
            {/* SCENE-EVENT-SIGNUP-001: 只能"发起"的详情页等于只能喊话 —— 看
                不到这个场景上已经有什么局，也没法报名。这里列出来 + 直接报名。 */}
            <Text selectable style={styles.sectionTitle}>这里的活动</Text>
            {sceneActivityFeedText(activityFeed) !== "" ? <Text selectable style={styles.activityEmpty}>{sceneActivityFeedText(activityFeed)}</Text> : null}
            {activityFeed.items.map((item) => (
              <View key={item.activityId} style={styles.activityRow}>
                <View style={styles.activityInfo}>
                  <Text selectable style={styles.activityTitle}>{item.title}</Text>
                  <Text selectable style={styles.activityMeta}>{item.time} · {activitySignupLabel(item)}</Text>
                </View>
                <Pressable
                  disabled={!canSignUp(item) || activityBusyId === item.activityId}
                  onPress={() => joinSceneActivity(item.activityId)}
                  style={[styles.activityJoin, !canSignUp(item) && styles.activityJoinDisabled]}
                >
                  <Text selectable style={styles.activityJoinText}>{activityBusyId === item.activityId ? "报名中…" : canSignUp(item) ? "报名" : "已满"}</Text>
                </Pressable>
              </View>
            ))}
            {activityMsg ? <Text selectable style={styles.nearbyError}>{activityMsg}</Text> : null}
            <Text selectable style={styles.sectionTitle}>怎么组织这次现实行动</Text>
            <View style={styles.executionCard}>
              {detail.actions.map((action) => <Pressable key={action.type} onPress={() => { setSelectedAction(action); setActionResult(undefined); setActionExplanation(`${action.label}：${action.moneyMeaning}`); }} style={[styles.executionAction, selectedAction?.type === action.type && styles.executionActionSelected]}><Text selectable style={styles.executionLabel}>{action.label}</Text><Text selectable style={styles.executionState}>{action.type === "DIRECT_INVITE" ? "需本人接受" : action.type === "OPEN_TASK" ? "候选人申请" : "公开报名"}</Text></Pressable>)}
            </View>
            {actionExplanation ? <View style={styles.boundaryCard}><Text selectable style={styles.boundaryStrong}>{actionExplanation}</Text><Text selectable style={styles.boundaryText}>{detail.truthBoundary}</Text>{selectedAction?.type === "DIRECT_INVITE" ? <View><Text selectable style={styles.inviteAmountLabel}>给真人小美的报酬（VND）</Text><View style={styles.inviteAmountRow}><TextInput keyboardType="number-pad" onChangeText={setInviteAmountText} placeholder="150,000" style={styles.inviteAmountInput} value={inviteAmountText} /><Text selectable style={styles.inviteCurrency}>VND</Text></View><Text selectable style={styles.boundaryText}>对方接受前会看到该金额；接受后冻结进订单。</Text></View> : null}{selectedAction ? <Pressable disabled={actionBusy} onPress={() => { void commitSceneAction(); }} style={styles.confirmAction}><Text selectable style={styles.confirmActionText}>{actionBusy ? "处理中…" : `确认${selectedAction.label}`}</Text></Pressable> : null}{actionResult ? <Text selectable style={styles.actionResult}>{actionResult}</Text> : null}</View> : null}
            {/* SCENE-STUDIO-001: 三元素出图卡。场景 hero + 文案来自已选时段，
                菜单来自点中的那一款，小美来自绑定本场景的账号 —— 缺哪个，
                卡上就明写缺哪个，按钮同步 disabled，进分享链的永远是卡上
                摆出来的同一份，不存在"图上一个样、文案另一个样"。 */}
            <Text selectable style={styles.sectionTitle}>场景 Studio</Text>
            <View ref={studioShareRef} collapsable={false} style={styles.badgeShareCard}>
              <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-studio:${detail.sceneId}:${detail.mediaVersion}`} source={{ uri: detail.heroImageUrl }} style={styles.heroMap} transition={0} />
              <Text selectable style={styles.studioName}>{detail.venueName} · {activeVariant?.name ?? selected.type}</Text>
              <Text selectable style={styles.studioSub}>{activeVariant ? `${activeVariant.window} · ${activeVariant.bestFor}` : selected.description}</Text>
              <View style={styles.studioRow}>
                {studioMenu ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-studio-sku:${studioMenu.id}`} source={{ uri: studioMenu.imageUrl }} style={styles.studioThumb} transition={0} /> : null}
                <View style={styles.studioCopy}>
                  <Text selectable style={styles.studioName}>{studioMenu ? `${studioMenu.name} · ${studioMenu.priceLabel}` : "还没选菜单"}</Text>
                  <Text selectable style={styles.studioSub}>{studioMenu ? "你亲手点的那一款" : "去上面点一款，选什么出什么"}</Text>
                </View>
              </View>
              <View style={styles.studioRow}>
                {studioXiaomei ? <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`scene-studio-ai:${studioXiaomei.accountId}:${studioXiaomei.avatarVersion ?? 1}`} source={aiAccountPhoto(studioXiaomei)} style={styles.aiBindingAvatar} transition={0} /> : null}
                <View style={styles.studioCopy}>
                  <Text selectable style={styles.studioName}>{studioXiaomei ? studioXiaomei.displayName : "还没有绑定的小美"}</Text>
                  <Text selectable style={styles.studioSub}>{studioXiaomei ? studioXiaomei.boundActivityTitle : "等小美绑定这个场景再出图"}</Text>
                </View>
              </View>
            </View>
            <Pressable accessibilityLabel={studioReady ? "生成 Studio 照" : studioMenu === undefined ? "先选一款菜单再出图" : "等小美绑定这个场景再出图"} disabled={!studioReady} onPress={() => void shareStudioCard()} style={[styles.badgeShareBtn, !studioReady && styles.studioBtnDisabled]}><Text selectable style={styles.badgeShareBtnText}>{studioReady ? "生成 Studio 照" : studioMenu === undefined ? "先选一款菜单再出图" : "等小美绑定这个场景再出图"}</Text></Pressable>
            {studioShareNotice ? <Text selectable style={styles.nearbyError}>{studioShareNotice}</Text> : null}
          </>
        ) : detailError ? <Text selectable style={styles.nearbyError}>{detailError}</Text> : <Text selectable style={styles.loadingDetail}>正在加载当前时段的人、菜单与活动方式…</Text>}
        <Text selectable style={styles.sectionTitle}>场景数据</Text>
        <View style={styles.dataCard}>
          <DataRow label="开放时间" value={selected.best} />
          <DataRow label="场景动态" value={sceneCountsLine(selected)} />
          {visitedAt.get(selected.id) ? <DataRow label="最近足迹" value={new Date(visitedAt.get(selected.id)!).toLocaleString()} /> : null}
        </View>
        <View style={styles.sectionTitleRow}><Text selectable style={styles.sectionTitle}>Reality Evidence · Scene Memory</Text></View>
        <View style={styles.memoryCard}><Text selectable style={styles.memoryTitle}>{visited.has(selected.id) ? "已私人标记去过" : "暂无已核验现实记录"}</Text><Text selectable style={styles.memoryText}>{visited.has(selected.id) ? "这只是你的私人足迹标记；完成订单、现场核销或上传并通过审核的证据，才会写入 Scene Memory。" : "完成订单、现场核销或上传并通过审核的证据后，这里才会沉淀同行人、消费项目、内容与关系变化。"}</Text></View>
      </ScrollView>
  ) : null;

  return (
    <View style={[styles.root, rootPad]}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.roundButton}><Text selectable style={styles.backText}>‹</Text></Pressable>
              <View style={styles.topCopy}><Text selectable style={styles.title}>场景地图</Text><Text selectable style={styles.subtitle}>场景目录 · {scenes.length} 个场景</Text></View>
        <Pressable accessibilityLabel={view === "MAP" ? "切换列表" : "切换地图"} onPress={() => setView(view === "MAP" ? "LIST" : "MAP")} style={styles.roundButton}><ProxyIcon color={color.ink} name={view === "MAP" ? "storeLines" : "crosshair"} size={21} /></Pressable>
        <Pressable accessibilityLabel={searchOpen ? "关闭搜索" : "搜索场景"} onPress={() => { if (searchOpen) setQuery(""); setSearchOpen((open) => !open); }} style={styles.roundButton}><ProxyIcon color={color.ink} name="search" size={21} /></Pressable>
      </View>
      {nearbyError ? <Text selectable style={styles.nearbyError}>{nearbyError}</Text> : null}
      <View style={styles.stats}>
        <Stat value={Math.max(0, scenes.filter((scene) => !visited.has(scene.id)).length)} label="未探索" onPress={() => setFilter("UNSEEN")} />
        {/* 「开放中」计数删掉：读的是 seed 静态布尔值，不是实时营业状态，
            摆出来就是假数据。过滤 chips 里那枚「开放中」保留 —— 按目录静态
            属性筛没问题，有问题的是把它当实时计数展示。 */}
        <Stat value={visited.size} label="我的足迹" onPress={() => setFilter("VISITED")} />
      </View>
      {searchOpen ? (
        <View style={styles.searchBox}>
          <ProxyIcon color={color.muted} name="search" size={19} />
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="搜场景、区域、主题" placeholderTextColor={color.muted} style={styles.searchInput} />
          <Pressable accessibilityLabel="关闭搜索" onPress={() => { setQuery(""); setSearchOpen(false); }}><Text selectable style={styles.searchClose}>×</Text></Pressable>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRail} contentContainerStyle={styles.filters}>
        {([['ALL','全部'], ['UNSEEN','没去过'], ['ACTIVE','开放中'], ['SAVED','收藏'], ['VISITED','足迹']] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setFilter(id)} style={[styles.filter, filter === id && styles.filterActive]}><Text selectable style={[styles.filterText, filter === id && styles.filterTextActive]}>{label}</Text></Pressable>
        ))}
        <Pressable onPress={openBadges} style={[styles.filter, styles.filterActive]}><Text selectable style={[styles.filterText, styles.filterTextActive]}>🏅 徽章</Text></Pressable>
      </ScrollView>
      {badgeNotice ? (
        <View style={styles.badgeNotice}>
          <Text selectable style={styles.badgeNoticeText}>🎉 恭喜获得徽章：{badgeNotice}</Text>
        </View>
      ) : null}
      {/* SCENE-CONTRIB-001: 社区提交 UI 已整段撤下（commander 重做设计中）。
          后端提案管线（提案/确认/Source=COMMUNITY）原样保留，等新 UI 直接接。
          下面直接进地图/列表。 */}
      {view === "MAP" ? (
        <View style={styles.mapWrap}>
          {/* 人位晚到时 remount 一次吃新 initialRegion（origin 只接第一次，后续不变）。 */}
          <MapView key={origin ? `${origin.latitude}:${origin.longitude}` : "catalog"} initialRegion={{ latitude: origin?.latitude ?? HANOI_CENTER_FALLBACK.latitude, longitude: origin?.longitude ?? HANOI_CENTER_FALLBACK.longitude, latitudeDelta: origin ? 0.12 : 0.115, longitudeDelta: origin ? 0.12 : 0.115 }} onPress={() => setPinSheetId(undefined)} showsUserLocation={!!origin} style={StyleSheet.absoluteFill}>
            {heat
              ? filtered.map((scene) => {
                  const score = sceneHeatScore(scene);
                  if (score <= 0) return null;
                  return (
                    <Circle
                      key={scene.id}
                      center={{ latitude: scene.latitude, longitude: scene.longitude }}
                      radius={150 + Math.min(score, 24) * 30}
                      strokeColor="rgba(133,51,245,0.45)"
                      fillColor="rgba(133,51,245,0.10)"
                    />
                  );
                })
              : filtered.map((scene) => <Marker key={scene.id} coordinate={{ latitude: scene.latitude, longitude: scene.longitude }} onPress={() => { setPinSheetId(scene.id); }} pinColor={!scene.active ? color.muted : visited.has(scene.id) ? (scene.category === "商家" ? color.magenta : scene.category === "景点" ? color.violet : color.muted) : color.muted} title={scene.name} description={sceneAddressLine(scene)} />)}
          </MapView>
          <Pressable
            style={[styles.heatToggle, heat && styles.heatToggleOn]}
            onPress={() => setHeat((h) => !h)}
            testID="scene-map-heat"
            accessibilityLabel="热力图"
          >
            <Text selectable style={heat ? styles.heatToggleTextOn : styles.heatToggleText}>◉</Text>
          </Pressable>
          {/* 定位按钮：地图右上单图标（原来那条整宽文字按钮已撤）。 */}
          <Pressable
            disabled={nearbyBusy || !session}
            onPress={() => { void recommendNearby(); }}
            style={[styles.locateBtn, (nearbyBusy || !session) ? styles.locateBtnDisabled : undefined]}
            accessibilityLabel={nearbyBusy ? "正在定位" : "定位到我"}
          >
            <ProxyIcon color={nearbyBusy || !session ? color.muted : color.ink} name="crosshair" size={21} />
          </Pressable>
          <View pointerEvents="none" style={styles.privacyPill}><Text selectable style={styles.privacyText}>公开足迹 · 非实时位置</Text></View>
          {/* SCENE-NAV-PIN-001: 图钉快打卡 —— 名字 + 地址 + 导航/详情二选一，
              悬在地图底部隐私条上方。导航和详情页里第三颗按钮是同一条深链；
              看详情才进 selectedId（自动足迹/打卡门禁照旧），点地图空白、
              × 或系统返回收卡。 */}
          {pinScene ? (
            <View style={styles.pinSheet}>
              <View style={styles.pinSheetCopy}>
                <Text selectable style={styles.sceneName}>{pinScene.name}</Text>
                <Text selectable style={styles.sceneMeta}>{sceneAddressLine(pinScene)}</Text>
              </View>
              <Pressable accessibilityLabel="关闭快打卡" onPress={() => setPinSheetId(undefined)} style={styles.pinSheetClose}><Text selectable style={styles.pinSheetCloseText}>×</Text></Pressable>
              <View style={styles.pinSheetRow}>
                <Pressable accessibilityLabel="导航去这里" onPress={() => openSceneNavigation(pinScene)} style={styles.primaryAction}><Text selectable style={styles.primaryActionText}>导航去这里 ›</Text></Pressable>
                <Pressable accessibilityLabel="看场景详情" onPress={() => { setPinSheetId(undefined); setSelectedId(pinScene.id); }} style={styles.action}><Text selectable style={styles.actionText}>看详情 ›</Text></Pressable>
              </View>
              {navError ? <Text selectable style={styles.nearbyError}>{navError}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} style={styles.listScroll}>
          {filtered.map((scene) => <SceneRow key={scene.id} scene={scene} visited={visited.has(scene.id)} saved={saved.has(scene.id)} planned={planned.has(scene.id)} onPress={() => setSelectedId(scene.id)} />)}
          {!filtered.length ? <Text selectable style={styles.empty}>没有符合条件的场景</Text> : null}
        </ScrollView>
      )}
      {detailBody ? <View style={styles.detailOverlay}>{detailBody}</View> : null}
      {/* SCENE-BADGE-001：徽章墙。 */}
      <Modal animationType="fade" onRequestClose={() => setBadgesOpen(false)} transparent visible={badgesOpen}>
        <Pressable onPress={() => setBadgesOpen(false)} style={styles.badgeScrim}>
          <View style={styles.badgeCard}>
            <Text selectable style={styles.badgeTitle}>打卡徽章</Text>
            {badgesError ? <Text selectable style={styles.nearbyError}>{badgesError}</Text> : null}
            {/* SCENE-BADGE-002：可分享的徽章卡摘要（截图目标）。 */}
            <View ref={badgeShareRef} collapsable={false} style={styles.badgeShareCard}>
              <Text selectable style={styles.badgeShareCount}>已获得 {earnedBadges.size} / {SCENE_BADGES.length} 枚徽章</Text>
              <View style={styles.badgeShareIcons}>
                {SCENE_BADGES.map((b) => (
                  <Text selectable key={b.id} style={[styles.badgeShareIcon, !earnedBadges.has(b.id) && styles.badgeShareIconLocked]}>{earnedBadges.has(b.id) ? b.icon : "🔒"}</Text>
                ))}
              </View>
            </View>
            {badgeShareNotice ? <Text selectable style={styles.nearbyError}>{badgeShareNotice}</Text> : null}
            <ScrollView style={styles.badgeList}>
              {SCENE_BADGES.map((badge) => {
                const earned = earnedBadges.has(badge.id);
                return (
                  <View key={badge.id} style={[styles.badgeRow, earned && styles.badgeRowEarned]}>
                    <Text selectable style={styles.badgeIcon}>{badge.icon}</Text>
                    <View style={styles.badgeCopy}>
                      <Text selectable style={[styles.badgeName, !earned && styles.badgeNameLocked]}>{badge.name}{earned ? " ✓" : ""}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => void shareBadgeCard()} style={styles.badgeShareBtn}><Text selectable style={styles.badgeShareBtnText}>分享徽章卡</Text></Pressable>
            <Pressable onPress={() => setBadgesOpen(false)} style={styles.badgeClose}><Text selectable style={styles.badgeCloseText}>关闭</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function isSceneDetail(value: unknown): value is SceneDetail {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SceneDetail>;
  return typeof item.sceneId === "string" && typeof item.heroImageUrl === "string" && item.heroImageUrl.length > 0 && typeof item.mediaVersion === "number" && (item.logoUrl === undefined || typeof item.logoUrl === "string") && typeof item.selectedVariant === "string" && Array.isArray(item.variants) && item.variants.length > 0 && !!item.liveState && Array.isArray(item.menu) && item.menu.every((menu) => typeof menu.imageUrl === "string" && menu.imageUrl.length > 0) && Array.isArray(item.fullMenu) && item.fullMenu.length >= item.menu.length && item.fullMenu.every((menu) => typeof menu.imageUrl === "string" && menu.imageUrl.length > 0) && Array.isArray(item.humans) && item.humans.every((human) => human.isAI === false && typeof human.avatarUrl === "string" && human.avatarUrl.length > 0) && Array.isArray(item.actions) && item.actions.length === 3 && typeof item.truthBoundary === "string";
}

function isRealityScene(value: unknown): value is RealityScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as Partial<RealityScene>;
  // SCENE-NO-FABRICATED-001: 这里**故意不校验** quality / posts / creators /
  // activities / invites —— 它们已经从服务端删掉了。要是哪天有人加回来，
  // 这个校验会放行（宽松），但 TestSceneHasNoFabricatedNumbers 和
  // scripts/check-regression-contracts.sh 的 SCENE-NO-FABRICATED-001 会红。
  return typeof scene.id === "string" && typeof scene.name === "string" && typeof scene.area === "string" && typeof scene.type === "string" && typeof scene.latitude === "number" && Number.isFinite(scene.latitude) && typeof scene.longitude === "number" && Number.isFinite(scene.longitude) && typeof scene.best === "string" && typeof scene.active === "boolean" && typeof scene.description === "string" && (scene.distanceMeters === undefined || typeof scene.distanceMeters === "number") && (scene.address === undefined || typeof scene.address === "string") && (scene.savedCount === undefined || typeof scene.savedCount === "number") && (scene.visitedCount === undefined || typeof scene.visitedCount === "number") && (scene.plannedCount === undefined || typeof scene.plannedCount === "number") && (scene.hereCount === undefined || typeof scene.hereCount === "number") && (scene.source === undefined || typeof scene.source === "string") && (scene.category === "商家" || scene.category === "景点" || scene.category === "其他");
}

// 地址行的回退逻辑在 reality-scene-address.ts（纯 .ts，可单测）——
// 本文件 import react-native-maps，vitest 进不来，逻辑不能留在这里。

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
  if (!result || response.status < 200 || response.status >= 300 || result.outcome === "REJECTED") throw new Error(commandErrorMessage(result?.error, "reality scene command failed"));
  let decoded: Record<string, unknown> = {};
  if (result.operationRef) {
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("reality scene response malformed");
    decoded = value as Record<string, unknown>;
  }
  return { ...decoded, aggregateId: result.aggregate?.id, aggregateState: result.aggregate?.state };
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.stat}><Text selectable style={styles.statValue}>{value}</Text><Text selectable style={styles.statLabel}>{label}</Text></Pressable>;
}

// SCENE-NO-FABRICATED-001: 这一行以前是
//   scene.active ? <一个"此刻现场有活动"的文案> : visited ? "去过" : saved ? "已收藏" : <一个手写死的质量分>
// 两句都是假的：
//   · "此刻现场有活动" 读的是 seed 里的**静态布尔值**，跟此刻现场有没有人、有
//     没有活动毫无关系（同一个 flag 也被上面那个「开放中」筛选器用着）；
//   · 那个质量分（84..96）是迁移里手写死的整数，全仓没有任何评分来源。
// 现在只说我们知道的事 —— 用户自己的标记，或真实聚合的计数。
function SceneRow({ scene, visited, saved, planned, onPress }: { scene: RealityScene; visited: boolean; saved: boolean; planned: boolean; onPress: () => void }): React.JSX.Element {
  return <Pressable onPress={onPress} style={styles.sceneRow}><View style={[styles.sceneDot, scene.active && styles.sceneDotActive, (!scene.active || !visited) && styles.sceneDotMuted]} /><View style={styles.sceneCopy}><Text style={styles.sceneName} selectable>{scene.name}</Text><Text style={styles.sceneMeta} selectable>{scene.area} · {scene.type}{scene.distanceMeters !== undefined ? ` · ${formatDistance(scene.distanceMeters)}` : ""}{sceneSourceSuffix(scene.source)}</Text><Text selectable style={styles.sceneSignal}>{sceneSignalLine({ savedCount: scene.savedCount, visitedCount: scene.visitedCount, plannedCount: scene.plannedCount, visited, saved, planned })}</Text></View><ProxyIcon color={color.muted} name="arrowUpRight" size={19} /></Pressable>;
}
function formatDistance(meters: number): string { return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`; }

// SCENE-CHECKIN-001: 声明时设备自报的与场景的距离。只用于**佐证**，不用于判定
// —— 服务端不会因为距离远就拒绝，也不会因为距离近就声称核实过本人在场。
function metersBetween(origin: { latitude: number; longitude: number }, scene: { latitude: number; longitude: number }): number {
  const earth = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(scene.latitude - origin.latitude);
  const dLng = toRad(scene.longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(origin.latitude)) * Math.cos(toRad(scene.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function DataRow({ label, value, last = false }: { label: string; value: string; last?: boolean }): React.JSX.Element {
  return <View style={[styles.dataRow, last && styles.dataRowLast]}><Text selectable style={styles.dataLabel}>{label}</Text><Text selectable style={styles.dataValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  topBar: { alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 6 },
  topCopy: { flex: 1 }, title: { color: color.ink, fontSize: 27, fontWeight: "900", lineHeight: 34 }, subtitle: { color: color.muted, fontSize: 12, marginTop: 1 },
  roundButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  stats: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 }, stat: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 9 }, statValue: { color: color.ink, fontSize: 19, fontWeight: "900" }, statLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  nearbyError: { color: color.error, fontSize: 12, marginBottom: 8, marginHorizontal: 16 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 8, marginHorizontal: 16, paddingHorizontal: 13 }, searchInput: { color: color.ink, flex: 1, fontSize: 15, height: 46 }, searchClose: { color: color.muted, fontSize: 20, paddingHorizontal: 4 },
  filterRail: { flexGrow: 0, height: 54, maxHeight: 54, minHeight: 54 },
  filters: { alignItems: "center", gap: 8, height: 54, paddingHorizontal: 16 }, filter: { alignItems: "center", alignSelf: "center", backgroundColor: color.surface, borderRadius: 18, height: 34, justifyContent: "center", paddingHorizontal: 15 }, filterActive: { backgroundColor: color.ink }, filterText: { color: color.muted, fontSize: 13, fontWeight: "700", lineHeight: 18 }, filterTextActive: { color: color.white },
  // MAP-CONTAINER-PARITY-001: 跟 Market 内联地图同容器语言 —— 底 offWhite、
  // 边框 line、圆角 22（foundation.radius.lg），横向顶边无间隙（无 marginHorizontal，
  // 跟 Market 地图视图一致；页内顶栏/统计/搜索保持 16 缩进）。全屏页保留 flex:1
  // 吃剩余高度，minHeight:330 保底与内联卡等高；position:relative 承接 privacyPill 悬浮。
  mapWrap: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 22, borderWidth: 1, flex: 1, minHeight: 330, overflow: "hidden", position: "relative" }, privacyPill: { alignSelf: "center", backgroundColor: "rgba(23,19,31,0.84)", borderRadius: 14, bottom: 12, paddingHorizontal: 12, paddingVertical: 7, position: "absolute" }, privacyText: { color: color.white, fontSize: 11, fontWeight: "700" },
  pinSheet: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, bottom: 48, left: 12, padding: 12, position: "absolute", right: 12 }, pinSheetCopy: { paddingRight: 30 }, pinSheetClose: { alignItems: "center", height: 30, justifyContent: "center", position: "absolute", right: 6, top: 6, width: 30 }, pinSheetCloseText: { color: color.muted, fontSize: 20, fontWeight: "700" }, pinSheetRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  // 供热开关：左上白 pill，生效反转为 ink 底（跟市场定位钮同语言）。
  heatToggle: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, height: 34, justifyContent: "center", left: 10, position: "absolute", top: 10, width: 34 },
  heatToggleOn: { backgroundColor: color.ink, borderColor: color.ink },
  locateBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", position: "absolute", right: 10, top: 10, width: 44 },
  locateBtnDisabled: { opacity: 0.45 },
  heatToggleText: { color: color.ink, fontSize: 14, fontWeight: "900" },
  heatToggleTextOn: { color: color.white, fontSize: 14, fontWeight: "900" },
  // SCENE-MAP-GESTURE-001: 详情盖层（不透明盖住整页，地图在下面常驻）。
  detailOverlay: { backgroundColor: color.offWhite, bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 },
  list: { flexGrow: 1, gap: 9, paddingBottom: 24, paddingHorizontal: 16 },
  listScroll: { flex: 1 }, checkInHint: { color: color.muted, flex: 1, fontSize: 11, lineHeight: 16 },
  badgeProgressBox: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 12 },
  badgeProgressTitle: { color: color.ink, fontSize: 12, fontWeight: "900" },
  badgeProgressRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  badgeProgressName: { color: color.ink, fontSize: 12, fontWeight: "700" },
  badgeProgressText: { color: color.muted, fontSize: 11, marginTop: 2 },
  // (社区提交样式已随 UI 整段撤下，commander 重做设计中。)
  sceneRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 82, padding: 14 }, sceneDot: { backgroundColor: color.violet, borderRadius: 9, height: 18, width: 18 }, sceneDotActive: { backgroundColor: color.magenta }, sceneDotMuted: { backgroundColor: color.muted }, sceneCopy: { flex: 1 }, sceneName: { color: color.ink, fontSize: 16, fontWeight: "800" }, sceneMeta: { color: color.muted, fontSize: 12, marginTop: 3 }, sceneSignal: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 5 }, empty: { color: color.muted, paddingTop: 40, textAlign: "center" },
  detailContent: { paddingBottom: 36, paddingHorizontal: 13 }, detailTop: { alignItems: "center", flexDirection: "row", minHeight: 56 }, backButton: { alignItems: "center", height: 38, justifyContent: "center", width: 38 }, detailTopCopy: { flex: 1 }, venueRow: { alignItems: "center", flexDirection: "row", gap: 10 }, venueLogo: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, height: 46, justifyContent: "center", width: 46 }, venueLogoText: { color: color.white, fontSize: 20, fontWeight: "900" }, venueCopy: { flex: 1 }, detailTopTitle: { color: color.ink, fontSize: 17, fontWeight: "900" }, detailTopSub: { color: color.muted, fontSize: 11, marginTop: 2 }, categoryBadge: { alignSelf: "flex-start", backgroundColor: color.violetSoftBg, borderRadius: 999, marginTop: 5, paddingHorizontal: 9, paddingVertical: 3 }, categoryBadgeText: { color: color.violet, fontSize: 11, fontWeight: "800" },   topSpacer: { width: 38 }, backText: { color: color.ink, fontSize: 24, fontWeight: "800", lineHeight: 28 }, hero: { backgroundColor: "#F6F2E9", borderColor: color.line, borderRadius: 20, borderWidth: 1, overflow: "hidden", padding: 15, paddingTop: 242 }, heroMap: { height: 226, left: 0, position: "absolute", right: 0, top: 0 }, statePill: { alignSelf: "flex-start", backgroundColor: color.surface, borderRadius: 14, marginTop: 4, paddingHorizontal: 10, paddingVertical: 6 }, statePillActive: { backgroundColor: color.attentionBg }, stateText: { color: color.muted, fontSize: 11, fontWeight: "800" }, stateTextActive: { color: color.error }, venueIntro: { color: color.muted, fontSize: 13, lineHeight: 20, marginTop: 8, paddingHorizontal: 2 }, sceneCounts: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  heroFacets: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 }, heroFacet: { backgroundColor: "#FFF3CB", borderColor: "#E4C35B", borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 }, heroFacetText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  aiBindingCard: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderColor: color.violet, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 14, padding: 13 }, aiBindingAvatar: { borderRadius: 30, height: 60, width: 60 }, aiBindingCopy: { flex: 1 }, aiBindingEyebrow: { color: color.violet, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 }, aiBindingTitle: { color: color.ink, fontSize: 14, fontWeight: "900", marginTop: 4 }, aiBindingText: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 5 }, aiProfileButton: { alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 12, marginTop: 9, paddingHorizontal: 12, paddingVertical: 8 }, aiProfileButtonText: { color: color.white, fontSize: 11, fontWeight: "900" },
  humanBindingCard: { alignItems: "center", backgroundColor: "#FFF8E3", borderColor: "#E4C35B", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 14, padding: 13 }, humanBindingEyebrow: { color: "#735700", fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  metrics: { flexDirection: "row", gap: 7, marginTop: 10 }, metric: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 11 }, metricValue: { color: color.ink, fontSize: 17, fontWeight: "900" }, metricLabel: { color: color.muted, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 }, action: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, paddingVertical: 13 }, actionSelected: { backgroundColor: color.proxyPurpleSoft }, actionText: { color: color.ink, fontSize: 13, fontWeight: "800" }, primaryAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, flex: 1, paddingVertical: 13 }, primaryActionText: { color: color.white, fontSize: 13, fontWeight: "800" },
  liveCard: { alignItems: "center", backgroundColor: color.attentionBg, borderRadius: 18, flexDirection: "row", justifyContent: "space-between", marginTop: 12, padding: 15 }, liveLabel: { color: color.error, fontSize: 13, fontWeight: "900" }, liveWindow: { color: color.ink, fontSize: 17, fontWeight: "900", marginTop: 3 }, capacity: { color: color.ink, fontSize: 13, fontWeight: "800" },
  variantRail: { gap: 9, paddingRight: 16 }, variantCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, minHeight: 116, padding: 13, width: 178 }, variantCardSelected: { backgroundColor: color.ink, borderColor: color.ink }, variantName: { color: color.ink, fontSize: 15, fontWeight: "900" }, variantNameSelected: { color: color.white }, variantWindow: { color: color.violet, fontSize: 12, fontWeight: "800", marginTop: 5 }, variantBest: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  variantPill: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 }, variantPillSelected: { backgroundColor: color.ink, borderColor: color.ink }, variantPillText: { color: color.ink, fontSize: 12, fontWeight: "700" }, variantPillTextSelected: { color: color.white }, bestGrid: { flexDirection: "row", gap: 9 }, bestCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 105, padding: 13 }, bestTitle: { color: color.ink, fontSize: 14, fontWeight: "900", lineHeight: 19 }, bestSub: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 7 },
  whyCard: { backgroundColor: "#FFF8E3", borderColor: "#E4C35B", borderRadius: 16, borderWidth: 1, marginTop: 9, padding: 13 }, whyTitle: { color: color.ink, fontSize: 13, fontWeight: "900" }, whyText: { color: color.ink, fontSize: 11, lineHeight: 17, marginTop: 5 }, whyBoundary: { borderTopColor: "#E8D99D", borderTopWidth: 1, color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 9, paddingTop: 8 },
  humanRail: { gap: 9, paddingRight: 16 }, humanPlain: { alignItems: "center", width: 84 }, humanRing: { borderColor: "transparent", borderRadius: 36, borderWidth: 2, padding: 2 }, humanRingSelected: { borderColor: color.violet }, humanAvatarFallback: { alignItems: "center", backgroundColor: color.proxyPurpleSoft, borderRadius: 32, height: 64, justifyContent: "center", width: 64 }, humanAvatarText: { color: color.violet, fontSize: 22, fontWeight: "900" }, humanPlainName: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 6, textAlign: "center" }, humanPlainSub: { color: color.ink, fontSize: 11, marginTop: 2, textAlign: "center" }, humanEmpty: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 2, paddingRight: 16 },
  sectionTitleRow: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" }, sectionLink: { color: "#735700", fontSize: 11, fontWeight: "700", marginBottom: 9 }, menuRail: { gap: 10, paddingRight: 16 }, menuCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, overflow: "hidden", paddingBottom: 10, width: 154 }, menuCardSelected: { borderColor: "#D7A600", borderWidth: 2 }, menuImage: { height: 104, width: "100%" }, menuName: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 9, paddingHorizontal: 10 }, menuFit: { color: color.muted, fontSize: 11, marginTop: 3, paddingHorizontal: 10 }, menuPrice: { color: color.ink, fontSize: 13, fontWeight: "900", marginTop: 7, paddingHorizontal: 10 },
  executionCard: { flexDirection: "row", gap: 7 }, executionAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 15, flex: 1, minHeight: 68, justifyContent: "center", paddingHorizontal: 5 }, executionActionSelected: { backgroundColor: color.violet }, executionLabel: { color: color.white, fontSize: 12, fontWeight: "900", textAlign: "center" }, executionState: { color: color.muted, fontSize: 11, marginTop: 5 }, boundaryCard: { backgroundColor: color.proxyPurpleSoft, borderRadius: 16, marginTop: 9, padding: 13 }, boundaryStrong: { color: color.ink, fontSize: 12, fontWeight: "800", lineHeight: 18 }, boundaryText: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 6 }, inviteAmountLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 12 }, inviteAmountRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 7 }, inviteAmountInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, color: color.ink, flex: 1, fontSize: 15, fontWeight: "900", minHeight: 44, paddingHorizontal: 12 }, inviteCurrency: { color: color.ink, fontSize: 12, fontWeight: "900" }, confirmAction: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, marginTop: 12, paddingVertical: 11 }, confirmActionText: { color: color.white, fontSize: 13, fontWeight: "900" }, actionResult: { color: color.ink, fontSize: 12, fontWeight: "700", lineHeight: 18, marginTop: 10 }, loadingDetail: { color: color.muted, fontSize: 12, paddingVertical: 22, textAlign: "center" }, activityEmpty: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 6 }, activityRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 8, paddingHorizontal: 12, paddingVertical: 11 }, activityInfo: { flex: 1 }, activityTitle: { color: color.ink, fontSize: 13, fontWeight: "800", lineHeight: 18 }, activityMeta: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, activityJoin: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 }, activityJoinDisabled: { backgroundColor: color.line }, activityJoinText: { color: color.white, fontSize: 12, fontWeight: "900" },
  sectionTitle: { color: color.ink, fontSize: 18, fontWeight: "900", marginBottom: 8, marginTop: 20 }, dataCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14 }, dataRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 }, dataRowLast: { borderBottomWidth: 0 }, dataLabel: { color: color.ink, fontSize: 13, fontWeight: "700" }, dataValue: { color: color.muted, fontSize: 13 }, memoryCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, padding: 14 }, memoryTitle: { color: color.ink, fontSize: 14, fontWeight: "900" }, memoryText: { color: color.muted, fontSize: 11, lineHeight: 18, marginTop: 7 },
  badgeNotice: { backgroundColor: "#FFF4E0", borderRadius: 12, marginHorizontal: 14, marginTop: 8, padding: 10 },
  badgeNoticeText: { color: "#7A4E0F", fontSize: 12, fontWeight: "700" },
  xiaomeiSceneHint: { color: "#5B3FA3", fontSize: 12, marginTop: 6 },
  badgeScrim: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "center", padding: 22 },
  badgeCard: { backgroundColor: "color.white", borderRadius: 18, maxHeight: "82%", padding: 18, width: "100%" },
  badgeTitle: { color: "color.ink", fontSize: 18, fontWeight: "900" },
  badgeSub: { color: "#77726B", fontSize: 12, lineHeight: 17, marginTop: 4 },
  badgeList: { marginTop: 10 },
  badgeRow: { alignItems: "center", borderBottomColor: "rgba(20,18,31,0.06)", borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 10 },
  badgeRowEarned: { backgroundColor: "#FFF8EC" },
  badgeIcon: { fontSize: 24 },
  badgeCopy: { flex: 1 },
  badgeName: { color: "color.ink", fontSize: 14, fontWeight: "800" },
  badgeNameLocked: { color: "#77726B", fontWeight: "700" },
  badgeDesc: { color: "#77726B", fontSize: 11, lineHeight: 15, marginTop: 2 },
  badgeShareCard: { backgroundColor: "#FFF8EC", borderColor: "#F0DFC0", borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 12 },
  badgeShareBrand: { color: "#7A4E0F", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  badgeShareCount: { color: "#17131F", fontSize: 15, fontWeight: "900", marginTop: 3 },
  badgeShareIcons: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badgeShareIcon: { fontSize: 22 },
  badgeShareIconLocked: { opacity: 0.28 },
  badgeShareBtn: { alignItems: "center", backgroundColor: "#F4F0FF", borderColor: "#E5DCF5", borderRadius: 999, borderWidth: 1, marginTop: 10, paddingVertical: 10 },
  badgeShareBtnText: { color: "#5B3FA3", fontSize: 13, fontWeight: "800" },
  studioRow: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 10 }, studioThumb: { borderRadius: 12, height: 56, width: 56 }, studioCopy: { flex: 1 }, studioName: { color: color.ink, fontSize: 13, fontWeight: "900", lineHeight: 18 }, studioSub: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, studioBtnDisabled: { backgroundColor: color.line, borderColor: color.line },
  badgeClose: { alignItems: "center", backgroundColor: "color.ink", borderRadius: 999, marginTop: 12, paddingVertical: 11 },
  badgeCloseText: { color: "color.white", fontSize: 13, fontWeight: "800" }
});

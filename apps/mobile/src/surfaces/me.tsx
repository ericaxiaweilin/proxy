// Me Surface：账户与 Active Context 切换（R15.12.7：One Account，
// Active Context = REQUESTER | BUSINESS，切换只改 Product State；
// 找人、接机会、开放能力、发活动都是行为，不是另一种身份）。
// R15.12.7 Market Map Parity Freeze：Market 路由行保持 dispatcher surface
// "TASKS" 契约（server 只知道 TASKS），shell 映射到市场 Tab。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html
// （renderRequesterMe / renderBusinessMe / contextline），
// 切换 Sheet 由 App Shell 共享渲染（ContextSwitcherSheet）。
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useModuleBackHandler } from "../components/module-back";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SwipeBackShell } from "../architecture/swipe-back";
import { useScrollChrome } from "../shell/scroll-chrome";
import { ProfileTabs } from "./ProfileTabs";
import { AIIdentityShowcaseSurface } from "./AIIdentityShowcaseSurface";
import { AIManagementSurface } from "./ai-management";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { ProxyQrCode } from "../components/proxy-qr-code";
import { QrZoomOverlay } from "../components/qr-zoom-overlay";
import { captureRef } from "react-native-view-shot";
import { Directory, File, Paths } from "expo-file-system";
import { buildContactCard } from "../profile-qr";
import { useScreenBrightness } from "../lib/screen-brightness";
import { saveImageToAlbum, toFileUrl } from "../image-export";
import { createProfileStore, avatarFileName, mergeRemoteProfile, type ProfileRecord } from "../profile-store";
import { deriveProfileFromIdentifier, NEUTRAL_PROFILE } from "../profile-identity";
import { createLastSignInStore } from "../last-signin-store";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import type { ExperienceAction, ExperienceMenuSection, FeedMediaItem, FeedPost, Memory, RegisteredExperienceRoute } from "@proxy/contracts";
import type { PersonaGalleryItem } from "../ai-persona-client";
import { ProxyIcon, ProxySymbolIcon } from "../components/proxy-icon";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { MerchantMeR21Replacement } from "./merchant-me-r21-replacement";
import { MerchantStorefrontSurface } from "./merchant-storefront";
import { StoreRecommendationQueue } from "./store-recommendation-queue";
import { CreatorInvitationCard } from "./creator-application";
import { FriendCrmSurface } from "./friend-crm";
import { AdaptiveMediaCollection, MediaViewer, SinglePostImage } from "./feed";
import { ThreadsPostMedia } from "../components/threads-post-media";
import { SecuritySettings } from "../components/security-settings";
import { PrivacySettings } from "../components/privacy-settings";
import { PreciseLocationCard } from "../components/precise-location-card";
import { resolveLocationConsentClient } from "../location-consent-client";
import { resolvePrivacyRequestClient } from "../privacy-client";
import type { FulfillmentClient, FulfillmentOrder } from "../fulfillment-client";
import type { EngagementClient } from "../engagement-client";
import type { ModerationClient } from "../moderation-client";
import { StoreOnboardingClient, StoreRecommendationAiUnavailableError } from "../storeonboarding-client";
// BENEFIT-WIRE-001: 权益链路。命令、client、界面早就写好了，但从没被渲染过 ——
// 这里补的是「入口 + 接线」那一段。
import { BenefitClient } from "../benefit-client";
import { BenefitHubSurface } from "./benefit-hub";
import { BenefitRedeemScreen } from "./BenefitRedeemScreen";
import { MyStoreRecommendations } from "./my-store-recommendations";
import { type LocalNetClient } from "../localnet-client";
import {
  parentPostIdsForReplies,
  replyEntriesFromReplies,
  replyTargetsFromPosts,
  type ReplyEntry,
  type ReplyTarget
} from "../reply-target";
import { filterPostsByFeedSearch, normalizeFeedSearchQuery } from "../feed-search";
import { meOwnedRouteForLabel } from "../me-owned-routes";
import { color, Gradient, shadows } from "../theme";
import type { ActiveContext } from "../uiplan/types";
import { SceneClient } from "../scene-client";
import type { MyScene, MySceneInvitation } from "../scene-client";
import { SCENE_BADGES, badgeProgress } from "../scene-badges";
import type { BusinessClient } from "../business-client";
import type { ActivityClient } from "../activity-client";
import type { ProfileClient } from "../profile-client";
import type { SessionClient } from "../session-client";
import type { MediaClient } from "../media-client";
import type { RelationshipClient } from "../relationship-client";
import type { SocialSettingsClient } from "../social-settings-client";
import type { SupplyClient } from "../supply-client";
import { FacetHomeSurface } from "../facet/FacetHomeSurface";
import { FacetClient } from "../facet-client";
import { sessionAuthClient, localApiBaseUrl, nativeSecureSessionStore, nativeTransport } from "../native-clients";
import { createSocialSettingsStore } from "../social-settings-store";
import { createBehaviorAnalyticsStore } from "../behavior-analytics-settings";

// Extracted modules
import type { MeSubPage, AvailabilityState, EnterpriseOpsStage, MenuRow, MenuSection, PersonalHubTab, SocialVisibility, SocialAccount, AbilityType, AbilityInstance, AvailabilityRule, AvOverride } from "./me-types";
import { ABILITY_SCHEMAS, DEFAULT_ABILITIES, AVAILABILITY_OPTIONS, AV_DAY_NAMES, avKeyOf, avFmt, describeAvRule, avStateFor, nextDays, INITIAL_SOCIAL_ACCOUNTS, resolveHubProfile, resolveHubSocials } from "./me-types";
import { AbilitySheet, AvRuleSheet, AvDaySheet, FakeQr, QrCard, SocialRow, AvailabilitySheet, MeLocationContext, VoucherMenuGlyph, ServiceRow, availabilityLabel, formatClaimNumber } from "./me-profile-components";
import { MyOrdersSurface, MyActivitiesSurface, FavoritesSurface, MerchantCampaignSurface } from "./me-orders";
// SCENE-FAVORITE-002：个人主页的收藏 tab 也要显示场景 🤍 —— 与「我的 → 收藏」
// 读同一个本机 store、用同一份解析（resolveSavedSceneIds），不各写一遍。
import { createSceneFavoritesStore, resolveSavedSceneIds, type SavedSceneEntry } from "../scene-favorites";
import { savedSceneLookup } from "../components/scene-activity-discovery";
import { SUB_PAGE_CONTENT, meSubPage } from "./me-sub-pages";
import { useMerchantIdentity } from "../use-merchant-identity";
import { styles } from "./me-styles";

const OTTER_LOGO = require("../../assets/otter-logo.png");

const lastSignInStore = createLastSignInStore(nativeSecureStorageDriver);
const socialSettingsStore = createSocialSettingsStore(nativeSecureStorageDriver);
const behaviorAnalyticsStore = createBehaviorAnalyticsStore(nativeSecureStorageDriver);

const PROFILE_AVATAR_DIR = new Directory(Paths.document, "proxy-profile");
function avatarScope(accountId?: string): string {
  const normalized = (accountId ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(-48);
  return normalized || "anonymous";
}

function nextProfileAvatarFile(accountId?: string): File {
  return new File(PROFILE_AVATAR_DIR, `avatar-${avatarScope(accountId)}-${Date.now()}.jpg`);
}

// AVATAR-FLASH-001: 首帧就给出本机最新头像。hydration 是异步的，若首帧
// profileAvatarUri 为 undefined，会先渲染字母头/占位再被异步结果刷掉——用户看到的
// 就是「切页回来先闪旧头再变新头」。expo-file-system 的 list()/File 是同步 API，
// 因此可以在 useState 初值里直接取到最新副本，消除这一跳。
function initialProfileAvatarUri(accountId?: string): string | undefined {
  try {
    // 注意：不要用 `instanceof File` 过滤 list() 元素（真机上类身份可能对不上，
    // 一旦滤空就回落字母头，等于没修）。与 hydration 同款：只信 name。
    const names = PROFILE_AVATAR_DIR.list()
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(`avatar-${avatarScope(accountId)}-`))
      .sort();
    const newest = names.at(-1);
    return newest ? new File(PROFILE_AVATAR_DIR, newest).uri : undefined;
  } catch {
    return undefined;
  }
}

// AVATAR-GC-001: 换头像只留最新一份副本。此前每次选图都新建 avatar-<ts>.jpg，
// 只增不删（真机实测堆到 23 份）。prune 只删 avatar-* 且不是本次保留的那份，
// 单个删除失败不影响主链。
function pruneProfileAvatars(keepName: string, accountId?: string): void {
  try {
    for (const name of PROFILE_AVATAR_DIR.list().map((entry) => entry.name)) {
      if (name.startsWith(`avatar-${avatarScope(accountId)}-`) && name !== keepName) {
        try {
          new File(PROFILE_AVATAR_DIR, name).delete();
        } catch {
          // 单个文件删除失败（被占用等）不阻塞换头像。
        }
      }
    }
  } catch {
    // 目录不可读：跳过清理，不影响本次换头像。
  }
}

interface PersonaConfig {
  pageTitle: string;
  avatarText: string;
  avatarGrad: boolean;
  name: string;
  desc: string;
  identityActionLabel: string;
  identityActionSwitch: boolean;
  sections: MenuSection[];
  contextLineLabel: string;
  contextLineAction: string;
  settingsRow?: MenuRow;
  profileCard?: { route: string; status: string; social: string[] };
  alert?: { icon: string; title: string; desc: string; route: string; tag: string };
}

const REQUESTER_ME: PersonaConfig = {
  pageTitle: "我的",
  avatarText: "H",
  avatarGrad: false,
  name: "Huyen",
  desc: "河内 · 个人身份",
  identityActionLabel: "切换身份",
  identityActionSwitch: true,
  profileCard: {
    route: "personalmanage",
    status: "● 可接单",
    social: ["TT", "Z", "IG", "in"]
  },
  contextLineLabel: "当前身份 · 用户",
  contextLineAction: "切换为商家",
  sections: [
    {
      id: "personal_profile",
      title: "个人管理",
      hint: "基本信息、二维码、状态管理在一个页里",
      rows: [
        { icon: "profile-ring", label: "个人管理", desc: "基本信息 · 二维码 · 状态管理 (可接单)", grad: true, route: "personalmanage" },
        { icon: "profile-ring", label: "个人主页", desc: "对外展示 · Threads R2 · 名片、动态、能力、可用时间", route: "personalhub" },
        { icon: "arrow-up-right", label: "社媒与联系", desc: "TikTok、Zalo、Instagram 与可见范围", route: "socialidentity" },
        { icon: "route", label: "访问与转化", desc: "渠道 → 主页 → 聊天 → 订单", route: "socialanalytics" }
      ]
    },
    {
      id: "my_market",
      title: "我的市场",
      hint: "个人资产",
      rows: [
        { icon: "◎", label: "我的场景", desc: "R15.13 · 我发起的 Scene 与收到的邀请", route: "myscenes" },
        { icon: "diamond", label: "我的订单", desc: "我发布的 / 我参与的已成交订单", route: "myorders" },
        { icon: "clock", label: "能力与可用时间", desc: "能力、主题、区域与空闲时间", route: "available" },
        { icon: "ring", label: "我的活动", desc: "已参加 / 我发起的活动", route: "myactivities" },
        { icon: "star", label: "收藏", desc: "场景灵感、商家、Creator、动态与活动", route: "favorites" },
        { icon: "gift", label: "我的权益", desc: "可领取的活动权益，领取后到店出示验证码核销", route: "benefits" }
      ]
    },
    {
      id: "biz",
      title: "企业 / 店铺",
      hint: "经营与体系共建 · 独立模块（原始设计：发展 builder，小美与用户推荐商铺进入体系）",
      rows: [
        { icon: "store-lines", label: "我的企业 / 店铺", desc: "有经营权限时进入 Business Workspace", route: "bdash" },
        { icon: "spark", label: "推荐商铺进体系", desc: "把好的场地 / 商家推荐给 Proxy 平台，运营评估后接入", route: "recommendstore" },
        // STORE-REC-007: 推荐完就没有回音了 —— 推荐人看不到自己那条被采纳了没有，
        // 而能完成入驻的人通常就是他。队列是运营专属的，这一条是给推荐人自己的。
        { icon: "ring", label: "我推荐的店", desc: "查看我推荐的店铺现在什么状态，被采纳后去建店", route: "mystorerecs" },
        { icon: "target", label: "推荐评估队列", desc: "运营查看用户与小美推荐进体系的商铺（需运营权限）", route: "storerecqueue" }
      ]
    },
    {
      id: "account",
      title: "账户",
      hint: "安全与结算",
      rows: [
        { icon: "coin", label: "钱包与结算", desc: "付款、收入、退款与记录", route: "wallet" },
        { icon: "ai-manage", label: "AI 管理", desc: "分身状态 · 照片与动态盘点", route: "aimanage" },
        { icon: "gear", label: "设置与隐私", desc: "安全、推荐、通知与隐私（含数据下载/删除）", route: "appbehavior" }
      ]
    },
    // AI-FACET-CLUSTER-001: 好友与关系（谁）→ AI 分身（生成照片/视频素材）→
    // FACET（把同一份素材按关系对象重新组织、决定谁看到什么）是一条链路——
    // FACET 的"对象"本来就是关系图里的人，以前三个入口分散在三处（关系单独
    // 一段、AI 分身埋在"个人主页 → 更多 → 主页设置"三层深、FACET 单独一段），
    // 互相不知道对方存在。合并成一段，按链路顺序排。
    // 闭环三段式，各管各的、别越界：AI 分身出内容（照片/视频），FACET
    // 只管投放（同一份内容投给谁），好友与关系管运营（关系图、标签、互动
    // 记录 —— 决定下一轮该给谁投什么）。三段顺序按闭环走：运营 → 生成 → 投放。
    {
      id: "identity_content",
      title: "关系与内容",
      hint: "好友与关系管运营 · AI 分身出内容 · FACET 管投放",
      rows: [
        { icon: "target", label: "好友与关系", desc: "运营关系图 · 标签、备注、来源与互动记录", grad: true, route: "friendcrm" },
        { icon: "aiPersona", label: "AI分身", desc: "用你授权的形象生成照片、视频内容", route: "aiidentity" },
        { icon: "facet-logo", label: "FACET", desc: "同一份内容，按关系对象投放给谁看", route: "facet" }
      ]
    }
  ]
};

const BUSINESS_ME: PersonaConfig = {
  pageTitle: "我的企业",
  avatarText: "B",
  avatarGrad: false,
  name: "Bonsaidon",
  desc: "Business Principal · 当前你有经营权限",
  identityActionLabel: "主体",
  identityActionSwitch: false,
  contextLineLabel: "当前使用 · Bonsaidon",
  contextLineAction: "切换身份",
  settingsRow: { icon: "P", label: "Proxy 中心", desc: "应用状态、主体权限与业务工作区", route: "bdash" },
  sections: [
    {
      title: "关系",
      hint: "真人网络 · 个人轻 CRM 关系图",
      rows: [
        { icon: "target", label: "好友与关系", desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录", grad: true, route: "friendcrm" }
      ]
    },
    {
      title: "商家 · 我的",
      hint: "业务资产",
      rows: [
        { icon: "◎", label: "Creator 经营", desc: "功能预览 · 实时数据待接入", grad: true, route: "trustedteam" },
        { icon: "券", label: "券", desc: "查看真实券状态", route: "vouchers" },
        { icon: "↗", label: "活动导流", desc: "商家活动 · 可报名", route: "merchantcampaign" },
        { icon: "▤", label: "线上店铺", desc: "实时数据已接入", grad: true, route: "merchantstorefront" },
        { icon: "₫", label: "销售中心", desc: "功能预览 · 实时数据待接入", route: "outcomehistory" },
        { icon: "✦", label: "经营", desc: "功能预览 · 实时数据待接入", route: "enterpriseops" },
        // STORE-REC-002/004: 评估队列对 BUSINESS 身份也要可达 —— 运营更可能挂在这个
        // 身份下，而此前入口只挂在 REQUESTER 的「企业 / 店铺」组里。
        // 队列本身是 operator-only（服务端白名单），普通商家点进去会看到明确的
        // 「没有运营权限」，而不是一个空列表。
        { icon: "target", label: "推荐评估队列", desc: "运营查看用户与小美推荐进体系的商铺（需运营权限）", route: "storerecqueue" },
        // BENEFIT-WIRE-001: 商家侧核销。需要店铺主体，没有主体时子页会说清楚，
        // 而不是塞一个空 merchantId 让核销必然失败。
        { icon: "gift", label: "权益核销", desc: "扫描用户出示的权益验证码并确认核销", route: "benefitredeem" }
      ]
    }
  ]
};

const PERSONA: Record<ActiveContext, PersonaConfig> = {
  REQUESTER: REQUESTER_ME,
  BUSINESS: BUSINESS_ME
};

function toManagedMenuSections(sections: ExperienceMenuSection[]): MenuSection[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    hint: section.hint ?? "",
    rows: section.items.map((item) => ({
      icon: item.icon,
      label: item.label,
      desc: item.description,
      action: item.action,
      ...(item.accent !== undefined ? { grad: item.accent } : {})
    }))
  }));
}

// SEARCH-CORPUS-002：个人主页搜索的命中项。这一屏的数据域有两种东西 ——
// 帖子和回复，所以命中项是一个联合，UI 要把「这是帖子还是回复」显示出来，
// 不能把回复假装成帖子。postId 对回复来说是**父帖** id：点开就打开它所在的那条帖子。
type ProfileSearchHit = {
  kind: "post" | "reply";
  postId: string;
  body: string;
};

export function MeSurface({
  context,
  localNet,
  fulfillment,
  experienceSections,
  experienceMode,
  onOpenSwitcher,
  onOpenFeed,
  onOpenVouchers,
  onOpenRealitySceneMap,
  onExperienceAction,
  onOpenConversation,
  onSignOut,
  onChromeVisibilityChange,
  onSubPageOpenChange,
  bottomNavVisible,
  scene,
  business,
  supply,
  activities,
  engagement,
  viewerAccountId,
  socialSettingsClient,
  profileClient,
  sessionClient,
  mediaClient,
  relationshipClient,
  // COMP-REPORT-002: 举报入口，透传到「我的订单」（举报交易）。
  moderation,
  // ADD-FRIEND-FROM-MESSAGES-001: 跨模块入口（信息 → 添加好友）要能在 Me 页
  // 打开时直接落到某个子页。调用方给请求，本页消费后回调清掉。
  requestedSubPage,
  onRequestedSubPageConsumed,
}: {
  context: ActiveContext;
  localNet: LocalNetClient;
  fulfillment: FulfillmentClient;
  experienceSections?: ExperienceMenuSection[];
  experienceMode?: "MERGE" | "REPLACE";
  onOpenSwitcher: () => void;
  onOpenFeed: () => void;
  onOpenVouchers: () => void;
  onOpenRealitySceneMap?: (() => void) | undefined;
  onExperienceAction: (action: ExperienceAction) => void;
  onOpenConversation?: (author: string, peerUserId?: string) => void;
  onSignOut: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  /** BRAND-CHROME-L1-001: 子页（个人主页等）是盖住整个 body 的目的地，不是
   * 「我的」根页的一部分 —— 品牌 logo/字标和底部 tab bar 只属于 1 级模块，
   * 子页打开时必须通知外壳收起，否则子页自己的返回箭头 + 顶栏跟外壳的品牌
   * 顶栏重叠。见 subPage 的 useEffect。 */
  onSubPageOpenChange?: (open: boolean) => void;
  bottomNavVisible?: boolean;
  scene?: SceneClient;
  business?: BusinessClient;
  supply?: SupplyClient;
  profileClient?: ProfileClient | undefined;
  // DEVICE-LIST-001: 设置页设备管理读真会话列表。调用方（shell）必传；
  // 缺省时卡片如实显示未接线，不画假列表。
  sessionClient?: SessionClient | undefined;
  mediaClient?: MediaClient | undefined;
  relationshipClient?: RelationshipClient | undefined;
  activities?: ActivityClient | undefined;
  engagement?: EngagementClient;
  viewerAccountId?: string | undefined;
  socialSettingsClient?: SocialSettingsClient | undefined;
  moderation: ModerationClient;
  // 这里曾声明过一个全站搜索回调（(query: string) => void）：全仓库没有任何
  // 调用方传它，本组件也没有任何地方读它 —— 纯粹的声明，不是半截接线。
  // 已删。全站搜索真要做时，入口和消费者一起进来，不留空壳 prop。
  /** 外部请求打开的子页（跨模块入口）。undefined = 没有请求。 */
  requestedSubPage?: MeSubPage;
  /** 请求已被消费：调用方必须清掉它，否则重进 Me 会又弹回子页。 */
  onRequestedSubPageConsumed?: (() => void) | undefined;
}): React.JSX.Element {
  // PROFILE-READ-001: profile storage is scoped per account. The module
  // singleton cannot be used: two accounts on one device must never share
  // a name/handle.
  const profileStore = useMemo(
    () => createProfileStore(nativeSecureStorageDriver, viewerAccountId),
    [viewerAccountId]
  );
  const [subPage, setSubPage] = useState<MeSubPage>();
  // BRAND-CHROME-L1-001: 子页打开/关闭都要让外壳知道 —— 卸载时（切走 tab）
  // 也要把标记还原，否则外壳收着品牌顶栏走到别的 tab。
  useEffect(() => {
    onSubPageOpenChange?.(subPage !== undefined);
    return () => onSubPageOpenChange?.(false);
  }, [subPage, onSubPageOpenChange]);
  // 消费外部请求。MeSurface 在切走 tab 时会被卸载，所以这里用「请求 + 消费」
  // 而不是「初始值」：消费后调用方清空请求，下次重进 Me 不会又弹回子页。
  useEffect(() => {
    if (!requestedSubPage) return;
    setSubPage(requestedSubPage);
    onRequestedSubPageConsumed?.();
  }, [requestedSubPage, onRequestedSubPageConsumed]);
  // PROFILE-QR-005：关闭子页这件事以前在 20 多个地方各写一遍
  // `setSubPage(undefined)` —— 一律甩回「我的」根页。二维码页可以从
  // 「个人管理」或「我的企业/店铺」进来，返回就得回到那一页，不然
  // 点进去再返回等于被人踢回主页。没有 backRoute 的行为完全不变。
  function closeSubPage(): void {
    const parent = subPage?.backRoute ? meSubPage(subPage.backRoute) : undefined;
    setSubPage(parent);
  }
  useModuleBackHandler(subPage ? () => { closeSubPage(); return true; } : undefined);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [myScenes, setMyScenes] = useState<MyScene[]>([]);
  const [myInvitations, setMyInvitations] = useState<MySceneInvitation[]>([]);
  const [invitationBusyId, setInvitationBusyId] = useState<string>();
  const [invitationError, setInvitationError] = useState<string | undefined>(undefined);
  const [memoriesLoadState, setMemoriesLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  useEffect(() => {
    if (subPage?.route !== "myscenes" || !scene) return;
    let cancelled = false;
    setMemoriesLoadState("loading");
    Promise.all([scene.listMyMemories(), scene.listMyScenes(), scene.listMyInvitations()])
      .then(([memoryRows, sceneRows, invitationRows]) => { if (!cancelled) { setMemories(memoryRows); setMyScenes(sceneRows); setMyInvitations(invitationRows); setMemoriesLoadState("loaded"); } })
      .catch(() => { if (!cancelled) { setMemories([]); setMyScenes([]); setMyInvitations([]); setMemoriesLoadState("error"); } });
    return () => { cancelled = true; };
  }, [subPage?.route, scene]);
  const [passportError, setPassportError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!supply) return;
    let cancelled = false;
    supply.getAgentPassport().then((p) => {
      if (cancelled) return;
      const capMap: Record<string, AbilityType> = { PHOTOGRAPHY: "拍照", ZH: "翻译", VI: "翻译", EN: "翻译" };
      const seen = new Map<AbilityType, { verified: boolean }>();
      for (const c of p.capabilities ?? []) {
        const t = capMap[c.capability];
        if (!t) continue;
        const cur = seen.get(t);
        seen.set(t, { verified: (cur?.verified ?? false) || !!c.verified });
      }
      if (seen.size > 0) {
        setAbilities((prev) => prev.map((item) => {
          const v = seen.get(item.type);
          if (!v) return item;
          const hasBadge = v.verified && !(item.note ?? "").includes("已核验");
          return hasBadge ? { ...item, note: item.note ? `${item.note} · 已核验` : "已核验" } : item;
        }));
      }
      if ((p.availability?.length ?? 0) > 0) setAvailability("AVAILABLE");
    }).catch((e) => { if (!cancelled) setPassportError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [supply]);
  const [availability, setAvailability] = useState<AvailabilityState>("AVAILABLE");
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [enterpriseOpsStage, setEnterpriseOpsStage] = useState<EnterpriseOpsStage>("READY");
  // R18.x BDASH-SHOP-001: the bdash (企业 / 店铺资料) hero
  // used to render the hardcoded "Bonsaidon" + "海鲜自助 ·
  // 河内 · 主体已验证" stat. The verified stat is fabricated;
  // the shop name is whatever the user actually owns on the
  // server. Pull the live accounts via useMerchantIdentity
  // (the same hook tasks.tsx / market.tsx use) and prefer
  // the first ACTIVE account for the hero. If the user has
  // no shop yet, fall back to the persona name + drop the
  // fake verified badge entirely.
  const merchantIdentity = useMerchantIdentity();
  const liveShopName = merchantIdentity.accounts[0]?.name;
  // 商家二维码要指向真实门店主体：优先用户显式选中的商家，否则用第一个 ACTIVE
  // 店铺（与 liveShopName 同一个账号，避免名字显示店铺、二维码却指向个人主页）。
  const merchantId = merchantIdentity.merchantId ?? merchantIdentity.accounts[0]?.id;
  // BENEFIT-WIRE-001: 权益 client。构造只吃 authClient，会话从 transport 里走。
  const [benefitClient] = useState(() => new BenefitClient({ authClient: sessionAuthClient }));
  // 现实资料：之前两个按钮只 count+1，素材数组写死 3 项，超限后点按无变化、
  // 也从不打开 picker。现在存真实条目（label+uri），拍照/上传都走 ImagePicker，
  // 列表随条目增长，无静默上限。
  const [enterpriseAssets, setEnterpriseAssets] = useState<Array<{ label: string; uri?: string }>>([
    { label: "店门" },
    { label: "菜单" },
    { label: "品牌资料" },
  ]);
  const [enterpriseAssetError, setEnterpriseAssetError] = useState<string | undefined>(undefined);
  async function addEnterpriseAsset(kind: "photo" | "file"): Promise<void> {
    setEnterpriseAssetError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setEnterpriseAssetError(kind === "photo" ? "请允许 Proxy 使用相机/照片才能拍店铺。" : "请允许 Proxy 读取照片才能上传文件。");
      return;
    }
    const result = kind === "photo"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset?.uri) return;
    setEnterpriseAssets((prev) => [...prev, { label: kind === "photo" ? `实拍 ${prev.length + 1}` : `文件 ${prev.length + 1}`, uri: asset.uri }]);
  }
  const [abilities, setAbilities] = useState<AbilityInstance[]>(DEFAULT_ABILITIES);
  const [abilitySheet, setAbilitySheet] = useState<{ mode: "ADD" | "EDIT"; type: AbilityType; id?: string }>();
  const [availabilityPanel, setAvailabilityPanel] = useState<"ABILITIES" | "CALENDAR">("ABILITIES");
  const [avRule, setAvRule] = useState<AvailabilityRule>({ days: [0, 1, 2, 3, 4, 5, 6], start: 18, end: 23 });
  const [avOverrides, setAvOverrides] = useState<Record<string, AvOverride>>({
    "2026-08-27": { type: "off" },
    "2026-08-30": { type: "full" },
    "2026-09-03": { type: "custom", start: 19, end: 22 }
  });
  const [avRuleSheetOpen, setAvRuleSheetOpen] = useState(false);
  const [avDaySheet, setAvDaySheet] = useState<{ key: string; label: string }>();
  const [personalHubTab, setPersonalHubTab] = useState<PersonalHubTab>("FEED");
  const [insightsSheetOpen, setInsightsSheetOpen] = useState(false);
  // ANALYTICS-ME-001：分析弹层数字 —— 浏览（近 30 天主页访问）+ 互动（近 30 天
  // 收到的赞 + 评论，自赞/自评已在服务端排除）。打开弹层才拉；undefined = 未知
  // 画 —，不画 0（跟 dash 口径一致：没拉到不是没有）。
  const [profileAnalytics, setProfileAnalytics] = useState<{ opens: number | undefined; interactions: number | undefined }>({ opens: undefined, interactions: undefined });
  useEffect(() => {
    if (!insightsSheetOpen || !engagement) return;
    let cancelled = false;
    void (async () => {
      try {
        const [views, received] = await Promise.all([
          localNet.listProfileViewStats(30),
          engagement.getReceivedEngagementStats(),
        ]);
        if (!cancelled) setProfileAnalytics({ opens: views.opens, interactions: received.reactions + received.replies });
      } catch {
        if (!cancelled) setProfileAnalytics({ opens: undefined, interactions: undefined });
      }
    })();
    return () => { cancelled = true; };
  }, [insightsSheetOpen, localNet, engagement]);
  // PROFILE-VIEWS-HEADER-001（P0，2026-09-24）：个人主页头部「— 次浏览 · 最近 30 天」以前是写死的 —，从没接数据。
  // 打开个人主页就拉近 30 天主页访问次数（服务端 ListProfileViewStats sinceDays=30）；拉不到仍显示 —，不画 0。
  const [personalViews30, setPersonalViews30] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (subPage?.route !== "personalhub") return;
    let cancelled = false;
    localNet.listProfileViewStats(30)
      .then((stats) => { if (!cancelled) setPersonalViews30(stats.opens); })
      .catch(() => { if (!cancelled) setPersonalViews30(undefined); });
    return () => { cancelled = true; };
  }, [subPage?.route, localNet]);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // 搜索浮条定位：顶栏高 46 + 上内边距 7，浮条贴在顶栏下方 8px 处。
  const searchInsets = useSafeAreaInsets();
  const profileSearchInputRef = useRef<TextInput>(null);
  // 个人资料编辑器是 render 函数（不是组件）：personalmanage / personalhub /
  // 根页三个分支是 early return，Modal 只放在根分支里等于总管理页和主页里
  // 点开也没挂载 —— 点了没反应的根因。三处都调这一份。
  function renderProfileEditor(): React.JSX.Element {
    return (
      <Modal animationType="slide" onRequestClose={() => setProfileEditorOpen(false)} transparent visible={profileEditorOpen}>
        <View style={styles.profileEditorOverlay}>
          <View style={styles.profileEditorSheet}>
            <View style={styles.profileEditorHead}><Text selectable style={styles.profileEditorTitle}>编辑主页</Text><Pressable onPress={() => void saveProfile()}><Text selectable style={styles.profileEditorDone}>完成</Text></Pressable></View>
            {profileSaveError ? <Text selectable style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{profileSaveError}</Text> : null}
            <Pressable onPress={() => void chooseProfileAvatar()} style={styles.profileEditorAvatarRow}>
              <Image source={profileAvatarUri ? { uri: profileAvatarUri } : OTTER_LOGO} style={styles.profileEditorAvatar} />
              <View><Text selectable style={styles.profileEditorAvatarTitle}>更换头像</Text><Text selectable style={styles.profileEditorAvatarHint}>从之前发布或手机相册选择</Text></View>
            </Pressable>
            {([['name', '显示名称'], ['handle', '用户名'], ['bio', '一句话介绍'], ['city', '城市']] as const).map(([key, label]) => (
              <View key={key} style={styles.profileEditorField}><Text selectable style={styles.profileEditorLabel}>{label}</Text><TextInput onChangeText={(value) => setProfileDraft((current) => ({ ...current, [key]: value }))} style={styles.profileEditorInput} value={profileDraft[key]} /></View>
            ))}
            {/* AGENT-CLAIM-NUMBER-001: 接单编号——系统按注册顺序分配，只读；
                仅可接单（AVAILABLE）时展示，不接单整行隐藏，无手动开关。 */}
            {availability === "AVAILABLE" && formatClaimNumber(claimNumber) !== "" ? (
              <View style={styles.profileEditorField}>
                <Text selectable style={styles.profileEditorLabel}>接单编号</Text>
                <Text selectable style={styles.profileEditorClaimNumber}>{formatClaimNumber(claimNumber)}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    );
  }
  function closeProfileSearch(): void {
    setSearchSheetOpen(false);
    setSearchQuery("");
    setProfileSearchResults(undefined);
  }
  // MODAL-HANDOFF-001: 关一个 Modal 的同一 tick 再开另一个，后开的会被吃掉
  // （iOS present 冲突），表现就是"点了没反应"。统一走这个 helper：先关，
  // 等关闭动画走完（~350ms）再开。调用处不要自己再 set 开。
  const pendingModalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    if (pendingModalTimer.current) clearTimeout(pendingModalTimer.current);
  }, []);
  function cancelPendingModal(): void {
    if (pendingModalTimer.current) {
      clearTimeout(pendingModalTimer.current);
      pendingModalTimer.current = undefined;
    }
  }
  function openModalAfterClose(close: () => void, open: () => void): void {
    close();
    cancelPendingModal();
    pendingModalTimer.current = setTimeout(() => {
      pendingModalTimer.current = undefined;
      open();
    }, 350);
  }
  // SEARCH-CORPUS-002：这一屏**有什么数据域就搜什么** —— 个人主页的数据域是
  // 「我的动态」（正文 / 作者展示名 / 城市）+「我的回复」（正文 / 被回复那条的作者）。
  //
  // 以前只滤 `post.body`：同一份数据在**动态流**里能按作者名和城市搜到
  // （SEARCH-CORPUS-001，feed-search.ts 与 Go 的 postMatchesSearch 同一套字段语义），
  // 到了主页这一屏却搜不到，等于同一份数据两套口径。回复更是完全搜不到。
  // 所以这里复用 feed-search 那份**共享字段语义**，不另写一份。
  const [profileSearchResults, setProfileSearchResults] = useState<ProfileSearchHit[] | undefined>(undefined);
  function runProfileSearch(query: string): void {
    const q = normalizeFeedSearchQuery(query);
    // 极简搜索：空查询 = 无结果态（不保留上一次的结果）。
    if (!q) {
      setProfileSearchResults(undefined);
      return;
    }
    // AI-TWIN-POST-AUDIENCE-004: 主页搜索只搜主页展示的帖子，不搜「帖文
    // 编排」私密副空间的 TARGETED 帖子——否则搜索结果会泄露主页列表里
    // 看不到的私密帖子存在。
    const searchablePosts = profilePosts.filter((post) => post.visibility !== "TARGETED");
    const posts: ProfileSearchHit[] = filterPostsByFeedSearch(searchablePosts, q).map((post) => ({
      kind: "post",
      postId: post.postId,
      body: post.body
    }));
    const replies: ProfileSearchHit[] = personalReplyEntries
      .filter((reply) => replyMatchesProfileSearch(reply, q))
      .map((reply) => ({
        kind: "reply",
        postId: reply.parentPostId,
        body: reply.body
      }));
    // 回复挂在父帖下面，所以同一条父帖可能既命中正文又命中回复 —— 不去重，
    // 两条都是真的命中，用户点哪条都直接打开那一条所在的帖子。
    setProfileSearchResults([...posts, ...replies]);
  }
  /** 回复的可搜字段：回复正文，加上**被回复那条**的作者展示名（父子都在这屏的数据域里）。 */
  function replyMatchesProfileSearch(reply: ReplyEntry, loweredQuery: string): boolean {
    if (reply.body.toLowerCase().includes(loweredQuery)) return true;
    const parentName = personalReplyTargets[reply.parentPostId]?.authorDisplayName;
    return Boolean(parentName && parentName.toLowerCase().includes(loweredQuery));
  }
  // REPLY-TARGET-001: 回复有自己的形状（replyId 才是稳定 key），不再伪装成
  // FeedPost；被回复的父帖另放一张表，查不到就是缺项。
  // 主页设置弹窗：编辑/分享入口（主页本体 tabs 上方不再重复摆）。
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [personalReplyEntries, setPersonalReplyEntries] = useState<ReplyEntry[]>([]);
  const [personalReplyTargets, setPersonalReplyTargets] = useState<Record<string, ReplyTarget>>({});
  const [personalSavedPosts, setPersonalSavedPosts] = useState<FeedPost[]>([]);
  // SCENE-FAVORITE-002：首页场景卡片的 🤍（本机按账号存）。个人主页收藏 tab 以前
  // 只认服务端帖子收藏 ⇒ 用户在首页点过 🤍，来这里看到的是「还没有收藏」。
  const [personalSavedScenes, setPersonalSavedScenes] = useState<readonly SavedSceneEntry[]>([]);
  const [personalTaggedPosts, setPersonalTaggedPosts] = useState<FeedPost[]>([]);
  // PROFILE-TAB-LOAD-FAILED-001: 收藏 / 回复 / 提及 的**加载成败**。以前失败时只把
  // 数组 set 成 []，空数组在 ProfileTabs 里渲染成「你还没有这类内容」—— 用户
  // 看到的是「我的东西没了」，而不是「没读出来」。
  const [personalSavedFailed, setPersonalSavedFailed] = useState(false);
  const [personalRepliesFailed, setPersonalRepliesFailed] = useState(false);
  const [personalTaggedFailed, setPersonalTaggedFailed] = useState(false);
  const [personalPinnedIds, setPersonalPinnedIds] = useState<ReadonlyArray<string>>([]);
  const [likeError, setLikeError] = useState<string | undefined>(undefined);
  const [personalFollowCounts, setPersonalFollowCounts] = useState<{ followers: number; following: number } | undefined>(undefined);
  const viewingProfileId = viewerAccountId;
  const isSelfProfile = true;
  useEffect(() => {
    if (!engagement || !viewingProfileId) return;
    let cancelled = false;
    engagement.getFollowCounts(viewingProfileId)
      .then((c) => { if (!cancelled) setPersonalFollowCounts({ followers: c.followers, following: c.following }); })
      // 失败保持 unknown（渲染 "—"）：绝不能回填 0，那会把"没拉到"说成"没人关注"。
      .catch(() => { if (!cancelled) setPersonalFollowCounts(undefined); });
    return () => { cancelled = true; };
  }, [engagement, isSelfProfile, viewingProfileId, viewerAccountId]);
  // 未知画 "—" 不画 0：拉失败之前是未知不是零。ANALYTICS-ME-001 起浏览
  // （ListProfileViewStats 30 天窗口）与互动（GetReceivedEngagementStats，
  // 30 天收到的赞 + 评论）都有服务端口径，打开分析弹层才拉。
  // 关注数没拉到之前也是未知不是零。
  const dash = (n: number | undefined): string => (n === undefined ? "—" : String(n));
  // PROFILE-VISIT-001: 访问与转化页的"主页访问"是真数字了（其余漏斗环节
  // 仍是示例，见 ANALYTICS-HONEST-001）。只在真的打开这一屏时拉，不常驻后台。
  const [socialAnalyticsOpens, setSocialAnalyticsOpens] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (subPage?.route !== "socialanalytics") return;
    let cancelled = false;
    localNet.listProfileViewStats()
      .then((stats) => { if (!cancelled) setSocialAnalyticsOpens(stats.opens); })
      .catch(() => { if (!cancelled) setSocialAnalyticsOpens(undefined); });
    return () => { cancelled = true; };
  }, [subPage?.route, localNet]);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  // 资料保存失败必须留编辑器内提示，不静默吞掉（本地写失败/服务端同步失败都一样）。
  const [profileSaveError, setProfileSaveError] = useState<string | undefined>(undefined);
  // AVATAR-ACCOUNT-001: 首帧仅允许当前账户自己的本机副本。之前直接取目录
  // 中“最新一张”，同机多账号会先闪出别人的头像，随后 hydration 再换回来。
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | undefined>(() => initialProfileAvatarUri(viewerAccountId));
  const [profileRemoteAvatarPath, setProfileRemoteAvatarPath] = useState<string | undefined>(undefined);
  const [profilePosts, setProfilePosts] = useState<FeedPost[]>([]);
  // PROFILE-POSTS-FAILURE-001: 动态拉取失败不能留成空数组 —— 空数组渲染出来就是
  // 「你还没有动态」，把「没拉到」说成了「没有」。同文件里关注数早就是 dash(n)
  // （未知显示 —，不显示 0），这里补上同一口径：失败时条数显示 —，并给一条
  // 可重试的提示。reload 计数只为让下面的 effect 能重跑。
  const [profilePostsState, setProfilePostsState] = useState<"loading" | "ready" | "failed">("loading");
  const [profilePostsReload, setProfilePostsReload] = useState(0);
  // BADGE-WALL-001: 个人墙数据（已得徽章 id＋打卡史）。进 personalhub 才拉；
  // earned undefined = 还没拉到，failed = 拉失败（可重试），[]/空集 = 真没有。
  // 合成两个必然把“没拉到”画成“一块徽章都没有”。
  const [badgeWallClient] = useState(() => scene ?? new SceneClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore }));
  const [badgeEarnedIds, setBadgeEarnedIds] = useState<ReadonlyArray<string> | undefined>(undefined);
  const [badgeHistoryIds, setBadgeHistoryIds] = useState<ReadonlyArray<string>>([]);
  const [badgeWallFailed, setBadgeWallFailed] = useState(false);
  const [badgeWallNonce, setBadgeWallNonce] = useState(0);
  useEffect(() => {
    if (subPage?.route !== "personalhub") return;
    let cancelled = false;
    setBadgeWallFailed(false);
    void (async () => {
      try {
        const [earned, history] = await Promise.all([badgeWallClient.listMyBadges(), badgeWallClient.listMyCheckinHistory()]);
        if (!cancelled) { setBadgeEarnedIds(earned); setBadgeHistoryIds(history); }
      } catch {
        if (!cancelled) setBadgeWallFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [subPage?.route, badgeWallClient, badgeWallNonce]);
  const [profileMedia, setProfileMedia] = useState<Record<string, FeedMediaItem[]>>({});
  const [profileMediaPositions, setProfileMediaPositions] = useState<Record<string, number>>({});
  const [profileViewer, setProfileViewer] = useState<{ postId: string; index: number }>();
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>(INITIAL_SOCIAL_ACCOUNTS);
  const [socialEditor, setSocialEditor] = useState<SocialAccount>();
  const [socialOpenError, setSocialOpenError] = useState<string | undefined>(undefined);
  const [socialSettings, setSocialSettings] = useState({ merchant: true, profile: false, influence: false });
  const [collaboration, setCollaboration] = useState({ enabled: false, types: ["探店", "UGC"], rate: "", contact: "" });
  // STORE-REC-001: 推荐商铺进体系表单状态。
  const [storeRecDraft, setStoreRecDraft] = useState({ storeName: "", city: "", category: "", reason: "" });
  const [storeRecBusy, setStoreRecBusy] = useState(false);
  const [storeRecError, setStoreRecError] = useState<string | undefined>(undefined);
  const [storeRecDone, setStoreRecDone] = useState<string | undefined>(undefined);
  // STORE-REC-003: 小美（AI）整理。origin 决定这条推荐记成「用户推荐」还是
  // 「小美推荐」—— 默认 USER，只有小美真的整理过才切成 AI。
  const [storeRecNote, setStoreRecNote] = useState("");
  const [storeRecOrigin, setStoreRecOrigin] = useState<"USER" | "AI">("USER");
  const [storeRecAiBusy, setStoreRecAiBusy] = useState(false);
  // 底座未配置时把入口整个藏掉：留一个点了没反应的按钮，比没有这个功能更糟。
  const [storeRecAiAvailable, setStoreRecAiAvailable] = useState(true);
  const [storeRecAiNote, setStoreRecAiNote] = useState<string | undefined>(undefined);
  // 个人二维码复制反馈（PROFILE-QR-001）。
  const [qrNotice, setQrNotice] = useState<string | undefined>(undefined);
  // PROFILE-QR-002：放大扫码 + 分享二维码图。
  const [qrZoomOpen, setQrZoomOpen] = useState(false);
  const qrShotRef = useRef<View>(null);
  // 放大层里的那块码是**另一棵视图**，不能和页内那张共用锚点 —— 共用会把页内那张截下来。
  // 两个能开放大层的分支（personalmanage / personalqr）互斥，所以这一个锚点够用；
  // 谁改了「同屏两个放大层」的假设，这里就得拆成两个。
  const qrZoomShotRef = useRef<View>(null);
  // PROFILE-QR-004：个人管理的小卡也有自己的截图锚点。同一次渲染里只会挂载
  // 其中一个（子页与卡片互斥），所以锚点必须由调用方传进来，不许写死一个。
  const qrCardShotRef = useRef<View>(null);
  // PROFILE-QR-008：出示码的那两屏把屏幕拉满 —— 微信、支付宝出示码那一屏的做法。
  // 「我的二维码」页里那张 208px 的码就是给对方扫的，停在这一页期间屏幕要亮。
  //
  // **只允许一个 active**：`lib/screen-brightness` 的契约写明「同一时刻两个 active
  // 会互相抢亮度」，而放大层自己已经调了一次（`useScreenBrightness(visible)`）。
  // 所以这里要排除放大层开着的那一刻 —— 那时由放大层负责，关掉后这里再接手。
  // 写成 `qrZoomOpen || …` 就会两个同时为 true，违反契约。
  useScreenBrightness(subPage?.route === "personalqr" && !qrZoomOpen);
  // 结构化类型，避免 React 18/19 的 RefObject 定义差异把签名写死。
  type QrShotRef = { current: View | null };
  // 失败必须带上真实原因。笼统的「请重试」把「这个安装包根本没带原生模块」
  // 和「用户没给权限」说成同一句话 —— 前者重试一万次也不会好。
  function qrFailureReason(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    return typeof err === "string" && err ? err : "未知错误";
  }
  async function shareQrImage(shotRef: QrShotRef = qrShotRef): Promise<void> {
    try {
      // 必须补成 file:// —— 分享面板拿到无 scheme 的裸路径会少给动作（存图/发消息）。
      const uri = toFileUrl(await captureRef(shotRef, { format: "png", quality: 1 }));
      // 文案里**不再放链接**：码本身是一张 vCard 名片，配文给 handle 才是 App 搜得到的。
      const handle = profileDraft.handle.replace(/^@+/, "");
      await Share.share({
        url: uri,
        message: handle
          ? `加我 Proxy：在 App 里搜 @${handle}，或者扫这张二维码。`
          : `查看 ${profileDraft.name} 的 Proxy 主页`,
      });
    } catch (err) {
      setQrNotice(`分享失败：${qrFailureReason(err)}`);
    }
  }
  // PROFILE-QR-002：一键保存二维码到相册（不再依赖系统分享面板的
  // 「存储图像」选项 —— 那个选项在部分机型/面板版本不出现）。
  //
  // 权限和失败分开报：前者要引导去设置，后者才谈重试。
  async function saveQrToAlbum(shotRef: QrShotRef = qrShotRef): Promise<void> {
    try {
      const uri = await captureRef(shotRef, { format: "png", quality: 1 });
      const result = await saveImageToAlbum(uri);
      setQrNotice(
        result.ok
          ? "二维码已保存到相册。"
          : result.code === "permission"
            ? "需要相册权限才能保存二维码。"
            : `保存失败：${result.reason}`,
      );
    } catch (err) {
      setQrNotice(`保存失败：${qrFailureReason(err)}`);
    }
  }
  // 复制的是**码下方那串展示文本**（人的 `@handle` / 店铺的店名），不是链接。
  // 以前复制的是拼出来的主页链接 —— 那个域名不是我们的（挂在 Spaceship 上**待售**），
  // 而且 App 自己的搜索按 handle 字面匹配，粘回去根本搜不到人。
  // 这里刻意**不写出**那个域名：本文件被 gate 的「不许再拼链接」反向钉盯着，
  // 写进注释会让钉在正确的树上误报。完整的实测记录在 `../profile-qr.ts` 文件头。
  async function copyQrText(text: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(text);
      setQrNotice(`已复制 ${text} —— 让对方在 Proxy 里搜它就能找到。`);
    } catch (err) {
      setQrNotice(`复制失败：${qrFailureReason(err)}`);
    }
  }
  async function submitStoreRecommendation(): Promise<void> {
    setStoreRecBusy(true);
    setStoreRecError(undefined);
    setStoreRecDone(undefined);
    try {
      const client = new StoreOnboardingClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore });
      await client.recommendStore({ ...storeRecDraft, origin: storeRecOrigin });
      setStoreRecDone(
        storeRecOrigin === "AI"
          ? "已提交，这条记为「小美推荐」，运营会评估这家店是否接入体系。"
          : "已提交，运营会评估这家店是否接入体系。谢谢推荐！"
      );
      setStoreRecDraft({ storeName: "", city: "", category: "", reason: "" });
      setStoreRecNote("");
      setStoreRecOrigin("USER");
      setStoreRecAiNote(undefined);
    } catch (err) {
      setStoreRecError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setStoreRecBusy(false);
    }
  }

  // STORE-REC-003: 让小美把随口说的话整理成草稿。**只读** —— 草稿要用户确认后
  // 才由 recommendStore 落库，小美不直接写库，也就绕不过服务端那套校验。
  // 小美没填的字段保持空，让用户自己补，绝不替他编一个城市或理由出来。
  async function suggestWithXiaomei(): Promise<void> {
    setStoreRecAiBusy(true);
    setStoreRecError(undefined);
    setStoreRecAiNote(undefined);
    try {
      const client = new StoreOnboardingClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore });
      const draft = await client.suggestRecommendation(storeRecNote);
      setStoreRecDraft({ storeName: draft.storeName, city: draft.city, category: draft.category, reason: draft.reason });
      setStoreRecOrigin("AI");
      const missing = [
        draft.storeName ? "" : "店名",
        draft.city ? "" : "城市",
        draft.reason ? "" : "推荐理由"
      ].filter((label) => label !== "");
      setStoreRecAiNote(
        missing.length > 0
          ? `小美整理好了，但你没提到${missing.join("、")} —— 补上再提交，这几项我们不替你猜。`
          : "小美整理好了，确认后会记为「小美推荐」。"
      );
    } catch (err) {
      // 能力不存在 ≠ 操作失败：不弹红字，直接把入口藏起来。
      if (err instanceof StoreRecommendationAiUnavailableError) setStoreRecAiAvailable(false);
      else setStoreRecError(err instanceof Error ? err.message : "小美整理失败，请稍后重试");
    } finally {
      setStoreRecAiBusy(false);
    }
  }
  const socialSettingsHydrated = useRef(false);
  useEffect(() => { let cancelled = false; void (async () => { const local = await socialSettingsStore.read(); let remote: typeof local; let serverReachable = false; if (socialSettingsClient) { try { remote = await socialSettingsClient.read(); serverReachable = true; } catch { serverReachable = false; } } const value = remote ?? local; if (!cancelled && value) { setSocialAccounts(value.accounts); setSocialSettings({ merchant: value.merchant, profile: value.profile, influence: value.influence }); setCollaboration({ enabled: value.collaborationEnabled ?? false, types: value.collaborationTypes ?? ["探店", "UGC"], rate: value.collaborationRate ?? "", contact: value.collaborationContact ?? "" }); await socialSettingsStore.write(value); if (serverReachable && !remote && local) await socialSettingsClient?.write(local).catch(() => undefined); } if (!cancelled) socialSettingsHydrated.current = true; })(); return () => { cancelled = true; }; }, [socialSettingsClient]);
  useEffect(() => { if (!socialSettingsHydrated.current) return; const value = { accounts: socialAccounts, ...socialSettings, collaborationEnabled: collaboration.enabled, collaborationTypes: collaboration.types, collaborationRate: collaboration.rate, collaborationContact: collaboration.contact }; void socialSettingsStore.write(value); if (!socialSettingsClient) return; const timer = setTimeout(() => { void socialSettingsClient.write(value).catch(() => undefined); }, 250); return () => clearTimeout(timer); }, [socialAccounts, socialSettings, collaboration, socialSettingsClient]);
  const [securityRetention, setSecurityRetention] = useState<7 | 30 | 90 | 365>(30);
  const [screenshotWarn, setScreenshotWarn] = useState(true);
  // TWIN-SIGNALS-001: 动态浏览统计总闸（默认开）。本机存取，读不到按开处理
  // （见 behavior-analytics-settings），开关关掉后上报直接短路。
  const [behaviorAnalytics, setBehaviorAnalytics] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await behaviorAnalyticsStore.read();
        if (!cancelled && stored !== undefined) setBehaviorAnalytics(stored);
      } catch { /* 读不到保持默认开 */ }
    })();
    return () => { cancelled = true; };
  }, []);
  function toggleBehaviorAnalytics(): void {
    setBehaviorAnalytics((current) => {
      const next = !current;
      void behaviorAnalyticsStore.write(next).catch(() => undefined);
      return next;
    });
  }
  const [profileDraft, setProfileDraft] = useState({
    name: NEUTRAL_PROFILE.name,
    handle: NEUTRAL_PROFILE.handle,
    bio: NEUTRAL_PROFILE.bio,
    city: NEUTRAL_PROFILE.city
  });
  const profileHydratedRef = useRef(false);
  const profileHydratedForRef = useRef<string | undefined>(undefined);
  const profileTouchedRef = useRef(false);
  // AGENT-CLAIM-NUMBER-001: 接单编号（服务端分配，本地只读）。0 = 未分配。
  const [claimNumber, setClaimNumber] = useState(0);
  useEffect(() => {
    // PROFILE-READ-001 hydration order (first writer wins per account):
    // 1. server profile (source of truth once the user has saved);
    // 2. this account's local record;
    // 3. derived from this account's own login identifier;
    // 4. neutral label (never the hardcoded demo identity).
    if (profileHydratedRef.current && profileHydratedForRef.current === viewerAccountId) return;
    // A session/account transition is a hard identity boundary. Clear the
    // previous account's visual state before any async source resolves.
    profileTouchedRef.current = false;
    profileHydratedRef.current = false;
    profileHydratedForRef.current = viewerAccountId;
    setProfileDraft({ ...NEUTRAL_PROFILE });
    setClaimNumber(0);
    // AVATAR-FLASH-002: 账号就绪（undefined → 真 id）瞬间先同步读本机副本 ——
    // 直接 set undefined 再等异步回填，就是"先默认后照片"的那一闪。读到就上，
    // 读不到才 undefined 走后续 hydration（远端/首字）。
    setProfileAvatarUri(initialProfileAvatarUri(viewerAccountId));
    setProfileRemoteAvatarPath(undefined);
    let cancelled = false;
    void (async () => {
      const applyRecord = (record: { name: string; handle: string; bio: string; city: string; avatarPath?: string | undefined }): void => {
        if (cancelled || profileTouchedRef.current) return;
        profileHydratedRef.current = true;
        profileHydratedForRef.current = viewerAccountId;
        setProfileDraft({ name: record.name, handle: record.handle, bio: record.bio, city: record.city });
      };
      const hydrateRemoteAvatar = (avatarPath?: string | undefined): boolean => {
        if (cancelled || !avatarPath?.startsWith("assets/")) return false;
        const mediaAssetId = avatarPath.slice("assets/".length).trim();
        if (mediaAssetId === "" || mediaAssetId.startsWith("avatar-")) return false;
        setProfileRemoteAvatarPath(avatarPath);
        setProfileAvatarUri(`${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(mediaAssetId)}`);
        return true;
      };
      // AVATAR-DELIVER-001: 返回是否命中本地副本。本机有副本时**优先**用它——
      // 服务端副本受可见性约束（上传默认 OWNER_ONLY，公开 thumb 路由要求 PUBLIC，
      // 命中不了就 404），远端取不到时头像绝不能被表现成「被重置」。
      const hydrateAvatar = (avatarPath?: string | undefined, record?: ProfileRecord): boolean => {
        if (cancelled || !avatarPath) return false;
        try {
          const name = avatarFileName(avatarPath);
          const names = new Set(PROFILE_AVATAR_DIR.list().map((entry) => entry.name));
          if (names.has(name)) {
            setProfileAvatarUri(new File(PROFILE_AVATAR_DIR, name).uri);
            if (record && record.avatarPath !== name) {
              void profileStore.write({ ...record, avatarPath: name }).catch(() => undefined);
            }
            return true;
          }
        } catch {
          // 目录不可读：保持字母头，不崩。
        }
        return false;
      };
      // 1. server (PROFILE-001 source of truth).
      if (profileClient && viewerAccountId) {
        try {
          const remote = await profileClient.getProfile(viewerAccountId);
          if (cancelled || profileTouchedRef.current) return;
          // AVATAR-SAVE-002: 本地副本文件名优先保留（见 mergeRemoteProfile）——
          // 服务端 avatarPath 是 assets/<mediaAssetId>，直接当本机文件名写会把
          // documentDirectory 里的头像指针抹掉，表现为「换完头像被默认重置」。
          const existingRecord = await profileStore.read().catch(() => undefined);
          const record: ProfileRecord = mergeRemoteProfile(remote, existingRecord);
          await profileStore.write(record).catch(() => undefined);
          applyRecord(record);
          setClaimNumber(typeof remote.claimNumber === "number" ? remote.claimNumber : 0);
          if (!hydrateAvatar(record.avatarPath)) hydrateRemoteAvatar(remote.avatarPath);
          return;
        } catch {
          // No server profile yet (fresh account) or offline: fall through
          // to local sources instead of blocking the page.
        }
      }
      // 2. this account's local record.
      try {
        const record = await profileStore.read();
        if (record) {
          applyRecord(record);
          setProfileRemoteAvatarPath(undefined);
          hydrateAvatar(record.avatarPath, record);
          return;
        }
      } catch {
        // fall through
      }
      // Never adopt the old device-global profile here. lastSignIn already
      // points at the newly authenticated account, so it cannot prove who
      // owned that legacy record and previously leaked Huyen into newcomers.
      // 3. derive from this account's own login identifier.
      try {
        const remembered = await lastSignInStore.read().catch(() => undefined);
        const owned = remembered && (!viewerAccountId || remembered.userAccountId === viewerAccountId)
          ? remembered
          : undefined;
        const derived = deriveProfileFromIdentifier(owned?.identifier, owned?.channel);
        const record: ProfileRecord = { ...derived, avatarPath: undefined, updatedAt: new Date().toISOString() };
        // Cache per account so composer/status publish the same truthful name.
        if (viewerAccountId) await profileStore.write(record).catch(() => undefined);
        applyRecord(record);
      } catch {
        applyRecord(NEUTRAL_PROFILE);
      }
    })();
    return () => { cancelled = true; };
  }, [profileClient, viewerAccountId, profileStore]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setProfilePostsState("loading");
      try {
        const read = await localNet.listMyFeedPosts();
        if (cancelled) return;
        if (read.posts.length > 0) {
          setProfilePosts(read.posts);
          setProfileMedia(read.media);
          setProfilePostsState("ready");
          return;
        }
        let cursor: string | undefined = undefined;
        let hasMore = true;
        const allPosts: typeof read.posts = [];
        const allMedia: Record<string, FeedMediaItem[]> = {};
        let pages = 0;
        while (hasMore && pages < 4 && !cancelled) {
          const page = await localNet.listFeedPosts(cursor, 50);
          if (cancelled) return;
          allPosts.push(...page.posts);
          Object.assign(allMedia, page.media);
          cursor = page.nextCursor;
          hasMore = page.hasMore;
          pages += 1;
        }
        if (cancelled) return;
        const myHandle = profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`;
        const filtered = allPosts.filter((post) => post.authorId === viewerAccountId || post.authorDisplayName === profileDraft.name || post.body.includes(myHandle) || post.authorId === profileDraft.handle || post.authorId === profileDraft.name);
        if (filtered.length > 0) {
          const media: Record<string, FeedMediaItem[]> = {};
          for (const post of filtered) { const items = allMedia[post.postId]; if (items) media[post.postId] = items; }
          setProfilePosts(filtered);
          setProfileMedia(media);
        } else {
          setProfilePosts(read.posts);
          setProfileMedia(read.media);
        }
        // 走到这里说明两次读取都成功了（可能是空列表）—— 空是答案，不是失败。
        setProfilePostsState("ready");
      } catch {
        try {
          let cursor: string | undefined = undefined;
          let hasMore = true;
          const allPosts: FeedPost[] = [];
          const allMedia: Record<string, FeedMediaItem[]> = {};
          let pages = 0;
          while (hasMore && pages < 4 && !cancelled) {
            const page = await localNet.listFeedPosts(cursor, 50);
            if (cancelled) return;
            allPosts.push(...page.posts);
            Object.assign(allMedia, page.media);
            cursor = page.nextCursor;
            hasMore = page.hasMore;
            pages += 1;
          }
          if (cancelled) return;
          const myHandle = profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`;
          const filtered = allPosts.filter((post) => post.authorId === viewerAccountId || post.authorDisplayName === profileDraft.name || post.body.includes(myHandle));
          if (filtered.length > 0) {
            const media: Record<string, FeedMediaItem[]> = {};
            for (const post of filtered) { const items = allMedia[post.postId]; if (items) media[post.postId] = items; }
            setProfilePosts(filtered);
            setProfileMedia(media);
          }
          setProfilePostsState("ready");
        } catch {
          // 两条路都失败。以前这里直接把异常吞掉（catch 体是空的）：数组留空 →
          // 页面显示「0 条动态」，和「你还没发过动态」一模一样。失败必须自己说出来。
          setProfilePostsState("failed");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [localNet, profileDraft.name, profileDraft.handle, viewerAccountId, profilePostsReload]);

  useEffect(() => {
    if (!engagement || !viewerAccountId) return;
    let cancelled = false;
    void engagement.listPinnedPosts(viewerAccountId)
      .then((r) => { if (!cancelled) setPersonalPinnedIds(r.postIds ?? []); })
      .catch(() => { if (!cancelled) setPersonalPinnedIds([]); });
    return () => { cancelled = true; };
  }, [engagement, viewerAccountId]);

  useEffect(() => {
    if (!engagement || !viewerAccountId) return;
    let cancelled = false;
    void engagement.listUserReplies(viewerAccountId, 30)
      .then(async (r) => {
        if (cancelled) return;
        setPersonalRepliesFailed(false);
        // REPLY-TARGET-001: 服务端一直在发 parentPostId（就是这条回复挂在哪条
        // 帖子下面），只是以前没人读它，于是「回复了谁」被降级成光秃秃的
        // 「你回复了」。父帖用 PROFILE-SAVED-001 的 ListPostsByIds 回查 ——
        // 同一条可见性口径：已删 / 已收紧成仅关注者可见的帖子取不回来，
        // 那一行就退化成中性文案，不猜也不编。
        const entries = replyEntriesFromReplies(r.replies);
        setPersonalReplyEntries(entries);
        const parentIds = parentPostIdsForReplies(entries);
        if (parentIds.length === 0) {
          setPersonalReplyTargets({});
          return;
        }
        try {
          const parents = await localNet.listPostsByIds(parentIds);
          if (!cancelled) setPersonalReplyTargets(replyTargetsFromPosts(parents.posts));
        } catch {
          // 引用块拿不到不该把回复本身也吞掉 —— 回复正文仍然照常显示。
          if (!cancelled) setPersonalReplyTargets({});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPersonalReplyEntries([]);
          setPersonalReplyTargets({});
          setPersonalRepliesFailed(true);
        }
      });
    void engagement.listUserBookmarks(viewerAccountId, 60)
      .then(async (b) => {
        if (cancelled) return;
        setPersonalSavedFailed(false);
        try {
          // PROFILE-SAVED-001: 收藏按 ID 直取。之前是拿动态流（默认一页 25 条）
          // 按 bookmark id 过滤 —— 收藏一条不在这一页里的帖子就等于丢了，
          // 用户会以为收藏被吞。服务端 ListPostsByIds 用同一条可见性口径。
          const bookmarked = await localNet.listPostsByIds(b.bookmarks);
          if (cancelled) return;
          setPersonalSavedPosts(bookmarked.posts);
        } catch {
          if (!cancelled) { setPersonalSavedPosts([]); setPersonalSavedFailed(true); }
        }
      })
      .catch(() => { if (!cancelled) { setPersonalSavedPosts([]); setPersonalSavedFailed(true); } });
    // MENTION-001: TAGGED 独立加载。之前它被塞在收藏那条 promise 链里 ——
    // 收藏一失败，TAGGED 就静默空掉，看起来像「没人提到过我」。
    // 读取也改成服务端扫全量已发布帖子：原来是在上面那一页动态（默认 25 条）里
    // 做 strings.Contains，更早的提及直接消失，而且 "@thanh2" 会被算成提到了
    // "@thanh"。服务端的可见性/静音口径与动态流完全一致。
    void localNet.listPostsMentioning(profileDraft.handle)
      .then((mentions) => {
        if (!cancelled) { setPersonalTaggedPosts(mentions.posts); setPersonalTaggedFailed(false); }
      })
      .catch(() => {
        if (!cancelled) { setPersonalTaggedPosts([]); setPersonalTaggedFailed(true); }
      });
    return () => { cancelled = true; };
  }, [engagement, viewerAccountId, localNet, profileDraft.name, profileDraft.handle]);

  // SCENE-FAVORITE-002：首页场景 🤍 存本机（按账号），跟帖子收藏（服务端）是两份
  // 数据。个人主页的收藏 tab 以前只读服务端 ⇒ 首页点过的 🤍 在这里永远看不见。
  // 读同一份本机 hearts 交给 ProfileTabs 一起画；解析走 resolveSavedSceneIds，
  // 与「我的 → 收藏」共用同一实现。
  useEffect(() => {
    let cancelled = false;
    if (!viewerAccountId) {
      setPersonalSavedScenes([]);
      return;
    }
    void createSceneFavoritesStore(nativeSecureStorageDriver, viewerAccountId)
      .read()
      .then((ids) => { if (!cancelled) setPersonalSavedScenes(resolveSavedSceneIds(ids, savedSceneLookup)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [viewerAccountId]);

  // SCROLL-CHROME-001: shared controller (see shell/scroll-chrome.ts).
  const onScroll = useScrollChrome(onChromeVisibilityChange);

  if (subPage?.route === "friendcrm") {
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface relationship={relationshipClient} profileClient={profileClient} initialView="LIST" viewer={{ name: profileDraft.name, handle: profileDraft.handle }} onOpenVouchers={onOpenVouchers} onBack={() => setSubPage(undefined)} onOpenConversation={(author, peerUserId) => { setSubPage(undefined); onOpenConversation?.(author, peerUserId); }} onOpenFacet={() => openSubPage("facet")} localNet={localNet} myPosts={profilePosts} /></SwipeBackShell>;
  }
  if (context === "BUSINESS") {
    return (
      <MerchantMeR21Replacement
        business={business}
        supply={supply}
        activities={activities}
        viewerAccountId={viewerAccountId}
        onOpenVouchers={onOpenVouchers}
        onOpenSwitcher={onOpenSwitcher}
        onSignOut={onSignOut}
      />
    );
  }

  const persona = PERSONA[context];

  // R18.x HUB-PROFILE-001: hub top card + identity card
  // read the live profile (profileDraft, profileAvatarUri)
  // so editing 主页 actually reflects on the hub. See
  // resolveHubProfile in ./me-types for precedence rules.
  const hubProfile = resolveHubProfile({
    personaName: persona.name,
    personaAvatarText: persona.avatarText,
    personaCity: "河内",
    profileName: profileDraft.name,
    profileCity: profileDraft.city,
    profileHandle: profileDraft.handle,
    hasAvatar: Boolean(profileAvatarUri),
  });

  const managedSections =
    context === "REQUESTER" && experienceSections
      ? toManagedMenuSections(experienceSections)
      : [];

  const effectiveSections = experienceMode === "REPLACE" && managedSections.length > 0
    ? managedSections
    : managedSections.length > 0
      ? persona.sections.map((pSection) => {
          const managed = managedSections.find((m) => m.id === pSection.id);
          if (!managed) return pSection;
          const managedLabels = new Set(managed.rows.map((r) => r.label));
          const extraRows = pSection.rows.filter((r) => !managedLabels.has(r.label));
          return { ...pSection, rows: [...managed.rows, ...extraRows] };
        })
      : persona.sections;

  function openRegisteredRoute(route: RegisteredExperienceRoute): void {
    if (route === "vouchers") {
      onOpenVouchers();
      return;
    }
    const next = meSubPage(route);
    if (!next) return;
    setSubPage(next);
  }

  function pressRow(row: MenuRow): void {
    const ownedRoute = meOwnedRouteForLabel(row.label);
    if (ownedRoute) {
      openSubPage(ownedRoute);
      return;
    }
    if (row.route === "vouchers") {
      onOpenVouchers();
      return;
    }
    if (row.action) {
      if (row.action.type === "OPEN_REGISTERED_ROUTE") {
        openRegisteredRoute(row.action.route);
        return;
      }
      onExperienceAction(row.action);
      return;
    }
    if (row.route) {
      // 菜单行自带 label/desc/icon，注册表里没有这条路由时用行自身的文案兜底。
      setSubPage(meSubPage(row.route) ?? { title: row.label, desc: row.desc, icon: row.icon, route: row.route });
    }
  }

  // PROFILE-QR-004：二维码页可以带**店铺 id** 进来（商家卡片画的是店铺名片，打开的
  // 页就必须还是店铺名片）。只传 id，名片本身由页面用 buildContactCard 统一生成 ——
  // 以前这里传的是**编好的主页链接**，等于把域名这件事漏进了导航参数。
  // （域名不写在这里，原因见上面 copyQrText 的注释。）
  function openSubPage(route: string, extra?: { qrStoreId?: string; qrTitle?: string; backRoute?: string }): void {
    const next = meSubPage(route);
    if (!next) return;
    setSubPage(extra ? { ...next, ...extra } : next);
  }

  async function chooseProfileAvatar(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setProfileSaveError("请允许 Proxy 读取照片才能换头像。");
      setProfileEditorOpen(true);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      quality: 1,
      selectionLimit: 1
    });
    const selected = result.assets?.[0];
    if (result.canceled || !selected?.uri) return;
    try {
      PROFILE_AVATAR_DIR.create({ idempotent: true, intermediates: true });
      const avatarFile = nextProfileAvatarFile(viewerAccountId);
      await new File(selected.uri).copy(avatarFile, { overwrite: true });
      profileTouchedRef.current = true;
      profileHydratedRef.current = true;
      setProfileRemoteAvatarPath(undefined);
      setProfileAvatarUri(avatarFile.uri);
      const localRecord: ProfileRecord = {
        ...profileDraft,
        // AVATAR-001: 只存文件名。绝对 file:// URI 含沙盒 container UUID，
        // 重装 App 后必死；读时按当前 documentDirectory 重锚。
        avatarPath: avatarFileName(avatarFile.uri),
        updatedAt: new Date().toISOString()
      };
      await profileStore.write(localRecord);
      // AVATAR-GC-001: 只保留本次这份副本，避免旧头像文件无限堆积。
      pruneProfileAvatars(avatarFileName(avatarFile.uri), viewerAccountId);
      // Avatar controls also exist outside the profile editor. Selecting a
      // photo is therefore a complete action: upload and sync immediately,
      // rather than requiring a hidden second "完成" step.
      if (mediaClient && profileClient) {
        try {
          const uploaded = await mediaClient.uploadImage({
            uri: avatarFile.uri,
            mimeType: selected.mimeType ?? "image/jpeg",
            width: selected.width,
            height: selected.height
          });
          const remotePath = `assets/${uploaded.mediaAssetId}`;
          await profileClient.updateProfile({ ...profileDraft, avatarPath: remotePath });
          setProfileRemoteAvatarPath(remotePath);
          setProfileSaveError(undefined);
        } catch {
          setProfileSaveError("头像已保存在本机，但同步失败，请检查网络后重试。");
        }
      }
    } catch (err) {
      // AVATAR-SAVE-001: 这里以前是静默 `catch { setProfileAvatarUri(selected.uri) }`
      // —— 相册原 URI 只在本进程有效（且 iOS 会清 tmp），一旦落盘失败：头像看着
      // 变了、其实没写进 documentDirectory / SecureStore，离开页面或重启就回到
      // 字母头，而且**没有任何报错**，用户和测试都看不见。现在：保留预览，同时
      // 把真实原因报出来，并且不再假装保存成功。
      const detail = err instanceof Error ? err.message : String(err);
      console.log(`[proxy.AVATAR-SAVE-001] local avatar persist FAIL: ${detail}`);
      setProfileAvatarUri(selected.uri);
      setProfileSaveError(`头像没能保存到本机（${detail}）。请重试，或检查存储权限。`);
    }
  }

  async function saveProfile(): Promise<void> {
    setProfileSaveError(undefined);
    let localAvatarFileName: string | undefined;
    if (profileAvatarUri?.startsWith(PROFILE_AVATAR_DIR.uri)) {
      // AVATAR-001: 同上，只存文件名。
      localAvatarFileName = avatarFileName(profileAvatarUri);
    } else if (profileAvatarUri) {
      try {
        PROFILE_AVATAR_DIR.create({ idempotent: true, intermediates: true });
        const avatarFile = nextProfileAvatarFile(viewerAccountId);
        await new File(profileAvatarUri).copy(avatarFile, { overwrite: true });
        localAvatarFileName = avatarFileName(avatarFile.uri);
        setProfileAvatarUri(avatarFile.uri);
      } catch {
        localAvatarFileName = undefined;
      }
    } else {
      const existing = await profileStore.read().catch(() => undefined);
      // AVATAR-001: 老记录可能是绝对路径，读出来即规范成文件名。
      localAvatarFileName = existing?.avatarPath ? avatarFileName(existing.avatarPath) : undefined;
    }
    // R18.x PROFILE-001: the server's Profile avatarPath must use
    // an 'assets/' or 'ai-personas/' prefix (isValidProfileAssetPath).
    // Local SecureStore keeps the bare filename for the on-device
    // read-back path; the wire path prepends the canonical prefix.
    let wireAvatarPath = profileRemoteAvatarPath ?? "";
    if (localAvatarFileName && profileAvatarUri?.startsWith("file:") && !wireAvatarPath) {
      if (!mediaClient) {
        setProfileSaveError("头像上传服务暂不可用，请稍后重试。");
        return;
      }
      try {
        const uploaded = await mediaClient.uploadImage({ uri: profileAvatarUri, mimeType: "image/jpeg", width: 0, height: 0 });
        wireAvatarPath = `assets/${uploaded.mediaAssetId}`;
        setProfileRemoteAvatarPath(wireAvatarPath);
      } catch {
        setProfileSaveError("头像上传失败，请检查网络后重试。");
        return;
      }
    }
    const record: ProfileRecord = {
      name: profileDraft.name,
      handle: profileDraft.handle,
      bio: profileDraft.bio,
      city: profileDraft.city,
      avatarPath: localAvatarFileName,
      updatedAt: new Date().toISOString()
    };
    try {
      await profileStore.write(record);
    } catch {
      // 本地都没写进去：编辑器保持打开并提示，不假装保存成功。
      setProfileSaveError("本地保存失败，资料没有更新，请重试。");
      return;
    }
    // R18.x PROFILE-001: send the edit to the server. Local
    // SecureStore is now a write-through cache; the server is
    // the source of truth that feeds / opportunity applicants /
    // cross-device read models all see.
    if (profileClient) {
      try {
        await profileClient.updateProfile({
          name: profileDraft.name,
          handle: profileDraft.handle,
          bio: profileDraft.bio,
          city: profileDraft.city,
          avatarPath: wireAvatarPath,
        });
      } catch (error) {
        // HANDLE-UNIQUE-001: handle 被占用是**可行动**的（换一个就能过），
        // 不能混进下面那句「同步失败，请重试」—— 那样用户会对着一个永远
        // 不会成功的按钮反复点。ProfileClient 在 REJECTED 时把 messageKey
        // 放进 Error.message（见 profile-client.ts）。
        const message = error instanceof Error ? error.message : "";
        if (message.includes("profile_handle_taken")) {
          setProfileSaveError("这个 @handle 已经被别人用了，换一个再保存。");
          return;
        }
        // 服务端同步失败：本地已更新但云端没跟上，明确告诉用户可重试，
        // 编辑器保持打开，不假装全部成功。
        setProfileSaveError("已保存到本机，但同步到服务端失败，请稍后点完成重试。");
        return;
      }
    }
    profileHydratedRef.current = true;
    setProfileEditorOpen(false);
  }

  if (subPage) {
    const contentWrapper = (node: React.JSX.Element): React.JSX.Element => <SwipeBackShell onExit={() => closeSubPage()}>{node}</SwipeBackShell>;
    const content = SUB_PAGE_CONTENT[subPage.route];

    if (subPage.route === "myorders") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MyOrdersSurface client={fulfillment} moderation={moderation} mediaClient={mediaClient} onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "myactivities") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MyActivitiesSurface onBack={() => setSubPage(undefined)} moderation={moderation} /></SwipeBackShell>;
    if (subPage.route === "merchantcampaign") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MerchantCampaignSurface onBack={() => setSubPage(undefined)} moderation={moderation} /></SwipeBackShell>;
    if (subPage.route === "favorites") return <SwipeBackShell onExit={() => setSubPage(undefined)}><FavoritesSurface onBack={() => setSubPage(undefined)} viewerAccountId={viewerAccountId} /></SwipeBackShell>;
    if (subPage.route === "facet") {
      const facetClient = new FacetClient({ requester: sessionAuthClient, baseUrl: localApiBaseUrl });
      // AI-FACET-CLUSTER-001: AI 分身与 FACET 是"生成 → 分发"同一条链路，
      // 两边互相有一条回去对方的路，不用退回「我的」根页再点一次。
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FacetHomeSurface client={facetClient} onBack={() => setSubPage(undefined)} onOpenAiIdentity={() => openSubPage("aiidentity")} /></SwipeBackShell>;
    }
    if (subPage.route === "aimanage") {
      // AI-MANAGE-002：我的 → 账户 → AI 管理全量。状态卡 = 服务端 Token +
      // 本人图片/视频（profileMedia 现算）+ 动态数；暂停/三 sheet 走
      // Get/UpdateAiEngineSettings（服务端盖章 actor）。lastPostAt 取主页
      // 帖里最新一条 createdAt。
      const allMedia = Object.values(profileMedia).flat();
      const imageCount = allMedia.filter((item) => item.mediaType === "IMAGE").length;
      const videoCount = allMedia.filter((item) => item.mediaType === "VIDEO").length;
      const lastPostAt = profilePosts.reduce<string | undefined>((latest, post) => {
        if (!latest) return post.createdAt;
        return post.createdAt > latest ? post.createdAt : latest;
      }, undefined);
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><AIManagementSurface onBack={() => setSubPage(undefined)} viewerAccountId={viewerAccountId} authClient={sessionAuthClient} secureSessionStore={nativeSecureSessionStore} imageCount={imageCount} videoCount={videoCount} lastPostAt={lastPostAt} onOpenImageIdentity={() => openSubPage("aiidentity")} /></SwipeBackShell>;
    }
    if (subPage.route === "aiidentity") {
      // AI-TWIN-POST-AUDIENCE-004（2026-09-22，用户纠正："帖文编排拿的是
      // 公共主页的帖文，没理解对。只能拿主页的图片/视频做原型给 AI 用，
      // 但不能跟主页的帖文重合"）：profilePosts 混着两类帖子——公开发在
      // 主页上的、和只想给特定人看的 TARGETED。图库拿这个人公开主页的
      // 图片/视频当原始素材（rawGalleryItems 只取非 TARGETED 帖子的媒体，
      // TARGETED 帖子本来就是"私密副空间"的产物，不是主页素材池的一部分）；
      // 帖文编排管理的是 TARGETED 这一份——跟主页帖子列表（personalhub
      // 分支的 ProfileTabs）完全不重叠：主页只显示非 TARGETED，帖文编排
      // 只显示 TARGETED，两边加起来才是 profilePosts 的全集，任何一条
      // 帖子只会出现在其中一边。
      const publicHomepagePosts = profilePosts.filter((post) => post.visibility !== "TARGETED");
      const targetedSpacePosts = profilePosts.filter((post) => post.visibility === "TARGETED");
      // AI-TWIN-GALLERY-004（2026-09-22，用户反馈"图库没有图"）：服务端
      // thumbnailUrl/feedUrl/... 都是相对路径，ProfileTabs 全靠
      // localNet.resolveMediaUrl 拼上服务器地址才能显示——这里漏了这一步，
      // <Image> 拿着相对路径请求，静默加载失败。
      const rawGalleryItems: PersonaGalleryItem[] = publicHomepagePosts.flatMap((post) =>
        (profileMedia[post.postId] ?? [])
          .filter((item) => item.mediaType === "IMAGE")
          .map((item): PersonaGalleryItem | undefined => {
            const rawThumbnailUrl = item.thumbnailUrl ?? item.feedUrl ?? item.galleryUrl ?? item.placeholderUrl;
            if (!rawThumbnailUrl) return undefined;
            return {
              id: item.mediaAssetId,
              thumbnailUrl: localNet.resolveMediaUrl(rawThumbnailUrl),
              ...(item.playbackUrl !== undefined ? { playbackUrl: localNet.resolveMediaUrl(item.playbackUrl) } : {}),
              aiGenerationSource: item.aiGenerationSource ?? "USER_UPLOADED",
              createdAt: post.createdAt,
            };
          })
          .filter((entry): entry is PersonaGalleryItem => entry !== undefined)
      );
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><AIIdentityShowcaseSurface onBack={() => setSubPage(undefined)} viewerAccountId={viewerAccountId} ownerName={hubProfile.displayName} ownerAvatarUri={profileAvatarUri} authClient={sessionAuthClient} rawGalleryItems={rawGalleryItems} mediaClient={mediaClient} posts={targetedSpacePosts} mediaByPost={profileMedia} relationshipClient={relationshipClient} createPost={(payload) => localNet.createPost(payload)} updatePostAudience={(postId, visibility, audienceTargetIds) => localNet.updatePostAudience(postId, visibility, audienceTargetIds)} onPostPublished={() => setProfilePostsReload((n) => n + 1)} resolveMediaUrl={(path) => localNet.resolveMediaUrl(path)} /></SwipeBackShell>;
    }
    if (subPage.route === "myscenes") {
      async function respond(invitationId: string, decision: "ACCEPTED" | "DECLINED" | "ASK"): Promise<void> {
        if (!scene || invitationBusyId) return;
        setInvitationBusyId(invitationId);
        setInvitationError(undefined);
        try {
          const result = await scene.respondInvitation(invitationId, decision);
          const status = (result.aggregate?.state ?? decision) as MySceneInvitation["status"];
          let orderRef: string | undefined;
          if (result.operationRef) { try { orderRef = (JSON.parse(result.operationRef) as { orderRef?: string }).orderRef; } catch { orderRef = undefined; } }
          setMyInvitations((rows) => rows.map((row) => row.invitationId === invitationId ? { ...row, status, ...(orderRef ? { orderRef } : {}) } : row));
        } catch (error) {
          // 回应失败：之前 void 调用直接变 unhandled rejection，按钮还解了锁。
          // 现在错误留在页内，邀请状态不动，可重试。
          setInvitationError(error instanceof Error ? error.message : "回应没有提交成功，请重试。");
        } finally { setInvitationBusyId(undefined); }
      }
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.detailTitle}>{subPage.title}</Text>
            <Text selectable style={styles.detailSub}>{subPage.desc}</Text>
            <View style={styles.fallbackSection}><View style={styles.detailSectionHead}><Text selectable style={styles.detailSectionTitle}>我发起的场景</Text></View>
              {myScenes.length === 0 ? <View style={styles.prototypeCard}><Text selectable style={styles.prototypeCardTitle}>还没有发起场景</Text></View> : myScenes.map((row) => <View key={row.sceneId} style={styles.prototypeCard}><Text selectable style={styles.prototypeCardTitle}>{row.title}</Text><Text selectable style={styles.prototypeCardDesc}>{row.status} · {new Date(row.startsAt).toLocaleString()}</Text></View>)}
            </View>
            <View style={styles.fallbackSection}><View style={styles.detailSectionHead}><Text selectable style={styles.detailSectionTitle}>收到的真人邀请</Text></View>
              {myInvitations.length === 0 ? <View style={styles.prototypeCard}><Text selectable style={styles.prototypeCardTitle}>还没有收到邀请</Text></View> : myInvitations.map((row) => <View key={row.invitationId} style={styles.prototypeCard}><Text selectable style={styles.prototypeCardTitle}>{row.card.what ?? "场景邀请"}</Text><Text selectable style={styles.prototypeCardDesc}>{row.card.where ?? "地点待确认"} · {row.card.when ?? "时间待确认"}</Text><Text selectable style={styles.prototypeCardDesc}>{row.plannedBudget ? `${row.plannedBudget.toLocaleString()} ${row.currency || "VND"}` : "金额待双方确认"} · {row.status}</Text>{row.orderRef ? <Text selectable style={styles.prototypeCardDesc}>已生成订单 · {row.orderRef}</Text> : null}{row.status === "PENDING" ? <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}><Pressable disabled={invitationBusyId === row.invitationId} onPress={() => void respond(row.invitationId, "ACCEPTED")} style={styles.lightCta}><Text selectable style={styles.lightCtaText}>接受</Text></Pressable><Pressable disabled={invitationBusyId === row.invitationId} onPress={() => void respond(row.invitationId, "DECLINED")} style={styles.lightCta}><Text selectable style={styles.lightCtaText}>拒绝</Text></Pressable></View> : null}</View>)}
            {invitationError ? <Text selectable style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{invitationError}</Text> : null}
            </View>
            <View style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text selectable style={styles.detailSectionTitle}>场景记忆 (R15.13 P2 · 真实数据)</Text>
              </View>
              {memoriesLoadState === "loading" ? (
                <View style={styles.prototypeCard}>
                  <Text selectable style={styles.prototypeCardTitle}>加载中…</Text>
                  <Text selectable style={styles.prototypeCardDesc}>正在从 Scene 服务拉取你的历史记忆</Text>
                </View>
              ) : memoriesLoadState === "error" ? (
                <View style={styles.prototypeCard}>
                  <Text selectable style={styles.prototypeCardTitle}>记忆不可用</Text>
                  <Text selectable style={styles.prototypeCardDesc}>未登录或未写入任何 Scene Outcome</Text>
                </View>
              ) : memories.length === 0 ? (
                <View style={styles.prototypeCard}>
                  <Text selectable style={styles.prototypeCardTitle}>还没有记忆</Text>
                  <Text selectable style={styles.prototypeCardDesc}>场景结束后由发起方记录实际花费与时长，才会生成一条 Memory（host + guest 双视角可见）。App 目前还没有「记录结果」的入口 —— 在它接上之前，这里不会有内容。</Text>
                </View>
              ) : (
                memories.map((m) => (
                  <View key={m.memoryId} style={styles.prototypeCard}>
                    <Text selectable style={styles.prototypeCardTitle}>
                      {m.sceneType ?? "Scene"} · {m.role === "HOST" ? "我是主人" : "我是客人"}
                    </Text>
                    <Text selectable style={styles.prototypeCardDesc}>
                      实际花费 {(m.actualSpend / 1000).toFixed(0)}k {m.currency ?? ""}
                      {m.durationMin ? ` ·  ${m.durationMin} 分钟` : ""}
                      {typeof m.rating === "number" ? ` · 评分 ${(m.rating * 100).toFixed(0)}` : ""}
                    </Text>
                    {m.notes ? <Text selectable style={styles.prototypeCardDesc}>{m.notes}</Text> : null}
                  </View>
                ))
              )}
            </View>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
              <Text selectable style={styles.lightCtaText}>返回我的</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "appbehavior") {
      const checks = [
        ["安全区域", "底部操作不能被系统手势区域遮挡。"],
        ["键盘", "输入需求时保留草稿；键盘出现后仍能滚动并看到继续按钮。"],
        ["返回", "系统返回操作不能导致重复提交。"],
        ["冷启动", "恢复本地草稿和上次安全页面；未确认操作不能显示成功。"],
        ["后台恢复", "重新获取进度、付款和邀请状态；旧数据明确标记可能过期。"],
        ["深链", "推送可以直接打开对应任务页面，但必须先校验权限。"],
        ["离线重试", "离线期间保留待确认操作；恢复后用户明确重试并避免重复执行。"],
        ["通知疲劳", "安全、付款和必须处理的事项可即时通知；普通状态变化合并提醒。"]
      ];

      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.appBehaviorTitle}>设置与隐私 · 安全</Text>
            <SecuritySettings
              retentionDays={securityRetention}
              onRetentionChange={setSecurityRetention}
              screenshotWarnEnabled={screenshotWarn}
              onToggleScreenshotWarn={setScreenshotWarn}
              sessionClient={sessionClient}
            />
            <Text selectable style={[styles.appBehaviorTitle, { marginTop: 24 }]}>应用行为检查</Text>
            {checks.map(([title, desc], index) => (
              <View key={title} style={[styles.appBehaviorCard, index === checks.length - 1 && styles.appBehaviorCardDark]}>
                <Text selectable style={[styles.appBehaviorCardTitle, index === checks.length - 1 && styles.appBehaviorCardTitleDark]}>{title}</Text>
                <Text selectable style={[styles.appBehaviorCardDesc, index === checks.length - 1 && styles.appBehaviorCardDescDark]}>{desc}</Text>
              </View>
            ))}
            <Text selectable style={[styles.appBehaviorTitle, { marginTop: 24 }]}>隐私与数据</Text>
            <Text selectable style={styles.appBehaviorCardDesc}>
              依据《个人数据保护法》91/2025/QH15 第 31 条 (访问权) 与第 32 条 (删除权), 你可以随时下载或删除 Proxy 保存的个人数据。
            </Text>
            <Text selectable style={styles.appBehaviorCardDesc}>
              如需联系 DPO (数据保护官) 或申诉数据处理问题, 请发邮件至 privacy@proxy.vn (最终地址以《服务协议》§53 为准)。依据 PDP 91/2025/QH15 Art. 13, Proxy 已指定 DPO 负责监管个人数据处理活动及处理用户申诉。
            </Text>
            {/* TWIN-SIGNALS-001 / MEDIA-DWELL-001: 动态浏览统计总闸。默认开
                （分身偏好靠它），一句话说清记什么、用来干什么，一键可关。
                这个开关现在也管着"看了哪张照片多久"的更细粒度记录——粒度
                变细了，说明文案要跟着说清楚，不能让文案还停在"哪条动态"。 */}
            <View style={styles.socialSettingRow}>
              <View style={styles.socialAccountCopy}>
                <Text selectable style={styles.socialSettingName}>动态浏览统计</Text>
                <Text selectable style={styles.socialSettingDesc}>记录你看过哪些动态、多图动态里具体看了哪张照片多久，用于给你推更对味的内容。关掉后不再记录。</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: behaviorAnalytics }}
                accessibilityLabel="动态浏览统计开关"
                onPress={toggleBehaviorAnalytics}
                style={[styles.socialSwitch, behaviorAnalytics ? styles.socialSwitchOn : null]}
              >
                <View style={[styles.socialSwitchDot, behaviorAnalytics ? styles.socialSwitchDotOn : null]} />
              </Pressable>
            </View>
            <PrivacySettings
              client={resolvePrivacyRequestClient({ authClient: sessionAuthClient })}
            />
            <PreciseLocationCard
              client={resolveLocationConsentClient({ authClient: sessionAuthClient })}
            />
            <Pressable onPress={() => setSubPage(undefined)} style={styles.appBehaviorReturn}>
              <Text selectable style={styles.appBehaviorReturnText}>返回我的</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialidentity") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.socialAccountsContent}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.socialAccountsTitle}>社媒账户</Text>
            <Text selectable style={styles.socialAccountsSub}>管理你的外部社交平台。账号、链接和公开范围都由你控制。</Text>
            <CreatorInvitationCard />
            <View style={styles.socialShareBox}>
              <View style={styles.socialSettingsHead}><Text selectable style={styles.socialSettingsTitle}>合作</Text><Text selectable style={styles.socialSettingsHint}>{collaboration.enabled ? "已开放" : "未开放"}</Text></View>
              <View style={styles.socialSettingRow}><View style={styles.socialAccountCopy}><Text selectable style={styles.socialSettingName}>接受合作邀请</Text><Text selectable style={styles.socialSettingDesc}>关闭后不影响普通账号使用</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: collaboration.enabled }} onPress={() => setCollaboration((v) => ({ ...v, enabled: !v.enabled }))} style={[styles.socialSwitch, collaboration.enabled ? styles.socialSwitchOn : null]}><View style={[styles.socialSwitchDot, collaboration.enabled ? styles.socialSwitchDotOn : null]} /></Pressable></View>
              <Text selectable style={styles.socialEditorLabel}>合作类型</Text>
              <View style={styles.socialVisibilityRow}>{["探店", "UGC", "拍摄", "同行", "其他"].map((type) => <Pressable key={type} onPress={() => setCollaboration((v) => ({ ...v, types: v.types.includes(type) ? v.types.filter((x) => x !== type) : [...v.types, type] }))} style={[styles.socialVisibilityButton, collaboration.types.includes(type) ? styles.socialVisibilityButtonOn : null]}><Text selectable style={[styles.socialVisibilityText, collaboration.types.includes(type) ? styles.socialVisibilityTextOn : null]}>{type}</Text></Pressable>)}</View>
              <Text selectable style={styles.socialEditorLabel}>报价（可选）</Text><TextInput placeholder="例如：500,000 VND / 次" style={styles.socialEditorInput} value={collaboration.rate} onChangeText={(rate) => setCollaboration((v) => ({ ...v, rate }))} />
              <Text selectable style={styles.socialEditorLabel}>合作联系方式</Text><TextInput placeholder="合作建立后开放" style={styles.socialEditorInput} value={collaboration.contact} onChangeText={(contact) => setCollaboration((v) => ({ ...v, contact }))} />
            </View>
            <View style={styles.socialAccountList}>
            {socialAccounts.map((account) => (
              <Pressable key={account.key} onPress={() => setSocialEditor({ ...account })} style={styles.socialAccountRow}>
                <View style={[styles.socialAccountIcon, account.dark ? styles.socialAccountIconDark : null]}>
                  <Text selectable style={[styles.socialAccountIconText, account.dark ? styles.socialAccountIconTextDark : null]}>{account.mark}</Text>
                </View>
                <View style={styles.socialAccountCopy}>
                  <Text selectable style={styles.socialAccountName}>{account.name}</Text>
                  <Text selectable numberOfLines={1} style={styles.socialAccountHandle}>{account.handle || "未关联"}</Text>
                  <Text selectable numberOfLines={1} style={styles.socialAccountUrl}>{account.url ? account.url.replace(/^https?:\/\/(www\.)?/, "") : "添加账号后可生成主页链接"}</Text>
                </View>
                <View style={styles.socialAccountTrailing}>
                  <View style={[styles.socialAccountState, account.visibility !== "仅自己" ? styles.socialAccountStateActive : null]}><Text selectable style={[styles.socialAccountStateText, account.visibility !== "仅自己" ? styles.socialAccountStateTextActive : null]}>{account.handle ? account.visibility : "关联"}</Text></View>
                  <Text selectable style={styles.socialAccountChev}>›</Text>
                </View>
              </Pressable>
            ))}
            </View>

            <View style={styles.socialSettingsHead}><Text selectable style={styles.socialSettingsTitle}>展示设置</Text><Text selectable style={styles.socialSettingsHint}>按需开放</Text></View>
            {([['merchant', '商家合作资料', '允许商家在合作场景查看你已开放的社媒账户。'], ['profile', '个人主页入口', '在个人主页显示一个轻量"社媒"入口，不直接铺开账号。'], ['influence', '影响力信息', '后续可向商家展示粉丝量等信息，默认关闭。']] as const).map(([key, title, desc]) => (
              <View key={key} style={styles.socialSettingRow}>
                <View style={styles.socialAccountCopy}><Text selectable style={styles.socialSettingName}>{title}</Text><Text selectable style={styles.socialSettingDesc}>{desc}</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: socialSettings[key] }} onPress={() => setSocialSettings((current) => ({ ...current, [key]: !current[key] }))} style={[styles.socialSwitch, socialSettings[key] ? styles.socialSwitchOn : null]}><View style={[styles.socialSwitchDot, socialSettings[key] ? styles.socialSwitchDotOn : null]} /></Pressable>
              </View>
            ))}

            <View style={styles.socialShareBox}>
              <View style={styles.socialSettingsHead}><Text selectable style={styles.socialSettingsTitle}>公开分享链接</Text><Text selectable style={styles.socialSettingsHint}>可选</Text></View>
              {/* SHARE-LINK-001: 分享链接里的用户名必须是当前登录用户。之前这里写死
                  了测试账号，等于每个用户分享出去的都是别人的主页。空 handle 时
                  禁用分享 —— 发一个带空用户名的残链接出去更糟。 */}
              {(() => {
                const shareHandle = profileDraft.handle.replace(/^@+/, "");
                return (
                  <View style={styles.socialShareLine}><Text selectable numberOfLines={1} style={styles.socialShareLink}>{shareHandle ? `pxy.app/${shareHandle}/social` : "设置你的 Proxy ID 后可分享"}</Text><Pressable disabled={!shareHandle} onPress={() => void Share.share({ message: `https://pxy.app/${shareHandle}/social` })} style={styles.socialShareButton}><Text selectable style={styles.socialShareButtonText}>分享</Text></Pressable></View>
                );
              })()}
              <Text selectable style={styles.socialShareNote}>只有你设置为"公开展示"的账号会出现在这个分享页。商家可见账号不会自动公开。</Text>
            </View>
          </ScrollView>
          <Modal animationType="slide" onRequestClose={() => setSocialEditor(undefined)} transparent visible={Boolean(socialEditor)}>
            <Pressable onPress={() => setSocialEditor(undefined)} style={styles.socialEditorOverlay}>
              {socialEditor ? <Pressable onPress={(event) => event.stopPropagation()} style={styles.socialEditorSheet}>
                <View style={styles.socialEditorGrabber} />
                <View style={styles.socialEditorHead}><Text selectable style={styles.socialEditorTitle}>{socialEditor.name}</Text><Pressable onPress={() => setSocialEditor(undefined)} style={styles.socialEditorClose}><Text selectable style={styles.socialEditorCloseText}>×</Text></Pressable></View>
                <Text selectable style={styles.socialEditorNote}>账号和主页链接用于跳转外部平台。展示范围可单独控制。</Text>
                <Text selectable style={styles.socialEditorLabel}>账号</Text><TextInput onChangeText={(handle) => setSocialEditor((current) => current ? { ...current, handle } : current)} style={styles.socialEditorInput} value={socialEditor.handle} />
                <Text selectable style={styles.socialEditorLabel}>主页链接</Text><TextInput autoCapitalize="none" keyboardType="url" onChangeText={(url) => { setSocialOpenError(undefined); setSocialEditor((current) => current ? { ...current, url } : current); }} style={styles.socialEditorInput} value={socialEditor.url} />
                <Text selectable style={styles.socialEditorLabel}>谁可以看到</Text><View style={styles.socialVisibilityRow}>{(["仅自己", "商家可见", "公开展示"] as const).map((visibility) => <Pressable key={visibility} onPress={() => setSocialEditor((current) => current ? { ...current, visibility } : current)} style={[styles.socialVisibilityButton, socialEditor.visibility === visibility ? styles.socialVisibilityButtonOn : null]}><Text selectable style={[styles.socialVisibilityText, socialEditor.visibility === visibility ? styles.socialVisibilityTextOn : null]}>{visibility}</Text></Pressable>)}</View>
                <Pressable disabled={!socialEditor.url} onPress={() => { const url = socialEditor.url.trim(); if (url) void Linking.openURL(/^https?:\/\//i.test(url) ? url : `https://${url}`).catch(() => setSocialOpenError("外部主页打不开，请检查链接后重试。")); }} style={styles.socialOpenLink}><Text selectable style={styles.socialOpenLinkText}>打开外部主页</Text><Text selectable style={styles.socialOpenLinkText}>↗</Text></Pressable>
                {socialOpenError ? <Text selectable style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{socialOpenError}</Text> : null}
                <Pressable onPress={() => { setSocialAccounts((current) => current.map((account) => account.key === socialEditor.key ? socialEditor : account)); setSocialEditor(undefined); }} style={styles.socialSave}><Text selectable style={styles.socialSaveText}>保存</Text></Pressable>
              </Pressable> : null}
            </Pressable>
          </Modal>
        </View>
      );
    }

    if (subPage.route === "socialprivacy") {
      const levels = [
        ["1", "陌生浏览", "Proxy 主页、已验证状态、公开社媒", "最小公开"],
        ["2", "开始聊天", "仍优先使用 Proxy Chat；可开放指定社媒", "可选"],
        ["3", "订单成立", "可开放 Zalo / 电话用于现实履约", "合作后"],
        ["4", "订单结束", "临时联系权限可自动关闭", "可恢复"]
      ];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.detailTitle}>可见范围</Text>
            <View style={styles.visibilityLadder}>
              {levels.map(([step, title, desc, tag]) => (
                <View key={step} style={styles.visibilityStep}>
                  <View style={styles.visibilityIndex}><Text selectable style={styles.visibilityIndexText}>{step}</Text></View>
                  <View style={styles.visibilityCopy}>
                    <Text selectable style={styles.visibilityTitle}>{title}</Text>
                    <Text selectable style={styles.visibilityDesc}>{desc}</Text>
                  </View>
                  <Text selectable style={styles.visibilityTag}>{tag}</Text>
                </View>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text selectable style={styles.detailSectionTitle}>当前规则</Text>
              <Text selectable style={styles.detailSectionHint}>可编辑</Text>
            </View>
            {[["TT", "TikTok", "公开"], ["Z", "Zalo", "合作后"], ["☎", "手机号", "合作后 · 订单结束可关闭"]].map(([mark, title, desc]) => (
              <View key={title} style={styles.socialDetailRow}>
                <View style={styles.socialDetailIcon}><Text selectable style={styles.socialDetailIconText}>{mark}</Text></View>
                <View style={styles.socialDetailCopy}>
                  <Text selectable style={styles.socialDetailLabel}>{title}</Text>
                  <Text selectable style={styles.socialDetailDesc}>{desc}</Text>
                </View>
                <Text selectable style={styles.socialDetailChev}>›</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialanalytics") {
      // PROFILE-VISIT-001: "主页访问"接了 ListProfileViewStats，是真数字；
      // 后面几步（合格聊天/机会/订单/复购）没有对应的事件类型，仍是示例——
      // 漏斗的宽度条基于示例比例画，不是从真实主页访问数折算出来的。
      const funnel = [["主页访问", "100%", dash(socialAnalyticsOpens)], ["合格聊天", "54%", "47"], ["机会", "34%", "18"], ["订单", "22%", "9"], ["复购", "11%", "4"]] as const;
      const sources = [["Proxy 市场", "612", "26", "5"], ["TikTok", "338", "11", "2"], ["Zalo QR", "214", "8", "2"], ["Instagram", "120", "2", "0"]];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.detailTitle}>访问与转化</Text>
            {/* ANALYTICS-HONEST-001 / PROFILE-VISIT-001: "主页访问"这一步已经
                是真数字；合格聊天往后 4 步和下面的渠道来源表仍是示例占位
                （没有聊天资格判定、机会、订单、渠道归因的事件类型）。 */}
            <Text selectable style={styles.detailSub}>主页访问是真实数据；往后每一步和下方渠道来源仍是示例，做经营决策前请以实际到账和到店为准。</Text>
            <View style={styles.funnelCard}>
              {funnel.map(([label, width, value]) => (
                <View key={label} style={styles.funnelRow}>
                  <Text selectable style={styles.funnelLabel}>{label}</Text>
                  <View style={styles.funnelTrack}><Gradient from="#9D74E8" to="#6F36BE" style={[styles.funnelBar, { width }]} /></View>
                  <Text selectable style={styles.funnelValue}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.sourceTable}>
              <View style={[styles.sourceRow, styles.sourceHead]}><Text selectable style={styles.sourceHeadText}>来源</Text><Text selectable style={styles.sourceHeadText}>访问</Text><Text selectable style={styles.sourceHeadText}>聊天</Text><Text selectable style={styles.sourceHeadText}>订单</Text></View>
              {sources.map(([source, visit, chat, order]) => (
                <View key={source} style={styles.sourceRow}><Text selectable style={styles.sourceName}>{source}</Text><Text selectable style={styles.sourceValue}>{visit}</Text><Text selectable style={styles.sourceValue}>{chat}</Text><Text selectable style={styles.sourceValue}>{order}</Text></View>
              ))}
            </View>
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteTitle}>平台信誉仍来自 Proxy</Text>
              <Text selectable style={styles.infoNoteText}>外部粉丝、点赞和播放量只帮助发现；准时、履约、Outcome 与复购才决定长期市场信誉。</Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "addfriend") {
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface relationship={relationshipClient} profileClient={profileClient} initialView="ADD_FRIEND" addFriendBackLabel="‹ 返回我的" viewer={{ name: profileDraft.name, handle: profileDraft.handle }} onBack={() => setSubPage(undefined)} onOpenConversation={(author, peerUserId) => { setSubPage(undefined); onOpenConversation?.(author, peerUserId); }} /></SwipeBackShell>;
    }

    if (subPage.route === "available") {
      if (availabilityPanel === "CALENDAR") {
        const days = nextDays(30);
        return contentWrapper(
          <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content}>
              <Pressable onPress={() => setAvailabilityPanel("ABILITIES")} style={styles.subPageBack}>
                <Text selectable style={styles.subPageBackText}>‹ 返回能力</Text>
              </Pressable>
              <Text selectable style={styles.detailTitle}>可用时间</Text>
              <Text selectable style={styles.availabilityLead}>固定规律只设一次；临时变化点日期覆盖。</Text>

              <View style={styles.availabilityRuleCard}>
                <View style={styles.availabilityRuleIcon}><ProxySymbolIcon color={color.ink} symbol="clock" size={22} /></View>
                <View style={styles.availabilityRuleCopy}>
                  <Text selectable style={styles.availabilityRuleKicker}>常用规律</Text>
                  <Text selectable style={styles.availabilityRuleValue}>{describeAvRule(avRule)}</Text>
                </View>
                <Pressable onPress={() => setAvRuleSheetOpen(true)} style={styles.availabilityEditButton}><Text selectable style={styles.availabilityEditText}>编辑</Text></Pressable>
              </View>

              <View style={styles.availabilityMonthCard}>
                <View style={styles.availabilityMonthHead}>
                  <Text selectable style={styles.availabilityMonthTitle}>未来 30 天</Text>
                  {Object.keys(avOverrides).length ? <Pressable onPress={() => setAvOverrides({})}><Text selectable style={styles.availabilityClear}>清除例外</Text></Pressable> : null}
                </View>
                <View style={styles.availabilityWeekHead}>{["一", "二", "三", "四", "五", "六", "日"].map((name) => <Text selectable key={name} style={styles.availabilityWeekName}>{name}</Text>)}</View>
                <View style={styles.availabilityMonthGrid}>
                  {Array.from({ length: days.length ? (days[0]!.date.getDay() + 6) % 7 : 0 }).map((_, index) => <View key={`blank-${index}`} style={styles.availabilityMonthBlank} />)}
                  {days.map((day) => {
                    const state = avStateFor(day.date, avRule, avOverrides);
                    const dateNumber = day.date.getDate();
                    return (
                      <Pressable key={day.key} onPress={() => setAvDaySheet({ key: day.key, label: day.label })} style={[styles.availabilityMonthDay, styles[`availabilityMonthDay_${state.type}`]]}>
                        <Text selectable style={[styles.availabilityMonthNumber, state.type === "off" && styles.availabilityMonthNumberOff]}>{dateNumber}</Text>
                        {state.type === "base" ? <View style={styles.availabilityBaseDot} /> : null}
                        {state.type === "off" ? <Text selectable style={styles.availabilityOffMark}>×</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.availabilityLegend}>
                  <Text selectable style={styles.availabilityLegendText}>● 规律可用</Text><Text selectable style={styles.availabilityLegendText}>绿色 全天</Text><Text selectable style={styles.availabilityLegendText}>描边 自定义</Text><Text selectable style={styles.availabilityLegendText}>× 休息</Text>
                </View>
              </View>
            </ScrollView>
            {avDaySheet ? <AvDaySheet day={avDaySheet} key={avDaySheet.key} onClose={() => setAvDaySheet(undefined)} onSet={(key, override) => setAvOverrides((prev) => { const next = { ...prev }; if (override) next[key] = override; else delete next[key]; return next; })} rule={avRule} /> : null}
          </View>
        );
      }
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => { setAvailabilityPanel("ABILITIES"); setSubPage(undefined); }} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.detailTitle}>能力与可用时间</Text>
            <Text selectable style={styles.detailSub}>维护你愿意接受邀请的能力。</Text>

            <Pressable onPress={() => setAvailabilityPanel("CALENDAR")} style={styles.availabilitySummaryCard}>
              <View style={styles.availabilityRuleIcon}><ProxySymbolIcon color={color.ink} symbol="clock" size={22} /></View>
              <View style={styles.availabilityRuleCopy}><Text selectable style={styles.prototypeCardTitle}>可用时间</Text><Text selectable style={styles.abilitySub}>{describeAvRule(avRule)} · {Object.keys(avOverrides).length} 个例外</Text></View>
              <Text selectable style={styles.walletActionArrow}>›</Text>
            </Pressable>

            <View style={styles.detailSectionHead}><Text selectable style={styles.detailSectionTitle}>我的能力</Text><Text selectable style={styles.detailSectionHint}>{abilities.length} 项 · {passportError ? "同步失败" : "已接 supply"}</Text></View>
            {passportError ? <Text selectable style={{ color: "#B00020", fontSize: 11, marginBottom: 6 }}>{passportError}</Text> : null}
            {abilities.map((ability) => (
              <View key={ability.id} style={styles.abilityCompactCard}>
                <View style={styles.abilityHead}>
                  <View style={styles.abilityIcon}><Text selectable style={styles.abilityIconText}>{ABILITY_SCHEMAS[ability.type].icon}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text selectable style={styles.prototypeCardTitle}>{ability.type}</Text>
                    <Text selectable style={styles.abilitySub}>{ABILITY_SCHEMAS[ability.type].subtitle}</Text>
                  </View>
                  <Pressable accessibilityLabel={`编辑${ability.type}`} onPress={() => setAbilitySheet({ mode: "EDIT", type: ability.type, id: ability.id })} style={styles.availabilityEditButton}><Text selectable style={styles.availabilityEditText}>编辑</Text></Pressable>
                </View>
                <View style={styles.abilityFieldChips}>{ability.fields.filter((field) => field.value.trim().length > 0).map((field) => <View key={field.label} style={styles.abilityFieldChip}><Text selectable style={styles.abilityFieldChipText}><Text selectable style={styles.abilityFieldChipLabel}>{field.label} </Text>{field.value}</Text></View>)}</View>
              </View>
            ))}
            <View style={styles.addAbilityRow}>{(["同行", "翻译", "拍照"] as AbilityType[]).map((type) => <Pressable key={type} accessibilityLabel={`添加${type}`} onPress={() => setAbilitySheet({ mode: "ADD", type })} style={styles.addAbilityChip}><Text selectable style={styles.addAbilityChipText}>＋ {type}</Text></Pressable>)}</View>

            <Pressable
              onPress={() => openSubPage("personalhub")}
              style={[styles.primaryCta, abilities.length === 0 && { opacity: 0.5 }]}
            >
              <Text selectable style={styles.primaryCtaText}>预览主页展示</Text>
            </Pressable>
          </ScrollView>
          {abilitySheet ? (
            <AbilitySheet
              initialFields={
                abilitySheet.mode === "EDIT" && abilitySheet.id
                  ? abilities.find((item) => item.id === abilitySheet.id)?.fields
                  : undefined
              }
              key={`${abilitySheet.mode}-${abilitySheet.type}-${abilitySheet.id ?? "new"}`}
              onClose={() => setAbilitySheet(undefined)}
              onSave={(type, fields, id) => {
                if (abilitySheet.mode === "EDIT" && id) {
                  setAbilities((prev) => prev.map((item) => (item.id === id ? { ...item, type, fields } : item)));
                } else {
                  setAbilities((prev) => [...prev, { id: `ability-${Date.now()}`, type, fields }]);
                }
                if (supply) {
                  const capMap: Record<AbilityType, string> = { "同行": "GUIDE", "翻译": "ZH", "拍照": "PHOTOGRAPHY" };
                  const cap = capMap[type];
                  if (cap) supply.declareCapability({ capability: cap }).catch((e) => setPassportError(e instanceof Error ? e.message : String(e)));
                }
                setAbilitySheet(undefined);
              }}
              sheet={abilitySheet}
            />
          ) : null}
          {/* 状态规则表全局挂载：hub 头像旁状态点与 available 页编辑按钮共用。
              之前只挂在 available 子页，hub 上点状态点毫无反应。 */}
          <AvRuleSheet onClose={() => setAvRuleSheetOpen(false)} onSave={setAvRule} open={avRuleSheetOpen} rule={avRule} />
          {avDaySheet ? (
            <AvDaySheet
              day={avDaySheet}
              key={avDaySheet.key}
              onClose={() => setAvDaySheet(undefined)}
              onSet={(key, override) =>
                setAvOverrides((prev) => {
                  const next = { ...prev };
                  if (override) next[key] = override;
                  else delete next[key];
                  return next;
                })
              }
              rule={avRule}
            />
          ) : null}
        </View>
      );
    }

    if (subPage.route === "wallet") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>钱包与结算</Text>
            <Text selectable style={styles.subPageDesc}>只展示 Proxy 真正经手或需要记录的资金状态。账本接口未接入前不编造余额。</Text>

            <View style={styles.walletDarkCard}>
              <Text selectable style={styles.walletDarkLabel}>可用余额</Text>
              <Text selectable style={styles.walletDarkAmount}>—</Text>
              <Text selectable style={styles.walletDarkHint}>账本未接入，未知不画数</Text>
            </View>

            <View style={styles.walletCard}>
              <Text selectable style={styles.walletCardLabel}>待结算收入</Text>
              <Text selectable style={styles.walletCardValue}>—</Text>
              <Text selectable style={styles.walletCardHint}>来自平台支付订单（待账本接入）</Text>
            </View>

            <View style={styles.walletCard}>
              <Text selectable style={styles.walletCardLabel}>直接结算记录</Text>
              <Text selectable style={styles.walletCardHint}>个人时间 / 技能服务可由双方直接结算；这里只保留合作确认与双方状态。</Text>
            </View>

            <Pressable onPress={() => openSubPage("myorders")} style={styles.walletAction} accessibilityLabel="现场结算记录">
              <Text selectable style={styles.walletActionIcon}>₫</Text>
              <View style={styles.walletActionBody}>
                <Text selectable style={styles.walletActionLabel}>现场结算记录</Text>
                <Text selectable style={styles.walletActionDesc}>查看双方确认状态</Text>
              </View>
              <Text selectable style={styles.walletActionArrow}>›</Text>
            </Pressable>

            <Pressable onPress={() => openSubPage("myorders")} style={styles.walletBtnLight} accessibilityLabel="退款记录">
              <Text selectable style={styles.walletBtnLightText}>退款记录</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "personalmanage") {
      // PROFILE-QR-004：二维码的常规能力（复制 / 存图 / 放大页）以前只挂在
      // 商家路径才到的 personalqr 子页上，这里只有「分享链接」一个按钮。
      // handle 非法时 payload 为 null —— 不画假码，也不给存假码的按钮。
      const manageQrPayload = buildContactCard({ name: profileDraft.name, handle: profileDraft.handle });
      const manageQrCaption = profileDraft.handle ? `@${profileDraft.handle.replace(/^@+/, "")}` : "";
      const managePage = contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>个人管理</Text>
            <Text selectable style={styles.subPageSub}>基本信息、二维码、状态管理都集中在这里。</Text>

            <Text selectable style={styles.customSectionTitle}>基本信息</Text>
            <Text selectable style={styles.customSectionHint}>公开主页展示</Text>
            <View style={styles.profileManageRow}>
              <View style={styles.profileManageAva}>
                {profileAvatarUri ? <CircularAvatarImage accessibilityLabel={`${profileDraft.name}头像`} size={88} uri={profileAvatarUri} /> : <Text selectable style={styles.profileManageAvaLetter}>{profileDraft.name.slice(0, 1).toUpperCase()}</Text>}
              </View>
              <View style={styles.profileManageCopy}>
                <Text selectable style={styles.profileManageName}>{profileDraft.name}</Text>
                <Text selectable style={styles.profileManageHandle}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
                <Text selectable style={styles.profileManageCity}>{profileDraft.city || "河内"}</Text>
              </View>
              <Pressable accessibilityLabel="编辑头像" onPress={() => void chooseProfileAvatar()} style={styles.profileManageEdit}>
                <Text selectable style={styles.profileManageEditText}>换头像</Text>
              </Pressable>
            </View>
            <Pressable accessibilityLabel="编辑资料" onPress={() => setProfileEditorOpen(true)} style={styles.profileManageEdit}>
              <Text selectable style={styles.profileManageEditText}>编辑资料</Text>
            </Pressable>

            <Text selectable style={styles.customSectionTitle}>二维码</Text>
            <Text selectable style={styles.customSectionHint}>保存、复制、放大都在这</Text>
            <QrCard
              title={`${profileDraft.name} · Proxy`}
              desc={manageQrPayload ? "扫码打开你的 Proxy 主页；也可以直接存图或复制链接发给好友。" : "还没设置个人主页名，先起一个才能生成二维码。"}
              qrValue={manageQrPayload ?? undefined}
              qrSize={160}
              shotRef={qrCardShotRef}
              notice={qrNotice}
              alignCenter
              onQrPress={manageQrPayload ? () => setQrZoomOpen(true) : undefined}
              actions={manageQrPayload ? [
                { label: "复制 @handle", onPress: () => void copyQrText(manageQrCaption) },
                { label: "保存到相册", onPress: () => void saveQrToAlbum(qrCardShotRef), primary: true },
                { label: "我的二维码页 ›", onPress: () => openSubPage("personalqr", { backRoute: "personalmanage" }) }
              ] : [{ label: "去设置主页名", onPress: () => setProfileEditorOpen(true), primary: true }]}
            />

            <Text selectable style={styles.customSectionTitle}>状态管理</Text>
            <Text selectable style={styles.customSectionHint}>决定你出现在人物发现、机会分发的方式</Text>
            <Pressable
              accessibilityLabel="选择状态"
              onPress={() => setAvailabilityOpen(true)}
              style={styles.profileManageStatusRow}
            >
              <View style={styles.profileManageStatusDot} />
              <View style={styles.profileManageStatusCopy}>
                <Text selectable style={styles.profileManageStatusLabel}>当前状态</Text>
                <Text selectable style={styles.profileManageStatusValue}>● {availabilityLabel(availability)}</Text>
              </View>
              <Text selectable style={styles.profileManageStatusChev}>›</Text>
            </Pressable>
          </ScrollView>

          <AvailabilitySheet current={availability} open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} onSelect={(next) => setAvailability(next)} />

        </View>
      );
      // 这张卡上的码也能点开放大（PROFILE-QR-004 的常规能力）。放大层必须和
      // contentWrapper 平级挂，不能塞进页面外壳里 —— 见 personalqr 分支同样的说明。
      // 两个分支互斥（同一次渲染只有一个 subPage.route），所以共用 qrZoomShotRef 安全。
      return (
        <>
          {managePage}
          {renderProfileEditor()}
          {manageQrPayload ? (
            <QrZoomOverlay
              actions={[
                { label: "复制 @handle", onPress: () => void copyQrText(manageQrCaption) },
                { label: "保存到相册", onPress: () => void saveQrToAlbum(qrZoomShotRef), primary: true },
                { label: "分享二维码图", onPress: () => void shareQrImage(qrZoomShotRef) },
              ]}
              notice={qrNotice}
              onClose={() => setQrZoomOpen(false)}
              shotRef={qrZoomShotRef}
              title={`${profileDraft.name} · 我的二维码`}
              value={manageQrPayload}
              caption={manageQrCaption}
              visible={qrZoomOpen}
            />
          ) : null}
        </>
      );
    }

    if (subPage.route === "personalhub") {
      // AI-TWIN-POST-AUDIENCE-004（2026-09-22）：TARGETED 帖子是「AI 分身 →
      // 帖文编排」私密副空间的内容，不是这个人公开主页的一部分——主页
      // （个人主页/ProfileTabs）只显示非 TARGETED 帖子，跟 aiidentity 分支
      // 的 targetedSpacePosts 互斥，两边不重叠。
      const personalHubPosts = profilePosts.filter((post) => post.visibility !== "TARGETED");
      const personalPhotos = personalHubPosts.flatMap((post) => (profileMedia[post.postId] ?? []).map((item, index) => ({ item, index, postId: post.postId }))).filter((entry) => entry.item.mediaType === "IMAGE");
      const viewedItems = profileViewer ? profileMedia[profileViewer.postId] ?? [] : [];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.personalHubContent}>
            <View style={styles.personalTopbar}>
              <Pressable accessibilityLabel="返回" onPress={() => setSubPage(undefined)} style={styles.personalTopbarButton}>
                <Text selectable style={styles.personalTopbarIcon}>‹</Text>
              </Pressable>
              <View style={styles.personalTopbarTools}>
                <Pressable accessibilityLabel="分析" style={styles.personalTopbarIconBtn} onPress={() => setInsightsSheetOpen(true)}>
                  <ProxyIcon name="chart" color={color.ink} size={20} />
                </Pressable>
                <Pressable accessibilityLabel="搜索" style={styles.personalTopbarIconBtn} onPress={() => { setSearchQuery(""); setProfileSearchResults(undefined); setSearchSheetOpen(true); }}>
                  <ProxyIcon name="search" color={color.ink} size={20} />
                </Pressable>
                <Pressable accessibilityLabel="更多" style={styles.personalTopbarIconBtn} onPress={() => { cancelPendingModal(); setSettingsSheetOpen(true); }}>
                  <ProxyIcon name="ellipsis" color={color.ink} size={20} />
                </Pressable>
              </View>
            </View>

            {/* PERSONAL-PROFILE-PARITY-001: 参考稿 (Threads R2 本人视角) 是
                名字在左、头像在右的一行；场景徽章功能本身参考稿里不存在，
                场景足迹入口不该挤进这一行跟头像/名字抢位置——拆成头像行
                下面单独一块，跟参考稿的头部密度对齐。 */}
            <View style={styles.personalHead}>
              <View style={styles.personalNameBlock}>
                <Text selectable numberOfLines={1} style={styles.personalName}>{profileDraft.name}</Text>
                <Text selectable numberOfLines={1} style={styles.personalHandleSub}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
              </View>
              <View style={styles.personalAvaWrap}>
                <Pressable accessibilityLabel="更换头像" onPress={() => void chooseProfileAvatar()} style={styles.personalAva}>
                  {profileAvatarUri ? <CircularAvatarImage accessibilityLabel={`${profileDraft.name}头像`} size={82} uri={profileAvatarUri} /> : <Text selectable style={styles.personalAvaLetter}>{profileDraft.name.slice(0, 1).toUpperCase()}</Text>}
                </Pressable>
              </View>
            </View>
            <View style={styles.personalIntroRow}>
              {onOpenRealitySceneMap ? (
                <Pressable onPress={onOpenRealitySceneMap} style={styles.personalSceneEntry}>
                  {/* MAP-FOOTPRINT-LOGO-001：场景足迹入口用原型「场景足迹」logo，不再用通用 route。 */}
                  <ProxyIcon color={color.violet} name="footprint" size={20} />
                  <View style={styles.personalSceneCopy}>
                    <Text selectable style={styles.personalSceneTitle}>场景足迹</Text>
                  </View>
                  <Text selectable style={styles.personalSceneChevron}>›</Text>
                </Pressable>
              ) : null}
              <Text selectable numberOfLines={2} style={styles.personalIntroText}>{profileDraft.bio || "介绍一下自己吧"}</Text>
            </View>

            <View style={styles.personalBio}>
              {/* PERSONAL-IDENTITY-DEDUPE-001: 这里以前有一行"链接"，图标是外链箭头，
                  文字却是 profileDraft.handle —— 跟上面 personalHandleSub 是同一个
                  handle，不是外部社媒链接（profileDraft 压根没有那个字段），也没有
                  onPress。参考稿的 .link 行放的是真实外链（instagram.com/...），这里
                  没有对应数据源，硬摆一遍自己的 handle 就是纯重复，删掉。 */}
              <View style={styles.personalTopics}>
                {(() => {
                  const topics = profileDraft.city ? [profileDraft.city] : [];
                  return topics.map((t) => (
                    <View key={t} style={styles.personalTopicPill}><Text selectable style={styles.personalTopicText}>{t}</Text></View>
                  ));
                })()}
              </View>
              <View style={styles.personalStatRow}>
                <Text selectable style={styles.personalStatText}>
                  <Text selectable style={styles.personalStatValue}>{dash(personalViews30)}</Text> 次浏览 · 最近 30 天 ›
                </Text>
                {/* FOLLOWER-FACES-001: 以前这里是三个写死的字母头像（M/A/L），不管谁
                    关注都长一个样 —— 数字是真的，脸是假的。最近关注者列表接口还没
                    有（只有计数），先把假脸拿掉只留真数字，不拿装饰冒充真人预览。 */}
                <Text selectable style={styles.personalFollowersCount}><Text selectable style={styles.personalFollowersValue}>{dash(personalFollowCounts?.followers)}</Text> 位关注者</Text>
              </View>
            </View>

            {/* PROFILE-POSTS-FAILURE-001: 拉动态失败时把话说出来 —— 不留一条
                「0 条动态」，那看起来就是「你还没发过动态」。样式跟同文件里
                profileSaveError 的写法一致（内联，字号 >= 11）。 */}
            {profilePostsState === "failed" ? (
              <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 10, backgroundColor: "#fdf2f2", borderWidth: 1, borderColor: "#f3c6c6", flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text selectable style={{ flex: 1, color: "#B3261E", fontSize: 11, lineHeight: 15 }}>动态没拉到 —— 可能是网络或登录态的问题，不是你没有动态。</Text>
                <Pressable onPress={() => setProfilePostsReload((n) => n + 1)} accessibilityLabel="重新拉取动态" style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#B3261E" }}>
                  <Text selectable style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>重试</Text>
                </Pressable>
              </View>
            ) : null}

            {/* BADGE-WALL-001: 徽章墙 —— 得过的点亮，没得过的置灰并给出来条件
                （desc 就是条件原文）。计数/集合类给进度（还差几家），hasAny 和
                足迹类没有进度概念，只给条件。失败可重试，空墙是“还没开始玩”。 */}
            <View style={styles.badgeWall}>
              <Text selectable style={styles.badgeWallTitle}>场景徽章 · {badgeEarnedIds ? SCENE_BADGES.filter((b) => badgeEarnedIds.includes(b.id)).length : "—"}/{SCENE_BADGES.length}</Text>
              {badgeWallFailed ? (
                <View style={styles.badgeWallFailed}>
                  <Text selectable style={styles.badgeWallFailedText}>徽章没拉到 —— 不是没有徽章。</Text>
                  <Pressable onPress={() => setBadgeWallNonce((n) => n + 1)} accessibilityLabel="重新拉取徽章" style={styles.badgeWallRetry}><Text selectable style={styles.badgeWallRetryText}>重试</Text></Pressable>
                </View>
              ) : badgeEarnedIds === undefined ? (
                <Text selectable style={styles.badgeWallLoading}>正在加载徽章…</Text>
              ) : (
                <View style={styles.badgeGrid}>
                  {SCENE_BADGES.map((badge) => {
                    const earned = badgeEarnedIds.includes(badge.id);
                    const progress = badgeProgress(badge.id, badgeHistoryIds);
                    return (
                      <View key={badge.id} style={[styles.badgeTile, !earned && styles.badgeTileLocked]} accessibilityLabel={earned ? `已获得${badge.name}` : badge.name}>
                        <Text selectable style={styles.badgeIcon}>{badge.icon}</Text>
                        <Text selectable style={styles.badgeName}>{badge.name}</Text>
                        {!earned ? <Text selectable style={styles.badgeDesc}>{badge.desc}</Text> : null}
                        {!earned && progress !== undefined && progress.done < progress.total ? <Text selectable style={styles.badgeProgress}>还差 {progress.total - progress.done} 家</Text> : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            <ProfileTabs
              profileDraft={profileDraft}
              profileAvatarUri={profileAvatarUri}
              pinnedIds={personalPinnedIds}
              posts={personalHubPosts}
              mediaByPost={profileMedia}
              photos={personalPhotos}
              replies={personalReplyEntries}
              replyTargets={personalReplyTargets}
              savedPosts={personalSavedPosts}
              savedScenes={personalSavedScenes}
              taggedPosts={personalTaggedPosts}
              savedFailed={personalSavedFailed}
              repliesFailed={personalRepliesFailed}
              taggedFailed={personalTaggedFailed}
              // PROFILE-POSTS-FAILURE-001: 上面那条横幅只解决了「条数别显示 0」；
              // 帖子列表本身还是空数组，空态照样写着「还没有动态」—— 同一屏上
              // 一个说没拉到、一个说你没发过。把失败态也传下去，让它渲染成
              // 「动态没读出来」而不是「还没有动态」。
              postsFailed={profilePostsState === "failed"}
              stats={{ posts: profilePostsState === "failed" ? undefined : personalHubPosts.length, followers: personalFollowCounts?.followers, following: personalFollowCounts?.following }}
              onOpenMedia={(entry) => setProfileViewer(entry)}
              onOpenRealitySceneMap={onOpenRealitySceneMap}
              onOpenScene={(sceneId) => {
                onOpenRealitySceneMap?.();
                if (sceneId && sceneId.length > 0) {
                  console.debug(`[profile] scene chip context: ${sceneId}`);
                }
              }}
              onLikePost={engagement ? (postId) => { void engagement.reactToPost(postId, "LIKE", true).then(() => setLikeError(undefined)).catch(() => setLikeError("点赞没有提交成功，请检查连接后重试。")); } : undefined}
              engagementClient={engagement ?? undefined}
              viewerMode={isSelfProfile ? "SELF" : "OTHER"}
              viewerAccountId={viewerAccountId}
              isFollowing={false}
              followBusy={false}
              onFollow={undefined}
              onUnfollow={undefined}
              onSendMessage={undefined}
              resolveMediaUrl={(path) => localNet.resolveMediaUrl(path)}
              fallbackLogo={OTTER_LOGO}
              color={color}
            />
            {likeError ? <Text selectable style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{likeError}</Text> : null}

          </ScrollView>
          <Modal animationType="slide" onRequestClose={() => setInsightsSheetOpen(false)} transparent visible={insightsSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text selectable style={styles.sheetTitle}>分析</Text>
                <Text selectable style={styles.sheetSub}>最近 30 天</Text>
                <View style={styles.sheetField}><Text selectable style={styles.sheetFieldLabel}>浏览</Text><Text selectable style={styles.sheetFieldValue}>{dash(profileAnalytics.opens)}</Text></View>
                <View style={styles.sheetField}><Text selectable style={styles.sheetFieldLabel}>互动</Text><Text selectable style={styles.sheetFieldValue}>{dash(profileAnalytics.interactions)}</Text></View>
                <View style={styles.sheetField}><Text selectable style={styles.sheetFieldLabel}>关注者</Text><Text selectable style={styles.sheetFieldValue}>{dash(personalFollowCounts?.followers)}</Text></View>
                <Pressable onPress={() => setInsightsSheetOpen(false)} style={[styles.sheetWideBtn, styles.sheetWideBtnDark]}>
                  <Text selectable style={styles.sheetWideBtnTextDark}>完成</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* 个人主页搜索：Home 搜索条同款浮条（去相机/语音/AI，只留输入框 + →），
              在顶栏搜索图标下方弹出。透明底无大白卡，点外部关闭；输入即搜。 */}
          <Modal animationType="fade" onRequestClose={closeProfileSearch} transparent visible={searchSheetOpen}>
            <View style={styles.profileSearchOverlay}>
              <Pressable
                accessibilityLabel="关闭搜索"
                onPress={closeProfileSearch}
                style={StyleSheet.absoluteFill}
              />
              <View style={[styles.profileSearchFloat, { marginTop: searchInsets.top + 61 }]}>
                <View style={styles.profileSearchDockRow}>
                  <TextInput
                    ref={profileSearchInputRef}
                    autoFocus
                    accessibilityLabel="搜索"
                    placeholder="搜索"
                    placeholderTextColor="#8C867E"
                    value={searchQuery}
                    onChangeText={(v) => { setSearchQuery(v); runProfileSearch(v); }}
                    onSubmitEditing={() => runProfileSearch(searchQuery)}
                    returnKeyType="search"
                    style={styles.profileSearchDockInput}
                  />
                  {searchQuery ? (
                    <Pressable accessibilityLabel="清空搜索" onPress={() => { setSearchQuery(""); setProfileSearchResults(undefined); }} style={styles.profileSearchClear}>
                      <Text selectable style={styles.profileSearchClearText}>×</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityLabel="搜索"
                    onPress={() => { runProfileSearch(searchQuery); profileSearchInputRef.current?.blur(); }}
                    style={styles.profileSearchGo}
                  >
                    <Text selectable style={styles.profileSearchGoGlyph}>→</Text>
                  </Pressable>
                </View>
                {profileSearchResults !== undefined ? (
                  <View style={styles.profileSearchHits}>
                    {profileSearchResults.length === 0 ? (
                      <Text selectable style={styles.profileSearchEmpty}>无结果</Text>
                    ) : (
                      profileSearchResults.slice(0, 5).map((hit) => (
                        <Pressable
                          key={`${hit.kind}:${hit.postId}:${hit.body.slice(0, 12)}`}
                          onPress={() => { const postId = hit.postId; openModalAfterClose(closeProfileSearch, () => setProfileViewer({ postId, index: 0 })); }}
                          style={styles.profileSearchHit}
                        >
                          <Text selectable numberOfLines={2} style={styles.profileSearchHitText}>{hit.kind === "reply" ? "我的回复" : "动态"} · {hit.body.slice(0, 60)}</Text>
                        </Pressable>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            </View>
          </Modal>

          <Modal animationType="slide" onRequestClose={() => setSettingsSheetOpen(false)} transparent visible={settingsSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text selectable style={styles.sheetTitle}>主页设置</Text>
                <Pressable onPress={() => openModalAfterClose(() => setSettingsSheetOpen(false), () => setProfileEditorOpen(true))} style={[styles.sheetWideBtn, styles.sheetWideBtnNarrow]}>
                  <View style={styles.sheetWideBtnRow}>
                    <ProxyIcon name="editProfile" color={color.ink} size={18} />
                    <Text selectable style={styles.sheetWideBtnText}>编辑个人资料</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => { setSettingsSheetOpen(false); const shareHandle = profileDraft.handle.replace(/^@+/, ""); void Share.share({ message: shareHandle ? `查看 ${profileDraft.name} 的 Proxy 主页：在 App 里搜 @${shareHandle}` : `${profileDraft.name} 的 Proxy 主页` }); }} style={[styles.sheetWideBtn, styles.sheetWideBtnNarrow]}>
                  <View style={styles.sheetWideBtnRow}>
                    <ProxyIcon name="shareUp" color={color.ink} size={18} />
                    <Text selectable style={styles.sheetWideBtnText}>分享主页</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => setSettingsSheetOpen(false)} style={[styles.sheetWideBtn, styles.sheetWideBtnDark, styles.sheetWideBtnNarrow]}>
                  <Text selectable style={styles.sheetWideBtnTextDark}>完成</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
          {profileViewer && viewedItems.length > 0 ? <MediaViewer items={viewedItems} index={profileViewer.index} author={profileDraft.name} resolveUrl={(path) => localNet.resolveMediaUrl(path)} onNavigate={(index) => setProfileViewer((current) => current ? { ...current, index } : current)} onClose={() => setProfileViewer(undefined)} /> : null}
          {renderProfileEditor()}
        </View>
      );
    }

    if (subPage.route === "personalqr") {
      // PROFILE-QR-002：码里编的是一张 **vCard 名片**（见 ../profile-qr），
      // 码下面展示 / 复制的才是那串**搜得到**的文本（人给 @handle，店铺给店名）。
      // PROFILE-QR-004：商家卡片带店铺 id 进来就画店铺名片 —— 以前不管谁按进来
      // 都画个人主页码，卡片和页对不上。
      const storeId = subPage.qrStoreId;
      const storeName = liveShopName ?? persona.name;
      const qrHeading = subPage.qrTitle ?? "我的二维码";
      // 店铺对象里没有 handle，所以店铺名片只有「店名 + 店铺 id」；
      // 个人名片才是「姓名 + handle」。
      const profileCard = buildContactCard({ name: profileDraft.name, handle: profileDraft.handle });
      const qrCard = storeId ? buildContactCard({ name: storeName, storeId }) : profileCard;
      const profileHandle = profileDraft.handle.replace(/^@+/, "");
      const qrCaption = storeId ? storeName : profileHandle ? `@${profileHandle}` : "";
      const qrShareText = storeId
        ? `${storeName} 的 Proxy 店铺名片 —— 扫码可直接存进通讯录。`
        : `加我 Proxy：在 App 里搜 @${profileHandle}，或者扫这张二维码。`;
      if (!qrCard) {
        return contentWrapper(
          <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content}>
              <Pressable onPress={() => closeSubPage()} style={styles.subPageBack}>
                <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
              </Pressable>
              <Text selectable style={styles.subPageTitle}>我的二维码</Text>
              <Text selectable style={styles.qrRealHint}>先设置你的个人主页名，才能生成二维码。</Text>
            </ScrollView>
          </View>
        );
      }
      const qrPage = contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => closeSubPage()} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>{qrHeading}</Text>

            <View style={styles.qrRealCard}>
              <View ref={qrShotRef} collapsable={false} style={styles.qrShotWrap}>
                <Pressable onPress={() => setQrZoomOpen(true)} accessibilityLabel="放大二维码" accessibilityRole="button">
                  <ProxyQrCode size={208} value={qrCard} />
                </Pressable>
                {qrCaption ? <Text selectable style={styles.qrRealHandle}>{qrCaption}</Text> : null}
              </View>
              <Text selectable style={styles.qrRealHint}>{storeId ? "扫这张码会把门店存成联系人（标准 vCard 名片），任何手机的相机都能扫。可用于桌牌、海报和 Creator 分享。点二维码可放大。" : "点二维码可放大，方便对方扫描；扫出来是一张标准 vCard 名片，存进通讯录即可。TikTok / Zalo 是否展示，继续遵循你的可见范围。"}</Text>
              <View style={styles.qrRealActions}>
                <Pressable onPress={() => void copyQrText(qrCaption)} style={styles.qrRealBtnGhost}>
                  <Text selectable style={styles.qrRealBtnTextGhost}>{storeId ? "复制店名" : "复制 @handle"}</Text>
                </Pressable>
                <Pressable onPress={() => void saveQrToAlbum(qrShotRef)} style={styles.qrRealBtn}>
                  <Text selectable style={styles.qrRealBtnText}>保存到相册</Text>
                </Pressable>
              </View>
              <View style={[styles.qrRealActions, { marginTop: 8 }]}>
                <Pressable onPress={() => void shareQrImage(qrShotRef)} style={styles.qrRealBtnGhost}>
                  <Text selectable style={styles.qrRealBtnTextGhost}>分享二维码图</Text>
                </Pressable>
                <Pressable onPress={() => { void Share.share({ message: qrShareText }); }} style={styles.qrRealBtnGhost}>
                  <Text selectable style={styles.qrRealBtnTextGhost}>分享文字</Text>
                </Pressable>
              </View>
              {qrNotice ? <Text selectable style={styles.qrRealNotice}>{qrNotice}</Text> : null}
            </View>

            {/* PROFILE-QR-004：这段是「个人主页」的可见范围预览 —— 店铺码扫出来
                是一张门店名片，拿 TikTok / Zalo 的分层去描述它属于编内容，不显示。 */}
            {storeId ? null : (
              <>
                <Text selectable style={styles.customSectionTitle}>扫码后看到</Text>
                <Text selectable style={styles.customSectionHint}>预览</Text>
                <View style={styles.privacyLadder}>
                  {[
                    ["1", "Proxy 主页", "姓名、城市、公开能力、Proxy 信誉", "始终"],
                    ["2", "TikTok / Instagram", "当前设为公开", "公开"],
                    ["3", "Zalo", "订单成立后才开放", "合作后"]
                  ].map(([i, t, d, v]) => (
                    <View key={i} style={styles.privacyStep}>
                      <View style={styles.privacyStepIndex}>
                        <Text selectable style={styles.privacyStepIndexText}>{i}</Text>
                      </View>
                      <View style={styles.privacyStepCopy}>
                        <Text selectable style={styles.privacyStepTitle}>{t}</Text>
                        <Text selectable style={styles.privacyStepDesc}>{d}</Text>
                      </View>
                      <View style={styles.privacyStepTag}>
                        <Text selectable style={styles.privacyStepTagText}>{v}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      );
      // 放大层挂在 contentWrapper **外面**：它是全屏 Modal，塞进页面外壳里会跟着外壳一起被裁，
      // 而且外层 Pressable 会把「点任意处关闭」抢走。
      return (
        <>
          {qrPage}
          <QrZoomOverlay
            actions={[
              { label: storeId ? "复制店名" : "复制 @handle", onPress: () => void copyQrText(qrCaption) },
              { label: "保存到相册", onPress: () => void saveQrToAlbum(qrZoomShotRef), primary: true },
              { label: "分享二维码图", onPress: () => void shareQrImage(qrZoomShotRef) },
            ]}
            caption={qrCaption}
            hint={storeId ? "让顾客把屏幕朝向自己即可扫描；长按可识别图中二维码。" : "把屏幕朝向对方即可扫描；长按可识别图中二维码。"}
            notice={qrNotice}
            onClose={() => setQrZoomOpen(false)}
            shotRef={qrZoomShotRef}
            title={qrHeading}
            value={qrCard}
            visible={qrZoomOpen}
          />
        </>
      );
    }

    if (subPage.route === "enterpriseops") {
      const draftReady = enterpriseOpsStage !== "READY";
      const confirmed = enterpriseOpsStage === "CONFIRMED" || enterpriseOpsStage === "PUBLISHED";
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.enterpriseHero}>
              <Text selectable style={styles.enterpriseSkillId}>enterprise_ops</Text>
              <Text selectable style={styles.enterpriseHeroTitle}>企业运营助手</Text>
              <Text selectable style={styles.enterpriseHeroText}>上传现实资料，或直接说"建店、整理商品、做内容、复盘经营"。系统只生成 Draft，业务真源始终要由商家确认。</Text>
            </View>
            <View style={styles.enterpriseRuntime}>
              <Text selectable style={styles.enterpriseRuntimeTitle}>Unified Model Runtime</Text>
              <Text selectable style={styles.enterpriseRuntimeText}>Skill 只声明理解、抽取与写作能力；底层模型由模型底座分发，业务端不绑定具体模型。</Text>
            </View>
            <View style={styles.enterpriseQuickGrid}>
              {[
                ["把店铺数字化", "照片 / 菜单 / 产品 / 品牌资料 → Store Draft"],
                ["整理商品与菜单", "Catalog Draft / 分类 / 描述 / 素材"],
                ["做内容与推广草稿", "Post / Benefit / Campaign Draft"],
                ["复盘门店经营", "基于订单、结果与客流数据给建议"]
              ].map(([title, desc]) => (
                <Pressable key={title} accessibilityLabel={title} onPress={() => setEnterpriseOpsStage("DRAFT_READY")} style={styles.enterpriseQuick}>
                  <Text selectable style={styles.enterpriseQuickTitle}>{title}</Text>
                  <Text selectable style={styles.enterpriseQuickDesc}>{desc}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text selectable style={styles.detailSectionTitle}>给 Proxy 看现实资料</Text>
              <Text selectable style={styles.detailSectionHint}>{enterpriseAssets.length} 个 Source Assets</Text>
            </View>
            <View style={styles.enterpriseAssetTray}>
              {enterpriseAssets.map((asset) => (
                <View key={`${asset.label}-${asset.uri ?? "preset"}`} style={styles.enterpriseAsset}>
                  {asset.uri ? <Image source={{ uri: asset.uri }} style={styles.enterpriseAssetThumbImg} /> : <Text selectable style={styles.enterpriseAssetThumb}>▧</Text>}
                  <Text selectable style={styles.enterpriseAssetText}>{asset.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.enterpriseAssetActions}>
              <Pressable onPress={() => void addEnterpriseAsset("photo")} style={styles.lightCta}><Text selectable style={styles.lightCtaText}>拍店铺 / 产品</Text></Pressable>
              <Pressable onPress={() => void addEnterpriseAsset("file")} style={styles.lightCta}><Text selectable style={styles.lightCtaText}>上传文件</Text></Pressable>
            </View>
            {enterpriseAssetError ? <Text selectable style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{enterpriseAssetError}</Text> : null}
            {draftReady ? (
              <View style={styles.enterpriseDraft}>
                <Text selectable style={styles.enterpriseDraftTitle}>Store Digitization Draft</Text>
                {enterpriseAssets.map((asset) => (
                  <View key={asset.label} style={styles.enterpriseDraftRow}>
                    <View style={styles.enterpriseDraftCopy}><Text selectable style={styles.enterpriseDraftName}>{asset.label}</Text><Text selectable style={styles.enterpriseDraftMeta}>{asset.uri ? "你上传的现实资料 · 存在本机" : "内置示例条目 · 不是你上传的资料"}</Text></View>
                    <Text selectable style={styles.enterpriseDraftState}>待抽取</Text>
                  </View>
                ))}
                <Text selectable style={styles.enterpriseDraftMeta}>菜单项、价格、权益与置信度都由模型层抽取。这个面还没有接模型调用，所以不显示任何抽取结果或百分比。</Text>
              </View>
            ) : null}
            {draftReady && !confirmed ? <Pressable onPress={() => setEnterpriseOpsStage("CONFIRMED")} style={styles.primaryCta}><Text selectable style={styles.primaryCtaText}>确认这些资料</Text></Pressable> : null}
            <Pressable onPress={() => openSubPage("merchantstorefront")} style={styles.primaryCta}><Text selectable style={styles.primaryCtaText}>查看线上店铺</Text></Pressable>
            <View style={styles.infoNote}><Text selectable style={styles.infoNoteTitle}>Skill Boundary</Text><Text selectable style={styles.infoNoteText}>Source Asset → Model Output → Draft Artifact → Merchant Confirmation → Authorized Domain Command。模型不直接成为 Merchant、Catalog 或 Order 真源。</Text></View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "trustedteam") {
      // ENTERPRISE-FABRICATED-001: 这里原来是两条写死的执行者档案（含评分、
      // 合作次数、按时率三项指标）和一句关于真实合作人数与本周可用人数的断言。
      // App 没有「可靠执行者」接口，也没有合作次数与按时率字段，那些数字没有
      // 任何来源。入口卡片本身就写着「实时数据待接入」，页身却把编造的人名和
      // 指标显示成真的 —— 改成明确的功能预览态。
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text selectable style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text selectable style={styles.detailTitle}>合作执行网络</Text>
            <Text selectable style={styles.detailSub}>功能预览 · 执行者数据尚未接入</Text>
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteTitle}>这里还没有执行者</Text>
              <Text selectable style={styles.infoNoteText}>常用执行者来自真实合作记录：谁接过你的单、有没有到场、有没有按时完成。App 目前没有这个接口，也没有合作次数与按时率字段，所以这里不显示任何名字、评分或百分比。</Text>
            </View>
            <Pressable accessibilityLabel="再次邀请团队" onPress={() => openSubPage("multislot")} style={styles.trustedInviteTouchable}>
              <Gradient from={color.magenta} to={color.violet} style={styles.trustedInvite}><Text selectable style={styles.trustedInviteText}>再次邀请团队</Text></Gradient>
            </Pressable>
            <Pressable accessibilityLabel="返回我的企业" onPress={() => setSubPage(undefined)} style={styles.trustedReturn}><Text selectable style={styles.trustedReturnText}>返回我的企业</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "multislot") {
      // ENTERPRISE-FABRICATED-001: 这里原来是 5 条写死的名额行（含已分配到的
      // 人名）加一句整体进度百分比。服务端没有多名额任务模型接进这个面，显示
      // 它会让人以为名额真的分配出去了。
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text selectable style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text selectable style={styles.detailTitle}>门店开业</Text>
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteTitle}>名额尚未接入</Text>
              <Text selectable style={styles.infoNoteText}>多名额任务需要服务端把一项需求拆成多个独立名额，并逐个记录匹配、取消、支付与评价。这个面目前读不到名额数据，所以名额清单与整体进度都不显示。</Text>
            </View>
            <Pressable onPress={() => openSubPage("todayboard")} style={styles.primaryCta}><Text selectable style={styles.primaryCtaText}>打开今日执行</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "todayboard") {
      // ENTERPRISE-FABRICATED-001: 这里原来是三条写死的统计（名额 / 已到场 /
      // 有风险）加三条执行者行（含到场时刻与预计到达分钟数）。到场与风险来自
      // 执行者真实上报，这个面读不到，编出来会被当成真的执行状态。
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text selectable style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text selectable style={styles.detailTitle}>今日执行</Text>
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteTitle}>执行看板尚未接入</Text>
              <Text selectable style={styles.infoNoteText}>名额统计、到场与风险都来自执行者真实上报的位置和状态。这个面目前读不到执行数据，所以不显示任何统计数字或执行者清单。</Text>
            </View>
            <Pressable onPress={() => openSubPage("multislot")} style={styles.primaryCta}><Text selectable style={styles.primaryCtaText}>查看名额与补位</Text></Pressable>
            <Pressable onPress={() => openSubPage("members")} style={styles.lightCta}><Text selectable style={styles.lightCtaText}>成员与权限</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "merchantstorefront") {
      if (business) {
        return contentWrapper(
          <View style={styles.root}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>线上店铺</Text>
            <MerchantStorefrontSurface client={business} viewerAccountId={viewerAccountId} />
          </View>
        );
      }
      return contentWrapper(
        <View style={styles.root}>
          <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
            <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
          </Pressable>
          <Text selectable style={styles.subPageTitle}>线上店铺</Text>
          <View style={styles.infoNote}><Text selectable style={styles.infoNoteText}>请在 “商家” Tab 登录后查看</Text></View>
        </View>
      );
    }

    if (subPage.route === "bdash") {
      // PROFILE-QR-004：这张卡画的是**门店名片**（店名 + 店铺 id），不是个人主页码 ——
      // 以前不管有没有商家主体，这里编的都是拼出来的主页链接，扫出来只有一条链接。
      // 现在编标准 vCard：扫到就能存联系人，不需要域名。
      // 没有商家主体时退回**个人名片**，并且标题/按钮跟着改口径 —— 卡上写着「商家」、
      // 点开却是个人码，就是「卡和页对不上」那类 bug。
      // （域名不写在这里，原因见上面 copyQrText 的注释。）
      const merchantCard = merchantId
        ? buildContactCard({ name: liveShopName ?? persona.name, storeId: merchantId })
        : null;
      const merchantQrValue = merchantCard ?? buildContactCard({ name: profileDraft.name, handle: profileDraft.handle });
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>企业 / 店铺资料</Text>

            <View style={styles.storeTop}>
              <View style={styles.storeTopRow}>
                <Gradient from={color.magenta} to={color.violet} style={styles.storeAvatar}>
                  <Text selectable style={styles.storeAvatarText}>B</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text selectable style={styles.heroName}>{liveShopName ?? persona.name}</Text>
                  <Text selectable style={styles.heroMeta}>{liveShopName ? "我的店铺" : (persona.contextLineLabel ?? "")}</Text>
                </View>
              </View>
            </View>

            <QrCard
              title={merchantCard ? "商家身份二维码" : "个人二维码"}
              desc={merchantCard
                ? "扫这张码会把门店存成联系人（标准 vCard 名片），任何手机的相机都能扫。点下方按钮打开可放大、存图、分享的完整页面。"
                : "还没有接入店铺主体，这里先放你的个人名片。点下方按钮可以放大、存图、分享。"}
              actionLabel={merchantCard ? "打开商家二维码" : "打开我的二维码"}
              onAction={() => openSubPage("personalqr", { backRoute: "bdash", ...(merchantId ? { qrStoreId: merchantId, qrTitle: "商家二维码" } : {}) })}
              qrValue={merchantQrValue ?? undefined}
            />

            <View style={styles.subSection}>
              <Text selectable style={styles.subSectionTitle}>企业主体</Text>
              {[
                ["主体名称", "Bonsaidon · 海鲜自助"],
                ["经营城市", "河内"],
                ["经营节点", "3 个"],
                ["身份验证", "已认证 · Proxy 商家身份"]
              ].map(([label, value]) => (
                <View key={label} style={styles.subRow}>
                  <Text selectable style={styles.subRowLabel}>{label}</Text>
                  <Text selectable style={styles.subRowValue}>{value}</Text>
                </View>
              ))}
            </View>

            <Text selectable style={styles.customSectionTitle}>二维码与展示</Text>
            <Text selectable style={styles.customSectionHint}>Proxy 商家身份</Text>
            <SocialRow
              icon="◈"
              label="门店主页"
              desc="顾客扫码先看到这家店的公开信息与信誉"
              onPress={() => openSubPage("merchantstorefront")}
            />
            <SocialRow
              icon="⌁"
              label="访问与转化"
              desc="知道二维码带来多少到店与核销"
              onPress={() => openSubPage("socialanalytics")}
            />
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "storerecqueue") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>推荐评估队列</Text>
            <StoreRecommendationQueue />
          </ScrollView>
        </View>
      );
    }

    // BENEFIT-WIRE-001: 权益领取（个人身份）。
    if (subPage.route === "benefits") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>我的权益</Text>
            <BenefitHubSurface onBack={() => setSubPage(undefined)} />
          </ScrollView>
        </View>
      );
    }

    // BENEFIT-WIRE-001: 权益核销（商家身份）。没有店铺主体时**说清楚**，
    // 而不是塞一个空 merchantId 进去让核销必然失败 —— 那样运营只会看到
    // 「扫了没反应」，根本不知道是主体没绑。
    if (subPage.route === "benefitredeem") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>权益核销</Text>
            {merchantId ? (
              <BenefitRedeemScreen
                client={benefitClient}
                merchantId={merchantId}
                onBack={() => setSubPage(undefined)}
              />
            ) : (
              <View style={styles.infoNote}>
                <Text selectable style={styles.infoNoteText}>当前账号没有店铺主体，无法核销权益。</Text>
                <Text selectable style={[styles.appBehaviorCardDesc, { marginTop: 4 }]}>
                  核销必须绑定到一个真实门店（商家主体），因为它决定了这笔核销记在谁账上。
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      );
    }

    // STORE-REC-007: 我推荐的店 —— 推荐人自己的进展视图。
    if (subPage.route === "mystorerecs") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>我推荐的店</Text>
            <MyStoreRecommendations />
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "recommendstore") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text selectable style={styles.subPageTitle}>推荐商铺进体系</Text>
            <Text selectable style={styles.appBehaviorCardDesc}>
              把你看过、去过、觉得适合 Proxy 的场地 / 商家推荐给平台：小美（AI）与
              用户一起把好的店铺带进体系，运营评估后接入。推荐记录会留档（append-only），
              后续接入进度在运营侧推进。
            </Text>
            {storeRecAiAvailable ? (
              <View style={styles.infoNote}>
                <Text selectable style={styles.socialEditorLabel}>让小美帮你整理</Text>
                <Text selectable style={styles.appBehaviorCardDesc}>
                  用一句话说说这家店（在哪儿、为什么值得进体系），小美整理成草稿，
                  你确认后提交 —— 会记为「小美推荐」。你没提到的字段小美不会瞎填。
                </Text>
                <TextInput
                  placeholder="例如：Cầu Giấy 那家 Three Beans 咖啡，适合 afterwork，老板愿意合作活动"
                  style={[styles.socialEditorInput, { minHeight: 64 }]}
                  multiline
                  value={storeRecNote}
                  onChangeText={setStoreRecNote}
                />
                <Pressable
                  disabled={storeRecAiBusy || storeRecNote.trim() === ""}
                  onPress={() => void suggestWithXiaomei()}
                  style={[styles.lightCta, (storeRecAiBusy || storeRecNote.trim() === "") && { opacity: 0.5 }]}
                >
                  <Text selectable style={styles.lightCtaText}>{storeRecAiBusy ? "小美整理中…" : "让小美整理"}</Text>
                </Pressable>
              </View>
            ) : null}
            {storeRecAiNote ? <Text selectable style={{ color: "#1B7F4D", fontSize: 12, marginTop: 8 }}>{storeRecAiNote}</Text> : null}
            <Text selectable style={styles.socialEditorLabel}>店名 / 场地名</Text>
            <TextInput
              placeholder="例如：Three Beans · Cầu Giấy"
              style={styles.socialEditorInput}
              value={storeRecDraft.storeName}
              onChangeText={(v) => setStoreRecDraft((cur) => ({ ...cur, storeName: v }))}
            />
            <Text selectable style={styles.socialEditorLabel}>城市</Text>
            <TextInput
              placeholder="例如：河内"
              style={styles.socialEditorInput}
              value={storeRecDraft.city}
              onChangeText={(v) => setStoreRecDraft((cur) => ({ ...cur, city: v }))}
            />
            <Text selectable style={styles.socialEditorLabel}>品类（可选）</Text>
            <TextInput
              placeholder="例如：咖啡 / 餐饮 / 展览"
              style={styles.socialEditorInput}
              value={storeRecDraft.category}
              onChangeText={(v) => setStoreRecDraft((cur) => ({ ...cur, category: v }))}
            />
            <Text selectable style={styles.socialEditorLabel}>为什么推荐它进体系</Text>
            <TextInput
              placeholder="例如：适合聊天与 Afterwork 场景，老板愿意合作活动"
              style={[styles.socialEditorInput, { minHeight: 88 }]}
              multiline
              value={storeRecDraft.reason}
              onChangeText={(v) => setStoreRecDraft((cur) => ({ ...cur, reason: v }))}
            />
            {storeRecError ? <Text selectable style={{ color: "#B3261E", fontSize: 12, marginTop: 8 }}>{storeRecError}</Text> : null}
            {storeRecDone ? <Text selectable style={{ color: "#1B7F4D", fontSize: 12, marginTop: 8 }}>{storeRecDone}</Text> : null}
            <Pressable
              disabled={storeRecBusy}
              onPress={() => void submitStoreRecommendation()}
              style={[styles.appBehaviorReturn, storeRecBusy && { opacity: 0.5 }]}
            >
              <Text selectable style={styles.appBehaviorReturnText}>{storeRecBusy ? "提交中…" : (storeRecOrigin === "AI" ? "以小美推荐提交" : "提交推荐")}</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    return contentWrapper(
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
            <Text selectable style={styles.subPageBackText}>‹ 返回</Text>
          </Pressable>
          <Text selectable style={styles.detailTitle}>{subPage.title}</Text>
          <Text selectable style={styles.detailSub}>{subPage.desc}</Text>

          {content?.sections?.map((section, sIdx) => (
            <View key={sIdx} style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text selectable style={styles.detailSectionTitle}>{section.title}</Text>
              </View>
              {section.rows.map((row, rIdx) => (
                <View key={rIdx} style={styles.prototypeCard}>
                  <Text selectable style={styles.prototypeCardTitle}>{row.label}</Text>
                  {row.value ? <Text selectable style={styles.prototypeCardDesc}>{row.value}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          {!content?.sections ? (
            <View style={styles.infoNote}>
              <Text selectable style={styles.infoNoteTitle}>正在准备这个工作区</Text>
              <Text selectable style={styles.infoNoteText}>它会沿用此页面的真实业务对象和权限边界，不再以通用占位页替代。</Text>
            </View>
          ) : null}
          <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
            <Text selectable style={styles.lightCtaText}>返回我的</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.pageTitleRow}>
          <Text selectable style={styles.pageTitle}>{persona.pageTitle}</Text>
        </View>

        {persona.profileCard ? (
          <Pressable onPress={() => openSubPage(persona.profileCard!.route)} style={styles.profileCard}>
            <View style={styles.profileTop}>
              <Gradient from="#241246" to="#7A2CFF" style={styles.profileAvatar}>
                {hubProfile.hasAvatar ? (
                  <CircularAvatarImage accessibilityLabel={`${hubProfile.displayName}头像`} size={46} uri={profileAvatarUri!} />
                ) : (
                  <Text selectable style={styles.profileAvatarText}>{hubProfile.initial}</Text>
                )}
              </Gradient>
              <View style={styles.profileCopy}>
                <Text selectable style={styles.profileName}>{hubProfile.displayName}</Text>
                <View style={styles.profileMeta}>
                  <Text selectable style={styles.profileMetaText}>{hubProfile.city}</Text>
                  {hubProfile.handle ? (
                    <>
                      <View style={styles.profileVerifyDot}>
                        <Text selectable style={styles.profileVerifyText}>@</Text>
                      </View>
                      <Text selectable style={styles.profileMetaText}>{hubProfile.handle}</Text>
                    </>
                  ) : null}
                </View>
              </View>
              <Pressable
                accessibilityLabel="选择状态"
                onPress={(event) => { event.stopPropagation?.(); setAvRuleSheetOpen(true); }}
                style={styles.profileStatus}
                hitSlop={4}
              >
                <Text selectable style={styles.profileStatusText}>● {availabilityLabel(availability)}</Text>
              </Pressable>
            </View>
            <View style={styles.profileSocial}>
              {(() => {
                // R18.x HUB-SOCIAL-001: see resolveHubSocials
                // in ./me-types for the precedence rules.
                const hubSocials = resolveHubSocials(socialAccounts);
                if (hubSocials.isEmpty) {
                  return <Text selectable style={styles.profileSocialMore}>去 “我的” → 社媒账户 设置 ›</Text>;
                }
                return hubSocials.visible.map((social) => (
                  <View
                    key={social.key}
                    style={[styles.profileSocialBadge, social.mark === "TT" && styles.profileSocialBadgeOn, social.dark && styles.profileSocialBadgeDark]}
                  >
                    <Text selectable style={styles.profileSocialBadgeText}>{social.mark}</Text>
                  </View>
                ));
              })()}
              <Text selectable style={styles.profileSocialMore}>社媒与二维码 ›</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.identityCard}>
            {persona.avatarGrad ? (
              <Gradient from={color.magenta} to={color.violet} style={styles.identityAvatar}>
                {hubProfile.hasAvatar ? (
                  <CircularAvatarImage accessibilityLabel={`${hubProfile.displayName}头像`} size={40} uri={profileAvatarUri!} />
                ) : (
                  <Text selectable style={styles.identityAvatarText}>{hubProfile.initial}</Text>
                )}
              </Gradient>
            ) : (
              <View style={[styles.identityAvatar, styles.identityAvatarSolid]}>
                {hubProfile.hasAvatar ? (
                  <CircularAvatarImage accessibilityLabel={`${hubProfile.displayName}头像`} size={40} uri={profileAvatarUri!} />
                ) : (
                  <Text selectable style={styles.identityAvatarText}>{hubProfile.initial}</Text>
                )}
              </View>
            )}
            <View style={styles.identityCopy}>
              <Text selectable style={styles.identityName}>{hubProfile.displayName}</Text>
              <Text selectable style={styles.identityDesc}>{persona.desc}</Text>
            </View>
            <Pressable
              onPress={() => persona.identityActionSwitch && onOpenSwitcher()}
              style={styles.identityButton}
            >
              <Text selectable style={styles.identityButtonText}>{persona.identityActionLabel}</Text>
            </Pressable>
          </View>
        )}

        {context === "REQUESTER" ? (
          <Pressable accessibilityLabel="礼品券，3 张可用，去使用" onPress={onOpenVouchers} style={styles.voucherPin}>
            <View style={styles.voucherPinMark}><VoucherMenuGlyph color={color.ink} /></View>
            <View style={styles.voucherPinCopy}>
              <Text selectable style={styles.voucherPinTitle}>礼品券</Text>
              <Text selectable style={styles.voucherPinDesc}>咖啡券、体验券与活动券</Text>
            </View>
            <View style={styles.voucherPinRight}>
              <Text selectable style={styles.voucherPinCount}>3 张可用</Text>
              <Text selectable style={styles.voucherPinAction}>去使用 ›</Text>
            </View>
          </Pressable>
        ) : null}

        {persona.alert ? (
          <Pressable onPress={() => persona.alert && openSubPage(persona.alert.route)} style={styles.bizAlert}>
            <View style={styles.bizAlertMark}>
              <Text selectable style={styles.bizAlertMarkText}>{persona.alert.icon}</Text>
            </View>
            <View style={styles.bizAlertCopy}>
              <Text selectable style={styles.bizAlertTitle}>{persona.alert.title}</Text>
              <Text selectable style={styles.bizAlertDesc}>{persona.alert.desc}</Text>
            </View>
            <Text selectable style={styles.bizAlertTag}>{persona.alert.tag}</Text>
          </Pressable>
        ) : null}

        {effectiveSections.map((section) => (
          <View key={section.id ?? section.title} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text selectable style={styles.sectionTitle}>{section.title}</Text>
              <Text selectable style={styles.sectionHint}>{section.hint}</Text>
            </View>
            {section.rows.map((row) => (
              <ServiceRow key={row.label} onPress={() => pressRow(row)} row={row} />
            ))}
          </View>
        ))}

        <View style={styles.contextLine}>
          <Text selectable style={styles.contextLineText}>{persona.contextLineLabel}</Text>
          <Pressable onPress={onOpenSwitcher}>
            <Text selectable style={styles.contextLineAction}>{persona.contextLineAction} ›</Text>
          </Pressable>
        </View>

        {persona.settingsRow ? (
          <ServiceRow onPress={() => persona.settingsRow && pressRow(persona.settingsRow)} row={persona.settingsRow} />
        ) : null}

        <Pressable onPress={onSignOut} style={styles.signOut}>
          <Text selectable style={styles.signOutText}>退出登录</Text>
        </Pressable>
      </ScrollView>
      {/* 个人资料编辑器三处分支各挂一份（见 renderProfileEditor 注释）。 */}
      {renderProfileEditor()}
      {/* 状态规则表放根：hub 头像旁状态点也能打开（原来只在 available 子页挂载）。 */}
      <AvRuleSheet onClose={() => setAvRuleSheetOpen(false)} onSave={setAvRule} open={avRuleSheetOpen} rule={avRule} />
    </View>
  );
}

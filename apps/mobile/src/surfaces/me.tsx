// Me Surface：账户与 Active Context 切换（R15.12.7：One Account，
// Active Context = REQUESTER | BUSINESS，切换只改 Product State；
// 找人、接机会、开放能力、发活动都是行为，不是另一种身份）。
// R15.12.7 Market Map Parity Freeze：Market 路由行保持 dispatcher surface
// "TASKS" 契约（server 只知道 TASKS），shell 映射到市场 Tab。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html
// （renderRequesterMe / renderBusinessMe / contextline），
// 切换 Sheet 由 App Shell 共享渲染（ContextSwitcherSheet）。
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useModuleBackHandler } from "../components/module-back";
import { SwipeBackShell } from "../architecture/swipe-back";
import { ProfileTabs } from "./ProfileTabs";
import { AIIdentityShowcaseSurface } from "./AIIdentityShowcaseSurface";
import * as ImagePicker from "expo-image-picker";
import { Directory, File, Paths } from "expo-file-system";
import { createProfileStore, DEFAULT_PROFILE, avatarFileName, type ProfileRecord } from "../profile-store";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import type { ExperienceAction, ExperienceMenuSection, FeedMediaItem, FeedPost, Memory, RegisteredExperienceRoute } from "@proxy/contracts";
import { ProxyIcon, ProxySymbolIcon } from "../components/proxy-icon";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { MerchantMeR21Replacement } from "./merchant-me-r21-replacement";
import { MerchantStorefrontSurface } from "./merchant-storefront";
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
import { type LocalNetClient } from "../localnet-client";
import { meOwnedRouteForLabel } from "../me-owned-routes";
import { color, Gradient, shadows } from "../theme";
import type { ActiveContext } from "../uiplan/types";
import type { MyScene, MySceneInvitation, SceneClient } from "../scene-client";
import type { BusinessClient } from "../business-client";
import type { ActivityClient } from "../activity-client";
import type { ProfileClient } from "../profile-client";
import type { RelationshipClient } from "../relationship-client";
import type { SocialSettingsClient } from "../social-settings-client";
import type { SupplyClient } from "../supply-client";
import { FacetHomeSurface } from "../facet/FacetHomeSurface";
import { FacetClient } from "../facet-client";
import { sessionAuthClient, localApiBaseUrl, nativeTransport } from "../native-clients";
import { createSocialSettingsStore } from "../social-settings-store";

// Extracted modules
import type { MeSubPage, AvailabilityState, EnterpriseOpsStage, MenuRow, MenuSection, PersonalHubTab, SocialVisibility, SocialAccount, AbilityType, AbilityInstance, AvailabilityRule, AvOverride } from "./me-types";
import { ABILITY_SCHEMAS, DEFAULT_ABILITIES, AVAILABILITY_OPTIONS, AV_DAY_NAMES, avKeyOf, avFmt, describeAvRule, avStateFor, nextDays, INITIAL_SOCIAL_ACCOUNTS, resolveHubProfile, resolveHubSocials } from "./me-types";
import { AbilitySheet, AvRuleSheet, AvDaySheet, FakeQr, QrCard, SocialRow, AvailabilitySheet, MeLocationContext, VoucherMenuGlyph, ServiceRow, availabilityLabel } from "./me-profile-components";
import { MyOrdersSurface, MyActivitiesSurface, FavoritesSurface, MerchantCampaignSurface } from "./me-orders";
import { SUB_PAGE_CONTENT } from "./me-sub-pages";
import { useMerchantIdentity } from "../use-merchant-identity";
import { styles } from "./me-styles";

const OTTER_LOGO = require("../../assets/otter-logo.png");

const profileStore = createProfileStore(nativeSecureStorageDriver);
const socialSettingsStore = createSocialSettingsStore(nativeSecureStorageDriver);

const PROFILE_AVATAR_DIR = new Directory(Paths.document, "proxy-profile");
function nextProfileAvatarFile(): File {
  return new File(PROFILE_AVATAR_DIR, `avatar-${Date.now()}.jpg`);
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
      title: "个人总管理",
      hint: "基本信息、二维码、状态管理在一个页里",
      rows: [
        { icon: "profile-ring", label: "个人总管理", desc: "基本信息 · 二维码 · 状态管理 (可接单)", grad: true, route: "personalmanage" },
        { icon: "profile-ring", label: "个人主页", desc: "对外展示 · Threads R2 · 名片、动态、能力、可用时间", route: "personalhub" },
        { icon: "arrow-up-right", label: "社媒与联系", desc: "TikTok、Zalo、Instagram 与可见范围", route: "socialidentity" },
        { icon: "route", label: "访问与转化", desc: "渠道 → 主页 → 聊天 → 订单", route: "socialanalytics" }
      ]
    },
    {
      id: "relationships",
      title: "关系",
      hint: "真人网络 · 个人轻 CRM 关系图",
      rows: [
        { icon: "target", label: "好友与关系", desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录", grad: true, route: "friendcrm" }
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
        { icon: "star", label: "收藏", desc: "商家、Creator、动态与活动", route: "favorites" }
      ]
    },
    {
      id: "account",
      title: "账户",
      hint: "安全与结算",
      rows: [
        { icon: "coin", label: "钱包与结算", desc: "付款、收入、退款与记录", route: "wallet" },
        { icon: "gear", label: "设置与隐私", desc: "推荐、通知、权限与隐私", route: "appbehavior" },
        { icon: "shield", label: "我的隐私", desc: "依据《个人数据保护法》下载我的数据或请求删除账号", route: "privacy" },
        { icon: "store-lines", label: "我的企业 / 店铺", desc: "有经营权限时进入 Business Workspace", route: "bdash" }
      ]
    },
    {
      id: "facet",
      title: "对象化运营",
      hint: "FACET · 同一份真实素材，按对象重新组织",
      rows: [
        { icon: "spark", label: "FACET", desc: "对象列表 · 关系目标 · 缺口判定", grad: true, route: "facet" }
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
        { icon: "✦", label: "经营", desc: "功能预览 · 实时数据待接入", route: "enterpriseops" }
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
  bottomNavVisible,
  scene,
  business,
  supply,
  activities,
  engagement,
  viewerAccountId,
  socialSettingsClient,
  profileClient,
  relationshipClient,
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
  onOpenConversation?: (author: string) => void;
  onSignOut: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
  scene?: SceneClient;
  business?: BusinessClient;
  supply?: SupplyClient;
  profileClient?: ProfileClient | undefined;
  relationshipClient?: RelationshipClient | undefined;
  activities?: ActivityClient | undefined;
  engagement?: EngagementClient;
  viewerAccountId?: string | undefined;
  socialSettingsClient?: SocialSettingsClient | undefined;
  onOpenSearch?: ((query: string) => void) | undefined;
}): React.JSX.Element {
  const [subPage, setSubPage] = useState<MeSubPage>();
  useModuleBackHandler(subPage ? () => { setSubPage(undefined); return true; } : undefined);
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
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // 主页实搜：搜自己主页动态正文，结果可点开（之前输入直接丢弃）。
  const [profileSearchResults, setProfileSearchResults] = useState<FeedPost[] | undefined>(undefined);
  function runProfileSearch(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) return;
    setProfileSearchResults(profilePosts.filter((post) => post.body.toLowerCase().includes(q)));
  }
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [aiIdentityOpen, setAiIdentityOpen] = useState(false);
  const [personalReplyPosts, setPersonalReplyPosts] = useState<FeedPost[]>([]);
  const [personalSavedPosts, setPersonalSavedPosts] = useState<FeedPost[]>([]);
  const [personalTaggedPosts, setPersonalTaggedPosts] = useState<FeedPost[]>([]);
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
  // 未知画 "—" 不画 0：浏览/互动暂无服务端口径（绝不拿公式现编），
  // 关注数没拉到之前也是未知不是零。
  const dash = (n: number | undefined): string => (n === undefined ? "—" : String(n));
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  // 资料保存失败必须留编辑器内提示，不静默吞掉（本地写失败/服务端同步失败都一样）。
  const [profileSaveError, setProfileSaveError] = useState<string | undefined>(undefined);
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | undefined>(undefined);
  const [profilePosts, setProfilePosts] = useState<FeedPost[]>([]);
  const [profileMedia, setProfileMedia] = useState<Record<string, FeedMediaItem[]>>({});
  const [profileMediaPositions, setProfileMediaPositions] = useState<Record<string, number>>({});
  const [profileViewer, setProfileViewer] = useState<{ postId: string; index: number }>();
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>(INITIAL_SOCIAL_ACCOUNTS);
  const [socialEditor, setSocialEditor] = useState<SocialAccount>();
  const [socialOpenError, setSocialOpenError] = useState<string | undefined>(undefined);
  const [socialSettings, setSocialSettings] = useState({ merchant: true, profile: false, influence: false });
  const [collaboration, setCollaboration] = useState({ enabled: false, types: ["探店", "UGC"], rate: "", contact: "" });
  const socialSettingsHydrated = useRef(false);
  useEffect(() => { let cancelled = false; void (async () => { const local = await socialSettingsStore.read(); let remote: typeof local; let serverReachable = false; if (socialSettingsClient) { try { remote = await socialSettingsClient.read(); serverReachable = true; } catch { serverReachable = false; } } const value = remote ?? local; if (!cancelled && value) { setSocialAccounts(value.accounts); setSocialSettings({ merchant: value.merchant, profile: value.profile, influence: value.influence }); setCollaboration({ enabled: value.collaborationEnabled ?? false, types: value.collaborationTypes ?? ["探店", "UGC"], rate: value.collaborationRate ?? "", contact: value.collaborationContact ?? "" }); await socialSettingsStore.write(value); if (serverReachable && !remote && local) await socialSettingsClient?.write(local).catch(() => undefined); } if (!cancelled) socialSettingsHydrated.current = true; })(); return () => { cancelled = true; }; }, [socialSettingsClient]);
  useEffect(() => { if (!socialSettingsHydrated.current) return; const value = { accounts: socialAccounts, ...socialSettings, collaborationEnabled: collaboration.enabled, collaborationTypes: collaboration.types, collaborationRate: collaboration.rate, collaborationContact: collaboration.contact }; void socialSettingsStore.write(value); if (!socialSettingsClient) return; const timer = setTimeout(() => { void socialSettingsClient.write(value).catch(() => undefined); }, 250); return () => clearTimeout(timer); }, [socialAccounts, socialSettings, collaboration, socialSettingsClient]);
  const [securityRetention, setSecurityRetention] = useState<7 | 30 | 90 | 365>(30);
  const [screenshotWarn, setScreenshotWarn] = useState(true);
  const [profileDraft, setProfileDraft] = useState({
    name: DEFAULT_PROFILE.name,
    handle: DEFAULT_PROFILE.handle,
    bio: DEFAULT_PROFILE.bio,
    city: DEFAULT_PROFILE.city
  });
  const profileHydratedRef = useRef(false);
  const profileTouchedRef = useRef(false);
  useEffect(() => {
    if (profileHydratedRef.current) return;
    let cancelled = false;
    void profileStore.read().then((record) => {
      if (cancelled || profileTouchedRef.current || !record) return;
      profileHydratedRef.current = true;
      setProfileDraft({ name: record.name, handle: record.handle, bio: record.bio, city: record.city });
      // AVATAR-001: 文件名按当前沙盒重锚 + 存在性校验（v57 File 没有
      // exists API，用目录 listing 判）。之前 `file.exists` 恒 falsy，
      // 每次冷启动都丢头像只剩字母头。读到老绝对路径则后台回写规范化。
      if (record.avatarPath) {
        try {
          const name = avatarFileName(record.avatarPath);
          const names = new Set(PROFILE_AVATAR_DIR.list().map((entry) => entry.name));
          if (names.has(name)) {
            setProfileAvatarUri(new File(PROFILE_AVATAR_DIR, name).uri);
            if (record.avatarPath !== name) {
              void profileStore.write({ ...record, avatarPath: name }).catch(() => undefined);
            }
          }
        } catch {
          // 目录不可读：保持字母头，不崩。
        }
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const read = await localNet.listMyFeedPosts();
        if (cancelled) return;
        if (read.posts.length > 0) {
          setProfilePosts(read.posts);
          setProfileMedia(read.media);
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
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [localNet, profileDraft.name, profileDraft.handle, viewerAccountId]);

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
      .then((r) => {
        if (cancelled) return;
        const replyPosts: FeedPost[] = r.replies.map((rep: { replyId: string; postId: string; parentPostId: string; body: string; createdAt: string }) => ({
          postId: rep.postId,
          authorType: "USER" as const,
          authorId: viewerAccountId,
          authorDisplayName: profileDraft.name,
          body: rep.body,
          mediaRefs: [],
          sceneType: "UNKNOWN" as const,
          status: "ACTIVE",
          contextRefs: [],
          createdAt: rep.createdAt
        }));
        setPersonalReplyPosts(replyPosts);
      })
      .catch(() => { if (!cancelled) setPersonalReplyPosts([]); });
    void engagement.listUserBookmarks(viewerAccountId, 60)
      .then(async (b) => {
        if (cancelled) return;
        try {
          const feed = await localNet.listFeedPosts();
          if (cancelled) return;
          const bookmarkedSet = new Set(b.bookmarks);
          const saved = feed.posts.filter((p) => bookmarkedSet.has(p.postId));
          setPersonalSavedPosts(saved);
          const myHandle = profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`;
          const tagged = feed.posts.filter((p) => {
            if (p.authorId === viewerAccountId) return false;
            if (p.body.includes(myHandle)) return true;
            return p.contextRefs.some((ref) => ref.contextType === "MENTION" && ref.contextId === viewerAccountId);
          });
          setPersonalTaggedPosts(tagged);
        } catch {
          if (!cancelled) {
            setPersonalSavedPosts([]);
            setPersonalTaggedPosts([]);
          }
        }
      })
      .catch(() => { if (!cancelled) setPersonalSavedPosts([]); });
    return () => { cancelled = true; };
  }, [engagement, viewerAccountId, localNet, profileDraft.name]);

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

  if (subPage?.route === "friendcrm") {
    return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface relationship={relationshipClient} initialView="LIST" viewer={{ name: profileDraft.name, handle: profileDraft.handle }} onOpenVouchers={onOpenVouchers} onBack={() => setSubPage(undefined)} onOpenConversation={(author) => { setSubPage(undefined); onOpenConversation?.(author); }} /></SwipeBackShell>;
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
    const content = SUB_PAGE_CONTENT[route];
    if (!content) return;
    setSubPage({ title: content.title, desc: content.desc, icon: content.icon, route });
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
      const content = SUB_PAGE_CONTENT[row.route];
      setSubPage({
        title: content?.title ?? row.label,
        desc: content?.desc ?? row.desc,
        icon: content?.icon ?? row.icon,
        route: row.route
      });
    }
  }

  function openSubPage(route: string): void {
    const content = SUB_PAGE_CONTENT[route];
    if (!content) return;
    setSubPage({ title: content.title, desc: content.desc, icon: content.icon, route });
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
      const avatarFile = nextProfileAvatarFile();
      await new File(selected.uri).copy(avatarFile, { overwrite: true });
      profileTouchedRef.current = true;
      profileHydratedRef.current = true;
      setProfileAvatarUri(avatarFile.uri);
      await profileStore.write({
        ...profileDraft,
        // AVATAR-001: 只存文件名。绝对 file:// URI 含沙盒 container UUID，
        // 重装 App 后必死；读时按当前 documentDirectory 重锚。
        avatarPath: avatarFileName(avatarFile.uri),
        updatedAt: new Date().toISOString()
      });
    } catch {
      setProfileAvatarUri(selected.uri);
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
        const avatarFile = nextProfileAvatarFile();
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
    const wireAvatarPath = localAvatarFileName ? `assets/${localAvatarFileName}` : "";
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
      } catch {
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
    const contentWrapper = (node: React.JSX.Element): React.JSX.Element => <SwipeBackShell onExit={() => setSubPage(undefined)}>{node}</SwipeBackShell>;
    const content = SUB_PAGE_CONTENT[subPage.route];

    if (subPage.route === "myorders") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MyOrdersSurface client={fulfillment} onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "myactivities") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MyActivitiesSurface onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "merchantcampaign") return <SwipeBackShell onExit={() => setSubPage(undefined)}><MerchantCampaignSurface onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "favorites") return <SwipeBackShell onExit={() => setSubPage(undefined)}><FavoritesSurface onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
    if (subPage.route === "facet") {
      const facetClient = new FacetClient({ requester: sessionAuthClient, baseUrl: localApiBaseUrl });
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FacetHomeSurface client={facetClient} onBack={() => setSubPage(undefined)} /></SwipeBackShell>;
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
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>{subPage.title}</Text>
            <Text style={styles.detailSub}>{subPage.desc}</Text>
            <View style={styles.fallbackSection}><View style={styles.detailSectionHead}><Text style={styles.detailSectionTitle}>我发起的场景</Text></View>
              {myScenes.length === 0 ? <View style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>还没有发起场景</Text></View> : myScenes.map((row) => <View key={row.sceneId} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{row.title}</Text><Text style={styles.prototypeCardDesc}>{row.status} · {new Date(row.startsAt).toLocaleString()}</Text></View>)}
            </View>
            <View style={styles.fallbackSection}><View style={styles.detailSectionHead}><Text style={styles.detailSectionTitle}>收到的真人邀请</Text></View>
              {myInvitations.length === 0 ? <View style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>还没有收到邀请</Text></View> : myInvitations.map((row) => <View key={row.invitationId} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{row.card.what ?? "场景邀请"}</Text><Text style={styles.prototypeCardDesc}>{row.card.where ?? "地点待确认"} · {row.card.when ?? "时间待确认"}</Text><Text style={styles.prototypeCardDesc}>{row.plannedBudget ? `${row.plannedBudget.toLocaleString()} ${row.currency || "VND"}` : "金额待双方确认"} · {row.status}</Text>{row.orderRef ? <Text style={styles.prototypeCardDesc}>已生成订单 · {row.orderRef}</Text> : null}{row.status === "PENDING" ? <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}><Pressable disabled={invitationBusyId === row.invitationId} onPress={() => void respond(row.invitationId, "ACCEPTED")} style={styles.lightCta}><Text style={styles.lightCtaText}>接受</Text></Pressable><Pressable disabled={invitationBusyId === row.invitationId} onPress={() => void respond(row.invitationId, "ASK")} style={styles.lightCta}><Text style={styles.lightCtaText}>询问</Text></Pressable><Pressable disabled={invitationBusyId === row.invitationId} onPress={() => void respond(row.invitationId, "DECLINED")} style={styles.lightCta}><Text style={styles.lightCtaText}>拒绝</Text></Pressable></View> : null}</View>)}
            {invitationError ? <Text style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{invitationError}</Text> : null}
            </View>
            <View style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text style={styles.detailSectionTitle}>场景记忆 (R15.13 P2 · 真实数据)</Text>
              </View>
              {memoriesLoadState === "loading" ? (
                <View style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>加载中…</Text>
                  <Text style={styles.prototypeCardDesc}>正在从 Scene 服务拉取你的历史记忆</Text>
                </View>
              ) : memoriesLoadState === "error" ? (
                <View style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>记忆不可用</Text>
                  <Text style={styles.prototypeCardDesc}>未登录或未写入任何 Scene Outcome</Text>
                </View>
              ) : memories.length === 0 ? (
                <View style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>还没有记忆</Text>
                  <Text style={styles.prototypeCardDesc}>完成一次场景后会在此生成一条 Memory（host + guest 双视角可见）</Text>
                </View>
              ) : (
                memories.map((m) => (
                  <View key={m.memoryId} style={styles.prototypeCard}>
                    <Text style={styles.prototypeCardTitle}>
                      {m.sceneType ?? "Scene"} · {m.role === "HOST" ? "我是主人" : "我是客人"}
                    </Text>
                    <Text style={styles.prototypeCardDesc}>
                      实际花费 {(m.actualSpend / 1000).toFixed(0)}k {m.currency ?? ""}
                      {m.durationMin ? ` ·  ${m.durationMin} 分钟` : ""}
                      {typeof m.rating === "number" ? ` · 评分 ${(m.rating * 100).toFixed(0)}` : ""}
                    </Text>
                    {m.notes ? <Text style={styles.prototypeCardDesc}>{m.notes}</Text> : null}
                  </View>
                ))
              )}
            </View>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
              <Text style={styles.lightCtaText}>返回我的</Text>
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
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.appBehaviorTitle}>设置与隐私 · 安全</Text>
            <SecuritySettings
              retentionDays={securityRetention}
              onRetentionChange={setSecurityRetention}
              screenshotWarnEnabled={screenshotWarn}
              onToggleScreenshotWarn={setScreenshotWarn}
            />
            <Text style={[styles.appBehaviorTitle, { marginTop: 24 }]}>应用行为检查</Text>
            {checks.map(([title, desc], index) => (
              <View key={title} style={[styles.appBehaviorCard, index === checks.length - 1 && styles.appBehaviorCardDark]}>
                <Text style={[styles.appBehaviorCardTitle, index === checks.length - 1 && styles.appBehaviorCardTitleDark]}>{title}</Text>
                <Text style={[styles.appBehaviorCardDesc, index === checks.length - 1 && styles.appBehaviorCardDescDark]}>{desc}</Text>
              </View>
            ))}
            <Pressable onPress={() => setSubPage(undefined)} style={styles.appBehaviorReturn}>
              <Text style={styles.appBehaviorReturnText}>返回我的</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // R16.10-P1-F: privacy request center subpage. Mounts the
    // PrivacySettings component against the active session's
    // PrivacyClient. The subpage stays inside the standard me.tsx
    // navigation stack so the user can back out with the same swipe
    // gesture they use for the other subpages.
    if (subPage.route === "privacy") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.appBehaviorTitle}>我的隐私</Text>
            <Text style={styles.appBehaviorCardDesc}>
              依据《个人数据保护法》91/2025/QH15 第 31 条 (访问权) 与第 32 条 (删除权), 你可以随时下载或删除 Proxy 保存的个人数据。
            </Text>
            <Text style={styles.appBehaviorCardDesc}>
              如需联系 DPO (数据保护官) 或申诉数据处理问题, 请发邮件至 privacy@proxy.vn (最终地址以《服务协议》§53 为准)。依据 PDP 91/2025/QH15 Art. 13, Proxy 已指定 DPO 负责监管个人数据处理活动及处理用户申诉。
            </Text>
            <PrivacySettings
              client={resolvePrivacyRequestClient({ baseUrl: localApiBaseUrl, transport: nativeTransport })}
            />
            <PreciseLocationCard
              client={resolveLocationConsentClient({ baseUrl: localApiBaseUrl, transport: nativeTransport })}
            />
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialidentity") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.socialAccountsContent}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.socialAccountsTitle}>社媒账户</Text>
            <Text style={styles.socialAccountsSub}>管理你的外部社交平台。账号、链接和公开范围都由你控制。</Text>
            <CreatorInvitationCard />
            <View style={styles.socialShareBox}>
              <View style={styles.socialSettingsHead}><Text style={styles.socialSettingsTitle}>合作</Text><Text style={styles.socialSettingsHint}>{collaboration.enabled ? "已开放" : "未开放"}</Text></View>
              <View style={styles.socialSettingRow}><View style={styles.socialAccountCopy}><Text style={styles.socialSettingName}>接受合作邀请</Text><Text style={styles.socialSettingDesc}>关闭后不影响普通账号使用</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: collaboration.enabled }} onPress={() => setCollaboration((v) => ({ ...v, enabled: !v.enabled }))} style={[styles.socialSwitch, collaboration.enabled ? styles.socialSwitchOn : null]}><View style={[styles.socialSwitchDot, collaboration.enabled ? styles.socialSwitchDotOn : null]} /></Pressable></View>
              <Text style={styles.socialEditorLabel}>合作类型</Text>
              <View style={styles.socialVisibilityRow}>{["探店", "UGC", "拍摄", "同行", "其他"].map((type) => <Pressable key={type} onPress={() => setCollaboration((v) => ({ ...v, types: v.types.includes(type) ? v.types.filter((x) => x !== type) : [...v.types, type] }))} style={[styles.socialVisibilityButton, collaboration.types.includes(type) ? styles.socialVisibilityButtonOn : null]}><Text style={[styles.socialVisibilityText, collaboration.types.includes(type) ? styles.socialVisibilityTextOn : null]}>{type}</Text></Pressable>)}</View>
              <Text style={styles.socialEditorLabel}>报价（可选）</Text><TextInput placeholder="例如：500,000 VND / 次" style={styles.socialEditorInput} value={collaboration.rate} onChangeText={(rate) => setCollaboration((v) => ({ ...v, rate }))} />
              <Text style={styles.socialEditorLabel}>合作联系方式</Text><TextInput placeholder="合作建立后开放" style={styles.socialEditorInput} value={collaboration.contact} onChangeText={(contact) => setCollaboration((v) => ({ ...v, contact }))} />
            </View>
            <View style={styles.socialAccountList}>
            {socialAccounts.map((account) => (
              <Pressable key={account.key} onPress={() => setSocialEditor({ ...account })} style={styles.socialAccountRow}>
                <View style={[styles.socialAccountIcon, account.dark ? styles.socialAccountIconDark : null]}>
                  <Text style={[styles.socialAccountIconText, account.dark ? styles.socialAccountIconTextDark : null]}>{account.mark}</Text>
                </View>
                <View style={styles.socialAccountCopy}>
                  <Text style={styles.socialAccountName}>{account.name}</Text>
                  <Text numberOfLines={1} style={styles.socialAccountHandle}>{account.handle || "未关联"}</Text>
                  <Text numberOfLines={1} style={styles.socialAccountUrl}>{account.url ? account.url.replace(/^https?:\/\/(www\.)?/, "") : "添加账号后可生成主页链接"}</Text>
                </View>
                <View style={styles.socialAccountTrailing}>
                  <View style={[styles.socialAccountState, account.visibility !== "仅自己" ? styles.socialAccountStateActive : null]}><Text style={[styles.socialAccountStateText, account.visibility !== "仅自己" ? styles.socialAccountStateTextActive : null]}>{account.handle ? account.visibility : "关联"}</Text></View>
                  <Text style={styles.socialAccountChev}>›</Text>
                </View>
              </Pressable>
            ))}
            </View>

            <View style={styles.socialSettingsHead}><Text style={styles.socialSettingsTitle}>展示设置</Text><Text style={styles.socialSettingsHint}>按需开放</Text></View>
            {([['merchant', '商家合作资料', '允许商家在合作场景查看你已开放的社媒账户。'], ['profile', '个人主页入口', '在个人主页显示一个轻量"社媒"入口，不直接铺开账号。'], ['influence', '影响力信息', '后续可向商家展示粉丝量等信息，默认关闭。']] as const).map(([key, title, desc]) => (
              <View key={key} style={styles.socialSettingRow}>
                <View style={styles.socialAccountCopy}><Text style={styles.socialSettingName}>{title}</Text><Text style={styles.socialSettingDesc}>{desc}</Text></View>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: socialSettings[key] }} onPress={() => setSocialSettings((current) => ({ ...current, [key]: !current[key] }))} style={[styles.socialSwitch, socialSettings[key] ? styles.socialSwitchOn : null]}><View style={[styles.socialSwitchDot, socialSettings[key] ? styles.socialSwitchDotOn : null]} /></Pressable>
              </View>
            ))}

            <View style={styles.socialShareBox}>
              <View style={styles.socialSettingsHead}><Text style={styles.socialSettingsTitle}>公开分享链接</Text><Text style={styles.socialSettingsHint}>可选</Text></View>
              <View style={styles.socialShareLine}><Text numberOfLines={1} style={styles.socialShareLink}>pxy.app/huyen/social</Text><Pressable onPress={() => void Share.share({ message: "https://pxy.app/huyen/social" })} style={styles.socialShareButton}><Text style={styles.socialShareButtonText}>分享</Text></Pressable></View>
              <Text style={styles.socialShareNote}>只有你设置为"公开展示"的账号会出现在这个分享页。商家可见账号不会自动公开。</Text>
            </View>
          </ScrollView>
          <Modal animationType="slide" onRequestClose={() => setSocialEditor(undefined)} transparent visible={Boolean(socialEditor)}>
            <Pressable onPress={() => setSocialEditor(undefined)} style={styles.socialEditorOverlay}>
              {socialEditor ? <Pressable onPress={(event) => event.stopPropagation()} style={styles.socialEditorSheet}>
                <View style={styles.socialEditorGrabber} />
                <View style={styles.socialEditorHead}><Text style={styles.socialEditorTitle}>{socialEditor.name}</Text><Pressable onPress={() => setSocialEditor(undefined)} style={styles.socialEditorClose}><Text style={styles.socialEditorCloseText}>×</Text></Pressable></View>
                <Text style={styles.socialEditorNote}>账号和主页链接用于跳转外部平台。展示范围可单独控制。</Text>
                <Text style={styles.socialEditorLabel}>账号</Text><TextInput onChangeText={(handle) => setSocialEditor((current) => current ? { ...current, handle } : current)} style={styles.socialEditorInput} value={socialEditor.handle} />
                <Text style={styles.socialEditorLabel}>主页链接</Text><TextInput autoCapitalize="none" keyboardType="url" onChangeText={(url) => { setSocialOpenError(undefined); setSocialEditor((current) => current ? { ...current, url } : current); }} style={styles.socialEditorInput} value={socialEditor.url} />
                <Text style={styles.socialEditorLabel}>谁可以看到</Text><View style={styles.socialVisibilityRow}>{(["仅自己", "商家可见", "公开展示"] as const).map((visibility) => <Pressable key={visibility} onPress={() => setSocialEditor((current) => current ? { ...current, visibility } : current)} style={[styles.socialVisibilityButton, socialEditor.visibility === visibility ? styles.socialVisibilityButtonOn : null]}><Text style={[styles.socialVisibilityText, socialEditor.visibility === visibility ? styles.socialVisibilityTextOn : null]}>{visibility}</Text></Pressable>)}</View>
                <Pressable disabled={!socialEditor.url} onPress={() => { const url = socialEditor.url.trim(); if (url) void Linking.openURL(/^https?:\/\//i.test(url) ? url : `https://${url}`).catch(() => setSocialOpenError("外部主页打不开，请检查链接后重试。")); }} style={styles.socialOpenLink}><Text style={styles.socialOpenLinkText}>打开外部主页</Text><Text style={styles.socialOpenLinkText}>↗</Text></Pressable>
                {socialOpenError ? <Text style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{socialOpenError}</Text> : null}
                <Pressable onPress={() => { setSocialAccounts((current) => current.map((account) => account.key === socialEditor.key ? socialEditor : account)); setSocialEditor(undefined); }} style={styles.socialSave}><Text style={styles.socialSaveText}>保存</Text></Pressable>
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
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>可见范围</Text>
            <View style={styles.visibilityLadder}>
              {levels.map(([step, title, desc, tag]) => (
                <View key={step} style={styles.visibilityStep}>
                  <View style={styles.visibilityIndex}><Text style={styles.visibilityIndexText}>{step}</Text></View>
                  <View style={styles.visibilityCopy}>
                    <Text style={styles.visibilityTitle}>{title}</Text>
                    <Text style={styles.visibilityDesc}>{desc}</Text>
                  </View>
                  <Text style={styles.visibilityTag}>{tag}</Text>
                </View>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>当前规则</Text>
              <Text style={styles.detailSectionHint}>可编辑</Text>
            </View>
            {[["TT", "TikTok", "公开"], ["Z", "Zalo", "合作后"], ["☎", "手机号", "合作后 · 订单结束可关闭"]].map(([mark, title, desc]) => (
              <View key={title} style={styles.socialDetailRow}>
                <View style={styles.socialDetailIcon}><Text style={styles.socialDetailIconText}>{mark}</Text></View>
                <View style={styles.socialDetailCopy}>
                  <Text style={styles.socialDetailLabel}>{title}</Text>
                  <Text style={styles.socialDetailDesc}>{desc}</Text>
                </View>
                <Text style={styles.socialDetailChev}>›</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialanalytics") {
      const funnel = [["主页访问", "100%", "1,284"], ["合格聊天", "54%", "47"], ["机会", "34%", "18"], ["订单", "22%", "9"], ["复购", "11%", "4"]] as const;
      const sources = [["Proxy 市场", "612", "26", "5"], ["TikTok", "338", "11", "2"], ["Zalo QR", "214", "8", "2"], ["Instagram", "120", "2", "0"]];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>访问与转化</Text>
            <Text style={styles.detailSub}>过去 30 天 · 只看真实下一步，不追虚荣指标。</Text>
            <View style={styles.funnelCard}>
              {funnel.map(([label, width, value]) => (
                <View key={label} style={styles.funnelRow}>
                  <Text style={styles.funnelLabel}>{label}</Text>
                  <View style={styles.funnelTrack}><Gradient from="#9D74E8" to="#6F36BE" style={[styles.funnelBar, { width }]} /></View>
                  <Text style={styles.funnelValue}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.sourceTable}>
              <View style={[styles.sourceRow, styles.sourceHead]}><Text style={styles.sourceHeadText}>来源</Text><Text style={styles.sourceHeadText}>访问</Text><Text style={styles.sourceHeadText}>聊天</Text><Text style={styles.sourceHeadText}>订单</Text></View>
              {sources.map(([source, visit, chat, order]) => (
                <View key={source} style={styles.sourceRow}><Text style={styles.sourceName}>{source}</Text><Text style={styles.sourceValue}>{visit}</Text><Text style={styles.sourceValue}>{chat}</Text><Text style={styles.sourceValue}>{order}</Text></View>
              ))}
            </View>
            <View style={styles.infoNote}>
              <Text style={styles.infoNoteTitle}>平台信誉仍来自 Proxy</Text>
              <Text style={styles.infoNoteText}>外部粉丝、点赞和播放量只帮助发现；准时、履约、Outcome 与复购才决定长期市场信誉。</Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "addfriend") {
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface relationship={relationshipClient} initialView="ADD_FRIEND" onBack={() => setSubPage(undefined)} onOpenConversation={(author) => { setSubPage(undefined); onOpenConversation?.(author); }} /></SwipeBackShell>;
    }

    if (subPage.route === "friendcrm") {
      return <SwipeBackShell onExit={() => setSubPage(undefined)}><FriendCrmSurface initialView="LIST" onBack={() => setSubPage(undefined)} onOpenConversation={(author) => { setSubPage(undefined); onOpenConversation?.(author); }} /></SwipeBackShell>;
    }

    if (subPage.route === "available") {
      if (availabilityPanel === "CALENDAR") {
        const days = nextDays(30);
        return contentWrapper(
          <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content}>
              <Pressable onPress={() => setAvailabilityPanel("ABILITIES")} style={styles.subPageBack}>
                <Text style={styles.subPageBackText}>‹ 返回能力</Text>
              </Pressable>
              <Text style={styles.detailTitle}>可用时间</Text>
              <Text style={styles.availabilityLead}>固定规律只设一次；临时变化点日期覆盖。</Text>

              <View style={styles.availabilityRuleCard}>
                <View style={styles.availabilityRuleIcon}><ProxySymbolIcon color={color.ink} symbol="clock" size={22} /></View>
                <View style={styles.availabilityRuleCopy}>
                  <Text style={styles.availabilityRuleKicker}>常用规律</Text>
                  <Text style={styles.availabilityRuleValue}>{describeAvRule(avRule)}</Text>
                </View>
                <Pressable onPress={() => setAvRuleSheetOpen(true)} style={styles.availabilityEditButton}><Text style={styles.availabilityEditText}>编辑</Text></Pressable>
              </View>

              <View style={styles.availabilityMonthCard}>
                <View style={styles.availabilityMonthHead}>
                  <Text style={styles.availabilityMonthTitle}>未来 30 天</Text>
                  {Object.keys(avOverrides).length ? <Pressable onPress={() => setAvOverrides({})}><Text style={styles.availabilityClear}>清除例外</Text></Pressable> : null}
                </View>
                <View style={styles.availabilityWeekHead}>{["一", "二", "三", "四", "五", "六", "日"].map((name) => <Text key={name} style={styles.availabilityWeekName}>{name}</Text>)}</View>
                <View style={styles.availabilityMonthGrid}>
                  {Array.from({ length: days.length ? (days[0]!.date.getDay() + 6) % 7 : 0 }).map((_, index) => <View key={`blank-${index}`} style={styles.availabilityMonthBlank} />)}
                  {days.map((day) => {
                    const state = avStateFor(day.date, avRule, avOverrides);
                    const dateNumber = day.date.getDate();
                    return (
                      <Pressable key={day.key} onPress={() => setAvDaySheet({ key: day.key, label: day.label })} style={[styles.availabilityMonthDay, styles[`availabilityMonthDay_${state.type}`]]}>
                        <Text style={[styles.availabilityMonthNumber, state.type === "off" && styles.availabilityMonthNumberOff]}>{dateNumber}</Text>
                        {state.type === "base" ? <View style={styles.availabilityBaseDot} /> : null}
                        {state.type === "off" ? <Text style={styles.availabilityOffMark}>×</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.availabilityLegend}>
                  <Text style={styles.availabilityLegendText}>● 规律可用</Text><Text style={styles.availabilityLegendText}>绿色 全天</Text><Text style={styles.availabilityLegendText}>描边 自定义</Text><Text style={styles.availabilityLegendText}>× 休息</Text>
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
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>能力与可用时间</Text>
            <Text style={styles.detailSub}>维护你愿意接受邀请的能力。</Text>

            <Pressable onPress={() => setAvailabilityPanel("CALENDAR")} style={styles.availabilitySummaryCard}>
              <View style={styles.availabilityRuleIcon}><ProxySymbolIcon color={color.ink} symbol="clock" size={22} /></View>
              <View style={styles.availabilityRuleCopy}><Text style={styles.prototypeCardTitle}>可用时间</Text><Text style={styles.abilitySub}>{describeAvRule(avRule)} · {Object.keys(avOverrides).length} 个例外</Text></View>
              <Text style={styles.walletActionArrow}>›</Text>
            </Pressable>

            <View style={styles.detailSectionHead}><Text style={styles.detailSectionTitle}>我的能力</Text><Text style={styles.detailSectionHint}>{abilities.length} 项 · {passportError ? "同步失败" : "已接 supply"}</Text></View>
            {passportError ? <Text style={{ color: "#B00020", fontSize: 11, marginBottom: 6 }}>{passportError}</Text> : null}
            {abilities.map((ability) => (
              <View key={ability.id} style={styles.abilityCompactCard}>
                <View style={styles.abilityHead}>
                  <View style={styles.abilityIcon}><Text style={styles.abilityIconText}>{ABILITY_SCHEMAS[ability.type].icon}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prototypeCardTitle}>{ability.type}</Text>
                    <Text style={styles.abilitySub}>{ABILITY_SCHEMAS[ability.type].subtitle}</Text>
                  </View>
                  <Pressable accessibilityLabel={`编辑${ability.type}`} onPress={() => setAbilitySheet({ mode: "EDIT", type: ability.type, id: ability.id })} style={styles.availabilityEditButton}><Text style={styles.availabilityEditText}>编辑</Text></Pressable>
                </View>
                <View style={styles.abilityFieldChips}>{ability.fields.filter((field) => field.value.trim().length > 0).map((field) => <View key={field.label} style={styles.abilityFieldChip}><Text style={styles.abilityFieldChipText}><Text style={styles.abilityFieldChipLabel}>{field.label} </Text>{field.value}</Text></View>)}</View>
              </View>
            ))}
            <View style={styles.addAbilityRow}>{(["同行", "翻译", "拍照"] as AbilityType[]).map((type) => <Pressable key={type} accessibilityLabel={`添加${type}`} onPress={() => setAbilitySheet({ mode: "ADD", type })} style={styles.addAbilityChip}><Text style={styles.addAbilityChipText}>＋ {type}</Text></Pressable>)}</View>

            <Pressable
              onPress={() => openSubPage("personalhub")}
              style={[styles.primaryCta, abilities.length === 0 && { opacity: 0.5 }]}
            >
              <Text style={styles.primaryCtaText}>预览主页展示</Text>
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
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>钱包与结算</Text>
            <Text style={styles.subPageDesc}>只展示 Proxy 真正经手或需要记录的资金状态。账本接口未接入前不编造余额。</Text>

            <View style={styles.walletDarkCard}>
              <Text style={styles.walletDarkLabel}>可用余额</Text>
              <Text style={styles.walletDarkAmount}>—</Text>
              <Text style={styles.walletDarkHint}>账本未接入，未知不画数</Text>
            </View>

            <View style={styles.walletCard}>
              <Text style={styles.walletCardLabel}>待结算收入</Text>
              <Text style={styles.walletCardValue}>—</Text>
              <Text style={styles.walletCardHint}>来自平台支付订单（待账本接入）</Text>
            </View>

            <View style={styles.walletCard}>
              <Text style={styles.walletCardLabel}>直接结算记录</Text>
              <Text style={styles.walletCardHint}>个人时间 / 技能服务可由双方直接结算；这里只保留合作确认与双方状态。</Text>
            </View>

            <Pressable onPress={() => openSubPage("myorders")} style={styles.walletAction} accessibilityLabel="现场结算记录">
              <Text style={styles.walletActionIcon}>₫</Text>
              <View style={styles.walletActionBody}>
                <Text style={styles.walletActionLabel}>现场结算记录</Text>
                <Text style={styles.walletActionDesc}>查看双方确认状态</Text>
              </View>
              <Text style={styles.walletActionArrow}>›</Text>
            </Pressable>

            <Pressable onPress={() => openSubPage("myorders")} style={styles.walletBtnLight} accessibilityLabel="退款记录">
              <Text style={styles.walletBtnLightText}>退款记录</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "personalmanage") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>个人总管理</Text>
            <Text style={styles.subPageSub}>基本信息、二维码、状态管理都集中在这里。</Text>

            <Text style={styles.customSectionTitle}>基本信息</Text>
            <Text style={styles.customSectionHint}>公开主页展示</Text>
            <View style={styles.profileManageRow}>
              <View style={styles.profileManageAva}>
                {profileAvatarUri ? <CircularAvatarImage accessibilityLabel={`${profileDraft.name}头像`} size={88} uri={profileAvatarUri} /> : <Text style={styles.profileManageAvaLetter}>{profileDraft.name.slice(0, 1).toUpperCase()}</Text>}
              </View>
              <View style={styles.profileManageCopy}>
                <Text style={styles.profileManageName}>{profileDraft.name}</Text>
                <Text style={styles.profileManageHandle}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
                <Text style={styles.profileManageCity}>{profileDraft.city || "河内"}</Text>
              </View>
              <Pressable accessibilityLabel="编辑头像" onPress={() => void chooseProfileAvatar()} style={styles.profileManageEdit}>
                <Text style={styles.profileManageEditText}>换头像</Text>
              </Pressable>
            </View>
            <Pressable accessibilityLabel="编辑资料" onPress={() => setProfileEditorOpen(true)} style={styles.profileManageEdit}>
              <Text style={styles.profileManageEditText}>编辑资料</Text>
            </Pressable>

            <Text style={styles.customSectionTitle}>二维码</Text>
            <Text style={styles.customSectionHint}>分享主页链接</Text>
            <QrCard
              title={`${profileDraft.name} · Proxy`}
              desc="分享你的 Proxy 主页链接（二维码图形升级中，先分享链接）。"
              actionLabel="分享主页链接"
              onAction={() => { void Share.share({ message: `查看 ${profileDraft.name} 的 Proxy 主页：proxy.app/@${profileDraft.handle}` }); }}
              alignCenter
            />

            <Text style={styles.customSectionTitle}>状态管理</Text>
            <Text style={styles.customSectionHint}>决定你出现在人物发现、机会分发的方式</Text>
            <Pressable
              accessibilityLabel="选择状态"
              onPress={() => setAvailabilityOpen(true)}
              style={styles.profileManageStatusRow}
            >
              <View style={styles.profileManageStatusDot} />
              <View style={styles.profileManageStatusCopy}>
                <Text style={styles.profileManageStatusLabel}>当前状态</Text>
                <Text style={styles.profileManageStatusValue}>● {availabilityLabel(availability)}</Text>
              </View>
              <Text style={styles.profileManageStatusChev}>›</Text>
            </Pressable>
          </ScrollView>

          <AvailabilitySheet current={availability} open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} onSelect={(next) => setAvailability(next)} />

        </View>
      );
    }

    if (subPage.route === "personalhub") {
      const personalPhotos = profilePosts.flatMap((post) => (profileMedia[post.postId] ?? []).map((item, index) => ({ item, index, postId: post.postId }))).filter((entry) => entry.item.mediaType === "IMAGE");
      const viewedItems = profileViewer ? profileMedia[profileViewer.postId] ?? [] : [];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.personalHubContent}>
            <View style={styles.personalTopbar}>
              <Pressable accessibilityLabel="返回" onPress={() => setSubPage(undefined)} style={styles.personalTopbarButton}>
                <Text style={styles.personalTopbarIcon}>‹</Text>
              </Pressable>
              <Text numberOfLines={1} style={styles.personalTopbarHandle}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
              <View style={styles.personalTopbarTools}>
                <Pressable accessibilityLabel="分析" style={styles.personalTopbarIconBtn} onPress={() => setInsightsSheetOpen(true)}>
                  <ProxyIcon name="ring" color={color.ink} size={20} />
                </Pressable>
                <Pressable accessibilityLabel="搜索" style={styles.personalTopbarIconBtn} onPress={() => { setSearchQuery(""); setProfileSearchResults(undefined); setSearchSheetOpen(true); }}>
                  <ProxyIcon name="crosshair" color={color.ink} size={20} />
                </Pressable>
                <Pressable accessibilityLabel="更多" style={styles.personalTopbarIconBtn} onPress={() => setSettingsSheetOpen(true)}>
                  <ProxyIcon name="settings" color={color.ink} size={20} />
                </Pressable>
              </View>
            </View>

            <View style={styles.personalHead}>
              <View style={styles.personalNameBlock}>
                <Text numberOfLines={1} style={styles.personalName}>{profileDraft.name}</Text>
                <Text numberOfLines={1} style={styles.personalHandleSub}>{profileDraft.handle.startsWith("@") ? profileDraft.handle : `@${profileDraft.handle}`}</Text>
              </View>
              <View style={styles.personalAvaWrap}>
                <View style={styles.personalAva}>
                  {profileAvatarUri ? <CircularAvatarImage accessibilityLabel={`${profileDraft.name}头像`} size={82} uri={profileAvatarUri} /> : <Text style={styles.personalAvaLetter}>{profileDraft.name.slice(0, 1).toUpperCase()}</Text>}
                </View>
                <Pressable accessibilityLabel="更换头像" onPress={() => void chooseProfileAvatar()} style={styles.personalAvaAdd}>
                  <ProxyIcon name="plus" color="#333" size={15} />
                </Pressable>
              </View>
              {onOpenRealitySceneMap ? (
                <Pressable onPress={onOpenRealitySceneMap} style={styles.personalSceneEntry}>
                  <ProxyIcon color={color.violet} name="route" size={20} />
                  <View style={styles.personalSceneCopy}>
                    <Text style={styles.personalSceneTitle}>场景足迹</Text>
                    <Text style={styles.personalSceneSub}>历史公开记录与私人计划 · 非实时位置</Text>
                  </View>
                  <Text style={styles.personalSceneChevron}>›</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.personalBio}>
              <Text style={styles.personalBioText}>{profileDraft.bio || "介绍一下自己吧"}</Text>
              <View style={styles.personalLinkRow}>
                <ProxyIcon name="arrowUpRight" color="#666" size={12} />
                <Text style={styles.personalLinkText}>{profileDraft.handle.startsWith("@") ? profileDraft.handle.slice(1) : profileDraft.handle}</Text>
              </View>
              <View style={styles.personalTopics}>
                {(() => {
                  const topics = profileDraft.city ? [profileDraft.city] : [];
                  return topics.map((t) => (
                    <View key={t} style={styles.personalTopicPill}><Text style={styles.personalTopicText}>{t}</Text></View>
                  ));
                })()}
              </View>
              <View style={styles.personalStat}>
                <Text style={styles.personalStatText}>
                  <Text style={styles.personalStatValue}>—</Text> 次浏览 · 最近 30 天 ›
                </Text>
              </View>
              <View style={styles.personalFollowersRow}>
                <View style={styles.personalFaces}>
                  <View style={[styles.personalFace, { backgroundColor: "#fde68a" }]}><Text style={styles.personalFaceText}>M</Text></View>
                  <View style={[styles.personalFace, { backgroundColor: "#bfdbfe" }]}><Text style={styles.personalFaceText}>A</Text></View>
                  <View style={[styles.personalFace, { backgroundColor: "#fbcfe8" }]}><Text style={styles.personalFaceText}>L</Text></View>
                </View>
                <Text style={styles.personalFollowersCount}><Text style={styles.personalFollowersValue}>{dash(personalFollowCounts?.followers)}</Text> 位关注者</Text>
              </View>
            </View>

            <ProfileTabs
              profileDraft={profileDraft}
              profileAvatarUri={profileAvatarUri}
              pinnedIds={personalPinnedIds}
              posts={profilePosts}
              mediaByPost={profileMedia}
              photos={personalPhotos}
              replyPosts={personalReplyPosts}
              savedPosts={personalSavedPosts}
              taggedPosts={personalTaggedPosts}
              stats={{ posts: profilePosts.length, followers: personalFollowCounts?.followers, following: personalFollowCounts?.following }}
              onOpenMedia={(entry) => setProfileViewer(entry)}
              onOpenRealitySceneMap={onOpenRealitySceneMap}
              onOpenScene={(sceneId) => {
                onOpenRealitySceneMap?.();
                if (sceneId && sceneId.length > 0) {
                  console.debug(`[profile] scene chip context: ${sceneId}`);
                }
              }}
              onEditProfile={() => setProfileEditorOpen(true)}
              onShareProfile={() => { void Share.share({ message: `查看 ${profileDraft.name} 的 Proxy 主页：proxy.app/@${profileDraft.handle}` }); }}
              onLikePost={engagement ? (postId) => { void engagement.reactToPost(postId, "LIKE", true).then(() => setLikeError(undefined)).catch(() => setLikeError("点赞没有提交成功，请检查连接后重试。")); } : undefined}
              viewerMode={isSelfProfile ? "SELF" : "OTHER"}
              isFollowing={false}
              followBusy={false}
              onFollow={undefined}
              onUnfollow={undefined}
              onSendMessage={undefined}
              resolveMediaUrl={(path) => localNet.resolveMediaUrl(path)}
              fallbackLogo={OTTER_LOGO}
              color={color}
            />
            {likeError ? <Text style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{likeError}</Text> : null}

          </ScrollView>
          <Modal animationType="slide" onRequestClose={() => setInsightsSheetOpen(false)} transparent visible={insightsSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text style={styles.sheetTitle}>分析</Text>
                <Text style={styles.sheetSub}>最近 30 天</Text>
                <View style={styles.sheetField}><Text style={styles.sheetFieldLabel}>浏览</Text><Text style={styles.sheetFieldValue}>—</Text></View>
                <View style={styles.sheetField}><Text style={styles.sheetFieldLabel}>互动</Text><Text style={styles.sheetFieldValue}>—</Text></View>
                <View style={styles.sheetField}><Text style={styles.sheetFieldLabel}>关注者</Text><Text style={styles.sheetFieldValue}>{dash(personalFollowCounts?.followers)}</Text></View>
                <Pressable onPress={() => setInsightsSheetOpen(false)} style={[styles.sheetWideBtn, styles.sheetWideBtnDark]}>
                  <Text style={styles.sheetWideBtnTextDark}>完成</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          <Modal animationType="slide" onRequestClose={() => setSearchSheetOpen(false)} transparent visible={searchSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text style={styles.sheetTitle}>搜索主页</Text>
                <Text style={styles.sheetSub}>搜自己主页的动态正文，点结果直接打开。</Text>
                <View style={styles.sheetField}>
                  <TextInput
                    autoFocus
                    placeholder="搜索用户名或关键词"
                    placeholderTextColor="#999"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onSubmitEditing={() => {
                      const q = searchQuery.trim();
                      if (q.length > 0) runProfileSearch(q);
                    }}
                    returnKeyType="search"
                    style={styles.sheetFieldInput}
                  />
                </View>
                {profileSearchResults !== undefined ? (
                  profileSearchResults.length === 0 ? (
                    <Text style={styles.sheetSub}>没有匹配的主页内容</Text>
                  ) : (
                    profileSearchResults.slice(0, 5).map((post) => (
                      <Pressable
                        key={post.postId}
                        onPress={() => { setSearchSheetOpen(false); setSearchQuery(""); setProfileSearchResults(undefined); setProfileViewer({ postId: post.postId, index: 0 }); }}
                        style={styles.sheetWideBtn}
                      >
                        <Text numberOfLines={2} style={styles.sheetWideBtnText}>{post.body.slice(0, 60)}</Text>
                      </Pressable>
                    ))
                  )
                ) : null}
                <Pressable
                  onPress={() => {
                    const q = searchQuery.trim();
                    if (q.length > 0) runProfileSearch(q);
                  }}
                  disabled={searchQuery.trim().length === 0}
                  style={[styles.sheetWideBtn, styles.sheetWideBtnDark, searchQuery.trim().length === 0 ? { opacity: 0.5 } : undefined]}
                >
                  <Text style={styles.sheetWideBtnTextDark}>搜索</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          <Modal animationType="slide" onRequestClose={() => setSettingsSheetOpen(false)} transparent visible={settingsSheetOpen}>
            <View style={styles.sheetOverlay}>
              <View style={styles.sheetCard}>
                <Text style={styles.sheetTitle}>主页设置</Text>
                <Text style={styles.sheetSub}>管理主页、隐私和设置。</Text>
                <Pressable onPress={() => { setSettingsSheetOpen(false); setProfileEditorOpen(true); }} style={styles.sheetWideBtn}>
                  <Text style={styles.sheetWideBtnText}>编辑个人资料</Text>
                </Pressable>
                <Pressable onPress={() => { setSettingsSheetOpen(false); void Share.share({ message: `查看 ${profileDraft.name} 的 Proxy 主页` }); }} style={styles.sheetWideBtn}>
                  <Text style={styles.sheetWideBtnText}>分享主页</Text>
                </Pressable>
                <Pressable onPress={() => { setSettingsSheetOpen(false); setAiIdentityOpen(true); }} style={styles.sheetWideBtn}>
                  <Text style={styles.sheetWideBtnText}>AI 身份中心</Text>
                </Pressable>
                <Pressable onPress={() => setSettingsSheetOpen(false)} style={[styles.sheetWideBtn, styles.sheetWideBtnDark]}>
                  <Text style={styles.sheetWideBtnTextDark}>完成</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
          <Modal animationType="slide" onRequestClose={() => setAiIdentityOpen(false)} visible={aiIdentityOpen}>
            <AIIdentityShowcaseSurface onBack={() => setAiIdentityOpen(false)} />
          </Modal>
          {profileViewer && viewedItems.length > 0 ? <MediaViewer items={viewedItems} index={profileViewer.index} author={profileDraft.name} resolveUrl={(path) => localNet.resolveMediaUrl(path)} onNavigate={(index) => setProfileViewer((current) => current ? { ...current, index } : current)} onClose={() => setProfileViewer(undefined)} /> : null}
        </View>
      );
    }

    if (subPage.route === "personalqr") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>我的二维码</Text>

            <QrCard
              title={`${profileDraft.name} · Proxy`}
              desc="分享你的 Proxy 主页链接（二维码图形升级中，先分享链接）。TikTok / Zalo 是否展示，继续遵循你的可见范围。"
              actionLabel="分享主页链接"
              onAction={() => { void Share.share({ message: `查看 ${profileDraft.name} 的 Proxy 主页：proxy.app/@${profileDraft.handle}` }); }}
              alignCenter
            />

            <Text style={styles.customSectionTitle}>扫码后看到</Text>
            <Text style={styles.customSectionHint}>预览</Text>
            <View style={styles.privacyLadder}>
              {[
                ["1", "Proxy 主页", "姓名、城市、公开能力、Proxy 信誉", "始终"],
                ["2", "TikTok / Instagram", "当前设为公开", "公开"],
                ["3", "Zalo", "订单成立后才开放", "合作后"]
              ].map(([i, t, d, v]) => (
                <View key={i} style={styles.privacyStep}>
                  <View style={styles.privacyStepIndex}>
                    <Text style={styles.privacyStepIndexText}>{i}</Text>
                  </View>
                  <View style={styles.privacyStepCopy}>
                    <Text style={styles.privacyStepTitle}>{t}</Text>
                    <Text style={styles.privacyStepDesc}>{d}</Text>
                  </View>
                  <View style={styles.privacyStepTag}>
                    <Text style={styles.privacyStepTagText}>{v}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "enterpriseops") {
      const draftReady = enterpriseOpsStage !== "READY";
      const confirmed = enterpriseOpsStage === "CONFIRMED" || enterpriseOpsStage === "PUBLISHED";
      const published = enterpriseOpsStage === "PUBLISHED";
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.enterpriseHero}>
              <Text style={styles.enterpriseSkillId}>enterprise_ops</Text>
              <Text style={styles.enterpriseHeroTitle}>企业运营助手</Text>
              <Text style={styles.enterpriseHeroText}>上传现实资料，或直接说"建店、整理商品、做内容、复盘经营"。系统只生成 Draft，业务真源始终要由商家确认。</Text>
            </View>
            <View style={styles.enterpriseRuntime}>
              <Text style={styles.enterpriseRuntimeTitle}>Unified Model Runtime</Text>
              <Text style={styles.enterpriseRuntimeText}>Skill 只声明理解、抽取与写作能力；底层模型由模型底座分发，业务端不绑定具体模型。</Text>
            </View>
            <View style={styles.enterpriseQuickGrid}>
              {[
                ["把店铺数字化", "照片 / 菜单 / 产品 / 品牌资料 → Store Draft"],
                ["整理商品与菜单", "Catalog Draft / 分类 / 描述 / 素材"],
                ["做内容与推广草稿", "Post / Benefit / Campaign Draft"],
                ["复盘门店经营", "基于订单、结果与客流数据给建议"]
              ].map(([title, desc]) => (
                <Pressable key={title} accessibilityLabel={title} onPress={() => setEnterpriseOpsStage("DRAFT_READY")} style={styles.enterpriseQuick}>
                  <Text style={styles.enterpriseQuickTitle}>{title}</Text>
                  <Text style={styles.enterpriseQuickDesc}>{desc}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>给 Proxy 看现实资料</Text>
              <Text style={styles.detailSectionHint}>{enterpriseAssets.length} 个 Source Assets</Text>
            </View>
            <View style={styles.enterpriseAssetTray}>
              {enterpriseAssets.map((asset) => (
                <View key={`${asset.label}-${asset.uri ?? "preset"}`} style={styles.enterpriseAsset}>
                  {asset.uri ? <Image source={{ uri: asset.uri }} style={styles.enterpriseAssetThumbImg} /> : <Text style={styles.enterpriseAssetThumb}>▧</Text>}
                  <Text style={styles.enterpriseAssetText}>{asset.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.enterpriseAssetActions}>
              <Pressable onPress={() => void addEnterpriseAsset("photo")} style={styles.lightCta}><Text style={styles.lightCtaText}>拍店铺 / 产品</Text></Pressable>
              <Pressable onPress={() => void addEnterpriseAsset("file")} style={styles.lightCta}><Text style={styles.lightCtaText}>上传文件</Text></Pressable>
            </View>
            {enterpriseAssetError ? <Text style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{enterpriseAssetError}</Text> : null}
            {draftReady ? (
              <View style={styles.enterpriseDraft}>
                <Text style={styles.enterpriseDraftTitle}>Store Digitization Draft</Text>
                {[["Bonsaidon", "海鲜自助 · 河内 · 11:00–22:00", "结构 ✓"], ["工作日下午双人权益", "329,000₫ · 来源：菜单与活动资料", "96%"], ["双人晚餐预约套餐", "599,000₫ · 来源：菜单照片", "需确认"]].map(([name, meta, state]) => (
                  <View key={name} style={styles.enterpriseDraftRow}>
                    <View style={styles.enterpriseDraftCopy}><Text style={styles.enterpriseDraftName}>{name}</Text><Text style={styles.enterpriseDraftMeta}>{meta}</Text></View>
                    <Text style={styles.enterpriseDraftState}>{state}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {draftReady && !confirmed ? <Pressable onPress={() => setEnterpriseOpsStage("CONFIRMED")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>确认这个 Draft</Text></Pressable> : null}
            {confirmed && !published ? <Pressable onPress={() => setEnterpriseOpsStage("PUBLISHED")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>发布线上店铺</Text></Pressable> : null}
            {published ? <Pressable onPress={() => openSubPage("merchantstorefront")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>查看已发布店铺</Text></Pressable> : null}
            <View style={styles.infoNote}><Text style={styles.infoNoteTitle}>Skill Boundary</Text><Text style={styles.infoNoteText}>Source Asset → Model Output → Draft Artifact → Merchant Confirmation → Authorized Domain Command。模型不直接成为 Merchant、Catalog 或 Order 真源。</Text></View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "trustedteam") {
      const executors = [
        { initial: "A", name: "An · 活动接待", meta: "河内 · 最近合作 8 天前", rating: "4.9", stats: [["18 次", "完成合作"], ["94%", "按时率"], ["可用", "本周六"]] },
        { initial: "M", name: "Minh · 中越口译", meta: "北宁 / 河内 · 最近合作 12 天前", rating: "4.8", stats: [["12 次", "完成合作"], ["97%", "按时率"], ["可用", "周末"]] }
      ];
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>合作执行网络</Text>
            <Text style={styles.detailSub}>Bonsaidon · 真实合作过 27 人 · 本周 11 人可用</Text>
            {executors.map((executor) => (
              <View key={executor.initial} style={styles.trustedExecutorCard}>
                <View style={styles.trustedExecutorTop}>
                  <Gradient from={color.magenta} to={color.violet} style={styles.trustedExecutorAvatar}><Text style={styles.trustedExecutorAvatarText}>{executor.initial}</Text></Gradient>
                  <View style={styles.trustedExecutorCopy}>
                    <Text style={styles.trustedExecutorName}>{executor.name}</Text>
                    <Text style={styles.trustedExecutorMeta}>{executor.meta}</Text>
                  </View>
                  <Text style={styles.trustedExecutorRating}>{executor.rating}</Text>
                </View>
                <View style={styles.trustedExecutorStats}>
                  {executor.stats.map(([value, label]) => (
                    <View key={label} style={styles.trustedExecutorStat}>
                      <Text style={styles.trustedExecutorStatValue}>{value}</Text>
                      <Text style={styles.trustedExecutorStatLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.trustedSuggestion}>
              <View style={styles.trustedSuggestionHead}><Text style={styles.trustedSuggestionTitle}>智能辅助 建议组合</Text><Text style={styles.trustedSuggestionHint}>不自动下单</Text></View>
              <View style={styles.trustedSuggestionBody}>
                <Text style={styles.trustedSuggestionBodyTitle}>周六新店活动 · 推荐 4 人</Text>
                <Text style={styles.trustedSuggestionBodyText}>优先复用 3 位历史合作 + 1 位探索型新执行者</Text>
              </View>
            </View>
            <Pressable accessibilityLabel="再次邀请团队" onPress={() => openSubPage("multislot")} style={styles.trustedInviteTouchable}>
              <Gradient from={color.magenta} to={color.violet} style={styles.trustedInvite}><Text style={styles.trustedInviteText}>再次邀请团队</Text></Gradient>
            </Pressable>
            <Pressable accessibilityLabel="返回我的企业" onPress={() => setSubPage(undefined)} style={styles.trustedReturn}><Text style={styles.trustedReturnText}>返回我的企业</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "multislot") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>门店开业</Text>
            {[["接待 · G-01", "已分配 · An"], ["接待 · G-02", "已分配 · Minh"], ["接待 · G-03", "待分配 · 独立名额"], ["口译 · I-01", "已分配"], ["内容人员 · C-01", "待分配"]].map(([name, detail]) => <View key={name} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{name}</Text><Text style={styles.prototypeCardDesc}>{detail}</Text></View>)}
            <View style={[styles.infoNote, styles.enterpriseProgressNote]}><Text style={styles.infoNoteTitle}>整体进度</Text><Text style={styles.infoNoteText}>4 / 5 名额 · 80%</Text></View>
            <Pressable onPress={() => openSubPage("todayboard")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>打开今日执行</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "todayboard") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>今日执行</Text>
            <View style={styles.enterpriseMetrics}>{[["5", "名额"], ["3", "已到场"], ["1", "有风险"]].map(([value, label]) => <View key={label} style={styles.enterpriseMetric}><Text style={styles.enterpriseMetricValue}>{value}</Text><Text style={styles.enterpriseMetricLabel}>{label}</Text></View>)}</View>
            {[["G-01 · An", "已到场 · 17:46"], ["G-02 · Minh", "前往中 · 预计 8 分钟"], ["G-03", "待补位 · 需要替补"]].map(([name, detail]) => <View key={name} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{name}</Text><Text style={styles.prototypeCardDesc}>{detail}</Text></View>)}
            <Pressable onPress={() => openSubPage("multislot")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>查看名额与补位</Text></Pressable>
            <Pressable onPress={() => openSubPage("members")} style={styles.lightCta}><Text style={styles.lightCtaText}>成员与权限</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "merchantstorefront") {
      if (business) {
        return contentWrapper(
          <View style={styles.root}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>线上店铺</Text>
            <MerchantStorefrontSurface client={business} viewerAccountId={viewerAccountId} />
          </View>
        );
      }
      return contentWrapper(
        <View style={styles.root}>
          <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
            <Text style={styles.subPageBackText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.subPageTitle}>线上店铺</Text>
          <View style={styles.infoNote}><Text style={styles.infoNoteText}>请在 “商家” Tab 登录后查看</Text></View>
        </View>
      );
    }

    if (subPage.route === "bdash") {
      return contentWrapper(
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>企业 / 店铺资料</Text>

            <View style={styles.storeTop}>
              <View style={styles.storeTopRow}>
                <Gradient from={color.magenta} to={color.violet} style={styles.storeAvatar}>
                  <Text style={styles.storeAvatarText}>B</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroName}>{liveShopName ?? persona.name}</Text>
                  <Text style={styles.heroMeta}>{liveShopName ? "我的店铺" : (persona.contextLineLabel ?? "")}</Text>
                </View>
              </View>
            </View>

            <QrCard
              title="商家身份二维码"
              desc="顾客扫码核验商家主体与真实到店记录，扫码先看到门店主页与信誉。"
              actionLabel="打开商家二维码"
              onAction={() => openSubPage("personalqr")}
            />

            <View style={styles.subSection}>
              <Text style={styles.subSectionTitle}>企业主体</Text>
              {[
                ["主体名称", "Bonsaidon · 海鲜自助"],
                ["经营城市", "河内"],
                ["经营节点", "3 个"],
                ["身份验证", "已认证 · Proxy 商家身份"]
              ].map(([label, value]) => (
                <View key={label} style={styles.subRow}>
                  <Text style={styles.subRowLabel}>{label}</Text>
                  <Text style={styles.subRowValue}>{value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.customSectionTitle}>二维码与展示</Text>
            <Text style={styles.customSectionHint}>Proxy 商家身份</Text>
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

    return contentWrapper(
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
            <Text style={styles.subPageBackText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.detailTitle}>{subPage.title}</Text>
          <Text style={styles.detailSub}>{subPage.desc}</Text>

          {content?.sections?.map((section, sIdx) => (
            <View key={sIdx} style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text style={styles.detailSectionTitle}>{section.title}</Text>
              </View>
              {section.rows.map((row, rIdx) => (
                <View key={rIdx} style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>{row.label}</Text>
                  {row.value ? <Text style={styles.prototypeCardDesc}>{row.value}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          {!content?.sections ? (
            <View style={styles.infoNote}>
              <Text style={styles.infoNoteTitle}>正在准备这个工作区</Text>
              <Text style={styles.infoNoteText}>它会沿用此页面的真实业务对象和权限边界，不再以通用占位页替代。</Text>
            </View>
          ) : null}
          <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
            <Text style={styles.lightCtaText}>返回我的</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.pageTitleRow}>
          <Text style={styles.pageTitle}>{persona.pageTitle}</Text>
        </View>

        {persona.profileCard ? (
          <Pressable onPress={() => openSubPage(persona.profileCard!.route)} style={styles.profileCard}>
            <View style={styles.profileTop}>
              <Gradient from="#241246" to="#7A2CFF" style={styles.profileAvatar}>
                {hubProfile.hasAvatar ? (
                  <CircularAvatarImage accessibilityLabel={`${hubProfile.displayName}头像`} size={46} uri={profileAvatarUri!} />
                ) : (
                  <Text style={styles.profileAvatarText}>{hubProfile.initial}</Text>
                )}
              </Gradient>
              <View style={styles.profileCopy}>
                <Text style={styles.profileName}>{hubProfile.displayName}</Text>
                <View style={styles.profileMeta}>
                  <Text style={styles.profileMetaText}>{hubProfile.city}</Text>
                  {hubProfile.handle ? (
                    <>
                      <View style={styles.profileVerifyDot}>
                        <Text style={styles.profileVerifyText}>@</Text>
                      </View>
                      <Text style={styles.profileMetaText}>{hubProfile.handle}</Text>
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
                <Text style={styles.profileStatusText}>● {availabilityLabel(availability)}</Text>
              </Pressable>
            </View>
            <View style={styles.profileSocial}>
              {(() => {
                // R18.x HUB-SOCIAL-001: see resolveHubSocials
                // in ./me-types for the precedence rules.
                const hubSocials = resolveHubSocials(socialAccounts);
                if (hubSocials.isEmpty) {
                  return <Text style={styles.profileSocialMore}>去 “我的” → 社媒账户 设置 ›</Text>;
                }
                return hubSocials.visible.map((social) => (
                  <View
                    key={social.key}
                    style={[styles.profileSocialBadge, social.mark === "TT" && styles.profileSocialBadgeOn, social.dark && styles.profileSocialBadgeDark]}
                  >
                    <Text style={styles.profileSocialBadgeText}>{social.mark}</Text>
                  </View>
                ));
              })()}
              <Text style={styles.profileSocialMore}>社媒与二维码 ›</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.identityCard}>
            {persona.avatarGrad ? (
              <Gradient from={color.magenta} to={color.violet} style={styles.identityAvatar}>
                {hubProfile.hasAvatar ? (
                  <CircularAvatarImage accessibilityLabel={`${hubProfile.displayName}头像`} size={40} uri={profileAvatarUri!} />
                ) : (
                  <Text style={styles.identityAvatarText}>{hubProfile.initial}</Text>
                )}
              </Gradient>
            ) : (
              <View style={[styles.identityAvatar, styles.identityAvatarSolid]}>
                {hubProfile.hasAvatar ? (
                  <CircularAvatarImage accessibilityLabel={`${hubProfile.displayName}头像`} size={40} uri={profileAvatarUri!} />
                ) : (
                  <Text style={styles.identityAvatarText}>{hubProfile.initial}</Text>
                )}
              </View>
            )}
            <View style={styles.identityCopy}>
              <Text style={styles.identityName}>{hubProfile.displayName}</Text>
              <Text style={styles.identityDesc}>{persona.desc}</Text>
            </View>
            <Pressable
              onPress={() => persona.identityActionSwitch && onOpenSwitcher()}
              style={styles.identityButton}
            >
              <Text style={styles.identityButtonText}>{persona.identityActionLabel}</Text>
            </Pressable>
          </View>
        )}

        {context === "REQUESTER" ? (
          <Pressable accessibilityLabel="礼品券，3 张可用，去使用" onPress={onOpenVouchers} style={styles.voucherPin}>
            <View style={styles.voucherPinMark}><VoucherMenuGlyph color={color.ink} /></View>
            <View style={styles.voucherPinCopy}>
              <Text style={styles.voucherPinTitle}>礼品券</Text>
              <Text style={styles.voucherPinDesc}>咖啡券、体验券与活动券</Text>
            </View>
            <View style={styles.voucherPinRight}>
              <Text style={styles.voucherPinCount}>3 张可用</Text>
              <Text style={styles.voucherPinAction}>去使用 ›</Text>
            </View>
          </Pressable>
        ) : null}

        {persona.alert ? (
          <Pressable onPress={() => persona.alert && openSubPage(persona.alert.route)} style={styles.bizAlert}>
            <View style={styles.bizAlertMark}>
              <Text style={styles.bizAlertMarkText}>{persona.alert.icon}</Text>
            </View>
            <View style={styles.bizAlertCopy}>
              <Text style={styles.bizAlertTitle}>{persona.alert.title}</Text>
              <Text style={styles.bizAlertDesc}>{persona.alert.desc}</Text>
            </View>
            <Text style={styles.bizAlertTag}>{persona.alert.tag}</Text>
          </Pressable>
        ) : null}

        {effectiveSections.map((section) => (
          <View key={section.id ?? section.title} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionHint}>{section.hint}</Text>
            </View>
            {section.rows.map((row) => (
              <ServiceRow key={row.label} onPress={() => pressRow(row)} row={row} />
            ))}
          </View>
        ))}

        <View style={styles.contextLine}>
          <Text style={styles.contextLineText}>{persona.contextLineLabel}</Text>
          <Pressable onPress={onOpenSwitcher}>
            <Text style={styles.contextLineAction}>{persona.contextLineAction} ›</Text>
          </Pressable>
        </View>

        {persona.settingsRow ? (
          <ServiceRow onPress={() => persona.settingsRow && pressRow(persona.settingsRow)} row={persona.settingsRow} />
        ) : null}

        <Pressable onPress={onSignOut} style={styles.signOut}>
          <Text style={styles.signOutText}>退出登录</Text>
        </Pressable>
      </ScrollView>
      {/* 个人资料编辑器放根：个人总管理 / 个人主页都能开（原来只在个人主页分支里，总管理页打不开）。 */}
      <Modal animationType="slide" onRequestClose={() => setProfileEditorOpen(false)} transparent visible={profileEditorOpen}>
        <View style={styles.profileEditorOverlay}>
          <View style={styles.profileEditorSheet}>
            <View style={styles.profileEditorHead}><Text style={styles.profileEditorTitle}>编辑主页</Text><Pressable onPress={() => void saveProfile()}><Text style={styles.profileEditorDone}>完成</Text></Pressable></View>
            {profileSaveError ? <Text style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{profileSaveError}</Text> : null}
            <Pressable onPress={() => void chooseProfileAvatar()} style={styles.profileEditorAvatarRow}>
              <Image source={profileAvatarUri ? { uri: profileAvatarUri } : OTTER_LOGO} style={styles.profileEditorAvatar} />
              <View><Text style={styles.profileEditorAvatarTitle}>更换头像</Text><Text style={styles.profileEditorAvatarHint}>从之前发布或手机相册选择</Text></View>
            </Pressable>
            {([['name', '显示名称'], ['handle', '用户名'], ['bio', '一句话介绍'], ['city', '城市']] as const).map(([key, label]) => (
              <View key={key} style={styles.profileEditorField}><Text style={styles.profileEditorLabel}>{label}</Text><TextInput onChangeText={(value) => setProfileDraft((current) => ({ ...current, [key]: value }))} style={styles.profileEditorInput} value={profileDraft[key]} /></View>
            ))}
          </View>
        </View>
      </Modal>
      {/* 状态规则表放根：hub 头像旁状态点也能打开（原来只在 available 子页挂载）。 */}
      <AvRuleSheet onClose={() => setAvRuleSheetOpen(false)} onSave={setAvRule} open={avRuleSheetOpen} rule={avRule} />
    </View>
  );
}

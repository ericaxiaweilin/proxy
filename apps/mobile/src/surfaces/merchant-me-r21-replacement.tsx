// R18.x: Replacement for the R21 merchant-me hardcoded mock surface.
// The previous MerchantMeR21 (1250 lines, @ts-nocheck) embedded three
// const arrays ('creators', 'vouchers', 'activities') and never called
// BusinessClient or SupplyClient. This surface wires the same flow:
//   root → creators list (SupplyClient.querySuppliers)
//   root → vouchers (business member directory + spend daily rollup)
//   root → activities (ActivityClient.listActivities — see biz-activity wire)
//   root → store (delegates to MerchantStorefrontSurface)
//   root → sales/ops/proxy (business spend daily + member directory)
//
// All numbers come from server; empty states show honest placeholders
// instead of the bogus '12.6tr VND' / '148 订单' fallbacks.

import { pickActiveMerchant, setActiveMerchantId, subscribeActiveMerchant } from "../active-merchant-store";
import { isSignInRequiredError } from "../secure-session";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
// MERCHANT-ACTIVITY-DETAIL-001：推广活动要真能复制链接 / 出真码，不是摆两个图标。
import * as Clipboard from "expo-clipboard";
// ACTIVITY-COVER-001：与横滑卡 / 门店相册同一套图片渲染。
import { Image } from "expo-image";
import { color, Gradient, shadows } from "../theme";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import type { BusinessClient, BusinessStoreWire } from "../business-client";
import { loadOwnMerchantActivities, primaryStoreScene } from "../merchant-home-activities";
import type { FulfillmentClient } from "../fulfillment-client";
import type { ProfileClient } from "../profile-client";
// STORE-CONSOLIDATE-001：店详情页改走统一 hub（和 me.tsx 的 bdash/线上店铺同一页）。
import { MyStoresHub } from "./my-stores-hub";
import type { SupplyClient, SupplierCandidate, AgentPassport, CollabInvitation, CollabInvitationPurpose, PromoStats } from "../supply-client";
import { MerchantStorefrontSurface } from "./merchant-storefront";
import { MerchantCreatorRecommendations, resolveCreatorPhoto } from "./merchant-creator-recommendations";
import { MerchantPromoSurface } from "./merchant-promo";
import { MerchantContentSurface } from "./merchant-content";
import { InviteSchedulePicker, matchDaySlot } from "../components/invite-schedule-picker";
import { combineDayAndTime, dayOptions, timeSlotOptions, type TimeSlot } from "../direct-invite-schedule";
// CREATOR-LIST-CARD-001：报价格式化与横滑卡共用同一个纯模块实现 —— 同一个人不许两个价。
import { formatReferencePrice } from "../creator-pricing";
import { creatorRatingLabel, formatFansCount, formatInviteDateTime, formatPriceRange, formatRatePercent, formatServiceVolume, labelInvitationPurpose, labelInvitationStatus, labelMarket, labelLanguage, labelServiceType, labelVertical } from "../creator-capability-labels";
// CREATOR-SOCIAL-001：社媒 canonical 链接与平台中文名（和服务端封闭集合对齐）。
import { socialPlatformLabel, socialProfileUrl } from "../supply-client";
import { localApiBaseUrl } from "../native-clients";
// ACTIVITY-COVER-001：活动封面 thumb URL 走共享 helper。
import { activityCoverUri } from "../media-thumb-url";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";
import { ProxyBackGlyph, ProxyEmptyState, ProxyIconButton, ProxyLoading } from "../components/proxy-foundation";
// MERCHANT-ACTIVITY-DETAIL-001：活动二维码走共享二维码组件（和门店码 / 专属码同一套）。
import { ProxyQrCode } from "../components/proxy-qr-code";
// 活动码载荷（PROXY-ACTIVITY:<编号>）由扫码解析模块统一生成，不在这里现拼。
import { activityQrPayload } from "../profile-qr";

type MerchantPage =
  | "root"
  | "creator"
  // MERCHANT-CREATOR-CONTENT-001（2026-10-04）：生产内容从经营目标卡进。
  // 以前这张卡是张死 View（点不进去），因为后面没有这一页；现在有了，
  // 页上的每一行都来自真实的定向邀约记录（ListCollabInvitations role=sent）。
  | "content"
  | "creatorDetail"
  | "voucher"
  | "voucherDetail"
  | "activity"
  | "activityDetail"
  | "store"
  | "sales"
  | "promo"
  | "ops"
  | "proxy"
  | "proxy-notices"
  | "proxy-policy"
  | "proxy-verify"
  | "proxy-support"
  | "scene";

type Account = { id: string; name: string; status: string; avatarPath?: string | undefined };
type MemberDirectory = { businessId: string; userId: string; displayName: string; role: string; status: string; joinedAt: string };
type SpendDaily = { businessId: string; bucketDate: string; orderCount: number; grossMinor: number; newCustomerCount: number; returningCustomerCount: number };
// ACTIVITY-COVER-001：加上 coverMediaAssetId —— 商家列表要能看到自己活动的封面。
// 之前这个 Pick 里根本没有封面字段，所以商家侧永远画不出图（不是没传，是没读）。
type ActivityItem = Pick<Activity, "activityId" | "title" | "time" | "people" | "priceLabel" | "venueName" | "joined" | "capacity" | "status" | "realitySceneId" | "coverMediaAssetId" | "coverImageUrl"
  // MERCHANT-ACTIVITY-DETAIL-001（2026-10-04）：活动详情页要显示的那几个读数 ——
  // 感兴趣 / 评论 / 分享 / 权益 / 付费方式 —— 全是活动契约里本来就有的字段
  // （ActivitySchema.interested / qaCount / shares / benefit / moneyFlow /
  // consumptionTerm）。以前这个 Pick 里根本没有它们，所以商家侧一个都印不出来，
  // 不是没传，是没读。
  | "interested" | "qaCount" | "shares" | "benefit" | "desc" | "consumption" | "moneyFlow" | "consumptionTerm" | "signupMode" | "venueTypeLabel" | "code">;

// R27 merchant scene ops (r27-preview): the flagship scene's live state,
// menu and humans come from the public scene projection; own activities
// and menu counts come from already-loaded business data.
type SceneBrief = {
  sceneId: string;
  name: string;
  window: string;
  liveState: string;
  liveLabel: string;
  heroImageUrl: string;
  menu: Array<{ id: string; name: string; priceLabel: string; available: boolean; imageUrl: string }>;
  humans: Array<{ id: string; name: string; role: string; availability: string }>;
};

const OTTER_LOGO = require("../../assets/otter-logo.png");

function IconBox({ icon, brand = false }: { icon: ProxyIconName; brand?: boolean }): React.JSX.Element {
  const glyph = <ProxyIcon color={brand ? color.white : color.ink} name={icon} size={25} />;
  return brand ? (
    <Gradient from={color.magenta} to={color.violet} style={styles.iconBox}>{glyph}</Gradient>
  ) : (
    <View style={[styles.iconBox, styles.iconBoxLime]}>{glyph}</View>
  );
}

function formatVnd(minor: number): string {
  const vnd = Math.round(minor / 1000);
  if (vnd >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)}tr VND`;
  if (vnd >= 1_000) return `${(vnd / 1_000).toFixed(0)}k VND`;
  return `${vnd} VND`;
}

// MERCHANT-ACTIVITY-DETAIL-001（2026-10-04）：原型那页的顶栏是「返回 + 标题 + 状态眉题
// + 右侧动作键」。以前 detailHead 只有返回 + 标题，活动详情只能把「报名中」这种
// 状态词塞进正文。现在 sub / right 都是可选的，其余页面调用方式不变。
function detailHead({ onBack, title, sub, right }: { onBack: () => void; title: string; sub?: string | undefined; right?: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.detailHead}>
      <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.subPageBack}>
        <ProxyBackGlyph />
      </Pressable>
      <View style={styles.detailHeadRow}>
        <View style={styles.detailHeadText}>
          <Text selectable style={styles.detailTitle}>{title}</Text>
          {sub ? <Text selectable style={styles.detailSub}>{sub}</Text> : null}
        </View>
        {right ? <View style={styles.detailHeadActions}>{right}</View> : null}
      </View>
    </View>
  );
}

function sectionHead(title: string, hint?: string): React.JSX.Element {
  return (
    <View style={styles.sectionHead}>
      <Text selectable style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text selectable style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function summary({ title, meta, stats }: { title: string; meta: string; stats: Array<[string, string]> }): React.JSX.Element {
  return (
    <View style={styles.summary}>
      <Text selectable style={styles.cardTitleWhite}>{title}</Text>
      <Text selectable style={styles.summaryMeta}>{meta}</Text>
      <View style={styles.summaryStats}>
        {stats.map(([value, label]) => (
          <View key={label} style={styles.summaryStatItem}>
            <Text selectable style={styles.summaryStatValue}>{value}</Text>
            <Text selectable style={styles.summaryStatLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SimpleRows({ rows, onPress }: { rows: Array<[string, string, MerchantPage?]>; onPress?: (page: MerchantPage) => void }): React.JSX.Element {  return <View style={styles.rowList}>{rows.map(([title, meta, destination]) => <Pressable key={title} disabled={!destination} onPress={() => destination && onPress?.(destination)} style={styles.row}><View style={styles.rowCopy}><Text selectable style={styles.objectTitle}>{title}</Text><Text selectable style={styles.meta}>{meta}</Text></View>{destination ? <Text selectable style={styles.chev}>›</Text> : null}</Pressable>)}</View>;
}

// MERCHANT-ACTIVITY-DETAIL-001（2026-10-04）：推广活动复制出去的文本。
// 原型上写的是「复制活动链接」和「生成活动二维码」，但这两件今天都做不出来，
// 而且做出来也是假的：App 只注册了 proxy:// 这一个 scheme（apps/mobile/app.json），
// 没有 universal-link 域名，扫码器也只认人 / 店 / 专属码三种载荷
// （profile-qr.ts 的 ScannedQr）。硬拼一条 https://proxy.app/activity/... 就是
// 编一条点不开的链接 —— 比不做更坏。所以这里复制的是**真实存在**的活动信息，
// 商家直接粘进 Zalo / Facebook。标题、时间、地点、编号全是服务端给的。
function activityShareText(activity: ActivityItem): string {
  return [
    activity.title,
    activity.code !== undefined && activity.code !== "" ? `活动编号 ${activity.code}` : "",
    activity.time,
    `${activity.venueName} · ${activity.priceLabel}`,
  ].filter((line) => line !== "").join("\n");
}

// MERCHANT-ACTIVITY-DETAIL-001：活动状态眉题。只 PUBLISHED / CANCELLED 两个值，
// 别把「报名中」当成真状态 —— 它其实是「已发布且没取消」，报名早就截止的状态
// 在这份数据里区分不出来，所以眉题就叫「已发布」，不冒充「报名中」。
function activityStatusLabel(status: string | undefined): string {
  return status === "CANCELLED" ? "已取消" : "已发布";
}

// 参与费用：moneyFlow 说的是钱往哪走，priceLabel 是具体那串金额。
// 免费就是免费，不拿 priceLabel 顶着（免费活动的 priceLabel 往往是「0 VND」）。
function activityFeeLabel(activity: ActivityItem): string {
  if (activity.moneyFlow === "FREE") return "免费";
  return activity.priceLabel !== "" ? activity.priceLabel : "—";
}

// 付费方式：SPLIT = 各自消费，HOST_COVERS = 主办方承担。契约没给就不显示。
function activitySettlementLabel(term: string | undefined): string {
  if (term === "SPLIT") return "各自消费";
  if (term === "HOST_COVERS") return "主办方承担";
  return "—";
}

// MERCHANT-ACTIVITY-DETAIL-001（2026-10-04）：画出来的键，今天按不了。
//
// 这不是偷懒的占位 —— 是把「有这颗键但服务端还没这条能力」如实说出来。原型
// deepseek_html_20261004_e74898 的活动详情有六个键（报名名单 / 提醒报名 / 编辑活动 /
// 推广活动 / 上传封面 / 取消活动），活动域只实现了推广活动这一条真链路：
//   · 报名名单 —— 没有「列这场活动的报名人」的命令
//   · 提醒报名 —— 没有推送通道
//   · 编辑活动 —— 没有改活动的命令（PublishActivity 只能新建）
//   · 上传封面 —— 商家端没接媒体上传
//   · 取消活动 —— CancelActivity 是**报名者**取消自己的报名
//     （participation.go TransitionParticipation 到 PartCancelled），
//     商家取消整场活动是另一条状态机，服务端没有
// 形状照原型摆（两列网格），但按不了，并且明说按不了 —— 点不进去却长得
// 能点的按钮，比不画更坏（PLACEHOLDER-001）。
function UnavailableActionTile({ icon, title }: { icon: ProxyIconName; title: string }): React.JSX.Element {
  return (
    <View accessibilityLabel={`${title}（暂不可用）`} accessibilityState={{ disabled: true }} style={styles.actActionTile}>
      <ProxyIcon color={color.muted} name={icon} size={19} />
      <Text selectable style={[styles.actActionText, styles.actActionTextOff]}>{title}</Text>
      <Text selectable style={styles.actActionOff}>暂不可用</Text>
    </View>
  );
}

export function MerchantMeR21Replacement({
  business,
  supply,
  activities,
  viewerAccountId,
  onOpenVouchers,
  onOpenSwitcher,
  onSignOut,
  fulfillment,
  profile,
  onOpenStoreCreate,
  onOpenCreatorProfile,
  onSubPageOpenChange,
}: {
  business?: BusinessClient | undefined;
  supply?: SupplyClient | undefined;
  activities?: ActivityClient | undefined;
  viewerAccountId?: string | undefined;
  onOpenVouchers: () => void;
  onOpenSwitcher: () => void;
  onSignOut: () => void;
  // NAV-L2-001（2026-10-03，用户「底栏只有1级页面有，为什么编辑页面也有底栏」）：
  // BUSINESS 上下文直接 return，不走 me.tsx 的 subPage —— 里面再钻多深都没人上报，
  // 底栏一直以为还在一级。root 之外全是二级，打开就要上报。
  onSubPageOpenChange?: ((open: boolean) => void) | undefined;
  // CREATOR-HOME-001：列表点头像进帖文主页（OtherProfileSurface）。
  onOpenCreatorProfile?: ((userId: string, name: string, avatarUri?: string | undefined) => void) | undefined;
  // STORE-CONSOLIDATE-001：店详情页改走统一 hub，需要 hub 的三个客户端。
  // me.tsx 里 bdash 那一路就是这么传的，这里照抄。
  fulfillment?: FulfillmentClient | undefined;
  profile?: ProfileClient | undefined;
  onOpenStoreCreate?: (() => void) | undefined;
}): React.JSX.Element {
  const [page, setPage] = useState<MerchantPage>("root");
  // NAV-L2-001：见 props 注释。卸载时还原，避免标记漏在 true。
  useEffect(() => {
    onSubPageOpenChange?.(page !== "root");
    return () => onSubPageOpenChange?.(false);
  }, [page, onSubPageOpenChange]);
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activeAccountId, setActiveAccountId] = useState<string | undefined>(undefined);
  const [members, setMembers] = useState<MemberDirectory[]>([]);
  const [spendDays, setSpendDays] = useState<SpendDaily[]>([]);
  const [spendTotal, setSpendTotal] = useState<{ totalOrders: number; totalGrossMinor: number }>({ totalOrders: 0, totalGrossMinor: 0 });
  const [creators, setCreators] = useState<SupplierCandidate[]>([]);
  const [selectedCreator, setSelectedCreator] = useState<SupplierCandidate | undefined>(undefined);
  // MERCHANT-CREATOR-PROMO-001：专属码归因合计 —— state 放这里，effect 放
  // activeAccount 后面（TDZ：effect 闭包里读后面声明的 const 会炸）。
  const [promoStats, setPromoStats] = useState<PromoStats | undefined>(undefined);
  // CREATOR-PROFILE-001：详情页的护照（头像/简介/能力/档期）。进详情才拉，
  // 列表页不预拉 —— 20 个人的 passport 全拉一遍又慢又浪费。
  const [creatorPassport, setCreatorPassport] = useState<AgentPassport | undefined>(undefined);
  const [creatorPassportFailed, setCreatorPassportFailed] = useState(false);
  useEffect(() => {
    if (!selectedCreator || !supply) { setCreatorPassport(undefined); setCreatorPassportFailed(false); return; }
    let active = true;
    setCreatorPassport(undefined);
    setCreatorPassportFailed(false);
    supply.getAgentPassport(selectedCreator.agentId)
      .then((pp) => { if (active) setCreatorPassport(pp); })
      .catch(() => { if (active) setCreatorPassportFailed(true); });
    return () => { active = false; };
  }, [selectedCreator, supply]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | undefined>(undefined);
  // MERCHANT-ACTIVITY-DETAIL-001：推广活动的分享面板。两格：share（四个去向）/
  // qr（二维码）。分享链接与码都是本页现算的真值，不是占位串。
  const [activitySheet, setActivitySheet] = useState<"share" | "qr" | undefined>(undefined);
  const [activityLinkCopied, setActivityLinkCopied] = useState(false);
  const [sceneDetail, setSceneDetail] = useState<SceneBrief | undefined>(undefined);
  // 当前商家账号的门店：活动导流 / 场景运营都按它认「本店」。
  const [myStores, setMyStores] = useState<BusinessStoreWire[]>([]);
  const [creatorView, setCreatorView] = useState<"MATCH" | "CREATORS" | "COLLABS" | "RESULTS">("MATCH");
  const [creatorQuery, setCreatorQuery] = useState("");
  const [myInvitation, setMyInvitation] = useState<CollabInvitation | undefined>(undefined);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteMin, setInviteMin] = useState("");
  const [inviteMax, setInviteMax] = useState("");
  const [inviteNegotiable, setInviteNegotiable] = useState(true);
  const [invitePurpose, setInvitePurpose] = useState<"" | CollabInvitationPurpose>("");
  // MERCHANT-CREATOR-INVITE-001：合作时间走共用的 InviteSchedulePicker
  //（day chips + 固定时段 chips + 时长 chips），不手填日期。
  // 默认明天 13:00 开始 8 小时；打开表单时她有未来 7 天内的可约档期就切过去。
  const inviteDays = useMemo(() => dayOptions(new Date()), []);
  const inviteSlots = useMemo(() => timeSlotOptions(), []);
  const [inviteDay, setInviteDay] = useState(1);
  const [inviteSlot, setInviteSlot] = useState<TimeSlot>(inviteSlots[2]!);
  const [inviteDurationH, setInviteDurationH] = useState(8);
  const [inviteMessage, setInviteMessage] = useState("");
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterMin, setCounterMin] = useState("");
  const [counterMax, setCounterMax] = useState("");
  const [counterDay, setCounterDay] = useState(1);
  const [counterSlot, setCounterSlot] = useState<TimeSlot>(inviteSlots[2]!);
  const [counterDurationH, setCounterDurationH] = useState(8);
  const [counterMessage, setCounterMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | undefined>(undefined);

  // MERCHANT-ACCOUNT-SWITCH-001（2026-10-03 补完）：切换器画出来了、成员与经营数据也
  // 按选中的 accountId 重拉了，但界面上 11 处标签仍然读 `accounts[0]` —— 点第二家时
  // 芯片会选中，名字 / 状态 / 头像却还是第一家。数据跟着主体走、标签不跟着走，等于
  // 装了开关没接线路。首帧 activeAccountId 还是 undefined，所以兜底取 list[0]。
  const activeAccount = accounts?.find((account) => account.id === activeAccountId) ?? accounts?.[0];
  // MERCHANT-ACTIVE-ACCOUNT-001：首页切了账号，这里跟着切（同一个人看到的永远是同一家店）。
  useEffect(() => subscribeActiveMerchant((id) => {
    if (!id || id === activeAccountId || !accounts?.some((account) => account.id === id)) return;
    setActiveAccountId(id);
    setMembers([]);
    setSpendDays([]);
    setSpendTotal({ totalOrders: 0, totalGrossMinor: 0 });
    void refresh(id);
  }), [accounts, activeAccountId]);

  // MERCHANT-CREATOR-PROMO-001：RESULTS 页的归因收入/新客从报码行里数出来；
  // 券核销/完成合作还是 "—"，有数再接。读失败不挡整页。
  useEffect(() => {
    if (page !== "creator" || !supply || !activeAccount) return;
    let active = true;
    supply.merchantPromoStats({ merchantId: activeAccount.id }).then((computed) => {
      if (active) setPromoStats(computed);
    }).catch(() => { /* 归因没读出来 RESULTS 照显示 "—"，不挡整页 */ });
    return () => { active = false; };
  }, [page, creatorView, supply, activeAccount]);


  // MERCHANT-CREATOR-INVITE-001：发出 / 还价 / 接受 / 拒绝 / 撤回定向邀约。
  // merchantId 永远取当前 activeAccount（网关验成员身份后盖章）。
  // 出价是区间：两端都空 = 出价待商议；只填一端 = 以那端为一口价；
  // 低>高直接拦（服务端也会拒，双保险）。
  // 时间从 InviteSchedulePicker 来（day + 时段 + 时长 chips），直接拼 RFC3339，
  // 不手填不猜 —— combineDayAndTime 和场景邀约同一套。
  const inviteStartAt = (): string => combineDayAndTime(
    inviteDays[inviteDay]?.iso ?? inviteDays[1]!.iso,
    inviteSlot,
  );
  const counterStartAt = (): string => combineDayAndTime(
    inviteDays[counterDay]?.iso ?? inviteDays[1]!.iso,
    counterSlot,
  );
  const normalizeRange = (minText: string, maxText: string): { ok: true; min: number; max: number } | { ok: false; error: string } => {
    const digits = (text: string): number => {
      if (text.trim() === "") return -1;
      const n = Number(text.replace(/[^\d]/g, ""));
      return Number.isInteger(n) && n >= 0 ? n : -2;
    };
    let min = digits(minText);
    let max = digits(maxText);
    if (min === -1 && max === -1) return { ok: true, min: 0, max: 0 };
    if (min === -2 || max === -2) return { ok: false, error: "出价填 VND 数字" };
    if (min === -1) min = max;
    if (max === -1) max = min;
    if (min > max) return { ok: false, error: "下限不能高于上限" };
    if (max > 10_000_000) return { ok: false, error: "出价超过上限（10,000,000 VND）" };
    return { ok: true, min, max };
  };

  const checkMessage = (): string | undefined => {
    if ([...inviteMessage].length > 200 || [...counterMessage].length > 200) return "留言 200 字以内";
    return undefined;
  };

  const sendInvite = async (): Promise<void> => {
    if (!supply || !selectedCreator || !activeAccount || inviteSending) return;
    if (invitePurpose === "") {
      setInviteError("选一下合作目的（她要知道你为什么找她）");
      return;
    }
    const range = normalizeRange(inviteMin, inviteMax);
    if (!range.ok) {
      setInviteError(range.error);
      return;
    }
    const msgError = checkMessage();
    if (msgError) {
      setInviteError(msgError);
      return;
    }
    setInviteSending(true);
    setInviteError(undefined);
    try {
      const inv = await supply.inviteCreator({
        merchantId: activeAccount.id,
        agentId: selectedCreator.agentId,
        priceMinVnd: range.min,
        priceMaxVnd: range.max,
        negotiable: inviteNegotiable,
        purpose: invitePurpose,
        ...(inviteMessage.trim() !== "" ? { message: inviteMessage.trim() } : {}),
        startAt: inviteStartAt(),
        durationH: inviteDurationH,
      });
      setMyInvitation(inv);
      setInviteFormOpen(false);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "邀请没发出去，稍后重试");
    } finally {
      setInviteSending(false);
    }
  };

  // 商家回合（COUNTERED）：接受她的还价 / 拒绝 / 再议一个区间回去（价和时间都能改）。
  const settleCounter = async (decision: "ACCEPTED" | "DECLINED" | "COUNTERED"): Promise<void> => {
    if (!supply || !activeAccount || !myInvitation || inviteSending) return;
    if (decision === "COUNTERED") {
      const range = normalizeRange(counterMin, counterMax);
      if (!range.ok) {
        setInviteError(range.error);
        return;
      }
      const msgError = checkMessage();
      if (msgError) {
        setInviteError(msgError);
        return;
      }
    }
    setInviteSending(true);
    setInviteError(undefined);
    try {
      const inv = await supply.respondInvitation({
        invitationId: myInvitation.id,
        decision,
        merchantId: activeAccount.id,
        ...(decision === "COUNTERED" ? (() => {
          const range = normalizeRange(counterMin, counterMax);
          if (!range.ok) return {};
          return {
            priceMinVnd: range.min,
            priceMaxVnd: range.max,
            negotiable: myInvitation.negotiable,
            purpose: myInvitation.purpose,
            ...(counterMessage.trim() !== "" ? { message: counterMessage.trim() } : {}),
            startAt: counterStartAt(),
            durationH: counterDurationH,
          };
        })() : {}),
      });
      setMyInvitation(inv);
      setCounterOpen(false);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "操作没成功，稍后重试");
    } finally {
      setInviteSending(false);
    }
  };

  // 打开邀约表单时把时间默认到 reality：如果她未来 7 天内有可约档期，
  // 默认切到那一天（upcoming 是 passport 的真实档期）；否则默认明天。
  // 还价预填同理：从当前 terms 的 startAt 反查 day/slot，时间改了才动。
  const cancelInvite = async (): Promise<void> => {
    if (!supply || !activeAccount || !myInvitation || inviteSending) return;
    setInviteSending(true);
    try {
      await supply.cancelInvitation({ merchantId: activeAccount.id, invitationId: myInvitation.id });
      setMyInvitation({ ...myInvitation, status: "CANCELLED" });
    } catch {
      // 撤回失败不编状态：留在 PENDING，下次进来重新读服务端。
    } finally {
      setInviteSending(false);
    }
  };

  // MERCHANT-CREATOR-INVITE-001：定向邀约（商家→这位 creator）。
  // myInvitation 是我发给这个人的最新一单（查 sent 按 agentId 找，不是全量展示）；
  // 表单出价区间默认她的参考价（一口价起手，可谈），目的每次重选，留言可选。
  useEffect(() => {
    setInviteFormOpen(false);
    setInviteError(undefined);
    setInviteSending(false);
    setCounterOpen(false);
    if (!selectedCreator || !supply || !activeAccount) {
      setMyInvitation(undefined);
      setInviteMin("");
      setInviteMax("");
      setInviteMessage("");
      return;
    }
    const agentId = selectedCreator.agentId;
    const merchantId = activeAccount.id;
    const ref = selectedCreator.referencePrice > 0 ? String(selectedCreator.referencePrice) : "";
    setInviteMin(ref);
    setInviteMax(ref);
    setInviteNegotiable(true);
    setInvitePurpose("");
    setInviteDay(1);
    setInviteSlot(inviteSlots[2]!);
    setInviteDurationH(8);
    setInviteMessage("");
    setCounterMin("");
    setCounterMax("");
    setCounterMessage("");
    let active = true;
    supply.listSentInvitations({ merchantId }).then((invs) => {
      if (!active) return;
      const mine = invs
        .filter((inv) => inv.agentId === agentId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      setMyInvitation(mine);
    }).catch(() => { /* 邀约查失败不挡主页：按钮照常可点，状态行空着 */ });
    return () => { active = false; };
  }, [selectedCreator, supply, activeAccount]);

  const refresh = useCallback(async (accountId: string) => {
    if (!business) return;
    try {
      setMyStores(await business.listStores(accountId).catch(() => [] as BusinessStoreWire[]));
      const memberResult = await business.listMemberDirectory(accountId).catch(() => []);
      setMembers(memberResult);
      const spendResult = await business.listSpendDaily({ businessId: accountId, sinceDays: 30 }).catch(() => ({ days: [] as SpendDaily[], totalOrders: 0, totalGrossMinor: 0, sinceDays: 30 }));
      setSpendDays(spendResult.days);
      setSpendTotal({ totalOrders: spendResult.totalOrders, totalGrossMinor: spendResult.totalGrossMinor });
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
    }
  }, [business]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!business) return;
      try {
        const list = await business.listMyAccounts();
        if (cancelled) return;
        setAccounts(list);
        // MERCHANT-ACTIVE-ACCOUNT-001：默认是商家端共用的当前账号（上次选的那家），不是列表第一个。
        const picked = pickActiveMerchant(list.map((account) => account.id));
        if (picked) {
          setActiveAccountId(picked);
          await refresh(picked);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [business, refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supply) return;
      try {
        const list = await supply.querySuppliers({ limit: 25 });
        if (!cancelled) {
          setCreators(list);
          if (list[0]) setSelectedCreator(list[0]);
        }
      } catch (e) {
        if (!cancelled) setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => { cancelled = true; };
  }, [supply]);

  // MERCHANT-HOME-OWN-ACTIVITIES-001：活动导流和首页走同一个取数入口（本账号门店的活动），
  // 不再读「我本人发过的活动」—— 那跟当前选的是哪家店无关，切账号也不变。
  useEffect(() => {
    let cancelled = false;
    if (!activities) return () => { cancelled = true; };
    loadOwnMerchantActivities(activities, myStores)
      .then((list) => {
        if (cancelled) return;
        const items: ActivityItem[] = list.slice(0, 25).map((entry) => ({
          activityId: entry.activityId, title: entry.title, time: entry.time, people: entry.people,
          priceLabel: entry.priceLabel, venueName: entry.venueName, joined: entry.joined, capacity: entry.capacity,
          status: entry.status, realitySceneId: entry.realitySceneId,
          coverMediaAssetId: entry.coverMediaAssetId, coverImageUrl: entry.coverImageUrl,
          // MERCHANT-ACTIVITY-DETAIL-001：详情页那几个读数的来源（见 ActivityItem 的 Pick 注释）。
          interested: entry.interested, qaCount: entry.qaCount, shares: entry.shares,
          benefit: entry.benefit, desc: entry.desc, consumption: entry.consumption,
          moneyFlow: entry.moneyFlow, consumptionTerm: entry.consumptionTerm,
          signupMode: entry.signupMode, venueTypeLabel: entry.venueTypeLabel, code: entry.code,
        }));
        setActivityItems(items);
        setSelectedActivity(items[0]);
      })
      .catch((e: unknown) => { if (!cancelled) setError((prev) => prev ?? (e instanceof Error ? e.message : String(e))); });
    return () => { cancelled = true; };
  }, [activities, myStores]);

  // R27 场景运营：读当前账号门店认领的场景（以前写死 threebeans，切到别的账号也显示 Three Beans）。
  const storeScene = primaryStoreScene(myStores);
  const storeSceneId = storeScene?.sceneId;
  useEffect(() => {
    let cancelled = false;
    setSceneDetail(undefined);
    if (!storeSceneId) return () => { cancelled = true; };
    void fetch(`${localApiBaseUrl.replace(/\/$/, "")}/v1/scenes/${encodeURIComponent(storeSceneId)}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((body) => {
        if (cancelled || !body || typeof body !== "object") return;
        const d = body as Record<string, unknown>;
        const live = d.liveState as { label?: unknown; state?: unknown; bestWindow?: unknown } | undefined;
        const menu = Array.isArray(d.menu) ? (d.menu as Array<Record<string, unknown>>) : [];
        const humans = Array.isArray(d.humans) ? (d.humans as Array<Record<string, unknown>>) : [];
        setSceneDetail({
          sceneId: String(d.sceneId ?? storeSceneId),
          name: String(d.venueName ?? storeScene?.storeName ?? ""),
          window: typeof live?.bestWindow === "string" ? live.bestWindow : "",
          liveState: typeof live?.state === "string" ? live.state : "",
          liveLabel: typeof live?.label === "string" ? live.label : "",
          heroImageUrl: typeof d.heroImageUrl === "string" ? d.heroImageUrl : "",
          menu: menu.map((m) => ({
            id: String(m.id ?? ""),
            name: String(m.name ?? ""),
            priceLabel: String(m.priceLabel ?? ""),
            available: m.available === true,
            imageUrl: typeof m.imageUrl === "string" ? m.imageUrl : "",
          })),
          humans: humans.map((h) => ({
            id: String(h.id ?? ""),
            name: String(h.name ?? ""),
            role: String(h.role ?? ""),
            availability: String(h.availability ?? ""),
          })),
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [storeSceneId, storeScene?.storeName]);

  if (page === "creator") {
    const visibleCreators = creators.filter((creator) => `${creator.name} ${creator.serviceType} ${creator.languages.join(" ")}`.toLowerCase().includes(creatorQuery.trim().toLowerCase()));
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "Creator 经营" })}
          <Text selectable style={styles.pageSub}>围绕真实经营目标匹配、邀请，并追踪到店与消费结果。</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{([['MATCH','智能匹配'],['CREATORS','Creator'],['COLLABS','合作'],['RESULTS','结果']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setCreatorView(id)} style={[styles.tab, creatorView === id && styles.tabOn]}><Text selectable style={[styles.tabText, creatorView === id && styles.tabTextOn]}>{label}</Text></Pressable>)}</ScrollView>
          {creatorView === "MATCH" ? <><View style={styles.goalGrid}>{([['storefront','带来到店新客','到店、带客、核销'],['target','生产内容','探店、短视频、UGC'],['arrowUpRight','扩大本地曝光','覆盖与互动'],['ticket','推广券与活动','领取、预约、核销']] as const).map(([icon,title,hint]) => {
            // 经营目标卡去向：曝光→销售归因看结果，推广券→券中心发券，
            // 带新客=专属营销码链路，生产内容=真实邀约页（MERCHANT-CREATOR-CONTENT-001，
            // 2026-10-04 接上 —— 这一页以前不存在，卡是张点不进去的死 View）。
            // 四张都有去向了；下面 View 分支留着当以后新增「还没做」卡时的默认形状，
            // 点不进去的按钮不许摆出来骗点击。
            const go = title === '带来到店新客' ? (): void => setPage("promo") : title === '生产内容' ? (): void => setPage("content") : title === '扩大本地曝光' ? (): void => setPage("sales") : title === '推广券与活动' ? (): void => onOpenVouchers() : undefined;
            const body = <><View style={styles.goalIcon}><ProxyIcon color={color.ink} name={icon} size={23} /></View><Text selectable style={styles.cardTitle}>{title}</Text><Text selectable style={styles.caption}>{hint}</Text></>;
            return go ? <Pressable key={title} onPress={go} style={styles.goalCard} accessibilityLabel={title}>{body}</Pressable> : <View key={title} style={styles.goalCard}>{body}</View>;
          })}</View>{sectionHead("最佳匹配", `${creators.length} 位符合条件`)}</> : null}
          {creatorView === "CREATORS" ? <><View style={styles.search}><ProxyIcon color={color.muted} name="search" size={18} /><TextInput onChangeText={setCreatorQuery} placeholder="搜索 Creator、能力或语言" placeholderTextColor={color.muted} style={styles.searchInput} value={creatorQuery} /></View>{sectionHead("Creator 人才库", `${visibleCreators.length} 位`)}</> : null}
          {creatorView === "COLLABS" ? <>{sectionHead("合作状态", "来自真实邀请与合作记录")}<SimpleRows rows={[["待回复", "等待合作邀请数据"], ["进行中", "等待履约数据"], ["已完成", "等待完成记录"]]} /></> : null}
          {creatorView === "RESULTS" ? <>{summary({ title: "Creator 贡献", meta: "近 30 天 · 真实归因", stats: [[promoStats ? `${promoStats.attributedVnd.toLocaleString()} VND` : "—","归因收入"],["—","券核销"],[promoStats ? promoStats.firstVisits.toString() : "—","新客（店员确认）"],["—","完成合作"]] })}</> : null}
          {(creatorView === "MATCH" || creatorView === "CREATORS") && visibleCreators.length === 0 ? (
            <View style={styles.emptyCard}><Text selectable style={styles.emptyTitle}>暂时没有匹配的 Creator</Text><Text selectable style={styles.empty}>工作台仍可使用；待供给数据进入后，候选会显示在这里。</Text></View>
          ) : null}
          {/* CREATOR-PROFILE-001: tapping avatar goes to homepage (whole row presses). */}
          {/* CREATOR-HOME-001: avatar goes to posts homepage, not ops detail. */}
          {(creatorView === "MATCH" || creatorView === "CREATORS") ? visibleCreators.map((creator) => {
            const avatarUri = resolveCreatorPhoto(creator.photos[0]);
            return (
            <Pressable
              key={creator.agentId}
              accessibilityLabel={`查看${creator.name}的个人主页`}
              testID={`creator-home-entry-${creator.agentId}`}
              onPress={() => {
                // CREATOR-HOME-001:整行点进经营详情；头像有自己独立的 Pressable
                // （下面）进帖文主页。两个入口，两种去向，不混。
                setSelectedCreator(creator); setPage("creatorDetail");
              }}
              style={styles.creatorRow}
            >
              {/* CREATOR-AVATAR-001（2026-10-01，用户「creator list 不能只是文本list
                  要有头像啊」）：这一列以前只有姓名 / 类型 / 语言 / 报价四行纯文字，
                  photos 只被当成一个数字印在「到店 N 媒体」里 —— 同一份
                  SupplierCandidate 数据在 merchant-creator-recommendations 的横滑卡
                  上是画头像的。商家挑人靠的是脸，这里少了它就变成一份通讯录。
                  没有照片的人显示「待完善照片」，不拿首字母或图标假装有头像。 */}
              {/* CREATOR-HOME-001:头像独立可点，进帖文主页（个人主页）。
                  userId 有就精确，没有靠名字回填 —— 两种都有帖子看。
                  外层整行进的是经营详情，别混。 */}
              <Pressable
                accessibilityLabel={`${creator.name}的个人主页头像`}
                testID={`creator-avatar-entry-${creator.agentId}`}
                onPress={() => {
                  if (!onOpenCreatorProfile) return;
                  onOpenCreatorProfile(
                    creator.userAccountId || creator.agentId,
                    creator.name,
                    avatarUri,
                  );
                }}
                style={styles.creatorAvatarHit}
              >
              {avatarUri ? (
                <Image
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  recyclingKey={`merchant-me-creator:${creator.agentId}`}
                  source={{ uri: avatarUri }}
                  style={styles.creatorAvatar}
                  transition={0}
                />
              ) : (
                <View style={styles.creatorAvatarMissing} testID={`creator-avatar-missing-${creator.agentId}`}>
                  <ProxyIcon color={color.muted} name="user" size={18} />
                  <Text selectable style={styles.creatorAvatarMissingText}>待完善照片</Text>
                </View>
              )}
              {/* MERCHANT-CREATOR-TAGS-001：「可邀请」标签已下掉 —— 这批列表
                  本来就只含服务端 Eligible 的，再贴标是同义反复；而且“可邀请”
                  没有公开的判定标准，贴上去商家也不知道是什么意思。
                  头像右下那颗点跟着一起下掉（它就是那个标签的配饰）。
                  状态位（creator.eligibility）照常解析，只是不再展示。 */}
              </Pressable>
              <View style={styles.flex}>
              {/* MERCHANT-CREATOR-TAGS-001：名字和社媒 handle 挨在一起
                 （Thao @thao_hanoi）—— handle 是已关联账号的真实用户名，
                  不是标签行里那个占位的深底胶囊。没有关联账号就只印名字。 */}
              <Text selectable numberOfLines={1} style={styles.creatorCardName}>{creator.name}{(creator.socials ?? [])[0]?.handle ? <Text style={styles.creatorHandle}> @{((creator.socials ?? [])[0]?.handle ?? "")}</Text> : null}</Text>
              {/* MERCHANT-CREATOR-TAGS-001：标签行只放三样 —— 内容大类
                  （餐饮/旅游/运动，KTV/SPA 等只关联不明示）+ 语言（超两个折 +N）
                  + 地址（availability.marketId）。服务类型和社媒账号不占标签位：
                  前者和查询条件重复，后者已经贴在名字后面了。 */}
              <View style={styles.creatorTagRow}>
                {(creator.verticalTags ?? []).map(labelVertical).filter((label) => label !== "").slice(0, 1).map((label) => <View key={label} style={[styles.creatorTag, styles.creatorTagPrimary]}><Text selectable style={styles.creatorTagPrimaryText}>{label}</Text></View>)}
                {creator.languages.slice(0, 2).map((language) => <View key={language} style={styles.creatorTag}><Text selectable style={styles.creatorTagText}>{labelLanguage(language)}</Text></View>)}
                {creator.languages.length > 2 ? <View style={styles.creatorTag}><Text selectable style={styles.creatorTagText}>{`+${creator.languages.length - 2}`}</Text></View> : null}
                {labelMarket(creator.availability?.marketId) !== "" ? <View style={styles.creatorTag}><Text selectable style={styles.creatorTagText}>{labelMarket(creator.availability?.marketId)}</Text></View> : null}
              </View>
              {/* MERCHANT-CREATOR-TAGS-001：stats 行三样 —— 粉丝（创作者自填）/
                  服务量（真实成交单数）/ 评价指数（服务端 Total，有记录才印分，
                  新人印「新人 · 暂无评价」）。报价在右列。到店媒体数不在卡上：
                  头像本身就是到店照片，数不重复印。 */}
              <View style={styles.creatorStatRow}>
                {<Text selectable numberOfLines={1} style={styles.creatorStat}>{`粉丝 ${formatFansCount(creator.socials?.[0]?.followerCount)}`}</Text>}
                <Text selectable numberOfLines={1} style={styles.creatorStat}>{formatServiceVolume(creator.rating?.completedOrders)}</Text>
                {creatorRatingLabel(creator.rating) !== "" ? (
                  <View style={[styles.creatorEligibility]}>
                    <Text selectable style={[styles.creatorEligibilityText]}>{creatorRatingLabel(creator.rating)}</Text>
                  </View>
                ) : null}
              </View>
              </View>
              {/* 右列：报价 + 主操作。报价走共享的 formatReferencePrice —— 和横滑卡
                  同一个人必须印同一个字符串。「查看主页」指下面那页
                  （眉题就是「Creator 主页 · 经营」），点整行也是去那里。 */}
              <View style={styles.creatorAction}>
                <Text selectable numberOfLines={1} style={styles.creatorPrice}>{formatReferencePrice(creator.referencePrice, creator.currency)}</Text>
                <View style={styles.creatorGo}><Text selectable style={styles.creatorGoText}>查看主页</Text></View>
              </View>
            </Pressable>
            );
          }) : null}
        </ScrollView>
      </View>
    );
  }

  // CREATOR-PROFILE-001（2026-10-02，用户「最佳匹配的creator 不能看个人主页
  // 也看不到关联的社媒账户」）：详情页原来只有计数 + 占位行 —— 没有头像、没有简介、
  // 没有能力、没有档期，更没有社媒。现在是系统性的个人页：头像/简介/照片墙（passport，
  // 进详情才拉）、能力（已验证打标）、档期、报价；社媒如实空态（数据模型里没有
  // 这个字段，不编 handles）。
  if (page === "creatorDetail" && selectedCreator) {
    const heroPhoto = creatorPassport?.profile.photos[0] ?? selectedCreator.photos[0];
    const heroUri = resolveCreatorPhoto(heroPhoto);
    const upcoming = (creatorPassport?.availability ?? []).filter((w) => w.endAt >= new Date().toISOString().slice(0, 10)).slice(0, 3);
    // 社媒粉丝数对照表：passport 的社媒区只带账号，粉丝数从列表同源的
    // selectedCreator.socials 里按 platform+handle 对出来 —— 同一份数据，
    // 详情和列表不会印出两个数。
    const fanCountFor = (platform: string, handle: string): number | undefined =>
      (selectedCreator.socials ?? []).find((s) => s.platform === platform && s.handle === handle)?.followerCount;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("creator"), title: selectedCreator.name })}
          {/* CREATOR-PROFILE-001：这是商家侧的 Creator 个人主页（头像/简介/能力/
              档期/社媒都在这一页）。列表点进来即到，不再需要第二个"查看主页"入口。 */}
          {/* CREATOR-PROFILE-001：站内个人主页入口（Proxy 站内这页本身），
              和下面站外平台入口并列 —— 商家要分清"站内看"和"出站看"。 */}
          {/* CREATOR-HOME-001: ops page, not posts homepage. */}
          <Text selectable style={styles.homeEyebrow}>Creator 主页 · 经营</Text>
          {/* 个人头：头像 + 名字 + 简介。简介空就不画那一行，不拿服务类型凑字数。 */}
          <View style={styles.creatorHero}>
            <View style={styles.creatorHeroTop}>
              {/* CREATOR-HOME-001：详情大头像也可点进帖文主页（和列表头像同一条）。
                  之前这里是纯展示，点着没反应 —— 用户在详情页想看帖子只能退回列表重进。 */}
              <Pressable
                accessibilityLabel={`${selectedCreator.name}的帖文主页头像`}
                testID={`creator-hero-entry-${selectedCreator.agentId}`}
                onPress={() => {
                  if (!onOpenCreatorProfile) return;
                  onOpenCreatorProfile(
                    selectedCreator.userAccountId || selectedCreator.agentId,
                    selectedCreator.name,
                    heroUri,
                  );
                }}
              >
              {heroUri ? (
                <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`creator-hero:${selectedCreator.agentId}`} source={{ uri: heroUri }} style={styles.creatorHeroAvatar} transition={0} />
              ) : (
                <View style={styles.creatorHeroAvatarMissing}><Text selectable style={styles.creatorHeroInitial}>{selectedCreator.name.slice(0, 1)}</Text></View>
              )}
              </Pressable>
              <View style={styles.flex}>
                {/* MERCHANT-CREATOR-TAGS-001：详情头和列表卡同一套语言 ——
                    名字+@handle 挨在一起，标签行只放 大类/语言/地址
                   （详情不折 +N，语言全列出来），stats 行 粉丝/服务量/评价。
                    简介有就印，没有就不画那一行。 */}
                <Text selectable numberOfLines={1} style={styles.creatorCardName}>{selectedCreator.name}{(selectedCreator.socials ?? [])[0]?.handle ? <Text style={styles.creatorHandle}> @{((selectedCreator.socials ?? [])[0]?.handle ?? "")}</Text> : null}</Text>
                {(creatorPassport?.profile.bio.trim() || "") !== "" ? (
                  <Text selectable style={styles.meta}>{creatorPassport?.profile.bio}</Text>
                ) : null}
                <View style={styles.creatorTagRow}>
                  {(selectedCreator.verticalTags ?? []).map(labelVertical).filter((label) => label !== "").map((label) => <View key={label} style={[styles.creatorTag, styles.creatorTagPrimary]}><Text selectable style={styles.creatorTagPrimaryText}>{label}</Text></View>)}
                  {(selectedCreator.languages.length ? selectedCreator.languages : creatorPassport?.profile.languages ?? []).map((language) => <View key={language} style={styles.creatorTag}><Text selectable style={styles.creatorTagText}>{labelLanguage(language)}</Text></View>)}
                  {labelMarket(selectedCreator.availability?.marketId) !== "" ? <View style={styles.creatorTag}><Text selectable style={styles.creatorTagText}>{labelMarket(selectedCreator.availability?.marketId)}</Text></View> : null}
                </View>
                <View style={styles.creatorStatRow}>
                  {<Text selectable numberOfLines={1} style={styles.creatorStat}>{`粉丝 ${formatFansCount(selectedCreator.socials?.[0]?.followerCount)}`}</Text>}
                  <Text selectable numberOfLines={1} style={styles.creatorStat}>{formatServiceVolume(selectedCreator.rating?.completedOrders)}</Text>
                  {creatorRatingLabel(selectedCreator.rating) !== "" ? (
                    <View style={[styles.creatorEligibility]}>
                      <Text selectable style={[styles.creatorEligibilityText]}>{creatorRatingLabel(selectedCreator.rating)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            {/* MERCHANT-CREATOR-TAGS-001：参考报价条只管报价 —— 评价胶囊已经
                在上面的 stats 行里了，这里不再重复第二遍。 */}
            <View style={styles.creatorPriceBar}>
              <View style={styles.flex}>
                <Text selectable style={styles.creatorPriceLabel}>参考报价</Text>
                <Text selectable style={styles.creatorPriceValue}>{formatReferencePrice(selectedCreator.referencePrice, selectedCreator.currency)}</Text>
              </View>
            </View>
          </View>
          {creatorPassportFailed ? (
            <Text selectable style={styles.meta}>个人资料没读出来，稍后再试 —— 下面是列表里的基本信息。</Text>
          ) : null}
          {/* 能力：已验证的打标，没验证的不冒充。 */}
          {creatorPassport && creatorPassport.capabilities.length > 0 ? (<>
            <View style={styles.secHead}><Text selectable style={styles.secTitle}>能力</Text></View>
            <View style={styles.chipRow}>
              {creatorPassport.capabilities.map((c) => (
                <View key={c.capability} style={[styles.capChip, c.verified && styles.capChipVerified]}>
                  <Text selectable style={[styles.capText, c.verified && styles.capTextVerified]}>{c.capability}{c.verified ? " ✓" : ""}</Text>
                </View>
              ))}
            </View>
          </>) : null}
          {/* MERCHANT-CREATOR-TAGS-001：客户评价区 —— 明细只印真实发生的：
              好评率（有客户打分才印，没人评过不印 0%）、履约率、累计服务单数，
              全是服务端 rating 里的数。有记录才给分项；新人如实说没记录，
              不拿先验分当成绩展示。 */}
          <View style={styles.secHead}><Text selectable style={styles.secTitle}>客户评价</Text></View>
          {selectedCreator.rating?.hasTrackRecord ? (
            <Text selectable style={styles.meta}>
              {formatRatePercent(selectedCreator.rating.satisfactionRate) !== "" ? `好评率 ${formatRatePercent(selectedCreator.rating.satisfactionRate)} · ` : "暂无客户打分 · "}
              {formatRatePercent(selectedCreator.rating.fulfillmentRate) !== "" ? `履约率 ${formatRatePercent(selectedCreator.rating.fulfillmentRate)} · ` : ""}
              {`累计服务 ${selectedCreator.rating.completedOrders} 单`}
            </Text>
          ) : (
            <Text selectable style={styles.meta}>新人 · 暂无成交记录，平台还没有她的客户评价。</Text>
          )}
          {/* 档期：只显示还没过的，最多 3 条。没有就是没有，不编"随时可约"。 */}
          {creatorPassport && upcoming.length > 0 ? (<>
            <View style={styles.secHead}><Text selectable style={styles.secTitle}>可约档期</Text></View>
            {upcoming.map((w) => (
              <Text selectable key={w.id} style={styles.meta}>{w.startAt.slice(0, 10)} → {w.endAt.slice(0, 10)} · {w.marketId || "全城"}</Text>
            ))}
          </>) : null}
          {/* CREATOR-SOCIAL-001：社媒区。有就列出来（平台名 + 用户名，可点的
              跳 canonical 主页），没有就如实空。visibility 是服务端按看的人过滤
              过的 —— 这里看到的就是该看的，不再二次过滤。 */}
          {/* CREATOR-SOCIAL-001：社媒区三态 —— 加载中 / 读失败 / 有数据 / 真空。
              以前失败和空长一个样（都是"尚未关联"），用户分不清"没数据"还是
              "没读出来"，我也分不清。这次分开，读失败就说读失败。 */}
          {/* MERCHANT-CREATOR-PROMO-001：她的专属码。商家在这里看到码，
              去专属码管理页绑定优惠，顾客报码即归因到她头上。没认领就不画这一节。 */}
          {selectedCreator.promoCode ? (<>
            <View style={styles.secHead}><Text selectable style={styles.secTitle}>专属营销码</Text></View>
            <Text selectable style={styles.meta} testID={`creator-promo-code-${selectedCreator.agentId}`}>
              {`${selectedCreator.promoCode} · 绑定优惠后，顾客报码拿专属优惠`}
            </Text>
          </>) : null}
          <View style={styles.secHead}><Text selectable style={styles.secTitle}>社媒账户</Text></View>
          {!creatorPassport && !creatorPassportFailed ? (
            <Text selectable style={styles.meta}>正在读取社媒信息…</Text>
          ) : creatorPassportFailed ? (
            <Text selectable style={styles.meta} testID={`creator-social-failed-${selectedCreator.agentId}`}>社媒信息没读出来，稍后再试。</Text>
          ) : (creatorPassport?.profile.socials ?? []).length > 0 ? (
            (creatorPassport?.profile.socials ?? []).map((item) => {
              const url = socialProfileUrl(item.platform, item.handle);
              return (
                <View key={item.platform} style={styles.socialRow}>
                  <View style={styles.socialMain}>
                    {/* MERCHANT-CREATOR-TAGS-001：社媒行带上自填粉丝数
                        （和列表 stats 行同一个数，对表 fanCountFor，不会两边两个数）。
                        没填就是 0 —— 未披露，不隐藏。 */}
                    <Text selectable style={styles.socialText}>{socialPlatformLabel(item.platform)} · {item.handle}{fanCountFor(item.platform, item.handle) !== undefined ? ` · 粉丝 ${formatFansCount(fanCountFor(item.platform, item.handle))}` : ""}</Text>
                  </View>
                  {/* 平台个人主页入口：有 canonical 链接就给明确按钮，
                      没有（如 Zalo 无公开页）就不画按钮，不画假入口。 */}
                  {/* CREATOR-SOCIAL-001：这里的"主页"指平台上的个人主页（站外的
                      TikTok/IG…），不是本页（本页就是站内个人主页）。
                      之前按钮只写"看主页 ›"，和站内页撞名 —— 用户分不清点下去是
                      跳出去还是留在站内。所以按钮写全：平台名 + 外跳箭头。 */}
                  {url ? (
                    <Pressable
                      accessibilityLabel={`打开${socialPlatformLabel(item.platform)}个人主页（站外）`}
                      onPress={() => void Linking.openURL(url)}
                      style={styles.socialGo}
                      testID={`creator-social-go-${selectedCreator.agentId}-${item.platform}`}
                    >
                      <Text selectable style={styles.socialGoText}>{socialPlatformLabel(item.platform)}主页 ↗</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text selectable style={styles.meta} testID={`creator-social-empty-${selectedCreator.agentId}`}>尚未关联社媒账户</Text>
          )}
          {summary({
            meta: creatorRatingLabel(selectedCreator.rating) === "" ? "暂无评价" : creatorRatingLabel(selectedCreator.rating),
            stats: [
              [`粉丝 ${formatFansCount(selectedCreator.socials?.[0]?.followerCount)}`, "粉丝"],
              [formatServiceVolume(selectedCreator.rating?.completedOrders), "服务量"],
              [selectedCreator.rating?.hasTrackRecord && formatRatePercent(selectedCreator.rating.satisfactionRate) !== "" ? `好评 ${formatRatePercent(selectedCreator.rating.satisfactionRate)}` : "新人", "好评率"],
              [formatReferencePrice(selectedCreator.referencePrice, selectedCreator.currency), "参考报价"],
            ],
            title: `${selectedCreator.name}${(selectedCreator.socials ?? [])[0]?.handle ? ` @${((selectedCreator.socials ?? [])[0]?.handle ?? "")}` : ""}`,
          })}
          {/* MERCHANT-CREATOR-INVITE-001：详情页不摆 SimpleRows 那四行
              （最近到店/当前权益/当前邀请/合作结果）—— 最近到店是空占位，
              后三个和上面的邀约区/查看记录/活动入口重复，摆两遍就是凑数。
              voucher/activity/sales 各自的主页还在，入口没丢。 */}
          {/* MERCHANT-CREATOR-INVITE-001：定向邀约区。出价是区间不是一口价
              （两端都空 = 出价待商议，只填一端 = 以那端为一口价）；目的必选
              （冲销量/UGC产出/拉人气/其他）；可谈的单她能还价，还回来是
              COUNTERED 轮到我（接受/再议/拒绝）。一口价标了不谈就别谈。
              「查看活动报名」不占按钮位 —— 上面 SimpleRows 里已经有了。 */}
          {myInvitation && (myInvitation.status === "PENDING" || myInvitation.status === "COUNTERED") ? (
            <>
              <Text selectable style={styles.meta}>
                {`${labelInvitationPurpose(myInvitation.purpose) !== "" ? `${labelInvitationPurpose(myInvitation.purpose)} · ` : ""}${myInvitation.negotiable ? "可谈" : "一口价"}`}
              </Text>
              {/* 金额单独成行放大加黑 —— 这是谈判桌上最显眼的数，不缩在灰字里。 */}
              <Text selectable style={styles.invitePrice}>{formatPriceRange(myInvitation.priceMinVnd, myInvitation.priceMaxVnd, myInvitation.currency)}</Text>
              {formatInviteDateTime(myInvitation.startAt, myInvitation.durationH) !== "" ? (
                <Text selectable style={styles.meta}>{`合作时间 ${formatInviteDateTime(myInvitation.startAt, myInvitation.durationH)}`}</Text>
              ) : null}
            </>
          ) : null}
          {myInvitation?.status === "PENDING" ? (
            <Text selectable style={styles.meta} testID={`creator-invite-pending-${selectedCreator.agentId}`}>已邀请 · 待对方回复（{myInvitation.expiresAt.slice(0, 10)} 前有效）</Text>
          ) : myInvitation?.status === "COUNTERED" ? (
            <Text selectable style={styles.meta} testID={`creator-invite-countered-${selectedCreator.agentId}`}>
              {`她还价了${myInvitation.message !== "" ? `：${myInvitation.message}` : ""}（第 ${myInvitation.termsVersion} 版）`}
            </Text>
          ) : myInvitation?.status === "ACCEPTED" ? (
            <Text selectable style={styles.meta} testID={`creator-invite-accepted-${selectedCreator.agentId}`}>对方已接受合作邀请 · 进合作记录</Text>
          ) : myInvitation?.status === "DECLINED" ? (
            <Text selectable style={styles.meta}>对方婉拒了这次合作 · 可以再约</Text>
          ) : myInvitation?.status === "EXPIRED" ? (
            <Text selectable style={styles.meta}>上次邀请已过期 · 可以再约</Text>
          ) : myInvitation?.status === "CANCELLED" ? (
            <Text selectable style={styles.meta}>已撤回这次邀请 · 可以再约</Text>
          ) : null}
          {inviteFormOpen && (!myInvitation || (myInvitation.status !== "PENDING" && myInvitation.status !== "COUNTERED")) ? (
            <View style={styles.card}>
              <Text selectable style={styles.cardTitle}>邀请 {selectedCreator.name} 合作</Text>
              <Text selectable style={styles.meta}>出价区间（VND，都空 = 出价待商议）</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput keyboardType="number-pad" onChangeText={setInviteMin} placeholder="下限" placeholderTextColor={color.muted} style={styles.inviteInput} value={inviteMin} />
                <TextInput keyboardType="number-pad" onChangeText={setInviteMax} placeholder="上限" placeholderTextColor={color.muted} style={styles.inviteInput} value={inviteMax} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable onPress={() => setInviteNegotiable(true)} style={[styles.creatorTag, inviteNegotiable && styles.creatorTagPrimary]} accessibilityLabel="可谈"><Text selectable style={inviteNegotiable ? styles.creatorTagPrimaryText : styles.creatorTagText}>可谈</Text></Pressable>
                <Pressable onPress={() => setInviteNegotiable(false)} style={[styles.creatorTag, !inviteNegotiable && styles.creatorTagPrimary]} accessibilityLabel="一口价"><Text selectable style={!inviteNegotiable ? styles.creatorTagPrimaryText : styles.creatorTagText}>一口价</Text></Pressable>
              </View>
              <Text selectable style={styles.meta}>合作目的（必选）</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["SALES", "UGC", "TRAFFIC", "OTHER"] as const).map((purpose) => (
                  <Pressable key={purpose} onPress={() => setInvitePurpose(purpose)} style={[styles.creatorTag, invitePurpose === purpose && styles.creatorTagPrimary]} accessibilityLabel={`目的${labelInvitationPurpose(purpose)}`}>
                    <Text selectable style={invitePurpose === purpose ? styles.creatorTagPrimaryText : styles.creatorTagText}>{labelInvitationPurpose(purpose)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text selectable style={styles.meta}>给她的留言（可选，200 字内）</Text>
              <TextInput multiline onChangeText={setInviteMessage} placeholder="比如：周末探店 + 晚餐，时间可商量" placeholderTextColor={color.muted} style={styles.inviteInput} value={inviteMessage} />
              <Text selectable style={styles.meta}>合作时间</Text>
              <InviteSchedulePicker days={inviteDays} slots={inviteSlots} durations={[2, 4, 8, 12]} dayOffset={inviteDay} slot={inviteSlot} durationH={inviteDurationH} onDay={setInviteDay} onSlot={setInviteSlot} onDuration={setInviteDurationH} startAtIso={inviteStartAt()} />
              {inviteError ? <Text selectable style={styles.meta}>{inviteError}</Text> : null}
            </View>
          ) : null}
          {counterOpen && myInvitation?.status === "COUNTERED" ? (
            <View style={styles.card}>
              <Text selectable style={styles.cardTitle}>再议一个价回去</Text>
              <Text selectable style={styles.meta}>出价区间（VND）</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput keyboardType="number-pad" onChangeText={setCounterMin} placeholder={String(myInvitation.priceMinVnd)} placeholderTextColor={color.muted} style={styles.inviteInput} value={counterMin} />
                <TextInput keyboardType="number-pad" onChangeText={setCounterMax} placeholder={String(myInvitation.priceMaxVnd)} placeholderTextColor={color.muted} style={styles.inviteInput} value={counterMax} />
              </View>
              <Text selectable style={styles.meta}>合作时间</Text>
              <InviteSchedulePicker days={inviteDays} slots={inviteSlots} durations={[2, 4, 8, 12]} dayOffset={counterDay} slot={counterSlot} durationH={counterDurationH} onDay={setCounterDay} onSlot={setCounterSlot} onDuration={setCounterDurationH} startAtIso={counterStartAt()} />
              <Text selectable style={styles.meta}>给她的留言（可选）</Text>
              <TextInput multiline onChangeText={setCounterMessage} placeholder="比如：这个数我们能接，档期你定" placeholderTextColor={color.muted} style={styles.inviteInput} value={counterMessage} />
              {inviteError ? <Text selectable style={styles.meta}>{inviteError}</Text> : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            {myInvitation?.status === "PENDING" ? (<>
              <Pressable onPress={() => { setCreatorView("COLLABS"); setPage("creator"); }} style={styles.primary} accessibilityLabel="查看合作记录"><Text selectable style={styles.primaryText}>查看记录</Text></Pressable>
              <Pressable disabled={inviteSending} onPress={() => void cancelInvite()} style={styles.secondary} accessibilityLabel="撤回邀请"><Text selectable style={styles.secondaryText}>{inviteSending ? "处理中…" : "撤回邀请"}</Text></Pressable>
            </>) : myInvitation?.status === "COUNTERED" && !counterOpen ? (<>
              <Pressable disabled={inviteSending} onPress={() => void settleCounter("ACCEPTED")} style={styles.primary} accessibilityLabel="接受她的还价"><Text selectable style={styles.primaryText}>{inviteSending ? "处理中…" : "接受还价"}</Text></Pressable>
              <Pressable disabled={inviteSending} onPress={() => {
                const matched = matchDaySlot(inviteDays, inviteSlots, myInvitation.startAt);
                setCounterMin(String(myInvitation.priceMinVnd));
                setCounterMax(String(myInvitation.priceMaxVnd));
                setCounterDay(matched.day);
                setCounterSlot(matched.slot);
                setCounterDurationH(myInvitation.durationH > 0 ? myInvitation.durationH : 8);
                setCounterMessage("");
                setCounterOpen(true);
              }} style={styles.secondary} accessibilityLabel="再议价格"><Text selectable style={styles.secondaryText}>再议</Text></Pressable>
            </>) : myInvitation?.status === "COUNTERED" && counterOpen ? (<>
              <Pressable disabled={inviteSending} onPress={() => void settleCounter("COUNTERED")} style={styles.primary} accessibilityLabel="发出还价"><Text selectable style={styles.primaryText}>{inviteSending ? "发送中…" : "发出还价"}</Text></Pressable>
              <Pressable disabled={inviteSending} onPress={() => { setCounterOpen(false); setInviteError(undefined); }} style={styles.secondary} accessibilityLabel="收起还价表单"><Text selectable style={styles.secondaryText}>收起</Text></Pressable>
            </>) : inviteFormOpen ? (<>
              <Pressable disabled={inviteSending} onPress={() => void sendInvite()} style={styles.primary} accessibilityLabel="发出合作邀请"><Text selectable style={styles.primaryText}>{inviteSending ? "发送中…" : "发出邀请"}</Text></Pressable>
              <Pressable disabled={inviteSending} onPress={() => { setInviteFormOpen(false); setInviteError(undefined); }} style={styles.secondary} accessibilityLabel="收起邀请表单"><Text selectable style={styles.secondaryText}>收起</Text></Pressable>
            </>) : myInvitation?.status === "ACCEPTED" ? (<>
              <Pressable onPress={() => { setCreatorView("COLLABS"); setPage("creator"); }} style={styles.primary} accessibilityLabel="查看合作记录"><Text selectable style={styles.primaryText}>查看记录</Text></Pressable>
              <Pressable onPress={() => setPage("activity")} style={styles.secondary} accessibilityLabel="查看活动报名"><Text selectable style={styles.secondaryText}>查看活动报名</Text></Pressable>
            </>) : (<>
              <Pressable disabled={!supply || !activeAccount} onPress={() => {
                const first = upcoming.map((w) => w.startAt.slice(0, 10)).find((iso) => inviteDays.some((day) => day.iso === iso));
                setInviteDay(first ? inviteDays.find((day) => day.iso === first)?.offset ?? 1 : 1);
                setInviteFormOpen(true);
              }} style={styles.primary} accessibilityLabel="邀请合作" testID={`creator-invite-open-${selectedCreator.agentId}`}><Text selectable style={styles.primaryText}>邀请合作</Text></Pressable>
              <Pressable onPress={() => { setCreatorView("COLLABS"); setPage("creator"); }} style={styles.secondary} accessibilityLabel="查看记录"><Text selectable style={styles.secondaryText}>查看记录</Text></Pressable>
            </>)}
          </View>
          {/* COUNTERED 是商家回合：接受/再议在上面，拒绝走这里 —— 行里只摆得下两个主按钮。 */}
          {myInvitation?.status === "COUNTERED" ? (
            <Pressable disabled={inviteSending} onPress={() => void settleCounter("DECLINED")} accessibilityLabel="拒绝她的还价">
              <Text selectable style={styles.meta}>谈不拢，拒绝这次合作</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (page === "voucher") {
    const ownerCount = members.filter((m) => m.role === "OWNER").length;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "券 / 客户" })}
          {summary({ title: `${activeAccount?.name ?? "商家"} · 权益`, meta: "可核验、可追溯", stats: [["—", "进行中"], ["—", "已领取"], ["—", "已核销"], ["—", "到店"]] })}
          <View style={styles.actions}><Pressable onPress={onOpenVouchers} style={styles.primary}><Text selectable style={styles.primaryText}>打开券中心</Text></Pressable><Pressable onPress={() => setPage("activity")} style={styles.secondary}><Text selectable style={styles.secondaryText}>查看关联活动</Text></Pressable></View>
          <SimpleRows onPress={setPage} rows={[["券管理", "创建、上下架与有效期"], ["核销记录", "扫码核销 · 订单留痕"], ["客户归因", "领取、到店与复购"], ["活动关联", `${activityItems.length} 个开放活动`, "activity"]]} />
          {sectionHead("经营人员", `${members.length} 人`)}
          {members.length === 0 ? (
            <ProxyEmptyState title="暂无经营人员" sub="添加成员后会显示角色、状态与加入时间。" />
          ) : null}
          {members.map((m) => (
            <View key={m.userId} style={styles.card}>
              <Text selectable style={styles.cardTitle}>{m.displayName || m.userId}</Text>
              <Text selectable style={styles.meta}>{m.role} · {m.status}</Text>
            </View>
          ))}
          <Text selectable style={styles.meta}>OWNER {ownerCount} · {members.length - ownerCount} 其他</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "activity") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "活动" })}
          {summary({ title: "活动导流", meta: `${activityItems.length} 个开放活动`, stats: [[activityItems.length.toString(), "档期"], ["—", "已报名"], ["—", "缺口"], ["—", "到店"]] })}
          {sectionHead("活动列表", `${activityItems.length} 个开放活动`) }
          {activityItems.length === 0 ? (
            <ProxyEmptyState title="本店暂无活动" sub="本店门店（含认领的现实场景）上的活动会在这里进入报名、执行与复盘流程。" />
          ) : null}
          {activityItems.map((a) => {
            // 抽成局部量：两次调用拿不到类型收窄，uri 会退化成 string|undefined。
            const coverUri = activityCoverUri(a, localApiBaseUrl);
            return (
            <Pressable
              key={a.activityId}
              onPress={() => { setSelectedActivity(a); setPage("activityDetail"); }}
              style={styles.activityCard}
            >
              <View style={styles.activityTop}>
                {/* ACTIVITY-COVER-001：商家看自己发布的活动时要有封面。
                    没有就显示占位，不拿场景图冒充 —— 那是另一个场景的图。 */}
                {coverUri ? (
                  <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-activity:${a.activityId}`} source={{ uri: coverUri }} style={styles.activityCover} transition={0} />
                ) : (
                  <View style={styles.activityCoverEmpty}><ProxyIcon color={color.muted} name="camera" size={18} /></View>
                )}
                <View style={styles.rowCopy}><Text selectable style={styles.objectTitle}>{a.title}</Text><Text selectable style={styles.meta}>{a.time} · {a.venueName}</Text></View><IconBox icon="spark" /></View>
              {a.capacity ? <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, (a.joined / a.capacity) * 100)}%` }]} /></View> : null}
              <View style={styles.chips}><View style={styles.chip}><Text selectable style={styles.chipText}>报名 {a.joined}{a.capacity ? `/${a.capacity}` : ""}</Text></View><View style={styles.chip}><Text selectable style={styles.chipText}>{a.priceLabel}</Text></View><View style={styles.chip}><Text selectable style={styles.chipText}>{a.status ?? "已发布"}</Text></View></View>
            </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // MERCHANT-ACTIVITY-DETAIL-001（2026-10-04）：按原型 deepseek_html_20261004_e74898
  // 重做这一页。以前它只有一张 summary 卡 + 三行入口（其中「定向券」跳的是本页
  // 根本不存在的子页），原型上的读数一个都没有。
  //
  // 诚实边界（这一版刻意没做的，都是没有服务端能力的，不是忘了做）：
  //   · 报名名单 / 提醒报名 / 编辑活动 / 取消活动 —— 活动域只实现了
  //     List / Publish / ToggleInterest / Join / CancelJoin(自己的报名) /
  //     Checkin / MarkNoShow，没有名册、没有推送、没有改活动、没有商家取消活动
  //     （CancelActivity 是**报名者**取消自己的报名，见 participation.go）。
  //     这四个键画成「暂不可用」，不摆点得进去却什么都不做的按钮。
  //   · 评论分析（情感占比 / 高频问题 / 关键词云）—— 全仓 0 行后端，
  //     界面上是诚实空态，不是拿假数字画一条彩色进度条。
  //   · 活动二维码 / 活动链接 —— 见 activityShareText 的注释。
  if (page === "activityDetail" && selectedActivity) {
    const act = selectedActivity;
    const coverUri = activityCoverUri(act, localApiBaseUrl);
    const capacity = act.capacity ?? 0;
    const gap = capacity > 0 ? Math.max(0, capacity - act.joined) : 0;
    const copyShareText = async (): Promise<void> => {
      await Clipboard.setStringAsync(activityShareText(act));
      setActivityLinkCopied(true);
    };
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({
            onBack: () => setPage("activity"),
            title: "活动详情",
            sub: activityStatusLabel(act.status),
            right: (
              <ProxyIconButton
                accessibilityLabel="推广活动"
                onPress={() => { setActivityLinkCopied(false); setActivitySheet("share"); }}
              >
                <ProxyIcon color={color.ink} name="shareUp" size={19} />
              </ProxyIconButton>
            ),
          })}

          {/* 封面 + 标题 + 三行 meta。活动照片没上传就显示诚实占位，
              不拿场景图 / 门店图冒充这张活动的实拍（ACTIVITY-COVER-001）。 */}
          <View style={styles.actCard}>
            {coverUri ? (
              <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`merchant-activity-detail:${act.activityId}`} source={{ uri: coverUri }} style={styles.actCover} transition={0} />
            ) : (
              <View style={styles.actCoverEmpty}>
                <ProxyIcon color={color.muted} name="camera" size={22} />
                <Text selectable style={styles.meta}>活动照片待上传</Text>
              </View>
            )}
            <View style={styles.actBody}>
              <Text selectable style={styles.actTitle}>{act.title}</Text>
              {act.venueName !== "" ? <View style={styles.actMetaRow}><ProxyIcon color={color.muted} name="pin" size={14} /><Text selectable style={styles.meta}>{act.venueName}</Text></View> : null}
              {act.time !== "" ? <View style={styles.actMetaRow}><ProxyIcon color={color.muted} name="clock" size={14} /><Text selectable style={styles.meta}>{act.time}</Text></View> : null}
              {act.consumption !== "" ? <View style={styles.actMetaRow}><ProxyIcon color={color.muted} name="infoCircle" size={14} /><Text selectable style={styles.meta}>{act.consumption}</Text></View> : null}
            </View>
          </View>

          {/* 三个读数：感兴趣 / 已报名 / 评论。全是活动契约里的字段
              （interested / joined / qaCount），不是页面里现编的数。 */}
          <View style={styles.actMetrics}>
            {([[String(act.interested), "感兴趣", color.proxyPurple], [String(act.joined), "已报名", color.proxyGreen], [String(act.qaCount), "评论", color.error]] as const).map(([value, label, tone]) => (
              <View key={label} style={styles.actMetricCell}>
                <Text selectable style={[styles.actMetricValue, { color: tone }]}>{value}</Text>
                <Text selectable style={styles.actMetricLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {capacity > 0 ? (
            <View style={styles.actCard}>
              <View style={styles.actProgressHead}>
                <Text selectable style={styles.actSectionLabel}>报名进度</Text>
                <Text selectable style={styles.actProgressValue}>{`${act.joined} / ${capacity} 人`}</Text>
              </View>
              <View style={styles.actProgressTrack}>
                <View style={[styles.actProgressFill, { width: `${Math.min(100, Math.round((act.joined / capacity) * 100))}%` }]} />
              </View>
              <Text selectable style={styles.meta}>
                {gap > 0 ? `还差 ${gap} 人满员` : "已满员"}
                {act.shares > 0 ? ` · 已分享 ${act.shares} 次` : ""}
              </Text>
            </View>
          ) : null}

          <View style={styles.actCard}>
            <Text selectable style={styles.actSectionLabel}>活动权益</Text>
            <Text selectable style={styles.actBenefit}>{act.benefit !== "" ? act.benefit : "本店未填写权益"}</Text>
            <View style={styles.actMetaGrid}>
              <View style={styles.actMetaCell}>
                <Text selectable style={styles.actMetaLabel}>参与费用</Text>
                <Text selectable style={styles.actMetaValue}>{activityFeeLabel(act)}</Text>
              </View>
              <View style={styles.actMetaCell}>
                <Text selectable style={styles.actMetaLabel}>付费方式</Text>
                <Text selectable style={styles.actMetaValue}>{activitySettlementLabel(act.consumptionTerm)}</Text>
              </View>
            </View>
          </View>

          {/* 评论分析：诚实空态。原型上这一块最抢眼（情感占比条 + 高频问题 +
              关键词云），但 sentiment / comment insight 这套数据全仓一行都没有
              —— 画出来就是编的。等分析接口上线，这里换成真数据。 */}
          <View style={styles.actCard}>
            <Text selectable style={styles.actSectionLabel}>用户评论分析</Text>
            <ProxyEmptyState
              title="评论分析还没接入"
              sub={`这场活动目前有 ${act.qaCount} 条评论；情感占比与高频问题要等服务端分析上线才显示，这里不拿假数字占位。`}
            />
          </View>

          <Text selectable style={styles.actionSectionLabel}>商家操作</Text>
          <View style={styles.actActionGrid}>
            <UnavailableActionTile icon="group" title="报名名单" />
            <UnavailableActionTile icon="bell" title="提醒报名" />
            <UnavailableActionTile icon="editProfile" title="编辑活动" />
            <Pressable accessibilityLabel="推广活动" onPress={() => { setActivityLinkCopied(false); setActivitySheet("share"); }} style={[styles.actActionTile, styles.actActionPrimary]}>
              <ProxyIcon color={color.ink} name="shareUp" size={19} />
              <Text selectable style={styles.actActionText}>推广活动</Text>
            </Pressable>
          </View>
          <Text selectable style={styles.actActionNote}>
            报名名单、提醒报名、编辑活动需要服务端补对应能力（名册 / 推送 / 改活动），今天按不了。
          </Text>
          <View style={styles.actions}>
            <Pressable accessibilityLabel="继续补位，去 Creator 人才库" onPress={() => setPage("creator")} style={styles.secondary}>
              <Text selectable style={styles.secondaryText}>继续补位</Text>
            </Pressable>
            <Pressable accessibilityLabel="查看结果" onPress={() => setPage("sales")} style={styles.secondary}>
              <Text selectable style={styles.secondaryText}>查看结果</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* 推广面板。原型四个去向里三个今天是真动作：复制 / 系统分享 / 二维码
            （扫码器已认 PROXY-ACTIVITY:<编号>，见 profile-qr.ts）。推送给合作
            Creator、推送给同城粉丝要受众查询与推送投放，那部分还没做 ——
            做不了就不摆成能点的，写在下面那行说明里。 */}
        <Modal animationType="slide" transparent visible={activitySheet !== undefined} onRequestClose={() => setActivitySheet(undefined)}>
          <Pressable accessibilityLabel="关闭推广面板" style={styles.sheetBackdrop} onPress={() => setActivitySheet(undefined)}>
            <Pressable style={styles.sheet} onPress={() => undefined}>
              {activitySheet === "qr" && act.code !== undefined && act.code !== "" ? (
                <View>
                  <Text selectable style={styles.sheetTitle}>活动二维码</Text>
                  <View style={styles.qrBig}>
                    <ProxyQrCode value={activityQrPayload(act.code) ?? ""} size={200} />
                  </View>
                  <Text selectable style={styles.sheetHint}>{`编号 ${act.code} · 顾客用 Proxy「扫一扫」扫这个码就能进这场活动。`}</Text>
                  <Pressable accessibilityLabel="返回推广面板" onPress={() => setActivitySheet("share")} style={styles.sheetClose}>
                    <Text selectable style={styles.sheetCloseText}>返回</Text>
                  </Pressable>
                </View>
              ) : (
                <>
              <Text selectable style={styles.sheetTitle}>推广活动</Text>
              <Pressable accessibilityLabel="复制活动信息" onPress={() => void copyShareText()} style={styles.sheetRow}>
                <Text selectable style={styles.sheetRowText}>{activityLinkCopied ? "已复制活动信息" : "复制活动信息"}</Text>
                <Text selectable style={styles.chev}>›</Text>
              </Pressable>
              <Pressable accessibilityLabel="用系统分享发送" onPress={() => { void Share.share({ message: activityShareText(act) }); setActivitySheet(undefined); }} style={styles.sheetRow}>
                <Text selectable style={styles.sheetRowText}>用系统分享发送</Text>
                <Text selectable style={styles.chev}>›</Text>
              </Pressable>
              {act.code !== undefined && act.code !== "" ? (
                <Pressable accessibilityLabel="生成活动二维码" onPress={() => setActivitySheet("qr")} style={styles.sheetRow}>
                  <Text selectable style={styles.sheetRowText}>生成活动二维码</Text>
                  <Text selectable style={styles.chev}>›</Text>
                </Pressable>
              ) : (
                // 没有服务端分配的活动编号就没有码可发（payload 收编号，不收 URL）。
                <Text selectable style={styles.sheetHint}>这场活动还没有编号，生成不了二维码。</Text>
              )}
              <Text selectable style={styles.sheetHint}>
                推送给合作 Creator、推送给同城粉丝还没接通：投放要受众查询与推送配额。这里不摆按了没反应的行。
              </Text>
              <Pressable accessibilityLabel="关闭" onPress={() => setActivitySheet(undefined)} style={styles.sheetClose}>
                <Text selectable style={styles.sheetCloseText}>关闭</Text>
              </Pressable>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  if (page === "store") {
    if (!business) {
      return (
        <View style={styles.root}>
          {detailHead({ onBack: () => setPage("root"), title: "线上店铺" })}
          <View style={styles.card}><Text selectable style={styles.empty}>请登录后查看</Text></View>
        </View>
      );
    }
    // STORE-CONSOLIDATE-001（2026-10-02，用户选收编）：BUSINESS 上下文的"线上店铺"
    // 页改走统一 hub —— 和 me.tsx 里 bdash / merchantstorefront 是同一页。
    // 三个客户端齐了才进 hub，缺一个就给 honest 空态（不能拿半个 hub 糊弄）。
    if (!fulfillment || !profile) {
      return (
        <View style={styles.root}>
          {detailHead({ onBack: () => setPage("root"), title: "线上店铺" })}
          <View style={styles.card}><Text selectable style={styles.empty}>店铺服务没接上，稍后再试。</Text></View>
        </View>
      );
    }
    // STORE-HUB-SCROLL-001（2026-10-02，用户「还是显示不完整 不能下滑动」）：
    // 这一支原来是这个文件里**唯一**没套 ScrollView 的页面 —— 其余每一页都是
    // `<View style={root}><ScrollView contentContainerStyle={styles.content}>`。
    // hub 自己是纯 View（列表/详情都不带滚动容器，滚动归宿主），所以在这里
    // 直接渲染 = 整页没有滚动容器：内容超过一屏就被屏幕底边裁掉，而且底部
    // 735–818pt 那条悬浮 Tab Bar 还压在最后一段内容上，怎么划都到不了。
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <MyStoresHub
            business={business}
            fulfillment={fulfillment}
            profile={profile}
            onOpenStoreCreate={onOpenStoreCreate ?? (() => setPage("ops"))}
            onOpenVouchers={onOpenVouchers}
            onBack={() => setPage("root")}
          />
        </ScrollView>
      </View>
    );
  }

  if (page === "sales") {
    const totalNew = spendDays.reduce((sum, d) => sum + d.newCustomerCount, 0);
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "销售中心" })}
          {summary({
            meta: "近 30 天 · server 实际",
            stats: [
              [spendTotal.totalOrders.toString(), "订单"],
              [formatVnd(spendTotal.totalGrossMinor), "成交额"],
              [totalNew.toString(), "新客"],
              [(spendDays.reduce((s, d) => s + d.returningCustomerCount, 0)).toString(), "复购"],
            ],
            title: formatVnd(spendTotal.totalGrossMinor),
          })}
          <SimpleRows onPress={setPage} rows={[["Creator", `${creators.length} 位当前可匹配`, "creator"], ["券", "查看权益与核销", "voucher"], ["活动导流", `${activityItems.length} 个开放活动`, "activity"], ["自然到店", "等待真实归因数据"]]} />
          {spendDays.length === 0 ? (
            <View style={styles.card}><Text selectable style={styles.empty}>暂无销售数据 — server 列表为空</Text></View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  // MERCHANT-CREATOR-CONTENT-001（2026-10-04）：生产内容。
  // 原型 deepseek_html_20261004_e74898 / 设计稿 Proxy_Creator_Promo_20261004 的
  // page-content 只有一行眉题「探店短视频」，没有正文；这一页的正文按原型语气补齐，
  // 数据全部来自服务端邀约记录 —— 一行都不许是页面里写死的样例。
  // CONTENT-TASK-001：生产内容 = 内容任务（UGC 邀约 + 稿件 / 审核 / 发布链接），取代
  // MERCHANT-CREATOR-CONTENT-001 的邀约列表（那时没有交付数据，「已交付成片」只能写 —）。
  // 数据源还是同一批邀约，由 ListMerchantContentTasks 在服务端组装，页面不再自己拉邀约。
  if (page === "content") {
    if (!supply || !activeAccount) {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            {detailHead({ onBack: () => setPage("creator"), title: "生产内容" })}
            <Text selectable style={styles.meta}>账号数据没读出来，稍后再试。</Text>
          </ScrollView>
        </View>
      );
    }
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <MerchantContentSurface
            supply={supply}
            merchantId={activeAccount.id}
            creators={creators.map((c) => ({ agentId: c.agentId, name: c.name, photoUri: resolveCreatorPhoto(c.photos[0]) }))}
            onBack={() => setPage("creator")}
            onOpenCreators={() => { setCreatorView("CREATORS"); setPage("creator"); }}
          />
        </ScrollView>
      </View>
    );
  }

  if (page === "promo") {
    if (!supply || !activeAccount) {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            {detailHead({ onBack: () => setPage("creator"), title: "专属营销码" })}
            <Text selectable style={styles.meta}>账号数据没读出来，稍后再试。</Text>
          </ScrollView>
        </View>
      );
    }
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <MerchantPromoSurface
            supply={supply}
            merchantId={activeAccount.id}
            merchantName={activeAccount.name}
            marketId="hn"
            // MERCHANT-CREATOR-PROMO-002：人才库里的每位 creator 都能生成本店专属码（一人一码），
            // 不再只限于自己认领过全局码的人。
            creators={creators.map((c) => ({ agentId: c.agentId, name: c.name, photoUri: resolveCreatorPhoto(c.photos[0]) }))}
            onBack={() => setPage("creator")}
            // 「选择下单」：进这位 creator 的主页，走现有的「邀请合作」下单流程。
            onSelectCreator={(agentId) => {
              const picked = creators.find((c) => c.agentId === agentId);
              if (picked) { setSelectedCreator(picked); setPage("creatorDetail"); } else { setPage("creator"); }
            }}
          />
        </ScrollView>
      </View>
    );
  }

  if (page === "ops") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "运营中心" })}
          <SimpleRows onPress={setPage} rows={[["Creator 待跟进", `${creators.length} 位当前可匹配`, "creator"], ["活动待处理", `${activityItems.length} 个开放活动`, "activity"], ["券与核销", "查看权益与核销状态", "voucher"], ["销售结果", `${spendTotal.totalOrders} 个订单`, "sales"]]} />
          {sectionHead("经营人员", `member_directory · ${members.length}`)}
          {members.length === 0 ? (
            <View style={styles.card}><Text selectable style={styles.empty}>暂无成员</Text></View>
          ) : null}
          {members.map((m) => (
            <View key={m.userId} style={styles.card}>
              <Text selectable style={styles.cardTitle}>{m.displayName || m.userId}</Text>
              <Text selectable style={styles.meta}>{m.role} · {m.status}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (page === "scene") {
    const sceneActs = storeSceneId ? activityItems.filter((a) => a.realitySceneId === storeSceneId) : [];
    const joinedTotal = sceneActs.reduce((sum, a) => sum + a.joined, 0);
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "场景运营" })}
          {sceneDetail?.heroImageUrl ? <Image source={{ uri: sceneDetail.heroImageUrl }} style={styles.sceneHero} /> : null}
          {summary({
            meta: sceneDetail ? `${sceneDetail.window} · ${sceneDetail.liveLabel}` : "公开场景投影",
            stats: [
              [sceneActs.length.toString(), "本场景活动"],
              [joinedTotal.toString(), "已参加"],
              [spendTotal.totalOrders.toString(), "近单"],
            ],
            title: sceneDetail?.name || storeScene?.storeName || "本店还没关联现实场景",
          })}
          <SimpleRows onPress={setPage} rows={[["活动导流", `${sceneActs.length} 个本场景活动`, "activity"], ["菜单与价格", "进线上店铺管理", "store"], ["销售结果", `${spendTotal.totalOrders} 个订单`, "sales"]]} />
          {sectionHead("本场景活动", storeSceneId ? `realitySceneId = ${storeSceneId}` : "门店未关联场景")}
          {sceneActs.length === 0 ? (
            <View style={styles.card}><Text selectable style={styles.empty}>本场景暂无活动 — 去活动页创建一个</Text></View>
          ) : null}
          {sceneActs.map((a) => (
            <View key={a.activityId} style={styles.card}>
              <Text selectable style={styles.cardTitle}>{a.title}</Text>
              <Text selectable style={styles.meta}>{a.time} · {a.joined} 人已参加{(a.capacity ?? 0) > 0 ? ` / 限 ${a.capacity} 人` : ""}</Text>
            </View>
          ))}
          {sectionHead("场景真人", "scene projection")}
          {(sceneDetail?.humans ?? []).length === 0 ? (
            <View style={styles.card}><Text selectable style={styles.empty}>暂无关联真人</Text></View>
          ) : null}
          {(sceneDetail?.humans ?? []).map((h) => (
            <View key={h.id} style={styles.card}>
              <Text selectable style={styles.cardTitle}>{h.name}</Text>
              <Text selectable style={styles.meta}>{h.role} · {h.availability}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-notices") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "平台通知" })}
          <Text selectable style={styles.cardTitle}>暂无通知</Text>
          <Text selectable style={styles.empty}>订单状态变更、活动报名确认与系统维护预告会出现在这里。</Text>
          <Text selectable style={styles.meta}>依据：网络安全响应要求（24 小时一般 / 6 小时紧急）；通知记录保留 ≥ 12 个月。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-policy") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "政策与规则" })}
          <Text selectable style={styles.empty}>平台角色判断依据实际功能（订单撮合、支付处理、商家入驻审核、交易数据控制）而非平台自我命名。适用时履行电子商务平台登记（Decree 248/2026 §3）、卖家/商家身份验证（§11）、商品/服务信息披露、禁止假冒商品及违法服务治理、消费者投诉与争议处理、交易/商家/平台运营数据保存（≥ 12 个月）、与主管机关依法配合、其他电子商务平台义务（§545-546）。</Text>
          <Text selectable style={styles.sectionTitle}>§30 订单（交易主体、价格、税费、取消与退款规则）</Text>
          <Text selectable style={styles.empty}>订单页面应尽可能明确：交易主体；商品或服务；数量；价格；费用；税费（如有）；履约时间与地点；取消规则；退款规则（§620-629）。订单可作为电子交易记录的一部分（§565）。</Text>
          <Text selectable style={styles.sectionTitle}>§32 支付（第三方支付机构处理）</Text>
          <Text selectable style={styles.empty}>由银行或依法提供支付服务的第三方支付机构完成实际支付处理（§593）。Proxy 仅提供支付入口，不自动成为银行、电子钱包、支付机构或用户资金托管机构（§595-600、§605-615）。用户可能还需要接受实际支付服务提供商的相关条款（§602）。</Text>
          <Text selectable style={styles.sectionTitle}>§28 商家信息（真实、准确、完整、不误导）</Text>
          <Text selectable style={styles.empty}>商家应保证信息真实、准确、完整、不具有误导性（§502-507），包括：企业或经营主体、店铺名称、地址、商品、服务、价格、许可证、优惠、礼品券、联系方式（§509-520）。需要行业资质的业务必须依法取得相应许可（§522）。</Text>
          <Text selectable style={styles.sectionTitle}>§19 禁止内容 + §21 活动（真实必要信息与平台角色）</Text>
          <Text selectable style={styles.empty}>活动创建者应提供真实且必要的信息：活动性质、时间、地点、参与条件、人数、价格、取消规则、必要安全信息（§384-394、§390-394）。除非活动页面明确说明 Proxy 为实际组织者，否则 Proxy 通常仅提供技术、发现、报名和通信工具，不承担活动组织责任（§395-396）。</Text>
          <Text selectable style={styles.sectionTitle}>§36 诈骗及账号欺诈 + §37 内容审核（治理规则）</Text>
          <Text selectable style={styles.empty}>禁止恋爱诈骗、投资诈骗、假商家、假客服、礼品券诈骗、支付诈骗、骗取验证码、冒充 Proxy、其他欺骗行为（§651-664）。内容审核措施（提醒、降低传播、限制消息、删除内容、暂停功能、冻结交易、暂停/永久封禁账号）依据严重程度、重复违规、现实风险、法律要求执行（§670-689）。</Text>
          <Text selectable style={styles.sectionTitle}>法律依据（越南 2026 生效规则）</Text>
          <Text selectable style={styles.empty}>Decree 248/2026/ND-CP §3（平台登记判断）、§11（卖家验证）、§23（数据保存）；PDP Law 91/2025/QH15 Art.31（明示同意）、Art.32（删除请求、数据保护影响评估、跨境评估）；Decree 328/2026/NĐ-CP §4（假新闻与虚假信息处置：一般 24 小时，国家安全紧急 6 小时）；电子商务平台登记/通知责任在适用时执行（§534-547）。</Text>
          {/* 合规修正（2026-09-27）：这里原来写着「缺失内容已在
              docs/legal/vietnam/Proxy_Operating_Terms_Supplement_2026-08-31.md
              补齐（…DPIA、跨境数据影响评估、DPO/数据保护部门…）」。**那是假的** ——
              那份 supplement 的 9 行「当前状态」**全部是「空白」**，一行没补。
              把未完成的法务事项写成「已补齐」，是仓里最忌讳的那种状态：
              让缺口看起来像已闭环。改成只陈述两边的事实。 */}
          <Text selectable style={styles.meta}>平台侧已落地的部分（卖家实名验证、24 小时 / 国家安全紧急 6 小时处置时限、隐私请求入口）在代码与回归门禁里有对应实现。但《运营条款补全清单》(docs/legal/vietnam/Proxy_Operating_Terms_Supplement_2026-08-31.md) 里的 9 项 —— 越南法人信息、法律分类、电商登记、DPIA、跨境数据影响评估、DPO/数据保护部门、第三方处理方清单与 DPA、越南语正式版本、执业律师最终审阅 —— **目前全部仍是「空白」**，尚未补齐，正式上线前必须完成。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-verify") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "认证与资格" })}
          <Text selectable style={styles.cardTitle}>状态：{activeAccount?.status ?? "待获取"}</Text>
          <Text selectable style={styles.empty}>商家验证：需要提交营业执照、食品安全证书（F&B）、税号。平台角色判断依据 Decree 248/2026 §3：提供交易撮合 + 支付处理 + 商家入驻审核 = 电子商务平台，须完成平台登记（platform_registration_number）。</Text>
          <Text selectable style={styles.meta}>缺失：platform_registration 字段 + e-commerce_platform_notice UI 提示（已记录在运营条款补充文档）。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-support") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "支持与申诉" })}
          <Text selectable style={styles.cardTitle}>处理中问题：0 个</Text>
          <Text selectable style={styles.empty}>申诉流程：提交 → 平台审核（一般 24 小时，国家安全紧急 6 小时）→ 结果通知 → 如不接受可向外部律师/监管机构申诉。申诉记录写入 content_governance 表（内容 ID、举报类型、处置动作、响应时间、法律依据）。</Text>
          <Text selectable style={styles.meta}>依据：Proxy_Legal_Update_Notes v1.1（2026-08-31）§2 网络安全响应；条款文件已在 docs/legal/vietnam/ 补齐。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy") {    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "Proxy 数据" })}
          {summary({ title: `${activeAccount?.name ?? "商家"} · Proxy`, meta: "平台关系", stats: [["—", "未读通知"], ["—", "开放能力"], [activeAccount?.status ?? "—", "接入"], [members.length.toString(), "成员"]] })}
          <SimpleRows onPress={setPage} rows={[["平台通知", "订单、活动与系统消息", "proxy-notices"], ["政策与规则", "Creator · 券 · 活动 · 内容", "proxy-policy"], ["认证与资格", activeAccount?.status ?? "待获取", "proxy-verify"], ["成员与权限", `${members.length} 位成员`, "ops"], ["平台结算", "合作、券成本与活动支出", "sales"], ["接入与连接", "店铺 · QR · 核销 · 数据同步", "store"], ["支持与申诉", "查看处理中问题", "proxy-support"]]} />
          {sectionHead("业务健康度", "spend_daily · server 实际")}
          {spendDays.length === 0 ? (
            <View style={styles.card}><Text selectable style={styles.empty}>暂无数据 — server 列表为空</Text></View>
          ) : null}
          {spendDays.map((d) => (
            <View key={d.bucketDate} style={styles.card}>
              <Text selectable style={styles.cardTitle}>{d.bucketDate}</Text>
              <Text selectable style={styles.meta}>{d.orderCount} 单 · {formatVnd(d.grossMinor)} · 新 {d.newCustomerCount} / 复 {d.returningCustomerCount}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topline}>
          <Text selectable style={styles.h1}>我的</Text>
          <View style={styles.merchantTag}><Text selectable style={styles.merchantTagText}>商家</Text></View>
        </View>

        {accounts === undefined && !error ? <ProxyLoading tone="muted" /> : null}
        {/* MOBILE-SIGNIN-ERROR-TEXT-001：登录态问题不能把协议原文甩在脸上。2026-10-05
            模拟器上这里显示的是「加载失败：authenticated principal required」+ 一片 0，
            用户看不出其实是「要登录」。其他失败（网络抖、服务端 500）照原样报，
            不能一律赶去登录 —— 那条坑 other-profile.tsx:209 记过。 */}
        {error ? <View style={styles.card}><Text selectable style={styles.empty}>{isSignInRequiredError(error) ? "经营数据要登录后才看得到 —— 访客身份没有商家权限，请到「我的」页登录。" : `加载失败：${error}`}</Text></View> : null}

        {/* UI-MERCHANT-ACCOUNT-SWITCH-001：一个商家账号可以持有多个经营主体
            （business account）。activeAccountId 以前只写不读 —— 加载时永远取
            list[0]，多账号商家**静默只看得到第一个**，界面上没有任何切换器，
            成员 / 消费 / 门店数据全来自那一个。现在把切换器画出来：数据层本来
            就是按 accountId 拉的（refresh(accountId)），缺的只是入口。 */}
        {accounts && accounts.length > 1 ? (
          <ScrollView contentContainerStyle={styles.accountSwitchRow} horizontal showsHorizontalScrollIndicator={false} style={styles.accountSwitch}>
            {accounts.map((a) => {
              const on = a.id === activeAccountId;
              return (
                <Pressable
                  accessibilityLabel={`切换到 ${a.name}`}
                  accessibilityState={{ selected: on }}
                  key={a.id}
                  onPress={() => {
                    if (on) return;
                    setActiveAccountId(a.id);
                    setActiveMerchantId(a.id);
                    // 换主体时先把上一家的数字清掉：A 店的成员数与经营结果印在 B 店
                    // 标题下面，比暂时空着更糟 —— 那是一条没发生过的读数。
                    setMembers([]);
                    setSpendDays([]);
                    setSpendTotal({ totalOrders: 0, totalGrossMinor: 0 });
                    void refresh(a.id);
                  }}
                  style={[styles.accountSwitchChip, on && styles.accountSwitchChipOn]}
                >
                  <Text selectable style={[styles.accountSwitchChipText, on && styles.accountSwitchChipTextOn]}>{a.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <Pressable onPress={() => setPage("store")} style={styles.identity}>
          {/* MERCHANT-AVATAR-001（2026-10-02，用户 P0「企业店铺的头像用了用户侧的头像」）：
              这里以前直接画 `accounts[0].avatarPath` —— 而服务端是把店主**个人**头像
              JOIN 进来的，于是店的身份卡上是店主的脸。现在服务端已不再填这个字段，
              这里也不再信任它：店没有上传 logo/照片之前，老实显示店名首字。
              店的视觉只能来自店自己的资产，绝不能拿用户的脸冒充。 */}
          <Gradient from="#45208A" to="#8033F0" style={styles.bizAvatar}>
            <Text selectable style={styles.bizAvatarText}>{(activeAccount?.name.trim().slice(0, 1) || "店").toUpperCase()}</Text>
          </Gradient>
          <View style={styles.rowCopy}>
            <Text selectable style={styles.cardTitle}>{activeAccount?.name ?? "还没有店铺"}</Text>
            <Text selectable style={styles.meta}>{activeAccount ? `${activeAccount?.status ?? ""} · ${members.length} 经营人员` : "创建后解锁相册 · 信息 · 成员 · 数据"}</Text>
          </View>
          <View style={styles.storeButton}>
            <Text selectable style={styles.storeButtonText}>{activeAccount ? "查看店铺" : "创建店铺"}</Text>
          </View>
        </Pressable>

        <MerchantCreatorRecommendations onOpenAll={() => setPage("creator")} supply={supply} />

        <View style={styles.today}>
          <View style={styles.todayHead}>
            <Text selectable style={styles.cardTitleWhite}>今天需要处理</Text>
            <Text selectable style={styles.todayHint}>{activityItems.length + creators.length} 项</Text>
          </View>
          {([
            ["spark", `${activityItems.length} 个开放活动待跟进`, "活动导流", "activity"],
            ["target", `${creators.length} 位 Creator 可匹配`, "Creator 经营", "creator"],
            ["coin", `${spendTotal.totalOrders} 个订单已汇总`, "销售中心", "sales"],
          ] as const).map(([icon, title, meta, destination]) => (
            <Pressable key={meta} onPress={() => setPage(destination)} style={styles.todo}>
              <View style={styles.todoIcon}><ProxyIcon color={color.lime} name={icon} size={22} /></View>
              <View style={styles.rowCopy}><Text selectable style={styles.todoTitle}>{title}</Text><Text selectable style={styles.todoMeta}>{meta}</Text></View>
              <Text selectable style={styles.todoChev}>›</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.kpis}>
          {([
            [formatVnd(spendTotal.totalGrossMinor), "近 30 天销售", "sales"],
            [creators.length.toString(), "Creator", "creator"],
            [members.length.toString(), "经营人员", "ops"],
            [activityItems.length.toString(), "开放活动", "activity"],
          ] as const).map(([value, label, destination]) => (
            <Pressable key={label} onPress={() => setPage(destination)} style={styles.kpi}>
              <Text selectable numberOfLines={1} style={styles.kpiValue}>{value}</Text><Text selectable style={styles.caption}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {sectionHead("经营")}
        <View style={styles.moduleGrid}>
          {([
            ["target", "Creator 经营", `${creators.length} 位 Creator`, true, "creator"],
            ["ticket", "客户 / 券", `${members.length} 位经营人员`, false, "voucher"],
            ["arrowUpRight", "活动导流", `${activityItems.length} 个开放活动`, false, "activity"],
            ["storeLines", "线上店铺", activeAccount?.status ?? "查看店铺", true, "store"],
            ["cup", "场景运营", storeScene ? `${storeScene.storeName} · 实况` : "门店未关联场景", true, "scene"],
          ] as const).map(([icon, title, meta, brand, destination]) => (
            <Pressable key={title} onPress={() => setPage(destination)} style={styles.module}>
              <IconBox brand={brand} icon={icon} />
              <Text selectable style={styles.cardTitle}>{title}</Text>
              <Text selectable numberOfLines={1} style={styles.moduleMeta}>{meta}</Text>
            </Pressable>
          ))}
        </View>

        {sectionHead("管理")}
        <View style={styles.moduleGrid}>
          {([
            ["coin", "销售中心", `${spendTotal.totalOrders} 单 · ${formatVnd(spendTotal.totalGrossMinor)}`, "sales"],
            ["spark", "运营中心", `${members.length} 人员 · ${spendDays.length} 日数据`, "ops"],
          ] as const).map(([icon, title, meta, destination]) => (
            <Pressable key={title} onPress={() => setPage(destination)} style={styles.module}>
              <IconBox icon={icon} />
              <Text selectable style={styles.cardTitle}>{title}</Text>
              <Text selectable numberOfLines={1} style={styles.moduleMeta}>{meta}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setPage("proxy")} style={styles.proxyWide}>
          <Image source={OTTER_LOGO} style={styles.proxyLogo} />
          <View style={styles.rowCopy}>
            <Text selectable style={styles.cardTitle}>Proxy 中心</Text>
            <Text selectable style={styles.meta}>{spendDays.length} 日真实经营数据 · 权限与工作区</Text>
          </View>
          <Text selectable style={styles.chev}>›</Text>
        </Pressable>

        <Pressable onPress={onOpenSwitcher} style={styles.subtleButton}><Text selectable style={styles.subtleButtonText}>切换身份</Text></Pressable>
        <Pressable onPress={onSignOut} style={styles.subtleButtonDanger}><Text selectable style={styles.subtleButtonDangerText}>退出登录</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { padding: 16, paddingBottom: 104 },
  topline: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  h1: { color: color.ink, fontSize: 28, fontWeight: "900", letterSpacing: -1, lineHeight: 34 },
  merchantTag: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, height: 32, justifyContent: "center", paddingHorizontal: 12 },
  merchantTagText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  // UI-MERCHANT-ACCOUNT-SWITCH-001：多经营主体切换器。
  accountSwitch: { marginTop: 12 },
  accountSwitchRow: { gap: 8, paddingRight: 16 },
  accountSwitchChip: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  accountSwitchChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  accountSwitchChipText: { color: color.muted, fontSize: 13, fontWeight: "700" },
  accountSwitchChipTextOn: { color: color.white },
  identity: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 24, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 14, padding: 14 },
  bizAvatar: { alignItems: "center", borderRadius: 16, height: 52, justifyContent: "center", width: 52 },
  bizAvatarText: { color: color.white, fontSize: 24, fontWeight: "900" },
  rowCopy: { flex: 1, minWidth: 0 },
  storeButton: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, height: 36, justifyContent: "center", paddingHorizontal: 11 },
  storeButtonText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 6, marginTop: 14 },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  // CREATOR-PROFILE-001：详情个人头 + 能力 chips。
  // CREATOR-LIST-CARD-001：改成原型 .profile-card 的两段式 —— 上段头像/名字/简介，
  // 下段 .price-bar（虚线上边 + 参考报价 + 状态胶囊）。所以这里是**列**容器。
  creatorHero: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, gap: 12, marginVertical: 4, padding: 14 },
  creatorHeroTop: { alignItems: "center", flexDirection: "row", gap: 12 },
  creatorPriceBar: { alignItems: "center", borderStyle: "dashed", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 },
  creatorPriceLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  creatorPriceValue: { color: color.ink, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, lineHeight: 28 },
  creatorHeroAvatar: { backgroundColor: color.surface, borderRadius: 999, height: 58, width: 58 },
  creatorHeroAvatarMissing: { alignItems: "center", backgroundColor: color.surface, borderRadius: 999, height: 58, justifyContent: "center", width: 58 },
  creatorHeroInitial: { color: color.muted, fontSize: 20, fontWeight: "900" },
  secHead: { marginTop: 12 },
  secTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  // CREATOR-LIST-CARD-001：已验证的芯片用原型 .skill-tag.checked 的样子
  // （浅黄绿底 + 橄榄绿边），没验证的留白底灰边 —— 之前两态同色同底，
  // 只差一个 ✓ 字符，扫一眼看不出谁被验过。
  capChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  capChipVerified: { backgroundColor: color.inspireSavedBg, borderColor: color.inspireSavedBorder },
  capText: { color: "#62596B", fontSize: 11, fontWeight: "800" },
  capTextVerified: { color: color.ink },
  // CREATOR-PROFILE-001：个人主页眉题。
  homeEyebrow: { color: color.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginTop: 4 },
  // CREATOR-SOCIAL-001：社媒行（可点的有 ›）。
  socialRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingVertical: 9 },
  socialMain: { flex: 1, minWidth: 0 },
  socialText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  // CREATOR-SOCIAL-001：平台主页入口按钮。
  socialGo: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  socialGoText: { color: color.white, fontSize: 11, fontWeight: "800" },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 12, marginVertical: 4, ...shadows.card, gap: 2 },
  // CREATOR-AVATAR-001：头像 58px 方图 + 右侧文字，横排 —— 列表行看着像「一批人」
  // 而不是「一串字」。与 merchant-creator-recommendations 的横滑卡共用同一套解析。
  // CREATOR-LIST-CARD-001（2026-10-04，用户「商家侧-我的 creator list 展示形式 这次
  // 比较亮眼 之前太素了」）：一行从「三段文字的通讯录条目」换成一张卡 —— 圆头像
  // （服务端判定可邀请时带一颗点）+ 名字 + 真实标签 + 真实读数 + 右列报价与主操作。
  // 原型卡上的「⭐评分 / 粉丝 2.4w / 均播 5.2w」这份数据里没有，一个都没抄。
  creatorRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginVertical: 5, padding: 14, ...shadows.card },
  // 头像的定位上下文：那颗点要贴在头像右下角。
  creatorAvatarHit: { position: "relative" },
  creatorOnlineDot: { backgroundColor: color.proxyGreen, borderColor: color.white, borderRadius: 999, borderWidth: 2, bottom: 2, height: 14, position: "absolute", right: 2, width: 14 },
  creatorCardName: { color: color.ink, fontSize: 16, fontWeight: "800", lineHeight: 22 },
  // MERCHANT-CREATOR-TAGS-001：名字后面贴的 @handle（Thao @thao_hanoi）——
  // 同一个人，弱化显示，不占标签位。
  creatorHandle: { color: color.muted, fontSize: 13, fontWeight: "500" },
  creatorTagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 6 },
  creatorTag: { backgroundColor: color.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  // MERCHANT-CREATOR-TAGS-001：标签按类配色。垂类是商家第一眼（亮底），
  // 语言范围保持中性灰。颜色全部出自 R3 tokens。
  creatorTagPrimary: { backgroundColor: color.factConfirmedBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  creatorTagPrimaryText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "700" },
  creatorTagDark: { backgroundColor: color.ink, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  creatorTagDarkText: { color: color.white, fontSize: 11, fontWeight: "700" },
  creatorTagText: { color: "#62596B", fontSize: 11, fontWeight: "700" },
  creatorStatRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 8 },
  creatorEligibility: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  creatorEligibilityOn: { backgroundColor: color.proxyGreenSoft },
  creatorEligibilityOff: { backgroundColor: color.stateDangerBg },
  creatorEligibilityText: { fontSize: 11, fontWeight: "800" },
  creatorEligibilityTextOn: { color: "#137C6C" },
  creatorEligibilityTextOff: { color: color.error },
  creatorStat: { color: color.muted, fontSize: 11, fontWeight: "600" },
  // 右列：报价在上、主操作在下。flexShrink:0 —— 名字再长也不许把报价压扁。
  creatorAction: { alignItems: "flex-end", flexShrink: 0, gap: 8 },
  creatorPrice: { color: color.ink, fontSize: 15, fontWeight: "900" },
  // MERCHANT-CREATOR-INVITE-001：邀约出价单独成行 —— 談判桌上最显眼的数，
  // 比列表报价再大一号，不缩在灰字里。
  invitePrice: { color: color.ink, fontSize: 19, fontWeight: "900", letterSpacing: -0.3, lineHeight: 25 },
  // MERCHANT-CREATOR-INVITE-001：邀约表单输入框 —— 白卡上的输入框要有边框，
  // 不能拿搜索框那套灰底丸子凑数，不然整张表单灰蒙蒙。
  inviteInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, flex: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  creatorGo: { backgroundColor: color.lime, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  creatorGoText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  // CREATOR-AVATAR-001：头像是圆圈（999），不是方块R角。
  creatorAvatar: { backgroundColor: color.surface, borderRadius: 999, height: 64, width: 64 },
  creatorAvatarMissing: { alignItems: "center", backgroundColor: color.surface, borderRadius: 999, gap: 2, height: 64, justifyContent: "center", width: 64 },
  creatorAvatarMissingText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  flex: { flex: 1, minWidth: 0 },
  sceneHero: { borderRadius: 14, height: 168, marginTop: 4, width: "100%" },
  cardTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  cardTitleWhite: { color: color.white, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  meta: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginTop: 3 },
  empty: { color: color.muted, fontSize: 12 },
  emptyCard: { backgroundColor: "#F6F2F9", borderRadius: 16, gap: 4, marginVertical: 6, padding: 16 },
  emptyTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  subPageBack: { marginBottom: 10, paddingVertical: 4 },
  detailHead: { marginBottom: 12 },
  // MERCHANT-ACTIVITY-DETAIL-001：标题与右侧动作键同一行，状态眉题在标题下面。
  detailHeadRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  detailHeadText: { flex: 1, minWidth: 0 },
  detailSub: { color: color.muted, fontSize: 12, fontWeight: "600", lineHeight: 17, marginTop: 2 },
  detailHeadActions: { flexDirection: "row", gap: 6, paddingTop: 2 },
  detailTitle: { color: color.ink, fontSize: 24, fontWeight: "900", letterSpacing: -0.7, lineHeight: 30 },
  objectTitle: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  summary: { backgroundColor: color.deep, borderRadius: 24, padding: 15 },
  summaryMeta: { color: "#D7D0DD", fontSize: 12, lineHeight: 17, marginTop: 4 },
  summaryStats: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryStatItem: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)", borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 9 },
  summaryStatValue: { color: color.white, fontSize: 17, fontWeight: "900", lineHeight: 20 },
  summaryStatLabel: { color: "#D8D1DD", fontSize: 11, fontWeight: "600", lineHeight: 15, marginTop: 3 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  rowList: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginTop: 10, paddingHorizontal: 14 },
  row: { alignItems: "center", borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, minHeight: 66 },
  activityCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, marginTop: 10, padding: 14 },
  // ACTIVITY-COVER-001：64px 封面缩略图，和文字并排。
  activityCover: { backgroundColor: color.surface, borderRadius: 12, height: 64, width: 64 },
  activityCoverEmpty: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, height: 64, justifyContent: "center", width: 64 },
  activityTop: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  // MERCHANT-ACTIVITY-DETAIL-001：活动详情按原型 deepseek_html_20261004_e74898 排的版。
  // 一律 R3 token + 描边不投影（shadows.card 已经是透明投影，见 theme.tsx），
  // 不搬原型里的 #d0f55c / #0071e3 / #FF3B30 这些 hex —— 那套色不在 R3 里，
  // 搬进来就是新的硬编码欠账。
  actCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, gap: 8, marginTop: 12, overflow: "hidden", padding: 16 },
  // 封面按原型是 16:9 大图；没有上传就走诚实占位（不拿场景图冒充这张活动的实拍）。
  actCover: { aspectRatio: 16 / 9, backgroundColor: color.surface, width: "100%" },
  actCoverEmpty: { alignItems: "center", aspectRatio: 16 / 9, backgroundColor: color.surface, borderBottomColor: color.line, borderBottomWidth: 1, gap: 6, justifyContent: "center", width: "100%" },
  actBody: { gap: 6, paddingHorizontal: 2, paddingTop: 12 },
  actTitle: { color: color.ink, fontSize: 18, fontWeight: "900", letterSpacing: -0.4, lineHeight: 24 },
  actMetaRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  // 三个读数一格。原型的情感/成功/警示三色在 R3 里没有对应语义位，
  // 这里用 proxyPurple / proxyGreen / error —— 都是已存在的 token。
  actMetrics: { flexDirection: "row", gap: 10, marginTop: 12 },
  actMetricCell: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flex: 1, gap: 3, paddingVertical: 14 },
  actMetricValue: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, lineHeight: 28 },
  actMetricLabel: { color: color.muted, fontSize: 11, fontWeight: "600" },
  actProgressHead: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between" },
  actProgressValue: { color: color.muted, fontSize: 13, fontWeight: "700" },
  actProgressTrack: { backgroundColor: color.surface, borderRadius: 99, height: 8, overflow: "hidden" },
  actProgressFill: { backgroundColor: color.magenta, borderRadius: 99, height: "100%" },
  actSectionLabel: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  actBenefit: { color: color.ink, fontSize: 14, lineHeight: 20 },
  actMetaGrid: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 },
  actMetaCell: { flex: 1, gap: 3 },
  actMetaLabel: { color: color.muted, fontSize: 11, fontWeight: "600" },
  actMetaValue: { color: color.ink, fontSize: 14, fontWeight: "800" },
  actionSectionLabel: { color: color.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginTop: 20 },
  actActionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  actActionTile: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 52, paddingHorizontal: 12, width: "48.5%" },
  actActionPrimary: { backgroundColor: color.lime, borderColor: color.lime },
  actActionText: { color: color.ink, flex: 1, fontSize: 14, fontWeight: "800" },
  actActionTextOff: { color: color.muted },
  actActionOff: { color: color.muted, fontSize: 11, fontWeight: "700" },
  actActionNote: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  // 推广面板（底部弹层）。和 merchant-promo 的 sheet 同一套形状。
  sheetBackdrop: { backgroundColor: "rgba(23,19,31,0.45)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 4, padding: 20, paddingBottom: 34 },
  sheetTitle: { color: color.ink, fontSize: 17, fontWeight: "900", marginBottom: 8 },
  sheetRow: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 52 },
  sheetRowText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  sheetHint: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  sheetClose: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, justifyContent: "center", marginTop: 16, minHeight: 48 },
  sheetCloseText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  qrBig: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginVertical: 16, padding: 14 },
  // MERCHANT-CREATOR-CONTENT-001：生产内容页的形状取自设计稿
  // Proxy_Creator_Promo_20261004_bc214e.html 的 .dash-grid / .collab-card /
  // .reason-line / .code-stats / .discount-status（结构保留我那一版的内容邀约，
  // 视觉换成这份稿子的）。颜色仍全部走 R3 token —— 稿子里的
  // #f9f9fb / #eaeaea / #d0f55c / #34C759 分别对到 surface / line / lime /
  // proxyGreen，不把 hex 抄进来（token-as-value 门禁 + DESIGN-CLEANUP-001）。
  dashGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
  dashItem: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, gap: 4, paddingVertical: 16, width: "48.5%" },
  dashValue: { color: color.ink, fontSize: 22, fontWeight: "800", letterSpacing: -0.5, lineHeight: 28 },
  dashLabel: { color: color.muted, fontSize: 12, fontWeight: "500" },
  collabCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, gap: 12, marginTop: 12, padding: 16, ...shadows.card },
  collabHeader: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  collabTitle: { color: color.ink, flex: 1, fontSize: 15, fontWeight: "800", minWidth: 0 },
  discountStatus: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  discountStatusOn: { backgroundColor: color.proxyGreenSoft },
  discountStatusWait: { backgroundColor: color.stateWarnBg },
  discountStatusText: { fontSize: 11, fontWeight: "700" },
  discountStatusTextOn: { color: color.proxyGreen },
  discountStatusTextWait: { color: color.warnBannerText },
  reasonLine: { alignItems: "center", backgroundColor: color.surface, borderRadius: 10, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  reasonDot: { backgroundColor: color.proxyGreen, borderRadius: 999, height: 4, width: 4 },
  reasonText: { color: color.muted, flex: 1, fontSize: 11, fontWeight: "600", minWidth: 0 },
  codeStats: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", paddingTop: 12 },
  codeStatItem: { alignItems: "center", flex: 1, gap: 3, paddingVertical: 4 },
  codeStatValue: { color: color.ink, fontSize: 13, fontWeight: "800", textAlign: "center" },
  codeStatValueOk: { color: color.proxyGreen },
  codeStatValueWait: { color: color.muted },
  codeStatLabel: { color: color.muted, fontSize: 11, fontWeight: "500" },
  searchHint: { color: color.muted, flex: 1, fontSize: 13, lineHeight: 18 },
  progress: { backgroundColor: "#F2EDF5", borderColor: color.line, borderRadius: 99, borderWidth: 1, height: 9, marginTop: 10, overflow: "hidden" },
  progressFill: { backgroundColor: color.magenta, borderRadius: 99, height: 9 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  chipText: { color: "#62596B", fontSize: 11, fontWeight: "700" },
  primary: { backgroundColor: color.lime, borderRadius: 12, flex: 1, paddingVertical: 12 },
  primaryText: { color: color.ink, fontSize: 14, fontWeight: "900", textAlign: "center" },
  secondary: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 12 },
  secondaryText: { color: color.ink, fontSize: 14, fontWeight: "800", textAlign: "center" },
  tile: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, marginVertical: 4, ...shadows.card, gap: 4 },
  tileTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  tileMeta: { color: color.muted, fontSize: 11 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tileSmall: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexBasis: "48%", padding: 12, ...shadows.card, gap: 2 },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  module: { alignItems: "center", aspectRatio: 1, backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, justifyContent: "center", padding: 14, width: "48.5%", ...shadows.card },
  iconBox: { alignItems: "center", borderRadius: 16, height: 56, justifyContent: "center", marginBottom: 9, width: 56 },
  iconBoxLime: { backgroundColor: color.lime },
  moduleMeta: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15, marginTop: 6, textAlign: "center", width: "100%" },
  proxyWide: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 10, minHeight: 78, padding: 11, ...shadows.card },
  proxyLogo: { borderRadius: 16, height: 56, width: 56 },
  chev: { color: "#756B80", fontSize: 24 },
  today: { backgroundColor: color.deep, borderRadius: 24, marginTop: 14, padding: 15 },
  todayHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  todayHint: { color: "#BEB6C8", fontSize: 11, fontWeight: "700" },
  todo: { alignItems: "center", borderTopColor: "#393246", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, minHeight: 55 },
  todoIcon: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  todoTitle: { color: color.white, fontSize: 13, fontWeight: "800" },
  todoMeta: { color: "#BEB6C8", fontSize: 11, marginTop: 2 },
  todoChev: { color: "#BEB6C8", fontSize: 22 },
  kpis: { flexDirection: "row", gap: 7, marginTop: 10 },
  kpi: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flex: 1, height: 68, justifyContent: "center", paddingHorizontal: 3 },
  kpiValue: { color: color.ink, fontSize: 14, fontWeight: "900", lineHeight: 20 },
  caption: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  pageSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  tabs: { gap: 7, paddingVertical: 14 },
  tab: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, height: 36, justifyContent: "center", paddingHorizontal: 13 },
  tabOn: { backgroundColor: color.ink, borderColor: color.ink },
  tabText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  tabTextOn: { color: color.white },
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, minHeight: 142, padding: 13, width: "48.5%" },
  goalIcon: { alignItems: "center", backgroundColor: color.lime, borderRadius: 14, height: 44, justifyContent: "center", marginBottom: 10, width: 44 },
  search: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 48, paddingHorizontal: 12 },
  searchInput: { color: color.ink, flex: 1, fontSize: 14, paddingVertical: 0 },
  subtleButton: { marginTop: 16, paddingVertical: 10 },
  subtleButtonText: { color: color.muted, fontSize: 12, textAlign: "center" },
  subtleButtonDanger: { marginTop: 4, paddingVertical: 10 },
  subtleButtonDangerText: { color: "#a32020", fontSize: 12, textAlign: "center" },
});

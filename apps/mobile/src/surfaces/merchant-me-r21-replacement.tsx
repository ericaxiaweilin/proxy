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

import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
// ACTIVITY-COVER-001：与横滑卡 / 门店相册同一套图片渲染。
import { Image } from "expo-image";
import { color, Gradient, shadows } from "../theme";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import type { BusinessClient } from "../business-client";
import type { FulfillmentClient } from "../fulfillment-client";
import type { ProfileClient } from "../profile-client";
// STORE-CONSOLIDATE-001：店详情页改走统一 hub（和 me.tsx 的 bdash/线上店铺同一页）。
import { MyStoresHub } from "./my-stores-hub";
import type { SupplyClient, SupplierCandidate, AgentPassport } from "../supply-client";
import { MerchantStorefrontSurface } from "./merchant-storefront";
import { MerchantCreatorRecommendations, resolveCreatorPhoto } from "./merchant-creator-recommendations";
// CREATOR-SOCIAL-001：社媒 canonical 链接与平台中文名（和服务端封闭集合对齐）。
import { socialPlatformLabel, socialProfileUrl } from "../supply-client";
import { localApiBaseUrl } from "../native-clients";
// ACTIVITY-COVER-001：活动封面 thumb URL 走共享 helper。
import { activityCoverUri } from "../media-thumb-url";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";
import { ProxyBackGlyph, ProxyEmptyState, ProxyLoading } from "../components/proxy-foundation";

type MerchantPage =
  | "root"
  | "creator"
  | "creatorDetail"
  | "voucher"
  | "voucherDetail"
  | "activity"
  | "activityDetail"
  | "store"
  | "sales"
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
type ActivityItem = Pick<Activity, "activityId" | "title" | "time" | "people" | "priceLabel" | "venueName" | "joined" | "capacity" | "status" | "realitySceneId" | "coverMediaAssetId" | "coverImageUrl">;

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

function detailHead({ onBack, title }: { onBack: () => void; title: string }): React.JSX.Element {
  return (
    <View style={styles.detailHead}>
      <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.subPageBack}>
        <ProxyBackGlyph />
      </Pressable>
      <Text selectable style={styles.detailTitle}>{title}</Text>
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
}: {
  business?: BusinessClient | undefined;
  supply?: SupplyClient | undefined;
  activities?: ActivityClient | undefined;
  viewerAccountId?: string | undefined;
  onOpenVouchers: () => void;
  onOpenSwitcher: () => void;
  onSignOut: () => void;
  // CREATOR-HOME-001：列表点头像进帖文主页（OtherProfileSurface）。
  onOpenCreatorProfile?: ((userId: string, name: string, avatarUri?: string | undefined) => void) | undefined;
  // STORE-CONSOLIDATE-001：店详情页改走统一 hub，需要 hub 的三个客户端。
  // me.tsx 里 bdash 那一路就是这么传的，这里照抄。
  fulfillment?: FulfillmentClient | undefined;
  profile?: ProfileClient | undefined;
  onOpenStoreCreate?: (() => void) | undefined;
}): React.JSX.Element {
  const [page, setPage] = useState<MerchantPage>("root");
  const [accounts, setAccounts] = useState<Account[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activeAccountId, setActiveAccountId] = useState<string | undefined>(undefined);
  const [members, setMembers] = useState<MemberDirectory[]>([]);
  const [spendDays, setSpendDays] = useState<SpendDaily[]>([]);
  const [spendTotal, setSpendTotal] = useState<{ totalOrders: number; totalGrossMinor: number }>({ totalOrders: 0, totalGrossMinor: 0 });
  const [creators, setCreators] = useState<SupplierCandidate[]>([]);
  const [selectedCreator, setSelectedCreator] = useState<SupplierCandidate | undefined>(undefined);
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
  const [sceneDetail, setSceneDetail] = useState<SceneBrief | undefined>(undefined);
  const [sceneActivities, setSceneActivities] = useState<ActivityItem[]>([]);
  const [creatorView, setCreatorView] = useState<"MATCH" | "CREATORS" | "COLLABS" | "RESULTS">("MATCH");
  const [creatorQuery, setCreatorQuery] = useState("");

  const refresh = useCallback(async (accountId: string) => {
    if (!business) return;
    try {
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
        if (list[0]) {
          setActiveAccountId(list[0].id);
          await refresh(list[0].id);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activities) return;
      try {
        const { created: list } = await activities.listMyActivities();
        if (!cancelled) {
          const items = list.map((entry) => ({ activityId: entry.activityId, title: entry.title, time: entry.time, people: entry.people, priceLabel: entry.priceLabel, venueName: entry.venueName, joined: entry.joined, capacity: entry.capacity, status: entry.status, realitySceneId: entry.realitySceneId })).slice(0, 25);
          setActivityItems(items);
          if (items[0]) setSelectedActivity(items[0]);
        }
      } catch (e) {
        if (!cancelled) setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => { cancelled = true; };
  }, [activities]);

  // R27 merchant scene ops: flagship scene projection (public) + scene
  // activities (public list, filtered by realitySceneId). No mock KPIs.
  useEffect(() => {
    let cancelled = false;
    void fetch(`${localApiBaseUrl.replace(/\/$/, "")}/v1/scenes/threebeans`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((body) => {
        if (cancelled || !body || typeof body !== "object") return;
        const d = body as Record<string, unknown>;
        const live = d.liveState as { label?: unknown; state?: unknown; bestWindow?: unknown } | undefined;
        const menu = Array.isArray(d.menu) ? (d.menu as Array<Record<string, unknown>>) : [];
        const humans = Array.isArray(d.humans) ? (d.humans as Array<Record<string, unknown>>) : [];
        setSceneDetail({
          sceneId: String(d.sceneId ?? "threebeans"),
          name: String(d.venueName ?? "Three Beans · Cầu Giấy"),
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
    if (!activities) return () => { cancelled = true; };
    void activities.listActivities()
      .then((list) => {
        if (cancelled) return;
        setSceneActivities(list.map((entry) => ({
          activityId: entry.activityId, title: entry.title, time: entry.time,
          people: entry.people, priceLabel: entry.priceLabel, venueName: entry.venueName,
          joined: entry.joined, capacity: entry.capacity, status: entry.status,
          realitySceneId: entry.realitySceneId,
        })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activities]);

  if (page === "creator") {
    const visibleCreators = creators.filter((creator) => `${creator.name} ${creator.serviceType} ${creator.languages.join(" ")}`.toLowerCase().includes(creatorQuery.trim().toLowerCase()));
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "Creator 经营" })}
          <Text selectable style={styles.pageSub}>围绕真实经营目标匹配、邀请，并追踪到店与消费结果。</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{([['MATCH','智能匹配'],['CREATORS','Creator'],['COLLABS','合作'],['RESULTS','结果']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setCreatorView(id)} style={[styles.tab, creatorView === id && styles.tabOn]}><Text selectable style={[styles.tabText, creatorView === id && styles.tabTextOn]}>{label}</Text></Pressable>)}</ScrollView>
          {creatorView === "MATCH" ? <><View style={styles.goalGrid}>{([['storefront','带来到店新客','到店、带客、核销'],['target','生产内容','探店、短视频、UGC'],['arrowUpRight','扩大本地曝光','覆盖与互动'],['ticket','推广券与活动','领取、预约、核销']] as const).map(([icon,title,hint]) => <View key={title} style={styles.goalCard}><View style={styles.goalIcon}><ProxyIcon color={color.ink} name={icon} size={23} /></View><Text selectable style={styles.cardTitle}>{title}</Text><Text selectable style={styles.caption}>{hint}</Text></View>)}</View>{sectionHead("最佳匹配", `${creators.length} 位符合条件`)}</> : null}
          {creatorView === "CREATORS" ? <><View style={styles.search}><ProxyIcon color={color.muted} name="search" size={18} /><TextInput onChangeText={setCreatorQuery} placeholder="搜索 Creator、能力或语言" placeholderTextColor={color.muted} style={styles.searchInput} value={creatorQuery} /></View>{sectionHead("Creator 人才库", `${visibleCreators.length} 位`)}</> : null}
          {creatorView === "COLLABS" ? <>{sectionHead("合作状态", "来自真实邀请与合作记录")}<SimpleRows rows={[["待回复", "等待合作邀请数据"], ["进行中", "等待履约数据"], ["已完成", "等待完成记录"]]} /></> : null}
          {creatorView === "RESULTS" ? <>{summary({ title: "Creator 贡献", meta: "近 30 天 · 真实归因", stats: [["—","归因收入"],["—","券核销"],["—","新客"],["—","完成合作"]] })}</> : null}
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
              </Pressable>
              <View style={styles.flex}>
              <Text selectable style={styles.cardTitle}>{creator.name}</Text>
              <Text selectable style={styles.meta}>
                {creator.serviceType} · {creator.languages.join(" / ") || "—"} ·{" "}
                {creator.eligibility.eligible ? "✓ 可邀请" : "✗ 不符合资格"}
              </Text>
              <Text selectable style={styles.meta}>
                {creator.referencePrice} {creator.currency} · 到店 {creator.photos.length} 媒体
              </Text>
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
    const verifiedCaps = creatorPassport?.capabilities.filter((c) => c.verified) ?? [];
    const upcoming = (creatorPassport?.availability ?? []).filter((w) => w.endAt >= new Date().toISOString().slice(0, 10)).slice(0, 3);
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
              <Text selectable style={styles.cardTitle}>{selectedCreator.name}</Text>
              {(creatorPassport?.profile.bio.trim() || "") !== "" ? (
                <Text selectable style={styles.meta}>{creatorPassport?.profile.bio}</Text>
              ) : null}
              <Text selectable style={styles.meta}>
                {selectedCreator.serviceType} · {(selectedCreator.languages.length ? selectedCreator.languages : creatorPassport?.profile.languages ?? []).join(" / ") || "—"} ·{" "}
                {selectedCreator.eligibility.eligible ? "✓ 可邀请" : "✗ 不符合资格"}
              </Text>
              <Text selectable style={styles.meta}>
                {selectedCreator.referencePrice} {selectedCreator.currency}
              </Text>
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
                <View key={c.capability} style={styles.capChip}>
                  <Text selectable style={styles.capText}>{c.capability}{c.verified ? " ✓" : ""}</Text>
                </View>
              ))}
            </View>
          </>) : null}
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
                    <Text selectable style={styles.socialText}>{socialPlatformLabel(item.platform)} · {item.handle}</Text>
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
            meta: selectedCreator.eligibility.eligible ? "可邀请" : "暂不可邀请",
            stats: [
              [selectedCreator.photos.length.toString(), "到店"],
              [verifiedCaps.length > 0 ? verifiedCaps.length.toString() : "—", "已验证能力"],
              [selectedCreator.serviceType, "服务"],
              [selectedCreator.referencePrice.toString(), "报价"],
            ],
            title: `${selectedCreator.name} · ${selectedCreator.serviceType}`,
          })}
          <SimpleRows onPress={setPage} rows={[["最近到店", "等待真实履约记录"], ["当前权益", "查看关联券", "voucher"], ["当前邀请", "查看活动与邀请", "activity"], ["合作结果", "查看销售归因", "sales"]]} />
          <View style={styles.actions}>
            {/* 诚实文案：这里只是进活动列表看报名，真定向邀请（指定 Creator
                进指定场次）需要房主场景 + 邀请命令，链路未接前不挂邀请字样。 */}
            <Pressable onPress={() => setPage("activity")} style={styles.primary} accessibilityLabel="查看活动报名"><Text selectable style={styles.primaryText}>查看活动报名</Text></Pressable>
            <Pressable onPress={() => { setCreatorView("COLLABS"); setPage("creator"); }} style={styles.secondary}><Text selectable style={styles.secondaryText}>查看记录</Text></Pressable>
          </View>
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
          {summary({ title: `${accounts?.[0]?.name ?? "商家"} · 权益`, meta: "可核验、可追溯", stats: [["—", "进行中"], ["—", "已领取"], ["—", "已核销"], ["—", "到店"]] })}
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
            <ProxyEmptyState title="暂无开放活动" sub="创建的活动会在这里进入报名、执行与复盘流程。" />
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

  if (page === "activityDetail" && selectedActivity) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("activity"), title: selectedActivity.title })}
          {summary({
            meta: `${selectedActivity.time} · ${selectedActivity.venueName}`,
            stats: [
              [selectedActivity.people || "—", "人数"],
              [selectedActivity.joined.toString(), "已报名"],
              [selectedActivity.capacity?.toString() ?? "—", "容量"],
              [selectedActivity.priceLabel, "费用"],
            ],
            title: selectedActivity.title,
          })}
          <SimpleRows onPress={setPage} rows={[["已锁定 Creator", `${creators.length} 位当前可匹配`, "creator"], ["定向券", "查看活动关联权益", "voucher"], ["结果", "等待真实归因数据", "sales"]]} />
          <View style={styles.actions}>
            <Pressable onPress={() => setPage("creator")} style={styles.primary}><Text selectable style={styles.primaryText}>继续补位</Text></Pressable>
            <Pressable onPress={() => setPage("sales")} style={styles.secondary}><Text selectable style={styles.secondaryText}>查看结果</Text></Pressable>
          </View>
        </ScrollView>
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
    const sceneActs = sceneActivities.filter((a) => a.realitySceneId === "threebeans");
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
            title: sceneDetail?.name ?? "Three Beans · Cầu Giấy",
          })}
          <SimpleRows onPress={setPage} rows={[["活动导流", `${sceneActs.length} 个本场景活动`, "activity"], ["菜单与价格", "进线上店铺管理", "store"], ["销售结果", `${spendTotal.totalOrders} 个订单`, "sales"]]} />
          {sectionHead("本场景活动", "realitySceneId = threebeans")}
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
          <Text selectable style={styles.cardTitle}>状态：{accounts?.[0]?.status ?? "待获取"}</Text>
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
          {summary({ title: `${accounts?.[0]?.name ?? "商家"} · Proxy`, meta: "平台关系", stats: [["—", "未读通知"], ["—", "开放能力"], [accounts?.[0]?.status ?? "—", "接入"], [members.length.toString(), "成员"]] })}
          <SimpleRows onPress={setPage} rows={[["平台通知", "订单、活动与系统消息", "proxy-notices"], ["政策与规则", "Creator · 券 · 活动 · 内容", "proxy-policy"], ["认证与资格", accounts?.[0]?.status ?? "待获取", "proxy-verify"], ["成员与权限", `${members.length} 位成员`, "ops"], ["平台结算", "合作、券成本与活动支出", "sales"], ["接入与连接", "店铺 · QR · 核销 · 数据同步", "store"], ["支持与申诉", "查看处理中问题", "proxy-support"]]} />
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
        {error ? <View style={styles.card}><Text selectable style={styles.empty}>加载失败：{error}</Text></View> : null}

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
                  onPress={() => { if (!on) { setActiveAccountId(a.id); void refresh(a.id); } }}
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
            <Text selectable style={styles.bizAvatarText}>{(accounts?.[0]?.name.trim().slice(0, 1) || "店").toUpperCase()}</Text>
          </Gradient>
          <View style={styles.rowCopy}>
            <Text selectable style={styles.cardTitle}>{accounts?.[0]?.name ?? "还没有店铺"}</Text>
            <Text selectable style={styles.meta}>{accounts?.[0] ? `${accounts?.[0]?.status ?? ""} · ${members.length} 经营人员` : "创建后解锁相册 · 信息 · 成员 · 数据"}</Text>
          </View>
          <View style={styles.storeButton}>
            <Text selectable style={styles.storeButtonText}>{accounts?.[0] ? "查看店铺" : "创建店铺"}</Text>
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
            ["target", "Creator 经营", `${creators.length} 位可邀请 Creator`, true, "creator"],
            ["ticket", "客户 / 券", `${members.length} 位经营人员`, false, "voucher"],
            ["arrowUpRight", "活动导流", `${activityItems.length} 个开放活动`, false, "activity"],
            ["storeLines", "线上店铺", accounts?.[0]?.status ?? "查看店铺", true, "store"],
            ["cup", "场景运营", "Three Beans · 实况", true, "scene"],
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
  creatorHero: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, marginVertical: 4, padding: 12 },
  creatorHeroAvatar: { backgroundColor: color.surface, borderRadius: 999, height: 58, width: 58 },
  creatorHeroAvatarMissing: { alignItems: "center", backgroundColor: color.surface, borderRadius: 999, height: 58, justifyContent: "center", width: 58 },
  creatorHeroInitial: { color: color.muted, fontSize: 20, fontWeight: "900" },
  secHead: { marginTop: 12 },
  secTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  capChip: { backgroundColor: "#F1FFD0", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  capText: { color: "#4D6200", fontSize: 11, fontWeight: "800" },
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
  creatorRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, marginVertical: 4, padding: 12, ...shadows.card },
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

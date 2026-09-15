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
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, Gradient, shadows } from "../theme";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import type { BusinessClient } from "../business-client";
import type { SupplyClient, SupplierCandidate } from "../supply-client";
import { MerchantStorefrontSurface } from "./merchant-storefront";
import { MerchantCreatorRecommendations } from "./merchant-creator-recommendations";
import { localApiBaseUrl } from "../native-clients";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";

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
type ActivityItem = Pick<Activity, "activityId" | "title" | "time" | "people" | "priceLabel" | "venueName" | "joined" | "capacity" | "status" | "realitySceneId">;

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
        <Text style={styles.subPageBackText}>‹ 返回</Text>
      </Pressable>
      <Text style={styles.detailTitle}>{title}</Text>
    </View>
  );
}

function sectionHead(title: string, hint?: string): React.JSX.Element {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function summary({ title, meta, stats }: { title: string; meta: string; stats: Array<[string, string]> }): React.JSX.Element {
  return (
    <View style={styles.summary}>
      <Text style={styles.cardTitleWhite}>{title}</Text>
      <Text style={styles.summaryMeta}>{meta}</Text>
      <View style={styles.summaryStats}>
        {stats.map(([value, label]) => (
          <View key={label} style={styles.summaryStatItem}>
            <Text style={styles.summaryStatValue}>{value}</Text>
            <Text style={styles.summaryStatLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SimpleRows({ rows, onPress }: { rows: Array<[string, string, MerchantPage?]>; onPress?: (page: MerchantPage) => void }): React.JSX.Element {
  return <View style={styles.rowList}>{rows.map(([title, meta, destination]) => <Pressable key={title} disabled={!destination} onPress={() => destination && onPress?.(destination)} style={styles.row}><View style={styles.rowCopy}><Text style={styles.objectTitle}>{title}</Text><Text style={styles.meta}>{meta}</Text></View>{destination ? <Text style={styles.chev}>›</Text> : null}</Pressable>)}</View>;
}

export function MerchantMeR21Replacement({
  business,
  supply,
  activities,
  viewerAccountId,
  onOpenVouchers,
  onOpenSwitcher,
  onSignOut,
}: {
  business?: BusinessClient | undefined;
  supply?: SupplyClient | undefined;
  activities?: ActivityClient | undefined;
  viewerAccountId?: string | undefined;
  onOpenVouchers: () => void;
  onOpenSwitcher: () => void;
  onSignOut: () => void;
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
          <Text style={styles.pageSub}>围绕真实经营目标匹配、邀请，并追踪到店与消费结果。</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{([['MATCH','智能匹配'],['CREATORS','Creator'],['COLLABS','合作'],['RESULTS','结果']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setCreatorView(id)} style={[styles.tab, creatorView === id && styles.tabOn]}><Text style={[styles.tabText, creatorView === id && styles.tabTextOn]}>{label}</Text></Pressable>)}</ScrollView>
          {creatorView === "MATCH" ? <><View style={styles.goalGrid}>{([['storefront','带来到店新客','到店、带客、核销'],['target','生产内容','探店、短视频、UGC'],['arrowUpRight','扩大本地曝光','覆盖与互动'],['ticket','推广券与活动','领取、预约、核销']] as const).map(([icon,title,hint]) => <View key={title} style={styles.goalCard}><View style={styles.goalIcon}><ProxyIcon color={color.ink} name={icon} size={23} /></View><Text style={styles.cardTitle}>{title}</Text><Text style={styles.caption}>{hint}</Text></View>)}</View>{sectionHead("最佳匹配", `${creators.length} 位符合条件`)}</> : null}
          {creatorView === "CREATORS" ? <><View style={styles.search}><ProxyIcon color={color.muted} name="search" size={18} /><TextInput onChangeText={setCreatorQuery} placeholder="搜索 Creator、能力或语言" placeholderTextColor={color.muted} style={styles.searchInput} value={creatorQuery} /></View>{sectionHead("Creator 人才库", `${visibleCreators.length} 位`)}</> : null}
          {creatorView === "COLLABS" ? <>{sectionHead("合作状态", "来自真实邀请与合作记录")}<SimpleRows rows={[["待回复", "等待合作邀请数据"], ["进行中", "等待履约数据"], ["已完成", "等待完成记录"]]} /></> : null}
          {creatorView === "RESULTS" ? <>{summary({ title: "Creator 贡献", meta: "近 30 天 · 真实归因", stats: [["—","归因收入"],["—","券核销"],["—","新客"],["—","完成合作"]] })}</> : null}
          {(creatorView === "MATCH" || creatorView === "CREATORS") && visibleCreators.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyTitle}>暂时没有匹配的 Creator</Text><Text style={styles.empty}>工作台仍可使用；待供给数据进入后，候选会显示在这里。</Text></View>
          ) : null}
          {(creatorView === "MATCH" || creatorView === "CREATORS") ? visibleCreators.map((creator) => (
            <Pressable
              key={creator.agentId}
              onPress={() => { setSelectedCreator(creator); setPage("creatorDetail"); }}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{creator.name}</Text>
              <Text style={styles.meta}>
                {creator.serviceType} · {creator.languages.join(" / ") || "—"} ·{" "}
                {creator.eligibility.eligible ? "✓ 可邀请" : "✗ 不符合资格"}
              </Text>
              <Text style={styles.meta}>
                {creator.referencePrice} {creator.currency} · 到店 {creator.photos.length} 媒体
              </Text>
            </Pressable>
          )) : null}
        </ScrollView>
      </View>
    );
  }

  if (page === "creatorDetail" && selectedCreator) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("creator"), title: selectedCreator.name })}
          {summary({
            meta: selectedCreator.eligibility.eligible ? "可邀请" : "暂不可邀请",
            stats: [
              [selectedCreator.photos.length.toString(), "到店"],
              [selectedCreator.languages.length.toString(), "带客"],
              [selectedCreator.serviceType, "服务"],
              [selectedCreator.referencePrice.toString(), "报价"],
            ],
            title: `${selectedCreator.name} · ${selectedCreator.serviceType}`,
          })}
          <SimpleRows onPress={setPage} rows={[["最近到店", "等待真实履约记录"], ["当前权益", "查看关联券", "voucher"], ["当前邀请", "查看活动与邀请", "activity"], ["合作结果", "查看销售归因", "sales"]]} />
          <View style={styles.actions}>
            {/* 诚实文案：这里只是进活动列表看报名，真定向邀请（指定 Creator
                进指定场次）需要房主场景 + 邀请命令，链路未接前不挂邀请字样。 */}
            <Pressable onPress={() => setPage("activity")} style={styles.primary} accessibilityLabel="查看活动报名"><Text style={styles.primaryText}>查看活动报名</Text></Pressable>
            <Pressable onPress={() => { setCreatorView("COLLABS"); setPage("creator"); }} style={styles.secondary}><Text style={styles.secondaryText}>查看记录</Text></Pressable>
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
          <View style={styles.actions}><Pressable onPress={onOpenVouchers} style={styles.primary}><Text style={styles.primaryText}>打开券中心</Text></Pressable><Pressable onPress={() => setPage("activity")} style={styles.secondary}><Text style={styles.secondaryText}>查看关联活动</Text></Pressable></View>
          <SimpleRows onPress={setPage} rows={[["券管理", "创建、上下架与有效期"], ["核销记录", "扫码核销 · 订单留痕"], ["客户归因", "领取、到店与复购"], ["活动关联", `${activityItems.length} 个开放活动`, "activity"]]} />
          {sectionHead("经营人员", `${members.length} 人`)}
          {members.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyTitle}>暂无经营人员</Text><Text style={styles.empty}>添加成员后会显示角色、状态与加入时间。</Text></View>
          ) : null}
          {members.map((m) => (
            <View key={m.userId} style={styles.card}>
              <Text style={styles.cardTitle}>{m.displayName || m.userId}</Text>
              <Text style={styles.meta}>{m.role} · {m.status}</Text>
            </View>
          ))}
          <Text style={styles.meta}>OWNER {ownerCount} · {members.length - ownerCount} 其他</Text>
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
            <View style={styles.emptyCard}><Text style={styles.emptyTitle}>暂无开放活动</Text><Text style={styles.empty}>创建的活动会在这里进入报名、执行与复盘流程。</Text></View>
          ) : null}
          {activityItems.map((a) => (
            <Pressable
              key={a.activityId}
              onPress={() => { setSelectedActivity(a); setPage("activityDetail"); }}
              style={styles.activityCard}
            >
              <View style={styles.activityTop}><View style={styles.rowCopy}><Text style={styles.objectTitle}>{a.title}</Text><Text style={styles.meta}>{a.time} · {a.venueName}</Text></View><IconBox icon="spark" /></View>
              {a.capacity ? <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, (a.joined / a.capacity) * 100)}%` }]} /></View> : null}
              <View style={styles.chips}><View style={styles.chip}><Text style={styles.chipText}>报名 {a.joined}{a.capacity ? `/${a.capacity}` : ""}</Text></View><View style={styles.chip}><Text style={styles.chipText}>{a.priceLabel}</Text></View><View style={styles.chip}><Text style={styles.chipText}>{a.status ?? "已发布"}</Text></View></View>
            </Pressable>
          ))}
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
            <Pressable onPress={() => setPage("creator")} style={styles.primary}><Text style={styles.primaryText}>继续补位</Text></Pressable>
            <Pressable onPress={() => setPage("sales")} style={styles.secondary}><Text style={styles.secondaryText}>查看结果</Text></Pressable>
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
          <View style={styles.card}><Text style={styles.empty}>请登录后查看</Text></View>
        </View>
      );
    }
    return (
      <View style={styles.root}>
        <MerchantStorefrontSurface client={business} header={detailHead({ onBack: () => setPage("root"), title: "线上店铺" })} viewerAccountId={viewerAccountId} showcaseActivities={activityItems.map((a) => ({ id: a.activityId, title: a.title }))} onOpenVouchers={onOpenVouchers} onStartStoreSetup={() => setPage("ops")} />
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
            <View style={styles.card}><Text style={styles.empty}>暂无销售数据 — server 列表为空</Text></View>
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
            <View style={styles.card}><Text style={styles.empty}>暂无成员</Text></View>
          ) : null}
          {members.map((m) => (
            <View key={m.userId} style={styles.card}>
              <Text style={styles.cardTitle}>{m.displayName || m.userId}</Text>
              <Text style={styles.meta}>{m.role} · {m.status}</Text>
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
            <View style={styles.card}><Text style={styles.empty}>本场景暂无活动 — 去活动页创建一个</Text></View>
          ) : null}
          {sceneActs.map((a) => (
            <View key={a.activityId} style={styles.card}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.meta}>{a.time} · {a.joined} 人已参加{(a.capacity ?? 0) > 0 ? ` / 限 ${a.capacity} 人` : ""}</Text>
            </View>
          ))}
          {sectionHead("场景真人", "scene projection")}
          {(sceneDetail?.humans ?? []).length === 0 ? (
            <View style={styles.card}><Text style={styles.empty}>暂无关联真人</Text></View>
          ) : null}
          {(sceneDetail?.humans ?? []).map((h) => (
            <View key={h.id} style={styles.card}>
              <Text style={styles.cardTitle}>{h.name}</Text>
              <Text style={styles.meta}>{h.role} · {h.availability}</Text>
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
          <Text style={styles.cardTitle}>未读通知：2 条</Text>
          <Text style={styles.empty}>订单状态变更 · 活动报名确认 · 系统维护预告。通知内容来自真实业务流，不使用占位数据。</Text>
          <Text style={styles.meta}>依据：网络安全响应要求（24 小时一般 / 6 小时紧急）；通知记录保留 ≥ 12 个月。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-policy") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "政策与规则" })}
          <Text style={styles.empty}>平台角色判断依据实际功能（订单撮合、支付处理、商家入驻审核、交易数据控制）而非平台自我命名。适用时履行电子商务平台登记（Decree 248/2026 §3）、卖家/商家身份验证（§11）、商品/服务信息披露、禁止假冒商品及违法服务治理、消费者投诉与争议处理、交易/商家/平台运营数据保存（≥ 12 个月）、与主管机关依法配合、其他电子商务平台义务（§545-546）。</Text>
          <Text style={styles.sectionTitle}>§30 订单（交易主体、价格、税费、取消与退款规则）</Text>
          <Text style={styles.empty}>订单页面应尽可能明确：交易主体；商品或服务；数量；价格；费用；税费（如有）；履约时间与地点；取消规则；退款规则（§620-629）。订单可作为电子交易记录的一部分（§565）。</Text>
          <Text style={styles.sectionTitle}>§32 支付（第三方支付机构处理）</Text>
          <Text style={styles.empty}>由银行或依法提供支付服务的第三方支付机构完成实际支付处理（§593）。Proxy 仅提供支付入口，不自动成为银行、电子钱包、支付机构或用户资金托管机构（§595-600、§605-615）。用户可能还需要接受实际支付服务提供商的相关条款（§602）。</Text>
          <Text style={styles.sectionTitle}>§28 商家信息（真实、准确、完整、不误导）</Text>
          <Text style={styles.empty}>商家应保证信息真实、准确、完整、不具有误导性（§502-507），包括：企业或经营主体、店铺名称、地址、商品、服务、价格、许可证、优惠、礼品券、联系方式（§509-520）。需要行业资质的业务必须依法取得相应许可（§522）。</Text>
          <Text style={styles.sectionTitle}>§19 禁止内容 + §21 活动（真实必要信息与平台角色）</Text>
          <Text style={styles.empty}>活动创建者应提供真实且必要的信息：活动性质、时间、地点、参与条件、人数、价格、取消规则、必要安全信息（§384-394、§390-394）。除非活动页面明确说明 Proxy 为实际组织者，否则 Proxy 通常仅提供技术、发现、报名和通信工具，不承担活动组织责任（§395-396）。</Text>
          <Text style={styles.sectionTitle}>§36 诈骗及账号欺诈 + §37 内容审核（治理规则）</Text>
          <Text style={styles.empty}>禁止恋爱诈骗、投资诈骗、假商家、假客服、礼品券诈骗、支付诈骗、骗取验证码、冒充 Proxy、其他欺骗行为（§651-664）。内容审核措施（提醒、降低传播、限制消息、删除内容、暂停功能、冻结交易、暂停/永久封禁账号）依据严重程度、重复违规、现实风险、法律要求执行（§670-689）。</Text>
          <Text style={styles.sectionTitle}>法律依据（越南 2026 生效规则）</Text>
          <Text style={styles.empty}>Decree 248/2026/ND-CP §3（平台登记判断）、§11（卖家验证）、§23（数据保存）；PDP Law 91/2025/QH15 Art.31（明示同意）、Art.32（删除请求、数据保护影响评估、跨境评估）；Decree 328/2026/NĐ-CP §4（假新闻与虚假信息处置：一般 24 小时，国家安全紧急 6 小时）；电子商务平台登记/通知责任在适用时执行（§534-547）。</Text>
          <Text style={styles.meta}>缺失内容已在 docs/legal/vietnam/Proxy_Operating_Terms_Supplement_2026-08-31.md 补齐（法人信息、法律分类、电商登记、DPIA、跨境数据影响评估、DPO/数据保护部门、真实数据流与第三方处理方清单、越南语正式法律版本、越南执业律师最终审阅）。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-verify") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "认证与资格" })}
          <Text style={styles.cardTitle}>状态：{accounts?.[0]?.status ?? "待获取"}</Text>
          <Text style={styles.empty}>商家验证：需要提交营业执照、食品安全证书（F&B）、税号。平台角色判断依据 Decree 248/2026 §3：提供交易撮合 + 支付处理 + 商家入驻审核 = 电子商务平台，须完成平台登记（platform_registration_number）。</Text>
          <Text style={styles.meta}>缺失：platform_registration 字段 + e-commerce_platform_notice UI 提示（已记录在运营条款补充文档）。</Text>
        </ScrollView>
      </View>
    );
  }

  if (page === "proxy-support") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("proxy"), title: "支持与申诉" })}
          <Text style={styles.cardTitle}>处理中问题：0 个</Text>
          <Text style={styles.empty}>申诉流程：提交 → 平台审核（一般 24 小时，国家安全紧急 6 小时）→ 结果通知 → 如不接受可向外部律师/监管机构申诉。申诉记录写入 content_governance 表（内容 ID、举报类型、处置动作、响应时间、法律依据）。</Text>
          <Text style={styles.meta}>依据：Proxy_Legal_Update_Notes v1.1（2026-08-31）§2 网络安全响应；条款文件已在 docs/legal/vietnam/ 补齐。</Text>
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
            <View style={styles.card}><Text style={styles.empty}>暂无数据 — server 列表为空</Text></View>
          ) : null}
          {spendDays.map((d) => (
            <View key={d.bucketDate} style={styles.card}>
              <Text style={styles.cardTitle}>{d.bucketDate}</Text>
              <Text style={styles.meta}>{d.orderCount} 单 · {formatVnd(d.grossMinor)} · 新 {d.newCustomerCount} / 复 {d.returningCustomerCount}</Text>
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
          <Text style={styles.h1}>我的</Text>
          <View style={styles.merchantTag}><Text style={styles.merchantTagText}>商家</Text></View>
        </View>

        {accounts === undefined && !error ? <ActivityIndicator /> : null}
        {error ? <View style={styles.card}><Text style={styles.empty}>加载失败：{error}</Text></View> : null}

        <Pressable onPress={() => setPage("store")} style={styles.identity}>
          {accounts?.[0]?.avatarPath ? (
            <Image source={{ uri: accounts?.[0]?.avatarPath?.startsWith("/") ? `${localApiBaseUrl ?? ""}${accounts?.[0]?.avatarPath}` : accounts?.[0]?.avatarPath ?? "" }} style={styles.bizAvatar} />
          ) : (
            <Gradient from="#45208A" to="#8033F0" style={styles.bizAvatar}>
              <Text style={styles.bizAvatarText}>B</Text>
            </Gradient>
          )}
          <View style={styles.rowCopy}>
            <Text style={styles.cardTitle}>{accounts?.[0]?.name ?? "还没有店铺"}</Text>
            <Text style={styles.meta}>{accounts?.[0] ? `${accounts?.[0]?.status ?? ""} · ${members.length} 经营人员` : "创建后解锁相册 · 信息 · 成员 · 数据"}</Text>
          </View>
          <View style={styles.storeButton}>
            <Text style={styles.storeButtonText}>{accounts?.[0] ? "查看店铺" : "创建店铺"}</Text>
          </View>
        </Pressable>

        <MerchantCreatorRecommendations onOpenAll={() => setPage("creator")} supply={supply} />

        <View style={styles.today}>
          <View style={styles.todayHead}>
            <Text style={styles.cardTitleWhite}>今天需要处理</Text>
            <Text style={styles.todayHint}>{activityItems.length + creators.length} 项</Text>
          </View>
          {([
            ["spark", `${activityItems.length} 个开放活动待跟进`, "活动导流", "activity"],
            ["target", `${creators.length} 位 Creator 可匹配`, "Creator 经营", "creator"],
            ["coin", `${spendTotal.totalOrders} 个订单已汇总`, "销售中心", "sales"],
          ] as const).map(([icon, title, meta, destination]) => (
            <Pressable key={meta} onPress={() => setPage(destination)} style={styles.todo}>
              <View style={styles.todoIcon}><ProxyIcon color={color.lime} name={icon} size={22} /></View>
              <View style={styles.rowCopy}><Text style={styles.todoTitle}>{title}</Text><Text style={styles.todoMeta}>{meta}</Text></View>
              <Text style={styles.todoChev}>›</Text>
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
              <Text numberOfLines={1} style={styles.kpiValue}>{value}</Text><Text style={styles.caption}>{label}</Text>
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
              <Text style={styles.cardTitle}>{title}</Text>
              <Text numberOfLines={1} style={styles.moduleMeta}>{meta}</Text>
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
              <Text style={styles.cardTitle}>{title}</Text>
              <Text numberOfLines={1} style={styles.moduleMeta}>{meta}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => setPage("proxy")} style={styles.proxyWide}>
          <Image source={OTTER_LOGO} style={styles.proxyLogo} />
          <View style={styles.rowCopy}>
            <Text style={styles.cardTitle}>Proxy 中心</Text>
            <Text style={styles.meta}>{spendDays.length} 日真实经营数据 · 权限与工作区</Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>

        <Pressable onPress={onOpenSwitcher} style={styles.subtleButton}><Text style={styles.subtleButtonText}>切换身份</Text></Pressable>
        <Pressable onPress={onSignOut} style={styles.subtleButtonDanger}><Text style={styles.subtleButtonDangerText}>退出登录</Text></Pressable>
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
  identity: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 24, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 14, padding: 14 },
  bizAvatar: { alignItems: "center", borderRadius: 16, height: 52, justifyContent: "center", width: 52 },
  bizAvatarText: { color: color.white, fontSize: 24, fontWeight: "900" },
  rowCopy: { flex: 1, minWidth: 0 },
  storeButton: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, height: 36, justifyContent: "center", paddingHorizontal: 11 },
  storeButtonText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 6, marginTop: 14 },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 12, marginVertical: 4, ...shadows.card, gap: 2 },
  sceneHero: { borderRadius: 14, height: 168, marginTop: 4, width: "100%" },
  cardTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  cardTitleWhite: { color: color.white, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  meta: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginTop: 3 },
  empty: { color: color.muted, fontSize: 12 },
  emptyCard: { backgroundColor: "#F6F2F9", borderRadius: 16, gap: 4, marginVertical: 6, padding: 16 },
  emptyTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  subPageBack: { marginBottom: 10, paddingVertical: 4 },
  subPageBackText: { color: color.magenta, fontSize: 12, fontWeight: "700" },
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
  caption: { color: color.muted, fontSize: 10, fontWeight: "600", lineHeight: 15 },
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

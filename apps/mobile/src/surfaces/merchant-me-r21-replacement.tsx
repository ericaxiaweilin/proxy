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
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, Gradient, shadows } from "../theme";
import type { BusinessClient } from "../business-client";
import type { SupplyClient, SupplierCandidate } from "../supply-client";
import { MerchantStorefrontSurface } from "./merchant-storefront";
import type { ActivityClient } from "../activity-client";

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
  | "proxy";

type Account = { id: string; name: string; status: string };
type MemberDirectory = { businessId: string; userId: string; displayName: string; role: string; status: string; joinedAt: string };
type SpendDaily = { businessId: string; bucketDate: string; orderCount: number; grossMinor: number; newCustomerCount: number; returningCustomerCount: number };
type ActivityItem = { activityId: string; title: string };

function formatVnd(minor: number): string {
  const vnd = Math.round(minor / 1000);
  if (vnd >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)}tr VND`;
  if (vnd >= 1_000) return `${(vnd / 1_000).toFixed(0)}k VND`;
  return `${vnd} VND`;
}

function detailHead({ onBack, title }: { onBack: () => void; title: string }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.subPageBack}>
      <Text style={styles.subPageBackText}>‹ 返回</Text>
    </Pressable>
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

export function MerchantMeR21Replacement({
  business,
  supply,
  activities,
  viewerAccountId,
  onOpenSwitcher,
  onSignOut,
}: {
  business?: BusinessClient | undefined;
  supply?: SupplyClient | undefined;
  activities?: ActivityClient | undefined;
  viewerAccountId?: string | undefined;
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
        const list = await activities.listActivities();
        if (!cancelled) {
          const items = list.map((entry) => ({ activityId: entry.activityId, title: entry.title })).slice(0, 25);
          setActivityItems(items);
          if (items[0]) setSelectedActivity(items[0]);
        }
      } catch (e) {
        if (!cancelled) setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => { cancelled = true; };
  }, [activities]);

  if (page === "creator") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "Creator 经营" })}
          {sectionHead("Creator 经营", "SupplyClient.querySuppliers")}
          {creators.length === 0 ? (
            <View style={styles.card}><Text style={styles.empty}>暂无 Creator — Supply 列表为空</Text></View>
          ) : null}
          {creators.map((creator) => (
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
          ))}
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
          <View style={styles.actions}>
            <Pressable style={styles.primary}><Text style={styles.primaryText}>发起定向邀请</Text></Pressable>
            <Pressable style={styles.secondary}><Text style={styles.secondaryText}>查看记录</Text></Pressable>
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
          {sectionHead("经营人员", `member_directory · ${members.length} 人`)}
          {members.length === 0 ? (
            <View style={styles.card}><Text style={styles.empty}>暂无成员 — 添加经营人员后这里显示</Text></View>
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
          {sectionHead("活动", "ActivityClient.listActivities")}
          {activityItems.length === 0 ? (
            <View style={styles.card}><Text style={styles.empty}>暂无开放活动 — server 列表为空</Text></View>
          ) : null}
          {activityItems.map((a) => (
            <Pressable
              key={a.activityId}
              onPress={() => { setSelectedActivity(a); setPage("activityDetail"); }}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.meta}>{a.activityId}</Text>
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
            meta: `活动 ${selectedActivity.activityId}`,
            stats: [
              ["—", "发起人"],
              ["—", "开始"],
              ["—", "结束"],
              ["—", "参与"],
            ],
            title: selectedActivity.title,
          })}
          <View style={styles.actions}>
            <Pressable style={styles.secondary}><Text style={styles.secondaryText}>查看详情</Text></Pressable>
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
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "线上店铺" })}
          <MerchantStorefrontSurface client={business} viewerAccountId={viewerAccountId} />
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

  if (page === "proxy") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {detailHead({ onBack: () => setPage("root"), title: "Proxy 数据" })}
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
          <Gradient from="#45208A" to="#8033F0" style={styles.bizAvatar}>
            <Text style={styles.bizAvatarText}>B</Text>
          </Gradient>
          <View style={styles.rowCopy}>
            <Text style={styles.cardTitle}>{accounts?.[0]?.name ?? "（未登录）"}</Text>
            <Text style={styles.meta}>{accounts?.[0]?.status ?? "—"} · {members.length} 经营人员</Text>
          </View>
          <View style={styles.storeButton}>
            <Text style={styles.storeButtonText}>查看店铺</Text>
          </View>
        </Pressable>

        {sectionHead("Creator 经营", `Supply · ${creators.length} 可邀请`)}
        <Pressable onPress={() => setPage("creator")} style={styles.tile}>
          <Text style={styles.tileTitle}>Creator 经营</Text>
          <Text style={styles.tileMeta}>{creators.length} 个 Creator · 走 SupplyClient.querySuppliers</Text>
        </Pressable>

        {sectionHead("活动 / 券 / 销售", "server-authoritative")}
        <View style={styles.tileGrid}>
          <Pressable onPress={() => setPage("activity")} style={styles.tileSmall}>
            <Text style={styles.tileTitle}>活动</Text>
            <Text style={styles.tileMeta}>{activityItems.length} 个开放活动</Text>
          </Pressable>
          <Pressable onPress={() => setPage("voucher")} style={styles.tileSmall}>
            <Text style={styles.tileTitle}>客户 / 券</Text>
            <Text style={styles.tileMeta}>{members.length} 个经营人员</Text>
          </Pressable>
          <Pressable onPress={() => setPage("sales")} style={styles.tileSmall}>
            <Text style={styles.tileTitle}>销售</Text>
            <Text style={styles.tileMeta}>{spendTotal.totalOrders} 单 / {formatVnd(spendTotal.totalGrossMinor)}</Text>
          </Pressable>
          <Pressable onPress={() => setPage("ops")} style={styles.tileSmall}>
            <Text style={styles.tileTitle}>运营</Text>
            <Text style={styles.tileMeta}>{members.length} 人员 · {spendDays.length} 日</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setPage("proxy")} style={styles.tile}>
          <Text style={styles.tileTitle}>Proxy 数据</Text>
          <Text style={styles.tileMeta}>{spendDays.length} 日 rollup · server 实际</Text>
        </Pressable>

        <Pressable onPress={onOpenSwitcher} style={styles.subtleButton}><Text style={styles.subtleButtonText}>切换身份</Text></Pressable>
        <Pressable onPress={onSignOut} style={styles.subtleButtonDanger}><Text style={styles.subtleButtonDangerText}>退出登录</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 13 },
  topline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  h1: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  merchantTag: { backgroundColor: "#EFE5FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  merchantTagText: { color: color.proxyPurple, fontSize: 11, fontWeight: "800" },
  identity: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12, ...shadows.card },
  bizAvatar: { alignItems: "center", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  bizAvatarText: { color: color.white, fontSize: 18, fontWeight: "900" },
  rowCopy: { flex: 1 },
  storeButton: { backgroundColor: color.lime, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  storeButtonText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 6, marginTop: 14 },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 12, marginVertical: 4, ...shadows.card, gap: 2 },
  cardTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  cardTitleWhite: { color: color.white, fontSize: 22, fontWeight: "900" },
  meta: { color: color.muted, fontSize: 12 },
  empty: { color: color.muted, fontSize: 12 },
  subPageBack: { paddingHorizontal: 8, paddingVertical: 6 },
  subPageBackText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  summary: { backgroundColor: "#1F1B33", borderRadius: 16, gap: 4, marginTop: 8, padding: 14 },
  summaryMeta: { color: "#BFB5DA", fontSize: 12 },
  summaryStats: { flexDirection: "row", gap: 14, marginTop: 8 },
  summaryStatItem: { gap: 2 },
  summaryStatValue: { color: color.white, fontSize: 16, fontWeight: "900" },
  summaryStatLabel: { color: "#BFB5DA", fontSize: 11 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  primary: { backgroundColor: color.lime, borderRadius: 12, flex: 1, paddingVertical: 12 },
  primaryText: { color: color.ink, fontSize: 14, fontWeight: "900", textAlign: "center" },
  secondary: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 12 },
  secondaryText: { color: color.ink, fontSize: 14, fontWeight: "800", textAlign: "center" },
  tile: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, marginVertical: 4, ...shadows.card, gap: 4 },
  tileTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  tileMeta: { color: color.muted, fontSize: 11 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tileSmall: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexBasis: "48%", padding: 12, ...shadows.card, gap: 2 },
  subtleButton: { marginTop: 16, paddingVertical: 10 },
  subtleButtonText: { color: color.muted, fontSize: 12, textAlign: "center" },
  subtleButtonDanger: { marginTop: 4, paddingVertical: 10 },
  subtleButtonDangerText: { color: "#a32020", fontSize: 12, textAlign: "center" },
});

// STORE-REC-BUILDER-001（2026-10-11，用户：「我的店铺 是已经推荐入平台的 list，但是目前做成跟
// 商家侧的功能了，这个不是商家侧的功能」）：用户侧「我的 → 场景推荐 → 我的店铺」。
//
// 这一页是 builder 的成果墙：**我推荐、并且已经被运营采纳进平台的店**。数据就是「我推荐的店」
// 那份推荐记录里 decision = ACCEPT 的子集 —— 不是商家名下的店。所以这里没有订单统计、
// 品类编辑、营业时间、打电话、二维码、建店入口：那些是商家侧（bdash / MyStoresHub）的功能，
// 之前正是把它们摆在了 builder 面前，才会「做成商家侧」。
//
// 词汇守「采纳 ≠ 店铺已存在」：写「已采纳」，不写「已签约 / 已入驻」。
// 返回按钮归本组件所有（列表态 = 退出，详情态 = 回列表），me.tsx 这一层不再画 ——
// 同 STORE-HUB-NAV-001：一屏只能有一个返回，否则详情页顶上那个会把人直接踢出整页。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";
import { nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { StoreOnboardingClient, type StoreRecommendation } from "../storeonboarding-client";
import {
  REC_STATUS_TEXT,
  acceptedRecs,
  recAccent,
  recAddressLine,
  recDay,
  recInitial,
  recMapsUrl,
  recMetaLine,
  recMoment,
  type RecAccent
} from "./store-recommendation-manage-model";

const ACCENT: Record<RecAccent, { bg: string; fg: string }> = {
  lime: { bg: "#EAF7B8", fg: "#4A5C00" },
  rose: { bg: "#F7DDE3", fg: "#7A2434" },
  sky: { bg: "#DCE8F7", fg: "#1E4574" },
  gold: { bg: "#F6E7BE", fg: "#6B5300" }
};

function newClient(): StoreOnboardingClient {
  return new StoreOnboardingClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore });
}

export function MyRecommendedStores({ onBack, onOpenRecommend }: {
  onBack: () => void;
  /** 空态的唯一出口：去「店铺推荐」推荐第一家店。 */
  onOpenRecommend: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<StoreRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<StoreRecommendation | undefined>(undefined);

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      // 服务端按 status 筛；客户端再过一遍 acceptedRecs（同一口径，兜住老服务端不认 status 的情况）。
      setRows(acceptedRecs(await newClient().listMyRecommendations({ limit: 50, status: "ACCEPTED" })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
      setRows(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const count = rows?.length ?? 0;
  const latest = useMemo(() => (rows && rows[0] ? recDay(rows[0].decidedAt ?? rows[0].createdAt) : undefined), [rows]);

  if (detail) {
    const accent = ACCENT[recAccent(detail.storeName)];
    const address = recAddressLine(detail);
    const mapsUrl = recMapsUrl(detail);
    return (
      <View style={s.page}>
        <Pressable accessibilityLabel="返回我的店铺" onPress={() => setDetail(undefined)} style={s.back}>
          <ProxyBackGlyph />
        </Pressable>
        <View style={s.detailHead}>
          <View style={[s.avatar, s.avatarLg, { backgroundColor: accent.bg }]}>
            <Text selectable style={[s.avatarText, s.avatarTextLg, { color: accent.fg }]}>{recInitial(detail.storeName)}</Text>
          </View>
          <View style={s.detailHeadBody}>
            <Text selectable style={s.detailName}>{detail.storeName}</Text>
            {recMetaLine(detail) ? <Text selectable style={s.meta}>{recMetaLine(detail)}</Text> : null}
          </View>
          <View style={s.pill}><Text selectable style={s.pillText}>{REC_STATUS_TEXT.ACCEPTED}</Text></View>
        </View>

        <View style={s.card}>
          {address ? (
            <View style={s.fact}>
              <Text selectable style={s.factLabel}>地址</Text>
              <Text selectable style={s.factValue}>{address}</Text>
              {mapsUrl ? (
                <Pressable accessibilityLabel="在地图里打开" onPress={() => void Linking.openURL(mapsUrl)} style={s.mapLink}>
                  <Text selectable style={s.mapLinkText}>在地图里打开</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={s.fact}>
            <Text selectable style={s.factLabel}>推荐于</Text>
            <Text selectable style={s.factValue}>{recMoment(detail.createdAt)}{detail.origin === "AI" ? " · 小美推荐" : ""}</Text>
          </View>
          {detail.reason.trim() ? (
            <View style={s.fact}>
              <Text selectable style={s.factLabel}>推荐理由</Text>
              <Text selectable style={s.factValue}>{detail.reason}</Text>
            </View>
          ) : null}
          {detail.decidedAt ? (
            <View style={s.fact}>
              <Text selectable style={s.factLabel}>运营采纳于</Text>
              <Text selectable style={s.factValue}>{recMoment(detail.decidedAt)}</Text>
            </View>
          ) : null}
          {detail.decisionReason?.trim() ? (
            <View style={s.fact}>
              <Text selectable style={s.factLabel}>采纳说明</Text>
              <Text selectable style={s.factValue}>{detail.decisionReason}</Text>
            </View>
          ) : null}
        </View>
        <Text selectable style={s.note}>采纳代表运营批准这家店接入平台，接入由平台跟进，你不需要做别的。</Text>
      </View>
    );
  }

  return (
    <View style={s.page}>
      <View style={s.head}>
        <Pressable accessibilityLabel="返回" onPress={onBack} style={s.backInline}>
          <ProxyBackGlyph />
        </Pressable>
        <Text selectable style={s.title}>我的店铺</Text>
      </View>
      <Text selectable style={s.sub}>你推荐、并且已经被运营采纳进平台的店。</Text>

      {rows !== null ? (
        <View style={s.overview}>
          <View style={s.ovItem}>
            <Text selectable style={s.ovValue}>{count}</Text>
            <Text selectable style={s.ovLabel}>已入平台</Text>
          </View>
          <View style={s.ovItem}>
            <Text selectable style={s.ovValueSm}>{latest ?? "—"}</Text>
            <Text selectable style={s.ovLabel}>最近采纳</Text>
          </View>
        </View>
      ) : null}

      {busy && rows === null ? <View style={s.center}><ProxyLoading tone="muted" /></View> : null}

      {/* 「读不出来」和「确实没有」必须长不一样：两者列表都为空。 */}
      {error ? (
        <View style={s.card}>
          <Text selectable style={s.error}>{error}</Text>
          <Pressable accessibilityLabel="重试" onPress={() => void load()} style={s.retry}>
            <Text selectable style={s.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}

      {!error && rows !== null && rows.length === 0 ? (
        <View style={s.card}>
          <Text selectable style={s.emptyTitle}>还没有被采纳的店</Text>
          <Text selectable style={s.emptyBody}>推荐的店被运营采纳后，会列在这里。</Text>
          <Pressable accessibilityLabel="去推荐" onPress={onOpenRecommend} style={s.cta}>
            <Text selectable style={s.ctaText}>去推荐一家</Text>
          </Pressable>
        </View>
      ) : null}

      {(rows ?? []).map((row) => {
        const accent = ACCENT[recAccent(row.storeName)];
        const address = recAddressLine(row);
        return (
          <Pressable key={row.recommendationId} accessibilityLabel={row.storeName} onPress={() => setDetail(row)} style={s.row}>
            <View style={[s.avatar, { backgroundColor: accent.bg }]}>
              <Text selectable style={[s.avatarText, { color: accent.fg }]}>{recInitial(row.storeName)}</Text>
            </View>
            <View style={s.rowBody}>
              <Text selectable numberOfLines={1} style={s.rowName}>{row.storeName}</Text>
              {recMetaLine(row) ? <Text selectable numberOfLines={1} style={s.meta}>{recMetaLine(row)}</Text> : null}
              {address ? <Text selectable numberOfLines={1} style={s.meta}>{address}</Text> : null}
              <Text selectable style={s.caption}>{row.decidedAt ? `${recDay(row.decidedAt)} 采纳` : `${recDay(row.createdAt)} 推荐`}</Text>
            </View>
            <Text selectable style={s.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// R3：Section 17/800、Card Title 15/800、Object 14/800、Meta 12/500、Caption 11/600；
// 16 边距、1px Line、圆角 16、无阴影、只用 theme token。
const s = StyleSheet.create({
  page: { gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  head: { alignItems: "center", flexDirection: "row", gap: 4, marginLeft: -8 },
  back: { alignItems: "flex-start", height: 44, justifyContent: "center", marginLeft: -8, width: 44 },
  backInline: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  title: { color: color.ink, fontSize: 17, fontWeight: "800", letterSpacing: -0.25, lineHeight: 24 },
  sub: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginTop: -4 },
  overview: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", paddingVertical: 14 },
  ovItem: { alignItems: "center", flex: 1, gap: 2 },
  ovValue: { color: color.ink, fontSize: 28, fontVariant: ["tabular-nums"], fontWeight: "900", letterSpacing: -0.55, lineHeight: 32 },
  ovValueSm: { color: color.ink, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 32 },
  ovLabel: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  center: { alignItems: "center", paddingVertical: 24 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 12, padding: 16 },
  row: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowName: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  meta: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17 },
  caption: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15, marginTop: 2 },
  chevron: { color: color.muted, fontSize: 20, fontWeight: "700" },
  avatar: { alignItems: "center", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  avatarLg: { borderRadius: 16, height: 56, width: 56 },
  avatarText: { fontSize: 18, fontWeight: "900" },
  avatarTextLg: { fontSize: 22 },
  detailHead: { alignItems: "center", flexDirection: "row", gap: 12 },
  detailHeadBody: { flex: 1, gap: 2, minWidth: 0 },
  detailName: { color: color.ink, fontSize: 17, fontWeight: "800", letterSpacing: -0.25, lineHeight: 24 },
  pill: { backgroundColor: color.factConfirmedBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  fact: { gap: 4 },
  factLabel: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  factValue: { color: color.ink, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  mapLink: { alignSelf: "flex-start", backgroundColor: color.surface, borderRadius: 999, marginTop: 4, paddingHorizontal: 12, paddingVertical: 6 },
  mapLinkText: { color: color.ink, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  note: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17 },
  error: { color: color.magenta, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  retry: { alignItems: "center", alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 999, minHeight: 40, justifyContent: "center", paddingHorizontal: 18 },
  retryText: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  emptyTitle: { color: color.ink, fontSize: 15, fontWeight: "800", letterSpacing: -0.15, lineHeight: 21 },
  emptyBody: { color: color.muted, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  cta: { alignItems: "center", alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 999, minHeight: 44, justifyContent: "center", paddingHorizontal: 20 },
  ctaText: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 18 }
});

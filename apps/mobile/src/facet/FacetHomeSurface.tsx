// FacetHomeSurface — R15.25 FACET 对象化内容运营 (Phase 1 = 列表).
//
// 设计来源: Proxy_COMPLETE_FiveRoot_FACET_v11.html (section FACET HOME
// + FACET OBJECTS list) — 但这里是 RN 实现, 不是 HTML prototype.
//
// 关键设计原则 (跟 prototype 一致):
//  - "Not a sixth root" — FACET 不是 6th tab, 是 ME tab 内的 deep module.
//  - 顶部 hero: Otter logo + "对象化内容运营" tag + 3 个 stat (对象数 /
//    新鲜 / 已展示) — 跟 prototype 的 .facetHero 对应.
//  - 中部 nav: 3 个 card 跳转到 LIBRARY / OBJECTS / OPS (Phase 1 全
//    stub "开发中" — 走 onComingSoon).
//  - 底部: 对象 list — 每个 object card = avatar circle / name / pill
//    / goal / currentState / 缺口 summary + nextShowAt. 点击展开 (Phase 1
//    不跳页, 只切 card 的 expanded flag).
//
// 边界:
//  - Phase 1 avatarUrl 永远 = "", UI 显示 initial letter placeholder.
//  - Phase 1 不做图片, LIBRARY / OBJECT DETAIL / OBJECT PREVIEW / OPS 全
//    stub "开发中".
//  - Phase 1 没有真实持久化, 没有对象编辑, 接受列表刷新即可.

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FacetObject, ListFacetObjectsPayload } from "@proxy/contracts";
import { FacetClient, FacetProtocolError } from "../facet-client";
import { color, shadows } from "../theme";

// 关系类型 → pill 中文 (跟 prototype HTML .facetPill 对应).
const RELATION_PILL: Record<FacetObject["relation"], string> = {
  BUILDING_TRUST: "重点关系",
  SHARED_INTEREST: "朋友",
  CREATOR_COLLAB: "合作"
};

type Phase = "LOADING" | "READY" | "ERROR";

type FacetHomeSurfaceProps = {
  /** Phase 1 必须注入 client (匿名 GET transport) — main app 传 SessionAuthClient. */
  client: FacetClient;
  /** 返回 ME tab — 已包在 SwipeBackShell 内, 不需要自己再包. */
  onBack: () => void;
  /** LIBRARY / OPS / OBJECT DETAIL 还没做, UI 点 → 弹"开发中" placeholder. */
  onComingSoon?: (label: string) => void;
};

export function FacetHomeSurface({ client, onBack, onComingSoon }: FacetHomeSurfaceProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [payload, setPayload] = useState<ListFacetObjectsPayload | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [expandedId, setExpandedId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setPhase("LOADING");
    client.listObjects()
      .then((data: ListFacetObjectsPayload) => {
        if (cancelled) return;
        setPayload(data);
        setPhase("READY");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof FacetProtocolError ? err.message : "FACET 服务暂时不可用");
        setPhase("ERROR");
      });
    return () => { cancelled = true; };
  }, [client]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Back row — 跟 .facetBackProxy 对应: "‹ 返回 Proxy" */}
        <Pressable onPress={onBack} style={styles.backRow}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>

        {/* Hero — .facetHero */}
        <View style={styles.hero}>
          <View style={styles.heroBrand}>
            <View style={styles.heroOtter}><Text style={styles.heroOtterText}>🦦</Text></View>
            <View style={styles.heroWordWrap}>
              <Text style={styles.heroWord}>
                F<Text style={styles.heroAccent}>A</Text>CET
              </Text>
              <Text style={styles.heroTag}>对象化内容运营</Text>
            </View>
          </View>
          <Text style={styles.heroLead}>
            同一份真实素材，针对不同对象重新组织呈现方式。
            <Text style={styles.heroLeadSmall}>人没有变，只是最相关的一面被优先呈现。</Text>
          </Text>
        </View>

        {/* Stats — .facetStats */}
        {phase === "READY" && payload ? (
          <View style={styles.stats}>
            <StatBlock value={payload.totalObjects} label="对象" />
            <StatBlock value={payload.freshAssets} label="新鲜素材" />
            <StatBlock value={payload.shownAssets} label="已展示" />
          </View>
        ) : null}

        {/* Loading / Error state */}
        {phase === "LOADING" ? (
          <View style={styles.stateBlock}><ActivityIndicator color={color.magenta} /></View>
        ) : null}
        {phase === "ERROR" ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>FACET 服务暂时不可用</Text>
            <Text style={styles.errorHint}>{errorMessage ?? "请稍后重试"}</Text>
          </View>
        ) : null}

        {/* Nav cards — .facetNavGrid: LIBRARY / OBJECTS / OPS (Phase 1 = stub) */}
        {phase === "READY" ? (
          <View style={styles.navGrid}>
            <NavCard label="内容库" sub="已展示 / 草稿 / 备选" icon="▤" onPress={() => onComingSoon?.("内容库")} />
            <NavCard label="对象列表" sub="按关系分组" icon="◎" onPress={() => onComingSoon?.("对象列表")} />
            <NavCard label="运营" sub="边界 / 规则 / 高级生成" icon="⚙" onPress={() => onComingSoon?.("运营")} />
          </View>
        ) : null}

        {/* Object list — .facetObject list */}
        {phase === "READY" && payload ? (
          <View style={styles.objectsSection}>
            <Text style={styles.sectionTitle}>对象</Text>
            <Text style={styles.sectionNote}>FACET 当前为每个对象独立判断展示方向</Text>
            <View style={styles.objectsList}>
              {payload.objects.map((obj) => (
                <ObjectCard
                  key={obj.id}
                  object={obj}
                  expanded={expandedId === obj.id}
                  onToggle={() => setExpandedId((current) => current === obj.id ? undefined : obj.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Phase 1 not-in-scope footer */}
        <View style={styles.scopeFooter}>
          <Text style={styles.scopeFooterText}>
            Phase 1：列表 + 关系 + 缺口判定。LIBRARY / OBJECT DETAIL / OBJECT PREVIEW / OPS 在后续版本。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StatBlock({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function NavCard({ label, sub, icon, onPress }: { label: string; sub: string; icon: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.navCard}>
      <View style={styles.navIcon}><Text style={styles.navIconText}>{icon}</Text></View>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.navSub}>{sub}</Text>
    </Pressable>
  );
}

function ObjectCard({ object: obj, expanded, onToggle }: { object: FacetObject; expanded: boolean; onToggle: () => void }): React.JSX.Element {
  const initial = obj.displayName.charAt(0);
  return (
    <Pressable onPress={onToggle} style={styles.objectCard}>
      <View style={styles.objectHead}>
        <View style={styles.objectAvatar}><Text style={styles.objectAvatarText}>{initial}</Text></View>
        <View style={styles.objectHeadCopy}>
          <View style={styles.objectNameRow}>
            <Text style={styles.objectName}>{obj.displayName}</Text>
            <View style={styles.objectPill}><Text style={styles.objectPillText}>{RELATION_PILL[obj.relation]}</Text></View>
          </View>
          <Text style={styles.objectState} numberOfLines={expanded ? undefined : 2}>
            {obj.currentState}
          </Text>
        </View>
        <Text style={styles.objectChevron}>{expanded ? "▾" : "›"}</Text>
      </View>
      {expanded ? (
        <View style={styles.objectDetail}>
          <DetailRow label="关系目标" value={obj.goal} />
          <DetailRow label="当前缺口" value={obj.gap.summary} />
          <DetailRow label="下一次展示" value={obj.gap.nextShowAt} accent />
          <Pressable onPress={onToggle} style={styles.objectDetailBtn}>
            <Text style={styles.objectDetailBtnText}>查看 {obj.displayName} 看到的我 (开发中)</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, accent ? styles.detailValueAccent : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 10 },
  backRow: { paddingVertical: 6 },
  backText: { color: color.magenta, fontSize: 14, fontWeight: "800" },

  // Hero
  hero: { paddingTop: 4, paddingBottom: 10 },
  heroBrand: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 4 },
  heroOtter: { alignItems: "center", height: 52, justifyContent: "center", width: 52 },
  heroOtterText: { fontSize: 36 },
  heroWordWrap: { flex: 1 },
  heroWord: { color: color.ink, fontSize: 28, fontWeight: "300", letterSpacing: 6 },
  heroAccent: { color: color.magenta, fontStyle: "normal" },
  heroTag: { color: color.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, marginTop: 4 },
  heroLead: { color: color.ink, fontSize: 14, fontWeight: "700", lineHeight: 21, marginTop: 14, paddingHorizontal: 2 },
  heroLeadSmall: { color: color.muted, display: "flex", fontSize: 10, fontWeight: "500", marginTop: 4 },

  // Stats
  stats: { flexDirection: "row", gap: 7, marginTop: 10 },
  statBlock: { backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flex: 1, padding: 10, ...shadows.card },
  statValue: { color: color.ink, fontSize: 18, fontWeight: "800" },
  statLabel: { color: color.muted, fontSize: 9, fontWeight: "600", marginTop: 2 },

  // State (loading / error)
  stateBlock: { alignItems: "center", paddingVertical: 24 },
  errorText: { color: color.magenta, fontSize: 13, fontWeight: "700" },
  errorHint: { color: color.muted, fontSize: 11, marginTop: 4 },

  // Nav grid (LIBRARY / OBJECTS / OPS stubs)
  navGrid: { flexDirection: "row", gap: 7, marginTop: 18 },
  navCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 82, padding: 10 },
  navIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 9, height: 28, justifyContent: "center", width: 28 },
  navIconText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  navLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 },
  navSub: { color: color.muted, fontSize: 9, lineHeight: 12, marginTop: 3 },

  // Object list
  objectsSection: { marginTop: 18 },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  sectionNote: { color: color.muted, fontSize: 10, marginTop: 3 },
  objectsList: { gap: 8, marginTop: 10 },

  objectCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, padding: 11, ...shadows.card },
  objectHead: { alignItems: "center", flexDirection: "row", gap: 10 },
  objectAvatar: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 21, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  objectAvatarText: { color: color.ink, fontSize: 16, fontWeight: "800" },
  objectHeadCopy: { flex: 1, minWidth: 0 },
  objectNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  objectName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  objectPill: { backgroundColor: color.attentionBg, borderColor: color.attentionBorder, borderRadius: 10, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  objectPillText: { color: color.magenta, fontSize: 9, fontWeight: "700" },
  objectState: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  objectChevron: { color: color.muted, fontSize: 18, fontWeight: "300" },

  // Object detail (expanded)
  objectDetail: { borderColor: color.line, borderTopWidth: 1, gap: 6, marginTop: 9, paddingTop: 9 },
  detailRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  detailLabel: { color: color.muted, fontSize: 10, fontWeight: "700", width: 64 },
  detailValue: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "600", lineHeight: 18 },
  detailValueAccent: { color: color.magenta, fontWeight: "800" },
  objectDetailBtn: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, marginTop: 8, paddingVertical: 10 },
  objectDetailBtnText: { color: color.magenta, fontSize: 11, fontWeight: "700" },

  // Footer
  scopeFooter: { marginTop: 18, paddingTop: 12 },
  scopeFooterText: { color: color.muted, fontSize: 10, lineHeight: 15, textAlign: "center" }
});

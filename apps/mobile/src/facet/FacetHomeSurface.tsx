// FacetHomeSurface — R15.25 FACET 对象化内容运营 (Phase 1.5).
//
// 设计来源: Proxy_COMPLETE_FiveRoot_FACET_v11.html (section FACET HOME + FACET OBJECTS list)
// 原则 "Not a sixth root" — FACET 是 ME tab 内的 deep module.
// 顶部 hero: Otter logo (真实 PNG, 非 emoji) + "对象化内容运营" + stats + nav + 对象 list.
// Phase 1.5 在 Phase 1 基础上补齐：真实 logo、ProxyIcon、重试/下拉刷新、对象预览与 LIBRARY/OBJECTS/OPS 子页.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FacetObject, ListFacetObjectsPayload } from "@proxy/contracts";
import { FacetClient, FacetProtocolError } from "../facet-client";
import { ProxyIcon } from "../components/proxy-icon";
import { Gradient, color, shadows } from "../theme";

const OTTER_LOGO = require("../../assets/otter-logo.png");

const RELATION_PILL: Record<FacetObject["relation"], string> = {
  BUILDING_TRUST: "重点关系",
  SHARED_INTEREST: "朋友",
  CREATOR_COLLAB: "合作",
};

type Phase = "LOADING" | "READY" | "ERROR";
type FacetView = "HOME" | "LIBRARY" | "OBJECTS" | "OPS" | "PREVIEW";

type FacetHomeSurfaceProps = {
  client: FacetClient;
  onBack: () => void;
  onComingSoon?: (label: string) => void;
};

export function FacetHomeSurface({ client, onBack, onComingSoon }: FacetHomeSurfaceProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [payload, setPayload] = useState<ListFacetObjectsPayload | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [view, setView] = useState<FacetView>("HOME");
  const [previewObject, setPreviewObject] = useState<FacetObject | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const fetchObjects = useCallback(async (showLoading: boolean) => {
    if (showLoading) setPhase("LOADING");
    try {
      const data = await client.listObjects();
      setPayload(data);
      setPhase("READY");
      setErrorMessage(undefined);
    } catch (err: unknown) {
      setErrorMessage(err instanceof FacetProtocolError ? err.message : "FACET 服务暂时不可用");
      setPhase("ERROR");
    } finally {
      setRefreshing(false);
    }
  }, [client]);

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchObjects(false);
  }, [fetchObjects]);

  const handleRetry = useCallback(() => {
    void fetchObjects(true);
  }, [fetchObjects]);

  function openPreview(obj: FacetObject): void {
    setPreviewObject(obj);
    setView("PREVIEW");
  }

  function handleNav(label: string, target: FacetView): void {
    if (onComingSoon) {
      // 保持兼容：仍回调但同时进入内部子页，避免纯 stub “开发中” 无功能
      onComingSoon(label);
    }
    setView(target);
  }

  // 子页：PREVIEW / LIBRARY / OBJECTS / OPS
  if (view === "PREVIEW" && previewObject) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setView("HOME")} style={styles.backRow}>
            <Text style={styles.backText}>‹ 返回 FACET</Text>
          </Pressable>
          <View style={styles.previewHead}>
            <View style={styles.previewAvatar}><Text style={styles.previewAvatarText}>{previewObject.displayName.charAt(0)}</Text></View>
            <View style={styles.previewCopy}>
              <View style={styles.objectNameRow}>
                <Text style={styles.objectName}>{previewObject.displayName}</Text>
                <View style={styles.objectPill}><Text style={styles.objectPillText}>{RELATION_PILL[previewObject.relation]}</Text></View>
              </View>
              <Text style={styles.previewSub}>{previewObject.currentState}</Text>
            </View>
          </View>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>关系目标</Text>
            <Text style={styles.sectionCardBody}>{previewObject.goal}</Text>
          </View>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>当前缺口</Text>
            <Text style={styles.sectionCardBody}>{previewObject.gap.summary}</Text>
            <Text style={styles.sectionCardAccent}>下一次：{previewObject.gap.nextShowAt}</Text>
          </View>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>TA 将看到的你</Text>
            <Text style={styles.sectionCardHint}>同一份真实素材，按对象重新组织 · 人没有变，只是最相关的一面被优先呈现</Text>
            <View style={styles.previewFeed}>
              <View style={styles.previewFeedItem}><Text style={styles.previewFeedLabel}>旅行 · 摄影</Text><Text style={styles.previewFeedText}>本周优先展示“{previewObject.gap.summary}”方向的内容</Text></View>
              <View style={styles.previewFeedItem}><Text style={styles.previewFeedLabel}>日常 · 真实侧面</Text><Text style={styles.previewFeedText}>已展示 16 条 · 本周新增 3 个素材</Text></View>
            </View>
          </View>
          <Text style={styles.previewFoot}>Phase 1.5：预览为本地组织逻辑演示，后续接入真实素材分发</Text>
        </ScrollView>
      </View>
    );
  }

  if (view === "LIBRARY" || view === "OBJECTS" || view === "OPS") {
    const titles: Record<string, { title: string; desc: string }> = {
      LIBRARY: { title: "内容库", desc: "已展示 / 草稿 / 备选 · 同一份素材按对象复用" },
      OBJECTS: { title: "对象列表", desc: "按关系分组 · 每个对象独立的展示策略" },
      OPS: { title: "运营", desc: "边界 / 规则 / 高级生成 · 后续版本开放" },
    };
    const metaVal = titles[view as "LIBRARY" | "OBJECTS" | "OPS"] ?? titles.LIBRARY;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setView("HOME")} style={styles.backRow}>
            <Text style={styles.backText}>‹ 返回 FACET</Text>
          </Pressable>
          <Text style={styles.subPageTitle}>{metaVal!.title}</Text>
          <Text style={styles.subPageDesc}>{metaVal!.desc}</Text>
          {view === "LIBRARY" && payload ? (
            <View style={styles.subPageCard}>
              <SubRow label="已展示" value={`${payload.shownAssets} 条`} />
              <SubRow label="新鲜素材" value={`${payload.freshAssets} 个`} />
              <SubRow label="草稿" value="12 条 · 本地" />
              <SubRow label="备选" value="5 条 · 待审核" />
              <Text style={styles.subPageHint}>Phase 1.5：内容库为统计视图，上传与审核在后续版本</Text>
            </View>
          ) : null}
          {view === "OBJECTS" && payload ? (
            <View style={styles.subPageCard}>
              {(["BUILDING_TRUST", "SHARED_INTEREST", "CREATOR_COLLAB"] as const).map((rel) => {
                const group = payload.objects.filter((o: FacetObject) => o.relation === rel);
                if (group.length === 0) return null;
                return (
                  <View key={rel} style={styles.groupBlock}>
                    <Text style={styles.groupTitle}>{RELATION_PILL[rel]} · {group.length}</Text>
                    {group.map((o: FacetObject) => (
                      <Pressable key={o.id} onPress={() => openPreview(o)} style={styles.groupRow}>
                        <View style={styles.groupAvatar}><Text style={styles.groupAvatarText}>{o.displayName.charAt(0)}</Text></View>
                        <View style={styles.groupCopy}><Text style={styles.groupName}>{o.displayName}</Text><Text style={styles.groupState}>{o.currentState}</Text></View>
                        <Text style={styles.groupChevron}>›</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
            </View>
          ) : null}
          {view === "OPS" ? (
            <View style={styles.subPageCard}>
              <Text style={styles.opsTitle}>运营边界</Text>
              <Text style={styles.opsBody}>· 每份素材仅在允许的对象上展示，不虚构人设</Text>
              <Text style={styles.opsBody}>· 缺口判定基于最近 7 天展示与互动，1 句总结</Text>
              <Text style={styles.opsBody}>· 下次展示时间由 gap.nextShowAt 决定，前端仅展示不改写</Text>
              <Text style={styles.subPageHint}>高级生成 / 规则引擎在后续版本开放</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.magenta} />}
      >
        <Pressable onPress={onBack} style={styles.backRow}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>

        {/* Hero — 使用真实 otter-logo.png + 渐变圆背景 */}
        <View style={styles.hero}>
          <View style={styles.heroBrand}>
            <Gradient from={color.magenta} to={color.violet} style={styles.heroOtter}>
              <Image accessibilityLabel="Proxy" source={OTTER_LOGO} style={styles.heroOtterImage} resizeMode="contain" />
            </Gradient>
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

        {/* Stats */}
        {phase === "READY" && payload ? (
          <View style={styles.stats}>
            <StatBlock value={payload.totalObjects} label="对象" />
            <StatBlock value={payload.freshAssets} label="新鲜素材" />
            <StatBlock value={payload.shownAssets} label="已展示" />
          </View>
        ) : null}

        {phase === "LOADING" ? (
          <View style={styles.stateBlock}><ActivityIndicator color={color.magenta} /></View>
        ) : null}
        {phase === "ERROR" ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>FACET 服务暂时不可用</Text>
            <Text style={styles.errorHint}>{errorMessage ?? "请稍后重试"}</Text>
            <Pressable onPress={handleRetry} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>重试</Text>
            </Pressable>
            <Pressable onPress={onRefresh} style={styles.retrySubBtn}>
              <Text style={styles.retrySubText}>下拉也可刷新</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Nav cards — 使用 ProxyIcon 替代 unicode 占位 */}
        {phase === "READY" ? (
          <View style={styles.navGrid}>
            <NavCard label="内容库" sub="已展示 / 草稿 / 备选" iconName="image" onPress={() => handleNav("内容库", "LIBRARY")} />
            <NavCard label="对象列表" sub="按关系分组" iconName="target" onPress={() => handleNav("对象列表", "OBJECTS")} />
            <NavCard label="运营" sub="边界 / 规则 / 高级生成" iconName="settings" onPress={() => handleNav("运营", "OPS")} />
          </View>
        ) : null}

        {phase === "READY" && payload ? (
          <View style={styles.objectsSection}>
            <Text style={styles.sectionTitle}>对象</Text>
            <Text style={styles.sectionNote}>FACET 当前为每个对象独立判断展示方向</Text>
            <View style={styles.objectsList}>
              {payload.objects.length === 0 ? (
                <View style={styles.emptyCard}><Text style={styles.emptyText}>还没有对象</Text><Text style={styles.emptyHint}>创建首个对象后，这里会显示关系与缺口</Text></View>
              ) : payload.objects.map((obj: FacetObject) => (
                <ObjectCard
                  key={obj.id}
                  object={obj}
                  expanded={expandedId === obj.id}
                  onToggle={() => setExpandedId((current) => current === obj.id ? undefined : obj.id)}
                  onPreview={() => openPreview(obj)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.scopeFooter}>
          <Text style={styles.scopeFooterText}>
            Phase 1.5：列表 + 预览 + 内容库/分组/运营视图。真实图片与规则引擎在后续版本。
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

function NavCard({ label, sub, iconName, onPress }: { label: string; sub: string; iconName: "image" | "target" | "settings" | "spark"; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.navCard}>
      <View style={styles.navIcon}><ProxyIcon color={color.ink} name={iconName} size={18} /></View>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.navSub}>{sub}</Text>
    </Pressable>
  );
}

function ObjectCard({ object: obj, expanded, onToggle, onPreview }: { object: FacetObject; expanded: boolean; onToggle: () => void; onPreview: () => void }): React.JSX.Element {
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
          <Pressable onPress={onPreview} style={styles.objectDetailBtn}>
            <Text style={styles.objectDetailBtnText}>查看 {obj.displayName} 看到的我</Text>
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

function SubRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.subRow}>
      <Text style={styles.subRowLabel}>{label}</Text>
      <Text style={styles.subRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 10 },
  backRow: { paddingVertical: 6 },
  backText: { color: color.magenta, fontSize: 14, fontWeight: "800" },

  hero: { paddingBottom: 10, paddingTop: 4 },
  heroBrand: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 4 },
  heroOtter: { alignItems: "center", borderRadius: 16, height: 52, justifyContent: "center", overflow: "hidden", width: 52 },
  heroOtterImage: { height: 36, width: 36 },
  heroWordWrap: { flex: 1 },
  heroWord: { color: color.ink, fontSize: 28, fontWeight: "300", letterSpacing: 6 },
  heroAccent: { color: color.magenta, fontStyle: "normal" },
  heroTag: { color: color.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.5, marginTop: 4 },
  heroLead: { color: color.ink, fontSize: 14, fontWeight: "700", lineHeight: 21, marginTop: 14, paddingHorizontal: 2 },
  heroLeadSmall: { color: color.muted, fontSize: 10, fontWeight: "500", marginTop: 4 },

  stats: { flexDirection: "row", gap: 7, marginTop: 10 },
  statBlock: { backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flex: 1, padding: 10, ...shadows.card },
  statValue: { color: color.ink, fontSize: 18, fontWeight: "800" },
  statLabel: { color: color.muted, fontSize: 9, fontWeight: "600", marginTop: 2 },

  stateBlock: { alignItems: "center", paddingVertical: 24 },
  errorText: { color: color.magenta, fontSize: 13, fontWeight: "700" },
  errorHint: { color: color.muted, fontSize: 11, marginTop: 4 },
  retryBtn: { backgroundColor: color.ink, borderRadius: 10, marginTop: 12, paddingHorizontal: 18, paddingVertical: 9 },
  retryBtnText: { color: color.white, fontSize: 12, fontWeight: "800" },
  retrySubBtn: { marginTop: 8, paddingVertical: 4 },
  retrySubText: { color: color.muted, fontSize: 11 },

  navGrid: { flexDirection: "row", gap: 7, marginTop: 18 },
  navCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 82, padding: 10 },
  navIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 9, height: 28, justifyContent: "center", width: 28 },
  navLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginTop: 8 },
  navSub: { color: color.muted, fontSize: 9, lineHeight: 12, marginTop: 3 },

  objectsSection: { marginTop: 18 },
  sectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  sectionNote: { color: color.muted, fontSize: 10, marginTop: 3 },
  objectsList: { gap: 8, marginTop: 10 },
  emptyCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 18 },
  emptyText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  emptyHint: { color: color.muted, fontSize: 11, marginTop: 4 },

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

  objectDetail: { borderColor: color.line, borderTopWidth: 1, gap: 6, marginTop: 9, paddingTop: 9 },
  detailRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  detailLabel: { color: color.muted, fontSize: 10, fontWeight: "700", width: 64 },
  detailValue: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "600", lineHeight: 18 },
  detailValueAccent: { color: color.magenta, fontWeight: "800" },
  objectDetailBtn: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, marginTop: 8, paddingVertical: 10 },
  objectDetailBtnText: { color: color.magenta, fontSize: 11, fontWeight: "700" },

  scopeFooter: { marginTop: 18, paddingTop: 12 },
  scopeFooterText: { color: color.muted, fontSize: 10, lineHeight: 15, textAlign: "center" },

  // Preview / subpage
  previewHead: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 10, padding: 14, ...shadows.card },
  previewAvatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 16, height: 56, justifyContent: "center", width: 56 },
  previewAvatarText: { color: color.ink, fontSize: 16, fontWeight: "900" },
  previewCopy: { flex: 1 },
  previewSub: { color: color.muted, fontSize: 11, marginTop: 4 },
  sectionCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  sectionCardTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  sectionCardBody: { color: color.ink, fontSize: 12, lineHeight: 18, marginTop: 6 },
  sectionCardHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
  sectionCardAccent: { color: color.magenta, fontSize: 11, fontWeight: "800", marginTop: 6 },
  previewFeed: { gap: 8, marginTop: 10 },
  previewFeedItem: { backgroundColor: color.surface, borderRadius: 12, padding: 10 },
  previewFeedLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  previewFeedText: { color: color.muted, fontSize: 11, marginTop: 4 },
  previewFoot: { color: color.muted, fontSize: 10, lineHeight: 15, marginTop: 14, textAlign: "center" },
  subPageTitle: { color: color.ink, fontSize: 18, fontWeight: "900", marginTop: 8 },
  subPageDesc: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  subPageCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 12, ...shadows.card },
  subRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  subRowLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  subRowValue: { color: color.ink, fontSize: 12, fontWeight: "800" },
  subPageHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  groupBlock: { marginTop: 8 },
  groupTitle: { color: color.ink, fontSize: 11, fontWeight: "800", marginBottom: 6 },
  groupRow: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 8 },
  groupAvatar: { alignItems: "center", backgroundColor: color.surface, borderColor: color.line, borderRadius: 15, borderWidth: 1, height: 30, justifyContent: "center", width: 30 },
  groupAvatarText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  groupCopy: { flex: 1 },
  groupName: { color: color.ink, fontSize: 12, fontWeight: "800" },
  groupState: { color: color.muted, fontSize: 10, marginTop: 2 },
  groupChevron: { color: color.muted, fontSize: 14 },
  opsTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  opsBody: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
});

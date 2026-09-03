// AIIdentityShowcaseSurface — R1 AI Identity System (R1 HTML frontstage) 1:1 抄
//
// R15.77: 3 个 phone preview (Human / AI Native / Twin) + 顶部 mini identity cards
// R15.78: + R1 audit 段 (审计日志) 5 列 table + 5 过滤
// R15.79: + R1 provenance 段 (Content Provenance Pipeline + 3 sample + 4 维度评分)
// R15.80: + R1 risk 段 (3 风险卡 + 5 规则 + 推荐/指标 6 toggles)
// R15.81: + R1 identity 段 (Account≠ContentProvenance + 权限矩阵 8 行 + 注册链路 + 数据模型 modal)
//
// 设计: 1:1 抄 R1 HTML 视觉, 不自创.
//
// 这是静态 design showcase (我域), 不接 server. commander 域 R1 full wiring
// (R1 reality gate + Twin consent + audit log) 是 Phase 2.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";

type IdentityKind = "HUMAN" | "AI_NATIVE" | "AI_TWIN";

const IDENTITY_CARDS: ReadonlyArray<{ kind: IdentityKind; title: string; sub: string }> = [
  { kind: "HUMAN", title: "真人", sub: "现实责任主体" },
  { kind: "AI_NATIVE", title: "平台 AI", sub: "Proxy 责任主体" },
  { kind: "AI_TWIN", title: "AI 分身", sub: "绑定唯一 Creator" }
];

const KIND_META: Record<IdentityKind, { label: string; tint: string; soft: string; pillText: string }> = {
  HUMAN: { label: "✓ 真人已验证", tint: "#0f172a", soft: "#f1f5f9", pillText: "#0f172a" },
  AI_NATIVE: { label: "✦ AI Creator · Proxy", tint: "#6d28d9", soft: "#f3e8ff", pillText: "#6d28d9" },
  AI_TWIN: { label: "✦ AI Twin · Linh 授权", tint: "#6d28d9", soft: "#f3e8ff", pillText: "#6d28d9" }
};

function MiniIdentityCards(): React.JSX.Element {
  return (
    <View style={styles.miniRow}>
      {IDENTITY_CARDS.map((c) => {
        const meta = KIND_META[c.kind];
        return (
          <View key={c.kind} style={styles.miniCard}>
            <View style={[styles.miniPill, { backgroundColor: meta.soft }]}>
              <Text style={[styles.miniPillText, { color: meta.pillText }]}>{c.kind}</Text>
            </View>
            <Text style={styles.miniTitle}>{c.title}</Text>
            <Text style={styles.miniSub}>{c.sub}</Text>
          </View>
        );
      })}
    </View>
  );
}

type PreviewKind = "human" | "native" | "twin";

const PREVIEW_DATA: Record<PreviewKind, {
  name: string; handle: string; initial: string; ai: boolean;
  badge: { label: string; ai: boolean };
  notice: { title: string; body: string } | undefined;
  action: { dark: string; light: string };
  origin: { label: string; ai: boolean };
  postText: string;
}> = {
  human: {
    name: "Linh", handle: "@linh.hn", initial: "L", ai: false,
    badge: { label: "✓ 真人已验证", ai: false },
    notice: undefined,
    action: { dark: "关注", light: "邀约" },
    origin: { label: "Human-created", ai: false },
    postText: "今天傍晚西湖的光很好, 准备慢慢走一圈。"
  },
  native: {
    name: "Mia AI", handle: "@mia.proxy.ai", initial: "M", ai: true,
    badge: { label: "✦ AI Creator · Proxy", ai: true },
    notice: {
      title: "这是虚拟 AI 数字人。",
      body: "不对应现实中的个人, 也不会产生到店、邀约履约或评价。"
    },
    action: { dark: "与 AI 对话", light: "AI 说明" },
    origin: { label: "AI-generated · Proxy", ai: true },
    postText: "如果你周末想拍城市夜景, 可以先收藏这几个公开 Scene。"
  },
  twin: {
    name: "Linh AI", handle: "@linh.ai", initial: "L·AI", ai: true,
    badge: { label: "✦ AI Twin · Linh 授权", ai: true },
    notice: {
      title: "你正在查看 Linh 的 AI 分身。",
      body: "可以回答公开信息与收集邀约, 现实邀约由 Linh 本人确认。"
    },
    action: { dark: "与 Twin 对话", light: "发邀约草稿" },
    origin: { label: "AI Twin generated · Linh authorized", ai: true },
    postText: "Linh 最近公开内容里最常出现的是咖啡、摄影和西湖路线。"
  }
};

function ProfilePreview({ kind }: { kind: PreviewKind }): React.JSX.Element {
  const data = PREVIEW_DATA[kind];
  const badgeTint = data.badge.ai ? "#6d28d9" : "#0f172a";
  return (
    <View style={styles.phone}>
      <View style={styles.phoneStatus}>
        <Text style={styles.phoneStatusText}>9:41</Text>
        <Text style={styles.phoneStatusText}>●</Text>
      </View>
      <View style={styles.phoneBody}>
        <View style={styles.pTop}>
          <Text style={styles.pTopBtn}>‹</Text>
          <Text style={styles.pTopHandle}>{data.handle.replace("@", "")}</Text>
          <Text style={styles.pTopBtn}>•••</Text>
        </View>
        <View style={styles.profileHead}>
          <View style={styles.profileHeadCopy}>
            <Text style={styles.profileName}>{data.name}</Text>
            <Text style={styles.profileHandle}>{data.handle} · {data.ai ? "AI identity" : "河内"}</Text>
            <View style={[styles.pBadge, { borderColor: badgeTint }]}>
              <Text style={[styles.pBadgeText, { color: badgeTint }]}>{data.badge.label}</Text>
            </View>
          </View>
          <View style={[styles.pAvatar, data.ai ? styles.pAvatarAi : undefined]}>
            <Text style={[styles.pAvatarText, data.ai ? styles.pAvatarTextAi : undefined]}>{data.initial}</Text>
          </View>
        </View>
        <Text style={styles.pBio}>
          {kind === "human"
            ? "喜欢摄影、咖啡和河内的小店。"
            : kind === "native"
              ? "Proxy 创建的虚拟 Creator, 分享公开可验证的城市灵感。"
              : "Linh 的数字分身, 基于本人授权的 Facet、公开内容和可用范围。"}
        </Text>
        {data.notice ? (
          <View style={styles.pNotice}>
            <Text style={styles.pNoticeTitle}>{data.notice.title}</Text>
            <Text style={styles.pNoticeBody}>{data.notice.body}</Text>
          </View>
        ) : null}
        <View style={styles.pActions}>
          <View style={[styles.pActionBtn, styles.pActionDark]}><Text style={styles.pActionDarkText}>{data.action.dark}</Text></View>
          <View style={styles.pActionBtn}><Text style={styles.pActionText}>{data.action.light}</Text></View>
        </View>
        <View style={styles.pTabs}>
          <View style={[styles.pTab, styles.pTabOn]}><Text style={styles.pTabOnText}>帖文</Text></View>
          <View style={styles.pTab}><Text style={styles.pTabText}>回复</Text></View>
          <View style={styles.pTab}><Text style={styles.pTabText}>媒体</Text></View>
        </View>
        <View style={styles.postCard}>
          <View style={[styles.postAva, data.ai ? styles.postAvaAi : undefined]}>
            <Text style={[styles.postAvaText, data.ai ? styles.postAvaTextAi : undefined]}>{data.initial.charAt(0)}</Text>
          </View>
          <View style={styles.postCopy}>
            <View style={styles.postHeadRow}>
              <Text style={styles.postName}>{data.name}</Text>
              <Text style={styles.postTime}>1 小时</Text>
            </View>
            <Text style={styles.postText}>{data.postText}</Text>
            <Text style={[styles.pOrigin, data.origin.ai ? styles.pOriginAi : undefined]}>{data.origin.label}</Text>
            <Text style={styles.postActions}>♡ 24   ◯ 6   ↻ 2</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function AIIdentityShowcaseSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [archOpen, setArchOpen] = useState(false);
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pageHead}>
          <Text onPress={onBack} style={styles.back}>‹</Text>
          <Text style={styles.title}>AI 身份中心</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setArchOpen(true)}
            style={styles.archBtn}
            accessibilityLabel="查看数据模型"
          >
            <Text style={styles.archBtnText}>数据模型</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>R1 透明度义务 · Vietnam AI Law 134/2025</Text>

        {/* R15.81: R1 identity 段 — Account≠ContentProvenance (2 cards + 4 content badges) */}
        <Text style={styles.sectionTitle}>Account Identity ≠ Content Provenance</Text>
        <Text style={styles.sectionSub}>两套标签独立存在。</Text>
        <IdentitySplit />

        <Text style={[styles.sectionSub, { marginTop: 14, marginBottom: 6 }]}>权限矩阵</Text>
        <Text style={[styles.sectionSub, { marginBottom: 6 }]}>前端按钮必须从权限读取, 不能只做视觉隐藏。</Text>
        <PermissionMatrix />

        <Text style={[styles.sectionSub, { marginTop: 14, marginBottom: 6 }]}>注册与创建链路</Text>
        <SignupFlow />

        <Text style={styles.sectionTitle}>三类身份</Text>
        <Text style={styles.sectionSub}>Account Identity 与 Content Provenance 是两套独立真相。</Text>
        <MiniIdentityCards />

        <Text style={styles.sectionTitle}>前台身份与内容标识</Text>
        <Text style={styles.sectionSub}>用户第一眼就知道谁是真人、谁是 AI、谁是谁的 Twin。</Text>
        <View style={styles.grid3}>
          <ProfilePreview kind="human" />
          <ProfilePreview kind="native" />
          <ProfilePreview kind="twin" />
        </View>

        <Text style={styles.sectionTitle}>审计日志</Text>
        <Text style={styles.sectionSub}>所有 AI 生成、授权、策略拦截都可追溯。</Text>
        <AuditTable />

        {/* R15.79: R1 provenance 段 — 5 步 pipeline + 3 sample + 4 维度评分 */}
        <Text style={styles.sectionTitle}>Content Provenance Pipeline</Text>
        <Text style={styles.sectionSub}>Detection 是 signal, 不是绝对真相。</Text>
        <ProvenancePipeline />

        <Text style={[styles.sectionTitle, { marginTop: 18 }]}>检测实验台</Text>
        <Text style={styles.sectionSub}>点击样本后运行。</Text>
        <DetectionTable />

        {/* R15.80: R1 risk 段 — 3 风险卡 + 5 规则 + 6 toggles */}
        <Text style={[styles.sectionTitle, { marginTop: 18 }]}>风险控制策略</Text>
        <Text style={styles.sectionSub}>身份 × 内容 × 现实行为。</Text>
        <RiskCards />
        <Text style={[styles.sectionSub, { marginTop: 12, marginBottom: 6 }]}>策略规则</Text>
        <RiskRules />
        <Text style={[styles.sectionSub, { marginTop: 14, marginBottom: 6 }]}>推荐与指标防污染</Text>
        <RecommendationToggles />
      </ScrollView>
      {archOpen ? <DataContractModal onClose={() => setArchOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.appBg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  pageHead: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 12 },
  back: { fontSize: 22, color: color.ink, paddingHorizontal: 6 },
  title: { fontSize: 22, fontWeight: "800", color: color.ink, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: color.muted, marginBottom: 20 },

  sectionTitle: { fontSize: 18, fontWeight: "800", color: color.ink, marginTop: 16, marginBottom: 4 },
  sectionSub: { fontSize: 12, color: color.muted, marginBottom: 12 },

  // Mini identity cards (3 个: HUMAN / AI_NATIVE / AI_TWIN)
  miniRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  miniCard: { flex: 1, backgroundColor: color.white, borderRadius: 14, borderWidth: 1, borderColor: color.cardBorder, padding: 10 },
  miniPill: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginBottom: 6 },
  miniPillText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  miniTitle: { fontSize: 13, fontWeight: "700", color: color.ink, marginBottom: 2 },
  miniSub: { fontSize: 11, color: color.muted, lineHeight: 15 },

  // 3 phone grid
  grid3: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  phone: { flex: 1, backgroundColor: color.white, borderRadius: 18, borderWidth: 1, borderColor: color.cardBorder, paddingBottom: 8, overflow: "hidden" },
  phoneStatus: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 4, backgroundColor: color.appBg },
  phoneStatusText: { fontSize: 9, fontWeight: "700", color: color.ink },
  phoneBody: { paddingHorizontal: 6, paddingTop: 4 },

  pTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  pTopBtn: { fontSize: 12, color: color.ink, paddingHorizontal: 4 },
  pTopHandle: { fontSize: 11, fontWeight: "700", color: color.ink },

  profileHead: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 6 },
  profileHeadCopy: { flex: 1 },
  profileName: { fontSize: 14, fontWeight: "800", color: color.ink, letterSpacing: -0.2 },
  profileHandle: { fontSize: 10, color: color.muted, marginTop: 1 },
  pBadge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  pBadgeText: { fontSize: 8, fontWeight: "800", letterSpacing: 0.3 },
  pAvatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  pAvatarAi: { backgroundColor: "#6d28d9" },
  pAvatarText: { color: color.white, fontSize: 14, fontWeight: "800" },
  pAvatarTextAi: { fontSize: 10 },

  pBio: { fontSize: 11, color: color.ink, lineHeight: 15, marginBottom: 6 },
  pNotice: { backgroundColor: "#f3e8ff", borderRadius: 8, padding: 6, marginBottom: 6 },
  pNoticeTitle: { fontSize: 10, fontWeight: "800", color: "#6d28d9", marginBottom: 2 },
  pNoticeBody: { fontSize: 9, color: "#5b21b6", lineHeight: 12 },

  pActions: { flexDirection: "row", gap: 4, marginBottom: 8 },
  pActionBtn: { flex: 1, alignItems: "center", paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: color.cardBorder },
  pActionDark: { backgroundColor: color.ink, borderColor: color.ink },
  pActionText: { fontSize: 9, fontWeight: "700", color: color.ink },
  pActionDarkText: { fontSize: 9, fontWeight: "800", color: color.white },

  pTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: color.cardBorder, marginBottom: 6 },
  pTab: { flex: 1, alignItems: "center", paddingVertical: 4 },
  pTabOn: { borderBottomWidth: 2, borderBottomColor: color.ink },
  pTabText: { fontSize: 9, color: color.muted, fontWeight: "600" },
  pTabOnText: { fontSize: 9, color: color.ink, fontWeight: "800" },

  postCard: { flexDirection: "row", gap: 6, marginTop: 4 },
  postAva: { width: 22, height: 22, borderRadius: 999, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  postAvaAi: { backgroundColor: "#6d28d9" },
  postAvaText: { color: color.white, fontSize: 10, fontWeight: "800" },
  postAvaTextAi: { fontSize: 8 },
  postCopy: { flex: 1 },
  postHeadRow: { flexDirection: "row", justifyContent: "space-between" },
  postName: { fontSize: 10, fontWeight: "800", color: color.ink },
  postTime: { fontSize: 8, color: color.muted },
  postText: { fontSize: 10, color: color.ink, lineHeight: 13, marginTop: 1 },
  pOrigin: { fontSize: 8, color: color.muted, marginTop: 2 },
  pOriginAi: { color: "#6d28d9", fontWeight: "700" },
  postActions: { fontSize: 9, color: color.muted, marginTop: 3 },

  // R15.78: R1 审计日志 (5 列 table + 5 过滤). 1:1 抄 R1 HTML 视觉.
  auditFilters: { flexDirection: "row", gap: 6, marginBottom: 10, flexWrap: "wrap" },
  auditFilterBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: color.cardBorder, backgroundColor: color.white },
  auditFilterBtnOn: { backgroundColor: color.ink, borderColor: color.ink },
  auditFilterText: { fontSize: 10, fontWeight: "700", color: color.ink },
  auditFilterTextOn: { color: color.white },
  tableWrap: { borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, backgroundColor: color.white, overflow: "hidden" },
  auditTable: { width: "100%" },
  auditHeaderRow: { flexDirection: "row", backgroundColor: color.appBg, paddingVertical: 6, paddingHorizontal: 8 },
  auditHeaderCell: { flex: 1, fontSize: 9, fontWeight: "800", color: color.ink },
  auditRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: color.cardBorder },
  auditCell: { flex: 1, fontSize: 9, color: color.ink, paddingRight: 4 },
  auditCellActor: { fontWeight: "800" },
  auditCellIdentityNative: { color: "#6d28d9", fontWeight: "700" },
  auditCellIdentityTwin: { color: "#6d28d9", fontWeight: "700" },
  auditCellIdentityHuman: { color: color.ink, fontWeight: "700" },
  auditCellPolicy: { color: color.muted, fontStyle: "italic" },
  auditCellResultReview: { color: "#b45309", fontWeight: "700" },

  // R15.79: R1 provenance pipeline (5 步)
  pipelineRow: { flexDirection: "row", gap: 6, marginBottom: 14 },
  pipeStep: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, alignItems: "center" },
  pipeStepAi: { borderColor: "#6d28d9" },
  pipeNum: { width: 18, height: 18, borderRadius: 999, backgroundColor: color.ink, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  pipeNumAi: { backgroundColor: "#6d28d9" },
  pipeNumText: { color: color.white, fontSize: 9, fontWeight: "800" },
  pipeStepTitle: { fontSize: 10, fontWeight: "800", color: color.ink, textAlign: "center", marginBottom: 2 },
  pipeStepSub: { fontSize: 8, color: color.muted, textAlign: "center", lineHeight: 11 },

  // R15.79: R1 detection 段 (sample grid + result)
  detectGrid: { flexDirection: "row", gap: 10 },
  sampleGrid: { gap: 6 },
  sampleCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8 },
  sampleCardOn: { borderColor: color.ink, backgroundColor: color.appBg },
  sampleVisual: { width: 30, height: 30, borderRadius: 999, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  sampleVisualAi: { backgroundColor: "#6d28d9" },
  sampleVisualText: { color: color.white, fontSize: 12, fontWeight: "800" },
  sampleVisualTextAi: { fontSize: 8 },
  sampleTitle: { fontSize: 11, fontWeight: "800", color: color.ink },
  sampleSub: { fontSize: 9, color: color.muted },

  detectResult: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10 },
  detectResultTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 2 },
  detectResultSub: { fontSize: 8, color: "#777", marginBottom: 8 },

  signalRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  signalLabelWrap: { flex: 1.4 },
  signalLabel: { fontSize: 9, fontWeight: "700", color: color.ink },
  signalHint: { fontSize: 8, color: color.muted },
  signalBarTrack: { flex: 1.6, height: 6, backgroundColor: color.appBg, borderRadius: 3, overflow: "hidden" },
  signalBarFill: { height: 6, backgroundColor: color.ink, borderRadius: 3 },
  signalBarFillAi: { backgroundColor: "#6d28d9" },
  signalValue: { width: 30, fontSize: 9, fontWeight: "800", color: color.ink, textAlign: "right" },

  decisionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: color.cardBorder },
  decisionTitle: { fontSize: 11, fontWeight: "800", color: color.ink },
  decisionSub: { fontSize: 8, color: color.muted },
  riskPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  riskPillLow: { backgroundColor: "#dcfce7" },
  riskPillReview: { backgroundColor: "#fde68a" },
  riskPillText: { fontSize: 9, fontWeight: "800" },
  riskPillTextLow: { color: "#15803d" },
  riskPillTextReview: { color: "#b45309" },

  // R15.80: R1 risk 段
  riskGrid: { flexDirection: "row", gap: 8, marginBottom: 14 },
  riskCard: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10 },
  riskCardTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 4 },
  riskCardSub: { fontSize: 9, color: color.muted, lineHeight: 13 },

  ruleCard: { backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10, marginBottom: 6 },
  ruleTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  ruleTitle: { flex: 1, fontSize: 11, fontWeight: "800", color: color.ink, paddingRight: 8 },
  ruleActionPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  ruleActionText: { fontSize: 9, fontWeight: "800" },
  ruleReason: { fontSize: 9, color: color.muted, lineHeight: 13, marginBottom: 6 },
  ruleOps: { flexDirection: "row", gap: 6 },
  ruleOpBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: color.cardBorder, backgroundColor: color.appBg },
  ruleOpBtnText: { fontSize: 9, fontWeight: "700", color: color.ink },
  ruleDivider: { height: 1, backgroundColor: color.cardBorder, marginVertical: 6 },

  recoGrid: { flexDirection: "row", gap: 8 },
  recoCard: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10 },
  recoCardTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 6 },

  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: color.cardBorder },
  toggleRowCopy: { flex: 1 },
  toggleRowTitle: { fontSize: 10, fontWeight: "800", color: color.ink },
  toggleRowSub: { fontSize: 8, color: color.muted, marginTop: 1 },
  toggle: { width: 28, height: 16, borderRadius: 999, backgroundColor: color.cardBorder, padding: 2, justifyContent: "center" },
  toggleOn: { backgroundColor: color.ink },
  toggleAi: { backgroundColor: "#6d28d9" },
  toggleDisabled: { opacity: 0.7 },
  toggleKnob: { width: 12, height: 12, borderRadius: 999, backgroundColor: color.white },
  toggleKnobOn: { transform: [{ translateX: 12 }] },

  // R15.81: R1 identity 段 (Account≠Content + 权限矩阵 + 注册链路 + 数据模型 modal)
  archBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: color.cardBorder, backgroundColor: color.white },
  archBtnText: { fontSize: 11, fontWeight: "700", color: color.ink },

  identityGrid: { flexDirection: "row", gap: 8 },
  identityCard: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10 },
  identityCardTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 4 },
  identityCardSub: { fontSize: 9, color: color.muted, lineHeight: 13 },
  contentBadgesCol: { marginTop: 8, gap: 6 },
  contentBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  contentBadgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },

  permTableWrap: { borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, backgroundColor: color.white, overflow: "hidden" },
  permHeaderRow: { flexDirection: "row", backgroundColor: color.appBg, paddingVertical: 6, paddingHorizontal: 8 },
  permHeaderCell: { flex: 1, fontSize: 9, fontWeight: "800", color: color.ink, paddingHorizontal: 2 },
  permRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: color.cardBorder, alignItems: "center" },
  permCellCap: { fontSize: 9, fontWeight: "700", color: color.ink, paddingRight: 4 },
  permCell: { flex: 1, alignItems: "center", paddingVertical: 3, marginHorizontal: 1, borderRadius: 4 },
  permCellText: { fontSize: 8, fontWeight: "800", textAlign: "center" },
  permPolicy: { fontSize: 8, color: color.muted, lineHeight: 11, paddingLeft: 4 },

  signupFlow: { flexDirection: "row", alignItems: "stretch", gap: 4, marginBottom: 4 },
  signupFlowRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  signupBox: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, alignItems: "center" },
  signupBoxAi: { borderColor: "#6d28d9" },
  signupBoxKind: { fontSize: 11, fontWeight: "800", color: color.ink, marginBottom: 2 },
  signupBoxKindAi: { color: "#6d28d9" },
  signupBoxSteps: { fontSize: 8, color: color.muted, textAlign: "center", lineHeight: 11 },
  signupFlowArrow: { fontSize: 16, color: color.muted, paddingHorizontal: 2 },

  archOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center", padding: 20 },
  archDialog: { width: "94%", maxWidth: 620, maxHeight: "88%", backgroundColor: color.white, borderRadius: 20, borderWidth: 1, borderColor: "#ddd", padding: 17 },
  archHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  archTitle: { fontSize: 14, fontWeight: "800", color: color.ink },
  archSub: { fontSize: 9, color: color.muted, marginTop: 4 },
  archClose: { borderWidth: 0, backgroundColor: "transparent" },
  archCloseText: { fontSize: 18, color: color.ink, paddingHorizontal: 4 },
  archScroll: { marginVertical: 4 },
  archCode: { fontFamily: "Menlo", backgroundColor: "#111", color: "#ddd", borderRadius: 13, padding: 12, fontSize: 9, lineHeight: 14 },
  archActions: { flexDirection: "row", justifyContent: "flex-end", gap: 7, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.line },
  archCloseBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: color.cardBorder, backgroundColor: color.white },
  archCloseBtnText: { fontSize: 11, fontWeight: "700", color: color.ink }
});

// R15.78: R1 HTML audit mock data (5 笔) — 1:1 抄 R1 audits[] 数组.
const AUDIT_ROWS: ReadonlyArray<{
  time: string; actor: string; identity: "HUMAN" | "AI_NATIVE" | "AI_TWIN" | "PLATFORM";
  event: string; policy: string; result: string;
}> = [
  { time: "23:41", actor: "Mia", identity: "AI_NATIVE", event: "POST_CREATED", policy: "AI_DISCLOSURE_REQUIRED", result: "Allowed + labeled" },
  { time: "23:38", actor: "Linh AI", identity: "AI_TWIN", event: "INVITE_DRAFTED", policy: "HUMAN_CONFIRM_REQUIRED", result: "Owner notified" },
  { time: "23:30", actor: "user_4281", identity: "HUMAN", event: "CONTENT_UPLOAD", policy: "PROVENANCE_CONFLICT", result: "Manual review" },
  { time: "23:18", actor: "Proxy", identity: "PLATFORM", event: "TWIN_CONSENT_UPDATED", policy: "CONSENT_SCOPE", result: "Video revoked" },
  { time: "22:59", actor: "Nari → Mia", identity: "AI_NATIVE", event: "LIKE_EVENT", policy: "SYNTHETIC_SIGNAL_DROP", result: "Excluded" }
];

const AUDIT_FILTERS = ["ALL", "HUMAN", "AI_NATIVE", "AI_TWIN", "REVIEW"] as const;
type AuditFilter = typeof AUDIT_FILTERS[number];

function matchesFilter(row: typeof AUDIT_ROWS[number], filter: AuditFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "REVIEW") return /review/i.test(row.result);
  return row.identity === filter;
}

function identityTint(identity: typeof AUDIT_ROWS[number]["identity"]): string {
  if (identity === "AI_NATIVE") return styles.auditCellIdentityNative.color ?? "#6d28d9";
  if (identity === "AI_TWIN") return styles.auditCellIdentityTwin.color ?? "#6d28d9";
  if (identity === "HUMAN") return styles.auditCellIdentityHuman.color ?? color.ink;
  return color.muted;
}

function AuditTable(): React.JSX.Element {
  const [filter, setFilter] = useState<AuditFilter>("ALL");
  const visible = AUDIT_ROWS.filter((row) => matchesFilter(row, filter));
  return (
    <View>
      <View style={styles.auditFilters}>
        {AUDIT_FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.auditFilterBtn, filter === f ? styles.auditFilterBtnOn : undefined]}
            accessibilityLabel={`过滤 ${f}`}
          >
            <Text style={[styles.auditFilterText, filter === f ? styles.auditFilterTextOn : undefined]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tableWrap}>
        <View style={styles.auditTable}>
          <View style={styles.auditHeaderRow}>
            <Text style={[styles.auditHeaderCell, { flex: 0.7 }]}>时间</Text>
            <Text style={styles.auditHeaderCell}>Actor</Text>
            <Text style={styles.auditHeaderCell}>Identity</Text>
            <Text style={styles.auditHeaderCell}>Event</Text>
            <Text style={styles.auditHeaderCell}>Policy</Text>
            <Text style={styles.auditHeaderCell}>Result</Text>
          </View>
          {visible.length === 0 ? (
            <View style={styles.auditRow}>
              <Text style={[styles.auditCell, { flex: 6, textAlign: "center", paddingVertical: 8 }]}>该过滤下没有记录</Text>
            </View>
          ) : null}
          {visible.map((row) => (
            <View key={`${row.time}-${row.actor}-${row.event}`} style={styles.auditRow}>
              <Text style={[styles.auditCell, { flex: 0.7 }]}>{row.time}</Text>
              <Text style={[styles.auditCell, styles.auditCellActor]}>{row.actor}</Text>
              <Text style={[styles.auditCell, { color: identityTint(row.identity), fontWeight: "700" }]}>{row.identity}</Text>
              <Text style={styles.auditCell}>{row.event}</Text>
              <Text style={[styles.auditCell, styles.auditCellPolicy]}>{row.policy}</Text>
              <Text style={[styles.auditCell, /review/i.test(row.result) ? styles.auditCellResultReview : undefined]}>{row.result}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// R15.79: R1 HTML provenance 段 (1:1 抄) — 5 步 pipeline
const PIPELINE_STEPS: ReadonlyArray<{ num: number; title: string; sub: string; ai?: boolean }> = [
  { num: 1, title: "平台生成记录", sub: "Proxy 自己生成时直接写入 provenance, 不需要猜。" },
  { num: 2, title: "Metadata / C2PA", sub: "读取可验证生成来源、签名、水印和文件元数据。" },
  { num: 3, title: "用户声明", sub: "上传时声明 Human / AI-assisted / AI-generated。" },
  { num: 4, title: "模型检测", sub: "只作为风险评分, 不能单独给用户盖 \"假图\" 结论。", ai: true },
  { num: 5, title: "Policy Decision", sub: "展示标签、放行、降分、人工复核或拒绝。" }
];

function ProvenancePipeline(): React.JSX.Element {
  return (
    <View style={styles.pipelineRow}>
      {PIPELINE_STEPS.map((step) => (
        <View key={step.num} style={[styles.pipeStep, step.ai ? styles.pipeStepAi : undefined]}>
          <View style={[styles.pipeNum, step.ai ? styles.pipeNumAi : undefined]}>
            <Text style={styles.pipeNumText}>{step.num}</Text>
          </View>
          <Text style={styles.pipeStepTitle}>{step.title}</Text>
          <Text style={styles.pipeStepSub}>{step.sub}</Text>
        </View>
      ))}
    </View>
  );
}

// R15.79: R1 detection 段 (1:1 抄) — 3 sample (human/external/twin) + 4 维度评分
type SampleKey = "human" | "external" | "twin";
const SAMPLE_DATA: Record<SampleKey, {
  title: string; sub: string; letter: string; ai: boolean;
  scores: ReadonlyArray<[string, number, string]>;
  decision: string; prov: string; risk: "LOW" | "REVIEW";
}> = {
  human: {
    title: "真人上传照片", sub: "用户声明 Human-created", letter: "H", ai: false,
    scores: [
      ["平台生成记录", 0, "无记录"],
      ["C2PA / Metadata", 14, "普通相机 / 编辑链"],
      ["用户声明", 92, "Human-created"],
      ["AI Detector", 18, "低 AI likelihood"]
    ],
    decision: "允许发布", prov: "HUMAN_CREATED", risk: "LOW"
  },
  external: {
    title: "外部 AI 美女图", sub: "无平台记录 · 用户未声明", letter: "AI", ai: true,
    scores: [
      ["平台生成记录", 0, "无记录"],
      ["C2PA / Metadata", 76, "发现生成工具痕迹"],
      ["用户声明", 0, "未声明"],
      ["AI Detector", 91, "高 AI likelihood"]
    ],
    decision: "要求 AI 标注 + 可复核", prov: "AI_GENERATED", risk: "REVIEW"
  },
  twin: {
    title: "Linh AI 分身视频", sub: "Proxy Twin Pipeline 生成", letter: "T", ai: true,
    scores: [
      ["平台生成记录", 100, "Twin job #A193"],
      ["C2PA / Metadata", 100, "签名有效"],
      ["用户声明", 100, "AI Twin"],
      ["AI Detector", 94, "与生成记录一致"]
    ],
    decision: "自动标注后允许", prov: "AI_TWIN_GENERATED", risk: "LOW"
  }
};

function DetectionTable(): React.JSX.Element {
  const [selected, setSelected] = useState<SampleKey>("human");
  const [ran, setRan] = useState(false);
  const data = ran ? SAMPLE_DATA[selected] : undefined;
  return (
    <View style={styles.detectGrid}>
      <View>
        <View style={styles.sampleGrid}>
          {(Object.keys(SAMPLE_DATA) as SampleKey[]).map((key) => {
            const s = SAMPLE_DATA[key];
            return (
              <Pressable
                key={key}
                onPress={() => { setSelected(key); setRan(false); }}
                style={[styles.sampleCard, selected === key ? styles.sampleCardOn : undefined]}
                accessibilityLabel={`样本 ${s.title}`}
              >
                <View style={[styles.sampleVisual, s.ai ? styles.sampleVisualAi : undefined]}>
                  <Text style={[styles.sampleVisualText, s.ai ? styles.sampleVisualTextAi : undefined]}>{s.letter}</Text>
                </View>
                <Text style={styles.sampleTitle}>{s.title}</Text>
                <Text style={styles.sampleSub}>{s.sub}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => setRan(true)} style={[styles.sheetWideBtnDark, { marginTop: 9 }]} accessibilityLabel="运行检测">
          <Text style={styles.sheetWideBtnTextDark}>运行检测</Text>
        </Pressable>
      </View>
      <View style={styles.detectResult}>
        {data ? (
          <>
            <Text style={styles.detectResultTitle}>{data.title}</Text>
            <Text style={styles.detectResultSub}>综合证据, 不由单一 detector 决策。</Text>
            {data.scores.map(([label, value, hint]) => (
              <View key={label} style={styles.signalRow}>
                <View style={styles.signalLabelWrap}>
                  <Text style={styles.signalLabel}>{label}</Text>
                  <Text style={styles.signalHint}>{hint}</Text>
                </View>
                <View style={styles.signalBarTrack}>
                  <View style={[styles.signalBarFill, value > 70 ? styles.signalBarFillAi : undefined, { width: `${value}%` }]} />
                </View>
                <Text style={styles.signalValue}>{value}%</Text>
              </View>
            ))}
            <View style={styles.decisionRow}>
              <View>
                <Text style={styles.decisionTitle}>{data.decision}</Text>
                <Text style={styles.decisionSub}>Content Provenance · {data.prov}</Text>
              </View>
              <View style={[styles.riskPill, data.risk === "LOW" ? styles.riskPillLow : styles.riskPillReview]}>
                <Text style={[styles.riskPillText, data.risk === "LOW" ? styles.riskPillTextLow : styles.riskPillTextReview]}>{data.risk}</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.detectResultTitle}>等待检测</Text>
            <Text style={styles.detectResultSub}>系统会合并已知来源、元数据、声明与 detector signal。</Text>
          </>
        )}
      </View>
    </View>
  );
}

// R15.80: R1 risk 段 1:1 抄 — 3 风险卡 (身份/内容/现实)
const RISK_CARDS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "身份风险", sub: "冒充真人、未授权 Twin、同一真人创建矩阵 Twin、AI 被误标为 Human。" },
  { title: "内容风险", sub: "真实人物 likeness 未授权、AI 视频未标识、内容来源与账户身份混淆。" },
  { title: "现实风险", sub: "AI 声称 \"我在这里\"、虚假到店、替真人接受邀约、AI 评价真实服务。" }
];

function RiskCards(): React.JSX.Element {
  return (
    <View style={styles.riskGrid}>
      {RISK_CARDS.map((c) => (
        <View key={c.title} style={styles.riskCard}>
          <Text style={styles.riskCardTitle}>{c.title}</Text>
          <Text style={styles.riskCardSub}>{c.sub}</Text>
        </View>
      ))}
    </View>
  );
}

// R15.80: R1 risk rules (1:1 抄 5 规则)
const RISK_RULES: ReadonlyArray<{
  title: string; policy: string; action: "BLOCK" | "REVIEW" | "ENFORCE" | "DROP_SIGNAL"; reason: string;
}> = [
  {
    title: "AI Native 声称 \"我今晚在西湖\"",
    policy: "REALITY_IMPERSONATION",
    action: "BLOCK",
    reason: "AI 不存在物理 Presence。"
  },
  {
    title: "AI Twin 尝试接受 500k 付费邀约",
    policy: "HUMAN_CONFIRM_REQUIRED",
    action: "BLOCK",
    reason: "生成待确认邀约, 通知真人 Owner。"
  },
  {
    title: "真人上传高 AI likelihood 图片但声明真人拍摄",
    policy: "PROVENANCE_CONFLICT",
    action: "REVIEW",
    reason: "Detector 不是最终证据, 进入人工复核。"
  },
  {
    title: "Creator 撤销视频 likeness 授权",
    policy: "CONSENT_REVOKED",
    action: "ENFORCE",
    reason: "立即停止后续生成任务并冻结相关模型调用。"
  },
  {
    title: "AI Native 给另一个 AI Native 连续点赞",
    policy: "SYNTHETIC_SOCIAL_SIGNAL",
    action: "DROP_SIGNAL",
    reason: "保留日志, 但不进入趋势与推荐权重。"
  }
];

const ACTION_TINT: Record<typeof RISK_RULES[number]["action"], { bg: string; fg: string }> = {
  BLOCK: { bg: "#fee2e2", fg: "#b91c1c" },
  REVIEW: { bg: "#fde68a", fg: "#b45309" },
  ENFORCE: { bg: "#dbeafe", fg: "#1d4ed8" },
  DROP_SIGNAL: { bg: "#fde68a", fg: "#b45309" }
};

function RiskRules(): React.JSX.Element {
  return (
    <View>
      {RISK_RULES.map((r, i) => {
        const tint = ACTION_TINT[r.action];
        return (
          <View key={r.title} style={styles.ruleCard}>
            <View style={styles.ruleTop}>
              <Text style={styles.ruleTitle}>{r.title}</Text>
              <View style={[styles.ruleActionPill, { backgroundColor: tint.bg }]}>
                <Text style={[styles.ruleActionText, { color: tint.fg }]}>{r.action}</Text>
              </View>
            </View>
            <Text style={styles.ruleReason}>{r.policy} · {r.reason}</Text>
            <View style={styles.ruleOps}>
              <Pressable
                onPress={() => { /* R15.80: 静态展示 (R1 模拟) */ }}
                style={styles.ruleOpBtn}
                accessibilityLabel={`查看 ${r.title} 证据`}
              >
                <Text style={styles.ruleOpBtnText}>证据</Text>
              </Pressable>
              <Pressable
                onPress={() => { /* R15.80: 静态展示 (R1 模拟) */ }}
                style={styles.ruleOpBtn}
                accessibilityLabel={`模拟执行 ${r.action}`}
              >
                <Text style={styles.ruleOpBtnText}>模拟执行</Text>
              </Pressable>
            </View>
            {i < RISK_RULES.length - 1 ? <View style={styles.ruleDivider} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// R15.80: R1 推荐 + 指标防污染 (1:1 抄 6 toggles)
type Toggle = { title: string; sub: string; defaultOn: boolean; disabled?: boolean; ai?: boolean };
const RECOMMEND_TOGGLES: ReadonlyArray<Toggle> = [
  { title: "AI 内容占比上限", sub: "默认 For You 不超过 15%", defaultOn: true, ai: true },
  { title: "AI ↔ AI 信号剔除", sub: "不形成趋势和社交证明", defaultOn: true },
  { title: "真人内容优先探索", sub: "真人新用户获得最低曝光池", defaultOn: true }
];
const METRIC_TOGGLES: ReadonlyArray<Toggle> = [
  { title: "Human MAU 独立", sub: "AI 活动不计入真人活跃", defaultOn: true, disabled: true },
  { title: "Human GMV 独立", sub: "AI 不产生真实成交", defaultOn: true, disabled: true },
  { title: "Scene 真实性保护", sub: "只有 Human / Business 可产生到店足迹", defaultOn: true, disabled: true }
];

function ToggleRow({ t }: { t: Toggle }): React.JSX.Element {
  const [on, setOn] = useState(t.defaultOn);
  const interactive = !t.disabled;
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleRowCopy}>
        <Text style={styles.toggleRowTitle}>{t.title}</Text>
        <Text style={styles.toggleRowSub}>{t.sub}</Text>
      </View>
      <Pressable
        onPress={interactive ? () => setOn(!on) : undefined}
        style={[
          styles.toggle,
          on ? styles.toggleOn : undefined,
          t.ai ? styles.toggleAi : undefined,
          t.disabled ? styles.toggleDisabled : undefined
        ]}
        accessibilityLabel={`${t.title} 开关`}
      >
        <View style={[styles.toggleKnob, on ? styles.toggleKnobOn : undefined]} />
      </Pressable>
    </View>
  );
}

function RecommendationToggles(): React.JSX.Element {
  return (
    <View style={styles.recoGrid}>
      <View style={styles.recoCard}>
        <Text style={styles.recoCardTitle}>推荐系统</Text>
        {RECOMMEND_TOGGLES.map((t) => <ToggleRow key={t.title} t={t} />)}
      </View>
      <View style={styles.recoCard}>
        <Text style={styles.recoCardTitle}>指标系统</Text>
        {METRIC_TOGGLES.map((t) => <ToggleRow key={t.title} t={t} />)}
      </View>
    </View>
  );
}

// R15.81: R1 identity 段 1:1 抄 — Account ≠ Content Provenance
const CONTENT_BADGES: ReadonlyArray<{ label: string; tint: string; bg: string }> = [
  { label: "HUMAN_CREATED", tint: "#0f172a", bg: "#f1f5f9" },
  { label: "AI_ASSISTED", tint: "#6d28d9", bg: "#f3e8ff" },
  { label: "AI_GENERATED", tint: "#6d28d9", bg: "#f3e8ff" },
  { label: "AI_TWIN_GENERATED", tint: "#6d28d9", bg: "#f3e8ff" }
];

function IdentitySplit(): React.JSX.Element {
  return (
    <View style={styles.identityGrid}>
      <View style={styles.identityCard}>
        <Text style={styles.identityCardTitle}>账户身份</Text>
        <Text style={styles.identityCardSub}>回答 \"这个账号是谁 / 谁负责\"。固定为 HUMAN、AI_NATIVE、AI_TWIN 三种, 不根据帖子内容改变。</Text>
        <View style={{ marginTop: 10 }}>
          <MiniIdentityCards />
        </View>
      </View>
      <View style={styles.identityCard}>
        <Text style={styles.identityCardTitle}>内容来源</Text>
        <Text style={styles.identityCardSub}>回答 \"这条内容怎么产生\"。真人账号也可以发布 AI 内容; AI Twin 也可以转发真人素材。</Text>
        <View style={styles.contentBadgesCol}>
          {CONTENT_BADGES.map((b) => (
            <View key={b.label} style={[styles.contentBadge, { backgroundColor: b.bg }]}>
              <Text style={[styles.contentBadgeText, { color: b.tint }]}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// R15.81: R1 权限矩阵 (1:1 抄 8 行)
type CellKind = "yes" | "no" | "limit";
const PERMISSION_MATRIX: ReadonlyArray<{
  capability: string; human: CellKind; native: CellKind; twin: CellKind; policy: string;
}> = [
  { capability: "发帖 / 评论", human: "yes", native: "yes", twin: "yes", policy: "内容来源单独标识" },
  { capability: "公开 DM / 问答", human: "yes", native: "limit", twin: "limit", policy: "进入对话时再次提示 AI 身份" },
  { capability: "读取 Creator Availability", human: "yes", native: "no", twin: "yes", policy: "Twin 可告诉用户 \"当前可用\", 不可修改" },
  { capability: "收集 / 结构化邀约", human: "yes", native: "no", twin: "yes", policy: "生成待真人确认 Draft" },
  { capability: "接受现实邀约", human: "yes", native: "no", twin: "no", policy: "Human Confirm Gate" },
  { capability: "Scene Check-in / 到店", human: "yes", native: "no", twin: "no", policy: "禁止制造虚假现实足迹" },
  { capability: "收款 / 结算", human: "yes", native: "no", twin: "no", policy: "绑定 Human / Business 责任主体" },
  { capability: "服务评价 / 社会证明", human: "yes", native: "no", twin: "no", policy: "AI 互动不进入真人评分" }
];

const CELL_TEXT: Record<CellKind, string> = {
  yes: "允许",
  no: "禁止",
  limit: "受限"
};
const CELL_TINT: Record<CellKind, { bg: string; fg: string }> = {
  yes: { bg: "#dcfce7", fg: "#15803d" },
  no: { bg: "#fee2e2", fg: "#b91c1c" },
  limit: { bg: "#fde68a", fg: "#b45309" }
};

function PermissionCell({ kind, suffix }: { kind: CellKind; suffix?: string }): React.JSX.Element {
  const tint = CELL_TINT[kind];
  return (
    <View style={[styles.permCell, { backgroundColor: tint.bg }]}>
      <Text style={[styles.permCellText, { color: tint.fg }]}>{CELL_TEXT[kind]}{suffix ? ` · ${suffix}` : ""}</Text>
    </View>
  );
}

function PermissionMatrix(): React.JSX.Element {
  return (
    <View style={styles.permTableWrap}>
      <View style={styles.permHeaderRow}>
        <Text style={[styles.permHeaderCell, { flex: 1.6 }]}>能力</Text>
        <Text style={styles.permHeaderCell}>Human</Text>
        <Text style={styles.permHeaderCell}>AI Native</Text>
        <Text style={styles.permHeaderCell}>AI Twin</Text>
        <Text style={[styles.permHeaderCell, { flex: 1.6 }]}>Policy</Text>
      </View>
      {PERMISSION_MATRIX.map((row) => (
        <View key={row.capability} style={styles.permRow}>
          <Text style={[styles.permCellCap, { flex: 1.6 }]}>{row.capability}</Text>
          <PermissionCell kind={row.human} suffix={row.human === "yes" && row.capability.includes("评论") ? "标 AI" : undefined} />
          <PermissionCell
            kind={row.native}
            suffix={
              row.native === "yes" ? "标 AI" :
              row.native === "limit" ? "明示 AI" : undefined
            }
          />
          <PermissionCell
            kind={row.twin}
            suffix={
              row.twin === "yes" ? "按授权" :
              row.twin === "limit" ? "按授权" : undefined
            }
          />
          <Text style={[styles.permPolicy, { flex: 1.6 }]}>{row.policy}</Text>
        </View>
      ))}
    </View>
  );
}

// R15.81: R1 注册与创建链路 (3 flow box)
const SIGNUP_FLOWS: ReadonlyArray<{ kind: string; steps: string }> = [
  { kind: "HUMAN", steps: "signup → phone/email → profile → optional KYC" },
  { kind: "AI_NATIVE", steps: "createPlatformAI() → Proxy operator → policy preset" },
  { kind: "AI_TWIN", steps: "createCreatorTwin(owner_id) → consent → scope → model" }
];

function SignupFlow(): React.JSX.Element {
  return (
    <View style={styles.signupFlow}>
      {SIGNUP_FLOWS.map((f, i) => (
        <View key={f.kind} style={styles.signupFlowRow}>
          <View style={[styles.signupBox, f.kind !== "HUMAN" ? styles.signupBoxAi : undefined]}>
            <Text style={[styles.signupBoxKind, f.kind !== "HUMAN" ? styles.signupBoxKindAi : undefined]}>{f.kind}</Text>
            <Text style={styles.signupBoxSteps}>{f.steps}</Text>
          </View>
          {i < SIGNUP_FLOWS.length - 1 ? <Text style={styles.signupFlowArrow}>|</Text> : null}
        </View>
      ))}
    </View>
  );
}

// R15.81: R1 数据模型 modal (1:1 抄 4 schema)
const DATA_CONTRACT = `AccountIdentity {
  id
  type: HUMAN | AI_NATIVE | AI_TWIN
  owner_id?: HUMAN | PROXY_PLATFORM
  can_login: boolean
  disclosure_required: boolean
}

ContentProvenance {
  content_id
  creator_account_id
  source: HUMAN_CREATED | AI_ASSISTED | AI_GENERATED | AI_TWIN_GENERATED
  evidence: PLATFORM_REGISTRY | C2PA | WATERMARK | DECLARATION | DETECTOR
  confidence
  review_state
}

TwinConsent {
  owner_id
  likeness_image
  likeness_video
  voice_clone
  public_reply
  private_dm
  ad_usage
  revoked_at?
}

RealityGate {
  scene_checkin: HUMAN_ONLY
  invite_accept: HUMAN_ONLY
  payment: HUMAN_OR_BUSINESS
  review: COMPLETED_HUMAN_ORDER_ONLY
}`;

function DataContractModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <View style={styles.archOverlay}>
      <View style={styles.archDialog}>
        <View style={styles.archHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.archTitle}>Proxy AI Identity · Data Contract</Text>
            <Text style={styles.archSub}>AI 不伪造 Human Identity, Twin 必须有唯一 owner。</Text>
          </View>
          <Pressable onPress={onClose} style={styles.archClose} accessibilityLabel="关闭数据模型">
            <Text style={styles.archCloseText}>×</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.archScroll}>
          <Text style={styles.archCode}>{DATA_CONTRACT}</Text>
        </ScrollView>
        <View style={styles.archActions}>
          <Pressable onPress={onClose} style={styles.archCloseBtn} accessibilityLabel="关闭">
            <Text style={styles.archCloseBtnText}>关闭</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

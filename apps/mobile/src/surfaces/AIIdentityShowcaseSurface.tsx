// AIIdentityShowcaseSurface — R1 AI Identity System (R1 HTML frontstage) 1:1 抄
// + TWIN-CENTER-004 真分身中心：Twin 段改为服务端真数据（我的分身列表、
// 从模板创建、形象授权开关接 /v1/ai/personas），其余 R1 合规展示段保持
// 静态 showcase（commander Phase 2 接线前不动）。
//
// R15.77: 3 个 phone preview (Human / AI Native / Twin) + 顶部 mini identity cards
// R15.79: + R1 provenance 段 (Content Provenance Pipeline + 3 sample + 4 维度评分)
// R15.80: + R1 risk 段 (3 风险卡 + 5 规则 + 推荐/指标 6 toggles)
// R15.81: + R1 identity 段 (Account≠ContentProvenance + 权限矩阵 8 行 + 注册链路 + 数据模型 modal)
// R15.82: + R1 native 段 (3 AI Persona 列表 + 冷启动 4 toggles + 2 强守门 rule)
// R15.83: + R1 twin 段 (2 Twin + 8 授权 toggles + Human Confirm Gate 3 flow)
// R15.84: + R1 overview 段 (hero + 3 边界 + 4 KPI + 3 identity cards + 3 flow)
//
// AI-CLUSTER-BOUNDARY-001: 这一屏只负责「分身的数字资产」（形象授权 + 授权后能
// 生成的照片/视频）。曾经挂在这里的两块已摘走：
//   * R15.78 的「审计日志」(R1 audit 静态 mock) —— 内容是 AI 生成/授权/策略事件，
//     不是本屏该管的资产，也不是关系屏的互动记录，等 R1 reality gate 接线后归合规面。
//   * TWIN-SIGNALS-001 / MEDIA-DWELL-001 的「动态数据」(谁看了你的动态、看了多久)
//     —— 那是关系运营数据，归「好友与关系」(friend-crm)。同一份 MEDIA-DWELL-001
//     数据曾经在两屏各画一遍。
// 边界见 me.tsx 的 AI-FACET-CLUSTER-001：好友与关系管运营 · AI 分身出内容 · FACET 管投放。
//
// 设计: 1:1 抄 R1 HTML 视觉, 不自创.
//
// 这是静态 design showcase (我域), 不接 server. commander 域 R1 full wiring
// (R1 reality gate + Twin consent) 是 Phase 2.

import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { AiPersonaClient, TwinNoAgeEvidenceError, TwinNoLiveConsentError, type TwinConsent, type TwinConsentKind, type TwinPersona } from "../ai-persona-client";
import type { TransportResponse } from "../auth-client";
import { TwinInsightSection } from "../components/twin-insight-section";
import { formatDateOfBirthInput } from "../date-of-birth-input";

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

export function AIIdentityShowcaseSurface({ onBack, viewerAccountId, authClient, onOpenFacet }: {
  onBack: () => void;
  viewerAccountId: string | undefined;
  authClient: { request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<TransportResponse> };
  /** AI-FACET-CLUSTER-001: 分身生成的素材由 FACET 负责按关系对象分发——
   * 这条链路的下一步，给一条明显的路过去，不用退回「我的」根页再找。 */
  onOpenFacet?: () => void;
}): React.JSX.Element {
  const [archOpen, setArchOpen] = useState(false);
  const personaClient = useMemo(() => new AiPersonaClient({ authClient }), [authClient]);
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pageHead}>
          <Text onPress={onBack} style={styles.back}>‹</Text>
          <Text style={styles.title}>AI分身中心</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setArchOpen(true)}
            style={styles.archBtn}
            accessibilityLabel="查看数据模型"
          >
            <Text style={styles.archBtnText}>数据模型</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>我的数字分身 · 邀约与发布由真人确认</Text>

        {/* TWIN-CENTER-004: 真分身段 —— 服务端真列表 + 从模板创建 + 形象授权
            开关。不再是写死的 Linh/Mai。
            AI-CLUSTER-BOUNDARY-001: 这一屏只管「分身的数字资产」——
            谁看了、看了多久（访问战绩）和活动日志都在「好友与关系」里，
            不在这里再渲染一遍（同一份 MEDIA-DWELL-001 数据曾经两屏各画一次）。 */}
        <TwinSection client={personaClient} ownerId={viewerAccountId} />

        {/* TWIN-INSIGHT-001: 好友洞察段（用户 2026-09-21 原型落位：AI 分身页）。
            AI-CLUSTER-BOUNDARY-001 的本意是同一份 MEDIA-DWELL 明细不两屏各画
            一遍；本段走独立的 TwinInsight wire（服务端算好的洞察），未登录/
            未接线时用明示的本机演示数据，好友页的明细不动。 */}
        <TwinInsightSection authClient={authClient} ownerId={viewerAccountId} />

        {onOpenFacet ? (
          <Pressable onPress={onOpenFacet} style={styles.facetLinkCard} accessibilityLabel="去 FACET 管理素材怎么分发">
            <View style={styles.facetLinkCopy}>
              <Text style={styles.facetLinkTitle}>内容投给谁看？</Text>
              <Text style={styles.facetLinkSub}>去 FACET 按关系对象投放，不是所有人都看一样的内容。</Text>
            </View>
            <Text style={styles.facetLinkChevron}>›</Text>
          </Pressable>
        ) : null}

        {/* R15.84: R1 overview 段 — hero + 3 边界 + 4 KPI + 3 identity cards + 3 flow */}
        <OverviewHero />

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

        {/* R15.82: R1 native 段 — 3 AI Persona 列表 + 冷启动 4 toggles + 2 强守门 rule */}
        <NativeSection />

        <Text style={styles.sectionTitle}>前台身份与内容标识</Text>
        <Text style={styles.sectionSub}>用户第一眼就知道谁是真人、谁是 AI、谁是谁的 Twin。</Text>
        <View style={styles.grid3}>
          <ProfilePreview kind="human" />
          <ProfilePreview kind="native" />
          <ProfilePreview kind="twin" />
        </View>

        {/* AI-CLUSTER-BOUNDARY-001: 「审计日志」（R15.78 的 R1 audit 段）已从本屏
            摘掉。它是 1:1 抄 R1 HTML 的静态 mock，内容全是 AI 生成/授权/策略事件，
            既不是本屏该管的「数字资产」，也不是「好友与关系」的互动记录 ——
            搬到关系屏只会把假数据摊到另一个真模块里。真实审计要等 R1 reality gate
            接线，届时归合规/运营面，不归这两屏。 */}

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
  pBadgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
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
  postAvaTextAi: { fontSize: 9 },
  postCopy: { flex: 1 },
  postHeadRow: { flexDirection: "row", justifyContent: "space-between" },
  postName: { fontSize: 10, fontWeight: "800", color: color.ink },
  postTime: { fontSize: 9, color: color.muted },
  postText: { fontSize: 10, color: color.ink, lineHeight: 13, marginTop: 1 },
  pOrigin: { fontSize: 9, color: color.muted, marginTop: 2 },
  pOriginAi: { color: "#6d28d9", fontWeight: "700" },
  postActions: { fontSize: 9, color: color.muted, marginTop: 3 },

  // R15.79: R1 provenance pipeline (5 步)
  pipelineRow: { flexDirection: "row", gap: 6, marginBottom: 14 },
  pipeStep: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, alignItems: "center" },
  pipeStepAi: { borderColor: "#6d28d9" },
  pipeNum: { width: 18, height: 18, borderRadius: 999, backgroundColor: color.ink, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  pipeNumAi: { backgroundColor: "#6d28d9" },
  pipeNumText: { color: color.white, fontSize: 9, fontWeight: "800" },
  pipeStepTitle: { fontSize: 10, fontWeight: "800", color: color.ink, textAlign: "center", marginBottom: 2 },
  pipeStepSub: { fontSize: 9, color: color.muted, textAlign: "center", lineHeight: 11 },

  // R15.79: R1 detection 段 (sample grid + result)
  detectGrid: { flexDirection: "row", gap: 10 },
  sampleGrid: { gap: 6 },
  sampleCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8 },
  sampleCardOn: { borderColor: color.ink, backgroundColor: color.appBg },
  sampleVisual: { width: 30, height: 30, borderRadius: 999, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  sampleVisualAi: { backgroundColor: "#6d28d9" },
  sampleVisualText: { color: color.white, fontSize: 12, fontWeight: "800" },
  sampleVisualTextAi: { fontSize: 9 },
  sampleTitle: { fontSize: 11, fontWeight: "800", color: color.ink },
  sampleSub: { fontSize: 9, color: color.muted },

  detectResult: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10 },
  detectResultTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 2 },
  detectResultSub: { fontSize: 9, color: "#777", marginBottom: 8 },

  signalRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  signalLabelWrap: { flex: 1.4 },
  signalLabel: { fontSize: 9, fontWeight: "700", color: color.ink },
  signalHint: { fontSize: 9, color: color.muted },
  signalBarTrack: { flex: 1.6, height: 6, backgroundColor: color.appBg, borderRadius: 3, overflow: "hidden" },
  signalBarFill: { height: 6, backgroundColor: color.ink, borderRadius: 3 },
  signalBarFillAi: { backgroundColor: "#6d28d9" },
  signalValue: { width: 30, fontSize: 9, fontWeight: "800", color: color.ink, textAlign: "right" },

  decisionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: color.cardBorder },
  decisionTitle: { fontSize: 11, fontWeight: "800", color: color.ink },
  decisionSub: { fontSize: 9, color: color.muted },
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
  toggleRowSub: { fontSize: 9, color: color.muted, marginTop: 1 },
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
  permCellText: { fontSize: 9, fontWeight: "800", textAlign: "center" },
  permPolicy: { fontSize: 9, color: color.muted, lineHeight: 11, paddingLeft: 4 },

  signupFlow: { flexDirection: "row", alignItems: "stretch", gap: 4, marginBottom: 4 },
  signupFlowRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  signupBox: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, alignItems: "center" },
  signupBoxAi: { borderColor: "#6d28d9" },
  signupBoxKind: { fontSize: 11, fontWeight: "800", color: color.ink, marginBottom: 2 },
  signupBoxKindAi: { color: "#6d28d9" },
  signupBoxSteps: { fontSize: 9, color: color.muted, textAlign: "center", lineHeight: 11 },
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
  archCloseBtnText: { fontSize: 11, fontWeight: "700", color: color.ink },

  // R15.82: R1 native 段 (3 persona + 冷启动 4 toggles + 2 强守门)
  nativeGrid: { flexDirection: "row", gap: 10 },
  personaRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, marginBottom: 6 },
  personaAvatar: { width: 32, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  personaAvatarAi: { backgroundColor: "#6d28d9" },
  personaAvatarText: { color: color.white, fontSize: 12, fontWeight: "800" },
  personaCopy: { flex: 1 },
  personaNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  personaName: { fontSize: 11, fontWeight: "800", color: color.ink },
  personaBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  personaBadgeAi: { backgroundColor: "#f3e8ff" },
  personaBadgeText: { fontSize: 9, fontWeight: "800", color: "#6d28d9" },
  personaRole: { fontSize: 9, color: color.muted, marginTop: 1 },
  personaOwner: { fontSize: 9, color: color.muted },
  personaActions: { alignItems: "flex-end" },
  personaState: { fontSize: 9, color: color.muted, fontStyle: "italic", marginBottom: 4 },
  personaPolicyBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: color.cardBorder, backgroundColor: color.appBg },
  personaPolicyBtnText: { fontSize: 9, fontWeight: "700", color: color.ink },

  personaCreateBtn: { paddingVertical: 8, borderRadius: 8, alignItems: "center", borderWidth: 1 },
  personaCreateBtnAi: { backgroundColor: "#6d28d9", borderColor: "#6d28d9" },
  personaCreateBtnText: { fontSize: 10, fontWeight: "800", color: color.white },

  // TWIN-CENTER-004: 真分身段样式。新增文字字号全部 >= 11pt，不进 R2 装饰白名单。
  twinHint: { fontSize: 12, color: color.muted, lineHeight: 17, marginBottom: 8 },
  twinNotice: { flexDirection: "row", alignItems: "center", backgroundColor: color.appBg, borderRadius: 12, padding: 10, marginBottom: 8, gap: 8 },
  twinNoticeText: { flex: 1, fontSize: 12, color: color.ink, fontWeight: "700" },
  twinRetry: { paddingHorizontal: 10, paddingVertical: 6 },
  twinRetryText: { fontSize: 12, fontWeight: "800", color: color.ink },
  twinError: { fontSize: 11, color: "#b91c1c", lineHeight: 15, marginTop: 4 },
  twinForm: { marginTop: 8, gap: 8 },
  twinTemplate: { flexDirection: "row", alignItems: "center", backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10, gap: 8 },
  twinTemplateOn: { borderColor: "#6d28d9", borderWidth: 1.5 },
  twinTemplateCopy: { flex: 1 },
  twinTemplateName: { fontSize: 13, fontWeight: "800", color: color.ink },
  twinTemplateDesc: { fontSize: 11, color: color.muted, marginTop: 2, lineHeight: 15 },
  twinTemplateTag: { fontSize: 11, fontWeight: "700", color: "#6d28d9" },
  twinInput: { backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, fontSize: 14, color: color.ink, paddingHorizontal: 12, paddingVertical: 10 },
  twinSubmit: { backgroundColor: color.ink, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  twinSubmitBusy: { opacity: 0.5 },
  twinSubmitText: { fontSize: 14, fontWeight: "800", color: color.white },
  twinBackfillRow: { flexDirection: "row", gap: 8 },
  twinBackfillInput: { flex: 1 },
  twinBackfillBtn: { backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
  twinBackfillBtnText: { fontSize: 13, fontWeight: "800", color: color.white },

  // AI-FACET-CLUSTER-001: 生成 (这一屏) → 分发 (FACET) 的跨屏入口。
  facetLinkCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f3e8ff", borderWidth: 1, borderColor: "#e4d2fb", borderRadius: 14, padding: 12, marginTop: 14 },
  facetLinkCopy: { flex: 1 },
  facetLinkTitle: { fontSize: 13, fontWeight: "800", color: "#6d28d9" },
  facetLinkSub: { fontSize: 11, color: "#5b21b6", marginTop: 3, lineHeight: 15 },
  facetLinkChevron: { fontSize: 20, color: "#6d28d9" },

  coldCard: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 10 },
  coldCardTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 4 },
  coldCardSub: { fontSize: 9, color: color.muted, lineHeight: 13 },
  coldRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, borderTopWidth: 1, borderTopColor: color.cardBorder },
  coldRowBlocked: { opacity: 0.5 },
  coldRowCopy: { flex: 1 },
  coldRowTitle: { fontSize: 10, fontWeight: "800", color: color.ink },
  coldRowSub: { fontSize: 9, color: color.muted, marginTop: 1 },

  // R15.83: R1 twin 段 (2 Twin + 8 授权 toggles + Human Confirm 3 flow)
  confirmFlow: { flexDirection: "row", alignItems: "stretch", gap: 4, marginTop: 12 },
  confirmBox: { flex: 1, backgroundColor: color.appBg, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 8, padding: 6, alignItems: "center", justifyContent: "center" },
  confirmBoxOn: { backgroundColor: "#dcfce7", borderColor: "#15803d" },
  confirmBoxTitle: { fontSize: 9, fontWeight: "800", color: color.ink, marginBottom: 2, textAlign: "center" },
  confirmBoxSub: { fontSize: 9, color: color.muted, textAlign: "center", lineHeight: 11 },
  confirmArrow: { fontSize: 14, color: color.muted, alignSelf: "center" },

  // R15.84: R1 overview 段
  overviewHero: { flexDirection: "row", gap: 10, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 14, padding: 12 },
  heroMain: { flex: 1.4 },
  heroKicker: { alignSelf: "flex-start", backgroundColor: color.appBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginBottom: 6 },
  heroKickerText: { fontSize: 9, fontWeight: "800", color: color.muted, letterSpacing: 0.4 },
  heroTitle: { fontSize: 20, fontWeight: "800", color: color.ink, letterSpacing: -0.5, marginBottom: 6, lineHeight: 26 },
  heroSub: { fontSize: 10, color: color.muted, lineHeight: 14, marginBottom: 8 },
  heroRules: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  heroRulePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: color.appBg, borderWidth: 1, borderColor: color.cardBorder },
  heroRulePillText: { fontSize: 9, fontWeight: "800", color: color.ink },

  heroSide: { flex: 1, backgroundColor: color.appBg, borderRadius: 10, padding: 8 },
  heroSideLabel: { fontSize: 9, fontWeight: "800", color: color.muted, letterSpacing: 0.4, marginBottom: 4 },
  heroSideTitle: { fontSize: 12, fontWeight: "800", color: color.ink, marginBottom: 6 },
  heroBoundary: { flexDirection: "row", gap: 4, marginBottom: 4 },
  heroBoundaryBullet: { fontSize: 10, color: color.ink, fontWeight: "800" },
  heroBoundaryText: { flex: 1, fontSize: 9, color: color.ink, lineHeight: 13 },

  kpiGrid: { flexDirection: "row", gap: 6 },
  kpiCard: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, alignItems: "center" },
  kpiCardAi: { borderColor: "#6d28d9" },
  kpiCardRisk: { borderColor: "#b45309" },
  kpiValue: { fontSize: 18, fontWeight: "800", color: color.ink, marginBottom: 2 },
  kpiValueAi: { color: "#6d28d9" },
  kpiValueRisk: { color: "#b45309" },
  kpiLabel: { fontSize: 9, color: color.muted, textAlign: "center" },

  identityCardsRow: { flexDirection: "row", gap: 6 },
  identityBigCard: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 12, padding: 8 },
  identityBigPill: { alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, marginBottom: 5 },
  identityBigPillText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  identityBigTitle: { fontSize: 11, fontWeight: "800", color: color.ink, marginBottom: 3 },
  identityBigDesc: { fontSize: 9, color: color.muted, lineHeight: 11 },
  identityBigRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, borderTopWidth: 1, borderTopColor: color.cardBorder },
  identityBigRowLabel: { fontSize: 9, color: color.muted, fontWeight: "700", flex: 1 },
  identityBigRowValueWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  identityBigRowValue: { fontSize: 9, fontWeight: "800", color: color.ink },
  dotSafe: { width: 8, height: 8, borderRadius: 999, backgroundColor: "#15803d" },
  dotBlock: { width: 8, height: 8, borderRadius: 999, backgroundColor: "#b91c1c" },
  dotReview: { width: 8, height: 8, borderRadius: 999, backgroundColor: "#b45309" },

  coreFlow: { gap: 4 },
  coreFlowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  coreFlowBox: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.cardBorder, borderRadius: 10, padding: 8, alignItems: "center" },
  coreFlowTitle: { fontSize: 10, fontWeight: "800", color: color.ink, marginBottom: 2, textAlign: "center" },
  coreFlowSub: { fontSize: 9, color: color.muted, textAlign: "center", lineHeight: 11 },
  coreFlowArrow: { fontSize: 16, color: color.muted, paddingHorizontal: 2 }
});

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
        <Pressable onPress={() => setRan(true)} style={[styles.pActionDark, { marginTop: 9, paddingVertical: 9, borderRadius: 10 }]} accessibilityLabel="运行检测">
          <Text style={[styles.pActionDarkText, { fontSize: 13 }]}>运行检测</Text>
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

function PermissionCell({ kind, suffix }: { kind: CellKind; suffix?: string | undefined }): React.JSX.Element {
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

// R15.82: R1 native 段 1:1 抄 — 3 AI Persona 列表 (1:1 抄 R1 S.native) + 冷启动 4 toggles + 2 强守门 rule
const AI_PERSONAS: ReadonlyArray<{ name: string; role: string; state: string }> = [
  { name: "Mia", role: "城市灵感 · AI Creator", state: "运行中" },
  { name: "Nari", role: "咖啡 / 生活方式", state: "运行中" },
  { name: "Leo", role: "活动发现", state: "暂停" }
];

const COLD_START_TOGGLES: ReadonlyArray<{ title: string; sub: string; defaultOn: boolean; disabled?: boolean; ai?: boolean }> = [
  { title: "AI Feed 上限", sub: "For You 默认 ≤ 15%", defaultOn: true, ai: true },
  { title: "允许 AI 公开评论", sub: "必须显示 AI 身份", defaultOn: true },
  { title: "允许 AI 主动私信", sub: "默认关闭, 避免骚扰", defaultOn: false },
  { title: "允许 AI Scene Check-in", sub: "永久禁止", defaultOn: false, disabled: true }
];

function ColdStartToggle({ t }: { t: typeof COLD_START_TOGGLES[number] }): React.JSX.Element {
  const [on, setOn] = useState(t.defaultOn);
  return (
    <View style={[styles.coldRow, t.disabled ? styles.coldRowBlocked : undefined]}>
      <View style={styles.coldRowCopy}>
        <Text style={styles.coldRowTitle}>{t.title}</Text>
        <Text style={styles.coldRowSub}>{t.sub}</Text>
      </View>
      {t.disabled ? (
        <View style={[styles.toggle, t.disabled ? styles.toggleDisabled : undefined]}>
          <View style={styles.toggleKnob} />
        </View>
      ) : (
        <Pressable
          onPress={() => setOn(!on)}
          style={[styles.toggle, on ? styles.toggleOn : undefined, t.ai ? styles.toggleAi : undefined]}
          accessibilityLabel={`${t.title} 开关`}
        >
          <View style={[styles.toggleKnob, on ? styles.toggleKnobOn : undefined]} />
        </Pressable>
      )}
    </View>
  );
}

function NativeSection(): React.JSX.Element {
  const [personas, setPersonas] = useState(AI_PERSONAS);
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={styles.sectionTitle}>平台 AI Persona</Text>
      <Text style={styles.sectionSub}>纯虚拟 · 不对应真人。</Text>
      <View style={styles.nativeGrid}>
        <View>
          {personas.map((p, i) => (
            <View key={p.name} style={styles.personaRow}>
              <View style={[styles.personaAvatar, styles.personaAvatarAi]}>
                <Text style={styles.personaAvatarText}>{p.name.charAt(0)}</Text>
              </View>
              <View style={styles.personaCopy}>
                <View style={styles.personaNameRow}>
                  <Text style={styles.personaName}>{p.name}</Text>
                  <View style={[styles.personaBadge, styles.personaBadgeAi]}><Text style={styles.personaBadgeText}>AI</Text></View>
                </View>
                <Text style={styles.personaRole}>{p.role}</Text>
                <Text style={styles.personaOwner}>Owner · Proxy Platform</Text>
              </View>
              <View style={styles.personaActions}>
                <Text style={styles.personaState}>{p.state}</Text>
                <Pressable
                  onPress={() => { /* R15.82: 静态展示 (R1 模拟) */ }}
                  style={styles.personaPolicyBtn}
                  accessibilityLabel={`${p.name} 策略`}
                >
                  <Text style={styles.personaPolicyBtnText}>策略</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => { /* R15.82: 静态展示 (R1 模拟 openNativeModal) */ }}
            style={[styles.personaCreateBtn, styles.personaCreateBtnAi]}
            accessibilityLabel="创建新的 AI Persona"
          >
            <Text style={styles.personaCreateBtnText}>＋ 创建新的 AI Persona</Text>
          </Pressable>
        </View>
        <View style={styles.coldCard}>
          <Text style={styles.coldCardTitle}>冷启动控制</Text>
          <Text style={styles.coldCardSub}>AI 可以增加内容密度, 但必须避免制造 \"已经有很多真人\" 的虚假社会证明。</Text>
          <View style={{ marginTop: 10 }}>
            {COLD_START_TOGGLES.map((t) => <ColdStartToggle key={t.title} t={t} />)}
          </View>
          <View style={styles.ruleCard}>
            <View style={styles.ruleTop}>
              <Text style={styles.ruleTitle}>Human MAU / GMV 隔离</Text>
              <View style={[styles.ruleActionPill, { backgroundColor: "#dcfce7" }]}>
                <Text style={[styles.ruleActionText, { color: "#15803d" }]}>强制</Text>
              </View>
            </View>
            <Text style={styles.ruleReason}>AI Native、AI Twin 的自动行为独立统计, 不计入 Human MAU、真实成交、真实到店、Creator 履约率。</Text>
          </View>
          <View style={styles.ruleCard}>
            <View style={styles.ruleTop}>
              <Text style={styles.ruleTitle}>AI ↔ AI 放大阻断</Text>
              <View style={[styles.ruleActionPill, { backgroundColor: "#dcfce7" }]}>
                <Text style={[styles.ruleActionText, { color: "#15803d" }]}>强制</Text>
              </View>
            </View>
            <Text style={styles.ruleReason}>AI 账号之间的 Like / Reply / Follow 不形成趋势信号, 不参与自然推荐权重。</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// TWIN-CENTER-004: 真分身段 —— 服务端真列表 + 从模板创建 + 形象授权开关。
// 后端 consent 只有 VISUAL / VOICE / VISUAL_AND_VOICE 三种，且查 live 只
// 返回最新一条，所以开关只有一档「形象与声音」：开 = 授予
// VISUAL_AND_VOICE，关 = 收回当前生效授权。R1 原型里 7 个用途开关在
// 服务端没有对应物，不画假开关。
const DEFAULT_TWIN_TEMPLATE = { id: "greeter", name: "公开互动助手", desc: "在你的公开动态下帮你互动，不私聊、不接单。", consent: true };
const TWIN_TEMPLATES: ReadonlyArray<{ id: string; name: string; desc: string; consent: boolean }> = [
  DEFAULT_TWIN_TEMPLATE,
  { id: "collector", name: "邀约收集助手", desc: "把邀约整理成待确认清单，真人确认才生效。", consent: false },
  { id: "likeness", name: "形象出镜助手", desc: "用你的授权形象生成照片与短视频。", consent: true },
];

type TwinRowState = { persona: TwinPersona; live: TwinConsent | null; liveOk: boolean };

function consentScopeLabel(kind: TwinConsentKind): string {
  if (kind === "VISUAL") return "形象";
  if (kind === "VOICE") return "声音";
  return "形象与声音";
}

function TwinSection({ client, ownerId }: {
  client: AiPersonaClient;
  ownerId: string | undefined;
}): React.JSX.Element {
  const [rows, setRows] = useState<TwinRowState[] | undefined>(undefined);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [busyId, setBusyId] = useState<string>();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TWIN_TEMPLATE.id);
  const [draftName, setDraftName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string>();
  // AGE-BACKFILL-001: 创建被「无年龄记录」拦下时，在表单里直接补出生日期，
  // 补完自动重试创建，不让用户跳出去找入口。
  const [needsAgeBackfill, setNeedsAgeBackfill] = useState(false);
  const [dobInput, setDobInput] = useState("");

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    setLoadState("loading");
    void (async () => {
      try {
        const personas = await client.listMine(ownerId);
        const states = await Promise.all(personas.map(async (persona): Promise<TwinRowState> => {
          try {
            const live = await client.getLiveConsent(persona.id, ownerId);
            return { persona, live: live ?? null, liveOk: true };
          } catch {
            return { persona, live: null, liveOk: false };
          }
        }));
        if (!cancelled) { setRows(states); setLoadState("ready"); }
      } catch {
        if (!cancelled) { setRows(undefined); setLoadState("failed"); }
      }
    })();
    return () => { cancelled = true; };
  }, [client, ownerId, reloadNonce]);

  async function toggleConsent(personaId: string): Promise<void> {
    if (!ownerId || busyId) return;
    const row = rows?.find((entry) => entry.persona.id === personaId);
    if (!row) return;
    setBusyId(personaId);
    setRowErrors((prev) => {
      if (!prev[personaId]) return prev;
      const next = { ...prev };
      delete next[personaId];
      return next;
    });
    try {
      if (row.live) {
        await client.revokeConsent(personaId, ownerId);
        setRows((prev) => prev?.map((entry) => entry.persona.id === personaId ? { ...entry, live: null, liveOk: true } : entry));
      } else {
        const live = await client.grantConsent(personaId, ownerId, "VISUAL_AND_VOICE");
        setRows((prev) => prev?.map((entry) => entry.persona.id === personaId ? { ...entry, live, liveOk: true } : entry));
      }
    } catch (err) {
      // 收回时服务端已没有生效授权（别的设备先收了）：这本身就是想要的
      // 终态，直接标成未授权，不吓人。
      if (err instanceof TwinNoLiveConsentError) {
        setRows((prev) => prev?.map((entry) => entry.persona.id === personaId ? { ...entry, live: null, liveOk: true } : entry));
      } else {
        setRowErrors((prev) => ({ ...prev, [personaId]: err instanceof Error ? err.message : "操作失败，请稍后重试。" }));
      }
    } finally {
      setBusyId(undefined);
    }
  }

  async function submitCreate(): Promise<void> {
    if (!ownerId || createBusy) return;
    setCreateBusy(true);
    setCreateError(undefined);
    try {
      await doCreate();
    } finally {
      setCreateBusy(false);
    }
  }

  async function doCreate(): Promise<void> {
    if (!ownerId) return;
    const template = TWIN_TEMPLATES.find((entry) => entry.id === templateId) ?? DEFAULT_TWIN_TEMPLATE;
    try {
      const persona = await client.createTwin({ ownerId, displayName: draftName.trim() || template.name, description: template.desc });
      if (template.consent) {
        try {
          await client.grantConsent(persona.id, ownerId, "VISUAL_AND_VOICE");
        } catch (consentErr) {
          // 分身已建成，只是授权没加上：留在表单里说清楚，不吞掉；
          // 列表照样刷新，去行里单独开开关也行。
          setReloadNonce((n) => n + 1);
          setCreateError(`分身已创建，但形象授权没加上（${consentErr instanceof Error ? consentErr.message : "请稍后重试"}），可以在列表里单独打开。`);
          return;
        }
      }
      setCreateOpen(false);
      setDraftName("");
      setDobInput("");
      setNeedsAgeBackfill(false);
      setTemplateId(DEFAULT_TWIN_TEMPLATE.id);
      setReloadNonce((n) => n + 1);
    } catch (err) {
      if (err instanceof TwinNoAgeEvidenceError) setNeedsAgeBackfill(true);
      setCreateError(err instanceof Error ? err.message : "创建失败，请稍后重试。");
    }
  }

  // 补完出生日期直接重试刚才那次创建 —— 补录本身不是目的，建成才是。
  async function backfillAgeAndRetry(): Promise<void> {
    if (!ownerId || createBusy) return;
    setCreateBusy(true);
    setCreateError(undefined);
    try {
      await client.recordAgeAssertion(dobInput);
      setNeedsAgeBackfill(false);
      await doCreate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "补录失败，请稍后重试。");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <View style={{ marginTop: 18 }}>
      <Text style={styles.sectionTitle}>我的分身</Text>
      <Text style={styles.sectionSub}>形象授权随时可收回，收回记录保留可查。</Text>
      {!ownerId ? (
        <Text style={styles.twinHint}>登录后管理你的数字分身。</Text>
      ) : loadState === "failed" ? (
        <View style={styles.twinNotice}>
          <Text style={styles.twinNoticeText}>分身没读出来，不是没有分身。</Text>
          <Pressable onPress={() => setReloadNonce((n) => n + 1)} accessibilityLabel="重新读取分身" style={styles.twinRetry}>
            <Text style={styles.twinRetryText}>重试</Text>
          </Pressable>
        </View>
      ) : loadState === "loading" || rows === undefined ? (
        <Text style={styles.twinHint}>正在读取分身…</Text>
      ) : (
        <View>
          {rows.length === 0 ? <Text style={styles.twinHint}>还没有分身，从下面的模板创建一个。</Text> : null}
          {rows.map(({ persona, live, liveOk }) => {
            const rowError = rowErrors[persona.id];
            return (
            <View key={persona.id} style={styles.personaRow}>
              <View style={[styles.personaAvatar, styles.personaAvatarAi]}>
                <Text style={styles.personaAvatarText}>{persona.displayName.charAt(0)}</Text>
              </View>
              <View style={styles.personaCopy}>
                <View style={styles.personaNameRow}>
                  <Text style={styles.personaName}>{persona.displayName}</Text>
                  <View style={[styles.personaBadge, styles.personaBadgeAi]}><Text style={styles.personaBadgeText}>AI TWIN</Text></View>
                </View>
                <Text style={styles.personaRole}>
                  {live ? `已授权 · ${consentScopeLabel(live.consentKind)}` : liveOk ? "未授权形象" : "授权状态没读出来"}
                </Text>
                {persona.description ? <Text style={styles.personaOwner}>{persona.description}</Text> : null}
                {rowError ? <Text style={styles.twinError}>{rowError}</Text> : null}
              </View>
              <View style={styles.personaActions}>
                <Text style={styles.personaState}>形象授权</Text>
                {busyId === persona.id ? (
                  <Text style={styles.personaState}>处理中…</Text>
                ) : (
                  <Pressable
                    onPress={() => void toggleConsent(persona.id)}
                    style={[styles.toggle, live ? styles.toggleOn : undefined, styles.toggleAi]}
                    accessibilityLabel={`${persona.displayName}形象授权开关`}
                  >
                    <View style={[styles.toggleKnob, live ? styles.toggleKnobOn : undefined]} />
                  </Pressable>
                )}
              </View>
            </View>
            );
          })}
        </View>
      )}
      {ownerId ? (
        <View>
          <Pressable
            onPress={() => { setCreateOpen((open) => !open); setCreateError(undefined); }}
            style={[styles.personaCreateBtn, styles.personaCreateBtnAi]}
            accessibilityLabel="从模板创建分身"
          >
            <Text style={styles.personaCreateBtnText}>{createOpen ? "× 收起创建" : "＋ 从模板创建分身"}</Text>
          </Pressable>
          {createOpen ? (
            <View style={styles.twinForm}>
              {TWIN_TEMPLATES.map((template) => (
                <Pressable
                  key={template.id}
                  onPress={() => setTemplateId(template.id)}
                  style={[styles.twinTemplate, template.id === templateId ? styles.twinTemplateOn : undefined]}
                  accessibilityLabel={`模板${template.name}`}
                >
                  <View style={styles.twinTemplateCopy}>
                    <Text style={styles.twinTemplateName}>{template.name}</Text>
                    <Text style={styles.twinTemplateDesc}>{template.desc}</Text>
                  </View>
                  <Text style={styles.twinTemplateTag}>{template.consent ? "含形象授权" : "不需形象授权"}</Text>
                </Pressable>
              ))}
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="给分身起个名字（默认用模板名）"
                placeholderTextColor={color.muted}
                style={styles.twinInput}
                maxLength={24}
              />
              {createError ? <Text style={styles.twinError}>{createError}</Text> : null}
              {needsAgeBackfill ? (
                <View style={styles.twinBackfillRow}>
                  <TextInput
                    value={dobInput}
                    onChangeText={(value) => setDobInput(formatDateOfBirthInput(value))}
                    placeholder="出生日期 YYYY-MM-DD"
                    placeholderTextColor={color.muted}
                    keyboardType="number-pad"
                    maxLength={10}
                    style={[styles.twinInput, styles.twinBackfillInput]}
                    accessibilityLabel="补出生日期"
                  />
                  <Pressable
                    onPress={() => void backfillAgeAndRetry()}
                    disabled={createBusy || dobInput.length !== 10}
                    style={[styles.twinBackfillBtn, (createBusy || dobInput.length !== 10) ? styles.twinSubmitBusy : undefined]}
                    accessibilityLabel="补录并继续创建"
                  >
                    <Text style={styles.twinBackfillBtnText}>补录并继续</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                onPress={() => void submitCreate()}
                disabled={createBusy}
                style={[styles.twinSubmit, createBusy ? styles.twinSubmitBusy : undefined]}
                accessibilityLabel="创建分身"
              >
                <Text style={styles.twinSubmitText}>{createBusy ? "创建中…" : "创建分身"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Human Confirm Gate 说明（政策解释，无假控件） */}
      <View style={styles.coldCard}>
        <Text style={styles.coldCardTitle}>Human Confirm Gate</Text>
        <Text style={styles.coldCardSub}>AI Twin 可以把大量聊天、问题和邀约压缩成真人需要做的少数决策, 但现实承诺不能自动完成。</Text>
        <View style={styles.confirmFlow}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmBoxTitle}>用户提出需求</Text>
            <Text style={styles.confirmBoxSub}>时间 / Scene / 预算 / 场景</Text>
          </View>
          <Text style={styles.confirmArrow}>→</Text>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmBoxTitle}>AI Twin 整理</Text>
            <Text style={styles.confirmBoxSub}>检查 Facet、Availability、边界</Text>
          </View>
          <Text style={styles.confirmArrow}>→</Text>
          <View style={[styles.confirmBox, styles.confirmBoxOn]}>
            <Text style={[styles.confirmBoxTitle, { color: "#15803d" }]}>真人确认</Text>
            <Text style={styles.confirmBoxSub}>Accept / Decline / Modify</Text>
          </View>
        </View>
        <View style={[styles.ruleCard, { marginTop: 8 }]}>
          <View style={styles.ruleTop}>
            <Text style={styles.ruleTitle}>Owner 撤销权</Text>
            <View style={[styles.ruleActionPill, { backgroundColor: "#dcfce7" }]}>
              <Text style={[styles.ruleActionText, { color: "#15803d" }]}>必需</Text>
            </View>
          </View>
          <Text style={styles.ruleReason}>真人随时可以用上面的开关收回形象授权，收回记录保留可查。</Text>
        </View>
      </View>
    </View>
  );
}

// R15.84: R1 overview 段 1:1 抄 — hero + 3 边界 + 4 KPI + 3 identity cards + 3 flow
const OVERVIEW_HERO_RULES = ["透明 AI 标识", "真人授权", "Human Confirm", "Content Provenance", "AI 不进入真人指标"] as const;
const OVERVIEW_BOUNDARIES = [
  "平台 AI 不创建虚假手机号、邮箱或真人 KYC。",
  "AI Twin 可以收集和整理邀约, 但不能替真人接受现实承诺。",
  "AI 不能伪造到店、位置、评价、成交、Scene 足迹或社会证明。"
] as const;
const OVERVIEW_KPIS: ReadonlyArray<{ value: string; label: string; ai?: boolean; risk?: boolean }> = [
  { value: "12,480", label: "Human MAU" },
  { value: "36", label: "Proxy AI Personas", ai: true },
  { value: "184", label: "Active AI Twins", ai: true },
  { value: "7", label: "待人工复核内容", risk: true }
];
const OVERVIEW_IDENTITY_CARDS: ReadonlyArray<{
  kind: "HUMAN" | "AI_NATIVE" | "AI_TWIN";
  title: string; desc: string;
  rows: ReadonlyArray<{ label: string; value: string; dot?: "safe" | "block" | "review" }>;
}> = [
  {
    kind: "HUMAN", title: "真人账户",
    desc: "真实用户 / Creator。手机号或邮箱注册, 必要时完成身份验证; 拥有现实世界最终决策权。",
    rows: [
      { label: "登录", value: "本人登录", dot: "safe" },
      { label: "现实位置", value: "本人主动公开" },
      { label: "接受邀约", value: "允许" },
      { label: "收款 / 评价", value: "允许" }
    ]
  },
  {
    kind: "AI_NATIVE", title: "平台原生 AI",
    desc: "Proxy 创建的纯虚拟数字人, 不对应现实中的任何个人, 用于冷启动、推荐和公开内容。",
    rows: [
      { label: "注册", value: "平台后台创建" },
      { label: "电话 / 邮箱", value: "不伪造", dot: "block" },
      { label: "Scene / 到店", value: "禁止声明亲历" },
      { label: "成交 / 评价", value: "禁止" }
    ]
  },
  {
    kind: "AI_TWIN", title: "Creator AI 分身",
    desc: "绑定一个已验证真人, 由本人按用途授权。外貌、内容风格和 Facet 是数字人格资产。",
    rows: [
      { label: "Owner", value: "唯一真人 Creator" },
      { label: "独立登录", value: "禁止", dot: "block" },
      { label: "回复 / 筛选", value: "按授权允许" },
      { label: "接受邀约", value: "必须真人确认", dot: "review" }
    ]
  }
];
const OVERVIEW_FLOWS = [
  { title: "Content / Conversation", sub: "AI Persona 或 AI Twin 生产内容、回复问题、理解用户意图。" },
  { title: "Policy Gate", sub: "根据 Identity、授权范围、Content Provenance 与风险等级限权。" },
  { title: "Human Reality", sub: "真实邀约、位置、签到、支付、履约、评价由真人或真实商家完成。" }
] as const;

function OverviewHero(): React.JSX.Element {
  return (
    <View style={{ marginTop: 12 }}>
      <View style={styles.overviewHero}>
        <View style={styles.heroMain}>
          <View style={styles.heroKicker}><Text style={styles.heroKickerText}>Proxy · Human + AI Network</Text></View>
          <Text style={styles.heroTitle}>让 AI 帮人扩张,{`\n`}但不伪装成人。</Text>
          <Text style={styles.heroSub}>平台 AI 解决冷启动和内容密度; Creator AI Twin 解决时间上限; 真人保留真实位置、承诺、履约、支付与评价的最终权利。</Text>
          <View style={styles.heroRules}>
            {OVERVIEW_HERO_RULES.map((r) => (
              <View key={r} style={styles.heroRulePill}>
                <Text style={styles.heroRulePillText}>{r}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.heroSide}>
          <Text style={styles.heroSideLabel}>R1 POLICY</Text>
          <Text style={styles.heroSideTitle}>三条不可跨越的边界</Text>
          {OVERVIEW_BOUNDARIES.map((b) => (
            <View key={b} style={styles.heroBoundary}>
              <Text style={styles.heroBoundaryBullet}>•</Text>
              <Text style={styles.heroBoundaryText}>{b}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={[styles.sectionSub, { marginTop: 14, marginBottom: 6 }]}>系统状态</Text>
      <Text style={[styles.sectionSub, { marginBottom: 8 }]}>示例数据 · AI 活动不计入 Human MAU。</Text>
      <View style={styles.kpiGrid}>
        {OVERVIEW_KPIS.map((k) => (
          <View key={k.label} style={[styles.kpiCard, k.ai ? styles.kpiCardAi : undefined, k.risk ? styles.kpiCardRisk : undefined]}>
            <Text style={[styles.kpiValue, k.ai ? styles.kpiValueAi : undefined, k.risk ? styles.kpiValueRisk : undefined]}>{k.value}</Text>
            <Text style={styles.kpiLabel}>{k.label}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionSub, { marginTop: 14, marginBottom: 6 }]}>身份模型</Text>
      <Text style={[styles.sectionSub, { marginBottom: 8 }]}>同一 User Graph, 三种完全不同的责任与权限。</Text>
      <View style={styles.identityCardsRow}>
        {OVERVIEW_IDENTITY_CARDS.map((c) => {
          const meta = KIND_META[c.kind];
          return (
            <View key={c.kind} style={styles.identityBigCard}>
              <View style={[styles.identityBigPill, { backgroundColor: meta.soft }]}>
                <Text style={[styles.identityBigPillText, { color: meta.pillText }]}>{c.kind}</Text>
              </View>
              <Text style={styles.identityBigTitle}>{c.title}</Text>
              <Text style={styles.identityBigDesc}>{c.desc}</Text>
              <View style={{ marginTop: 8 }}>
                {c.rows.map((r) => (
                  <View key={r.label} style={styles.identityBigRow}>
                    <Text style={styles.identityBigRowLabel}>{r.label}</Text>
                    <View style={styles.identityBigRowValueWrap}>
                      {r.dot === "safe" ? <View style={styles.dotSafe} /> : null}
                      {r.dot === "block" ? <View style={styles.dotBlock} /> : null}
                      {r.dot === "review" ? <View style={styles.dotReview} /> : null}
                      <Text style={styles.identityBigRowValue}>{r.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <Text style={[styles.sectionSub, { marginTop: 14, marginBottom: 6 }]}>核心运行链路</Text>
      <Text style={[styles.sectionSub, { marginBottom: 8 }]}>AI 扩张能力, 真人负责现实。</Text>
      <View style={styles.coreFlow}>
        {OVERVIEW_FLOWS.map((f, i) => (
          <View key={f.title} style={styles.coreFlowRow}>
            <View style={styles.coreFlowBox}>
              <Text style={styles.coreFlowTitle}>{f.title}</Text>
              <Text style={styles.coreFlowSub}>{f.sub}</Text>
            </View>
            {i < OVERVIEW_FLOWS.length - 1 ? <Text style={styles.coreFlowArrow}>→</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

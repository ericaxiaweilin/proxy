// AIIdentityShowcaseSurface — R1 AI Identity System (R1 HTML frontstage) 1:1 抄
//
// R15.77: 3 个 phone preview (Human / AI Native / Twin) + 顶部 mini identity cards
// R15.78: + R1 audit 段 (审计日志) 5 列 table + 5 过滤
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
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pageHead}>
          <Text onPress={onBack} style={styles.back}>‹</Text>
          <Text style={styles.title}>AI 身份中心</Text>
        </View>
        <Text style={styles.subtitle}>R1 透明度义务 · Vietnam AI Law 134/2025</Text>

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
      </ScrollView>
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
  auditCellResultReview: { color: "#b45309", fontWeight: "700" }
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

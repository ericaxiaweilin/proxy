// ACTIVITY_DETAIL — 活动详情去占位化
// 接线：ActivityClient.listActivities 真实列表 + ToggleInterest / Join
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, shadows } from "../theme";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";
import { activityAIDisclosure, activityAIPersonaName, activityMoneySummary } from "./activity-detail-model";
// COMP-REPORT-002: 活动与（商家主办的）主办商家都要可举报。
import { ReportSheet } from "../components/report-sheet";
import { activityReportTargets, type ModerationClient, type ReportTarget } from "../moderation-client";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";

// R17.x persona 色：与 tasks.tsx personaColorStyle 同源（ai_001=紫/002=粉/
// 003=绿/004=橙/005=金）。tasks 侧为 canonical；这里仅为明细页封面
// token 做最小映射，避免跨 surface import 具体样式。SVG 本体渲染等 expo-image 就绪。
function personaColor(personaId: string | undefined): string {
  switch (personaId) {
    case "ai_001": return "#7C5CFF";
    case "ai_002": return "#FF7A8A";
    case "ai_003": return "#3FCBA8";
    case "ai_004": return "#FF9D44";
    case "ai_005": return "#FFB347";
    default: return "#7C5CFF";
  }
}

export function ActivityDetailSurface({ client, moderation, initialActivityId, onBack }: { client: ActivityClient; moderation: ModerationClient; initialActivityId?: string; onBack?: () => void }): React.JSX.Element {
  const [items, setItems] = useState<Activity[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Activity | undefined>(undefined);
  const [reporting, setReporting] = useState<ReportTarget | undefined>(undefined);
  const [reportDone, setReportDone] = useState<string | undefined>(undefined);
  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const list = await client.listActivities();
        if (c) return;
        setItems(list);
        // R17.x: 从 “我的活动” 进明细时, server-side 已取的该
        // 活动能立刻选中 (避免 “列表选了但明细走了不同活动”)。
        if (initialActivityId) {
          const preset = list.find((entry) => entry.activityId === initialActivityId);
          if (preset) setSelected(preset);
        }
      } catch (e) { if (!c) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { c = true; };
  }, [client, initialActivityId]);
  if (selected) {
    const aiDisclosure = activityAIDisclosure(selected);
    const showPersona = selected.aiStatus !== "NONE" && selected.aiPersonaId;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.container}>
          <Pressable accessibilityLabel="返回" onPress={() => { if (onBack) onBack(); else setSelected(undefined); }}><ProxyBackGlyph /></Pressable>
          {selected.coverImageUrl ? (
            <Image source={{ uri: selected.coverImageUrl }} style={styles.cover} />
          ) : showPersona ? (
            <View style={styles.coverPlaceholder}>
              <View style={[styles.personaToken, { backgroundColor: personaColor(selected.aiPersonaId) }]}>
                <Text selectable style={styles.personaTokenText}>{selected.aiPersonaAvatar ?? "🤖"}</Text>
              </View>
              <Text selectable style={styles.coverNote}>{activityAIPersonaName(selected)} · 真人照片待上传</Text>
            </View>
          ) : (
            <View style={styles.coverPlaceholder}>
              <Text selectable style={styles.coverIcon}>{selected.venueIcon || "◎"}</Text>
              <Text selectable style={styles.coverNote}>活动照片待商家 / 发起人上传</Text>
            </View>
          )}
          <Text selectable style={styles.title}>{selected.title}</Text>
          <Text selectable style={styles.meta}>{selected.venueName} · {selected.time}</Text>
          <View style={styles.card}>
            <Text selectable style={styles.body}>{selected.desc}</Text>
            <Text selectable style={styles.meta}>感兴趣 {selected.interested} · 参加 {selected.joined} · 提问 {selected.qaCount}</Text>
            <Text selectable style={styles.money}>{activityMoneySummary(selected)}</Text>
            <Text selectable style={styles.meta}>{selected.people} · {selected.consumption}</Text>
            {aiDisclosure ? <Text selectable style={styles.aiDisclosure}>🤖 {aiDisclosure}</Text> : null}
          </View>
          <Pressable onPress={async () => { try { await client.toggleInterest(selected.activityId); const list = await client.listActivities(); setItems(list); const upd = list.find((x) => x.activityId === selected.activityId); if (upd) setSelected(upd); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} style={styles.cta}><Text selectable style={styles.ctaText}>感兴趣 / 取消</Text></Pressable>
          <Pressable onPress={async () => { try { await client.join(selected.activityId); const list = await client.listActivities(); setItems(list); const upd = list.find((x) => x.activityId === selected.activityId); if (upd) setSelected(upd); setNotice("报名成功"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} style={styles.ctaSecondary}><Text selectable style={styles.ctaSecondaryText}>报名参加</Text></Pressable>
          {notice ? <Text selectable style={styles.meta}>{notice}</Text> : null}
          <View style={styles.reportRow}>
            {activityReportTargets(selected).map((target) => (
              <Pressable key={target.targetType + target.targetId} onPress={() => { setReportDone(undefined); setReporting(target); }} style={styles.reportButton} accessibilityLabel={target.label}>
                <Text selectable style={styles.reportButtonText}>⚑ {target.label}</Text>
              </Pressable>
            ))}
          </View>
          {reportDone ? <Text selectable style={styles.meta}>{reportDone}</Text> : null}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        </ScrollView>
        {reporting ? (
          <ReportSheet
            moderation={moderation}
            targetType={reporting.targetType}
            targetId={reporting.targetId}
            title={reporting.label}
            {...(selected.title ? { subtitle: selected.title } : {})}
            onClose={() => setReporting(undefined)}
            onDone={() => { setReporting(undefined); setReportDone("举报已提交，我们会尽快处理。"); }}
          />
        ) : null}
      </View>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text selectable style={styles.title}>活动详情</Text>
      <Text selectable style={styles.sub}>来自 Activity 真实读模型，非占位。</Text>
      {items === undefined && !error ? <ProxyLoading tone="muted" /> : null}
      {error ? <View style={styles.card}><Text selectable style={styles.empty}>加载失败：{error}</Text></View> : null}
      {items?.map((a) => (
        <Pressable key={a.activityId} onPress={() => setSelected(a)} style={styles.card}>
          <Text selectable style={styles.name}>{a.title}</Text>
          <Text selectable style={styles.meta}>{a.venueName} · {a.time} · 感兴趣 {a.interested}</Text>
        </Pressable>
      ))}
      {items && items.length === 0 ? <View style={styles.card}><Text selectable style={styles.empty}>暂无活动</Text></View> : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  container: { gap: 10, padding: 16, paddingBottom: 24 },
  title: { color: color.ink, fontSize: 18, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  name: { color: color.ink, fontSize: 14, fontWeight: "800" },
  body: { color: color.ink, fontSize: 13, lineHeight: 18 },
  meta: { color: color.muted, fontSize: 12, marginTop: 4 },
  money: { color: color.ink, fontSize: 14, fontWeight: "800", marginTop: 10 },
  aiDisclosure: { backgroundColor: "#F4F0FF", borderRadius: 8, color: "#5B3FA3", fontSize: 12, lineHeight: 17, marginTop: 10, padding: 9 },
  empty: { color: color.muted, fontSize: 12 },
  cover: { borderRadius: 14, height: 190, width: "100%" },
  coverPlaceholder: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 6, paddingVertical: 26 },
  coverIcon: { fontSize: 44 },
  coverNote: { color: color.muted, fontSize: 12 },
  personaToken: { alignItems: "center", borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  personaTokenText: { fontSize: 28 },
  cta: { backgroundColor: color.ink, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: color.white, fontSize: 13, fontWeight: "800" },
  ctaSecondary: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingVertical: 12, alignItems: "center" },
  ctaSecondaryText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  error: { color: "#B00020", fontSize: 12, marginTop: 8 },
  // COMP-REPORT-002: 举报入口常驻在明细底部，不做成长按菜单 ——
  // 用户在活动里碰到招嫖招揽时，不该还要先猜「哪里能举报」。
  reportRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  reportButton: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  reportButtonText: { color: color.ink, fontSize: 12, fontWeight: "700" },
});

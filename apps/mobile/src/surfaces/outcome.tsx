// OUTCOME — 结果 / Outcome Intelligence 去占位化
// PRD Chapter21D：ObservationSet → Delta → Learning
// 接线：OutcomeClient 真实命令链（CreateSet / Record / Finalize / Compare / Confirm），非 ComingSoon 占位
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, shadows } from "../theme";
import type { OutcomeClient } from "../outcome-client";
import { ProxyLoading } from "../components/proxy-foundation";

export function OutcomeSurface({ client }: { client: OutcomeClient }): React.JSX.Element {
  // 三个 ID 必须手填真实值：之前默认 target_demo / tpl_v1 / venue_001，
  // 点一下就往服务端写假目标行。置空 + 必填校验，不再预填演示 ID。
  const [targetId, setTargetId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [resultId, setResultId] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const push = (s: string) => setLog((l) => [s, ...l].slice(0, 20));

  const runDemo = async () => {
    if (!targetId.trim() || !templateId.trim() || !venueId.trim()) {
      push("ERR 请先填写 target / template / venue（不预填演示 ID）");
      return;
    }
    setBusy(true);
    try {
      const b = await client.createSet({ targetId, templateId, venueId });
      push(`CreateSet baseline ${b.setId.slice(0,8)} OK`);
      await client.recordObservation({ setId: b.setId, key: "satisfaction", value: "8", unit: "score" });
      await client.finalizeSet(b.setId);
      push(`Finalize baseline ${b.setId.slice(0,8)} OK`);
      setBaselineId(b.setId);
      const r = await client.createSet({ targetId, templateId, venueId });
      await client.recordObservation({ setId: r.setId, key: "satisfaction", value: "9", unit: "score" });
      await client.finalizeSet(r.setId);
      push(`Finalize result ${r.setId.slice(0,8)} OK`);
      setResultId(r.setId);
      const cmp = await client.createComparison({ baselineId: b.setId, resultId: r.setId, policyVersion: "v1" });
      push(`Compare → delta ${cmp.deltaId.slice(0,8)} learning ${cmp.learningId.slice(0,8)} (${cmp ? "SAME/UNKNOWN" : ""})`);
    } catch (e) {
      push(`ERR ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text selectable style={styles.title}>结果 · Outcome Intelligence</Text>
      <Text selectable style={styles.sub}>ObservationSet → Delta → Learning 真实链路（M6.5），已接 OutcomeClient，非占位。</Text>
      <View style={styles.card}>
        <Text selectable style={styles.label}>targetId</Text><TextInput value={targetId} onChangeText={setTargetId} style={styles.input} placeholder="真实目标 ID" placeholderTextColor={color.muted} />
        <Text selectable style={styles.label}>templateId</Text><TextInput value={templateId} onChangeText={setTemplateId} style={styles.input} placeholder="真实模板 ID" placeholderTextColor={color.muted} />
        <Text selectable style={styles.label}>venueId</Text><TextInput value={venueId} onChangeText={setVenueId} style={styles.input} placeholder="真实场地 ID" placeholderTextColor={color.muted} />
        <Pressable onPress={runDemo} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}><Text selectable style={styles.ctaText}>{busy ? "执行中…" : "跑一次 Demo 链路"}</Text></Pressable>
        {baselineId ? <Text selectable style={styles.mono}>baseline: {baselineId}</Text> : null}
        {resultId ? <Text selectable style={styles.mono}>result: {resultId}</Text> : null}
      </View>
      <View style={styles.logCard}>
        <Text selectable style={styles.logTitle}>执行日志</Text>
        {log.length === 0 ? <Text selectable style={styles.empty}>点上方按钮触发 CreateSet → Finalize → Compare</Text> : null}
        {log.map((l, i) => <Text selectable key={i} style={styles.logLine}>• {l}</Text>)}
        {busy ? <ProxyLoading tone="muted" style={{ marginTop: 8 }} /> : null}
      </View>
      <Text selectable style={styles.hint}>说明：Outcome 域已 PG 化（apps/api-go/internal/outcome + postgres/outcome.go），本页直接复用 List/Compare 真实命令，失败会以 REJECTED 抛错展示。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  container: { gap: 12, padding: 16, paddingBottom: 32 },
  title: { color: color.ink, fontSize: 18, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12, lineHeight: 16 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 6, padding: 14, ...shadows.card },
  label: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 4 },
  input: { backgroundColor: color.offWhite, borderColor: color.line, borderRadius: 10, borderWidth: 1, color: color.ink, fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 },
  cta: { backgroundColor: color.ink, borderRadius: 999, marginTop: 10, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: color.white, fontSize: 13, fontWeight: "800" },
  mono: { color: color.muted, fontSize: 11, marginTop: 4 },
  logCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  logTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  empty: { color: color.muted, fontSize: 12, marginTop: 6 },
  logLine: { color: color.ink, fontSize: 11, lineHeight: 14, marginTop: 4 },
  hint: { color: color.muted, fontSize: 11, lineHeight: 13 },
});

// OUTCOME — 结果 / Outcome Intelligence 去占位化
// PRD Chapter21D：ObservationSet → Delta → Learning
// 接线：OutcomeClient 真实命令链（CreateSet / Record / Finalize / Compare / Confirm），非 ComingSoon 占位
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, shadows } from "../theme";
import type { OutcomeClient } from "../outcome-client";

export function OutcomeSurface({ client }: { client: OutcomeClient }): React.JSX.Element {
  const [targetId, setTargetId] = useState("target_demo");
  const [templateId, setTemplateId] = useState("tpl_v1");
  const [venueId, setVenueId] = useState("venue_001");
  const [baselineId, setBaselineId] = useState("");
  const [resultId, setResultId] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const push = (s: string) => setLog((l) => [s, ...l].slice(0, 20));

  const runDemo = async () => {
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
      <Text style={styles.title}>结果 · Outcome Intelligence</Text>
      <Text style={styles.sub}>ObservationSet → Delta → Learning 真实链路（M6.5），已接 OutcomeClient，非占位。</Text>
      <View style={styles.card}>
        <Text style={styles.label}>targetId</Text><TextInput value={targetId} onChangeText={setTargetId} style={styles.input} placeholderTextColor={color.muted} />
        <Text style={styles.label}>templateId</Text><TextInput value={templateId} onChangeText={setTemplateId} style={styles.input} />
        <Text style={styles.label}>venueId</Text><TextInput value={venueId} onChangeText={setVenueId} style={styles.input} />
        <Pressable onPress={runDemo} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}><Text style={styles.ctaText}>{busy ? "执行中…" : "跑一次 Demo 链路"}</Text></Pressable>
        {baselineId ? <Text style={styles.mono}>baseline: {baselineId}</Text> : null}
        {resultId ? <Text style={styles.mono}>result: {resultId}</Text> : null}
      </View>
      <View style={styles.logCard}>
        <Text style={styles.logTitle}>执行日志</Text>
        {log.length === 0 ? <Text style={styles.empty}>点上方按钮触发 CreateSet → Finalize → Compare</Text> : null}
        {log.map((l, i) => <Text key={i} style={styles.logLine}>• {l}</Text>)}
        {busy ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
      </View>
      <Text style={styles.hint}>说明：Outcome 域已 PG 化（apps/api-go/internal/outcome + postgres/outcome.go），本页直接复用 List/Compare 真实命令，失败会以 REJECTED 抛错展示。</Text>
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

// ACTIVITY_DETAIL — 活动详情去占位化
// 接线：ActivityClient.listActivities 真实列表 + ToggleInterest / Join
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, shadows } from "../theme";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";

export function ActivityDetailSurface({ client }: { client: ActivityClient }): React.JSX.Element {
  const [items, setItems] = useState<Activity[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Activity | undefined>(undefined);
  useEffect(() => {
    let c = false;
    (async () => {
      try { const list = await client.listActivities(); if (!c) setItems(list); } catch (e) { if (!c) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { c = true; };
  }, [client]);
  if (selected) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.container}>
        <Pressable onPress={() => setSelected(undefined)}><Text style={styles.back}>‹ 返回</Text></Pressable>
        <Text style={styles.title}>{selected.title}</Text>
        <Text style={styles.meta}>{selected.venueName} · {selected.time}</Text>
        <View style={styles.card}><Text style={styles.body}>{selected.desc}</Text><Text style={styles.meta}>感兴趣 {selected.interested} · 参加 {selected.joined} · 提问 {selected.qaCount}</Text><Text style={styles.meta}>{selected.price} · {selected.people} · {selected.consumption}</Text></View>
        <Pressable onPress={async () => { try { await client.toggleInterest(selected.activityId); const list = await client.listActivities(); setItems(list); const upd = list.find((x) => x.activityId === selected.activityId); if (upd) setSelected(upd); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} style={styles.cta}><Text style={styles.ctaText}>感兴趣 / 取消</Text></Pressable>
        <Pressable onPress={async () => { try { await client.join(selected.activityId); const list = await client.listActivities(); setItems(list); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} style={styles.ctaSecondary}><Text style={styles.ctaSecondaryText}>报名参加</Text></Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.title}>活动详情</Text>
      <Text style={styles.sub}>来自 Activity 真实读模型，非占位。</Text>
      {items === undefined && !error ? <ActivityIndicator /> : null}
      {error ? <View style={styles.card}><Text style={styles.empty}>加载失败：{error}</Text></View> : null}
      {items?.map((a) => (
        <Pressable key={a.activityId} onPress={() => setSelected(a)} style={styles.card}>
          <Text style={styles.name}>{a.title}</Text>
          <Text style={styles.meta}>{a.venueName} · {a.time} · 感兴趣 {a.interested}</Text>
        </Pressable>
      ))}
      {items && items.length === 0 ? <View style={styles.card}><Text style={styles.empty}>暂无活动</Text></View> : null}
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
  empty: { color: color.muted, fontSize: 12 },
  back: { color: color.ink, fontSize: 14, fontWeight: "700" },
  cta: { backgroundColor: color.ink, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: color.white, fontSize: 13, fontWeight: "800" },
  ctaSecondary: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingVertical: 12, alignItems: "center" },
  ctaSecondaryText: { color: color.ink, fontSize: 13, fontWeight: "800" },
  error: { color: "#B00020", fontSize: 12, marginTop: 8 },
});

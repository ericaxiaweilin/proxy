// Custom Feed — 用户固定「朋友/河内/摄影/机会/商家/创业」；AI 也可自动生成频道。
// Threads Custom Feeds / X Lists 的 Proxy 化：用户建 + AI 建 + 固定到首页。
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color, shadows } from "../theme";

export interface CustomFeed {
  id: string;
  name: string;
  desc: string;
  icon: string;
  pinned: boolean;
  aiGenerated?: boolean;
}

const DEFAULT_FEEDS: CustomFeed[] = [
  { id: "friends", name: "朋友", desc: "关注的人 · 亲密关系", icon: "♥", pinned: true },
  { id: "hanoi", name: "河内", desc: "河内本地 · 生活/活动", icon: "⌖", pinned: true },
  { id: "photo", name: "摄影", desc: "摄影作品/地点/活动", icon: "◯", pinned: true },
  { id: "opportunity", name: "机会", desc: "赚钱机会 · 需求", icon: "₫", pinned: false },
  { id: "merchant", name: "商家", desc: "本地商家 · 新店", icon: "▣", pinned: false },
  { id: "startup", name: "创业", desc: "AI/产品/出海", icon: "✦", pinned: false }
];

export function CustomFeedHub({ onBack, onOpenFeed }: { onBack: () => void; onOpenFeed?: (feedId: string) => void }): React.JSX.Element {
  const [feeds, setFeeds] = useState<CustomFeed[]>(DEFAULT_FEEDS);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);

  function togglePin(id: string): void {
    setFeeds((prev) => prev.map((f) => (f.id === id ? { ...f, pinned: !f.pinned } : f)));
  }

  function generateAI(): void {
    const text = draft.trim();
    if (!text) return;
    setGenerating(true);
    setTimeout(() => {
      const lower = text.toLowerCase();
      let name = "AI 频道";
      let desc = text.slice(0, 24);
      let icon = "✦";
      if (lower.includes("ai") || lower.includes("产品")) {
        name = "AI / 产品";
        desc = "河内做 AI/产品的人和活动";
        icon = "✦";
      } else if (lower.includes("摄影")) {
        name = "摄影精选";
        desc = "河内摄影 · 作品与活动";
        icon = "◯";
      } else if (lower.includes("创业")) {
        name = "创业圈";
        desc = "创业/融资/活动";
        icon = "✦";
      }
      const next: CustomFeed = { id: `ai_${Date.now().toString(36)}`, name, desc, icon, pinned: true, aiGenerated: true };
      setFeeds((prev) => [next, ...prev]);
      setDraft("");
      setGenerating(false);
    }, 600);
  }

  const pinned = feeds.filter((f) => f.pinned);
  const others = feeds.filter((f) => !f.pinned);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>自定频道</Text>
      <Text style={styles.sub}>在动态左上角集中管理「朋友/河内/摄影/机会/商家/创业」；也可让 AI 按一句话生成频道。</Text>

      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>让 AI 生成频道</Text>
        <TextInput value={draft} onChangeText={setDraft} placeholder="例：给我建一个只看河内做 AI/产品的人和活动的频道" placeholderTextColor={color.muted} style={styles.aiInput} multiline />
        <Pressable onPress={generateAI} style={[styles.aiBtn, (!draft.trim() || generating) && styles.disabled]}>
          <Text style={styles.aiBtnText}>{generating ? "生成中…" : "AI 生成 → 固定到首页"}</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>已固定频道 · {pinned.length}</Text>
      <Text style={styles.sectionSub}>从动态左上角菜单进入并切换</Text>
      {pinned.map((f) => (
        <View key={f.id} style={styles.card}>
          <View style={styles.cardIcon}>
            <Text style={styles.cardIconText}>{f.icon}</Text>
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.cardName}>{f.name}{f.aiGenerated ? " · AI" : ""}</Text>
            <Text style={styles.cardDesc}>{f.desc}</Text>
          </View>
          <Pressable onPress={() => togglePin(f.id)} style={[styles.pinBtn, styles.pinBtnOn]}>
            <Text style={[styles.pinText, styles.pinTextOn]}>已固定</Text>
          </Pressable>
          <Pressable onPress={() => onOpenFeed?.(f.id)} style={styles.openBtn}>
            <Text style={styles.openText}>查看</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.sectionTitle}>更多频道</Text>
      {others.map((f) => (
        <View key={f.id} style={styles.card}>
          <View style={styles.cardIcon}>
            <Text style={styles.cardIconText}>{f.icon}</Text>
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.cardName}>{f.name}</Text>
            <Text style={styles.cardDesc}>{f.desc}</Text>
          </View>
          <Pressable onPress={() => togglePin(f.id)} style={styles.pinBtn}>
            <Text style={styles.pinText}>固定</Text>
          </Pressable>
        </View>
      ))}

      <Pressable onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backText}>返回动态</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.white, flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34 },
  title: { color: color.ink, fontSize: 21, fontWeight: "700", marginBottom: 4 },
  sub: { color: color.muted, fontSize: 11, lineHeight: 15, marginBottom: 12 },
  aiBox: { backgroundColor: "#F8F5FA", borderColor: "#ECE4F0", borderRadius: 14, borderWidth: 1, marginBottom: 14, padding: 10 },
  aiTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  aiInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, color: color.ink, fontSize: 11, marginTop: 8, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top" },
  aiBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, marginTop: 8, paddingVertical: 8 },
  aiBtnText: { color: color.white, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  sectionTitle: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 8 },
  sectionSub: { color: color.muted, fontSize: 11, marginBottom: 6, marginTop: 2 },
  card: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginVertical: 4, padding: 10, ...shadows.card },
  cardIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
  cardIconText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  cardDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  pinBtn: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  pinBtnOn: { backgroundColor: color.ink, borderColor: color.ink },
  pinText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  pinTextOn: { color: color.white },
  openBtn: { backgroundColor: "#F8F5FA", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  openText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  backBtn: { alignItems: "center", borderColor: color.line, borderRadius: 999, borderWidth: 1, marginTop: 14, paddingVertical: 11 },
  backText: { color: color.ink, fontSize: 11, fontWeight: "700" }
});

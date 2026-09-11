// R15.3 我的推荐 — Feed 偏好设置屏幕
// 对齐 Proxy_P0_Prototype_R15_3_SearchFirst_ModelUI_BusinessOS.html 的 feedprefs 页面
// 每行 3 列 grid：标签(96px) + range slider(1fr) + 数值(34px)
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { color } from "../theme";
import { readFeedPrefsAsync, writeFeedPrefs, defaultFeedPrefs } from "../expo-feed-prefs-store";

const FEED_ROWS: ReadonlyArray<[string, string]> = [
  ["opportunity", "机会 / 需求"],
  ["people", "人 / 关系"],
  ["activity", "活动 / 团体"],
  ["intelligence", "情报 / 行业信息"],
  ["lifestyle", "普通生活内容"],
  ["commercial", "商业推广"]
];

const MUTED_TOPICS = ["Agent 自我展示", "自拍 / 生活照片", "商业内容", "招聘", "活动", "附近热门"];

// 自定义 range slider — 对齐原型 <input type="range" min="0" max="100">
function Slider({
  value,
  onValueChange
}: {
  value: number;
  onValueChange: (v: number) => void;
}): React.JSX.Element {
  const trackRef = useRef<View>(null);
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const lastPct = useRef(value);

  function pctFromX(pageX: number): number {
    if (trackWidth.current <= 0) return lastPct.current;
    return Math.max(0, Math.min(100, Math.round(((pageX - trackPageX.current) / trackWidth.current) * 100)));
  }

  return (
    <View
      ref={trackRef}
      style={styles.sliderTrack}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e: GestureResponderEvent) => {
        const p = pctFromX(e.nativeEvent.pageX);
        lastPct.current = p;
        onValueChange(p);
      }}
      onResponderMove={(e: GestureResponderEvent) => {
        const p = pctFromX(e.nativeEvent.pageX);
        lastPct.current = p;
        onValueChange(p);
      }}
      onResponderRelease={(e: GestureResponderEvent) => {
        const p = pctFromX(e.nativeEvent.pageX);
        lastPct.current = p;
        onValueChange(p);
      }}
      onResponderTerminate={() => {}}
      onLayout={(e) => {
        trackWidth.current = e.nativeEvent.layout.width;
        trackRef.current?.measure((_fx, _fy, _w, _h, px) => {
          trackPageX.current = px;
        });
      }}
    >
      <View style={[styles.sliderFill, { width: `${lastPct.current}%` }]} />
      <View style={[styles.sliderThumb, { left: `${lastPct.current}%` }]} />
    </View>
  );
}

export function FeedPrefsSurface({ onBack }: { onBack: () => void }): React.JSX.Element {
  // R36.x PREFS-001: 设置落本地（expo-feed-prefs-store），退出重进保留。
  // SYNC-FS-001: 读盘异步，mount 时 hydration（此时用户尚未编辑，直接应用）。
  const [weights, setWeights] = useState<Record<string, number>>(defaultFeedPrefs().weights);
  const [scope, setScope] = useState<"7D" | "30D" | "PERSISTENT">(defaultFeedPrefs().scope);
  const [muted, setMuted] = useState<Set<string>>(() => new Set(defaultFeedPrefs().muted));
  const [algoInput, setAlgoInput] = useState("");
  const [algoApplied, setAlgoApplied] = useState<string | null>(defaultFeedPrefs().algoApplied);
  const firstRender = useRef(true);
  useEffect(() => {
    let cancelled = false;
    void readFeedPrefsAsync().then((initialPrefs) => {
      if (cancelled) return;
      setWeights(initialPrefs.weights);
      setScope(initialPrefs.scope);
      setMuted(new Set(initialPrefs.muted));
      setAlgoApplied(initialPrefs.algoApplied);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    writeFeedPrefs({ weights, scope, muted: [...muted], algoApplied });
  }, [weights, scope, muted, algoApplied]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>我的推荐</Text>
      <Text style={styles.sub}>你可以直接告诉 Proxy 多看什么、少看什么。搜索和明确需求仍然优先。</Text>

      <View style={styles.algoCard}>
        <Text style={styles.algoTitle}>直接训练算法 — Your Algo 对话版</Text>
        <TextInput value={algoInput} onChangeText={setAlgoInput} placeholder="例：最近一个月多给我看河内创业活动，摄影多一点，兼职少一点" placeholderTextColor={color.muted} style={styles.algoInput} multiline />
        <Pressable
          onPress={() => {
            if (!algoInput.trim()) return;
            setAlgoApplied(algoInput.trim());
            const t = algoInput.toLowerCase();
            if (t.includes("摄影")) setWeights((p) => ({ ...p, people: Math.min(100, (p.people ?? 50) + 20) }));
            if (t.includes("创业")) setWeights((p) => ({ ...p, intelligence: Math.min(100, (p.intelligence ?? 50) + 20) }));
            if (t.includes("商业") && t.includes("少")) setWeights((p) => ({ ...p, commercial: Math.max(0, (p.commercial ?? 50) - 20) }));
            setAlgoInput("");
          }}
          style={[styles.algoBtn, !algoInput.trim() && styles.disabled]}
        >
          <Text style={styles.algoBtnText}>应用到推荐 · {scope === "7D" ? "7 天" : scope === "30D" ? "30 天" : "长期"}</Text>
        </Pressable>
        {algoApplied ? <Text style={styles.algoApplied}>已应用：{algoApplied}</Text> : null}
        <Text style={styles.algoHint}>试试：多给我摄影和本地活动，少一点商业内容，持续一周 / 最近想认识做产品的人</Text>
      </View>

      {/* 权重卡片 — 每行 3 列：标签 + slider + 数值 */}
      <View style={styles.card}>
        {FEED_ROWS.map(([key, label]) => (
          <View key={key} style={styles.prefRow}>
            <Text style={styles.prefLabel}>{label}</Text>
            <Slider
              value={weights[key] ?? 50}
              onValueChange={(v) => setWeights((prev) => ({ ...prev, [key]: v }))}
            />
            <Text style={styles.prefValue}>{weights[key] ?? 50}</Text>
          </View>
        ))}
      </View>

      {/* 时间范围 */}
      <Text style={styles.sectionTitle}>暂时调整多久？</Text>
      <Text style={styles.sectionSub}>自动恢复也可以</Text>
      <View style={styles.scopeRow}>
        {(["7D", "30D", "PERSISTENT"] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setScope(s)}
            style={[styles.scopeChip, scope === s && styles.scopeChipActive]}
          >
            <Text style={[styles.scopeChipText, scope === s && styles.scopeChipTextActive]}>
              {s === "7D" ? "7 天" : s === "30D" ? "30 天" : "长期"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 暂停主题 */}
      <Text style={styles.sectionTitle}>不想看的内容</Text>
      <Text style={styles.sectionSub}>点击可恢复</Text>
      <View style={styles.mutedRow}>
        {MUTED_TOPICS.map((t) => {
          const off = muted.has(t);
          return (
            <Pressable
              key={t}
              onPress={() => {
                setMuted((prev) => {
                  const next = new Set(prev);
                  off ? next.delete(t) : next.add(t);
                  return next;
                });
              }}
              style={[styles.mutedChip, off && styles.mutedChipOff]}
            >
              <Text style={[styles.mutedChipText, off && styles.mutedChipTextOff]}>
                {off ? "已暂停 · " : ""}{t}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 推荐原则 */}
      <View style={styles.principleCard}>
        <Text style={styles.principleTitle}>推荐原则</Text>
        <Text style={styles.principleText}>
          搜索 / 明确意图 &gt; 你的显式偏好 &gt; 真实结果 &gt; 关系与机会 &gt; 普通互动。停留和点赞不会自动把 Feed 变成同一种内容。
        </Text>
      </View>

      <Pressable onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backBtnText}>返回动态</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.white, flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34 },
  title: { color: color.ink, fontSize: 21, fontWeight: "700", marginBottom: 4 },
  sub: { color: color.muted, fontSize: 11, lineHeight: 15, marginBottom: 14 },

  // 权重卡片 — 每行 3 列 grid
  card: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4
  },
  prefRow: {
    alignItems: "center",
    borderBottomColor: "#F1EDF3",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 10
  },
  prefLabel: { color: color.ink, fontSize: 11, fontWeight: "700", width: 96 },
  prefValue: { color: color.muted, fontSize: 11, fontWeight: "700", textAlign: "right", width: 34 },
  algoCard: { backgroundColor: "#F8F5FA", borderColor: "#ECE4F0", borderRadius: 14, borderWidth: 1, marginBottom: 14, padding: 10 },
  algoTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  algoInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, color: color.ink, fontSize: 11, marginTop: 8, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top" },
  algoBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, marginTop: 8, paddingVertical: 8 },
  algoBtnText: { color: color.white, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  algoApplied: { color: "#6330B2", fontSize: 11, fontWeight: "700", marginTop: 6 },
  algoHint: { color: color.muted, fontSize: 11, lineHeight: 14, marginTop: 6 },

  // slider
  sliderTrack: {
    backgroundColor: "#E8E2EC",
    borderRadius: 999,
    flex: 1,
    height: 6,
    justifyContent: "center",
    position: "relative"
  },
  sliderFill: {
    backgroundColor: "#7C2AFF",
    borderRadius: 999,
    height: 6,
    position: "absolute",
    left: 0,
    top: 0
  },
  sliderThumb: {
    backgroundColor: "#7C2AFF",
    borderColor: color.white,
    borderRadius: 999,
    borderWidth: 2,
    height: 16,
    marginLeft: -8,
    position: "absolute",
    top: -5,
    width: 16
  },

  // section
  sectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 16, marginBottom: 2 },
  sectionSub: { color: color.muted, fontSize: 11, marginBottom: 8 },

  // scope chips — 3 列 grid
  scopeRow: {
    flexDirection: "row",
    gap: 6
  },
  scopeChip: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 8,
    alignItems: "center"
  },
  scopeChipActive: { backgroundColor: color.ink, borderColor: color.ink },
  scopeChipText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  scopeChipTextActive: { color: color.white },

  // muted chips — flex wrap
  mutedRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mutedChip: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  mutedChipOff: { backgroundColor: "#F3EFF5", borderColor: "#D9D0DE" },
  mutedChipText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  mutedChipTextOff: { color: "#8A8290", textDecorationLine: "line-through" },

  // principle card — dark
  principleCard: {
    backgroundColor: color.ink,
    borderRadius: 14,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  principleTitle: { color: color.white, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  principleText: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 15 },

  // back button — light outline
  backBtn: {
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 16,
    paddingVertical: 11,
    alignItems: "center"
  },
  backBtnText: { color: color.ink, fontSize: 11, fontWeight: "700" }
});

// R15.3 我的推荐 — Feed 偏好设置屏幕
// 对齐 Proxy_P0_Prototype_R15_3_SearchFirst_ModelUI_BusinessOS.html 的 feedprefs 页面
// 每行 3 列 grid：标签(96px) + range slider(1fr) + 数值(34px)
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { color } from "../theme";

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
  const [weights, setWeights] = useState<Record<string, number>>({
    opportunity: 70,
    people: 60,
    activity: 50,
    intelligence: 40,
    lifestyle: 30,
    commercial: 20
  });
  const [scope, setScope] = useState<"7D" | "30D" | "PERSISTENT">("7D");
  const [muted, setMuted] = useState<Set<string>>(new Set());

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>我的推荐</Text>
      <Text style={styles.sub}>你可以直接告诉 Proxy 多看什么、少看什么。搜索和明确需求仍然优先。</Text>

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

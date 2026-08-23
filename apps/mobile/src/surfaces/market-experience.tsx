// MarketExperience Surface（R15.12.7 Market Map Parity Freeze）：
// Experience 详情 = 明确内容 Scope + 可选 Host（价格属于体验，不属于人物）+ 档期预约。
// Host 是体验内部的选择项，不是 Market Inventory；person 不做成 SKU。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（screens.marketexperience）。
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { marketExperience, marketHost } from "../market-fixtures";
import { color, shadows } from "../theme";

const SLOTS: ReadonlyArray<[string, string]> = [
  ["sat1500", "周六 15:00"],
  ["sat1730", "周六 17:30"],
  ["sun1400", "周日 14:00"]
];

export function MarketExperienceSurface({
  experienceId,
  onBack
}: {
  experienceId: string;
  onBack: () => void;
}): React.JSX.Element {
  const experience = marketExperience(experienceId);
  const [selectedHostId, setSelectedHostId] = useState<string>(experience.hosts[0] ?? "");
  const [selectedSlot, setSelectedSlot] = useState<string>("sat1500");
  const selectedHost = marketHost(selectedHostId);
  const channel = creatorChannel(selectedHost.id);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.detailCreator}>
        <Image resizeMode="cover" source={{ uri: selectedHost.photo }} style={styles.detailAvatar} />
        <View style={styles.detailCreatorCopy}>
          <Text style={styles.detailCreatorName}>{selectedHost.name} ✓</Text>
          <Text style={styles.detailCreatorMeta}>{creatorMeta(selectedHost.id)}{"\n"}TikTok {channel.handle} · {channel.followers} · {channel.relation}</Text>
        </View>
        <Pressable accessibilityLabel={`${selectedHost.name} 主页`} style={styles.detailProfileBtn}><Text style={styles.detailProfileText}>主页</Text></Pressable>
      </View>

      <View style={styles.detailObject}>
        <Text style={styles.detailObjectType}>EXPERIENCE</Text>
        <Text style={styles.detailObjectTitle}>{experience.title}</Text>
        <Text style={styles.detailObjectText}>{experience.scope}</Text>
        <View style={styles.detailObjectWhen}>
          <Text style={styles.detailObjectChip}>{experience.next}</Text>
          <Text style={styles.detailObjectChip}>{experience.duration}</Text>
          <Text style={styles.detailObjectChip}>{experience.place}</Text>
        </View>
      </View>

      <View style={styles.scope}>
        <Text style={styles.sectionTitleInline}>这次具体包含什么</Text>
        {(
          [
            ["Scope", experience.scope],
            ["地点", experience.place],
            ["交付", experience.deliverable]
          ] as ReadonlyArray<[string, string]>
        ).map(([key, value]) => (
          <View key={key} style={styles.scopeRow}>
            <Text style={styles.scopeKey}>{key}</Text>
            <Text style={styles.scopeValue}>{value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>选择 Host</Text>
        <Text style={styles.sectionHint}>{experience.hosts.length} 位符合本体验</Text>
      </View>
      {experience.hosts.map((id) => {
        const host = marketHost(id);
        const selected = selectedHostId === id;
        return (
          <Pressable
            key={id}
            onPress={() => setSelectedHostId(id)}
            style={[styles.hostCard, selected && styles.hostCardOn]}
          >
            <Image resizeMode="cover" source={{ uri: host.photo }} style={styles.hostPhoto} />
            <View style={styles.hostCopy}>
              <Text style={styles.hostName}>
                {host.name} · {host.topic}
              </Text>
              <Text style={styles.hostSub}>
                {creatorMeta(host.id)}
                {"\n"}TikTok {creatorChannel(host.id).handle} · 已完成 {host.done} 次 · 履约 {host.fulfill}
              </Text>
              <Pressable style={styles.hostProfileBtn}>
                <Text style={styles.hostProfileText}>查看主页</Text>
              </Pressable>
            </View>
            <View style={[styles.hostPick, selected && styles.hostPickOn]}>
              <Text style={[styles.hostPickText, selected && styles.hostPickTextOn]}>
                {selected ? "已选择" : "选择"}
              </Text>
            </View>
          </Pressable>
        );
      })}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{selectedHost.name} 的可预约时间</Text>
        <Text style={styles.sectionHint}>{experience.duration}</Text>
      </View>
      <View style={styles.slots}>
        {SLOTS.map(([id, label]) => (
          <Pressable key={id} onPress={() => setSelectedSlot(id)} style={[styles.slot, selectedSlot === id && styles.slotOn]}>
            <Text style={[styles.slotText, selectedSlot === id && styles.slotTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.priceGate}>
        <View><Text style={styles.priceGateLabel}>本次体验价格</Text><Text style={styles.priceGateValue}>{experience.price}</Text></View>
        <Pressable accessibilityLabel="继续预约" style={styles.priceGateBtn}><Text style={styles.priceGateBtnText}>继续预约</Text></Pressable>
      </View>
      <Pressable onPress={onBack} style={styles.ctaLight}>
        <Text style={styles.ctaLightText}>返回体验</Text>
      </Pressable>
    </ScrollView>
  );
}

function creatorChannel(id: string): { handle: string; followers: string; relation: string } {
  return {
    linh: { handle: "@linh.hanoi", followers: "12.4k", relation: "已关注" },
    mai: { handle: "@mai.frames", followers: "8.7k", relation: "新发现" },
    anh: { handle: "@anh.local", followers: "19.1k", relation: "已联系" },
    thao: { handle: "@thao.hn", followers: "4.8k", relation: "推荐" }
  }[id] ?? { handle: "@creator", followers: "—", relation: "推荐" };
}

function creatorMeta(id: string): string {
  return { linh: "城市陪同 · 中文 / 越南语", mai: "摄影 Creator · 西湖", anh: "本地接待 · 还剑", thao: "中文口译 · 河内 / 北宁" }[id] ?? "本地 Creator";
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 18, paddingTop: 8 },

  detailCreator: { alignItems: "center", backgroundColor: color.white, borderColor: "#EAE4ED", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 9, marginVertical: 8, padding: 10 },
  detailAvatar: { borderRadius: 13, height: 50, width: 50 },
  detailCreatorCopy: { flex: 1, minWidth: 0 },
  detailCreatorName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  detailCreatorMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  detailProfileBtn: { backgroundColor: color.white, borderColor: color.line, borderRadius: 9, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 7 },
  detailProfileText: { color: "#5F5663", fontSize: 11, fontWeight: "800" },
  detailObject: { backgroundColor: color.ink, borderRadius: 18, marginVertical: 8, padding: 12 },
  detailObjectType: { color: "#C7BDC9", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  detailObjectTitle: { color: color.white, fontSize: 16, fontWeight: "800", marginBottom: 4, marginTop: 5 },
  detailObjectText: { color: "#D6CED9", fontSize: 11, lineHeight: 15 },
  detailObjectWhen: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  detailObjectChip: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 999, color: color.white, fontSize: 11, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 5 },

  scope: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 8,
    padding: 14,
    ...shadows.card
  },
  sectionTitleInline: { color: color.ink, fontSize: 13, fontWeight: "700", marginBottom: 9 },
  scopeRow: { borderTopColor: "#F1EDF3", borderTopWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 8 },
  scopeKey: { color: color.muted, fontSize: 11, fontWeight: "700", width: 44 },
  scopeValue: { color: color.ink, flex: 1, fontSize: 11, lineHeight: 15 },

  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 10 },
  sectionTitle: { color: color.ink, fontSize: 12.5, fontWeight: "700" },
  sectionHint: { color: color.muted, fontSize: 11 },

  hostCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    marginVertical: 5,
    padding: 12,
    ...shadows.card
  },
  hostCardOn: { borderColor: color.magenta, borderWidth: 1.5 },
  hostPhoto: { borderRadius: 999, height: 46, width: 46 },
  hostCopy: { flex: 1, minWidth: 0 },
  hostName: { color: color.ink, fontSize: 11, fontWeight: "700" },
  hostSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  hostProfileBtn: { alignSelf: "flex-start", marginTop: 6 },
  hostProfileText: { color: "#633B99", fontSize: 11, fontWeight: "800" },
  hostPick: {
    alignItems: "center",
    backgroundColor: "#F3EEFA",
    borderRadius: 10,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  hostPickOn: { backgroundColor: color.ink },
  hostPickText: { color: "#5B2CB5", fontSize: 11, fontWeight: "800" },
  hostPickTextOn: { color: color.white },

  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  slot: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9
  },
  slotOn: { backgroundColor: color.ink, borderColor: color.ink },
  slotText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  slotTextOn: { color: color.white },

  priceGate: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 16, padding: 11 },
  priceGateLabel: { color: color.muted, fontSize: 11 },
  priceGateValue: { color: color.ink, fontSize: 14, fontWeight: "900", marginTop: 2 },
  priceGateBtn: { backgroundColor: color.lime, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  priceGateBtnText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  ctaLight: {
    alignItems: "center",
    borderRadius: 14,
    marginTop: 9,
    paddingVertical: 14
  },
  ctaLightText: { color: "#6E6575", fontSize: 11, fontWeight: "700" }
});

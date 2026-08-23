// RequesterHome（稳定 Surface，R15.12.7 rhome）：
// r157HomeTop + r1572HomeComposer('USER') + 继续/2项 + r157Action 周六新店开业 + r157Action 周末摄影散步
// + r157MarketPulse + bottom。无 hero / attention / teaser / rail / quick / reusable。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（rhome，HTML 5197-5203）。
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";
import type { HardDemandCategory } from "../uiplan/types";

export interface RequesterGoal {
  category: HardDemandCategory;
  goal: string;
}

// 基线 .r157Action 数据：继续 · 2 项。
const CONTINUE_ITEMS: ReadonlyArray<{
  icon: ProxyIconName;
  title: string;
  sub: string;
  progress?: string;
  headcount?: string;
}> = [
  { icon: "diamond", title: "周六新店开业", sub: "正在匹配 · 还差 1 位", progress: "80%" },
  { icon: "circle", title: "周末摄影散步", sub: "你已感兴趣 · 周六 15:30", headcount: "8/12" }
];

export function RequesterHome({
  onEnterWorkspace,
  onOpenMarket,
  onOpenFeed,
  onChat
}: {
  onEnterWorkspace: (selection: RequesterGoal) => void;
  onOpenMarket?: ((tab: MarketTab) => void) | undefined;
  onOpenFeed?: (() => void) | undefined;
  onChat?: ((text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void) | undefined;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode | undefined>("SERVICE");
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* 基线 .r157HomeTop：今天想做什么？ + 河内·还剑湖附近 + 用户⌄ */}
      <View style={styles.homeTop}>
        <View style={styles.homeTopCopy}>
          <Text style={styles.homeTopTitle}>今天想做什么？</Text>
          <Text style={styles.homeTopLoc}>河内 · 还剑湖附近</Text>
        </View>
      </View>

      {/* 基线 .r1572HomeComposer('USER')：HomeChatBox（无示例 / 无提示） */}
      {onChat ? (
        <HomeChatBox
          contextLabel="用户"
          placeholder="例如：周六下午想在西湖拍照"
          mode={intentMode}
          onSelectMode={(mode) => {
            setIntentMode((current) => current === mode ? undefined : mode);
          }}
          onSend={(text, mode, attachment) => onChat(text, mode, attachment)}
        />
      ) : null}

      {/* 基线 继续 / 2 项 */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>继续</Text>
        <Text style={styles.sectionHint}>{CONTINUE_ITEMS.length} 项</Text>
      </View>
      {CONTINUE_ITEMS.map((item) => (
        <Pressable key={item.title} onPress={() => onOpenMarket?.("OPPORTUNITY")} style={styles.actionCard}>
          <View style={styles.actionIcon}>
            <ProxyIcon color={color.ink} name={item.icon} size={20} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>{item.title}</Text>
            <Text style={styles.actionSub}>{item.sub}</Text>
          </View>
          {item.progress !== undefined ? (
            <View style={styles.actionTag}>
              <Text style={styles.actionTagText}>{item.progress}</Text>
            </View>
          ) : item.headcount !== undefined ? (
            <View style={styles.actionTag}>
              <Text style={styles.actionTagText}>{item.headcount}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}

      {/* 基线 .r157MarketPulse：市场正在发生 24 体验 / 46 机会 / 18 活动（点入市场） */}
      <Pressable onPress={() => onOpenMarket?.("OPPORTUNITY")} style={styles.marketPulse}>
        <View style={styles.marketPulseGradient}>
          <View style={styles.marketPulseCopy}>
            <Text style={styles.marketPulseTitle}>市场正在发生</Text>
            <Text style={styles.marketPulseDesc}>体验、机会、活动。</Text>
          </View>
          <View style={styles.marketPulseNums}>
            {(
              [
                ["24", "体验"],
                ["46", "机会"],
                ["18", "活动"]
              ] as const
            ).map(([value, label]) => (
              <View key={label} style={styles.marketPulseNum}>
                <Text style={styles.marketPulseValue}>{value}</Text>
                <Text style={styles.marketPulseNumLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 16, paddingTop: 13 },

  // 基线 .r157HomeTop：flex space-between。
  homeTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7
  },
  homeTopCopy: { flex: 1 },
  homeTopTitle: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  homeTopLoc: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },

  // 基线 .sectionhead：margin-top 10；b 12 / span 9。
  sectionHead: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
    marginTop: 14
  },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },

  // 基线 .r157Action：white card，icon 块 + 标题/副标题 + 右侧数值。
  actionCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginVertical: 5,
    padding: 12,
    ...shadows.card
  },
  actionIcon: {
    alignItems: "center",
    backgroundColor: "#F3EDFF",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  actionCopy: { flex: 1 },
  actionTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  actionSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  actionTag: { backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  actionTagText: { color: color.ink, fontSize: 11, fontWeight: "800", lineHeight: 15 },

  // 基线 .r157MarketPulse：dark 渐变底，radius 18，flex 左右；nums 3 格。
  marketPulse: {
    alignItems: "center",
    backgroundColor: color.deep,
    borderRadius: 24,
    flexDirection: "row",
    gap: 10,
    marginBottom: 6,
    marginTop: 12,
    overflow: "hidden",
    padding: 0,
    ...shadows.card
  },
  marketPulseGradient: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
    width: "100%"
  },
  marketPulseCopy: { flex: 1 },
  marketPulseTitle: { color: color.white, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  marketPulseDesc: { color: "#D8CFDC", fontSize: 11, lineHeight: 15, marginTop: 3 },
  marketPulseNums: { flexDirection: "row", gap: 5 },
  marketPulseNum: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 16, paddingHorizontal: 8, paddingVertical: 7 },
  marketPulseValue: { color: color.white, fontSize: 20, fontWeight: "900", lineHeight: 24, textAlign: "center" },
  marketPulseNumLabel: { color: "#D4CAD9", fontSize: 11, lineHeight: 15, textAlign: "center" }
});

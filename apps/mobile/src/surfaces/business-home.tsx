// BusinessHome（稳定 Surface，R15.12.7 bhome）：
// r157HomeTop + r1572HomeComposer('BUSINESS') + 待处理 今天 + 3 × r157Action
// + r157Resume 经营 + r157BizQuick。无 market pulse。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（bhome，HTML 5204）。
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";

// R15.13：Scene Package 即将在商家处成立的真实场景
const SCENE_PACKAGES: ReadonlyArray<{ title: string; sub: string; tag: string }> = [
  { title: "Rooftop Photo Afternoon", sub: "15:00–18:00 · 2–6人 · 饮品 included", tag: "拍照友好" },
  { title: "Aster Coffee Sunset", sub: "日落 · 4人小组 · 甜点 Benefit", tag: "Host Sponsored" },
];

// 基线 待处理 · 今天 3 项。
const PENDING_ITEMS: ReadonlyArray<{
  icon: ProxyIconName;
  title: string;
  tag?: string;
  headcount?: string;
}> = [
  { icon: "target", title: "周六开业 · 还缺 1 位", tag: "优先" },
  { icon: "check", title: "今日现场执行", headcount: "4 人" },
  { icon: "target", title: "线上店铺" }
];

const BIZ_QUICK: ReadonlyArray<{ icon: ProxyIconName; label: string }> = [
  { icon: "spark", label: "运营助手" },
  { icon: "target", label: "线上店铺" },
  { icon: "arrowUpRight", label: "结果复盘" }
];

export function BusinessHome({
  onOpenMarket,
  onOpenMe,
  onChat
}: {
  onOpenMarket: (tab: MarketTab) => void;
  onOpenMe: () => void;
  onChat?: ((text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void) | undefined;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode>();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* 基线 .r157HomeTop：Bonsaidon + 今天要推进什么？ + 商家⌄ */}
      <View style={styles.homeTop}>
        <View style={styles.homeTopCopy}>
          <Text style={styles.homeTopTitle}>Bonsaidon</Text>
          <Text style={styles.homeTopLoc}>今天要推进什么？</Text>
        </View>
      </View>

      {/* 基线 .r1572HomeComposer('BUSINESS')：HomeChatBox（无示例 / 无提示） */}
      {onChat ? (
        <HomeChatBox
          contextLabel="商家"
          placeholder="例如：周六想办一场门店体验活动"
          mode={intentMode}
          onSelectMode={(mode) => {
            setIntentMode((current) => current === mode ? undefined : mode);
          }}
          onSend={(text, mode, attachment) => onChat(text, mode, attachment)}
        />
      ) : null}

      {/* R15.13 Scene Packages — 商家真正可供给的场景 */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>可供给场景</Text>
        <Text style={styles.sectionHint}>Scene Package</Text>
      </View>
      {SCENE_PACKAGES.map((pkg) => (
        <View key={pkg.title} style={styles.actionCard}>
          <View style={styles.actionIcon}><ProxyIcon color={color.ink} name="cup" size={20} /></View>
          <View style={styles.actionCopy}><Text style={styles.actionTitle}>{pkg.title}</Text><Text style={{ color: color.muted, fontSize: 11 }}>{pkg.sub}</Text></View>
          <View style={styles.actionMetricTag}><Text style={styles.actionMetricTagText}>{pkg.tag}</Text></View>
        </View>
      ))}

      {/* 基线 待处理 · 今天 */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>待处理</Text>
        <Text style={styles.sectionHint}>今天</Text>
      </View>
      {PENDING_ITEMS.map((item) => (
        <Pressable key={item.title} onPress={() => onOpenMarket("OPPORTUNITY")} style={styles.actionCard}>
          <View style={styles.actionIcon}>
            <ProxyIcon color={color.ink} name={item.icon} size={20} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>{item.title}</Text>
          </View>
          {item.tag !== undefined ? (
            <View style={styles.actionMetricTag}>
              <Text style={styles.actionMetricTagText}>{item.tag}</Text>
            </View>
          ) : item.headcount !== undefined ? (
            <View style={styles.actionMetricTag}>
              <Text style={styles.actionMetricTagText}>{item.headcount}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}

      {/* R15.13 Scene Result — 不只核销 */}
      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>场景结果</Text>
        <Text style={styles.resultSub}>Invite Sent 12 · Accept 7 · Attendance 6 · 复访 2</Text>
        <Text style={styles.resultHint}>哪种 Scene 真正带来增量消费和复访？</Text>
      </View>

      {/* 基线 .r157Resume：经营 · 更多在「我的」 */}
      <Pressable onPress={onOpenMe} style={styles.resume}>
        <Text style={styles.resumeTitle}>经营</Text>
        <Text style={styles.resumeHint}>更多在「我的」›</Text>
      </Pressable>

      {/* 基线 .r157BizQuick：运营助手 / 线上店铺 / 结果复盘 */}
      <View style={styles.quickRow}>
        {BIZ_QUICK.map((entry) => (
          <Pressable key={entry.label} onPress={onOpenMe} style={styles.quickCard}>
            <View style={styles.quickIcon}>
              <ProxyIcon color={color.muted} name={entry.icon} size={20} />
            </View>
            <Text style={styles.quickLabel}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>
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
    marginBottom: 6,
    marginTop: 10
  },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },

  // 基线 .r157Action：white card，icon 块 + 标题 + 右侧 标签/人数。
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
  actionMetricTag: { backgroundColor: color.lime, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  actionMetricTagText: { color: color.ink, fontSize: 11, fontWeight: "800", lineHeight: 15 },

  // 基线 .r157Resume：resumebar 浅绿底。
  resume: {
    alignItems: "center",
    backgroundColor: color.resumebarBg,
    borderColor: color.resumebarBorder,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 9,
    padding: 12
  },
  resumeTitle: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  resumeHint: { color: "#6A7A2C", fontSize: 11, fontWeight: "600", lineHeight: 15 },

  // 基线 .r157BizQuick：3 列。
  quickRow: { flexDirection: "row", gap: 7 },
  quickCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    padding: 12
  },
  quickIcon: { alignItems: "center", height: 26, justifyContent: "center", width: 26 },
  quickLabel: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },

  resultCard: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 10, gap: 4, ...shadows.card },
  resultTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  resultSub: { color: color.ink, fontSize: 12, fontWeight: "600" },
  resultHint: { color: color.muted, fontSize: 11 },
});

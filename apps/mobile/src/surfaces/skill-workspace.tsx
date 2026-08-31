// SKILL_WORKSPACE — Enterprise 运营 Skill 工作区去占位化
// PRD Chapter07/08：Capability Passport + Supply Capacity
// 接线：本地 catalog + Supply 能力示例（静态 catalog 为 Source of Truth，P0 不做动态技能审核）
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { color, shadows } from "../theme";

const SKILLS: Array<{ id: string; label: string; group: string; desc: string }> = [
  { id: "ZH", label: "中文", group: "语言", desc: "中文现场沟通 / 翻译" },
  { id: "EN", label: "英语", group: "语言", desc: "英语接待 / 会议" },
  { id: "VI", label: "越南语", group: "语言", desc: "本地沟通" },
  { id: "PHOTOGRAPHY", label: "摄影", group: "内容", desc: "活动/探店拍摄 + 基础剪辑" },
  { id: "HOSTING", label: "主持", group: "内容", desc: "活动主持 / 串场" },
  { id: "GUIDE", label: "城市向导", group: "向导", desc: "河内/胡志明本地路线 + 消费陪同" },
  { id: "TRANSLATION", label: "同传/陪同翻译", group: "语言", desc: "商务/消费场景翻译" },
  { id: "EVENT_OPS", label: "活动执行", group: "运营", desc: "签到/接待/现场执行" },
];

export function SkillWorkspaceSurface(): React.JSX.Element {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Skill 工作区</Text>
      <Text style={styles.sub}>Enterprise 运营技能目录 — 静态 catalog（P0），能力核验走 supply.verified，审核由运营后台完成。</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>能力组 · 8 项（示例）</Text>
        <Text style={styles.cardSub}>来源：Proxy Agent Capability Graph（Chapter07）。P0 仅展示，不在此页直接发证。</Text>
      </View>
      {SKILLS.map((s) => (
        <View key={s.id} style={styles.row}>
          <View style={styles.badge}><Text style={styles.badgeText}>{s.group}</Text></View>
          <View style={styles.copy}>
            <Text style={styles.name}>{s.label} · {s.id}</Text>
            <Text style={styles.desc}>{s.desc}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.hint}>说明：真实供给的“已核验”状态在 supply.capabilities.verified，核验命令需 operator 白名单（PROXY_OPERATOR_PRINCIPALS）。本页为运营只读目录，后续可接 ListVerifiedCapabilities。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  container: { gap: 10, padding: 16, paddingBottom: 24 },
  title: { color: color.ink, fontSize: 18, fontWeight: "900" },
  sub: { color: color.muted, fontSize: 12, lineHeight: 16 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, padding: 14, ...shadows.card },
  cardTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  cardSub: { color: color.muted, fontSize: 11, lineHeight: 14, marginTop: 4 },
  row: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, padding: 12, ...shadows.card },
  badge: { alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: color.white, fontSize: 10, fontWeight: "800" },
  copy: { flex: 1 },
  name: { color: color.ink, fontSize: 13, fontWeight: "800" },
  desc: { color: color.muted, fontSize: 11, lineHeight: 14, marginTop: 2 },
  hint: { color: color.muted, fontSize: 10, lineHeight: 13 },
});

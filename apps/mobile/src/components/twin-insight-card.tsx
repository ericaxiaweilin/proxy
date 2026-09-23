import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TwinInsight, TwinInsightThresholds, TwinInsightVerdict } from "@proxy/contracts";
import { twinScoreBand, formatTwinStay } from "@proxy/contracts";
import { color, foundation } from "../theme";
import { ProxyAvatar, ProxyButton } from "./proxy-foundation";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { twinAvatarSource } from "./twin-avatar-source";

// TWIN-INSIGHT-001 — AI 分身 · 好友洞察卡（R3 实现，原型仅功能参考）。
//
// 原型 → R3 映射（故意不 1:1 复制原型视觉）：
//  - 👁💬⏱❤️ emoji → proxy-icon（search/chat/clock/heart），禁止 emoji 回退；
//  - 渐变头像 → ProxyAvatar（首字回退 + server 真图）；
//  - 硬编码 #e07b39 / #0a0a0a → foundation + color token；
//  - 硬编码 60/40 阈值 → 服务端 thresholds 快照 + twinScoreBand；
//  - <strong> HTML → Text 嵌套（wire 必须是纯文本，见 contract 注释）。
export const TWIN_SIGNAL_DOT: Record<TwinInsight["signal"], string> = {
  hot: foundation.danger,
  warm: foundation.accent,
  cold: color.muted,
  new: color.proxyPurple,
};

export function twinVerdictMeta(verdict: TwinInsightVerdict): { label: string; bg: string; fg: string } {
  switch (verdict) {
    case "worth":
      return { label: "值得运营", bg: color.proxyGreenSoft, fg: color.proxyGreen };
    case "watch":
      return { label: "可以培养", bg: color.warnBannerBg, fg: color.warnBannerText };
    case "new":
      return { label: "新好友", bg: color.stateInfoBg, fg: color.proxyPurple };
    case "skip":
    default:
      return { label: "暂不推荐", bg: color.chipNeutralBg, fg: color.chipNeutralText };
  }
}

export function twinAdviceIcon(type: TwinInsight["advices"][number]["type"]): ProxyIconName {
  switch (type) {
    case "good":
      return "check";
    case "warn":
      return "star";
    case "info":
    default:
      return "infoCircle";
  }
}

export function twinScoreHint(score: number, thresholds: TwinInsightThresholds): string {
  const band = twinScoreBand(score, thresholds);
  if (band === "above") return `超过 ${thresholds.operateAt} 分阈值 · 建议开启单独运营`;
  if (band === "near") return `未到 ${thresholds.operateAt} 分阈值 · 建议再观察一段时间`;
  return `低于 ${thresholds.observeAt} 分 · 不建议投入运营精力`;
}

export function TwinTargetRail({
  insights,
  selectedId,
  onSelect,
  resolveMediaUrl,
}: {
  insights: ReadonlyArray<TwinInsight>;
  selectedId: string | undefined;
  onSelect: (targetId: string) => void;
  resolveMediaUrl?: ((path: string) => string) | undefined;
}): React.JSX.Element {
  return (
    <ScrollView
      accessibilityRole="tablist"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {insights.map((item) => {
        const selected = item.targetId === selectedId;
        const avatarSource = twinAvatarSource(item.avatarUrl, resolveMediaUrl);
        return (
          <Pressable
            key={item.targetId}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${item.displayName}，${twinVerdictMeta(item.verdict).label}，${item.score}分`}
            onPress={() => onSelect(item.targetId)}
            style={styles.target}
          >
            <View style={[styles.targetAvatarWrap, selected && styles.targetAvatarSelected]}>
              <ProxyAvatar
                accessibilityLabel={`${item.displayName}头像`}
                fallback={item.initial}
                size={44}
                {...(avatarSource ? { source: avatarSource } : {})}
              />
              <View style={[styles.signalDot, { backgroundColor: TWIN_SIGNAL_DOT[item.signal] }]} />
            </View>
            <Text style={[styles.targetName, selected && styles.targetNameSelected]} numberOfLines={1}>
              {item.displayName}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function TwinInsightCard({
  insight,
  thresholds,
  expanded,
  acting = false,
  onToggle,
  onObserve,
  onOperate,
  onRefreshSummary,
  resolveMediaUrl,
}: {
  insight: TwinInsight;
  thresholds: TwinInsightThresholds;
  expanded: boolean;
  acting?: boolean;
  onToggle: () => void;
  onObserve: () => void;
  onOperate: () => void;
  onRefreshSummary: () => void;
  resolveMediaUrl?: ((path: string) => string) | undefined;
}): React.JSX.Element {
  const verdict = twinVerdictMeta(insight.verdict);
  const avatarSource = twinAvatarSource(insight.avatarUrl, resolveMediaUrl);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${insight.displayName}洞察，${verdict.label}，${insight.score}分，${expanded ? "收起" : "展开"}`}
        onPress={onToggle}
        style={styles.summary}
      >
        <View style={styles.topRow}>
          <View style={styles.avatarWrap}>
            <ProxyAvatar
              accessibilityLabel={`${insight.displayName}头像`}
              fallback={insight.initial}
              size={44}
              {...(avatarSource ? { source: avatarSource } : {})}
            />
            <View style={[styles.signalDot, { backgroundColor: TWIN_SIGNAL_DOT[insight.signal] }]} />
          </View>
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{insight.displayName}</Text>
              <View style={[styles.chip, { backgroundColor: verdict.bg }]}>
                <Text style={[styles.chipText, { color: verdict.fg }]}>{insight.verdictLabel}</Text>
              </View>
            </View>
            <Text style={styles.hint} numberOfLines={1}>
              {insight.summaryHint}
            </Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.score}>
              {insight.score}
              <Text style={styles.scoreUnit}>/100</Text>
            </Text>
          </View>
        </View>
        {!expanded ? (
          <View style={styles.miniRow}>
            <Text style={styles.mini}>
              <Text style={styles.miniVal}>{insight.signals.views7d}</Text>访问
            </Text>
            <Text style={styles.mini}>
              <Text style={styles.miniVal}>{insight.signals.messages7d}</Text>对话
            </Text>
            <Text style={styles.mini}>
              <Text style={styles.miniVal}>{insight.signals.likes7d}</Text>点赞
            </Text>
          </View>
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          <View style={styles.divider} />
          <View style={styles.grid}>
            <SignalCell icon="search" value={`${insight.signals.views7d}次`} label="7天访问" />
            <SignalCell icon="chat" value={`${insight.signals.messages7d}条`} label="对话消息" />
            <SignalCell icon="clock" value={formatTwinStay(insight.signals.avgStaySec)} label="平均停留" />
            <SignalCell icon="heart" value={`${insight.signals.likes7d}次`} label="点赞/收藏" />
          </View>

          <View style={styles.scoreBlock}>
            <View style={styles.scoreHead}>
              <Text style={styles.scoreLabel}>运营价值评分</Text>
              <Text style={styles.scoreBig}>
                {insight.score}
                <Text style={styles.scoreBigUnit}>/100</Text>
              </Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.fill, { width: `${insight.score}%` }]} />
            </View>
            <Text style={styles.scoreHint}>{twinScoreHint(insight.score, thresholds)}</Text>
          </View>

          <Text style={styles.blockTitle}>AI 建议</Text>
          {insight.advices.map((advice, index) => (
            <View key={`${advice.type}-${index}`} style={styles.advice}>
              <ProxyIcon name={twinAdviceIcon(advice.type)} size={16} color={foundation.ink} />
              <Text style={styles.adviceText}>{advice.text}</Text>
            </View>
          ))}

          <View style={styles.summaryHead}>
            <Text style={styles.blockTitle}>对话摘要</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="重新总结" onPress={onRefreshSummary}>
              <Text style={styles.refresh}>重新总结</Text>
            </Pressable>
          </View>
          <Text style={styles.summaryText}>{insight.summaryText}</Text>

          <Text style={styles.blockTitle}>最近互动</Text>
          {insight.timeline.map((item, index) => (
            <View key={`${item.time}-${index}`} style={styles.timelineRow}>
              <View style={[styles.dot, item.gray && styles.dotGray]} />
              <View style={styles.timelineInfo}>
                <Text style={styles.timelineText}>{item.text}</Text>
                <Text style={styles.timelineTime}>{item.time}</Text>
              </View>
            </View>
          ))}

          <View style={styles.actions}>
            <ProxyButton tone="secondary" disabled={acting} onPress={onObserve}>
              先观察
            </ProxyButton>
            <ProxyButton tone="primary" disabled={acting} onPress={onOperate}>
              开启单独运营
            </ProxyButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SignalCell({ icon, value, label }: { icon: ProxyIconName; value: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.cell}>
      <ProxyIcon name={icon} size={18} color={foundation.muted} />
      <Text style={styles.cellVal}>{value}</Text>
      <Text style={styles.cellKey}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { gap: foundation.space.three, paddingHorizontal: foundation.space.four, paddingBottom: foundation.space.three },
  target: { alignItems: "center", gap: 6, width: 64 },
  targetAvatarWrap: { borderColor: "transparent", borderRadius: foundation.radius.full, borderWidth: 2, padding: 1 },
  targetAvatarSelected: { borderColor: foundation.ink },
  avatarWrap: { position: "relative" },
  signalDot: { borderColor: color.white, borderRadius: 6, borderWidth: 2, height: 12, position: "absolute", right: -1, top: -1, width: 12 },
  targetName: { color: color.muted, fontSize: 11, fontWeight: "600", textAlign: "center" },
  targetNameSelected: { color: foundation.ink, fontWeight: "800" },
  card: { backgroundColor: foundation.surface, borderColor: foundation.line, borderRadius: foundation.radius.md, borderWidth: 1, marginHorizontal: foundation.space.four, marginBottom: foundation.space.four, overflow: "hidden" },
  summary: { padding: foundation.space.four },
  topRow: { alignItems: "center", flexDirection: "row", gap: foundation.space.three },
  info: { flex: 1, minWidth: 0 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 2 },
  name: { color: foundation.ink, fontSize: 15, fontWeight: "800" },
  chip: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: "800" },
  hint: { color: color.muted, fontSize: 12 },
  right: { alignItems: "flex-end" },
  score: { color: foundation.ink, fontSize: 18, fontWeight: "800" },
  scoreUnit: { color: color.muted, fontSize: 11, fontWeight: "700" },
  miniRow: { borderTopColor: foundation.line, borderTopWidth: 1, flexDirection: "row", gap: foundation.space.four, marginTop: foundation.space.three, paddingTop: foundation.space.three },
  mini: { color: color.muted, fontSize: 12, fontWeight: "600" },
  miniVal: { color: foundation.ink, fontSize: 13, fontWeight: "800" },
  detail: { paddingHorizontal: foundation.space.four, paddingBottom: foundation.space.four },
  divider: { backgroundColor: foundation.line, height: 1, marginBottom: foundation.space.four },
  grid: { flexDirection: "row", gap: 8, marginBottom: foundation.space.four },
  cell: { alignItems: "center", backgroundColor: foundation.surfaceSecondary, borderRadius: foundation.radius.sm, flex: 1, gap: 3, paddingVertical: 12 },
  cellVal: { color: foundation.ink, fontSize: 15, fontWeight: "800" },
  cellKey: { color: color.muted, fontSize: 11, fontWeight: "600" },
  scoreBlock: { backgroundColor: color.warnBannerBg, borderColor: color.warnBannerBorder, borderRadius: foundation.radius.sm, borderWidth: 1, marginBottom: foundation.space.four, padding: foundation.space.three },
  scoreHead: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  scoreLabel: { color: color.warnBannerText, fontSize: 11, fontWeight: "700" },
  scoreBig: { color: foundation.ink, fontSize: 22, fontWeight: "800" },
  scoreBigUnit: { color: color.warnBannerText, fontSize: 12, fontWeight: "700" },
  bar: { backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 4, height: 8, overflow: "hidden" },
  fill: { backgroundColor: foundation.accent, borderRadius: 4, height: "100%" },
  scoreHint: { color: color.warnBannerText, fontSize: 12, marginTop: 9 },
  blockTitle: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 10 },
  advice: { alignItems: "flex-start", backgroundColor: foundation.surfaceSecondary, borderRadius: foundation.radius.sm, flexDirection: "row", gap: 10, marginBottom: 6, padding: 12 },
  adviceText: { color: foundation.ink, flex: 1, fontSize: 13, lineHeight: 19 },
  summaryHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: foundation.space.three },
  refresh: { color: color.proxyPurple, fontSize: 11, fontWeight: "700" },
  summaryText: { backgroundColor: foundation.surfaceSecondary, borderRadius: foundation.radius.sm, color: color.muted, fontSize: 13, lineHeight: 21, marginBottom: foundation.space.four, padding: 14 },
  timelineRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, paddingVertical: 6 },
  dot: { backgroundColor: foundation.accent, borderRadius: 4, height: 8, marginTop: 6, width: 8 },
  dotGray: { backgroundColor: color.line },
  timelineInfo: { flex: 1 },
  timelineText: { color: foundation.ink, fontSize: 13 },
  timelineTime: { color: color.muted, fontSize: 11, marginTop: 2 },
  actions: { borderTopColor: foundation.line, borderTopWidth: 1, flexDirection: "row", gap: 8, marginTop: foundation.space.three, paddingTop: foundation.space.three },
});

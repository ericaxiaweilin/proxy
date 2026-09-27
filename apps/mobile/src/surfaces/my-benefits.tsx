import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { HorizontalSwipeRail } from "../components/horizontal-swipe-rail";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { ProxyLoading } from "../components/proxy-foundation";
import { BenefitClient, BenefitError } from "../benefit-client";
import { GrowthClient, GrowthError, type BenefitRow, type Egg, type GrowthSummary, type Task, type TierBenefit, type TierCompareRow } from "../growth-client";
import { BenefitHubSurface } from "./benefit-hub";

// GROWTH-REAL-DATA-001: this surface replaces a mockup that showed a
// complete tier/growth-value/task/egg system with entirely invented
// numbers (1250/2000 points, 48 orders, 4.9 rating, "服务过不同城市"…).
// Every per-user number rendered here comes from GrowthClient.getMySummary()
// (internal/growth, computed at read time from real fulfillment.Order
// records — see that package's doc comment). The static reference tables
// (当前等级特权/双向权益/等级对比) describe the program itself, the same
// for every user, so they carry no fabrication risk either way.
//
// 折叠区块：真实的活动领取列表（BenefitHubSurface）没有被这版替换掉，只是
// 收进了这个页面里的一张入口卡片——点进去还是原来那个组件，onBack 回到本页
// 而不是退出「我的权益」。

const ICON_MAP: Record<string, ProxyIconName> = {
  zap: "spark", shield: "check", headset: "chat", wallet: "wallet",
  star: "star", gift: "bookmark", ticket: "ticket",
};

function resolveIcon(key: string): ProxyIconName {
  return ICON_MAP[key] ?? "star";
}

export function MyGrowthSurface({
  benefitClient,
  growthClient,
  onOpenMarket,
  viewerAvatarUri,
  viewerDisplayName,
}: {
  benefitClient: BenefitClient;
  growthClient: GrowthClient;
  onOpenMarket?: (() => void) | undefined;
  viewerAvatarUri?: string | undefined;
  viewerDisplayName?: string | undefined;
}): React.JSX.Element {
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [summary, setSummary] = useState<GrowthSummary | null>(null);
  const [campaignCount, setCampaignCount] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [side, setSide] = useState<"provider" | "client">("provider");

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const [nextSummary, campaigns] = await Promise.all([
        growthClient.getMySummary(),
        benefitClient.listCampaigns({ status: "ACTIVE" }).catch(() => []),
      ]);
      setSummary(nextSummary);
      setCampaignCount(campaigns.length);
    } catch (err) {
      setSummary(null);
      setError(err instanceof GrowthError || err instanceof BenefitError ? err.message : "权益数据读取失败");
    } finally {
      setBusy(false);
    }
  }, [growthClient, benefitClient]);

  useEffect(() => {
    void load();
  }, [load]);

  if (showCampaigns) {
    return <BenefitHubSurface onBack={() => setShowCampaigns(false)} />;
  }

  if (busy && !summary) {
    return <View style={{ alignItems: "center", paddingVertical: 24 }}><ProxyLoading tone="muted" /></View>;
  }

  if (error || !summary) {
    return (
      <View style={styles.infoNote}>
        <Text selectable style={styles.infoNoteText}>{error ?? "权益数据读取失败"}</Text>
        <Pressable onPress={() => void load()} style={styles.retryButton}><Text selectable style={styles.retryButtonText}>重试</Text></Pressable>
      </View>
    );
  }

  const initial = (viewerDisplayName ?? "").trim().slice(0, 1) || "P";
  const percent = summary.tier.nextLevelPoints
    ? Math.min(100, Math.round((summary.tier.currentPoints / summary.tier.nextLevelPoints) * 100))
    : 100;

  return (
    <View>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroHead}>
          {viewerAvatarUri ? (
            <CircularAvatarImage size={52} uri={viewerAvatarUri} />
          ) : (
            <View style={styles.heroAvatarFallback}><Text selectable style={styles.heroAvatarFallbackText}>{initial}</Text></View>
          )}
          <View style={styles.heroHeadInfo}>
            <Text numberOfLines={1} selectable style={styles.heroName}>{viewerDisplayName || "我"} <Text style={styles.heroBadge}>{summary.tier.name}</Text></Text>
            <Text selectable style={styles.heroSub}>成长值 {summary.tier.currentPoints}{summary.tier.nextLevelPoints ? ` / ${summary.tier.nextLevelPoints}` : ""}</Text>
          </View>
        </View>
        <View style={styles.heroProgressBar}><View style={[styles.heroProgressFill, { width: `${percent}%` }]} /></View>
        <Text selectable style={styles.heroProgressText}>
          {summary.tier.nextLevelName ? `距离 ${summary.tier.nextLevelName} 还差 ${Math.max(0, summary.tier.nextLevelPoints! - summary.tier.currentPoints)} 成长值` : "已是最高等级"}
        </Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}><Text selectable style={styles.heroStatValue}>{summary.stats.completedOrders}</Text><Text selectable style={styles.heroStatLabel}>累计接单</Text></View>
          <View style={styles.heroStat}>
            <Text selectable style={styles.heroStatValue}>{summary.stats.hasSatisfactionData ? `${summary.stats.satisfactionFullRatePercent}%` : "—"}</Text>
            <Text selectable style={styles.heroStatLabel}>满意率</Text>
          </View>
          <View style={styles.heroStat}><Text selectable style={styles.heroStatValue}>{summary.stats.repeatCustomers}</Text><Text selectable style={styles.heroStatLabel}>复购客户</Text></View>
        </View>
        <View style={styles.todayStrip}>
          <View style={styles.todayHead}>
            <Text selectable style={styles.todayKicker}>今日进度</Text>
            <Text selectable style={styles.todayCount}>{summary.today.completed} / {summary.today.target} 已完成</Text>
          </View>
          <View style={styles.todayTasks}>
            {summary.today.tasks.map((t) => (
              <Text key={t.name} selectable style={[styles.todayTask, t.done && styles.todayTaskDone]}>{t.done ? "✓ " : ""}{t.name}</Text>
            ))}
          </View>
        </View>
      </View>

      {/* 当前等级特权 */}
      <SectionTitle count={`${summary.tierBenefits.filter((b) => b.unlocked).length} 项可用`} title="当前等级特权" />
      <View style={styles.benefitGrid}>
        {summary.tierBenefits.map((b) => <TierBenefitCard benefit={b} key={b.name} />)}
      </View>

      {/* 可领取活动 折叠入口 */}
      <Pressable accessibilityLabel="查看可领取活动" onPress={() => setShowCampaigns(true)} style={styles.campaignEntry}>
        <ProxyIcon color={color.magenta} name="ticket" size={20} />
        <Text selectable style={styles.campaignEntryText}>可领取活动 {campaignCount ?? 0} 个</Text>
        <Text selectable style={styles.campaignEntryChevron}>›</Text>
      </Pressable>

      {/* 双向权益 */}
      <SectionTitle count="接单方 / 下单方" title="双方权益" />
      <View style={styles.tabRow}>
        <Pressable onPress={() => setSide("provider")} style={[styles.tab, side === "provider" && styles.tabOn]}><Text selectable style={[styles.tabText, side === "provider" && styles.tabTextOn]}>我接单</Text></Pressable>
        <Pressable onPress={() => setSide("client")} style={[styles.tab, side === "client" && styles.tabOn]}><Text selectable style={[styles.tabText, side === "client" && styles.tabTextOn]}>我下单</Text></Pressable>
      </View>
      {(side === "provider" ? summary.benefitsProvider : summary.benefitsClient).map((b) => <BenefitRowCard benefit={b} key={b.name} />)}

      {/* 成长任务 */}
      <SectionTitle hint="订单 + 好评驱动" title="成长任务" />
      {summary.taskGroups.map((group) => (
        <View key={group.label} style={styles.taskGroup}>
          <View style={styles.taskGroupHead}><Text selectable style={styles.taskGroupLabel}>{group.label}</Text><Text selectable style={styles.taskGroupDesc}>{group.desc}</Text></View>
          <View style={styles.taskList}>
            {group.tasks.map((task) => <TaskRow key={task.name} onOpenMarket={onOpenMarket} task={task} />)}
          </View>
        </View>
      ))}

      {/* 隐藏彩蛋 */}
      <SectionTitle count={`${summary.eggs.filter((e) => e.unlocked).length} / ${summary.eggs.length} 已揭晓`} title="隐藏彩蛋" />
      <View style={styles.eggSection}>
        <Text selectable style={styles.eggSub}>彩蛋不属于常规权益。达成条件后自动揭晓，不影响日常接单与下单决策。</Text>
        {summary.eggs.map((egg) => <EggRow egg={egg} key={egg.key} />)}
      </View>

      {/* 等级对比 */}
      <SectionTitle hint="成长值越高，解锁越多" title="等级对比" />
      <HorizontalSwipeRail contentContainerStyle={styles.tierCompareRail} preserveChildPresses threshold={3}>
        {summary.tierCompare.map((t) => <TierCompareCard key={t.level} tier={t} />)}
      </HorizontalSwipeRail>

      <Text selectable style={styles.bottomNote}>等级与订单量绑定 · 彩蛋为额外惊喜，不影响主权益</Text>
    </View>
  );
}

function SectionTitle({ title, count, hint }: { title: string; count?: string; hint?: string }): React.JSX.Element {
  return (
    <View style={styles.sectionTitle}>
      <Text selectable style={styles.sectionTitleText}>{title}</Text>
      {count ? <Text selectable style={styles.sectionTitleCount}>{count}</Text> : null}
      {hint ? <Text selectable style={styles.sectionTitleHint}>{hint}</Text> : null}
    </View>
  );
}

function TierBenefitCard({ benefit }: { benefit: TierBenefit }): React.JSX.Element {
  return (
    <View style={[styles.benefitItem, !benefit.unlocked && styles.benefitItemLocked]}>
      {!benefit.unlocked ? <Text selectable style={styles.benefitLock}>未解锁</Text> : null}
      <View style={[styles.benefitIcon, !benefit.unlocked && styles.benefitIconLocked]}>
        <ProxyIcon color={benefit.unlocked ? "#8C6A00" : color.muted} name={resolveIcon(benefit.icon)} size={16} />
      </View>
      <Text selectable style={styles.benefitName}>{benefit.name}</Text>
      <Text selectable style={styles.benefitDesc}>{benefit.desc}</Text>
    </View>
  );
}

function BenefitRowCard({ benefit }: { benefit: BenefitRow }): React.JSX.Element {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitRowIcon}><ProxyIcon color={color.violet} name={resolveIcon(benefit.icon)} size={16} /></View>
      <View style={styles.benefitRowBody}>
        <Text selectable style={styles.benefitRowName}>{benefit.name}</Text>
        <Text selectable style={styles.benefitRowDesc}>{benefit.desc}</Text>
      </View>
      <Text selectable style={styles.benefitRowValue}>{benefit.value}</Text>
    </View>
  );
}

function TaskRow({ task, onOpenMarket }: { task: Task; onOpenMarket?: (() => void) | undefined }): React.JSX.Element {
  const showAction = !task.done && !!task.actionTarget;
  return (
    <View style={styles.taskItem}>
      <View style={[styles.taskIcon, task.done && styles.taskIconDone]}>
        <ProxyIcon color={task.done ? "#1E6E3E" : color.muted} name={task.done ? "check" : "spark"} size={16} />
      </View>
      <View style={styles.taskInfo}>
        <Text selectable style={styles.taskName}>{task.name}</Text>
        <Text selectable style={[styles.taskReward, task.done && styles.taskRewardDim]}>{task.reward}</Text>
        <Text selectable style={styles.taskProgress}>{task.progress}</Text>
      </View>
      {task.done ? (
        <Text selectable style={styles.taskDoneBadge}>已完成</Text>
      ) : showAction ? (
        <Pressable accessibilityLabel={`去完成：${task.name}`} onPress={() => task.actionTarget === "OPEN_MARKET" && onOpenMarket?.()} style={styles.taskAction}>
          <Text selectable style={styles.taskActionText}>去接单</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EggRow({ egg }: { egg: Egg }): React.JSX.Element {
  return (
    <View style={[styles.eggItem, egg.unlocked && styles.eggItemUnlocked]}>
      <View style={[styles.eggIcon, egg.unlocked && styles.eggIconUnlocked]}>
        <Text selectable style={styles.eggIconText}>{egg.unlocked ? "✦" : "?"}</Text>
      </View>
      <View style={styles.eggBody}>
        <Text selectable style={[styles.eggName, !egg.unlocked && styles.eggNameBlur]}>{egg.unlocked ? egg.label : "???"}</Text>
        <Text selectable style={styles.eggDesc}>{egg.unlocked ? egg.desc : "未解锁"}</Text>
      </View>
    </View>
  );
}

function TierCompareCard({ tier }: { tier: TierCompareRow }): React.JSX.Element {
  return (
    <View style={[styles.tierCard, tier.current && styles.tierCardOn]}>
      <Text selectable style={styles.tierCardBadge}>{tier.current ? "当前" : tier.level}</Text>
      <Text selectable style={styles.tierCardName}>{tier.name}</Text>
      <Text selectable style={styles.tierCardDesc}>{tier.desc}</Text>
      <Text selectable style={styles.tierCardPerks}>{tier.perks}</Text>
      <Text selectable style={styles.tierCardPoints}>{tier.points} 成长值</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: color.ink, borderRadius: 20, marginTop: 4, padding: 18 },
  heroHead: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 14 },
  heroAvatarFallback: { alignItems: "center", backgroundColor: color.violet, borderRadius: 26, height: 52, justifyContent: "center", width: 52 },
  heroAvatarFallbackText: { color: color.white, fontSize: 20, fontWeight: "900" },
  heroHeadInfo: { flex: 1 },
  heroName: { color: color.white, fontSize: 16, fontWeight: "900" },
  heroBadge: { backgroundColor: color.violet, borderRadius: 6, color: color.white, fontSize: 9, fontWeight: "900", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  heroSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", marginTop: 4 },
  heroProgressBar: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 4, height: 8, overflow: "hidden" },
  heroProgressFill: { backgroundColor: color.lime, borderRadius: 4, height: "100%" },
  heroProgressText: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", marginTop: 6 },
  heroStats: { borderTopColor: "rgba(255,255,255,0.08)", borderTopWidth: 1, flexDirection: "row", gap: 8, marginTop: 14, paddingTop: 14 },
  heroStat: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, flex: 1, paddingVertical: 10 },
  heroStatValue: { color: color.white, fontSize: 16, fontWeight: "900" },
  heroStatLabel: { color: "rgba(255,255,255,0.55)", fontSize: 9, fontWeight: "700", marginTop: 3 },
  todayStrip: { borderTopColor: "rgba(255,255,255,0.08)", borderTopWidth: 1, marginTop: 14, paddingTop: 12 },
  todayHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  todayKicker: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  todayCount: { color: "rgba(255,255,255,0.7)", fontSize: 10.5, fontWeight: "800" },
  todayTasks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  todayTask: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 6, color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  todayTaskDone: { backgroundColor: "rgba(46,155,88,0.25)", color: "#7DD99E" },

  sectionTitle: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginTop: 18 },
  sectionTitleText: { color: color.ink, fontSize: 14, fontWeight: "900" },
  sectionTitleCount: { color: color.muted, fontSize: 11, fontWeight: "700" },
  sectionTitleHint: { color: color.muted, fontSize: 10.5, fontWeight: "700" },

  benefitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  benefitItem: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, gap: 6, padding: 12, position: "relative", width: "48.5%" },
  benefitItemLocked: { opacity: 0.55 },
  benefitIcon: { alignItems: "center", backgroundColor: "#FFF3D2", borderRadius: 10, height: 30, justifyContent: "center", width: 30 },
  benefitIconLocked: { backgroundColor: color.surface },
  benefitName: { color: color.ink, fontSize: 12, fontWeight: "900" },
  benefitDesc: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 14 },
  benefitLock: { backgroundColor: color.surface, borderRadius: 4, color: color.muted, fontSize: 9, fontWeight: "900", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 2, position: "absolute", right: 8, top: 8 },

  campaignEntry: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, padding: 13 },
  campaignEntryText: { color: color.ink, flex: 1, fontSize: 12.5, fontWeight: "900" },
  campaignEntryChevron: { color: color.muted, fontSize: 16, fontWeight: "700" },

  tabRow: { backgroundColor: color.surface, borderRadius: 12, flexDirection: "row", gap: 6, padding: 4 },
  tab: { alignItems: "center", borderRadius: 9, flex: 1, paddingVertical: 9 },
  tabOn: { backgroundColor: color.white },
  tabText: { color: color.muted, fontSize: 12, fontWeight: "900" },
  tabTextOn: { color: color.ink },

  benefitRow: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 8, padding: 13 },
  benefitRowIcon: { alignItems: "center", backgroundColor: "#F1ECFA", borderRadius: 10, height: 34, justifyContent: "center", width: 34 },
  benefitRowBody: { flex: 1 },
  benefitRowName: { color: color.ink, fontSize: 12.5, fontWeight: "900" },
  benefitRowDesc: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  benefitRowValue: { backgroundColor: "#E8F4EA", borderRadius: 999, color: "#1E6E3E", fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 4 },

  taskGroup: { marginTop: 10 },
  taskGroupHead: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 6 },
  taskGroupLabel: { color: color.muted, fontSize: 10.5, fontWeight: "900", letterSpacing: 0.5 },
  taskGroupDesc: { color: "#BCB6A8", fontSize: 11, fontWeight: "700" },
  taskList: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  taskItem: { alignItems: "center", borderBottomColor: "#F1EDE3", borderBottomWidth: 1, flexDirection: "row", gap: 10, padding: 12 },
  taskIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 10, height: 32, justifyContent: "center", width: 32 },
  taskIconDone: { backgroundColor: "#E8F4EA" },
  taskInfo: { flex: 1 },
  taskName: { color: color.ink, fontSize: 12.5, fontWeight: "900" },
  taskReward: { color: "#1E6E3E", fontSize: 10.5, fontWeight: "800", marginTop: 2 },
  taskRewardDim: { color: color.muted },
  taskProgress: { color: color.muted, fontSize: 9.5, fontWeight: "700", marginTop: 2 },
  taskDoneBadge: { color: "#1E6E3E", fontSize: 10.5, fontWeight: "900" },
  taskAction: { backgroundColor: color.ink, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  taskActionText: { color: color.white, fontSize: 11, fontWeight: "900" },

  eggSection: { backgroundColor: "#1E1B16", borderRadius: 20, gap: 8, padding: 16 },
  eggSub: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600", lineHeight: 15, marginBottom: 4 },
  eggItem: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, padding: 12 },
  eggItemUnlocked: { backgroundColor: "rgba(139,111,191,0.18)", borderColor: "rgba(139,111,191,0.4)" },
  eggIcon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  eggIconUnlocked: { backgroundColor: color.violet },
  eggIconText: { color: "rgba(255,255,255,0.5)", fontSize: 16, fontWeight: "900" },
  eggBody: { flex: 1 },
  eggName: { color: color.white, fontSize: 12.5, fontWeight: "900" },
  eggNameBlur: { color: "rgba(255,255,255,0.35)", letterSpacing: 2 },
  eggDesc: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "600", marginTop: 3 },

  tierCompareRail: { gap: 10, paddingRight: 4 },
  tierCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1.5, padding: 13, width: 140 },
  tierCardOn: { backgroundColor: "#FDF6E3", borderColor: "#D4AF37" },
  tierCardBadge: { backgroundColor: color.surface, borderRadius: 4, color: color.muted, fontSize: 9, fontWeight: "900", marginBottom: 8, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  tierCardName: { color: color.ink, fontSize: 14, fontWeight: "900", marginBottom: 4 },
  tierCardDesc: { color: color.muted, fontSize: 11, fontWeight: "600", marginBottom: 6 },
  tierCardPerks: { color: color.muted, fontSize: 11, fontWeight: "700", lineHeight: 13 },
  tierCardPoints: { color: "#8C6A00", fontSize: 11, fontWeight: "900", marginTop: 4 },

  bottomNote: { color: color.muted, fontSize: 11, fontWeight: "700", lineHeight: 15, paddingVertical: 14, textAlign: "center" },

  infoNote: { backgroundColor: "#F4EEF7", borderRadius: 14, marginTop: 9, padding: 11 },
  infoNoteText: { color: color.ink, fontSize: 12, fontWeight: "700" },
  retryButton: { alignSelf: "flex-start", marginTop: 8 },
  retryButtonText: { color: color.violet, fontSize: 12, fontWeight: "900" },
});

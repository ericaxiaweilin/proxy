// RequesterHome（稳定 Surface，R15.12.7 rhome）：
// r157HomeTop + r1572HomeComposer('USER') + 继续/2项 + r157Action 周六新店开业 + r157Action 周末摄影散步
// + r157MarketPulse + bottom。无 hero / attention / teaser / rail / quick / reusable。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html（rhome，HTML 5197-5203）。
// Experience Runtime 插槽：top_context banner 由 SurfacePlan 驱动（§10 Slots），本地态不被 Delta 覆盖（§15.1）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HomeChatBox, type HomeAttachment, type HomeIntentMode } from "../components/home-chat-box";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { type MarketTab } from "../market-fixtures";
import { color, shadows } from "../theme";
import type { HardDemandCategory } from "../uiplan/types";
import type { DemandClient, RequesterHomeDraftItem, RequesterHomeTaskItem } from "../demand-client";
import type { MarketplaceClient } from "../marketplace-client";
import type { ActivityClient } from "../activity-client";
import { SCENE_TOOLS, type SceneToolId } from "@proxy/contracts";

export interface RequesterGoal {
  category: HardDemandCategory;
  goal: string;
}

// Server-backed read-model items get projected to this card-shape
// so the existing card UI stays untouched. kind=DRAFT shows a
// progress tag; kind=TASK shows no tag (the matching is in flight).
type ContinueCard = {
  key: string;
  icon: ProxyIconName;
  title: string;
  sub: string;
  progress?: string;
  headcount?: string;
};

function projectDraft(d: RequesterHomeDraftItem): ContinueCard {
  return {
    key: `draft:${d.id}`,
    icon: "diamond",
    title: d.sourceInput,
    sub: `草稿 · 已填 ${d.draftProgress}%`,
    progress: `${d.draftProgress}%`
  };
}

function projectTask(t: RequesterHomeTaskItem): ContinueCard {
  return {
    key: `task:${t.id}`,
    icon: "circle",
    title: t.sourceInput,
    sub: `已发布 · 等待匹配`
  };
}

// Empty-state fallback used when the user is not signed in yet
// (demandClient not provided) or the read model returned no rows.
// Preserves the original two placeholder cards so the visual baseline
// doesn't shift when the user is anonymous.
const PLACEHOLDER_ITEMS: ReadonlyArray<ContinueCard> = [
  { key: "ph:new", icon: "diamond", title: "周六新店开业", sub: "正在匹配 · 还差 1 位", progress: "80%" },
  { key: "ph:walk", icon: "circle", title: "周末摄影散步", sub: "你已感兴趣 · 周六 15:30", headcount: "8/12" }
];

export function RequesterHome({
  onEnterWorkspace,
  onOpenMarket,
  onOpenFeed,
  onChat,
  conversationPanel,
  topContext,
  demandClient,
  marketplace,
  activities,
  onCreateScene,
  onChromeVisibilityChange,
  bottomNavVisible,
}: {
  onEnterWorkspace: (selection: RequesterGoal) => void;
  onOpenMarket?: ((tab: MarketTab) => void) | undefined;
  onOpenFeed?: (() => void) | undefined;
  onChat?: ((text: string, mode?: HomeIntentMode, attachment?: HomeAttachment) => void) | undefined;
  conversationPanel?: ReactNode;
  topContext?: ReactNode;
  demandClient?: DemandClient;
  // R15.22 fix: 机会/活动计数从 API 拉, 替换 r157MarketPulse 硬编码 24/46/18.
  // server 端 ListMarketOpportunities / ListActivities 不限 actor, 匿名可读.
  marketplace?: MarketplaceClient;
  activities?: ActivityClient;
  onCreateScene?: ((tool: SceneToolId) => void) | undefined;
  onChromeVisibilityChange?: (visible: boolean) => void;
  bottomNavVisible?: boolean;
}): React.JSX.Element {
  const [intentMode, setIntentMode] = useState<HomeIntentMode | undefined>("SERVICE");
  const [continueItems, setContinueItems] = useState<ReadonlyArray<ContinueCard>>(PLACEHOLDER_ITEMS);
  // R15.22 fix: 市场脉动计数状态.
  //   - opportunityCount: server 端 ListMarketOpportunities 返的 list 长度
  //   - activityCount:    server 端 ListActivities 返的 list 长度
  //   - experienceCount:  暂无法从 server 拿 (ListExperiences 未联), 保留
  //     r157 基线 24 作为 fallback, 避免 UI 突变 — 拉倒后 可查后补 API.
  //   - pulseState: "idle" | "loading" | "loaded" | "error"
  //     初始 state="loading", 拉成功→loaded, 失败→error 但继续展示
  //     最后已知计数 (或 fallback) — 与 homeItemsState 互不干扰.
  const [opportunityCount, setOpportunityCount] = useState<number | null>(null);
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const [pulseState, setPulseState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  // HomeItemsLoadState distinguishes the three post-auth states:
  //   "idle"    — no fetch attempted yet (initial render)
  //   "loading" — fetch in flight (placeholder still visible)
  //   "loaded"  — fetch succeeded (real items, possibly empty)
  //   "error"   — fetch failed (placeholder visible + error chip)
  // Without this, a transient network blip is indistinguishable
  // from "user has no in-progress needs" or "user is anonymous".
  const [homeItemsState, setHomeItemsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");

  useEffect(() => {
    if (!demandClient) {
      // Anonymous: keep placeholder so the layout is non-empty.
      setContinueItems(PLACEHOLDER_ITEMS);
      setHomeItemsState("idle");
      return;
    }
    let cancelled = false;
    setHomeItemsState("loading");
    (async () => {
      // R15.22 fix: 匿名 session 没 principal, listHomeItems 调
      // requireSession() 立即抛 DemandProtocolError — 不应误报 "加载失败"
      // 仍保持 placeholder + idle 状态, 由顶 chip 提示登入。
      // hasAuthenticatedSession 内部已包 try/catch, 但这里仍 wrap 一层以防意外.
      let hasSession = false;
      try {
        hasSession = await demandClient.hasAuthenticatedSession();
      } catch {
        hasSession = false;
      }
      if (!hasSession) {
        if (cancelled) return;
        setContinueItems(PLACEHOLDER_ITEMS);
        setHomeItemsState("idle");
        return;
      }
      try {
        const home = await demandClient.listHomeItems(10);
        if (cancelled) return;
        const cards: ContinueCard[] = [];
        for (const d of home.drafts) cards.push(projectDraft(d));
        for (const t of home.tasks) cards.push(projectTask(t));
        setContinueItems(cards);
        setHomeItemsState("loaded");
      } catch {
        // Fail closed: keep the placeholder strip so a transient
        // network blip doesn't wipe the surface, but flag the
        // state so the section header can show an error chip.
        if (!cancelled) {
          setContinueItems(PLACEHOLDER_ITEMS);
          setHomeItemsState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demandClient]);

  // R15.22 fix: 市场脉动计数 (机会/活动) 从 server 拉 — 替代 r157MarketPulse
  // 硬编码 24/46/18. 体验 暂保留 fallback 24 (ListExperiences 未联, 调后补).
  // marketplace / activities 跟 demandClient 同样为 undefined 表示匿名
  // (R15.22 WIP 期间, 上层可能未传), 跟 homeItemsState 一样保持
  // placeholder, 不报 "加载失败".
  useEffect(() => {
    if (!marketplace && !activities) {
      setPulseState("idle");
      return;
    }
    let cancelled = false;
    setPulseState("loading");
    (async () => {
      // 并行拉取, 各自包 try/catch — 某个失败不影响另一个.
      const next: { opportunityCount: number | null; activityCount: number | null; anyError: boolean } = {
        opportunityCount: null,
        activityCount: null,
        anyError: false
      };
      if (marketplace) {
        try {
          const opportunities = await marketplace.list();
          if (cancelled) return;
          next.opportunityCount = opportunities.length;
        } catch {
          next.anyError = true;
        }
      }
      if (activities) {
        try {
          const list = await activities.listActivities();
          if (cancelled) return;
          next.activityCount = list.length;
        } catch {
          next.anyError = true;
        }
      }
      if (cancelled) return;
      if (next.opportunityCount !== null) setOpportunityCount(next.opportunityCount);
      if (next.activityCount !== null) setActivityCount(next.activityCount);
      setPulseState(next.anyError ? "error" : "loaded");
    })();
    return () => {
      cancelled = true;
    };
  }, [marketplace, activities]);
  const lastYRef = useRef(0);
  const dirRef = useRef(0);
  const visibleRef = useRef(true);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastYRef.current;
    if (y <= 48) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
    else if (Math.abs(delta) >= 1) {
      const prevDir = Math.sign(dirRef.current);
      const nextDir = Math.sign(delta);
      dirRef.current = prevDir !== 0 && prevDir !== nextDir ? delta : dirRef.current + delta;
      if (dirRef.current <= -18) { if (!visibleRef.current) { visibleRef.current = true; onChromeVisibilityChange?.(true); } dirRef.current = 0; }
      else if (dirRef.current >= 28) { if (visibleRef.current) { visibleRef.current = false; onChromeVisibilityChange?.(false); } dirRef.current = 0; }
    }
    lastYRef.current = y;
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingBottom: bottomNavVisible === false ? 16 : 120 }]} onScroll={onScroll} scrollEventThrottle={16}>
      {topContext ?? null}
      {/* R15.13 P5：本地范围（河内 · 还剑湖附近 等）现在统一由 app-shell
          顶部 chrome (LocationContext) 单独呈现，且“切换⌄”真的能点。重复
          一份 location 文本会造成“地址切换不了”错觉且两份会不同步。
          Home Top 收紧为只负责问候。 */}
      <View style={styles.homeTop}>
        <View style={styles.homeTopCopy}>
          <Text style={styles.homeTopTitle}>今天想做什么？</Text>
        </View>
      </View>

      {/* R15.13：Scene Tool Entry — 首页意图 6 宫格 */}
      <View style={styles.sceneTools}>
        {SCENE_TOOLS.map((tool: { id: SceneToolId; label: string; intentPrompt: string }) => (
          <Pressable key={tool.id} onPress={() => onCreateScene?.(tool.id)} style={styles.sceneTool}>
            <Text style={styles.sceneToolLabel}>{tool.label}</Text>
            <Text style={styles.sceneToolPrompt}>{tool.intentPrompt}</Text>
          </Pressable>
        ))}
      </View>

      {/* 基线 .r1572HomeComposer('USER')：HomeChatBox（无示例 / 无提示） */}
      {conversationPanel ?? (onChat ? (
        <HomeChatBox
          contextLabel="用户"
          placeholder="例如：周六下午想在西湖拍照"
          mode={intentMode}
          onSelectMode={(mode) => {
            setIntentMode((current) => current === mode ? undefined : mode);
          }}
          onSend={(text, mode, attachment) => onChat(text, mode, attachment)}
        />
      ) : null)}

      {/* 基线 继续 / 2 项 → 服务端 ListRequesterHomeItems */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>继续</Text>
        <Text style={styles.sectionHint}>
          {continueItems.length} 项
          {homeItemsState === "loaded"
            ? ""
            : homeItemsState === "error"
            ? " · 加载失败"
            : homeItemsState === "loading"
            ? " · 加载中"
            : " · 占位"}
        </Text>
      </View>
      {continueItems.length === 0 ? (
        <View style={styles.actionCard}>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>没有进行中的需求</Text>
            <Text style={styles.actionSub}>在上方输入开始一个新草稿。</Text>
          </View>
        </View>
      ) : (
        continueItems.map((item) => (
          <Pressable key={item.key} onPress={() => onOpenMarket?.("OPPORTUNITY")} style={styles.actionCard}>
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
        ))
      )}

      {/* R15.22 fix: 市场脉动计数 (机会 / 活动) 从 server 拉, 体验 仍使用 r157
          基线 24 作 fallback (ListExperiences 暂未联). 拉倒后空闲, onPress
          仍走 "OPPORTUNITY" — R15.22 WIP 期间保持 visual baseline, 待
          owner 补 ListExperiences 后再加 experience tab. */}
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
                [opportunityCount !== null ? String(opportunityCount) : "—", "机会"],
                [activityCount !== null ? String(activityCount) : "—", "活动"]
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
  // R15.13 P5：homeTopLoc 样式保留但未使用 — LocationContext 是 single
  // source of truth。见上文 comment。
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
  marketPulseNumLabel: { color: "#D4CAD9", fontSize: 11, lineHeight: 15, textAlign: "center" },

  sceneTools: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginBottom: 6 },
  sceneTool: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, minWidth: 92, alignItems: "center", ...shadows.card },
  sceneToolLabel: { color: color.ink, fontSize: 14, fontWeight: "800" },
  sceneToolPrompt: { color: color.muted, fontSize: 11, marginTop: 2 },
});

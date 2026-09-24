// R15 Component Registry 的实现侧（Registry R1 Required Component Contract）。
// 基于 json-render createRenderer：组件纯展示（props 进、action emit 出），
// 任何组件都不直接修改 Domain Truth——material action 必须走后端命令。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html（.card / .qcard / .candidate / .factrow）。
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { createRenderer, useStateStore } from "@json-render/react-native";
import { color, Gradient, shadows } from "../theme";
import { proxyCatalog, type Candidate } from "../uiplan/catalog";

export type PanelActionName = "answer_critical_question" | "select_candidate";
export interface PanelActionEvent {
  action: PanelActionName;
  params?: Record<string, unknown>;
}

function PanelCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.card}>{children}</View>;
}

function SectionLabel({ text }: { text: string }): React.JSX.Element {
  return <Text selectable style={styles.sectionLabel}>{text}</Text>;
}

// ---- Request / Goal ----

function CategoryAnchor({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as { category: string; label: string; tags: string[] };
  return (
    <PanelCard>
      <SectionLabel text="需求大类锚点" />
      <Text selectable style={styles.cardTitle}>{props.label}</Text>
      <Text selectable style={styles.mono}>{props.category}</Text>
      <View style={styles.chipRow}>
        {props.tags.map((tag) => (
          <View key={tag} style={styles.chip}>
            <Text selectable style={styles.chipText}>{tag}</Text>
          </View>
        ))}
      </View>
    </PanelCard>
  );
}

function GoalSummary({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as { title: string; summary: string; category: string; archetype: string | null };
  return (
    <PanelCard>
      <SectionLabel text="目标摘要" />
      <Text selectable style={styles.cardTitle}>{props.title}</Text>
      <Text selectable style={styles.body}>{props.summary}</Text>
      <View style={styles.chipRow}>
        <View style={styles.chipDark}>
          <Text selectable style={styles.chipDarkText}>{props.archetype ?? props.category}</Text>
        </View>
      </View>
    </PanelCard>
  );
}

function CriticalQuestion({ element, emit }: { element: { props: Record<string, unknown> }; emit: (event: string) => void }): React.JSX.Element {
  const props = element.props as { questionId: string; question: string; options: string[] };
  const [selected, setSelected] = useState<string>();
  const [answered, setAnswered] = useState(false);
  const { update } = useStateStore();
  return (
    <PanelCard>
      <SectionLabel text="关键问题" />
      <Text selectable style={styles.cardTitle}>{props.question}</Text>
      <View style={styles.optionColumn}>
        {props.options.map((option) => (
          <Pressable
            key={option}
            onPress={() => {
              setSelected(option);
              update({ "/critical_answer": option });
            }}
            style={[styles.option, selected === option && styles.optionSelected]}
          >
            <Text selectable style={[styles.optionText, selected === option && styles.optionTextSelected]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        disabled={selected === undefined || answered}
        onPress={() => {
          setAnswered(true);
          emit("press");
        }}
        style={[styles.confirmButton, (selected === undefined || answered) && styles.disabled]}
      >
        <Text selectable style={styles.confirmButtonText}>{answered ? "✓ 已记录回答" : "确认回答"}</Text>
      </Pressable>
    </PanelCard>
  );
}

function KnownFacts({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as { facts: string[] };
  return (
    <PanelCard>
      <SectionLabel text="已知事实" />
      <View style={styles.factList}>
        {props.facts.map((fact) => (
          <View key={fact} style={styles.factRow}>
            <Text selectable style={styles.factRowText}>{fact}</Text>
            <View style={styles.factStateConfirmed}>
              <Text selectable style={styles.factStateConfirmedText}>已确认</Text>
            </View>
          </View>
        ))}
      </View>
    </PanelCard>
  );
}

function InferredFacts({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as { facts: Array<{ fact: string; basis: string }> };
  return (
    <PanelCard>
      <SectionLabel text="推断事实（可复核）" />
      <View style={styles.factList}>
        {props.facts.map((item) => (
          <View key={item.fact} style={styles.factRow}>
            <View style={styles.factRowCopy}>
              <Text selectable style={styles.factRowText}>{item.fact}</Text>
              <Text selectable style={styles.factBasis}>依据：{item.basis}</Text>
            </View>
            <View style={styles.factStateInferred}>
              <Text selectable style={styles.factStateInferredText}>推断</Text>
            </View>
          </View>
        ))}
      </View>
    </PanelCard>
  );
}

// ---- Time / Place ----

function TimeLocation({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as { startAt: string; durationH: number; location: string; meetingPoint: string | null };
  return (
    <PanelCard>
      <SectionLabel text="时间 · 地点" />
      <View style={styles.kvRow}>
        <Text selectable style={styles.kvLabel}>时间</Text>
        <Text selectable style={styles.kvValue}>
          {props.startAt} · {props.durationH}H
        </Text>
      </View>
      <View style={styles.kvRow}>
        <Text selectable style={styles.kvLabel}>地点</Text>
        <Text selectable style={styles.kvValue}>{props.location}</Text>
      </View>
      {props.meetingPoint ? (
        <View style={styles.kvRow}>
          <Text selectable style={styles.kvLabel}>集合点</Text>
          <Text selectable style={styles.kvValue}>{props.meetingPoint}</Text>
        </View>
      ) : null}
    </PanelCard>
  );
}

// ---- Human Supply ----

function CandidateRail({ element, emit }: { element: { props: Record<string, unknown> }; emit: (event: string) => void }): React.JSX.Element {
  const props = element.props as { candidates: Candidate[]; status?: "loading" | "ready" | "empty" | "error" | "unavailable" };
  const [selectedId, setSelectedId] = useState<string>();
  // MATCH-LIVE-001：候选来自后端真实供给（按履约 / 需求方评价 / 经验 / 响应 / 预算排序）；没有就如实说为什么。
  const status = props.status ?? (props.candidates.length > 0 ? "ready" : "empty");
  if (status !== "ready" || props.candidates.length === 0) {
    const message =
      status === "loading" ? "正在按履约和评价为你挑选候选…" :
      status === "error" ? "候选没有取到，稍后再试" :
      status === "unavailable" ? "登录后才能看到真实候选" :
      "暂时没有符合本单的人（语言 / 时段 / 实名核验都要满足），可以换个时间或放宽要求";
    return (
      <PanelCard>
        <SectionLabel text="本次候选" />
        <Text selectable style={styles.candidateOfferNote}>{message}</Text>
      </PanelCard>
    );
  }
  return (
    <PanelCard>
      <SectionLabel text="本次候选 · 已通过本单筛选 · 按履约和评价排序" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {props.candidates.map((candidate) => {
          const selected = selectedId === candidate.agentId;
          return (
            <Pressable
              key={candidate.agentId}
              onPress={() => {
                setSelectedId(candidate.agentId);
                emit("press");
              }}
              style={[styles.candidateCard, selected && styles.candidateCardSelected]}
            >
              <View style={styles.candTop}>
                <Gradient from={color.magenta} to={color.violet} style={styles.avatar}>
                  <Text selectable style={styles.avatarText}>{candidate.name.charAt(0)}</Text>
                </Gradient>
                <View style={styles.candCopy}>
                  <Text selectable style={styles.candidateName}>{candidate.name}</Text>
                  <Text selectable numberOfLines={1} style={styles.candidateTagline}>
                    {candidate.languages.join(" / ")}
                  </Text>
                </View>
                {selected ? (
                  <View style={styles.selectedTag}>
                    <Text selectable style={styles.selectedTagText}>✓ 已选</Text>
                  </View>
                ) : null}
              </View>
              <Text selectable style={styles.candidateOffer}>
                ₫{candidate.offerVnd.toLocaleString()}
                <Text selectable style={styles.candidateOfferNote}> · 本次需求报价</Text>
              </Text>
              {candidate.hasTrackRecord === false ? (
                // 新人：没有完成过订单，不画 0%（那会被读成「履约很差」）。
                <View style={styles.metricRow}>
                  <View style={styles.metricBox}>
                    <Text selectable style={styles.metricValue}>新人</Text>
                    <Text selectable style={styles.metricLabel}>暂无履约记录</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.metricRow}>
                  <View style={styles.metricBox}>
                    <Text selectable style={styles.metricValue}>{Math.round(candidate.fulfillmentRate * 100)}%</Text>
                    <Text selectable style={styles.metricLabel}>履约率</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text selectable style={styles.metricValue}>{candidate.satisfactionRate > 0 ? `${Math.round(candidate.satisfactionRate * 100)}%` : "—"}</Text>
                    <Text selectable style={styles.metricLabel}>满意率</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text selectable style={styles.metricValue}>{candidate.completedOrders} 单</Text>
                    <Text selectable style={styles.metricLabel}>已完成</Text>
                  </View>
                </View>
              )}
              <View style={styles.chipRow}>
                {candidate.proofs.map((proof) => (
                  <View key={proof} style={styles.chip}>
                    <Text selectable style={styles.chipText}>✓ {proof}</Text>
                  </View>
                ))}
              </View>
              {selected ? <Text selectable style={styles.selectedMark}>确认成交将走后端命令</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </PanelCard>
  );
}

// ---- Commerce / Price ----

function ContextualQuote({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as {
    servicePriceVnd: number;
    currency: string;
    note: string;
    breakdown: Array<{ item: string; amountVnd: number }>;
  };
  // MATCH-LIVE-001：还没有候选时没有「本单价格」可言 —— 不显示假价格。
  if (props.servicePriceVnd <= 0) {
    return (
      <PanelCard>
        <SectionLabel text="本单报价" />
        <Text selectable style={styles.quoteNote}>{props.note || "选定人选后显示本单报价"}</Text>
      </PanelCard>
    );
  }
  return (
    <PanelCard>
      <SectionLabel text="本单报价" />
      <Text selectable style={styles.quotePrice}>
        ₫{props.servicePriceVnd.toLocaleString()} <Text selectable style={styles.quoteCurrency}>{props.currency}</Text>
      </Text>
      {props.breakdown.map((item) => (
        <View key={item.item} style={styles.kvRow}>
          <Text selectable style={styles.kvLabel}>{item.item}</Text>
          <Text selectable style={styles.kvValue}>₫{item.amountVnd.toLocaleString()}</Text>
        </View>
      ))}
      <Text selectable style={styles.quoteNote}>{props.note}</Text>
    </PanelCard>
  );
}

// ---- Conversation / Confirmation ----

function WaitingStatus({ element }: { element: { props: Record<string, unknown> } }): React.JSX.Element {
  const props = element.props as { status: string; message: string };
  return (
    <View style={styles.waiting}>
      <Text selectable style={styles.waitingStatus}>{props.status}</Text>
      <Text selectable style={styles.waitingMessage}>{props.message}</Text>
    </View>
  );
}

// ---- Renderer ----

// createRenderer：catalog 约束 + 组件映射 → <UIPlanRenderer spec onAction />。
// onAction 冒泡到 Surface 层（Product State），组件自身不持有业务状态。
export const UIPlanRenderer = createRenderer(proxyCatalog, {
  CATEGORY_ANCHOR: CategoryAnchor,
  GOAL_SUMMARY: GoalSummary,
  CRITICAL_QUESTION: CriticalQuestion,
  KNOWN_FACTS: KnownFacts,
  INFERRED_FACTS: InferredFacts,
  TIME_LOCATION: TimeLocation,
  CANDIDATE_RAIL: CandidateRail,
  CONTEXTUAL_QUOTE: ContextualQuote,
  WAITING_STATUS: WaitingStatus
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 0,
    padding: 12,
    ...shadows.card
  },
  sectionLabel: { color: color.ink, fontSize: 11, fontWeight: "800", marginBottom: 8 },
  cardTitle: { color: color.ink, fontSize: 14, fontWeight: "800", marginBottom: 6, lineHeight: 20 },
  body: { color: color.muted, fontSize: 11, lineHeight: 16 },
  mono: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  chip: { backgroundColor: color.chipNeutralBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { color: color.chipNeutralText, fontSize: 11, fontWeight: "700" },
  chipDark: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipDarkText: { color: color.white, fontSize: 11, fontWeight: "700" },
  optionColumn: { gap: 7, marginTop: 4 },
  option: { backgroundColor: color.surface, borderRadius: 10, borderWidth: 1.5, borderColor: "transparent", paddingHorizontal: 10, paddingVertical: 9 },
  optionSelected: { backgroundColor: color.answerSelectedBg, borderColor: color.violet },
  optionText: { color: color.ink, fontSize: 11 },
  optionTextSelected: { fontWeight: "800" },
  confirmButton: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, marginTop: 12, paddingVertical: 11 },
  confirmButtonText: { color: color.white, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  factList: { gap: 6 },
  factRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  factRowCopy: { flex: 1 },
  factRowText: { color: color.ink, flex: 1, fontSize: 11, lineHeight: 15 },
  factStateConfirmed: { backgroundColor: color.factConfirmedBg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  factStateConfirmedText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "900" },
  factStateInferred: { backgroundColor: color.factInferredBg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  factStateInferredText: { color: color.factInferredFg, fontSize: 11, fontWeight: "900" },
  factBasis: { color: color.muted, fontSize: 11, marginTop: 2 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  kvLabel: { color: color.muted, fontSize: 11 },
  kvValue: { color: color.ink, fontSize: 11, fontWeight: "700" },
  rail: { gap: 10, paddingRight: 8 },
  candidateCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 15,
    borderWidth: 1,
    marginRight: 0,
    padding: 9,
    width: 252,
    ...shadows.card
  },
  candidateCardSelected: { borderColor: color.ink, borderWidth: 2 },
  candTop: { alignItems: "center", flexDirection: "row", gap: 9 },
  avatar: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    overflow: "hidden",
    width: 40
  },
  avatarText: { color: color.white, fontSize: 15, fontWeight: "900" },
  candCopy: { flex: 1 },
  selectedTag: { backgroundColor: color.factConfirmedBg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  selectedTagText: { color: color.factConfirmedFg, fontSize: 11, fontWeight: "900" },
  candidateName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  candidateTagline: { color: color.muted, fontSize: 11, marginTop: 1 },
  candidateOffer: { color: color.magenta, fontSize: 15, fontWeight: "900", marginTop: 8 },
  candidateOfferNote: { color: color.muted, fontSize: 11, fontWeight: "600" },
  metricRow: { flexDirection: "row", gap: 5, marginTop: 8 },
  metricBox: { backgroundColor: color.surface, borderRadius: 9, flex: 1, paddingHorizontal: 6, paddingVertical: 7 },
  metricValue: { color: color.ink, fontSize: 11, fontWeight: "800" },
  metricLabel: { color: color.muted, fontSize: 11, marginTop: 1 },
  selectedMark: { color: color.violet, fontSize: 11, fontWeight: "800", marginTop: 7 },
  quotePrice: { color: color.ink, fontSize: 24, fontWeight: "900" },
  quoteCurrency: { color: color.muted, fontSize: 11, fontWeight: "600" },
  quoteNote: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
  waiting: {
    backgroundColor: color.stateWarnBg,
    borderColor: color.stateWarnBorder,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14
  },
  waitingStatus: { color: "color.factUnknownFg", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  waitingMessage: { color: color.ink, fontSize: 13, marginTop: 4 }
});

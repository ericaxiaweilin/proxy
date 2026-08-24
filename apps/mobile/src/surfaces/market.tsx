// Market Surface — R4 (2026-08-24): 机会 / 活动 双 Tab。
// R4 决策：移除“体验上架”以保护小美身价；机会由客户单向发布，小美报名/报价。
// 视觉：沿用项目 R3 token（magenta/violet/ink/muted/line/surface），仅复用 R4 的卡片结构与价格可见性，
// 不引入原型暖黄 #F3A61D 作为主色，保持 Proxy 紫粉基线。
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Activity } from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import {
  MAP_DISTRICTS,
  MARKET_EXPERIENCES,
  MARKET_OPPORTUNITIES,
  OPPORTUNITY_LENS_LABEL,
  OPPORTUNITY_MAP_COORDS,
  marketExperience,
  type MarketOpportunity,
  type MarketTab,
  type OpportunityLens
} from "../market-fixtures";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { color, shadows } from "../theme";
import { ActivityDetail, ActivityFeedCard } from "./tasks";

export type MarketViewMode = "LIST" | "MAP";

type ActivityFilter = "RECOMMENDED" | "CAFE" | "RESTAURANT" | "MINE";
type OpportunityFilter = "MATCH" | "FAIR" | "COUNTER" | "NEARBY" | "TODAY" | "INVITED";

const ACTIVITY_FILTERS: ReadonlyArray<{ id: ActivityFilter; label: string }> = [
  { id: "RECOMMENDED", label: "趋势" },
  { id: "CAFE", label: "附近" },
  { id: "RESTAURANT", label: "本周" },
  { id: "MINE", label: "我的活动" }
];

const OPP_FILTERS: ReadonlyArray<{ id: OpportunityFilter; label: string }> = [
  { id: "MATCH", label: "适合你" },
  { id: "FAIR", label: "价格合理" },
  { id: "COUNTER", label: "可反报价" },
  { id: "NEARBY", label: "附近" },
  { id: "TODAY", label: "今天" },
  { id: "INVITED", label: "邀请我的" }
];

type R7Filter = "RECOMMEND" | "VALUE" | "TIME" | "NEARBY" | "INVITE" | "FILTER";
const R7_FILTERS: ReadonlyArray<{ id: R7Filter; label: string; icon: ProxyIconName }> = [
  { id: "RECOMMEND", label: "推荐", icon: "star" },
  { id: "VALUE", label: "收益", icon: "coin" },
  { id: "TIME", label: "时间", icon: "clock" },
  { id: "NEARBY", label: "附近", icon: "route" },
  { id: "INVITE", label: "邀请", icon: "mail" },
  { id: "FILTER", label: "筛选", icon: "settings" }
];
const R7_FILTER_META: Record<R7Filter, { title: string; sub: string }> = {
  RECOMMEND: { title: "最适合你的机会", sub: "综合能力、价格、时间、区域与客户质量" },
  VALUE: { title: "更值得接的机会", sub: "不是价格最高，而是综合净收益与长期价值" },
  TIME: { title: "与你时间最合的机会", sub: "优先完整覆盖当前可用时间，不制造冲突" },
  NEARBY: { title: "通勤更轻的机会", sub: "优先现实可达、低通勤成本的需求" },
  INVITE: { title: "客户直接邀请你的机会", sub: "对方已经主动表达希望你参与" },
  FILTER: { title: "完整筛选", sub: "价格、时长、类型、付款、客户质量等高级条件" }
};

const OPPORTUNITY_COORDS: Array<[number, number]> = OPPORTUNITY_MAP_COORDS;

function normalizeTab(tab: MarketTab): "OPPORTUNITY" | "ACTIVITY" {
  if (tab === "ACTIVITY") return "ACTIVITY";
  return "OPPORTUNITY";
}

export function MarketSurface({
  activities,
  marketLabel,
  initialTab = "OPPORTUNITY",
  onOpenExperience,
  onOpenActivity
}: {
  activities: ActivityClient;
  marketLabel: string;
  initialTab?: MarketTab;
  onOpenExperience: (experienceId: string) => void;
  onOpenActivity: (activity: Activity) => void;
}): React.JSX.Element {
  const normalized = normalizeTab(initialTab);
  const [tab, setTab] = useState<"OPPORTUNITY" | "ACTIVITY">(normalized);
  const [view, setView] = useState<MarketViewMode>("LIST");
  const [lens, setLens] = useState<OpportunityLens>("NOW");
  const [oppFilter, setOppFilter] = useState<R7Filter>("RECOMMEND");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("RECOMMENDED");
  const [search, setSearch] = useState("");
  const [activityPhase, setActivityPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [activityItems, setActivityItems] = useState<Activity[]>([]);
  const [activityDetail, setActivityDetail] = useState<Activity | null>(null);
  const [interestedIn, setInterestedIn] = useState<ReadonlySet<string>>(new Set());
  const [joinedIds, setJoinedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [oppDetail, setOppDetail] = useState<MarketOpportunity | null>(null);
  const [oppQuoteMode, setOppQuoteMode] = useState<"budget" | "standard" | "premium" | "custom">("standard");
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectOpp, setSelectOpp] = useState<MarketOpportunity | null>(null);
  const [applicantName, setApplicantName] = useState<string | null>(null);
  const [submissionName, setSubmissionName] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const loadActivities = useCallback(async (): Promise<void> => {
    setActivityPhase("LOADING");
    try {
      const read = await activities.listActivities();
      setActivityItems(read);
      setActivityPhase("READY");
    } catch {
      setActivityPhase("ERROR");
    }
  }, [activities]);

  useEffect(() => {
    if (tab === "ACTIVITY") void loadActivities();
  }, [tab, loadActivities]);

  function upsertActivity(next: Activity): void {
    setActivityItems((current) => current.map((entry) => (entry.activityId === next.activityId ? next : entry)));
  }

  async function toggleInterest(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity, interested } = await activities.toggleInterest(activityId);
      upsertActivity(activity);
      const next = new Set(interestedIn);
      if (interested) next.add(activityId);
      else next.delete(activityId);
      setInterestedIn(next);
    } finally {
      setBusy(false);
    }
  }

  async function joinActivity(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity } = await activities.join(activityId);
      upsertActivity(activity);
      const next = new Set(joinedIds);
      next.add(activityId);
      setJoinedIds(next);
    } finally {
      setBusy(false);
    }
  }

  const visibleActivities = activityItems.filter((item) => {
    if (activityFilter === "CAFE") return item.venueType === "CAFE";
    if (activityFilter === "RESTAURANT") return item.venueType === "RESTAURANT";
    if (activityFilter === "MINE") return joinedIds.has(item.activityId) || interestedIn.has(item.activityId);
    return true;
  });

  const remoteLens = lens === "REMOTE";

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.marketHead}>
        <View>
          <Text style={styles.marketTitle}>市场</Text>
          <Text style={styles.marketSub}>{marketLabel} · 机会 · 活动</Text>
        </View>
        <View style={styles.headActions}>
          <Pressable onPress={() => setView(view === "MAP" ? "LIST" : "MAP")} style={[styles.viewToggle, view === "MAP" && styles.viewToggleOn]}>
            <ProxyIcon color={view === "MAP" ? color.white : color.ink} name={view === "MAP" ? "storeLines" : "route"} size={18} />
          </Pressable>
          <Pressable onPress={() => setPublishOpen(true)} style={styles.plusBtn}>
            <ProxyIcon color={color.white} name="plus" size={18} />
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["OPPORTUNITY", "机会"],
            ["ACTIVITY", "活动"]
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => {
              setTab(id);
              setActivityDetail(null);
              setOppDetail(null);
            }}
            style={[styles.tab, tab === id && styles.tabOn]}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {publishOpen ? (
        <PublishDemand onBack={() => setPublishOpen(false)} onPublished={() => setPublishOpen(false)} />
      ) : applicantName ? (
        <ApplicantDetail name={applicantName} onBack={() => setApplicantName(null)} onOpenSubmission={(n) => { setApplicantName(null); setSubmissionName(n); }} onCompare={() => { setApplicantName(null); setCompareOpen(true); }} />
      ) : submissionName ? (
        <SubmissionDetail name={submissionName} onBack={() => setSubmissionName(null)} onCompare={() => { setSubmissionName(null); setCompareOpen(true); }} onOpenApplicant={(n) => { setSubmissionName(null); setApplicantName(n); }} />
      ) : compareOpen ? (
        <CompareScene onBack={() => setCompareOpen(false)} onOpenApplicant={(n) => { setCompareOpen(false); setApplicantName(n); }} />
      ) : selectOpp ? (
        <SelectWorkbench opportunity={selectOpp} onBack={() => setSelectOpp(null)} onOpenApplicant={setApplicantName} onOpenSubmission={setSubmissionName} onCompare={() => setCompareOpen(true)} />
      ) : view === "MAP" ? (
        <MarketMap
          tab={tab === "OPPORTUNITY" ? "OPPORTUNITY" : "ACTIVITY"}
          lens={lens}
          remoteLens={remoteLens}
          marketLabel={marketLabel}
          onOpenExperience={onOpenExperience}
          onOpenOpportunity={(id) => {
            const found = MARKET_OPPORTUNITIES.find((x) => x.id === id);
            if (found) setOppDetail(found);
          }}
          onOpenActivity={(a) => setActivityDetail(a)}
        />
      ) : tab === "OPPORTUNITY" ? (
        oppDetail ? (
          <OpportunityDetail
            opportunity={oppDetail}
            quoteMode={oppQuoteMode}
            setQuoteMode={setOppQuoteMode}
            onBack={() => setOppDetail(null)}
            onOpenSelect={() => {
              const cur = oppDetail;
              setOppDetail(null);
              if (cur) setSelectOpp(cur);
            }}
          />
        ) : (
          <OpportunityTab lens={lens} setLens={setLens} oppFilter={oppFilter} setOppFilter={setOppFilter} marketLabel={marketLabel} onOpen={(o) => setOppDetail(o)} />
        )
      ) : (
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <TextInput onChangeText={setSearch} placeholder="搜活动、地点、主题…" placeholderTextColor="#A9A2B0" style={styles.searchInput} value={search} />
              <Text style={styles.searchIcon}>⌕</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.lensRow} style={styles.lensScroll}>
            {ACTIVITY_FILTERS.map((entry) => (
              <Pressable key={entry.id} onPress={() => setActivityFilter(entry.id)} style={[styles.lens, activityFilter === entry.id && styles.lensOn]}>
                <Text style={[styles.lensText, activityFilter === entry.id && styles.lensTextOn]}>{entry.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>趋势活动</Text>
            <Text style={styles.sectionHint}>多人 / 兴趣 / 品牌场景</Text>
          </View>
          {activityPhase === "LOADING" ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator color={color.magenta} />
              <Text style={styles.emptyText}>正在读取活动读模型（ListActivities）…</Text>
            </View>
          ) : activityPhase === "ERROR" ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>活动读模型暂时不可用（本地 API 未连接？）。</Text>
              <Pressable onPress={() => void loadActivities()} style={styles.retryBtn}>
                <Text style={styles.retryText}>重试</Text>
              </Pressable>
            </View>
          ) : visibleActivities.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{activityFilter === "MINE" ? "还没有参加或感兴趣的活动。" : "附近暂时没有符合的活动。"}</Text>
            </View>
          ) : activityDetail ? (
            <ActivityDetail
              item={activityDetail}
              interested={interestedIn.has(activityDetail.activityId)}
              joined={joinedIds.has(activityDetail.activityId)}
              busy={busy}
              onToggleInterested={() => void toggleInterest(activityDetail.activityId)}
              onJoin={() => void joinActivity(activityDetail.activityId)}
              onBack={() => setActivityDetail(null)}
            />
          ) : (
            visibleActivities.map((item) => (
              <View key={item.activityId}>
                <ActivityFeedCard item={item} onPress={() => setActivityDetail(item)} />
                <View style={styles.hostFlag}>
                  <Text style={styles.hostFlagText}>Host / Creator 可参与</Text>
                </View>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function OpportunityTab({
  lens,
  setLens,
  oppFilter,
  setOppFilter,
  marketLabel,
  onOpen
}: {
  lens: OpportunityLens;
  setLens: (lens: OpportunityLens) => void;
  oppFilter: R7Filter;
  setOppFilter: (f: R7Filter) => void;
  marketLabel: string;
  onOpen: (o: MarketOpportunity) => void;
}): React.JSX.Element {
  const base = MARKET_OPPORTUNITIES;
  let items = [...base];
  if (oppFilter === "NEARBY") items = items.filter((o) => o.travel != null).sort((a, b) => (a.travel ?? 999) - (b.travel ?? 999));
  if (oppFilter === "TIME") items = [...items].sort((a, b) => (a.travel ?? 999) - (b.travel ?? 999));
  if (oppFilter === "VALUE") items = [...items].sort((a, b) => parseInt(a.price.replace(/\D/g, "")) - parseInt(b.price.replace(/\D/g, "")));
  if (oppFilter === "RECOMMEND") items = [...items].sort((a, b) => (a.travel ?? 999) - (b.travel ?? 999));
  if (oppFilter === "INVITE") items = items.slice(0, 1);
  return (
    <>
      <View style={styles.contextBar}>
        <View style={styles.contextCopy}>
          <Text style={styles.contextTitle}>小美 · 机会模式</Text>
          <Text style={styles.contextSub}>公开主页正常 · 机会单向提供 · 小美主动报名</Text>
        </View>
        <View style={styles.contextBadge}>
          <Text style={styles.contextBadgeText}>报名制</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput placeholder="搜机会、主题、地点…" placeholderTextColor="#A9A2B0" style={styles.searchInput} />
          <Text style={styles.searchIcon}>⌕</Text>
        </View>
      </View>

      <View style={styles.oppQuickNav}>
        {R7_FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => {
              if (f.id === "FILTER") {
                setOppFilter("FILTER");
                return;
              }
              setOppFilter(f.id);
            }}
            style={[styles.oppQuickBtn, oppFilter === f.id && styles.oppQuickBtnOn]}
          >
            <View style={styles.oppIcon}>
              <ProxyIcon color={oppFilter === f.id ? "#A86C00" : color.muted} name={f.icon} size={21} />
            </View>
            <Text style={[styles.oppQuickLabel, oppFilter === f.id && styles.oppQuickLabelOn]}>{f.label}</Text>
            {f.id === "INVITE" ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>1</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <View style={styles.oppQuickHint}>
        <View style={styles.oppQuickHintCopy}>
          <Text style={styles.oppQuickHintTitle}>{R7_FILTER_META[oppFilter].title}</Text>
          <Text style={styles.oppQuickHintSub}>{R7_FILTER_META[oppFilter].sub}</Text>
        </View>
        <View style={styles.oppQuickHintPill}>
          <Text style={styles.oppQuickHintPillText}>{oppFilter === "VALUE" ? "价值优先" : oppFilter === "INVITE" ? "1 个邀请" : oppFilter === "FILTER" ? "高级" : "实时"}</Text>
        </View>
      </View>

      <View style={styles.localScope}>
        <ProxyIcon color={color.violet} name="route" size={12} />
        <Text style={styles.localScopeText}>{lens === "REMOTE" ? "远程 · 不受通勤限制" : `${marketLabel} · 默认只展示可履约范围 · 价格先可见`}</Text>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>适合你的机会</Text>
        <Text style={styles.sectionHint}>先看价格，再决定是否回应</Text>
      </View>

      <View style={styles.oppStack}>
        {items.map((opportunity) => (
          <R4OpportunityCard key={opportunity.id} opportunity={opportunity} onOpen={() => onOpen(opportunity)} />
        ))}
      </View>
      <Text style={styles.detailHint}>发布需求在右上角 ＋；选人/对比在每个机会的报名明细里（仅发布者可见）。</Text>
    </>
  );
}

// R4 卡：价格三栏（客户预算 / Proxy 公平区间 / 你的类似记录）+ tags + 匹配度 + 双按钮
function R4OpportunityCard({ opportunity, onOpen }: { opportunity: MarketOpportunity; onOpen: () => void }): React.JSX.Element {
  const budget = opportunity.price;
  const fairLow = `${Math.round(parseInt(budget.replace(/\D/g, "")) * 0.95).toLocaleString()}₫`;
  const fairHigh = `${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.35).toLocaleString()}₫`;
  const fair = `${fairLow} – ${fairHigh}`;
  const mine = `约 ${budget}`;
  const reason = opportunity.skills ? `${opportunity.skills} · ${opportunity.match} 匹配` : `${opportunity.match} 匹配`;
  return (
    <View style={styles.r4Card}>
      <View style={styles.r4Top}>
        <Text style={styles.r4Title}>{opportunity.title}</Text>
        <Text style={styles.r4Budget}>{budget}</Text>
      </View>
      <Text style={styles.r4Meta}>{opportunity.date} {opportunity.time} · {opportunity.location} · {opportunity.owner} {opportunity.verified ? "✓已验证" : ""}</Text>
      <View style={styles.r4PriceStrip}>
        <View style={styles.r4PriceCell}>
          <Text style={styles.r4PriceLabel}>客户预算</Text>
          <Text style={styles.r4PriceValue}>{budget}</Text>
        </View>
        <View style={[styles.r4PriceCell, styles.r4PriceCellHot]}>
          <Text style={styles.r4PriceLabel}>Proxy 公平区间</Text>
          <Text style={styles.r4PriceValue}>{fair}</Text>
        </View>
        <View style={styles.r4PriceCell}>
          <Text style={styles.r4PriceLabel}>你的类似记录</Text>
          <Text style={styles.r4PriceValue}>{mine}</Text>
        </View>
      </View>
      <View style={styles.r4Tags}>
        {opportunity.skills.split("·").slice(0, 3).map((t) => (
          <View key={t} style={styles.r4Tag}>
            <Text style={styles.r4TagText}>{t.trim()}</Text>
          </View>
        ))}
        <View style={[styles.r4Tag, opportunity.signalClass === "hot" && styles.r4TagHot]}>
          <Text style={[styles.r4TagText, opportunity.signalClass === "hot" && styles.r4TagTextHot]}>{opportunity.signal}</Text>
        </View>
      </View>
      <View style={styles.r4Match}>
        <Text style={styles.r4MatchText}>{reason}</Text>
        <View style={styles.r4FitBadge}>
          <Text style={styles.r4FitText}>{opportunity.match} 匹配</Text>
        </View>
      </View>
      <View style={styles.r4Actions}>
        <Pressable style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>不感兴趣</Text>
        </Pressable>
        <Pressable onPress={onOpen} style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>查看 & 报价 ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function OpportunityDetail({
  opportunity,
  quoteMode,
  setQuoteMode,
  onBack,
  onOpenSelect
}: {
  opportunity: MarketOpportunity;
  quoteMode: "budget" | "standard" | "premium" | "custom";
  setQuoteMode: (m: "budget" | "standard" | "premium" | "custom") => void;
  onBack: () => void;
  onOpenSelect: () => void;
}): React.JSX.Element {
  const budget = opportunity.price;
  const fair = `${Math.round(parseInt(budget.replace(/\D/g, "")) * 0.95).toLocaleString()} – ${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.35).toLocaleString()}₫`;
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>机会详情</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>

      <View style={styles.detailHero}>
        <Text style={styles.detailHeroKicker}>OPPORTUNITY</Text>
        <Text style={styles.detailHeroTitle}>{opportunity.title}</Text>
        <Text style={styles.detailHeroSub}>先回答：值不值得接、条件是否公平、你能不能按自己的条件做。</Text>
      </View>

      <View style={styles.r4PriceStrip}>
        <View style={styles.r4PriceCell}>
          <Text style={styles.r4PriceLabel}>客户预算</Text>
          <Text style={styles.r4PriceValue}>{budget}</Text>
        </View>
        <View style={[styles.r4PriceCell, styles.r4PriceCellHot]}>
          <Text style={styles.r4PriceLabel}>Proxy 建议</Text>
          <Text style={styles.r4PriceValue}>{fair}</Text>
        </View>
        <View style={styles.r4PriceCell}>
          <Text style={styles.r4PriceLabel}>你的历史</Text>
          <Text style={styles.r4PriceValue}>约 {budget}</Text>
        </View>
      </View>

      <View style={styles.valueBox}>
        <View style={styles.valueHead}>
          <Text style={styles.valueTitle}>当前预算竞争力</Text>
          <Text style={styles.valueBadge}>中等</Text>
        </View>
        <View style={styles.valueBar}>
          <View style={[styles.valueFill, { width: "68%" }]} />
        </View>
        <Text style={styles.valueText}>客户预算处在 Proxy 公平区间内。可以直接按建议回应，不需要先接受低价。你的最低条件仅 Agent 可见，不对客户公开。</Text>
      </View>

      <View style={styles.factGrid}>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>时间</Text>
          <Text style={styles.factValue}>{opportunity.date} {opportunity.time}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>地点</Text>
          <Text style={styles.factValue}>{opportunity.location}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>发布方</Text>
          <Text style={styles.factValue}>{opportunity.owner} {opportunity.verified ? "✓" : ""}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factLabel}>当前回应</Text>
          <Text style={styles.factValue}>{opportunity.responses} 人</Text>
        </View>
      </View>

      <View style={styles.aiBox}>
        <View style={styles.aiHead}>
          <Text style={styles.aiTitle}>Proxy · 给小美的判断</Text>
          <Text style={styles.aiStrong}>值得考虑</Text>
        </View>
        <View style={styles.aiChecks}>
          <Text style={styles.aiCheck}>✓ {opportunity.match} 匹配；你的组合满足硬条件。</Text>
          <Text style={styles.aiCheck}>₫ 按类似履约，不建议低于预算 85% 接单。</Text>
          <Text style={styles.aiCheck}>↗ 通勤约 {opportunity.travel ?? 20} 分钟，平台托管付款。</Text>
        </View>
      </View>

      <View style={styles.quoteGrid}>
        {(
          [
            ["budget", budget, "客户预算 · 成交更快"],
            ["standard", fair.split("–")[0] ?? budget, "Proxy 建议 · 保持价值"],
            ["premium", `${Math.round(parseInt(budget.replace(/\D/g, "")) * 1.25).toLocaleString()}₫`, "含更完整交付"],
            ["custom", "自定义", "自己决定金额与范围"]
          ] as const
        ).map(([id, label, sub]) => (
          <Pressable key={id} onPress={() => setQuoteMode(id)} style={[styles.quoteOption, quoteMode === id && styles.quoteOptionOn]}>
            <Text style={styles.quotePrice}>{label}</Text>
            <Text style={styles.quoteSub}>{sub}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.r4Actions}>
        <Pressable onPress={onBack} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>返回</Text>
        </Pressable>
        <Pressable style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>按我的条件回应</Text>
        </Pressable>
      </View>
      <Pressable onPress={onOpenSelect} style={[styles.r4ActionGhost, { marginTop: 7 }]}>
        <Text style={styles.r4ActionGhostText}>查看客户选人视角 ›</Text>
      </Pressable>

      <Text style={styles.detailHint}>价格只属于这次需求。你的主页不会永久显示“小时价”。AI 不替客户压价，也不替你接受。</Text>
    </View>
  );
}

function PublishDemand({ onBack, onPublished }: { onBack: () => void; onPublished: () => void }): React.JSX.Element {
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>发布需求</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      <View style={styles.detailHero}>
        <Text style={styles.detailHeroKicker}>CREATE DEMAND</Text>
        <Text style={styles.detailHeroTitle}>周六城市同行 + 拍照</Text>
        <Text style={styles.detailHeroSub}>Proxy 在发布前就告诉客户合理价格，避免把需求故意压成低价再让真人竞价。</Text>
      </View>
      <View style={styles.r4Card}>
        <Text style={styles.r4Title}>你想完成什么</Text>
        <View style={styles.factGrid}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>时间</Text>
            <Text style={styles.factValue}>10:00–18:00</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>地点</Text>
            <Text style={styles.factValue}>西湖 / 老城区</Text>
          </View>
        </View>
        <View style={[styles.r4PriceCellHot, { borderRadius: 11, marginTop: 8, padding: 10 }]}>
          <Text style={styles.r4PriceLabel}>Proxy 建议预算</Text>
          <Text style={styles.r4PriceValue}>1.8 – 2.4M₫ · 8h + 中文 + 摄影 + 本地熟悉度</Text>
        </View>
        <View style={styles.r4Match}>
          <Text style={styles.r4MatchText}>会完整展示给回应者 · 预计 6–10 位合格回应 · 竞争力：中等</Text>
        </View>
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>如果坚持 1.5–2.0M₫ 也可以发布</Text>
        <Text style={styles.aiCheck}>Proxy 不阻止低预算，但会原样告诉小美“客户预算”和“公平参考”，小美可按更高条件回应。</Text>
      </View>
      <View style={styles.r4Actions}>
        <Pressable onPress={onBack} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>预览小美视角</Text>
        </Pressable>
        <Pressable onPress={onPublished} style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>发布需求</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SelectWorkbench({
  opportunity,
  onBack,
  onOpenApplicant,
  onOpenSubmission,
  onCompare
}: {
  opportunity: MarketOpportunity;
  onBack: () => void;
  onOpenApplicant: (name: string) => void;
  onOpenSubmission: (name: string) => void;
  onCompare: () => void;
}): React.JSX.Element {
  const candidates: Array<{ name: string; meta: string; price: string; rank: string; hot?: boolean }> = [
    { name: "小美", meta: "中文 / 摄影 / 河内", price: "2.2M₫", rank: "推荐 1", hot: true },
    { name: "Linh", meta: "中文 / 本地同行", price: "2.0M₫", rank: "推荐 2" },
    { name: "Minh", meta: "摄影 / 英文 / 河内", price: "1.8M₫", rank: "推荐 3" }
  ];
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>选人工作台</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      <View style={styles.detailHero}>
        <Text style={styles.detailHeroKicker}>报名明细 · 仅发布者可见</Text>
        <Text style={styles.detailHeroTitle}>{opportunity.title}</Text>
        <Text style={styles.detailHeroSub}>
          {opportunity.date} {opportunity.time} · {opportunity.location} · {opportunity.responses} 人报名 · 先由 Proxy 排除不满足必要条件的人。
        </Text>
      </View>
      <View style={styles.r4PriceStrip}>
        {[["12", "回应"], ["7", "合格"], ["3", "建议先看"], ["1", "确认"]].map(([n, l]) => (
          <View key={l} style={styles.r4PriceCell}>
            <Text style={[styles.r4PriceValue, { textAlign: "center" }]}>{n}</Text>
            <Text style={[styles.r4PriceLabel, { textAlign: "center" }]}>{l}</Text>
          </View>
        ))}
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>Proxy 推荐不是“最便宜”</Text>
        <Text style={styles.aiCheck}>必要条件 40% · 类似结果 20% · 时间15% · 回应质量10% · 偏好10% · 价格5%。</Text>
      </View>
      {candidates.map((c) => (
        <View key={c.name} style={[styles.r4Card, c.hot && { borderColor: color.magenta }]}>
          <View style={styles.r4Top}>
            <Text style={styles.r4Title}>{c.name} · {c.meta}</Text>
            <View style={styles.r4FitBadge}>
              <Text style={styles.r4FitText}>{c.rank}</Text>
            </View>
          </View>
          <Text style={styles.r4Meta}>本次报价 {c.price} · 只属于本次需求，不会把她永久标成小时价</Text>
          <View style={styles.r4Actions}>
            <Pressable onPress={() => onOpenApplicant(c.name)} style={styles.r4ActionGhost}>
              <Text style={styles.r4ActionGhostText}>看候选详情</Text>
            </Pressable>
            <Pressable onPress={() => onOpenSubmission(c.name)} style={styles.r4ActionGhost}>
              <Text style={styles.r4ActionGhostText}>看本次投递</Text>
            </Pressable>
            <Pressable onPress={onCompare} style={styles.r4ActionPrimary}>
              <Text style={styles.r4ActionPrimaryText}>比较</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Pressable onPress={onCompare} style={[styles.r4ActionPrimary, { marginTop: 8 }]}>
        <Text style={styles.r4ActionPrimaryText}>进入深度比较</Text>
      </Pressable>
    </View>
  );
}

function ApplicantDetail({
  name,
  onBack,
  onOpenSubmission,
  onCompare
}: {
  name: string;
  onBack: () => void;
  onOpenSubmission: (name: string) => void;
  onCompare: () => void;
}): React.JSX.Element {
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>{name} · 候选详情</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      <View style={styles.r4Card}>
        <View style={styles.r4Top}>
          <Text style={styles.r4Title}>{name} Xiaomei · 河内 · 中文/越南语</Text>
          <View style={styles.r4FitBadge}>
            <Text style={styles.r4FitText}>已验证</Text>
          </View>
        </View>
        <Text style={styles.r4Meta}>18 真实履约 · 96% 按约 · 7 复邀 · 摄影/本地同行/活动执行</Text>
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>为什么适合你的这个需求 · 推荐 1</Text>
        <Text style={styles.aiCheck}>✓ 中文已验证 · 摄影作品与 3 次类似履约相关 · 周六完全覆盖</Text>
      </View>
      <View style={[styles.r4PriceCellHot, { borderRadius: 12, padding: 11 }]}>
        <Text style={styles.r4PriceLabel}>她对你这个需求的本次 Offer</Text>
        <Text style={styles.r4PriceValue}>2.2M₫ · 8h + 中文 + 30 张调色 · 仅属于本次</Text>
      </View>
      <View style={styles.r4Actions}>
        <Pressable onPress={() => onOpenSubmission(name)} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>看本次完整投递</Text>
        </Pressable>
        <Pressable onPress={onCompare} style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>和其他候选比较</Text>
        </Pressable>
      </View>
      <View style={styles.r4Actions}>
        <Pressable style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>问她一个问题</Text>
        </Pressable>
        <Pressable style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>接受 {name} · 2.2M₫</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SubmissionDetail({
  name,
  onBack,
  onCompare,
  onOpenApplicant
}: {
  name: string;
  onBack: () => void;
  onCompare: () => void;
  onOpenApplicant: (name: string) => void;
}): React.JSX.Element {
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>{name} · 本次投递详情</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      <View style={[styles.r4PriceCellHot, { borderRadius: 12, padding: 11 }]}>
        <Text style={styles.r4PriceLabel}>本次主动报价</Text>
        <Text style={styles.r4PriceValue}>2.2M₫ · 不是主页固定价格</Text>
      </View>
      <View style={styles.r4Card}>
        <Text style={styles.r4Title}>这次她具体提供什么</Text>
        <Text style={styles.r4Meta}>周六 10:00–18:00 · 8h · 西湖+老城区 · 中文/越南语 · 30 张调色 · 交通已含 · 超时250k₫/h</Text>
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>为什么排在前面 · 综合推荐 1</Text>
        <Text style={styles.aiCheck}>5/5 硬条件 · 3 次同类履约 · 路线熟悉 · 2 次复邀 · 高于预算10%但处公平区间</Text>
      </View>
      <View style={styles.r4Actions}>
        <Pressable onPress={() => onOpenApplicant(name)} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>看候选详情</Text>
        </Pressable>
        <Pressable onPress={onCompare} style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>比较候选</Text>
        </Pressable>
      </View>
      <Pressable style={[styles.r4ActionPrimary, { marginTop: 8 }]}>
        <Text style={styles.r4ActionPrimaryText}>接受 {name} · 2.2M₫</Text>
      </Pressable>
    </View>
  );
}

function CompareScene({ onBack, onOpenApplicant }: { onBack: () => void; onOpenApplicant: (name: string) => void }): React.JSX.Element {
  return (
    <View>
      <View style={styles.detailHead}>
        <Pressable onPress={onBack} style={styles.detailBack}>
          <Text style={styles.detailBackText}>‹</Text>
        </Pressable>
        <Text style={styles.detailTitle}>比较 3 位候选</Text>
        <Text style={styles.detailMore}>•••</Text>
      </View>
      <View style={styles.aiBox}>
        <Text style={styles.aiTitle}>当前最关键：中文 + 摄影 + 路线</Text>
        <Text style={styles.aiCheck}>只比较与这件事相关的字段，不以头像/价格作唯一排序。</Text>
      </View>
      {[
        ["本次报价", "2.2M", "2.0M", "1.8M"],
        ["中文", "强", "强", "基础"],
        ["摄影", "强", "一般", "很强"],
        ["熟悉路线", "强", "很强", "一般"],
        ["类似履约", "3", "6", "8"],
        ["按约", "96%", "98%", "94%"]
      ].map(([dim, a, b, c]) => (
        <View key={dim} style={[styles.r4Card, { flexDirection: "row", gap: 6 }]}>
          <Text style={[styles.r4PriceLabel, { flex: 1 }]}>{dim}</Text>
          <Text style={[styles.r4PriceValue, { flex: 1, textAlign: "center" }]}>{a}</Text>
          <Text style={[styles.r4PriceValue, { flex: 1, textAlign: "center" }]}>{b}</Text>
          <Text style={[styles.r4PriceValue, { flex: 1, textAlign: "center" }]}>{c}</Text>
        </View>
      ))}
      <View style={styles.r4Actions}>
        <Pressable onPress={() => onOpenApplicant("小美")} style={styles.r4ActionGhost}>
          <Text style={styles.r4ActionGhostText}>看小美主页</Text>
        </Pressable>
        <Pressable style={styles.r4ActionPrimary}>
          <Text style={styles.r4ActionPrimaryText}>接受 2.2M₫</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MarketMap({
  tab,
  lens,
  remoteLens,
  marketLabel,
  onOpenExperience,
  onOpenOpportunity,
  onOpenActivity
}: {
  tab: "OPPORTUNITY" | "ACTIVITY";
  lens: OpportunityLens;
  remoteLens: boolean;
  marketLabel: string;
  onOpenExperience: (experienceId: string) => void;
  onOpenOpportunity: (id: string) => void;
  onOpenActivity: (activity: Activity) => void;
}): React.JSX.Element {
  const config = mapConfig(tab);
  return (
    <View style={styles.mapWrap}>
      <View style={styles.mapLegend}>
        <Text style={styles.mapLegendTitle}>{config.title}</Text>
        <Text style={styles.mapLegendSub}>{config.sub}</Text>
      </View>
      <View style={styles.geoMap}>
        {MAP_DISTRICTS.map((district) => (
          <Text key={district.label} style={[styles.geoDistrict, { left: `${district.left}%`, top: `${district.top}%` }]}>
            {district.label}
          </Text>
        ))}
        {config.pins.map((pin) => (
          <Pressable
            key={pin.label}
            onPress={() => {
              if (tab === "OPPORTUNITY") onOpenOpportunity(pin.id);
              else onOpenActivity(pin.activity as Activity);
            }}
            style={[styles.geoPin, { left: `${pin.left}%`, top: `${pin.top}%` }]}
          >
            <Text style={styles.geoPinText}>{pin.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.geoPrivacy}>
        <ProxyIcon color={color.ink} name="route" size={14} />
        <View style={styles.geoPrivacyCopy}>
          <Text style={styles.geoPrivacyTitle}>{config.privacyTitle}</Text>
          <Text style={styles.geoPrivacyText}>{config.privacyText}</Text>
        </View>
      </View>
      {remoteLens ? (
        <View style={styles.mapRemote}>
          <Text style={styles.mapRemoteText}>远程机会不依赖地理位置。{"\n"}地图仅保留可定位的本地机会；远程机会请切回列表查看完整结果。</Text>
        </View>
      ) : null}
      {config.results}
    </View>
  );
}

function mapConfig(tab: "OPPORTUNITY" | "ACTIVITY"): {
  title: string;
  sub: string;
  privacyTitle: string;
  privacyText: string;
  pins: Array<{ id: string; label: string; left: number; top: number; activity?: Activity }>;
  results: React.JSX.Element;
} {
  if (tab === "OPPORTUNITY") {
    const local = MARKET_OPPORTUNITIES.filter((o) => o.location !== "远程").slice(0, 6);
    return {
      title: "机会地图",
      sub: "河内 · 仅公开 / 粗粒度任务区域",
      privacyTitle: "任务区域",
      privacyText: "地图用于附近探索与可达性判断；具体地址仅在业务确实需要且授权后提升精度。",
      pins: local.map((o, i) => ({ id: o.id, label: String(i + 1), left: (OPPORTUNITY_COORDS[i % OPPORTUNITY_COORDS.length] ?? [50, 50])[0], top: (OPPORTUNITY_COORDS[i % OPPORTUNITY_COORDS.length] ?? [50, 50])[1] })),
      results: (
        <View>
          {local.slice(0, 2).map((o) => (
            <View key={o.id} style={styles.mapResult}>
              <Text style={styles.mapResultTitle}>{o.shortTitle}</Text>
              <Text style={styles.mapResultMeta}>
                {o.date} {o.time} · {o.location}
                {o.travel != null ? ` · ${o.travel}min 可达` : ""}
              </Text>
              <Pressable style={styles.mapResultBtn}>
                <Text style={styles.mapResultBtnText}>查看机会</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )
    };
  }
  return {
    title: "活动地图",
    sub: "公开 Activity Venue / 区域",
    privacyTitle: "公开活动地点",
    privacyText: "只展示 Activity 对外公开的 Venue / 区域；参与者和 Creator 的实时位置不展示。",
    pins: [
      { id: "photo_walk", label: "1", left: 28, top: 34 },
      { id: "coffee_chat", label: "2", left: 66, top: 40 },
      { id: "merchant_open", label: "3", left: 22, top: 54 },
      { id: "proxy_meetup", label: "4", left: 54, top: 68 }
    ],
    results: (
      <View>
        {MARKET_EXPERIENCES.slice(0, 2).map((experience) => (
          <View key={experience.id} style={styles.mapResult}>
            <Text style={styles.mapResultTitle}>{experience.title}</Text>
            <Text style={styles.mapResultMeta}>{experience.meta} · 已参加</Text>
            <Pressable style={styles.mapResultBtn}>
              <Text style={styles.mapResultBtnText}>查看活动</Text>
            </Pressable>
          </View>
        ))}
      </View>
    )
  };
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 18, paddingTop: 10 },
  marketHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 4 },
  marketTitle: { color: color.ink, fontSize: 30, fontWeight: "800", lineHeight: 36 },
  marketSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  headActions: { alignItems: "center", flexDirection: "row", gap: 6 },
  viewToggle: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, height: 44, justifyContent: "center", width: 44, ...shadows.card },
  viewToggleOn: { backgroundColor: color.ink, borderColor: color.ink },
  viewToggleText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  viewToggleTextOn: { color: color.white },
  plusBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 13, height: 44, justifyContent: "center", width: 44 },
  plusBtnText: { color: color.white, fontSize: 22, fontWeight: "700" },
  tabs: { backgroundColor: color.surface, borderRadius: 14, flexDirection: "row", gap: 5, marginVertical: 8, padding: 4 },
  tab: { borderRadius: 11, flex: 1, minHeight: 44, justifyContent: "center", paddingVertical: 9 },
  tabOn: { backgroundColor: color.white, ...shadows.card },
  tabText: { color: color.muted, fontSize: 14, fontWeight: "800", textAlign: "center" },
  tabTextOn: { color: color.ink },
  oppStack: { marginTop: 4 },
  searchRow: { marginTop: 6 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1, flexDirection: "row", overflow: "hidden" },
  searchInput: { flex: 1, fontSize: 14, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon: { color: color.ink, fontSize: 15, paddingHorizontal: 10 },
  lensRow: { flexDirection: "row", gap: 5, paddingRight: 12 },
  lensSmRow: { flexDirection: "row", gap: 5, paddingRight: 12 },
  lensScroll: { marginVertical: 7 },
  lensRowCompact: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 6 },
  lens: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 13, paddingVertical: 8 },
  lensOn: { backgroundColor: color.ink, borderColor: color.ink },
  lensText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  lensTextOn: { color: color.white },
  lensSm: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  lensSmOn: { backgroundColor: color.ink, borderColor: color.ink },
  lensSmText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  lensSmTextOn: { color: color.white },
  // R7 筛选宫格 6 列 icon-first（固定 footprint，无横滑）
  oppQuickNav: { flexDirection: "row", gap: 5, marginVertical: 8 },
  oppQuickBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, gap: 4, justifyContent: "center", minHeight: 58, paddingHorizontal: 2, paddingVertical: 7, position: "relative" },
  oppQuickBtnOn: { backgroundColor: "#FFF0F6", borderColor: color.magenta },
  oppIcon: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  oppQuickLabel: { color: color.muted, fontSize: 11, fontWeight: "700", textAlign: "center" },
  oppQuickLabelOn: { color: color.ink },
  badge: { alignItems: "center", backgroundColor: color.magenta, borderColor: color.white, borderRadius: 999, borderWidth: 2, height: 15, justifyContent: "center", minWidth: 15, paddingHorizontal: 4, position: "absolute", right: 5, top: 4 },
  badgeText: { color: color.white, fontSize: 11, fontWeight: "900" },
  oppQuickHint: { alignItems: "center", flexDirection: "row", gap: 9, justifyContent: "space-between", marginHorizontal: 2, marginBottom: 7 },
  oppQuickHintCopy: { flex: 1 },
  oppQuickHintTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  oppQuickHintSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  oppQuickHintPill: { backgroundColor: "#FFF0F6", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 },
  oppQuickHintPillText: { color: "#7A0033", fontSize: 11, fontWeight: "800" },
  localScope: { alignItems: "center", flexDirection: "row", gap: 5, marginVertical: 2, paddingHorizontal: 1 },
  localScopeGlyph: { color: color.violet, fontSize: 11 },
  localScopeText: { color: color.muted, fontSize: 11 },
  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginVertical: 8 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionHint: { color: color.muted, fontSize: 11 },
  // R4 世代的上下文条
  contextBar: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 11, paddingVertical: 10 },
  contextCopy: { flex: 1 },
  contextTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  contextSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  contextBadge: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  contextBadgeText: { color: "#5B2CB5", fontSize: 11, fontWeight: "800" },
  // R4 机会卡
  r4Card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginVertical: 5, padding: 12, ...shadows.card },
  r4Top: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  r4Title: { color: color.ink, flex: 1, fontSize: 12, fontWeight: "800", lineHeight: 17 },
  r4Budget: { color: color.ink, fontSize: 13, fontWeight: "900" },
  r4Meta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  r4PriceStrip: { flexDirection: "row", gap: 6, marginTop: 8 },
  r4PriceCell: { backgroundColor: color.surface, borderRadius: 10, flex: 1, padding: 8 },
  r4PriceCellHot: { backgroundColor: "#FFF2C7" },
  r4PriceLabel: { color: color.muted, fontSize: 11 },
  r4PriceValue: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 2 },
  r4Tags: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  r4Tag: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  r4TagHot: { backgroundColor: "#FFF0F6" },
  r4TagText: { color: "#5E5665", fontSize: 11 },
  r4TagTextHot: { color: "#B91451", fontWeight: "800" },
  r4Match: { alignItems: "center", borderTopColor: "#F1EDF3", borderTopWidth: 1, flexDirection: "row", gap: 8, justifyContent: "space-between", marginTop: 9, paddingTop: 8 },
  r4MatchText: { color: color.muted, flex: 1, fontSize: 11, lineHeight: 15 },
  r4FitBadge: { backgroundColor: "#FFF0F6", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  r4FitText: { color: "#B91451", fontSize: 11, fontWeight: "800" },
  r4Actions: { flexDirection: "row", gap: 7, marginTop: 9 },
  r4ActionGhost: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 40 },
  r4ActionGhostText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  r4ActionPrimary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, flex: 1, justifyContent: "center", minHeight: 40 },
  r4ActionPrimaryText: { color: color.white, fontSize: 12, fontWeight: "800" },
  // 详情
  detailHead: { alignItems: "center", flexDirection: "row", gap: 4, marginBottom: 8 },
  detailBack: { paddingHorizontal: 6, paddingVertical: 4 },
  detailBackText: { color: color.ink, fontSize: 22, fontWeight: "700" },
  detailTitle: { color: color.ink, flex: 1, fontSize: 16, fontWeight: "800" },
  detailMore: { color: color.muted, fontSize: 16 },
  detailHero: { backgroundColor: color.ink, borderRadius: 18, marginBottom: 10, padding: 14 },
  detailHeroKicker: { color: "#CDC8BF", fontSize: 11, fontWeight: "800" },
  detailHeroTitle: { color: color.white, fontSize: 18, fontWeight: "800", lineHeight: 24, marginTop: 4 },
  detailHeroSub: { color: "#D8D4CA", fontSize: 11, lineHeight: 16, marginTop: 6 },
  valueBox: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, marginTop: 10, padding: 10 },
  valueHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  valueTitle: { color: color.ink, fontSize: 12, fontWeight: "800" },
  valueBadge: { backgroundColor: "#FFF2C7", borderRadius: 999, color: "#7A5B00", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4 },
  valueBar: { backgroundColor: "#EEEAF1", borderRadius: 999, height: 8, marginVertical: 7, overflow: "hidden" },
  valueFill: { backgroundColor: color.magenta, borderRadius: 999, height: "100%" },
  valueText: { color: color.muted, fontSize: 11, lineHeight: 15 },
  factGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  fact: { backgroundColor: color.surface, borderRadius: 10, flexBasis: "48%", flexGrow: 1, padding: 8 },
  factLabel: { color: color.muted, fontSize: 11 },
  factValue: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 2 },
  aiBox: { backgroundColor: "#F1EAFE", borderColor: "#E6DBF8", borderRadius: 15, borderWidth: 1, marginTop: 10, padding: 10 },
  aiHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  aiTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  aiStrong: { color: "#5B2CB5", fontSize: 11, fontWeight: "800" },
  aiChecks: { gap: 4, marginTop: 7 },
  aiCheck: { color: "#3E2E5A", fontSize: 11, lineHeight: 15 },
  quoteGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  quoteOption: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexBasis: "48%", flexGrow: 1, padding: 9 },
  quoteOptionOn: { backgroundColor: "#FFF0F6", borderColor: color.magenta },
  quotePrice: { color: color.ink, fontSize: 12, fontWeight: "800" },
  quoteSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  detailHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 10, textAlign: "center" },
  emptyBox: { alignItems: "center", borderColor: "#D9D0DE", borderRadius: 17, borderStyle: "dashed", borderWidth: 1, gap: 8, marginTop: 12, padding: 22 },
  emptyText: { color: color.muted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  retryBtn: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  retryText: { color: color.white, fontSize: 11, fontWeight: "700" },
  hostFlag: { marginHorizontal: 12, marginTop: -4, marginBottom: 7 },
  hostFlagText: { backgroundColor: "#F3EEFA", borderRadius: 999, color: "#633B99", fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 4 },
  mapWrap: { marginVertical: 9 },
  mapLegend: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  mapLegendTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  mapLegendSub: { color: color.muted, fontSize: 11, textAlign: "right" },
  geoMap: { backgroundColor: "#F7F5F8", borderColor: color.line, borderRadius: 19, borderWidth: 1, height: 330, marginVertical: 8, overflow: "hidden", position: "relative" },
  geoDistrict: { backgroundColor: "rgba(255,255,255,0.78)", borderRadius: 8, color: "#8E8595", fontSize: 11, fontWeight: "900", paddingHorizontal: 6, paddingVertical: 4, position: "absolute" },
  geoPin: { alignItems: "center", backgroundColor: "#0B7A73", borderColor: color.white, borderRadius: 999, borderWidth: 2, height: 31, justifyContent: "center", minWidth: 31, paddingHorizontal: 7, position: "absolute", transform: [{ translateX: -15.5 }, { translateY: -15.5 }] },
  geoPinText: { color: color.white, fontSize: 11, fontWeight: "900" },
  geoPrivacy: { alignItems: "flex-start", backgroundColor: "#FFF8DF", borderColor: "#F0DA85", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 7, marginVertical: 7, padding: 9 },
  geoPrivacyGlyph: { color: color.ink, fontSize: 12 },
  geoPrivacyCopy: { flex: 1 },
  geoPrivacyTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  geoPrivacyText: { color: "#78672F", fontSize: 11, lineHeight: 15, marginTop: 2 },
  mapRemote: { backgroundColor: "#F7F4FA", borderColor: "#D8CFDE", borderRadius: 13, borderStyle: "dashed", borderWidth: 1, marginTop: 8, padding: 10 },
  mapRemoteText: { color: color.muted, fontSize: 11, lineHeight: 15 },
  mapResult: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, marginTop: 8, padding: 10 },
  mapResultTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  mapResultMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  mapResultBtn: { alignSelf: "flex-start", backgroundColor: color.ink, borderRadius: 10, marginTop: 8, paddingHorizontal: 10, paddingVertical: 7 },
  mapResultBtnText: { color: color.white, fontSize: 11, fontWeight: "800" }
});
